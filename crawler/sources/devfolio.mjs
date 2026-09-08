/**
 * Devfolio: India's dominant hackathon platform (ETHIndia, most college
 * hackathons). Its search API is Elasticsearch-shaped and takes a POST.
 */
import { request, stripHTML } from "../lib/core.mjs";

export const meta = {
  id: "devfolio",
  label: "Devfolio",
  homepage: "https://devfolio.co/hackathons",
  kind: "api",
  produces: "hackathon",
  country: "India",
};

export async function fetchEvents({ size = 40 } = {}) {
  const results = [];
  const errors = [];

  for (const type of ["application_open", "upcoming"]) {
    try {
      const res = await request("https://api.devfolio.co/api/search/hackathons", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://devfolio.co" },
        body: JSON.stringify({ type, from: 0, size, tracks: [] }),
      });
      const data = JSON.parse(await res.text());
      const hits = data?.hits?.hits || data?.result || [];
      for (const hit of hits) {
        const h = hit._source || hit;
        if (h) results.push(mapHackathon(h));
      }
    } catch (err) {
      errors.push(`${type}: ${err.message}`);
    }
  }
  if (!results.length && errors.length) throw new Error(errors.join(" | "));
  return results;
}

function mapHackathon(h) {
  const settings = h.hackathon_setting || {};
  const url = h.slug ? `https://${h.slug}.devfolio.co/` : h.site || "";
  const rules = [];
  if (settings.reg_ends_at) rules.push(`Applications close on ${new Date(settings.reg_ends_at).toDateString()}.`);
  if (h.is_online === true) rules.push("Fully online hackathon.");
  if (h.team_size_max) rules.push(`Team size up to ${h.team_size_max}.`);

  return {
    sourceId: `devfolio-${h.uuid || h.slug || url}`,
    type: "hackathon",
    title: h.name,
    description: stripHTML(h.desc || h.tagline || ""),
    url,
    sourceUrl: url,
    image: h.cover_img || h.hero_image || "",
    organizer: h.organizer_name || "",
    prize: h.prize_pool ? String(h.prize_pool) : "",
    rules,
    startsAt: h.starts_at || settings.reg_starts_at || null,
    endsAt: h.ends_at || null,
    registration: { opensAt: settings.reg_starts_at || null, closesAt: settings.reg_ends_at || null, url },
    location: {
      text: h.is_online ? "Online" : [h.location, h.city].filter(Boolean).join(", "),
      country: h.is_online ? "" : "India",
      mode: h.is_online ? "online" : "onsite",
    },
    tags: ["Devfolio", ...(h.themes || []).map((t) => t.name || t).filter(Boolean)].slice(0, 10),
  };
}
