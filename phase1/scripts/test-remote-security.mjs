/**
 * Remote / WAN security + LAN regression tests.
 *
 * Always runs a throwaway host (no weekend data):
 *  - LAN mode unchanged (open GETs on loopback Host)
 *  - ingest hostname: POST /events lanToken required; reads 403
 *  - catch-up mode still accepted with token
 *  - /stream works on LAN host
 *
 * Optional --live-wan (tunnel + Access configured):
 *  - unauthenticated dashboard GETs challenged by Access
 *  - ingest POST without token → 401 from ForeverLAN
 *  - ingest POST with token → ok
 *  - SSE /stream: Access challenge without creds; with CF service token env → event-stream
 *
 *   node scripts/test-remote-security.mjs
 *   node scripts/test-remote-security.mjs --live-wan
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  gateIngestHostnameRequest,
  ingestHostAllows,
  remoteSecurityModeEnabled,
  remoteSecurityPublicMeta,
} from "../host/remote-security.js";

const phase1 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const liveWan = process.argv.includes("--live-wan");
const failures = [];

function pass(name) {
  console.log(`PASS  ${name}`);
}
function fail(name, detail) {
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  failures.push(name);
}
function check(name, cond, detail) {
  if (cond) pass(name);
  else fail(name, detail);
}

// --- unit: remote-security helpers (no server) ---
{
  check("remoteSecurityModeEnabled wan", remoteSecurityModeEnabled("wan"));
  check("remoteSecurityModeEnabled off", !remoteSecurityModeEnabled("off"));
  check("ingest allows POST /events", ingestHostAllows("POST", "/events"));
  check("ingest denies GET /lan", !ingestHostAllows("GET", "/lan"));
  check("ingest denies GET /health", !ingestHostAllows("GET", "/health"));
  check("ingest denies GET /discover", !ingestHostAllows("GET", "/discover"));

  const cfg = {
    ingestPublicHostname: "foreverlan-ingest.example.com",
    publicBaseUrl: "https://foreverlan.example.com",
    remoteSecurityMode: "wan",
  };
  const blocked = gateIngestHostnameRequest(
    { method: "GET", headers: { host: "foreverlan-ingest.example.com" } },
    "/lan",
    cfg
  );
  check("gate blocks GET /lan on ingest host", blocked.block === true && blocked.status === 403);

  const allowed = gateIngestHostnameRequest(
    { method: "POST", headers: { host: "foreverlan-ingest.example.com" } },
    "/events",
    cfg
  );
  check("gate allows POST /events on ingest host", allowed.block === false);

  const lan = gateIngestHostnameRequest(
    { method: "GET", headers: { host: "127.0.0.1:8765" } },
    "/lan",
    cfg
  );
  check("gate ignores LAN Host for /lan", lan.block === false);

  const dotted = gateIngestHostnameRequest(
    { method: "GET", headers: { host: "foreverlan-ingest.example.com." } },
    "/lan",
    cfg
  );
  check("gate blocks trailing-dot ingest Host", dotted.block === true);

  const tunnelOtherHost = gateIngestHostnameRequest(
    { method: "GET", headers: { host: "foreverlan.example.com", "cf-ray": "abc" } },
    "/lan",
    cfg
  );
  check("gate blocks tunnel (cf-ray) GET /lan on any Host", tunnelOtherHost.block === true);

  const tunnelNoHost = gateIngestHostnameRequest(
    { method: "GET", headers: { "cf-connecting-ip": "203.0.113.9" } },
    "/events",
    cfg
  );
  check("gate blocks tunnel GET /events without Host", tunnelNoHost.block === true);

  const tunnelPost = gateIngestHostnameRequest(
    { method: "POST", headers: { host: "localhost:8765", "cf-ray": "abc" } },
    "/events",
    cfg
  );
  check("gate allows tunnel POST /events", tunnelPost.block === false);

  const accessBoard = gateIngestHostnameRequest(
    { method: "GET", headers: { host: "foreverlan.example.com", "cf-ray": "abc" } },
    "/lan",
    { ...cfg, remoteDashboardViaAccess: true }
  );
  check("gate opt-out remoteDashboardViaAccess serves board host", accessBoard.block === false);

  const meta = remoteSecurityPublicMeta(cfg);
  check("meta mode wan", meta.remote_security_mode === "wan");
  check("meta board is local", meta.dashboard_base_url === "http://127.0.0.1:8765");
  check("meta Access list empty (push-only)", Array.isArray(meta.access_protected_on_dashboard) && meta.access_protected_on_dashboard.length === 0);
  check("meta does not list /health as public ingest", !meta.intentionally_public_on_ingest.some((x) => x.path === "/health"));
  check("meta does not list /discover as public ingest", !meta.intentionally_public_on_ingest.some((x) => x.path === "/discover"));
  check("gate 403 points at local board", blocked.body?.dashboard === "http://127.0.0.1:8765/");
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "foreverlan-remote-sec-"));
const port = 19000 + Math.floor(Math.random() * 1000);
const token = "remote-sec-token";
const ingestHost = "foreverlan-ingest.example.com";
const base = `http://127.0.0.1:${port}`;
const configPath = path.join(tmp, "config.json");
fs.writeFileSync(
  configPath,
  JSON.stringify({
    dataDir: path.join(tmp, "data"),
    listenHost: "127.0.0.1",
    listenPort: port,
    lanToken: token,
    lanBeacon: false,
    lanName: "RemoteSec",
    remoteSecurityMode: "wan",
    ingestPublicHostname: ingestHost,
    publicBaseUrl: "https://foreverlan.example.com",
    publicHostname: "foreverlan.example.com",
    lanRoster: ["Alex River"],
    lanLevelCap: 60,
  })
);

let hostProc = null;
async function startHost() {
  hostProc = spawn(process.execPath, [path.join(phase1, "host", "server.js")], {
    env: { ...process.env, FOREVERLAN_CONFIG: configPath, FOREVERLAN_TOKEN: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  hostProc.stdout.on("data", (d) => (log += d));
  hostProc.stderr.on("data", (d) => (log += d));
  hostProc.logText = () => log;
  for (let i = 0; i < 100; i++) {
    try {
      const h = await (await fetch(`${base}/health`)).json();
      if (h.ready) return h;
    } catch {
      /* boot */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`host not ready:\n${log}`);
}
async function stopHost() {
  if (!hostProc) return;
  const done = new Promise((r) => hostProc.once("exit", r));
  hostProc.kill();
  await done;
  hostProc = null;
}

/** fetch that can set Host (Node's fetch forbids Host override). */
function requestWithHost(method, urlPath, { hostname, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: urlPath,
        method,
        headers: {
          ...headers,
          Host: hostname || `127.0.0.1:${port}`,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch {
            /* not json */
          }
          resolve({ status: res.statusCode, headers: res.headers, raw, json });
        });
      }
    );
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}

try {
  await startHost();

  // LAN mode surfaces on loopback Host — unchanged open reads + token ingest
  {
    const health = await (await fetch(`${base}/health`)).json();
    check("LAN GET /health ok", health.ok === true);
    const discover = await (await fetch(`${base}/discover`)).json();
    check("LAN GET /discover ok", discover.ok === true && discover.service === "foreverlan");
    check("LAN discover remote_security.wan", discover.remote_security?.remote_security_mode === "wan");
    const lan = await fetch(`${base}/lan`);
    check("LAN GET /lan open", lan.status === 200);

    const streamRes = await fetch(`${base}/stream`);
    check(
      "LAN GET /stream SSE content-type",
      streamRes.status === 200 && String(streamRes.headers.get("content-type") || "").includes("text/event-stream")
    );
    // Abort the long-lived SSE body so the process can exit.
    try {
      await streamRes.body.cancel();
    } catch {
      /* ignore */
    }

    const noTok = await fetch(`${base}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: `rs-notok-${Date.now()}`, type: "PING", ts: Math.floor(Date.now() / 1000), source: "SMOKE" }),
    });
    check("LAN POST /events without lanToken → 401", noTok.status === 401);

    const now = Math.floor(Date.now() / 1000);
    const withTok = await fetch(`${base}/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-foreverlan-token": token,
        "x-foreverlan-mode": "live",
      },
      body: JSON.stringify({
        id: `rs-lan-${now}`,
        type: "PING",
        ts: now,
        source: "SMOKE",
        character: "SmokeFriend",
      }),
    });
    const withBody = await withTok.json().catch(() => ({}));
    check(
      "LAN POST /events with lanToken ok",
      withTok.status === 200 || withTok.status === 201 || withTok.status === 409,
      `status=${withTok.status} body=${JSON.stringify(withBody)}`
    );
  }

  // Ingest hostname isolation
  {
    const deniedLan = await requestWithHost("GET", "/lan", { hostname: ingestHost });
    check("ingest Host GET /lan → 403", deniedLan.status === 403 && deniedLan.json?.error === "ingest_host_only");

    const deniedHealth = await requestWithHost("GET", "/health", { hostname: ingestHost });
    check("ingest Host GET /health → 403", deniedHealth.status === 403);

    const deniedDiscover = await requestWithHost("GET", "/discover", { hostname: ingestHost });
    check("ingest Host GET /discover → 403", deniedDiscover.status === 403);

    const deniedGetEvents = await requestWithHost("GET", "/events", { hostname: ingestHost });
    check("ingest Host GET /events → 403", deniedGetEvents.status === 403);

    const deniedStream = await requestWithHost("GET", "/stream", { hostname: ingestHost });
    check("ingest Host GET /stream → 403", deniedStream.status === 403);

    const deniedTunnel = await requestWithHost("GET", "/lan", {
      hostname: "foreverlan.example.com.",
      headers: { "cf-ray": "test", "cf-connecting-ip": "203.0.113.9" },
    });
    check("tunnel GET /lan with other Host → 403", deniedTunnel.status === 403);

    const badHost = await requestWithHost("GET", "/health", { hostname: "a b[" });
    check("malformed Host header does not crash host", badHost.status === 200 || badHost.status === 400, `status=${badHost.status}`);
    const stillUp = await (await fetch(`${base}/health`)).json();
    check("host alive after malformed Host", stillUp.ok === true);

    const now = Math.floor(Date.now() / 1000);
    const badBody = JSON.stringify({
      id: `rs-ingest-bad-${now}`,
      type: "PING",
      ts: now,
      source: "SMOKE",
    });
    const noTok = await requestWithHost("POST", "/events", {
      hostname: ingestHost,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(badBody),
      },
      body: badBody,
    });
    check("ingest POST /events without lanToken → 401", noTok.status === 401, `status=${noTok.status}`);

    const goodBody = JSON.stringify({
      id: `rs-ingest-ok-${now}`,
      type: "PING",
      ts: now,
      source: "SMOKE",
      character: "SmokeFriend",
    });
    const ok = await requestWithHost("POST", "/events", {
      hostname: ingestHost,
      headers: {
        "content-type": "application/json",
        "x-foreverlan-token": token,
        "content-length": Buffer.byteLength(goodBody),
      },
      body: goodBody,
    });
    check(
      "ingest POST /events with lanToken ok",
      ok.status === 200 || ok.status === 201 || ok.status === 409,
      `status=${ok.status} body=${ok.raw}`
    );

    // Catch-up through ingest host (tunnel path equivalent)
    const catchTs = now - 3600;
    const catchBody = JSON.stringify({
      id: `rs-catchup-${catchTs}`,
      type: "PLAYER_LEVEL_CHANGED",
      ts: catchTs,
      source: "SMOKE",
      character: "SmokeFriend",
      level: 2,
      old_level: 1,
      is_self: true,
    });
    const catchUp = await requestWithHost("POST", "/events", {
      hostname: ingestHost,
      headers: {
        "content-type": "application/json",
        "x-foreverlan-token": token,
        "x-foreverlan-mode": "catch-up",
        "content-length": Buffer.byteLength(catchBody),
      },
      body: catchBody,
    });
    check(
      "ingest catch-up POST /events with lanToken ok",
      catchUp.status === 200 || catchUp.status === 201 || catchUp.status === 409,
      `status=${catchUp.status} body=${catchUp.raw}`
    );
  }
} finally {
  await stopHost();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

// --- optional live WAN (push-only by default) ---
if (liveWan) {
  const testDash = process.env.FOREVERLAN_TEST_DASHBOARD === "1";
  const dash = (process.env.FOREVERLAN_WAN_DASHBOARD || "https://foreverlan.example.com").replace(/\/$/, "");
  const ingest = (process.env.FOREVERLAN_WAN_INGEST || "https://foreverlan-ingest.example.com").replace(/\/$/, "");
  let cfgToken = "";
  try {
    cfgToken = JSON.parse(fs.readFileSync(path.join(phase1, "config.json"), "utf8")).lanToken || "";
  } catch {
    /* ignore */
  }
  const wanToken = process.env.FOREVERLAN_TOKEN || cfgToken;

  async function probeAccessChallenge(url) {
    const res = await fetch(url, { redirect: "manual" });
    const loc = String(res.headers.get("location") || "");
    const body = await res.text().catch(() => "");
    const challenged =
      res.status === 302 ||
      res.status === 401 ||
      res.status === 403 ||
      /cloudflareaccess\.com|Access/i.test(loc) ||
      /cloudflareaccess\.com|Login|Access/i.test(body);
    const leakedBoard = /"players"\s*:|"board_version"\s*:/.test(body);
    return { status: res.status, loc, challenged, leakedBoard, bodySnippet: body.slice(0, 200) };
  }

  if (testDash) {
    for (const p of ["/lan", "/stream", "/wrap", "/health", "/discover", "/api/v1/diagnostics"]) {
      try {
        const r = await probeAccessChallenge(`${dash}${p}`);
        check(
          `live WAN unauthenticated ${p} Access-challenged`,
          r.challenged && !r.leakedBoard,
          `status=${r.status} loc=${r.loc} leaked=${r.leakedBoard} body=${r.bodySnippet}`
        );
      } catch (err) {
        fail(`live WAN unauthenticated ${p} Access-challenged`, String(err.message || err));
      }
    }
  } else {
    console.log("SKIP  live WAN dashboard Access checks (push-only; set FOREVERLAN_TEST_DASHBOARD=1 to enable)");
  }

  if (!wanToken) {
    fail("live WAN ingest token present", "set FOREVERLAN_TOKEN or config.json lanToken");
  } else {
    const now = Math.floor(Date.now() / 1000);
    const noTok = await fetch(`${ingest}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: `wan-bad-${now}`, type: "PING", ts: now, source: "SMOKE" }),
    });
    check("live WAN POST ingest without lanToken → 401", noTok.status === 401, `status=${noTok.status}`);

    const ok = await fetch(`${ingest}/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-foreverlan-token": wanToken,
        "x-foreverlan-mode": "catch-up",
      },
      body: JSON.stringify({
        id: `wan-ok-${now}`,
        type: "PING",
        ts: now - 400,
        source: "SMOKE",
        character: "SmokeFriend",
      }),
    });
    const okBody = await ok.json().catch(() => ({}));
    check(
      "live WAN POST ingest with lanToken (+ catch-up) ok",
      ok.status === 200 || ok.status === 201 || ok.status === 409,
      `status=${ok.status} body=${JSON.stringify(okBody)}`
    );

    // Ingest hostname must not serve the board
    try {
      const leak = await fetch(`${ingest}/lan`, { redirect: "manual" });
      const leakBody = await leak.text().catch(() => "");
      check(
        "live WAN GET ingest /lan not a public board",
        leak.status === 403 || !/"players"\s*:/.test(leakBody),
        `status=${leak.status} body=${leakBody.slice(0, 120)}`
      );
    } catch (err) {
      fail("live WAN GET ingest /lan not a public board", String(err.message || err));
    }
  }

  if (testDash) {
    const dashEvents = await fetch(`${dash}/events`, { redirect: "manual" });
    const dashEventsBody = await dashEvents.text().catch(() => "");
    check(
      "live WAN GET dashboard /events not a public event dump",
      dashEvents.status !== 200 || !/"events"\s*:\s*\[/.test(dashEventsBody),
      `status=${dashEvents.status}`
    );
  }

  const clientId = process.env.CF_ACCESS_CLIENT_ID || "";
  const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET || "";
  if (testDash && clientId && clientSecret) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 8000);
    try {
      const res = await fetch(`${dash}/stream`, {
        headers: {
          "CF-Access-Client-Id": clientId,
          "CF-Access-Client-Secret": clientSecret,
        },
        signal: ac.signal,
      });
      const ct = String(res.headers.get("content-type") || "");
      check(
        "live WAN SSE /stream via Access service token",
        res.status === 200 && ct.includes("text/event-stream"),
        `status=${res.status} ct=${ct}`
      );
      try {
        await res.body.cancel();
      } catch {
        /* ignore */
      }
    } catch (err) {
      fail("live WAN SSE /stream via Access service token", String(err.message || err));
    } finally {
      clearTimeout(t);
    }
  } else if (testDash) {
    console.log("SKIP  live WAN SSE /stream via Access service token (set CF_ACCESS_CLIENT_ID/SECRET to enable)");
  }
} else {
  console.log("SKIP  live WAN checks (pass --live-wan when tunnel is up)");
}

console.log("");
if (failures.length) {
  console.error(`REMOTE SECURITY FAIL (${failures.length})`);
  process.exit(1);
}
console.log("REMOTE SECURITY OK");
