/**
 * Templates. Every value that came out of data/events.json is escaped here;
 * see the security note in util.js. Nothing in this file should ever
 * interpolate a raw field.
 */
import { escapeHTML, safeURL, safeImage, formatRange, formatDateTime, relativeTime, daysUntil, hueFor, initials } from "./util.js";
import { icons } from "./icons.js";

const MODE_LABEL = { online: "Online", onsite: "On-site", hybrid: "Hybrid", unspecified: "Mode not stated" };

/** Deterministic duotone used when a listing ships no artwork. Kept dark and
 *  desaturated so the white monogram stays legible on every hue. */
const gradient = (hue) =>
  `background:linear-gradient(140deg,hsl(${hue} 46% 38%),hsl(${(hue + 42) % 360} 52% 24%))`;

/** A card. `saved` decides the bookmark state. */
export function eventCard(event, saved) {
  const img = safeImage(event.image);
  const hue = hueFor(event.title);
  const days = daysUntil(event.startsAt);
  const closes = daysUntil(event.registration?.closesAt);
  const domains = (event.domainLabels || []).slice(0, 3);

  return `
  <article class="card panel" data-id="${escapeHTML(event.id)}">
    <div class="card__media">
      <div class="card__fallback" style="${gradient(hue)}" aria-hidden="true">${escapeHTML(initials(event.title))}</div>
      ${img
        ? `<img src="${img}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`
        : ""}
      <div class="card__badges">
        <span class="badge badge--${event.type === "ctf" ? "ctf" : "hackathon"}">${event.type === "ctf" ? "CTF" : "Hackathon"}</span>
        <span class="badge badge--${event.scope === "national" ? "national" : "international"}">${event.scope === "national" ? "National" : "International"}</span>
        ${event.status === "ongoing" ? '<span class="badge badge--ongoing">Live now</span>' : ""}
      </div>
      ${countdownChip(event, days, closes)}
    </div>

    <div class="card__body">
      <h3 class="card__title">${escapeHTML(event.title)}</h3>
      <div class="card__meta">
        <span>${icons.calendar}${escapeHTML(formatRange(event.startsAt, event.endsAt))}</span>
        <span>${icons.pin}${escapeHTML(event.location?.text || MODE_LABEL[event.location?.mode] || "Location not stated")}</span>
        ${event.organizer ? `<span>${icons.building}${escapeHTML(event.organizer)}</span>` : ""}
        ${event.prize ? `<span>${icons.trophy}${escapeHTML(event.prize)}</span>` : ""}
      </div>
      ${event.description ? `<p class="card__desc">${escapeHTML(event.description)}</p>` : ""}
      <div class="card__tags">
        ${domains.map((d) => `<span class="badge badge--soft">${escapeHTML(d)}</span>`).join("")}
      </div>
    </div>

    <div class="card__actions">
      <button class="btn btn--primary" data-action="details" data-id="${escapeHTML(event.id)}">View details</button>
      <button class="icon-btn" data-action="save" data-id="${escapeHTML(event.id)}"
              aria-pressed="${saved ? "true" : "false"}"
              aria-label="${saved ? "Remove bookmark" : "Bookmark this event"}"
              title="${saved ? "Remove bookmark" : "Bookmark"}">${saved ? icons.bookmarkFill : icons.bookmark}</button>
    </div>
  </article>`;
}

function countdownChip(event, days, closes) {
  if (event.status === "ongoing") return `<span class="card__countdown">Running now</span>`;
  if (Number.isFinite(closes) && closes >= 0 && closes <= 10) {
    return `<span class="card__countdown" style="background:var(--danger);color:#fff">Registration closes in ${closes}d</span>`;
  }
  if (Number.isFinite(days) && days >= 0) return `<span class="card__countdown">Starts in ${days}d</span>`;
  return "";
}

/** The detail dialog contents. */
export function eventDetail(event, saved) {
  const img = safeImage(event.image);
  const apply = safeURL(event.registration?.url || event.url);
  const listing = safeURL(event.sourceUrl);
  const hue = hueFor(event.title);

  return `
  <div class="detail__scroll">
    <div class="detail__hero">
      <div class="card__fallback" style="${gradient(hue)}" aria-hidden="true">${escapeHTML(initials(event.title))}</div>
      ${img ? `<img src="${img}" alt="" onerror="this.remove()">` : ""}
      <button class="detail__close" data-action="close" aria-label="Close">${icons.close}</button>
    </div>

    <div class="detail__body">
      <div>
        <div class="card__badges" style="position:static;margin-bottom:.6rem">
          <span class="badge badge--${event.type === "ctf" ? "ctf" : "hackathon"}">${event.type === "ctf" ? "Capture the Flag" : "Hackathon"}</span>
          <span class="badge badge--${event.scope === "national" ? "national" : "international"}">${event.scope === "national" ? "National (India)" : "International"}</span>
          <span class="badge badge--soft">${escapeHTML(MODE_LABEL[event.location?.mode] || "Mode not stated")}</span>
          ${event.status === "ongoing" ? '<span class="badge badge--ongoing">Live now</span>' : ""}
        </div>
        <h3 id="detail-title">${escapeHTML(event.title)}</h3>
      </div>

      <dl class="kv">
        <div><dt>Runs</dt><dd>${escapeHTML(formatRange(event.startsAt, event.endsAt))}</dd></div>
        <div><dt>Registration</dt><dd>${escapeHTML(registrationLine(event))}</dd></div>
        <div><dt>Location</dt><dd>${escapeHTML(event.location?.text || MODE_LABEL[event.location?.mode] || "Not stated")}</dd></div>
        ${event.organizer ? `<div><dt>Organiser</dt><dd>${escapeHTML(event.organizer)}</dd></div>` : ""}
        ${event.format ? `<div><dt>Format</dt><dd>${escapeHTML(event.format)}</dd></div>` : ""}
        ${event.prize ? `<div><dt>Prize</dt><dd>${escapeHTML(event.prize)}</dd></div>` : ""}
        ${Number.isFinite(event.participants) ? `<div><dt>Registered</dt><dd>${escapeHTML(String(event.participants))}</dd></div>` : ""}
      </dl>

      ${event.description ? section("About", `<p>${escapeHTML(event.description)}</p>`) : ""}

      ${event.timeline?.length
        ? section("Timeline", `<ul class="timeline">${event.timeline.map((t) => `
            <li><div><b>${escapeHTML(t.label)}</b><span>${escapeHTML(formatDateTime(t.at))} · ${escapeHTML(relativeTime(t.at))}</span></div></li>`).join("")}</ul>`)
        : ""}

      ${event.rules?.length
        ? section("Rules and eligibility", `<ul>${event.rules.map((r) => `<li>${escapeHTML(r)}</li>`).join("")}</ul>`)
        : ""}

      ${event.eligibility && !event.rules?.length
        ? section("Eligibility", `<p>${escapeHTML(event.eligibility)}</p>`) : ""}

      ${event.domainLabels?.length
        ? section("Domains", `<div class="chips">${event.domainLabels.map((d) => `<span class="badge badge--soft">${escapeHTML(d)}</span>`).join("")}</div>`)
        : ""}

      ${event.tags?.length
        ? section("Tags", `<div class="chips">${event.tags.map((t) => `<span class="badge badge--soft">${escapeHTML(t)}</span>`).join("")}</div>`)
        : ""}

      ${section("Where this came from", sourceBlock(event))}

      <p class="notice">Details are collected automatically from public listings and can lag behind the organiser. Always confirm dates, fees and eligibility on the official page before you register.</p>
    </div>

    <div class="detail__cta">
      ${apply ? `<a class="btn btn--primary" href="${apply}" target="_blank" rel="noopener noreferrer nofollow">Open official page ${icons.external}</a>` : ""}
      <button class="btn" data-action="ics" data-id="${escapeHTML(event.id)}">${icons.download} Add to calendar</button>
      <button class="btn" data-action="copy" data-id="${escapeHTML(event.id)}">${icons.link} Copy link</button>
      <button class="btn" data-action="save" data-id="${escapeHTML(event.id)}" aria-pressed="${saved ? "true" : "false"}">
        ${saved ? icons.bookmarkFill : icons.bookmark} ${saved ? "Saved" : "Save"}
      </button>
      ${listing && listing !== apply ? `<a class="btn btn--ghost" href="${listing}" target="_blank" rel="noopener noreferrer nofollow">Source listing</a>` : ""}
    </div>
  </div>`;
}

const section = (title, html) => `<section class="detail__section"><h4>${escapeHTML(title)}</h4>${html}</section>`;

function registrationLine(event) {
  const { registrationStatus: s, registration = {} } = event;
  if (registration.closesAt) {
    return `${s === "open" ? "Open" : "Closed"}, deadline ${formatDateTime(registration.closesAt)}`;
  }
  if (s === "likely-open") return "Likely open, no deadline published";
  if (s === "closed") return "Closed";
  return "Check the official page";
}

function sourceBlock(event) {
  const all = [{ label: event.sourceLabel || event.source, url: event.sourceUrl }, ...(event.alsoOn || [])];
  const items = all
    .map(({ label, url }) => {
      const href = safeURL(url);
      const name = escapeHTML(label || "Unknown source");
      return `<li>${href ? `<a href="${href}" target="_blank" rel="noopener noreferrer nofollow">${name}</a>` : name}</li>`;
    })
    .join("");
  const conf = event.scopeConfidence
    ? `<p style="margin-top:.5rem">Scope read as <b>${escapeHTML(event.scope)}</b> with ${escapeHTML(event.scopeConfidence)} confidence (${escapeHTML(event.scopeReason || "")}).</p>`
    : "";
  return `<ul>${items}</ul>${conf}`;
}

/** Source health strip in the footer. */
export function sourceRow(source) {
  const home = safeURL(source.homepage);
  const name = escapeHTML(source.label || source.id);
  const detail = source.status === "error" ? escapeHTML(source.error || "failed") : `${source.count} item(s)`;
  return `<div class="source" data-status="${escapeHTML(source.status)}" title="${escapeHTML(detail)}">
    <span class="dot"></span>
    ${home ? `<a href="${home}" target="_blank" rel="noopener noreferrer nofollow">${name}</a>` : name}
    <small>${escapeHTML(String(source.count ?? 0))}</small>
  </div>`;
}

export function emptyState(icon, title, body) {
  return `<div class="state panel"><div class="state__icon" aria-hidden="true">${icon}</div>
    <h3>${escapeHTML(title)}</h3><p>${escapeHTML(body)}</p></div>`;
}

export const skeletons = (n = 6) => Array.from({ length: n }, () => '<div class="skeleton"></div>').join("");
