/**
 * THE LAUNCH LIST, ITS WAVES, THE PRICE TABLE WITH THE RUN-SHAPE QUESTION, AND THE STATUS LINE.
 *
 * ## The defect this exists to remove
 *
 * Live run 1 (2026-09-23) carried text between the program and the seats by retyping it: the
 * orchestrating AI wrote its own briefs, and 0 of its 25 adjudicator-type launches carried a
 * `settled_premise` sentence or named the orientation sheet (annex E21). It re-worded the price
 * block and replaced the three run shapes with a budget question of its own (E17, E22). And for 94.8
 * minutes nobody could say how far the run had got; the only remaining-time figure given was
 * computed from a 174 s constant measured on a different run shape (E11, E13).
 *
 * So the program writes all three texts itself:
 *
 * 1. **The launch list.** One entry per seat launch the run makes, each holding the WHOLE `Agent`
 *    input the orchestrator passes - the product's own agent type, a one-line prompt naming a brief
 *    the program wrote (the payload path, the settled premise of every rule in the payload, the
 *    run's profile and dependency inventory, the orientation sheet), the description and the model -
 *    with a stable id and the wave it belongs to. The hook that refuses an unlisted launch is NOT
 *    here (it waits for the probe, item 1); this is what it will check against.
 * 2. **The price table and the run-shape question**, as the exact text and answer options an
 *    `AskUserQuestion` call takes, so the orchestrator passes them on instead of re-wording them.
 *    The time is stated with the conditions it was measured under and as a range between the two
 *    measurements whose conditions differ (proposal section 2.5).
 * 3. **The status line.** One line: seats returned of listed, elapsed time, the remaining time
 *    estimated from THIS run's returned seats (never from a constant), and the tokens the program's
 *    own records carry - and it says plainly when it cannot estimate yet.
 *
 * ## What it does NOT do
 *
 * It launches nothing, admits or refuses nothing, and captures no answer: those are the hooks and the
 * capture command (items 2-3). It asks nothing of the person: it writes the question. The list holds
 * the adjudication launches the pre-launch step knows of; refuter entries (appended as violation
 * candidates are captured) and silence-investigator entries (from the rule ids the orchestrator
 * chooses) are appended by later steps, and the list says so in `not_listed`.
 *
 * ## Determinism
 *
 * The builders are pure: the same findings document, plan, shape and paths give the same list, the
 * same briefs, the same ids and the same question, byte for byte. Only the status line reads a
 * clock, and it takes `now` as an argument so a replay can pin it.
 */

import { DEFAULT_SEAT_MODEL, modelOverrideLine, modelOverrides, seatModelOfRule, type ModelOverride, type SeatModel } from "./seat-model.js";
import { createHash } from "node:crypto";
import { type Stats, accessSync, constants, existsSync, lstatSync, readdirSync, statSync } from "node:fs";
import { readRegularFile } from "./project-read.js";
import { findingsChangedProblem } from "./log-digest.js";
import { appendFileAt, createNewFile, makeFolder, removeEmptyFolder, removePath, writeFileAt } from "./project-write.js";
import { DEEP_AGENT_TYPE, DEEP_FOLDER, DEEP_ID, DEEP_TIME, deepCheckTime, endDeepCheck, writeDeepMarker, type DeepMarker, type DeepSeat, type DeepTracked } from "./hook.js";
import { gitRunner } from "./child-program.js";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { relativePath } from "./project-path.js";
import type { Candidate, Findings, FindingsContextPayloadRow, PerRuleApplicability } from "wolfboy-schemas";
import { LAUNCH_WALL_SECONDS, LIST_PRICE_RATE, PRICE_BASIS_WORDS, PRICE_MODEL, SEAT_TIMES_SOURCE, groupKeyOf, grouped, humanSeconds, IMPORTANT_IS_EVERYTHING, importantRows, priceFor, shapeFigure, shapeHasSecondCheck, roughTokens, secondLookPart, tokenRangeWords, usdRangeWords } from "./cost-preview.js";
import { API_KEY_ENV, step2Destination } from "./scan-profile.js";
import { PASS_EXACTLY, RUN_SHAPE_HEADER, RUN_SHAPE_QUESTION_FILE, type TakenRunShape, markRunShapeAnswerUsed, recordRunShapeDefault, recordRunShapeQuestion, takeRunShape } from "./hook-question.js";
import type { Appended, LaterEntry } from "./launch-later.js";
import { type Carried, carryProblem, carryRunState, readStandingRun, replaceLaunchList, sha256Of, withListLock } from "./launch-list-file.js";
import { type Recorded, kindOf, readProgramFile, refusalFor } from "./program-file.js";
import type { PreLaunchPlan } from "./pre-launch.js";
import { earlierRunWords, type PreviousNotChecked } from "./carry-forward.js";
import { canonicalJson, orientationSheetBeside } from "./rests-on.js";
import { resolve as resolvePath } from "node:path";
import { RUN_SHAPE_ANSWER_FILE, RUN_SHAPE_LEDGER_FILE, type RunShapeAnswer, type RunShapeLedgerLine, loadRunShapeQuestion, readRunShapeLedger } from "./hook-question.js";
import { launchRecordPath } from "./state-record.js";
import { readLaunchList, readRecorded } from "./launch-list-file.js";
import { guardWorkingFolder } from "./legal-dir.js";
import { scannerCommand, toldArgs } from "./scanner-command.js";
import { type StartRecordRead, readStartRecord, writeStartRecord } from "./start-record.js";
import { isChallengeEntry } from "./second-look.js";

export type RunShape = "full" | "important" | "refute_later";
export const RUN_SHAPES: readonly RunShape[] = ["full", "important", "refute_later"];

/**
 * THE HOST'S CEILING ON SUB-AGENTS RUNNING AT ONCE. Measured: live run 1 was refused four launches
 * with "Concurrent subagent limit reached. You can run 20 subagents at once." (annex E16). The
 * person may raise it with `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`, the variable that message names,
 * and the pre-launch step reads it where it is set (`subagentLimitFrom`).
 */
export const PLATFORM_SUBAGENT_LIMIT = 20;

/**
 * PLACES LEFT FREE FOR THE ORCHESTRATOR. In run 1 the orchestrating fork was itself a sub-agent and
 * held the twentieth place, so 19 seats ran at most and four launches were refused (annex E13,
 * E16). One place is kept out of every wave so that an orchestrator running as a sub-agent, or one
 * re-issued launch, does not meet the ceiling.
 */
export const ORCHESTRATOR_RESERVED_PLACES = 1;
/**
 * The option that keeps sub-agents free for the orchestrator.
 * A place is a file and a line in every text the person reads, so the option is named for what it counts; the earlier
 * name, `--reserve-places`, is still accepted (index.ts), and a refusal names the one given.
 */
export const RESERVE_FLAG = "--reserve-subagents";

/** The plugin's name, which prefixes its agent types (`product/plugin/.claude-plugin/plugin.json`; pinned by the gate). */
export const PLUGIN_NAME = "wolfboy";

/**
 * THE MODEL A LISTED LAUNCH NAMES unless the pre-launch step is told another. Every per-seat time and
 * token figure this program prints was measured on `claude-sonnet-5-5` at effort `high`, the level the
 * seats' agent files pin,
 * so a list that launched another
 * model would be priced by figures that do not describe it.
 */
export const SEAT_MODEL: string = DEFAULT_SEAT_MODEL;

/** One measured per-seat wall time, with the conditions it was measured under (proposal section 2.5). */
export interface SeatTimeMeasurement {
  seconds: number;
  statistic: "median" | "longest";
  seats: number;
  date: string;
  tree: string;
  rules_per_seat: string;
  in_flight: string;
  model: string;
  effort: string;
  source: string;
}

/**
 * THE TWO FIGURES THE TIME RANGE IS BUILT FROM: the median and the longest wall time of the 10
 * adjudicator seats of arm H of an internal record (claude-sonnet-5-5 at effort `high`, the level the
 * seats are pinned at), reproduced from its `results/seats.tsv` by an internal record
 * (`median_wall_seconds`, `longest_wall_seconds`); re-derived unchanged with the shared parse
 * a tool. The median
 * is `cost-preview.ts`'s own constant, imported, not copied.
 * They replace two medians on claude-sonnet-5 at effort `max` (174 s on one tree, 671 s on a live run), which no longer
 * describe a pinned seat (arm M, the same payloads at `max`: median 1,358 s).
 */
export const SEAT_TIME_MEASUREMENTS: readonly SeatTimeMeasurement[] = [
  {
    seconds: LAUNCH_WALL_SECONDS,
    statistic: "median",
    seats: 10,
    date: "2026-09-30",
    tree: "an open-source repository",
    rules_per_seat: "up to three rules per seat",
    in_flight: "13 seats in one wave of 20 places",
    model: "claude-sonnet-5-5",
    effort: "high",
    source: SEAT_TIMES_SOURCE,
  },
  {
    seconds: 472,
    statistic: "longest",
    seats: 10,
    date: "2026-09-30",
    tree: "an open-source repository",
    rules_per_seat: "up to three rules per seat",
    in_flight: "13 seats in one wave of 20 places",
    model: "claude-sonnet-5-5",
    effort: "high",
    source: SEAT_TIMES_SOURCE,
  },
];

// ------------------------------------------------------------------------------------------------
// THE LONGEST LINE A SEAT IS HANDED
// ------------------------------------------------------------------------------------------------

/**
 * THE LONGEST LINE A LAUNCH HANDS A SEAT: the brief, and every file it names, is written with no line
 * longer than this. Relayed by the orchestrating session on 2026-09-24 from the confidence-check
 * coordinator's measurement: a seat's Read cuts a line longer than 2,000 characters, and every payload
 * file of the two scans it measured (Jitsi Meet, Element Web) holds 4 to 36 such lines. Run 1's own
 * payload files hold up to 39 each (the longest 15,344 characters) and its orientation notes one of
 * 2,639. Checked in this unit on the Read tool of Claude Code 2.1.281: a 2,498-character line came back
 * whole, so the cut is not in every host - and a seat may run on any. A line the Read cuts loses its
 * tail without saying so, which is the silence this product exists to refuse. Lengths are counted in
 * UTF-16 code units, which are never fewer than characters.
 */
export const READ_LINE_LIMIT = 2000;

/** The one key of the object a line-safe JSON file writes in place of a string too long for one line. */
export const LONG_TEXT_KEY = "long_text_in_parts";

/** A text's line count, how many of its lines are longer than `limit`, and its longest line. */
export function lineStats(text: string, limit = READ_LINE_LIMIT): { lines: number; over_limit: number; longest: number } {
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  let over = 0;
  let longest = 0;
  for (const l of lines) {
    if (l.length > longest) longest = l.length;
    if (l.length > limit) over += 1;
  }
  return { lines: text.length === 0 ? 0 : lines.length, over_limit: over, longest };
}

/**
 * `s` in consecutive parts whose JSON-escaped forms are each at most `budget` characters. A surrogate pair is never split.
 * `atLineBreaks`: a part also ends after each line
 * break of `s`, and a part that would pass the budget ends after its last space where it has one, so that each part is
 * one of the text's own lines or a run of its whole words; the parts joined are `s` either way.
 */
function escapedParts(s: string, budget: number, atLineBreaks = false): string[] {
  const parts: string[] = [];
  let cur = "";
  let width = 0;
  let afterSpace = -1;
  for (const ch of s) {
    const w = JSON.stringify(ch).length - 2;
    if (width + w > budget && cur.length > 0) {
      if (atLineBreaks && afterSpace > 0 && afterSpace < cur.length) {
        const rest = cur.slice(afterSpace);
        parts.push(cur.slice(0, afterSpace));
        cur = rest;
        width = JSON.stringify(rest).length - 2;
      } else {
        parts.push(cur);
        cur = "";
        width = 0;
      }
      afterSpace = -1;
    }
    cur += ch;
    width += w;
    if (atLineBreaks && ch === "\n") {
      parts.push(cur);
      cur = "";
      width = 0;
      afterSpace = -1;
    } else if (atLineBreaks && ch === " ") {
      afterSpace = cur.length;
    }
  }
  if (!atLineBreaks || cur.length > 0 || parts.length === 0) parts.push(cur);
  return parts;
}

/**
 * `value` as `JSON.stringify(value, null, 2)` writes it - byte for byte where every line already fits
 * - except that a string whose line would be longer than `limit` is written as
 * `{"long_text_in_parts": [...]}`, its parts in order, each on a line that fits. `joinLongText` turns
 * the parsed file back into `value`. Throws, rather than write a line a Read would cut, where some
 * line cannot be made to fit (a key longer than the limit) or where the value already holds that key
 * (the file could not be read back unambiguously).
 *
 * `indentUnit` is what each level of nesting adds at the start of a line: two spaces by default, which
 * is `JSON.stringify`'s own form, and "" for the payload's reading copy, which is written without
 * indentation: the same lines, keys and
 * values, with nothing before the first character of any line.
 *
 * `rowsOnOneLine`:
 * an object or array whose whole line - `JSON.stringify`'s own one-line form, after its key and before its comma -
 * fits within `limit` is written on that one line, so a kinds row, a location, a census item or a short excerpt is
 * one line where it was one line per field. The value, the long strings' parts and the limit are the same: only where
 * the lines break changes (a Read's line costs about 3.55 tokens of its own; lines were 11-19 % of a payload's tokens).
 */
export function lineSafeJson(
  value: unknown,
  limit = READ_LINE_LIMIT,
  indentUnit = "  ",
  rowsOnOneLine = false,
  /**
   * Where to record the lines each ATOMIC value was written on (`[first, last]`, 0-based line indices of the result),
   * for `readRanges` to keep whole (build unit F2): `at` is asked with each array element's path (keys and indices
   * from the root). Absent, nothing is recorded and the text is the same either way.
   */
  atomic?: { at: (path: readonly (string | number)[]) => boolean; spans: [number, number][]; paths?: (string | number)[][] },
  /** A long string's parts end at its own line breaks and between words (`escapedParts`); off, the text is as before. */
  partsAtLineBreaks = false,
): string {
  const text = JSON.stringify(value);
  if (text === undefined) throw new Error("the value has no JSON form");
  const plain: unknown = JSON.parse(text);
  const holdsKey = (v: unknown): boolean =>
    v !== null &&
    typeof v === "object" &&
    (Array.isArray(v) ? v.some(holdsKey) : Object.prototype.hasOwnProperty.call(v, LONG_TEXT_KEY) || Object.values(v).some(holdsKey));
  if (holdsKey(plain)) throw new Error(`the value already holds the key "${LONG_TEXT_KEY}", so a line-safe file of it could not be read back unambiguously`);
  const out: string[] = [];
  const push = (line: string): void => {
    if (line.length > limit) throw new Error(`a line of ${line.length} characters cannot be written within ${limit}: ${line.slice(0, 80)}`);
    out.push(line);
  };
  const render = (v: unknown, indent: string, head: string, tail: string, path: (string | number)[] = []): void => {
    if (typeof v === "string") {
      const line = `${head}${JSON.stringify(v)}${tail}`;
      if (line.length <= limit) {
        out.push(line);
        return;
      }
      // The parts sit two levels deeper (object, then array), between two quotes and before a comma.
      const budget = limit - indent.length - 2 * indentUnit.length - 3;
      if (budget < 16) throw new Error(`nested too deep to split a string within ${limit} characters`);
      render({ [LONG_TEXT_KEY]: escapedParts(v, budget, partsAtLineBreaks) }, indent, head, tail, path);
      return;
    }
    if (v === null || typeof v !== "object") {
      push(`${head}${JSON.stringify(v)}${tail}`);
      return;
    }
    if (rowsOnOneLine) {
      const one = `${head}${JSON.stringify(v)}${tail}`;
      if (one.length <= limit) {
        out.push(one);
        return;
      }
    }
    const inner = `${indent}${indentUnit}`;
    if (Array.isArray(v)) {
      if (v.length === 0) {
        push(`${head}[]${tail}`);
        return;
      }
      push(`${head}[`);
      v.forEach((x, i) => {
        const at = [...path, i];
        const first = out.length;
        render(x, inner, inner, i < v.length - 1 ? "," : "", at);
        if (atomic && atomic.at(at)) {
          atomic.spans.push([first, out.length - 1]);
          // Which value each span is, where the caller asks (build unit F3: C7 reads a place's own lines of the copy).
          atomic.paths?.push(at);
        }
      });
      push(`${indent}]${tail}`);
      return;
    }
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0) {
      push(`${head}{}${tail}`);
      return;
    }
    push(`${head}{`);
    entries.forEach(([k, x], i) => render(x, inner, `${inner}${JSON.stringify(k)}: `, i < entries.length - 1 ? "," : "", [...path, k]));
    push(`${indent}}${tail}`);
  };
  render(plain, "", "", "");
  return out.join("\n");
}

/**
 * THE INPUT TO PASS, AS A FILE THE READ TOOL TAKES WHOLE. Every question the program puts through the person's AskUserQuestion is printed as one JSON line after the
 * words `PASS_EXACTLY` (hook-question.ts), and the gates read it there. That line ran to 2,600 characters for four
 * declaration questions and 4,300 for the run-shape question in the paid run of 2026-11-12, so the skill printed it to
 * the person's screen to read it, since a Read may cut a line longer than `READ_LINE_LIMIT`. Every place that prints such
 * a line takes it from here, with the line after it naming this file in the project's `.legal/`: the same object, laid
 * out by `lineSafeJson` with a long text's parts at its own line breaks, so that the skill reads it with the Read tool,
 * which the person's screen shows as one line. The hook compares what is passed with the program's own question file in
 * the state folder, never with this copy, so a copy a repository planted here is refused like any other look-alike.
 */
export const QUESTION_INPUT_FILE = "question-input.json";
export function askInputLines(input: object, legalDir: string): string[] {
  const line = `  ${JSON.stringify(input)}`;
  const path = join(resolve(legalDir), QUESTION_INPUT_FILE);
  try {
    writeFileAt(path, `${lineSafeJson(input, READ_LINE_LIMIT, "  ", false, undefined, true)}\n`);
  } catch (e) {
    return [line, `The same input could not be written to ${path} (${(e as Error).message}); pass the line above.`];
  }
  return [
    line,
    `The same input, as a file the Read tool takes whole: ${path} - read it and pass its object; where a text in it is written as {"${LONG_TEXT_KEY}": [...]}, pass the text its parts make, joined in order with nothing between them.`,
  ];
}

/** The value a line-safe JSON file was written from: each `{"long_text_in_parts": [...]}` joined back into its string. */
export function joinLongText(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(joinLongText);
  if (v !== null && typeof v === "object") {
    const parts = (v as Record<string, unknown>)[LONG_TEXT_KEY];
    if (Object.keys(v).length === 1 && Array.isArray(parts) && parts.every((p) => typeof p === "string")) return parts.join("");
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, joinLongText(x)]));
  }
  return v;
}

/**
 * `text` with every line longer than `limit` broken into lines that fit: at the last space that
 * leaves a piece within the limit (the space becomes the line break), and where a stretch of `limit`
 * characters holds no space, after its last whole character. No character other than those spaces is
 * removed, so the words, in order, are the same.
 */
export function lineSafeText(text: string, limit = READ_LINE_LIMIT): string {
  return text
    .split("\n")
    .map((line) => {
      const pieces: string[] = [];
      let rest = line;
      while (rest.length > limit) {
        let cut = rest.lastIndexOf(" ", limit);
        if (cut > 0) {
          pieces.push(rest.slice(0, cut));
          rest = rest.slice(cut + 1);
          continue;
        }
        cut = limit;
        const unit = rest.charCodeAt(cut - 1);
        if (unit >= 0xd800 && unit <= 0xdbff) cut -= 1;
        pieces.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      pieces.push(rest);
      return pieces.join("\n");
    })
    .join("\n");
}

/**
 * THE MOST ONE READ RANGE HOLDS, WHERE A BRIEF OR A LAUNCH LINE LISTS A FILE'S RANGES.
 * In live run 2 (Claude Code 2.1.283) the adjudicators read their payloads one
 * range per call, 323 calls that did nothing else, each re-sending all that came before it, and 29 refuter calls did
 * the same with their briefs: the ranges were the seats' guesses, and 39 of their Reads were refused as "File content
 * (N tokens) exceeds maximum allowed tokens (25000)" (five whole-file Reads more as over 256 KB). So the program lists
 * the ranges itself, each within one Read, and the seat reads them all in one message. A range is whole lines, at most
 * READ_RANGE_LINES of them (a Read with no limit returns at most 2,000), and at most READ_RANGE_BYTES counting each
 * line's UTF-8 bytes, its line break and the line-number prefix the Read adds (`<n>` and a tab, allowed
 * READ_PREFIX_BYTES). The 39 refusals put the tool's count at 2.28 to 3.08 bytes per token, so 40,000 bytes is at most
 * about 17,600 tokens at the densest text measured; text would need under 1.6 bytes per token to reach the tool's limit.
 */
export const READ_RANGE_BYTES = 40_000;
export const READ_RANGE_LINES = 2000;
export const READ_PREFIX_BYTES = 8;

/** One Read of a file: `offset` its first line (1-based), `limit` its number of lines. */
export interface ReadRange {
  offset: number;
  limit: number;
}

/** BUILD UNIT F4 (full-read design section 3, review R4): the answer seat's fold is at most this many bytes. */
export const FOLD_MAX_BYTES = 100_000;
/** The kept places a file or an item of the fold lists one by one before the rest are id ranges. */
export const FOLD_FIRST_PLACES = 5;
/** The fold is read in at most this many fixed ranges (`place-fold.ts` `layoutFold` pads a range that closes early). */
export const FOLD_RANGES = 3;
/** The lines of one fixed range of the fold. */
export const FOLD_RANGE_LINES = 600;
/** The fold's Reads, fixed before it is written: every line of a fold lies in one of them. */
export const FOLD_READS: readonly ReadRange[] = Array.from({ length: FOLD_RANGES }, (_, i) => ({ offset: i * FOLD_RANGE_LINES + 1, limit: FOLD_RANGE_LINES }));

/**
 * `text` as consecutive ranges of whole lines, each within one Read (`READ_RANGE_BYTES`, `READ_RANGE_LINES`), together
 * every line in order. A text that fits in one Read is one range; an empty text is none. A single line is never split,
 * and a line longer than the budget is a range by itself (no file a seat is handed holds one: `READ_LINE_LIMIT`).
 */
export function readRanges(
  text: string,
  budget = READ_RANGE_BYTES,
  maxLines = READ_RANGE_LINES,
  /**
   * Line spans (`[first, last]`, 0-based) that a range boundary may not cut where the span fits in one range on its own
   * (build unit F2; full-read design 1.4: "a place's window never straddles two ranges unless it is itself larger than
   * a range"). A span larger than one range is cut line by line, and every range holding part of it is listed, as every
   * range is. Absent, the ranges are the ones written before.
   */
  spans: readonly [number, number][] = [],
): ReadRange[] {
  if (text.length === 0) return [];
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const cost = lines.map((line) => Buffer.byteLength(line, "utf8") + 1 + READ_PREFIX_BYTES);
  // Each span that fits in one range, by its first line: kept whole.
  const whole = new Map<number, number>();
  for (const [first, last] of spans) {
    if (first < 0 || last < first || last >= lines.length) continue;
    let b = 0;
    for (let i = first; i <= last; i++) b += cost[i];
    if (last - first + 1 <= maxLines && b <= budget && (whole.get(first) ?? -1) < last) whole.set(first, last);
  }
  const out: ReadRange[] = [];
  let offset = 1;
  let count = 0;
  let bytes = 0;
  for (let i = 0; i < lines.length; ) {
    const last = whole.get(i) ?? i;
    let b = 0;
    for (let j = i; j <= last; j++) b += cost[j];
    const n = last - i + 1;
    if (count > 0 && (count + n > maxLines || bytes + b > budget)) {
      out.push({ offset, limit: count });
      offset = i + 1;
      count = 0;
      bytes = 0;
    }
    count += n;
    bytes += b;
    i = last + 1;
  }
  out.push({ offset, limit: count });
  return out;
}

/**
 * THE ATOMIC VALUES OF A PAYLOAD'S READING COPY (build unit F2): each excerpt (`excerpts[i]`) and each place row
 * (`candidates[j].locations[k]`). A Read range never cuts one of them unless it is larger than a range on its own, which
 * only a place in a seat of its own can be (`context.ts` `PLACE_EXCERPT_MAX_BYTES`, review R15).
 */
export function payloadAtomic(path: readonly (string | number)[]): boolean {
  return (
    (path.length === 2 && path[0] === "excerpts") ||
    (path.length === 4 && path[0] === "candidates" && path[2] === "locations")
  );
}

/** One Read, in the words a brief or a launch line lists it with. */
const rangeWords = (r: ReadRange): string => `\`offset\` ${r.offset} and \`limit\` ${r.limit}`;

/**
 * The launch line's instruction to read the brief (every seat's first call): the brief whole, or, where it is longer
 * than one Read, its ranges read together in one message (run 2: 29 refuter calls paged a brief of up to 61,102
 * characters). The prompt stays one line (`launch-later.ts` `entryFor` checks it).
 */
export function briefReadWords(briefPath: string, briefText: string): string {
  const ranges = readRanges(briefText);
  if (ranges.length <= 1) return `Read your launch brief ${briefPath}`;
  return `Read your launch brief ${briefPath} in these ${ranges.length} ranges, all ${ranges.length} Reads together in one message (${ranges.map(rangeWords).join("; ")})`;
}

// "kept-places": a make-up seat's kept rows (makeup-seat.ts `keptPlacesFiles`).
export type ReadRole = "payload" | "run-context" | "orientation-sheet" | "orientation-notes" | "fold" | "kept-places";

/** One file a brief names, as the seat reads it. */
export interface SeatRead {
  role: ReadRole;
  /** The path the brief names. */
  path: string;
  /** Its length in lines, where the file exists at pre-launch (the fold is written later, by its command). */
  lines?: number;
  /**
   * sha256 of the file at `path` as the pre-launch step named it: the reading copy where it wrote one,
   * else the file itself (the run context's is recorded where `writeLaunchList` writes it; the fold has
   * none). A later command reads a file back only while it has this digest (`launch-list-file.ts`).
   */
  sha256?: string;
  /**
   * Set where the file another step wrote holds a line longer than `READ_LINE_LIMIT`: the seat reads
   * the program's line-safe reading copy at `path`, made from this file.
   */
  copied_from?: { path: string; sha256: string; lines_over_limit: number; longest_line: number };
}

/**
 * What a seat reads of a file some other step wrote: the file itself where none of its lines is
 * longer than the limit, and otherwise a line-safe reading copy under `<launch dir>/reading/` at the
 * file's path relative to `baseDir` - JSON re-written by `lineSafeJson`, any other text by
 * `lineSafeText`. Reads; writes nothing (the copy's text is returned for `writeLaunchList`). The file is read
 * through the one reader of program-written files (program-file.ts; relay integration part B, item 8): a regular
 * file with one name, opened without blocking, and - where `recorded` is given - only while it still has the digest
 * recorded for it (A-54: a payload against the scan's row digest). Anything else is thrown, by name.
 *
 * A payload is read through a copy even where no line is too long, because the copy is written without indentation
 * (cost step 1, B2(iii): 10.5 % of run 2's payload bytes were indentation) and with each row that fits on one line
 * (`lineSafeJson`'s `rowsOnOneLine`); where that copy would be the file's own
 * text, the file itself is named. Also returned: `ranges`, the Reads that take in what the seat reads (`readRanges`).
 */
export function seatReadOf(
  role: ReadRole,
  path: string,
  launchDir: string,
  baseDir: string,
  limit = READ_LINE_LIMIT,
  recorded?: Recorded,
): { read: SeatRead; copy: string | null; ranges: ReadRange[] } {
  const got = readProgramFile(`the ${role} file`, path, recorded);
  if (!got.ok) {
    if (got.exit === "unreadable" && (got.code === "ENOENT" || got.code === "ENOTDIR")) throw new Error(`the ${role} file ${path} does not exist, so no brief may name it`);
    throw new Error(`${got.problem}; no brief may name it`);
  }
  const bytes = got.value;
  const text = bytes.toString("utf8");
  const stats = lineStats(text, limit);
  const unindented = role === "payload" && path.endsWith(".json");
  const own = { read: { role, path, lines: stats.lines, sha256: sha256Of(bytes) }, copy: null, ranges: readRanges(text) };
  if (stats.over_limit === 0 && !unindented) return own;
  const rel = relativePath(baseDir, path);
  const copyPath = join(launchDir, "reading", rel.startsWith("..") || isAbsolute(rel) ? basename(path) : rel);
  let copy: string;
  // A payload's excerpts and place rows are kept whole by its Read ranges (build unit F2).
  const atomic = { at: payloadAtomic, spans: [] as [number, number][] };
  if (path.endsWith(".json")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`the ${role} file ${path} is not JSON, so no line-safe copy of it can be written`);
    }
    copy = `${lineSafeJson(parsed, limit, unindented ? "" : "  ", unindented, unindented ? atomic : undefined)}\n`;
  } else {
    copy = lineSafeText(text, limit);
  }
  if (copy === text) return own;
  const hash = (s: string): string => createHash("sha256").update(s).digest("hex");
  return {
    read: {
      role,
      path: copyPath,
      lines: lineStats(copy, limit).lines,
      sha256: hash(copy),
      copied_from: { path, sha256: hash(text), lines_over_limit: stats.over_limit, longest_line: stats.longest },
    },
    copy,
    ranges: readRanges(copy, READ_RANGE_BYTES, READ_RANGE_LINES, atomic.spans),
  };
}

export type SeatRole = "adjudicator" | "reader" | "verdict-after-readers";

/**
 * The whole `Agent` input of one launch: the four fields every Claude Code session the probes saw offers (2.1.281;
 * 2.1.283 in its fork mode, the default of an interactive session, and outside it). No other field is set; the launch
 * gate compares every one (hook-launch.ts `matchLaunch`). `run_in_background` is not one of them:
 * 2.1.283 offers it only outside its fork mode (an interactive session's default) and with background tasks on, and
 * drops it from a call elsewhere, so an entry that named it was refused at every launch of the owner's second real run. A call without it runs in the background in every session
 * the probes saw where background tasks are on (2.1.281 runs A-D, H, J-L; 2.1.283 runs P1, P2, P4, P5), which is the
 * form the gate needs; the entry states that requirement beside its input (`LaunchEntry.launch`).
 */
export interface AgentInput {
  subagent_type: string;
  description: string;
  prompt: string;
  model: string;
}

/**
 * How every listed seat is launched: in the background. A foreground launch's result, and so the launch hook's binding
 * of the entry to the seat, arrives only after the seat has answered (probe runs E and I on 2.1.281, P3 on 2.1.283:
 * `status: "completed"`), so the capture could not tell whose answer it is; the launch gate refuses a launch that sets
 * `run_in_background` to false, every launch in a session with background tasks turned off, and every later launch of a
 * session whose launch result said it ran a seat in the foreground. A list written by an earlier version
 * names the same requirement as `run_in_background: true` inside each `agent_input`, and the gate takes both.
 */
export const LAUNCH_FORM = "background";

export interface LaunchEntry {
  /** `seat-` and the first 12 hex digits of the sha256 of the payload key: stable across rewrites of the list. */
  id: string;
  /** 1-based position in the list; the launch order within a wave. */
  order: number;
  wave: number;
  role: SeatRole;
  payload_key: string;
  group_key: string;
  /** Absolute path of the payload file the scan wrote. Where it holds a line longer than `READ_LINE_LIMIT`, the brief names the program's line-safe reading copy of it (`reads`). */
  payload_path: string;
  /**
   * Every file the brief names, as the seat reads it: the payload (or its reading copy), the orientation
   * sheet and notes where they were written, and a verdict seat's fold. None holds a line longer than
   * `READ_LINE_LIMIT`. Not the run context: since cost step 1 (B2(i)) the brief carries the profile and
   * the whole dependency inventory, one line per package, itself, and `run-context.json` is on `run_reads` only.
   */
  reads: SeatRead[];
  /** The candidates this seat answers (for a reader: the one candidate it reads a slice of). */
  finding_ids: string[];
  rule_ids: string[];
  reader?: { index: number; of: number };
  /** Entries that must have returned before this one is launched. */
  after: string[];
  /** On a make-up seat only (design 1.7, launch-list-file.ts `withMakeupEntry`): the entry it is the make-up seat of. */
  makeup_of?: string;
  /**
   * For a verdict seat after readers: the fold file its brief names, and the command that writes it, made as every told
   * command is (scanner-command.ts `scannerCommand`), so it runs exactly as written. Until that change it was a bare `legal-scan verdict-reading ...`
   * that the skill told the orchestrator to prefix with the plugin's bin folder.
   */
  fold?: { file: string; command: string };
  brief_path: string;
  brief_sha256: string;
  /** Every seat is launched in the background (`LAUNCH_FORM`): stated here, beside the input, because no field of the input can say it in every session. */
  launch: typeof LAUNCH_FORM;
  agent_input: AgentInput;
  /** sha256 of `canonicalJson(agent_input)`: what a byte-for-byte comparison of the whole input compares. */
  agent_input_sha256: string;
}

export interface LaunchList {
  kind: "launch-list";
  version: 1;
  scan_id: string;
  run_id: string;
  shape: RunShape;
  model: string;
  /**
   * Every rule this list reads on a model other than its own `seat_model`, with its place count (review R18): present
   * only where the run-wide `--seat-model` put a rule on another model, so that an override is never silent.
   */
  model_overrides?: ModelOverride[];
  /** Effort is not a field of the `Agent` input: a launch cannot name an effort level. */
  effort: string;
  subagent_limit: number;
  subagent_limit_source: string;
  reserved_places: number;
  wave_capacity: number;
  run_context_path: string;
  /**
   * The files every seat of the run is handed whatever its payload - the run context, and the orientation
   * sheet and the orchestrator's paragraph where they exist - each with the sha256 the pre-launch step
   * recorded, on the list itself: a list with no verdict entry (the `important` shape where no payload is
   * important) has them too, and the silence command reads them from here.
   */
  run_reads?: SeatRead[];
  /**
   * The findings document the list was made from and its sha256 as the pre-launch step read it: the later
   * commands read that document, and only while it has this digest (`launch-list-file.ts`). Absent only
   * where no document was on disk when the list was built (unit fixtures).
   */
  findings?: { path: string; sha256: string };
  /**
   * Build unit F5 M3: the pre-launch plan this list was made from, where it holds carried rows (`carried_places`): the
   * fold command and the capture read them from it, only while it has this digest (carried-places.ts).
   */
  plan?: { path: string; sha256: string };
  /** The pre-launch step's entries, then the refuter and silence entries appended later (`launch-later.ts`). */
  entries: (LaunchEntry | LaterEntry)[];
  waves: { wave: number; entries: string[] }[];
  not_listed: string[];
  /** The requests the later entries were appended for, in order (`launch-later.ts`). */
  appended?: Appended[];
  /**
   * The relay entries, appended by `relay-entry` (relay-seat.ts). Kept apart from `entries`, so that no
   * step that counts, relaunches or assembles the seats' entries ever sees one: a relay is launched once from here and
   * the launch gate checks it byte for byte, and it holds no place, no record and no answer.
   */
  relays?: RelayEntry[];
}

/** One relay entry: the Agent input that launches the relay, with the entries its prompt hands it first. */
export interface RelayEntry {
  /** `relay-<n>`, n counting this list's relay entries from 1. */
  id: string;
  role: "relay";
  launch: typeof LAUNCH_FORM;
  agent_input: { subagent_type: string; description: string; prompt: string; model: string };
  agent_input_sha256: string;
  /** The entries whose inputs the prompt holds, as the launch gate's computation listed them when it was written. */
  first: string[];
  written_at: string;
}

/**
 * THE CAPTURE KEY OF A LISTED ENTRY: the one rule.
 * It is the `--key` the capture takes for the entry's answer: it names the record, and for a pre-launch entry it is
 * also the payload whose candidates the seat answers. The list's two entry types carry it in two fields, decided by
 * the entry's role: a pre-launch entry (adjudicator, reader, verdict-after-readers) as `payload_key`; a later entry
 * (refuter, silence-investigator; launch-later.ts) as `capture_key` - a silence entry's batch name, and none for a
 * refuter handed one candidate. Null where the entry carries none. Every reader of an entry's key calls this - the
 * capture's binding (hook-capture.ts), the later commands (launch-later.ts), the assembly (assemble-hooked.ts) and the
 * gates - and none reads either field itself: a capture that read `payload_key` alone meant that
 * no silence investigator's answer was ever captured.
 */
export function captureKeyOf(entry: unknown): string | null {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
  const e = entry as { role?: unknown; payload_key?: unknown; capture_key?: unknown };
  const key = e.role === "refuter" || e.role === "silence-investigator" ? e.capture_key : e.payload_key;
  return typeof key === "string" && key !== "" ? key : null;
}

/** The id of a run: a digest of what the run is over, so both pre-launch calls of one run agree on it. */
export function runIdFor(plan: PreLaunchPlan, scanId: string): string {
  const basis = canonicalJson({
    scan_id: scanId,
    previous_scan: plan.carried.from_scan,
    remaining_payloads: plan.remaining_payloads,
    to_adjudicate: plan.to_adjudicate,
  });
  return `run-${createHash("sha256").update(basis).digest("hex").slice(0, 12)}`;
}

/** A whole number of 0 or more, as digits the person typed or as a number; anything else is null. */
const wholeNumber = (v: unknown): number | null => {
  const n = typeof v === "string" && /^[0-9]+$/.test(v.trim()) ? Number(v.trim()) : typeof v === "number" ? v : Number.NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

/** The host's variable for the sub-agents it runs at once (Claude Code's; host-env.ts lists it). */
export const SUBAGENT_LIMIT_ENV = "CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS";

/**
 * The ceiling this run plans under: `--subagent-limit` where it is given, else the variable where it
 * is a whole number of at least 1, else the host's default. A flag that is given and is not such a
 * number is refused, never replaced: a mistyped limit plans waves the host cannot run, which is run
 * 1's lost-launch failure (annex E16). A variable that is set but cannot be used is named in `source`.
 */
export function subagentLimitFrom(flag: unknown, env: string | undefined): { limit: number; source: string } | { refused: string } {
  if (flag !== undefined) {
    const fromFlag = wholeNumber(flag);
    if (fromFlag === null || fromFlag < 1) return { refused: `--subagent-limit must be a whole number of at least 1; got ${String(flag)}. No run-shape question and no launch list were written.` };
    return { limit: fromFlag, source: "--subagent-limit" };
  }
  const envSet = env !== undefined && env.trim() !== "";
  const fromEnv = envSet ? wholeNumber(env) : null;
  if (fromEnv !== null && fromEnv >= 1) return { limit: fromEnv, source: SUBAGENT_LIMIT_ENV };
  return {
    limit: PLATFORM_SUBAGENT_LIMIT,
    source: envSet
      ? `the host's default; ${SUBAGENT_LIMIT_ENV} is set to ${JSON.stringify(env)}, which is not a whole number of at least 1, so it was not used`
      : "the host's default",
  };
}

/**
 * Why a run leaves no sub-agent for a seat, in terms of the limit and the sub-agents kept free in force and of
 * where each came from: the option the person gave is the one named (`--reserve-places`, the earlier name, where that
 * was given), and nothing is named that was not given. B1b and B2 each reworded "place(s)"
 * for these sub-agents; B2's words are the one wording kept, here and in the run-shape question's time paragraph.
 */
function noPlaceLeft(limit: number, source: string, reserved: number | null, reserveGiven: unknown, flag: string = RESERVE_FLAG): string {
  if (reserveGiven !== undefined && (reserved === null || source !== "--subagent-limit")) {
    return `${flag} must be a whole number from 0 to ${limit - 1} (the sub-agent limit is ${limit}, from ${source}); got ${String(reserveGiven)}. No run-shape question and no launch list were written.`;
  }
  if (source === "--subagent-limit") {
    return reserveGiven !== undefined
      ? `--subagent-limit must be greater than ${flag}; got --subagent-limit ${limit} and ${flag} ${String(reserveGiven)}. No run-shape question and no launch list were written.`
      : `--subagent-limit must be greater than the ${reserved} sub-agent(s) kept free for the orchestrator (the default of ${flag}); got ${limit}. Give ${Number(reserved) + 1} or more, or ${flag} 0. No run-shape question and no launch list were written.`;
  }
  return `The sub-agent limit is ${limit}, from ${source}, which leaves no sub-agent for a seat once ${reserved} ${reserved === 1 ? "is" : "are"} kept free for the orchestrator (the default of ${flag}): give ${toldArgs(["--subagent-limit", String(Number(reserved) + 1)])} or more, or ${flag} 0. No run-shape question and no launch list were written.`;
}

/** The rows a shape launches, in the plan's order. `important` is `cost-preview.ts`'s selection, not a copy. */
export function rowsForShape(shape: RunShape, remainingCandidates: Candidate[], remainingRows: FindingsContextPayloadRow[]): FindingsContextPayloadRow[] {
  return shape === "important" ? importantRows(remainingCandidates, remainingRows) : remainingRows;
}

interface Skeleton {
  id: string;
  row: FindingsContextPayloadRow;
  role: SeatRole;
  groupKey: string;
  reader?: { index: number; of: number };
  after: string[];
  order: number;
  wave: number;
  /** Build unit F5 M3: a verdict seat's readers that are not launched, because every place each holds is carried. */
  carried?: number[];
}

const seatId = (payloadKey: string): string => `seat-${createHash("sha256").update(payloadKey).digest("hex").slice(0, 12)}`;
const readerIndexOf = (key: string): number | null => {
  const m = /#reader-([0-9]+)$/.exec(key);
  return m ? Number(m[1]) : null;
};

/**
 * THE SEATS AND THEIR WAVES. Readers first, because a verdict seat after readers waits for all of
 * them and they are the longest path; then the ordinary seats; then the verdict seats after
 * readers. A wave holds at most `capacity` launches, and an entry is never in the wave of an entry it
 * waits for. The waves are the order and the most that may be in flight at once, not a barrier: a
 * later entry goes as soon as a place is free and what it waits for has returned.
 */
export function seatSkeleton(
  rows: FindingsContextPayloadRow[],
  capacity: number,
  /** Build unit F5 M3: by group key, the reader indices that are not launched (carried-places.ts). */
  carriedReaders?: ReadonlyMap<string, number[]>,
): Skeleton[] {
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error(`wave capacity must be a positive integer, got ${capacity}`);
  const readersOf = new Map<string, FindingsContextPayloadRow[]>();
  for (const row of rows) {
    if (readerIndexOf(row.key) === null) continue;
    const g = groupKeyOf(row);
    const list = readersOf.get(g);
    if (list) list.push(row);
    else readersOf.set(g, [row]);
  }
  const readers: Skeleton[] = [];
  const plain: Skeleton[] = [];
  const afterReaders: Skeleton[] = [];
  for (const row of rows) {
    const groupKey = groupKeyOf(row);
    const idx = readerIndexOf(row.key);
    const base = { id: seatId(row.key), row, groupKey, after: [] as string[], order: 0, wave: 0 };
    // Build unit F5 M3: a reader that is not launched still counts among its candidate's readers, and a verdict seat
    // whose readers are all carried is still the verdict seat after readers (it answers over the carried rows).
    const carried = carriedReaders?.get(groupKey) ?? [];
    if (idx !== null) readers.push({ ...base, role: "reader", reader: { index: idx, of: (readersOf.get(groupKey)?.length ?? 0) + carried.length || 1 } });
    else if (readersOf.has(groupKey) || carried.length > 0)
      afterReaders.push({ ...base, role: "verdict-after-readers", after: (readersOf.get(groupKey) ?? []).map((r) => seatId(r.key)), ...(carried.length > 0 ? { carried: [...carried] } : {}) });
    else plain.push({ ...base, role: "adjudicator" });
  }
  const ordered = [...readers, ...plain, ...afterReaders];
  const waves = packWaves(ordered, capacity);
  ordered.forEach((s, i) => {
    s.wave = waves[i] as number;
    s.order = i + 1;
  });
  return ordered;
}

/**
 * THE WAVE RULE, for the seats of a shape (`seatSkeleton`) and for what remains of a run (`runRemainder`):
 * in the given order, each entry one wave after the latest wave of what it waits for (a wait on an entry not in the
 * set counts as met), in the first wave with a place left.
 */
function packWaves(ordered: { id: string; after: string[] }[], capacity: number): number[] {
  const waveOf = new Map<string, number>();
  const size = new Map<number, number>();
  return ordered.map((s) => {
    let w = 1 + Math.max(0, ...s.after.map((a) => waveOf.get(a) ?? 0));
    while ((size.get(w) ?? 0) >= capacity) w += 1;
    size.set(w, (size.get(w) ?? 0) + 1);
    waveOf.set(s.id, w);
    return w;
  });
}

/**
 * WHAT REMAINS OF A RUN. Live run 2's second attempt kept the run's
 * state - 122 of its 126 listed seats had answered - and still priced the whole plan ("126 launch(es)"). Where a list of
 * the run stands (launch-list-file.ts `readStandingRun`, the reader `carryRunState` writes over), each shape is priced
 * by what the list it would write still has to launch: its seats (`seatSkeleton`) and the entries the run appended,
 * which the list carries, less the entries answered or kept not judged (`done`: the relaunch rule's decision, which the
 * caller reads - entry-answer.ts; this module does not import it). A shape `carryRunState` would refuse is named as
 * refused, in its words (`carryProblem`, one check for both). Null where no list of the run stands or no `done` is given.
 */
export interface RunRemainder {
  /** The standing list: its shape, its entries, and how many are answered or kept not judged. */
  shape: string;
  listed: number;
  done: number;
  /** `refuters` and `other`: how many of `remaining` are entries the run appended (not rows of the plan), for the price. */
  byShape: Map<RunShape, { remaining: string[]; of: number; waves: number; appended_refuters: number; appended_other: number } | { refused: string }>;
}

function runRemainder(
  launchDir: string,
  runId: string,
  shapes: RunShape[],
  remainingCandidates: Candidate[],
  remainingRows: FindingsContextPayloadRow[],
  capacity: number,
  done: ((entryId: string) => boolean) | null,
): RunRemainder | null {
  if (done === null) return null;
  const listPath = join(launchDir, "launch-list.json");
  const standing = readStandingRun(listPath, runId);
  if (standing.state !== "read") return null;
  const s = standing.run;
  const byShape: RunRemainder["byShape"] = new Map();
  for (const shape of shapes) {
    const entries = [
      ...seatSkeleton(rowsForShape(shape, remainingCandidates, remainingRows), capacity).map((k) => ({ id: k.id, after: k.after, role: k.role as string })),
      ...s.appended.map((e) => ({ id: e.id, after: e.after ?? [], role: e.role as string, challenge: isChallengeEntry(e) })),
    ];
    // A second look (a refuter entry in challenge mode) is the recommended shape's own;
    // it is still priced as a refuter seat below (`appended_refuters`), at the second check's rate.
    const problem = carryProblem(s, runId, listPath, shape, new Set(entries.map((e) => e.id)), entries.filter((e) => e.role === "refuter" && !("challenge" in e && e.challenge)).map((e) => e.id));
    if (problem !== null) {
      byShape.set(shape, { refused: problem });
      continue;
    }
    const left = entries.filter((e) => !done(e.id));
    const leftIds = new Set(left.map((e) => e.id));
    const waves = packWaves(left.map((e) => ({ id: e.id, after: e.after.filter((a) => leftIds.has(a)) })), capacity);
    const appendedIds = new Set(s.appended.map((e) => e.id));
    const leftAppended = left.filter((e) => appendedIds.has(e.id));
    byShape.set(shape, {
      remaining: left.map((e) => e.id),
      of: entries.length,
      waves: Math.max(0, ...waves),
      appended_refuters: leftAppended.filter((e) => e.role === "refuter").length,
      appended_other: leftAppended.filter((e) => e.role !== "refuter").length,
    });
  }
  return { shape: s.list.shape, listed: s.list.entries.length, done: s.list.entries.filter((e) => done(e.id)).length, byShape };
}

const idsOf = (ids: string[]): string => `${ids.slice(0, 8).join(", ")}${ids.length > 8 ? `, and ${ids.length - 8} more` : ""}`;

/** How many waves a shape takes: the number the time range multiplies. */
export function waveCount(rows: FindingsContextPayloadRow[], capacity: number): number {
  return Math.max(0, ...seatSkeleton(rows, capacity).map((s) => s.wave));
}

export interface LaunchListArgs {
  /** The scan's `ships_premises`; absent, the brief carries no premise lines. */
  shipsPremises?: Readonly<Record<string, { premise: string; because?: { file: string; line: number; quote: string }[]; conflict?: string[] }>>;
  /** Build unit F5 M3: by group key, the reader indices that are not launched (their places are all carried). */
  carriedReaders?: ReadonlyMap<string, number[]>;
  /** Build unit F5 M3: the pre-launch plan that holds the carried rows, by path and digest, recorded on the list. */
  planFile?: { path: string; sha256: string };
  scanId: string;
  runId: string;
  shape: RunShape;
  /** The candidates the pre-launch step left to adjudicate. */
  remainingCandidates: Candidate[];
  /**
   * Every candidate of the scan (the parent's addition 1, 2026-09-25): a payload the declaration reduced, or one a
   * previous run's verdicts were carried out of, still holds candidates this run does not ask its seat to answer, and
   * the brief names them as such. Absent, a brief names only the candidates it asks for.
   */
  allCandidates?: Candidate[];
  /** The payload rows the pre-launch step left standing, in the scan's order. */
  remainingRows: FindingsContextPayloadRow[];
  applicability: PerRuleApplicability | null;
  /** Absolute paths. Payload rows are relative to the findings document's directory. */
  findingsPath: string;
  launchDir: string;
  orientationSheet: string | null;
  orientationNotes: string | null;
  /** The run context's length in lines, where the caller has rendered it: a brief states it when it is past what one Read returns. */
  runContextLines?: number;
  /**
   * The run context the pre-launch step writes to `run-context.json`. Each adjudicator's brief carries the profile and
   * the whole dependency inventory, one line per package, itself (cost step 1, B2(i)); the file stays for the silence command.
   */
  runContext: RunContext;
  profileSupplied: boolean;
  subagentLimit: number;
  subagentLimitSource: string;
  reservedPlaces: number;
  model: string;
  /**
   * The person's run-wide `--seat-model`, where one was given (full-read design 1.6). Absent: every seat is launched on
   * its bin's own model (`adjudication_group.seat_model`, the rules' own setting), and `model` above is only the default
   * for a document that names none. Given: every seat is launched on it, and the list names every rule then read on a
   * model other than its own setting (`model_overrides`, review R18).
   */
  seatModelOverride?: string;
  /** For the fold command a verdict seat after readers waits on. */
  verdictsDir: string;
  readersDir: string;
  /**
   * The later reading: by finding id, the places a previous run's verdict left unread, from the plan's
   * partition rows (`PartitionRow.previous_not_checked`). A brief asking about such a candidate names them to its seat.
   */
  previousNotChecked?: Record<string, PreviousNotChecked>;
}

/**
 * The brief's section on the places a previous run did not read: for each asked candidate the plan names
 * some for, the count, the scan, and every located place by file, each line under the Read limit. Empty when none.
 */
export function previousNotCheckedText(asked: string[], byFinding: Record<string, PreviousNotChecked> | undefined): string[] {
  const named = asked.filter((id) => (byFinding?.[id]?.places ?? 0) > 0);
  if (!byFinding || named.length === 0) return [];
  const out = [
    "",
    "## Places a previous run did not read",
    "The person asked for these places to be read in this run. The previous run's review of the candidate(s) below left them unread, and the person was shown them as not checked.",
  ];
  for (const id of named) {
    const p = byFinding[id] as PreviousNotChecked;
    out.push(
      `- \`${id}\`: ${p.places} place(s) not read in ${earlierRunWords(p.scan_id, { who: "the person" })}` +
        (p.unlisted > 0 ? `; ${p.unlisted} of them are not located here (the scan's findings document lists every matched line of this candidate)` : "") +
        (p.locations.length > 0 ? ":" : "."),
    );
    const byFile = new Map<string, string[]>();
    for (const l of p.locations) {
      const at = l.lastIndexOf(":");
      const file = at > 0 ? l.slice(0, at) : l;
      byFile.set(file, [...(byFile.get(file) ?? []), at > 0 ? l.slice(at + 1) : "?"]);
    }
    for (const [file, lines] of byFile) {
      const head = `  - \`${file}\`: line(s) `;
      let chunk: string[] = [];
      const flush = (): void => {
        if (chunk.length > 0) out.push(`${head}${chunk.join(", ")}`);
        chunk = [];
      };
      for (const line of lines) {
        if (head.length + [...chunk, line].join(", ").length > READ_LINE_LIMIT - 100) flush();
        chunk.push(line);
      }
      flush();
    }
  }
  out.push(
    "Read them where your payload hands them to you: open a unit or a member in `also`, or settle it on a shape ground in `rest` where one holds. " +
      "A place counts as opened only where you Read the file around its line: a line seen in a search result is not opened, and is shown to the person as not checked. " +
      "A place you do not read is declined with your sentence where your role lets you decline, and the person is shown it again as not checked; never leave one out.",
  );
  return out;
}

const sortedUnique = (xs: string[]): string[] => [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
const safeName = (s: string): string => s.replace(/[^A-Za-z0-9._-]/g, "_");

/** The brief of one seat: every fact the launch carries, in the program's words. */
interface BriefReads {
  payload: ListedRead;
  sheet: ListedRead | null;
  notes: ListedRead | null;
  /** The run context this brief carries itself (cost step 1, B2(i)): the profile, and the inventory in lines (`inventoryLine`). */
  context: { profile: unknown; profileNote: string; inventory: readonly unknown[] };
}

/** What each file a brief names is, in the words of a copy note (and of the launch gate's refusals, hook-launch.ts). */
export const READ_ROLE_WORDS: Record<ReadRole, string> = {
  payload: "the payload file the scan wrote",
  "run-context": "the run context",
  "orientation-sheet": "the orientation sheet the scan wrote",
  "orientation-notes": "the orchestrator's paragraph about this repository",
  fold: "the readers' fold",
  "kept-places": "the rows of places the seat before read, kept by the program",
};

/**
 * What a brief says under a file it names where the seat reads the program's reading copy of it. The
 * file the copy was made from holds the long lines, so the note identifies it by its sha256 and never
 * names its path: the brief says that no file it names holds such a line, and the one place that path
 * is kept is the list's `reads[].copied_from`, which the program and the hooks read and a seat does not.
 */
const copyNote = (r: SeatRead): string[] => {
  if (!r.copied_from) return [];
  const n = r.copied_from.lines_over_limit;
  const long = `${n} of that file's lines ${n === 1 ? "is" : "are"} longer than ${READ_LINE_LIMIT} characters, which a Read may cut without saying so`;
  // Cost step 1, B2(iii): a payload's copy is written without indentation, whether or not a line of it was too long.
  const why = r.role === "payload" ? (n > 0 ? `it is written without indentation, and ${long}` : "it is written without indentation") : long;
  return [`This is the program's ${n > 0 ? "line-safe " : ""}reading copy of ${READ_ROLE_WORDS[r.role]} (sha256 ${r.copied_from.sha256}): ${why}. Its content is the same: read this copy, not that file.`];
};

/** A file a brief names, with the Reads that take it in (`seatReadOf`'s `ranges`). */
interface ListedRead {
  read: SeatRead;
  ranges: ReadRange[];
}

// ------------------------------------------------------------------------------------------------
// THE DEPENDENCY INVENTORY A BRIEF CARRIES
// ------------------------------------------------------------------------------------------------

/** A value of an inventory entry as its one line writes it: a string as it is, anything else as JSON. */
const plain = (v: unknown): string => (typeof v === "string" ? v : (JSON.stringify(v) ?? "none"));

/**
 * ONE INVENTORY ENTRY IN ONE LINE, EVERY FIELD KEPT: the package, each of its `declared` entries (`field`, `version`
 * and `ecosystem` at `file`:`line`), `call_site_count`, each of its `call_sites` as `file`:`line`, `declared_only`
 * where it is true, and `call_sites_not_read` where present (no call site found while lines that could hold
 * one were not read, so the line says the absence was NOT READ rather than claiming it). Every adjudicator's brief carries the whole inventory in this form instead of the run context's
 * pretty-printed JSON (35,033 bytes in live run 2, whose 73 packages take 12,472 bytes as lines). No entry is cut to
 * the payload it serves: in run 2 the adjudicator of `bin:19` cited the call site of a package its payload never names
 * ("the analytics call site at src/services/analytics.js per the dependency inventory", a made-up path of the same shape).
 */
export function inventoryLine(e: unknown): string {
  const o = (e !== null && typeof e === "object" ? e : {}) as { package?: unknown; declared?: unknown; call_site_count?: unknown; call_sites?: unknown; declared_only?: unknown; call_sites_not_read?: unknown };
  const at = (x: unknown): { file?: unknown; line?: unknown; version?: unknown; field?: unknown; ecosystem?: unknown } => (x !== null && typeof x === "object" ? x : {});
  const declared = (Array.isArray(o.declared) ? o.declared : []).map((d) => {
    const x = at(d);
    return `${plain(x.field)} ${plain(x.version)} (${plain(x.ecosystem)}) at ${plain(x.file)}:${plain(x.line)}`;
  });
  const sites = (Array.isArray(o.call_sites) ? o.call_sites : []).map((c) => `${plain(at(c).file)}:${plain(at(c).line)}`);
  const unread = o.call_sites_not_read !== null && typeof o.call_sites_not_read === "object" ? (o.call_sites_not_read as { lines_past_ceiling?: unknown; files?: unknown }) : null;
  return (
    `- \`${plain(o.package)}\`: declared ${declared.length > 0 ? declared.join(", ") : "nowhere"}; call_site_count ${plain(o.call_site_count)}` +
    `${sites.length > 0 ? `; call_sites ${sites.join(", ")}` : ""}${o.declared_only === true ? "; declared_only" : ""}` +
    `${unread ? `; call_sites_not_read (${plain(unread.lines_past_ceiling)} line(s) past the line ceiling and ${plain(unread.files)} file(s) not read to their end could hold a call site: whether it is imported was NOT READ)` : ""}`
  );
}

/** The run context every brief is made with: what the pre-launch step writes to `run-context.json`. */
export interface RunContext {
  kind: "run-context";
  scan_id: string;
  run_id: string;
  profile: unknown;
  profile_note: string;
  dependency_inventory: unknown[];
}

function briefText(args: LaunchListArgs, s: Skeleton, members: Candidate[], premises: string[], fold: { file: string } | undefined, reads: BriefReads, readerIds: string[], notAsked: string[], ships: string[] = []): string {
  const rules = sortedUnique(members.map((c) => c.rule_id));
  // BUILD UNIT F4 (full-read design section 3): a verdict seat after the place seats of a place-plan candidate is its
  // answer seat, handed the bounded fold, read in the fold's fixed ranges.
  const answerMode = s.role === "verdict-after-readers" && (members[0]?.reading_plan as { unit?: string } | undefined)?.unit === "place";
  // The parent's addition 1 (2026-09-25): the brief names exactly the ids the seat answers - the entry's `finding_ids`,
  // the ids the capture checks the answer against - and the payload's other candidates as not asked. Before the relay
  // the orchestrator named them in the launch message; the one-line launch has no room for them.
  const asked = sortedUnique(members.map((c) => c.finding_id));
  const idList = (ids: string[]): string => ids.map((i) => `\`${i}\``).join(", ");
  const role =
    s.role === "reader"
      ? `You are reader ${s.reader?.index} of ${s.reader?.of} for candidate \`${members[0]?.finding_id ?? "(none)"}\` of rule ${rules.join(", ")}: one of several readers, in reading mode. Your payload holds your slice of its kinds.`
      : s.role === "verdict-after-readers" && answerMode
        ? `You are the answer seat for candidate \`${members[0]?.finding_id ?? "(none)"}\` of rule ${rules.join(", ")}, in answer mode: its ${readerIds.length} place seat(s) were launched before you and decided every place of it one by one, and you hold the program's fold of their place rows. You decide no place yourself and write no \`decisions\`: you answer the candidate once, from the fold, the per-place table it names and any window you open (the agent text's "Answer mode"). Where the fold lists places not checked because their seat gave no answer (\`not_answered\`), nobody read them, and your verdict over this candidate is \`needs_human\`, naming how many.`
        : s.role === "verdict-after-readers"
        ? `You are the verdict seat for candidate \`${members[0]?.finding_id ?? "(none)"}\` of rule ${rules.join(", ")}, in verdict mode: its ${readerIds.length} reader(s) were launched to read its kinds before you, and you hold the program's fold of what they returned. The fold says which of them returned. Where it names a reader whose answer is not on disk (it did not return, or its answer was kept invalid), nobody read the units that reader held, and your verdict over this candidate is \`needs_human\`, naming how many units were not read.`
        : `You are the verdict seat for payload group \`${s.groupKey}\`: ${members.length} candidate(s) of rule(s) ${rules.join(", ")}.`;
  const lines = [
    `# Launch brief ${s.id}`,
    "",
    `Written by the pre-launch step (\`legal-scan adjudicate\`) for scan ${args.scanId}, run ${args.runId}, shape \`${args.shape}\`.`,
    "You were launched with one line naming this file. Everything this run hands you is in this brief or in the files it names; read those files and no other file under `.legal/`.",
    `No line of this brief or of a file it names is longer than ${READ_LINE_LIMIT} characters. In a JSON file it names, a string too long for one line is written as {"${LONG_TEXT_KEY}": [...]}: the string is its parts joined with nothing between them.`,
    "",
    "## What you are",
    role,
    "",
    "## Your payload",
    reads.payload.read.path,
    ...copyNote(reads.payload.read),
    `It is ${reads.payload.read.lines ?? 0} lines long. Read every line of it: ${reads.payload.ranges.length > 1 ? `the ${reads.payload.ranges.length} ranges` : "the one Read"} listed under "Read these next, all in one message" below.`,
    "",
    "## The candidates you answer",
    `Your reply answers ${asked.length === 1 ? "exactly this candidate" : `exactly these ${asked.length} candidates`} of your payload, by \`finding_id\`, and no other: ${idList(asked)}.`,
    ...(notAsked.length > 0
      ? [
          `Your payload also holds ${notAsked.length} candidate(s) this run does not ask you to answer: ${idList(notAsked)}. They were settled before this run - by the declaration (reported as not applicable by declaration, never as assessed) or by a previous run's verdict carried forward - so do not answer them.`,
        ]
      : []),
    ...previousNotCheckedText(asked, args.previousNotChecked),
    "",
    "## Settled premises, one per rule in your payload",
    ...(premises.length > 0
      ? premises.map((p) => `- ${p}`)
      : ["None: this scan's document carries no per-rule applicability block, so no premise was settled before dispatch."]),
    "",
    ...(ships.length > 0 ? ["## Does each file ship: the program's premise, one line per file of your payload", SHIPS_BRIEF_NOTE, ...ships, ""] : []),
    "## The run's ScanProfile and dependency inventory",
    "Both are in this brief itself, facts only: no file holds them for you to read.",
    ...(args.profileSupplied
      ? [`${reads.context.profileNote} It is:`, ...jsonBlock(reads.context.profile)]
      : ["No ScanProfile was supplied to this scan, so every question a profile would have answered is open."]),
    ...inventoryText(reads.context.inventory),
    "",
    "## The orientation sheet: where you start",
    ...(reads.sheet ? [reads.sheet.read.path, ...copyNote(reads.sheet.read)] : ["Not written for this scan (run with `--orientation off`): there is no sheet to start from."]),
    ...(reads.notes ? [reads.notes.read.path, ...copyNote(reads.notes.read)] : ["The orchestrator's paragraph about this repository was not written for this run."]),
  ];
  if (fold) {
    lines.push(
      "",
      answerMode ? "## The fold of the place rows" : "## The readers' fold",
      fold.file,
      ...(answerMode
        ? [
            `The program's fold of the place rows of ${readerIds.join(", ")}, written after all of them (and any make-up seat) have ended and before you are launched: counts of every place by decision and read basis, the places not checked with their reason, the kept places by the rule's class, the dismissed places by directory, and the path of the per-place table, whose row for place P<n> is line n + 2. It is at most ${FOLD_MAX_BYTES} bytes and lies in the ${FOLD_RANGES} fixed ranges listed below: Read every one of them (a range past the end of a short fold returns nothing, and that is expected). Your answer is refused unless your Reads cover every line of the fold.`,
          ]
        : [
      `The program's fold of the dispositions of ${readerIds.join(", ")}, written after all of them have ended and before you are launched: the dispositions of each one whose answer is on disk and, in its \`readers\` block, each one whose answer is not, with the units it held.`,
          ]),
    );
    if (s.carried && s.carried.length > 0) {
      lines.push(
        `Reader(s) ${s.carried.join(", ")} of this candidate were not launched: every place they hold was carried from an earlier run, whose row for it this run reproduced premise by premise. Their rows are in the fold beside the others, each labelled \`carried_from\` - carried, not re-verified - and you answer over them as over any reader's.`,
      );
    }
  }
  // Cost step 1, B1(a): every file the brief names, as the exact Reads that take it in, made together in one message.
  const items = [
    ...readItems(reads.payload.read.path, reads.payload.ranges),
    ...(reads.sheet ? readItems(reads.sheet.read.path, reads.sheet.ranges) : []),
    ...(reads.notes ? readItems(reads.notes.read.path, reads.notes.ranges) : []),
    ...(fold && answerMode ? FOLD_READS.map((r) => `- \`Read\` ${fold.file} with ${rangeWords(r)} (one of the fold's ${FOLD_RANGES} fixed ranges)`) : []),
    ...(fold && !answerMode ? [`- \`Read\` ${fold.file}, whole: no \`offset\`, no \`limit\` (the fold is written after your readers end, so its length was not known when this brief was written)`] : []),
  ];
  lines.push(
    "",
    "## Read these next, all in one message",
    `Make these ${items.length} Reads together, as parallel tool calls in one message, exactly as listed and before any other call. Each range is whole lines, at most ${READ_RANGE_LINES} of them and ${READ_RANGE_BYTES} bytes counted with the Read's line numbers, which is within what one Read returns; a file's ranges together are every line of it, in order.`,
    ...items,
  );
  lines.push("", "## Your reply", "Reply exactly as your agent definition says. This brief adds no field to it.", "");
  return lineSafeText(lines.join("\n"));
}

/** A brief's reading-list lines for one file: one Read of the whole file where it fits in one, else one line per range. */
function readItems(path: string, ranges: ReadRange[]): string[] {
  if (ranges.length <= 1) return [`- \`Read\` ${path}, whole: no \`offset\`, no \`limit\`${ranges.length === 1 ? ` (${ranges[0].limit} line${ranges[0].limit === 1 ? "" : "s"})` : " (an empty file)"}`];
  return ranges.map((r) => `- \`Read\` ${path} with ${rangeWords(r)}`);
}

/** A JSON value as fenced lines of a brief: on one line where it fits, else line-safe without indentation. */
function jsonBlock(v: unknown): string[] {
  const one = JSON.stringify(v) ?? "null";
  return ["```json", one.length <= READ_LINE_LIMIT ? one : lineSafeJson(v, READ_LINE_LIMIT, ""), "```"];
}

/** The inventory a brief carries (cost step 1, B2(i)): every package in one line, every field kept (`inventoryLine`). */
function inventoryText(inventory: readonly unknown[]): string[] {
  if (inventory.length === 0) return ["The dependency inventory (`findings.json`'s `dependency_inventory`) holds no package."];
  return [
    `The dependency inventory (\`findings.json\`'s \`dependency_inventory\`): ${inventory.length} package(s), one line each with every field the inventory writes - its declarations (\`field\`, \`version\` and \`ecosystem\` at \`file\`:\`line\`), \`call_site_count\`, its \`call_sites\` as \`file\`:\`line\`, \`declared_only\` where it is true, and \`call_sites_not_read\` where lines that could hold a call site were not read (then the package is not known to be unimported: say not read, never not imported).`,
    ...inventory.map(inventoryLine),
  ];
}

/**
 * The whole list: entries, waves, every brief's text and the reading copies, from the plan and the
 * paths. Reads the files the briefs name (to find lines a Read may cut); writes nothing. Throws where
 * a file a brief would name does not exist or cannot be copied line-safe.
 */
/**
 * THE MODEL ONE SEAT IS LAUNCHED ON when no run-wide override was given (full-read design 1.6): its bin's
 * `adjudication_group.seat_model`, which the packer writes from the member rules' own setting and never mixes. A
 * document that names none (written before the field, or unpacked) is launched on `fallback`. Two members naming two
 * models is refused: the packer never writes it, and a seat on one model would read the other rule on the wrong one.
 */
export function seatModelOfSeat(members: readonly Candidate[], groupKey: string, fallback: string): string {
  const named = sortedUnique(
    members
      .map((c) => (c.adjudication_group as { seat_model?: unknown } | undefined)?.seat_model)
      .filter((m): m is string => typeof m === "string"),
  );
  if (named.length > 1) {
    throw new Error(`the payload ${groupKey} holds candidates of rules read on ${named.join(" and ")}: one seat reads on one model, and the scanner's packer never mixes them, so this findings document was not written by it`);
  }
  return named[0] ?? fallback;
}

/** The rules this list reads on a model other than their own setting (review R18), from the candidates it lists. */
function listOverrides(args: LaunchListArgs, listed: readonly Candidate[]): ModelOverride[] {
  if (args.seatModelOverride === undefined) return [];
  const places = new Map<string, number>();
  const own = new Map<string, SeatModel>();
  const seen = new Set<string>();
  for (const c of listed) {
    if (seen.has(c.finding_id)) continue;
    seen.add(c.finding_id);
    places.set(c.rule_id, (places.get(c.rule_id) ?? 0) + c.locations.length);
    const m = (c.adjudication_group as { seat_model?: unknown } | undefined)?.seat_model;
    if (!own.has(c.rule_id)) own.set(c.rule_id, seatModelOfRule({ seat_model: m as SeatModel | undefined }));
  }
  return modelOverrides(places, (r) => own.get(r) ?? DEFAULT_SEAT_MODEL, args.seatModelOverride);
}

/** What the brief says about the ships premise, once, above its lines. Only `test` and `development` fill `ships`. */
export const SHIPS_BRIEF_NOTE =
  "Read once at scan time from the repository's own build and tooling files (package manifests, Dockerfiles and .dockerignore, CI definitions, documentation-site generators, toolchain conventions); it never stopped a file being read or a rule running. Where you leave `ships` out, the capture fills it from the premise of your decisive place only where that premise is `test` or `development` (a toolchain's own named convention); every other premise describes the file and fills nothing, so a `ships` you leave out there means the file ships and is counted. Write `ships` only where you disagree or where such a premise is all there is, with `at` quoting the line that shows it. Whether a file ships counts a finding out only for a rule whose block carries `\"duty_about\": \"product_runtime\"`; for every other rule it decides nothing (your definition's opt-in sentence at the top governs this).";
const SHIPS_WORDS: Readonly<Record<string, string>> = {
  product: "a declared artifact includes it",
  ci: "a CI definition run only on push or pull request, with no deploy, release, data service or secret, or a file only such a definition runs; information only, it fills nothing",
  build_tooling: "used only to build; information only, it fills nothing",
  development: "developer tooling by its toolchain's own convention",
  test: "test code by the toolchain's own convention",
  docs_site: "the maker's documentation website (counted)",
  documentation: "documentation text; information only, it fills nothing",
  outside_artifacts: "nothing the repository builds includes it; information only, it fills nothing",
  unknown: "nothing in the build files says; counted as shipping",
};

/**
 * The brief's ships-premise lines: one per premise (with its `because`
 * lines and any overruled class) for the files of the payload, the files sharing one premise and reason on one line, and
 * one line for the files whose premise is `unknown`. Empty where the scan wrote no premises.
 */
export function shipsLinesOf(premises: LaunchListArgs["shipsPremises"], payloadPath: string, members: Candidate[]): string[] {
  if (!premises || typeof premises !== "object") return [];
  const files = new Set<string>();
  try {
    // The payload sits in the project's `.legal/`: read through
    // project-read.ts, which reads a regular file only (test:project-writes 1b), never a pipe planted at that path.
    const parsed = JSON.parse(readRegularFile(payloadPath, "utf8")) as { candidates?: { locations?: { file?: unknown }[] }[] };
    for (const c of parsed.candidates ?? []) for (const l of c.locations ?? []) if (typeof l.file === "string") files.add(l.file);
  } catch {
    // A payload that cannot be read here is refused at launch; the members' own locations stand in for it.
  }
  if (files.size === 0) for (const c of members) for (const l of c.locations ?? []) files.add(l.file);
  const groups = new Map<string, string[]>();
  let unknown = 0;
  for (const f of [...files].sort()) {
    const row = Object.prototype.hasOwnProperty.call(premises, f) ? premises[f] : undefined;
    if (!row || row.premise === "unknown") {
      unknown++;
      continue;
    }
    const because = (row.because ?? []).map((b) => `${b.file}:${b.line} \`${b.quote}\``).join("; ");
    const conflict = row.conflict && row.conflict.length > 0 ? `; also ${row.conflict.join(", ")}, overruled because a declared artifact includes it` : "";
    const key = `${row.premise} (${SHIPS_WORDS[row.premise] ?? row.premise}${conflict}); because ${because}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const out = [...groups].map(([key, fs]) => `- ${fs.map((f) => `\`${f}\``).join(", ")}: ships premise ${key}`);
  if (unknown > 0) out.push(`- ${groups.size > 0 ? "every other file" : `every file (${unknown})`} of your payload: ships premise unknown (${SHIPS_WORDS.unknown})`);
  return out;
}

export function buildLaunchList(args: LaunchListArgs): { list: LaunchList; briefs: Map<string, string>; copies: Map<string, string> } {
  const capacity = args.subagentLimit - args.reservedPlaces;
  const rows = rowsForShape(args.shape, args.remainingCandidates, args.remainingRows);
  const skeleton = seatSkeleton(rows, capacity, args.carriedReaders);
  const byGroup = new Map<string, Candidate[]>();
  for (const c of args.remainingCandidates) {
    const key = c.adjudication_group?.key ?? c.finding_id;
    const list = byGroup.get(key);
    if (list) list.push(c);
    else byGroup.set(key, [c]);
  }
  const premiseOf = new Map<string, string>((args.applicability?.rules ?? []).map((r): [string, string] => [r.rule_id, r.settled_premise]));
  // Every candidate a payload holds, by its group key: the brief names those the run does not ask for (addition 1).
  const inPayload = new Map<string, string[]>();
  for (const c of args.allCandidates ?? []) {
    const key = c.adjudication_group?.key ?? c.finding_id;
    inPayload.set(key, [...(inPayload.get(key) ?? []), c.finding_id]);
  }
  const findingsDir = dirname(args.findingsPath);
  const runContextPath = join(args.launchDir, "run-context.json");
  const briefs = new Map<string, string>();
  const copies = new Map<string, string>();
  const seen = new Map<string, ListedRead>();
  const readOf = (role: ReadRole, path: string, recorded?: Recorded): ListedRead => {
    const known = seen.get(path);
    if (known) return known;
    const { read, copy, ranges } = seatReadOf(role, path, args.launchDir, findingsDir, READ_LINE_LIMIT, recorded);
    if (copy !== null) copies.set(read.path, copy);
    const listed = { read, ranges };
    seen.set(path, listed);
    return listed;
  };
  const inventory = Array.isArray(args.runContext.dependency_inventory) ? args.runContext.dependency_inventory : [];
  const sheet = args.orientationSheet ? readOf("orientation-sheet", args.orientationSheet) : null;
  const notes = args.orientationNotes ? readOf("orientation-notes", args.orientationNotes) : null;
  const entries: LaunchEntry[] = skeleton.map((s) => {
    const members = byGroup.get(s.groupKey) ?? [];
    const ruleIds = sortedUnique(members.map((c) => c.rule_id));
    const premises = ruleIds.map((r) => premiseOf.get(r)).filter((p): p is string => typeof p === "string" && p.length > 0);
    const payloadPath = join(findingsDir, s.row.path);
    const briefPath = join(args.launchDir, "briefs", `${s.id}.md`);
    const readerIds = s.after;
    const findingId = members[0]?.finding_id ?? s.groupKey;
    const fold =
      s.role === "verdict-after-readers"
        ? {
            file: join(args.launchDir, "folds", `${safeName(findingId)}.json`),
            command: scannerCommand([
              "verdict-reading",
              "--findings",
              args.findingsPath,
              "--verdicts",
              args.verdictsDir,
              "--readers",
              args.readersDir,
              "--fold",
              findingId,
              "--fold-out",
              join(args.launchDir, "folds", `${safeName(findingId)}.json`),
              "--launch-dir",
              args.launchDir,
            ]),
          }
        : undefined;
    // A-54 (relay integration part B, item 8): the payload is read only while it has the digest the scan recorded in
    // its row, so a payload edited between the scan and this step never reaches a seat (the refuter command already
    // refused one).
    const payloadListed = readOf("payload", payloadPath, { sha256: s.row.sha256, where: `the scan's findings document (its context_payloads row ${s.row.key})` });
    const payloadRead = payloadListed.read;
    const memberIds = new Set(members.map((c) => c.finding_id));
    const notAsked = sortedUnique((inPayload.get(s.groupKey) ?? []).filter((id) => !memberIds.has(id)));
    // Cost step 1, B2(i): the brief carries the profile and the whole inventory, one line per package.
    const context = { profile: args.runContext.profile, profileNote: args.runContext.profile_note, inventory };
    const ships = shipsLinesOf(args.shipsPremises, payloadPath, members);
    const text = briefText(args, s, members, premises, fold, { payload: payloadListed, sheet, notes, context }, readerIds, notAsked, ships);
    briefs.set(s.id, text);
    const shortKey = s.groupKey.includes("#") ? s.groupKey.slice(0, s.groupKey.indexOf("#")) : s.groupKey;
    const description =
      s.role === "reader"
        ? `Reader ${s.reader?.index} of ${s.reader?.of}, ${shortKey} (${ruleIds.join(", ")})`
        : s.role === "verdict-after-readers"
          ? `Verdict after readers, ${shortKey} (${ruleIds.join(", ")})`
          : `Adjudicate ${shortKey} (${ruleIds.length} rule(s), ${members.length} candidate(s))`;
    const agentInput: AgentInput = {
      subagent_type: `${PLUGIN_NAME}:legal-adjudicator`,
      description,
      // W6: a short fixed text naming the brief, which the relay
      // retypes for every launch; the brief itself says what it holds, and the gate compares every byte as before.
      prompt: `${briefReadWords(briefPath, text)} and follow it.`,
      model: args.seatModelOverride ?? seatModelOfSeat(members, s.groupKey, args.model),
    };
    return {
      id: s.id,
      order: s.order,
      wave: s.wave,
      role: s.role,
      payload_key: s.row.key,
      group_key: s.groupKey,
      payload_path: payloadPath,
      // Cost step 1, B2(i): no run context - the brief carries the profile and the whole inventory, one line per package.
      reads: [
        payloadRead,
        ...(sheet ? [sheet.read] : []),
        ...(notes ? [notes.read] : []),
        ...(fold ? [{ role: "fold" as const, path: fold.file }] : []),
      ],
      finding_ids: sortedUnique(members.map((c) => c.finding_id)),
      rule_ids: ruleIds,
      ...(s.reader ? { reader: s.reader } : {}),
      after: s.after,
      ...(fold ? { fold } : {}),
      brief_path: briefPath,
      brief_sha256: sha256(text),
      launch: LAUNCH_FORM,
      agent_input: agentInput,
      agent_input_sha256: sha256(canonicalJson(agentInput)),
    };
  });
  const waves: { wave: number; entries: string[] }[] = [];
  for (const e of entries) {
    const w = waves.find((x) => x.wave === e.wave);
    if (w) w.entries.push(e.id);
    else waves.push({ wave: e.wave, entries: [e.id] });
  }
  waves.sort((a, b) => a.wave - b.wave);
  // Item 8: the findings document's digest is taken through the one reader (a missing one is not recorded: a gate's
  // hand-made list); a findings document that is not a regular file with one name is refused by name.
  const findingsRead = readProgramFile("the findings document", args.findingsPath);
  if (!findingsRead.ok && !(findingsRead.exit === "unreadable" && (findingsRead.code === "ENOENT" || findingsRead.code === "ENOTDIR"))) throw new Error(findingsRead.problem);
  // The list records the digest of the scan's own document only (log-digest.ts).
  const findingsChanged = findingsRead.ok ? findingsChangedProblem(args.findingsPath, findingsRead.value) : null;
  if (findingsChanged !== null) throw new Error(findingsChanged);
  return {
    list: {
      kind: "launch-list",
      version: 1,
      scan_id: args.scanId,
      run_id: args.runId,
      shape: args.shape,
      model: args.model,
      ...(() => {
        const overrides = listOverrides(args, skeleton.flatMap((s) => byGroup.get(s.groupKey) ?? []));
        return overrides.length > 0 ? { model_overrides: overrides } : {};
      })(),
      // Relay integration part B (the parent's addition, 2026-09-25): the agent definition's Effort section was removed
      // (a launch cannot name an effort level), so this field cites no section of it.
      effort: "not a field of the Agent input: a launch cannot name an effort level",
      subagent_limit: args.subagentLimit,
      subagent_limit_source: args.subagentLimitSource,
      reserved_places: args.reservedPlaces,
      wave_capacity: capacity,
      run_context_path: runContextPath,
      run_reads: [{ role: "run-context", path: runContextPath, ...(args.runContextLines !== undefined ? { lines: args.runContextLines } : {}) }, ...(sheet ? [sheet.read] : []), ...(notes ? [notes.read] : [])],
      ...(findingsRead.ok ? { findings: { path: args.findingsPath, sha256: findingsRead.sha256 } } : {}),
      ...(args.planFile ? { plan: { path: args.planFile.path, sha256: args.planFile.sha256 } } : {}),
      entries,
      waves,
      not_listed: [
        args.shape === "refute_later"
          ? "refuters: none for a violation candidate - the shape chosen has no second check; a second look (a refuter in challenge mode) is appended as verdicts are captured, one entry per high finding the review took out of the count on its own word"
          : "refuters: appended to this list as violation candidates are captured, one entry per refutation, and a second look (a refuter in challenge mode) beside them, one entry per high finding the review took out of the count on its own word",
        "silence investigators: appended by the program command that is given the rule ids the orchestrator chose, with each rule's whole coverage_limits",
      ],
    },
    briefs,
    copies,
  };
}

/** The whole-file replacement lives with the list's other file handling (`launch-list-file.ts`). */
export { replaceFileAtomically } from "./launch-list-file.js";

/**
 * Write the list, its briefs, the reading copies and the run context under the launch directory, the caller holding
 * the list's lock: the pre-launch step takes that lock once, before its first write (`underLaunchLock`; the lock is not
 * re-entrant, so a second take inside the first would wait for itself and be refused). Returns the list's path, the
 * list as written and what it carried. The run context is written line-safe (`lineSafeJson`); the list itself is read
 * by the program and the hooks, not by a seat. Over a list of the same run, the new list carries every entry the run
 * appended to it, and a shape that would forget an entry of the run is refused (`carryRunState`, launch-list-file.ts;
 * a new attempt of a run releases, it does not forget).
 */
export function writeLaunchListLocked(
  launchDir: string,
  built: LaunchList,
  briefs: Map<string, string>,
  runContext: unknown,
  copies: Map<string, string> = new Map(),
): { path: string; list: LaunchList; carried: Carried } {
  const runContextText = `${lineSafeJson(runContext)}\n`;
  const listPath = join(launchDir, "launch-list.json");
  const { list, carried } = carryRunState(built, listPath);
  // The one list writer (launch-list-file.ts, relay integration part B, item 2) writes the briefs, the reading copies
  // and the run context aside, records each one's sha256 in the list, and moves them into place with the list: refused,
  // it writes none of them, and a standing list's briefs stay the ones it names.
  const files = new Map<string, string>();
  for (const [id, text] of briefs) files.set(join(launchDir, "briefs", `${id}.md`), text);
  for (const [path, text] of copies) files.set(path, text);
  files.set(list.run_context_path, runContextText);
  replaceLaunchList(listPath, list, "the pre-launch step (adjudicate --shape)", files);
  // A-27 (relay integration part B, item 8): no reading copy is left from an earlier list. Once the new list is in
  // place - not before, so that a refused step leaves the standing list's copies as they were - every file under
  // `<launch dir>/reading/` that the new list does not name is removed, under the same lock.
  removeStaleReadingCopies(join(launchDir, "reading"), new Set([...copies.keys()].map((p) => resolve(p))));
  return { path: listPath, list, carried };
}

/** Every file under `dir` whose path is not in `keep`, and every directory left empty; a `dir` that is not a directory is left alone. */
function removeStaleReadingCopies(dir: string, keep: Set<string>): void {
  let st: Stats;
  try {
    st = lstatSync(dir);
  } catch {
    return;
  }
  if (!st.isDirectory()) return;
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, d.name);
    if (d.isDirectory()) {
      removeStaleReadingCopies(p, keep);
      try {
        removeEmptyFolder(p);
      } catch {
        // Not empty: it holds a copy the new list names.
      }
    } else if (!keep.has(p)) {
      removePath(p, { force: true });
    }
  }
}

/** `writeLaunchListLocked` under the list's lock, for a caller that does not hold it (the gates call it so). */
export function writeLaunchList(launchDir: string, list: LaunchList, briefs: Map<string, string>, runContext: unknown, copies: Map<string, string> = new Map()): string {
  const listPath = join(launchDir, "launch-list.json");
  makeFolder(launchDir, { recursive: true });
  const written = withListLock(listPath, () => writeLaunchListLocked(launchDir, list, briefs, runContext, copies));
  if ("locked" in written) throw new Error(`${written.locked}; no brief, reading copy or run context was written`);
  return listPath;
}

/**
 * THE LAUNCH DIRECTORY, CHECKED AND MADE BEFORE THE STEP'S FIRST WRITE.
 * The list's lock lives in the launch directory, so the directory is the one thing made before the
 * lock - no file is. What stands at its path is looked at without following it, and every state the step cannot write
 * in is refused by name with what to do, never with a stack trace: a regular file or anything else that is not a
 * directory, a symbolic link that does not lead to a directory, a directory in which this user cannot create files, and
 * a directory that cannot be made. A full or read-only file system is refused at the lock's own create (`withListLock`,
 * worded by `refusalFor`). Null where the directory stands, or was made, and this user can create files in it.
 */
export function readyLaunchDir(launchDir: string): string | null {
  const dir = resolve(launchDir);
  const refused = (why: string): string => `--launch-dir ${dir}: refused - ${why}. Nothing was written.`;
  let st: Stats | null = null;
  try {
    st = lstatSync(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") return refused(refusalFor(e, dir));
  }
  if (st === null) {
    try {
      makeFolder(dir, { recursive: true });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EACCES" || code === "EPERM") {
        return refused(`the launch directory ${dir} cannot be made (${code}): a directory above it does not let this user create directories in it - correct that, or pass another --launch-dir`);
      }
      return refused(refusalFor(e, dir));
    }
  } else if (st.isSymbolicLink()) {
    let to: Stats | null = null;
    try {
      to = statSync(dir);
    } catch {
      to = null;
    }
    if (to === null || !to.isDirectory()) {
      return refused(`${dir} is a symbolic link that leads ${to === null ? "nowhere" : `to ${kindOf(to)}`}, where the launch directory should be: remove the link (${toldArgs(["rm", dir])}) or pass another --launch-dir`);
    }
  } else if (!st.isDirectory()) {
    return refused(`${dir} is ${kindOf(st)}, where the launch directory should be: remove it (${toldArgs(["rm", dir])}) or pass another --launch-dir`);
  }
  try {
    accessSync(dir, constants.W_OK | constants.X_OK);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? "error";
    return refused(`this user cannot create files in the launch directory ${dir} (${code}: it lacks write or search permission): correct its permissions (${toldArgs(["chmod", "u+rwx", dir])}) or pass another --launch-dir`);
  }
  // The launch directory holds the briefs and the reading copies, lines of the scanned code in clear.
  guardWorkingFolder(dir);
  return null;
}

/**
 * THE PRE-LAUNCH STEP'S ONE LOCK.
 * The launch directory is checked and made (`readyLaunchDir`), and `body` then runs under the launch
 * list's lock - the lock every append of launch-later takes too - held from before the step's first write to after its
 * last. Refused at the lock, the step has written nothing, and the refusal names the lock and says so. A file-system
 * error inside `body` - or a refusal it throws - is refused by name (`refusalFor`), never with a stack trace.
 */
export function underLaunchLock<T>(launchDir: string, body: () => T): { ok: true; value: T } | { ok: false; refused: string } {
  const notReady = readyLaunchDir(launchDir);
  if (notReady !== null) return { ok: false, refused: notReady };
  const dir = resolve(launchDir);
  let r: { value: T } | { locked: string };
  try {
    r = withListLock(join(dir, "launch-list.json"), () => ({ value: body() }));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException | undefined)?.code;
    const why = typeof code === "string" ? refusalFor(e, dir) : e instanceof Error ? e.message : String(e);
    return { ok: false, refused: `refused - ${why}. The step stopped there: nothing after that point was written.` };
  }
  if ("locked" in r) {
    return {
      ok: false,
      refused:
        `refused - ${r.locked}. The step wrote nothing: not the plan, a carried verdict, the run-shape question, its ledger line or the marker;` +
        " no brief, reading copy or run context was written. No launch list was written.",
    };
  }
  return { ok: true, value: r.value };
}

// ------------------------------------------------------------------------------------------------
// THE PRICE TABLE AND THE RUN-SHAPE QUESTION
// ------------------------------------------------------------------------------------------------

/**
 * THE LABELS THE PERSON CHOOSES BETWEEN: the second check (the
 * refuter) is no longer part of the default. The shape with no second check is offered first and marked recommended;
 * the two shapes that include it say so in their own label, so nobody chooses it without reading the words. The ids are
 * unchanged (`refute_later` predates the decision and is what the evidence log, the launch list and the hooks record);
 * only what the person reads changed. Evidence for the decision: an internal record.
 */
const SHAPE_LABEL: Record<RunShape, string> = {
  full: "Everything + second check",
  important: "Important only + second check",
  refute_later: "Everything (Recommended)",
};

/** The order the price table and the question offer the shapes in: the recommended one first (AskUserQuestion's own convention). */
export const QUESTION_ORDER: readonly RunShape[] = ["refute_later", "full", "important"];

/**
 * The run shape is not asked by default. The recommended shape
 * is used without asking; the run-shape question is put only where the person typed `/legal-scan plan` (the pre-launch
 * step's `--ask-shape`). On a project's first scan the person is asked once whether to start step 2, with its time and
 * amount: the start question, put through the same file, hook and ledger as the run-shape question, its "Start" mapped
 * to the recommended shape and its "Not now" to NOT_NOW_SHAPE, which writes no list and ends the run.
 */
export const DEFAULT_SHAPE: RunShape = "refute_later";
export const NOT_NOW_SHAPE = "not_now";
/** The start question's header and labels. */
export const START_HEADER = "Start";
export const START_LABEL = "Start";
export const NOT_NOW_LABEL = "Not now";
/** What the person is told when they answer "Not now" (a FOR THE PERSON sentence). */
export const NOT_NOW_WORDS = "Step 2, the AI review, did not start. Your answers are kept. Type /legal-scan when you want to start it.";

/** Which question the pre-launch step puts: the run-shape question, the start question, or none. */
export type AskMode = "shape" | "start" | "none";

/**
 * Whether the person was shown this project's price before - `shown: false` is a first
 * scan - from their own record, on their machine and outside the scanned folder (start-record.ts). It replaces
 * `isFirstScan`, which read the answer from `<legal>/reports/`, a folder a repository can commit: a committed report
 * folder made a person who had never scanned the project start a paid review without seeing the price. A report under `<legal>/reports/` does nothing to this
 * decision now, and a missing, unreadable or foreign record asks.
 */
export function priceShownBefore(stateDir: string | null, target: string | undefined): StartRecordRead {
  return readStartRecord(stateDir, target);
}

/**
 * The question this call puts: the run-shape question where asked for (`--ask-shape`) or where the recommended shape
 * cannot be listed for this run (its row is refused: a standing list it would forget entries of); else the start
 * question on a first scan, and none on a later one. `shown`: the person's record says they were shown this project's
 * price before (`priceShownBefore`).
 */
export function askModeOf(askShape: boolean, shown: boolean, table: Pick<PriceTable, "shapes">, later: LaterRun | null = null): AskMode {
  if (askShape) return "shape";
  const row = table.shapes.find((x) => x.shape === DEFAULT_SHAPE) as ({ refused?: string } & PriceTable["shapes"][number]) | undefined;
  if (row === undefined || row.refused !== undefined) return "shape";
  // A later run asks again where it would judge most earlier
  // verdicts again or carries none (`laterRunOf`); otherwise it starts without asking, as before.
  return shown && later === null ? "none" : "start";
}

/**
 * WHY A LATER RUN ASKS THE START QUESTION AGAIN, from the pre-launch step's own
 * comparison: how many of the places the earlier log answered go back to the review (`judged_again`), how many are
 * carried, how many are new, and the largest cause first, from the premise the comparison names for each place. All
 * three are places, never candidates (section 8 of the record; `laterRunOf`).
 */
export interface LaterRun {
  judged_again: number;
  carried: number;
  new_places: number;
  /** The first line's cause, in `changes.md`'s words. */
  cause: string;
  /** True where nothing is carried because there is no earlier log to carry (none in the folder, or none chosen). */
  none: boolean;
}

/** The causes, by the premise (rests-on.ts PREMISE_ORDER) or the plan row's reason. */
export const LATER_CAUSE_WORDS: Readonly<Record<string, string>> = {
  spec: "WolfBoy's review instructions changed",
  instructions: "WolfBoy's review instructions changed",
  answers: "the answers about the product changed",
  handed: "the list of packages changed",
  model: "another model or effort",
  effort: "another model or effort",
  rule: "WolfBoy's rules changed",
  candidate: "the code at those places changed",
  facts: "what WolfBoy knows of those places changed",
  census: "the places grouped with them changed",
  files: "a file their reviews read changed",
  searches: "a search their reviews ran finds something else now",
  "places-changed": "the code at some of their places changed",
  "answer-changed": "a file or search an answer relied on changed",
  "previous-reading-left-locations-unread": "the earlier review left some of their places unread",
};
const LATER_CAUSE_OTHER = "the earlier review did not record enough to carry them";
export const LATER_NONE_WORDS = {
  folder: "No earlier review is carried (none in this folder), so the review reads every place as new.",
  chosen: "No earlier review is carried (none chosen), so the review reads every place as new.",
  // What failed to match is the finding
  // ids (laterRunOf matches the earlier log's rows by id, never by place): a fingerprint change moves ids with the places unchanged.
  unmatched: "No earlier review is carried (none of the chosen review's findings has the same finding id in this scan, even where its places are unchanged), so the review reads every place as new.",
};

/**
 * A PLACE IS ONE LOCATION, A FILE AND A LINE (design rf13: the card opens a
 * place at its line), so every count the person sees under the word "place" counts these. A candidate's places are its
 * distinct locations (file and start line, as carry-forward.ts `placeOutcomes` counts a place-plan candidate's); a seat
 * reads every candidate it is handed, so a candidate counts at least one (the schema requires one location).
 */
export const placeCountOf = (c: { locations?: readonly { file: string; start_line: number }[] } | undefined): number =>
  Math.max(1, new Set((c?.locations ?? []).map((l) => `${l.file}\u0000${l.start_line}`)).size);

/**
 * The places the payload rows a shape launches hold: every place of the candidates of their groups, less the places of
 * the reader seats that are not launched because each place they hold is carried (pre-launch.ts `carried_seats`). On a
 * later run that compared, this is `laterRunOf`'s places sent back plus its new places.
 */
export function launchedPlaces(
  rows: readonly FindingsContextPayloadRow[],
  candidates: readonly Candidate[],
  carriedSeats: readonly { finding_id: string; places: number }[] = [],
): number {
  const groups = new Set(rows.map(groupKeyOf));
  const held = candidates.filter((c) => groups.has(c.adjudication_group?.key ?? c.finding_id));
  const ids = new Set(held.map((c) => c.finding_id));
  const notLaunched = carriedSeats.filter((s) => ids.has(s.finding_id)).reduce((n, s) => n + s.places, 0);
  return Math.max(0, held.reduce((n, c) => n + placeCountOf(c), 0) - notLaunched);
}

/**
 * Whether this later run asks the start question, and with what: where the folder holds no earlier log or the person
 * chose none (`comparing` false), always; where it compared, only when the places the earlier log answered that go back to
 * the review outnumber those carried. New places do not count toward that: they are the run's own new work. Null where
 * it does not ask. `rows` are the partition's after the launch's own cut (adjudicate-plan.ts `placesToRead`: a carried
 * place in a seat that is launched is `read`), `toAdjudicate` the plan's.
 * EVERY COUNT IS IN PLACES, never in candidates. A place-plan
 * candidate's places are its rows' place outcomes: `carried` (its seat is not launched), `read` with `new-place` (no row of
 * the earlier log rests on it: new), any other `read` (sent back to the review). Any other candidate's places are its
 * distinct locations (file and line, as `placeOutcomes` counts them), all of one kind: new where the candidate is new,
 * carried where its verdict is carried whole, sent back otherwise. So `judged_again + new_places` is what this run's seats
 * read, and a candidate whose seat runs again while most of its places are carried counts as what it is.
 */
export function laterRunOf(args: {
  comparing: boolean;
  noneWhy: "folder" | "chosen";
  rows: readonly { finding_id: string; reason: string; premise?: string; places?: { outcomes: readonly { outcome: string; reason: string }[] } }[];
  toAdjudicate: readonly string[];
  /** The candidates whose verdicts are carried whole, less those the declaration set aside (the settlement wins). */
  carried: readonly string[];
  /** The scan's candidates: the places of one not read place by place are its distinct locations. */
  candidates: readonly { finding_id: string; locations?: readonly { file: string; start_line: number }[] }[];
}): LaterRun | null {
  const byId = new Map(args.candidates.map((c) => [c.finding_id, c] as const));
  const placesOf = (id: string): number => placeCountOf(byId.get(id));
  if (!args.comparing) {
    const all = args.toAdjudicate.reduce((n, id) => n + placesOf(id), 0);
    return { judged_again: 0, carried: 0, new_places: all, cause: LATER_NONE_WORDS[args.noneWhy], none: true };
  }
  const rowOf = new Map(args.rows.map((r) => [r.finding_id, r] as const));
  const byCause = new Map<string, number>();
  let judged = 0;
  let fresh = 0;
  let carried = 0;
  for (const id of args.toAdjudicate) {
    const r = rowOf.get(id);
    // The cause stays the row's, by its premise or reason; a candidate new to the earlier log whose places it answered
    // is new because the set of its places changed (carry-forward.ts: a place-plan candidate's content key is its places).
    const reason = r?.reason === "new-candidate" ? "places-changed" : (r?.reason ?? "");
    let back = 0;
    if (r?.places) {
      for (const o of r.places.outcomes) {
        if (o.outcome === "carried") carried += 1;
        else if (o.reason === "new-place") fresh += 1;
        else back += 1;
      }
    } else if (!r || r.reason === "new-candidate") fresh += placesOf(id);
    else back += placesOf(id);
    if (back === 0) continue;
    judged += back;
    const words = LATER_CAUSE_WORDS[r?.premise ?? ""] ?? LATER_CAUSE_WORDS[reason] ?? LATER_CAUSE_OTHER;
    byCause.set(words, (byCause.get(words) ?? 0) + back);
  }
  for (const id of args.carried) {
    const r = rowOf.get(id);
    carried += r?.places ? r.places.outcomes.length : placesOf(id);
  }
  // Case 2 of design 3.2.2 on a run that compared: it carries nothing and sends nothing
  // back (every place is new to the chosen log), so every place is reviewed at about a full run's price: asked.
  if (carried === 0 && judged === 0 && fresh > 0) return { judged_again: 0, carried: 0, new_places: fresh, cause: LATER_NONE_WORDS.unmatched, none: true };
  // Case 1 of design 3.2.2: more of the places the earlier log answered go back to the review than are carried.
  if (judged <= carried) return null;
  // The largest cause first; a tie goes to the cause met first in the plan's order.
  let cause = LATER_CAUSE_OTHER;
  let most = 0;
  for (const [words, n] of byCause) {
    if (n > most) {
      cause = words;
      most = n;
    }
  }
  return { judged_again: judged, carried, new_places: fresh, cause: `Most earlier verdicts will be judged again, because ${cause}.`, none: false };
}

/**
 * WHAT THE TOKENS MEAN FOR WHO PAYS: "of your Claude plan" was wrong for a session paid per
 * token. Through Amazon Bedrock, Google Vertex AI or another service it is that service's prices; with ANTHROPIC_API_KEY set
 * it is money, at list prices (`LIST_PRICE_RATE`), once the person approved the key, and the plan's limits where they
 * declined it (both said: the program cannot see which); otherwise the plan's usage limits, which Anthropic does not state in
 * tokens, so no share of a plan is claimed. The environment is the session's own, read where the step runs.
 */
export function payerWords(env: NodeJS.ProcessEnv, low: number, high: number): string {
  const dest = step2Destination(env);
  if (dest !== "Anthropic") return `Through ${dest} they are paid at that service's own prices.`;
  if ((env[API_KEY_ENV] ?? "").trim() !== "") {
    // In an interactive session Claude Code asks once
    // whether to use a key found in the environment and remembers the answer; with -p it always uses it
    // (code.claude.com/docs/en/authentication, "Authentication precedence", and code.claude.com/docs/en/env-vars, read
    // 2026-11-12). The program cannot see the answer, so the sentence names both.
    return `With ANTHROPIC_API_KEY set, Claude Code pays per token once you approve the key (it asks once; a run with -p uses it without asking): that is ${usdRangeWords(low, high)} at list prices on ${LIST_PRICE_RATE.model}; another model costs in proportion to its price. If you declined the key, the tokens count against your Claude plan's usage limits instead; /status shows which this session uses.`;
  }
  return "On a Claude plan they count against your usage limits, which Anthropic does not state in tokens; /usage shows where you stand.";
}

/**
 * What the person does when a run stops part-way: a usage limit leaves the conversation open,
 * and a closed session is continued from the terminal; asking for the scan again prints that command (step 1a,
 * `otherConversationText`).
 */
export const STOP_AND_GO_ON_WORDS =
  "You can stop at any time; what is done is kept. If a usage limit stops it, type continue here once the limit resets; if this session closes, ask for the scan again in this folder and it prints the command that continues the run.";

/** The start question: one question, its figures the recommended shape's row of the price table (never re-computed). */
export function startQuestion(
  table: Pick<PriceTable, "shapes">,
  later: LaterRun | null = null,
  env: NodeJS.ProcessEnv = {},
): { question: RunShapeQuestion; shape_by_label: Record<string, string> } {
  const row = table.shapes.find((x) => x.shape === DEFAULT_SHAPE);
  const figures = row ? `${range(row.seconds_low, row.seconds_high)}, and ${tokenRangeWords(row.tokens_low, row.tokens_high)}. ${payerWords(env, row.tokens_low, row.tokens_high)}` : "";
  // A plan whose top is below the recommended one's is named where the person chooses: the
  // start question offers Start and Not now only, so "Not now" says how to reach it.
  const cheaper = row ? table.shapes.filter((x) => x.shape !== DEFAULT_SHAPE && x.tokens_high < row.tokens_high).sort((a, b) => a.tokens_high - b.tokens_high)[0] : undefined;
  // On a later run: the cause line, the three counts, then the same figures.
  const count = (label: string, n: number): string => `  ${label.padEnd(13)}${String(n).padStart(5)}`;
  const placesWords = (n: number): string => `${n} place${n === 1 ? "" : "s"}`;
  // The design's budget for this question: at most 80 characters a line (section 6); prose is wrapped at a word.
  const wrapped = (s: string, width = 78): string[] => {
    const out: string[] = [];
    let line = "";
    for (const w of s.split(" ")) {
      if (line && line.length + 1 + w.length > width) {
        out.push(line);
        line = w;
      } else line = line ? `${line} ${w}` : w;
    }
    if (line) out.push(line);
    return out;
  };
  // The plans with the second check, named with
  // their own figures where the person decides, so that nobody learns of them only by asking; the start question stays one
  // question with Start and Not now, and the recommended shape stays what Start runs.
  const checked = table.shapes.filter((x) => x.shape !== DEFAULT_SHAPE && !("refused" in x && (x as { refused?: string }).refused !== undefined));
  const full = checked.find((x) => x.shape === "full");
  const sameAsFull = (x: (typeof checked)[number]): boolean => full !== undefined && x.shape === "important" && x.launches === full.launches;
  const otherPlans =
    checked.length === 0
      ? ""
      : `\nOr type /legal-scan plan for a plan with the second check, which tries to prove each finding wrong: ` +
        checked
          .filter((x) => !sameAsFull(x))
          .map((x) => `${SHAPE_LABEL[x.shape]}${checked.some(sameAsFull) && x.shape === "full" ? ` (here the same as ${SHAPE_LABEL.important})` : ""}, ${tokenRangeWords(x.tokens_low, x.tokens_high)}, ${range(x.seconds_low, x.seconds_high)}`)
          .join("; ") +
        ".";
  const text =
    later === null
      ? // In places, the locations the launched rows hold (never candidates).
        `Start step 2, the AI review? Claude reads the ${placesWords(row?.places ?? 0)} worth a look: ${figures}${otherPlans}`
      : [
          "Start step 2, the AI review?",
          ...wrapped(later.cause),
          count("judged again", later.judged_again),
          count("carried", later.carried),
          count("new places", later.new_places),
          // The places this run's seats read: those sent back and the new ones
          // (`laterRunOf`); the figures are the price table's, over the same seats (pre-launch.ts `remaining_payloads`).
          ...wrapped(`Claude reads ${placesWords(later.judged_again + later.new_places)}: ${figures} "Not now" keeps everything as it is.`),
        ].join("\n");
  return {
    question: {
      questions: [
        {
          question: text,
          header: START_HEADER,
          multiSelect: false,
          options: [
            // WP9: the second look is in the recommended shape, and in the figure above. How to go on after a stop is said where the person starts.
            { label: START_LABEL, description: `Claude reviews each place once, and looks again at a high finding it leaves out of the count. ${STOP_AND_GO_ON_WORDS}` },
            {
              label: NOT_NOW_LABEL,
              description: `The review does not start. Type /legal-scan when you want to start it${cheaper ? `, or /legal-scan plan to choose a cheaper plan (${SHAPE_LABEL[cheaper.shape]}: ${tokenRangeWords(cheaper.tokens_low, cheaper.tokens_high)})` : ""}.`,
            },
          ],
        },
      ],
    },
    shape_by_label: { [START_LABEL]: DEFAULT_SHAPE, [NOT_NOW_LABEL]: NOT_NOW_SHAPE },
  };
}

/** Whether a shape launches the second check: cost-preview.ts's one definition. */
export { shapeHasSecondCheck };

/**
 * WHAT THE SECOND CHECK IS, WHAT IT COSTS AND WHEN ONE WOULD CHOOSE IT, in the person's words. One text, used by the
 * price table and the question alike. `cost` is the sentence the price model writes about its added tokens.
 */
export function secondCheckText(cost: string): string {
  return (
    "The second check (not in the recommended shape): after the verdicts, one more seat for each violation candidate tries to prove it wrong " +
    "without seeing the first seat's reasoning; one it overturns moves to Not applicable with its reason. " +
    `${cost} ` +
    "Choose it if you would rather see fewer violation candidates and can accept that it sometimes removes a real one; " +
    "without it, every violation candidate is shown as the seat that read it judged it."
  );
}

/**
 * THE SECOND LOOK, WHAT IT COSTS AND WHY IT IS IN THE RECOMMENDED SHAPE, in the person's words (WP9). `seats` is the number of high candidates still to read, `high`
 * the part of the recommended figure's high end it accounts for.
 */
export function secondLookText(seats: number, high: number): string {
  const each = roughTokens(PRICE_MODEL.second_check_tokens_per_violation_candidate);
  // The shapes with the second check also give a
  // second look to each high finding the review rules out; a finding gets one second look at most, so the bound is unchanged.
  const ruledOut = "in the shapes with the second check, also for each high finding the review rules out as not applicable";
  return seats === 0
    ? `The second look (in every shape): one more seat for a high finding the review takes out of the count on its own word, as met, exempt or not shipped, and ${ruledOut}; this run has no high candidate to read, so none is expected.`
    : `The second look (in every shape): one more seat for each high finding the review takes out of the count on its own word, as met, exempt or not shipped, and ${ruledOut}, ` +
        `which tries to show it is a problem after all; about ${each} tokens each. ` +
        `There are ${seats} high candidate(s) to read, so at most ${seats} such seat(s), one per high candidate whatever its verdict: up to ${roughTokens(high)} tokens of each figure above is for them, and how many there will be is known only once the verdicts are in.`;
}

/** The input of one `AskUserQuestion` call, exactly as the orchestrator passes it. */
export interface RunShapeQuestion {
  questions: {
    question: string;
    header: string;
    multiSelect: false;
    options: { label: string; description: string }[];
  }[];
}

export interface PriceTable {
  run_id: string;
  lines: string[];
  question: RunShapeQuestion;
  /** The answer's label, mapped back to the shape it names. Outside `questions`: it is not passed on. */
  shape_by_label: Record<string, RunShape>;
  shapes: { shape: RunShape; launches: number; candidates: number; /** The places its rows hold (`launchedPlaces`). */ places: number; tokens_low: number; tokens_high: number; second_check_low?: number; second_check_high?: number; second_look?: { seats: number; high: number }; waves: number; seconds_low: number; seconds_high: number }[];
}

export interface PriceTableArgs {
  runId: string;
  plan: PreLaunchPlan;
  remainingCandidates: Candidate[];
  remainingRows: FindingsContextPayloadRow[];
  /** Every candidate the scan raised: the first result, counted by severity. */
  allCandidates: Candidate[];
  findingsPath: string;
  waveCapacity: number;
  subagentLimit: number;
  reservedPlaces: number;
  /** Where a list of the run stands: what each shape still has to launch (`runRemainder`). */
  remainder?: RunRemainder | null;
}

const range = (low: number, high: number): string => (low === high ? `about ${humanSeconds(low)}` : `about ${humanSeconds(low)} to ${humanSeconds(high)}`);

/** What a standing run's shape still has to spend: its rows still to go, and the entries it appended still to go. */
function remainderPrice(
  shape: RunShape,
  rows: FindingsContextPayloadRow[],
  r: { remaining: string[]; waves: number; appended_refuters: number; appended_other: number },
  candidates: Candidate[],
  capacity: number,
): ReturnType<typeof figureColumns> {
  const left = new Set(r.remaining);
  const rowsLeft = rows.filter((row) => left.has(seatId(row.key)));
  return figureColumns(shapeFigure(shape, rowsLeft, candidates, { waves: r.waves, capacity, times: seatTimes(), extra: { refuters: r.appended_refuters, seats: r.appended_other } }));
}

/** The two measured seat times the time range runs between (`SEAT_TIME_MEASUREMENTS`). */
function seatTimes(): { fast: number; slow: number } {
  const [fast, slow] = [SEAT_TIME_MEASUREMENTS[0], SEAT_TIME_MEASUREMENTS[1]];
  if (!fast || !slow) throw new Error("two seat-time measurements are required");
  return { fast: fast.seconds, slow: slow.seconds };
}

/** A shape's figure as the price table's columns. */
function figureColumns(f: ReturnType<typeof shapeFigure>) {
  return {
    tokens_low: f.tokens_low,
    tokens_high: f.tokens_high,
    ...(f.second_check ? { second_check_low: f.second_check.low, second_check_high: f.second_check.high } : {}),
    second_look: f.second_look,
    seconds_low: f.seconds_low,
    seconds_high: f.seconds_high,
  };
}

/**
 * EVERY SHAPE'S ONE FIGURE over the candidates and rows still to read, at `capacity` seats a wave: the price table's and the scan's
 * printed lines' (index.ts), so the scan, the pre-launch step and both questions print one figure per shape.
 */
export function shapeFigures(candidates: Candidate[], rows: FindingsContextPayloadRow[], capacity: number): Map<RunShape, ReturnType<typeof shapeFigure> & { rows: FindingsContextPayloadRow[] }> {
  const out = new Map<RunShape, ReturnType<typeof shapeFigure> & { rows: FindingsContextPayloadRow[] }>();
  for (const shape of QUESTION_ORDER) {
    const shapeRows = rowsForShape(shape, candidates, rows);
    out.set(shape, { ...shapeFigure(shape, shapeRows, candidates, { waves: waveCount(shapeRows, capacity), capacity, times: seatTimes() }), rows: shapeRows });
  }
  return out;
}

/**
 * The price of each shape and the question, from the pre-launch plan. Launches, candidates and tokens
 * are `plan.preview.shapes` (G's arithmetic, not a second one); the time is the shape's wave count
 * times each measured per-seat time, so the range is exactly the two measurements' conditions apart.
 */
export function priceTable(args: PriceTableArgs): PriceTable {
  const [fast, slow] = [SEAT_TIME_MEASUREMENTS[0], SEAT_TIME_MEASUREMENTS[1]];
  if (!fast || !slow) throw new Error("two seat-time measurements are required");
  // The recommended shape first; the document keeps its own order (findings.schema.json), this is the offer's.
  const offered = QUESTION_ORDER.flatMap((name) => args.plan.preview.shapes.filter((s) => s.shape === name));
  /* The second look, priced before the person starts,
   * is in every shape's figure: the one figure (`shapeFigures`, cost-preview.ts
   * `shapeFigure`) holds every seat the shape launches and the time they take; this table only lays it out. Second looks
   * the run has already appended are in the figure as refuter seats (`appended_refuters`). */
  type ShapeRow = PriceTable["shapes"][number] & { refused?: string; remaining?: string[]; of?: number };
  const figures = shapeFigures(args.remainingCandidates, args.remainingRows, args.waveCapacity);
  const shapes = offered.map((s): ShapeRow => {
    const f = figures.get(s.shape);
    if (!f) throw new Error(`no figure for shape ${s.shape}`);
    const rows = f.rows;
    const whole = {
      shape: s.shape,
      launches: s.launches,
      candidates: s.candidates,
      places: launchedPlaces(rows, args.remainingCandidates, args.plan.carried_seats ?? []),
      ...figureColumns(f),
      waves: f.waves,
    };
    // Where the run's list stands, a shape is priced by what it still has to launch, with the same
    // price model and the same wave rule, or named as refused for this run (the rows still to go, priced
    // by the fm1 model; refuter entries the run appended at the second check's rate, other appended seats as answer seats).
    const r = args.remainder?.byShape.get(s.shape);
    if (!r) return whole;
    if ("refused" in r) return { ...whole, refused: r.refused };
    return {
      ...whole,
      launches: r.remaining.length,
      ...remainderPrice(s.shape, rows, r, args.remainingCandidates, args.waveCapacity),
      waves: r.waves,
      remaining: r.remaining,
      of: r.of,
    };
  });
  const bySeverity = new Map<string, number>();
  for (const c of args.allCandidates) bySeverity.set(c.severity ?? "unstated", (bySeverity.get(c.severity ?? "unstated") ?? 0) + 1);
  const severityOrder = ["high", "medium", "low"];
  const severities = [...bySeverity.entries()].sort((a, b) => {
    const ia = severityOrder.indexOf(a[0]);
    const ib = severityOrder.indexOf(b[0]);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || (a[0] < b[0] ? -1 : 1);
  });
  const firstResult =
    `First result: layer 1 raised ${args.allCandidates.length} candidate(s)` +
    (severities.length > 0 ? ` (${severities.map(([k, n]) => `${n} ${k}`).join(", ")})` : "") +
    `; the full list is in ${args.findingsPath}.`;
  const standingLine =
    args.remainder === null || args.remainder === undefined
      ? []
      : [
          `This run's launch list stands (shape ${args.remainder.shape}, ${args.remainder.listed} entries), and ${args.remainder.done} of its entries are answered or kept not judged: ` +
            "each shape below is priced by the launches it still has to go, never the whole plan again.",
        ];
  // "Important only" that launches every row "Everything"
  // launches leaves nothing for a later run, and says so (cost-preview.ts `IMPORTANT_IS_EVERYTHING`).
  const everythingRow = shapes.find((x) => x.shape === "full");
  const importantAll = (s: (typeof shapes)[number]): boolean =>
    everythingRow !== undefined && s.launches === everythingRow.launches && ("remaining" in s && s.remaining !== undefined) === ("remaining" in everythingRow && everythingRow.remaining !== undefined);
  const launchesText = (s: (typeof shapes)[number]): string =>
    "remaining" in s && s.remaining !== undefined
      ? `${s.launches} launch(es) still to go of the ${s.of} it lists${s.launches > 0 ? ` (${idsOf(s.remaining)})` : ""}`
      : `${s.launches} launch(es)`;
  const shapeRow = (s: (typeof shapes)[number]): string =>
    "refused" in s && s.refused !== undefined
      ? `${SHAPE_LABEL[s.shape]}: refused for this run - ${s.refused}`
      : shapeRowPriced(s);
  const shapeRowPriced = (s: (typeof shapes)[number]): string =>
    `${SHAPE_LABEL[s.shape]}: ${launchesText(s)}, ${s.candidates} candidate(s) adjudicated, ` +
    `${tokenRangeWords(s.tokens_low, s.tokens_high)}, ${range(s.seconds_low, s.seconds_high)}` +
    (s.shape === "important"
      ? `. Only the payloads holding a high-severity candidate or a rule this run launches once; ${importantAll(s) ? IMPORTANT_IS_EVERYTHING : "the rest are left for a later run, not dropped"}; then the second check on each violation candidate, and the second look (below), which here also re-reads each high finding the review rules out`
      : s.shape === "refute_later"
        ? ". Every candidate is read and judged once, with no second check; a high finding the review takes out of the count on its own word is looked at once more (the second look, below)"
        : ". Then the second check on each violation candidate, and the second look (below), which here also re-reads each high finding the review rules out");
  const how =
    `How the time is estimated: at most ${args.waveCapacity} seats run at once (the host runs ${args.subagentLimit} sub-agents at once and ` +
    `${args.reservedPlaces} ${args.reservedPlaces === 1 ? "is" : "are"} kept free for the orchestrator), and a seat that waits for readers goes in a later wave. ` +
    `A seat took a median of ${fast.seconds} s and at most ${slow.seconds} s on ${fast.date} (${fast.tree}, ${fast.rules_per_seat}, ${fast.in_flight}, ${fast.model} at effort ${fast.effort}, the level the seats are pinned at, ${fast.seats} seats), ` +
    "so each time above is the range between the two; a larger payload takes longer. " +
    // The time counts every seat the shape runs.
    "Each time counts the seats that start once a verdict is in (the second check and the second look) as later waves: none at the low end of the recommended shape, as many as its figure allows at the high end. " +
    "While the run goes, the status line re-estimates from this run's own returned seats.";
  const tokensNote = PRICE_BASIS_WORDS;
  const checked = shapes.find((s) => s.second_check_low !== undefined && s.second_check_high !== undefined && !("refused" in s && s.refused !== undefined));
  const secondCheck = secondCheckText(
    (checked ? `In this run it is about ${tokenRangeWords(checked.second_check_low ?? 0, checked.second_check_high ?? 0).replace(/^about /, "")} of the ${SHAPE_LABEL[checked.shape]} figure above: ` : "") +
      "one more seat for each violation candidate, and how many there will be is known only once the verdicts are in.",
  );
  // One line for every shape: each reads every high candidate still to read (`important` keeps every payload holding one).
  const looked = shapes.find((s) => s.shape === "refute_later" && !("refused" in s && s.refused !== undefined)) ?? shapes.find((s) => s.second_look !== undefined && !("refused" in s && s.refused !== undefined));
  const secondLook = looked?.second_look ? secondLookText(looked.second_look.seats, looked.second_look.high) : null;
  const lines = [
    `PRICE TABLE for run ${args.runId}: the run-shape question below carries this same text; do not re-word, re-compute or re-type it`,
    `  ${firstResult}`,
    ...standingLine.map((l) => `  ${l}`),
    ...shapes.map((s) => `  ${shapeRow(s)}.`),
    ...(secondLook ? [`  ${secondLook}`] : []),
    `  ${secondCheck}`,
    `  ${how}`,
    `  ${tokensNote}`,
  ];
  const question: RunShapeQuestion = {
    questions: [
      {
        question: [
          `Run ${args.runId}: which run shape should layer 2 take?`,
          firstResult,
          ...standingLine,
          ...shapes.map((s) => `- ${shapeRow(s)}.`),
          ...(secondLook ? [secondLook] : []),
          secondCheck,
          how,
          tokensNote,
        ].join("\n"),
        header: RUN_SHAPE_HEADER,
        multiSelect: false,
        options: shapes.map((s) => ({
          label: SHAPE_LABEL[s.shape],
          description:
            "refused" in s && s.refused !== undefined
              ? "refused for this run: it would forget entries the run launched or appended (the table says which)"
              : `${"remaining" in s && s.remaining !== undefined ? `${s.launches} launch(es) still to go of ${s.of}` : `${s.launches} launch(es)`}, ${s.candidates} candidate(s), ${tokenRangeWords(s.tokens_low, s.tokens_high)}, ${range(s.seconds_low, s.seconds_high)}` +
                (s.shape === "important" ? `; ${importantAll(s) ? IMPORTANT_IS_EVERYTHING : "the rest are left for a later run"}; then the second check and the second look` : s.shape === "refute_later" ? "; no second check; a second look at a high finding left out of the count" : "; then the second check and the second look"),
        })),
      },
    ],
  };
  const shapeByLabel: Record<string, RunShape> = {};
  for (const s of shapes) shapeByLabel[SHAPE_LABEL[s.shape]] = s.shape;
  return { run_id: args.runId, lines, question, shape_by_label: shapeByLabel, shapes };
}

// ------------------------------------------------------------------------------------------------
// THE STATUS LINE
// ------------------------------------------------------------------------------------------------

/**
 * ONE RECORD OF THE PROGRAM'S OWN, one per line of `launch-events.jsonl` beside the list. The launch
 * hook appends `launched` (and `failed` when a launch fails and its reservation is released); the
 * capture command appends `returned`, with `tokens` where it can read them. This is the interface
 * those steps write to; the status line reads nothing else but the list.
 */
export interface LaunchEvent {
  entry: string;
  event: "launched" | "returned" | "failed";
  at: string;
  tokens?: number;
  /**
   * The seat's agent id: the launch result's `agentId`, which is also the `agent_id` of every hook event the
   * seat fires (probe fact (c)). The launch hook writes it on every `launched`; the capture hook finds a
   * seat's entry as the latest `launched` whose `seat` is the event's `agent_id`, and writes it on the
   * `returned` it appends (relay item 3).
   */
  seat?: string;
}

/**
 * The records of `launch-events.jsonl`, read through the one reader of program-written files (program-file.ts;
 * relay integration part B, items 7 and 8): a regular file with one name, opened without blocking and without
 * following a link. Only the hooks write it, by appending - the launch gate's `launched` and `failed`
 * (hook-launch.ts `appendEvent`) and the capture's `returned` (hook-capture.ts) - so no digest is recorded for it.
 * A missing file is no record yet. Anything else the reader refuses is thrown, by name: the launch gate then denies
 * the call naming it, and the pre-launch step and `run-status` refuse by name.
 */
export function readLaunchEvents(path: string): { events: LaunchEvent[]; unreadable: number } {
  const got = readProgramFile("the launch events", path);
  if (!got.ok) {
    if (got.exit === "unreadable" && (got.code === "ENOENT" || got.code === "ENOTDIR")) return { events: [], unreadable: 0 };
    throw new Error(got.problem);
  }
  const events: LaunchEvent[] = [];
  let unreadable = 0;
  for (const line of got.value.toString("utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const e = JSON.parse(line) as LaunchEvent;
      // A `seat` that is there must be an agent id: a binding nobody can match is not a binding.
      const seatReads = e.seat === undefined || (typeof e.seat === "string" && e.seat !== "");
      if (typeof e.entry === "string" && ["launched", "returned", "failed"].includes(e.event) && !Number.isNaN(Date.parse(e.at)) && seatReads) events.push(e);
      else unreadable += 1;
    } catch {
      unreadable += 1;
    }
  }
  return { events, unreadable };
}

export interface RunStatus {
  line: string;
  /** The person's line, counted in places (the mock-up's screen 8). */
  person: string;
  /** The person line's two numbers - places whose part returned with its answer, and places in all. */
  places_done: number;
  places_total: number;
  total: number;
  returned: number;
  running: number;
  waiting: number;
  elapsed_seconds: number | null;
  remaining_seconds: number | null;
  median_seconds: number | null;
  tokens: number | null;
  /** Seats that returned with their answer lost, counted apart from `returned` (m1 of the integration verification). */
  returned_answer_lost: number;
  /**
   * Seats known lost before returning, counted apart from `running`:
   * launched, with no sign of their end, and lost by the relaunch rule -
   * at the resume of the run's conversation after its Claude Code process ended, or past the bound. Each entry is
   * launched again.
   */
  lost_before_returning: number;
  /** Where the run has ended: how and when, from the active-run history (m2 of the integration verification). */
  ended: { how: string; at: string } | null;
}

/**
 * What the status line takes from the ledgers beside the list, read by the
 * `run-status` command: the entries the relaunch rule launches again (entry-answer.ts `relaunchable`, which the launch
 * gate and the assembly ask too) - whose latest seat returned with its answer lost, or is known lost
 * before returning, at the resume of the run's conversation or past the bound - and the run's end where the active-run
 * history records one. The ledgers are read as they are now, also for a replay with `--now`.
 */
export interface RunStatusLedgers {
  lost?: ReadonlySet<string>;
  ended?: { how: string; ended_at: string } | null;
  /**
   * The verdict records examined for refuters as their bytes are now (launch-later.ts `examinedRecords`: a
   * record replaced at the same path is examined again, never counted from its earlier line). The list alone cannot show
   * a record's bytes, so where this is not given no record is counted examined.
   */
  examined?: ReadonlySet<string>;
  /**
   * Where superseded refuter entries meet the status line, the refuter
   * entries made from bytes their record no longer holds (launch-list-file.ts `standingRefuters`, as the
   * relaunch rule's ledgers carry them, entry-answer.ts `readAnswerLedgers`). The assembly neither awaits them nor counts
   * their answers, and the relaunch rule never launches them, so the line counts none of them as a seat to return, to
   * run or to launch, and says them apart. Where this is not given, none is set apart.
   */
  superseded?: ReadonlySet<string>;
}

/**
 * A token count is taken only as a whole number from 0 up to this limit, the largest whole number the
 * program adds exactly, and a sum past it is not printed (two counts of 1e308 summed to Infinity and printed as the infinity sign, and a count of -5 printed as it was).
 * A record whose count is not
 * taken is still a return; it counts as one that carries no count.
 */
export const TOKEN_COUNT_LIMIT = Number.MAX_SAFE_INTEGER;
const isTokenCount = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= TOKEN_COUNT_LIMIT;
/** Refuters are appended as verdict records are examined, so until every one is, the total above is not yet the run's. */
const refuterNote = (list: LaunchList, examinedRecords: ReadonlySet<string> | undefined, superseded: ReadonlySet<string> | undefined): string => {
  const verdictSeats = list.entries.filter((e) => e.role === "adjudicator" || e.role === "verdict-after-readers").length;
  // The records examined as their bytes are now, from the caller (RunStatusLedgers.examined), never the list's lines counted by path.
  const examined = examinedRecords?.size ?? 0;
  // The refuters counted are the ones that stand, as the examinations counted beside them are of the records'
  // bytes now; a superseded entry was made from bytes no examination now names, so it is said apart.
  const refuterEntries = list.entries.filter((e) => e.role === "refuter");
  const refuters = refuterEntries.filter((e) => superseded?.has(e.id) !== true).length;
  const set = refuterEntries.length - refuters;
  const apart = set === 0 ? "" : `; ${set} refuter entr${set === 1 ? "y" : "ies"} made from a record's earlier bytes, not awaited`;
  return `${examined === 0 && refuters === 0 ? "refuters not listed yet" : `${refuters} refuter(s) listed from ${examined} of ${verdictSeats} verdict record(s) examined`}${apart}`;
};

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/**
 * THE ONE LINE. Remaining time: the median wall of this run's returned seats, applied to every seat
 * not yet returned, scheduled on the list's own places and waits - a running seat is taken to end at
 * its start plus that median (or now, where it has already run longer), and a waiting seat to start
 * when a place frees and every entry it waits for has ended. With no seat returned it does not
 * estimate, and says so. It is the run as of `now`: records stamped later are counted apart, not in it.
 */
export function runStatus(list: LaunchList, events: LaunchEvent[], now: Date, unreadable = 0, ledgers: RunStatusLedgers = {}): RunStatus {
  if (!Number.isFinite(now.getTime())) throw new Error("the status line is the run as of a time, and the time given is not one");
  const listed = new Set(list.entries.map((e) => e.id));
  // The entries the run awaits - every listed one but a superseded refuter entry (RunStatusLedgers.superseded).
  const awaited = list.entries.filter((e) => ledgers.superseded?.has(e.id) !== true);
  const attempt = new Map<string, { start: number; end?: number; tokens?: number }>();
  let firstLaunch: number | null = null;
  let unlisted = 0;
  // A record whose time does not read is counted as unreadable and not used: no number the line
  // prints may come from it (`readLaunchEvents` already drops such lines; a caller may not have).
  const timed = events.filter((e) => Number.isFinite(Date.parse(e.at)));
  const untimed = events.length - timed.length;
  // The line is the run AS OF `now`: a record stamped later is not counted (a replay asks about a past
  // moment of a finished run; a live run's records are never later than its clock).
  const later = timed.filter((e) => Date.parse(e.at) > now.getTime()).length;
  const sorted = timed.filter((e) => !(Date.parse(e.at) > now.getTime())).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  // One record per listed seat with a launch standing: its latest attempt. The seat is running while
  // that record has no end, returned once it has one, and not launched while it has none, so the three
  // counts partition the list by construction. `launched` starts a fresh record (a relaunch keeps
  // nothing of an earlier attempt), `failed` removes it (a failed launch releases its place, whatever
  // an earlier record of the seat said), and `returned` completes the standing one.
  for (const e of sorted) {
    if (!listed.has(e.entry)) {
      unlisted += 1;
      continue;
    }
    const t = Date.parse(e.at);
    if (e.event === "launched") {
      attempt.set(e.entry, { start: t });
      if (firstLaunch === null || t < firstLaunch) firstLaunch = t;
    } else if (e.event === "failed") {
      attempt.delete(e.entry);
    } else {
      const standing = attempt.get(e.entry);
      if (standing) {
        standing.end = t;
        if (isTokenCount(e.tokens)) standing.tokens = e.tokens;
      }
    }
  }
  const nowMs = now.getTime();
  const total = awaited.length;
  const endOf = (id: string): number | undefined => attempt.get(id)?.end;
  const returnedIds = awaited.filter((e) => endOf(e.id) !== undefined).map((e) => e.id);
  // A seat with no end that the relaunch rule takes as
  // lost (at the resume of the run's conversation, or past the bound) is not running: it is counted apart, and the
  // estimate schedules its entry as one still to launch, as launch-next lists it.
  const lostBeforeReturning = awaited.filter((e) => attempt.has(e.id) && endOf(e.id) === undefined && ledgers.lost?.has(e.id) === true);
  const running = awaited.filter((e) => attempt.has(e.id) && endOf(e.id) === undefined && ledgers.lost?.has(e.id) !== true);
  const waiting = awaited.filter((e) => !attempt.has(e.id));
  // m1: a seat that returned with its answer lost has not answered its entry, which is launched again (the relaunch
  // rule): it is counted apart, and the estimate schedules its entry as one still to launch. Its wall is a real seat's
  // and stays in the median.
  const lost = awaited.filter((e) => endOf(e.id) !== undefined && ledgers.lost?.has(e.id) === true);
  const answered = returnedIds.length - lost.length;
  const durations = returnedIds.map((id) => ((endOf(id) as number) - (attempt.get(id) as { start: number }).start) / 1000);
  const elapsed = firstLaunch === null ? null : Math.max(0, (nowMs - firstLaunch) / 1000);

  let remaining: number | null = null;
  let med: number | null = null;
  let overMedian = 0;
  // The schedule is laid out on the list's places, so it needs a whole number of them, at least one (a list with wave_capacity 0 or below printed "about NaN h NaN min left").
  const placesKnown = Number.isSafeInteger(list.wave_capacity) && list.wave_capacity >= 1;
  if (durations.length > 0 && answered < total && placesKnown) {
    med = median(durations);
    const finish = new Map<string, number>();
    for (const id of returnedIds) finish.set(id, endOf(id) as number);
    const places: number[] = [];
    for (const e of running) {
      const t0 = (attempt.get(e.id) as { start: number }).start;
      if ((nowMs - t0) / 1000 > med) overMedian += 1;
      const f = Math.max(t0 + med * 1000, nowMs);
      finish.set(e.id, f);
      places.push(f);
    }
    // No more places than entries. A place beyond the number of entries is never taken,
    // so the estimate is the same, and a list with a huge wave_capacity (the program writes it from
    // --subagent-limit or CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS, which have no upper bound) no longer exhausts memory.
    while (places.length < Math.min(list.wave_capacity, total)) places.push(nowMs);
    places.sort((a, b) => a - b);
    for (const e of [...waiting, ...lost, ...lostBeforeReturning].sort((a, b) => a.wave - b.wave || a.order - b.order)) {
      const ready = Math.max(nowMs, ...e.after.map((a) => finish.get(a) ?? nowMs));
      places.sort((a, b) => a - b);
      const place = places.shift() as number;
      const begin = Math.max(place, ready);
      const f = begin + med * 1000;
      finish.set(e.id, f);
      places.push(f);
    }
    const last = Math.max(...awaited.map((e) => finish.get(e.id) ?? nowMs));
    remaining = Math.max(0, (last - nowMs) / 1000);
  } else if (answered === total && total > 0) {
    remaining = 0;
  }
  const tokenValues = returnedIds.map((id) => attempt.get(id)?.tokens).filter((n): n is number => typeof n === "number");
  const tokenSum = tokenValues.reduce((a, b) => a + b, 0);
  // The sum is checked as each count is: past the limit it is no longer exact.
  const tokensPastLimit = tokenValues.length > 0 && !isTokenCount(tokenSum);
  const tokens = tokenValues.length > 0 && !tokensPastLimit ? tokenSum : null;

  const parts = [
    `run ${list.run_id} (${list.shape}): ${answered} of ${total} listed seat(s) returned${lost.length > 0 ? `, ${lost.length} returned with the answer lost (not captured, cut off, or never taken: each is launched again as the assembly names it)` : ""}, ${running.length} running${lostBeforeReturning.length > 0 ? `, ${lostBeforeReturning.length} lost before returning (no sign of an end before the run's conversation was resumed or within the bound: each is launched again)` : ""}, ${waiting.length} not launched`,
    elapsed === null ? "no seat launched yet" : `${humanSeconds(Math.round(elapsed))} since the first launch`,
    // m2: a run that has ended says so, from the history line; nothing is estimated for it.
    ledgers.ended
      ? `the run ended (${ledgers.ended.how}) at ${ledgers.ended.ended_at}`
      : answered === total && total > 0
      ? "every listed seat has returned"
      : remaining === null
        ? placesKnown
          ? "remaining time: not estimated yet - no seat of this run has returned, and the program estimates only from this run's own returned seats"
          : `remaining time: not estimated - the launch list's wave_capacity (${JSON.stringify(list.wave_capacity) ?? "none"}) is not a whole number of at least 1, and the estimate is laid out on the list's places`
        : `about ${humanSeconds(Math.round(remaining))} left, from the median of ${durations.length} returned seat(s) (${Math.round(med as number)} s)` +
          (overMedian > 0 ? `; ${overMedian} running seat(s) have already run longer than that, so this may be short` : ""),
    tokensPastLimit
      ? `tokens: not totalled - the counts of ${tokenValues.length} returned seat(s) add up past ${grouped(TOKEN_COUNT_LIMIT)}, the largest whole number the program adds exactly`
      : tokens === null
      ? "tokens: not known to the program yet - no returned seat's record carries a count"
      : `${grouped(tokens)} tokens so far (final context of ${tokenValues.length} of ${returnedIds.length} returned seat(s))`,
  ];
  if (shapeHasSecondCheck(list.shape)) parts.push(refuterNote(list, ledgers.examined, ledgers.superseded));
  const silence = list.entries.filter((e) => e.role === "silence-investigator").length;
  if (silence > 0) parts.push(`${silence} silence investigation(s) listed`);
  if (unlisted > 0) parts.push(`${unlisted} record(s) name no listed seat`);
  if (unreadable + untimed > 0) parts.push(`${unreadable + untimed} record line(s) unreadable`);
  if (later > 0) parts.push(`${later} record(s) stamped after ${now.toISOString()} not counted`);
  // (the mock-up's screen 8) The same numbers for the person, counted in the candidates of the entries
  // that give an answer on them - one review each, from the person's side - and never in seats. A candidate is done when
  // the entry holding it returned with its answer; one lost is not done, as its entry is launched again. Not worded as places: a place is a location. The fields keep their
  // names (`places_done`, `places_total`), which the hooks and their records read.
  const answering = list.entries.filter((e) => e.role === "adjudicator" || e.role === "verdict-after-readers");
  const placesOf = (e: (typeof list.entries)[number]): number => (e.finding_ids ?? []).length;
  const lostIds = new Set(lost.map((e) => e.id));
  const placesTotal = answering.reduce((n, e) => n + placesOf(e), 0);
  const placesDone = answering.filter((e) => endOf(e.id) !== undefined && !lostIds.has(e.id)).reduce((n, e) => n + placesOf(e), 0);
  const person =
    // The count is candidates answered, one review each from the
    // person's side, so it is not called places (a place is a location).
    `AI review · ${grouped(placesDone)} of ${grouped(placesTotal)} reviews done` +
    (elapsed === null ? "" : ` · ${humanSeconds(Math.round(elapsed))}`) +
    (ledgers.ended ? " · ended" : remaining === null || answered === total ? "" : ` · about ${humanSeconds(Math.round(remaining))} left`);
  return {
    places_done: placesDone,
    places_total: placesTotal,
    line: parts.join(" - "),
    person,
    total,
    returned: answered,
    returned_answer_lost: lost.length,
    lost_before_returning: lostBeforeReturning.length,
    ended: ledgers.ended ? { how: ledgers.ended.how, at: ledgers.ended.ended_at } : null,
    running: running.length,
    waiting: waiting.length,
    elapsed_seconds: elapsed,
    remaining_seconds: remaining,
    median_seconds: med,
    tokens,
  };
}

// ------------------------------------------------------------------------------------------------
// THE RUN SHAPE FROM THE PERSON'S ANSWER: one function for the pre-launch step and the assembly
// ------------------------------------------------------------------------------------------------

/**
 * Inside a Claude Code session the run shape
 * is taken only from the answer file the plugin's hook wrote, by the pre-launch step and by the assembly alike.
 * - With no `forList`: `takeRunShape` (hook-question.ts), which the pre-launch step's `--shape-from-answer` takes: the
 *   latest asking's answer, not yet used, checked against the hook's ledger (no transcript is read: rf11-fx2a-2026-11-08.md).
 * - With `forList`, the launch list a run wrote from an answer (the assembly, once the answer is used): the ledger's
 *   last `answer-used` line for that list, of the list's run; the answer file, read through the one reader only while
 *   its sha256 is that line's (`readRecorded`); the answer names that line's call and question; the question file
 *   as it is now, whose sha256 is that line's; the answer's shape under the question's `shape_by_label`, which the
 *   answer records and the list carries (`readLaunchList`: the list its run's marker, or last history line,
 *   records); and the hook's `answer-written` line for the same bytes and call. The answer, the question and the ledger
 *   are records in the person's state folder (state-record.ts `launchRecordPath`).
 * Anything else is refused by name. Nothing is written.
 */
/** A list the pre-launch step wrote in the recommended shape without asking, as its ledger line records it. */
export interface ShapeByDefault {
  shape: RunShape;
  byDefault: true;
  ledgerLine: RunShapeLedgerLine;
}

export function runShapeFromAnswer(launchDir: string, forList?: string): TakenRunShape | ShapeByDefault | { refused: string } {
  if (forList === undefined) return takeRunShape(launchDir);
  const listPath = resolvePath(forList);
  const list = readLaunchList(listPath);
  if (!list.ok) return { refused: `the launch list cannot be read back: ${list.problem}` };
  let ledgerPath: string = RUN_SHAPE_LEDGER_FILE;
  let ledger: RunShapeLedgerLine[];
  try {
    ledgerPath = launchRecordPath(launchDir, RUN_SHAPE_LEDGER_FILE);
    ledger = readRunShapeLedger(launchDir);
  } catch (e) {
    return { refused: `the ledger ${ledgerPath} could not be read (${e instanceof Error ? e.message : String(e)})` };
  }
  // The last line naming the list - the answer that wrote it, or the recommended plan written without asking.
  const named = ledger.filter((l) => (l.event === "answer-used" || l.event === "run-shape-default") && typeof l.launch_list === "string" && resolvePath(l.launch_list) === listPath).at(-1);
  if (named?.event === "run-shape-default") {
    const at = `the run-shape-default line of ${ledgerPath} for the launch list ${listPath}`;
    if (named.run_id !== list.value.run_id) return { refused: `${at} is of run ${named.run_id}, and the list is of run ${list.value.run_id}` };
    if (named.shape !== DEFAULT_SHAPE || list.value.shape !== DEFAULT_SHAPE) {
      return { refused: `${at} records the shape ${String(named.shape)} and the list carries ${list.value.shape}: only the recommended shape ${DEFAULT_SHAPE} is used without asking` };
    }
    return { shape: DEFAULT_SHAPE, byDefault: true, ledgerLine: named };
  }
  const used = named;
  if (!used) {
    return { refused: `no answer-used line of ${ledgerPath} names the launch list ${listPath}, so its shape was not taken from the person's answer to the run-shape question` };
  }
  const where = `the answer-used line of ${ledgerPath} for the launch list ${listPath}`;
  if (used.run_id !== list.value.run_id) return { refused: `${where} is of run ${used.run_id}, and the list is of run ${list.value.run_id}` };
  const path = launchRecordPath(launchDir, RUN_SHAPE_ANSWER_FILE);
  const read = readRecorded("the run-shape answer", path, used.answer_sha256, where);
  if (!read.ok) return { refused: read.problem };
  let doc: Partial<RunShapeAnswer> | null = null;
  try {
    const parsed: unknown = JSON.parse(read.value.toString("utf8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) doc = parsed as Partial<RunShapeAnswer>;
  } catch {
    doc = null;
  }
  if (doc === null || doc.kind !== "run-shape-answer" || doc.version !== 1) return { refused: `${path} is not a run-shape answer (kind and version)` };
  if (doc.run_id !== used.run_id || doc.tool_use_id !== used.tool_use_id || doc.question_sha256 !== used.question_sha256) {
    return { refused: `${path} does not answer the run, call and question ${where} records` };
  }
  if (doc.answered !== true || typeof doc.answer !== "string") return { refused: `${path} carries no answer` };
  const question = loadRunShapeQuestion(launchDir);
  if ("problem" in question) return { refused: `the run-shape question cannot be read: ${question.problem}` };
  if (question.sha256 !== used.question_sha256) {
    return { refused: `the question in ${question.path} is now sha256 ${question.sha256}, not the ${used.question_sha256} the answer was given to (${where})` };
  }
  const shape = Object.hasOwn(question.shapeByLabel, doc.answer) ? question.shapeByLabel[doc.answer] : undefined;
  if (shape === undefined || doc.shape !== shape) return { refused: `${path} records the shape ${String(doc.shape)} for ${JSON.stringify(doc.answer)}, and the question maps that answer to ${String(shape)}` };
  if (list.value.shape !== shape) return { refused: `the launch list ${listPath} carries the shape ${list.value.shape}, and the person's answer is ${shape}` };
  const written = ledger
    .filter((l) => l.event === "answer-written" && l.answer_sha256 === used.answer_sha256 && l.tool_use_id === used.tool_use_id && l.question_sha256 === used.question_sha256)
    .at(-1);
  if (!written) return { refused: `no answer-written line of ${ledgerPath} records the answer ${where} names, so the scanner's hook did not write it` };
  return { shape, answer: doc as RunShapeAnswer, path, answerSha256: read.sha256, ledgerLine: written };
}

// ------------------------------------------------------------------------------------------------
// THE PRE-LAUNCH STEP'S CALL: the question on every call, the list once a shape is chosen
// ------------------------------------------------------------------------------------------------

export interface PreLaunchTextsArgs {
  plan: PreLaunchPlan;
  /** Build unit F5 M3: the plan file `adjudicate` wrote, by path and digest; recorded on the list where the plan carries places. */
  planFile?: { path: string; sha256: string };
  /**
   * Whether an entry of run `runId` is answered or kept not judged, by the relaunch rule (entry-answer.ts, which this
   * module does not import): where a list of the run stands, the step prices and names only what remains.
   */
  entryDone?: (runId: string) => (entryId: string) => boolean;
  findings: Pick<Findings, "scan_id" | "candidates" | "context_payloads" | "per_rule_applicability" | "profile_digest" | "dependency_inventory"> &
    Partial<Pick<Findings, "target">> & { ships_premises?: LaunchListArgs["shipsPremises"] };
  /**
   * The person's state folder, where the record of the start question is read and written (start-record.ts
   * `processStateDir`; the CLI passes its own). Absent or null, no record is read or written, and a plain call asks.
   */
  startRecordDir?: string | null;
  /**
   * On a later run, why the start question is asked again (`laterRunOf`); null or absent
   * where a later run starts without asking. Read only where the person's record says the price was shown before.
   */
  later?: LaterRun | null;
  /** Absolute paths. */
  findingsPath: string;
  launchDir: string;
  /** The shape given on the command line: for a run outside Claude Code (inside it, the plugin's hook refuses the flag). */
  shape?: string;
  /** Take the shape from the person's answer, which the plugin's hook wrote (`takeRunShape`), and from nothing else. */
  shapeFromAnswer?: boolean;
  /** Put the run-shape question (`/legal-scan plan`); without it the start question on a first scan, else none. */
  askShape?: boolean;
  profilePath?: string;
  /** The loaded profile and its digest, when `profilePath` was given (the caller loads it). */
  profile?: { value: unknown; digest: string } | null;
  subagentLimitFlag?: unknown;
  reservePlaces?: unknown;
  /** The name the reserve was given under: `--reserve-subagents`, or its earlier name `--reserve-places`. */
  reserveFlag?: string;
  seatModel?: string;
  env?: string;
  /**
   * Called when the run-shape question is written (`listPath` null) and again when the list is written:
   * the CLI writes the active-run marker the launch gate acts on (hook-launch.ts, relay item 4).
   */
  onRunWritten?: (run: { runId: string; scanId: string; listPath: string | null }) => void;
  /**
   * Asked once there is a run to write, before any of it is written: a refusal stops the step with exit 1 and
   * no run-shape question, list or marker. The CLI passes `markerSessionRefusal` (hook-launch.ts:
   * inside Claude Code no marker is written without the session id).
   */
  refuseRun?: () => string | null;
  /**
   * The caller's own writes (the CLI's --out plan and --carry-into copies), made first under the step's lock, after
   * every refusal decided before any write (relay integration part B, item 3): refused before, or at, the lock, the
   * step writes neither.
   */
  writeUnderLock?: () => void;
  /** By finding id, the places the previous run's verdict left unread (the plan's partition rows). */
  previousNotChecked?: Record<string, PreviousNotChecked>;
}

/**
 * Write `run-shape-question.json` on every call and, where a shape is given (`shape`) or taken from
 * the person's answer (`shapeFromAnswer`), the launch list with its briefs. Returns the lines to print
 * and the exit code: 1 where the list is refused (no payloads, an unknown shape, no usable answer, a
 * profile that is not the one the scan read), and nothing is written for the list then.
 */
export function preLaunchTexts(args: PreLaunchTextsArgs): { lines: string[]; exitCode: number; notStarted?: boolean } {
  const scanId = args.findings.scan_id ?? "(no scan id)";
  const runId = runIdFor(args.plan, scanId);
  const allCandidates = args.findings.candidates ?? [];
  const keep = new Set(args.plan.to_adjudicate);
  const remainingCandidates = allCandidates.filter((c) => keep.has(c.finding_id));
  const remainingKeys = new Set(args.plan.remaining_payloads);
  const remainingRows = (args.findings.context_payloads?.payloads ?? []).filter((r) => remainingKeys.has(r.key));
  const limitFrom = subagentLimitFrom(args.subagentLimitFlag, args.env);
  if ("refused" in limitFrom) return { lines: [limitFrom.refused], exitCode: 1 };
  const { limit, source } = limitFrom;
  const reservedRaw = args.reservePlaces === undefined ? ORCHESTRATOR_RESERVED_PLACES : wholeNumber(args.reservePlaces);
  const lines: string[] = [];
  if (reservedRaw === null || reservedRaw >= limit) {
    return { lines: [noPlaceLeft(limit, source, reservedRaw, args.reservePlaces, args.reserveFlag)], exitCode: 1 };
  }
  const capacity = limit - reservedRaw;
  // Relay integration part B, item 3 (STOP 2): the refusals above are decided before any write and write nothing - no
  // launch directory and no plan. Every write from here on is made under the launch list's one lock, taken once before
  // the first of them (`underLaunchLock`): the caller's --out plan and --carry-into copies (`writeUnderLock`), the
  // run-shape question and its ledger line, the marker, the list with its briefs, and the answer's used mark.
  const step = underLaunchLock(args.launchDir, () => {
    args.writeUnderLock?.();
    return preLaunchUnderLock(args, { scanId, runId, allCandidates, remainingCandidates, remainingRows, limit, source, reservedRaw, capacity, lines });
  });
  return step.ok ? step.value : { lines: [...lines, step.refused], exitCode: 1 };
}

/**
 * What the list carried from the run's standing list (`carryRunState`, launch-list-file.ts), in the step's report:
 * the appended entries kept with their ids, briefs and digests, or why a list of the run could not be read back.
 */
/** What the written list still has to launch, where a list of the run stood before it. */
function remainderLines(list: LaunchList, remainder: RunRemainder | null, done: ((entryId: string) => boolean) | null): string[] {
  if (remainder === null || done === null) return [];
  const left = list.entries.filter((e) => !done(e.id)).map((e) => e.id);
  return [
    `  still to go: ${left.length} of these ${list.entries.length} entries${left.length > 0 ? ` (${idsOf(left)})` : ""}; the other ${list.entries.length - left.length} are answered or kept not judged and are not launched again.` +
      " Launch what launch-next prints, and run it again after every returned seat.",
  ];
}

function carriedLines(c: Carried | null): string[] {
  if (c === null) return [];
  if (c.unreadable !== null) {
    return [
      `  carried: nothing - a launch list of this run stands at the list's path and cannot be read back as the list the program wrote (${c.unreadable}), so none of it was read.` +
        " A record bound to an entry that list held is refused at step 6 with the command that appends the entry again.",
    ];
  }
  if (c.from === null) return [];
  const from = `the run's list (sha256 ${c.from.sha256.slice(0, 16)}..., shape ${c.from.shape})`;
  if (c.entries.length === 0) return [`  carried from ${from}: nothing - the run appended no entry to it.`];
  return [
    `  carried from ${from}: the ${c.entries.length} entr${c.entries.length === 1 ? "y" : "ies"} the run appended, with the same ids, briefs and digests (${c.entries.join(", ")});` +
      " the records captured for them stay bound, and an entry that had not returned is launched as any other.",
  ];
}

interface PreLaunchState {
  scanId: string;
  runId: string;
  allCandidates: Candidate[];
  remainingCandidates: Candidate[];
  remainingRows: FindingsContextPayloadRow[];
  limit: number;
  source: string;
  reservedRaw: number;
  capacity: number;
  lines: string[];
}

/** The pre-launch step from its first write on, the caller holding the launch list's lock (`preLaunchTexts`). */
function preLaunchUnderLock(args: PreLaunchTextsArgs, s: PreLaunchState): { lines: string[]; exitCode: number; notStarted?: boolean } {
  const { scanId, runId, allCandidates, remainingCandidates, remainingRows, limit, source, reservedRaw, capacity, lines } = s;
  // The program says whether the memory file is there, so the
  // orchestrator never tests for it with a command whose failure the person sees as an error.
  const memory = join(dirname(args.launchDir), "memory.md");
  lines.push(
    existsSync(memory)
      ? `MEMORY FILE: ${memory} is there. Show it to the person as skill step 4 says; nothing in it settles a candidate.`
      : `MEMORY FILE: ${memory} is not there. There is nothing to show, and nothing to check for it.`,
  );
  if (remainingRows.length === 0) {
    lines.push(
      "PRICE TABLE: nothing to price - this scan wrote no payload file that still launches, so no launch list and no run-shape question are written (skill step 3l).",
    );
    if (args.shape) return { lines: [...lines, `--shape ${args.shape}: refused - there is no launch to list.`], exitCode: 1 };
    if (args.shapeFromAnswer) return { lines: [...lines, "--shape-from-answer: refused - there is no launch to list."], exitCode: 1 };
    return { lines, exitCode: 0 };
  }
  const refusedRun = args.refuseRun?.() ?? null;
  if (refusedRun !== null) return { lines: [refusedRun], exitCode: 1 };
  // Where a list of this run stands, what remains of it, read before this step writes anything over it.
  let done: ((entryId: string) => boolean) | null = null;
  let remainder: RunRemainder | null = null;
  try {
    done = args.entryDone ? args.entryDone(runId) : null;
    remainder = runRemainder(args.launchDir, runId, args.plan.preview.shapes.map((x) => x.shape), remainingCandidates, remainingRows, capacity, done);
  } catch (e) {
    done = null;
    lines.push(`  what remains of run ${runId} could not be read (${(e as Error).message}), so each shape below is priced whole.`);
  }
  const table = priceTable({
    runId,
    plan: args.plan,
    remainingCandidates,
    remainingRows,
    allCandidates,
    findingsPath: args.findingsPath,
    waveCapacity: capacity,
    subagentLimit: limit,
    reservedPlaces: reservedRaw,
    remainder,
  });
  const questionPath = launchRecordPath(args.launchDir, RUN_SHAPE_QUESTION_FILE, true);
  // The run-shape question only under --ask-shape; the start question on a
  // first scan; no question on a later scan, where the list is written in the recommended shape (below).
  // A shape named on the command line (a run outside Claude Code) is the person's own choice of plan: the run-shape
  // question is written beside it as before, and nobody is asked. Whether this person was shown this project's price before, from their own record alone (start-record.ts).
  const record = priceShownBefore(args.startRecordDir ?? null, args.findings.target);
  const later = record.shown ? (args.later ?? null) : null;
  const mode = askModeOf(args.askShape === true || args.shape !== undefined, record.shown, table, later);
  if (mode !== "none") {
    const put = mode === "start" ? startQuestion(table, later, process.env) : { question: table.question, shape_by_label: table.shape_by_label };
    const questionText = `${JSON.stringify(
      { kind: "run-shape-question", version: 1, scan_id: scanId, run_id: runId, ask_user_question_input: put.question, shape_by_label: put.shape_by_label, shapes: table.shapes, price_table_lines: table.lines },
      null,
      2,
    )}\n`;
    writeFileAt(questionPath, questionText);
    // The hook passes only the question of the file this line records (hook-question.ts, the ledger).
    try {
      recordRunShapeQuestion(args.launchDir, runId, questionText, new Date());
    } catch (e) {
      return { lines: [...lines, `refused - the ${mode === "start" ? "start" : "run-shape"} question could not be recorded in the ledger beside ${questionPath} (${(e as Error).message}), so the hook would not show it. No launch list was written.`], exitCode: 1 };
    }
    lines.push(
      ...(mode === "start"
        ? [
            (later !== null
              ? `START QUESTION for run ${runId}: a later scan of this project that ${later.none ? "carries no earlier review" : `would send ${later.judged_again} place(s) the earlier log answered back to the review and carry ${later.carried}`}, so the person is asked again whether to start step 2, with its cause, its time and amount `
              : `START QUESTION for run ${runId}: the first scan of this project for this person (${record.shown ? "" : record.why}), so the person is asked once whether to start step 2, with its time and amount `) +
              `(the recommended plan, ${SHAPE_LABEL[DEFAULT_SHAPE]}: its row of the price table, which the question carries; do not re-word, re-compute or re-type it).`,
          ]
        : table.lines),
      `To ask the person the ${mode === "start" ? "start" : "run-shape"} question, ${PASS_EXACTLY}, alone in its call and with every character as it is - copy the line below whole; do not re-word, shorten or re-type any of it. ` +
        `The scanner's hook compares it with ${questionPath} character by character, refuses any difference (saying what differs and what to pass), and records the answer:`,
      ...askInputLines(put.question, dirname(args.launchDir)),
    );
  }
  args.onRunWritten?.({ runId, scanId, listPath: null });
  if (args.shape !== undefined && args.shapeFromAnswer) {
    return { lines: [...lines, "--shape and --shape-from-answer: refused - give one: --shape-from-answer inside Claude Code, --shape outside it. No launch list was written."], exitCode: 1 };
  }
  let shape = args.shape;
  let taken: TakenRunShape | null = null;
  let byDefault = false;
  if (args.shapeFromAnswer && mode === "none") {
    return {
      lines: [
        ...lines,
        "--shape-from-answer: refused - no question is put on this run: a later scan of this project uses the recommended plan without asking. " +
          "Run this command without --shape-from-answer; where the person typed /legal-scan plan, add --ask-shape to both calls. No launch list was written.",
      ],
      exitCode: 1,
    };
  }
  if (args.shapeFromAnswer) {
    const t = takeRunShape(args.launchDir);
    if ("refused" in t) return { lines: [...lines, `--shape-from-answer: refused - ${t.refused}. No launch list was written.`], exitCode: 1 };
    if (t.shape === NOT_NOW_SHAPE) {
      try {
        markRunShapeAnswerUsed(args.launchDir, t, null, new Date(), "the person answered Not now to the start question: no launch list was written");
      } catch (e) {
        return { lines: [...lines, `--shape-from-answer: refused - the answer could not be marked as used (${(e as Error).message}). No launch list was written.`], exitCode: 1 };
      }
      lines.push(
        `NOT STARTED: the person answered ${JSON.stringify(t.answer.answer)} to the start question (recorded by the hook at ${t.answer.recorded_at} in ${t.path} for call ${t.answer.tool_use_id}). ` +
          "No launch list was written, and the program ends the run here, as run-abort does. Launch nothing.",
        `FOR THE PERSON (tell them this sentence as it is): ${NOT_NOW_WORDS}`,
      );
      return { lines, exitCode: 0, notStarted: true };
    }
    taken = t;
    shape = t.shape;
    lines.push(
      `Run shape \`${shape}\`: the person's answer ${JSON.stringify(t.answer.answer)} to this question, recorded by the hook at ${t.answer.recorded_at} in ${t.path}` +
        ` for call ${t.answer.tool_use_id}, which the hook's ledger records with this answer.`,
    );
  }
  if (shape === undefined && mode === "none") {
    shape = DEFAULT_SHAPE;
    byDefault = true;
    lines.push(
      `Run shape \`${shape}\` (${SHAPE_LABEL[DEFAULT_SHAPE]}): a later scan of this project, so the recommended plan is used without asking. ` +
        "The person chooses another plan only by typing /legal-scan plan, which runs this step with --ask-shape.",
    );
  }
  const flag = args.shapeFromAnswer ? "--shape-from-answer" : byDefault ? "the recommended plan" : `--shape ${shape}`;
  if (!shape) {
    lines.push("No launch list was written: it is written once the person has answered, by this same command with --shape-from-answer (--shape is for a run outside Claude Code).");
    return { lines, exitCode: 0 };
  }
  if (!(RUN_SHAPES as readonly string[]).includes(shape)) {
    return { lines: [...lines, `${flag}: refused - ${shape} is not a shape; the shapes are ${RUN_SHAPES.join(", ")}. No launch list was written.`], exitCode: 1 };
  }
  const digest = args.findings.profile_digest ?? null;
  if (digest !== null && (!args.profile || args.profile.digest !== digest)) {
    return {
      lines: [
        ...lines,
        args.profile
          ? `--profile ${args.profilePath}: refused - its digest ${args.profile.digest} is not the profile_digest ${digest} the scan recorded, so a brief would hand the seats a profile the scan did not read. No launch list was written.`
          : `${args.shapeFromAnswer ? "--shape-from-answer" : byDefault ? "Writing the launch list" : "--shape"} needs --profile: the scan read a profile (profile_digest ${digest}) and every brief hands it on. Pass the file step 2 passed. No launch list was written.`,
      ],
      exitCode: 1,
    };
  }
  if (digest === null && args.profile) {
    return { lines: [...lines, `--profile ${args.profilePath}: refused - the scan read no profile (profile_digest is null), so no brief may hand one on. No launch list was written.`], exitCode: 1 };
  }
  const findingsDir = dirname(args.findingsPath);
  const orientationSheet = orientationSheetBeside(findingsDir, scanId);
  const orientationNotes = join(findingsDir, "orientation-notes.md");
  let built: ReturnType<typeof buildLaunchList>;
  let listPath: string;
  let carried: Carried | null = null;
  const runContext: RunContext = {
    kind: "run-context",
    scan_id: scanId,
    run_id: runId,
    profile: digest !== null ? (args.profile?.value ?? null) : null,
    profile_note:
      digest !== null
        ? `The ScanProfile this scan read (profile_digest ${digest}).`
        : "No ScanProfile was supplied to this scan: every question a profile would have answered is open.",
    dependency_inventory: args.findings.dependency_inventory ?? [],
  };
  try {
    const runContextLines = lineStats(`${lineSafeJson(runContext)}\n`).lines;
    built = buildLaunchList({
      ...(args.findings.ships_premises ? { shipsPremises: args.findings.ships_premises } : {}),
      // Build unit F5 M3: the reader seats the plan does not launch (every place carried), by their candidate's group.
      ...(args.plan.carried_seats && args.plan.carried_seats.length > 0
        ? {
            carriedReaders: args.plan.carried_seats.reduce((m, c) => {
              const g = groupKeyOf({ key: c.key } as FindingsContextPayloadRow);
              m.set(g, [...(m.get(g) ?? []), c.reader].sort((a, b) => a - b));
              return m;
            }, new Map<string, number[]>()),
            ...(args.planFile ? { planFile: args.planFile } : {}),
          }
        : {}),
      runContextLines,
      runContext,
      scanId,
      runId,
      shape: shape as RunShape,
      remainingCandidates,
      allCandidates,
      remainingRows,
      applicability: args.findings.per_rule_applicability ?? null,
      findingsPath: args.findingsPath,
      launchDir: args.launchDir,
      orientationSheet,
      orientationNotes: existsSync(orientationNotes) ? orientationNotes : null,
      profileSupplied: digest !== null,
      subagentLimit: limit,
      subagentLimitSource: source,
      reservedPlaces: reservedRaw,
      model: args.seatModel ?? SEAT_MODEL,
      ...(args.seatModel !== undefined ? { seatModelOverride: args.seatModel } : {}),
      verdictsDir: join(findingsDir, "verdicts"),
      readersDir: join(findingsDir, "readers"),
      ...(args.previousNotChecked ? { previousNotChecked: args.previousNotChecked } : {}),
    });
    const w = writeLaunchListLocked(args.launchDir, built.list, built.briefs, runContext, built.copies);
    listPath = w.path;
    built = { ...built, list: w.list };
    carried = w.carried;
  } catch (e) {
    return { lines: [...lines, `${flag}: refused - ${(e as Error).message}. No launch list was written.`], exitCode: 1 };
  }
  if (taken) {
    // An answer is used once (§3.5 part 2): a second --shape-from-answer on it is refused.
    try {
      markRunShapeAnswerUsed(args.launchDir, taken, listPath, new Date());
    } catch (e) {
      removePath(listPath, { force: true });
      return { lines: [...lines, `${flag}: refused - the answer could not be marked as used (${(e as Error).message}), so the launch list ${listPath} was removed again.`], exitCode: 1 };
    }
    // The person's answer to a question that showed this project's price started the review - recorded on
    // their machine, outside the scanned folder, so a later scan of this folder by them does not ask again. A record
    // that cannot be written is said; the next scan then asks, the safe direction.
    const wrote = writeStartRecord(args.startRecordDir ?? null, args.findings.target, { question: mode === "start" ? "start" : "run-shape", answer: taken.answer.answer ?? "", run_id: runId, scan_id: scanId }, new Date());
    if (!wrote.written) lines.push(`  the record that the person was shown this project's price was not written (${wrote.why}): the next scan of this folder asks the start question again.`);
  }
  if (byDefault) {
    // The list names this line, and the assembly ties the list's shape to it (`runShapeFromAnswer`).
    try {
      recordRunShapeDefault(args.launchDir, runId, DEFAULT_SHAPE, listPath, new Date());
    } catch (e) {
      removePath(listPath, { force: true });
      return { lines: [...lines, `${flag}: refused - the recommended plan could not be recorded in the ledger (${(e as Error).message}), so the launch list ${listPath} was removed again.`], exitCode: 1 };
    }
  }
  args.onRunWritten?.({ runId, scanId, listPath });
  const { list, copies } = built;
  lines.push(
    `LAUNCH LIST for run ${runId}, shape ${list.shape}: ${list.entries.length} launch(es) in ${list.waves.length} wave(s) of at most ${capacity}` +
      ` (${limit} at once from ${source}, ${reservedRaw} left for the orchestrator), written to ${listPath}.` +
      " Pass each entry's agent_input unchanged; launch a wave's entries together and a later entry once a place is free and what it waits for has returned.",
    ...list.waves.map((w) => `  wave ${w.wave}: ${w.entries.length} launch(es)`),
    // Review R18: a rule read on a model other than its own setting is named, with its place count, every time.
    ...(() => {
      const said = modelOverrideLine(list.model_overrides ?? []);
      return said ? [`  ${said}`] : [];
    })(),
    `  not listed yet: ${list.not_listed.join("; ")}.`,
    ...carriedLines(carried),
    ...remainderLines(list, remainder, done),
    ...(copies.size > 0
      ? [
          `  reading copies: ${copies.size} file(s) another step wrote hold lines longer than ${READ_LINE_LIMIT} characters, which a seat's Read may cut;` +
            ` each brief names the program's line-safe copy instead, written under ${join(args.launchDir, "reading")}.`,
        ]
      : []),
  );
  //
  // A later scan starts the recommended plan without asking, and the person is shown none of
  // this step's output but its FOR THE PERSON sentences (SKILL.md step 3j-3l): one says the plan and its figure, the start
  // question's own (`startQuestion`), and asks nothing. Only once the list is written.
  const defaultRow = byDefault ? table.shapes.find((x) => x.shape === DEFAULT_SHAPE) : undefined;
  if (defaultRow) {
    lines.push(
      // The plan by its bare name, and the start
      // question's payer sentence (`payerWords`, money on an API key), since this is the one price a later scan shows.
      `FOR THE PERSON (tell them this sentence as it is): The AI review starts now without a question, as on every later scan of this project, on the recommended plan, ${SHAPE_LABEL[DEFAULT_SHAPE].replace(/ \(Recommended\)$/, "")}: ` +
        `${tokenRangeWords(defaultRow.tokens_low, defaultRow.tokens_high)}, ${range(defaultRow.seconds_low, defaultRow.seconds_high)}. ${payerWords(process.env, defaultRow.tokens_low, defaultRow.tokens_high)} Type /legal-scan plan to choose another plan.`,
    );
  }
  return { lines, exitCode: 0 };
}

/**
 * THE DEEPER CHECK'S LAUNCH ENTRY (design rf13 3.9, step 2 and "The check's own run"). A deeper check of one finding has its own folder, `.legal/deep/<id>/<time>/`, named to the second and
 * created exclusively (`makeDeepCheckFolder`: a second check of the finding in the same second is refused), and its own
 * launch folder in it, `launch/`, never the scan's `.legal/launch/`: the launch list (`launch-list.json`, kind
 * `deep-launch-list`), the briefs (`briefs/deep-<seat>.md`) and the events (`launch-events.jsonl`: `listed`, then the
 * hook's `reserved`, `launched`, `returned` or `failed`). Each seat of the check (the plan, then the reading) is one
 * entry of the seat kind `legal-deep-checker`, launched in the background with exactly the entry's `agent_input`
 * (hook-capture.ts `onDeepLaunch` refuses any other), and writing its entry writes the check's marker for that seat
 * (hook.ts `writeDeepMarker`), which the command that takes its answer removes. Nothing here is written for a scan, and
 * a scan's launch list, run shape, declaration and earlier-run files are never touched.
 */
export const DEEP_LAUNCH_LIST = "launch-list.json";
export const DEEP_LAUNCH_EVENTS = "launch-events.jsonl";
/** The reply schema each seat of the check answers in (schemas.generated.ts; hook-capture.ts checks the answer against it). */
export const DEEP_REPLY_SCHEMAS: Readonly<Record<DeepSeat, string>> = { plan: "deep-plan-reply.schema.json", reading: "deep-reading-reply.schema.json" };

export interface DeepLaunchEntry {
  id: `deep-${DeepSeat}`;
  seat: DeepSeat;
  finding_id: string;
  /** Every file the brief names for the seat to read, with its sha256 when the entry was written. */
  reads: { path: string; sha256: string }[];
  brief_path: string;
  brief_sha256: string;
  launch: typeof LAUNCH_FORM;
  agent_input: AgentInput;
  agent_input_sha256: string;
  schema: string;
  listed_at: string;
}

export interface DeepLaunchList {
  kind: "deep-launch-list";
  version: 1;
  finding_id: string;
  /** Absolute: `<project>/.legal/deep/<id>/<time>`. */
  check_dir: string;
  entries: DeepLaunchEntry[];
}

export interface DeepLaunchEvent {
  entry: string;
  event: "listed" | "reserved" | "launched" | "returned" | "failed";
  at: string;
  /** `reserved`: the Agent call's tool_use_id; `launched`, `returned`: the seat's agent id. */
  tool_use_id?: string;
  seat?: string;
}

/**
 * Whether git tracks `rel` in `projectDir`: through the CLI's git runner (child-program.ts `gitRunner`: git from outside
 * the project, every program key neutralised), so that the folder's own git configuration runs nothing. Null where git is
 * not run or does not answer (not a work tree, no git): the marker is then read on its other conditions.
 */
export function deepTracked(projectDir: string): DeepTracked {
  return (rel) => {
    const git = gitRunner(projectDir);
    if (git === null) return null;
    const r = git(["ls-files", "--", rel]);
    if (r.error || r.status !== 0) return null;
    return r.stdout.split("\n").some((l) => l.trim() === rel);
  };
}

/**
 * Create the check's own folder `<project>/.legal/deep/<id>/<time>/` exclusively: refused where it already
 * stands (a check of this finding started this second), where the id is not a plain name, and where a folder on the way
 * is a link (project-write.ts walks each name). Its `launch/` is made with it.
 */
export function makeDeepCheckFolder(projectDir: string, findingId: string, at: Date): { ok: true; checkDir: string; time: string } | { ok: false; why: string } {
  if (!DEEP_ID.test(findingId)) return { ok: false, why: `"${findingId}" is not a finding id a check's folder may take` };
  const time = deepCheckTime(at);
  const checkDir = join(resolve(projectDir), ".legal", DEEP_FOLDER, findingId, time);
  let made: string | undefined;
  try {
    made = makeFolder(checkDir, { recursive: true });
  } catch (e) {
    return { ok: false, why: `the check's folder ${checkDir} could not be made (${(e as Error).message})` };
  }
  if (made === undefined) return { ok: false, why: "a check of this finding started this second; ask again" };
  makeFolder(join(checkDir, "launch"), { recursive: true });
  return { ok: true, checkDir, time };
}

/** The check's launch list, or null where there is none or it is not one. */
export function readDeepLaunchList(launchDir: string): DeepLaunchList | null {
  const got = readProgramFile("the deeper check's launch list", join(launchDir, DEEP_LAUNCH_LIST));
  if (!got.ok) return null;
  try {
    const v = JSON.parse(got.value.toString("utf8")) as DeepLaunchList;
    return v && v.kind === "deep-launch-list" && v.version === 1 && Array.isArray(v.entries) ? v : null;
  } catch {
    return null;
  }
}

/** The check's launch events, oldest first; a line that is not one is skipped. */
export function readDeepLaunchEvents(launchDir: string): DeepLaunchEvent[] {
  const got = readProgramFile("the deeper check's launch events", join(launchDir, DEEP_LAUNCH_EVENTS));
  if (!got.ok) return [];
  const out: DeepLaunchEvent[] = [];
  for (const l of got.value.toString("utf8").split("\n")) {
    if (l.trim() === "") continue;
    try {
      const e = JSON.parse(l) as DeepLaunchEvent;
      if (e && typeof e.entry === "string" && typeof e.event === "string") out.push(e);
    } catch {
      // not a line of this file
    }
  }
  return out;
}

export function appendDeepLaunchEvent(launchDir: string, e: DeepLaunchEvent): void {
  appendFileAt(join(launchDir, DEEP_LAUNCH_EVENTS), `${JSON.stringify(e)}\n`);
}

/**
 * Write one seat's launch entry into the check's own launch folder, and the check's marker for it. `brief` is the
 * launch brief's whole text (the caller's: `deepen` composes it), `reads` the files it names. Refused, with nothing
 * written, where the folder is not this project's check folder for `findingId`, where the list already has this seat's
 * entry, where a file to read cannot be read, or where the marker cannot be written (git tracks it: W5).
 */
export function writeDeepLaunchEntry(args: {
  projectDir: string;
  checkDir: string;
  findingId: string;
  seat: DeepSeat;
  brief: string;
  reads: string[];
  sessionId: string;
  at: Date;
  tracked?: DeepTracked;
  model?: string;
}): { ok: true; entry: DeepLaunchEntry; listPath: string; marker: DeepMarker } | { ok: false; why: string; ended?: true } {
  const { projectDir, findingId, seat, brief, sessionId, at } = args;
  const tracked = args.tracked ?? deepTracked(projectDir);
  const checkDir = resolve(args.checkDir);
  const time = basename(checkDir);
  if (!DEEP_ID.test(findingId) || !DEEP_TIME.test(time) || checkDir !== join(resolve(projectDir), ".legal", DEEP_FOLDER, findingId, time)) {
    return { ok: false, why: `${checkDir} is not this project's folder of a check of ${findingId}` };
  }
  if (sessionId === "") return { ok: false, why: "no session to write the check's marker for (a deeper check runs only in a Claude Code session)" };
  const launchDir = join(checkDir, "launch");
  const listPath = join(launchDir, DEEP_LAUNCH_LIST);
  const standing = existsSync(listPath) ? readDeepLaunchList(launchDir) : null;
  if (existsSync(listPath) && standing === null) return { ok: false, why: `${listPath} is not a deeper check's launch list` };
  const id = `deep-${seat}` as const;
  if (standing?.entries.some((e) => e.id === id)) return { ok: false, why: `this check already has its ${seat} seat's entry` };
  const reads: { path: string; sha256: string }[] = [];
  for (const p of args.reads) {
    const got = readProgramFile("a file the deeper check's brief names", p);
    if (!got.ok) return { ok: false, why: got.problem };
    reads.push({ path: resolve(p), sha256: createHash("sha256").update(got.value).digest("hex") });
  }
  const briefPath = join(launchDir, "briefs", `${id}.md`);
  const agentInput: AgentInput = {
    subagent_type: DEEP_AGENT_TYPE,
    description: `Deeper check of ${findingId}: the ${seat}`,
    prompt: `${briefReadWords(briefPath, brief)} and follow it.`,
    model: args.model ?? SEAT_MODEL,
  };
  const entry: DeepLaunchEntry = {
    id,
    seat,
    finding_id: findingId,
    reads,
    brief_path: briefPath,
    brief_sha256: sha256(brief),
    launch: LAUNCH_FORM,
    agent_input: agentInput,
    agent_input_sha256: sha256(canonicalJson(agentInput)),
    schema: DEEP_REPLY_SCHEMAS[seat],
    listed_at: at.toISOString(),
  };
  const list: DeepLaunchList = standing ?? { kind: "deep-launch-list", version: 1, finding_id: findingId, check_dir: checkDir, entries: [] };
  if (list.finding_id !== findingId || resolve(list.check_dir) !== checkDir) return { ok: false, why: `${listPath} is another check's list` };
  makeFolder(join(launchDir, "briefs"), { recursive: true });
  try {
    createNewFile(briefPath, brief);
  } catch (e) {
    return { ok: false, why: `the brief ${briefPath} could not be written (${(e as Error).message})` };
  }
  const marker = writeDeepMarker(projectDir, { finding_id: findingId, session_id: sessionId, launch_dir: launchDir, seat }, at, tracked);
  if (!marker.ok) {
    removePath(briefPath, { force: true });
    return { ok: false, why: marker.why };
  }
  // From the marker on, a failing write ends the check here (design 3.9:
  // every exit that ends a check removes the marker and has a history line): the marker removed with its "error"
  // line, the list put back as it stood and the brief removed, so that no marker captures a seat's answer into a
  // check whose launch list does not hold the entry. The callers' `!entry.ok` paths then report the refusal.
  const before = existsSync(listPath) ? readRegularFile(listPath) : null;
  try {
    writeFileAt(listPath, `${JSON.stringify({ ...list, entries: [...list.entries, entry] }, null, 2)}\n`);
    appendDeepLaunchEvent(launchDir, { entry: id, event: "listed", at: at.toISOString() });
  } catch (e) {
    endDeepCheck(projectDir, "error", at, tracked, sessionId === "" ? null : sessionId);
    try {
      if (before === null) removePath(listPath, { force: true });
      else writeFileAt(listPath, before);
    } catch {
      // The list could not be put back: the check is ended all the same, and a later check uses a new folder.
    }
    removePath(briefPath, { force: true });
    return { ok: false, ended: true, why: `the launch list ${listPath} could not be written (${(e as Error).message}); the check was ended` };
  }
  return { ok: true, entry, listPath, marker: marker.marker };
}
