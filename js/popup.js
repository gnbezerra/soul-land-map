// What a marker popup says: title, tags and the extra fields. Pure: no DOM and no Leaflet, so it is easy to
// test. `i18n` is the object from js/i18n.js loadI18n (t, entry, marker); `entries` is data/entries/<map>.json.
import { UNLISTED_TAG } from "./model.js";
import { portalTitle } from "./portals.js";

// Extra marker fields shown in the popup when present. A Divine Trial shows its subtype in the type line
// instead, the pillar of a challenge chest is also drawn on the map while its popup is open, and a portal's
// destination (`to`) is in its title.
export const POPUP_FIELDS = ["subtype", "players", "contract", "pillar", "species", "seed", "requiresSeed"];
// Fields whose value is a code with a translated name: field -> i18n key prefix (e.g. "contract.wood").
const NAMED_VALUES = { contract: "contract" };

// Own name (trials, books, teleports, viewpoints) first, then the entry name (with the marker's number in
// the game's answer), then, for a portal, its destination ("Portal to ..."), then the type.
export function markerTitle(m, i18n) {
  const own = i18n.marker(m.id).name;
  if (own) return own;
  if (m.type === "portal" && m.to) return portalTitle(m, i18n);
  if (m.entry) return i18n.entry(m.entry).name + (m.entryIndex ? ` #${m.entryIndex}` : "");
  return i18n.t(`type.${m.type}`);
}

// A marker's requirements: its entry's tags, then its own (SPEC 4.3), without repeats. "unlisted" is not a
// requirement: the entry's description already says what it means.
export function effectiveTags(m, entries) {
  return [...new Set([...(entries[m.entry]?.tags ?? []), ...(m.tags ?? [])])].filter((t) => t !== UNLISTED_TAG);
}

// [{ field, value }] for the extra fields this marker has, in POPUP_FIELDS order, with `value` ready to show.
export function popupFields(m, i18n) {
  const isTrial = (m.stages?.length ?? 0) > 0;
  return POPUP_FIELDS
    .filter((f) => m[f] != null && m[f] !== "" && !(f === "subtype" && isTrial))
    .map((f) => {
      let value = String(m[f]);
      if (f === "pillar") value = `X ${m.pillar.x}, Y ${m.pillar.y}`;
      else if (NAMED_VALUES[f]) value = i18n.t(`${NAMED_VALUES[f]}.${m[f]}`, value);
      return { field: f, value };
    });
}

// Contract chests use up their contract for good when opened; their popup says so.
export function consumesContract(m) {
  return m.type === "chest_contract";
}
