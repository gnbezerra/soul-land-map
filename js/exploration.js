// Exploration value: the game's points for exploring a map, and its reward milestones. Pure: no DOM and
// no Leaflet, so it is easy to test.
//
// The rules come from the game's "Area Exploration" popup (SPEC 11) and live in data/categories.json as
// `explorationRules`: [{ id, types, points }], e.g. every chest type is worth 5 and a Divine Trial is worth
// 10 per layer. A rule's found/total are the sums of its types' counters in the model (js/model.js), so
// "total" is what the game says exists and a trial counts per layer. Types with no data yet are not in the
// model, so they add nothing to the total. The milestones are per map, in data/maps.json
// (`exploration.milestones`).

// { found, total, rules: [{ id, points, found, total }] } in points; `found`/`total` in a rule are counts.
// Rules with nothing mapped yet are left out.
export function explorationValue(model, rules = []) {
  const out = { found: 0, total: 0, rules: [] };
  for (const rule of rules) {
    const types = rule.types.map((id) => model.types.get(id)).filter(Boolean);
    const found = types.reduce((n, t) => n + t.found, 0);
    const total = types.reduce((n, t) => n + t.total, 0);
    if (!total) continue;
    out.rules.push({ id: rule.id, points: rule.points, found, total });
    out.found += found * rule.points;
    out.total += total * rule.points;
  }
  return out;
}

// Where `value` stands among the reward milestones (sorted here, so the data's order does not matter):
//   { reached: milestones reached, next: next milestone or null when all are reached, left: points to it }
// No milestones (a map without them in maps.json): { reached: 0, next: null, left: 0, none: true }.
export function milestoneStatus(value, milestones = []) {
  const sorted = [...milestones].sort((a, b) => a - b);
  if (!sorted.length) return { reached: 0, next: null, left: 0, none: true };
  const reached = sorted.filter((m) => m <= value).length;
  const next = sorted[reached] ?? null;
  return { reached, next, left: next == null ? 0 : next - value, none: false };
}

// Position of each milestone on the bar, as a percentage of the total. Milestones above the total (a map
// still being mapped) have no place on the bar and are left out.
export function milestoneMarks(milestones = [], value, total) {
  if (!total) return [];
  return [...milestones]
    .sort((a, b) => a - b)
    .filter((m) => m <= total)
    .map((m) => ({ milestone: m, percent: (100 * m) / total, reached: m <= value }));
}
