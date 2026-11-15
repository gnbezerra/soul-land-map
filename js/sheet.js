// Bottom sheet for marker popups on narrow screens (below 700 px wide, where the sidebar becomes a drawer).
// A floating popup there covers much of the map and often its own marker. Instead, Leaflet's own popup
// element is moved out of the map pane into the map's wrapper and styled as a sheet along the bottom edge
// (css/style.css, `.mk-sheet`), so its close button, closing on a map click, deep links and the
// page's own popup events all keep working. The map then frames the marker in the area left above it.
// Wider screens keep the floating popup.
export const SHEET_QUERY = "(max-width: 700px)";

export function createSheet({ map, host }) {
  const query = window.matchMedia(SHEET_QUERY);
  // Crossing the breakpoint (turning a phone, resizing the window) closes the open popup; the next one
  // opens in the form that fits.
  query.addEventListener("change", () => map.closePopup());

  return {
    // Whether popups open as a sheet now. Popups read it as their autoPan option: the sheet pans itself.
    active: () => query.matches,
    // Moves an open popup into the sheet and pans the map so the center of `latLngs` (the marker, and a
    // challenge chest's pillar) sits in the middle of the map area above the sheet.
    show(popup, latLngs) {
      const element = popup.getElement();
      if (!element) return;
      element.classList.add("mk-sheet");
      host.append(element);
      host.classList.add("sheet-open");
      const free = host.clientHeight - element.offsetHeight;
      const points = latLngs.map((latLng) => map.latLngToContainerPoint(latLng));
      const center = points.reduce((sum, p) => sum.add(p)).divideBy(points.length);
      map.panBy([center.x - host.clientWidth / 2, center.y - free / 2]);
    },
    hide() {
      host.classList.remove("sheet-open");
    },
  };
}
