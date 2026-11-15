// Deep links: #<map> opens a map, #<map>/<marker id> also opens that marker's popup (SPEC 7). A plain hash
// is the only form GitHub Pages can serve (no routes, no server). Pure: no DOM, so it is easy to test.

// { mapId, markerId } from location.hash; each is null when missing.
export function parseHash(hash) {
  let text = String(hash ?? "").replace(/^#/, "");
  try {
    text = decodeURIComponent(text);
  } catch {
    // A malformed escape: read it as typed.
  }
  const [mapId, markerId] = text.split("/");
  return { mapId: mapId || null, markerId: markerId || null };
}

export function mapHash(mapId) {
  return `#${mapId}`;
}

export function markerHash(mapId, markerId) {
  return `#${mapId}/${markerId}`;
}

// The link to share for a marker. `pageUrl` is the page's address; its query (e.g. ?lang=pt) and hash are
// dropped, so whoever opens the link gets the site in their own language.
export function markerLink(pageUrl, mapId, markerId) {
  const url = new URL(pageUrl);
  url.search = "";
  url.hash = markerHash(mapId, markerId);
  return url.href;
}
