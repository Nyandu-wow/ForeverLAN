import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../collector/config.js";
import { SimulatorEngine } from "./engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig();
const port = Number(process.env.FOREVERLAN_SIM_PORT || 8766);
const hostUrl = process.env.FOREVERLAN_HOST_URL || config.hostUrl || "http://127.0.0.1:8765";

const engine = new SimulatorEngine({ hostUrl });

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    return res.end();
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/control")) {
    const html = fs.readFileSync(path.join(__dirname, "public", "control.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(html);
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    return sendJson(res, 200, engine.getState());
  }

  if (req.method === "POST" && url.pathname === "/api/start") {
    try {
      const body = await readBody(req);
      await engine.start(body.scenarioId);
      return sendJson(res, 200, engine.getState());
    } catch (err) {
      return sendJson(res, 400, { error: String(err.message || err) });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/pause") {
    engine.pause();
    return sendJson(res, 200, engine.getState());
  }

  if (req.method === "POST" && url.pathname === "/api/resume") {
    engine.resume();
    return sendJson(res, 200, engine.getState());
  }

  if (req.method === "POST" && url.pathname === "/api/reset") {
    engine.reset();
    return sendJson(res, 200, engine.getState());
  }

  if (req.method === "POST" && url.pathname === "/api/speed") {
    try {
      const body = await readBody(req);
      engine.setSpeed(body.intervalMs);
      return sendJson(res, 200, engine.getState());
    } catch (err) {
      return sendJson(res, 400, { error: String(err.message || err) });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/trigger") {
    try {
      const body = await readBody(req);
      const event = await engine.triggerManual(body.type, body.overrides || {});
      return sendJson(res, 200, { ok: true, event, state: engine.getState() });
    } catch (err) {
      return sendJson(res, 400, { error: String(err.message || err), state: engine.getState() });
    }
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[simulator] control UI: http://127.0.0.1:${port}/`);
  console.log(`[simulator] posts normalized events → ${hostUrl}/events`);
  console.log(`[simulator] watch stream UI: ${hostUrl}/`);
});
