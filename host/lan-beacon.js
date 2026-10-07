import dgram from "node:dgram";
import os from "node:os";

import { stampNow } from "../collector/wall-clock.js";

const BEACON_PORT = 8766;
const BEACON_MAGIC = "FOREVERLAN";

/**
 * Advertise the host on the LAN so friend agents can find :httpPort without typing an IP.
 * Token is NOT broadcast — it stays in the friend pack the host prepares.
 */
export function startLanBeacon({ httpPort, name, sessionId }) {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  let timer = null;

  const payload = () =>
    Buffer.from(
      `${BEACON_MAGIC}${JSON.stringify({
        v: 1,
        service: "foreverlan",
        httpPort: Number(httpPort),
        name: name || "Forever LAN",
        session_id: sessionId || null,
      })}`,
      "utf8"
    );

  socket.on("error", (err) => {
    console.warn(`[${stampNow()}] [host] LAN beacon error:`, err.message);
  });

  socket.bind(0, () => {
    try {
      socket.setBroadcast(true);
    } catch {
      /* ignore */
    }
    const send = () => {
      const buf = payload();
      socket.send(buf, 0, buf.length, BEACON_PORT, "255.255.255.255", () => {});
      // Also hit common subnet broadcasts from local IPv4s
      for (const iface of Object.values(os.networkInterfaces() || {})) {
        for (const addr of iface || []) {
          if (addr.family !== "IPv4" || addr.internal) continue;
          const parts = addr.address.split(".").map(Number);
          if (parts.length !== 4) continue;
          const bcast = `${parts[0]}.${parts[1]}.${parts[2]}.255`;
          socket.send(buf, 0, buf.length, BEACON_PORT, bcast, () => {});
        }
      }
    };
    send();
    timer = setInterval(send, 3000);
    console.log(`[${stampNow()}] [host] LAN beacon:     UDP ${BEACON_PORT} (friend agents auto-discover)`);
  });

  return () => {
    if (timer) clearInterval(timer);
    try {
      socket.close();
    } catch {
      /* ignore */
    }
  };
}

export { BEACON_PORT, BEACON_MAGIC };
