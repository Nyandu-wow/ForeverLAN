import dgram from "node:dgram";
import os from "node:os";

const BEACON_PORT = 8766;
const BEACON_MAGIC = "FOREVERLAN";

async function probeDiscover(baseUrl, ms = 800) {
  const url = `${baseUrl.replace(/\/$/, "")}/discover`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) return null;
    const body = await res.json();
    if (body?.service !== "foreverlan" || !body?.ok) return null;
    return baseUrl.replace(/\/$/, "");
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function isIpv4Family(family) {
  // Node has shipped family as "IPv4" (string) or 4 (number) depending on version.
  return family === "IPv4" || family === 4;
}

function localIpv4s() {
  const out = [];
  for (const iface of Object.values(os.networkInterfaces() || {})) {
    for (const addr of iface || []) {
      if (!isIpv4Family(addr.family) || addr.internal) continue;
      const ip = String(addr.address || "");
      // Skip APIPA / link-local — not a useful LAN scan target.
      if (ip.startsWith("169.254.")) continue;
      out.push(ip);
    }
  }
  return out;
}

function subnetHosts(ipv4) {
  const parts = ipv4.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return [];
  }
  const hosts = [];
  for (let i = 1; i <= 254; i++) {
    hosts.push(`${parts[0]}.${parts[1]}.${parts[2]}.${i}`);
  }
  return hosts;
}

function validHttpPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

/** Listen briefly for host UDP beacons. */
export function listenForBeacon(ms = 4000) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), ms);
    socket.on("message", (msg, rinfo) => {
      const text = msg.toString("utf8");
      if (!text.startsWith(BEACON_MAGIC)) return;
      try {
        const data = JSON.parse(text.slice(BEACON_MAGIC.length));
        if (data?.service !== "foreverlan") return;
        const port = validHttpPort(data.httpPort);
        if (port == null) return;
        const ip = rinfo?.address;
        if (!ip) return;
        finish(`http://${ip}:${port}`);
      } catch {
        /* ignore */
      }
    });
    socket.on("error", () => finish(null));
    socket.bind(BEACON_PORT);
  });
}

/** Scan local /24 subnets for GET /discover (outbound only — no friend firewall needed). */
export async function scanLanForHost(httpPort = 8765) {
  const ips = localIpv4s();
  const candidates = new Set();
  for (const ip of ips) {
    for (const host of subnetHosts(ip)) candidates.add(host);
  }
  const list = [...candidates];
  const concurrency = 40;
  let idx = 0;
  let found = null;

  async function worker() {
    while (!found && idx < list.length) {
      const i = idx++;
      const host = list[i];
      const hit = await probeDiscover(`http://${host}:${httpPort}`, 600);
      if (hit) found = hit;
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return found;
}

/**
 * Resolve Forever LAN host URL for a friend agent.
 * @param {{ hostUrl?: string, httpPort?: number }} party
 */
export async function resolveHostUrl(party = {}) {
  const port = validHttpPort(party.httpPort) ?? 8765;
  if (party.hostUrl) {
    const hit = await probeDiscover(party.hostUrl, 1500);
    if (hit) return hit;
  }
  const beacon = await listenForBeacon(4500);
  if (beacon) {
    const hit = await probeDiscover(beacon, 1500);
    if (hit) return hit;
  }
  return scanLanForHost(port);
}
