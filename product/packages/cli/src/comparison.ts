/**
 * THE COMPARISON WITH THE EARLIER REVIEW, WRITTEN INTO THE EVIDENCE LOG.
 *
 * Every log holds its own `comparison.basis`: for each finding it gives a disposition to, its list (the disposition), its
 * level and its place count (the candidate's location count), with its decisive place. A later run that carried from that
 * log reads the basis back and classes each finding it reports against it, in one of the rows the design names:
 *
 * - `new_or_higher`: to fix or to clarify now (`to_fix`, `counsel`) and not in that list before (new, or moved in), or in
 *   the same list at a higher level, with more places or with a place it did not have;
 * - `lower_or_moved`: every other change - a lower level, fewer places, a move out of the two lists, a move among the
 *   dispositions outside them, or a new finding outside them (it asks nothing to be fixed or clarified);
 * - `now_ruled_out`: ruled out now (`not_applicable`) and not before;
 * - `gone`: the earlier finding has no candidate in this scan (the pre-launch plan's gone rows);
 * - `unchanged`: the same disposition, the same level, the same place count and (where both logs hold it) the same place
 *   set, and nothing else;
 * - `new_ruled_out`: a new place the review ruled out; it is not a change to anything the person had, so it takes no
 *   since row (design 3.2.1).
 *
 * Which earlier finding a finding is compared with: its own finding id first, else the earlier verdict the pre-launch plan
 * compared it with (`from_finding_id`) where that one is not itself reported now. Gone rows from earlier comparisons are
 * carried forward while their finding is still not raised (`still_gone`), with the date it first went.
 *
 * No model runs here, and nothing here is a premise of a verdict: the module is outside the verdict-rules closure and
 * changes what the log says about the run, never what is carried.
 */

import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { basename } from "node:path";
import { digestMarkOf, readLogDigests } from "./log-digest.js";
import { readRegularFile } from "./project-read.js";

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The causes a gone row may name (carry-forward.ts `GONE_CAUSES`; evidence-log.schema.json `comparison.gone[].cause`). */
const GONE_CAUSE_WORDS: ReadonlySet<string> = new Set(["file_removed", "rule_removed", "rule_changed", "line_changed", "unknown"]);

/** The two lists a finding asks something of the person in: to fix, and to clarify. */
export const IN_LISTS: ReadonlySet<string> = new Set(["to_fix", "counsel"]);
export const RULED_OUT = "not_applicable";

export interface BasisRow {
  finding_id: string;
  rule_id: string;
  disposition: string;
  level: string | null;
  places: number;
  file: string | null;
  line: number | null;
  /**
   * The finding's place set (place-key.ts `placeSetOf`: per place its file and the
   * fingerprint of its line text), sorted. Absent on a log written before it: then only the count is compared.
   */
  place_keys?: string[];
  /**
   * When the review its verdict stands on was made (ISO): this run's completion
   * time for a verdict read in this run; for a carried verdict, what the log it was carried from records for it; null where
   * that log does not say. Absent on a row with no verdict (settled by an answer), and on a log written before this field.
   */
  reviewed_at?: string | null;
}

/** What a finding was or is, as the comparison reads it. */
export interface Standing3 {
  disposition: string;
  level: string | null;
  places: number;
  /** The place set, where both logs hold one (BasisRow `place_keys`). */
  keys?: readonly string[];
}

export type ChangeClass = "new_or_higher" | "lower_or_moved" | "now_ruled_out" | "gone" | "unchanged" | "new_ruled_out";
export type ChangeKind =
  | "new_place"
  | "moved_in"
  | "level_rose"
  | "place_gained"
  | "level_fell"
  | "place_lost"
  | "moved_out"
  | "moved"
  | "new_outside_lists"
  | "ruled_out"
  | "gone"
  | "same";

/** Levels in order; anything else (or none) ranks below low, so any change of level has a direction. */
const LEVEL_RANK: Readonly<Record<string, number>> = { low: 1, medium: 2, high: 3 };
const rank = (level: string | null): number => (level !== null ? (LEVEL_RANK[level] ?? 0) : 0);

/**
 * Whether `now` holds a place `earlier` did not, and whether the two sets differ;
 * both false where either side holds no set (a log written before the sets: the count alone is compared, as before).
 */
function placeDelta(earlier: Standing3, now: Standing3): { gained: boolean; differ: boolean } {
  if (!earlier.keys || !now.keys) return { gained: false, differ: false };
  const was = new Set(earlier.keys);
  const gained = now.keys.some((k) => !was.has(k));
  return { gained, differ: gained || now.keys.length !== was.size || earlier.keys.some((k) => !now.keys?.includes(k)) };
}

/**
 * The one classification. "Unchanged" is returned exactly where the disposition, the level, the place count and (where
 * both sides hold one) the place set are all equal (test-carry-forward.mjs, the A4 grid), and every other pair is in
 * another row. A place swapped for another at the same count is a place gained:
 * in the two lists, "New or higher" (design 3.2.1, "or has a place it did not have").
 */
export function classifyChange(earlier: Standing3 | null, now: Standing3 | null): { change: ChangeClass; kind: ChangeKind } {
  if (now === null) return { change: "gone", kind: "gone" };
  if (earlier === null) {
    if (IN_LISTS.has(now.disposition)) return { change: "new_or_higher", kind: "new_place" };
    if (now.disposition === RULED_OUT) return { change: "new_ruled_out", kind: "new_place" };
    return { change: "lower_or_moved", kind: "new_outside_lists" };
  }
  const delta = placeDelta(earlier, now);
  if (earlier.disposition === now.disposition && earlier.level === now.level && earlier.places === now.places && !delta.differ) return { change: "unchanged", kind: "same" };
  if (now.disposition === RULED_OUT && earlier.disposition !== RULED_OUT) return { change: "now_ruled_out", kind: "ruled_out" };
  if (IN_LISTS.has(now.disposition)) {
    if (earlier.disposition !== now.disposition) return { change: "new_or_higher", kind: "moved_in" };
    if (rank(now.level) > rank(earlier.level)) return { change: "new_or_higher", kind: "level_rose" };
    if (now.places > earlier.places || delta.gained) return { change: "new_or_higher", kind: "place_gained" };
    if (rank(now.level) < rank(earlier.level)) return { change: "lower_or_moved", kind: "level_fell" };
    if (now.places < earlier.places) return { change: "lower_or_moved", kind: "place_lost" };
    // Two levels of the same rank that are not the same word: a change, and not a rise.
    return { change: "lower_or_moved", kind: "moved" };
  }
  if (IN_LISTS.has(earlier.disposition)) return { change: "lower_or_moved", kind: "moved_out" };
  if (earlier.disposition !== now.disposition) return { change: "lower_or_moved", kind: "moved" };
  if (rank(now.level) < rank(earlier.level)) return { change: "lower_or_moved", kind: "level_fell" };
  if (now.places < earlier.places) return { change: "lower_or_moved", kind: "place_lost" };
  return { change: "lower_or_moved", kind: "moved" };
}

/** The earlier log, as the assembly read it for the comparison (assemble-report.ts `earlierForComparison`). */
export interface EarlierForComparison {
  /** The label the plan carried its verdicts under (`previous_scan_id`). */
  label: string;
  /** The path the person named it by, as the plan records it. */
  path: string;
  completed_at: string | null;
  /**
   * The commit the earlier review scanned, as its
   * log's `summary.code.commit` records it (null where it recorded none or the log has no summary), and whether that scan's
   * tree differed from the commit (`summary.code.tree_changed`, where recorded). Written on `comparison.earlier`, so the
   * report's "Since" heading can name the commit and say whether it is in this branch's history.
   */
  commit?: string | null;
  commit_tree_changed?: boolean;
  digest: "matches" | "changed" | "none" | "unread";
  digest_why?: string;
  /** Null where the earlier log holds no basis (made before release 1): nothing is classed against it. */
  basis: BasisRow[] | null;
  /** The earlier log's own gone rows, carried forward while still gone. */
  gone: Obj[];
  /**
   * When the review each earlier verdict stands on was made, by the earlier
   * finding id (`reviewedRowsOf`). Absent where the caller gave none: then the basis rows' own `reviewed_at` is read.
   */
  reviewed?: ReadonlyMap<string, string | null>;
}

const DAY_FIRST = /^\d{4}-\d{2}-\d{2}/;
const reviewedValue = (v: unknown): string | null | undefined => (typeof v === "string" ? (DAY_FIRST.test(v) ? v : null) : v === null ? null : undefined);

/**
 * WHEN EACH VERDICT OF A LOG WAS REVIEWED, as that log records it: the log's own
 * `reviewed_at` on its basis row where it wrote one; else its completion time for a verdict the run read itself (no
 * `carried_forward_from`); else null, for a verdict that log carried without saying from when. Never a guess: an older log
 * is not looked for, because each log since release 1 records the date of what it carried.
 */
export function reviewedRowsOf(log: unknown): Map<string, string | null> {
  const doc = obj(log);
  const out = new Map<string, string | null>();
  const completed = reviewedValue(doc?.completed_at) ?? null;
  for (const v of arr(doc?.verdicts).map(obj)) {
    const id = str(v?.finding_id);
    if (!v || !id || out.has(id)) continue;
    out.set(id, str(v.carried_forward_from) ? null : completed);
  }
  for (const r of arr(obj(doc?.comparison)?.basis).map(obj)) {
    const id = str(r?.finding_id);
    const at = reviewedValue(r?.reviewed_at);
    if (id && at !== undefined) out.set(id, at);
  }
  return out;
}

/** The review date of the earlier verdict `id` (`EarlierForComparison.reviewed`, else its basis row); null where unknown. */
export function reviewedOfEarlier(e: EarlierForComparison, id: string): string | null {
  if (e.reviewed) return e.reviewed.get(id) ?? null;
  return (e.basis ?? []).find((b) => b.finding_id === id)?.reviewed_at ?? null;
}

const standingOf = (b: BasisRow): Standing3 => ({ disposition: b.disposition, level: b.level, places: b.places });
/** The standing the classification reads: with the place set where the row holds one. */
const comparedOf = (b: BasisRow): Standing3 => (b.place_keys ? { ...standingOf(b), keys: b.place_keys } : standingOf(b));

/**
 * The log's `comparison` block. `basis` is this run's own rows (every finding it gives a disposition to); `plan` the
 * pre-launch plan on disk (its `rows`, `gone` and `not_chosen`); `raised` every finding id this scan raised a candidate
 * for. Without an earlier log only the basis is written.
 */
export function comparisonOf(args: { basis: BasisRow[]; plan: Obj; earlier: EarlierForComparison | null; raised: ReadonlySet<string>; completedAt: string }): Obj {
  const basis = [...args.basis].sort((x, y) => (x.finding_id < y.finding_id ? -1 : x.finding_id > y.finding_id ? 1 : 0));
  const block: Obj = { basis };
  const e = args.earlier;
  if (e === null) return block;
  const compared = e.basis !== null;
  block.earlier = {
    label: e.label,
    path: e.path,
    completed_at: e.completed_at,
    // The commit of the earlier review this run carried from.
    commit: e.commit ?? null,
    ...(typeof e.commit_tree_changed === "boolean" ? { commit_tree_changed: e.commit_tree_changed } : {}),
    digest: e.digest,
    ...(e.digest_why ? { digest_why: e.digest_why } : {}),
    compared,
    ...(compared ? {} : { why: "the earlier log holds no comparison basis (it was written before this release), so no finding's change is classed against it" }),
  };
  const earlierById = new Map((e.basis ?? []).map((b) => [b.finding_id, b] as const));
  const nowIds = new Set(basis.map((b) => b.finding_id));
  const rowOf = new Map(
    arr(args.plan.rows)
      .map(obj)
      .filter((r): r is Obj => !!r && !!str(r.finding_id))
      .map((r) => [str(r.finding_id), r] as const),
  );
  const planGone = arr(args.plan.gone).map(obj).filter((g): g is Obj => !!g && !!str(g.finding_id));
  const goneIds = new Set(planGone.map((g) => str(g.finding_id)));
  const notChosenIds = new Set(arr(args.plan.not_chosen).map((r) => str(obj(r)?.finding_id)).filter(Boolean));
  const used = new Set<string>();
  const changes: Obj[] = [];
  if (compared) {
    for (const n of basis) {
      const row = rowOf.get(n.finding_id);
      let was = earlierById.get(n.finding_id);
      if (was && used.has(was.finding_id)) was = undefined;
      const from = str(row?.from_finding_id);
      if (!was && from && !nowIds.has(from) && !used.has(from)) was = earlierById.get(from);
      if (was) used.add(was.finding_id);
      const { change, kind } = classifyChange(was ? comparedOf(was) : null, comparedOf(n));
      changes.push({
        finding_id: n.finding_id,
        rule_id: n.rule_id,
        change,
        kind,
        earlier: was ? { finding_id: was.finding_id, ...standingOf(was) } : null,
        now: standingOf(n),
        carried: str(row?.outcome) === "carried",
        ...(row && str(row.reason) ? { cause: { reason: str(row.reason), ...(str(row.premise) ? { premise: str(row.premise) } : {}) } } : {}),
      });
    }
  }
  const gone: Obj[] = [];
  /* The ids already in `gone`, kept beside it so the still-gone loop below asks a set, not
   * the whole list once per earlier row (a search through the list grew with the square of the gone rows). */
  const goneSeen = new Set<string>();
  const goneRow = (id: string, ruleId: string, g: Obj | undefined): void => {
    const was = earlierById.get(id);
    const place = obj(g?.place);
    goneSeen.add(id);
    gone.push({
      finding_id: id,
      rule_id: ruleId || was?.rule_id || "",
      place: place && str(place.file) ? { file: str(place.file), line: Number.isInteger(place.line) ? place.line : null } : was?.file ? { file: was.file, line: was.line } : null,
      earlier_disposition: str(g?.earlier_disposition) || was?.disposition || null,
      earlier_level: was?.level ?? null,
      cause: str(g?.cause) || "unknown",
      first_gone: args.completedAt,
      still_gone: false,
      same_file: Array.isArray(g?.same_file) ? [...(g?.same_file as string[])] : null,
    });
    used.add(id);
    if (compared) changes.push({ finding_id: id, rule_id: ruleId || was?.rule_id || "", change: "gone", kind: "gone", earlier: was ? { finding_id: was.finding_id, ...standingOf(was) } : null, now: null, carried: false });
  };
  for (const g of planGone) goneRow(str(g.finding_id), str(g.rule_id), g);
  // An earlier finding with no verdict in the plan's view (one the person's answers settled) that this scan does not raise.
  let notCompared = compared ? 0 : notChosenIds.size;
  for (const was of e.basis ?? []) {
    if (used.has(was.finding_id)) continue;
    if (notChosenIds.has(was.finding_id) || args.raised.has(was.finding_id)) notCompared += 1;
    else goneRow(was.finding_id, was.rule_id, undefined);
  }
  // Still gone: carried from the earlier log's own gone rows while the finding is still not raised and not gone again here.
  for (const s of e.gone) {
    const id = str(s.finding_id);
    if (!id || nowIds.has(id) || args.raised.has(id) || goneIds.has(id) || goneSeen.has(id)) continue;
    // Rebuilt field by field: the earlier log is a file in the project, and a row of another form must not refuse this log.
    const place = obj(s.place);
    const cause = str(s.cause);
    goneSeen.add(id);
    gone.push({
      finding_id: id,
      rule_id: str(s.rule_id),
      place: place && str(place.file) ? { file: str(place.file), line: Number.isInteger(place.line) ? place.line : null } : null,
      earlier_disposition: str(s.earlier_disposition) || null,
      earlier_level: str(s.earlier_level) || null,
      cause: GONE_CAUSE_WORDS.has(cause) ? cause : "unknown",
      first_gone: str(s.first_gone),
      still_gone: true,
      same_file: Array.isArray(s.same_file) ? s.same_file.filter((x): x is string => typeof x === "string") : null,
    });
  }
  block.changes = changes;
  block.gone = gone;
  block.not_compared = notCompared;
  return block;
}

/**
 * The earlier log the plan names, read for the comparison: its basis and gone rows, its completion time, and its digest
 * mark against the person's state folder (log-digest.ts). A previous run given as a directory of records has no basis
 * and no digest. Never throws: what cannot be read is compared with nothing.
 */
export function readEarlierForComparison(args: { abs: string; typed: string; label: string; stateDir: string | null; target: string }): EarlierForComparison {
  let bytes: Buffer | null = null;
  let doc: unknown = null;
  try {
    if (lstatSync(args.abs).isFile()) {
      bytes = readRegularFile(args.abs);
      doc = JSON.parse(bytes.toString("utf8"));
    }
  } catch {
    doc = null;
  }
  const digests = readLogDigests(args.stateDir, args.target);
  const digest = bytes === null ? "none" : digestMarkOf(digests, basename(args.abs), createHash("sha256").update(bytes).digest("hex"));
  const completed = obj(doc)?.completed_at;
  const code = obj(obj(obj(doc)?.summary)?.code);
  return {
    label: args.label,
    path: args.typed,
    completed_at: typeof completed === "string" ? completed : null,
    commit: typeof code?.commit === "string" && code.commit !== "" ? code.commit : null,
    ...(typeof code?.tree_changed === "boolean" ? { commit_tree_changed: code.tree_changed } : {}),
    digest,
    ...(digest === "unread" && !digests.ok ? { digest_why: digests.why } : {}),
    basis: basisRowsOf(doc),
    gone: goneRowsOf(doc),
    reviewed: reviewedRowsOf(doc),
  };
}

/** The earlier log's comparison basis rows, read defensively (a row of another form is left out). */
export function basisRowsOf(log: unknown): BasisRow[] | null {
  const c = obj(obj(log)?.comparison);
  if (!c || !Array.isArray(c.basis)) return null;
  const rows: BasisRow[] = [];
  for (const r of c.basis.map(obj)) {
    if (!r || !str(r.finding_id) || typeof r.disposition !== "string") continue;
    rows.push({
      finding_id: str(r.finding_id),
      rule_id: str(r.rule_id),
      disposition: r.disposition,
      level: typeof r.level === "string" ? r.level : null,
      places: Number.isInteger(r.places) && (r.places as number) >= 0 ? (r.places as number) : 0,
      file: typeof r.file === "string" && r.file ? r.file : null,
      line: Number.isInteger(r.line) ? (r.line as number) : null,
      ...(Array.isArray(r.place_keys) && r.place_keys.every((k) => typeof k === "string") ? { place_keys: [...(r.place_keys as string[])].sort() } : {}),
      ...((at) => (at === undefined ? {} : { reviewed_at: at }))(reviewedValue(r.reviewed_at)),
    });
  }
  return rows;
}

/** The earlier log's own gone rows, as written (each a schema-checked object when that log was written). */
export function goneRowsOf(log: unknown): Obj[] {
  const c = obj(obj(log)?.comparison);
  return arr(c?.gone)
    .map(obj)
    .filter((g): g is Obj => !!g && !!str(g.finding_id) && typeof g.first_gone === "string");
}
