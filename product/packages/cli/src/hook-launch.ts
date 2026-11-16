/**
 * THE LAUNCH GATE.
 * While a scan run is active in a session, a seat is launched only from the
 * launch list the program wrote: the `Agent` call's whole input must equal an entry that has not been
 * launched yet, the entry is reserved at once, the launch result binds it to the seat's agent id, and
 * every seat that starts without a reservation is recorded on the first event that shows it.
 *
 * WHICH INPUT FIELDS ARE COMPARED: the launch contract.
 * It depends on what the host does with a launch, not on one
 * literal field, because the `Agent` tool's fields are not the same in every session: Claude Code 2.1.283 offers
 * `run_in_background` only where the session neither runs agents in its fork mode (the default of an interactive
 * session) nor has background tasks turned off, and drops the field, and any field it does not offer, from a call
 * before a hook sees it (probe runs P1 and P2; the owner's second real run was refused at every launch because
 * the entries named the field). So:
 * - every field the entry's `agent_input` names besides `run_in_background` (`subagent_type`, `description`,
 *   `prompt`, `model`) must arrive with the same value, a string code unit for code unit. Each changes what runs:
 *   the type picks the agent definition and its tools, the prompt is the one line naming the program's brief, the
 *   model is the one the price table priced, the description is the seat's label the person sees;
 * - `run_in_background` may be left out or be `true`: both run the seat in the background, whose launch result, which
 *   carries the binding, arrives as the seat starts (probe runs A-D, H, J-L on 2.1.281; P1, P2, P4, P5 on 2.1.283).
 *   `false` reaches the hook only where the tool offers the field, and there it runs the seat in the foreground: its
 *   result arrives only after the seat has answered (probe runs E and I), so the capture could not tell whose answer it
 *   is, and it is refused. Where the session has background tasks turned off (`BACKGROUND_OFF_ENV`), every launch runs
 *   in the foreground whatever the call says (P3), so no listed launch goes out; and a launch result that says its
 *   seat ran in the foreground (a `status` other than `async_launched`) stops every later launch of the run
 *   (`HOST_FOREGROUND_FILE`);
 * - no other field: `isolation` (a worktree or a remote session would give the seat a copy of the tree, not the
 *   scanned one), `name`, and any field a later Claude Code adds. Both reach the hook (P1, P2).
 * The entry names the background form either way: `launch: "background"` in a list written since this change, and
 * `run_in_background: true` inside `agent_input` in a list written before it (`namesBackground`), which the gate still
 * launches, so a run paused on such a list continues on it. The comparison is per field, so the order of the keys
 * does not matter.
 *
 * NOTHING ELSE PUTS TEXT INTO A SEAT (`gateDelivery`). Of Claude Code 2.1.281's tools, three more carry the
 * caller's own text into a seat, and each is refused while the run is active: `SendMessage` delivers to a
 * running seat at its next tool round and resumes a stopped one (refused when it names an agent the hooks
 * recorded, or a name the gate cannot resolve); `Skill` with a skill whose frontmatter says `context: fork`
 * starts an agent of the type the skill names, a seat included, without an `Agent` call (refused unless it
 * is one of this plugin's own skills and its SKILL.md, read at the call, names neither `context` nor `agent`:
 * `ownSkillForm`); `Workflow` runs a script whose `agent()` takes any agent type (refused: the call cannot
 * say what the script starts). A seat's instructions come only from its brief.
 *
 * WHEN IT ACTS: only while `.legal/launch/active-run.json` (the active-run marker) exists and names the
 * event's session. The pre-launch step writes it when it writes the run-shape question (`writeActiveRun`),
 * `run-abort` or the assembly removes it (`endActiveRun`). The marker carries the session id that this
 * module's SessionStart route exports into the session's Bash (`CLAUDE_ENV_FILE`, probe fact (g)), so a
 * marker a crashed run left behind acts in that session only: any other session passes untouched. Inside
 * Claude Code (its Bash carries `CLAUDECODE` or `CLAUDE_CODE_SESSION_ID`) the pre-launch step writes no marker
 * without that session id, nor with a blank one or another session's (`markerSessionRefusal`). A marker written outside Claude Code names no session and is claimed by the
 * first `Agent` call the main session of a Claude Code session on the project makes after it was written;
 * until then no event is the run's, so SendMessage, Skill and Workflow pass, and a fork's launch never claims.
 *
 * WHAT IT TRUSTS: the marker and the list as they are on disk. It checks that the list is the one the marker
 * records (sha256), not that nobody rewrote both. Writes into `.legal/launch` are refused by the write guard
 * of relay item 3 (hook-guard.ts), within that guard's stated limits. It does not trust the files the list
 * names: before an entry is reserved, its brief and every file the brief names are read and checked against
 * the digests the list records (`seatFileProblems`), so a brief rewritten past the guard is not launched.
 * What stays open is the window after the check: a file rewritten between the launch and the seat's Read of
 * it is read as rewritten. In the 13 recorded launches whose seat is known (the relay probe's and the live
 * check rh4c's), the seat's first Read came 1.95 to 11.36 s after the gate's check, median 2.20 s; each
 * further file the brief names stays open until the seat reads it. Files the list records no digest for
 * (a file the program did not copy, the run context, a verdict seat's fold) are checked only for existence.
 *
 * ATOMIC WITHOUT A LOCK: every state change is one exclusive create (`createOnce`: a complete temporary
 * file hard-linked to its name, which fails if the name exists) or one rename. A hook that times out is
 * killed (probe fact (f)); a lock it held would stop every later launch, a half-made create cannot.
 *
 * FAIL-CLOSED WHILE A RUN IS ACTIVE: an error inside the gate refuses the launch with the error as the
 * reason and one line in the failure log, since a gate that exits 1 lets the launch through (probe fact
 * (f)). With no marker, nothing is read beyond the marker's absence and nothing is written.
 *
 * Seats and agents are recognised as hook.ts does (`whoIs`). An internal agent (probe fact (i): `agent_type`
 * empty or absent, which a fork may carry) reaches the gate, the binding and the failure routes, so its
 * launches are gated and bound; it never reaches the routes that count seats, and is never counted.
 */
import { pluginSessionsAround, recordPluginSession } from "./plugin-sessions.js";
import { createHash, randomBytes } from "node:crypto";
import { agentTranscriptOf } from "./seat-opened.js";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { StandingRefuters } from "./launch-list-file.js";
import { appendFileAt, makeFolder, removeFile, renamePath, writeFileAt } from "./project-write.js";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ACTIVE_RUN_HISTORY_FILE, HOOK_PLUGIN_NAME, PASS, programInstant, runPaths, RELAY_AGENT_TYPE, SEAT_AGENT_TYPES, clearScanUnderWay, markScanUnderWay, recordHookFailure, type HookContext, type HookDecision, type HookInput, type RunPaths } from "./hook.js";
import { EFFORT_LEVEL_ENV, HOOKS_POLICY_WORDS, PROFILE_CHECK_ENV, profileCheckValue, scanProfileState, sessionCommand } from "./scan-profile.js";
import { SEAT_CAPTURES_FILE, readHookLedger } from "./hook-capture.js";
import type { SecondLook } from "./disposition.js";
import { isChallengeRecord, lookAnswerOf, lookLeavesOverturnToPerson } from "./second-look.js";
import { locationOverturnStands, refutationUnusable } from "./standing.js";
import { seatEfforts, seatPins, type EffortLedgerLine, type SeatEffort } from "./seat-effort.js";
import { FOLD_NOT_TOLD, IN_BASH, ownPlugin, scannerCommand as scannerCommandAsRun, shellWord, toldArgs, toldFoldCommand } from "./scanner-command.js";
import { READ_ROLE_WORDS, readLaunchEvents, runShapeFromAnswer, runStatus, type LaunchEntry, type LaunchEvent, type LaunchList, type ReadRole, type RelayEntry, type RunStatus } from "./launch-plan.js";
import { grouped } from "./cost-preview.js";
import type { LaterEntry } from "./launch-later.js";
import { createExclusive, readProgramFile } from "./program-file.js";
import { LEGAL_DIR_NAME, writeLegalIgnore } from "./legal-dir.js";
// The `.legal` folder's name and its ignore files moved to legal-dir.ts, so that every command can write
// them without loading this module; re-exported here for the callers that import them from this file.
export { LEGAL_COMMITTED_FILES, LEGAL_DIR_NAME, LEGAL_GITIGNORE_FILE, LEGAL_GITIGNORE_TEXT, LEGAL_IGNORE_FILE, LEGAL_IGNORE_TEXT, legalDirOf, writeLegalIgnore } from "./legal-dir.js";
import { declarationUnderWay } from "./hook-question.js";
import { readRegularFile } from "./project-read.js";
import { findingsChangedProblem } from "./log-digest.js";
import { isLaunchRecordRefusal, launchRecordOwner, launchRecordPath, transcriptPlaceRefusal } from "./state-record.js";
import { valueText } from "./value-text.js";
import { canonicalPath, foldName, processStateDir, realOfNearest } from "./start-record.js";

/**
 * An entry of the launch list: the pre-launch step's (`LaunchEntry`), or a refuter or silence-investigator entry
 * appended later (`LaterEntry`, launch-later.ts: `brief_path` and `brief_sha256`, no `reads`, no `fold`). The gate
 * launches both the same way (relay integration part B, item 1).
 */
export type ListedEntry = LaunchEntry | LaterEntry;

/** A refuter or silence-investigator entry, which launch-later.ts appends: its brief carries everything it hands on. */
export const isLaterEntry = (e: ListedEntry): e is LaterEntry => e.role === "refuter" || e.role === "silence-investigator";

/** Beside the launch list, in the run's launch directory. */
export const ACTIVE_RUN_FILE = "active-run.json";
/** One line per ended run: which run, which session, when it started and ended, and how. */
/** Its one name lives in hook.ts, where the light entry reads it (the write guard's rows, relay item 7 hardening 2). */
export { ACTIVE_RUN_HISTORY_FILE };
/** One line per plugin seat that started in a session with no active run (decision 4 check (3)). */
export const OUTSIDE_RUN_SEATS_FILE = "seats-outside-run.jsonl";
/** The gate's own state, one directory per run id. */
export const GATE_DIR = "gate";
/** Exported into the session's Bash by the SessionStart route, read by the pre-launch step. */
export const SESSION_ENV = "WOLFBOY_SESSION_ID";
export const PROJECT_ENV = "WOLFBOY_PROJECT_DIR";
/**
 * The timeout of hooks.json's PostToolUse `Agent` group, in seconds (the gate test checks the two agree): a
 * launch result reaches the binding within it, or the hook was killed and failed open (probe fact (f)).
 */
export const LAUNCH_RESULT_HOOK_TIMEOUT_S = 30;
/** Added to that timeout before the program releases a reservation that got no launch result. */
export const STALE_RESERVATION_MARGIN_S = 90;
const STALE_RELEASE_MS = (LAUNCH_RESULT_HOOK_TIMEOUT_S + STALE_RESERVATION_MARGIN_S) * 1000;
/** The agent ids Claude Code 2.1.281 gave every seat and agent the probe and the live checks saw: `a` and 16 hex digits. */
export const AGENT_ID_SHAPE = /^a[0-9a-f]{16}$/;

export interface ActiveRunMarker {
  kind: "active-run";
  version: 1;
  run_id: string;
  scan_id: string;
  /** The Claude Code session running the scan (`SESSION_ENV` in the pre-launch shell); null where it was not there. */
  session_id: string | null;
  /** One start of the run. A new attempt begins whenever the marker is written with no marker of the same run and session standing. */
  attempt: string;
  started_at: string;
  written_at: string;
  launch_dir: string;
  /** sha256 of launch-list.json as the pre-launch step wrote it; null until a list is written in this attempt of the run. */
  list_sha256: string | null;
  /**
   * In a new attempt of a run that already wrote a list, until the attempt's own list is in place: that list's sha256,
   * as the run's previous marker or its last history line recorded it (`writeActiveRun`). The pre-launch step reads the
   * list back against it and carries into the attempt's own list what the run appended to it (launch-list-file.ts
   * `carryRunState`: a new attempt keeps the run's state - it releases, it does
   * not forget). It is kept through the list writer's first step, beside the next list's `list_sha256`, and dropped at
   * its last (launch-list-file.ts `replaceLaunchList`), so it stays on a marker whose list replacement failed. It confers nothing on the launch gate, which launches only a list this
   * attempt's writer recorded: `list_sha256`'s, or `outgoing_list_sha256`'s while the writer replaces it (`recordsList`),
   * and the writer never names this list as outgoing. Absent otherwise.
   */
  previous_list_sha256?: string | null;
  /**
   * While the one list writer replaces the list: the sha256 of the list it
   * replaces (`replaceLaunchList` records the next list's digest first, then replaces the list, then drops this), so a
   * reader that meets the list before the replacement takes it. Only a list this attempt wrote (`list_sha256` when the
   * write began), never `previous_list_sha256`. Absent otherwise.
   */
  outgoing_list_sha256?: string;
  /**
   * The scan launch profile as the plugin's SessionStart hook found it in the session's own environment (
   * scan-profile.ts): `on`, or `waived` (the person started the session without it) with the parts missing. The
   * pre-launch step refuses a session whose verdict is `off`, so a marker records `on` or `waived`. Absent where the hook
   * exported none (no SessionStart hook of this build ran).
   */
  scan_profile?: { state: "on" | "off" | "waived"; missing: string[] };
  /**
   * The effort level `legal-scan session` named at the session's start (scan-profile.ts `startEffort`); null
   * where it named none, so the session runs at the person's own level. Each launch's call record copies it beside the
   * level the launch's event carried (`effortChanges`). Absent on a marker written before the field.
   */
  start_effort?: string | null;
  /**
   * The version of the program that started the run (its package.json
   * `version`), kept through every later write and attempt of the same run, so that a program updated part-way says the
   * run's launch list and briefs are another version's (`launch-next`, `programVersionSentence`). Absent on a marker
   * written before the field, or where the version could not be read: then nothing is said.
   */
  program_version?: string;
}

let programVersionRead: string | null | undefined;
/** This program's version, from the package.json beside its dist folder; null where it cannot be read. */
export function programVersion(): string | null {
  if (programVersionRead !== undefined) return programVersionRead;
  try {
    const v = (JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")) as { version?: unknown }).version;
    programVersionRead = typeof v === "string" && v !== "" ? v : null;
  } catch {
    programVersionRead = null;
  }
  return programVersionRead;
}

/**
 * The sentence for the person where the run was started by another version of
 * the program than the one running now (an update between a stop and the run's resume). Null where the versions agree or
 * either is unknown. Ending the run stays the person's decision: launch-next still lists what is launchable.
 */
export function programVersionSentence(marker: Pick<ActiveRunMarker, "program_version">, launchDir: string, now: string | null = programVersion()): string | null {
  const then = marker.program_version;
  if (typeof then !== "string" || now === null || then === now) return null;
  return `This scan was started by version ${valueText(then)} of the plugin, and version ${valueText(now)} is running now, so the rest of the run follows a plan the earlier version wrote. To scan with this version, end the run with ${abortCommand(launchDir)} and ask for the scan again.`;
}

/** One reserved entry. `seat` and `bound_at` are added by the launch result. */
export interface Reservation {
  entry: string;
  tool_use_id: string;
  subagent_type: string;
  session_id: string;
  reserved_at: string;
  seat?: string;
  bound_at?: string;
  /**
   * Who made the launch call: "main", or the calling agent's id (a relay's).
   * A relay is woken only by the seats it launched itself. Absent on a
   * reservation an earlier build wrote, which is then read as possibly any caller's.
   */
  by?: string;
}

/** A non-internal agent the run saw, on the first event that showed it. */
export interface SeatSighting {
  agent_id: string;
  agent_type: string;
  plugin_seat: boolean;
  via: string;
  at: string;
}

export type RefusalKind = "auto-mode" | "unlisted" | "foreground" | "reserved" | "waits" | "capacity" | "no-list" | "list-changed" | "brief-changed" | "malformed" | "error" | "message" | "skill" | "workflow" | "schedule" | "second-session" | "caller" | "relay" | "shape" | "assembly";

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const codeOf = (e: unknown): string | undefined => (e as NodeJS.ErrnoException | undefined)?.code;
const sha256 = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");
const safe = (s: string): string => s.replace(/[^A-Za-z0-9._-]/g, "_");
const line = (v: unknown): string => `${JSON.stringify(v)}\n`;

/**
 * Create `path` holding `text` only if nothing has that name yet: true when this call made it. The reservations
 * and the lock are one class (relay integration part B, item 4): `createExclusive` (program-file.ts), which falls
 * back to an exclusive create where the file system refuses hard links.
 */
function createOnce(path: string, text: string): boolean {
  makeFolder(dirname(path), { recursive: true });
  return createExclusive(path, text);
}

/** Replace `path` with `text` in one rename. */
function replaceFile(path: string, text: string): void {
  makeFolder(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileAt(tmp, text);
  renamePath(tmp, path);
}

/**
 * One of the gate's own files (a reservation, a call, a seat), or null. Through the one reader (program-file.ts,
 * item 4): never waited on; a reservation has two names for a moment while it is created, so any number is taken.
 */
function readJson<T>(path: string): T | null {
  const got = readProgramFile("the gate's record", path, undefined, { anyLinks: true });
  if (!got.ok) return null;
  try {
    return JSON.parse(got.value.toString("utf8")) as T;
  } catch {
    return null;
  }
}

function readJsonDir<T>(dir: string): T[] {
  if (!existsSync(dir)) return [];
  const out: T[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    const v = readJson<T>(join(dir, name));
    if (v !== null) out.push(v);
  }
  return out;
}

/** A JSON-lines file the program wrote, through the one reader (program-file.ts); exported for the assembly's history read. */
export function readJsonLines<T>(path: string): T[] {
  // Through the one reader (program-file.ts, item 4): missing is empty; anything else it refuses fails the gate closed.
  const got = readProgramFile("the record", path);
  if (!got.ok && (got.code === "ENOENT" || got.code === "ENOTDIR")) return [];
  if (!got.ok) throw new Error(got.problem);
  const out: T[] = [];
  for (const l of got.value.toString("utf8").split("\n")) {
    if (l.trim() === "") continue;
    try {
      out.push(JSON.parse(l) as T);
    } catch {
      /* a line cut by a crash is not a record */
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// THE ACTIVE-RUN MARKER
// ------------------------------------------------------------------------------------------------

export type MarkerRead = { state: "none" } | { state: "unreadable"; error: string; notCopied?: true; markerSha256?: string } | { state: "active"; marker: ActiveRunMarker; sha256?: string };

/**
 * THE MARKER AND ITS COPY, READ IN ORDER, NOT
 * WAITED FOR. A program write of the marker names the marker it replaces first (`writeMarkerInOrder`: the outgoing
 * marker's sha256 beside the copy), then writes the copy, then the marker, then drops the outgoing name; so at every
 * moment the marker on disk is either the copy's or the one the copy's outgoing name names (`markerCopyProblem`). A reader
 * reads the marker, then the copy: where they disagree it reads the marker again, and a marker that changed meanwhile is
 * a program write that moved on, read again in full; one that did not change is not the program's, however slow a writer
 * is. Before, the reader waited a fixed 4 x 25 ms, and a writer slower than that was refused as a change outside the
 * program. MARKER_PASSES bounds the passes, each taken only because the marker changed.
 */
const MARKER_PASSES = 8;
export function readActiveRun(launchDir: string): MarkerRead {
  let read: MarkerRead = { state: "none" };
  for (let n = 1; n <= MARKER_PASSES; n++) {
    read = readActiveRunOnce(launchDir);
    if (read.state !== "unreadable" || read.notCopied !== true) return read;
    const again = readProgramFile("the active-run marker", join(launchDir, ACTIVE_RUN_FILE));
    if (again.ok && again.sha256 === read.markerSha256) return read;
  }
  // Words
  return read.state === "unreadable" ? { ...read, error: `it was rewritten ${MARKER_PASSES} times while this command read it, so it could not be compared with the program's copy - run this command again` } : read;
}

/**
 * A MARKER READ BEFORE THE LIST, MET BY THE
 * PROGRAM'S NEXT LIST. The one list writer records the next list's sha256 on the marker first, keeping the list it
 * replaces as `outgoing_list_sha256`, then replaces the list, then drops the outgoing digest (launch-list-file.ts
 * `replaceLaunchList`), so the marker on disk always records the list on disk. A reader that read the marker before such
 * a write and the list after it reads the marker again; a marker that changed is read again (MARKER_PASSES), and one
 * that did not change and does not record the list was not the program's pair. Taken where the marker of the same run,
 * attempt and session records the list (`sha`), as its list or its outgoing one. Null where none does.
 */
export const recordsList = (m: ActiveRunMarker, sha: string): boolean => m.list_sha256 === sha || m.outgoing_list_sha256 === sha;
export function markerRecording(launchDir: string, marker: ActiveRunMarker, sha: string): ActiveRunMarker | null {
  let m = marker;
  for (let n = 1; n <= MARKER_PASSES; n++) {
    if (recordsList(m, sha)) return m;
    const again = readActiveRun(launchDir);
    if (again.state !== "active" || again.marker.run_id !== marker.run_id || again.marker.attempt !== marker.attempt || again.marker.session_id !== marker.session_id) return null;
    if (JSON.stringify(again.marker) === JSON.stringify(m)) return null;
    m = again.marker;
  }
  return null;
}

function readActiveRunOnce(launchDir: string): MarkerRead {
  // Through the one reader (program-file.ts, item 4): a named pipe, a link or a directory at the marker's path is
  // not a marker the program wrote, and is never waited on.
  const got = readProgramFile("the active-run marker", join(launchDir, ACTIVE_RUN_FILE));
  if (!got.ok) return got.code === "ENOENT" || got.code === "ENOTDIR" ? { state: "none" } : { state: "unreadable", error: got.problem };
  const text = got.value.toString("utf8");
  try {
    const m = JSON.parse(text) as Partial<ActiveRunMarker> | null;
    const ok =
      !!m &&
      m.kind === "active-run" &&
      m.version === 1 &&
      typeof m.run_id === "string" &&
      m.run_id !== "" &&
      typeof m.attempt === "string" &&
      m.attempt !== "" &&
      (m.session_id === null || (typeof m.session_id === "string" && m.session_id !== "")) &&
      (m.list_sha256 === null || typeof m.list_sha256 === "string") &&
      (m.previous_list_sha256 === undefined || m.previous_list_sha256 === null || typeof m.previous_list_sha256 === "string") &&
      (m.outgoing_list_sha256 === undefined || typeof m.outgoing_list_sha256 === "string");
    if (!ok) return { state: "unreadable", error: "it is not an active-run marker of version 1" };
    // Every reader, the hook's and the CLI's alike, takes a marker only where
    // its bytes are the program's copy in the state folder (`markerCopyProblem`); any other reads as unreadable, so it
    // launches nothing, names no session and lists nothing, and `legal-scan run-abort` ends it.
    const copied = markerCopyProblem(launchDir, got.sha256);
    if (copied !== null) return { state: "unreadable", error: copied, notCopied: true, markerSha256: got.sha256 };
    return { state: "active", marker: m as ActiveRunMarker, sha256: got.sha256 };
  } catch (e) {
    return { state: "unreadable", error: messageOf(e) };
  }
}

/**
 * THE PROGRAM'S COPY OF THE MARKER. Each write of the marker writes the same
 * bytes, first, into the person's state folder (state-record.ts `active-run.json`), which no tool call may write in
 * any session; the run's end removes it. The hook takes a marker as the run's only where its bytes are that copy's
 * (`markerCopyProblem`): a marker a commit, a clone or a file tool wrote, or one changed since, names no session's
 * window and launches nothing. Null where they agree; otherwise why not.
 */
/** Beside the copy while a write is under way: the sha256 of the marker it replaces. */
const MARKER_OUTGOING_SUFFIX = ".outgoing";
/**
 * Every program write of the marker, in order: the standing marker's sha256 as
 * the outgoing one, where it is the program's (its copy's bytes); the copy; the marker; the outgoing name dropped. A
 * writer that stops between two steps leaves a pair a reader takes; one that crashes before the last leaves the outgoing
 * name until the next write.
 */
function writeMarkerInOrder(launchDir: string, text: string): void {
  const copyPath = launchRecordPath(launchDir, ACTIVE_RUN_FILE, true);
  const outgoing = `${copyPath}${MARKER_OUTGOING_SUFFIX}`;
  const standing = readProgramFile("the active-run marker", join(launchDir, ACTIVE_RUN_FILE));
  const copy = readProgramFile("the program's copy of the active-run marker", copyPath);
  const named = standing.ok && copy.ok && standing.sha256 === copy.sha256;
  if (named) replaceFile(outgoing, `${standing.sha256}\n`);
  else dropOutgoing(outgoing);
  replaceFile(copyPath, text);
  replaceFile(join(launchDir, ACTIVE_RUN_FILE), text);
  if (named) dropOutgoing(outgoing);
}

function dropOutgoing(outgoing: string): void {
  try {
    removeFile(outgoing);
  } catch (e) {
    if (codeOf(e) !== "ENOENT") throw e;
  }
}

/** The outgoing marker's sha256 a write under way names beside the copy, or null. */
function outgoingMarker(launchDir: string): string | null {
  try {
    const got = readProgramFile("the outgoing active-run marker's digest", `${launchRecordPath(launchDir, ACTIVE_RUN_FILE)}${MARKER_OUTGOING_SUFFIX}`);
    return got.ok ? got.value.toString("utf8").trim() : null;
  } catch {
    return null;
  }
}

export function markerCopyProblem(launchDir: string, markerSha256: string | undefined): string | null {
  let copy: ReturnType<typeof readProgramFile>;
  try {
    copy = readProgramFile("the program's copy of the active-run marker", launchRecordPath(launchDir, ACTIVE_RUN_FILE));
  } catch (e) {
    return `the program's copy of it in the state folder cannot be read (${valueText(messageOf(e))})`;
  }
  if (!copy.ok) return copy.code === "ENOENT" || copy.code === "ENOTDIR" ? "the program keeps no copy of it in the state folder, so the program did not write it on this computer" : `the program's copy of it in the state folder cannot be read (${copy.problem})`;
  if (copy.sha256 === markerSha256) return null;
  // The marker a program write under way is replacing.
  if (markerSha256 !== undefined && outgoingMarker(launchDir) === markerSha256) return null;
  return "it differs from the copy the program keeps in the state folder, so it was changed outside the program";
}

interface GatePaths {
  runDir: string;
  reserved: string;
  calls: string;
  refusals: string;
  releases: string;
  attemptsDir: string;
  seats: string;
  stopped: string;
  claim: string;
  /** The entries launched again after their seat returned with its answer lost. */
  relaunches: string;
  /** This attempt's first launch result that says its seat ran in the foreground (`HOST_FOREGROUND_FILE`). */
  hostForeground: string;
  /** This attempt's relay launches: one file per relay entry the gate let through (`RelayRecord`). */
  relays: string;
  /** U2 item 2: every launch of the run Claude Code's auto mode did not allow (PermissionDenied), one line each. */
  autoModeDenied: string;
  /** U2 item 2: each skill command the person typed in the run's main conversation after such a denial (`expansionLiftsTheStop`). */
  personWrote: string;
  /** W1: one file per launch a receipt of this attempt has named (`receiptNextLines`). */
  offered: string;
  /** One line per time the run's own conversation was resumed after its Claude Code process ended (`onSessionStart`). */
  resumes: string;
  /** One line per message at a tenth of the review the program sent (`withTenthMessage`), and one claim file per tenth. */
  tenthMessages: string;
  tenthClaims: string;
  /**
   * One line per stop of the main conversation the Stop hook blocked (`mainStopped`), with
   * what was due then (`dueState`): a later stop that finds the same passes.
   */
  stopBlocks: string;
}

function gatePaths(launchDir: string, runId: string, attempt: string): GatePaths {
  const runDir = join(launchDir, GATE_DIR, safe(runId));
  const attemptsDir = join(runDir, "attempts");
  const attemptDir = join(attemptsDir, safe(attempt));
  return {
    runDir,
    reserved: join(runDir, "reserved"),
    calls: join(runDir, "calls"),
    refusals: join(runDir, "refusals.jsonl"),
    releases: join(runDir, "releases.jsonl"),
    attemptsDir,
    seats: join(attemptDir, "seats"),
    stopped: join(attemptDir, "stopped"),
    claim: join(attemptDir, "session.json"),
    relaunches: join(runDir, RELAUNCHES_FILE),
    hostForeground: join(attemptDir, HOST_FOREGROUND_FILE),
    relays: join(attemptDir, "relays"),
    offered: join(attemptDir, "offered"),
    autoModeDenied: join(runDir, AUTO_MODE_DENIED_FILE),
    personWrote: join(runDir, PERSON_WROTE_FILE),
    resumes: join(runDir, RESUMES_FILE),
    tenthMessages: join(runDir, TENTH_MESSAGES_FILE),
    tenthClaims: join(runDir, "tenths"),
    stopBlocks: join(runDir, "stop-blocks.jsonl"),
  };
}

/**
 * Every seat a `launched` record names, whatever became of its reservation since: the gate's COUNT of seats that hold
 * a listed place (runState, releaseStaleReservations, launchGateSummary, agentsRecorded), never a binding. A new attempt
 * releases the reservations of entries that had not returned, and their seats stay counted. The one binding rule
 * is `seatBinding` below: a `launched` record the gate's own reservation or
 * release line confirms. The count keeps this unconfirmed form, with the seats reservations carry added by each caller,
 * because it must count a seat from the moment its reservation carries it (bindLaunch writes the reservation's seat
 * before the `launched` line, and seatBinding needs that line) and because a count grants the seat nothing: the
 * capture, which records a seat's answer as its entry's, binds through seatBinding alone.
 */
function launchedSeats(events: LaunchEvent[]): Set<string> {
  return new Set(events.flatMap((e) => (e.event === "launched" && typeof e.seat === "string" ? [e.seat] : [])));
}

/** What confirms a `launched` record: the gate's reservation of the entry with this seat, or its release line (seatBinding). */
export interface LaunchConfirmation {
  kind: "reservation" | "release";
  path: string;
  /** The launching Agent call's tool_use_id, as the reservation or the release line records it. */
  tool_use_id: string | null;
}

/**
 * THE BINDING RULE, owned here with the gate's layout (part A's list item 33):
 * the seat `agentId` is bound to the entry of the latest `launched` record that names it and that the
 * gate's own files confirm - that entry's reservation, in any run folder, whose `seat` is the agent id, or, where a
 * new attempt of the run released that reservation, a line of that run folder's releases.jsonl with the entry and the
 * seat (a released seat stays bound). A `launched` record nothing confirms binds nothing (a
 * line appended by a script is not a binding). `naming` counts the records that name the agent id. The capture
 * (hook-capture.ts) imports this and keeps no copy of the layout.
 */
export function seatBinding(launchDir: string, events: LaunchEvent[], agentId: string): { launched: LaunchEvent | null; confirmedBy: LaunchConfirmation | null; naming: number } {
  const naming = events.filter((e) => e.event === "launched" && e.seat === agentId).length;
  const gateDir = join(launchDir, GATE_DIR);
  const runs = subdirs(gateDir);
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.event !== "launched" || e.seat !== agentId) continue;
    for (const r of runs) {
      const path = join(gateDir, r, "reserved", `${safe(e.entry)}.json`);
      const v = readJson<Reservation>(path);
      if (v && v.entry === e.entry && v.seat === agentId) return { launched: e, confirmedBy: { kind: "reservation", path, tool_use_id: typeof v.tool_use_id === "string" ? v.tool_use_id : null }, naming };
    }
    for (const r of runs) {
      const path = join(gateDir, r, "releases.jsonl");
      const hit = readJsonLines<{ entry?: unknown; seat?: unknown; tool_use_id?: unknown }>(path).filter((l) => l.entry === e.entry && l.seat === agentId).at(-1);
      if (hit) return { launched: e, confirmedBy: { kind: "release", path, tool_use_id: typeof hit.tool_use_id === "string" ? hit.tool_use_id : null }, naming };
    }
  }
  return { launched: null, confirmedBy: null, naming };
}

/** A run folder's record of the entries launched again (one line per relaunch); it confirms no binding. */
export const RELAUNCHES_FILE = "relaunches.jsonl";

/**
 * The latest relaunch line, in any run folder, that names seat `agentId` as the seat it replaced: why a late answer of
 * that seat binds nothing (the capture names it in the hook ledger's `unbound` line). Never a binding; null where none.
 */
export function relaunchOfSeat(launchDir: string, agentId: string): { entry: string; at: string; answer_lost: string } | null {
  const gateDir = join(launchDir, GATE_DIR);
  let hit: { entry: string; at: string; answer_lost: string } | null = null;
  for (const r of subdirs(gateDir)) {
    for (const l of readJsonLines<{ entry?: unknown; seat?: unknown; at?: unknown; answer_lost?: unknown }>(join(gateDir, r, RELAUNCHES_FILE))) {
      if (l.seat === agentId && typeof l.entry === "string") hit = { entry: l.entry, at: String(l.at ?? ""), answer_lost: String(l.answer_lost ?? "") };
    }
  }
  return hit;
}

/**
 * A RECORD SET ASIDE. A record the capture wrote and that was then removed or changed
 * outside the program is no answer, and while the run can still launch its entry is launched again rather than its
 * candidates listed as not checked: the assembly writes one line here (the run folder's set-aside ledger) naming the
 * record's file, the seat that wrote it and the sha256 the capture ledger holds for it. The relaunch rule then reads
 * that record and its seat's accepted line as no answer (entry-answer.ts readAnswerLedgers), and the capture may replace
 * a file left at that path (hook-capture.ts `setAsideReplacement`) - never a record a later capture holds, because a line
 * names one capture (file, seat, sha256), and never a record whose bytes are still the ones the program received.
 * Each such relaunch is a relaunch line, so the relaunch cap (entry-answer.ts RELAUNCHES_MAX) bounds a record set aside
 * again and again; past it the entry's candidates are listed as not checked.
 */
export const SET_ASIDE_FILE = "set-aside.jsonl";

/** One line of the set-aside ledger: the capture it sets aside (file, seat, sha256), its entry, when and why. */
export interface SetAsideLine {
  at: string;
  entry: string;
  file: string;
  seat: string;
  sha256: string;
  why: string;
}

/** The set-aside ledger of run `runId` (the run folder's), where the assembly writes and the relaunch rule reads. */
export function setAsidePathOf(launchDir: string, runId: string): string {
  return join(launchDir, GATE_DIR, safe(runId), SET_ASIDE_FILE);
}

const setAsideLines = (path: string): SetAsideLine[] =>
  readJsonLines<Partial<SetAsideLine>>(path).filter((l): l is SetAsideLine => ["at", "entry", "file", "seat", "sha256", "why"].every((k) => typeof (l as Record<string, unknown>)[k] === "string"));

/** The set-aside lines of run `runId`, in file order. */
export function readSetAside(launchDir: string, runId: string): SetAsideLine[] {
  return setAsideLines(setAsidePathOf(launchDir, runId));
}

/** The set-aside lines of every run folder, for the capture (which knows the seat's entry, not the run's folder by name). */
export function setAsideInAnyRun(launchDir: string): SetAsideLine[] {
  const gateDir = join(launchDir, GATE_DIR);
  return subdirs(gateDir).flatMap((r) => setAsideLines(join(gateDir, r, SET_ASIDE_FILE)));
}

/** Append a line to run `runId`'s set-aside ledger, unless a line already names the same capture (file, seat, sha256). */
export function recordSetAside(launchDir: string, runId: string, line: SetAsideLine): boolean {
  const path = setAsidePathOf(launchDir, runId);
  if (readSetAside(launchDir, runId).some((l) => l.file === line.file && l.seat === line.seat && l.sha256 === line.sha256)) return false;
  makeFolder(dirname(path), { recursive: true });
  appendFileAt(path, `${JSON.stringify(line)}\n`);
  return true;
}

/**
 * LOST AT THE RESUME. The seats and
 * the relay of a run run inside the Claude Code process of the run's conversation, and end with it: a closed terminal,
 * a crash or a killed process leaves them with no hook ever reaching the program, so before this unit each held its
 * place and its entry until PRESUMED LOST (an hour at least), and a person who resumed the conversation waited that
 * long with nothing happening. What tells the program that the earlier process has ended is the SessionStart hook
 * input of the run's own conversation with `source: "resume"` (Claude Code sets it for `--resume`, `--continue` and
 * `/resume`; `startup`, `clear`, `compact` and `fork` are the other values, and a `fork` has a session id of its own):
 * the conversation is being started again in a new process, and Claude Code itself reports the earlier process's
 * background agents as not finished ("N background agents didn't finish before the previous session ended").
 * `onSessionStart` appends one line here per such start, and from that moment every seat launched before it with no
 * sign of its end is lost (`presumedLost`), every launch still awaiting its result is released (`staleReservations`),
 * every seat with no listed launch seen before it holds no place (`runState`), and the relay let through before it is
 * not live (`liveRelayIn`, read by every place that asks which relay is live): `launch-next` lists their entries again at
 * once and `relay-entry` offers a new relay, whose receipts and hand-back then use its own room.
 * Where the earlier process is in fact still alive (a second terminal resuming the same conversation), nothing tells
 * the program so, and it acts the same way; no place is answered twice, because the relaunch replaces the entry's
 * reservation and the binding rule (`seatBinding`) then binds only the new seat: an answer the earlier seat sends after
 * that is kept and recorded in the hook ledger as unbound, for no entry, while an answer it sends before the relaunch
 * is taken as the entry's answer and the entry is not launched again (entry-answer.ts `relaunchable`). The cost of that
 * case is the earlier seat's reading, done twice; never two answers.
 */
export const RESUMES_FILE = "resumes.jsonl";

/** The moments, in milliseconds and in order, at which the run's own conversation was resumed (RESUMES_FILE). */
function resumeTimes(path: string): number[] {
  return readJsonLines<{ at?: unknown }>(path)
    .map((l) => (typeof l.at === "string" ? Date.parse(l.at) : Number.NaN))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
}

/** The first resume after `t` and at or before `now` (the moment the thing launched at `t` was lost with its process), or null. */
function resumedAfter(resumes: readonly number[], t: number, now: number): number | null {
  return resumes.find((r) => r > t && r <= now) ?? null;
}

/**
 * An attempt's record of the first launch result that says its seat ran in the foreground (`status` other than
 * `async_launched` with an agent id: probe run P3's `completed`, which came after the seat had stopped). The session
 * runs its agents in the foreground, so no later launch result could bind a seat before it answers: while this file
 * stands, the gate launches nothing more in the attempt (decideLaunch). A new attempt, in a session that runs agents in
 * the background, starts without it.
 */
export const HOST_FOREGROUND_FILE = "host-foreground.json";

/**
 * THE GATE'S RECORDS OF ONE RUN, for the relaunch rule (entry-answer.ts `relaunchable`),
 * so that the gate's layout stays owned here: the run folder's reservations by entry, and every agent whose stop the
 * gate recorded in any attempt of the run.
 */
export function runGateRecords(launchDir: string, runId: string): { reservations: Map<string, Reservation>; stopped: Set<string>; seats: Set<string>; resumes: number[]; relaunches: Map<string, number>; setAside: SetAsideLine[] } {
  const gp = gatePaths(launchDir, runId, "-");
  const reservations = new Map(readJsonDir<Reservation>(gp.reserved).map((r): [string, Reservation] => [r.entry, r]));
  const stopped = new Set<string>();
  for (const att of subdirs(gp.attemptsDir)) {
    for (const s of readJsonDir<{ agent_id?: unknown }>(join(gp.attemptsDir, att, "stopped"))) if (typeof s.agent_id === "string") stopped.add(s.agent_id);
  }
  // The run's seats, whose times set the presumed-lost bound (PRESUMED LOST), and its resumes (LOST AT THE RESUME).
  // How many times each entry was launched again in the run (the relaunch cap, entry-answer.ts RELAUNCHES_MAX).
  const relaunches = new Map<string, number>();
  for (const l of readJsonLines<{ entry?: unknown }>(gp.relaunches)) if (typeof l.entry === "string") relaunches.set(l.entry, (relaunches.get(l.entry) ?? 0) + 1);
  return { reservations, stopped, seats: runSeatsOf(gp, reservations.values()), resumes: resumeTimes(gp.resumes), relaunches, setAside: readSetAside(launchDir, runId) };
}

/**
 * Every entry run `runId` launched, in any attempt, as the gate's own files of the run record it: the run folder's
 * reservations (a launch standing or returned), its release lines (a launch a new attempt released) and its relaunch
 * lines. A new attempt's list keeps each of them (launch-list-file.ts `carryRunState`):
 * a seat of each may have answered, or may answer yet.
 */
export function entriesLaunchedInRun(launchDir: string, runId: string): Set<string> {
  const gp = gatePaths(launchDir, runId, "-");
  const out = new Set<string>(readJsonDir<Reservation>(gp.reserved).flatMap((r) => (typeof r.entry === "string" ? [r.entry] : [])));
  for (const path of [gp.releases, gp.relaunches]) for (const l of readJsonLines<{ entry?: unknown }>(path)) if (typeof l.entry === "string") out.add(l.entry);
  return out;
}

const subdirs = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
};

/**
 * Every seat and agent the hooks recorded in this launch directory, in any run and any attempt: bound by a
 * `launched` record or a reservation, seen starting or making a call, seen stopping, or a plugin seat that
 * started with no run active. The message gate refuses a message to any of them.
 */
function agentsRecorded(launchDir: string, eventsPath: string): Set<string> {
  const ids = launchedSeats(readLaunchEvents(eventsPath).events);
  const gateDir = join(launchDir, GATE_DIR);
  for (const runId of subdirs(gateDir)) {
    for (const r of readJsonDir<Reservation>(join(gateDir, runId, "reserved"))) if (typeof r.seat === "string") ids.add(r.seat);
    const attempts = join(gateDir, runId, "attempts");
    for (const att of subdirs(attempts)) {
      for (const sub of ["seats", "stopped"]) {
        for (const s of readJsonDir<{ agent_id?: unknown }>(join(attempts, att, sub))) if (typeof s.agent_id === "string") ids.add(s.agent_id);
      }
    }
  }
  for (const s of readJsonLines<{ agent_id?: unknown }>(join(launchDir, OUTSIDE_RUN_SEATS_FILE))) if (typeof s.agent_id === "string") ids.add(s.agent_id);
  return ids;
}

/** The latest record of each entry, by its time and, for equal times, by its place in the file. */
function latestByEntry(events: LaunchEvent[]): Map<string, LaunchEvent> {
  const latest = new Map<string, { e: LaunchEvent; t: number }>();
  for (const e of events) {
    const t = Date.parse(e.at);
    const prev = latest.get(e.entry);
    if (!prev || t >= prev.t) latest.set(e.entry, { e, t });
  }
  return new Map([...latest].map(([k, v]) => [k, v.e]));
}

/**
 * The sha256 of the list run `runId` last wrote, for a marker of the run that records no list of its own: the
 * standing marker's where it is the run's (the same session's between its two pre-launch calls, or a crashed
 * session's), else the run's last history line's (after `run-abort` or the assembly); null where the run wrote none.
 */
function runListShaBefore(launchDir: string, runId: string, prev: MarkerRead): string | null {
  if (prev.state === "active" && prev.marker.run_id === runId) return prev.marker.list_sha256 ?? prev.marker.previous_list_sha256 ?? null;
  const end = lastRunEnd(launchDir, runId);
  return end === null ? null : (end.list_sha256 ?? end.previous_list_sha256);
}

export interface WriteActiveRunArgs {
  launchDir: string;
  runId: string;
  scanId: string;
  /** From `SESSION_ENV`; null or empty where the shell did not carry it. */
  sessionId: string | null | undefined;
  /** The launch list this call wrote, when it wrote one. */
  listPath?: string | null;
  /** The scan launch profile as the SessionStart hook found it (scan-profile.ts `profileRecord`); null where it exported none. */
  scanProfile?: { state: "on" | "off" | "waived"; missing: string[] } | null;
  /** The effort level the session started with, as `legal-scan session` named it (scan-profile.ts `startEffort`); recorded where given. */
  startEffort?: string | null;
  now: Date;
}

/**
 * WRITTEN BY THE PRE-LAUNCH STEP whenever it writes the run-shape question: the first call starts the
 * run, the call that writes the list records the list's sha256. A marker of the same run and session
 * standing is kept and refreshed (same attempt, every reservation kept: its seats may be running).
 * Otherwise a new attempt starts: no marker (a first start, or a start after `run-abort`), another run,
 * or another session (a crashed session's marker). Starting an attempt releases the reservation of every
 * entry whose latest record is not `returned`, so that a seat that never answered can be launched again;
 * an entry that returned stays used and is not launched twice. A new attempt releases, it does not forget:
 * where the run already wrote a list, that list's sha256 - its standing marker's,
 * a crashed session's, or the run's last history line's, after `run-abort` - is kept on the new marker as
 * `previous_list_sha256` until the attempt writes a list of its own, which carries what the run appended to it.
 */
export function writeActiveRun(args: WriteActiveRunArgs): { marker: ActiveRunMarker; path: string; newAttempt: boolean; released: string[] } {
  // A run starts: `.legal/.ignore` before any seat can search.
  if (basename(dirname(resolve(args.launchDir))) === LEGAL_DIR_NAME) writeLegalIgnore(dirname(resolve(args.launchDir)));
  const now = args.now.toISOString();
  const sessionId = typeof args.sessionId === "string" && args.sessionId !== "" ? args.sessionId : null;
  const prev = readActiveRun(args.launchDir);
  const continuing = prev.state === "active" && prev.marker.run_id === args.runId && prev.marker.session_id === sessionId;
  const listRead = typeof args.listPath === "string" && args.listPath !== "" ? readProgramFile("the launch list", args.listPath) : null;
  if (listRead && !listRead.ok) throw new Error(listRead.problem);
  const listSha =
    listRead && listRead.ok
      ? listRead.sha256
      : continuing && prev.state === "active"
        ? prev.marker.list_sha256
        : null;
  // A marker of this attempt that still keeps the previous list's digest beside
  // its own (its list writer's replacement failed) keeps it, unless this call read the attempt's list.
  const kept = continuing && prev.state === "active" && !listRead && typeof prev.marker.previous_list_sha256 === "string" ? prev.marker.previous_list_sha256 : null;
  const previousListSha = kept ?? (listSha !== null ? null : runListShaBefore(args.launchDir, args.runId, prev));
  const marker: ActiveRunMarker = {
    kind: "active-run",
    version: 1,
    run_id: args.runId,
    scan_id: args.scanId,
    session_id: sessionId,
    attempt: continuing && prev.state === "active" ? prev.marker.attempt : `${now.replace(/[^0-9]/g, "").slice(0, 17)}-${randomBytes(3).toString("hex")}`,
    started_at: continuing && prev.state === "active" ? prev.marker.started_at : now,
    written_at: now,
    launch_dir: resolve(args.launchDir),
    list_sha256: listSha,
    ...(previousListSha !== null ? { previous_list_sha256: previousListSha } : {}),
    ...(args.scanProfile ? { scan_profile: args.scanProfile } : {}),
    ...(args.startEffort !== undefined ? { start_effort: args.startEffort } : {}),
    // The version that started the run stays on every attempt of the same run.
    ...(() => {
      const v = prev.state === "active" && prev.marker.run_id === args.runId ? prev.marker.program_version : (programVersion() ?? undefined);
      return typeof v === "string" ? { program_version: v } : {};
    })(),
  };
  const released: string[] = [];
  if (!continuing) {
    const gp = gatePaths(args.launchDir, args.runId, marker.attempt);
    const latest = latestByEntry(readLaunchEvents(join(args.launchDir, "launch-events.jsonl")).events);
    for (const r of readJsonDir<Reservation>(gp.reserved)) {
      if (latest.get(r.entry)?.event === "returned") continue;
      try {
        removeFile(join(gp.reserved, `${safe(r.entry)}.json`));
      } catch (e) {
        if (codeOf(e) !== "ENOENT") throw e;
        continue;
      }
      released.push(r.entry);
      appendFileAt(gp.releases, line({ at: now, entry: r.entry, tool_use_id: r.tool_use_id, seat: r.seat ?? null, why: "a new attempt of the run started with no answer from this entry" }));
    }
  }
  const path = join(args.launchDir, ACTIVE_RUN_FILE);
  // The plugin's shim reads this marker as "a scan is under way here"; written before the run's (hook.ts).
  markScanUnderWay(args.launchDir, ACTIVE_RUN_FILE, args.now);
  writeMarkerInOrder(args.launchDir, `${JSON.stringify(marker, null, 2)}\n`);
  return { marker, path, newAttempt: !continuing, released };
}

/**
 * THE MARKER FOLLOWS EVERY WRITE OF THE LIST. Called
 * by the one list writer (`replaceLaunchList`, launch-list-file.ts) under the list's lock, right after the list is
 * replaced: where a marker of the list's run stands, its `list_sha256` becomes `listSha256` and nothing else of it
 * changes (the session, the attempt and `started_at` stay: an append is not a new attempt, and no reservation is
 * released). Where no marker stands, or one of another run, nothing is written. Returns whether the marker was written.
 */
export function refreshActiveRunList(launchDir: string, runId: string, listSha256: string, now: Date, outgoing: string | null = null, keepPrevious = false): boolean {
  const read = readActiveRun(launchDir);
  if (read.state !== "active" || read.marker.run_id !== runId) return false;
  // The attempt's own list is written: the previous list's digest has served (writeActiveRun) and is dropped. `outgoing`: the list this write replaces, kept while the list is replaced. `keepPrevious`: the list writer's first step keeps the previous list's
  // digest, which names the list still on disk until the writer's second step replaces it.
  const { previous_list_sha256: served, outgoing_list_sha256: _replaced, ...kept } = read.marker;
  const previous = keepPrevious && typeof served === "string" ? { previous_list_sha256: served } : {};
  const marker: ActiveRunMarker = { ...kept, list_sha256: listSha256, ...previous, ...(outgoing !== null ? { outgoing_list_sha256: outgoing } : {}), written_at: now.toISOString() };
  writeMarkerInOrder(launchDir, `${JSON.stringify(marker, null, 2)}\n`);
  return true;
}

/**
 * REMOVED BY `run-abort` (how "aborted") and by the assembly (how "assembled"). The run's files all stay. The history
 * line keeps the marker's `list_sha256`, so that the list of an ended run stays checkable - a later `assemble-report`,
 * or an audit, reads it back against this line (`readLaunchList`; relay integration part B, item 2, the parent's ruling).
 */
export function endActiveRun(launchDir: string, how: string, now: Date): { ended: boolean; marker: ActiveRunMarker | null; note: string } {
  const read = readActiveRun(launchDir);
  const path = join(launchDir, ACTIVE_RUN_FILE);
  if (read.state === "none") return { ended: false, marker: null, note: `no scan run is active in ${launchDir}` };
  removeFile(path);
  try {
    removeFile(launchRecordPath(launchDir, ACTIVE_RUN_FILE));
    dropOutgoing(`${launchRecordPath(launchDir, ACTIVE_RUN_FILE)}${MARKER_OUTGOING_SUFFIX}`);
  } catch (e) {
    if (codeOf(e) !== "ENOENT" && !isLaunchRecordRefusal(e)) throw e;
  }
  const marker = read.state === "active" ? read.marker : null;
  appendFileAt(
    launchRecordPath(launchDir, ACTIVE_RUN_HISTORY_FILE, true),
    line({
      run_id: marker?.run_id ?? null,
      session_id: marker?.session_id ?? null,
      attempt: marker?.attempt ?? null,
      started_at: marker?.started_at ?? null,
      ended_at: now.toISOString(),
      how,
      list_sha256: marker?.list_sha256 ?? null,
      previous_list_sha256: marker?.previous_list_sha256 ?? undefined,
      marker_unreadable: read.state === "unreadable" ? read.error : undefined,
    }),
  );
  // The run has ended and its history line is written, so the shim's marker goes (hook.ts).
  clearScanUnderWay(launchDir);
  return { ended: true, marker, note: read.state === "active" ? `run ${read.marker.run_id} ended (${how})` : `an unreadable marker was removed (${how})` };
}

/** One ended run, as `endActiveRun` recorded it. */
export interface RunEnd {
  run_id: string;
  ended_at: string;
  how: string;
  list_sha256: string | null;
  /** The marker's `previous_list_sha256` when the run ended in a new attempt that had written no list. */
  previous_list_sha256: string | null;
}

/**
 * The last line `endActiveRun` wrote for run `runId` in `launchDir`'s history, or null where the run never ended there
 * (or the history cannot be read). Read through the one reader (program-file.ts).
 */
/**
 * The latest `ended_at` of any run the active-run history records (the write guard's window, relay item 7 hardening 2), or null.
 * Only a line this computer's runs could have written counts, since one later than every
 * opening line shuts every window it closes for good: a line is ignored where its `ended_at` is not a time, is later than
 * `now` (a run cannot have ended in the future: a committed `9999-12-31` line kept the declaration window shut in every
 * clone, and so does a clock set ahead and corrected), or is earlier than its own `started_at`.
 * The history is kept in the person's state folder (state-record.ts `launchRecordPath`), so no commit or
 * clone carries a line into it, and git's index is no longer asked.
 */
export function latestRunEndAt(launchDir: string, now: Date = new Date()): string | null {
  const nowMs = now.getTime();
  const rows: { ended_at: string; ms: number }[] = [];
  try {
    const got = readProgramFile("the active-run history", launchRecordPath(launchDir, ACTIVE_RUN_HISTORY_FILE));
    if (!got.ok) return null;
    for (const text of got.value.toString("utf8").split("\n")) {
      if (text.trim() === "") continue;
      let l: { ended_at?: unknown; started_at?: unknown } | null = null;
      try {
        l = JSON.parse(text) as { ended_at?: unknown; started_at?: unknown };
      } catch {
        continue;
      }
      if (!l || typeof l.ended_at !== "string") continue;
      // Only a time in the program's own form, compared as an instant.
      const end = programInstant(l.ended_at);
      if (end === null || end > nowMs) continue;
      if (typeof l.started_at === "string" && Date.parse(l.started_at) > end) continue;
      rows.push({ ended_at: l.ended_at, ms: end });
    }
  } catch {
    return null;
  }
  let latest: { ended_at: string; ms: number } | null = null;
  for (const r of rows) if (latest === null || r.ms > latest.ms) latest = r;
  return latest?.ended_at ?? null;
}

export function lastRunEnd(launchDir: string, runId: string): RunEnd | null {
  let found: RunEnd | null = null;
  let lines: Partial<RunEnd>[];
  try {
    lines = readJsonLines<Partial<RunEnd>>(launchRecordPath(launchDir, ACTIVE_RUN_HISTORY_FILE));
  } catch {
    return null;
  }
  for (const l of lines) {
    if (l && l.run_id === runId && typeof l.ended_at === "string") {
      found = {
        run_id: runId,
        ended_at: l.ended_at,
        how: typeof l.how === "string" ? l.how : "(not recorded)",
        list_sha256: typeof l.list_sha256 === "string" ? l.list_sha256 : null,
        previous_list_sha256: typeof l.previous_list_sha256 === "string" ? l.previous_list_sha256 : null,
      };
    }
  }
  return found;
}

/**
 * The hooks find a run only at `$CLAUDE_PROJECT_DIR/.legal/launch` (hook.ts `runPaths`). A pre-launch
 * step over findings inside the session's project folder (exported by the SessionStart route) refuses
 * any other launch directory: a list written elsewhere would run with the gate off. Null where the
 * directory is the one the hooks read, where the shell carries no project folder (outside Claude Code),
 * or where the findings are not in that folder (a run over another tree, such as a gate's scratch one).
 */
export function launchDirRefusal(launchDir: string, findingsPath: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string | null {
  const project = env[PROJECT_ENV];
  if (typeof project !== "string" || project === "") return null;
  const root = resolve(project);
  const findings = resolve(findingsPath);
  // Compared as the file system compares names: on
  // macOS and Windows, whose volumes ignore case by default, `/Users/Me/proj` is `/Users/me/proj`. And Unicode NFC on macOS, and the operating system's own real path
  // (an 8.3 short name on Windows is the long name): start-record.ts `foldName`, `canonicalPath`.
  const fold = (p: string): string => foldName(p, platform);
  // Inside the project and the same folder, as written or by real path: a
  // project named through a link (macOS's `/var` for `/private/var`) holds the findings its real path holds.
  const under = (f: string, r: string): boolean => fold(f).startsWith(`${fold(r)}/`) || fold(f).startsWith(`${fold(r)}\\`);
  if (!under(findings, root) && !under(realOfNearest(findings), realOfNearest(root)) && !under(canonicalPath(findings, platform), canonicalPath(root, platform))) return null;
  const expected = resolve(project, ".legal", "launch");
  if (sameLaunchDir(launchDir, expected, platform)) return null;
  return (
    `${toldArgs(["--launch-dir", resolve(launchDir)])}: refused - this session's hooks read the scan run at ${expected} (${PROJECT_ENV}), so a launch list written anywhere else ` +
    "would be launched with the launch gate off. Run the pre-launch step from the project folder with the default --out .legal/findings.json, or pass " +
    `${toldArgs(["--launch-dir", expected])}. No run-shape question and no launch list were written.`
  );
}

/** Whether two launch folders are one: as written, by real path, or as the file system names them (case, NFC, 8.3). */
function sameLaunchDir(a: string, b: string, platform: NodeJS.Platform): boolean {
  const fold = (p: string): string => foldName(p, platform);
  return fold(resolve(a)) === fold(resolve(b)) || fold(realOfNearest(a)) === fold(realOfNearest(b)) || canonicalPath(a, platform) === canonicalPath(b, platform);
}

/**
 * In a project where the plugin's hooks
 * ran for this account (plugin-sessions.ts), the launch list goes only to that project's `.legal/launch`, wherever the
 * findings lie: `launchDirRefusal` lets a run over findings outside the project write its list anywhere (a gate's
 * scratch tree), and findings copied outside a recorded project put the run's marker where the hooks never look, with
 * the launch gate and the run window's guards off. Null where `launchDir` is that folder.
 */
export function recordedLaunchDirRefusal(launchDir: string, project: string, platform: NodeJS.Platform = process.platform): string | null {
  const expected = resolve(project, ".legal", "launch");
  if (sameLaunchDir(launchDir, expected, platform)) return null;
  return (
    `${toldArgs(["--launch-dir", resolve(launchDir)])}: refused - this step names a folder in ${project}, where Claude Code with the wolfboy plugin has run, and the plugin's hooks read a scan run there only at ${expected}, ` +
    "so a launch list written anywhere else would be launched with the launch gate off. Run the pre-launch step from the project folder over its own .legal/findings.json, or pass " +
    `${toldArgs(["--launch-dir", expected])}. No run-shape question and no launch list were written.`
  );
}

/**
 * Set in the environment of every process Claude Code starts, its Bash tool's included: `CLAUDECODE=1` in a
 * 2.1.281 session launched from a shell that carried no `CLAUDE*` variable,
 * and in every hook process the relay probe recorded.
 */
export const CLAUDE_CODE_ENV = "CLAUDECODE";

/**
 * Set by Claude Code 2.1.281 in its Bash tool's environment to the session's own id, the `session_id` its hooks
 * receive and the SessionStart route exports as `SESSION_ENV` (hooks-launch T4: "the init event's session_id").
 */
export const CLAUDE_CODE_SESSION_ENV = "CLAUDE_CODE_SESSION_ID";


/** Set by Claude Code for a SessionStart hook: the file whose `export` lines the session's shells source (onSessionStart). */
export const ENV_FILE_ENV = "CLAUDE_ENV_FILE";

/**
 * Claude Code's own switch that turns background tasks off (read in its environment, which every hook process
 * inherits; probe run P3 saw it there): with it on, 2.1.283 runs every `Agent` launch in the foreground, a call without
 * `run_in_background` included, and returns the launch result only after the seat has stopped (P3: `status:
 * "completed"`, 0.09 s after SubagentStop). The gate then launches no listed seat (decideLaunch).
 */
export const BACKGROUND_OFF_ENV = "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS";

/**
 * Claude Code's own switch that forces every sub-agent's model: with it on, 2.1.283's `Agent` tool has no `model`
 * field, drops the one a call names before a hook sees it, and runs the agent on the forced model (probe run P5: a call
 * naming sonnet reached the hook without `model` and ran on haiku). A listed launch then cannot arrive as the entry
 * writes it; the gate refuses it with this reason instead of the generic one (decideLaunch).
 */
export const MODEL_FORCE_ENV = "CLAUDE_CODE_SUBAGENT_MODEL_FORCE";

/** Whether one of Claude Code's boolean switches is on, by its own rule: "1", "true", "yes" or "on", in any case, around spaces. */
export function hostSwitchOn(value: unknown): boolean {
  return typeof value === "string" && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

const isSet = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * The variables of `env`, in this order, that say the shell runs inside a Claude Code session: `SESSION_ENV`, the
 * session marker the plugin's SessionStart hook writes through `CLAUDE_ENV_FILE`,
 * and `CLAUDE_CODE_ENV` and `CLAUDE_CODE_SESSION_ENV`, which Claude Code sets itself. Any one of them
 * is enough. The marker is missing where the hook did not run (a hook that failed or timed out, or a plugin enabled
 * after the session started: the option's stated risk), and Claude Code's own variables are missing where a command
 * removed them; a command that removes all three is not seen (stated in the record, with the forgery the proposal
 * leaves open under section 3.5, part 2). A value that is empty or only spaces is not set.
 */
export function claudeCodeSigns(env: NodeJS.ProcessEnv): string[] {
  return [SESSION_ENV, CLAUDE_CODE_ENV, CLAUDE_CODE_SESSION_ENV].filter((k) => isSet(env[k]));
}

/**
 * INSIDE A CLAUDE CODE SESSION
 * THE PROGRAM REFUSES THE CI BEHAVIOUR. Inside a session (`claudeCodeSigns`) the run shape is the person's answer to
 * the run-shape question, which the plugin's hook records, and nothing else: `--shape-from-answer` takes it
 * (`takeRunShape`: the hook's ledger and the session's transcript), and a shape named on the command line
 * (`--shape`, in whatever form the command line accepts it) is refused before the pre-launch step writes anything.
 * The plugin's Bash hook (`shapeFlagPre`, hook-question.ts) stays the first stop; this refusal is the consumer's, so
 * a command line the hook cannot read (a variable, a script, `xargs` fed by an earlier stage, brace expansion)
 * is refused here. Null where `shape` was not given, and
 * outside Claude Code, where `--shape` is how a run (CI) chooses its shape.
 */
export function shapeFlagRefusal(shape: unknown, env: NodeJS.ProcessEnv): string | null {
  if (shape === undefined) return null;
  const signs = claudeCodeSigns(env);
  if (signs.length === 0) return null;
  return (
    `--shape ${String(shape)}: refused - this shell runs inside a Claude Code session (${signs.join(", ")} ${signs.length === 1 ? "is" : "are"} set). ` +
    "Inside a session the run shape is the person's answer to the run-shape question, which the wolfboy plugin's hook records, and " +
    "nothing else: a shape named on the command line is how a run outside Claude Code (CI) chooses it, and the program does not take it inside " +
    "a session. Run this command without --shape: it writes the run-shape question and prints the input to ask the person with; once the " +
    "person has answered, run it again with --shape-from-answer. A run outside Claude Code is started from a shell outside Claude Code. " +
    "Nothing was written: no plan, no carried verdict, no run-shape question, no launch list and no active-run marker."
  );
}

/** What each refusal of `markerSessionRefusal` tells the person to do. */
const MARKER_SESSION_ADVICE =
  "Start a new Claude Code session in this project with the plugin enabled, so that its SessionStart hook runs, and run the pre-launch step " +
  `there, or run it from a shell outside Claude Code. ${HOOKS_POLICY_WORDS} No run-shape question, no launch list and no active-run marker were written.`;

/**
 * A MARKER IS NEVER WITHOUT A SESSION INSIDE CLAUDE CODE. A marker that names no session
 * is claimed only by the main session's first `Agent` call; before that the delivery gate lets every call pass,
 * and a fork never claims. So where the pre-launch step runs inside Claude Code (`CLAUDE_CODE_ENV` or
 * `CLAUDE_CODE_SESSION_ENV` set) and the shell carries no session id (the plugin's SessionStart hook did not run in
 * this session, for example because the plugin was enabled after the session started), nothing is written and the
 * step says to start a new session.
 * THE ID MUST BE THIS SESSION'S. A blank id (one or more spaces) is refused inside and outside
 * Claude Code: it names no session, so the gate would act in none. Where Claude Code's own `CLAUDE_CODE_SESSION_ENV`
 * is set, the id must equal it: another session's id would make the gate act in that session and not in this one.
 * What stays open: a command that sets both variables to one value is not seen, and outside Claude Code (neither
 * of Claude Code's variables set) any id that is not blank is taken as given.
 * Null outside Claude Code with no id or an id, and inside it with this session's id.
 */
/**
 * NO SEAT IN A SESSION WHERE THE PLUGIN'S HOOKS ARE NOT RUNNING, ON EVERY
 * SYSTEM. Inside Claude Code (its own variables set in this shell) where the shell carries no `SESSION_ENV`, the plugin's
 * SessionStart hook did not run in this session: on Windows with no Git Bash none of its hooks start (they `continue`,
 * r10-hooks P2), and a plugin enabled after the session started has none running yet. No launch gate, guard row or
 * capture acts there, so the pre-launch step (`markerSessionRefusal`), `launch-next`, `wait-next` and `relay-entry` refuse
 * with this one sentence, and nothing of a run is launched from them. A blank id is `markerSessionRefusal`'s own case.
 * Outside Claude Code (none of its variables) nothing is refused here: no seat starts from a terminal. The scan's layer 1
 * pays for no seat and is not refused by this (its own round refuses a session with no project folder, `index.ts`
 * `sessionRoundRefusal`). It sends the person to a new session, so it also names the managed settings under which a new
 * session cannot help (`HOOKS_POLICY_WORDS`, RR1-07): without them a person under such settings is sent round the same
 * refusal again.
 */
export function hooksNotRunningRefusal(env: NodeJS.ProcessEnv, stateDir: string | null = processStateDir(), cwd: string = process.cwd()): string | null {
  // First, whatever the variables say:
  // in a project where the plugin's hooks ran for this account, a state folder or redaction key other than the recorded
  // ones, or a record that cannot be read, is refused (plugin-sessions.ts). A command that removes Claude Code's
  // variables reads as one typed at the person's terminal below; no program can tell the two apart.
  const recorded = pluginSessionsAround(stateDir, [env[PROJECT_ENV], cwd]);
  if (recorded.kind === "refused") return `refused - ${recorded.why}.`;
  const inside = [CLAUDE_CODE_ENV, CLAUDE_CODE_SESSION_ENV].filter((k) => isSet(env[k]));
  const session = env[SESSION_ENV];
  if (inside.length === 0) return null;
  if (typeof session === "string" && session !== "") {
    // The id must be one the plugin's SessionStart hook
    // recorded in this project, where it recorded any: `WOLFBOY_SESSION_ID=$CLAUDE_CODE_SESSION_ID`, typed in a session
    // whose hooks did not run, names no recorded session (plugin-sessions.ts). A project with no record at all (the hooks
    // never ran there) is read from the variables alone, as before.
    if (recorded.kind === "none" || recorded.ids.has(session)) return null;
  }
  return (
    "refused - the plugin's hooks are not running in this Claude Code session, so no review agent may start here: start the scan's " +
    `session from your own terminal, in this folder, with ${sessionCommand()}, and ask for the scan there. ${HOOKS_POLICY_WORDS}`
  );
}

export function markerSessionRefusal(env: NodeJS.ProcessEnv): string | null {
  const session = env[SESSION_ENV];
  const given = typeof session === "string" && session !== "";
  if (given && !isSet(session)) {
    return (
      `refused - ${SESSION_ENV} is set but blank (${JSON.stringify(session)}): it names no session, so a scan run's marker naming it would let the ` +
      `launch gate act in no session at all. The wolfboy plugin's SessionStart hook exports the session's own id. ${MARKER_SESSION_ADVICE}`
    );
  }
  const inside = [CLAUDE_CODE_ENV, CLAUDE_CODE_SESSION_ENV].filter((k) => isSet(env[k]));
  if (inside.length === 0) return null;
  // The one sentence every seat command says where the hooks are not running.
  if (!given) return hooksNotRunningRefusal(env);
  const own = env[CLAUDE_CODE_SESSION_ENV];
  if (isSet(own) && own !== session) {
    return (
      `refused - this shell runs inside Claude Code session ${own} (${CLAUDE_CODE_SESSION_ENV}), but ${SESSION_ENV} names another session ` +
      `(${JSON.stringify(session)}). The wolfboy plugin's SessionStart hook exports this session's own id, so the other one was set by ` +
      `something else (another session's shell, or a command), and a scan run's marker naming it would let the launch gate act in that session ` +
      `and not in this one. ${MARKER_SESSION_ADVICE}`
    );
  }
  // And an id the plugin's SessionStart hook recorded in this project, where it recorded any.
  return hooksNotRunningRefusal(env);
}

/** What the pre-launch step prints about the marker it wrote. */
export function activeRunLines(w: { marker: ActiveRunMarker; path: string; newAttempt: boolean; released: string[] }): string[] {
  const m = w.marker;
  return [
    `ACTIVE RUN: scan run ${m.run_id} is active (${w.path}; ${w.newAttempt ? "a new attempt started" : "the same attempt continues"}, attempt ${m.attempt}). ` +
      "While it is, every Agent launch in this session must be an entry of the launch list, passed unchanged, and each entry is launched once. " +
      `Launch what ${launchNextCommand(m.launch_dir)} prints, and run it again after every returned seat. Ending the run without assembling it is the person's decision, from their own terminal outside Claude Code, ${IN_BASH}: ${abortCommand(m.launch_dir)}`,
    ...(m.session_id === null
      ? [
          `  The session id was not in this shell (${SESSION_ENV} is unset; the shell is not inside Claude Code), so the run belongs to the first session whose main conversation makes an Agent call after this. ` +
            "Until then no call of any session is the run's: SendMessage, Skill and Workflow are not gated, and a fork's launch does not claim the run.",
        ]
      : []),
    ...(w.released.length > 0 ? [`  ${w.released.length} reservation(s) released: an earlier attempt launched these entries and got no answer from them, so they may be launched again (${w.released.join(", ")}).`] : []),
  ];
}

/** What the orchestrator runs to end the scan run, as the refusals name it. */
export function abortCommand(launchDir: string): string {
  return scannerCommand(["run-abort", "--launch-dir", launchDir]);
}

/** A command of the scanner as the orchestrator runs it: the plugin's own bin where the plugin's root is known. */
export function scannerCommand(args: readonly string[]): string {
  return scannerCommandAsRun(args);
}

// ------------------------------------------------------------------------------------------------
// THE RUN AN EVENT BELONGS TO
// ------------------------------------------------------------------------------------------------

interface ActiveContext {
  run: RunPaths;
  marker: ActiveRunMarker;
  gp: GatePaths;
}

/**
 * The active run this event belongs to, or null: no project, no marker, or a marker of another session.
 * Throws on a marker that exists but does not read (the gate refuses then; the counting routes fail open).
 * A marker written with no session is claimed only by the main session's `Agent` call (`mayClaim`): a
 * seat's start, another session's launch result or a stop never decides whose run it is.
 */
function activeFor(ctx: HookContext, mayClaim = false): ActiveContext | null {
  const run = ctx.run;
  if (!run) return null;
  const read = readActiveRun(run.launchDir);
  if (read.state === "none") return null;
  if (read.state === "unreadable") throw new Error(`the active-run marker ${valueText(join(run.launchDir, ACTIVE_RUN_FILE))} ${read.notCopied ? "is not taken as the run's" : "cannot be read"}: ${valueText(read.error)}`);
  const marker = read.marker;
  const gp = gatePaths(run.launchDir, marker.run_id, marker.attempt);
  const sid = typeof ctx.input.session_id === "string" ? ctx.input.session_id : "";
  if (marker.session_id !== null) return sid === marker.session_id ? { run, marker, gp } : null;
  if (sid === "") return null;
  if (mayClaim) createOnce(gp.claim, line({ session_id: sid, at: ctx.now().toISOString(), via: `${ctx.input.hook_event_name}:${ctx.input.tool_name ?? ""}` }));
  return readJson<{ session_id: string }>(gp.claim)?.session_id === sid ? { run, marker, gp } : null;
}

/**
 * Whether this event belongs to the active run, by the rule the gate acts on (activeFor, which never claims here): the
 * marker names the event's session, or it names none and this session has claimed it. A marker that exists but does
 * not read counts as the run's (the gate refuses then). The routes that act on `.legal` use this one rule: the write
 * guard and question:relay's look-alike refusal (integration part B, area hooks, item 3), so a person's own later
 * session, or a session other than the run's, is never refused by them.
 */
export function eventInActiveRun(ctx: HookContext): boolean {
  try {
    return activeFor(ctx) !== null;
  } catch {
    return true;
  }
}

// ------------------------------------------------------------------------------------------------
// THE STATE OF THE RUN, AS THE GATE COUNTS IT
// ------------------------------------------------------------------------------------------------

/** The one `Agent` field whose presence depends on the session (the header's WHICH INPUT FIELDS ARE COMPARED). */
export const BACKGROUND_FIELD = "run_in_background";

/**
 * How a call's input stands to one entry's `agent_input` under the launch contract (the header). `ok` with the form
 * the call took (`absent`: 2.1.283 in its fork mode, or any session that leaves the field out; `true`: a session whose
 * tool offers the field); otherwise why not: `shape` (not an object), `fields` (a field the entry does not name, or one
 * it names left out), `values` (a named field with another value) or `foreground` (`run_in_background` not `true`).
 */
export type LaunchMatch = { ok: true; field: "absent" | "true" } | { ok: false; why: "shape" | "fields" | "values" | "foreground" };

export function matchLaunch(listed: Record<string, unknown>, given: unknown): LaunchMatch {
  if (!given || typeof given !== "object" || Array.isArray(given)) return { ok: false, why: "shape" };
  const sent = given as Record<string, unknown>;
  const a = Object.keys(listed).filter((k) => k !== BACKGROUND_FIELD).sort();
  const b = Object.keys(sent).filter((k) => k !== BACKGROUND_FIELD).sort();
  if (a.length !== b.length || a.some((k, i) => k !== b[i])) return { ok: false, why: "fields" };
  if (!a.every((k) => (typeof listed[k] === "string" || typeof listed[k] === "boolean") && sent[k] === listed[k])) return { ok: false, why: "values" };
  if (!Object.prototype.hasOwnProperty.call(sent, BACKGROUND_FIELD)) return { ok: true, field: "absent" };
  return sent[BACKGROUND_FIELD] === true ? { ok: true, field: "true" } : { ok: false, why: "foreground" };
}

/** Whether a call's input launches this listed input under the launch contract (the gate and the binding ask this). */
export const sameAgentInput = (listed: Record<string, unknown>, given: unknown): boolean => matchLaunch(listed, given).ok;

/**
 * Whether an entry names the background form: `launch: "background"` (lists written by later versions) or, in a list
 * written before, `run_in_background: true` inside its `agent_input`. An entry that names the field with any other
 * value, or names neither, is never launched (no build of the program writes one).
 */
export function namesBackground(e: ListedEntry): boolean {
  const input = e.agent_input as unknown as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(input, BACKGROUND_FIELD)) return input[BACKGROUND_FIELD] === true;
  return (e as { launch?: unknown }).launch === "background";
}

/** The input a refusal tells the orchestrator to pass for an entry: its `agent_input` without `run_in_background`, which every session the probes saw takes. */
export function launchInput(e: ListedEntry): Record<string, unknown> {
  const { [BACKGROUND_FIELD]: _background, ...rest } = e.agent_input as unknown as Record<string, unknown>;
  return rest;
}

/**
 * PRESUMED LOST. A listed seat whose end no hook ever reached
 * (no answer taken or refused for good, no `returned` event, no recorded stop, no capture cut off at its stop) cannot be
 * told from a seat still at work (entry-answer.ts `returnOf`). Before this unit it held its place and its entry for
 * good, and SKILL.md's recovery for it was to end the run and start a new attempt: live run 2 (2026-09-29) took that
 * path for four entries that only needed launching, and the new attempt priced the whole plan again. Such a seat is now
 * PRESUMED LOST once PRESUMED_LOST_FLOOR_S, or twice the longest time a seat of this run took from its `launched` to
 * its `returned` event, whichever is longer, has passed since its `launched` event: it holds no place (`runState`), and
 * the relaunch rule lets its entry be launched again within the same attempt (entry-answer.ts `relaunchable`), through
 * the gate's relaunch and its guard against a double answer - the reservation then names the new launch, so the old
 * seat binds nothing and a late answer from it is kept unbound and never recorded (seatBinding, hook-capture.ts). One
 * bound, read by both from the program's own events. No cap on how often, as the stale release has none: each
 * relaunch waits the whole bound again.
 */
export const PRESUMED_LOST_FLOOR_S = 3600;

/** What the launch events say of the seats: each seat's latest `launched` event, the seats a `returned` event names, and the bound. */
export interface SeatClock {
  launched: Map<string, { entry: string; at: string; t: number }>;
  returned: Set<string>;
  /** Milliseconds after its `launched` event past which a seat with no sign of its end is presumed lost. */
  lostAfterMs: number;
  /** The moments the run's own conversation was resumed (RESUMES_FILE): a seat launched before one is lost at it. */
  resumes: number[];
}

/**
 * The seat clock, the bound taken from the seats of one run (`runSeats`: its reservations', release lines' and relaunch
 * lines'), and the run's resumes (`resumes`, LOST AT THE RESUME).
 */
export function seatClock(events: LaunchEvent[], runSeats: ReadonlySet<string>, resumes: readonly number[] = []): SeatClock {
  const launched = new Map<string, { entry: string; at: string; t: number }>();
  const returned = new Set<string>();
  let longest = 0;
  for (const e of events) {
    if (typeof e.seat !== "string") continue;
    const t = Date.parse(e.at);
    if (e.event === "launched") {
      const prev = launched.get(e.seat);
      if (Number.isFinite(t) && !(prev && prev.t > t)) launched.set(e.seat, { entry: e.entry, at: e.at, t });
    } else if (e.event === "returned") {
      returned.add(e.seat);
      const from = launched.get(e.seat);
      if (runSeats.has(e.seat) && from && Number.isFinite(t) && t >= from.t) longest = Math.max(longest, t - from.t);
    }
  }
  return { launched, returned, lostAfterMs: Math.max(PRESUMED_LOST_FLOOR_S * 1000, 2 * longest), resumes: [...resumes].sort((a, b) => a - b) };
}

/** A launched seat's presumed-lost moment, and whether `now` is past it. */
export interface PresumedLost {
  seat: string;
  entry: string;
  launched_at: string;
  lost_at: string;
  lost: boolean;
  /** `resume`: the run's own conversation was resumed after its launch, so it ended with the earlier process (LOST AT THE RESUME); `bound`: the bound. */
  by: "bound" | "resume";
}

/**
 * THE ONE PREDICATE: seat `seat` against the bound at `now`, and against the run's resumes. Null where a `returned`
 * event names the seat or no `launched` event does (`fallback`: the time its reservation was bound, where the caller
 * has one). The caller has already found no other sign of the seat's end (a recorded stop; for the relaunch rule, every
 * ledger's sign). A seat launched before a resume that came by `now` is lost at that resume (LOST AT THE RESUME).
 */
export function presumedLost(clock: SeatClock, seat: string, now: Date, fallback?: { entry: string; at: string }): PresumedLost | null {
  if (clock.returned.has(seat)) return null;
  const t0 = fallback ? Date.parse(fallback.at) : Number.NaN;
  const from = clock.launched.get(seat) ?? (fallback && Number.isFinite(t0) ? { entry: fallback.entry, at: fallback.at, t: t0 } : undefined);
  if (!from) return null;
  const resumed = resumedAfter(clock.resumes ?? [], from.t, now.getTime());
  const lostAt = resumed ?? from.t + clock.lostAfterMs;
  return { seat, entry: from.entry, launched_at: from.at, lost_at: new Date(lostAt).toISOString(), lost: now.getTime() >= lostAt, by: resumed !== null ? "resume" : "bound" };
}

/**
 * A REPORT NOT YET DELIVERED HOLDS ITS PLACE. Claude
 * Code counts a sub-agent against its own limit of sub-agents at once until it has delivered the sub-agent's report to
 * whoever launched it, and its auto mode can hold that delivery while it reviews the report (56 seconds in the run of
 * 2026-10-12) after the program's check has accepted the answer. The SubagentStop the program records (`seatStopped`)
 * comes with that delivery, so a seat is counted until its stop is recorded, whether or not its answer was accepted -
 * unless the one predicate's two ends say no delivery will come: a resume of the run's conversation after its launch, or
 * the bound from its launch (`presumedLost`). True while seat `seat`'s report may still be delivered.
 */
export function reportAwaited(clock: SeatClock, seat: string, now: Date): boolean {
  const from = clock.launched.get(seat);
  if (!from) return false;
  if (resumedAfter(clock.resumes ?? [], from.t, now.getTime()) !== null) return false;
  return now.getTime() < from.t + clock.lostAfterMs;
}

/** The name of a receipt's `offered` file for one launch (`receiptNextLines`): the entry, or a launch of it again. */
const offerKey = (entry: string, againSeat: string | null): string => (againSeat ? `${entry}.again.${againSeat}` : entry);

/** Every seat run folder `gp` bound: its reservations', its release lines' and its relaunch lines'. */
function runSeatsOf(gp: { releases: string; relaunches: string }, reservations: Iterable<Reservation>): Set<string> {
  const seats = new Set<string>();
  for (const r of reservations) if (typeof r.seat === "string") seats.add(r.seat);
  for (const path of [gp.releases, gp.relaunches]) for (const l of readJsonLines<{ seat?: unknown }>(path)) if (typeof l.seat === "string") seats.add(l.seat);
  return seats;
}

export interface Occupancy {
  /**
   * Listed seats still running: launched − returned − failed, less the seats whose stop is recorded. A
   * seat this attempt bound counts while its entry's latest record is its `launched` and it has not stopped;
   * a seat an earlier attempt bound counts while this attempt has seen it and it has not stopped. A seat presumed
   * lost (PRESUMED LOST) counts in neither.
   */
  listed_running: number;
  /** Reservations the launch result has not bound yet: launches under way. */
  pending: number;
  /** Seats and agents of this attempt bound to no reservation and not stopped, less the pending launches of their type. */
  unlisted_running: number;
  occupied: number;
  capacity: number;
  /** Listed seats presumed lost (PRESUMED LOST): counted in no place; the relaunch rule launches their entries again. */
  presumed_lost?: number;
  /**
   * Of `listed_running`, the seats whose answer was accepted and whose report Claude Code has not yet
   * delivered (`reportAwaited`); Claude Code still counts each against its limit, so each holds its place.
   */
  awaiting_report?: number;
}

interface RunState {
  latest: Map<string, LaunchEvent>;
  reservations: Map<string, Reservation>;
  seats: SeatSighting[];
  stopped: Set<string>;
  occupancy: Occupancy;
  /** Per agent type: sighted seats bound to no reservation, less that type's pending launches. */
  unlistedByType: Map<string, number>;
  /** The listed seats presumed lost at the state's moment, which hold no place. */
  lost: PresumedLost[];
  /** Entries not reserved whose last launch was lost at the resume (`launchesLostAtResume`). */
  launchesLostAtResume: Set<string>;
  /** Who launched each listed seat counted running and each launch awaiting its result (`Reservation.by`; null: not known). */
  runningBy: (string | null)[];
  /**
   * The launches a receipt named whose report Claude Code has not yet delivered, by `offerKey`, each
   * with the seat whose receipt named it. Whoever that report reaches launches them from it, so nothing else names them.
   */
  promised: Map<string, string>;
}

/**
 * LOST AT THE RESUME, A LAUNCH: the entries whose last
 * launch was still awaiting its result when the run's conversation was resumed after its Claude Code process ended, and
 * which are released for it and not launched since - a reservation judged stale for the resume now, which a reader that
 * writes nothing takes as released before the gate's next decision releases it (`released`, `staleReservations`), or a
 * release line the gate wrote for the resume (`resumed`) that is the entry's last. A later launch of the entry reserves
 * it, and a later release of that launch writes a line of its own, so the entry then leaves this set. Their entries are
 * listed to launch again as plain entries (no seat to name); `resumedSentence` counts them with the lost seats.
 */
function launchesLostAtResume(gp: GatePaths, all: readonly Reservation[], released: ReadonlySet<string>, resumes: readonly number[], now: Date): Set<string> {
  const out = new Set<string>();
  if (resumes.length === 0) return out;
  for (const r of all) if (released.has(r.entry) && typeof r.seat !== "string" && resumedAfter(resumes, Date.parse(r.reserved_at), now.getTime()) !== null) out.add(r.entry);
  const last = new Map<string, { atResume: boolean; at: number }>();
  for (const l of readJsonLines<{ entry?: unknown; resumed?: unknown; at?: unknown }>(gp.releases)) {
    if (typeof l.entry === "string") last.set(l.entry, { atResume: l.resumed === true, at: typeof l.at === "string" ? Date.parse(l.at) : Number.NaN });
  }
  const reserved = new Set(all.filter((r) => !released.has(r.entry)).map((r) => r.entry));
  // R1 of an internal record: a reservation made after the marked release line - a
  // launch after the resume, even one whose own result never came and that a reader takes as released - ends the mark,
  // so a launch made after the resume is never counted as one the resume lost.
  const launchedSince = (entry: string, at: number): boolean => all.some((r) => r.entry === entry && Date.parse(r.reserved_at) > at);
  for (const [entry, l] of last) if (l.atResume && !reserved.has(entry) && !launchedSince(entry, l.at)) out.add(entry);
  return out;
}

/**
 * The run's state at `now`. `released`: entries whose reservation the gate would release as stale before deciding
 * (`staleReservations`), for a reader that writes nothing (`readNextLaunches`); the gate itself releases them first.
 */
function runState(ac: ActiveContext, capacity: number, now: Date, released: ReadonlySet<string> = new Set(), delivering: string | null = null): RunState {
  const events = readLaunchEvents(ac.run.eventsPath).events;
  const latest = latestByEntry(events);
  const all = readJsonDir<Reservation>(ac.gp.reserved);
  const reservations = new Map(all.filter((r) => !released.has(r.entry)).map((r) => [r.entry, r]));
  const seats = readJsonDir<SeatSighting>(ac.gp.seats);
  const stopped = new Set(readJsonDir<{ agent_id: string }>(ac.gp.stopped).map((s) => s.agent_id));
  const resumes = resumeTimes(ac.gp.resumes);
  const clock = seatClock(events, runSeatsOf(ac.gp, reservations.values()), resumes);
  const lost: PresumedLost[] = [];
  const presumed = (seat: string): boolean => {
    const p = presumedLost(clock, seat, now);
    if (p?.lost) lost.push(p);
    return p?.lost === true;
  };
  // Bound: every seat a `launched` record names, in this attempt or an earlier one, and every seat a
  // reservation carries.
  const boundSeats = launchedSeats(events);
  const boundHere = new Set<string>();
  let listedRunning = 0;
  let awaitingReport = 0;
  const runningBy: (string | null)[] = [];
  // A seat whose answer was accepted holds its place until its report is delivered (`reportAwaited`) -
  // except `delivering`, the seat whose own receipt is being computed: that receipt is read only once its report is
  // delivered, and by then Claude Code has freed the seat's place.
  const awaitsReport = (seat: string): boolean => seat !== delivering && clock.returned.has(seat) && !stopped.has(seat) && reportAwaited(clock, seat, now);
  const pendingByType = new Map<string, number>();
  for (const r of reservations.values()) {
    if (typeof r.seat === "string") {
      boundSeats.add(r.seat);
      boundHere.add(r.seat);
      const last = latest.get(r.entry);
      if (last?.seat !== r.seat || stopped.has(r.seat)) continue;
      if (last.event === "launched" && !presumed(r.seat)) {
        listedRunning += 1;
        runningBy.push(r.by ?? null);
      } else if (last.event === "returned" && awaitsReport(r.seat)) {
        listedRunning += 1;
        awaitingReport += 1;
        runningBy.push(r.by ?? null);
      }
    } else {
      pendingByType.set(r.subagent_type, (pendingByType.get(r.subagent_type) ?? 0) + 1);
      runningBy.push(r.by ?? null);
    }
  }
  // A seat an earlier attempt bound that this attempt has seen, and that has not stopped, is still running - and so is
  // a seat of this attempt whose entry was launched again (its reservation names the new launch) - until it is presumed
  // lost, or, where its answer was accepted, until its report is delivered.
  for (const s of seats) {
    if (!boundSeats.has(s.agent_id) || boundHere.has(s.agent_id) || stopped.has(s.agent_id)) continue;
    const answered = clock.returned.has(s.agent_id);
    if (answered ? !awaitsReport(s.agent_id) : presumed(s.agent_id)) continue;
    listedRunning += 1;
    if (answered) awaitingReport += 1;
    runningBy.push(null);
  }
  // Each launch a receipt named, while that receipt's report is not yet delivered, is its reader's.
  const promised = new Map<string, string>();
  for (const o of readJsonDir<{ entry?: unknown; again?: unknown; by?: unknown }>(ac.gp.offered)) {
    if (typeof o.entry !== "string" || typeof o.by !== "string" || o.by === delivering || stopped.has(o.by) || !reportAwaited(clock, o.by, now)) continue;
    promised.set(offerKey(o.entry, typeof o.again === "string" ? o.again : null), o.by);
  }
  const unboundByType = new Map<string, { all: number; running: number }>();
  for (const s of seats) {
    if (boundSeats.has(s.agent_id)) continue;
    const u = unboundByType.get(s.agent_type) ?? { all: 0, running: 0 };
    u.all += 1;
    // LOST AT THE RESUME: a seat with no listed launch seen before the run's conversation was resumed ended with the earlier process.
    if (!stopped.has(s.agent_id) && resumedAfter(resumes, Date.parse(s.at), now.getTime()) === null) u.running += 1;
    unboundByType.set(s.agent_type, u);
  }
  let unlistedRunning = 0;
  const unlistedByType = new Map<string, number>();
  for (const [type, u] of unboundByType) {
    const pending = pendingByType.get(type) ?? 0;
    unlistedRunning += Math.max(0, u.running - pending);
    unlistedByType.set(type, Math.max(0, u.all - pending));
  }
  const pending = [...pendingByType.values()].reduce((a, b) => a + b, 0);
  return {
    latest,
    reservations,
    seats,
    stopped,
    unlistedByType,
    lost,
    launchesLostAtResume: launchesLostAtResume(ac.gp, all, released, resumes, now),
    runningBy,
    promised,
    occupancy: {
      listed_running: listedRunning,
      pending,
      unlisted_running: unlistedRunning,
      occupied: listedRunning + pending + unlistedRunning,
      capacity,
      ...(lost.length > 0 ? { presumed_lost: lost.length } : {}),
      ...(awaitingReport > 0 ? { awaiting_report: awaitingReport } : {}),
    },
  };
}

// ------------------------------------------------------------------------------------------------
// THE GATE: PreToolUse on Agent
// ------------------------------------------------------------------------------------------------

function refuse(ctx: HookContext, ac: ActiveContext | null, kind: RefusalKind, reason: string, entry?: string): HookDecision {
  if (ac) {
    try {
      makeFolder(ac.gp.runDir, { recursive: true });
      const ti = ctx.input.tool_input as Record<string, unknown> | undefined;
      appendFileAt(
        ac.gp.refusals,
        line({
          at: ctx.now().toISOString(),
          attempt: ac.marker.attempt,
          kind,
          entry: entry ?? null,
          tool_use_id: ctx.input.tool_use_id ?? null,
          tool: ctx.input.tool_name ?? null,
          agent_id: ctx.input.agent_id ?? null,
          subagent_type: typeof ti?.subagent_type === "string" ? ti.subagent_type : null,
          description: typeof ti?.description === "string" ? ti.description : null,
          target: typeof ti?.to === "string" ? ti.to : typeof ti?.recipient === "string" ? ti.recipient : typeof ti?.skill === "string" ? ti.skill : undefined,
        }),
      );
    } catch (e) {
      recordHookFailure(ctx.run, ctx.input, { stage: "route", route: "launch-gate", error: `the refusal was not recorded: ${valueText(messageOf(e))}` }, ctx.now());
    }
  }
  return { kind: "deny", reason: `wolfboy launch gate: ${reason}` };
}

const inputJson = (e: ListedEntry): string => JSON.stringify(launchInput(e));

/** The entries `e` waits for that have not returned: the gate's waits check, and `nextLaunches`'s. */
const waitsOf = (e: ListedEntry, st: RunState): string[] => e.after.filter((w) => st.latest.get(w)?.event !== "returned");

/** What the relaunch rule answers for a reserved entry (entry-answer.ts `relaunchable`), read by the caller, which holds the ledgers. */
export type RelaunchOf = (entryId: string) => { ok: true; seat: string; how: string; resumed?: true } | { ok: false; superseded?: true };

/**
 * One entry to launch: as listed, or launched again by the relaunch rule (`again`: the seat it replaces and how its
 * answer was lost; `resumed`: the seat ended with the earlier process of the run's conversation, LOST AT THE RESUME).
 * `launchLostAtResume`: an entry not reserved whose last launch was still awaiting its result at that
 * resume and was released for it (`launchesLostAtResume`): no seat to name, launched again as listed.
 */
export interface NextLaunch {
  entry: ListedEntry;
  again: { seat: string; how: string; resumed?: true } | null;
  launchLostAtResume?: true;
}

/**
 * WHAT TO LAUNCH NEXT: the launch gate's own computation, from the state it decides on, read by the
 * gate's refusals (`insteadText`), by `launch-next` and by the run-abort guard (`readNextLaunches`), so the three never
 * disagree and the orchestrator keeps no list of its own. In wave and list order: an entry not reserved, or reserved and
 * let through by the relaunch rule (where `relaunchOf` is given), whose waits have all returned, is launchable; the
 * first as many as there are free places are to launch now, the rest wait for a place. An entry not reserved whose waits
 * have not all returned waits for them.
 */
function nextLaunches(list: LaunchList, st: RunState, relaunchOf: RelaunchOf | null): NextLaunches {
  const ready: NextLaunch[] = [];
  const waitingFor: { entry: ListedEntry; waits: string[] }[] = [];
  for (const e of [...list.entries].sort((a, b) => a.wave - b.wave || a.order - b.order)) {
    let again: NextLaunch["again"] = null;
    const held = st.reservations.get(e.id);
    /* (where superseded refuter entries meet launch-next and the resume
     * line): the relaunch rule never launches a superseded refuter entry, and an entry never launched (no reservation)
     * was offered here without asking it. Asked now for a refuter entry with no reservation, so such an entry is neither
     * offered, nor counted still to launch, nor counted in the resume line as a part of the review started again. */
    if (!held && relaunchOf !== null && e.role === "refuter") {
      const rule = relaunchOf(e.id);
      if (!rule.ok && rule.superseded === true) continue;
    }
    if (held) {
      if (relaunchOf === null || typeof held.seat !== "string") continue;
      const rule = relaunchOf(e.id);
      if (!rule.ok) continue;
      again = { seat: rule.seat, how: rule.how, ...(rule.resumed ? { resumed: true as const } : {}) };
    }
    const waits = waitsOf(e, st);
    if (waits.length > 0) waitingFor.push({ entry: e, waits });
    else ready.push({ entry: e, again, ...(!held && st.launchesLostAtResume.has(e.id) ? { launchLostAtResume: true as const } : {}) });
  }
  const free = Math.max(0, list.wave_capacity - st.occupancy.occupied);
  // A launch an undelivered receipt named keeps its place and is that receipt's, so nothing else names it.
  const placed = ready.slice(0, free);
  const promisedTo = (x: NextLaunch): string | undefined => st.promised.get(offerKey(x.entry.id, x.again?.seat ?? null));
  const promised = placed.flatMap((x) => {
    const by = promisedTo(x);
    return by === undefined ? [] : [{ ...x, by }];
  });
  return { launch: placed.filter((x) => promisedTo(x) === undefined), promised, waitingPlace: ready.slice(free), waitingFor, free, occupancy: st.occupancy, lost: st.lost, runningBy: st.runningBy };
}

/** The launch gate's answer to "what now": `nextLaunches`. */
export interface NextLaunches {
  /** To launch now, in wave and list order, at most as many as there are free places. */
  launch: NextLaunch[];
  /**
   * Launchable now and named by the receipt of a seat whose report Claude Code has not yet delivered
   * (`by`): whoever that report reaches launches them from it. They keep their places; nothing else names them.
   */
  promised: (NextLaunch & { by: string })[];
  /** Who launched each listed seat running and each launch awaiting its result (null: not known). */
  runningBy: (string | null)[];
  /** Launchable beyond the free places: launched as places free. */
  waitingPlace: NextLaunch[];
  /** Not launched, each waiting for listed entries that have not returned. */
  waitingFor: { entry: ListedEntry; waits: string[] }[];
  free: number;
  occupancy: Occupancy;
  /** Listed seats presumed lost, which hold no place. */
  lost: PresumedLost[];
}

/** The command that prints what to launch next, as the refusals and the guard name it. */
export function launchNextCommand(launchDir: string): string {
  return scannerCommand(["launch-next", "--launch-dir", launchDir]);
}

/** The label of the line `launch-next` and `relay-entry` print for the person, which SKILL.md says to pass on as it prints. */
export const FOR_THE_PERSON = "FOR THE PERSON (tell them this sentence as it is):";

/**
 * LOST AT THE RESUME (hook-launch.ts RESUMES_FILE): one plain sentence for the person, while entries whose
 * seats ended with the earlier Claude Code process of the run's conversation are to launch again; null otherwise. An entry whose launch was still awaiting its result at the resume is counted too (`launchLostAtResume`):
 * it is started again as well. Its words use no term of the program's own. "part of the review", the word table's word, never "check" (the rules' word on the same screens).
 */
export function resumedSentence(n: { launch: Pick<NextLaunch, "again" | "launchLostAtResume">[]; waitingPlace: Pick<NextLaunch, "again" | "launchLostAtResume">[] }): string | null {
  const k = [...n.launch, ...n.waitingPlace].filter((x) => x.again?.resumed === true || x.launchLostAtResume === true).length;
  if (k === 0) return null;
  return k === 1
    ? "The part of the review that was still running when this conversation last closed stopped with it, and it is being started again now."
    : `The ${k} parts of the review that were still running when this conversation last closed stopped with it, and they are being started again now.`;
}

/**
 * One line per entry to launch now, each with the Agent input to pass exactly: `launch-next`'s lines and a receipt's are this one text. `folds`: name each verdict seat's fold command, as `launch-next` does; a receipt
 * leaves it out because the capture wrote the folds before it.
 */
export function launchNowLines(n: NextLaunches, folds: boolean | "blocked" = true, host?: LaunchHost): string[] {
  const lines: string[] = [];
  n.launch.forEach((x, i) => {
    // A verdict seat whose readers' fold is not written yet names the command that writes it (the gate refuses the launch until then).
    const fold = (x.entry as { fold?: { command?: unknown } }).fold?.command;
    lines.push(`  ${i + 1}. entry ${x.entry.id} (wave ${x.entry.wave})${x.again ? `, launched again (the relaunch rule: ${x.again.how})` : ""}: pass this Agent input exactly and nothing else: ${JSON.stringify(launchInput(x.entry))}`);
    if (folds === true && typeof fold === "string") lines.push(`     first run, if the fold is not written yet: ${toldFoldCommand(fold) ?? FOLD_NOT_TOLD}`);
    // A receipt: only where the gate would refuse the entry now, what clears it.
    const first = folds === "blocked" && host ? barFixes(launchBars(x.entry, host)) : [];
    if (first.length > 0) lines.push(`     held by the launch gate until then: ${first.join("; ")}`);
  });
  return lines;
}

/**
 * What only a command clears before entry `entry` can launch, in the
 * words of the launch gate's own refusal (`seatFileProblems`, decideLaunch): its readers' fold not written, or a file of
 * its brief changed. Empty where the gate's file check passes. The relay, whose only tool is Agent, can run none of these.
 */
export function commandsFirst(entry: ListedEntry, files: FileProblem[] = seatFileProblems(entry)): string[] {
  const fixes: string[] = [];
  if (files.length === 0) return fixes;
  const fold = isLaterEntry(entry) ? undefined : entry.fold;
  if (files.some((f) => f.fix === "fold")) fixes.push(`Write the readers' fold first${fold?.command ? `: ${toldFoldCommand(fold.command) ?? FOLD_NOT_TOLD}` : ""}; then launch entry ${entry.id} again`);
  if (files.some((f) => f.fix === "pre-launch")) fixes.push("Run the pre-launch step again with the same run shape: it rewrites the briefs, the reading copies and the list, and the entry is launched from the list it writes");
  return fixes;
}

/** What a relay does about entries only a command clears (`commandsFirst`), in the receipt and the gate's refusal to it. */
const RELAY_CANNOT = "A relay cannot run such a command: it ends its turn while a listed seat is running, and once none is and nothing else is to launch, it hands back, and its hand-back names the command to the main session.";
/** What a relay does about a launch only the person can clear (a `launchBars` bar of clears "person"). */
const RELAY_CANNOT_PERSON = "A relay cannot do this for the person: it ends its turn while a listed seat is running, and once none is, it hands back, and its hand-back tells the main session.";

/** Why the launch gate launches seats only in the background: every refusal of a foreground launch gives it. */
const BACKGROUND_ONLY = "a seat is launched only in the background, because a foreground launch's result, which binds the entry to its seat, arrives only after the seat has answered";

/** What the launch gate reads of the session and the run, beside the entry, to decide a launch (`launchBars`). */
export interface LaunchHost {
  env: NodeJS.ProcessEnv;
  launchDir: string;
  listPath: string;
  /** The attempt's record that a launch of this session ran in the foreground (HOST_FOREGROUND_FILE, written by bindLaunch). */
  hostForeground: string;
  /** U2 item 2: the run's auto-mode stop, where Claude Code's auto mode did not allow a launch of the run; null where none. */
  stop?: AutoModeStop | null;
  /** U2 item 2: the launches asked about are a relay's, for which the stop holds for the rest of the run. */
  forRelay?: boolean;
}

/** The `LaunchHost` of the active run `marker` in `launchDir`, for a process whose environment is `env`. */
export function launchHostOf(launchDir: string, marker: Pick<ActiveRunMarker, "run_id" | "attempt">, env: NodeJS.ProcessEnv, forRelay = false): LaunchHost {
  return { env, launchDir, listPath: join(launchDir, "launch-list.json"), hostForeground: gatePaths(launchDir, marker.run_id, marker.attempt).hostForeground, stop: autoModeStopOf(launchDir, marker.run_id), forRelay };
}

/** One reason the launch gate refuses an entry that the run's state lets launch (`launchBars`). */
export interface LaunchBar {
  /** Where decideLaunch asks it: "form" and "host" before its reservation and waits checks, "files" after them. */
  stage: "form" | "host" | "files";
  kind: "foreground" | "brief-changed" | "auto-mode";
  /** The gate's own reason, as its refusal gives it. */
  text: string;
  /** Who clears it: the main session, by running `fixes`; or the person, outside this session, as `text` says. */
  clears: "command" | "person";
  fixes: string[];
}

/**
 * WOULD THE LAUNCH GATE ADMIT THIS LAUNCH NOW? For an entry the gate's
 * computation places to launch (`nextLaunches`: not reserved or let through by the relaunch rule, its waits returned, a
 * place free), every reason the gate still refuses it, in the gate's order and words: the entry names no background form;
 * the session runs launches in the foreground (background tasks turned off, or a launch result of this attempt that said
 * so); a file of its brief not as the list records it (`commandsFirst`). None: the gate admits it. The one answer asked by
 * the gate (decideLaunch), the receipt (`receiptNextLines`), `relay-entry` (relay-seat.ts) and the relay's hand-back
 * (`relayHandback`), so that none of them orders, offers or waits for a launch the gate refuses.
 */
export function launchBars(entry: ListedEntry, host: LaunchHost): LaunchBar[] {
  const bars: LaunchBar[] = [];
  // U2 item 2: after Claude Code's auto mode did not allow a launch of the run, nothing is launched until the person has
  // written in the main conversation, and no relay launches again in the run.
  const stop = stopBar(host);
  if (stop) bars.push(stop);
  if (!namesBackground(entry)) {
    const fix = "Run the pre-launch step again to rewrite the list";
    bars.push({ stage: "form", kind: "foreground", clears: "command", fixes: [fix], text: `entry ${entry.id} of ${host.listPath} does not name the background form, and ${BACKGROUND_ONLY}. ${fix}.` });
  }
  // What the host does, where the gate can see it (the header): a session with background tasks turned off runs every
  // launch in the foreground whatever its input says (probe run P3), and a launch result of this attempt that said its
  // seat ran in the foreground shows the same of this session.
  const abort = abortCommand(host.launchDir);
  if (hostSwitchOn(host.env[BACKGROUND_OFF_ENV])) {
    bars.push({
      stage: "host",
      kind: "foreground",
      clears: "person",
      fixes: [],
      text: `${BACKGROUND_ONLY}, and this Claude Code session has background tasks turned off (${BACKGROUND_OFF_ENV} is set), so it runs every launch in the foreground. No seat of the run is launched in this session. Ask the person to end the scan run from their own terminal, outside Claude Code (${IN_BASH}: ${abort}), start Claude Code without ${BACKGROUND_OFF_ENV}, and run the scan again.`,
    });
  } else if (existsSync(host.hostForeground)) {
    const ran = readJson<{ entry?: string; seat?: string; status?: unknown }>(host.hostForeground) ?? {};
    bars.push({
      stage: "host",
      kind: "foreground",
      clears: "person",
      fixes: [],
      text: `${BACKGROUND_ONLY}, and this Claude Code session ran entry ${ran.entry ?? "?"}'s seat ${ran.seat ?? "?"} in the foreground (its launch result said ${JSON.stringify(ran.status ?? null)} and came after the seat had answered), so no further seat of the run is launched in it. Ask the person to end the scan run from their own terminal, outside Claude Code (${IN_BASH}: ${abort}), start Claude Code where agents run in the background, and run the scan again.`,
    });
  }
  const files = seatFileProblems(entry);
  if (files.length > 0) {
    const fixes = commandsFirst(entry, files);
    bars.push({ stage: "files", kind: "brief-changed", clears: "command", fixes, text: `entry ${entry.id}: ${files.map((f) => f.text).join("; ")}. A seat reads only the files the program wrote for it, as the launch list records them, so this launch was not started and nothing was reserved. ${fixes.join(". ")}.` });
  }
  return bars;
}

/** What clears `bars`, as a receipt or a hand-back names it: each command the main session runs, or the person's steps. */
export function barFixes(bars: LaunchBar[]): string[] {
  return [...new Set(bars.flatMap((b) => (b.clears === "command" ? b.fixes : [b.text])))];
}

/** W1: the last line of a receipt that names no launch while a listed seat runs, and all of such a receipt's next lines. */
export const NOTHING_NEW = "NOTHING TO LAUNCH NOW: nothing beyond what earlier receipts named; end your turn.";

/**
 * M1: what a receipt says comes next - the launch gate's own computation, as `launch-next` prints it at the
 * same moment, so that whoever launches (the main session in auto mode, or the relay) launches exactly those, and the
 * gate still checks every byte.
 * W1: while a listed seat runs, a receipt names only
 * the launches no earlier receipt of this attempt named (one file per launch under `offered`, made once, so two receipts
 * computed together never both name one), and a receipt that names none is the one line NOTHING_NEW. In arm H 17 of 31
 * entries were named 2 or more times (63 listings) and the relay deliberated over them. Nothing launchable is lost: a
 * running seat's end brings another receipt, or, where it ends without one, the relay's hand-back, which is refused
 * naming every launch it can make (`relayHandback`); and a receipt computed when no listed seat runs names every entry
 * launchable now, as before, since no later receipt would come. `launch-next` and the gate are unchanged.
 */
export function receiptNextLines(read: NextRead, env: NodeJS.ProcessEnv = process.env, sessionTranscript: string | null = null, now: Date = new Date(), by: string | null = null): string[] {
  if (read.state === "unreadable") return [`Next: the program could not read the run (${read.problem}); nothing more is named here. ${launchNextCommand(read.launch_dir)} says what to launch.`];
  if (read.state === "none") return [];
  const all = read.next;
  const host = launchHostOf(read.launch_dir, read.marker, env);
  const o = all.occupancy;
  const toCome = all.waitingPlace.length + all.waitingFor.length;
  const running = o.listed_running + o.pending;
  const gp = gatePaths(read.launch_dir, read.marker.run_id, read.marker.attempt);
  const offered = gp.offered;
  // R13 (build unit F1): the live relay's bound. Reached, the receipt names no launch: the relay ends its turn until its
  // last seat has returned, and then hands back; the main session launches the next relay. The live relay
  // is the one predicate's (`liveRelayIn`), so after a resume the room, the slots and the count are the new relay's.
  const room = relayRoomIn(gp, sessionTranscript, now);
  // U2 item 2: under the run's auto-mode stop a receipt names no launch (a live relay's receipts: the stop holds for it).
  const stopped = stopBar({ ...host, forRelay: room !== null });
  if (stopped) return stopLines(stopped, running);
  if (room !== null && room.reached !== null) return relayBoundLines(room, running);
  // A launch again under the relaunch rule is a new launch of its entry: it is offered once more. Under a live relay each
  // launch named also takes one of the relay's RELAY_MAX_SEATS slots, claimed once (O_EXCL), so that two receipts
  // computed together cannot name more than the bound between them; a launch with no slot left is not offered and
  // stays for the next relay.
  const fresh: typeof all.launch = [];
  const again: typeof all.launch = [];
  for (const x of all.launch) {
    const file = join(offered, `${safe(offerKey(x.entry.id, x.again?.seat ?? null))}.json`);
    if (existsSync(file)) {
      again.push(x);
      continue;
    }
    if (room !== null && !claimRelaySlot(room)) continue;
    // `by`, the seat whose receipt this is: until its report is delivered the launch is this receipt's.
    if (createOnce(file, line({ entry: x.entry.id, again: x.again?.seat ?? null, ...(by !== null ? { by } : {}) }))) fresh.push(x);
    else again.push(x);
  }
  if (running > 0 && fresh.length === 0) return [NOTHING_NEW];
  // With no listed seat running no later receipt would come, so every launchable entry is named, as before - under a
  // relay, those already offered (their slot taken when first named) and those that took a slot now.
  const n = running > 0 ? { ...all, launch: fresh } : room !== null ? { ...all, launch: all.launch.filter((x) => fresh.includes(x) || again.includes(x)) } : all;
  const lines = [
    `Next, from the launch gate's own computation: ${n.launch.length} entr${n.launch.length === 1 ? "y" : "ies"} to launch now${running > 0 ? " not named in an earlier receipt" : ""}, ${n.free} of ${o.capacity} place(s) free, ${toCome} still to come, ${running} listed seat(s) running.`,
    ...launchNowLines(n, "blocked", host),
  ];
  // An entry the gate would refuse now (`launchBars`) is never ordered launched; it is named with what clears it:
  // a command the main session runs, or the person, where no seat of the run is launched in this session.
  const barred = n.launch.map((x) => ({ id: x.entry.id, bars: launchBars(x.entry, host) })).filter((b) => b.bars.length > 0);
  const blocked = barred.map((b) => b.id);
  const byPerson = barred.some((b) => b.bars.some((x) => x.clears === "person"));
  const held =
    blocked.length === 0
      ? ""
      : byPerson
        ? ` ${blocked.length === 1 ? `Entry ${blocked[0]} is` : `Entries ${blocked.join(", ")} are`} held by the launch gate in this session, for the reason named under ${blocked.length === 1 ? "it" : "each"}: the main session tells the person. ${RELAY_CANNOT_PERSON}`
        : ` ${blocked.length === 1 ? `Entry ${blocked[0]} is` : `Entries ${blocked.join(", ")} are`} held by the launch gate until the command named under ${blocked.length === 1 ? "it" : "each"} has run: the main session runs it and then launches the entry. ${RELAY_CANNOT}`;
  if (n.launch.length > blocked.length) lines.push(`LAUNCH NOW: each entry above${blocked.length > 0 ? ` except ${blocked.join(", ")}` : ""}, one Agent call per entry, all in one message, each input exactly as given; then end your turn.${held}`);
  else if (blocked.length > 0) lines.push(`${byPerson ? "NOTHING TO LAUNCH IN THIS SESSION:" : "NOTHING TO LAUNCH BEFORE A COMMAND HAS RUN:"}${held}`);
  else if (toCome > 0 || running > 0) lines.push("NOTHING TO LAUNCH NOW: end your turn; the next seat's answer brings the next receipt.");
  else lines.push("NOTHING LEFT TO LAUNCH: every listed entry has been launched and no listed seat is running.");
  return lines;
}

/**
 * THE RELAY BOUND (full-read design 1.4, review R13; build unit F1). A relay's context grows with every launch and every
 * receipt, so unbounded its cost grows with the square of its seat count and a long run would pass a session's window.
 * A relay hands back after at most RELAY_MAX_SEATS seats - the launches its entry's prompt and its receipts named, each
 * seat bringing at most one receipt - or once its own context passes RELAY_MAX_CONTEXT_TOKENS, whichever comes first.
 * The receipt that finds the bound reached names no launch: the relay ends its turn until the last seat it launched has
 * returned, then hands back, and the main session launches the next relay from the launch list (one wake per relay).
 * No receipt, launch or entry is dropped: what the relay was not told to launch is still on the list for the next one.
 */
export const RELAY_MAX_SEATS = 40;
export const RELAY_MAX_CONTEXT_TOKENS = 120_000;

interface RelayRoom {
  dir: string;
  rec: RelayRecord;
  /** Launches already named to this relay: its entry's prompt and the slots its receipts claimed. */
  named: number;
  /** The relay's context at its last model call, from its own transcript; null where the transcript cannot be read. */
  tokens: number | null;
  /** What reached the bound, or null where it is not reached. */
  reached: string | null;
}

const slotsDirOf = (dir: string, rec: RelayRecord): string => join(dir, `${safe(rec.entry)}.slots`);

/**
 * The context one model call of the relay carried: the last assistant message's `usage` in its transcript (input,
 * cache read and cache write, plus what it wrote). Null where the transcript cannot be read or holds no usage: then
 * only the seat count bounds the relay.
 */
export function relayContextTokens(transcript: string | null): number | null {
  if (!transcript || !existsSync(transcript)) return null;
  let text: string;
  try {
    text = readRegularFile(transcript, "utf8");
  } catch {
    return null;
  }
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l.includes('"usage"')) continue;
    try {
      const u = (JSON.parse(l) as { message?: { usage?: Record<string, unknown> } }).message?.usage;
      if (!u) continue;
      const num = (k: string): number => (typeof u[k] === "number" ? (u[k] as number) : 0);
      return num("input_tokens") + num("cache_read_input_tokens") + num("cache_creation_input_tokens") + num("output_tokens");
    } catch {
      continue;
    }
  }
  return null;
}

/** The live relay of the attempt at `where` (`liveRelayIn`, the one predicate), with its room under the bound; null where none is live. */
function relayRoomIn(where: RelayPlace, sessionTranscript: string | null, now: Date): RelayRoom | null {
  const live = liveRelayIn(where, now);
  if (!live) return null;
  const dir = where.relays;
  const rec = live.r;
  const slots = slotsDirOf(dir, rec);
  const claimed = existsSync(slots) ? readdirSync(slots).filter((f) => f.endsWith(".json")).length : 0;
  const named = (rec.first_named ?? 0) + claimed;
  const tokens = rec.seat && sessionTranscript ? relayContextTokens(agentTranscriptOf(sessionTranscript, rec.seat)) : null;
  const reached =
    named >= RELAY_MAX_SEATS
      ? `it has been named ${named} seat launches, the most one relay launches (${RELAY_MAX_SEATS})`
      : tokens !== null && tokens > RELAY_MAX_CONTEXT_TOKENS
        ? `its context passed ${RELAY_MAX_CONTEXT_TOKENS.toLocaleString("en-US")} tokens (${tokens.toLocaleString("en-US")} at its last call)`
        : null;
  return { dir, rec, named, tokens, reached };
}

/** Claim the next of the relay's RELAY_MAX_SEATS launch slots; false where none is left. */
function claimRelaySlot(room: RelayRoom): boolean {
  const slots = slotsDirOf(room.dir, room.rec);
  makeFolder(slots, { recursive: true });
  for (let k = (room.rec.first_named ?? 0) + 1; k <= RELAY_MAX_SEATS; k++) {
    if (createOnce(join(slots, `${k}.json`), line({ slot: k }))) {
      room.named++;
      return true;
    }
  }
  return false;
}

/** A receipt's lines once the live relay's bound is reached: launch nothing; drain; then hand back. */
function relayBoundLines(room: RelayRoom, running: number): string[] {
  return running > 0
    ? [`RELAY BOUND REACHED: ${room.reached}. Launch nothing more, not even an entry an earlier receipt named and you have not launched yet; end your turn. ${running} listed seat(s) still running: the next receipt tells you when to hand back.`]
    : [`RELAY BOUND REACHED: ${room.reached}, and none of the seats you launched is running. HAND BACK NOW: call SubagentHandback with one short sentence. The main session launches the next relay, which launches what is left.`];
}

/** For `relayHandback` and the gates: the bound state of this attempt's live relay (`liveRelayIn`, the one predicate). */
export function relayBoundOf(where: RelayPlace, sessionTranscript: string | null, now: Date = new Date()): { named: number; tokens: number | null; reached: string | null } | null {
  const room = relayRoomIn(where, sessionTranscript, now);
  return room ? { named: room.named, tokens: room.tokens, reached: room.reached } : null;
}

/** `readNextLaunches` with the run's relaunch rule, as `launch-next` reads it: for a receipt and for the relay's hand-back. */
export async function nextLaunchesNow(launchDir: string, now: Date, delivering: string | null = null): Promise<NextRead> {
  const { readAnswerLedgers, relaunchable } = await import("./entry-answer.js");
  return readNextLaunches(
    launchDir,
    now,
    (runId, at) => {
      const ledgers = readAnswerLedgers(dirname(launchDir), launchDir, runId, at);
      return (id) => relaunchable(ledgers, id);
    },
    delivering,
  );
}

function insteadText(next: NextLaunches, launchDir: string, except?: string): string {
  const ready = [...next.launch, ...next.waitingPlace].filter((n) => n.entry.id !== except);
  const left = ready.length + next.waitingFor.filter((w) => w.entry.id !== except).length;
  const cmd = launchNextCommand(launchDir);
  if (left === 0) return `Every entry of the launch list has been launched; nothing is left to launch in this run.`;
  if (next.free <= 0) return `No place is free now (${placesText(next.occupancy)}); when a running seat's answer has arrived, run ${cmd}, which prints what to launch then.`;
  if (ready.length === 0) return `No entry can be launched now: the ${left} left each wait for an entry that has not returned. When those answers have arrived, run ${cmd}, which prints what to launch then.`;
  const first = ready[0] as NextLaunch;
  const now = Math.min(ready.length, next.free);
  const again = first.again ? ` The relaunch rule launches it again: ${first.again.how}.` : "";
  return `Launch instead entry ${first.entry.id} (wave ${first.entry.wave}), passing this Agent input exactly and nothing else: ${inputJson(first.entry)}.${again} ${now} entr${now === 1 ? "y is" : "ies are"} launchable now, ${next.free} place(s) free; ${cmd} prints each of them with its input.`;
}

const placesText = (o: Occupancy): string =>
  `${o.occupied} of the list's ${o.capacity} places in use: ${o.listed_running} listed seat(s) running${o.awaiting_report ? ` (${o.awaiting_report} of them answered, their report not yet delivered by Claude Code, which counts them until it is)` : ""}, ${o.pending} launch(es) awaiting their result, ${o.unlisted_running} seat(s) running without a listed launch` +
  (o.presumed_lost ? `; ${o.presumed_lost} listed seat(s) presumed lost hold no place` : "");

/** One file a seat would read that is not as the list records it, and what puts it right. */
export interface FileProblem {
  text: string;
  /** The pre-launch step rewrites the briefs, the reading copies and the list; a verdict seat's fold has its own command. */
  fix: "pre-launch" | "fold";
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * THE GATE IS A CONSUMER OF EVERY FILE THE PROGRAM WROTE FOR A SEAT, and takes none of
 * them as given. A listed launch passes only while its brief and every file the brief names (`reads`) are the
 * ones the list records: the brief against `brief_sha256`; a reading copy against its `sha256`, and the file
 * it was copied from against `copied_from.sha256`; every other file against its `sha256` (the run context, the
 * orientation sheet and the orchestrator's paragraph included: relay integration part B, item 2); only a verdict
 * seat's fold, written later by its own command, has no digest and must at least exist. The digests are the list's own (the
 * list is pinned by the marker's sha256); the gate keeps none of its own. Whatever wrote a file - a Write, an
 * Edit, a shell redirect, a python script - a changed file is refused the same way. Empty when every file holds.
 * A refuter or silence-investigator entry (launch-later.ts) is checked the same way; its brief is the only file it
 * names (relay integration part B, item 1: launch-later/report.md "Open: briefs in the gate").
 * Exported for the launch-plan gate, which runs it over every entry of a list the program wrote.
 */
/**
 * THE LISTED-FILE DIGEST RULE (the launch gate's, `seatFileProblems`, and the seat-read hook's, hook-seat-read.ts; one copy).
 * The program records the sha256 of the text it wrote (a brief, a reading copy)
 * or of the text it read as UTF-8 (the original of a copy, `seatReadOf`). For UTF-8 bytes the two are the bytes' own
 * sha256; where the bytes are not UTF-8, only the digest of the text read as UTF-8 is the one the list records.
 */
export const listedDigestMatches = (bytes: Buffer, digest: string): boolean => sha256(bytes) === digest || sha256(bytes.toString("utf8")) === digest;

export function seatFileProblems(entry: ListedEntry): FileProblem[] {
  const problems: FileProblem[] = [];
  const examine = (what: string, path: unknown, digest: unknown, digestRequired: boolean, fix: FileProblem["fix"]): void => {
    if (typeof path !== "string" || path === "") {
      problems.push({ text: `the list names no path for ${what}`, fix: "pre-launch" });
      return;
    }
    // Through the one reader (program-file.ts, item 4): only a regular file with one name is read, and never by
    // waiting on it - a named pipe fails closed here and nothing is reserved.
    const got = readProgramFile(what, path);
    if (!got.ok) {
      problems.push({ text: got.code === "ENOENT" ? `${what} at ${valueText(path)} does not exist` : got.problem, fix });
      return;
    }
    const bytes = got.value;
    if (digest === undefined && !digestRequired) return;
    if (typeof digest !== "string" || !HEX64.test(digest)) {
      problems.push({ text: `the list records no sha256 for ${what} at ${valueText(path)}`, fix: "pre-launch" });
      return;
    }
    const found = sha256(bytes);
    if (!listedDigestMatches(bytes, digest)) problems.push({ text: `${what} at ${valueText(path)} has changed since the pre-launch step recorded it (sha256 ${found.slice(0, 16)}…, the list records ${digest.slice(0, 16)}…)`, fix: "pre-launch" });
  };
  examine("its brief", entry.brief_path, entry.brief_sha256, true, "pre-launch");
  // A refuter's or silence investigator's brief carries everything it hands on, and names no other file of `.legal/`
  // (launch-later.ts `refuterBrief`, `silenceBrief`): its brief is all there is to check.
  if (isLaterEntry(entry)) return problems;
  if (!Array.isArray(entry.reads)) {
    problems.push({ text: "the list names no files for its brief (no reads)", fix: "pre-launch" });
    return problems;
  }
  for (const r of entry.reads as unknown[]) {
    const read = (r && typeof r === "object" ? r : {}) as { role?: unknown; path?: unknown; sha256?: unknown; copied_from?: unknown };
    const role = typeof read.role === "string" && Object.prototype.hasOwnProperty.call(READ_ROLE_WORDS, read.role) ? (read.role as ReadRole) : null;
    const words = role ? READ_ROLE_WORDS[role] : `a file its brief names (role ${JSON.stringify(read.role) ?? "none"})`;
    const copied = read.copied_from !== undefined;
    // Every file a brief names has its digest in the list, the readers' fold excepted (it is written later, by its
    // own command): the one list writer records them (launch-list-file.ts `replaceLaunchList`, here at the consumer).
    examine(copied ? `the line-safe reading copy of ${words}` : words, read.path, read.sha256, role !== "fold", role === "fold" ? "fold" : "pre-launch");
    if (copied) {
      const from = (read.copied_from && typeof read.copied_from === "object" ? read.copied_from : {}) as { path?: unknown; sha256?: unknown };
      examine(`the original of the reading copy of ${words}`, from.path, from.sha256, true, "pre-launch");
    }
  }
  return problems;
}

export async function gateLaunch(ctx: HookContext): Promise<HookDecision> {
  const run = ctx.run;
  if (!run) return PASS;
  let ac: ActiveContext | null = null;
  try {
    ac = activeFor(ctx, ctx.who === "main");
    if (!ac) return otherConversationRefusal(ctx) ?? PASS;
    return await decideLaunch(ctx, ac);
  } catch (e) {
    recordHookFailure(run, ctx.input, { stage: "route", route: "launch-gate", error: messageOf(e) }, ctx.now());
    return refuse(
      ctx,
      ac,
      "error",
      `the gate failed (${valueText(messageOf(e))}), so this launch was not started and nothing was reserved. Launch it again; if the gate keeps failing, report the failure to the person: ${personEndsText(run.launchDir)}.`,
    );
  }
}

/**
 * THE RUN'S LIST AS THE GATE READS IT, for the gate and for `readNextLaunches`: through the one reader (program-file.ts),
 * so that a list that is not a regular file with one name is refused as changed, never waited on,
 * and against the sha256 the run's marker records.
 */
/** The `LaunchHost` the gate decides on: this hook process's environment and the active run's own paths. */
const runHost = (ac: ActiveContext, forRelay = false): LaunchHost => ({ env: process.env, launchDir: ac.run.launchDir, listPath: ac.run.listPath, hostForeground: ac.gp.hostForeground, stop: autoModeStopOf(ac.run.launchDir, ac.marker.run_id), forRelay });

function readRunList(listPath: string, marker: ActiveRunMarker): { ok: true; list: LaunchList } | { ok: false; kind: "missing" | "unreadable" | "changed"; problem: string } {
  const listRead = readProgramFile("the launch list", listPath);
  if (!listRead.ok && listRead.code === "ENOENT") return { ok: false, kind: "missing", problem: `no launch list has been written for scan run ${valueText(marker.run_id)} yet (${valueText(listPath)})` };
  if (!listRead.ok) return { ok: false, kind: "unreadable", problem: listRead.problem };
  const listText = listRead.value;
  if ((marker.list_sha256 === null || sha256(listText) !== marker.list_sha256) && markerRecording(dirname(listPath), marker, sha256(listText)) === null) {
    return {
      ok: false,
      kind: "changed",
      problem: `${valueText(listPath)} is not the launch list the pre-launch step wrote for run ${valueText(marker.run_id)} (sha256 ${sha256(listText).slice(0, 16)}…, the run records ${marker.list_sha256 === null ? "no list yet" : `${marker.list_sha256.slice(0, 16)}…`})`,
    };
  }
  return { ok: true, list: JSON.parse(listText.toString("utf8")) as LaunchList };
}

/** The relaunch rule, loaded only where a launched entry is launched again (entry-answer.ts reads both capture ledgers). */
async function relaunchRule(ac: ActiveContext, entryId: string, now: Date) {
  const { readAnswerLedgers, relaunchable } = await import("./entry-answer.js");
  return relaunchable(readAnswerLedgers(ac.run.legalDir, ac.run.launchDir, ac.marker.run_id, now), entryId);
}

/** The relaunch rule for every entry of the run, loaded only where a refusal names what to launch instead. */
async function relaunchOfRun(ac: ActiveContext, now: Date): Promise<RelaunchOf> {
  const { readAnswerLedgers, relaunchable } = await import("./entry-answer.js");
  const ledgers = readAnswerLedgers(ac.run.legalDir, ac.run.launchDir, ac.marker.run_id, now);
  return (id) => relaunchable(ledgers, id);
}

/**
 * What a refusal says about ending the run: it is the person's decision, made from their own
 * terminal outside Claude Code, where `run-abort` always ends the run; inside the session the orchestrator's `run-abort`
 * is refused while the run only needs launching (`abortRefusal`).
 */
export function personEndsText(launchDir: string): string {
  return `ending the scan run is the person's decision: ask them, and if they decide it, they run ${abortCommand(launchDir)} ${IN_BASH}, from their own terminal, outside Claude Code`;
}

/** Why the list at `listPath` was not written in the shape the person chose (or the recommended plan without asking), or null. Never throws. */
/**
 * What would make this run's assembly impossible, found before any seat
 * launches (and is paid for): the session's transcript, which the assembly reads for every seat and beside which Claude
 * Code keeps each seat's, lying where the assembly does not take a transcript (state-record.ts
 * `transcriptPlaceRefusal`: inside the scanned folder); and no place
 * in the state folder for the hook's own record of the seats' answers (`seat-captures.jsonl`), without which the
 * assembly accepts no record. Null where nothing does; otherwise the cause and what to do, for the refusal.
 */
function assemblyBlocked(ctx: HookContext, ac: ActiveContext): string | null {
  // Claude Code hands every hook event `transcript_path`; an event without one has no place to compare.
  const session = typeof ctx.input.transcript_path === "string" && ctx.input.transcript_path !== "" ? ctx.input.transcript_path : null;
  const placed = session === null ? null : transcriptPlaceRefusal(session, launchRecordOwner(ac.run.launchDir));
  if (placed !== null) return `the assembly could take no answer of this run: ${placed}`;
  try {
    launchRecordPath(ac.run.launchDir, SEAT_CAPTURES_FILE, true);
  } catch (e) {
    return `the assembly could take no answer of this run: ${valueText(messageOf(e))}`;
  }
  return null;
}

function shapeOfList(launchDir: string, listPath: string): string | null {
  try {
    const taken = runShapeFromAnswer(launchDir, listPath);
    return "refused" in taken ? `the run shape of ${valueText(listPath)} cannot be tied to the person's answer: ${taken.refused}` : null;
  } catch (e) {
    return `the run shape of ${valueText(listPath)} cannot be tied to the person's answer: ${valueText(messageOf(e))}`;
  }
}

async function decideLaunch(ctx: HookContext, ac: ActiveContext): Promise<HookDecision> {
  const abort = abortCommand(ac.run.launchDir);
  const other = `If this launch is not part of the scan, the scan run must end first, and ${personEndsText(ac.run.launchDir)}.`;
  const listPath = ac.run.listPath;
  const listed = readRunList(listPath, ac.marker);
  if (!listed.ok && listed.kind === "missing") {
    return refuse(ctx, ac, "no-list", `a scan run (${ac.marker.run_id}) is active and no launch list has been written for it yet, so no seat is launched. The pre-launch step writes the list once the run shape is chosen. ${other}`);
  }
  if (!listed.ok && listed.kind === "unreadable") return refuse(ctx, ac, "list-changed", `${listed.problem}; no seat is launched from it. ${other}`);
  if (!listed.ok) return refuse(ctx, ac, "list-changed", `${listed.problem}, so no seat is launched from it. Run the pre-launch step again to write the list. ${other}`);
  const list = listed.list;
  // The run shape, before any seat or relay of the list is launched (and paid
  // for): the one check the assembly makes (`runShapeFromAnswer`), read from this hook's own state folder, so a list a
  // command wrote from records in another folder (a state folder named on its command line) launches nothing.
  const shaped = shapeOfList(ac.run.launchDir, listPath);
  if (shaped !== null) {
    return refuse(ctx, ac, "shape", `${shaped}, so no seat is launched from the list. Inside a Claude Code session the run shape is the person's answer to the run-shape question as this plugin's hook recorded it in the state folder, and the assembly refuses a run launched in any other shape. Run the pre-launch step again with --shape-from-answer once the person has answered the question. ${other}`);
  }
  const blocked = assemblyBlocked(ctx, ac);
  if (blocked !== null) return refuse(ctx, ac, "assembly", `${blocked}. No seat is launched, so nothing is paid for a run that cannot be assembled. ${other}`);
  releaseStaleReservations(ac, ctx.now());
  const st = runState(ac, list.wave_capacity, ctx.now());
  const input = ctx.input.tool_input;
  const toolUseId = ctx.input.tool_use_id;
  // A refusal names what to launch instead from the one computation `launch-next` prints, the relaunch rule
  // included, and never offers ending the run as the way past it.
  const instead = async (except?: string): Promise<string> => insteadText(nextLaunches(list, st, await relaunchOfRun(ac, ctx.now())), ac.run.launchDir, except);
  const end = "Ending the scan run is never the way past this refusal: that is the person's decision.";
  if (typeof toolUseId !== "string" || toolUseId === "") {
    return refuse(ctx, ac, "malformed", `this Agent call carries no tool_use_id, so its launch result could not be bound to a listed entry. ${await instead()} ${end}`);
  }
  // A seat of the run launches no agent, whatever it names; the main session, the
  // relay and the host's own agents launch the list's entries, each checked below byte for byte.
  if (ctx.who === "seat") {
    return refuse(ctx, ac, "caller", `a seat of the run launches no agent, and this call was made by ${String(ctx.input.agent_type)}. A seat's instructions are its brief; the run's launches are the list's, made by the main session or its relay. ${end}`);
  }
  const relay = (list.relays ?? []).find((r) => matchLaunch(r.agent_input as unknown as Record<string, unknown>, input).ok);
  if (relay) return await decideRelayLaunch(ctx, ac, relay, toolUseId, list);
  // THE LAUNCH CONTRACT (the header): the entry whose agent_input the call launches, whatever the session did
  // with run_in_background. Where none matches, the nearest miss says why: the foreground form of an entry, or a model
  // the session dropped (MODEL_FORCE_ENV). A matching entry that names no background form is refused after.
  const matchOf = (e: ListedEntry) => matchLaunch(e.agent_input as unknown as Record<string, unknown>, input);
  const entry = list.entries.find((e) => matchOf(e).ok);
  const background = BACKGROUND_ONLY;
  if (!entry) {
    const foreground = list.entries.find((e) => { const m = matchOf(e); return !m.ok && m.why === "foreground"; });
    if (foreground) {
      return refuse(ctx, ac, "foreground", `${background}, and this call sets run_in_background to ${JSON.stringify((input as Record<string, unknown>)[BACKGROUND_FIELD])}. Launch entry ${foreground.id} again with this input exactly, leaving run_in_background out (Claude Code runs such a launch in the background): ${inputJson(foreground)}.`, foreground.id);
    }
    const sent = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
    if (sent && !Object.prototype.hasOwnProperty.call(sent, "model") && hostSwitchOn(process.env[MODEL_FORCE_ENV])) {
      const dropped = list.entries.find((e) => { const { model: _model, ...rest } = e.agent_input as unknown as Record<string, unknown>; return matchLaunch(rest, sent).ok; });
      if (dropped) {
        return refuse(
          ctx,
          ac,
          "unlisted",
          `this Claude Code session forces every agent's model (${MODEL_FORCE_ENV} is set), so its Agent tool drops the model entry ${dropped.id} names (${JSON.stringify(dropped.agent_input.model)}, the model the run's price table priced) and the seat would run on another. No seat of the run is launched in this session. Ask the person to end the scan run from their own terminal, outside Claude Code (${IN_BASH}: ${abort}), start Claude Code without ${MODEL_FORCE_ENV}, and run the scan again.`,
          dropped.id,
        );
      }
    }
    const type = sent?.subagent_type;
    const what = type === "fork" ? "A fork is never a listed launch." : "Its input is not, field for field, the Agent input of any entry.";
    return refuse(ctx, ac, "unlisted", `while scan run ${ac.marker.run_id} is active, only the launch list's entries are launched, each with its agent_input passed unchanged (no field added, none left out; run_in_background may be left out). ${what} ${await instead()} ${other}`);
  }
  // F2 of an internal record: the entry's form and the host's, as `launchBars` answers them for the
  // receipt, relay-entry and the relay's hand-back too; its files after the reservation and waits checks, below.
  const bars = launchBars(entry, runHost(ac, ctx.who === "relay"));
  const early = bars.find((b) => b.stage !== "files");
  if (early) return refuse(ctx, ac, early.kind, early.stage === "form" ? `${early.text} ${other}` : early.text, entry.id);
  const held = st.reservations.get(entry.id);
  // THE RELAUNCH RULE (entry-answer.ts `relaunchable`, which the assembly's advice and run-status ask too):
  // an entry whose bound seat has returned with its answer lost is launched again, as written;
  // every other second launch is refused, with the rule's reason.
  let again: { seat: string; how: string; reservation: Reservation } | null = null;
  if (held) {
    const bound = typeof held.seat === "string";
    const rule = bound ? await relaunchRule(ac, entry.id, ctx.now()) : null;
    if (rule?.ok) again = { seat: rule.seat, how: rule.how, reservation: held };
    else {
      const state = bound ? `launched as seat ${held.seat}` : "awaiting its launch result";
      // A reservation whose launch result never comes is released by the program (releaseStaleReservations).
      const releaseAt = new Date(Date.parse(held.reserved_at) + STALE_RELEASE_MS);
      const stale = bound || !Number.isFinite(releaseAt.getTime()) ? "" : ` If no launch result comes and no seat of its type starts, the program releases the reservation at ${releaseAt.toISOString()} and the entry can be launched again then.`;
      const why = rule && !rule.ok ? ` Not launched again: ${rule.why}.` : "";
      return refuse(
        ctx,
        ac,
        "reserved",
        `entry ${entry.id} was already launched by call ${held.tool_use_id} at ${held.reserved_at} (${state}); a listed entry is launched once, and a second time only where its seat has returned with its answer lost (not captured, cut off, or never taken) or is presumed lost (no sign of its end long past its launch).${why}${stale} ${await instead(entry.id)} ${end}`,
        entry.id,
      );
    }
  }
  const waits = waitsOf(entry, st);
  if (waits.length > 0) {
    return refuse(ctx, ac, "waits", `entry ${entry.id} waits for ${waits.join(", ")} to return first; launch it when ${waits.length === 1 ? "that answer has" : "those answers have"} arrived. ${await instead(entry.id)} ${end}`, entry.id);
  }
  // The brief and every file it names, against the digests the list records (`launchBars`).
  const files = bars.find((b) => b.stage === "files");
  if (files) return refuse(ctx, ac, files.kind, `${files.text} ${ctx.who === "relay" ? `${RELAY_CANNOT} ` : ""}${end}`, entry.id);
  if (st.occupancy.occupied >= list.wave_capacity) {
    return refuse(ctx, ac, "capacity", `every place the launch list plans is in use (${placesText(st.occupancy)}). Launch entry ${entry.id} again when a running seat's report has reached whoever launched it: then ${launchNextCommand(ac.run.launchDir)} prints what to launch. ${end}`, entry.id);
  }
  if (again) {
    // The old reservation is taken by one rename, so two launches at once launch the entry again once. It moves to the
    // run folder's relaunches.jsonl, which confirms no binding (seatBinding reads reservations and releases.jsonl
    // only): the old seat, having returned, binds nothing, and the new seat binds as a new launch when its launch
    // result comes (bindLaunch), through the reservation written below.
    const path = join(ac.gp.reserved, `${safe(entry.id)}.json`);
    const taken = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.relaunched`;
    try {
      renamePath(path, taken);
    } catch (e) {
      if (codeOf(e) !== "ENOENT") throw e;
      return refuse(ctx, ac, "reserved", `entry ${entry.id} was launched again by another call at the same moment; a listed entry is launched again once. ${await instead(entry.id)} ${end}`, entry.id);
    }
    const got = readJson<Reservation>(taken);
    if (!got || got.tool_use_id !== again.reservation.tool_use_id || got.seat !== again.seat) {
      if (got) createOnce(path, line(got));
      removeFile(taken);
      return refuse(ctx, ac, "reserved", `entry ${entry.id}'s reservation changed while this launch was decided; launch it again to have it decided afresh. ${end}`, entry.id);
    }
    makeFolder(ac.gp.runDir, { recursive: true });
    appendFileAt(
      ac.gp.relaunches,
      line({ at: ctx.now().toISOString(), attempt: ac.marker.attempt, entry: entry.id, seat: got.seat, tool_use_id: got.tool_use_id, reserved_at: got.reserved_at, bound_at: got.bound_at ?? null, answer_lost: again.how, by: toolUseId }),
    );
    removeFile(taken);
  }
  const reservation: Reservation = {
    entry: entry.id,
    tool_use_id: toolUseId,
    subagent_type: entry.agent_input.subagent_type,
    session_id: String(ctx.input.session_id ?? ""),
    reserved_at: ctx.now().toISOString(),
    by: ctx.who === "main" ? "main" : typeof ctx.input.agent_id === "string" && ctx.input.agent_id !== "" ? ctx.input.agent_id : String(ctx.who),
  };
  if (!createOnce(join(ac.gp.reserved, `${safe(entry.id)}.json`), line(reservation))) {
    return refuse(ctx, ac, "reserved", `entry ${entry.id} was reserved by another launch at the same moment; a listed entry is launched once. ${await instead(entry.id)}`, entry.id);
  }
  // The launch's call record keeps the level its event carried beside the session's start level, as a record.
  // The report compares each seat's own level with its agent file's pin instead (`effortChanges`).
  const record: LaunchCallRecord = {
    entry: entry.id,
    tool_use_id: toolUseId,
    at: reservation.reserved_at,
    session_id: reservation.session_id,
    effort: eventEffort(ctx.input),
    start_effort: typeof ac.marker.start_effort === "string" ? ac.marker.start_effort : null,
  };
  createOnce(join(ac.gp.calls, `${safe(toolUseId)}.json`), line(record));
  return PASS;
}

/** One launch the gate let through: its entry and call, and the effort levels. */
export interface LaunchCallRecord {
  entry: string;
  tool_use_id: string;
  at: string;
  session_id?: string;
  /** The effort level the launch's PreToolUse event carried (`eventEffort`); null where it carried none. */
  effort?: string | null;
  /** The session's start level as the run's marker recorded it at the launch (`start_effort`); null where none was named. */
  start_effort?: string | null;
}

/**
 * The effort level a hook event carries: `effort.level`,
 * or a plain string; null where it carries none.
 */
export function eventEffort(input: HookInput): string | null {
  const e = input.effort;
  if (typeof e === "string") return e === "" ? null : e;
  const level = e !== null && typeof e === "object" ? (e as { level?: unknown }).level : undefined;
  return typeof level === "string" && level !== "" ? level : null;
}

/** A seat recorded at another effort level than its agent file pins. */
export interface EffortChange {
  entry: string | null;
  seat: string;
  agent_type: string;
  /** The levels the seat's own transcript records (seat-effort.ts `transcriptEffort`). */
  levels: string[];
  /** The `effort` its agent file pins. */
  pin: string;
}

/**
 * THE EFFORT REPORT.
 * Each seat's own level, read at SubagentStop from its
 * transcript onto the hook ledger (`agent_effort`), is compared with the `effort` its agent file pins
 * (seat-effort.ts `seatPins`). A seat whose transcript names another level ran under `CLAUDE_CODE_EFFORT_LEVEL` set
 * outside `legal-scan session`, the one setting that outranks the pin. Reported, never refused: the variable is the
 * person's. A seat with no recorded level, or of a type whose agent file pins none, is not compared.
 */
export function effortChanges(seats: readonly SeatEffort[], pins: ReadonlyMap<string, string | null>): EffortChange[] {
  const out: EffortChange[] = [];
  for (const s of seats) {
    const pin = pins.get(s.agent_type);
    if (typeof pin !== "string" || s.levels.length === 0) continue;
    if (s.levels.some((l) => l !== pin)) out.push({ entry: s.entry, seat: s.agent_id, agent_type: s.agent_type, levels: s.levels, pin });
  }
  return out.sort((a, b) => String(a.entry).localeCompare(String(b.entry)) || a.seat.localeCompare(b.seat));
}

/** The effort report of one run: its entries' seats in the hook ledger beside the launch directory, against the pins. */
export function runEffortChanges(launchDir: string, runId: string): EffortChange[] {
  const list = readJson<LaunchList>(join(launchDir, "launch-list.json"));
  if (!list || list.run_id !== runId) return [];
  const entries = new Set(list.entries.map((e) => e.id));
  let lines: EffortLedgerLine[];
  try {
    lines = readHookLedger(dirname(launchDir));
  } catch {
    return [];
  }
  return effortChanges(seatEfforts(lines, entries), seatPins(HOOK_PLUGIN_NAME));
}

/** The report as one line for a person, or null where every seat ran at its pin. */
export function effortChangeLine(changes: readonly EffortChange[]): string | null {
  if (changes.length === 0) return null;
  const each = changes.map((c) => `${c.entry ?? c.seat} (${c.agent_type.replace(/^.*:/, "")}) at ${c.levels.join("+")}, pinned ${c.pin}`);
  return (
    `EFFORT: ${changes.length} seat(s) of this run ran at another effort level than their agent file pins: ${each.join(", ")}. ` +
    `Only ${EFFORT_LEVEL_ENV}, set in a session started outside legal-scan session, outranks the pin. The level is the person's to set: tell them, and do not change it yourself.`
  );
}

// ------------------------------------------------------------------------------------------------
// EVERY OTHER CALL THAT PUTS TEXT INTO A SEAT: PreToolUse on SendMessage, Skill and Workflow
// ------------------------------------------------------------------------------------------------

/** The fields of a SendMessage input that name its recipient: `to` (2.1.281's schema) and `recipient`, an older name the model still sends (live check rh4c). */
const RECIPIENT_FIELDS = ["to", "recipient"] as const;

/**
 * While the run is active, no call carries the caller's own text into a seat:
 * - `SendMessage` is refused when a recipient field names an agent the hooks recorded in this project
 *   (`agentsRecorded`), or is not `main` and not an agent id (`AGENT_ID_SHAPE`): a name, a name with its
 *   `[ref]`, a prefix or a teammate reach an agent the gate cannot identify (a seat's listing name is its agent
 *   id). A message to `main`, or to an agent id the hooks never recorded, passes.
 * - `Skill` is refused unless the skill is this plugin's own (`wolfboy:`) and its SKILL.md, read at
 *   the call (`ownSkillForm`), names neither `context` nor `agent`: a skill with `context: fork` starts the
 *   agent type it names (the plugin's name alone is not proof, the live check's `wolfboy:rh4c-fork` was a forking skill of a plugin with that name).
 * - `Workflow` is always refused: its script's `agent()` takes any agent type, and the call cannot say which.
 */
export type SkillForm = { form: "inline" } | { form: "fork" | "unknown"; why: string };

/**
 * How one of this plugin's skills runs, from its SKILL.md at the call, where Claude Code
 * loads it: `skills/<name>/SKILL.md` of the plugin this program belongs to (`root`, by default scanner-command.ts
 * `ownPlugin`: found from this program's own place, the folder the hook's command was started from, never from
 * CLAUDE_PLUGIN_ROOT, which a project's settings can set). `inline` only when the front matter names neither
 * `context` (`context: fork` runs the skill as an agent) nor `agent` (the type a forked skill starts), in any
 * case or quoting; `fork` when it names either; `unknown` when the folder is not known, the name is not a
 * folder's name, or the file or its front matter cannot be read. The gate lets only `inline` run.
 * The front matter is read twice: line by line, for a block-style key, and as
 * YAML (`frontMatterMapping`), for the forms a line does not show: a flow mapping, JSON front matter, an escaped
 * key (`"\x63ontext"`), an explicit key (`? context`) and a merge key (`<<: *b`). A front matter that is not one
 * YAML mapping is `unknown`.
 */
export function ownSkillForm(name: string, root: string | null = ownPlugin()): SkillForm {
  if (root === null) return { form: "unknown", why: "the plugin's folder is not known to the hook (this program is not inside a plugin)" };
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return { form: "unknown", why: `${JSON.stringify(name)} is not the name of a skill folder` };
  const path = join(root, "skills", name, "SKILL.md");
  // Through the one reader (program-file.ts, item 4): a named pipe at the skill's path would hold the hook past its
  // timeout; only a regular file with one name is read.
  const got = readProgramFile("the skill", path);
  if (!got.ok) return { form: "unknown", why: got.code === "ENOENT" ? `${valueText(path)} does not exist` : got.problem };
  const text = got.value.toString("utf8");
  const front = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)?.[1];
  if (front === undefined) return { form: "unknown", why: `${valueText(path)} has no front matter the gate can read` };
  const key = /^[ \t]*["']?(context|agent)["']?[ \t]*:(.*)$/im.exec(front);
  if (key) return { form: "fork", why: `${valueText(path)} says ${key[1]}:${(key[2] ?? "").trimEnd()}` };
  const mapping = frontMatterMapping(front);
  if ("problem" in mapping) return { form: "unknown", why: `${valueText(path)}: its front matter ${mapping.problem}` };
  const named = Object.keys(mapping.value).find((k) => /^\s*(context|agent)\s*$/i.test(k));
  if (named !== undefined) return { form: "fork", why: `${valueText(path)} says ${valueText(named)}: ${JSON.stringify(mapping.value[named])} (its front matter read as YAML)` };
  return { form: "inline" };
}

/**
 * The front matter as the CLI's YAML parser (`yaml`, which derive.ts already uses) reads it, with `<<` merge keys
 * resolved, as some front-matter readers do. Loaded at the call through `createRequire` (the way schema-validate.ts
 * loads ajv), so the gate's other routes do not load it. Anything but one mapping, or an error or alias limit the
 * parser reports, is a problem: the gate cannot say what Claude Code would read there.
 */
function frontMatterMapping(front: string): { value: Record<string, unknown> } | { problem: string } {
  try {
    const { parseDocument } = createRequire(import.meta.url)("yaml") as typeof import("yaml");
    const doc = parseDocument(front, { merge: true });
    const error = doc.errors[0];
    if (error) return { problem: `is not YAML the gate can read (${error.message.split("\n")[0]})` };
    const value: unknown = doc.toJS({ maxAliasCount: 100 });
    if (typeof value !== "object" || value === null || Array.isArray(value)) return { problem: "is not one YAML mapping" };
    return { value: value as Record<string, unknown> };
  } catch (e) {
    return { problem: `could not be read as YAML (${valueText(messageOf(e))})` };
  }
}

export async function gateDelivery(ctx: HookContext): Promise<HookDecision> {
  const run = ctx.run;
  if (!run) return PASS;
  let ac: ActiveContext | null = null;
  try {
    ac = activeFor(ctx);
    if (!ac) return deliveryBeforeTheRun(ctx, run);
    return decideDelivery(ctx, ac);
  } catch (e) {
    recordHookFailure(run, ctx.input, { stage: "route", route: "launch-deliver", error: messageOf(e) }, ctx.now());
    return refuse(
      ctx,
      ac,
      "error",
      `the gate failed (${valueText(messageOf(e))}), so this ${String(ctx.input.tool_name)} call did not run. While a scan run is active a seat's instructions come only from its brief; if the gate keeps failing, report the failure to the person: ${personEndsText(run.launchDir)}.`,
    );
  }
}

function decideDelivery(ctx: HookContext, ac: ActiveContext): HookDecision {
  const tool = String(ctx.input.tool_name ?? "");
  const brief = `while scan run ${ac.marker.run_id} is active, a seat's instructions come only from its brief, which the program wrote, and its answer reaches the run only through the program's capture`;
  const ti = (ctx.input.tool_input && typeof ctx.input.tool_input === "object" ? ctx.input.tool_input : {}) as Record<string, unknown>;
  if (tool === "SendMessage") {
    const named = RECIPIENT_FIELDS.flatMap((f) => (ti[f] === undefined ? [] : [ti[f]]));
    const recorded = agentsRecorded(ac.run.launchDir, ac.run.eventsPath);
    const verdicts = named.map((v) => {
      if (typeof v !== "string") return "unreadable";
      const bare = v.trim().replace(/\s*\[[^\]]*\]$/, "");
      if (bare === "main") return "main";
      if (recorded.has(bare)) return "seat";
      return AGENT_ID_SHAPE.test(bare) ? "outside" : "name";
    });
    const kind = ti.type !== undefined && ti.type !== "message" ? "broadcast" : named.length === 0 ? "none" : verdicts.includes("seat") ? "seat" : verdicts.some((v) => v === "name" || v === "unreadable") ? "name" : "ok";
    if (kind === "ok") {
      // A message to the main session may reach it as a prompt; it carries no slash command.
      if (!verdicts.includes("main")) return PASS;
      const found = slashCommandCarried(ctx.input.tool_input);
      if (found === null) return PASS;
      return refuse(ctx, ac, "message", `while scan run ${ac.marker.run_id} is active, no message to "main" holds ${STOP_LIFT_COMMAND} or any other slash command (this call holds ${found}): ${SLASH_WHY} Send the message without a slash command; to send one with it, the scan run must end first, and ${personEndsText(ac.run.launchDir)}.`);
    }
    const to = named.map((v) => JSON.stringify(v)).join(" / ") || "no recipient";
    const what =
      kind === "seat"
        ? `${to} is a seat or agent this project's scan runs launched or saw. Wait for its answer: the program records it`
        : kind === "broadcast"
          ? `a message of type ${JSON.stringify(ti.type)} may reach more than one agent, seats included`
          : kind === "none"
            ? "the call names no recipient the gate can read"
            : `${to} is not the agent id of an agent outside the run, and the gate cannot tell which agent a name reaches (a seat's listing name is its agent id), so it is refused while the run is active. To message an agent that is not a seat of this run, use its agent id, or "main"`;
    return refuse(ctx, ac, "message", `no message is sent to a seat: ${brief}. ${what}. If a seat must be told something else, the run must end and the scan run again, and ${personEndsText(ac.run.launchDir)}.`);
  }
  if (tool === "Skill") {
    const skill = typeof ti.skill === "string" ? ti.skill : "";
    const prefix = `${HOOK_PLUGIN_NAME}:`;
    if (skill.startsWith(prefix)) {
      // The plugin's own skill runs only when its SKILL.md, read now, says it runs inline.
      const own = ownSkillForm(skill.slice(prefix.length));
      if (own.form === "inline") return PASS;
      return refuse(
        ctx,
        ac,
        "skill",
        `${JSON.stringify(skill)} is named as this plugin's skill, but ${own.form === "fork" ? `it does not run inline: ${own.why}` : `the gate cannot read how it runs: ${own.why}`}. Only this plugin's skills that run inline run in this session: ${brief}, and a skill that runs forked (context: fork) starts an agent of the type it names, one of this plugin's seats included, which the call does not show. To run it, the scan run must end first, and ${personEndsText(ac.run.launchDir)}.`,
      );
    }
    return refuse(
      ctx,
      ac,
      "skill",
      `only this plugin's own skills (${HOOK_PLUGIN_NAME}:...) that run inline run in this session: ${brief}, and a skill that runs forked (context: fork) starts an agent of the type it names, one of this plugin's seats included, which the call does not show. To run ${JSON.stringify(skill)}, the scan run must end first, and ${personEndsText(ac.run.launchDir)}.`,
    );
  }
  // Fix R2: a prompt scheduled for this session that holds the skill command would lift the stop when it fires.
  // Any slash command, read from the raw input (a bare string too: O3 of the re-check).
  if (SCHEDULING_TOOLS.includes(tool)) {
    const found = slashCommandCarried(ctx.input.tool_input);
    if (found === null) return PASS;
    return refuse(
      ctx,
      ac,
      "schedule",
      `while scan run ${ac.marker.run_id} is active, no prompt that holds ${STOP_LIFT_COMMAND} is scheduled for this conversation, nor one that holds any other slash command (this call holds ${found}): a scheduled prompt is submitted to this conversation when it fires. ${SLASH_WHY} Schedule the prompt without a slash command; to schedule one with it, the scan run must end first, and ${personEndsText(ac.run.launchDir)}.`,
    );
  }
  if (tool === "Workflow") {
    return refuse(
      ctx,
      ac,
      "workflow",
      `no workflow runs in this session: ${brief}, and a workflow's script starts agents of any type (its agent() takes an agentType from the same registry as the Agent tool), which the call does not show. Launch the launch list's entries with the Agent tool; to run a workflow, the scan run must end first, and ${personEndsText(ac.run.launchDir)}.`,
    );
  }
  return PASS;
}

// ------------------------------------------------------------------------------------------------
// THE BINDING: PostToolUse and PostToolUseFailure on Agent
// ------------------------------------------------------------------------------------------------

function appendEvent(run: RunPaths, e: LaunchEvent): void {
  makeFolder(dirname(run.eventsPath), { recursive: true });
  appendFileAt(run.eventsPath, line(e));
}

function reservationOfCall(ac: ActiveContext, toolUseId: unknown): { path: string; r: Reservation } | null {
  if (typeof toolUseId !== "string" || toolUseId === "") return null;
  const call = readJson<{ entry: string }>(join(ac.gp.calls, `${safe(toolUseId)}.json`));
  if (!call || typeof call.entry !== "string") return null;
  const path = join(ac.gp.reserved, `${safe(call.entry)}.json`);
  const r = readJson<Reservation>(path);
  return r && r.tool_use_id === toolUseId ? { path, r } : null;
}

function release(ac: ActiveContext, path: string, r: Reservation, why: string, now: Date): void {
  try {
    removeFile(path);
  } catch (e) {
    if (codeOf(e) !== "ENOENT") throw e;
  }
  appendFileAt(ac.gp.releases, line({ at: now.toISOString(), entry: r.entry, tool_use_id: r.tool_use_id, seat: r.seat ?? null, why }));
}

/**
 * WHICH RESERVATIONS THE GATE RELEASES AS STALE, without releasing any: the one predicate, read by the gate's
 * release below and by `launch-next` and the run-abort guard, which read the run and write nothing, so
 * that what they print is what the gate's next decision acts on. The events and the sightings are read only where a
 * reservation is old enough.
 */
function staleReservations(all: Reservation[], events: () => LaunchEvent[], sightings: () => SeatSighting[], now: Date, resumes: readonly number[] = []): Reservation[] {
  // LOST AT THE RESUME: a launch made before the run's conversation was resumed gets its result from the earlier process
  // or never, so it is released at once, whatever seat was seen (any seat seen before the resume ended with that process).
  const resumed = (r: Reservation): boolean => resumedAfter(resumes, Date.parse(r.reserved_at), now.getTime()) !== null;
  const pending = all.filter((r) => typeof r.seat !== "string" && (now.getTime() - Date.parse(r.reserved_at) >= STALE_RELEASE_MS || resumed(r)));
  if (pending.length === 0) return [];
  const kept = keptBySighting(all, events, sightings);
  return pending.filter((r) => resumed(r) || !kept(r));
}

/**
 * Whether the gate keeps a reservation rather than release it (`staleReservations`): a seat of its type that no launch
 * binds was seen since it was made, which may be its own launch's seat. A sighting is never withdrawn, and that seat's
 * stop does not withdraw it either, so a reservation kept for one is kept until it is bound or the run's conversation is
 * resumed.
 */
function keptBySighting(all: readonly Reservation[], events: () => LaunchEvent[], sightings: () => SeatSighting[]): (r: Reservation) => boolean {
  const bound = launchedSeats(events());
  for (const r of all) if (typeof r.seat === "string") bound.add(r.seat);
  const seats = sightings();
  return (r) => {
    const since = Date.parse(r.reserved_at);
    return seats.some((s) => s.agent_type === r.subagent_type && !bound.has(s.agent_id) && !(Date.parse(s.at) < since));
  };
}

/**
 * THE RESERVATIONS THE GATE WILL RELEASE, NOT YET DUE: unbound, younger than
 * STALE_RELEASE_MS, made after the last resume, and not kept for a seat seen since (`keptBySighting`). With the ones
 * `staleReservations` releases now, these are every reservation that falls due without anyone: a reservation kept
 * for a sighting never does, so nothing that waits on one is counted as coming due (`dueWithoutPerson`).
 */
function releasableReservations(all: Reservation[], events: () => LaunchEvent[], sightings: () => SeatSighting[], now: Date, resumes: readonly number[] = []): Reservation[] {
  const young = all.filter(
    (r) => typeof r.seat !== "string" && now.getTime() - Date.parse(r.reserved_at) < STALE_RELEASE_MS && resumedAfter(resumes, Date.parse(r.reserved_at), now.getTime()) === null,
  );
  if (young.length === 0) return [];
  const kept = keptBySighting(all, events, sightings);
  return young.filter((r) => !kept(r));
}

/**
 * A LAUNCH THAT GETS NO RESULT. The probe's recorded ruling (probe report, § Not established): the program
 * releases a reservation that gets no PostToolUse. The gate runs this before it decides each launch. A
 * reservation is released when it is still unbound STALE_RELEASE_MS after it was made - by then its launch
 * result has reached the binding or the result's hook was killed - and no seat of its type that no launch is
 * bound to has been seen since it was made: such a seat may be this launch's own, whose result hook failed
 * open, so the entry is kept rather than launched twice (the seat is counted as one with no listed launch).
 * `failed` is appended, as for any launch that bound no seat. The file is taken by one rename, so two gates
 * running at once release it once.
 */
function releaseStaleReservations(ac: ActiveContext, now: Date): string[] {
  const all = readJsonDir<Reservation>(ac.gp.reserved);
  const resumes = resumeTimes(ac.gp.resumes);
  const stale = staleReservations(all, () => readLaunchEvents(ac.run.eventsPath).events, () => readJsonDir<SeatSighting>(ac.gp.seats), now, resumes);
  const released: string[] = [];
  for (const r of stale) {
    const path = join(ac.gp.reserved, `${safe(r.entry)}.json`);
    const taken = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.released`;
    try {
      renamePath(path, taken);
    } catch (e) {
      if (codeOf(e) === "ENOENT") continue;
      throw e;
    }
    const got = readJson<Reservation>(taken);
    removeFile(taken);
    if (!got || got.tool_use_id !== r.tool_use_id || typeof got.seat === "string") {
      // Not the reservation judged stale (it was bound or replaced meanwhile): put it back unless another took its place.
      if (got) createOnce(path, line(got));
      continue;
    }
    const atResume = resumedAfter(resumes, Date.parse(r.reserved_at), now.getTime()) !== null;
    appendFileAt(
      ac.gp.releases,
      line({
        at: now.toISOString(),
        entry: r.entry,
        tool_use_id: r.tool_use_id,
        seat: null,
        why: atResume
          ? "no launch result came before the run's conversation was resumed after its Claude Code process ended, and the launch ended with that process (LOST AT THE RESUME)"
          : `no launch result came within ${STALE_RELEASE_MS / 1000} s of the reservation (the result hook's ${LAUNCH_RESULT_HOOK_TIMEOUT_S} s timeout and a ${STALE_RESERVATION_MARGIN_S} s margin), and no seat of type ${r.subagent_type} bound to no launch started since`,
        // The mark `launchesLostAtResume` reads, so the person's sentence counts this entry until it is launched again.
        ...(atResume ? { resumed: true } : {}),
      }),
    );
    appendEvent(ac.run, { entry: r.entry, event: "failed", at: now.toISOString() });
    released.push(r.entry);
  }
  return released;
}

/**
 * The launch result (probe fact (c); the same on 2.1.283, probe runs P1, P2, P4, P5): a background launch's
 * PostToolUse has `status: "async_launched"` and the seat's `agentId`, which is the `agent_id` of every event the seat
 * fires. That binds the reservation and appends `launched` with `seat`, which is how the capture finds the seat's
 * entry. The result's input is compared under the launch contract, so a launch without `run_in_background` binds an
 * entry that names it (a list written by an earlier version). A result with another status is bound too, and recorded as
 * the session running its agents in the foreground (`HOST_FOREGROUND_FILE`). A result without an agentId started no
 * seat: the reservation is released and `failed` appended, so a relaunch of the entry is not refused. A launch the
 * gate did not reserve (its PreToolUse failed open) is not bound: its seat is recorded as seen without a reservation.
 */
export async function bindLaunch(ctx: HookContext): Promise<HookDecision> {
  const ac = activeFor(ctx);
  if (!ac) return PASS;
  const now = ctx.now();
  const resp = (ctx.input.tool_response ?? {}) as Record<string, unknown>;
  const agentId = typeof resp.agentId === "string" && resp.agentId !== "" ? resp.agentId : null;
  const type = (ctx.input.tool_input as Record<string, unknown> | undefined)?.subagent_type;
  // A relay's launch result binds its record, never a seat's entry (the trial's condition 3).
  if (type === RELAY_AGENT_TYPE) {
    const rec = relayRecords(ac).find(({ r }) => r.tool_use_id === ctx.input.tool_use_id && r.seat === undefined && r.released_at === undefined);
    if (rec) {
      const next: RelayRecord = agentId
        ? { ...rec.r, seat: agentId, bound_at: now.toISOString() }
        : { ...rec.r, released_at: now.toISOString(), released_why: `the launch result carries no agentId (status ${JSON.stringify(resp.status ?? null)})` };
      replaceFile(rec.path, line(next));
    }
    return PASS;
  }
  const found = reservationOfCall(ac, ctx.input.tool_use_id);
  if (!found || typeof found.r.seat === "string") {
    if (agentId) sight(ac, agentId, typeof type === "string" ? type : "", found ? "PostToolUse:Agent" : "PostToolUse:Agent (no reservation)", now);
    return PASS;
  }
  const { path, r } = found;
  if (!agentId) {
    release(ac, path, r, `the launch result carries no agentId (status ${JSON.stringify(resp.status ?? null)})`, now);
    appendEvent(ac.run, { entry: r.entry, event: "failed", at: now.toISOString() });
    return PASS;
  }
  // The result's input was the PreToolUse input byte for byte in all 12 launches of the probe. One that
  // differs was changed after the gate let it through (another hook on Agent can rewrite an input), so
  // the seat is not the listed launch: the entry is released and the seat counts as unlisted.
  const listed = readJson<LaunchList>(ac.run.listPath)?.entries.find((e) => e.id === r.entry);
  if (!listed || !sameAgentInput(listed.agent_input as unknown as Record<string, unknown>, ctx.input.tool_input)) {
    release(ac, path, r, "the launched input is not the listed entry's agent_input", now);
    sight(ac, agentId, typeof type === "string" ? type : "", "PostToolUse:Agent (input not the listed one)", now);
    return PASS;
  }
  // Every launch the gate reserves is the background form, whose result arrives as the seat starts (probe
  // runs A-D, H, J-L on 2.1.281: within 0.01 s of its SubagentStart; P1, P2, P4, P5 on 2.1.283: at the same
  // millisecond), so the binding is there before the seat can answer.
  replaceFile(path, line({ ...r, seat: agentId, bound_at: now.toISOString() }));
  appendEvent(ac.run, { entry: r.entry, event: "launched", at: now.toISOString(), seat: agentId });
  sight(ac, agentId, r.subagent_type, "PostToolUse:Agent", now);
  // What the host did with the launch (the header): `async_launched` is the background form. Another status with an
  // agent id (probe run P3's `completed`) came after the seat had stopped, so this session runs its agents in the
  // foreground and the capture could not bind their answers in time: the first such result is recorded, and the gate
  // launches nothing more in this attempt (decideLaunch). A result that names no status says nothing either way.
  if (typeof resp.status === "string" && resp.status !== "async_launched") {
    createOnce(ac.gp.hostForeground, line({ at: now.toISOString(), attempt: ac.marker.attempt, entry: r.entry, seat: agentId, tool_use_id: ctx.input.tool_use_id ?? null, status: resp.status }));
  }
  return PASS;
}

/** A failed launch, where Claude Code reports one this way: the reservation is released and `failed` appended. */
export async function launchFailed(ctx: HookContext): Promise<HookDecision> {
  const ac = activeFor(ctx);
  if (!ac) return PASS;
  if ((ctx.input.tool_input as Record<string, unknown> | undefined)?.subagent_type === RELAY_AGENT_TYPE) {
    const rec = relayRecords(ac).find(({ r }) => r.tool_use_id === ctx.input.tool_use_id && r.seat === undefined && r.released_at === undefined);
    const error = typeof ctx.input.error === "string" ? ctx.input.error.slice(0, 200) : "no error text";
    if (rec) replaceFile(rec.path, line({ ...rec.r, released_at: ctx.now().toISOString(), released_why: `PostToolUseFailure: ${error}` } satisfies RelayRecord));
    return PASS;
  }
  const found = reservationOfCall(ac, ctx.input.tool_use_id);
  if (!found || typeof found.r.seat === "string") return PASS;
  const now = ctx.now();
  const error = typeof ctx.input.error === "string" ? ctx.input.error.slice(0, 200) : "no error text";
  release(ac, found.path, found.r, `PostToolUseFailure: ${error}`, now);
  appendEvent(ac.run, { entry: found.r.entry, event: "failed", at: now.toISOString() });
  return PASS;
}

// ------------------------------------------------------------------------------------------------
// U2: ONE AUTO-MODE DENIAL, THEN STOP AND EXPLAIN; A RUN IS CONTINUED IN ITS OWN CONVERSATION
// ------------------------------------------------------------------------------------------------

/** The run's record of each launch Claude Code's auto mode did not allow (PermissionDenied), under the run's gate directory. */
export const AUTO_MODE_DENIED_FILE = "auto-mode-denied.jsonl";
/**
 * The run's record of each time, after such a denial, the person typed the skill command in the run's main conversation:
 * a UserPromptExpansion of it (`expansionLiftsTheStop`). No prompt is recorded, and only a line that says it
 * came from that event lifts the stop (`autoModeStopOf`).
 */
export const PERSON_WROTE_FILE = "person-wrote.jsonl";

/** One launch of the run that Claude Code's auto mode did not allow, as the PermissionDenied hook saw it. */
export interface AutoModeDenial {
  at: string;
  session_id: string | null;
  tool_use_id: string | null;
  /** Who made the call: the main session ("main") or an agent (its agent_type). */
  caller: string;
  agent_id: string | null;
  subagent_type: string | null;
  description: string | null;
  /** The launch list's entry (or relay entry) whose input the call carried, where one did. */
  entry: string | null;
  deny_reason: string | null;
  /**
   * How far the review was when the stop came, in places (the person line's numbers, `runStatus`), for the
   * stop box's "Paused at N of M reviews done". Absent on a line written before it, or where the run's records did not read.
   */
  places?: { done: number; total: number };
}

/** The run's status as of `now`, counted as the person line counts it (an answer lost is not done), with the list and events it read; null where the records do not read. */
async function statusOfRun(ac: ActiveContext, now: Date): Promise<{ status: RunStatus; list: LaunchList; events: LaunchEvent[]; refuters: StandingRefuters } | null> {
  try {
    const read = readRunList(ac.run.listPath, ac.marker);
    if (!read.ok) return null;
    // The ledgers read once, as run-status reads them (index.ts `runStatusOf`): the relaunch rule's lost
    // entries and the refuter entries superseded come from the same read.
    const { readAnswerLedgers, relaunchable } = await import("./entry-answer.js");
    const ledgers = readAnswerLedgers(ac.run.legalDir, ac.run.launchDir, ac.marker.run_id, now);
    const lost = new Set(read.list.entries.filter((e) => relaunchable(ledgers, e.id).ok).map((e) => e.id));
    const superseded = new Set(ledgers.refuters.superseded.keys());
    const events = readLaunchEvents(ac.run.eventsPath).events;
    // The verdict records examined for refuters as their bytes are now (launch-later.ts `examines`).
    const { examinedRecords } = await import("./launch-later.js");
    const examined = examinedRecords(read.list, ac.run.legalDir);
    return { status: runStatus(read.list, events, now, 0, { lost, examined, superseded }), list: read.list, events, refuters: ledgers.refuters };
  } catch {
    return null;
  }
}

/** The run's places done and in all as of `now`, counted as the person line counts them (an answer lost is not done); null where the records do not read. */
async function placesOfRun(ac: ActiveContext, now: Date): Promise<{ done: number; total: number } | null> {
  const s = await statusOfRun(ac, now);
  return s === null ? null : { done: s.status.places_done, total: s.status.places_total };
}

// ------------------------------------------------------------------------------------------------ THE MESSAGE AT EACH TENTH OF THE REVIEW (the mock-up's screen 8; the parent's decisions of 2026-10-13)
// ------------------------------------------------------------------------------------------------

/** The run's record of each message at a tenth of the review the program sent, one line each, under the run's gate directory. */
export const TENTH_MESSAGES_FILE = "tenth-messages.jsonl";

/**
 * One message at a tenth of the review, as the program sent it. `sent_as` says how: the top-level `systemMessage` of the
 * output of the hook whose event is named, which Claude Code documents as shown to the person. That a seat's hook message
 * reaches the person's screen is not known to the program: this line records that it was SENT, and the next real run
 * records whether it was SHOWN.
 */
export interface TenthMessageLine {
  v: 1;
  at: string;
  run_id: string;
  attempt: string;
  /** Which tenth the review has reached (1 to 10): the places done times ten, divided by the places in all, rounded down. */
  tenth: number;
  places_done: number;
  places_total: number;
  /** The hook event whose output carried the message, and the seat whose return carried the review past the tenth. */
  event: string;
  agent_id: string | null;
  session_id: string | null;
  sent_as: "systemMessage";
  text: string;
}

/** Which tenth of the review `done` of `total` places is: 0 before the first tenth, 10 when every place is done. */
export const tenthOf = (done: number, total: number): number =>
  total > 0 && done > 0 && Number.isFinite(done) && Number.isFinite(total) ? Math.min(10, Math.floor((Math.min(done, total) * 10) / total)) : 0;

/** The tenths the run's record names as sent (lines that do not read are skipped). */
export function tenthsSent(path: string): number[] {
  if (!existsSync(path)) return [];
  const out: number[] = [];
  for (const raw of readRegularFile(path, "utf8").split("\n")) {
    if (raw.trim() === "") continue;
    try {
      const t = (JSON.parse(raw) as { tenth?: unknown }).tenth;
      if (typeof t === "number" && Number.isInteger(t)) out.push(t);
    } catch {
      /* a line that does not read names no tenth */
    }
  }
  return out;
}

/**
 * The answers given so far on the run's places: each place's latest adjudicator verdict, with a refuter's outcome laid
 * over it where one was given ("upheld" stays a possible issue, "overturned" is ruled out, "needs_human" is for the
 * person to decide - verdict.schema.json `refutation.outcome`). An
 * "overturned" whose second look found against the seat's claim or could not settle it is for the person to decide, as the
 * report places it (`lookLeavesOverturnToPerson`, the assembly's own test), never ruled out. Read from the records the
 * capture accepted for the seats named (the run's own: its launch events), in the order the capture accepted them. The
 * count runs no quote check, so a second look the assembly's quote check will invalidate is read here as it answered. No
 * severity is read: the
 * level a finding carries is composed at assembly and may differ from the rule's (the parent's decision 1).
 */
export interface AnswersSoFar {
  possible_issues: number;
  for_you_to_decide: number;
  ruled_out: number;
  /** The places that stand as possible issues, the latest answered first: the finding id and the place its answer names. */
  latest: { finding_id: string; place: string | null }[];
}

const REFUTER_OUTCOME_AS: Record<string, string> = { upheld: "violation_candidate", overturned: "not_applicable", needs_human: "needs_human" };

/** The first evidence row's place, `file:lines`, as the end of the run's screen names it (assemble-report.ts `endSummaryOf`). */
function evidencePlace(evidence: unknown): string | null {
  const e = Array.isArray(evidence) ? evidence.find((x): x is Record<string, unknown> => typeof x === "object" && x !== null) : undefined;
  if (!e || typeof e.file !== "string" || e.file === "") return null;
  return e.lines === undefined || e.lines === null || e.lines === "" ? e.file : `${e.file}:${String(e.lines)}`;
}

/**
 * A refuter's answer counts only where its entry stands (launch-list-file.ts
 * `standingRefuters`, the one way into that): a superseded refuter entry answers a verdict that no longer exists, so its
 * seat's accepted answer is not laid over the adjudicator's, as no reader of the report takes it either.
 * An answer the assembly sets aside as not usable is not laid over it either, and an overturn due a second look keeps the
 * first review's word until the look answers. Both are asked of the rule as the findings document carries it on the
 * candidate (`candidates`, by finding id), as the assembly asks them; a finding the document does not hold has no rule
 * that opts in, so its overturn on a location ground is set aside, as the assembly would set it aside.
 */
export function answersSoFar(legalDir: string, seats: ReadonlySet<string>, refuters: StandingRefuters, candidates: ReadonlyMap<string, unknown>): AnswersSoFar {
  const verdicts = new Map<string, { word: string; order: number; place: string | null }>();
  const refuted = new Map<string, string>();
  const looked = new Map<string, SecondLook>();
  // The findings whose ordinary overturn stands on a location ground, so a second look is due (standing.ts `locationOverturnStands`).
  const lookDue = new Set<string>();
  let order = 0;
  for (const l of readHookLedger(legalDir)) {
    if (l.outcome !== "accepted" || !seats.has(l.agent_id) || !l.record || (l.role !== "adjudicator" && l.role !== "refuter")) continue;
    if (l.role === "refuter" && (l.entry === null || !refuters.stands(l.entry))) continue;
    let items: unknown;
    try {
      items = JSON.parse(readRegularFile(join(legalDir, l.record.file), "utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      if (typeof it !== "object" || it === null) continue;
      const o = it as Record<string, unknown>;
      if (typeof o.finding_id !== "string") continue;
      if (l.role === "adjudicator" && typeof o.verdict === "string") verdicts.set(o.finding_id, { word: o.verdict, order: order++, place: evidencePlace(o.evidence) });
      // A second look moves a finding's placement, never its verdict word: not laid over it.
      if (l.role === "refuter" && o.mode !== "challenge" && typeof o.outcome === "string" && REFUTER_OUTCOME_AS[o.outcome] !== undefined) {
        // The assembly's own tests (assemble-report.ts, the one placement of a refutation's answer), asked of the same rule.
        const rule = candidates.get(o.finding_id);
        if (refutationUnusable(o, rule) !== null) {
          // Set aside: the first review's word stands, whatever second look the finding has.
          refuted.delete(o.finding_id);
          lookDue.delete(o.finding_id);
        } else {
          refuted.set(o.finding_id, REFUTER_OUTCOME_AS[o.outcome] as string);
          if (locationOverturnStands(o, rule)) lookDue.add(o.finding_id);
          else lookDue.delete(o.finding_id);
        }
      }
      // It is kept apart, read as the assembly reads it (`lookAnswerOf`).
      if (l.role === "refuter" && isChallengeRecord(o)) looked.set(o.finding_id, lookAnswerOf(o.outcome));
    }
  }
  const so: AnswersSoFar = { possible_issues: 0, for_you_to_decide: 0, ruled_out: 0, latest: [] };
  const issues: { finding_id: string; order: number; place: string | null }[] = [];
  for (const [id, v] of verdicts) {
    const ref = refuted.get(id);
    // The assembly's two-passes rule, through its own test. An overturn
    // due a second look takes the finding out of the count only once that look has answered: until then it keeps the first
    // review's word. An overturn set aside above never reaches here.
    const awaitingLook = ref === "not_applicable" && lookDue.has(id) && !looked.has(id);
    // A finding the first review ruled out whose second
    // look (a run with the second check) found the rule applies, or could not settle it, is the person's, as the assembly
    // places it (`placeDismissal`).
    const dismissedLeftToPerson = ref === undefined && v.word === "not_applicable" && lookLeavesOverturnToPerson(looked.get(id));
    const word = awaitingLook ? v.word : (ref === "not_applicable" && lookLeavesOverturnToPerson(looked.get(id))) || dismissedLeftToPerson ? "needs_human" : (ref ?? v.word);
    if (word === "violation_candidate") {
      so.possible_issues++;
      issues.push({ finding_id: id, order: v.order, place: v.place });
    } else if (word === "needs_human") so.for_you_to_decide++;
    else if (word === "not_applicable") so.ruled_out++;
  }
  so.latest = issues.sort((a, b) => b.order - a.order).map(({ finding_id, place }) => ({ finding_id, place }));
  return so;
}

/** How many possible issues the message names under "Latest" (the mock-up's three). */
export const LATEST_SHOWN = 3;

/**
 * THE MESSAGE AT A TENTH OF THE REVIEW. The person line (`runStatus` `person`: places
 * reviewed of all, the time, the time left), then "So far": the answers given on them, and "Latest": the short name of
 * the rule of each latest possible issue and its place, nothing more. No severity: the level a finding will carry is
 * composed at assembly and can differ from the rule's, so the message never states a level the report may change (the
 * parent's decision 1, 2026-10-13).
 */
export function tenthMessageText(person: string, so: Pick<AnswersSoFar, "possible_issues" | "for_you_to_decide" | "ruled_out">, latest: readonly { name: string; place: string | null }[]): string {
  const lines = [
    person,
    `  So far   ${grouped(so.possible_issues)} ${so.possible_issues === 1 ? "possible issue" : "possible issues"} · ${grouped(so.for_you_to_decide)} for you to decide · ${grouped(so.ruled_out)} ruled out`,
  ];
  latest.slice(0, LATEST_SHOWN).forEach((l, i) => {
    lines.push(`  ${i === 0 ? "Latest" : "      "}   ● ${l.name}`);
    if (l.place !== null) lines.push(`             ${l.place}`);
  });
  return lines.join("\n");
}

/** The findings document's candidates by finding id, as the message at a tenth of the review reads them; none where it does not read. */
export function findingsCandidates(findingsPath: string): Map<string, Record<string, unknown>> {
  try {
    const text = readRegularFile(findingsPath, "utf8");
    // A document changed after the scan is not read (log-digest.ts).
    if (findingsChangedProblem(findingsPath, text) !== null) return new Map();
    const doc = JSON.parse(text) as { candidates?: unknown };
    const list = Array.isArray(doc.candidates) ? doc.candidates.filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null) : [];
    return new Map(list.filter((c) => typeof c.finding_id === "string").map((c) => [c.finding_id as string, c] as const));
  } catch {
    return new Map();
  }
}

/**
 * The short name of each latest possible issue's rule and its place, for the message: the rule from findings.json's
 * candidate, its `short_name` from the rule bundle (`--bundle`'s order without the option: LEGAL_BUNDLE_DIR, else the
 * bundle shipped with this program), else the candidate's title up to " - ", as the report's plain name falls back
 * (assemble-report.ts `plainOf`); the place the answer names, else the candidate's first location. A finding id that
 * findings.json does not hold is left out. Both pass through the product's printed redaction, as the end screen's do.
 */
async function latestNamed(byId: ReadonlyMap<string, Record<string, unknown>>, latest: readonly { finding_id: string; place: string | null }[]): Promise<{ name: string; place: string | null }[]> {
  if (latest.length === 0 || byId.size === 0) return [];
  const shortNames = new Map<string, string>();
  // The names come from the bundle shipped with this program, opened and checked whole
  // (bundle.ts openShippedBundle): no byte the check did not see, and no bundle location from the project's environment.
  try {
    const { openShippedBundle } = await import("./bundle.js");
    for (const o of openShippedBundle("hook").rules as unknown as { id?: unknown; short_name?: unknown }[]) {
      if (typeof o?.id === "string" && typeof o.short_name === "string" && o.short_name.trim() !== "") shortNames.set(o.id, o.short_name.trim());
    }
  } catch {
    /* no bundle that opens: the candidate's title stands in */
  }
  const { productPrintedRedaction } = await import("./engine.js");
  const { redactPrintedText } = await import("./credential-redaction.js");
  const redaction = productPrintedRedaction();
  const out: { name: string; place: string | null }[] = [];
  for (const l of latest) {
    const c = byId.get(l.finding_id);
    if (!c) continue;
    const ruleId = typeof c.rule_id === "string" ? c.rule_id : "";
    const title = typeof c.title === "string" ? c.title : "";
    const name = shortNames.get(ruleId) || title.split(" - ")[0] || ruleId;
    if (name === "") continue;
    const loc = Array.isArray(c.locations) ? (c.locations.find((x) => typeof x === "object" && x !== null) as { file?: unknown; start_line?: unknown } | undefined) : undefined;
    const place = l.place ?? (loc && typeof loc.file === "string" ? `${loc.file}${typeof loc.start_line === "number" ? `:${loc.start_line}` : ""}` : null);
    out.push({ name: redactPrintedText(redaction, name), place: place === null ? null : redactPrintedText(redaction, place) });
  }
  return out;
}

/**
 * Where a seat's return of the active run carries the review past a tenth of its places not yet messaged, the text of
 * the message at that tenth, recorded as sent; else null. One message per tenth: the first return to reach it claims it
 * (a file created once), so two seats returning together never send it twice; a return that jumps several tenths sends
 * one message, at the tenth reached. Nothing is sent before the first tenth, or for a run whose records do not read.
 */
async function tenthMessageFor(ctx: HookContext): Promise<string | null> {
  const ac = activeFor(ctx);
  if (!ac) return null;
  const now = ctx.now();
  const read = await statusOfRun(ac, now);
  if (read === null || read.status.ended !== null) return null;
  const s = read.status;
  const tenth = tenthOf(s.places_done, s.places_total);
  if (tenth === 0 || tenthsSent(ac.gp.tenthMessages).some((t) => t >= tenth)) return null;
  if (!createOnce(join(ac.gp.tenthClaims, String(tenth)), line({ at: now.toISOString(), agent_id: ctx.input.agent_id ?? null }))) return null;
  const listed = new Set(read.list.entries.map((e) => e.id));
  const seats = new Set(read.events.filter((e) => e.event === "returned" && listed.has(e.entry) && typeof e.seat === "string").map((e) => e.seat as string));
  // One reading of the findings document for both: the rule each answer is asked of, and the names the message gives.
  const candidates = findingsCandidates(ac.run.findingsPath);
  const so = answersSoFar(ac.run.legalDir, seats, read.refuters, candidates);
  const text = tenthMessageText(s.person, so, await latestNamed(candidates, so.latest.slice(0, LATEST_SHOWN)));
  const record: TenthMessageLine = {
    v: 1,
    at: now.toISOString(),
    run_id: ac.marker.run_id,
    attempt: ac.marker.attempt,
    tenth,
    places_done: s.places_done,
    places_total: s.places_total,
    event: `${String(ctx.input.hook_event_name ?? "")}${typeof ctx.input.tool_name === "string" ? `:${ctx.input.tool_name}` : ""}`,
    agent_id: typeof ctx.input.agent_id === "string" ? ctx.input.agent_id : null,
    session_id: typeof ctx.input.session_id === "string" ? ctx.input.session_id : null,
    sent_as: "systemMessage",
    text,
  };
  makeFolder(ac.gp.runDir, { recursive: true });
  appendFileAt(ac.gp.tenthMessages, line(record));
  return text;
}

/**
 * The capture routes' decision, with the message at a tenth of the review where this return reached one.
 * Only a `pass` or a receipt carries it: a refusal or a block is about the seat's answer, and no place is done by it.
 * Never in the way of the capture: a failure here is recorded in the hook's failure log and the decision goes out as
 * it was.
 */
export async function withTenthMessage(ctx: HookContext, decision: HookDecision): Promise<HookDecision> {
  if (decision.kind !== "pass" && decision.kind !== "replace-input") return decision;
  try {
    const text = await tenthMessageFor(ctx);
    return text === null ? decision : { ...decision, systemMessage: text };
  } catch (e) {
    recordHookFailure(ctx.run, ctx.input, { stage: "tenth-message", error: e instanceof Error ? e.message : String(e) }, ctx.now());
    return decision;
  }
}

/**
 * THE RUN'S AUTO-MODE STOP. After the first launch of the
 * run that Claude Code's auto mode did not allow, the program launches nothing until the person has typed the skill
 * command in the main conversation (a UserPromptExpansion of it after the latest denial, `expansionLiftsTheStop`): every receipt, launch-next and the gate say so, and the
 * relay hands back. Nothing retries on its own: the hook never returns `retry`, and no relay launches again in the run,
 * since a relay's launches are judged as fully autonomous (research section 1, "Why relays matter").
 */
export interface AutoModeStop {
  first: AutoModeDenial;
  last: AutoModeDenial;
  count: number;
  /** When the person last typed the skill command after a denial (`expansionLiftsTheStop`), or null. */
  personAt: string | null;
  /** True until the person has typed the skill command in the main conversation after the latest denial. */
  inForce: boolean;
}

export function autoModeStopOf(launchDir: string, runId: string): AutoModeStop | null {
  const runDir = join(launchDir, GATE_DIR, safe(runId));
  const deniedPath = join(runDir, AUTO_MODE_DENIED_FILE);
  if (!existsSync(deniedPath)) return null;
  const denied = readJsonLines<AutoModeDenial>(deniedPath).filter((d) => d && typeof d.at === "string");
  const first = denied[0];
  const last = denied.at(-1);
  if (!first || !last) return null;
  // Only the expansion's line lifts; a line an earlier build wrote for a UserPromptSubmit does not.
  const person = readJsonLines<{ at?: unknown; via?: unknown }>(join(runDir, PERSON_WROTE_FILE)).filter((p) => p && typeof p.at === "string" && p.via === "UserPromptExpansion");
  const personAt = (person.at(-1)?.at as string | undefined) ?? null;
  const wrote = personAt !== null && Date.parse(personAt) > Date.parse(last.at);
  return { first, last, count: denied.length, personAt, inForce: !wrote };
}

/** What was not allowed, in plain words. */
function deniedWhat(d: AutoModeDenial): string {
  if (d.entry && d.description) return `entry ${d.entry} ("${d.description}")`;
  if (d.entry) return `entry ${d.entry}`;
  return d.subagent_type ? `an agent of type ${d.subagent_type}` : "an agent";
}

/** The fact of the stop, in neutral words (U2 item 1). */
function stopFact(s: AutoModeStop, runId: string): string {
  const reason = s.last.deny_reason ? ` (its reason: ${s.last.deny_reason.replace(/\s+/g, " ").slice(0, 200)})` : "";
  const more = s.count > 1 ? `; ${s.count} launches of scan run ${runId} have not been allowed in all` : "";
  return `Claude Code's auto mode did not allow the launch of ${deniedWhat(s.last)} at ${s.last.at}${reason}${more}`;
}

/**
 * What the person is told, in plain words: that the review is paused and why, that nothing retries and nothing is lost,
 * and the two things they can do (the mock-up's screen 9). Which part of
 * the review was refused, and the refusal's own reason, are the main session's and the ledger's (`stopFact`), not the
 * person's: they name the program's own machinery.
 */
export function personStopText(s: AutoModeStop, launchDir: string): string {
  // "at N of M reviews done", as the review stood when the stop came (recorded on the denial). The count is the person line's, candidates answered, so not
  // called places.
  const p = s.last.places;
  const at = p && Number.isSafeInteger(p.done) && Number.isSafeInteger(p.total) && p.total > 0 ? ` at ${p.done.toLocaleString("en-US")} of ${p.total.toLocaleString("en-US")} reviews done` : "";
  return [
    `■ Paused${at}: Claude Code's auto mode did not allow the next part of the review to start.`,
    "  Nothing is retried on its own; nothing is lost, and your answers are kept.",
    `  Go on   type ${STOP_LIFT_COMMAND} in this conversation (a message in other words keeps it paused)`,
    `  Stop    run in your own terminal, ${IN_BASH}: ${abortCommand(launchDir)}`,
  ].join("\n");
}

/**
 * The launch gate's bar under the stop, or null: in force until the person types the skill command in the run's session
 * (a UserPromptExpansion of it, `expansionLiftsTheStop`), which no call of the run's may schedule (fix
 * R2); for a relay, for the rest of the run.
 */
export function stopBar(host: LaunchHost): LaunchBar | null {
  const s = host.stop;
  if (!s) return null;
  const read = readActiveRun(host.launchDir);
  const runId = read.state === "active" ? read.marker.run_id : "?";
  if (s.inForce) {
    return {
      stage: "host",
      kind: "auto-mode",
      clears: "person",
      fixes: [],
      text:
        `${stopFact(s, runId)}. The program launches nothing more in scan run ${runId} until the person types ${STOP_LIFT_COMMAND} in the main conversation: ${WHAT_HOLDS} Nothing is retried on its own. ` +
        `The main session tells the person, in plain words: "${personStopText(s, host.launchDir)}" It then waits, and launches again only after the person has typed ${STOP_LIFT_COMMAND}: what launch-next prints, itself, with no relay.`,
    };
  }
  if (!host.forRelay) return null;
  return {
    stage: "host",
    kind: "auto-mode",
    clears: "person",
    fixes: [],
    text: `${stopFact(s, runId)}. Since then no relay launches in scan run ${runId}: the main session launches the rest itself, from what launch-next prints, after the person has typed ${STOP_LIFT_COMMAND}.`,
  };
}

/** A receipt's lines under the stop: no launch named, and what the relay does (U2 item 2). */
function stopLines(bar: LaunchBar, running: number): string[] {
  const then =
    running > 0
      ? `${running} listed seat(s) still running: a relay ends its turn, and the next seat's answer brings the next receipt.`
      : "No listed seat is running. HAND BACK NOW: a relay calls SubagentHandback with one short sentence.";
  return [`LAUNCHING STOPPED: ${bar.text} Launch nothing, not even an entry an earlier receipt named. ${then}`];
}

/**
 * PermissionDenied on Agent (U2 item 2): a launch of the run's session that Claude Code's auto mode did not allow is
 * recorded, the gate's reservation for it is released (no seat started), and the caller and the person are told. The
 * hook never returns `retry`: nothing is launched again on its own. Other sessions' denials and other tools pass.
 */
export async function onAutoModeDenied(ctx: HookContext): Promise<HookDecision> {
  const ac = activeFor(ctx);
  if (!ac) return PASS;
  const now = ctx.now();
  const ti = (ctx.input.tool_input && typeof ctx.input.tool_input === "object" ? ctx.input.tool_input : {}) as Record<string, unknown>;
  const toolUseId = typeof ctx.input.tool_use_id === "string" ? ctx.input.tool_use_id : null;
  let entry: string | null = null;
  const found = toolUseId ? reservationOfCall(ac, toolUseId) : null;
  if (found && typeof found.r.seat !== "string") {
    entry = found.r.entry;
    release(ac, found.path, found.r, `PermissionDenied: ${String(ctx.input.deny_reason ?? "auto mode").slice(0, 200)}`, now);
    appendEvent(ac.run, { entry: found.r.entry, event: "failed", at: now.toISOString() });
  }
  if (ti.subagent_type === RELAY_AGENT_TYPE) {
    const rec = relayRecords(ac).find(({ r }) => r.tool_use_id === toolUseId && r.seat === undefined && r.released_at === undefined);
    if (rec) {
      entry = rec.r.entry;
      replaceFile(rec.path, line({ ...rec.r, released_at: now.toISOString(), released_why: "PermissionDenied" } satisfies RelayRecord));
    }
  }
  const denial: AutoModeDenial = {
    at: now.toISOString(),
    session_id: typeof ctx.input.session_id === "string" ? ctx.input.session_id : null,
    tool_use_id: toolUseId,
    caller: ctx.who === "main" ? "main" : String(ctx.input.agent_type ?? ctx.who),
    agent_id: typeof ctx.input.agent_id === "string" ? ctx.input.agent_id : null,
    subagent_type: typeof ti.subagent_type === "string" ? ti.subagent_type : null,
    description: typeof ti.description === "string" ? ti.description.slice(0, 200) : null,
    entry,
    deny_reason: typeof ctx.input.deny_reason === "string" ? ctx.input.deny_reason.slice(0, 500) : null,
  };
  const places = await placesOfRun(ac, now);
  if (places) denial.places = places;
  makeFolder(ac.gp.runDir, { recursive: true });
  appendFileAt(ac.gp.autoModeDenied, line(denial));
  const stop = autoModeStopOf(ac.run.launchDir, ac.marker.run_id);
  if (!stop) return PASS;
  const person = personStopText(stop, ac.run.launchDir);
  const fact = stopFact(stop, ac.marker.run_id);
  const context =
    ctx.who === "main"
      ? `wolfboy: LAUNCHING STOPPED. ${fact}. The program launches nothing more in this run until the person types ${STOP_LIFT_COMMAND} in this conversation, and nothing is retried on its own. Launch nothing and run no command for the run now. Tell the person, in plain words: "${person}" Then wait for their reply. What lifts the stop is the person typing ${STOP_LIFT_COMMAND} in this conversation: ${WHAT_HOLDS} Never submit, schedule or send that command yourself. A reply in other words, a task notification or an agent's hand-back does not lift it; where they reply in other words, tell them the command again.`
      : `wolfboy: LAUNCHING STOPPED. ${fact}. Launch nothing more, not even an entry an earlier receipt named, and launch nothing again. End your turn while a listed seat you launched is running; once none is, call SubagentHandback with one short sentence: the program's line in its place tells the main session. Your hand-back does not lift the stop. What lifts it is the person typing ${STOP_LIFT_COMMAND} in the main conversation: ${WHAT_HOLDS}`;
  return { kind: "notify", context, systemMessage: `wolfboy: ${person}` };
}

/**
 * THE ONE EVENT THAT LIFTS THE STOP. UserPromptSubmit fires for whatever
 * Claude Code submits as a prompt in the session, and its input carries the prompt's text and nothing that says who wrote
 * it: by Claude Code's public hooks page (code.claude.com/docs/en/hooks, raw text read 2026-10-07) it also fires on "A
 * scheduled task firing, including a `/loop` iteration", "A background subagent reporting back to the session that
 * started it" and "A message another session sends to your main conversation", and a message from another session
 * "arrives as plain text" (the cross-session messaging page), so its text can begin with the command whoever wrote it.
 * A UserPromptSubmit therefore never lifts the stop, whatever its text (the plugin takes no UserPromptSubmit at all). The
 * stop lifts only on a UserPromptExpansion - which the page says "Runs when a user-typed command expands into a prompt
 * before reaching Claude" - whose `command_name` is exactly this plugin's skill (`expansionLiftsTheStop`). Every text
 * under the stop tells the person to type the command.
 *
 * WHO CAN RAISE THAT EVENT. The hook cannot tell
 * who typed a command. What the program holds to: from a scan's start in the session to the end of its run, a prompt
 * scheduled for the session (`SCHEDULING_TOOLS`) or a SendMessage to `main` that carries any slash command is refused,
 * whoever sends it (`slashCommandCarried`), and so is a Bash command that names Claude Code as a program, or the
 * plugin's session command (`startsClaudeCode`). What this does not reach: a prompt scheduled before the scan
 * started (the person's own loop or cron, which keeps firing into the run), if Claude Code expands a scheduled command
 * as it does a typed one, which the page does not say; and a second Claude Code process started by a command a text
 * check cannot read (one built when it runs, a script or alias written earlier, another program; limit S2). The
 * `command_name` a plugin's skill typed by the person carries is recorded on Claude Code 2.1.285:
 * `"command_name": "wolfboy:legal-scan"`, `"command_source": "plugin"`, `"expansion_type": "slash_command"`,
 * typed in full, and the same input where the person typed the short name `/legal-scan` and Claude Code's menu
 * completed it. A name without the prefix (another plugin's or the project's `legal-scan`) does not lift the stop.
 */
export const STOP_LIFT_COMMAND = `/${HOOK_PLUGIN_NAME}:legal-scan`;

/** What holds about the stop, said once to every model-facing text under it (what holds, not more). */
const WHAT_HOLDS = `only the person's typed command lifts it, as Claude Code reports a typed command to the plugin's hook (the expansion of ${STOP_LIFT_COMMAND}); a prompt that holds the command as text never does, whoever wrote it, because a message from another session or a scheduled prompt arrives as text the hook cannot tell from the person's. From the scan's start to the end of the run the plugin also refuses a scheduled prompt or a message to the main conversation that holds a slash command, and a command that may start Claude Code.`;

/**
 * Fix R2: the tools that schedule a prompt for the calling session, as the project's records name them.
 */
export const SCHEDULING_TOOLS: readonly string[] = ["ScheduleWakeup", "CronCreate"];

/**
 * Whether any text of a call's input, in any field at any depth, holds the skill command, in any letter case and after
 * compatibility normalisation (NFKC): every field is read because only ScheduleWakeup's field names are recorded - by
 * the probe an internal record (probe/runs/P1-fork-on/hooks.jsonl:32, PreToolUse: `delaySeconds`,
 * `reason`, `prompt`) - and CronCreate's by none, and a refusal is cheap where a
 * scheduled prompt only mentions the command. An input nested deeper than the gate reads holds it.
 */
export function holdsStopLiftCommand(value: unknown, depth = 0): boolean {
  if (typeof value === "string") return value.normalize("NFKC").toLowerCase().includes(STOP_LIFT_COMMAND.toLowerCase());
  if (!value || typeof value !== "object") return false;
  if (depth >= 32) return true;
  return Object.values(value as Record<string, unknown>).some((v) => holdsStopLiftCommand(v, depth + 1));
}

/**
 * THE CLASS. An earlier fix read a scheduled prompt for this plugin's command
 * only, and a message to the main session not at all. What Claude Code hands UserPromptSubmit for a slash command is not
 * recorded (O2): another command - the skill's short name, a project command, a `/loop` whose prompt is formed when it
 * fires - might reach the hook expanded into a text that begins with the command, and a SendMessage to `main` might
 * reach the session as a prompt. So from a scan's start in the session to the end of the run that follows it, no
 * prompt scheduled for the session (`SCHEDULING_TOOLS`) and no message to `main` carries any slash command, whoever
 * sends it. A slash command here is a `/` followed by a name that begins with a letter, at the start of a text or after
 * a space, a quotation mark or another character that does not continue a word or a path; a path (`/home/x/y`: the name
 * is followed by `/`) and a cron step (a `/` followed by a digit) are not one. It is looked for in every string
 * of the input at any depth (an input nested deeper than the gate reads counts as carrying one), in all of them joined,
 * and in each form the re-check tried: after compatibility normalisation (NFKC: a fullwidth solidus is `/`), with
 * invisible characters and combining marks taken out, and decoded from percent-encoding, HTML character references,
 * backslash escapes and base64, up to three layers deep. The text that holds this plugin's command anywhere is refused
 * as before (`holdsStopLiftCommand`). What no text check reaches: a prompt that asks the model, in words, to build a
 * command when it fires. The model can then submit it only through a call this gate reads again, or through a shell,
 * where the launch gate refuses a command that starts Claude Code (`startsClaudeCode`) and the rest is limit S2.
 */
export function slashCommandCarried(value: unknown): string | null {
  if (holdsStopLiftCommand(value)) return STOP_LIFT_COMMAND;
  const texts: string[] = [];
  let deep = false;
  const visit = (v: unknown, depth: number): void => {
    if (typeof v === "string") texts.push(v);
    else if (v && typeof v === "object") {
      if (depth >= 32) deep = true;
      else for (const x of Object.values(v as Record<string, unknown>)) visit(x, depth + 1);
    }
  };
  visit(value, 0);
  if (deep) return "an input nested deeper than the gate reads";
  for (const t of texts.length > 1 ? [...texts, texts.join("")] : texts) {
    const hit = slashCommandInText(t);
    if (hit !== null) return JSON.stringify(hit);
  }
  return null;
}

/** Why no slash command passes in the window (`slashCommandCarried`), for the refusals. */
const SLASH_WHY =
  "The hook cannot tell such a prompt from one the person typed, and a slash command submitted that way could lift the stop the program sets when Claude Code's auto mode does not allow a launch, or run a command whose prompt is formed only then. Whether the scan goes on is the person's to decide, by typing the command themselves.";

const SLASH_COMMAND = /(?:^|[^\p{L}\p{N}_.\/:~\\-])(\/[\p{L}_][\p{L}\p{N}_.:-]*)(?![\p{L}\p{N}_.:\/-])/u;
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{M}]/gu;
const ENTITY_NAMES: Record<string, string> = { sol: "/", colon: ":", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };

/** The first slash command in one text, in any of the forms `slashCommandCarried` names, or null. */
function slashCommandInText(text: string): string | null {
  const seen = new Set<string>();
  let layer = [text];
  for (let round = 0; round <= 3 && layer.length > 0; round++) {
    const next: string[] = [];
    for (const t of layer) {
      if (seen.has(t) || seen.size >= 64) continue;
      seen.add(t);
      const plain = t.normalize("NFKC").replace(INVISIBLE, "");
      const m = SLASH_COMMAND.exec(plain);
      if (m) return (m[1] ?? "").slice(0, 80);
      if (round < 3) next.push(...decodedForms(plain));
    }
    layer = next;
  }
  return null;
}

const codePoint = (n: number): string => (Number.isInteger(n) && n >= 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "");

/** One text decoded each way the re-check encoded the command (`slashCommandCarried`); a form that changes nothing is left out. */
function decodedForms(t: string): string[] {
  const out: string[] = [];
  if (/%[0-9a-f]{2}/i.test(t)) {
    let d: string;
    try {
      d = decodeURIComponent(t);
    } catch {
      d = t.replace(/%([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
    }
    out.push(d);
  }
  if (/&#|&[a-z]+;/i.test(t)) {
    out.push(t.replace(/&#x([0-9a-f]{1,6});?|&#([0-9]{1,7});?|&([a-z]+);/gi, (m, hex?: string, dec?: string, name?: string) => (hex ? codePoint(parseInt(hex, 16)) : dec ? codePoint(parseInt(dec, 10)) : (ENTITY_NAMES[(name ?? "").toLowerCase()] ?? m))));
  }
  if (t.includes("\\")) {
    out.push(
      t.replace(/\\u\{([0-9a-f]{1,6})\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})|\\([0-7]{1,3})|\\([/:])/gi, (_, a?: string, b?: string, c?: string, o?: string, ch?: string) =>
        ch ?? codePoint(parseInt(a ?? b ?? c ?? o ?? "", o !== undefined ? 8 : 16)),
      ),
    );
  }
  for (const run of t.match(/[A-Za-z0-9+/_-]{8,}={0,2}/g) ?? []) {
    const bytes = Buffer.from(run, "base64");
    const d = bytes.toString("utf8");
    if (bytes.length >= 2 && Buffer.from(d, "utf8").equals(bytes) && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(d)) out.push(d);
  }
  return out.filter((d) => d !== t);
}

/** Whether a SendMessage input names `main` as its recipient, or names none the gate can read. */
function sendsToMainOrUnread(input: unknown): boolean {
  if (!input || typeof input !== "object") return true;
  const named = RECIPIENT_FIELDS.flatMap((f) => ((input as Record<string, unknown>)[f] === undefined ? [] : [(input as Record<string, unknown>)[f]]));
  if (named.length === 0 || named.some((v) => typeof v !== "string")) return true;
  return named.some((v) => (v as string).trim().replace(/\s*\[[^\]]*\]$/, "") === "main");
}

/**
 * Before the run's marker stands: from a scan's start in the session to the end of the run that
 * follows it - the window the write guard keeps for the declaration's files (hook-question.ts `declarationUnderWay`: the
 * declaration ledger's last `scan-started` or round line later than the last run's end, naming this session) - a
 * scheduled prompt, or a message to `main` (or to no recipient the gate can read), that carries a slash command is
 * refused (`slashCommandCarried`). Nothing else is gated before the marker stands.
 */
function deliveryBeforeTheRun(ctx: HookContext, run: RunPaths): HookDecision {
  const tool = String(ctx.input.tool_name ?? "");
  const raw = ctx.input.tool_input;
  if (!SCHEDULING_TOOLS.includes(tool) && !(tool === "SendMessage" && sendsToMainOrUnread(raw))) return PASS;
  const sid = typeof ctx.input.session_id === "string" && ctx.input.session_id !== "" ? ctx.input.session_id : null;
  if (!declarationUnderWay(run.launchDir, sid, latestRunEndAt(run.launchDir), true)) return PASS;
  const found = slashCommandCarried(raw);
  if (found === null) return PASS;
  return refuse(
    ctx,
    null,
    tool === "SendMessage" ? "message" : "schedule",
    `while a compliance scan is under way in this conversation (from the scan's start to the end of the run that follows it), no prompt scheduled for this conversation and no message to "main" holds ${STOP_LIFT_COMMAND} or any other slash command (this call holds ${found}): such a prompt or message is submitted to this conversation. ${SLASH_WHY} Write it without a slash command. ${windowCloses(run.launchDir)}`,
  );
}

/**
 * A SECOND CLAUDE CODE PROCESS. One Bash call of the run's
 * session - `claude --resume <id> -p "<prompt>"`, or this plugin's own `legal-scan session -- --resume <id>` - starts a
 * second Claude Code process on the run's conversation. Claude Code keeps the session id on `--resume <id>`, so a prompt that process submits is the run's, and the hook cannot tell
 * it from one the person typed. From the scan's start in the session to the end of the run that follows it - the window
 * of the scheduling guard (`deliveryBeforeTheRun`) (a process started before the marker can run into the
 * run) - and while the run's marker stands, the launch gate refuses a Bash command, whoever runs it, that NAMES CLAUDE
 * CODE AS A PROGRAM, read as
 * written and again with every quotation mark and backslash taken out (`cl'a'ude`), in any letter case:
 * - a word whose last path part is the program's name: `claude`, or `claude` with an extension a program or its script
 *   carries (`.exe`, `.cmd`, `.bat`, `.com`, `.ps1`, `.sh`, `.js`, `.cjs`, `.mjs`). The words part at blanks, the
 *   shell's operators, quotation marks and `=` (`P=/x/claude`); a backslash parts a path as `/` does
 *   (`D:\tools\bin\claude.exe`); a brace form counts each of its alternatives (`{claude,}`);
 * - the program where Claude Code's native installer keeps it, a path ending `claude/versions/<version>` (Claude Code
 *   2.1.291 installed: `~/.local/bin/claude` is a link to `~/.local/share/claude/versions/2.1.291`): V1 refused it, and its last part is a
 *   version number, so the name alone would let it through;
 * - Claude Code's npm package, the path parts `@anthropic-ai/claude-code` at any version
 *   (`npx @anthropic-ai/claude-code@latest`, `node <prefix>/node_modules/@anthropic-ai/claude-code/cli.js`);
 * - the plugin's CLI (`legal-scan`, or an `index.js`) with the word `session` after it in the same command.
 * NEVER THE LETTERS INSIDE ANOTHER WORD OR PATH PART. An earlier version refused every command that held the letters
 * `claude` anywhere, less the words that were a path to this plugin's launcher. Claude Code puts its name in the paths it
 * hands the model, so that rule refused the product's own steps: an installed
 * plugin's root (`~/.claude/plugins/cache/...`), which the model of every recorded run named in a variable
 * (`P=<root>; $P/bin/legal-scan ...`); Claude Code's session scratch folder (`/tmp/claude-<uid>/...`), where
 * the recorded models sent a step's output; and a repository under `.claude/worktrees/`, the launch directory of the
 * CLI's own told commands. Those paths pass now, and the exemption for a path to the launcher went with the rule it
 * served (nothing else used it).
 * WHAT THIS CHECK LETS THROUGH THAT V1 REFUSED, exactly: every word that
 * holds the letters `claude` in any case and meets none of the three tests above - the product's own paths, Claude Code's own instruction file,
 * `~/.claude/...`, `$CLAUDE_PROJECT_DIR`, `@anthropic-ai/claude-agent-sdk`; a program or script whose own name holds the
 * letters anywhere but is not the program's name (`claude-<something>`, `myclaude`, `run-claude.sh`); `claude` with an
 * extension outside the nine (`claude.py`, `claude.exe.old`); and Claude Code's package written otherwise than as the
 * path parts `@anthropic-ai/claude-code` (`anthropic-ai-claude-code-<v>.tgz`, an install, which starts nothing). Each is
 * a program run by another name or a word that is no program, the kind S2 leaves to the person ("a copy of the program
 * under another name"). WHAT IT REFUSES THAT V1'S EXEMPTION PASSED: a path to this plugin's launcher in which a brace
 * alternative or a path part names the program (`${CLAUDE}/bin/legal-scan`, a launcher kept under
 * `.../@anthropic-ai/claude-code/...`); none of the 197 recorded commands holds one, and no product step writes one.
 * WHAT IT STILL REFUSES THAT DOES NOT START CLAUDE CODE (the safe side): a command that holds `claude` as a word of its
 * own - a `git commit` whose trailer reads `Co-Authored-By: Claude ...`, `grep -rn claude src`, `which claude`, `echo
 * claude` - or names the package (`npm i -g @anthropic-ai/claude-code`). The refusal says what happened, why, and what
 * to do: write the command without that word, or run it after the window closes - when the run ends (the assembly, or
 * `legal-scan run-abort`), or, where the scan has not reached a run, when `legal-scan run-abort` ends the scan
 * (`recordDeclarationScanClosed`, hook-question.ts).
 * WHAT A TEXT CHECK ON BASH CANNOT CATCH: a name built when the command runs (`c=cla; ${c}ude`, `$'\x63laude'`,
 * `eval "$(echo ... | base64 -d)"`); a script, alias, function or link written earlier and run by another name; a copy of
 * the program under another name; another program that starts it (an interpreter's `os.system`, `tmux`, `at`,
 * `systemd-run`, cron, or a wrapper program whose own name merely begins with the letters, `claude-<something>`, which
 * V1 refused and this check does not); and a process the person starts in a terminal of their own, which is theirs to
 * start. The CLI's `session` command also refuses to start inside a Claude Code session (index.ts, `claudeCodeSigns`),
 * unless its environment is cleared.
 */
const SESSION_COMMAND = /(?:^|[\s;&|()<>`'"=/])((?:legal-scan|index\.js)["']?\s(?:[^;&|\n]*?\s)?["']?session)(?=$|[\s;&|()<>`'"])/u;
/** Where a shell command's words part (kept by `split`, so the words are its even items); no letter is one of them, and no backslash (a Windows path's separator, read below). */
const SHELL_WORD_GAPS = /([\s;&|()<>`'"=]+)/u;
/** Where a word's brace alternatives part (`{claude,}` is the program's name once bash expands it). */
const BRACE_PARTS = /[{},]/u;
/** Claude Code's program name as a path's last part, with or without an extension a program or its script carries. */
const PROGRAM_NAME = /^claude(?:\.(?:exe|cmd|bat|com|ps1|sh|js|cjs|mjs))?$/u;
/** The path part after `@anthropic-ai` that names Claude Code's npm package, at a version or not. */
const PACKAGE_PART = /^claude-code(?:@.*)?$/u;

/** Whether one word of a command names Claude Code as a program (above): each brace alternative, a backslash read as `/`. */
function namesTheProgram(word: string): boolean {
  for (const alternative of word.split(BRACE_PARTS)) {
    const parts = alternative.replace(/\\/g, "/").toLowerCase().split("/");
    const last = parts.length - 1;
    if (PROGRAM_NAME.test(parts[last] ?? "")) return true;
    if (last >= 2 && parts[last] !== "" && parts[last - 1] === "versions" && parts[last - 2] === "claude") return true;
    for (let i = 0; i < last; i++) if (parts[i] === "@anthropic-ai" && PACKAGE_PART.test(parts[i + 1] ?? "")) return true;
  }
  return false;
}

/** What a Bash command holds that names Claude Code as a program or runs the plugin's session command (above), or null. */
export function startsClaudeCode(command: unknown): string | null {
  if (typeof command !== "string") return null;
  for (const text of [command, command.replace(/["'\\]/g, "")]) {
    const named = text
      .split(SHELL_WORD_GAPS)
      .filter((_, i) => i % 2 === 0)
      .find(namesTheProgram);
    if (named !== undefined) return JSON.stringify(named.slice(0, 80));
    const hit = SESSION_COMMAND.exec(text);
    if (hit) return JSON.stringify((hit[1] ?? "").slice(0, 80));
  }
  return null;
}

/** Why a command that names the program is refused (`startsClaudeCode`), said once to both refusals. */
const SHELL_WHY = (found: string) =>
  `no command run from this conversation may start Claude Code or this plugin's session command, so none may name the program: claude as a word of its own or as the last part of a path (also with .exe, .cmd, .ps1, .js or a like ending), the path where Claude Code's installer keeps it (claude/versions/<version>), or its package @anthropic-ai/claude-code (this one holds ${found}). A second Claude Code process on this conversation (claude --resume <id>) submits prompts to it that the hook cannot tell from the person's own, and one of them could lift the stop the program sets when Claude Code's auto mode does not allow a launch. A path that only holds the letters (~/.claude/..., Claude Code's temporary folder) is not refused. Write the command without that word (a commit, for example, without a trailer that names Claude), or run it after the window closes.`;

/**
 * When the window of the two checks before the run closes: at a run's end, or,
 * where the scan has not reached a run, at the `scan-closed` line `legal-scan run-abort` writes (`declarationUnderWay`
 * with `scanClosedEnds`). Said once to both refusals before the run, with run-abort as a person types it, in full, as the
 * in-run refusal gives it (`abortCommand`). Before a run, run-abort closes this window and no more: the
 * scan is not withdrawn, and its pre-launch step can still take it to a run.
 */
const windowCloses = (launchDir: string): string =>
  `The window closes when the run ends (the assembly, or run-abort), or, where the scan has not reached a run, when run-abort closes it (the scan itself is not withdrawn: its pre-launch step can still take it to a run). Run-abort, typed in full, ${IN_BASH}: ${abortCommand(launchDir)}. Another Claude Code conversation is not affected.`;

/**
 * V2: the Bash check before the run's marker stands, in the window the scheduling guard keeps
 * (`deliveryBeforeTheRun`: from a scan's start in this session to the end of the run that follows it). A process started
 * in that window - `(sleep 900; claude --resume <id> -p ...) &`, or a call run in the background - can run into the run.
 */
function shellBeforeTheRun(ctx: HookContext, run: RunPaths, command: unknown): HookDecision {
  const sid = typeof ctx.input.session_id === "string" && ctx.input.session_id !== "" ? ctx.input.session_id : null;
  if (!declarationUnderWay(run.launchDir, sid, latestRunEndAt(run.launchDir), true)) return PASS;
  const found = startsClaudeCode(command);
  if (found === null) return PASS;
  return refuse(
    ctx,
    null,
    "second-session",
    `while a compliance scan is under way in this conversation (from the scan's start to the end of the run that follows it), ${SHELL_WHY(found)} ${windowCloses(run.launchDir)}`,
  );
}

/** PreToolUse on Bash, from the scan's start and while the run's marker stands (`startsClaudeCode`). */
export async function gateShell(ctx: HookContext): Promise<HookDecision> {
  const run = ctx.run;
  if (!run) return PASS;
  let ac: ActiveContext | null = null;
  try {
    ac = activeFor(ctx);
    const ti = ctx.input.tool_input;
    const command = ti && typeof ti === "object" ? (ti as Record<string, unknown>).command : undefined;
    if (!ac) return shellBeforeTheRun(ctx, run, command);
    const found = startsClaudeCode(command);
    if (found === null) return PASS;
    return refuse(
      ctx,
      ac,
      "second-session",
      `while scan run ${ac.marker.run_id} is active, ${SHELL_WHY(found)} Whether the scan goes on is the person's to decide, by typing ${STOP_LIFT_COMMAND} in this conversation. To run the command, the scan run must end first, and ${personEndsText(ac.run.launchDir)}.`,
    );
  } catch (e) {
    recordHookFailure(run, ctx.input, { stage: "route", route: "launch-shell", error: messageOf(e) }, ctx.now());
    return refuse(ctx, ac, "error", `the gate failed (${valueText(messageOf(e))}), so this Bash call did not run. If the gate keeps failing, report the failure to the person: ${personEndsText(run.launchDir)}.`);
  }
}

/**
 * THE TYPED COMMAND AS AN EXPANSION. Claude Code's public hooks
 * page (code.claude.com/docs/en/hooks, raw text read 2026-10-07; never the binary) says a `UserPromptExpansion` "Runs
 * when a user-typed command expands into a prompt before reaching Claude", and: "UserPromptExpansion hooks receive
 * `expansion_type`, `command_name`, `command_args`, `command_source`, and the original `prompt` string. The
 * `expansion_type` field is `slash_command` for skill and custom commands, or `mcp_prompt` for MCP server prompts"; its
 * example input holds `"command_name": "example-skill"`, `"command_args": "arg1 arg2"`, `"command_source": "plugin"` and
 * `"prompt": "/example-skill arg1 arg2"` (what the person typed, not the skill's expanded text). The stop lifts only on
 * this event (V3: a UserPromptSubmit never lifts it, above), where `command_name` is exactly this plugin's skill,
 * `wolfboy:legal-scan` (a leading `/` allowed). Not the short name `legal-scan`, which a skill of another plugin
 * or of the project may carry; not another letter case, width or spelling; and nothing is read from `prompt` or
 * `command_source`. The guards: only while the run's marker stands, in the run's own conversation, after a denial, from
 * the main session; and from the scan's start the calls that could raise a command in this conversation are refused
 * (`slashCommandCarried`, `startsClaudeCode`). The page's example names a plugin's command without a plugin prefix; on
 * Claude Code 2.1.285 this plugin's skill arrives with it:
 * `"command_name": "wolfboy:legal-scan"`, `"command_source": "plugin"`, `"expansion_type": "slash_command"`,
 * whether the person typed it in full or typed `/legal-scan` and the menu completed it. The exact name is kept: a name
 * without the prefix (another plugin's or the project's `legal-scan`) never lifts the stop.
 */
export function expansionLiftsTheStop(input: HookInput): boolean {
  const name = input.command_name;
  return typeof name === "string" && (name === STOP_LIFT_COMMAND || name === STOP_LIFT_COMMAND.slice(1));
}

/** UserPromptExpansion in the run's session (above): after a denial, the person's typed skill command lifts the stop. Records only. */
export async function onPersonExpanded(ctx: HookContext): Promise<HookDecision> {
  const ac = activeFor(ctx);
  if (!ac || !existsSync(ac.gp.autoModeDenied)) return PASS;
  if (!expansionLiftsTheStop(ctx.input)) return PASS;
  appendFileAt(ac.gp.personWrote, line({ at: ctx.now().toISOString(), session_id: ctx.input.session_id ?? null, prompt: STOP_LIFT_COMMAND, via: "UserPromptExpansion" }));
  return PASS;
}

/**
 * The command that continues a run's own conversation (U2 item 3): `legal-scan session -- --resume <id>`. Claude Code keeps
 * the session id on `--resume <id>` without `--fork-session`, so
 * the hooks bind its launches to the run. Never `--continue`, which takes the folder's most recent conversation.
 */
export function resumeCommand(sessionId: string): string {
  return scannerCommand(["session", "--", "--resume", sessionId]);
}

/** Why nothing of the run is launched in this conversation, and the command that continues the run's own (U2 item 3). */
export function otherConversationText(marker: Pick<ActiveRunMarker, "run_id" | "session_id" | "launch_dir">, own: string | null): string {
  return (
    `scan run ${valueText(marker.run_id)} is active in this folder and belongs to Claude Code conversation ${valueText(String(marker.session_id))}, not to this one${own ? ` (${own})` : ""}. ` +
    "A seat launched here is not bound to the run: its answer is kept unbound and never reaches the report, so nothing of the run is launched in this conversation. " +
    `Tell the person: to continue the run, end this conversation and continue the run's own from their own terminal, in this folder, ${IN_BASH}, with ${resumeCommand(String(marker.session_id))} ` +
    `(not --continue, which takes the folder's most recent conversation). To end the run instead, from their own terminal, ${IN_BASH}: ${abortCommand(marker.launch_dir)}`
  );
}

/** The gate's refusal of a launch of this plugin's seats or relay in a session other than the one the run's marker names. */
function otherConversationRefusal(ctx: HookContext): HookDecision | null {
  const run = ctx.run;
  if (!run) return null;
  const ti = ctx.input.tool_input as Record<string, unknown> | undefined;
  const type = typeof ti?.subagent_type === "string" ? ti.subagent_type : "";
  if (!SEAT_AGENT_TYPES.includes(type) && type !== RELAY_AGENT_TYPE) return null;
  const read = readActiveRun(run.launchDir);
  if (read.state !== "active" || read.marker.session_id === null) return null;
  const sid = typeof ctx.input.session_id === "string" ? ctx.input.session_id : "";
  if (sid === "" || sid === read.marker.session_id) return null;
  return { kind: "deny", reason: `wolfboy launch gate: ${otherConversationText(read.marker, sid)}` };
}

// ------------------------------------------------------------------------------------------------
// SEATS THE RUN SEES: SubagentStart, a seat's own PreToolUse, SubagentStop
// ------------------------------------------------------------------------------------------------

function sight(ac: ActiveContext, agentId: string, agentType: string, via: string, now: Date): boolean {
  // The relay is never a seat of the run, so its launch result records no sighting.
  if (agentType === RELAY_AGENT_TYPE) return false;
  const s: SeatSighting = { agent_id: agentId, agent_type: agentType, plugin_seat: SEAT_AGENT_TYPES.includes(agentType), via, at: now.toISOString() };
  return createOnce(join(ac.gp.seats, `${safe(agentId)}.json`), line(s));
}

/**
 * The first event that shows a seat records it (SubagentStart normally; the seat's own PreToolUse or its
 * stop where the start hook failed open). Nothing is decided here and nothing is ever refused. A plugin
 * seat that starts in a session with no active run is written to `seats-outside-run.jsonl` instead, where
 * the project has a `.legal` directory (the plumbing's rule: a hook never creates `.legal`).
 */
export async function seatSeen(ctx: HookContext): Promise<HookDecision> {
  const agentId = ctx.input.agent_id;
  if (typeof agentId !== "string" || agentId === "") return PASS;
  const type = typeof ctx.input.agent_type === "string" ? ctx.input.agent_type : "";
  const via = `${ctx.input.hook_event_name}${ctx.input.tool_name ? `:${ctx.input.tool_name}` : ""}`;
  const ac = activeFor(ctx);
  if (ac) {
    sight(ac, agentId, type, via, ctx.now());
    return PASS;
  }
  if (ctx.input.hook_event_name === "SubagentStart" && ctx.who === "seat" && ctx.run && existsSync(ctx.run.legalDir)) {
    makeFolder(ctx.run.launchDir, { recursive: true });
    appendFileAt(join(ctx.run.launchDir, OUTSIDE_RUN_SEATS_FILE), line({ at: ctx.now().toISOString(), session_id: ctx.input.session_id ?? null, agent_id: agentId, agent_type: type }));
  }
  return PASS;
}

/** A seat's stop, when no earlier route kept it from stopping (`prior` is then a block). Frees its place. */
export async function seatStopped(ctx: HookContext, prior: HookDecision): Promise<HookDecision> {
  if (prior.kind === "block") return PASS;
  const agentId = ctx.input.agent_id;
  if (typeof agentId !== "string" || agentId === "") return PASS;
  const ac = activeFor(ctx);
  if (!ac) return PASS;
  const now = ctx.now();
  sight(ac, agentId, typeof ctx.input.agent_type === "string" ? ctx.input.agent_type : "", "SubagentStop", now);
  createOnce(join(ac.gp.stopped, `${safe(agentId)}.json`), line({ agent_id: agentId, at: now.toISOString() }));
  return PASS;
}

// ------------------------------------------------------------------------------------------------
// SessionStart: the session id, for the marker
// ------------------------------------------------------------------------------------------------

/** The SessionStart `source` Claude Code sets for `--resume`, `--continue` and `/resume` (LOST AT THE RESUME). */
export const RESUME_SOURCE = "resume";

/**
 * LOST AT THE RESUME (RESUMES_FILE): where the active run's marker names this session and the session starts
 * again by a resume, one line is appended to the run folder's resumes.jsonl; from then on what the earlier process ran
 * holds no place and its entries are launched again. Records only; a marker that cannot be read records nothing.
 */
function recordResume(ctx: HookContext): void {
  if (ctx.input.source !== RESUME_SOURCE) return;
  let ac: ActiveContext | null;
  try {
    ac = activeFor(ctx);
  } catch {
    return;
  }
  if (!ac) return;
  try {
    makeFolder(ac.gp.runDir, { recursive: true });
    const at = ctx.now().toISOString();
    appendFileAt(ac.gp.resumes, line({ at, session_id: ctx.input.session_id ?? null, source: RESUME_SOURCE, attempt: ac.marker.attempt }));
    // Every relay record still open was
    // let through before this resume, so its relay ended with the earlier process; it is marked so (`lost_at`).
    for (const { path, r } of relayRecords(ac)) if (r.ended_at === undefined && r.released_at === undefined && r.lost_at === undefined) replaceFile(path, line({ ...r, lost_at: at } satisfies RelayRecord));
  } catch (e) {
    // The session's export below still runs; the failure is recorded where every route's is.
    recordHookFailure(ctx.run, ctx.input, { stage: "route", route: "launch-session", error: `the resume was not recorded: ${valueText(messageOf(e))}` }, ctx.now());
  }
}

/**
 * Exports the session id, the project folder and the scan launch profile's verdict (the session's own
 * environment checked, scan-profile.ts) into the session's Bash through `CLAUDE_ENV_FILE` (probe fact (g): a variable
 * a SessionStart hook writes there is set in the main session's Bash, also after `cd`). The scan and the pre-launch
 * step read them. Records the resume of the run's own conversation first (`recordResume`). Prints nothing:
 * a SessionStart hook's output would enter the session's context.
 */
export async function onSessionStart(ctx: HookContext, env: NodeJS.ProcessEnv = process.env): Promise<HookDecision> {
  recordResume(ctx);
  const file = env[ENV_FILE_ENV];
  const sid = ctx.input.session_id;
  // The session, recorded in the person's state
  // folder under its project, where no tool call may write (plugin-sessions.ts): the program reads it whatever the
  // command's environment says. A record that cannot be written leaves the program reading the environment alone. And in the anchor, the OS account's own state folder, with the state
  // folder this session uses and its redaction key's sha256: a command that names another state folder cannot move it.
  if (ctx.run && typeof sid === "string" && sid !== "") {
    try {
      recordPluginSession(processStateDir(), ctx.run.projectDir, sid, ctx.now());
    } catch {
      // the variables below still say "inside a session"
    }
  }
  if (typeof file !== "string" || file === "" || typeof sid !== "string" || sid === "") return PASS;
  const lines = [`export ${SESSION_ENV}=${shellWord(sid)}`];
  if (ctx.run) lines.push(`export ${PROJECT_ENV}=${shellWord(ctx.run.projectDir)}`);
  lines.push(`export ${PROFILE_CHECK_ENV}=${shellWord(profileCheckValue(scanProfileState(env)))}`);
  appendFileAt(file, `${lines.join("\n")}\n`);
  return PASS;
}

// ------------------------------------------------------------------------------------------------
// WHAT THE RUN REPORTS
// ------------------------------------------------------------------------------------------------

export interface LaunchGateSummary {
  launch_dir: string;
  active: boolean;
  run_id: string | null;
  session_id: string | null;
  attempt: string | null;
  refusals: { total: number; by_kind: Record<string, number> };
  reservations: { launched: number; awaiting_result: number };
  released: number;
  /** Entries launched again after their seat returned with its answer lost (relaunches.jsonl). */
  relaunched: number;
  /** Plugin seats that started during the run bound to no reservation (less the launches still awaiting their result). */
  unlisted_plugin_seats: number;
  /** Other agents (neither this plugin's seats nor internal) that started during the run. */
  unlisted_other_agents: number;
  /** Every seat or agent the run saw that no reservation is bound to (a launch awaiting its result may still bind one of them). */
  unbound_seat_ids: string[];
  occupancy: Occupancy | null;
  /** Plugin seats that started in a session with no active run, from seats-outside-run.jsonl. */
  seats_outside_run: number;
  /**
   * Where a marker stands at the marker's path and cannot be read as one (a named pipe, a directory, bad JSON, no
   * permission): why, in the one reader's words. The gate refuses every launch while it stands, so the summary names it
   * rather than reporting that no run has been active (m4 of the integration verification). Null otherwise.
   */
  marker_unreadable: string | null;
  /** The run's launches recorded at another effort level than their session's start (`effortChanges`). */
  effort_changes: EffortChange[];
}

/** The counts of the run the marker names, or, with no marker, of the last run that ended. */
export function launchGateSummary(launchDir: string, now: Date = new Date()): LaunchGateSummary {
  const read = readActiveRun(launchDir);
  let runId: string | null = null;
  let marker: ActiveRunMarker | null = null;
  if (read.state === "active") {
    marker = read.marker;
    runId = marker.run_id;
  } else {
    const last = readJsonLines<{ run_id?: string | null }>(launchRecordPath(launchDir, ACTIVE_RUN_HISTORY_FILE)).pop();
    runId = typeof last?.run_id === "string" ? last.run_id : null;
  }
  const outside = readJsonLines<unknown>(join(launchDir, OUTSIDE_RUN_SEATS_FILE)).length;
  const empty: LaunchGateSummary = {
    launch_dir: launchDir,
    active: read.state === "active",
    run_id: runId,
    session_id: marker?.session_id ?? null,
    attempt: marker?.attempt ?? null,
    refusals: { total: 0, by_kind: {} },
    reservations: { launched: 0, awaiting_result: 0 },
    released: 0,
    relaunched: 0,
    unlisted_plugin_seats: 0,
    unlisted_other_agents: 0,
    unbound_seat_ids: [],
    occupancy: null,
    seats_outside_run: outside,
    marker_unreadable: read.state === "unreadable" ? read.error : null,
    effort_changes: [],
  };
  if (runId === null) return empty;
  const base = gatePaths(launchDir, runId, marker?.attempt ?? "-");
  const refusals = readJsonLines<{ kind?: string }>(base.refusals);
  const byKind: Record<string, number> = {};
  for (const r of refusals) byKind[String(r.kind)] = (byKind[String(r.kind)] ?? 0) + 1;
  const reservations = readJsonDir<Reservation>(base.reserved);
  const onDisk = new Set(reservations.flatMap((r) => (typeof r.seat === "string" ? [r.seat] : [])));
  // A seat is bound when a `launched` record names it, whatever became of its reservation since (a new
  // attempt releases the reservations of entries that had not returned).
  const bound = new Set([...launchedSeats(readLaunchEvents(join(launchDir, "launch-events.jsonl")).events), ...onDisk]);
  const pendingByType = new Map<string, number>();
  for (const r of reservations) if (typeof r.seat !== "string") pendingByType.set(r.subagent_type, (pendingByType.get(r.subagent_type) ?? 0) + 1);
  // Every attempt of the run counts; only the current attempt's pending launches can still bind a seat.
  let plugin = 0;
  let other = 0;
  const ids: string[] = [];
  const sighted = new Set<string>();
  const attempts = existsSync(base.attemptsDir) ? readdirSync(base.attemptsDir).sort() : [];
  for (const att of attempts) {
    const all = readJsonDir<SeatSighting>(join(base.attemptsDir, att, "seats"));
    for (const s of all) sighted.add(s.agent_id);
    const seats = all.filter((s) => !bound.has(s.agent_id));
    const current = marker !== null && att === safe(marker.attempt);
    const byType = new Map<string, SeatSighting[]>();
    for (const s of seats) byType.set(s.agent_type, [...(byType.get(s.agent_type) ?? []), s]);
    for (const [type, ss] of byType) {
      const n = Math.max(0, ss.length - (current ? (pendingByType.get(type) ?? 0) : 0));
      if (SEAT_AGENT_TYPES.includes(type)) plugin += n;
      else other += n;
      ids.push(...ss.map((s) => s.agent_id));
    }
  }
  let occupancy: Occupancy | null = null;
  if (marker !== null) {
    const list = readJson<LaunchList>(join(launchDir, "launch-list.json"));
    const run: RunPaths = { projectDir: "", legalDir: dirname(launchDir), launchDir, listPath: join(launchDir, "launch-list.json"), eventsPath: join(launchDir, "launch-events.jsonl"), findingsPath: "" };
    occupancy = runState({ run, marker, gp: base }, list?.wave_capacity ?? 0, now).occupancy;
  }
  return {
    ...empty,
    refusals: { total: refusals.length, by_kind: byKind },
    // Bound in this run: every binding also records its seat as seen (`sight`) in the attempt it was made in.
    reservations: { launched: [...bound].filter((s) => onDisk.has(s) || sighted.has(s)).length, awaiting_result: reservations.length - onDisk.size },
    released: readJsonLines<unknown>(base.releases).length,
    relaunched: readJsonLines<unknown>(base.relaunches).length,
    unlisted_plugin_seats: plugin,
    unlisted_other_agents: other,
    unbound_seat_ids: ids.sort(),
    occupancy,
    effort_changes: runEffortChanges(launchDir, runId),
  };
}

/** The summary as lines for a person. */
export function launchGateLines(s: LaunchGateSummary): string[] {
  const marker =
    s.marker_unreadable === null || s.marker_unreadable === undefined
      ? []
      : [
          `LAUNCH GATE: the active-run marker ${join(s.launch_dir, ACTIVE_RUN_FILE)} stands and cannot be read (${s.marker_unreadable}): the launch gate refuses every launch while it stands. End the run with ${abortCommand(s.launch_dir)}.`,
        ];
  if (s.run_id === null) {
    return marker.length > 0
      ? [...marker, `  no run's counts can be read beside it; plugin seats that started with no active run: ${s.seats_outside_run}`]
      : [`LAUNCH GATE: no scan run has been active in ${s.launch_dir}. ${s.seats_outside_run} plugin seat(s) started with no active run.`];
  }
  if (marker.length > 0) return [...marker, ...launchGateLines({ ...s, marker_unreadable: null })];
  const kinds = Object.entries(s.refusals.by_kind)
    .sort()
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
  return [
    `LAUNCH GATE for run ${s.run_id} (${s.active ? `active, session ${s.session_id ?? "not recorded"}, attempt ${s.attempt}` : "ended"}):`,
    `  calls refused: ${s.refusals.total}${kinds ? ` (${kinds})` : ""}`,
    `  listed launches bound to a seat: ${s.reservations.launched}; awaiting their launch result: ${s.reservations.awaiting_result}; reservations released: ${s.released}; entries launched again after their answer was lost: ${s.relaunched}`,
    `  seats that started with no listed launch: ${s.unlisted_plugin_seats} of this plugin's seats, ${s.unlisted_other_agents} other agent(s)${s.unbound_seat_ids.length ? ` (bound to no launch: ${s.unbound_seat_ids.join(", ")})` : ""}`,
    ...(s.occupancy ? [`  places: ${placesText(s.occupancy)}`] : []),
    `  plugin seats that started with no active run: ${s.seats_outside_run}`,
    ...[effortChangeLine(s.effort_changes ?? [])].flatMap((l) => (l === null ? [] : [`  ${l}`])),
  ];
}

// ------------------------------------------------------------------------------------------------
// WHAT TO LAUNCH NEXT, AND WHO ENDS A RUN THAT ONLY NEEDS LAUNCHING
// ------------------------------------------------------------------------------------------------

/** What `launch-next` and the run-abort guard read: the active run's next launches, or why there are none to read. */
export type NextRead =
  | { state: "none"; launch_dir: string; run_id: string | null; end: RunEnd | null }
  | { state: "unreadable"; launch_dir: string; problem: string }
  | {
      state: "active";
      launch_dir: string;
      marker: ActiveRunMarker;
      list_path: string;
      list: LaunchList;
      next: NextLaunches;
      released: string[];
      /** The reservations the gate will release, not yet due (`releasableReservations`), each with when. */
      releasable: { entry: string; reserved_at: string; due_at: string }[];
    };

/**
 * THE ACTIVE RUN'S NEXT LAUNCHES, READ WITHOUT WRITING: the list the gate launches from, read as the
 * gate reads it (`readRunList`); the state the gate decides on (`runState`), with the reservations the gate would
 * release as stale before its next decision treated as released (`staleReservations`); and the relaunch rule for the
 * reserved entries (`relaunchFor`, which the caller builds from entry-answer.ts - this module loads that only inside
 * the gate). One `now` for the state, the stale release and the rule.
 */
export function readNextLaunches(launchDir: string, now: Date, relaunchFor: (runId: string, now: Date) => RelaunchOf, delivering: string | null = null): NextRead {
  const read = readActiveRun(launchDir);
  if (read.state === "unreadable") return { state: "unreadable", launch_dir: launchDir, problem: `the active-run marker ${valueText(join(launchDir, ACTIVE_RUN_FILE))} cannot be read: ${valueText(read.error)}` };
  if (read.state === "none") {
    const last = readJsonLines<{ run_id?: string | null }>(launchRecordPath(launchDir, ACTIVE_RUN_HISTORY_FILE)).pop();
    const runId = typeof last?.run_id === "string" ? last.run_id : null;
    return { state: "none", launch_dir: launchDir, run_id: runId, end: runId === null ? null : lastRunEnd(launchDir, runId) };
  }
  const marker = read.marker;
  const run: RunPaths = { projectDir: "", legalDir: dirname(launchDir), launchDir, listPath: join(launchDir, "launch-list.json"), eventsPath: join(launchDir, "launch-events.jsonl"), findingsPath: "" };
  const listed = readRunList(run.listPath, marker);
  if (!listed.ok) return { state: "unreadable", launch_dir: launchDir, problem: listed.problem };
  const ac: ActiveContext = { run, marker, gp: gatePaths(launchDir, marker.run_id, marker.attempt) };
  const reserved = readJsonDir<Reservation>(ac.gp.reserved);
  const events = () => readLaunchEvents(run.eventsPath).events;
  const sightings = () => readJsonDir<SeatSighting>(ac.gp.seats);
  const resumes = resumeTimes(ac.gp.resumes);
  const stale = staleReservations(reserved, events, sightings, now, resumes);
  const released = new Set(stale.map((r) => r.entry));
  const releasable = releasableReservations(reserved, events, sightings, now, resumes)
    .map((r) => ({ entry: r.entry, reserved_at: r.reserved_at, due_at: new Date(Date.parse(r.reserved_at) + STALE_RELEASE_MS).toISOString() }))
    .sort((a, b) => (a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0));
  const st = runState(ac, listed.list.wave_capacity, now, released, delivering);
  return {
    state: "active",
    launch_dir: launchDir,
    marker,
    list_path: run.listPath,
    list: listed.list,
    next: nextLaunches(listed.list, st, relaunchFor(marker.run_id, now)),
    released: [...released].sort(),
    releasable,
  };
}

/** Every entry still to launch in `next`, each as `id` and, where it says more, why it waits or that it is launched again. */
export function entriesLeft(next: NextLaunches): string[] {
  return [
    ...[...next.launch, ...next.waitingPlace].map((n) => (n.again ? `${n.entry.id} (launched again: seat ${n.again.seat})` : n.entry.id)),
    ...next.promised.map((n) => `${n.entry.id} (named in seat ${n.by}'s receipt, whose report is not yet delivered)`),
    ...next.waitingFor.map((w) => `${w.entry.id} (waits for ${w.waits.join(", ")})`),
  ];
}

/**
 * THE RUN-ABORT GUARD: WHO ENDS A RUN THAT ONLY NEEDS LAUNCHING.
 * In live run 2 the orchestrator counted from its own notes, found entries with no record, matched them to SKILL.md's
 * recovery for a seat whose end never reached the program, and ended the run with run-abort although the program knew
 * the four entries had simply never been launched. Ending a run is the person's decision; the program must tell that
 * decision from the orchestrator's own inference.
 *
 * TOLD APART BY WHERE THE COMMAND RUNS - as for the run-shape flag (`shapeFlagRefusal` above):
 * inside a Claude Code session (`claudeCodeSigns`) the command line is the orchestrator's, and a person's
 * decision reaches the program only through a channel the orchestrator does not author; outside a session (the person's
 * own terminal, or CI) the command line is taken as given. So inside a session `run-abort` is refused while no listed
 * seat is running or awaiting its launch result (a seat presumed lost holds no place) and the gate's own computation
 * (`readNextLaunches`) has entries to launch now or still to come - naming them and `launch-next`, and printing the
 * exact command the person runs in their own terminal, absolute paths included (`personCommand`). In every other case
 * the run ends as before: outside a session, with no active run or one that cannot be read, while a listed seat is
 * outstanding, or once nothing is left to launch. The question relay is not used, so the person's stop never depends on
 * it (its mechanism is under the owner's review). Stated limits: a command that strips all three session variables is
 * not seen (a forgery already left open); a person with no terminal on the machine (Remote Control from a
 * phone) cannot end such a run until they reach one - meanwhile nothing launches unless the orchestrator launches it, and
 * SKILL.md says to launch nothing more once the person says stop; a new session is never bound by the marker; and a run
 * ends without this guard where the marker itself is removed - the write guard
 * refuses a delete or a move of every folder that holds it in the run's window (hook-guard.ts `holdsMarker`), within that
 * guard's stated limits (GUARD_BASH_LIMITS), and SKILL.md step 1a no longer sets `.legal/launch/` aside while a run is
 * active. A line
 * the person types in the session, read by a hook on their own prompt, would be a channel the orchestrator does not
 * author; it is a proposal for the owner and not built here.
 */
export function abortRefusal(launchDir: string, now: Date, env: NodeJS.ProcessEnv, relaunchFor: (runId: string, now: Date) => RelaunchOf, personCommand: string): { text: string; left: string[] } | null {
  const signs = claudeCodeSigns(env);
  if (signs.length === 0) return null;
  const read = readNextLaunches(launchDir, now, relaunchFor);
  if (read.state !== "active") return null;
  const o = read.next.occupancy;
  if (o.listed_running + o.pending > 0) return null;
  const left = entriesLeft(read.next);
  if (left.length === 0) return null;
  return {
    left,
    text:
      `run-abort: refused - scan run ${read.marker.run_id} only needs launching: no listed seat is running or awaiting its launch result, and ` +
      `${left.length} listed entr${left.length === 1 ? "y is" : "ies are"} still to launch: ${left.join(", ")}. This shell runs inside a Claude Code session ` +
      `(${signs.join(", ")} ${signs.length === 1 ? "is" : "are"} set), and there the program does not take the end of such a run from the session: an entry ` +
      `with no answer is launched, or launched again by the relaunch rule, never recovered by ending the run. Launch what ${launchNextCommand(launchDir)} ` +
      `prints, and run it again after every returned seat and every refusal. Ending the run is the person's decision: if the person has decided it, they run ` +
      `this in their own terminal, outside Claude Code, ${IN_BASH}: ${personCommand}. Nothing was written; the run stays active.`,
  };
}

// ------------------------------------------------------------------------------------------------
// THE RELAY
// ------------------------------------------------------------------------------------------------

/**
 * A relay launch the gate let through (`decideRelayLaunch`): one file per relay entry and attempt under the attempt's
 * `relays` folder, bound to the relay's agent id by its launch result (`bindLaunch`), released by a failed launch, and
 * ended by its accepted hand-back (`relayHandback`). Nothing here is a seat's: no reservation, no `launched` event, no
 * sighting, so the relay holds no place and no step that counts or assembles the seats sees it (condition 3).
 */
export interface RelayRecord {
  entry: string;
  tool_use_id: string;
  session_id: string | null;
  reserved_at: string;
  seat?: string;
  bound_at?: string;
  released_at?: string;
  released_why?: string;
  ended_at?: string;
  /**
   * The relay was let through before the run's conversation was resumed after its Claude Code process
   * ended, so it ended with that process (LOST AT THE RESUME): the resume's moment, written when the resume is recorded,
   * so its record does not stay open. A relay of an earlier process that is still running (the two-process limit) still
   * writes `ended_at` at its own hand-back.
   */
  lost_at?: string;
  /** What the relay's hand-back left to the main session, where it handed back with work only a command clears. */
  left_to_main?: string[];
  /** R13 (build unit F1): how many launches the relay entry's own prompt named (`RelayEntry.first`), counted towards its bound. */
  first_named?: number;
  /** R13: the relay's bound, where it was reached and the relay handed back at it: what reached it. */
  bound_reached?: string;
}

/** The relay records in one attempt's `relays` folder, by file name. */
function relayRecordsIn(dir: string): { path: string; r: RelayRecord }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => {
      const r = readJson<RelayRecord>(join(dir, f));
      return r ? [{ path: join(dir, f), r }] : [];
    });
}

const relayRecords = (ac: ActiveContext): { path: string; r: RelayRecord }[] => relayRecordsIn(ac.gp.relays);

/**
 * Every relay record of the run `runId`, in every attempt, as the gate wrote them: what the assembly reads to
 * prove that a seat the relay launched was launched by a relay of this run (assemble-hooked.ts `transcriptCheck`). Only
 * this run's folder is read: a relay of another run launched no seat of this one.
 */
export function relayRecordsOfRun(launchDir: string, runId: string): { path: string; r: RelayRecord }[] {
  const { attemptsDir } = gatePaths(launchDir, runId, "-");
  return subdirs(attemptsDir).flatMap((att) => relayRecordsIn(join(attemptsDir, att, "relays")));
}

/** Where an attempt's relays are recorded (`GatePaths.relays`), and the run's resumes (`GatePaths.resumes`): what `liveRelayIn` reads. */
export interface RelayPlace {
  relays: string;
  resumes: string;
}

/**
 * WHICH RELAY IS LIVE - THE ONE PREDICATE: the relay of
 * this attempt that the gate let through and that has neither handed back (`ended_at`) nor been released
 * (`released_at`), and that was not let through before the run's conversation was resumed after its Claude Code process
 * ended - such a relay ended with that process (LOST AT THE RESUME), so it is not live and a new relay entry can be
 * written and let through. Every place that asks which relay is live reads this and nothing else: the gate's one relay
 * at a time (`decideRelayLaunch`, through `liveRelay`), `relay-entry` (relay-seat.ts, through `liveRelayOf`), a receipt's
 * room - its bound, its slot claims, what it names and the auto-mode stop's relay line (`receiptNextLines`, through
 * `relayRoomIn`) - and the relay's hand-back (`relayHandback`, through `relayBoundOf`). In an earlier version the room was read by a second predicate without the resume, so after a resume the
 * new relay's receipts and hand-back took the lost relay's room. A relay record looked up by its own launch call or its
 * own agent id (the launch result, its failure, a denial, the hand-back's ending of its record) asks which relay that
 * is, not which is live.
 */
// R2 of an internal record, the consequence this predicate has in the two-process
// limit (a conversation resumed while its earlier Claude Code process still runs): the earlier process's relay is not
// live, so until a new relay is let through its receipts claim no slot and read no bound (`relayRoomIn` is null), and it
// can go on naming launches past RELAY_MAX_SEATS seats and RELAY_MAX_CONTEXT_TOKENS for as long as its seats keep
// running. Cost and context only: every entry is still reserved once and bound to one seat.
function liveRelayIn(where: RelayPlace, now: Date): { path: string; r: RelayRecord } | null {
  const resumes = resumeTimes(where.resumes);
  return relayRecordsIn(where.relays).find(({ r }) => r.ended_at === undefined && r.released_at === undefined && resumedAfter(resumes, Date.parse(r.reserved_at), now.getTime()) === null) ?? null;
}

/** The live relay of the active context's attempt (`liveRelayIn`), or null. */
const liveRelay = (ac: ActiveContext, now: Date = new Date()): RelayRecord | null => liveRelayIn(ac.gp, now)?.r ?? null;

/** For `relay-entry` (relay-seat.ts): the active run's live relay, read without writing; null where no run is active. */
export function liveRelayOf(launchDir: string, now: Date = new Date()): RelayRecord | null {
  const read = readActiveRun(launchDir);
  if (read.state !== "active") return null;
  const run: RunPaths = { projectDir: "", legalDir: dirname(launchDir), launchDir, listPath: join(launchDir, "launch-list.json"), eventsPath: join(launchDir, "launch-events.jsonl"), findingsPath: "" };
  return liveRelay({ run, marker: read.marker, gp: gatePaths(launchDir, read.marker.run_id, read.marker.attempt) }, now);
}

/**
 * Whether the launch gate has refused a relay launch in the active attempt since the run's latest resume
 * (any relay refusal: not auto mode, not interactive, one already live). `launch-next` then lists the entries for the main
 * session to launch itself rather than pointing it at `relay-entry` again, so the two never send it round in a loop.
 */
export function relayRefusedSinceResume(launchDir: string, marker: Pick<ActiveRunMarker, "run_id" | "attempt">): boolean {
  const gp = gatePaths(launchDir, marker.run_id, marker.attempt);
  const since = Math.max(-Infinity, ...resumeTimes(gp.resumes));
  return readJsonLines<{ at?: unknown; kind?: unknown }>(gp.refusals).some((r) => r.kind === "relay" && typeof r.at === "string" && Date.parse(r.at) > since);
}

/**
 * A launch whose input is, field for field, a relay entry's (the launch contract, `matchLaunch`). Let through once per
 * entry and attempt, from the main session only, in auto mode only (where each seat's answer reaches the relay as the
 * program's receipt naming the next launches, M1), and while no other relay of the attempt is live.
 */
async function decideRelayLaunch(ctx: HookContext, ac: ActiveContext, relay: RelayEntry, toolUseId: string, list: LaunchList): Promise<HookDecision> {
  const yourself = `launch the seats yourself from ${launchNextCommand(ac.run.launchDir)}, as SKILL.md step 4 says`;
  if (ctx.who !== "main") {
    const by = ctx.who === "relay" ? "a relay" : `an agent of type ${JSON.stringify(ctx.input.agent_type ?? "")}`;
    return refuse(ctx, ac, "relay", `only the main session launches the relay (entry ${relay.id}), and this call was made by ${by}.`, relay.id);
  }
  if (ctx.input.permission_mode !== "auto") {
    return refuse(
      ctx,
      ac,
      "relay",
      `the relay (entry ${relay.id}) is launched only in auto mode, where each seat's answer reaches it as the program's receipt naming what to launch next; this session's permission mode is ${JSON.stringify(ctx.input.permission_mode ?? null)}. Instead, ${yourself}.`,
      relay.id,
    );
  }
  // The one test relay-entry applies (relay-seat.ts `notInteractive`), here too, so that an
  // entry written in an interactive session is not launched after the session resumed headless.
  const headless = (await import("./relay-seat.js")).notInteractive(process.env);
  if (headless !== null) return refuse(ctx, ac, "relay", `the relay (entry ${relay.id}) is launched only in an interactive session: ${headless}. Instead, ${yourself}.`, relay.id);
  // F2 of an internal record: where the gate would admit none of the relay's seats in this session
  // (`launchBars`, a bar only the person clears), the relay is not launched either, as relay-entry offers none there.
  const host = runHost(ac, true);
  const person = list.entries.filter((e) => relay.first.includes(e.id)).flatMap((e) => launchBars(e, host)).find((b) => b.clears === "person");
  if (person) return refuse(ctx, ac, "relay", `the relay (entry ${relay.id}) is not launched, since the launch gate would launch none of its seats: ${person.text}`, relay.id);
  const live = liveRelay(ac, ctx.now());
  if (live) {
    return refuse(ctx, ac, "relay", `relay ${live.entry} of this attempt was let through at ${live.reserved_at} and has not handed back, and one relay runs at a time. Wait for its hand-back; if it ended without one, ${yourself}.`, relay.id);
  }
  makeFolder(ac.gp.relays, { recursive: true });
  const rec: RelayRecord = { entry: relay.id, tool_use_id: toolUseId, session_id: typeof ctx.input.session_id === "string" ? ctx.input.session_id : null, reserved_at: ctx.now().toISOString(), first_named: Array.isArray(relay.first) ? relay.first.length : 0 };
  if (!createOnce(join(ac.gp.relays, `${safe(relay.id)}.json`), line(rec))) {
    return refuse(ctx, ac, "reserved", `relay entry ${relay.id} was already launched in this attempt, and a relay entry is launched once. Run relay-entry again for a new one, or ${yourself}.`, relay.id);
  }
  return PASS;
}

/**
 * PreToolUse on the relay's SubagentHandback (the trial's condition 2: the host delivers one hand-back only, and the
 * trial's relay handed back before its seats had answered). Refused while the launch gate's own computation has a
 * listed seat running or awaiting its launch result, or an entry to launch now or still to come; the refusal names what
 * to launch now where there is any. Otherwise the relay's record is ended and its message is replaced by the program's
 * own line, so the main session reads nothing the relay composed.
 */
export async function relayHandback(ctx: HookContext): Promise<HookDecision> {
  const ac = activeFor(ctx);
  if (!ac) return PASS;
  const now = ctx.now();
  const read = await nextLaunchesNow(ac.run.launchDir, now);
  if (read.state !== "active") return PASS;
  const n = read.next;
  const left = entriesLeft(n);
  const running = n.occupancy.listed_running + n.occupancy.pending;
  // The relay waits
  // only for what it can see through - a listed seat running (its end wakes it) or an entry the gate admits now, by the
  // gate's own answer (`launchBars`). An entry the gate bars is not one: with nothing else left, the hand-back is delivered
  // naming what clears it (a command the main session runs, or the person's steps), so the relay's run never stops
  // without the main session, and through it the person, told what to do.
  const host = runHost(ac, true);
  const ready = [...n.launch, ...n.waitingPlace].map((x) => ({ x, bars: launchBars(x.entry, host) }));
  const blocked = ready.filter((r) => r.bars.length > 0);
  // R13: a relay at its bound launches nothing more; it hands back once its last seat has returned. The
  // bound of the live relay by the one predicate (`liveRelayIn`), so after a resume the new relay's own.
  const bound = relayBoundOf(ac.gp, typeof ctx.input.transcript_path === "string" ? ctx.input.transcript_path : null, now);
  const atBound = bound !== null && bound.reached !== null;
  const passable = atBound ? [] : ready.filter((r) => r.bars.length === 0).map((r) => r.x).slice(0, Math.max(n.free, 0));
  const byPerson = blocked.some((r) => r.bars.some((b) => b.clears === "person"));
  const agentId = typeof ctx.input.agent_id === "string" ? ctx.input.agent_id : "";
  // R3 of an internal record: a seat's end wakes the caller that launched it. Where
  // every listed seat running and every launch awaiting its result was launched by another caller (`Reservation.by`; in
  // the two-process limit, the relay of the earlier process, still running), none of their ends wakes this relay, so it
  // is not told to wait for one: its hand-back is delivered, saying so. A launch whose caller is not known keeps the refusal.
  const othersOnly = passable.length === 0 && running > 0 && n.runningBy.length > 0 && n.runningBy.every((b) => b !== null && b !== agentId);
  if ((running > 0 || passable.length > 0) && !othersOnly) {
    const what = [
      running > 0 ? `${running} listed seat(s) running or awaiting their launch result` : null,
      left.length > 0 ? `${left.length} entr${left.length === 1 ? "y" : "ies"} still to launch (${left.slice(0, 8).join(", ")}${left.length > 8 ? ", ..." : ""})` : null,
    ]
      .filter((x) => x !== null)
      .join(" and ");
    // F3: a seat can end without SubagentHandback, and then no receipt comes; its end still wakes the relay, which hands
    // back again (agents/legal-relay.md rule 2) and is answered here.
    const act =
      passable.length > 0
        ? `Launch now, one Agent call per entry, all in one message, each input exactly as given:\n${launchNowLines({ ...n, launch: passable }, false).join("\n")}\nThen end your turn.`
        : "End your turn now, without a hand-back: a running seat's end wakes you, with the program's receipt, which names what to launch next, or, where the seat ended without one, with the host's notice alone, on which you call SubagentHandback again.";
    const wait =
      blocked.length > 0
        ? ` ${blocked.map((r) => r.x.entry.id).join(", ")} ${blocked.length === 1 ? "waits" : "wait"} for ${byPerson ? "the person, since no seat of the run is launched in this session" : "a command only the main session can run"}; ${byPerson ? RELAY_CANNOT_PERSON : RELAY_CANNOT}`
        : "";
    return { kind: "deny", reason: `wolfboy: this hand-back was not delivered: scan run ${ac.marker.run_id} has ${what}, and the relay hands back only when nothing is outstanding that it can launch or wait for. ${act}${wait}` };
  }
  // What only the main session can do: what clears each entry the gate bars (`barFixes`; the person's steps, the same for
  // every entry, named once), and each verdict record for which refuter-entries would still append something,
  // which no receipt will name again.
  const barred = blocked.map((r) => (byPerson ? barFixes(r.bars.filter((b) => b.clears === "person")).join(" ").replace(/\.$/, "") : `entry ${r.x.entry.id}: ${barFixes(r.bars).join("; ")}`));
  const todo = [...new Set(barred), ...(await refuterEntriesDue(ac, now))];
  const rec = relayRecords(ac).find(({ r }) => r.seat === agentId);
  if (rec && rec.r.ended_at === undefined) replaceFile(rec.path, line({ ...rec.r, ended_at: now.toISOString(), ...(todo.length > 0 ? { left_to_main: todo } : {}), ...(atBound && bound ? { bound_reached: bound.reached as string } : {}) } satisfies RelayRecord));
  if (othersOnly) {
    const tiO = ctx.input.tool_input && typeof ctx.input.tool_input === "object" ? (ctx.input.tool_input as Record<string, unknown>) : {};
    const message = `wolfboy: the relay${rec ? ` (entry ${rec.r.entry})` : ""} has handed back: the ${running} listed seat(s) still running or awaiting their launch result were launched by another caller, not by this relay (in a conversation resumed while its earlier Claude Code process still runs, that process's relay), so their ends reach that caller and would never wake this relay. Launch nothing now and end your turn: where nothing else will wake you, the scanner's stop hook gives the one command to run in the background that waits for their launches to come due; otherwise, when the person next prompts you, run launch-next and launch what it prints.${todo.length > 0 ? ` Also: ${todo.join("; ")}.` : ""}`;
    return { kind: "replace-input", updatedInput: { ...tiO, message } };
  }
  if (atBound && bound && left.length > 0) {
    const tiB = ctx.input.tool_input && typeof ctx.input.tool_input === "object" ? (ctx.input.tool_input as Record<string, unknown>) : {};
    const message = `wolfboy: the relay${rec ? ` (entry ${rec.r.entry})` : ""} handed back at its bound (${bound.reached}; a relay launches at most ${RELAY_MAX_SEATS} seats or until its context passes ${RELAY_MAX_CONTEXT_TOKENS.toLocaleString("en-US")} tokens). No listed seat is running and ${left.length} entr${left.length === 1 ? "y is" : "ies are"} still to launch. Launch the next relay: run ${scannerCommand(["relay-entry", "--launch-dir", ac.run.launchDir])} and launch the relay entry it prints, exactly as given.${todo.length > 0 ? ` Also: ${todo.join("; ")}.` : ""}`;
    return { kind: "replace-input", updatedInput: { ...tiB, message } };
  }
  const ti = ctx.input.tool_input && typeof ctx.input.tool_input === "object" ? (ctx.input.tool_input as Record<string, unknown>) : {};
  const who = `the relay${rec ? ` (entry ${rec.r.entry})` : ""}`;
  const message =
    todo.length === 0 && left.length === 0
      ? `wolfboy: ${who} is done: every entry of scan run ${ac.marker.run_id}'s launch list has been launched and no listed seat is running. Run launch-next once; where it says NOTHING LEFT TO LAUNCH, go on as SKILL.md step 4 says.`
      : `wolfboy: ${who} has handed back before scan run ${ac.marker.run_id}'s end: no listed seat is running and nothing is left that it can launch${left.length > 0 ? ` (${left.length} entr${left.length === 1 ? "y" : "ies"} still to launch: ${left.slice(0, 8).join(", ")}${left.length > 8 ? ", ..." : ""})` : ""}. Tell the person the run is waiting on what follows, and do it: ${todo.length > 0 ? todo.map((t, i) => `(${i + 1}) ${t}`).join(" ") : "run launch-next, which says why each entry left cannot be launched now and what to do"}.${byPerson ? " No seat of the run is launched in this session: launch nothing more, and leave ending the run to the person." : " Then run launch-next and launch what it prints (relay-entry offers a new relay for it), as SKILL.md step 4 says."}`;
  return { kind: "replace-input", updatedInput: { ...ti, message } };
}

/**
 * WHAT COMES DUE WITHOUT THE PERSON: the one predicate the Stop hook
 * (`mainStopped`) and `wait-next` (index.ts) share, so that the hook never blocks a stop on what `wait-next` would not
 * wait for, and `wait-next` never ends at once on what the gate would refuse. `launchable`: the entries to launch now
 * that the gate admits (`launchBars` none). `releasable`: the launches reserved whose result never came that the gate
 * will release, not yet due (`releasableReservations`); those already due count as released, so their entries are in
 * `launchable` where the gate admits them. Not counted: an entry the gate bars (it waits for a command or the person),
 * a reservation the gate keeps for a seat seen since (`keptBySighting`: nothing releases it), and an entry waiting for a
 * place - a place held by a listed seat frees at that seat's end, which wakes its caller; one held by a reservation that
 * comes due is counted as that reservation; one held by an agent with no listed launch is freed by nothing the gate does.
 */
export interface DueWithoutPerson {
  launchable: NextLaunch[];
  releasable: { entry: string; reserved_at: string; due_at: string }[];
}

export function dueWithoutPerson(read: Extract<NextRead, { state: "active" }>, host: LaunchHost): DueWithoutPerson {
  return { launchable: read.next.launch.filter((x) => launchBars(x.entry, host).length === 0), releasable: read.releasable };
}

/** Whether anything comes due without the person (`dueWithoutPerson`). */
export const somethingDue = (d: DueWithoutPerson): boolean => d.launchable.length > 0 || d.releasable.length > 0;

/** What is due, as the Stop hook's bound compares it: each launchable entry (with the seat it replaces) and each reservation. */
export const dueState = (d: DueWithoutPerson): string =>
  JSON.stringify({ launchable: d.launchable.map((x) => [x.entry.id, x.again?.seat ?? null]), releasable: d.releasable.map((r) => [r.entry, r.reserved_at]) });

/**
 * THE MAIN CONVERSATION'S STOP WHILE A RUN IS OUTSTANDING (Stop). A run in progress
 * waits on notifications - a seat's end wakes the caller that launched it, a relay's hand-back wakes the main
 * conversation - and where none can come, nobody is woken and the program's own deadlines pass with nobody to act on
 * them (one real run: 19 launches reserved that the host never ran, a relay's hand-back delivered because they read as
 * another caller's, the main conversation ended its turn, and the reservations fell due 120 s later with nobody awake;
 * the run waited 19 minutes for the person's "continue"). The program-owned waker: while the active run's marker names
 * this session, no listed seat is running and no relay is live (so nothing will wake this conversation), and something
 * is outstanding that will come due without the person (`dueWithoutPerson`: an entry the gate admits now, or a launch
 * reserved whose result never came, which the gate releases STALE_RELEASE_MS after it was made) - the stop is blocked once,
 * and the reason gives the one command to run in the background (`wait-next`, which exits when a launch is possible and
 * prints launch-next's lines; its exit wakes the conversation). It never traps the person: a stop the hook already
 * blocked once (`stop_hook_active`) passes, as does every stop with no run active (ended by the assembly or run-abort),
 * a run of another session, a seat running, a relay live, or nothing that comes due without the person (entries that
 * wait for the person, `launchBars`; a reservation the gate keeps; places held by agents with no listed launch); the
 * reason says to end the turn where the person asked to stop. AND EVERY WAKE CYCLE HAS AN
 * END, whatever the predicate predicts: each block is recorded with what was due (`dueState`, in `stopBlocks`), and a
 * stop that finds the same as the last block passes - the wait that block asked for ended, or was never run, with nothing
 * changed - so a run is woken once per change in what is due, never once per wait; where the block cannot be recorded,
 * the stop passes. It launches nothing itself, so it cannot launch an entry twice: what `wait-next` prints is
 * launch-next's own computation, and the gate reserves each entry once.
 */
export async function mainStopped(ctx: HookContext): Promise<HookDecision> {
  if (ctx.input.stop_hook_active === true) return PASS;
  let ac: ActiveContext | null;
  try {
    ac = activeFor(ctx);
  } catch {
    return PASS;
  }
  if (!ac) return PASS;
  const now = ctx.now();
  const read = await nextLaunchesNow(ac.run.launchDir, now);
  if (read.state !== "active") return PASS;
  const n = read.next;
  if (n.occupancy.listed_running > 0 || liveRelay(ac, now) !== null) return PASS;
  const due = dueWithoutPerson(read, runHost(ac));
  if (!somethingDue(due)) return PASS;
  const state = dueState(due);
  try {
    if (readJsonLines<{ state?: unknown }>(ac.gp.stopBlocks).at(-1)?.state === state) return PASS;
    makeFolder(dirname(ac.gp.stopBlocks), { recursive: true });
    appendFileAt(ac.gp.stopBlocks, line({ at: now.toISOString(), session_id: typeof ctx.input.session_id === "string" ? ctx.input.session_id : null, state }));
  } catch (e) {
    recordHookFailure(ac.run, ctx.input, { stage: "route", route: "launch-main-stop", error: `the stop was let through: its block could not be recorded (${valueText(messageOf(e))})` }, now);
    return PASS;
  }
  const ready = due.launchable;
  const pending = due.releasable.length;
  const what = [
    ready.length > 0 ? `${ready.length} entr${ready.length === 1 ? "y" : "ies"} the launch gate admits now (${ready.slice(0, 8).map((x) => x.entry.id).join(", ")}${ready.length > 8 ? ", ..." : ""})` : null,
    pending > 0 ? `${pending} launch(es) reserved whose launch result never came, which the gate releases ${STALE_RELEASE_MS / 1000} s after the reservation for launching again` : null,
  ]
    .filter((x) => x !== null)
    .join(" and ");
  return {
    kind: "block",
    reason:
      `wolfboy: scan run ${ac.marker.run_id} is not finished and nothing will wake this conversation when its next launch is due: no listed seat is running, no relay is live, and it has ${what}. ` +
      `Before you end your turn, run this one command with Bash in the background (run_in_background): ${scannerCommand(["wait-next", "--launch-dir", ac.run.launchDir])} - it exits when a launch is possible (at once where one is possible now) and prints launch-next's lines, and its exit wakes you; then launch exactly what it prints. ` +
      "If the person asked you to stop, end your turn now instead: this hook lets that stop through.",
  };
}

/**
 * The same list for launch-next, which the main session runs after every returned seat: the
 * capture runs refuter-entries at the seat's end in every mode, and this names each record it could not run it for.
 */
export async function refuterEntriesDueFor(launchDir: string, listPath: string, marker: ActiveRunMarker, now: Date): Promise<string[]> {
  const launch = resolve(launchDir);
  const legalDir = dirname(launch);
  return refuterEntriesDue({ run: { ...runPaths(dirname(legalDir)), legalDir, launchDir: launch, listPath }, marker }, now);
}

/**
 * The verdict records
 * of the run for which running SKILL.md step 5's command would append something now - no run of refuter-entries is
 * recorded on the list for a record the capture ledger holds for a verdict entry, and the command's own plan
 * (launch-later.ts `refuterEntriesToAppend`) has refuter entries or held candidates to add - each with that command. Under
 * the refute_later shape only a record with a finding due a second look (a refuter in challenge mode, launch-later.ts
 * `buildChallengeEntries`), and none for a record that classes no candidate
 * violation_candidate. In auto mode the capture runs that command; this names what it could not do.
 */
async function refuterEntriesDue(ac: Pick<ActiveContext, "run" | "marker">, now: Date): Promise<string[]> {
  const listed = readRunList(ac.run.listPath, ac.marker);
  // Said, not left out: a list that does not read here names no record, and the main session is told why.
  if (!listed.ok) return [`the launch list does not read now (${listed.problem}), so the verdict records still due refuter-entries cannot be named here`];
  const { readAnswerLedgers } = await import("./entry-answer.js");
  const { examinedRecords, refuterEntriesPreview, refuterEntriesToAppend } = await import("./launch-later.js");
  const recorded = readAnswerLedgers(ac.run.legalDir, ac.run.launchDir, ac.marker.run_id, now).recorded;
  // Examined as the record's bytes are now (launch-later.ts `examines`), so a record replaced at the same path is due again.
  const examined = examinedRecords(listed.list, ac.run.legalDir);
  const out: string[] = [];
  for (const e of listed.list.entries) {
    /* An ordinary refuter's record too: its location overturns of a rule that
     * opts in are due a second look, which the same command appends. */
    const ordinaryRefuter = e.role === "refuter" && !(await import("./second-look.js")).isChallengeEntry(e);
    if (e.role !== "adjudicator" && e.role !== "verdict-after-readers" && !ordinaryRefuter) continue;
    const file = recorded.get(e.id);
    if (file === undefined || examined.has(file)) continue;
    const record = join(ac.run.legalDir, file);
    /* An ordinary refuter's record the command would refuse is said with the refusal's line (its second look cannot be
     * appended now, and the report shows it not answered); its held looks are counted, each a look not written. */
    if (ordinaryRefuter) {
      const v = refuterEntriesPreview({ record, legal: ac.run.legalDir, launchDir: ac.run.launchDir }, listed.list);
      if (v.kind === "refused") {
        out.push(`no run of refuter-entries has examined the record ${file} of entry ${e.id}, and the command refuses it now (${v.line}); where the record overturns a finding on a location ground of a rule that opts in, that finding's second look cannot be appended until the command runs without refusing, and until then the report shows that look as not answered`);
        continue;
      }
    }
    const would = refuterEntriesToAppend({ record, legal: ac.run.legalDir, launchDir: ac.run.launchDir }, listed.list);
    if (would === null) continue;
    const what = [
      would.entries > 0 && ordinaryRefuter ? `${would.entries} finding(s) it overturned on a location ground have no second look yet` : null,
      would.entries > 0 && !ordinaryRefuter ? `${would.entries} violation candidate(s) in it have no refuter entry, so no second review yet` : null,
      would.held > 0 && ordinaryRefuter ? `${would.held} second look(s) it is due cannot be written (held back), and why is recorded only once the command has run` : null,
      would.held > 0 && !ordinaryRefuter ? `${would.held} held back without one ${would.held === 1 ? "is" : "are"} not yet recorded with the reason the report gives` : null,
    ]
      .filter((x) => x !== null)
      .join(", and ");
    out.push(`the record ${file} of entry ${e.id} has had no refuter-entries run, so ${what}: run ${scannerCommand(["refuter-entries", "--record", record, "--legal", ac.run.legalDir])}`);
  }
  return out;
}
