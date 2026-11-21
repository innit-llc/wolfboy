/**
 * CAPTURING A SEAT'S ANSWER THROUGH THE HOOKS (relay item 3, milestones 2 and 3; proposal §3.5).
 *
 * Where the answer is (probe fact (b)):
 * - auto mode: the seat calls SubagentHandback, and its PreToolUse receives the whole answer as
 *   `tool_input.message`. Accepted: the call goes ahead with the message replaced by a short receipt, so the
 *   orchestrator is handed the receipt and not the text (probe fact (c)). Refused: the call is denied and the
 *   refusal reaches the seat, which can call SubagentHandback again (probe fact (c), run C).
 * - every other mode: the seat's last message is its answer, and SubagentStop receives it as
 *   `last_assistant_message`. Accepted: the stop goes ahead. Refused: the stop is blocked and the seat reads
 *   the refusal as its next message (probe fact (c), run D).
 *
 * The seat's entry is the latest `launched` event whose `seat` is the event's `agent_id` and whose launch
 * reservation agrees (the launch hook writes both: the reservation's `seat`, then the line), or its release line where a
 * new attempt released it (the launch unit's binding rule, hook-launch.ts seatBinding); its role and key come
 * from the launch list, and the ids from the scan's findings.json the way the `verdict-capture` command derives
 * them. The capture itself is `captureAnswer` of
 * verdict-capture.ts, in this process: the record is the same bytes the command writes for the same answer.
 *
 * At most REFUSALS_MAX refusals per seat, counted per agent id from the hook ledger on disk. The answer after
 * the last refusal is checked as every answer is, except that an adjudicator's answer whose only defects are parts of
 * `standing` is used with those parts set aside (verdict-capture.ts `lastAnswer`); any other defect keeps it whole and
 * marked invalid, its candidates reported as not judged, and the seat is let go. No earlier answer of the seat is taken
 * in its place.
 *
 * The hook ledger (`.legal/capture/hook-ledger.jsonl`) has one line per answer the hooks read: accepted,
 * refused, invalid, unbound (no `launched` event confirmed by its reservation or release line names the agent id) or not-captured
 * (anything else that stops a record: no findings entry for the key, a record already there, the validator
 * unavailable, a last message in auto mode that is not a valid answer). An answer that is not written as a record
 * is kept whole under `.legal/capture/kept/`. One more line, `stopped`, holds no answer: in auto mode, where the
 * answer was taken at the hand-back, it records the seat's own transcript when the seat stops. Every line carries
 * both transcript paths the event gave. Records and their own ledger stay the `verdict-capture` command's.
 *
 * AUTO MODE, A SEAT THAT STOPS WITH NOTHING TAKEN: its last message is read as its answer, as outside auto mode,
 * and the stop is never blocked (a blocked auto-mode stop was never probed). No refusal can reach it, so it is read as
 * an answer after the last refusal is: accepted, or with only
 * parts of `standing` wrong, it is a record (those parts set aside); refused for anything else after REFUSALS_MAX
 * refusals, invalid; refused for anything else before, kept whole as not-captured with the
 * refusal's problems, and its entry launched again (entry-answer.ts `relaunchable`).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { appendFileAt, makeFolder, writeFileAt } from "./project-write.js";
import { launchRecordPath } from "./state-record.js";
import { keptAnswerDigest } from "./redaction-key.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { relativePath } from "./project-path.js";
import { CAPTURE_HANDBACK_LIMIT_MS, HOOK_FAILURE_LOG, PASS, readDeepMarker, recordHookFailure, STILL_CHECKING, type DeepMarker, type DeepSeat, type HookContext, type HookDecision } from "./hook.js";
import { DEEP_LAUNCH_LIST, DEEP_REPLY_SCHEMAS, appendDeepLaunchEvent, deepTracked, readDeepLaunchEvents, readDeepLaunchList } from "./launch-plan.js";
import { validateAgainstSchema } from "./schema-validate.js";
import { captureAnswer, decisionsConverter, handedFromFindings, keepReadPlaces, readCaptureLedger, renderRefusal, type CaptureRole, type CaptureVia, type LedgerEntry, type PlacesKept } from "./verdict-capture.js";
import { captureKeyOf, readLaunchEvents, type LaunchEvent } from "./launch-plan.js";
import { eventInActiveRun, readActiveRun, relaunchOfSeat, seatBinding, setAsideInAnyRun } from "./hook-launch.js";
import { FOLD_NOT_TOLD, toldArgs, toldCommandWords, toldFoldCommand, verdictReadingAt } from "./scanner-command.js";
import { MAKEUP_EXIT, runMakeupEntries } from "./makeup-seat.js";
import { programFileBytes, readProgramFile } from "./program-file.js";
import { answerRulesAtCapture } from "./reading-assembly.js";
import { carriedRepliesOfLaunchDir } from "./carried-places.js";
import { REFUSED_DIR, type RefusalNamed, type RefusalRemoved } from "./amend.js";
import { transcriptEffort } from "./seat-effort.js";
import { instructionsPremise } from "./instructions.js";
import { seatSightOf, seatTranscriptOf, type SeatPayload } from "./seat-opened.js";
import { isChallengeEntry } from "./second-look.js";
import { valueText } from "./value-text.js";

export const HOOK_LEDGER = "capture/hook-ledger.jsonl";
export const KEPT_DIR = "capture/kept";
/** Refusals per seat before its next answer is kept as invalid (proposal §3.5: the third answer after two refusals). */
export const REFUSALS_MAX = 2;

export type HookCaptureOutcome = "accepted" | "refused" | "invalid" | "unbound" | "not-captured" | "stopped";
export type HookCaptureEvent = "PreToolUse:SubagentHandback" | "SubagentStop";

export interface HookLedgerLine {
  v: 1;
  at: string;
  outcome: HookCaptureOutcome;
  agent_id: string;
  agent_type: string;
  session_id: string | null;
  event: HookCaptureEvent;
  permission_mode: string | null;
  tool_use_id: string | null;
  /** The event's `transcript_path` (the session's transcript) and `agent_transcript_path` (the seat's own), as sent. */
  transcript_path: string | null;
  agent_transcript_path: string | null;
  /** The launch-list entry bound to the agent id, or null for an unbound seat. */
  entry: string | null;
  role: CaptureRole | null;
  /** The whole answer as read: its sha256 and length, and the file it is kept in when no record holds it; null on a `stopped` line. */
  answer: { sha256: string; bytes: number; kept: string | null } | null;
  /** accepted: the record `verdict-capture` wrote, as its own ledger names it. */
  record?: { file: string; sha256: string };
  /** accepted: what the capture took out of the record as inert instead of refusing it (the capture ledger's `normalised`). */
  normalised?: NonNullable<LedgerEntry["normalised"]>;
  /**
   * refused: which refusal this is, what was wrong, and what it named (amend.ts: an amendment may change only that); and what it told the seat to take out, which is not part of the base the next answer amends.
   */
  refusal?: {
    n: number;
    of: number;
    problems: string[];
    named?: RefusalNamed;
    /** What the refusal's problems named before any widening: the guard on the next answer (verdict-capture.ts `amend.strict`). */
    strict?: RefusalNamed;
    removed?: RefusalRemoved;
  };
  /**
   * Where the answer was an amendment of the seat's last refused answer: the merged
   * whole the capture checked (its sha256, length and the file it is kept in, or null where a record holds it) and the
   * refused answer it was laid over. `answer` stays the seat's own bytes.
   */
  merged?: { sha256: string; bytes: number; kept: string | null; base: string };
  /** invalid: every refusal's reasons, this answer's own last. */
  refusals?: { n: number; problems: string[] }[];
  /** Unit U1: the seat's place rows that passed the place checks, kept as read though its answer ended without a record. */
  places_kept?: PlacesKept[];
  /** unbound, not-captured: why no record was written; stopped: what the line records. */
  reason?: string;
  /**
   * SubagentStop only: the effort levels the seat's own transcript (`agent_transcript_path`) records on
   * its assistant lines, distinct (seat-effort.ts `transcriptEffort`); null where the transcript could not be read.
   * Absent on a PreToolUse line, which names no transcript of the seat, and on lines written before the field.
   */
  agent_effort?: string[] | null;
  /**
   * How long the capture took, in milliseconds: from the start of its check of this
   * event (`takeAnswer`; `onSubagentStop` for a `stopped` line) to the moment this line was written, so that a run shows
   * the margin to the hook entry's own deadline (hook.ts HOOK_PROCESS_DEADLINE_MS, counted from the entry's start, which
   * the begun line's `at` dates). Absent on lines written before the field.
   */
  took_ms?: number;
}

const sha256 = (b: Uint8Array | string): string => createHash("sha256").update(b).digest("hex");

/**
 * THE CAPTURE MAY REPLACE A RECORD SET ASIDE: the reason to replace the
 * file at `rel` with the answer of a seat bound to `entry`, or null. Only where the capture ledger's latest line for that
 * file is a capture the run's set-aside ledger names for the same entry, and the bytes there are not that capture's (they
 * were changed outside the program): a record holding the answer the program received - the set-aside one restored, or
 * any later capture - is never replaced, and a file no ledger line names is a stray the assembly names, never replaced.
 */
export function setAsideReplacement(launchDir: string, legalDir: string, entry: string | null, rel: string, previousSha256: string): string | null {
  if (entry === null) return null;
  const latest = readCaptureLedger(legalDir).latest.get(rel);
  if (!latest || latest.sha256 === previousSha256) return null;
  const line = setAsideInAnyRun(launchDir).find((a) => a.file === rel && a.entry === entry && a.seat === latest.seat && a.sha256 === latest.sha256);
  return line ? `the record there was set aside at ${line.at} (${line.why}) and entry ${line.entry} launched again: this is the answer of the seat launched in its place` : null;
}

/**
 * Every hook-ledger line that reads, in order: the one reader, used by `seatHistory` and by the assembly (relay
 * integration part B, the assembly area). Unreadable lines are skipped. The ledger is read through the one reader of
 * program-written files (program-file.ts): a ledger that is not a regular file with one
 * name is refused by a throw naming it, never followed or waited on.
 */
export function readHookLedger(legalDir: string): HookLedgerLine[] {
  const p = join(legalDir, HOOK_LEDGER);
  if (!existsSync(p)) return [];
  const got = readProgramFile("the hook ledger", p);
  if (!got.ok) {
    if (got.code === "ENOENT") return [];
    throw new Error(got.problem);
  }
  const out: HookLedgerLine[] = [];
  for (const line of got.value.toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const l: unknown = JSON.parse(line);
      if (typeof l === "object" && l !== null && !Array.isArray(l)) out.push(l as HookLedgerLine);
    } catch {
      // A line that does not read is not about any seat; the ledger stays append-only.
    }
  }
  return out;
}

/**
 * THE CHECK STORE. A
 * hand-back's check may pass the hook entry's deadline; the entry then refuses the call with STILL_CHECKING and lets the
 * check finish on its own (hook.ts `HookRoute.continues`). Each check of a hand-back is written here, keyed by the
 * answer's sha256: `begun` (its process), `decided` (the decision `takeAnswer` gave, which the entry may never have
 * delivered) and `served` (that decision given to the same answer sent again), or `waited` (the same answer sent again
 * while the check still ran, told STILL_CHECKING again). Append-only, one JSON object per line.
 *
 * NOTHING HERE MARKS A DECISION DELIVERED. Whether a call delivered
 * what it carried is known only to its entry, and an entry that did not deliver writes one line saying so: its deadline
 * line with `continued` (hook.ts `deadline()`). So a stored decision is undelivered while the call that decided it and
 * every call it was `served` to have such a line, and it is given again to the next call of the same answer; a `served`
 * line says only which call it was offered to. Before, `served` was taken as delivered, and a decision served to a call
 * whose entry had ended in the meantime was spent with nobody having received it.
 *
 * EVERY WAIT HAS A BOUND. A check is live only while its process
 * answers a signal AND its own limit has not passed (hook.ts CAPTURE_HANDBACK_LIMIT_MS, which the process keeps itself,
 * hook-child.ts), AND fewer than WAITS_MAX calls of the same answer were told it still runs; a pid answering with EPERM is
 * another user's process, never this check. So one answer of one seat is told STILL_CHECKING at most WAITS_MAX times per
 * check, checked at most CHECK_ATTEMPTS_MAX times, and then kept unchecked (`exhausted`): its candidates go to the relaunch
 * rule and, past its cap, are listed as not checked.
 */
export const HANDBACK_CHECKS = "capture/handback-checks.jsonl";
/** Checks of one answer begun and never decided (their process ended first) before the answer is kept unchecked. */
export const CHECK_ATTEMPTS_MAX = 3;
/** How long the same answer sent again waits for a check of it still running, inside the entry's own deadline. */
const PENDING_WAIT_MS = 12000;
/**
 * Calls of the same answer told STILL_CHECKING about one check before that check is
 * taken as ended: one more than its own limit allows at PENDING_WAIT_MS a call (each `waited` line stands for a full wait),
 * so it binds only where the clock cannot be trusted.
 */
export const WAITS_MAX = Math.ceil(CAPTURE_HANDBACK_LIMIT_MS / PENDING_WAIT_MS) + 1;
/** The time after a check's own limit within which its process is surely gone (the signal is sent at the limit). */
const LIMIT_SLACK_MS = 2000;
/** How long a seat's stop waits for a check of its hand-back still running: at most that check's own limit (the stop goes ahead meanwhile). */
const STOP_WAIT_MS = CAPTURE_HANDBACK_LIMIT_MS + LIMIT_SLACK_MS;

export interface HandbackCheckLine {
  v: 1;
  at: string;
  step: "begun" | "decided" | "served" | "waited";
  agent_id: string;
  sha256: string;
  /** The call this line is about (the hand-back that ran the check, or the one sent again). */
  tool_use_id: string | null;
  /** One check: `begun` and `decided` name the same; `served` names the check whose decision it gave. */
  check: string;
  pid?: number;
  decision?: HookDecision;
  note?: ReceiptNote;
}

/** Every line of the check store, in order; unreadable lines are skipped. */
export function readHandbackChecks(legalDir: string): HandbackCheckLine[] {
  const p = join(legalDir, HANDBACK_CHECKS);
  if (!existsSync(p)) return [];
  const got = readProgramFile("the hand-back check store", p);
  if (!got.ok) return [];
  const out: HandbackCheckLine[] = [];
  for (const line of got.value.toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const l: unknown = JSON.parse(line);
      if (typeof l === "object" && l !== null && !Array.isArray(l) && typeof (l as HandbackCheckLine).check === "string") out.push(l as HandbackCheckLine);
    } catch {
      // as the hook ledger: a line that does not read is about no check
    }
  }
  return out;
}

/**
 * The calls whose entry ended at a deadline with its capture let go (hook.ts `deadline()`, `continued`): what their capture
 * decided was not delivered on them. A log that cannot be read names none.
 */
function callsNotDelivered(legalDir: string): Set<string> {
  const out = new Set<string>();
  const p = join(legalDir, HOOK_FAILURE_LOG);
  if (!existsSync(p)) return out;
  const got = readProgramFile("the hook failure log", p);
  if (!got.ok) return out;
  for (const line of got.value.toString("utf8").split("\n")) {
    try {
      const l = JSON.parse(line) as { continued?: unknown; tool_use_id?: unknown };
      if (l.continued === true && typeof l.tool_use_id === "string" && l.tool_use_id !== "") out.add(l.tool_use_id);
    } catch {
      // a line that does not read is about no call
    }
  }
  return out;
}

/** Whether the process `pid` may still be a check: it answers a signal. EPERM is another user's process, never a check of this program's user. */
const processAnswers = (pid: number | undefined): boolean => {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const pause = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};
/**
 * The checks of `lines` begun and not decided that may still run: the process answers, the check's own limit has not
 * passed since its `begun` line (its process ends itself there), and fewer than WAITS_MAX calls were told it still runs.
 */
const liveChecks = (lines: readonly HandbackCheckLine[], nowMs: number = Date.now()): HandbackCheckLine[] => {
  const decided = new Set(lines.filter((l) => l.step === "decided").map((l) => l.check));
  const waits = (check: string) => lines.filter((l) => l.step === "waited" && l.check === check).length;
  return lines.filter((l) => {
    if (l.step !== "begun" || decided.has(l.check)) return false;
    const since = Date.parse(l.at);
    return Number.isFinite(since) && nowMs < since + CAPTURE_HANDBACK_LIMIT_MS + LIMIT_SLACK_MS && waits(l.check) < WAITS_MAX && processAnswers(l.pid);
  });
};

/**
 * What the check store says of this hand-back, before it is checked: the decision of a check of the same answer not yet
 * delivered on any call that carried it (`served`, see the note above HANDBACK_CHECKS); STILL_CHECKING again where such a
 * check still runs after PENDING_WAIT_MS (`wait`); the number of checks of it begun that ended undecided, where it reached
 * CHECK_ATTEMPTS_MAX (`exhausted`); otherwise null, and the answer is checked as before (a refusal delivered, the same
 * answer sent again is checked again and refused again, so REFUSALS_MAX still counts).
 */
function storedCheck(legalDir: string, agentId: string, sha: string, toolUseId: string | null, at: () => string): { kind: "served"; decision: HookDecision; note: ReceiptNote } | { kind: "wait" } | { kind: "exhausted"; attempts: number } | null {
  const until = Date.now() + PENDING_WAIT_MS;
  for (;;) {
    const lines = readHandbackChecks(legalDir).filter((l) => l.agent_id === agentId && l.sha256 === sha);
    const missed = callsNotDelivered(legalDir);
    const notGot = (call: string | null) => call !== null && missed.has(call);
    const undelivered = lines
      .filter((l) => l.step === "decided" && l.decision && notGot(l.tool_use_id) && lines.every((s) => s.step !== "served" || s.check !== l.check || notGot(s.tool_use_id)))
      .at(-1);
    if (undelivered?.decision) {
      appendLine(legalDir, HANDBACK_CHECKS, { v: 1, at: at(), step: "served", agent_id: agentId, sha256: sha, tool_use_id: toolUseId, check: undelivered.check } satisfies HandbackCheckLine);
      return { kind: "served", decision: undelivered.decision, note: undelivered.note ?? {} };
    }
    const live = liveChecks(lines);
    if (live.length === 0) {
      const decided = new Set(lines.filter((l) => l.step === "decided").map((l) => l.check));
      const ended = lines.filter((l) => l.step === "begun" && !decided.has(l.check)).length;
      return ended >= CHECK_ATTEMPTS_MAX ? { kind: "exhausted", attempts: ended } : null;
    }
    if (Date.now() >= until) {
      appendLine(legalDir, HANDBACK_CHECKS, { v: 1, at: at(), step: "waited", agent_id: agentId, sha256: sha, tool_use_id: toolUseId, check: live.at(-1)!.check } satisfies HandbackCheckLine);
      return { kind: "wait" };
    }
    pause(200);
  }
}

/** Every hook-ledger line about one agent id, in order. Unreadable lines are skipped. */
export function seatHistory(legalDir: string, agentId: string): HookLedgerLine[] {
  return readHookLedger(legalDir).filter((l) => l.agent_id === agentId);
}

/** Keep an answer whole, named by its keyed digest (redaction-key.ts `keptAnswerDigest`), and return its path relative to `.legal`. */
function keepWhole(legalDir: string, agentId: string, answer: Uint8Array, dir = KEPT_DIR): string {
  const rel = `${dir}/${agentId.replace(/[^A-Za-z0-9._-]/g, "_")}.${keptAnswerDigest(answer)}.txt`;
  const abs = join(legalDir, rel);
  makeFolder(dirname(abs), { recursive: true });
  if (!existsSync(abs)) writeFileAt(abs, answer);
  return rel;
}

function appendLine(legalDir: string, rel: string, value: unknown): void {
  appendTo(join(legalDir, rel), value);
}

/** One line, in one write, to an append-only file. */
function appendTo(abs: string, value: unknown): void {
  makeFolder(dirname(abs), { recursive: true });
  appendFileAt(abs, `${JSON.stringify(value)}\n`);
}

/** The launch list's entry for a seat, and what the capture needs from it. */
interface Binding {
  entry: string;
  role: CaptureRole;
  key: string;
  ids: string[];
  idsFrom: string;
  ordinal?: number;
  /** The launch-list entry's own role where it differs from the capture role's name: `verdict-after-readers`. */
  entryRole?: string;
  /** The launching Agent call's tool_use_id, from the reservation that confirms the binding. */
  launchToolUseId: string | null;
  /**
   * Build unit F4: the fold the entry's brief names (an answer seat's, or a verdict seat's after readers), read from the
   * entry record; A5 checks the seat's Reads against it (verification A, VA-2: it was read from the entry's id string).
   */
  fold?: string;
  /** A reader's candidate, from its payload: what its decisions are attached to, never the lines it names. */
  candidate?: string;
  /** The payload the entry's brief names (a verdict seat's or a reader's), whose excerpts count as opened
   * where the seat Read it whole. A refuter's brief carries no excerpt, and a silence investigator decides no row. */
  payload?: SeatPayload;
  /** A refuter entry's mode: `true` for a second look in challenge mode. */
  challenge?: boolean;
}

/** The payload an entry's brief names: `reads[]` role `payload` (the reading copy where one was written) and `payload_path`. */
function payloadOfEntry(entry: Record<string, unknown>): SeatPayload | undefined {
  const reads = Array.isArray(entry.reads) ? entry.reads : [];
  const r = reads.find((x): x is Record<string, unknown> => typeof x === "object" && x !== null && (x as Record<string, unknown>).role === "payload");
  if (!r || typeof r.path !== "string" || typeof entry.payload_path !== "string") return undefined;
  // Build unit F5: the model the entry launches the seat on, a premise of every place it reads (design section 4).
  const input = entry.agent_input as Record<string, unknown> | undefined;
  const model = input && typeof input === "object" && typeof input.model === "string" ? input.model : undefined;
  return { readPath: r.path, ...(typeof r.lines === "number" ? { lines: r.lines } : {}), payloadPath: entry.payload_path, ...(model ? { model } : {}) };
}

/** The fold file a launch-list entry's brief names (`fold.file`, written by launch-plan.ts under the launch directory). */
function foldOfEntry(entry: Record<string, unknown>): string | undefined {
  const fold = entry.fold as { file?: unknown } | undefined;
  return fold && typeof fold === "object" && typeof fold.file === "string" && fold.file !== "" ? fold.file : undefined;
}

const ROLE_OF_ENTRY: Record<string, CaptureRole> = {
  adjudicator: "adjudicator",
  "verdict-after-readers": "adjudicator",
  reader: "reader",
  refuter: "refuter",
  "silence-investigator": "silence-investigator",
};

type BindingResult = { ok: true; binding: Binding } | { ok: false; outcome: "unbound" | "not-captured"; reason: string; entry: string | null };

/**
 * The seat's binding: the latest `launched` event whose `seat` is the agent id and whose reservation agrees
 * (the launch unit's binding rule, hook-launch.ts seatBinding: a reservation or, for a seat a new attempt released, a
 * release line), its launch-list entry, and the ids the capture checks the answer against. A `launched` line no
 * reservation confirms is not a binding: a line appended by a script is ignored, and the seat's real binding holds.
 * The entry's key is `captureKeyOf` (launch-plan.ts), the one rule for it.
 * - adjudicator and reader entries: the ids and the file number from findings.json, as `verdict-capture
 *   --findings --key <the entry's key>` derives them. An adjudicator's are the entry's `finding_ids`, each of which must be
 *   a candidate of the payload: a payload may also hold candidates the declaration settled, which the launch brief
 *   does not hand the seat, and an answer to one of them (or to any id the entry does not name) is refused by name;
 * - refuter entries: the entry's `finding_ids`, under the entry's key where it has one (a refuter handed one
 *   candidate has none);
 * - silence-investigator entries: the entry's `rule_ids`, under its key (the batch name, its `capture_key`).
 */
export function bindingOf(ctx: HookContext, agentId: string): BindingResult {
  const run = ctx.run!;
  let events: ReturnType<typeof readLaunchEvents>["events"];
  try {
    ({ events } = readLaunchEvents(run.eventsPath));
  } catch (e) {
    // The launch unit's one reader refuses, by name, an events file it cannot read: the seat is then not bound here.
    return { ok: false, outcome: "unbound", reason: `the launch events ${valueText(run.eventsPath)} could not be read (${valueText((e as Error).message)})`, entry: null };
  }
  const bound = seatBinding(run.launchDir, events, agentId);
  const launched = bound.launched;
  const reservation = bound.confirmedBy;
  if (!launched || !reservation) {
    // A seat whose entry was launched again (its answer lost, presumed lost, or lost at the resume) binds
    // nothing, and the line says so: its late answer is kept and recorded for no entry, and the new seat answers it.
    const replaced = bound.naming > 0 ? relaunchOfSeat(run.launchDir, agentId) : null;
    if (replaced) {
      return {
        ok: false,
        outcome: "unbound",
        reason: `this seat's entry ${replaced.entry} was launched again at ${replaced.at} (${replaced.answer_lost}), so this seat binds nothing: its answer is kept and recorded for no entry, and the seat launched in its place answers the entry`,
        entry: null,
      };
    }
    if (bound.naming > 0) {
      const naming = bound.naming;
      const lines = `${naming} \`launched\` event${naming === 1 ? "" : "s"} in ${valueText(run.eventsPath)} name${naming === 1 ? "s" : ""} this agent id`;
      const gate = join(run.launchDir, "gate");
      return {
        ok: false,
        outcome: "unbound",
        reason: `${lines}, but neither a reservation under ${gate}/*/reserved/ nor a line of ${gate}/*/releases.jsonl holds that entry with this agent id as its seat: nothing the launch gate wrote confirms the line, so the launch hook did not write it (the launch unit's binding rule, hook-launch.ts seatBinding). The seat is not bound here: its answer is kept, not recorded, and its entry can be launched again`,
        entry: null,
      };
    }
    const why = existsSync(run.eventsPath) ? `no \`launched\` event in ${valueText(run.eventsPath)} names this agent id` : `there is no ${valueText(run.eventsPath)}`;
    return { ok: false, outcome: "unbound", reason: `${why}: the launch hook did not bind this seat to a launch-list entry (it timed out, failed, or was not there)`, entry: null };
  }
  const launchToolUseId = reservation.tool_use_id;
  const entryId = launched.entry;
  let entries: Record<string, unknown>[];
  // Through the one reader (program-file.ts). The list's digest on the active-run marker is
  // not compared here (the merge step's record says why: the capture's fixtures and the 42-seat replay plant a list no
  // marker records); the launch gate compares it at every launch and the seat-read hook at every Read of a listed file.
  const listRead = readProgramFile("the launch list", run.listPath);
  if (!listRead.ok) return { ok: false, outcome: "not-captured", reason: `the launch list ${valueText(run.listPath)} could not be read (${valueText(listRead.problem)})`, entry: entryId };
  try {
    entries = (JSON.parse(listRead.value.toString("utf8")) as { entries?: Record<string, unknown>[] }).entries ?? [];
  } catch (e) {
    return { ok: false, outcome: "not-captured", reason: `the launch list ${valueText(run.listPath)} could not be read (${valueText((e as Error).message)})`, entry: entryId };
  }
  const entry = entries.find((x) => x.id === entryId);
  if (!entry) return { ok: false, outcome: "not-captured", reason: `the launch list has no entry ${entryId}`, entry: entryId };
  const role = ROLE_OF_ENTRY[String(entry.role)];
  if (!role) return { ok: false, outcome: "not-captured", reason: `the entry ${entryId} has the role ${JSON.stringify(entry.role)}, which no capture role matches`, entry: entryId };
  // The one rule for an entry's key (launch-plan.ts captureKeyOf): a silence entry's is its `capture_key`.
  const key = captureKeyOf(entry) ?? "";
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  if (role === "adjudicator" || role === "reader") {
    const handed = handedFromFindings(run.findingsPath, key, role);
    if (handed.problem !== undefined) return { ok: false, outcome: "not-captured", reason: handed.problem, entry: entryId };
    const listed = strings(entry.finding_ids);
    if (role === "adjudicator") {
      // Bound when every id the entry names is a candidate of its payload; the answer is checked against those ids only.
      const inPayload = new Set(handed.ids);
      const outside = listed.filter((id) => !inPayload.has(id));
      if (listed.length === 0 || outside.length > 0) {
        const what = listed.length === 0
          ? "names no finding id"
          : `names ${outside.map((id) => JSON.stringify(id)).join(", ")}, which ${outside.length === 1 ? "is not a candidate" : "are not candidates"} of ${JSON.stringify(key)} in findings.json`;
        return { ok: false, outcome: "not-captured", reason: `the launch list's entry ${entryId} ${what}`, entry: entryId };
      }
      const named = new Set(listed);
      const ids = handed.ids.filter((id) => named.has(id));
      const idsFrom = ids.length === handed.ids.length ? `findings:${run.findingsPath}#${key}` : `launch-list:${entryId} (candidates of findings:${run.findingsPath}#${key})`;
      const fold = foldOfEntry(entry);
      return { ok: true, binding: { entry: entryId, role, key, ids, idsFrom, ordinal: handed.ordinal, entryRole: String(entry.role), launchToolUseId, payload: payloadOfEntry(entry), ...(fold ? { fold } : {}) } };
    }
    if (!(listed.length === 0 || handed.candidate === "" || listed.includes(handed.candidate))) {
      return { ok: false, outcome: "not-captured", reason: `the launch list's entry ${entryId} and findings.json disagree on the candidates of ${JSON.stringify(key)}`, entry: entryId };
    }
    return { ok: true, binding: { entry: entryId, role, key, ids: handed.ids, idsFrom: `findings:${run.findingsPath}#${key}`, ordinal: handed.ordinal, launchToolUseId, candidate: handed.candidate, payload: payloadOfEntry(entry) } };
  }
  const ids = role === "refuter" ? strings(entry.finding_ids) : strings(entry.rule_ids);
  if (ids.length === 0) return { ok: false, outcome: "not-captured", reason: `the entry ${entryId} hands no ids`, entry: entryId };
  return { ok: true, binding: { entry: entryId, role, key, ids, idsFrom: `launch-list:${entryId}`, launchToolUseId, ...(role === "refuter" ? { challenge: isChallengeEntry(entry) } : {}) } };
}

/** What the seat reads when its answer is refused: the capture's refusal, and what to do next. */
export function refusalFor(role: CaptureRole, problems: string[], n: number, event: HookCaptureEvent): string {
  const how = event === "PreToolUse:SubagentHandback"
    ? "Call SubagentHandback again with your whole corrected answer as its message."
    : "Reply again with your whole corrected answer as your final message.";
  // Amend on refusal (amend.ts): the answer is kept, and the next may be only its fixes.
  const amend = role === "silence-investigator"
    ? ""
    : role === "reader"
      ? " Or send only the decisions you change, keyed by `place` (a place row) or by `unit` (or `units`): each replaces that unit's decision in this answer, the rest is kept from it except a row this refusal tells you to remove, and the whole is checked again."
      : role === "adjudicator"
        ? // The rule is the same for both forms, and the refusal above states it once (verdict-capture.ts `renderRefusal`).
          " Or send only what this refusal names: for each candidate it names, its `finding_id` and the fields it names, and in `decisions` only the decisions you change, keyed by `place` (a place row) or by `unit` (or `units`). Either way the rule above holds, and the whole is checked again."
        : " Or send only what this refusal names: for each candidate it names, its `finding_id` and the fields it names, and in `decisions` only the decisions you change, keyed by `place` (a place row) or by `unit` (or `units`). Each replaces its counterpart in this answer, everything you leave out is kept from it except a row or object this refusal tells you to remove or says is not kept, and the whole is checked again; a field the refusal did not name must be left out.";
  return [
    renderRefusal(role, problems).trimEnd(),
    "",
    // An adjudicator's answer whose only defects after the last
    // refusal are parts of `standing` is used with those parts set aside (verdict-capture.ts `lastAnswer`): said here too. A
    // block on a verdict that takes none is not read, so "at its heaviest" is said only of a part that orders the finding (m5).
    `This is refusal ${n} of at most ${REFUSALS_MAX}. ${how}${amend} If the answer after the last refusal is still not accepted, it is kept as it is, marked invalid, and your candidates are reported as not judged${role === "adjudicator" ? "; except where all that is still wrong with it is in `standing`: then the answer is used, those parts are set aside, and each finding is placed as if any of them that orders it were at its heaviest" : ""}.`,
  ].join("\n");
}

/** What takeAnswer tells its caller beside the decision: the make-up entry it added, if any (U2 item 1). */
export interface ReceiptNote {
  madeUp?: string;
}

/** The sentence that says where a make-up entry is named: among the launches below, or later (U2 item 1). */
export function madeUpWhere(madeUp: string, next: readonly string[]): string {
  return next.some((l) => l.includes(`entry ${madeUp} `))
    ? `Entry ${madeUp} is among the entries named below.`
    : `Entry ${madeUp} is not launchable yet; a later receipt or launch-next names it when it is.`;
}

function receipt(text: string): HookDecision {
  return { kind: "replace-input", updatedInput: { message: `wolfboy: ${text}` } };
}

/** How every auto-mode stop without an accepted hand-back is described in the hook ledger (the gate reads it). */
const AUTO_STOP = "the seat stopped in auto mode without an accepted SubagentHandback";

/** The state record of the seats' answers the hook took (state-record.ts). */
export const SEAT_CAPTURES_FILE = "seat-captures.jsonl";

/**
 * One line of `seat-captures.jsonl`: what Claude Code handed this hook for a seat (its agent id, session, the call, the
 * session's and the seat's own transcript paths) and what the hook made of it (the entry, the launching call, the
 * answer's sha256 and the record it wrote), kept in the person's state folder, which no file tool may write in any
 * session. The assembly takes a record's provenance and every transcript path from these lines only, never from
 * `.legal/capture` (assemble-hooked.ts `transcriptCheck`). A line that cannot be written is a hook failure: the record
 * it would vouch for is then refused at assembly, which the launch gate makes rare by checking the record's place before
 * any seat launches (hook-launch.ts `assemblyBlocked`).
 */
export interface SeatCaptureLine {
  v: 1;
  at: string;
  kind: "accepted" | "stopped" | "kept";
  agent_id: string;
  session_id: string | null;
  event: string;
  tool_use_id: string | null;
  transcript_path: string | null;
  agent_transcript_path: string | null;
  entry: string | null;
  launch_tool_use_id?: string | null;
  answer_sha256?: string;
  record?: { file: string; sha256: string };
  /** A `kept` line: the files of place rows kept apart from a verdict that did not hold (state-record.ts `keptPlacesNamed`). */
  places_kept?: PlacesKept[];
  /** The run whose marker stood when a `kept` line was written: the assembly takes a run's kept files from its own lines only. */
  run_id?: string | null;
}

export function noteSeatCapture(run: NonNullable<HookContext["run"]>, input: HookContext["input"], line: SeatCaptureLine, now: Date): void {
  try {
    appendFileAt(launchRecordPath(run.launchDir, SEAT_CAPTURES_FILE, true), `${JSON.stringify(line)}\n`);
  } catch (e) {
    recordHookFailure(run, input, { stage: "capture", error: `the seat's line in the state folder could not be written: ${valueText(e instanceof Error ? e.message : String(e))}` }, now);
  }
}

/**
 * Take one answer. `answer` is the text as the hook received it; `event` says which hook read it. Returns
 * the decision for that hook: a receipt, a deny or a block, or pass. `autoStop`: SubagentStop in auto mode with
 * nothing taken, where the last message is read as the answer and a refusal cannot be sent back (the stop is never
 * blocked): it is read as an answer after the last refusal (only parts of `standing` wrong: used, those parts set aside);
 * refused for anything else, it is kept as not-captured, or marked invalid past the cap.
 */
export function takeAnswer(ctx: HookContext, text: string, event: HookCaptureEvent, autoStop = false, note: ReceiptNote = {}, giveUp?: string): HookDecision {
  const run = ctx.run;
  if (!run || !existsSync(run.legalDir)) return PASS; // no run in this project: nothing to write into
  const input = ctx.input;
  const agentId = input.agent_id as string;
  const auto = event === "PreToolUse:SubagentHandback";
  const answer = Buffer.from(text, "utf8");
  const started = Date.now();
  const at = ctx.now().toISOString();
  // Every ledger line this check writes carries its duration.
  const ledger = (line: HookLedgerLine): void => appendLine(run.legalDir, HOOK_LEDGER, { ...line, took_ms: Date.now() - started } satisfies HookLedgerLine);
  const history = seatHistory(run.legalDir, agentId);
  const refusals = history.filter((l) => l.outcome === "refused");
  const base = {
    v: 1 as const,
    at,
    agent_id: agentId,
    agent_type: String(input.agent_type ?? ""),
    session_id: typeof input.session_id === "string" ? input.session_id : null,
    event,
    permission_mode: typeof input.permission_mode === "string" ? input.permission_mode : null,
    tool_use_id: typeof input.tool_use_id === "string" ? input.tool_use_id : null,
    transcript_path: typeof input.transcript_path === "string" ? input.transcript_path : null,
    agent_transcript_path: typeof input.agent_transcript_path === "string" ? input.agent_transcript_path : null,
    ...(event === "SubagentStop" ? { agent_effort: transcriptEffort(typeof input.agent_transcript_path === "string" ? input.agent_transcript_path : null) } : {}),
  };
  const lead = autoStop ? `${AUTO_STOP}${refusals.length ? ` (after ${refusals.length} refusal${refusals.length === 1 ? "" : "s"})` : ""}; its last message is kept whole: ` : "";
  const returned = (entry: string | null) => {
    if (entry) appendTo(run.eventsPath, { entry, event: "returned", at, seat: agentId } satisfies LaunchEvent);
  };
  /* THE MAKE-UP SEAT (design 1.7; build unit F3): a seat of a place-plan candidate whose answer stays invalid after the
   * last refusal leaves all its places undecided (the capture is all-or-nothing), and they are given once to a fresh
   * seat. Only here: a seat whose answer was lost (not captured, or presumed lost) is already launched again by the
   * relaunch rule (entry-answer.ts `relaunchable`), which refuses only an invalid one. Appended BEFORE the seat is
   * recorded as returned, so no receipt launches what waits for it in between (launch-later.ts `runMakeupEntries`,
   * which decides whether the entry gets one). A refusal is recorded as a hook failure; the places are then recorded
   * not checked (no answer) at assembly, as a make-up seat's own would be. */
  const makeUp = (entry: string | null): string | null => {
    if (entry === null || !eventInActiveRun(ctx)) return null;
    try {
      const r = runMakeupEntries({ legal: run.legalDir, launchDir: run.launchDir, entry });
      if (r.exit !== MAKEUP_EXIT.written) recordHookFailure(run, input, { stage: "makeup", error: r.lines.join(" ") }, ctx.now());
      return r.made;
    } catch (e) {
      recordHookFailure(run, input, { stage: "makeup", error: e instanceof Error ? e.message : String(e) }, ctx.now());
      return null;
    }
  };
  const settledBefore = history.find((l) => l.outcome !== "refused");
  // The kept place rows' files, named with their sha256 in the state folder,
  // where a later seat's brief, its capture and the assembly take them from (state-record.ts `keptPlacesNamed`).
  const noteKept = (entry: string | null, placesKept: PlacesKept[]): void => {
    const marker = readActiveRun(run.launchDir);
    noteSeatCapture(run, input, { v: 1, at, kind: "kept", run_id: marker.state === "active" ? marker.marker.run_id : null, agent_id: agentId, session_id: base.session_id, event, tool_use_id: base.tool_use_id, transcript_path: base.transcript_path, agent_transcript_path: base.agent_transcript_path, entry, places_kept: placesKept }, ctx.now());
  };
  const keep = (outcome: "unbound" | "not-captured", reason: string, entry: string | null, role: CaptureRole | null, placesKept: PlacesKept[] = []): HookDecision => {
    const kept = keepWhole(run.legalDir, agentId, answer);
    const line: HookLedgerLine = { ...base, outcome, entry, role, answer: { sha256: sha256(answer), bytes: answer.length, kept }, reason: lead + reason, ...(placesKept.length > 0 ? { places_kept: placesKept } : {}) };
    ledger(line);
    if (placesKept.length > 0) noteKept(entry, placesKept);
    if (!settledBefore) returned(entry);
    // U2 item 1: a receipt reaches the relay as a peer's
    // message, so it states facts and the program's next step in neutral words; the reason is in the hook ledger line.
    return auto ? receipt(`the program kept this answer at .legal/${kept}; no record was written from it, and the hook ledger (.legal/${HOOK_LEDGER}) records why.`) : PASS;
  };
  if (settledBefore) return keep("not-captured", `this seat's answer was already taken (${settledBefore.outcome}, ${settledBefore.at}); a later answer is kept, not read`, settledBefore.entry, settledBefore.role);

  const bound = bindingOf(ctx, agentId);
  if (!bound.ok) return keep(bound.outcome, bound.reason, bound.entry, null);
  const b = bound.binding;
  // The answer's checks kept ending before they decided: it is kept whole, unchecked, with why.
  if (giveUp !== undefined) return keep("not-captured", giveUp, b.entry, b.role);
  const via: CaptureVia = {
    how: "hook",
    event,
    entry: b.entry,
    session_id: base.session_id,
    tool_use_id: base.tool_use_id,
    permission_mode: base.permission_mode,
    refusals_before: refusals.length,
    transcript_path: base.transcript_path,
    agent_transcript_path: base.agent_transcript_path,
    launch_tool_use_id: b.launchToolUseId,
  };
  // Every rule step 5a applies to one seat's answer is applied here, while the seat can still answer again:
  // an adjudicator's verdicts and a reader's reply are held to the rules step 5a
  // runs, over the record step 5a writes (reading-assembly.ts `answerRulesAtCapture`).
  /* READ MEANS OPENED: what the seat's own transcript shows it opened, read
   * now, at the hand-back or the stop. SubagentStop names that transcript; PreToolUse:SubagentHandback names only the
   * session's, beside which the host keeps it. Always passed: a transcript that cannot be read shows nothing opened, so
   * every row the seat answered as opened is recorded as not opened. Found by the one lookup the assembly's
   * transcript check uses (seat-opened.ts `seatTranscriptOf`), with its stamp, so a premise below is taken only from
   * lines that check would accept as the seat's own. */
  const seatTranscript = seatTranscriptOf({ named: base.agent_transcript_path, session: base.transcript_path, agentId, sessionId: base.session_id });
  const ownTranscript = seatTranscript.own;
  const sight = seatSightOf({ transcript: ownTranscript, agentId, payload: b.payload ?? null, ...(seatTranscript.stamp ? { stamp: seatTranscript.stamp } : {}) });
  /* What the seat ran under, taken now, when it ends, from the plugin the host loaded and from its own
   * transcript - written on every record and place row it gives, so a later run compares what it actually ran under. */
  // The effort is taken from the seat's own lines on both routes - with the stamp at the place, by its
  // agent id where an event named the transcript - as the sight above takes its Reads.
  const basis = b.role === "adjudicator" || b.role === "reader" ? { effort: transcriptEffort(ownTranscript, seatTranscript.stamp ?? { agentId }), instructions: instructionsPremise().premise } : undefined;
  const rules = b.role !== "silence-investigator" ? answerRulesAtCapture(run.findingsPath, join(run.legalDir, "readers"), sight, b.payload, b.fold, () => carriedRepliesOfLaunchDir(run.launchDir), basis) : undefined;
  const entryRule = b.role === "adjudicator" ? rules?.verdict : undefined;
  const replyRule = b.role === "reader" && rules ? (reply: unknown) => rules.reader(reply, b.ids) : undefined;
  const convert = rules ? decisionsConverter(b.role, rules, b.key, b.candidate ?? "") : undefined;
  // The last refused answer, kept with what its refusal named: the next answer may amend it (amend.ts).
  const last = refusals.at(-1);
  const baseFile = last?.answer?.kept && last.refusal?.named ? last.answer.kept : null;
  const amend = baseFile && last?.refusal?.named && existsSync(join(run.legalDir, baseFile))
    ? { base: programFileBytes("the refused answer kept", join(run.legalDir, baseFile)), named: last.refusal.named, baseFile, ...(last.refusal.removed ? { removed: last.refusal.removed } : {}), ...(last.refusal.strict ? { strict: last.refusal.strict } : {}) }
    : undefined;
  const replaceSetAside = (rel: string, previousSha256: string) => setAsideReplacement(run.launchDir, run.legalDir, b.entry, rel, previousSha256);
  // The answer after the last refusal: a wait's
  // refusal alone then sets that wait aside instead of keeping the whole answer invalid (verdict-capture.ts `lastAnswer`). So is an auto-mode seat that stopped without handing its
  // answer back (`autoStop`): no refusal can reach it either. Every failing part of `standing` is refused now, where before
  // all but a wait were set aside on the first answer; without this, such an answer would be kept whole as not captured and
  // its entry launched again (entry-answer.ts `relaunchable`, a whole new seat), for a part that before only took its
  // heaviest value. (m3) It also
  // sets aside at once a wait naming nothing on such a seat, which the base (refusing it since R15-B) launched again: that
  // finding goes "to fix" at its heaviest, the 0.1.0 placement, never lighter.
  const lastAnswer = refusals.length >= REFUSALS_MAX || autoStop;
  // The finding each answer makes, for the guard on a resend.
  const weigh = b.role === "adjudicator" ? rules?.weigh : undefined;
  const result = captureAnswer({ role: b.role, seat: agentId, key: b.key || undefined, ordinal: b.ordinal, ids: b.ids, idsFrom: b.idsFrom, answer, legalDir: run.legalDir, at, via, entryRule, replyRule, convert, amend, replaceSetAside, lastAnswer, ...(weigh ? { weigh } : {}), ...(b.challenge !== undefined ? { challenge: b.challenge } : {}) });
  const amends = result.outcome === "written" ? result.entry.amends : undefined;
  if (result.outcome === "written") {
    ledger({
      ...base,
      outcome: "accepted",
      entry: b.entry,
      role: b.role,
      answer: { sha256: sha256(answer), bytes: answer.length, kept: null },
      record: { file: result.entry.file, sha256: result.entry.sha256 },
      ...(result.entry.normalised ? { normalised: result.entry.normalised } : {}),
      ...(amends ? { merged: { sha256: result.entry.reply.sha256, bytes: result.entry.reply.bytes, kept: null, base: amends.base_file } } : {}),
    } satisfies HookLedgerLine);
    noteSeatCapture(run, input, { v: 1, at, kind: "accepted", agent_id: agentId, session_id: base.session_id, event, tool_use_id: base.tool_use_id, transcript_path: base.transcript_path, agent_transcript_path: base.agent_transcript_path, entry: b.entry, launch_tool_use_id: b.launchToolUseId ?? null, answer_sha256: sha256(answer), record: { file: result.entry.file, sha256: result.entry.sha256 } }, ctx.now());
    returned(b.entry);
    return auto ? receipt(`answer received and written as .legal/${result.entry.file} (sha256 ${result.entry.sha256.slice(0, 16)}, ${result.entry.bytes} bytes). The program holds it; there is nothing to copy.`) : PASS;
  }
  if (result.outcome === "refused") {
    const n = refusals.length + 1;
    // Unit U1: a seat whose answer ends here without a record keeps the place rows that passed the place checks.
    const placesKept = (): PlacesKept[] => (result.placesPassed ? keepReadPlaces(run.legalDir, agentId, result.placesPassed) : []);
    if (n <= REFUSALS_MAX && autoStop) {
      return keep("not-captured", `read as its answer, it was not accepted, and a seat that has stopped cannot be sent a refusal (${result.problems.join("; ")})`, b.entry, b.role, placesKept());
    }
    // The answer the capture checked (the merged whole, where it was an amendment), kept for the next one to amend.
    const checked = result.checked ?? answer;
    const merged = result.checked && baseFile ? { sha256: sha256(checked), bytes: checked.length, kept: keepWhole(run.legalDir, agentId, checked, REFUSED_DIR), base: baseFile } : undefined;
    if (n <= REFUSALS_MAX) {
      ledger({
        ...base,
        outcome: "refused",
        entry: b.entry,
        role: b.role,
        answer: { sha256: sha256(answer), bytes: answer.length, kept: merged ? merged.kept : keepWhole(run.legalDir, agentId, answer, REFUSED_DIR) },
        ...(merged ? { merged } : {}),
        refusal: { n, of: REFUSALS_MAX, problems: result.problems, named: result.named, ...(result.strict ? { strict: result.strict } : {}), ...(result.removed ? { removed: result.removed } : {}) },
      } satisfies HookLedgerLine);
      const reason = refusalFor(b.role, result.problems, n, event);
      return auto ? { kind: "deny", reason } : { kind: "block", reason };
    }
    const kept = keepWhole(run.legalDir, agentId, answer);
    // No earlier answer of the seat is taken in this one's
    // place: the seat's candidates are reported as not judged.
    const keptPlaces = placesKept();
    if (keptPlaces.length > 0) noteKept(b.entry, keptPlaces);
    ledger({
      ...base,
      outcome: "invalid",
      entry: b.entry,
      role: b.role,
      answer: { sha256: sha256(answer), bytes: answer.length, kept },
      ...(merged ? { merged } : {}),
      refusals: [...refusals.map((l) => ({ n: l.refusal?.n ?? 0, problems: l.refusal?.problems ?? [] })), { n, problems: result.problems }],
      ...(keptPlaces.length > 0 ? { places_kept: keptPlaces } : {}),
    } satisfies HookLedgerLine);
    const madeUp = makeUp(b.entry);
    returned(b.entry);
    // U2 item 1: neutral words, and no claim about the launches below: onHandback says whether the make-up
    // entry is among them (in run fm1 this receipt named one seat as "launched as listed below" and listed another).
    if (madeUp) note.madeUp = madeUp;
    const after = madeUp ? `the program added launch-list entry ${madeUp} for this seat's places` : "the report lists this seat's candidates as not judged";
    return auto
      ? receipt(`this seat's answer is settled without a record: it is kept at .legal/${kept}, the hook ledger (.legal/${HOOK_LEDGER}) records why, and ${after}.`)
      : PASS;
  }
  if (result.outcome === "validator-unavailable") recordHookFailure(run, input, { stage: "capture", error: `the reply validator is unavailable: ${result.reason}` }, ctx.now());
  return keep("not-captured", result.reason, b.entry, b.role);
}

/**
 * A verdict seat's readers' fold, written as its entry's `fold.command` writes it (SKILL.md step 4): the command's
 * `verdict-reading` and the words after it, run by this program's own CLI beside this module. What stands before them
 * is never run: it names the program (scanner-command.ts `scannerCommand`: the plugin's launcher, or a Node and the
 * CLI's `index.js`; a bare `legal-scan` in a launch list written before told commands all took that form), read by the one reading of that shape both readers share
 * (scanner-command.ts `verdictReadingAt`, which reads a launcher path with either separator). The words are read as a
 * shell reads them, by the reader of the one writer of told commands (scanner-command.ts `toldCommandWords`): each
 * word in single quotes, or in double quotes where it holds `'`; a launch list written before section 11 of that
 * record, with double-quoted paths or a bare `legal-scan` and plain paths, is read only where the shell would read
 * every word as itself, and a command whose reading would need a shell (a `$`, a backtick, a `\` that bash's double
 * quotes would not keep) is refused, so the fold written here is the fold the command, run as written, would write. Nothing is run through a shell here: `verdict-reading` and the words after it go to this CLI as an
 * argument list.
 */
function runFoldCommand(command: string): { ok: true } | { ok: false; problem: string } {
  const words = toldCommandWords(command);
  if (words === null) return { ok: false, problem: "the entry's fold command holds characters a shell would expand, so it is not read" };
  const at = verdictReadingAt(words);
  if (at < 0) return { ok: false, problem: "the entry's fold command is not a legal-scan verdict-reading command" };
  const cli = join(dirname(fileURLToPath(import.meta.url)), "index.js");
  const r = spawnSync(process.execPath, [cli, ...words.slice(at)], { encoding: "utf8", timeout: 8000, stdio: ["ignore", "ignore", "pipe"] });
  if (r.status === 0) return { ok: true };
  const said = (r.stderr ?? "").trim().split("\n")[0] ?? "";
  return { ok: false, problem: said !== "" ? said.slice(0, 300) : r.error ? r.error.message : `exit ${String(r.status)}` };
}

/**
 * M1: where an auto-mode receipt is written for a seat of
 * the active run, it also names what comes next, so that whoever launches - the main session, or the relay, whose only
 * tool is Agent - launches from the receipt instead of running the program's commands between launches:
 * - an accepted adjudicator record: its refuter entries, appended as `refuter-entries --record <the record>` appends them;
 * - a verdict seat after readers that is to launch now: its readers' fold, written as its entry's fold command writes it;
 * - then what to launch now, each entry with its exact Agent input, from the launch gate's own computation
 *   (hook-launch.ts `receiptNextLines`, the computation `launch-next` prints).
 * Each step that fails is named in the receipt and the rest goes on; the launch gate still checks every launch.
 */
async function nextForReceipt(ctx: HookContext): Promise<string[]> {
  const run = ctx.run;
  if (!run || !existsSync(join(run.launchDir, "active-run.json"))) return [];
  const hl = await import("./hook-launch.js");
  if (!hl.eventInActiveRun(ctx)) return [];
  const lines: string[] = [];
  const refuters = await appendRefuterEntries(ctx, run);
  if (refuters !== null) lines.push(refuters);
  // This seat's receipt is read only once its report is delivered, when Claude Code has freed
  // its place, so its own place counts as free here; and each launch the receipt names is this receipt's until then.
  const seat = typeof ctx.input.agent_id === "string" && ctx.input.agent_id !== "" ? ctx.input.agent_id : null;
  const read = await hl.nextLaunchesNow(run.launchDir, ctx.now(), seat);
  if (read.state === "active") {
    for (const x of read.next.launch) {
      const fold = (x.entry as { fold?: { file?: unknown; command?: unknown } }).fold;
      if (!fold || typeof fold.file !== "string" || typeof fold.command !== "string" || existsSync(fold.file)) continue;
      const done = runFoldCommand(fold.command);
      lines.push(done.ok ? `The readers' fold of entry ${x.entry.id} was written to ${fold.file}.` : `The readers' fold of entry ${x.entry.id} was not written (${valueText(done.problem)}); until it is, the launch gate refuses that entry. Its command: ${toldFoldCommand(fold.command) ?? FOLD_NOT_TOLD}`);
    }
  }
  // R13: the session transcript locates the relay's own, whose context is one of the relay's two bounds.
  const next = hl.receiptNextLines(read, process.env, typeof ctx.input.transcript_path === "string" ? ctx.input.transcript_path : null, ctx.now(), seat);
  // W1: a receipt that names no launch is one short line, without the refuter line that points at launches below.
  if (next.length === 1 && next[0] === hl.NOTHING_NEW && lines.every((l) => l.endsWith(REFUTERS_RAN))) return next;
  lines.push(...next);
  return lines;
}

const REFUTERS_RAN = "refuter-entries has run; any entry it appended that is launchable now is among the launches below.";

/**
 * M1's refuter step for the seat's taken answer, where it is an accepted adjudicator record: its refuter entries, appended
 * as `refuter-entries --record <the record>` appends them. Null where there is nothing to append for. Run wherever the
 * capture takes such an answer in auto mode: in the receipt, and at
 * SubagentStop, whose answer makes no receipt and was before left for the report step to find without its entries.
 */
async function appendRefuterEntries(ctx: HookContext, run: NonNullable<HookContext["run"]>): Promise<string | null> {
  const agentId = String(ctx.input.agent_id ?? "");
  const taken = seatHistory(run.legalDir, agentId).filter((l) => l.outcome !== "refused").at(-1);
  if (taken?.outcome !== "accepted" || (taken.role !== "adjudicator" && taken.role !== "refuter") || !taken.record) return null;
  const rel = `.legal/${taken.record.file}`;
  /* A refuter's record gives an entry only where it overturns a finding on a
   * location ground of a rule that opts in (its second look); a refuter record for which the command would do nothing says
   * nothing in the receipt. One it would refuse, or whose looks it would hold back, is run all the same, so the receipt
   * carries the refusal's line, and the command records each hold with its reason on the launch list. */
  let heldLooks: string[] = [];
  if (taken.role === "refuter") {
    try {
      const { refuterEntriesPreview } = await import("./launch-later.js");
      const { readLaunchList } = await import("./launch-list-file.js");
      const l = readLaunchList(join(run.launchDir, "launch-list.json"));
      // A launch list that does not read is a refusal of the command too: the command is run below, and the receipt
      // carries its line, rather than saying nothing.
      if (l.ok) {
        const v = refuterEntriesPreview({ record: join(run.legalDir, taken.record.file), legal: run.legalDir, launchDir: run.launchDir }, l.value);
        if (v.kind === "none") return null;
        if (v.kind === "due") heldLooks = v.held.map((h) => h.finding_id);
      }
    } catch {
      return null;
    }
  }
  // A run that did not append names the command that does; the relay cannot run it, and its hand-back names it to the
  // main session while no run of refuter-entries is recorded for the record (hook-launch.ts `refuterEntriesDue`). A refusal
  // can stand when the command is run again, so the words say what holds until it runs without refusing; and for a refuter's
  // record, which refuses before it reads whether the record's overturns are due a look, only where one is.
  const later =
    taken.role === "refuter"
      ? `where the record overturns a finding on a location ground of a rule that opts in, that finding's second look has no entry until ${toldArgs(["refuter-entries", "--record", rel])} runs without refusing, which the main session runs (a relay's hand-back names it); until then the report shows that look as not answered.`
      : `until it has run without refusing, the record's violation candidates have no refuter entry: ${toldArgs(["refuter-entries", "--record", rel])} appends them once it does, which the main session runs (a relay's hand-back names it).`;
  const heldSaid = heldLooks.length > 0 ? ` It held back the second look at ${heldLooks.join(", ")}: no entry could be written for it, the reason is recorded on the launch list, and the report shows that look as not answered.` : "";
  try {
    const { runRefuterEntries, LATER_EXIT } = await import("./launch-later.js");
    const r = runRefuterEntries({ record: join(run.legalDir, taken.record.file), legal: run.legalDir, launchDir: run.launchDir });
    // The receipt reaches the relay, which needs only the launches: where refuter-entries wrote,
    // it says so and not what it found, since its own line counts the record's violation candidates and, where there
    // are none, names that verdict. The entries it appended are named with their inputs in the lines below once
    // launchable. A refusal keeps the program's line: it names a problem, not a verdict.
    return r.exit === LATER_EXIT.written
      ? `Refuter entries for ${rel}: ${REFUTERS_RAN}${heldSaid}`
      : `Refuter entries for ${rel}, as refuter-entries writes them: ${r.lines[0] ?? `exit ${r.exit}`}; ${later}`;
  } catch (e) {
    return `Refuter entries for ${rel}: not written (${valueText(e instanceof Error ? e.message : String(e))}); ${later}`;
  }
}

/**
 * PreToolUse on SubagentHandback, for this plugin's seats: the answer is the hand-back's message. A receipt that replaces
 * it also names what comes next (M1, `nextForReceipt`).
 */
export async function onHandback(ctx: HookContext): Promise<HookDecision> {
  const ti = ctx.input.tool_input;
  const message = ti && typeof ti === "object" ? (ti as Record<string, unknown>).message : undefined;
  const text = typeof message === "string" ? message : "";
  let note: ReceiptNote = {};
  let decision: HookDecision;
  const run = ctx.run;
  const agentId = typeof ctx.input.agent_id === "string" ? ctx.input.agent_id : "";
  if (run && existsSync(run.legalDir) && agentId !== "") {
    // The check store first (HANDBACK_CHECKS): a decision this answer was already given
    // but never delivered, or a check of it still running.
    const sha = sha256(Buffer.from(text, "utf8"));
    const toolUseId = typeof ctx.input.tool_use_id === "string" ? ctx.input.tool_use_id : null;
    const at = () => ctx.now().toISOString();
    const stored = storedCheck(run.legalDir, agentId, sha, toolUseId, at);
    if (stored?.kind === "wait") return { kind: "deny", reason: STILL_CHECKING };
    if (stored?.kind === "served") {
      decision = stored.decision;
      note = { ...stored.note };
      // Its entry has ended during the serve: nothing is computed for
      // nobody, and the decision stays undelivered (this call's own deadline line says so), so the next call is given it.
      if (ctx.entryGone?.()) return decision;
    } else {
      const check = `${process.pid}-${Date.now()}`;
      appendLine(run.legalDir, HANDBACK_CHECKS, { v: 1, at: at(), step: "begun", agent_id: agentId, sha256: sha, tool_use_id: toolUseId, check, pid: process.pid } satisfies HandbackCheckLine);
      const giveUp = stored?.kind === "exhausted"
        ? `the program's check of this answer was begun ${stored.attempts} times and each ended before it decided (its process ended first, at the latest at the check's own limit of ${CAPTURE_HANDBACK_LIMIT_MS / 1000} s), so the answer is kept whole and not checked`
        : undefined;
      decision = takeAnswer(ctx, text, "PreToolUse:SubagentHandback", false, note, giveUp);
      appendLine(run.legalDir, HANDBACK_CHECKS, { v: 1, at: at(), step: "decided", agent_id: agentId, sha256: sha, tool_use_id: toolUseId, check, decision, ...(Object.keys(note).length > 0 ? { note } : {}) } satisfies HandbackCheckLine);
      // Its entry has ended: this decision reaches nobody until the same answer is sent again, which is given it then, with
      // what comes next computed at that time (no launch is named here to no one).
      if (ctx.entryGone?.()) return decision;
    }
  } else {
    decision = takeAnswer(ctx, text, "PreToolUse:SubagentHandback", false, note);
  }
  if (decision.kind !== "replace-input") return decision;
  const next = await nextForReceipt(ctx);
  const head = note.madeUp ? `${String(decision.updatedInput.message)} ${madeUpWhere(note.madeUp, next)}` : String(decision.updatedInput.message);
  const receiptText = [head, ...next].join(next.length === 1 ? " " : "\n");
  if (typeof message !== "string") return { kind: "replace-input", updatedInput: { ...decision.updatedInput, message: receiptText } };
  // The receipt keeps every other field of the call's input as it was.
  return { kind: "replace-input", updatedInput: { ...(ti as Record<string, unknown>), ...decision.updatedInput, message: receiptText } };
}

/**
 * SubagentStop, for this plugin's seats. Outside auto mode the last message is the answer. In auto mode the
 * answer came (or should have come) by SubagentHandback and the last message is usually a closing sentence (probe
 * fact (b)):
 * - nothing taken yet: the last message is read as the answer (takeAnswer with `autoStop`), so a correct answer given
 *   only there is recorded; the stop always goes ahead;
 * - the answer already taken: one `stopped` line per agent id records the seat's own transcript, which only this
 *   event carries, for assembly's check of the record against it (P:277).
 */
export async function onSubagentStop(ctx: HookContext): Promise<HookDecision> {
  const started = Date.now();
  const lam = ctx.input.last_assistant_message;
  const text = typeof lam === "string" ? lam : "";
  if (ctx.input.permission_mode !== "auto") {
    // Outside auto mode too, an accepted adjudicator (or refuter) record gets its refuter
    // entries here, as an auto-mode stop's does (below), so the main session runs one command per returned seat (launch-next, which
    // lists them), not two; each is a permission prompt where auto mode is off. A record the capture could not run it for is
    // named by launch-next (REFUTER ENTRIES DUE), and refuter-entries stays the main session's command for it.
    const run = ctx.run;
    const agentId = String(ctx.input.agent_id ?? "");
    const settledBefore = !run || !existsSync(run.legalDir) || seatHistory(run.legalDir, agentId).some((l) => l.outcome !== "refused");
    const decision = takeAnswer(ctx, text, "SubagentStop");
    if (run && !settledBefore && existsSync(join(run.launchDir, "active-run.json")) && (await import("./hook-launch.js")).eventInActiveRun(ctx)) await appendRefuterEntries(ctx, run);
    return decision;
  }
  const run = ctx.run;
  if (!run || !existsSync(run.legalDir)) return PASS;
  const agentId = ctx.input.agent_id as string;
  // A check of this seat's hand-back still running (let go at its entry's deadline) is
  // waited for, up to STOP_WAIT_MS, so that the stop reads what it decided instead of taking the last message.
  for (const until = Date.now() + STOP_WAIT_MS; liveChecks(readHandbackChecks(run.legalDir).filter((l) => l.agent_id === agentId)).length > 0 && Date.now() < until; ) pause(250);
  const history = seatHistory(run.legalDir, agentId);
  const settled = history.find((l) => l.outcome !== "refused");
  if (!settled) {
    takeAnswer(ctx, text, "SubagentStop", true);
    // An answer taken here makes no receipt, and still gets its refuter entries, as the receipt's would, where it is
    // an accepted adjudicator record of the active run; the next receipt, launch-next and the relay's hand-back name them.
    if (existsSync(join(run.launchDir, "active-run.json")) && (await import("./hook-launch.js")).eventInActiveRun(ctx)) await appendRefuterEntries(ctx, run);
    return PASS;
  }
  if (history.some((l) => l.outcome === "stopped")) return PASS;
  appendLine(run.legalDir, HOOK_LEDGER, {
    v: 1,
    at: ctx.now().toISOString(),
    outcome: "stopped",
    agent_id: agentId,
    agent_type: String(ctx.input.agent_type ?? ""),
    session_id: typeof ctx.input.session_id === "string" ? ctx.input.session_id : null,
    event: "SubagentStop",
    permission_mode: "auto",
    tool_use_id: null,
    transcript_path: typeof ctx.input.transcript_path === "string" ? ctx.input.transcript_path : null,
    agent_transcript_path: typeof ctx.input.agent_transcript_path === "string" ? ctx.input.agent_transcript_path : null,
    agent_effort: transcriptEffort(typeof ctx.input.agent_transcript_path === "string" ? ctx.input.agent_transcript_path : null),
    entry: settled.entry,
    role: settled.role,
    answer: null,
    reason: `the seat stopped after its answer was taken (${settled.outcome}, ${settled.at}); this line records its own transcript`,
    took_ms: Date.now() - started,
  } satisfies HookLedgerLine);
  noteSeatCapture(run, ctx.input, { v: 1, at: ctx.now().toISOString(), kind: "stopped", agent_id: agentId, session_id: typeof ctx.input.session_id === "string" ? ctx.input.session_id : null, event: "SubagentStop", tool_use_id: null, transcript_path: typeof ctx.input.transcript_path === "string" ? ctx.input.transcript_path : null, agent_transcript_path: typeof ctx.input.agent_transcript_path === "string" ? ctx.input.agent_transcript_path : null, entry: settled.entry }, ctx.now());
  return PASS;
}

/**
 * THE DEEPER CHECK'S SEAT (design rf13 3.9, steps 2 and 7, "The check's own run").
 * A `legal-deep-checker` seat is launched, bound and captured through the check's own launch folder
 * (`.legal/deep/<id>/<time>/launch/`, launch-plan.ts `writeDeepLaunchEntry`) and only while the check's marker stands
 * for this session (hook.ts `readDeepMarker`); never through the scan's `.legal/launch/` or its ledgers:
 * - the launch (`onDeepLaunch`, PreToolUse Agent): refused unless a marker stands for this session and the call's input
 *   is the pending seat's `agent_input` field for field, in the background; let through, it appends `reserved`;
 * - the binding (`onDeepLaunched`, PostToolUse Agent): the launch result's agent id is written on `launched`;
 * - the answer (`onDeepHandback` at SubagentHandback in auto mode, `onDeepStop` at SubagentStop otherwise): only the
 *   bound seat's, checked against the seat's reply schema (`DEEP_REPLY_SCHEMAS`) and the check's finding, written to
 *   `<check>/capture/<seat>.json` with the answer's sha256 and kept whole beside it; a wrong answer is refused with what
 *   is wrong, up to REFUSALS_MAX times, and the next one is kept and recorded as invalid. The marker is not removed here:
 *   the command that takes the captured answer removes it (`deepen --plan`, or the reading's own end).
 * Every outcome is a line of the check's `deep-ledger.jsonl`. With no marker, nothing is captured and nothing written.
 */
export const DEEP_LEDGER = "deep-ledger.jsonl";
export type DeepOutcome = "accepted" | "refused" | "invalid" | "unbound" | "not-captured";
export interface DeepLedgerLine {
  v: 1;
  at: string;
  outcome: DeepOutcome;
  seat: DeepSeat;
  entry: string;
  agent_id: string;
  session_id: string | null;
  event: HookCaptureEvent;
  answer: { sha256: string; bytes: number; kept: string };
  reason: string;
}

/** The capture's own files, under the check's folder. */
export const deepCapturePath = (checkDir: string, seat: DeepSeat): string => join(checkDir, "capture", `${seat}.json`);

function liveDeepMarker(ctx: HookContext): DeepMarker | null {
  if (!ctx.run) return null;
  const sessionId = typeof ctx.input.session_id === "string" && ctx.input.session_id !== "" ? ctx.input.session_id : null;
  const read = readDeepMarker(ctx.run.projectDir, sessionId, ctx.now(), deepTracked(ctx.run.projectDir));
  return read.kind === "live" ? read.marker : null;
}

const deepRefused = (why: string): HookDecision => ({
  kind: "deny",
  reason: `wolfboy: this launch of a deeper-check seat is refused: ${why}. A legal-deep-checker seat is launched only from the launch entry \`legal-scan deepen\` writes, with that entry's input unchanged.`,
});

/** PreToolUse Agent naming the deeper-check seat kind. */
export function onDeepLaunch(ctx: HookContext): HookDecision {
  const marker = liveDeepMarker(ctx);
  if (!marker) return deepRefused("no deeper check is waiting for a seat in this session (its marker .legal/deep/active.json does not stand for it)");
  const list = readDeepLaunchList(marker.launch_dir);
  const entry = list?.entries.find((e) => e.seat === marker.seat);
  if (!list || !entry) return deepRefused(`the check's launch list (${join(marker.launch_dir, DEEP_LAUNCH_LIST)}) has no entry for its ${marker.seat} seat`);
  const events = readDeepLaunchEvents(marker.launch_dir).filter((e) => e.entry === entry.id);
  if (events.some((e) => e.event === "launched" || e.event === "reserved")) return deepRefused(`the check's ${marker.seat} seat was already launched`);
  const ti = (ctx.input.tool_input ?? {}) as Record<string, unknown>;
  const wanted = entry.agent_input as unknown as Record<string, unknown>;
  const differs = Object.keys(wanted).filter((k) => ti[k] !== wanted[k]);
  const extra = Object.keys(ti).filter((k) => !(k in wanted) && k !== "run_in_background");
  if (differs.length > 0 || extra.length > 0) return deepRefused(`its input is not the entry's (${[...differs, ...extra].join(", ")} differ${differs.length + extra.length === 1 ? "s" : ""})`);
  if (ti.run_in_background === false) return deepRefused("it sets run_in_background to false; the seat is launched in the background, so that its answer can be told apart");
  appendDeepLaunchEvent(marker.launch_dir, { entry: entry.id, event: "reserved", at: ctx.now().toISOString(), ...(typeof ctx.input.tool_use_id === "string" ? { tool_use_id: ctx.input.tool_use_id } : {}) });
  return PASS;
}

/** PostToolUse Agent naming the deeper-check seat kind: the reserved launch's agent id. */
export function onDeepLaunched(ctx: HookContext): HookDecision {
  const marker = liveDeepMarker(ctx);
  if (!marker) return PASS;
  const toolUseId = typeof ctx.input.tool_use_id === "string" ? ctx.input.tool_use_id : null;
  const events = readDeepLaunchEvents(marker.launch_dir);
  const reserved = events.find((e) => e.event === "reserved" && toolUseId !== null && e.tool_use_id === toolUseId);
  if (!reserved || events.some((e) => e.entry === reserved.entry && e.event === "launched")) return PASS;
  const resp = (ctx.input.tool_response ?? {}) as Record<string, unknown>;
  const agentId = typeof resp.agentId === "string" && resp.agentId !== "" ? resp.agentId : null;
  appendDeepLaunchEvent(marker.launch_dir, agentId ? { entry: reserved.entry, event: "launched", at: ctx.now().toISOString(), seat: agentId } : { entry: reserved.entry, event: "failed", at: ctx.now().toISOString() });
  return PASS;
}

function readDeepLedger(launchDir: string): DeepLedgerLine[] {
  const got = readProgramFile("the deeper check's ledger", join(launchDir, DEEP_LEDGER));
  if (!got.ok) return [];
  return got.value
    .toString("utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as DeepLedgerLine];
      } catch {
        return [];
      }
    });
}

/** The answer's JSON object: the text whole, or the one fenced block it is. */
function deepReplyOf(text: string): { ok: true; value: unknown } | { ok: false; problem: string } {
  let t = text.trim();
  const fenced = /^```[A-Za-z]*\n([\s\S]*)\n```$/.exec(t);
  if (fenced) t = fenced[1].trim();
  try {
    return { ok: true, value: JSON.parse(t) };
  } catch (e) {
    return { ok: false, problem: `the answer is not one JSON object (${valueText((e as Error).message)})` };
  }
}

/** Take one deeper-check seat's answer. `mayRefuse`: the event can send the seat back (auto mode's hand-back, a stop outside auto mode). */
function takeDeepAnswer(ctx: HookContext, text: string, event: HookCaptureEvent, mayRefuse: boolean): HookDecision {
  const marker = liveDeepMarker(ctx);
  if (!marker) return PASS;
  const agentId = String(ctx.input.agent_id ?? "");
  const launchDir = marker.launch_dir;
  const checkDir = dirname(launchDir);
  const entryId = `deep-${marker.seat}`;
  const at = ctx.now().toISOString();
  const answer = Buffer.from(text, "utf8");
  const history = readDeepLedger(launchDir).filter((l) => l.agent_id === agentId);
  const keptRel = join("capture", `${marker.seat}.${agentId.replace(/[^A-Za-z0-9_-]/g, "_")}.${history.length + 1}.answer.txt`);
  makeFolder(join(checkDir, "capture"), { recursive: true });
  writeFileAt(join(checkDir, keptRel), answer);
  const line = (outcome: DeepOutcome, reason: string): void =>
    appendFileAt(
      join(launchDir, DEEP_LEDGER),
      `${JSON.stringify({ v: 1, at, outcome, seat: marker.seat, entry: entryId, agent_id: agentId, session_id: typeof ctx.input.session_id === "string" ? ctx.input.session_id : null, event, answer: { sha256: sha256(answer), bytes: answer.length, kept: keptRel }, reason } satisfies DeepLedgerLine)}\n`,
    );
  const auto = event === "PreToolUse:SubagentHandback";
  const told = (s: string): HookDecision => (auto ? receipt(s) : PASS);
  const settled = readDeepLedger(launchDir).find((l) => l.entry === entryId && (l.outcome === "accepted" || l.outcome === "invalid"));
  if (settled) {
    line("not-captured", `the check's ${marker.seat} answer was already taken (${settled.outcome}, ${settled.at})`);
    return told(`the program kept this answer at ${keptRel} and did not read it: this check's ${marker.seat} answer was already taken.`);
  }
  const bound = readDeepLaunchEvents(launchDir).some((e) => e.entry === entryId && e.event === "launched" && e.seat === agentId);
  if (!bound) {
    line("unbound", `this seat is not the one launched from the check's ${marker.seat} entry`);
    return told(`the program kept this answer at ${keptRel} and did not take it: this seat was not launched from the check's launch entry.`);
  }
  const schema = DEEP_REPLY_SCHEMAS[marker.seat];
  const problems: string[] = [];
  const parsed = deepReplyOf(text);
  if (!parsed.ok) problems.push(parsed.problem);
  else {
    const v = validateAgainstSchema(schema, parsed.value);
    if (!v.ran) problems.push(`the reply could not be checked (${v.unavailable_reason})`);
    else if (!v.ok) {
      // The field a violation is about, named: "must NOT have additional properties" says nothing of which one.
      for (const e of v.errors.slice(0, 8)) {
        const named = typeof e.params.additionalProperty === "string" ? ` (${e.params.additionalProperty})` : typeof e.params.missingProperty === "string" ? ` (${e.params.missingProperty})` : "";
        problems.push(`${e.instancePath === "" ? "the answer" : e.instancePath} ${e.message}${valueText(named)}`);
      }
      if (v.errors.length === 0) problems.push(v.first_violation);
    }
    const fid = (parsed.value as Record<string, unknown> | null)?.finding_id;
    if (v.ok && fid !== marker.finding_id) problems.push(`finding_id is ${JSON.stringify(fid)}, and this check is of ${marker.finding_id}`);
    if (v.ok && marker.seat === "plan") {
      const p = parsed.value as { test: unknown; no_test_reason: unknown };
      if ((p.test === null) === (p.no_test_reason === null)) problems.push("exactly one of test and no_test_reason is null");
    }
  }
  if (problems.length > 0) {
    const refusals = history.filter((l) => l.outcome === "refused").length;
    if (mayRefuse && refusals < REFUSALS_MAX) {
      line("refused", problems.join("; "));
      const why = `wolfboy: this answer was not taken (${refusals + 1} of ${REFUSALS_MAX} refusals): ${problems.join("; ")}. Answer again with one JSON object as ${schema} describes, and nothing else.`;
      return auto ? { kind: "deny", reason: why } : { kind: "block", reason: why };
    }
    line("invalid", problems.join("; "));
    return told(`the program kept this answer at ${keptRel}; it does not meet ${schema} (${problems[0]}), so the check takes no answer from this seat.`);
  }
  const capture = deepCapturePath(checkDir, marker.seat);
  writeFileAt(capture, `${JSON.stringify({ v: 1, seat: marker.seat, finding_id: marker.finding_id, agent_id: agentId, at, answer_sha256: sha256(answer), kept: keptRel, reply: (parsed as { value: unknown }).value }, null, 2)}\n`);
  line("accepted", `written to ${relativePath(checkDir, capture)}`);
  appendDeepLaunchEvent(launchDir, { entry: entryId, event: "returned", at, seat: agentId });
  return told(`the program took this answer for the deeper check of ${marker.finding_id} (the ${marker.seat}) and wrote it to ${capture}.`);
}

/** PreToolUse SubagentHandback of a deeper-check seat. */
export function onDeepHandback(ctx: HookContext): HookDecision {
  const ti = ctx.input.tool_input;
  const message = ti && typeof ti === "object" ? (ti as Record<string, unknown>).message : undefined;
  const d = takeDeepAnswer(ctx, typeof message === "string" ? message : "", "PreToolUse:SubagentHandback", true);
  if (d.kind !== "replace-input" || typeof message !== "string") return d;
  return { kind: "replace-input", updatedInput: { ...(ti as Record<string, unknown>), ...d.updatedInput } };
}

/** SubagentStop of a deeper-check seat: outside auto mode its last message is the answer; in auto mode, only where no hand-back was taken. */
export function onDeepStop(ctx: HookContext): HookDecision {
  const lam = ctx.input.last_assistant_message;
  const text = typeof lam === "string" ? lam : "";
  const auto = ctx.input.permission_mode === "auto";
  if (auto) {
    const marker = liveDeepMarker(ctx);
    if (!marker) return PASS;
    const agentId = String(ctx.input.agent_id ?? "");
    if (readDeepLedger(marker.launch_dir).some((l) => l.agent_id === agentId && l.outcome !== "refused")) return PASS;
    takeDeepAnswer(ctx, text, "SubagentStop", false);
    return PASS;
  }
  return takeDeepAnswer(ctx, text, "SubagentStop", true);
}
