/**
 * HackUpdate portal controller.
 *
 * Loads data/events.json (written by the daily crawl), keeps all filter state
 * in one object, and re-renders from that object. No framework, no build step.
 */
import { store, debounce, downloadICS, escapeHTML, relativeTime, daysUntil, safeURL } from "./util.js";
import { eventCard, eventDetail, sourceRow, emptyState, skeletons } from "./render.js";

const DATA_URL = "data/events.json";
const THEMES = ["brutal", "neon", "calm"];
const SAVED_KEY = "hackupdate:saved";
const THEME_KEY = "hackupdate:theme";

const state = {
  events: [],
  meta: null,
  saved: new Set(store.get(SAVED_KEY, [])),
  filters: {
    q: "",
    type: "all",          // all | hackathon | ctf
    scope: "all",         // all | national | international
    status: "open",       // open | all | ongoing | upcoming | past
    mode: "all",          // all | online | onsite | hybrid
    domains: new Set(),
    savedOnly: false,
    sort: "soonest",      // soonest | relevance | deadline | newest
  },
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* --------------------------------- theme ---------------------------------- */

function applyTheme(name) {
  const theme = THEMES.includes(name) ? name : THEMES[0];
  document.documentElement.dataset.theme = theme;
  store.set(THEME_KEY, theme);
  $$("#theme-switch button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.theme === theme)));
}

/* ---------------------------------- data ---------------------------------- */

async function loadData() {
  const grid = $("#grid");
  grid.innerHTML = skeletons(6);
  try {
    const res = await fetch(DATA_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();

    state.events = Array.isArray(payload.events) ? payload.events : [];
    state.meta = payload;
    renderFreshness(payload);
    renderSources(payload.sources || []);
    renderDomainChips();
    renderStats();
    render();
    openFromHash();
  } catch (err) {
    grid.innerHTML = emptyState(
      "⚠️",
      "Could not load the event feed",
      `data/events.json did not load (${err.message}). If you opened this file directly from disk, run a local server instead: python3 -m http.server 8000`
    );
    $("#result-count").textContent = "";
  }
}

/* --------------------------------- filters -------------------------------- */

/** Free-text match across the fields a student would actually search. */
function matchesQuery(event, q) {
  if (!q) return true;
  const hay = [
    event.title, event.description, event.organizer, event.location?.text,
    event.format, (event.tags || []).join(" "), (event.domainLabels || []).join(" "),
    event.sourceLabel,
  ].filter(Boolean).join(" ").toLowerCase();
  // Every whitespace-separated term must appear somewhere.
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((term) => hay.includes(term));
}

function visibleEvents() {
  const f = state.filters;
  let rows = state.events.filter((e) => {
    if (f.type !== "all" && e.type !== f.type) return false;
    if (f.scope !== "all" && e.scope !== f.scope) return false;
    if (f.mode !== "all" && (e.location?.mode || "unspecified") !== f.mode) return false;
    if (f.savedOnly && !state.saved.has(e.id)) return false;
    if (f.domains.size && !(e.domains || []).some((d) => f.domains.has(d))) return false;

    if (f.status === "open") {
      if (e.status === "past") return false;
      if (e.registrationStatus === "closed") return false;
    } else if (f.status !== "all" && e.status !== f.status) return false;

    return matchesQuery(e, f.q);
  });

  const time = (e) => +new Date(e.startsAt || e.endsAt || 0) || Infinity;
  const deadline = (e) => +new Date(e.registration?.closesAt || e.startsAt || 0) || Infinity;

  const sorters = {
    soonest: (a, b) => time(a) - time(b),
    deadline: (a, b) => deadline(a) - deadline(b),
    relevance: (a, b) => (b.relevance || 0) - (a.relevance || 0) || time(a) - time(b),
    newest: (a, b) => +new Date(b.fetchedAt || 0) - +new Date(a.fetchedAt || 0),
  };
  return rows.sort(sorters[f.sort] || sorters.soonest);
}

/* --------------------------------- render --------------------------------- */

function render() {
  const rows = visibleEvents();
  const grid = $("#grid");

  if (!rows.length) {
    grid.innerHTML = state.events.length
      ? emptyState("🔍", "Nothing matches these filters",
          "Try clearing a domain chip, switching the status filter to \"All\", or widening the search text.")
      : emptyState("🗓️", "The feed is still being built",
          "No events have been published yet. The daily crawl fills data/events.json; run it manually with: node crawler/index.mjs");
    $("#result-count").textContent = "0 events";
    return;
  }

  grid.innerHTML = rows.map((e) => eventCard(e, state.saved.has(e.id))).join("");
  const national = rows.filter((e) => e.scope === "national").length;
  $("#result-count").textContent =
    `${rows.length} event${rows.length === 1 ? "" : "s"} · ${national} national · ${rows.length - national} international`;
  refreshChipCounts();
}

function renderStats() {
  const upcoming = state.events.filter((e) => e.status !== "past");
  const set = (id, value) => { const el = $(id); if (el) el.textContent = value; };
  set("#stat-total", upcoming.length);
  set("#stat-ctf", upcoming.filter((e) => e.type === "ctf").length);
  set("#stat-national", upcoming.filter((e) => e.scope === "national").length);
  set("#stat-week", upcoming.filter((e) => {
    const d = daysUntil(e.startsAt);
    return Number.isFinite(d) && d >= 0 && d <= 30;
  }).length);
}

function renderFreshness(payload) {
  const el = $("#freshness");
  if (!el || !payload.generatedAt) return;
  const ageDays = (Date.now() - +new Date(payload.generatedAt)) / 864e5;
  el.dataset.stale = String(ageDays > 2);
  $("#freshness-text").textContent = `Updated ${relativeTime(payload.generatedAt)}`;
  el.title = `Last crawl: ${new Date(payload.generatedAt).toLocaleString()}`;
}

function renderSources(sources) {
  const wrap = $("#sources-grid");
  if (!wrap) return;
  if (!sources.length) { $("#sources").hidden = true; return; }
  wrap.innerHTML = sources.map(sourceRow).join("");
  const failed = sources.filter((s) => s.status === "error").length;
  $("#sources-note").textContent = failed
    ? `${sources.length} sources checked on the last run, ${failed} could not be reached. Events from a failed source stay visible from the previous crawl until they expire.`
    : `${sources.length} sources checked on the last run. Green means the source responded and returned listings.`;
}

/** Domain chips are generated from the data, so a new domain needs no HTML edit. */
function renderDomainChips() {
  const wrap = $("#domain-chips");
  const counts = new Map();
  for (const e of state.events) for (const d of e.domains || []) counts.set(d, (counts.get(d) || 0) + 1);

  const known = state.meta?.domains || [];
  const labels = new Map(known.map((d) => [d.id, d.label]));

  wrap.innerHTML = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `<button class="chip" data-domain="${escapeHTML(id)}" aria-pressed="false">
        ${escapeHTML(labels.get(id) || id)} <span class="chip__n">${n}</span></button>`)
    .join("");
}

/** Chip counts reflect what the *other* filters would leave behind. */
function refreshChipCounts() {
  const base = state.filters.domains;
  $$("#domain-chips .chip").forEach((chip) => {
    chip.setAttribute("aria-pressed", String(base.has(chip.dataset.domain)));
  });
}

/* --------------------------------- dialog --------------------------------- */

const dialog = () => $("#detail");

function openDetail(id) {
  const event = state.events.find((e) => e.id === id);
  if (!event) return;
  const dlg = dialog();
  dlg.innerHTML = eventDetail(event, state.saved.has(event.id));
  dlg.setAttribute("aria-label", event.title);
  if (!dlg.open) dlg.showModal();
  history.replaceState(null, "", `#${encodeURIComponent(event.id)}`);
  dlg.querySelector(".detail__scroll")?.focus?.();
}

function closeDetail() {
  const dlg = dialog();
  if (dlg.open) dlg.close();
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
}

function openFromHash() {
  const id = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (id) openDetail(id);
}

/* --------------------------------- actions -------------------------------- */

function toggleSave(id) {
  if (state.saved.has(id)) state.saved.delete(id);
  else state.saved.add(id);
  store.set(SAVED_KEY, [...state.saved]);
  $("#saved-count").textContent = state.saved.size ? ` (${state.saved.size})` : "";
  render();
  if (dialog().open) openDetail(id);
}

async function copyLink(id) {
  const url = `${location.origin}${location.pathname}#${encodeURIComponent(id)}`;
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied to clipboard");
  } catch {
    toast("Copy failed. The link is in the address bar.");
  }
}

let toastTimer;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* --------------------------------- events --------------------------------- */

function wireUp() {
  // Theme
  $("#theme-switch").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-theme]");
    if (btn) applyTheme(btn.dataset.theme);
  });

  // Search
  const search = $("#search-input");
  search.addEventListener("input", debounce(() => {
    state.filters.q = search.value.trim();
    render();
  }, 160));

  // Tabs and selects
  $("#type-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-type]");
    if (!btn) return;
    state.filters.type = btn.dataset.type;
    $$("#type-tabs button").forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
    render();
  });

  for (const [id, key] of [["#scope-select", "scope"], ["#status-select", "status"], ["#mode-select", "mode"], ["#sort-select", "sort"]]) {
    $(id).addEventListener("change", (e) => { state.filters[key] = e.target.value; render(); });
  }

  $("#domain-chips").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip[data-domain]");
    if (!chip) return;
    const id = chip.dataset.domain;
    state.filters.domains.has(id) ? state.filters.domains.delete(id) : state.filters.domains.add(id);
    render();
  });

  $("#saved-toggle").addEventListener("click", (e) => {
    state.filters.savedOnly = !state.filters.savedOnly;
    e.currentTarget.setAttribute("aria-pressed", String(state.filters.savedOnly));
    render();
  });

  $("#reset-filters").addEventListener("click", () => {
    state.filters = { ...state.filters, q: "", type: "all", scope: "all", status: "open", mode: "all", domains: new Set(), savedOnly: false, sort: "soonest" };
    search.value = "";
    $("#scope-select").value = "all";
    $("#status-select").value = "open";
    $("#mode-select").value = "all";
    $("#sort-select").value = "soonest";
    $("#saved-toggle").setAttribute("aria-pressed", "false");
    $$("#type-tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.type === "all")));
    render();
  });

  // Card and dialog actions share one delegated handler.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === "details") openDetail(id);
    else if (action === "save") toggleSave(id);
    else if (action === "close") closeDetail();
    else if (action === "copy") copyLink(id);
    else if (action === "ics") {
      const event = state.events.find((x) => x.id === id);
      if (event && downloadICS(event)) toast("Calendar file downloaded");
      else toast("This event has no confirmed start date yet");
    }
  });

  // Clicking the backdrop closes the dialog.
  dialog().addEventListener("click", (e) => { if (e.target === dialog()) closeDetail(); });
  dialog().addEventListener("close", () => {
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  });

  // Keyboard: "/" focuses search, Escape clears it.
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      search.focus();
      search.select();
    }
    if (e.key === "Escape" && document.activeElement === search && search.value) {
      search.value = "";
      state.filters.q = "";
      render();
    }
  });

  window.addEventListener("hashchange", openFromHash);
}

/* ---------------------------------- boot ---------------------------------- */

applyTheme(store.get(THEME_KEY, document.documentElement.dataset.theme || THEMES[0]));
$("#saved-count").textContent = state.saved.size ? ` (${state.saved.size})` : "";
$("#year").textContent = new Date().getFullYear();
wireUp();
loadData();
