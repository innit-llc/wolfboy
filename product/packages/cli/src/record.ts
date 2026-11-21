/**
 * THE RECORD A PERSON SHOWS SOMEONE (delivery design rf11, 3.7 and 3.8; mock M14).
 *
 * `record` writes `record.md`, `record.html` and `summary.json` from one evidence log: its `summary` (the counts, what was
 * not checked and the findings that stand, which the assembly made from the report's own model, so the record cannot
 * show another number), its provenance fields (bundle, model, whose answers, the comparison), and the person's
 * decisions and deeper checks for this folder on this computer, each read through one function (`recordSourcesFor`).
 * Both pages come from one list of blocks (`recordBlocks`): the Markdown file wraps its prose at 80 columns, and the
 * HTML page escapes every text, holds no script and loads nothing (a Content-Security-Policy meta of
 * `default-src 'none'; style-src 'unsafe-inline'`). The log is refused where this computer recorded another digest for
 * it (A4's record): a log changed since WolfBoy wrote it makes no record.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { dayWords, formMarkdown, localDayOfInstant, reviewWords, writeBothOrNeither, type ReviewRow } from "./assemble-report.js";
import { gitRunnerOrWhy } from "./child-program.js";
import { redactPrintedText, redactStringsInPlace, type PrintedRedaction } from "./credential-redaction.js";
import { productPrintedRedaction } from "./engine.js";
import { readNamedFile } from "./program-file.js";
import { basisRowsOf, comparisonOf, goneRowsOf, type ChangeClass } from "./comparison.js";
import { DIGEST_WORDS, digestMarkOf, readLogDigests } from "./log-digest.js";
import { commandSessions } from "./plugin-sessions.js";
import { laterComparisonOf } from "./later-run.js";
import { checksFoundNothing, group } from "./progress.js";
import { readRegularFile } from "./project-read.js";
import { markdownCode, markdownText, md, ours, inertJoin, inertLines, inertRedacted, inertCell, programText, type Inert } from "./printed-output.js";
import { codeSpan, codeSpanParts, codeSpanTexts } from "./report-form.js";
import { lawMark, lawMarksResolved, type LawNames } from "./law-names.js";
import { decisionViewOf, listedOfLog, readDecisionRecord } from "./decisions.js";
import { deeperChecksForRecord } from "./deepen.js";
import { processStateDir } from "./start-record.js";

/** One finding that stands, as the record lists it on page 2: no code line, no link. */
/** A text as the program wrote it: its own words, and each law it names by its id (the log's `laws_named`, `title_named`, `area_named`). */
export type LawNamed = (string | { law: string })[];

export interface RecordItem {
  f: string;
  short: string;
  finding_ids: string[];
  title: string;
  place: string;
  more_places: number;
  provisions: string[];
  disposition: "to_fix" | "to_clarify" | "to_answer";
  level: string;
  area: string;
  /** `title` and `area` with each law the program named by its id; absent where none is, and from a log written before 0.1.1. */
  title_named?: LawNamed;
  area_named?: LawNamed;
}

/** The evidence log's `summary` (evidence-log.schema.json), written by the assembly (`recordSummaryOf`). */
export interface RecordSummary {
  project: string;
  completed_at: string;
  code: { commit: string | null; commit_date?: string; tree_changed?: boolean; commit_why?: string; files_read: number | null; rules: number | null };
  review: { once: boolean; second_looks: number };
  counts: {
    needs_action: number;
    to_fix: number;
    high: number;
    medium: number;
    low: number;
    to_clarify: number;
    to_answer: number;
    questions: number;
    /** Absent from a log written before 0.1.1. */
    facts?: number;
    taken_off: number;
    ruled_out: number;
    out_of_scope: number;
    set_aside: number;
    not_counted: number;
  };
  not_checked: { no_verdict: number; partly: number; rules_nothing: number; carried: number; folders: string[]; not_read: string[] };
  laws: string[];
  /** The report's law names; absent from a log written before 0.1.1. */
  law_names?: Record<string, string>;
  /** `laws` with each law the program names by its id; absent from a log written before 0.1.1. */
  laws_named?: LawNamed[];
  items: RecordItem[];
}

/**
 * One decision as page 2 prints it (design 3.7 item 6, 3.4). THE INTERFACE EXPECTED OF UNIT B3's READER: B3 keeps the
 * decisions in the state folder (`DECISIONS_RECORD`); the integrator makes `recordSourcesFor` return them in this form.
 */
export interface RecordDecision {
  /** The finding it is about, matched against the items' `finding_ids`. */
  finding_id: string;
  kind: "keep" | "misread" | "counsel" | "withdrawn";
  /** When it was made, ISO 8601. */
  date: string;
  /** When it ends, ISO 8601, or null for no end date. */
  ends: string | null;
  /** The reason as the person gave it, or null where none was given. */
  reason: string | null;
  /** Whether the finding is still counted in its row (design 3.4: a decision moves no count). */
  still_counted: boolean;
  /** The counsel mark, where design 3.4 puts it. */
  counsel_mark: boolean;
}

/** One deeper check of a finding that stands (design 3.9, wave D): what was run and the level it found beside the review's. */
export interface RecordDeepCheck {
  finding_id: string;
  date: string;
  what_ran: string;
  level_found: string;
  level_review: string;
}

/**
 * The calendar day of an instant on this computer's
 * clock, as `YYYY-MM-DD`. "Prepared" printed the instant's UTC day, a day off the person's own date for part of every day
 * east or west of UTC. The record is made when the person asks for it, on their computer, so its day is theirs; a value
 * that is not an instant is returned as it is.
 */
export function localDayOf(iso: string): string {
  // One function with the report's.
  return localDayOfInstant(iso);
}
/**
 * EVERY DAY THE RECORD WRITES, ONE FUNCTION: the local
 * day of an instant (`localDayOf`) in the report's words (`dayWords`). Only "Prepared" was local, so a record made in
 * California at 21:00 read "Prepared 14 Nov" above answers "given … 15 Nov" (UTC). A value that is a day already is said as
 * it is. The laws line is the report's own words (`summary.laws`), with the report's day.
 */
const day = (iso: string): string => dayWords(localDayOf(iso));

/** Each part of page 2 that is not the log's, read through one function; null means its source is absent. */
export interface RecordSources {
  decisions: () => RecordDecision[] | null;
  deeperChecks: () => RecordDeepCheck[] | null;
}

/**
 * The sources for `target` on this computer. Deeper checks are the person's record of them (deepen.ts, wave D). Decisions are the person's record (decisions.ts) read against the log's own
 * listing (`listed`), with the states the report computes (`decisionViewOf`, on the log's day, as the assembly and
 * `decide`'s re-render do): one entry per finding id whose whole entry is under "Decided by you" in that log's report, so
 * page 1's "decided by you" counts are the first screen's and page 2 lists the same findings. A log with no listing, or
 * a record that cannot be read, gives none.
 */
export function recordSourcesFor(stateDir: string | null, target: string, log: unknown = null): RecordSources {
  return {
    decisions: () => {
      const rows = listedOfLog(log);
      if (rows === null) return null;
      const record = readDecisionRecord(stateDir, target);
      if (!record.ok) return null;
      const at = o(log)?.completed_at;
      const view = decisionViewOf(record, rows, typeof at === "string" ? at.slice(0, 10) : "");
      const applied = (id: string): boolean => view.stateOf.get(id)?.state === "applied";
      const out: RecordDecision[] = [];
      for (const r of rows) {
        if ((r.list !== "to_fix" && r.list !== "to_clarify") || !rows.filter((x) => x.group === r.group).every((x) => applied(x.finding_id))) continue;
        const e = view.stateOf.get(r.finding_id)?.entry;
        if (!e || e.kind === "refused" || e.kind === "withdrawn") continue;
        out.push({ finding_id: r.finding_id, kind: e.kind, date: e.at, ends: e.until ?? null, reason: e.reason ?? null, still_counted: true, counsel_mark: true });
      }
      return out;
    },
    // The deeper checks of findings that stand (design 3.7 page 2, 3.9): read from the
    // person's record of the checks (deepen.ts), each completed check with what ran and the level beside the review's.
    deeperChecks: () => {
      const rows = listedOfLog(log);
      if (rows === null) return null;
      const standing = new Set(rows.filter((r) => r.list === "to_fix" || r.list === "to_clarify" || r.list === "to_answer").map((r) => r.finding_id));
      return deeperChecksForRecord(stateDir, target, standing);
    },
  };
}

/** Every sentence the record prints. */
export const RECORD_WORDS = {
  title: (project: string) => `Compliance scan record · ${project}`,
  firstLine: "Made on the team's own computer; nothing outside it confirms that WolfBoy made this record.",
  firstLineRest: (version: string) =>
    `Made with WolfBoy ${version}. The digests at the end tie it to the evidence log the team can hand over, not to an unmodified program.`,
  prepared: (day: string) => `Prepared ${day} for: ______________ · by: ______________ (both filled in by the team)`,
  examined: "What was examined",
  code: (what: string, files: number | null, rules: number | null, bundle: string) =>
    `Code: ${what}${files !== null ? `, ${group(files)} ${files === 1 ? "file" : "files"} read` : ""}; ${rules !== null ? `${group(rules)} ${rules === 1 ? "rule" : "rules"}, ` : ""}bundle ${bundle}.`,
  commit: (project: string, short: string, day: string, changed: boolean) =>
    `repository ${project}, commit ${short}${day ? ` (${day})` : ""}${changed ? ", with changes to tracked files not committed" : ""}`,
  noCommit: (project: string, why: string) => `the folder ${project}, not tied to a commit (${why})`,
  answers: (whose: string, list: string) => `Answers about the product: ${whose}.${list ? ` ${list}.` : ""}`,
  whoseOwn: (day: string) => `given on the computer that made this record${day ? `, ${day}` : ""}`,
  whoseTeam: (saved: string, commit: string | null, author: string | null, confirmed: string) =>
    `the team's answers${saved ? ` of ${saved}` : ""}, saved in the repository${commit ? ` (commit ${commit}${author ? `; the author as git records it, which is information, not proof of who answered: ${author}` : ""})` : ""}; confirmed on the computer that made this record${confirmed ? ` on ${confirmed}` : ""}`,
  whoseFile: (file: string) => `read from ${file ? `the file ${file}` : "a file"} as given`,
  whoseNone: (why: string) => `none were used (${why})`,
  whoseUnrecorded: "this evidence log does not record whose answers the scan used",
  noneReason: {
    "no-saved-answers": "no answers were saved",
    "not-usable": "the saved answers could not be used",
    "not-confirmed-here": "the saved answers were not confirmed on this computer",
    "not-now": "the person chose not to use them",
  } as Record<string, string>,
  /** `review`: assemble-report.ts `reviewWords`, from the log's rows. */
  how: (model: string, effort: string, except: string[], review: string, looks: number) =>
    `How: one AI review (${model}${effort ? `, effort ${effort}` : ""}), in the team's own environment, of every matched place${except.length > 0 ? ` except ${except.join(" and ")} (${except.length > 1 ? "both " : ""}under Results)` : ""}; ${review}${looks > 0 ? `; ${group(looks)} ${looks === 1 ? "finding" : "findings"} the review set aside on its own word ${looks === 1 ? "was" : "were"} looked at again` : ""}.`,
  exceptScope: (n: number) => `the ${group(n)} out of scope by the answers`,
  exceptAside: (n: number) => `the ${group(n)} set aside by the scanner`,
  laws: (parts: string[]) => `Laws: ${parts.join(" · ")}.`,
  notChecked: "Not checked",
  // The checks that found nothing in
  // the sentence every surface prints (it said "N rules found nothing, which does not mean their duties are met").
  ncCounts: (places: number, partly: number, rules: number) =>
    `Places without a verdict: ${group(places)} · findings the AI read only in part: ${group(partly)} · ${checksFoundNothing(rules)}.`,
  ncNotRead: (folders: string[], rest: string[]) =>
    `Not read: ${[folders.length > 0 ? `the ${folders.length === 1 ? "folder" : "folders"} ${listWords(folders)}` : "", ...rest].filter(Boolean).join("; ") || "nothing"}.`,
  ncFolderCount: (n: number) => `${group(n)} ${n === 1 ? "folder" : "folders"}`,
  ncPolicy: "The privacy policy was not compared with the code (WolfBoy compares them in a separate run, not part of this record).",
  /** Dated by the reviews, as changes.md is. */
  ncCarried: (n: number, from: string, oldest: string, unknown: number) =>
    `${group(n)} ${n === 1 ? "verdict was" : "verdicts were"} carried${from ? ` from the review of ${from}` : " from an earlier review"}, not re-read; ${
      oldest
        ? `the oldest review among them was on ${oldest}.${unknown > 0 ? ` For ${group(unknown)} of them the log they were carried from does not record when ${unknown === 1 ? "it was" : "they were"} reviewed.` : ""}`
        : `when ${n === 1 ? "it was" : "they were"} reviewed is not recorded.`
    }`,
  /** Page 1, under the first line. */
  logNotConfirmed: (name: string, mark: "none" | "unread") =>
    mark === "none"
      ? `Not confirmed: this computer kept no digest of the evidence log this record was made from (${name}), so WolfBoy cannot say who wrote that log or whether it was changed.`
      : `Not confirmed: the record of the logs WolfBoy wrote could not be read, so whether the evidence log this record was made from (${name}) changed since WolfBoy wrote it is not known.`,
  results: "Results",
  needs: (n: number) => `Needs action: ${group(n)}`,
  needsRest: " · to fix",
  levels: (n: number, h: number, m: number, l: number) => `${group(n)} (${group(h)} high, ${group(m)} medium, ${group(l)} low)`,
  clarify: "· to clarify (a point of law, or code the AI could not read)",
  // A finding to answer waits on a question or on a fact to check, which is not a question.
  answer: "· to answer (a question about the product, or a fact to check outside the code)",
  taken: (n: number) => `Taken off the list: ${group(n)}`,
  // The report's name for it, "judged not a problem" ("ruled out" named it a second way).
  takenRest: " · judged not a problem by one AI review each, which can miss a real problem",
  scope: "· out of scope by the answers about the product",
  aside: "· set aside by the scanner, not reviewed",
  notCounted: "· not counted (already met, not shipped, for operators, same as another)",
  decidedHead: "Decided on the computer that made this record:",
  /* Words */
  decidedIn: (n: number) => `${group(n)} decided by you`,
  decidedNone: "none.",
  decided: (n: number, counted: number, parts: string[]) =>
    `${group(n)}, ${counted === n ? (n === 1 ? "still counted" : "all still counted") : `${group(counted)} still counted`}: ${parts.join(", ")}; reasons on page 2.`,
  decidedPart: (n: number, disposition: string, kind: string) => `${group(n)} ${disposition} ${kind}`,
  kindWords: { keep: "kept as they are", misread: "marked as misread", counsel: "with counsel's answer", withdrawn: "withdrawn" } as Record<string, string>,
  counselAdvice: "Review by qualified counsel recommended on every finding to clarify and every decided one.",
  deeper: (n: number | null) => `Deeper checks of findings that stand: ${n === null || n === 0 ? "none" : group(n)}.`,
  sinceHead: (day: string) => (day ? `Since the review of ${day}:` : "Since the earlier review:"),
  since: (up: number, lower: number, gone: number, ruled: number, decisions: number | null) =>
    `new or higher ${group(up)} · lower or gone ${group(lower + gone + ruled)}${gone + ruled > 0 ? ` (${[gone > 0 ? `${group(gone)} gone, which is not the same as fixed` : "", ruled > 0 ? `${group(ruled)} now judged not a problem` : ""].filter(Boolean).join("; ")})` : ""}${decisions !== null && decisions > 0 ? ` · ${group(decisions)} ${decisions === 1 ? "decision" : "decisions"} recorded` : ""}.`,
  sinceNoHead: "Since an earlier review:",
  sinceNone: "this run was compared with none.",
  sinceNot: (why: string) => `not compared (${why}).`,
  cannotSee: "**What this record cannot see:** contracts, data-processing agreements, deployment settings, data flows at run time, and organisational measures.",
  redacted: "Values that the product's credential rule (baseline-002) recognises are not printed in this record: each is replaced by `[redacted:baseline-002#<clause>:<digest>]`.",
  digests: (commit: string | null, bundle: string, bundleSha: string, logSha: string) =>
    `${commit ? `Commit ${codeSpan(commit)} · ` : ""}bundle ${bundle}${bundleSha ? `, sha256 ${codeSpan(bundleSha)}` : ""} · evidence log sha256 ${codeSpan(logSha)}`,
  standHead: "Findings that stand, by area",
  standNone: "No finding stands in this record.",
  standCounts: "Counts by area only: this record was made without places or reasons.",
  areaCounts: (area: string, parts: string[]) => `${area}: ${parts.join(", ")}`,
  dispWords: { to_fix: "to fix", to_clarify: "to clarify", to_answer: "to answer" } as Record<string, string>,
  morePlaces: (n: number) => `and ${group(n)} more ${n === 1 ? "place" : "places"}`,
  decisionsHead: "Decisions",
  decisionsNone: "None recorded on the computer that made this record.",
  decisionLine: (d: RecordDecision, title: string, short: string, reason: string | null) =>
    `${RECORD_WORDS.kindName[d.kind] ?? d.kind}, ${day(d.date) || d.date}${d.ends ? `, ends ${day(d.ends) || d.ends}` : ", no end date"}: ${title} (${short}). ${reason === null ? "" : `Reason: ${reason}. `}${d.still_counted ? "Still counted." : "Not counted."}${d.counsel_mark ? " Review by qualified counsel recommended." : ""}`,
  noReason: "no reason given",
  kindName: { keep: "Kept as it is", misread: "Marked as misread", counsel: "Counsel's answer", withdrawn: "Withdrawn" } as Record<string, string>,
  deepHead: "Deeper checks",
  deepNone: "None of the findings that stand.",
  deepLine: (c: RecordDeepCheck, title: string, short: string) =>
    `${day(c.date) || c.date}: ${title} (${short}). Ran: ${c.what_ran}. Level found: ${c.level_found}; the review's: ${c.level_review}.`,
  ruledHead: "Judged not a problem",
  ruled: (n: number) =>
    `${group(n)} ${n === 1 ? "finding was" : "findings were"} judged not a problem by one AI review each. The list is kept with the report on the computer that made this record (ruled-out.md), not in this record.`,
  findingGone: "a finding not in this record",
};

const listWords = (xs: readonly string[]): string => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** An inline run of text: plain, strong, or code. Every renderer escapes what it prints. */
export type Inline = string | { b: string } | { code: string };
/** The blocks both pages are made from (`recordBlocks`). */
export type Block =
  | { t: "h1" | "h2" | "h3"; text: string }
  | { t: "p"; parts: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "table"; rows: { label: Inline[]; count: string }[] }
  | { t: "page2" };

/** What `recordBlocks` is made from. */
export interface RecordInput {
  summary: RecordSummary;
  log: Record<string, unknown>;
  logSha256: string;
  version: string;
  preparedAt: string;
  countsOnly: boolean;
  since: SinceResult;
  decisions: RecordDecision[] | null;
  deeperChecks: RecordDeepCheck[] | null;
  /** Whether the printed redaction put a marker in the record (runRecord): page 1 then says what the marker is. */
  redacted?: boolean;
  /** A log this computer cannot confirm: page 1 says so. */
  logMark?: { name: string; mark: "none" | "unread" };
}

/** The since block's counts, from the log's own comparison or from `--since` (`sinceOf`). */
export type SinceResult =
  | { kind: "counts"; day: string; up: number; lower: number; gone: number; ruled: number; at: string | null }
  | { kind: "none" }
  | { kind: "not"; why: string };

const o = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const s = (v: unknown): string => (typeof v === "string" ? v : "");
/**
 * The log's verdict rows as `reviewWords` counts them: a
 * row to fix, whether it holds a refutation, whether it was carried from an earlier run.
 */
function reviewRowsOfLog(log: Record<string, unknown>): ReviewRow[] {
  const rows = Array.isArray(log.verdicts) ? (log.verdicts as unknown[]) : [];
  return rows.flatMap((r) => {
    if (!r || typeof r !== "object" || Array.isArray(r)) return [];
    const row = r as Record<string, unknown>;
    const ref = row.refutation;
    return [{ toFix: row.disposition === "to_fix", refuted: !!ref && typeof ref === "object" && !Array.isArray(ref), carried: s(row.carried_forward_from) !== "" }];
  });
}
const a = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Whose answers, in words (design 3.3; A3's `answers_used`), and the answers themselves where the log lists them. */
function answersLine(log: Record<string, unknown>, countsOnly: boolean): string {
  const u = o(log.answers_used);
  if (!u) return RECORD_WORDS.answers(RECORD_WORDS.whoseUnrecorded, "");
  const list = a(u.answers)
    .map(o)
    .filter((x): x is Record<string, unknown> => !!x)
    .map((x) => `${s(x.header)}: ${s(x.answer)}`);
  const shown = list.length > 6 ? [...list.slice(0, 6), `and ${group(list.length - 6)} more`] : list;
  const whose = s(u.whose);
  const commit = o(u.commit);
  const words =
    whose === "own"
      ? RECORD_WORDS.whoseOwn(day(s(u.saved_at)))
      : whose === "team"
        ? RECORD_WORDS.whoseTeam(day(s(u.saved_at)), commit ? s(commit.id).slice(0, 7) || null : null, commit ? s(commit.author) || null : null, day(s(u.confirmed_at)))
        : whose === "file"
          ? RECORD_WORDS.whoseFile(countsOnly ? "" : s(u.file))
          : RECORD_WORDS.whoseNone(RECORD_WORDS.noneReason[s(u.reason)] ?? "no reason recorded");
  return RECORD_WORDS.answers(words, shown.join(" · "));
}

/**
 * The review dates of the carried verdicts,
 * as changes.md reads them (later-run.ts): the comparison's carried rows and the basis rows' `reviewed_at`, passed log
 * to log. `oldest` is the oldest known day ("" where none is known); `unknown` counts those whose date is not recorded.
 */
function carriedReviewsOf(log: Record<string, unknown>): { oldest: string; unknown: number } {
  const c = laterComparisonOf(log.comparison);
  if (!c) return { oldest: "", unknown: 0 };
  const days = c.changes.filter((r) => r.carried).map((r) => c.reviewed.get(r.id) ?? null);
  const known = days.filter((d): d is string => d !== null && day(d) !== "").sort();
  return { oldest: known.length > 0 ? day(known[0] as string) : "", unknown: days.length - known.length };
}

/** The record's blocks: page 1 (design 3.7 items 1-7) and page 2. One generator for `record.md` and `record.html`. */
export function recordBlocks(r: RecordInput): Block[] {
  const { summary: sm, log } = r;
  const c = sm.counts;
  const nc = sm.not_checked;
  const bundle = o(log.bundle) ?? {};
  const out: Block[] = [{ t: "h1", text: RECORD_WORDS.title(sm.project) }];
  out.push({ t: "p", parts: [{ b: RECORD_WORDS.firstLine }, ` ${RECORD_WORDS.firstLineRest(r.version)}`] });
  if (r.logMark) out.push({ t: "p", parts: [RECORD_WORDS.logNotConfirmed(r.logMark.name, r.logMark.mark)] });
  out.push({ t: "p", parts: [RECORD_WORDS.prepared(day(r.preparedAt))] });
  // 3. What was examined.
  const code = sm.code.commit
    ? RECORD_WORDS.commit(sm.project, sm.code.commit.slice(0, 7), day(s(sm.code.commit_date)), sm.code.tree_changed === true)
    : RECORD_WORDS.noCommit(sm.project, sm.code.commit_why ?? "no commit was recorded");
  const except = [c.out_of_scope > 0 ? RECORD_WORDS.exceptScope(c.out_of_scope) : "", c.set_aside > 0 ? RECORD_WORDS.exceptAside(c.set_aside) : ""].filter(Boolean);
  out.push({ t: "h2", text: RECORD_WORDS.examined });
  out.push({
    t: "ul",
    items: [
      [RECORD_WORDS.code(code, sm.code.files_read, sm.code.rules, s(bundle.version) || "unnamed")],
      [answersLine(log, r.countsOnly)],
      [RECORD_WORDS.how(s(log.agent_model) || "model not recorded", s(log.agent_effort), except, reviewWords(sm.review.once, reviewRowsOfLog(log), "long"), sm.review.second_looks)],
      ...(sm.laws.length > 0 ? [[RECORD_WORDS.laws(lawPartsNamed(sm))]] : []),
    ],
  });
  // 4. Not checked, directly under it.
  const carriedFrom = day(s(o(o(log.comparison)?.earlier)?.completed_at));
  const reviews = carriedReviewsOf(log);
  const folders = r.countsOnly ? (nc.folders.length > 0 ? [RECORD_WORDS.ncFolderCount(nc.folders.length)] : []) : nc.folders;
  out.push({ t: "h2", text: RECORD_WORDS.notChecked });
  out.push({
    t: "ul",
    items: [
      [RECORD_WORDS.ncCounts(nc.no_verdict, nc.partly, nc.rules_nothing)],
      [r.countsOnly && nc.folders.length > 0 ? `Not read: ${[folders[0], ...nc.not_read].join("; ")}.` : RECORD_WORDS.ncNotRead(folders, nc.not_read)],
      [`${RECORD_WORDS.ncPolicy}${nc.carried > 0 ? ` ${RECORD_WORDS.ncCarried(nc.carried, carriedFrom, reviews.oldest, reviews.unknown)}` : ""}`],
    ],
  });
  // 5. Results, in the two groups of the screens, each led by its total.
  out.push({ t: "h2", text: RECORD_WORDS.results });
  const decided = r.decisions ?? [];
  const decidedOf = (disp: string) => decided.filter((d) => itemOf(sm, d.finding_id)?.disposition === disp).length;
  // "N decided by you" inside the same count, as the first screen says it (design 3.4).
  const withDecided = (n: number | string, disp: string) => `${typeof n === "number" ? group(n) : n}${decidedOf(disp) > 0 ? ` (${RECORD_WORDS.decidedIn(decidedOf(disp))})` : ""}`;
  out.push({
    t: "table",
    rows: [
      { label: [{ b: RECORD_WORDS.needs(c.needs_action) }, RECORD_WORDS.needsRest], count: withDecided(RECORD_WORDS.levels(c.to_fix, c.high, c.medium, c.low), "to_fix") },
      { label: [RECORD_WORDS.clarify], count: withDecided(c.to_clarify, "to_clarify") },
      { label: [RECORD_WORDS.answer], count: withDecided(c.to_answer, "to_answer") },
      { label: [{ b: RECORD_WORDS.taken(c.taken_off) }, RECORD_WORDS.takenRest], count: group(c.ruled_out) },
      ...(c.out_of_scope > 0 ? [{ label: [RECORD_WORDS.scope], count: group(c.out_of_scope) }] : []),
      ...(c.set_aside > 0 ? [{ label: [RECORD_WORDS.aside], count: group(c.set_aside) }] : []),
      ...(c.not_counted > 0 ? [{ label: [RECORD_WORDS.notCounted], count: group(c.not_counted) }] : []),
    ],
  });
  // 6. Decided, with the deeper checks as a count, in one paragraph; 7. since, what the record cannot see.
  const kinds = new Map<string, number>();
  for (const d of decided) {
    const disp = RECORD_WORDS.dispWords[itemOf(sm, d.finding_id)?.disposition ?? ""] ?? "";
    const key = `${disp}\u0000${d.kind}`;
    kinds.set(key, (kinds.get(key) ?? 0) + 1);
  }
  const decidedWords =
    decided.length === 0
      ? RECORD_WORDS.decidedNone
      : RECORD_WORDS.decided(
          decided.length,
          decided.filter((d) => d.still_counted).length,
          [...kinds].map(([key, n]) => {
            const [disp, kind] = key.split("\u0000") as [string, string];
            return RECORD_WORDS.decidedPart(n, disp || RECORD_WORDS.findingGone, RECORD_WORDS.kindWords[kind] ?? kind);
          }),
        );
  const deeperN = r.deeperChecks === null ? null : r.deeperChecks.filter((x) => itemOf(sm, x.finding_id)).length;
  out.push({ t: "p", parts: [{ b: RECORD_WORDS.decidedHead }, ` ${decidedWords} ${RECORD_WORDS.counselAdvice} ${RECORD_WORDS.deeper(deeperN)}`] });
  const since = r.since;
  if (since.kind === "counts") {
    const decisionsSince = since.at === null || r.decisions === null ? null : r.decisions.filter((d) => d.date > (since.at as string)).length;
    out.push({ t: "p", parts: [{ b: RECORD_WORDS.sinceHead(since.day) }, ` ${RECORD_WORDS.since(since.up, since.lower, since.gone, since.ruled, decisionsSince)}`] });
  } else out.push({ t: "p", parts: [{ b: RECORD_WORDS.sinceNoHead }, ` ${since.kind === "none" ? RECORD_WORDS.sinceNone : RECORD_WORDS.sinceNot(since.why)}`] });
  out.push({ t: "p", parts: plainBold(RECORD_WORDS.cannotSee) });
  if (r.redacted) out.push({ t: "p", parts: codeParts(RECORD_WORDS.redacted) });
  out.push({ t: "p", parts: codeParts(RECORD_WORDS.digests(sm.code.commit, s(bundle.version) || "unnamed", s(bundle.sha256), r.logSha256)) });
  out.push({ t: "p", parts: [s(log.disclaimer)] });
  // Page 2: the findings that stand, by area; each decision; each deeper check; the ruled-out count and where it is kept.
  out.push({ t: "page2" }, { t: "h2", text: RECORD_WORDS.standHead });
  const areas = [...new Set(sm.items.map((it) => it.area))];
  const areaNamed = (area: string): string => namedOr(area, sm.items.find((it) => it.area === area)?.area_named);
  if (sm.items.length === 0) out.push({ t: "p", parts: [RECORD_WORDS.standNone] });
  else if (r.countsOnly) {
    out.push({ t: "p", parts: [RECORD_WORDS.standCounts] });
    out.push({
      t: "ul",
      items: areas.map((area) => {
        const xs = sm.items.filter((it) => it.area === area);
        const parts = (["to_fix", "to_clarify", "to_answer"] as const)
          .map((d) => {
            const ys = xs.filter((it) => it.disposition === d);
            if (ys.length === 0) return "";
            const lv = d === "to_fix" ? ["high", "medium", "low"].map((l) => [l, ys.filter((y) => y.level === l).length] as const).filter(([, n]) => n > 0).map(([l, n]) => `${n} ${l}`) : [];
            return `${group(ys.length)} ${RECORD_WORDS.dispWords[d]}${lv.length > 0 ? ` (${lv.join(", ")})` : ""}`;
          })
          .filter(Boolean);
        return [RECORD_WORDS.areaCounts(areaNamed(area), parts)];
      }),
    });
  } else {
    for (const area of areas) {
      out.push({ t: "h3", text: areaNamed(area) });
      out.push({
        t: "ul",
        items: sm.items
          .filter((it) => it.area === area)
          .map((it): Inline[] => [
            { b: `${it.f} · ${titleNamed(it)}` },
            " · ",
            { code: it.place },
            `${it.more_places > 0 ? ` ${RECORD_WORDS.morePlaces(it.more_places)}` : ""}${it.provisions.length > 0 ? ` · ${it.provisions.join(", ")}` : ""} · ${RECORD_WORDS.dispWords[it.disposition]}${it.disposition === "to_fix" ? `, ${it.level}` : ""} · `,
            { code: it.short },
          ]),
      });
    }
  }
  out.push({ t: "h2", text: RECORD_WORDS.decisionsHead });
  if (decided.length === 0) out.push({ t: "p", parts: [RECORD_WORDS.decisionsNone] });
  else
    out.push({
      t: "ul",
      // One line per decided entry: a group's places, decided in one batch, share it.
      items: [
        ...new Map(
          decided.map((d) => {
            const it = itemOf(sm, d.finding_id);
            const line = RECORD_WORDS.decisionLine(d, it ? titleNamed(it) : RECORD_WORDS.findingGone, it?.short ?? d.finding_id, r.countsOnly ? null : (d.reason ?? RECORD_WORDS.noReason));
            return [`${it?.short ?? d.finding_id}\u0000${line}`, [line] as Inline[]] as const;
          }),
        ).values(),
      ],
    });
  out.push({ t: "h2", text: RECORD_WORDS.deepHead });
  const deep = (r.deeperChecks ?? []).filter((x) => itemOf(sm, x.finding_id));
  if (deep.length === 0) out.push({ t: "p", parts: [RECORD_WORDS.deepNone] });
  else out.push({ t: "ul", items: deep.map((x) => [RECORD_WORDS.deepLine(x, ((it) => (it ? titleNamed(it) : ""))(itemOf(sm, x.finding_id)), itemOf(sm, x.finding_id)?.short ?? "")]) });
  out.push({ t: "h2", text: RECORD_WORDS.ruledHead }, { t: "p", parts: [RECORD_WORDS.ruled(c.ruled_out)] });
  return blocksLawNamed(out, sm.law_names ?? {});
}

/**
 * The laws line's parts as the program wrote them (`summary.laws_named`), each law it
 * names by its id (law-names.ts `lawMark`); a log without them (before 0.1.1), or whose parts do not match `laws`, gives
 * `laws` as written.
 */
function lawPartsNamed(sm: RecordSummary): string[] {
  const named = sm.laws_named;
  if (!Array.isArray(named) || named.length !== sm.laws.length) return sm.laws;
  return sm.laws.map((kept, i) => namedOr(kept, named[i]));
}
/** A text the log keeps as written (`kept`) where the program named a law in it, from its named form: each law by its id (`lawMark`). Taken only where it is the kept text with each law by its short name; otherwise the kept text. */
function namedOr(kept: string, named: unknown): string {
  if (!Array.isArray(named)) return kept;
  const parts = named.map((x: unknown) => (typeof x === "string" ? x : x && typeof x === "object" && typeof (x as { law?: unknown }).law === "string" ? { law: (x as { law: string }).law } : null));
  if (parts.some((x) => x === null)) return kept;
  const short = parts.map((x) => (typeof x === "string" ? x : (x as { law: string }).law)).join("");
  return short === kept ? parts.map((x) => (typeof x === "string" ? x : lawMark((x as { law: string }).law))).join("") : kept;
}

/**
 * The record's pages name each law the program names in full at its first mention, short
 * after, as the report's do: the marks of the blocks (`lawPartsNamed`, `areaMarkedOf`) resolved in reading order by the
 * one tracker (law-names.ts `lawMarksResolved`), before either page is written from them. Nothing else in a block is read:
 * a finding's title, a provision as the bundle carries it, a place or the project's name is never renamed.
 */
function blocksLawNamed(blocks: readonly Block[], names: LawNames): Block[] {
  const texts: string[] = [];
  const add = (text: string): void => void texts.push(text);
  const inline = (xs: readonly Inline[]): void => xs.forEach((x) => (typeof x === "string" ? add(x) : "b" in x ? add(x.b) : add(x.code)));
  for (const b of blocks) {
    if (b.t === "h1" || b.t === "h2" || b.t === "h3") add(b.text);
    else if (b.t === "p") inline(b.parts);
    else if (b.t === "ul") b.items.forEach(inline);
    else if (b.t === "table") b.rows.forEach((row) => (inline(row.label), add(row.count)));
  }
  const named = lawMarksResolved(texts, names);
  let k = 0;
  const next = (): string => named[k++] ?? "";
  const back = (xs: readonly Inline[]): Inline[] => xs.map((x) => (typeof x === "string" ? next() : "b" in x ? { b: next() } : { code: next() }));
  return blocks.map((b): Block => {
    if (b.t === "h1" || b.t === "h2" || b.t === "h3") return { t: b.t, text: next() };
    if (b.t === "p") return { t: "p", parts: back(b.parts) };
    if (b.t === "ul") return { t: "ul", items: b.items.map(back) };
    if (b.t === "table") return { t: "table", rows: b.rows.map((row) => ({ label: back(row.label), count: next() })) };
    return b;
  });
}

/** An item's title with each law the program named in it by its id (`namedOr`). */
const titleNamed = (it: RecordItem): string => namedOr(it.title, it.title_named);
const itemOf = (sm: RecordSummary, id: string): RecordItem | undefined => sm.items.find((it) => it.finding_ids.includes(id));

/** "**x:** rest" as parts. */
function plainBold(text: string): Inline[] {
  const m = /^\*\*(.+?)\*\*(.*)$/.exec(text);
  return m ? [{ b: m[1] as string }, m[2] as string] : [text];
}

/** Text with `code` spans (as `codeSpan` makes them, paired as CommonMark pairs them: `codeSpanParts`) as parts. */
function codeParts(text: string): Inline[] {
  return codeSpanParts(text)
    .map((x, i): Inline => (i % 2 === 1 ? { code: codeSpanTexts(x)?.[0] ?? x } : x))
    .filter((x) => x !== "");
}

/** The record's Markdown: one line per block, wrapped at 80 by the report's own form pass (design 3.1.1, 3.7). */
export function recordMarkdown(blocks: readonly Block[], net?: (text: string) => string): Inert {
  /* Every line is `Inert`: text through `mdText`, a code quotation through
   * `markdownCode`, the rest the program's own (`md`, `ours`), so a block's raw value cannot reach the file. */
  const inline = (parts: readonly Inline[]): Inert =>
    inertJoin(parts.map((p) => (typeof p === "string" ? mdText(p) : "b" in p ? md`**${mdText(p.b)}**` : markdownCode(p.code))), ours(""));
  const lines: Inert[] = [];
  for (const b of blocks) {
    if (b.t === "h1") lines.push(md`# ${mdText(b.text)}`, ours(""));
    else if (b.t === "h2") lines.push(md`## ${mdText(b.text)}`, ours(""));
    else if (b.t === "h3") lines.push(md`### ${mdText(b.text)}`, ours(""));
    else if (b.t === "p") lines.push(inline(b.parts), ours(""));
    else if (b.t === "ul") lines.push(...b.items.map((it) => md`- ${inline(it)}`), ours(""));
    else if (b.t === "table") lines.push(ours("| | Count |"), ours("|---|--:|"), ...b.rows.map((row) => md`| ${inertCell(inline(row.label))} | ${mdText(row.count)} |`), ours(""));
    else lines.push(ours("---"), ours(""));
  }
  // The printed redaction reads the lines as composed, before the wrap (as the report's, assemble-report.ts `composedNet`).
  return formMarkdown(net ? inertLines(inertRedacted(inertJoin(lines, ours("\n")), net)) : lines, RECORD_WIDTH);
}

/** The width the record's prose is wrapped at (design 3.7: as every report file's, 80 for the raw view). */
export const RECORD_WIDTH = 80;

/**
 * Plain text for Markdown: `markdownText` (printed-output.ts), the one function for a value in a report file. A run of four or more underscores is a blank to fill in, which Markdown
 * prints as it is.
 */
function mdText(t: string): Inert {
  /* A run of underscores opens no link, image or HTML element: `programText` here is that claim. */
  return inertJoin(
    t.split(/(_{4,})/).map((x, i) => (i % 2 === 1 ? programText(x) : markdownText(x))),
    ours(""),
  );
}

/** Every text that reaches the HTML page, escaped: a path or a reason can hold `<script>`. */
export function htmlText(t: string): string {
  return t.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}

/**
 * The record's HTML page (design 3.7; R10): one static page with A4 print styles that the person saves with the browser's
 * own Print, Save as PDF. No script, nothing loaded: a Content-Security-Policy meta of `default-src 'none';
 * style-src 'unsafe-inline'`, no link, no image, no font. The first line and the disclaimer are in a header and a footer
 * of fixed position, which CSS 2.1 (9.6.1) repeats on every page of paged media; a layout table's head and foot keep
 * their room on every page, so no text runs under them. Not rendered in a browser here (design section 13).
 */
export function recordHtml(blocks: readonly Block[], firstLine: string, disclaimer: string, title: string): string {
  const h = (parts: readonly Inline[]): string =>
    parts.map((p) => (typeof p === "string" ? htmlText(p) : "b" in p ? `<strong>${htmlText(p.b)}</strong>` : `<code>${htmlText(p.code)}</code>`)).join("");
  const body: string[] = [];
  for (const b of blocks) {
    if (b.t === "h1" || b.t === "h2" || b.t === "h3") body.push(`<${b.t}>${htmlText(b.text)}</${b.t}>`);
    else if (b.t === "p") body.push(`<p>${h(b.parts)}</p>`);
    else if (b.t === "ul") body.push(`<ul>${b.items.map((it) => `<li>${h(it)}</li>`).join("")}</ul>`);
    else if (b.t === "table") body.push(`<table class="counts"><thead><tr><th></th><th>Count</th></tr></thead><tbody>${b.rows.map((r) => `<tr><td>${h(r.label)}</td><td class="n">${htmlText(r.count)}</td></tr>`).join("")}</tbody></table>`);
    else body.push(`<div class="page2"></div>`);
  }
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${htmlText(title)}</title>`,
    `<style>${RECORD_CSS}</style>`,
    "</head>",
    "<body>",
    `<header class="running">${htmlText(firstLine)}</header>`,
    `<footer class="running">${htmlText(disclaimer)}</footer>`,
    '<table class="page"><thead><tr><td><div class="head-room"></div></td></tr></thead>',
    '<tfoot><tr><td><div class="foot-room"></div></td></tr></tfoot>',
    `<tbody><tr><td><main>${body.join("\n")}</main></td></tr></tbody></table>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

const RECORD_CSS = [
  "body{margin:0 auto;max-width:48rem;padding:1rem;font:11pt/1.4 Georgia,'Times New Roman',serif;color:#111;background:#fff}",
  "h1{font-size:16pt;margin:.2em 0 .6em}h2{font-size:12.5pt;margin:1em 0 .3em}h3{font-size:11pt;margin:.8em 0 .2em}",
  "p,li{margin:.25em 0}ul{padding-left:1.2em}code{font:9.5pt/1.3 Menlo,Consolas,monospace;word-break:break-all}",
  "table.counts{border-collapse:collapse;margin:.4em 0}table.counts td,table.counts th{padding:.15em .6em;border-bottom:1px solid #ccc;text-align:left}",
  "table.counts td.n{text-align:right;white-space:nowrap}table.page{width:100%;border-collapse:collapse}table.page>*>tr>td{padding:0}",
  "header.running,footer.running{font-size:8.5pt;color:#333}header.running{border-bottom:1px solid #999;padding-bottom:.3em;margin-bottom:.6em}",
  "footer.running{border-top:1px solid #999;padding-top:.3em;margin-top:.6em}.head-room,.foot-room{height:0}",
  "@page{size:A4;margin:2cm}",
  "@media print{body{max-width:none;padding:0;font-size:10pt}header.running{position:fixed;top:0;left:0;right:0;margin:0}",
  "footer.running{position:fixed;bottom:0;left:0;right:0;margin:0}.head-room{height:1.6cm}.foot-room{height:2cm}",
  "table.page thead{display:table-header-group}table.page tfoot{display:table-footer-group}.page2{break-before:page}}",
  "@media screen{footer.running{position:static}}",
].join("");

/** A log's comparison with the earlier review it carried from (A4), as the since block's counts. */
export function sinceFromComparison(log: Record<string, unknown>): SinceResult {
  const cmp = o(log.comparison);
  const earlier = o(cmp?.earlier);
  if (!cmp || !earlier) return { kind: "none" };
  if (earlier.compared === false) return { kind: "not", why: s(earlier.why) || "the earlier review holds nothing to compare with" };
  const n = (k: ChangeClass) => a(cmp.changes).filter((x) => s(o(x)?.change) === k).length;
  return { kind: "counts", day: day(s(earlier.completed_at)), up: n("new_or_higher"), lower: n("lower_or_moved"), gone: n("gone"), ruled: n("now_ruled_out"), at: s(earlier.completed_at) || null };
}

/**
 * `--since`: this log against an earlier one, by the comparison the report and changes.md use (comparison.ts
 * `comparisonOf`): one source for "gone". Where the earlier log is the one this
 * log was compared with, its own comparison is read (`sinceFromComparison`), which also follows a finding carried under
 * a new id; otherwise the comparison is made again over the two logs' basis rows, and a finding this scan still raised
 * with no verdict (its seat wrote no usable answer, or the person's shape left it out) is not compared, never gone.
 */
export function sinceBetween(now: unknown, earlier: unknown): SinceResult {
  const nowDoc = o(now);
  const eDoc = o(earlier);
  const was = o(o(nowDoc?.comparison)?.earlier);
  if (nowDoc && eDoc && was && s(was.completed_at) !== "" && s(was.completed_at) === s(eDoc.completed_at) && (s(was.label) === "" || s(was.label) === s(eDoc.scan_id))) {
    return sinceFromComparison(nowDoc);
  }
  const b = basisRowsOf(now);
  const e = basisRowsOf(earlier);
  if (b === null || e === null) return { kind: "not", why: `${b === null ? "this" : "the earlier"} evidence log holds no comparison basis, which logs from before release 1 do not` };
  const idsOf = (x: unknown): string[] => a(x).map((r) => s(o(r)?.finding_id)).filter((id) => id !== "");
  const raised = new Set<string>([...b.map((r) => r.finding_id), ...idsOf(nowDoc?.verdicts), ...idsOf(nowDoc?.unadjudicated), ...idsOf(nowDoc?.pre_settled)]);
  const block = comparisonOf({
    basis: b,
    plan: {},
    earlier: { label: s(eDoc?.scan_id), path: "", completed_at: s(eDoc?.completed_at) || null, digest: "none", basis: e, gone: goneRowsOf(earlier) },
    raised,
    completedAt: s(nowDoc?.completed_at),
  });
  return sinceFromComparison({ comparison: block });
}

/** The program's version, from the CLI's own package file (read through program-file.ts, a regular file or nothing). */
function programVersion(): string {
  try {
    const got = readNamedFile("the program's package file", join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"));
    if (!got.ok) return "of an unknown version";
    const p = JSON.parse(got.value.toString("utf8")) as { version?: unknown };
    return typeof p.version === "string" ? p.version : "of an unknown version";
  } catch {
    return "of an unknown version";
  }
}

export interface RecordOptions {
  target: string;
  log?: string;
  out?: string;
  since?: string;
  countsOnly?: boolean;
  preparedAt?: string;
  /** Tests: the state folder (default `processStateDir()`), and the page-2 sources (default `recordSourcesFor`). */
  stateDir?: string | null;
  sources?: RecordSources;
}

/** The evidence logs of `target`, newest first by completion time. */
function logsOf(target: string): string[] {
  const dir = join(target, ".legal", "evidence");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .map((n) => join(dir, n))
    .filter((p) => lstatSync(p).isFile())
    .sort((x, y) => (basename(x) < basename(y) ? 1 : -1));
}

/** Reads a log: its bytes' sha256 and its parsed form, or why not. */
function readLog(path: string): { sha256: string; doc: Record<string, unknown> } | { why: string } {
  try {
    const bytes = readRegularFile(path);
    const doc = o(JSON.parse(bytes.toString("utf8")));
    if (!doc) return { why: "it is not a JSON object" };
    return { sha256: createHash("sha256").update(bytes).digest("hex"), doc };
  } catch (e) {
    return { why: (e as Error).message };
  }
}

/** `--since`: an earlier evidence log, a record folder (or its summary.json), or a git tag or commit of the folder. */
function earlierLogOf(target: string, since: string): { doc: Record<string, unknown> } | { why: string } {
  const p = resolve(since);
  if (existsSync(p)) {
    const file = lstatSync(p).isDirectory() ? join(p, "summary.json") : p;
    const read = readLog(file);
    if ("why" in read) return { why: `${since} could not be read (${read.why})` };
    const named = o(read.doc.evidence_log);
    if (!named) return { doc: read.doc };
    const log = join(target, ".legal", "evidence", basename(s(named.name)));
    const again = readLog(log);
    if ("why" in again) return { why: `the evidence log ${s(named.name)} that ${since} names could not be read (${again.why})` };
    if (again.sha256 !== s(named.sha256)) return { why: `the evidence log ${s(named.name)} differs from the one ${since} was made from` };
    return { doc: again.doc };
  }
  const g = gitRunnerOrWhy(target);
  if (!("run" in g)) return { why: `${since} is not a file, and git was not run (${g.why})` };
  const rev = g.run(["--no-optional-locks", "rev-parse", "--verify", "--quiet", "--end-of-options", `${since}^{commit}`]);
  const commit = rev.status === 0 ? s(rev.stdout).trim() : "";
  if (!commit) return { why: `${since} is neither a file nor a tag or commit of this repository` };
  for (const path of logsOf(target)) {
    const read = readLog(path);
    if ("doc" in read && s(o(o(read.doc.summary)?.code)?.commit) === commit) return { doc: read.doc };
  }
  return { why: `no evidence log in this folder was made at ${since} (commit ${commit.slice(0, 7)})` };
}

/** A copy of `v` with every string through the printed redaction, each on its own (`redactStringsInPlace`); null stays null. */
function redactedCopy<T>(pr: PrintedRedaction, v: T): T {
  if (v === null || v === undefined) return v;
  const c = structuredClone(v);
  redactStringsInPlace(pr, c);
  return c;
}

/** `legal-scan record`: writes the record's three files, or none, and says why in one sentence. */
export function runRecord(opts: RecordOptions): { exitCode: number; lines: string[] } {
  const target = resolve(opts.target);
  const logPath = opts.log ? resolve(opts.log) : logsOf(target)[0];
  if (!logPath) return { exitCode: 1, lines: [`✘ no record was written: no evidence log was found under ${join(target, ".legal", "evidence")}; run a scan first, or name a log with --log.`] };
  const read = readLog(logPath);
  if ("why" in read) return { exitCode: 1, lines: [`✘ no record was written: the evidence log ${logPath} could not be read (${read.why}).`] };
  const summary = o(read.doc.summary) as unknown as RecordSummary | null;
  if (!summary) return { exitCode: 5, lines: [`✘ no record was written: the evidence log ${logPath} holds no summary, which logs made before this version do not; run the scan again to make a record of it.`] };
  const stateDir = opts.stateDir === undefined ? processStateDir() : opts.stateDir;
  const mark = digestMarkOf(readLogDigests(stateDir, target), basename(logPath), read.sha256);
  if (mark === "changed") return { exitCode: 5, lines: [`✘ no record was written: the evidence log ${logPath} has ${DIGEST_WORDS.changed}.`] };
  // In a project where Claude Code with the wolfboy plugin
  // has run (plugin-sessions.ts, asked for every command), the record is made only of a log WolfBoy wrote on this computer.
  const around = commandSessions();
  if (around !== null && around.kind === "recorded" && mark !== "matches") {
    return {
      exitCode: 5,
      lines: [
        `✘ no record was written: for the evidence log ${logPath}, ${mark === "none" ? DIGEST_WORDS.none : "the record of the logs WolfBoy wrote could not be read"}, and in ${around.projectDir}, where Claude Code with the wolfboy plugin has run, a record is made only of a log WolfBoy wrote on this computer.`,
      ],
    };
  }
  const notes: string[] = [];
  if (mark === "none") notes.push(`noted: for the evidence log ${basename(logPath)}, ${DIGEST_WORDS.none}.`);
  else if (mark === "unread") notes.push(`noted: the record of the logs WolfBoy wrote could not be read, so whether ${basename(logPath)} changed since WolfBoy wrote it is not known.`);
  let since: SinceResult;
  if (opts.since) {
    const e = earlierLogOf(target, opts.since);
    if ("why" in e) return { exitCode: 5, lines: [`✘ no record was written: --since ${opts.since}: ${e.why}.`] };
    since = sinceBetween(read.doc, e.doc);
  } else since = sinceFromComparison(read.doc);
  const sources = opts.sources ?? recordSourcesFor(stateDir, target, read.doc);
  const preparedAt = opts.preparedAt ?? new Date().toISOString();
  /* THE REPORT'S PRINTED REDACTION, ON EVERY FILE THE RECORD WRITES, as the
   * report's step 13 does (assemble-report.ts). The rule is the CLI's own copy of baseline-002
   * (`productPrintedRedaction`), as the report's is, never a bundle's. Values first, on copies, after the comparison is
   * taken and before any line is composed or wrapped (a value a wrap or a cut splits is no longer recognised): the log
   * (a log with no digest here, a teammate's, was never redacted by this computer), its summary, the comparison and
   * page 2's sources (a reason the person typed). Then each finished file again, as the report's second net: record.md
   * and record.html as text; summary.json value by value, as the log is (a pass over JSON text reads a digest on its own
   * row as a secret-shaped value, clause 19, and would print a marker for the log's sha256). */
  const redaction = productPrintedRedaction();
  const shown = <T>(v: T): T => redactedCopy(redaction, v);
  const input: RecordInput = {
    summary: shown(summary),
    log: shown(read.doc),
    logSha256: read.sha256,
    version: programVersion(),
    preparedAt,
    countsOnly: !!opts.countsOnly,
    since: shown(since),
    decisions: shown(sources.decisions()),
    deeperChecks: shown(sources.deeperChecks()),
    ...(mark === "none" || mark === "unread" ? { logMark: { name: basename(logPath), mark } } : {}),
  };
  /* The printed redaction reads record.md's composed lines before the wrap, and
   * the finished file again as the net under it (as the report's, assemble-report.ts `composedNet`). */
  const net = (t: string): string => redactPrintedText(redaction, t);
  const blocks = recordBlocks({ ...input, redacted: net(recordMarkdown(recordBlocks(input), net)).includes("[redacted:baseline-002#") });
  const disclaimer = s(input.log.disclaimer);
  const firstLine = `${RECORD_WORDS.firstLine} ${RECORD_WORDS.firstLineRest(input.version)}`;
  // summary.json (design section 4): counts, since, not checked and the items without a code line; no decision or deeper check.
  const machine = {
    evidence_log: { name: basename(logPath), sha256: read.sha256, digest: mark },
    prepared_at: preparedAt,
    counts_only: input.countsOnly,
    ...input.summary,
    ...(input.countsOnly ? { items: input.summary.items.map(({ f, short, disposition, level, area }) => ({ f, short, disposition, level, area })), not_checked: { ...input.summary.not_checked, folders: [] } } : {}),
    since: input.since,
  };
  redactStringsInPlace(redaction, machine);
  const outDir = resolve(opts.out ?? join(target, ".legal", "records", `record-${preparedAt.replace(/[:.]/g, "-")}`));
  const failed = writeBothOrNeither([
    [join(outDir, "record.md"), net(recordMarkdown(blocks, net))],
    [join(outDir, "record.html"), redactPrintedText(redaction, recordHtml(blocks, firstLine, disclaimer, RECORD_WORDS.title(input.summary.project)))],
    [join(outDir, "summary.json"), `${JSON.stringify(machine, null, 2)}\n`],
  ]);
  if (failed) return { exitCode: 1, lines: [`✘ no record was written: ${failed}`] };
  return { exitCode: 0, lines: [...notes, `✔ wrote the record ${join(outDir, "record.md")}, record.html (to save as PDF from a browser) and summary.json beside it.`] };
}

/** The CLI registration, kept here so the shared `index.ts` carries one line for it. */
export function registerRecord(program: Command): void {
  program
    .command("record")
    .description(
      "Write the record a person shows someone (record.md, record.html to save as PDF, summary.json) from one evidence log and this computer's decisions and deeper checks for the folder. Exit 0 wrote, 1 a file could not be read or written, 5 refused (a log changed since WolfBoy wrote it, a log with no summary, or a --since that names no earlier review).",
    )
    .option("--target <dir>", "the project folder the scan read", ".")
    .option("--log <file>", "the evidence log to make the record of (default: the newest under <target>/.legal/evidence/)")
    .option("--out <folder>", "the folder the three files go in (default <target>/.legal/records/record-<ISO8601>/)")
    .option("--since <tag-or-record>", "compare with an earlier review: a git tag or commit of this repository, an earlier record's folder or summary.json, or an evidence log")
    .option("--counts-only", "counts and areas only: no paths and no reasons for decisions, for a reader who must not see paths")
    .option("--prepared-at <iso>", "the date the record is prepared (default now)")
    .action((o2) => {
      const { exitCode, lines } = runRecord({
        target: o2.target as string,
        log: o2.log as string | undefined,
        out: o2.out as string | undefined,
        since: o2.since as string | undefined,
        countsOnly: !!o2.countsOnly,
        preparedAt: o2.preparedAt as string | undefined,
      });
      process.stdout.write(`${lines.join("\n")}\n`);
      process.exitCode = exitCode;
    });
}
