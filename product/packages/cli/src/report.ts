/**
 * THE CONSOLE REPORT'S FIRST SCREEN, and THE ONE FILE ITS WORDING LIVES IN.
 *
 * ## What this is, and what decided it
 *
 * an internal record, and what was decided on it:
 * the mocked wording as drafted, `full` as the default (the first screen, then a divider, then the
 * whole of the report this command printed before), `--report-detail first-screen` to stop early, no
 * cap on the topic table, the candidate list grouped by topic and capped at ten per topic, and the
 * disclaimer left where it is at the end of the output.
 *
 * What it repairs, measured on three real trees: on an 80x40 terminal the first
 * screen of the largest tree's scan ended at logical line 25, inside the first of FOUR identical Cyber
 * Resilience Act blocks, on a line about who a duty is addressed to. The user had been told nothing
 * about what was found. The first candidate line was line 209 of 1,035; on a smaller tree,
 * a project of 86 files, it was line 187 of 225 and the four repeated blocks were 157 of the 186
 * lines above it.
 *
 * ## EVERY USER-VISIBLE SENTENCE OF THIS FEATURE IS IN THIS FILE, ON PURPOSE
 *
 * Public-facing text is decided apart from the code. The
 * draft decided on is a mock, and its words may change once the real
 * result has been read. A wording change must therefore be a ONE-FILE edit, so
 * `scan.ts` composes no sentence of this feature's own: it calls the builders below, and the strings
 * they contain are the whole of what a reader sees. The three sentences this file does NOT own are
 * the ones it must not own — `coverage_limits[].sentence`, which `read-scope.ts` writes once for the
 * console, the SARIF and the layer-2 report alike; the topic labels, which `progress.ts` holds in
 * `TOPIC_LABELS`; and the report below the divider, which is what this command printed before and is
 * unchanged.
 *
 * ## IT COMPUTES NOTHING OF ITS OWN
 *
 * Every number on the first screen is read from the written document or from the values the run had
 * already resolved. The file count, the topic table and the candidate count are each stated twice on
 * one screen — once here and once in the stderr closing block — and the rule that keeps the two
 * honest is that both read the same function: `quickScanDoneLines` and the area table it prints
 * (`areaRowsOf`, whose order the candidate list below the divider follows too) are exported from
 * `progress.ts` and imported here, and `duration`, `group` and `plural` with them; the evidence
 * rank both order by is `evidence-rank.ts`'s. There is no second copy of any of them.
 *
 * That rule is why the ONE number that disagreed with itself now cannot. The console said
 * `files 5720 scanned` while the closing block said `scanned app: 5,721 files`; the difference is
 * `stats.files_not_read_by_engine`, the files the walker offered, the engine opened, and no rule was
 * then allowed to see. Both read `stats.files_scanned` now, which is the number the COVERAGE block's
 * own sentences are written against.
 *
 * ## IT CANNOT CHANGE THE DOCUMENT, AND THE ARGUMENT IS STRUCTURAL
 *
 * `index.ts` writes `findings.json` and the SARIF before the first byte of this report is composed,
 * and every function here takes a finished `Findings` and returns strings. No function here holds a
 * writable handle to anything. A test assertion (ii) and
 * the baseline digests continue to prove it on every run.
 */
import { basename } from "node:path";
import type { Candidate, Findings, Rule, ScopeAssessmentRecord } from "wolfboy-schemas";
import {
  areaRowsOf,
  duration,
  elapsedMsOf,
  group,
  plural,
  quickScanDoneLines,
  topicLabel,
} from "./progress.js";
import { bestRankOf, evidenceNote, evidencePartWords, evidencePartsOf, faceOf, tallyOf } from "./evidence-rank.js";

/** `--report-detail` as typed. `full` is the default. */
export type ReportDetail = "full" | "first-screen";

/** A `--report-detail` value this module cannot act on. `index.ts` makes it exit 1. */
export class ReportDetailOptionError extends Error {}

/**
 * `--report-detail`, resolved before a tree is read.
 *
 * THE NAME IS `--report-detail` AND NOT `--report`.
 * `--report <file>` already exists on the `annotate`, `verify` and `reconcile-diff` commands and
 * takes a PATH there; `scan --report full` beside `annotate --report x.json` in one CLI is a trap.
 * `--progress-detail <level>` is the convention this follows.
 */
export function resolveReportDetail(spec: string | undefined, onPersonsScreen = false): ReportDetail {
  // Unset, a person's terminal with a folder to
  // write the rest into gets the first screen and the file (`QUICK_SCAN_DETAIL_FILE`); every other reader of stdout gets
  // `full`, as before, so a pipe, a file, CI and the plugin's run lose nothing they read.
  if (spec === undefined) return onPersonsScreen ? "first-screen" : "full";
  if (spec === "full" || spec === "first-screen") return spec;
  throw new ReportDetailOptionError(
    `--report-detail must be one of: full, first-screen — got ${JSON.stringify(spec)}. ` +
      `full (the default) prints the first screen, a divider, and then the whole report; ` +
      `first-screen stops at the divider. Neither writes the findings document differently, and ` +
      `neither changes what was scanned.`,
  );
}

/**
 * The width every sentence on the first screen is wrapped to.
 *
 * 80 because that is the terminal the screen was measured on, and because the whole finding of the
 * proposal is stated in rows-on-an-80-column-terminal: a large Node CMS's report was 1,035 logical lines and
 * 2,985 rows, 75 screens of them. A line this file writes is never CUT — cutting to the live
 * terminal's width would make stdout a function of the window it was run in, and this command's
 * stdout is compared byte for byte by a permanent gate. Wrapping is deterministic; cutting is not.
 */
const SCREEN_WIDTH = 80;

/** The label column of the four labelled fields, and the indent their wrapped lines hang on. */
const LABEL_WIDTH = 15;

/** The column the divider's trailing rule is filled out to. One short of the screen, like a cursor. */
const DIVIDER_WIDTH = SCREEN_WIDTH - 1;

/**
 * How many candidate rows one topic prints below the divider before it points at the document.
 *
 * TEN, decided by the owner on 2026-09-16. It is a DISPLAY decision and the document is unaffected:
 * `candidates` carries every record, uncapped, and the line under each capped topic says how many
 * were left out and where they are. Measured: the largest tree prints 820 records today and at most 260 under
 * this cap; a mid-sized tree 128; a small one 32, which is under the cap in every topic.
 */
export const CANDIDATES_PER_TOPIC = 10;

/**
 * The severity markers, padded to 8 characters so that rule ids and paths line up in a column.
 *
 * Spelled exactly as `progress.ts`'s `SEV_MARK`, so a reader does not have to learn two vocabularies
 * for the same three words. Kept as this file's own object rather than imported because the two are
 * the same three strings for different reasons — that one is the live display's, this one is the
 * report's, and the report's has been these bytes since long before the display existed.
 */
const SEV_MARK = { high: "■ HIGH  ", medium: "▲ MEDIUM", low: "● LOW   " } as const;

/** What the run resolved before it read anything, which the document does not carry. */
export interface RunFacts {
  /** The tree, as `--target` resolved it. Named on the first line by its basename. */
  targetRoot: string;
  /** `PreparedScan.jobs` — the number the scan actually ran with, not the one it was asked for. */
  jobs: number;
  /** The per-file budget in milliseconds, or `Infinity` for `--file-budget off`. */
  fileBudgetMs: number;
  /** `--out` as resolved, or `null` where it was not given. */
  outPath: string | null;
  /**
   * Which rule bundle ran: where it came from, and whether it is the bundle shipped with this program
   * (bundle.ts `isShippedBundle`; null where the program carries none to compare with). Absent for a caller that
   * resolved none; the field is then not printed.
   */
  bundle?: { dir: string; from: "option" | "env" | "shipped"; shipped: boolean | null };
}

/** Wrap `text` under a label, hanging every later line on the label column. Words are never broken. */
function labelled(label: string, text: string): string[] {
  const indent = " ".repeat(LABEL_WIDTH);
  const out: string[] = [];
  let line = label.padEnd(LABEL_WIDTH);
  let empty = true;
  for (const word of text.split(" ")) {
    if (!empty && line.length + 1 + word.length > SCREEN_WIDTH) {
      out.push(line);
      line = indent;
      empty = true;
    }
    line = empty ? line + word : `${line} ${word}`;
    empty = false;
  }
  out.push(line);
  return out;
}

/** `a, b and c` — the list form the sentences below use, for two members and for more. */
function andList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * An instrument's name the short way round: `Cyber Resilience Act (EU 2024/2847)`.
 *
 * NOT A SECOND NAME AND NOT A LOOKUP TABLE. It is the document's own `law` string with its two
 * halves swapped — `Regulation (EU) 2024/2847 (Cyber Resilience Act)` carries both, in the order
 * that puts the number the reader does not know first and the name they do know last. A `law` that
 * is not in that shape is printed exactly as the document carries it, so nothing can be renamed by
 * accident and no instrument can be missing from this file.
 *
 * Not exported: only this file's own applicability line calls it, and an export nothing imports is
 * a promise this module does not have to keep.
 */
function instrumentName(law: string): string {
  const m = /^(?:Regulation|Directive|Decision)\s+\((EU|EC|EEC|EU, Euratom)\)\s+(\S+)\s+\((.+)\)$/.exec(law);
  return m === null ? law : `${m[3]} (${m[1]} ${m[2]})`;
}

/** The questions a person must answer for one instrument: unresolved limbs that bear on the verdict. */
function openQuestionCount(a: ScopeAssessmentRecord): number {
  // READ FROM `unresolved_limbs` AND NOT FROM THE STATE, so that this count and the TO ANSWER rows
  // the full section prints below the divider come from one list. A limb whose declaration was
  // contradicted by facts that cannot decide it is in that list and in neither state.
  const open = new Set(a.unresolved_limbs ?? []);
  return a.limbs.filter((l) => open.has(l.limb_id) && l.bears_on_verdict).length;
}

/**
 * THE SENTENCE THAT STOPS A CANDIDATE BEING READ AS A FINDING, and the last line before the divider.
 *
 * Nothing on this screen says how many candidates survive review, here or anywhere: no such figure
 * is approved for public use, and a screen that guessed one would be this tool making the precision
 * claim its own contract forbids it.
 */
/**
 * WHICH RULE BUNDLE RAN. The bundle chooses every rule a scan runs, and `--bundle` or
 * `LEGAL_BUNDLE_DIR` can name any folder whose manifest matches its files. So the first screen names the bundle by its
 * version and digest (findings.json's `bundle`), and says plainly when it is not the bundle shipped with this program -
 * someone checking another party's repository must be able to see that the rules were the product's own.
 */
/**
 * How a run says whether its rules are the ones shipped with this program - one phrase for the
 * terminal and the report, in each surface's own word for the rules: "checks" on the terminal,
 * "rules" in the report's files (the
 * report's own shape). Never a third name for the same thing.
 */
export const SHIPPED_WORDS = "the one shipped with this program";
export const notShippedWords = (rulesWord: "checks" | "rules"): string => `NOT the ${rulesWord} shipped with this program`;

export function bundleNamedLines(f: Findings, run: RunFacts): string[] {
  if (run.bundle === undefined) return [];
  const b = f.bundle as { version?: string; sha256?: string } | undefined;
  const named = `bundle ${b?.version ?? "(no version)"}, sha256 ${(b?.sha256 ?? "").slice(0, 12) || "(none)"}`;
  const by = run.bundle.from === "option" ? "--bundle" : run.bundle.from === "env" ? "LEGAL_BUNDLE_DIR" : "";
  if (run.bundle.shipped === true) return labelled("checks", `${named}, ${SHIPPED_WORDS}`);
  if (run.bundle.shipped === false) {
    return labelled("checks", `${notShippedWords("checks")}: ${named}, from ${run.bundle.dir}${by ? ` (${by})` : ""}`);
  }
  return labelled("checks", `${named}, from ${run.bundle.dir}${by ? ` (${by})` : ""}; this program carries no bundle of its own to compare it with`);
}

/**
 * THE FIRST SCREEN, as lines: the mock-up's screen 3, the same lines the
 * stderr closing block prints (`quickScanDoneLines`, progress.ts, one function for both). The scan line's jobs and
 * budget, the applicability field, the document path and the `next` sentence of the 2026-09-16 shape are not on it:
 * the provenance lines, the applicability limbs and the coverage sentences are in the full section below the divider,
 * which this change leaves as it was (`SKILL.md` step 3f, `test:read-scope`).
 *
 * WHICH CHECKS RAN. Where the bundle that ran is NOT the one shipped with this program,
 * or the program has none to compare it with, the first screen says so, after the table; where it is the shipped one,
 * the same line naming it by version and digest is the first line below the divider (`bundleNamedLines`).
 */
export function firstScreenLines(f: Findings, rules: Rule[], run: RunFacts): string[] {
  const lines = quickScanDoneLines(f, rules);
  if (run.bundle !== undefined && run.bundle.shipped !== true) {
    lines.push("");
    for (const line of bundleNamedLines(f, run)) lines.push(line);
  }
  return lines;
}

/**
 * THE FIRST SCREEN AGAIN, AFTER THE PERSON'S ANSWERS. In a
 * person's terminal the declaration's questions come after the first screen and the scan then runs again with the answers
 * (design rf11 3.3); printing the whole screen a second time showed the same table twice, since an answer labels what a
 * rule reports and switches no rule off. So the second pass prints its done line, then either one sentence saying the
 * screen above stands or the screen's lines that are new, in their order; the detail file still holds the whole screen.
 * `previous` and `current` are `firstScreenLines` of the two passes; the done line (the first) carries the time, so it is
 * left out of the comparison.
 */
export function screenAgainLines(previous: readonly string[], current: readonly string[]): string[] {
  const before = new Set(previous.slice(1));
  const changed = current.slice(1).filter((l) => l.trim() !== "" && !before.has(l));
  if (changed.length === 0) return [current[0] ?? "", "", "  Nothing on the screen above changed with your answers."];
  return [current[0] ?? "", "", "  With your answers, these lines of the screen above changed:", ...changed];
}

/**
 * The file beside `--out` that holds what the full section prints, where the screen showed only the first screen: the first screen, then the full section as
 * `--report-detail full` prints it below the divider, then the disclaimer. Written again by every such scan.
 */
export const QUICK_SCAN_DETAIL_FILE = "quick-scan.txt";

/**
 * THE END OF THE FIRST SCREEN OUTSIDE CLAUDE CODE AND CI: where the rest
 * went (the file, when one was written), then the next step in three lines, the sample's address on a line of its own (it
 * fits 80 columns only there). `detail` is the file's path as the person can open it (relative to the folder they ran
 * the command in, where it lies inside it).
 */
export const NEXT_STEP_WORDS = {
  // The detail file holds the list cut at
  // CANDIDATES_PER_TOPIC records an area (the owner's display decision of 2026-09-16), so it is named as what it holds,
  // and the findings document, which holds every record, is named on the line before it. Until 0.1.2 the line read
  // "Every place and everything checked: <file>" over a list that stopped at ten an area. This
  // line stays the last of the first screen: the skill shows the person the output up to it (SKILL.md step 2).
  everyPlace: (document: string) => `  Every place worth a look: ${document}`,
  detailFile: (detail: string) => `  What was checked, and the first ${CANDIDATES_PER_TOPIC} records of each area: ${detail}`,
  next: [
    `  Step 2, the AI review: open Claude Code in this project's folder and say`,
    `  "Scan this repository." A sample report:`,
    `  https://github.com/innit-llc/wolfboy/tree/main/examples/book-club`,
  ],
} as const;

/** The two lines naming the files, where the detail file was written: the document with every record, then the detail file. */
export function filesLines(detail: string | null, document: string): string[] {
  return detail === null ? [] : [NEXT_STEP_WORDS.everyPlace(document), NEXT_STEP_WORDS.detailFile(detail)];
}

/** The lines after the first screen: the files' lines where the detail file was written, a blank, the next step. */
export function nextStepLines(detail: string | null, document: string): string[] {
  return [...filesLines(detail, document), "", ...NEXT_STEP_WORDS.next];
}

/**
 * THE DIVIDER — one field, naming what is below and how to stop before it.
 *
 * Printed only under `--report-detail full`, because under `first-screen` nothing follows it and a
 * line that said "full report follows" would be a sentence this command contradicts two lines later.
 * The count it carries is the number of candidate lines ACTUALLY PRINTED below, after the per-topic
 * cap — not the record count, which is on the `document` line and is the whole of the record.
 */
export function dividerLines(printedCandidateLines: number): string[] {
  const text =
    `full report follows: applicability limbs, coverage, silent rules, the ` +
    `${group(printedCandidateLines)} candidate lines. Stop before it with --report-detail ` +
    `first-screen.`;
  const out: string[] = [];
  let line = "--- ";
  let empty = true;
  for (const word of text.split(" ")) {
    if (!empty && line.length + 1 + word.length > SCREEN_WIDTH) {
      out.push(line);
      line = "    ";
      empty = true;
    }
    line = empty ? line + word : `${line} ${word}`;
    empty = false;
  }
  const fill = DIVIDER_WIDTH - line.length - 1;
  out.push(fill >= 3 ? `${line} ${"-".repeat(fill)}` : line);
  return out;
}

// ---------------------------------------------------------------------------------------------
// The two corrections to the full section, both of which only affect the full section.
// ---------------------------------------------------------------------------------------------

/** The entries of one instrument, and whether the full section may print them as one block. */
export interface InstrumentGroup {
  law: string;
  entries: ScopeAssessmentRecord[];
  /** True when every entry would render the identical block, so one block loses nothing. */
  identical: boolean;
}

/**
 * The applicability entries grouped by INSTRUMENT, in the document's own order.
 *
 * "Identical" is decided by serialising everything the full section prints for an entry — its
 * verdict, its `because`, every contradiction, every limb with its state, its weight, its
 * declaration and its first fact, and the open list — rather than by a judgement about limbs. So a
 * collapse can only happen where there is provably nothing to lose, and two entries of one
 * instrument that disagree in any respect a reader would see are printed one block each.
 */
export function applicabilityByInstrument(scope: readonly ScopeAssessmentRecord[]): InstrumentGroup[] {
  const groups = new Map<string, ScopeAssessmentRecord[]>();
  for (const a of scope) {
    const rows = groups.get(a.law);
    if (rows) rows.push(a);
    else groups.set(a.law, [a]);
  }
  return [...groups.entries()].map(([law, entries]) => {
    const first = printedShapeOf(entries[0]!);
    return { law, entries, identical: entries.every((e) => printedShapeOf(e) === first) };
  });
}

/** Everything the full section prints about one entry, as one string, for the comparison above. */
function printedShapeOf(a: ScopeAssessmentRecord): string {
  return JSON.stringify([
    a.verdict,
    a.because,
    (a.contradictions ?? []).map((c) => [
      c.limb_id,
      c.declared_by,
      c.evidence_count ?? c.evidence.length,
      c.evidence[0] ? `${c.evidence[0].kind} ${c.evidence[0].file}:${c.evidence[0].line}` : "",
    ]),
    a.limbs.map((l) => [
      l.limb_id,
      l.state,
      l.bears_on_verdict,
      l.decided_by,
      l.declared_by ?? "",
      l.declared_value ?? null,
      l.supporting_count,
      l.opposing_count,
      l.question,
      (l.supporting_count > 0 ? l.supporting : l.opposing)[0]
        ? `${(l.supporting_count > 0 ? l.supporting : l.opposing)[0]!.kind} ` +
          `${(l.supporting_count > 0 ? l.supporting : l.opposing)[0]!.file}:` +
          `${(l.supporting_count > 0 ? l.supporting : l.opposing)[0]!.line}`
        : "",
    ]),
    [...(a.unresolved_limbs ?? [])].sort(),
  ]);
}

/** The line that names the checklists one collapsed verdict governs. */
export function checklistsGovernedLine(g: InstrumentGroup): string {
  const ids = g.entries.map((e) => e.checklist_id);
  return (
    `    this verdict governs ${group(ids.length)} ${plural(ids.length, "checklist", "checklists")}, ` +
    `whose limbs are identical in this tree: ${ids.join(", ")}`
  );
}

/** The header of a block the collapse could NOT take, so a reader can tell the four blocks apart. */
export function checklistBlockHeader(a: ScopeAssessmentRecord): string {
  return `  ${a.law}  [${a.verdict}]  (checklist ${a.checklist_id})`;
}

/** One topic's candidate records: what is shown below the divider, and what is left in the document. */
export interface CandidateTopic {
  label: string;
  shown: Candidate[];
  hidden: number;
}

const SEVERITY_ORDER: Readonly<Record<string, number>> = { high: 0, medium: 1, low: 2 };

/**
 * The candidate list, grouped by topic and capped, in the order the first screen's area table prints.
 *
 * NOTHING IS DROPPED FROM THE DOCUMENT and nothing is dropped from this list either — a record over
 * the cap is counted on the topic's own overflow line and is in `candidates`, uncapped. A candidate
 * whose rule this caller was not given keeps its own rule id as its topic rather than vanishing:
 * subtraction is the only operation that can create a miss, and a list that silently skipped a row
 * would be one.
 * The topics follow the area table's
 * order (progress.ts `areaRowsOf`), and inside a topic the records are ordered by the best evidence rank of their places
 * (evidence-rank.ts), then by severity, then by the document's own order. Until 0.1.3 the topics followed a count of
 * files and the records severity alone, so a topic's first ten could all be documentation-site and CI rows.
 */
export function candidateTopics(f: Findings, rules: Rule[]): CandidateTopic[] {
  const packOf = new Map(rules.map((r) => [r.id, r.pack]));
  const order = new Map(areaRowsOf(f, packOf).map((r, i) => [r.label, i]));
  const byLabel = new Map<string, Candidate[]>();
  for (const c of f.candidates ?? []) {
    const pack = packOf.get(c.rule_id);
    const label = pack === undefined ? c.rule_id : topicLabel(pack);
    const rows = byLabel.get(label);
    if (rows) rows.push(c);
    else byLabel.set(label, [c]);
  }
  return [...byLabel.entries()]
    .sort((a, b) => {
      // A label the table does not carry (a rule this caller was not given) sorts after every one it
      // does, by label, so the list is a total order whatever the document holds.
      const ia = order.get(a[0]) ?? Number.MAX_SAFE_INTEGER;
      const ib = order.get(b[0]) ?? Number.MAX_SAFE_INTEGER;
      return ia - ib || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    })
    .map(([label, rows]) => {
      // Ordered by the best evidence rank of a record's places, then by
      // severity inside a topic, and by the document's own order within both — `sort` is
      // stable, so two runs of one tree print one order.
      const best = new Map(rows.map((c) => [c, bestRankOf(c)]));
      const ordered = [...rows].sort(
        (a, b) => (best.get(a) ?? 0) - (best.get(b) ?? 0) || (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3),
      );
      return {
        label,
        shown: ordered.slice(0, CANDIDATES_PER_TOPIC),
        hidden: Math.max(0, ordered.length - CANDIDATES_PER_TOPIC),
      };
    });
}

/** How many candidate rows the full section will print, which is what the divider names. */
export function candidateLineCount(topics: readonly CandidateTopic[]): number {
  return topics.reduce((n, t) => n + t.shown.length, 0);
}

/**
 * The grouped candidate list, as lines.
 *
 * THE ROWS THEMSELVES ARE UNCHANGED, BYTE FOR BYTE, and start at COLUMN 0 as they always have.
 * A test asserts that no line of stdout matches
 * `^ {2}(■ HIGH|▲ MEDIUM|● LOW) {2}` — that shape is the live display's candidate line and it must
 * stay unique to stderr — so indenting these rows under their topic heading by two spaces would put
 * that gate one byte from a false green. The heading carries the grouping instead.
 */
/**
 * `listedIn` is the file that holds every
 * record (the findings document, as the person can open it), named on every line where a topic's list stops; null where
 * this run wrote no document, which the line says. Until 0.1.2 the line said "+ N more in the document" and named none.
 */
export function candidateListLines(topics: readonly CandidateTopic[], titleOf: (ruleId: string) => string, listedIn: string | null): string[] {
  // EVERY RECORD WITH A PLACE IN CODE, OF
  // EVERY AREA, BEFORE ANY RECORD WITHOUT ONE. Each area's shown records are the ones `candidateTopics` chose (its first
  // CANDIDATES_PER_TOPIC, code first), unchanged; they are printed in two passes, the areas in the table's order in
  // each: first every area's records holding a construct in code, then every area's records holding none, under a line
  // that says so. An area with both is headed in each pass. Until this unit the areas were printed one after another,
  // so an area's example-data rows sat above a later area's rows in code, whatever their severity.
  const lines: string[] = [];
  const more = (t: CandidateTopic): string =>
    listedIn === null ? `+ ${group(t.hidden)} more, written nowhere: a scan with --out <file> writes every one` : `+ ${group(t.hidden)} more in ${listedIn}`;
  const parts = topics.map((t) => ({ t, inCode: t.shown.filter(hasPlaceInCode), notInCode: t.shown.filter((c) => !hasPlaceInCode(c)) }));
  for (const { t, inCode, notInCode } of parts) {
    if (inCode.length === 0) continue;
    const total = t.shown.length + t.hidden;
    lines.push(
      `${t.label} — ${group(total)} ${plural(total, "record", "records")}` +
        (notInCode.length > 0
          ? `, ${group(inCode.length)} with a place in code here, ${SPLIT_AREA_WORDS}:`
          : t.hidden === 0
            ? `:`
            : `, the first ${group(t.shown.length)}, ${CODE_FIRST_WORDS}:`),
    );
    for (const c of inCode) lines.push(candidateRow(c, titleOf(c.rule_id)), ...whereLines(c));
    if (notInCode.length === 0 && t.hidden > 0) lines.push(more(t));
  }
  const rest = parts.filter((p) => p.notInCode.length > 0);
  if (rest.length > 0 && lines.length > 0) lines.push(NO_CODE_PASS_WORDS);
  for (const { t, inCode, notInCode } of rest) {
    const total = t.shown.length + t.hidden;
    lines.push(
      inCode.length > 0
        ? `${t.label}, continued — ${group(notInCode.length)} with no place in code` + (t.hidden === 0 ? `:` : `, of the first ${group(t.shown.length)}:`)
        : `${t.label} — ${group(total)} ${plural(total, "record", "records")}` + (t.hidden === 0 ? `:` : `, the first ${group(t.shown.length)}, ${CODE_FIRST_WORDS}:`),
    );
    for (const c of notInCode) lines.push(candidateRow(c, titleOf(c.rule_id)), ...whereLines(c));
    if (t.hidden > 0) lines.push(more(t));
  }
  return lines;
}

/** Whether a record holds a construct in code: its best place is of evidence rank 0 (evidence-rank.ts). */
function hasPlaceInCode(c: Candidate): boolean {
  return bestRankOf(c) === 0;
}

/** How an area with records in both passes says where the rest are (DRAFT). */
export const SPLIT_AREA_WORDS = "the rest after every area's records in code";

/** The line between the two passes of the list (DRAFT). */
export const NO_CODE_PASS_WORDS = "Records with no place in code, every area in the same order:";

/** How a capped topic's heading says its order (DRAFT). */
export const CODE_FIRST_WORDS = "places in code first, then by severity";

/** The indent of the lines under a candidate row: under its rule id. */
export const CANDIDATE_NOTE_INDENT = " ".repeat(9);

/**
 * WHERE A RECORD'S PLACES ARE, on the lines under its row: one line
 * where they are all of one evidence rank other than code ("all words only, in example data or templates"), and one
 * line per rank otherwise, best first, each after the first naming its own first place, so a record that groups a whole
 * tree shows its code part apart from the rest. A record whose places are all words says so under its severity mark. A record whose places are all in code has no line under it (the common case).
 * A record split by rank keeps its count in code on its first line: its row counts locations ("(+N)"), not places, so
 * the count in code is not otherwise on the list, and this list is where the first screen's rows send a reader for it.
 * Display only: the record, its locations and what the AI review is given are the document's, unchanged.
 */
function whereLines(c: Candidate): string[] {
  const parts = evidencePartsOf(c);
  if (parts.length <= 1) {
    const note = evidenceNote(tallyOf(c));
    return note === "" ? [] : [`${CANDIDATE_NOTE_INDENT}${note}`];
  }
  return parts.map((p, i) => `${CANDIDATE_NOTE_INDENT}${evidencePartWords(p, i > 0)}`);
}

/**
 * One candidate row, as this command has printed it since before the first screen existed, except its place: since
 * 0.1.3 the face is the record's best place (evidence-rank.ts `faceOf`), not the first in path order.
 */
function candidateRow(c: Candidate, title: string): string {
  const loc = faceOf(c);
  const extra = c.locations.length > 1 ? ` (+${c.locations.length - 1})` : "";
  // Two rows of one split group are one question, not two findings, and on this screen they are
  // otherwise indistinguishable from two: same marker, same rule id, same title, different path.
  const part = c.group_part
    ? ` [part ${c.group_part.part}/${c.group_part.of} of one group of ${c.group_part.locations_in_group}]`
    : "";
  return (
    `${SEV_MARK[c.severity as keyof typeof SEV_MARK] ?? "        "} ${c.rule_id}  ` +
    `${loc ? `${loc.file}:${loc.start_line}` : "(no location)"}${extra}${part}  ${title}`
  );
}
