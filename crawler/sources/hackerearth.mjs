/**
 * HackerEarth: hosts a lot of Indian corporate hackathons and coding
 * challenges. Its browser-extension endpoint returns clean JSON.
 */
import { getJSON, stripHTML, absoluteURL } from "../lib/core.mjs";

export const meta = {
  id: "hackerearth",
  label: "HackerEarth",
  homepage: "https://www.hackerearth.com/challenges/hackathon/",
  kind: "api",
  produces: "hackathon",
  country: "India",
};

const ENDPOINTS = [
  "https://www.hackerearth.com/chrome-extension/events/",
  "https://www.hackerearth.com/chrome-extension/events/?type=hackathon",
];

export async function fetchEvents() {
  const seen = new Set();
  const out = [];
  const errors = [];

  for (const endpoint of ENDPOINTS) {
    try {
      const data = await getJSON(endpoint);
      const rows = Array.isArray(data) ? data : data?.response || data?.data || [];
      for (const row of rows) {
        const url = absoluteURL(row.url || row.challenge_url || "", "https://www.hackerearth.com");
        if (!url || seen.has(url)) continue;
        seen.add(url);
        out.push({
          sourceId: `hackerearth-${url}`,
          type: /hackathon/i.test(row.challenge_type || row.type || "") ? "hackathon" : "",
          title: row.title || row.challenge_name,
          description: stripHTML(row.description || row.short_description || ""),
          url,
          sourceUrl: url,
          image: row.image || row.cover_image || "",
          organizer: row.company_name || "HackerEarth",
          prize: stripHTML(row.prizes || ""),
          startsAt: row.start_tz || row.start_utc_tz || row.start_date || null,
          endsAt: row.end_tz || row.end_utc_tz || row.end_date || null,
          location: { text: row.location || "Online", country: "India" },
          tags: ["HackerEarth", row.challenge_type].filter(Boolean),
        });
      }
    } catch (err) {
      errors.push(err.message);
    }
  }
  if (!out.length && errors.length) throw new Error(errors.join(" | "));
  return out;
}
