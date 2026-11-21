// The published version shown at the foot of the sidebar: when the map data last changed, and the commit
// that is live. Pure: no DOM, so it is easy to test.
//
// `version.json` is committed with null fields, so a local server shows nothing (and logs no 404). The
// deploy job in .github/workflows/ci.yml overwrites it in the published site only:
//   { "commit": "<full sha of the deployed commit>", "dataDate": "<YYYY-MM-DD of the last commit to data/>" }
// The date is the data's, not the deploy's: every push deploys, and a docs-only push must not look like
// a data update to players.

export const REPO = "https://github.com/gnbezerra/soul-land-map";

// version.json -> { commit, short, url, dataDate } or null when there is nothing to show (the committed
// placeholder, a missing file, or anything malformed). A bad date alone drops the date, not the commit.
export function parseVersion(raw) {
  const commit = raw?.commit;
  if (typeof commit !== "string" || !/^[0-9a-f]{7,40}$/.test(commit)) return null;
  const date = raw.dataDate;
  const dataDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? date : null;
  return { commit, short: commit.slice(0, 7), url: `${REPO}/commit/${commit}`, dataDate };
}

// "2026-11-21" in the reader's language: "Nov 21, 2026", "21 de nov. de 2026", "2026年11月21日". The date
// is a calendar day, so it is read and written in UTC: no time zone can move it to the day before.
export function formatDataDate(date, lang) {
  return new Intl.DateTimeFormat(lang, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00Z`));
}
