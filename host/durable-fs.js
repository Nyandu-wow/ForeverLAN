/**
 * Durable host-disk writes (append + fsync, atomic replace).
 * Cache/state files and host-events.jsonl must survive crashes mid-write.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Append one complete line (caller supplies payload; newline is added).
 * Opens, writes, fsyncs, closes — slower than buffered append, safer on crash.
 * @param {string} filePath
 * @param {string} line  JSON (or other) text without trailing newline
 */
export function appendLineDurable(filePath, line) {
  const text = `${String(line)}\n`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const fd = fs.openSync(filePath, "a");
  try {
    fs.writeSync(fd, text, null, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Write `body` atomically: temp file in same dir → fsync → rename over target.
 * @param {string} filePath
 * @param {string} body
 */
export function writeFileAtomicDurable(filePath, body) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, body, null, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, filePath);
  } catch {
    // Windows: rename cannot replace an existing file.
    fs.copyFileSync(tmp, filePath);
    fs.unlinkSync(tmp);
  }
  // Best-effort: fsync the directory entry on platforms that allow it.
  try {
    const dirFd = fs.openSync(path.dirname(filePath), "r");
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    /* ignore — Windows often denies directory fsync */
  }
}
