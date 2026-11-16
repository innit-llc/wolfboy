/**
 * THE PERSON'S OWN DECISIONS ABOUT A FINDING, LOCAL ONLY (delivery design rf11 3.4, 3.5,
 * 3.7 page 2, 5 and 7, mocks M10, M10b, M10c).
 *
 * A person records only the findings they choose to, in one sentence, several at once; the skill maps the sentence to
 * one `legal-scan decide` command and the program asks one question before anything is kept. Four kinds:
 * `keep` (stays as it is), `misread` (the review misread the code), `counsel` (counsel's answer) and `withdrawn`.
 *
 * WHAT A DECISION NEVER CHANGES: a verdict, a disposition, any count, the fix order, a premise, anything a seat is
 * handed, anything CI shows or decides, any gate, the evidence log. The assembly computes every count before it reads a
 * decision (`AssembleInput.personDecisions` is a reader the assembly calls only after its model's counts are made), and the
 * gate `test:assemble-report` holds every count, the end screen's and the log's bytes equal with decisions present and
 * absent. What a decision changes, in this folder on this computer only: the finding leaves "Fix first", "To fix by
 * area" and the to-clarify list for "Decided by you", inside the same count, and its file shows the decision.
 *
 * WHERE THEY LIVE: the person's state folder, one append-only file per scanned folder (state-record.ts
 * `DECISIONS_RECORD`, keyed as the start record is), refused inside the scanned folder or any git work tree. Nothing is
 * written into the repository. The program never edits or deletes an entry: a change of mind is a new entry, and "needs
 * a new look", "expired" and "gone" are states computed at every assembly, never edits.
 *
 * WHAT A DECISION IS MADE AGAINST: the evidence log's `listed[]` (each finding the report listed, as it listed it), made
 * by one function from the report's model (assemble-report.ts `listedRowsOf`). `decide` reads it from the log it names;
 * each assembly makes it again and compares (`decisionViewOf`): one function on both sides, so the two cannot disagree.
 *
 * THE ENTRY'S SCHEMA is `parseDecisionEntry`: every field checked, no other field allowed, and one line that is not the
 * program's own form makes the whole record unreadable ("none applied"), as the number list's reader does. It is kept
 * here rather than as a file of the schemas package, whose compiled module is a verdict-rules source.
 */
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { askInputLines } from "./launch-plan.js";
import { Help, Option, type Command } from "commander";
import { TerminalAsker } from "./declaration.js";
import { listEarlierLogs } from "./earlier-run.js";
import { productPrintedRedaction } from "./engine.js";
import { redactPrintedText } from "./credential-redaction.js";
import { ACTIVE_RUN_MARKER } from "./hook.js";
import { abortCommand, latestRunEndAt } from "./hook-launch.js";
import { PASS_EXACTLY, markConfirmationUsed, scanWindowOpen, takeConfirmation, writeConfirmationQuestion, type AskQuestion } from "./hook-question.js";
import { EVIDENCE_DIR_NAME, LEGAL_DIR_NAME, compareEvidenceLogs } from "./legal-dir.js";
import { readLogDigests } from "./log-digest.js";
import { NUMBER_LIST_KIND, fNumber, idsOfHandle, numbersOfLog, parseNumberList } from "./number-list.js";
import { readRegularFile } from "./project-read.js";
import { processStateDir } from "./start-record.js";
import { DECISIONS_RECORD, STATE_FOLDER_REMEDY, appendStateRecord, readStateRecord, type StateRecordRead } from "./state-record.js";
import type { Rerender } from "./report-render.js";

export const DECIDE_PURPOSE = "decide";
export const DECISION_KINDS = ["keep", "misread", "counsel", "withdrawn"] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];
/** `refused`: a finding named and not recorded, once the person answered "Record"; it applies nothing and moves nothing. */
export type EntryKind = DecisionKind | "refused";
export type ListName = "to_fix" | "to_clarify" | "to_answer" | "not_counted";
export type OpenPoint = "question" | "law_unclear" | "code_not_readable" | null;
/** At most this many findings in one question (a group counts as one); more are "not taken: name them again". */
export const MAX_PER_QUESTION = 8;
/** Every kind's end date: 12 months from the decision, shorter where the person names one (design 3.4). */
export const DECISION_MONTHS = 12;
/** Each kind's reason: required or not, and its length in characters (design 3.4's table). */
export const REASON_LIMITS: Record<DecisionKind, { required: boolean; min: number; max: number }> = {
  keep: { required: false, min: 1, max: 200 },
  misread: { required: true, min: 10, max: 300 },
  counsel: { required: true, min: 10, max: 400 },
  withdrawn: { required: false, min: 0, max: 0 },
};

/** One finding the report listed, as it listed it: the log's `listed[]` row (evidence-log.schema.json). */
export interface ListedRow {
  finding_id: string;
  short_id: string;
  /** The short id of the entry it is listed under: the places of one group share it. */
  group: string;
  title: string;
  list: ListName;
  level: string;
  places: string[];
  provisions: { cite: string; region: string }[];
  rule_id: string;
  rule_digest: string | null;
  open_point: OpenPoint;
  read_in_part: boolean;
}

/** What a decision rests on beside the place and the rule (design 7, change A, item 3). */
export interface Outcome {
  list: ListName;
  level: string;
  places: string[];
  provisions: { cite: string; region: string }[];
}
export const outcomeOf = (r: ListedRow): Outcome => ({ list: r.list, level: r.level, places: [...r.places], provisions: r.provisions.map((p) => ({ cite: p.cite, region: p.region })) });

export interface DecisionEntry {
  v: 1;
  kind: EntryKind;
  /** Null only on a `refused` line whose handle named no single finding. */
  finding_id: string | null;
  /** The words the person named it by (an F-number or a short id). */
  handle: string;
  rule_id: string | null;
  rule_digest: string | null;
  outcome: Outcome | null;
  /** The person's words, credential patterns redacted; null where none was given. */
  reason: string | null;
  /** On a `refused` line: why it was not recorded and what can be recorded instead. */
  why: string | null;
  batch: string;
  at: string;
  /** The end date (YYYY-MM-DD); null on `withdrawn` and `refused`. */
  until: string | null;
  scan_id: string;
  log: string;
}

/* ------------------------------------------------------------------------------------------------ the record */

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const strOrNull = (x: unknown): x is string | null => x === null || typeof x === "string";
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ENTRY_KEYS = ["v", "kind", "finding_id", "handle", "rule_id", "rule_digest", "outcome", "reason", "why", "batch", "at", "until", "scan_id", "log"];
const LISTS: readonly ListName[] = ["to_fix", "to_clarify", "to_answer", "not_counted"];

function parseOutcome(x: unknown): Outcome | null | undefined {
  if (x === null) return null;
  if (!isObj(x) || Object.keys(x).sort().join() !== "level,list,places,provisions") return undefined;
  if (!LISTS.includes(x.list as ListName) || typeof x.level !== "string") return undefined;
  if (!Array.isArray(x.places) || !x.places.every((p) => typeof p === "string")) return undefined;
  if (!Array.isArray(x.provisions) || !x.provisions.every((p) => isObj(p) && typeof p.cite === "string" && typeof p.region === "string" && Object.keys(p).length === 2)) return undefined;
  return { list: x.list as ListName, level: x.level, places: x.places as string[], provisions: (x.provisions as { cite: string; region: string }[]).map((p) => ({ cite: p.cite, region: p.region })) };
}

/** One line of the record, or why it is not the program's own form. THE ENTRY'S SCHEMA. */
export function parseDecisionEntry(line: string): DecisionEntry | { problem: string } {
  let d: unknown;
  try {
    d = JSON.parse(line);
  } catch {
    return { problem: "a line is not JSON" };
  }
  if (!isObj(d)) return { problem: "a line is not an object" };
  const extra = Object.keys(d).filter((k) => !ENTRY_KEYS.includes(k));
  if (extra.length > 0 || ENTRY_KEYS.some((k) => !(k in d))) return { problem: "a line does not hold exactly the entry's fields" };
  if (d.v !== 1) return { problem: "a line is of another version" };
  if (![...DECISION_KINDS, "refused"].includes(d.kind as string)) return { problem: "a line names no kind of decision" };
  const kind = d.kind as EntryKind;
  if (!strOrNull(d.finding_id) || (d.finding_id === "") || (d.finding_id === null && kind !== "refused")) return { problem: "a line names no finding" };
  if (typeof d.handle !== "string" || d.handle === "") return { problem: "a line has no handle" };
  if (!strOrNull(d.rule_id) || !strOrNull(d.rule_digest) || !strOrNull(d.reason) || !strOrNull(d.why) || !strOrNull(d.until)) return { problem: "a line has a field of the wrong type" };
  const outcome = parseOutcome(d.outcome);
  if (outcome === undefined) return { problem: "a line's outcome is not the program's form" };
  if (typeof d.batch !== "string" || d.batch === "" || typeof d.at !== "string" || Number.isNaN(Date.parse(d.at)) || typeof d.scan_id !== "string" || typeof d.log !== "string") return { problem: "a line has no batch, time, scan or log" };
  const deciding = kind === "keep" || kind === "misread" || kind === "counsel";
  if (deciding && (outcome === null || d.rule_id === null || d.until === null || !DAY.test(d.until))) return { problem: "a decision has no outcome, rule or end date" };
  if (deciding && REASON_LIMITS[kind].required && (d.reason === null || d.reason === "")) return { problem: "a decision of a kind that needs a reason has none" };
  if (kind === "refused" && (d.why === null || d.why === "")) return { problem: "a refused line says no reason" };
  return d as unknown as DecisionEntry;
}

/** The record as read: every entry in order, or why it cannot be used (then none applies). */
export type DecisionRecord = { ok: true; entries: DecisionEntry[]; absent: boolean } | { ok: false; why: string };

export function parseDecisionRecord(text: string): DecisionRecord {
  if (text !== "" && !text.endsWith("\n")) return { ok: false, why: "its last line is cut" };
  const entries: DecisionEntry[] = [];
  for (const line of text.split("\n").slice(0, -1)) {
    const e = parseDecisionEntry(line);
    if ("problem" in e) return { ok: false, why: e.problem };
    entries.push(e);
  }
  return { ok: true, entries, absent: false };
}

/** The record of `target`'s folder in the state folder `stateDir`: none, its entries, or why it could not be read. */
export function readDecisionRecord(stateDir: string | null, target: string): DecisionRecord {
  const got: StateRecordRead = readStateRecord(stateDir, target, DECISIONS_RECORD);
  if (!got.read) return got.absent ? { ok: true, entries: [], absent: true } : { ok: false, why: got.why };
  return parseDecisionRecord(got.text);
}

/* ------------------------------------------------------------------------------------------------ states */

export type StateName = "applied" | "new_look" | "expired" | "gone";
export interface DecisionState {
  state: StateName;
  entry: DecisionEntry;
  /** What changed since the decision, in words ("the rule was updated"); empty where nothing did. */
  changed: string[];
}

/** What every view reads of the person's decisions for this folder, computed against the current listing. */
export interface DecisionView {
  /** "none": no record for this folder on this computer; "unreadable": `why`; "ok": entries read. */
  read: "none" | "unreadable" | "ok";
  why: string | null;
  /** Each finding id whose latest decision stands (not withdrawn), with its state. */
  stateOf: Map<string, DecisionState>;
  /** Every entry for a finding id, in order: the history its file shows. */
  historyOf: Map<string, DecisionEntry[]>;
  /** The decisions whose finding is not listed in this run, for "Gone" (design 3.4: "you had decided it on <date>"). */
  gone: DecisionState[];
}

const sameJson = (x: unknown, y: unknown): boolean => JSON.stringify(x) === JSON.stringify(y);
const sorted = (xs: readonly string[]): string[] => [...xs].sort();
const provisionKeys = (o: Outcome): string[] => sorted(o.provisions.map((p) => `${p.region}\u0000${p.cite}`));
const LIST_WORDS: Record<ListName, string> = { to_fix: "to fix", to_clarify: "to clarify", to_answer: "to answer", not_counted: "not counted" };

/** What changed, in words, between the outcome a decision was made on and the current one. */
export function changesOf(entry: DecisionEntry, now: ListedRow): string[] {
  const was = entry.outcome as Outcome;
  const out: string[] = [];
  if (entry.rule_digest !== null && now.rule_digest !== null && entry.rule_digest !== now.rule_digest) out.push("the rule was updated");
  if (was.list !== now.list) out.push(`it is now ${LIST_WORDS[now.list]}, not ${LIST_WORDS[was.list]}`);
  if (was.level !== now.level) out.push(`its level is now ${now.level}, not ${was.level}`);
  if (!sameJson(sorted(was.places), sorted(now.places))) out.push("its places changed");
  if (!sameJson(provisionKeys(was), provisionKeys(outcomeOf(now)))) out.push("the provisions or regions it is reported under changed");
  return out;
}

/**
 * Every decision's state at this assembly (design 3.4's table): applied, needs a new look (the rule's digest or the
 * outcome changed), expired (its end date passed on `today`, YYYY-MM-DD), gone (not listed in this run). Withdrawn and
 * refused entries stay in the history only.
 */
export function decisionViewOf(record: DecisionRecord, rows: readonly ListedRow[], today: string): DecisionView {
  const view: DecisionView = { read: record.ok ? (record.absent ? "none" : "ok") : "unreadable", why: record.ok ? null : record.why, stateOf: new Map(), historyOf: new Map(), gone: [] };
  if (!record.ok) return view;
  const rowOf = new Map(rows.map((r) => [r.finding_id, r] as const));
  const latest = new Map<string, DecisionEntry>();
  for (const e of record.entries) {
    if (e.finding_id === null) continue;
    view.historyOf.set(e.finding_id, [...(view.historyOf.get(e.finding_id) ?? []), e]);
    if (e.kind !== "refused") latest.set(e.finding_id, e);
  }
  for (const [id, e] of latest) {
    if (e.kind === "withdrawn") continue;
    const now = rowOf.get(id);
    if (now === undefined) {
      view.gone.push({ state: "gone", entry: e, changed: [] });
      continue;
    }
    const changed = changesOf(e, now);
    const state: StateName = e.until !== null && today > e.until ? "expired" : changed.length > 0 ? "new_look" : "applied";
    view.stateOf.set(id, { state, entry: e, changed: state === "expired" ? ["its date passed"] : changed });
  }
  return view;
}

/** Whether a finding id's decision applies at this assembly. */
export const decidedApplies = (v: DecisionView | undefined, id: string): boolean => v?.stateOf.get(id)?.state === "applied";

/* ------------------------------------------------------------------------------------------------ words */

export const DECISION_WORDS = {
  kind: { keep: "stays as it is", misread: "the review misread the code", counsel: "counsel's answer", withdrawn: "decision withdrawn", refused: "asked for and not recorded" } as Record<EntryKind, string>,
  reasonLead: { keep: "Your reason, kept as your words:", misread: "What the code does, kept as your words:", counsel: "Counsel's answer, kept as your words:" } as Record<string, string>,
  noReason: "no reason given",
  keptHere: "Kept in this folder on this computer. Every count stays as it is; each comes back to its list when the code at its place changes.",
  keptHereCounsel: "Kept in this folder on this computer. Every count stays as it is, and the counsel mark stays on the finding.",
  headerAsk: "Decisions",
  ask: (n: number) => (n === 1 ? "Record this decision?" : "Record these decisions?"),
  asOf: (day: string, latest: boolean, n: number) => `As the review of ${day} reported ${n === 1 ? "it" : "them"}${latest ? " (the latest in this folder)" : ""}:`,
  recordLabel: (n: number) => (n === 1 ? "Record it" : n === 2 ? "Record both" : `Record these ${n}`),
  recordWhat: "Keep these decisions in this folder on this computer; no count changes.",
  noLabel: "No",
  noWhat: "Record nothing.",
  notRecorded: "Not recorded:",
  notTaken: (hs: readonly string[]) => `Not taken (at most ${MAX_PER_QUESTION} in one question): ${hs.join(", ")}: name them again.`,
  why: {
    noFinding: (day: string) => `names no finding of the review of ${day}`,
    several: (shorts: readonly string[]) => `matches ${shorts.length} findings (${shorts.join(", ")}): name one by a longer id`,
    ruledOut: "was ruled out by the review; disagreeing with a ruled-out verdict is not part of this release",
    noVerdict: "has no standing verdict in that review",
    notCounted: "is not counted as a problem in that review: there is nothing to decide",
    partly: "the AI read it only in part: run the scan again so that it is read whole",
    waits: 'waits on your answer about the product: answer the question instead: "review my answers"',
    law: (f: string) => `waits on a point of law. Record it once counsel has settled it: "${f}: counsel says …"`,
    counselOnly: (f: string) => `is to clarify: record counsel's answer: "${f}: counsel says …"`,
    reasonNeeded: (kind: DecisionKind, lim: { min: number; max: number }) =>
      kind === "misread" ? `needs what the code does, in ${lim.min} to ${lim.max} characters` : `needs counsel's answer, in ${lim.min} to ${lim.max} characters`,
    reasonLong: (max: number) => `its reason is longer than ${max} characters`,
    nothingToWithdraw: "has no decision of yours to withdraw",
    twice: "is named twice",
  },
  recorded: (fs: readonly string[], lists: readonly string[]) =>
    `Recorded in this folder on this computer: ${fs.join(", ")}. Still counted in ${lists.map((l) => `"${l}"`).join(" and ")}; the report the next scan here writes lists ${fs.length === 1 ? "it" : "them"} under "Decided by you".`,
  /* The reply once the report already written shows the decisions (mock M10). */
  recordedShown: (fs: readonly string[], lists: readonly string[]) =>
    `Recorded. ${andList(fs)} ${fs.length === 1 ? "is" : "are"} under "Decided by you" and still counted in ${lists.map((l) => `"${l}"`).join(" and ")}. ${fs.length === 1 ? "Its" : "Each finding's"} file shows the decision.`,
  recordedInList: (fs: readonly string[]) =>
    `Recorded: ${andList(fs)}. In the report ${fs.length === 1 ? "it stays in its list" : "they stay in their lists"}; ${fs.length === 1 ? "its" : "each one's"} file says why.`,
  withdrawnShown: (fs: readonly string[]) => `Recorded: your decisions on ${andList(fs)} are withdrawn; ${fs.length === 1 ? "it is back in its list" : "they are back in their lists"} in the report.`,
  olderKept: (day: string) => `The report of ${day} is kept as it was written; the latest report in this folder is the one written again.`,
  notShown: (why: string) => `The report already written was not changed: ${why}.`,
  withdrawnDone: (fs: readonly string[]) => `Recorded: your decisions on ${fs.join(", ")} are withdrawn; ${fs.length === 1 ? "it goes" : "they go"} back to ${fs.length === 1 ? "its list" : "their lists"} in the report the next scan here writes.`,
  nothingRecorded: "Nothing was recorded.",
  underWay: (abort: string) => `A scan is under way here; decide when it has ended, or, if it stopped part way, end it first with ${abort} and decide again. Nothing was recorded.`,
  underWayUnread: (why: string) => `Whether a scan is under way here could not be read (${why}), so nothing was recorded.`,
  ci: "In CI there is nobody to ask, so decide records nothing.",
  noTerminal: "There is no terminal to ask on and no Claude Code session, so nothing was recorded.",
  unreadable: (why: string) => `Your decisions for this folder could not be read (${why}), so nothing was recorded.`,
  // Where the place was refused, the sentence ends in the way past it.
  refusedPlace: (why: string, placeRefused = false) => `Nothing was recorded: your decisions for this folder cannot be kept on this computer (${why})${placeRefused ? `; ${STATE_FOLDER_REMEDY}` : ""}.`,
};

/** "F1", "F1 and F2", "F1, F2 and F3". */
function andList(xs: readonly string[]): string {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/* ------------------------------------------------------------------------------------------------ the batch */

/** What the person asked for, one entry per kind they named, in order (`--keep F11 F12 --reason "…"`). */
export interface DecideRequest {
  kind: DecisionKind;
  handles: string[];
  reason: string | null;
  until: string | null;
}

/** The chosen log, as `decide` reads it: nothing in it is trusted beyond the form it claims. */
export interface DecideLog {
  name: string;
  sha256: string;
  scanId: string;
  day: string;
  latest: boolean;
  rows: ListedRow[];
  /** Every verdict's finding id (ruled-out ones included) and every candidate no verdict answered. */
  verdictIds: Set<string>;
  unadjudicatedIds: Set<string>;
}

export interface TakenItem {
  kind: DecisionKind;
  handle: string;
  /** The places it covers: one row, or every place of a group named by its F-number. */
  rows: ListedRow[];
  reason: string | null;
  until: string | null;
}
export interface RefusedItem {
  handle: string;
  finding_id: string | null;
  label: string;
  why: string;
  rows: ListedRow[];
}
export interface Batch {
  take: TakenItem[];
  refused: RefusedItem[];
  notTaken: string[];
  about: string;
}

/** The person's words as kept: whitespace made single spaces, control characters dropped, credential patterns redacted. */
export function keptWords(text: string): string {
  const words = Array.from(text.replace(/\s+/g, " "))
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return c >= 0x20 && !(c >= 0x7f && c < 0xa0);
    })
    .join("")
    .trim();
  const redaction = productPrintedRedaction();
  return redaction ? redactPrintedText(redaction, words) : words;
}

/** The handle as the question and the record show it: "F11 3b7e90". */
const labelOf = (handle: string, rows: readonly ListedRow[], numberOf: ReadonlyMap<string, number>): string => {
  const r = rows[0];
  if (!r) return handle;
  const n = numberOf.get(r.finding_id);
  return `${n !== undefined ? `${fNumber(n)} ` : ""}${rows.length > 1 ? r.group : r.short_id}`;
};

/**
 * Plan one `decide` call: which findings are taken (each named finding, or each place of a group named by its F-number),
 * which are refused and why (design 3.4: by the kind of open point, ruled out, read in part, no standing verdict), and
 * which are left over the question's limit. Pure: `record` is the person's record for this folder, `numberOf` this
 * folder's numbers.
 */
export function planBatch(requests: readonly DecideRequest[], log: DecideLog, numberOf: ReadonlyMap<string, number>, record: readonly DecisionEntry[]): Batch {
  const rowOf = new Map(log.rows.map((r) => [r.finding_id, r] as const));
  const allIds = [...new Set([...log.rows.map((r) => r.finding_id), ...log.verdictIds, ...log.unadjudicatedIds])];
  const latest = new Map<string, DecisionEntry>();
  for (const e of record) if (e.finding_id !== null && e.kind !== "refused") latest.set(e.finding_id, e);
  const take: TakenItem[] = [];
  const refused: RefusedItem[] = [];
  const notTaken: string[] = [];
  const named = new Set<string>();
  const W = DECISION_WORDS.why;
  for (const q of requests) {
    for (const handle of q.handles) {
      const ids = idsOfHandle(handle, allIds, numberOf);
      const refuse = (why: string, rows: ListedRow[] = [], id: string | null = rows.length === 1 ? (rows[0] as ListedRow).finding_id : null): void => {
        refused.push({ handle, finding_id: id, label: rows.length > 0 ? labelOf(handle, rows, numberOf) : handle, why, rows });
      };
      if (ids.length === 0) {
        refuse(W.noFinding(log.day));
        continue;
      }
      const listed = ids.map((id) => rowOf.get(id)).filter((r): r is ListedRow => r !== undefined);
      const groups = new Set(listed.map((r) => r.group));
      const byNumber = /^f\d+$/i.test(handle.trim());
      if (listed.length !== ids.length || groups.size > 1) {
        if (ids.length > 1) {
          refuse(W.several(ids.map((id) => rowOf.get(id)?.short_id ?? id.replace(/^fp_/, "").slice(0, 6))));
          continue;
        }
        const id = ids[0] as string;
        refuse(log.unadjudicatedIds.has(id) && !log.verdictIds.has(id) ? W.noVerdict : W.ruledOut, [], id);
        continue;
      }
      const rows = byNumber ? log.rows.filter((r) => r.group === (listed[0] as ListedRow).group) : listed;
      const head = rows[0] as ListedRow;
      const f = labelOf(handle, rows, numberOf).split(" ")[0] as string;
      if (rows.some((r) => named.has(r.finding_id))) {
        refuse(W.twice, rows);
        continue;
      }
      const reason = q.reason === null ? null : keptWords(q.reason);
      let why: string | null = null;
      if (q.kind === "withdrawn") {
        if (!rows.some((r) => { const e = latest.get(r.finding_id); return e !== undefined && e.kind !== "withdrawn"; })) why = W.nothingToWithdraw;
      } else if (head.list === "not_counted") why = W.notCounted;
      else if (head.list === "to_answer" || head.open_point === "question") why = W.waits;
      else if (rows.some((r) => r.read_in_part)) why = W.partly;
      else if (q.kind !== "counsel" && head.list === "to_clarify" && head.open_point === "law_unclear") why = W.law(f);
      else if (q.kind !== "counsel" && head.list === "to_clarify" && head.open_point !== "code_not_readable") why = W.counselOnly(f);
      else {
        const lim = REASON_LIMITS[q.kind];
        const n = reason === null ? 0 : Array.from(reason).length;
        if (lim.required && n < lim.min) why = W.reasonNeeded(q.kind, lim);
        else if (n > lim.max) why = W.reasonLong(lim.max);
      }
      if (why !== null) {
        refuse(why, rows);
        continue;
      }
      for (const r of rows) named.add(r.finding_id);
      if (take.length >= MAX_PER_QUESTION) {
        notTaken.push(handle);
        continue;
      }
      take.push({ kind: q.kind, handle, rows: q.kind === "withdrawn" ? rows.filter((r) => { const e = latest.get(r.finding_id); return e !== undefined && e.kind !== "withdrawn"; }) : rows, reason: q.kind === "withdrawn" ? null : reason === "" ? null : reason, until: q.kind === "withdrawn" ? null : q.until });
    }
  }
  const about = createHash("sha256")
    .update(
      JSON.stringify({
        log: log.name,
        sha256: log.sha256,
        take: take.map((t) => [t.kind, t.rows.map((r) => r.finding_id), t.reason, t.until]),
        refused: refused.map((r) => [r.handle, r.finding_id, r.why]),
        notTaken,
      }),
    )
    .digest("hex");
  return { take, refused, notTaken, about };
}

/** The one question (mock M10): every finding to be kept, the reason as the person's words, the findings not recorded. */
export function decideQuestion(batch: Batch, log: DecideLog, numberOf: ReadonlyMap<string, number>): { question: AskQuestion; valueByLabel: Record<string, string> } {
  const n = batch.take.length;
  const lines: string[] = [DECISION_WORDS.asOf(log.day, log.latest, n)];
  const runs: TakenItem[][] = [];
  for (const t of batch.take) {
    const last = runs[runs.length - 1];
    if (last && last[0]?.kind === t.kind && last[0]?.reason === t.reason && last[0]?.until === t.until) last.push(t);
    else runs.push([t]);
  }
  for (const run of runs) {
    for (const t of run) {
      const head = t.rows[0] as ListedRow;
      // Places, not rows: rows are findings, and two can share one place.
      const placesN = new Set(t.rows.flatMap((r) => r.places)).size;
      lines.push(`  ${labelOf(t.handle, t.rows, numberOf)}  ${head.title}${placesN > 1 && !/\(\d+ places\)$/.test(head.title) ? ` (${placesN} places)` : ""}`);
    }
    const t0 = run[0] as TakenItem;
    const who = run.length === 1 ? "" : run.length === 2 ? "Both: " : "All: ";
    if (t0.kind === "withdrawn") lines.push(`  ${who}${DECISION_WORDS.kind.withdrawn}; ${run.length === 1 ? "it goes" : "they go"} back to ${run.length === 1 ? "its list" : "their lists"}.`);
    else {
      lines.push(`  ${who}${DECISION_WORDS.kind[t0.kind]}${t0.until !== null ? `, until ${t0.until}` : ""}.${t0.reason !== null ? ` ${DECISION_WORDS.reasonLead[t0.kind]}` : ` (${DECISION_WORDS.noReason})`}`);
      if (t0.reason !== null) lines.push(`  │ ${t0.reason}`);
    }
  }
  for (const r of batch.refused) lines.push(`  ${DECISION_WORDS.notRecorded} ${r.label} ${r.why}.`);
  if (batch.notTaken.length > 0) lines.push(`  ${DECISION_WORDS.notTaken(batch.notTaken)}`);
  lines.push(`  ${batch.take.every((t) => t.kind === "counsel") ? DECISION_WORDS.keptHereCounsel : DECISION_WORDS.keptHere}`);
  const record = DECISION_WORDS.recordLabel(n);
  return {
    question: {
      question: `${DECISION_WORDS.ask(n)}\n${lines.join("\n")}`,
      header: DECISION_WORDS.headerAsk,
      multiSelect: false,
      options: [
        { label: record, description: DECISION_WORDS.recordWhat },
        { label: DECISION_WORDS.noLabel, description: DECISION_WORDS.noWhat },
      ],
    },
    valueByLabel: { [record]: "record", [DECISION_WORDS.noLabel]: "no" },
  };
}

/** YYYY-MM-DD, `months` after `at` (the same day of the month, or the month's last day). */
export function monthsAfter(at: Date, months: number): string {
  const y = at.getUTCFullYear();
  const m = at.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const d = new Date(Date.UTC(y, m, Math.min(at.getUTCDate(), last)));
  return d.toISOString().slice(0, 10);
}

/** The record's new lines for a batch the person answered "Record" to: one entry per place, then one per refusal. */
export function entryLines(batch: Batch, log: DecideLog, batchId: string, at: Date): string {
  const lines: DecisionEntry[] = [];
  const until = monthsAfter(at, DECISION_MONTHS);
  for (const t of batch.take)
    for (const r of t.rows)
      lines.push({
        v: 1,
        kind: t.kind,
        finding_id: r.finding_id,
        handle: t.handle,
        rule_id: r.rule_id,
        rule_digest: r.rule_digest,
        outcome: t.kind === "withdrawn" ? null : outcomeOf(r),
        reason: t.reason,
        why: null,
        batch: batchId,
        at: at.toISOString(),
        until: t.kind === "withdrawn" ? null : (t.until ?? until),
        scan_id: log.scanId,
        log: log.name,
      });
  for (const x of batch.refused) {
    const ids = x.rows.length > 0 ? x.rows.map((r) => r.finding_id) : [x.finding_id];
    for (const id of ids)
      lines.push({ v: 1, kind: "refused", finding_id: id, handle: x.handle, rule_id: x.rows[0]?.rule_id ?? null, rule_digest: null, outcome: null, reason: null, why: x.why, batch: batchId, at: at.toISOString(), until: null, scan_id: log.scanId, log: log.name });
  }
  return lines.map((e) => `${JSON.stringify(e)}\n`).join("");
}

/* ------------------------------------------------------------------------------------------------ the log */

/** The log's `listed[]`, held to its form; null where the log has none (an earlier build) or one row is not its form. */
export function listedOfLog(log: unknown): ListedRow[] | null {
  const rows = isObj(log) ? log.listed : undefined;
  if (!Array.isArray(rows)) return null;
  const out: ListedRow[] = [];
  for (const r of rows) {
    if (!isObj(r)) return null;
    const ok =
      typeof r.finding_id === "string" && r.finding_id !== "" && typeof r.short_id === "string" && typeof r.group === "string" && typeof r.title === "string" &&
      LISTS.includes(r.list as ListName) && typeof r.level === "string" && Array.isArray(r.places) && r.places.every((p) => typeof p === "string") &&
      Array.isArray(r.provisions) && r.provisions.every((p) => isObj(p) && typeof p.cite === "string" && typeof p.region === "string") &&
      typeof r.rule_id === "string" && strOrNull(r.rule_digest) && [null, "question", "law_unclear", "code_not_readable"].includes(r.open_point as string | null) && typeof r.read_in_part === "boolean";
    if (!ok) return null;
    out.push(r as unknown as ListedRow);
  }
  return out;
}

const idsOf = (xs: unknown): Set<string> =>
  new Set((Array.isArray(xs) ? xs : []).map((x) => (isObj(x) && typeof x.finding_id === "string" ? x.finding_id : "")).filter((s) => s !== ""));

/* ------------------------------------------------------------------------------------------------ the command */

export interface DecideDeps {
  /** Where the person is asked (index.ts `declarationPathOf`): one rule for every question the program asks. */
  pathOf: () => "session" | "terminal" | "ci" | "no-terminal";
  sessionId: () => string | null;
  /**
   * Write the latest report again with the decisions as now recorded (design 3.4:
   * `decide` changes the report already written; report-render.ts). Absent, the reply says the next scan shows them.
   */
  rerender?: (target: string, stateDir: string | null, now: DecisionRecord) => Rerender;
}

/** The person's request from the command's words, in order: `--keep F11 F12 --reason "…" --counsel F6 --reason "…"`. */
export function requestsOf(words: readonly string[]): { requests: DecideRequest[]; log: string | null; target: string; fromAnswer: boolean } | { problem: string } {
  const kinds: Record<string, DecisionKind> = { "--keep": "keep", "--misread": "misread", "--counsel": "counsel", "--withdraw": "withdrawn" };
  const requests: DecideRequest[] = [];
  let log: string | null = null;
  let target = ".";
  let fromAnswer = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as string;
    const next = (): string | null => (i + 1 < words.length ? (words[++i] as string) : null);
    const cur = requests[requests.length - 1];
    if (kinds[w] !== undefined) requests.push({ kind: kinds[w] as DecisionKind, handles: [], reason: null, until: null });
    else if (w === "--reason") {
      const v = next();
      if (!cur || v === null || cur.reason !== null) return { problem: "--reason follows a kind and its findings, once each" };
      cur.reason = v;
    } else if (w === "--until") {
      const v = next();
      if (!cur || v === null || !DAY.test(v)) return { problem: "--until follows a kind and takes a date as YYYY-MM-DD" };
      cur.until = v;
    } else if (w === "--log") log = next();
    else if (w === "--target") target = next() ?? ".";
    else if (w === "--from-answer") fromAnswer = true;
    else if (w.startsWith("--")) return { problem: `${w} is not an option of decide` };
    else if (!cur) return { problem: `${w}: name the kind first (--keep, --misread, --counsel or --withdraw)` };
    else cur.handles.push(w);
  }
  if (requests.length === 0 || requests.some((r) => r.handles.length === 0)) return { problem: "name a kind and at least one finding, for example: decide --keep F11 F12 --reason \"…\"" };
  return { requests, log, target, fromAnswer };
}

export function chooseLog(target: string, typed: string | null, stateDir: string | null): DecideLog | { problem: string } {
  const evidenceDir = join(target, LEGAL_DIR_NAME, EVIDENCE_DIR_NAME);
  const digests = readLogDigests(stateDir, target);
  const { logs } = listEarlierLogs(evidenceDir, target, target, digests);
  if (logs.length === 0) return { problem: `this folder holds no evidence log in ${evidenceDir}: run a scan first` };
  // The latest log in this folder is the newest by its own completion time, as the review entrance orders them
  // (`compareEvidenceLogs`). `listEarlierLogs` puts the logs whose digest matches first (A4), so its first entry is the
  // newest such log, not the newest log: taking it would record against an older run while the question called it "the
  // latest in this folder". A newest log that does not match is refused below.
  const newest = [...logs].sort((a, b) => compareEvidenceLogs({ name: basename(a.path), completedAt: a.completed_at ?? "" }, { name: basename(b.path), completedAt: b.completed_at ?? "" }))[0];
  const wanted = typed === null ? newest : logs.find((l) => resolve(target, l.path) === resolve(typed));
  if (!wanted) return { problem: `${typed} is not an evidence log of this folder's ${evidenceDir}` };
  if (wanted.digest !== "matches") return { problem: `the log ${basename(wanted.path)} is not one WolfBoy wrote on this computer as it now stands (${wanted.digest === "changed" ? "it changed since" : "this computer has no digest of it"}): decide records only against such a log, and a scan here writes one` };
  let doc: unknown;
  try {
    doc = JSON.parse(readRegularFile(resolve(target, wanted.path), "utf8"));
  } catch (e) {
    return { problem: `the log ${basename(wanted.path)} could not be read (${(e as Error).message})` };
  }
  const rows = listedOfLog(doc);
  if (rows === null) return { problem: `the log ${basename(wanted.path)} does not record what its report listed (it was written by an earlier build): run a scan, then decide` };
  const d = doc as Record<string, unknown>;
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof d.completed_at === "string" ? d.completed_at : "");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return {
    name: basename(wanted.path),
    sha256: wanted.sha256,
    scanId: typeof d.scan_id === "string" ? d.scan_id : "",
    day: day ? `${Number(day[3])} ${MONTHS[Number(day[2]) - 1]}` : basename(wanted.path),
    latest: wanted === newest,
    rows,
    verdictIds: idsOf(d.verdicts),
    unadjudicatedIds: idsOf(d.unadjudicated),
  };
}

/** This folder's numbers: the state folder's list where it reads, else the numbers the log recorded. */
export function numbersFor(stateDir: string | null, target: string, logPath: string): Map<string, number> {
  const got = readStateRecord(stateDir, target, NUMBER_LIST_KIND);
  if (got.read) {
    const list = parseNumberList(got.text);
    if (list.ok) return new Map([...list.byId].map(([id, e]) => [id, e.n] as const));
  }
  try {
    return numbersOfLog(JSON.parse(readRegularFile(logPath, "utf8")));
  } catch {
    return new Map();
  }
}

function lineOfLists(batch: Batch): string[] {
  return [...new Set(batch.take.flatMap((t) => t.rows.map((r) => LIST_WORDS[r.list])))];
}

/** Record the batch the person answered "Record" to; one sentence where the state folder refuses it. */
function recordBatch(stateDir: string | null, target: string, batch: Batch, log: DecideLog, batchId: string, numberOf: ReadonlyMap<string, number>, rerender?: DecideDeps["rerender"]): { code: number; lines: string[] } {
  const kept = appendStateRecord(stateDir, target, DECISIONS_RECORD, entryLines(batch, log, batchId, new Date()));
  if (!kept.written) return { code: 1, lines: [DECISION_WORDS.refusedPlace(kept.why, kept.placeRefused === true)] };
  const deciding = batch.take.filter((t) => t.kind !== "withdrawn");
  const withdrawn = batch.take.filter((t) => t.kind === "withdrawn");
  const fOf = (t: TakenItem): string => labelOf(t.handle, t.rows, numberOf).split(" ")[0] as string;
  const out: string[] = [];
  /* The report already written changes with the decisions (design 3.4, mock M10);
   * the reply says what it now shows, or, in one sentence, why it was not changed. */
  let shown: Rerender | null = null;
  if (rerender) {
    const now = readDecisionRecord(stateDir, target);
    shown = now.ok ? rerender(target, stateDir, now) : { done: false, why: `your decisions for this folder could not be read back (${now.why})` };
  }
  if (shown?.done) {
    const shownDone = shown;
    const under = deciding.filter((t) => t.rows.every((r) => shownDone.decidedEntry(r.finding_id)));
    const inList = deciding.filter((t) => !under.includes(t));
    if (under.length > 0) out.push(DECISION_WORDS.recordedShown(under.map(fOf), lineOfLists({ ...batch, take: under })));
    if (inList.length > 0) out.push(DECISION_WORDS.recordedInList(inList.map(fOf)));
    if (withdrawn.length > 0) out.push(DECISION_WORDS.withdrawnShown(withdrawn.map(fOf)));
    if (shown.logName !== log.name) out.push(DECISION_WORDS.olderKept(log.day));
  } else {
    if (deciding.length > 0) out.push(DECISION_WORDS.recorded(deciding.map(fOf), lineOfLists({ ...batch, take: deciding })));
    if (withdrawn.length > 0) out.push(DECISION_WORDS.withdrawnDone(withdrawn.map(fOf)));
    if (shown && !shown.done) out.push(DECISION_WORDS.notShown(shown.why));
  }
  if (batch.refused.length > 0) out.push(`The ${batch.refused.length === 1 ? "finding" : `${batch.refused.length} findings`} not recorded ${batch.refused.length === 1 ? "is" : "are"} noted in the same record, with why.`);
  return { code: 0, lines: out };
}

/** `legal-scan decide`: the whole command, after the words are read. Returns the exit code and the lines to print. */
export async function runDecide(words: readonly string[], deps: DecideDeps, stateDir: string | null = processStateDir()): Promise<{ code: number; lines: string[] }> {
  const got = requestsOf(words);
  if ("problem" in got) return { code: 2, lines: [`decide: ${got.problem}.`] };
  const path = deps.pathOf();
  if (path === "ci") return { code: 1, lines: [DECISION_WORDS.ci] };
  let target: string;
  try {
    target = realpathSync(resolve(got.target));
  } catch {
    return { code: 2, lines: [`decide: ${got.target} is not a folder.`] };
  }
  const launchDir = join(target, LEGAL_DIR_NAME, "launch");
  // Design 3.4: refused while a scan or run is under way here; nothing here is written or removed. A run is under way
  // while its marker stands; a scan before its run, while its window is open in the declaration ledger, which run-abort
  // closes for a scan that never reached a run (hook-question.ts `scanWindowOpen`). The scan-under-way marker is not
  // the test: run-abort leaves it standing in that case (hook.ts), and it would then refuse every decision here until
  // some later run ended. Each refusal names run-abort as the person types it.
  let underWay: boolean;
  try {
    underWay = existsSync(join(launchDir, ACTIVE_RUN_MARKER)) || scanWindowOpen(launchDir, latestRunEndAt(launchDir));
  } catch (e) {
    return { code: 1, lines: [DECISION_WORDS.underWayUnread((e as Error).message)] };
  }
  if (underWay) return { code: 1, lines: [DECISION_WORDS.underWay(abortCommand(launchDir))] };
  const record = readDecisionRecord(stateDir, target);
  if (!record.ok) return { code: 1, lines: [DECISION_WORDS.unreadable(record.why)] };
  const log = chooseLog(target, got.log, stateDir);
  if ("problem" in log) return { code: 1, lines: [`decide: ${log.problem}. ${DECISION_WORDS.nothingRecorded}`] };
  const numberOf = numbersFor(stateDir, target, join(target, LEGAL_DIR_NAME, EVIDENCE_DIR_NAME, log.name));
  const batch = planBatch(got.requests, log, numberOf, record.entries);
  if (batch.take.length === 0) {
    return { code: 1, lines: [...batch.refused.map((r) => `${DECISION_WORDS.notRecorded} ${r.label} ${r.why}.`), DECISION_WORDS.nothingRecorded] };
  }
  const { question, valueByLabel } = decideQuestion(batch, log, numberOf);
  if (path === "session") {
    if (got.fromAnswer) {
      const t = takeConfirmation(launchDir, { purpose: DECIDE_PURPOSE, about: batch.about });
      if ("refused" in t) return { code: 1, lines: [`decide --from-answer: ${t.refused}. ${DECISION_WORDS.nothingRecorded}`] };
      const done = t.value === "record" ? recordBatch(stateDir, target, batch, log, t.id, numberOf, deps.rerender) : { code: 0, lines: [DECISION_WORDS.nothingRecorded] };
      markConfirmationUsed(launchDir, t, new Date(), t.value === "record" && done.code === 0 ? "decide, which recorded the decisions" : "decide, which recorded nothing");
      return done;
    }
    let written: { path: string; input: Record<string, unknown> };
    try {
      written = writeConfirmationQuestion(launchDir, { purpose: DECIDE_PURPOSE, about: batch.about, question, valueByLabel }, new Date(), deps.sessionId());
    } catch (e) {
      return { code: 1, lines: [`decide: the question could not be written (${(e as Error).message}). ${DECISION_WORDS.nothingRecorded}`] };
    }
    return {
      code: 0,
      lines: [
        `To ask the person, ${PASS_EXACTLY}, alone in its call and with every character as it is - copy the line below whole; do not re-word, shorten or re-type any of it. The scanner's hook compares it with ${written.path} character by character and records the answer:`,
        ...askInputLines(written.input, dirname(launchDir)),
        "Then run this decide command again exactly as it was run, with --from-answer added: the program takes the answer only from the hook's record, and records the decisions only where the person chose to record them.",
      ],
    };
  }
  if (path === "terminal") {
    const asker = new TerminalAsker();
    try {
      const label = await asker.one(1, 1, question.header, question.question, null, question.options);
      if (label === null || valueByLabel[label] !== "record") return { code: 0, lines: [DECISION_WORDS.nothingRecorded] };
      const id = createHash("sha256").update(`${batch.about}\u0000${new Date().toISOString()}`).digest("hex").slice(0, 16);
      return recordBatch(stateDir, target, batch, log, id, numberOf, deps.rerender);
    } finally {
      asker.close();
    }
  }
  return { code: 1, lines: [DECISION_WORDS.noTerminal] };
}

/** Register `legal-scan decide`. Its words are read in order, so each kind takes the findings and the reason after it. */
/** Every flag `requestsOf` reads, as `decide --help` lists it (never parsed by commander). */
const DECIDE_FLAGS: ReadonlyArray<readonly [string, string]> = [
  ["--keep <findings...>", "these stay as they are (F-numbers or short ids)"],
  ["--misread <findings...>", "the review misread the code; the reason says what the code does"],
  ["--counsel <findings...>", "counsel's answer, given as the reason"],
  ["--withdraw <findings...>", "forget your decision on these"],
  ["--reason <text>", "your words, for the kind before it"],
  ["--until <date>", "an end date (YYYY-MM-DD) for the kind before it; 12 months when not given"],
  ["--log <evidence log>", "the log the decisions are recorded against (default: the latest in this folder)"],
  ["--target <folder>", "the scanned folder (default: the current folder)"],
  ["--from-answer", "take the person's answer to the question the first run wrote"],
];

export function registerDecide(program: Command, deps: DecideDeps): void {
  program
    .command("decide")
    .description(
      'Record your own decision about findings, in this folder on this computer only: --keep (stays as it is), --misread (the review misread the code: what the code does), --counsel (counsel\'s answer) or --withdraw, each followed by F-numbers or short ids and --reason "<your words>". One question asks before anything is kept; no count changes.',
    )
    .argument("[words...]", "--keep|--misread|--counsel|--withdraw <findings...> [--reason <text>] [--until YYYY-MM-DD] ... [--log <evidence log>] [--target <folder>] [--from-answer]")
    .allowUnknownOption(true)
    // The words are read by `requestsOf`, in order, because a reason belongs to the kind before it ("--keep F11 F12
    // --reason ... --misread F9 --reason ..."), which declared options would merge. Help lists them as options all the
    // same, so that `decide --help` names every flag the command reads (test:skill-cli-names reads the table from it).
    .configureHelp({ visibleOptions: (cmd: Command) => [...DECIDE_FLAGS.map(([flags, what]) => new Option(flags, what)), ...new Help().visibleOptions(cmd)] })
    .helpOption("-h, --help")
    .action(async (_words: string[], _opts: unknown, cmd: Command) => {
      const r = await runDecide(cmd.args, deps);
      for (const l of r.lines) console.log(l);
      process.exitCode = r.code;
    });
}
