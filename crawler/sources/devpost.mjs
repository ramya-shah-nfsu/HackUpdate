/**
 * Devpost: the largest international hackathon listing, with a public
 * JSON endpoint behind its own search page. Queried once per keyword so the
 * results skew to NFSU's domains rather than to generic app-building events.
 */
import { getJSON, stripHTML } from "../lib/core.mjs";

export const meta = {
  id: "devpost",
  label: "Devpost",
  homepage: "https://devpost.com/hackathons",
  kind: "api",
  produces: "hackathon",
};

const QUERIES = [
  "cybersecurity", "security", "digital forensics", "privacy",
  "drone", "iot", "artificial intelligence", "blockchain security",
];

export async function fetchEvents({ perQuery = 2 } = {}) {
  const seen = new Set();
  const out = [];
  const errors = [];

  for (const q of QUERIES) {
    for (let page = 1; page <= perQuery; page++) {
      const url =
        `https://devpost.com/api/hackathons?search=${encodeURIComponent(q)}` +
        `&status[]=upcoming&status[]=open&order_by=deadline&page=${page}`;
      try {
        const data = await getJSON(url);
        const rows = data?.hackathons || data?.data || [];
        if (!rows.length) break;
        for (const h of rows) {
          const key = h.url || h.id;
          if (!key || seen.has(key)) continue;
          seen.add(key);
          out.push(mapHackathon(h));
        }
      } catch (err) {
        errors.push(`${q} p${page}: ${err.message}`);
      }
    }
  }
  if (!out.length && errors.length) throw new Error(errors.slice(0, 3).join(" | "));
  return out;
}

function mapHackathon(h) {
  // submission_period_dates looks like "Mar 02 - Apr 14, 2026".
  const { startsAt, endsAt } = parsePeriod(h.submission_period_dates || "");
  const rules = [];
  if (h.eligibility_requirement_invite_only_description) {
    rules.push(stripHTML(h.eligibility_requirement_invite_only_description));
  }
  if (h.invite_only) rules.push("Invite-only hackathon: an invitation from the organiser is required.");
  if (h.submission_period_dates) rules.push(`Submission window: ${h.submission_period_dates}`);
  if (h.time_left_to_submission) rules.push(`Time left to submit at crawl time: ${h.time_left_to_submission}`);

  return {
    sourceId: `devpost-${h.id ?? h.url}`,
    type: "hackathon",
    title: h.title,
    description: [h.tagline, (h.themes || []).map((t) => t.name).join(", ")].filter(Boolean).join(": "),
    url: h.url,
    sourceUrl: h.url,
    image: normalizeImage(h.thumbnail_url),
    organizer: h.organization_name || "",
    prize: stripHTML(h.prize_amount || ""),
    eligibility: stripHTML(h.eligibility_requirement_invite_only_description || ""),
    rules,
    startsAt,
    endsAt,
    participants: Number.isFinite(h.registrations_count) ? h.registrations_count : null,
    location: {
      text: h.displayed_location?.location || "",
      mode: /online/i.test(h.displayed_location?.location || "") ? "online" : "",
    },
    tags: ["Devpost", ...(h.themes || []).map((t) => t.name)].filter(Boolean),
  };
}

/** Devpost thumbnails come back protocol-relative ("//challengepost..."). */
function normalizeImage(src) {
  if (!src) return "";
  return src.startsWith("//") ? `https:${src}` : src;
}

function parsePeriod(text) {
  const clean = stripHTML(text).replace(/\s+/g, " ").trim();
  const year = (clean.match(/\b(20\d{2})\b/) || [])[1] || new Date().getFullYear();
  const parts = clean.split(/\s+-\s+|\s+-\s+/);
  const toDate = (chunk) => {
    if (!chunk) return null;
    const withYear = /\b20\d{2}\b/.test(chunk) ? chunk : `${chunk.replace(/,$/, "")}, ${year}`;
    const d = new Date(withYear);
    return Number.isNaN(+d) ? null : d.toISOString();
  };
  return { startsAt: toDate(parts[0]), endsAt: toDate(parts[1]) || toDate(parts[0]) };
}
