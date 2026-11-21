# CLAUDE.md

**Soul Land Map** is an unofficial interactive-map fansite for *Soul Land: New World*, live at
<https://gnbezerra.github.io/soul-land-map/> (GitHub Pages, deployed from `main` by CI). Read `README.md` (running it),
`docs/DATA.md` (data pipeline, game data, calibration, adding a region), `docs/SPEC.md` (design and behavior),
`docs/GAME-NOTES.md` (facts about the game: counts, rules, loot) and `docs/ROADMAP.md` (state, next steps,
known gaps). This file holds the rules; the details live there.

## Invariants

Never break these. If a task seems to need it, stop and ask.

- **Users' saved progress.** Players keep their progress in the browser (`slmap:v1:*`) and in backup files.
  A change to either format needs a migration of the stored data, old backups must keep importing, and both
  need tests. All `localStorage` access goes through `js/storage.js`, wrapped in try/catch, and the site
  must keep working when storage is unavailable.
- **Every push to `main` is a deploy** once CI passes (`.github/workflows/`). Run the checks below before
  pushing anyway: a red CI run keeps the old site up, but `main` stays broken until it is fixed.
- **Marker ids** (`<map>-0001`) are permanent: never reused, renumbered or derived from a row or position.
  Progress is keyed by them. Entries are identified by (map, slug).
- **Markers store game coordinates**, never pixels. The conversion lives in `js/geo.js` and `data/maps.json`.
- **Generated files are never edited by hand** (`data/markers/*.json`, `data/entries/*.json`,
  `i18n/entries.*`, `i18n/markers.*`). Edit `data/src/<map>/*.csv`, then run
  `python tools/build_data.py <map>`. The committed JSON must always match the CSVs.
- **The owner's data.** The CSVs under `data/src/` and the calibration in `data/maps.json` are the owner's,
  whether collected in-game or exported from the game tables (`tools/game_data.py`) with the owner's
  approval. Do not change them without asking, not even to fix an obvious typo.
- **Relative paths only.** The site is served from a subpath (`/soul-land-map/`).
- **Browser support:** current and recent Chrome, Edge, Firefox and Safari, desktop and mobile. Use web
  features that are Baseline "widely available" (MDN); anything newer needs a fallback or the owner's approval.
- **English in the repo:** code, comments, docs, commit messages, and the English UI strings that every
  language falls back to. Add a UI key to `i18n/en.json` first, then `pt` and `zh`. Official game terms vs the
  site's own wording: SPEC §5 and §4.6.
- **Game assets:** commit only what the site uses (tiles, icons), never raw dumps or the source map images
  (`maps/` is ignored). Anything is removed on request (SPEC §10).
- **Other people's work in progress.** Check `git status` / `git diff` before editing and before committing.
  Uncommitted changes you did not make are someone's work: build on them, never revert them, and mention them
  in the commit message.

## Current decisions

These are today's choices, not bans. Each one is worth revisiting when its trigger happens; propose the
change (see "Adding complexity").

| Decision | Why | Revisit when |
| --- | --- | --- |
| Plain HTML and JS ES modules, no framework, no bundler | ~1k lines of UI; nothing a framework would remove | UI state gets hard to keep consistent by hand, or the site grows many views |
| Third-party code is vendored (`vendor/leaflet`), no CDN | no third-party requests, reproducible, survives CDN outages | a dependency is impractical to vendor |
| `package.json` holds dev tools only (today the Markdown linter), pinned by `package-lock.json`; the site has no npm dependency, and Node stays a dev tool | the linter pays for itself; nothing else needs npm | a runtime dependency or a bundler is proposed, or the dev tools get many or slow |
| Static site, no backend or database; progress lives in the browser | nothing needs accounts or shared state | cross-device sync, user accounts, in-site community contributions |
| Generated data and tiles are committed; CI deploys the repo as is to Pages | the owner previews the build locally anyway; the diffs are reviewable | repo size or build time hurts, or building the data in CI becomes simpler than committing it |
| Checks run locally and in CI on every push and pull request; deploy only after they pass; GitHub's own actions only | every push deploys, and the CSVs can be edited without an agent; the npm registry, for `npm ci`, is the one download | the checks get slow (over ~5 min) or need secrets or external services |

## Adding complexity

The owner follows YAGNI with honest trade-offs, not minimalism for its own sake: build steps, CI, automated
tests, frameworks, a backend or OAuth are all fine once they make the work easier or safer than they cost.
So:

- Do not introduce a tool, dependency, build step or service on your own. Propose it with the pain it
  removes, what it costs (setup, maintenance, lock-in, hosting), the simpler alternative, and which trigger
  above it answers.
- Do not contort the code to avoid a tool that would clearly pay for itself either: say so.

## Code and tests

- Pure logic lives in modules under `js/` that never touch the DOM, `window`, `document` or Leaflet and
  import only other pure modules, so Node can import them in tests. The one browser API allowed is
  `localStorage`, behind `js/storage.js`, which tests replace with a fake.
- Give each domain its own module (e.g. trials, exploration points, rewards) instead of growing an existing
  one. Split a module when it mixes unrelated domains or passes ~500 lines; do not split ahead of need.
- Each pure module has a matching `tests/<module>.test.mjs`. UI modules keep only the DOM and Leaflet wiring
  and call into the pure ones.
- Tests live in `tests/`: unit tests (`*.test.mjs`, Node's built-in runner, made-up data), pipeline tests
  (`test_*.py`, Python's `unittest`, made-up CSVs in a temporary `--root`, never the real ones) and the
  browser test (`tests/browser.mjs`; its header lists the gotchas of driving headless Chrome). Extend them
  with new code instead of writing throwaway scripts.

## Before finishing or pushing

- `node --test tests/`
- `python -m unittest discover -s tests`
- `node tests/browser.mjs` (needs Chrome). Real wheel, pinch and double-click zoom are not covered: check them
  by hand or say they were not checked.
- `python tools/build_data.py <map> --check` for each map; the expected warnings are listed in ROADMAP
  "Known gaps".
- `npm run lint:md` (after `npm ci` once): the Markdown lint, rules in `.markdownlint-cli2.jsonc`.
- CI runs the same list, plus a check that the committed JSON matches the CSVs.
- Update the docs when behavior or the project state changes: the one that holds that fact, per README
  "Documentation".
- When a "Current decisions" row no longer holds (its trigger happened, or a change you are making would
  contradict it), say so and propose the new text for `CLAUDE.md`. Never edit `CLAUDE.md` or
  `CLAUDE.local.md` without the owner's explicit approval of that specific change: show the proposed text
  first, and edit only after a yes.
- One commit per validated step, with a message that says why.
