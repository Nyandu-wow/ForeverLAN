/**
 * Wall-clock stamps for console / agent.log / ingest.log.
 * Display only — event payload times stay ISO UTC (ev.ts, host_received_at, …).
 *
 * Default zone: FOREVERLAN_TZ → config.displayTimeZone → host TZ → Europe/Amsterdam.
 */
export function displayTimeZone(explicit) {
  return (
    explicit ||
    process.env.FOREVERLAN_TZ ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "Europe/Amsterdam"
  );
}

/** `YYYY-MM-DD HH:mm:ss` in the display timezone (never UTC via toISOString). */
export function stampNow(explicitTz) {
  const timeZone = displayTimeZone(explicitTz);
  try {
    return new Date().toLocaleString("sv-SE", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    // Machine-local wall clock if the zone id is unknown.
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
}
