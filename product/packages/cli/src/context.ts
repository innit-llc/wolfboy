import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { makeFolder, removePath, writeFileAt } from "./project-write.js";
import { dirname, join } from "node:path";
import type {
  Candidate,
  Findings,
  FindingLocation,
  FindingsContextPayloadRow,
  FindingsContextPayloads,
  Rule,
} from "wolfboy-schemas";
import { manifestNamesOf, nameWordsOf, namesPublisherHost, OWN_NAME_QUESTION, ownNameEntryOf, ownNamePremiseOf, SELF_NAME_RULES, vendorEntriesOf, vendorSoftwareOf, type ManifestName } from "./own-name.js";
import { ownerIndexOf } from "./item-label.js";
import { costPreview } from "./cost-preview.js";
import { computeKindCensus, declaredReadingClassOf, placeSeats as cutIntoPlaceSeats, planReading, sortLocationsForCensus } from "./kind-census.js";
import { type DataSummary, type ParsedDataFile, SUMMARIES_ARE, type SummaryPlan, summarizeCandidate } from "./data-summary.js";
import { READ_RANGE_BYTES } from "./launch-plan.js";
import { type PlaceFact, placeFactsFor } from "./place-facts.js";
import { MAX_PLACES_PER_SEAT } from "./scan.js";
import {
  SKELETON_SUB_SHAPES_LISTED,
  type SkeletonUnit,
  catalogueSummary,
  skeletonOf,
  sortedSubShapes,
  readersOf,
  readingPlanOf,
  readingUnitsCensusOf,
  readingUnitsOf,
  type ReadingCatalogueSummary,
  type ReadingCensus,
  type ReadingKind,
  type ReadingSkeleton,
} from "./reading.js";
import { guardWorkingFolder } from "./legal-dir.js";
import { decodeSourceText, readRegularFile } from "./project-read.js";
import { redactSeatText } from "./credential-redaction.js";
import { productPrintedRedaction } from "./product-redaction.js";
import { placeId } from "./ref-ids.js";

/**
 * Layer 1's verbatim neighbourhood of every matched line, written for layer 2.
 *
 * ## What this is for
 *
 * Today a location is `{file, start_line}` and nothing else — not even the matched line — so the
 * first act of every adjudicating agent is to read the file, often whole. Measured over the 82
 * adjudicator transcripts of one real run on 2026-09-02: 1,320 tool calls, 684 of them reads of
 * code, and 40 of the 75 `not_applicable` verdicts rest entirely on evidence within 30 lines of the
 * candidate's own locations. Handing the child that neighbourhood removes the read for the half of
 * the verdicts that are decided next to the match, and removes the whole-file read for the other
 * half. **It does not remove the tools**, and the brief the child is given says so in the owner's
 * own words: *the windows are where you start reading, not where you stop; a verdict that cannot be
 * decided without tracing is not issued until you have traced.*
 *
 * ## The one thing this file may never do
 *
 * Nothing here decides anything. It copies bytes out of files the scan already read and writes them
 * beside the document, with the file's own line numbers. No pattern here is a detector, no count
 * here narrows anything, and a location that gets a smaller window than another still reaches layer
 * 2 with every field it had before (layer 1 emits more, never less).
 *
 * ## Where the excerpts live, and why not in `findings.json`
 *
 * Measured on the three prepared trees, at the shipped window of 40 lines each side:
 *
 * | tree | locations | files | `findings.json` today | + windows, per location | + windows, deduplicated |
 * |---|---:|---:|---:|---:|---:|
 * | a large Node CMS | 14,143 | 2,704 | 19.69 MB | ~70.9 MB | ~33.8 MB |
 * | tree A | 996 | 264 | 3.32 MB | ~6.8 MB | ~4.3 MB |
 * | tree B | 138 | 36 | 1.21 MB | ~1.6 MB | ~1.3 MB |
 *
 * Even fully deduplicated the document is 34 MB on the corpus's largest Node CMS, and the consumer of that document is an
 * agent opening it with a Read tool. So the excerpts are NOT in the document: one payload file per
 * adjudication group is written beside it, `findings.json` carries only an index of those files, and
 * the orchestrator assembles a child's launch message by reading ONE small file (ideas.md B(2)).
 * Measured the same way, a payload file's own excerpt text is a median of **4.9 kB on that CMS, 4.2 kB
 * on tree A and 2.0 kB on tree B** — one payload per FILE GROUP, which is what
 * `--pack-groups off` writes. Under the shipped default the groups are unit A's bins, so there are
 * fewer and larger payloads and these three numbers do not describe them; the packed sizes are in
 * an internal record (measurement P), and the sizes after the rule
 * prose was written once per payload are in an internal record
 * (`RULE_OWNED_IN_PAYLOAD` below). **These three medians are unmoved by that change**: it removes
 * candidate prose and copies no fewer bytes out of the tree.
 *
 * RE-MEASURED 2026-09-17, when the excerpt budgets were integrated. The figures here said
 * 4.7 / 3.7 / 2.0 and had been taken BEFORE the per-location floor was raised to 3 kB, so two of the
 * three were 12-13 % low the day they shipped; the largest tree's moved again when the target-correctness
 * integration removed 2,852 of its locations. **This is the only copy of these three numbers in
 * shipped code** — `findings.schema.json` carried a second one and now points here instead, because
 * a measured figure kept in two places goes stale in one of them.
 *
 * ## Deduplicated per file, and presented as excerpts rather than nested per location
 *
 * Two locations eleven lines apart in one file have windows that overlap by 69 lines. Repeating that
 * text under each location is what takes that CMS's excerpt total from 17 MB to 47 MB, and it is also
 * the harder thing to read. So the windows of one file are merged into contiguous ranges, each range
 * is written ONCE, and each location's `context` names the range that covers it by its id
 * (`<file>:<start>-<end>`). Every location still has a `context` block; what is deduplicated is the
 * text, not the location's entitlement to it.
 *
 * ## Verbatim means verbatim, with no line-number prefix
 *
 * An excerpt's `text` is the file's own lines joined with `\n`, byte for byte, and the line numbers
 * are in `start_line` / `end_line` beside it rather than prefixed onto each line. That is not a
 * formatting preference: an adjudicator's verdict is void without a quote, the quote is checked
 * against the real file (`reconcile-verify.ts`, a test), and a child that
 * copies a quote out of a numbered view produces a quote carrying `12\t` that no file contains.
 */

/** Lines each side of the matched line, and the default `--context-window`. */
export const DEFAULT_CONTEXT_WINDOW = 40;

/**
 * The most excerpt text one LOCATION may be given, before the per-payload budget below is applied.
 *
 * 8 KiB, which on the three prepared trees bites only at the very top of the distribution: the
 * per-location window is a median of 2.5 kB on that CMS, 4.9 kB at p90 and 11.9 kB at its maximum. It
 * exists for the file whose lines are long rather than for the ordinary file — the walker admits
 * files up to `MAX_FILE_BYTES` (1 MB) and the engine blanks lines over `MINIFIED_LINE_LIMIT` (5,000
 * characters) but the file on disk still has them.
 */
export const CONTEXT_MAX_BYTES_PER_LOCATION = 8192;

/**
 * The excerpt budget one PAYLOAD FILE is given, divided evenly over its locations.
 *
 * 128 KiB. It is a BUDGET AND NOT A CEILING, and the difference is the floor below: a payload's
 * per-location budget is this divided by its location count, then clamped between
 * `CONTEXT_MIN_BYTES_PER_LOCATION` and `CONTEXT_MAX_BYTES_PER_LOCATION`, so a payload holding many
 * locations ends up above this figure rather than below the floor. A payload holds at most
 * `MAX_LOCATIONS_PER_ADJUDICATION` (70) locations, so the worst case is 70 x 8 KiB = 560 KiB and the
 * ordinary large case is 70 x 3 kB = 210 kB.
 *
 * WHAT IT BUYS, measured on the largest tree read: it binds on payloads holding between about 16 and 44 locations,
 * and takes the largest payload's excerpt text from about 195 kB to 161 kB and the p99 from about
 * 119 kB to 116 kB, leaving the median (5 kB) untouched.
 */
export const CONTEXT_BYTES_PER_PAYLOAD_BUDGET = 131_072;

/**
 * The budget a location keeps however many locations share its payload — and the reason this unit
 * exists, expressed as a number.
 *
 * 3 kB, which is about 40 lines of ordinary source. **The figure the whole mechanism rests on is
 * "within 30 lines of the matched line"** — 40 of the 75 `not_applicable` verdicts of the 2026-09-02
 * run on tree A rest entirely on evidence that close — so a budget that cannot hold that much is a
 * window not worth writing, and the payload budget above yields to this rather than the other way
 * round.
 *
 * MEASURED, NOT CHOSEN BY FEEL. On one large tree's 14,143 locations, at a floor of 600 bytes the median
 * location was given a 57-line window and 3,242 locations were given under 41 lines; at 3 kB the
 * median is 77 lines and 1,522 are under 41, and those remaining are in files whose lines are long,
 * where the per-location cap and not this floor is what binds. Going on to 4 kB buys a median of 81
 * — the full window — for another 20 % on the largest payloads, which is the trade this stops short
 * of.
 */
export const CONTEXT_MIN_BYTES_PER_LOCATION = 3000;

/**
 * The most bytes a payload file holding MORE THAN ONE CANDIDATE may have. A bound on the file, not
 * on the excerpts — the three constants above shape the text, and this one divides the bin when the
 * shaped text is still too large.
 *
 * 400,000 B. `SKILL.md` step 4 hands the payload to a child BY PASTING IT INLINE, so a payload is a
 * prompt: at about 4 bytes per token this is about 100k tokens of one child's window spent before
 * it has read anything of its own. The figure is the definition of a correctness problem and
 * the recommendation — "a byte bound beside the unit bound in the packer;
 * a candidate that alone exceeds it keeps its own payload".
 *
 * WHY THE UNIT BOUND DOES NOT ALREADY DO THIS. A bin is bounded at 70 reading units, and a unit's
 * excerpt is clamped between the floor and the ceiling above — so a 70-unit bin opening 174
 * locations reaches about 570 kB while breaking no bound it was given. Measured on one large tree before
 * this cap: 58 payloads, median 234,185 B, maximum 572,215 B, ELEVEN at or over this figure.
 *
 * WHAT IT MAY NOT DO. It may not divide a candidate and may not shorten one: a candidate is one
 * seat (design annex §3.2), and a seat handed two thirds of its evidence returns a verdict about
 * two thirds of its evidence. A single candidate whose payload alone exceeds this is written whole
 * and RECORDED — `adjudication_group.payload_bytes`, `adjudication_group.oversized` and the index
 * row's `oversized` — because a cost that is announced can be priced and a cost that is silently
 * truncated cannot.
 */
/**
 * **220,000 BYTES SINCE THE FULL-READ FORM, which replaces the 400,000 above**:
 * a place seat holds at most 105 places,
 * 220,000 bytes of payload, three rules and one model, the sizes the seat-capacity and question-clarity measurements
 * ran their seats at. A bin over it is divided by whole candidates, as before. A single candidate's payload over it is
 * still written whole and recorded `oversized`, never cut and never left unread; spreading such a candidate over
 * place seats by bytes, and a place larger than a seat on its own, are the payload writer's (build unit F2, which
 * writes the windows per place and the Read ranges, design 1.2 and R15).
 */
export const CONTEXT_MAX_BYTES_PER_PAYLOAD = 220_000;

/** The import region's own ceilings, applied after the region has been found. */
export const CONTEXT_IMPORT_MAX_LINES = 40;
export const CONTEXT_IMPORT_MAX_BYTES = 4096;

/** How far into a file the first import line is looked for. */
export const CONTEXT_IMPORT_SEARCH_LINES = 400;

/** The most enclosing-construct opening lines one location carries. */
export const CONTEXT_MAX_ENCLOSING = 8;

/** The directory the payload files go in, relative to the directory `--out` names. */
export const CONTEXT_PAYLOAD_DIR = "payloads";

/**
 * The sub-shapes of one kind whose first line travels into the payload beside the representative.
 *
 * **Why they travel at all.** an internal record read the CMS's
 * twenty largest same-kind line groups and found three of them merging constructs an adjudicator
 * must see separately; its own recommendation (section 9, Q1) is "L2 for the question with the L1
 * sub-shapes carried as the evidence set". A kind handed over with one line would hide exactly the
 * distinction the reading rule turns on.
 *
 * **Why three and not all of them.** The payload has to stay something a seat can be handed: the
 * sub-shape count is unbounded and a kind of 16,000 members can carry hundreds. Three is the
 * largest three by member count, which is the direction the reading order already takes, and the
 * rest are COUNTED in the kind's row (`sub_shape_count`) rather than dropped in silence — a reader
 * of the payload can always see how many shapes are behind the ones it holds.
 */
export const CONTEXT_SUB_SHAPES_PER_KIND = SKELETON_SUB_SHAPES_LISTED;

/** What the excerpt is: the neighbourhood of a match, the file's import region, or one opening line. */
export type ContextExcerptKind = "window" | "imports" | "encloses";

export interface ContextExcerpt {
  /** `<file>:<start_line>-<end_line>` — what a location's `context` names to point here. */
  id: string;
  kind: ContextExcerptKind;
  file: string;
  start_line: number;
  end_line: number;
  /** The matched lines this excerpt was built for, ascending. Absent on an `imports` excerpt. */
  for_lines?: number[];
  /** The file's own lines, verbatim, joined with `\n`, with no line-number prefix. */
  text: string;
  /** Present when the byte budget stopped the window short of `--context-window` lines each side. */
  short_of_window?: boolean;
  /**
   * Present, and `true`, when THIS EXCERPT IS NOT THE FILE'S BYTES — because the file's bytes are not
   * valid UTF-8 and the bytes that are not decoded to U+FFFD.
   *
   * Added 2026-09-17 on independent verification. The file is read with
   * `readFileSync(..., "utf8")`, which never fails and never says it substituted: a Latin-1 or
   * Shift-JIS or UTF-16 file comes back as text with replacement characters in it, and the walker
   * admits such files DELIBERATELY (`walk.ts:218-223`). Everything else about the excerpt is still
   * true — the line numbers are right, because a replacement character is never a newline, and the
   * matched line was transcoded the same way the engine transcoded it, so nothing in layer 1
   * disagrees with itself. What is not true is the word "verbatim", and this repository has already
   * paid for that exact class once: `reconcile-verify.ts:1199-1210` records mojibake written into
   * `findings[].evidence[].quote`, a legal-evidence field, labelled `extracted-from-declared-range`
   * and then CONFIRMED against the same bytes at exit 0 — "a caught error turned into a silent
   * confirmation".
   *
   * **A CHILD READING AN EXCERPT CARRYING THIS MUST NOT QUOTE IT AS THE FILE'S BYTES.** The flag is
   * added rather than the file refused, because refusing would remove text an adjudicator can still
   * reason from, and subtraction is the only operation that can create a miss.
   */
  transcoded?: boolean;
}

/**
 * What one location was given. Every field names an excerpt of the SAME payload by its id, and
 * every id it names is present in that payload's `excerpts` array — a pointer with nothing behind it
 * would send a reading agent looking for text that is not there.
 *
 * `imports` and `encloses` are therefore absent where the window already carries those lines, which
 * is the ordinary case for a match near the top of a file: the excerpt was not written a second
 * time, so there is no second id to name. `locations[].also_opens_at` still carries every enclosing
 * opening line, whether or not an excerpt was written for it.
 */
export interface LocationContext {
  window: string;
  /**
   * The place's OWN window, `[first line, last line]`, inside the excerpt `window` names (full-read design 1.2: "each
   * place names its excerpt and its own window lines"). Written in the place form only (build unit F2).
   */
  window_lines?: [number, number];
  imports?: string;
  encloses?: string[];
}

/**
 * THE MOST BYTES ONE PLACE'S EXCERPT MAY HOLD AND STILL BE READ IN ONE READ RANGE, counted as the excerpt's text is
 * written in the seat's reading copy (each line JSON-escaped, `Buffer.byteLength(JSON.stringify(line))`, the two quotes
 * standing for the escaped line break). Full-read design 1.2 and 1.4: a place's window never straddles two Read ranges
 * unless it is itself larger than one. A Read range is `READ_RANGE_BYTES` (40,000) counting each line's bytes, its line
 * break and the Read's line-number prefix; the reading copy writes a long string in parts of at most 1,997 characters,
 * one part a line, inside an object of about six more lines (id, kind, file, lines, `for_lines`). 80 % of a range
 * leaves that room at any text: 32,000 bytes is at most 33 parts of 1,997 ASCII characters (297 bytes of line breaks
 * and prefixes) and the wrapper is under 2,500 bytes even with 105 places in `for_lines`.
 * Used twice, one rule: windows of one file are merged into one excerpt only while the merged excerpt stays within
 * this (so a merged excerpt never straddles two ranges), and a place whose own window alone is over this is LARGER
 * THAN ONE READ RANGE and gets a seat of its own (review R15).
 */
export const PLACE_EXCERPT_MAX_BYTES = Math.floor(READ_RANGE_BYTES * 0.8);

/** One line's bytes in the reading copy's escaped text (its quotes stand for the escaped line break). */
export function escapedLineBytes(line: string): number {
  return Buffer.byteLength(JSON.stringify(line), "utf8");
}

/**
 * The index and its rows are `wolfboy-schemas`' own types, imported rather than restated: they are
 * part of the findings document's contract, and a second declaration here is a forbidden second copy
 * forbids keeping.
 */
export type ContextPayloadRow = FindingsContextPayloadRow;
export type ContextPayloadsIndex = FindingsContextPayloads;

/**
 * Resolve `--context-window` against `PRODUCT_CLI_CONTEXT`.
 *
 * **A typed flag wins over the environment**, which is the opposite way round from
 * `--no-prefilter`/`PRODUCT_CLI_PREFILTER` — and deliberately so, because that flag has one
 * direction (it can only switch the filter off) while this one carries a number. A harness that
 * cannot edit an argument vector sets `PRODUCT_CLI_CONTEXT=0`; a person who then types
 * `--context-window 40` gets 40, and the provenance line this command prints names whichever of the
 * two decided.
 */
export class ContextWindowOptionError extends Error {}

export function resolveContextWindow(typed: string | undefined): number {
  if (typed !== undefined) {
    const n = Number(typed);
    if (!Number.isInteger(n) || n < 0) {
      throw new ContextWindowOptionError(
        `--context-window must be a whole number of lines, 0 or more (0 writes no payload files at all). Got "${typed}".`,
      );
    }
    return n;
  }
  if (process.env.PRODUCT_CLI_CONTEXT === "0") return 0;
  return DEFAULT_CONTEXT_WINDOW;
}

/**
 * The file's lines, without the terminator, and without the empty string a trailing newline leaves.
 *
 * `split("\n")` on a file ending in a newline yields a final `""` that is not a line of the file;
 * counting it would let `end_line` name a line no editor shows. CRLF is left alone: the `\r` is part
 * of the line's bytes and an excerpt is the file's bytes.
 */
export function fileLines(raw: string): string[] {
  const lines = raw.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Budget accounting: a line costs its own bytes plus the newline that joins it to the next. */
function lineCost(line: string): number {
  return Buffer.byteLength(line, "utf8") + 1;
}

/**
 * Grow a contiguous range outward from the matched span until the window or the budget stops it.
 *
 * Deterministic and hand-derivable: the matched span is always included whole, then one line is
 * taken from ABOVE, then one from BELOW, alternating, each accepted only if it fits the budget. A
 * side that cannot afford its next line is closed and the other side carries on, so a single long
 * line above the match does not cost the lines below it. Above first, because the first check of the
 * adjudicator's brief — trace the call path upward — is the read most often needed.
 *
 * The matched span itself is never shortened, whatever it costs: it is the one text the verdict
 * must quote, and trimming it is the "reading too little" failure.
 */
export function growWindow(
  lines: string[],
  startLine: number,
  endLine: number,
  windowLines: number,
  budget: number,
): { start: number; end: number; shortOfWindow: boolean } {
  const lastLine = lines.length;
  const coreStart = Math.max(1, Math.min(startLine, lastLine));
  const coreEnd = Math.max(coreStart, Math.min(endLine, lastLine));
  const lowLimit = Math.max(1, coreStart - windowLines);
  const highLimit = Math.min(lastLine, coreEnd + windowLines);

  let used = 0;
  for (let i = coreStart; i <= coreEnd; i++) used += lineCost(lines[i - 1]);

  let start = coreStart;
  let end = coreEnd;
  let aboveOpen = start > lowLimit;
  let belowOpen = end < highLimit;
  let above = true;
  while (aboveOpen || belowOpen) {
    if (above && aboveOpen) {
      const cost = lineCost(lines[start - 2]);
      if (used + cost <= budget) {
        used += cost;
        start--;
        aboveOpen = start > lowLimit;
      } else {
        aboveOpen = false;
      }
    } else if (!above && belowOpen) {
      const cost = lineCost(lines[end]);
      if (used + cost <= budget) {
        used += cost;
        end++;
        belowOpen = end < highLimit;
      } else {
        belowOpen = false;
      }
    }
    above = !above;
  }
  return { start, end, shortOfWindow: start > lowLimit || end < highLimit };
}

/**
 * A line that opens, continues or belongs to a file's import region.
 *
 * It is a reading aid and not a detector: a false positive costs a few extra verbatim lines in a
 * payload and a false negative costs the block, and neither changes what fires. The spellings cover
 * the languages this product's corpus is written in — `import`/`from` (JS, TS, Python, Java, Kotlin,
 * Swift, Go, Dart), `require` (CommonJS, Ruby), `use`/`using` (Rust, PHP, C#), `#include`/`#import`
 * (C, C++, Objective-C), `package` (Go, Java), `extern crate` (Rust), `open` (OCaml, F#),
 * `@import`/`@use` (CSS, SCSS), `load(` (Starlark) — and `"use strict"` is not one of them, because
 * the quote is part of that line and not of any of these.
 */
const IMPORT_LINE =
  /^\s*(?:import\b|from\s+\S+\s+import\b|from\s+["'`]|export\s+(?:\*|\{[^}]*\})\s+from\b|package\b|extern\s+crate\b|use\b|using\b|open\b|#\s*(?:include|import)\b|@(?:import|use)\b|load\s*\(|(?:const|let|var)\s+[\w${},[\]\s*]+=\s*require\s*\(|require(?:_relative|_once)?\s*[("'`]|include(?:_once)?\s*[("'`])/;

/** A blank line, or a line that is only a comment in one of the syntaxes the corpus uses. */
const IMPORT_FILLER = /^\s*(?:$|\/\/|\/\*|\*|#(?!\s*(?:include|import)\b)|--|;;|<!--)/;

/**
 * The file's first contiguous import region, as a line range, or `null` where there is none.
 *
 * The region opens on the first import line in the file's first
 * `CONTEXT_IMPORT_SEARCH_LINES` lines and runs while the following lines are import lines, filler
 * (blank or comment), or continuations of a bracket that an earlier line of the region left open —
 * which is what keeps a multi-line `import { a, b, c } from "x"` whole. It closes on the last
 * import line, so trailing blanks and comments are not carried.
 */
export function importRegion(lines: string[]): { start: number; end: number } | null {
  const searchTo = Math.min(lines.length, CONTEXT_IMPORT_SEARCH_LINES);
  let start = 0;
  for (let i = 1; i <= searchTo; i++) {
    if (IMPORT_LINE.test(lines[i - 1])) {
      start = i;
      break;
    }
  }
  if (start === 0) return null;

  let last = start;
  let depth = bracketDelta(lines[start - 1]);
  for (let i = start + 1; i <= lines.length; i++) {
    const line = lines[i - 1];
    const continued = depth > 0;
    if (!continued && !IMPORT_LINE.test(line) && !IMPORT_FILLER.test(line)) break;
    depth = Math.max(0, depth + bracketDelta(line));
    if (continued || IMPORT_LINE.test(line)) last = i;
    if (last - start + 1 >= CONTEXT_IMPORT_MAX_LINES) break;
  }

  let end = Math.min(last, start + CONTEXT_IMPORT_MAX_LINES - 1);
  let used = 0;
  for (let i = start; i <= end; i++) {
    used += lineCost(lines[i - 1]);
    if (used > CONTEXT_IMPORT_MAX_BYTES && i > start) {
      end = i - 1;
      break;
    }
  }
  return { start, end };
}

/** Net opening brackets on a line, used only to keep a multi-line import whole. */
function bracketDelta(line: string): number {
  let d = 0;
  for (const ch of line) {
    if (ch === "{" || ch === "(" || ch === "[") d++;
    else if (ch === "}" || ch === ")" || ch === "]") d--;
  }
  return d;
}

/**
 * The opening lines of the enclosing constructs the structural reading knows about, for one location.
 *
 * READ OFF THE LOCATION AND NEVER INFERRED. `also_opens_at` is what `collapseNestedDuplicates`
 * recorded when it folded an enclosing candidate into this one, and `joined_from.start_line` is the
 * line the folded construct opens on. Nothing here scans upward for a `function` or a `class`: a
 * structural fact this scan did not establish is not one a regular expression may establish here.
 */
function enclosingLines(loc: FindingLocation): number[] {
  const seen = new Set<number>();
  for (const line of loc.also_opens_at ?? []) seen.add(line);
  if (loc.joined_from) seen.add(loc.joined_from.start_line);
  seen.delete(loc.start_line);
  return [...seen].sort((a, b) => a - b).slice(0, CONTEXT_MAX_ENCLOSING);
}

const excerptId = (file: string, start: number, end: number): string => `${file}:${start}-${end}`;

/*
 * THE PIECES OF ONE PAYLOAD'S CONTEXT THAT DO NOT DEPEND ON THE PAYLOAD. A payload's excerpts are a
 * function of the places it holds, but four of the things `buildPayloadContext` works out on the way are functions
 * of something smaller: whether a file's text can be quoted (`readableLines`), the place facts of a file
 * (`placeFactsOf`), a file's import block (`importRegionOf`) and the byte budget each window grows to, which depends
 * on nothing but how many windowed places the payload holds (`perLocationBudget`). Before this change the first three were
 * worked out again for every payload that held a place of the file, so a file with many places cost its whole
 * length once per payload - and the number of payloads grows with the number of places, so the writing grew with
 * the square of the input. They are worked out once per file now, and the seat cutter
 * (`cutPlaceSeats`) asks the same four functions, so there is one definition of each.
 */

/** A file's lines can be quoted: read, and not empty (an empty file is treated as unreadable, see below). */
const readableLines = (lines: string[] | null): lines is string[] =>
  !(lines === null || lines.length === 0 || (lines.length === 1 && lines[0] === ""));

/** The byte budget each window grows to in a payload that windows `windowed` places. */
function perLocationBudget(windowed: number): number {
  return Math.max(
    CONTEXT_MIN_BYTES_PER_LOCATION,
    Math.min(CONTEXT_MAX_BYTES_PER_LOCATION, Math.floor(CONTEXT_BYTES_PER_PAYLOAD_BUDGET / Math.max(1, windowed))),
  );
}

/** The bytes lines `from`..`to` (1-based, inclusive) take in a payload. */
function excerptBytes(lines: string[], from: number, to: number): number {
  let n = 0;
  for (let i = from; i <= to; i++) n += escapedLineBytes(lines[i - 1]);
  return n;
}

/** A place's own window under `budget`. */
const windowOfPlace = (lines: string[], loc: FindingLocation, windowLines: number, budget: number) =>
  growWindow(lines, loc.start_line, loc.end_line ?? loc.start_line, windowLines, budget);

/** Keyed by the lines array a reader hands out once per file, so the memo lives exactly as long as that text. */
const FACTS_BY_LINES = new WeakMap<string[], Map<string, (startLine: number, endLine: number) => PlaceFact | null>>();
const IMPORTS_BY_LINES = new WeakMap<string[], { start: number; end: number } | null>();

/** `placeFactsFor`, once per file text: it parses the whole file (a catalogue, a document's prose positions). */
function placeFactsOf(file: string, lines: string[], transcoded: boolean): (startLine: number, endLine: number) => PlaceFact | null {
  let byFile = FACTS_BY_LINES.get(lines);
  if (!byFile) FACTS_BY_LINES.set(lines, (byFile = new Map()));
  const key = `${transcoded ? "t" : "u"}${file}`;
  let factOf = byFile.get(key);
  if (!factOf) byFile.set(key, (factOf = placeFactsFor(file, lines, transcoded)));
  return factOf;
}

/** `importRegion`, once per file text: its scan after the first import runs as long as filler lines do. */
function importRegionOf(lines: string[]): { start: number; end: number } | null {
  if (!IMPORTS_BY_LINES.has(lines)) IMPORTS_BY_LINES.set(lines, importRegion(lines));
  return IMPORTS_BY_LINES.get(lines) ?? null;
}

/**
 * The excerpts and the per-location pointers for ONE payload, from the files it names.
 *
 * Exported for a test, which builds a payload out of a planted tree and
 * compares every excerpt against its own independent read of the file.
 */
export function buildPayloadContext(
  candidates: Candidate[],
  readLines: (file: string) => string[] | null,
  windowLines: number,
  /**
   * Whether the file's bytes round-trip through UTF-8. ONE COMPARISON PER FILE, not
   * per excerpt, and the caller owns it because the caller is the one holding the raw bytes.
   * Omitted by a caller that cannot answer, which is read as "no reason to think otherwise" and is
   * what every existing caller gets.
   */
  isTranscoded: (file: string) => boolean = () => false,
  /**
   * THE PLACE FORM (full-read design 1.2-1.3; build unit F2). Off: the excerpts and pointers this function wrote before
   * the full-read form, byte for byte (the `--kind-census off` control arm). On: (1) a place whose line passes the
   * program's own test (`place-facts.ts`) is given as a FACT and gets no window; (2) the per-place byte budget is divided
   * over the WINDOWED places only, so a window is never smaller than it would have been with the facts windowed too;
   * (3) windows of one file are merged only while the merged excerpt stays within `PLACE_EXCERPT_MAX_BYTES`, so no
   * excerpt straddles two Read ranges - an overlap that would pass it starts a new excerpt, repeating the shared lines
   * rather than cutting either window; (4) each place names its own window lines; (5) a place whose own window alone is
   * over `PLACE_EXCERPT_MAX_BYTES` is returned in `largerThanRange`, for the writer to give a seat of its own (R15).
   */
  placeForm = false,
): {
  excerpts: ContextExcerpt[];
  contexts: Map<FindingLocation, LocationContext>;
  unreadable: string[];
  facts: Map<FindingLocation, PlaceFact>;
  largerThanRange: FindingLocation[];
} {
  // Every location this payload holds, gathered by file so each file is read once and the windows
  // of one file can be merged before any text is copied.
  const byFile = new Map<string, FindingLocation[]>();
  for (const c of candidates) {
    for (const loc of c.locations) {
      const list = byFile.get(loc.file);
      if (list) list.push(loc);
      else byFile.set(loc.file, [loc]);
    }
  }
  const readable = readableLines;

  // THE FACTS FIRST (place form only), because the window budget is divided over the places that are windowed.
  const facts = new Map<FindingLocation, PlaceFact>();
  if (placeForm) {
    for (const [file, locs] of byFile) {
      const lines = readLines(file);
      if (!readable(lines)) continue;
      const factOf = placeFactsOf(file, lines, isTranscoded(file));
      for (const loc of locs) {
        const fact = factOf(loc.start_line, loc.end_line ?? loc.start_line);
        if (fact) facts.set(loc, fact);
      }
    }
  }
  const locationCount = candidates.reduce((n, c) => n + c.locations.length, 0) - facts.size;
  const budget = perLocationBudget(locationCount);

  const excerpts: ContextExcerpt[] = [];
  /** The ids in `excerpts`, so the "already written?" test below is one lookup and not a pass over every excerpt. */
  const excerptIds = new Set<string>();
  const contexts = new Map<FindingLocation, LocationContext>();
  const unreadable: string[] = [];
  const largerThanRange: FindingLocation[] = [];

  for (const file of [...byFile.keys()].sort()) {
    const lines = readLines(file);
    // An empty file is treated as unreadable rather than as one empty line: a location in it has no
    // text to quote, and an excerpt claiming "line 1" over zero bytes is a record a reader cannot
    // check. Nothing today can reach it — a match needs a line with text in it — and it is closed
    // here rather than left for the one rule that finds a way.
    if (!readable(lines)) {
      unreadable.push(file);
      continue;
    }
    // ONE COMPARISON PER FILE: if the file's bytes do not round-trip through UTF-8,
    // every excerpt taken from it is a transcription and says so. The three construction sites below
    // spread `transcode` rather than each asking again.
    const transcode = isTranscoded(file) ? { transcoded: true as const } : {};
    // The places of this file that are WINDOWED: every one of them outside the place form, and those without a fact in
    // it. A file whose places are all facts writes no excerpt at all.
    const locs = byFile
      .get(file)!
      .filter((loc) => !facts.has(loc))
      .sort((a, b) => a.start_line - b.start_line);
    if (locs.length === 0) continue;
    const costOf = (from: number, to: number): number => excerptBytes(lines, from, to);

    // Each location's own range first, then the ranges merged so overlapping neighbourhoods are one
    // excerpt carrying the text once. `short_of_window` is a union: a merged range is short of the
    // window if any of the ranges it absorbed was.
    // SORTED BY WHERE THE GROWN RANGE ACTUALLY STARTS, not by the matched line. The merge below
    // compares each range with the last one only, which is correct exactly when the list ascends by
    // `start` — and `start` is NOT guaranteed to ascend with `start_line`, because two locations in
    // one file can pay different amounts for the lines above them. Sorting here is what makes the
    // merged ranges disjoint by construction rather than by the ordinary case holding.
    const ranges = locs
      .map((loc) => {
        const grown = windowOfPlace(lines, loc, windowLines, budget);
        return { ...grown, line: Math.max(1, Math.min(loc.start_line, lines.length)), loc };
      })
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: { start: number; end: number; shortOfWindow: boolean; lines: number[]; locs: FindingLocation[]; bytes: number }[] = [];
    const own = new Map<FindingLocation, { start: number; end: number; block: number }>();
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      let join = last !== undefined && r.start <= last.end + 1;
      // THE PLACE FORM'S ONE CHANGE TO THE MERGE: an excerpt grows only while it stays within one Read range.
      if (join && placeForm && r.end > last.end) join = last.bytes + costOf(last.end + 1, r.end) <= PLACE_EXCERPT_MAX_BYTES;
      if (join) {
        if (placeForm && r.end > last.end) last.bytes += costOf(last.end + 1, r.end);
        last.end = Math.max(last.end, r.end);
        last.shortOfWindow = last.shortOfWindow || r.shortOfWindow;
        last.lines.push(r.line);
        last.locs.push(r.loc);
      } else {
        merged.push({ start: r.start, end: r.end, shortOfWindow: r.shortOfWindow, lines: [r.line], locs: [r.loc], bytes: placeForm ? costOf(r.start, r.end) : 0 });
      }
      if (placeForm) {
        own.set(r.loc, { start: r.start, end: r.end, block: merged.length - 1 });
        if (costOf(r.start, r.end) > PLACE_EXCERPT_MAX_BYTES) largerThanRange.push(r.loc);
      }
    }
    const windowIdOf = (line: number): string => {
      const hit = merged.find((m) => line >= m.start && line <= m.end) ?? merged[0];
      return excerptId(file, hit.start, hit.end);
    };
    for (const m of merged) {
      excerptIds.add(excerptId(file, m.start, m.end));
      excerpts.push({
        id: excerptId(file, m.start, m.end),
        kind: "window",
        file,
        start_line: m.start,
        end_line: m.end,
        for_lines: [...new Set(m.lines)].sort((a, b) => a - b),
        text: lines.slice(m.start - 1, m.end).join("\n"),
        ...(m.shortOfWindow ? { short_of_window: true as const } : {}),
        ...transcode,
      });
    }

    // The import region, written once per file, and only where the windows above do not already
    // carry it — a payload that repeats fourteen lines it has already quoted is paying twice for a
    // reading the child already has.
    const region = importRegionOf(lines);
    let importsId: string | undefined;
    if (region && !merged.some((m) => region.start >= m.start && region.end <= m.end)) {
      importsId = excerptId(file, region.start, region.end);
      excerptIds.add(importsId);
      excerpts.push({
        id: importsId,
        kind: "imports",
        file,
        start_line: region.start,
        end_line: region.end,
        text: lines.slice(region.start - 1, region.end).join("\n"),
        ...transcode,
      });
    }

    // "Is this line inside a window excerpt?" in one binary search: the blocks are in order of their first line (the
    // ranges were sorted so), and in the place form two of them can overlap, so the test is against the largest last
    // line among the blocks that start at or before the line - the same answer as asking every block.
    const blockStarts = merged.map((m) => m.start);
    const reachBefore: number[] = [];
    for (const m of merged) reachBefore.push(Math.max(m.end, reachBefore.length > 0 ? reachBefore[reachBefore.length - 1] : -Infinity));
    const inMerged = (line: number): boolean => {
      let lo = 0;
      let hi = blockStarts.length - 1;
      let at = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (blockStarts[mid] <= line) {
          at = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      return at >= 0 && reachBefore[at] >= line;
    };

    for (const loc of locs) {
      // The place form names the excerpt that absorbed THIS place's own window (with excerpts that overlap, the first
      // excerpt holding the matched line need not hold the whole window); outside it, the first holding the line.
      const mine = own.get(loc);
      const context: LocationContext = mine
        ? { window: excerptId(file, merged[mine.block].start, merged[mine.block].end), window_lines: [mine.start, mine.end] }
        : { window: windowIdOf(Math.max(1, Math.min(loc.start_line, lines.length))) };
      if (importsId) context.imports = importsId;
      const opens = enclosingLines(loc).filter((line) => line >= 1 && line <= lines.length);
      const ids: string[] = [];
      for (const line of opens) {
        if (inMerged(line)) continue;
        const id = excerptId(file, line, line);
        if (!excerptIds.has(id)) {
          excerptIds.add(id);
          excerpts.push({
            id,
            kind: "encloses",
            file,
            start_line: line,
            end_line: line,
            for_lines: [loc.start_line],
            text: lines[line - 1],
            ...transcode,
          });
        }
        ids.push(id);
      }
      if (ids.length > 0) context.encloses = ids;
      contexts.set(loc, context);
    }
  }
  return { excerpts, contexts, unreadable, facts, largerThanRange };
}

/**
 * A payload file's name: readable, deterministic and collision-free whatever the key is.
 *
 * KEYED ON THE FIELD AND NOT ON A PATH. `adjudication_group.key` is the file of the candidate's
 * first location today, with `#batch-<n>` where one file's candidates were divided; unit A of this
 * lane may make it a bin key instead. Nothing here reads it as a path — it is slugged and hashed —
 * so a key of any shape produces a name, and `findings.json`'s index is what a consumer resolves.
 */
export function payloadFileName(key: string): string {
  const slug = key.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(-72) || "group";
  return `${slug}-${createHash("sha256").update(key).digest("hex").slice(0, 10)}.json`;
}

/**
 * The fields a payload withholds from the candidate record, and the one place they are named.
 *
 * `SKILL.md` step 4 has said since 2026-07-27 that the detector's own opinion is not passed to the
 * adjudicator — *"if you want an independent second opinion, do not tell the adjudicator the first
 * opinion's confidence"*. The payload is what the orchestrator now pastes, so the withholding is
 * done here, once, rather than left to a field list an orchestrator maintains by hand.
 */
const WITHHELD_FROM_PAYLOAD = ["severity", "rule_confidence"] as const;

/**
 * The `adjudication_group` fields a payload withholds, and why withholding them is not optional.
 *
 * `payload_bytes` is the size of the payload file AS WRITTEN. The group marker travels inside that
 * same file — once in the payload's header and once on every candidate record — so writing the size
 * into the group would change the size, and no fixed point exists that a reader could check against
 * the file on disk. The two fields are therefore recorded in `findings.json` and in the index row,
 * where a reader can act on them, and are absent from the payload, where they could only be wrong.
 * `oversized` goes with it because it is the same statement in a different form.
 */
const WITHHELD_FROM_PAYLOAD_GROUP = ["payload_bytes", "oversized"] as const;

/** The group marker as a payload carries it: everything the document holds but the two fields above. */
function groupForPayload(group: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...group };
  for (const field of WITHHELD_FROM_PAYLOAD_GROUP) delete copy[field];
  return copy;
}

/**
 * The fields that belong to the RULE rather than to the candidate, lifted out of the candidate
 * records and written ONCE per rule id per payload (`rules` below). Unit P(a) of the layer-2 cost
 * lane.
 *
 * ## Why, in numbers
 *
 * Unit A packs whole candidates into bins of up to 70 locations and up to 3 rules, so one payload
 * routinely holds many candidates of ONE rule — and every one of them carried its own copy of that
 * rule's prose. Measured on the three prepared trees at the lane's integration: rule prose was 74.5 % of
 * every payload byte on one tree, 61.1 % on a second and 41.6 % on a third, and the third's
 * largest payload reached 1,325,971 B — about 331k tokens, which no child can be handed at all,
 * SKILL.md step 4 having the orchestrator paste the payload inline.
 *
 * ## Why these eight and not others
 *
 * They are the fields `Candidate` copies out of `Rule`, and the integration measured rather than
 * assumed it: **0 of 5,136 same-rule field pairs differ across the three trees**. A field that
 * varies between two candidates of one rule is a field of the candidate and does not belong here.
 *
 * ## THIS IS DE-DUPLICATION AND NOTHING ELSE
 *
 * Nothing is dropped, shortened or summarised. Every value a child was handed before is in the
 * payload, once, under the rule id the candidate already names in its own `rule_id`. A candidate
 * that did not carry one of these fields produces no key for it — an absent field stays absent
 * rather than becoming `null`, so expanding a payload back gives the record byte for byte.
 *
 * EXPORTED FOR a test ONLY, and nothing in the product imports it. The gate
 * compares each block against the BUNDLE's own rule rather than against this list, so sharing the
 * list is not a gate reading its expectation out of the thing under test — the expectation is the
 * bundle. It is shared rather than restated because this project keeps no second copy, and
 * because a restated list that fell behind this one would quietly stop checking a field. The one
 * thing sharing it cannot catch — a field REMOVED from this list, which reverts that field to being
 * written per candidate — the gate catches from the data instead: see its `RULE_OWNED_IN_PAYLOAD`
 * coverage check.
 */
/**
 * What an own-name seat's rule blocks leave out: the rule's context questions (the seat is
 * asked `own_name.question` in their place) and its evidence and remediation templates (the answer seat words the
 * finding and still carries them). Every other field, the facts the place premises read among them, stays.
 */
export const OWN_NAME_SLIMMED: readonly string[] = ["context_questions", "evidence_template", "remediation_template"];
export const RULE_OWNED_IN_PAYLOAD = [
  "title",
  "evidence_template",
  "remediation_template",
  "context_questions",
  "legal_basis_refs",
  "data_categories",
  "effective_date",
  "depends_on_applicability",
  // The rule's declared reading class (design section 10.6): which unit the rule is read in, what
  // its items are, and where the item list comes from. It is the RULE's field like the eight above
  // — every candidate of one rule carries the same value — so it is lifted here and written once per
  // rule id, in THIS ONE PLACE: a test imports this list and checks each
  // block against the bundle's own rule, so a second list would be a forbidden second copy.
  //
  // **Absent stays absent, and what holds that is the census gate, not the absence of declaring
  // rules.** 55 of the 117 rules declare a class at HEAD, and `collectRuleProse` tests `in` rather
  // than truthiness, so a rule block carries the key only where the candidate carried the field. The
  // field reaches a candidate in one place only — the copy in `scan.ts`, written when the kind
  // census is ON and the rule declares one, and not otherwise — so a `--kind-census off` document
  // carries no key for it anywhere and is byte-for-byte the document written before this line. Before
  // that condition was on the copy, the off arm's documents differed from the pinned trees by exactly
  // this field (integration, 2026-09-21). A test proves both directions on
  // a planted rule.
  "reading_class",
  // The rule's role, where the
  // rule declares one (scan.ts copies it only then; absent is `duty_check`): the brief the adjudicator's rule 6c reads.
  "finding_role",
  // What the rule's duty is
  // about, where the rule declares it (scan.ts copies it only then; absent declares nothing): the seat reads that whether a
  // file ships decides the count only where it is `product_runtime`.
  "duty_about",
] as const;

/**
 * One rule's prose block, as a payload carries it: the rule id the candidates name, and exactly
 * those of `RULE_OWNED_IN_PAYLOAD` the candidates of that rule actually carried.
 *
 * AN ARRAY AND NOT AN OBJECT KEYED BY RULE ID, deliberately. "Exactly one block per rule id" is then
 * a property of the file that can be stated, checked and made to fail — a test
 * plants a duplicated block and requires the gate to go red on it — where a JSON object would make
 * the duplicate unrepresentable in the parse and therefore unassertable.
 */
export interface PayloadRuleProse {
  rule_id: string;
  [field: string]: unknown;
}

/**
 * The rule prose blocks of one payload, in ASCENDING RULE ID ORDER — a total order over the ids that
 * does not depend on which candidate happened to come first, so two runs of one tree write the same
 * bytes whatever the document's candidate order.
 *
 * The first candidate of each rule id is the one read. That is not an arbitrary choice between
 * disagreeing copies: the control above says there are no disagreeing copies, and
 * a test asserts on every payload it builds that no candidate still carries
 * a field of its own.
 */
function collectRuleProse(candidates: Candidate[]): PayloadRuleProse[] {
  const first = new Map<string, Candidate>();
  for (const c of candidates) if (!first.has(c.rule_id)) first.set(c.rule_id, c);
  return [...first.keys()]
    .sort()
    .map((ruleId) => {
      const c = first.get(ruleId)! as unknown as Record<string, unknown>;
      const block: PayloadRuleProse = { rule_id: ruleId };
      // `in` and not a truthiness test: a field the candidate does not carry must not appear here,
      // and a field it carries as an empty array or an empty string must.
      for (const field of RULE_OWNED_IN_PAYLOAD) if (field in c) block[field] = c[field];
      return block;
    });
}

/**
 * Write one payload file per adjudication group and return the index `findings.json` carries.
 *
 * `outPath` is the findings document; the payloads go in `CONTEXT_PAYLOAD_DIR` beside it, so a
 * default run writes them under the user's own `.legal/`. **Nothing leaves the machine.**
 *
 * IDENTICAL ON EVERY PATH BY CONSTRUCTION. This runs on the main thread, after the single-thread and
 * the worker-pool paths have converged on one `Findings` object, and reads the files itself. There
 * is no second implementation for `--jobs` to disagree with, and no excerpt crosses a thread
 * boundary.
 *
 * BOUNDED IN MEMORY. One group at a time, and inside a group one file at a time: the largest thing
 * held is one file's lines plus one payload's text, never the tree and never the document's worth of
 * excerpts.
 */
/**
 * THE PAYLOAD MARKER: the exact sentence this writer puts in every payload it writes, and the only
 * thing `removeStalePayloads` will delete a file on the strength of. It is a literal here and a
 * literal there — one constant, read twice — so a change to the sentence cannot leave the sweep
 * matching a spelling the writer no longer produces.
 */
const PAYLOAD_PRODUCED_BY = "layer 1 of this scanner, deterministically, with no model call";

/**
 * Remove the payload files a PREVIOUS run of this scanner wrote into this directory and this run is
 * not about to overwrite.
 *
 * ## The defect
 *
 * One tree scanned into one `--out` writes 16 payload files; the same `--out` scanned
 * again with `--rules baseline-002` writes 3 and LEAVES 13 ON DISK, each holding verbatim source of
 * a tree state the user has moved past — or of another tree entirely, if one `--out` was reused for
 * two targets. Five of the sixteen names on that tree begin with a dot, because the slug keeps a
 * leading `.` from the key, so a plain `ls` does not show them either.
 *
 * ## HOW IT KNOWS IT WROTE THE FILE — a name pattern AND a marker inside the file
 *
 * The verification offered two mechanisms and left the choice here: the previous document's
 * `context_payloads` index, or a name pattern plus a marker. **The index is not used**, because it
 * is the weaker of the two: a run whose document was moved, renamed, hand-edited or never written
 * (the scan died) leaves payload files with no index to find them by, which is the case the defect
 * actually produces. A file is removed only when ALL of these hold:
 *
 *   1. it is a regular file directly in the payload directory — never a subdirectory, and the sweep
 *      does not recurse;
 *   2. its name has the shape `payloadFileName` makes: a slug, a hyphen, ten lowercase hex, `.json`;
 *   3. it parses as JSON and carries `payload_version: 1`, `holds_source_excerpts: true` and
 *      `context.produced_by` equal to `PAYLOAD_PRODUCED_BY` **exactly**;
 *   4. this run is not about to write a file of that name anyway.
 *
 * Anything that fails any one of those is left alone, and every failure mode is a no-op: an
 * unreadable file, a file that is not JSON, a file somebody else put here, a directory. **Nothing is
 * deleted that this writer cannot prove it wrote**, which is the bound the verification set, and the
 * proof is the marker rather than the name — a name is a guess, a sentence this module is the only
 * producer of is not.
 *
 * It is not reported in the document. The count is printed by the caller with the rest of the
 * provenance line, so a user who wants to know what the scan removed is told, and adding a key to
 * `context_payloads` for it would change the document's shape for something that is not a finding.
 */
function removeStalePayloads(dir: string, willWrite: Set<string>): number {
  let removed = 0;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (willWrite.has(name)) continue;
    if (!/-[0-9a-f]{10}\.json$/.test(name)) continue;
    const full = join(dir, name);
    try {
      if (!statSync(full).isFile()) continue;
      const doc = JSON.parse(readRegularFile(full, "utf8")) as Record<string, unknown>;
      if (doc.payload_version !== 1) continue;
      if (doc.holds_source_excerpts !== true) continue;
      const ctx = doc.context as Record<string, unknown> | undefined;
      if (!ctx || ctx.produced_by !== PAYLOAD_PRODUCED_BY) continue;
      removePath(full);
      removed++;
    } catch {
      // Unreadable, not JSON, or removed under us. Leave it: the only safe default here is to do
      // nothing to a file in the user's own directory.
      continue;
    }
  }
  return removed;
}

/**
 * One kind as a payload carries its ROW — the deterministic facts about the group, beside the
 * excerpt of the line that stands for it.
 *
 * The members themselves are NOT all here and never are: a kind of 54,770 members is 54,770 rows in
 * `findings.json` under `kinds[].members`, and a payload that repeated them would be the unreadable
 * thing the whole design exists to remove. What the seat holds is the row, the representative's
 * neighbourhood, and the first line of the largest sub-shapes; the row is the
 * skeleton unit (`reading.ts` `skeletonOf`), which also lists the first `SKELETON_MEMBERS_LISTED`
 * members by id, so the seat can record each member it opens without typing its location.
 */
export type PayloadKindRow = SkeletonUnit;

/**
 * The lines one payload opens for a candidate read by kinds: each handed kind's representative, and
 * the first line of each of its largest sub-shapes.
 *
 * **This is the subtraction that is not one.** Nothing is removed from the document: every location
 * stays in `findings.json` and every location is a member of exactly one kind, which gets a row.
 * What changes is which lines get an EXCERPT — 202 representatives instead of 58,712 windows for
 * one tree's `recipients-003` — and the trail (`reading`) is what says, afterwards, which of those
 * locations was opened, which was settled by its representative and which nobody read.
 */
function handedLocations(kinds: ReadingKind[]): FindingLocation[] {
  const out: FindingLocation[] = [];
  const seen = new Set<string>();
  for (const kind of kinds) {
    for (const loc of [kind.representative, ...sortedSubShapes(kind).slice(0, SKELETON_SUB_SHAPES_LISTED).map((s) => s.first)]) {
      const id = `${loc.file}\u0000${loc.start_line}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(loc);
    }
  }
  return out;
}

/** What a payload in the place form says its location rows are (`context.places_are`). */
export const PLACES_ARE =
  "Every row of a candidate's `locations` is one PLACE. `place` is its id, P<n>, n its position in the candidate's `locations` in the findings document. `given` says what this payload gives it: `window` - `context.window` names the excerpt holding its whole window and `context.window_lines` the window's own first and last line; `fact` - `fact.text` is the matched line itself, `fact.kind` what the program verified the line to be and `fact.evidence` the test it passed on that line (a fact place has no window: open the file where the line is not enough); `unreadable` - its file could not be read, so it has neither. Every place of a candidate is in exactly one payload.";

/**
 * Bytes a trial payload keeps free under `CONTEXT_MAX_BYTES_PER_PAYLOAD` when a place seat is cut by bytes. What
 * differs between the trial and the payload written is the job key (absent from the text where the candidate carries
 * its group marker) and the `readers` count on that marker: a few bytes. 4,096 is far above both.
 */
export const PLACE_SEAT_TRIAL_MARGIN = 4096;

/** A slice of a place plan as the writer cuts it: a seat's first and last place, and whether it is over the bound. */
interface PlaceSlice {
  from: number;
  to: number;
  oversized?: true;
  /** A summary seat (build unit F6): the slice holds exactly the places this summary covers, and nothing else. */
  summary?: string;
  /** An own-name seat: every place it holds names only the entry the person declared. */
  own_name?: string;
}

/**
 * GIVE THE PRODUCT'S OWN NAME SEATS OF ITS OWN. Where the person declared the code to be an entry's software (own-name.ts), the places of the candidate's place
 * seats that name only that entry, on a line naming no host or URL under its name (`isOwn`), are moved, in the plan's
 * `order` only, after the other places and before any summary's, and cut into place seats of their own
 * (`reader_slices[].own_name`), at most `cap` places and closed at file boundaries as every place seat is; the other
 * places keep their order and are cut as before. Nothing is dropped: every place is in exactly one seat, and an own-name
 * seat is read like every place seat, with the answer and one question in place of the rule's context questions.
 */
function arrangeOwnNameSeats(source: Candidate, isOwn: (loc: FindingLocation) => boolean, entry: string): void {
  const plan = source.reading_plan as unknown as { order?: number[]; cap?: number; reader_slices: (PlaceSlice & { reader: number })[]; read_by_seat: number } | undefined;
  if (!plan || !Array.isArray(plan.reader_slices)) return;
  const locs = source.locations;
  const order = Array.isArray(plan.order) && plan.order.length === locs.length ? plan.order : locs.map((_, i) => i);
  const slices = plan.reader_slices.length > 0 ? [...plan.reader_slices].sort((a, b) => a.reader - b.reader) : [{ reader: 1, from: 0, to: locs.length - 1 }];
  const summaries = slices.filter((sl) => sl.summary);
  const restEnd = summaries.length > 0 ? Math.min(...summaries.map((sl) => sl.from)) : order.length;
  const rest = order.slice(0, restEnd);
  const own = rest.filter((i) => isOwn(locs[i]!));
  if (own.length === 0) return;
  const full = rest.filter((i) => !isOwn(locs[i]!));
  const cap = typeof plan.cap === "number" && plan.cap > 0 ? plan.cap : MAX_PLACES_PER_SEAT;
  const cut = (idx: number[], base: number): PlaceSlice[] =>
    idx.length === 0 ? [] : idx.length > cap ? cutIntoPlaceSeats(idx.length, cap, idx.map((i) => locs[i]!.file)).map((r) => ({ from: base + r.from, to: base + r.to })) : [{ from: base, to: base + idx.length - 1 }];
  const ownSlices = cut(own, full.length).map((sl) => ({ ...sl, own_name: entry }));
  plan.order = [...full, ...own, ...order.slice(restEnd)];
  plan.reader_slices = [...cut(full, 0), ...ownSlices, ...summaries.map((sl) => ({ from: sl.from, to: sl.to, summary: sl.summary }))].map((sl, i) => ({ reader: i + 1, ...sl }));
  plan.read_by_seat = 0;
}

/**
 * GIVE EACH DATA SUMMARY A SEAT OF ITS OWN (full-read design section 2; build unit F6). The places a summary covers are
 * moved, in the plan's `order` only, to the end - every summary's places consecutive - and each summary gets one place
 * seat (`reader_slices[].summary`) holding exactly its places; the other places keep their order and are cut into place
 * seats as F1 cut them (at most `cap` places, closed at file boundaries), which `cutPlaceSeats` then cuts by bytes.
 * `locations` and the place ids (`P<n>`, n the position in `locations`) do not change; every place is in exactly one
 * seat. A summary seat is exempt from the place bound: its seat answers the summary with one row, and the summary is at
 * most `SUMMARY_MAX_BYTES`.
 */
function arrangeSummarySeats(source: Candidate, sp: SummaryPlan | null): void {
  if (!sp || sp.summaries.length === 0) return;
  const plan = source.reading_plan as unknown as { order?: number[]; cap?: number; reader_slices: (PlaceSlice & { reader: number })[]; read_by_seat: number };
  const locs = source.locations;
  const indexOf = new Map(locs.map((l, i) => [l, i]));
  const order = Array.isArray(plan.order) && plan.order.length === locs.length ? plan.order : locs.map((_, i) => i);
  const groups = sp.summaries.map((e) => e.locations.map((l) => indexOf.get(l)).filter((i): i is number => i !== undefined).sort((a, b) => a - b));
  const covered = new Set(groups.flat());
  const rest = order.filter((i) => !covered.has(i));
  const cap = typeof plan.cap === "number" && plan.cap > 0 ? plan.cap : MAX_PLACES_PER_SEAT;
  const restSlices: PlaceSlice[] =
    rest.length > cap ? cutIntoPlaceSeats(rest.length, cap, rest.map((i) => locs[i].file)).map((r) => ({ from: r.from, to: r.to })) : rest.length > 0 ? [{ from: 0, to: rest.length - 1 }] : [];
  let at = rest.length;
  const summarySlices: PlaceSlice[] = groups.map((g, k) => {
    const slice = { from: at, to: at + g.length - 1, summary: sp.summaries[k].summary.id };
    at += g.length;
    return slice;
  });
  plan.order = [...rest, ...groups.flat()];
  plan.reader_slices = [...restSlices, ...summarySlices].map((sl, i) => ({ reader: i + 1, ...sl }));
  plan.read_by_seat = 0;
}

/**
 * CUT A PLACE PLAN'S SEATS BY BYTES (full-read design 1.4 and R15; build unit F2). F1 cut the seats by places (105) at
 * file boundaries; this cuts each of them again until every seat's payload, assembled exactly as it will be written,
 * is within `CONTEXT_MAX_BYTES_PER_PAYLOAD` less the margin, and no seat holding more than one place holds a place
 * larger than one Read range (`PLACE_EXCERPT_MAX_BYTES`). A seat is halved at the file boundary nearest its middle, and
 * at its middle only where one file fills it. A place larger than a range is given a seat of its own; a single place
 * over the byte bound is a seat of its own recorded `oversized` on its slice. Every place stays in exactly one seat,
 * in order. The plan in the document is rewritten (`reader_slices`, `read_by_seat` 0) and the group marker's
 * `readers` follows it, so the capture reads the seats the payloads hold.
 */
function cutPlaceSeats(
  source: Candidate,
  assemble: (job: PayloadJob) => { text: string; largerThanRange: FindingLocation[] },
  readings: CandidateReadings,
  /** How the payload writer reads files, so a slice's places larger than a range can be found without writing it. */
  probe: PlaceProbe | null,
): void {
  const plan = source.reading_plan as unknown as { reader_slices: (PlaceSlice & { reader: number })[]; read_by_seat: number };
  const reading = readings.of(source);
  const census = reading.census;
  if (!census || !plan) return;
  const locs = source.locations;
  // POSITIONS ARE POSITIONS IN THE PLAN'S `order` (identity unless `arrangeSummarySeats` moved summarized places to the
  // end): the unit at position p is the place `order[p]`.
  const planOrder = (plan as unknown as { order?: number[] }).order;
  const order = Array.isArray(planOrder) && planOrder.length === locs.length ? planOrder : locs.map((_, i) => i);
  const files = order.map((i) => locs[i].file);
  const positionOf = new Map(order.map((idx, pos) => [locs[idx], pos]));
  const out: PlaceSlice[] = [];
  const trial = (from: number, to: number): { bytes: number; heavy: number[] } => {
    const handed = order.slice(from, to + 1).map((i) => census.kinds[i]);
    const built = assemble({
      key: `${source.adjudication_group?.key ?? source.finding_id}#trial`,
      reader: true,
      members: [{ source, view: { ...source, locations: handed.map((k) => k.representative) }, census, handed, reading }],
    });
    return {
      bytes: Buffer.byteLength(built.text, "utf8"),
      heavy: built.largerThanRange.map((l) => positionOf.get(l) ?? -1).filter((i) => i >= from && i <= to),
    };
  };
  // THE FIRST PLACE OF A SLICE THAT IS LARGER THAN A RANGE, WITHOUT WRITING THE SLICE. `cut` below needs
  // only that first position whenever there is one, and before this change it wrote the whole slice to learn it - so a
  // candidate whose places are all larger than a range wrote the rest of the candidate once per place, which grows with
  // the square of the places. Whether a place is larger than a range is what `buildPayloadContext` decides for it:
  // its own window (`windowOfPlace`) under the budget the slice's count of windowed places gives (`perLocationBudget`),
  // over `PLACE_EXCERPT_MAX_BYTES`; a place with a fact (`placeFactsOf`) or in a file that cannot be quoted
  // (`readableLines`) is never one, and is not counted. Those are the same functions it calls, so the answer is the
  // same. The budget is the same for every slice of 44 or more windowed places (the floor), so for those the first
  // position is looked up in a table worked out once; a smaller slice asks each of its windowed places (fewer than 44).
  const firstLarger = ((): ((from: number, to: number) => number) | null => {
    if (!probe) return null;
    const n = order.length;
    const isFact = new Uint8Array(n);
    const quotable = new Uint8Array(n);
    const linesAt: (string[] | null)[] = new Array(n);
    for (let p = 0; p < n; p++) {
      const loc = census.kinds[order[p]]?.representative;
      if (!loc) return null;
      const lines = probe.readLines(loc.file);
      linesAt[p] = lines;
      if (!readableLines(lines)) continue;
      quotable[p] = 1;
      if (placeFactsOf(loc.file, lines, probe.isTranscoded(loc.file))(loc.start_line, loc.end_line ?? loc.start_line)) isFact[p] = 1;
    }
    const factsBefore = new Int32Array(n + 1);
    for (let p = 0; p < n; p++) factsBefore[p + 1] = factsBefore[p] + isFact[p];
    const windowedAfter = new Int32Array(n + 1).fill(n);
    for (let p = n - 1; p >= 0; p--) windowedAfter[p] = isFact[p] ? windowedAfter[p + 1] : p;
    const larger = (p: number, budget: number): boolean => {
      if (!quotable[p] || isFact[p]) return false;
      const lines = linesAt[p] as string[];
      const loc = census.kinds[order[p]].representative;
      const w = windowOfPlace(lines, loc, probe.windowLines, budget);
      return excerptBytes(lines, w.start, w.end) > PLACE_EXCERPT_MAX_BYTES;
    };
    const floor = perLocationBudget(Number.MAX_SAFE_INTEGER);
    const nextAtFloor = new Int32Array(n + 1).fill(-1);
    for (let p = n - 1; p >= 0; p--) nextAtFloor[p] = larger(p, floor) ? p : nextAtFloor[p + 1];
    return (from, to) => {
      const budget = perLocationBudget(to - from + 1 - (factsBefore[to + 1] - factsBefore[from]));
      if (budget === floor) {
        const p = nextAtFloor[from];
        return p >= 0 && p <= to ? p : -1;
      }
      for (let p = windowedAfter[from]; p <= to; p = windowedAfter[p + 1]) if (larger(p, budget)) return p;
      return -1;
    };
  })();
  const middleCut = (from: number, to: number): number => {
    const mid = from + Math.floor((to - from + 1) / 2);
    let best = -1;
    for (let b = from + 1; b <= to; b++) {
      if (files[b] !== files[b - 1] && (best < 0 || Math.abs(b - mid) < Math.abs(best - mid))) best = b;
    }
    return best > 0 ? best : mid;
  };
  const cut = (from: number, to: number): void => {
    const first = firstLarger && from !== to ? firstLarger(from, to) : -1;
    if (first >= 0) {
      // What the branch below does with `Math.min(...t.heavy)`, without writing the slice to find it.
      if (first > from) cut(from, first - 1);
      cut(first, first);
      if (first < to) cut(first + 1, to);
      return;
    }
    const t = trial(from, to);
    if (from === to) {
      out.push(t.bytes > CONTEXT_MAX_BYTES_PER_PAYLOAD ? { from, to, oversized: true } : { from, to });
      return;
    }
    if (t.heavy.length > 0) {
      const h = Math.min(...t.heavy);
      if (h > from) cut(from, h - 1);
      cut(h, h);
      if (h < to) cut(h + 1, to);
      return;
    }
    if (t.bytes <= CONTEXT_MAX_BYTES_PER_PAYLOAD - PLACE_SEAT_TRIAL_MARGIN) {
      out.push({ from, to });
      return;
    }
    const b = middleCut(from, to);
    cut(from, b - 1);
    cut(b, to);
  };
  const slices = plan.reader_slices.length > 0 ? [...plan.reader_slices].sort((a, b) => a.reader - b.reader) : [{ reader: 1, from: 0, to: locs.length - 1 }];
  // A summary seat is never cut: it holds one summary of at most `SUMMARY_MAX_BYTES` and no window.
  for (const slice of slices) {
    if (slice.summary) out.push({ from: slice.from, to: slice.to, summary: slice.summary });
    else {
      const at = out.length;
      cut(slice.from, slice.to);
      // An own-name seat cut by bytes stays an own-name seat: its parts hold only its places.
      if (slice.own_name) for (let k = at; k < out.length; k++) out[k]!.own_name = slice.own_name;
    }
  }
  plan.reader_slices = out.map((sl, i) => ({
    reader: i + 1,
    from: sl.from,
    to: sl.to,
    ...(sl.oversized ? { oversized: true as const } : {}),
    ...(sl.summary ? { summary: sl.summary } : {}),
    ...(sl.own_name ? { own_name: sl.own_name } : {}),
  }));
  plan.read_by_seat = 0;
  if (source.adjudication_group) source.adjudication_group.readers = out.length;
}

/**
 * A candidate with no plan, given the place plan so that its places can be spread over place seats (full-read design
 * 1.4: "A candidate larger than one seat is spread over consecutive seats and answered once"): its locations in
 * path-then-line order (the order a place plan indexes), its kind census (the label and order), and a plan of one place
 * seat holding every place, which `cutPlaceSeats` then cuts by bytes. Nothing is dropped, merged or added.
 */
function toPlacePlan(source: Candidate): boolean {
  const sorted = sortLocationsForCensus(source.locations);
  // A location without its kind facts cannot be censused (`computeKindCensus` refuses it by name). Every location of a
  // document scanned with the census on carries them; where one does not, the candidate is left as it was - written
  // whole and recorded `oversized`, as before this unit - and nothing is reordered.
  let census: ReturnType<typeof computeKindCensus>;
  try {
    census = computeKindCensus({ ...source, locations: sorted }, MAX_PLACES_PER_SEAT);
  } catch {
    return false;
  }
  source.locations.splice(0, source.locations.length, ...sorted);
  source.kinds = census;
  const plan = planReading(census, sorted.length, source.rule_id, MAX_PLACES_PER_SEAT, declaredReadingClassOf(source), sorted.map((l) => l.file));
  source.reading_plan = { ...plan, read_by_seat: 0, reader_slices: [{ reader: 1, from: 0, to: sorted.length - 1 }] };
  return true;
}

/**
 * WHAT EVERY PAYLOAD OF ONE CANDIDATE READS OFF THE WHOLE CANDIDATE, WORKED OUT ONCE. A candidate over the
 * seat bound is written as one payload per place seat, and the number of seats grows with its places. Before this change each
 * of those payloads asked `reading.ts` again for things that depend on the whole candidate and not on the seat - its
 * plan (`readingPlanOf`), its units (`readingUnitsOf`, `readersOf`, `readingUnitsCensusOf`), the units each reader is
 * handed (`handedUnitIds`), the skeleton's per-unit rows and the census hash (`skeletonOf`), the catalogue
 * (`catalogueSummary`) and each place's number - and every one of those reads the whole candidate. So the writing grew
 * with the square of the candidate: 46 s after `completed_at` for one 1 MB file of credential lines, 925 s for six. Each is now worked out once per candidate and handed to every payload of it.
 *
 * **What the payloads hold does not change.** Each value is what the `reading.ts` function returns, called once:
 * `plan`, `units`, `readers`, `census` and `catalogue` are those calls' results; `handed` is `handedUnitIds` with the
 * census and the plan it reads worked out once (the same two lines over the same two values); `skeleton(slice)` is
 * `skeletonOf(candidate, every unit)` cut down to the slice - a unit's row in the skeleton depends on that unit alone,
 * and an item lists the handed units of its token in census order, so cutting the whole skeleton gives what
 * `skeletonOf(candidate, slice)` gives. A test holds the three derived ones equal to the
 * `reading.ts` functions on a real scan's candidates, so a change to either side that breaks the equality is red.
 * (`reading.ts` itself is pinned by the verdict rules' version, which is why the work is kept here.)
 *
 * **A reading answers for the candidate as it stood when it was worked out.** The writer rewrites a plan in two
 * places (`cutPlaceSeats`, `toPlacePlan`, and `arrangeSummarySeats` when summaries are on): it replaces the plan's
 * fields, or the plan, the census and the locations' order together. `CandidateReadings.of` compares each of those
 * fields with the ones the reading was worked out from and works it out again on any difference, so a reading never
 * outlives the plan it read.
 */
export class CandidateReading {
  private _plan?: ReturnType<typeof readingPlanOf>;
  private _census?: ReadingCensus | null;
  private _units?: number;
  private _readers?: number;
  private _known?: Set<string>;
  private _indexOf?: Map<FindingLocation, number>;
  private _catalogue?: ReadingCatalogueSummary;
  private _skeleton?: { whole: ReadingSkeleton; unitOf: Map<string, SkeletonUnit>; itemOf: Map<string, { item: number; at: number }> } | null;
  constructor(readonly source: Candidate) {}
  /** `readingPlanOf(source)`. */
  get plan(): ReturnType<typeof readingPlanOf> {
    if (this._plan === undefined) this._plan = readingPlanOf(this.source);
    return this._plan;
  }
  /** `readingUnitsCensusOf(source)`. */
  get census(): ReadingCensus | null {
    if (this._census === undefined) this._census = readingUnitsCensusOf(this.source);
    return this._census;
  }
  /** `readingUnitsOf(source)`. */
  get units(): number {
    if (this._units === undefined) this._units = readingUnitsOf(this.source);
    return this._units;
  }
  /** `readersOf(source)`. */
  get readers(): number {
    if (this._readers === undefined) this._readers = readersOf(this.source);
    return this._readers;
  }
  /** `readingPlanOf(source)?.reader_slices.length ?? 0`. */
  get readerSlices(): number {
    return this.plan?.reader_slices.length ?? 0;
  }
  /** `handedUnitIds(source, who)`, its census, plan and known ids worked out once for every reader. */
  handed(who: "seat" | { reader: number }): string[] | null {
    const census = this.census;
    if (!census) return null;
    const plan = this.plan;
    const known = (this._known ??= new Set(census.kinds.map((k) => k.id)));
    if (who !== "seat") {
      const slice = plan?.reader_slices[who.reader - 1];
      return slice ? slice.filter((k) => known.has(k)) : null;
    }
    if (!plan || (plan.seat_slice.length === 0 && plan.reader_slices.length === 0)) return census.kinds.map((k) => k.id);
    return plan.seat_slice.filter((k) => known.has(k));
  }
  /** Each location's index in `source.locations`: the number `P<n>` a place row carries. */
  indexOf(): Map<FindingLocation, number> {
    return (this._indexOf ??= new Map(this.source.locations.map((l, i) => [l, i])));
  }
  /** `catalogueSummary(census)`, for the census this reading holds. */
  catalogue(): ReadingCatalogueSummary {
    return (this._catalogue ??= catalogueSummary(this.census as ReadingCensus));
  }
  /** `skeletonOf(source, slice)`: the whole candidate's skeleton once, cut to the slice. */
  skeleton(slice: readonly string[]): ReadingSkeleton | null {
    if (this._skeleton === undefined) {
      const ids = this.census?.kinds.map((k) => k.id) ?? [];
      const whole = skeletonOf(this.source, ids);
      if (!whole) this._skeleton = null;
      else {
        const unitOf = new Map(whole.units.map((u) => [u.kind, u]));
        const itemOf = new Map<string, { item: number; at: number }>();
        whole.items.forEach((item, i) => item.units.forEach((u, at) => itemOf.set(u, { item: i, at })));
        this._skeleton = { whole, unitOf, itemOf };
      }
    }
    const sk = this._skeleton;
    if (!sk) return null;
    const units = slice.map((id) => sk.unitOf.get(id)).filter((u): u is SkeletonUnit => u !== undefined);
    const byItem = new Map<number, { id: string; at: number }[]>();
    for (const id of new Set(units.map((u) => u.kind))) {
      const where = sk.itemOf.get(id);
      if (!where) continue;
      const list = byItem.get(where.item);
      if (list) list.push({ id, at: where.at });
      else byItem.set(where.item, [{ id, at: where.at }]);
    }
    const items = [...byItem.keys()]
      .sort((a, b) => a - b)
      .map((i) => {
        const item = sk.whole.items[i];
        const ids = byItem.get(i)!.sort((a, b) => a.at - b.at).map((x) => x.id);
        return { id: item.id, token: item.token, units: ids, units_total: item.units_total };
      });
    return { census_hash: sk.whole.census_hash, units, items };
  }
}

/** The readings of one writing's candidates, each worked out again whenever the candidate's plan changed. */
export class CandidateReadings {
  private readonly memo = new Map<Candidate, { token: unknown[]; reading: CandidateReading }>();
  of(source: Candidate): CandidateReading {
    const token = readingToken(source);
    const held = this.memo.get(source);
    if (held && held.token.length === token.length && held.token.every((v, i) => Object.is(v, token[i]))) return held.reading;
    const reading = new CandidateReading(source);
    this.memo.set(source, { token, reading });
    return reading;
  }
}

/** Every value a reading reads off its candidate, by identity: the plan and each field of it, the census and each field
 * of it, the locations and their count, and the two fields of the group marker `readingPlanOf` falls back on. */
function readingToken(c: Candidate): unknown[] {
  const fields = (o: unknown): unknown[] =>
    o && typeof o === "object" ? Object.entries(o as Record<string, unknown>).flat() : [];
  const group = c.adjudication_group as unknown as Record<string, unknown> | undefined;
  return [c.reading_plan, ...fields(c.reading_plan), c.kinds, ...fields(c.kinds), c.locations, c.locations?.length, group?.reading_units, group?.readers];
}

/** How the payload writer reads the tree's files: what `cutPlaceSeats` needs to find a slice's places larger than a range. */
interface PlaceProbe {
  readLines: (file: string) => string[] | null;
  isTranscoded: (file: string) => boolean;
  windowLines: number;
}

/** One payload file to write: its key, and the candidates as that payload carries them. */
interface PayloadJob {
  key: string;
  /**
   * True for a `<key>#reader-<n>` payload. It holds one reader's slice of ONE candidate whose seat
   * payload is written too, so the byte cap neither divides it nor writes its size onto the marker
   * object the two payloads share — see the cap's own note in `writeContextPayloads`.
   */
  reader?: true;
  members: {
    /** The candidate as the document holds it. */
    source: Candidate;
    /** The same candidate with `locations` narrowed to what this payload opens. */
    view: Candidate;
    /** Null for a candidate read location by location, which is the ordinary case. */
    census: ReadingCensus | null;
    /** The kinds this payload hands to its seat. Empty for a seat that reads the readers' fold. */
    handed: ReadingKind[];
    /** What the payload reads off the whole candidate, worked out once (`CandidateReading`). */
    reading: CandidateReading;
  }[];
}

/**
 * The payload files a document needs, in the order the index lists them.
 *
 * A group whose candidates are all read location by location is one payload, exactly as it has been:
 * `--kind-census off` therefore writes the same files it wrote before this function existed. A
 * candidate read BY KINDS whose plan gives it readers is written as one payload per reader —
 * `<key>#reader-<n>`, holding that reader's slice of the census — followed by the verdict seat's own
 * payload under the group's key, which holds the seat's own slice (the kinds an existence-class seat
 * reads itself) and the bounded catalogue of the whole census.
 */
function payloadJobs(findings: Findings, readings: CandidateReadings, placeForm = false, placeSeats?: (source: Candidate) => void): PayloadJob[] {
  // Groups in first-appearance order, so the index reads in the order the document's candidates do.
  // The key is `adjudication_group.key` and nothing composed here; `finding_id` is the fallback for
  // a candidate that carries no group, which `assignAdjudicationGroups` never produces — it gives
  // such a candidate a payload of its own rather than silently joining it to another group's.
  const groups = new Map<string, Candidate[]>();
  for (const c of findings.candidates) {
    const key = c.adjudication_group?.key ?? c.finding_id;
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }

  const jobs: PayloadJob[] = [];
  for (const [key, candidates] of groups) {
    const readerJobs: PayloadJob[] = [];
    const seatMembers: PayloadJob["members"] = [];
    for (const source of candidates) {
      // THE PLACE FORM: a place plan's seats are cut by bytes as well as by places (`placeSeats`, which rewrites the
      // plan in the document) BEFORE any of its payloads is keyed, so `<key>#reader-<n>` is final when it is written.
      // A place plan with no reader slice (a candidate that fits one seat) is not cut: its seat holds every place and
      // answers it (design 1.4); a lone one over the byte bound is spread below, as any lone candidate over it is.
      if (placeSeats && isPlacePlan(source) && readings.of(source).readerSlices > 0) placeSeats(source);
      const { readers, seat } = candidateJobs(key, source, placeForm, readings);
      readerJobs.push(...readers);
      seatMembers.push(seat);
    }
    jobs.push(...readerJobs);
    jobs.push({ key, members: seatMembers });
  }
  return jobs;
}

/** A candidate whose plan is the place plan (`reading-plan-2`, unit `place`; build unit F1). */
function isPlacePlan(c: Candidate): boolean {
  return (c.reading_plan as { unit?: string } | undefined)?.unit === "place";
}

/**
 * ONE CANDIDATE'S PAYLOADS: its place seats (`<key>#reader-<n>`, one per slice of its plan) and its member of the
 * group's seat payload. A candidate with no census is its own seat member, every location in it.
 * **In the place form no representative stands for anything** (full-read design 1.1 and 6.1, "What is removed";
 * build unit F2): a place plan's unit is one location, and a seat's payload holds exactly the places of its slice, each
 * its own row - no sub-shape lines, no dedupe of two places on one line (two rules, or two clauses, on one line are two
 * places). `handedLocations` stays for a `reading-plan-1` plan outside the place form.
 */
function candidateJobs(
  key: string,
  source: Candidate,
  placeForm: boolean,
  readings: CandidateReadings,
): { readers: PayloadJob[]; seat: PayloadJob["members"][number] } {
  // THE UNITS THE PLAN READS, not the raw groups: a per-location rule over the bound reads by
  // lines, and its payload hands the seat those lines. One mechanism, both classes.
  const reading = readings.of(source);
  const census = reading.census;
  if (!census) return { readers: [], seat: { source, view: source, census: null, handed: [], reading } };
  const byId = new Map(census.kinds.map((k) => [k.id, k]));
  const plan = reading.plan;
  const kindsOf = (ids: string[] | null): ReadingKind[] => (ids ?? []).map((k) => byId.get(k)).filter((k): k is ReadingKind => k !== undefined);
  const places = placeForm && isPlacePlan(source);
  const linesOf = (handed: ReadingKind[]): FindingLocation[] => (places ? handed.map((k) => k.representative) : handedLocations(handed));
  const readers: PayloadJob[] = [];
  plan?.reader_slices.forEach((_slice, i) => {
    const handed = kindsOf(reading.handed({ reader: i + 1 }));
    readers.push({
      key: `${key}#reader-${i + 1}`,
      reader: true,
      members: [{ source, view: { ...source, locations: linesOf(handed) }, census, handed, reading }],
    });
  });
  // The seat's own slice (reading.ts `handedUnitIds`, the one rule the capture also uses). A plan that names one is
  // followed; a candidate whose kinds all fit in one seat and whose plan named no slice is handed every kind, which is
  // what the plan means by a candidate at or under the bound. A plan with readers and no seat slice hands the seat the
  // catalogue and the fold and no excerpt of its own, which is section 3.2's N/M/L seat.
  const seatHanded = kindsOf(reading.handed("seat"));
  return { readers, seat: { source, view: { ...source, locations: linesOf(seatHanded) }, census, handed: seatHanded, reading } };
}

export function writeContextPayloads(args: {
  findings: Findings;
  targetRoot: string;
  outPath: string;
  windowLines: number;
  /**
   * THE PLACE FORM (full-read design 1.2-1.4; build unit F2): every place carries its own window or a fact the program
   * tested on its line, with a place id; a place seat holds at most `CONTEXT_MAX_BYTES_PER_PAYLOAD` bytes; a place larger
   * than one Read range or one seat has a seat of its own. Set where the scan wrote the place plan (`--kind-census`
   * on, the default); off, the payloads are the ones written before the full-read form, byte for byte.
   */
  placeForm?: boolean;
  /**
   * DATA SUMMARIES (full-read design section 2; build unit F6): in the place form, where the packer packed the document,
   * a candidate's places in a data file group are given as one summary the program verified over every record
   * (`data-summary.ts`) instead of one window each, every place still in exactly one payload. **Default OFF** a summary seat's reply has no capture yet (no C7 over a summary's
   * ranges, no seat text, no summary premises), so a summary would be read with nothing checking it. `true` turns the
   * summaries on (the data-summary gate's arm); omitted or `false` writes F2's payloads, a window per place.
   */
  dataSummaries?: boolean;
  /**
   * The profile the scan read (none in CI) and the bundle's rules: where the profile holds
   * the self-name answer (own-name.ts), the five recipient rules' own-name places are read in own-name seats.
   */
  profile?: unknown;
  rules?: readonly Rule[];
}): { index: ContextPayloadsIndex; stale_removed: number } | null {
  const { findings, targetRoot, outPath, windowLines } = args;
  const placeForm = args.placeForm === true;
  if (windowLines <= 0) return null;
  /** Each candidate's whole-candidate reading, worked out once for all of its payloads (`CandidateReading`). */
  const readings = new CandidateReadings();

  const dir = join(dirname(outPath), CONTEXT_PAYLOAD_DIR);

  // ONE READ OF EACH FILE FOR THE WHOLE WRITE (it was one per payload): the place form assembles trial payloads to cut
  // seats by bytes, and every trial reads the same files. What is read, and how, is unchanged.
  const cache = new Map<string, string[] | null>();
  const transcoded = new Set<string>();
  const readLines = (file: string): string[] | null => {
    if (!cache.has(file)) {
      try {
        // READ AS BYTES AND DECODE HERE, rather than letting `readFileSync(..., "utf8")` do it out
        // of sight. The decode never fails: bytes that are not valid UTF-8 become
        // U+FFFD, so the only way to learn that an excerpt will not be the file's bytes is to
        // encode the decoded text again and compare. ONE COMPARISON PER FILE, whatever the number
        // of excerpts taken from it, and the result is spread onto every one of them.
        const raw = readRegularFile(join(targetRoot, file));
        // Decoded as the engine decoded it (project-read.ts `decodeSourceText`), so a window is the text a rule read; a
        // UTF-16 file is then marked transcoded, which it is.
        const text = decodeSourceText(raw);
        if (!Buffer.from(text, "utf8").equals(raw)) transcoded.add(file);
        // SEAT MATERIAL IS REDACTED HERE, ONCE PER
        // FILE: every window, place fact and summary below is cut from these lines, so a credential on a candidate's line
        // reaches no seat, and so no model provider, through a payload. The marker keeps the provider's non-secret
        // prefix and the value's shape (credential-redaction.ts `redactSeatText`); a file without one is unchanged.
        cache.set(file, fileLines(redactSeatText(productPrintedRedaction(), text)));
      } catch {
        cache.set(file, null);
      }
    }
    return cache.get(file) ?? null;
  };

  // Hoisted: `placeSeats` (below) assembles trial payloads while `payloadJobs` runs.
  let assemble: (job: PayloadJob) => { text: string; excerpts: number; largerThanRange: FindingLocation[] };
  const capApplies = findings.candidates.some((c) => c.adjudication_group?.bin !== undefined);
  // THE SUMMARIES, one plan per candidate, computed once from the whole candidate (and again only where `toPlacePlan`
  // reorders its places, which renumbers them). Only where the writer cuts place seats: a summary must sit in one seat
  // with every place it covers, and only that path can give it one.
  const summariesOn = placeForm && capApplies && args.dataSummaries === true;
  const summaryPlans = new Map<Candidate, SummaryPlan>();
  const parsedData = new Map<string, ParsedDataFile | null>();
  const summaryPlanOf = (source: Candidate): SummaryPlan | null => {
    if (!summariesOn) return null;
    let sp = summaryPlans.get(source);
    if (sp === undefined) {
      sp = summarizeCandidate({ candidate: source, readLines, isTranscoded: (file) => transcoded.has(file), parsed: parsedData });
      summaryPlans.set(source, sp);
    }
    return sp.summaries.length > 0 ? sp : null;
  };
  // THE SELF-NAME ANSWER: which places of the five recipient rules name only the declared
  // entry, on a line naming no host or URL under its name. Keyed by location (the census's representatives are the
  // candidate's own location objects) and by its text, so a trial payload finds them too.
  const vendor = placeForm ? vendorSoftwareOf(args.profile) : null;
  const ownNameAt = new Set<string>();
  const ownKey = (l: FindingLocation): string => JSON.stringify([l.file, l.start_line, (l as { start_column?: unknown }).start_column ?? null, (l as { matched_token?: unknown }).matched_token ?? null]);
  const rulesById = new Map((args.rules ?? []).map((r) => [r.id, r]));
  let manifests: ManifestName[] | null = null;
  const ownNameBlockOf = (source: Candidate): Record<string, unknown> | null => {
    if (!vendor || !SELF_NAME_RULES.has(source.rule_id)) return null;
    const rule = rulesById.get(source.rule_id);
    manifests ??= manifestNamesOf(targetRoot);
    const words = nameWordsOf(rule, vendor.entry);
    const entity = rule?.detector?.vocabulary_entities?.[vendor.entry];
    return {
      entry: vendor.entry,
      ...(entity ? { legal_entity: entity } : {}),
      relation: vendor.relation,
      manifest_names: manifests,
      manifest_premise: ownNamePremiseOf(vendor, manifests, words),
      question: OWN_NAME_QUESTION,
    };
  };
  const arrangeOwnName = (source: Candidate): void => {
    if (!vendor || !SELF_NAME_RULES.has(source.rule_id)) return;
    const rule = rulesById.get(source.rule_id);
    if (!vendorEntriesOf(rule).has(vendor.entry)) return;
    const index = ownerIndexOf(rule);
    const words = nameWordsOf(rule, vendor.entry);
    const isOwn = (l: FindingLocation): boolean =>
      ownNameEntryOf((l as { matched_token?: unknown }).matched_token, index) === vendor.entry && !namesPublisherHost(readLines(l.file)?.[l.start_line - 1], words);
    for (const l of source.locations) if (isOwn(l)) ownNameAt.add(ownKey(l));
    arrangeOwnNameSeats(source, (l) => ownNameAt.has(ownKey(l)), vendor.entry);
  };
  const placeSeats =
    placeForm && capApplies
      ? (source: Candidate) => {
          arrangeSummarySeats(source, summaryPlanOf(source));
          arrangeOwnName(source);
          cutPlaceSeats(source, (job) => assemble(job), readings, summaryPlanOf(source) === null ? { readLines, isTranscoded: (file) => transcoded.has(file), windowLines } : null);
        }
      : undefined;
  // No candidate, no job: every group of candidates is at least one job (`payloadJobs`).
  if (findings.candidates.length === 0) {
    // NO GROUPS IS NOT "NOTHING TO CLEAN". A re-scan that raises no candidate at all is exactly the
    // run after which a directory full of the previous run's source excerpts is most misleading, so
    // the sweep happens here too — but only if the directory already exists, because a run with no
    // candidates must not create one.
    const staleRemoved = removeStalePayloads(dir, new Set());
    return {
      index: {
        directory: CONTEXT_PAYLOAD_DIR,
        window_lines: windowLines,
        max_bytes_per_location: CONTEXT_MAX_BYTES_PER_LOCATION,
        min_bytes_per_location: CONTEXT_MIN_BYTES_PER_LOCATION,
        bytes_per_payload_budget: CONTEXT_BYTES_PER_PAYLOAD_BUDGET,
        holds_source_excerpts: true,
        // THE PREVIEW IS WRITTEN HERE TOO, over zero payloads. A run that raised no candidate still
        // answers "what will layer 2 cost" — with nothing, and the three shapes all at zero — and a
        // key that appeared only on runs with work in them would make its absence ambiguous.
        cost_preview: costPreview(findings.candidates, []),
        payloads: [],
      },
      stale_removed: staleRemoved,
    };
  }
  // The payload windows hold the scanned code in clear, so their folder carries the product's ignore
  // files wherever `--out` put it (legal-dir.ts `guardWorkingFolder`; `payloads/` is this program's own folder).
  guardWorkingFolder(dir, true);

  // WHERE THE BYTE CAP APPLIES, and the whole of what it is gated on: a document the packer packed.
  // `--pack-groups off` writes the document and the payload files this scanner wrote before packing
  // existed, byte for byte, and that is the control arm packing is measured against — so a bin the
  // cap divides can only ever be a bin the packer made, and on the off arm the cap, its counts and
  // its flags are all absent rather than merely inert.
  // The next free bin number: a part the cap cuts off takes the next number after the document's
  // highest, so the numbers stay 1..N with no gap (a test asserts exactly
  // that) and no part inherits a number another key already uses.
  let nextBin =
    findings.candidates.reduce((n, c) => Math.max(n, c.adjudication_group?.bin ?? 0), 0) + 1;
  /** The bins the cap divided, by their original number — a bin cut into three parts is one bin. */
  const binsDivided = new Set<number>();

  /**
   * ONE JOB'S PAYLOAD FILE AS TEXT, and the excerpt count its index row states.
   *
   * A function rather than the body of the loop below because the cap needs the assembled bytes to
   * decide, and a bin it divides is assembled again, once per part. Nothing here is aware of the
   * cap: it builds the payload of whatever members the job holds.
   */
  assemble = (job: PayloadJob): { text: string; excerpts: number; largerThanRange: FindingLocation[] } => {
    const key = job.key;
    // THE SUMMARIES THIS PAYLOAD HOLDS (build unit F6): a summary is written where every place it covers is in this
    // payload - by construction its own seat, or the one seat of a candidate written whole - and its places then have no
    // row and no window here. A summary whose places are not all here is not written, and its places here are windowed
    // as before: no place is ever left without its window, its fact or its summary.
    const inPayload = new Set(job.members.flatMap((m) => m.view.locations));
    // A place seat whose every place is an own-name place (`arrangeOwnName`).
    const ownNameSeat = vendor !== null && job.reader === true && job.members.length === 1 && job.members[0]!.view.locations.length > 0 && job.members[0]!.view.locations.every((l) => ownNameAt.has(ownKey(l)));
    const summaryAt = new Map<FindingLocation, DataSummary>();
    for (const m of job.members) {
      const sp = summaryPlanOf(m.source);
      if (!sp) continue;
      for (const e of sp.summaries) if (e.locations.every((l) => inPayload.has(l))) for (const l of e.locations) summaryAt.set(l, e.summary);
    }
    const rowsOf = (m: PayloadJob["members"][number]): FindingLocation[] => (summaryAt.size > 0 ? m.view.locations.filter((l) => !summaryAt.has(l)) : m.view.locations);
    // The candidates AS THIS PAYLOAD CARRIES THEM: the document's own objects where the candidate is
    // read location by location, and a view whose `locations` are the representatives and sub-shape
    // first lines where it is read by kinds. Everything below — the excerpt budget, the windows, the
    // per-location pointers — then works on the lines this payload actually opens, with no second
    // code path for a candidate with a census.
    const candidates = summaryAt.size > 0 ? job.members.map((m) => ({ ...m.view, locations: rowsOf(m) })) : job.members.map((m) => m.view);
    const { excerpts, contexts, unreadable, facts, largerThanRange } = buildPayloadContext(
      candidates,
      readLines,
      windowLines,
      (file) => transcoded.has(file),
      placeForm,
    );

    // NOTHING RUN-DEPENDENT GOES IN A PAYLOAD FILE, and `scan_id` is the field that makes the point:
    // it was here until it was measured, and it broke a property the whole repository rests on.
    // `context_payloads[].sha256` is a hash of the file as written, so a field that differs between
    // two runs of one tree makes the DOCUMENT differ between two runs of one tree —
    // two tests compare exactly that and
    // went red. The payload is therefore a pure function of the tree and the document, two runs of
    // one tree write identical payload files, and the tie between a payload and the document that
    // names it is the index's own `sha256`, which is what a consumer checks.
    const payload = {
      payload_version: 1,
      target: findings.target,
      bundle: findings.bundle,
      // Through `groupForPayload` and never raw: the two fields the cap records are the size of
      // THIS FILE, and a file that states its own size cannot be written (`WITHHELD_FROM_PAYLOAD_GROUP`).
      adjudication_group: candidates[0].adjudication_group
        ? groupForPayload(candidates[0].adjudication_group as unknown as Record<string, unknown>)
        : { key },
      holds_source_excerpts: true,
      context: {
        window_lines: windowLines,
        produced_by: PAYLOAD_PRODUCED_BY,
        ...(unreadable.length > 0 ? { files_not_readable: unreadable } : {}),
        ...(placeForm ? { places_are: PLACES_ARE } : {}),
        ...(summaryAt.size > 0 ? { summaries_are: SUMMARIES_ARE } : {}),
      },
      excerpts,
      // ONE BLOCK PER RULE ID, and the candidates below name it with the `rule_id` they already
      // carry. Nothing a child was handed before is missing: see `RULE_OWNED_IN_PAYLOAD`. An own-name seat's rule blocks leave out the rule's context questions and its
      // evidence and remediation templates (`OWN_NAME_SLIMMED`): the seat is asked `own_name.question` instead, and the
      // templates are for the seat that answers the candidate, which still carries them.
      rules: ownNameSeat ? collectRuleProse(candidates).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !OWN_NAME_SLIMMED.includes(k))) as PayloadRuleProse) : collectRuleProse(candidates),
      candidates: job.members.map((m) => {
        const copy: Record<string, unknown> = { ...(m.view as unknown as Record<string, unknown>) };
        // The person's answer and the manifest premise ride on every seat of a declared entry's candidate, place seat or
        // not; an own-name seat also says it is one (`own_name.seat`).
        const own = ownNameBlockOf(m.source);
        if (own) copy.own_name = ownNameSeat ? { ...own, seat: "own_name" } : (({ question: _q, ...rest }) => rest)(own);
        for (const field of WITHHELD_FROM_PAYLOAD) delete copy[field];
        for (const field of RULE_OWNED_IN_PAYLOAD) delete copy[field];
        // The group marker rides on every candidate record as well as in the header above, so the
        // two fields the cap records come off it in both places or the size is never exact.
        if (copy.adjudication_group) {
          copy.adjudication_group = groupForPayload(copy.adjudication_group as Record<string, unknown>);
        }
        if (placeForm) {
          // THE PLACE FORM: every row is one place, with its id and what it was given (`PLACES_ARE`). A row with neither a
          // window nor a fact is a place whose file could not be read, and says so.
          const indexOf = readings.of(m.source).indexOf();
          const held = [...new Set(m.view.locations.map((l) => summaryAt.get(l)).filter((x): x is DataSummary => x !== undefined))];
          if (held.length > 0) copy.summaries = held;
          copy.locations = rowsOf(m).map((loc) => {
            const at = indexOf.get(loc);
            const place = at === undefined ? "P-1" : placeId(at);
            const fact = facts.get(loc);
            if (fact) return { ...loc, place, given: "fact", fact };
            const ctx = contexts.get(loc);
            return ctx ? { ...loc, place, given: "window", context: ctx } : { ...loc, place, given: "unreadable" };
          });
        } else {
          copy.locations = m.view.locations.map((loc) => {
            const ctx = contexts.get(loc);
            return ctx ? { ...loc, context: ctx } : { ...loc };
          });
        }
        // A place's text fingerprint is the program's own identity of the place across
        // runs (place-key.ts), nothing a seat reads: it stays out of every payload row.
        for (const l of copy.locations as Record<string, unknown>[]) delete l.line_key;
        if (m.census) {
          // WHAT `locations` MEANS IN A PAYLOAD FOR A CANDIDATE READ BY KINDS, said in the payload
          // rather than left to be inferred: it is the lines this seat opens, not the candidate's
          // matched lines. `locations_total` is how many matched lines the candidate really carries,
          // `kinds` is the row of every group this seat holds, and `kinds_catalogue` is the bounded
          // form of the WHOLE census — counts by context class and by matched token, the largest
          // kinds, and the digest that ties the summary to `findings.json`'s own `kinds[].members`.
          // The members themselves are in the document and never here.
          const reading = readings.of(m.source);
          copy.reading_units = reading.units;
          copy.locations_total = m.source.locations.length;
          copy.locations_are = placeForm && isPlacePlan(m.source) && m.view.locations.length === 0
            ? `no place: this is the seat that answers the candidate, and its ${m.source.locations.length} places are each in exactly one of its place seats`
            : placeForm && isPlacePlan(m.source) && m.view.locations.length === m.source.locations.length && reading.readerSlices === 0
            ? `every place of the candidate, each its own row: all ${m.source.locations.length} of its places are in this seat, which answers the candidate with one decision row per place`
            : placeForm && isPlacePlan(m.source)
            ? `every place of this seat's slice of the candidate, each its own row: ${m.view.locations.length} of the candidate's ${m.source.locations.length} places; the other places are in the candidate's other place seats, and every place is in exactly one${summaryAt.size > 0 ? `. ${m.view.locations.length - rowsOf(m).length} of this seat's places are covered by the summaries in \`summaries\` (listed there by id) and have no row` : ""}`
            : "the representative of each kind this seat was handed, and the first line of each of its largest sub-shapes — not every matched line of the candidate: each kind's other members (`members_owed` of them, the first 12 by id in `member_ids`) each still need a decision, opened in `also`, settled by `rest`, or declined by `decline`";
          // The rows are the program's skeleton of this seat's reading (reading.ts `skeletonOf`, the one
          // function the capture recomputes it with): an id on every listed location, and the census items and hash.
          // The seat answers by these ids and copies none of it.
          // A place a summary covers is not a skeleton row either: the summary lists it by id.
          const skeleton = reading.skeleton((summaryAt.size > 0 ? m.handed.filter((k) => !summaryAt.has(k.representative)) : m.handed).map((k) => k.id));
          copy.kinds = skeleton?.units ?? [];
          copy.census_items = skeleton?.items ?? [];
          copy.census_hash = skeleton?.census_hash ?? "";
          // The census this member was built with, which is the census its reading holds (`candidateJobs`, `cutPlaceSeats`).
          // An own-name seat reads every place it is given and chooses none: the catalogue, which is for choosing what to
          // open, is left out of it.
          if (!ownNameSeat) copy.kinds_catalogue = m.reading.catalogue() as unknown as Record<string, unknown>;
        }
        // `kinds` on the census candidate is REPLACED by the rows above and never carried whole: the
        // census in the document holds every member of every group, which is the 58,712-row array a
        // payload may not hold. `reading_plan` likewise stays in the document — which kinds a seat
        // reads is decided by which payload it was handed, not by a plan it reads for itself.
        else delete copy.kinds;
        delete copy.reading_plan;
        return copy;
      }),
    };

    return { text: JSON.stringify(payload, null, 2), excerpts: excerpts.length, largerThanRange };
  };

  /**
   * ONE BIN IN TWO, by reading units, in the bin's own order.
   *
   * The cut is where the cumulative units first reach half the bin's, so the two parts are as close
   * to even as whole candidates allow, and it is then clamped so that NEITHER PART IS EMPTY — the
   * clamp is what a bin of `[1 unit, 100 units]` needs, where half is only reached by the last
   * member. Deterministic: it reads the members in the order `payloadJobs` produced them, which is
   * the document's own order, so `--jobs 1` and `--jobs 8` cut in the same place.
   */
  const splitJob = (job: PayloadJob): [PayloadJob, PayloadJob] => {
    const units = job.members.map((m) => readings.of(m.source).units);
    const total = units.reduce((n, u) => n + u, 0);
    let seen = 0;
    let cut = 0;
    while (cut < units.length) {
      seen += units[cut];
      cut++;
      if (seen * 2 >= total) break;
    }
    cut = Math.min(Math.max(cut, 1), job.members.length - 1);
    return [
      { key: job.key, members: job.members.slice(0, cut) },
      { key: job.key, members: job.members.slice(cut) },
    ];
  };

  /**
   * A part's key and bin markers, IN THE PACKER'S OWN FORM — `bin:<n>#<its rules, sorted>` with
   * `bin`, `rules_in_bin`, `candidates_in_bin`, `locations_in_bin` and (only where a member carries
   * a census) `reading_units_in_bin` recomputed for what the part actually holds.
   *
   * Renumbered rather than suffixed, so that every sentence written about a key stays true of it:
   * `SKILL.md`'s `bin:<n>#<rules>`, and a test's "one key per bin number,
   * the numbers exactly 1..N, every marker equal to what its bin holds".
   *
   * The marker object is MUTATED and not replaced (`Object.assign`): a census member's payload view
   * is a shallow copy of the candidate and shares this object by reference, so replacing it would
   * leave the view holding the old key while the document holds the new one.
   */
  const rekeyPart = (job: PayloadJob, bin: number): void => {
    const rules = [...new Set(job.members.map((m) => m.source.rule_id))].sort((x, y) =>
      x < y ? -1 : x > y ? 1 : 0,
    );
    const key = `bin:${bin}#${rules.join("+")}`;
    const locations = job.members.reduce((n, m) => n + m.source.locations.length, 0);
    const census = job.members.some((m) => m.census !== null);
    const units = job.members.reduce((n, m) => n + readings.of(m.source).units, 0);
    for (const m of job.members) {
      const g = m.source.adjudication_group;
      if (!g) continue;
      Object.assign(g, {
        key,
        bin,
        rules_in_bin: [...rules],
        candidates_in_bin: job.members.length,
        locations_in_bin: locations,
      });
      // Present exactly where a member of THIS part carries a census, both directions: a part that
      // kept the field after the census member left it would no longer be the document a
      // `--kind-census off` run writes.
      if (census) g.reading_units_in_bin = units;
      else delete g.reading_units_in_bin;
    }
    job.key = key;
  };

  const payloads: ContextPayloadRow[] = [];
  /** The file names this run wrote, which is what the stale sweep below keeps. */
  const willWrite = new Set<string>();
  /** How many payload files were written above the cap — every one of them a single candidate. */
  let payloadsOversized = 0;
  // The jobs in the index's order, with a divided bin's parts taking its place in that order. Built here, after
  // `assemble`, because the place form's `placeSeats` assembles trial payloads while the jobs are made.
  const groups = payloadJobs(findings, readings, placeForm, placeSeats);
  const queue = [...groups];
  while (queue.length > 0) {
    const job = queue.shift() as PayloadJob;
    const built = assemble(job);
    const bytes = Buffer.byteLength(built.text, "utf8");
    // THE PLACE FORM'S TWO REASONS TO DIVIDE (build unit F2): over the byte bound, as before, or holding a place larger
    // than one Read range beside other places (R15: such a place gets a seat of its own).
    const places = job.members.reduce((n, m) => n + m.view.locations.length, 0);
    const over = bytes > CONTEXT_MAX_BYTES_PER_PAYLOAD || (placeSeats !== undefined && places > 1 && built.largerThanRange.length > 0);
    // DIVISIBLE, and the three conditions are each a separate statement. `capApplies`: only a
    // packed document (see above). More than one member: a candidate is one seat and is never
    // divided or shortened. No member with readers: a candidate with readers is at or above the
    // unit bound on its own, so the first fit gave it a bin of its own and it can never be one of
    // several here — and its reader payloads carry `<key>#reader-<n>`, written BEFORE this job and
    // therefore unrenameable, so the guard is what keeps a reader key from outliving its seat.
    const divisible =
      capApplies &&
      job.members.length > 1 &&
      job.members.every(
        (m) => typeof m.source.adjudication_group?.bin === "number" && readings.of(m.source).readers === 0,
      );
    if (over && divisible) {
      const keepNumber = job.members[0].source.adjudication_group?.bin as number;
      binsDivided.add(keepNumber);
      const [first, second] = splitJob(job);
      rekeyPart(first, keepNumber);
      rekeyPart(second, nextBin++);
      queue.unshift(first, second);
      continue;
    }
    // A CANDIDATE ALONE AND STILL OVER, in the place form: no longer written whole over the bound (today's `oversized`
    // candidate) but spread over place seats by bytes and answered by its seat (design 1.4). Only a single place over
    // the bound is still written over it, in a seat of its own, and recorded.
    if (placeSeats && over && !job.reader && job.members.length === 1 && places > 1 && readings.of(job.members[0].source).readers === 0 && toPlacePlan(job.members[0].source)) {
      const source = job.members[0].source;
      // `toPlacePlan` reordered its places, so their ids changed: its summaries are computed again.
      summaryPlans.delete(source);
      placeSeats(source);
      const { readers, seat } = candidateJobs(job.key, source, true, readings);
      queue.unshift(...readers, { key: job.key, members: [seat] });
      continue;
    }
    const overCap = capApplies && bytes > CONTEXT_MAX_BYTES_PER_PAYLOAD;
    if (overCap) {
      payloadsOversized++;
      // THE CANDIDATE'S OWN RECORD, written for a seat payload holding one candidate — the case the
      // cap cannot help and therefore has to announce. A reader payload is one slice of a candidate
      // whose seat payload is written too, and both would be writing `payload_bytes` onto the one
      // marker object they share, so a reader payload over the cap is flagged on its index row and
      // nowhere else.
      const g = job.reader ? undefined : job.members[0]?.source.adjudication_group;
      if (g && job.members.length === 1) Object.assign(g, { payload_bytes: bytes, oversized: true });
    }
    const key = job.key;
    const name = payloadFileName(key);
    writeFileAt(join(dir, name), built.text);
    willWrite.add(name);
    const readByKinds = job.members.some((m) => m.census !== null);
    payloads.push({
      key,
      path: `${CONTEXT_PAYLOAD_DIR}/${name}`,
      candidates: job.members.length,
      // `locations` is the lines this payload OPENS, which for a payload of ordinary candidates is
      // every location they carry, exactly as it has always been. The two extra fields below are
      // written only for a payload holding a candidate read by kinds, so a `--kind-census off`
      // document's index is byte-for-byte the one written before the census existed.
      locations: job.members.reduce((n, m) => n + m.view.locations.length, 0),
      ...(readByKinds
        ? {
            reading_units: job.members.reduce(
              (n, m) => n + (m.census ? m.handed.length : m.view.locations.length),
              0,
            ),
            locations_covered: job.members.reduce((n, m) => n + m.source.locations.length, 0),
          }
        : {}),
      excerpts: built.excerpts,
      bytes,
      sha256: createHash("sha256").update(built.text).digest("hex"),
      // Last, and only where it is true, so that every other row is the row this scanner wrote
      // before the cap existed.
      ...(overCap ? { oversized: true as const } : {}),
    });
  }

  // THE SWEEP RUNS AFTER THE WRITES, and the keep set is the names this run actually wrote. It ran
  // before them until the cap existed, over the names `payloadJobs` predicted — a prediction the
  // cap can invalidate, because a divided bin's first part is rekeyed to its own rules and the file
  // the previous run wrote under the whole bin's key would then be kept as a file this run writes
  // and never written. Nothing else moves: the sweep removes only files this writer can prove it
  // wrote, and a file it is about to overwrite is in the keep set either way.
  const staleRemoved = removeStalePayloads(dir, willWrite);

  return {
    index: {
      directory: CONTEXT_PAYLOAD_DIR,
      window_lines: windowLines,
      max_bytes_per_location: CONTEXT_MAX_BYTES_PER_LOCATION,
      min_bytes_per_location: CONTEXT_MIN_BYTES_PER_LOCATION,
      bytes_per_payload_budget: CONTEXT_BYTES_PER_PAYLOAD_BUDGET,
      // Written only where packing applies, for the reason at `capApplies`: on the off arm this
      // index is the one written before the cap existed, field for field.
      ...(capApplies
        ? {
            max_bytes_per_payload: CONTEXT_MAX_BYTES_PER_PAYLOAD,
            payloads_oversized: payloadsOversized,
            bins_divided_by_cap: binsDivided.size,
          }
        : {}),
      holds_source_excerpts: true,
      // WHAT ADJUDICATING THESE PAYLOADS WILL COST, AND THE THREE SHAPES (unit G, 2026-09-22).
      // Computed HERE and not by the caller because the launch count is the row count and `payloads`
      // is final only at this point: the cap has divided what it divides, `rekeyPart` has rewritten
      // the keys of every part it made, and the candidates in `findings` now carry those keys — so a
      // preview taken any earlier would count launches this run does not make and look for groups
      // under keys the document no longer holds. A pure function of the two arguments: no file, no
      // clock, no environment, so two runs of one tree write the same preview.
      cost_preview: costPreview(findings.candidates, payloads),
      payloads,
    },
    stale_removed: staleRemoved,
  };
}
