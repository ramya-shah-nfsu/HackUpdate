/**
 * MyGov Innovate India, the Government of India's innovation-challenge portal.
 *
 * This matters because the sites that announce national programmes directly
 * (pib.gov.in, meity.gov.in, sih.gov.in) all refuse requests from data-centre
 * IP ranges, so this is the one government-run source the crawl can actually
 * reach. It carries ministry challenges, and the Smart India Hackathon.
 *
 * Markup probed 2026-09-08: repeating .challenge_item blocks holding
 * .chl-pic (image), .chl-title (title and link), .sort-description,
 * .subm-last-date (deadline) and .chl_status / .sbm-open (state).
 */
import { getText, stripHTML, absoluteURL, matchAll, summarize, extractMinistry, parseDMYRange } from "../lib/core.mjs";

export const meta = {
  id: "mygov",
  label: "MyGov Innovate India",
  homepage: "https://innovateindia.mygov.in/",
  kind: "html",
  produces: "hackathon",
  country: "India",
};

const PAGES = [
  "https://innovateindia.mygov.in/",
  "https://innovateindia.mygov.in/ministry/ministry-of-electronics-and-information-technology/",
  "https://innovateindia.mygov.in/ministry/ministry-of-home-affairs/",
  "https://innovateindia.mygov.in/ministry/ministry-of-defence/",
];

export async function fetchEvents() {
  const out = [];
  const errors = [];
  const seen = new Set();

  for (const page of PAGES) {
    try {
      const html = await getText(page, { soft: true, retries: 1 });
      if (!html) { errors.push(`${page}: unreachable`); continue; }
      for (const event of parsePage(html, page)) {
        const key = event.url || event.title;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(event);
      }
    } catch (err) {
      errors.push(`${page}: ${err.message}`);
    }
  }
  if (!out.length && errors.length) throw new Error(errors.slice(0, 3).join(" | "));
  return out;
}

function parsePage(html, pageUrl) {
  const starts = matchAll(/<[a-z]+[^>]*class=["'][^"']*challenge_item[^"']*["'][^>]*>/gi, html).map((m) => m.index);

  // Fall back to any block carrying a challenge title, in case the wrapper
  // class is renamed but the inner markup survives.
  const blocks = starts.length
    ? starts.map((s, i) => html.slice(s, Math.min(starts[i + 1] ?? html.length, s + 6000)))
    : matchAll(/<[a-z]+[^>]*class=["'][^"']*chl-title[^"']*["'][\s\S]{0,2500}/gi, html).map((m) => m[0]);

  return blocks
    .map((block) => {
      const titleBlock = (block.match(/class=["'][^"']*chl-title[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|h\d|p|span)>/i) || [])[1] || "";
      const anchor = titleBlock.match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);

      const title = stripHTML(anchor ? anchor[2] : titleBlock).trim();
      if (!title || title.length < 6 || title.length > 200) return null;

      const url = absoluteURL(anchor ? anchor[1] : "", pageUrl);
      const description = stripHTML(
        (block.match(/class=["'][^"']*sort-description[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|p)>/i) || [])[1] || ""
      );
      const deadlineText = stripHTML(
        (block.match(/class=["'][^"']*subm-last-date[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|p|span)>/i) || [])[1] || ""
      );
      // The site emits src="https://…webp " with a trailing space.
      const image = absoluteURL(
        (((block.match(/class=["'][^"']*chl-pic[^"']*["'][\s\S]{0,400}?<img[^>]+src=["']([^"']+)["']/i) ||
          block.match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1]) || "").trim(),
        pageUrl
      );

      const open = /sbm-open/i.test(block) || /submission\s+open/i.test(block);
      // The listing prints a day-first range, "21/08/2026 - 15/10/2026", which
      // is the submission window: it opens on the first date, closes on the second.
      const { from: opensAt, to } = parseDMYRange(deadlineText);
      const closesAt = to || opensAt;

      return {
        sourceId: `mygov-${url || title}`,
        type: "hackathon",
        title,
        description: summarize(
          [description, deadlineText && `Submission window as listed: ${deadlineText}.`]
            .filter(Boolean).join(" "),
          600
        ),
        url,
        sourceUrl: pageUrl,
        image,
        // The listing carries the ministry in its own field; fall back to a scan.
        organizer:
          stripHTML((block.match(/class=["'][^"']*byministry[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) || [])[1] || "")
            .replace(/^By\s*:\s*/i, "").trim() ||
          extractMinistry(block) ||
          "Government of India (MyGov)",
        rules: [
          open
            ? "Listed as open for submissions at the time of the last crawl."
            : "Submission state not stated on the listing; confirm on the official page.",
          "Government of India innovation challenge. Eligibility is usually restricted to Indian citizens or institutions.",
        ],
        // The submission window is the actionable period for a student, so it
        // doubles as the event's own dates.
        startsAt: opensAt || closesAt,
        endsAt: closesAt,
        registration: { opensAt, closesAt, url },
        location: { text: "India", country: "India" },
        tags: ["MyGov", "Government of India", "Innovation challenge"],
      };
    })
    .filter(Boolean);
}

