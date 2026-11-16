/**
 * WHETHER A LISTED ENTRY MAY BE LAUNCHED AGAIN: the one relaunch rule.
 * A refused assembly (exit 5) tells the orchestrator to launch again the entries it
 * names; the launch gate refused every second launch, so that promise could never be kept. This module decides it once,
 * from the ledgers the program keeps, and the launch gate (hook-launch.ts decideLaunch), the assembly's advice
 * (assemble-hooked.ts) and the status line (`run-status`) all ask it, so the three can never disagree.
 *
 * An entry may be launched again when the seat its reservation binds has RETURNED and its answer was LOST: no record
 * claims the entry, no seat of it was kept invalid, and every seat bound to it has returned. A seat has returned when
 * the program holds a sign that it ended: its settling line in the hook ledger (not captured, unbound), a `returned`
 * launch event naming it, a `stopped` line, the stop the launch gate recorded, or a capture at its SubagentStop that
 * began and wrote nothing (cut off; area beta's rule, `cutOffCaptures` below). A seat with none of these is RUNNING as far
 * as any ledger shows - one whose stop no hook ever reached cannot be told from one still at work - and is not launched
 * again until it is PRESUMED LOST (hook-launch.ts): past the longer of an hour and twice this run's longest
 * seat since its launch, it is taken to have ended with its answer lost, and its entry is launched again within the run
 * (before this, the only way on was to end the run and start a new attempt). LOST AT THE RESUME (
 * hook-launch.ts RESUMES_FILE): where the run's own conversation was resumed after its Claude Code process ended, a seat
 * launched before that resume with no sign of its end ended with the earlier process, and is lost at the resume itself,
 * not an hour later. An entry kept invalid after the refusal cap stays not judged: the cap bounds it. The gate records a relaunch in
 * the run folder's relaunches.jsonl and replaces the reservation, so the old seat binds nothing (seatBinding).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { HOOK_BEGUN_LOG, HOOK_FAILURE_LOG, HOOK_PROCESS_DEADLINE_MS } from "./hook.js";
import { readHandbackChecks, readHookLedger, type HandbackCheckLine, type HookLedgerLine } from "./hook-capture.js";
import { PRESUMED_LOST_FLOOR_S, presumedLost, readActiveRun, readJsonLines, recordSetAside, runGateRecords, seatBinding, seatClock, type PresumedLost, type Reservation, type SeatClock, type SetAsideLine } from "./hook-launch.js";
import { readLaunchList, standingRefuters, type StandingRefuters } from "./launch-list-file.js";
import { isChallengeEntry } from "./second-look.js";
import { readLaunchEvents, type LaunchEvent } from "./launch-plan.js";
import { checkLedger, readCaptureLedger } from "./verdict-capture.js";

/** A capture route that began and wrote nothing: the last such `begun` line of an agent. */
export interface CutOff {
  at: string;
  route: string;
  event: string;
  /** The call the begun line is about (null at SubagentStop, which carries none). */
  tool_use_id?: string | null;
}

/** What the rule reads, read once: the launch events, the gate's records of the run, both capture ledgers and the begun log. */
export interface AnswerLedgers {
  launchDir: string;
  events: LaunchEvent[];
  /** The run folder's reservations, by entry. */
  reservations: Map<string, Reservation>;
  /** Agents whose stop the launch gate recorded, in any attempt of the run. */
  stopped: Set<string>;
  /** The hook ledger's lines, per agent id, in file order. */
  byAgent: Map<string, HookLedgerLine[]>;
  cutOff: Map<string, CutOff>;
  /** Entries a capture-ledger record names (`via.entry`), with the record's file. */
  recorded: Map<string, string>;
  /** The moment the rule answers for, and the seats' clock (hook-launch.ts PRESUMED LOST): a bound seat with no sign of its end past the bound is presumed lost. */
  now: Date;
  clock: SeatClock;
  /**
   * Which refuter entries stand (launch-list-file.ts `standingRefuters`, the one accessor): the
   * superseded ones, made from bytes their record no longer holds, with why. Required: no reader of these ledgers can skip it.
   */
  refuters: StandingRefuters;
  /** How many times the launch gate launched each entry again in this run (its relaunch lines). */
  relaunches?: Map<string, number>;
  /** The run's set-aside ledger (hook-launch.ts A RECORD SET ASIDE): captures that are no answer. */
  setAside?: SetAsideLine[];
  /**
   * Per seat, every time the entry's own process deadline ended a call at a
   * capture event (hook.ts HOOK_PROCESS_DEADLINE_MS, a `deadline` line of HOOK_FAILURE_LOG at SubagentHandback or
   * SubagentStop), in order: for the words of a cut-off capture, which take the line of the same call (`deadlineOfCall`).
   * No relaunch is decided from them: none says that a new seat would meet the same failure.
   */
  deadlines?: Map<string, CaptureDeadline[]>;
}

/** One `deadline` line of the hook failure log, at a capture event (AnswerLedgers.deadlines). */
export interface CaptureDeadline {
  at: string;
  event: string;
  tool_use_id: string | null;
  /** The capture route had begun and its process was let go to finish (hook.ts `deadline()`); false where it was stopped. */
  continued: boolean;
  /** Where the capture route was (hook.ts FailureNote.capture); absent on a line an earlier build wrote. */
  capture?: "not-begun" | "running" | "finished";
}

/**
 * The deadline line of the very call a cut-off capture's begun line is
 * about, or undefined: the same event, the same tool_use_id where the call has one, and written by that call's entry - at
 * or after the begun line and within the entry's deadline of it (a SubagentStop carries no tool_use_id, so its time places
 * it). A line of another event or another call of the seat never words this one.
 */
export function deadlineOfCall(lines: readonly CaptureDeadline[] | undefined, cut: CutOff): CaptureDeadline | undefined {
  const since = Date.parse(cut.at);
  const call = cut.tool_use_id ?? null;
  return (lines ?? []).find((d) => {
    const t = Date.parse(d.at);
    return d.event === cut.event && (call === null || d.tool_use_id === call) && t >= since - 1000 && t <= since + HOOK_PROCESS_DEADLINE_MS + 5000;
  });
}

/** The set-aside line naming this capture (file, seat, sha256), or undefined: a capture it names is no answer. */
function setAsideOf(l: Pick<AnswerLedgers, "setAside">, file: string | undefined, seat: string | undefined, sha256: string | undefined): SetAsideLine | undefined {
  return (l.setAside ?? []).find((a) => a.file === file && a.seat === seat && a.sha256 === sha256);
}

/**
 * A CAPTURE THE PLATFORM CUT OFF (area beta's rule, hook.ts recordBegun; wired at the integration's merge step, and moved
 * here unchanged so that the assembly and the relaunch rule read one copy): the dispatcher appends a `begun` line just
 * before a capture route runs, and a capture was cut off when no hook-ledger line of the same agent and event
 * (`PreToolUse:SubagentHandback` or `SubagentStop`) is at or after it.
 */
export function cutOffCaptures(
  begun: { at?: unknown; route?: unknown; event?: unknown; tool?: unknown; agent_id?: unknown; tool_use_id?: unknown }[],
  byAgent: Map<string, HookLedgerLine[]>,
  /**
   * The hand-back check store (hook-capture.ts HANDBACK_CHECKS): a hand-back given a
   * stored decision, or told the check still runs, writes no ledger line of its own, and its line there answers its begun line.
   */
  checks: readonly HandbackCheckLine[] = [],
): Map<string, CutOff> {
  const cutOff = new Map<string, CutOff>();
  for (const b of begun) {
    if (typeof b.agent_id !== "string" || b.agent_id === "" || typeof b.at !== "string" || typeof b.event !== "string") continue;
    const event = b.event === "PreToolUse" && typeof b.tool === "string" ? `PreToolUse:${b.tool}` : b.event;
    const since = Date.parse(b.at);
    const answered =
      (byAgent.get(b.agent_id) ?? []).some((l) => l.event === event && Date.parse(String(l.at)) >= since) ||
      (event === "PreToolUse:SubagentHandback" && checks.some((c) => c.agent_id === b.agent_id && c.step !== "begun" && Date.parse(c.at) >= since));
    if (!answered) cutOff.set(b.agent_id, { at: b.at, route: String(b.route ?? ""), event, tool_use_id: typeof b.tool_use_id === "string" && b.tool_use_id !== "" ? b.tool_use_id : null });
  }
  return cutOff;
}

/** Read what the rule needs for run `runId`, each file through its writer's one reader; the rule answers for `now` (default: the clock). */
export function readAnswerLedgers(legalDir: string, launchDir: string, runId: string, now: Date = new Date()): AnswerLedgers {
  const events = readLaunchEvents(join(launchDir, "launch-events.jsonl")).events;
  const gate = runGateRecords(launchDir, runId);
  const byAgent = new Map<string, HookLedgerLine[]>();
  for (const l of readHookLedger(legalDir)) {
    if (typeof l.agent_id !== "string" || l.agent_id === "") continue;
    const lines = byAgent.get(l.agent_id) ?? [];
    lines.push(l);
    byAgent.set(l.agent_id, lines);
  }
  const cutOff = cutOffCaptures(readJsonLines(join(legalDir, HOOK_BEGUN_LOG)), byAgent, readHandbackChecks(legalDir));
  // The hook's own failure log: every call the entry's deadline ended at a capture event.
  const deadlines = new Map<string, CaptureDeadline[]>();
  for (const f of readJsonLines(join(legalDir, HOOK_FAILURE_LOG)) as { stage?: unknown; at?: unknown; event?: unknown; tool?: unknown; agent_id?: unknown; tool_use_id?: unknown; continued?: unknown; capture?: unknown }[]) {
    if (f.stage !== "deadline" || typeof f.agent_id !== "string" || f.agent_id === "" || typeof f.at !== "string") continue;
    const event = f.event === "PreToolUse" && f.tool === "SubagentHandback" ? "PreToolUse:SubagentHandback" : f.event === "SubagentStop" ? "SubagentStop" : null;
    if (event === null) continue;
    const capture = f.capture === "not-begun" || f.capture === "running" || f.capture === "finished" ? f.capture : undefined;
    const lines = deadlines.get(f.agent_id) ?? [];
    lines.push({ at: f.at, event, tool_use_id: typeof f.tool_use_id === "string" && f.tool_use_id !== "" ? f.tool_use_id : null, continued: f.continued === true, ...(capture ? { capture } : {}) });
    deadlines.set(f.agent_id, lines);
  }
  const recorded = new Map<string, string>();
  // A capture the set-aside ledger names is no answer: its entry is not answered by it.
  for (const [file, e] of readCaptureLedger(legalDir).latest) {
    if (typeof e.via?.entry === "string" && !recorded.has(e.via.entry) && !setAsideOf(gate, file, e.seat, e.sha256)) recorded.set(e.via.entry, file);
  }
  // The refuter entries that stand, from the one accessor; a list that does not read supersedes none.
  let refuters = standingRefuters(null, legalDir);
  try {
    const read = readLaunchList(join(launchDir, "launch-list.json"));
    if (read.ok) refuters = standingRefuters(read.value, legalDir);
  } catch {
    refuters = standingRefuters(null, legalDir);
  }
  return { refuters, launchDir, events, reservations: gate.reservations, stopped: gate.stopped, byAgent, cutOff, recorded, now, clock: seatClock(events, gate.seats, gate.resumes), relaunches: gate.relaunches, setAside: gate.setAside, deadlines };
}

export type RelaunchState = "not-launched" | "awaiting-result" | "running" | "answered" | "invalid" | "capped";

/**
 * THE RELAUNCH CAP. An entry is launched again at most this many times in one run. Without it an
 * entry whose new seat's answer can never be recorded - a record the capture ledger does not list already sits at the
 * record's path, so the capture writes nothing (verdict-capture.ts, a record is never overwritten) and the hook keeps the
 * answer `not-captured` - was launched again after every such answer, each launch a paid seat. Past the cap the entry
 * is not launched again, and step 6 lists its candidates as not checked, with why.
 */
export const RELAUNCHES_MAX = 2;

/**
 * The rule's answer for one entry: launch it again (the seat that returned, or is presumed lost, and how its answer was
 * lost), or why not. For a `running` seat, `lost_at`: when it is presumed lost if no sign of its end comes first.
 */
export type Relaunch =
  | { ok: true; entry: string; seat: string; how: string; presumed_lost?: true; resumed?: true }
  | { ok: false; entry: string; state: RelaunchState; seat: string | null; why: string; lost_at?: string; superseded?: true };

const UNSETTLED = new Set(["refused", "stopped"]);

/** The sign that seat `agent` has returned, in words, or null where no ledger shows one. */
function returnOf(l: AnswerLedgers, agent: string): string | null {
  const lines = l.byAgent.get(agent) ?? [];
  const settling = lines.find((x) => !UNSETTLED.has(String(x.outcome)));
  if (settling) return `the hook ledger records its answer as ${settling.outcome} at ${settling.event} (${settling.at})${settling.reason ? `: ${settling.reason}` : ""}`;
  const stoppedLine = lines.find((x) => x.outcome === "stopped");
  if (stoppedLine) return `the hook ledger records its stop (${stoppedLine.at}) and no answer taken`;
  const ret = l.events.find((e) => e.event === "returned" && e.seat === agent);
  if (ret) return `a returned event names it (${ret.at})`;
  if (l.stopped.has(agent)) return "the launch gate recorded its stop, and no hook took an answer from it";
  const cut = l.cutOff.get(agent);
  if (cut && cut.event === "SubagentStop") return `the capture at its SubagentStop began at ${cut.at} (${cut.route}) and wrote nothing: the platform cut it off`;
  return null;
}

/**
 * THE RELAUNCH RULE. `ok` only where the entry's bound seat has returned with its answer lost; otherwise the state and
 * why, in words the gate and the assembly print as they are.
 */
export function relaunchable(l: AnswerLedgers, entryId: string): Relaunch {
  const no = (state: RelaunchState, seat: string | null, why: string): Relaunch => ({ ok: false, entry: entryId, state, seat, why });
  // A superseded refuter entry is never launched (again): the verdict it was to refute no longer exists.
  const superseded = l.refuters.superseded.get(entryId);
  // Marked, so launch-next asks it of an entry never launched too (hook-launch.ts `nextLaunches`).
  if (superseded !== undefined) return { ok: false, entry: entryId, state: "answered", seat: null, why: superseded, superseded: true };
  const lines = [...l.byAgent.values()].flat().filter((x) => x.entry === entryId);
  const record = l.recorded.get(entryId);
  // An accepted line whose record was set aside is no answer; its seat still counts as returned.
  const accepted = lines.find((x) => x.outcome === "accepted" && !setAsideOf(l, x.record?.file, x.agent_id, x.record?.sha256));
  if (record !== undefined || accepted) return no("answered", accepted?.agent_id ?? null, `its answer is recorded (${record ?? accepted?.record?.file ?? "the hook ledger's accepted line"})`);
  const invalid = keptInvalidOf(l, entryId);
  if (invalid) return no("invalid", invalid.agent_id, `seat ${invalid.agent_id}'s answer stayed invalid after its refusals; the entry is reported as not judged, and the refusal cap bounds it`);
  const r = l.reservations.get(entryId);
  if (!r) return no("not-launched", null, "no launch of it is reserved in this run");
  if (typeof r.seat !== "string") return no("awaiting-result", null, `its launch by call ${r.tool_use_id} is awaiting its launch result`);
  // Every seat bound to the entry: the reservation's, and any other a `launched` line names that the binding rule confirms.
  const seats = new Set<string>([r.seat]);
  for (const e of l.events) {
    if (e.event === "launched" && e.entry === entryId && typeof e.seat === "string" && !seats.has(e.seat) && seatBinding(l.launchDir, l.events, e.seat).launched?.entry === entryId) seats.add(e.seat);
  }
  // PRESUMED LOST (hook-launch.ts): a seat with no sign of its end past the bound is taken to have ended with
  // its answer lost, so its entry is launched again within the run, and the gate's relaunch leaves the old seat unbound.
  const lostOf = (seat: string) => presumedLost(l.clock, seat, l.now, seat === r.seat && typeof r.bound_at === "string" ? { entry: entryId, at: r.bound_at } : undefined);
  const presumedHow = (seat: string, lost: PresumedLost) =>
    lost.by === "resume"
      ? `no ledger shows that seat ${seat} has returned, its launch was at ${lost.launched_at}, and the run's conversation was resumed at ${lost.lost_at} after its Claude Code process ended, so it is lost with that process (lost at the resume); an answer it still sends after its entry is launched again is kept unbound and recorded for no entry`
      : `no ledger shows that seat ${seat} has returned and its launch was at ${lost.launched_at}, so it is presumed lost since ${lost.lost_at} (the longer of ${PRESUMED_LOST_FLOOR_S / 60} minutes and twice this run's longest seat); an answer it still sends is kept unbound and recorded for no entry`;
  for (const seat of seats) {
    if (returnOf(l, seat) !== null) continue;
    const lost = lostOf(seat);
    if (lost?.lost) continue;
    const by = lost ? `; with no sign of its end by ${lost.lost_at} it is presumed lost, and the entry is launched again (at once, if the run's conversation is resumed after its Claude Code process ended)` : "";
    return { ...no("running", seat, `no ledger shows that seat ${seat} has returned (no answer taken or refused for good, no returned event, no recorded stop, no capture cut off at its stop), so it is taken to be still running${by}`), ...(lost ? { lost_at: lost.lost_at } : {}) };
  }
  /* NO RELAUNCH IS REFUSED ON A PREDICTION. Item 3 refused one
   * where the entry's deadline had stopped a check of the seat's answer, on the premise that a new seat would meet the same
   * check (a real run, on the base build). On this build no line says that: the entry never stops a check that has begun (it
   * lets it go, hook.ts `deadline()`), so a deadline line not let go means the capture had not begun, and a line an earlier
   * build wrote names a check this build no longer runs that way (0.6 s where it took 18 s). A seat is refused a relaunch
   * only by what was counted - the cap below, and a refusal cap or an answer already recorded above - whose words are a
   * count, never a forecast. What a repeating failure costs is bounded by the cap. */
  const times = l.relaunches?.get(entryId) ?? 0;
  if (times >= RELAUNCHES_MAX) {
    return no("capped", r.seat, `the entry was launched again ${times} times in this run, the most the relaunch rule allows (${RELAUNCHES_MAX}), and its answer is still not recorded; its candidates are listed as not checked`);
  }
  const aside = [...(l.setAside ?? [])].reverse().find((a) => a.entry === entryId && a.seat === r.seat);
  if (aside) return { ok: true, entry: entryId, seat: r.seat, how: `its record ${aside.file} was set aside at ${aside.at} (${aside.why})` };
  const returned = returnOf(l, r.seat);
  if (returned !== null) return { ok: true, entry: entryId, seat: r.seat, how: returned };
  const lost = lostOf(r.seat) as NonNullable<ReturnType<typeof lostOf>>;
  return { ok: true, entry: entryId, seat: r.seat, how: presumedHow(r.seat, lost), presumed_lost: true, ...(lost.by === "resume" ? { resumed: true as const } : {}) };
}


/** A seat whose answer stayed invalid after the hook's refusals: what is reported as not judged, and where the answer is kept. */
export interface NotJudged {
  entry: string;
  role: string;
  seat: string;
  /** The kept answer, relative to the `.legal` directory ("" where the answer was set aside and no hook kept one). */
  kept: string;
  /**
   * Set where the entry's answer is on disk and cannot be used for a reason of its own (step 6 SETS IT ASIDE,
   * assemble-report.ts): the reason, in words. Its candidates are listed as not checked, never as judged.
   */
  why?: string;
}

export interface NotJudgedSets {
  /** Adjudicator, verdict-after-readers and reader entries: by finding_id. */
  findings: Map<string, NotJudged>;
  /** Refuter entries: by finding_id. */
  refutations: Map<string, NotJudged>;
  /** Silence-investigator entries: by rule_id. */
  silences: Map<string, NotJudged>;
}

/**
 * THE NOT-JUDGED RULE: an entry that no record answers and whose seat's answer the capture kept invalid after its
 * refusals, as the hook ledger's `invalid` line of it; null otherwise. One copy:
 * the relaunch rule above (such an entry is not launched again), the assembly (its candidates are reported as not
 * judged), the readers' fold (a reader kept invalid) and verdict-verify's NO VERDICT ask it.
 */
export function keptInvalidOf(l: AnswerLedgers, entryId: string): HookLedgerLine | null {
  // A superseded refuter entry's answer answers a verdict that no longer exists, so it is no answer kept
  // invalid either: never "not judged", never the reason a candidate is not refuted (launch-list-file.ts `standingRefuters`).
  if (!l.refuters.stands(entryId)) return null;
  if (l.recorded.has(entryId)) return null;
  const lines = [...l.byAgent.values()].flat().filter((x) => x.entry === entryId);
  if (lines.some((x) => x.outcome === "accepted")) return null;
  return lines.find((x) => x.outcome === "invalid") ?? null;
}

/**
 * Every entry of the list that `keptInvalidOf` names, and its ids as step 6 reports them not judged: the candidates of
 * adjudicator, verdict-after-readers and reader entries, the candidates of refuter entries, the rules of silence entries.
 */
export function notJudgedOf(
  list: { entries: { id: string; role: unknown; finding_ids?: string[]; rule_ids?: string[] }[] },
  l: AnswerLedgers,
): { entries: Map<string, NotJudged>; sets: NotJudgedSets } {
  const entries = new Map<string, NotJudged>();
  const sets: NotJudgedSets = { findings: new Map(), refutations: new Map(), silences: new Map() };
  // An entry with a make-up seat (design 1.7; launch-list-file.ts `withMakeupEntry`): the make-up seat answers for it, so
  // its own invalid answer judges nothing either way - the make-up seat's record, or its own invalid answer, decides.
  const madeUp = new Set(list.entries.map((e) => (e as { makeup_of?: unknown }).makeup_of).filter((x): x is string => typeof x === "string"));
  for (const entry of list.entries) {
    const invalid = keptInvalidOf(l, entry.id);
    if (!invalid) continue;
    const role = String(entry.role);
    const nj: NotJudged = { entry: entry.id, role, seat: invalid.agent_id, kept: invalid.answer?.kept ?? "" };
    entries.set(entry.id, nj);
    if (madeUp.has(entry.id)) continue;
    // A reader whose make-up seat is also kept invalid (F3's open item, decided in build unit F4, design section 3): only a
    // place-plan reader gets a make-up seat, and under the place plan its places are `not_answered` in the per-place table
    // and the answer seat answers the candidate over them (a fold listing not-answered places is `needs_human`). So the
    // candidate is not "not judged" for it; the entry stays in `entries` (the assembly names the seat and its kept answer).
    if (role === "reader" && typeof (entry as { makeup_of?: unknown }).makeup_of === "string") continue;
    /* A second look kept invalid is no refutation of its finding: where
     * the run has the second check the finding's refutation is its ordinary refuter's, and the second look is reported as not
     * answered (assemble-report.ts `secondLooksOf`). The entry stays in `entries`. */
    if (isChallengeEntry(entry)) continue;
    const ids = (role === "silence-investigator" ? entry.rule_ids : entry.finding_ids) ?? [];
    const into = role === "refuter" ? sets.refutations : role === "silence-investigator" ? sets.silences : sets.findings;
    for (const id of ids) if (!into.has(id)) into.set(id, nj);
  }
  return { entries, sets };
}

/**
 * The candidates step 6 will report as not judged because their seat's answer was kept invalid, for a run's `.legal`
 * directory (its launch list at `launch/launch-list.json`, read through the list's one reader): what `verdict-verify
 * --legal` names under NO VERDICT (m5). No list: none. A list that cannot be read: thrown, naming it.
 */
/**
 * SET ASIDE WHILE THE RUN CAN LAUNCH. Run by the assembly
 * before it reads the run: while the run's active-run marker stands for the launch list's run, every record the capture
 * wrote through the hook for a listed entry and that was since removed or changed outside the program gets a line in the
 * run's set-aside ledger (hook-launch.ts A RECORD SET ASIDE). The relaunch rule then answers its entry `ok` (or `capped`
 * past the relaunch cap), so the lines on that record say to launch the entry again instead of listing its candidates as
 * not checked: an entry judged again is better than one listed. Where the run can no longer launch, nothing is written
 * and the assembly lists the record's candidates (assemble-report.ts settleOneAnswers). Returns the lines it wrote.
 */
export function setAsideChangedRecords(legalDir: string, launchDir: string, now: Date = new Date()): SetAsideLine[] {
  const marker = readActiveRun(launchDir);
  if (marker.state !== "active") return [];
  const listPath = join(launchDir, "launch-list.json");
  if (!existsSync(listPath)) return [];
  const out: SetAsideLine[] = [];
  try {
    const read = readLaunchList(listPath);
    if (!read.ok || read.value.run_id !== marker.marker.run_id) return [];
    const list = read.value;
    const ledger = readCaptureLedger(legalDir);
    const check = checkLedger(legalDir, ledger);
    const gone = [
      ...check.changed.map((c) => ({ file: c.file, why: `changed outside the program: sha256 ${c.now.slice(0, 16)}... on disk, ${c.recorded.slice(0, 16)}... in the capture ledger` })),
      ...check.missing.map((file) => ({ file, why: "removed outside the program: the capture ledger records it and it is not on disk" })),
    ];
    for (const g of gone) {
      const e = ledger.latest.get(g.file);
      const entry = e?.via?.how === "hook" ? e.via.entry : undefined;
      if (!e || typeof entry !== "string" || entry === "" || !list.entries.some((x) => x.id === entry)) continue;
      const line: SetAsideLine = { at: now.toISOString(), entry, file: g.file, seat: e.seat, sha256: e.sha256, why: g.why };
      if (recordSetAside(launchDir, list.run_id, line)) out.push(line);
    }
  } catch {
    // A ledger or list that does not read is the assembly's own whole-run refusal; nothing is set aside here.
    return out;
  }
  return out;
}

export function keptInvalidFindings(legalDir: string): Map<string, NotJudged> {
  const launchDir = join(legalDir, "launch");
  const listPath = join(launchDir, "launch-list.json");
  if (!existsSync(listPath)) return new Map();
  const read = readLaunchList(listPath);
  if (!read.ok) throw new Error(read.problem);
  return notJudgedOf(read.value, readAnswerLedgers(legalDir, launchDir, read.value.run_id)).sets.findings;
}

/**
 * What the relaunch rule decides for an entry with no record, in the rule's words: the assembly prints it beside an
 * unanswered entry or a cut-off seat, so its advice is the launch gate's decision. The
 * sequence that follows it is the line's recovery (recovery.ts `RECOVERY`, read from the same decision).
 */
export function relaunchAdvice(r: Relaunch): string {
  if (r.ok && r.resumed) return `Launch entry ${r.entry} again, its agent_input exactly as the launch list writes it: its seat ${r.seat} ended with the earlier Claude Code process of the run's conversation (${r.how}), and the launch gate lets this second launch through`;
  if (r.ok && r.presumed_lost) return `Launch entry ${r.entry} again, its agent_input exactly as the launch list writes it: its seat ${r.seat} is presumed lost (${r.how}), and the launch gate lets this second launch through`;
  if (r.ok) return `Launch entry ${r.entry} again, its agent_input exactly as the launch list writes it: its seat ${r.seat} has returned and its answer was lost (${r.how}), and the launch gate lets this second launch through`;
  switch (r.state) {
    // An entry no launch has reserved is launched from what launch-next prints (SKILL.md step 4: launch only
    // what launch-next prints, and keep no list of your own), never from the orchestrator's own read of the list. In auto
    // mode this is the state of a violation candidate whose refuter entry the capture appended (M1) and nobody launched.
    case "not-launched":
      return `Entry ${r.entry} is still to launch (${r.why}): launch-next lists it, with its agent_input, once the entries it waits for have returned and a place is free`;
    // What to do next - wait, then step 5a and the assembly, or a new attempt where the seat has ended unseen - is the
    // recovery the line ends with (recovery.ts, by this same decision), not repeated here.
    default:
      return `Do not launch entry ${r.entry} again: ${r.why}`;
  }
}
