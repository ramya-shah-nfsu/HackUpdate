/**
 * Shared low-level helpers for the HackUpdate crawler.
 * Zero dependencies: Node 20+ built-ins only.
 */

export const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/124.0 Safari/537.36 NFSU-HackUpdate/1.0 (+https://github.com/ramya-shah-nfsu/hackupdate)";

const DEFAULT_TIMEOUT = 25000;

/** Sleep helper used by the retry loop. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch() with a timeout, browser-ish headers and exponential-backoff retries.
 * Never throws for a caller that passes `soft: true`; returns null instead.
 */
export async function request(url, opts = {}) {
  const {
    method = "GET",
    headers = {},
    body = null,
    timeout = DEFAULT_TIMEOUT,
    retries = 2,
    soft = false,
  } = opts;

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    try {
      const res = await fetch(url, {
        method,
        body,
        redirect: "follow",
        headers: {
          "user-agent": UA,
          accept: "text/html,application/json,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-IN,en;q=0.9",
          ...headers,
        },
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} ${res.statusText}`);
        // 4xx other than 429 will not get better on a retry.
        if (res.status !== 429 && res.status >= 400 && res.status < 500) break;
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
    }
  }
  if (soft) return null;
  throw lastErr ?? new Error(`request failed: ${url}`);
}

export async function getJSON(url, opts = {}) {
  const res = await request(url, {
    ...opts,
    headers: { accept: "application/json, text/plain, */*", ...(opts.headers || {}) },
  });
  if (!res) return null;
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`response was not JSON (first 120 chars: ${text.slice(0, 120)})`);
  }
}

export async function getText(url, opts = {}) {
  const res = await request(url, opts);
  return res ? await res.text() : null;
}

/* ------------------------------------------------------------------ */
/* Tiny HTML / XML helpers. Deliberately regex based so the crawler    */
/* keeps its zero-dependency promise. Only used for shallow scraping.  */
/* ------------------------------------------------------------------ */

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  hellip: "…", ndash: "-", mdash: ": ", rupee: "₹",
};

export function decodeEntities(input = "") {
  return String(input)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

function safeChar(code) {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}

/** Strip tags, decode entities, collapse whitespace. */
export function stripHTML(html = "") {
  return decodeEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/** Pull the inner text of every `<tag ...>...</tag>` occurrence. */
export function matchAll(re, input) {
  const out = [];
  let m;
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  while ((m = rx.exec(input)) !== null) {
    out.push(m);
    if (m.index === rx.lastIndex) rx.lastIndex++;
  }
  return out;
}

/** Extract every <item>/<entry> block from an RSS or Atom feed. */
export function parseFeed(xml = "") {
  const blocks = matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi, xml).map((m) => m[0]);
  return blocks.map((block) => ({
    title: stripHTML(tag(block, "title")),
    link: feedLink(block),
    description: stripHTML(tag(block, "description") || tag(block, "summary") || tag(block, "content")),
    date:
      tag(block, "pubDate") || tag(block, "published") || tag(block, "updated") ||
      tag(block, "dc:date") || "",
    raw: block,
  }));
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return "";
  return m[1].replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "").trim();
}

function feedLink(block) {
  const plain = tag(block, "link");
  if (plain && /^https?:/i.test(plain.trim())) return plain.trim();
  const href = block.match(/<link\b[^>]*href=["']([^"']+)["']/i);
  if (href) return href[1];
  const guid = tag(block, "guid");
  return /^https?:/i.test(guid) ? guid : "";
}

/** Resolve a possibly-relative URL against a base. Returns "" when hopeless. */
export function absoluteURL(href, base) {
  if (!href) return "";
  try {
    return new URL(href, base).toString();
  } catch {
    return "";
  }
}

/** Shorten free text to a sentence-ish blurb of at most `max` characters. */
export function summarize(text = "", max = 320) {
  const clean = stripHTML(text).replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (stop > max * 0.5 ? cut.slice(0, stop + 1) : cut.replace(/\s\S*$/, "")) + "…";
}

/** Best-effort date parse. Returns an ISO string or null, never NaN. */
export function toISO(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(+value) ? null : value.toISOString();
  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(+d) ? null : d.toISOString();
  }
  const s = String(value).trim();
  if (!s) return null;
  // Bare "2026-03-14" is parsed as UTC midnight by Date, which is what we want.
  let d = new Date(s);
  if (!Number.isNaN(+d)) return d.toISOString();
  // "14 March 2026" / "14 Mar 2026" / "March 14, 2026"
  d = new Date(s.replace(/(\d+)(st|nd|rd|th)/gi, "$1"));
  if (!Number.isNaN(+d)) return d.toISOString();
  return null;
}

/**
 * Pull a ministry or department name out of free text.
 *
 * Names are Title Case joined by lowercase connectives ("Ministry of Home
 * Affairs", "Department of Atomic Energy"), so the match stops at the first
 * word that is neither capitalised nor a connective. Without that stop the
 * pattern runs on into the sentence that follows the name.
 */
/**
 * Parse a day-first date, the convention on Indian government sites.
 *
 * This cannot be left to Date: "21/08/2026" is read as month 21 and returns
 * Invalid Date, while "05/08/2026" silently parses as 8 May instead of 5 August,
 * which is worse than failing. Returns an ISO string or null.
 */
export function parseDMY(value) {
  const m = String(value || "").trim().match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  // Reject a rolled-over date such as 31/02/2026.
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString();
}

/** "21/08/2026 - 15/10/2026" into its two ends; either may be null. */
export function parseDMYRange(value) {
  const parts = String(value || "").split(/\s*(?:-|–|—|to)\s*/i).filter(Boolean);
  const from = parseDMY(parts[0]);
  const to = parts.length > 1 ? parseDMY(parts[1]) : null;
  return { from, to };
}

export function extractMinistry(text = "") {
  const m = stripHTML(text).match(
    /\b(?:Ministry|Department)\s+of\s+(?:[A-Z][A-Za-z&.]*|and|of|the)(?:\s+(?:[A-Z][A-Za-z&.]*|and|of|the))*/
  );
  if (!m) return "";
  // A trailing connective belongs to the next clause, not to the name.
  return m[0].replace(/\s+(?:and|of|the)$/i, "").replace(/\s+/g, " ").trim().slice(0, 90);
}

export const log = {
  info: (...a) => console.log("  ", ...a),
  step: (...a) => console.log("\n▶", ...a),
  ok: (...a) => console.log("   ✓", ...a),
  warn: (...a) => console.warn("   !", ...a),
  fail: (...a) => console.error("   ✗", ...a),
};
