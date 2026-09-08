#!/usr/bin/env node
/**
 * Probes the endpoints the adapters rely on and prints what actually comes
 * back: status, content type, size and a snippet. Run it in CI (where the
 * network is open) whenever a source turns red or empty, so an adapter is
 * repaired against the real response instead of a guess.
 *
 *   node crawler/diagnose.mjs
 *   node crawler/diagnose.mjs pib mlh
 */
import { UA } from "./lib/core.mjs";

const TARGETS = {
  ctftime: [["events api", "https://ctftime.org/api/v1/events/?limit=2"]],
  hackerearth: [
    ["chrome-extension events", "https://www.hackerearth.com/chrome-extension/events/"],
    ["challenges page", "https://www.hackerearth.com/challenges/"],
    ["api hackathons", "https://www.hackerearth.com/api/challenges/?type=hackathon"],
  ],
  mlh: [
    ["season 2026", "https://mlh.io/seasons/2026/events"],
    ["season 2027", "https://mlh.io/seasons/2027/events"],
    ["root", "https://mlh.io/"],
  ],
  pib: [
    ["RssMain Regid=3", "https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3"],
    ["RssMain no-www", "https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3"],
    ["allRel listing", "https://www.pib.gov.in/allRel.aspx"],
    ["PressReleasePage", "https://www.pib.gov.in/PressReleasePage.aspx"],
    ["indexd", "https://www.pib.gov.in/indexd.aspx"],
  ],
  feeds: [
    ["SIH", "https://www.sih.gov.in/"],
    ["MyGov innovate", "https://innovateindia.mygov.in/"],
    ["MyGov tasks", "https://www.mygov.in/task/"],
    ["MeitY", "https://www.meity.gov.in/whats-new"],
    ["CERT-In", "https://www.cert-in.org.in/"],
    ["NCIIPC", "https://nciipc.gov.in/"],
    ["CTFtime RSS", "https://ctftime.org/event/list/upcoming/rss/"],
    ["Nullcon", "https://nullcon.net/"],
    ["c0c0n", "https://india.c0c0n.org/"],
    ["DSCI events", "https://www.dsci.in/events"],
    ["hackathon.com", "https://www.hackathon.com/theme/security"],
  ],
};

const wanted = process.argv.slice(2);
const groups = wanted.length ? wanted : Object.keys(TARGETS);

for (const group of groups) {
  const targets = TARGETS[group];
  if (!targets) { console.log(`\n### ${group}: unknown group`); continue; }
  console.log(`\n### ${group}`);

  for (const [name, url] of targets) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
        redirect: "follow",
        signal: AbortSignal.timeout(25000),
      });
      const body = await res.text();
      const ct = (res.headers.get("content-type") || "?").split(";")[0];
      console.log(`  ${name}`);
      console.log(`    ${res.status} ${ct} ${body.length}b ${Date.now() - t0}ms  final=${res.url !== url ? res.url : "(no redirect)"}`);
      console.log(`    shape: ${describe(body)}`);
      console.log(`    head : ${body.replace(/\s+/g, " ").slice(0, 260)}`);
    } catch (err) {
      console.log(`  ${name}\n    ERROR ${err.name}: ${err.message}`);
    }
  }
}

/** Cheap structural fingerprint, enough to tell an adapter what it is facing. */
function describe(body) {
  const bits = [];
  if (/^\s*[[{]/.test(body)) bits.push("json-ish");
  const items = (body.match(/<item\b/gi) || []).length;
  const entries = (body.match(/<entry\b/gi) || []).length;
  if (items || entries) bits.push(`feed(items=${items},entries=${entries})`);
  const links = (body.match(/<a\b[^>]*href=/gi) || []).length;
  if (links) bits.push(`links=${links}`);
  for (const cls of ["event", "card", "hackathon", "challenge", "press", "release", "notice"]) {
    const n = (body.match(new RegExp(`class=["'][^"']*\\b${cls}`, "gi")) || []).length;
    if (n) bits.push(`.${cls}=${n}`);
  }
  if (/cloudflare|captcha|are you a robot|access denied/i.test(body)) bits.push("BLOCKED?");
  if (/__NEXT_DATA__|window\.__NUXT__|ng-version/i.test(body)) bits.push("client-rendered(SPA)");
  return bits.join(" ") || "plain";
}
