/**
 * Config-driven adapter. Everything in crawler/config/sources.json → `feeds`
 * is fetched here, so a new source can be added without writing code:
 *
 *   { "id": "nfsu-notices", "label": "NFSU Notices", "kind": "html",
 *     "url": "https://nfsu.ac.in/notices", "country": "India" }
 *
 * `kind: "rss"`  → parsed as RSS/Atom.
 * `kind: "html"` → shallow link harvest, keyword filtered. Deliberately
 * conservative: it only keeps links whose anchor text reads like an event.
 */
import { getText, parseFeed, stripHTML, absoluteURL, matchAll, summarize, toISO } from "../lib/core.mjs";

export const meta = {
  id: "feeds",
  label: "Configured feeds",
  homepage: "",
  kind: "config",
  produces: "mixed",
};

const EVENT_WORDS = [
  "hackathon", "capture the flag", "ctf", "challenge", "competition", "contest",
  "ideathon", "makeathon", "datathon", "kushti", "kavach", "quiz", "bounty",
  "registration open", "apply now", "call for", "grand finale", "olympiad",
];

export async function fetchEvents({ feeds = [], maxPerSource = 40 } = {}) {
  const out = [];
  const errors = [];

  for (const feed of feeds) {
    try {
      const html = await getText(feed.url, { soft: true, retries: 1 });
      if (!html) { errors.push(`${feed.id}: unreachable`); continue; }

      const rows =
        feed.kind === "rss" || /<rss|<feed\b|<item\b/i.test(html.slice(0, 2000))
          ? fromFeed(html, feed)
          : fromHTML(html, feed);

      out.push(...rows.slice(0, maxPerSource));
    } catch (err) {
      errors.push(`${feed.id}: ${err.message}`);
    }
  }

  if (!out.length && errors.length) throw new Error(errors.slice(0, 4).join(" | "));
  return out;
}

function fromFeed(xml, feed) {
  return parseFeed(xml)
    .filter((item) => looksLikeEvent(`${item.title} ${item.description}`))
    .map((item) => base(feed, {
      title: item.title,
      description: item.description,
      url: absoluteURL(item.link, feed.url),
      startsAt: toISO(item.date),
    }));
}

function fromHTML(html, feed) {
  const seen = new Set();
  const rows = [];

  for (const m of matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,400}?)<\/a>/gi, html)) {
    const text = stripHTML(m[2]).replace(/\s+/g, " ").trim();
    if (text.length < 10 || text.length > 180) continue;
    if (!looksLikeEvent(text)) continue;

    const url = absoluteURL(m[1], feed.url);
    if (!url || seen.has(url) || /\.(pdf|jpe?g|png|zip|docx?)$/i.test(url)) continue;
    seen.add(url);

    rows.push(base(feed, {
      title: text,
      description: nearbyText(html, m.index),
      url,
      startsAt: toISO(findDate(text) || findDate(nearbyText(html, m.index))),
    }));
  }
  return rows;
}

/** Give the classifier a little surrounding context from the listing page. */
function nearbyText(html, index) {
  return summarize(stripHTML(html.slice(Math.max(0, index - 200), index + 500)), 320);
}

function looksLikeEvent(text) {
  const hay = text.toLowerCase();
  return EVENT_WORDS.some((w) => hay.includes(w));
}

function findDate(text = "") {
  const m =
    text.match(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\,?\s+20\d{2}\b/i) ||
    text.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}\,?\s+20\d{2}\b/i) ||
    text.match(/\b20\d{2}-\d{2}-\d{2}\b/);
  return m ? m[0] : null;
}

function base(feed, fields) {
  return {
    sourceId: `${feed.id}-${fields.url || fields.title}`,
    type: feed.type || "",
    organizer: feed.label,
    endsAt: null,
    image: "",
    rules: feed.note ? [feed.note] : [],
    location: feed.country ? { text: feed.country, country: feed.country } : { text: "" },
    tags: [feed.label, feed.country].filter(Boolean),
    ...fields,
    sourceUrl: fields.url || feed.url,
  };
}
