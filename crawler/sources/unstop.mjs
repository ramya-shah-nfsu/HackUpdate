/**
 * Unstop (formerly Dare2Compete): the biggest Indian student competition
 * platform. Backs the "national hackathon" half of the portal.
 */
import { getJSON, stripHTML } from "../lib/core.mjs";

export const meta = {
  id: "unstop",
  label: "Unstop",
  homepage: "https://unstop.com/hackathons",
  kind: "api",
  produces: "hackathon",
  country: "India",
};

const CATEGORIES = ["hackathons", "competitions"];
const FILTERS = ["cyber-security", "coding", "engineering", "technology"];

export async function fetchEvents({ pages = 2, perPage = 30 } = {}) {
  const out = [];
  const seen = new Set();
  const errors = [];

  for (const opportunity of CATEGORIES) {
    for (let page = 1; page <= pages; page++) {
      const url =
        `https://unstop.com/api/public/opportunity/search-result` +
        `?opportunity=${opportunity}&page=${page}&per_page=${perPage}` +
        `&oppstatus=open&quickApply=true&filters=${FILTERS.join(",")}`;
      try {
        const data = await getJSON(url, { headers: { referer: "https://unstop.com/hackathons" } });
        const rows = data?.data?.data || data?.data || [];
        if (!Array.isArray(rows) || !rows.length) break;
        for (const row of rows) {
          const key = row.public_url || row.id;
          if (!key || seen.has(key)) continue;
          seen.add(key);
          out.push(mapOpportunity(row, opportunity));
        }
      } catch (err) {
        errors.push(`${opportunity} p${page}: ${err.message}`);
      }
    }
  }
  if (!out.length && errors.length) throw new Error(errors.slice(0, 3).join(" | "));
  return out;
}

function mapOpportunity(row, opportunity) {
  const url = row.public_url?.startsWith("http")
    ? row.public_url
    : `https://unstop.com/${String(row.public_url || "").replace(/^\/+/, "")}`;

  const rules = [];
  const reg = row.regnRequirements || {};
  if (reg.remain_days) rules.push(`Registration window closes in ${reg.remain_days} day(s) as of the last crawl.`);
  if (reg.max_team_size) {
    rules.push(`Team size: ${reg.min_team_size || 1} to ${reg.max_team_size} member(s).`);
  }
  if (row.eligibility_criteria) rules.push(stripHTML(row.eligibility_criteria));
  if (row.type) rules.push(`Opportunity type: ${row.type}`);

  return {
    sourceId: `unstop-${row.id ?? url}`,
    type: opportunity === "hackathons" ? "hackathon" : "",
    title: row.title,
    description: stripHTML(row.details || row.subtitle || row.seo_details || ""),
    url,
    sourceUrl: url,
    image: row.banner_mobile?.image_url || row.logoUrl2 || row.banner?.image_url || "",
    organizer: row.organisation?.name || row.organisation?.official_name || "",
    prize: row.prizes?.[0]?.cash ? `₹${row.prizes[0].cash}` : stripHTML(row.prize_details || ""),
    eligibility: stripHTML(row.eligibility_criteria || ""),
    rules,
    startsAt: row.start_date || reg.start_regn_dt || null,
    endsAt: row.end_date || null,
    registration: { opensAt: reg.start_regn_dt || null, closesAt: reg.end_regn_dt || null, url },
    participants: Number.isFinite(row.registerCount) ? row.registerCount : null,
    location: {
      text: row.region === "online" ? "Online (India)" : stripHTML(row.festival?.location || "India"),
      country: "India",
      mode: row.region === "online" ? "online" : "",
    },
    tags: ["Unstop", "India", ...(row.filters || []).map((f) => f.name).filter(Boolean)].slice(0, 10),
  };
}
