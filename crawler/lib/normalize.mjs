/**
 * Normalizes whatever an adapter produced into the single event schema the
 * portal renders, then merges near-duplicates that came from several sources.
 */
import { createHash } from "node:crypto";
import { summarize, stripHTML, toISO } from "./core.mjs";
import { classify } from "./classify.mjs";

/**
 * Stable id from source plus everything that identifies the event.
 *
 * Hashing a single field is not safe: a source row missing both its id and its
 * URL collapses to the same key as every other such row, and distinct events
 * end up sharing an id. The portal keys bookmarks and deep links off the id, so
 * a collision makes one card open another. Combining the fields keeps the id
 * stable across runs while distinguishing events that share any one of them.
 */
function makeId(source, parts) {
  const key = parts.map((p) => String(p ?? "").trim()).filter(Boolean).join("\u0000");
  return `${source}-${createHash("sha1").update(key).digest("hex").slice(0, 10)}`;
}

/** Sources hand us loose objects; this pins them to the schema. */
export function normalize(raw, sourceMeta) {
  const title = stripHTML(raw.title || "").trim();
  if (!title) return null;

  const startsAt = toISO(raw.startsAt);
  const endsAt = toISO(raw.endsAt) || startsAt;

  const event = {
    id: makeId(sourceMeta.id, [raw.sourceId, raw.url || raw.sourceUrl, title, startsAt]),
    source: sourceMeta.id,
    sourceLabel: sourceMeta.label,
    sourceUrl: raw.sourceUrl || raw.url || "",
    url: raw.url || raw.sourceUrl || "",
    title,
    description: summarize(raw.description || "", 700),
    image: raw.image || "",
    organizer: stripHTML(raw.organizer || "").trim(),
    format: stripHTML(raw.format || "").trim(),
    prize: stripHTML(raw.prize || "").trim(),
    eligibility: summarize(raw.eligibility || "", 400),
    rules: (raw.rules || []).map((r) => stripHTML(r)).filter(Boolean).slice(0, 12),
    tags: [...new Set((raw.tags || []).map((t) => stripHTML(String(t)).trim()).filter(Boolean))].slice(0, 12),
    location: {
      text: stripHTML(raw.location?.text || raw.location || "").trim(),
      country: stripHTML(raw.location?.country || "").trim(),
      mode: raw.location?.mode || "",
    },
    startsAt,
    endsAt,
    registration: {
      opensAt: toISO(raw.registration?.opensAt),
      closesAt: toISO(raw.registration?.closesAt),
      url: raw.registration?.url || "",
    },
    timeline: buildTimeline(raw, startsAt, endsAt),
    participants: Number.isFinite(raw.participants) ? raw.participants : null,
    type: raw.type || "",
    // A human vouched for this record, so the relevance and dating gates in
    // crawler/index.mjs let it through untouched.
    trusted: raw.trusted === true,
    fetchedAt: new Date().toISOString(),
  };

  return classify(event);
}

/** Human-readable milestones, sorted, deduped, only the ones we actually know. */
function buildTimeline(raw, startsAt, endsAt) {
  const rows = [
    ["Registration opens", toISO(raw.registration?.opensAt)],
    ["Registration closes", toISO(raw.registration?.closesAt)],
    ["Event starts", startsAt],
    ["Event ends", endsAt],
    ...(raw.timeline || []).map((t) => [t.label, toISO(t.at)]),
  ];
  const seen = new Set();
  return rows
    .filter(([label, at]) => {
      if (!label || !at) return false;
      const key = `${label}|${at}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(([label, at]) => ({ label, at }))
    .sort((a, b) => new Date(a.at) - new Date(b.at));
}

/* ------------------------------ deduplication ----------------------------- */

/** Loose title key: lowercase, drop years, editions, punctuation and filler. */
function titleKey(title) {
  return String(title)
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\b(v?\d+(\.\d+)?(st|nd|rd|th)?\s+edition|edition|season|qualifier|quals|finals?|round\s*\d+)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\b(the|a|an|of|for|and|on|in|by|hackathon|ctf|challenge|competition|contest|event)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same event if the URL host+path matches, or the fuzzy title plus start day do. */
function dupeKeys(event) {
  const keys = [];
  const startDay = event.startsAt ? event.startsAt.slice(0, 10) : "nodate";

  // titleKey strips years, editions and filler words, which can leave almost
  // nothing: "TLN Hackathon 2026" reduces to "tln". Such an event, if it also
  // has no usable URL, would produce no keys at all and could never merge with
  // its own carried-forward copy, so a duplicate would accumulate every run.
  // Fall back to the plain normalized title, which is still a valid key.
  const tk = titleKey(event.title);
  const plain = String(event.title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const titlePart = tk.length > 4 ? tk : plain;
  if (titlePart) keys.push(`t:${titlePart}|${startDay}`);
  for (const u of [event.url, event.sourceUrl]) {
    if (!u) continue;
    try {
      const { host, pathname } = new URL(u);
      const path = pathname.replace(/\/+$/, "");
      // A bare domain is not identifying: several events can share one landing
      // page (a university notices page, a generic "apply here" link), so only
      // a real path participates in URL matching.
      if (path.length > 1) keys.push(`u:${host.replace(/^www\./, "")}${path}`);
    } catch { /* not a usable URL */ }
  }
  return keys;
}

/**
 * Guard for URL-keyed matches. Two listings can legitimately sit under one URL
 * (a listing page, a shortened link), so a URL hit only merges when the titles
 * agree as well. Without this, unrelated events collapse into one card.
 */
function titlesCompatible(a, b) {
  const ta = titleKey(a.title);
  const tb = titleKey(b.title);
  if (!ta || !tb) return false;
  if (ta === tb || ta.includes(tb) || tb.includes(ta)) return true;
  const A = new Set(ta.split(" ").filter((w) => w.length > 2));
  const B = new Set(tb.split(" ").filter((w) => w.length > 2));
  if (!A.size || !B.size) return false;
  const shared = [...A].filter((w) => B.has(w)).length;
  return shared / Math.min(A.size, B.size) >= 0.6;
}

/** Prefer the richer value, but never overwrite something with nothing. */
const richer = (a, b) => (String(b || "").length > String(a || "").length ? b : a);

function mergeInto(target, incoming) {
  target.description = richer(target.description, incoming.description);
  target.image = target.image || incoming.image;
  target.url = target.url || incoming.url;
  target.organizer = richer(target.organizer, incoming.organizer);
  target.prize = richer(target.prize, incoming.prize);
  target.eligibility = richer(target.eligibility, incoming.eligibility);
  target.format = target.format || incoming.format;
  target.startsAt = target.startsAt || incoming.startsAt;
  target.endsAt = target.endsAt || incoming.endsAt;
  target.participants = target.participants ?? incoming.participants;
  target.trusted = target.trusted || incoming.trusted;

  target.rules = [...new Set([...target.rules, ...incoming.rules])].slice(0, 12);
  target.tags = [...new Set([...target.tags, ...incoming.tags])].slice(0, 14);
  target.domains = [...new Set([...target.domains, ...incoming.domains])];
  target.domainLabels = [...new Set([...target.domainLabels, ...incoming.domainLabels])];

  target.location.text = richer(target.location.text, incoming.location.text);
  target.location.country = target.location.country || incoming.location.country;
  if (target.location.mode === "unspecified") target.location.mode = incoming.location.mode;

  target.registration.opensAt = target.registration.opensAt || incoming.registration.opensAt;
  target.registration.closesAt = target.registration.closesAt || incoming.registration.closesAt;
  target.registration.url = target.registration.url || incoming.registration.url;

  // Rebuild rather than append: two sources reporting different end dates must
  // not produce two "Event ends" rows.
  const canonical = new Set(["Registration opens", "Registration closes", "Event starts", "Event ends"]);
  const extras = [...target.timeline, ...incoming.timeline].filter((t) => !canonical.has(t.label));
  target.timeline = buildTimeline({ registration: target.registration, timeline: extras }, target.startsAt, target.endsAt);

  // A high-confidence scope reading beats a low-confidence one.
  const rank = { high: 3, medium: 2, low: 1 };
  if (rank[incoming.scopeConfidence] > rank[target.scopeConfidence]) {
    target.scope = incoming.scope;
    target.scopeConfidence = incoming.scopeConfidence;
    target.scopeReason = incoming.scopeReason;
  }

  target.relevance = Math.max(target.relevance, incoming.relevance);

  // Only a *different* source counts as corroboration. Every run merges each
  // event with its own carried-forward copy, so without this check an event
  // ends up citing itself and the detail view lists one source twice.
  if (incoming.source && incoming.source !== target.source) {
    const seenSources = new Set((target.alsoOn || []).map((s) => s.id));
    if (!seenSources.has(incoming.source)) {
      target.alsoOn = [
        ...(target.alsoOn || []),
        { id: incoming.source, label: incoming.sourceLabel, url: incoming.sourceUrl },
      ];
    }
  }
  return target;
}

/**
 * Last line of defence: guarantee the published ids are unique.
 *
 * Deduplication merges records it recognises as the same event; anything left
 * sharing an id is a distinct event whose identifying fields collided. Renaming
 * it here keeps the portal navigable, and the returned count lets the caller
 * report that it happened rather than hide it.
 */
export function ensureUniqueIds(events) {
  const used = new Set();
  let collisions = 0;
  for (const event of events) {
    if (!used.has(event.id)) { used.add(event.id); continue; }
    // Probe for a free suffix. Simply appending "-2" is not enough: a record
    // carried over from a previous run may already hold that exact renamed id.
    let n = 2;
    let candidate = `${event.id}-${n}`;
    while (used.has(candidate)) candidate = `${event.id}-${++n}`;
    event.id = candidate;
    used.add(candidate);
    collisions++;
  }
  return collisions;
}

/** Collapse duplicates across sources into one enriched record each. */
export function dedupe(events) {
  const byKey = new Map();
  const out = [];

  for (const event of events) {
    const keys = dupeKeys(event);
    const existing = keys
      .map((k) => ({ key: k, hit: byKey.get(k) }))
      .filter(({ hit }) => hit)
      // A title-keyed hit already agrees on the title; a URL-keyed one must be checked.
      .find(({ key, hit }) => key.startsWith("t:") || titlesCompatible(hit, event))?.hit;

    if (existing) {
      mergeInto(existing, event);
      for (const k of keys) if (!byKey.has(k)) byKey.set(k, existing);
    } else {
      out.push(event);
      for (const k of keys) byKey.set(k, event);
    }
  }

  // Score the corroboration once, from the final source list, so the number is
  // the same however many times an event was merged and always agrees with the
  // reasons printed beside it.
  for (const event of out) {
    const extra = (event.alsoOn || []).length;
    if (!extra) continue;
    const bonus = Math.min(extra, 3) * 2;
    event.relevance += bonus;
    event.relevanceReasons = [...(event.relevanceReasons || []), `+${bonus} listed on ${extra + 1} sources`];
  }
  return out;
}
