/**
 * Major League Hacking: the international student hackathon league.
 * Season pages are plain HTML, so this is a shallow, defensive scrape.
 */
import { getText, stripHTML, absoluteURL, matchAll, toISO } from "../lib/core.mjs";

export const meta = {
  id: "mlh",
  label: "Major League Hacking",
  homepage: "https://mlh.io/seasons",
  kind: "html",
  produces: "hackathon",
};

export async function fetchEvents() {
  const year = new Date().getFullYear();
  const urls = [`https://mlh.io/seasons/${year}/events`, `https://mlh.io/seasons/${year + 1}/events`];
  const out = [];
  const errors = [];

  for (const url of urls) {
    try {
      const html = await getText(url, { soft: true });
      if (!html) continue;
      out.push(...parseSeason(html, url));
    } catch (err) {
      errors.push(`${url}: ${err.message}`);
    }
  }
  if (!out.length && errors.length) throw new Error(errors.join(" | "));
  return out;
}

function parseSeason(html, baseUrl) {
  const cards = matchAll(/<div\b[^>]*class=["'][^"']*\bevent\b[^"']*["'][\s\S]*?(?=<div\b[^>]*class=["'][^"']*\bevent\b|<\/section>)/gi, html)
    .map((m) => m[0]);

  return cards
    .map((card) => {
      const title = stripHTML(pick(card, /class=["'][^"']*event-name[^"']*["'][^>]*>([\s\S]*?)</i));
      if (!title) return null;
      const link = absoluteURL(pick(card, /<a\b[^>]*href=["']([^"']+)["']/i), baseUrl);
      const image = absoluteURL(pick(card, /<img\b[^>]*src=["']([^"']+)["']/i), baseUrl);
      const dateText = stripHTML(pick(card, /class=["'][^"']*event-date[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|p|span)>/i));
      const city = stripHTML(pick(card, /itemprop=["']city["'][^>]*>([\s\S]*?)</i));
      const state = stripHTML(pick(card, /itemprop=["']state["'][^>]*>([\s\S]*?)</i));
      const startMeta = pick(card, /itemprop=["']startDate["'][^>]*content=["']([^"']+)["']/i);
      const endMeta = pick(card, /itemprop=["']endDate["'][^>]*content=["']([^"']+)["']/i);
      const isDigital = /digital|online/i.test(card);

      return {
        sourceId: `mlh-${link || title}`,
        type: "hackathon",
        title,
        description: `An official Major League Hacking member event${dateText ? ` running ${dateText}` : ""}.`,
        url: link,
        sourceUrl: baseUrl,
        image,
        organizer: "Major League Hacking (MLH)",
        rules: ["Governed by the MLH Code of Conduct and the MLH rules for member events."],
        startsAt: toISO(startMeta) || toISO(dateText),
        endsAt: toISO(endMeta),
        location: {
          text: isDigital ? "Digital / Online" : [city, state].filter(Boolean).join(", "),
          country: state && /^[A-Z]{2}$/.test(state) ? "" : state,
          mode: isDigital ? "online" : "onsite",
        },
        tags: ["MLH", "Student hackathon"],
      };
    })
    .filter(Boolean);
}

const pick = (text, re) => (text.match(re) || [])[1] || "";
