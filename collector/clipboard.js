import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PREFIX = "FOREVERLAN_CLIP|";

/**
 * Read Windows clipboard text via PowerShell (no native deps).
 */
export async function readClipboardText() {
  const script =
    "Add-Type -AssemblyName System.Windows.Forms; " +
    "[System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::UnicodeText)";
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, maxBuffer: 1024 * 1024 }
    );
    return stdout.replace(/^\uFEFF/, "").replace(/\r?\n$/, "");
  } catch {
    return "";
  }
}

export function parseClipboardPayload(text) {
  if (!text || !text.startsWith(PREFIX)) return [];
  const jsonPart = text.slice(PREFIX.length);
  let parsed;
  try {
    parsed = JSON.parse(jsonPart);
  } catch {
    return [];
  }
  if (!parsed || !Array.isArray(parsed.events)) return [];
  return parsed.events
    .filter((e) => e && e.id && e.type)
    .map((e) => ({
      ...e,
      source: e.source || "addon",
    }));
}
