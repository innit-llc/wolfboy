/**
 * The mechanical check that every quotation in a layer-2 record is really in the file it names.
 *
 * ## What this is, and what settled it
 *
 * The design, decided 2026-09-05: "Every verdict's `evidence[].quote` is mechanically checked
 * against the real file, and a verdict whose quote fails the check is invalidated and routed to
 * `needs_human`. The check **shares the existing implementation** in
 * `product/packages/cli/src/reconcile-verify.ts` — the waterfall that `reconcile-verify` and
 * `questionnaire verify` already both call rather than copy — and no second copy is written."
 *
 * Until this file existed, `verdict.schema.json` required a `quote`, said it must be verbatim, and
 * nothing looked: a fabricated string satisfied the schema exactly as well as a real one, and "a
 * verdict without a quote is void" was a sentence in a prompt. That is the same gap
 * `reconcile-verify` was written to close for pillar 2, one pillar over.
 *
 * ## Three seats, one pass
 *
 * | seat | file | its evidence |
 * |---|---|---|
 * | adjudicator | `.legal/verdicts/<n>-<key>.json` | `evidence[]`, required by `verdict.schema.json` |
 * | refuter | `.legal/verdicts/refutation/<id>.json` | `evidence[]`, asked for by its brief; the schema had no field for it until 2026-09-17 |
 * | silence investigator | `.legal/verdicts/silence/<batch>.json` | `evidence[]`, required for `construct_found` |
 *
 * A quotation is a quotation whatever seat typed it, so one pass reads all three. The seat decides
 * only which word an invalidated record's class field takes.
 *
 * ## The mapping, and the one place it differs from pillar 2
 *
 * The waterfall reaches five statuses. Four of them mean the text is NOT in the file the record
 * named — which is not a reading of the words but of the control flow: `verifyOneQuote` searches the
 * named source first and returns if it matches at any tier, so `re_attributed` and `ambiguous` are
 * reachable only when it did not.
 *
 *   confirmed_at_declared              -> confirmed
 *   repaired, fallback false           -> repaired     (the text IS in the named file; a line drifted)
 *   repaired, fallback true            -> invalidated  (only the first line exists; the rest is nowhere)
 *   re_attributed                      -> invalidated  (the text is in a DIFFERENT file)
 *   ambiguous                          -> invalidated  (the text is in several others; no position at all)
 *   unverifiable                       -> invalidated  (found nowhere — the design's own floor)
 *   no evidence at all                 -> per seat: see `evidenceIsRequired`. A verdict must carry
 *                                          one in every direction; an `apparently_absent` silence
 *                                          row has nothing to quote BY DESIGN; a refutation's
 *                                          evidence field did not exist before 2026-09-17.
 *
 * **Why `re_attributed` invalidates here and repairs there.** A pillar-2 report cites a developer's
 * own published documents, and finding a sentence one document over is a citation slip. A layer-2
 * child holds up to seventy locations from up to three rules across several files in one payload
 * (SKILL.md step 4), and a quotation that really lives in a different file of that payload is the
 * thing the skill's own sentence warns about — "stale context from one file leaks into the next and
 * corrupts the verdict" — with the leak on the page. It must not pass as confirmed, and it must not
 * pass as repaired either.
 *
 * **The honest counter-case is a model that quotes correctly and mistypes the path**, which packing
 * makes likelier rather than rarer. That verdict is invalidated and becomes `needs_human`: it does
 * not reach the user as a candidate, and it does not leave the report — `needs_human` is reported
 * and marked for review. The direction that loses a finding from the report body is the one the design
 * calls dangerous, and this mapping never goes that way. The row records `final.source`, the file
 * the text really is in, so a path slip reads as a path slip and not as a fabrication.
 *
 * **The path is never repaired the way the position is.** Repairing a position leaves the record
 * consistent: same text, same file, corrected line, and the child's reasoning still describes what it
 * read. Repairing a path would rewrite the record into a claim nothing supports — the reasoning names
 * one file and the evidence another — silently, inside the mechanism whose purpose is to make a
 * silent defect visible.
 *
 * ## What is never done here
 *
 * **Nothing is deleted and nothing is re-adjudicated.** The record, its reasoning and its quotations
 * are carried verbatim; the class field is moved and the original is kept beside it. Deciding what to
 * do about an invalidated record belongs to the orchestrator and to the reader, exactly as
 * `reconcile-verify` leaves an unverifiable claim where the agent put it.
 *
 * **The inputs are not written to.** The annotated copy goes to its own path.
 *
 * **`.legal/` is never opened.** An evidence path there cites another agent's output — the
 * orientation notes a model wrote, this run's own findings document, and since unit D every other
 * child's verdict and reasoning. A quotation of that is not a quotation of the user's code, and a
 * verdict quoting the file it is written into would confirm against itself at T1.
 *
 * ## What this does NOT establish
 *
 * The design, in its own words: a weaker adjudicating model "also produces **correctly quoted wrong
 * judgments**, which the quote check cannot catch by construction". A run that exits 0 has
 * established that every quotation is real and in the file it names, and nothing about whether it
 * supports the verdict. Two files carrying an identical line confirm in whichever one the record
 * names, so this bounds the leak rather than closing it.
 *
 * ## Determinism
 *
 * No clock, no randomness, no environment read. Two runs over the same records and the same tree
 * produce byte-identical output, which is what lets a gate compare one run against the next.
 */

import { createHash } from "node:crypto";
import { projectFileDigest } from "./redaction-key.js";
import { readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { relativePath } from "./project-path.js";
import { programFileBytes } from "./program-file.js";
import type {
  Candidate,
  EvidenceLog,
  Findings,
  QuoteCheck,
  Verdict,
  VerdictQuoteOutcome,
  VerdictQuoteRecord,
  VerdictQuoteReport,
  VerdictQuoteSummary,
  VerdictSeat,
} from "wolfboy-schemas";
import { decodedTextIsBinary } from "./walk.js";
import { LINE_REFERENCE, PLACE_GATE_KINDS, dismissalOutsideVerdictProblems, recordCoverageGaps, type ReadingCoverageGap } from "./reading.js";
import { compileSchemaValidator, schemaDocument } from "./schema-validate.js";
import { redactionMarkerRe, restoreProgramMarkers, type PrintedRedaction } from "./credential-redaction.js";
import {
  EXIT_ALL_VERIFIED,
  EXIT_NOT_FULLY_VERIFIED,
  QUOTE_STATUSES,
  QUOTE_VERIFIER_VERSION,
  besideWindow,
  buildCodeCorpus,
  countQuoteChecks,
  FRAGMENT_COLLAPSE_MIN_LENGTH,
  parseEvidenceLines,
  placeRun,
  resolveUnderTarget,
  T3_MAX_TOTAL_SPAN,
  verifyOneQuote,
  type RunPlacement,
  type RunWindow,
} from "./reconcile-verify.js";
import { decodeSourceText, readRegularFile } from "./project-read.js";
import { VERDICT_SET_FIELD, verdictSetRecordsOf, type VerdictSetKind } from "./verdict-set.js";

/**
 * Bumped whenever the status-to-outcome mapping above changes, so a reader of a
 * `verdict-quotes.json` can tell which behaviour produced it. Its own number, beside
 * `QUOTE_VERIFIER_VERSION`: the two share an algorithm, not a lifecycle — the tiers can change
 * without the mapping changing, and the mapping can change without a tier moving.
 *
 * 2 (fix/quote-elision, 2026-09-25): a quotation with no content of its own is invalidated whatever
 * its status; the elided-quotation clause reads touching markers, places parts by character position
 * and short parts by their neighbours; and `reading.read[]` rows are asked all of it. A row's
 * `status` is unchanged by any of this — only the outcome a record takes from it. Still 2 after a later change,
 * because 2 was never released: an empty quotation is
 * not asked for content, the anchor must carry content, a comment-wrapped marker line is an elision
 * read literal-first, and a seat's copy of this tool's own annotations is removed.
 *
 * 3 (fix/quote-check-small-differences, 2026-09-29): every quotation this file checks asks the shared
 * waterfall for tier T2n (`formatting: true`), so one that differs from its file only in formatting — a
 * space the file has before a list comma, a typographic quote mark or dash, a Unicode form that makes no
 * ASCII character — is found where it is and no longer invalidates its record. Live run 2 lost the
 * Gravatar record to one such space. A fix narrowed the whitespace T2n sets aside to
 * that one shape, after a check showed eighteen quotations confirmed whose spacing is syntax;
 * the number stays 3 because the first version was never merged. The status-to-outcome table above is
 * unchanged; the shared `QUOTE_VERIFIER_VERSION` stays 1 because the two callers that do not ask for T2n
 * write exactly what they wrote before.
 *
 * 4: how rows fold into a record changed. A failed row
 * that dismisses another location, on a record whose own class keeps its finding, withdraws only that dismissal
 * and is left out of the record's outcome (the direction rule of that date); every failed row
 * is written with its reason and effect (`quote_check_failures`); this program's own redaction markers are
 * restored from the file before a quotation is checked; and T2n runs only in documents and translation files
 * (`formattingKindOf` in reconcile-verify.ts). The shared `QUOTE_VERIFIER_VERSION` stays 1 for the same reason as
 * above: only this caller asks for T2n.
 */
export const VERDICT_QUOTE_MAPPING_VERSION = 4;

/** Re-exported so one caller imports one module. The codes are the two verify commands' own. */
export { EXIT_ALL_VERIFIED, EXIT_NOT_FULLY_VERIFIED };

/** The directory whose contents this run wrote, and which therefore proves nothing about the code. */
const AGENT_OUTPUT_DIR = ".legal";

/**
 * The collapsed length under which the shared code already calls a match thin (`SHORT_QUOTE_THRESHOLD`
 * there). Restated as a test on the note rather than as a second constant: the number lives in
 * `reconcile-verify.ts` and this file reads the note it produces, so the two cannot drift.
 */
const SHORT_QUOTE_NOTE_PREFIX = "short-quote:";

/**
 * A bracketed token naming a redaction, which a child writes in place of a live credential.
 *
 * **What it is, and why it is disclosed rather than acted on.** Both recorded runs carry it: a
 * secret-detection verdict quotes the line it found and puts `[REDACTED - 64-character value,
 * verbatim in config/.env.dev]` where the value is. The child is right not to copy a live
 * credential into a report, and the quotation is then NOT VERBATIM by the child's own account, so
 * nothing mechanical can confirm it and it comes back `unverifiable`.
 *
 * The outcome is unchanged and it is the correct one — a live-credential finding that a person must
 * look at is exactly `needs_human`. What changes is the SENTENCE: "found nowhere" reads as a
 * possible fabrication, and this is not one. Trusting the marker to excuse the quotation is the one
 * thing that must not happen, because a marker is a string the same model typed.
 */
/**
 * M1 of an internal record: does `quote` carry a redaction marker (one definition,
 * credential-redaction.ts `REDACTION_MARKER_SOURCE`) that is not the named file's own text? Before, any bracket followed
 * by "redact" counted, so ordinary code (`logger.info(redactSecret(cfg))`) and a misquoted line of a file's own
 * `"[REDACTED]"` literal were said to carry a marker, though they were compared and are in no file.
 */
function carriesMarker(quote: string, fileText: string | undefined): boolean {
  for (const m of quote.matchAll(redactionMarkerRe())) if (fileText === undefined || !fileText.includes(m[0])) return true;
  return false;
}

/* --------------------------------------------------------------------------------------------- *
 * THE ELISION PATH — a confirming clause ADDED beside the waterfall, never a floor removed from it.
 *
 * WHAT AN ELIDED QUOTATION IS — defined here and nowhere else (fix/quote-elision, 2026-09-25, after
 * the second confidence check found three real quotations refused, each for a different one of
 * the clause's own rules):
 *
 *  1. MARKERS. `...` (three or more dots) and `…`, bare or bracketed (`[...]`, `(...)`), on a line of
 *     their own, at the head of a line, or inline — spaced or touching the text; and a marker wrapped
 *     in a comment token on a line of its own (`// ...`, `# ...`, ` * ...`, a block comment holding
 *     only the marker), which is how a model quoting code writes its elision in that language.
 *  2. A bare or bracketed marker on a line of its own, at the head of a line, or inline with
 *     whitespace on both sides is an elision (`elisionSegments`). EVERY OTHER MARKER — one that
 *     touches its text, a bracketed one inside a line, or a comment-wrapped one on a line of its own —
 *     IS READ AS THE FILE'S OWN CHARACTERS FIRST, and as an elision only where the file does not have
 *     them there (`elidedParts`, `checkElision`). That is what tells `'phc_...'` (an elided key) from
 *     `{ ...payload }` (a spread) without a spelling rule, and it is why no quotation that passed
 *     before can fail on it: a part the file has as written is placed as written. The comment-wrapped
 *     line joined this group later: the inline split cut its token off and left `//`
 *     or `#` on the part before, so a real quotation was refused; it is literal-first because a
 *     comment line of dots is ordinary text in a file (a code sample's `// ...`, a config's `# ...`).
 *     Every marker is literal-first for the WHOLE quotation too: the flat search runs first, so a
 *     quotation the file holds as written never reaches this clause.
 *  3. PLACEMENT BY CHARACTER POSITION. The first part long enough to be placed on its own goes to its
 *     occurrence nearest the first declared line; every later part to its first occurrence starting at
 *     or after the END of the part before it — on the same line, when it is there (`placeRun`).
 *  4. SHORT PARTS ARE PLACED BY THEIR NEIGHBOURS, NOT BY A FLOOR. A part under
 *     `FRAGMENT_COLLAPSE_MIN_LENGTH` characters is never searched for on its own. Between two parts
 *     that can be placed, it is held by both: its first occurrence after the part before it, with the
 *     part after it then found after it (ORDER). With a neighbour on one side only — at the tail, or at
 *     the head before anything placeable — it must be exactly where that neighbour leaves off: the
 *     rest of that line or the next non-blank line, or for the head the mirror of that (ADJACENCY,
 *     `besideWindow`). THE ANCHOR: at least one part must be long enough to be placed on its own AND
 *     carry content (5). A bare keyword can be placed wherever such a keyword occurs, and a short part
 *     beside it then shows nothing (`return ... ip` was admitted on a file whose only `ip` is inside `zipCode`).
 *  5. CONTENT — ONE PREDICATE OVER A PIECE, SHARED BY TWO CLAUSES. Whether a piece of a quotation
 *     carries content of its own is `contentlessReason`, decided there and nowhere else (an unbroken
 *     quotation is one piece). The two clauses that ask it are the contentless rule and the anchor (4):
 *     - the contentless rule (`decideRow`): a quotation none of whose pieces carries content is invalidated whatever
 *       the search found, and listed in `contentless_quotes`. It is asked of the quotation as one
 *       piece before the search, and — where the flat search failed and the quotation is read as
 *       elided — of the pieces that reading cuts it into (`checkElision` reports them). It is asked
 *       ONLY OF A NON-EMPTY QUOTATION: an empty one is invalidated and explained by the waterfall's own
 *       reason, and calling it "punctuation only" was false (run 1's trail rows, which carry no quotation at all, were listed as carrying no content).
 *     - The anchor: a piece placed on its own that carries content by the same predicate.
 *     Until verification N1-N2 the two were decided apart, the content test passing on ANY piece and
 *     the anchor on ANY placeable one, so `return ... ip` met both with different pieces.
 *
 * WHAT STILL INVALIDATES IT: a part that is not in the file the entry names (nowhere, or only in
 * another file — the context leak this unit exists to catch); a part that is in that file only before
 * the part written ahead of it (out of order); a short part at either end that is not where its
 * neighbour leaves off; parts spread wider than the entry's declared span plus `T3_MAX_TOTAL_SPAN`
 * lines; no part that both carries content and can be placed on its own; no piece that carries
 * content at all.
 * --------------------------------------------------------------------------------------------- */

/**
 * A line that is nothing but an elision marker, or begins with one.
 *
 * The forms measured on real records: a line of `...`, a line of `[...]`, the single character
 * U+2026, and a marker followed by the next quoted line on the same line. Bracketed and
 * parenthesised forms are included because both appear; a comment-prefixed form is included because
 * a model quoting code often writes its elision as a comment in that language. A line that is ONLY a
 * comment-wrapped marker is not split by these: it is literal-first (`isCommentMarkerLine`).
 */
/*
 * Both elision-line patterns are written with each optional token carrying the whitespace AFTER it. The
 * form they replace, `^\s*TOKEN?\s*BRACKET?\s*MARKER`, has three whitespace runs side by side wherever the token and
 * the bracket are absent, and on a line of spaces with no marker the engine tried every way of sharing the spaces
 * among them: 42 s on 4,000 spaces and a bracket. The language is the same (whitespace, then each optional token with
 * the whitespace after it), and so is every match: nothing follows the marker's own run that could fail.
 */
const ELISION_LEAD_RE = /^\s*(?:(?:\/\/|#|\/\*|\*)\s*)?(?:[[(]\s*)?(?:\.{3,}|…)\s*(?:[\])]\s*)?(?:\*\/\s*)?/;
/** The same, anchored to the whole line: the line carries a marker and nothing else. */
const ELISION_ONLY_RE = /^\s*(?:(?:\/\/|#|\/\*|\*)\s*)?(?:[[(]\s*)?(?:\.{3,}|…)\s*(?:[\])]\s*)?(?:\*\/\s*)?$/;

/**
 * A line holding a comment-wrapped marker and nothing else: `// ...`, `# ...`, ` * ...`, a block
 * comment holding only the marker, spaced or not. The only characters `ELISION_ONLY_RE` admits
 * besides the marker, its brackets and whitespace are the comment tokens, so a `/`, `#` or `*` on
 * such a line is the token.
 *
 * **Literal-first, and why it is decided here.** The inline split
 * below needs whitespace before a marker, so `      // ...` lost its ` ...` to it and left `      //`
 * as a line of text on the part before — which the file does not have there, so a real quotation was
 * refused. Such a line is therefore taken out of the inline split and left in its part as text;
 * `elidedParts` cuts the part at it, and `checkElision` reads the part as written first and cuts it
 * only where the file does not hold the line there (definition, 2).
 */
function isCommentMarkerLine(line: string): boolean {
  return ELISION_ONLY_RE.test(line) && /[/#*]/.test(line);
}

/**
 * A marker left INSIDE a part once the unambiguous markers have split it: bare or bracketed, with the
 * horizontal whitespace on either side of it, which comes out with it for the reason given at the
 * inline split below (a space the file does not have costs T1 a real match).
 */
// The leading whitespace is taken only from the start of its run (`(?<![ \t])`), or not at all where none precedes the
// marker (`(?![ \t])`): a marker can only follow a run's last space, so a run that fails from its start fails from every
// later position in it, and the form this replaces read it again from each one. Same matches, same split.
const SOFT_MARKER_RE = /(?:(?<![ \t])[ \t]+|(?![ \t]))(?:\[[ \t]*(?:\.{3,}|\u2026)[ \t]*\]|\([ \t]*(?:\.{3,}|\u2026)[ \t]*\)|\.{3,}|\u2026)[ \t]*/g;

/**
 * The contiguous runs of a quotation, split at its UNAMBIGUOUS elision markers. One element means no
 * such marker (a quotation may still carry a touching marker: see `elidedParts`).
 *
 * Exported so the gate pins the splitting itself: a gate that can only see the end-to-end result
 * cannot tell a splitting change from a fixture change.
 */
export function elisionSegments(quote: string): string[] {
  /* **An INLINE marker needs whitespace on both sides to split here unconditionally.** A model writes
   * its elision as a spaced `...` between two real runs of the same line — `:choose_plan ... get
   * "/:domain/settings/goals"` — while `{ ...payload` is a spread and `PVG100...'` sits inside a regex
   * literal. A touching marker is therefore not split HERE: `elidedParts` reads it as the file's own
   * characters first and as an elision only where the file does not have them (fix/quote-elision,
   * 2026-09-25 — before that it was never an elision at all, and `posthog.init('phc_...',{…})`, a real
   * line with its project key shortened, was refused for it). The line-leading form below needs no
   * such guard because a line that begins with a marker is already unambiguous. */
  /* **THE MARKER'S OWN SPACES COME OUT WITH IT, and the first version left them on the parts.** The
   * lookaround form used before — `(?<=\s)marker(?=\s)` — asserts the whitespace without consuming
   * it, so `>Hotjar ... aria-label=…` split into `>Hotjar ` and ` aria-label=…`, each carrying a
   * space the file does not have. T1 then fails on text that IS there: measured by independent
   * verification on plausible `eu-consent-005`, where `>Hotjar ` is unverifiable and `>Hotjar` is
   * found at line 1976, the very line the record declares — one of that run's invalidations was this
   * clause's own defect rather than the model's. 52 of that record's 57 split parts carried such an
   * edge space.
   *
   * The horizontal whitespace on each side is therefore part of the match. `[ \t]+` BEFORE the marker
   * keeps a touching marker out of this split, and the lookahead requires whitespace after it —
   * including a line ending. Vertical whitespace is left alone: a marker that begins a line is the
   * other path's. */
  /* **A comment-wrapped marker line is kept whole, out of the inline split** (see
   * `isCommentMarkerLine`): the split runs line by line and passes such a line through untouched.
   * Every other line is split exactly as before \u2014 per line or on the whole text is the same thing,
   * since the whitespace before a marker never crosses a line break. */
  const lines = quote
    .replace(/\r\n|\r/g, "\n")
    .split("\n")
    .flatMap((line) =>
      isCommentMarkerLine(line)
        ? [line]
        : line.replace(/(?<![ \t])[ \t]+(?:\.{3,}|\u2026)(?=[ \t]|\n|$)[ \t]*/g, "\n\u0000ELISION\u0000\n").split("\n"),
    );
  const segments: string[][] = [[]];
  let sawMarker = false;
  const start = () => {
    if (segments[segments.length - 1].length > 0) segments.push([]);
  };
  for (const line of lines) {
    if (line === "\u0000ELISION\u0000") {
      sawMarker = true;
      start();
      continue;
    }
    // Literal-first: it stays in its part as text, and `elidedParts` cuts the part at it. It is not
    // one of the unambiguous markers this function splits at, so it does not set `sawMarker`.
    if (isCommentMarkerLine(line)) {
      segments[segments.length - 1].push(line);
      continue;
    }
    if (line.trim() !== "" && ELISION_ONLY_RE.test(line)) {
      sawMarker = true;
      start();
      continue;
    }
    const m = ELISION_LEAD_RE.exec(line);
    // A marker with text after it on the same line starts a new run, and the text after it is the
    // first line of that run. The `trim() !== ""` guard is what stops the optional groups from
    // matching the empty string at the head of every ordinary line.
    if (m && m[0].trim() !== "" && line.trim() !== "") {
      sawMarker = true;
      start();
      const rest = line.slice(m[0].length);
      if (rest.trim() !== "") segments[segments.length - 1].push(rest);
      continue;
    }
    segments[segments.length - 1].push(line);
  }
  if (!sawMarker) return [quote];
  /* **Leading and trailing blank lines come off each part, and a part is not a part without that.**
   * The inline split above puts a newline on either side of the marker so that one code path handles
   * both forms, which leaves an empty line at the head or foot of the neighbouring parts. An empty
   * first line is not whitespace the tiers forgive — T1 searches for the text as written — so a part
   * that verified under the line-only split stopped verifying under the inline one, on a real
   * verdict. Blank lines INSIDE a part are kept: they are part of the passage. */
  return segments.map(trimBlankLines).filter((seg) => seg.trim() !== "");
}

function trimBlankLines(seg: string[] | string): string {
  // Two index scans: `/\n+$/` read a run of line breaks again from each of its positions.
  const t = Array.isArray(seg) ? seg.join("\n") : seg;
  let a = 0;
  while (a < t.length && t.charCodeAt(a) === 10) a++;
  let b = t.length;
  while (b > a && t.charCodeAt(b - 1) === 10) b--;
  return t.slice(a, b);
}

/** One part of an elided quotation: its text as written, and the pieces it becomes when a marker
 * that touches its text is read as an elision. `soft` says whether it carries a literal-first marker.
 * A part holding comment-wrapped marker lines also has `subparts`: the runs between those lines, each
 * read the same way, so that cutting at a comment line never cuts at a touching marker as well (a
 * spread beside `// ...` stays text); `pieces` is then theirs, in order. */
export interface ElidedPart {
  text: string;
  soft: boolean;
  pieces: string[];
  subparts?: ElidedPart[];
}

/**
 * The whole shape of a quotation as this clause reads it: the parts between its unambiguous markers,
 * each with the pieces its literal-first markers would cut it into. `elided` is false only for a
 * quotation with no marker of any kind.
 */
export function elidedParts(quote: string): { elided: boolean; parts: ElidedPart[] } {
  const segments = elisionSegments(quote);
  const hard = segments.length > 1 || segments[0] !== quote;
  const parts = segments.map(readPart);
  return { elided: hard || parts.some((p) => p.soft), parts };
}

function readPart(text: string): ElidedPart {
  const lines = text.replace(/\r\n|\r/g, "\n").split("\n");
  if (lines.some(isCommentMarkerLine)) {
    const runs: string[][] = [[]];
    for (const line of lines) {
      if (isCommentMarkerLine(line)) runs.push([]);
      else runs[runs.length - 1].push(line);
    }
    const subparts = runs
      .map(trimBlankLines)
      .filter((run) => run.trim() !== "")
      .map(readPart);
    return { text, soft: true, pieces: subparts.flatMap((s) => s.pieces), subparts };
  }
  const soft = new RegExp(SOFT_MARKER_RE.source).test(text);
  const pieces = soft ? text.split(SOFT_MARKER_RE).map(trimBlankLines).filter((p) => p.trim() !== "") : [text];
  return { text, soft, pieces };
}

/* --------------------------------------------------------------------------------------------- *
 * A quotation that carries no content of its own.
 * --------------------------------------------------------------------------------------------- */

/** The words a record writes where it has no quotation to give: the null words of the common
 * languages, and the placeholders. Lower case; matched against a single bare word. */
const PLACEHOLDER_WORDS = new Set([
  "null", "nil", "none", "undefined", "void", "nan", "n/a", "na", "tbd", "todo", "empty", "nothing", "unknown",
]);
/** The words that are structure rather than names — every code file has them, and a quotation of one
 * says nothing about which. Lower case; matched against a single bare word. */
const BARE_KEYWORDS = new Set([
  "true", "false", "else", "elif", "elsif", "elseif", "end", "endif", "fi", "then", "do", "done", "esac",
  "begin", "return", "break", "continue", "pass",
]);

/**
 * Why ONE PIECE of a quotation carries no content of its own — punctuation only, a placeholder, or a
 * bare keyword — or null when it carries some. An unbroken quotation is one piece.
 *
 * **The one predicate (definition, 5).** The contentless rule and the anchor both ask it, and nothing else in this file
 * decides whether text carries content (the two used to decide it apart).
 *
 * **Why this exists**. The waterfall's T1 has no
 * floor, so a quotation written as `-`, `null` or `none` was confirmed wherever those characters
 * occur in the named file, and a verdict stood on a quotation that says nothing. Such a quotation is
 * refused whatever the search says — the search is not what is wrong with it. The test is on the
 * WHOLE quotation, or, for an elided one, on every part at once: a short part INSIDE an otherwise real
 * quotation (`nil` after `else`, between two longer parts) is ordinary and stays admissible.
 *
 * It is not a length floor: `.env`, `24.14.0`, `email,` and `'symptomatic',` carry content and are
 * short; `null` is four characters and carries none. The lists are the definition, stated once, here.
 *
 * **WHAT IT LETS THROUGH — disclosed, not refused.** The lists are closed, so a
 * piece that is none of the three is content by this definition although it names nothing:
 *   - digits only: `0`, `1`, `42`;
 *   - one letter: `a`;
 *   - a keyword of a language not on the lists: `if`, `let`, `this`, `self`, `import`;
 *   - two or more content-free words: `end end`, `return nil`;
 *   - a placeholder in another language: the Japanese word for "none" (U+306A U+3057).
 * Refusing them would be a new invalidation beyond the contentless rule's recorded subset, and outside that subset the
 * recorded line is disclosure, never rejection. When such a quotation is matched and collapses to
 * under eight characters, `short_quotes` names it as it names any short quotation; `return nil` and
 * longer runs of such words are named nowhere.
 */
/** One code point that is a letter or a number. */
const LETTER_OR_NUMBER = /^[\p{L}\p{N}]$/u;

/**
 * `text` with every code point that is not a letter or a number taken off both ends: what
 * `replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")` returns, found by two scans over code points instead. That
 * pattern's second branch read a punctuation run again from each of its positions when a letter followed it, about
 * 26 ms on one 5,000-character quotation. A surrogate pair is one code point either way.
 */
function trimToLettersAndNumbers(text: string): string {
  let a = 0;
  while (a < text.length) {
    const cp = text.codePointAt(a) as number;
    if (LETTER_OR_NUMBER.test(String.fromCodePoint(cp))) break;
    a += cp > 0xffff ? 2 : 1;
  }
  let b = text.length;
  while (b > a) {
    const lo = text.charCodeAt(b - 1);
    const pair = lo >= 0xdc00 && lo <= 0xdfff && b - 2 >= a && text.charCodeAt(b - 2) >= 0xd800 && text.charCodeAt(b - 2) <= 0xdbff;
    const cp = text.codePointAt(pair ? b - 2 : b - 1) as number;
    if (LETTER_OR_NUMBER.test(String.fromCodePoint(cp))) break;
    b -= pair ? 2 : 1;
  }
  return text.slice(a, b);
}

export function contentlessReason(text: string): string | null {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!/[\p{L}\p{N}]/u.test(collapsed)) return "punctuation only";
  const word = trimToLettersAndNumbers(collapsed).toLowerCase();
  if (word.includes(" ")) return null;
  if (PLACEHOLDER_WORDS.has(word)) return "a placeholder";
  if (BARE_KEYWORDS.has(word)) return "a bare keyword";
  return null;
}

/* --------------------------------------------------------------------------------------------- *
 * Checking an elided quotation against the file it names.
 * --------------------------------------------------------------------------------------------- */

/** What the clause asks of the scope, supplied by the caller so that the shared waterfall is called
 * rather than copied. */
export interface ElisionTools {
  /** The shared waterfall over the whole scope: whether a text is in the named file, in another file,
   * or nowhere. `anchor` is the line its nearness tie-break and T3 are anchored on. */
  find(text: string, anchor: number[]): QuoteCheck;
  /** Where a text sits inside a window of one file, through the same tiers (`placeRun`). */
  place(source: string, text: string, window: RunWindow): RunPlacement | null;
  /** Where a short part may sit: right where its neighbour leaves off (`besideWindow`). */
  beside(source: string, offset: number, side: "after" | "before"): { from: number; to: number } | null;
}

/**
 * Whether an elided quotation is true about the file it names, checked part by part.
 *
 * ## The reading that put this here
 *
 * The first real record this check was pointed at — one tree, 2026-09-02, 97 verdicts and 70 silence
 * rows — produced 24 failing quotation rows, and TWENTY OF THEM ARE ONE SHAPE: a quotation whose two
 * or three parts are each byte-real in the file it names, joined by a literal `...` or `[...]` the
 * model wrote to mean "and further down". Under the waterfall alone every one of those lands on the
 * first-line fallback, which is the same place a REAL first line with an INVENTED remainder lands.
 *
 * ## Why this is an addition and not a relaxation
 *
 * EVERY PART MUST BE FOUND, ON ITS OWN, IN THE FILE THE RECORD NAMES, through the same waterfall and
 * the same tiers — so an invented remainder is still not found and the row still fails. What the
 * clause adds is the recognition of a CONSTRUCT the flat search cannot see.
 *
 * ## What changed on 2026-09-25, and what did not
 *
 * The second confidence check read three quotations this clause refused although each is real
 * code at the lines it declares: a touching `...` (`'phc_...'`), a three-character part (`nil`), and a
 * later part on the same line as the part before it (`=> 'groups#show'`). Each was one of the clause's
 * own rules — the inline split's whitespace guard, the four-character floor on every part, the
 * line-granular walk — and the class they share is "a rule that refuses real code by its spelling,
 * its length or its line". They are replaced by the definition at the head of this section. The two
 * floors go (the 24-character floor on the whole and the 4-character floor on every part); what they
 * protected — a fabricated part matching by chance — is kept by where a short part may be, not by
 * whether it may be at all. Unchanged: every part in the named file, in order, spread within the
 * declared span plus 40 lines (`T3_MAX_TOTAL_SPAN`; the parts need not sit inside the declared lines).
 *
 * ## What an admitted elision is worth, and what it is not
 *
 * It is `parts_confirmed`, never `confirmed`: IT DOES NOT ASSERT THAT THE PARTS ARE ADJACENT, and the
 * note on the row says so with the real line of each part.
 */
/** The contentless rule over pieces (definition, 5): the reasons, joined, where none of `pieces` carries content of its own; else null. */
function piecesContentless(pieces: string[]): string | null {
  const empty = pieces.map(contentlessReason);
  return empty.every((reason) => reason !== null) ? [...new Set(empty)].join(", ") : null;
}

/**
 * The contentless rule on the pieces an elided reading cuts `quote` into, asked where no file is named, so that `checkElision` (which
 * needs the named file) is not asked:
 * the reason where the quotation is elided and none of its pieces carries content, else null. Such a row is
 * invalidated already, for naming no file; this lists it in `contentless_quotes` as an unbroken one is.
 */
export function elidedContentless(quote: string): string | null {
  const shape = elidedParts(quote);
  if (!shape.elided) return null;
  const pieces = shape.parts.flatMap((p) => p.pieces);
  return pieces.length === 0 ? "punctuation only" : piecesContentless(pieces);
}

export function checkElision(
  quote: string,
  declaredSource: string,
  declaredLines: number[],
  tools: ElisionTools,
): { admitted: boolean; note: string; lines: number[]; contentless: string | null } {
  const shape = elidedParts(quote);
  if (!shape.elided) return { admitted: false, note: "", lines: [], contentless: null };
  const pieces = shape.parts.flatMap((p) => p.pieces);
  const count = `${pieces.length} part${pieces.length === 1 ? "" : "s"}`;
  const refuse = (why: string, contentless: string | null = null) => ({
    admitted: false,
    note: `the quotation is elided into ${count} and ${why}`,
    lines: [] as number[],
    contentless,
  });
  if (pieces.length === 0) return refuse("none of them has any text in it", "punctuation only");
  /* The contentless rule on the pieces this reading cuts the quotation into: the same predicate `decideRow` asks of the
   * whole (definition, 5). The reason goes back as `contentless`, so the row is listed where the contentless rule lists
   * every other one. It concerns the quotation itself, not the search. */
  const why = piecesContentless(pieces);
  if (why !== null) {
    return refuse(
      `none of them carries content of its own (${why}) — a quotation that names nothing is not evidence of anything, wherever its characters occur`,
      why,
    );
  }
  const isShort = (text: string) => text.replace(/\s+/g, " ").trim().length < FRAGMENT_COLLAPSE_MIN_LENGTH;
  /** Whether a part that can be placed on its own is written after piece `i` — which decides whether a
   * short piece is held by the parts on both sides of it or by its one neighbour only. */
  const longAfter = pieces.map((_, i) => pieces.slice(i + 1).some((p) => !isShort(p)));
  const nearest: RunWindow =
    declaredLines.length > 0 ? { from: 0, pick: { nearLine: declaredLines[0] } } : { from: 0, pick: "first" };

  type Placed = RunPlacement & { part: number; how: "own" | "written" | "after" | "before" | "between" };
  const placed: Placed[] = [];
  /** Short parts written before anything that can be placed on its own; placed backwards from it. */
  let pending: { text: string; part: number }[] = [];
  /** Where the last placed part ends; -1 while nothing is placed. */
  let cursor = -1;
  let k = 0;
  /** Whether a part placed on its own carries content: THE ANCHOR (definition, 4 and 5). */
  let anchored = false;
  const lineOfCursor = () => placed[placed.length - 1].endLine;

  /* A run long enough to be placed on its own: at its first occurrence starting at or after the end of
   * the part before it — on the same line when it is there — or, for the first, nearest the first
   * declared line. The tie-break among REAL occurrences is never a reason to accept one. */
  const placeOwn = (source: string, text: string) =>
    tools.place(source, text, cursor < 0 ? nearest : { from: cursor, pick: "first" });
  /** Record a run placed on its own, first placing any short parts written before it. `text` is what
   * was placed, and it anchors the rest only if it carries content. */
  const settle = (at: RunPlacement, part: number, how: Placed["how"], text: string): ReturnType<typeof refuse> | null => {
    if (cursor < 0 && pending.length > 0) {
      let edge = at.start;
      const before: Placed[] = [];
      for (let i = pending.length - 1; i >= 0; i--) {
        const w = tools.beside(declaredSource, edge, "before");
        const p = w ? tools.place(declaredSource, pending[i].text, { from: w.from, to: w.to, pick: "last" }) : null;
        if (!p) {
          return refuse(
            `part ${pending[i].part}, ${JSON.stringify(pending[i].text.trim())}, is under ${FRAGMENT_COLLAPSE_MIN_LENGTH} characters — too short to be placed on its own — and it is not where part ${pending[i].part + 1} begins (earlier on line ${i === pending.length - 1 ? at.startLine : before[0].startLine} or the non-blank line above), so nothing ties it to this passage`,
          );
        }
        before.unshift({ ...p, part: pending[i].part, how: "before" });
        edge = p.start;
      }
      placed.push(...before);
      pending = [];
    }
    placed.push({ ...at, part, how });
    cursor = at.end;
    if (contentlessReason(text) === null) anchored = true;
    return null;
  };

  /** One part: as written first where it carries a literal-first marker; where the file does not hold
   * it so, its subparts (the runs between its comment-wrapped marker lines), each the same way; else
   * its pieces. */
  const walk = (part: ElidedPart): ReturnType<typeof refuse> | null => {
    /* A part carrying a literal-first marker is tried AS WRITTEN first — dots and all — and only where
     * the file does not have it so is the marker read as an elision. A spread, a range, a regex's own
     * `...` or a comment line of dots therefore stays text wherever it is text. */
    if (part.soft && !isShort(part.text)) {
      const asWritten = placeOwn(declaredSource, part.text);
      if (asWritten) {
        const failed = settle(asWritten, k + 1, "written", part.text);
        if (failed) return failed;
        k += part.pieces.length;
        return null;
      }
    }
    if (part.subparts) {
      for (const sub of part.subparts) {
        const failed = walk(sub);
        if (failed) return failed;
      }
      return null;
    }
    for (const piece of part.pieces) {
      k++;
      // Existence, and the wrong-file leak, through the shared waterfall over the whole scope —
      // anchored, as before, on the first declared line and then on where the last part ended.
      const check = tools.find(piece, cursor < 0 ? declaredLines.slice(0, 1) : [lineOfCursor()]);
      if (check.fallback || !check.final || check.final.source !== declaredSource) {
        const elsewhere = check.final && check.final.source !== declaredSource;
        return refuse(
          `part ${k} was ${elsewhere ? `found in a DIFFERENT file, '${check.final?.source}'` : "not found in the file this entry names"} — so the elision does not account for it`,
        );
      }
      const source = check.final.source;
      if (isShort(piece)) {
        /* A SHORT PART IS NEVER PLACED BY ITS OWN CHARACTERS. With nothing placeable before it, it
         * waits and is placed backwards from the first part that is (`settle`). Between two parts
         * that can be placed, it is held by both: it goes to its first occurrence after the part
         * before it, and the part after it must then be found after it — so `<.email_input .../>`
         * finds the `/>` that closes that tag, five lines on. At the tail, with only the part before
         * it to hold it, it must be where that part ends: the rest of that line or the next
         * non-blank line — which is what keeps `else ... nil` from being "found" in a `nil` thirty
         * lines further down. */
        if (cursor < 0) {
          pending.push({ text: piece, part: k });
          continue;
        }
        const tail = !longAfter[k - 1];
        const w = tail ? tools.beside(source, cursor, "after") : { from: cursor, to: undefined };
        const at = w ? tools.place(source, piece, { from: w.from, to: w.to, pick: "first" }) : null;
        if (!at) {
          return refuse(
            tail
              ? `part ${k}, ${JSON.stringify(piece.trim())}, is under ${FRAGMENT_COLLAPSE_MIN_LENGTH} characters — too short to be placed on its own — and it is not where part ${k - 1} ends (later on line ${lineOfCursor()} or the next non-blank line), so nothing ties it to this passage`
              : `part ${k}, ${JSON.stringify(piece.trim())}, is under ${FRAGMENT_COLLAPSE_MIN_LENGTH} characters and does not occur anywhere after the point where part ${k - 1} ends (line ${lineOfCursor()})`,
          );
        }
        placed.push({ ...at, part: k, how: tail ? "after" : "between" });
        cursor = at.end;
        continue;
      }
      const at = placeOwn(source, piece);
      if (!at) {
        return refuse(
          cursor < 0
            ? `part ${k} could not be placed in the file this entry names`
            : `part ${k} is not found after the point where part ${k - 1} ends (line ${lineOfCursor()}) — the file has it only earlier, or only as lines scattered elsewhere, which is not the order the parts are written in; parts that overlap, or that run backwards, are not a quotation of anything`,
        );
      }
      const failed = settle(at, k, "own", piece);
      if (failed) return failed;
    }
    return null;
  };
  for (const part of shape.parts) {
    const failed = walk(part);
    if (failed) return failed;
  }
  if (!anchored) {
    return refuse(
      placed.length === 0
        ? `every one of them is under ${FRAGMENT_COLLAPSE_MIN_LENGTH} characters, so none can be placed on its own and nothing places the rest`
        : `no part that carries content of its own is long enough to be placed on its own — the only parts that are carry none (a bare keyword, a placeholder, punctuation), and such a word can be placed wherever it occurs — so nothing anchors the rest`,
    );
  }
  const at = placed.map((p) => (p.startLine === p.endLine ? `${p.startLine}` : `${p.startLine}-${p.endLine}`)).join(", ");
  const realSpan = placed[placed.length - 1].endLine - placed[0].startLine;
  const declaredSpan =
    declaredLines.length >= 2 ? declaredLines[declaredLines.length - 1] - declaredLines[0] : 0;
  const bound = declaredSpan + T3_MAX_TOTAL_SPAN;
  if (realSpan > bound) {
    return refuse(
      `they really sit at line(s) ${at}, spanning ${realSpan} lines, against the ${bound} this entry's own declared range allows (its span plus the ${T3_MAX_TOTAL_SPAN}-line coherence bound). Parts that far apart are not the passage this entry says it is quoting`,
    );
  }
  const beside = placed.filter((p) => p.how === "after" || p.how === "before").map((p) => p.part);
  const between = placed.filter((p) => p.how === "between").map((p) => p.part);
  const written = placed.filter((p) => p.how === "written").length;
  return {
    admitted: true,
    contentless: null,
    note:
      `elided quotation: ${placed.length} part${placed.length === 1 ? "" : "s"}, each found in ${declaredSource}, at line(s) ${at} in the order written, spread within this entry's declared span plus ${T3_MAX_TOTAL_SPAN} lines (the parts need not sit inside the declared lines)` +
      (beside.length > 0
        ? `; part(s) ${beside.join(", ")} are under ${FRAGMENT_COLLAPSE_MIN_LENGTH} characters and were accepted only where the part beside them leaves off`
        : "") +
      (between.length > 0
        ? `; part(s) ${between.join(", ")} are under ${FRAGMENT_COLLAPSE_MIN_LENGTH} characters and were accepted only between the parts on either side of them`
        : "") +
      (written > 0 ? `; ${written} part(s) carrying a literal-first "..." (touching its text, bracketed, or on a comment line) are in the file as written, dots included` : "") +
      `. THE PARTS ARE NOT ADJACENT and this says nothing about the lines between them — which is the one thing an unbroken quotation shows and this does not.`,
    lines: placed.map((p) => p.startLine),
  };
}

/* --------------------------------------------------------------------------------------------- *
 * The mapping.
 * --------------------------------------------------------------------------------------------- */

/**
 * One quote-check row's own outcome, and why, in words a reader can act on.
 *
 * Exported so the gate pins the mapping itself rather than only its effect on a planted tree: a gate
 * that can only observe the end-to-end result cannot tell a mapping change from a fixture change.
 */
export function outcomeOfCheck(check: QuoteCheck): { outcome: VerdictQuoteOutcome; note: string } {
  const where = `${check.path} (declared ${check.declared.source || "(no file named)"}:${check.declared.lines.join(", ") || "no line"})`;
  if (check.fallback) {
    return {
      outcome: "invalidated",
      note:
        `${where}: only the quotation's FIRST line was found${check.final ? `, in ${check.final.source} at line ${check.final.lines.join(", ")}` : ""}. ` +
        `The rest of its text is nowhere in scope, so that position is an anchor and not a verification — a first line that is real with a remainder that is invented lands exactly here.`,
    };
  }
  switch (check.status) {
    case "confirmed_at_declared":
      return { outcome: "confirmed", note: "" };
    case "repaired":
      return {
        outcome: "repaired",
        note: "",
      };
    case "re_attributed":
      return {
        outcome: "invalidated",
        note:
          `${where}: the text is NOT in the file this entry names and IS in ${check.final?.source ?? "another file"}` +
          `${check.final ? ` at line ${check.final.lines.join(", ")}` : ""}. ` +
          `One child holds several files' candidates at once, so a quotation belonging to a different file of the same payload is a context leak rather than a citation slip, and it is not repaired into the other file: what the record reasoned about and what it quoted would then disagree.`,
      };
    case "ambiguous":
      return {
        outcome: "invalidated",
        note:
          `${where}: the text is NOT in the file this entry names and is in more than one other file in scope, so no position could be asserted for it at all. ` +
          `That is the wrong-file case with the destination unknown, which is weaker than naming one other file and not stronger.`,
      };
    case "unverifiable":
    default:
      return {
        outcome: "invalidated",
        note: `${where}: the quotation was found nowhere this tool could look. ${check.notes.join(" ")}`,
      };
  }
}

/** The weakest of the three, which is what a record takes from its rows. */
function worst(a: VerdictQuoteOutcome, b: VerdictQuoteOutcome): VerdictQuoteOutcome {
  /* `no_evidence` sits beside `confirmed` rather than above it, and it is unreachable through this
   * function anyway: a record with no evidence has no rows for `worst` to fold. The rank exists so
   * the map is total. */
  const rank: Record<VerdictQuoteOutcome, number> = {
    confirmed: 0,
    no_evidence: 0,
    repaired: 1,
    // Above `repaired` because it is the WEAKER claim, and a record says the weakest thing any of its
    // rows will support: a reader must not be told "position corrected" about a record one of whose
    // quotations exists only in parts.
    parts_confirmed: 2,
    invalidated: 3,
  };
  return rank[a] >= rank[b] ? a : b;
}

/** Why one quotation row failed the check, as the report says it in words. */
export type QuoteFailureReason = "not_found" | "other_file" | "several_files" | "first_line_only" | "no_content" | "redacted";

/**
 * One quotation row this check could not confirm, and what its failure does to its record. The
 * report states a demoted finding's reasons from these, and lists a withdrawn dismissal's locations from them; the
 * record's `quote_check_notes` keep the check's full sentences.
 */
export interface QuoteCheckFailure {
  /** The row, relative to its record: `evidence[4]` or `reading.read[10]`. */
  row: string;
  file: string;
  lines: string;
  reason: QuoteFailureReason;
  /**
   * `demotes`: the row folds into the record's outcome, which is then `invalidated`. `withdraws_dismissal`:
   * the row dismissed a location other than the ones the conclusion stands on, on a record that keeps its finding in the
   * report, so only that dismissal is withdrawn.
   */
  effect: "demotes" | "withdraws_dismissal";
  /** For `other_file`: where the text is. */
  found_in?: string;
  /** The census kind the dismissed location belongs to (a trail row's own `kind`, or the trail row an `item` entry pairs with). */
  kind?: string;
}

/**
 * THE CLASS WORD THAT KEEPS A FINDING IN THE REPORT, per seat.
 * Only on such a record can a failed row withdraw its own dismissal instead of
 * demoting the record; every other class word, and every row the conclusion stands on, keeps the whole-record rule.
 */
const KEEPS_FINDING: Record<VerdictSeat, string> = {
  adjudicator: "violation_candidate",
  refuter: "upheld",
  "silence-investigator": "construct_found",
};

/** The reason a failed row is given, from the waterfall's statement and the questions `decideRow` asked. */
/** The two ends of a withdrawn dismissal's note. */
const KEEPS_CLASS = "and the record keeps its class (the quotation check's rule since 2026-09-29)";
const REFUTATION_DEMOTES =
  "but the record does not keep its class: its refutation's rows failed the check and demote it (a failed quotation demotes its record; the change of 2026-09-29 left that reach as it was)";

function failureReason(check: QuoteCheck, quote: string, contentless: boolean, markers: "none" | "no_rule" | "not_found" = "none", fileText?: string): QuoteFailureReason {
  if (contentless) return "no_content";
  if (check.fallback) return "first_line_only";
  if (check.status === "re_attributed") return "other_file";
  if (check.status === "ambiguous") return "several_files";
  /* A seat's own marker, or this program's where the check had no rule to restore it with, is `redacted`. This
   * program's marker that no file the check read restores is not: the quoted text is in none of them, and the reason is
   * the check's own (the report said "the quotation carries a redaction marker" of a marker the program
   * itself had written into the log the re-check reads). */
  if (carriesMarker(markers === "not_found" ? quote.replace(/\[redacted:baseline-002#[^\]]*\]/g, "") : quote, fileText)) return "redacted";
  if (check.status === "unverifiable") return "not_found";
  // Found, and invalidated all the same: the only such path is an elided quotation whose parts carry no content.
  return "no_content";
}

/** A location as a trail row and an `item` entry both name it: the file and the lines as numbers. */
const locationKey = (file: string, lines: unknown): string => `${file}|${parseEvidenceLines(lines).join(",")}`;

/**
 * One quotation row's outcome once the questions this file asks BESIDE the shared waterfall are put
 * to it — in one place, for `evidence[]` and `reading.read[]` rows alike:
 *
 * 1. Does the quotation carry content of its own? One that does not (`contentlessReason`) is
 *    invalidated whatever the search found, because finding `-` or `null` in a file shows nothing.
 *    Asked only of a non-empty quotation, and asked again of an elided one's pieces in 3.
 * 2. Is it redacted? Said on the row and counted apart, changing no outcome (see `carriesMarker`).
 * 3. Where the flat search failed: is it an elided quotation whose parts are real (`checkElision`)?
 *    Tried only there, so it can add a match and never remove one.
 *
 * The row's `status` and `final` are left exactly as the shared waterfall wrote them — they are that
 * tool's statement, and these are further questions asked of the same text. What this decides goes
 * into the record's outcome and, for 1 and 3, into the summary's lists.
 */
function decideRow(
  check: QuoteCheck,
  quote: string,
  declaredSource: string,
  declaredLines: number[],
  code: ReturnType<typeof buildCodeCorpus>,
  lists: { elided: string[]; redacted: string[]; contentless: string[] },
  programMarkers: "none" | "no_rule" | "not_found" = "none",
): { outcome: VerdictQuoteOutcome; note: string } {
  const path = check.path;
  /* The contentless rule on the quotation as ONE piece, before anything else, so whatever the search found (definition,
   * 5). NOT asked of an empty quotation: the waterfall has already invalidated it and
   * said why ("the quotation is empty, or contains nothing but whitespace"), and "punctuation only"
   * said of a quotation with no characters at all is false. The emptiness test is the waterfall's own:
   * nothing left once whitespace is taken out. */
  const empty = quote.trim() === "" ? null : contentlessReason(quote);
  if (empty !== null) {
    lists.contentless.push(path);
    check.notes.push(
      `the quotation carries no content of its own (${empty}), so finding its characters in a file shows nothing about that file — it is not evidence, whatever the search found`,
    );
    return {
      outcome: "invalidated",
      note: `${path} (declared ${check.declared.source || "(no file named)"}:${check.declared.lines.join(", ") || "no line"}): the quotation ${JSON.stringify(quote.trim().slice(0, 40))} carries no content of its own (${empty}). A record cannot stand on it, wherever those characters occur in the file.`,
    };
  }
  let decided = outcomeOfCheck(check);
  /* A quotation the child redacted cannot be confirmed and is not evidence of fabrication. Said
   * on the row, counted apart, and changing no outcome: see `carriesMarker`. */
  if (decided.outcome === "invalidated" && carriesMarker(quote, declaredSource ? code.get(declaredSource)?.text : undefined)) {
    lists.redacted.push(path);
    check.notes.push(
      programMarkers === "none"
        ? "this quotation carries a redaction marker, so it is NOT VERBATIM by the record's own account — a child that found a live credential is right not to copy it into a report. Nothing mechanical can confirm a redacted quotation, so it stays unconfirmed and this record is one a person must look at; that is not a finding that anything was fabricated."
        : `this quotation carries this program's own redaction marker (baseline-002, written where the report and the evidence log are assembled), and ${programMarkers === "no_rule" ? "this check was run without the rule bundle (--bundle), so the marker could not be restored from the file" : "no text in the named file, nor in any other file this check read, has the digest the marker carries, so the marker could not be restored and the quoted text is in none of them"}. A redacted quotation cannot be confirmed as written, so it stays unconfirmed and this record is one a person must look at; that is not a finding that anything was fabricated.`,
    );
  }
  if (decided.outcome === "invalidated" && !declaredSource && !lists.contentless.includes(path) && elidedContentless(quote) !== null) {
    lists.contentless.push(path); // The contentless rule on the pieces where no file is named (elidedContentless)
  }
  if (decided.outcome === "invalidated" && declaredSource) {
    const elision = checkElision(quote, declaredSource, declaredLines, {
      find: (text, anchor) => verifyOneQuote({ path, corpus: code, declaredSource, declaredLines: anchor, text, preNotes: [], formatting: true }),
      place: (source, text, window) => placeRun(code, source, text, window, true),
      beside: (source, offset, side) => besideWindow(code, source, offset, side),
    });
    if (elision.note) check.notes.push(elision.note);
    if (elision.contentless !== null) {
      /* The contentless rule on the pieces the elided reading cuts the quotation into (definition, 5): listed and said
       * as the whole-quotation case is. The row was invalidated already; this names the reason. */
      lists.contentless.push(path);
      decided = {
        outcome: "invalidated",
        note: `${path} (declared ${check.declared.source || "(no file named)"}:${check.declared.lines.join(", ") || "no line"}): the quotation ${JSON.stringify(quote.trim().slice(0, 40))} is elided, and none of its parts carries content of its own (${elision.contentless}). A record cannot stand on it, wherever those characters occur in the file.`,
      };
    }
    if (elision.admitted) {
      /* **`parts_confirmed`, NOT `repaired`, and the difference is the whole point.**
       * `repaired` is defined as "the quotation is in the file it names and a line number
       * drifted". An admitted elision is not that: the quotation AS WRITTEN is in no file, only
       * its parts are, and the position was reconstructed rather than corrected. See unit Q's
       * report, section 4, for why no positional bound beyond the declared span was added (two of
       * the three shapes independent verification found are unreachable by any bound, and the two
       * candidates cost 3 % and 25 % of the real admitted elisions). */
      decided = {
        outcome: "parts_confirmed",
        note: `${path}: this quotation is ELIDED. Each of its parts was found on its own in the file the entry names, in the order written, spread within the declared span plus ${T3_MAX_TOTAL_SPAN} lines — and the quotation AS WRITTEN is in no file. THE LINES BETWEEN THE PARTS WERE NOT CHECKED and nothing here says what they contain, so a reader opening the declared range will see text this check never looked at.`,
      };
      lists.elided.push(path);
    }
  }
  return decided;
}

/* --------------------------------------------------------------------------------------------- *
 * Reading the records.
 * --------------------------------------------------------------------------------------------- */

/** One record to check, whatever file or log it came out of. */
export interface RecordJob {
  source: string;
  index: number;
  seat: VerdictSeat;
  id: string;
  /** The child's own object, already deep-copied. Written into; never the caller's. */
  record: Record<string, unknown>;
  /** Where `evidence[]` lives on it — the object itself, or its `refutation`. */
  holder: Record<string, unknown>;
  /** The JSON path prefix a check row reports, e.g. `verdicts[3].evidence`. */
  path: string;
  /**
   * Which container the record came out of. It decides one thing: the word an invalidated silence
   * record takes, because `unknown_rules[].outcome` has no `undetermined`. Absent means a verdicts
   * directory, which is what every caller before this field existed built.
   */
  container?: "verdicts-dir" | "evidence-log";
  /** Which record of the verdict set this is, for a job made from a log's row. */
  kind?: VerdictSetKind;
}

/** One record, or one entry where a record should be, whose SHAPE no check can read as written. */
export interface MalformedRecord {
  source: string;
  index: number;
  seat: VerdictSeat;
  id: string;
  problems: string[];
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value.filter((v) => v && typeof v === "object") as Record<string, unknown>[]) : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** What a value is, in words, for a note that says why it is not what the contract asks for. */
function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "absent";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "string") return `the string ${JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value)}`;
  return `a ${typeof value}`;
}

/**
 * The seat a file under a verdicts directory belongs to, decided by the subdirectory.
 *
 * SKILL.md fixes the scheme: step 4 writes adjudications at the top level, step 5 refutations under
 * `refutation/`, step 3c silence investigations under `silence/`. Read from the path rather than
 * guessed from the contents, so a file in the wrong place is a visible mistake rather than a
 * silently reclassified record.
 */
export function seatOfPath(relPath: string): VerdictSeat {
  const parts = relPath.split(/[\\/]/);
  if (parts.includes("refutation")) return "refuter";
  if (parts.includes("silence")) return "silence-investigator";
  return "adjudicator";
}

/** Every `*.json` under `dir`, depth-first, in sorted order so two runs read the same sequence. */
function jsonFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (at: string) => {
    let entries: string[];
    try {
      entries = readdirSync(at).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(at, name);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) walk(full);
      else if (s.isFile() && name.endsWith(".json")) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/**
 * The jobs a verdicts directory yields.
 *
 * A refutation file's records are refutations in their own right here, not the `refutation` object of
 * a verdict: at this point in the run the orchestrator has not merged them yet (SKILL.md step 7 does
 * that), and checking them before the merge is the whole point — an `overturned` that rests on a
 * fabricated quotation must be caught before it demotes anything.
 */
export function isReaderReply(parsed: unknown): boolean {
  const isRow = (value: unknown): boolean => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    /* `class` and `evidence` are refused beside the two class fields (fix-verify-shape, 2026-09-24):
     * a verdict whose seat wrote its label under `class` carries no `verdict`, and live run 1 wrote
     * 61 of those. A row carrying a label or a quotation list is a verdict in the wrong shape, and
     * excluding it as a reader's reply would leave it unchecked at exit 0. */
    if (row.verdict !== undefined || row.outcome !== undefined || row.class !== undefined || row.evidence !== undefined) return false;
    return typeof row.disposition === "string" && typeof row.kind === "string";
  };
  if (Array.isArray(parsed)) return parsed.length > 0 && parsed.every(isRow);
  if (!parsed || typeof parsed !== "object") return false;
  const obj = parsed as Record<string, unknown>;
  if (obj.verdict !== undefined || obj.outcome !== undefined || obj.evidence !== undefined) return false;
  const rows = obj.dispositions ?? obj.read ?? obj.rows;
  return Array.isArray(rows) && rows.length > 0 && rows.every(isRow);
}

export function jobsFromVerdictsDir(dir: string): { jobs: RecordJob[]; files: { path: string; seat: VerdictSeat; records: number }[]; unreadable: { path: string; problem: string }[]; readerReplies: { path: string; rows: number }[]; malformed: MalformedRecord[] } {
  const jobs: RecordJob[] = [];
  const files: { path: string; seat: VerdictSeat; records: number }[] = [];
  const unreadable: { path: string; problem: string }[] = [];
  const readerReplies: { path: string; rows: number }[] = [];
  const malformed: MalformedRecord[] = [];
  for (const full of jsonFilesUnder(dir)) {
    const rel = relativePath(dir, full);
    const seat = seatOfPath(rel);
    let parsed: unknown;
    try {
      parsed = JSON.parse(programFileBytes("the record file", full).toString("utf8")); // the one reader
    } catch (e) {
      /* MALFORMED, NOT MERELY UNREADABLE (fix-verify-shape): a file in the verdicts directory is where
       * a seat's records are, and one that does not parse holds records no check can read. Listed
       * beside `files_refused` it passed at exit 0; as a malformed entry it exits 5. */
      malformed.push({ source: rel, index: 0, seat, id: "", problems: [`the file could not be read as JSON (${(e as Error).message}), so no record in it was checked`] });
      continue;
    }
    /* A READER'S REPLY IS RECOGNISED BY ITS SHAPE AND EXCLUDED HERE (U4 finding M2).
     *
     * A reader in reading mode returns an array of disposition rows with no verdict word, and this
     * tool read each row as a verdict with no evidence: one run's first attempt invalidated 104
     * records that way, none of which was a verdict at all. The run's own convention is to write the
     * replies under `readers/`, and classifying by directory is what the fix must not rest on — a
     * convention is a thing a run can get wrong, and it got it wrong in exactly this record. So the
     * shape decides, and the file is named in the report rather than passing unmentioned. */
    if (isReaderReply(parsed)) {
      readerReplies.push({ path: rel, rows: Array.isArray(parsed) ? parsed.length : 1 });
      continue;
    }
    // A child's file is "a JSON array of Verdict objects" (SKILL.md step 4). A single object is
    // accepted too and counted as one record: refusing it would leave the record unchecked, which is
    // the outcome this whole file exists to prevent.
    /* AN ENTRY THAT IS NOT AN OBJECT IS REPORTED, NEVER FILTERED (fix-verify-shape). `asArray` used to
     * drop it here, so a string or a `null` where a record belongs vanished with nothing said and the
     * file's record count shrank to match. Each such entry is a malformed record at its own index. */
    const entries: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    const records: { record: Record<string, unknown>; index: number }[] = [];
    entries.forEach((entry, index) => {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) records.push({ record: entry as Record<string, unknown>, index });
      else malformed.push({ source: rel, index, seat, id: "", problems: [`entry [${index}] is ${describeValue(entry)}, not a record object, so nothing in it could be checked`] });
    });
    /* AN EMPTY FILE IS MALFORMED, NOT MERELY REFUSED. A file in the
     * verdicts directory is where a seat's reply was written, and one that holds no record is a reply
     * that was lost or never written. Listed in `files_refused` it passed at exit 0; the candidate it
     * was to answer is also a `verdict-missing` gap when --findings is given. */
    if (entries.length === 0) {
      malformed.push({ source: rel, index: 0, seat, id: "", problems: ["the file holds no record at all (an empty list), so the reply it was written for is not here and nothing in it could be checked"] });
    }
    records.forEach(({ record, index }) => {
      jobs.push({
        source: rel,
        index,
        seat,
        id: asString(record.finding_id) || asString(record.rule_id),
        record,
        holder: record,
        path: `${rel}[${index}].evidence`,
      });
    });
    files.push({ path: rel, seat, records: records.length });
  }
  return { jobs, files, unreadable, readerReplies, malformed };
}

/**
 * The jobs an assembled evidence log yields: its verdicts, each verdict's own `refutation`, and its
 * `unknown_rules[]` rows.
 *
 * The refutation is a job of its own rather than more rows on the verdict's, because it carries its
 * own class field and its own outcome: a verdict whose evidence is sound and whose refutation quotes
 * a file that does not exist must show exactly that, and one merged outcome could not.
 */
export function jobsFromEvidenceLog(log: EvidenceLog, source: string): RecordJob[] {
  const jobs: RecordJob[] = [];
  /* Only object entries become jobs: an entry of any other shape is named by
   * `evidenceLogShapeProblems` as malformed rather than crashing the annotation below. */
  const isObject = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);
  (Array.isArray(log.verdicts) ? (log.verdicts as unknown[]) : []).forEach((verdict, i) => {
    if (!isObject(verdict)) return;
    const v = verdict;
    jobs.push({
      source,
      index: i,
      seat: "adjudicator",
      id: asString(v.finding_id),
      record: v,
      holder: v,
      path: `verdicts[${i}].evidence`,
      container: "evidence-log",
    });
    /* Every nested record of the set (verdict-set.ts `verdictSetRecordsOf`): the
     * refutation and the second look alike, so a carried second look's quotations are checked again against today's tree
     * as its refutation's are. Both are the refuter seat's records; the second look is marked by `kind`, since it moves the
     * finding's placement and never its record's class (the demotion below skips it, as it skips a `mode: "challenge"` file). */
    for (const { kind, record } of verdictSetRecordsOf(v)) {
      if (kind === "adjudicator") continue;
      jobs.push({
        source,
        index: i,
        seat: "refuter",
        id: asString(v.finding_id),
        record: v,
        holder: record,
        path: `verdicts[${i}].${VERDICT_SET_FIELD[kind]}.evidence`,
        container: "evidence-log",
        kind,
      });
    }
  });
  (Array.isArray(log.unknown_rules) ? (log.unknown_rules as unknown[]) : []).forEach((row, i) => {
    if (!isObject(row)) return;
    jobs.push({
      source,
      index: i,
      seat: "silence-investigator",
      id: asString(row.rule_id),
      record: row,
      holder: row,
      path: `unknown_rules[${i}].evidence`,
      container: "evidence-log",
    });
  });
  return jobs;
}

/**
 * What an assembled log's CONTAINERS get wrong, which no record-level check can see (fix-verify-shape).
 *
 * A log with no `verdicts` list yielded no job, so the run checked nothing and exited 0; a verdict
 * entry that is not an object crashed the annotation; a `refutation` that is not an object was
 * skipped, so the refuter's word was never checked. Each is a malformed record here, at its index.
 */
export function evidenceLogShapeProblems(log: EvidenceLog, source: string): MalformedRecord[] {
  const out: MalformedRecord[] = [];
  const raw = log as unknown as Record<string, unknown>;
  const isObject = (value: unknown) => !!value && typeof value === "object" && !Array.isArray(value);
  if (!Array.isArray(raw.verdicts)) {
    out.push({
      source,
      index: 0,
      seat: "adjudicator",
      id: "",
      problems: [`the log's \`verdicts\` is ${describeValue(raw.verdicts)}, not a list, so no verdict in it could be checked`],
    });
  } else {
    raw.verdicts.forEach((verdict, i) => {
      if (!isObject(verdict)) {
        out.push({ source, index: i, seat: "adjudicator", id: "", problems: [`verdicts[${i}] is ${describeValue(verdict)}, not a record object`] });
        return;
      }
      const refutation = (verdict as Record<string, unknown>).refutation;
      if (refutation !== undefined && !isObject(refutation)) {
        out.push({
          source,
          index: i,
          seat: "refuter",
          id: asString((verdict as Record<string, unknown>).finding_id),
          problems: [`verdicts[${i}].refutation is ${describeValue(refutation)}, not a record object, so the refuter's outcome and quotations could not be checked`],
        });
      }
    });
  }
  if (raw.unknown_rules !== undefined) {
    if (!Array.isArray(raw.unknown_rules)) {
      out.push({ source, index: 0, seat: "silence-investigator", id: "", problems: [`the log's \`unknown_rules\` is ${describeValue(raw.unknown_rules)}, not a list`] });
    } else {
      raw.unknown_rules.forEach((row, i) => {
        if (!isObject(row)) out.push({ source, index: i, seat: "silence-investigator", id: "", problems: [`unknown_rules[${i}] is ${describeValue(row)}, not a record object`] });
      });
    }
  }
  return out;
}

/* --------------------------------------------------------------------------------------------- *
 * The run.
 * --------------------------------------------------------------------------------------------- */

export interface VerifyVerdictQuotesOptions {
  /** Root the records' file paths are relative to. Resolved, because files are read through it. */
  targetRoot: string;
  /**
   * The same root as the caller TYPED it, for the output.
   *
   * An absolute path written into a record makes every byte of that record machine-dependent, so two
   * runs of one tree in two checkouts disagree and neither can be compared with the other. The unit
   * C+D verification found exactly that on the orientation sheet. Defaults to `targetRoot` where a
   * caller has nothing shorter to give.
   */
  displayTarget?: string;
  /** Records read from a `.legal/verdicts/` directory, already parsed. */
  fromDir?: { dir: string; jobs: RecordJob[]; files: { path: string; seat: VerdictSeat; records: number }[]; unreadable: { path: string; problem: string }[]; readerReplies?: { path: string; rows: number }[]; malformed?: MalformedRecord[] };
  /** Records read from an assembled evidence log, already parsed. */
  fromLog?: { path: string; log: EvidenceLog };
  /**
   * The scan's own findings document, where the caller passed `--findings`.
   *
   * **It is what the coverage check checks against, and without it there is no coverage check.** A
   * verdict's `reading` block classifies every same-kind line group of its candidate; the groups
   * themselves are in the document under `candidates[].kinds`, so a checker holding only the
   * verdicts can see that the block is well-formed and cannot see whether it accounts for the
   * candidate. An absent `--findings` is therefore reported in `not_verified_here` rather than
   * counted as a pass - the same discipline as everything else here.
   */
  fromFindings?: { path: string; findings: Findings };
  /**
   * Require a complete `rests_on` block on every adjudicator record (unit H).
   *
   * Off unless the caller asks, because every verdict written before the premise block existed, and
   * every run assembled without the tree the digests are taken over, carries none — and reporting
   * those as gaps would be a claim about records nobody has changed. A run that DID assemble with a
   * tree turns it on and gets the guarantee that every verdict it stores can be re-checked later.
   * A block that is present and not `complete` is a gap with or without this flag.
   */
  requireRestsOn?: boolean;
  /**
   * `baseline-002`'s clauses, compiled for printed text (credential-redaction.ts), where the caller has
   * the rule bundle. A log this program wrote carries its own redaction markers inside quotations; with this, each
   * marker is restored from the named file by its digest before the quotation is checked (`restoreProgramMarkers`),
   * and without it such a quotation is checked as written and treated as a redacted one.
   */
  credentials?: PrintedRedaction | null;
  /**
   * The refutation files, by their path under the verdicts directory, whose
   * refuter entry does not stand (launch-list-file.ts `standingRefuters`, through assemble-hooked.ts
   * `supersededRefutationFiles`). Such a record answers a verdict that no longer exists: it is still checked and its own
   * outcome reported, but its failure never rewrites another record's note to say the refutation demotes it - the
   * assembly does not count that refutation (assemble-report.ts step 6), so the record keeps its class.
   */
  supersededRefutations?: ReadonlySet<string>;
}

export interface VerifyVerdictQuotesResult {
  report: VerdictQuoteReport;
  checks: QuoteCheck[];
  /** True when the target root is not a directory this process can read. */
  target_problem: string;
}

/** Which class field a seat's record carries, and what an invalidated one becomes. */
const CLASS_FIELD: Record<VerdictSeat, { field: string; keep: string; invalid: string }> = {
  // `needs_human` is the design's own word and the enum's own description: "the code alone does not
  // settle it".
  adjudicator: { field: "verdict", keep: "verdict_before_quote_check", invalid: "needs_human" },
  // Already in the refuter's enum: "the refuter found the question genuinely open". An overturn
  // resting on a quotation that is nowhere must not dismiss a candidate quietly.
  refuter: { field: "outcome", keep: "outcome_before_quote_check", invalid: "needs_human" },
  // This seat's own vocabulary has no `needs_human`. `construct_found` is false once its evidence
  // fails, and `apparently_absent` would be a CLEARANCE — the statement the design forbids and which
  // the log's own schema names ("'we looked and found nothing' and 'nobody looked' are different
  // results"). A raw silence record carries `undetermined` and takes it; a log row's enum does not,
  // and it takes the log's own weakest state instead. See the schema note.
  "silence-investigator": { field: "outcome", keep: "outcome_before_quote_check", invalid: "undetermined" },
};

/**
 * Whether a record with NO evidence at all is void, by that seat's own contract.
 *
 * Exported so the gate pins the three answers rather than only their effect on one planted record.
 *
 * - **Adjudicator.** Void. `verdict.schema.json` sets `minItems: 1` and says why: "At least one item
 *   is mandatory in every direction, including dismissals: an unevidenced verdict is an opinion, and
 *   this record has to survive an audit." SKILL.md's rules of adjudication say it again — "A verdict
 *   without a quote from the real code is void." Nothing in the layer-2 path validates against that
 *   schema at run time, so this is where the requirement is actually enforced.
 * - **Refuter.** Not void. `refutation.evidence` did not exist in the schema before 2026-09-17, so a
 *   log written before then carries none BY CONSTRUCTION, and invalidating those would punish the
 *   record for a gap in the schema rather than for anything the model did. It is disclosed, and an
 *   `overturned` with no quotation is disclosed by name, because that is the one combination
 *   SKILL.md step 5 asks for a quotation on — "keep the refuter's grounds and quote as the reason".
 * - **Silence investigator.** Void only for `construct_found`. `evidence-log.schema.json` scopes the
 *   field to it — "For `construct_found`: file, lines and a verbatim quote of what the detector
 *   missed" — and the brief says "required for construct_found". An `apparently_absent` row's
 *   evidence IS its `searched[]` list, and a row that found nothing has nothing to quote. Requiring
 *   one there would turn every honest absence into a defect, which is the mirror of the failure
 *   the design is about.
 */
export function evidenceIsRequired(
  job: { seat: VerdictSeat },
  classValue: string,
): { required: boolean; because: string } {
  if (job.seat === "adjudicator") {
    return {
      required: true,
      because:
        "An unevidenced verdict is an opinion, and the schema requires at least one quotation in every direction, dismissals included — so there is nothing here for a reader or an auditor to check it against.",
    };
  }
  if (job.seat === "silence-investigator") {
    return classValue === "construct_found"
      ? {
          required: true,
          because:
            'This row says a detector missed a construct that is there, which is the most valuable record the log can carry — and the schema scopes `evidence` to exactly that outcome ("file, lines and a verbatim quote of what the detector missed"). A located miss with no location is not a located miss.',
        }
      : {
          required: false,
          because: "",
        };
  }
  return { required: false, because: "" };
}

/** The values `unknown_rules[].outcome` may take, for the one seat whose two containers differ. */
const LOG_SILENCE_OUTCOMES = new Set([
  "not_checked",
  "construct_found",
  "apparently_absent",
  "not_evaluated",
  "out_of_jurisdiction",
]);

/**
 * The words each seat's class field may hold (fix-verify-shape, 2026-09-24).
 *
 * Adjudicator: `verdict.schema.json` `verdict.enum`. Refuter: the same schema's `refutation.outcome`
 * enum. Silence investigator: its agent definition's three (`construct_found | apparently_absent |
 * undetermined`) and the log row's five (`evidence-log.schema.json` `unknown_rules[].outcome`),
 * together, because the demotion below already accepts either container's words in either.
 */
export const SEAT_CLASS_WORDS: Record<VerdictSeat, readonly string[]> = {
  adjudicator: ["violation_candidate", "not_applicable", "needs_human"],
  refuter: ["upheld", "overturned", "needs_human"],
  "silence-investigator": ["construct_found", "apparently_absent", "undetermined", ...LOG_SILENCE_OUTCOMES],
};

/** The annotation fields this tool writes onto a record; never read as the seat's own. */
const OWN_ANNOTATIONS = new Set(["quote_checks", "quote_check_outcome", "quote_check_notes", "quote_check_failures"]);

/**
 * THE ASSEMBLY'S OWN FIELD ON A LOG'S COPY OF A VERDICT.
 * `disposition`, with one of the values verdict.schema.json lists for it (the single original; a gate holds it equal to
 * disposition.ts's list), is written by the assembly into the
 * evidence log's copy of an adjudicator's verdict and computed again on every run, never read back; a carried record is a
 * log's copy and holds it too. No seat writes it: adjudicator-reply.schema.json refuses a field it does not list. One of
 * its values, `not_applicable`, is a class word, so the value test of `strayLabelFields` read the assembly's own field as
 * a second label and invalidated every "not applicable" answer of a written log (and turned a carried one into
 * `needs_human`). Only that key, on an adjudicator's record, with one of those exact values, is left out; any other value
 * under it, and the same value under any other key, is still a second label.
 */
const ASSEMBLY_DISPOSITIONS: ReadonlySet<string> = new Set(
  ((schemaDocument("verdict.schema.json") as { properties?: { disposition?: { enum?: unknown } } }).properties?.disposition?.enum as string[] | undefined) ?? [],
);
const assemblyDisposition = (job: { seat: VerdictSeat; holder: Record<string, unknown> }, key: string): boolean =>
  key === "disposition" && job.seat === "adjudicator" && typeof job.holder[key] === "string" && ASSEMBLY_DISPOSITIONS.has(job.holder[key] as string);

/**
 * A word as a label reader would take it: case, surrounding whitespace and the separator between its
 * parts (space, hyphen, underscore) do not change which label it is.
 */
export function labelKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "_");
}

/** Every class word of every seat, as `labelKey` spells it. */
const ANY_SEAT_CLASS_WORD = new Set(Object.values(SEAT_CLASS_WORDS).flatMap((words) => words.map(labelKey)));

/**
 * Every field OTHER than the seat's class field that carries a class word — a second label. Found by
 * VALUE, never by name, so `class` (live run 1: 61 adjudicator records) and any other spelling a seat
 * or an orchestrator invents are found alike. The tool's own `*_before_quote_check` fields are
 * excluded: they are where a demoted word is kept on purpose.
 *
 * THE WORDS OF EVERY SEAT, IN ANY CASE OR SPACING. Matching only
 * the seat's own words, exactly as spelled, let `label: "NOT_APPLICABLE"` survive a demotion and let a
 * refutation carry an adjudicator's `verdict: "violation_candidate"` at exit 0 — a second label is
 * read by whoever looks there, whichever seat's vocabulary it comes from.
 */
export function strayLabelFields(job: { seat: VerdictSeat; holder: Record<string, unknown> }): string[] {
  const spec = CLASS_FIELD[job.seat];
  return Object.keys(job.holder).filter(
    (key) =>
      key !== spec.field &&
      !key.endsWith("_before_quote_check") &&
      !OWN_ANNOTATIONS.has(key) &&
      !assemblyDisposition(job, key) &&
      typeof job.holder[key] === "string" &&
      ANY_SEAT_CLASS_WORD.has(labelKey(job.holder[key] as string)),
  );
}

/**
 * A LINE REFERENCE, AS A FILE'S LINES ARE NUMBERED (relay integration part B, area γ, item 2).
 * `parseEvidenceLines` reads every run of digits and drops signs, so "0", "0 hits", "-1" and
 * "none (searched 3 files)" were read as naming a line, and capture, the quote check and the assembly all
 * accepted them. A `lines` value now names lines only as a whole number from 1, or as text made of such
 * numbers: "12", "12-15", "12–15", "12 to 15", "12, 15", "L12", "L12-L15", "lines 12-15" (any case). Live run
 * 1's 758 `lines` values (407 distinct) read the same under this test as under the old one: 753 accepted.
 * The text of a value the old test refused is unchanged, so capture's refusals are byte-identical.
 */

/** Why a `lines` value names no line of a file, or null where it names lines from 1. `where` is its path. */
export function lineReferenceProblem(value: unknown, where = "lines"): string | null {
  if (parseEvidenceLines(value).length === 0) {
    return `${where} is ${describeValue(value)} and names no line, so a quotation found anywhere in the file would read as a corrected position`;
  }
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 1
      ? null
      : `${where} is the number ${value}, and a file's lines are numbered from 1, so it names no line and a quotation found anywhere in the file would read as a corrected position`;
  }
  const text = String(value).trim();
  if (LINE_REFERENCE.test(text) && (text.match(/\d+/g) ?? []).every((d) => Number.parseInt(d, 10) >= 1)) return null;
  return `${where} is ${describeValue(value)}, which is not a line reference: lines are numbered from 1 and written as "12", "12-15", "12, 15" or "L12", and a zero, a sign or a count names no line, so a quotation found anywhere in the file would read as a corrected position`;
}

/** Why one quotation row (an `evidence[]` entry or a `reading.read[]` row) cannot be checked as written. */
function quoteRowProblems(row: unknown, where: string): string[] {
  if (!row || typeof row !== "object" || Array.isArray(row)) return [`${where} is ${describeValue(row)}, not an object`];
  const r = row as Record<string, unknown>;
  const out: string[] = [];
  if (typeof r.file !== "string" || r.file.trim() === "") out.push(`${where}.file is ${describeValue(r.file)}, so there is no file to check the quotation in`);
  if (typeof r.quote !== "string" || r.quote.trim() === "") out.push(`${where}.quote is ${describeValue(r.quote)}, so there is no quotation to check`);
  const lines = lineReferenceProblem(r.lines, `${where}.lines`);
  if (lines !== null) out.push(lines);
  return out;
}

/**
 * A read row's gate, which the composition of severity at a place reads (severity-at-place.ts): a kind
 * outside the closed list, a kind on a row not decided `construct_but_gated`, or `other` without its words would be
 * read as something the seat did not say. A gated row with no kind is accepted: it is every row written by an earlier version,
 * and it raises as any held place does.
 */
function gateRowProblems(row: unknown, where: string): string[] {
  if (!row || typeof row !== "object" || Array.isArray(row)) return [];
  const r = row as Record<string, unknown>;
  const out: string[] = [];
  if ("gate" in r) {
    if (typeof r.gate !== "string" || !(PLACE_GATE_KINDS as readonly string[]).includes(r.gate)) out.push(`${where}.gate is ${describeValue(r.gate)}, not one of ${PLACE_GATE_KINDS.join(", ")}`);
    else if (r.disposition !== "construct_but_gated") out.push(`${where}.gate is ${JSON.stringify(r.gate)} on a row decided ${describeValue(r.disposition)}; only a construct_but_gated row names a gate`);
  }
  if ("gate_words" in r && (r.gate !== "other" || typeof r.gate_words !== "string" || r.gate_words.trim() === "")) out.push(`${where}.gate_words is ${describeValue(r.gate_words)} where the gate is ${describeValue(r.gate)}; it is the gate in the seat's words, on \`other\` only`);
  else if (r.gate === "other" && !("gate_words" in r)) out.push(`${where}.gate is "other" with no \`gate_words\``);
  return out;
}

/** The most `evidence[]` entries one element name may take (legal-adjudicator.md, section Output: "one entry per
 * element per site ... and at most five for one element name"). A schema cannot count entries by the value of
 * their `name`, so the second check counts them. Moved here from verdict-capture.ts (part B, area γ, item 2), so
 * that capture, verify and the assembly apply it as one check. */
export const ELEMENT_ENTRIES_MAX = 5;

/** The most `evidence[]` entries whose `role` is "premise" ("two or three of them and never a fourth"). */
export const PREMISE_ENTRIES_MAX = 3;

export function elementEntryProblems(entry: unknown): string[] {
  const evidence = entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>).evidence : undefined;
  if (!Array.isArray(evidence)) return [];
  const perName = new Map<string, number>();
  for (const e of evidence) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const { role, name } = e as Record<string, unknown>;
    if (role === "element" && typeof name === "string") perName.set(name, (perName.get(name) ?? 0) + 1);
  }
  return [...perName]
    .filter(([, n]) => n > ELEMENT_ENTRIES_MAX)
    .map(([name, n]) => `\`evidence\` holds ${n} entries for the element ${JSON.stringify(name)}; one element name takes at most ${ELEMENT_ENTRIES_MAX} (one entry per element per site)`);
}

/**
 * THE TWO RULES OF THE ADJUDICATOR'S OUTPUT PARAGRAPH THAT ONLY ITS REPLY SCHEMA HELD:
 * an entry whose `role` is "item" names its item, and at most three entries carry `role` "premise".
 * adjudicator-reply.schema.json says both; verdict.schema.json, which the quote check and the assembly read
 * against, says neither, so a record capture refuses for them passed both. Worded to name the field the reply
 * schema names, so that capture, which runs that schema first, reads each once.
 */
function adjudicatorEvidenceProblems(evidence: unknown[]): string[] {
  const out: string[] = [];
  let premises = 0;
  evidence.forEach((e, i) => {
    if (!e || typeof e !== "object" || Array.isArray(e)) return;
    const row = e as Record<string, unknown>;
    if (row.role === "premise") premises += 1;
    if (row.role === "item" && row.name === undefined) {
      out.push(`evidence[${i}].name is absent, and an entry whose \`role\` is "item" names the item it is (never an entry without a name)`);
    }
  });
  if (premises > PREMISE_ENTRIES_MAX) {
    out.push(`\`evidence\` holds ${premises} entries whose \`role\` is "premise"; the strongest locations are two or three of them, never more than ${PREMISE_ENTRIES_MAX}`);
  }
  return out;
}

/**
 * THE SHAPE CHECK (fix-verify-shape, 2026-09-24): every field a check in this file reads, held to the
 * shape that check assumes, BEFORE any check reads it.
 *
 * Why it exists. Every check below reads its field through `asString`/`asArray`, which turn a missing
 * or mistyped value into `""` or `[]` — and `""`/`[]` then took a branch that passed: the demotion ran
 * only where the class field was a string, so live run 1's two invalidated `class`-only records kept
 * `not_applicable`; a silence row with no `outcome` needed no evidence; a verdict with no
 * `finding_id` was never coverage-checked; a non-list `evidence` was "no evidence, allowed". The
 * schema would refuse all of these, and it does not run where `ajv` does not load (a documented
 * degrade that stays as it is). This is the minimum that runs everywhere: a record that fails it is
 * reported as malformed and handled as invalidated, whatever its quotations say.
 *
 * What it does not hold: a field no check here reads (`reasoning`, `confidence`, …) and an optional
 * field whose absence every reader already treats as a gap (`role`, `name`, `search` of an entry).
 */
export function recordShapeProblems(job: { seat: VerdictSeat; holder: Record<string, unknown>; container?: RecordJob["container"] }): string[] {
  const out: string[] = [];
  const h = job.holder;
  const spec = CLASS_FIELD[job.seat];
  const words = SEAT_CLASS_WORDS[job.seat];
  const label = h[spec.field];
  if (typeof label !== "string") {
    out.push(`the class field \`${spec.field}\` is ${describeValue(label)}; this seat's record carries one of ${words.join(", ")} there`);
  } else if (!words.includes(label)) {
    out.push(`the class field \`${spec.field}\` is ${JSON.stringify(label)}, which is not one of ${words.join(", ")}`);
  }
  for (const key of strayLabelFields(job)) {
    out.push(`the field \`${key}\` carries the class word ${JSON.stringify(h[key])}; a record has one label, in \`${spec.field}\`, and a second one is read by whoever looks there`);
  }
  if (job.seat === "adjudicator" && (typeof h.finding_id !== "string" || h.finding_id.trim() === "")) {
    out.push(`\`finding_id\` is ${describeValue(h.finding_id)}, so the record names no candidate and the coverage and schema checks cannot find it`);
  }
  if (h.evidence === undefined) {
    if (job.seat === "adjudicator" || (job.seat === "silence-investigator" && label === "construct_found")) {
      out.push("`evidence` is absent, and this record's contract requires at least one quotation");
    }
  } else if (!Array.isArray(h.evidence)) {
    out.push(`\`evidence\` is ${describeValue(h.evidence)}, not a list, so the quotation it holds would never be checked`);
  } else {
    h.evidence.forEach((row, i) => out.push(...quoteRowProblems(row, `evidence[${i}]`)));
    if (job.seat === "adjudicator") out.push(...adjudicatorEvidenceProblems(h.evidence));
    // Fix F2: a refuter's or a silence investigator's record carries no verdict, so no `dismissal` (an
    // adjudicator's is checked against its candidate by `recordCoverageGaps`, at capture and here).
    else out.push(...dismissalOutsideVerdictProblems(h.evidence));
  }
  if (h.reading !== undefined) {
    if (!h.reading || typeof h.reading !== "object" || Array.isArray(h.reading)) {
      out.push(`\`reading\` is ${describeValue(h.reading)}, not an object, so the trail it holds would be read as absent`);
    } else {
      const read = (h.reading as Record<string, unknown>).read;
      if (read !== undefined && !Array.isArray(read)) out.push(`\`reading.read\` is ${describeValue(read)}, not a list`);
      else if (Array.isArray(read)) read.forEach((row, i) => out.push(...quoteRowProblems(row, `reading.read[${i}]`), ...gateRowProblems(row, `reading.read[${i}]`)));
    }
  }
  if (h.rests_on !== undefined && (!h.rests_on || typeof h.rests_on !== "object" || Array.isArray(h.rests_on))) {
    out.push(`\`rests_on\` is ${describeValue(h.rests_on)}, not an object, so a block that says it is incomplete would be read as no block at all`);
  }
  // Last, as capture printed it after every other problem of the entry: the element count, which no schema can say.
  if (job.seat === "adjudicator") out.push(...elementEntryProblems(h));
  return out;
}

/**
 * The word an invalidated or malformed record takes. The silence seat's two containers differ:
 * `unknown_rules[].outcome` has no `undetermined`, so a log row — and a raw record that already
 * carries a log word — takes the log's weakest state, `not_checked`.
 */
export function invalidWordFor(job: { seat: VerdictSeat; container?: RecordJob["container"] }, before: unknown): string {
  const spec = CLASS_FIELD[job.seat];
  if (job.seat !== "silence-investigator") return spec.invalid;
  if (job.container === "evidence-log") return "not_checked";
  return typeof before === "string" && LOG_SILENCE_OUTCOMES.has(before) ? "not_checked" : spec.invalid;
}

function emptyOutcomes(): Record<VerdictQuoteOutcome, number> {
  return { confirmed: 0, no_evidence: 0, repaired: 0, parts_confirmed: 0, invalidated: 0 };
}

export function verifyVerdictQuotes(opts: VerifyVerdictQuotesOptions): VerifyVerdictQuotesResult {
  const jobs: RecordJob[] = [];
  const inputs: VerdictQuoteReport["inputs"] = [];
  const filesRefused: { path: string; problem: string }[] = [];
  const readerRepliesExcluded: { path: string; rows: number }[] = [];
  const malformed: MalformedRecord[] = [];

  if (opts.fromDir) {
    // The caller's own objects were parsed by the reader above and are this function's to write into;
    // nothing on disk is touched.
    jobs.push(...opts.fromDir.jobs);
    for (const f of opts.fromDir.files) inputs.push({ path: f.path, seat: f.seat, records: f.records });
    for (const u of opts.fromDir.unreadable) filesRefused.push({ path: u.path, problem: u.problem });
    for (const r of opts.fromDir.readerReplies ?? []) readerRepliesExcluded.push(r);
    for (const m of opts.fromDir.malformed ?? []) malformed.push(m);
  }
  if (opts.fromLog) {
    // Deep-copied here, so the log the caller read is never modified — the same rule
    // `verifyDeclarationQuotes` holds for a declarations report.
    const copy = JSON.parse(JSON.stringify(opts.fromLog.log)) as EvidenceLog;
    const logJobs = jobsFromEvidenceLog(copy, opts.fromLog.path);
    jobs.push(...logJobs);
    malformed.push(...evidenceLogShapeProblems(copy, opts.fromLog.path));
    inputs.push({ path: opts.fromLog.path, seat: "evidence-log", records: logJobs.length });
  }

  /* THE SCHEMA CHECK, TAKEN HERE — ON THE RECORD AS ITS SEAT WROTE IT.
   *
   * `verdict.schema.json` is the contract for an adjudicator's record on both paths into this tool:
   * a verdicts directory, and an evidence log, whose `verdicts[]` items are a `$ref` to it. Nothing
   * at run time held a record to it, so a record the schema refuses could reach the coverage check
   * and be admitted by it — a `covered` row carrying a disposition outside the five was, measured.
   *
   * **Before the quote pass, not after it**, because the quote pass writes `reading.quote_checks`
   * and `reading.quote_check_outcome` onto the block it just checked; validating downstream of that
   * would hold a seat's record to the shape of this tool's own annotations. What is validated here
   * is what the seat handed in.
   *
   * Only where `--findings` was given, because that is the run that reads the trail as a record of
   * coverage rather than as a list of quotations, and only for the adjudicator's own records: a
   * refuter's block is deliberately not coverage-checked.
   *
   * `declarations.schema.json` is registered because `verdict.schema.json`'s `quote_checks` rows
   * `$ref` it across files, which is what that file's own `$comment` tells every loader to expect.
   *
   * A machine that cannot load the validator still runs the tool; what it does not get is silence.
   * `ran: false` is disclosed in `not_verified_here` and is never counted as a pass. */
  const schemaViolations = new Map<string, string[]>();
  let schemaUnavailable = "";
  if (opts.fromFindings) {
    const validateVerdict = compileSchemaValidator("verdict.schema.json", { register: ["declarations.schema.json"] });
    for (const job of jobs) {
      if (job.seat !== "adjudicator" || schemaViolations.has(job.id)) continue;
      const result = validateVerdict(job.holder);
      if (!result.ran) {
        schemaUnavailable = result.unavailable_reason;
        break;
      }
      if (!result.ok) schemaViolations.set(job.id, result.violations);
    }
  }

  /* The scope a quotation may be re-attributed within: every file any record in this run names,
   * deduplicated, in first-appearance order so the sweep is deterministic.
   *
   * The same honest boundary `verifyDeclarationQuotes` draws — a file the agent quoted is a file the
   * agent read — and the same reason: sweeping the whole tree would turn a verification into a second
   * scan, and would let `re_attributed` fire on any file in the repository. What it costs is that a
   * quotation whose text lives only in a file nobody cited comes back `unverifiable` rather than
   * `re_attributed`. Both invalidate; only the note differs, and the note says which it was. */
  const codeNames: string[] = [];
  const seen = new Set<string>();
  for (const job of jobs) {
    /* The trail's files are gathered beside the evidence's, because the trail's quotations are
     * checked beside the evidence's: a file a seat opened to dispose of a kind is a file that seat
     * read, on exactly the reasoning this scope already rests on. Without this the whole of
     * `reading.read[]` would come back `unverifiable` — not because anything was fabricated, but
     * because the corpus was never told the file existed. */
    const readingBlock = job.holder.reading as Record<string, unknown> | undefined;
    const rows = [
      ...asArray(job.holder.evidence),
      ...(readingBlock && typeof readingBlock === "object" ? asArray(readingBlock.read) : []),
    ];
    for (const ev of rows) {
      const file = asString(ev.file);
      if (!file || seen.has(file)) continue;
      seen.add(file);
      codeNames.push(file);
    }
  }

  /* `.legal/` holds THIS RUN'S OWN OUTPUT — the orientation paragraph a model wrote, the findings
   * document, and every child's verdict and reasoning — so nothing there is ever opened. A verdict
   * quoting the file it is written into would confirm against itself at T1, at exit 0.
   *
   * **THE TEST IS ON WHERE THE PATH REALLY LANDS, NOT ON HOW IT IS SPELLED, AND THE FIRST VERSION OF
   * THIS GOT THAT WRONG.** It compared the first path segment against `.legal` before any resolution,
   * and independent verification defeated it three ways in a copy of the built
   * module: `./.legal/findings.json`, `src/../.legal/findings.json` and a symlink `src/notes.md ->
   * ../.legal/orientation-notes.md` were each opened, CONFIRMED AT T1 and hashed into `files_read[]`.
   * The refutation was already written one function away, in `resolveUnderTarget`'s own comment:
   * `resolve()` performs no filesystem access, and a symlink is not caught by any textual test. The
   * same textual mistake had been made three times — in this predicate, in the gate's only `.legal/`
   * fixture, and in the gate assertion meant to hold it — which is why a spelling nobody thought of
   * went through all three.
   *
   * So the path is resolved (which folds `.` and `..`) and its REAL path taken (which follows every
   * link), and both are tested against the target's own `.legal` directory. A path that does not
   * exist has no real path and is judged on the resolved one alone; it can leak nothing, and the read
   * that follows reports its absence in its own words.
   *
   * **The case-insensitive limb, and what it costs.** On a filesystem that folds case, `.LEGAL/` IS
   * `.legal/`, and the real path comes back canonical so the exact test already catches it — but only
   * for a file that exists. The lowercased comparison closes the rest and is the reason this holds on
   * macOS and Windows as well as here. What it costs is that a directory literally named `.LEGAL`,
   * distinct from `.legal`, on a case-SENSITIVE filesystem is also refused. No repository has both,
   * and refusing is the direction that cannot leak. */
  const agentOutputDirs = (() => {
    const rootAbs = resolve(opts.targetRoot);
    const abs = join(rootAbs, AGENT_OUTPUT_DIR);
    let real = "";
    try {
      real = realpathSync(abs);
    } catch {
      // The directory need not exist: a record can still name a path under it, and the resolved
      // comparison below is what decides that case.
    }
    return [abs, real].filter((d) => d.length > 0);
  })();
  const underAgentOutput = (candidate: string): boolean => {
    if (!candidate) return false;
    const hit = (dir: string, value: string) => value === dir || value.startsWith(dir + sep);
    return agentOutputDirs.some(
      (dir) => hit(dir, candidate) || hit(dir.toLowerCase(), candidate.toLowerCase()),
    );
  };
  const refuseAgentOutput = (name: string): string => {
    const where = resolveUnderTarget(opts.targetRoot, name);
    // A path the shared predicate already refuses is left to IT to report, so one path never comes
    // back with two different wordings.
    if (where.problem) return "";
    if (!underAgentOutput(where.real || where.abs)) return "";
    return (
      `the path is under ${AGENT_OUTPUT_DIR}/, which holds THIS RUN'S OWN OUTPUT and not the user's code — the orientation notes a model wrote, the findings document, and every other child's verdict and reasoning. ` +
      `It is never opened, however the path is spelled or linked: a record quoting the directory it is written into would confirm against itself, and a quotation of another agent's sentence is not "a quote from the real code"`
    );
  };
  const code = buildCodeCorpus(opts.targetRoot, codeNames, refuseAgentOutput);

  let targetProblem = "";
  try {
    if (!statSync(resolve(opts.targetRoot)).isDirectory()) {
      targetProblem = `--target ${opts.targetRoot} is not a directory, so no quotation below was checked against a repository.`;
    }
  } catch {
    targetProblem = `--target ${opts.targetRoot} does not exist, so no quotation below was checked against a repository.`;
  }

  const checks: QuoteCheck[] = [];
  const records: VerdictQuoteRecord[] = [];
  // The entries made from a log row's second look, which demote no record.
  const secondLookEntries = new Set<VerdictQuoteRecord>();
  const noEvidence: string[] = [];
  const overturnedWithoutEvidence: string[] = [];
  const shortQuotes: string[] = [];
  const elided: string[] = [];
  const redacted: string[] = [];
  const contentless: string[] = [];
  const restoredRedactions: string[] = [];
  const withdrawnDismissals: string[] = [];
  const lists = { elided, redacted, contentless };
  /* THE PROGRAM'S OWN MARKERS, RESTORED BEFORE A QUOTATION IS CHECKED. A quotation read out of an
   * evidence log this program wrote may carry `[redacted:baseline-002#<clause>:<digest>]` where the value was. Each
   * marker is replaced by the text of the named file whose fold has that digest, and the restored quotation is what
   * the ordinary check reads: the marker is never trusted, the file decides. What the record keeps is the quotation
   * as written. */
  const restore = (quote: string, declaredSource: string, declaredLines: number[], path: string): { text: string; markers: "none" | "no_rule" | "not_found" } => {
    if (!quote.includes("[redacted:baseline-002#")) return { text: quote, markers: "none" };
    if (!opts.credentials) return { text: quote, markers: "no_rule" };
    /* The named file first, then every other file this check reads: before the redaction the check found
     * a quotation the seat placed in the wrong file where it is (`other_file`, `several_files`), and the re-check over
     * the written log must say the same of it, not that it "carries a redaction marker" - the marker is this program's. */
    const credentials = opts.credentials;
    const tryIn = (text: string, lines: number[]): string | null => {
      const r = restoreProgramMarkers(credentials, quote, text, lines);
      return r.restored > 0 && r.unresolved === 0 ? r.text : null;
    };
    const entry = declaredSource ? code.get(declaredSource) : null;
    let restored = entry ? tryIn(entry.text, declaredLines) : null;
    for (const name of code.names) {
      if (restored !== null) break;
      const other = name !== declaredSource ? code.get(name) : null;
      if (other) restored = tryIn(other.text, []);
    }
    if (restored === null) return { text: quote, markers: "not_found" };
    restoredRedactions.push(path);
    return { text: restored, markers: "none" };
  };
  const coverageGaps: ReadingCoverageGap[] = [];
  let readingQuotes = 0;
  const perSeat = {} as VerdictQuoteSummary["per_seat"];
  for (const seat of ["adjudicator", "refuter", "silence-investigator"] as VerdictSeat[]) {
    perSeat[seat] = { records: 0, quotes: 0, confirmed: 0, no_evidence: 0, repaired: 0, parts_confirmed: 0, invalidated: 0 };
  }

  const shapeOf = new Map<RecordJob, string[]>();
  for (const job of jobs) {
    const evidence = asArray(job.holder.evidence);
    const rows: QuoteCheck[] = [];
    const notes: string[] = [];
    /* The record's outcome is FOLDED from the rows at the end rather than accumulated into a mutable
     * variable across the callback below. Both compute the same thing; only this one is a value the
     * compiler can type, because an assignment inside a closure is invisible to its flow analysis and
     * a branch on such a variable silently narrows to the values assigned in THIS scope. */
    const rowOutcomes: VerdictQuoteOutcome[] = [];
    let outcome: VerdictQuoteOutcome = "confirmed";
    /* Every row that failed, with what the report's sentence about it and the direction rule (R3) need. */
    const failed: { at: number; path: string; row: string; file: string; lines: string; reason: QuoteFailureReason; found_in?: string; trail: boolean; role: string; disposition: string; kind: string }[] = [];

    /* THE SHAPE CHECK FIRST (fix-verify-shape): see `recordShapeProblems`. A malformed record still has
     * its quotations checked below, for the reader; its outcome is `invalidated` whatever they say. */
    const shapeProblems = recordShapeProblems(job);
    shapeOf.set(job, shapeProblems);
    if (shapeProblems.length > 0) {
      malformed.push({ source: job.source, index: job.index, seat: job.seat, id: job.id, problems: shapeProblems });
      notes.push(
        `${job.path.replace(/\.evidence$/, "")}: this record is MALFORMED — ${shapeProblems.join("; ")}. A record no check can read as written is handled as invalidated, whatever its quotations say.`,
      );
    }

    if (evidence.length === 0) {
      /* A record with no evidence produces no quote-check row, so it is counted where a reader will
       * see it rather than vanishing into a quotation total that would show it as indistinguishable
       * from a record whose every quotation confirmed.
       *
       * **WHETHER IT ALSO INVALIDATES IS DECIDED PER SEAT, BY THAT SEAT'S OWN CONTRACT, AND THE
       * THREE CONTRACTS GENUINELY DIFFER.** The first version of this code invalidated all three and
       * was wrong on two of them — caught on the first real record it was pointed at, where it
       * downgraded 30 honest `apparently_absent` rows. `reconcile-verify` had already met this shape
       * and answered it the same way: a direction-B finding carries no document quotation "by
       * design", and requiring one there "discards the findings the skill calls where the value
       * is". */
      const required = evidenceIsRequired(job, asString(job.holder[CLASS_FIELD[job.seat].field]));
      if (required.required) {
        outcome = "invalidated";
        notes.push(`${job.path}: this record carries no evidence at all. ${required.because}`);
      } else if (shapeProblems.length > 0) {
        // Whether this seat's contract allows no evidence turns on the class word, and a malformed
        // record's class word cannot be read as written — so the allowance is not granted.
        outcome = "invalidated";
        notes.push(`${job.path}: this record carries no evidence at all, and whether its seat's contract allows that turns on a class field this record does not carry as written — so it is not allowed here.`);
      } else {
        /* **NOT `confirmed`. Nothing was confirmed, and saying so is the whole of the design's rule.** The
         * first version left the initial `confirmed` standing here, so every `apparently_absent`
         * silence row and every evidence-free refutation was annotated with the word the schema
         * defines as "every quotation is in the file it names, at the lines it names" — on a record
         * where no quotation was checked at all. Independent verification named it
         * as this unit's own argument turned one level up: "we looked and found nothing" and "nobody
         * looked" rendering identically in the field a downstream tool reads. `no_evidence` says the
         * second, and it is not a pass. */
        outcome = "no_evidence";
        notes.push(
          `${job.path}: this record carries no evidence at all, and its seat's own contract allows that — so NOTHING WAS CHECKED here. That is not a pass and must not be read as one; it is an absence, stated.`,
        );
      }
      noEvidence.push(
        `${job.source}${job.id ? `#${job.id}` : `[${job.index}]`} (${job.seat}${outcome === "invalidated" ? ", invalidated" : ", allowed"})`,
      );
      /* The one combination the skill asks for a quotation on. Named rather than invalidated, for
       * the reason `evidenceIsRequired` gives: the field did not exist until today. */
      if (job.seat === "refuter" && asString(job.holder.outcome) === "overturned") {
        overturnedWithoutEvidence.push(`${job.source}${job.id ? `#${job.id}` : `[${job.index}]`}`);
      }
    }

    evidence.forEach((ev, j) => {
      const declaredSource = asString(ev.file);
      const declaredLines = parseEvidenceLines(ev.lines);
      const path = `${job.path}[${j}]`;
      const quoted = restore(asString(ev.quote), declaredSource, declaredLines, path);
      const check = verifyOneQuote({
        path,
        corpus: code,
        declaredSource,
        formatting: true,
        declaredLines,
        text: quoted.text,
        preNotes: declaredSource
          ? []
          : [
              "this evidence entry names no file, so there is no source to check its quotation against",
            ],
      });
      const decided = decideRow(check, quoted.text, declaredSource, declaredLines, code, lists, quoted.markers);

      rows.push(check);
      checks.push(check);
      if (decided.outcome === "invalidated") {
        failed.push({
          at: rowOutcomes.length,
          path,
          row: `evidence[${j}]`,
          file: declaredSource,
          lines: asString(ev.lines),
          reason: failureReason(check, quoted.text, lists.contentless.includes(path), quoted.markers, check.declared.source ? code.get(check.declared.source)?.text : undefined),
          ...(check.status === "re_attributed" && check.final ? { found_in: `${check.final.source}:${check.final.lines.join("-")}` } : {}),
          trail: false,
          role: asString(ev.role),
          disposition: "",
          kind: "",
        });
      }
      rowOutcomes.push(decided.outcome);
      if (decided.note) notes.push(decided.note);
      if (check.notes.some((n) => n.startsWith(SHORT_QUOTE_NOTE_PREFIX))) shortQuotes.push(check.path);
    });

    /* THE TRAIL'S OWN QUOTATIONS, checked on exactly the terms `evidence[]`'s are (design annex
     * section 10.4: "quotes in `reading.read[]` checked").
     *
     * **Why they are checked here and not as a record of their own.** A `reading` block is not a
     * second record: it is the same seat's account of what it opened, and E1 of the design — "every
     * kind in `read` carries a verbatim quote of its representative", so that the trail holds at
     * least as many quotes as there are kinds read — is an evidence floor for THIS verdict. A
     * fabricated trail row is therefore the same defect as a fabricated evidence row and takes the
     * same route: it folds into the record's outcome, and an invalidated record moves to
     * `needs_human` with the model's own word kept beside it.
     *
     * The rows go on `reading.quote_checks` rather than into `quote_checks[]`, whose own description
     * says "one row per `evidence[]` entry, in the order they appear" — appending to it would make
     * that sentence false and would make the two arrays impossible to line up. */
    const reading = job.holder.reading as Record<string, unknown> | undefined;
    const readRows = reading && typeof reading === "object" ? asArray(reading.read) : [];
    const trailRows: QuoteCheck[] = [];
    const trailOutcomes: VerdictQuoteOutcome[] = [];
    readRows.forEach((row, j) => {
      const declaredSource = asString(row.file);
      const path = `${job.path.replace(/\.evidence$/, "")}.reading.read[${j}]`;
      const quoted = restore(asString(row.quote), declaredSource, parseEvidenceLines(row.lines), path);
      const check = verifyOneQuote({
        path,
        corpus: code,
        declaredSource,
        formatting: true,
        declaredLines: parseEvidenceLines(row.lines),
        text: quoted.text,
        preNotes: declaredSource
          ? []
          : ["this reading row names no file, so there is no source to check its quotation against"],
      });
      /* The same questions an evidence row is asked — content, redaction, and the elided-quotation
       * clause — by the same function. Until 2026-09-25 a trail row was asked none of them, so an
       * elided trail quotation of real code was invalidated where the identical evidence quotation
       * was not (the second confidence check's verdict carries one of each). */
      const decided = decideRow(check, quoted.text, declaredSource, parseEvidenceLines(row.lines), code, lists, quoted.markers);
      trailRows.push(check);
      trailOutcomes.push(decided.outcome);
      checks.push(check);
      if (decided.outcome === "invalidated") {
        failed.push({
          at: rowOutcomes.length,
          path,
          row: `reading.read[${j}]`,
          file: declaredSource,
          lines: asString(row.lines),
          reason: failureReason(check, quoted.text, lists.contentless.includes(path), quoted.markers, check.declared.source ? code.get(check.declared.source)?.text : undefined),
          ...(check.status === "re_attributed" && check.final ? { found_in: `${check.final.source}:${check.final.lines.join("-")}` } : {}),
          trail: true,
          role: "",
          disposition: asString(row.disposition),
          kind: asString(row.kind),
        });
      }
      rowOutcomes.push(decided.outcome);
      if (decided.note) notes.push(decided.note);
      if (check.notes.some((n) => n.startsWith(SHORT_QUOTE_NOTE_PREFIX))) shortQuotes.push(check.path);
      readingQuotes += 1;
    });
    /* **A SEAT NEVER SUPPLIES THIS TOOL'S OWN ANNOTATIONS**. Declaring
     * `reading.quote_checks` and `quote_check_outcome` in the schema let a seat write them and pass,
     * and they were written over only when `read[]` had rows, so with an empty trail a seat's own
     * `quote_check_outcome: "confirmed"` reached the output as if this tool had said it. Every field
     * this tool writes is therefore taken off BOTH holders first, whatever `read[]` holds and whatever
     * the record's outcome, and only what this run decided is written back. The record's own
     * `quote_check_notes` had the same hole: it is written for three outcomes of five, so a seat's
     * copy survived on a confirmed or repaired record. */
    for (const holder of [job.holder, reading] as unknown[]) {
      if (holder && typeof holder === "object") for (const key of OWN_ANNOTATIONS) Reflect.deleteProperty(holder, key);
    }
    if (reading && typeof reading === "object" && readRows.length > 0) {
      reading.quote_checks = trailRows;
      reading.quote_check_outcome = trailOutcomes.reduce(worst, "confirmed");
    }

    /* A FAILED ROW'S REACH FOLLOWS ITS DIRECTION.
     * Until then one failed row demoted its whole record, whatever the row was for (unit Q:
     * "the record is one judgment and its evidence is offered jointly"). Now:
     * - a row the conclusion stands on - an `element` or `premise` entry, a trail row saying `is_the_construct`, and
     *   every row that is not the exact dismissal below - still demotes the whole record, on any record;
     * - every row of a record whose class takes a finding OUT of the report (`not_applicable`, an `overturned`
     *   refutation, `apparently_absent`), and every row of a record of any other word, still demotes it;
     * - a row that dismisses a DIFFERENT location - a trail row saying `not_the_construct`, or the `item` entry at
     *   exactly the location such a row dismisses and no row of the record calls anything else - on a record that
     *   keeps its finding in the report (`KEEPS_FINDING`) withdraws only that dismissal: the record keeps its class
     *   with a note, the row stays failed in `quote_checks`, and the location is reported as "classification not
     *   confirmed", never as cleared. When in doubt the row demotes, which shows more, never less.
     * A malformed record is invalidated whatever its rows say, so no row of one withdraws anything. */
    /* The class word is the SEAT'S OWN, so a record reads the same in step 5a and in step 7's re-check over the log: the
     * word this check kept beside a demotion, and on a log verdict that carries a refutation, `violation_candidate` - a
     * refutation is written for no other word, and the assembly may have moved `verdict` to the merge's word
     * (`not_applicable` for an overturn, `needs_human` for a refutation the check demoted). */
    const classSpec = CLASS_FIELD[job.seat];
    const ownWord =
      job.holder[classSpec.keep] !== undefined
        ? asString(job.holder[classSpec.keep])
        : job.seat === "adjudicator" && job.holder.refutation !== null && typeof job.holder.refutation === "object"
          ? "violation_candidate"
          : asString(job.holder[classSpec.field]);
    const keeps = shapeProblems.length === 0 && ownWord === KEEPS_FINDING[job.seat];
    const dismissedAt = new Map<string, string>();
    const calledOtherwiseAt = new Set<string>();
    for (const r of readRows) {
      const key = locationKey(asString(r.file), r.lines);
      if (asString(r.disposition) === "not_the_construct") dismissedAt.set(key, asString(r.kind));
      else calledOtherwiseAt.add(key);
    }
    /* Which rows failed and why, in a form a sentence can be made of: the report says of a finding the
     * check demoted which quotation at which place could not be confirmed and why, and lists a withdrawn dismissal's
     * locations; `quote_check_notes` keep the check's own sentences for the log's reader. */
    const failures: QuoteCheckFailure[] = failed.map((f) => {
      const key = locationKey(f.file, f.lines);
      const dismissal = f.trail
        ? f.disposition === "not_the_construct"
        : f.role === "item" && dismissedAt.has(key) && !calledOtherwiseAt.has(key);
      const kind = f.trail ? f.kind : dismissedAt.get(key) ?? "";
      return {
        row: f.row,
        file: f.file,
        lines: f.lines,
        reason: f.reason,
        effect: keeps && dismissal ? "withdraws_dismissal" : "demotes",
        ...(f.found_in ? { found_in: f.found_in } : {}),
        ...(kind ? { kind } : {}),
      };
    });
    const withdrawnAt = new Set(failed.filter((_, i) => failures[i].effect === "withdraws_dismissal").map((f) => f.at));
    /* Whether another row demotes the record all the same: the effect is decided per row, so a record whose
     * element row failed can carry a withdrawn dismissal too, and its note must not say that the record keeps its class. */
    const demotedByAnother = shapeProblems.length === 0 && rowOutcomes.filter((_, i) => !withdrawnAt.has(i)).reduce(worst, outcome) === "invalidated";
    for (const [i, f] of failed.entries()) {
      if (failures[i].effect !== "withdraws_dismissal") continue;
      withdrawnDismissals.push(f.path);
      notes.push(
        `${f.path} (${f.file || "(no file named)"}:${f.lines || "no line"}) dismissed a location other than the ones this record's conclusion stands on, and the check could not confirm its quotation. That dismissal alone is withdrawn: the location${failures[i].kind ? `, and every member of kind ${failures[i].kind} a cover row settled by it,` : ""} is reported as "classification not confirmed", never as cleared, ${demotedByAnother ? "but the record does not keep its class: another of its rows failed the check and demotes the whole record (a failed quotation demotes its record; the change of 2026-09-29 left that reach as it was)" : KEEPS_CLASS}. The coverage check still counts the row as read, because the seat opened it; what it cannot confirm is the classification.`,
      );
    }

    // The annotation goes onto the child's own object, beside what it wrote and never over it.
    const recordOutcome: VerdictQuoteOutcome =
      shapeProblems.length > 0 ? "invalidated" : rowOutcomes.filter((_, i) => !withdrawnAt.has(i)).reduce(worst, outcome);
    job.holder.quote_checks = rows;
    job.holder.quote_check_outcome = recordOutcome;
    if (failures.length > 0) job.holder.quote_check_failures = failures;
    if (recordOutcome === "invalidated") {
      /* THE DEMOTION HOLDS WHATEVER THE RECORD'S SHAPE (fix-verify-shape, 2026-09-24). It used to run
       * only where the class field was a string, so live run 1's two invalidated records that carried
       * their label under `class` (fp_aeaad69dc0f631b8, fp_8c3088920d36230f) kept `not_applicable`.
       * Now the class field takes the invalid word whether it was a word, something else or absent,
       * and every OTHER field carrying one of the seat's class words takes it too, each with the
       * value it had kept beside it — so no field of an invalidated record states a label other than
       * its seat's invalid word. The silence seat's two containers differ; see `invalidWordFor`. */
      const spec = CLASS_FIELD[job.seat];
      const before = job.holder[spec.field];
      const invalid = invalidWordFor(job, before);
      if (before !== invalid) {
        if (before !== undefined) job.holder[spec.keep] = before;
        job.holder[spec.field] = invalid;
        notes.push(
          typeof before === "string"
            ? `${spec.field} was "${before}" and is now "${invalid}"; the word the model wrote is kept in ${spec.keep}. Nothing was deleted and nothing was re-adjudicated — what to do about this record is the orchestrator's, with the file open.`
            : `${spec.field} was ${describeValue(before)} and is now "${invalid}"${before !== undefined ? `; what the record held there is kept in ${spec.keep}` : ""}. Nothing was deleted and nothing was re-adjudicated — what to do about this record is the orchestrator's, with the file open.`,
        );
      }
      for (const key of strayLabelFields(job)) {
        const was = job.holder[key];
        if (was === invalid) continue;
        const keep = `${key}_before_quote_check`;
        job.holder[keep] = was;
        job.holder[key] = invalid;
        notes.push(
          `the field ${key} carried the class word "${String(was)}" and now carries "${invalid}"; the word is kept in ${keep}. It is not this seat's class field, and an invalidated record states no label but "${invalid}" in any field.`,
        );
      }
      job.holder.quote_check_notes = notes;
    } else if (recordOutcome === "parts_confirmed" || recordOutcome === "no_evidence" || withdrawnAt.size > 0) {
      /* The record-level disclosure. Before this, `quote_check_notes` was written ONLY for an
       * invalidated record, so a reader who stopped at the record saw a bare outcome word and was
       * told nothing — which for an elision meant "position corrected" about a quotation that exists
       * in no file, and for a no-evidence record meant "confirmed" about nothing at all. */
      job.holder.quote_check_notes = notes;
    }

    perSeat[job.seat].records += 1;
    perSeat[job.seat].quotes += rows.length;
    perSeat[job.seat][recordOutcome] += 1;

    const entry: VerdictQuoteRecord = {
      source: job.source,
      index: job.index,
      seat: job.seat,
      id: job.id,
      outcome: recordOutcome,
      notes,
      record: job.record,
    };
    records.push(entry);
    if (job.kind === "second_look") secondLookEntries.add(entry);
  }
  /* M5 of an internal record: a record whose refutation fails the check is demoted all the same,
   * and the refutation's rows are another holder's, decided in its own turn of the loop above; so the note on an
   * adjudicator's withdrawn dismissal is settled here, once every holder is, and never says the record keeps its class
   * where its refutation demotes it. A refutation whose entry does not stand (`supersededRefutations`) is
   * no refutation of the record, and its failure demotes nothing. */
  const refutationFailed = new Set(
    // A second look (`mode: "challenge"`) moves the finding's placement, never its record's class.
    records.filter((r) => r.seat === "refuter" && r.outcome === "invalidated" && !opts.supersededRefutations?.has(r.source) && (r.record as Record<string, unknown> | undefined)?.mode !== "challenge" && !secondLookEntries.has(r)).map((r) => r.id),
  );
  for (const r of records) {
    if (r.seat !== "adjudicator" || !refutationFailed.has(r.id)) continue;
    for (let k = 0; k < r.notes.length; k++) r.notes[k] = r.notes[k].split(KEEPS_CLASS).join(REFUTATION_DEMOTES);
  }

  /* THE COVERAGE CHECK.
   *
   * It runs only where the caller passed `--findings`, because the census is what a `reading` block
   * is checked AGAINST: the block says which same-kind line group was read, covered or left, and the
   * groups and their members are in the scan's own document. What it refuses is stated in
   * `checkReadingCoverage` and not restated here; what this loop adds is which records it runs over,
   * and that is every ADJUDICATOR record whose candidate the document carries. **The refuter's own
   * `reading` block is deliberately not checked**: a
   * refuter is asked to try to overturn the candidate on the grounds its brief lists, not to
   * classify every kind, and requiring it to would make every refutation of a 670-kind candidate a
   * second full reading of it.
   *
   * NOTHING IS RE-ADJUDICATED AND NO VERDICT WORD IS MOVED BY A GAP. A gap is reported, the run
   * exits 5, and what to do about it belongs to the orchestrator with the document open — the same
   * discipline the quote check keeps one paragraph up. */
  if (opts.fromFindings) {
    const byId = new Map<string, Candidate>();
    for (const c of opts.fromFindings.findings.candidates ?? []) byId.set(c.finding_id, c);
    const checked = new Set<string>();
    for (const job of jobs) {
      if (job.seat !== "adjudicator") continue;
      const candidate = byId.get(job.id);
      if (!candidate) {
        /* A VERDICT THAT NAMES NO CANDIDATE OF THE DOCUMENT IS A GAP, NOT A SKIP (fix-verify-shape). It
         * used to be passed over in silence, and a verdict directory's record with no `finding_id` is
         * keyed by its `rule_id` — which names no candidate — so it was never coverage-checked and the
         * summary still said every group of every candidate was accounted for. */
        const named = asString(job.holder.finding_id);
        coverageGaps.push({
          check: "verdict-unmatched",
          finding_id: named || `${job.source}[${job.index}]`,
          problem: named
            ? `this record names finding_id ${JSON.stringify(named)}, which is not a candidate of ${opts.fromFindings.path}, so its reading was checked against no census.`
            : `this record carries no finding_id, so it names no candidate of ${opts.fromFindings.path} and its reading was checked against no census.`,
        });
        continue;
      }
      // One candidate is checked once, however many inputs named it: the same verdict read out of a
      // verdicts directory and out of an assembled log is one verdict, and reporting its gap twice
      // would make a reader count two.
      if (checked.has(job.id)) continue;
      checked.add(job.id);
      /* A candidate with no kind census and a record with no reading block has no trail to check -
       * but it still RESTS ON something (unit H): the files its seat quoted, the searches it ran,
       * the clause it was given. 4 of the 12 records of the U4 run are of exactly that shape, and
       * skipping them here made `rests-on-missing` and `rests-on-incomplete` unreachable for a
       * third of the real material. So such a record is still checked when it carries a premise
       * block, or when the caller asked for one; `checkReadingCoverage` runs the premise checks
       * before its census branch and returns nothing else over a record with no trail. */
      // The check of one record is reading.ts `recordCoverageGaps`, which the capture runs too: null is
      // the record with no trail to check.
      const gaps = recordCoverageGaps(candidate, job.holder, opts.requireRestsOn === true);
      if (gaps === null) continue;
      const shape = shapeOf.get(job) ?? [];
      if (shape.length > 0) {
        coverageGaps.push({
          check: "verdict-shape",
          finding_id: job.id,
          problem:
            `this record is malformed: ${shape.slice(0, 4).join("; ")}${shape.length > 4 ? ` (and ${shape.length - 4} more)` : ""}. ` +
            "It has been handled as invalidated, and the coverage check below reads the same record: what cannot be read as written is not admitted as covered.",
        });
      }
      const violations = schemaViolations.get(job.id);
      if (violations) {
        coverageGaps.push({
          check: "verdict-schema",
          finding_id: job.id,
          problem:
            `this record does not validate against verdict.schema.json: ${violations.slice(0, 4).join("; ")}` +
            `${violations.length > 4 ? ` (and ${violations.length - 4} more)` : ""}. ` +
            "The coverage check below reads the same record, and what the schema refuses it must not admit.",
        });
      }
      coverageGaps.push(...gaps);
    }

    /* A CANDIDATE NO RECORD NAMES IS A GAP, NOT A PASS.
     *
     * The loop above runs over the records, so a candidate with no record was never looked at: an
     * empty verdicts directory, a file holding `[]`, an unparseable file that `verdict-reading` left
     * out of the assembly, or a lost reply all passed at exit 0 with the summary saying every group
     * of every candidate was accounted for. Every candidate of the document is now named by an
     * adjudicator record or is a `verdict-missing` gap.
     *
     * An evidence log says for itself what it did not adjudicate - `pre_settled[]` (the person's
     * declaration), `unadjudicated[]` (the run shape) and `suppressions[]` (a human's decision) - and
     * its carried verdicts are in `verdicts[]`, so a candidate named there is accounted for. A
     * verdicts directory says none of that: the pre-launch step's plan does, and this command is not
     * given the plan. So a candidate carried forward, settled by the declaration or left by the
     * chosen shape is reported here with every other candidate that has no record, and the gap says
     * so. A check that cannot tell a carried verdict from a lost one reports; it does not pass. */
    const named = new Set<string>();
    for (const job of jobs) {
      if (job.seat === "adjudicator" && asString(job.holder.finding_id)) named.add(asString(job.holder.finding_id));
    }
    const accountedInLog = new Set<string>();
    const logDoc = opts.fromLog?.log as unknown as Record<string, unknown> | undefined;
    for (const key of ["pre_settled", "unadjudicated", "suppressions"]) {
      for (const row of Array.isArray(logDoc?.[key]) ? (logDoc?.[key] as unknown[]) : []) {
        const id = row && typeof row === "object" ? asString((row as Record<string, unknown>).finding_id) : "";
        if (id) accountedInLog.add(id);
      }
    }
    const where = [opts.fromDir ? `the verdicts directory` : "", opts.fromLog ? `the log ${opts.fromLog.path}` : ""].filter(Boolean).join(" or ");
    for (const c of byId.values()) {
      const id = asString(c.finding_id);
      if (!id || named.has(id) || accountedInLog.has(id)) continue;
      coverageGaps.push({
        check: "verdict-missing",
        finding_id: id,
        problem:
          `no adjudicator record in ${where} names this candidate of ${opts.fromFindings.path}, so it has no verdict: it was not confirmed, not dismissed and not checked. ` +
          "A verdict file that is missing, empty or unreadable leaves exactly this." +
          (opts.fromLog ? " The log does not name it in pre_settled[], unadjudicated[] or suppressions[] either." : "") +
          (opts.fromDir
            ? " A candidate the pre-launch step carried forward or settled by the person's declaration, or one the chosen run shape did not reach, has no record in a verdicts directory either; this command is not given the plan (.legal/adjudicate-plan.json), so it cannot tell those from a lost verdict and reports every candidate with no record."
            : ""),
      });
    }
  }

  /* The file digests. Read through the SAME confinement predicate the corpus reads through, and not
   * a second copy of it: `resolveUnderTarget` is exported from `reconcile-verify.ts` for exactly this
   * caller. A file the corpus refused is named with its reason rather than hashed. */
  const filesRead: { path: string; sha256: string; bytes: number }[] = [];
  const binaryFiles: { path: string; bytes: number }[] = [];
  for (const name of codeNames) {
    const refusal = refuseAgentOutput(name);
    if (refusal) {
      filesRefused.push({ path: name, problem: refusal });
      continue;
    }
    const where = resolveUnderTarget(opts.targetRoot, name);
    if (where.problem) {
      filesRefused.push({ path: name, problem: where.problem });
      continue;
    }
    try {
      /* **The same "is this a file?" question the corpus asks, in the same words**. Without it a
       * directory came back `EISDIR` here and "exists under --target but is not a file" there — one
       * path, one run, two wordings, and a reader cannot tell whether that is one problem or two. */
      if (!statSync(where.abs).isFile()) {
        filesRefused.push({ path: name, problem: "the path exists under --target but is not a file" });
        continue;
      }
      const bytes = readRegularFile(where.abs);
      filesRead.push({ path: name, sha256: projectFileDigest(bytes), bytes: bytes.length });
      /* **A file whose bytes are not text is DISCLOSED, and until now it was not**. The corpus
       * reads with `utf8`, so a PDF or a UTF-16 `.strings` decodes to replacement characters and NUL
       * runs, and a quotation of whatever ASCII survives CONFIRMS against that mojibake with nothing
       * saying so — `decodedTextIsBinary` guards the pillar-2 extraction path and never this one.
       * The status is not changed: the bytes really are there and a quotation of them really did
       * match, so calling it invalidated would assert a defect nobody has shown. What is added is the
       * sentence a reader needs to weigh it, and the byte count beside it, which is also the honest
       * answer to "there is no size bound here": this run says how much it read of what. */
      if (decodedTextIsBinary(decodeSourceText(bytes))) binaryFiles.push({ path: name, bytes: bytes.length });
    } catch (e) {
      filesRefused.push({ path: name, problem: `not readable under --target (${(e as Error).message})` });
    }
  }

  const { counts, fallback_anchored } = countQuoteChecks(checks);
  const outcomes = emptyOutcomes();
  for (const r of records) outcomes[r.outcome] += 1;

  const summary: VerdictQuoteSummary = {
    tool: "verdict-verify",
    verifier_version: QUOTE_VERIFIER_VERSION,
    mapping_version: VERDICT_QUOTE_MAPPING_VERSION,
    counts,
    fallback_anchored,
    total: checks.length,
    outcomes,
    records: records.length,
    per_seat: perSeat,
    no_evidence: noEvidence,
    overturned_without_evidence: overturnedWithoutEvidence,
    short_quotes: shortQuotes,
    elided_quotes: elided,
    redacted_quotes: redacted,
    restored_redactions: restoredRedactions,
    withdrawn_dismissals: withdrawnDismissals,
    contentless_quotes: contentless,
    files_read: filesRead,
    files_refused: filesRefused,
    reader_replies_excluded: readerRepliesExcluded,
    malformed,
    binary_files: binaryFiles,
    reading_quotes: readingQuotes,
    coverage_checked: opts.fromFindings ? opts.fromFindings.path : null,
    coverage_gaps: coverageGaps,
    not_verified_here: [
      "Whether a quotation, once verified as real and correctly placed, supports the verdict it is attached to. The design says it plainly: a weaker adjudicating model also produces CORRECTLY QUOTED WRONG JUDGMENTS, which this check cannot catch by construction. Reading comprehension belongs to the refuter and to the human reader.",
      "Which file a quotation came from, where two files carry the same text, or text that is the same once formatting is set aside (a space before a list comma, a typographic mark, a Unicode form: tier T2n). A quotation copied out of one file's neighbour confirms in whichever file the record names, so this bounds a context leak between files rather than closing it.",
      opts.fromFindings
        ? "Whether a quotation, once found, settles the kind it was taken for. The coverage check ran over this document's candidates and says every matched location is classified read, covered or not read, with covered only inside a group whose representative was read - and it says nothing about whether the reading was right. A representative dismissed on a ground its members do not share is a defect no count can see."
        : "Whether the verdict covers every location of its candidate. THE COVERAGE CHECK DID NOT RUN: no --findings document was given, so there was no census to check the verdicts' `reading` blocks against. A verdict quoting one line of a group of seventy is checked on that line and says nothing about the other sixty-nine.",
      "Whether a `not_applicable` was right to dismiss, and whether a rule the silence investigator called absent is absent. THE ABSENCE OF A FINDING IS UNKNOWN, and a confirmed quotation does not change that in either direction.",
      opts.fromFindings
        ? "Anything about a record this run did not read. A verdict file that holds no record, or that cannot be read as JSON, is listed in malformed[] and fails the run; a candidate of the findings document that no adjudicator record names is a `verdict-missing` gap, whatever the reason its record is absent."
        : "Anything about a record this run did not read. A verdict file that holds no record, or that cannot be read as JSON, is listed in malformed[] and fails the run; a verdict file that is missing altogether is invisible here, because without --findings nothing says which candidates were to be answered.",
      ...(schemaUnavailable
        ? [
            `Whether each record has the SHAPE verdict.schema.json requires. THE SCHEMA CHECK DID NOT RUN: ${schemaUnavailable} What ran in its place is the shape check of the fields THIS tool reads — each seat's class word, a second field carrying one, finding_id, the evidence and reading.read rows, rests_on — and a record failing it is listed in malformed[] and invalidated. Any other field outside the schema, or a missing required one no check here reads, passed unseen.`,
          ]
        : []),
    ],
  };

  return {
    report: {
      tool: "verdict-verify",
      target: opts.displayTarget ?? opts.targetRoot,
      inputs,
      summary,
      records,
    },
    checks,
    target_problem: targetProblem,
  };
}

/** 0 when nothing was invalidated; EXIT_NOT_FULLY_VERIFIED when anything was. */
export function verdictQuoteExitCode(result: VerifyVerdictQuotesResult): number {
  /* A COVERAGE GAP EXITS 5 ON EXACTLY THE SAME TERMS A FABRICATED QUOTATION DOES, and it is the same
   * duty: a record whose reading cannot be verified as written must not reach a user as it stands.
   * A verdict that leaves a same-kind line group in neither `read` nor `not_read` is a verdict whose
   * own account of what it read does not add up, and a `not_applicable` over an unread tail is a
   * dismissal of lines nobody opened. */
  const summary = result.report.summary;
  if (summary.outcomes.invalidated > 0) return EXIT_NOT_FULLY_VERIFIED;
  // A malformed entry that never became a job (a non-object, an unparseable file, a log with no
  // verdict list) is invalidated nowhere else, and it must not pass at exit 0 (fix-verify-shape).
  if ((summary.malformed ?? []).length > 0) return EXIT_NOT_FULLY_VERIFIED;
  return (summary.coverage_gaps ?? []).length > 0 ? EXIT_NOT_FULLY_VERIFIED : EXIT_ALL_VERIFIED;
}

/* --------------------------------------------------------------------------------------------- *
 * The console.
 * --------------------------------------------------------------------------------------------- */

function oneLine(text: string): string {
  return text.replace(/\n/g, "\\n");
}

/**
 * What a person reads at the end of a run.
 *
 * The invalidated records are printed FIRST, before any count, and each one carries its reasons. A
 * count at the top of a screen is read as a score; a list of records whose quotations are not where
 * they were said to be is read as the thing to act on, which is what it is. Same order and same
 * reasoning as `summarizeQuoteVerification`.
 */
/**
 * `keptInvalid`: the candidates step 6 reports as not judged because their seat's answer was kept invalid (the hooks'
 * ledger, read by the `--legal` option through the not-judged rule, entry-answer.ts), each with its seat, entry and kept
 * file. NO VERDICT names them as such (m5 of the integration verification). The check and its report do not read it.
 */
export function summarizeVerdictQuotes(
  result: VerifyVerdictQuotesResult,
  outPath: string,
  keptInvalid?: ReadonlyMap<string, { entry: string; role: string; seat: string; kept: string }>,
): string {
  const s = result.report.summary;
  const out: string[] = [];
  const invalidated = result.report.records.filter((r) => r.outcome === "invalidated");
  const repaired = result.report.records.filter((r) => r.outcome === "repaired");
  const partsOnly = result.report.records.filter((r) => r.outcome === "parts_confirmed");

  if (result.target_problem) out.push(`${result.target_problem}\n`);

  if (invalidated.length > 0) {
    out.push(
      `INVALIDATED — ${invalidated.length} record(s) cite a quotation that is not where they say it is. ` +
        `Each one has been routed to the weakest word its own vocabulary has, with the word the model wrote kept beside it. ` +
        `Nothing has been deleted and nothing has been re-adjudicated: every record below is still here, exactly as written, with its reasoning and its quotations.`,
    );
    invalidated.forEach((r, i) => {
      out.push(`  ${i + 1}. ${r.source}[${r.index}]${r.id ? ` — ${r.id}` : ""} (${r.seat})`);
      for (const n of r.notes) out.push(`     ${n}`);
    });
    out.push("");
  }

  const malformedList = s.malformed ?? [];
  if (malformedList.length > 0) {
    out.push(
      `MALFORMED — ${malformedList.length} record(s) do not have the shape the checks read: a class word missing or outside the seat's own list, a second field carrying one, ` +
        "a missing finding_id, or evidence, reading or rests_on that is not the list or object its check reads. Each one is handled as INVALIDATED: its class field now holds its seat's weakest word, " +
        "with what it held kept beside it. Nothing was deleted and nothing was re-adjudicated.",
    );
    malformedList.forEach((m, i) => {
      out.push(`  ${i + 1}. ${m.source}[${m.index}]${m.id ? ` — ${m.id}` : ""} (${m.seat})`);
      for (const p of m.problems) out.push(`     ${oneLine(p)}`);
    });
    out.push("");
  }

  const allGaps = s.coverage_gaps ?? [];
  const missing = allGaps.filter((g) => g.check === "verdict-missing");
  const gaps = allGaps.filter((g) => g.check !== "verdict-missing");
  if (missing.length > 0) {
    const invalidHere = missing.filter((g) => keptInvalid?.has(g.finding_id));
    out.push(
      `NO VERDICT — ${missing.length} candidate(s) of ${s.coverage_checked} are named by no adjudicator record. Each is a coverage gap and the run exits ${EXIT_NOT_FULLY_VERIFIED}: ` +
        "a candidate with no verdict was not confirmed, not dismissed and not checked. A verdict file that is missing, empty or unreadable leaves this; " +
        "so does a candidate the pre-launch step carried forward or settled by the declaration, or one the chosen run shape did not reach, when the check is run over a verdicts directory, " +
        "because it is not given the plan and cannot tell them apart. The reason each one has no record belongs to the orchestrator, with the plan open." +
        (invalidHere.length > 0
          ? ` ${invalidHere.length} of them ${invalidHere.length === 1 ? "is a candidate" : "are candidates"} whose seat's answer the plugin's hook kept invalid after its refusals (the hooks' ledger), marked below: ` +
            "step 6 reports each as not judged, naming the seat and the kept answer, and nothing else is to be done about them here."
          : ""),
    );
    missing.forEach((g, i) => {
      const nj = keptInvalid?.get(g.finding_id);
      out.push(
        `  ${i + 1}. ${g.finding_id}${nj ? ` — kept invalid: seat ${nj.seat} (${nj.role}, entry ${nj.entry}) answered invalidly after its refusals, and its answer is kept at .legal/${nj.kept}; step 6 reports this candidate as not judged` : ""}`,
      );
    });
    out.push("");
  }
  if (gaps.length > 0) {
    out.push(
      `READING NOT ACCOUNTED FOR — ${gaps.length} gap(s) in ${new Set(gaps.map((g) => g.finding_id)).size} verdict(s). ` +
        `A verdict over a candidate read by same-kind line groups names every group it opened, every group settled by a ` +
        `representative it opened, and every group nobody opened with the reason. Below is what does not add up. Nothing has ` +
        `been re-adjudicated: what to do about each one belongs to the orchestrator, with the document open.`,
    );
    gaps.forEach((g, i) => {
      out.push(`  ${i + 1}. [${g.check}] ${g.finding_id}${g.kind ? ` — ${oneLine(g.kind)}` : ""}`);
      out.push(`     ${g.problem}`);
    });
    out.push("");
  }

  out.push(
    `verdict quote check (verifier ${s.verifier_version}, mapping ${s.mapping_version}): ` +
      `${s.records} record(s), ${s.total} quotation(s) — confirmed ${s.outcomes.confirmed}, position repaired ${s.outcomes.repaired}, parts confirmed only ${s.outcomes.parts_confirmed}, invalidated ${s.outcomes.invalidated}, nothing to check ${s.outcomes.no_evidence}` +
      `${s.coverage_checked ? `; candidates with no verdict ${missing.length}` : ""}; malformed ${malformedList.length}.`,
  );
  out.push(`  by tier: ${QUOTE_STATUSES.map((k) => `${k} ${s.counts[k]}`).join(", ")}.`);
  if ((s.reading_quotes ?? 0) > 0) {
    out.push(
      `  ${s.reading_quotes} of those quotation(s) come from a verdict's \`reading.read[]\` trail rather than from its \`evidence[]\` — ` +
        `the record of what was READ, beside the record of what the finding is SHOWN with.`,
    );
  }
  if (s.coverage_checked === null || s.coverage_checked === undefined) {
    out.push(
      "  the reading coverage check DID NOT RUN: no --findings document was given, so no verdict's `reading` block was checked " +
        "against the census of its candidate. That is an absence, not a pass.",
    );
  } else if (gaps.length === 0) {
    out.push(
      `  reading coverage checked against ${s.coverage_checked}: every same-kind line group of every candidate ${missing.length > 0 ? "a record answers " : ""}is read or is ` +
        "declared not read, every covered member sits under a group whose representative was read, and the member counts add up.",
    );
  }
  for (const seat of ["adjudicator", "refuter", "silence-investigator"] as VerdictSeat[]) {
    const p = s.per_seat[seat];
    if (p.records === 0) continue;
    out.push(
      `  ${seat}: ${p.records} record(s), ${p.quotes} quotation(s) — confirmed ${p.confirmed}, repaired ${p.repaired}, parts only ${p.parts_confirmed}, invalidated ${p.invalidated}, nothing to check ${p.no_evidence}.`,
    );
  }

  if (repaired.length > 0) {
    out.push(
      `  positions corrected (the record's own numbers are untouched; the correction is in quote_checks[].final). The text is in the file the record names and a line number drifted, which is the ordinary case and not a fault:`,
    );
    for (const r of repaired) {
      const moved = (r.record.quote_checks as QuoteCheck[] | undefined) ?? [];
      for (const c of moved.filter((c) => c.status === "repaired")) {
        out.push(
          `    ${c.path}: declared ${c.declared.source} line ${c.declared.lines.join(", ") || "(none)"} → found at line ${c.final?.lines.join(", ") ?? "(none)"}`,
        );
      }
    }
  }

  if (s.no_evidence.length > 0) {
    out.push(
      `  ${s.no_evidence.length} record(s) carry NO EVIDENCE at all and are counted here rather than among the quotations, because a record with no quotation produces no row and would otherwise read exactly like one whose every quotation confirmed: ${s.no_evidence.join(", ")}.`,
    );
  }
  if (partsOnly.length > 0) {
    out.push(
      `PARTS CONFIRMED, NOT THE QUOTATION — ${partsOnly.length} record(s) cite a quotation that exists in no file AS WRITTEN. Each of its parts is real, in the file the entry names, in the order written, spread within the declared span plus ${T3_MAX_TOTAL_SPAN} lines; THE LINES BETWEEN THE PARTS WERE NOT CHECKED. A reader opening the declared range will see text this check never looked at, which is the one thing an unbroken quotation would have shown.`,
    );
    for (const r of partsOnly) out.push(`  ${r.source}[${r.index}]${r.id ? ` — ${r.id}` : ""} (${r.seat})`);
    out.push("");
  }

  if (s.elided_quotes.length > 0) {
    out.push(
      `  ${s.elided_quotes.length} quotation(s) are ELIDED — written in parts joined by "..." — and every part was found on its own, in the file the entry names, in the order written, spread within the declared span plus ${T3_MAX_TOTAL_SPAN} lines. Their records take PARTS CONFIRMED, NOT confirmed and NOT position-repaired, and nothing here says the parts are adjacent: ${s.elided_quotes.slice(0, 8).join(", ")}${s.elided_quotes.length > 8 ? ` (+${s.elided_quotes.length - 8} more)` : ""}.`,
    );
  }
  if (s.contentless_quotes.length > 0) {
    out.push(
      `  ${s.contentless_quotes.length} quotation(s) carry NO CONTENT OF THEIR OWN — punctuation only, a placeholder such as "null" or "none", or a bare keyword — and are invalidated whatever the search found, because finding those characters in a file shows nothing about it: ${s.contentless_quotes.slice(0, 8).join(", ")}${s.contentless_quotes.length > 8 ? ` (+${s.contentless_quotes.length - 8} more)` : ""}.`,
    );
  }
  if (s.redacted_quotes.length > 0) {
    out.push(
      `  ${s.redacted_quotes.length} quotation(s) carry a REDACTION MARKER and are therefore not verbatim by their own record's account — the ordinary shape of a credential finding, where the child was right not to copy the value. They cannot be confirmed by any mechanical means and are counted among the invalidated, which for a credential finding is the correct place: a person has to look. NONE of them is evidence that anything was fabricated: ${s.redacted_quotes.slice(0, 8).join(", ")}${s.redacted_quotes.length > 8 ? ` (+${s.redacted_quotes.length - 8} more)` : ""}.`,
    );
  }
  const withdrawnRows = s.withdrawn_dismissals ?? [];
  if (withdrawnRows.length > 0) {
    out.push(
      `  ${withdrawnRows.length} quotation row(s) dismissed a location other than the ones their record's conclusion stands on and could not be confirmed: each withdrew only its own dismissal, the record kept its class, and the location is reported as classification not confirmed, never as cleared (the quotation check's rule since 2026-09-29). The coverage check still counts such a row as read: ${withdrawnRows.slice(0, 8).join(", ")}${withdrawnRows.length > 8 ? ` (+${withdrawnRows.length - 8} more)` : ""}.`,
    );
  }
  const restoredRows = s.restored_redactions ?? [];
  if (restoredRows.length > 0) {
    out.push(
      `  ${restoredRows.length} quotation(s) carried this program's own redaction marker (baseline-002) and were checked with the marked text restored from the named file by its digest; the record keeps the marker: ${restoredRows.slice(0, 8).join(", ")}${restoredRows.length > 8 ? ` (+${restoredRows.length - 8} more)` : ""}.`,
    );
  }
  if (s.overturned_without_evidence.length > 0) {
    out.push(
      `  ${s.overturned_without_evidence.length} refutation(s) OVERTURNED a candidate and quoted nothing. Not invalidated — the schema had no field for a refuter's quotation before 2026-09-17, so a record written earlier carries none by construction — but named, because an overturn is what takes a finding out of the report body and the skill asks for the quotation it rests on: ${s.overturned_without_evidence.join(", ")}.`,
    );
  }
  if (s.short_quotes.length > 0) {
    out.push(
      `  ${s.short_quotes.length} quotation(s) collapse to fewer than 8 characters. Their status is unchanged — thin evidence and absent evidence are different results — and they identify less than a longer quotation would: ${s.short_quotes.slice(0, 8).join(", ")}${s.short_quotes.length > 8 ? ` (+${s.short_quotes.length - 8} more)` : ""}.`,
    );
  }
  if (s.binary_files.length > 0) {
    out.push(
      `  ${s.binary_files.length} file(s) a record quoted do NOT decode as text — a PDF, a UTF-16 source file, or another non-UTF-8 encoding. A quotation of whatever ASCII survives the decoding still matches, so the status above is unchanged and is not a finding that anything was fabricated; what it is not is a check against the file a person would open: ${s.binary_files.map((f) => `${f.path} (${f.bytes} bytes)`).join(", ")}.`,
    );
  }
  if (s.reader_replies_excluded.length > 0) {
    out.push(
      `  ${s.reader_replies_excluded.length} file(s) hold a READER'S REPLY - an array of disposition rows with no verdict word - and were excluded from the verdict population:`,
    );
    for (const f of s.reader_replies_excluded) out.push(`    ${oneLine(f.path)} — ${f.rows} disposition row(s)`);
    out.push(
      "    A reader's rows are folded into a verdict's trail by `verdict-reading`; read as verdicts they are records with no evidence, which is what invalidated 104 of them in one recorded run.",
    );
  }
  if (s.files_refused.length > 0) {
    out.push(`  ${s.files_refused.length} path(s) named by a record were NOT opened:`);
    for (const f of s.files_refused) out.push(`    ${oneLine(f.path)} — ${f.problem}`);
  }
  out.push(
    `  ${s.files_read.length} file(s) were read and their sha256 recorded in files_read[]. That is the FILE half of what a later carry-forward step needs and is not the whole of it: the searches a child ran are not recorded here, so nothing may be carried forward on this record alone.`,
  );
  for (const line of s.not_verified_here) out.push(`  not verified here: ${line}`);

  out.push(`\nWritten to ${outPath}. No input to this command was modified.`);
  /* THE LAST LINE STATES THE CODE THE PROCESS EXITS WITH, AND WHY. It said
   * "Exit 0" whenever nothing was invalidated, while a malformed entry or a coverage gap exits 5. */
  const code = verdictQuoteExitCode(result);
  const why = [
    s.outcomes.invalidated > 0 ? `${s.outcomes.invalidated} record(s) were invalidated` : "",
    malformedList.length > 0 ? `${malformedList.length} malformed entr${malformedList.length === 1 ? "y" : "ies"}` : "",
    missing.length > 0 ? `${missing.length} candidate(s) with no verdict` : "",
    gaps.length > 0 ? `${gaps.length} reading coverage gap(s)` : "",
  ].filter(Boolean);
  out.push(
    code === EXIT_ALL_VERIFIED
      ? `Exit ${EXIT_ALL_VERIFIED}: every quotation was found in the file its record names — at the line declared${repaired.length > 0 ? ", or at a corrected one" : ""}.`
      : `Exit ${code}: ${why.join("; ")}.` +
          (s.outcomes.invalidated > 0
            ? " Each invalidated record is now the weakest word its vocabulary has and must be reported as one; a record whose quotation could not be verified as written must not reach a user as a candidate."
            : ""),
  );
  return out.join("\n");
}
