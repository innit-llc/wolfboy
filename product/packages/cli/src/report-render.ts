import { basename, dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { assemble, tierOfMemo, type AssembleInput, type AssembleResult } from "./assemble-report.js";
import { redactPrintedText, type PrintedRedaction } from "./credential-redaction.js";
import type { DecisionRecord, DecisionView } from "./decisions.js";
import { productPrintedRedaction } from "./engine.js";
import { readLogDigests } from "./log-digest.js";
import type { PenaltyTierTable } from "./penalty-tier.js";
import { shownItemNameOf, type PlaceTableRow, type ProgramItemSource } from "./place-fold.js";
import { sha256Of } from "./program-file.js";
import { renamePath, writeFileAt } from "./project-write.js";
import { readDeepRecord, type DeepRecordLine } from "./deepen.js";
import { latestReport, readReportFile, recordReportFiles } from "./report-files.js";
import { readStateRecord, RENDER_INPUT_RECORD, writeStateRecord } from "./state-record.js";

/**
 * `decide` CHANGES THE REPORT ALREADY WRITTEN (design rf13 3.4, mock M10).
 *
 * After the person records a decision, the latest report in the folder shows it ("Decided by you"; each decided finding's
 * file carries the decision), not only the next scan's. The report cannot be made again from the evidence log alone: the
 * assembly reads, besides the log's own content, the scan document's candidates, the seats' answers, the quote check and
 * step 7's re-check over the scanned tree, the premise blocks (rule names, roles and duties), the place tables, the
 * penalty tiers and the commit, none of which the log holds whole. Nor can it be made again by running the assembly over
 * the tree: once the person fixes a file a verdict rests on, the quote check differs and the assembly refuses (B2's
 * finding, rf11-b2-2026-11-06.md). So the assembly KEEPS ITS OWN INPUT: the one object `assemble()` was called with, with
 * what its two readers returned (step 7's re-check, the person's decisions as read then), as one record in the person's
 * state folder (state-record.ts `RENDER_INPUT_RECORD`: outside the project and any git work tree, so no commit carries it
 * and no clone brings one), whose sha256 goes with the report's line there (report-files.ts). Every string in it has been
 * through the printed redaction the assembly used (step 13), so no value the credential rule recognises is kept in clear;
 * the assembly redacts what it prints from the same strings, and a marker is never redacted twice, so the report made
 * from the redacted input is the one written (the proof below holds it to that). Only the latest report's input is kept:
 * an older report is the record of its own review.
 *
 * `rerenderLatestReport` calls `assemble()` again on that input, reading nothing of the project but this file and the
 * report's own files (and, in the person's state folder, the deeper checks' record as it is now, so a `deepen` step after the
 * scan keeps its section in the finding's file). It first proves the input is the one the report was made from: with the decisions as the scan read
 * them, the log it makes must have the sha256 this computer recorded for the log (log-digest.ts), and every report file
 * the sha256 the assembly wrote. Only then does it make the report with the person's decisions as they are now, and
 * write each file that changed through `recordReportFiles`, so `explain`, `ruled-out` and `fix` keep printing them.
 * Decisions are an overlay after counts (design 3.4): the log made with them is held to the same sha256.
 */

const MAP = "\u0001map";
const SET = "\u0001set";

/**
 * The input as text: Maps and Sets tagged, anything that is not data refused (a function would not come back), and each
 * string through `redaction` where the assembly had one, an object's keys as well as its values: findings.json keys `ships_premises` by `locations[].file`, so a path holding a
 * credential was kept in clear as a key. A key and the value it names are redacted by the same function, so the replay's
 * lookups still meet.
 */
function encode(value: unknown, redaction: PrintedRedaction | null): string {
  return JSON.stringify(value, (key: string, v: unknown) => {
    if (typeof v === "string") return redaction ? redactPrintedText(redaction, v) : v;
    if (v instanceof Map) return { [MAP]: [...v] };
    if (v instanceof Set) return { [SET]: [...v] };
    if (redaction && v !== null && typeof v === "object" && !Array.isArray(v) && typeof (v as { toJSON?: unknown }).toJSON !== "function") {
      const entries = Object.entries(v as Record<string, unknown>);
      if (entries.some(([k]) => redactPrintedText(redaction, k) !== k)) return Object.fromEntries(entries.map(([k, x]) => [redactPrintedText(redaction, k), x]));
    }
    if (typeof v === "function" || v instanceof RegExp || typeof v === "bigint" || typeof v === "symbol") throw new Error(`the field ${key || "(top)"} is not data`);
    return v;
  });
}

function decode(text: string): unknown {
  return JSON.parse(text, (_key: string, v: unknown) => {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === MAP) return new Map((v as Record<string, [unknown, unknown][]>)[MAP]);
      if (keys.length === 1 && keys[0] === SET) return new Set((v as Record<string, unknown[]>)[SET]);
    }
    return v;
  });
}

/** What a kept input holds besides the input itself. */
interface Kept {
  v: 1;
  /** Each name `assemble()` gives a report file, with its path inside the report folder as recorded. */
  names: Record<string, string>;
  /** Each report file's sha256 as the assembly wrote it, by its path inside the report folder. */
  files: Record<string, string>;
  /** The log's `summary.code` as written (the commit is read from the tree after `assemble()`), or null. */
  code: unknown;
  recheck: unknown;
  decisions: DecisionRecord | null;
  input: Record<string, unknown>;
}

/** The assembly's side: the input with its two readers wrapped, and the text to keep once the report is written. */
export interface RenderKeep {
  input: AssembleInput;
  text: (after: { names: Record<string, string>; files: Record<string, string>; code: unknown }) => { text: string } | { problem: string };
}

/**
 * Wrap `input` (the object `assemble()` is about to be called with) so that what its readers return is kept, and encode
 * the rest now, before `assemble()` runs (it may change what it is handed). The closures are kept as what makes them
 * again: the penalty-tier table, each place table's item source, whether the printed redaction was on.
 */
export function keepRenderInput(input: AssembleInput, more: { tiers: PenaltyTierTable; itemSources: ReadonlyMap<string, ProgramItemSource | null> }): RenderKeep {
  let plain: string | null = null;
  let problem = "";
  const redaction = input.redaction ?? null;
  try {
    const { personDecisions: _d, recheck: _r, tierOf: _t, redaction: _p, placeTables, ...rest } = input;
    plain = encode({
      ...rest,
      ...(placeTables ? { placeTables: new Map([...placeTables].map(([id, t]) => [id, { summary: t.summary, path: t.path }] as const)) } : {}),
      redacted: redaction !== null,
      hasRecheck: input.recheck !== undefined,
      hasDecisions: input.personDecisions !== undefined,
      tiers: more.tiers,
      itemSources: more.itemSources,
    }, redaction);
  } catch (e) {
    problem = (e as Error).message;
  }
  let rechecked: unknown = null;
  let read: DecisionRecord | null = null;
  const recheck = input.recheck;
  const personDecisions = input.personDecisions;
  const wrapped: AssembleInput = {
    ...input,
    ...(recheck ? { recheck: (log) => (rechecked = recheck(log)) as ReturnType<typeof recheck> } : {}),
    ...(personDecisions ? { personDecisions: () => (read = personDecisions()) } : {}),
  };
  return {
    input: wrapped,
    text: (after) =>
      plain === null
        ? { problem }
        : { text: `{"v":1,"names":${JSON.stringify(after.names)},"files":${JSON.stringify(after.files)},"code":${encode(after.code ?? null, redaction)},"recheck":${encode(rechecked, redaction)},"decisions":${encode(read, redaction)},"input":${plain}}` },
  };
}

/** The input written to the state folder for `target` as gzip in base64, replacing the last; the record's sha256, or why not. */
export function writeRenderInput(stateDir: string | null, target: string, text: string): { sha256: string } | { problem: string } {
  const record = `${gzipSync(Buffer.from(text, "utf8")).toString("base64")}\n`;
  const w = writeStateRecord(stateDir, target, RENDER_INPUT_RECORD, record);
  return w.written ? { sha256: sha256Of(record) } : { problem: w.why };
}

/**
 * The input `assemble()` is called with again: the kept data, its closures made again, the decisions given, and, where
 * given, the deeper checks' record as it is now (in place of the one kept; the folders the links are made from kept).
 */
function inputOf(k: Kept, decisions: DecisionRecord | null, deep?: { project: string; reportDir: string; lines: readonly DeepRecordLine[] }): AssembleInput {
  const { redacted, hasRecheck, hasDecisions, tiers, itemSources, placeTables, ...rest } = k.input as Record<string, unknown> & {
    placeTables?: Map<string, { summary: unknown; path: string }>;
    itemSources?: Map<string, ProgramItemSource | null>;
    tiers: PenaltyTierTable;
  };
  const rows = rest.placeRows as Map<string, readonly PlaceTableRow[]> | undefined;
  return {
    ...(rest as unknown as AssembleInput),
    ...(placeTables
      ? { placeTables: new Map([...placeTables].map(([id, t]) => [id, { ...t, itemName: (name: string) => shownItemNameOf(rows?.get(id) ?? [], itemSources?.get(id) ?? null, name) }] as const)) as AssembleInput["placeTables"] }
      : {}),
    tierOf: tierOfMemo(tiers),
    redaction: redacted === true ? productPrintedRedaction() : null,
    ...(hasRecheck === true ? { recheck: () => (k.recheck ?? { problem: "the re-check's result was not kept" }) as { report: Record<string, unknown> } } : {}),
    ...(hasDecisions === true && decisions !== null ? { personDecisions: () => decisions } : {}),
    ...(deep ? { deeperChecks: deep } : {}),
  };
}

function replay(k: Kept, decisions: DecisionRecord | null, deep?: { project: string; reportDir: string; lines: readonly DeepRecordLine[] }): { result: AssembleResult; logSha: string } {
  const result = assemble(inputOf(k, decisions, deep));
  const summary = result.log?.summary;
  if (summary && typeof summary === "object" && k.code !== null) (summary as Record<string, unknown>).code = k.code;
  return { result, logSha: sha256Of(`${JSON.stringify(result.log, null, 2)}\n`) };
}

/** Why the report already written could not be changed, one clause each. */
export const RERENDER_WORDS = {
  noReport: "this computer has no report of this folder recorded",
  noInput: "the latest report was written by an earlier build, which kept nothing to write it again from",
  inputUnread: (why: string) => `what the latest report was made from cannot be read (${why})`,
  inputChanged: "what the latest report was made from changed after the scan wrote it",
  noDigest: "this computer has no digest of the latest report's evidence log",
  notSame: "made again, the latest report would not be the one the scan wrote (this build of WolfBoy differs from the one that wrote it, or what it was made from changed)",
  fileChanged: (path: string) => `${path} changed after the scan wrote it, and WolfBoy replaces no file it cannot show it wrote`,
  notWritten: (why: string) => `its files could not be written (${why})`,
  deepUnread: (why: string) => `this computer's record of deeper checks cannot be read (${why}), and WolfBoy writes no finding's file without its deeper checks`,
};

export type Rerender =
  | { done: true; logName: string; reportDir: string; written: string[]; view: DecisionView | undefined; decidedEntry: (findingId: string) => boolean }
  | { done: false; why: string };

/**
 * Write the latest report of `target` again with the person's decisions `now`, reading nothing of the project but the
 * kept input and the report's own files; or say, in one clause, why it was not written.
 */
export function rerenderLatestReport(target: string, stateDir: string | null, now: DecisionRecord): Rerender {
  const latest = latestReport(stateDir, target);
  if (!latest.ok) return { done: false, why: RERENDER_WORDS.noReport };
  const entry = latest.entry;
  if (!entry.renderInput) return { done: false, why: RERENDER_WORDS.noInput };
  const got = readStateRecord(stateDir, target, RENDER_INPUT_RECORD);
  if (!got.read) return { done: false, why: RERENDER_WORDS.inputUnread(got.why) };
  if (sha256Of(got.text) !== entry.renderInput.sha256) return { done: false, why: RERENDER_WORDS.inputChanged };
  let k: Kept;
  try {
    k = decode(gunzipSync(Buffer.from(got.text.trim(), "base64")).toString("utf8")) as Kept;
  } catch (e) {
    return { done: false, why: RERENDER_WORDS.inputUnread((e as Error).message) };
  }
  if (!k || k.v !== 1 || typeof k.input !== "object" || typeof k.files !== "object" || typeof k.names !== "object") return { done: false, why: RERENDER_WORDS.inputUnread("not the program's own form") };
  const digests = readLogDigests(stateDir, target);
  const digest = digests.ok ? digests.byName.get(entry.log) : undefined;
  if (digest === undefined) return { done: false, why: RERENDER_WORDS.noDigest };
  const pathOf = (name: string): string => k.names[name] ?? name;
  // The proof: with the decisions as the scan read them, the same log and the same files.
  const same = (r: { result: AssembleResult; logSha: string }, files: Record<string, string>): boolean => {
    const report = r.result.report ?? {};
    return r.result.refusals.length === 0 && r.logSha === digest && Object.keys(report).length === Object.keys(files).length && Object.entries(report).every(([name, text]) => files[pathOf(name)] === sha256Of(text));
  };
  try {
    if (!same(replay(k, k.decisions), k.files)) return { done: false, why: RERENDER_WORDS.notSame };
  } catch {
    return { done: false, why: RERENDER_WORDS.notSame };
  }
  /* The deeper checks as they are now: a `deepen` step after the scan wrote its
   * section into the finding's file (deepen.ts withCheckSection, recorded through `recordReportFiles`), and the file made
   * again from the record's lines as they are now is that text, so a decision keeps the section byte for byte. The record
   * is the person's state folder's, not the project's. */
  const deepNow = readDeepRecord(stateDir, target);
  if (!deepNow.ok) return { done: false, why: RERENDER_WORDS.deepUnread(deepNow.why) };
  const keptDeep = (k.input as { deeperChecks?: { project?: unknown; reportDir?: unknown } }).deeperChecks;
  const deep = {
    project: typeof keptDeep?.project === "string" ? keptDeep.project : target,
    reportDir: typeof keptDeep?.reportDir === "string" ? keptDeep.reportDir : entry.dir,
    lines: deepNow.lines,
  };
  let made: { result: AssembleResult; logSha: string };
  try {
    made = replay(k, now, deep);
  } catch {
    return { done: false, why: RERENDER_WORDS.notSame };
  }
  if (made.result.refusals.length > 0 || made.logSha !== digest) return { done: false, why: RERENDER_WORDS.notSame };
  // Each file whose text changes; each must be on disk as recorded, or nothing is written.
  const changed: [string, string, string][] = [];
  for (const [name, text] of Object.entries(made.result.report ?? {})) {
    const path = pathOf(name);
    if (entry.files.get(path) === sha256Of(text)) continue;
    const onDisk = readReportFile(entry, path);
    if (!onDisk.ok) return { done: false, why: RERENDER_WORDS.fileChanged(onDisk.path) };
    changed.push([path, text, onDisk.text]);
  }
  const placed: [string, string][] = [];
  try {
    const temps = changed.map(([path, text]) => {
      const tmp = join(entry.dir, dirname(path), `.${basename(path)}.${process.pid}.decide.tmp`);
      writeFileAt(tmp, text);
      return tmp;
    });
    changed.forEach(([path, , before], i) => {
      renamePath(temps[i] as string, join(entry.dir, path));
      placed.push([path, before]);
    });
  } catch (e) {
    for (const [path, before] of placed) writeFileAt(join(entry.dir, path), before);
    return { done: false, why: RERENDER_WORDS.notWritten((e as Error).message) };
  }
  if (changed.length > 0) {
    const kept = recordReportFiles(stateDir, target, entry.dir, Object.fromEntries(changed.map(([path, text]) => [path, text] as const)));
    if (!kept.written) {
      for (const [path, before] of placed) writeFileAt(join(entry.dir, path), before);
      return { done: false, why: RERENDER_WORDS.notWritten(kept.why) };
    }
  }
  const view = made.result.decisions;
  const listed = made.result.listed ?? [];
  const decidedEntry = (findingId: string): boolean => {
    const group = listed.find((r) => r.finding_id === findingId)?.group;
    return group !== undefined && listed.filter((r) => r.group === group).every((r) => view?.stateOf.get(r.finding_id)?.state === "applied");
  };
  return { done: true, logName: entry.log, reportDir: entry.dir, written: changed.map(([path]) => path), view, decidedEntry };
}
