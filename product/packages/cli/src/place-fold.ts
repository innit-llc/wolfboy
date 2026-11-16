/**
 * THE PER-PLACE TABLE AND THE BOUNDED FOLD.
 *
 * A candidate read by the place plan (`reading-plan-2`, unit `place`) larger than one seat is read by place seats, each
 * returning one row per place (build unit F3). When every place seat has ended, the program writes two things from the
 * captured rows - no seat retypes a place:
 *
 *   - the PER-PLACE TABLE (`placeTableOf`): every place of the candidate, in id order, with its decision, `data`,
 *     `item`, the seat's line and quote, `why`, `beyond`, read basis and seat, or the program's reason it was not
 *     checked. Written whole into `.legal/evidence/places/` (`writePlaceTable`), one JSON row per line, so a reader can
 *     Read the row of any place by its line (the row of `P<n>` is line n + 2; line 1 is the header).
 *   - the FOLD (`foldOfPlaces`): what the answer seat is handed, at most `FOLD_MAX_BYTES` by construction, by the rule's
 *     reading class. Counts of every place by decision and read basis and the not-checked places with their reason are
 *     always whole; existence and per-location list the kept places by file (the first `FOLD_FIRST_PLACES` of each file
 *     with id, file:line, data, item and quote; the rest as id ranges); enumeration lists every distinct `item` with its
 *     count and first places; mixed takes the sections of each of its limbs' classes and of per-location; dismissed
 *     places are counts by directory with id ranges. Where the places level passes the ceiling, files are listed by
 *     count and id range only, largest first; past that, directories at the deepest level whose lines fit; past that,
 *     the top directories largest first, with what is left out counted (never dropped uncounted).
 *
 * The fold is laid out (`layoutFold`) so that it is read in at most `FOLD_RANGES` fixed Read ranges of
 * `FOLD_RANGE_LINES` lines each, every one within one Read (`READ_RANGE_BYTES` with the Read's line prefixes): a range
 * that closes early is padded with blank lines, which JSON reads as whitespace. The ranges are therefore known when the
 * answer seat's brief is written, before the fold exists (`FOLD_READS`), and the capture checks that every line of the
 * fold was Read (A5).
 */
import { OWN_NAME_ITEM } from "./own-name.js";
import { makeFolder, writeFileAt } from "./project-write.js";
import { dirname, join } from "node:path";
import type { Candidate } from "wolfboy-schemas";
import { FOLD_FIRST_PLACES, FOLD_MAX_BYTES, FOLD_RANGE_LINES, FOLD_RANGES, lineSafeJson, READ_LINE_LIMIT, READ_PREFIX_BYTES, READ_RANGE_BYTES } from "./launch-plan.js";
import { compactIds, readingClassOf, readingPlanOf, type ReaderReply, type ReadingReadRow } from "./reading.js";
import { foldToken } from "./kind-key.js";
import { firstPlaceLabel, itemTextOf, matchedWordsLabel } from "./item-label.js";
import { isKeptPlace, KEPT_DECISIONS } from "./place-bar.js";
import { placeId, unitId, unitOfPlace } from "./ref-ids.js";

/* The fold's ceiling, its first-places count and its fixed Read ranges are `launch-plan.ts`'s (the brief names the
 * ranges before the fold exists, and a static import of this module there would be a load-order cycle). */
export { FOLD_FIRST_PLACES, FOLD_MAX_BYTES, FOLD_RANGE_LINES, FOLD_RANGES, FOLD_READS } from "./launch-plan.js";
/** Where the per-place tables go, under the project's `.legal/`: beside the evidence log, never read as one (not `.json`). */
export const PLACE_TABLE_DIR = join("evidence", "places");

/* The kept decisions and `isKeptPlace` are place-bar.ts's, one copy for A4 and the table. */
const KEPT = KEPT_DECISIONS;

/** One place of the per-place table. A place with no accepted row carries `not_checked` (the program's reason) instead. */
export interface PlaceTableRow {
  place: string;
  file: string;
  line: number;
  /** The vendor entry the person declared, on a place read in an own-name seat. */
  own_name?: string;
  decision?: string;
  data?: string[];
  /**
   * The item this kept place is (an enumeration). Where the rule's items come from the match
   * (`item_source` `token`, `clause` or `sub_shape`) it is the PROGRAM's item of the place's location (`programItemsOf`),
   * written on every kept place and never taken from a seat; where they are found by reading it is the seat's.
   */
  item?: string;
  /**
   * Fix C2-2: where the program holds the item, the item as the program holds it - the census's matched word
   * (`token`), the clause set that fired (`clause`), or the line's shape digest (`sub_shape`) - beside `item`, which is
   * the name it is shown by (item-label.ts). The count rests on `item`; nothing of the program's is lost.
   */
  program_item?: string;
  /** Fix C2-8: `seat` where `item` is the seat's own, because the program holds no item for this place. */
  item_by?: "seat";
  /**
   * The item a seat wrote for a place whose item the program holds, kept here (in the per-place table
   * only, never in the fold or the report) where it is not the program's item character for character. The program's
   * item stands.
   */
  seat_item?: string;
  /** The seat's line (C4), where it differs from the matched line or always for a decided place. */
  line_decided?: string;
  quote?: string;
  why?: string;
  /** The gate's kind the seat named on a `construct_but_gated` row, and its words where it is `other`. */
  gate?: string;
  gate_words?: string;
  beyond?: { file: string; line: number; quote: string };
  read_basis?: string;
  /** Which seat decided it: `reader-<n>`, or `verdict seat` where the candidate's own seat held its places. */
  seat?: string;
  /** `not_answered` (its seat gave no accepted answer, its make-up seat neither) or `unreadable` (no window written). */
  not_checked?: string;
  /**
   * Integration of F4 and F5: the place's row is an earlier run's, carried because every premise of it is
   * reproduced (carried-places.ts); no seat of this run read it. Shown as carried, never counted as read in this run.
   */
  carried_from?: { scan_id: string; finding_id: string };
}

export { isKeptPlace };

/** The item sources whose items the program holds before any seat reads a line (rule.schema.json `item_source`). */
export type ProgramItemSource = "token" | "clause" | "sub_shape";
const PROGRAM_ITEM_SOURCES: ReadonlySet<string> = new Set(["token", "clause", "sub_shape"]);

/**
 * ( "where it is `token`, `clause` or `sub_shape` the program holds the
 * item"): the item source of a candidate whose items the program holds - the rule's own `item_source`, or for a `mixed`
 * rule the one source every enumeration limb declares - or null where a seat finds the items (`reading`), the limbs
 * disagree, or the candidate carries no class.
 */
export function programItemSourceOf(candidate: Candidate): ProgramItemSource | null {
  const rc = readingClassOf(candidate);
  if (!rc) return null;
  if (rc.class !== "mixed") return rc.class === "enumeration" && rc.item_source && PROGRAM_ITEM_SOURCES.has(rc.item_source) ? (rc.item_source as ProgramItemSource) : null;
  /* Fix C2-3: a mixed rule with a limb of another class (eu-cra-002, platform-store-002: existence and
   * per-location limbs beside the enumeration) holds no program item, because nothing the rule carries says which of
   * its clauses a limb answers (`limbs[]` names a context question, not clauses), so the program cannot tell a place
   * matched for the list from one matched for a limb that lists nothing. Its kept places name no item and are counted
   * and named on the no-item line, never given an item they may not be. */
  const limbs = rc.limbs ?? [];
  if (limbs.length === 0 || limbs.some((l) => l.class !== "enumeration")) return null;
  const sources = new Set(limbs.map((l) => l.item_source ?? ""));
  const [only] = [...sources];
  return sources.size === 1 && only && PROGRAM_ITEM_SOURCES.has(only) ? (only as ProgramItemSource) : null;
}

/**
 * The program's item of every location of a candidate (index n is place P<n>), or undefined where the
 * location carries no fact to name it by. Read from the three facts the scanner writes on each location and builds the
 * kind census from (kind-census.ts, `clause`, `matched_token`, `sub_shape`), so it is the census's own item, before any
 * seat reads a line. Fix C2-2: this is the item's IDENTITY, kept as the table's `program_item`; the name it is
 * shown by is `programItemLabelsOf`'s.
 *   - `token`: the folded matched word (`matched_token`, several joined by "+", exactly as the census holds it and as the
 *     capture's census check reads it, reading.ts `censusTokens`);
 *   - `clause`: the clause set that fired ("16", "1,3"); a location no clause names (its `clause` a reading label such
 *     as `structural:...`) has no program item;
 *   - `sub_shape`: the line's shape (`sub_shape`, a digest of the line with its matched words kept).
 */
export function programItemsOf(candidate: Candidate, source: ProgramItemSource): (string | undefined)[] {
  const locs = candidate.locations as (Candidate["locations"][number] & { clause?: string; matched_token?: string; sub_shape?: string })[];
  if (source === "token") return locs.map((l) => (typeof l.matched_token === "string" && l.matched_token !== "" ? l.matched_token : undefined));
  if (source === "clause") return locs.map((l) => (typeof l.clause === "string" && /^\d+(,\d+)*$/.test(l.clause) ? l.clause : undefined));
  return locs.map((l) => (typeof l.sub_shape === "string" && l.sub_shape !== "" ? l.sub_shape : undefined));
}

/**
 * Fix C2-2: the name each program item is shown by (index n is place P<n>), from what the rule says it is
 * (item-label.ts): a `token` item by the vocabulary entry its matched word spells (`labels`, keyed by the census word:
 * "Mixpanel"), which the report takes from the bundle it is given (`itemLabelsOfCandidate`), else by its matched words
 * quoted; a `clause` or `sub_shape` item by the rule's own `item` text and the first place of that item ("route kind like
 * the one at src/ws.ts:12"). Two identities with one name are one item: one recipient is one item however many of its
 * spellings one line matched. A step that holds no bundle (the fold an answer seat reads, the capture's check of its
 * answer) passes no `labels`, so its token items are their matched words quoted; the report's names map them
 * (`shownItemNameOf`).
 */
export function programItemLabelsOf(
  candidate: Candidate,
  source: ProgramItemSource,
  items: readonly (string | undefined)[],
  itemLabels?: Readonly<Record<string, string>>,
): (string | undefined)[] {
  if (source === "token") {
    const labels = itemLabels ?? {};
    return items.map((raw) => (raw === undefined ? undefined : Object.prototype.hasOwnProperty.call(labels, raw) && labels[raw] ? labels[raw] : matchedWordsLabel(raw)));
  }
  const text = itemTextOf(candidate);
  const firstOf = new Map<string, string>();
  return items.map((raw, n) => {
    if (raw === undefined) return undefined;
    const loc = candidate.locations[n]!;
    if (!firstOf.has(raw)) firstOf.set(raw, firstPlaceLabel(text, loc.file, loc.start_line));
    return firstOf.get(raw);
  });
}

/**
 * Whether a name a seat gives is the program's item: its name (`label`), its identity (`item`), or for `token` items the
 * census's own fold of the word (`Mixpanel` is the census's `mixpanel`).
 */
export function sameProgramItem(source: ProgramItemSource | null, name: string, item: string, label?: string): boolean {
  if (name === item || (label !== undefined && name === label)) return true;
  if (label !== undefined && name.toLowerCase() === label.toLowerCase()) return true;
  return source === "token" && foldToken(name) === item;
}

/**
 * Fix C2-2: the name the report shows for an item a seat named. The answer seat named it against the fold
 * and the capture checked it against a table made with no bundle, where a token item is shown by its matched words
 * quoted; the report's table names the same item by its vocabulary entry. A name that is a kept place's shown name stays;
 * a name that is a kept place's program item (as itself, by the census's fold, or by its matched words quoted) is shown
 * by that place's name; any other name stays as the seat gave it.
 */
export function shownItemNameOf(table: readonly PlaceTableRow[], source: ProgramItemSource | null, name: string): string {
  const kept = table.filter((r) => r.decision !== undefined && KEPT.has(r.decision) && typeof r.item === "string" && r.item !== "");
  if (kept.some((r) => r.item === name)) return name;
  const hit = kept.find(
    (r) => r.program_item !== undefined && (sameProgramItem(source, name, r.program_item, r.item) || (source === "token" && matchedWordsLabel(r.program_item) === name)),
  );
  return hit?.item ?? name;
}

/**
 * The per-place table of a place-plan candidate from the captured rows: the readers' accepted records (`replies`), and
 * the candidate's own seat's rows where it held places (`seatRows`). A place no accepted row decides is `not_checked`:
 * `unreadable` where the seat that held it answered (an unreadable place owes no row, F3), else `not_answered`.
 * `itemLabels` (fix C2-2): the names of the candidate's token items, where the caller holds the rule bundle (the report,
 * `itemLabelsOfCandidate`); absent, each is shown by its matched words.
 */
export function placeTableOf(
  candidate: Candidate,
  replies: readonly ReaderReply[],
  seatRows: readonly ReadingReadRow[] = [],
  itemLabels?: Readonly<Record<string, string>>,
): PlaceTableRow[] {
  const plan = readingPlanOf(candidate);
  // The places read in an own-name seat (the document's plan, `reader_slices[].own_name`).
  const raw = candidate.reading_plan as unknown as { order?: unknown; reader_slices?: { from?: unknown; to?: unknown; own_name?: unknown }[] } | undefined;
  const ownNamed = new Map<number, string>();
  for (const sl of Array.isArray(raw?.reader_slices) ? raw!.reader_slices : []) {
    if (typeof sl.own_name !== "string" || typeof sl.from !== "number" || typeof sl.to !== "number") continue;
    for (let p = sl.from; p <= sl.to; p++) ownNamed.set(Array.isArray(raw!.order) && typeof raw!.order[p] === "number" ? (raw!.order[p] as number) : p, sl.own_name);
  }
  const holder = new Map<string, number>();
  (plan?.reader_slices ?? []).forEach((slice, i) => slice.forEach((id) => holder.set(id, i + 1)));
  const own = replies.filter((r) => r.finding_id === candidate.finding_id);
  const returned = new Set(own.map((r) => r.reader).filter((n): n is number => typeof n === "number"));
  const rowOf = new Map<string, { row: ReadingReadRow; seat: string }>();
  for (const reply of own) {
    for (const row of reply.rows) {
      const unit = (row.place ? unitOfPlace(row.place) : null) ?? row.kind;
      if (!rowOf.has(unit)) rowOf.set(unit, { row, seat: reply.kept_from ? `verdict seat ${reply.kept_from} (its verdict did not hold; its place rows were kept)` : `reader-${reply.reader ?? "?"}` });
    }
  }
  for (const row of seatRows) {
    const unit = (row.place ? unitOfPlace(row.place) : null) ?? row.kind;
    if (!rowOf.has(unit)) rowOf.set(unit, { row, seat: "verdict seat" });
  }
  /* Where the program holds the items, the table's `item` is the program's, on every kept place, and a
   * seat's own `item` is kept apart as `seat_item` wherever it is not the program's item. Where the location carries no
   * fact to name its item by, the seat's item is taken, as for a rule whose items are found by reading. */
  const source = programItemSourceOf(candidate);
  const programItems = source ? programItemsOf(candidate, source) : null;
  const programLabels = source && programItems ? programItemLabelsOf(candidate, source, programItems, itemLabels) : null;
  return candidate.locations.map((loc, n) => {
    const base = { place: placeId(n), file: loc.file, line: loc.start_line, ...(ownNamed.has(n) ? { own_name: ownNamed.get(n)! } : {}) };
    const got = rowOf.get(unitId(n));
    if (!got) {
      const reader = holder.get(unitId(n));
      const answered = reader === undefined ? seatRows.length > 0 : returned.has(reader);
      return { ...base, not_checked: answered ? "unreadable" : "not_answered" };
    }
    const r = got.row;
    const programItem = programItems?.[n];
    const label = programLabels?.[n] ?? programItem;
    const kept = r.disposition !== undefined && KEPT.has(r.disposition);
    /* Fix C2-2: `item` is the name the item is shown by and counted under, `program_item` the program's
     * identity of it beside; a seat's own item stays apart as `seat_item` where it is neither. Fix C2-8: where the
     * program holds no item for the place, the seat's item is taken and marked as the seat's. */
    const itemFields =
      programItem === undefined
        ? r.item
          ? { item: r.item, item_by: "seat" as const }
          : {}
        : {
            ...(kept ? { item: label, program_item: programItem } : {}),
            ...(r.item && !(kept && (r.item === label || r.item === programItem)) ? { seat_item: r.item } : {}),
          };
    return {
      ...base,
      decision: r.disposition,
      data: r.data ?? [],
      ...itemFields,
      line_decided: r.lines,
      quote: r.quote,
      ...(r.ground ? { why: r.ground } : {}),
      ...(r.gate ? { gate: r.gate } : {}),
      ...(r.gate_words ? { gate_words: r.gate_words } : {}),
      ...(r.beyond ? { beyond: r.beyond } : {}),
      read_basis: r.read_basis ?? "window",
      ...(r.carried_from ? { carried_from: r.carried_from, seat: `carried from scan ${r.carried_from.scan_id}` } : { seat: got.seat }),
    };
  });
}

/** The path of a candidate's per-place table under the project's `.legal/` directory. */
export function placeTablePath(legalDir: string, findingId: string): string {
  return join(legalDir, PLACE_TABLE_DIR, `${findingId.replace(/[^A-Za-z0-9._-]/g, "_")}.places.jsonl`);
}

/** Write the table: a header line, then one row per place in id order (the row of `P<n>` is line n + 2). */
export function writePlaceTable(path: string, candidate: Candidate, table: readonly PlaceTableRow[]): void {
  makeFolder(dirname(path), { recursive: true });
  const header = { finding_id: candidate.finding_id, rule_id: candidate.rule_id, places: table.length, row_of_place: "the row of place P<n> is line n + 2 of this file" };
  writeFileAt(path, `${[header, ...table].map((r) => JSON.stringify(r)).join("\n")}\n`);
}

/** The classes whose sections a candidate's fold carries: its own, or for `mixed` each limb's and per-location's. */
export function foldClassesOf(candidate: Candidate): string[] {
  const rc = readingClassOf(candidate);
  const cls = rc?.class ?? "per-location";
  if (cls !== "mixed") return [cls];
  const limbs = (rc?.limbs ?? []).map((l) => l.class).filter((c): c is string => typeof c === "string" && c !== "mixed");
  return [...new Set([...limbs, "per-location"])].sort();
}

const dirOf = (file: string, depth?: number): string => {
  const parts = file.split("/");
  parts.pop();
  const kept = depth === undefined ? parts : parts.slice(0, depth);
  return kept.length > 0 ? kept.join("/") : ".";
};
const placeLine = (r: PlaceTableRow) => ({ id: r.place, at: `${r.file}:${r.line}`, data: r.data ?? [], ...(r.item ? { item: r.item } : {}), quote: r.quote ?? "" });
const groupBy = <T>(rows: readonly T[], key: (r: T) => string): Map<string, T[]> => {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
};
const largestFirst = <T>(m: Map<string, T[]>): [string, T[]][] => [...m.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
/** The longest id-range text the fold writes for one list; a longer one (places interleaved with other decisions) is its span. */
export const FOLD_IDS_MAX_CHARS = 400;
/**
 * A list of places as id ranges, or, where the ranges run longer than `FOLD_IDS_MAX_CHARS` (the places lie between
 * places of other decisions), as its first and last id with its count: every one of them is a row of the per-place table.
 */
const ids = (rows: readonly PlaceTableRow[]): string => {
  const compact = compactIds(rows.map((r) => r.place));
  if (compact.length <= FOLD_IDS_MAX_CHARS || rows.length === 0) return compact;
  return `${rows.length} places from ${rows[0]!.place} to ${rows[rows.length - 1]!.place}, between places of other decisions: each is a row of the per-place table`;
};

/** How finely the fold lists places: one by one, by file, by directory at a depth, or the top directories capped. */
export type FoldLevel = "places" | "files" | `directories:${number}` | `capped:${number}`;

/** The sections of a list of places (kept or undetermined) at a level. */
function byWhere(rows: readonly PlaceTableRow[], level: FoldLevel): unknown[] {
  if (level === "places") {
    return [...groupBy(rows, (r) => r.file).entries()].map(([file, list]) => ({
      file,
      places: list.length,
      first: list.slice(0, FOLD_FIRST_PLACES).map(placeLine),
      ...(list.length > FOLD_FIRST_PLACES ? { rest: ids(list.slice(FOLD_FIRST_PLACES)) } : {}),
    }));
  }
  if (level === "files") return largestFirst(groupBy(rows, (r) => r.file)).map(([file, list]) => ({ file, places: list.length, ids: ids(list) }));
  const [kind, n] = level.split(":") as [string, string];
  const depth = Number(n);
  const groups = largestFirst(groupBy(rows, (r) => dirOf(r.file, kind === "capped" ? 1 : depth)));
  const shown = kind === "capped" ? groups.slice(0, depth) : groups;
  const out: unknown[] = shown.map(([directory, list]) => ({ directory, files: new Set(list.map((r) => r.file)).size, places: list.length, ids: ids(list) }));
  if (shown.length < groups.length) {
    const left = groups.slice(shown.length);
    out.push({ not_listed: { directories: left.length, places: left.reduce((s, [, l]) => s + l.length, 0), where: "every one of them is a row of the per-place table" } });
  }
  return out;
}

/** The enumeration section: every distinct item with its count, and its first places at the places level. */
function itemsSection(kept: readonly PlaceTableRow[], level: FoldLevel): unknown[] {
  const groups = largestFirst(groupBy(kept.filter((r) => r.item), (r) => r.item as string));
  const cap = level.startsWith("capped:") ? Number(level.split(":")[1]) : Infinity;
  const shown = groups.slice(0, cap);
  const out: unknown[] = shown.map(([item, list]) =>
    level === "places"
      ? { item, places: list.length, first: list.slice(0, FOLD_FIRST_PLACES).map(placeLine), ...(list.length > FOLD_FIRST_PLACES ? { rest: ids(list.slice(FOLD_FIRST_PLACES)) } : {}) }
      : { item, places: list.length, first_place: list[0]!.place },
  );
  if (shown.length < groups.length) {
    const left = groups.slice(shown.length);
    out.push({ not_listed: { items: left.length, places: left.reduce((s, [, l]) => s + l.length, 0), where: "every one of them is a row of the per-place table" } });
  }
  const noItem = kept.filter((r) => !r.item);
  if (noItem.length > 0) out.push({ kept_places_with_no_item: noItem.length, ids: ids(noItem) });
  return out;
}

/** The fold document at one level. */
function foldDoc(candidate: Candidate, table: readonly PlaceTableRow[], level: FoldLevel, extra: { tablePath?: string; readers?: unknown }): Record<string, unknown> {
  const classes = foldClassesOf(candidate);
  const kept = table.filter(isKeptPlace);
  const undetermined = table.filter((r) => r.decision === "undetermined");
  const dismissed = table.filter((r) => r.decision === "not_the_construct");
  const notChecked = table.filter((r) => r.not_checked);
  const count = (key: (r: PlaceTableRow) => string | undefined): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const r of table) {
      const k = key(r);
      if (k) out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  };
  const depth = level.startsWith("directories:") ? Number(level.split(":")[1]) : level.startsWith("capped:") ? 1 : undefined;
  const dismissedGroups = largestFirst(groupBy(dismissed, (r) => dirOf(r.file, depth)));
  const cap = level.startsWith("capped:") ? Number(level.split(":")[1]) : Infinity;
  const dismissedShown = dismissedGroups.slice(0, cap);
  return {
    fold: "the program's fold of the place rows of one candidate (full-read design section 3); no seat wrote any line of it",
    finding_id: candidate.finding_id,
    rule_id: candidate.rule_id,
    reading_class: classes.length === 1 ? classes[0] : { class: "mixed", sections: classes },
    level,
    places: table.length,
    ...(extra.tablePath ? { per_place_table: { path: extra.tablePath, row_of_place: "the row of place P<n> is line n + 2; Read any row, or any place's window, you need" } } : {}),
    counts: {
      by_decision: count((r) => r.decision),
      by_read_basis: count((r) => (r.decision && !r.carried_from ? r.read_basis ?? "window" : undefined)),
      ...(table.some((r) => r.carried_from) ? { carried_from_an_earlier_scan: table.filter((r) => r.decision && r.carried_from).length } : {}),
      not_checked: notChecked.length,
      decided_with_a_line_outside_the_window: table.filter((r) => r.beyond).length,
    },
    not_checked: [...groupBy(notChecked, (r) => r.not_checked as string).entries()].map(([reason, list]) => ({ reason, places: list.length, ids: ids(list) })),
    ...(extra.readers ? { readers: extra.readers } : {}),
    ...(classes.includes("existence") || classes.includes("per-location") ? { kept: byWhere(kept, level) } : {}),
    ...(classes.includes("enumeration") ? { items: itemsSection(kept, level) } : {}),
    undetermined: byWhere(undetermined, level),
    dismissed: [
      ...dismissedShown.map(([directory, list]) => ({ directory, places: list.length, ids: ids(list) })),
      ...(dismissedShown.length < dismissedGroups.length
        ? [{ not_listed: { directories: dismissedGroups.length - dismissedShown.length, places: dismissedGroups.slice(dismissedShown.length).reduce((s, [, l]) => s + l.length, 0) } }]
        : []),
    ],
  };
}

/**
 * The fold's text laid out in the fixed ranges, or null where it does not fit: at most `FOLD_MAX_BYTES` of content, and
 * at most `FOLD_RANGES` ranges of `FOLD_RANGE_LINES` lines whose bytes with the Read's prefixes, padding included, are
 * within one Read. A range that closes early is padded with empty lines up to its fixed end.
 */
export function layoutFold(text: string): string | null {
  if (Buffer.byteLength(text, "utf8") > FOLD_MAX_BYTES) return null;
  const lines = text.split("\n");
  const room = READ_RANGE_BYTES - FOLD_RANGE_LINES * (1 + READ_PREFIX_BYTES);
  const out: string[] = [];
  let chunk = 0;
  let count = 0;
  let bytes = 0;
  for (const line of lines) {
    const b = Buffer.byteLength(line, "utf8");
    if (b > room) return null;
    if (count + 1 > FOLD_RANGE_LINES || bytes + b > room) {
      while (count < FOLD_RANGE_LINES) {
        out.push("");
        count += 1;
      }
      chunk += 1;
      count = 0;
      bytes = 0;
    }
    if (chunk >= FOLD_RANGES) return null;
    out.push(line);
    count += 1;
    bytes += b;
  }
  return out.join("\n");
}

/** The levels tried, finest first: places, files, directories deepest first, then the top directories capped. */
function levelsOf(table: readonly PlaceTableRow[]): FoldLevel[] {
  const deepest = Math.max(1, ...table.map((r) => r.file.split("/").length - 1));
  const out: FoldLevel[] = ["places", "files"];
  for (let d = deepest; d >= 1; d--) out.push(`directories:${d}`);
  for (let cap = 1024; cap >= 1; cap = Math.floor(cap / 2)) out.push(`capped:${cap}`);
  return out;
}

/**
 * THE BOUNDED FOLD of a place-plan candidate: the finest level whose laid-out text fits (`layoutFold`). Bounded by
 * construction: the last level lists one top directory, one item, one not-checked id list and counts.
 */
export function foldOfPlaces(
  candidate: Candidate,
  table: readonly PlaceTableRow[],
  extra: { tablePath?: string; readers?: unknown } = {},
): { doc: Record<string, unknown>; text: string; level: FoldLevel } {
  let last: { doc: Record<string, unknown>; text: string; level: FoldLevel } | null = null;
  for (const level of levelsOf(table)) {
    const doc = foldDoc(candidate, table, level, extra);
    const laid = layoutFold(lineSafeJson(doc, READ_LINE_LIMIT, "", true));
    if (laid !== null) return { doc, text: `${laid}\n`, level };
    last = { doc, text: "", level };
  }
  // Not reached for any table: the capped:1 level holds counts, one directory, one item and the not-checked lists. A
  // not-checked list so long that even this does not fit is cut to its counts, which still fit.
  const doc = { ...(last as { doc: Record<string, unknown> }).doc };
  doc.not_checked = (doc.not_checked as { reason: string; places: number }[]).map((r) => ({ reason: r.reason, places: r.places, ids: "every one is a row of the per-place table" }));
  const laid = layoutFold(lineSafeJson(doc, READ_LINE_LIMIT, "", true)) ?? lineSafeJson({ finding_id: candidate.finding_id, places: table.length, level: "counts" }, READ_LINE_LIMIT, "", true);
  return { doc, text: `${laid}\n`, level: (last as { level: FoldLevel }).level };
}

/**
 * WHAT THE PERSON SEES OF A CANDIDATE READ PLACE BY PLACE (design section 3, "How the person sees it"; build unit F4): the
 * counts the report's lines and the evidence log's `places_read[]` and `not_answered` entries carry, made by the program
 * from the per-place table. `read` places are those a seat decided, each by its read basis (`window`, `fact`, and
 * `summary`, read basis `data_summary`, the program-verified data summary of build unit F6, zero while the summaries are
 * off: their capture is not built); every other place is not
 * checked, counted by its reason and the first `PLACE_SUMMARY_FIRST` listed. `beyond` counts the places decided with a
 * line outside the window, read by the seat. `items` (a class with an enumeration limb) is every distinct `item` of the
 * kept places with its place count; `kept_places` is every kept place as `P<n> file:line`.
 */
export interface PlaceSummary {
  places: number;
  /** Decided by a seat of this run (a carried row is not read in this run: `carried`). */
  read: number;
  /** Integration: decided in an earlier run and carried, with the scans they came from. */
  carried: number;
  carried_from_scans: string[];
  window: number;
  fact: number;
  summary: number;
  not_checked: { reason: string; places: number }[];
  not_checked_first: { place: string; at: string; reason: string }[];
  /** Verification A, VA-1: places a seat read and left `undetermined`, which bar `not_applicable` as A4 does; the first few listed. */
  undetermined: number;
  /** A carried place is marked; it was read and left undecided in the scan it came from. */
  undetermined_first: { place: string; at: string; carried?: true }[];
  /** How many of the undecided places were read in an earlier scan and carried. */
  undetermined_carried?: number;
  beyond: number;
  kept: number;
  kept_places: string[];
  items?: { item: string; places: number }[];
  /**
   * The kept places that name no item (a class with an enumeration limb), counted with the first
   * `PLACE_SUMMARY_FIRST` as `P<n> file:line`; where it is not 0 the list of items may be incomplete, and the report says so.
   */
  items_missing?: { places: number; first: { place: string; at: string }[] };
  /**
   * How every place was read, file by file in table order (the report's per-place lines): the matched lines whose
   * window a seat opened, those given as a fact the program verified (never "opened"), those in a verified data summary,
   * and those not checked with the reason. Not written to the log: the per-place table holds every place.
   */
  files: PlaceFileLines[];
  /**
   * The places read in own-name seats, as one item (`OWN_NAME_ITEM`): the
   * entry the person declared, the places, how many were read, and how the seats decided them - naming only
   * (`not_the_construct`), a service the publisher runs (kept, and counted under the vendor's item), undetermined.
   */
  own_name?: { entry: string; item: string; places: number; read: number; named_only: number; publisher_service: number; undetermined: number };
}

/** One file's places by how each was read (`PlaceSummary.files`). */
export interface PlaceFileLines {
  file: string;
  window: number[];
  fact: number[];
  summary: number[];
  /** Integration: places whose row an earlier run wrote and this run carried. */
  carried: number[];
  not_checked: { line: number; reason: string }[];
}

/** How many not-checked places the summary lists one by one (the rest are counted; the table holds every one). */
export const PLACE_SUMMARY_FIRST = 5;

export function placeSummaryOf(candidate: Candidate, table: readonly PlaceTableRow[]): PlaceSummary {
  const carriedRows = table.filter((r) => r.decision !== undefined && r.carried_from !== undefined);
  const decided = table.filter((r) => r.decision !== undefined && r.carried_from === undefined);
  const basis = (b: string) => decided.filter((r) => (r.read_basis ?? "window") === b).length;
  const unchecked = table.filter((r) => r.decision === undefined);
  const reasons = groupBy(unchecked, (r) => r.not_checked ?? "not_answered");
  const kept = table.filter(isKeptPlace);
  const enumerated = foldClassesOf(candidate).includes("enumeration");
  const items = enumerated
    ? largestFirst(groupBy(kept.filter((r) => typeof r.item === "string" && r.item !== ""), (r) => r.item as string)).map(([item, rows]) => ({ item, places: rows.length }))
    : undefined;
  const noItem = enumerated ? kept.filter((r) => typeof r.item !== "string" || r.item === "") : [];
  const ownRows = table.filter((r) => typeof r.own_name === "string");
  return {
    places: table.length,
    read: decided.length,
    carried: carriedRows.length,
    carried_from_scans: [...new Set(carriedRows.map((r) => r.carried_from!.scan_id))].sort(),
    window: basis("window"),
    fact: basis("fact"),
    summary: basis("data_summary"),
    not_checked: [...reasons.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([reason, rows]) => ({ reason, places: rows.length })),
    not_checked_first: unchecked.slice(0, PLACE_SUMMARY_FIRST).map((r) => ({ place: r.place, at: `${r.file}:${r.line}`, reason: r.not_checked ?? "not_answered" })),
    undetermined: table.filter((r) => r.decision === "undetermined").length,
    undetermined_first: table
      .filter((r) => r.decision === "undetermined")
      .slice(0, PLACE_SUMMARY_FIRST)
      .map((r) => ({ place: r.place, at: `${r.file}:${r.line}`, ...(r.carried_from ? { carried: true as const } : {}) })),
    undetermined_carried: table.filter((r) => r.decision === "undetermined" && r.carried_from !== undefined).length,
    beyond: decided.filter((r) => r.beyond !== undefined).length,
    kept: kept.length,
    kept_places: kept.map((r) => `${r.place} ${r.file}:${r.line}`),
    ...(items ? { items } : {}),
    ...(ownRows.length > 0
      ? {
          own_name: {
            entry: ownRows[0]!.own_name!,
            item: OWN_NAME_ITEM,
            places: ownRows.length,
            read: ownRows.filter((r) => r.decision !== undefined).length,
            named_only: ownRows.filter((r) => r.decision === "not_the_construct").length,
            publisher_service: ownRows.filter(isKeptPlace).length,
            undetermined: ownRows.filter((r) => r.decision === "undetermined").length,
          },
        }
      : {}),
    ...(enumerated ? { items_missing: { places: noItem.length, first: noItem.slice(0, PLACE_SUMMARY_FIRST).map((r) => ({ place: r.place, at: `${r.file}:${r.line}` })) } } : {}),
    files: [...groupBy(table, (r) => r.file)].map(([file, rows]) => {
      const lines = (b: string) => rows.filter((r) => r.decision !== undefined && r.carried_from === undefined && (r.read_basis ?? "window") === b).map((r) => r.line);
      const carriedLines = rows.filter((r) => r.decision !== undefined && r.carried_from !== undefined).map((r) => r.line);
      return { file, window: lines("window"), fact: lines("fact"), summary: lines("data_summary"), carried: carriedLines, not_checked: rows.filter((r) => r.decision === undefined).map((r) => ({ line: r.line, reason: r.not_checked ?? "not_answered" })) };
    }),
  };
}
