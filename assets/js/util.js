/**
 * Small helpers shared by the portal.
 *
 * SECURITY NOTE: everything in data/events.json originates from third-party
 * websites. Titles, descriptions and URLs are untrusted input. Nothing from the
 * data file may be written into innerHTML without passing through escapeHTML(),
 * and no URL may reach the DOM without passing through safeURL().
 */

/** Escape the five characters that matter inside HTML text and attributes. */
export function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Allow only absolute http(s) URLs. Blocks javascript:, data:, vbscript:. */
export function safeURL(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value), window.location.href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

/** Same, but images must be https so the page never drops to mixed content. */
export function safeImage(value) {
  const url = safeURL(value);
  return url.startsWith("https://") ? url : "";
}

/* --------------------------------- dates --------------------------------- */

const DATE_FMT = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const TIME_FMT = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });

export const parseDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(+d) ? null : d;
};

export function formatDate(value) {
  const d = parseDate(value);
  return d ? DATE_FMT.format(d) : "Date to be announced";
}

export function formatDateTime(value) {
  const d = parseDate(value);
  return d ? `${DATE_FMT.format(d)}, ${TIME_FMT.format(d)}` : "To be announced";
}

/** "12 Mar - 14 Mar 2026", collapsing a same-day range. */
export function formatRange(start, end) {
  const a = parseDate(start);
  const b = parseDate(end);
  if (!a) return "Dates to be announced";
  if (!b || a.toDateString() === b.toDateString()) return DATE_FMT.format(a);
  return `${DATE_FMT.format(a)} to ${DATE_FMT.format(b)}`;
}

/** "in 12 days" / "in 3 hours" / "4 days ago". */
export function relativeTime(value, now = new Date()) {
  const d = parseDate(value);
  if (!d) return "";
  const diffMs = +d - +now;
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units = [
    ["year", 31536e6], ["month", 2592e6], ["week", 6048e5],
    ["day", 864e5], ["hour", 36e5], ["minute", 6e4],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === "minute") return rtf.format(Math.round(diffMs / ms), unit);
  }
  return "";
}

/** Days remaining, floored at 0. Used for the urgency ring on a card. */
export function daysUntil(value, now = new Date()) {
  const d = parseDate(value);
  if (!d) return null;
  return Math.ceil((+d - +now) / 864e5);
}

/* ------------------------------ calendar (.ics) --------------------------- */

const icsEscape = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/[;,]/g, (m) => "\\" + m).replace(/\r?\n/g, "\\n");
const icsStamp = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/**
 * Build an RFC 5545 VEVENT for one event. Folding is skipped: lines stay short
 * because we truncate the description, and every calendar client we care about
 * tolerates long lines.
 */
export function buildICS(event) {
  const start = parseDate(event.startsAt);
  if (!start) return null;
  const end = parseDate(event.endsAt) || new Date(+start + 36e5 * 2);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NFSU//HackUpdate//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${icsEscape(event.id)}@hackupdate.nfsu`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEscape(event.title)}`,
    `DESCRIPTION:${icsEscape([event.description, event.url].filter(Boolean).join("\n\n").slice(0, 900))}`,
    `LOCATION:${icsEscape(event.location?.text || (event.location?.mode === "online" ? "Online" : ""))}`,
  ];
  const url = safeURL(event.url);
  if (url) lines.push(`URL:${url}`);
  if (event.registration?.closesAt) {
    const mins = Math.round((+start - +parseDate(event.registration.closesAt)) / 6e4);
    if (mins > 0) lines.push("BEGIN:VALARM", `TRIGGER:-PT${mins}M`, "ACTION:DISPLAY", "DESCRIPTION:Registration closes", "END:VALARM");
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

export function downloadICS(event) {
  const ics = buildICS(event);
  if (!ics) return false;
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${slug(event.title)}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}

export const slug = (s) =>
  String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "event";

/* ------------------------------- misc UI ---------------------------------- */

/** Deterministic 0-359 hue from a string, so a card's fallback art is stable. */
export function hueFor(text) {
  let h = 0;
  for (let i = 0; i < String(text).length; i++) h = (h * 31 + String(text).charCodeAt(i)) % 360;
  return h;
}

export function initials(title) {
  const words = String(title).replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/);
  return (words.slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();
}

export function debounce(fn, ms = 180) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Local-storage access that never throws in private mode. */
export const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  },
};
