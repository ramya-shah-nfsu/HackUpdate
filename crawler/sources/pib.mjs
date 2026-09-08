/**
 * Press Information Bureau (pib.gov.in): Government of India press releases.
 * This is where government-run challenges such as Cyber Kushti, Kavach and the
 * Smart India Hackathon are announced before they reach any listing platform.
 *
 * PIB has no API. We read its RSS feeds for the relevant ministries and fall
 * back to the "All Releases" listing page, then keyword-filter the results.
 */
import { getText, parseFeed, stripHTML, absoluteURL, summarize, matchAll, extractMinistry } from "../lib/core.mjs";

export const meta = {
  id: "pib",
  label: "PIB (Govt. of India)",
  homepage: "https://www.pib.gov.in/",
  kind: "rss+html",
  produces: "hackathon",
  country: "India",
};

// RegId maps to a ministry/region on PIB's RSS handler; Lang=1 is English.
const FEEDS = [
  { name: "All India (English)", url: "https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3" },
  { name: "MeitY / Electronics & IT", url: "https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3&PRID=0" },
  { name: "PIB English releases", url: "https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3" },
];

const LISTING = "https://www.pib.gov.in/allRel.aspx";

/** A PIB release is only interesting if it announces a competitive event. */
const MUST_MATCH = [
  "hackathon", "capture the flag", "ctf", "cyber kushti", "kushti",
  "challenge", "competition", "grand challenge", "ideathon", "innovation contest",
  "kavach", "smart india hackathon", "cyber suraksha", "quiz",
];
const CONTEXT = [
  "cyber", "security", "forensic", "drone", "uav", "iot", "artificial intelligence",
  "ai", "digital", "technology", "innovation", "startup", "students", "police",
  "defence", "defense", "critical infrastructure", "data protection",
];

export async function fetchEvents() {
  const candidates = [];
  const errors = [];

  for (const feed of FEEDS) {
    try {
      const xml = await getText(feed.url, { soft: true, retries: 1 });
      if (!xml || !/<(item|entry)\b/i.test(xml)) continue;
      for (const item of parseFeed(xml)) {
        candidates.push({
          title: item.title,
          description: item.description,
          url: absoluteURL(item.link, "https://www.pib.gov.in/"),
          date: item.date,
          via: `PIB RSS: ${feed.name}`,
        });
      }
    } catch (err) {
      errors.push(`${feed.name}: ${err.message}`);
    }
  }

  // Fallback: scrape the releases listing when RSS gives us nothing.
  if (!candidates.length) {
    try {
      const html = await getText(LISTING, { soft: true, retries: 1 });
      if (html) {
        for (const m of matchAll(/<a\b[^>]*href=["']([^"']*PressRelease[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, html)) {
          const title = stripHTML(m[2]);
          if (title.length < 15) continue;
          candidates.push({
            title,
            description: "",
            url: absoluteURL(m[1], LISTING),
            date: "",
            via: "PIB all-releases listing",
          });
        }
      }
    } catch (err) {
      errors.push(`listing: ${err.message}`);
    }
  }

  const relevant = candidates.filter(isRelevant);
  if (!relevant.length && errors.length) throw new Error(errors.slice(0, 2).join(" | "));

  // Enrich the top hits by reading the release body for dates and detail.
  const enriched = [];
  for (const c of relevant.slice(0, 25)) {
    enriched.push(await toEvent(c));
  }
  return enriched;
}

function isRelevant(c) {
  const hay = `${c.title} ${c.description}`.toLowerCase();
  return MUST_MATCH.some((t) => hay.includes(t)) && CONTEXT.some((t) => hay.includes(t));
}

async function toEvent(c) {
  let body = c.description || "";
  let image = "";
  try {
    const html = await getText(c.url, { soft: true, retries: 1, timeout: 15000 });
    if (html) {
      const main = html.match(/<div[^>]*(?:id|class)=["'][^"']*(?:PdfDiv|innner-page-main-about-us-content|content-area)[^"']*["'][\s\S]*?<\/div>/i);
      body = stripHTML(main ? main[0] : html).slice(0, 3000) || body;
      const img = html.match(/<img\b[^>]*src=["']([^"']+\.(?:jpe?g|png|webp))["']/i);
      if (img) image = absoluteURL(img[1], c.url);
    }
  } catch { /* the RSS summary is good enough */ }

  return {
    sourceId: `pib-${c.url}`,
    type: /capture the flag|\bctf\b|kushti/i.test(`${c.title} ${body}`) ? "ctf" : "hackathon",
    title: c.title,
    description: summarize(body, 700),
    url: c.url,
    sourceUrl: c.url,
    image,
    organizer: extractMinistry(body) || "Government of India",
    rules: [
      "Announced via a Press Information Bureau release; confirm the current rules on the official portal linked above.",
    ],
    startsAt: extractDate(body) || c.date || null,
    endsAt: null,
    location: { text: "India", country: "India" },
    tags: ["PIB", "Government of India", c.via],
  };
}

/** Find the first "12 March 2026"-ish date inside a release body. */
function extractDate(text = "") {
  const m = text.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\,?\s+(20\d{2})\b/i
  );
  if (!m) return null;
  const d = new Date(`${m[2]} ${m[1]}, ${m[3]}`);
  return Number.isNaN(+d) ? null : d.toISOString();
}
