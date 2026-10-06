/**
 * HTTP egress with retry. Host is expected to be idempotent on event.id.
 * LIVE vs CATCH-UP is decided from original event.ts lag — never rewrite ts.
 */
export class Egress {
  constructor(hostUrl, lanToken = "") {
    this.hostUrl = String(hostUrl || "").replace(/\/$/, "");
    this.lanToken = lanToken || process.env.FOREVERLAN_TOKEN || "";
  }

  setHostUrl(hostUrl) {
    this.hostUrl = String(hostUrl || "").replace(/\/$/, "");
  }

  #modeFor(event) {
    if (event?.ingest_mode === "catch-up" || event?.ingest_mode === "offline") {
      return "catch-up";
    }
    if (event?.ingest_mode === "live") return "live";
    const ts = Number(event?.ts);
    if (!Number.isFinite(ts)) return "live";
    const unix = ts > 1e12 ? ts / 1000 : ts;
    return Date.now() / 1000 - unix > 120 ? "catch-up" : "live";
  }

  async send(event) {
    if (!this.hostUrl) throw new Error("egress: no hostUrl");
    const mode = this.#modeFor(event);
    const headers = {
      "content-type": "application/json",
      "x-foreverlan-event-id": event.id,
      "x-foreverlan-mode": mode,
    };
    if (this.lanToken) headers["x-foreverlan-token"] = this.lanToken;

    const res = await fetch(`${this.hostUrl}/events`, {
      method: "POST",
      headers,
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(12000),
    });
    if (res.status === 200 || res.status === 201 || res.status === 409) {
      // 409 = duplicate accepted as success for idempotency
      // 200 + ignored smoke = path OK for tests
      return { ok: true, status: res.status, mode };
    }
    const text = await res.text();
    const err = new Error(`egress ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
}
