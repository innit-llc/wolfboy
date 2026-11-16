/**
 * Mechanical verification of a pillar-2 report's quotations against the inputs it was drawn from.
 *
 * ## What this is
 *
 * `reconcile` writes `reconcile-input.json` — the documents' extracted text with their own line
 * numbers, and a census of what the code does. The `declaration-reconcile` skill reads that and an
 * AGENT writes `declarations.json`: claims quoted from the documents, findings quoting both the
 * documents and the source, checklist answers quoting the documents, and searches listing the
 * source lines they matched. Every one of those quotations is a string the agent typed. This file
 * checks each one against the text it claims to come from, and says where it really is.
 *
 * **Three commands run this waterfall, and only this one runs anywhere.** `reconcile-verify` checks
 * a declarations report; `questionnaire verify` checks the evidence quotations and search hits in an
 * answers document drafted for a questionnaire the user received from somebody else; `verdict-verify` checks the quotations in every layer-2 record — adjudicator verdicts,
 * refutations and silence investigations. All three call `verifyOneQuote`, `buildCodeCorpus`,
 * `countQuoteChecks`, `quoteExitCodeFor`, `renderQuoteAlarms` and `renderNotVerifiedExitLine` from
 * here rather than carrying a copy of any of them — for the reason the next section gives, which is
 * that this algorithm has already been independently rebuilt three times and two of the rebuilds
 * shipped the identical bug. The few sentences that differ between the callers are supplied as a
 * `QuoteAlarmVoice`.
 *
 * **What the third caller does differently is what it does with a status, never how a status is
 * reached.** The tiers, the floors and the five words are identical; `verdict-verify` maps
 * `re_attributed` and `ambiguous` onto an invalidated verdict where pillar 2 keeps the item and
 * flags it, because a quotation that is real and is in a DIFFERENT file from the one the record
 * names is, for a layer-2 child holding several files at once, the context leak rather than a
 * citation slip. That mapping lives in `verdict-verify.ts` and not here.
 *
 * **The one exception is a tier, and it is asked for, never assumed (2026-09-29).** T2n, which finds a
 * quotation that differs from its source only in formatting, runs only for a job that says
 * `formatting: true`, and only `verdict-verify` says it. The reason is what a failed row costs. In
 * pillar 2 it sends the agent back to correct its transcription of the developer's own published words,
 * and a curly apostrophe typed straight is exactly the defect that step exists to catch
 * (a test, hole 8). In `verdict-verify` it invalidates a whole layer-2
 * judgment, which a space deleted beside a comma must not do. Every other tier is run identically by all
 * three callers, from this file.
 *
 * ## Why it exists
 *
 * `declaration-reconcile/SKILL.md` names the failure this pillar has to be built against:
 * "Confabulating a contradiction is the worst failure mode this pillar has. It is worse than a
 * pillar-1 false positive, because it accuses a developer of misleading their users, using their
 * own published words as the weapon." A quotation that is not in the document is that failure in
 * its purest form, and nothing before this step could see it: the schema requires a `quote`, and a
 * fabricated string satisfies the schema exactly as well as a real one.
 *
 * The dev-loop sweep hit the same wall on the code side and measured it. A tool
 * re-derived the position of every fact three sweeps had declared, and found the declared position
 * wrong more often than right: on one tree, 263 of 524 rows came back `repaired`, 4 more
 * `re_attributed` to a different file entirely, and 55 quotes were not found anywhere at all.
 * Declared positions drift; declared TEXT is usually real. So the position is never trusted, and
 * the text is what is searched for.
 *
 * ## The waterfall, and why it is this waterfall
 *
 * The tier order, the length floors and the coherence bounds below are ported from
 * a tool, whose header records what each of them was measured against and which
 * adversarial verification put it there (PROBE_VERSION 2, 3 and 4). They are not re-derived here.
 * That file's own opening lesson is why: three dev-loop runs each rebuilt the probe from prose, two
 * shipped the identical first-version bug (comparing whole lines for equality instead of searching
 * for the quote as a substring), and the three ad hoc versions produced three incompatible output
 * schemas and silently different tier coverage. One implementation, audited once.
 *
 *   T1  Exact substring of the quote in the DECLARED source. The declared line is never trusted:
 *       the real position is recovered from a fresh search, and the declared line is then tested
 *       against it.
 *   T2  Whitespace-collapsed ("reflowed") substring, with an offset->line map built during the
 *       collapse. Floor of 16 collapsed characters in the declared source (which the agent already
 *       named, so coincidence risk is one source's worth) and 24 in any blind search of another.
 *   T2n Normalised substring (fix/quote-check-small-differences, 2026-09-29; narrowed by its fix
 *       round), ONLY for a job that asks (`QuoteJob.formatting`; see the exception above),
 *       tried only where T2 failed and at T2's own floors, counted in characters as a reader counts
 *       them. T2's whitespace plus ONE difference: a run of spaces or tabs the FILE has before a comma
 *       that is followed by whitespace may be missing from the quotation (never the other way round).
 *       Typographic quote marks, dashes and the ellipsis character are folded to their ASCII forms, and
 *       characters are compared in canonical (and width) decomposition, except where that would make an
 *       ASCII character. Every other space is kept, so a changed letter, a changed number, two words
 *       merged into one or a space moved beside an operator are still different text. See the block
 *       above `buildNormalized`, which gives the reason for each.
 *   T3  Independent-fragment verification for multi-line quotes: every non-empty line is searched
 *       on its own (floor 4, because a fragment is never the only evidence — every other fragment
 *       must match too), and the matches must be positionally coherent (strictly increasing, each
 *       consecutive gap <= 30 lines, total span <= 40) so that two real-but-unrelated lines cannot
 *       be recombined into one "verified" construct.
 *   T4  The same three tiers over every OTHER source in scope. Every match is collected, not the
 *       first: a quote matching in two or more candidates is `ambiguous`, never silently resolved.
 *   T5  First-non-empty-line fallback, declared source then the rest of the scope. Never promoted
 *       to `confirmed_at_declared` — and, because the words it does get (`repaired`,
 *       `re_attributed`) are the same words an ordinary drifted line number gets, it is marked on
 *       the check record with `fallback: true`, printed in its own console group rather than among
 *       the corrected positions, and put into the non-zero exit alongside `unverifiable`. THAT IS
 *       NOT DECORATION: a quotation whose first line is real and whose remaining lines are invented
 *       is exactly what lands on T5, so rendering it as an ordinary repair is a fabricated code
 *       line walking through the guard this file exists to be.
 *
 * A quote is searched in its raw form first and, only if that matches nowhere, retried
 * HTML-entity-decoded (`&amp;` `&lt;` `&gt;` `&quot;` `&#39;`) — the order loop-probe's PROBE_VERSION
 * 2 fix 3 settled, so a literal `&amp;` in a real template is not thrown away in favour of the most
 * generic character available before the specific search has even been tried. The retry can only
 * ever add a match, never remove one, which is the project's rule, "add a confirming path, never remove the
 * loose one".
 *
 * ## What this file will not do
 *
 * **Nothing is deleted, downgraded or silently dropped.** An unverifiable quote flags its claim or
 * finding loudly and the object stays exactly where the agent put it; the decision about what to do
 * with it belongs to the orchestrator (SKILL.md step 9), which re-reads the source and either
 * corrects the transcription or withdraws the item to `considered_and_rejected` with the reason.
 * A verifier that deleted the object would destroy the evidence of what the agent said, which is
 * the only record of the confabulation.
 *
 * **Corrections are written as an added annotation, never over the agent's own numbers.** The
 * agent's declared line is evidence. `quote_checks[]` carries `declared` (copied) beside `final`
 * (recovered), and the fields the agent wrote are returned byte for byte.
 *
 * **The original file is not touched.** The annotated document is written to a separate path
 * (`--out`, default `.legal/declarations.verified.json`).
 *
 * ## Determinism
 *
 * No clock, no randomness, no environment read. Two runs over the same report, input and tree
 * produce byte-identical output. Provenance is carried by the identifiers and digests already in
 * the two input files rather than by a timestamp, which is also what lets a gate compare the output
 * of one run against the next.
 */

import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, resolve, sep } from "node:path";
import { LOCKFILE_NAMES, MANIFEST_NAMES } from "./kind-key.js";
import { LINE_LOCATES_NOTHING_CHARS } from "./extract.js";
import { decodedTextIsBinary } from "./walk.js";
import type {
  CodeEvidence,
  DeclarationsReport,
  QuoteCheck,
  QuoteLocation,
  QuoteMatchTier,
  QuoteVerificationStatus,
  QuoteVerificationSummary,
  ReconcileInput,
} from "wolfboy-schemas";
import { readSourceText } from "./project-read.js";

/**
 * Bumped whenever the tier logic or the status vocabulary of the tiers every caller runs changes, so a
 * reader of a `declarations.verified.json` can tell which behaviour produced it; a tier only one caller
 * asks for is marked by that caller (the schema's description of `verifier_version` says the same).
 * Same role as loop-probe's
 * `PROBE_VERSION`, and deliberately its own number: the two tools share an algorithm, not a
 * lifecycle.
 *
 * Still 1 after fix/quote-check-small-differences (2026-09-29), deliberately: tier T2n runs only for a
 * job that asks for it (`QuoteJob.formatting`), neither `reconcile-verify` nor `questionnaire verify`
 * asks, and so nothing either of them writes changes. `verdict-verify`, which asks, marks the change with
 * its own `VERDICT_QUOTE_MAPPING_VERSION`.
 */
export const QUOTE_VERIFIER_VERSION = 1;

/**
 * The five outcomes, in the order they are counted and printed.
 *
 * The first four are loop-probe's own words and mean the same things they mean there. The fifth
 * differs by name and by consequence: loop-probe calls a quote it cannot find `discarded`, because
 * a sweep fact that cannot be placed is dropped from that sweep's population. Nothing is dropped
 * here — the quote is the agent's assertion about a developer's own document, so it is called
 * `unverifiable` and it is the loudest thing this tool prints.
 */
export const QUOTE_STATUSES: QuoteVerificationStatus[] = [
  "confirmed_at_declared",
  "repaired",
  "re_attributed",
  "ambiguous",
  "unverifiable",
];

/** Exit code when every quotation was verified: at the declared position or at a corrected one. */
export const EXIT_ALL_VERIFIED = 0;
/**
 * Exit code when at least one quotation could not be verified AS WRITTEN. Distinct from `scan`'s
 * codes (3 = a candidate met the severity threshold, 4 = the scan reached nothing) because it means
 * something else entirely, and the skill branches on it: an unverified quotation must not reach a
 * user.
 *
 * TWO POPULATIONS SHARE THIS CODE, deliberately, and the reason is that they carry the same duty.
 * `unverifiable` is "the text is nowhere"; a `fallback` row is "only the quotation's first line is
 * anywhere, and the rest of it is nowhere" — which is what a real first line with an invented
 * remainder looks like. Both send the agent back to the source to correct the quotation or withdraw
 * the item, so a third exit code would multiply the branches a caller has to implement while the
 * action stays identical. What it must never do is exit 0: a fallback anchor wears the word
 * `repaired`, and exiting as if it were an ordinary drifted line number is precisely how a
 * fabricated line would pass this guard.
 */
export const EXIT_NOT_FULLY_VERIFIED = 5;

/* --------------------------------------------------------------------------------------------- *
 * Constants, ported with their measurements from a tool.
 * --------------------------------------------------------------------------------------------- */

/**
 * Floor for a whitespace-collapsed match in a source the report did NOT name — T4's sweep of the
 * other documents or files in scope. A minimum
 * length gate (24 characters after collapsing) keeps false-positive risk low.
 */
export const COLLAPSE_MIN_LENGTH = 24;

/**
 * Floor for a whitespace-collapsed match in the source the report DID name. Lower, because the
 * agent already committed to this one document or this one file: the coincidence risk is one
 * source's worth of text rather than the whole scope's. Measured necessary on one tree, where a
 * real alignment-padded line collapsing to 23 characters — one under the blind gate — was missed in
 * its own declared file and recovered only through an unrelated sibling, turning a same-file
 * `repaired` into a needlessly weaker `re_attributed`.
 */
const NAMED_SOURCE_COLLAPSE_MIN_LENGTH = 16;

/**
 * Floor for one fragment of a multi-line quote under T3. Far lower than either gate above, because
 * a fragment is never the only evidence: every other fragment of the same quote must independently
 * match before the quote verifies at all, so one short fragment's coincidence risk is jointly
 * bounded by the rest. Measured necessary against a real 11-character alignment-padded fragment
 * (`$header      = [`) that a flat 24-character floor was silently discarding whole facts over.
 * Still floored rather than zero, so a bare `},` cannot be "found" everywhere.
 */
export const FRAGMENT_COLLAPSE_MIN_LENGTH = 4;

/**
 * T3 coherence, part one (loop-probe PROBE_VERSION 2 fix 1). Fragments existing SOMEWHERE is not
 * enough: two real, substantial lines that are never adjacent in the source can be recombined into
 * one construct that never existed. Real fragments of one construct are found in source order and
 * close together, so the matched positions must strictly increase with a consecutive gap no larger
 * than this.
 */
const T3_MAX_FRAGMENT_GAP = 30;

/**
 * T3 coherence, part two (loop-probe PROBE_VERSION 3 fix 1). The pairwise bound above only
 * constrains consecutive pairs, so a three-hop chain of unrelated fragments at 27-line steps clears
 * it while spanning 54 lines. The total span is therefore bounded as well, checked once after the
 * pairwise loop. A no-op for a two-fragment quote, where gap and span are the same number.
 */
export const T3_MAX_TOTAL_SPAN = 40;

/**
 * Disclosure, never rejection (loop-probe PROBE_VERSION 2 fix 1, second half). A match whose text
 * collapses to fewer than this many characters gets a note saying the evidence is thin. The status
 * is never changed by it: thin evidence and absent evidence are different results.
 */
const SHORT_QUOTE_THRESHOLD = 8;

/**
 * The boilerplate guard's own floor, deliberately lower than COLLAPSE_MIN_LENGTH. If the guard used
 * the same 24-character gate as T4's own match step, it could never report more duplicated sources
 * than T4 matched, which would make it dead code. The gap it exists to catch is that T1 has no
 * length floor at all, so a 10-20 character quote can land one exact match in one source while the
 * same text, differently formatted, sits in several others that only a lower-floor collapsed census
 * reveals.
 */
const BOILERPLATE_CENSUS_MIN_LENGTH = 8;

/**
 * How many duplicated sources the boilerplate guard tolerates before calling a single T4 match
 * ambiguous. loop-probe's threshold, kept: one or two other sources carrying the same collapsed
 * text is ordinary (a heading repeated in a policy and its summary); more than that and the single
 * match is not evidence of which source the agent meant.
 */
const BOILERPLATE_MAX_OTHER_SOURCES = 2;

/** Candidate sources listed in an `ambiguous` note before the list is capped, as in loop-probe. */
const AMBIGUOUS_NOTE_CAP = 5;

const HTML_ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};
const HTML_ENTITY_RE = /&amp;|&lt;|&gt;|&quot;|&#39;/g;

/* --------------------------------------------------------------------------------------------- *
 * Small pure utilities.
 * --------------------------------------------------------------------------------------------- */

function decodeHtmlEntities(s: string): string {
  return s.replace(HTML_ENTITY_RE, (m) => HTML_ENTITY_MAP[m] ?? m);
}

/** CR and CRLF folded to LF, so a line-ending style never costs a real match. */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n|\r/g, "\n");
}

function collapseQuote(q: string): string {
  return q.replace(/\s+/g, " ").trim();
}

function sortUnique(arr: number[]): number[] {
  return [...new Set(arr)].sort((a, b) => a - b);
}

function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

/** Largest index whose start is at or before `offset`, returned 1-indexed. */
function offsetToLine(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function findAllOccurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    out.push(idx);
    idx = haystack.indexOf(needle, idx + 1);
  }
  return out;
}

/**
 * The whitespace set the single-pass collapse recognises: space, tab, LF, CR, form feed, vertical
 * tab, no-break space and BOM. Narrower than the regex `\s`, which is what `collapseQuote` uses on
 * the short quote strings. A rare Unicode space in a file that this scan does not fold can only
 * cost a T2 match, never invent one.
 */
function isAsciiWs(code: number): boolean {
  return (
    code === 32 ||
    code === 9 ||
    code === 10 ||
    code === 13 ||
    code === 12 ||
    code === 11 ||
    code === 0xa0 ||
    code === 0xfeff
  );
}

interface CollapsedText {
  collapsed: string;
  /** For each character of `collapsed`, the 1-indexed source line it came from. */
  mapToLine: number[];
  /**
   * For each character of `collapsed`, the offset in the source text it came from — the first
   * character of the run, for a run of whitespace. Built in the same pass as `mapToLine`, so the two
   * cannot disagree. Read only by `placeRun`, which needs a match's CHARACTER range: a line number
   * cannot say whether a second part on the same line comes after the first (fix/quote-elision,
   * 2026-09-25).
   */
  mapToOffset: number[];
}

/** One O(n) pass: every run of whitespace becomes a single space, and each output character keeps
 * the source line and offset it came from, so a match in the collapsed text maps back without a
 * second scan. */
function buildCollapsed(text: string): CollapsedText {
  const outChars: string[] = [];
  const mapToLine: number[] = [];
  const mapToOffset: number[] = [];
  let currentLine = 1;
  const n = text.length;
  let i = 0;
  while (i < n) {
    const code = text.charCodeAt(i);
    if (isAsciiWs(code)) {
      mapToLine.push(currentLine);
      mapToOffset.push(i);
      outChars.push(" ");
      while (i < n && isAsciiWs(text.charCodeAt(i))) {
        if (text.charCodeAt(i) === 10) currentLine++;
        i++;
      }
    } else {
      mapToLine.push(currentLine);
      mapToOffset.push(i);
      outChars.push(text[i]);
      i++;
    }
  }
  return { collapsed: outChars.join(""), mapToLine, mapToOffset };
}

/* --------------------------------------------------------------------------------------------- *
 * T2n: the normalised form (fix/quote-check-small-differences, 2026-09-29).
 * --------------------------------------------------------------------------------------------- */

/*
 * Why this tier exists. Live run 2 (2026-09-28) invalidated the one record that covers the
 * Gravatar lookup because ONE of its thirty quotations, user-interface help text, carried `</a>,` where
 * the file has `</a> ,`: a space deleted between two tokens. T2 keeps a space wherever the file has
 * whitespace, so it could not see past that, and the whole record went to needs_human over a difference
 * in spacing, not in what the file says.
 *
 * THE RULE. T2n is T2 - every run of whitespace is one
 * space - plus ONE difference in whitespace and the character folds below. Nothing else.
 *
 * The one whitespace difference: a run of spaces or tabs that THE FILE has immediately before a comma,
 * where that comma is itself followed by whitespace or ends the file, may be missing from the quotation.
 * - One direction only (`gapsAgree`): the quotation never carries whitespace before a comma where the
 *   file has none. `X , Y` retyped as `X, Y` is the direction a writer's normalisation takes, and it is
 *   the one formatting-only difference among the 130 unconfirmed rows of two live runs (the record,
 *   item 1).
 * - Outside a value (a string or regex literal, a YAML scalar, a shell word), a comma is a token of its
 *   own in C, JavaScript, Go, CSS, JSON, YAML flow collections, MATLAB brackets, Python, Ruby and SQL: a
 *   space before it cannot split or join a token, so leaving it out changes nothing there.
 * - Not a run that holds a line break, which is syntax: Go inserts a semicolon at it after an
 *   identifier and JavaScript after `return`, Python and Ruby end a statement at it outside brackets,
 *   the shell ends the command, and MATLAB starts a new row inside brackets. Such a run must be in the
 *   quotation as whitespace, as T2 requires.
 * - Not before a comma with no whitespace after it: there a space is data rather than typing. `{a ,b}`
 *   is not a shell brace expansion and `{a,b}` is; `" ,"` is a separator and `/a ,b/` a pattern.
 * - Admitted knowingly, because no rule over characters can tell it from the live case: inside a value,
 *   `X , Y` and `X, Y` differ by that one space - a translation string (the live case), but equally a
 *   separator `" , "` or a pattern `/a , b/` - and the shell, outside quotes, puts such a comma in a word
 *   of its own (`echo a , b` passes `a`, `,` and `b`). Every letter, digit and mark of the file, and
 *   every other space, is still in the quotation in order. The gate names these cases
 *   (`t2n-residual-*`).
 * - Refused, like every other whitespace difference: a space beside an operator, a bracket, a colon, a
 *   slash or a quote mark (eighteen attempts, among them `rm -rf / tmp/cache` for
 *   `rm -rf /tmp/cache`, `.join("")` for `.join(" ")`, `total /*count` for `total / *count` and
 *   `key:value` for `key: value`), a space after a comma (`","` for `", "`), a line join, and any
 *   space the quotation adds.
 *
 * The character folds, each for a stated reason:
 * - typographic quote marks, primes and guillemets become `'` or `"`, the dashes and the minus sign
 *   `-`, and the ellipsis character `...`: the substitutions writing tools make in both directions
 *   (smart quotes, smart dashes, autocorrect), and none of them is syntax in any language above.
 *   Admitted knowingly: code whose file carries one where the ASCII mark belongs (`rm \u2013rf`, which
 *   does not run as `rm -rf`) confirms as the ASCII it was meant to be;
 * - the ASCII `'` and `"` are NOT folded into each other, and the backtick is not folded at all: in
 *   code the delimiter decides interpolation and what is a string, so swapping one changes the text;
 * - every other character is compared in canonical decomposition (NFD), so a precomposed and a
 *   decomposed accented letter are the same text, and the mark stays attached (`onWholeCharacters`).
 *   EXCEPT the three characters whose decomposition is ASCII alone: U+037E GREEK QUESTION MARK (`;`),
 *   U+1FEF GREEK VARIA (the backtick) and U+212A KELVIN SIGN (`K`). They are homoglyphs that no writing
 *   tool substitutes, and each is something else to a compiler: the Greek mark ends no statement, the
 *   varia opens no template, and the Kelvin sign makes another identifier;
 * - a halfwidth or fullwidth form is compared in its compatibility decomposition (NFKD) ONLY where that
 *   holds no ASCII character: halfwidth katakana folds to katakana, but the fullwidth forms of ASCII
 *   (U+FF01-FF5E) and U+FFE3 are compared as they are. A fullwidth digit is not a digit to `Number`
 *   (`Number("\uFF11\uFF10\uFF10")` is NaN where `Number("100")` is 100), a fullwidth letter makes
 *   another JavaScript identifier, and a table that converts fullwidth to ASCII, quoted through that
 *   fold, reads as a table that converts nothing. No other compatibility fold is
 *   made, so a superscript two is not `2`;
 * - zero-width space, word joiner and soft hyphen are dropped.
 *
 * A match must begin and end on whole characters (`onWholeCharacters`): one that stops inside a
 * decomposed character (`cafe` against `café`) or inside a folded one is not a match, so a dropped
 * accent at a quotation's edge is refused like any other changed letter. The floors count characters as
 * a reader does (`normalizedLength`), so a Hangul syllable is one character however it is encoded.
 */

/*
 * THE FILE KINDS T2n RUNS IN.
 * T2n's one whitespace difference and its character folds are allowed
 * only where the text is prose a reader reads: a document or a translation file. In a program file, a space before a
 * comma can be where a shell word, a word list, a Go struct tag, a CSV or TSV field or a split list ends (twenty of the
 * verifier's thirty-one attempts changed what the file means), and a typographic dash or quote mark is not the ASCII
 * one a program runs (`rm` followed by U+2013 `rf` does not recurse). The live case T2n was made for is a translation
 * file, and no live row needed T2n anywhere else.
 *
 * The kinds, by path, each with its reason (narrowed after a check found many
 * real GitHub workflow files, `config/db.yml`, JSON and YAML under `messages/`, `lang/` and `intl/`, and
 * almost every `.txt` - pip requirements, CMake lists, CSV data - taken for translations or documents):
 * - DOCUMENT: a prose markup format - .md, .markdown, .mdx, .rst, .adoc (`PROSE_EXT`) - wherever it sits; and a .txt
 *   only when its name says it is prose (`PROSE_TXT_NAME`: README, LICENSE or LICENCE, COPYING, NOTICE, third-party
 *   notices, CHANGELOG, CHANGES, HISTORY, NEWS, AUTHORS, CONTRIBUTORS, CREDITS, CONTRIBUTING, CODE_OF_CONDUCT, INSTALL,
 *   FAQ, which may carry a suffix such as `LICENSE-MIT.txt` or `readme_de.txt` unless it names a value, as
 *   `license_key.txt` does; and, by their exact names only, the policies this product reads: privacy, privacy-policy,
 *   terms, terms-of-service, terms-of-use, tos, eula, disclaimer, cookies, cookie-policy, imprint, legal - fastlane's
 *   `privacy_url.txt` holds a URL). Every other .txt is a program file here: pip, CMake,
 *   meson and many other tools read .txt files, and a data file is not prose;
 * - TRANSLATION: a catalogue format whose every value is text for a person - .po and .pot (gettext), .xliff and .xlf,
 *   .strings (Apple), .arb (Flutter), .resx (.NET resources) - wherever it sits; a data file (.yml, .yaml, .json,
 *   .properties, and .ftl, which is Fluent there and a FreeMarker template elsewhere) under a directory whose name means translations (`CATALOGUE_DIR`: locale, locales, i18n,
 *   l10n, translation, translations - `config/locales/client.be.yml`, the live case T2n was made for); and such a data
 *   file under a directory that holds translations in some frameworks and other data in others (`SHARED_CATALOGUE_DIR`:
 *   lang, langs, messages, intl) only when it is named for a locale (`namedForLocale`: its name ends in an ISO 639-1
 *   code, with a region or script after it or not - `en.json`, `client.pt-BR.yml`, `messages_de.properties` - or its
 *   folder is one, `messages/en/common.json`). A data file named for a locale anywhere else is a program file:
 *   `ci.yml`, `db.yml` and `hr.json` are configuration, and a two-letter name is no evidence. A dotfile, a manifest
 *   and a lockfile are never a translation, nor is a tool's configuration placed beside the catalogues
 *   (`TOOL_CONFIG_NAME`: tsconfig and jsconfig files, `*.config.json` and `.yml`, project, nx, turbo, lerna, renovate
 *   and vercel JSON, docker-compose files; the corpus has `config/translations/tsconfig.json`); a .js or .ts locale module is a program file: its text is inside code.
 * Everything else is a program file here, HTML included (a page carries scripts), and T2n does not run on it: a
 * quotation of it confirms at T1, T2 or T3 as it did before T2n existed. When in doubt a file is a program file: that
 * refuses more quotations, so the report shows more, never less. The census's own locale rule (`LOCALE_DIR`,
 * `LOCALE_FILE` in kind-key.ts) is not this one and is left as it is: it also asks that the line be a catalogue entry.
 */
const TRANSLATION_EXT = new Set([".po", ".pot", ".xliff", ".xlf", ".strings", ".arb", ".resx"]);
// .ftl is Fluent in a translations folder and a FreeMarker template elsewhere (`release.html.ftl`): placed as a data file is.
const CATALOGUE_EXT = new Set([".yml", ".yaml", ".json", ".properties", ".ftl"]);
const PROSE_EXT = new Set([".md", ".markdown", ".mdx", ".rst", ".adoc"]);
// A repository document may carry a suffix (`readme_de.txt`, `LICENSE-MIT.txt`) unless it names a value (`license_key.txt`);
// a policy only by its exact name (`privacy_url.txt` holds a URL).
const PROSE_TXT_NAME =
  /^(?:(?:readme|licen[cs]e|copying|notice|third[-_]?party[-_]?notices?|changelog|changes|history|news|authors|contributors|credits|contributing|code[-_]of[-_]conduct|install|faq)(?:[-_.](?!(?:key|keys|url|uri|id|ids|token|hash)\b)[\w.+-]*)?|privacy(?:[-_]?policy)?|terms(?:[-_]?of[-_]?(?:service|use))?|tos|eula|disclaimer|cookies?(?:[-_]?policy)?|imprint|legal)\.txt$/i;
const CATALOGUE_DIR = /(?:^|\/)(?:locales?|i18n|l10n|translations?)\//i;
const SHARED_CATALOGUE_DIR = /(?:^|\/)(?:langs?|messages|intl)\//i;
// A tool's own configuration beside the catalogues is not one (`config/translations/tsconfig.json`, in the corpus).
const TOOL_CONFIG_NAME = /^(?:[tj]sconfig(?:\.[\w-]+)*\.json|[\w.-]+\.config\.(?:json|ya?ml)|(?:project|nx|turbo|lerna|renovate|vercel)\.json|docker-compose[\w.-]*\.ya?ml)$/i;
// M3 of an internal record: a tool's own file in a translations folder - ng-packagr's
// ng-package.json, a lint rule's i18n-ignores.json, a config.json, crowdin.yml - is not a catalogue either. A name holding
// one of these words is a catalogue only where the file or its folder is named for a locale (`locales/en/config.json` is
// a namespace of catalogues); elsewhere it is a program file, which refuses more quotations, never fewer.
const TOOL_WORD = /(?:^|[-_.])(?:config|configuration|package|ignores?|schema|crowdin|transifex|lokalise|weblate|tolgee|lingui|babel)(?=$|[-_.])/i;
const ISO_639_1 = new Set(
  "aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu".split(" "),
);

/** A name or a folder that is a locale: an ISO 639-1 code, with a region (`BR`, `br`, `419`) or a script (`Hans`) after it or not. */
function namedForLocale(path: string): boolean {
  const parts = path.split("/");
  const base = parts[parts.length - 1] ?? "";
  const stem = base.slice(0, base.length - extname(base).length);
  const iso = (t: string | undefined): boolean => t !== undefined && /^[a-z]{2}$/.test(t) && ISO_639_1.has(t);
  const sub = (t: string | undefined): boolean => t !== undefined && /^(?:[A-Za-z]{2}|[A-Za-z]{4}|\d{3})$/.test(t);
  const t = stem.split(/[._-]/);
  const n = t.length;
  if (iso(t[n - 1]) || (n >= 2 && iso(t[n - 2]) && sub(t[n - 1]))) return true;
  const d = (parts[parts.length - 2] ?? "").split(/[-_]/);
  return (d.length === 1 && iso(d[0])) || (d.length === 2 && iso(d[0]) && sub(d[1]));
}

/** The kind of file T2n runs in, by its path, with the reason (see above); null for a program file, where it does not. */
export function formattingKindWhy(name: string): { kind: "document" | "translation"; why: string } | null {
  const base = basename(name);
  const ext = extname(base).toLowerCase();
  if (PROSE_EXT.has(ext)) return { kind: "document", why: `prose markup (${ext})` };
  if (ext === ".txt") return PROSE_TXT_NAME.test(base) ? { kind: "document", why: "a .txt named for prose" } : null;
  if (TRANSLATION_EXT.has(ext)) return { kind: "translation", why: `a translation catalogue format (${ext})` };
  if (!CATALOGUE_EXT.has(ext) || base.startsWith(".") || MANIFEST_NAMES.has(base) || LOCKFILE_NAMES.has(base) || TOOL_CONFIG_NAME.test(base)) return null;
  if (TOOL_WORD.test(base.slice(0, base.length - ext.length)) && !namedForLocale(name)) return null;
  if (CATALOGUE_DIR.test(name)) return { kind: "translation", why: `a ${ext} file under a translations directory` };
  if (SHARED_CATALOGUE_DIR.test(name) && namedForLocale(name)) return { kind: "translation", why: `a ${ext} file named for a locale under lang, messages or intl` };
  return null;
}

/** The kind of file T2n runs in, by its path (see above), or null for a program file, where it does not. */
export function formattingKindOf(name: string): "document" | "translation" | null {
  return formattingKindWhy(name)?.kind ?? null;
}

/** Characters with no width, dropped without leaving a gap: zero-width space, word joiner, soft hyphen. */
function isInvisible(cp: number): boolean {
  return cp === 0x200b || cp === 0x2060 || cp === 0xad;
}

/** The only whitespace a quotation may leave out, and only before a comma: space and tab. */
function isSpaceOrTab(cp: number): boolean {
  return cp === 32 || cp === 9;
}

const FOLD_TO_APOSTROPHE = new Set([0x2018, 0x2019, 0x201a, 0x201b, 0x2032, 0x2035, 0x2039, 0x203a]);
const FOLD_TO_QUOTATION_MARK = new Set([0x201c, 0x201d, 0x201e, 0x201f, 0x2033, 0x2036, 0xab, 0xbb]);
const FOLD_TO_HYPHEN_MINUS = new Set([0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xfe58, 0xfe63]);
/** A width fold whose result holds an ASCII character is not made. */
const HAS_ASCII_RE = /[\u0000-\u007f]/;
/** A canonical decomposition that is ASCII alone is not made. */
const ONLY_ASCII_RE = /^[\u0000-\u007f]+$/;

/** One non-whitespace character, as T2n compares it. `ch` is the character `cp` names. */
function foldChar(cp: number, ch: string): string {
  if (cp < 0x80) return ch;
  if (FOLD_TO_APOSTROPHE.has(cp)) return "'";
  if (FOLD_TO_QUOTATION_MARK.has(cp)) return '"';
  if (FOLD_TO_HYPHEN_MINUS.has(cp)) return "-";
  if (cp === 0x2026) return "...";
  if (cp >= 0xff00 && cp <= 0xffef) {
    const wide = ch.normalize("NFKD");
    return HAS_ASCII_RE.test(wide) ? ch : wide;
  }
  const canonical = ch.normalize("NFD");
  return ONLY_ASCII_RE.test(canonical) ? ch : canonical;
}

const MARK_RE = /\p{M}/u;

/** What stood before a comma of the normalised text, in its source (`NormalizedText.commaGap`): nothing. */
const GAP_NONE = 0;
/** A run of spaces or tabs, before a comma followed by whitespace or the end: the quotation may leave it out. */
const GAP_ADMITTED = 1;
/** Any other whitespace (a line break in the run, or no whitespace after the comma): the quotation must keep it. */
const GAP_KEPT = 2;

interface NormalizedText {
  text: string;
  /** For each UTF-16 unit of `text`, the 1-indexed source line; null when built without the maps. */
  mapToLine: Int32Array | null;
  /**
   * For each UTF-16 unit of `text`, the source offset of the character it came from (of the first
   * whitespace character, for a kept space). Every unit a single source character becomes carries that
   * character's offset, which is what lets `onWholeCharacters` see a match cut through one.
   */
  mapToOffset: Int32Array | null;
  /**
   * For each UTF-16 unit of `text` that is a comma, the `GAP_*` that stood before it in the source, and 0
   * everywhere else. A gap before a comma is never written into `text`: `gapsAgree` judges it instead,
   * which is how the rule stays one-directional. Built with the maps.
   */
  commaGap: Uint8Array | null;
}

/**
 * One O(n) pass over code points. A run of whitespace is held as a gap and resolved when the next
 * character arrives: before a comma it is taken out of the text and its kind recorded on the comma
 * (`GAP_*`); anywhere else it is written as one space, as T2 writes it. A gap before the first character
 * or after the last is dropped, so the text never starts or ends with a space. The maps are built only
 * when asked for, because a sweep of the scope needs only the text until something matches.
 */
function buildNormalized(text: string, withMaps: boolean): NormalizedText {
  const out: string[] = [];
  let lines: Int32Array | null = withMaps ? new Int32Array(text.length + 16) : null;
  let offs: Int32Array | null = withMaps ? new Int32Array(text.length + 16) : null;
  let gaps: Uint8Array | null = withMaps ? new Uint8Array(text.length + 16) : null;
  let n = 0;
  const emit = (s: string, line: number, off: number, gap: number): void => {
    out.push(s);
    if (lines && offs && gaps) {
      if (n + s.length > lines.length) {
        const size = Math.max(lines.length * 2, n + s.length + 16);
        const l2 = new Int32Array(size);
        l2.set(lines);
        lines = l2;
        const o2 = new Int32Array(size);
        o2.set(offs);
        offs = o2;
        const g2 = new Uint8Array(size);
        g2.set(gaps);
        gaps = g2;
      }
      for (let k = 0; k < s.length; k++) {
        lines[n + k] = line;
        offs[n + k] = off;
      }
      gaps[n] = gap;
    }
    n += s.length;
  };
  let line = 1;
  let gapAt = -1;
  let gapLine = 0;
  let gapOnlySpaceTab = true;
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    const width = cp > 0xffff ? 2 : 1;
    if (isAsciiWs(cp)) {
      if (gapAt < 0) {
        gapAt = i;
        gapLine = line;
        gapOnlySpaceTab = true;
      }
      if (!isSpaceOrTab(cp)) gapOnlySpaceTab = false;
      if (cp === 10) line++;
      i += width;
      continue;
    }
    if (isInvisible(cp)) {
      i += width;
      continue;
    }
    const folded = foldChar(cp, width === 2 ? text.slice(i, i + 2) : text[i]);
    let gap = GAP_NONE;
    if (gapAt >= 0) {
      if (n > 0) {
        if (folded === ",") {
          const after = text.codePointAt(i + 1);
          const commaFollowedByWs = after === undefined || isAsciiWs(after);
          gap = gapOnlySpaceTab && commaFollowedByWs ? GAP_ADMITTED : GAP_KEPT;
        } else {
          emit(" ", gapLine, gapAt, GAP_NONE);
        }
      }
      gapAt = -1;
    }
    emit(folded, line, i, gap);
    i += width;
  }
  return {
    text: out.join(""),
    mapToLine: lines ? lines.subarray(0, n) : null,
    mapToOffset: offs ? offs.subarray(0, n) : null,
    commaGap: gaps ? gaps.subarray(0, n) : null,
  };
}

/** A quotation as T2n compares it. Never has a leading or trailing space: a gap is written only between two characters. */
export function normalizeForMatch(quote: string): string {
  return buildNormalized(quote, false).text;
}

/**
 * The length T2n's floors are measured in: characters as a reader counts them. The normalised text is
 * recomposed (NFC) and combining marks are not counted, so a Hangul syllable counts once whether it is
 * written precomposed or as its letters, as an accented letter does (counted decomposed, six syllables were 14 to 16 characters and cleared the floor T2 sets at sixteen).
 */
export function normalizedLength(normalized: string): number {
  let k = 0;
  for (const c of normalized.normalize("NFC")) if (!MARK_RE.test(c)) k++;
  return k;
}

/**
 * Whether the normalised range [start, end) begins and ends on whole source characters: it does not
 * start or stop between two units one source character became (a decomposed `é`, a folded `…`, a
 * surrogate pair), and the unit after it is not a combining mark belonging to its last character.
 */
function onWholeCharacters(norm: NormalizedText, start: number, end: number): boolean {
  const offs = norm.mapToOffset!;
  if (start > 0 && offs[start - 1] === offs[start]) return false;
  if (end < offs.length && offs[end] === offs[end - 1]) return false;
  if (end < norm.text.length) {
    const next = norm.text.codePointAt(end)!;
    if (MARK_RE.test(String.fromCodePoint(next))) return false;
  }
  return true;
}

/* --------------------------------------------------------------------------------------------- *
 * The two corpora.
 * --------------------------------------------------------------------------------------------- */

interface SourceEntry {
  text: string;
  lineStarts: number[];
  collapsed: CollapsedText | null;
  normalized: NormalizedText | null;
  /** The 0-based lines that are code in a file that is prose and code at once (an .mdx file, `mdxCodeLines`), where T2n does not run. */
  codeLines?: Set<number>;
}

function makeEntry(text: string, name?: string): SourceEntry {
  const codeLines = name !== undefined && extname(name).toLowerCase() === ".mdx" ? mdxCodeLines(text) : undefined;
  return { text, lineStarts: buildLineStarts(text), collapsed: null, normalized: null, ...(codeLines ? { codeLines } : {}) };
}

/**
 * M4 of an internal record: an .mdx file is prose markup and a JavaScript module at once. Its
 * ESM blocks and every line holding a JSX tag, a `{}` expression or a tag's closing `/>` are the module's code, where T2n
 * does not run, as in a program file (`t2nMatches`). An ESM block begins with a line that begins `import` or `export` and
 * ends, as MDX's own parser ends it, at the first blank line where the code so far is whole:
 * a statement that runs past a blank line - an object, a call, a string or
 * a template left open - is code to its end, not prose after the blank line.
 */
function mdxCodeLines(text: string): Set<number> {
  const code = new Set<number>();
  const lines = text.split("\n");
  let esm: JsExtent | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] as string;
    if (esm === null && /^(?:import|export)\b/.test(l)) esm = new JsExtent();
    if (esm !== null && l.trim() === "" && esm.whole()) esm = null;
    if (esm !== null) esm.feed(`${l}\n`);
    if (esm !== null || /[{}]|<\/?[A-Za-z][\w.:-]*(?=[\s/>]|$)|^\s*\/?>\s*$/.test(l)) code.add(i);
  }
  return code;
}

/**
 * How far a JavaScript statement runs (F4, `mdxCodeLines`): fed line by line, `whole()` says whether the code so far has
 * closed every bracket, string, template literal (with its `${}` parts) and comment it opened. A `/` where an operand may
 * begin starts a regular expression literal; a quote left open at a line's end ends there, as no JavaScript string runs on.
 */
class JsExtent {
  /** The open contexts, innermost last: code (with its open brackets) or a template literal. */
  private readonly frames: ({ kind: "code"; depth: number } | { kind: "template" })[] = [{ kind: "code", depth: 0 }];
  private quote: string | null = null;
  private comment = false;
  /** The last character of code that is not white space, which tells a regular expression from a division. */
  private prev = "";

  feed(s: string): void {
    for (let i = 0; i < s.length; i++) {
      const c = s[i] as string;
      const top = this.frames[this.frames.length - 1] as { kind: "code"; depth: number } | { kind: "template" };
      if (this.comment) {
        if (c === "*" && s[i + 1] === "/") {
          this.comment = false;
          i++;
        }
      } else if (this.quote !== null) {
        if (c === "\\") i++;
        else if (c === this.quote || c === "\n") this.quote = null;
      } else if (top.kind === "template") {
        if (c === "\\") i++;
        else if (c === "`") {
          this.frames.pop();
          this.prev = c;
        } else if (c === "$" && s[i + 1] === "{") {
          this.frames.push({ kind: "code", depth: 0 });
          i++;
        }
      } else if (c === "/" && s[i + 1] === "*") {
        this.comment = true;
        i++;
      } else if (c === "/" && s[i + 1] === "/") {
        const nl = s.indexOf("\n", i);
        i = nl < 0 ? s.length : nl - 1;
      } else if (c === "/" && (this.prev === "" || "(,=:[!&|?{};+-*%~^".includes(this.prev))) {
        let cls = false;
        for (i++; i < s.length && s[i] !== "\n"; i++) {
          if (s[i] === "\\") i++;
          else if (s[i] === "[") cls = true;
          else if (s[i] === "]") cls = false;
          else if (s[i] === "/" && !cls) break;
        }
        this.prev = "/";
      } else {
        if (c === "'" || c === '"') this.quote = c;
        else if (c === "`") this.frames.push({ kind: "template" });
        else if (c === "{" || c === "(" || c === "[") top.depth++;
        else if (c === "}" && top.depth === 0 && this.frames.length > 1) this.frames.pop();
        else if (c === "}" || c === ")" || c === "]") top.depth = Math.max(0, top.depth - 1);
        if (!/\s/.test(c)) this.prev = c;
      }
    }
  }

  whole(): boolean {
    const top = this.frames[0] as { kind: "code"; depth: number };
    return this.frames.length === 1 && top.depth === 0 && this.quote === null && !this.comment;
  }
}

/** The 0-based line of `offset` in a text whose line starts are `starts`. */
function lineIndexAt(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function getCollapsed(entry: SourceEntry): CollapsedText {
  if (!entry.collapsed) entry.collapsed = buildCollapsed(entry.text);
  return entry.collapsed;
}

/** The normalised text of a source, rebuilt once with its maps the first time a caller needs positions. */
function getNormalized(entry: SourceEntry, withMaps: boolean): NormalizedText {
  if (!entry.normalized || (withMaps && !entry.normalized.mapToOffset)) entry.normalized = buildNormalized(entry.text, withMaps);
  return entry.normalized;
}

/**
 * A body of text that quotes are checked against, addressed by name.
 *
 * Two of them exist. The DOCUMENT corpus is `reconcile-input.json`'s `documents[]`, already in
 * memory and pinned by sha256. The CODE corpus is the real tree under `--target`, read on demand.
 * They differ in where the bytes come from and in nothing else, so the waterfall below is written
 * once against this interface rather than twice.
 */
interface Corpus {
  kind: "document" | "code";
  /** Every name this corpus can be searched over, in a fixed order. */
  names: string[];
  /** The text of one name, or null. `problemFor` says why null, and is never empty when null. */
  get(name: string): SourceEntry | null;
  problemFor(name: string): string;
  /** One clause describing the scope, for the note on an unverifiable quote. */
  scopeDescription(): string;
}

/**
 * The extracted documents, each rebuilt so that a line number in the text IS the line number the
 * document itself carries.
 *
 * `ExtractedDoc.lines[]` holds only the lines with prose on them — `{line: 4}`, `{line: 6}`, ... —
 * so the array index is not the document's line number. Rather than carry a map from one to the
 * other through every tier (which is a whole class of off-by-one waiting to happen), the text is
 * padded with empty lines at the numbers the extractor skipped. The waterfall then runs unchanged
 * and every position it reports is already a real line of the developer's own file.
 *
 * The padding is bounded by the document's own `bytes`, not by a constant: a line number larger
 * than the source's byte count cannot be a line of that source, since every line costs at least its
 * newline. Anything past that bound is not placed and is reported, per document, in the summary —
 * a hand-written or corrupted input is disclosed rather than silently reshaped.
 */
export interface DocumentCorpusBuild {
  corpus: Corpus;
  /** Documents whose line numbers exceeded their own byte count, with how many lines were dropped. */
  unplaced_lines: { doc: string; lines: number }[];
}

export function buildDocumentCorpus(input: ReconcileInput): DocumentCorpusBuild {
  const entries = new Map<string, SourceEntry>();
  const unplaced: { doc: string; lines: number }[] = [];
  const names: string[] = [];

  for (const doc of input.documents ?? []) {
    names.push(doc.doc_path);
    const lines = doc.lines ?? [];
    const bound = Math.max(doc.bytes ?? 0, 1);
    let maxLine = 0;
    let dropped = 0;
    for (const l of lines) {
      if (l.line > bound) dropped++;
      else if (l.line > maxLine) maxLine = l.line;
    }
    const padded: string[] = new Array(maxLine).fill("");
    for (const l of lines) {
      if (l.line > bound || l.line < 1) continue;
      padded[l.line - 1] = normalizeNewlines(l.text);
    }
    entries.set(doc.doc_path, makeEntry(padded.join("\n")));
    if (dropped > 0) unplaced.push({ doc: doc.doc_path, lines: dropped });
  }

  const corpus: Corpus = {
    kind: "document",
    names,
    get: (name) => entries.get(name) ?? null,
    problemFor: (name) =>
      entries.has(name)
        ? ""
        : `no document with this path or URL is in the reconciliation input's documents[]`,
    scopeDescription: () =>
      `${names.length} extracted document(s) in the reconciliation input`,
  };
  return { corpus, unplaced_lines: unplaced };
}

/**
 * The real tree under `--target`, restricted to the files the document itself names.
 *
 * The scope is exactly the union of every `evidence[].file` and every `searches[].hits[].file` in
 * the report. That is the honest boundary for T4: a file the agent quoted is a file the agent read,
 * and re-attributing a quote to a file nobody in this report ever mentioned would be a guess. It
 * also bounds the work, so this stays a verification step and does not become a second scan.
 *
 * A path that resolves outside the target root, or is absolute, is refused and its quote comes back
 * `unverifiable` with that as the stated reason. A report is agent-written text and is treated as
 * data, so it never decides which part of the filesystem gets opened.
 */
/**
 * Where one agent-declared path really is under `--target`, or why it will not be opened.
 *
 * **Exported so the confinement rule has one statement and not three.** `buildCodeCorpus` resolves a
 * path in order to read it; a caller that has to HASH the same file (layer 2's `verdict-verify`
 * records the sha256 of every file a quotation was checked against, for what ideas.md idea H will
 * need) has to resolve it too, and a second copy of "is this path inside the tree?" is precisely the
 * defect this repository keeps finding. One predicate, called from both.
 *
 * **The symlink clause, and why it is not the same test as the prefix test.** `resolve()` performs
 * no filesystem access at all: it folds `..` textually. So `a/link/../../etc/passwd` is caught by the
 * prefix test, and a real symlink at `a/link` pointing at `/etc` is NOT — the resolved string still
 * begins with the root, and `readFileSync` then follows the link out of the tree. The real path is
 * therefore taken first, with `realpathSync`, and the prefix test is applied to THAT. A path inside
 * the tree is its own real path, so nothing that was readable before becomes unreadable.
 *
 * `realpathSync` throws for a path that does not exist, which is the ordinary case of a citation of a
 * file that is not there; that throw is caught here and returned as the same "not readable" problem
 * the read itself would have produced, so the two failures read alike to a caller.
 */
export function resolveUnderTarget(
  targetRoot: string,
  name: string,
): { abs: string; real: string; problem: "" } | { abs: ""; real: ""; problem: string } {
  if (!name) return { abs: "", real: "", problem: "the report names no file for this quote" };
  if (isAbsolute(name)) {
    return {
      abs: "",
      real: "",
      problem: `the path is absolute; a quote's file is read relative to --target and never from elsewhere on this machine`,
    };
  }
  const rootResolved = resolve(targetRoot);
  const rootPrefix = rootResolved.endsWith(sep) ? rootResolved : rootResolved + sep;
  const abs = resolve(rootResolved, name);
  if (abs !== rootResolved && !abs.startsWith(rootPrefix)) {
    return { abs: "", real: "", problem: `the path resolves outside --target (${abs}); nothing outside the scanned tree is opened` };
  }
  /* **A path that does not exist is NOT an escape, and this must not answer as though it were.**
   * `realpathSync` throws for a missing file, and returning that error here would replace the
   * caller's own "not readable under --target (ENOENT ... stat ...)" with a differently worded one
   * that says `lstat` — an output change for a case that has nothing to do with confinement, in a
   * note string two other commands already print. The path is handed back instead, and the read that
   * follows reports its absence in exactly the words it always did. */
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    // Nothing is there to canonicalise, so `real` is empty rather than a guess. A caller deciding
    // WHERE a path lies must fall back to `abs`; a path that does not exist can leak nothing, and the
    // read that follows reports its absence in its own words.
    return { abs, real: "", problem: "" };
  }
  // The root's own real path, so a target that is itself reached through a symlink — which is what
  // a cached tree often is — does not make every file under it read as an
  // escape.
  let rootReal: string;
  try {
    rootReal = realpathSync(rootResolved);
  } catch {
    rootReal = rootResolved;
  }
  const rootRealPrefix = rootReal.endsWith(sep) ? rootReal : rootReal + sep;
  if (real !== rootReal && !real.startsWith(rootRealPrefix)) {
    return {
      abs: "",
      real: "",
      problem: `the path is a symbolic link whose target is outside --target (${real}); nothing outside the scanned tree is opened`,
    };
  }
  return { abs, real, problem: "" };
}

export function buildCodeCorpus(
  targetRoot: string,
  names: string[],
  /**
   * An extra refusal, applied before the path is resolved at all: return a reason to refuse the
   * name, or the empty string to allow it.
   *
   * **Optional, and neither existing caller passes one**, so `reconcile-verify` and
   * `questionnaire verify` behave byte for byte as they did. It exists for layer 2, where a citation
   * of a path under `.legal/` names another agent's output rather than the user's code — the
   * orientation notes are a model's paragraph, and since 2026-09-17 every adjudicator's verdict and
   * reasoning sits there too. That is a SCOPE rule of one command and not part of the waterfall, so
   * it is supplied by the command rather than written into the corpus.
   */
  refuse?: (name: string) => string,
): Corpus {
  const cache = new Map<string, SourceEntry | null>();
  const problems = new Map<string, string>();

  function load(name: string): SourceEntry | null {
    if (cache.has(name)) return cache.get(name) ?? null;
    let entry: SourceEntry | null = null;
    let problem = refuse ? refuse(name) : "";
    if (!problem) {
      const where = resolveUnderTarget(targetRoot, name);
      if (where.problem) {
        problem = where.problem;
      } else {
        try {
          if (!statSync(where.abs).isFile()) problem = "the path exists under --target but is not a file";
          else entry = makeEntry(normalizeNewlines(readSourceText(where.abs)), name);
        } catch (e) {
          problem = `not readable under --target (${(e as Error).message})`;
        }
      }
    }
    cache.set(name, entry);
    if (!entry) problems.set(name, problem);
    return entry;
  }

  return {
    kind: "code",
    names,
    get: load,
    problemFor: (name) => {
      load(name);
      return problems.get(name) ?? "";
    },
    // "document" rather than "report", because two documents reach this corpus: a pillar-2
    // declarations report and a questionnaire answers document. The sentence is read by a person in
    // both, and naming the wrong one is the kind of small untruth this repository keeps finding.
    scopeDescription: () =>
      `${names.length} file(s) named anywhere in this document, read from --target`,
  };
}

/* --------------------------------------------------------------------------------------------- *
 * Tier primitives. Spans are [startLine, endLine], 1-indexed, in the source's own numbering.
 * --------------------------------------------------------------------------------------------- */

type Span = [number, number];

/**
 * One real occurrence: its lines, and its character range in the source's newline-normalised text
 * (`end` is one past its last character). T1 and T2 compute both at once and the line-only callers
 * take `lines`, so each tier exists once whichever of the two a caller needs.
 */
interface Occurrence {
  lines: Span;
  start: number;
  end: number;
}

/** T1: exact substring. The end line is arithmetic, not a second lookup — an exact match spans
 * exactly as many lines as the quote has newlines. */
function tier1Occurrences(entry: SourceEntry | null, quote: string): Occurrence[] | null {
  if (!entry || !quote) return null;
  const offsets = findAllOccurrences(entry.text, quote);
  if (offsets.length === 0) return null;
  const quoteLineCount = quote.split("\n").length;
  return offsets.map((off): Occurrence => {
    const startLine = offsetToLine(entry.lineStarts, off);
    return { lines: [startLine, startLine + quoteLineCount - 1], start: off, end: off + quote.length };
  });
}

function tier1Exact(entry: SourceEntry | null, quote: string): Span[] | null {
  const found = tier1Occurrences(entry, quote);
  return found ? found.map((o) => o.lines) : null;
}

/** T2: whitespace-collapsed substring, gated on the collapsed length. A collapsed quote is trimmed,
 * so neither its first nor its last character is the space a whitespace run became, and both ends of
 * its character range are exact. */
function tier2Occurrences(entry: SourceEntry | null, quote: string, minLen: number): Occurrence[] | null {
  if (!entry || !quote) return null;
  const cq = collapseQuote(quote);
  if (cq.length < minLen) return null;
  const coll = getCollapsed(entry);
  const offsets = findAllOccurrences(coll.collapsed, cq);
  if (offsets.length === 0) return null;
  const lastIdx = coll.mapToLine.length - 1;
  return offsets.map((off): Occurrence => {
    const last = Math.min(off + cq.length - 1, lastIdx);
    return {
      lines: [coll.mapToLine[off], coll.mapToLine[last]],
      start: coll.mapToOffset[off],
      end: coll.mapToOffset[last] + 1,
    };
  });
}

function tier2Collapsed(entry: SourceEntry | null, quote: string, minLen: number): Span[] | null {
  const found = tier2Occurrences(entry, quote, minLen);
  return found ? found.map((o) => o.lines) : null;
}

/** A quotation in T2n's form, with the positions of its commas after the first character (`gapsAgree`). */
interface NormalizedQuote {
  form: NormalizedText;
  commas: number[];
}

function normalizeQuote(quote: string): NormalizedQuote {
  const form = buildNormalized(quote, true);
  const commas: number[] = [];
  for (let k = 1; k < form.text.length; k++) if (form.text.charCodeAt(k) === 44) commas.push(k);
  return { form, commas };
}

/**
 * The whitespace rule's one direction, comma by comma (`buildNormalized` takes every gap before a comma
 * out of the text and records its kind). Where the quotation has whitespace before a comma, the file must
 * have some there too; where the quotation has none, the file may have only a run the quotation is
 * allowed to leave out. A comma that opens the quotation is not asked: what stood before it is outside
 * the quotation.
 */
function gapsAgree(q: NormalizedQuote, norm: NormalizedText, off: number): boolean {
  const mine = q.form.commaGap!;
  const theirs = norm.commaGap!;
  for (const k of q.commas) {
    const fq = mine[k];
    const ff = theirs[off + k];
    if (fq !== GAP_NONE && ff === GAP_NONE) return false;
    if (fq === GAP_NONE && ff === GAP_KEPT) return false;
  }
  return true;
}

/**
 * Every occurrence of a quotation in T2n's form in one source: it begins and ends on whole characters
 * (`onWholeCharacters`) and keeps the whitespace rule (`gapsAgree`). No floor here; the callers apply
 * theirs.
 */
function t2nMatches(entry: SourceEntry, q: NormalizedQuote): Occurrence[] | null {
  const nq = q.form.text;
  if (nq === "" || !getNormalized(entry, false).text.includes(nq)) return null;
  const norm = getNormalized(entry, true);
  const mapToLine = norm.mapToLine!;
  const mapToOffset = norm.mapToOffset!;
  const found: Occurrence[] = [];
  for (const off of findAllOccurrences(norm.text, nq)) {
    const end = off + nq.length;
    if (!onWholeCharacters(norm, off, end)) continue;
    if (!gapsAgree(q, norm, off)) continue;
    const lastSource = mapToOffset[end - 1];
    // M4: an occurrence on a code line of an .mdx file is not T2n's (`mdxCodeLines`).
    const codeLines = entry.codeLines;
    if (codeLines) {
      let onCode = false;
      for (let l = lineIndexAt(entry.lineStarts, mapToOffset[off]); l <= lineIndexAt(entry.lineStarts, lastSource) && !onCode; l++) onCode = codeLines.has(l);
      if (onCode) continue;
    }
    const lastWidth = (entry.text.codePointAt(lastSource) ?? 0) > 0xffff ? 2 : 1;
    found.push({ lines: [mapToLine[off], mapToLine[end - 1]], start: mapToOffset[off], end: lastSource + lastWidth });
  }
  return found.length > 0 ? found : null;
}

/**
 * T2n: a quotation in T2n's form (`buildNormalized` says what is folded and what never is), gated on the
 * normalised length at the floor T2 is given for the same source. Tried only where T2 found nothing, so
 * it can add a match and never remove one.
 */
function tier2nOccurrences(entry: SourceEntry | null, quote: string, minLen: number): Occurrence[] | null {
  if (!entry || !quote) return null;
  const q = normalizeQuote(quote);
  const nq = q.form.text;
  if (nq === "" || normalizedLength(nq) < minLen) return null;
  return t2nMatches(entry, q);
}

function tier2nNormalized(entry: SourceEntry | null, quote: string, minLen: number): Span[] | null {
  const found = tier2nOccurrences(entry, quote, minLen);
  return found ? found.map((o) => o.lines) : null;
}

/** Among candidate spans, the one closest to any declared line; the first when nothing is declared. */
function pickNearestOrFirst(spans: Span[], declared: number[]): Span {
  if (declared.length === 0) return spans[0];
  let best = spans[0];
  let bestDist = Infinity;
  for (const s of spans) {
    for (const l of declared) {
      const d = Math.min(Math.abs(s[0] - l), Math.abs(s[1] - l));
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    }
  }
  return best;
}

/**
 * T3: every non-empty line of the quote verified on its own, then checked for positional coherence.
 * Returns one real line per fragment, in fragment order, or null if any fragment is unfindable or
 * the set is incoherent. See T3_MAX_FRAGMENT_GAP and T3_MAX_TOTAL_SPAN for what incoherent means
 * and which recombination attack each bound closed.
 */
function tier3Fragments(
  entry: SourceEntry | null,
  quote: string,
  declared: number[],
): number[] | null {
  if (!entry) return null;
  const fragments = quote.split("\n").filter((l) => l.trim().length > 0);
  if (fragments.length < 2) return null;
  const foundLines: number[] = [];
  for (const frag of fragments) {
    let spans = tier1Exact(entry, frag);
    if (!spans) spans = tier2Collapsed(entry, frag, FRAGMENT_COLLAPSE_MIN_LENGTH);
    if (!spans) return null;
    foundLines.push(pickNearestOrFirst(spans, declared)[0]);
  }
  for (let i = 1; i < foundLines.length; i++) {
    const gap = foundLines[i] - foundLines[i - 1];
    if (gap <= 0 || gap > T3_MAX_FRAGMENT_GAP) return null;
  }
  if (foundLines[foundLines.length - 1] - foundLines[0] > T3_MAX_TOTAL_SPAN) return null;
  return foundLines;
}

type SubTier = "T1-exact" | "T2-collapsed" | "T2-normalized" | "T3-fragment";

interface TierMatch {
  subtier: SubTier;
  spans?: Span[];
  foundLines?: number[];
}

/** T1, T2, then T3 against one source, first hit wins — with T2n between T2 and T3 when the job asked
 * for it (`formatting`), at the floor T2 is given for that source. The same code runs for the declared
 * source and for every source T4 sweeps, so "the same tiers" is literally the same tiers. */
function tryOneSource(
  entry: SourceEntry | null,
  quote: string,
  declared: number[],
  collapseMinLen: number,
  formatting: boolean,
): TierMatch | null {
  if (!entry) return null;
  let spans = tier1Exact(entry, quote);
  if (spans) return { subtier: "T1-exact", spans };
  spans = tier2Collapsed(entry, quote, collapseMinLen);
  if (spans) return { subtier: "T2-collapsed", spans };
  if (formatting) {
    spans = tier2nNormalized(entry, quote, collapseMinLen);
    if (spans) return { subtier: "T2-normalized", spans };
  }
  if (quote.includes("\n")) {
    const foundLines = tier3Fragments(entry, quote, declared);
    if (foundLines) return { subtier: "T3-fragment", foundLines };
  }
  return null;
}

/* --------------------------------------------------------------------------------------------- *
 * Placing one run of text by CHARACTER position — the elided-quotation clause's primitive.
 * --------------------------------------------------------------------------------------------- */

/** Where a run of text was placed in one source: its tier, character range and lines. */
export interface RunPlacement {
  subtier: QuoteMatchTier;
  /** Offset of its first character in the source's newline-normalised text. */
  start: number;
  /** Offset one past its last character. */
  end: number;
  startLine: number;
  endLine: number;
}

/**
 * The part of a source an occurrence must lie in, and which of the occurrences there to take: the
 * first, the last, or the one nearest a line (the same nearness `verifyOneQuote` uses).
 */
export interface RunWindow {
  /** An occurrence must START at or after this offset. */
  from: number;
  /** An occurrence must END at or before this offset. Absent: the end of the source. */
  to?: number;
  pick: "first" | "last" | { nearLine: number };
}

/**
 * Where `text` sits inside a window of ONE named source, through the same tiers `verifyOneQuote` runs
 * on the named source — T1, then T2 at the named-source floor, then T3 for a multi-line text — and on
 * the same two forms of the text, as written and with its HTML entities decoded.
 *
 * **Why a character position and not a line (fix/quote-elision, 2026-09-25).** This replaces the
 * line-granular `notBefore` the elided-quotation clause used since 2026-09-17. A line number cannot
 * say whether a second part on the SAME line comes after the first: the clause searched each later
 * part only from the line after the part before it, so a real quotation of one aligned route per line
 * — `get 'g/:key(/:slug)' ... => 'groups#show'`, both parts on line 508 — was refused (the second
 * confidence check's refutation), and the only repair a line number allows, searching from the
 * same line, would admit two runs of one line recombined backwards. A character range says both.
 *
 * **T3 has no character positions** — it matches a text line by line — so a T3 match is held to whole
 * lines: it must begin on a line after the one `from` falls on, and it occupies its lines to their
 * ends. That is the line-granular rule this clause had before, kept for the one tier that cannot do
 * better; a part it places can therefore never overlap the part before it.
 *
 * It can only report a REAL occurrence inside the window: a text that is nowhere is still nowhere.
 */
export function placeRun(
  corpus: Corpus,
  source: string,
  text: string,
  window: RunWindow,
  formatting = false,
): RunPlacement | null {
  const entry = corpus.get(source);
  if (!entry || !text) return null;
  const raw = normalizeNewlines(text);
  const decoded = normalizeNewlines(decodeHtmlEntities(text));
  for (const form of decoded !== raw ? [raw, decoded] : [raw]) {
    if (collapseQuote(form) === "") continue;
    const placed = placeOneForm(entry, form, window, formatting && formattingKindOf(source) !== null);
    if (placed) return placed;
  }
  return null;
}

/** The tiers one run of text is placed by in one named source, in order: T1, T2 and, where `formatting`, T2n, each at the named source's floor. */
function namedSourceTiers(entry: SourceEntry, quote: string, formatting: boolean): [QuoteMatchTier, () => Occurrence[] | null][] {
  return [
    ["T1-exact", () => tier1Occurrences(entry, quote)],
    ["T2-collapsed", () => tier2Occurrences(entry, quote, NAMED_SOURCE_COLLAPSE_MIN_LENGTH)],
    ...(formatting
      ? [["T2-normalized", () => tier2nOccurrences(entry, quote, NAMED_SOURCE_COLLAPSE_MIN_LENGTH)] as [QuoteMatchTier, () => Occurrence[] | null]]
      : []),
  ];
}

/**
 * THE ONE ANSWER TO "DOES THIS QUOTATION STAND FOR THIS TEXT OF THAT FILE". The capture's place checks (place-reply.ts `quoteStanding`: C5, C9 and
 * the answer seat's A6) ask it of the lines a seat names; the final quote check asks the same of the named file
 * (`verifyOneQuote` through `tryOneSource`, at the named source's floor, and `placeRun` through `placeOneForm`): the same
 * forms (as written, and with its HTML entities decoded), the same tiers in the same order (`namedSourceTiers`: T1, T2,
 * then T2n where `source` is a document or a translation file, R4), at the same floor. Before, the capture compared raw
 * text alone, so a quotation of a line whose stored form is not its canonical form (a Bengali letter excluded from
 * composition, Hangul written as letters), which the final check accepts through T2n, was refused at capture: one such
 * line cost a reader's 50 places, twice. Returns, for the first form and tier that match, the range `[start, end)` of
 * `text` (newline-normalised) each occurrence stands for; empty where none matches. T3 (fragments) is not asked: it
 * places a quotation of several lines by its parts, and a place check asks whether the quotation is a part of the lines.
 */
export function quotationRanges(quote: string, text: string, source: string): { tier: QuoteMatchTier; start: number; end: number }[] {
  if (!quote) return [];
  const entry = makeEntry(normalizeNewlines(text), source);
  const raw = normalizeNewlines(quote);
  const decoded = normalizeNewlines(decodeHtmlEntities(quote));
  for (const form of decoded !== raw ? [raw, decoded] : [raw]) {
    if (collapseQuote(form) === "") continue;
    for (const [tier, find] of namedSourceTiers(entry, form, formattingKindOf(source) !== null)) {
      const found = find();
      if (found && found.length > 0) return found.map((o) => ({ tier, start: o.start, end: o.end }));
    }
  }
  return [];
}

function placeOneForm(entry: SourceEntry, quote: string, w: RunWindow, formatting: boolean): RunPlacement | null {
  const to = w.to ?? entry.text.length;
  const tiers = namedSourceTiers(entry, quote, formatting);
  for (const [subtier, find] of tiers) {
    const occurrences = find();
    const inside = (occurrences ?? []).filter((o) => o.start >= w.from && o.end <= to);
    if (inside.length === 0) continue;
    let chosen = w.pick === "last" ? inside[inside.length - 1] : inside[0];
    if (typeof w.pick === "object") {
      const spans = inside.map((o) => o.lines);
      chosen = inside[spans.indexOf(pickNearestOrFirst(spans, [w.pick.nearLine]))];
    }
    return { subtier, start: chosen.start, end: chosen.end, startLine: chosen.lines[0], endLine: chosen.lines[1] };
  }
  if (!quote.includes("\n")) return null;
  const fromLine = w.from > 0 ? offsetToLine(entry.lineStarts, w.from) : 0;
  const toLine = w.to === undefined ? Infinity : offsetToLine(entry.lineStarts, Math.max(0, to - 1));
  const anchor = typeof w.pick === "object" ? w.pick.nearLine : w.pick === "last" ? toLine : Math.max(1, fromLine);
  const lines = tier3Fragments(entry, quote, Number.isFinite(anchor) ? [anchor] : []);
  if (!lines) return null;
  const first = lines[0];
  const last = lines[lines.length - 1];
  const start = entry.lineStarts[first - 1];
  const end = last < entry.lineStarts.length ? entry.lineStarts[last] - 1 : entry.text.length;
  if (first <= fromLine || start < w.from || end > to) return null;
  return { subtier: "T3-fragment", start, end, startLine: first, endLine: last };
}

/**
 * The window a SHORT part must lie in: right where its neighbour leaves off.
 *
 * `after`: from `offset` (where the part before it ends) to the end of the next non-blank line — the
 * rest of that line, or the line after it with blank lines skipped. `before`: from the start of the
 * previous non-blank line to `offset` (where the part after it begins). Null when the source cannot be
 * read. Exported so the clause and its gate share one definition of "adjacent".
 */
export function besideWindow(
  corpus: Corpus,
  source: string,
  offset: number,
  side: "after" | "before",
): { from: number; to: number } | null {
  const entry = corpus.get(source);
  if (!entry) return null;
  const { text, lineStarts } = entry;
  const lineCount = lineStarts.length;
  const blank = (line: number): boolean => {
    const s = lineStarts[line - 1];
    const e = line < lineCount ? lineStarts[line] - 1 : text.length;
    return text.slice(s, e).trim() === "";
  };
  const at = offsetToLine(lineStarts, Math.min(offset, Math.max(0, text.length - 1)));
  if (side === "after") {
    let next = at + 1;
    while (next <= lineCount && blank(next)) next++;
    const end = next <= lineCount ? (next < lineCount ? lineStarts[next] - 1 : text.length) : text.length;
    return { from: offset, to: end };
  }
  let prev = at - 1;
  while (prev >= 1 && blank(prev)) prev--;
  return { from: prev >= 1 ? lineStarts[prev - 1] : lineStarts[at - 1], to: offset };
}

/**
 * Whether the declared lines are satisfied by the match, and which lines to report.
 *
 * A declared line counts as satisfied when it falls inside some real occurrence's span. EVERY
 * declared line must be satisfied, and there must be at least one: nothing declared cannot be
 * "confirmed at" anything. This is loop-probe's rule, and the reason it is strict is recorded in
 * that file's replay — a run whose own tool accepted a declared-line list containing a number its
 * own search never found still called the row "confirmed".
 */
function outcomeOf(
  match: TierMatch,
  declared: number[],
): { confirmed: boolean; lines: number[]; occurrences: number } {
  if (match.subtier === "T3-fragment") {
    const found = new Set(match.foundLines);
    const confirmed = declared.length > 0 && declared.every((l) => found.has(l));
    return {
      confirmed,
      lines: confirmed ? sortUnique(declared) : sortUnique(match.foundLines!),
      occurrences: 1,
    };
  }
  const spans = match.spans!;
  const confirmed =
    declared.length > 0 && declared.every((l) => spans.some((s) => l >= s[0] && l <= s[1]));
  const chosen = pickNearestOrFirst(spans, declared);
  // `sortUnique` rather than the raw [start, end] pair: a single-line match is one line, not the
  // same number written twice, and the corrected position is read by a person.
  return {
    confirmed,
    lines: confirmed ? sortUnique(declared) : sortUnique(chosen),
    occurrences: spans.length,
  };
}

/**
 * Disclosure that the corrected position was CHOSEN from several, not found uniquely.
 *
 * `ambiguous` is scoped to sources — the text sitting in more than one document or file — and says
 * nothing about a text sitting several times inside one of them. Where the declared line is inside
 * none of the real occurrences, the nearest is taken, and without this note the skill's instruction
 * to carry `final` into the report turns a tie-break into a citation. Nothing is downgraded by it:
 * the text is real and it is in that source; only the claim of uniqueness is withdrawn.
 */
function multipleOccurrenceNote(occurrences: number, spans: Span[], kind: string): string | null {
  if (occurrences < 2) return null;
  const at = spans
    .slice(0, AMBIGUOUS_NOTE_CAP)
    .map((s) => (s[0] === s[1] ? `${s[0]}` : `${s[0]}-${s[1]}`))
    .join(", ");
  const more =
    spans.length > AMBIGUOUS_NOTE_CAP
      ? ` (+${spans.length - AMBIGUOUS_NOTE_CAP} more, capped at ${AMBIGUOUS_NOTE_CAP} shown)`
      : "";
  return `several occurrences: the text occurs ${occurrences} times in this ${kind} (at ${at}${more}) and the declared line is inside none of them, so the position reported is the NEAREST occurrence and not a unique one — say which you meant before citing it`;
}

function tierNote(
  subtier: SubTier,
  crossSource: boolean,
  foundIn: string,
  kind: string,
  fragmentLines?: number[],
): string {
  // "non-contiguous" is the precedent's own word for T3 and it is the whole content of that tier:
  // the fragments are verified each on its own line, and reporting them as one span would assert a
  // contiguity nothing found. The real fragment lines are named here for the same reason, since a
  // confirmed T3 row reports the DECLARED lines in `final`.
  const base = {
    "T1-exact": "T1 exact substring match",
    "T2-collapsed": 'T2 whitespace-collapsed ("reflowed") match',
    "T2-normalized":
      "T2n normalised match (the text differs from the file only by spacing beside punctuation or across a line end, a typographic quote mark or dash, or a Unicode form; its letters, digits and word boundaries are the file's)",
    "T3-fragment":
      "T3 independent NON-CONTIGUOUS fragment match (every line of the quote verified on its own real line, and the positions checked for coherence)",
  }[subtier];
  const where = crossSource
    ? `${base}, scope-wide (T4): found in a different ${kind}, '${foundIn}', not the one the document named`
    : `${base} in the ${kind} the document named`;
  if (subtier === "T3-fragment" && fragmentLines && fragmentLines.length > 0) {
    return `${where}; the fragments are really at line(s) ${fragmentLines.join(", ")}, which is not one span`;
  }
  return where;
}

/** Disclosure that the matched text was thin. Never changes a status. */
function shortQuoteNote(quote: string, match: TierMatch | null): string | null {
  let minLen: number;
  if (match && match.subtier === "T3-fragment") {
    const fragments = quote.split("\n").filter((l) => l.trim().length > 0);
    minLen =
      fragments.length > 0
        ? Math.min(...fragments.map((f) => collapseQuote(f).length))
        : collapseQuote(quote).length;
  } else {
    minLen = collapseQuote(quote).length;
  }
  if (minLen >= SHORT_QUOTE_THRESHOLD) return null;
  return `short-quote: the matched text collapses to as few as ${minLen} character${minLen === 1 ? "" : "s"} (under ${SHORT_QUOTE_THRESHOLD}), so this match is weak evidence on its own`;
}

function ambiguousNote(reason: string, candidates: string[]): string {
  const capped = candidates.slice(0, AMBIGUOUS_NOTE_CAP);
  const suffix =
    candidates.length > AMBIGUOUS_NOTE_CAP
      ? ` (+${candidates.length - AMBIGUOUS_NOTE_CAP} more, capped at ${AMBIGUOUS_NOTE_CAP} shown)`
      : "";
  return `ambiguous: ${reason} — candidates: ${capped.join(", ")}${suffix}`;
}

/**
 * T4/T5's sweep of the rest of the scope. Every matching source is collected rather than the first,
 * so duplication is visible; separately, every source whose collapsed text contains the collapsed
 * quote at all is censused at a lower floor, which is the boilerplate guard (a licence header or a
 * repeated policy heading matching exactly once under the tiers while sitting, differently spaced,
 * in a dozen other sources).
 */
function sweepScope(
  quote: string,
  otherNames: string[],
  corpus: Corpus,
  tryOne: (entry: SourceEntry, name: string) => TierMatch | null,
  formatting: boolean,
): { matches: { name: string; match: TierMatch }[]; boilerplate: string[] } {
  const matches: { name: string; match: TierMatch }[] = [];
  const boilerplate: string[] = [];
  const collapsed = collapseQuote(quote);
  const eligible = collapsed.length >= BOILERPLATE_CENSUS_MIN_LENGTH;
  /* Where the job asked for T2n, the census counts a source carrying the text in T2n's form too, at the
   * census's own floor: a duplicate only T2n can see is still a duplicate. It can only make a single
   * match ambiguous, never admit one (fix/quote-check-small-differences). "Carrying" is T2n's own test,
   * whitespace rule included (`t2nMatches`), so a source that holds the text only in a form T2n refuses
   * is not counted. */
  const normalized = formatting ? normalizeQuote(quote) : null;
  const normalizedEligible =
    normalized !== null && normalized.form.text !== "" && normalizedLength(normalized.form.text) >= BOILERPLATE_CENSUS_MIN_LENGTH;
  for (const name of otherNames) {
    const entry = corpus.get(name);
    if (!entry) continue;
    const m = tryOne(entry, name);
    if (m) matches.push({ name, match: m });
    if (
      (eligible && getCollapsed(entry).collapsed.includes(collapsed)) ||
      (normalizedEligible && normalized !== null && formattingKindOf(name) !== null && t2nMatches(entry, normalized) !== null)
    ) {
      boilerplate.push(name);
    }
  }
  return { matches, boilerplate };
}

/* --------------------------------------------------------------------------------------------- *
 * One quote through the whole waterfall.
 * --------------------------------------------------------------------------------------------- */

/**
 * One quotation to check, addressed by where it sits in the document that asserted it.
 *
 * Exported with `verifyOneQuote` because a second command reuses this waterfall: `questionnaire
 * verify` checks the evidence quotations and search hits in an answers document the same way, and
 * the one thing it must not do is grow a second implementation of the tiers. That is not a
 * hypothetical — the header above records three dev-loop rebuilds of this algorithm, two of which
 * shipped the identical first-version bug. One implementation, audited once, called from both.
 */
export interface QuoteJob {
  /** Where in the document this quote lives, e.g. `claims[2].quote` or `answers[0].evidence[1]`. */
  path: string;
  corpus: Corpus;
  declaredSource: string;
  declaredLines: number[];
  text: string;
  /** Notes established before the search — a missing source, a malformed line reference. */
  preNotes: string[];
  /**
   * Run tier T2n too (fix/quote-check-small-differences, 2026-09-29): a quotation differing from its
   * source only in formatting is found. Only `verdict-verify` sets it; the file header's exception says
   * why pillar 2 and the questionnaire must not.
   */
  formatting?: boolean;
}

export function verifyOneQuote(job: QuoteJob): QuoteCheck {
  const { path, corpus, declaredSource, declaredLines, preNotes } = job;
  const formatting = job.formatting === true;
  const kind = corpus.kind === "document" ? "document" : "file";
  const declared: QuoteLocation = { source: declaredSource, lines: [...declaredLines] };
  const row = (
    status: QuoteVerificationStatus,
    final: QuoteLocation | null,
    tier: QuoteMatchTier | null,
    fallback: boolean,
    notes: string[],
  ): QuoteCheck => ({ path, corpus: corpus.kind, declared, status, final, tier, fallback, notes });

  const raw = normalizeNewlines(job.text ?? "");
  const decoded = normalizeNewlines(decodeHtmlEntities(job.text ?? ""));
  const decodeChanges = decoded !== raw;
  const forms = decodeChanges ? [raw, decoded] : [raw];

  // A quotation with no characters in it, once whitespace stops counting, asserts nothing about the
  // developer's words and cannot be "confirmed" of anything. The empty string already fell through
  // to `unverifiable` because the search loop skips it; a quote of only newlines did not, because
  // T1 has no length floor and the blank-line padding gives it somewhere to match. Two forms of the
  // same nothing were reaching opposite statuses, and the confirming one was the wrong answer.
  // Refused here, before any tier runs. This adds an alarm and removes no match of any real text.
  if (collapseQuote(raw) === "") {
    return row("unverifiable", null, null, false, [
      ...preNotes,
      "the quotation is empty, or contains nothing but whitespace, once line endings are normalised. There is no text here to find in any source, so no position could confirm it — and a status of \"confirmed\" on an empty quotation would say the document contains something it does not.",
    ]);
  }

  const namedEntry = corpus.get(declaredSource);
  const sourceProblem = namedEntry ? "" : corpus.problemFor(declaredSource);
  const otherNames = corpus.names.filter((n) => n !== declaredSource);

  const base = [...preNotes];
  if (!namedEntry && sourceProblem) {
    base.push(`the ${kind} the document named ('${declaredSource}') could not be read: ${sourceProblem}`);
  }

  for (let i = 0; i < forms.length; i++) {
    const quote = forms[i];
    if (!quote) continue;
    const notes = [...base];
    if (decodeChanges && i === 1) {
      notes.push(
        "the quote as written matched nowhere; retried with its HTML entities decoded (&amp; &lt; &gt; &quot; &#39;), which matched — a transport artefact, not a different quote",
      );
    }

    // The named source, at the lower collapse floor.
    // T2n runs in the named source only where it is a document or a translation file (R4, `formattingKindOf`).
    const named = tryOneSource(namedEntry, quote, declaredLines, NAMED_SOURCE_COLLAPSE_MIN_LENGTH, formatting && formattingKindOf(declaredSource) !== null);
    if (named) {
      const { confirmed, lines, occurrences } = outcomeOf(named, declaredLines);
      notes.push(tierNote(named.subtier, false, declaredSource, kind, named.foundLines));
      if (!confirmed) {
        const many = multipleOccurrenceNote(occurrences, named.spans ?? [], kind);
        if (many) notes.push(many);
      }
      const sq = shortQuoteNote(quote, named);
      if (sq) notes.push(sq);
      return row(
        confirmed ? "confirmed_at_declared" : "repaired",
        { source: declaredSource, lines },
        named.subtier,
        false,
        notes,
      );
    }

    // T4: every other source in scope, at the blind floor.
    const t4 = sweepScope(quote, otherNames, corpus, (entry, name) =>
      tryOneSource(entry, quote, declaredLines, COLLAPSE_MIN_LENGTH, formatting && formattingKindOf(name) !== null),
      formatting,
    );
    if (t4.matches.length > 1) {
      notes.push(
        ambiguousNote(
          `the quote matches in ${t4.matches.length} other ${kind}(s) in scope, so which one the report meant is not decidable here`,
          t4.matches.map((m) => m.name),
        ),
      );
      return row("ambiguous", null, null, false, notes);
    }
    if (t4.matches.length === 1) {
      if (t4.boilerplate.length > BOILERPLATE_MAX_OTHER_SOURCES) {
        notes.push(
          ambiguousNote(
            `the collapsed quote occurs in ${t4.boilerplate.length} other ${kind}(s) in scope (boilerplate guard), so a single tier match does not identify one`,
            t4.boilerplate,
          ),
        );
        return row("ambiguous", null, null, false, notes);
      }
      const { name, match } = t4.matches[0];
      const { lines, occurrences } = outcomeOf(match, declaredLines);
      notes.push(tierNote(match.subtier, true, name, kind, match.foundLines));
      const many = multipleOccurrenceNote(occurrences, match.spans ?? [], kind);
      if (many) notes.push(many);
      const sq = shortQuoteNote(quote, match);
      if (sq) notes.push(sq);
      return row("re_attributed", { source: name, lines }, match.subtier, false, notes);
    }

    // T5: the first non-empty line, named source then the rest of the scope. Always a fallback.
    const firstLine = quote.split("\n").find((l) => l.trim().length > 0) ?? "";
    if (firstLine) {
      const namedFallback = tryOneSource(namedEntry, firstLine, declaredLines, NAMED_SOURCE_COLLAPSE_MIN_LENGTH, formatting && formattingKindOf(declaredSource) !== null);
      if (namedFallback && namedFallback.spans) {
        const chosen = pickNearestOrFirst(namedFallback.spans, declaredLines);
        notes.push(
          `T5 first-line fallback (${namedFallback.subtier}) in the ${kind} the document named: ONLY the quotation's first line was found. The rest of its text is not in this ${kind} and not anywhere else in scope, so this position is an ANCHOR and not a verification of the quotation — a first line that is real with a remainder that is invented lands exactly here`,
        );
        const sq = shortQuoteNote(firstLine, namedFallback);
        if (sq) notes.push(sq);
        return row(
          "repaired",
          { source: declaredSource, lines: sortUnique(chosen) },
          namedFallback.subtier,
          true,
          notes,
        );
      }
      const t5 = sweepScope(firstLine, otherNames, corpus, (entry, name) =>
        tryOneSource(entry, firstLine, declaredLines, COLLAPSE_MIN_LENGTH, formatting && formattingKindOf(name) !== null),
        formatting,
      );
      if (t5.matches.length > 1) {
        notes.push(
          ambiguousNote(
            `the quote's first line matches in ${t5.matches.length} other ${kind}(s) in scope`,
            t5.matches.map((m) => m.name),
          ),
        );
        return row("ambiguous", null, null, false, notes);
      }
      if (t5.matches.length === 1 && t5.matches[0].match.spans) {
        if (t5.boilerplate.length > BOILERPLATE_MAX_OTHER_SOURCES) {
          notes.push(
            ambiguousNote(
              `the first line's collapsed text occurs in ${t5.boilerplate.length} other ${kind}(s) in scope (boilerplate guard)`,
              t5.boilerplate,
            ),
          );
          return row("ambiguous", null, null, false, notes);
        }
        const { name, match } = t5.matches[0];
        const chosen = pickNearestOrFirst(match.spans!, declaredLines);
        notes.push(
          `T5 first-line fallback (${match.subtier}), scope-wide: ONLY the quotation's first line was found, in a different ${kind}, '${name}'. The rest of its text is nowhere in scope, so this position is an ANCHOR and not a verification of the quotation`,
        );
        const sq = shortQuoteNote(firstLine, match);
        if (sq) notes.push(sq);
        return row(
          "re_attributed",
          { source: name, lines: sortUnique(chosen) },
          match.subtier,
          true,
          notes,
        );
      }
    }
  }

  const notes = [...base];
  notes.push(
    `NOT FOUND. Searched: the ${kind} the document named ('${declaredSource}'${namedEntry ? ", read" : ", not readable"}), then ${otherNames.length} other ${kind}(s) — ${corpus.scopeDescription()}. ` +
      `Tiers tried: T1 exact substring, T2 whitespace-collapsed (floor ${NAMED_SOURCE_COLLAPSE_MIN_LENGTH} characters in the named ${kind}, ${COLLAPSE_MIN_LENGTH} elsewhere), ${formatting ? "T2n normalised for a space the file has before a list comma, typographic marks and Unicode forms (the same floors; in documents and translation files only), " : ""}T3 independent fragments (floor ${FRAGMENT_COLLAPSE_MIN_LENGTH}), T5 first-line fallback` +
      `${decodeChanges ? ", each in both the written and the HTML-entity-decoded form" : ""}. ` +
      `The quotation is kept exactly as the document wrote it; deciding what it means is not this tool's to make.`,
  );
  return row("unverifiable", null, null, false, notes);
}

/* --------------------------------------------------------------------------------------------- *
 * Reading the report's own line references.
 * --------------------------------------------------------------------------------------------- */

/**
 * `evidence[].lines` is a free string — "42" or "42-47". Only the ENDPOINTS are taken as declared
 * claims, never every number between them.
 *
 * Both readings agree on a correct row: for a real span [42,47] both endpoints fall inside it and
 * the row confirms. They differ on a wrong one, and the endpoint reading is the one that says
 * something true. loop-probe's replay records the case: a fact declared at [54,57] whose real quote
 * spans [54,56], where 57 names a real but unquoted next line — not a genuine claim about where the
 * quote is, and repairing it to [54,56] is the honest label. Expanding the range instead would also
 * make the cost of a malformed range unbounded, which a report written by an agent must never be
 * able to do to the verifier.
 */
/* --------------------------------------------------------------------------------------------- *
 * WHICH BODY OF EVIDENCE A CITATION NAMES.
 * --------------------------------------------------------------------------------------------- */

/**
 * One citation's own statement of where it is: a file under `--target`, or a document in
 * `documents_read[]`.
 *
 * **Why this is a function and not two lines at each call site.** Until 2026-09-03 there was one
 * addressing scheme, `file`, documented "Path relative to target" — and a citation of a DOCUMENT was
 * valid only by accident, when the document happened to be a repository file whose path was also a
 * filesystem path. A live-fetched policy broke the accident: `https://bitwarden.com/privacy/` is a
 * digest-pinned `documents_read[]` entry and is never a path, so the verifier resolved it under
 * `--target` and failed with `ENOENT ... 'https:/bitwarden.com/privacy'` on all six citations of it
 * (hole 8 of the bitwarden-url run), and all six were reworded out of a finished report to reach
 * exit 0.
 *
 * **What those six turned out to be, measured against the real extracted text rather than assumed**
 * (independent verification, 2026-09-03, B1 — the first version of this comment said all six were
 * real). TWO were byte-exact quotations, and this shape verifies them. FOUR were search hits that
 * could never have verified: three carry literal leading and trailing `...` elision markers, and one
 * has a space typed where the page carries a private-use icon glyph. `document_ref` removes the
 * ENOENT; it does not remove a transcription defect underneath one, and nothing here should be read
 * as claiming it does. **The result is a stronger case for this repair, not a weaker one:** under the
 * ENOENT all six read as the identical failure, so the tool could not tell a byte-exact quotation of
 * a real policy from a spliced one, and a report could be "repaired" by deleting either.
 *
 * Four cases, all four named, because the two that are not a citation must not read as one:
 * - `code` — a `file` and no `document_ref`.
 * - `document` — a `document_ref` and no `file`.
 * - `both` — the schema's `oneOf` refuses this shape; a report that reaches this code carrying both
 *   names two bodies of evidence for one line, and picking one of them would be the verifier
 *   deciding what the report meant.
 * - `none` — neither, which names nowhere at all.
 */
export type CitationKind = "code" | "document" | "both" | "none";

export interface CitationTarget {
  kind: CitationKind;
  /** The name to search, empty for `both` and `none` — neither of which asserts one source. */
  name: string;
  /** Why this citation names no single source, empty where it names one. */
  problem: string;
}

export function citationTarget(entry: { file?: unknown; document_ref?: unknown }): CitationTarget {
  const file = typeof entry.file === "string" && entry.file.length > 0 ? entry.file : "";
  const ref =
    typeof entry.document_ref === "string" && entry.document_ref.length > 0 ? entry.document_ref : "";
  if (file && ref) {
    return {
      kind: "both",
      name: "",
      problem:
        `this citation names a file (${JSON.stringify(file)}) AND a document (${JSON.stringify(ref)}). ` +
        `Exactly one of the two is a citation; two of them are two bodies of evidence for one line, and choosing between them is not this tool's to do. Write one entry per source`,
    };
  }
  if (ref) return { kind: "document", name: ref, problem: "" };
  if (file) return { kind: "code", name: file, problem: "" };
  return {
    kind: "none",
    name: "",
    problem: "this citation names neither a file under --target nor a document in documents_read, so there is no source to check it against",
  };
}

export function parseEvidenceLines(lines: unknown): number[] {
  if (typeof lines === "number" && Number.isFinite(lines)) return [lines];
  if (typeof lines !== "string") return [];
  const numbers = lines.match(/\d+/g);
  if (!numbers || numbers.length === 0) return [];
  const first = Number.parseInt(numbers[0], 10);
  const last = Number.parseInt(numbers[numbers.length - 1], 10);
  if (!Number.isFinite(first)) return [];
  if (!Number.isFinite(last) || last < first) return [first];
  return sortUnique([first, last]);
}

/* ============================================================================================= *
 * EXTRACTION: the quote the tool takes, in place of the quote the model types.
 * ============================================================================================= *
 *
 * **The defect class this exists to make impossible.** Five transcription shapes are named in
 * `SKILL.md` step 9 and in the reconciler persona, and one of them dominates every run: an ELLIPSIS
 * joining two real strings that are not adjacent, producing a string that exists nowhere in the
 * developer's file. Run 1: 10 of 28 defects. Run 2: it recurred 3 times in 126 quotations **after
 * the paragraph naming it was pasted verbatim into all 11 briefs that could produce one**. Run 3:
 * 10 of 12 defects, **after run 2's own repair — a mandatory three-step quoting ORDER, also pasted
 * into every brief — was in force**. Three runs, three statements of the rule, three recurrences.
 *
 * A rule stated three times and broken three times is not a rule that needs stating a fourth time.
 * The only thing that has ever caught this class is the mechanical byte comparison after the fact,
 * and the orchestrator then repairs each instance by hand — 12 of them in run 3, one at a time.
 *
 * **So the smallest change that removes the class rather than catching it: the model stops
 * transcribing.** An evidence entry may now carry a LOCATION and no `quote`, and this function
 * writes the quote from the real bytes. What the model chooses is which lines are the evidence,
 * which is a judgement it must make and which no tool can make for it; what it no longer does is
 * retype them, which is a copying task at which it measurably fails.
 *
 * **What this does NOT claim.** It does not check that the range supports the finding — that is
 * reading comprehension and belongs to the refuter and to the human reader, and it is stated in
 * `not_verified_here` beside the other three such limits. An extracted quote's later verification is
 * a tautology, and it is labelled `extracted-from-declared-range` in the report and counted
 * separately in the summary precisely so that no reader mistakes a tautology for a check.
 *
 * **Nothing is required to use it and nothing is removed.** An entry that carries a `quote` is
 * verified exactly as before, byte for byte, against exactly the same waterfall. This is a second
 * way to write evidence, beside the one that exists — never a replacement for it, because a document
 * quotation a claim turns on is often one sentence a model must FIND, and finding it is the work.
 */

/**
 * Longest range this will extract, in lines.
 *
 * **`T3_MAX_TOTAL_SPAN`, imported and not restated**, because it is the same judgement: T3 refuses to
 * treat fragments spanning more than 40 lines as one coherent quotation, and a 200-line "quotation"
 * is not one either. A range over the bound is refused, the entry keeps no quote, and the refusal is
 * recorded on the check — an unbounded range must never be able to put a whole file into a report.
 */
const EXTRACT_MAX_LINES = T3_MAX_TOTAL_SPAN;

/** Where a quote's text came from. Absent on a report written before 2026-09-03. */
export type QuoteSource = "agent-transcribed" | "extracted-from-declared-range";

/**
 * The verbatim text of `[from, to]` in `entry`, or a refusal naming why.
 *
 * **Reads whichever corpus the citation itself named, and never a third thing.** From 2026-09-03
 * that is two corpora rather than one: an entry naming a `file` is extracted from the code corpus —
 * the bytes of the file under `--target` — and an entry naming a `document_ref` from the DOCUMENT
 * corpus, which is `buildDocumentCorpus`'s padded extracted text.
 *
 * **The rule the earlier one-corpus version was written to hold is unchanged, and this is the whole
 * of it: the bytes extracted are the bytes the waterfall then searches.** The first version of this
 * comment described a `documents[]` branch that did not exist, and the warning attached to removing
 * it was that extending extraction without wiring the document corpus would have the tool write a
 * quotation of the RAW file where the verifier compares against the EXTRACTED text — one of the five
 * transcription defect shapes this mechanism exists to remove (independent verification, 2026-09-03,
 * LOW 1). The document corpus is now wired, and it IS the extracted text: `fillEvidenceRanges` hands
 * this function `docs.get(ref)`, the same `SourceEntry` `verifyOneQuote` searches for that document,
 * so a document extraction and its own verification read one body of text by construction. The raw
 * fetched bytes are not reachable from here at all — the CLI never persists them — which is what
 * makes the defect shape impossible rather than merely forbidden.
 */
export function extractDeclaredRange(
  entry: SourceEntry | null,
  from: number,
  to: number,
  /** The corpus's own reason for having no entry, where it has one. */
  sourceProblem = "",
): { text: string } | { refusal: string } {
  if (!entry) {
    // The corpus already computed WHY — outside `--target`, absolute, missing, not a file — and a
    // refusal that discards it tells a reader to go and re-derive what the tool already knew
    // (LOW 5).
    return {
      refusal: sourceProblem
        ? `nothing was extracted: ${sourceProblem}`
        : "the source this range names could not be read, so nothing was extracted",
    };
  }
  if (!Number.isFinite(from) || from < 1) return { refusal: `the declared start line ${from} is not a line number` };
  const split = entry.text.split("\n");
  // **A trailing newline is a terminator, not a line.** `"a\nb\n".split("\n")` yields three
  // elements and the third is the empty string after the last terminator; counting it made the
  // refusal below tell a reader their 5-line file has 6 lines, which is the tool being wrong about
  // the file in the sentence whose whole job is to state the file's real length. Only ONE trailing
  // empty is dropped, so a file genuinely ending in a blank line keeps it.
  const lines = split.length > 1 && split[split.length - 1] === "" ? split.slice(0, -1) : split;
  const end = Number.isFinite(to) && to >= from ? to : from;
  if (end - from + 1 > EXTRACT_MAX_LINES) {
    return {
      refusal:
        `the declared range spans ${end - from + 1} lines, over the ${EXTRACT_MAX_LINES}-line bound this tool will extract ` +
        `(the same bound T3 applies to a multi-line quotation's coherence). Name a shorter range, or write several entries`,
    };
  }
  if (from > lines.length) {
    return { refusal: `the source has ${lines.length} line(s) and the range starts at ${from}` };
  }
  // **A range that runs off the end is REFUSED, not silently trimmed** (LOW 2). Trimming it wrote a
  // 2-line quotation, reported it as "17 line(s) from src/a.swift:4-20", and then had the verifier
  // mark the tool's OWN quotation `repaired` — a drift the tool manufactured for itself, landing in
  // the bucket a reader is told is "not a fault". The same shape as the `from > lines.length`
  // refusal above, and for the same reason: a location that is not the location named is not a
  // location this tool may quote from.
  if (end > lines.length) {
    return {
      refusal:
        `the declared range ends at line ${end} and the source has ${lines.length} line(s), so the range names text that is not there. ` +
        `Name a range inside the file`,
    };
  }
  const slice = lines.slice(from - 1, end);
  const text = slice.join("\n");
  if (text.trim() === "") {
    return { refusal: `lines ${from}-${end} of this source are blank, so there is nothing to quote` };
  }
  /* **THE LENGTH BOUND THE LINE BOUND CANNOT SEE, and the case it was measured on.**
   *
   * `EXTRACT_MAX_LINES` bounds an extraction so that "an unbounded range must never be able to put a
   * whole file into a report". It bounds LINES, and a line has no length. On a server-rendered HTML
   * page there is no reason to put a newline between block elements, so the whole rendered body
   * arrives as one line: `https://bitwarden.com/privacy/` extracted to 33 lines, of which one carries
   * 33,881 characters — the entire policy. A location-only citation of `lines: "87"` there is inside
   * the 40-line bound and would have this tool write the whole document into an evidence field, and
   * then confirm it against itself at exit 0.
   *
   * **What this bounds is HOW MUCH TEXT THIS TOOL WILL WRITE, and that is not the same predicate as
   * the one-enormous-line warning, though it shares its mark.** The warning tests a document's
   * LONGEST SINGLE LINE and speaks to a person about citation precision; this tests the TOTAL LENGTH
   * of the slice about to be written and speaks to the tool about how much it may put in an evidence
   * field. The first version of this refusal said the two were the same judgement and told the reader
   * that "this run's one-enormous-line warning" had printed — false for a range of two ordinary
   * 3,000-character lines, where no such warning fires (independent verification, 2026-09-03, L1).
   * The mark is genuinely shared, and `LINE_LOCATES_NOTHING_CHARS` is imported from `extract.ts`
   * rather than written twice; the two predicates are stated apart because they are apart.
   *
   * **It is a refusal, never a truncation**, for the reason the over-running range above is a refusal:
   * a quotation this tool trims is a location that is not the location named. The agent quotes the
   * passage itself — a short, distinctive, contiguous run of words, which is what the skill's own
   * one-enormous-line guidance asks for and what run 4 practised in all five batches that quoted this
   * page. Nothing is lost: the transcribed form is verified by the same waterfall, and a document
   * whose lines are ordinary is extracted exactly as a file is. */
  if (text.length >= LINE_LOCATES_NOTHING_CHARS) {
    return {
      refusal:
        `the text at ${from === end ? `line ${from}` : `lines ${from}-${end}`} is ${text.length} characters, at or over the ${LINE_LOCATES_NOTHING_CHARS}-character bound on how much text this tool will write into one evidence entry ` +
        `(the same mark the one-enormous-line warning uses, applied here to the whole slice rather than to a single line). A quotation this long is the document rather than a passage of it, so nothing was extracted. ` +
        `Quote a short, distinctive, contiguous run of the words yourself and say that the line number alone does not pinpoint it`,
    };
  }
  /* **THE READABILITY REFUSAL. A quotation this tool writes must be text.**
   *
   * `buildCodeCorpus` reads with `readFileSync(abs, "utf8")`, so a file whose bytes are not UTF-8
   * decodes to U+FFFD runs and NULs. Without this clause the extraction wrote that mojibake into
   * `findings[].evidence[].quote` — a legal-evidence field — labelled it
   * `extracted-from-declared-range`, and the waterfall then trivially CONFIRMED it against the same
   * bytes at exit 0. Before this mechanism existed the identical citation was `unverifiable` at exit
   * 5. **That is a caught error turned into a silent confirmation, inside the change whose whole
   * purpose is to remove a silent defect class** — found by independent verification on the day this
   * shipped, demonstrated with a PDF and with a UTF-16LE `Localizable.strings`, which is Xcode's
   * DEFAULT encoding for that file and therefore the commonest shape on exactly the tree class this
   * wave was built for.
   *
   * The test is the walker's own, imported rather than restated (`decodedTextIsBinary`), exactly as
   * `census.ts` and `discover.ts` import it — one "is this text?" rule, in one place. The second
   * clause catches what the first cannot: UTF-16 text decoded as UTF-8 yields no NUL in the first
   * 4096 characters when the BOM sits at the start and the interleaved zero bytes decode to
   * replacement characters instead (Shift-JIS and Latin-1 carry no NUL, so the file-level clause
   * never sees them; every UTF-16 variant IS caught by the file-level NUL test), so the SLICE is
   * tested for U+FFFD and for NUL — a clean-for-4096-chars file can still carry a raw NUL in the
   * cited line (re-check residual, 2026-09-03).
   *
   * **A refusal, never a transcoding.** A real declaration published as UTF-16 is a document this
   * tool cannot quote from today, and the honest floor for that is to say so — named on the console,
   * carrying no quotation, exit 5 — rather than to guess an encoding inside an evidence field.
   * Recovering such a file is the agent's to do: transcribe the quotation itself, or cite a text
   * file. Building transcoding here would be a new decision about what a file IS, taken inside a
   * verifier, and it is deliberately not taken in this round. */
  if (decodedTextIsBinary(entry.text) || text.includes("\uFFFD") || text.includes("\u0000")) {
    return {
      refusal:
        `the bytes this range names do not decode as text — ${decodedTextIsBinary(entry.text) ? "a NUL byte inside the first 4096 characters of the file" : text.includes("\u0000") ? "a NUL byte inside the range itself, past the file-level window" : "replacement characters inside the range, which is what UTF-16 or another non-UTF-8 encoding decodes to"} — ` +
        `so nothing was extracted and this entry carries no quotation. Transcribe the quotation yourself, or cite a text file`,
    };
  }
  return { text };
}

/**
 * The row's own statement that it was checked against different bytes from the ones the report read.
 *
 * The PROVENANCE block already says this per document, and the run-level sentence is not enough on
 * its own: a reader of one `quote_checks[]` row sees `confirmed_at_declared` and a document name, and
 * nothing on the row says which version of that document confirmed it. So the note travels with the
 * row. **It changes no status and no exit code** — that is the settled decision recorded on
 * `provenance.documents_with_pin_mismatch`, "the check still runs, against the input's text, because
 * that is the text this tool can read" — and it is deliberately NOT the decision extraction takes,
 * where the tool would be writing the text rather than checking one the agent wrote.
 */
function documentPinNotes(target: CitationTarget, pinMismatched: ReadonlySet<string>): string[] {
  if (target.kind !== "document" || !pinMismatched.has(target.name)) return [];
  return [
    `the report records reading a different version of this document from the one the reconciliation input carries (their sha256 digests differ). This check ran against the input's text, because that is the text this tool can read — so a confirmation here is a confirmation against different bytes from the ones the report says were read. See the PROVENANCE block.`,
  ];
}

function declaredLineOf(line: unknown): { lines: number[]; notes: string[] } {
  if (typeof line === "number" && Number.isFinite(line) && line > 0) return { lines: [line], notes: [] };
  return {
    lines: [],
    notes: [
      `the report carries no usable line number for this quote (${JSON.stringify(line)}), so the search runs without one and no position can be confirmed`,
    ],
  };
}

/* --------------------------------------------------------------------------------------------- *
 * The run.
 * --------------------------------------------------------------------------------------------- */

export interface VerifyQuotesOptions {
  report: DeclarationsReport;
  input: ReconcileInput;
  /** Root the report's file paths are relative to, as the user typed it. */
  targetRoot: string;
}

export interface VerifyQuotesResult {
  /** A copy of the report with the annotations added. The agent's own fields are untouched. */
  annotated: DeclarationsReport;
  summary: QuoteVerificationSummary;
  checks: QuoteCheck[];
  /** True when the target root is not a directory this process can read. */
  target_problem: string;
}

function emptyCounts(): Record<QuoteVerificationStatus, number> {
  return {
    confirmed_at_declared: 0,
    repaired: 0,
    re_attributed: 0,
    ambiguous: 0,
    unverifiable: 0,
  };
}

/**
 * Searches that claim more hits than they list, named as `<owner>.searches[<n>]`.
 *
 * Only the listed lines can be checked, so a search saying `hit_count: 47` with an empty `hits[]`
 * has had nothing checked at all while reading, wherever it is printed, as forty-seven found lines.
 * Naming those searches is what keeps a truncated list from passing as a fully checked one.
 *
 * Exported and taken as a list of owners rather than read off `report.findings` in place, because
 * the questionnaire side has the same field on a different object and had gone without this check
 * entirely: `{hit_count: 47, hits: []}` verified clean there and printed "47 hit(s)" to somebody
 * else's customer. One implementation, two callers — the same arrangement as the waterfall itself.
 */
export function searchesOverReportingHits(
  owners: { path: string; searches?: { hit_count?: number; hits?: unknown[] }[] }[],
): string[] {
  const out: string[] = [];
  for (const owner of owners) {
    (owner.searches ?? []).forEach((search, j) => {
      if (typeof search.hit_count === "number" && search.hit_count > (search.hits ?? []).length) {
        out.push(`${owner.path}.searches[${j}]`);
      }
    });
  }
  return out;
}

/**
 * The five counts, the fallback population and the total, from a list of checks.
 *
 * Exported so the second caller of this waterfall counts with this arithmetic rather than its own.
 * `fallback_anchored` is deliberately not one of the five: such a row already carries a status word
 * — usually `repaired` — and it is counted again here because the exit code turns on it.
 */
export function countQuoteChecks(checks: QuoteCheck[]): {
  counts: Record<QuoteVerificationStatus, number>;
  fallback_anchored: number;
  total: number;
} {
  const counts = emptyCounts();
  for (const c of checks) counts[c.status]++;
  return {
    counts,
    fallback_anchored: checks.filter((c) => c.fallback).length,
    total: checks.length,
  };
}

/**
 * The exit rule, in one place: not-found and first-line-only both fail, ambiguous does not.
 *
 * See EXIT_NOT_FULLY_VERIFIED for why the first two share a code and `quoteVerificationExitCode`
 * for why `ambiguous` is not among them.
 */
export function quoteExitCodeFor(
  counts: Record<QuoteVerificationStatus, number>,
  fallbackAnchored: number,
): number {
  return counts.unverifiable > 0 || fallbackAnchored > 0
    ? EXIT_NOT_FULLY_VERIFIED
    : EXIT_ALL_VERIFIED;
}

/** One evidence entry whose quote this tool wrote, or refused to write, from a declared location. */
export interface QuoteExtraction {
  /** The JSON path of the entry, in the same vocabulary `QuoteCheck.path` uses. */
  path: string;
  /** The source named — a `documents[]` path or a file under `--target`. */
  source: string;
  /** The declared range, as the report wrote it. */
  declared: string;
  /** Present when the extraction succeeded: how many lines were taken. */
  lines?: number;
  /** Present when it did not: why, in the tool's own words. */
  refusal?: string;
}

/**
 * Write the quote of every evidence entry that named a location and no text.
 *
 * Returns a COPY. `opts.report` is never modified — the agent's own object is the evidence of what
 * the agent asserted, and that is the same reason the annotated report is written to its own path.
 *
 * The per-entry work is `fillEvidenceRanges`, exported so that `questionnaire verify` runs the
 * IDENTICAL pass over the identical `CodeEvidence` shape instead of keeping a second one. Both
 * documents carry that shape, both are checked by the same waterfall, and this algorithm has already
 * been independently rebuilt three times in this repository with two of the rebuilds shipping the
 * same bug.
 *
 * **ONE entry kind carries this: `findings[].evidence[]`, which cites a range of real source.**
 * That is where the class lands — 7 of run 3's 12 quotation defects were finding evidence — and it
 * is the only quotation in the report whose job is to let a reader OPEN the lines rather than to
 * pick a sentence out of a page.
 *
 * The other three are deliberately not extractable, and the reason is the same for all three:
 * `claims[].quote`, `findings[].quote` and `checklist_results[].evidence[].quote` each name the
 * sentence in the developer's own document that a claim or an item turns on, and choosing that
 * sentence out of a page that says many things IS the work. Extracting "whatever is on line 412"
 * would let an item answer `present` from a location where nothing was chosen. Those three stay on
 * the mechanical byte check, which already catches them. **That holds unchanged for a document a
 * finding's evidence now cites by `document_ref`**: what became extractable is the finding's own
 * evidence entry, which is a RANGE a reader opens, and not the three fields whose whole content is a
 * choice of sentence.
 */
/**
 * Renamed from `fillCodeEvidenceRanges` on 2026-09-03, when the entry stopped being code-only.
 * "Code" in the old name described the one corpus it could read; an entry naming a `document_ref` is
 * now filled from the document corpus, and a name that says code while routing documents is the
 * class of small untruth this repository keeps finding in its own output.
 */
export function fillEvidenceRanges(
  entries: { path: string; evidence: CodeEvidence[] }[],
  code: Corpus,
  /**
   * The extracted documents, for entries naming a `document_ref`. **A caller with none — the
   * questionnaire side, which has no reconciliation input — passes nothing, and such an entry is
   * REFUSED by name rather than silently falling through to an empty file path.** A refused entry
   * carries no quotation, so the waterfall then reaches it empty and it comes back `unverifiable` at
   * exit 5, which is the honest floor for a citation this command cannot check.
   */
  docs?: Corpus,
  /**
   * Documents whose digest in the report is not the digest in the reconciliation input.
   *
   * **Extraction is REFUSED for these, and that is not the same decision the byte check takes for a
   * transcribed quotation.** A transcribed quotation is the agent's own assertion, and checking it
   * against the input's text still answers a real question — the run says so in the PROVENANCE block
   * and on the row. An EXTRACTION is the tool writing text into a legal-evidence field and then
   * confirming it against the bytes it just read: under a digest mismatch that text would come from
   * bytes the report itself says were not the ones read, and the check would confirm at exit 0. That
   * is the shape the readability guard was written against — a caught error turned into a silent
   * confirmation inside the mechanism whose purpose is to remove a silent defect class.
   */
  pinMismatchedDocs?: ReadonlySet<string>,
): QuoteExtraction[] {
  const extractions: QuoteExtraction[] = [];
  for (const { path: owner, evidence } of entries) {
    evidence.forEach((ev, j) => {
      const path = `${owner}.evidence[${j}]`;
      const target = citationTarget(ev);
      const source = target.name;
      const declared = String(ev.lines ?? "");
      if (typeof ev.quote === "string" && ev.quote.length > 0) {
        /* **The agent transcribed this one, so the tool's own label comes OFF it.** The schema says
         * `quote_source` is "Written by `reconcile-verify`, never by the agent", and nothing enforced
         * that: an entry arriving with a real transcribed quotation AND
         * `quote_source: "extracted-from-declared-range"` kept the false provenance into the
         * annotated report and confirmed at exit 0 claiming a byte-for-byte guarantee it does not
         * have (independent verification, LOW 3). A rule a schema states and nothing checks is a rule
         * that is already broken somewhere. Deleted rather than flagged, because the field's whole
         * meaning is "this tool wrote the text", and this tool did not. */
        delete (ev as { quote_source?: QuoteSource }).quote_source;
        return;
      }
      /* **A `lines` value that is not ONE CONTIGUOUS RANGE is refused, never read as one** (LOW 4).
       * `parseEvidenceLines` returns first and last, which is the right tolerance for VERIFYING a
       * location the agent declared — the endpoints are what a drifted citation gets right, and a
       * loose read there can only ever place a quotation the agent already wrote. For WRITING a
       * quotation it is the wrong tolerance: read as endpoints, `lines: "2,4"` puts line 3 into a
       * legal-evidence field, and line 3 is a line nobody named.
       *
       * The test is the SEPARATOR and not the count, because `"2,4"` and `"2-4"` both carry two
       * numbers and mean different things. The schema documents `"42"` and `"42-47"`; a hyphen, an
       * en dash and an em dash are the ways a range is written, and everything else — a comma, a
       * semicolon, the word "and" — is a list. */
      const raw = typeof ev.lines === "string" ? ev.lines.trim() : String(ev.lines ?? "");
      if (!/^\d+\s*(?:[-\u2013\u2014]\s*\d+\s*)?$/.test(raw)) {
        extractions.push({
          path,
          source,
          declared,
          refusal:
            `the declared location ${JSON.stringify(raw)} is not one contiguous range, and this tool extracts one contiguous range only. ` +
            `Read as a first and a last line it would put lines nobody named into the quotation. Write "42" or "42-47", one entry per range`,
        });
        return;
      }
      const declaredLines = parseEvidenceLines(ev.lines);
      if (declaredLines.length === 0) {
        extractions.push({ path, source, declared, refusal: "no line or line range was declared, so there is no location to extract from" });
        return;
      }
      /* Which corpus, decided by the citation's own shape and never by which field it sits in.
       * `both` and `none` are refused by name: neither is a citation of one source, and picking one
       * would be the tool deciding what the report meant. */
      if (target.kind === "both" || target.kind === "none") {
        extractions.push({ path, source, declared, refusal: `nothing was extracted: ${target.problem}` });
        return;
      }
      if (target.kind === "document" && !docs) {
        extractions.push({
          path,
          source,
          declared,
          refusal:
            `this entry names a document (${JSON.stringify(source)}) and this command verifies against files under --target only — it has no reconciliation input and therefore no extracted document text. ` +
            `Nothing was extracted and this entry carries no quotation. Cite a file, or transcribe the passage yourself`,
        });
        return;
      }
      if (target.kind === "document" && pinMismatchedDocs?.has(source)) {
        extractions.push({
          path,
          source,
          declared,
          refusal:
            `the report records reading a different version of this document from the one the reconciliation input carries (their sha256 digests differ), so the bytes at this location are not the bytes the report says were read. ` +
            `Writing a quotation from them would confirm text this run never read, at exit 0 — nothing was extracted and this entry carries no quotation. Re-run reconcile, or transcribe the passage from the version you read`,
        });
        return;
      }
      const corpus = target.kind === "document" ? docs! : code;
      const from = declaredLines[0];
      const to = declaredLines[declaredLines.length - 1];
      const got = extractDeclaredRange(corpus.get(source), from, to, corpus.problemFor(source));
      if ("refusal" in got) {
        extractions.push({ path, source, declared, refusal: got.refusal });
        return;
      }
      /* **Known asymmetry, inherited and not introduced here** (independent verification,
       * 2026-09-03, L8). When an extraction is REFUSED for any reason other than a digest mismatch,
       * the reason travels in `extractions[]` and on the console but not onto the `quote_checks[]`
       * row, which then shows only "the quotation is empty". Only the pin-mismatch case puts its
       * reason on the row, through `documentPinNotes`. This is pre-existing for `file` citations and
       * is now inherited by `document_ref` rather than created by it; closing it means routing every
       * refusal onto the row, which changes the `file` path's output too and belongs in its own
       * wave with its own pins. Recorded here so the next reader of this function finds it. */
      ev.quote = got.text;
      ev.quote_source = "extracted-from-declared-range";
      // The lines ACTUALLY taken. `to - from + 1` is the declared span, and the two differed
      // whenever a range over-ran the file — the console then reported 17 lines for a 2-line
      // quotation (LOW 2). The over-run is refused above, so they now agree by construction; this
      // reads the slice anyway, because a count derived from the text cannot drift from it.
      extractions.push({ path, source, declared, lines: got.text.split("\n").length });
    });
  }
  return extractions;
}

function fillDeclaredRanges(
  original: DeclarationsReport,
  code: Corpus,
  docs: Corpus,
  pinMismatchedDocs: ReadonlySet<string>,
): { report: DeclarationsReport; extractions: QuoteExtraction[] } {
  // Cloned before anything is written, so a refusal leaves the original untouched too.
  const report = JSON.parse(JSON.stringify(original)) as DeclarationsReport;
  const extractions = fillEvidenceRanges(
    (report.findings ?? []).map((f, i) => ({ path: `findings[${i}]`, evidence: f.evidence ?? [] })),
    code,
    docs,
    pinMismatchedDocs,
  );
  return { report, extractions };
}

/**
 * Documents whose digest in the report is not the digest in the reconciliation input.
 *
 * Computed here as well as in the provenance block below because EXTRACTION runs before the
 * provenance block and has to refuse on it — and computing it twice from one function is the
 * arrangement this repository asks for over two copies of the comparison.
 */
function pinMismatchedDocuments(report: DeclarationsReport, input: ReconcileInput): Set<string> {
  const inputByPath = new Map((input.documents ?? []).map((d) => [d.doc_path, d]));
  const out = new Set<string>();
  for (const read of report.documents_read ?? []) {
    const doc = inputByPath.get(read.path_or_url);
    if (doc && doc.sha256 !== read.sha256) out.add(read.path_or_url);
  }
  return out;
}

/* --------------------------------------------------------------------------------------------- *
 * THE ID CROSS-REFERENCE CHECK — hole 9 of the bitwarden-url run, 2026-09-03.
 * --------------------------------------------------------------------------------------------- */

/**
 * Every prose field a claim or finding id can be named in, with the path a reader goes to.
 *
 * Assembly renumbers `claims[]` and `findings[]` globally — each seat numbers its own output from
 * `C1`/`F1` — and rewrites the STRUCTURED references (`findings[].claim_ref`). It cannot rewrite the
 * plain-text ones, and on run 4 one finding's narrative said "C1 is an unqualified claim … C3
 * discloses … (C7)" about a seat's local numbering the same run had renumbered to C13/C15/C19.
 * Nothing mechanical could see it: a bare `C3` inside a prose field is not a quotation and not a
 * reference the schema knows about.
 */
function proseFields(report: DeclarationsReport): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const add = (path: string, text: unknown) => {
    if (typeof text === "string" && text.length > 0) out.push({ path, text });
  };
  (report.claims ?? []).forEach((c, i) => {
    add(`claims[${i}].claim`, c.claim);
    add(`claims[${i}].falsifiable_by`, c.falsifiable_by);
  });
  (report.findings ?? []).forEach((f, i) => {
    add(`findings[${i}].finding_text`, f.finding_text);
    // The agent's own English rendering of a non-English quotation — prose it WROTE, so an id can be
    // named in it, and it was missed on the first pass (independent verification, 2026-09-03, L7).
    // The verbatim quotation fields beside it are deliberately not read: an id inside `quote.text` is
    // the developer's own words and is not this report's cross-reference.
    add(`findings[${i}].quote_translation`, f.quote_translation);
    add(`findings[${i}].refutation.reasoning`, f.refutation?.reasoning);
  });
  (report.checklist_results ?? []).forEach((r, i) => add(`checklist_results[${i}].reasoning`, r.reasoning));
  (report.applicability_verdicts ?? []).forEach((v, i) =>
    add(`applicability_verdicts[${i}].reasoning`, v.reasoning),
  );
  (report.considered_and_rejected ?? []).forEach((c, i) => {
    add(`considered_and_rejected[${i}].subject`, c.subject);
    add(`considered_and_rejected[${i}].reason`, c.reason);
  });
  return out;
}

const ID_PREFIX_RE = /^(.*?)(\d+)$/;
/**
 * The alphabetic run at the end of a prefix, after its last non-alphanumeric separator.
 *
 * **This is what keeps the check alive under the repair for the defect it was written from**
 * (independent verification, 2026-09-03, M2). The class fix for hole 9 is that each seat emits ids in
 * its own namespace — `store-C1`, `gdpr-F1` — so that assembly never renumbers. Derived flatly, that
 * yields the prefixes `store-C` and `gdpr-F`, and a bare `C1` left in prose by a seat that numbered
 * the old way is then not searched for at all: the net went to ZERO coverage on exactly the reports
 * that adopt the fix, with four bad references present and `checked = 0`.
 *
 * So a namespaced prefix contributes its bare letter as well. **The letter still comes from the
 * report's own ids** — nothing is invented that the report does not already use — and the cost is
 * stated rather than hidden: a report using `store-C1` also has bare `C<digits>` searched for, so a
 * prose token like `C4` that means something else now reports as dangling. That is the same exposure a
 * report with un-namespaced ids already carries, and the direction is right: a false name is visible
 * and correctable, a missing check is neither.
 */
const ID_NAMESPACE_TAIL_RE = /[^A-Za-z0-9]([A-Za-z]+)$/;
/** Characters around a dangling reference, so the sentence can be corrected without opening the file. */
const ID_CONTEXT_CHARS = 40;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Id-shaped tokens in prose, resolved against the ids the report actually carries.
 *
 * **The token shape is DERIVED FROM THE REPORT'S OWN IDS and never fixed here.** Each `claim_id` and
 * `finding_id` is split into a leading prefix and trailing digits; the prefixes that result are what
 * is searched for, together with the bare letter at the end of a namespaced prefix (see
 * `ID_NAMESPACE_TAIL_RE`, which is what keeps the check alive under the per-seat-namespace repair). A
 * report whose ids are `C1`/`F1` has `C<digits>` and `F<digits>` searched and nothing else; one whose
 * ids are `store-C1`/`gdpr-F1` has those two shapes AND the bare `C<digits>`/`F<digits>` a stale
 * sentence would use. That is what keeps the check from inventing a vocabulary the report does not
 * use, and from firing on any word a prose field contains.
 *
 * **Two populations are reported apart, because neither may be inferred from a zero.** `prefixes` is
 * exactly what was searched for. `ids_not_cross_referenced` counts the ids that contributed no shape
 * at all — an id of bare digits, whose empty prefix would match every number in every prose field,
 * and an id with no trailing digits, which has no numbered shape to look for. A report where that
 * count is non-zero has had less checked than its `checked` figure suggests, and the console says so.
 */
export function checkIdCrossReferences(
  report: DeclarationsReport,
): NonNullable<QuoteVerificationSummary["id_cross_references"]> {
  const ids = new Set<string>();
  for (const c of report.claims ?? []) if (typeof c.claim_id === "string" && c.claim_id) ids.add(c.claim_id);
  for (const f of report.findings ?? []) if (typeof f.finding_id === "string" && f.finding_id) ids.add(f.finding_id);

  const prefixes = new Set<string>();
  let unsearchable = 0;
  for (const id of ids) {
    const m = ID_PREFIX_RE.exec(id);
    // No trailing digits at all, or a prefix that is empty: neither yields a shape this can look for.
    // Counted rather than dropped — `prefixes` then holds ONLY what was really searched, so the
    // console's disclosure branch cannot be defeated by an empty string sitting in the list (L2).
    if (!m || m[1].length === 0) {
      unsearchable++;
      continue;
    }
    prefixes.add(m[1]);
    const tail = ID_NAMESPACE_TAIL_RE.exec(m[1]);
    if (tail) prefixes.add(tail[1]);
  }
  const prefixList = [...prefixes].sort();
  const dangling: { path: string; id: string; context: string }[] = [];
  let checked = 0;
  if (prefixList.length === 0) {
    return { prefixes: prefixList, checked, dangling, ids_not_cross_referenced: unsearchable };
  }

  // One alternation over every shape the report's own ids produce, anchored so that `ABC15` is not
  // read as `C15`. Longest first, so `store-C1` is consumed whole by `store-C` rather than being
  // entered at its own bare `C` by an alternation that happened to try the short branch first.
  const bodies = [...prefixList].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const re = new RegExp(`(?<![A-Za-z0-9_])(?:${bodies.join("|")})\\d+(?![A-Za-z0-9_])`, "g");

  for (const { path, text } of proseFields(report)) {
    for (const m of text.matchAll(re)) {
      checked++;
      const token = m[0];
      if (ids.has(token)) continue;
      const at = m.index ?? 0;
      const from = Math.max(0, at - ID_CONTEXT_CHARS);
      const to = Math.min(text.length, at + token.length + ID_CONTEXT_CHARS);
      const context =
        (from > 0 ? "…" : "") + text.slice(from, to).replace(/\s+/g, " ").trim() + (to < text.length ? "…" : "");
      dangling.push({ path, id: token, context });
    }
  }
  return { prefixes: prefixList, checked, dangling, ids_not_cross_referenced: unsearchable };
}

/**
 * Verify every quotation in `report` against `input`'s documents and the tree under `targetRoot`.
 *
 * Pure with respect to `report`: the returned `annotated` is a deep copy, and the object passed in
 * is not modified. Since 2026-09-03 the copy may carry quotes THIS TOOL wrote, for evidence entries
 * that named a location and no text — each one labelled `quote_source:
 * "extracted-from-declared-range"` in the report and counted separately in the summary, so an
 * extracted quote is never mistaken for one the agent typed and had checked.
 */
export function verifyDeclarationQuotes(opts: VerifyQuotesOptions): VerifyQuotesResult {
  const { corpus: docs, unplaced_lines } = buildDocumentCorpus(opts.input);

  /* The code scope: every FILE this report names, deduplicated, in first-appearance order so the
   * sweep is deterministic.
   *
   * A citation naming a `document_ref` contributes nothing here and must not: it is not a file, its
   * scope is the document corpus, and adding a URL to the code scope is exactly the resolution that
   * produced `ENOENT ... 'https:/bitwarden.com/privacy'` on all six citations of a fetched policy — the
   * shape's own failure, whatever each citation was worth underneath it. `citationTarget`
   * decides which of the two a citation is, once, so the scope and the check can never disagree. */
  const codeNames: string[] = [];
  const seen = new Set<string>();
  const noteFile = (entry: { file?: unknown; document_ref?: unknown }) => {
    const t = citationTarget(entry);
    if (t.kind !== "code" || seen.has(t.name)) return;
    seen.add(t.name);
    codeNames.push(t.name);
  };
  for (const f of opts.report.findings ?? []) {
    for (const e of f.evidence ?? []) noteFile(e);
    for (const s of f.searches ?? []) for (const h of s.hits ?? []) noteFile(h);
  }
  const code = buildCodeCorpus(opts.targetRoot, codeNames);
  const pinMismatchedDocs = pinMismatchedDocuments(opts.report, opts.input);

  /* EXTRACTION RUNS FIRST, on a copy, and everything below then treats the result as the report.
   *
   * An evidence entry that names a location and no quote gets its quote from the real bytes here —
   * the file's bytes under `--target`, or the pinned extracted text of the document it names; the
   * ordinary waterfall then runs over it unchanged, so there is one verification path and not two.
   * See `extractDeclaredRange` for the three-run history of the transcription defect this removes,
   * for the two length bounds and the readability refusal that keep an extraction honest, and for
   * what it deliberately does not claim. */
  const { report, extractions } = fillDeclaredRanges(opts.report, code, docs, pinMismatchedDocs);

  let targetProblem = "";
  try {
    if (!statSync(resolve(opts.targetRoot)).isDirectory()) {
      targetProblem = `--target ${opts.targetRoot} is not a directory, so no code quote below was checked against a repository.`;
    }
  } catch {
    targetProblem = `--target ${opts.targetRoot} does not exist, so no code quote below was checked against a repository.`;
  }

  const checks: QuoteCheck[] = [];
  const perClaim: QuoteCheck[][] = (report.claims ?? []).map(() => []);
  const perFinding: QuoteCheck[][] = (report.findings ?? []).map(() => []);
  const perChecklist: QuoteCheck[][] = (report.checklist_results ?? []).map(() => []);

  const run = (job: QuoteJob, bucket: QuoteCheck[]) => {
    const check = verifyOneQuote(job);
    checks.push(check);
    bucket.push(check);
  };

  // claims[].quote — the document's own words a claim was read from.
  (report.claims ?? []).forEach((claim, i) => {
    const loc = claim.source_location ?? { doc: "", line: 0 };
    const declared = declaredLineOf(loc.line);
    run(
      {
        path: `claims[${i}].quote`,
        corpus: docs,
        declaredSource: loc.doc ?? "",
        declaredLines: declared.lines,
        text: claim.quote ?? "",
        preNotes: [...declared.notes, ...documentPinNotes({ kind: "document", name: loc.doc ?? "", problem: "" }, pinMismatchedDocs)],
      },
      perClaim[i],
    );
  });

  const skipped: QuoteVerificationSummary["skipped_no_document_quote"] = [];

  (report.findings ?? []).forEach((finding, i) => {
    // findings[].quote — present for a direction-A finding, absent by design for direction B.
    if (finding.quote && typeof finding.quote.text === "string" && finding.quote.text.length > 0) {
      const declared = declaredLineOf(finding.quote.line);
      run(
        {
          path: `findings[${i}].quote`,
          corpus: docs,
          declaredSource: finding.quote.doc ?? "",
          declaredLines: declared.lines,
          text: finding.quote.text,
          preNotes: [...declared.notes, ...documentPinNotes({ kind: "document", name: finding.quote.doc ?? "", problem: "" }, pinMismatchedDocs)],
        },
        perFinding[i],
      );
    } else {
      // Never a penalty, and never a demand. SKILL.md: "A direction-B finding starts from a code
      // fact and its whole point is that no document mentions it — there is no document line to
      // quote, by construction." Requiring one there discards the findings the skill calls "where
      // the value is". A direction-A finding without one is recorded in the same list, as an
      // observation for the reader, and changes no count and no exit code.
      skipped.push({ path: `findings[${i}].quote`, direction: finding.direction });
    }

    /* **The corpus is chosen by the citation's own shape, and this is the whole of hole 8's repair
     * on the checking side.** An entry naming a `file` is checked against the tree, an entry naming
     * a `document_ref` against the extracted text the input pins — the SAME corpus, the same
     * waterfall, the same tiers, the same five states and the same exit rule that `claims[].quote`
     * already gets. Nothing here is a second algorithm; `verifyOneQuote` does not know which of the
     * two it was handed. */
    (finding.evidence ?? []).forEach((ev, j) => {
      const target = citationTarget(ev);
      run(
        {
          path: `findings[${i}].evidence[${j}]`,
          corpus: target.kind === "document" ? docs : code,
          declaredSource: target.name,
          declaredLines: parseEvidenceLines(ev.lines),
          text: ev.quote ?? "",
          preNotes: target.problem ? [target.problem] : documentPinNotes(target, pinMismatchedDocs),
        },
        perFinding[i],
      );
    });

    (finding.searches ?? []).forEach((search, j) => {
      (search.hits ?? []).forEach((hit, k) => {
        const declared = declaredLineOf(hit.line);
        const target = citationTarget(hit);
        run(
          {
            path: `findings[${i}].searches[${j}].hits[${k}]`,
            corpus: target.kind === "document" ? docs : code,
            declaredSource: target.name,
            declaredLines: declared.lines,
            text: hit.line_text ?? "",
            preNotes: [
              ...declared.notes,
              ...(target.problem ? [target.problem] : documentPinNotes(target, pinMismatchedDocs)),
            ],
          },
          perFinding[i],
        );
      });
    });
  });

  // checklist_results[].evidence[] — document quotes, and the same confabulation risk as any other.
  (report.checklist_results ?? []).forEach((result, i) => {
    (result.evidence ?? []).forEach((ev, j) => {
      const declared = declaredLineOf(ev.line);
      run(
        {
          path: `checklist_results[${i}].evidence[${j}]`,
          corpus: docs,
          declaredSource: ev.doc ?? "",
          declaredLines: declared.lines,
          text: ev.quote ?? "",
          preNotes: [...declared.notes, ...documentPinNotes({ kind: "document", name: ev.doc ?? "", problem: "" }, pinMismatchedDocs)],
        },
        perChecklist[i],
      );
    });
  });

  // Provenance: the report says which bytes it read; the input says which bytes it carries.
  const inputByPath = new Map((opts.input.documents ?? []).map((d) => [d.doc_path, d]));
  const readByPath = new Map((report.documents_read ?? []).map((d) => [d.path_or_url, d]));
  const pinMismatches: QuoteVerificationSummary["provenance"]["documents_with_pin_mismatch"] = [];
  const inReportOnly: string[] = [];
  for (const [path, read] of readByPath) {
    const doc = inputByPath.get(path);
    if (!doc) inReportOnly.push(path);
    else if (doc.sha256 !== read.sha256) {
      pinMismatches.push({ doc: path, report_sha256: read.sha256, input_sha256: doc.sha256 });
    }
  }
  const inInputOnly: string[] = [];
  for (const path of inputByPath.keys()) if (!readByPath.has(path)) inInputOnly.push(path);

  const { counts, fallback_anchored: fallbackAnchored } = countQuoteChecks(checks);

  const truncatedSearches = searchesOverReportingHits(
    (report.findings ?? []).map((f, i) => ({ path: `findings[${i}]`, searches: f.searches })),
  );

  const summary: QuoteVerificationSummary = {
    tool: "reconcile-verify",
    verifier_version: QUOTE_VERIFIER_VERSION,
    counts,
    fallback_anchored: fallbackAnchored,
    total: checks.length,
    document_checks: checks.filter((c) => c.corpus === "document").length,
    code_checks: checks.filter((c) => c.corpus === "code").length,
    code_scope: codeNames.length,
    skipped_no_document_quote: skipped,
    provenance: {
      report_reconcile_id: report.reconcile_id ?? "",
      input_reconcile_id: opts.input.reconcile_id ?? "",
      reconcile_id_matches: (report.reconcile_id ?? "") === (opts.input.reconcile_id ?? ""),
      documents_with_pin_mismatch: pinMismatches,
      documents_in_report_not_in_input: inReportOnly,
      documents_in_input_not_read_by_report: inInputOnly,
      unplaced_document_lines: unplaced_lines,
    },
    ...(extractions.length > 0 ? { extractions } : {}),
    id_cross_references: checkIdCrossReferences(report),
    not_verified_here: [
      "considered_and_rejected[] carries a `subject` and a `reason` and no quotation or location, so there is nothing in it for this tool to check; whether an entry describes what it says it describes is a reading question.",
      // THE BOUNDARY OF THE CROSS-REFERENCE CHECK, stated in the output because the run it comes
      // from sits OUTSIDE it. Run 4's stale references were C1, C3 and C7 for claims that had been
      // renumbered to C13, C15 and C19 — and C1, C3 and C7 all EXIST in that report, as three other
      // claims. A dangling check cannot see that, and only the renumbering not happening can: the
      // skill's repair is that each seat emits ids in its own namespace so assembly never renumbers
      // at all. This clause is here so that nobody reads a quiet check as the class being closed.
      "Whether an id a prose field names is the RIGHT claim or finding. This tool checks that the id exists in this report; a reference that names a real claim which is not the one the sentence means reads exactly like a correct one here. That is what a global renumbering produces — a seat's own C1 becomes C13 and the prose still says C1, which is now a different real claim — and the repair for it is that seats emit ids in their own namespace so that nothing is renumbered.",
      ...(extractions.some((e) => e.lines !== undefined)
        ? [
            "Whether an EXTRACTED range is the right range. A quote this tool wrote from a declared location cannot carry a transcription defect, and its verification below is therefore a tautology: it says the bytes came from the file, never that those lines support the finding. Which lines are the evidence is the agent's judgement and is checked by the refuter and by the reader, exactly as the wording of a transcribed quote's supporting force is.",
          ]
        : []),
      "A search that returned no hits is the evidence for a direction-B finding and is not re-run here: this tool verifies the text of the hits a search lists, never that re-running the pattern would still return them.",
      "Whether a quotation, once verified as real and correctly placed, actually supports the claim or finding it is attached to. That is reading comprehension, and it belongs to the refuter pass and to the human reader.",
    ],
    searches_reporting_more_hits_than_listed: truncatedSearches,
  };

  // The annotated copy. A deep clone through JSON, so the object the caller passed in is untouched
  // and nothing but plain data reaches the output.
  const annotated = JSON.parse(JSON.stringify(report)) as DeclarationsReport;
  annotated.quote_verification = summary;
  perClaim.forEach((list, i) => {
    if (list.length > 0) annotated.claims[i].quote_checks = list;
  });
  perFinding.forEach((list, i) => {
    if (list.length > 0) annotated.findings[i].quote_checks = list;
  });
  perChecklist.forEach((list, i) => {
    if (list.length > 0) annotated.checklist_results[i].quote_checks = list;
  });

  return { annotated, summary, checks, target_problem: targetProblem };
}

/**
 * 0 when every quotation was verified as written; EXIT_NOT_FULLY_VERIFIED when any was not.
 *
 * "Not verified as written" is two things and they share the code on purpose — see
 * EXIT_NOT_FULLY_VERIFIED. `ambiguous` is NOT among them: there the text is real and the only open
 * question is which of several sources carries it, so failing the run on it would conflate "the
 * quotation exists" with "it does not", which is the wrong trade in the direction that matters.
 */
export function quoteVerificationExitCode(result: VerifyQuotesResult): number {
  /* A THIRD population joins the two that already share this code, and it joins them rather than
   * taking a code of its own for the reason `EXIT_NOT_FULLY_VERIFIED` gives: the duty is identical.
   * A dangling id reference sends the orchestrator back to the two objects to correct the sentence,
   * exactly as an unverifiable quotation sends it back to the source. A third exit code would
   * multiply the branches a caller implements while the action stays the same.
   *
   * `quoteExitCodeFor` is deliberately NOT changed: it is the shared function `questionnaire verify`
   * exits on, and an answers document has no claim or finding ids to cross-reference. */
  if ((result.summary.id_cross_references?.dangling.length ?? 0) > 0) return EXIT_NOT_FULLY_VERIFIED;
  return quoteExitCodeFor(result.summary.counts, result.summary.fallback_anchored);
}

/* --------------------------------------------------------------------------------------------- *
 * The console.
 * --------------------------------------------------------------------------------------------- */

function locationText(loc: QuoteLocation | null): string {
  if (!loc) return "(no single position)";
  const lines = loc.lines.length === 0 ? "no line" : `line${loc.lines.length > 1 ? "s" : ""} ${loc.lines.join(", ")}`;
  // An empty source is a citation that named nowhere — one carrying BOTH a file and a document_ref,
  // or neither. Rendering it as the empty string printed `— code quote declared at  line 87`, with
  // the corpus word asserting a body of evidence the shape did not choose (independent verification,
  // 2026-09-03, L4). The refusal note is on the row already; this stops the line above it from
  // quietly disagreeing with it.
  return `${loc.source === "" ? "(no single source named)" : loc.source} ${lines}`;
}

/**
 * How a check's own line names its corpus.
 *
 * For a citation that named no single source the corpus was CHOSEN by the fallback in the routing
 * (`document` or `code`), not by the citation's shape — and `quoteCheck.corpus` says the choice is
 * "decided by the citation's own shape, never by which field it sits in". Where the shape decided
 * nothing, the word is left out rather than asserted.
 */
function corpusWord(check: QuoteCheck): string {
  return check.declared.source === "" ? "" : `${check.corpus} `;
}

function quotedText(text: string): string {
  const oneLine = text.replace(/\n/g, "\\n");
  return `"${oneLine}"`;
}

function textOfCheck(report: DeclarationsReport, check: QuoteCheck): string {
  const claim = /^claims\[(\d+)\]\.quote$/.exec(check.path);
  if (claim) return report.claims?.[Number(claim[1])]?.quote ?? "";
  const fq = /^findings\[(\d+)\]\.quote$/.exec(check.path);
  if (fq) return report.findings?.[Number(fq[1])]?.quote?.text ?? "";
  const fe = /^findings\[(\d+)\]\.evidence\[(\d+)\]$/.exec(check.path);
  if (fe) return report.findings?.[Number(fe[1])]?.evidence?.[Number(fe[2])]?.quote ?? "";
  const fh = /^findings\[(\d+)\]\.searches\[(\d+)\]\.hits\[(\d+)\]$/.exec(check.path);
  if (fh) {
    return (
      report.findings?.[Number(fh[1])]?.searches?.[Number(fh[2])]?.hits?.[Number(fh[3])]?.line_text ?? ""
    );
  }
  const ce = /^checklist_results\[(\d+)\]\.evidence\[(\d+)\]$/.exec(check.path);
  if (ce) return report.checklist_results?.[Number(ce[1])]?.evidence?.[Number(ce[2])]?.quote ?? "";
  return "";
}

/**
 * The words one caller's document needs in the alarm blocks, which are the only part of them that
 * is not the same in both callers.
 *
 * A pillar-2 report tells a developer that their own published words and their code disagree; an
 * answers document tells somebody else's customer what this code does. The failure is the same
 * failure and the tiers that find it are the same tiers, so the blocks are rendered once and the
 * two sentences that differ are supplied here rather than each caller keeping its own copy of the
 * whole block.
 */
export interface QuoteAlarmVoice {
  /** One sentence saying why a quotation found nowhere is the failure that matters here. */
  stakes: string;
  /** What the document is called, in "still in the ___, exactly as written". */
  documentNoun: string;
  /** Completes "either correct the quotation or ___" inside the fallback block. */
  withdrawInBlock: string;
  /** Completes "either correct the quotation or ___" in the closing exit line. */
  withdrawAtExit: string;
}

/**
 * The three alarm blocks — found nowhere, first line only, more than one source — in that order.
 *
 * Rendered from the checks alone, so both commands that run this waterfall print the same blocks
 * with the same emphasis in the same order. `textOf` resolves a check back to the quotation its own
 * document holds, which is the one thing only the caller can do.
 */
export function renderQuoteAlarms(
  checks: QuoteCheck[],
  textOf: (check: QuoteCheck) => string,
  voice: QuoteAlarmVoice,
  unverifiableSuffix = "",
): string[] {
  const out: string[] = [];
  const unverifiable = checks.filter((c) => c.status === "unverifiable");
  const ambiguous = checks.filter((c) => c.status === "ambiguous");
  // A fallback row is NOT a corrected position, and printing it among them is what let a fabricated
  // second line read as an ordinary drift. It gets its own block, above the counts.
  const fallback = checks.filter((c) => c.fallback);

  if (unverifiable.length > 0) {
    out.push(
      `UNVERIFIABLE — ${unverifiable.length} quotation(s) were found nowhere this tool could look.` +
        ` ${voice.stakes}` +
        unverifiableSuffix +
        ` Nothing has been removed: every item below is still in the ${voice.documentNoun}, exactly as written.`,
    );
    unverifiable.forEach((c, i) => {
      out.push(`  ${i + 1}. ${c.path} — ${corpusWord(c)}quote declared at ${locationText(c.declared)}`);
      out.push(`     text: ${quotedText(textOf(c))}`);
      for (const n of c.notes) out.push(`     ${n}`);
    });
    out.push("");
  }

  if (fallback.length > 0) {
    out.push(
      `POSITION COULD NOT BE VERIFIED, FALLBACK ANCHOR ONLY — ${fallback.length} quotation(s) had ONLY THEIR FIRST LINE found. The rest of the text is nowhere this tool could look, so the position given below is an anchor and not a verification of the quotation.` +
        ` A quotation whose first line is real and whose remaining lines are invented lands exactly here, which is why these are never printed as corrected positions and why this run does not exit as if everything were verified.` +
        ` Treat each one as unverifiable: re-read the source it names and either correct the quotation or ${voice.withdrawInBlock}. Nothing has been removed.`,
    );
    fallback.forEach((c, i) => {
      out.push(`  ${i + 1}. ${c.path} — ${corpusWord(c)}quote declared at ${locationText(c.declared)}`);
      out.push(`     text: ${quotedText(textOf(c))}`);
      out.push(`     first line anchored at ${locationText(c.final)} — the rest of the quotation was not found`);
      for (const n of c.notes) out.push(`     ${n}`);
    });
    out.push("");
  }

  if (ambiguous.length > 0) {
    out.push(
      `AMBIGUOUS — ${ambiguous.length} quotation(s) exist, and more than one source in scope carries them, so this tool asserts no position for them.`,
    );
    ambiguous.forEach((c, i) => {
      out.push(`  ${i + 1}. ${c.path} — declared at ${locationText(c.declared)}`);
      out.push(`     text: ${quotedText(textOf(c))}`);
      for (const n of c.notes) out.push(`     ${n}`);
    });
    out.push("");
  }

  return out;
}

/**
 * The closing line of a run that could not verify everything, in both callers' words.
 *
 * Kept beside the blocks above for the same reason: the sentence names two populations that share
 * one exit code, and a second copy of it is a second place for that fact to go stale.
 */
export function renderNotVerifiedExitLine(
  unverifiableCount: number,
  fallbackCount: number,
  voice: QuoteAlarmVoice,
): string {
  const parts: string[] = [];
  if (unverifiableCount > 0) parts.push(`${unverifiableCount} quotation(s) were found nowhere`);
  if (fallbackCount > 0) parts.push(`${fallbackCount} had only their first line found`);
  return (
    `Exit ${EXIT_NOT_FULLY_VERIFIED}: ${parts.join(" and ")}. Re-read the source each one names and either correct the quotation or ${voice.withdrawAtExit}; ` +
    `a quotation that could not be verified as written must not be shown to a user.`
  );
}

/** The voice `reconcile-verify` itself speaks in. */
const RECONCILE_VOICE: QuoteAlarmVoice = {
  stakes:
    "A quotation that is not in the source it names is the failure this pillar has to catch before a user sees it: the report tells a developer that their own published words and their code do not match, and the words are the weapon.",
  documentNoun: "report",
  withdrawInBlock: "withdraw the item to considered_and_rejected",
  withdrawAtExit: "move the item to considered_and_rejected with the reason",
};

/**
 * What a person reads at the end of a run.
 *
 * The unverifiable block is printed FIRST, before any count and before the provenance block, and it
 * carries the whole search description for each item. A count of four statuses at the top of a
 * screen is read as a score; a list of quotations that are not in the developer's document is read
 * as the thing to act on, which is what it is.
 */
export function summarizeQuoteVerification(
  result: VerifyQuotesResult,
  report: DeclarationsReport,
  outPath: string,
): string {
  const s = result.summary;
  const out: string[] = [];
  const unverifiable = result.checks.filter((c) => c.status === "unverifiable");
  const ambiguous = result.checks.filter((c) => c.status === "ambiguous");
  const fallback = result.checks.filter((c) => c.fallback);
  const repaired = result.checks.filter(
    (c) => !c.fallback && (c.status === "repaired" || c.status === "re_attributed"),
  );
  const pinTrouble =
    s.provenance.documents_with_pin_mismatch.length > 0 ||
    s.provenance.documents_in_report_not_in_input.length > 0;

  if (result.target_problem) out.push(`${result.target_problem}\n`);

  out.push(
    ...renderQuoteAlarms(
      result.checks,
      (c) => textOfCheck(report, c),
      RECONCILE_VOICE,
      pinTrouble
        ? ` READ THE PROVENANCE BLOCK BELOW FIRST — the documents this run verified against are not the ones the report says it read, which can explain some or all of these.`
        : "",
    ),
  );

  /* The extraction block. Printed before the provenance block, because it changes how every count
   * below it is read: an extracted quotation cannot fail the check, so a run in which most evidence
   * was extracted has a smaller check than its `total` suggests, and saying so is the whole reason
   * the two populations are counted apart. */
  const extractions = s.extractions ?? [];
  if (extractions.length > 0) {
    const written = extractions.filter((e) => e.lines !== undefined);
    const refused = extractions.filter((e) => e.refusal !== undefined);
    out.push(
      `EXTRACTED, NOT TRANSCRIBED — ${written.length} of this report's evidence quotation(s) named a file and a line range and no text, so this tool wrote the text from the real bytes. ` +
        `Those cannot carry a transcription defect and their verification below is a tautology: it says the bytes came from the file, never that those lines support the finding. ` +
        `Which lines are the evidence is the agent's judgement, and it is checked by the refuter and by the reader exactly as a transcribed quotation's supporting force is.`,
    );
    for (const e of written) out.push(`  ${e.path} — ${e.lines} line(s) from ${e.source === "" ? "(no single source named)" : e.source}:${e.declared}`);
    if (refused.length > 0) {
      out.push(
        `  ${refused.length} entr(y/ies) named a location this tool would not extract from, and carry NO quotation at all as a result — each one is reported here rather than left as an empty quote:`,
      );
      for (const e of refused) out.push(`    ${e.path} — ${e.source === "" ? "(no single source named)" : e.source}:${e.declared} — ${e.refusal}`);
    }
    out.push("");
  }

  /* The cross-reference block, printed with the other alarms rather than among the counts, because a
   * reference a reader cannot follow is a thing to act on and not a score. It sits after the
   * extraction block for the same reason that one sits before the counts: both change how the numbers
   * below are read. */
  const xref = s.id_cross_references;
  if (xref && xref.dangling.length > 0) {
    out.push(
      `DANGLING IDENTIFIER REFERENCE — ${xref.dangling.length} mention(s) in this report's own prose name a claim or finding this report does not carry.` +
        ` Assembly renumbers claims and findings globally and rewrites the structured references; a bare id inside a prose field is not a reference anything could rewrite, and it sends the reader to the wrong object.` +
        ` Nothing has been rewritten here: correct the sentence against the object you meant.`,
    );
    xref.dangling.forEach((d, i) => {
      out.push(`  ${i + 1}. ${d.path} names ${d.id}, which is not a claim_id or a finding_id in this report`);
      out.push(`     context: ${d.context}`);
    });
    out.push(
      `  Searched for: ${xref.prefixes.map((p) => `${p}<digits>`).join(", ")} — the id shapes this report's own claim_id and finding_id values use, and no others. ${xref.checked} id-shaped mention(s) were resolved in all.`,
    );
    out.push("");
  }

  const prov: string[] = [];
  if (!s.provenance.reconcile_id_matches) {
    prov.push(
      `  reconcile_id: the report says ${JSON.stringify(s.provenance.report_reconcile_id)} and the input says ${JSON.stringify(s.provenance.input_reconcile_id)}. These are meant to be the same value; they are not, so the report and the input may describe different runs.`,
    );
  }
  for (const m of s.provenance.documents_with_pin_mismatch) {
    prov.push(
      `  ${m.doc}: the report records reading sha256 ${m.report_sha256}; the input carries sha256 ${m.input_sha256}. Verified against the input's text, because that is the text this tool can read — but a quotation confirmed here was confirmed against different bytes from the ones the agent says it read.`,
    );
  }
  for (const d of s.provenance.documents_in_report_not_in_input) {
    prov.push(
      `  ${d}: the report records reading this document and the reconciliation input does not carry it, so nothing quoted from it could be verified against its own text.`,
    );
  }
  for (const d of s.provenance.documents_in_input_not_read_by_report) {
    prov.push(
      `  ${d}: the input carries this document and the report does not record reading it. Not a fault on its own — it is stated because a document nobody read is a silence, not a clean result.`,
    );
  }
  for (const u of s.provenance.unplaced_document_lines) {
    prov.push(
      `  ${u.doc}: ${u.lines} extracted line(s) carry a line number larger than the document's own byte count and were not placed in the text searched. Reported rather than dropped quietly.`,
    );
  }
  if (prov.length > 0) {
    out.push("PROVENANCE — what the report says it read, against what the input carries:");
    out.push(...prov);
    out.push("");
  }

  out.push(
    `quote verification (verifier ${s.verifier_version}): ${s.total} quotation(s) checked — ` +
      QUOTE_STATUSES.map((k) => `${k} ${s.counts[k]}`).join(", ") +
      `.` +
      (s.fallback_anchored > 0
        ? ` Of those, ${s.fallback_anchored} rest on the first-line fallback alone and are counted again under their status word above; see the FALLBACK ANCHOR block.`
        : ""),
  );
  out.push(
    `  ${s.document_checks} against the extracted documents in the reconciliation input; ` +
      `${s.code_checks} against ${s.code_scope} file(s) under --target, which is every file this report names.`,
  );

  if (repaired.length > 0) {
    out.push(
      `  positions corrected (the report's own numbers are untouched; the correction is in quote_checks[]):`,
    );
    for (const c of repaired) {
      out.push(
        `    ${c.path}: declared ${locationText(c.declared)} → found at ${locationText(c.final)} [${c.status}]`,
      );
    }
  }

  if (s.skipped_no_document_quote.length > 0) {
    const b = s.skipped_no_document_quote.filter((x) => x.direction === "B").length;
    const a = s.skipped_no_document_quote.length - b;
    // Each clause is written only when its count is non-zero. "0 direction-B, which is by design"
    // reads as an explanation of something that did not happen, and a sentence a reader has to
    // discount is worse than a shorter one.
    const clauses: string[] = [];
    if (b > 0) {
      clauses.push(
        `${b} direction-B, which is by design — such a finding starts from a code fact and its point is that no document mentions it, so there is no line to quote`,
      );
    }
    if (a > 0) {
      clauses.push(
        `${a} direction-A, stated as an observation for the reader and penalised nowhere`,
      );
    }
    out.push(
      `  ${s.skipped_no_document_quote.length} finding(s) carry no document quotation: ${clauses.join("; ")}.`,
    );
  }
  if (s.searches_reporting_more_hits_than_listed.length > 0) {
    out.push(
      `  ${s.searches_reporting_more_hits_than_listed.length} search(es) report a higher hit_count than the hits they list; only the listed lines were checked: ${s.searches_reporting_more_hits_than_listed.join(", ")}.`,
    );
  }
  /* Printed on every run, including the clean one, because "the check ran and found none" and "the
   * check did not run" are the two states this whole object exists to keep apart. A report whose ids
   * carry no trailing digits yields no prefix, and the line says so rather than reading as a pass. */
  if (xref) {
    // The ids that yielded no shape are named on their own clause, never folded into the count: an
    // id of bare digits would match every number in every prose field, so it is not searched for, and
    // a console that printed `0 mention(s) of <digits>` read as a check that ran clean over ids
    // nothing had looked at (independent verification, 2026-09-03, L2).
    const skipped =
      (xref.ids_not_cross_referenced ?? 0) > 0
        ? ` ${xref.ids_not_cross_referenced} of this report's ids yielded no shape to search for — an id of bare digits, or one with no trailing digits — and were NOT cross-referenced.`
        : "";
    out.push(
      xref.prefixes.length === 0
        ? `  id cross-references: nothing searched for — none of this report's claim_id and finding_id values yields an id shape to look for in its prose.${skipped}`
        : `  id cross-references: ${xref.checked} mention(s) of ${xref.prefixes.map((p) => `${p}<digits>`).join(", ")} in this report's prose resolved against its own ids, ${xref.dangling.length} naming nothing.${skipped}`,
    );
  }
  for (const line of s.not_verified_here) out.push(`  not verified here: ${line}`);

  out.push(`\nAnnotated copy written to ${outPath}. The report given to --report was not modified.`);
  // The closing line is built from what this run actually contains. It said "every quotation was
  // found, at the position declared or at a corrected one" on every zero-exit run, which was false
  // whenever a row was `ambiguous` — those were found at no position at all — and it is now also
  // the line that has to be honest about the two populations sharing exit 5.
  const dangling = xref?.dangling.length ?? 0;
  if (unverifiable.length > 0 || fallback.length > 0) {
    out.push(
      renderNotVerifiedExitLine(unverifiable.length, fallback.length, RECONCILE_VOICE) +
        (dangling > 0
          ? ` ${dangling} mention(s) in this report's own prose also name a claim or finding it does not carry; correct those sentences too.`
          : ""),
    );
  } else if (dangling > 0) {
    // Every quotation verified and the prose still points somewhere that does not exist. Said as its
    // own sentence rather than folded into the quotation one: they are different mistakes, and a
    // reader told "a quotation could not be verified" would go looking for a quotation.
    out.push(
      `Exit ${EXIT_NOT_FULLY_VERIFIED}: every quotation was found, and ${dangling} mention(s) in this report's own prose name a claim or finding it does not carry. ` +
        `Correct each sentence against the object you meant; a reference a reader cannot follow is a false statement about the report's own contents.`,
    );
  } else {
    out.push(
      `Exit ${EXIT_ALL_VERIFIED}: every quotation was found — at the position declared` +
        (repaired.length > 0 ? `, at a corrected one` : "") +
        (ambiguous.length > 0 ? `, or in more than one source (see AMBIGUOUS above)` : "") +
        `.`,
    );
  }
  return out.join("\n");
}
