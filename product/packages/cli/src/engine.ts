
import { join } from "node:path";
import { createHash } from "node:crypto";
// The MONOTONIC clock, and not `Date.now()`. A budget measured on the wall clock would be moved by
// an NTP step or a daylight-saving jump landing inside one file's read — rare, and when it happens
// it either stops a file that was fine or fails to stop one that is not. `performance.now()` counts
// from an arbitrary origin and never goes backwards, which is the only property this use needs.
import { performance } from "node:perf_hooks";
import type {
  CorroboratedFrom,
  CorroborationSuppressedLine,
  CorroborationSuppression,
  GateMode,
  GateScope,
  JoinedFrom,
  NotReadFile,
  PartiallyReadFile,
  Rule,
  ScanProfile,
} from "wolfboy-schemas";
import { blankLongLines, MINIFIED_LINE_LIMIT, isNonProductionPath } from "./walk.js";
import { COMMENT_FORM_NAMES, commentFormsReadAsCode, commentView, syntaxFor } from "./strip-comments.js";
import { firedKindFacts, unattributedKindFacts, type KindFacts } from "./kind-key.js";
import {
  type PrintedRedaction,
  credentialTargets,
  type CredentialRedaction,
  type CredentialTarget,
} from "./credential-redaction.js";
import { productCredentials, productPrintedRedaction } from "./product-redaction.js";
import { compileGlobs, globsAllow, type CompiledGlobs } from "./globs.js";
import { assertSharedPathExclusionsResolved } from "./path-exclusions.js";
import {
  yamlAnchorView,
  commentsVisibleView,
  PARTIAL_SOURCE,
  yamlViewApplies,
  importAliasTable,
  resolveAliasesInLine,
  localValueTable,
  resolveLocalValuesInLine,
  joinedConstructView,
  type AliasTable,
  type GateViewName,
  type JoinedView,
  type ValueHop,
  type ValueTable,
} from "./derive.js";
import {
  assertSharedVocabularyResolved,
  assertTolerantListsAreReadPositively,
  assertVocabularyMatching,
  expandPatterns,
  type Vocabulary,
  type VocabularyMatching,
} from "./vocabulary.js";
import {
  CHECK_SETS,
  isCheckSet,
  newCounters,
  parseForStructure,
  refuseForPartialSource,
  structuralAllowanceMs,
  runCheckSets,
  type ParseResult,
  type StructuralCheckSet,
  type StructuralCounters,
  type StructuralLanguage,
} from "./structural/index.js";
import {
  bitsetHasAny,
  buildClauseLiteralIndex,
  computeFileAdmissions,
  deriveClauseLiterals,
  formatSelfCheckFailure,
  parseSelfCheckRateEnv,
  DEFAULT_SELF_CHECK_RATE,
  PrefilterSelfCheckFailure,
  SelfCheckSampler,
  type ClauseLiteralIndex,
  type FileAdmissions,
  type PrefilterRuntimeOptions,
} from "./prefilter.js";
import { decodeSource, readRegularFile } from "./project-read.js";

export { PrefilterOptionError, PrefilterSelfCheckFailure } from "./prefilter.js";

/** A candidate's `lineText`: the trimmed line cut at this many characters (read by progress.ts `redactCutText`). */
export const CANDIDATE_LINE_TEXT_CHARS = 300;

export interface RawMatch {
  rule: Rule;
  file: string; // relative to the target root
  line: number; // 1-based
  lineText: string;
  /**
   * Last line of the construct the candidate is about, where the reading that produced it knows it.
   * Only the structural reading sets it: the reported line for a wrapped element is `<button` and
   * the defect is the absence of something four lines down, so an adjudicator reading only the start
   * line would be reading half a sentence. Line-based candidates leave it undefined, unchanged.
   */
  endLine?: number;
  /**
   * The same-file definitions this candidate was reached THROUGH, where it was reached through any.
   *
   * Set only by the local-value reading (`detector.resolve_local_values`), and set only when the
   * substitution is what made the line match. A candidate points at the line the value is USED on;
   * without this the reader is handed a line whose text does not contain the thing the rule says it
   * found, and has to search the file for the definition themselves. Both sites travel together or
   * the reading is not legible.
   */
  hops?: ValueHop[];
  /**
   * The OTHER FILE whose own text opened this candidate's corroboration gate.
   *
   * Set only by the wider corroboration scope (`detector.gate_scope`), and set only where the gate
   * was SHUT on this candidate's own file — so the candidate exists because the fact its rule
   * requires is written somewhere else in the declared scope. It travels with the candidate for the
   * reason `hops` does: the reader of a finding has to be able to open the corroborating file at the
   * line the record names, and a corroboration nobody can check is worse than one never claimed.
   *
   * Written in phase 2, after the walk (see `runBuiltin`), because a corroborator may live in a file
   * that is read long after the candidate was matched.
   */
  corroboratedFrom?: CorroboratedFrom;
  /**
   * Whether this candidate is in the SUBJECT of its rule's corroboration decision — that is,
   * whether every `match` clause that fired on it is one `detector.gate_applies_to` names.
   *
   * Set only for a rule that declares a subject, and decided where the line's own text still
   * exists (the push site below), because `firedClauseIndices` needs the text and phase 2 has
   * only the record. A separate boolean and NOT a second reading of `firedClauses`: that field
   * is written only for joined-view candidates and `collapseNestedDuplicates` reads it, so a
   * value written here for another purpose could change a collapse decision.
   */
  gateSubject?: true;
  /**
   * WHETHER THE DECLARED SCOPE CARRIES THIS RULE'S CORROBORATOR VOCABULARY ANYWHERE — one fact
   * about the whole scan, annotated on this location rather than used to delete it.
   *
   * Written in phase 2 (`mergeShards`), like `corroboratedFrom` and for the same reason: the
   * corroborator may sit in a file read long after this candidate was matched. Present only on a
   * subject location of a rule in `gate_mode: "annotate"`; `false` is written as `false` and is the
   * whole point of the mechanism — a reader is told the tree names none of the vocabulary.
   */
  corroboratedInProject?: boolean;
  /** Where that corroboration is, written only beside `corroboratedInProject: true`. */
  corroboratedInProjectFrom?: CorroboratedFrom;
  /**
   * The span of THIS FILE that was folded onto one string to match this candidate.
   *
   * Set only by the joined-construct reading (`detector.join_bracketed_constructs`), and only where
   * the fold is what made the line match. `start_line` is this candidate's own `line` — the line the
   * construct OPENS on — and `end_line` is where it closes. It travels with the candidate for the
   * reason `hops` does: the reported line's own text does not carry what the rule matched, because
   * the attribute a cookie literal lacks is absent several lines below the line the finding names.
   */
  joinedFrom?: JoinedFrom;
  /**
   * WHICH of this rule's `match` clauses fired on the text that raised this candidate, 1-based and
   * ascending — the numbering a rule author uses when they write "clause (13)".
   *
   * ENGINE-INTERNAL AND NEVER SERIALISED. `scan.ts` builds a location field by field and does not
   * read this; it exists so that `collapseNestedDuplicates` below can ask whether an enclosing
   * candidate reads anything its own contents do not.
   *
   * SET ONLY FOR A RULE THAT DECLARED `detector.join_bracketed_constructs`, which is the whole of
   * this field's cost: every other rule pays one property read per line it already matched. It is
   * computed on the pair of texts the candidate ACTUALLY fired on — the raw line, the alias- or
   * value-resolved line, or the fold — because a clause set taken from a different text would not
   * be a statement about this candidate.
   *
   * `undefined` and `[]` are different: undefined is "nobody asked", and an empty array is "the
   * per-clause reading found none", which `matchFires` can produce (it is two `some`s and does not
   * require ONE clause true of both texts). Nothing below treats undefined as empty.
   */
  firedClauses?: number[];
  /**
   * The opening lines of the enclosing fold-derived candidates that were collapsed INTO this one.
   *
   * Written after the walk by `collapseNestedDuplicates` and published as
   * `locations[].also_opens_at`. Absent on every candidate that absorbed nothing, which is all of
   * them for every rule that does not declare the joined view.
   */
  absorbedOpenings?: number[];
  /**
   * WHICH CLAUSE READ THIS LINE, WHAT IT MATCHED AND WHERE THAT SITS — the key layer 2 groups by.
   *
   * Set only when the kind census is on (`--kind-census on`, the default; `CompiledScan.kindCensus`
   * carries the decision into every thread), and `undefined` on every run with it off, which is why
   * a document written with it off is byte-for-byte the document this scanner wrote before the
   * census existed.
   *
   * SERIALISED, unlike `firedClauses` beside it: `scan.ts` copies `clause`, `matched_token` and
   * `context_class` onto the location, so a reader of `findings.json` can re-derive every kind of
   * every candidate with no model and no second scan. The sub-shape travels to the census rows
   * instead of to the location — one digest per location would cost bytes for a fact only the
   * catalogue reads.
   *
   * COMPUTED HERE AND NOT DOWNSTREAM: `lineText` above is trimmed and cut to 300 characters, and a
   * span cannot be classified by what surrounds it once the surroundings are gone.
   */
  kindFacts?: KindFacts;
  /**
   * The substrings of `kindFacts.matched_token` that hold credential material, each with the
   * `baseline-002` clause that located it (`credentialTargets`). Present only where there is at least
   * one, and never serialised: `scan.ts` unions them per label and rewrites the label
   * (`redactedLabelsOf`). Computed here for the reason the facts are: the text the label was taken
   * from exists only on this side.
   */
  kindRedactions?: CredentialTarget[];
}

/**
 * A candidate a guard removed, kept so the removal is visible.
 *
 * A guard hit deletes a candidate outright: it never reaches findings.json and the adjudicating
 * agent never learns it existed. That is layer 1 taking layer 2's decision, irreversibly, and it
 * is the one thing layer 1 must not do (deterministic detectors carry recall, the
 * agent carries precision). Guards are still right — the consent pack's precision rests on them —
 * but a guard that is wrong is invisible, so adversarial review of eu-dsa-001 found the rule
 * silenced on 81% of real repositories by country-flag image paths, emoji category names and
 * documentation sidebar labels, with no trace anywhere in the output.
 *
 * The fix is not to stop suppressing; it is to stop suppressing silently.
 */
export interface SuppressedMatch {
  ruleId: string;
  file: string;
  line: number;
  /**
   * The guard pattern that removed it, and where that pattern matched. Lines are named, never
   * quoted: `lineText` and `guardLineText` were removed on 2026-09-23, when findings.json stopped
   * carrying raw source text; a reader opens `file`:`line` and `guardFile`:`guardLine`.
   */
  guardPattern: string;
  guardFile: string;
  guardLine: number;
}

export interface EngineResult {
  matches: RawMatch[];
  suppressed: SuppressedMatch[];
  /**
   * Every gate decision that removed matches, one entry per (rule, file). See
   * `CorroborationSuppression` in wolfboy-schemas — the record is built here in the shape the
   * findings document publishes, rather than in an engine-private shape a serialiser then renames,
   * so the field names exist in one place.
   */
  corroborationSuppressed: CorroborationSuppression[];
  filesScanned: number;
  filesSkipped: number;
  /**
   * Every file the engine opened and then declined to read to any rule, named, with the reason and
   * with the measurement the decision was taken on. `filesSkipped` above is the same population as
   * a number.
   *
   * WHY IT IS NAMED AND NOT ONLY COUNTED. This is the rule that an absence is reported, at file granularity. Until 2026-08-25 a
   * file whose longest line exceeded the minification ceiling was dropped here with `filesSkipped++`
   * and nothing else: it appeared in no array, in no console line and in no report, so to every
   * reader of every output *"we did not read this file"* and *"there was nothing in this file"* were
   * the same output. The walker has said what it refused to open since 2026-07-27
   * (`excluded_by_walker`); the engine's own refusal — one layer further in, and the one that reads
   * the bytes before deciding — said nothing at all.
   *
   * The population is small by construction: the walker has already removed generated trees, the
   * binaries and everything over `MAX_FILE_BYTES`, so what reaches this test is text under 1 MB.
   * Measured on this repository's own tree there are eight such files, all of them authored YAML.
   */
  filesNotRead: NotReadFile[];
  /**
   * Every file the engine read with at least one line taken out of it by the minification ceiling,
   * named, with each blanked line and the length it held.
   *
   * A DIFFERENT POPULATION FROM `filesNotRead` AND NEVER ADDED TO IT. That array is files no rule
   * read at all; this is files every rule read, minus some lines. Both exist for the same reason at
   * two strengths: `files_not_read` was added on 2026-08-25 because *"we did not read this file"*
   * and *"there was nothing in this file"* were the same output; this is added on 2026-09-07
   * because the same sentence is true of a line. `filesScanned` counts these, because they WERE
   * scanned.
   *
   * The population is what the ceiling's unit change created: before 2026-09-07 every file here was
   * in `filesNotRead` instead, whole. Measured over fifteen corpus trees at that date, 755 files
   * would move from there to here and 396 would stay, and 75,484 non-blank lines become readable.
   */
  filesPartiallyRead: PartiallyReadFile[];
  /**
   * Files read WHOLE whose COMMENTS were read as code, because `strip-comments.ts` has no comment
   * syntax registered for their extension (`syntaxFor` answers `null`, as against `"none"` for a
   * format that genuinely has no comment form).
   *
   * A THIRD POPULATION, and the only one in this interface that counts files which were read too
   * generously rather than not enough. Never added to either array above: these files are inside
   * `filesScanned` and every line of them reached every rule. It is reported because a hole nobody
   * counts is a hole nobody closes — the same argument as the two arrays above, pointing the other
   * way — and because the repair is one row in `BY_EXT`, which nobody writes for a format nobody
   * knows is unclassified.
   */
  filesCommentSyntaxUnregistered: number;
  /** Files read from UTF-16 (`FileRecord.readAs`), and files read with bytes that are not UTF-8; each a count of files. */
  filesReadFromUtf16: number;
  filesReadNotUtf8: number;
  /**
   * Files read whole whose extension IS registered but whose language has a comment form the
   * registered mode reads as code (`strip-comments.ts` `COMMENT_FORMS_READ_AS_CODE`), and per form
   * the files carrying it. The class that hid Ruby's `=begin` from the counter above; never added to
   * it or to any other population.
   */
  filesCommentFormReadAsCode: number;
  commentFormsReadAsCode: Record<string, number>;
  /**
   * Files for which a rule asked for a derived view (see derive.ts) and one was produced. A SUM
   * OVER SEVERAL READINGS THAT NAMES NONE OF THEM: both `gate_view` members — the YAML expansion
   * and the comment-visible text — plus the alias and local-value probes. Counted because every one
   * of them is demand-driven: a gate view is built only when a rule that declared it would otherwise
   * have its gate shut, so this is a count of the work the corpus actually caused, not of the files
   * that could have caused it. Which reading a particular suppression consulted is
   * `suppressed_by_corroboration[].cause` together with the rule's own declaration.
   */
  derivedViewsBuilt: number;
  /**
   * Files for which a derived view was asked for and could NOT be produced — malformed YAML, a
   * recursive anchor, or a document over the size ceiling. Every one of these falls back to the
   * unexpanded text, so a fallback can never lose a candidate that was found without the view; it
   * is counted rather than logged because a degrade nobody can see is a degrade nobody audits,
   * which is the same principle as suppressed_by_guard and excluded_by_walker.
   */
  derivedViewsFailed: number;
  /**
   * (rule, file) corroboration gates that were SHUT on the file's own text and were opened by a
   * wider `detector.gate_scope`. Counted for the reason `derivedViewsBuilt` is: an opt-in widening
   * that nobody can size is a widening nobody audits.
   *
   * It counts GATE DECISIONS and not candidates — one opened gate releases every line that gate held
   * in that file — and it is 0 for every bundle in which no rule declares a wider scope, because
   * nothing in that bundle can reach the branch that increments it. `scan.ts` writes it into the
   * findings document only when the bundle carries a declaring rule, so that a scan under today's
   * bundle produces the document it produced before this field existed.
   */
  gatesOpenedByScope: number;
  /**
   * Files for which a rule that declared `detector.join_bracketed_constructs` had a joined view
   * built, and the view folded at least one construct onto its opening line.
   *
   * Counted apart from `derivedViewsBuilt` rather than added to it, although both are "a view was
   * built". That counter carries the YAML expansions and the two substitution probes together
   * already, and its number is read as the work the corpus caused those readings; a fold is a
   * different reading with a different cost and its own two ways of going quiet, so a reader has to
   * be able to size it on its own. `scan.ts` writes all three only when the bundle carries a
   * declaring rule.
   */
  joinedViewsBuilt: number;
  /**
   * Files a declaring rule asked a joined view for in which NOTHING could be folded — no line opens
   * a bracketed construct that closes inside the ceilings. Counted for the reason
   * `derivedViewsFailed` is: "the view ran and this file had nothing in it" and "the view never ran
   * here" are different answers, and without this counter they are the same absent number.
   */
  joinedViewsNotApplicable: number;
  /**
   * CONSTRUCTS a ceiling turned down — one that never closes in its file, one longer than the line
   * ceiling, or one folding past the character ceiling (derive.ts `JOINED_VIEW_LIMITS`).
   *
   * A different population from the two above, which count FILES, and the three must never be added.
   * Every refusal leaves its opening line to be tested exactly as it is without the view, so a
   * refusal can never remove a candidate — it is counted because a degrade nobody can see is a
   * degrade nobody audits.
   */
  joinedConstructsRefused: number;
  /**
   * CANDIDATES the nested-duplicate collapse removed — an enclosing fold-derived candidate every one
   * of whose clauses was also fired by candidates inside its own span (`collapseNestedDuplicates`).
   *
   * A CANDIDATE COUNT, a fourth population beside the two file counts and the construct count above,
   * and the four must never be added together. It is the only counter in this engine that says how
   * many reports were REMOVED for being the same construct already reported, and it exists for
   * exactly that reason: this is the joined view's one subtraction, and a subtraction nobody can
   * size is a subtraction nobody audits. Every candidate counted here left its opening line on the
   * report that absorbed it (`RawMatch.absorbedOpenings`, published as `locations[].also_opens_at`),
   * so the removals are enumerable from the document and not only countable.
   *
   * 0 for every bundle in which no rule declares the view, because nothing in such a bundle folds
   * anything; `scan.ts` writes it under the same condition as the three above.
   */
  joinedOuterDuplicatesDropped: number;
  /**
   * What the structural (parse-tree) reading did on this tree — see structural/parse.ts.
   *
   * Every field is here for the reason `derivedViewsFailed` is: the reading is a second eye that may
   * only add candidates, so every way it can go quiet has to be countable. "The second eye agreed
   * with the first everywhere" and "the second eye never ran" are different answers, and without
   * `candidatesDuplicate` and `treesBuilt` a reader cannot tell them apart.
   */
  structural: StructuralCounters;
  /**
   * Per rule id, how many of the files this scan opened that rule was allowed to read — the files
   * that passed its own `detector.file_globs` (or the non-production default) and were not carved
   * out by `detector.path_without`. Keyed on every rule that survived `preconditionsMet`, including
   * the ones that end at zero, because zero is the reading that matters.
   *
   * WHY IT IS COUNTED AT ALL. A rule that produced no candidate did one of two very different
   * things, and until 2026-08-19 no output could tell them apart: it read four thousand files of
   * this tree and matched none of them, or it was never offered a single file it was willing to
   * look at. The first is a statement about the code; the second is a statement about the rule's
   * declared surface meeting this tree's layout, and it is not evidence about the code at all.
   * The design turns the absence of a candidate into a reported `unknown`, and an `unknown` a reader
   * cannot size is the same silence under a new name.
   *
   * It counts FILES OFFERED, never files that matched: no `match` clause is consulted, so this
   * number moves with the walk and the surface declarations and with nothing a detector decides.
   * It is a count and never a filter — nothing in the engine or in scan.ts reads it back, so it
   * cannot change which candidate is raised.
   */
  filesOnSurface: Map<string, number>;
}

/**
 * Scope in which a guard match suppresses candidates.
 * Real scans use "project": a consent gate declared anywhere in the codebase covers the whole
 * project. Fixture tests use "per-file" so that a guard in one fixture cannot mask the candidate
 * another fixture is asserting.
 */
export type GuardScope = "project" | "per-file";

interface CompiledRule {
  rule: Rule;
  match: RegExp[];
  matchWithout: RegExp[];
  guardMissing: RegExp[];
  alsoInFile: RegExp[];
  pathWithout: RegExp[];
  fileGlobs: CompiledGlobs | null;
  /** Derived views this rule's `also_in_file` clauses are ALSO tested against. See derive.ts. */
  gateViews: GateViewName[];
  /**
   * How far this rule's `also_in_file` corroboration may look. `"file"` for every rule that declares
   * nothing, and that value takes exactly the code path the field's absence takes.
   */
  gateScope: GateScope;
  /**
   * WHICH of this rule's own `match` clauses the corroboration decision is ABOUT
   * (`detector.gate_applies_to`), and `null` for every rule that declares nothing — a value that
   * takes exactly the code path the field's absence took before the field existed.
   *
   * NUMBERING, AND IT IS THE ONE OFF-BY-ONE THIS MECHANISM COULD SHIP IN SILENCE: the rule declares
   * `match[i]` 0-BASED, the same grammar `cost_exempt` uses; this set holds `i + 1`, because the
   * only thing that ever reads it compares it against `firedClauseIndices`, which returns 1-BASED
   * indices. The conversion is done ONCE, at compile below, and nowhere else.
   */
  gateAppliesTo: Set<number> | null;
  /**
   * WHAT IS DONE with that decision. `"annotate"` marks every subject location with the answer and
   * removes nothing; `"gate"` holds the subject candidates the way a wider `gate_scope` already
   * holds a whole file's. Read only where `gateAppliesTo !== null`, and `"annotate"` is the
   * schema's default, so a rule that names a subject and no mode annotates.
   */
  gateMode: GateMode;
  /** Whether this rule's `match` clauses are ALSO tested against the alias-resolved line. */
  resolveImportAliases: boolean;
  /** Whether this rule's `match` clauses are ALSO tested against the local-value-resolved line. */
  resolveLocalValues: boolean;
  /**
   * Whether this rule's `match` clauses are ALSO tested against the whole bracketed construct that
   * opens on each line, folded onto one string. See derive.ts `joinedConstructView`.
   */
  joinBracketedConstructs: boolean;
  /** Whether this rule's `match` may fire on a line whose evidence is only inside a comment. */
  matchInComments: boolean;
  /** Named structural check sets this rule is ALSO read by. See structural/checks/registry.ts. */
  structuralChecks: StructuralCheckSet[];
  /** The rule's declared word lists, which both readings splice. See vocabulary.ts. */
  vocabulary: Vocabulary | undefined;
  /**
   * Prefilter clause ids (prefilter.ts), aligned index-for-index with `match` / `alsoInFile` above —
   * `matchClauseIds[k]` is the global id `deriveClauseLiterals` assigned `match[k]`'s required
   * literal set. Engine-internal, never serialised, exactly like `firedClauses` on `RawMatch` below.
   * Empty when the prefilter is disabled for this scan (`runBuiltin`'s `prefilterOptions.enabled ===
   * false`): nothing reads them in that case, so an empty array costs nothing and needs no sentinel.
   */
  matchClauseIds: number[];
  alsoInFileClauseIds: number[];
}

/**
 * Compile every rule's detector into ready-to-run patterns, once per run.
 *
 * Exported (renamed from the former private `compile`) so a worker can call it exactly once at
 * startup and then call `scanFile` per file — step3-workers/proposal.md F.3 #1: a worker that
 * recompiled per batch of files measured ~74-160ms paid again every batch, instead of once.
 */
export function compileRules(rules: Rule[]): CompiledRule[] {
  return rules
    .filter((r) => r.detector.engine === "builtin-regex")
    .map((r) => {
      // `detector.vocabulary` is spliced into the patterns before they are compiled, so a rule's
      // word lists exist in exactly one place and both readings look for the same words. A rule
      // that declares no vocabulary and splices nothing gets its patterns back unchanged; a
      // pattern that splices a list nobody declared throws here rather than compiling to something
      // that matches nothing.
      const where = `rule ${r.id}`;
      // A rule may also import word lists shared with other rules (`detector.shared_vocabulary`,
      // resolved out of rules/vocabulary/*.yaml). Those are merged into `detector.vocabulary` at
      // BUILD time, so a bundle carries none and the engine has nothing to resolve — it has no
      // access to the authoring tree in a user's checkout anyway. This is the assertion that the
      // merge really happened: see assertSharedVocabularyResolved in vocabulary.ts for why an
      // unresolved import is a silence rather than a crash if it is let through.
      assertSharedVocabularyResolved(r.detector as unknown as Record<string, unknown>, where);
      // ...and the same assertion for the path exclusions a rule imports by name
      // (`detector.shared_path_exclusions`, resolved out of rules/path-exclusions/*.yaml and merged
      // into `detector.path_without` at BUILD time). An unresolved import here is not a silence but
      // its opposite: the engine reads `path_without` and nothing else, so the rule would read every
      // test tree, fixture directory and vendored dependency its author declared it must not read.
      // See path-exclusions.ts.
      assertSharedPathExclusionsResolved(r.detector as unknown as Record<string, unknown>, where);
      const vocabulary = r.detector.vocabulary as Vocabulary | undefined;
      // Per-list matching (`detector.vocabulary_matching`): which of this rule's word lists are
      // spelled into the pattern case-blind, separator-blind, or both. Opt-in and inert by absence
      // — a rule that declares none compiles the byte-identical patterns it compiled before the
      // capability existed. The two assertions are the two ways a declaration can be written and
      // mean nothing: naming a list the rule does not have or a flag that does not exist, and
      // widening a field that is read as a negation. See vocabulary.ts for both.
      const vocabularyMatching = r.detector.vocabulary_matching as VocabularyMatching | undefined;
      assertVocabularyMatching(vocabulary, vocabularyMatching, where);
      assertTolerantListsAreReadPositively(
        r.detector as unknown as Record<string, unknown>,
        vocabularyMatching,
        where,
      );
      const structuralChecks = (r.detector.structural_checks ?? []) as StructuralCheckSet[];
      for (const name of structuralChecks) {
        // A check set the engine does not have is a hard error, not a silent no-op: a rule that
        // believes it is read a second way and is not is worse than a rule that fails to load.
        if (!isCheckSet(name)) {
          throw new Error(
            `${where}: detector.structural_checks names "${name}", which no structural check set implements`,
          );
        }
        // ...and a check set with no words to look for is the same failure one step later. There is
        // deliberately no default list: a default is the second copy re-entering by the back door.
        for (const required of CHECK_SETS[name].requires) {
          if (!vocabulary?.[required]?.length) {
            throw new Error(
              `${where}: structural check set "${name}" reads detector.vocabulary.${required}, which the rule does not declare`,
            );
          }
        }
      }
      return {
        rule: r,
        match: expandPatterns(r.detector.match, vocabulary, where, vocabularyMatching).map((p) => new RegExp(p)),
        matchWithout: expandPatterns(r.detector.match_without, vocabulary, where, vocabularyMatching).map((p) => new RegExp(p)),
        guardMissing: expandPatterns(r.detector.guard_missing, vocabulary, where, vocabularyMatching).map((p) => new RegExp(p)),
        alsoInFile: expandPatterns(r.detector.also_in_file, vocabulary, where, vocabularyMatching).map((p) => new RegExp(p)),
        pathWithout: expandPatterns(r.detector.path_without, vocabulary, where, vocabularyMatching).map((p) => new RegExp(p)),
        // Declared in rule.schema.json since W3 and unimplemented until 2026-07-27, which meant every
        // rule's scanning surface was decided by one hidden setting in the walker rather than by the
        // rule. See globs.ts for why that choice moved into the rule.
        fileGlobs: compileGlobs(r.detector.file_globs),
        // Opt-in, per rule, and inert by absence: a rule that declares none of these fields is
        // compiled to empty lists and a false flag, and the code paths below are then unreachable
        // for it — no file is parsed for it and no grammar is ever loaded on its account.
        gateViews: (r.detector.gate_view ?? []) as GateViewName[],
        // ...and the same for the scope that gate is evaluated in. `?? "file"` is what makes the
        // field inert by absence: `"file"` is tested for by name below, so a rule that declares
        // nothing and a rule that declares `"file"` take the identical branch.
        gateScope: (r.detector.gate_scope ?? "file") as GateScope,
        // THE 0-BASED-TO-1-BASED CONVERSION, HERE AND NOWHERE ELSE. `gate_applies_to` is declared
        // `match[i]` with `i` 0-based; `firedClauseIndices` returns `k + 1`. Storing `i + 1` is
        // what lets every reader below compare the two directly. `null` by absence is what makes
        // those readers unreachable for a rule that declares nothing.
        // The build refuses, before a bundle exists, a subject without `also_in_file`, a reference
        // that is not `match[i]`, an index past this rule's own `match` list, and a `gate_mode`
        // without a subject (tools/build-bundle.mjs), so nothing here defends against them again.
        gateAppliesTo:
          r.detector.gate_applies_to === undefined
            ? null
            : new Set(r.detector.gate_applies_to.map((ref) => Number(ref.slice("match[".length, -1)) + 1)),
        // `?? "annotate"` mirrors the schema's own default, so a rule that names a subject and no
        // mode annotates, and a rule that names neither never reaches a site that reads this.
        gateMode: (r.detector.gate_mode ?? "annotate") as GateMode,
        resolveImportAliases: r.detector.resolve_import_aliases === true,
        resolveLocalValues: r.detector.resolve_local_values === true,
        joinBracketedConstructs: r.detector.join_bracketed_constructs === true,
        matchInComments: r.detector.match_in_comments === true,
        structuralChecks,
        // Filled in by `compilePrefilter` below, which is called on the line after
        // `compileRules` everywhere and needs to see every rule at once to build ONE shared
        // automaton (prefilter.ts). `compileRules` itself stays free of that concern — it is
        // called once and reads only the one rule it is mapping. Left empty when the prefilter
        // is disabled for this scan: nothing reads them in that case, so an empty array costs
        // nothing and needs no sentinel.
        matchClauseIds: [],
        alsoInFileClauseIds: [],
        vocabulary,
      };
    });
}

/**
 * Build the required-literal prefilter index for a compiled bundle (prefilter.ts; design:
 * proposal.md §B, §G.1). Reads each rule's UNEXPANDED `match` / `also_in_file` patterns straight off
 * `c.rule.detector` — the same source `compile()` above hands `expandPatterns` to build `c.match` /
 * `c.alsoInFile` — so the derivation and the real compiled `RegExp` are always looking at the same
 * clause text. `match_without` is deliberately excluded: proposal §A.2 explains why it is never
 * gated (it runs only inside `disqualifiedByMatchWithout`, reached only once a candidate already
 * exists, so indexing it would filter nothing that costs anything).
 *
 * Returns the shared automaton/postings table plus, per compiled rule (by array index, aligned with
 * `compiled`), the global clause ids `deriveClauseLiterals` assigned that rule's `match` and
 * `alsoInFile` clauses in turn — attached onto each `CompiledRule` by the caller, `runBuiltin`.
 */
function buildRulePrefilterIndex(
  compiled: readonly CompiledRule[],
  overrideForTest?: PrefilterLiteralOverrideForTest,
): {
  index: ClauseLiteralIndex;
  matchClauseIds: number[][];
  alsoInFileClauseIds: number[][];
} {
  const literalSets: (string[] | null)[] = [];
  const matchClauseIds: number[][] = [];
  const alsoInFileClauseIds: number[][] = [];
  const derive = (
    ruleId: string,
    field: "match" | "also_in_file",
    k: number,
    src: string,
    vocabulary: Vocabulary | undefined,
    matching: VocabularyMatching | undefined,
  ): string[] | null => {
    const derived = deriveClauseLiterals(src, vocabulary, matching).literals;
    if (overrideForTest === undefined) return derived;
    const replacement = overrideForTest(ruleId, field, k, derived);
    return replacement === undefined ? derived : replacement;
  };
  for (const c of compiled) {
    const vocabulary = c.rule.detector.vocabulary as Vocabulary | undefined;
    const matching = c.rule.detector.vocabulary_matching as VocabularyMatching | undefined;
    const matchSrc = c.rule.detector.match ?? [];
    const matchIds: number[] = [];
    for (let k = 0; k < matchSrc.length; k++) {
      matchIds.push(literalSets.length);
      literalSets.push(derive(c.rule.id, "match", k, matchSrc[k], vocabulary, matching));
    }
    matchClauseIds.push(matchIds);
    const alsoSrc = c.rule.detector.also_in_file ?? [];
    const alsoIds: number[] = [];
    for (let k = 0; k < alsoSrc.length; k++) {
      alsoIds.push(literalSets.length);
      literalSets.push(derive(c.rule.id, "also_in_file", k, alsoSrc[k], vocabulary, matching));
    }
    alsoInFileClauseIds.push(alsoIds);
  }
  return { index: buildClauseLiteralIndex(literalSets), matchClauseIds, alsoInFileClauseIds };
}

/**
 * TEST-ONLY SEAM: replace one clause's derived literal set with a deliberately WRONG one, so that a
 * test can prove the runtime self-check (prefilter.ts, proposal §E.3) actually fires. Return
 * `undefined` to leave a clause's own derivation alone, an array to replace it, `null` to force `⊤`.
 *
 * UNREACHABLE IN PRODUCTION, and that is a property of its shape rather than of a guard it could be
 * talked past: it is a FUNCTION handed programmatically to `runBuiltin`, so no command-line flag, no
 * environment variable and no bundle field can set it. The shipped path — `index.ts` -> `scan.ts` ->
 * `runBuiltin` — passes no sixth argument at all. Its only caller is a test,
 * whose self-check suite is the permanent form of proposal §G.2 step 6, *"a self-check nobody has
 * seen fail is a self-check nobody knows works"*.
 */
export type PrefilterLiteralOverrideForTest = (
  ruleId: string,
  field: "match" | "also_in_file",
  clauseIndex: number,
  derived: string[] | null,
) => string[] | null | undefined;

/** What `runBuiltin`'s optional sixth argument accepts: the resolved switches, plus the test seam. */
export interface PrefilterCallOptions extends Partial<PrefilterRuntimeOptions> {
  overrideLiteralsForTest?: PrefilterLiteralOverrideForTest;
}

/**
 * TEST-ONLY SEAM: build the joined-construct view some other way, so that a test can prove
 * `assertSingleLineSubject` actually fires.
 *
 * ## Why the joined view and not some other door
 *
 * The four readings hand a `match` clause four subjects, and three of them are `lines[i]` or a
 * one-line substitution inside it — there is no way to make those carry a newline short of
 * rewriting `String.prototype.split`. The fourth is the only one that BUILDS a subject out of
 * several physical lines: `derive.ts`' `foldSpan` joins a bracketed span and then collapses every
 * whitespace run — `\s` includes `\n` — to one space. Take that collapse away and reading 4 hands
 * `matchFires` a multi-line subject. So this seam is not an artificial injection point: it is the
 * exact shape of the defect the assertion exists for, and the exact place a future reading is most
 * likely to reintroduce it.
 *
 * ## Why it is unreachable in production
 *
 * It is a FUNCTION, reached only by passing an object to `runBuiltin`'s seventh parameter. No
 * command-line flag, no environment variable and no bundle field can set it; the shipped path
 * (`index.ts` -> `scan.ts` -> `runBuiltin`) passes six arguments and never a seventh, and a function
 * cannot cross the worker boundary a sharded scan would send its options over. Its only caller is
 * a test. This is the same shape, and the same argument, as
 * `PrefilterLiteralOverrideForTest` above.
 */
export interface EngineTestSeams {
  joinedViewForTest?: (lines: string[], codeLines: string[]) => JoinedView;
}

/**
 * `--no-prefilter` / `PRODUCT_CLI_PREFILTER=0` and `PRODUCT_CLI_PREFILTER_SELFCHECK`, resolved into
 * one options object (proposal §E.4). `runBuiltin`'s caller may pass an explicit override — the
 * `scan` command in index.ts sets `process.env.PRODUCT_CLI_PREFILTER = "0"` before calling
 * `runScan` when `--no-prefilter` is given, rather than threading a second copy of the switch
 * through `ScanOptions`, so every OTHER caller (test-rules.ts, the mutation harness) reaches this
 * same resolution and gets the environment's answer: enabled, rate 100, unless told otherwise. Both
 * `PrefilterRuntimeOptions` fields are therefore always concrete here — a caller wanting the default
 * in full passes nothing, rather than an object with holes this function has to fill silently.
 *
 * EXPORTED so the `scan` command's console line can report the state the engine will actually be in
 * rather than the state the command was told about (`PRODUCT_CLI_PREFILTER=0` disabled the filter and the line still read `prefilter: on`).
 * One resolver, read twice, never a second copy of
 * the precedence rule. It also throws on a malformed `PRODUCT_CLI_PREFILTER_SELFCHECK`, which is why
 * `index.ts` calls it BEFORE it reads anything.
 */
export function resolvePrefilterRuntimeOptions(explicit?: Partial<PrefilterRuntimeOptions>): PrefilterRuntimeOptions {
  const enabled = explicit?.enabled ?? process.env.PRODUCT_CLI_PREFILTER !== "0";
  const selfCheckRate =
    explicit?.selfCheckRate ?? parseSelfCheckRateEnv(process.env.PRODUCT_CLI_PREFILTER_SELFCHECK) ?? DEFAULT_SELF_CHECK_RATE;
  return { enabled, selfCheckRate };
}

/**
 * The admitted subset of `c.match` for 0-based line `lineIdx`, plus the self-check accounting for
 * every clause this returns WITHOUT (proposal §E.3): a clause admitted neither by refusal (`⊤`, a
 * `null` entry in `index.clauseLiteralIds`) nor by the line's admitted-clause set is a clause
 * `matchFires` will never be handed, and the self-check exists to prove that omission was sound by
 * occasionally testing it anyway. Returns a `RegExp[]`, the same shape `c.match` is, so the call
 * site is the identical `some(...)` either way (§H5) — see `matchFires` below.
 */
function admittedMatchClauses(
  c: CompiledRule,
  index: ClauseLiteralIndex,
  fileAdm: FileAdmissions,
  clauseIds: number[],
  selfCheck: SelfCheckSampler,
  lineIdx: number,
  // `SingleLineSubject`, not `string`, for the same reason `matchFires` takes them: the sampled
  // branch below tests `c.match[k]` itself, so this function is a `match` reader and the compiler
  // holds its callers to the property.
  text: SingleLineSubject,
  code: SingleLineSubject,
  file: string,
): RegExp[] {
  const admittedSet = fileAdm.admittedClausesByLine.get(lineIdx);
  // ALLOCATION IS DEFERRED, and in the two common cases never happens: the answer is
  // `c.match` itself when nothing was skipped, and one shared frozen empty array when nothing was
  // admitted — which is the overwhelmingly common case, since this runs for every (rule, line) pair
  // in the scan. A fresh array is built only for a genuinely mixed line, and `matchFires` only ever
  // reads the list it is handed (two `some`s), so sharing one of the existing arrays is safe.
  let out: RegExp[] | null = null;
  let admitted = 0;
  let skipped = 0;
  for (let k = 0; k < c.match.length; k++) {
    const gid = clauseIds[k];
    const litIds = index.clauseLiteralIds[gid];
    if (litIds === null || (admittedSet !== undefined && admittedSet.has(gid))) {
      admitted++;
      if (skipped > 0) {
        if (out === null) out = [];
        out.push(c.match[k]);
      }
      continue;
    }
    // The first skip after one or more admits: from here the answer is a proper subset of `c.match`,
    // so the admitted prefix has to be materialised now, in order.
    if (skipped === 0 && admitted > 0) out = c.match.slice(0, k);
    skipped++;
    // SKIPPED. Counted in the file's own traversal order (rules in bundle order, lines in order,
    // clauses in order — all `admittedMatchClauses` is ever called in) by `selfCheck.shouldTest()`
    // regardless of whether this particular pair is actually re-tested; only the re-test itself is
    // sampled. The counter is restarted at the top of each file, from that file's walk index, so
    // the sampled set is the same set at every `--jobs` — see `SelfCheckSampler.startFile`.
    if (selfCheck.shouldTest()) {
      // THE SINGLE-LINE PROPERTY, HELD BY THIS SITE ON ITS OWN. Inside the sampled branch rather
      // than at the top of this function, which runs for every (rule, line) pair in the scan: the
      // re-test on the next line is the only place `admittedMatchClauses` tests a `match` clause,
      // and `matchFires` — called on this same pair a few statements later, unconditionally —
      // already holds the pair to it on the hot path. Splitting the `&&` into a block changes no
      // behaviour: `shouldTest()` is still called exactly once per skipped clause, still first, and
      // the re-test still happens only when it answers true.
      assertSingleLineSubject("prefilter-self-check", c.rule.id, text, code);
      if (c.match[k].test(text) || (code !== text && c.match[k].test(code))) {
        throw new PrefilterSelfCheckFailure(
          formatSelfCheckFailure({
            ruleId: c.rule.id,
            clauseNumber: k + 1,
            field: "match",
            file,
            line: lineIdx + 1,
            lineText: text,
            literals: [...litIds].map((id) => index.literals[id]),
          }),
        );
      }
    }
  }
  if (skipped === 0) return c.match;
  if (admitted === 0) return NO_ADMITTED_CLAUSES;
  return out as RegExp[];
}

/**
 * The one list handed to `matchFires` for every (rule, line) pair that admits nothing — frozen and
 * shared because that is most pairs in a scan and `matchFires` only reads it.
 */
const NO_ADMITTED_CLAUSES: RegExp[] = Object.freeze([] as RegExp[]) as RegExp[];

/**
 * The admitted subset of `c.alsoInFile`, gated at FILE level — the field is tested only against the
 * whole of `guardContent` (proposal §A.2), never per line. A self-check hit here locates a line by
 * re-running the clause's own `exec()` against `guardContent`, the same technique the wider-scope
 * corroboration block below already uses to report where an `also_in_file` match sits, and resets
 * `lastIndex` before and after for the same reason given there.
 */
function admittedAlsoInFileClauses(
  c: CompiledRule,
  index: ClauseLiteralIndex,
  fileAdm: FileAdmissions,
  clauseIds: number[],
  selfCheck: SelfCheckSampler,
  guardContent: string,
  file: string,
  lines: string[],
  /** Reads the file's clock; true when the budget is spent. The self-check below is a whole-file test. */
  spent: () => boolean = () => false,
): RegExp[] | null {
  const out: RegExp[] = [];
  for (let k = 0; k < c.alsoInFile.length; k++) {
    const gid = clauseIds[k];
    const litIds = index.clauseLiteralIds[gid];
    if (litIds === null || bitsetHasAny(fileAdm.fileLiterals, litIds)) {
      out.push(c.alsoInFile[k]);
      continue;
    }
    if (selfCheck.shouldTest()) {
      // A spent budget stops the file before this whole-file test (null), never skips the test alone.
      if (spent()) return null;
      const re = c.alsoInFile[k];
      re.lastIndex = 0;
      const m = re.exec(guardContent);
      re.lastIndex = 0;
      if (m !== null) {
        let idx = 0;
        for (let p = 0; p < m.index; p++) if (guardContent.charCodeAt(p) === 10) idx++;
        throw new PrefilterSelfCheckFailure(
          formatSelfCheckFailure({
            ruleId: c.rule.id,
            clauseNumber: k + 1,
            field: "also_in_file",
            file,
            line: idx + 1,
            lineText: lines[idx] ?? "",
            literals: [...litIds].map((id) => index.literals[id]),
          }),
        );
      }
    }
  }
  return out;
}

/**
 * The prefilter as ONE SCAN uses it: the single automaton/postings table built for this bundle, and
 * the self-check sampler that traversal draws its spot checks from. `null` wherever the prefilter is
 * disabled, so each gated call site below branches on one value rather than re-deriving "on or off".
 *
 * THE SAMPLER'S COUNTER IS RE-SEEDED PER FILE, from that file's own index in the walk, at the top of
 * `scanFile` (`SelfCheckSampler.startFile`, prefilter.ts). That is stage 3c's answer to the question
 * this comment used to hand forward. A file is always scanned WHOLE by one thread and the calls
 * inside it run in a fixed order — rules in bundle order, lines in order, clauses in order — so the
 * set of skipped (rule, line, clause) pairs that gets re-tested is the same set at `--jobs 1` and at
 * `--jobs 8`, in any dispatch order: a function of the tree, the bundle and the rate, and of nothing
 * about how the work was divided. `PRODUCT_CLI_PREFILTER_SELFCHECK=all` still re-tests every skipped
 * pair. Neither choice could change a finding — a self-check either finds nothing, which is silent,
 * or throws and stops the scan — but a spot check that cannot be reproduced from the inputs is not
 * evidence, which is why it is decided here rather than defaulted.
 */
export interface PrefilterScan {
  index: ClauseLiteralIndex;
  selfCheck: SelfCheckSampler;
}

/**
 * Derive every clause's required-literal set, build the one shared automaton for the bundle, and
 * attach each rule's clause ids onto its own `CompiledRule` — the compile-stage half of the
 * prefilter (prefilter.ts; step2-prefilter/proposal.md §B, §G.1). Returns `null` when the prefilter
 * is disabled, which is what `--no-prefilter` and `PRODUCT_CLI_PREFILTER=0` reach.
 *
 * CALLED ON THE LINE AFTER `compileRules`, EVERYWHERE, and a stage-3c worker calls the pair exactly
 * as `runBuiltin` does: the automaton is derived from the bundle INSIDE each worker and never cloned
 * across the `postMessage` boundary, for the same reason `CompiledRule` is not
 * (step3-workers/proposal.md §F.3 #1). It is a function of its own rather than a second return value
 * of `compileRules` because that function's `CompiledRule[]` is what `scanShard` and `mergeShards`
 * both take and what a test calls it for, while one derivation pass produces
 * two things that belong in different places: the per-rule clause ids, which belong on the rules,
 * and the automaton, which belongs to the bundle.
 *
 * IT MUTATES `compiled` IN PLACE, deliberately. `mergeShards` is handed the same array and keys its
 * per-rule surfaces off it, so a second copy of any `CompiledRule` must not exist.
 *
 * `resolvePrefilterRuntimeOptions` is called BEFORE the enabled test and not inside it, so a
 * malformed `PRODUCT_CLI_PREFILTER_SELFCHECK` is still refused when the filter itself is switched
 * off — the same order the step-2 branch resolved these switches in.
 */
export function compilePrefilter(compiled: CompiledRule[], options?: PrefilterCallOptions): PrefilterScan | null {
  const runtime = resolvePrefilterRuntimeOptions(options);
  if (!runtime.enabled) return null;
  const built = buildRulePrefilterIndex(compiled, options?.overrideLiteralsForTest);
  for (let ci = 0; ci < compiled.length; ci++) {
    compiled[ci].matchClauseIds = built.matchClauseIds[ci];
    compiled[ci].alsoInFileClauseIds = built.alsoInFileClauseIds[ci];
  }
  return { index: built.index, selfCheck: new SelfCheckSampler(runtime.selfCheckRate) };
}

/**
 * Whether any rule in this bundle asks to be read structurally.
 *
 * The CLI awaits `prepareStructural()` only when this is true, which is what makes carrying the
 * capability free for everyone else: no wasm runtime is started, no grammar file is read, and the
 * scan is byte-for-byte the scan it was before. It is a predicate over the bundle, not over the
 * files — nothing anywhere decides which FILES are worth parsing.
 */
export function declaresStructuralChecks(rules: Rule[]): boolean {
  return rules.some((r) => (r.detector.structural_checks ?? []).length > 0);
}

/**
 * Whether any rule in this bundle asks for a corroboration scope wider than its own file.
 *
 * A predicate over the BUNDLE, exported for the same reason `declaresStructuralChecks` is: `scan.ts`
 * needs the answer to decide whether `stats.gates_opened_by_scope` is a number this document can
 * carry at all, and it must not keep its own copy of what "a wider scope" means. It
 * decides nothing about any file and nothing about any candidate.
 */
export function declaresGateScope(rules: Rule[]): boolean {
  return rules.some((r) => r.detector.gate_scope !== undefined && r.detector.gate_scope !== "file");
}

/**
 * Whether any rule in this bundle asks for the joined-construct view.
 *
 * A predicate over the BUNDLE, on the same footing and for the same reason as the two above:
 * `scan.ts` needs the answer to decide whether the three `joined_*` counters are numbers this
 * document can carry at all, and it must not keep its own copy of what declaring the
 * view means. It decides nothing about any file and nothing about any candidate.
 */
export function declaresJoinedView(rules: Rule[]): boolean {
  return rules.some((r) => r.detector.join_bracketed_constructs === true);
}

/**
 * The directory a scanned path belongs to — its immediate parent, `""` for a file at the root.
 *
 * ONE DEFINITION FOR THE TWO PLACES THAT SAY "directory". `fingerprint_spec: "directory"` collapses
 * every hit under one parent into a single candidate (`scan.ts`), and `gate_scope: "directory"` lets
 * a gate read its siblings (below). A rule author reading the word in either field expects the same
 * answer, so the answer is written here and imported, rather than spelled out twice — and neither
 * reading descends into subdirectories, because a parent is a parent.
 *
 * Separators are normalised because the walker produces `\` on Windows and `/` everywhere else, and
 * the two would otherwise be different directories for the same tree.
 */
export function directoryOf(file: string): string {
  const p = file.replace(/\\/g, "/");
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

/**
 * Whether this rule may produce a candidate in this file.
 *
 * Two cases, and the difference is the whole point of the decision:
 *
 * - The rule **declares** `file_globs` — that declaration governs, including over the
 *   non-production default. A rule that says it wants `test/**` gets `test/**`.
 * - The rule declares nothing — the default surface applies, which excludes `test/`, `spec/`,
 *   `fixtures/`, `mocks/`, `stories/` and `*.test.*`-style filenames.
 *
 * The default lives here rather than in the walker because "is this a test file?" is the wrong
 * question and "does it matter, for THIS rule, that this is a test file?" is the right one. A
 * consent gate or an AI disclosure inside a test carries no legal exposure. A live API key or a
 * real person's data inside a test fixture carries the same exposure it would anywhere — a test
 * database holding real personal data is a GDPR matter whether or not the file ships. One set of
 * directory names inside the scanner cannot serve both, and while it did, no rule could opt out
 * and nobody could see that it was deciding for all of them.
 */
function surfaceAllows(c: CompiledRule, file: string): boolean {
  if (c.fileGlobs) return globsAllow(c.fileGlobs, file);
  return !isNonProductionPath(file);
}

/**
 * Whether the profile's own answers put this rule in scope.
 * Expression forms: `a.b.c` (truthy) / `a.b=val` (equals; where the answer is a list, `val` is among it) / `a.b[]`
 * (non-empty array). `platform` is a list, so `platform=web` holds for
 * ["web", "mobile"]: a product that ships as both is never read as answering that it is not on the web.
 *
 * **THIS IS A LABEL, NOT A GATE, AND MUST NEVER BE USED AS A FILTER AGAIN.** Until 2026-08-27 it was
 * the off-switch: `compile(rules).filter(preconditionsMet)` below, and `bundle.rules.filter(...)` in
 * `scan.ts`. A `false` here meant the rule read no line of the tree and the document reported
 * `state: not-evaluated`. Measured over the eight pass-1 runs of 2026-08-26, that accounted for
 * **21 of the 69 located misses** — the largest class after vocabulary — and the whole DSA pack
 * (`eu-dsa-001`, `eu-dsa-002`) recorded `not-evaluated` in all eight, so its zero is not silence.
 *
 * The cost of evaluating anyway was measured before the switch was removed and it is close to
 * nothing: one tree declared `platform: "api"`, which switched off fifteen `eu-consent` rules, and
 * silence-investigation agents re-searched every one of the fifteen and found the construct absent.
 * **Where the declared answer is right, running the rule costs a pattern pass and adds no candidate.
 * Where it is wrong, the evidence appears instead of a blank.**
 *
 * What the answer is used for now: every candidate and every roster row of a rule whose profile
 * answer puts it out of scope carries `declared_inapplicable_preconditions`, so a candidate raised
 * under a declaration of absence is read as conditional on that declaration, and a rule that ran
 * under one and found nothing is read as corroborating it. See `scan.ts` for both.
 *
 * Kept as a named predicate rather than inlined because two output channels need the same answer and
 * This project keeps no second copy of anything two places must agree on.
 */
export function preconditionsMet(rule: Rule, profile: ScanProfile | null): boolean {
  return preconditionStatus(rule, profile).unmet.length === 0;
}

/**
 * The same evaluation, reporting WHICH precondition expressions did not hold rather than only that
 * one did not. Empty means the rule was evaluated.
 *
 * `preconditionsMet` is defined in terms of this rather than beside it. The two have to agree
 * exactly — a rule this says was suppressed by `features.llm.present` and the engine ran anyway
 * would put a false sentence in front of a reader — and the project's rule is to export the fact
 * rather than keep a second copy of it.
 *
 * Why the expressions are reported at all: a rule that never ran is reported as
 * `not-evaluated`, and the reader's next question is always "on the strength of what did I turn
 * this off?". The answer is a field of their own ScanProfile, and naming it is what lets them
 * check the declaration against their own README — which is the one thing that can catch a
 * profile answered wrongly. `rules_suppressed_by_precondition` has counted these since the first
 * scan and has never been able to name one.
 */
export function unmetPreconditions(rule: Rule, profile: ScanProfile | null): string[] {
  return preconditionStatus(rule, profile).unmet;
}

/**
 * The precondition expressions this profile ANSWERED NO to, and the ones it did not answer at all.
 *
 * ## The defect this closes, stated exactly
 *
 * Until 2026-08-25 there was one list. A precondition read a dotted path out of the profile and
 * `if (!v) unmet.push(cond)` — so `undefined` and `false` arrived at the engine as the same value,
 * and **a question nobody answered switched the rule off exactly as hard as an answer of no.**
 * `SKILL.md` step 1 makes that reachable in one sentence: *"Ask; leave them out where the user does
 * not answer."* A person who declines to say whether their product uses an LLM had
 * `ai-transparency-001` and `-008` removed from their scan on the strength of the silence.
 *
 * That is the same defect in its input half. The product must not report that nothing
 * was found where nobody looked; this is the same sentence one step earlier — **nobody may be
 * stopped from looking by a fact nobody stated.** The ruling is in those
 * terms: *an unanswered switch must not delete anything; the rules must still run and their
 * candidates must still reach layer 2, carrying the open question.*
 *
 * ## What changed, and what deliberately did not
 *
 * - **`undefined` at the path — the person did not answer — is `unanswered`. The rule RUNS.**
 *   The expression is carried into the output beside whatever the rule produced, so a reader sees
 *   *"this ran on a question you have not answered"* rather than nothing.
 * - **A value that is present and does not satisfy the expression is `unmet`, and still switches
 *   the rule off.** `features.llm.present: false` is an answer, `platform: "mobile"` against
 *   `platform=web` is an answer, and an answer is the person's to give. It is reported as
 *   `not-evaluated` with `unmet_preconditions` exactly as before.
 * - **`null` is treated as unanswered, not as no.** JSON has no undefined, and a profile writer
 *   that emits every key with `null` for the unknown ones is writing "I did not answer", not "no".
 * - **An empty array against `a.b[]` is an ANSWER of no.** `analytics_ads: []` is a positive
 *   statement that the list is empty; the absent key is the unanswered case. (No rule declares a
 *   `[]` precondition today — measured on the shipped bundle — so this line is a specification,
 *   not an observed behaviour.)
 * - **The direction is a widening.** Nothing that ran before stops running: `unmet` here is a
 *   subset of the old `unmet`, because every branch that pushes now also pushed then. What moves
 *   is rules that used to be silently removed and now run.
 *
 * A rule whose precondition is unanswered is NOT marked `not-evaluated`: it was evaluated. It
 * appears in `candidates` if it fired and in `rules_without_candidates` with
 * `unanswered_preconditions` if it did not, and `SKILL.md` step 3b tells the agent to put the
 * question to the person rather than to answer it from the code.
 */
export interface PreconditionStatus {
  /** Expressions the profile answered, in a way that puts the rule out of scope. Suppresses. */
  unmet: string[];
  /** Expressions the profile does not answer at all. Never suppresses; reported as an open question. */
  unanswered: string[];
}

export function preconditionStatus(rule: Rule, profile: ScanProfile | null): PreconditionStatus {
  // No profile means the caller has not declared its context (fixture tests, first run).
  // Evaluate every rule rather than silently narrowing coverage: over-reporting is reviewable,
  // whereas a rule that was never evaluated is invisible.
  //
  // Reported as `unanswered` rather than as an empty status, because "there is no profile" is
  // precisely the state in which every one of these questions is open. Before 2026-08-25 this
  // returned `[]` and the rows read as though the questions did not exist.
  if (!profile) {
    return { unmet: [], unanswered: [...(rule.applicability_preconditions ?? [])] };
  }

  const unmet: string[] = [];
  const unanswered: string[] = [];

  // Deliberately NOT gated on rule.jurisdiction vs profile.distribution_regions, although
  // rule.schema.json describes the two as matched. A jurisdiction gate was written here on
  // 2026-07-27 and removed the same day, on the owner's correction: the region choice belongs to
  // **pack selection**, not to rule evaluation. Someone who has installed the EU pack has already
  // declared their exposure — the architecture puts that decision in `get_scan_plan`, which
  // returns the applicable packs *and the reason each inapplicable one was left out*. Repeating
  // the filter per rule inside the scan would delete candidates silently, which is the one thing
  // layer 1 must never do (detectors carry recall, the agent carries precision).
  //
  // The problem that prompted the gate was real but sits elsewhere: an adjudicator had to *guess*
  // the region because the ScanProfile was never handed to it. That is fixed in the skill, which
  // now passes the profile — the agent answers the question instead of the engine pre-empting it.
  //
  // Since 2026-09-22 the comparison is also COMPUTED once per rule — `per-rule-applicability.ts`,
  // written into `findings.json` as `per_rule_applicability` — so that the orchestrator settles it
  // once instead of every child re-deriving it. That is not this gate coming back: it writes an
  // answer beside the findings and removes no candidate, and the deletion this comment refuses is
  // still refused here.
  const conds = rule.applicability_preconditions ?? [];
  for (const cond of conds) {
    let path = cond;
    let expect: string | null = null;
    let nonEmptyArray = false;
    const eq = cond.indexOf("=");
    if (eq >= 0) {
      path = cond.slice(0, eq);
      expect = cond.slice(eq + 1);
    } else if (cond.endsWith("[]")) {
      path = cond.slice(0, -2);
      nonEmptyArray = true;
    }
    // `answered` is decided on the way down, not from the final value, so that a MISSING PARENT is
    // as unanswered as a missing leaf: a profile carrying no `features` object at all has not said
    // no to `features.llm.present`, it has said nothing about it. The old walk collapsed both into
    // `undefined` and then read `undefined` as false.
    let v: unknown = profile;
    let answered = true;
    for (const seg of path.split(".")) {
      if (v == null || typeof v !== "object" || !(seg in (v as Record<string, unknown>))) {
        answered = false;
        v = undefined;
        break;
      }
      v = (v as Record<string, unknown>)[seg];
    }
    // JSON cannot carry `undefined`, so a producer that emits every key and leaves the unknown ones
    // `null` is saying "not answered" in the only vocabulary the format gives it. Reading `null` as
    // no would put this defect straight back for that producer.
    if (v === null) answered = false;
    // "unknown" alone (or a list of it alone) is the profile schema's
    // recorded answer for a question put and not settled: it is not an answer of no, so the expression
    // is unanswered. Before this it was read as a value, and every candidate of the sixteen `platform=web` rules on a
    // declaration that left "Ships as" open carried `declared_inapplicable_preconditions`, an answer nobody gave.
    if (v === "unknown" || (Array.isArray(v) && v.length > 0 && v.every((e) => e === "unknown"))) answered = false;
    // `push` where the original returned, and the loop runs to the end rather than short-circuiting.
    // A rule with two unmet preconditions is turned off by both of them, and reporting only the
    // first would hand the reader one declaration to check when there are two.
    if (!answered) {
      unanswered.push(cond);
    } else if (expect !== null) {
      if (Array.isArray(v) ? !v.includes(expect) : String(v) !== expect) unmet.push(cond);
    } else if (nonEmptyArray) {
      if (!Array.isArray(v) || v.length === 0) unmet.push(cond);
    } else if (!v) {
      unmet.push(cond);
    }
  }
  return { unmet, unanswered };
}

/**
 * Does this rule's `match` fire on this line — reading the line as CODE rather than as text?
 *
 * ## The defect this closes
 *
 * Until 2026-08-19 the match side tested the raw line and nothing else. The comment-blanked view
 * existed, was built for every file, was handed to `disqualifiedByMatchWithout` as its second text —
 * and was never consulted about whether a line matched at all. So **a comment matched like code**:
 * a rule fired on a sentence a maintainer wrote after `//`, on a commented-out call, and — the case
 * that forced this — on a fixture mutant's OWN HEADER COMMENT, which made the mutant report
 * UNRESOLVED for a reason that had nothing to do with the mutation under test.
 *
 * **22 of the 56 shipped rules declare no `match_without` at all**, so in those rules nothing
 * anywhere could suppress a comment-borne match. Across P4 this held **at least 25 mutants** whose
 * annotated sites were genuinely closed. The instance patch — a line-start comment clause per rule —
 * was priced on one rule and cannot work in general: the blocking line in the decisive case is a
 * CONTINUATION line inside a `{{-- … --}}` block opened earlier, and a line-start marker cannot
 * reach it. See an internal record,
 * which is the decision this implements.
 *
 * ## The shape, and why it is a CONJUNCTION rather than a substitution
 *
 * `match` must fire on the raw line AND on the same line with its comments blanked.
 *
 * Substituting the code view for the raw line is the shorter reading and it does something this
 * change may not do: blanking can CREATE a match that the raw line does not carry — `foo(/* x *​/ y)`
 * blanks to `foo(       y)`, and a pattern spelling `foo\(\s*y` newly fires. That would ADD
 * candidates, and the decision authorises removing matches that occur inside comments, not
 * widening what a rule looks for. With the conjunction the set of lines that match is a SUBSET of
 * the set that matched before, whatever any pattern contains, so this change can only remove.
 *
 * Per-CLAUSE conjunction — requiring ONE pattern to fire on both texts — is stricter still and is
 * not what is built. It differs only when clause A fires on the raw line alone and clause B on the
 * code view alone, with no clause true of both; that is a stronger claim than the diagnosis
 * supports, and it would remove candidates for a reason nobody measured.
 *
 * ## What it does to `disqualifiedByMatchWithout` below
 *
 * That function's PATH A branch (b) — "the match no longer fires on what survived, so the candidate
 * is COMMENT-RAISED" — becomes unreachable for every rule that does not set `match_in_comments`,
 * because a comment-raised candidate no longer exists for them. **It is kept, not deleted**, and it
 * looks like dead code, which is the trap: it is the path an opted-in rule takes, and deleting it
 * would let a `match_without` clause stop cancelling for exactly those rules. A36 is the assertion
 * that reaches it — the only one that reaches it on a SYNTHETIC rule, and it is written that way so
 * that it keeps reaching it whatever the shipped bundle declares. A3, A5 and A17 used to reach it
 * and no longer do: their lines are refused by `matchFires` before any clause runs, so they now say
 * `false` for a different reason and cannot see this branch at all.
 *
 * ## The opt-in
 *
 * `detector.match_in_comments: true` restores the old behaviour for one rule. A commented-out
 * credential is still a leaked credential, and which rules are of that kind was decided by
 * measurement — the fixture lines that stop firing without it — not by guessing.
 *
 * **TWO RULES DECLARE IT, both since 2026-08-19**. The measurement that shipped with
 * the flag named 5 candidate rules against a stop threshold of 3, so it shipped enabled nowhere and
 * the choice went to the owner. The owner then took all three kinds:
 *
 *   - `ai-prohibited-004` and `eu-dsr-001` DECLARE IT. In the first the commenting-out IS the act
 *     being detected (a safety call removed in place), and without the flag its `match[22]` — the
 *     one clause of all 602 shipped clauses anchored on a line-start comment marker — CAN NEVER
 *     FIRE AGAIN on any input; in the second the evidence is a maintainer writing that the deletion
 *     route does not exist. Both fixtures stated that requirement in their own words BEFORE this
 *     flag existed. Measured price on the 94 pinned trees, re-derived by a before/after sweep
 *     rather than inherited: **3 and 11 locations, all 14 read, all 14 off-target**.
 *   - `eu-cra-002`, `eu-special-categories-001` and `eu-special-categories-002` DO NOT, and must
 *     not: their fixtures were carrying the rule's evidence inside a comment, and the answer there
 *     is to rewrite those fixture lines as code. Opting them in would have cost 490 corpus
 *     locations, all 490 read and all 490 off-target.
 *
 * Which 5, what each would cost, and why the list is not the same question twice:
 * an internal record The follow-up that enabled the two and measured them:
 * an internal record.
 */
/**
 * WHICH READING handed the subject in — carried only so that a violation of the single-line
 * property below can name the site instead of leaving the reader to find it. The first four names
 * are proposal §A.2's readings 1-4; the other three are sites that test a `match` clause without
 * being a reading of their own.
 */
export type MatchSubjectReading =
  | "raw"
  | "alias-resolved"
  | "local-value-resolved"
  | "joined-construct"
  | "prefilter-self-check"
  | "fired-clauses"
  | "structural-post-check";

/**
 * THE SINGLE-LINE PROPERTY, ENFORCED RATHER THAN OBSERVED: a `match` clause is only ever tested
 * against ONE PHYSICAL LINE, carrying no `\n`.
 *
 * ## Why this exists
 *
 * On 2026-09-15 clause 17 of `eu-retention-001`'s `match` was reworded by adding one character — a
 * leading `^` — and a scan of one tree went from 45.3 s to 18.8 s, of another from 6 min 29 s to
 * 3 min 01 s, because the unanchored form re-evaluated a line-wide lookahead at every start position
 * of every line. THE REWORDING IS LANGUAGE-PRESERVING ONLY ON A SUBJECT WITH NO NEWLINE IN IT. On a
 * multi-line subject the two forms genuinely differ — 522 of 972 such subjects in the independent
 * verifier's own fuzz.
 *
 * That verification read every consumer in `product/` and `tools/` that can hand a compiled `match`
 * clause a string and found that none of them can build one containing `\n`: `scanFile` splits on
 * `"\n"`, the alias and local-value binders exclude `\n` in every capture, and the joined view's
 * `foldSpan` collapses whitespace runs — `\s` includes `\n` — to one space. **And it found that
 * nothing in the repository enforced any of it**: a test guards its
 * whole-file test with `if (c.field === "also_in_file")`, which is the convention observed but never
 * asserted. §8(f)(1) says so in terms — *"It is not a guarantee about a consumer written tomorrow"*
 * — and raised the mechanism for the parent to decide on. This is that mechanism.
 *
 * ## TWO HALVES, BECAUSE A RUNTIME CHECK ALONE IS EITHER EXPENSIVE OR FORGETTABLE
 *
 *   (1) THE TYPE. `matchFires` and `admittedMatchClauses` take `SingleLineSubject`, not `string`, so
 *       a reading written tomorrow CANNOT hand them a string it has not passed through
 *       `asSingleLineSubject` — the compiler refuses. This is the half that cannot be forgotten, and
 *       it costs nothing at run time.
 *   (2) THE CHECK, AT THE POINT EACH SUBJECT IS BUILT. `scanFile` checks the two line arrays once per
 *       FILE, right where they are split; readings 2-4 check the string each of them builds, in the
 *       branch that builds it; the three sites that test a `match` clause without being a reading
 *       (`firedClauseIndices`, the exported `disqualifiedByMatchWithout`, the sampled prefilter
 *       self-check) check theirs on arrival, since a JavaScript caller gets no help from (1).
 *
 * ## Why not simply at the top of `matchFires`
 *
 * BECAUSE IT WAS MEASURED THERE AND IT COST TOO MUCH. `matchFires` runs once per (rule, line) pair —
 * 10,278,906 times on one scan — and a scan of that tree with the check at its top ran 20.30 s
 * against 19.25 s without it, +5.5 %; with the check inlined rather than called, +2.1 %. The
 * `indexOf` itself accounts for almost none of that (9.2 ns per call measured in isolation, so
 * ~0.1 s of it); the rest is what two more arguments and a call do to that function at that call
 * site. Checking each subject WHERE IT IS BUILT costs one pass over each file's own text instead —
 * about 0.05 % — and holds a strictly stronger property, since it covers every rule's reading of a
 * line rather than the readings that happen to run. The numbers are in
 * an internal record.
 *
 * ## What it is not
 *
 * It is not a check on `also_in_file` or `guard_missing`, which are tested against the WHOLE of
 * `guardContent` by design and whose subjects carry newlines on every file with more than one line.
 * Those fields are compiled separately (`c.alsoInFile`, `c.guardMissing`) and never reach here.
 */
export type SingleLineSubject = string & { readonly __singleLineSubject: unique symbol };

/** One subject, checked and branded. The only way to make a `SingleLineSubject`. */
function asSingleLineSubject(reading: MatchSubjectReading, owner: string, s: string): SingleLineSubject {
  if (s.indexOf("\n") >= 0) throw multiLineSubject(reading, owner, s);
  return s as SingleLineSubject;
}

/**
 * A whole file's worth of them, in place: the two arrays reading 1 hands every rule.
 *
 * ONE PASS OVER THE FILE'S OWN TEXT, once per file — not once per (rule, line). `split("\n")` cannot
 * produce a part containing `"\n"`, so on today's engine this loop can only pass; it is here so that
 * the day somebody replaces the split with a reader that joins continuation lines, or hands `scanFile`
 * text it did not split itself, the scan stops instead of quietly changing which lines clause 17
 * accepts.
 */
/** U+FEFF, the byte-order mark, as `charCodeAt` reads it. */
const BYTE_ORDER_MARK = 0xfeff;

/**
 * A file's lines as every line clause reads them: split at `\n`, each WITHOUT the one `\r` a CRLF line
 * ending leaves on it (CRLF). Until 2026-11-12 the `\r` stayed on the line, so
 * a clause ending `[ \t]*$` could never match a line of a file saved with Windows line endings, and every
 * candidate such a clause raises was silently missing there. Only the line terminator's last character
 * goes: every column before it is the file's own, so a reported column and a quoted line stay exact.
 * Given `raw` (the raw file's lines, already cut), the comment view's lines are cut to the same lengths:
 * the view keeps the file's length, and blanks a comment line's `\r` to a space.
 *
 * AND LINE 1 WITHOUT A LEADING BYTE-ORDER MARK, when `markOnLine1` says the FILE
 * opens with one (U+FEFF, which Windows editors write into `.cs`, `.config`, `.properties`, `.env`, `.ini` and
 * others; `decodeSource` keeps it in a UTF-8 file's text, and already drops a UTF-16 file's). Until 2026-11-13
 * the mark stayed on line 1, so a clause anchored at a line's start (`^DB_PASSWORD=`, `^[ \t]*export\s`) never
 * matched line 1 of such a file, and every candidate such a clause raises there was silently missing. The caller
 * decides `markOnLine1` from the raw text for both arrays, since the comment view may hold a space where the mark
 * was. Only `parts[0]` can change, and only when the mark is there: every other line, and every line of a file
 * without the mark, is the split it was. Line 1's characters after the mark are the file's own and in its order;
 * no output carries a column (a candidate carries its line and its trimmed text, and `trim` removed the mark
 * before this change too), so nothing reported moves. The whole-file readings (`also_in_file`, the gate views,
 * the derived tables, the structural parse, `guard_missing`'s own copy of line 1) still read the file as it is.
 */
function physicalLines(text: string, markOnLine1: boolean, raw?: readonly string[]): string[] {
  const parts = text.split("\n");
  if (markOnLine1) parts[0] = parts[0].slice(1);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (raw) {
      const n = raw[i]?.length;
      if (n !== undefined && p.length === n + 1) parts[i] = p.slice(0, n);
    } else if (p.endsWith("\r")) parts[i] = p.slice(0, -1);
  }
  return parts;
}

function asSingleLineSubjects(owner: string, parts: string[]): SingleLineSubject[] {
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].indexOf("\n") >= 0) throw multiLineSubject("raw", owner, parts[i]);
  }
  return parts as SingleLineSubject[];
}

/**
 * The same check for a caller that has a `string` and no brand: the three sites that test a `match`
 * clause from outside a reading, and every JavaScript caller of `disqualifiedByMatchWithout`, where
 * the type has no force. All three are reached only on a line that already matched, or on a sampled
 * branch, so this is never on the hot path.
 */
function assertSingleLineSubject(
  reading: MatchSubjectReading,
  owner: string,
  text: string,
  code: string,
): void {
  if (text.indexOf("\n") >= 0) throw multiLineSubject(reading, owner, text);
  // Skipped on the common line, where the two strings are the same object; on the rest this is the
  // second and last scan this function ever makes.
  if (code !== text && code.indexOf("\n") >= 0) throw multiLineSubject(reading, owner, code);
}

/**
 * The violation, as an error a reader can act on: who owns the subject (the rule at a reading, the
 * file at the split), which reading, and the first 80 characters of the offending subject with the
 * newline made visible — a subject printed raw would break the message across lines and hide exactly
 * the character it is about.
 *
 * Built in a separate function so that the checks above hold nothing but comparisons: the message is
 * assembled only on the path that throws.
 */
function multiLineSubject(reading: MatchSubjectReading, owner: string, subject: string): Error {
  const head = subject.slice(0, 80).replace(/\n/g, "\\n").replace(/\r/g, "\\r");
  return new Error(
    `engine: a \`match\` clause of ${owner} was about to be tested against a subject containing a ` +
      `newline, at the ${reading} reading. Every \`match\` clause in this bundle is written for ONE ` +
      `PHYSICAL LINE, and at least one of them (eu-retention-001 clause 17) is anchored with \`^\` ` +
      `on exactly that premise, so a multi-line subject would silently change which lines it ` +
      `accepts. Subject (first 80 chars): ${JSON.stringify(head)}`,
  );
}

/**
 * PARAMETERISED ON THE CLAUSE LIST ITSELF RATHER THAN ON THE RULE, since the prefilter (prefilter.ts,
 * proposal §H5) hands this function a per-LINE ADMITTED SUBSET of `c.match` at the one call site it
 * gates (reading 1, the per-line loop below), while every reading it does NOT gate — the alias,
 * local-value and joined-construct call sites, proposal §A.2's readings 2-4 — keeps calling it with
 * `c.match` in full. This function's OWN decision is unchanged either way: both `some`s below always
 * ran over "the clauses a caller believes could fire here", and only what one caller believes
 * changed. `matchInComments` moves for the identical reason — the caller knows whether the rule
 * opted in, this function only acts on it.
 *
 * THE TWO SUBJECTS ARE `SingleLineSubject`, NOT `string`, and that is the whole of the single-line
 * property's enforcement at this function: a caller with a string it has not checked cannot compile.
 * Nothing is checked at run time here, deliberately — see `asSingleLineSubject` for the measurement
 * that moved the check to where each subject is built. This function's decision is the same two
 * `some`s it always was.
 */
function matchFires(
  clauses: RegExp[],
  matchInComments: boolean,
  text: SingleLineSubject,
  code: SingleLineSubject,
): boolean {
  // The raw line is tested FIRST and is unchanged, so a rule that matches nothing today still
  // matches nothing, and the reported line number and quoted text still come from the raw line.
  if (!clauses.some((re) => re.test(text))) return false;
  // Nothing on this line was blanked — no comment on it at all, which is 95.0% of the corpus lines
  // a rule's `match` hits (measured 2026-08-15 for the note below, not re-measured here). For those
  // the second test is the first one again, so the short-circuit is behaviour-identical.
  if (code === text || matchInComments) return true;
  return clauses.some((re) => re.test(code));
}

/**
 * WHICH clauses fired, where `matchFires` above answers only THAT one did.
 *
 * 1-based and ascending, so the numbers are the ones a rule author writes when they say "clause
 * (13)" and the ones the design annex's tables use.
 *
 * ## Per-clause conjunction here, where `matchFires` uses two `some`s, and why that is not a
 * contradiction
 *
 * `matchFires` decides whether a candidate EXISTS, and the note above it says why the per-clause
 * form is the wrong test for that: it would remove candidates for a reason nobody measured. This
 * function decides nothing about existence — the candidate already exists — and answers a different
 * question: which clauses can be said to have READ this text. A clause that fires on the raw line
 * and not on the comment-blanked one matched inside a comment, and treating that as a reading would
 * let comment prose be the unique clause that keeps an enclosing candidate alive. So a clause counts
 * here only if it fires on the text AND on the comment-blanked text beside it, with the same
 * `code === text` short-circuit and the same `match_in_comments` opt-in the decision uses, so that a
 * rule that declared the flag is read the way it asked to be read.
 *
 * This is the definition the design annex's measurement was taken with,
 * so the counts this engine produces are comparable with the ones the
 * mechanism was approved against.
 *
 * ## Cost
 *
 * Called ONLY where the candidate's rule declared `detector.join_bracketed_constructs`, and only on
 * a line that already matched. Two rules declare it today, so 113 of 115 never reach this function
 * and the per-line loop they run is the one they ran before it existed.
 */
function firedClauseIndices(c: CompiledRule, text: string, code: string): number[] {
  // Once for this pair, above the per-clause loop — the same placement and the same reason as in
  // `matchFires`. The pair is one of the four the readings below already checked, so this is a
  // second look at a string that passed; it is here because the loop under it tests `c.match`, and
  // a site that tests `match` and does not assert the property is the hole this mechanism closes.
  assertSingleLineSubject("fired-clauses", c.rule.id, text, code);
  const out: number[] = [];
  const twoTexts = code !== text && !c.matchInComments;
  for (let k = 0; k < c.match.length; k++) {
    const re = c.match[k];
    if (!re.test(text)) continue;
    if (twoTexts && !re.test(code)) continue;
    out.push(k + 1);
  }
  return out;
}

/**
 * THE KIND FACTS OF ONE CANDIDATE — which clause read this line, what it matched, where that sits.
 *
 * Computed here and nowhere else, because here is the only place the line's own text still exists:
 * `RawMatch.lineText` is trimmed and cut to 300 characters, so a consumer downstream cannot classify
 * a span by what surrounds it and cannot fold what a clause matched. `scan.ts` copies these onto the
 * location and `kind-census.ts` groups by them; the derivation itself is `kind-key.ts`, which is the
 * port of the measurement's own normaliser and is held to it by `test:kind-census`.
 *
 * ## The four readings, in the engine's own order
 *
 * A candidate exists because a clause fired on the raw line, on the alias-resolved line, on the
 * value-resolved line or on the fold — and this function asks the same question in the same order,
 * rather than asking which branch of the loop below happened to raise it. That is deliberate: the
 * oracle re-derives the reading
 * from the text in exactly this order, and a key derived from a different reading would not be the
 * key those 806 recorded cells were counted at.
 *
 * ## When no clause set can be named
 *
 * `matchFires` is two `some`s, so a candidate can exist with an EMPTY per-clause set — one clause
 * true of the raw text, another of the comment-blanked text, none of both — and the structural
 * reading raises candidates from a parse tree with no clause at all. Both are labelled rather than
 * called unattributed, and `unattributedKindFacts` groups them one level coarser. One line of the
 * 1,139,261 in the recorded population is the split-clause case.
 *
 * ## Cost
 *
 * Called once per CANDIDATE — a line that already matched — and only when the kind census is on.
 * The first reading answers 99.0 % of the recorded population (1,127,740 of 1,139,261 lines), so the
 * ordinary cost is one pass over this rule's clauses on a line that just passed two.
 */
function kindFactsForCandidate(
  c: CompiledRule,
  file: string,
  i: number,
  lines: SingleLineSubject[],
  codeLines: SingleLineSubject[],
  table: AliasTable | null,
  valueTable: ValueTable | null,
  joinedView: JoinedView | null,
  endLine: number | undefined,
  /**
   * Optional: receives the text the returned facts were derived from — the raw line, a resolved or
   * joined reading, or the reading the split label names — so that `kindFactsAndRedactions` can find
   * credential material in the very text the label was cut from. The gate wrapper passes none, and
   * the facts returned are the same with or without it.
   */
  out?: { text: string },
): KindFacts {
  // Every return below goes through this, so `out` names the text of the facts it returns.
  const from = (t: string, facts: KindFacts): KindFacts => {
    if (out !== undefined) out.text = t;
    return facts;
  };
  const text = lines[i];
  const code = codeLines[i] ?? text;
  // Every subject pair this candidate is tested against, in the engine's order, kept for the
  // split-clause label at the bottom.
  const tried: { reading: string; text: SingleLineSubject; code: SingleLineSubject }[] = [
    { reading: "raw", text, code },
  ];
  const fired = firedClauseIndices(c, text, code);
  if (fired.length > 0) return from(text, firedKindFacts(c.match, fired, file, text, code));

  if (c.resolveImportAliases && table?.probe) {
    const substituted = resolveAliasesInLine(text, table);
    if (substituted !== text) {
      const sub = asSingleLineSubject("alias-resolved", c.rule.id, substituted);
      const subCode = asSingleLineSubject("alias-resolved", c.rule.id, resolveAliasesInLine(code, table));
      tried.push({ reading: "alias-resolved", text: sub, code: subCode });
      const f = firedClauseIndices(c, sub, subCode);
      if (f.length > 0) return from(sub, firedKindFacts(c.match, f, file, sub, subCode));
    }
  }
  if (c.resolveLocalValues && valueTable?.probe) {
    const r = resolveLocalValuesInLine(text, valueTable, lines, i);
    if (r.text !== text) {
      const res = asSingleLineSubject("local-value-resolved", c.rule.id, r.text);
      const resCode = asSingleLineSubject(
        "local-value-resolved",
        c.rule.id,
        resolveLocalValuesInLine(code, valueTable, lines, i).text,
      );
      tried.push({ reading: "local-value-resolved", text: res, code: resCode });
      const f = firedClauseIndices(c, res, resCode);
      if (f.length > 0) return from(res, firedKindFacts(c.match, f, file, res, resCode));
    }
  }
  if (c.joinBracketedConstructs && joinedView !== null) {
    const folded = joinedView.raw[i] ?? text;
    if (folded !== text) {
      const jt = asSingleLineSubject("joined-construct", c.rule.id, folded);
      const jc = asSingleLineSubject("joined-construct", c.rule.id, joinedView.code[i] ?? folded);
      tried.push({ reading: "joined-construct", text: jt, code: jc });
      const f = firedClauseIndices(c, jt, jc);
      if (f.length > 0) return from(jt, firedKindFacts(c.match, f, file, jt, jc));
    }
  }
  // THE SPLIT-CLAUSE CASE, and it is the engine's own reading rather than a gap in this derivation:
  // a candidate exists when ANY clause fires on the raw text and ANY on the comment-blanked text,
  // and they need not be the same clause. Such a candidate has an empty clause set under the
  // per-clause definition, so it is recorded with the reading it fired in and with both clause
  // lists, rather than called unattributed.
  for (const t of tried) {
    const onRaw: number[] = [];
    const onCode: number[] = [];
    for (let k = 0; k < c.match.length; k++) {
      if (c.match[k].test(t.text)) onRaw.push(k + 1);
      if (c.match[k].test(t.code)) onCode.push(k + 1);
    }
    if (onRaw.length > 0 && (t.code === t.text || c.matchInComments || onCode.length > 0))
      return from(
        t.text,
        unattributedKindFacts(
        {
          kind: "split",
          reading: t.reading,
          reason: "clauses_split_raw_vs_comment_blanked",
          raw: onRaw,
          blanked: onCode,
        },
        file,
        t.text,
        t.code,
        ),
      );
  }
  if (endLine !== undefined)
    return from(text, unattributedKindFacts({ kind: "structural", reason: "structural_span" }, file, text, code));
  if (c.structuralChecks.length > 0)
    return from(
      text,
      unattributedKindFacts({ kind: "structural", reason: "structural_single_line_element" }, file, text, code),
    );
  return from(
    text,
    unattributedKindFacts(
    {
      kind: "unattributed",
      reason: c.match.length === 0 ? "rule_has_no_regex_match_clauses" : "no_clause_fires_on_this_line",
    },
    file,
    text,
    code,
    ),
  );
}

/**
 * THE SAME DERIVATION, REACHABLE FROM A GATE — `kindFactsForCandidate` with the brand applied.
 *
 * `test:kind-census` holds the product's own key derivation against the measurement that key was
 * counted with. It
 * must call THE FUNCTION THE SCANNER CALLS and not a second implementation of it, or the comparison
 * proves nothing about what a scan writes — which is why this wrapper exists rather than the gate
 * re-deriving the four readings for itself.
 *
 * It takes plain strings because a gate holds lines it read from a file rather than a scan's branded
 * subjects; `asSingleLineSubjects` applies the brand with the check that goes with it, so a caller
 * cannot smuggle a multi-line subject past the assertion the scanner is held to.
 */
export function kindFactsForLineForTest(
  c: CompiledRule,
  file: string,
  lineIndex: number,
  lines: string[],
  codeLines: string[],
  table: AliasTable | null,
  valueTable: ValueTable | null,
  joinedView: JoinedView | null,
  endLine: number | undefined,
): KindFacts {
  return kindFactsForCandidate(
    c,
    file,
    lineIndex,
    asSingleLineSubjects(`gate ${file}`, lines),
    asSingleLineSubjects(`gate ${file} (comment-blanked)`, codeLines),
    table,
    valueTable,
    joinedView,
    endLine,
  );
}

/**
 * The kind facts of one candidate AND the credential material its label holds, as the two fields a
 * candidate carries — what both candidate sites spread when the census is on.
 *
 * `credentials` is `null` when the census is off or the caller asked for no label redaction (a gate that
 * compiles its own rules), and then the result is exactly `{ kindFacts }`; otherwise it is the CLI's own
 * `baseline-002` (`productCredentials`), whatever the bundle. The facts themselves are never altered
 * here: the label is rewritten once per run in `scan.ts`, where
 * every candidate with the same label is in view (`redactedLabelsOf`).
 */
function kindFactsAndRedactions(
  c: CompiledRule,
  file: string,
  i: number,
  lines: SingleLineSubject[],
  codeLines: SingleLineSubject[],
  table: AliasTable | null,
  valueTable: ValueTable | null,
  joinedView: JoinedView | null,
  endLine: number | undefined,
  credentials: CredentialRedaction | null,
): { kindFacts: KindFacts; kindRedactions?: CredentialTarget[] } {
  const out = { text: "" };
  const kindFacts = kindFactsForCandidate(c, file, i, lines, codeLines, table, valueTable, joinedView, endLine, out);
  if (credentials === null) return { kindFacts };
  const kindRedactions = credentialTargets(credentials, c.match, kindFacts, out.text);
  return kindRedactions.length > 0 ? { kindFacts, kindRedactions } : { kindFacts };
}

/**
 * Is this line disqualified by this rule's own `match_without`?
 *
 * TWO TEXTS. `text` is the line as written, comment and all — this is what `match` reads and it does
 * not change. `code` is that line with its comment characters blanked to spaces by
 * strip-comments.ts.
 *
 * At the line-loop call sites `code` is `codeLines[i]`, which the stripper produces by replacing
 * characters in place, so there it has the same length as `text` and agrees with it at every offset
 * where the character survived. THAT IS A PROPERTY OF THOSE ARGUMENTS AND NOT OF THIS FUNCTION, and
 * it is written here in those terms because it used to be written as an invariant: the
 * alias-resolved call site hands in `resolveAliasesInLine(...)`, and substituting `@app/marketing`
 * for `NLX` is not length-preserving, so offsets there do not correspond and nothing below needs
 * them to. What the safety of this function rests on is the subset property at the end of this
 * comment, which holds for ANY `code` whatsoever.
 *
 * WHICH TEXT A CLAUSE IS JUDGED ON depends on where the candidate's own evidence is.
 *
 *   A comment may not cancel a candidate the CODE raised.
 *   A comment may still cancel a candidate the COMMENT raised.
 *
 * Until 2026-08-15 both lists were handed the raw line, so a sentence a developer wrote after `//`
 * could delete a candidate whose code was untouched, and nothing anywhere recorded that it happened:
 * `const ethnicity = profile.ethnicity;` is a candidate for ai-prohibited-003, and the same line
 * ending `// guarded by a mutex, fixes the race condition` was silent, because that rule carries
 * `race condition` in its cancel list to keep the identifier `detectedRaceCondition` out and the
 * pattern cannot tell prose from code. That is layer-2 judgement performed in layer 1, and its
 * errors are silence. See an internal record.
 *
 * WHY BOTH BRANCHES ARE NEEDED, rather than simply reading `code` everywhere. Substituting `code`
 * for `text` is the literal reading of the approved fix and it re-creates the defect in the other
 * direction: a clause anchored with `$` or refusing with `(?!` gains suppressive power from the
 * shorter text. Two lines that are candidates today go silent under substitution and are saved here,
 * each by a different branch, which is why neither branch is optional:
 *
 *   `  emotionDetection?: boolean; // enabled in prod` (ai-transparency-007) — the match fires on
 *   the code view too, so this takes PATH B, and clause [1]'s `\s*[;,]?\s*$` is true of the code and
 *   false of the line. The conjunction is what saves it.
 *
 *   `$s->add(new setting("notify_delay", 0, $x)); // this is the retention setting`
 *   (eu-retention-001) — that rule's `match` requires a retention word, and the only one on the line
 *   is inside the comment, so nothing matches the code view and this takes PATH A. **It is not
 *   evidence for the path test.** No clause of that rule is true of BOTH texts here — entry [2]'s
 *   `^(?![^\n]*(…retention…))` is true of the code view and false of the line — so the conjunction
 *   alone would save it, and that was measured rather than argued: with the path test built out
 *   entirely (`if (false)`, every line taking path B) this line is still a candidate and the
 *   assertion on it still passes.
 *
 * WHAT THE PATH TEST IS LOAD-BEARING FOR is the other population — the candidates a COMMENT raised,
 * where the code view is blank or has lost the match and the rule's own comment-line clause has to
 * be allowed to read the comment it was written for. With the path test built out, three assertions
 * go red at once: a JSX comment wrapping an `<iframe src="…youtube…" />` (eu-consent-007, its own
 * fixtures/ok.tsx:57), `base_url: / # "http://example.com/location"` (baseline-003) and
 * `// we never infer ethnicity from profile.ethnicity` (ai-prohibited-003) all become candidates,
 * because on path B a clause that is true of the raw comment and false of the blank code view can
 * no longer cancel anything. Each branch is load-bearing; they are load-bearing for different lines.
 *
 * Measured over the 94 corpus trees on 2026-08-15
 * (464,154 files, 64,455,848 lines): substitution would move 180,228 candidates to 189,582 — 9,354
 * added, almost all of them lines whose evidence was in a comment all along — while losing the two
 * above. This design moves 180,228 to 180,230 and loses none. With the
 * conjunction, the set of clauses that cancel a line is a SUBSET of the set that cancels it today,
 * on both branches and whatever a clause contains, so this change can only add candidates and can
 * never remove one.
 *
 * Exported because a tool attributes drops to clauses and must give the same answer
 * as the engine. Never keep a second copy of anything two places must agree on. It
 * composes per clause — the branch test reads only `match`, `text` and `code` — so calling it with a
 * one-clause list, once per clause, is exactly the engine's own decision split up.
 */
export function disqualifiedByMatchWithout(
  match: RegExp[],
  matchWithout: RegExp[],
  text: string,
  code: string,
  // OPTIONAL AND TRAILING so that the one external caller — a tool — keeps the
  // four-argument call it has, and so that nothing about this function's decision depends on them.
  // They name the rule and the site for `assertSingleLineSubject` and are read by nothing else;
  // omitting them still asserts, and still says which reading, only not which rule.
  ruleId = "(rule not named by caller)",
  reading: MatchSubjectReading = "raw",
): boolean {
  // This function tests `match` on path A's second disjunct and on path B, so the property holds
  // here too. Above the early return rather than below it: a rule with no `match_without` still
  // hands its subjects in, and the assertion is about what a caller MAY hand a `match` clause.
  assertSingleLineSubject(reading, ruleId, text, code);
  // Nothing to test. 22 of the 56 rules in the bundle declare no `match_without` at all, and for
  // them both branches below return `[].some(...)` — false — after paying for the `match` sweep
  // that decides which branch to return it from. At exactly this length the early return is
  // behaviour-identical, and the boundary is the whole of the point: `length < 2` here would be a
  // real defect rather than an optimisation, because a rule with ONE clause would then take the
  // raw-line test unconditionally, which is the pre-2026-08-15 behaviour this function exists to
  // remove — and 7 of the 34 rules that declare clauses declare exactly one. A13 is the assertion
  // that separates the two, on a one-clause rule (eu-special-categories-001).
  if (matchWithout.length === 0) return false;
  // PATH A — TWO POPULATIONS, and they are different cases that happen to want the same answer:
  //
  //   (a) `code === text` — nothing on this line was blanked. This is the ORDINARY line, 95.0%
  //       of the corpus lines a rule's `match` hits: there is no comment on it at all, so nothing
  //       about comments applies to it and today's test on today's text has to hold verbatim.
  //       `const raceCondition = profile.ethnicity;` is cancelled by ai-prohibited-003's own
  //       homonym clause before this change and after it (A14). Written as a short-circuit rather
  //       than derived, and INERT: when `code === text`, path B's `re.test(text) && re.test(code)`
  //       IS path A's `re.test(text)`, so deleting this disjunct would change no answer anywhere.
  //       It is a performance guard over the common case, not a behaviour — and reading it as a
  //       behaviour is what makes `if (code === text) return false;` look like a faithful edit
  //       (X11), which it is not: 83.1% of all cancellations on this corpus happen on these lines,
  //       and that edit deletes every one of them.
  //       The same degeneration, not this disjunct, is why the change is a no-op wherever the
  //       stripper is blind — `<%#`, `{{--`, `{{!`, `{{/*`, `{#`, `{*`, `;`, `%`, and every format
  //       classified `none` (`.json`, `.txt`, `.pug`, a Dockerfile's trailing `#`) — because there
  //       `code === text` on every line and both branches agree.
  //
  //   (b) the match no longer fires on what survived — the candidate is COMMENT-RAISED. Reading the
  //       rest of the same comment to disqualify it is consistent rather than layer-2 judgement,
  //       and this is the half that keeps every comment-line clause in the bundle working exactly
  //       as it does today (A3, A4, A5).
  if (code === text || !match.some((re) => re.test(code))) {
    return matchWithout.some((re) => re.test(text));
  }
  // PATH B — the evidence is in the code. A clause disqualifies the line only if the clause is true
  // of the CODE as well as of the line. Requiring BOTH is what makes this change unable to remove a
  // candidate that exists today. Reached by 473 of the 235,869 corpus match-hit lines
  // (0.20%): this branch is where the whole of the change lives, and it is small.
  return matchWithout.some((re) => re.test(text) && re.test(code));
}

/**
 * THE FIELDS `collapseNestedDuplicates` READS, AND NOTHING ELSE.
 *
 * `RawMatch` satisfies it, and so does the throw-away shape `confirmedInRecord` builds out of a
 * `FileRecord`'s `WireMatch`es. The collapse is written against this interface rather than against
 * `RawMatch` for one reason, and it is the project's reason: the progress stream (step 5)
 * must decide the same collapse the merge decides, and a second implementation of it — one for the
 * document, one for the screen — is the second copy that is forbidden. Widening the parameter costs
 * nothing at run time (the function's body is unchanged) and makes the ONE implementation callable
 * from both.
 */
interface CollapsibleCandidate {
  rule: { id: string };
  line: number;
  joinedFrom?: JoinedFrom;
  firedClauses?: number[];
  absorbedOpenings?: number[];
}

/**
 * ONE CONSTRUCT REPORTED AT SEVERAL DEPTHS, COLLAPSED ONTO THE REPORTS INSIDE IT THAT READ THE SAME
 * THING — the joined view's one subtraction, and the only place in this engine where a candidate is
 * removed for being a duplicate rather than for being suppressed.
 *
 * ## The rule, exactly
 *
 * A fold-derived candidate (one that carries `joinedFrom`) is NOT reported when, for the same rule
 * and the same file, EVERY clause it fired is also fired by candidates that lie inside its own fold
 * span. Nothing else is collapsed:
 *
 *   - a candidate with no `joinedFrom` is never dropped, whatever contains it;
 *   - a candidate whose span contains nothing of its rule's is never dropped;
 *   - a candidate that fires one clause NOTHING inside it fires is never dropped, and that clause is
 *     the whole reason the condition is written on clauses rather than on containment.
 *
 * ## Why the clause condition and not containment alone
 *
 * Containment alone removes 116 of 175 fold-derived candidates on sixteen corpus trees and loses six
 * readings that exist nowhere else in their files. The six are one shape: `baseline-005`'s clause
 * (13) requires a cookie-family word ON THE LINE, and at the ENCLOSING construct the cookie word —
 * the function's name, or the `cookie:` key — joins the `secure: <expr>` line, so the outer fold
 * reads something the inner one cannot. One real cookie-format module is the readable
 * instance: outer clauses {13, 16}, inner {16}. Dropping it would be a subtraction, which this project
 * forbids. The clause condition keeps all six BY THE CONDITION ITSELF and not by an exception list,
 * and removes 110 of 175 with no clause reading lost anywhere.
 *
 * ## Why this is de-duplication and not narrowing
 *
 * The line is "is this the thing at all?" against "is this probably a false positive?". This
 * asks neither. It asks "is this the same thing, already reported?", and answers it structurally:
 * the same rule, the same file, contained spans, the same clauses. No construct becomes unreported,
 * no clause reading becomes unreported, and no line number moves — the surviving report is smaller,
 * closer to the construct and therefore more checkable than the one that went. The engine's fixture
 * harness already makes this statement where it costs a fixture author (test-rules.ts, the
 * joined-construct exemption of 2026-09-06); this makes it where the user pays for it.
 *
 * ## Where it is still wrong, stated rather than left to be found
 *
 * Two genuinely different constructs, one inside the other, firing the SAME clause for different
 * reasons: a cookie literal inside a function that satisfies the same clause on its own account.
 * The condition cannot tell those apart and drops the outer one. The corpus gives no instance — all
 * 110 were read as one construct at several depths — but the shape is real, and it is why every
 * dropped candidate is counted (`joined_outer_duplicates_dropped`) and its opening line kept
 * (`also_opens_at`) rather than merely omitted.
 *
 * A SECOND SHAPE IS GUARDED RATHER THAN LEFT TO THE SUBSET TEST: a candidate whose per-clause
 * reading is EMPTY, which `matchFires`' two `some`s can produce. `[].every(...)` is true, so such a
 * candidate would be dropped on containment alone. See the guard below.
 *
 * ## Two properties this depends on, both proved rather than assumed
 *
 * **The condition is evaluated against the candidate set as it arrives, not against the survivors,
 * and that loses nothing.** If an inner candidate B is itself dropped, B's clauses are covered by
 * candidates inside B's span, all of which are inside the outer's span too; spans strictly shrink,
 * so the recursion terminates. The union of the SURVIVORS' clauses inside a span therefore equals
 * the union of ALL of them, and a chain A ⊃ B ⊃ C collapses onto C with every reading intact.
 *
 * **Nothing can annihilate itself or its equal.** A fold-derived candidate's span starts at its own
 * line, and containment between two fold spans is required to be STRICT on at least one side, so
 * two candidates cannot each be inside the other. A no-span candidate cannot sit on a fold-derived
 * candidate's own opening line either: the fold branch runs only where the plain reading did NOT
 * match, and the structural reading refuses a line the line reading already reported.
 *
 * @param candidates the surviving candidates of ONE file, in the order the walk produced them,
 *   after held gates and guards have taken theirs. Mutated only through `absorbedOpenings`.
 * @returns the candidates to drop. Empty for every file of every bundle in which no rule declares
 *   the joined view.
 */
function collapseNestedDuplicates<T extends CollapsibleCandidate>(candidates: T[]): Set<T> {
  const dropped = new Set<T>();
  // Cheapest possible exit for the 113 rules that declare nothing, taken before anything is
  // allocated: no fold, no duplicate, and the file's candidate array is handed straight on.
  let anyFold = false;
  for (const m of candidates) {
    if (m.joinedFrom) {
      anyFold = true;
      break;
    }
  }
  if (!anyFold) return dropped;
  // Per RULE, because the whole condition is "the same rule already reports this construct". A
  // candidate of a different rule inside the span is a different question with a different answer
  // and must never collapse anything.
  const byRule = new Map<string, T[]>();
  for (const m of candidates) {
    const g = byRule.get(m.rule.id);
    if (g) g.push(m);
    else byRule.set(m.rule.id, [m]);
  }
  for (const group of byRule.values()) {
    for (const outer of group) {
      const span = outer.joinedFrom;
      if (!span) continue;
      // `undefined` is not `[]`: a candidate whose clause set was never computed is a candidate
      // nothing can be proved about, and it is kept. This cannot arise for a declaring rule — the
      // push records the set for every one of its candidates — and it is written so that a future
      // reading that raises a candidate without one degrades to today's behaviour instead of
      // silently dropping it.
      if (outer.firedClauses === undefined) continue;
      // ...AND AN EMPTY SET IS NOT A COVERED SET. `matchFires` is two `some`s, so it can be true
      // where clause X fires on the raw text, clause Y on the comment-blanked text and no clause on
      // both — and this function's per-clause reading then returns `[]` for a candidate that
      // legitimately exists. Without this line `every` is VACUOUSLY TRUE and the candidate is
      // dropped as soon as anything of its rule lies inside its span, which is option (b) of the
      // design annex — containment alone, the rejected reading — applied to exactly the
      // candidate nobody can say what was read at. 0 of the 51 removals on the twelve trees is in
      // this state, so it costs nothing measured; the state is constructible, which is why the
      // guard is here rather than a sentence promising it cannot happen.
      if (outer.firedClauses.length === 0) continue;
      const inside = group.filter((x) => x !== outer && containedIn(x, span));
      if (inside.length === 0) continue;
      const covered = new Set<number>();
      // A candidate with no clause set contributes nothing rather than everything — a structural
      // candidate fires no `match` clause at all, so it can corroborate a construct's presence but
      // can never stand in for a clause reading.
      for (const x of inside) for (const k of x.firedClauses ?? []) covered.add(k);
      if (!outer.firedClauses.every((k) => covered.has(k))) continue;
      dropped.add(outer);
    }
  }
  // The absorbing report, chosen only once every drop is known: the FIRST surviving candidate in
  // file order that lies inside the collapsed span. One and not all of them, so that the opening
  // lines named across a whole document are exactly the candidates dropped, one each — an identity
  // a reader can check against `stats.joined_outer_duplicates_dropped` and the gate asserts.
  //
  // A survivor always exists where a drop happened, by the termination argument above; if one ever
  // did not, the drop is undone rather than recorded nowhere, because a candidate that disappears
  // with no surviving report is exactly the miss this mechanism promises never to create.
  for (const group of byRule.values()) {
    for (const outer of group) {
      if (!dropped.has(outer)) continue;
      const span = outer.joinedFrom as JoinedFrom;
      const host = group
        .filter((x) => x !== outer && !dropped.has(x) && containedIn(x, span))
        .sort((a, b) => a.line - b.line)[0];
      if (host === undefined) {
        dropped.delete(outer);
        continue;
      }
      if (host.absorbedOpenings) host.absorbedOpenings.push(outer.line);
      else host.absorbedOpenings = [outer.line];
    }
  }
  for (const group of byRule.values()) {
    for (const m of group) m.absorbedOpenings?.sort((a, b) => a - b);
  }
  return dropped;
}

/**
 * Is this candidate's own extent inside `span`?
 *
 * A fold-derived candidate is compared by its SPAN and must be strictly smaller on at least one
 * side, so two candidates folded from the same span never collapse each other. A candidate with no
 * span — one the plain line reading, an alias or value substitution, or the structural reading
 * raised — is compared by its LINE, which is the only extent it has.
 */
function containedIn(m: CollapsibleCandidate, span: JoinedFrom): boolean {
  const own = m.joinedFrom;
  if (!own) return m.line >= span.start_line && m.line <= span.end_line;
  return (
    own.start_line >= span.start_line &&
    own.end_line <= span.end_line &&
    (own.start_line > span.start_line || own.end_line < span.end_line)
  );
}

/**
 * A candidate as it crosses the `FileRecord` boundary — same fields as `RawMatch` minus the
 * `Rule` object and the `file` string, both implied by the `FileRecord` that carries it.
 *
 * `RawMatch.rule` is the WHOLE `Rule` object, and a wire type carrying one per match would copy
 * every rule's `legal_basis` quotes once per match a worker (step 3c) sends home — measured at
 * 13,011 copies on a large Node CMS for one rule alone. `ruleId` crosses instead, and `mergeShards` re-binds
 * the object from `compiled`, which is what a single sequential walk already holds: every match of
 * one rule shares one `Rule` instance there too.
 *
 * `corroboratedFrom` is NEVER set here: it is written in phase 2, in `mergeShards`.
 * `absorbedOpenings` is NEVER set here: it is written by `collapseNestedDuplicates`, in `mergeShards`.
 */
interface WireMatch {
  ruleId: string;
  line: number; // 1-based
  lineText: string;
  endLine?: number;
  hops?: ValueHop[];
  joinedFrom?: JoinedFrom;
  firedClauses?: number[]; // engine-internal; collapseNestedDuplicates needs it
  /**
   * Engine-internal, never serialised, and never `false`: whether this candidate is in the subject
   * of its rule's corroboration decision (`RawMatch.gateSubject`). It crosses the boundary because
   * the decision is taken where the line's text still exists and is USED in phase 2, in
   * `mergeShards`, which holds only records. `corroboratedInProject` is not here for the opposite
   * reason: phase 2 WRITES it, so it never has to cross.
   */
  gateSubject?: true;
  /**
   * The kind facts, where the run computes them. They cross the boundary because `scan.ts` copies
   * them onto the location, and a worker that kept them to itself would write a document whose
   * census depended on which thread opened which file — which is the one thing `--jobs` may not
   * decide. Four short strings per candidate; the whole `Rule` object is what a wire type must not
   * carry, and this is not that.
   */
  kindFacts?: KindFacts;
  /** `RawMatch.kindRedactions`, crossing for the reason `kindFacts` does: `scan.ts` reads them. */
  kindRedactions?: CredentialTarget[];
}

/** `RawMatch` reduced to what a `FileRecord` carries — see `WireMatch` for why. */
function toWireMatch(m: RawMatch): WireMatch {
  return {
    ruleId: m.rule.id,
    line: m.line,
    lineText: m.lineText,
    ...(m.endLine !== undefined ? { endLine: m.endLine } : {}),
    ...(m.hops ? { hops: m.hops } : {}),
    ...(m.joinedFrom ? { joinedFrom: m.joinedFrom } : {}),
    ...(m.firedClauses ? { firedClauses: m.firedClauses } : {}),
    ...(m.gateSubject ? { gateSubject: true as const } : {}),
    ...(m.kindFacts ? { kindFacts: m.kindFacts } : {}),
    ...(m.kindRedactions ? { kindRedactions: m.kindRedactions } : {}),
  };
}

/**
 * Everything one file contributed to a scan — the unit `scanFile` returns and `mergeShards`
 * combines into the `EngineResult` a single sequential walk used to build directly out of shared,
 * whole-scan state (`guardEvidence`, `scopeCorroborators`, `heldGates`, the counters,
 * `structural`). Nothing here depends on any other file having been scanned, or on any order —
 * see `mergeShards` for the handful of places that need one more step, a first-wins pick, a union
 * or a sum, to become the document one sequential walk already produced.
 *
 * `index` is `file`'s position in the file list `runBuiltin` was handed — THE ONLY ORDERING
 * AUTHORITY `mergeShards` reads. The sequential engine's own output depends on the WALK order and
 * nothing else (`scan.ts` says so: `walkTarget` pushes in directory traversal order, which can
 * differ between machines for the same tree) — never on which file happened to be scanned first,
 * which is not yet a distinct concept while every file is scanned in one thread, in walk order.
 */
export interface FileRecord {
  index: number;
  file: string;
  /** `false` for a file this engine opened and then declined to read to any rule — see `notRead`. */
  scanned: boolean;
  /** Set only when `scanned` is `false`: why, and the measurement the refusal was taken on. */
  notRead?: NotReadFile;
  /** Set only when this file was read with at least one line blanked by the minification ceiling. */
  partiallyRead?: PartiallyReadFile;
  /**
   * Set only when the file's bytes were not plain UTF-8 (project-read.ts `decodeSource`): `utf-16`, decoded from its
   * byte-order mark and read whole; `not-utf-8`, read with U+FFFD in place of the bytes that are not UTF-8, so a pattern
   * written in non-ASCII text cannot match there.
   */
  readAs?: "utf-16" | "not-utf-8";
  /** This file's own surviving candidates, in the exact order `scanFile` produced them. */
  candidates: WireMatch[];
  /** Rule ids whose `guard_missing` matched somewhere in this file. */
  guardHits: string[];
  /** Guard evidence THIS FILE produced, one entry per rule whose guard matched here. */
  guardEvidence: { ruleId: string; pattern: string; line: number }[];
  /** (rule, scope) corroborations THIS FILE's own text opened. */
  scopeCorroborators: { scopeKey: string; record: CorroboratedFrom }[];
  /**
   * Gate records written INLINE by this file, in compiled-rule order — segment A of
   * `EngineResult.corroborationSuppressed`; see `mergeShards` for segment B.
   */
  corroborationSuppressed: CorroborationSuppression[];
  /** Gates this file HELD for a wider scope, in compiled-rule order. */
  heldGates: {
    ruleId: string;
    scopeKey: string;
    clausesFailed: number;
    gateViewsTested: number;
    /** Indices into `candidates` above, never object references — see `WireMatch`. */
    candidateIndices: number[];
    /** How many of `candidates` the structural reading produced. See where it is incremented. */
    structuralAdded: number;
  }[];
  /**
   * Per-file counter deltas. Every one of these is a pure sum (or, for `structural`, a sum plus the
   * `grammarsUnavailable` merge) in `mergeShards`.
   */
  counters: {
    commentSyntaxUnregistered: number;
    /** The declared comment forms this file's guard view holds as code (strip-comments.ts). */
    commentFormsReadAsCode: string[];
    derivedViewsBuilt: number;
    derivedViewsFailed: number;
    joinedViewsBuilt: number;
    joinedViewsNotApplicable: number;
    joinedConstructsRefused: number;
    /** (rule id, 1) for every rule this file was on the declared surface of. */
    filesOnSurface: [string, number][];
    /** `StructuralCounters`, minus its `grammarsUnavailable` MAP, which crosses as a tuple array —
     * see `scanFile`'s return and `mergeShards`, which both read either shape identically via
     * `for...of`. */
    structural: {
      treesBuilt: number;
      noAdapter: number;
      grammarUnavailable: number;
      parseFailed: number;
      skippedTooLarge: number;
      findingsOutOfRange: number;
      skippedPartialSource: number;
      candidatesAdded: number;
      candidatesDuplicate: number;
      candidatesDroppedByMatchWithout: number;
      grammarsUnavailable: [StructuralLanguage, { error: string; files: number }][];
    };
  };
}

/** What one shard of the walk produced. Records may arrive in any order — see `mergeShards`. */
export interface ShardResult {
  records: FileRecord[];
}

/** A `FileRecord` for a file `scanFile` never read to any rule — see `EngineResult.filesNotRead`. */
function notReadRecord(index: number, file: string, notRead: NotReadFile): FileRecord {
  return {
    index,
    file,
    scanned: false,
    notRead,
    candidates: [],
    guardHits: [],
    guardEvidence: [],
    scopeCorroborators: [],
    corroborationSuppressed: [],
    heldGates: [],
    counters: {
      commentSyntaxUnregistered: 0,
      commentFormsReadAsCode: [],
      derivedViewsBuilt: 0,
      derivedViewsFailed: 0,
      joinedViewsBuilt: 0,
      joinedViewsNotApplicable: 0,
      joinedConstructsRefused: 0,
      filesOnSurface: [],
      structural: { ...newCounters(), grammarsUnavailable: [] },
    },
  };
}

/**
 * THE PER-FILE WALL-CLOCK BUDGET, in milliseconds. **60 seconds**,
 * replacing the 15 seconds decided on 2026-09-15
 * — the value moved on a measurement taken while step 4 was being built,
 * and the measurement is below.
 *
 * **What it is for.** One file can cost more than the whole rest of a tree. Measured on the step-1
 * engine (`measurements.md` §5b): a 24,999-byte file of five lines, each 4,998 spaces and an `X`,
 * costs 21,014 ms — 42x the per-byte cost of ordinary source, and **4.2 seconds per LINE**. Without
 * a budget such a file is not slow, it is a scan that never finishes and says nothing: every later
 * file's candidates are lost to whatever kills the process, with no record that anything was
 * skipped. That is a forbidden state, one unit further in than the minification ceiling,
 * and this is the same answer the owner gave for that one on 2026-08-25 — do not remove the skip,
 * report it.
 *
 * **WHY 60 AND NOT 15, AND THE THREE NUMBERS THE CHANGE RESTS ON**:
 *
 *   - **A REAL FILE COSTS 28.4 s.** One large tree carries a 612,606-byte, 16,902-line vendored
 *     debug build of a third-party editor that neither the
 *     minification ceiling nor the vendored-code read scope catches. At 15 s it was stopped after 76
 *     of 117 rules and the document lost 14 candidate locations. The 2026-09-15 premise for 15 s —
 *     "five times the slowest real file measured anywhere in this lane, 2,992 ms" — was taken on
 *     two trees, and a third was never measured per file.
 *   - **The worst SYNTHETIC file the walker will admit costs ~26 s**: `MAX_FILE_BYTES` is 1,000,000
 *     and pathological lines cost ~26 µs/char, measured 25.8 s for 995 KB.
 *   - **Real source can be denser than that**: one file of a large Node CMS is 46 µs/char, so a full megabyte of the
 *     same material extrapolates to ~46 s. That extrapolation is why 60 rather than 40.
 *
 * So 60 s keeps every real file measured in this corpus whole, with 2.1x margin over the worst of
 * them, and still bounds the thing the budget exists for: a machine several times slower, a rule
 * added later whose pattern backtracks catastrophically, or a run with `--no-prefilter`, where the
 * same 4,999-character line costs 844 ms instead of 131. **It does mean that on THIS machine, with
 * the prefilter on and the bundle as it stands, no file the walker admits reaches the default** —
 * the budget is a ceiling against the future and against slower hardware, not a thing today's corpus
 * touches. A tree that needs longer on one file says so in `coverage_limits`, which is how the
 * number gets corrected by evidence rather than by argument; that is how this one moved.
 */
export const DEFAULT_FILE_BUDGET_MS = 60_000;

/**
 * How many lines pass between two readings of the clock, before the adaptation below shortens it.
 *
 * On ordinary source 64 lines cost about 1.4 ms, so the check is unmeasurable against the ~22 ms/KB
 * the line loop already costs; on the attack file above they cost 270 seconds, which is why the
 * interval ADAPTS rather than staying at 64 (see `scanFile`).
 */
const FILE_BUDGET_CLOCK_LINES = 64;

/**
 * The fraction of the budget a single clock window may take before the interval drops to one line.
 * A window longer than `budget / 8` means this file's lines cost enough that 64 of them could
 * overshoot the budget many times over, so from that point on the clock is read every line.
 */
const FILE_BUDGET_ADAPT_DIVISOR = 8;

/**
 * The fraction of the budget a file may have spent before the interval drops to one line, whatever
 * its lines have cost so far.
 *
 * **MEASURED, AND THE REASON THE WINDOW RULE ABOVE IS NOT ENOUGH ON ITS OWN.** The window rule can
 * only act on a window it has already seen, and per-line cost is a property of the (rule, line)
 * pair, not of the file: on the gate's own planted tree the first 100 rules read all 191 lines in
 * under the budget with every window inside `budget / 8`, and then rule 101's first 64 lines cost
 * 5.0 s together — so the stop landed at 19,952 ms against the 15,000 ms budget in force that day
 * (the default was 15 s until 2026-09-16; the measurement is quoted as it was taken), a 33 %
 * overshoot, with the
 * adaptation firing on the very window that overshot. Half the budget spent is the signal the window
 * rule cannot give: from there the clock is read every line. It costs nothing on an ordinary file,
 * which spends milliseconds and never reaches half of anything, and about 0.4 % on a legitimately
 * slow one (a 3,000-line file at 8 s pays ~350,000 more clock reads, ~30 ms).
 *
 * **THIS SIGNAL IS NOT ON ITS OWN THE BOUND, AND SAYING SO HERE WAS WRONG UNTIL 2026-09-16.** This
 * comment used to end "and the overshoot is one (rule, line)". Independent verification measured the
 * overshoot at up to +74 % of the budget and reproduced it here at
 * +79 %: both signals are evaluated AT A READING, so a file whose cheap rules end just under half the
 * budget, with no window over an eighth of it, runs one more whole 64-line window of the next rule
 * with the clock unread. What bounds the overshoot is `FILE_BUDGET_STRIDE_MARGIN` below, which sizes
 * every window from what the budget has left; this signal is the floor under that sizing and the
 * thing that latches it. See `scanFile`'s budget check for the bound as it now stands.
 */
const FILE_BUDGET_ADAPT_SPENT = 2;

/**
 * How many clock windows' worth of the REMAINING budget a single window may be sized to spend.
 *
 * **THE REPAIR OF 2026-09-16, and the measurement that asked for it.** With a fixed 64-line stride
 * the overshoot was one window of whatever the interrupted rule's lines cost, and that is not a bound
 * at all: measured on one 950 KB file of 190 pathological lines at load 5.2–6.5, stops at +79 %,
 * +60 %, +48 % and +72 % of budgets of 9, 10, 11 and 12 seconds — every one with `lines_read` exactly
 * 64, the fingerprint of a window that ran unmetered. The stride is now
 * `remaining / (perLine × this)`, capped at `FILE_BUDGET_CLOCK_LINES` and floored at 1, where
 * `perLine` is the cost of the window just measured: a window can therefore be sized to spend at most
 * a QUARTER of what is left, so it cannot itself exhaust the budget, and the stride is 1 by the time
 * the remaining budget is under four lines. Re-measured on the same file and the same load after the
 * repair: +0.2 %, +0.3 %, +0.1 % and +0.1 %, i.e. one (rule, line).
 *
 * **4 rather than 1**, which would let a window be sized to spend everything that is left: the
 * estimate is the LAST window's cost and the next window is a different set of lines, so a margin is
 * what absorbs a cost that rises. It is not a proof — a per-line cost that rises sharply inside one
 * window still overshoots by that window, which no clock read less often than every line can prevent,
 * and which the check's own comment states rather than promising away.
 *
 * **It costs nothing on an ordinary file**, where `remaining` is tens of seconds and `perLine` is
 * microseconds: the quotient is in the millions and the cap decides, so the stride is the 64 it always
 * was. Measured on one tree, 1,500 files, `--jobs 1`, the default budget against `--file-budget off`:
 * the difference does not resolve against the run-to-run spread (`followup-2026-09-16.md` §4).
 */
const FILE_BUDGET_STRIDE_MARGIN = 4;

/**
 * How much longer one clock window may be than the window just measured.
 *
 * **THE SECOND HALF OF THE SAME REPAIR, and it exists because the first half alone was measured to
 * fail.** Sizing the next window from the last one's per-line cost is only as good as that cost: the
 * gate's own attack file opens with three ORDINARY lines and continues with 190 pathological ones, so
 * a single probe of line 1 costs microseconds, sizes the next window at the 64-line cap, and the
 * whole window runs unmetered exactly as before — measured on this machine at load 8.4, budgets 10,
 * 11 and 12 seconds: +139 %, +106 % and +100 %, with `lines_read` 65 rather than 64. Doubling is what
 * makes the estimate refresh faster than the window grows: the stride goes 1, 2, 4, 8 … 64, so a cost
 * that appears at any line is seen within twice that many lines.
 *
 * **It costs a handful of clock reads per rule per file** — seven readings to climb from 1 to 64,
 * against the one the fixed stride took — and on an ordinary file that is ~5 extra
 * `performance.now()` calls per (rule, file), tens of nanoseconds each. Measured on one tree
 * (1,500 files, `--jobs 1`, default budget against `--file-budget off`): the difference does not
 * resolve against the run-to-run spread (`followup-2026-09-16.md` §4).
 */
const FILE_BUDGET_STRIDE_GROWTH = 2;

/**
 * How many lines pass before the next reading of the clock, given the window just measured.
 *
 * **EXPORTED AND PURE SO THAT A GATE CAN HOLD THE REPAIR WITHOUT A CLOCK.** The defect this function
 * exists to prevent is only visible through `scanFile` when the machine is busy — reproduced at +79 %
 * of the budget at load 5.2–6.5 and at +10.6 % on an idle box, on the same input at the same budget —
 * so an assertion on `elapsed_ms` catches it on a loaded box and misses it on a quiet one, and a gate
 * that only fires when the box is busy is not a gate. A test case (K) calls this
 * directly with the four numbers instead, which is deterministic, costs no scan, and states each of
 * the three bounds as its own assertion.
 *
 * - `windowLines <= 0` is the first reading of a rule: this rule's per-line cost is not known and the
 *   rule above says nothing about it, so the next reading is the very next line.
 * - `windowLines * FILE_BUDGET_STRIDE_GROWTH` keeps a window from outrunning its own estimate.
 * - `remaining / (perLine * FILE_BUDGET_STRIDE_MARGIN)` keeps a window from spending more than a
 *   quarter of what is left at the cost just measured.
 * - `perLine <= 0` is a window below the clock's resolution — the cap, never the floor, or a file of
 *   empty lines would be metered line by line for nothing.
 *
 * It never returns less than 1 or more than `FILE_BUDGET_CLOCK_LINES`, and it is never consulted once
 * an adaptation signal has latched the stride to 1 (see `scanFile`).
 */
export function nextClockStride(
  windowLines: number,
  windowMs: number,
  elapsed: number,
  fileBudgetMs: number,
): number {
  if (windowLines <= 0) return 1;
  const perLine = windowMs / windowLines;
  const affordable =
    perLine > 0
      ? Math.floor((fileBudgetMs - elapsed) / (perLine * FILE_BUDGET_STRIDE_MARGIN))
      : FILE_BUDGET_CLOCK_LINES;
  return Math.max(1, Math.min(FILE_BUDGET_CLOCK_LINES, windowLines * FILE_BUDGET_STRIDE_GROWTH, affordable));
}

/** A `--file-budget` value this engine cannot act on. `index.ts` turns it into exit 1. */
export class FileBudgetOptionError extends Error {}

/**
 * Resolve `--file-budget <seconds>|off` to the milliseconds `scanFile` counts against.
 *
 * `undefined` — the option was not typed — is the 60-second default, because the option is ON by
 * default. `off` is `Infinity`, which is the pre-budget engine exactly:
 * `elapsed >= Infinity` is false for every reading, and `scanFile` does not even read the clock.
 *
 * Fractions are accepted (`--file-budget 0.5`) and rounded to the millisecond; zero and negative
 * values are refused rather than treated as "off", because a budget of 0 would stop every file
 * before its first line and produce a scan that read nothing while exiting 0 — and `off` is the
 * spelling for meaning off.
 *
 * THE FLOOR IS ONE MILLISECOND, AND IT IS A FLOOR ON THE ROUNDED VALUE (independent verification
 * note F2, 2026-09-16). Refusing the literal `0` was not enough: `--file-budget 0.0004` is a
 * positive number that `Math.round(0.4)` turns into `0`, and that ran — it stopped both files of a
 * two-file tree before their first line, printed `file budget: 0s per file`, exited 0, and wrote
 * `{"reason":"time-budget","budget_ms":0,…}`, a row `evidence-log.schema.json` then rejected as
 * `must be >= 1`. The refusal is on the value that reaches the engine, so no arithmetic downstream
 * can produce a budget the schemas do not describe, and the message names the floor rather than
 * repeating the rule the person already broke.
 */
export function resolveFileBudgetMs(spec: string | undefined): number {
  if (spec === undefined) return DEFAULT_FILE_BUDGET_MS;
  const s = spec.trim().toLowerCase();
  if (s === "off") return Infinity;
  const seconds = Number(s);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new FileBudgetOptionError(
      `--file-budget must be a positive number of seconds or "off", got ${JSON.stringify(spec)}`,
    );
  }
  const ms = Math.round(seconds * 1000);
  if (ms < 1) {
    throw new FileBudgetOptionError(
      `--file-budget ${JSON.stringify(spec)} is ${seconds} second(s), which rounds to a budget of 0 ms. ` +
        `The floor is 0.001 seconds (1 ms): a budget below it stops every file before its first line, ` +
        `so the scan reads nothing while exiting 0. Use "off" to mean no budget.`,
    );
  }
  return ms;
}

/**
 * builtin-regex engine: line-level matching with guard-based suppression.
 * - match: a line matching any pattern becomes a candidate
 * - match_without: cancels the candidate if the same line also matches (inline exemption). Which
 *   text a clause is judged against is `disqualifiedByMatchWithout` above: a comment may not cancel
 *   a candidate the code raised.
 * - also_in_file: the candidate is suppressed unless the pattern appears somewhere in the same file,
 *   and every such suppression is RECORDED (see the gate below and `CorroborationSuppression`)
 * - guard_missing: the candidate is suppressed if the guard appears within the scope
 *   (project-wide or single file) — i.e. the required control is already present
 *
 * Two opt-in derived views extend what a rule that asks for them can see (see derive.ts). Both are
 * strictly additive — the original test runs first in every case — and neither can move a reported
 * line number:
 * - detector.gate_view: ["yaml-anchors"] — `also_in_file` is additionally tested against the YAML
 *   document with anchors, aliases and merge keys resolved.
 * - detector.gate_view: ["comments-visible"] — `also_in_file` is additionally tested against the
 *   file's own text with NOTHING blanked, which is the reading every gate had before 2026-07-27.
 *   The 2026-07-27 default is unchanged for every rule including this one: the blanked text is
 *   tested first and this is a second string consulted only after that gate has shut. Admissible
 *   because `also_in_file` is POSITIVE — a comment that satisfies it adds a candidate the
 *   adjudicator reads — and for that reason nothing analogous may ever reach `guard_missing`, which
 *   is negative. See derive.ts.
 * - detector.gate_scope: "directory" | "project" — `also_in_file` is additionally satisfied by the
 *   own text of another file in that scope the rule is allowed to read. The file's own result is
 *   taken first and its `true` stands, so this can only open a gate that was shut; the decision is
 *   deferred to after the walk, and a candidate it releases carries the corroborating file and line.
 * - detector.resolve_import_aliases: true — `match` is additionally tested against each line with
 *   its import aliases resolved to the modules they name; the candidate still reports the original
 *   line and quotes the original text.
 * - detector.resolve_local_values: true — `match` is additionally tested against each line with the
 *   names this file defines as string literals replaced by those literals and adjacent literals
 *   folded, so a rule that requires a literal at the call site can find one that is named a few
 *   lines away. ONE HOP, SAME FILE: a definition whose right-hand side is another name binds
 *   nothing. The candidate still reports the original line and quotes the original text, and it
 *   carries the definition site it was reached through.
 * - detector.join_bracketed_constructs: true — `match` is additionally tested against the whole of
 *   the bracket-balanced construct that OPENS on each line, folded onto one string, so a struct
 *   literal or an options object written over several physical lines is matched as one text. The
 *   candidate reports the line the construct opens on, quotes that line's original text, and carries
 *   the span it was folded from. A trailing operator and a backslash continuation are not folded.
 *
 * A fourth opt-in reads the file's PARSE TREE (see structural/), under the same constraints:
 * - detector.structural_checks: [...] — the file is additionally read as a document, and named check
 *   sets may raise candidates the line patterns cannot express. It runs AFTER the line loop for the
 *   same rule, it appends and never removes, every line it reports is read back out of the original
 *   text, and every way the parse can fail falls back to the line reading and is counted.
 */
function scanFile(
  compiled: CompiledRule[],
  targetRoot: string,
  file: string,
  index: number,
  prefilter: PrefilterScan | null,
  /**
   * THE PER-FILE WALL-CLOCK BUDGET for this file, in milliseconds, or `Infinity` for no budget —
   * see `DEFAULT_FILE_BUDGET_MS` for what it is for and `resolveFileBudgetMs` for where the value
   * comes from. It is per FILE and per THREAD, so it composes with `--jobs` unchanged: each worker
   * runs this function and each file gets its own clock.
   */
  fileBudgetMs: number,
  /**
   * Whether every candidate this file raises carries its kind facts (`kindFactsForCandidate`).
   *
   * REQUIRED, not defaulted, and required for the reason `scanShardOf`'s budget is: the two halves
   * of one scan — `runBuiltin` on the main thread and `worker-entry.ts` in a pool — must not be able
   * to disagree by one of them forgetting the argument. A worker that computed no facts while the
   * main thread computed them would write a document whose census depends on `--jobs`, which is the
   * one thing `test:jobs-determinism` and `test:kind-census` exist to refuse.
   */
  kindCensus: boolean,
  // Optional and last, and `undefined` on every shipped path — see `EngineTestSeams`.
  seams?: EngineTestSeams,
  /**
   * The credential redaction step (`CompiledScan.credentials`), or `null` for none. Optional because
   * `seams` above it is; the two scanning paths reach this only through `scanShardOf`, which always
   * passes the value its `CompiledScan` holds, so the two halves of one scan cannot disagree on it.
   */
  credentials: CredentialRedaction | null = null,
): FileRecord {
  // Read ONCE, here, and never per line: `Number.isFinite` is the whole of the off switch, and with
  // the budget off not one `performance.now()` is called anywhere below.
  const budgetOn = Number.isFinite(fileBudgetMs);
  // THE CLOCK STARTS BEFORE THE READ, deliberately. The budget is "what this file cost this scan",
  // and a file on a network mount that takes 40 seconds to open has cost the scan 40 seconds
  // whether or not a regular expression ever ran on it.
  let fileStartedAt = budgetOn ? performance.now() : 0;
  /**
   * THE WHOLE-FILE TESTS ANSWER TO THE BUDGET TOO. A rule's `also_in_file` clauses are
   * tested against the whole file text, and again against each derived view it declares, BEFORE its
   * line loop reads the clock, so until 2026-10-20 one rule's gate could spend any amount of time
   * unmetered: measured on a 1,000,000-byte file of hostile 4,990-character lines (the clause-cost
   * ledger's own texts), eu-retention-001's gate took a file with a 5-second budget to 22.5 s before
   * the next reading. The clock is now read before each such test and before each view is built, and
   * a spent budget stops the file there, recorded exactly as a stop at line 0 of this rule. What can
   * still overshoot is ONE whole-file test, which no clock outside the regular-expression engine can
   * interrupt. Returns the elapsed milliseconds when the budget is spent, else -1.
   *
   * EVERY PASS OVER THE FILE'S CONTENT READS IT, not only the gate. Before 2026-10-20 the
   * passes this function runs before - the long-line ceiling, the comment blanking, the comment-form
   * count, the two line views, the prefilter's vocabulary pass - and the per-rule ones the line loop
   * does not cover - the prefilter's sampled self-check, the scope corroborator's whole-file match, the
   * alias, value and joined tables, the structural parse and its checks, the `guard_missing` pass - read
   * no clock at all. Each now reads it first (`spentAt()` at each site), and a gate case fails when a pass over the content does not.
   */
  const spentAt = (): number => {
    if (!budgetOn) return -1;
    const elapsed = performance.now() - fileStartedAt;
    return elapsed >= fileBudgetMs ? elapsed : -1;
  };
  /**
   * The record of a file whose budget was spent before its first rule read a line: `files_not_read`
   * with reason `time-budget`, exactly as a stop at line 0 of the first rule is recorded below.
   */
  const spentBeforeRules = (elapsed: number): FileRecord =>
    notReadRecord(index, file, { file, reason: "time-budget", budget_ms: Math.round(fileBudgetMs), elapsed_ms: Math.round(elapsed) });
  let content: string;
  let readAs: FileRecord["readAs"];
  try {
    const decoded = decodeSource(readRegularFile(join(targetRoot, file)));
    content = decoded.text;
    readAs = decoded.encoding !== "utf-8" ? "utf-16" : decoded.whole ? undefined : "not-utf-8";
  } catch (e) {
    // Named, not only counted. A file that vanished between the walk and the read, or that the
    // process may not open, produced exactly the same output as a file full of nothing until
    // 2026-08-25 — one increment of a counter that also carries every walker skip.
    return notReadRecord(index, file, {
      file,
      reason: "unreadable",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
  // The minification skip. It stays — collapsed build output is not source a team can remediate,
  // and matches inside a 900 KB line cannot be reviewed — but it is a PROXY for build output
  // (walk.ts), and from 2026-08-25 every file it drops is named in the output with the
  // measurement it was judged on. Owner ruling, 2026-08-25: do not remove the skip, report it.
  //
  // FROM 2026-09-07 THE UNIT IT IS APPLIED IN IS THE LINE.
  // Each
  // over-long line is replaced by the empty string and the rest of the file is read exactly as
  // any other file is read, so a collapsed line still reaches no rule, no quote and no
  // adjudicator — the whole of the 2026-08-25 ruling — while the 2,478 ordinary lines beside it
  // are no longer refused with it. One real defaults file, about 2,500 lines whose subject IS
  // retention configuration, was invisible to every rule for line 1304.
  //
  // A FILE WHOSE EVERY LINE WENT IS STILL `files_not_read`, with the same reason and the same
  // fields, so no existing consumer changes: that is the real build output the ceiling exists
  // for, 396 of the 1,151 files the ceiling touched across fifteen corpus trees, and a per-line
  // skip recovers nothing at all from it. `blankLongLines` measures the longest line once and
  // hands it here, so the number the reader sees is still the number the decision was taken on.
  let preSpent = spentAt();
  if (preSpent >= 0) return spentBeforeRules(preSpent);
  const reduced = blankLongLines(content);
  // Read after the two branches below by everything that must know the text is not the file:
  // the `yaml-anchors` view and the structural reading, both refused on it. Every LINE-LOCAL
  // reading needs no such flag, because a blanked line is decided as the empty line it now is.
  const partiallyRead = reduced.blanked.length > 0;
  let partiallyReadRecord: PartiallyReadFile | undefined;
  if (partiallyRead) {
    if (reduced.text.trim() === "") {
      return notReadRecord(index, file, {
        file,
        reason: "long-line",
        longest_line: reduced.longest,
        threshold: MINIFIED_LINE_LIMIT,
      });
    }
    // Named, not only counted, for the reason `files_not_read` itself exists: a file whose
    // content was reduced and which says nothing about the reduction is the silence of
    // 2026-08-25 in a new place. Every blanked line is named with its length.
    partiallyReadRecord = {
      file,
      threshold: MINIFIED_LINE_LIMIT,
      lines: reduced.blanked,
    };
    content = reduced.text;
  }
  // Per-file locals replacing `runBuiltin`'s former whole-scan accumulators of the same
  // purpose — see `FileRecord` and `mergeShards` for how each is reassembled into the document
  // a single sequential walk used to build directly. Declared here, after the two early returns
  // above, because neither skip case touches any of them: a file this engine never reads to any
  // rule contributes the all-zero, all-empty record `notReadRecord` builds, never a partial one
  // of these.
  /**
   * Guard evidence THIS FILE produced, one entry per rule whose guard matched here, first clause
   * in declared order. Every qualifying file computes its own now — see `mergeShards` for why
   * only one of them, the smallest file index per rule, survives into the document.
   */
  const guardEvidence: FileRecord["guardEvidence"] = [];
  /**
   * (rule, scope) corroborations THIS FILE's own text opened. Every qualifying file computes its
   * own now — see `mergeShards` for why only one of them, the smallest file index per (rule,
   * scope) key, survives into the document.
   */
  const scopeCorroborators: FileRecord["scopeCorroborators"] = [];
  /**
   * Gate records written INLINE by this file, in compiled-rule order — segment A of
   * `EngineResult.corroborationSuppressed`. See `mergeShards` for segment B, decided after
   * every file has been scanned, and for why segment A always precedes it wholesale.
   */
  const corroborationSuppressed: CorroborationSuppression[] = [];
  /**
   * This file's own gates HELD for a wider scope, in compiled-rule order — resolved by
   * `mergeShards` after every file has been scanned. The shape is `guard_missing`'s, not new
   * machinery: that mechanism has been deciding after the walk since the first scan, for the same
   * reason ("a project-scoped guard may live in a file that is walked long after the candidate
   * was matched"). Each entry owns the very `RawMatch` objects that are already sitting in
   * `candidates` above, in their own place, so releasing one costs a field write and removing one
   * costs a set membership — no candidate is ever moved, re-created or re-ordered, and no line
   * number can change.
   */
  const heldGates: FileRecord["heldGates"] = [];
  // Files this engine read WHOLE and whose comments it therefore read as CODE, because
  // `strip-comments.ts` has no comment syntax registered for their extension. `syntaxFor` answers
  // `null` for exactly that state and `"none"` for a format that genuinely has no comment form
  // (`.json`, `.txt`, `.pug`), which is a different fact and is not counted here.
  //
  // Counted because it is the one coverage hole that points the other way: every other counter in
  // this function sizes something that was NOT read, and this sizes something read too generously —
  // a maintainer's note saying "we do not delete anything" offered to 117 rules as though the
  // product executed it. Both are holes and both are invisible until somebody counts them.
  let commentSyntaxUnregistered = 0;
  let derivedViewsBuilt = 0;
  let derivedViewsFailed = 0;
  let joinedViewsBuilt = 0;
  let joinedViewsNotApplicable = 0;
  let joinedConstructsRefused = 0;
  // Seeded empty rather than from `compiled`: unlike the merge's own `filesOnSurface`, which must
  // say 0 for a rule this file never reached, this array carries only the rules this FILE put on
  // its own surface — `mergeShards` is what seeds every rule at 0 before adding these deltas in.
  const filesOnSurface: FileRecord["counters"]["filesOnSurface"] = [];
  const structural = newCounters();
  // Guards and corroboration are evaluated against content with comments blanked out. A
  // maintainer writing "// TODO: we have no deletion flow" must not be read as evidence that the
  // flow exists — demonstrated on four separate rules on 2026-07-27, after the defect had already
  // been recorded and written into every authoring brief. See strip-comments.ts for the cases.
  // FROM 2026-08-19 THE MATCH SIDE READS IT TOO. This line used to say the opposite — "the `match`
  // side deliberately keeps raw content: a rule may want to match a comment, and each rule's own
  // `match_without` carries a comment-line clause where that matters" — and both halves were
  // measured false: 22 of the 56 rules declare no `match_without` at all, and the case that forced
  // the change is a continuation line inside a block comment, which no line-start clause can reach.
  // See `matchFires` above, and `detector.match_in_comments` for the rules that really do want one.
  if (syntaxFor(file) === null) commentSyntaxUnregistered++;
  if ((preSpent = spentAt()) >= 0) return spentBeforeRules(preSpent);
  const viewed = commentView(file, content);
  // THE KIND READING IS NOT CHARGED TO THE FILE'S BUDGET (E5): it has its own
  // allowance (strip-comments.ts KIND_READING_ALLOWANCE_MS), past which the file gets the family reading it
  // had before 2026-11-11, so a slow kind reading can never leave a file unread, or read less, than that.
  fileStartedAt += viewed.kindReadingMs;
  const guardContent = viewed.view;
  // The class `commentSyntaxUnregistered` cannot see: a registered mode smaller than its language.
  if ((preSpent = spentAt()) >= 0) return spentBeforeRules(preSpent);
  const commentForms = commentFormsReadAsCode(file, guardContent);
  // CHECKED AND BRANDED HERE, once per file, and typed `SingleLineSubject[]` from here down: this is
  // half (2) of the single-line property, and the loop inside `asSingleLineSubjects` is the only
  // per-line cost the property has in a scan. See `asSingleLineSubject` above for why it is here and
  // not at the top of `matchFires`, with the numbers that decided it.
  if ((preSpent = spentAt()) >= 0) return spentBeforeRules(preSpent);
  // A byte-order mark opening the file is cut from line 1 of both line arrays
  // (see `physicalLines`); decided once, from the raw text.
  const markOnLine1 = content.charCodeAt(0) === BYTE_ORDER_MARK;
  const lines = asSingleLineSubjects(`file ${file}`, physicalLines(content, markOnLine1));
  // The same lines with comment characters blanked to spaces. Split once per file, above the
  // per-rule loop, rather than once per rule inside the `guard_missing` branch where it used to
  // live. `contentForGuards` replaces characters in place and never adds or removes a newline, so
  // `codeLines[i]` is `lines[i]` wherever the character survived, and the two arrays have the same
  // length. That length equality is what every `codeLines[i]` below rests on, so it was measured
  // rather than assumed: 0 files have a different line count in the two views, in two independent
  // walks of the same 94 corpus trees (89 pinned) on 2026-08-15 — 464,154 files in this change's
  // own sweep, 547,486 in the verifier's, whose file set is the larger of the two.
  //
  // EVERY `codeLines[i]` BELOW STILL CARRIES `?? text`, and the reason is not doubt about that
  // measurement. It is that the invariant is asserted in a check — gate step 11
  // — and step 11 does not execute inside `npm run gates` today, because the &&-joined chain exits
  // at step 7 (`test:rules`, 53/56, on eleven deliberately unresolved G3 mutants). A property
  // whose only check is in a step that never runs is a property nothing is holding. With the
  // fallback an out-of-range index degrades to `code === text`, i.e. exactly today's behaviour on
  // that line; without it, `resolveAliasesInLine(undefined, table)` throws and the scan dies.
  if ((preSpent = spentAt()) >= 0) return spentBeforeRules(preSpent);
  const codeLines = asSingleLineSubjects(`file ${file} (comment-blanked)`, physicalLines(guardContent, markOnLine1, lines));
  // `guard_missing` reads line 1 AS THE FILE WROTE IT, mark included: a guard deletes
  // candidates across its scope, so a guard that matched line 1 only once the mark was cut would remove findings,
  // the one direction this engine may not move in silently (see the guard pass). It is the comment view's line 1
  // before 2026-11-13 exactly: `physicalLines` cut one character, the mark's place, from its front. Every other
  // line is the same string, and a file without the mark hands the guard `codeLines` itself.
  const guardLines: readonly string[] =
    markOnLine1 && codeLines.length > 0 ? [guardContent.charAt(0) + codeLines[0], ...codeLines.slice(1)] : codeLines;
  // ONE automaton pass over `content` and one over `guardContent` — exactly the two texts reading
  // 1 and `also_in_file` are tested against (step2-prefilter/proposal.md §A.1/§A.3) — producing the
  // file-level literal set and the per-line admitted-clause map that gate both of them below.
  // `null` when the prefilter is disabled, so every gated call site below takes the untouched
  // pre-existing branch. Computed ONCE per file, here, for every rule in the bundle at once.
  if ((preSpent = spentAt()) >= 0) return spentBeforeRules(preSpent);
  const fileAdm = prefilter ? computeFileAdmissions(prefilter.index, [content, guardContent]) : null;
  // THE SELF-CHECK SAMPLE IS RESTARTED FOR THIS FILE, here, before the first skipped clause of the
  // first rule — see `SelfCheckSampler.startFile` (prefilter.ts) for why that is what makes the
  // sampled set a function of the tree rather than of how the walk was divided between workers, and
  // for the measurement that chose a phase over a mixed seed. It sits beside `fileAdm` because the
  // two are this file's whole prefilter state and because every `shouldTest()` call in this function
  // lies below this line, inside the rule loop.
  prefilter?.selfCheck.startFile(index);
  const fileCandidates: RawMatch[] = [];
  const fileGuardHits = new Set<string>();
  // ---- THE BUDGET'S OWN STATE ------------------------------------------------------------------
  //
  // `clockEvery` is how many lines pass between two readings of the clock, and it ADAPTS: at most 64
  // on a file that is nowhere near its budget, and 1 by the time the budget is close. That is what
  // makes the cost nothing on ordinary source (a handful of `performance.now()` calls per rule,
  // against ~22 ms/KB the loop already costs) and the overshoot tight on a file where one line costs
  // seconds (design §D.2).
  //
  // WHY WALL CLOCK AND NOT CPU TIME, since a wall clock is what makes a stop depend on how busy the
  // box is (see `--jobs` in index.ts): **per-thread CPU time is not available in `worker_threads`.**
  // `process.cpuUsage()` is per PROCESS, so in a sharded run every worker reads the sum of all of
  // them and a file would be charged for the work of the other threads; `performance.now()` is
  // per process too but measures elapsed time, which is at least the honest quantity for a ceiling
  // whose purpose is "this scan must finish". There is no per-thread clock in Node to switch to, so
  // this is a constraint and not a preference, and the machine-dependence it buys is recorded rather
  // than hidden — in `stopped_for_time`, in the `--jobs` help text, and in a test
  // case (H).
  let clockEvery = FILE_BUDGET_CLOCK_LINES;
  /**
   * Once either adaptation signal has fired, the stride is 1 for the REST OF THIS FILE and the
   * sizing below can never widen it again. Without this latch a file that had already been seen to
   * be in danger could go back to a 64-line stride on the strength of one cheap window.
   */
  let clockLocked = false;
  /** When the clock was last read — the start of the window `clockEvery` is sized from. */
  let lastClockAt = fileStartedAt;
  /**
   * The line at which `lastClockAt` was taken, WITHIN THE CURRENT RULE, and the line at which the
   * next reading is due. Both are reset to 0 at the top of every rule's line loop, which is what
   * makes the first reading of every rule unconditional: per-line cost is a property of the (rule,
   * line) pair and not of the file, so the stride one rule earned says nothing about the next one.
   */
  let lastClockLine = 0;
  let nextClockLine = 0;
  /**
   * Set once, by the check inside the line loop, and read after both loops to build the record.
   * `null` for every file that finished inside its budget, which is every file of every tree this
   * lane has scanned.
   */
  let stoppedForTime: { elapsedMs: number; linesRead: number; rulesCompleted: number } | null = null;

  // Derived views (derive.ts), built at most once per file and only when a rule that declared
  // one actually reaches the point of needing it. The alias and local-value tables below are
  // keyed off `guardContent` rather than the raw text, and stay that way: a commented-out import
  // must not bind an alias and a commented-out value must not become the value, which is the rule
  // strip-comments.ts exists to enforce.
  //
  // EACH NAMED GATE VIEW CHOOSES ITS OWN TEXT, and that choice is made here in one place rather
  // than by handing every builder both texts. `yaml-anchors` reads `guardContent` — a comment must
  // not open a gate, and must not start a parse either — and reads exactly what it read before
  // this dispatch had a second branch. `comments-visible` reads the raw `content`, which is the
  // whole of what that member is: the reading every gate had before 2026-07-27, given back to one
  // declaring rule at a time, after its own gate has already shut on the blanked text. Both are
  // reached only from inside the corroboration gate below, so `guard_missing` and the per-line
  // `match` step see neither (derive.ts's header says why that is absolute for the first).
  const gateViewCache = new Map<GateViewName, string | null>();
  const gateView = (name: GateViewName): string | null => {
    const cached = gateViewCache.get(name);
    if (cached !== undefined) return cached;
    const v =
      name === "yaml-anchors"
        ? // Refused on a file the ceiling reduced — but only after asking whether this view had
          // an answer for the file at all. It PARSES the document, so it is the one reading here
          // whose answer for one line depends on another: blanking line 1304 can make the parse
          // fail, or — the case that matters — succeed into a DIFFERENT document, which would then
          // be offered to a gate as if it were the file.
          //
          // `yamlViewApplies` FIRST, and that order is the correction of 2026-09-07: without it a
          // `.php` or `.svg` file the ceiling reduced was counted in `derived_views_failed` as a
          // view that could not be produced, when this view never had one to produce. It is the
          // same order `refuseForPartialSource` uses for `no-adapter` a few lines below, and for
          // the same reason. See `PARTIAL_SOURCE` in derive.ts.
          partiallyRead && yamlViewApplies(file)
          ? PARTIAL_SOURCE
          : yamlAnchorView(file, guardContent)
        : name === "comments-visible"
          ? commentsVisibleView(content, guardContent)
          : null;
    if (v === null) {
      gateViewCache.set(name, null);
      return null;
    }
    if (v.outcome === "built") derivedViewsBuilt++;
    else if (v.outcome === "failed" || v.outcome === "too-large" || v.outcome === "partial-source")
      derivedViewsFailed++;
    gateViewCache.set(name, v.text);
    return v.text;
  };
  let aliasCache: AliasTable | null = null;
  const aliases = (): AliasTable => {
    if (aliasCache === null) {
      aliasCache = importAliasTable(file, guardContent);
      if (aliasCache.probe) derivedViewsBuilt++;
    }
    return aliasCache;
  };
  // The local-value table, on the same terms as the alias table one line above: built at most
  // once per file, only when a rule that declared `resolve_local_values` reaches the point of
  // needing it, and off `guardContent` so a value written inside a comment binds nothing.
  let valueCache: ValueTable | null = null;
  const localValues = (): ValueTable => {
    if (valueCache === null) {
      valueCache = localValueTable(file, guardContent);
      if (valueCache.probe) derivedViewsBuilt++;
    }
    return valueCache;
  };
  // The joined-construct view, on exactly the same terms: built at most once per file and only
  // when a rule that declared `join_bracketed_constructs` reaches the point of needing it, so a
  // bundle where no rule declares it never folds a line and cannot observe that the capability
  // exists. It is handed the two arrays that are already split rather than the texts, so nothing
  // is split twice, and the spans it folds over come from the comment-blanked half for the reason
  // every gate in this engine reads that half (see derive.ts).
  let joinedCache: JoinedView | null = null;
  const joinedConstructs = (): JoinedView => {
    if (joinedCache === null) {
      // `joinedConstructView` unless a test handed in another builder — `EngineTestSeams`, which
      // no shipped path can reach. The view it returns flows into reading 4 exactly as the real one
      // does, which is what lets a test drive a multi-line subject through the production code path
      // rather than call the assertion directly.
      joinedCache = seams?.joinedViewForTest
        ? seams.joinedViewForTest(lines, codeLines)
        : joinedConstructView(lines, codeLines);
      if (joinedCache.built) joinedViewsBuilt++;
      else joinedViewsNotApplicable++;
      joinedConstructsRefused += joinedCache.refused;
    }
    return joinedCache;
  };
  // The parse tree, built at most once per file, shared by every rule that opted in, and released
  // before the next file is read. Two deliberate choices:
  //   - `content`, not `guardContent`. This is a match-side operation and the parser is the
  //     authority on what a comment is — block state is what a parse HAS, and it is the thing the
  //     line reading does not have.
  //   - built on demand. A bundle where no rule declares `structural_checks` never calls this,
  //     never loads a grammar and cannot observe that the capability exists.
  //   - refused, not attempted, when the ceiling reduced this file. A parse tree of text with a
  //     line emptied is a tree of a document that does not exist, and a check reading it would
  //     report structure the file does not have at line numbers that are real. The refusal is
  //     counted (`structural_skipped_partial_source`) and costs nothing that was previously had:
  //     every one of these files was read to no rule at all before 2026-09-07.
  let parsedCache: ParseResult | undefined;
  const parsed = (): ParseResult =>
    (parsedCache ??= partiallyRead
      ? refuseForPartialSource(file, structural)
      : parseForStructure(file, content, structural, structuralAllowanceMs(fileBudgetMs)));

  // INDEXED RATHER THAN `for (const c of compiled)`, and the reason is the record: `ruleIndex` IS
  // `rules_completed` at the moment of a stop — rules 0..ruleIndex-1 have finished this file and
  // this one has not. A counter incremented at the foot of the body would say something different,
  // because the two `continue`s below skip it: a rule whose `file_globs` exclude this file finished
  // with it as surely as one that read every line, and a reader subtracting `rules_completed` from
  // `rules_total` must get the rules that never saw the file, not those plus the ones that declined
  // it.
  for (let ruleIndex = 0; ruleIndex < compiled.length; ruleIndex++) {
    const c = compiled[ruleIndex];
    // A rule's declared surface is checked before its patterns: `file_globs` says which files
    // this rule is about at all, `path_without` carves exceptions out of that surface.
    if (!surfaceAllows(c, file)) continue;
    if (c.pathWithout.some((re) => re.test(file))) continue;
    // Past both surface tests, so this rule is about to read this file. Counted here and nowhere
    // else: above the two `continue`s it would count files the rule never opens, and below the
    // corroboration gate it would stop counting the files a shut gate silenced — and a file the
    // gate silenced was still offered to the rule, which is what this number is about. Increment
    // only; nothing downstream branches on it.
    filesOnSurface.push([c.rule.id, 1]);
    // The corroboration gate. The first disjunct is the whole of what this line was before
    // derived views existed, and it is evaluated first, so a view can only ever OPEN a gate that
    // was shut — never shut one that was open. A rule declaring no `gate_view` never reaches the
    // second disjunct and never causes a view to be built.
    //
    // WHAT THIS GATE REMOVES IS RECORDED, from 2026-08-13. The header above says "the fix is not
    // to stop suppressing; it is to stop suppressing silently", and until this work item that was
    // implemented for `guard_missing` and not for the field beside it — while `guard_missing` is
    // declared by 0 of 56 rules and `also_in_file` by 9, so the only suppression the output could
    // describe was the one that never happens. Measured over the 94 corpus trees (89 pinned) on
    // 2026-08-13: 11,976 (rule, file) gates shut, 28,504 match lines removed, and no trace of any
    // of them anywhere in the findings document.
    // The decision on that measurement was to keep the unit at the file and make the gate
    // record what it suppressed; the record changes no candidate and no adjudication.
    // The prefilter's file-level admission gates only this first disjunct's clause list — the
    // `some(...)` itself, and what it is evaluated over, are unchanged when disabled or when
    // `c.alsoInFile` is empty (step2-prefilter/proposal.md §A.2, §A.3). `admittedAlsoInFileClauses`
    // can throw `PrefilterSelfCheckFailure`, which is deliberately left to propagate out of
    // `scanFile` and out of `runBuiltin` uncaught — see index.ts's `scan` action for where it is
    // turned into the abort of §E.3.
    let gateSpentAt = -1;
    const admittedAlsoInFile =
      prefilter && fileAdm
        ? admittedAlsoInFileClauses(
            c,
            prefilter.index,
            fileAdm,
            c.alsoInFileClauseIds,
            prefilter.selfCheck,
            guardContent,
            file,
            lines,
            () => (gateSpentAt = spentAt()) >= 0,
          )
        : c.alsoInFile;
    // Each whole-file test reads the clock first (see `spentAt`); once the budget is spent every
    // remaining test answers false without running, and the rule loop stops below.
    const testWholeFile = (re: RegExp, text: string): boolean => {
      if (gateSpentAt < 0) gateSpentAt = spentAt();
      return gateSpentAt < 0 && re.test(text);
    };
    const fileGateOpen =
      c.alsoInFile.length === 0 || (admittedAlsoInFile ?? []).some((re) => testWholeFile(re, guardContent));
    let alsoOk = fileGateOpen;
    // How many derived views were actually BUILT and tested against the clause list here — not
    // how many the rule declared. A declared view that could not be produced (malformed YAML, a
    // recursive anchor, a document over the ceiling) returns null and was never consulted, so
    // counting the declaration would put a second reading in the record that never happened.
    // This is the whole of what `cause` below is derived from.
    let gateViewsTested = 0;
    if (!alsoOk && c.gateViews.length > 0 && gateSpentAt < 0) {
      for (const name of c.gateViews) {
        // Building a view is whole-file work as well, so the clock is read before it.
        gateSpentAt = spentAt();
        if (gateSpentAt >= 0) break;
        const view = gateView(name);
        if (view === null) continue;
        gateViewsTested++;
        if (c.alsoInFile.some((re) => testWholeFile(re, view))) {
          alsoOk = true;
          break;
        }
        if (gateSpentAt >= 0) break;
      }
    }
    // The budget ran out inside this rule's gate: the same record as a stop at line 0 of this rule.
    // Nothing of this rule has been recorded for this file yet except that it was offered it
    // (`filesOnSurface` above), which is true; it raised no candidate, shut no gate and read no line,
    // and no rule below it reads the file.
    if (gateSpentAt >= 0) {
      stoppedForTime = { elapsedMs: gateSpentAt, linesRead: 0, rulesCompleted: ruleIndex };
      break;
    }
    // ---- THE WIDER CORROBORATION SCOPE (`detector.gate_scope`) --------------------------------
    //
    // TWO LINES OF BOOKKEEPING AND NO NEW REGULAR-EXPRESSION WORK. `alsoOk` above already ran this
    // rule's whole clause list against this file, once, for every file the rule is on surface for,
    // whether the gate opened or shut — that is what the field has always cost. Widening the scope
    // adds no test; it changes what is done with a test's RESULT. So the corroboration corpus is
    // exactly the rule's own already-walked surface: `surfaceAllows` and `pathWithout` have both
    // been applied, twenty lines up, before anything here can see the file. No file is read that
    // this rule was not already going to read, and a rule that excludes tests cannot be
    // corroborated by a test.
    //
    // `c.alsoInFile.length > 0` is part of the predicate rather than assumed: with no clause list
    // the gate is open by definition, there is nothing to corroborate, and the build refuses that
    // declaration anyway (tools/build-bundle.mjs) so it cannot reach a shipped bundle silently.
    const widerScope = c.gateScope !== "file" && c.alsoInFile.length > 0;
    // NUL as the separator, on the reasoning `groupPartFingerprint` sets out at the foot of this
    // file: a rule id and a relative path are both built out of characters, and a printable
    // separator lets one rule's directory read as another rule's key — a candidate silently taking
    // a corroboration that was found for something else. POSIX forbids NUL in a path and no rule
    // id carries one, so the two halves cannot run together.
    const scopeKey = widerScope
      ? `${c.rule.id}\u0000${c.gateScope === "directory" ? directoryOf(file) : ""}`
      : "";
    // OPENED HERE, ON THIS FILE'S OWN TEXT: this file is a corroborator for its whole scope. Only
    // `fileGateOpen` counts, never `alsoOk`, and that holds for BOTH gate views for two different
    // reasons. A gate the YAML view opened has its evidence in a string with its own line
    // structure, and `corroborated_from` must name a line a reader can open in the file it names.
    // A gate the COMMENT-VISIBLE view opened has its evidence on a real line of this very file —
    // so line structure is no argument there — but that evidence is a comment, and the wider
    // scopes read every other file's comment-BLANKED text (`re.test(guardContent)` below). Letting
    // it register here would make one file's comment the corroborator for every other file in the
    // scope, which is a widening no rule declared. `fileGateOpen` excludes both without knowing
    // which member was consulted, and that is why the predicate is the raw gate and not `alsoOk`.
    if (widerScope && fileGateOpen) {
      // The clause list is re-walked to learn WHICH clause matched and WHERE, which `some` above
      // does not report. IT RUNS ONCE PER QUALIFYING FILE, and until stage 3b it ran at most once
      // per (rule, scope) for the whole scan: the `!scopeCorroborators.has(scopeKey)` short-circuit
      // that stood in the condition above moved into `mergeShards`, which keeps the entry from the
      // SMALLEST file index per key and discards every other file's (step3-workers/proposal.md
      // §A.3 #6). It had to move, because a worker holds only its own shard's files and cannot
      // know whether some file in another shard already answered for this key; deciding it in the
      // merge is what makes the answer independent of which worker finished first. So a file that
      // is not the first corroborator in walk order now pays this re-walk, the `exec` and the
      // newline count below, and has its answer thrown away. The price was measured rather than
      // assumed: +2.5 % user CPU on one tree against the pre-change engine, inside the baseline's
      // own run-to-run spread (verify-3ab/verification.md §9). `guardEvidence` below is the same
      // shape, for the same reason, and its first-wins pick moved to the same place.
      //
      // THE MATCH IS TAKEN ON THE WHOLE GATE TEXT, NOT LINE BY LINE, and that is the repair of
      // 2026-09-06 (engine patch u1b). This block used to ask `codeLines.findIndex((l) =>
      // clause.test(l))` — the first SINGLE LINE the clause matches — and wrote `line: 0` with the
      // text `(matched across lines)` when no single line did. Two things were wrong with it and
      // the first rule opt-in (eu-retention-001/-002/-003 at `directory`) made both live
      // on real trees: HALF the records came out at line 0 (10 of the 20 corroborators on the
      // twelve marathon trees), because most of `eu-retention-001`'s gate branches span lines; and
      // the line it did find need not be the match that opened the gate at all, because the gate
      // is decided by `re.test(guardContent)` on the WHOLE file text, where `^` and `$` anchor to
      // the ends of the document rather than to each line. The whole justification for
      // `corroborated_from` is that a reader can open the named file at the named line and check
      // the reading (engine annex §1.2, "a reader who cannot see the definition cannot check the
      // reading"), and neither a 0 nor another clause's line meets it.
      //
      // So the same test the gate itself ran is run once more with `exec`, and the line reported
      // is the 1-based line the match STARTS on. A clause spanning a line break now names the line
      // its first character is on, which is where a reader has to start reading; the remainder of
      // the construct is on the lines below it and no record can name two lines.
      //
      // `lastIndex` is reset BEFORE and AFTER each `exec`, and the two resets guard opposite
      // directions. Before: a clause compiled with /g or /y could otherwise carry a stale offset
      // out of the `some` above into this `exec` and report a later match than the one that opened
      // the gate. After: `exec` on a /g or /y expression LEAVES the offset behind on the shared
      // `RegExp` object, which every later file's gate test at the top of this loop reuses, so the
      // next `re.test(guardContent)` would start mid-string and could shut a gate that should have
      // opened — a miss, which is the one direction this repository does not accept, and the
      // reason the second reset is not merely tidiness. Neither is live today: `also_in_file`
      // clauses are compiled `new RegExp(p)` with no flags (above), and the pre-2026-09-06 code
      // carried the same hazard through `.test`. Both are written as guards rather than as
      // repairs of an observed defect.
      let matched: RegExpExecArray | null = null;
      for (const re of c.alsoInFile) {
        if ((gateSpentAt = spentAt()) >= 0) break;
        re.lastIndex = 0;
        matched = re.exec(guardContent);
        re.lastIndex = 0;
        if (matched !== null) break;
      }
      // A spent budget before the match that places the corroborator stops the file at line 0 of this rule.
      if (gateSpentAt >= 0) {
        stoppedForTime = { elapsedMs: gateSpentAt, linesRead: 0, rulesCompleted: ruleIndex };
        break;
      }
      // `matched` cannot be null here, and the reason is written out rather than assumed: this
      // branch is reached only when `fileGateOpen` holds, which for `c.alsoInFile.length > 0` —
      // guaranteed by `widerScope` — means some clause returned true from `test(guardContent)`,
      // and `test` IS `exec(...) !== null` on the same expression and the same string. The `?? 0`
      // is what the degenerate case degrades TO rather than a case that happens: it names line 1
      // of the corroborating file, which a reader can still open and will see is not the
      // construct, where returning no corroborator at all would shut a gate that opened and lose
      // every candidate it released. Subtraction is the only operation that can create a miss.
      const at = matched?.index ?? 0;
      // Newlines before the match's first character, counted on `guardContent`: `contentForGuards`
      // replaces comment characters in place and never adds or removes a newline, so line n of the
      // comment-blanked text is line n of the ORIGINAL file, which is the file the reader opens.
      // The record names the line and never quotes it (2026-09-23: findings.json carries no raw
      // source text — it is removed, not redacted); the reader opens
      // `file` at `line` in their own tree.
      let idx = 0;
      for (let i = 0; i < at; i++) if (guardContent.charCodeAt(i) === 10) idx++;
      scopeCorroborators.push({
        scopeKey,
        record: {
          file,
          // 1-based, and never 0: the match exists, so the line it begins on exists.
          line: idx + 1,
          scope: c.gateScope,
        },
      });
    }
    // ---- ANNOTATE MODE: THE CLAUSE LIST IS A VOCABULARY, NOT A GATE ---------------------------
    //
    // For a rule that names a subject (`detector.gate_applies_to`) and leaves the mode at its
    // default, `also_in_file` no longer decides whether a candidate exists; it decides what is
    // WRITTEN BESIDE one. Nothing may be removed, so the gate may not shut, and the line below is
    // the whole of how that is done. WITHOUT IT the push at the foot of the line loop
    // (`if (alsoOk || held)`) drops every candidate in a file whose own text carries none of the
    // vocabulary, the scan says nothing about it, and this unit ships the exact miss it exists to
    // prevent. Subtraction is the only operation that can create a miss.
    //
    // It is set HERE and not higher up on purpose: above it would skip the `gate_view` loop (and
    // with it `gateViewsTested`, which the suppression record's `cause` is derived from) and it
    // would change the corroborator registration's predicate, which must stay the raw gate. By this
    // point both have run and recorded exactly what they record for every other rule.
    //
    // `widerScope` is part of the predicate rather than assumed. It cannot be false here — the
    // build refuses a subject without `also_in_file` and refuses one at `gate_scope: "file"`
    // (tools/build-bundle.mjs) — and if a future declaration ever made it false, the rule would
    // degrade to today's ordinary file gate rather than to an annotation nothing can compute.
    const annotating = c.gateAppliesTo !== null && c.gateMode === "annotate" && widerScope;
    if (annotating) alsoOk = true;
    // SHUT HERE, AND THE RULE MAY LOOK FURTHER: the candidates this file produces are HELD rather
    // than suppressed, and the decision is taken after the walk. `held` is false for every rule
    // that declares nothing, so `alsoOk || held` below is `alsoOk` and the whole mechanism is
    // unreachable for them. `&& !annotating` is redundant with the line above — `alsoOk` is already
    // true there — and is written out so that a reader does not have to derive it: an annotating
    // rule holds nothing, ever.
    const held = widerScope && !alsoOk && !annotating;
    // Allocated only for a rule that is actually holding. `suppressedLines` below pays one empty
    // array per (rule, file) already; a second unconditional one would double that on every scan
    // for a capability nothing in the shipped bundle uses.
    // INDICES into `fileCandidates`, never object references: a `postMessage`d wire record
    // cannot carry object identity, so `mergeShards` restores it from `(fileIndex,
    // candidateIndices)` instead — F.3 #2 of step3-workers/proposal.md.
    const heldCandidateIndices: number[] | null = held ? [] : null;
    // How many of those held candidates the STRUCTURAL reading produced, so that a gate which
    // shuts one phase later can give them back to the counter. At file scope the question cannot
    // arise: a shut gate never reaches the structural block at all, so nothing it would have
    // produced is ever counted. Holding the gate is what opens the gap — the reading runs, its
    // candidates are counted, and phase 2 may then remove them — and `structural_candidates_added`
    // is published as "candidates only the structural reading produced", which they would not be.
    let heldStructuralAdded = 0;
    // The alias table, for rules that declared `resolve_import_aliases`. Built once per file and
    // only for those rules; `probe === null` (no file-level alias at all) costs one map lookup
    // per line and nothing more.
    // The tables below are passes over the whole file, built once and kept: the clock is read before
    // each one is built, and a spent budget stops the file at line 0 of this rule.
    if (c.resolveImportAliases && aliasCache === null && (gateSpentAt = spentAt()) >= 0) {
      stoppedForTime = { elapsedMs: gateSpentAt, linesRead: 0, rulesCompleted: ruleIndex };
      break;
    }
    const table = c.resolveImportAliases ? aliases() : null;
    // The local-value table, on the same terms. A rule declaring both gets both, tried one after
    // the other on the ORIGINAL line and never composed: resolving an alias and then a value
    // inside one text would be two hops, which is the bound this reading exists under.
    if (c.resolveLocalValues && valueCache === null && (gateSpentAt = spentAt()) >= 0) {
      stoppedForTime = { elapsedMs: gateSpentAt, linesRead: 0, rulesCompleted: ruleIndex };
      break;
    }
    const valueTable = c.resolveLocalValues ? localValues() : null;
    // ...and the joined view, on the same terms again. A rule declaring several of these gets each
    // reading tried after the other on the ORIGINAL line and never composed: a fold of a line whose
    // aliases were resolved would be two operations deep, which is not what any of them is for.
    if (c.joinBracketedConstructs && joinedCache === null && (gateSpentAt = spentAt()) >= 0) {
      stoppedForTime = { elapsedMs: gateSpentAt, linesRead: 0, rulesCompleted: ruleIndex };
      break;
    }
    const joinedView = c.joinBracketedConstructs ? joinedConstructs() : null;
    // What the gate removed in this file, for this rule. Still ONE RECORD per (rule, file),
    // because THE GATE DECISION IS PER (RULE, FILE): `alsoOk` is computed once above and decides
    // every line below, so one shut gate is one event however many lines it silences. What
    // changed on 2026-08-27 is that the record now carries EVERY line it removed rather than the
    // first and a count.
    //
    // WHY THE FIRST-AND-A-COUNT SHAPE WAS NOT ENOUGH. `suppressed_by_guard` — the mechanism
    // beside this one, which 0 of 63 rules declare — records every suppressed match individually,
    // with its own file, line and text. This one recorded `matches: N` and quoted line 1 of N, so
    // lines 2..N had no line number anywhere in the output and no reader could enumerate them:
    // measured on the eight pass-1 runs of 2026-08-26, 202 records named 202 lines out of 379
    // removed, so **177 removed lines were recoverable only as an integer** (about half on one tree;
    // an Elixir analytics application, the largest, 44 of 132). an internal record recorded
    // that gap as a known limit on the day the array was built. The array's own reason for
    // existing — a reader can ask "did this gate shut on anything that matters?" of the WHOLE
    // tree rather than of a sample — did not survive it, and SKILL.md tells the adjudicating
    // agent that a gated rule is the strongest lead in the document and to go and read the line.
    //
    // The per-line cost was priced on that same record (§2.3) at +38 % to +246 % of the ARRAY,
    // which is 0.05–0.65 % of the document; the nested shape here is cheaper than the flat one
    // priced there, because `rule_id` and `file` are written once per decision and not once per
    // line. Nothing about what the gate DECIDES changed: `alsoOk` is computed exactly where and
    // exactly as it was, and every line that was silenced before is silenced now.
    const suppressedLines: CorroborationSuppressedLine[] = [];
    // THE FIRST READING OF EVERY RULE IS UNCONDITIONAL, and it is these two lines that make it so.
    // `nextClockLine` is a line number inside THIS rule, so resetting it to 0 here means the reading
    // at `i === 0` below always happens, whatever stride the rule above earned; `lastClockLine`
    // starts beside it so that the first reading is recognisable as "this rule's cost is not yet
    // known" (`windowLines === 0`) rather than as a window of the previous rule's lines.
    lastClockLine = 0;
    nextClockLine = 0;
    for (let i = 0; i < lines.length; i++) {
      // ---- THE BUDGET CHECK, and it is here rather than around the file for a measured reason ---
      //
      // A budget checked only at file boundaries overshoots by at least one whole file, and one
      // FILE can cost 21 seconds; a budget checked between rules overshoots by one rule's pass over
      // every line, and one such pass on the attack file costs seconds. Here the overshoot is one
      // rule's window of `clockEvery` lines, and the sizing below is what keeps that window small
      // once the budget is close. Per CLAUSE was priced and rejected: it buys a factor of four on
      // that bound and costs a clock read per clause per line per file.
      //
      // **THE BOUND THIS GIVES, STATED AS THE CODE GIVES IT**:
      // the stop lands at the
      // budget plus **one clock window of the interrupted rule**. That window is sized from the per-line
      // cost of the window just measured so that it cannot spend more than `1 / FILE_BUDGET_STRIDE_MARGIN`
      // of what is LEFT, and it is one line as soon as the remaining budget is under that many lines —
      // so a rule whose per-line cost is steady stops within one (rule, line), which is what was measured
      // at 9, 10, 11 and 12 seconds on a loaded box. What can still overshoot by a whole window is a rule
      // whose per-line cost RISES SHARPLY inside one window, because no clock that is not read every line
      // can see that coming; that is the residual and it is stated rather than promised away.
      //
      // WHAT IT REPLACED, so the repair is not undone by someone restoring the simpler form: a fixed
      // 64-line stride until half the budget was spent. The two adaptation signals below are evaluated
      // at a READING, so when the cheap rules of a file ended just under `budget / 2` with no window
      // over `budget / 8`, the next window — a whole 64 lines of the expensive rule — ran with the
      // clock unread. Measured on one 950 KB file of 190 pathological lines at load 5.2–6.5: stops at
      // +79 %, +60 %, +48 % and +72 % of the budget, every one of them with `lines_read` exactly 64.
      if (budgetOn && i >= nextClockLine) {
        const now = performance.now();
        const elapsed = now - fileStartedAt;
        if (elapsed >= fileBudgetMs) {
          // WHAT IS KEPT AND WHAT IS NOT. Everything raised so far stays: `fileCandidates` is not
          // touched here, and neither is any record already pushed. What stops is the READING —
          // this rule reads no further line, and the rules below it read none at all. The two
          // records this rule still owes are written outside the loop (they cost no new read), and
          // its structural and `guard_missing` passes are skipped, which is stated in
          // `PartiallyReadFile.stopped_for_time` because skipping a guard can leave a candidate
          // standing that a complete read would have removed.
          stoppedForTime = { elapsedMs: elapsed, linesRead: i, rulesCompleted: ruleIndex };
          break;
        }
        // THE ADAPTATION, on two signals, either of which LATCHES the clock to every line for the
        // rest of THIS file — never for the next one, which gets its own state back. The first is
        // how much of the budget is already gone; the second is what a single window cost, which
        // catches a file whose very first rule is the expensive one before half the budget is gone.
        // See both constants for the measurements. The latch is what stops the sizing below from
        // widening a stride on a file already known to be in danger.
        if (
          clockLocked ||
          elapsed * FILE_BUDGET_ADAPT_SPENT >= fileBudgetMs ||
          now - lastClockAt > fileBudgetMs / FILE_BUDGET_ADAPT_DIVISOR
        ) {
          clockLocked = true;
          clockEvery = 1;
        } else {
          // THE SIZING, and it is what closes the hole the two signals above leave. Three bounds, and
          // the smallest of them wins:
          //
          //   - `windowLines === 0` — the first reading of this rule, so its per-line cost is not yet
          //     known and the rule above says nothing about it. The next reading is the VERY NEXT
          //     LINE; from there the cost is measured rather than assumed.
          //   - `windowLines * FILE_BUDGET_STRIDE_GROWTH` — a window may be at most twice the one
          //     just measured, so the estimate is refreshed before it can be badly out of date. This
          //     is what a single probe on its own does not give: on a file whose first lines are
          //     cheap and whose later ones are pathological, one probe of line 1 sizes the next
          //     window at the cap and the whole 64 lines run unmetered again (measured, 2026-09-16:
          //     +139 % with the probe alone, `lines_read` 65).
          //   - `remaining / (perLine * FILE_BUDGET_STRIDE_MARGIN)` — at the cost just measured the
          //     window may spend at most a quarter of what is LEFT, so no sized window can itself
          //     exhaust the budget, and the stride is 1 by the time fewer than four such lines fit.
          //
          // All three are capped at `FILE_BUDGET_CLOCK_LINES` and floored at 1. On an ordinary file
          // `remaining` is tens of seconds and `perLine` is microseconds, so the third bound is in
          // the millions, the second reaches the cap in seven readings, and the stride is the 64 it
          // always was for the whole body of every rule. The arithmetic is in `nextClockStride`,
          // exported and pure, because a gate can hold it there with no clock and no scan — see that
          // function for why that matters here more than it usually would.
          clockEvery = nextClockStride(i - lastClockLine, now - lastClockAt, elapsed, fileBudgetMs);
        }
        lastClockAt = now;
        lastClockLine = i;
        nextClockLine = i + clockEvery;
      }
      const text = lines[i];
      // `match` runs on the file's own text FIRST and then on the same line's comment-blanked
      // view — see `matchFires` above for why both, and for the `match_in_comments` opt-in that
      // gives a rule declaring it the raw-line-only test back (0 rules do today). The line number
      // and quoted text a candidate carries still come from `lines[i]` in every branch below.
      //
      // THE ONLY CALL SITE THE PREFILTER GATES (step2-prefilter/proposal.md §A.2, reading 1).
      // `admittedMatchClauses` returns `c.match` itself, unfiltered, when the prefilter is disabled
      // or a clause is refused, so `matchFires` sees the byte-identical clause list it always did in
      // that case — it is handed a DIFFERENT array only when gating is on and genuinely removed
      // something, and even then only clauses PROVABLY unable to match either text (§B). A thrown
      // `PrefilterSelfCheckFailure` is not caught here either; see the corroboration gate above.
      const admittedMatch =
        prefilter && fileAdm
          ? admittedMatchClauses(c, prefilter.index, fileAdm, c.matchClauseIds, prefilter.selfCheck, i, text, codeLines[i] ?? text, file)
          : c.match;
      let hit =
        matchFires(admittedMatch, c.matchInComments, text, codeLines[i] ?? text) &&
        !disqualifiedByMatchWithout(c.match, c.matchWithout, text, codeLines[i] ?? text, c.rule.id, "raw");
      // THE PAIR OF TEXTS THIS CANDIDATE ACTUALLY FIRED ON, for a rule that declared the joined
      // view and for no other. Each of the four readings below sets it where it is the one that
      // made the line match, so the clause set recorded at the push is a statement about this
      // candidate rather than about the line it happens to sit on. `null` all the way down for
      // every rule that declares nothing, which is what keeps this loop the loop those rules ran
      // before the field existed: they pay one property read per line they already matched.
      let firedOn: [string, string] | null =
        hit && c.joinBracketedConstructs ? [text, codeLines[i] ?? text] : null;
      if (!hit && table?.probe && !table.importLines.has(i)) {
        // The same line with its import aliases resolved to what they were imported as. One
        // substitution inside one line: no line is added, removed, split or reordered, so `i`
        // still identifies the same line of the file. A candidate raised here has to survive
        // the rule's own negations on BOTH texts — the resolved one, and the original, which is
        // what keeps a comment line or a documented exemption from becoming reachable purely
        // because an alias was expanded inside it.
        //
        // `codeLines[i] ?? text` for the reason given where `codeLines` is built, and the
        // fallback is load-bearing HERE in a way it is not at the other two sites:
        // `resolveAliasesInLine` reads `.replace` on its first argument, so an out-of-range index
        // would throw and end the whole scan rather than decide one line wrongly. With the
        // fallback the second text becomes the resolved raw line, the helper sees `code === text`
        // and the decision degrades to today's.
        const substituted = resolveAliasesInLine(text, table);
        if (substituted !== text) {
          // CHECKED WHERE IT IS BUILT, and INSIDE the branch: a substitution that changed nothing
          // hands `matchFires` `text` itself, which was checked with the file. `resolveAliasesInLine`
          // substitutes inside one line and every binding target is newline-free by construction
          // (derive.ts), so this can only pass today; it is here because a binder written tomorrow is
          // exactly the consumer §8(f)(1) warns about.
          const resolved = asSingleLineSubject("alias-resolved", c.rule.id, substituted);
          // The same two texts as the site above, both alias-resolved: a candidate an alias
          // created inside a COMMENT is a comment-borne candidate like any other, and the whole
          // point of resolving is that the resolved line is read the way the code reads.
          const resolvedCode = asSingleLineSubject(
            "alias-resolved",
            c.rule.id,
            resolveAliasesInLine(codeLines[i] ?? text, table),
          );
          hit =
            matchFires(c.match, c.matchInComments, resolved, resolvedCode) &&
            !disqualifiedByMatchWithout(c.match, c.matchWithout, resolved, resolvedCode, c.rule.id, "alias-resolved") &&
            !disqualifiedByMatchWithout(c.match, c.matchWithout, text, codeLines[i] ?? text, c.rule.id, "raw");
          if (hit && c.joinBracketedConstructs) firedOn = [resolved, resolvedCode];
        }
      }
      // THE ONE-HOP VALUE READING. Third and last attempt on this line, reached only when the
      // original text did not match and the alias-resolved text did not either, and only for a
      // rule that declared `detector.resolve_local_values`. It is the same shape as the alias
      // branch above and holds the same contract:
      //
      //   - the ORIGINAL line is tested first and is the sole authority for the candidate's line
      //     number and quoted text — no line number can move, because one line goes in and one
      //     line comes out;
      //   - a candidate raised here must survive this rule's own `match_without` on BOTH texts,
      //     the resolved one and the original, so a documented exemption or a comment clause
      //     still removes it;
      //   - a line that IS a definition cannot resolve into itself — `definitionLines` — or
      //     `const HOST = "example.com"` would be rewritten to `const "example.com" = "…"` and a
      //     rule looking for a literal would find the one it just planted.
      //
      // WHAT IT ADDS TO THE RECORD, and why the addition is not optional. The reported line is
      // the USE site and its text does not contain the value: `fetch(HOST)` says nothing about
      // `example.com`. `hops` carries the definition the substitution came from, and it reaches
      // the finding's location (scan.ts) so both sites arrive together. A reader who cannot see
      // the definition cannot check the reading, and a candidate nobody can check is worse than
      // one that was never raised.
      let hops: ValueHop[] | undefined;
      if (!hit && valueTable?.probe && !valueTable.definitionLines.has(i)) {
        //   - `i` is passed because whether an offset sits inside a string is NOT a line-local
        //     question: a triple quote opens a string that runs across lines, and the body of a
        //     Java text block or a Python docstring says nothing about itself. The states are
        //     computed once per file and travel with the table (derive.ts `ValueTable.openQuotes`),
        //     which is built from `guardContent` — the same text `codeLines` is split from, so the
        //     two texts below share one set of offsets and one set of states.
        const resolved = resolveLocalValuesInLine(text, valueTable, lines, i);
        if (resolved.text !== text) {
          // CHECKED WHERE IT IS BUILT and inside the branch, for the reason given at the alias
          // branch above. Every binder in derive.ts excludes `\n` in its capture and
          // MAX_VALUE_LENGTH is 256; this holds them to it.
          const resolvedText = asSingleLineSubject("local-value-resolved", c.rule.id, resolved.text);
          // `codeLines[i] ?? text` for the reason given where `codeLines` is built. The second
          // text is resolved with the same table and the same helper, so the comment-blanked
          // reading of a resolved line is the resolved reading of a comment-blanked line.
          const resolvedCode = asSingleLineSubject(
            "local-value-resolved",
            c.rule.id,
            resolveLocalValuesInLine(codeLines[i] ?? text, valueTable, lines, i).text,
          );
          const fires =
            matchFires(c.match, c.matchInComments, resolvedText, resolvedCode) &&
            !disqualifiedByMatchWithout(c.match, c.matchWithout, resolvedText, resolvedCode, c.rule.id, "local-value-resolved") &&
            !disqualifiedByMatchWithout(c.match, c.matchWithout, text, codeLines[i] ?? text, c.rule.id, "raw");
          if (fires) {
            hit = true;
            hops = resolved.hops;
            if (c.joinBracketedConstructs) firedOn = [resolvedText, resolvedCode];
          }
        }
      }
      // THE JOINED-CONSTRUCT READING. Fourth and last attempt on this line, reached only when
      // nothing above matched and only for a rule that declared
      // `detector.join_bracketed_constructs`. Same shape as the two branches above and the same
      // contract, with one addition that is this reading's own:
      //
      //   - the ORIGINAL line is tested first and is the sole authority for the candidate's line
      //     number and quoted text — the fold is a SECOND STRING AT THE SAME INDEX, so `i` still
      //     names the line the construct opens on and no line number can move;
      //   - a candidate raised here must survive this rule's own `match_without` on BOTH texts,
      //     the folded pair and the original pair, so a clause that is true of the opening line
      //     alone still cancels the candidate even where the longer text is silent about it;
      //   - `joined[i] !== text` is what keeps the extra pass to the OPENING LINES: every other
      //     entry of the view IS the line, and testing a string against itself twice would be the
      //     cost of the whole file rather than of its constructs.
      //
      // WHAT IT ADDS TO THE RECORD, and why it is not optional. The reported line is where the
      // construct OPENS and its text does not carry what the rule matched: `&http.Cookie{` says
      // nothing about the Secure attribute that is absent four lines below it. `joinedFrom` names
      // the span, and it reaches the finding's location (scan.ts) so that the line and the
      // construct arrive together — a reader who cannot see the whole construct cannot check the
      // reading, and a candidate nobody can check is worse than one never raised.
      let joinedFrom: JoinedFrom | undefined;
      if (!hit && joinedView !== null) {
        const folded = joinedView.raw[i] ?? text;
        if (folded !== text) {
          // CHECKED WHERE IT IS BUILT, and this is the branch the property really turns on: the
          // joined view is the ONE reading that folds several physical lines into one subject, and
          // it is newline-free only because `foldSpan` collapses every whitespace run — `\s` includes
          // `\n` — to one space. A fold written tomorrow that keeps the line breaks stops the scan
          // here. Inside the branch because an unfolded entry IS `lines[i]`, checked with the file.
          const joinedText = asSingleLineSubject("joined-construct", c.rule.id, folded);
          // `joinedView.code[i]` is the fold of the comment-blanked text over the SAME span, built
          // in one place from one set of spans, so the pair below is the raw/blanked pair
          // `matchFires` reads and not two strings about different things. Where the two arrays
          // could not be built in parallel the view puts the raw fold in both, which is the same
          // degradation `codeLines[i] ?? text` gives on the line beside it.
          const joinedCode = asSingleLineSubject("joined-construct", c.rule.id, joinedView.code[i] ?? joinedText);
          const fires =
            matchFires(c.match, c.matchInComments, joinedText, joinedCode) &&
            !disqualifiedByMatchWithout(c.match, c.matchWithout, joinedText, joinedCode, c.rule.id, "joined-construct") &&
            !disqualifiedByMatchWithout(c.match, c.matchWithout, text, codeLines[i] ?? text, c.rule.id, "raw");
          if (fires) {
            hit = true;
            joinedFrom = joinedView.spans[i];
            // Unconditional: this branch is reached only when `joinedView !== null`, which is
            // only for a rule that declared the view.
            firedOn = [joinedText, joinedCode];
          }
        }
      }
      // Unchanged in effect, split in two so that the branch which used to fall off the end of the
      // loop has somewhere to be counted. `hit && alsoOk` still decides, in that order, what
      // becomes a candidate; nothing below the `else` can add, remove or move one.
      if (hit) {
        // `alsoOk || held` is `alsoOk` for every rule that does not declare a wider `gate_scope`,
        // because `held` can only be true for one that does — so this is today's branch, with a
        // second population routed through the same push: a HELD candidate takes its place in
        // `fileCandidates` exactly where an admitted one would, keeping the file's candidate
        // ordering and every line number where they already are, and is released or removed after
        // the walk without being moved.
        if (alsoOk || held) {
          // THE SUBJECT DECISION, TAKEN HERE BECAUSE HERE IS THE LAST PLACE THE LINE'S OWN TEXT
          // EXISTS. Phase 2 holds records, not text, and `firedClauseIndices` needs the pair the
          // reading actually matched on — `firedOn` where a derived view is what fired, the raw
          // line and its comment-blanked twin otherwise, which is the same pair the readings above
          // used. `c.gateAppliesTo` is 1-based (see its own comment), which is the numbering
          // `firedClauseIndices` returns, so the two are compared directly.
          let gateSubject = false;
          if (c.gateAppliesTo !== null) {
            const fired = firedClauseIndices(c, firedOn?.[0] ?? text, firedOn?.[1] ?? codeLines[i] ?? text);
            // `fired.length > 0` IS LOAD-BEARING and not a tidiness check: `every` over an empty
            // array is vacuously true, so without it a candidate that fired no `match` clause at
            // all — the structural reading's, and any line whose fire came from a path this
            // function cannot re-derive — would be filed as the subject of a decision it never
            // matched, and would be annotated with a premise that is not about it.
            gateSubject = fired.length > 0 && fired.every((k) => c.gateAppliesTo!.has(k));
          }
          const candidate: RawMatch = {
            rule: c.rule,
            file,
            line: i + 1,
            lineText: text.trim().slice(0, CANDIDATE_LINE_TEXT_CHARS),
            ...(hops && hops.length > 0 ? { hops } : {}),
            ...(joinedFrom ? { joinedFrom } : {}),
            // Engine-internal, never serialised, and present only for a rule that declared the
            // joined view — see `firedClauses` on RawMatch and `collapseNestedDuplicates`, called
            // from `mergeShards` once every file's candidates are in.
            ...(firedOn ? { firedClauses: firedClauseIndices(c, firedOn[0], firedOn[1]) } : {}),
            // Engine-internal like `firedClauses`, and present only for a rule that named a
            // subject. Never written `false`: absence is what every site below tests.
            ...(gateSubject ? { gateSubject: true as const } : {}),
            // The kind facts, and only where the census is on: with it off not one of the four
            // readings below is re-asked and the object is the object this branch built before the
            // census existed. `undefined` is spread as nothing, so the candidate's own shape is
            // unchanged too.
            ...(kindCensus
              ? kindFactsAndRedactions(
                  c,
                  file,
                  i,
                  lines,
                  codeLines,
                  table,
                  valueTable,
                  joinedView,
                  undefined,
                  credentials,
                )
              : {}),
          };
          // A GATE WITH A SUBJECT HOLDS ONLY WHAT ITS SUBJECT NAMES. With no subject declared
          // (`gateAppliesTo === null`) this is the unconditional push it has always been, and
          // `heldCandidateIndices` is null for every rule that is not holding anyway. With a
          // subject declared and the mode `"gate"`, a candidate that also fired a clause the rule
          // did not name is an ordinary candidate that no corroboration decision is about, and
          // holding it would delete it for a reason its own clause never asked for. In `annotate`
          // mode nothing is held at all, because `held` is false.
          if (c.gateAppliesTo === null || gateSubject) heldCandidateIndices?.push(fileCandidates.length);
          fileCandidates.push(candidate);
        } else {
          // One entry per removed line, in file order, named by its line number only: since
          // 2026-09-23 findings.json carries no raw source text, so a reader opens `file` at
          // `line` in their own tree, exactly as they open a candidate's location.
          suppressedLines.push({ line: i + 1 });
        }
      }
    }
    // The gate shut and it cost something. A gate that shut on a file where nothing matched cost
    // nothing and is not an event: recording those would put a row in the output for every file
    // in the tree that a rule looked at and did not fire on.
    //
    // A rule that HELD this file put nothing here: its lines are in `fileCandidates`, and whether
    // they become candidates or become exactly this record is decided by `mergeShards`, after
    // every file has been scanned.
    if (suppressedLines.length > 0) {
      corroborationSuppressed.push({
        rule_id: c.rule.id,
        file,
        // `line` is `lines[0].line`, and it stays. It is a published field that every findings
        // document written since 2026-08-13 carries and that a tool
        // and the eight pass-1 records already read; removing it to avoid holding one fact twice
        // would be a subtraction, which is the one operation that can create a miss. It is DERIVED
        // from the array here rather than accumulated separately, so the two cannot drift, and
        // both tools assert
        // the identity rather than trusting it. Its quote, `line_text`, was removed on 2026-09-23
        // with every other raw-text field of this document.
        line: suppressedLines[0].line,
        matches: suppressedLines.length,
        // `detector.also_in_file` is OR-ed (`some`, above), so a SHUT gate means every clause
        // failed and "which clause failed" has exactly one answer: all of them. The count is what
        // makes that answer legible; the clauses themselves are not copied here, because they are
        // already shipped whole inside the bundle's `rules.json` and a second copy of them in
        // every record would be both large and a fact kept in two places. `expandPatterns` is
        // one-to-one, so this is also the number of clauses the rule's author declared.
        clauses_failed: c.alsoInFile.length,
        // WHICH MECHANISM SILENCED THESE LINES. `clauses_failed` says how many clauses were
        // tested against the file's own text; this says whether a SECOND text was tested too. A
        // rule declaring `gate_view` has its clause list re-run against that second text — the
        // file re-rendered with YAML anchors resolved, or the file's own text with nothing
        // blanked, whichever members it named — and a gate that shut after that is a different
        // event from one that shut without it: the reader of the first has to account for the
        // second reading before concluding the corroboration is absent. It says whether, never
        // which; the rule's own `gate_view` says which members were available. Not derivable from
        // anything else in the document: `stats.derived_views_built` is a tree-wide count that
        // also carries the alias probes, and the rule's own `gate_view` says only what was
        // DECLARED, not what was built.
        cause: gateViewsTested > 0 ? "also_in_file+gate_view" : "also_in_file",
        // Every line the gate removed here, in file order — the field this record existed without
        // until 2026-08-27. See where `suppressedLines` is declared for what its absence cost.
        lines: suppressedLines,
      });
    }

    // ---- the structural reading, for rules that declared it ---------------------------------
    //
    // It runs here — after this rule's line loop, before its guards — and it may touch exactly two
    // things: `fileCandidates`, by appending, and the structural counters. Not `lines`, not
    // `content`, not any entry already in `fileCandidates`, and not `fileGuardHits`: a guard
    // DELETES candidates, so letting a second reading raise one would widen what can remove
    // findings, which is the one direction this engine may not move in silently. A guard still
    // suppresses a structural candidate like any other, because the suppression post-pass keys on
    // the rule id and cannot tell which eye found what — which is correct, since a discharged duty
    // is discharged whoever noticed it.
    //
    // `alsoOk || held` for the reason the line loop above gives: a rule whose gate is HELD for a
    // wider scope has not been refused this file, and reading it with one eye and not the other
    // would make the second reading quietly narrower than the first. `held` is false for every
    // rule that declares no wider scope, so this is `alsoOk` for all of them and no file is parsed
    // that is not parsed today.
    //
    // `stoppedForTime === null` FIRST, and it is a subtraction stated rather than hidden: a rule the
    // budget interrupted does not get its parse. The parse is a whole second reading of the whole
    // file — on the file this budget exists for, the one thing that must not be started after the
    // clock has already run out. What it costs is written into the record: `rules_completed` and
    // `rules_total` say which rules got this reading and which did not.
    // AFTER THE LINE LOOP, THE SAME RULE: the structural parse, its checks and the
    // `guard_missing` pass each read the whole file, so each reads the clock first. A spent budget stops
    // the file with this rule's lines all read and the rule not completed, and the passes it did not
    // run are stated exactly as a stop inside the loop states them (`PartiallyReadFile.stopped_for_time`).
    const spentAfterLines = (): boolean => {
      const at = spentAt();
      if (at >= 0) stoppedForTime = { elapsedMs: at, linesRead: lines.length, rulesCompleted: ruleIndex };
      return at >= 0;
    };
    if (stoppedForTime === null && c.structuralChecks.length > 0 && (alsoOk || held) && !spentAfterLines()) {
      const p = parsed();
      if (p.tree !== null && !spentAfterLines()) {
        for (const f of runCheckSets(c.structuralChecks, p.tree, c.vocabulary, `rule ${c.rule.id}`)) {
          // A line outside the file is impossible from a parser handed this exact text, and a
          // finding pointing at a line that does not exist is worse than one fewer finding — so
          // it is dropped rather than emitted, and counted. It is counted in ITS OWN counter and
          // not in `parseFailed`: this is one discarded FINDING out of a file that was read, and
          // `parseFailed` counts FILES that were not read. Adding them made the number of failed
          // files unknowable and could push it past the number of files scanned.
          if (f.line < 1 || f.line > lines.length) {
            structural.findingsOutOfRange++;
            continue;
          }
          const text = lines[f.line - 1];
          // `match_without` applies. Its clauses are the rule author's own measured decisions
          // about lines that are not the construct at all — a JSON example context, a spread, a
          // wrapper injecting href — and a second way of reading the same file is not a second
          // opinion about what the rule targets. Its limit is real and stated rather than left to
          // be rediscovered: it is a LINE test, and a structural candidate's evidence is a
          // subtree, so a disqualifying token on another line does not reach it.
          if (
            disqualifiedByMatchWithout(
              c.match,
              c.matchWithout,
              text,
              codeLines[f.line - 1] ?? text,
              c.rule.id,
              "structural-post-check",
            )
          ) {
            structural.candidatesDroppedByMatchWithout++;
            continue;
          }
          // Found twice, emitted once. Line-based wins because it ran first and because its
          // lineText is the one existing findings already carry, so no finding_id can move.
          if (fileCandidates.some((m) => m.rule.id === c.rule.id && m.line === f.line)) {
            structural.candidatesDuplicate++;
            continue;
          }
          const endLine = f.endLine > f.line && f.endLine <= lines.length ? f.endLine : undefined;
          const candidate: RawMatch = {
            rule: c.rule,
            file,
            line: f.line,
            lineText: text.trim().slice(0, CANDIDATE_LINE_TEXT_CHARS),
            endLine,
            // The kind facts of a structural candidate, on the same terms as the line reading's.
            // `endLine` is handed in because it is what the oracle reads to tell a spanning element
            // from a single-line one when no clause can be named, and here it is known rather than
            // recovered from the location.
            ...(kindCensus
              ? kindFactsAndRedactions(
                  c,
                  file,
                  f.line - 1,
                  lines,
                  codeLines,
                  table,
                  valueTable,
                  joinedView,
                  endLine,
                  credentials,
                )
              : {}),
          };
          // ...and NEVER for a rule that named a subject: the structural reading fires no `match`
          // clause, so its candidates are outside any subject by the test at the line site above,
          // and a gate whose subject they are not may not remove them. `gateAppliesTo === null` is
          // every rule in the bundle that does not opt in, for which this is the unconditional
          // push and the unconditional count it has always been.
          if (c.gateAppliesTo === null) {
            heldCandidateIndices?.push(fileCandidates.length);
          }
          fileCandidates.push(candidate);
          // Held on the same terms as a line-based candidate of the same held gate, so that the
          // record the gate writes if the scope produces no corroborator names every line it
          // removed and not only the ones the line reading found.
          if (heldCandidateIndices !== null && c.gateAppliesTo === null) heldStructuralAdded++;
          structural.candidatesAdded++;
        }
      }
    }

    // `stoppedForTime === null` FIRST, and THIS ONE POINTS THE OTHER WAY, which is why it is called
    // out here and in `PartiallyReadFile.stopped_for_time` rather than only counted. Every other
    // thing the stop skips can only REMOVE candidates from the document. A guard SUPPRESSES: a
    // `guard_missing` clause that would have matched in this file deletes this rule's candidates
    // across the scope, so not evaluating it leaves candidates standing that a complete read would
    // have removed. That direction is not made safe by skipping less — the clause is a whole-file
    // pass per clause, i.e. exactly the unbounded work the budget exists to stop — so it is skipped
    // and said out loud. 0 of the 117 rules in the shipped bundle declare a `guard_missing`, so on
    // the bundle as it stands this branch is unreachable for every rule and the direction is
    // theoretical; a rule that declares one later inherits the note.
    if (stoppedForTime === null && c.guardMissing.length > 0 && !spentAfterLines()) {
      // DELIBERATELY NOT GIVEN A DERIVED VIEW, and the reason is the constraint the views are
      // built under. A guard suppression reports the guard's own `file:line` in
      // suppressed_by_guard, and a reader opens that line in the ORIGINAL file. A YAML
      // expansion has its own line structure and no correspondence to the file's, so a guard
      // matched in the view could not be attributed to any line. The second reason stands on its
      // own: a guard DELETES candidates, so widening what a guard can see removes findings,
      // which is the one direction this engine may not move in silently.
      //
      // Which guard matched, and on which line, is recorded rather than merely that one did:
      // a suppression the reader cannot trace back to a line is a suppression nobody audits.
      // match_without applies here too. Its clauses name the shapes the rule's own author has
      // already decided are not the thing — `revokeAdminConsent`, `/oauth/consent`, a comment
      // line. Excluding them from producing one candidate while letting the identical string
      // delete every candidate in the project was the defect adversarial review found in
      // eu-consent-017 on 2026-07-27: four of the six lines that silenced it were listed in its
      // own match_without.
      //
      // AND IT IS DELIBERATELY NOT `disqualifiedByMatchWithout`. THE SIGN IS OPPOSITE HERE. At
      // the three sites above, `match_without` REMOVES candidates, so weakening it adds them —
      // which is the direction this engine may move in. Inside this branch it PROTECTS them: a
      // line `match_without` disqualifies cannot serve as a guard, and a guard that fires deletes
      // every candidate for this rule in scope. Applying the two-text conjunction here would
      // disqualify fewer guard lines, fire more guards and suppress more candidates — the one
      // direction this engine may not move in silently. `l` is already a comment-blanked line, so
      // the comment-prose problem the helper exists for cannot arise on it in the first place.
      const guardUsable = (l: string) => !c.matchWithout.some((re) => re.test(l));
      // One guard over every code line is one unit of work; the clock is read before each.
      const hit = c.guardMissing.find((re) => !spentAfterLines() && guardLines.some((l) => guardUsable(l) && re.test(l)));
      if (hit && !spentAfterLines()) {
        fileGuardHits.add(c.rule.id);
        // `guardHitsProject`'s union and `guardEvidence`'s first-file-in-walk-order pick both
        // move to `mergeShards` now, so this file always computes its own evidence rather than
        // only when it is the first to reach this branch — see the comment on `guardEvidence`
        // above.
        const idx = guardLines.findIndex((l) => guardUsable(l) && hit.test(l));
        guardEvidence.push({
          ruleId: c.rule.id,
          pattern: hit.source,
          // A guard may match across a line break, in which case no single line matches it. The
          // line is named and never quoted: findings.json carries no raw source text (2026-09-23).
          line: idx >= 0 ? idx + 1 : 0,
        });
      }
    }

    // The gate shut on this file's own text, the rule may look further, and it cost something.
    // Registered on exactly the condition the record above is written on — a gate that shut over a
    // file where nothing matched cost nothing and is not an event — so a rule declaring a wider
    // scope holds one row per file it actually silenced and none for the rest of the tree.
    //
    // WRITTEN EVEN WHEN THE BUDGET STOPPED THIS RULE, and the alternative is worse in a way that is
    // not obvious. A held gate is the thing that will decide, after the walk, whether the candidates
    // this rule raised here survive or become a `corroboration_suppressed` record. Those candidates
    // are already in `fileCandidates`. Dropping the gate record would not drop them — it would
    // RELEASE them, unconditionally, past a gate that shut on this file, which is a candidate the
    // engine would not have raised had it read the file whole. The gate decision itself does not
    // depend on the lines that were not read: it was taken once, before this rule's line loop, over
    // the whole file text. So the record is written and phase 2 decides as it always does.
    if (heldCandidateIndices !== null && heldCandidateIndices.length > 0) {
      heldGates.push({
        ruleId: c.rule.id,
        scopeKey,
        clausesFailed: c.alsoInFile.length,
        gateViewsTested,
        candidateIndices: heldCandidateIndices,
        structuralAdded: heldStructuralAdded,
      });
    }
    // The budget stopped this file inside this rule. Everything above has been recorded; no rule
    // below this one reads a line of it.
    if (stoppedForTime !== null) break;
  }
  // One tree at a time. Measured rather than assumed: releasing after every file takes the parse
  // loop over a large TypeScript data platform from 0.41 GB of peak resident memory to 0.12 GB and costs nothing in
  // time. Trees are never cached across files;
  // grammars are cached for the process, which is a different thing.
  // Read before the release below, which clears it: a structural reading that passed its allowance
  // (structural/parse.ts `structuralAllowanceMs`) is named in this file's row further down.
  const structuralBounded = parsedCache?.bounded;
  parsedCache?.release();
  parsedCache = undefined;
  // ---- THE RECORD THE BUDGET OWES, and it is the whole of what a stop changes in the output -----
  //
  // Nothing above this line was undone by the stop. What is decided here is only which of the two
  // channels names the file — the same two the minification ceiling already uses, for the same
  // reason and with the same meaning: `files_not_read` is "no rule read a line of it",
  // `files_partially_read` is "it was read, and some of it was left out".
  if (stoppedForTime !== null) {
    // Both rounded: `findings.schema.json` types them as integers, and a caller is free to hand this
    // function a fractional millisecond (`--file-budget 0.0015` does).
    const budget = { budget_ms: Math.round(fileBudgetMs), elapsed_ms: Math.round(stoppedForTime.elapsedMs) };
    if (stoppedForTime.rulesCompleted === 0 && stoppedForTime.linesRead === 0) {
      // Possible, and not only in theory: the clock starts before the read, and the first reading is
      // taken at line 0 of the first rule — so a file whose read, comment-blanking, prefilter
      // admission pass or first gate test alone outlasts the budget is stopped having offered no
      // line to any rule. That is the same statement `long-line` makes about a file with nothing
      // left under the ceiling, and it is made in the same place.
      //
      // A file that BOTH the ceiling reduced and the budget stopped this early is named here and not
      // in `files_partially_read`, so the blanked lines it would have listed are not listed. The two
      // arrays are a different population and are never added (see `PartiallyReadFile`), so a file
      // cannot be in both; and of the two facts, "no rule read any of this file" is the one a reader
      // must not miss.
      //
      // `scopeCorroborators` IS CARRIED THROUGH, and it is the one field of `notReadRecord` this
      // path overrides. The other two callers of that helper (the ceiling and an unreadable file)
      // return before any rule runs, so their array is empty and this spread is a no-op for them;
      // HERE the interrupted rule is compiled index 0 and it pushed its corroborator BEFORE its line
      // loop, over the whole file text, which is a reading that really happened and whose result the
      // stop does not undo. Zeroing it would SUBTRACT: if this file were the only corroborator for a
      // `gate_scope` key, every held candidate in that scope — in other files — would be suppressed
      // instead of released, which is the one direction this whole change is not allowed to move
      // (subtraction is the only operation that can create a miss). Latent rather than
      // live when it was found: this return needs `rulesCompleted === 0`,
      // so the interrupted rule must be compiled index 0, and no rule declaring `gate_scope` is index
      // 0 in today's bundle. Fixed rather than documented, because "no rule in today's bundle" is a
      // property of the bundle and not of this function.
      return { ...notReadRecord(index, file, { file, reason: "time-budget", ...budget }), scopeCorroborators };
    }
    const stopped_for_time = {
      ...budget,
      lines_read: stoppedForTime.linesRead,
      lines_total: lines.length,
      rules_completed: stoppedForTime.rulesCompleted,
      rules_total: compiled.length,
    };
    // APPENDED to a ceiling record rather than replacing it, and the key order is the order a
    // ceiling-only row already writes — so a row that carries both causes is the row the ceiling
    // wrote plus one key, and every row this engine wrote before the budget existed is unchanged.
    partiallyReadRecord = partiallyReadRecord
      ? { ...partiallyReadRecord, stopped_for_time }
      : { file, stopped_for_time };
  }
  // THE STRUCTURAL READING PASSED ITS ALLOWANCE. Every rule read every line of this file
  // - the parse is abandoned, not the file - but the second reading was left out, which is what this
  // array exists to say, so the file is named here with the allowance and the time it had taken. A
  // clock, so the elapsed time is one run's measurement; structural/parse.ts says why the allowance
  // is a clock and where it sits. Appended last, on the same terms as `stopped_for_time` above.
  if (structuralBounded) {
    const structural_reading_stopped = {
      allowance_ms: Math.round(structuralBounded.allowanceMs),
      elapsed_ms: Math.round(structuralBounded.elapsedMs),
    };
    partiallyReadRecord = partiallyReadRecord
      ? { ...partiallyReadRecord, structural_reading_stopped }
      : { file, structural_reading_stopped };
  }
  return {
    index,
    file,
    scanned: true,
    partiallyRead: partiallyReadRecord,
    ...(readAs !== undefined ? { readAs } : {}),
    candidates: fileCandidates.map(toWireMatch),
    guardHits: Array.from(fileGuardHits),
    guardEvidence,
    scopeCorroborators,
    corroborationSuppressed,
    heldGates,
    counters: {
      commentSyntaxUnregistered,
      commentFormsReadAsCode: commentForms,
      derivedViewsBuilt,
      derivedViewsFailed,
      joinedViewsBuilt,
      joinedViewsNotApplicable,
      joinedConstructsRefused,
      filesOnSurface,
      structural: { ...structural, grammarsUnavailable: [...structural.grammarsUnavailable] },
    },
  };
}

export function mergeShards(
  compiled: CompiledRule[],
  shards: ShardResult[],
  scope: GuardScope,
  fileCount: number,
): EngineResult {
  // THE ONLY ORDERING AUTHORITY: every record's own `index`, never arrival order and never which
  // shard it came from. A single-shard call (today's only caller) already hands every record in
  // walk order; a future multi-worker caller may not, and this sort is what makes the two produce
  // the same document. See step3-workers/proposal.md A.3/B.1 for the determinism argument.
  const records = shards.flatMap((s) => s.records).sort((a, b) => a.index - b.index);
  // WHAT THE DISPATCH HANDED BACK, ASSERTED RATHER THAN TRUSTED — the indices must be exactly a
  // permutation of `0 … fileCount-1`. Nothing that exists today can fail this: `runBuiltin` hands
  // one shard holding every index, and `scanShardedForTest` partitions the same range. Stage 3c's
  // worker pool is what can, and BOTH of its failure modes are silent without this check.
  //
  // A DUPLICATED index is the worse of the two. `rehydrated` below is a `Map` keyed on `index`, so
  // the second record's array replaces the first's, and `Array.prototype.sort` is stable — which
  // of the two duplicates is "second" is therefore decided by ARRIVAL ORDER, the one input this
  // whole function is built to ignore, re-entering through the door nobody was watching. The file
  // would also be traversed twice below, pushing its candidates into `matches` twice, while
  // `heldGates` resolved against only one of the two arrays.
  //
  // A MISSING index drops a file from the document with no counter moving: `filesScanned` is a sum
  // over the records that arrived, so a file nobody scanned and a file with nothing in it produce
  // the identical output — a forbidden conflation, one layer down. Both are turned into a crash that
  // names the index. (Raised by the independent verification of stages 3a/3b, §8.3.)
  {
    const seen = new Array<boolean>(fileCount).fill(false);
    for (const r of records) {
      // NOT AN INTEGER IS ITS OWN REASON, and it is separated from "out of range" because the two
      // are different defects with different causes: an index that is a string, a fraction or `NaN`
      // came out of a wire format or an arithmetic that lost it, while an out-of-range integer came
      // from a dispatch that is scanning a file this run does not contain. A message that called the
      // first "outside 0..n-1" would send the reader to look for the wrong thing. (Raised by the
      // re-verification of stages 3a/3b.)
      if (!Number.isInteger(r.index)) {
        throw new Error(
          `mergeShards: record index ${JSON.stringify(r.index)} (${r.file}) is not an integer — a file's ` +
            `position in the walk is the only thing this merge orders by, and a value that is not a whole ` +
            `number cannot be one`,
        );
      }
      if (r.index < 0 || r.index >= fileCount) {
        throw new Error(
          `mergeShards: record index ${r.index} (${r.file}) is outside 0..${fileCount - 1} — the dispatch returned a record for a file that is not in this scan`,
        );
      }
      if (seen[r.index]) {
        throw new Error(
          `mergeShards: record index ${r.index} (${r.file}) arrived twice — two shards scanned the same file, and the merge would otherwise keep whichever of the two arrived last`,
        );
      }
      seen[r.index] = true;
    }
    if (records.length !== fileCount) {
      const missing: number[] = [];
      for (let i = 0; i < fileCount; i++) if (!seen[i]) missing.push(i);
      throw new Error(
        `mergeShards: ${missing.length} of ${fileCount} file(s) produced no record — missing index(es) ` +
          `${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ", …" : ""}. A file no shard scanned would ` +
          `otherwise be absent from the document with no counter moving.`,
      );
    }
  }
  // Every `WireMatch` rehydrated back into the `RawMatch` a single sequential walk would have
  // held — the `Rule` object restored by id, `file` restored from the record that carries it. ONE
  // array per file, built ONCE, keyed by `FileRecord.index` so that a `heldGates` entry resolved
  // through it below and this file's own `candidates` share the exact object references a
  // sequential walk would have shared — the whole reason a `corroboratedFrom` written on one is
  // visible through the other (F.3 #2 of step3-workers/proposal.md).
  const ruleById = new Map<string, Rule>(compiled.map((c) => [c.rule.id, c.rule]));
  const rehydrated = new Map<number, RawMatch[]>(
    records.map((r) => [
      r.index,
      r.candidates.map(
        (w): RawMatch => ({
          rule: ruleById.get(w.ruleId)!,
          file: r.file,
          line: w.line,
          lineText: w.lineText,
          ...(w.endLine !== undefined ? { endLine: w.endLine } : {}),
          ...(w.hops ? { hops: w.hops } : {}),
          ...(w.joinedFrom ? { joinedFrom: w.joinedFrom } : {}),
          ...(w.firedClauses ? { firedClauses: w.firedClauses } : {}),
          ...(w.gateSubject ? { gateSubject: true as const } : {}),
          ...(w.kindFacts ? { kindFacts: w.kindFacts } : {}),
          ...(w.kindRedactions ? { kindRedactions: w.kindRedactions } : {}),
        }),
      ),
    ]),
  );

  const matches: RawMatch[] = [];
  const suppressed: SuppressedMatch[] = [];
  // Segment A first, in ascending file index: every file's own inline gate records, exactly the
  // order a single sequential walk pushes them in. Segment B — one entry per HELD gate the scope
  // never corroborated — is appended below, after segment A is complete in full, and the two are
  // never interleaved.
  const corroborationSuppressed: CorroborationSuppression[] = records.flatMap((r) => r.corroborationSuppressed);
  // A `Set` of rule ids, membership only — no order to get wrong. Every file that hit a guard
  // contributes its own id; the same id contributed by many files collapses to one membership test.
  const guardHitsProject = new Set<string>(); // rule ids whose guard was seen anywhere in the project
  for (const r of records) for (const id of r.guardHits) guardHitsProject.add(id);
  /**
   * Where each rule's guard first matched, so a suppression can name its own cause.
   *
   * First-wins by ASCENDING FILE INDEX, not by which file happened to compute its evidence first:
   * `scanFile` now computes every qualifying file's own evidence unconditionally (see its own
   * comment), and this loop, run over `records` in index order, keeps exactly the one a single
   * sequential walk would have kept — the first file in walk order whose guard hit.
   */
  const guardEvidence = new Map<string, { pattern: string; file: string; line: number }>();
  for (const r of records) {
    for (const e of r.guardEvidence) {
      if (!guardEvidence.has(e.ruleId)) {
        guardEvidence.set(e.ruleId, { pattern: e.pattern, file: r.file, line: e.line });
      }
    }
  }
  /**
   * Where each (rule, scope) found its corroboration — phase 1 of `detector.gate_scope`.
   *
   * Keyed `<rule id>\0<scope key>`, exactly as `scanFile` keys its own per-file entries. First-wins
   * by ASCENDING FILE INDEX: every file whose own comment-blanked text satisfies a clause now
   * records its own corroborator (see `scanFile`), and this loop keeps the one a single sequential
   * walk would have reached first.
   *
   * Only a file's OWN text puts an entry here. A derived view (`gate_view`) opens the gate of the
   * file it was built from and is never a corroborator for another file: the record has to name a
   * line a reader can open, and a view has its own line structure (derive.ts).
   */
  const scopeCorroborators = new Map<string, CorroboratedFrom>();
  for (const r of records) {
    for (const { scopeKey, record } of r.scopeCorroborators) {
      if (!scopeCorroborators.has(scopeKey)) scopeCorroborators.set(scopeKey, record);
    }
  }
  /**
   * The gate decisions HELD for a wider scope, decided after every file has been scanned — phase 2.
   *
   * Concatenated in ASCENDING FILE INDEX, which reproduces the push order (file asc × compiled-rule
   * order) a single sequential walk produces, because within one file `scanFile` already visits
   * rules in compiled order.
   */
  const heldGates = records.flatMap((r) => {
    const own = rehydrated.get(r.index)!;
    return r.heldGates.map((g) => ({
      ruleId: g.ruleId,
      file: r.file,
      scopeKey: g.scopeKey,
      clausesFailed: g.clausesFailed,
      gateViewsTested: g.gateViewsTested,
      candidates: g.candidateIndices.map((i) => own[i]),
      structuralAdded: g.structuralAdded,
    }));
  });
  /** Held candidates whose scope produced no corroborator: the gate shut, one phase later. */
  const heldDropped = new Set<RawMatch>();
  let gatesOpenedByScope = 0;
  let filesScanned = 0;
  let filesSkipped = 0;
  const filesNotRead: NotReadFile[] = [];
  const filesPartiallyRead: PartiallyReadFile[] = [];
  for (const r of records) {
    if (r.scanned) filesScanned++;
    else filesSkipped++;
    if (r.notRead) filesNotRead.push(r.notRead);
    if (r.partiallyRead) filesPartiallyRead.push(r.partiallyRead);
  }
  let filesCommentSyntaxUnregistered = 0;
  let filesReadFromUtf16 = 0;
  let filesReadNotUtf8 = 0;
  let filesCommentFormReadAsCode = 0;
  const commentFormsReadAsCodeByForm: Record<string, number> = Object.fromEntries(COMMENT_FORM_NAMES.map((f) => [f, 0]));
  let derivedViewsBuilt = 0;
  let derivedViewsFailed = 0;
  let joinedViewsBuilt = 0;
  let joinedViewsNotApplicable = 0;
  let joinedConstructsRefused = 0;
  for (const r of records) {
    filesCommentSyntaxUnregistered += r.counters.commentSyntaxUnregistered;
    if (r.readAs === "utf-16") filesReadFromUtf16++;
    else if (r.readAs === "not-utf-8") filesReadNotUtf8++;
    if (r.counters.commentFormsReadAsCode.length > 0) filesCommentFormReadAsCode++;
    for (const f of r.counters.commentFormsReadAsCode) commentFormsReadAsCodeByForm[f] = (commentFormsReadAsCodeByForm[f] ?? 0) + 1;
    derivedViewsBuilt += r.counters.derivedViewsBuilt;
    derivedViewsFailed += r.counters.derivedViewsFailed;
    joinedViewsBuilt += r.counters.joinedViewsBuilt;
    joinedViewsNotApplicable += r.counters.joinedViewsNotApplicable;
    joinedConstructsRefused += r.counters.joinedConstructsRefused;
  }
  // Incremented once per candidate the nested-duplicate collapse removed, in the assembly loop
  // below and nowhere else.
  let joinedOuterDuplicatesDropped = 0;
  const structural = newCounters();
  for (const r of records) {
    const s = r.counters.structural;
    structural.treesBuilt += s.treesBuilt;
    structural.noAdapter += s.noAdapter;
    structural.grammarUnavailable += s.grammarUnavailable;
    structural.parseFailed += s.parseFailed;
    structural.skippedTooLarge += s.skippedTooLarge;
    structural.findingsOutOfRange += s.findingsOutOfRange;
    structural.skippedPartialSource += s.skippedPartialSource;
    structural.candidatesAdded += s.candidatesAdded;
    structural.candidatesDuplicate += s.candidatesDuplicate;
    structural.candidatesDroppedByMatchWithout += s.candidatesDroppedByMatchWithout;
    // Each language named ONCE with the first error it gave and the number of files that hit it —
    // "first" meaning smallest file index, which iterating `records` in ascending index order and
    // never overwriting an `error` already set gives for free; `files` sums regardless of order.
    for (const [lang, entry] of s.grammarsUnavailable) {
      const seen = structural.grammarsUnavailable.get(lang);
      if (seen) seen.files += entry.files;
      else structural.grammarsUnavailable.set(lang, { error: entry.error, files: entry.files });
    }
  }
  // Seeded from `compiled` rather than filled in on first hit, so a rule that is allowed to read
  // nothing at all still has a row saying 0. Building it lazily would make "no file was offered"
  // and "this rule was never in the run" the same absent key, which is the exact conflation
  // the design exists to remove.
  const filesOnSurface = new Map<string, number>(compiled.map((c) => [c.rule.id, 0]));
  for (const r of records) {
    for (const [ruleId, n] of r.counters.filesOnSurface) {
      filesOnSurface.set(ruleId, (filesOnSurface.get(ruleId) ?? 0) + n);
    }
  }

  // ---- PHASE 2 OF `detector.gate_scope` ------------------------------------------------------
  //
  // It runs here, and before the guard pass, for the reason the guard pass itself runs after the
  // walk: the corroboration a wider scope is looking for may sit in a file that is read long after
  // the candidate was matched, so the answer does not exist until every file has been scanned.
  // Nothing here reads a file, compiles a pattern or runs a test — every decision was taken while
  // `scanFile` read its own file and this loop only says which of the two it was.
  //
  // The order is deliberate. A released candidate then faces `guard_missing` exactly as any other
  // candidate does, because a discharged duty is discharged whoever noticed it; and a candidate this
  // loop removes never reaches the guard pass, so a gate that shut cannot consume a guard record.
  for (const g of heldGates) {
    const corroborator = scopeCorroborators.get(g.scopeKey);
    if (corroborator !== undefined) {
      // RELEASED. One gate, however many lines it was holding — the counter counts decisions, and
      // each released line is an ordinary candidate that now names where its corroboration is.
      gatesOpenedByScope++;
      for (const m of g.candidates) m.corroboratedFrom = corroborator;
      continue;
    }
    // SHUT, one phase later, and recorded as the same event the file-scope gate records inline. The
    // lines are sorted because a held gate holds the line reading's candidates and then the
    // structural reading's, which are appended after it: `lines` is contracted to be in ascending
    // file order and `line` to be its first entry's, and both are asserted by
    // two tools.
    for (const m of g.candidates) heldDropped.add(m);
    // ...and the structural reading gets back what this gate is about to remove. Those candidates
    // were counted when they were pushed, because at that moment they were candidates; a shut gate
    // deletes them, and `structural_candidates_added` says how many candidates the second eye
    // PRODUCED. At file scope the counter cannot drift this way, because a shut gate never reaches
    // the structural block; only a HELD gate runs the reading and then removes its result.
    structural.candidatesAdded -= g.structuralAdded;
    const ls: CorroborationSuppressedLine[] = g.candidates
      .map((m) => ({ line: m.line }))
      .sort((a, b) => a.line - b.line);
    corroborationSuppressed.push({
      rule_id: g.ruleId,
      file: g.file,
      line: ls[0].line,
      matches: ls.length,
      clauses_failed: g.clausesFailed,
      // The whole scope was weighed and none of it carried the corroboration, which is a stronger
      // statement than a shut file-scope gate and has to be legible as one.
      cause: g.gateViewsTested > 0 ? "also_in_file+gate_view+gate_scope" : "also_in_file+gate_scope",
      lines: ls,
    });
  }

  // ---- PHASE 2 OF `detector.gate_applies_to` IN `annotate` MODE ------------------------------
  //
  // THE SAME FACT THE LOOP ABOVE WOULD HAVE GATED ON, WRITTEN DOWN INSTEAD OF ACTED ON. It runs
  // here, beside phase 2 of `gate_scope` and for the identical reason: the corroborator may sit in
  // a file read long after the subject candidate was matched, so the answer does not exist until
  // every file has been scanned. Nothing here reads a file, compiles a pattern or runs a test —
  // every clause test was taken while `scanFile` held the file, and this loop only reports which
  // way it went.
  //
  // It runs BEFORE the guard pass and the survivor loop so that a candidate a guard removes is
  // never annotated (it is not in the document), and so that a candidate that survives carries its
  // premise by the time `scan.ts` copies the location out.
  //
  // At PROJECT scope the key is `<rule id>\0` and `scopeCorroborators` holds at most ONE record per
  // rule per scan, so every annotated location in one scan carries the same answer and the same
  // evidence line. That constancy is what the census argument rests on (kind-census.ts), and it is
  // why this mark can never split a bin.
  const compiledById = new Map<string, CompiledRule>(compiled.map((c) => [c.rule.id, c]));
  for (const [, ms] of rehydrated) {
    for (const m of ms) {
      // Not a subject clause's candidate — which is every candidate of every rule that declares no
      // subject, so this loop is one boolean test per candidate for the whole shipped bundle.
      if (m.gateSubject !== true) continue;
      const c = compiledById.get(m.rule.id);
      if (c === undefined || c.gateAppliesTo === null || c.gateMode !== "annotate") continue;
      // Built exactly as `scanFile` builds it, NUL separator and all, for the reason written where
      // it is built there: a printable separator would let one rule's directory read as another
      // rule's key. `gateScope` is never `"file"` for a rule with a subject — the build refuses
      // that — so the ternary's second arm is the project key and not a file's.
      const key = `${m.rule.id}\u0000${c.gateScope === "directory" ? directoryOf(m.file) : ""}`;
      const corroborator = scopeCorroborators.get(key);
      // BOTH VALUES ARE WRITTEN. `false` is the deliverable of this mechanism, not the absence of
      // one: it tells a reader that the whole declared scope names none of the rule's purpose-built
      // vocabulary, which is what the seat is asked to weigh. The evidence record is written only
      // beside `true`, because there is nothing to open when the answer is no.
      m.corroboratedInProject = corroborator !== undefined;
      if (corroborator !== undefined) m.corroboratedInProjectFrom = corroborator;
    }
  }

  // Suppression runs after every file has been read: a project-scoped guard may live in a file
  // that is walked long after the candidate was matched.
  for (const r of records) {
    // THE FILE'S SURVIVORS, collected before anything is reported, because the nested-duplicate
    // collapse below has to decide against the set a reader will actually be handed. A candidate a
    // gate or a guard removed is not "already reported" and may not stand in for one.
    //
    // Splitting the old single loop in two moves nothing: `matches` and `suppressed` are appended to
    // in the same candidate order they were appended to in before, so both arrays are the arrays
    // they were for every rule that collapses nothing — which is every rule that does not declare
    // the joined view.
    const survivors: RawMatch[] = [];
    const guardHits = new Set(r.guardHits);
    for (const m of rehydrated.get(r.index)!) {
      // A candidate a held gate removed one loop above. It is skipped rather than deleted from
      // `r.candidates`, so nothing about the array a file produced moves, and it is skipped BEFORE
      // the guard test so that a gate's own removal is never also recorded as a guard's.
      if (heldDropped.has(m)) continue;
      const isSuppressed = scope === "project" ? guardHitsProject.has(m.rule.id) : guardHits.has(m.rule.id);
      if (!isSuppressed) {
        survivors.push(m);
        continue;
      }
      const g = guardEvidence.get(m.rule.id);
      suppressed.push({
        ruleId: m.rule.id,
        file: m.file,
        line: m.line,
        guardPattern: g?.pattern ?? "(unknown)",
        guardFile: g?.file ?? "",
        guardLine: g?.line ?? 0,
      });
    }
    // ONE CONSTRUCT REPORTED AT SEVERAL DEPTHS, reported once — see `collapseNestedDuplicates`. It
    // runs HERE, per file, after the held gates and the guards, because a candidate the gate is
    // still holding is not yet a report and a candidate a guard deleted never becomes one; running
    // it during the walk would decide against a set the engine had not finished producing.
    // It returns an empty set for every file in which nothing was folded, which is every file of
    // every bundle where no rule declares the view.
    const collapsed = collapseNestedDuplicates(survivors);
    joinedOuterDuplicatesDropped += collapsed.size;
    for (const m of survivors) {
      if (collapsed.has(m)) continue;
      matches.push(m);
    }
  }

  return {
    matches,
    suppressed,
    corroborationSuppressed,
    filesScanned,
    filesSkipped,
    filesNotRead,
    filesPartiallyRead,
    filesCommentSyntaxUnregistered,
    filesReadFromUtf16,
    filesReadNotUtf8,
    filesCommentFormReadAsCode,
    commentFormsReadAsCode: commentFormsReadAsCodeByForm,
    derivedViewsBuilt,
    derivedViewsFailed,
    gatesOpenedByScope,
    joinedViewsBuilt,
    joinedViewsNotApplicable,
    joinedConstructsRefused,
    joinedOuterDuplicatesDropped,
    structural,
    filesOnSurface,
  };
}

/**
 * CAN THIS RULE'S CANDIDATES BE BELIEVED THE MOMENT THEIR OWN FILE IS DONE?
 *
 * THE ONE DEFINITION of §E.1 of an internal record, exported
 * because §E.5 requires the progress stream (step 5) and nothing else to call it: if the test were
 * ever written twice — once for the screen and once for the merge — the two would disagree the
 * first time a rule declared a new gate, and the screen would name a location the findings document
 * does not contain. The two conditions are read off `mergeShards` directly:
 *
 *  1. **No gate of this rule can still be open.** A gate is HELD, rather than shut, only where
 *     `held = widerScope && !alsoOk` in `scanFile` — so only for a rule whose `detector.gate_scope`
 *     is wider than its own file. Phase 2 of `mergeShards` decides those after the last file, and
 *     it can go either way: the scope may produce a corroborator (the candidate is released,
 *     carrying `corroborated_from`) or it may not (the candidate is deleted and recorded as a
 *     suppression). Neither answer exists while the walk is running. A rule at file scope reaches
 *     phase 2 with nothing held: its shut gates never put a candidate in `FileRecord.candidates` at
 *     all — they go to `suppressedLines` inside `scanFile`.
 *  2. **No `guard_missing` of this rule can still fire.** A guard that matches in ANY file
 *     suppresses every candidate of its own rule project-wide (`mergeShards`, `guardHitsProject`),
 *     and the file that carries it may be walked long after the candidate was raised. 0 of the 117
 *     rules in today's bundle declares one, and the mechanism is honoured rather than assumed away.
 *
 * **There is no `bundle` parameter**, which §E.5's sketch of this function expected: both conditions
 * turn out to be facts about the rule's own `detector`, because a guard is recorded against the rule
 * that declares it (`FileRecord.guardHits` holds rule ids) and never against another rule. A
 * parameter that was read by nothing would be a promise this function does not keep.
 *
 * The third condition of §E.1 — the file-local nested-duplicate collapse — is not a property of a
 * rule and is applied per record by `confirmedInRecord` below.
 */
export function isStreamable(rule: Rule): boolean {
  if (rule.detector.gate_scope !== undefined && rule.detector.gate_scope !== "file") return false;
  if ((rule.detector.guard_missing ?? []).length > 0) return false;
  return true;
}

/** The ids of every rule of this selection that `isStreamable` admits — computed once per scan. */
export function streamableRuleIds(rules: Rule[]): Set<string> {
  const ids = new Set<string>();
  for (const r of rules) if (isStreamable(r)) ids.add(r.id);
  return ids;
}

/** A matched (rule, file, line) that the finished document is certain to contain. */
export interface ConfirmedLocation {
  ruleId: string;
  file: string;
  line: number;
  lineText: string;
}

/** What one completed file may be said about while the walk is still running. */
export interface RecordConfirmation {
  /** In the order `scanFile` produced them, which is ascending line within the file. */
  confirmed: ConfirmedLocation[];
  /**
   * Candidates of this file whose fate is NOT decidable yet — a held gate's, or any candidate of a
   * rule `isStreamable` refuses. They are counted on the screen and never printed as locations.
   */
  deferred: number;
}

/**
 * The locations of one completed file that the finished document is certain to contain.
 *
 * WHAT MAKES THIS SAFE IS THAT IT SUBTRACTS THE SAME THREE THINGS `mergeShards` SUBTRACTS, and
 * subtracts them with the same code:
 *
 *  - **phase 2 of `gate_scope`** — every candidate a `heldGates` entry is holding is deferred. The
 *     index list is read from the record itself rather than derived from the rule, so a held
 *     candidate is excluded even if `isStreamable` were ever widened by mistake;
 *  - **`guard_missing`** — excluded by rule, in `isStreamable`;
 *  - **the nested-duplicate collapse** — `collapseNestedDuplicates`, THE SAME FUNCTION the merge
 *     calls, over the same per-rule group. It groups by rule and decides each group on its own, and
 *     for a streamable rule this file's survivors in the merge are exactly this rule's candidates
 *     here (nothing above removed any of them), so the group handed to it is the group the merge
 *     will hand it and the answer is the same answer. The shapes built below are throw-away — the
 *     merge rehydrates its own `RawMatch`es from the same `WireMatch`es — so the `absorbedOpenings`
 *     the collapse writes are written on objects nothing else reads, and cannot reach the document.
 *
 * A collapsed candidate is NOT counted as deferred: its fate IS decided here — the document will
 * carry it as an `also_opens_at` line on the report that absorbed it, never as a location of its
 * own — and calling it "held" would tell the reader to expect something at the end that is not
 * coming.
 */
export function confirmedInRecord(record: FileRecord, streamable: ReadonlySet<string>): RecordConfirmation {
  if (record.candidates.length === 0) return { confirmed: [], deferred: 0 };
  const held = new Set<number>();
  for (const g of record.heldGates) for (const i of g.candidateIndices) held.add(i);
  let deferred = 0;
  const shown: (CollapsibleCandidate & { lineText: string })[] = [];
  for (let i = 0; i < record.candidates.length; i++) {
    const w = record.candidates[i];
    if (held.has(i) || !streamable.has(w.ruleId)) {
      deferred++;
      continue;
    }
    shown.push({
      rule: { id: w.ruleId },
      line: w.line,
      lineText: w.lineText,
      ...(w.joinedFrom ? { joinedFrom: w.joinedFrom } : {}),
      ...(w.firedClauses ? { firedClauses: w.firedClauses } : {}),
    });
  }
  const collapsed = collapseNestedDuplicates(shown);
  const confirmed: ConfirmedLocation[] = [];
  for (const m of shown) {
    if (collapsed.has(m)) continue;
    confirmed.push({ ruleId: m.rule.id, file: record.file, line: m.line, lineText: m.lineText });
  }
  return { confirmed, deferred };
}

/**
 * Told about every file as its record is finished — the seam step 5's progress stream hangs on.
 *
 * It is handed the WHOLE `FileRecord` and never a formatted line, because §E.5 forbids the stream
 * computing anything the merge re-computes: everything the screen says about a file is derived from
 * this record by `confirmedInRecord` above, which is the merge's own subtraction. It is called once
 * per file, on the thread that owns the record — the scanning thread at `--jobs 1`, the main thread
 * as each chunk comes home above 1 — and it may not throw: a display that fails must not fail a scan.
 */
export type FileRecordListener = (record: FileRecord) => void;

/**
 * One shard of the walk: every file at these `indices`, scanned in the order given. A worker
 * (step 3c) will call this with a subset of `files`' indices; today's only caller, `runBuiltin`,
 * calls it with all of them.
 *
 * EVERY WORKER MUST `await prepareStructural()` ITSELF, ONCE, BEFORE THE FIRST CALL. The grammar
 * cache in `structural/grammars.ts` is module-level, so it is per-thread: a worker that skips it
 * gets `runtimeError` from `parserFor` for every language, every structural parse throws
 * `GrammarUnavailableError`, and `mergeShards` faithfully reports the result as
 * `structural.grammars_unavailable`. Nothing crashes and no gate necessarily turns red — the
 * candidates that reading would have raised simply do not exist. `scanShard` deliberately does not
 * call it: it is synchronous by construction (see `structural/grammars.ts`' header for why the
 * whole engine is), so the await has to happen in the worker's entry point, exactly as `runScan`
 * does it on the main thread today. `compileRules` must also run INSIDE each worker from the
 * bundle rather than being cloned across the boundary — `CompiledRule` holds `RegExp`s and the
 * whole `Rule` objects (step3-workers/proposal.md §F.3 #1).
 */
export function scanShard(
  compiled: CompiledRule[],
  targetRoot: string,
  indices: number[],
  files: string[],
  // Optional, and `null` by default, so a caller that wants the unfiltered engine — a direct
  // `scanShard` in a test, and any worker before stage 3c wires it — gets
  // exactly the pre-prefilter reading rather than a half-built one. `compilePrefilter`'s own
  // note says why a worker must build this itself rather than receive it over `postMessage`,
  // and why the sampler inside it still owes stage 3c a decision.
  prefilter: PrefilterScan | null = null,
  /**
   * The per-file wall-clock budget in milliseconds — `Infinity`, the default, is no budget.
   *
   * DEFAULTED TO OFF AT THIS LAYER AND TURNED ON BY THE `scan` COMMAND, which is the opposite of
   * what "on by default" first suggests, so the reason is written here. A budget
   * is a WALL-CLOCK ceiling: what it does to a document depends on how loaded the machine is. Every
   * caller in `tools/` is a gate whose whole contract is that its output is a function of its input
   * — `test:rules`, `test:mutations`, `test:shard-merge`, `test:long-line-scope` — and a ceiling
   * inside one of those would make a gate go red because another agent was compiling. The one path
   * a person's own tree travels is the `scan` command, and `index.ts` resolves 60 seconds there
   * unless `--file-budget` says otherwise. Omitting it here is therefore the pre-budget engine,
   * exactly, and cannot produce a document that differs from one.
   */
  fileBudgetMs = Infinity,
  // Optional, so every existing caller is the call it was. Called with each record the instant it
  // exists, BEFORE the next file is opened, which is what makes the stream a progress display
  // rather than a replay at the end. It cannot change a record: the record is already built when
  // this runs, and the array below holds the same objects whatever the listener does with them.
  onRecord?: FileRecordListener,
  // Optional and last, and `undefined` on every shipped path — see `EngineTestSeams`.
  seams?: EngineTestSeams,
  /**
   * Whether candidates carry their kind facts. Defaulted OFF at this layer and turned on by the
   * `scan` command, for the reason `fileBudgetMs` above is: every caller in `tools/` is a gate whose
   * contract is the document this scanner wrote before the census existed, and `scanShardOf` — the
   * one call a scanning path makes — takes the decision from `CompiledScan` where it cannot be
   * forgotten.
   */
  kindCensus = false,
  /**
   * The credential redaction step, or `null` (the default) for none — off for every direct caller in
   * `tools/`, as the census itself is. `scanShardOf` passes `CompiledScan.credentials`.
   */
  credentials: CredentialRedaction | null = null,
): ShardResult {
  return {
    records: indices.map((i) => {
      const record = scanFile(compiled, targetRoot, files[i], i, prefilter, fileBudgetMs, kindCensus, seams, credentials);
      onRecord?.(record);
      return record;
    }),
  };
}

/**
 * THE COMPILED BUNDLE AND THE PREFILTER BUILT FROM IT, AS ONE VALUE — so that no scanning caller
 * can hold the first without the second.
 *
 * `scanShard`'s `prefilter` parameter defaults to `null`, which is right for the direct
 * `mergeShards` attacks in a test and wrong for anything that scans a real
 * tree: a worker that forgot the argument would produce a correct but UNFILTERED scan, silently,
 * and the only symptom would be a slow run.
 * A default cannot be made to fail, so the omission is made impossible instead: `compileForScan`
 * is the only way to obtain a `CompiledScan`, it builds both halves in the order
 * `compilePrefilter`'s own note requires, and `scanShardOf` is the only call a worker makes.
 * `runBuiltin` below goes through the same pair, so `--jobs 1` and a worker compile identically.
 */
export interface CompiledScan {
  compiled: CompiledRule[];
  /** `null` exactly when the prefilter is switched off for this run — see `compilePrefilter`. */
  prefilter: PrefilterScan | null;
  /**
   * Whether every candidate of this scan carries its kind facts — the third thing a scanning caller
   * must not be able to hold half of.
   *
   * It rides on this value for the reason the prefilter does: `scanShardOf` is the only call a
   * worker makes, and a worker that resolved the switch for itself would be the second copy of a
   * decision this project forbids — two threads answering "is the census on?" separately can write one
   * document in which some candidates carry the facts and some do not.
   */
  kindCensus: boolean;
  /**
   * The credential redaction step of this scan (`credential-redaction.ts`), or `null` when the census
   * is off or the bundle carries no `baseline-002`. Built here, from the bundle alone, for the reason
   * the census switch rides here: a worker that built its own from a different source would write a
   * document whose labels depend on `--jobs`.
   */
  credentials: CredentialRedaction | null;
}

/**
 * Compile a rule set for scanning: the `CompiledRule[]` and the prefilter index over it, in the one
 * order that is correct (`compilePrefilter` mutates `compiled` in place and must see every rule).
 *
 * CALLED ONCE PER THREAD, never per chunk. `compileRules` costs 74 ms warm and 160 ms cold and
 * `compilePrefilter` walks every clause of every rule; a worker that called this per batch would
 * pay both per batch (step3-workers/proposal.md §F.3 #1, where a probe that did exactly that cost
 * ~10 s per worker on one tree).
 */
export function compileForScan(
  rules: Rule[],
  prefilterOptions?: PrefilterCallOptions,
  /**
   * Whether this scan computes the kind facts. `false` by default, so every gate and harness that
   * compiles a bundle is the call it was; the two scanning paths — `runBuiltin` and the worker —
   * both pass the run's resolved value.
   */
  kindCensus = false,
  /**
   * Whether the kind-census labels are redacted, with the CLI's OWN copy of `baseline-002`
   * (`productCredentials`) and never a loaded bundle's: no bundle can turn the
   * redaction off or change it, and a run narrowed by `--rules` redacts as a whole run does. The two
   * scanning paths pass `true`; a gate that passes nothing gets the engine it had.
   */
  redactLabels = false,
): CompiledScan {
  const compiled = compileRules(rules);
  const credentials = kindCensus && redactLabels ? productCredentials() : null;
  return { compiled, prefilter: compilePrefilter(compiled, prefilterOptions), kindCensus, credentials };
}

/*
 * THE PRODUCT'S OWN CREDENTIAL PATTERNS: compiled once, in product-redaction.ts,
 * which does not import this module (the judging closure needs the printed redaction without the engine's tree).
 * Re-exported here for every caller that already took them from the engine.
 */
export { productCredentials, productPrintedRedaction };

/** One shard of the walk, scanned by a `CompiledScan` — `scanShard` with the prefilter it must not omit. */
export function scanShardOf(
  scan: CompiledScan,
  targetRoot: string,
  indices: number[],
  files: string[],
  /** REQUIRED, unlike `scanShard`'s own: the two callers of this function are the worker and
   * `runBuiltin`, i.e. the two halves of one scan, and they must not be able to disagree about the
   * budget by one of them forgetting it. `Infinity` is how a caller says "no budget" out loud. */
  fileBudgetMs: number,
  onRecord?: FileRecordListener,
  // Optional and last, and `undefined` on every shipped path — see `EngineTestSeams`. It is
  // threaded through here because `runBuiltin` reaches `scanFile` only through this function: the
  // worker pool (worker-entry.ts) never passes one, so the seam stays a main-thread test path.
  seams?: EngineTestSeams,
): ShardResult {
  return scanShard(
    scan.compiled,
    targetRoot,
    indices,
    files,
    scan.prefilter,
    fileBudgetMs,
    onRecord,
    seams,
    scan.kindCensus,
    scan.credentials,
  );
}

export function runBuiltin(
  rules: Rule[],
  targetRoot: string,
  files: string[],
  scope: GuardScope,
  profile: ScanProfile | null,
  // Optional and last: every existing caller (scan.ts, and through it both the `scan` command and
  // test-rules.ts) is unchanged and gets `resolvePrefilterRuntimeOptions(undefined)` — prefilter on,
  // self-check rate 100, unless the environment says otherwise. See that function for why the CLI's
  // `--no-prefilter` reaches this through the environment rather than through a new `ScanOptions`
  // field: `scan.ts` carries no second copy of the switch. `overrideLiteralsForTest` on the same
  // object is the test-only seam described above `PrefilterLiteralOverrideForTest`, and this
  // parameter is the ONLY way into it.
  prefilterOptions?: PrefilterCallOptions,
  // The per-file wall-clock budget in milliseconds; `Infinity` (the default) is no budget. Optional
  // and seventh for the reason `prefilterOptions` above it is: every existing caller — the gate tools,
  // `test-rules.ts`, `runScanPasses` before it was changed — is unchanged and gets the engine it had.
  // See `scanShard` for why the default here is off while the `scan` command's default is 60 seconds.
  fileBudgetMs = Infinity,
  // The step-5 progress seam, optional and eighth for the same reason `prefilterOptions` is: every
  // existing caller — `scan.ts` with no `--progress`, `test-rules.ts`, the mutation harness — is the
  // call it was, and passes nothing. See `FileRecordListener`.
  onRecord?: FileRecordListener,
  // Optional and ninth: the test-only seams of `EngineTestSeams`. Every shipped caller passes at
  // most eight arguments, so this is `undefined` in production and the branch it gates is dead there.
  seams?: EngineTestSeams,
  // Whether candidates carry their kind facts, optional and tenth for the reason every optional
  // parameter above it is: a gate or a harness that passes nothing gets the engine it had. `scan.ts`
  // passes the run's resolved `--kind-census` value and is the only caller that does.
  kindCensus = false,
  // Whether the labels are redacted (with the CLI's own patterns), optional and eleventh for the reason
  // `kindCensus` is: only `scan.ts` passes it, and every gate gets the engine it had. See `compileForScan`.
  redactLabels = false,
): EngineResult {
  // EVERY RULE IS COMPILED AND EVERY RULE READS THE TREE. The `profile` parameter is kept and is
  // deliberately unread: a signature that no longer mentions the profile would let a later reader
  // re-introduce the gate somewhere else without noticing that it had been taken out here on
  // purpose. Until 2026-08-27 this line was
  // `compile(rules).filter((c) => preconditionsMet(c.rule, profile))`, and a drafted, unconfirmed
  // answer in the person's own profile was enough to stop a detector from opening a file — the
  // strongest form of a state that must not be reported, because a rule that never ran and a tree
  // that is genuinely in order produce the identical blank. See `preconditionsMet` above for the
  // measurement that priced removing the switch.
  // The compiled rules AND the required-literal prefilter built over them (prefilter.ts), as the
  // one value `CompiledScan` — built ONCE per scan from the bundle alone, no corpus sample and no
  // reading of `targetRoot`, and handed to every file below. The prefilter half is `null` when it
  // is switched off, which is the byte-identical pre-prefilter engine. A stage-3c worker builds the
  // identical pair with the identical call, which is what makes `--jobs 1` and `--jobs N` the same
  // reading rather than two readings that agree by inspection.
  const scan = compileForScan(rules, prefilterOptions, kindCensus, redactLabels);
  const compiled = scan.compiled;
  // ONE IMPLEMENTATION OF THE MERGE, and `--jobs 1` (or the whole engine today, before `--jobs`
  // exists) is this exact call over a single shard holding every file in walk order — see
  // step3-workers/proposal.md A.1: "the reference behaviour stays in the binary" without a second
  // copy of it. Worker dispatch (step 3c) replaces this one call with several, one per worker, each
  // over its own index list, and calls `mergeShards` once, here, over every `ShardResult` they
  // return — in whatever order they finish, which is exactly what `mergeShards` is keyed to ignore.
  const shard = scanShardOf(
    scan,
    targetRoot,
    files.map((_, i) => i),
    files,
    fileBudgetMs,
    onRecord,
    seams,
  );
  return mergeShards(compiled, [shard], scope, files.length);
}

/**
 * TEST-ONLY determinism probe for stage 3b — no threads exist yet. Splits the walk list into `k`
 * INTERLEAVED shards (file index `i` goes to shard `i % k`, never a contiguous block, so a shard
 * boundary lands mid rule-group on any tree), scans each shard's files in the order `order` picks,
 * hands the shards to `mergeShards` in an order that also varies with it, and returns the merged
 * `EngineResult`.
 *
 * The caller (a test) compares this against `runBuiltin`'s own output for the
 * same inputs: the two must be byte-identical for every `k` and every `order`, because
 * `mergeShards` is keyed on `FileRecord.index` and reads nothing else — see
 * step3-workers/proposal.md §B.1-§B.3. This is the test that fails if the merge ever reads arrival
 * order instead; nothing in a normal scan calls it.
 */
export function scanShardedForTest(
  rules: Rule[],
  targetRoot: string,
  files: string[],
  scope: GuardScope,
  k: number,
  order: "forward" | "reverse" | number,
): EngineResult {
  // Built exactly as `runBuiltin` builds it, so the probe compares this engine against itself and
  // not a filtered reading against an unfiltered one. ONE sampler is shared by the `k` shards —
  // the traversal is one thread here — and since stage 3c that costs nothing: the sampler is
  // re-seeded from each file's own walk index at the top of `scanFile`, so which pairs it spot-
  // checks is the same set at every `k` and every `order` (see `SelfCheckSampler.startFile`).
  const scan = compileForScan(rules);
  const compiled = scan.compiled;
  const shardIndices: number[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < files.length; i++) shardIndices[i % k].push(i);

  const orderIndices = (idx: number[]): number[] => {
    if (order === "forward") return idx;
    if (order === "reverse") return [...idx].reverse();
    // A small seeded PRNG (mulberry32) rather than `Math.random()`: a failing seed has to be
    // reportable and reproducible, which a probe seeded from the clock cannot promise.
    let seed = order >>> 0;
    const next = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const shuffled = [...idx];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  // No budget: this probe exists to compare two readings of the same tree for byte identity, and a
  // wall-clock ceiling would make the comparison depend on the box rather than on the merge.
  const shards = shardIndices.map((idx) => scanShardOf(scan, targetRoot, orderIndices(idx), files, Infinity));
  // Handed to the merge in reverse REGISTRATION order whenever `order` is not `"forward"`, so the
  // probe also attacks the other axis the design calls out: a merge that secretly trusted which
  // `ShardResult` arrived first, rather than only `FileRecord.index`.
  const shardsForMerge = order === "forward" ? shards : [...shards].reverse();
  return mergeShards(compiled, shardsForMerge, scope, files.length);
}

export function fingerprint(ruleId: string, file: string, lineText: string): string {
  const h = createHash("sha256")
    .update(`${ruleId}|${file}|${lineText.replace(/\s+/g, " ").trim()}`)
    .digest("hex");
  return `fp_${h.slice(0, 16)}`;
}

/**
 * The `finding_id` of ONE PART of a group `splitOversizedGroups` divided — a separate hash space
 * from `fingerprint` above, and that separation is the whole reason this is its own function.
 *
 * The part id was first written as `fingerprint(ruleId, groupId, "part N")`, which hashes
 * `ruleId|groupId|part N`. `fingerprint` hashes `ruleId|file|lineText`. The two strings are built
 * the same way out of unrelated things, so a candidate of the SAME rule matched in a file whose
 * path happens to be the group's own fingerprint, on a line whose whitespace-normalised text
 * happens to be `part 2`, is given the identical preimage and therefore the identical id. That is
 * not hypothetical: an independent verification built the tree and reproduced it on 2026-08-27 — one document, two candidates, one
 * `finding_id` (`fp_4619e2393313bf40`), which `ropa.ts` would answer with a single verdict while
 * its own completeness check saw nothing wrong. Before the split existed, two candidates could
 * share an id only by a SHA-256 collision, and this restores that.
 *
 * The separator is NUL, which no preimage of `fingerprint` can contain: `ruleId` comes from a rule
 * id, `file` from a filesystem path (POSIX forbids NUL in a path, and Node throws on one before a
 * read can happen) and `lineText` from text that has had every whitespace run collapsed. So the two
 * spaces are disjoint by construction rather than by unlikelihood, and a collision between a part
 * and an ordinary candidate again requires a hash collision.
 *
 * `fingerprint` itself is deliberately NOT changed: every `finding_id` in every findings document
 * this repository has written comes out of it, and re-domaining it would move all of them.
 */
export function groupPartFingerprint(ruleId: string, groupId: string, part: number): string {
  const h = createHash("sha256")
    .update(`${ruleId}\u0000group-part\u0000${groupId}\u0000${part}`)
    .digest("hex");
  return `fp_${h.slice(0, 16)}`;
}

