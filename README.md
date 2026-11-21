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
| --- | --- | --- |
| [`CLAUDE.md`](CLAUDE.md) | How do I work in this repo? | Rules: invariants, current decisions with the trigger to revisit each, the checks before pushing. Changes need the owner's explicit approval. |
| `README.md` (this file) | What is this, how do I use the site, how do I run and test it? | The player guide, setup, test and CI commands, and this map. |
| [`docs/DATA.md`](docs/DATA.md) | How do I add or fix data, or add a region? | Procedures for the data and the assets: CSV columns, the build and its checks, the game tables, collecting in-game, calibration, adding a region, tiles and icons. |
| [`docs/SPEC.md`](docs/SPEC.md) | How does the site work, and why? | The design: principles, data model, storage formats, interface behavior, design decisions and their reasons. Planned features too, marked as planned. |
| [`docs/GAME-NOTES.md`](docs/GAME-NOTES.md) | How does the game work? | Facts about the game, with their source and date: regions, counts, exploration rules, loot, bosses, quirks of the game's texts. |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Where is the project, and what comes next? | Current state, next steps, what waits on the owner, known gaps, maintenance notes for fragile parts. Dated. |
| [`docs/LICENSING.md`](docs/LICENSING.md) | What may I reuse, and under which license? | What each license covers and what is excluded. |

Where a piece of information goes, when unsure:

| It is... | It goes in |
| --- | --- |
| a fact about the game | GAME-NOTES |
| a decision about the site, or how a feature works | SPEC |
| a procedure for the data or the assets | DATA |
| a procedure for running, testing or deploying | this file |
| a status, a plan, or a gap with a date | ROADMAP |
| a rule for how to work in the repo | CLAUDE.md, with the owner's approval |
| why one piece of code is written the way it is | a comment next to that code |

Each fact lives in one document, and the others point to it by document and section: `docs/DATA.md`
"Calibration", SPEC §4.5. SPEC sections are cited by number, so they are never renumbered. When something
changes, update the one place that holds it.

### Writing the docs

- English, as everything in the repo. Wrap prose at about 110 columns; `npm run lint:md` enforces 120 and the
  rest of the Markdown rules (README "Checks").
- One idea per sentence. A list for three or more parallel items, a table for fields, options or anything
  compared along the same columns, numbered steps for a procedure.
- Say what something is or does first, then why.
- Quote UI labels exactly as the English UI shows them (`i18n/en.json`): "Mark as found", "Show only this".
- Use the terms of SPEC §4 (map, marker, type, entry, layer...) with that meaning.
- Write dates as YYYY-MM-DD, and date what was observed or decided ("checked by the owner on 2026-11-17").
- Mark what is not built yet as "planned" or "not implemented yet".

## Running it

You need Python 3 and a browser. The tiles and Leaflet are committed, so a fresh checkout runs as is:

```text
python -m http.server 8000
```

Then open <http://localhost:8000>.

### Checks

Run them all before pushing (`CLAUDE.md` "Before finishing or pushing"); CI runs the same ones.

| Check | Command | Needs | Time |
| --- | --- | --- | --- |
| Unit tests (the pure `js/` modules) | `node --test tests/` | Node | under 1 s |
| Pipeline tests (`tools/`, on made-up CSVs) and the docs' cross-references | `python -m unittest discover -s tests` | Python | about 10 s |
| Browser test (the real site in headless Chrome) | `node tests/browser.mjs` | Node, Chrome | about 15 s |
| Data of each map | `python tools/build_data.py <map> --check` | Python | under 1 s |
| Markdown lint | `npm run lint:md` (after `npm ci` once) | Node | about 1 s |

The browser test takes `--shots <dir>` to save screenshots, `--only <text>` to run the checks whose name
contains that text, and `CHROME=<path>` when Chrome is not in a standard place. The lint rules are in
`.markdownlint-cli2.jsonc`, which the VS Code markdownlint extension reads too.

### CI and deploy

`.github/workflows/ci.yml` runs on every push and pull request. It runs the checks above, and it rebuilds the
data and fails when the result differs from the committed JSON. On `main`, and only when all of that passes,
it publishes the repo as is to GitHub Pages, so a push that fails the checks leaves the previous site up.

- Pages must be set to deploy from Actions: Settings → Pages → Source: "GitHub Actions".
- The deploy writes `version.json` (the published commit and the day the data last changed) into the published
  copy, for the line under the sidebar's disclaimer (SPEC §7.1). The repo keeps a placeholder with null fields.
- When the browser test fails, its screenshots are attached to the run as the `browser-shots` artifact.
- To redeploy without a new commit, run the workflow by hand on `main`: Actions → CI → Run workflow.

### Updating Leaflet

Leaflet lives in `vendor/leaflet`: `leaflet.js`, `leaflet.css` and `LICENSE` (its PNG images are not
needed). To update it, download the same three files for the new version from
`https://unpkg.com/leaflet@<version>/dist/` and `https://unpkg.com/leaflet@<version>/LICENSE`.

## License

- Code: MIT, see [`LICENSE`](LICENSE).
- The site's own data and texts: CC BY 4.0, see [`docs/LICENSING.md`](docs/LICENSING.md) (what it covers) and
  [`LICENSE-CC-BY.txt`](LICENSE-CC-BY.txt) (legal code).
- The game's material (map tiles, icons, official names and descriptions) belongs to its rights holders and
  is under neither license. Unofficial fan project, not affiliated with the game's developers or publishers.
