import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Exactly one process may own a given lock file (collector outbox or friend agent).
 * Prevents rewrite races / duplicate POST storms when Startup + manual start overlap.
 */
function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Live owner = pid alive AND lock written since this boot. Windows shutdown / taskkill /F skip
 * exit handlers, and the next boot can reuse that pid for Discord/Steam — never trust it.
 */
function lockOwnerAlive(lock) {
  if (!lock?.pid || !pidAlive(lock.pid)) return false;
  const started = Date.parse(lock.started_at || "");
  if (!Number.isFinite(started)) return true;
  const bootAt = Date.now() - os.uptime() * 1000;
  return started >= bootAt - 60_000;
}

function readLock(lockPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    return { pid: Number(raw.pid), started_at: raw.started_at || null };
  } catch {
    try {
      const pid = Number(String(fs.readFileSync(lockPath, "utf8")).trim());
      return { pid, started_at: null };
    } catch {
      return null;
    }
  }
}

/**
 * @param {string} lockPath
 * @param {{ log?: (...args: any[]) => void, label?: string }} [opts]
 * @returns {{ ok: true, release: () => void } | { ok: false, reason: string, pid?: number }}
 */
export function acquirePidLock(lockPath, opts = {}) {
  const log = opts.log || (() => {});
  const label = opts.label || "process";
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  const payload = `${JSON.stringify({
    pid: process.pid,
    started_at: new Date().toISOString(),
  })}\n`;

  function tryCreate() {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(fd, payload, "utf8");
      return fd;
    } catch (err) {
      if (err && err.code === "EEXIST") return null;
      throw err;
    }
  }

  let fd = tryCreate();
  if (!fd) {
    const existing = readLock(lockPath);
    if (existing?.pid === process.pid && lockOwnerAlive(existing)) {
      return { ok: false, reason: "already_held_by_self", pid: existing.pid };
    }
    if (lockOwnerAlive(existing)) {
      return {
        ok: false,
        reason: label === "collector" ? "another_collector_running" : "another_running",
        pid: existing.pid,
      };
    }
    // Stale lock (crash / kill -9) — take over.
    try {
      fs.unlinkSync(lockPath);
      log(`[${label}] cleared stale lock (old pid=${existing?.pid || "?"})`);
    } catch {
      /* race with another starter */
    }
    fd = tryCreate();
    if (!fd) {
      const again = readLock(lockPath);
      if (again?.pid === process.pid) {
        return { ok: false, reason: "already_held_by_self", pid: again.pid };
      }
      return {
        ok: false,
        reason: label === "collector" ? "another_collector_running" : "another_running",
        pid: again?.pid,
      };
    }
  }

  const release = () => {
    try {
      fs.closeSync(fd);
    } catch {
      /* ignore */
    }
    try {
      const cur = readLock(lockPath);
      if (!cur || cur.pid === process.pid) fs.unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  };

  process.once("exit", release);
  process.once("SIGINT", () => {
    release();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    release();
    process.exit(0);
  });

  return { ok: true, release };
}

/** @deprecated use acquirePidLock — kept for collector call sites */
export function acquireCollectorLock(lockPath, opts = {}) {
  const log = opts.log || (() => {});
  return acquirePidLock(lockPath, {
    ...opts,
    label: "collector",
    log: (...args) => log(...args),
  });
}

/** True if a live process already holds the lock for this path. */
export function isPidLockHeld(lockPath) {
  if (!fs.existsSync(lockPath)) return false;
  return lockOwnerAlive(readLock(lockPath));
}

/** @deprecated use isPidLockHeld */
export function isCollectorLockHeld(lockPath) {
  return isPidLockHeld(lockPath);
}
