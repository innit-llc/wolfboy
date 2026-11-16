/**
 * Reading one file structurally, and counting every way that can fail.
 *
 * WHAT THIS MAY NOT DO, taken from the integration design and from what derive.ts already enforces
 * for its views:
 *
 *   1. It may not remove a candidate the line-based reading found. It is called AFTER the line loop
 *      for the same file, it returns findings that are appended, and nothing here can reach anything
 *      the line loop produced. The fallback direction is therefore safe by construction: every
 *      failure below leaves exactly the candidates the scanner had before this file existed.
 *   2. It may not report a line that is not a line of the original file. Every position comes from a
 *      parse of the original text — or of a masked copy of it that preserves byte offsets and
 *      newlines character for character — and the engine range-checks the line before it uses it.
 *   3. It may not degrade silently. Grammar missing, parse throwing, file too large: each falls back
 *      to the line reading AND IS COUNTED, following the derivedViewsBuilt / derivedViewsFailed
 *      precedent, because a degrade nobody can count is a degrade nobody audits.
 *
 * `parseForStructure` takes ONE path, ONE string and the counters. It never receives the file list —
 * the walker's array stays in `runBuiltin` — so the "work out what this repository is mostly written
 * in and parse only that" pre-pass the design rejects cannot be written here without changing this
 * signature, which is a visible diff on a function whose header says why it has that shape.
 */

import type { IrNode } from "./ir.js";
import { languageFor, GRAMMARS_FOR, type StructuralLanguage } from "./languages.js";
import { maskMarkdown, maskTemplateTags } from "./masked.js";
import {
  GrammarUnavailableError,
  ParseBoundError,
  newSession,
  releaseSession,
  setWalkingSession,
  type ParseSession,
} from "./ts.js";
import { parseHtml } from "./langs/html.js";
import { parseJsx } from "./langs/jsx.js";
import { parseHaml } from "./langs/haml.js";
import { parseSlim } from "./langs/slim.js";
import { parsePug } from "./langs/pug.js";
import { parseErb, parseBlade } from "./langs/embedded.js";
import { parseHeex, parseElixir } from "./langs/heex.js";
import { MAX_FILE_BYTES } from "../walk.js";

export type ParseOutcome =
  | "parsed"
  | "no-adapter" // no grammar exists for this file's language
  | "grammar-unavailable" // a grammar exists and could not be loaded in this process
  | "parse-failed" // the grammar or the adapter threw
  | "parse-bounded" // the reading passed its time allowance (ts.ts `ParseBoundError`); counted in parseFailed
  | "too-large" // refused on the size ceiling
  | "partial-source"; // the minification ceiling blanked a line; see refuseForPartialSource

export interface ParseResult {
  tree: IrNode[] | null;
  language: StructuralLanguage | null;
  outcome: ParseOutcome;
  /** Present exactly when `outcome` is `parse-bounded`: the allowance and the milliseconds the reading had taken. */
  bounded?: { allowanceMs: number; elapsedMs: number };
  /** Release every parse tree behind this result. Called by the engine at the end of each file. */
  release(): void;
}

/**
 * THE STRUCTURAL READING'S TIME ALLOWANCE PER FILE (ts.ts `ParseBoundError` says why it is
 * a clock and what it stops). Every parse and walk of one file together, then the file is read by the
 * line patterns alone and named.
 *
 * HALF THE FILE'S OWN BUDGET, AND NEVER MORE THAN `STRUCTURAL_ALLOWANCE_MS`. The structural reading
 * is the SECOND reading of a file - every rule has read its lines before its parse is asked for - so
 * it may never take the time the line readings of the rules below need: with `--file-budget 5` a
 * hostile file's parse stops at 2.5 s and the rules keep the rest. The fixed ceiling is what applies
 * under the default 60 s budget and under `--file-budget off` (and to every in-process caller of
 * `runScan`, whose budget is `Infinity`), so a file the grammar cannot finish never holds a scan.
 *
 * THE VALUE IS A MEASUREMENT'S, NOT A GUESS.
 * It sits more than three times above the slowest structural reading of any corpus file (7.7 s on a
 * loaded machine, 8.8-9.0 s in earlier loaded runs; 10 s was too close) and far below what the
 * hostile files take, so that the answer for any real file and for any hostile one is the same on
 * every machine; a file whose reading takes close to the allowance can be answered differently by
 * two runs, and that is why the answer is written into the document with the time it was taken on.
 */
export const STRUCTURAL_ALLOWANCE_MS = 30_000;

export function structuralAllowanceMs(fileBudgetMs: number): number {
  return Math.min(STRUCTURAL_ALLOWANCE_MS, fileBudgetMs / 2);
}

/**
 * Ceiling on the text a single file may be parsed from, equal to the walker's own file ceiling
 * rather than a second, lower policy of this module's own. The walker already refuses files over
 * this size and skips minified content, so this costs nothing on a normal scan and exists for the
 * paths that hand `runScan` an explicit file list. A lower ceiling would have to be justified by a
 * measurement, not by caution.
 */
export const MAX_STRUCTURAL_BYTES = MAX_FILE_BYTES;

export interface StructuralCounters {
  treesBuilt: number;
  noAdapter: number;
  grammarUnavailable: number;
  /** FILES the parse or the adapter threw on. Never anything else — see `findingsOutOfRange`. */
  parseFailed: number;
  skippedTooLarge: number;
  /**
   * FINDINGS discarded because the check emitted a line outside the file, counted apart from
   * `parseFailed` because it is a different event in a different unit. A parse failure means a file
   * was not read at all; this means a file was read and one of its findings was not believed. Both
   * were charged to `parseFailed` until 2026-08-11, so a reader could not tell how many FILES had
   * failed — the number could exceed the number of files scanned, and the summary line added it to
   * two genuine per-file counts (independent verification, D4).
   */
  findingsOutOfRange: number;
  /**
   * FILES refused because the minification ceiling had blanked at least one of their lines
   * (`walk.ts blankLongLines`, 2026-09-07). Counted apart from `skippedTooLarge` because it is a
   * different refusal: that one is about how much text there is, this one is about the text not
   * being the document any more. Which files they are is `findings.json files_partially_read`.
   *
   * Every one of them was refused ENTIRELY, by every rule, before 2026-09-07, so this counter can
   * only ever describe files the structural side newly declined — never a file it used to read.
   */
  skippedPartialSource: number;
  candidatesAdded: number;
  candidatesDuplicate: number;
  candidatesDroppedByMatchWithout: number;
  /**
   * Each language that could not be read, named ONCE with the first error it gave, and the number of
   * files that hit it. A number on its own cannot be acted on; a language and a message can.
   */
  grammarsUnavailable: Map<StructuralLanguage, { error: string; files: number }>;
}

export function newCounters(): StructuralCounters {
  return {
    treesBuilt: 0,
    noAdapter: 0,
    grammarUnavailable: 0,
    parseFailed: 0,
    skippedTooLarge: 0,
    findingsOutOfRange: 0,
    skippedPartialSource: 0,
    candidatesAdded: 0,
    candidatesDuplicate: 0,
    candidatesDroppedByMatchWithout: 0,
    grammarsUnavailable: new Map(),
  };
}

const NOTHING = (): void => {};

function outcome(
  o: Exclude<ParseOutcome, "parsed">,
  language: StructuralLanguage | null,
  session?: ParseSession,
): ParseResult {
  if (session) releaseSession(session);
  return { tree: null, language, outcome: o, release: NOTHING };
}

function adapt(language: StructuralLanguage, source: string, session: ParseSession): IrNode[] {
  switch (language) {
    case "html":
      return parseHtml(source, session);
    case "markdown":
      return parseHtml(maskMarkdown(source), session);
    case "mustache":
      return parseHtml(maskTemplateTags(source), session);
    case "erb":
      return parseErb(source, session);
    case "blade":
      return parseBlade(source, session);
    case "haml":
      return parseHaml(source, session);
    case "slim":
      return parseSlim(source, session);
    case "pug":
      return parsePug(source, session);
    case "tsx":
      return parseJsx(source, "tsx", session);
    case "ts":
      return parseJsx(source, "ts", session);
    case "heex":
      return parseHeex(source, session);
    case "elixir":
      return parseElixir(source, session);
  }
}

export function parseForStructure(
  relPath: string,
  source: string,
  counters: StructuralCounters,
  allowanceMs: number = STRUCTURAL_ALLOWANCE_MS,
): ParseResult {
  const language = languageFor(relPath);
  if (language === null) {
    // "The structural side found nothing here" and "the structural side cannot read this" are
    // different answers, and adding them together is how a hole becomes invisible.
    counters.noAdapter++;
    return outcome("no-adapter", null);
  }
  if (Buffer.byteLength(source, "utf8") > MAX_STRUCTURAL_BYTES) {
    counters.skippedTooLarge++;
    return outcome("too-large", language);
  }

  const session = newSession(allowanceMs);
  setWalkingSession(session);
  try {
    const tree = adapt(language, source, session);
    counters.treesBuilt++;
    return { tree, language, outcome: "parsed", release: () => releaseSession(session) };
  } catch (e) {
    if (e instanceof ParseBoundError) {
      // Counted with the files whose parse threw, because that is what this count says - files the
      // structural reading could not read - and it is the count the scan already prints. The engine
      // names the file in `files_partially_read` from `bounded`.
      counters.parseFailed++;
      releaseSession(session);
      return {
        tree: null,
        language,
        outcome: "parse-bounded",
        bounded: { allowanceMs: e.allowanceMs, elapsedMs: e.elapsedMs },
        release: NOTHING,
      };
    }
    if (e instanceof GrammarUnavailableError) {
      counters.grammarUnavailable++;
      const seen = counters.grammarsUnavailable.get(language);
      if (seen) seen.files++;
      else counters.grammarsUnavailable.set(language, { error: `${e.grammar}: ${e.message}`, files: 1 });
      return outcome("grammar-unavailable", language, session);
    }
    counters.parseFailed++;
    return outcome("parse-failed", language, session);
  } finally {
    setWalkingSession(null);
  }
}

/**
 * The answer for a file the minification ceiling reduced (`walk.ts blankLongLines`).
 *
 * **Why the structural reading is refused on a partially read file, and `match` is not.** A blanked
 * line is decided by the line reading exactly as an empty line is — it matches nothing, corroborates
 * nothing and can be quoted by nothing — and that is a decision taken from the line alone. A parse
 * tree is not: an emptied line closes no tag it opened, leaves the brace it opened open, and the
 * tree the grammar then produces is a tree of a document that does not exist. A check reading that
 * tree would report structure the file does not have, at line numbers that are real.
 *
 * `no-adapter` is still answered FIRST and still counted as itself, because "this language has no
 * structural reading" is true of the file whether or not a line was blanked, and it is the answer
 * the great majority of these files get: of the 1,151 files the ceiling touched across fifteen
 * corpus trees, the largest groups are `.php`, `.js` and `.svg`.
 *
 * Nothing is lost by refusing. Every such file was read to NO rule at all before 2026-09-07, so the
 * structural side never had a tree for one of them to lose.
 */
export function refuseForPartialSource(relPath: string, counters: StructuralCounters): ParseResult {
  const language = languageFor(relPath);
  if (language === null) {
    counters.noAdapter++;
    return outcome("no-adapter", null);
  }
  counters.skippedPartialSource++;
  return outcome("partial-source", language);
}

/** Which grammars a language needs, for a caller that wants to report on coverage. */
export { GRAMMARS_FOR };
