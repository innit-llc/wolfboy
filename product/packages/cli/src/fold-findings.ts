/**
 * THE FOLD (WP7, 2026-11-02).
 *
 * WHY. Two findings of one rule can be one piece of processing: a documentation page that describes the feature a product
 * file runs, or a line the review itself traced to another finding's line. Counted twice, the first screen says there
 * are two problems where there is one. The fold counts such a finding once, in the finding it repeats (its HEAD), and
 * lists it under that head in details.md with its own evidence and the reason. Nothing is dropped: the folded finding
 * keeps its entry, its anchor and its evidence; only its count moves into the head's.
 *
 * THE KEYS (design section 6.1). Fold finding F under finding H, both shown and of the SAME rule, never across rules,
 * where one holds:
 *
 *   (a) `documentation`: every kept place of F has effective `ships` `documentation`, and H has at least one kept place
 *       whose effective `ships` is `product`, `documented_example` or `depends_on_deployment` (a place with no value,
 *       which the disposition treats as shipping, is taken as `depends_on_deployment`);
 *   (b) `same_as`: F's `same_as`, as the capture let it stand (C9 moved it to the line its quotation is at), is at a kept
 *       place of H: a kept place row's matched line, its own decided line or lines, or the line beyond its window the
 *       row rests on; for a finding with no place table, a line of one of its locations.
 *
 * THE HEAD. Where several findings qualify: the highest level, then the most shipping places, then the lowest id. The
 * head's shown level is the highest of its own and its members' (never lowered).
 *
 * WHAT A FOLD NEVER DOES. These guards only ever leave a finding counted
 * on its own, the direction of doubt (design section 2.5):
 *
 *   1. A finding is never folded under a head that is not shown: the head's verdict holds (not dismissed, not
 *      overturned) and its own disposition is one the report lists as a finding (not `not_applicable`, not
 *      `settled_by_answer`).
 *   2. A finding is never folded under a head whose own placement is lighter than its own: a finding to fix is counted
 *      with a finding to fix, never inside one that is recorded, waits on a question or does not ship. Equal placements
 *      fold, except a wait (`question`, `check_answer`, `for_operators`) on anything but the same question of the
 *      program's list: two findings waiting on two different answers, or on facts named in words, are never counted as
 *      one, so an answer that turns one of them into a finding to fix always reaches it.
 *   3. No chain: a head is never itself folded, and a finding already folded is never a head. Findings are taken from
 *      the last in the head order to the first, so where two qualify for each other the one first in the head order is
 *      the head; a finding whose every qualifying head is already folded stays counted on its own.
 *
 * Pure: no file is read, no clock, no randomness. Not in the capture's closure (`VERDICT_RULES_SOURCES`): the fold
 * decides what the report counts, never what a verdict may be.
 */

/** Why a finding was folded: design section 6.1's key (a) or key (b). */
export type FoldKey = "documentation" | "same_as";

/** One adjudicated finding as the fold reads it, resolved by the caller from its record, its candidate and its places. */
export interface FoldEntry {
  id: string;
  rule: string;
  /** Its verdict holds (not dismissed, not overturned): the report lists it as a finding. */
  shown: boolean;
  /** Its own disposition, computed with no fold (disposition.ts `dispositionOf`). */
  disposition: string;
  /** Its own shown level with no fold: its raise's, else its rule's. */
  level: string;
  /** The effective `ships` of its decisive place and of each kept place (disposition.ts `effectiveShipsOf`). */
  ships?: { decisive?: string; kept: readonly (string | undefined)[] };
  /** Its kept places, as lines: a place row's matched line, decided lines and line beyond; or a location's lines. */
  places: readonly { file: string; from: number; to: number }[];
  /** The line its review traced it to (`standing.same_as` that stood), or absent. */
  sameAs?: { file: string; line: number };
  /** The question of the program's list it waits on (`question`, or a `needs_human`'s `settles: question:`), or absent. */
  waitsOn?: string;
}

/** One fold: the head a finding is counted with, and why. */
export interface Fold {
  head: string;
  key: FoldKey;
  /** Key (b): the line of the head the review traced this finding to. */
  at?: { file: string; line: number };
}

export interface FoldResult {
  /** Each folded finding's fold, by finding id. */
  folded: Map<string, Fold>;
  /** Each head's shown level where one of its members is higher than its own (never lower), by head id. */
  levelOf: Map<string, string>;
}

const LEVEL_RANK: Readonly<Record<string, number>> = { high: 0, medium: 1, low: 2 };
const rankOfLevel = (l: string): number => LEVEL_RANK[l] ?? 3;

/** The `ships` values a head's place must have under key (a): the feature is in what ships (design section 6.1). */
const SHIPPING_HEAD: ReadonlySet<string> = new Set(["product", "documented_example", "depends_on_deployment"]);
const shipsForHead = (v: string | undefined): boolean => v === undefined || SHIPPING_HEAD.has(v);

/**
 * How heavily each disposition counts (guard 2): a finding is folded only under a head whose own placement is at least
 * this heavy. A disposition with no weight is never a head (guard 1).
 */
const WEIGHT: Readonly<Record<string, number>> = {
  to_fix: 6,
  counsel: 5,
  question: 4,
  check_answer: 4,
  for_operators: 3,
  recorded: 2,
  not_shipped: 1,
};
/** The placements that wait on an answer: never folded under an equal placement (guard 2). */
const WAITING: ReadonlySet<string> = new Set(["question", "check_answer", "for_operators"]);

const isHeadShown = (h: FoldEntry): boolean => h.shown && WEIGHT[h.disposition] !== undefined;

/** Guard 2: the head's own placement is not lighter than the finding's. */
function notLighter(f: FoldEntry, h: FoldEntry): boolean {
  const wf = WEIGHT[f.disposition];
  const wh = WEIGHT[h.disposition];
  if (wf === undefined || wh === undefined) return false;
  if (wh > wf) return true;
  if (wh !== wf || f.disposition !== h.disposition) return false;
  return !WAITING.has(f.disposition) || (typeof f.waitsOn === "string" && f.waitsOn !== "" && f.waitsOn === h.waitsOn);
}

/** Key (a): every kept place of F is documentation. */
function onlyDocumentation(f: FoldEntry): boolean {
  const s = f.ships;
  if (!s || s.kept.length === 0) return false;
  if (s.decisive !== undefined && s.decisive !== "documentation") return false;
  return s.kept.every((v) => v === "documentation");
}
/** Key (a): H has a kept place in what ships. */
function shippingPlaces(h: FoldEntry): number {
  return (h.ships?.kept ?? []).filter(shipsForHead).length;
}
/** Key (b): the traced line is at one of H's kept places. */
function atPlaceOf(at: { file: string; line: number }, h: FoldEntry): boolean {
  return h.places.some((p) => p.file === at.file && at.line >= p.from && at.line <= p.to);
}
const validLine = (x: FoldEntry["sameAs"]): x is { file: string; line: number } =>
  !!x && typeof x.file === "string" && x.file !== "" && Number.isInteger(x.line) && x.line > 0;

/** The head order: highest level, then most shipping places, then lowest id. */
function headOrder(x: FoldEntry, y: FoldEntry): number {
  return rankOfLevel(x.level) - rankOfLevel(y.level) || shippingPlaces(y) - shippingPlaces(x) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
}

/** The key under which F may be counted with H, or null (the guards, then key (b), then key (a)). */
function keyOf(f: FoldEntry, h: FoldEntry): Fold | null {
  if (f.id === h.id || f.rule === "" || f.rule !== h.rule) return null;
  if (!f.shown || !isHeadShown(h) || !notLighter(f, h)) return null;
  if (validLine(f.sameAs) && atPlaceOf(f.sameAs, h)) return { head: h.id, key: "same_as", at: { file: f.sameAs.file, line: f.sameAs.line } };
  if (onlyDocumentation(f) && shippingPlaces(h) > 0) return { head: h.id, key: "documentation" };
  return null;
}

/** The fold of one run's adjudicated findings (design section 6.1). Pure. */
export function foldFindings(entries: readonly FoldEntry[]): FoldResult {
  const folded = new Map<string, Fold>();
  const heads = new Set<string>();
  const ordered = [...entries].sort(headOrder);
  // Guard 3: from the last in the head order to the first; a head is never folded, a folded finding is never a head.
  for (const f of [...ordered].reverse()) {
    if (heads.has(f.id) || folded.has(f.id)) continue;
    for (const h of ordered) {
      if (folded.has(h.id)) continue;
      const k = keyOf(f, h);
      if (!k) continue;
      folded.set(f.id, k);
      heads.add(h.id);
      break;
    }
  }
  const byId = new Map(entries.map((e) => [e.id, e] as const));
  const levelOf = new Map<string, string>();
  for (const [id, f] of folded) {
    const h = byId.get(f.head);
    const m = byId.get(id);
    if (!h || !m) continue;
    const now = levelOf.get(h.id) ?? h.level;
    if (rankOfLevel(m.level) < rankOfLevel(now)) levelOf.set(h.id, m.level);
  }
  return { folded, levelOf };
}
