// "Report a problem" at the foot of the sidebar: a link to a new GitHub issue whose body is filled in when
// it is clicked (SPEC §7.1). Pure: no DOM, so it is easy to test.
//
// It is not a GitHub issue template (nothing under .github/), only the `body` query of issues/new. The two
// prompts are in the player's language; the details under the rule are for the maintainer, so they stay in
// English: the page (with the open marker, if any), the published version and the language shown.

import { REPO } from "./version.js";

// `pageUrl`: the page's address; its query (e.g. ?lang=pt) is dropped, since the language has its own line.
// `version`: js/version.js parseVersion, or null (a local server): then the line is left out.
// `lang`: the UI language. `t`: the UI strings (js/i18n.js), for the two prompts.
export function reportBody({ pageUrl, version = null, lang, t }) {
  const page = new URL(pageUrl);
  page.search = "";
  const details = [`Page: ${page.href}`];
  if (version) details.push(`Version: ${version.short}${version.dataDate ? ` (data ${version.dataDate})` : ""}`);
  details.push(`Language: ${lang}`);
  return [`**${t("ui.reportWhat")}**`, "", "", `**${t("ui.reportScreenshot")}**`, "", "", "---", ...details]
    .join("\n");
}

export function reportUrl(args) {
  const url = new URL(`${REPO}/issues/new`);
  url.searchParams.set("body", reportBody(args));
  return url.href;
}
