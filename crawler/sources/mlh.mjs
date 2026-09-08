/**
 * Major League Hacking, the international student hackathon league.
 *
 * MLH moved from mlh.io to www.mlh.com and now renders Tailwind cards. Written
 * against the markup the site actually serves (probed 2026-09-08):
 *
 *   <div class="rounded-card …">
 *     <img src="https://mlhusercontent.com/backgrounds/events/<uuid>/<slug>…">
 *     <img src="https://mlhusercontent.com/logos/events/<uuid>/<slug>…">
 *     <h4 class="font-bold …">Global Hack Week: Data</h4>
 *     <span class="text-sm truncate">SEP 11 - 17</span>        ← dates
 *     <span class="text-sm truncate">Everywhere, Worldwide</span> ← location
 *
 * A season runs August to July, so the page year alone does not date an event;
 * see seasonYear() below.
 */
import { getText, stripHTML, absoluteURL, matchAll } from "../lib/core.mjs";

export const meta = {
  id: "mlh",
  label: "Major League Hacking",
  homepage: "https://www.mlh.com/seasons",
  kind: "html",
  produces: "hackathon",
};

export async function fetchEvents() {
  const year = new Date().getFullYear();
  const urls = [
    `https://www.mlh.com/seasons/${year}/events`,
    `https://www.mlh.com/seasons/${year + 1}/events`,
  ];

  const out = [];
  const errors = [];
  const seen = new Set();

  for (const url of urls) {
    const season = Number(url.match(/seasons\/(\d{4})/)[1]);
    try {
      const html = await getText(url, { soft: true });
      if (!html) { errors.push(`${url}: unreachable`); continue; }
      for (const event of parseSeason(html, url, season)) {
        const key = event.title + "|" + (event.startsAt || "");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(event);
      }
    } catch (err) {
      errors.push(`${url}: ${err.message}`);
    }
  }
  if (!out.length && errors.length) throw new Error(errors.join(" | "));
  return out;
}

function parseSeason(html, baseUrl, season) {
  const starts = matchAll(/<div[^>]*class=["'][^"']*\brounded-card\b[^"']*["'][^>]*>/gi, html)
    .map((m) => m.index);

  return starts
    .map((start, i) => {
      // A card is everything up to the next card, capped so one broken wrapper
      // cannot swallow the whole page.
      const block = html.slice(start, Math.min(starts[i + 1] ?? html.length, start + 6000));
      const title = stripHTML((block.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i) || [])[1] || "");
      if (!title || title.length > 140) return null;

      // Two info rows in order: dates, then location.
      const rows = matchAll(/<span[^>]*class=["'][^"']*\btruncate\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, block)
        .map((m) => stripHTML(m[1]))
        .filter(Boolean);
      const dateText = rows[0] || "";
      const place = rows[1] || "";

      const image =
        (block.match(/<img[^>]+src=["'](https:\/\/mlhusercontent\.com\/backgrounds\/[^"']+)["']/i) || [])[1] ||
        (block.match(/<img[^>]+src=["'](https:\/\/mlhusercontent\.com\/logos\/[^"']+)["']/i) || [])[1] ||
        "";

      // The card is wrapped by its link, so look just behind the wrapper too.
      const around = html.slice(Math.max(0, start - 900), start) + block;
      const href = (around.match(/href=["'](https?:\/\/(?!www\.mlh\.com\/(?:privacy|terms))[^"']+)["']/i) || [])[1] || "";

      const { startsAt, endsAt } = parseDateRange(dateText, season);
      const online = /everywhere|worldwide|online|digital|virtual/i.test(place);

      return {
        sourceId: `mlh-${title}-${startsAt || season}`,
        type: "hackathon",
        title,
        description: [
          "An official Major League Hacking member event.",
          dateText ? `Listed as running ${dateText}.` : "",
          place ? `Location: ${place}.` : "",
        ].filter(Boolean).join(" "),
        url: absoluteURL(href, baseUrl),
        sourceUrl: baseUrl,
        image,
        organizer: "Major League Hacking (MLH)",
        rules: [
          "Governed by the MLH Code of Conduct and the MLH rules for member events.",
          "Open to students; check the event's own site for age and enrolment limits.",
        ],
        startsAt,
        endsAt,
        location: {
          text: place,
          country: online ? "" : countryFrom(place),
          mode: online ? "online" : "onsite",
        },
        tags: ["MLH", "Student hackathon", `Season ${season}`],
      };
    })
    .filter(Boolean);
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/**
 * MLH prints "SEP 11 - 17", "SEP 26 - OCT 2" or "SEP 11", with no year.
 * A season labelled N runs August of N-1 through July of N, which is what
 * turns a bare month into a real date.
 */
function parseDateRange(text, season) {
  const clean = String(text).trim().toUpperCase();
  if (!clean) return { startsAt: null, endsAt: null };

  const m = clean.match(/^([A-Z]{3})[A-Z]*\s+(\d{1,2})(?:\s*[-–—]\s*(?:([A-Z]{3})[A-Z]*\s+)?(\d{1,2}))?$/);
  if (!m) return { startsAt: null, endsAt: null };

  const [, m1, d1, m2, d2] = m;
  const start = build(m1, d1, season);
  if (!start) return { startsAt: null, endsAt: null };

  let end = null;
  if (d2) {
    end = build(m2 || m1, d2, season);
    // "DEC 28 - JAN 3" crosses the new year.
    if (end && end < start) end = build(m2 || m1, d2, season, 1);
  }
  return { startsAt: start.toISOString(), endsAt: (end || start).toISOString() };
}

function build(mon, day, season, bump = 0) {
  const month = MONTHS[String(mon).slice(0, 3).toLowerCase()];
  if (month === undefined) return null;
  // August to December belong to the first calendar year of the season.
  const year = (month >= 7 ? season - 1 : season) + bump;
  const d = new Date(Date.UTC(year, month, Number(day)));
  return Number.isNaN(+d) ? null : d;
}

/** Last comma-separated part of "Rice University, Houston, TX, United States". */
function countryFrom(place) {
  const parts = String(place).split(",").map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1] || "";
  return last.length > 3 ? last : "";
}
