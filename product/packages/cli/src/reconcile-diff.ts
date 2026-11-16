/**
 * Deterministic comparison of two pillar-2 runs: which side moved, and which conclusions are stale.
 *
 * ## What this is
 *
 * A reconciliation run leaves two artifacts in `.legal/`: `reconcile-input.json`, which the CLI
 * settles without judgement, and `declarations.json`, which the agent writes from it. Re-running the
 * whole thing on every commit re-reads every document and re-judges every item, and most of that
 * work answers questions nothing has touched. This command takes the artifacts of two runs and says
 * three things, computed rather than narrated:
 *
 *   (a) THE CODE SIDE MOVED — the documents' digests are unchanged and the census of what the code
 *       does is not. For every fact that appeared or disappeared, the checklist items whose
 *       `census_categories` cover it, and the claims and findings that refer to it, are listed as
 *       POSSIBLY STALE, each with the sentence saying which fact and which item.
 *   (b) THE DOCUMENT SIDE MOVED — a document's sha256 changed, or the document is gone. The claims
 *       drawn from it are matched across the two runs to show which vanished, which appeared and
 *       which merely moved down the page, and the checklist results and findings that quote it are
 *       listed as NEEDING RE-CHECKING.
 *   (c) BOTH — the union of the two, plus a `saved` count: the conclusions that appear on both sides
 *       and in neither list, which is what an incremental re-check may skip against a full re-run.
 *
 * **No model runs here.** Re-judging the items this command names is the user's agent's option, and
 * the cost saved is the reason the list is computed at all.
 *
 * ## What it may say, and what it may not
 *
 * `possibly stale` and `needs re-checking` are the strongest words in this file. Nothing here
 * asserts that a document is wrong, that a conclusion was mistaken, or that any legal requirement is
 * met or missed: two runs disagreeing is a question about which of them describes today.
 *
 * **`saved` is never "re-verified".** A saved conclusion is one nothing in this comparison touched;
 * it carries forward with the evidence of the run it came from, and the report that carries it says
 * which run that was. The mechanical links this file can follow are the ones the schemas carry —
 * `fact_refs`, `searches[]`, `census_categories`, `evidence[].doc`, `evidence[].document_ref`,
 * `searches[].hits[].document_ref`, `quote.doc`,
 * `depends_on_runtime_config` — and a conclusion resting on something none of those names is not
 * thereby unaffected. That is stated in the output itself, in `stats.saved.not_asserted`, rather
 * than only here.
 *
 * ## What is NOT in scope, deliberately
 *
 * **Generated replacement text for a document is excluded** — settled against this work item, and
 * not a gap for a later session to fill: this command emits questions about existing text and never
 * new text.
 *
 * **A PR/CI mode is a reserved successor.** The same comparison run inside continuous integration is
 * a separate piece of work; the frame is held and nothing of it is implemented here.
 *
 * **Pillar-1 candidates are not diffed.** A run's code-scan findings file is read only far enough to
 * record whether each run had one, how many candidate rows it held and which tree it named, because
 * the overlap annotations a reconciliation carries come from it. Comparing pillar-1 candidates to
 * each other is a different question and this command does not answer it.
 *
 * ## Identity across runs — the one thing this design rests on
 *
 * Line numbers drift for reasons that have nothing to do with meaning, so nothing here is keyed on a
 * position. Every record is keyed on its CONTENT, and the normalisation is stated once, in
 * `reconcile-diff.schema.json`'s `$defs.contentKey`, which is the statement of record. It is not
 * restated here, for the reason the project's rules give about two copies of one fact; the functions below
 * carry only the reason each STEP is there, beside the step.
 *
 * ## Determinism
 *
 * No clock, no randomness, no environment read, no network. The two runs' own `generated_at` values
 * are carried; this file adds no timestamp of its own, so two comparisons of the same pair of
 * directories produce byte-identical output and a gate can pin it.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  CensusFact,
  Checklist,
  ChecklistItem,
  ChecklistResult,
  DeclarationClaim,
  DeclarationFinding,
  DeclarationsReport,
  Findings,
  ReconcileDiff,
  ReconcileDiffClaimPair,
  ReconcileDiffCounts,
  ReconcileDiffDocumentEntry,
  ReconcileDiffFactRef,
  ReconcileDiffMaybeCounts,
  ReconcileDiffMovedFact,
  ReconcileDiffNotComputed,
  ReconcileDiffSaved,
  ReconcileDiffSide,
  ReconcileDiffStaleEntry,
  ReconcileDiffStaleLink,
  ReconcileDiffStaleRef,
  ReconcileDiffUnmatched,
  ReconcileInput,
  ReconcileRunIdentity,
} from "wolfboy-schemas";
import { buildDocumentCorpus, verifyOneQuote } from "./reconcile-verify.js";
import { readFindingsText } from "./log-digest.js";
import { readRegularFile } from "./project-read.js";

/**
 * The document's own types live in `wolfboy-schemas` beside every other public data contract, and
 * are re-exported here under the names this module works in. One declaration, two names: the schema
 * package is where a consumer looks for the shape of a file this CLI writes, and a second copy in
 * this file would be the copy that goes stale.
 */
export type {
  ReconcileDiff,
  ReconcileDiffClaimPair as ClaimPairEntry,
  ReconcileDiffCounts as ClassCounts,
  ReconcileDiffDocumentEntry as DocumentDiffEntry,
  ReconcileDiffFactRef as FactRef,
  ReconcileDiffMaybeCounts as MaybeCounts,
  ReconcileDiffMovedFact as MovedFact,
  ReconcileDiffNotComputed as NotComputed,
  ReconcileDiffSaved as SavedCount,
  ReconcileDiffSide as RunSide,
  ReconcileDiffStaleEntry as StaleEntry,
  ReconcileDiffStaleLink as StaleLink,
  ReconcileDiffStaleRef as StaleRef,
  ReconcileDiffUnmatched as UnmatchedEntry,
  ReconcileRunIdentity as RunIdentity,
};

type RunSide = ReconcileDiffSide;
type FactRef = ReconcileDiffFactRef;
type MovedFact = ReconcileDiffMovedFact;
type DocumentDiffEntry = ReconcileDiffDocumentEntry;
type StaleRef = ReconcileDiffStaleRef;
type StaleLink = ReconcileDiffStaleLink;
type StaleEntry = ReconcileDiffStaleEntry;
type ClaimPairEntry = ReconcileDiffClaimPair;
type UnmatchedEntry = ReconcileDiffUnmatched;
type ClassCounts = ReconcileDiffCounts;
type NotComputed = ReconcileDiffNotComputed;
type MaybeCounts = ReconcileDiffMaybeCounts;
type SavedCount = ReconcileDiffSaved;
type RunIdentity = ReconcileRunIdentity;

/**
 * Bumped whenever the keying, the matching or the direction rules change, so a reader of a stored
 * `reconcile-diff.json` can tell which behaviour produced it. Same role as the quote verifier's own
 * version number, and deliberately its own: the two tools share a waterfall, not a lifecycle.
 */
export const RECONCILE_DIFF_VERSION = 1;

/** Exit code when the two runs describe the same state under the content keys. */
export const EXIT_NO_DIFFERENCES = 0;

/**
 * Exit code when at least one difference was found in the compared artifacts.
 *
 * **A DIFFERENCE IS NOT AN ERROR**, and this code says so by not being 1 or 2, which this CLI
 * reserves for a caller's mistake and an unreadable file. Two runs of a repository under development
 * are supposed to differ; a caller who wants the comparison written and read by a person never looks
 * at the code, and a caller deciding whether to spend a re-judgement pass branches on it.
 *
 * **6 IS DELIBERATELY REUSED RATHER THAN UNIQUE, and the first version of this comment said the
 * opposite.** It claimed 6 was free because "each of 3, 4, 5 and 7 already means something else",
 * having checked those four and not this one: `questionnaire.ts`'s `EXIT_NO_ITEMS` is 6, has been
 * since that command shipped, and is reached through the real CLI by `questionnaire ingest` when a
 * source decomposes into no questions at all. An independent verifier found the false sentence in
 * `--help`, where it reaches the user. What is true, and what the number now rests on: no invocation
 * runs both commands, so an exit status is read against the command that produced it, and 6 from
 * THIS command means differences-found and nothing else. The numbers that are NOT free — because a
 * caller could plausibly hold one of them beside a comparison — are 3 and 4 (`scan`: a candidate met
 * the severity threshold; the scan reached nothing), 5 (`reconcile-verify` and `questionnaire
 * verify`: a quotation could not be verified as written) and 7 (`questionnaire verify` and `export`:
 * the answers do not fit the questionnaire). A test enumerates every
 * exported `EXIT_*` constant in this package and fails if a THIRD command ever binds 6, so the next
 * collision is loud rather than discovered by reading.
 *
 * WHAT DOES NOT SET IT. A bundle-version mismatch, a `reconcile_id` collision and a target mismatch
 * are DISCLOSED, in the first block on the screen, and none of them changes this code ON ITS OWN.
 * They say which machinery produced the two artifacts, not whether the artifacts differ — the same
 * line `reconcile-verify` takes with a document digest mismatch, and for the same reason: a
 * comparison whose only news is that the rule bundle moved has still found no difference between the
 * two states, and reporting one would make every bundle upgrade look like a change to the user's
 * repository. **"On its own" is load-bearing**: a bundle upgrade that adds or drops a checklist item
 * exits 6 through `checklist_items`, which is a real difference in the questions being asked.
 */
export const EXIT_DIFFERENCES_FOUND = 6;

/** The file each run directory is expected to carry, and the ones that are optional. */
export const RECONCILE_INPUT_FILE = "reconcile-input.json";
export const DECLARATIONS_FILE = "declarations.json";
/** The annotated copy `reconcile-verify` writes. Read only where the agent's own file is absent. */
export const DECLARATIONS_VERIFIED_FILE = "declarations.verified.json";
export const FINDINGS_FILE = "findings.json";

export const RECONCILE_DIFF_DISCLAIMER =
  "This comparison is informational only and does not constitute legal advice. It reports where two " +
  "reconciliation runs differ and which earlier conclusions may no longer describe the current " +
  "state; it asserts nothing about any document, any code path or any legal requirement.";

/* --------------------------------------------------------------------------------------------- *
 * Normalisation. The rules themselves are stated in reconcile-diff.schema.json $defs.contentKey.
 * --------------------------------------------------------------------------------------------- */

/**
 * The two operations every text component of every key goes through, in this order.
 *
 * Whitespace first, then case, so that a value reflowed across a line and a value shouted in capitals
 * reach the same string by either route. The whitespace class is the regex `\s` plus the no-break
 * space and the byte-order mark, written as escapes so this source stays readable and greppable.
 */
export function foldText(value: string): string {
  return String(value ?? "")
    .replace(/[\s\u00a0\ufeff]+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * `true` for the one collector whose captured values can carry a `:port` suffix.
 *
 * `outbound-hosts` is the only collector in the census whose patterns admit one — its two
 * scheme-bearing patterns end `(?::\d+)?` — and the reconciliation skill already records the
 * consequence for a reader comparing tracking domains: census host values keep the port
 * (`ads.example.com:443`), so that comparison is not string equality. Every other collector's
 * character class stops at the colon or never meets one, so no rule is needed for them and none is
 * applied: a `distribution` fact valued `npm:private` keeps every character it has.
 */
function collectorCarriesPorts(collector: string): boolean {
  return collector === "outbound-hosts";
}

/**
 * The captured value as a key component.
 *
 * The port is dropped from the KEY and from nothing else: the fact's own `value` is carried into
 * every list and every sentence this file writes exactly as the census produced it, so a reader
 * always sees the port even where the comparison ignored it. A host reached on 443 in one run and on
 * 8443 in the next is one recipient that moved port, not one recipient gone and another arrived.
 */
export function censusValueKey(collector: string, value: string): string {
  const folded = foldText(value);
  if (!collectorCarriesPorts(collector)) return folded;
  const m = /^(.+):(\d+)$/.exec(folded);
  return m && m[1].length > 0 ? m[1] : folded;
}

/**
 * Length-prefixed join, so no component's characters can be read as the separator.
 *
 * `a|b` and `a` + `|b` are one string under a plain separator, and a folded finding text is
 * agent-written prose that may contain anything. `2:ab|1:c` cannot be produced by any other list.
 * ASCII throughout: a control byte as a separator is what made one source file in this repository
 * invisible to grep, and the source-text gate exists because of it.
 */
function joinKey(parts: string[]): string {
  return parts.map((p) => `${p.length}:${p}`).join("|");
}

/**
 * `collector + kind + normalised value + file`. **The line is deliberately absent**, which is what
 * makes pure position drift a `moved` row rather than a removal and an addition.
 *
 * `collector`, `kind` and `file` go in verbatim rather than folded. The first two are produced by
 * this code base from its own vocabulary, and the third is a path: two files whose names differ only
 * in case are two files on the platforms this runs on, and folding them together would merge two
 * real facts into one.
 */
export function censusFactKey(fact: CensusFact): string {
  return joinKey([
    fact.collector ?? "",
    fact.kind ?? "",
    censusValueKey(fact.collector ?? "", fact.value ?? ""),
    fact.file ?? "",
  ]);
}

/** `normalised claim sentence + document`. The claim's own quote is compared separately. */
export function claimKey(claim: DeclarationClaim): string {
  return joinKey([foldText(claim.claim ?? ""), claim.source_location?.doc ?? ""]);
}

/** The claim's quoted words, folded — the second, confirming key. See `matchClaims`. */
export function claimQuoteKey(claim: DeclarationClaim): string {
  return joinKey([foldText(claim.quote ?? ""), claim.source_location?.doc ?? ""]);
}

/** `direction + categories + normalised finding text`. Categories are sorted, so order cannot key. */
export function findingKey(finding: DeclarationFinding): string {
  const categories = [...(finding.categories ?? [])].sort().join(",");
  return joinKey([finding.direction ?? "", categories, foldText(finding.finding_text ?? "")]);
}

/** `checklist_id + item_id`, both verbatim: they are stable identifiers and were never prose. */
export function checklistKey(checklistId: string, itemId: string): string {
  return joinKey([checklistId ?? "", itemId ?? ""]);
}

/* --------------------------------------------------------------------------------------------- *
 * Reading a run directory.
 * --------------------------------------------------------------------------------------------- */

/** What one run directory carried, with a sentence for every artifact it did not. */
export interface RunArtifacts {
  side: RunSide;
  dir: string;
  input: ReconcileInput;
  input_file: string;
  report: DeclarationsReport | null;
  report_file: string | null;
  findings: Findings | null;
  findings_file: string | null;
  /** One sentence per absent or substituted optional artifact. Empty when both were present. */
  absences: string[];
  /**
   * The one sentence in `absences` that is about the AGENT REPORT, or null where a report was read.
   *
   * Held apart because the not-computed reasons are about the report and nothing else, and pasting
   * the whole of `absences` into them buried the explaining sentence in a paragraph about the code
   * scan's findings file — roughly 1,400 characters of it, four times over, on a pair that merely
   * had no `findings.json`. Found by an independent verifier, 2026-09-02.
   */
  report_absence: string | null;
}

/** Raised when a run directory cannot supply what the comparison needs. */
export class ReconcileDiffRefusal extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.name = "ReconcileDiffRefusal";
    this.exitCode = exitCode;
  }
}

function readJson<T>(path: string, label: string, read: (path: string) => string = (p) => readRegularFile(p, "utf8")): T {
  let text: string;
  try {
    text = read(path);
  } catch (e) {
    throw new ReconcileDiffRefusal(`${label} ${path} could not be read: ${(e as Error).message}`, 2);
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new ReconcileDiffRefusal(
      `${label} ${path} could not be read as JSON: ${(e as Error).message}`,
      2,
    );
  }
}

/**
 * Read one run's artifacts, and say in words what was not there.
 *
 * **An absence is never silent.** Comparing a pair of directories where one has no agent report is an
 * ordinary thing to want — the deterministic half alone answers "did the code move" — and it is also
 * exactly the shape in which a missing file would otherwise print as "no claims changed". Every
 * optional artifact that is not there produces a sentence, the sentences are carried in the output
 * document and printed on the console, and the sections they would have filled are marked
 * not-computed rather than empty.
 */
export function readRunArtifacts(side: RunSide, dir: string): RunArtifacts {
  const inputPath = join(dir, RECONCILE_INPUT_FILE);
  if (!existsSync(inputPath)) {
    /* THE REFUSAL NAMES THE PATH IT TRIED, AND WHERE IT FOUND ONE INSTEAD.
     *
     * Hole 3 of the bitwarden-url run, 2026-09-03: this message said only that the directory "carries
     * no reconcile-input.json", and the run's own layout keeps that file one level down, in
     * `<run>/reconcile/`. The reader had to open this source to learn that the lookup is flat, and
     * worked around it with scratch symlinks. The lookup is still flat — where the file should live
     * is a question for whoever owns the layout, not one to settle inside an error message — but the
     * refusal now says the exact path it tried and names any nested candidate it can see, so the
     * mismatch is legible from the terminal. */
    /* **The scan for a nested candidate is a CONVENIENCE and may not become a second failure mode.**
     * `readdirSync` throws `ENOTDIR` when `--before` names a file and `EACCES` when the directory
     * cannot be listed, and it runs before the refusal below — so the first version of this repair
     * replaced a clear sentence with a raw stack trace for the most likely next mistake after the one
     * hole 3 records: pointing `--before` at `reconcile-input.json` itself. Independent verification,
     * 2026-09-03, M1. Whatever goes wrong here, the answer the caller needs is the refusal. */
    let nested: string[] = [];
    try {
      nested = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, RECONCILE_INPUT_FILE)))
        .map((e) => join(dir, e.name, RECONCILE_INPUT_FILE));
    } catch {
      nested = [];
    }
    throw new ReconcileDiffRefusal(
      `--${side} ${dir} carries no ${RECONCILE_INPUT_FILE}: nothing exists at ${inputPath}. That file is the ` +
        `deterministic half of a reconciliation run and the only one this comparison requires; without it there ` +
        `is nothing to compare on that side. This lookup is FLAT — ${RECONCILE_INPUT_FILE} and ` +
        `${DECLARATIONS_FILE} are read directly under the directory given, which is the layout a run writes into ` +
        `the project's .legal directory.` +
        (nested.length > 0
          ? ` One does exist one level down, at ${nested.join(", ")} — point --${side} at that directory, or at a directory holding those two files.`
          : ` Point --${side} at the directory a run wrote.`),
      1,
    );
  }
  const input = readJson<ReconcileInput>(inputPath, `--${side}`);

  const absences: string[] = [];
  let reportAbsence: string | null = null;
  let report: DeclarationsReport | null = null;
  let reportFile: string | null = null;
  const declarations = join(dir, DECLARATIONS_FILE);
  const verified = join(dir, DECLARATIONS_VERIFIED_FILE);
  if (existsSync(declarations)) {
    report = readJson<DeclarationsReport>(declarations, `--${side}`);
    reportFile = DECLARATIONS_FILE;
  } else if (existsSync(verified)) {
    // The annotated copy carries the same conclusions with the quote check added beside them, so it
    // answers every question this comparison asks. Read rather than passed over, because "the report
    // is not here" would be false of a directory that plainly holds one.
    report = readJson<DeclarationsReport>(verified, `--${side}`);
    reportFile = DECLARATIONS_VERIFIED_FILE;
    absences.push(
      `the ${side.toUpperCase()} run has no ${DECLARATIONS_FILE}; the annotated copy ` +
        `${DECLARATIONS_VERIFIED_FILE} was read instead, which carries the same conclusions with the ` +
        `mechanical quote check added beside them.`,
    );
  } else {
    reportAbsence =
      `The agent report was not present in the ${side.toUpperCase()} run (neither ${DECLARATIONS_FILE} ` +
      `nor ${DECLARATIONS_VERIFIED_FILE} is in ${dir}); claim-level, finding-level and ` +
      `checklist-result-level diffing was not performed, and the sections for them say so rather ` +
      `than reporting that nothing changed.`;
    absences.push(reportAbsence);
  }

  let findings: Findings | null = null;
  let findingsFile: string | null = null;
  const findingsPath = join(dir, FINDINGS_FILE);
  if (existsSync(findingsPath)) {
    // A document changed after the scan is refused (log-digest.ts `readFindingsText`).
    findings = readJson<Findings>(findingsPath, `--${side}`, (p) => readFindingsText(p));
    findingsFile = FINDINGS_FILE;
  } else {
    absences.push(
      `the code scan's ${FINDINGS_FILE} was not present in the ${side.toUpperCase()} run, so this ` +
        `comparison says nothing about the pillar-1 overlap annotations that run carried. It does not ` +
        `compare pillar-1 candidates with each other in any case.`,
    );
  }

  return {
    side,
    dir,
    input,
    input_file: RECONCILE_INPUT_FILE,
    report,
    report_file: reportFile,
    findings,
    findings_file: findingsFile,
    absences,
    report_absence: reportAbsence,
  };
}

/* --------------------------------------------------------------------------------------------- *
 * Matching. One routine, used by every record class.
 * --------------------------------------------------------------------------------------------- */

interface Keyed<T> {
  key: string;
  record: T;
  /** Position within its own side's array, so a pairing can be reported and re-found. */
  index: number;
}

interface Pairing<T> {
  matched: { key: string; before: Keyed<T>; after: Keyed<T> }[];
  onlyBefore: Keyed<T>[];
  onlyAfter: Keyed<T>[];
}

/**
 * Pair two sides by content key, as MULTISETS rather than as sets.
 *
 * Two records can share a key legitimately — the same host reached twice in one file on two ports,
 * the same claim sentence drawn from two passages of one document — and a set-based join would
 * quietly report one of them and drop the other. Here a key held by two records on the left and one
 * on the right pairs two of them and leaves one unpaired, which is what actually happened. The
 * unpaired ones are the added and removed populations, and every one of them is named in `unmatched`.
 *
 * Deterministic: within a key, records pair in the order their own side's array carries them.
 */
function pairByKey<T>(before: Keyed<T>[], after: Keyed<T>[]): Pairing<T> {
  const afterByKey = new Map<string, Keyed<T>[]>();
  for (const item of after) {
    const list = afterByKey.get(item.key);
    if (list) list.push(item);
    else afterByKey.set(item.key, [item]);
  }
  const matched: Pairing<T>["matched"] = [];
  const onlyBefore: Keyed<T>[] = [];
  const consumed = new Set<Keyed<T>>();
  for (const item of before) {
    const partner = afterByKey.get(item.key)?.shift();
    if (partner) {
      matched.push({ key: item.key, before: item, after: partner });
      consumed.add(partner);
    } else {
      onlyBefore.push(item);
    }
  }
  const onlyAfter = after.filter((a) => !consumed.has(a));
  return { matched, onlyBefore, onlyAfter };
}

function keyed<T>(records: T[], keyOf: (r: T) => string): Keyed<T>[] {
  return records.map((record, index) => ({ key: keyOf(record), record, index }));
}

/* --------------------------------------------------------------------------------------------- *
 * The output document. Its types are declared in `wolfboy-schemas` and imported at the head of
 * this file; only the one predicate over them lives here.
 * --------------------------------------------------------------------------------------------- */

/** Narrows the union without a reader having to remember which member carries `computed`. */
export function hasCounts(counts: MaybeCounts): counts is ClassCounts {
  return !("computed" in counts);
}

/* --------------------------------------------------------------------------------------------- *
 * Building it.
 * --------------------------------------------------------------------------------------------- */

function factRefOf(fact: CensusFact): FactRef {
  return {
    fact_id: fact.fact_id ?? "",
    collector: fact.collector ?? "",
    kind: fact.kind ?? "",
    value: fact.value ?? "",
    categories: [...(fact.categories ?? [])],
    file: fact.file ?? "",
    line: fact.line ?? 0,
  };
}

function identityOf(run: RunArtifacts): RunIdentity {
  const candidates = run.findings?.candidates;
  return {
    dir: run.dir,
    reconcile_id: run.input.reconcile_id ?? "",
    generated_at: run.input.generated_at ?? "",
    target: run.input.target ?? "",
    bundle_version: run.input.bundle?.version ?? "",
    bundle_sha256: run.input.bundle?.sha256 ?? null,
    documents: (run.input.documents ?? []).length,
    census_facts: (run.input.census?.facts ?? []).length,
    input_file: run.input_file,
    report_file: run.report_file,
    report_reconcile_id: run.report?.reconcile_id ?? null,
    report_completed_at: run.report?.completed_at ?? null,
    findings_file: run.findings_file,
    findings_scan_id: run.findings?.scan_id ?? null,
    findings_target: run.findings?.target ?? null,
    findings_candidates: Array.isArray(candidates) ? candidates.length : null,
  };
}

interface KeyedItem {
  key: string;
  checklist_id: string;
  item: ChecklistItem;
}

/** Every checklist item of a run's bundled checklists, addressed by its stable pair of ids. */
function checklistItemsOf(input: ReconcileInput): KeyedItem[] {
  const out: KeyedItem[] = [];
  for (const list of (input.checklists ?? []) as Checklist[]) {
    for (const item of list.items ?? []) {
      out.push({
        key: checklistKey(list.checklist_id, item.id),
        checklist_id: list.checklist_id,
        item,
      });
    }
  }
  return out;
}

/**
 * Claims, matched on the claim sentence first and on the quoted words second.
 *
 * The primary key is the one the design of record names: the claim sentence and the document. The
 * SECOND pass exists because the two fields fail in opposite directions and neither alone is safe.
 * The claim sentence is the agent's paraphrase and can be reworded between runs over an unchanged
 * document, which the primary key alone reports as one claim vanishing and another appearing; the
 * quotation is the document's own words and can be identical for two claims that read it
 * differently. So the primary key runs first, the quote key is offered only to the records it left
 * unpaired, and WHICH KEY PAIRED A RECORD IS CARRIED in `matched_on` rather than smoothed away.
 *
 * **A pair is never called unchanged on one field alone.** Where the sentence matched and the quote
 * did not, or the reverse, the pair is `changed` and it is not saved: the agent either read different
 * words or read the same words differently, and either is a reason to look again. Only a pair
 * agreeing on both, in a document whose digest did not move and at the same line, is `unchanged`.
 */
function matchClaims(
  before: DeclarationClaim[],
  after: DeclarationClaim[],
): {
  matched: {
    before: Keyed<DeclarationClaim>;
    after: Keyed<DeclarationClaim>;
    on: "claim-text" | "quote-text";
  }[];
  onlyBefore: Keyed<DeclarationClaim>[];
  onlyAfter: Keyed<DeclarationClaim>[];
} {
  const primary = pairByKey(keyed(before, claimKey), keyed(after, claimKey));
  const secondary = pairByKey(
    primary.onlyBefore.map((k) => ({ ...k, key: claimQuoteKey(k.record) })),
    primary.onlyAfter.map((k) => ({ ...k, key: claimQuoteKey(k.record) })),
  );
  return {
    matched: [
      ...primary.matched.map((m) => ({
        before: m.before,
        after: m.after,
        on: "claim-text" as const,
      })),
      ...secondary.matched.map((m) => ({
        before: m.before,
        after: m.after,
        on: "quote-text" as const,
      })),
    ],
    onlyBefore: secondary.onlyBefore,
    onlyAfter: secondary.onlyAfter,
  };
}

/** The environment variables a record's truth turns on, folded, as a set. */
function runtimeConfigSet(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).map((v) => foldText(v)).filter((v) => v.length > 0));
}

/**
 * Whether a finding's searches name a file, by a listed hit or by an exactly-named path.
 *
 * `paths` may hold a glob, and globs are NOT expanded here: deciding that `src/**` covers a file is a
 * judgement about a pattern language, and a wrong expansion would be invisible in either direction.
 * An exactly-named path is a fact, and that is what is used.
 */
function searchesTouchFile(finding: DeclarationFinding, file: string): boolean {
  for (const search of finding.searches ?? []) {
    for (const hit of search.hits ?? []) if (hit.file === file) return true;
    for (const path of search.paths ?? []) if (path === file) return true;
  }
  return false;
}

/**
 * Accumulator for the stale list.
 *
 * **One entry per (conclusion, side, link), never one per trigger.** The unit of re-judgement is a
 * conclusion: an agent re-answers a checklist item once however many facts moved under it, so a row
 * per fact would turn a work list into a multiplication table — every checklist item the bundle
 * carries times every fact that moved, all of them saying one thing. The triggers are all kept, in
 * `moved_facts` and `moved_documents`, complete and uncut, and the reason sentence names the first
 * and counts the rest.
 */
class StaleList {
  private readonly entries = new Map<string, StaleEntry>();

  add(
    ref: StaleRef,
    side: StaleEntry["side"],
    status: StaleEntry["status"],
    link: StaleLink,
    trigger: { fact?: FactRef; document?: string },
  ): void {
    const address = [
      ref.kind,
      ref.checklist_id ?? "",
      ref.item_id ?? "",
      ref.claim_id ?? "",
      ref.finding_id ?? "",
      ref.found_in,
      side,
      link,
    ].join("/");
    let entry = this.entries.get(address);
    if (!entry) {
      entry = { ref, side, status, link, moved_facts: [], moved_documents: [], reason: "" };
      this.entries.set(address, entry);
    }
    if (trigger.fact && !entry.moved_facts.some((f) => f.fact_id === trigger.fact!.fact_id)) {
      entry.moved_facts.push(trigger.fact);
    }
    if (trigger.document && !entry.moved_documents.includes(trigger.document)) {
      entry.moved_documents.push(trigger.document);
    }
  }

  /** In insertion order, with each reason sentence written once every trigger is known. */
  finish(write: (entry: StaleEntry) => string): StaleEntry[] {
    const out: StaleEntry[] = [];
    for (const entry of this.entries.values()) {
      entry.reason = write(entry);
      out.push(entry);
    }
    return out;
  }
}

export interface BuildReconcileDiffOptions {
  before: RunArtifacts;
  after: RunArtifacts;
}

export function buildReconcileDiff(opts: BuildReconcileDiffOptions): ReconcileDiff {
  const { before, after } = opts;
  const unmatched: UnmatchedEntry[] = [];
  const stale = new StaleList();

  /* ---------------------------------------------------------------- documents */

  const beforeDocs = new Map((before.input.documents ?? []).map((d) => [d.doc_path, d]));
  const afterDocs = new Map((after.input.documents ?? []).map((d) => [d.doc_path, d]));
  const docAdded: DocumentDiffEntry[] = [];
  const docRemoved: DocumentDiffEntry[] = [];
  const docChanged: DocumentDiffEntry[] = [];
  let docUnchanged = 0;
  /** Documents whose bytes are not the ones the before run read: a changed digest, or gone. */
  const movedDocs = new Set<string>();

  for (const [path, doc] of beforeDocs) {
    const other = afterDocs.get(path);
    const entry: DocumentDiffEntry = {
      doc_path: path,
      before_sha256: doc.sha256 ?? null,
      after_sha256: other?.sha256 ?? null,
      before_bytes: doc.bytes ?? null,
      after_bytes: other?.bytes ?? null,
    };
    if (!other) {
      docRemoved.push(entry);
      movedDocs.add(path);
      unmatched.push({ record_class: "document", side: "before", key: path, label: path });
    } else if (doc.sha256 !== other.sha256) {
      docChanged.push(entry);
      movedDocs.add(path);
    } else {
      docUnchanged++;
    }
  }
  for (const [path, doc] of afterDocs) {
    if (beforeDocs.has(path)) continue;
    docAdded.push({
      doc_path: path,
      before_sha256: null,
      after_sha256: doc.sha256 ?? null,
      before_bytes: null,
      after_bytes: doc.bytes ?? null,
    });
    unmatched.push({ record_class: "document", side: "after", key: path, label: path });
  }

  /* -------------------------------------------------------------- census facts */

  const factPairing = pairByKey(
    keyed(before.input.census?.facts ?? [], censusFactKey),
    keyed(after.input.census?.facts ?? [], censusFactKey),
  );
  const factsAdded = factPairing.onlyAfter.map((k) => factRefOf(k.record));
  const factsRemoved = factPairing.onlyBefore.map((k) => factRefOf(k.record));
  const factsMoved: MovedFact[] = [];
  let factsUnchanged = 0;
  for (const pair of factPairing.matched) {
    const b = pair.before.record;
    const a = pair.after.record;
    if ((b.line ?? 0) === (a.line ?? 0)) {
      factsUnchanged++;
      continue;
    }
    factsMoved.push({
      ...factRefOf(a),
      before_line: b.line ?? 0,
      after_line: a.line ?? 0,
      before_fact_id: b.fact_id ?? "",
    });
  }
  const factLabel = (f: CensusFact) =>
    `${f.collector}/${f.kind} ${JSON.stringify(f.value)} in ${f.file}`;
  for (const k of factPairing.onlyBefore) {
    unmatched.push({
      record_class: "census_fact",
      side: "before",
      key: k.key,
      label: factLabel(k.record),
    });
  }
  for (const k of factPairing.onlyAfter) {
    unmatched.push({
      record_class: "census_fact",
      side: "after",
      key: k.key,
      label: factLabel(k.record),
    });
  }

  /** The runtime configuration each fact names, by fact id, over both runs. Built once. */
  const factRuntimeConfig = new Map<string, Set<string>>();
  for (const fact of [...(before.input.census?.facts ?? []), ...(after.input.census?.facts ?? [])]) {
    const id = fact.fact_id ?? "";
    const existing = factRuntimeConfig.get(id) ?? new Set<string>();
    for (const v of runtimeConfigSet(fact.depends_on_runtime_config)) existing.add(v);
    factRuntimeConfig.set(id, existing);
  }

  /* ----------------------------------------------------------- checklist items */

  const beforeItems = checklistItemsOf(before.input);
  const afterItems = checklistItemsOf(after.input);
  const itemPairing = pairByKey(
    beforeItems.map((x, index) => ({ key: x.key, record: x, index })),
    afterItems.map((x, index) => ({ key: x.key, record: x, index })),
  );
  const itemLabel = (x: KeyedItem) => `${x.checklist_id}/${x.item.id}`;
  for (const k of itemPairing.onlyBefore) {
    unmatched.push({
      record_class: "checklist_item",
      side: "before",
      key: k.key,
      label: itemLabel(k.record),
    });
  }
  for (const k of itemPairing.onlyAfter) {
    unmatched.push({
      record_class: "checklist_item",
      side: "after",
      key: k.key,
      label: itemLabel(k.record),
    });
  }

  /**
   * The checklists the census-category join runs against: the after run's, where it has any.
   *
   * The after run is the current state, so its items are the questions a re-check would walk. Where
   * it carries none — a bundle built without checklists — the before run's are used, so that a moved
   * fact still names something rather than silently naming nothing.
   */
  const joinItems = afterItems.length > 0 ? afterItems : beforeItems;
  const joinItemsSide: RunSide = afterItems.length > 0 ? "after" : "before";

  /* --------------------------------- the two reports, paired before either direction runs */

  const claimTracking: ClaimPairEntry[] = [];
  let checklistResults: MaybeCounts;
  let claimCounts: MaybeCounts;
  let findingCounts: MaybeCounts;
  /** Conclusions this comparison touched for a reason other than a stale entry. */
  const touched = new Set<string>();
  // ONLY the report absences. Pasting the whole of `absences` here put a paragraph about the code
  // scan's findings file between the reader and the one sentence that explains the field.
  const noReport = (which: string) =>
    `${which} was not computed, because an agent report is missing on at least one side. ` +
    [before.report_absence, after.report_absence].filter((a): a is string => Boolean(a)).join(" ");

  const resultKeyOf = (r: ChecklistResult) => checklistKey(r.checklist_id, r.item_id);

  /**
   * Every conclusion of the two reports, ONCE EACH, with the run it is read from.
   *
   * A conclusion present in both runs under its content key is ONE conclusion, and it is considered
   * as the BEFORE run's: that is the one at risk of being carried forward stale, and it is the one a
   * reader of an earlier report holds. Listing it twice would print the same sentence about the same
   * question with only the run name differing, which reads as two pieces of work and is one. A
   * conclusion present in only one run is considered as that run's.
   *
   * Where only one run has a report at all, its conclusions are all considered and none is paired:
   * that is the ordinary shape of this command's main use — an earlier run with a report, a later run
   * with only the deterministic half — and the work list is still computed for it.
   */
  const consideredResults: { record: ChecklistResult; side: RunSide }[] = [];
  const consideredClaims: { record: DeclarationClaim; side: RunSide }[] = [];
  const consideredFindings: { record: DeclarationFinding; side: RunSide }[] = [];

  if (before.report && after.report) {
    /* checklist results */
    const resultPairing = pairByKey(
      keyed(before.report.checklist_results ?? [], resultKeyOf),
      keyed(after.report.checklist_results ?? [], resultKeyOf),
    );
    let resultsChanged = 0;
    let resultsUnchanged = 0;
    for (const pair of resultPairing.matched) {
      consideredResults.push({ record: pair.before.record, side: "before" });
      if (pair.before.record.status === pair.after.record.status) {
        resultsUnchanged++;
      } else {
        resultsChanged++;
        // Two runs answered one question two ways. Whatever else this comparison found, that pair is
        // not a conclusion an incremental re-check may carry forward untouched.
        touched.add(`checklist_result:${pair.key}`);
      }
    }
    checklistResults = {
      before: (before.report.checklist_results ?? []).length,
      after: (after.report.checklist_results ?? []).length,
      added: resultPairing.onlyAfter.length,
      removed: resultPairing.onlyBefore.length,
      moved: resultsChanged,
      unchanged: resultsUnchanged,
    };
    for (const k of resultPairing.onlyBefore) {
      consideredResults.push({ record: k.record, side: "before" });
      unmatched.push({
        record_class: "checklist_result",
        side: "before",
        key: k.key,
        label: `${k.record.checklist_id}/${k.record.item_id}`,
      });
    }
    for (const k of resultPairing.onlyAfter) {
      consideredResults.push({ record: k.record, side: "after" });
      unmatched.push({
        record_class: "checklist_result",
        side: "after",
        key: k.key,
        label: `${k.record.checklist_id}/${k.record.item_id}`,
      });
    }

    /* claims */
    const claimMatch = matchClaims(before.report.claims ?? [], after.report.claims ?? []);
    const { corpus: afterCorpus } = buildDocumentCorpus(after.input);
    let claimsUnchanged = 0;
    let claimsMovedOrChanged = 0;

    /**
     * The quote waterfall, run over a BEFORE-run claim's own words against the AFTER run's text.
     *
     * That direction is the whole point: the question is whether the words the earlier run read are
     * still in the document and where they now sit, so the earlier claim is the needle and the later
     * document is the haystack. The five statuses are carried exactly as the waterfall returns them —
     * `confirmed_at_declared` means the claim is still at the line it was; `repaired` is the
     * re-anchoring; `unverifiable` means the text itself is gone. Called, never re-implemented: the
     * verifier's own header records three independent rebuilds of these tiers, two of which shipped
     * the same bug.
     */
    const reAnchor = (claim: DeclarationClaim): ClaimPairEntry["re_anchor"] => {
      const doc = claim.source_location?.doc ?? "";
      if (!afterDocs.has(doc)) return null;
      const line = claim.source_location?.line;
      const check = verifyOneQuote({
        path: `claims[${claim.claim_id ?? ""}].quote`,
        corpus: afterCorpus,
        declaredSource: doc,
        declaredLines: typeof line === "number" && line > 0 ? [line] : [],
        text: claim.quote ?? "",
        preNotes: [],
      });
      return {
        status: check.status,
        tier: check.tier,
        fallback: check.fallback,
        final_source: check.final?.source ?? null,
        final_lines: check.final?.lines ?? [],
        notes: check.notes,
      };
    };

    for (const pair of claimMatch.matched) {
      const b = pair.before.record;
      const a = pair.after.record;
      consideredClaims.push({ record: b, side: "before" });
      const doc = a.source_location?.doc ?? b.source_location?.doc ?? "";
      const beforeLine = b.source_location?.line ?? null;
      const afterLine = a.source_location?.line ?? null;
      const bothFieldsAgree =
        pair.on === "claim-text"
          ? foldText(b.quote ?? "") === foldText(a.quote ?? "")
          : foldText(b.claim ?? "") === foldText(a.claim ?? "");
      const docMoved = movedDocs.has(doc);
      const positionMoved = beforeLine !== afterLine;
      let outcome: ClaimPairEntry["outcome"];
      if (!bothFieldsAgree) outcome = "changed";
      else if (positionMoved || docMoved) outcome = "moved";
      else outcome = "unchanged";
      if (outcome === "unchanged") claimsUnchanged++;
      else claimsMovedOrChanged++;
      if (outcome !== "unchanged") touched.add(`claim:${b.claim_id ?? ""}`);
      claimTracking.push({
        claim_id_before: b.claim_id ?? null,
        claim_id_after: a.claim_id ?? null,
        doc,
        outcome,
        before_line: beforeLine,
        after_line: afterLine,
        matched_on: bothFieldsAgree ? "claim-and-quote" : pair.on,
        re_anchor: docMoved || positionMoved ? reAnchor(b) : null,
      });
    }
    for (const k of claimMatch.onlyBefore) {
      consideredClaims.push({ record: k.record, side: "before" });
      const doc = k.record.source_location?.doc ?? "";
      claimTracking.push({
        claim_id_before: k.record.claim_id ?? null,
        claim_id_after: null,
        doc,
        outcome: "vanished",
        before_line: k.record.source_location?.line ?? null,
        after_line: null,
        matched_on: null,
        re_anchor: reAnchor(k.record),
      });
      unmatched.push({
        record_class: "claim",
        side: "before",
        key: k.key,
        label: `${k.record.claim_id} in ${doc}`,
      });
    }
    for (const k of claimMatch.onlyAfter) {
      consideredClaims.push({ record: k.record, side: "after" });
      claimTracking.push({
        claim_id_before: null,
        claim_id_after: k.record.claim_id ?? null,
        doc: k.record.source_location?.doc ?? "",
        outcome: "appeared",
        before_line: null,
        after_line: k.record.source_location?.line ?? null,
        matched_on: null,
        re_anchor: null,
      });
      unmatched.push({
        record_class: "claim",
        side: "after",
        key: k.key,
        label: `${k.record.claim_id} in ${k.record.source_location?.doc ?? ""}`,
      });
    }
    claimCounts = {
      before: (before.report.claims ?? []).length,
      after: (after.report.claims ?? []).length,
      added: claimMatch.onlyAfter.length,
      removed: claimMatch.onlyBefore.length,
      moved: claimsMovedOrChanged,
      unchanged: claimsUnchanged,
    };

    /* findings */
    const findingPairing = pairByKey(
      keyed(before.report.findings ?? [], findingKey),
      keyed(after.report.findings ?? [], findingKey),
    );
    for (const pair of findingPairing.matched) {
      consideredFindings.push({ record: pair.before.record, side: "before" });
    }
    findingCounts = {
      before: (before.report.findings ?? []).length,
      after: (after.report.findings ?? []).length,
      added: findingPairing.onlyAfter.length,
      removed: findingPairing.onlyBefore.length,
      // A finding is matched or it is not: its text IS its key, so there is no third state in which
      // one moved. The field is present and zero rather than absent, so the six count blocks read
      // alike and a reader never has to wonder whether a missing number is a zero.
      moved: 0,
      unchanged: findingPairing.matched.length,
    };
    for (const k of findingPairing.onlyBefore) {
      consideredFindings.push({ record: k.record, side: "before" });
      unmatched.push({
        record_class: "finding",
        side: "before",
        key: k.key,
        label: `${k.record.finding_id} (direction ${k.record.direction})`,
      });
    }
    for (const k of findingPairing.onlyAfter) {
      consideredFindings.push({ record: k.record, side: "after" });
      unmatched.push({
        record_class: "finding",
        side: "after",
        key: k.key,
        label: `${k.record.finding_id} (direction ${k.record.direction})`,
      });
    }
  } else {
    // One report, or none. Its conclusions are all considered and none is paired — a record here is
    // NOT put in `unmatched`, because nothing on the other side was compared with it and calling it
    // unpaired would say a comparison ran that did not.
    for (const { side, report } of [
      ...(before.report ? [{ side: "before" as RunSide, report: before.report }] : []),
      ...(after.report ? [{ side: "after" as RunSide, report: after.report }] : []),
    ]) {
      for (const r of report.checklist_results ?? []) consideredResults.push({ record: r, side });
      for (const c of report.claims ?? []) consideredClaims.push({ record: c, side });
      for (const f of report.findings ?? []) consideredFindings.push({ record: f, side });
    }
    checklistResults = { computed: false, reason: noReport("The checklist-result comparison") };
    claimCounts = { computed: false, reason: noReport("The claim comparison") };
    findingCounts = { computed: false, reason: noReport("The finding comparison") };
  }

  /* ------------------------------------------- direction (a): the code side moved */

  const movedFacts: FactRef[] = [...factsAdded, ...factsRemoved];
  const factHow = new Map<string, "appeared" | "disappeared">();
  for (const f of factsAdded) factHow.set(f.fact_id, "appeared");
  for (const f of factsRemoved) factHow.set(f.fact_id, "disappeared");

  for (const fact of movedFacts) {
    const categories = new Set(fact.categories);
    for (const item of joinItems) {
      const itemCategories = item.item.census_categories ?? [];
      if (itemCategories.length === 0) continue;
      if (!itemCategories.some((c) => categories.has(c))) continue;
      stale.add(
        {
          kind: "checklist_item",
          checklist_id: item.checklist_id,
          item_id: item.item.id,
          found_in: joinItemsSide,
        },
        "code",
        "possibly-stale",
        "census-categories",
        { fact },
      );
    }
    for (const { record: finding, side } of consideredFindings) {
      const byFactRef = (finding.fact_refs ?? []).includes(fact.fact_id);
      const bySearch = searchesTouchFile(finding, fact.file);
      if (!byFactRef && !bySearch) continue;
      stale.add(
        {
          kind: "finding",
          finding_id: finding.finding_id,
          direction: finding.direction,
          found_in: side,
        },
        "code",
        "possibly-stale",
        byFactRef ? "fact-refs" : "search-touches-file",
        { fact },
      );
    }
    for (const { record: claim, side } of consideredClaims) {
      const claimVars = runtimeConfigSet(claim.depends_on_runtime_config);
      if (claimVars.size === 0) continue;
      const factVars = factRuntimeConfig.get(fact.fact_id) ?? new Set<string>();
      if (![...factVars].some((v) => claimVars.has(v))) continue;
      stale.add(
        {
          kind: "claim",
          claim_id: claim.claim_id,
          doc: claim.source_location?.doc,
          found_in: side,
        },
        "code",
        "possibly-stale",
        "runtime-config-shared",
        { fact },
      );
    }
  }

  /* -------------------------------------- direction (b): the document side moved */

  for (const doc of movedDocs) {
    for (const { record: claim, side } of consideredClaims) {
      if ((claim.source_location?.doc ?? "") !== doc) continue;
      stale.add(
        { kind: "claim", claim_id: claim.claim_id, doc, found_in: side },
        "documents",
        "needs-re-checking",
        "claim-in-document",
        { document: doc },
      );
    }
    for (const { record: result, side } of consideredResults) {
      if (!(result.evidence ?? []).some((e) => e.doc === doc)) continue;
      stale.add(
        {
          kind: "checklist_result",
          checklist_id: result.checklist_id,
          item_id: result.item_id,
          doc,
          found_in: side,
        },
        "documents",
        "needs-re-checking",
        "evidence-in-document",
        { document: doc },
      );
    }
    for (const { record: finding, side } of consideredFindings) {
      const ref: StaleRef = {
        kind: "finding",
        finding_id: finding.finding_id,
        direction: finding.direction,
        doc,
        found_in: side,
      };
      if (finding.quote?.doc === doc) {
        stale.add(ref, "documents", "needs-re-checking", "quote-in-document", { document: doc });
      }
      /* THE SECOND DOCUMENT LINK A FINDING CAN HAVE, added 2026-09-03 with `document_ref`.
       *
       * Until then a finding's only document link was its own singular `quote`, because those were
       * the only document words a finding could carry — `evidence[]` and `searches[].hits[]` were
       * file-addressed and nothing else. They are not any more, and hole 8 of the bitwarden-url run
       * is precisely a finding whose document passages belong in `evidence[]`. Reading only `quote`
       * would leave such a finding unflagged when the document it rests on changes: a new field
       * nobody reads is a link that silently stops being followed, which is the shape this whole
       * comparison exists to make visible rather than to have. */
      const citesDoc =
        (finding.evidence ?? []).some((e) => e.document_ref === doc) ||
        (finding.searches ?? []).some((s) => (s.hits ?? []).some((h) => h.document_ref === doc));
      if (citesDoc) {
        stale.add(ref, "documents", "needs-re-checking", "cites-document", { document: doc });
      }
    }
  }

  /* --------------------------------------------------------- the reason sentences */

  const staleEntries = stale.finish((entry) => {
    if (entry.side === "code") {
      const first = entry.moved_facts[0];
      const more =
        entry.moved_facts.length > 1
          ? ` and ${entry.moved_facts.length - 1} other census fact(s), all listed in this entry's moved_facts`
          : "";
      const how = first ? (factHow.get(first.fact_id) ?? "moved") : "moved";
      const what = first
        ? `the ${first.collector} collector's ${first.kind} fact valued ` +
          `${JSON.stringify(first.value)} ${how} at ${first.file}:${first.line}${more}`
        : "a census fact moved";
      if (entry.ref.kind === "checklist_item") {
        return (
          `The code side moved: ${what}. Checklist item ${entry.ref.checklist_id}/${entry.ref.item_id} ` +
          `declares census categories covering that fact, so an answer to it drawn from the other run ` +
          `may be possibly stale. Whether it is remains a reading of the document, which this ` +
          `comparison does not make.`
        );
      }
      if (entry.ref.kind === "finding") {
        return (
          `The code side moved: ${what}. Finding ${entry.ref.finding_id} in the ${entry.ref.found_in} run ` +
          (entry.link === "fact-refs"
            ? `names that fact in its fact_refs`
            : `rests on a search that names the file the fact sits in`) +
          `, so it may be possibly stale.`
        );
      }
      return (
        `The code side moved: ${what}. Claim ${entry.ref.claim_id} in the ${entry.ref.found_in} run turns ` +
        `on the same runtime configuration, which is the only link between a claim and a census fact ` +
        `the schemas carry, so it may be possibly stale.`
      );
    }
    const docs = entry.moved_documents;
    const described = docs
      .map((d) => `${d} ${afterDocs.has(d) ? "carries different bytes in the two runs" : "is not in the after run"}`)
      .join("; ");
    if (entry.ref.kind === "claim") {
      return (
        `The document side moved: ${described}. Claim ${entry.ref.claim_id} was read from it in the ` +
        `before run, so it needs re-checking against the document as it now stands. Its row in ` +
        `claim_tracking carries the re-anchoring result, which says whether the quoted words are still ` +
        `in the document and where.`
      );
    }
    if (entry.ref.kind === "checklist_result") {
      return (
        `The document side moved: ${described}. The ${entry.ref.found_in} run answered checklist item ` +
        `${entry.ref.checklist_id}/${entry.ref.item_id} with evidence quoted from that document, so the ` +
        `answer needs re-checking against the document as it now stands.`
      );
    }
    return (
      `The document side moved: ${described}. Finding ${entry.ref.finding_id} in the ` +
      `${entry.ref.found_in} run ` +
      (entry.link === "cites-document"
        ? `cites that document in its evidence or in a listed search hit`
        : `quotes that document`) +
      `, so it needs re-checking against the document as it now stands.`
    );
  });

  /* ------------------------------------------------------------------ (c) saved */

  const staleResultKeys = new Set<string>();
  const staleClaimIds = new Set<string>();
  const staleFindingIds = new Set<string>();
  for (const entry of staleEntries) {
    if (entry.ref.kind === "checklist_result" || entry.ref.kind === "checklist_item") {
      staleResultKeys.add(checklistKey(entry.ref.checklist_id ?? "", entry.ref.item_id ?? ""));
    }
    if (entry.ref.kind === "claim" && entry.ref.claim_id) staleClaimIds.add(entry.ref.claim_id);
    if (entry.ref.kind === "finding" && entry.ref.finding_id) {
      staleFindingIds.add(entry.ref.finding_id);
    }
  }

  let saved: SavedCount | NotComputed;
  if (before.report && after.report) {
    const matchedResults = pairByKey(
      keyed(before.report.checklist_results ?? [], resultKeyOf),
      keyed(after.report.checklist_results ?? [], resultKeyOf),
    ).matched;
    const savedResults = matchedResults.filter(
      (p) => !touched.has(`checklist_result:${p.key}`) && !staleResultKeys.has(p.key),
    ).length;
    const matchedClaims = claimTracking.filter(
      (c) => c.claim_id_before !== null && c.claim_id_after !== null,
    );
    const savedClaims = matchedClaims.filter(
      (c) =>
        c.outcome === "unchanged" &&
        !touched.has(`claim:${c.claim_id_before ?? ""}`) &&
        !staleClaimIds.has(c.claim_id_before ?? ""),
    ).length;
    const matchedFindings = pairByKey(
      keyed(before.report.findings ?? [], findingKey),
      keyed(after.report.findings ?? [], findingKey),
    ).matched;
    const savedFindings = matchedFindings.filter(
      (p) =>
        !staleFindingIds.has(p.before.record.finding_id) &&
        !staleFindingIds.has(p.after.record.finding_id),
    ).length;
    saved = {
      computed: true,
      checklist_results: savedResults,
      claims: savedClaims,
      findings: savedFindings,
      total: savedResults + savedClaims + savedFindings,
      of_matched: matchedResults.length + matchedClaims.length + matchedFindings.length,
    };
  } else {
    saved = { computed: false, reason: noReport("The saved count") };
  }

  /* --------------------------------------------------- the boundary, in every shape */

  /**
   * What this comparison cannot see, written on EVERY output whatever each run carried.
   *
   * **It used to live inside the saved count, which is the one place it could go missing.** That
   * branch runs only where both runs carry an agent report; the command's own main use is an earlier
   * run with a report and a later run with only the deterministic half, and in exactly that shape the
   * output carried a work list and no statement of what the list cannot see, while the shipped skill
   * told the agent to go and read one. Found by an independent verifier, 2026-09-02. It is a property
   * of the COMPARISON rather than of the count, so it is top-level, required, and written here once.
   *
   * The second sentence is shape-dependent, because which links could be followed at all depends on
   * which reports were there: with no report, only the checklist items' census categories are joined,
   * and a work list that names no claim or finding is not evidence that none is affected.
   */
  const reportsPresent = (before.report ? 1 : 0) + (after.report ? 1 : 0);
  const notAsserted =
    "WHAT THIS COMPARISON CANNOT SEE. The links it follows are the ones the schemas carry, and no " +
    "others: a checklist item's census_categories; a finding's fact_refs; a finding's searches, and " +
    "those only THROUGH A LISTED HIT OR AN EXACTLY-NAMED PATH, since a glob in searches[].paths is " +
    "never expanded (deciding that a pattern covers a file is a judgement about a pattern language, " +
    "and a wrong expansion would be invisible in either direction); a checklist result's and a " +
    "finding's quoted document, and a document a finding CITES in its evidence or in a listed " +
    "search hit; and the runtime configuration a claim and a census fact name in " +
    "common, which is the ONLY link between a claim and a fact any schema here carries. A conclusion " +
    "resting on something none of those names is outside what this comparison can reach, and its " +
    "absence from the work list is not evidence that nothing touched it. A SAVED CONCLUSION IS NOT A " +
    "RE-VERIFIED ONE: it is one nothing in this comparison touched, it carries forward with the " +
    "evidence of the run it came from, and the report presenting it says which run that was. " +
    (reportsPresent === 2
      ? "Both runs carried an agent report, so every link above was available to this comparison."
      : reportsPresent === 1
        ? "ONLY ONE RUN CARRIED AN AGENT REPORT, so the links that run through a report were followed " +
          "against that one run's conclusions alone, no conclusion could be compared with its " +
          "counterpart, and the saved count was not computed at all."
        : "NEITHER RUN CARRIED AN AGENT REPORT, so the only link followed was the checklist items' " +
          "census_categories: no claim, finding or checklist result was read, and the work list " +
          "below says nothing whatever about them.");

  /* ------------------------------------------------------------- disclosures */

  const beforeBundle = before.input.bundle?.version ?? "";
  const afterBundle = after.input.bundle?.version ?? "";
  const beforeBundleSha = before.input.bundle?.sha256 ?? null;
  const afterBundleSha = after.input.bundle?.sha256 ?? null;
  const bundleMismatch =
    beforeBundle !== afterBundle || beforeBundleSha !== afterBundleSha
      ? {
          before_version: beforeBundle,
          after_version: afterBundle,
          before_sha256: beforeBundleSha,
          after_sha256: afterBundleSha,
          note:
            "The two runs used different rule bundles, so the checklists, their items and their " +
            "applicability gates may not be the same set of questions. Rule-set drift can explain a " +
            "difference in the findings or the checklist results below on its own, without anything " +
            "in the repository or in the documents having moved. Nothing here decides which of the " +
            "two explanations holds; it is stated before the counts so that the counts are read with " +
            "it in view.",
        }
      : null;

  const sameId =
    (before.input.reconcile_id ?? "") !== "" &&
    (before.input.reconcile_id ?? "") === (after.input.reconcile_id ?? "");
  const reconcileIdCollision = sameId
    ? `Both runs carry reconcile_id ${JSON.stringify(before.input.reconcile_id)}. Two runs are meant ` +
      `to carry two identifiers, so either one directory was compared with itself or an identifier ` +
      `was copied. The comparison below still ran, on the bytes each directory holds.`
    : null;

  const targetMismatch =
    (before.input.target ?? "") !== (after.input.target ?? "")
      ? `The two runs name different targets: the before run ${JSON.stringify(before.input.target)} and ` +
        `the after run ${JSON.stringify(after.input.target)}. File paths below are relative to each run's ` +
        `own target, so a path present in both may name two different files. This is stated and not ` +
        `resolved: a repository that moved on disk and two different repositories look alike here.`
      : null;

  /* --------------------------------------------------------------- the counts */

  const documentCounts: ClassCounts = {
    before: beforeDocs.size,
    after: afterDocs.size,
    added: docAdded.length,
    removed: docRemoved.length,
    moved: docChanged.length,
    unchanged: docUnchanged,
  };
  const factCounts: ClassCounts = {
    before: (before.input.census?.facts ?? []).length,
    after: (after.input.census?.facts ?? []).length,
    added: factsAdded.length,
    removed: factsRemoved.length,
    moved: factsMoved.length,
    unchanged: factsUnchanged,
  };
  const itemCounts: ClassCounts = {
    before: beforeItems.length,
    after: afterItems.length,
    added: itemPairing.onlyAfter.length,
    removed: itemPairing.onlyBefore.length,
    moved: 0,
    unchanged: itemPairing.matched.length,
  };

  /**
   * What "a difference" counts, named class by class so the number can be checked by hand.
   *
   * `unchanged` is the only bucket that never contributes. A `moved` row does: a fact that changed
   * line, a document whose digest changed, a checklist result whose status changed and a claim that
   * moved or was reworded are all differences between the two runs — position drift is excluded from
   * the KEY, which is what stops it being reported as a removal and an addition, and it is still a
   * difference and is still reported as one.
   */
  const differenceOf = (c: MaybeCounts) => (hasCounts(c) ? c.added + c.removed + c.moved : 0);
  const differences =
    differenceOf(documentCounts) +
    differenceOf(factCounts) +
    differenceOf(itemCounts) +
    differenceOf(checklistResults) +
    differenceOf(claimCounts) +
    differenceOf(findingCounts);

  return {
    tool: "reconcile-diff",
    diff_version: RECONCILE_DIFF_VERSION,
    runs: { before: identityOf(before), after: identityOf(after) },
    bundle_mismatch: bundleMismatch,
    reconcile_id_collision: reconcileIdCollision,
    target_mismatch: targetMismatch,
    absences: [...before.absences, ...after.absences],
    documents: {
      added: docAdded,
      removed: docRemoved,
      changed: docChanged,
      unchanged: docUnchanged,
    },
    census_facts: {
      added: factsAdded,
      removed: factsRemoved,
      moved: factsMoved,
      unchanged: factsUnchanged,
    },
    checklist_items: {
      added: itemPairing.onlyAfter.map((k) => itemLabel(k.record)),
      removed: itemPairing.onlyBefore.map((k) => itemLabel(k.record)),
      unchanged: itemPairing.matched.length,
    },
    checklist_results: checklistResults,
    claims: claimCounts,
    findings: findingCounts,
    claim_tracking: claimTracking,
    possibly_stale: staleEntries,
    not_asserted: notAsserted,
    unmatched,
    stats: {
      documents: documentCounts,
      census_facts: factCounts,
      checklist_items: itemCounts,
      checklist_results: checklistResults,
      claims: claimCounts,
      findings: findingCounts,
      possibly_stale: staleEntries.filter((s) => s.status === "possibly-stale").length,
      needs_re_checking: staleEntries.filter((s) => s.status === "needs-re-checking").length,
      unmatched: unmatched.length,
      differences,
      saved,
    },
    disclaimer: RECONCILE_DIFF_DISCLAIMER,
  };
}

/** 0 when the two runs describe the same state; EXIT_DIFFERENCES_FOUND when they do not. */
export function reconcileDiffExitCode(diff: ReconcileDiff): number {
  return diff.stats.differences > 0 ? EXIT_DIFFERENCES_FOUND : EXIT_NO_DIFFERENCES;
}

/* --------------------------------------------------------------------------------------------- *
 * The console.
 * --------------------------------------------------------------------------------------------- */

function countsLine(label: string, counts: MaybeCounts): string {
  if (!hasCounts(counts)) return `  ${label}: not computed. ${counts.reason}`;
  return (
    `  ${label}: ${counts.before} before, ${counts.after} after — ${counts.added} added, ` +
    `${counts.removed} removed, ${counts.moved} moved, ${counts.unchanged} unchanged`
  );
}

function staleAddress(ref: StaleRef): string {
  if (ref.kind === "checklist_item" || ref.kind === "checklist_result") {
    return `${ref.checklist_id}/${ref.item_id}`;
  }
  return ref.kind === "claim" ? `${ref.claim_id}` : `${ref.finding_id}`;
}

/**
 * What a person reads at the end of a run.
 *
 * The bundle-version mismatch is printed FIRST, before any count, because it is the one disclosure
 * that changes how every count below should be read: a different rule bundle is a different set of
 * questions, and a reader who meets that fact after the numbers has already formed a view of them.
 * The counts come next, and then every possibly-stale entry in full — the list is the product of this
 * command, and a summary of it would be a score.
 */
export function summarizeReconcileDiff(diff: ReconcileDiff, outPath: string | null): string {
  const out: string[] = [];

  if (diff.bundle_mismatch) {
    out.push(
      `BUNDLE VERSION MISMATCH — the before run used bundle ${diff.bundle_mismatch.before_version} and ` +
        `the after run used ${diff.bundle_mismatch.after_version}.`,
    );
    out.push(`  ${diff.bundle_mismatch.note}`);
    out.push("");
  }
  if (diff.reconcile_id_collision) {
    out.push(`RECONCILE ID — ${diff.reconcile_id_collision}`);
    out.push("");
  }
  if (diff.target_mismatch) {
    out.push(`TARGET — ${diff.target_mismatch}`);
    out.push("");
  }
  for (const absence of diff.absences) out.push(`NOT PRESENT — ${absence}`);
  if (diff.absences.length > 0) out.push("");

  out.push(
    `reconcile-diff (version ${diff.diff_version}): ${diff.stats.differences} difference(s) between ` +
      `${diff.runs.before.dir} (generated ${diff.runs.before.generated_at}) and ` +
      `${diff.runs.after.dir} (generated ${diff.runs.after.generated_at}).`,
  );
  out.push(countsLine("documents", diff.stats.documents));
  out.push(countsLine("census facts", diff.stats.census_facts));
  out.push(countsLine("checklist items", diff.stats.checklist_items));
  out.push(countsLine("checklist results", diff.stats.checklist_results));
  out.push(countsLine("claims", diff.stats.claims));
  out.push(countsLine("findings", diff.stats.findings));
  out.push(
    `  ${diff.stats.possibly_stale} possibly stale, ${diff.stats.needs_re_checking} needing ` +
      `re-checking, ${diff.stats.unmatched} record(s) paired with nothing on the other side.`,
  );
  if (diff.stats.saved.computed) {
    out.push(
      `  saved: ${diff.stats.saved.total} of ${diff.stats.saved.of_matched} conclusion(s) present in ` +
        `both runs are named in neither list — ${diff.stats.saved.checklist_results} checklist result(s), ` +
        `${diff.stats.saved.claims} claim(s), ${diff.stats.saved.findings} finding(s).`,
    );
  } else {
    out.push(`  saved: not computed. ${diff.stats.saved.reason}`);
  }
  // Printed on EVERY run, beside the counts rather than inside the saved block, because it is a
  // property of the comparison and not of the count — and because inside that block it was missing
  // from every run where one side had no agent report, which is this command's own main use.
  out.push(`  ${diff.not_asserted}`);
  out.push("");

  if (diff.possibly_stale.length === 0) {
    out.push("Nothing was found to be possibly stale or in need of re-checking.");
  } else {
    out.push(
      `POSSIBLY STALE AND NEEDING RE-CHECKING — ${diff.possibly_stale.length} entr(ies), in full. Each ` +
        `is one conclusion to look at again, whatever number of moved facts or documents reached it:`,
    );
    diff.possibly_stale.forEach((entry, i) => {
      out.push(
        `  ${i + 1}. [${entry.status}] ${entry.ref.kind} ${staleAddress(entry.ref)} — the ` +
          `${entry.side} side moved (${entry.link})`,
      );
      out.push(`     ${entry.reason}`);
    });
  }

  if (diff.claim_tracking.length > 0) {
    out.push("");
    out.push("CLAIMS ACROSS THE TWO RUNS — vanished, appeared, moved, changed or unchanged:");
    for (const c of diff.claim_tracking) {
      const anchor = c.re_anchor
        ? ` re-anchored: ${c.re_anchor.status}${
            c.re_anchor.final_lines.length > 0
              ? ` at line(s) ${c.re_anchor.final_lines.join(", ")}`
              : ""
          }${c.re_anchor.fallback ? " (first line only — an anchor, not a verification)" : ""}`
        : "";
      out.push(
        `  ${c.outcome}: ${c.claim_id_before ?? "(none)"} -> ${c.claim_id_after ?? "(none)"} in ` +
          `${c.doc} (line ${c.before_line ?? "-"} -> ${c.after_line ?? "-"})${anchor}`,
      );
    }
  }

  if (diff.unmatched.length > 0) {
    out.push("");
    out.push(
      `UNMATCHED — ${diff.unmatched.length} record(s) present on one side and paired with nothing on ` +
        `the other. Every one is listed, because a record dropped in silence is how a comparison comes ` +
        `to look complete:`,
    );
    for (const u of diff.unmatched) out.push(`  ${u.side}: ${u.record_class} ${u.label}`);
  }

  if (outPath) {
    out.push("");
    out.push(`Written to ${outPath}. Neither run's artifacts were modified.`);
  }
  out.push("");
  out.push(
    diff.stats.differences > 0
      ? `Exit ${EXIT_DIFFERENCES_FOUND}: differences were found. A difference is not an error — two ` +
          `runs of a repository under development are expected to differ, and this code exists so a ` +
          `caller can branch on whether a re-judgement pass is worth running.`
      : `Exit ${EXIT_NO_DIFFERENCES}: the two runs describe the same state under the content keys.`,
  );
  return out.join("\n");
}
