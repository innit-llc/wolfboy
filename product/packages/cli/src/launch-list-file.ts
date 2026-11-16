/**
 * THE LAUNCH LIST ON DISK, AND EVERY FILE READ BACK AS THE PROGRAM WROTE IT.
 *
 * A file the program derived is never taken as given when it is read back:
 * a later command reads it only when its sha256 is still the one the program recorded when it wrote it,
 * and refuses by name otherwise. This module is where that is done for the launch list and its inputs:
 *
 * - `replaceLaunchList` is THE ONE PLACE `launch-list.json` is replaced (relay integration part B, item 2).
 *   It writes every file it is given for the list (the briefs, the reading copies, the run context), records
 *   their digests in the list, refuses a list naming a file with no digest (the readers' fold excepted),
 *   replaces the list whole (the launch gate may read it at any moment), and records the list's sha256 in
 *   ONE place: the active-run marker of the list's run (`list_sha256`, hook-launch.ts). The pre-launch step
 *   (`writeLaunchList`) and the refuter and silence commands (`launch-later.ts`) all call it, under the
 *   list's lock.
 * - `readLaunchList` reads the list back only when it is the file the program last wrote: against the
 *   active marker of its run, or, once the run has ended, against the run's last history line.
 * - `readRecorded` reads any other file the program wrote earlier only when it has the sha256 recorded
 *   for it (the findings document, a payload, the orientation sheet and notes, the run context).
 * - `withListLock` serialises the program's own read-modify-write of the list. A lock is created with its
 *   holder already in it (a temporary file linked into place; where the file system refuses hard links, an
 *   exclusive create, empty for a moment: `createExclusive`, program-file.ts), and a dead
 *   holder's lock is removed by at most one process. Every state of the lock's path it
 *   cannot resolve by itself - a directory, a symbolic link or a named pipe there or at a take-over path, a
 *   chain of dead take-over files, a missing launch directory - is refused by name with what to do, never
 *   thrown and never waited on without a deadline.
 */

import { valueText } from "./value-text.js";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { existsSync, lstatSync, type Stats } from "node:fs";
import { makeFolder, removePath, renamePath, writeFileAt } from "./project-write.js";
import type { Appended, LaterEntry } from "./launch-later.js";
import type { LaunchEntry, LaunchList } from "./launch-plan.js";
import { canonicalJson } from "./rests-on.js";
import { toldArgs } from "./scanner-command.js";
import { ACTIVE_RUN_FILE, entriesLaunchedInRun, lastRunEnd, readActiveRun, refreshActiveRunList, type ActiveRunMarker, type MarkerRead } from "./hook-launch.js";
import { type ReadBack, createExclusive, kindOf, readProgramFile, refusalFor, sha256Of } from "./program-file.js";
import { isChallengeEntry } from "./second-look.js";

// The one reader of program-written files (relay integration part B, item 4) lives in `program-file.ts`;
// these two names are re-exported for the modules that took them from here.
export { type ReadBack, sha256Of };

/** Replace `path` whole: a reader holds the old file or the new one, never a part (the gate reads the list at any moment). */
export function replaceFileAtomically(path: string, text: string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileAt(tmp, text);
  try {
    renamePath(tmp, path);
  } catch (e) {
    // A refused rename (on Windows a reader holding the file open: FileHeldRefusal, "Nothing was replaced") takes its
    // temporary file with it, so nothing is left beside the file it did not replace; the refusal still reaches the
    // caller.
    try {
      removePath(tmp, { force: true });
    } catch {
      // the refusal below is what the person reads; a temporary file that cannot be removed either is left as it was
    }
    throw e;
  }
}

// ------------------------------------------------------------------------------------------------
// THE LIST, AND ITS DIGEST ON THE ACTIVE-RUN MARKER
// ------------------------------------------------------------------------------------------------

/** Refused by the one list writer; the message says what was and was not written. */
export class ListWriteRefused extends Error {}

const HEX64 = /^[0-9a-f]{64}$/;
const hex64 = (v: unknown): boolean => typeof v === "string" && HEX64.test(v);

interface ReadShape {
  role?: unknown;
  path?: unknown;
  sha256?: unknown;
  copied_from?: { sha256?: unknown } | undefined;
}

/** Every file the list names without the digest it must carry: each brief, and each read but the readers' fold. */
function unrecorded(list: LaunchList): string[] {
  const out: string[] = [];
  const reads = (what: string, rs: unknown): void => {
    for (const r of (Array.isArray(rs) ? rs : []) as ReadShape[]) {
      if (r.role !== "fold" && !hex64(r.sha256)) out.push(`${what}'s ${valueText(String(r.role))} ${valueText(String(r.path))}`);
      if (r.copied_from !== undefined && !hex64(r.copied_from?.sha256)) out.push(`the original of ${what}'s ${valueText(String(r.role))} ${valueText(String(r.path))}`);
    }
  };
  for (const e of list.entries as unknown as { id?: unknown; brief_sha256?: unknown; reads?: unknown }[]) {
    if (!hex64(e.brief_sha256)) out.push(`entry ${String(e.id)}'s brief`);
    reads(`entry ${String(e.id)}`, e.reads);
  }
  reads("the run", list.run_reads);
  return out;
}

/**
 * THE ONE LIST WRITER (relay integration part B, item 2: A-36, A-53, B7). The
 * caller holds the list's lock (`withListLock`). In order, and nothing is written where a step refuses:
 * 1. the list's run must be active: the list's digest has one home, the active-run marker of its run (`list_sha256`,
 *    launch-later/report.md:426), so a list is written only where that marker stands;
 * 2. the digest of every file in `files` (the briefs, the reading copies, the run context) is recorded where the list
 *    names it (`brief_sha256`, a read's `sha256`), and a list that would name a brief or a read with no digest (the
 *    readers' fold excepted) is refused;
 * 3. the files are written aside; where `expectSha` is given (an append), the list must still be the one read under
 *    the lock, or nothing is moved into place;
 * 4. the files are moved into place, the list is replaced whole, and the marker records the list's sha256
 *    (`refreshActiveRunList`), so that the launch gate launches every list the program wrote, an append's included.
 * Returns the list's sha256.
 */
export function replaceLaunchList(listPath: string, list: LaunchList, writtenBy: string, files: Map<string, string> = new Map(), expectSha?: string): string {
  const launchDir = dirname(listPath);
  const marker = readActiveRun(launchDir);
  if (marker.state !== "active" || marker.marker.run_id !== list.run_id) {
    // Each run id, path and error message through `valueText`.
    const why = marker.state === "active" ? `the active run is ${valueText(marker.marker.run_id)}` : marker.state === "unreadable" ? `its marker cannot be read: ${valueText(marker.error)}` : "no active-run marker stands";
    throw new ListWriteRefused(
      `scan run ${valueText(String(list.run_id))} is not active in ${valueText(launchDir)} (${why}): the launch list's digest is kept on the active-run marker (${valueText(join(launchDir, ACTIVE_RUN_FILE))}), which the pre-launch step writes, so ${writtenBy} wrote no list and none of its files - run the pre-launch step (\`legal-scan adjudicate --shape\`) again`,
    );
  }
  const digestOf = new Map([...files].map(([path, text]): [string, string] => [path, sha256Of(text)]));
  const record = (rs: unknown): void => {
    for (const r of (Array.isArray(rs) ? rs : []) as ReadShape[]) {
      const d = typeof r.path === "string" ? digestOf.get(r.path) : undefined;
      if (d) r.sha256 = d;
    }
  };
  for (const e of list.entries as unknown as { brief_path?: unknown; brief_sha256?: unknown; reads?: unknown }[]) {
    const d = typeof e.brief_path === "string" ? digestOf.get(e.brief_path) : undefined;
    if (d) e.brief_sha256 = d;
    record(e.reads);
  }
  record(list.run_reads);
  const missing = unrecorded(list);
  if (missing.length > 0) {
    throw new ListWriteRefused(
      `the launch list would name ${missing.length} file(s) with no sha256 recorded (${missing.slice(0, 3).join("; ")}${missing.length > 3 ? "; ..." : ""}): every file a brief names is recorded, the readers' fold excepted, so ${writtenBy} wrote no list and none of its files`,
    );
  }
  const staged: [string, string][] = [];
  try {
    for (const [path, text] of files) {
      makeFolder(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
      writeFileAt(tmp, text);
      staged.push([tmp, path]);
    }
    if (expectSha !== undefined) {
      const again = readProgramFile("the launch list", listPath);
      const now = again.ok ? again.sha256 : "(unreadable)";
      if (now !== expectSha) {
        throw new ListWriteRefused(
          `${valueText(listPath)} was replaced while this command ran (sha256 ${expectSha.slice(0, 16)}... when read, ${now.slice(0, 16)}... now), and appending to what was read would drop what replaced it - run this command again`,
        );
      }
    }
  } catch (e) {
    for (const [tmp] of staged) removePath(tmp, { force: true });
    if (e instanceof ListWriteRefused) throw e;
    throw new ListWriteRefused(`${refusalFor(e, typeof (e as NodeJS.ErrnoException).path === "string" ? String((e as NodeJS.ErrnoException).path) : listPath)}; ${writtenBy} wrote no list and none of its files`);
  }
  for (const [tmp, path] of staged) renamePath(tmp, path);
  const text = `${JSON.stringify(list, null, 2)}\n`;
  const digest = sha256Of(text);
  // In order, so the marker on disk always records the list on disk: the next
  // list's digest first, the list it replaces kept as outgoing; the list; the outgoing digest dropped. A reader meets
  // either list with a marker that records it, however slow this write is (hook-launch.ts `markerRecording`, `markerOfList`). Outgoing names only a list this attempt wrote
  // (`list_sha256`). A new attempt has none: the run's earlier list stays `previous_list_sha256` through the first step,
  // which the list-first readers of the pre-launch step take (`standingRunList`) and the launch gate never does
  // (`recordsList`), so the gate launches nothing from the previous attempt's list, in this write's window or after a
  // replacement of the list that failed.
  if (!refreshActiveRunList(launchDir, list.run_id, digest, new Date(), marker.marker.list_sha256 ?? null, true)) {
    throw new ListWriteRefused(
      `run ${valueText(list.run_id)}'s marker was removed while ${writtenBy} ran (run-abort, or the assembly), so it wrote no list - run the pre-launch step (\`legal-scan adjudicate --shape\`) again`,
    );
  }
  replaceFileAtomically(listPath, text);
  // A marker removed since the first step (the run ended) recorded this list's digest in its history line.
  refreshActiveRunList(launchDir, list.run_id, digest, new Date());
  return digest;
}

const parsedList = (listPath: string, bytes: Buffer, sha: string): ReadBack<LaunchList> => {
  try {
    const list = JSON.parse(bytes.toString("utf8")) as LaunchList;
    if (!list || list.kind !== "launch-list" || !Array.isArray(list.entries) || !Array.isArray(list.waves)) return { ok: false, exit: "unreadable", problem: `${valueText(listPath)} is not a launch list` };
    return { ok: true, value: list, sha256: sha };
  } catch (e) {
    return { ok: false, exit: "unreadable", problem: `${valueText(listPath)} is not JSON (${valueText((e as Error).message)})` };
  }
};

/**
 * THE LIST AND ITS MARKER, READ AS ONE PAIR, IN
 * ORDER. The one writer records the next list's sha256 on the marker first (keeping the list it replaces as
 * `outgoing_list_sha256`), then replaces the list, then drops the outgoing digest (`replaceLaunchList`). So a list read
 * first is recorded by any marker read after it, unless the list was replaced in between: where the marker does not
 * record the list read, the list is read again, and changed, it was replaced while this command ran (`replaced`: the
 * caller reads the pair again); unchanged, the marker is compared as it stands, and a list it does not record is not the
 * program's. Nothing waits: before, the marker was read again 4 times 25 ms apart, and a slower writer was refused with
 * the sentence that the program had not written the list. `records` is the digest the reader takes from a marker.
 */
const LIST_PASSES = 8;
function markerOfList(listPath: string, sha: string, runId: string | null, records: (m: ActiveRunMarker) => string | null): MarkerRead | { state: "replaced"; now: string } {
  const marker = readActiveRun(dirname(listPath));
  if (marker.state !== "active" || (runId !== null && marker.marker.run_id !== runId) || records(marker.marker) === sha || marker.marker.outgoing_list_sha256 === sha) return marker;
  const again = readProgramFile("the launch list", listPath);
  const now = again.ok ? again.sha256 : "(unreadable)";
  return now !== sha ? { state: "replaced", now } : marker;
}

/** A list replaced between a reader's two reads of it. */
const replacedWhileRead = (listPath: string, was: string, now: string): string =>
  `${valueText(listPath)} was replaced while this command ran (sha256 ${was.slice(0, 16)}... when read, ${now.slice(0, 16)}... a moment later), so nothing read from it is used - run this command again`;

/**
 * The list, read back only when it is the file the program last wrote (through the one reader, `program-file.ts`):
 * its sha256 must be the one the active-run marker of its run records, or - once that run has ended - the one the
 * run's last history line records (`endActiveRun`; the parent's ruling on item 2: a later re-run of the assembly, or an
 * audit, still reads the list). Where neither exists, it is refused by name. The digest is compared before anything of
 * the list is trusted; the list's `run_id` is read first only to pair the list with its run's marker (`markerOfList`) and
 * to find its history line.
 */
export function readLaunchList(listPath: string, pass = 1): ReadBack<LaunchList> {
  const got = readProgramFile("the launch list", listPath);
  if (!got.ok) {
    return got.exit === "unreadable" && (got.code === "ENOENT" || got.code === "ENOTDIR")
      ? { ok: false, exit: "unreadable", problem: `the launch list ${valueText(listPath)} cannot be read: it is written by \`legal-scan adjudicate --shape\`` }
      : got;
  }
  const launchDir = dirname(listPath);
  const markerPath = join(launchDir, ACTIVE_RUN_FILE);
  const now = got.sha256;
  let runId: string | null = null;
  try {
    const v = JSON.parse(got.value.toString("utf8")) as { run_id?: unknown } | null;
    runId = v && typeof v.run_id === "string" ? v.run_id : null;
  } catch {
    runId = null;
  }
  const paired = markerOfList(listPath, now, runId, (m) => m.list_sha256);
  if (paired.state === "replaced") return pass < LIST_PASSES ? readLaunchList(listPath, pass + 1) : { ok: false, exit: "refused", problem: replacedWhileRead(listPath, now, paired.now) };
  const marker = paired;
  if (marker.state === "unreadable") return { ok: false, exit: "refused", problem: `${valueText(listPath)} cannot be checked: the active-run marker ${valueText(markerPath)}, which records the list's digest, cannot be read (${marker.error})` };
  if (marker.state === "active" && (marker.marker.list_sha256 === now || marker.marker.outgoing_list_sha256 === now)) {
    const r = parsedList(listPath, got.value, now);
    if (r.ok && r.value.run_id !== marker.marker.run_id) return { ok: false, exit: "refused", problem: `${valueText(listPath)} names run ${valueText(String(r.value.run_id))}, and the active-run marker ${valueText(markerPath)} that records its digest is run ${valueText(marker.marker.run_id)}'s` };
    return r;
  }
  const said = (recorded: string | null): string => (recorded === null ? "no list" : `${recorded.slice(0, 16)}...`);
  if (marker.state === "active" && (runId === null || marker.marker.run_id === runId)) {
    return { ok: false, exit: "refused", problem: `${valueText(listPath)} is not the launch list the program last wrote: its sha256 is ${now.slice(0, 16)}..., and the active-run marker ${valueText(markerPath)} of run ${valueText(marker.marker.run_id)} records ${said(marker.marker.list_sha256)}. Nothing is read from a list the program did not write` };
  }
  const ended = runId !== null ? lastRunEnd(launchDir, runId) : null;
  if (ended && ended.list_sha256 === now) return parsedList(listPath, got.value, now);
  if (ended) {
    return { ok: false, exit: "refused", problem: `${valueText(listPath)} is not the launch list the program last wrote: its sha256 is ${now.slice(0, 16)}..., and run ${valueText(ended.run_id)}'s last line in the active-run history (${ended.how} at ${ended.ended_at}) records ${said(ended.list_sha256)}. Nothing is read from a list the program did not write` };
  }
  if (marker.state === "active") {
    return { ok: false, exit: "refused", problem: `${valueText(listPath)} is not the launch list the program last wrote: it names run ${valueText(String(runId))}, and the active run is ${valueText(marker.marker.run_id)} (${valueText(markerPath)}), whose marker records ${said(marker.marker.list_sha256)}; run ${valueText(String(runId))} never ended here. Nothing is read from a list the program did not write` };
  }
  return {
    ok: false,
    exit: "refused",
    problem: `no scan run is active: the launch list's digest is kept on the active-run marker (${valueText(markerPath)}), which the pre-launch step writes, and ${runId === null ? "the list names no run" : `no ended run ${valueText(runId)} is recorded in the active-run history`}, so ${valueText(listPath)} cannot be read back as the list the program wrote - run the pre-launch step (\`legal-scan adjudicate --shape\`) again`,
  };
}

/**
 * A file the program wrote earlier, read back only when its sha256 is `recorded`. `where` names the record
 * (what holds the digest and which step wrote it), so that a refusal says what the file was checked
 * against.
 */
export function readRecorded(what: string, path: string, recorded: string | null | undefined, where: string): ReadBack<Buffer> {
  return readProgramFile(what, path, { sha256: recorded, where });
}

// ------------------------------------------------------------------------------------------------
// A NEW ATTEMPT KEEPS THE RUN'S STATE: IT RELEASES, IT DOES NOT FORGET
// ------------------------------------------------------------------------------------------------

/**
 * `list` with `entries` appended: each in the first wave after every entry it waits for that has
 * a place left (a wave holds at most `wave_capacity`, as the pre-launch step's waves do), numbered after
 * the last entry, and the request recorded in `appended`. Returns a new list; `list` is not changed. The
 * refuter and silence commands append through it (launch-later.ts), and a new attempt's list carries what
 * they appended through it again (`carryRunState`), so both place an entry by the one rule.
 */
export function appendEntries(list: LaunchList, entries: LaterEntry[], appended: Appended): LaunchList {
  const out: LaunchList = JSON.parse(JSON.stringify(list));
  const size = new Map<number, number>();
  const waveOf = new Map<string, number>();
  for (const e of out.entries) {
    size.set(e.wave, (size.get(e.wave) ?? 0) + 1);
    waveOf.set(e.id, e.wave);
  }
  let order = Math.max(0, ...out.entries.map((e) => e.order));
  for (const src of entries) {
    const e: LaterEntry = { ...src, after: [...src.after] };
    let w = 1 + Math.max(0, ...e.after.map((x) => waveOf.get(x) ?? 0));
    while ((size.get(w) ?? 0) >= out.wave_capacity) w += 1;
    size.set(w, (size.get(w) ?? 0) + 1);
    waveOf.set(e.id, w);
    order += 1;
    e.wave = w;
    e.order = order;
    out.entries.push(e);
    const wave = out.waves.find((x) => x.wave === w);
    if (wave) wave.entries.push(e.id);
    else out.waves.push({ wave: w, entries: [e.id] });
  }
  out.waves.sort((x, y) => x.wave - y.wave);
  out.appended = [...(out.appended ?? []), appended];
  return out;
}

/** A refuter's or a silence investigator's entry: appended by `launch-later.ts`, never by the pre-launch step. */
const isLater = (e: { role?: unknown }): boolean => e.role === "refuter" || e.role === "silence-investigator";

// ------------------------------------------------------------------------------------------------
// THE MAKE-UP SEAT (design 1.7; build unit F3)
// ------------------------------------------------------------------------------------------------

/** The id of entry `id`'s make-up seat. */
export const makeupIdOf = (id: string): string => `${id}-makeup`;
/** What a make-up seat's `agent_input.description` adds to its original's, so its input (and its digest) is its own. */
export const MAKEUP_WORDS = " (make-up seat)";
/** A make-up entry: appended by the program for a place seat that ended without an accepted answer (`makeup_of`). */
export const isMakeupEntry = (e: { makeup_of?: unknown }): boolean => typeof e.makeup_of === "string" && e.makeup_of !== "";
/** An entry appended after the pre-launch step: a refuter's, a silence investigator's, or a make-up seat. */
const isAppended = (e: { role?: unknown; makeup_of?: unknown }): boolean => isLater(e) || isMakeupEntry(e);

/**
 * `list` with entry `of`'s make-up seat (design 1.7: a place seat that ended with its places undecided gets ONE fresh seat
 * for them, with the same windows and the same model). The capture is all-or-nothing - a refused answer writes nothing -
 * so every place of such a seat is undecided, and the make-up seat is the same entry once more: the same brief, reads,
 * payload key, reader index and model, its id `makeupIdOf(of)`, `makeup_of: of`, waiting for `of`, its description marked
 * `MAKEUP_WORDS` (so the launch gate binds a launch to it, not to `of`). Its answer is captured as `of`'s would be (the
 * same role and key, so the same record path, which `of` never wrote). Every entry that waits for `of` waits for it too,
 * in the same write, so a verdict or answer seat is not launched before it returns. `appended` records the request.
 * A string where `of` is not a listed pre-launch entry, or already has its make-up seat.
 */
export function withMakeupEntry(list: LaunchList, of: string, appended: Appended, note = "", kept: readonly { at: string; sha256: string }[] = []): LaunchList | string {
  const src = list.entries.find((e) => e.id === of) as LaunchEntry | undefined;
  if (!src) return `the list has no entry ${of}`;
  if (isAppended(src)) return `${of} is an entry appended after the pre-launch step (${isMakeupEntry(src) ? "a make-up seat" : String(src.role)}), which gets no make-up seat`;
  const id = makeupIdOf(of);
  if (list.entries.some((e) => e.id === id)) return `${of} already has its make-up seat ${id}`;
  const copy = JSON.parse(JSON.stringify(src)) as LaunchEntry;
  // Unit U1: `note` names the places the seat before read and the capture kept (makeup-seat.ts `keptPlacesNote`).
  const agentInput = { ...copy.agent_input, description: `${copy.agent_input.description}${MAKEUP_WORDS}`, ...(note ? { prompt: `${copy.agent_input.prompt}${note}` } : {}) };
  // The kept files the note names are the entry's reads
  // too, each with the sha256 the hook recorded for it (makeup-seat.ts `keptPlacesFiles`), so the seat-read hook lets the
  // make-up seat read them, those bytes only.
  const reads = [...(Array.isArray(copy.reads) ? copy.reads : []), ...kept.map((k) => ({ role: "kept-places" as const, path: k.at, sha256: k.sha256 }))];
  const clone = { ...copy, id, makeup_of: of, after: [of], agent_input: agentInput, agent_input_sha256: sha256Of(canonicalJson(agentInput)), ...(kept.length > 0 ? { reads } : {}) };
  const out = appendEntries(list, [clone as unknown as LaterEntry], appended);
  for (const e of out.entries) if (e.id !== id && (e.after ?? []).includes(of) && !e.after.includes(id)) e.after.push(id);
  return out;
}

/** What the pre-launch step's write took from the run's standing list, for its report (`carryRunState`). */
export interface Carried {
  /** The run's standing list, read back as the program wrote it; null where none of this run stands. */
  from: { path: string; sha256: string; shape: string } | null;
  /** The appended entries carried into the new list, with their ids, briefs and digests. */
  entries: string[];
  /** Where a list of the run stands and cannot be read back as the list the program wrote: why; nothing of it was carried. */
  unreadable: string | null;
}

type Standing = { state: "none" } | { state: "read"; list: LaunchList; sha256: string } | { state: "unreadable"; problem: string };

/**
 * The run's standing list, for the pre-launch step's write: the file at `listPath` where it names run `runId` and has
 * the sha256 the program recorded for it - on the active marker of the run, `list_sha256`, or `previous_list_sha256`
 * while the attempt has written no list (hook-launch.ts `writeActiveRun`); with no marker of the run standing, on the
 * run's last history line. No file, or a list of another run, is nothing of this run's to carry.
 */
function standingRunList(listPath: string, runId: string, pass = 1): Standing {
  const got = readProgramFile("the launch list", listPath);
  if (!got.ok) return got.exit === "unreadable" && (got.code === "ENOENT" || got.code === "ENOTDIR") ? { state: "none" } : { state: "unreadable", problem: got.problem };
  let list: LaunchList;
  try {
    list = JSON.parse(got.value.toString("utf8")) as LaunchList;
  } catch (e) {
    return { state: "unreadable", problem: `it is not JSON (${valueText((e as Error).message)})` };
  }
  if (!list || typeof list !== "object" || list.kind !== "launch-list" || !Array.isArray(list.entries)) return { state: "unreadable", problem: "it is not a launch list" };
  if (list.run_id !== runId) return { state: "none" };
  const launchDir = dirname(listPath);
  // `previous_list_sha256` is kept through the list writer's first step, beside
  // the next list's digest: the list it names is still the run's standing list until the writer replaces it.
  const recordedBy = (m: ActiveRunMarker): string | null => (m.previous_list_sha256 === got.sha256 ? got.sha256 : (m.list_sha256 ?? m.previous_list_sha256 ?? null));
  const paired = markerOfList(listPath, got.sha256, runId, recordedBy);
  if (paired.state === "replaced") {
    return pass < LIST_PASSES ? standingRunList(listPath, runId, pass + 1) : { state: "unreadable", problem: `it was replaced while this command ran (sha256 ${got.sha256.slice(0, 16)}... when read, ${paired.now.slice(0, 16)}... a moment later)` };
  }
  const marker = paired;
  let recorded: string | null;
  let where: string;
  if (marker.state === "active" && marker.marker.run_id === runId) {
    recorded = marker.marker.outgoing_list_sha256 === got.sha256 ? got.sha256 : recordedBy(marker.marker);
    where = `the active-run marker ${valueText(join(launchDir, ACTIVE_RUN_FILE))}`;
  } else {
    const end = lastRunEnd(launchDir, runId);
    recorded = end === null ? null : (end.list_sha256 ?? end.previous_list_sha256);
    where = `run ${valueText(runId)}'s last line in the active-run history`;
  }
  if (recorded !== got.sha256) {
    return { state: "unreadable", problem: `its sha256 is ${got.sha256.slice(0, 16)}..., and ${where} records ${recorded === null ? "no list" : `${recorded.slice(0, 16)}...`}` };
  }
  return { state: "read", list, sha256: got.sha256 };
}

const idsText = (ids: string[]): string => `${ids.slice(0, 8).join(", ")}${ids.length > 8 ? `, and ${ids.length - 8} more` : ""}`;

/**
 * THE PRE-LAUNCH STEP'S LIST, WRITTEN OVER A LIST OF THE SAME RUN. A new attempt of a run keeps the run's state: it releases, it does
 * not forget. The entries the run appended - refuter and silence entries, each with the request it was appended for
 * (`appended[]`: command, record and its sha256, rule ids, entries, held candidates) - are the program's own, and the
 * records captured for them are bound to their ids; a list rewritten from the plan alone dropped them, so every such
 * record was refused `record-unbound` and a silence entry whose seat was lost could not be launched again. Here the
 * standing list of the same run, read back as the program wrote it (`standingRunList`), gives every appended entry to
 * the new list unchanged - the same ids, briefs, digests and requests, placed by `appendEntries` as the command placed
 * them - and an entry that had not returned is launchable as any other, its reservation released by the new attempt
 * (hook-launch.ts `writeActiveRun`). A caller that rewrites the list it read (the gates) hands in a list that holds
 * them already, and nothing is appended twice.
 *
 * What a shape of the new attempt would forget is refused by name, and nothing is written: an entry of the standing
 * list that the run launched (a reservation, release or relaunch line of the run's gate folder), that it appended, or
 * that such an entry waits for, and that the new list does not name - a narrower shape than the run's; and a refuter
 * entry under `refute_later`, which launches no refuter. Where a list of the run stands and cannot be read back, none
 * of it is read and nothing is carried; `carried.unreadable` says why, the step says so, and the assembly names every
 * record bound to an entry that list held, with the command that appends the entry again (assemble-report.ts
 * `recoveryOf`, `record-unbound`).
 */
export function carryRunState(next: LaunchList, listPath: string): { list: LaunchList; carried: Carried } {
  const standing = readStandingRun(listPath, next.run_id);
  if (standing.state === "none") return { list: next, carried: { from: null, entries: [], unreadable: null } };
  if (standing.state === "unreadable") return { list: next, carried: { from: null, entries: [], unreadable: standing.problem } };
  const prev = standing.run.list;
  let out = next;
  if (!next.entries.some(isAppended) && (next.appended ?? []).length === 0) {
    const laterById = new Map(prev.entries.filter(isAppended).map((e): [string, LaterEntry] => [e.id, e as LaterEntry]));
    for (const a of prev.appended ?? []) {
      const missing = (a.entries ?? []).filter((id) => !laterById.has(id));
      if (missing.length > 0) {
        throw new ListWriteRefused(`the run's list ${valueText(listPath)} records a ${a.command} request for entries it does not hold (${idsText(missing)}), so what the run appended cannot be carried whole`);
      }
      if (a.command === "makeup-entries") {
        // A make-up seat is made again from the new list's own entry (its brief and reads as this attempt wrote them), and
        // what waits for that entry waits for it again.
        const made = withMakeupEntry(out, String(a.makeup_of), a);
        if (typeof made === "string") throw new ListWriteRefused(`the run's list ${valueText(listPath)} holds the make-up seat ${idsText(a.entries)}, and it cannot be made again on the new list: ${made}`);
        out = made;
        continue;
      }
      out = appendEntries(out, a.entries.map((id) => laterById.get(id) as LaterEntry), a);
    }
  }
  const onNew = new Set(out.entries.map((e) => e.id));
  // A second look (a refuter entry in challenge mode) is the recommended shape's own.
  const refuters = out.entries.filter((e) => e.role === "refuter" && !isChallengeEntry(e)).map((e) => e.id);
  const problem = carryProblem(standing.run, next.run_id, listPath, out.shape, onNew, refuters);
  if (problem !== null) throw new ListWriteRefused(problem);
  const carried = prev.entries.filter(isAppended).map((e) => e.id).filter((id) => onNew.has(id));
  return { list: out, carried: { from: { path: listPath, sha256: standing.sha256, shape: prev.shape }, entries: carried, unreadable: null } };
}

/**
 * A RUN'S STANDING LIST AND WHAT A LIST WRITTEN OVER IT MUST KEEP, read once, for `carryRunState` and for the pre-launch
 * step's price of what remains (launch-plan.ts `runRemainder`), so the two never disagree on which
 * shapes the run can take: every entry of the standing list that the run launched (a reservation, release or relaunch
 * line of its gate folder) or appended, and what each waits for, to the end of the chain (a refuter, its verdict seat,
 * that seat's readers).
 */
export interface StandingRun {
  list: LaunchList;
  /** The entries the run appended: refuter and silence entries and make-up seats, with their requests. */
  appended: LaterEntry[];
  kept: Set<string>;
}

export function readStandingRun(listPath: string, runId: string): { state: "none" } | { state: "unreadable"; problem: string } | { state: "read"; run: StandingRun; sha256: string } {
  const standing = standingRunList(listPath, runId);
  if (standing.state !== "read") return standing;
  const prev = standing.list;
  const launched = entriesLaunchedInRun(dirname(listPath), runId);
  const kept = new Set(prev.entries.filter((e) => isAppended(e) || launched.has(e.id)).map((e) => e.id));
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of prev.entries) {
      if (!kept.has(e.id)) continue;
      for (const a of e.after ?? []) {
        if (!kept.has(a)) {
          kept.add(a);
          grew = true;
        }
      }
    }
  }
  return { state: "read", run: { list: prev, appended: prev.entries.filter(isAppended) as LaterEntry[], kept }, sha256: standing.sha256 };
}

/**
 * Why a list of shape `shape` holding the entries `onNew` (its refuter entries `refuters`) would forget run `runId`'s
 * state, in the words the pre-launch step refuses it with, or null: an entry the run keeps that it does not list - a
 * narrower shape than the run's - or refuter entries the run appended under `refute_later`, which launches no refuter.
 */
export function carryProblem(s: StandingRun, runId: string, listPath: string, shape: string, onNew: ReadonlySet<string>, refuters: string[]): string | null {
  const prev = s.list;
  const ways = prev.shape === "full" ? "full" : `${prev.shape} (the shape of the run's list) or full`;
  const dropped = prev.entries.map((e) => e.id).filter((id) => s.kept.has(id) && !onNew.has(id));
  if (dropped.length > 0) {
    return `run ${valueText(runId)}'s list, written again, keeps the run's state (a new attempt releases, it does not forget), and the shape ${valueText(shape)} does not list ${dropped.length} entr${dropped.length === 1 ? "y" : "ies"} of the run's list ${valueText(listPath)} (shape ${prev.shape}) that the run launched or appended (${idsText(dropped)}): a record captured for one would be bound to no entry - answer the run-shape question again with ${ways}`;
  }
  if (shape === "refute_later" && refuters.length > 0) {
    return `run ${valueText(runId)}'s list, written again, keeps the run's state (a new attempt releases, it does not forget), and the run appended ${refuters.length} refuter entr${refuters.length === 1 ? "y" : "ies"} to its list ${valueText(listPath)} (shape ${prev.shape}: ${idsText(refuters)}), which the refute_later shape does not launch - answer the run-shape question again with ${ways}`;
  }
  return null;
}

// ------------------------------------------------------------------------------------------------
// THE LOCK
// ------------------------------------------------------------------------------------------------

const LOCK_WAIT_MS = 5000;
/**
 * A holder keeps the lock for one read-modify-write of the list (run 1's largest append: well under a
 * second). A lock older than this is dead whatever process id it names: after a restart the id can
 * belong to an unrelated process.
 */
const LOCK_STALE_MS = 60_000;
/** A lock that names no holder (empty or torn: written by the program before 2026-09-25, or by hand) is dead once it is this old. */
const LOCK_TORN_MS = 2_000;

const pause = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const alive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Create `path` holding `text`, or return false where it exists (`createExclusive`, program-file.ts, its fallback included). */
const createHolding = (path: string, text: string): boolean => createExclusive(path, text);

/** A lock or take-over path holding something the program never writes there, as the refusal to give. */
class LockPathRefused extends Error {
  constructor(readonly refusal: string) {
    super(refusal);
  }
}

interface Seen {
  text: string;
  ino: number;
  mtimeMs: number;
}

/**
 * A lock file as it is now; null where it is gone. The path is looked at without following it: a symbolic
 * link (dangling or not), a directory, a named pipe or anything else that is not a regular file is refused by
 * name (`LockPathRefused`), and the file is read without blocking (`readProgramFile`; a lock has two names for a
 * moment while it is created, so any number of links is taken). Any other error names the file (`unusable`).
 */
function look(path: string): Seen | null {
  let st: Stats;
  try {
    st = lstatSync(path);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    if (typeof err.path !== "string") err.path = path;
    throw err;
  }
  if (!st.isFile()) {
    throw new LockPathRefused(
      `${valueText(path)} is ${kindOf(st)} where the program keeps a lock file, so the list's lock cannot be taken: remove it (${toldArgs(st.isDirectory() ? ["rm", "-r", path] : ["rm", path])}) and run this command again`,
    );
  }
  const got = readProgramFile("the list's lock", path, undefined, { anyLinks: true });
  if (!got.ok) {
    if (got.code === "ENOENT") return null;
    throw new LockPathRefused(`the list's lock cannot be taken: ${valueText(got.problem)}`);
  }
  return { text: got.value.toString("utf8"), ino: st.ino, mtimeMs: st.mtimeMs };
}

const same = (a: Seen, b: Seen): boolean => a.text === b.text && a.ino === b.ino && a.mtimeMs === b.mtimeMs;
/** `<pid>` (as written before 2026-09-25) or `<pid> <nonce>`. */
const holderOf = (text: string): number | null => {
  const m = /^(\d+)(?: [0-9a-f]+)?\n?$/.exec(text);
  return m ? Number(m[1]) : null;
};

function dead(s: Seen, staleMs: number): boolean {
  const age = Date.now() - s.mtimeMs;
  const pid = holderOf(s.text);
  if (pid === null) return age > LOCK_TORN_MS;
  return !alive(pid) || age > staleMs;
}

/** How deep a chain of take-over files is followed, each taken over the same way where its holder has died. */
const TAKEOVER_DEPTH = 3;

/**
 * Remove the lock `seen` describes, and nothing else, at most once across all processes: only the process
 * that creates `<path>.takeover-<id of what it saw>` may remove it, and it removes it only after reading,
 * while holding that file, that the lock is still the one it judged dead. Where another process holds the
 * takeover file and has died doing so, that file is itself a dead lock and is taken over the same way, to
 * `TAKEOVER_DEPTH`. Returns null; or, where the chain goes deeper and every file in it is dead, those
 * take-over files: no request can remove them, and a person must.
 */
function takeOver(path: string, seen: Seen, mine: string, depth: number): string[] | null {
  const id = sha256Of(`${seen.text}\n${seen.ino}\n${seen.mtimeMs}`).slice(0, 16);
  const takeover = `${path}.takeover-${id}`;
  if (!createHolding(takeover, mine)) {
    const other = look(takeover);
    if (!other || !dead(other, LOCK_TORN_MS)) return null;
    if (depth >= TAKEOVER_DEPTH) return [takeover];
    const stuck = takeOver(takeover, other, mine, depth + 1);
    return stuck ? [takeover, ...stuck] : null;
  }
  try {
    const now = look(path);
    if (now && same(now, seen)) removePath(path, { force: true });
  } finally {
    removePath(takeover, { force: true });
  }
  return null;
}

/**
 * A lock path the program cannot use, as a refusal that names it and says what to do: what
 * `look` refused by kind, a missing launch directory, and otherwise the remedy for the error's code
 * (`refusalFor`), naming the lock or take-over file, never its temporary file.
 */
function unusable(lock: string, e: unknown): string {
  if (e instanceof LockPathRefused) return e.refusal;
  const err = e as NodeJS.ErrnoException;
  if (err.code === "ENOENT" && !existsSync(dirname(lock))) return `the launch directory ${valueText(dirname(lock))} does not exist, so there is no launch list: it is written by the pre-launch step (\`legal-scan adjudicate --shape\`)`;
  return `the list's lock cannot be taken: ${refusalFor(e, lock)}`;
}

/**
 * `body` under the list's lock: `<list>.lock`, created holding this process's id and a nonce. A dead
 * holder's lock is taken over (`takeOver`); a live holder is waited for up to `LOCK_WAIT_MS`, and then the
 * request is refused by name. A lock path it cannot use, or a chain of dead take-over files no request can
 * remove, is refused at once, by name and with what to do. The lock is released only while it is still
 * this process's. The lock serialises the program's own read-modify-write of the list; a reader (the gate)
 * needs none, because the list is only ever replaced whole. A refusal says what was not done; the caller
 * says what it had written, if anything.
 */
export function withListLock<T>(listPath: string, body: () => T): T | { locked: string } {
  const lock = `${listPath}.lock`;
  const mine = `${process.pid} ${randomBytes(8).toString("hex")}\n`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  try {
    for (;;) {
      if (createHolding(lock, mine)) break;
      const seen = look(lock);
      if (seen === null) {
        // Gone between the create and the look: go round again, but never without a pause and a deadline.
        if (Date.now() > deadline) return { locked: `the lock ${lock} could not be created, and nothing stands at its path when it is looked at - run this command again` };
        pause(5);
        continue;
      }
      if (dead(seen, LOCK_STALE_MS)) {
        const stuck = takeOver(lock, seen, mine, 0);
        if (stuck) {
          return {
            locked: `the lock ${lock} is dead (its holder has exited, or it is older than any append holds it), and it cannot be taken over: ${stuck.length} take-over files left by processes that died while taking it over are in the way, and no request removes them - delete them (${toldArgs(["rm", ...stuck])}) and run this command again`,
          };
        }
        if (createHolding(lock, mine)) break;
        if (Date.now() > deadline) return { locked: `the lock ${lock} names a holder that has exited, and another process is taking it over - run this command again` };
        pause(5);
        continue;
      }
      const holder = String(holderOf(seen.text) ?? "(unnamed)");
      if (Date.now() > deadline) return { locked: `the launch list is being written by process ${holder} (lock ${lock}) - run this command again once it has returned` };
      pause(50);
    }
  } catch (e) {
    return { locked: unusable(lock, e) };
  }
  try {
    return body();
  } finally {
    try {
      const now = look(lock);
      if (now && now.text === mine) removePath(lock, { force: true });
    } catch {
      // A lock that cannot be read back is left in place; the next request names it (`unusable`).
    }
  }
}

/** How the launch side names a record it reads, in its refusals: a refuter's (under verdicts/refutation/) or an adjudicator's. */
export const recordLabelOf = (rel: string): string => (rel.startsWith("verdicts/refutation/") ? "the refuter record" : "the adjudicator record");

/** A record's text as it is now under `legalDir`, through the one reader (program-file.ts, item 4), as `planRefuterEntries` reads it; null where it does not read. */
function recordTextNow(legalDir: string, rel: string): string | null {
  const got = readProgramFile(recordLabelOf(rel), join(legalDir, rel));
  return got.ok ? got.value.toString("utf8") : null;
}

/**
 * WHETHER A `refuter-entries` LINE OF THE LIST EXAMINED A RECORD AS ITS BYTES ARE NOW:
 * the line names the record's path AND the sha256 of the text it was
 * built from (`record_sha256`, which `buildRefuterEntries` writes). A record replaced at the same path with other bytes
 * (738's replacement: `verdict-capture --replace`, the hook's `setAsideReplacement`) is examined by no line, so it is due
 * again; a line that records no sha256 shows no bytes, and examines nothing. Every reader of the list's refuter-entries
 * lines by record decides through this - the refusal of a record already examined (`buildRefuterEntries`), the relay's
 * due list (hook-launch.ts `refuterEntriesDue`), the status line's count (launch-plan.ts `refuterNote`, given
 * `examinedRecords`) and the candidates the assembly reports as held (assemble-hooked.ts `heldRefutations`) - and none
 * matches on the path alone.
 */
export function examines(line: Appended, rel: string, recordText: string): boolean {
  return line.command === "refuter-entries" && line.record === rel && typeof line.record_sha256 === "string" && line.record_sha256 === sha256Of(recordText);
}

/** The list's refuter-entries lines that examined their record as its bytes are now under `legalDir` (`examines`); a record that does not read is examined by none. */
export function currentExaminations(list: LaunchList, legalDir: string): Appended[] {
  const texts = new Map<string, string | null>();
  const textOf = (rel: string): string | null => {
    if (!texts.has(rel)) texts.set(rel, recordTextNow(legalDir, rel));
    return texts.get(rel) ?? null;
  };
  return (list.appended ?? []).filter((a) => {
    if (a.command !== "refuter-entries" || typeof a.record !== "string") return false;
    const text = textOf(a.record);
    return text !== null && examines(a, a.record, text);
  });
}

/** The hold `buildRefuterEntries` writes for a violation candidate that already has a refuter entry (launch-later.ts). */
export const alreadyHasEntry = (entryId: string): string => `it already has the refuter entry ${entryId}`;
// The reader's pattern is made from the writer above, so the sentence has one source; a new
// line cannot be part of an entry id (the pattern's \S+), so it marks where the id goes.
const [ALREADY_HAS_HEAD, ALREADY_HAS_TAIL] = alreadyHasEntry("\n").split("\n") as [string, string];
const literal = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ALREADY_HAS = new RegExp(`^${literal(ALREADY_HAS_HEAD)}(\\S+)${literal(ALREADY_HAS_TAIL)}$`);

/** The refuter entry a hold adopts (`alreadyHasEntry`), or null for any other hold. */
export function adoptedEntryOf(h: { reason?: unknown } | null | undefined): string | null {
  const m = typeof h?.reason === "string" ? ALREADY_HAS.exec(h.reason) : null;
  return m ? m[1]! : null;
}

/**
 * A REFUTER ENTRY ANSWERS THE RECORD BYTES IT WAS MADE FROM. `refuter-entries`
 * makes an entry from an examination of a record's bytes (`record_sha256`), reading from the record only which
 * candidates it classes violation_candidate; a record replaced at the same path (738) may no longer class that
 * candidate so, and the entry's refuter would then answer a verdict that no longer exists. An entry STANDS while an
 * examination of the record as its bytes are now (`currentExaminations`) names it - among its entries, or holding its
 * candidate because it already has that entry (`alreadyHasEntry`), which is how the examination of a replacement that
 * still classes the candidate violation_candidate keeps it - and wherever nothing can say otherwise (the line that made
 * it records no bytes, or the record does not read: those are other lines' business). Every other refuter entry is
 * SUPERSEDED: the relaunch rule does not launch it (entry-answer.ts `relaunchable`), the assembly does not wait for it
 * and does not count its answer as the candidate's refutation (assemble-hooked.ts, assemble-report.ts), and says so.
 * Returns each superseded entry with the reason.
 */
function supersededRefuterEntries(list: LaunchList, legalDir: string): Map<string, string> {
  const out = new Map<string, string>();
  const refuters = new Set(list.entries.filter((e) => String(e.role) === "refuter").map((e) => e.id));
  if (refuters.size === 0) return out;
  const named = new Set<string>();
  for (const a of currentExaminations(list, legalDir)) {
    for (const e of a.entries ?? []) named.add(e);
    for (const h of a.held ?? []) {
      const e = adoptedEntryOf(h);
      if (e) named.add(e);
    }
  }
  for (const a of list.appended ?? []) {
    if (a.command !== "refuter-entries" || typeof a.record !== "string" || typeof a.record_sha256 !== "string") continue;
    const text = recordTextNow(legalDir, a.record);
    if (text === null || examines(a, a.record, text)) continue;
    for (const e of a.entries ?? []) {
      if (!refuters.has(e) || named.has(e) || out.has(e)) continue;
      out.set(e, `it was made from ${a.record} as its bytes were then (sha256 ${a.record_sha256.slice(0, 12)}), and no examination of the record as it is now names it: the verdict it was to refute no longer exists`);
    }
  }
  /* A second look waits on the refuter entry whose overturn it checks (`after`). Where that entry is superseded, the overturn
   * no longer stands, so the look answers nothing that does: it is superseded too, whatever an examination of the refuter's
   * record says, and its answer is never laid on the verdict that replaced the one it was made for. The program writes
   * `after` as the one entry the look checks; where a list names more, one superseded among them supersedes the look (the
   * look then counts as not answered, which the report shows, never as settled). Repeated until nothing changes, so a look
   * that waits on another look is superseded wherever either stands on the list. */
  for (let changed = true; changed; ) {
    changed = false;
    for (const e of list.entries) {
      if (String(e.role) !== "refuter" || (e as { mode?: unknown }).mode !== "challenge" || out.has(e.id)) continue;
      const after = Array.isArray((e as { after?: unknown }).after) ? ((e as { after: unknown[] }).after.filter((x) => typeof x === "string") as string[]) : [];
      const gone = after.find((x) => out.has(x));
      if (gone !== undefined) {
        out.set(e.id, `it is the second look at the overturn of the refuter entry ${gone}, which is superseded: the overturn it was to check no longer stands`);
        changed = true;
      }
    }
  }
  return out;
}

/**
 * THE REFUTER ENTRIES AND ANSWERS THAT STAND (the class: a reader that does not
 * ask whether a refuter entry is superseded shows a superseded refuter's answer as a refutation, or as the reason a
 * candidate is not refuted). The one way into whether a refuter entry stands: `supersededRefuterEntries` above is private
 * to this module, so no reader can decide on a refuter entry, or on an answer of its seat, without this accessor.
 * - `superseded`: every superseded refuter entry, with why (the relaunch rule's state, the assembly's `noted:` lines);
 * - `stands(entry)`: false only for a superseded refuter entry - every other entry, and an id the list does not hold,
 *   stands. An answer of an entry that does not stand (its hook ledger lines, its kept invalid answer, its record, a
 *   line that sets it aside) answers a verdict that no longer exists, and no reader takes it as a refutation, as a
 *   refutation not established, or as anything a candidate is listed for.
 * Its readers: entry-answer.ts `readAnswerLedgers` (the
 * relaunch rule and the not-judged rule, `keptInvalidOf`), assemble-hooked.ts (held refutations, the run's `superseded`,
 * its decisions and its unanswered entries), assemble-report.ts (records bound to an entry, `answerOfRefusal`'s ids of an
 * entry), and the status line (launch-plan.ts `refuterNote`, through the ledgers). A list that is not given (it does not
 * read) supersedes none.
 */
export interface StandingRefuters {
  readonly superseded: ReadonlyMap<string, string>;
  stands(entryId: string): boolean;
}

export function standingRefuters(list: LaunchList | null, legalDir: string): StandingRefuters {
  const superseded: ReadonlyMap<string, string> = list === null ? new Map() : supersededRefuterEntries(list, legalDir);
  return { superseded, stands: (entryId) => !superseded.has(entryId) };
}
