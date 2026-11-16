/**
 * THE RUN-SHAPE QUESTION RELAY.
 *
 * The pre-launch step (`legal-scan adjudicate`) writes the price table and the run-shape question as the input of
 * one AskUserQuestion call, the run-shape question record, records the file's sha256 in the relay's ledger, and
 * prints that input as one line of JSON. THE ORCHESTRATOR PASSES IT UNCHANGED AND THE HOOK CHECKS EVERY CHARACTER The PreToolUse hook compares the call's input with the question file's
 * `ask_user_question_input` and refuses any difference, naming the first one (`firstDifference`) and carrying the
 * input to pass; it never puts another input in the call's place. Until then the orchestrator passed a short
 * reference and the hook substituted the question through `updatedInput`; in live run 2 the person answered on the
 * phone (Remote Control), whose client shows the call's own input, so the placeholder was shown six times and no
 * answer was taken. What the model passes is
 * now the program's question, so every client shows it.
 *
 * WHERE THE RELAY'S RECORDS ARE: the question, the answer and the ledger of
 * each kind are kept in the person's state folder (state-record.ts `launchRecordPath`), outside the project and any git
 * work tree, each with a guard row; once they were files under `.legal/launch/`, which a commit, a clone or one allowed
 * tool call could write. The names below are the records' own.
 *
 * THE LEDGER (`run-shape-ledger.jsonl`, append-only, one JSON object per line) ties each step to the one
 * before it, so that no file the program relies on is taken as given:
 * - `question-written` (the pre-launch step): the question file's sha256. The hook puts in only a question file
 *   that matches the last such line; a file changed after the step wrote it is refused, not shown;
 * - `question-passed` (PreToolUse; the stub of §3.5 part 2): the `tool_use_id` of every call the hook let through;
 * - `answer-written` (PostToolUse): the answer file's sha256, the call's `tool_use_id` and its session, all from
 *   what Claude Code hands the hook at the question (its tool response and session id). PostToolUse writes an answer only for a call in the stub; the program's question
 *   answered in any other call (one that went out while PreToolUse failed or timed out) writes `answer-not-taken`
 *   and no answer;
 * - `answer-used` (the pre-launch step): the answer that wrote a launch list. An answer is used once.
 * The declaration ledger (`declaration-ledger.jsonl`, relay item 7) has the same lines, written by the scan in
 * place of the pre-launch step (its `question-written` line also names the session the round is asked in), and two
 * more: `question-withdrawn` (the scan): a round still open that the scan removed because no declaration question is
 * left for the run; and `scan-started` (the scan): a scan in a Claude Code session went past its refusals,
 * naming the session, whether or not it writes a round - the start of the write guard's declaration window
 * (declarationUnderWay). A round is outstanding by these lines alone (declarationOutstanding).
 * The pre-launch step takes the run shape (`takeRunShape`) only from an answer file whose sha256 an
 * `answer-written` line records for the file's own `tool_use_id`, and which no `answer-used` line names. No session
 * transcript is located or read: the records are the hook's and the program's own.
 * ONLY THE LATEST ASKING COUNTS (§3.5 part 2: the step takes only the answer to the question it issued): the
 * answer's call must be the last call the hook passed (the ledger's last `question-passed` line, whatever version
 * of the question it passed). An earlier asking's answer is refused by name, whether it is still on disk, written back or re-typed, and
 * whatever became of the later asking (answered, "Chat about this", timed out, used).
 *
 * WHAT THIS DOES NOT STOP (the proposal's own limit, §3.5 part 2): the records are files the person's own commands
 * can write, because hooks and commands run with one user's rights; the guard rows refuse the tool calls that name them
 * (best effort, hook-guard.ts GUARD_BASH_LIMITS), and a hand-made set of records written outside a session passes. A
 * later asking the hook did not see (another session it did not run in, a call made while it failed) leaves the earlier
 * answer the latest. Nor does it stop another hook on AskUserQuestion (the person's settings or another plugin): hooks
 * run side by side, so such a hook can change the input this hook passed, putting answers in or changing the text.
 * Changed text writes no answer; an answer that hook put in is written and taken like the person's, since the stub
 * records only that this hook passed the call. What is stopped: an answer file the hook did not write, one changed
 * after it was written, an answer used twice, and the answer to any asking but the latest the hook passed.
 *
 * REFUSED (PreToolUse, the main session):
 * - the program's question (the call's questions equal to the file's) where the question file is not the one the
 *   pre-launch step recorded, where the call carries anything beside the file's input, and where the call has no
 *   tool_use_id. `answers` and `annotations` are named: probe run F saw a model's own `answers` reach PreToolUse
 *   (Claude Code then dropped them before the permission host), and an input carrying `answers` let the tool run
 *   without asking anyone;
 * - a question that looks like the run-shape question (the program's header, its run id, or two of its option
 *   labels) and differs from it: the refusal names the first difference and carries the exact input to pass. A
 *   paraphrase that shows none of these goes out, and its answer is never taken: only a call the hook passed
 *   writes an answer file. This one is refused only while the event belongs to the active run (the launch unit's
 *   rule, hook-launch.ts `eventInActiveRun`, handed in by the route; integration part B, area hooks, item 3): a
 *   person's own later session, or another session, asks what it likes;
 * - the earlier design's short reference (either kind's), in any session: its text told the person the hook had not
 *   run, which a client showing the call's own input made false.
 * And (PreToolUse on Bash, whoever runs it) the program's `adjudicate` with `--shape`: inside Claude Code the
 * shape comes from the answer file. The check reads the command's words as bash would pass them before it
 * expands anything (`shellCommands`): quotes and backslashes removed, `$'...'` decoded as bash 5.2 decodes it,
 * and a quoted command line (`bash -c "..."`, `eval "..."`) or a command substitution read again as commands. A
 * `--shape` that is only data downstream of `adjudicate` in one pipeline (`adjudicate --help | grep -e --shape`),
 * in a command that does not itself name `adjudicate`, is not refused. NOT SEEN: a word bash builds by expanding
 * it, so a flag or an `adjudicate` spelt through any expansion passes: parameter expansion (`$x`, `${x:-...}`,
 * `--sh${x}ape`, `$IFS`, a variable assigned earlier in the same command line and joined to a word, word
 * splitting), brace expansion (`{--shape,x}`, `{adjudicate,}`), pathname expansion (`--sha?e` where a file of
 * that name exists), the output of `$(...)`; and, outside the command line, a variable set by an earlier tool call
 * (`$V`, or `~` from `$HOME`), a script file, and a command line that another program builds and runs
 * (`python3 -c`, `node -e`, `xargs` reading a file). The program-side refusal that would need no hook waits for
 * the decision on where questions are asked.
 *
 * A refusing route that fails inside refuses (hook.ts `failClosed`, exit 2): §3.5 asks it of every refusing hook.
 *
 * This module is loaded on every Bash call of a session the plugin is enabled in, so it imports nothing but
 * Node's own modules and the dispatcher.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFileAt, makeFolder, removePath, renamePath, writeFileAt } from "./project-write.js";
import { readProgramFile } from "./program-file.js";
import { recoveryFor } from "./recovery.js";
import { isDeepStrictEqual } from "node:util";
import { DECLARATION_LEDGER_FILE, type HookContext, type HookDecision, PREVIOUS_FLAG, SHAPE_FLAG, markScanUnderWay, programInstant } from "./hook.js";
import { typedTextDigest } from "./redaction-key.js";
import { launchRecordPath } from "./state-record.js";
import { valueText } from "./value-text.js";

/** All relative to the run's launch directory (`.legal/launch`, the pre-launch step's default). */
export const RUN_SHAPE_QUESTION_FILE = "run-shape-question.json";
export const RUN_SHAPE_ANSWER_FILE = "run-shape-answer.json";
export const RUN_SHAPE_LEDGER_FILE = "run-shape-ledger.jsonl";
/** The header chip of the program's question. */
export const RUN_SHAPE_HEADER = "Run shape";

const PASS: HookDecision = { kind: "pass" };
/**
 * The leads of the earlier design's short references (the run-shape question's, then the declaration round's), kept
 * only so that such a reference is refused, in any session.
 */
const LEGACY_LEADS: readonly string[] = ["wolfboy: the run-shape question of ", "wolfboy: the declaration questions of "];
const ANSWER_WRITER = "the wolfboy plugin's hook, on PostToolUse of AskUserQuestion";
const PASS_WRITER = "the wolfboy plugin's hook, on PreToolUse of AskUserQuestion";
const STEP_WRITER = "the pre-launch step (legal-scan adjudicate)";

/**
 * A KIND OF QUESTION THE RELAY CARRIES (relay item 7, R8): the run-shape question the pre-launch step writes, or one
 * round of the declaration questions the scan writes. One relay, not two: the same hook routes, ledger events,
 * checks and "only the latest asking" rule take the kind; the run-shape texts are the kind's words, so its
 * refusals read as before.
 */
export interface RelayKind {
  noun: string;
  questionFile: string;
  answerFile: string;
  ledgerFile: string;
  ledgerName: string;
  /** The part of the program that writes the question, as the ledger's `by` and as the texts name it. */
  writer: string;
  step: string;
  /** What an `answer-used` line names: the launch list, the declaration written, or what the program's confirmation was used for. */
  usedFor: "launch_list" | "profile" | "confirmation";
  /**
   * (design rf11 3.4) Whether each ledger line of the kind is preceded by the scan-under-way
   * marker the plugin's shim reads (`appendLedger`). False for the program's confirmation alone, which is asked after a
   * run as well as during one: a marker it wrote would stand until some later run ended.
   */
  marksScanUnderWay: boolean;
}
export const RUN_SHAPE_KIND: RelayKind = {
  noun: "the run-shape question",
  questionFile: RUN_SHAPE_QUESTION_FILE,
  answerFile: RUN_SHAPE_ANSWER_FILE,
  ledgerFile: RUN_SHAPE_LEDGER_FILE,
  ledgerName: "the run-shape ledger",
  writer: STEP_WRITER,
  step: "the pre-launch step",
  usedFor: "launch_list",
  marksScanUnderWay: true,
};
export const DECLARATION_QUESTION_FILE = "declaration-question.json";
export const DECLARATION_ANSWER_FILE = "declaration-answer.json";
/** Its one name lives in hook.ts, where the light entry reads it (the write guard's rows, hardening 2). */
export { DECLARATION_LEDGER_FILE };
export const DECLARATION_HEADER = "Declaration";
export const DECLARATION_KIND: RelayKind = {
  noun: "the declaration questions",
  questionFile: DECLARATION_QUESTION_FILE,
  answerFile: DECLARATION_ANSWER_FILE,
  ledgerFile: DECLARATION_LEDGER_FILE,
  ledgerName: "the declaration ledger",
  writer: "the scan (legal-scan scan)",
  step: "the scan",
  usedFor: "profile",
  marksScanUnderWay: true,
};
/**
 * THE EARLIER-RUN QUESTION: which log under `.legal/evidence/`, if any, is the
 * person's own earlier run of this project - a fact only the person holds, which step 3k's prose left to the model and
 * the model skipped twice. Inside a Claude Code session the pre-launch step writes it where any log is there
 * (earlier-run.ts); the relay passes it and records the answer as for the other kinds; the step takes the log only from
 * that answer (`takeEarlierRun`). No `answer-used` line is written for this kind: the answer stays good for exactly the
 * question file it answers (bound to the new scan's id and to every log's sha256), because one run takes it on each call
 * of the step (this question, then the start or run-shape question, then `--shape-from-answer`). Only the latest asking
 * counts, as for the other kinds.
 */
export const EARLIER_RUN_QUESTION_FILE = "earlier-run-question.json";
export const EARLIER_RUN_ANSWER_FILE = "earlier-run-answer.json";
export const EARLIER_RUN_LEDGER_FILE = "earlier-run-ledger.jsonl";
export const EARLIER_RUN_HEADER = "Earlier run";
/** The option that names no log: nothing is carried. */
export const EARLIER_RUN_NONE = "None of these";
export const EARLIER_RUN_KIND: RelayKind = {
  noun: "the earlier-run question",
  questionFile: EARLIER_RUN_QUESTION_FILE,
  answerFile: EARLIER_RUN_ANSWER_FILE,
  ledgerFile: EARLIER_RUN_LEDGER_FILE,
  ledgerName: "the earlier-run ledger",
  writer: STEP_WRITER,
  step: "the pre-launch step",
  usedFor: "launch_list",
  marksScanUnderWay: true,
};

export interface AskOption {
  label: string;
  description: string;
}
export interface AskQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: AskOption[];
}

/**
 * The words the pre-launch step and the scan print before the input to pass, and the refusals repeat: the one place
 * they are written (the gates find the input on the line after them).
 */
export const PASS_EXACTLY = "call AskUserQuestion with exactly this input";

/** A refusal's last sentence: the input to pass, whole, on one line, as the program printed it. */
export function passExactly(input: Record<string, unknown>, printedBy: string): string {
  return (
    `To ask the person, ${PASS_EXACTLY}, alone in its call and with every character as it is (${printedBy} printed it; ` +
    `do not re-word, shorten, re-type or add to it): ${JSON.stringify(input)}`
  );
}

const DIFF_BEFORE = 12;
const DIFF_AFTER = 36;
const kindOf = (v: unknown): string => (v === null ? "null" : Array.isArray(v) ? "a list" : typeof v === "object" ? "an object" : typeof v === "string" ? "text" : typeof v);
/** The text around character `at`, as JSON so that a space, a line break or a quote shows; `...` where it is cut. */
const around = (s: string, at: number): string => {
  const from = Math.max(0, at - DIFF_BEFORE);
  const to = Math.min(s.length, at + DIFF_AFTER);
  return `${from > 0 ? "..." : ""}${JSON.stringify(s.slice(from, to))}${to < s.length ? "..." : ""}`;
};

/**
 * Where `given` (a call's input) first differs from `expected` (the program's), in words: the field, and for text the
 * character where the two part (with its line and column) and each one's text around it; a field one has and the
 * other has not; a list of another length. Null where the two are equal. Keys are compared by name, not by order.
 */
export function firstDifference(expected: unknown, given: unknown, path: string): string | null {
  if (isDeepStrictEqual(expected, given)) return null;
  if (typeof expected === "string" && typeof given === "string") {
    let i = 0;
    while (i < expected.length && i < given.length && expected[i] === given[i]) i++;
    const line = expected.slice(0, i).split("\n").length;
    const column = i === 0 ? 1 : i - expected.lastIndexOf("\n", i - 1);
    const where = `${valueText(path)} differs from character ${i + 1} on (line ${line}, column ${column})`;
    if (i === given.length) return `${where}: this call's text ends there, and the program's goes on ${around(expected, i)}`;
    if (i === expected.length) return `${where}: the program's text ends there, and this call's goes on ${around(given, i)}`;
    return `${where}: the program's text reads ${around(expected, i)} where this call's reads ${around(given, i)}`;
  }
  if (Array.isArray(expected) && Array.isArray(given)) {
    for (let k = 0; k < Math.min(expected.length, given.length); k++) {
      const d = firstDifference(expected[k], given[k], `${path}[${k}]`);
      if (d !== null) return d;
    }
    return `${valueText(path)} has ${given.length} item(s), and the program's has ${expected.length}`;
  }
  if (isRecord(expected) && isRecord(given)) {
    for (const k of Object.keys(expected)) {
      if (!Object.hasOwn(given, k)) return `${valueText(path)} has no \`${k}\`, which the program's has`;
      const d = firstDifference(expected[k], given[k], `${path}.${k}`);
      if (d !== null) return d;
    }
    const extra = Object.keys(given).filter((k) => !Object.hasOwn(expected, k));
    return `${valueText(path)} carries ${extra.map((k) => `\`${k}\``).join(" and ")}, which the program's does not`;
  }
  if (kindOf(expected) !== kindOf(given)) return `${valueText(path)} is ${kindOf(given)}, and the program's is ${kindOf(expected)}`;
  return `${valueText(path)} is ${JSON.stringify(given)}, and the program's is ${JSON.stringify(expected)}`;
}

/** Whether a call's questions include the earlier design's short reference (either kind's). */
const carriesLegacyReference = (questions: unknown[]): boolean =>
  questions.some((q) => {
    const text = isRecord(q) ? q.question : undefined;
    return typeof text === "string" && LEGACY_LEADS.some((lead) => text.startsWith(lead));
  });

/** The program's question as the pre-launch step wrote it, with the digest of the file's bytes. */
export interface LoadedRunShapeQuestion {
  path: string;
  run_id: string;
  /** `ask_user_question_input`, exactly as parsed: what the hook passes on. */
  input: Record<string, unknown>;
  question: AskQuestion;
  shapeByLabel: Record<string, string>;
  sha256: string;
}

/** What PostToolUse writes: the person's answer to one question file, and nothing the orchestrator wrote. */
export interface RunShapeAnswer {
  kind: "run-shape-answer";
  version: 1;
  written_by: string;
  run_id: string;
  question_file: string;
  /** sha256 of the question file's bytes when the answer came back. */
  question_sha256: string;
  session_id: string | null;
  tool_use_id: string | null;
  /** The session's transcript, as the PostToolUse event named it: where the pre-launch step looks for the call. */
  transcript_path: string | null;
  recorded_at: string;
  answered: boolean;
  /** What `tool_response.answers` holds for the program's question: an option's label, or text the person typed. */
  answer: string | null;
  /** The question file's `shape_by_label` of `answer`; null where the answer is not one of the labels. */
  shape: string | null;
  /** Why there is no answer, where there is none. */
  no_answer: string | null;
  annotations: Record<string, unknown> | null;
}

export type RunShapeLedgerEvent = "question-written" | "question-passed" | "answer-written" | "answer-not-taken" | "answer-used" | "question-withdrawn" | "scan-started" | "scan-closed" | "run-shape-default";
/**
 * The declaration ledger's `scan-started` line: a session scan went past
 * its refusals. It names no round (no run_id or question_sha256), only the session and the findings path.
 */
export interface DeclarationScanLine {
  v: 1;
  event: "scan-started";
  at: string;
  by: string;
  session_id: string | null;
  out: string;
}

/**
 * The declaration ledger's `scan-closed` line: `legal-scan run-abort`
 * found no run active and a scan's window open, so it ended that scan, which never reached a run. It closes the window
 * of the two Bash and prompt checks before the run (`declarationUnderWay` with `scanClosedEnds`); a later scan opens a
 * new one.
 */
export interface DeclarationScanClosedLine {
  v: 1;
  event: "scan-closed";
  at: string;
  by: string;
  session_id: string | null;
}

/** One line of `run-shape-ledger.jsonl`. */
export interface RunShapeLedgerLine {
  v: 1;
  event: RunShapeLedgerEvent;
  at: string;
  /** The part of the program that wrote the line. */
  by: string;
  run_id: string;
  question_sha256: string;
  tool_use_id?: string;
  session_id?: string | null;
  transcript_path?: string | null;
  answer_sha256?: string;
  answered?: boolean;
  launch_list?: string;
  /** The shape a `run-shape-default` line wrote its list for, nobody asked. */
  shape?: string;
  /** The declaration an `answer-used` line of the declaration ledger wrote (relay item 7). */
  profile?: string;
  reason?: string;
  /** The program's confirmation: what asked it, what it is bound to, and what its answer was used for. */
  purpose?: string;
  about?: string;
  used_for?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const sha256 = (b: string | Buffer): string => createHash("sha256").update(b).digest("hex");
const stringOr = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
/**
 * Where one of the relay's files is kept: the person's state folder
 * (state-record.ts `launchRecordPath`), never `.legal/launch/`. Or why it has none. Never throws.
 */
function placeOrProblem(launchDir: string, file: string): { path: string } | { problem: string } {
  try {
    return { path: launchRecordPath(launchDir, file) };
  } catch (e) {
    return { problem: messageOf(e) };
  }
}
/**
 * Remove the record at `path` where it is there. Its kind's folder in the state folder is made only by the first write,
 * so a record never written has no folder, and the walked removal would fail on the missing folder: nothing is there to
 * remove. Throws where it is there and cannot be removed.
 */
function removeRecordAt(path: string): void {
  if (existsSync(path)) removePath(path, { force: true });
}
/** Remove the relay's file `file` where it is on record; a file with no place is not on record. Throws where it cannot be removed. */
export function removeRelayRecord(launchDir: string, file: string): void {
  const at = placeOrProblem(launchDir, file);
  if ("path" in at) removeRecordAt(at.path);
}
/** Whether the relay's file is on record. Never throws: a file with no place is not on record. */
const onRecord = (launchDir: string, file: string): boolean => {
  const at = placeOrProblem(launchDir, file);
  return "path" in at && existsSync(at.path);
};
/** The relay's file as a message names it: its place, or its own name where it has none. */
const shownPlace = (launchDir: string, file: string): string => {
  const at = placeOrProblem(launchDir, file);
  return "path" in at ? at.path : file;
};

/** Every readable line of the relay's ledger, in order. A line that does not read is skipped; the file stays append-only. */
export function readRunShapeLedger(launchDir: string): RunShapeLedgerLine[] {
  return readLedger(launchDir, RUN_SHAPE_KIND);
}

/** Every readable line of one kind's ledger (the run-shape ledger or the declaration ledger), in order. */
export function readLedger(launchDir: string, kind: RelayKind): RunShapeLedgerLine[] {
  const path = launchRecordPath(launchDir, kind.ledgerFile);
  if (!existsSync(path)) return [];
  // Through the one reader of program-written files (program-file.ts): a ledger that is not
  // a regular file with one name is refused by a throw naming it; every caller words a throw as "could not be read".
  const got = readProgramFile(kind.ledgerName, path);
  if (!got.ok) {
    if (got.code === "ENOENT") return [];
    throw new Error(got.problem);
  }
  const out: RunShapeLedgerLine[] = [];
  for (const line of got.value.toString("utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const d: unknown = JSON.parse(line);
      if (isRecord(d) && d.v === 1 && typeof d.event === "string") out.push(d as unknown as RunShapeLedgerLine);
    } catch {
      // Not a line of this ledger.
    }
  }
  return out;
}

/** Append one line. Throws where it cannot: every caller refuses, or writes nothing, when its line is not on disk. */
function appendLedger(launchDir: string, line: RunShapeLedgerLine | DeclarationScanLine | DeclarationScanClosedLine, kind: RelayKind = RUN_SHAPE_KIND): void {
  // The plugin's shim reads this marker as "a scan is under way here"; written before the line (hook.ts). Not for the program's confirmation, which writes no marker (CONFIRMATION_KIND).
  if (kind.marksScanUnderWay) makeFolder(launchDir, { recursive: true });
  if (kind.marksScanUnderWay) markScanUnderWay(launchDir, `${kind.ledgerFile} ${line.event}`, new Date());
  appendFileAt(launchRecordPath(launchDir, kind.ledgerFile, true), `${JSON.stringify(line)}\n`);
}

/** The pre-launch step, once it has written the question file: record the bytes it wrote. Throws where it cannot. */
export function recordRunShapeQuestion(launchDir: string, runId: string, written: string | Buffer, at: Date): void {
  appendLedger(launchDir, { v: 1, event: "question-written", at: at.toISOString(), by: STEP_WRITER, run_id: runId, question_sha256: sha256(written) });
}

function questionProblem(q: unknown): string | null {
  if (!isRecord(q)) return "the question is not an object";
  if (typeof q.question !== "string" || q.question === "") return "its `question` is not a non-empty string";
  if (typeof q.header !== "string" || q.header === "") return "its `header` is not a non-empty string";
  if (typeof q.multiSelect !== "boolean") return "its `multiSelect` is not true or false";
  if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) return "its `options` is not a list of 2 to 4 options";
  const labels = new Set<string>();
  for (const o of q.options) {
    if (!isRecord(o) || typeof o.label !== "string" || o.label === "" || typeof o.description !== "string") return "an option has no label or no description";
    labels.add(o.label);
  }
  return labels.size === q.options.length ? null : "two options have one label";
}

/** Read the question file the pre-launch step wrote, or say why it cannot be used. Never throws. */
export function loadRunShapeQuestion(launchDir: string): LoadedRunShapeQuestion | { problem: string } {
  const at = placeOrProblem(launchDir, RUN_SHAPE_QUESTION_FILE);
  if ("problem" in at) return at;
  const path = at.path;
  if (!existsSync(path)) return { problem: `${valueText(path)} does not exist` };
  let bytes: Buffer;
  let doc: unknown;
  const got = readProgramFile("the run-shape question", path); // the one reader (program-file.ts)
  if (!got.ok) return { problem: got.problem };
  try {
    bytes = got.value;
    doc = JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    return { problem: `${valueText(path)} could not be read as JSON (${valueText(messageOf(e))})` };
  }
  if (!isRecord(doc) || doc.kind !== "run-shape-question" || doc.version !== 1) return { problem: `${valueText(path)} is not a run-shape question (kind and version) the pre-launch step wrote` };
  if (typeof doc.run_id !== "string" || doc.run_id === "") return { problem: `${valueText(path)} names no run` };
  const input = doc.ask_user_question_input;
  if (!isRecord(input) || !Array.isArray(input.questions) || input.questions.length !== 1) {
    return { problem: `${valueText(path)}: ask_user_question_input.questions is not a list of exactly one question` };
  }
  const problem = questionProblem(input.questions[0]);
  if (problem) return { problem: `${valueText(path)}: ${problem}` };
  const question = input.questions[0] as AskQuestion;
  const byLabel = doc.shape_by_label;
  if (!isRecord(byLabel) || Object.keys(byLabel).length !== question.options.length || question.options.some((o) => typeof byLabel[o.label] !== "string")) {
    return { problem: `${valueText(path)}: shape_by_label does not map each option's label to a shape` };
  }
  return { path, run_id: doc.run_id, input, question, shapeByLabel: byLabel as Record<string, string>, sha256: sha256(bytes) };
}

/** Why the question file is not the one the pre-launch step last recorded writing, or null where it is. Never throws. */
function unrecordedQuestion(launchDir: string, loaded: { sha256: string }, kind: RelayKind = RUN_SHAPE_KIND): string | null {
  let last: RunShapeLedgerLine | undefined;
  try {
    last = readLedger(launchDir, kind)
      .filter((l) => l.event === "question-written")
      .at(-1);
  } catch (e) {
    return `the ledger ${shownPlace(launchDir, kind.ledgerFile)} could not be read (${valueText(messageOf(e))})`;
  }
  if (!last) return `no line of ${shownPlace(launchDir, kind.ledgerFile)} records ${kind.step} writing it`;
  if (last.question_sha256 !== loaded.sha256) {
    return `its sha256 is ${loaded.sha256}, not the ${String(last.question_sha256)} ${kind.step} recorded at ${String(last.at)}: the file was changed after the step wrote it`;
  }
  return null;
}

const normal = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Why a question of the orchestrator's own looks like the run-shape question, or null where it does not. */
function lookAlike(questions: unknown[], program: LoadedRunShapeQuestion | null): string | null {
  const labels = new Set(program ? program.question.options.map((o) => normal(o.label)) : []);
  for (const q of questions) {
    if (!isRecord(q)) continue;
    if (typeof q.header === "string" && normal(q.header) === normal(RUN_SHAPE_HEADER)) return `its header is "${RUN_SHAPE_HEADER}"`;
    if (program && typeof q.question === "string" && q.question.includes(program.run_id)) return `it names ${program.run_id}`;
    if (program && Array.isArray(q.options)) {
      const hits = q.options.filter((o) => isRecord(o) && typeof o.label === "string" && labels.has(normal(o.label))).length;
      if (hits >= 2) return `${hits} of its option labels are the program's shape labels`;
    }
  }
  return null;
}

const deny = (reason: string): HookDecision => ({ kind: "deny", reason: `wolfboy: ${reason}` });

/** How a refusal tells the orchestrator to have the program write its question again. */
const writeAgain = (kind: RelayKind): string => `Run ${kind.writer} again; it writes the question and prints the input to pass`;

/**
 * PreToolUse, either kind: the call asks the program's own question (its questions equal the file's). It is passed as
 * it is - no input is put in its place - and recorded as passed, once the file is the one its writer recorded, the call
 * carries nothing beside the file's input, and the call has an id. `refuse` words a refusal as the kind's.
 */
function passProgramQuestion(
  ctx: HookContext,
  launchDir: string,
  kind: RelayKind,
  loaded: { path: string; input: Record<string, unknown>; sha256: string },
  runId: string,
  input: Record<string, unknown>,
  refuse: (reason: string) => HookDecision,
): HookDecision {
  // First, so that the input a refusal below carries is the one the writer recorded.
  const unrecorded = unrecordedQuestion(launchDir, loaded, kind);
  if (unrecorded !== null) return refuse(`${loaded.path} is not the question ${kind.step} wrote (${unrecorded}), so it is not asked. ${writeAgain(kind)}.`);
  const carried = ["answers", "annotations"].filter((k) => k in input);
  if (carried.length > 0) {
    return refuse(`this call carries ${carried.join(" and ")} beside ${kind.noun}; the person's answer comes only from the question dialog, so the call was not passed. ${passExactly(loaded.input, kind.writer)}`);
  }
  const extra = firstDifference(loaded.input, input, "the input");
  if (extra !== null) return refuse(`this call is not exactly the program's input: ${extra}. ${passExactly(loaded.input, kind.writer)}`);
  const toolUseId = stringOr(ctx.input.tool_use_id);
  if (toolUseId === null) return refuse("this call carries no tool_use_id, so the person's answer could not be tied to it; the question was not asked.");
  // An earlier answer must not outlive the question asked again: "Chat about this" brings no PostToolUse.
  const answerPath = shownPlace(launchDir, kind.answerFile);
  try {
    removeRecordAt(launchRecordPath(launchDir, kind.answerFile));
  } catch (e) {
    return refuse(`an earlier answer, ${valueText(answerPath)}, could not be removed (${valueText(messageOf(e))}), so a new answer could not be told from it; the question was not asked.`);
  }
  try {
    appendLedger(
      launchDir,
      { v: 1, event: "question-passed", at: ctx.now().toISOString(), by: PASS_WRITER, run_id: runId, question_sha256: loaded.sha256, tool_use_id: toolUseId, session_id: stringOr(ctx.input.session_id) },
      kind,
    );
  } catch (e) {
    return refuse(`this call could not be recorded as passed in ${shownPlace(launchDir, kind.ledgerFile)} (${valueText(messageOf(e))}), so its answer could not be taken; the question was not asked.`);
  }
  return PASS;
}

/**
 * PreToolUse on AskUserQuestion, the main session: the program's own question is passed as it is and recorded; a
 * question that looks like it and differs is refused, naming the first difference and carrying the input to pass. The
 * hook never puts another input in the call's place. `inRun` is whether the event belongs to the
 * active run (the route hands in hook-launch.ts `eventInActiveRun`; this module does not import that one, which
 * imports this one); `lastRunEnd`, the last run end the active-run history records (hook-launch.ts `latestRunEndAt`).
 */
export function questionPre(ctx: HookContext, inRun: (ctx: HookContext) => boolean, lastRunEnd: (launchDir: string) => string | null): HookDecision {
  const input = isRecord(ctx.input.tool_input) ? ctx.input.tool_input : {};
  const questions: unknown[] = Array.isArray(input.questions) ? input.questions : [];
  if (carriesLegacyReference(questions)) {
    return deny(
      "this is the short reference of an earlier version of the scanner, which is no longer used: pass the program's question itself. " +
        "Call AskUserQuestion with exactly the input that the pre-launch step (or, for the declaration questions, the scan) printed last, " +
        "every character as it is; the hook checks it against the program's question and records the answer.",
    );
  }
  if (!ctx.run) {
    const shaped = questions.some((q) => isRecord(q) && typeof q.header === "string" && [RUN_SHAPE_HEADER, EARLIER_RUN_HEADER].some((h) => normal(q.header as string) === normal(h)));
    return shaped ? deny("CLAUDE_PROJECT_DIR is not set, so the hook cannot check this question against the program's or record its answer; the question was not asked.") : PASS;
  }
  const launchDir = ctx.run.launchDir;
  // A round of declaration questions (relay item 7): the round itself, or a look-alike of it while it is on disk.
  const declaration = declarationPre(ctx, launchDir, input, questions);
  if (declaration !== null) return declaration;
  // The earlier-run question, or a look-alike of it while it is outstanding for this session.
  const earlier = earlierRunPre(ctx, launchDir, input, questions, lastRunEnd(launchDir));
  if (earlier !== null) return earlier;
  // The program's confirmation, or a look-alike of it while it is outstanding for this session.
  const confirmation = confirmationPre(ctx, launchDir, input, questions);
  if (confirmation !== null) return confirmation;
  const loaded = loadRunShapeQuestion(launchDir);
  if (!("problem" in loaded) && isDeepStrictEqual(questions, loaded.input.questions)) return passProgramQuestion(ctx, launchDir, RUN_SHAPE_KIND, loaded, loaded.run_id, input, deny);
  // Not the program's question. Only while the event belongs to the active run, and only a question that looks like
  // the run-shape question, is refused (integration part B item 3: before, in every session of a scanned project).
  if (!existsSync(ctx.run.legalDir) || !inRun(ctx)) return PASS;
  const why = lookAlike(questions, "problem" in loaded ? null : loaded);
  if (why === null) return PASS;
  const looks = `this question looks like the run-shape question (${why})`;
  if ("problem" in loaded) return deny(`${looks}, but there is no program question to check it against: ${loaded.problem}. ${writeAgain(RUN_SHAPE_KIND)}.`);
  const unrecorded = unrecordedQuestion(launchDir, loaded);
  if (unrecorded !== null) return deny(`${looks}, but ${loaded.path} is not the question the pre-launch step wrote (${unrecorded}). ${writeAgain(RUN_SHAPE_KIND)}.`);
  return deny(
    `${looks}, but it is not the program's question as the pre-launch step wrote it: ${firstDifference(loaded.input, input, "the input") ?? "it differs"}. ` +
      `The person answers only the program's own question, and the scanner's hook checks every character. ${passExactly(loaded.input, RUN_SHAPE_KIND.writer)}`,
  );
}

/**
 * PostToolUse on AskUserQuestion, the main session: where the question answered is the program's own and the
 * call is one the PreToolUse passed, write the answer file and its ledger line. Any other question writes
 * nothing. A failure to write throws, which the dispatcher records in the failure log; the pre-launch step then
 * finds no answer, or an answer with no ledger line, and refuses.
 */
export function questionPost(ctx: HookContext): HookDecision {
  if (!ctx.run) return PASS;
  const response = ctx.input.tool_response;
  if (!isRecord(response)) return PASS;
  const launchDir = ctx.run.launchDir;
  const earlier = onRecord(launchDir, EARLIER_RUN_QUESTION_FILE) ? loadEarlierRunQuestion(launchDir) : null;
  if (earlier !== null && !("problem" in earlier) && isDeepStrictEqual(response.questions, [earlier.question])) return earlierRunPost(ctx, launchDir, response, earlier);
  const confirmation = onRecord(launchDir, CONFIRMATION_QUESTION_FILE) ? loadConfirmationQuestion(launchDir) : null;
  if (confirmation !== null && !("problem" in confirmation) && isDeepStrictEqual(response.questions, [confirmation.question])) return confirmationPost(ctx, launchDir, response, confirmation);
  const loaded = loadRunShapeQuestion(launchDir);
  if ("problem" in loaded || !isDeepStrictEqual(response.questions, [loaded.question])) return declarationPost(ctx, launchDir, response);
  const pre = answerPrelude(ctx, launchDir, RUN_SHAPE_KIND, loaded.run_id, loaded.sha256);
  if ("done" in pre) return pre.done;
  const { toolUseId, sessionId, base } = pre;
  const given = isRecord(response.answers) ? response.answers[loaded.question.question] : undefined;
  const answer = typeof given === "string" && given.trim() !== "" ? given : null;
  const record: RunShapeAnswer = {
    kind: "run-shape-answer",
    version: 1,
    written_by: ANSWER_WRITER,
    run_id: loaded.run_id,
    question_file: loaded.path,
    question_sha256: loaded.sha256,
    session_id: sessionId,
    tool_use_id: toolUseId,
    transcript_path: stringOr(ctx.input.transcript_path),
    recorded_at: base.at,
    answered: answer !== null,
    answer,
    shape: answer !== null && Object.hasOwn(loaded.shapeByLabel, answer) ? (loaded.shapeByLabel[answer] ?? null) : null,
    no_answer:
      answer !== null
        ? null
        : typeof response.afkTimeoutMs === "number"
          ? `the question closed after ${response.afkTimeoutMs} ms with no answer (a time-out: tool_response.afkTimeoutMs)`
          : "tool_response.answers holds no answer to the program's question",
    annotations: keptAnnotations(response.annotations, [loaded.question], null),
  };
  return writeAnswer(launchDir, RUN_SHAPE_KIND, record, base, toolUseId, sessionId);
}

/**
 * PostToolUse, either kind: the checks before an answer is written (the question file is the one its writer recorded,
 * the event names its call, and the hook's PreToolUse passed that call). What fails writes `answer-not-taken`.
 */
function answerPrelude(
  ctx: HookContext,
  launchDir: string,
  kind: RelayKind,
  runId: string,
  questionSha256: string,
): { done: HookDecision } | { toolUseId: string; sessionId: string | null; base: Pick<RunShapeLedgerLine, "v" | "at" | "by" | "run_id" | "question_sha256"> } {
  const toolUseId = stringOr(ctx.input.tool_use_id);
  const sessionId = stringOr(ctx.input.session_id);
  const base = { v: 1 as const, at: ctx.now().toISOString(), by: ANSWER_WRITER, run_id: runId, question_sha256: questionSha256 };
  const notTaken = (reason: string): { done: HookDecision } => {
    appendLedger(launchDir, { ...base, event: "answer-not-taken", ...(toolUseId !== null ? { tool_use_id: toolUseId } : {}), session_id: sessionId, reason }, kind);
    return { done: PASS };
  };
  const unrecorded = unrecordedQuestion(launchDir, { sha256: questionSha256 }, kind);
  if (unrecorded !== null) return notTaken(`the question file is not the one ${kind.step} wrote: ${unrecorded}`);
  if (toolUseId === null) return notTaken("the event carries no tool_use_id");
  const passed = readLedger(launchDir, kind).some(
    (l) => l.event === "question-passed" && l.tool_use_id === toolUseId && l.question_sha256 === questionSha256 && (l.session_id ?? null) === sessionId,
  );
  if (!passed) return notTaken("the hook's PreToolUse did not pass this call (no question-passed line for its tool_use_id), so the question may not be the program's as passed");
  return { toolUseId, sessionId, base };
}

/** PostToolUse, either kind: write the answer file and its `answer-written` line. Throws where it cannot. */
function writeAnswer(
  launchDir: string,
  kind: RelayKind,
  record: { transcript_path: string | null; answered: boolean },
  base: Pick<RunShapeLedgerLine, "v" | "at" | "by" | "run_id" | "question_sha256">,
  toolUseId: string,
  sessionId: string | null,
): HookDecision {
  const text = `${JSON.stringify(record, null, 2)}\n`;
  const path = launchRecordPath(launchDir, kind.answerFile, true);
  const partial = `${path}.${process.pid}.partial`;
  writeFileAt(partial, text);
  renamePath(partial, path);
  appendLedger(launchDir, {
    ...base,
    event: "answer-written",
    tool_use_id: toolUseId,
    session_id: sessionId,
    transcript_path: record.transcript_path,
    answer_sha256: sha256(text),
    answered: record.answered,
  }, kind);
  return PASS;
}

/** A run shape taken from the person's answer, with the records it was checked against. */
export interface TakenRunShape {
  shape: string;
  answer: RunShapeAnswer;
  path: string;
  answerSha256: string;
  ledgerLine: RunShapeLedgerLine;
}

/**
 * The run shape the person chose, for the pre-launch step: taken from the answer file alone, and only where it
 * answers the question file as it is now, the hook's ledger records it for its own call, that call is the latest
 * asking (the hook's last pass), and no launch list has used it; no transcript is read.
 * Anything else is refused by name, and nothing is written. The answer file is never changed here; `markRunShapeAnswerUsed` records the use.
 */
export function takeRunShape(launchDir: string): TakenRunShape | { refused: string } {
  const question = loadRunShapeQuestion(launchDir);
  if ("problem" in question) return { refused: `the run-shape question cannot be read: ${question.problem}` };
  const again = "Ask the question again with exactly the input printed above, every character as it is, then run this command again";
  const at = placeOrProblem(launchDir, RUN_SHAPE_ANSWER_FILE);
  if ("problem" in at) return { refused: `the run-shape answer cannot be read: ${at.problem}. ${again}` };
  const path = at.path;
  if (!existsSync(path)) {
    return { refused: `there is no answer file ${valueText(path)}: nobody has answered this run's question through the scanner's hook (a question closed with "Chat about this" leaves none). ${again}` };
  }
  let bytes: Buffer;
  let doc: unknown;
  const got = readProgramFile("the run-shape answer", path); // the one reader (program-file.ts)
  if (!got.ok) return { refused: `${got.problem}. ${again}` };
  try {
    bytes = got.value;
    doc = JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    return { refused: `${valueText(path)} could not be read as JSON (${valueText(messageOf(e))}). ${again}` };
  }
  if (!isRecord(doc) || doc.kind !== "run-shape-answer" || doc.version !== 1) return { refused: `${valueText(path)} is not a run-shape answer (kind and version). ${again}` };
  if (doc.question_sha256 !== question.sha256) {
    return { refused: `${valueText(path)} answers a different question (sha256 ${String(doc.question_sha256)}); the question in ${question.path} is now sha256 ${question.sha256}. ${again}` };
  }
  if (doc.answered !== true || typeof doc.answer !== "string") {
    return { refused: `${valueText(path)} carries no answer: ${typeof doc.no_answer === "string" ? doc.no_answer : "it is not marked answered"}. ${again}` };
  }
  const shape = Object.hasOwn(question.shapeByLabel, doc.answer) ? question.shapeByLabel[doc.answer] : undefined;
  if (shape === undefined) {
    const labels = Object.keys(question.shapeByLabel).map((l) => JSON.stringify(l)).join(", ");
    return { refused: `the person answered ${JSON.stringify(doc.answer)}, which is not one of the question's options (${labels}). Talk it over with the person; ${again.charAt(0).toLowerCase()}${again.slice(1)}` };
  }
  if (doc.shape !== shape) return { refused: `${valueText(path)} records the shape ${String(doc.shape)} for ${JSON.stringify(doc.answer)}, but the question maps that answer to ${shape}. ${again}` };
  const checked = checkAnswer(
    RUN_SHAPE_KIND,
    launchDir,
    path,
    bytes,
    doc,
    question.sha256,
    again,
  );
  if ("refused" in checked) return checked;
  return { shape, answer: doc as unknown as RunShapeAnswer, path, answerSha256: checked.answerSha256, ledgerLine: checked.ledgerLine };
}

/**
 * The checks every kind's answer passes once its own fields are read (R8: one function, every kind): the hook's ledger
 * records the file's bytes for its call, that call is the latest asking the hook passed, and no `answer-used` line names
 * it. The answer, its ledger and the question are the hook's and the
 * program's own records in the person's state folder, which no tool call may write (a guard row each), and the hook
 * wrote the answer from what Claude Code handed it at the question (its tool response and session id): they are the whole
 * check. No session transcript is located or read: the transcript was once found from a path a project file named, or
 * under a folder the command's own environment named, and both were forged.
 */
function checkAnswer(
  kind: RelayKind,
  launchDir: string,
  path: string,
  bytes: Buffer,
  doc: Record<string, unknown>,
  questionSha256: string,
  again: string,
): { answerSha256: string; ledgerLine: RunShapeLedgerLine; toolUseId: string } | { refused: string } {
  const ledgerPath = shownPlace(launchDir, kind.ledgerFile);
  const toolUseId = stringOr(doc.tool_use_id);
  if (toolUseId === null) return { refused: `${valueText(path)} names no question call (tool_use_id), so it cannot be checked against the hook's ledger. ${again}` };
  // The hook's ledger: the file's bytes as the hook wrote them, for this call.
  const answerSha256 = sha256(bytes);
  let ledger: RunShapeLedgerLine[];
  try {
    ledger = readLedger(launchDir, kind);
  } catch (e) {
    return { refused: `the ledger ${valueText(ledgerPath)} could not be read (${valueText(messageOf(e))}). ${again}` };
  }
  const written = ledger.filter((l) => l.event === "answer-written" && l.answer_sha256 === answerSha256 && l.tool_use_id === toolUseId && l.question_sha256 === questionSha256).at(-1);
  if (!written) {
    return {
      refused: `${valueText(path)} is not an answer the scanner's hook wrote: no answer-written line of ${valueText(ledgerPath)} records its sha256 ${answerSha256} for call ${toolUseId}. An answer file written or changed by anything but the hook is never used. ${again}`,
    };
  }
  // Only the latest asking counts: the answer's call must be the last call the hook passed, whatever version of
  // the question that pass was for (the price table changes with the sub-agent limit while the run stays the same).
  const passes = ledger.filter((l) => l.event === "question-passed");
  const lastPass = passes.at(-1);
  if (!passes.some((l) => l.tool_use_id === toolUseId)) {
    return { refused: `no question-passed line of ${valueText(ledgerPath)} names call ${toolUseId}: the scanner's hook never passed that call, so its answer is not the person's answer to a question the hook put in. ${again}` };
  }
  if (lastPass?.tool_use_id !== toolUseId) {
    return {
      refused:
        `${valueText(path)} answers call ${toolUseId}, an earlier asking of ${kind.noun}: the scanner's hook passed call ${String(lastPass?.tool_use_id)} after it ` +
        `(${valueText(ledgerPath)}, question-passed at ${String(lastPass?.at)}). Only the answer to the latest asking is used; an earlier asking's answer is refused whether it is still on disk, written back or re-typed. ${again}`,
    };
  }
  const used = ledger.find((l) => l.event === "answer-used" && l.tool_use_id === toolUseId);
  if (used) {
    return { refused: `the answer to call ${toolUseId} was already used at ${String(used.at)} for ${kind.usedFor === "launch_list" ? `the launch list ${String(used.launch_list)}` : kind.usedFor === "profile" ? `the declaration ${String(used.profile)}` : String(used.used_for)}; an answer is used once. ${again}` };
  }
  return { answerSha256, ledgerLine: written, toolUseId };
}

/**
 * The pre-launch step, once the launch list for a taken answer is on disk: record that the answer is used. Throws where
 * it cannot. `launchList` is null where the answer wrote no list (the person answered "Not now" to the start
 * question), with the reason; the answer is used all the same, so a later call does not take it again.
 */
export function markRunShapeAnswerUsed(launchDir: string, taken: TakenRunShape, launchList: string | null, at: Date, reason?: string): void {
  appendLedger(launchDir, {
    v: 1,
    event: "answer-used",
    at: at.toISOString(),
    by: STEP_WRITER,
    run_id: taken.answer.run_id,
    question_sha256: taken.answer.question_sha256,
    tool_use_id: taken.ledgerLine.tool_use_id ?? "",
    answer_sha256: taken.answerSha256,
    ...(launchList !== null ? { launch_list: launchList } : {}),
    ...(reason !== undefined ? { reason } : {}),
  });
}

/**
 * The pre-launch step wrote the launch list in the recommended
 * shape without asking (a later scan of the project, no `--ask-shape`). The line names the list, so the assembly ties
 * the list's shape to this line and not to an answer (`runShapeFromAnswer`). Throws where it cannot.
 */
export function recordRunShapeDefault(launchDir: string, runId: string, shape: string, launchList: string, at: Date): void {
  appendLedger(launchDir, {
    v: 1,
    event: "run-shape-default",
    at: at.toISOString(),
    by: STEP_WRITER,
    run_id: runId,
    question_sha256: "",
    shape,
    launch_list: launchList,
    reason: "a later scan of this project: the recommended plan is used without asking; /legal-scan plan asks",
  });
}

// ------------------------------------------------------------------------------------------------
// The declaration questions (relay item 7, R8): the same relay, carrying the scan's rounds.

/** A round's asking id, `scan-<scan id> round <n>`: the ledger's lines of a round name it. */
export function declarationAsking(scanId: string, round: number): string {
  return `scan-${scanId.toLowerCase().replace(/^scan-/, "").replace(/[^0-9a-z-]+/g, "-")} round ${round}`;
}

/** A round as the scan wrote it (the declaration question record), with the digest of the file's bytes. */
export interface LoadedDeclarationQuestion {
  path: string;
  asking: string;
  scanId: string;
  round: number;
  /** The session the scan ran in: a look-alike is refused only in that session. */
  sessionId: string | null;
  input: Record<string, unknown>;
  questions: AskQuestion[];
  /** Every header a declaration question has (the scan writes them from the one source; this module reads no schema). */
  lookAlikeHeaders: string[];
  /** The option labels only a declaration question carries ("Not answering"), from the same source. */
  lookAlikeLabels: string[];
  sha256: string;
  doc: Record<string, unknown>;
}

const stringsOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((h): h is string => typeof h === "string" && h !== "") : []);

/** Read the round the scan wrote, or say why it cannot be used. Never throws. */
export function loadDeclarationQuestion(launchDir: string): LoadedDeclarationQuestion | { problem: string } {
  const at = placeOrProblem(launchDir, DECLARATION_QUESTION_FILE);
  if ("problem" in at) return at;
  const path = at.path;
  if (!existsSync(path)) return { problem: `${valueText(path)} does not exist` };
  const got = readProgramFile("the declaration questions", path); // the one reader (program-file.ts)
  if (!got.ok) return { problem: got.problem };
  let doc: unknown;
  try {
    doc = JSON.parse(got.value.toString("utf8"));
  } catch (e) {
    return { problem: `${valueText(path)} could not be read as JSON (${valueText(messageOf(e))})` };
  }
  if (!isRecord(doc) || doc.kind !== "declaration-question" || doc.version !== 1) return { problem: `${valueText(path)} is not a round of declaration questions (kind and version) the scan wrote` };
  if (typeof doc.asking !== "string" || typeof doc.scan_id !== "string" || typeof doc.round !== "number") return { problem: `${valueText(path)} names no asking (asking, scan_id and round)` };
  const input = doc.ask_user_question_input;
  if (!isRecord(input) || !Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > 4) {
    return { problem: `${valueText(path)}: ask_user_question_input.questions is not a list of 1 to 4 questions` };
  }
  for (const q of input.questions) {
    const problem = questionProblem(q);
    if (problem) return { problem: `${valueText(path)}: ${problem}` };
  }
  return {
    path,
    asking: doc.asking,
    scanId: doc.scan_id,
    round: doc.round,
    sessionId: stringOr(doc.session_id),
    input,
    questions: input.questions as AskQuestion[],
    lookAlikeHeaders: stringsOf(doc.look_alike_headers),
    lookAlikeLabels: stringsOf(doc.look_alike_labels),
    sha256: sha256(got.value),
    doc,
  };
}

/**
 * The scan, once it has written a round: record the bytes it wrote, and the session the round is asked in (the write
 * guard's window, declarationUnderWay). Throws where it cannot.
 */
export function recordDeclarationQuestion(launchDir: string, asking: string, written: string | Buffer, at: Date, sessionId: string | null = null): void {
  appendLedger(launchDir, { v: 1, event: "question-written", at: at.toISOString(), by: DECLARATION_KIND.writer, run_id: asking, question_sha256: sha256(written), session_id: sessionId }, DECLARATION_KIND);
}

/**
 * The scan in a Claude Code session, once it has gone past its refusals (which write nothing) and before its first pass
 * reads the declaration: record that the run has started in this session, whether or not it will write
 * a round, so that the declaration's files are the program's own from here to the end of the run that follows
 * (declarationUnderWay). Throws where it cannot, as the round's line does.
 */
export function recordDeclarationScan(launchDir: string, out: string, at: Date, sessionId: string | null): void {
  appendLedger(launchDir, { v: 1, event: "scan-started", at: at.toISOString(), by: DECLARATION_KIND.writer, session_id: sessionId, out }, DECLARATION_KIND);
}

/**
 * The write guard (hook-guard.ts): whether a run's declaration is under way in this
 * session, so that the declaration's files are the program's own: the ledger's last `scan-started` or
 * `question-written` line is later than `endedAt` (the last run end the active-run history records; null where it
 * records none) and names `sessionId`, or names no session (a line an older build wrote: taken as any session's, the
 * safe side). A ledger that does not read counts as under way. THE WINDOW:
 * it starts at every scan in a session (its `scan-started` line; an older build's ledger starts it
 * at the first round's `question-written`), whether or not the scan writes a round - a later run with every answer
 * saved writes none - and ends where the active-run history records the end of a run after it (`legal-scan run-abort`
 * or the assembly), since the declaration is read before the active-run marker is written (by the scan and the
 * pre-launch step), and the orchestrator works between them. With `scanClosedEnds` (the launch gate's Bash check and
 * its prompt check before the run) it also ends at a `scan-closed` line after the opening one, which
 * `legal-scan run-abort` writes where the scan never reached a run (`recordDeclarationScanClosed`); the write guard
 * reads it without, so the declaration's own files stay guarded until a run ends.
 */
export function declarationUnderWay(launchDir: string, sessionId: string | null, endedAt: string | null, scanClosedEnds = false): boolean {
  let ledger: RunShapeLedgerLine[];
  try {
    ledger = readLedger(launchDir, DECLARATION_KIND);
  } catch {
    return true;
  }
  const opened = openingLine(ledger, endedAt, scanClosedEnds);
  if (opened === null) return false;
  const named = stringOr(opened.session_id);
  return named === null || named === sessionId;
}

/**
 * The ledger's last line that opens the window (`scan-started`, or an older build's `question-written`), where it is
 * later than `endedAt` and, with `scanClosedEnds`, no `scan-closed` line follows it; else null.
 */
function openingLine(ledger: RunShapeLedgerLine[], endedAt: string | null, scanClosedEnds: boolean): RunShapeLedgerLine | null {
  let at = -1;
  ledger.forEach((l, i) => {
    if (l.event === "scan-started" || l.event === "question-written") at = i;
  });
  const opened = ledger[at];
  if (opened === undefined || typeof opened.at !== "string") return null;
  // Compared as instants; an opening line whose time is not the program's form keeps
  // the window open (the guarded side), and so does a run end that is not (latestRunEndAt never returns one).
  if (endedAt !== null && !laterThan(opened.at, endedAt)) return null;
  if (scanClosedEnds && ledger.slice(at + 1).some((l) => l.event === "scan-closed")) return null;
  return opened;
}

/** Whether `at` is later than the run end `endedAt`, as instants; an `at` not in the program's form counts as later. */
function laterThan(at: string, endedAt: string): boolean {
  const a = programInstant(at);
  const e = programInstant(endedAt);
  return a === null || e === null || a > e;
}

/**
 * `legal-scan run-abort` where no run is active. Where the ledger reads
 * and a scan's window is open - its last opening line later than `endedAt` (the last run end the active-run history
 * records) and no `scan-closed` after it, in whatever session it names - the scan never reached a run: record a
 * `scan-closed` line and return true, so that the window of the Bash check and of the prompt check before the run
 * closes (`declarationUnderWay` with `scanClosedEnds`). Where none is open, or the ledger does not read, write nothing
 * and return false. THE DECLARATION'S OWN FILES STAY GUARDED until a run ends (the write guard, hook-guard.ts, reads
 * the window without `scanClosedEnds`): a window the model could close itself before the run, by running `run-abort`,
 * would let a tool call write the declaration's answers between the person's answers and the pre-launch step. The line closes the window of the two checks and nothing else - the
 * pre-launch step reads only the question rounds (index.ts `declarationOutstanding`), so the scan can still be taken to a
 * run. The model can write the line itself (run-abort where no run is active is not refused, `abortRefusal`), and the
 * two checks then stay off until the run's marker stands. That is accepted because it allows nothing the time before the
 * scan's start does not already allow: both checks begin at the scan's start by design (hook-launch.ts
 * `shellBeforeTheRun`, `deliveryBeforeTheRun`), so before it a second Claude Code process or a scheduled slash command
 * is not refused either, and from the run's marker on the launch gate refuses them whatever this line says.
 */
export function recordDeclarationScanClosed(launchDir: string, endedAt: string | null, at: Date, sessionId: string | null): boolean {
  let ledger: RunShapeLedgerLine[];
  try {
    ledger = readLedger(launchDir, DECLARATION_KIND);
  } catch {
    return false;
  }
  if (openingLine(ledger, endedAt, true) === null) return false;
  appendLedger(launchDir, { v: 1, event: "scan-closed", at: at.toISOString(), by: "legal-scan run-abort", session_id: sessionId }, DECLARATION_KIND);
  return true;
}

/**
 * Whether a scan's window stands open in this folder, in whatever session it
 * names: the window `recordDeclarationScanClosed` closes (the ledger's last opening line later than `endedAt`, with no
 * `scan-closed` line after it). `legal-scan decide` reads it beside the run's marker in place of the scan-under-way
 * marker, which stays after run-abort of a scan that never reached a run (hook.ts) and so would refuse every decision
 * until some later run ended. A ledger that does not read throws, naming it.
 */
export function scanWindowOpen(launchDir: string, endedAt: string | null): boolean {
  return openingLine(readLedger(launchDir, DECLARATION_KIND), endedAt, true) !== null;
}

/** Every refusal of a declaration question states its recovery (the one table, recovery.ts). */
const denyDeclaration = (reason: string): HookDecision => deny(`${reason} ${recoveryFor("declaration-question-refused")}`);

/** Why a question of the orchestrator's own looks like a declaration question, or null where it does not. */
function declarationLookAlike(questions: unknown[], program: LoadedDeclarationQuestion): string | null {
  const headers = new Set([DECLARATION_HEADER, ...program.lookAlikeHeaders].map(normal));
  const labels = new Set(program.lookAlikeLabels.map(normal));
  const scan = program.asking.split(" ")[0] ?? program.asking;
  for (const q of questions) {
    if (!isRecord(q)) continue;
    if (typeof q.header === "string" && headers.has(normal(q.header))) return `its header "${q.header}" is a declaration question's`;
    if (typeof q.question === "string" && (q.question.includes(program.scanId) || q.question.includes(scan))) return `it names the scan ${program.scanId}`;
    const hit = Array.isArray(q.options) ? q.options.find((o) => isRecord(o) && typeof o.label === "string" && labels.has(normal(o.label))) : undefined;
    if (isRecord(hit)) return `an option is labelled "${String(hit.label)}"`;
  }
  return null;
}

/**
 * PreToolUse, a round of declaration questions on disk (relay item 7): the round itself (the call's questions equal to
 * the round's) is passed as it is and recorded, in any session; a look-alike of a declaration question that differs
 * from the round is refused, naming the first difference and carrying the input to pass, in the session the round
 * names, or in any session where the round names none (the scan now refuses to write such a round, and an older build wrote them; the safe side).
 * Anything else is left to the run-shape rules (null).
 */
function declarationPre(ctx: HookContext, launchDir: string, input: Record<string, unknown>, questions: unknown[]): HookDecision | null {
  if (!onRecord(launchDir, DECLARATION_QUESTION_FILE)) return null;
  const round = loadDeclarationQuestion(launchDir);
  if ("problem" in round) return null;
  if (isDeepStrictEqual(questions, round.questions)) return passProgramQuestion(ctx, launchDir, DECLARATION_KIND, round, round.asking, input, denyDeclaration);
  if (round.sessionId !== null && stringOr(ctx.input.session_id) !== round.sessionId) return null;
  const why = declarationLookAlike(questions, round);
  if (why === null) return null;
  const looks = `this question looks like a declaration question (${why})`;
  const unrecorded = unrecordedQuestion(launchDir, round, DECLARATION_KIND);
  if (unrecorded !== null) return denyDeclaration(`${looks}, but ${round.path} is not the round the scan wrote (${unrecorded}).`);
  return denyDeclaration(
    `${looks}, but it is not the program's round as the scan wrote it: ${firstDifference(round.input, input, "the input") ?? "it differs"}. ` +
      `The person answers only the program's own questions, and the scanner's hook checks every character. ${passExactly(round.input, DECLARATION_KIND.writer)}`,
  );
}

/** PostToolUse where the question answered is not the run-shape question: a declaration round the hook passed writes its answer file. */
function declarationPost(ctx: HookContext, launchDir: string, response: Record<string, unknown>): HookDecision {
  const loaded = loadDeclarationQuestion(launchDir);
  if ("problem" in loaded || !isDeepStrictEqual(response.questions, loaded.questions)) return PASS;
  const pre = answerPrelude(ctx, launchDir, DECLARATION_KIND, loaded.asking, loaded.sha256);
  if ("done" in pre) return pre.done;
  const got = isRecord(response.answers) ? response.answers : {};
  const answers: Record<string, string> = {};
  for (const q of loaded.questions) {
    const v = got[q.question];
    if (typeof v === "string" && v.trim() !== "") answers[q.question] = v;
  }
  const all = Object.keys(answers).length === loaded.questions.length;
  const record = {
    kind: "declaration-answer",
    version: 1,
    written_by: ANSWER_WRITER,
    run_id: loaded.asking,
    question_file: loaded.path,
    question_sha256: loaded.sha256,
    session_id: pre.sessionId,
    tool_use_id: pre.toolUseId,
    transcript_path: stringOr(ctx.input.transcript_path),
    recorded_at: pre.base.at,
    answered: Object.keys(answers).length > 0,
    /** The person's answer to each of the program's questions that has one, keyed by its text: a label, or text typed. */
    answers,
    no_answer: all
      ? null
      : typeof response.afkTimeoutMs === "number"
        ? `the questions closed after ${response.afkTimeoutMs} ms with some unanswered (a time-out: tool_response.afkTimeoutMs)`
        : "tool_response.answers holds no answer to some of the program's questions",
    annotations: keptAnnotations(response.annotations, loaded.questions, null),
  };
  return writeAnswer(launchDir, DECLARATION_KIND, record, pre.base, pre.toolUseId, pre.sessionId);
}

/** A round's answers taken from the person's answer file, with the records they were checked against. */
export interface TakenDeclaration {
  question: LoadedDeclarationQuestion;
  /** Each of the round's questions, by its text: the label chosen, text the person typed, or null (no answer). */
  answers: Record<string, string | null>;
  path: string;
  answerSha256: string;
  ledgerLine: RunShapeLedgerLine;
  toolUseId: string;
}

/**
 * The scan's `--declaration-from-answer`: a round's answers, taken from the answer file alone and only under the same
 * checks as the run shape (`checkAnswer`). No round the scan wrote on disk is `declaration-no-round` (nothing of it can be asked again, so the scan runs again first);
 * no answer file is `declaration-answer-missing` (F1b);
 * anything else refused is `declaration-answer-forged` (F5, F5b). Nothing is written here; `markDeclarationAnswerUsed`
 * records the use.
 */
export function takeDeclarationAnswer(
  launchDir: string,
): TakenDeclaration | { refused: string; kind: "declaration-no-round" | "declaration-answer-missing" | "declaration-answer-forged" } {
  const again = "Ask the questions again with exactly the input the scan printed last, every character as it is, then run this command again";
  const question = loadDeclarationQuestion(launchDir);
  if ("problem" in question) return { refused: `there is no round of declaration questions to take an answer for: ${question.problem}`, kind: "declaration-no-round" };
  const at = placeOrProblem(launchDir, DECLARATION_ANSWER_FILE);
  const path = "path" in at ? at.path : DECLARATION_ANSWER_FILE;
  if (!("path" in at) || !existsSync(path)) {
    return { refused: `there is no answer file ${valueText(path)}: nobody has answered this round through the scanner's hook (a question closed with "Chat about this" leaves none). ${again}`, kind: "declaration-answer-missing" };
  }
  const forged = (refused: string): { refused: string; kind: "declaration-answer-forged" } => ({ refused, kind: "declaration-answer-forged" });
  const got = readProgramFile("the declaration answer", path); // the one reader (program-file.ts)
  if (!got.ok) return forged(`${got.problem}. ${again}`);
  let doc: unknown;
  try {
    doc = JSON.parse(got.value.toString("utf8"));
  } catch (e) {
    return forged(`${valueText(path)} could not be read as JSON (${valueText(messageOf(e))}). ${again}`);
  }
  if (!isRecord(doc) || doc.kind !== "declaration-answer" || doc.version !== 1) return forged(`${valueText(path)} is not a declaration answer (kind and version). ${again}`);
  if (doc.question_sha256 !== question.sha256) {
    return forged(`${valueText(path)} answers a different round (sha256 ${String(doc.question_sha256)}); the questions in ${question.path} are now sha256 ${question.sha256}. ${again}`);
  }
  const texts = new Set(question.questions.map((q) => q.question));
  const given = isRecord(doc.answers) ? doc.answers : null;
  if (given === null || Object.entries(given).some(([k, v]) => !texts.has(k) || typeof v !== "string")) {
    return forged(`${valueText(path)} carries answers to other questions than the round's, or answers that are not text. ${again}`);
  }
  const answers: Record<string, string | null> = {};
  for (const q of question.questions) {
    const v = given[q.question];
    answers[q.question] = typeof v === "string" && v !== "" ? v : null;
  }
  const checked = checkAnswer(
    DECLARATION_KIND,
    launchDir,
    path,
    got.value,
    doc,
    question.sha256,
    again,
  );
  if ("refused" in checked) return forged(checked.refused);
  return { question, answers, path, answerSha256: checked.answerSha256, ledgerLine: checked.ledgerLine, toolUseId: checked.toolUseId };
}

/** The scan, once the declaration from a taken answer is on disk: record that the answer is used. Throws where it cannot. */
export function markDeclarationAnswerUsed(launchDir: string, taken: TakenDeclaration, profile: string, at: Date): void {
  appendLedger(
    launchDir,
    { v: 1, event: "answer-used", at: at.toISOString(), by: DECLARATION_KIND.writer, run_id: taken.question.asking, question_sha256: taken.question.sha256, tool_use_id: taken.toolUseId, answer_sha256: taken.answerSha256, profile },
    DECLARATION_KIND,
  );
}

/**
 * The last round of declaration questions the scan wrote that is still open: its `question-written` line, where the
 * ledger records no later `answer-used` (taken) and no later `question-withdrawn` (the scan removed it, no longer
 * needed). Null where none is open or the ledger has no such line. Throws where the ledger does not read.
 */
function openDeclarationRound(launchDir: string): RunShapeLedgerLine | null {
  const ledger = readLedger(launchDir, DECLARATION_KIND);
  const at = ledger.map((l) => l.event).lastIndexOf("question-written");
  if (at === -1) return null;
  if (ledger.slice(at + 1).some((l) => l.event === "answer-used" || l.event === "question-withdrawn")) return null;
  return ledger[at] as RunShapeLedgerLine;
}

/**
 * The pre-launch step (R10, F11): why a round of declaration questions is outstanding, or null where none is. A round
 * is outstanding BY THE LEDGER ALONE: the ledger's last
 * `question-written` has no later `answer-used` or `question-withdrawn`, whether or not its question file is still on
 * disk - deleting the file answers nothing, and the pre-launch step ran after such a deletion before this. A question
 * file on disk that no ledger line records is outstanding too (it is not a round the scan wrote).
 */
export function declarationOutstanding(launchDir: string): string | null {
  const path = shownPlace(launchDir, DECLARATION_QUESTION_FILE);
  const onDisk = onRecord(launchDir, DECLARATION_QUESTION_FILE);
  let open: RunShapeLedgerLine | null;
  let written: boolean;
  try {
    open = openDeclarationRound(launchDir);
    written = readLedger(launchDir, DECLARATION_KIND).some((l) => l.event === "question-written");
  } catch (e) {
    return `the ledger ${shownPlace(launchDir, DECLARATION_LEDGER_FILE)} could not be read (${valueText(messageOf(e))})${onDisk ? ` and ${valueText(path)} is on disk` : ""}`;
  }
  if (open === null) return onDisk && !written ? `${valueText(path)} is on disk, and no line of ${shownPlace(launchDir, DECLARATION_LEDGER_FILE)} records the scan writing it` : null;
  return `the round ${open.run_id} the scan wrote at ${open.at} (${path}${onDisk ? "" : ", no longer on disk"}) has not been answered and taken with --declaration-from-answer`;
}

/**
 * The scan, as it removes the question file because no declaration question is left for this run: where the ledger
 * still holds that round open (written, never taken), record its withdrawal, so that it is not outstanding by the
 * ledger (declarationOutstanding). Throws where it cannot: the scan then says so and writes nothing more.
 */
export function withdrawDeclarationRound(launchDir: string, at: Date): void {
  const open = openDeclarationRound(launchDir);
  if (open === null) return;
  appendLedger(
    launchDir,
    { v: 1, event: "question-withdrawn", at: at.toISOString(), by: DECLARATION_KIND.writer, run_id: open.run_id, question_sha256: open.question_sha256, reason: "no declaration question is left for this run" },
    DECLARATION_KIND,
  );
}

// ------------------------------------------------------------------------------------------------ The earlier-run question (EARLIER_RUN_KIND).

/** The earlier-run question as the pre-launch step wrote it, with the digest of the file's bytes. */
export interface LoadedEarlierRunQuestion {
  path: string;
  run_id: string;
  /** The new scan's id: a new scan asks again. */
  scan_id: string;
  input: Record<string, unknown>;
  question: AskQuestion;
  /**
   * Each answer the step takes and the log it names, as a path relative to the folder the step ran in: `Log <n>` for
   * every log the question lists (offered as an option or not: a log past the third is named by typing its label) and
   * EARLIER_RUN_NONE, which names none (null).
   */
  logByLabel: Record<string, string | null>;
  sha256: string;
}

/** Read the earlier-run question file, or say why it cannot be used. Never throws. */
export function loadEarlierRunQuestion(launchDir: string): LoadedEarlierRunQuestion | { problem: string } {
  const at = placeOrProblem(launchDir, EARLIER_RUN_QUESTION_FILE);
  if ("problem" in at) return at;
  const path = at.path;
  if (!existsSync(path)) return { problem: `${valueText(path)} does not exist` };
  const got = readProgramFile("the earlier-run question", path);
  if (!got.ok) return { problem: got.problem };
  let doc: unknown;
  try {
    doc = JSON.parse(got.value.toString("utf8"));
  } catch (e) {
    return { problem: `${valueText(path)} could not be read as JSON (${valueText(messageOf(e))})` };
  }
  if (!isRecord(doc) || doc.kind !== "earlier-run-question" || doc.version !== 1) return { problem: `${valueText(path)} is not an earlier-run question (kind and version) the pre-launch step wrote` };
  if (typeof doc.run_id !== "string" || doc.run_id === "" || typeof doc.scan_id !== "string") return { problem: `${valueText(path)} names no run or no scan` };
  const input = doc.ask_user_question_input;
  if (!isRecord(input) || !Array.isArray(input.questions) || input.questions.length !== 1) {
    return { problem: `${valueText(path)}: ask_user_question_input.questions is not a list of exactly one question` };
  }
  const problem = questionProblem(input.questions[0]);
  if (problem) return { problem: `${valueText(path)}: ${problem}` };
  const question = input.questions[0] as AskQuestion;
  const byLabel = doc.log_by_label;
  if (
    !isRecord(byLabel) ||
    byLabel[EARLIER_RUN_NONE] !== null ||
    Object.entries(byLabel).some(([k, v]) => (k === EARLIER_RUN_NONE ? v !== null : !/^Log [1-9][0-9]*$/.test(k) || typeof v !== "string" || v === "")) ||
    question.options.some((o) => !Object.hasOwn(byLabel, o.label))
  ) {
    return { problem: `${valueText(path)}: log_by_label does not map each option's label, and only "Log <n>" and "${EARLIER_RUN_NONE}", to a log or to none` };
  }
  return { path, run_id: doc.run_id, scan_id: doc.scan_id, input, question, logByLabel: byLabel as Record<string, string | null>, sha256: sha256(got.value) };
}

/**
 * The pre-launch step, once it has written the earlier-run question file (or, with the file as it is, where the question
 * is not outstanding for this session: `earlierRunOutstanding`): record the bytes and the session it puts them in.
 * Throws where it cannot.
 */
export function recordEarlierRunQuestion(launchDir: string, runId: string, written: string | Buffer, at: Date, sessionId: string | null): void {
  appendLedger(launchDir, { v: 1, event: "question-written", at: at.toISOString(), by: STEP_WRITER, run_id: runId, question_sha256: sha256(written), session_id: sessionId }, EARLIER_RUN_KIND);
}

/**
 * Whether the earlier-run question is outstanding for the pre-launch step of session
 * `sessionId`: the ledger's last `question-written` line is later than `endedAt` (the last run end the active-run history
 * records; null where it records none) and names that session, or names none (the safe side, as `declarationUnderWay`
 * takes such a line). A ledger that does not read counts as outstanding; one with no `question-written` line, as not.
 * The look-alike refusal holds only while it is (`earlierRunPre`), as the run-shape kind holds its own to the active
 * run: the question file stays on disk after the run, and a person's own question in a later session, or in this one
 * after the run that took the answer ended, is never refused for it. Never throws.
 */
export function earlierRunOutstanding(launchDir: string, sessionId: string | null, endedAt: string | null): boolean {
  let ledger: RunShapeLedgerLine[];
  try {
    ledger = readLedger(launchDir, EARLIER_RUN_KIND);
  } catch {
    return true;
  }
  const written = ledger.filter((l) => l.event === "question-written").at(-1);
  if (written === undefined || typeof written.at !== "string") return false;
  if (endedAt !== null && !laterThan(written.at, endedAt)) return false;
  const named = stringOr(written.session_id);
  return named === null || named === sessionId;
}

/** Whether the ledger's last `question-written` line records these bytes (the file on disk is the one the step wrote). Never throws. */
export function earlierRunQuestionRecorded(launchDir: string, written: string | Buffer): boolean {
  return unrecordedQuestion(launchDir, { sha256: sha256(written) }, EARLIER_RUN_KIND) === null;
}

/** Why a question of the orchestrator's own looks like the earlier-run question, or null where it does not. */
function earlierLookAlike(questions: unknown[], program: LoadedEarlierRunQuestion): string | null {
  const labels = new Set(Object.keys(program.logByLabel).map(normal));
  for (const q of questions) {
    if (!isRecord(q)) continue;
    if (typeof q.header === "string" && normal(q.header) === normal(EARLIER_RUN_HEADER)) return `its header is "${EARLIER_RUN_HEADER}"`;
    const text = typeof q.question === "string" ? q.question : "";
    if (Object.values(program.logByLabel).some((p) => p !== null && text.includes(p))) return "it names a log the program's question lists";
    if (Array.isArray(q.options)) {
      const hits = q.options.filter((o) => isRecord(o) && typeof o.label === "string" && labels.has(normal(o.label))).length;
      if (hits >= 2) return `${hits} of its option labels are the program's`;
    }
  }
  return null;
}

/**
 * PreToolUse, the earlier-run question on disk: the question itself is passed as it is and recorded; a look-alike that
 * differs is refused, while the question is outstanding for the event's session (`earlierRunOutstanding`, with
 * `endedAt` the last run end), naming the first difference and carrying the input to pass. Anything else is left to the
 * other kinds (null). No file on disk: null (an own question of the orchestrator's is never taken as an answer: inside a
 * session the step takes the log from the program's question alone, and refuses a typed `--previous`).
 */
function earlierRunPre(ctx: HookContext, launchDir: string, input: Record<string, unknown>, questions: unknown[], endedAt: string | null): HookDecision | null {
  if (!onRecord(launchDir, EARLIER_RUN_QUESTION_FILE)) return null;
  const loaded = loadEarlierRunQuestion(launchDir);
  if ("problem" in loaded) return null;
  if (isDeepStrictEqual(questions, loaded.input.questions)) return passProgramQuestion(ctx, launchDir, EARLIER_RUN_KIND, loaded, loaded.run_id, input, deny);
  // A look-alike is refused only while the question is outstanding for this session's
  // pre-launch step; the program's own question (above) is checked and recorded whenever it comes.
  if (!earlierRunOutstanding(launchDir, stringOr(ctx.input.session_id), endedAt)) return null;
  const why = earlierLookAlike(questions, loaded);
  if (why === null) return null;
  const looks = `this question looks like the earlier-run question (${why})`;
  const unrecorded = unrecordedQuestion(launchDir, loaded, EARLIER_RUN_KIND);
  if (unrecorded !== null) return deny(`${looks}, but ${loaded.path} is not the question the pre-launch step wrote (${unrecorded}). ${writeAgain(EARLIER_RUN_KIND)}.`);
  return deny(
    `${looks}, but it is not the program's question as the pre-launch step wrote it: ${firstDifference(loaded.input, input, "the input") ?? "it differs"}. ` +
      `Which log is the person's own earlier run is asked only by the program's own question, and the scanner's hook checks every character. ${passExactly(loaded.input, EARLIER_RUN_KIND.writer)}`,
  );
}

/** What PostToolUse writes for the earlier-run question: the person's answer, and the log it names. */
export interface EarlierRunAnswer {
  kind: "earlier-run-answer";
  version: 1;
  written_by: string;
  run_id: string;
  question_file: string;
  question_sha256: string;
  session_id: string | null;
  tool_use_id: string | null;
  transcript_path: string | null;
  recorded_at: string;
  answered: boolean;
  /** What `tool_response.answers` holds for the question: an option's label, or text the person typed. */
  answer: string | null;
  /** True where the answer is one of the labels the question maps (`log_by_label`), so `log` is its log or none. */
  named: boolean;
  log: string | null;
  no_answer: string | null;
  annotations: Record<string, unknown> | null;
}

/** PostToolUse of the earlier-run question, a call the PreToolUse passed: write the answer file and its ledger line. */
function earlierRunPost(ctx: HookContext, launchDir: string, response: Record<string, unknown>, loaded: LoadedEarlierRunQuestion): HookDecision {
  const pre = answerPrelude(ctx, launchDir, EARLIER_RUN_KIND, loaded.run_id, loaded.sha256);
  if ("done" in pre) return pre.done;
  const given = isRecord(response.answers) ? response.answers[loaded.question.question] : undefined;
  const answer = typeof given === "string" && given.trim() !== "" ? given : null;
  const named = answer !== null && Object.hasOwn(loaded.logByLabel, answer.trim());
  const record: EarlierRunAnswer = {
    kind: "earlier-run-answer",
    version: 1,
    written_by: ANSWER_WRITER,
    run_id: loaded.run_id,
    question_file: loaded.path,
    question_sha256: loaded.sha256,
    session_id: pre.sessionId,
    tool_use_id: pre.toolUseId,
    transcript_path: stringOr(ctx.input.transcript_path),
    recorded_at: pre.base.at,
    answered: answer !== null,
    answer,
    named,
    log: named && answer !== null ? (loaded.logByLabel[answer.trim()] ?? null) : null,
    no_answer:
      answer !== null
        ? null
        : typeof response.afkTimeoutMs === "number"
          ? `the question closed after ${response.afkTimeoutMs} ms with no answer (a time-out: tool_response.afkTimeoutMs)`
          : "tool_response.answers holds no answer to the program's question",
    annotations: keptAnnotations(response.annotations, [loaded.question], null),
  };
  return writeAnswer(launchDir, EARLIER_RUN_KIND, record, pre.base, pre.toolUseId, pre.sessionId);
}

/** The person's answer to the earlier-run question, taken: the log it names (null: none) and its label. */
export interface TakenEarlierRun {
  log: string | null;
  label: string;
  toolUseId: string;
  answerSha256: string;
}

/**
 * The log the person named, for the pre-launch step: taken from the answer file alone, and only where it answers the
 * question file as it is now, the hook's ledger records it for its own call, that call is the latest asking, and the
 * session's transcript shows that call answered the same way (`checkAnswer`, as for the other kinds). `missing` marks
 * the one refusal where nobody has answered yet (no answer file), on which the step prints the question again.
 * Nothing is written here.
 */
export function takeEarlierRun(launchDir: string): TakenEarlierRun | { refused: string; missing: boolean } {
  const question = loadEarlierRunQuestion(launchDir);
  if ("problem" in question) return { refused: `the earlier-run question cannot be read: ${question.problem}`, missing: false };
  const again = "Ask the question again with exactly the input printed above, every character as it is, then run this command again";
  const refused = (why: string): { refused: string; missing: boolean } => ({ refused: why, missing: false });
  const at = placeOrProblem(launchDir, EARLIER_RUN_ANSWER_FILE);
  if ("problem" in at) return refused(`the earlier-run answer cannot be read: ${at.problem}. ${again}`);
  const path = at.path;
  if (!existsSync(path)) return { refused: `there is no answer file ${valueText(path)}: nobody has answered the earlier-run question through the scanner's hook. ${again}`, missing: true };
  const got = readProgramFile("the earlier-run answer", path);
  if (!got.ok) return refused(`${got.problem}. ${again}`);
  let doc: unknown;
  try {
    doc = JSON.parse(got.value.toString("utf8"));
  } catch (e) {
    return refused(`${valueText(path)} could not be read as JSON (${valueText(messageOf(e))}). ${again}`);
  }
  if (!isRecord(doc) || doc.kind !== "earlier-run-answer" || doc.version !== 1) return refused(`${valueText(path)} is not an earlier-run answer (kind and version). ${again}`);
  if (doc.question_sha256 !== question.sha256) {
    return refused(`${valueText(path)} answers a different question (sha256 ${String(doc.question_sha256)}); the question in ${question.path} is now sha256 ${question.sha256} (a log was added, changed or removed, or this is a new scan). ${again}`);
  }
  if (doc.answered !== true || typeof doc.answer !== "string") {
    return refused(`${valueText(path)} carries no answer: ${typeof doc.no_answer === "string" ? doc.no_answer : "it is not marked answered"}. ${again}`);
  }
  const label = doc.answer.trim();
  if (!Object.hasOwn(question.logByLabel, label)) {
    return refused(
      `the person answered ${JSON.stringify(doc.answer)}, which names no log of the question by its label (${Object.keys(question.logByLabel).map((l) => JSON.stringify(l)).join(", ")}). ` +
        `A description ("the latest", "last week's") is not a name. Talk it over with the person; ${again.charAt(0).toLowerCase()}${again.slice(1)}`,
    );
  }
  const log = question.logByLabel[label] ?? null;
  if (doc.named !== true || doc.log !== log) return refused(`${valueText(path)} records the log ${JSON.stringify(doc.log)} for ${JSON.stringify(doc.answer)}, but the question maps that answer to ${JSON.stringify(log)}. ${again}`);
  const checked = checkAnswer(
    EARLIER_RUN_KIND,
    launchDir,
    path,
    got.value,
    doc,
    question.sha256,
    again,
  );
  if ("refused" in checked) return refused(checked.refused);
  return { log, label, toolUseId: checked.toolUseId, answerSha256: checked.answerSha256 };
}

// ------------------------------------------------------------------------------------------------ THE PROGRAM'S CONFIRMATION (design rf11 3.4, "Can the relay carry a question after a scan", and 3.9).

/**
 * THE PROGRAM'S CONFIRMATION, THE RELAY'S FOURTH KIND: one question a command of the program asks the person before it
 * records something in the person's own name, after a scan or run as well as during one: the decisions about findings
 * (`legal-scan decide`), a deeper check's plan, its archive request and its report. The API, for every caller:
 * 1. `writeConfirmationQuestion(launchDir, spec, at, sessionId)` writes the confirmation question record (one
 *    question of 2 to 4 options, not multi-select; each option's label mapped to the value the command acts on; the
 *    `purpose` that names the command and the `about` the command binds the answer to, for example the sha256 of the
 *    batch it will record) and its `question-written` line, and returns the input to print for the orchestrator to pass.
 * 2. The hook passes that question as it is and records the call (`questionPre`), and writes the answer from
 *    PostToolUse (`questionPost`), as for every kind.
 * 3. `takeConfirmation(launchDir, { purpose, about })` takes the answer from the answer file alone, and only where it
 *    answers the question file as it is now, for the same purpose and about, the hook's ledger records it for its own
 *    call, that call is the latest asking, the session's transcript shows that call answered the same way, and the
 *    answer is one of the options' labels (text the person typed is never a choice). It returns the value the label
 *    maps to. `missing` marks the one refusal where nobody has answered yet.
 * 4. `markConfirmationUsed(launchDir, taken, at, usedFor)` once the command has acted: an answer is used once.
 * A question asked after a run's end is carried as during one: the routes act whenever the plugin's hooks run and
 * CLAUDE_PROJECT_DIR is set, and nothing here reads the run's marker.
 *
 * NO SHIM MARKER. The other kinds write the scan-under-way marker before each ledger line (`appendLedger`), and only a
 * run's end removes it; a confirmation asked after a run would leave it standing, and the plugin's shim would then
 * fail closed on every guarded call whenever the hook cannot start, until some later run ended. This kind's lines
 * write no marker (`marksScanUnderWay: false`). Nothing needs one: where the hook cannot start, PreToolUse records no
 * call as passed and PostToolUse writes no answer, so the command finds no answer and records nothing.
 *
 * The limit of every hook-recorded answer holds here too (this module's header): a hook of another plugin, of the
 * person's settings or of a trusted repository that answers AskUserQuestion through `updatedInput` answers this
 * question as well, and the relay records that answer as the person's.
 */
export const CONFIRMATION_QUESTION_FILE = "confirmation-question.json";
export const CONFIRMATION_ANSWER_FILE = "confirmation-answer.json";
export const CONFIRMATION_LEDGER_FILE = "confirmation-ledger.jsonl";
export const CONFIRMATION_KIND: RelayKind = {
  noun: "the program's confirmation",
  questionFile: CONFIRMATION_QUESTION_FILE,
  answerFile: CONFIRMATION_ANSWER_FILE,
  ledgerFile: CONFIRMATION_LEDGER_FILE,
  ledgerName: "the confirmation ledger",
  writer: "the command that asked it (legal-scan)",
  step: "the command that asked it",
  usedFor: "confirmation",
  marksScanUnderWay: false,
};
/** A purpose: the command's own short name, lower-case letters, digits and hyphens (`decide`, `team-answers`, `deep-plan` ...). */
const PURPOSE = /^[a-z][a-z0-9-]{0,39}$/;

/** What a command asks: the question as the person sees it, and the value each option's label stands for. */
export interface ConfirmationSpec {
  purpose: string;
  about: string;
  question: AskQuestion;
  valueByLabel: Record<string, string>;
}

export interface LoadedConfirmationQuestion {
  path: string;
  /** This asking's id: the ledger's `run_id` for every line of it. */
  id: string;
  purpose: string;
  about: string;
  input: Record<string, unknown>;
  question: AskQuestion;
  valueByLabel: Record<string, string>;
  sha256: string;
  /** The session the program asked in (`session_id`), or null where it recorded none. */
  sessionId: string | null;
}

/** Why a spec cannot be asked, or null. */
function confirmationSpecProblem(spec: { purpose: unknown; about: unknown; question: unknown; valueByLabel: unknown }): string | null {
  if (typeof spec.purpose !== "string" || !PURPOSE.test(spec.purpose)) return `its purpose ${JSON.stringify(spec.purpose)} is not a short name of lower-case letters, digits and hyphens`;
  if (typeof spec.about !== "string" || spec.about === "") return "it is bound to nothing (`about` is empty)";
  const problem = questionProblem(spec.question);
  if (problem) return problem;
  const q = spec.question as AskQuestion;
  if (q.multiSelect) return "its question is multi-select, and a confirmation takes one answer";
  const map = spec.valueByLabel;
  if (!isRecord(map)) return "value_by_label is not an object";
  const labels = q.options.map((o) => o.label);
  if (Object.keys(map).length !== labels.length || labels.some((l) => typeof map[l] !== "string" || map[l] === "")) {
    return "value_by_label does not map each option's label, and only those, to a value";
  }
  return null;
}

/**
 * Write the program's confirmation for the orchestrator to pass, and record its bytes (and the session it is asked in)
 * in the confirmation ledger, with no shim marker. Throws where the spec is not a question the relay carries or a
 * file cannot be written; the caller then records nothing.
 */
export function writeConfirmationQuestion(launchDir: string, spec: ConfirmationSpec, at: Date, sessionId: string | null): { path: string; id: string; input: Record<string, unknown> } {
  const problem = confirmationSpecProblem(spec);
  if (problem !== null) throw new Error(`the program's confirmation cannot be asked: ${problem}`);
  const id = `${spec.purpose}-${at.getTime().toString(36)}-${randomUUID().slice(0, 8)}`;
  const input = { questions: [spec.question] };
  const doc = { kind: "program-confirmation-question", version: 1, id, purpose: spec.purpose, about: spec.about, session_id: sessionId, ask_user_question_input: input, value_by_label: spec.valueByLabel };
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  const path = launchRecordPath(launchDir, CONFIRMATION_QUESTION_FILE, true);
  const partial = `${path}.${process.pid}.partial`;
  writeFileAt(partial, text);
  renamePath(partial, path);
  appendLedger(
    launchDir,
    { v: 1, event: "question-written", at: at.toISOString(), by: CONFIRMATION_KIND.writer, run_id: id, question_sha256: sha256(text), session_id: sessionId, purpose: spec.purpose, about: spec.about },
    CONFIRMATION_KIND,
  );
  return { path, id, input };
}

/** Read the program's confirmation file, or say why it cannot be used. Never throws. */
export function loadConfirmationQuestion(launchDir: string): LoadedConfirmationQuestion | { problem: string } {
  const at = placeOrProblem(launchDir, CONFIRMATION_QUESTION_FILE);
  if ("problem" in at) return at;
  const path = at.path;
  if (!existsSync(path)) return { problem: `${valueText(path)} does not exist` };
  const got = readProgramFile("the program's confirmation", path);
  if (!got.ok) return { problem: got.problem };
  let doc: unknown;
  try {
    doc = JSON.parse(got.value.toString("utf8"));
  } catch (e) {
    return { problem: `${valueText(path)} could not be read as JSON (${valueText(messageOf(e))})` };
  }
  if (!isRecord(doc) || doc.kind !== "program-confirmation-question" || doc.version !== 1) return { problem: `${valueText(path)} is not a confirmation (kind and version) the program wrote` };
  if (typeof doc.id !== "string" || doc.id === "") return { problem: `${valueText(path)} names no asking` };
  const input = doc.ask_user_question_input;
  if (!isRecord(input) || !Array.isArray(input.questions) || input.questions.length !== 1) {
    return { problem: `${valueText(path)}: ask_user_question_input.questions is not a list of exactly one question` };
  }
  const problem = confirmationSpecProblem({ purpose: doc.purpose, about: doc.about, question: input.questions[0], valueByLabel: doc.value_by_label });
  if (problem !== null) return { problem: `${valueText(path)}: ${problem}` };
  return {
    path,
    id: doc.id,
    purpose: doc.purpose as string,
    about: doc.about as string,
    input,
    question: input.questions[0] as AskQuestion,
    valueByLabel: doc.value_by_label as Record<string, string>,
    sha256: sha256(got.value),
    sessionId: typeof doc.session_id === "string" && doc.session_id !== "" ? doc.session_id : null,
  };
}

/**
 * Whether the program's confirmation is outstanding for session `sessionId`: the ledger's last `question-written` line
 * has no `answer-used` or `question-withdrawn` line after it, and names that session or none. A ledger that does not
 * read counts as outstanding. The look-alike refusal holds only while it is (`confirmationPre`). Never throws.
 */
export function confirmationOutstanding(launchDir: string, sessionId: string | null): boolean {
  let ledger: RunShapeLedgerLine[];
  try {
    ledger = readLedger(launchDir, CONFIRMATION_KIND);
  } catch {
    return true;
  }
  const k = ledger.map((l) => l.event).lastIndexOf("question-written");
  if (k < 0) return false;
  const written = ledger[k] as RunShapeLedgerLine;
  if (ledger.slice(k + 1).some((l) => (l.event === "answer-used" || l.event === "question-withdrawn") && l.run_id === written.run_id)) return false;
  const named = stringOr(written.session_id);
  return named === null || named === sessionId;
}

/** Why a question of the orchestrator's own looks like the program's confirmation, or null where it does not. */
function confirmationLookAlike(questions: unknown[], program: LoadedConfirmationQuestion): string | null {
  const labels = new Set(Object.keys(program.valueByLabel).map(normal));
  for (const q of questions) {
    if (!isRecord(q)) continue;
    if (typeof q.header === "string" && normal(q.header) === normal(program.question.header)) return `its header is "${program.question.header}"`;
    if (Array.isArray(q.options)) {
      const hits = q.options.filter((o) => isRecord(o) && typeof o.label === "string" && labels.has(normal(o.label))).length;
      if (hits >= 2) return `${hits} of its option labels are the program's`;
    }
  }
  return null;
}

/**
 * PreToolUse, the program's confirmation on disk: the question itself is passed as it is and recorded; a look-alike
 * that differs is refused while the confirmation is outstanding for the event's session. Anything else is left to the
 * other kinds (null).
 */
function confirmationPre(ctx: HookContext, launchDir: string, input: Record<string, unknown>, questions: unknown[]): HookDecision | null {
  if (!onRecord(launchDir, CONFIRMATION_QUESTION_FILE)) return null;
  const loaded = loadConfirmationQuestion(launchDir);
  if ("problem" in loaded) return null;
  if (isDeepStrictEqual(questions, loaded.input.questions)) return passProgramQuestion(ctx, launchDir, CONFIRMATION_KIND, loaded, loaded.id, input, deny);
  if (!confirmationOutstanding(launchDir, stringOr(ctx.input.session_id))) return null;
  const why = confirmationLookAlike(questions, loaded);
  if (why === null) return null;
  const looks = `this question looks like the program's confirmation (${why})`;
  const unrecorded = unrecordedQuestion(launchDir, loaded, CONFIRMATION_KIND);
  if (unrecorded !== null) return deny(`${looks}, but ${loaded.path} is not the question the program wrote (${unrecorded}). ${writeAgain(CONFIRMATION_KIND)}.`);
  return deny(
    `${looks}, but it is not the program's question as it was written: ${firstDifference(loaded.input, input, "the input") ?? "it differs"}. ` +
      `The person confirms only through the program's own question, and the scanner's hook checks every character. ${passExactly(loaded.input, CONFIRMATION_KIND.writer)}`,
  );
}

/** What PostToolUse writes for the program's confirmation: the person's answer, and the value its label stands for. */
export interface ConfirmationAnswer {
  kind: "program-confirmation-answer";
  version: 1;
  written_by: string;
  confirmation_id: string;
  purpose: string;
  about: string;
  question_file: string;
  question_sha256: string;
  session_id: string | null;
  tool_use_id: string | null;
  transcript_path: string | null;
  recorded_at: string;
  answered: boolean;
  answer: string | null;
  /** The value the answer's label maps to; null where the answer is no option's label (typed text) or there is none. */
  value: string | null;
  no_answer: string | null;
  annotations: Record<string, unknown> | null;
  /**
   * The session's permission mode where the hook's input carries it (design 3.9, "The
   * permission modes": "kept in the record"); null where it does not.
   */
  permission_mode?: string | null;
  /** Present where the answer is typed text of a purpose whose typed answers are checked before they are written. */
  screened?: ScreenedAnswer;
}

/**
 * (D3b's record, section 8 item 1, and the ruling on it.) A
 * typed answer the program keeps (the deeper check's report) is checked BEFORE the relay writes anything of it, so a
 * refused answer leaves nothing and a kept one is never on disk unredacted. The check is the deeper check's own
 * (`reportScreen`, deep-copy-text.ts), registered by the hooks' routes process (hook-child.ts): this module sits inside
 * the judging closure and imports no part of the deeper check. Over the limit, the answer file holds none of the text,
 * only its line count; within it, the text as the check keeps it (strings that look like keys replaced). Either way it
 * holds the keyed digest of the words as given (typedTextDigest), never the words' unkeyed digest. Where no check is registered for such a
 * purpose, nothing of the text is written either (`unchecked`).
 */
export type TypedAnswerScreen = (answer: string) => { kept: false; lines: number } | { kept: true; text: string; lines: number; replaced: number };
/** The confirmation purpose of the deeper check's report (`deepen --report`), whose typed answers are checked first. */
export const DEEP_REPORT_PURPOSE = "deep-report";
const SCREENED_PURPOSES: ReadonlySet<string> = new Set([DEEP_REPORT_PURPOSE]);
const TYPED_SCREENS = new Map<string, TypedAnswerScreen>();
/** Register the check of `purpose`'s typed answers (hook-child.ts, at its start). */
export function screenTypedAnswers(purpose: string, screen: TypedAnswerScreen): void {
  if (!SCREENED_PURPOSES.has(purpose)) throw new Error(`${purpose} is not a purpose whose typed answers are checked before they are written`);
  TYPED_SCREENS.set(purpose, screen);
}
/**
 * The keyed digest of a typed answer's words as given (`typedTextDigest`, under this computer's key), which the relay
 * writes in place of the words; an unkeyed sha256 of them was kept before.
 */
export interface GivenDigest {
  given_digest: string;
}
/** What the relay wrote of a typed answer it checked: the answer file's `answer` is the kept text, or null. */
export interface ScreenedAnswer extends GivenDigest {
  kept: boolean;
  /** The answer's line count, as the check counts it; null where it was not checked. */
  lines: number | null;
  /** Strings that looked like keys and were replaced; null where nothing was kept. */
  replaced: number | null;
  /** Why it was not checked (no check registered), where it was not. */
  unchecked?: string;
}
function screenTyped(purpose: string, answer: string): { text: string | null; screened: ScreenedAnswer } {
  const given_digest = typedTextDigest(answer);
  const screen = TYPED_SCREENS.get(purpose);
  if (screen === undefined) return { text: null, screened: { kept: false, lines: null, replaced: null, given_digest, unchecked: "the program's check of typed answers was not loaded in the hook" } };
  const r = screen(answer);
  return r.kept ? { text: r.text, screened: { kept: true, lines: r.lines, replaced: r.replaced, given_digest } } : { text: null, screened: { kept: false, lines: r.lines, replaced: null, given_digest } };
}
function screenedOf(v: unknown): ScreenedAnswer | null | "malformed" {
  if (v === undefined) return null;
  if (!isRecord(v) || typeof v.kept !== "boolean" || typeof v.given_digest !== "string" || !/^[0-9a-f]{64}$/.test(v.given_digest)) return "malformed";
  if (!(v.lines === null || (typeof v.lines === "number" && Number.isInteger(v.lines) && v.lines >= 0))) return "malformed";
  if (!(v.replaced === null || (typeof v.replaced === "number" && Number.isInteger(v.replaced) && v.replaced >= 0))) return "malformed";
  if (v.kept && (v.lines === null || v.replaced === null)) return "malformed";
  return { kept: v.kept, lines: v.lines as number | null, replaced: v.replaced as number | null, given_digest: v.given_digest, ...(typeof v.unchecked === "string" ? { unchecked: v.unchecked } : {}) };
}

/** What an answer file keeps of one text field of a question's annotations (`keptAnnotations`). */
export interface KeptAnnotationText extends ScreenedAnswer {
  /** The text as the purpose's check kept it; null where nothing was kept (refused, unchecked, or no check for the purpose). */
  text: string | null;
}

/**
 * What an answer file keeps of `tool_response.annotations` (rf11 FXD, C3 item 3). Claude Code's annotations carry, per
 * question, the person's free-text notes on their selection ("notes") beside the option's preview: the same person's
 * words as a typed answer, through a second field, which the relay wrote verbatim (a key pasted there was kept raw and
 * whole, past the 400-line limit, before and without the check). Kept now: only the questions the program asked, by
 * their text (as `answers` is read, so no key of the response's choosing is written), and of each, only its text fields,
 * each passed through the purpose's check of typed answers first where the purpose has one (strings that look like keys
 * replaced, nothing kept over 400 lines), as the typed answer is; where it has none, none of the text, only its keyed digest (typedTextDigest).
 * No step reads the annotations back.
 */
function keptAnnotations(raw: unknown, questions: readonly { question: string }[], purpose: string | null): Record<string, Record<string, KeptAnnotationText>> | null {
  if (!isRecord(raw)) return null;
  const out: Record<string, Record<string, KeptAnnotationText>> = {};
  for (const { question } of questions) {
    const a = Object.hasOwn(raw, question) ? raw[question] : undefined;
    if (!isRecord(a)) continue;
    const kept: Record<string, KeptAnnotationText> = {};
    for (const [field, v] of Object.entries(a)) {
      if (typeof v !== "string" || !/^[A-Za-z_]{1,32}$/.test(field)) continue;
      if (purpose !== null && SCREENED_PURPOSES.has(purpose)) {
        const c = screenTyped(purpose, v);
        kept[field] = { text: c.text, ...c.screened };
      } else kept[field] = { text: null, kept: false, lines: null, replaced: null, given_digest: typedTextDigest(v), unchecked: "the program checks no typed text of this question, so it keeps none" };
    }
    if (Object.keys(kept).length > 0) out[question] = kept;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** PostToolUse of the program's confirmation, a call the PreToolUse passed: write the answer file and its ledger line (no shim marker). */
function confirmationPost(ctx: HookContext, launchDir: string, response: Record<string, unknown>, loaded: LoadedConfirmationQuestion): HookDecision {
  const pre = answerPrelude(ctx, launchDir, CONFIRMATION_KIND, loaded.id, loaded.sha256);
  if ("done" in pre) return pre.done;
  const given = isRecord(response.answers) ? response.answers[loaded.question.question] : undefined;
  const answer = typeof given === "string" && given.trim() !== "" ? given : null;
  const checked = answer !== null && !Object.hasOwn(loaded.valueByLabel, answer) && SCREENED_PURPOSES.has(loaded.purpose) ? screenTyped(loaded.purpose, answer) : null;
  const record: ConfirmationAnswer = {
    kind: "program-confirmation-answer",
    version: 1,
    written_by: ANSWER_WRITER,
    confirmation_id: loaded.id,
    purpose: loaded.purpose,
    about: loaded.about,
    question_file: loaded.path,
    question_sha256: loaded.sha256,
    session_id: pre.sessionId,
    tool_use_id: pre.toolUseId,
    transcript_path: stringOr(ctx.input.transcript_path),
    recorded_at: pre.base.at,
    answered: answer !== null,
    answer: checked !== null ? checked.text : answer,
    value: answer !== null && Object.hasOwn(loaded.valueByLabel, answer) ? (loaded.valueByLabel[answer] ?? null) : null,
    no_answer:
      answer !== null
        ? null
        : typeof response.afkTimeoutMs === "number"
          ? `the question closed after ${response.afkTimeoutMs} ms with no answer (a time-out: tool_response.afkTimeoutMs)`
          : "tool_response.answers holds no answer to the program's question",
    annotations: keptAnnotations(response.annotations, [loaded.question], loaded.purpose),
    permission_mode: typeof ctx.input.permission_mode === "string" ? ctx.input.permission_mode : null,
    ...(checked !== null ? { screened: checked.screened } : {}),
  };
  return writeAnswer(launchDir, CONFIRMATION_KIND, record, pre.base, pre.toolUseId, pre.sessionId);
}

/** The person's answer to the program's confirmation, taken. */
export interface TakenConfirmation {
  id: string;
  purpose: string;
  about: string;
  label: string;
  value: string;
  toolUseId: string;
  answerSha256: string;
  questionSha256: string;
  /** Whether the answer is text the person typed (taken only where the command asked for it: `opts.typed`). */
  typed: boolean;
  /** The session's permission mode as the hook's input carried it, or null. */
  permissionMode: string | null;
  /**
   * What the relay wrote of a typed answer it checked before writing (`label` is
   * then the kept text, or "" where nothing was kept); absent where the answer is no such typed answer.
   */
  screened?: ScreenedAnswer;
}

/** The value a typed answer stands for, where the command takes one (`takeConfirmation`'s `opts.typed`). */
export const TYPED_ANSWER_VALUE = "typed";

/**
 * The person's answer to the program's confirmation, for the command that asked it (see CONFIRMATION_KIND's note for the
 * checks). `expect` is what the command is about to act on: an answer to a confirmation of another purpose, or bound to
 * another `about`, is refused. Nothing is written here.
 */
export function takeConfirmation(
  launchDir: string,
  expect: { purpose: string; about: string },
  // A command whose question takes the person's own words as its answer (the deeper
  // check's report, design 3.9 step 6: "the question's free-text answer") passes `typed: true`: text that is no option's
  // label is then taken, with the value TYPED_ANSWER_VALUE and the text as `label`, under every other check here. Every
  // other confirmation still refuses it.
  opts: { typed?: boolean } = {},
): TakenConfirmation | { refused: string; missing: boolean } {
  const question = loadConfirmationQuestion(launchDir);
  if ("problem" in question) return { refused: `the program's confirmation cannot be read: ${question.problem}`, missing: false };
  const again = "Ask the question again with exactly the input printed above, every character as it is, then run this command again";
  const refused = (why: string): { refused: string; missing: boolean } => ({ refused: why, missing: false });
  if (question.purpose !== expect.purpose || question.about !== expect.about) {
    return refused(`${question.path} asks for ${JSON.stringify(question.purpose)} about ${JSON.stringify(question.about)}, not for ${JSON.stringify(expect.purpose)} about ${JSON.stringify(expect.about)}: run the command again, and it asks its own question`);
  }
  const at = placeOrProblem(launchDir, CONFIRMATION_ANSWER_FILE);
  if ("problem" in at) return refused(`the confirmation's answer cannot be read: ${at.problem}. ${again}`);
  const path = at.path;
  if (!existsSync(path)) return { refused: `there is no answer file ${valueText(path)}: nobody has answered the program's confirmation through the scanner's hook. ${again}`, missing: true };
  const got = readProgramFile("the confirmation's answer", path);
  if (!got.ok) return refused(`${got.problem}. ${again}`);
  let doc: unknown;
  try {
    doc = JSON.parse(got.value.toString("utf8"));
  } catch (e) {
    return refused(`${valueText(path)} could not be read as JSON (${valueText(messageOf(e))}). ${again}`);
  }
  if (!isRecord(doc) || doc.kind !== "program-confirmation-answer" || doc.version !== 1) return refused(`${valueText(path)} is not an answer to the program's confirmation (kind and version). ${again}`);
  if (doc.question_sha256 !== question.sha256 || doc.confirmation_id !== question.id) {
    return refused(`${valueText(path)} answers a different question (sha256 ${String(doc.question_sha256)}); the question in ${question.path} is now sha256 ${question.sha256}. ${again}`);
  }
  const screened = screenedOf(doc.screened);
  if (screened === "malformed") return refused(`${valueText(path)} carries a checked typed answer in a form the relay does not write (its screened field). ${again}`);
  if (screened !== null && !SCREENED_PURPOSES.has(question.purpose)) return refused(`${valueText(path)} carries a checked typed answer, but the relay checks none for ${JSON.stringify(question.purpose)}. ${again}`);
  const notKept = screened !== null && !screened.kept;
  if (doc.answered !== true || (notKept ? doc.answer !== null : typeof doc.answer !== "string")) {
    return refused(`${valueText(path)} carries no answer: ${typeof doc.no_answer === "string" ? doc.no_answer : "it is not marked answered"}. ${again}`);
  }
  const label = notKept ? "" : (doc.answer as string);
  const typed = screened !== null || !Object.hasOwn(question.valueByLabel, label);
  // Typed text of a checked purpose that the relay wrote unchecked is refused: it
  // is not an answer this release's relay writes.
  if (typed && screened === null && SCREENED_PURPOSES.has(question.purpose)) return refused(`${valueText(path)} holds typed text the relay did not check before writing it. ${again}`);
  if (typed && opts.typed !== true) {
    return refused(
      `the person answered ${screened !== null ? "in words of their own" : JSON.stringify(label)}, which is none of the question's options (${Object.keys(question.valueByLabel).map((l) => JSON.stringify(l)).join(", ")}); ` +
        `text of the person's own is never taken as a choice. Talk it over with the person; ${again.charAt(0).toLowerCase()}${again.slice(1)}`,
    );
  }
  const value = typed ? TYPED_ANSWER_VALUE : (question.valueByLabel[label] as string);
  if (typed ? doc.value !== null : doc.value !== value) return refused(`${valueText(path)} records the value ${JSON.stringify(doc.value)} for ${JSON.stringify(label)}, but the question maps that answer to ${JSON.stringify(value)}. ${again}`);
  const checked = checkAnswer(
    CONFIRMATION_KIND,
    launchDir,
    path,
    got.value,
    doc,
    question.sha256,
    again,
  );
  if ("refused" in checked) return refused(checked.refused);
  // The answer belongs to the session the program asked in, where it recorded one.
  const answeredIn = stringOr(checked.ledgerLine.session_id);
  if (question.sessionId !== null && answeredIn !== question.sessionId) {
    return refused(`the answer to call ${checked.toolUseId} was given in session ${String(answeredIn)}, not in session ${question.sessionId}, where the program asked its question. ${again}`);
  }
  return {
    ...(screened !== null ? { screened } : {}),
    id: question.id,
    purpose: question.purpose,
    about: question.about,
    label,
    value,
    toolUseId: checked.toolUseId,
    answerSha256: checked.answerSha256,
    questionSha256: question.sha256,
    typed,
    permissionMode: typeof doc.permission_mode === "string" ? doc.permission_mode : null,
  };
}

/** Once the command has acted on the answer: an `answer-used` line, with no shim marker. Throws where it cannot. */
export function markConfirmationUsed(launchDir: string, taken: TakenConfirmation, at: Date, usedFor: string): void {
  appendLedger(
    launchDir,
    { v: 1, event: "answer-used", at: at.toISOString(), by: CONFIRMATION_KIND.writer, run_id: taken.id, question_sha256: taken.questionSha256, tool_use_id: taken.toolUseId, answer_sha256: taken.answerSha256, purpose: taken.purpose, about: taken.about, used_for: usedFor },
    CONFIRMATION_KIND,
  );
}

// ------------------------------------------------------------------------------------------------
// The command's words, as the shell would pass them.

/** One simple command of a command line. */
export interface ShellCommand {
  /** Commands joined by `;`, `&&`, `||`, `&`, a new line or a parenthesis are in different pipelines. */
  pipeline: number;
  /** The command's place in its pipeline (`|`): a later stage reads an earlier one's output. */
  stage: number;
  /** The words, with quotes and escapes removed as the shell removes them. Expansions (`$VAR`, `$(...)`) are kept as written. */
  words: string[];
}

/** How deep a quoted command line inside a word (`bash -c "..."`, `eval "..."`, `$(...)`) is read again. */
const SHELL_DEPTH = 4;

/** From `start` (just past `$(`), the index just past the matching `)`, skipping quoted text; the text's end if none. */
function substitutionEnd(text: string, start: number): number {
  let depth = 1;
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") i += 2;
    else if (c === "'") {
      const e = text.indexOf("'", i + 1);
      i = e === -1 ? text.length : e + 1;
    } else if (c === '"') {
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      i++;
    } else if (c === "(") {
      depth++;
      i++;
    } else if (c === ")") {
      depth--;
      i++;
      if (depth === 0) return i;
    } else i++;
  }
  return text.length;
}

const ANSI_C: Record<string, string> = { n: "\n", t: "\t", r: "\r", a: "\x07", b: "\b", f: "\f", v: "\v", e: "\x1b", E: "\x1b", "\\": "\\", "'": "'", '"': '"', "?": "?" };

/**
 * `$'...'` from just past its opening quote: the text bash passes for it, and the index just past its closing
 * quote. As bash does, the end is found first (a backslash takes the next character with it) and the text is
 * then decoded by the escapes of bash's ANSI-C quoting: the entries of ANSI_C; one to three octal digits, the
 * value kept to eight bits; `\x` with one or two hex digits, `\u` with one to four, `\U` with one to eight; `\c`
 * with a character, its control character (`\c\\` is one). An escape bash does not know, and `\x`, `\u`, `\U` or
 * `\c` with nothing to take, stay as written, backslash included; a NUL ends the value and the rest of the quoted
 * text is dropped. Each rule was checked against bash 5.2.21.
 */
function ansiCQuoted(text: string, start: number): { value: string; end: number } {
  let end = start;
  while (end < text.length && text[end] !== "'") end += text[end] === "\\" ? 2 : 1;
  const body = text.slice(start, Math.min(end, text.length));
  let value = "";
  let ended = false;
  const code = (c: number): void => {
    if (c === 0) ended = true;
    else value += String.fromCodePoint(c > 0x10ffff ? 0xfffd : c);
  };
  const digits = (re: RegExp, from: number, max: number): string => {
    let e = from;
    while (e < body.length && e - from < max && re.test(body[e] as string)) e++;
    return body.slice(from, e);
  };
  let i = 0;
  while (i < body.length && !ended) {
    const k = body[i + 1];
    if (body[i] !== "\\" || k === undefined) {
      value += body[i] as string;
      i++;
    } else if (/[0-7]/.test(k)) {
      const d = digits(/[0-7]/, i + 1, 3);
      code(Number.parseInt(d, 8) & 0xff);
      i += 1 + d.length;
    } else if (k === "x" || k === "u" || k === "U") {
      const d = digits(/[0-9A-Fa-f]/, i + 2, k === "x" ? 2 : k === "u" ? 4 : 8);
      if (d === "") value += `\\${k}`;
      else code(Number.parseInt(d, 16));
      i += 2 + d.length;
    } else if (k === "c" && i + 2 < body.length) {
      const x = body[i + 2] as string;
      code(x === "?" ? 0x7f : x.toUpperCase().charCodeAt(0) & 0x1f);
      i += x === "\\" && body[i + 3] === "\\" ? 4 : 3;
    } else {
      value += Object.hasOwn(ANSI_C, k) ? (ANSI_C[k] as string) : `\\${k}`;
      i += 2;
    }
  }
  return { value, end: end + 1 };
}

/**
 * The simple commands of a command line, each as the words the shell would pass: single quotes, double quotes
 * and backslashes are removed as the shell removes them, `$'...'` is decoded (`ansiCQuoted`), a comment is
 * dropped, and a word that is itself
 * a command line (`bash -c "..."`, `eval "..."`) and every command substitution (`$(...)`, backquotes) are read
 * again as commands, each as a pipeline of its own. A here-document's lines are read as commands.
 */
export function shellCommands(command: string): ShellCommand[] {
  const out: ShellCommand[] = [];
  let pipelines = 0;
  const parse = (text: string, depth: number): void => {
    const first = out.length;
    const nested: string[] = [];
    let pipeline = pipelines++;
    let stage = 0;
    let words: string[] = [];
    let word: string | null = null;
    const add = (s: string): void => {
      word = (word ?? "") + s;
    };
    const endWord = (): void => {
      if (word !== null) words.push(word);
      word = null;
    };
    const endCommand = (newPipeline: boolean): void => {
      endWord();
      if (words.length > 0) out.push({ pipeline, stage, words });
      words = [];
      if (newPipeline) {
        pipeline = pipelines++;
        stage = 0;
      } else stage++;
    };
    const n = text.length;
    let i = 0;
    while (i < n) {
      const c = text[i] as string;
      const next = text[i + 1];
      if (c === "\\") {
        if (next !== undefined && next !== "\n") add(next);
        i += 2;
      } else if (c === "'") {
        const e = text.indexOf("'", i + 1);
        add(text.slice(i + 1, e === -1 ? n : e));
        i = e === -1 ? n : e + 1;
      } else if (c === "$" && next === "'") {
        const quoted = ansiCQuoted(text, i + 2);
        add(quoted.value);
        i = quoted.end;
      } else if (c === "$" && next === "(") {
        const e = substitutionEnd(text, i + 2);
        nested.push(text.slice(i + 2, e - 1));
        add(text.slice(i, e));
        i = e;
      } else if (c === "`") {
        let e = i + 1;
        while (e < n && text[e] !== "`") e += text[e] === "\\" ? 2 : 1;
        nested.push(text.slice(i + 1, e));
        add(text.slice(i, Math.min(e + 1, n)));
        i = e + 1;
      } else if (c === '"' || (c === "$" && next === '"')) {
        let v = "";
        i += c === "$" ? 2 : 1;
        while (i < n && text[i] !== '"') {
          const k = text[i] as string;
          if (k === "\\" && i + 1 < n) {
            const e = text[i + 1] as string;
            if (e === "\n") {
              // A line continuation inside double quotes.
            } else if (e === "$" || e === "`" || e === '"' || e === "\\") v += e;
            else v += `\\${e}`;
            i += 2;
          } else if (k === "$" && text[i + 1] === "(") {
            const e = substitutionEnd(text, i + 2);
            nested.push(text.slice(i + 2, e - 1));
            v += text.slice(i, e);
            i = e;
          } else if (k === "`") {
            let e = i + 1;
            while (e < n && text[e] !== "`") e += text[e] === "\\" ? 2 : 1;
            nested.push(text.slice(i + 1, e));
            v += text.slice(i, Math.min(e + 1, n));
            i = e + 1;
          } else {
            v += k;
            i++;
          }
        }
        add(v);
        i++;
      } else if (c === " " || c === "\t") {
        endWord();
        i++;
      } else if (c === "\n" || c === ";" || c === "(" || c === ")") {
        endCommand(true);
        i++;
      } else if (c === "&") {
        if (next === ">") {
          endWord();
          i += text[i + 2] === ">" ? 3 : 2;
        } else {
          endCommand(true);
          i += next === "&" ? 2 : 1;
        }
      } else if (c === "|") {
        if (next === "|") {
          endCommand(true);
          i += 2;
        } else {
          endCommand(false);
          i += next === "&" ? 2 : 1;
        }
      } else if (c === "<" || c === ">") {
        endWord();
        i++;
        while (i < n && (text[i] === "<" || text[i] === ">" || text[i] === "&")) i++;
      } else if (c === "#" && word === null) {
        const e = text.indexOf("\n", i);
        i = e === -1 ? n : e;
      } else {
        add(c);
        i++;
      }
    }
    endCommand(true);
    if (depth >= SHELL_DEPTH) return;
    const mine = out.slice(first);
    for (const cmd of mine) for (const w of cmd.words) if (/[\s;&|()<>]/.test(w)) parse(w, depth + 1);
    for (const inner of nested) parse(inner, depth + 1);
  };
  parse(command, 0);
  return out;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** A word, and, where it is an assignment (`NAME=value`), its value too. */
const valuesOf = (w: string): string[] => (ASSIGNMENT.test(w) ? [w, w.slice(w.indexOf("=") + 1)] : [w]);
const isAdjudicate = (w: string): boolean => valuesOf(w).includes("adjudicate");
/** A word that is `flag` or `flag=...`, or an assignment of one. */
const isFlag =
  (flag: string) =>
  (w: string): boolean =>
    valuesOf(w).some((v) => v === flag || v.startsWith(`${flag}=`));
const isShapeFlag = isFlag(SHAPE_FLAG);
/** `--previous-findings` and `--previous-scan` are other flags, not this one. */
const isPreviousFlag = isFlag(PREVIOUS_FLAG);

/**
 * The program's `adjudicate` given a flag `is` names, read from the command's words: refused where such a word (or an
 * assignment of one) is in a command that names `adjudicate` itself, or anywhere but downstream of `adjudicate` in the
 * same pipeline, where it can only be data that `adjudicate` wrote (`adjudicate --help | grep -e --shape`).
 */
function passesFlag(command: string, is: (w: string) => boolean): boolean {
  const commands = shellCommands(command);
  const runs = commands.filter((c) => c.words.some(isAdjudicate));
  if (runs.length === 0) return false;
  return commands.some((c) => c.words.some(is) && (c.words.some(isAdjudicate) || !runs.some((a) => a.pipeline === c.pipeline && a.stage < c.stage)));
}

/** The program's `adjudicate` given `--shape` (or `--shape=`), read from the command's words (`passesFlag`). */
export function passesShapeFlag(command: string): boolean {
  return passesFlag(command, isShapeFlag);
}

/**
 * The program's `adjudicate` given `--previous` (or `--previous=`), by the same word rule.
 * The program refuses `--previous` itself only where it sees a session sign (index.ts), and a Bash command can remove
 * those; this route reads the command's words whatever the environment, as it does for `--shape`.
 */
export function passesPreviousFlag(command: string): boolean {
  return passesFlag(command, isPreviousFlag);
}

export const SHAPE_FLAG_REFUSAL =
  "wolfboy: inside Claude Code the run shape is taken only from the person's answer to the program's run-shape question, " +
  "never from --shape, which is kept for a run outside Claude Code. Ask the question with exactly the input the pre-launch step printed, " +
  "then run the same adjudicate command with --shape-from-answer in place of --shape.";

export const PREVIOUS_FLAG_REFUSAL =
  "wolfboy: inside Claude Code the earlier run is taken only from the person's answer to the program's earlier-run question, " +
  "never from --previous, which is kept for a run outside Claude Code. Run the same adjudicate command without --previous, " +
  "and with the session's variables as they are: where a log is under .legal/evidence, it prints the question to pass.";

/** PreToolUse on Bash, whoever runs it: refuse the program's `adjudicate` with `--shape` or with `--previous`. */
export function shapeFlagPre(ctx: HookContext): HookDecision {
  const input = ctx.input.tool_input;
  const command = isRecord(input) && typeof input.command === "string" ? input.command : "";
  if (passesShapeFlag(command)) return { kind: "deny", reason: SHAPE_FLAG_REFUSAL };
  return passesPreviousFlag(command) ? { kind: "deny", reason: PREVIOUS_FLAG_REFUSAL } : PASS;
}
