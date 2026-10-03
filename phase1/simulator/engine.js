import crypto from "node:crypto";
import { SCENARIOS, listScenarios, createLanWorld } from "./scenarios.js";
import { baseEvent, memberSnapshot, partyRosterEvent } from "./schema.js";
import { createCast } from "./cast.js";

export class SimulatorEngine {
  constructor({ hostUrl, onStatus } = {}) {
    this.hostUrl = (hostUrl || "http://127.0.0.1:8765").replace(/\/$/, "");
    this.onStatus = onStatus || (() => {});
    this.runId = crypto.randomBytes(4).toString("hex");
    this.scenarioId = null;
    this.status = "idle"; // idle | running | paused | error
    this.paused = false;
    this.timer = null;
    this.lastError = null;
    this.sent = 0;
    this.tick = 0;
    this.intervalMs = 1800;
    this.world = null;
    this.manualCast = createCast();
  }

  getState() {
    return {
      status: this.status,
      scenarioId: this.scenarioId || "lan_weekend",
      runId: this.runId,
      tick: this.tick,
      sent: this.sent,
      paused: this.paused,
      lastError: this.lastError,
      hostUrl: this.hostUrl,
      intervalMs: this.intervalMs,
      scenarios: listScenarios(),
      players: this.world ? this.world.getCast() : this.manualCast,
    };
  }

  #emitStatus() {
    this.onStatus(this.getState());
  }

  reset() {
    this.#clearTimer();
    this.runId = crypto.randomBytes(4).toString("hex");
    this.scenarioId = null;
    this.status = "idle";
    this.paused = false;
    this.lastError = null;
    this.sent = 0;
    this.tick = 0;
    this.world = null;
    this.manualCast = createCast();
    this.#emitStatus();
  }

  async start(scenarioId = "lan_weekend") {
    if (!SCENARIOS[scenarioId] && scenarioId !== "lan_weekend") {
      // ignore legacy ids — always run lan weekend
      scenarioId = "lan_weekend";
    }
    this.#clearTimer();
    this.runId = crypto.randomBytes(4).toString("hex");
    this.scenarioId = "lan_weekend";
    this.world = createLanWorld();
    this.tick = 0;
    this.sent = 0;
    this.paused = false;
    this.lastError = null;
    this.status = "running";
    this.#emitStatus();
    await this.#runTick();
  }

  pause() {
    if (this.status !== "running") return;
    this.paused = true;
    this.status = "paused";
    this.#clearTimer();
    this.#emitStatus();
  }

  resume() {
    if (this.status !== "paused") return;
    this.paused = false;
    this.status = "running";
    this.#emitStatus();
    this.#schedule();
  }

  setSpeed(intervalMs) {
    this.intervalMs = Math.max(400, Number(intervalMs) || 1800);
    this.#emitStatus();
    if (this.status === "running") {
      this.#clearTimer();
      this.#schedule();
    }
  }

  async postEvent(event) {
    const res = await fetch(`${this.hostUrl}/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-foreverlan-event-id": event.id,
        "x-foreverlan-source": "simulator",
      },
      body: JSON.stringify(event),
    });
    if (res.status === 200 || res.status === 201 || res.status === 409) {
      this.sent += 1;
      return { ok: true, status: res.status };
    }
    const text = await res.text();
    throw new Error(`host ${res.status}: ${text}`);
  }

  async triggerManual(type, overrides = {}) {
    const host = this.manualCast[0];
    const other = this.manualCast[1];
    let event;

    switch (type) {
      case "LOGIN":
        event = baseEvent(this.runId, "LOGIN", { ...memberSnapshot(host) });
        break;
      case "PLAYER_LEVEL_CHANGED": {
        const t = overrides.who === "host" ? host : other;
        const old = t.level;
        t.level += 1;
        t.levels_gained = (t.levels_gained || 0) + 1;
        event = baseEvent(this.runId, "PLAYER_LEVEL_CHANGED", {
          ...memberSnapshot(t),
          old_level: old,
          detection: "manual",
        });
        break;
      }
      case "PLAYER_DIED":
        event = baseEvent(this.runId, "PLAYER_DIED", {
          ...memberSnapshot(overrides.who === "host" ? host : other),
          detection: "manual",
          death_cause: overrides.death_cause || "pve",
        });
        break;
      case "PLAYER_PVP_KILL":
        event = baseEvent(this.runId, "PLAYER_PVP_KILL", {
          ...memberSnapshot(host),
          opponent_name: other.character,
          opponent_guid: other.guid,
          detection: "manual",
        });
        break;
      case "PARTY_ROSTER":
        event = partyRosterEvent(this.runId, this.manualCast, "manual");
        break;
      case "LAN_STATS":
        event = baseEvent(this.runId, "LAN_STATS", {
          players: this.manualCast.map((p) => ({
            character: p.character,
            class: p.class,
            level: p.level,
            zone: p.zone,
            online: p.online,
            deaths: p.deaths || 0,
            deaths_pvp: p.deaths_pvp || 0,
            deaths_pve: p.deaths_pve || 0,
            pvp_kills: p.pvp_kills || 0,
            levels_gained: p.levels_gained || 0,
            is_self: p.is_self,
            guid: p.guid,
          })),
          online_count: this.manualCast.filter((p) => p.online).length,
        });
        break;
      default:
        throw new Error(`Unsupported manual type: ${type}`);
    }

    await this.postEvent(event);
    this.#emitStatus();
    return event;
  }

  #clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  #schedule() {
    this.timer = setTimeout(() => {
      this.#runTick().catch((err) => {
        this.status = "error";
        this.lastError = String(err.message || err);
        this.#emitStatus();
      });
    }, this.intervalMs);
  }

  async #runTick() {
    if (this.paused || this.status !== "running" || !this.world) return;
    const batch = this.world.step(this.runId);
    this.tick = this.world.tick;
    for (const event of batch) {
      await this.postEvent(event);
    }
    this.#emitStatus();
    this.#schedule();
  }
}
