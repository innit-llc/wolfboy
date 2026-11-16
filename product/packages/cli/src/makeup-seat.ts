/**
 * THE MAKE-UP SEAT.
 *
 * When a seat holding places of a candidate read by the place plan ends with its places undecided, the program writes
 * ONE make-up seat for exactly those places: a fresh seat, the same windows, the same model. The capture is
 * all-or-nothing (a refused answer writes nothing), so a seat whose answer stayed invalid after its last refusal leaves
 * every place it holds undecided, and its make-up seat is the same entry once more (launch-list-file.ts
 * `withMakeupEntry`). Places the make-up seat does not decide either are recorded not checked, reason `not_answered`
 * (reading.ts `plannedNotRead`), which the report shows as "not checked (no answer)".
 *
 * Only the invalid answer gets one: a seat whose answer was lost (not captured, or presumed lost) is launched again by
 * the relaunch rule already (entry-answer.ts `relaunchable`, which refuses only an invalid one), and a seat that never
 * returns makes no hook event at all - its places are `not_answered` at assembly.
 *
 * Its own module, beside the capture hook that runs it: launch-later.ts (the refuter and silence entries) reads values
 * of launch-plan.ts while it loads, and the capture hook is loaded inside launch-plan.ts's own imports.
 */

import type { Candidate } from "wolfboy-schemas";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Appended } from "./launch-later.js";
import { isMakeupEntry, makeupIdOf, readLaunchList, readRecorded, replaceLaunchList, withListLock, withMakeupEntry } from "./launch-list-file.js";
import type { LaunchEntry } from "./launch-plan.js";
import { isPlacePlanCandidate, PLACES_KEPT_DIR } from "./place-reply.js";
import { keptFileNamed } from "./reading-assembly.js";
import { keptPlacesNamed } from "./state-record.js";

/**
 * Unit U1: the sentence the make-up seat's prompt carries where the seat before it kept read places
 * (verdict-capture.ts `keepReadPlaces`): which files hold them, and that it gives no row for a place they hold. Empty
 * where none was kept. The file names begin with the candidate's id as `keepReadPlaces` writes it.
 */
export function keptPlacesNote(legalDir: string, findingIds: readonly string[]): string {
  return keptNoteOf(keptPlacesFiles(legalDir, findingIds));
}

/**
 * THE KEPT FILES THE MAKE-UP SEAT IS TOLD TO READ,
 * named in its launch entry too. The prompt named them and the entry did not (`withMakeupEntry` copied the earlier entry's
 * reads unchanged), and the seat-read hook lets a seat read under `.legal` only what its own entry names, so every Read of
 * a kept file was refused and the make-up seat could not rest on the rows it was told to (FIN-5 item 1). Each file as the
 * prompt names it (`.legal/...`, from the project folder: `path`) and as the entry names it (`at`, the file itself), with
 * the sha256 the hook's own line in the state folder records for its bytes; the entry's read carries that digest, so the
 * hook lets the seat read only those bytes. Empty where none was kept.
 */
export function keptPlacesFiles(legalDir: string, findingIds: readonly string[]): { path: string; at: string; sha256: string }[] {
  const dir = join(legalDir, PLACES_KEPT_DIR);
  if (!existsSync(dir)) return [];
  // Only files the hook's own line in the state folder names with their bytes.
  const named = keptPlacesNamed(legalDir);
  const names = readdirSync(dir).filter((n) => n.endsWith(".json") && findingIds.some((id) => n.startsWith(`${id.replace(/[^A-Za-z0-9._-]/gu, "_")}.`)) && keptFileNamed(named, `${PLACES_KEPT_DIR}/${n}`, join(dir, n))).sort();
  return names.map((n) => ({ path: `.legal/${PLACES_KEPT_DIR}/${n}`, at: join(dir, n), sha256: named.get(`${PLACES_KEPT_DIR}/${n}`) as string }));
}

function keptNoteOf(kept: readonly { path: string }[]): string {
  if (kept.length === 0) return "";
  const files = kept.map((k) => k.path);
  return (
    ` The seat before you read places of this entry, and the rows of those it read are recorded as read in ${files.join(", ")}.` +
    ` Read ${files.length === 1 ? "that file" : "those files"}; give no row for a place ${files.length === 1 ? "it holds" : "they hold"} (it is read already),` +
    " give one row for every other place you are handed, and rest your verdict on those rows and yours."
  );
}

/** The exits of a make-up request, as launch-later.ts's commands exit. */
export const MAKEUP_EXIT = { written: 0, refused: 1, unreadable: 2, locked: 3 } as const;

/**
 * The roles whose seats get one make-up seat: a reader of a candidate's places, a verdict seat that holds its candidates'
 * places itself, and (build unit F4, design section 3 A7) the answer seat after a place-plan candidate's place seats,
 * whose make-up is the same answer seat once more over the same fold; after it the candidate is shown "not answered".
 */
const MAKEUP_ROLES = new Set(["reader", "adjudicator", "verdict-after-readers"]);

export interface MakeupOutcome {
  exit: number;
  lines: string[];
  /** The make-up seat's entry id where one was appended; null otherwise. */
  made: string | null;
}

/**
 * Append the make-up seat of entry `entry` to the launch list of `launchDir` (default `<legal>/launch`), under the list's
 * lock, where the entry is a pre-launch reader or verdict entry (not a make-up seat itself), has no make-up seat yet, and
 * names a candidate read by the place plan in the findings document the list records (read back only while it has the
 * sha256 the pre-launch step recorded). Otherwise nothing is written and `made` is null. Run by the capture hook before
 * the seat is recorded as returned (hook-capture.ts `takeAnswer`), so no receipt launches what waits for it in between.
 */
export function runMakeupEntries(opts: { legal: string; launchDir?: string; entry: string }): MakeupOutcome {
  const legalDir = resolve(opts.legal);
  const launchDir = resolve(opts.launchDir ?? join(legalDir, "launch"));
  const listPath = join(launchDir, "launch-list.json");
  const of = opts.entry;
  const refused = (problem: string, exit: number = MAKEUP_EXIT.refused): MakeupOutcome => ({ exit, lines: [`refused: ${problem}. Nothing was written.`], made: null });
  const none = (why: string): MakeupOutcome => ({ exit: MAKEUP_EXIT.written, lines: [`makeup-entries: no make-up seat for ${of}: ${why}. Nothing was written.`], made: null });
  if (of === "") return refused("no entry was named");
  if (!existsSync(launchDir)) return refused(`the launch directory ${launchDir} does not exist, so there is no launch list`, MAKEUP_EXIT.unreadable);
  const r = withListLock(listPath, (): MakeupOutcome => {
    const l = readLaunchList(listPath);
    if (!l.ok) return refused(l.problem, l.exit === "unreadable" ? MAKEUP_EXIT.unreadable : MAKEUP_EXIT.refused);
    const list = l.value;
    const entry = list.entries.find((e) => e.id === of) as LaunchEntry | undefined;
    if (!entry) return refused(`the launch list ${listPath} has no entry ${of}`);
    if (isMakeupEntry(entry)) return none(`it is itself the make-up seat of ${entry.makeup_of}, and a place is given to a fresh seat once`);
    if (!MAKEUP_ROLES.has(String(entry.role))) return none(`its role ${String(entry.role)} holds no places`);
    if (list.entries.some((e) => e.id === makeupIdOf(of))) return none(`its make-up seat ${makeupIdOf(of)} is listed already`);
    if (!list.findings) return refused(`${listPath} records no findings document`);
    const got = readRecorded("the findings document", list.findings.path, list.findings.sha256, "the launch list's `findings` (recorded by the pre-launch step)");
    if (!got.ok) return refused(got.problem, got.exit === "unreadable" ? MAKEUP_EXIT.unreadable : MAKEUP_EXIT.refused);
    let candidates: Candidate[];
    try {
      const doc = JSON.parse(got.value.toString("utf8")) as { candidates?: unknown };
      candidates = Array.isArray(doc.candidates) ? (doc.candidates.filter((c) => c !== null && typeof c === "object") as Candidate[]) : [];
    } catch (e) {
      return refused(`the findings document is not JSON (${(e as Error).message})`, MAKEUP_EXIT.unreadable);
    }
    const named = new Set(entry.finding_ids ?? []);
    const placed = candidates.filter((c) => named.has(c.finding_id) && isPlacePlanCandidate(c));
    if (placed.length === 0) return none("no candidate it names is read by the place plan");
    const appended: Appended = { command: "makeup-entries", makeup_of: of, entries: [makeupIdOf(of)] };
    // Unit U1: places the seat before read, kept apart from its verdict, are given as read, never re-read. Named in the prompt and in the entry's reads, from one listing.
    const kept = keptPlacesFiles(legalDir, placed.map((c) => c.finding_id));
    const next = withMakeupEntry(list, of, appended, keptNoteOf(kept), kept);
    if (typeof next === "string") return refused(next);
    try {
      replaceLaunchList(listPath, next, `the make-up seat of ${of}`, new Map(), l.sha256);
    } catch (e) {
      return refused((e as Error).message);
    }
    const made = next.entries.find((e) => e.id === makeupIdOf(of)) as LaunchEntry;
    const waiting = next.entries.filter((e) => e.id !== made.id && e.after.includes(made.id)).map((e) => e.id);
    return {
      exit: MAKEUP_EXIT.written,
      lines: [
        `makeup-entries: the make-up seat ${made.id} of ${of} (${placed.map((c) => c.finding_id).join(", ")}) was appended to ${listPath}, wave ${made.wave}${waiting.length > 0 ? `; ${waiting.join(", ")} now wait${waiting.length === 1 ? "s" : ""} for it too` : ""}.`,
        `    agent_input: ${JSON.stringify(made.agent_input)}`,
      ],
      made: made.id,
    };
  });
  return "locked" in r ? refused(r.locked, MAKEUP_EXIT.locked) : r;
}
