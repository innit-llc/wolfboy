/**
 * VA-5: THE ANSWER SEAT'S OWN PREMISES.
 *
 * A place-plan candidate larger than one seat is answered by an answer seat over the program's fold of its place rows
 * (`place-answer.ts`). Its places each rest on their own premises (`place-premises.ts`, design section 4), but its answer
 * rests on more: the fold it was handed, every file of the tree it Read (A2's elements included) and every search it ran.
 * Before this module a later run carried such an answer whole where every place was carried and the verdict's block held -
 * a block that replays only the searches the seat chose to report. The design's rule: "The answer is carried only when
 * every place carried, the fold digest is equal, its searches replay to the same hits and its files (A2's included) are
 * unchanged; otherwise one new answer seat runs over the new fold."
 *
 * - **The fold's digest** (`foldDigestOf`) is sha256 of the fold `foldOfPlaces` lays out over the per-place table, with
 *   what names the run left out: the finding id, the per-place table's path, the readers' account (which seat returned),
 *   and which seat or which earlier scan a row came from. What remains is what the seat was told about the places - every
 *   decision, its data, item and quote, each at its file and line, and the counts. A place that moved down its file is
 *   carried, re-based, but its line in the fold moves, and the answer (whose evidence names lines) is given again.
 * - **The files and searches** are the answer seat's own transcript's (`seatPremisesOf`, as for a place seat), each
 *   search compared with the host's result at capture and replayed in a later run as a place's are.
 *
 * Written by the capture on the seat's record (`reading.answer_premises`), moved by the assembly into the verdict's
 * `rests_on.answer`, compared by the partition (`carry-forward.ts`, `firstChangedAnswerPremise`). A candidate read by one
 * seat has no answer seat: its one seat's files and searches are premises of every one of its places already.
 */
import { createHash } from "node:crypto";
import type { Candidate } from "wolfboy-schemas";
import { carriedRow } from "./carried-places.js";
import type { PlaceOutcome } from "./carry-forward.js";
import { foldOfPlaces, placeTableOf, type PlaceTableRow } from "./place-fold.js";
import { ANSWER_PREMISES_SPEC, placeAt, seatPremisesOf, type AnswerPremises } from "./place-premises.js";
import type { ReadingReadRow } from "./reading.js";
import { TreeReader } from "./rests-on.js";
import type { SeatSight } from "./seat-opened.js";
import { placeId } from "./ref-ids.js";

const sha256Hex = (s: string): string => createHash("sha256").update(s).digest("hex");

/** The digest of the fold the program lays out over `table`, without what names the run (see the module's header). */
export function foldDigestOf(candidate: Candidate, table: readonly PlaceTableRow[]): string {
  const rows = table.map((r) => {
    const { seat: _seat, carried_from: _carried, ...rest } = r;
    return rest as PlaceTableRow;
  });
  return sha256Hex(foldOfPlaces({ ...candidate, finding_id: "" }, rows, {}).text);
}

/**
 * ONE ANSWER, ONE TREE WALK: the tree's reader (a walk of every scanned file) and the seat's files and searches as premises (every Grep and Glob it
 * ran, replayed) depend on the answer, not on the candidate - the seat, its transcript, the tree and the fold the entry names.
 * One answer can hold several answer-seat candidates, and each was given a fresh walk and a fresh replay. The capture
 * (reading-assembly.ts `answerCapture`) hands every candidate of one answer the same slot; the first call fills it.
 */
export interface AnswerSeatWork {
  tree?: TreeReader;
  basis?: ReturnType<typeof seatPremisesOf>;
}

/**
 * The answer seat's premises at capture: the fold's digest over the table its answer was checked against, and the files
 * and searches of its transcript outside the program's own files (`own`: the fold; anything under `.legal/` is skipped
 * as for a place seat). Incomplete where the transcript is not given or could not be read, the fold is not
 * on disk, a file it Read cannot be digested or a search does not reproduce the host's result.
 */
export function answerPremisesOf(args: {
  candidate: Candidate;
  table: readonly PlaceTableRow[];
  foldPath: string | null;
  sight: SeatSight | undefined;
  root: string;
  /** The model the seat's launch entry named; null or absent, none is recorded and a later run gives the answer again. */
  model?: string | null;
  /** The answer's tree-wide work, shared by every candidate of one answer (`AnswerSeatWork`); absent, it is taken for this call alone. */
  work?: AnswerSeatWork;
}): AnswerPremises {
  const work = args.work ?? {};
  const tree = (work.tree ??= new TreeReader(args.root));
  const basis = (work.basis ??= seatPremisesOf(args.sight, tree, args.foldPath ? [args.foldPath] : []));
  // A transcript that could not be read gives no files and no searches, and says so here (only the carry stops).
  const incomplete = [...basis.incomplete, ...basis.untaken];
  if (!args.foldPath) incomplete.push("the entry names no fold, so the fold the answer was given is not known.");
  return {
    spec: ANSWER_PREMISES_SPEC,
    fold: foldDigestOf(args.candidate, args.table),
    files: basis.files,
    searches: basis.searches,
    ...(typeof args.model === "string" && args.model ? { model: args.model } : {}),
    complete: incomplete.length === 0,
    ...(incomplete.length > 0 ? { incomplete } : {}),
  };
}

/**
 * The digest of the fold a later run would hand a new answer seat over a candidate whose every place is carried: the
 * per-place table made from the carried rows (`carriedRow`, the rows the run's record would hold), folded as above. Null
 * where any location of the candidate has no carried row.
 */
export function foldDigestOfCarried(candidate: Candidate, outcomes: readonly PlaceOutcome[]): string | null {
  const byAt = new Map(outcomes.map((o) => [placeAt(o.file, o.line), o] as const));
  const rows: ReadingReadRow[] = [];
  for (const [n, loc] of (candidate.locations ?? []).entries()) {
    const o = byAt.get(placeAt(loc.file, loc.start_line));
    const row = o && o.outcome === "carried" ? carriedRow(o, placeId(n)) : null;
    if (!row) return null;
    rows.push(row);
  }
  const table = placeTableOf(candidate, [{ source: "carried", finding_id: candidate.finding_id, reader: 1, rows }]);
  return foldDigestOf(candidate, table);
}
