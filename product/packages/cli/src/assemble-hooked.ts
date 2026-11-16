/**
 * ASSEMBLY READS WHAT THE HOOKS WROTE (relay integration part B, the assembly area, milestone 3: items 1 and 3;
 * A-12, A-13, A-29, A-36's `endActiveRun`, A-57, A-58, A-59 (O5); B5; proposal P:277).
 *
 * A run is HOOKED when its launch directory holds an active-run marker for the launch list's `run_id` (in
 * `active-run.json` or the active-run history) that names a Claude Code session. In a hooked run every record is
 * an answer the plugin's hook took: the capture ledger is required and must hold; each record's latest entry says
 * it was made by the hook, names a launch-list entry and the seat a `launched` event bound to that entry; the seat's
 * own transcript holds the hand-back the record was taken from (for an amended record, every hand-back of the chain
 * the record's reply was merged from), and the session's transcript holds the launch that
 * made the seat - or, for a seat the run's relay launched, the relay's own transcript holds it and the session's holds
 * the relay's launch by a listed relay entry of the run. Each list entry is answered, or its seat's answer
 * stayed invalid and it is reported as not judged
 * (the hook's receipt); anything else is refused by name. The run shape is the person's answer as the hook
 * recorded it, never a flag. Every file read here is read by the program that wrote it elsewhere (the capture
 * ledger by verdict-capture.ts, the hook ledger by hook-capture.ts, the list by launch-list-file.ts, the run-shape
 * files by hook-question.ts); the merge step (B6) moves these reads to the one shared reader.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { relativePath } from "./project-path.js";
import { APPENDS_IT_AGAIN, THEN_ASSEMBLE, type Refusal, type RefusalKind } from "./recovery.js";
import { jsonFilesUnder } from "./command-boundary.js";
import { deadlineOfCall, notJudgedOf, readAnswerLedgers, relaunchAdvice, relaunchable, type NotJudged, type NotJudgedSets, type Relaunch } from "./entry-answer.js";
import { REFUSALS_MAX, SEAT_CAPTURES_FILE, readHookLedger, type HookLedgerLine, type SeatCaptureLine } from "./hook-capture.js";
import { CAPTURE_HANDBACK_LIMIT_MS, HOOK_BEGUN_LOG, HOOK_FAILURE_LOG, HOOK_PROCESS_DEADLINE_MS } from "./hook.js";
import { runAgentEffort, seatEfforts } from "./seat-effort.js";
import { ACTIVE_RUN_HISTORY_FILE, abortCommand, endActiveRun, readActiveRun, readJsonLines, relayRecordsOfRun, scannerCommand, seatBinding } from "./hook-launch.js";
import { keptPlacesNamed, launchRecordOwner, launchRecordPath, transcriptPlaceRefusal } from "./state-record.js";
import { currentExaminations, type LaterEntry, refuterEntryId, silenceEntryId } from "./launch-later.js";
import { standingRefuters } from "./launch-list-file.js";
import { readLaunchList } from "./launch-list-file.js";
import { captureKeyOf, type LaunchEntry, type LaunchList } from "./launch-plan.js";
import { LEDGER_FILE, checkLedger, firstJsonValue, readCaptureLedger, type CaptureVia, type LedgerEntry } from "./verdict-capture.js";
import { REFUSED_DIR, amendedReply } from "./amend.js";
import { agentTranscriptOf, seatTranscriptOf } from "./seat-opened.js";
import { heldReports, type HeldReports } from "./held-reports.js";
import { PLACES_KEPT_DIR } from "./place-reply.js";
import { readProgramFile } from "./program-file.js";
import { readRegularFile } from "./project-read.js";
import { toldArgs } from "./scanner-command.js";
import { isChallengeEntry } from "./second-look.js";

type Obj = Record<string, unknown>;
const isRecord = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
const realOf = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

/* What is reported as not judged is the not-judged rule's (entry-answer.ts `keptInvalidOf`, `notJudgedOf`; the one copy, which
 * verdict-verify's NO VERDICT reads too). Its types are re-exported for the callers. */
export type { NotJudged, NotJudgedSets };

export interface HookedRun {
  listPath: string;
  list: LaunchList | null;
  hooked: boolean;
  refusals: Refusal[];
  /** Printed as `noted:` lines: facts about seats that change no result. */
  noted: string[];
  /** Seat reports Claude Code held back or never delivered (held-reports.ts); absent where none. */
  heldReports?: HeldReports;
  notJudged: NotJudgedSets;
  /**
   * Violation candidates `refuter-entries` held back without an entry (the launch list's `appended[].held[]`) that no
   * refuter entry of the list names: by finding_id, the reason it wrote, several joined by "; ".
   */
  held: Map<string, string>;
  /** The refuter entries made from bytes their record no longer holds (launch-list-file.ts `standingRefuters`), with why: not awaited, and their answers are no refutation. */
  superseded: ReadonlyMap<string, string>;
  /**
   * The second-look entries of the list that stand (a refuter entry in challenge
   * mode, not superseded), finding id to entry id. One with no record is not refused: its finding keeps its first placement,
   * marked as not answered (assemble-report.ts `secondLooksOf`).
   */
  challengeEntries: Map<string, string>;
  /** The claim each of those entries' second look checks (its `claim`), finding id to claim. */
  lookClaims: Map<string, string>;
  /** True where a capture ledger exists and every record was checked against it (X33: the report says when none was). */
  ledgerChecked: boolean;
  /** The records under verdicts/ the capture ledger does not list, by their path under the assembled directory, each with
   * every file its situation leaves, `.legal`-relative: the copy and, where step 5a has assembled it, its assembled copy
   * (a line about one states the stray-file recovery naming them all: recovery.ts `STRAY`). */
  unlisted: Map<string, string[]>;
  /**
   * In a hooked run, by finding_id: the relaunch rule's decision for the list entry that launches the seat answering the
   * candidate - its adjudicator or verdict-after-readers entry (`verdicts`), its refuter entry (`refutations`). A line on
   * the candidate states that entry's recovery, as the entry's own line does.
   */
  decisions: { verdicts: Map<string, Relaunch>; refutations: Map<string, Relaunch> };
  /** In a hooked run, by finding_id of an accepted adjudicator record's candidate that no refuter entry names: SKILL.md
   * step 5's command over that record, which appends its refuter entry (a `refutation-missing` line prints it). */
  appendRefuter: Map<string, string>;
  /** The launch list exists and does not read as the program's own (a `launch-list` refusal): a line on a candidate then
   * cannot tell which entry answers it, and says so (recovery.ts LIST_UNREAD). */
  listUnread: boolean;
  /** Model per record, keyed by its path under the verdicts directory: the bound list entry's `agent_input.model`. */
  modelOf: Map<string, string>;
  /**
   * In a hooked run, the seat and the launch-list entry each record was taken from, keyed as `modelOf` is, with the
   * relaunch rule's words for that entry: a refusal about a record names both.
   */
  seatOf: Map<string, { entry: string; seat: string; advice: string; relaunch: Relaunch }>;
  agentModel?: string;
  agentEffort?: string;
}

/**
 * THE `.legal` LAYOUT. The capture ledger names records relative to the `.legal` directory, so where it exists the
 * answers the assembly reads must be the ones it names: `--raw-verdicts` is `<legal>/verdicts`, and the readers'
 * replies are `<legal>/readers`.
 */
export function legalLayoutRefusals(legalDir: string, rawDir: string, readersDir: string | null, typed: { raw: string; readers?: string }): Refusal[] {
  const ledger = join(legalDir, LEDGER_FILE);
  if (!existsSync(ledger)) return [];
  const out: Refusal[] = [];
  const verdicts = join(legalDir, "verdicts");
  const readers = join(legalDir, "readers");
  if (realOf(rawDir) !== realOf(verdicts)) {
    out.push({ kind: "legal-layout", id: typed.raw, problem: `the capture ledger ${ledger} names the seats' answers under ${verdicts}, and --raw-verdicts names another directory: pass ${toldArgs(["--raw-verdicts", verdicts])}, or --legal for the directory this run's answers are in` });
  }
  if (readersDir !== null && realOf(readersDir) !== realOf(readers)) {
    out.push({ kind: "legal-layout", id: typed.readers ?? "-", problem: `the capture ledger ${ledger} names the readers' replies under ${readers}, and --readers names another directory: pass ${toldArgs(["--readers", readers])}` });
  } else if (readersDir === null && existsSync(readers) && jsonFilesUnder(readers).length > 0) {
    out.push({ kind: "legal-layout", id: "--readers", problem: `readers' replies are under ${readers} and --readers is not given, so they would not be read: pass ${toldArgs(["--readers", readers])}` });
  }
  return out;
}

/** Whether the launch directory holds a marker of this run that names a Claude Code session, standing or ended. */
function sessionMarkerFor(launchDir: string, runId: string): string | null {
  const standing = readActiveRun(launchDir);
  if (standing.state === "active" && standing.marker.run_id === runId && standing.marker.session_id !== null) return standing.marker.session_id;
  // The history through the one reader (hook-launch.ts readJsonLines, program-file.ts):
  // missing is no line; a history that is not a regular file with one name throws, naming it.
  for (const d of readJsonLines<unknown>(launchRecordPath(launchDir, ACTIVE_RUN_HISTORY_FILE))) {
    if (isRecord(d) && d.run_id === runId && typeof d.session_id === "string" && d.session_id !== "") return d.session_id;
  }
  return null;
}

/**
 * The lines of a JSON-lines transcript that mention `needle`, parsed; or why the file cannot be read. Every transcript the
 * assembly reads comes through here, so every one first meets the place rule (`transcriptPlaceRefusal`): never inside the scanned folder (`legalDir`'s project). Each path is one Claude Code handed the hook.
 */
function transcriptLines(path: string, needle: string, legalDir: string): { lines: Obj[] } | { problem: string } {
  const placed = transcriptPlaceRefusal(path, launchRecordOwner(join(legalDir, "launch")));
  if (placed !== null) return { problem: placed };
  let text: string;
  try {
    text = readRegularFile(path, "utf8");
  } catch (e) {
    return { problem: `it cannot be read (${(e as Error).message})` };
  }
  const lines: Obj[] = [];
  for (const line of text.split("\n")) {
    if (!line.includes(needle)) continue;
    try {
      const d: unknown = JSON.parse(line);
      if (isRecord(d)) lines.push(d);
    } catch {
      // Not a line of the transcript's format.
    }
  }
  return { lines };
}

const contentOf = (d: Obj): Obj[] => (isRecord(d.message) && Array.isArray(d.message.content) ? d.message.content.filter(isRecord) : []);

/**
 * Whether transcript lines hold the result of the Agent call `call` naming the launched agent `agent`. `stamp`, where
 * given, is what each such line must also carry: the agent whose transcript it is (`agentId`) and the session
 * (`sessionId`), as Claude Code stamps every line of an agent's own transcript.
 */
function namesLaunch(lines: Obj[], call: string, agent: string, stamp?: { agentId?: string; sessionId: string }): boolean {
  return lines.some(
    (d) =>
      d.type === "user" &&
      (stamp === undefined || ((stamp.agentId === undefined || d.agentId === stamp.agentId) && d.sessionId === stamp.sessionId)) &&
      contentOf(d).some((b) => b.type === "tool_result" && b.tool_use_id === call) &&
      isRecord(d.toolUseResult) &&
      d.toolUseResult.agentId === agent,
  );
}

/**
 * A relay the launch gate let through in this run, as its record says (hook-launch.ts `RelayRecord`, read by
 * `relayRecordsOfRun`): bound to its agent id by its launch result, with its relay entry, the main session's launch call
 * and the session that made it. Only a bound record is one: a relay whose launch never came back launched nothing.
 */
interface RunRelay {
  agent: string;
  entry: string;
  call: string;
  session: string | null;
  /** The record's file, named in a refusal. */
  file: string;
}

/**
 * The relay's own transcript: where Claude Code keeps an agent's transcript, beside the session's
 * (`<session transcript without .jsonl>/subagents/agent-<agent id>.jsonl`, the path its SubagentStop event gives a seat).
 * Where the file is is only where to look: what proves the launch is a line in it stamped with the relay's agent id.
 */
export const relayTranscriptOf = agentTranscriptOf;

type LaunchProblem = { kind: "transcript-mismatch" | "transcript-unreadable"; path: string; why: string };

/**
 * A SEAT THE RUN'S RELAY LAUNCHED. The launch call was the
 * relay's, so the result naming the seat is in the relay's own transcript, not the session's. It proves the launch only
 * where the relay is itself proven launched as a seat is, so that no record is accepted with less proof than a
 * main-launched seat's: the result is on a line of the relay's transcript stamped with the relay's agent id and the
 * run's session; the launch gate's record binds that agent id to a relay entry the launch list holds (the gate lets a
 * relay through from the main session only: hook-launch.ts decideRelayLaunch, bindLaunch); the record names the run's
 * session; and the session's transcript holds the result of the record's launch call naming that agent id, stamped
 * with the run's session. Null where a relay of the run proves the launch; otherwise what refuses the record.
 */
function relayLaunchProblem(session: string, launchId: string, seat: string, relays: RunRelay[], runSession: string | null, listed: Set<string>, legalDir: string): LaunchProblem | null {
  const notInSession = `no result of the launch call ${launchId} in it names agent ${seat}`;
  if (relays.length === 0) {
    return { kind: "transcript-mismatch", path: session, why: `${notInSession}, and the launch gate recorded no relay of this run whose own transcript could hold it: nothing shows this seat launched by that call` };
  }
  let first: LaunchProblem | null = null;
  const looked: string[] = [];
  for (const r of relays) {
    const own = relayTranscriptOf(session, r.agent);
    looked.push(own);
    const read = transcriptLines(own, launchId, legalDir);
    if ("problem" in read) {
      first ??= { kind: "transcript-unreadable", path: own, why: `the transcript of the run's relay ${r.agent} (entry ${r.entry}), where a seat it launched has its launch result: ${read.problem}` };
      continue;
    }
    if (!namesLaunch(read.lines, launchId, seat, { agentId: r.agent, sessionId: runSession ?? "" })) continue;
    const found = `${notInSession}; the result is in the transcript of the relay ${r.agent} (${own})`;
    let problem: LaunchProblem | null = null;
    if (!listed.has(r.entry)) {
      problem = { kind: "transcript-mismatch", path: session, why: `${found}, whose launch gate record ${r.file} names the relay entry ${r.entry}, which the launch list does not hold: nothing shows that relay launched by a listed entry of this run` };
    } else if (runSession === null || r.session !== runSession) {
      problem = { kind: "transcript-mismatch", path: session, why: `${found}, whose launch gate record ${r.file} names the session ${r.session ?? "none"}, not the run's session ${runSession ?? "none"}: nothing shows that relay launched in this run's session` };
    } else {
      const main = transcriptLines(session, r.call, legalDir);
      if ("problem" in main) problem = { kind: "transcript-unreadable", path: session, why: main.problem };
      else if (!namesLaunch(main.lines, r.call, r.agent, { sessionId: runSession })) {
        problem = { kind: "transcript-mismatch", path: session, why: `${found}, and no result of that relay's launch call ${r.call} (its entry ${r.entry}) in the session's transcript names agent ${r.agent}: nothing shows that relay launched from this session` };
      }
    }
    if (problem === null) return null;
    first ??= problem;
  }
  return first ?? { kind: "transcript-mismatch", path: session, why: `${notInSession}, nor does a line of the run's relay in its own transcript (${looked.join(", ")}): nothing shows this seat launched by that call` };
}

/**
 * THE TRANSCRIPT CHECK (proposal P:277). Every path and call id in `via` here is the hook's own, from its line in the
 * state folder (`seat-captures.jsonl`), never the capture ledger's. The session's transcript must hold the result of the Agent call that launched
 * the seat (`via.launch_tool_use_id`) naming the seat's agent id - or, where the run's relay made that call, the relay's
 * own transcript must, with the relay itself proven launched from the session's (`relayLaunchProblem`); in
 * auto mode the seat's own transcript (`via.agent_transcript_path`, or the hook ledger's `stopped` line for the seat, or
 * else where Claude Code keeps it beside the session's, `seatTranscriptOf`) must hold the SubagentHandback call
 * `via.tool_use_id` whose message, hashed as UTF-8, is the reply the capture ledger
 * recorded - or, for an amended record, the amendment it recorded (`amends.answer_sha256`), with the chain from it to
 * the reply proven by `amendmentProblem`. A record taken at SubagentStop is checked for its launch only (the session's transcript, and the relay's
 * where the relay launched the seat): how that event's `last_assistant_message` appears in the seat's own transcript is
 * not established by any committed event (a stated limit).
 */
function transcriptCheck(file: string, e: LedgerEntry, via: CaptureVia, stopped: string | null, relays: RunRelay[], runSession: string | null, listed: Set<string>, legalDir: string, seatLines: HookLedgerLine[], hookedAnswer?: string): { refusal?: Refusal; sessionOnly?: boolean } {
  const seat = e.seat;
  const unreadable = (path: string | null, why: string): { refusal: Refusal } => ({ refusal: { kind: "transcript-unreadable", id: file, problem: `agent ${seat}, ${path ?? "no path"}: ${why}` } });
  const mismatch = (path: string, why: string): { refusal: Refusal } => ({ refusal: { kind: "transcript-mismatch", id: file, problem: `agent ${seat}, ${path}: ${why}` } });
  const session = via.transcript_path;
  if (!session) return unreadable(null, "the record names no session transcript (via.transcript_path), so the launch that made this seat cannot be found");
  if (!via.launch_tool_use_id) return mismatch(session, "the record names no launch call (via.launch_tool_use_id), so nothing in the session's transcript can show this seat was launched");
  const launchId = via.launch_tool_use_id;
  const sessionRead = transcriptLines(session, launchId, legalDir);
  if ("problem" in sessionRead) return unreadable(session, sessionRead.problem);
  // Launched by the main session: the session's transcript holds the result. Otherwise only a
  // relay of this run proven launched from the session can have launched it.
  if (!namesLaunch(sessionRead.lines, launchId, seat)) {
    const p = relayLaunchProblem(session, launchId, seat, relays, runSession, listed, legalDir);
    if (p) return p.kind === "transcript-unreadable" ? unreadable(p.path, p.why) : mismatch(p.path, p.why);
  }
  if (via.event !== "PreToolUse:SubagentHandback") return { sessionOnly: true };
  /* THE SEAT'S OWN TRANSCRIPT (one lookup, seat-opened.ts `seatTranscriptOf`, which the
   * capture's premises use too). Named by an event - the record's `via.agent_transcript_path`, or the hook ledger's
   * `stopped` line - or else where Claude Code keeps it beside the session's, where only a hand-back stamped with the
   * seat's agent id and the record's session counts. */
  const { own, stamp } = seatTranscriptOf({ named: via.agent_transcript_path ?? stopped, session, agentId: seat, sessionId: via.session_id ?? runSession });
  if (own === null) return unreadable(session, "no event named the seat's own transcript and the record names no session transcript to find it beside");
  if (!via.tool_use_id) return mismatch(own, "the record names no hand-back call (via.tool_use_id)");
  const handBackId = via.tool_use_id;
  const seatRead = transcriptLines(own, handBackId, legalDir);
  if ("problem" in seatRead) return unreadable(own, seatRead.problem);
  // An amended record's seat handed back the amendment only (amend.ts): its hash is `amends.answer_sha256`, and `reply` is
  // the merged whole, which the chain below must make again. A record that was not amended: as before.
  const recorded = e.amends ? e.amends.answer_sha256 : e.reply?.sha256;
  // The answer the hook itself hashed for this record (its state line) must be the one the capture ledger names.
  if (hookedAnswer !== undefined && hookedAnswer !== recorded) return mismatch(own, `the capture ledger names the answer ${recorded ?? "none"}, and the hook's own line in the state folder records ${hookedAnswer}: the record is not what this seat handed back`);
  const handedBack = handBacks(seatRead.lines, handBackId, seat, stamp).find((m) => sha256(Buffer.from(m, "utf8")) === recorded);
  if (handedBack === undefined) {
    return mismatch(
      own,
      e.amends
        ? `no SubagentHandback call ${handBackId} in it carries a message whose sha256 is the amendment the capture ledger recorded (amends.answer_sha256 ${recorded}): the record is not what this seat handed back`
        : `no SubagentHandback call ${handBackId} in it carries a message whose sha256 is the reply the capture ledger recorded (${recorded ?? "none"}): the record is not what this seat handed back`,
    );
  }
  if (!e.amends) return {};
  const p = amendmentProblem(legalDir, e, own, handedBack, seatLines.filter((l) => outcomeOf(l) === "refused"), stamp);
  return p === null ? {} : p.kind === "transcript-unreadable" ? unreadable(p.path, p.why) : mismatch(p.path, p.why);
}

/**
 * The messages of the SubagentHandback call `id` on the seat's own assistant lines (a line stamped with another agent is
 * not the seat's). With `stamp` (a transcript found by its place, not named by an event: `seatTranscriptOf`), only a
 * line stamped with the seat's agent id and the record's session counts.
 */
function handBacks(lines: Obj[], id: string, seat: string, stamp?: { agentId: string; sessionId: string }): string[] {
  return lines.flatMap((d) =>
    d.type === "assistant" && (stamp ? d.agentId === stamp.agentId && d.sessionId === stamp.sessionId : d.agentId === undefined || d.agentId === seat)
      ? contentOf(d).flatMap((b) => (b.type === "tool_use" && b.id === id && b.name === "SubagentHandback" && isRecord(b.input) && typeof b.input.message === "string" ? [b.input.message] : []))
      : [],
  );
}

/**
 * AN AMENDED RECORD'S CHAIN. The seat handed back an amendment of its last refused answer, and the capture
 * kept, as the record's reply, that answer with the amendment laid over it (amend.ts `amendedReply`). The record is
 * accepted only where every link is proven, from the reply back to a whole answer the seat handed back:
 * - the hook ledger's LAST refused line of the seat before the link (the one the hook amends, hook-capture.ts
 *   `takeAnswer`) keeps its answer at the file the link names as its base, under `capture/refused/`;
 * - that file hashes to what the line kept (`merged.sha256` for a refused amendment, else `answer.sha256`), and at the
 *   first link also to the record's `amends.base_sha256`;
 * - the seat's own transcript holds that line's SubagentHandback call carrying a message whose sha256 is the line's
 *   `answer.sha256`: the refused answer is this seat's own hand-back;
 * - the product's own merge of the link's hand-back over that file, with what the line's refusal named and told the seat
 *   to take out, makes exactly
 *   the reply the link carries (`reply.sha256` for the record, `merged.sha256` for a refused amendment).
 * Where the refused line was itself an amendment, its hand-back and its base are the next link, one refused line
 * earlier; where it was a whole answer, the file is that hand-back and the chain ends. Anything else is a problem.
 */
function amendmentProblem(legalDir: string, e: LedgerEntry, own: string, amendment: string, refused: HookLedgerLine[], stamp?: { agentId: string; sessionId: string }): LaunchProblem | null {
  const amends = e.amends!;
  const read = transcriptLines(own, "SubagentHandback", legalDir);
  if ("problem" in read) return { kind: "transcript-unreadable", path: own, why: read.problem };
  const not = (text: string): LaunchProblem => ({
    kind: "transcript-mismatch",
    path: own,
    why: `the record is an amendment of ${amends.base_file}, and ${text}: nothing proves its reply is made of what this seat handed back`,
  });
  let link: { what: string; sha: string | undefined; answer: string; base: string; baseSha?: string } = { what: "the record's reply", sha: e.reply?.sha256, answer: amendment, base: amends.base_file, baseSha: amends.base_sha256 };
  for (let i = refused.length - 1; ; i--) {
    const r = refused[i];
    if (!r) return not(`the hook ledger holds no refused answer of this seat for ${link.what} to have amended`);
    if (r.answer?.kept !== link.base) return not(`${link.what} amends ${link.base}, but the seat's last refused answer before it is kept at ${r.answer?.kept ?? "no file"}`);
    if (!link.base.startsWith(`${REFUSED_DIR}/`) || link.base.split("/").includes("..")) return not(`${link.base} is not a file the hook keeps a refused answer in (${REFUSED_DIR}/)`);
    if (r.merged && r.merged.kept !== link.base) return not(`the refused amendment's merged whole is kept at ${r.merged.kept ?? "no file"}, not at ${link.base}`);
    const abs = join(legalDir, link.base);
    let bytes: Buffer;
    try {
      bytes = readRegularFile(abs);
    } catch (err) {
      return not(`${link.base}, the refused answer it amends, cannot be read (${(err as Error).message})`);
    }
    const kept = r.merged ? r.merged.sha256 : r.answer.sha256;
    const now = sha256(bytes);
    if (now !== kept || (link.baseSha !== undefined && now !== link.baseSha)) return not(`${link.base} hashes to ${now}, not to the refused answer the hook kept (${kept})${link.baseSha !== undefined ? ` and the record's amends.base_sha256 (${link.baseSha})` : ""}`);
    if (!r.tool_use_id) return not(`the refused answer kept at ${link.base} names no hand-back call, so the seat's own transcript cannot show it`);
    const handed = handBacks(read.lines, r.tool_use_id, e.seat, stamp).find((m) => sha256(Buffer.from(m, "utf8")) === r.answer!.sha256);
    if (handed === undefined) return not(`no SubagentHandback call ${r.tool_use_id} in the seat's own transcript carries the refused answer kept at ${link.base} (sha256 ${r.answer.sha256}): it is not this seat's hand-back`);
    if (!r.refusal?.named) return not(`the refusal of the answer kept at ${link.base} records nothing it named, so no amendment of it can be merged`);
    const base = firstJsonValue(bytes);
    const next = firstJsonValue(Buffer.from(link.answer, "utf8"));
    let made: string;
    try {
      if (!base.ok || !next.ok) throw new Error(base.ok ? next.ok ? "" : next.problem : base.problem);
      made = sha256(amendedReply(e.role, base.value as unknown[], next.value as unknown[], r.refusal.named, r.refusal.removed).bytes);
    } catch (err) {
      return not(`the amendment cannot be laid over ${link.base} (${(err as Error).message})`);
    }
    if (made !== link.sha) return not(`laying the hand-back over ${link.base} with the product's merge makes a reply whose sha256 is ${made}, not ${link.what}'s ${link.sha ?? "none"}`);
    if (!r.merged) return null;
    link = { what: `the refused amendment kept at ${link.base}`, sha: r.merged.sha256, answer: handed, base: r.merged.base };
  }
}

const outcomeOf = (l: HookLedgerLine): string => String(l.outcome);
/** Outcomes that do not settle a seat: a refusal the seat may answer, and `stopped`. (The hook's `begun` lines are in a file of their own, hook.ts HOOK_BEGUN_LOG, read above.) */
const UNSETTLED = new Set(["refused", "stopped"]);

function reasonOf(l: HookLedgerLine): string {
  if (l.reason) return l.reason;
  if (l.refusal) return `refused ${l.refusal.n} of ${l.refusal.of}: ${l.refusal.problems.join("; ")}`;
  if (l.refusals) return l.refusals.map((r) => `refusal ${r.n}: ${r.problems.join("; ")}`).join(" | ");
  return "no reason recorded";
}

/**
 * THE CANDIDATES `refuter-entries` HELD BACK. Each request it served is on the launch list's `appended[]`, with
 * every violation candidate it made no entry for and why (launch-later.ts `Held`). A candidate that a refuter entry of
 * the list names is not counted as held (the hold "it already has the refuter entry" is one such): its refutation is
 * that entry's, answered or not. Read whether or not the run is hooked: the reason is on disk either way.
 */
export function heldRefutations(list: LaunchList, legalDir: string): Map<string, string> {
  const withEntry = new Set<string>();
  const refuters = standingRefuters(list, legalDir);
  for (const e of list.entries) {
    // A refutation's entry only: a second look stands in for no refuter.
    if ((e as LaterEntry).role === "refuter" && !isChallengeEntry(e) && refuters.stands(e.id)) for (const f of (e as LaterEntry).finding_ids ?? []) withEntry.add(f);
  }
  const reasons = new Map<string, string[]>();
  // Only a line that examined its record as the record's bytes are now (launch-later.ts `examines`): a hold
  // made from a record since replaced at the same path is not that record's, which is due for refuter-entries again.
  for (const a of currentExaminations(list, legalDir)) {
    for (const h of a.held ?? []) {
      if (typeof h?.finding_id !== "string" || withEntry.has(h.finding_id)) continue;
      const why = typeof h.reason === "string" && h.reason !== "" ? h.reason : "no reason was written";
      const seen = reasons.get(h.finding_id) ?? [];
      if (!seen.includes(why)) seen.push(why);
      reasons.set(h.finding_id, seen);
    }
  }
  return new Map([...reasons].map(([id, why]): [string, string] => [id, why.join("; ")]));
}

/**
 * Read what the hooks wrote for this run and check it (milestone 3). Refusals, `noted:` lines and the seats reported as
 * not judged are returned; nothing is written.
 */
/** The words that end a `record-unbound` refusal naming the command that appends its entry again (assemble-report.ts `recoveryOf`). */
/** The words a `record-unbound` line ends with where the run appended its entry (recovery.ts holds them, beside the row that reads them). */
export { APPENDS_IT_AGAIN };

/**
 * THE COMMAND THAT APPENDS A RECORD'S ENTRY AGAIN, for a record bound to an entry the run appended that the launch list
 * does not hold (the recovery `record-unbound` states). A refuter entry's id is
 * made from its candidate and a silence entry's from its rules (launch-later.ts), so the same request makes the same
 * entry: `refuter-entries` over the adjudicator record the capture ledger holds for that candidate, or `silence-entries`
 * over the rules the record answers. Null where the id is not one of those, or the request would not make it.
 */
function appendAgainCommand(legalDir: string, latest: Map<string, LedgerEntry>, record: LedgerEntry, entryId: string): string | null {
  const shown = (p: string): string => relativePath(process.cwd(), p) || ".";
  if (record.role === "refuter" && record.ids.length === 1 && refuterEntryId(record.ids[0]) === entryId) {
    return refuterEntriesCommand(legalDir, latest, record.ids[0]);
  }
  if (record.role === "silence-investigator" && record.ids.length > 0 && silenceEntryId(record.ids) === entryId) {
    return scannerCommand(["silence-entries", "--rules", [...record.ids].sort().join(","), "--legal", shown(legalDir)]);
  }
  return null;
}

/** SKILL.md step 5's command for candidate `fid`: `refuter-entries` over the adjudicator record the capture ledger holds for it. */
function refuterEntriesCommand(legalDir: string, latest: Map<string, LedgerEntry>, fid: string): string | null {
  const shown = (p: string): string => relativePath(process.cwd(), p) || ".";
  const judged = [...latest.values()].filter((l) => l.role === "adjudicator" && l.ids.includes(fid)).at(-1);
  return judged ? scannerCommand(["refuter-entries", "--record", shown(join(legalDir, judged.file)), "--legal", shown(legalDir)]) : null;
}

/**
 * The record files, keyed as `seatOf` is (the path under the verdicts directory), that the capture ledger
 * binds to a refuter entry that does not stand (`run.superseded`, from launch-list-file.ts `standingRefuters`). The
 * quote check is given them (verdict-verify.ts `supersededRefutations`) by the assembly and by step 5a's `verdict-verify
 * --legal`, so both write the same report, and a superseded refutation's failure is said of no other record; the
 * assembly's step 6 skips the same records by the same binding.
 */
export function supersededRefutationFiles(run: Pick<HookedRun, "seatOf" | "superseded">): Set<string> {
  const out = new Set<string>();
  for (const [file, bound] of run.seatOf) if (run.superseded.has(bound.entry)) out.add(file);
  return out;
}

/** `assembledDir`: step 6's `--verdicts`, where step 5a writes each record's assembled copy. */
export function readHookedRun(legalDir: string, launchDir: string, assembledDir?: string): HookedRun {
  const listPath = join(launchDir, "launch-list.json");
  const run: HookedRun = { listPath, list: null, hooked: false, refusals: [], noted: [], notJudged: { findings: new Map(), refutations: new Map(), silences: new Map() }, held: new Map(), superseded: new Map(), challengeEntries: new Map(), lookClaims: new Map(), ledgerChecked: false, unlisted: new Map(), decisions: { verdicts: new Map(), refutations: new Map() }, appendRefuter: new Map(), listUnread: false, modelOf: new Map(), seatOf: new Map() };
  // `relaunch`: the relaunch rule's decision for the entry, which the recovery of `entry-unanswered` and `seat-cut-off` reads
  // (recovery.ts); `unlisted`: the files a line about a file the capture ledger does not list names for removal.
  const refuse = (kind: RefusalKind, id: string, problem: string, relaunch?: Relaunch | null, unlisted?: string[]) =>
    run.refusals.push({ kind, id, problem, ...(relaunch === undefined ? {} : { relaunch }), ...(unlisted === undefined ? {} : { unlisted }) });
  if (existsSync(listPath)) {
    const read = readLaunchList(listPath);
    if (read.ok) run.list = read.value;
    else {
      refuse("launch-list", listPath, read.problem);
      run.listUnread = true;
    }
  }
  const list = run.list;
  if (list) run.held = heldRefutations(list, legalDir);
  if (list) {
    run.superseded = standingRefuters(list, legalDir).superseded;
    for (const [id, why] of run.superseded) {
      const e = list.entries.find((x) => x.id === id);
      run.noted.push(`the refuter entry ${id} (${(e?.finding_ids ?? []).join(", ") || "no ids"}) is not awaited and its answer is no refutation: ${why}`);
    }
    for (const e of list.entries) {
      if (!isChallengeEntry(e) || run.superseded.has(e.id)) continue;
      const claim = (e as { claim?: unknown }).claim;
      for (const fid of e.finding_ids ?? []) {
        run.challengeEntries.set(fid, e.id);
        if (typeof claim === "string") run.lookClaims.set(fid, claim);
      }
    }
  }
  const session = list ? sessionMarkerFor(launchDir, list.run_id) : null;
  run.hooked = session !== null;
  const entryById = new Map<string, LaunchEntry | LaterEntry>((list?.entries ?? []).map((e): [string, LaunchEntry | LaterEntry] => [e.id, e]));
  if (list) {
    if (typeof list.model === "string" && list.model !== "") run.agentModel = list.model;
    if (typeof list.effort === "string" && list.effort !== "") run.agentEffort = list.effort;
    // The level the seats ran at is each seat's own, read from its transcript at SubagentStop onto the hook
    // ledger (seat-effort.ts); the list's `effort` says only that a launch cannot name one. Read whether or not the
    // marker names a session: the hook writes these lines for this list's entries either way (the lab's second session,
    // whose list was written outside Claude Code, kept the list's words while its hook ledger said "high"). A run whose
    // seats recorded none (captured before the field) keeps the list's words, and so does a hook ledger the one reader
    // refuses: that refusal stays where it was (readAnswerLedgers below, in a hooked run), not moved here.
    let hookLines: HookLedgerLine[] = [];
    try {
      hookLines = readHookLedger(legalDir);
    } catch {
      hookLines = [];
    }
    const level = runAgentEffort(seatEfforts(hookLines, new Set(list.entries.map((e) => e.id))));
    if (level !== null) run.agentEffort = level;
  }
  /* Unit U1: every file of kept place rows (`.legal/capture/places-kept/`, verdict-capture.ts
   * `keepReadPlaces`) is read as read places, so each must be the file the hook's line for its seat names, with
   * the sha256 it names; one no line names, one changed and one named and gone are refused as a record would be. The line is the hook's `kept` line in the state folder
   * (state-record.ts `keptPlacesNamed`), never the hook ledger under `.legal/capture`, which a commit, a clone or a
   * file tool could write together with the file it names. */
  {
    const named = keptPlacesNamed(legalDir, launchDir, list?.run_id);
    const dir = join(legalDir, PLACES_KEPT_DIR);
    const onDisk = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json")).sort().map((n) => `${PLACES_KEPT_DIR}/${n}`) : [];
    for (const rel of onDisk) {
      const want = named.get(rel);
      const got = readProgramFile("the kept place rows", join(legalDir, rel));
      if (!got.ok) refuse("ledger-mismatch", rel, `these kept place rows cannot be read as the program wrote them: ${got.problem}`);
      else if (want === undefined) refuse("ledger-mismatch", rel, "no line of the hook's own record in the state folder names this file of kept place rows: it is not a reading the program kept");
      else {
        const now = createHash("sha256").update(got.value).digest("hex");
        if (now !== want) refuse("ledger-mismatch", rel, `sha256 ${now.slice(0, 16)}... on disk, ${want.slice(0, 16)}... in the hook's own record in the state folder: these are not the place rows the program kept`);
      }
    }
    for (const rel of named.keys()) if (!onDisk.includes(rel)) refuse("ledger-missing-file", rel, "the hook's own record in the state folder names this file of kept place rows and it is not on disk");
  }
  const ledgerPath = join(legalDir, LEDGER_FILE);
  if (!existsSync(ledgerPath)) {
    if (run.hooked && list) {
      refuse("capture-ledger-missing", ledgerPath, `run ${list.run_id} was launched in the Claude Code session ${session}, where the plugin's hook writes every answer with a line in this ledger, and it is not there: nothing shows any record is an answer the program received`);
    }
    return run;
  }
  const ledger = readCaptureLedger(legalDir);
  const check = checkLedger(legalDir, ledger);
  run.ledgerChecked = true;
  for (const c of check.changed) refuse("ledger-mismatch", c.file, `sha256 ${c.now.slice(0, 16)}... on disk, ${c.recorded.slice(0, 16)}... in the capture ledger: this file is not the answer the program received`);
  for (const m of check.missing) refuse("ledger-missing-file", m, "the capture ledger records this file and it is not on disk");
  /* A file the capture ledger does not list leaves itself and, where step 5a assembled it, its assembled copy; every
   * line about it names both, so the removal it states ends the situation in one round. */
  for (const u of check.unledgered) {
    const files = [u];
    if (u.startsWith("verdicts/") && assembledDir !== undefined) {
      const copy = join(assembledDir, u.slice("verdicts/".length));
      if (existsSync(copy)) files.push(relativePath(legalDir, copy));
    }
    if (u.startsWith("verdicts/")) run.unlisted.set(u.slice("verdicts/".length), files);
    refuse("ledger-unlisted", u, "this answer file is in the .legal directory and the capture ledger never recorded receiving it", undefined, files);
  }
  for (const n of check.unreadableLines) refuse("ledger-unreadable", `${LEDGER_FILE}:${n}`, "this line of the capture ledger does not read as an entry, so the record it named cannot be tied to an answer the program received");
  for (const [file, e] of ledger.latest) {
    const model = e.via?.entry ? entryById.get(e.via.entry)?.agent_input?.model : undefined;
    if (typeof model === "string" && model !== "") run.modelOf.set(file.startsWith("verdicts/") ? file.slice("verdicts/".length) : file, model);
  }
  if (!run.hooked || !list) return run;

  /* A hooked run. The launch events, the hook ledger and the begun log are read once, as the relaunch rule reads them
   * (entry-answer.ts readAnswerLedgers), so this advice and the launch gate decide on the
   * same lines. */
  const eventsPath = join(launchDir, "launch-events.jsonl");
  const answers = readAnswerLedgers(legalDir, launchDir, list.run_id);
  const events = answers.events;
  // Every seat a `launched` event names per entry: for the unanswered-entry message only (who tried). Whether a record
  // is bound is the one binding rule's (hook-launch.ts seatBinding), below.
  const launchedSeats = new Map<string, Set<string>>();
  for (const ev of events) {
    if (ev.event !== "launched" || !ev.seat) continue;
    const seats = launchedSeats.get(ev.entry) ?? new Set<string>();
    seats.add(ev.seat);
    launchedSeats.set(ev.entry, seats);
  }
  const byAgent = answers.byAgent;
  for (const [file, e] of ledger.latest) {
    const entry = e.via?.how === "hook" ? e.via.entry : undefined;
    if (typeof entry !== "string" || entry === "") continue;
    const decision = relaunchable(answers, entry);
    run.seatOf.set(file.startsWith("verdicts/") ? file.slice("verdicts/".length) : file, { entry, seat: e.seat, advice: relaunchAdvice(decision), relaunch: decision });
  }
  /* A line on a record changed or removed outside the program carries the relaunch rule's decision
   * for the entry the capture ledger binds it to, as a line on an unreadable record does: where the run set that
   * record aside, the entry is launched again; otherwise the decision is `answered`, whose recovery is the same as before. */
  for (const r of run.refusals) {
    if (r.relaunch !== undefined || (r.kind !== "ledger-mismatch" && r.kind !== "ledger-missing-file") || !r.id.startsWith("verdicts/")) continue;
    const bound = run.seatOf.get(r.id.slice("verdicts/".length));
    if (bound) r.relaunch = bound.relaunch;
  }
  /* The entry each candidate's line is about, and the rule's decision for it - the same call its own line makes. */
  for (const entry of list.entries) {
    const role = String(entry.role);
    const into = role === "refuter" ? run.decisions.refutations : role === "adjudicator" || role === "verdict-after-readers" ? run.decisions.verdicts : null;
    // A second look is no refutation of its finding.
    if (into === null || run.superseded.has(entry.id) || isChallengeEntry(entry)) continue;
    const decision = relaunchable(answers, entry.id);
    for (const fid of entry.finding_ids ?? []) if (!into.has(fid)) into.set(fid, decision);
  }
  for (const e of ledger.latest.values()) {
    if (e.role !== "adjudicator") continue;
    for (const fid of e.ids) {
      if (run.decisions.refutations.has(fid) || run.appendRefuter.has(fid)) continue;
      const command = refuterEntriesCommand(legalDir, ledger.latest, fid);
      if (command !== null) run.appendRefuter.set(fid, command);
    }
  }
  /* WHERE A RECORD CAME FROM, AND EVERY TRANSCRIPT PATH, from the hook's own lines
   * in the person's state folder (`seat-captures.jsonl`, hook-capture.ts `noteSeatCapture`), never from `.legal/capture`:
   * a file there is one a commit, a clone or another session's file tool could have written. A record the hook wrote has
   * an `accepted` line with its file and sha256; its `via` (the session, the calls, both transcript paths, the entry) is
   * taken from that line. The `stopped` line of a seat gives its own transcript where the hand-back did not. */
  const captures: SeatCaptureLine[] = [];
  let capturesProblem: string | null = null;
  try {
    for (const l of readJsonLines<SeatCaptureLine>(launchRecordPath(launchDir, SEAT_CAPTURES_FILE))) if (isRecord(l) && typeof l.agent_id === "string") captures.push(l);
  } catch (e) {
    capturesProblem = e instanceof Error ? e.message : String(e);
  }
  const stoppedPath = (agent: string): string | null => captures.find((l) => l.kind === "stopped" && l.agent_id === agent && l.agent_transcript_path)?.agent_transcript_path ?? null;
  /* WHICH OF A SEAT'S ANSWERS COUNTS is the hook's to say, not the
   * ledger's: the hook's LAST `accepted` line for the seat and the record's file, and the ledger's sha256 must be that
   * line's. Before, any accepted line with the ledger's sha256 was taken, so a ledger rolled back to a seat's first
   * version of an amended record brought the superseded answer back. */
  const lastHookLineOf = (e: LedgerEntry): SeatCaptureLine | undefined => captures.filter((l) => l.kind === "accepted" && l.agent_id === e.seat && l.record?.file === e.file).at(-1);
  const hookLineOf = (e: LedgerEntry): SeatCaptureLine | undefined => {
    const last = lastHookLineOf(e);
    return last !== undefined && last.record?.sha256 === e.sha256 ? last : undefined;
  };
  // The run's relays, bound to their agent ids: a seat one of them launched is proven through it.
  const relays: RunRelay[] = relayRecordsOfRun(launchDir, list.run_id).flatMap(({ path, r }) =>
    typeof r.seat === "string" && r.seat !== "" && typeof r.tool_use_id === "string" && typeof r.entry === "string" ? [{ agent: r.seat, entry: r.entry, call: r.tool_use_id, session: r.session_id ?? null, file: path }] : [],
  );
  const listedRelays = new Set((list.relays ?? []).map((x) => x.id));

  /* (b)-(d): every record. An entry a record claims is not also reported as unanswered: its record is refused by name. */
  const claimed = new Set<string>();
  let sessionOnly = 0;
  for (const [file, e] of ledger.latest) {
    const via = e.via;
    if (!via || via.how !== "hook") {
      refuse("record-not-via-hook", file, `run ${list.run_id} is a hooked run, and this record's capture-ledger entry ${via ? `was made by ${JSON.stringify(via.how)}` : "carries no via"}: in a hooked run only the plugin's hook writes records, so this one was written some other way`);
      continue;
    }
    if (typeof via.entry === "string") claimed.add(via.entry);
    if (!entryById.has(via.entry)) {
      const again = appendAgainCommand(legalDir, ledger.latest, e, via.entry);
      refuse(
        "record-unbound",
        file,
        `its via.entry ${JSON.stringify(via.entry)} is not an entry of the launch list ${listPath}` +
          (again !== null ? `: the run appended that entry, and \`${again}\` ${APPENDS_IT_AGAIN}` : ""),
      );
      continue;
    }
    const bound = seatBinding(launchDir, events, e.seat);
    if (bound.launched === null || bound.launched.entry !== via.entry) {
      refuse(
        "record-unbound",
        file,
        bound.launched === null
          ? `no launched event of ${eventsPath} that the launch gate's own reservation or release line confirms names the seat ${e.seat} (the binding rule, hook-launch.ts seatBinding): nothing ties this record to a launch of the entry ${via.entry}`
          : `the seat ${e.seat} is bound to the entry ${bound.launched.entry}, not to ${via.entry} (the binding rule, hook-launch.ts seatBinding): nothing ties this record to a launch of that entry`,
      );
      continue;
    }
    const hooked = hookLineOf(e);
    if (hooked === undefined || hooked.entry !== via.entry) {
      refuse(
        "record-unbound",
        file,
        capturesProblem !== null
          ? `the hook's own record of the seats' answers cannot be read (${capturesProblem}), so nothing shows the plugin's hook wrote this record`
          : hooked === undefined
            ? lastHookLineOf(e) !== undefined
              ? `the hook's own record of the seats' answers (${SEAT_CAPTURES_FILE} in the person's state folder) names another sha256 for the last answer it took from seat ${e.seat} for this record's file: this record is not that answer, so it is not taken`
              : `the hook's own record of the seats' answers (${SEAT_CAPTURES_FILE} in the person's state folder) has no line for this record's file and sha256 from seat ${e.seat}: the plugin's hook did not write it as it stands`
            : `the hook's own record of the seats' answers binds this record to the entry ${String(hooked.entry)}, not to ${via.entry}`,
      );
      continue;
    }
    const sure: CaptureVia = { ...via, event: hooked.event, session_id: hooked.session_id, tool_use_id: hooked.tool_use_id, transcript_path: hooked.transcript_path, agent_transcript_path: hooked.agent_transcript_path, launch_tool_use_id: hooked.launch_tool_use_id ?? null };
    const t = transcriptCheck(file, e, sure, stoppedPath(e.seat), relays, session, listedRelays, legalDir, byAgent.get(e.seat) ?? [], hooked.answer_sha256);
    if (t.refusal) run.refusals.push(t.refusal);
    else if (t.sessionOnly) sessionOnly++;
  }
  if (sessionOnly > 0) {
    run.noted.push(`${sessionOnly} record(s) taken at SubagentStop were checked for their launch only (the session's transcript, and the relay's where the relay launched the seat): how that event's last_assistant_message appears in the seat's own transcript is not established (a stated limit)`);
  }

  /* A CAPTURE THE PLATFORM CUT OFF (area β's rule, wired at the merge step; its one copy is entry-answer.ts
   * cutOffCaptures). Where the seat's entry has a record since - the seat's own answer taken at its other event, or a
   * seat launched again after it - nothing the run needs is missing and the cut-off is a noted line. Otherwise it is
   * refused, and what to do is the relaunch rule's, as for an unanswered entry. */
  const entryOfSeat = (agent: string): string | null => [...events].reverse().find((ev) => ev.event === "launched" && ev.seat === agent)?.entry ?? null;
  for (const [agent, begun] of answers.cutOff) {
    /* Where the hook's own failure log shows that the entry's own
     * deadline ended THIS call (its line, `deadlineOfCall`: the same event and call, never another event's line of the seat),
     * the line says what that deadline did - let a check still running go on, end after the capture had ended, or stop the
     * capture - and where the answer is: no decision on it was recorded, and the seat's own transcript holds it. */
    const killed = deadlineOfCall(answers.deadlines?.get(agent), begun);
    const own = (byAgent.get(agent) ?? []).map((l) => l.agent_transcript_path).find((p): p is string => typeof p === "string" && p !== "");
    const limit = `the hook's time limit of ${HOOK_PROCESS_DEADLINE_MS / 1000} s passed (${killed?.at}, ${HOOK_FAILURE_LOG})`;
    const did = !killed
      ? ""
      : !killed.continued
        ? `${limit} before the capture finished, and the capture was stopped there`
        : killed.capture === "finished"
          ? `${limit} after the capture route had ended without recording a decision`
          : `the plugin's own check of it was still running when ${limit}; it was let go to finish on its own, within its own limit of ${CAPTURE_HANDBACK_LIMIT_MS / 1000} s, and has recorded no decision since`;
    const what = killed
      ? `the hook began to take this seat's answer (${begun.route}, ${begun.event}, ${begun.at}; ${HOOK_BEGUN_LOG}), and ${did}; the platform did not cut it off. No decision on the answer was recorded: ${own ? `the seat's own transcript holds it (${own})` : "only the seat's own transcript, beside the session's, holds it"}`
      : `the hook began to take this seat's answer (${begun.route}, ${begun.event}, ${begun.at}; ${HOOK_BEGUN_LOG}) and the hook ledger has no line of that event for it after that: the platform cut the capture off`;
    const entryId = entryOfSeat(agent);
    const recorded = entryId === null ? undefined : answers.recorded.get(entryId);
    if (entryId !== null && recorded !== undefined) {
      run.noted.push(`seat ${agent} (entry ${entryId}): ${what}; the entry's answer is recorded (${recorded}), so nothing this run needs from it is missing`);
      continue;
    }
    const decision = entryId === null ? null : relaunchable(answers, entryId);
    const advice = decision === null ? "No launched event names this seat, so no entry of the launch list is launched again for it" : relaunchAdvice(decision);
    refuse("seat-cut-off", agent, `${what}, so its answer was neither recorded nor refused. ${advice}`, decision);
  }

  /* The hook ledger, per seat. */
  for (const [agent, lines] of byAgent) {
    const at = lines.findIndex((l) => !UNSETTLED.has(outcomeOf(l)));
    if (at < 0) continue;
    const settling = lines[at];
    if (outcomeOf(settling) === "unbound") {
      run.noted.push(`seat ${agent} (${settling.agent_type || "no agent type"}) was bound to no launch-list entry and its answer was not read: ${reasonOf(settling)}${settling.answer?.kept ? `; kept at .legal/${settling.answer.kept}` : ""}`);
    }
    // A seat whose answer was lost, where its entry was answered since by a seat launched again (the relaunch rule).
    const lostEntry = outcomeOf(settling) === "not-captured" && settling.entry ? settling.entry : null;
    if (lostEntry !== null && answers.recorded.has(lostEntry)) {
      run.noted.push(`seat ${agent} (entry ${lostEntry}): its answer was not captured (${reasonOf(settling)})${settling.answer?.kept ? `, kept at .legal/${settling.answer.kept}` : ""}; the entry's answer is recorded since (${answers.recorded.get(lostEntry)})`);
    }
    for (const l of lines.slice(at + 1)) {
      if (outcomeOf(l) === "not-captured") run.noted.push(`seat ${agent}: an answer at ${l.at}, after its answer was taken (${outcomeOf(settling)}), was kept and not read${l.answer?.kept ? ` (.legal/${l.answer.kept})` : ""}`);
    }
  }

  /* O5: every list entry is answered, or its seat's answer stayed invalid and it is not judged (the not-judged rule,
   * entry-answer.ts `notJudgedOf`). */
  const notJudged = notJudgedOf(list, answers);
  run.notJudged = notJudged.sets;
  for (const entry of list.entries) {
    if (claimed.has(entry.id) || run.superseded.has(entry.id)) continue;
    const role = String(entry.role);
    const ids = (role === "silence-investigator" ? entry.rule_ids : entry.finding_ids) ?? [];
    const nj = notJudged.entries.get(entry.id);
    if (nj) {
      const makeup = list.entries.find((e) => (e as { makeup_of?: unknown }).makeup_of === entry.id);
      run.noted.push(`seat ${nj.seat} (${role}, entry ${entry.id}) was refused ${REFUSALS_MAX} times and its last answer did not hold either; it is kept whole at .legal/${nj.kept}, and nothing it said about ${ids.join(", ")} is used${makeup ? `; its places were given once to a fresh seat, the make-up seat ${makeup.id} (design 1.7), which answers for it` : ""}${role === "reader" && typeof (entry as { makeup_of?: unknown }).makeup_of === "string" ? "; it was itself the make-up seat, so its places are not answered in the candidate's per-place table and the answer seat answered the candidate over them" : ""}`);
      continue;
    }
    /* (design section 2.1, its second-look row) A second look with no answer is not
     * refused: the finding keeps the placement the first review gave it, marked "second look not answered", and the run
     * assembles. */
    if (isChallengeEntry(entry)) {
      run.noted.push(`the second-look entry ${entry.id} (${ids.join(", ") || "no ids"}) has no record: its finding keeps its first placement, marked as not answered`);
      continue;
    }
    const agents = new Set<string>(launchedSeats.get(entry.id) ?? []);
    for (const [agent, lines] of byAgent) if (lines.some((l) => l.entry === entry.id)) agents.add(agent);
    const tried = [...agents].sort().map((agent) => {
      const lines = byAgent.get(agent) ?? [];
      if (lines.length === 0) return `${agent}: launched, and the hook ledger records no answer from it`;
      const l = lines.find((x) => !UNSETTLED.has(outcomeOf(x))) ?? lines[lines.length - 1];
      return `${agent}: ${outcomeOf(l)} — ${reasonOf(l)}${l.answer?.kept ? ` (kept .legal/${l.answer.kept})` : ""}`;
    });
    refuse(
      "entry-unanswered",
      entry.id,
      `the launch list's ${role} entry for the key ${JSON.stringify(captureKeyOf(entry))} (${ids.join(", ") || "no ids"}) has no record and no seat of it answered invalidly: ${tried.length > 0 ? `the seats that tried — ${tried.join("; ")}` : "no seat was launched for it (no launched event names it)"}. ${relaunchAdvice(relaunchable(answers, entry.id))}`,
      relaunchable(answers, entry.id),
    );
  }
  // The seats whose report auto mode blocked on its way to their launcher, or that was never delivered.
  const runSeats = new Set([...byAgent].filter(([, ls]) => ls.some((l) => typeof l.entry === "string" && l.entry !== "")).map(([a]) => a));
  const held = heldReports([...byAgent.values()].flat(), relays.map((r) => r.agent), runSeats);
  if (held.blocked.length + held.undelivered.length > 0) {
    run.heldReports = held;
    if (held.blocked.length > 0) run.noted.push(`${held.blocked.length} seat report(s) were blocked by Claude Code's auto mode on their way to their launcher (${held.blocked.join(", ")}); each answer was taken at its hand-back, and what the blocked receipts named was launched from the launch list`);
    if (held.undelivered.length > 0) run.noted.push(`${held.undelivered.length} seat(s) had their answer taken at their hand-back and no SubagentStop recorded, so their report never reached their launcher (${held.undelivered.join(", ")}); their answers are recorded`);
  }
  return run;
}

/**
 * END THE RUN (A-36; the parent's ruling on M3-2, 2026-09-25): only an assembly that wrote the report and the log
 * (exit 0) ends the run's active-run marker, so the hooks stop acting on it. A refused assembly (exit 5) wrote nothing
 * and leaves the run active: the entries its refusals say to launch again (the relaunch rule, entry-answer.ts, which
 * the launch gate applies too) are launched again inside the same run and the assembly run again, and a person who
 * stops instead ends the run with `run-abort`, as
 * the line printed here says. A marker of another run than the launch list's is left standing, and said so.
 */
export function endRunLines(launchDir: string, now: Date, wrote: boolean): string[] {
  const listPath = join(launchDir, "launch-list.json");
  const list = existsSync(listPath) ? readLaunchList(listPath) : null;
  const runId = list?.ok ? list.value.run_id : undefined;
  const standing = readActiveRun(launchDir);
  if (standing.state === "none") return [];
  if (standing.state === "active" && runId !== undefined && standing.marker.run_id !== runId) {
    return [`  the active run ${standing.marker.run_id} in ${launchDir} is not the launch list's run ${runId}; it was left active`];
  }
  if (!wrote) {
    const id = standing.state === "active" ? standing.marker.run_id : (runId ?? "of this launch list");
    return [
      `  the run ${id} stays active, because nothing was written: follow the recovery each refusal above ends with - launch again, inside this run, each entry a refusal says to launch again (the launch gate lets exactly those through), wait for any seat a refusal says is still running, and once their answers are captured, ${THEN_ASSEMBLE}. To stop instead, end the run with ${abortCommand(launchDir)}`,
    ];
  }
  return [`  ${endActiveRun(launchDir, "assembled", now).note}`];
}
