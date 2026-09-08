/**
 * CTFtime: the authoritative calendar for capture-the-flag events worldwide.
 * Public JSON API: https://ctftime.org/api/v1/events/
 * Highest-signal source for the CTF half of the portal.
 */
import { getJSON, absoluteURL } from "../lib/core.mjs";

export const meta = {
  id: "ctftime",
  label: "CTFtime",
  homepage: "https://ctftime.org/",
  kind: "api",
  produces: "ctf",
};

export async function fetchEvents({ windowDays = 240, limit = 100 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const finish = now + windowDays * 86400;
  // The API caps `limit`; ask for a window that starts a week back so events
  // already running still show up as "ongoing".
  const url =
    `https://ctftime.org/api/v1/events/?limit=${limit}` +
    `&start=${now - 7 * 86400}&finish=${finish}`;

  const rows = await getJSON(url);
  if (!Array.isArray(rows)) throw new Error("expected an array of events");

  return rows.map((e) => {
    const organizers = (e.organizers || []).map((o) => o.name).filter(Boolean);
    const rules = [];
    if (e.restrictions) rules.push(`Participation: ${e.restrictions}`);
    if (e.format) rules.push(`Format: ${e.format}`);
    if (e.duration) {
      const d = e.duration;
      const parts = [d.days ? `${d.days} day(s)` : "", d.hours ? `${d.hours} hour(s)` : ""].filter(Boolean);
      if (parts.length) rules.push(`Duration: ${parts.join(" ")}`);
    }
    if (e.onsite) rules.push("On-site event: physical attendance required.");
    if (e.prizes) rules.push(`Prizes: ${String(e.prizes).slice(0, 240)}`);

    return {
      sourceId: `event-${e.id ?? e.ctf_id ?? e.ctftime_url}`,
      type: "ctf",
      title: e.title,
      description: e.description,
      // `url` is the CTF's own site; ctftime_url is the listing we credit.
      url: e.url || e.ctftime_url,
      sourceUrl: e.ctftime_url || absoluteURL(`/event/${e.id}`, "https://ctftime.org"),
      image: e.logo || "",
      organizer: organizers.join(", "),
      format: e.format || "",
      prize: e.prizes ? String(e.prizes).slice(0, 120) : "",
      eligibility: e.restrictions || "",
      rules,
      startsAt: e.start,
      endsAt: e.finish,
      participants: Number.isFinite(e.participants) ? e.participants : null,
      location: {
        text: e.location || (e.onsite ? "" : "Online"),
        mode: e.onsite ? "onsite" : "online",
      },
      tags: [e.format, e.onsite ? "On-site" : "Online", "CTF"].filter(Boolean),
    };
  });
}
