/**
 * Turns raw source text into the facets the portal filters on:
 * event type (ctf / hackathon), domains, scope (national / international),
 * delivery mode, lifecycle status and a relevance score.
 *
 * All keyword lists live in crawler/config/taxonomy.json so the taxonomy can be
 * tuned without touching this file.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Bucket for events that matched no domain at all. The publish gate in
 *  crawler/index.mjs drops these, so generic college hackathons with no
 *  relevance to the programmes do not dilute the portal. */
export const UNCLASSIFIED = "unclassified";

const TAXONOMY = JSON.parse(
  readFileSync(fileURLToPath(new URL("../config/taxonomy.json", import.meta.url)), "utf8")
);

export const DOMAINS = [
  ...TAXONOMY.domains.map(({ id, label }) => ({ id, label })),
  { id: UNCLASSIFIED, label: "Unclassified" },
];

/** Lowercased, punctuation-padded haystack so " ai " style keywords work. */
function haystack(event) {
  return (
    " " +
    [
      event.title,
      event.description,
      event.organizer,
      event.location?.text,
      event.format,
      event.eligibility,
      (event.tags || []).join(" "),
      (event.rules || []).join(" "),
      event.url,
    ]
      .filter(Boolean)
      .join(" · ")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s/&.:-]/gu, " ")
      .replace(/\s+/g, " ") +
    " "
  );
}

const hits = (hay, terms) => terms.filter((t) => hay.includes(t.toLowerCase()));

/** Which NFSU-relevant domains does this event touch? */
export function detectDomains(event, hay = haystack(event)) {
  const found = [];
  for (const domain of TAXONOMY.domains) {
    const matched = hits(hay, domain.keywords);
    if (matched.length) found.push({ id: domain.id, label: domain.label, weight: domain.weight, matched });
  }
  return found.sort((a, b) => b.weight * b.matched.length - a.weight * a.matched.length);
}

/** CTF or hackathon? Sources that already know pass `event.type` and win. */
export function detectType(event, hay = haystack(event)) {
  if (event.type === "ctf" || event.type === "hackathon") return event.type;
  const ctf = hits(hay, TAXONOMY.eventTypeSignals.ctf).length;
  const hack = hits(hay, TAXONOMY.eventTypeSignals.hackathon).length;
  if (ctf === 0 && hack === 0) return "hackathon";
  return ctf > hack ? "ctf" : "hackathon";
}

/**
 * National (India) vs international.
 * An explicit country from the source outranks any keyword guess.
 */
export function detectScope(event, hay = haystack(event)) {
  // A curator stating the scope outranks every heuristic below. This is a
  // separate field from `scope` on purpose: `scope` is present on every record
  // carried over from a previous run, and honouring that would freeze an old
  // guess instead of re-deriving it.
  if (event.scopeOverride === "national" || event.scopeOverride === "international") {
    return { scope: event.scopeOverride, confidence: "high", why: "stated by the curator" };
  }
  const country = (event.location?.country || "").toLowerCase();
  if (country) {
    if (/\bindia\b/.test(country)) return { scope: "national", confidence: "high", why: "source country = India" };
    return { scope: "international", confidence: "high", why: `source country = ${event.location.country}` };
  }
  const strong = hits(hay, TAXONOMY.indiaSignals.strong);
  const cities = hits(hay, TAXONOMY.indiaSignals.cities);
  if (strong.length || cities.length) {
    return {
      scope: "national",
      confidence: strong.length ? "high" : "medium",
      why: `matched ${[...strong, ...cities].slice(0, 3).join(", ")}`,
    };
  }
  return { scope: "international", confidence: "low", why: "no India signal found" };
}

/** Online / onsite / hybrid. */
export function detectMode(event, hay = haystack(event)) {
  if (event.location?.mode) return event.location.mode;
  const { modeSignals } = TAXONOMY;
  if (hits(hay, modeSignals.hybrid).length) return "hybrid";
  const online = hits(hay, modeSignals.online).length;
  const onsite = hits(hay, modeSignals.onsite).length;
  if (online && onsite) return "hybrid";
  if (online) return "online";
  if (onsite) return "onsite";
  return "unspecified";
}

/** upcoming | ongoing | past, relative to `now`. */
export function detectStatus(event, now = new Date()) {
  const start = event.startsAt ? new Date(event.startsAt) : null;
  const end = event.endsAt ? new Date(event.endsAt) : start;
  if (!start || Number.isNaN(+start)) return "undated";
  if (end && !Number.isNaN(+end) && now > end) return "past";
  if (now >= start) return "ongoing";
  return "upcoming";
}

/** Is registration still open, as far as we can tell? */
export function detectRegistration(event, now = new Date()) {
  const closes = event.registration?.closesAt ? new Date(event.registration.closesAt) : null;
  if (closes && !Number.isNaN(+closes)) return now <= closes ? "open" : "closed";
  const start = event.startsAt ? new Date(event.startsAt) : null;
  if (start && !Number.isNaN(+start)) return now <= start ? "likely-open" : "closed";
  return "unknown";
}

/**
 * Relevance score. Events below the configured threshold never reach the portal.
 * Domain hits dominate; recency, dating and prize money break ties.
 */
export function scoreEvent(event, hay = haystack(event)) {
  let score = 0;
  const reasons = [];

  for (const d of detectDomains(event, hay)) {
    const add = d.weight + Math.min(d.matched.length - 1, 3);
    score += add;
    reasons.push(`+${add} ${d.label}`);
  }

  const negatives = hits(hay, TAXONOMY.negativeSignals.terms);
  if (negatives.length) {
    const penalty = TAXONOMY.negativeSignals.weight * negatives.length;
    score += penalty;
    reasons.push(`${penalty} noise (${negatives.slice(0, 2).join(", ")})`);
  }

  // A dated future event is far more useful to a student than an undated one.
  const status = detectStatus(event);
  if (status === "upcoming") { score += 5; reasons.push("+5 upcoming"); }
  else if (status === "ongoing") { score += 3; reasons.push("+3 ongoing"); }
  else if (status === "past") { score -= 12; reasons.push("-12 already finished"); }
  else { score -= 3; reasons.push("-3 no dates"); }

  if (event.url) { score += 2; reasons.push("+2 has official URL"); }
  if (event.image) { score += 1; reasons.push("+1 has image"); }
  if (event.prize) { score += 1; reasons.push("+1 prize listed"); }
  if ((event.description || "").length > 140) { score += 1; reasons.push("+1 detailed"); }

  return { score, reasons };
}

/** One pass that fills in every derived facet on a normalized event. */
export function classify(event, now = new Date()) {
  const hay = haystack(event);
  const domains = detectDomains(event, hay);
  const { scope, confidence, why } = detectScope(event, hay);
  const { score, reasons } = scoreEvent(event, hay);

  return {
    ...event,
    type: detectType(event, hay),
    domains: domains.length ? domains.map((d) => d.id) : [UNCLASSIFIED],
    domainLabels: domains.length ? domains.map((d) => d.label) : ["Unclassified"],
    scope,
    scopeConfidence: confidence,
    scopeReason: why,
    location: { ...(event.location || {}), mode: detectMode(event, hay) },
    status: detectStatus(event, now),
    registrationStatus: detectRegistration(event, now),
    relevance: score,
    relevanceReasons: reasons,
  };
}

export { haystack };
