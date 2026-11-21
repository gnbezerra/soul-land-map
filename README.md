# Soul Land Map

Interactive maps with filterable markers for Soul Land: New World (unofficial fan project).
Live site: <https://gnbezerra.github.io/soul-land-map/>. Repository: <https://github.com/gnbezerra/soul-land-map>.

## For players

Open <https://gnbezerra.github.io/soul-land-map/> and pick a region in the top bar.

- Click a marker for its details and "Mark as found". On a Divine Trial, click the last layer you finished.
- The sidebar filters by category and counts what you found against the game's own totals.
  "Hide found markers" leaves only what is still to find.
- Your progress is saved in this browser only. Another browser or device, or clearing the site's data,
  starts empty: use "Export" in the sidebar to save a backup file, and "Import" to restore it.

Found a mistake (a marker in the wrong place, a missing chest, a wrong name or translation)?
[Open an issue](https://github.com/gnbezerra/soul-land-map/issues/new) (needs a free GitHub account) with
the marker's link ("Copy link" in its popup), what is wrong, and a game screenshot if you have one.

## Documentation

This table is the map of the documentation: which document answers which question, and so where each new
piece of information goes. Read them in this order: `CLAUDE.md` first (AI agents load it on their own), then
the others from top to bottom. `docs/LICENSING.md` is a reference, read when needed.

| Document | Answers | Put there |
|---|---|---|
| [`CLAUDE.md`](CLAUDE.md) | How do I work in this repo? | Rules: invariants, current decisions with the trigger to revisit each, the checks before pushing. Changes need the owner's explicit approval. |
| `README.md` (this file) | What is this, how do I use the site, how do I run and test it? | The player guide, setup, test and CI commands, and this map. |
| [`docs/DATA.md`](docs/DATA.md) | How do I add or fix data, or add a region? | Procedures for the data and the assets: CSV columns, the build and its checks, the game tables, collecting in-game, calibration, adding a region, tiles and icons. |
| [`docs/SPEC.md`](docs/SPEC.md) | How does the site work, and why? | The design: principles, data model, storage formats, interface behavior, design decisions and their reasons. Planned features too, marked as planned. |
| [`docs/GAME-NOTES.md`](docs/GAME-NOTES.md) | How does the game work? | Facts about the game, with their source and date: regions, counts, exploration rules, loot, bosses, quirks of the game's texts. |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Where is the project, and what comes next? | Current state, next steps, what waits on the owner, known gaps, maintenance notes for fragile parts. Dated. |
| [`docs/LICENSING.md`](docs/LICENSING.md) | What may I reuse, and under which license? | What each license covers and what is excluded. |

Where a piece of information goes, when unsure: a fact about the game → GAME-NOTES; a decision about the site
→ SPEC; a procedure → DATA (data and assets) or this file (running and testing); a status, a plan or a
date-bound gap → ROADMAP; a rule for how to work → CLAUDE.md (with the owner's approval). Why one piece of
code is written the way it is goes in a comment next to that code, not in these documents.

Each fact lives in one document, and the others point to it by document and section, for example
`docs/DATA.md` "Calibration" or SPEC §4.5 (SPEC sections are cited by number, so they are never renumbered).
When something changes, update the one place that holds it.

## Running it

Tiles and Leaflet 1.9.4 are committed, so a fresh checkout runs as is:
`python -m http.server 8000` and open <http://localhost:8000>.

Unit tests (Node's built-in runner, nothing to install): `node --test tests/`.
Pipeline tests (Python's `unittest`, made-up CSVs in a temporary directory; about 10 s):
`python -m unittest discover -s tests`.
Browser test (needs Chrome; about 15 s): `node tests/browser.mjs`, with `--shots <dir>` to save screenshots
and `CHROME=<path>` if Chrome is not in a standard place.

CI and deploy: `.github/workflows/ci.yml` runs on every push and pull request. It validates every map in
`data/maps.json`, rebuilds the data and fails if the result differs from the committed JSON, then runs the
pipeline, unit and browser tests. On `main`, and only when all of that passes, it publishes the repo as is to
GitHub Pages (Settings → Pages → Source must be "GitHub Actions"), so a push that fails the checks leaves the
previous site up. When a browser test fails, its screenshots are attached to the run as the `browser-shots`
artifact. To redeploy without a new commit, run the workflow by hand (Actions → CI → Run workflow) on `main`.

Leaflet lives in `vendor/leaflet` (`leaflet.js`, `leaflet.css`, `LICENSE`; its PNG images are
not needed for now). To update it, download the same files for the new version from
`https://unpkg.com/leaflet@<version>/dist/` and `https://unpkg.com/leaflet@<version>/LICENSE`.

## License

- Code: MIT, see [`LICENSE`](LICENSE).
- The site's own data and texts: CC BY 4.0, see [`docs/LICENSING.md`](docs/LICENSING.md) (what it covers) and
  [`LICENSE-CC-BY.txt`](LICENSE-CC-BY.txt) (legal code).
- The game's material (map tiles, icons, official names and descriptions) belongs to its rights holders and
  is under neither license. Unofficial fan project, not affiliated with the game's developers or publishers.
