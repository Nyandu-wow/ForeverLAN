/**
 * Remote / WAN security helpers for Forever LAN.
 *
 * Does not change the event schema or CLIENT_CONTRACT.
 * Dashboard reads stay open on LAN Host; ingest public hostname is POST /events only.
 */

/** @param {unknown} value */
export function remoteSecurityModeEnabled(value) {
  if (value === true || value === 1) return true;
  const s = String(value || "")
    .trim()
    .toLowerCase();
  return s === "wan" || s === "remote" || s === "on" || s === "true" || s === "1";
}

/** @param {import('node:http').IncomingMessage} req */
export function requestHostname(req) {
  const raw = String(req.headers?.host || "");
  return raw.split(":")[0].trim().toLowerCase().replace(/\.+$/, "");
}

/**
 * Cloudflare edge stamps these on every proxied request; LAN agents never send them.
 * @param {import('node:http').IncomingMessage} req
 */
export function viaCloudflareTunnel(req) {
  const h = req.headers || {};
  return Boolean(h["cf-ray"] || h["cf-connecting-ip"]);
}

/**
 * @param {string} hostname
 * @param {{ ingestPublicHostname?: string }} config
 */
export function isIngestPublicHostname(hostname, config = {}) {
  const ingest = String(config.ingestPublicHostname || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0];
  if (!ingest || !hostname) return false;
  return hostname === ingest;
}

/**
 * Paths that must never be served on the ingest public hostname.
 * POST /events is the only intentional public WAN write path (still lanToken-gated).
 */
export const INGEST_HOST_ALLOWED = new Set([
  "POST /events",
  "OPTIONS /events",
]);

/**
 * @param {string} method
 * @param {string} pathname
 */
export function ingestHostAllows(method, pathname) {
  const m = String(method || "GET").toUpperCase();
  const p = String(pathname || "/");
  return INGEST_HOST_ALLOWED.has(`${m} ${p}`);
}

/**
 * Read surfaces that would need Cloudflare Access IF a remote dashboard hostname
 * is put back on the tunnel. Push-only default keeps the board on localhost only.
 */
export const ACCESS_PROTECTED_PATH_PREFIXES = [
  "/",
  "/lan",
  "/stream",
  "/wrap",
  "/raw",
  "/api/",
  "/diagnostics",
  "/health",
  "/discover",
  "/events", // GET /events is a read surface; POST uses ingest hostname
];

/**
 * Paths intentionally reachable on the public ingest hostname (still lanToken for POST).
 */
export const INTENTIONALLY_PUBLIC_ON_INGEST = [
  {
    method: "POST",
    path: "/events",
    reason: "Friend agents / collectors; authenticated by lanToken at ForeverLAN",
  },
  {
    method: "OPTIONS",
    path: "/events",
    reason: "CORS preflight for POST /events",
  },
];

/**
 * Decide whether this request must be rejected on the ingest hostname.
 * @returns {{ block: boolean, status?: number, body?: object }}
 */
export function gateIngestHostnameRequest(req, pathname, config = {}) {
  const host = requestHostname(req);
  // Fail closed: tunnel traffic is ingest-only whatever Host says (trailing dot, extra
  // ingress hostname, httpHostHeader rewrite). Opt out only for an Access-protected board.
  const tunneled = viaCloudflareTunnel(req) && config.remoteDashboardViaAccess !== true;
  if (!tunneled && !isIngestPublicHostname(host, config)) {
    return { block: false };
  }
  if (ingestHostAllows(req.method, pathname)) {
    return { block: false };
  }
  return {
    block: true,
    status: 403,
    body: {
      error: "ingest_host_only",
      message: "This hostname accepts POST /events only (lanToken required).",
      // Push-only: board is local. Do not advertise a public dashboard URL here.
      dashboard: "http://127.0.0.1:8765/",
    },
  };
}

/**
 * Operator-facing path matrix for /discover meta + docs/tests.
 * @param {{ remoteSecurityMode?: unknown, ingestPublicHostname?: string, publicBaseUrl?: string, publicHostname?: string }} config
 */
export function remoteSecurityPublicMeta(config = {}) {
  const enabled = remoteSecurityModeEnabled(config.remoteSecurityMode);
  const ingestHost = String(config.ingestPublicHostname || "").trim() || null;
  // Push-only default: local board. publicBaseUrl is optional leftover for a future remote board.
  const dashboard = "http://127.0.0.1:8765";
  const optionalRemoteBoard =
    String(config.publicBaseUrl || "").replace(/\/$/, "") ||
    (config.publicHostname ? `https://${config.publicHostname}` : null);
  return {
    remote_security_mode: enabled ? "wan" : "lan",
    dashboard_base_url: dashboard,
    optional_remote_dashboard: optionalRemoteBoard,
    ingest_public_hostname: ingestHost,
    access_protected_on_dashboard: [],
    intentionally_public_on_ingest: enabled ? INTENTIONALLY_PUBLIC_ON_INGEST : [],
    note: enabled
      ? "WAN push-only: POST /events on ingest hostname + lanToken; board on 127.0.0.1. Optional Access only if you publish a remote dashboard hostname. LAN weekend: leave tunnel off."
      : "LAN mode: discovery + open dashboard GETs on the local network; POST /events still requires lanToken.",
  };
}
