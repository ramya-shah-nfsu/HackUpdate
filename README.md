# HackUpdate

A student-facing portal that tracks **hackathons and Capture the Flag (CTF) competitions**
for the Cyber Security and Digital Forensics programmes at the
**National Forensic Sciences University**.

It covers cyber security, digital forensics, drone and UAV security and forensics,
IoT and embedded security, OT / ICS / SCADA, critical infrastructure, AI and ML,
and open innovation programmes such as the Smart India Hackathon, split into
**national (India)** and **international** listings.

---

## How it is put together

A browser cannot crawl the web. Cross-origin requests are blocked by CORS, and a
static page has no process that can run on a schedule. So the project is split in two:

| Part | What it is | Where it runs |
| --- | --- | --- |
| **Portal** (`index.html`, `assets/`) | Plain HTML, CSS and JavaScript. No framework, no build step, no dependencies. | The student's browser |
| **Crawler** (`crawler/`) | Zero-dependency Node script. Fetches sources, classifies, deduplicates, writes `data/events.json`. | GitHub Actions, once a day |

The portal only ever reads the static `data/events.json` that the crawl commits.
That keeps the front end exactly as simple as it was asked to be, while still
getting a real daily update.

```
GitHub Actions (01:30 UTC / 07:00 IST daily)
        │
        ├── crawler/index.mjs        fetch, classify, score, dedupe
        ├── crawler/validate.mjs     refuse to publish a broken feed
        └── commit data/events.json
                    │
                    ▼
        index.html  fetch("data/events.json")  render
```

---

## Running it

The portal is static, but it uses `fetch()` and ES modules, so it needs a server.
Opening `index.html` straight off the disk will not work.

```bash
git clone https://github.com/ramya-shah-nfsu/HackUpdate.git
cd HackUpdate

# 1. Build the feed (needs Node 20+ and internet access)
node crawler/index.mjs

# 2. Serve the portal
python3 -m http.server 8000
#    then open http://localhost:8000
```

Useful crawler flags:

```bash
node crawler/index.mjs --dry-run              # run every source, print a report, write nothing
node crawler/index.mjs --only=ctftime,pib     # run selected sources only
node crawler/validate.mjs                     # check data/events.json is well formed
node crawler/demo.mjs                         # OVERWRITES data/events.json with fake sample
                                              # data, for offline interface work only
```

---

## Sources

| Source | Type | What it gives us |
| --- | --- | --- |
| **CTFtime** | Public JSON API | The authoritative worldwide CTF calendar: dates, format, restrictions, logos, prizes |
| **Devpost** | JSON endpoint | Large international hackathons, queried per NFSU domain keyword |
| **Unstop** | JSON endpoint | Indian student competitions and hackathons |
| **Devfolio** | JSON search API | Indian college and community hackathons |
| **HackerEarth** | JSON endpoint | Indian corporate hackathons and coding challenges |
| **MLH** | HTML scrape | International student hackathon league events |
| **PIB (pib.gov.in)** | RSS plus HTML | Government of India announcements: this is where programmes like Cyber Kushti, Kavach and the Smart India Hackathon are announced first |
| **Configured feeds** | RSS or HTML | Anything listed in `crawler/config/sources.json`, including MyGov, SIH, MeitY, CERT-In, NCIIPC, Nullcon and c0c0n |

Each source is isolated. **One source failing degrades the run, it never fails it**,
and the failure is published in `data/events.json` under `sources`, so the portal
shows a red dot next to that source in the "Where this data comes from" panel
instead of quietly showing fewer events.

Records from the previous run are carried forward, so an event does not vanish
just because its source was down for a day.

### Adding a source without writing code

Append to the `feeds` array in **`crawler/config/sources.json`**:

```json
{
  "id": "nfsu-notices",
  "label": "NFSU Notices",
  "kind": "html",
  "url": "https://nfsu.ac.in/notices",
  "country": "India"
}
```

`kind` is `"rss"` for a feed or `"html"` for a listing page. The generic adapter
harvests links whose text reads like an event, then the classifier decides whether
it belongs on the portal. Nothing else needs to change.

---

## Tuning what counts as relevant

**`crawler/config/taxonomy.json`** holds every keyword list:

- `domains` gives each NFSU domain a keyword list and a weight. A domain hit adds
  its weight to the event's relevance score.
- `eventTypeSignals` decides CTF versus hackathon.
- `indiaSignals` decides national versus international (organiser, city list,
  government bodies, well-known Indian security conferences).
- `negativeSignals` subtracts points for marketing noise.

`settings.minScore` in `crawler/config/sources.json` is the publishing threshold.
Raise it for a stricter feed, lower it for a broader one. Every score is explained
per event in `relevanceReasons`, so it is easy to see why something was kept or dropped.

---

## The portal

- **Three themes**, switchable in the header and remembered per device:
  **Brutal** (neo-brutalist, the default), **Neon** (dark cyber), and **Calm**
  (refined flat, good for projectors and printing). The first visit follows the
  operating system's light or dark preference.
- **Filters**: full-text search, hackathon or CTF, national or international,
  registration status, online / on-site / hybrid, domain chips generated from the
  data, and four sort orders.
- **Per-event detail** with the timeline, rules and eligibility, prizes, organiser,
  domains, and every source the record was corroborated from.
- **Add to calendar** writes a real `.ics` file with an alarm before the registration
  deadline.
- **Bookmarks** and **shareable per-event links** (`index.html#event-id`).
- Keyboard: `/` focuses search, `Esc` clears it or closes the dialog.
- Backgrounds are pure CSS, so the repository ships no image assets.

---

## Deploying

**GitHub Pages, from Actions** (recommended):
Settings → Pages → Build and deployment → Source: **GitHub Actions**.
`.github/workflows/pages.yml` then publishes on every push to the default branch.

**GitHub Pages, from a branch** also works, since the repository root is the site.
`.nojekyll` is present so Jekyll does not interfere.

The daily crawl (`.github/workflows/crawl.yml`) needs `contents: write`, which is
already declared. It also runs on `workflow_dispatch`, so you can trigger it by hand
from the Actions tab and pass a comma-separated list of source ids to run.

---

## Security notes

Everything in `data/events.json` comes from third-party websites and is treated as
untrusted:

- All text is escaped through `escapeHTML()` before it reaches the DOM.
- All links pass `safeURL()`, which permits only `http:` and `https:`, so a
  `javascript:` or `data:` URL in scraped content cannot become a clickable link.
- Images must be `https:`, so the page never drops to mixed content.
- Outbound links carry `rel="noopener noreferrer nofollow"` and open in a new tab.
- `crawler/validate.mjs` re-checks these invariants in CI and fails the job rather
  than publishing a feed that violates them.

---

## Known limitations, stated plainly

- **The scrapers are the fragile part.** CTFtime, Devpost, Unstop, Devfolio and
  HackerEarth are read through endpoints that are public but undocumented. When one
  changes shape, that adapter starts returning nothing and its dot turns red on the
  portal. Fixing it means updating the field mapping in `crawler/sources/<name>.mjs`.
- **Rules and regulations are rarely structured.** Most platforms publish prose, not
  fields. The portal shows what the source exposes (CTFtime restrictions, Devpost
  eligibility, Unstop team-size limits, submission windows) and otherwise links to
  the official page. Every detail view says so.
- **National versus international is a heuristic** where the source does not state a
  country. Each event records `scopeConfidence` and `scopeReason`, both shown in the
  detail view, so a wrong call is visible rather than silent.
- **Dates from HTML listing pages are best-effort.** The date nearest a link on a
  listing page is not always that event's date. Treat the official page as the truth.
- **First run**: `data/events.json` ships empty. Run the crawl, or trigger the
  workflow from the Actions tab, before the portal shows anything.

---

## Layout

```
index.html                     the portal
assets/css/styles.css          three themes as custom-property blocks
assets/js/app.js               state, filters, rendering, events
assets/js/render.js            templates (everything is escaped here)
assets/js/util.js              dates, .ics, escaping, URL validation
assets/js/icons.js             inline SVG icons
crawler/index.mjs              orchestrator
crawler/validate.mjs           CI gate on the published feed
crawler/demo.mjs               fabricated sample data for offline UI work
crawler/lib/core.mjs           fetch with retries, HTML and feed parsing, dates
crawler/lib/classify.mjs       type, domains, scope, mode, status, relevance
crawler/lib/normalize.mjs      the event schema, plus cross-source deduplication
crawler/sources/*.mjs          one adapter per source
crawler/config/sources.json    which adapters run, thresholds, extra feeds
crawler/config/taxonomy.json   every keyword list
data/events.json               generated feed, committed by the daily workflow
.github/workflows/crawl.yml    the daily crawl
.github/workflows/pages.yml    Pages deployment
```

---

Listings are gathered automatically from public websites and are provided for
information only. Dates, fees, eligibility and rules change without notice.
Always verify on the organiser's official page before registering.
