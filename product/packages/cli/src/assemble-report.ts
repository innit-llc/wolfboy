/**
 * `assemble-report` — THE PROGRAM, NOT THE ORCHESTRATOR, ASSEMBLES THE REPORT AND THE EVIDENCE LOG
 * (relay rework item 5, 2026-09-24).
 *
 * Live run 1 (2026-09-23) never merged its refutations (SKILL.md step 5) and never wrote the report
 * or the log (steps 6-7): those were the orchestrating AI's job, done by retyping, and they did not
 * happen. The written proposal
 * moves every number and every list of both documents to the program. This command reads
 * only records on disk — the verdict files as `verdict-reading` assembled them, the annotated copy
 * `verdict-verify` wrote, the scan document, the pre-launch plan, the carried verdicts and, when
 * given, the capture ledger — and either writes both documents or writes neither and names every
 * record that stopped it. The orchestrator's remaining role at the end is to show the file.
 *
 * ## WHAT IT REFUSES, AND WHY A REFUSAL NAMES EVERYTHING AT ONCE
 *
 * A record it needs that is missing, unchecked, changed after the check, or contradicted by another
 * record is a refusal; every refusal is collected before anything is decided, so one run names every
 * seat to re-launch instead of the first one. `verdict-verify`'s own coverage gaps move no verdict
 * word (`verdict-verify.ts`, the paragraph above the coverage loop): what to do about them is the
 * orchestrator's, so each one is a refusal naming the candidate, the kind and the problem — except
 * `verdict-missing`, which cannot tell a verdict that was lost from a candidate the run shape did not
 * reach, the declaration settled or a previous run carried. This command can, from the plan, and it
 * refuses only on the first, naming the payload so that one seat is re-launched.
 *
 * ## WHAT IT NEVER DOES
 *
 * It re-adjudicates nothing, moves no word the quote check wrote, and keeps every record the check
 * invalidated exactly as the check left it (SKILL.md step 5a). The merge of step 5 is the only word
 * it moves, and only on the refutation's own outcome.
 *
 * ## EVERY SENTENCE THE PERSON READS IS IN `WORDS` BELOW, ON PURPOSE
 *
 * Public-facing text is decided apart from the code, so a wording change must
 * be a one-table edit — the convention `report.ts` set. Each entry says whether it is SKILL.md's own
 * text (and which line) or one this unit wrote; those are listed
 * in an internal record.
 */
import { createHash } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { orientationSheetBeside } from "./rests-on.js";
import { makeFolder, makeTempFolder, removeEmptyFolder, removePath, renamePath, writeFileAt } from "./project-write.js";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { relativePath } from "./project-path.js";
// The title of a finding to fix, from its rule's lines.
import { problemLineFor, type RuleLineSlot } from "./rule-lines.js";
import type { RuleLines } from "./bundle.js";
import { valueText, controlsEscaped, markdownText, markdownProse, markdownCode, md, ours, inertJoin, inertCut, programText, inertLines, inertRedacted, inertRelinked, inertTrim, inertSlice, inertUnlisted, inertCell, inertCapital, inertSliceFrom, linkTarget, spanText, inSpan, type Inert, type Raw, type Spanned } from "./printed-output.js";
import { anchorOfHeading, codeSpan, codeSpanParts, codeTarget, cutTitle, firstSentence, hexOf, labelOf, plainFileName, REPORT_WIDTH, rowsAt, shortIdsOf, wrapProse } from "./report-form.js";
import { appendStateRecord, readStateRecord } from "./state-record.js";
import { endScreenCopyLines, type CopyOnRecord } from "./deep-copy-text.js";
import { deepCopiesOnRecord, linkedFilesSeen, readDeepRecord, withDeeperChecks, type DeepRecordLine, type LinkedFilesSeen } from "./deepen.js";
import { numbersFor } from "./decisions.js";
import { assignNumbers, fNumber, idsOfHandle, NUMBER_LIST_KIND, numberLines, numbersOfLog, parseNumberList, recordedMaxOf, type NumberList, type NumberResult } from "./number-list.js";
import { accountHomeNow, canonicalPath, processStateDir, stateFolderUsed, type StateFolderUsed, stateFolderAdvice } from "./start-record.js";
import { adjudicatePlanDigestName, commandSessions, earlierRunChosenName, previousVouchRefusal } from "./plugin-sessions.js";
import type { Command } from "commander";
import type { Candidate, EvidenceLog, Findings, FindingsContextPayloadRow, Rule, ScanProfile } from "wolfboy-schemas";
import { itemLabelsOfCandidate, matchedWordsLabel } from "./item-label.js";
import { answersUsedOf, ciSet, DECLARATION_PLAN_FILE, declaredInapplicableOf, givenAnswersOf as confirmedAnswersOf, loadDeclarationSource, NOT_ASKED_LATER, preconditionField, questionKindOf, readDeclaration, reviewDeclarationCommand, type DeclarationSource } from "./declaration.js";
import { basisAnsweredOut, compareKeys, orderAnswersOf, orderKeyOf, raisedByWeight, raisedOnDutyAlone, type ResolvedBasis, type RuleBasis, type StandingOrder, type StandingOrderInput, standingOrderOf, tierIfAnswered, type TierOf } from "./fix-order.js";
import { jurisdictionAnsweredOut } from "./per-rule-applicability.js";
import { dispositionOf, effectiveShipsOf, countsAsProblem, type Disposition, type DispositionInput, type DispositionResult, type GivenAnswer, type SecondLook } from "./disposition.js";
import { foldFindings, type Fold, type FoldEntry } from "./fold-findings.js";
import { CHALLENGE_CLAIMS, claimOf, dismissalClaimOf, isChallengeRecord, lookAnswerOf, lookLeavesOverturnToPerson, premisesOfFindings, type ChallengeClaim } from "./second-look.js";
import { NOT_SHIPPED, SHIPS_OF_PREMISE, dutyAboutOf, findingRoleOf, locationOverturnStands, refutationGrounds, refutationUnusable, type StandingRecord } from "./standing.js";
import { headingEnd, loadPenaltyTiers, type PenaltyTierTable, type TierOfBasis, tierOfBasis } from "./penalty-tier.js";
import { adjudicatePlan, derivedFileContent, PreviousRunUnreadable, readPreviousRun, type PreviousRun } from "./adjudicate-plan.js";
import { readingInputsOfRun } from "./run-reading.js";
import { endRunLines, legalLayoutRefusals, readHookedRun, supersededRefutationFiles, type HookedRun, type NotJudgedSets } from "./assemble-hooked.js";
import { APPENDS_ITS_REFUTER, LIST_UNREAD, recoveryOf, type Refusal, type RefusalKind } from "./recovery.js";
import { relaunchAdvice, setAsideChangedRecords, type Relaunch } from "./entry-answer.js";
// Area α's one in-session predicate and one run-shape reader, in place of the local ones.
import { FOR_THE_PERSON, claudeCodeSigns, readActiveRun } from "./hook-launch.js";
import { heldReportsSentence } from "./held-reports.js";
import { defaultEvidenceLogPath, evidenceLogName, isEvidenceLogName, legalDirOf, writeLegalIgnore } from "./legal-dir.js";
import { dockerIgnoreGap, writeLegalReadme } from "./legal-tidy.js";
// The comparison with the earlier review, and the evidence logs' digests in the person's state folder.
import { placeSetOf, type KeyedLocation } from "./place-key.js";
import { comparisonOf, readEarlierForComparison, reviewedOfEarlier, type BasisRow, type EarlierForComparison } from "./comparison.js";
// What changed since the earlier review, as the report says it.
import { vendorSoftwareOf, type VendorSoftware } from "./own-name.js";
import { backRowsOf, changesLines, downParts, downWord, goneWhereOf, laterComparisonOf, listWord, sinceOf, upNote, type LaterComparison, type LaterLookup, type Since } from "./later-run.js";
import { DIGEST_WORDS, digestMarkOf, findingsChangedProblem, planDigestName, readLogDigests, recordLogDigest } from "./log-digest.js";
import { recordReportFiles } from "./report-files.js";
import { readLaunchEvents, runShapeFromAnswer, type LaunchEvent } from "./launch-plan.js";
import { profileDigest, removalsOf } from "./scan.js";
import { SHIPPED_WORDS, applicabilityByInstrument, notShippedWords } from "./report.js";
import { group, notReadAll, notReadFolded, notReadParts, plural } from "./progress.js";
import { gitRunnerOrWhy } from "./child-program.js";
import type { RecordSummary } from "./record.js";
import {
  PLACE_SUMMARY_FIRST,
  placeSummaryOf,
  placeTableOf,
  placeTablePath,
  programItemSourceOf,
  shownItemNameOf,
  writePlaceTable,
  type PlaceSummary,
  type PlaceTableRow,
} from "./place-fold.js";
import { isPlacePlanCandidate } from "./place-reply.js";
import { modelOverrideLine, type ModelOverride } from "./seat-model.js";
import { jsonFilesUnder } from "./command-boundary.js";
import { programFileBytes, readProgramFile, sha256Of } from "./program-file.js";
import { groupKeyOf, humanSeconds, importantRows, tokenRangeWords } from "./cost-preview.js";
import { assembleReadingForVerdicts, memberAtRow, notCheckedLocations, notCheckedOf, readingUnitsCensusOf, type NotCheckedPlaces, type ReaderReply, type ReadingKind, type ReadingReadRow } from "./reading.js";
import { earlierRunWords } from "./carry-forward.js";
import { verdictSetOf } from "./verdict-set.js";
import { placePremisesInWords } from "./place-premises.js";
import { assembledCopies, premiseInputs, type PremiseInputs } from "./reading-assembly.js";
import { validateAgainstSchema, type SchemaViolation } from "./schema-validate.js";
import { invalidWordFor, jobsFromVerdictsDir, labelKey, strayLabelFields, verifyVerdictQuotes } from "./verdict-verify.js";
import { keepRenderInput, writeRenderInput } from "./report-render.js";
import { CREDENTIAL_RULE_ID, redactPrintedText, redactStringsInPlace, type PrintedRedaction } from "./credential-redaction.js";
import { productPrintedRedaction } from "./engine.js";
import { isShippedIdentity, openBundle } from "./bundle.js";
import { composeSeverities, dataSetAside, FLOW_RULES, OUTSIDE_OPERATOR_RULES, PLAINTEXT_RULES, transportWordsAt, type CandidateIn, type PlaceRowIn, type SeverityRaise, type TransportWords } from "./severity-at-place.js";
import { KEPT_DECISIONS } from "./place-bar.js";
import { readRegularFile } from "./project-read.js";
import { DECISION_WORDS, decidedApplies, decisionViewOf, readDecisionRecord, type DecisionEntry, type DecisionRecord, type DecisionView, type ListName, type ListedRow, type OpenPoint } from "./decisions.js";
import { basisIndexOf, evidenceIndexOf, isPlaceId, isUnitId, placeIndexOf, placeOfUnit } from "./ref-ids.js";

type Obj = Record<string, unknown>;
type Seat = "adjudicator" | "refuter" | "silence-investigator";

/* ------------------------------------------------------------------------------------------------
 * THE WORDING TABLE. `skill` = SKILL.md's own words; `draft` = this unit's.
 * ---------------------------------------------------------------------------------------------- */
/** (build unit F4): why a place of a candidate read place by place was not checked, in plain words. */
function placeReasonWords(reason: string): string {
  return reason === "not_answered" ? "no review in this run gave an accepted answer for it" : reason === "unreadable" ? "its file could not be read, so no review was given it" : `not checked (${reason})`;
}

/** What the tier words read of a resolved basis (penalty-tier.ts `TierOfBasis`). */
type TierWordsBasis = Pick<TierOfBasis, "tier" | "tiered" | "penaltyCite" | "unresolved" | "penaltyText" | "penaltyAppliesFrom">;
/** How W19 prints a part the review's block did not establish. */
const NOT_ESTABLISHED = "not established by the review";
/** One sentence with its own closing mark: a full stop is added only where the text ends without one. */
const sentenceOf = (text: string): string => (/[.!?]["')\]]?$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);
/** The word before a provision's checked day ("checked 20 Aug 2026"). */
export const PROVISION_CHECKED_WORD = "checked";

/**
 * A provision's web address as an inline link, its text the address itself. A
 * bare address loses trailing punctuation where a viewer links it as it stands (leginfo's `...sectionNum=1798.110.`
 * loses its last dot, and the link then fails), and the angle-bracket autolink is escaped by the report's own HTML
 * guard; an inline link's target keeps every character. In the text, the characters that would end the link or start
 * a code span or emphasis are escaped (an underscore only where it is not between letters or digits); in the target,
 * the ones that would end it are percent-encoded.
 */
/**
 * The address a person reads a provision
 * at. The Publications Office resource address the rules record (`http://publications.europa.eu/resource/celex/<CELEX>`)
 * answers a browser with machine metadata (RR3-14, fetched 2026-11-10); the same document's EUR-Lex reader page is given in
 * its place, at the first article the citation names (EUR-Lex's own `#art_<n>` anchors: 99 of them on the GDPR's page,
 * fetched 2026-11-10). Every other address is given as the rule states it.
 */
export function readableProvisionUrl(url: string, cite: string): string {
  const m = /^https?:\/\/publications\.europa\.eu\/resource\/celex\/([0-9A-Za-z()-]+)$/.exec(url);
  if (!m) return url;
  const art = /\bArt(?:icle)?s?\.?\s*(\d+)/.exec(cite);
  return `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${m[1]}${art ? `#art_${art[1]}` : ""}`;
}

export function provisionLink(url: string): string {
  const text = url.replace(/[\\[\]`*]|(?<![A-Za-z0-9])_|_(?![A-Za-z0-9])/g, "\\$&");
  const target = url.replace(/[()<>\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
  return `[${text}](${target})`;
}

/**
 * WORDS' own type with every string it returns or holds `Inert`: its text is
 * the program's, and a value reaches it only through a parameter, which is `Inert` or a number, so a raw value given
 * to any template does not compile.
 */
type InertWords<T> = T extends (...a: infer A) => infer R
  ? (...a: A) => InertWords<R>
  : T extends string
    ? Inert
    : T extends readonly (infer E)[]
      ? readonly InertWords<E>[]
      : T extends object
        ? { readonly [K in keyof T]: InertWords<T[K]> }
        : T;
const inertWords = <T>(w: T): InertWords<T> => w as InertWords<T>;

/**
 * WHAT THE CARRY FOLLOWS FROM A FILE AN ANSWER
 * READ TO A FILE OF THE REPOSITORY, AS A CLOSED LIST: exactly the forms `carry-forward.ts` reads (`importSpecifiersOf`: the
 * path whole in quote marks directly after `from`, `import`, `require(` or `import(`, or a script tag's quoted `src`;
 * `localImportsOf`: how a path names a file; `scriptStemsOf`: which files), so the report never says a tie was looked at
 * that the code does not read. Checkers found one unread form after each wording (K3: other languages; K4: a comment before
 * the path, a query, an unquoted `src`, a component loaded with no import). `WORDS.carriedPastPackages` is made from these
 * lists; test:rescan-scope builds a tree for every id and holds that the carry follows each `CARRY_LOAD_FORMS` and
 * `CARRY_LOAD_PATHS` entry and carries, and names the package for, every `CARRY_NOT_FOLLOWED` one. A form added here that
 * the code does not read, or a list entry with no tree there, fails it.
 */
export const CARRY_LOAD_FORMS: readonly { id: string; words: string }[] = [
  { id: "import-from", words: '`import ... from "path"`' },
  { id: "export-from", words: '`export ... from "path"`' },
  { id: "import-bare", words: '`import "path"`' },
  { id: "require", words: '`require("path")`' },
  { id: "import-call", words: '`import("path")`' },
  { id: "script-src", words: 'a page\'s `<script src="path">`' },
];
export const CARRY_LOAD_PATHS: readonly { id: string; words: string }[] = [
  { id: "relative", words: "written relative to the file (`./`, `../`)" },
  { id: "alias-prefix", words: "after an alias prefix (`@/`, `~/`, `#`)" },
  { id: "alias-table", words: "as a name the repository's alias table above leads to a file" },
  { id: "path-end", words: "as the end of a file's path (`/js/consent.js`, or `consent` for `src/consent.js`)" },
];
export const CARRY_NOT_FOLLOWED: readonly { id: string; words: string }[] = [
  { id: "comment-before-path", words: "an `import(...)` or `require(...)` with a comment before its path (a webpack chunk name, for one)" },
  { id: "query-or-unquoted", words: "an import path or a script tag's `src` that ends in a query (`?v=3`), or a `src` not in quote marks" },
  { id: "case-differs", words: "a path whose upper and lower case differ from the file's name" },
  { id: "no-import-written", words: "a component a framework loads with no import written (Nuxt's `components/` folder, for one)" },
  { id: "wrapper-alias", words: "a file of the repository that loads the package only under another name the repository gives it" },
  { id: "other-language", words: "an import between files of the repository in any other language (a Python, Ruby or PHP module, for one)" },
];
const orList = (items: readonly { words: string }[]): string =>
  items.length === 1 ? items[0]!.words : `${items.slice(0, -1).map((i) => i.words).join(", ")} or ${items[items.length - 1]!.words}`;

export const WORDS = inertWords({
  /** skill L12, verbatim. */
  disclaimer:
    "This report is informational only and does not constitute legal advice. It identifies code that may not meet a cited standard and that requires human review; consult qualified counsel before acting on it.",
  /** draft */
  title: (scanId: Inert) => `# Scan report: ${scanId}`,
  /** draft (public-facing wording, not final): which rule bundle the scan ran, under the title. */
  /* The terminal's phrase (report.ts `SHIPPED_WORDS`, `notShippedWords`) in the report's word for
   * the rules, never a name of its own ("the rule bundle"). */
  rulesShipped: (named: Inert) => `Rules: ${named}, ${SHIPPED_WORDS}.`,
  rulesNotShipped: (named: Inert) => `Rules: ${notShippedWords("rules")}. The scan ran ${named}, and every finding below comes from its rules.`,
  rulesNoneToCompare: (named: Inert) => `Rules: ${named}; this program carries no bundle of its own to compare it with.`,
  rulesUnnamed: "Rules: the scan document does not say which rule bundle ran.",
  /** draft: printed under the title where the report or its log carries a redaction marker. */
  redactionNote:
    "Values that the product's credential rule (baseline-002) recognises are not printed in this report or in its evidence log: each is replaced by `[redacted:baseline-002#<clause>:<digest>]`. Open the file at the line shown to see it.",
  /** draft: report.md's one line under its title; the
   * full note is the first paragraph of the same file's "About this report" section, one in-file link away. */
  redactionPointer: (anchor: Inert, logOnly: boolean) => `Some values in this ${logOnly ? "report's log" : "report"} are hidden: [why](#${anchor}).`,
  /** skill L191 (the bold clause) with a draft lead. */
  regionsUnanswered: "The distribution regions were not answered: **no rule was ruled out on jurisdiction, and none could be.**",
  /** draft heading for the step 3a block (skill L189: "the applicability block from step 3a"). */
  applicabilityHeading: "## Which instruments reach this project",
  /** draft */
  applicabilityNone: "No instrument's reach was assessed in this scan.",
  /** draft */
  applicabilityLine: (law: Inert, cite: Inert, verdict: Inert, because: Inert) => `- **${law}** (${cite}): ${verdict} — ${because}`,
  /** draft */
  openQuestion: (limb: Inert) => `  - Open question: ${limb}`,
  /* laws.md: an instrument's open
   * questions in words, grouped by what an answer does (scope.ts: a required limb closes the gate on "false", an exemption
   * on "true"; a limb that does not bear on the verdict only annotates a finding). */
  lawRequiredHead: (n: number) => `  - ${group(n)} ${n === 1 ? "question decides" : "questions decide"} whether this law reaches your product:`,
  lawExemptHead: (n: number) => `  - ${group(n)} ${n === 1 ? "exemption" : "exemptions"}: a yes to one takes your product out of this law, so answer only one that may fit:`,
  lawQuestion: (question: Inert, id: Spanned, suggested?: Inert) => `    - ${question} (\`${id}\`)${suggested === undefined ? "" : ` ${suggested}`}`,
  /* Where the code suggests an answer to an
   * open question about the product, beside that question: the first place and how many more. Since R10-CRA no fact about
   * the product is counted as met from code (scope.ts `codeMaySettle`), so nothing here says the verdict rests on it. */
  lawSuggested: (where: Spanned, more: number, against: boolean) =>
    `The code suggests yes: \`${where}\`${more > 0 ? ` and ${group(more)} more ${more === 1 ? "place" : "places"}` : ""}${against ? ", against your answer of no" : ""}; only you can confirm it.`,
  /* The same words as the console (scan.ts): a
   * web manifest or service worker said as what it is; a dependency as a library; and, on the product question, what a
   * tree holding nothing users install or run looks like - never a yes the code cannot tell apart from a hosted service. */
  lawSuggestedWebClient: (where: Spanned, more: number) =>
    `A web manifest or service worker: \`${where}\`${more > 0 ? ` and ${group(more)} more ${more === 1 ? "place" : "places"}` : ""} - an installable client if users install it to run on their side, not a product if it is used only in the browser (the Commission's CRA guidance, paragraphs 20 and 21); only you can confirm which.`,
  lawSuggestedDependency: (where: Spanned, more: number, against: boolean) =>
    `The code holds only a dependency here: \`${where}\`${more > 0 ? ` and ${group(more)} more ${more === 1 ? "place" : "places"}` : ""}${against ? ", against your answer of no" : ""}; it names a library that may or may not open a connection, and only you can confirm it.`,
  lawShowsNothingInstalled:
    "The code shows nothing users install or run on their side (no package, app bundle, installer, browser extension or release); a web app or API you run on your own servers looks like this; only you can confirm it.",
  lawDetail: (n: number, ids: Spanned[]) =>
    `  - ${group(n)} more ${n === 1 ? "question adds" : "questions add"} detail to a finding and ${n === 1 ? "does" : "do"} not decide whether this law applies: ${ids.map((i) => `\`${i}\``).join(", ")}`,
  lawRecordable:
    '  - This version records an answer only to a question that "review my answers" asks; any other question here stays open, and no rule was switched off for an open one.',
  /** Said once before the instruments whose reach was not tested. */
  notAssessedLead: "The reach of the laws below is not tested by this version (their scope tests are still written as prose); no rule was switched off for them.",
  /** draft */
  contradiction: (limb: Inert, by: Inert, n: number) => `  - Declared by ${by} and contradicted by the code: ${limb} (${n} location${n === 1 ? "" : "s"})`,
  /** draft */
  notAssessed: (what: Inert) => `- Not assessed: ${what}`,
  /** Under an instrument's one block, the checklists whose entries print that same block. */
  applicabilityShared: (ids: Inert[]) => `  - One answer for ${ids.length} checklists that ask the same questions of this tree: ${ids.join(", ")}`,
  /** Under each block of an instrument whose checklists were answered differently, the one it is. */
  applicabilityChecklist: (id: Inert) => `  - Checklist: ${id}`,
  /** The carry line in the words the rest of the report uses (not-applicable.md's
   * "carried from an earlier scan, whose review read it; not read again in this one"). */
  carryLine: (run: Inert, carried: number, left: number, gone: number, notChosen = 0) =>
    `Compared with ${run}: ${carried} ${carried === 1 ? "answer was" : "answers were"} taken from it, whose review read ${carried === 1 ? "it" : "them"}, and not read again in this one; ` +
    `${left} possible ${left === 1 ? "problem was" : "problems were"} given to this scan's review; ${gone} possible ${gone === 1 ? "problem" : "problems"} of that scan ${gone === 1 ? "is" : "are"} no longer found.` +
    /* An earlier answer not used although a possible
     * problem it could answer - the same rule over lines with the same text, or the same finding - is in this scan: that
     * possible problem was compared with another answer of that scan (one about the same rule over lines with the same
     * text first), or, where that scan did not record which of several such lines it answered (F3), given to this scan's
     * review. Never counted as no longer found (F1: whether its finding is in this scan decides, not the pairing); said
     * only where there is one. */
    (notChosen > 0
      ? ` ${notChosen} other ${notChosen === 1 ? "answer" : "answers"} of that scan ${notChosen === 1 ? "was" : "were"} not used: ${notChosen === 1 ? "it" : "each"} matched a possible problem this scan found - the same rule over lines with the same text, or the same finding - and that possible problem was either compared with another answer of that scan instead (only one answer is compared with each possible problem, and one about the same rule over lines with the same text goes first) or given to this scan's review, because that scan did not record which of several such lines ${notChosen === 1 ? "it" : "each"} answered.`
      : ""),
  /** draft heading */
  findingsHeading: "## Findings",
  /** draft */
  findingsNone: "No candidate in this run was returned as a finding to fix or for review.",
  /**
   * The run had no second check because the shape chosen has none (the refuter
   * left the default). Said as a fact of the shape, never as a step skipped or pending.
   */
  refutationDeferred:
    "This run had no second check: the run shape chosen for it does not include one, so each finding to fix below stands as the review that read it judged it, and no second review tried to prove it wrong.",
  /** skill L189 / L184 labels */
  /* The record's words ("to fix") in the
   * report too: the report a developer forwards never labels the person's own product a "violation". */
  labelCandidate: "to fix",
  labelNotYetRefuted: "to fix — *its second check has not answered*",
  /** A violation candidate of a run whose shape has no second check. */
  labelNoSecondCheck: "to fix — *no second check in this run*",
  labelCounsel: "*review by qualified counsel recommended*",
  /** draft */
  itemHead: (n: number, ruleId: Inert, title: Inert) => `### ${n}. ${ruleId} — ${title}`,
  /** draft */
  /** A finding the facts at its place raised shows both levels. */
  severityBoth: (level: Inert, own: Inert) => `${level} (the rule's own level is ${own})`,
  // A reason that ends its own sentence (a raise by weight's, W12) keeps
  // its full stop and gets no second one.
  severityRaised: (level: Inert, because: Inert) => `- Severity raised to ${level}: ${sentenceOf(because)}`,
  /** A transport raise that a raise by weight took the place of. */
  severityRaisedAlso: (level: Inert, because: Inert) => `- Also raised to ${level} before that: ${sentenceOf(because)}`,
  /* The level is said once, and the reason keeps the record's own verb ("reaches"). */
  severityRaisedNotAnswered: (level: Inert, because: Inert) => `  - Severity raised to ${level} although no answer was accepted for this finding: ${sentenceOf(because)}`,
  itemMeta: (label: Inert, findingId: Spanned, severity: Inert, confidence: Inert) =>
    `- **${label}** · \`${findingId}\` · severity ${severity} · confidence ${confidence}`,
  /** draft */
  whyCheck: (note: Inert) => `- Why: the quotation check could not confirm this record — ${note}`,
  /** draft */
  whyRefutationCheck: (note: Inert) => `- Why: the quotation check could not confirm the second review — ${note}`,
  /** draft */
  whyRefuter: (fact: Inert) => `- Why: the second review found the question open — ${fact}`,
  /** draft */
  whyModel: (fact: Inert) => `- Why: the review could not settle it from the code — ${fact}`,
  /** draft */
  evidence: (file: Spanned, lines: Spanned, quote: Spanned, roles: Inert[] = []) =>
    `- Evidence: \`${file}:${lines}\` — \`${quote}\`${roles.length > 0 ? ` (cited as ${roles.join(" and as ")})` : ""}`,
  /** What an evidence entry is cited as, by its `role` (and its `name`). */
  evidenceRole: (role: Inert, name: Inert) =>
    role === "premise"
      ? "what the finding rests on"
      : role === "item"
        ? name ? `the item "${name}"` : "an item"
        : role === "element"
          ? name ? `the element "${name}"` : "an element"
          : role === "site"
            ? "a location of the finding"
            : role === "dismissal"
              ? "a place read and set aside as not the construct"
              : plainName(role),
  /** draft */
  noEvidence: "- Evidence: none quoted.",
  /** draft, from skill L185 (elided_quotes). */
  elided: "  - Quoted in parts: the parts are where the record says, and nothing was checked about the lines between them.",
  /** draft: the first line of a finding the quotation check demoted: what the seat concluded, and why it is not kept. */
  demotedLead: (who: Inert, word: Inert, where: Inert, reasoning: Inert, because: Inert) =>
    `- Why this needs review: ${who} concluded **${word}** about ${where}${reasoning ? ` - "${reasoning}"` : ""}. ${because}`,
  /** draft: the subjects of `demotedLead`. */
  demotedFirstReview: "the first review",
  /** draft: the lead of a finding whose SECOND review the check demoted: each review's conclusion, in
   * order, each with its own reasoning (the second review's reasoning used to follow the first review's conclusion). */
  demotedLeadSecond: (where: Inert, firstReasoning: Inert, word: Inert, secondReasoning: Inert, because: Inert) =>
    `- Why this needs review: the first review concluded **violation candidate** about ${where}${firstReasoning ? ` - "${firstReasoning}"` : ""}. A second review concluded **${word}**${secondReasoning ? ` - "${secondReasoning}"` : ""}. ${because}`,
  /** draft: a row of the second review, named as the second review's. */
  demotedRowSecond: (row: Inert) => `the second review's ${row}`,
  /** draft: the reason, where quotations failed. */
  demotedRows: (n: number, whose: Inert) =>
    `The program could not confirm ${n === 1 ? "one quotation" : `${n} quotations`} ${whose} rests on, so it does not keep that conclusion:`,
  demotedWhoseFirst: "that conclusion",
  demotedWhoseSecond: "the second review",
  /** draft: the reason, where the record itself was refused. */
  demotedMalformed: (problem: Inert) => `The record does not have the shape the program reads (${problem}), so the program does not keep that conclusion.`,
  demotedNoEvidence: "The record quotes nothing, and a conclusion of this kind must quote the code it rests on, so the program does not keep it.",
  demotedOther: (note: Inert) => `The quotation check did not keep it: ${note}`,
  /** draft: one quotation the check could not confirm. */
  demotedRow: (place: Spanned, row: Inert, reason: Inert) => `  - \`${place}\` (${row}): ${reason}`,
  demotedRowEvidence: (n: number) => `evidence ${n}`,
  demotedRowReading: (n: number) => `reading row ${n}`,
  /** draft: why one quotation could not be confirmed, by the check's reason. */
  failureWords: {
    not_found: "the quoted text is not in that file, nor in any other file the check read.",
    other_file: (where: Spanned) => `the quoted text is not in that file; it is in \`${where}\`.`,
    several_files: "the quoted text is not in that file, and it is in several other files, so no one place can be named.",
    first_line_only: "only the first line of the quotation is in the file; the rest of it is not.",
    no_content: "the quotation holds no text of its own (only punctuation, a placeholder or a keyword), so it shows nothing about the file.",
    redacted: "the quotation carries a redaction marker, so it cannot be compared with the file.",
  },
  /** draft: one group of locations whose dismissal the check withdrew. */
  unconfirmedGroup: (n: number, where: Inert, record: Inert, whoDismissed: Inert, quote: Spanned, place: Spanned, reason: Inert) =>
    `- Classification not confirmed: ${n} location${n === 1 ? "" : "s"} (${where}), from ${record}. ${whoDismissed} dismissed ${n === 1 ? "it" : "them"} as not the construct on a quotation the check could not confirm (\`${quote}\` at \`${place}\`: ${reason}) ${n === 1 ? "It is" : "They are"} not cleared, and every location is listed in the evidence log.`,
  unconfirmedKind: (by: Spanned, others: number) => (others > 0 ? `\`${by}\` and ${others} other member${others === 1 ? "" : "s"} of its kind` : `\`${by}\``),
  unconfirmedFirst: "The first review",
  /** draft: the one place every withdrawn group is printed, whatever section its record is in. */
  unconfirmedHeading: "### *classification not confirmed - dismissals the check could not confirm*",
  /** draft: the record a withdrawn group comes from, and where the report shows that record. */
  unconfirmedRecord: (ruleId: Inert, findingId: Spanned, standing: Inert) => `finding \`${findingId}\` of ${ruleId || "(no rule named)"} (${standing})`,
  /** draft: where the report shows a record, by its label. */
  unconfirmedStanding: (label: Inert): string =>
    (
      {
        // A finding that stands is in its own file (design 3.1.1); details.md is gone. The record's words.
        candidate: "to fix, in its own file under findings/",
        not_yet_refuted: "to fix, its second check not answered, in its own file under findings/",
        no_second_check: "to fix (no second check in this run), in its own file under findings/",
        counsel: "review by qualified counsel recommended, in its own file under findings/",
        overturned: "overturned by the second review, in ruled-out.md",
        overturned_on_gate: "overturned by the second review on a gate, under Partly checked in this file",
        overturned_unquoted: "overturned by a second review that quoted nothing, under its own heading in this file",
        dismissed: "not applicable, in ruled-out.md",
      } as Record<string, string>
    )[label] ?? label,
  unconfirmedSecond: "The second review",
  /** draft: a class word as the lead says it. */
  wordOf: (word: Inert) =>
    ({ violation_candidate: "violation candidate", not_applicable: "not applicable", needs_human: "needs review", upheld: "upheld", overturned: "overturned" } as Record<string, string>)[word] ?? (word || "(no word)"),
  /** draft, from skill L185 (short_quotes). */
  short: "  - The quotation is under eight characters, so it identifies its line weakly.",
  /** draft, from skill L185 (redacted_quotes). */
  redacted: "  - The record redacted a value, so its quotation is not verbatim by its own account and no mechanical check could confirm it.",
  /** draft, from skill L187 (no_evidence). */
  unchecked: (whose: Inert) => `- ${whose} carried no quotation, so nothing about it was checked.`,
  /** draft: the subjects `unchecked` is said of. */
  uncheckedThisRecord: "This record",
  uncheckedSecondReview: "The second review",
  uncheckedThisRow: "This row",
  /** draft */
  legalBasis: (refs: Inert) => `- Legal basis: ${refs}`,
  /** draft */
  remediation: (text: Inert) => `- Proposed remediation: ${text}`,
  /** (no internal terms), from the skill's reading line (the reading line): what was opened,
   * what was settled without being opened, and what was not read, with why in the report's plain words. */
  reading: (opened: number, settled: number, notRead: number, why: Inert, fact = 0, summarized = 0) =>
    `- Reading: ${opened} place${opened === 1 ? "" : "s"} opened and read; ${fact > 0 ? `${fact} given as a fact the program verified on the line, not opened; ` : ""}${summarized > 0 ? `${summarized} read in a data summary the program verified, not opened; ` : ""}${settled} settled from the form of the matched line alone, without being opened; ${notRead} not read${why ? ` (${why})` : ""}.`,
  /** One finding's places no review read in this run. */
  notChecked: (places: number, files: number, why: Inert) =>
    `- **Not checked:** ${places} place${places === 1 ? "" : "s"} in ${files} file${files === 1 ? "" : "s"} ${places === 1 ? "was" : "were"} not read in this run, so this answer says nothing about ${places === 1 ? "it" : "them"}: ${why}.`,
  /** Why the places were not read, one phrase per reason the record gives, in plain words. */
  notCheckedWhy: {
    seat_declined: (n: number) => `${n} the review chose not to read`,
    repository_answer: (n: number) => `${n} past the places read for a rule that asks only whether the practice exists at all`,
    budget: (n: number) => `${n} left to a part of the reading that did not finish`,
    rule_instruction: (n: number) => `${n} the rule's own instructions leave unread`,
    unreadable: (n: number) => `${n} in a file that could not be opened`,
    /* Answered as opened, not opened (at most the one line was seen, as a search result shows it). */
    not_opened: (n: number) => `${n} the review named as read but did not open (at most it saw the one matched line, as a search shows it)`,
    /* Build unit F3 (full-read design 1.7): a place no review answered - its review was refused to the end, stopped or
     * never came back, and so did the one more review the program gave it, or that review was never given. */
    not_answered: (n: number) => `${n} not checked (no answer): no review in this run gave an accepted answer for ${n === 1 ? "it" : "them"}`,
  } as Record<string, (n: number) => string>,
  /** A reason the record gives that the words above do not know, said as written. */
  notCheckedWhyOther: (n: number, reason: Inert) => `${n} not read (${reason})`,
  /** The review's own sentence on why, quoted. */
  notCheckedSaid: (note: Inert) => `"${note}"`,
  /** Where, one file a line. */
  notCheckedFile: (file: Spanned, lines: Inert) => `  - \`${file}\`: ${lines}`,
  /** Words */
  notCheckedLines: (lines: number[]) => `line${lines.length === 1 ? "" : "s"} ${lines.join(", ")}`,
  /** Places a record counts and does not locate. */
  notCheckedUnlisted: (n: number) => `  - ${n} more place${n === 1 ? "" : "s"} whose lines this record does not list; findings.json lists every matched line of this finding`,
  /** The files past the ones listed beside the finding. */
  notCheckedMoreFiles: (files: number, places: number) =>
    `  - and ${places} more place${places === 1 ? "" : "s"} in ${files} more file${files === 1 ? "" : "s"}: every place is listed under *Places not checked* in [not-checked.md](not-checked.md)`,
  /** The total; since rf11 at the head of not-checked.md (record rf11-b1a section 4, item 7). */
  notCheckedTotal: (places: number, findings: number) =>
    `**Not checked in this run: ${places} place${places === 1 ? "" : "s"} in ${findings} finding${findings === 1 ? "" : "s"}.** Nothing is known about ${places === 1 ? "it" : "them"}: each finding says how many and where, and every place is listed under *Places not checked* in [not-checked.md](not-checked.md).`,
  /** What the carry did not look at, in words a person
   * reads (the plan's `packages_changed_not_rested_on`, which only the plan file held).: the files read for a name, and the one-step wrapper.: a target written as a pattern.: the one-step wrapper is followed only
   * for the files `carry-forward.ts` `scriptStemsOf` lists, by the forms `importSpecifiersOf` reads.: those forms as a closed list
   * (`CARRY_LOAD_FORMS`, `CARRY_LOAD_PATHS`), then "any other way ... is not looked at" with the checkers' cases. */
  carriedPastPackages: (answers: number, list: Inert, more: number) =>
    `${answers} of these answers ${answers === 1 ? "was" : "were"} taken although the declarations of packages ${answers === 1 ? "it does" : "they do"} not rest on changed: ${list}${more > 0 ? `, and ${more} more` : ""}. ` +
    "An answer rests on a package where it names the package, or read, quoted or searched a line that loads, calls or names it, or a name the repository gives it (an npm alias, a bundler's, TypeScript's or test runner's alias, an import map, Node's imports field, a copy step's new name) in a JavaScript, TypeScript, JSON or .rc file, an import map in a page, or Rails' config/importmap.rb; or where a file it read loads a file of the repository ending in .js, .jsx, .ts, .tsx, .mjs, .cjs, .mts, .cts, .vue, .svelte or .astro that loads or names it, in one of these forms only, each with its path written out whole in quote marks as shown: " +
    `${orList(CARRY_LOAD_FORMS)}; the path ${orList(CARRY_LOAD_PATHS)}. ` +
    "Any other way one file loads another is not looked at. " +
    `Not looked at, for example: ${CARRY_NOT_FOLLOWED.map((i) => i.words).join("; ")}; ` +
    "a name given anywhere else (a YAML file, for one); a name, target or import path that code computes rather than writes out; a target written as a pattern with a *; a package reached through two or more files of the repository in a row; and a package the code uses through a global that a script tag in a file the answer did not read defines. " +
    "If an answer rests on one of these packages, have every answer read again: run the scan again and, when it asks for your earlier run, do not name one.",
  /** The lock files, which no comparison reads. */
  carriedLockLimit:
    "Not looked at either: a version that changed only in a lock file (package-lock.json, pnpm-lock.yaml, yarn.lock, composer.lock, Gemfile.lock, poetry.lock and the like) while the manifest's range stayed the same. An answer given on the earlier version is taken as it stands. A change to SwiftPM's Package.resolved is seen.",
  /** How the person has the places not checked read later. */
  notCheckedAsk: (log: Inert) =>
    `To have them read, run the scan again and, when it asks for your earlier run, name this run's evidence log (${log}). Each finding with places not checked is then reviewed again, and the review is told which places were not read; a place it still does not read is shown again as not checked.`,
  /** ("checked" is only a place opened, and a place settled by its form is said apart). */
  readAgainTotal: (checked: number, settled: number, previous: number, run: Inert, findings: number) =>
    `**Asked to be read again: ${checked} of the ${previous} place${previous === 1 ? "" : "s"} not checked in ${run} ${checked === 1 ? "was" : "were"} opened and checked in this run` +
    (settled > 0 ? `, and ${settled} ${settled === 1 ? "was" : "were"} settled from the form of the matched line alone, without being opened` : "") +
    `, over ${findings} finding${findings === 1 ? "" : "s"}.** Each finding says how many of its own.`,
  /** The later reading, beside one finding. */
  readAgain: (checked: number, settled: number, previous: number, run: Inert) => {
    const rest = previous - checked - settled;
    return (
      `- **Asked to be read again:** ${run} did not check ${previous} place${previous === 1 ? "" : "s"} of this finding; ${checked} of them ${checked === 1 ? "was" : "were"} opened and checked in this run` +
      (settled > 0 ? `, ${settled} ${settled === 1 ? "was" : "were"} settled from the form of the matched line alone, without being opened` : "") +
      (rest > 0
        ? `, and the other ${rest} ${rest === 1 ? "is" : "are"} still not checked: listed as not checked here, or not matched to a place this run opened.`
        : ".")
    );
  },
  /** A finding scan X left places unread in, with no answer in this run. */
  readAgainUnanswered: (findings: number, places: number) =>
    `${findings} of those finding${findings === 1 ? "" : "s"}, with ${places} of the places, ${findings === 1 ? "has" : "have"} no answer in this run: ${findings === 1 ? "it is" : "they are"} listed under the findings not adjudicated, and ${places === 1 ? "that place is" : "those places are"} still not checked.`,
  /** `not_applicable` answers that rest on places nobody read are shown, never collapsed with the clean ones. */
  partlyCheckedHeading: "### *Partly checked: not applicable only for the places read*",
  /** Words */
  partlyCheckedIntro:
    "Each answer below says \"not applicable\" only for the places that were read and decided. The places listed under it were not read, were read and left undecided, or were read as what the rule looks for, and any of them could change that answer.",
  /** Heading: every place no review read, by finding and by file. */
  placesNotChecked: "### *Places not checked*",
  /** "not applicable" answers a second review gave without quoting a line. */
  overturnedUnquotedHeading: '### *"Not applicable" from a second review that quoted nothing*',
  /** Words */
  overturnedUnquotedIntro:
    "Each answer below was turned to \"not applicable\" by a second review that quoted no line of the code, so nothing about it was checked. Read its places yourself before relying on it.",
  /** Findings that stand on the first review alone. */
  notRefutedHeading: "### *Findings with no usable second review*",
  /** Words */
  notRefutedIntro:
    "Each finding below has no second review whose answer could be used: its second review was not launched, or its answer could not be used. Whether it survives a second review is not established. Each line says where the finding is placed.",
  /** One finding, why its second review is missing, and where its evidence is. */
  notRefutedRow: (ruleId: Inert, findingId: Spanned, because: Inert, link: Inert, placed: Inert) => `- ${ruleId} \`${findingId}\`: ${because}. It is ${placed}. Its evidence: ${link}`,
  notRefutedHeld: (reason: Inert) => `no second review was launched for it, because the command that makes the second reviews' entries held it back: ${reason}`,
  notRefutedInvalid: (seat: Inert, kept: Spanned) => `the second review's answer (seat ${seat}) was sent back twice and did not hold the third time; it is kept whole at \`.legal/${kept}\``,
  notRefutedNone: "no second review of it is recorded in this run",
  /** Words */
  placesNotCheckedRow: (ruleId: Inert, findingId: Spanned, places: number, why: Inert) =>
    `- ${ruleId} \`${findingId}\`: ${places} place${places === 1 ? "" : "s"} not read (${why})`,
  /** draft, from skill L191 ("the answer and the code disagree"). */
  answerDisagrees: (expr: Spanned) => `- The answer \`${expr}\` and the code disagree: this candidate was raised on the subject the answer says is absent.`,
  /** draft */
  upheld: "- Second review: upheld.",
  /** draft: beside a record the check invalidated, whatever the second review said. */
  secondReviewOfInvalidated: (outcome: Inert) =>
    `- Second review, of the record as written: ${outcome}. It moves nothing here: the quotation check could not confirm the record it reviewed.`,
  /** draft */
  carried: (run: Inert) => `- Carried forward from ${run}; not re-read in this run.`,
  /** draft: what `carried` says when the carried record names no scan. */
  carriedFromUnnamed: "(not named)",
  /** draft heading (skill L189: "Put `not_applicable` items last, collapsed"). */
  dismissedHeading: "## Not applicable",
  /** draft */
  dismissedSummary: (n: number) => `<details><summary>${n} item${n === 1 ? "" : "s"}, each with its reason</summary>`,
  /** draft */
  dismissedNone: "No item in this run is in this state.",
  /** draft */
  dismissed: (ruleId: Inert, findingId: Spanned, reason: Inert) => `- ${ruleId} \`${findingId}\`: not applicable — ${reason}`,
  /** skill L189/L168 ("labelled as such") with draft wording. */
  overturned: (ruleId: Inert, findingId: Spanned, grounds: Inert, reason: Inert) =>
    `- ${ruleId} \`${findingId}\`: **overturned by the second review** (${grounds}) — ${reason}`,
  /** An overturn on `already-gated` is never listed with the clean items. */
  overturnedOnGate:
    "  - The second review overturned it on a gate (`already-gated`). The code shows that the gate exists, not that it keeps the call from running for every visitor, and a consent check never makes a finding not applicable: check the gate it quoted.",
  /** Printed under the partly-checked intro where the section holds such an overturn. */
  partlyCheckedGateIntro:
    "An answer the second review overturned on a gate is listed here too, with the gate it quoted: a gate in the code is not shown as clean.",
  /** draft, from skill L187 (overturned_without_evidence). */
  overturnedUnchecked: "  - The second review that overturned it carried no quotation, so nothing about it was checked; it is the weakest link in this report.",
  /** skill L189 label, draft sentence. */
  byDeclaration: (ruleId: Inert, findingId: Spanned, because: Inert, regions: Inert, from: Inert, date: Inert = ours("")) =>
    `- ${ruleId} \`${findingId}\`: *not applicable by declaration* — ${because} (declared regions: ${regions}; answered from ${from}${date ? ` on ${date}` : ""})`,
  /** skill L190, verbatim heading. */
  notEstablished: "## WHAT WAS NOT ESTABLISHED",
  /** skill L190, verbatim subsection headings. */
  gapFound: "### *gap found — detector missed it*",
  apparentlyAbsent: "### *apparently absent — searched, nothing found*",
  unknownNotChecked: "### *unknown — not checked*",
  /** draft heading (skill L190: "reported under their own heading"). */
  notEvaluated: "### *not evaluated*",
  /** skill L190 label used as a heading. */
  notApplicableByDeclaration: "### *not applicable by declaration*",
  /** skill L191, verbatim headings. */
  didNotRead: "### *What this scan did not read*",
  filesNotRead: "### *Files that were not read*",
  linesNotRead: "### *Lines that were not read*",
  /** draft: renamed from "Questions nobody answered", which
   * named questions the program chose not to ask; each row now says what became of its question (`questionStatus`). */
  /** one heading for the one item (it was "Questions still open"). */
  questionsUnanswered: "### *Questions open*",
  answersNotTaken: "### *Answers this scan did not take at face value*",
  notAdjudicated: "### *Candidates not adjudicated in this run*",
  /** (A-63; relay integration part B, milestone 3): candidates whose seat's answer stayed invalid, as the hook's receipt says they are reported. */
  notJudgedInvalid: "### *Candidates nobody judged: the seat's answer could not be used*",
  /** An answer step 6 set aside, by the reason the program gives. */
  notJudgedUnusable: "### *Candidates nobody judged: the answer could not be used*",
  /** Words */
  notJudgedUnusableRow: (findingId: Spanned, why: Inert) =>
    `- \`${findingId}\` — its answer could not be used: ${why}. Nobody judged this candidate: it is not dismissed, cleared or not applicable. A later run judges it again.`,
  /** Words */
  whyRefutationUnusable: (why: Inert) =>
    `- Why not refuted: the second review's answer could not be used: ${why}. Whether this candidate survives a second review is not established.`,
  /** Words */
  notRefutedUnusable: (why: Inert) => `the second review's answer could not be used: ${why}`,
  /**
   * Why an ordinary overturn on a location ground was set aside at
   * the assembly (`locationOverturnRefused`, standing.ts): the rule does not declare that its duty is about the running product.
   */
  /* "only": a rule that does not opt in has a duty about what the product does
   * when it runs AND about what scripts, jobs and deployment steps do; saying its duty is not about the running product was false. */
  /** The reason an overturn whose ground is not exactly one listed ground is set aside. */
  groundNotListed: (ground: Inert, listed: readonly Inert[]) =>
    `it overturned the finding on the ground ${ground}, which is not exactly one of the grounds an overturn may give (${listed.join(", ")}), so the overturn says nothing that can be placed`,
  /** A carried verdict that is not the whole set the carry writes. */
  carriedNotWhole: (why: Inert) =>
    `this carried verdict is not whole (${why}); the carry never writes such a verdict, since it judges the finding again, so it was changed after it was written or carried from another run`,
  locationGroundUnusable: (ground: Inert) =>
    `it overturned the finding on the ground "${ground}", which says where the line sits or whether it runs, and that ground applies only to a rule whose duty is only about what the product does when it runs; this rule's duty is not only about that`,
  /** The log's `note` on a silent rule whose investigator's answer was set aside. */
  silenceUnusableNote: (why: Inert) => `not established: the investigator's answer could not be used: ${why}`,
  /** (A-63) */
  notJudgedInvalidRow: (findingId: Spanned, seat: Inert, kept: Spanned) =>
    `- \`${findingId}\` — the answer of seat ${seat} was sent back twice and did not hold the third time; it is kept whole at \`.legal/${kept}\`. Nobody judged this candidate: it is not dismissed, cleared or not applicable.`,
  /**
   * A candidate read place by place whose
   * answer could not be used. Unit U1: the heading says nothing about reading, because it holds over entries
   * whose places were read and entries whose places were not; the line under it and each entry count both.
   */
  notAnswered: "### *Candidates not answered: no answer over them could be used*",
  /**
   * Unit U1: the line under the heading, counting read and not-read places over every entry.brief
   * Places carried from an earlier scan are counted apart, as neither read in this scan nor not read.
   */
  notAnsweredLead: (candidates: number, places: number, read: number, notRead: number, carried = 0) =>
    `${candidates} candidate${candidates === 1 ? "" : "s"} with ${places} place${places === 1 ? "" : "s"}: ${
      carried === 0 ? `${read} of ${places} read` : `${read} of ${places} read in this scan, ${carried} carried from an earlier scan`
    }, ${notRead} not read. Each entry below counts its own.`,
  /** (build unit F4, A7) */
  notAnsweredRow: (findingId: Spanned, seat: Inert, kept: Spanned, places: number, read: number, unchecked: number, keptPlaces: number, table: Spanned, carried = 0, scans: readonly Inert[] = []) =>
    `- \`${findingId}\` — ${
      // Fix F3: a place carried from an earlier scan is decided, so "nothing is known" is said only where none is.
      carried > 0
        ? `${read} of ${places} place${places === 1 ? "" : "s"} read in this scan, ${carried} carried from an earlier scan${scans.length > 0 ? ` (${scans.join(", ")})` : ""}, ${unchecked} not read (not checked); the seats found the construct at ${keptPlaces} of the ${read + carried} read or carried.`
        : read === 0
          ? `none of its ${places} place${places === 1 ? " was" : "s were"} read (${unchecked} not checked), so nothing is known about ${places === 1 ? "it" : "them"}.`
          : `${read} of ${places} place${places === 1 ? "" : "s"} read, ${unchecked} not read (not checked); the seats found the construct at ${keptPlaces} of the ${read} read.`
    } The answer over ${read + carried === 0 ? "this candidate" : "them"} (seat ${seat}) was sent back and did not hold, and it is kept whole at \`.legal/${kept}\`. Nobody answered this candidate: it is not dismissed, cleared or not applicable. Every place, with how it was read or why it was not: \`.legal/${table}\`.`,
  /** (build unit F4, A7) */
  notAnsweredKept: (place: Spanned) => `  - found the construct: \`${place}\``,
  /** (build unit F4, A7) */
  notAnsweredKeptMore: (n: number) => `  - and ${n} more place${n === 1 ? "" : "s"} where the construct was found; every one is in the evidence log and the per-place table.`,
  /** (build unit F4, design section 3 "How the person sees it"): how every place of a finding was read. */
  placesRead: (read: number, places: number, window: number, fact: number, summary: number, unchecked: number, why: Inert) =>
    `- Places: ${read} of ${places} place${places === 1 ? "" : "s"} read: ${window} by opening the lines around the match, ${fact} from the matched line alone (a prose line or catalogue entry the program checked holds no code; not opened)${summary > 0 ? `, ${summary} from a summary of a data file's records that the program checked` : ""}; ${unchecked} not checked${why ? ` (${why})` : ""}.`,
  /** (build unit F4): why a place was not checked, in plain words. */
  placeReason: (reason: Inert) => placeReasonWords(reason),
  /** (build unit F4) */
  placesNotCheckedWhy: (reason: Inert, n: number) => `${n}: ${placeReasonWords(reason)}`,
  /** (build unit F4) */
  placeNotCheckedRow: (place: Inert, at: Spanned, why: Inert) => `  - not checked: ${place} at \`${at}\` — ${why}`,
  /** (verification A, VA-1): places a seat read and could not decide. */
  placesUndetermined: (n: number, carried = 0) =>
    carried === 0
      ? `- ${n} place${n === 1 ? " was" : "s were"} read and left undecided: the code shown did not settle ${n === 1 ? "it" : "them"}, so a person has to look.`
      : carried === n
        ? `- ${n} place${n === 1 ? " was" : "s were"} read in an earlier scan and left undecided there, and that answer was carried into this one: the code shown did not settle ${n === 1 ? "it" : "them"}, so a person has to look.`
        : `- ${n} places were left undecided: ${n - carried} read in this scan, and ${carried} read in an earlier scan whose answer was carried into this one; the code shown did not settle them, so a person has to look.`,
  /** A `not_applicable` answer over places read as what the rule looks for. */
  placesKeptUnderNotApplicable: (n: number, list: Inert, more: number) =>
    `- ${n} place${n === 1 ? " was" : "s were"} read as what this rule looks for, which an answer of not applicable cannot rest on: ${list}${more > 0 ? `, and ${more} more` : ""}; every one is a row of the per-place table.`,
  /** (verification A, VA-1) */
  placeUndeterminedRow: (place: Inert, at: Spanned, carried = false) => `  - undecided: ${place} at \`${at}\`${carried ? " (read in an earlier scan)" : ""}`,
  /** (verification A, VA-1) */
  placesUndeterminedMore: (n: number) => `  - and ${n} more place${n === 1 ? "" : "s"} left undecided; each is a row of the per-place table.`,
  /** (build unit F4) */
  placesNotCheckedMore: (n: number) => `  - and ${n} more place${n === 1 ? "" : "s"} not checked; each is a row of the per-place table.`,
  /** (build unit F4; the F3 smoke session's second run): how each place of one file was read. */
  placeHowFile: (file: Spanned, how: Inert) => `  - \`${file}\`: ${how}`,
  /** (build unit F4) */
  placeHowWindow: (lines: Inert) => `${lines} read by opening the lines around the match`,
  /** (build unit F4): a fact place is given, never opened. */
  placeHowFact: (lines: Inert) => `${lines} read from the matched line alone, which the program checked (not opened)`,
  /** (build unit F4) */
  placeHowSummary: (lines: Inert) => `${lines} read from a summary of the data file's records that the program checked (not opened)`,
  /** Places whose row an earlier scan wrote and this one carried. */
  placeHowCarried: (lines: Inert) => `${lines} carried from an earlier scan (not read in this one)`,
  /** What they rested on is named from the one list the carry
   * compares (`PLACE_PREMISE_WORDS`), where this sentence had kept its own list and missed two premises. */
  placesCarried: (n: number, scans: Inert) =>
    `- ${n} more place${n === 1 ? " was" : "s were"} not read in this scan: ${n === 1 ? "its answer was" : "their answers were"} carried from an earlier scan (${scans}), because nothing ${n === 1 ? "it" : "they"} rested on has changed (${placePremisesInWords()}).`,
  /** (build unit F4) */
  placeHowNotChecked: (lines: Inert, why: Inert) => `${lines} not checked: ${why}`,
  /** (build unit F4) */
  placeHowMoreFiles: (files: number, places: number) => `  - and ${files} more file${files === 1 ? "" : "s"} (${places} place${places === 1 ? "" : "s"}); every place is a row of the per-place table.`,
  /** (build unit F4) */
  placesBeyond: (b: number) => `- ${b} place${b === 1 ? " was" : "s were"} decided with a line outside the lines around the match, which the review opened.`,
  /** (build unit F4): an enumeration's items, every one with its place count. */
  placesItems: (list: Inert) => `- Items: ${list}.`,
  /** (build unit F4) */
  placesItem: (item: Inert, n: number) => `${item} (${n} place${n === 1 ? "" : "s"})`,
  /** An enumeration whose kept places name no item. */
  placesItemsNone: "- Items: none named.",
  /** The own-name item. */
  /** The words follow the answer (`relation`). */
  placesOwnName: (o: { entry: Inert; item: Inert; places: number; read: number; named_only: number; publisher_service: number; undetermined: number }, relation: "own" | "fork" | null = null) =>
    `- Item: ${o.item} - you answered that this code is ${relation === "fork" ? `a fork of ${o.entry}'s software` : relation === "own" ? `${o.entry}'s software` : `${o.entry}'s software or a fork of it`}, so its ${o.places} place${o.places === 1 ? "" : "s"} naming only ${o.entry} were each read for whether the code only names the product or calls a service the publisher runs: ${o.read} read, ${o.named_only} only name the product, ${o.publisher_service} call a service the publisher runs (listed under ${o.entry} above), ${o.undetermined} undetermined. Every place is in the per-place table; to change the answer, run ${reviewDeclarationCommand()}.`,
  /** Kept places with no item, so the list of items may leave one out. */
  placesItemsMissing: (n: number, first: Inert, more: number) =>
    `- ${n} place${n === 1 ? "" : "s"} found to be what this rule looks for ${n === 1 ? "names" : "name"} no item, so the list of items may leave one out: ${first}${more > 0 ? `, and ${more} more` : ""}; every one is a row of the per-place table.`,
  /** (build unit F4) */
  placesTable: (path: Spanned) => `- Every place, with how it was decided: \`.legal/${path}\` (one row per place; the row of place P<n> is line n + 2).`,
  /** (build unit F4, review R18): the rules read on a model other than their own setting. */
  modelOverride: (said: Inert) => `*${said}*`,
  /** (A-63) */
  whyRefutationInvalid: (seat: Inert, kept: Spanned) =>
    `- Why not refuted: the second review's answer (seat ${seat}) was sent back twice and did not hold the third time; it is kept whole at \`.legal/${kept}\`. Whether this candidate survives a second review is not established.`,
  /** A violation_candidate `refuter-entries` held back, so no second review was launched for it. */
  whyRefutationHeld: (reason: Inert) =>
    `- Why not refuted: no second review was launched for it, because the command that makes the second reviews' entries held it back: ${reason}. Whether this candidate survives a second review is not established.`,
  /** (A-63; X33): no capture ledger was checked, so no record is tied to an answer the program received. */
  noLedgerChecked:
    "No capture ledger was checked: this run's records were not taken through the plugin's hook, so nothing on disk shows that each record is the answer its seat returned.",
  /** (A-63; O10): candidates the scanner suppressed, kept by a diagnostic run, that no verdict answers. */
  suppressedHeading: "### *Candidates the scanner suppressed*",
  /** (A-63; O10) */
  suppressedRow: (findingId: Spanned, reason: Inert) =>
    `- \`${findingId}\` — the scanner suppressed it (${reason}) and this run did not adjudicate it: it is not dismissed, cleared or not applicable.`,
  /** (A-63): the log's `note` on a silent rule whose investigator's answer stayed invalid. */
  silenceInvalidNote: (seat: Inert, kept: Inert) =>
    `not established: the investigator's answer (seat ${seat}) was sent back twice and did not hold the third time; it is kept whole at .legal/${kept}`,
  /** (A-63) */
  silenceInvalidAnswer: (seat: Inert, kept: Spanned) =>
    `  - The investigator's answer (seat ${seat}) was sent back twice and did not hold the third time; it is kept whole at \`.legal/${kept}\`. Nothing about this rule was established.`,
  /** skill L192, verbatim heading. */
  settlementNotHonoured: "### *Settlement claimed in the tree and not honoured*",
  /** draft */
  emptySection: "No entry in this run.",
  /** draft */
  gapRow: (ruleId: Inert, title: Inert) => `- ${ruleId} — ${title}: the construct was found and this rule did not raise it.`,
  /** draft */
  absentRow: (ruleId: Inert, title: Inert) => `- ${ruleId} — ${title}: searched, and nothing was found.`,
  /** draft */
  searchedRow: (what: Inert) => `  - Searched: ${what}`,
  /** draft, from skill L190 ("flag any that contradicts the declared profile as a finding"). */
  contradictsProfile: (what: Inert) => `  - **This contradicts the declared profile:** ${what}`,
  /** draft */
  /** A rule with no candidate has no place, and its row says so instead of printing its evidence
   * template, whose `{file}:{line}` stand for the place of a match. */
  noPlaceSilent: "the scan raised no place for this rule, so none is shown here; whether what it looks for is absent was not established",
  /** A rule whose own patterns DID match, and whose matches the scan's corroboration step
   * then set aside (findings.json `matches_removed_by_corroboration`), must not read as a rule that matched nothing. */
  noPlaceCorroborated: (n: number) =>
    `its patterns matched ${n.toLocaleString("en-US")} ${n === 1 ? "line" : "lines"} in this project, and the scan's corroboration step set ${n === 1 ? "it" : "them"} aside, so no place was raised for this rule and none is shown here; whether what it looks for is in this project was not established`,
  unknownRow: (ruleId: Inert, title: Inert, lookingFor: Inert, note: Inert) =>
    `- ${ruleId} — ${title}: ${lookingFor}${note ? ` (the investigator's word: ${note})` : ""}`,
  /** draft, from skill L184 ("say in one line why the check invalidated it"). */
  silenceInvalidated: (before: Inert, note: Inert) => `  - The investigator said ${before}; the quotation check could not confirm it — ${note}`,
  /** draft */
  notEvaluatedRow: (ruleId: Inert, title: Inert, why: Inert) => `- ${ruleId} — ${title}: switched off by ${why}`,
  /** draft: what `notEvaluatedRow` says when the scan named no unmet precondition. */
  notEvaluatedWhyUnnamed: "a declaration",
  /** draft */
  outOfJurisdictionRow: (ruleId: Inert, title: Inert, regions: Inert, premise: Inert) =>
    `- ${ruleId} — ${title}: the declared regions (${regions}) are outside this rule's reach${premise ? ` — ${premise}` : ""}`,
  /** draft */
  limitRow: (sentence: Inert, lift: Spanned | null) => `- ${sentence}${lift ? ` Re-scan with: \`${lift}\`` : ""}`,
  /** draft */
  fileNotReadRow: (file: Spanned, reason: Inert) => `- \`${file}\` — ${reason}`,
  /** draft: the details `fileNotReadRow` appends in brackets. */
  longestLine: (n: number) => `longest line ${n}`,
  stoppedForTime: (elapsedMs: number, budgetMs: number) => `stopped after ${elapsedMs} ms of a ${budgetMs} ms budget`,
  /** draft */
  linesNotReadRow: (file: Spanned, lines: Inert) => `- \`${file}\` — ${lines}`,
  /** draft: what `linesNotReadRow` lists, or says when it has no line to list. */
  lineNotRead: (line: number, length: number) => `line ${line} (${length} characters)`,
  timeBudgetStoppedRead: (detail: Inert) => `the time budget stopped the read (${detail})`,
  noLineRecorded: "no line recorded",
  /** draft: the fall-backs for a record that does not name what a sentence needs. */
  noReasonGiven: "the check invalidated it and gave no reason",
  ruleNotInFindings: "(rule not in findings.json)",
  noGroundNamed: "no ground named",
  unrecordedLocation: "an unrecorded location",
  /** draft */
  questionRow: (expr: Spanned, rules: Inert, status: Inert = ours("")) => `- \`${expr}\` — ${status ? `${status}; ` : ""}holds open: ${rules}`,
  /** draft: what became of the question, read from the run's `declaration-plan.json` (one computation). */
  questionStatus: {
    asked: "you were asked and did not answer",
    before: "you chose not to answer",
    later: (cmd: Spanned) => `not asked before this scan; your answer is used from the next scan (say "review my answers", or run \`${cmd}\`)`,
    none: "not asked: the plan found no answer to it changes this scan",
    noPlan: "no answer in your declaration",
    // The scan's plan was not taken: what it says of this question is not known.
    notTaken: (why: Inert) => `not known: the scan's declaration plan ${why}, so the report does not use it`,
  },
  /** draft, from skill L191. */
  answerContradicted: (expr: Spanned, rule: Inert, where: Inert) =>
    `- \`${expr}\` — CONTRADICTED: ${rule} raised a candidate on this subject at ${where}; the answer and the code disagree.`,
  /** draft, from skill L191 ("never worded as a clearance"). */
  answerNotContradicted: (expr: Spanned, rules: Inert) =>
    `- \`${expr}\` — ${rules} ran and raised nothing, so this pass did not contradict the answer.`,
  /** draft, from skill L191 (the sixth heading's content; names no resume command). */
  notAdjudicatedBody: (n: number, shape: Inert, chosenBy: Inert) =>
    `${n} candidate${n === 1 ? " was" : "s were"} not adjudicated in this run. The run shape was *${shape}* (${chosenBy === "user" ? "chosen by the person" : "the default, used without asking"}). ` +
    "They are finished by launching the adjudicator again over the payload files the evidence log's `unadjudicated[]` names, which are still on disk under the payload directory. " +
    "That is a later pass over files this session wrote, and it opens only after the person names this run's log and confirms that the working files are this run's. " +
    "None of them is dismissed, cleared or not applicable: nobody looked at them.",
  /** draft */
  shownWhenChosen: "When the shape was chosen, the preview showed:",
  /** draft */
  shownRow: (shape: Inert, launches: number, candidates: number, tokensLow: number, tokensHigh: number, seconds: number) =>
    `- *${shape}*: ${launches} launch${launches === 1 ? "" : "es"}, ${candidates} candidate${candidates === 1 ? "" : "s"}, ` +
    (Number.isFinite(tokensLow) && Number.isFinite(tokensHigh) ? `${tokenRangeWords(tokensLow, tokensHigh)}` : "tokens not recorded in this preview") +
    `, about ${Math.round(seconds / 60)} min`,
  /** draft */
  settlementRow: (fields: Inert) => `- A file found in the scanned tree: ${fields}`,
  /** skill L192 ("Say that in one sentence"), draft wording. */
  settlementSentence:
    "None of them settled anything in this run: every candidate they name was adjudicated, or is listed under *Candidates not adjudicated in this run*, exactly as it would have been without them.",
  /** draft, from skill L193 (a coverage sentence, never a total, score or grade). */
  coverage: (ran: number, withCandidates: number, silent: number, searched: number, notEvaluated: number) =>
    `${ran} rule${ran === 1 ? "" : "s"} ran in this scan; ${withCandidates} produced candidates; ${silent} produced none, and ${searched} of those were searched.` +
    (notEvaluated > 0 ? ` ${notEvaluated} more ${notEvaluated === 1 ? "was" : "were"} not evaluated.` : ""),
  /* ---------------------------------------------------------------------------------------------
   * THE REPORT'S FIVE FILES.
   * Every entry below is in plain words for the person, no internal word
   * (no "candidate", "seat", "adjudication", "clause", "layer") on the first screen or in the work list.
   * ------------------------------------------------------------------------------------------- */
  /** The title of each of the five files. */
  /* The report files of delivery design rf11 (3.1, 3.1.1, 5). */
  numberListUnreadable: (why: Inert) => `The F-number list for this folder on this computer could not be used (${why}), so the numbers were given as for a folder with no list.`,
  numberListRefused: (why: Inert) => `The F-number list for this folder was not read (${why}), so the numbers were given as for a folder with no list.`,
  numberListNotKept: (why: Inert) => `The F-numbers of this report were not kept for later runs (${why}), so a later run may number these findings differently.`,
  /** The report-files record (report-files.ts) refused. */
  /* Words */
  deeperNotRead: (why: Inert) => `WolfBoy could not read this computer's record of deeper checks (${why}), so each finding's file says "None." under "Deeper checks", even where a check is on record.`,
  renderInputNotKept: (why: Inert) => `WolfBoy could not keep what this report was made from (${why}), so a decision you record about a finding shows in the next scan's report, not in this one.`,
  reportFilesNotRecorded: (why: Inert) => `WolfBoy could not record which report files it wrote (${why}), so "explain", "fix" and "what was ruled out" cannot print this report; open its files in the editor.`,
  reviewOfDay: (day: Inert) => `the review of ${day}`,
  reviewEarlier: "the earlier review",
  // A finding of this scan named in changes.md that no list holds.
  laterRuledOut: "ruled out: [its verdict](ruled-out.md)",
  laterNoVerdict: "no verdict in this run",
  firstTitle: (project: Inert, day: Inert) => `# ${project} · compliance review${day ? ` · ${day}` : ""}`,
  firstNeeds: (n: number, toFix: number, lv: { high: number; medium: number; low: number }, clarify: number, answer: number, questions: number, decidedFix = 0, decidedClarify = 0) =>
    `**Needs your action: ${group(n)}**: ${group(toFix)} to fix (${group(lv.high)} high, ${group(lv.medium)} medium, ${group(lv.low)} low${decidedFix > 0 ? `; ${group(decidedFix)} decided by you` : ""}) · ${group(clarify)} to clarify${decidedClarify > 0 ? ` (${group(decidedClarify)} decided by you)` : ""} · ${group(answer)} to answer${answer > 0 ? `, which ${group(questions)} ${questions === 1 ? "question settles" : "questions settle"} ("review my answers")` : ""}`,
  firstTaken: (n: number, ruled: number, scope: number, notCounted: number, setAside = 0, scopeBy = "your answers") =>
    `**Taken off the list: ${group(n)}**: [${group(ruled)} ruled out](ruled-out.md) by one AI review each, which can miss a real problem${scope > 0 ? ` · ${group(scope)} out of scope by ${scopeBy}` : ""}${setAside > 0 ? ` · ${group(setAside)} set aside by the scanner, not reviewed` : ""}${notCounted > 0 ? ` · ${group(notCounted)} not counted` : ""}`,
  firstLaws: (parts: readonly Inert[], review: Inert) => `[Laws](laws.md): ${parts.join(" · ")} · ${review}`,

  /* The Not checked block of the first screen in mock M2's form (design 3.1 item 5). */
  notCheckedFirst: (places: number, partly: number) =>
    `Nothing here is known to be in order. Places without a verdict: **${group(places)}** · findings the AI read only in part: **${group(partly)}**`,
  rulesNothing: (n: number, ref: number | null) => `Rules that found nothing: ${group(n)}${n > 0 && ref !== null ? `, which is not a clean result: [each][${ref}]` : ""}`,
  rulesNothingHeading: "### Rules that found nothing",
  // The count the first screen links here, said where it links.
  rulesNothingLead: (n: number, listed: number) =>
    n === listed
      ? `${group(n)} ${n === 1 ? "rule" : "rules"} found nothing in this scan${n > 0 ? `; ${n === 1 ? "it is" : "each is"} below` : ""}. Finding nothing is not a clean result.`
      : `${group(n)} ${n === 1 ? "rule" : "rules"} found nothing in this scan; ${group(listed)} of them ${listed === 1 ? "was" : "were"} looked into, below. Finding nothing is not a clean result.`,
  notReadLine: (parts: readonly Inert[]) => `Not read: ${parts.length > 0 ? parts.join(" · ") : "0 files"}: [every file](not-checked.md)`,
  notReadMoreFolders: (n: number) => `and ${group(n)} more`,
  notReadPart: {
    "files-refused": (n: number) => `${group(n)} binary, large or not scanned`,
    "files-outside": (n: number) => `${group(n)} ${n === 1 ? "link" : "links"} outside the folder`,
    "files-not-read": (n: number) => `${group(n)} read to no rule`,
    "lines-not-read": (n: number) => `${group(n)} with lines not read`,
    "did-not-read": (n: number) => `${group(n)} coverage ${n === 1 ? "note" : "notes"}`,
  } as Record<string, (n: number) => string>,
  policyNotCompared: 'Privacy policy not compared: say "compare my privacy policy"',
  fixRest: (n: number) => `The other ${group(n)} to fix ${n === 1 ? "is" : "are"} [below, by area](#to-fix-by-area), in this order.`,
  clarifyHeading: "## To clarify",
  clarifyRest: (n: number) => `The other ${group(n)} to clarify ${n === 1 ? "is" : "are"} [below, by area](#to-fix-by-area).`,
  /* (design 3.2.1; mock M9) To clarify on a later run: the new or moved-in
   * points are listed, the rest counted as open since the earlier review. */
  clarifyLaterRest: (moreNew: number, open: number, listedAny: boolean, asOf: Inert) =>
    `- ${[moreNew > 0 ? `${group(moreNew)} more new: [changes.md](changes.md#new-or-higher)` : "", open > 0 ? `${group(open)} ${listedAny ? "more " : ""}open, ${asOf}: [all](#to-fix-by-area)` : ""].filter(Boolean).join(" · ")}`,
  openPoint: (text: Inert) => `open: ${text}`,
  legendVsCode: "VS Code: Ctrl+Shift+V to format (Mac: Cmd+Shift+V) · Ctrl+click a link",
  legendWorst: "⚑ placed as if the worst case held",
  identityHeading: "About this report",
  identityCommit: (commit: Inert) => `Commit ${commit}.`,
  identityNumbers: (note: { kind: "taken"; label: Inert } | { kind: "start"; from: number } | { kind: "differs"; label: Inert; count: number } | null) =>
    note === null
      ? "F-numbers are this folder's, on this computer; in commits and tickets, quote the 6-character id."
      : note.kind === "taken"
        ? `F-numbers taken from ${note.label}: this computer had no list for this folder. In commits and tickets, quote the 6-character id.`
        : note.kind === "start"
          ? `F-numbers start at F${note.from}: this computer had no list for this folder; the 6-character ids are unchanged.`
          : `F-numbers follow this computer's list; ${note.label} numbered ${note.count} ${note.count === 1 ? "finding" : "findings"} differently. In commits and tickets, quote the 6-character id.`,
  cardWaits: (question: Inert) => `Waits on your answer: ${question}`,
  cardNotOpened: (n: number) => `${group(n)} ${n === 1 ? "place" : "places"} the AI did not open`,
  cardRegionsUnanswered: "regions not answered",
  cardYourAnswers: "your answers",
  cardNotAnswered: "not answered",
  cardReasonBelow: "The review's reasoning is below.",
  cardGuidanceBelow: "The rule's guidance is below.",
  cardDisposition: {
    to_fix: "To fix",
    counsel: "To clarify",
    question: "To answer",
    check_answer: "To answer",
    recorded: "Not counted: met or exempt",
    not_shipped: "Not counted: not shipped",
    for_operators: "Not counted: for operators",
    folded: "Not counted: same as another",
  } as Record<string, string>,
  cardReviewOf: (day: Inert) => `review of ${day}`,
  cardBack: "report",
  cardCounsel: "Review by qualified counsel recommended.",
  cardPlace: "Place",
  cardOwnLine: (link: Inert) => `(the line the raise rests on; the finding's own line is ${link})`,
  cardProvision: "Provision",
  cardNoProvision: "none in the regions you answered",
  cardMoreBelow: (n: number, after: boolean) => (after ? `and ${n} more` : `${n} ${n === 1 ? "provision" : "provisions"}, listed below`),
  cardReason: "Reason",
  cardWhatToDo: "What to do",
  cardSettles: "What settles it",
  cardSettlesLaw: "That is a point of law, not something the code shows; record it once counsel has settled it.",
  cardSettlesCode: (file: Inert) => `the review could not read ${file}, a file in this repository; record what it holds, or run the scan again with it readable.`,
  cardSettlesNone: "the review named nothing; its reasoning is below.",
  cardAnswerSettles: 'your answer about the product; say "review my answers".',
  cardNotCounted: "Why it is not counted",
  cardSay: (f: Inert, kind: Inert) =>
    kind === "to_fix"
      ? `Say: "fix ${f}" · "decide ${f}: …" · "look deeper at ${f}"`
      : kind === "counsel"
        ? `Say: "decide ${f}: counsel says …" · "look deeper at ${f}"`
        : kind === "answer"
          ? `Say: "review my answers" · "explain ${f}"`
          : `Say: "explain ${f}"`,
  /* A group's list names its findings, not its places: a place is one
   * location, a file and a line. Each entry names its own place count, a place two findings share
   * counted at the first entry that holds it, so the entries add up to the title's "(N places)". `placesOfGroupEntry`
   * reads an entry's count back (explain.ts); a change to one of the two is a change to both. */
  groupListHeading: "Findings in this group",
  groupEntryPlaces: (n: number, earlier: number): string =>
    n === 0
      ? `${earlier === 1 ? "its place is" : `its ${earlier} places are`} counted above`
      : `${n} ${n === 1 ? "place" : "places"}${earlier > 0 ? `, and ${earlier} counted above` : ""}`,
  /* A group's section for one of its findings (a finding can hold
   * many places; a place is one location): the heading under "The review's reasoning", whose anchor the group's list,
   * `detailLink` and `explain` link to, and, with a colon, the label in the file's other sections. The one wording. */
  groupMemberHeading: (short: Inert) => `Finding ${short}`,
  /* (mocks M3a, M7) A provision's link and the day it was checked
   * against its source, after its citation; and the counted lists of "How it was read". `explain` reads these back
   * (`explain.ts`), so a change to one is a change to its reader. */
  provisionSource: (url: Inert, checked: Inert): string =>
    `${url ? `: ${provisionLink(url)}` : ""}${checked ? `${url ? " ·" : ":"} ${PROVISION_CHECKED_WORD} ${checked}` : ""}`,
  filesRead: (n: number): string => `Files read (${n})`,
  searchesRun: (n: number): string => `Searches run (${n})`,
  sectionNone: "None.",
  reasoningHeading: "The review's reasoning, in full",
  evidenceHeading: "Evidence",
  readHeading: "How it was read",
  provisionsHeading: "Provisions",
  provisionsNoText: "The citations and their links only: WolfBoy ships no text of the law.",
  guidanceHeading: "What the rule says to do, in full",
  decisionsHeading: "Your decisions",
  decisionsNone: "None recorded in this folder on this computer.",
  /* The person's decisions (design rf11 3.4). */
  decisionsUnreadable: (why: Inert) => `Your decisions for this folder could not be read (${why}): none applied.`,
  decidedHeading: "## Decided by you",
  decidedNone: "No decisions recorded for this folder on this computer.",
  decidedNoneApply: "None of your decisions applies to a finding of this review.",
  decidedGone: (n: number) => `${group(n)} of your ${n === 1 ? "decisions is" : "decisions are"} on findings this review did not raise (for example, the code at the place changed).`,
  deeperHeading: "Deeper checks",
  deeperNone: (f: Inert) => `None. Say "look deeper at ${f}" for since when, whether it happens, and the live site.`,
  aboutHeading: "About this finding",
  alsoShownAs: (fs: readonly Inert[]) => `Also shown as ${fs.join(", ")} in earlier reviews of this folder.`,
  shownInCarried: (f: Inert, label: Inert) => `Shown as ${f} in ${label}.`,
  aboutLine: (id: Inert, rule: Inert, scan: Inert) => `Finding ${id} · rule ${rule}${scan ? ` · scan ${scan}` : ""}`,
  /** `looked`: the high ones due a second look (a run with the second check). */
  /** `high`: the high ones of the kind a run with the second check looks at, looked at or not. */
  ruledOutTitle: (n: number, looked = 0, high = looked) =>
    `# Ruled out · ${group(n)} ${n === 1 ? "verdict" : "verdicts"}, one review each${looked > 0 ? `, and a second look at ${looked >= high ? `the ${looked === 1 ? "high one" : `${group(looked)} high ones`}` : `${group(looked)} of the ${group(high)} high ${high === 1 ? "one" : "ones"}`}` : ""}`,
  /** Said as a condition, not as an admission that a problem is missed. */
  ruledOutIntro: "Nothing re-checks a ruled-out verdict: if one is a real problem, this review will not catch it. Each rule's file lists its verdicts.",
  /** The same, for a run with the second check, where each high one was due a second look. */
  ruledOutIntroLooked:
    "This run's shape has the second check, so each high ruled-out verdict was due a second look, which tries to show the rule applies after all; its answer is beside the verdict. Nothing re-checks the others: if one of them is a real problem, this review will not catch it. Each rule's file lists its verdicts.",
  /**
   * The same, computed from the rows: `fresh`, the
   * high ones judged in this run (each due a look); `carriedLooked`, carried ones whose own run gave a look; `carriedNone`,
   * carried high ones with none. Said only where a row is not what the shape alone would say.
   */
  ruledOutIntroRows: (secondCheck: boolean, fresh: number, carriedLooked: number, carriedNone: number): string => {
    const one = (n: number, a: string, b: string): string => (n === 1 ? a : b);
    const parts: string[] = [];
    if (secondCheck && fresh > 0) parts.push("This run's shape has the second check, so each high ruled-out verdict judged in this run was due a second look, which tries to show the rule applies after all; its answer is beside the verdict.");
    else if (secondCheck) parts.push("This run's shape has the second check, and gives a second look to each high ruled-out verdict it judges.");
    else parts.push("This run's shape has no second check.");
    if (carriedLooked > 0) parts.push(`${group(carriedLooked)} high ruled-out ${one(carriedLooked, "verdict was", "verdicts were")} carried from an earlier run that gave ${one(carriedLooked, "it", "them")} a second look; ${one(carriedLooked, "its", "their")} answer is beside the verdict.`);
    if (carriedNone > 0)
      parts.push(`${group(carriedNone)} high ruled-out ${one(carriedNone, "verdict", "verdicts")} carried from an earlier run had no second look. To have ${one(carriedNone, "it", "them")} looked at, run the scan again with the second check and, when it asks for your earlier run, do not name one.`);
    parts.push("Nothing re-checks the others: if one of them is a real problem, this review will not catch it. Each rule's file lists its verdicts.");
    return parts.join(" ");
  },
  /** After the line naming the report's path. */
  /** A gone finding with no F-number, as the "where" of a new one names it. */
  goneFindingWords: "a gone finding of this rule",
  /** The end screen's path line, after the path: one clause,
   * so the screen keeps design 6's budget (the block's lines and columns are unchanged; the path line is never cut). */
  reportPathEnd: "(VS Code's Quick Open skips .legal/: open the report by this path)",
  reportFindHint: "  VS Code's Quick Open and search skip .legal/ (its ignore files hide it from them): open the report by the path above (in VS Code: File > Open File); `wolfboy report` prints the path again.",
  /** In place of the end screen, where CI is set. */
  endScreenInCi:
    "  The report's summary is not printed here: this runs in CI, where the output is a job's log that anyone who can read the repository may read. The findings are in the report named above and the files beside it.",
  ruledOutRuleTitle: (plain: Inert, n: number) => `${plain} · ruled out ${group(n)} ${n === 1 ? "time" : "times"}`,
  ruledOutIndex: "all ruled out",
  outOfScopeHeading: "## Out of scope by your answers",
  /** laws.md's provisions limited to a region answered No. */
  regionLimitedHeading: "## Not applying on your answers",
  reportTitle: (project: Inert) => `# Scan report: ${project}`,
  detailsTitle: (project: Inert) => `# Every finding, with its evidence: ${project}`,
  notCheckedTitle: (project: Inert) => `# Not checked: ${project}`,
  notApplicableTitle: (project: Inert) => `# Not applicable: ${project}`,
  lawsTitle: (project: Inert) => `# Laws: ${project}`,
  /** Under the title of every file but the first. It names the main file as written,
   * `report.md`, or the name `--out-report <path>.md` gave it. */
  backToReport: (main: Inert) => `[Back to the report](${main})`,
  /** The first screen's second line. It ends with the scan's id, as the old title did. */
  scanned: (parts: readonly Inert[]) => `Scanned ${parts.join(" · ")}`,
  scannedFiles: (n: number) => `${n.toLocaleString("en")} files read`,
  scannedRules: (n: number) => `${n} rules`,
  scannedId: (id: Spanned) => `scan \`${id}\``,
  /** The first screen's count of what stands. */
  topFix: (high: number, medium: number, low: number, counsel: number) =>
    `**${high} ${high === 1 ? "finding" : "findings"} to fix first**, then ${medium} medium and ${low} low.${counsel > 0 ? ` ${counsel} more need your judgement.` : ""}`,
  /** The not-checked count, always on the first screen, a zero said and never left out. */
  topUnchecked: (n: number, places: number, high: number, inside: number, also: readonly ScreenLine[]) =>
    /* A zero is said, and nothing is said to be undecided where nothing is. The
     * line is worded from the one list (`uncheckedKinds`): `also` is every line of the Not checked block below, other
     * than its first, that holds a kind with a count. The bare zero is said only where the block lists nothing else; a
     * zero beside rules or files not checked says so inside its bold part. */
    n === 0 && inside === 0 && also.length === 0
      ? "**Not checked: 0 possible problems have no answer**."
      : `**Not checked: ${n} possible ${n === 1 ? "problem has" : "problems have"} no answer${n === 0 ? WORDS.topUncheckedBut : ""}**${n > 0 ? ` (${places.toLocaleString("en")} ${places === 1 ? "place" : "places"})` : ""}${high > 0 ? `, ${high} of them high` : ""}${
          inside > 0 ? `; ${inside.toLocaleString("en")} more ${inside === 1 ? "place" : "places"} inside answered findings ${inside === 1 ? "was" : "were"} not opened` : ""
        }${also.length > 0 ? `; ${listWords(also.map((l) => WORDS.topUncheckedAlso[l]))} ${n > 0 || inside > 0 ? "are also" : "are"} listed below as not checked` : ""}. Nothing is decided about them; they may hold problems.`,
  /** What the zero count adds, in bold, where the Not checked block lists anything else. */
  topUncheckedBut: ", but not everything was checked",
  /** Each further line of the Not checked block, as the count line names it. */
  topUncheckedAlso: { noAnswer: "", answers: "answers not fully read", rules: "rules", notRead: "what was not read", also: "other items" } as Record<ScreenLine, string>,
  /** A run whose shape has no second check, said as a fact of the shape. */
  topNoSecondCheck: "No second check ran: the way you chose to run this scan does not include one, so each finding stands as the first review judged it.",
  fixHeading: "## Fix first",
  fixNone: "- No finding of high weight stands in this scan.",
  /** Every finding to fix stands and is decided by you (design 3.4): never "none stands". */
  fixAllDecided: "- Each finding to fix is decided by you, and still counted: [Decided by you](#decided-by-you).",
  // (mock M9): a later run's report, what changed since the earlier review.
  sinceHeading: "## Since your last review",
  sinceLead: (earlier: Inert) => `Compared with ${earlier}; the causes: [changes.md](changes.md).`,
  /** `back` unchanged, back for a new look. */
  sinceUp: (n: number, listed: boolean, back = 0) =>
    `- **New or higher: ${group(n)}**${back > 0 ? ` (${back === n ? (n === 1 ? "it is" : "each is") : `${group(back)} of them ${back === 1 ? "is" : "are"}`} unchanged, back for a new look at your decision)` : ""}${n === 0 ? "." : listed ? ", listed below." : ", in [changes.md](changes.md#new-or-higher)."}`,
  sinceDown: (n: number, parts: Inert, high: Inert) => `- **Lower or gone: ${group(n)}**${parts ? `: ${parts}` : "."}${high ? `; ${high}` : ""}`,
  sinceSame: (n: number) => `- **Unchanged: ${group(n)}**, the same list, level and places.`,
  sinceNotCompared: (earlier: Inert, why: Inert) => `Not compared with ${earlier}: ${why}. Nothing is counted as new, lower or gone: [changes.md](changes.md).`,
  nowHeading: "## Now to fix",
  nowNone: "- Nothing new or higher to fix this run.",
  /** Every new or higher finding to fix is decided by you (design 3.4). */
  nowAllDecided: "- Each finding to fix that is new or higher is decided by you: [Decided by you](#decided-by-you).",
  nowRest: (n: number) => `And ${group(n)} more new or higher: [changes.md](changes.md#new-or-higher).`,
  /** Every finding still to fix from earlier reviews is decided by you. */
  stillAllDecided: (n: number, high: number) => `**Still to fix from earlier reviews: ${group(n)}** (${group(high)} high), each decided by you: [Decided by you](#decided-by-you) · [all, in fix order](#to-fix-by-area)`,
  stillToFix: (n: number, high: number, first: Inert) => `**Still to fix from earlier reviews: ${group(n)}** (${group(high)} high); first: ${first} · [all, in fix order](#to-fix-by-area)`,
  fixMore: (n: number) => `- ${n} more high ${n === 1 ? "finding is" : "findings are"} under [Findings by area](#findings-by-area).`,
  thenLevel: (n: number, level: Inert, areas: number) => `**${n} ${level}** in ${areas} ${areas === 1 ? "area" : "areas"}`,
  then: (levels: readonly Inert[], counsel: number) =>
    `After that: ${levels.length > 0 ? listWords(levels) : "nothing of medium or low weight"}, listed [by area](#findings-by-area) below.${counsel > 0 ? ` **${counsel} need your judgement**: the review left ${counsel === 1 ? "it" : "them"} to a person, and says why beside each.` : ""}`,
  uncheckedHeading: "## Not checked",
  /** (design 3.1 item 5, as mock M9 shows it): on a run that carries verdicts,
   * the first screen's Not checked item for them; the carry line itself opens not-checked.md. */
  // Dated by the earlier review, and its log's mark where it is not the one WolfBoy wrote.
  carriedItem: (n: number, from: Inert, mark: Inert) => `Verdicts carried: **${group(n)}**, from [${from}](not-checked.md)${mark ? ` (its log ${mark})` : ""}; not re-read in this one`,
  /** The earlier log's digest mark (log-digest.ts), as the carried line says it; "" where the log is the one WolfBoy wrote. */
  carriedMark: { matches: "", changed: "changed since WolfBoy wrote it", none: "has no digest on this computer", unread: "could not be checked on this computer" } as Readonly<Record<string, string>>,
  /** Every other line of the block, its lead by line (`noAnswer` is the line above). */
  uncheckedLead: { noAnswer: "", answers: "", rules: "", notRead: "Not read: ", also: "Also not checked: " } as Record<ScreenLine, string>,
  uncheckedLine: (lead: Inert, kinds: readonly Inert[]) => `- ${lead}${kinds.join("; ")}.`,
  /** One phrase per kind of item `not-checked.md` holds, its count first and in bold. */
  uncheckedKind: {
    "no-ledger": () => "**no receipt** shows that each answer is the one its review returned",
    unconfirmed: (n: number) => `**${n} ${n === 1 ? "set" : "sets"} of places** set aside on a quotation that could not be confirmed (not cleared)`,
    "no-usable-answer": (n: number) => `**${n}** whose review's answer could not be used`,
    "not-reviewed": (n: number) => `**${n}** not reviewed in this run (the way you chose to run it)`,
    partly: (n: number) => `**${n} "not applicable" ${n === 1 ? "answer holds" : "answers hold"} only for the places that were read**`,
    gap: (n: number) => `**${n} ${n === 1 ? "rule" : "rules"}** found what ${n === 1 ? "it looks" : "they look"} for where the scan raised nothing (not judged)`,
    absent: (n: number) => `**${n} ${n === 1 ? "rule was" : "rules were"}** searched and ${n === 1 ? "looks" : "look"} absent (not proven)`,
    "not-checked-rules": (n: number) => `**${n} ${n === 1 ? "rule" : "rules"}** found nothing and nobody checked that`,
    "not-evaluated": (n: number) => `**${n} ${n === 1 ? "rule was" : "rules were"}** not evaluated (switched off)`,
    "by-declaration": (n: number) => `**${n} ${n === 1 ? "rule was" : "rules were"}** set aside by the regions you declared`,
    "did-not-read": (n: number) => `**${n} coverage ${n === 1 ? "note" : "notes"}** on what this scan read past`,
    "files-not-read": (n: number) => `**${n.toLocaleString("en")} ${n === 1 ? "file" : "files"}** opened and read to no rule`,
    "lines-not-read": (n: number) => `**${n.toLocaleString("en")} ${n === 1 ? "file" : "files"}** with lines not read`,
    "files-refused": (n: number) => `**${n.toLocaleString("en")} ${n === 1 ? "file" : "files"}** not opened: binary, too large or of a type not scanned`,
    // A link the scanned folder holds to a file outside it, never read.
    "files-outside": (n: number) => `**${n.toLocaleString("en")} symbolic ${n === 1 ? "link" : "links"}** to a file outside the scanned folder, not read`,
    "overturned-unquoted": (n: number) => `**${n} "not applicable" ${n === 1 ? "answer" : "answers"}** from a second review that quoted nothing (nothing about ${n === 1 ? "it" : "them"} was checked)`,
    "not-refuted": (n: number) => `**${n} ${n === 1 ? "finding stands" : "findings stand"}** with no usable second review`,
    "places-not-opened": (n: number) => `**${n} answered ${n === 1 ? "finding has" : "findings have"} places nobody opened**`,
    questions: (n: number) => `**${n} ${n === 1 ? "question" : "questions"}** about the product still open`,
    "answers-not-taken": (n: number) => `**${n} ${n === 1 ? "answer" : "answers"}** of yours not taken at face value`,
    suppressed: (n: number) => `**${n}** the scanner suppressed, not reviewed`,
    settlement: (n: number) => `**${n} ${n === 1 ? "file" : "files"}** in the project claiming earlier answers, not followed`,
  } as Record<UncheckedKey, (n: number) => string>,
  /** What the first screen adds after a kind's phrase. */
  uncheckedPartlyPlaces: (places: number) => ` (${places.toLocaleString("en")} ${places === 1 ? "place" : "places"} not read)`,
  uncheckedOpenedPlaces: (places: number, answers: number) =>
    `: ${places.toLocaleString("en")} ${places === 1 ? "place" : "places"}${answers > 0 ? ` (${answers} of these ${answers === 1 ? "is a" : "are"} "not applicable" ${answers === 1 ? "answer" : "answers"} just named)` : ""}`,
  uncheckedNotes: (parts: readonly Inert[]) => (parts.length > 0 ? `: ${parts.join(", ")}` : ""),
  /** The files the per-file time budget stopped, among a kind's. */
  uncheckedForTime: (n: number) => ` (${n} stopped by the per-file time budget)`,
  /** The files the scan's walker did not open as code, named by folder with its examples
   * (findings.json `excluded_by_walker[]`, the reasons `coverage_limits` counts as `refused_by_the_walker`). */
  filesRefusedHeading: "### *Files not opened: binary, too large, a type not scanned, or not a regular file*",
  /** The links to a file outside the scanned folder (`link-to-outside`), each named; none was read. */
  filesOutsideHeading: "### *Symbolic links to a file outside the scanned folder: not read*",
  filesRefusedRow: (dir: Spanned, files: number, why: Inert, examples: readonly Spanned[]) =>
    `- \`${dir || "."}\` — ${files.toLocaleString("en")} ${files === 1 ? "file" : "files"}, ${why}${
      examples.length > 0 ? `: ${examples.map((e) => `\`${e}\``).join(", ")}${files > examples.length ? ` and ${(files - examples.length).toLocaleString("en")} more` : ""}` : ""
    }`,
  filesRefusedWhy: {
    "size-limit": "over the scan's size ceiling",
    "binary-extension": "binary by their extension",
    "binary-content": "binary by their content",
    "extension-not-scanned": "of a type this scan does not read",
    // What stood at the path was not a regular file, or could not be opened; every one is named.
    "named-pipe": "named pipes, never opened (opening one can wait for ever)",
    socket: "sockets, never opened",
    device: "devices, never opened",
    "link-to-folder": "symbolic links to a folder, not followed",
    "link-to-nothing": "symbolic links that lead nowhere",
    "link-to-outside": "symbolic links to a file outside the scanned folder, not read",
    "could-not-open": "that could not be opened",
    // The walker's own bounds.
    "link-not-followed": "symbolic links not followed, because resolving them would pass the work the scan allows for links",
    "name-not-utf8": "entries whose names are not valid UTF-8, never opened",
    "link-path-too-long": "symbolic links not followed, because a path on the way to what they name is longer than the system takes",
    // The pointer is not the file: its content was never checked out.
    "git-lfs-pointer": "Git LFS pointers, whose content was never checked out (git lfs pull fetches it)",
  } as Record<string, string>,
  notReadScope: { "read-scope:tests": "test files", "read-scope:vendored": "vendored files", "read-scope:build": "build output files" } as Record<string, string>,
  notReadScopeLift: (lift: Spanned) => ` (\`${lift}\` reads them)`,
  /** "+" where a folder's files were not counted (`directories_not_enumerated`), as the
   * coverage note in not-checked.md says it: a count the scan did not finish is never printed as exact. */
  notReadMachine: (n: number, notCounted: number) =>
    n > 0 || notCounted === 0
      ? `${n.toLocaleString("en")}${notCounted > 0 ? "+" : ""} files in machine-written folders (node_modules, .git and the like)`
      : `${notCounted.toLocaleString("en")} machine-written ${notCounted === 1 ? "folder" : "folders"} (node_modules, .git and the like) whose files were not counted`,
  notReadBinary: (n: number) => `${n.toLocaleString("en")} binary or very large files`,
  notReadNoRule: (n: number) => `${n.toLocaleString("en")} files opened and read to no rule`,
  notReadLines: (n: number, file: Spanned | null) => `${n} over-long ${n === 1 ? "line" : "lines"}${file ? ` in \`${file}\`` : ""}`,
  lawLine: (law: Inert, verdict: Inert, open: number) => `${law} ${verdict}${open > 0 ? ` (${open} ${open === 1 ? "question" : "questions"} about the product open)` : ""}`,
  lawsNone: "no law's reach was assessed",
  /** (design 3.3 Whose answers, on every screen; mock M17): whose answers
   * about the product the scan used, from its log's `answers_used`; short on the laws line, long in laws.md. */
  whoseShort: {
    own: (day: Inert) => `your answers${day ? `, ${day}` : ""}`,
    team: (day: Inert) => `team's answers${day ? ` of ${day}` : ""}, confirmed by you`,
    file: (file: Inert) => `answers read from ${file}`,
    none: `every region's rules ran - saved answers not used (say "review my answers")`,
  },
  /* (design 3.3, the "Out of scope" row): who answered the questions that
   * put places out of scope, where the scan used the team's saved answers. */
  scopeByTeam: "the team's answers, confirmed by you",
  scopeByTeamEnd: "by the team's answers, confirmed by you",
  whoseLong: {
    own: (day: Inert) => `Answers about the product this scan used: your answers${day ? ` of ${day}` : ""}.`,
    team: (day: Inert, commit: Inert, confirmed: Inert) =>
      `Answers about the product this scan used: the team's answers${day ? ` of ${day}` : ""}, saved in the repository${commit ? ` (${commit})` : ""}, confirmed by you${confirmed ? ` on ${confirmed}` : ""}.`,
    file: (file: Inert) => `Answers about the product this scan used: the file ${file}, read as given.`,
    none: `Answers about the product this scan used: none; every region's rules ran, and saved answers were not used (say "review my answers").`,
  },
  lawsRegions: "the regions you distribute to were not answered, so no rule was ruled out on jurisdiction",
  laws: (lines: readonly Inert[], notAssessed: number) =>
    `**Laws**: ${lines.join("; ")}${notAssessed > 0 ? `; ${notAssessed} other ${notAssessed === 1 ? "checklist" : "checklists"} not assessed` : ""}. See [laws.md](laws.md).`,
  otherFiles: (nNa: number) =>
    `Other files: [details.md](details.md) (every finding with its evidence) · [not-checked.md](not-checked.md) · [not-applicable.md](not-applicable.md) (${nNa} ${nNa === 1 ? "answer" : "answers"}, each with its reason) · [laws.md](laws.md)`,
  byAreaHeading: "## To fix by area",
  byAreaIntro: "Each line is one kind of problem, with where it is. Open a place for its evidence, what the review said and what to do.",
  byAreaNone: "No finding stands, and nothing is listed as not checked by area. What was not read is under Not checked above.",
  /** The findings that stand are all decided by you (design 3.4). */
  byAreaAllDecided: "Each finding that stands is decided by you, and still counted: [Decided by you](#decided-by-you). Nothing is listed as not checked by area; what was not read is under Not checked above.",
  areaHead: (area: Inert, counts: Inert) => `### ${area} (${counts})`,
  ruleLine: (level: Inert, plain: Inert, n: number, where: Inert) => `- **${level}** · ${plain}${n > 1 ? ` (${n})` : ""}: ${where}`,
  counselMark: "needs your judgement",
  /** A Fix-first group says how many of its findings need judgement. */
  counselOf: (k: number, n: number) => (n === 1 ? "needs your judgement" : `${k} of ${n} ${k === 1 ? "needs" : "need"} your judgement`),
  areaNoAnswer: (plain: Inert, n: number, places: number, high: boolean, anchor: Inert) =>
    `- **not checked**${high ? " · high" : ""} · ${plain}: ${n} possible ${n === 1 ? "problem" : "problems"}, ${places} ${places === 1 ? "place" : "places"}, no answer: [not-checked.md](not-checked.md)`,
  /** The work list's line for "not applicable" answers of a second review that quoted nothing. */
  areaOverturnedUnquoted: (plain: Inert, n: number, anchor: Inert) =>
    `- **not checked** · ${plain}: ${n} "not applicable" ${n === 1 ? "answer" : "answers"} from a second review that quoted nothing: [not-checked.md](not-checked.md)`,
  areaPartly: (plain: Inert, n: number, anchor: Inert) =>
    `- **not checked** · ${plain}: ${n} "not applicable" ${n === 1 ? "answer rests" : "answers rest"} on places not read: [not-checked.md](not-checked.md)`,
  andMore: (n: number) => `and ${n} more`,
  morePlaces: (n: number) => `+${n} more ${n === 1 ? "place" : "places"}`,
  peoples: (words: Inert) => `people's ${words}`,
  goesTo: (data: Inert, to: Inert) => `${data} go to ${to}`,
  /** Where no kind of data is established, no placeholder "data". */
  goesToUnnamed: (to: Inert) => `what it sends goes to ${to}`,
  /** Beside a Fix-first link that shows the line a raise rests on. */
  raiseLineIs: (own: Spanned) => ` (the line the raise rests on; the finding's own line is \`${own}\`)`,
  /** A place row's reason, the review's words said as the review's. */
  reviewSaidOfPlace: (text: Inert) => `the review said of this place: ${text}`,
  /** What the data travel over and who can read them there, in the words of the rule whose
   * place establishes the transport (severity-at-place.ts `TRANSPORT_WITHOUT_PROTECTION`, the form the place's own
   * clause or scheme tells) - never one sentence for every transport. */
  transport: (over: Inert, reads: Inert) => ` over ${over}, which ${reads}`,
  involves: (data: Inert) => `involves ${data}`,
  credentialWhere: (names: Inert) => `${names}; open the file at that line to see the value (it is not printed)`,
  aCredential: "a credential",
  raisedFrom: (from: Inert) => ` Raised from ${from}: what reaches this place makes it high.`,
  /** A finding raised because another finding of the same sending, at the same line, is high. */
  raisedByFlow: (from: Inert, other: Inert) => ` Raised from ${from}: the same sending, at this line, is high under "${other}".`,
  /* Words W1-W21 (W20 not built: D7). */
  /* Words NV1-NV14 of the NV design.
   * Those marked "WP3" are not in the design's list: each says a count or a
   * placement the design requires the report to show and gave no sentence for. */
  /** NV1: the headline; only what is to fix is counted, at every level. What needs judgement beside it is W1's clause. */
  topFixNV: (n: number, medium: number, low: number, counsel: number) =>
    `**${n} ${n === 1 ? "finding" : "findings"} to fix first**${n > 0 ? ", heaviest first by the law that applies and by what happens to the people whose data it is" : ""}. Then ${medium} medium and ${low} low to fix.${counsel > 0 ? ` ${counsel} more need your judgement.` : ""}`,
  /**
   * NV2: the "Also" line, right below the headline; each clause only where its count is not 0, each linked to its
   * section. The clause for the organisations that run it is WP3 (design section 2.5 item 2: the first screen names
   * each count).
   */
  alsoNV: (q: number, k: number, r: number, sh: number, a: number, o: number): string => {
    const parts = [
      q > 0 ? `[${q} ${q === 1 ? "finding waits" : "findings wait"} on ${k} ${k === 1 ? "question" : "questions"} for you](#to-answer)` : "",
      r > 0 ? `[${r} ${r === 1 ? "records" : "record"} processing that already meets its duty or is exempt](#recorded-duty-met-exempt-or-a-record-of-processing)` : "",
      sh > 0 ? `[${sh} ${sh === 1 ? "is" : "are"} in files that are not part of the shipped product](#not-part-of-the-shipped-product)` : "",
      o > 0 ? `[${o} ${o === 1 ? "depends" : "depend"} on each organisation that runs it](#for-each-organisation-that-runs-it)` : "",
      a > 0 ? `${a} ${a === 1 ? "was" : "were"} set aside because of your answers ([change an answer](#set-aside-on-your-answers))` : "",
    ].filter(Boolean);
    return parts.length > 0 ? `Not counted as problems: ${parts.join(" · ")}.` : "";
  },
  /** NV3: a question slot (`lead` is "3." in Fix first and "-" in laws.md's Questions open). */
  questionSlotNV: (lead: Inert, question: Inert, k: number, levels: Inert, rules: Inert) =>
    `${lead} **Question for you**: ${question} Your answer decides ${k} ${k === 1 ? "finding" : "findings"} (${levels}; ${rules}). Until you answer, ${k === 1 ? "it is" : "they are"} not counted as ${k === 1 ? "a problem" : "problems"} and not cleared either.`,
  /** NV4: a fact a seat named in words that no question of the program carries. */
  factSlotNV: (lead: Inert, fact: Inert, cite: Inert, k: number, rule: Inert) =>
    `${lead} **To check with the organisation that runs it**: ${fact} (${cite}). This decides ${k} ${k === 1 ? "finding" : "findings"} of "${rule}". The scan has no question for this yet, so it lists it again on every scan.`,
  /** NV12: an answer of the person's the review found the code disagrees with. */
  checkAnswerNV: (lead: Inert, header: Inert, answer: Inert, at: Spanned, k: number, rule: Inert) =>
    `${lead} **Check your answer**: you answered "${header}: ${answer}", but the review found \`${at}\`. Which is right decides ${k} ${k === 1 ? "finding" : "findings"} of "${rule}".`,
  /** The levels of a slot's findings, high first ("2 high, 1 medium"). */
  levelsWords: (l: { high: number; medium: number; low: number }) =>
    (["high", "medium", "low"] as const)
      .filter((k) => l[k] > 0)
      .map((k) => `${l[k]} ${k}`)
      .join(", "),
  /* NV5, NV6 and the answer's row are worded without
   * the phrase the report never uses (the skill's ban, SKILL.md "The ban on conclusions of safety"): each names what was
   * recorded and on which line, never that nothing is left. */
  /** NV5. */
  dutyMetNV: (at: Spanned, element: Inert) => `Recorded: the review found the duty met at \`${at}\` (${element}).`,
  /** NV6. */
  exemptNV: (cite: Inert, limb: Inert, at: Spanned) => `Recorded: the review found this covered by ${cite} (${limb}), as \`${at}\` shows.`,
  /** NV7. */
  inventoryNV: "Recorded for your record of processing: this rule lists where the product keeps or sends personal data. It is a problem only where the review names a duty at risk.",
  /** WP3: recorded because the person's own answer settles it (design row 8, `settles_as: met`). */
  answeredMetNV: (header: Inert, answer: Inert) => `Recorded: your answer "${header}: ${answer}" settles it.`,
  /** NV8, by reason. */
  notShippedNV: {
    ci: (at: Spanned) => `Not part of the shipped product: a CI service runs it (\`${at}\`).`,
    development: (at: Spanned) => `Not part of the shipped product: it is used only to develop or build the product (\`${at}\`).`,
    outside: (at: Spanned) => `Not part of the shipped product: nothing the repository builds, none of its images or packages, includes it (\`${at}\`).`,
    test: (at: Spanned) => `Not part of the shipped product: it runs only in tests (\`${at}\`).`,
    documentation: (at: Spanned) => `Not part of the shipped product: it is documentation that describes the product (\`${at}\`).`,
  } as Record<string, (at: Spanned) => string>,
  /** NV9. */
  shipsAfterAllNV: (at: Spanned) => `The repository's build files suggest this file is not shipped, but the review found it is: \`${at}\`.`,
  /** NV10: one entry of "Set aside on your answers" (`on` is " on {date}" where the record has a date). */
  setAsideNV: (header: Inert, answer: Inert, on: Inert, rules: readonly Inert[], p: number, f: number, command: Spanned, covers: Inert = ours(""), excluded: readonly Inert[] = []) =>
    `You answered "${header}: ${answer}"${on}. Because of that answer, ${listWords(rules)} ${rules.length === 1 ? "was" : "were"} not reviewed.${WORDS.coversNV(covers, excluded)} The scanner still found ${p} ${p === 1 ? "place" : "places"} in ${f} ${f === 1 ? "file" : "files"}; they are listed in [laws.md](laws.md), under the answers that settled them. If the answer is wrong or changes, run \`${command}\` and scan again.`,
  /** NV11: a not-applicable.md row of a rule settled by an answer. */
  byAnswerNV: (header: Inert, answer: Inert, date: Inert, p: number, covers: Inert = ours(""), excluded: readonly Inert[] = []) =>
    `Not applicable by your answer "${header}: ${answer}"${date ? ` (${date})` : ""}.${WORDS.coversNV(covers, excluded)} The scanner found ${p} ${p === 1 ? "place" : "places"}; none was reviewed.`,
  /**
   * Beside NV10 and NV11, what the answer settles, where
   * its question says (`settled_covers`): the EAA question settles the Act's duty for services, never the whole Act.
   */
  /* Then, in the same place, the sentence of each documented exclusion
   * the settled rules' law leads to (`settledExclusionsOf`), so that what the answer leaves unchecked is said where the
   * settlement is said. */
  coversNV: (covers: Inert, excluded: readonly Inert[] = []) => `${covers === "" ? "" : ` That answer settles only ${covers}.`}${excluded.map((s) => ` ${s}`).join("")}`,
  /**
   * Beside NV10 and NV11, where an
   * accessibility rule (one whose legal basis is the European Accessibility Act) is settled out of scope by an answer.
   * The Web Accessibility Directive binds public sector bodies and is out of scope in the first version; the product a
   * public body uses may still be what that body must make accessible. The wording is the owner's to approve.
   */
  /* Reworded after the non-author check (check-r5-judge section 2.4):
   * the Directive binds the public sector body for its own websites and mobile apps (Art. 1(2)), made by or on behalf of it
   * (Art. 3(2)); third-party content it neither funds, develops nor controls is excluded (Art. 1(4)(e)); a Member State may
   * exclude schools (Art. 1(5)), so no school is named. On the owner's wording sheet. */
  wadNotCheckedNV:
    "If this product is, or is part of, a website or app that a public body offers as its own (one it commissions, pays for or runs, such as a government office's or a public hospital's), the EU Web Accessibility Directive (EU) 2016/2102 may require that body to make it accessible, and the body may ask that of you by contract; this version does not check it.",
  /** NV13: an entry of "For each organisation that runs it". */
  forOperatorsNV: (header: Inert, k: number, question: Inert) =>
    `You told us each organisation that runs the product decides "${header}". ${k === 1 ? "This finding depends" : `These ${k} findings depend`} on its answer: ${question}`,
  /** NV14: on the head, and on the finding counted with it. */
  foldHeadNV: (p: number, links: Inert) => `Also at ${p} more ${p === 1 ? "place that is" : "places that are"} the same processing (${links}).`,
  foldedNV: (head: Inert, why: Inert) => `Counted with ${head}${why ? `: ${why}` : ""}.`,
  foldedDocumentsNV: "this file documents the feature that finding shows in the product",
  foldedTracedNV: (at: Spanned) => `the review traced this line to \`${at}\` of that finding`,
  /**
   * NV15: the second look at a high finding the review took out
   * of the count on its own word. `reason` is the ground in words with the line the second look quoted.
   */
  /* Each says where the finding is placed from its final placement (`placed`,
   * from `placedWords`), never from the look's answer alone, and names the second look apart from the ordinary second review
   * (which tries to disprove a finding). The naming is on the owner's wording sheet. */
  secondLookUpheldNV: (placed: Inert) => `The second look, which checks the first review's reason for not counting this finding, agreed with that reason. It is ${placed}.`,
  /** The second look agreed and the finding is still counted, its reason being that the file does not ship. */
  secondLookUpheldCountedShipsNV: (placed: Inert) =>
    `The second look, which checks the first review's reason for not counting this finding, agreed with that reason: the file is not part of the shipped product. Whether a file ships does not decide this rule's duty, so that reason does not take the finding out of the count. It is ${placed}.`,
  /** The same, for any other reason the placement does not take. */
  secondLookUpheldCountedNV: (placed: Inert) =>
    `The second look, which checks the first review's reason for not counting this finding, agreed with that reason. That reason does not take the finding out of the count here. It is ${placed}.`,
  secondLookOverturnedNV: (reason: Inert, placed: Inert) => `The second look, which checks the first review's reason for not counting this finding, found it is a problem after all: ${reason}. It is ${placed}.`,
  /** WP9: a second look that could not settle it (its answer was `needs_human`, or its quotation was not found in the file). */
  secondLookOpenNV: (placed: Inert) => `The second look, which checks the first review's reason for not counting this finding, could not settle whether it is a problem. It is ${placed}.`,
  /** The second look at an overturn on a location ground agreed with it. */
  secondLookLocationUpheldNV: (placed: Inert) =>
    `The second look, which checks the second review's reason for not counting this finding (where the line sits, whether it runs or ships), agreed with that reason. It is ${placed}.`,
  /** The same second look, due and not answered. */
  secondLookLocationNotAnsweredNV: (placed: Inert) =>
    `Second look not answered: nothing checked the second review's reason for not counting this finding (where the line sits, whether it runs or ships). It is ${placed}.`,
  /** The second review's location overturn, and a second look that found against it. */
  passesDisagreeLocationNV: (ground: Inert, reason: Inert, look: Inert, lookReason: Inert, placed: Inert) =>
    `Why: two later reviews disagree. The second review, which tries to disprove a finding, found it does not apply (${ground}): ${reason}. The second look, which checks that reason, found it is a problem after all: ${look}${lookReason ? ` — ${lookReason}` : ""}. It is ${placed}.`,
  /** The same, where the second look could not settle it. */
  passesUndecidedLocationNV: (ground: Inert, reason: Inert, lookReason: Inert, placed: Inert) =>
    `Why: the two later reviews do not agree. The second review, which tries to disprove a finding, found it does not apply (${ground}): ${reason}. The second look, which checks that reason, could not settle whether it is a problem${lookReason ? `: ${lookReason}` : ""}. It is ${placed}.`,
  /** WP9: an entry appended and no answer that stands, or a finding due a second look that got none. */
  secondLookNotAnsweredNV: (placed: Inert) => `Second look not answered: nothing checked the first review's reason for not counting this finding. It is ${placed}.`,
  /**
   * A finding the second review found not applicable while its
   * second look found it a problem after all. `ground` is the second review's ground word; `look` the second look's ground in
   * words (`secondLookGround`), with the line it quoted.
   */
  passesDisagreeNV: (ground: Inert, reason: Inert, look: Inert, lookReason: Inert, placed: Inert) =>
    `Why: two later reviews disagree. The second review, which tries to disprove a finding, found it does not apply (${ground}): ${reason}. The second look, which checks the first review's reason for not counting it, found it is a problem after all: ${look}${lookReason ? ` — ${lookReason}` : ""}. It is ${placed}.`,
  /**
   * A finding the second review found not applicable while its
   * second look could not settle the first review's reason for not counting it (its answer was `needs_human`, or its quotation
   * was not found in the file). `lookReason` is the second look's reasoning, or `passesLookUnusableNV`.
   */
  passesUndecidedNV: (ground: Inert, reason: Inert, lookReason: Inert, placed: Inert) =>
    `Why: the two later reviews do not agree. The second review, which tries to disprove a finding, found it does not apply (${ground}): ${reason}. The second look, which checks the first review's reason for not counting it, could not settle whether it is a problem${lookReason ? `: ${lookReason}` : ""}. It is ${placed}.`,
  /**
   * A high finding the first review ruled out as not applicable while its second
   * look (a run with the second check) found the rule applies after all. `reason` is the first review's, with the line it named.
   */
  dismissalDisagreeNV: (reason: Inert, look: Inert, lookReason: Inert, placed: Inert) =>
    `Why: the two reviews disagree. The first review ruled it out as not applicable: ${reason}. The second look, which checks a high finding the first review ruled out, found the rule applies after all: ${look}${lookReason ? ` — ${lookReason}` : ""}. It is ${placed}.`,
  /** The same, where the second look could not settle it. */
  dismissalUndecidedNV: (reason: Inert, lookReason: Inert, placed: Inert) =>
    `Why: the two reviews do not agree. The first review ruled it out as not applicable: ${reason}. The second look, which checks a high finding the first review ruled out, could not settle whether the rule applies${lookReason ? `: ${lookReason}` : ""}. It is ${placed}.`,
  /** The second look's part where the quote check invalidated it. */
  passesLookUnusableNV: "the line it quoted was not found in the file, so its answer could not be used",
  /** WP9: the ground of an overturn, in words (`at` is the line the second look quoted, or ""). */
  secondLookGround: {
    "duty-not-met": (at: Spanned) => `the duty is not met${at ? ` (\`${at}\`)` : ""}`,
    "not-exempt": (at: Spanned) => `the exemption does not apply${at ? ` (\`${at}\`)` : ""}`,
    "ships-after-all": (at: Spanned) => `the file is part of the shipped product${at ? ` (\`${at}\`)` : ""}`,
    /** The ground of a second look that overturns a location overturn. */
    "duty-arises-there": (at: Spanned) => `the rule's duty arises where this line is after all${at ? ` (\`${at}\`)` : ""}`,
    /** The ground of a second look that finds a ruled-out finding applies. */
    "applies-after-all": (at: Spanned) => `the construct the rule looks for is here and its duty is not met${at ? ` (\`${at}\`)` : ""}`,
  } as Record<string, (at: Spanned) => string>,
  /** WP3: a finding counted to fix because the review did not give a part a lighter placement needs (design 2.5 item 1). */
  toFixMissingNV: (placed: Inert, parts: readonly Inert[]) => `${placed.charAt(0).toUpperCase()}${placed.slice(1)}: the review did not give ${listWords(parts)}, so nothing shows it is not a problem.`,
  /**
   * Where a finding is placed, as every line that tells the person so says
   * it (`placedWords`), from its final placement. One table, so a line can never say "counted to fix" of a finding placed
   * anywhere else.
   */
  placedNV: {
    to_fix: "counted to fix",
    counsel: "left to your judgement",
    recorded: "recorded, not counted as a problem",
    not_shipped: "placed as not part of the shipped product, not counted as a problem",
    question: "waiting on your answer to a question",
    check_answer: "waiting on you to check an answer you gave",
    for_operators: "listed for each organisation that runs it",
    folded: "counted with another finding",
    not_applicable: "not counted as a problem",
    settled_by_answer: "settled by your answer",
  } as Record<string, string>,
  missingPart: {
    element: "which part of the duty the line meets",
    exemption: "the exemption and the legal basis it rests on",
    question: "the question or the fact it waits on",
    settles_as: "what your answer means for it",
    verdict: "a verdict",
  } as Record<string, string>,
  /** The section headings below the first screen (design section 3.2). */
  /** design 3.1's "To answer" below the first screen: the findings waiting on answers. */
  questionsHeading: "## To answer",
  /** [section 12]: the lead of "To answer"; the questions themselves are listed once, in laws.md. */
  toAnswerLead: "These findings wait on your answers. The questions, in words, with what each settles and how to answer it: [laws.md](laws.md#questions-open).",
  /** laws.md's list of every open question. */
  questionsOpenHeading: "## Questions open",
  /** [section 12]: the lead of the rules' unanswered fields in laws.md's "Questions open" (they were not-checked.md's "Questions still open"). */
  questionsRulesLead: "The questions the rules read that no answer gave, and the rules each holds open:",
  /**
   * [section 12] not-checked.md's one item "Questions open" (design 4: count, the findings they would settle, how to
   * answer; the full list in words in laws.md): `s` questions settling `k` findings, `o` that change only the order, `p`
   * more the rules read holding `r` rules open.
   */
  questionsOpenItem: (s: number, k: number, o: number, p: number, r: number, command: Spanned): string => {
    const settles = [
      s > 0 ? `${group(s)} ${s === 1 ? "question" : "questions"} would settle ${group(k)} ${k === 1 ? "finding" : "findings"} to answer` : "",
      o > 0 ? `${group(o)} ${o === 1 ? "question changes" : "questions change"} only the order` : "",
    ].filter(Boolean);
    const held = p > 0 ? `${group(p)} more ${p === 1 ? "question" : "questions"} the rules read ${p === 1 ? "holds" : "hold"} ${group(r)} ${r === 1 ? "rule" : "rules"} open` : "";
    const all = [settles.join(", and "), held].filter(Boolean).join("; ");
    return `- ${all}. Every question in words: [laws.md](laws.md#questions-open). Answer them for the next scan: say "review my answers" to Claude, or run \`${command}\` in a terminal.`;
  },
  /** [item 23]: the product question whose answer would move the order to fix (W7), in "Questions open". */
  questionMovesOpen: (question: Inert, k: number) =>
    `- **Question for you**: ${question} The order to fix assumes nothing about who the people are; your answer moves ${k} ${k === 1 ? "finding" : "findings"} up or leaves ${k === 1 ? "it" : "them"} where ${k === 1 ? "it is" : "they are"}.`,
  recordedHeading: "## Recorded: duty met, exempt, or a record of processing",
  notShippedHeading: "## Not part of the shipped product",
  setAsideHeading: "## Set aside on your answers",
  forOperatorsHeading: "## For each organisation that runs it",
  /** details.md's meta label by disposition (design section 3.2; taken from NV3, NV5, NV8, NV12-NV14). */
  dispositionLabel: {
    question: "question for you",
    check_answer: "check your answer",
    recorded: "recorded, not counted as a problem",
    not_shipped: "not part of the shipped product",
    for_operators: "for each organisation that runs it",
    folded: "counted with another finding",
  } as Record<string, string>,
  /** W2: a Fix-first item's first line where the review gave its effect. */
  fixEffect: (i: number, effect: Inert, count: Inert, rule: Inert) => `${i}. **${effect}**${count} — found by "${rule}".`,
  /** W2b: a Fix-first item's second line where the review's block stood. */
  /* `runs` is "" where how it runs did not stand: a part the review did not
   * establish is never stated as a fact (W13, beside it, says so and what it is placed as). */
  /* `data` is "" where no data stood: the people are said without the
   * placeholder "data" ("it concerns people with an account"); "" where nothing at all stood. */
  fixWhy: (data: Inert, people: Inert, runs: Inert, law: Inert) => {
    const who = data ? `${data}${people ? ` of ${people}` : ""}` : people ? `it concerns ${people}` : "";
    const head = [who, runs].filter(Boolean).join(", ");
    const all = [head, law].filter(Boolean).join("; ");
    return all ? `${all}.` : "";
  },
  /** W3: an item whose code is not in what ships. */
  shipsWords: {
    maker_site: (at: Inert) => `The maker's own website, not the product (${at}): the duty is the website's.`,
    documented_example: (at: Inert) => `The example deployment your documentation tells people to use (${at}): people who follow it get this as their default.`,
  } as Record<string, (at: Inert) => string>,
  /**
   * W7: an unanswered product question whose answer moves the order. Worded for any slot: the second smoke test showed it as
   * item 1, with nothing above it ("The order above").
   */
  questionMoves: (i: number, question: Inert, k: number) =>
    `${i}. **Question for you**: ${question} This list's order assumes nothing about who the people are; your answer moves ${k} ${k === 1 ? "finding" : "findings"} up or leaves ${k === 1 ? "it" : "them"} where ${k === 1 ? "it is" : "they are"}.`,
  /** [section 9 item 1]: the second line of a question slot, naming the entrance that asks it. */
  /* The words to say first: the command's path is the plugin's folder of this
   * version, which an update replaces; it still runs as printed (the route check of test:assemble-report). */
  questionEntrance: (command: Spanned) => `   Answer it for the next scan: say "review my answers" to Claude, or run \`${command}\` in a terminal.`,
  /** W8: the kinds of data, from the review's block. */
  standingData: {
    contact: "names or contact details",
    identifier: "account ids, IP addresses or device ids",
    content: "what people wrote or uploaded",
    records_about_people: "records kept about people",
    images_or_video_of_people: "images or video of people",
    audio_of_people: "recordings of people's voices",
    location: "where people are",
    biometric_template: "biometric templates that identify people",
    special_category_field: "special-category data (health, beliefs, ethnicity and the like)",
    criminal_or_violence_field: "data on offences or violence",
    credential: "a password or key that opens people's data (the value is not printed)",
    financial: "payment or financial data",
    no_personal_data: "no personal data",
  } as Record<string, string>,
  /** W9: whose data. */
  standingPeople: {
    account_holders: "people with an account",
    visitors: "anyone who opens it",
    people_recorded: "people the product keeps data about, who need not use it",
    operator_staff: "the running organisation's own staff",
    nobody: "",
  } as Record<string, string>,
  /** W9: beside the people words, where the person answered Minors: Yes. */
  minorsAnswered: "(you answered that it holds data about children)",
  /** W10: how it runs. */
  standingRuns: {
    default: "on the shipped defaults",
    default_setting_fixes: "on the shipped defaults, until a setting turns it off",
    feature_in_use: "whenever the feature is turned on",
    non_default_setting: "only after a setting is changed from its default",
  } as Record<string, string>,
  /**
   * W11: what the law says of the duty's fine, from the table's own
   * fields (`penaltyText`), then the order's own ranking said as this report's, never as the law's. A fine list of a tiered
   * regime: its tier and paragraph. A duty no fine list names: that, the provision that leaves its penalties to national
   * law where the table quotes one, and the tier the report ranks it with. A regime without tiers: that it does not grade
   * fines by duty, with the provision the table quotes (and that it leaves them to each Member State, only where the
   * quotation says so), then that the report ranks it with the heaviest; where the table quotes none, only the ranking.
   */
  tierWords: (regime: Inert, b: TierWordsBasis, later: Inert): string => {
    const t = b.penaltyText ?? { basis: b.tiered ? "fine_list" : "no_tiers", quoted: false };
    const tierName = b.tier === "top" ? "higher" : "lower";
    // An unresolved cite may be of a law with no tiers, or of a law the table does not know: the
    // words say only that the fine was not read, never that the law has tiers.
    const words = b.unresolved
      ? `this report could not tell what fine ${regime} sets for this duty, and ranks it with the heaviest duties`
      : t.basis === "fine_list"
        ? `a duty in ${regime}'s ${tierName} fine tier (${b.penaltyCite})`
        : t.basis === "unlisted"
          ? `a duty no fine list of ${regime} names${t.memberStates ? `; ${t.memberStates} leaves its penalties to national law` : ""}; this report ranks it with the ${tierName} tier`
          : t.memberStates && t.routes && t.routes.length > 0
            ? // A route the table quotes for this duty only (Data Act Art 40(4) for Chapters II, III and V) is
              // named beside the Member States' (Art 40(1)), in the table's words for what it lets happen, and the regime is
              // not said to leave its fines ungraded.
              `${t.memberStates} leaves its penalties to each Member State; for this duty, ${t.routes.map((r) => `${r.cite} ${r.says}`).join("; ")}; this report ranks it with the heaviest duties`
            : t.memberStates
            ? `${regime} does not grade fines by duty; ${t.memberStates} leaves its penalties to each Member State; this report ranks it with the heaviest duties`
            : t.quoted
              ? `${regime} does not grade fines by duty (${b.penaltyCite}); this report ranks it with the heaviest duties`
              : `this report ranks ${regime} with the heaviest duties; its penalty provisions are not quoted here`;
    return `${words}${later}`;
  },
  /** W12's last clause: "the higher fine tier" only where the regime has tiers and a fine list names the duty. */
  raiseUnder: (regime: Inert, b: TierWordsBasis): string =>
    b.tier !== "top" || b.unresolved
      ? ""
      : (b.penaltyText?.basis ?? (b.tiered ? "fine_list" : "no_tiers")) === "fine_list"
        ? `, under a duty in ${regime}'s higher fine tier`
        : `, under a duty this report ranks with the heaviest`,
  /** W11, a later date: the whole duty applies later, or some of the provisions the cite names do. */
  appliesFrom: (date: Inert) => `; applies from ${date}; prepare now`,
  /** A duty that applies now under a fine provision that applies later (CRA Art 14 under Art 64). */
  finesApplyFrom: (date: Inert) => `, whose fines apply from ${date}`,
  appliesInPart: (now: readonly Inert[], later: readonly { what: Inert; from: Inert }[]) =>
    `${now.length > 0 ? `; ${listWords(now)} ${now.length === 1 ? "applies" : "apply"}` : ""}; ${later.map((l) => `${l.what} applies from ${l.from}`).join("; ")}; prepare now`,
  /**
   * W12: a raise by weight (option B). Only what stood: `data` is ""
   * where no data stood (no placeholder), and a raise the duty's tier alone carries says so (`raisedByDutyAlone`).
   */
  raisedByWeight: (from: Inert, data: Inert, people: Inert, runs: Inert, under: Inert) => {
    const who = data ? `${data}${people ? ` of ${people}` : ""}` : people ? `it concerns ${people}` : "";
    const facts = [who, runs].filter(Boolean).join(", ");
    return facts ? ` Raised from ${from}: ${facts}${under}.` : ` Raised from ${from}:${under.replace(/^,/, "")}.`;
  },
  raisedByDutyAlone: (from: Inert, under: Inert, runs: Inert) => ` Raised from ${from} on the duty's tier alone${under}${runs ? `, ${runs}` : ""}.`,
  /**
   * W13: parts the review did not establish, and parts it gave that were not used (each group with its reason, in
   * the person's words: `asideReason`).
   */
  standingNotEstablished: (absent: readonly Inert[], aside: readonly { parts: readonly Inert[]; why: Inert }[], as: readonly Inert[]) => {
    const clauses = absent.length > 0 ? [`The review did not establish ${listWords(absent)}`] : [];
    for (const a of aside) {
      const many = a.parts.length > 1;
      clauses.push(`${clauses.length === 0 ? "The review's" : "its"} ${many ? "answers" : "answer"} on ${listWords(a.parts)} ${many ? "were" : "was"} not used (${a.why})`);
    }
    return `${clauses.join("; ")}; it is placed as if ${listWords(as)}.`;
  },
  /**
   * W13: a `standing` that is not an object, dropped whole. The review
   * gave it, in no form the report reads: said once, not as six parts the review did not establish.
   */
  standingBlockNotUsed: (as: readonly Inert[]) => `The review's answers on this finding were given in no form this report reads, so none was used; it is placed as if ${listWords(as)}.`,
  /** Why a part the review gave was not used, in the person's words. */
  asideReason: {
    tooLong: (n: number, max: number) => `it ran to ${n} words, and this report takes at most ${max}`,
    notOpened: (at: Spanned) => `the review quoted \`${at}\` without opening that line`,
    notAFile: (file: Spanned) => `the file quoted, \`${file}\`, is not in the scanned code`,
    notVerbatim: "the line quoted is not in the scanned code as quoted",
    noTree: "the line quoted could not be checked against the code",
    notKept: "the place named is not one the review kept",
    noEntry: "the quotation named is not among the review's quotations",
    notOneLine: "it ran over more than one line",
    notEnglish: "it was not in English",
    contradicts: "the review said the duty is met and also left the finding for you to decide",
    noQuestion: "the question named is not one this program asks",
    /** `status` `waits_on_answer` set aside, by its cause. */
    noQuestionNamed: "the review said it waits on your answer and named no question",
    questionNotQuoted: (why: Inert) => `the question named is one this program asks, but what the review quoted for it was not used: ${why}`,
    questionOtherForm: "the question named was not in a form this report reads",
    noQuestionStood: "no question it waits on could be used",
    questionWithoutWait: "a question goes only with a finding that waits on your answer",
    /** A duty the person's region answer set aside (S3's region half). */
    regionOut: (cites: readonly Inert[], answer: Inert) =>
      `the ${cites.length > 1 ? "laws" : "law"} it named, ${listWords(cites)}, ${cites.length > 1 ? "do" : "does"} not apply since you answered ${answer}`,
    notOwnBasis: "the law named is not one the rule cites",
    notInList: "the word given is not one this report reads",
    invalidated: "the lines the review quoted were not found in the code",
    /* The capture's
     * messages for the parts of fixes A-D (S8, S6 on `exempt`, the fact's S4, `same_as`), each by its cause. */
    contradictsExempt: "the review said the finding is exempt and also left it for you to decide",
    metNoElement: (why: Inert | null) =>
      why === null ? "the review said the duty is met and did not say which part of the duty its line meets" : `the review said the duty is met, and its answer on which part of the duty the line meets was not used (${why})`,
    exemptNoExemption: (why: Inert | null) =>
      why === null ? "the review said the finding is exempt and did not name the legal basis that exempts it" : `the review said the finding is exempt, and its answer on the legal basis that exempts it was not used (${why})`,
    elementWithoutMet: "which part of the duty a line meets goes only with a duty the review found met",
    exemptionWithoutExempt: "an exemption goes only with a finding the review found exempt",
    exemptionForm: "the exemption was not given as a legal basis of the rule's own and its limb",
    factWithoutWait: "a fact goes only with a finding that waits on an answer",
    factBesideQuestion: "the review also named a question this program asks, and the finding waits on that question",
    factForm: "the fact was not given in words with the legal basis it concerns",
    noQuestionNorFact: (why: Inert | null) =>
      why === null ? "no question or fact it waits on could be used" : `the review said it waits on a fact, and the fact was not used (${why})`,
    sameAsForm: "the line it was traced to was not given as one line of the code",
    otherForm: "it was not in a form this report reads",
  },
  /** A part the review gave that was set aside, in its slot (was W19's "not used (...)"). */
  partSetAside: NOT_ESTABLISHED,
  effectNotUsed: (why: Inert) => `the review's statement of what happens to the people was not used (${why}).`,
  notEstablishedPart: { status: "whether the duty is met", duty: "which duty it breaches", data: "what data it handles", runs: "how it runs", reaches: "who gets the data", ships: "whether the code ships" } as Record<string, string>,
  heaviestAs: { status: "the duty were not met", duty: "the duty were among the heaviest", data: "it handled special-category data", runs: "it ran on the shipped defaults", reaches: "the data went to a third party", ships: "the code shipped" } as Record<string, string>,
  /** W14: the law line by the person's answers. */
  lawByAnswers: (applying: Inert, out: Inert, answer: Inert) => `Law: ${applying || "none on your answers"}.${out ? ` Not applying on your answers: ${out} (${answer}).` : ""}`,
  /** W15: the "then" line, with what needs judgement by kind. */
  thenB: (levels: readonly Inert[], counsel: number, kinds: readonly Inert[]) =>
    `After that: ${levels.length > 0 ? listWords(levels) : "nothing of medium or low weight"}, in the same order [by area](#findings-by-area).${counsel > 0 ? ` **${counsel} need your judgement**${kinds.length > 0 ? `: ${kinds.join("; ")}` : ": the review left them to a person, and says why beside each"}.` : ""}`,
  counselKind: { law_unclear: (k: number) => `law unclear: ${k}`, code_not_readable: (k: number) => `code not readable: ${k}` } as Record<string, (k: number) => string>,
  /** W16: the label of a finding that needs judgement, by what settles it. */
  /* Where the finding sits comes from its final placement (`placedWords`): a
   * finding the review left unsettled can be placed elsewhere than with counsel (a declared-inapplicable feature asks you to
   * check your answer), and "needs your judgement" was printed whatever it was. */
  counselLaw: (cite: Inert, placed: Inert) => `The law is unclear on this point (${cite}). It is ${placed}.`,
  counselCode: (file: Spanned, placed: Inert) => `The code at \`${file}\` could not be read. It is ${placed}.`,
  /** W17: the more line. */
  fixMoreB: (n: number, q = 0, k = 0) =>
    `- ${[
      n > 0 ? `${n} more to fix ${n === 1 ? "is" : "are"} under [Findings by area](#findings-by-area), in the same order` : "",
      q > 0 ? `${q} more ${q === 1 ? "question" : "questions"} for you ${q === 1 ? "decides" : "decide"} the order of ${k} ${k === 1 ? "finding" : "findings"}; the review entrance asks ${q === 1 ? "it" : "each"}` : "",
    ]
      .filter(Boolean)
      .join("; ")}.`,
  /** W18: the by-area marker of a finding waiting on an answer. */
  waitsOn: (header: Inert) => ` Waits on your answer to "${header}".`,
  /**
   * W19: details.md, after the level line. Each of data, people,
   * runs and ships is "" where that part did not stand, and is then printed as not established, never as the heaviest
   * value the order placed it at; the effect is one sentence, its own full stop kept and never doubled.
   */
  whyItMatters: (effect: Inert, data: Inert, people: Inert, runs: Inert, ships: Inert, law: Inert) =>
    `- Why it matters: ${sentenceOf(effect || "the review gave no effect")} Data: ${data || NOT_ESTABLISHED}. Whose: ${people || NOT_ESTABLISHED}. How it runs: ${runs || NOT_ESTABLISHED}. In the product: ${ships || NOT_ESTABLISHED}.${law ? ` Duty: ${law}.` : ""}`,
  shipsPhrase: {
    product: "yes",
    documented_example: "the example deployment the documentation tells people to use",
    maker_site: "the maker's own website",
    development: "development and CI only",
    test: "tests only",
    depends_on_deployment: "depends on how it is deployed",
  } as Record<string, string>,
  /** W21: an item standing against an answer the person gave (group 1). */
  againstAnswer: (header: Inert, answer: Inert | null) =>
    `${answer === null ? `An answer of yours to ${header}` : `You answered ${header}: ${answer}, which`} puts this rule out of scope. The review kept the finding because this scan does not take that answer at face value; if your answer is right, the finding does not apply.`,
  /** A candidate whose own answer was read, set aside with its file because of another one. */
  asideWithItsFile: (record: Inert, own: number, other: number, why: Inert) =>
    `set aside with the whole answer file ${record}: this candidate's own answer, at position ${own + 1}, was read, but the answer at position ${other + 1} of the same file could not be used (${why})`,
  /** A Fix-first group at the place an earlier group showed: one line, the number it shares. */
  fixSamePlace: (n: number, link: Inert, more: Inert) => ` The same place as ${n} above: ${link}${more}`,
  moreKinds: (n: number) => `${n} more ${n === 1 ? "kind" : "kinds"}`,
  /** The data words of a place row (place-fold.ts `data`), as the first screen says them. */
  dataWords: {
    email: "e-mail addresses (or values made from them)",
    name: "names",
    user_id: "user ids",
    ip_or_device: "IP addresses or device ids",
    user_content: "what people wrote or uploaded",
    other_personal: "other personal data",
  } as Record<string, string>,
  /** The areas of the work list, by rule-id prefix, in this order (the mock's table). */
  areas: [
    ["baseline-", "Security basics"],
    ["eu-consent-", "Cookies, tracking and consent"],
    ["eu-dsr-", "People's requests: access, export and deletion"],
    ["eu-retention-", "How long data is kept"],
    ["recipients-", "Who receives the data"],
    ["safeguard-reach-", "Safeguards that may not reach what they protect"],
    ["derived-personal-data-", "What the product works out about people"],
    ["eu-special-categories-", "Sensitive data"],
    ["eu-minors-", "Children"],
    ["eu-accessibility-", "Accessibility"],
    ["platform-store-", "Data in stores the operating system owns"],
    ["acting-as-subject-", "Actions taken in a person's name"],
    ["delegated-access-", "Acting for a person at another service"],
    ["identity-issuance-", "Sign-in data shared with other services"],
    ["exposure-surface-", "Admin and debug access to personal data"],
    ["extension-code-", "Code fetched and run at start-up"],
    ["device-telemetry-", "Data sent from people's devices"],
    ["presence-", "Showing who is online"],
    ["ai-", "AI features"],
    ["eu-dsa-", "Online platform duties (Digital Services Act)"],
    ["eu-cra-", "Product security duties (Cyber Resilience Act)"],
    ["eu-data-act-", "Data access and switching (Data Act)"],
    ["eu-market-", "Selling across EU countries"],
    // The two families an earlier version left under "Other".
    ["federation-", "Data shared with other servers (federation)"],
    ["remote-actuation-", "Remote control of devices and computers"],
  ] as readonly (readonly [string, string])[],
  areaOther: "Other",
  /** details.md, one rule's head and one finding's added line. */
  ruleNamed: (id: Spanned, title: Inert) => `Rule \`${id}\`: ${title}`,
  lawOfRule: (refs: Inert) => `Law: ${refs}`,
  whatToDo: "What to do",
  reviewSaid: (text: Inert) => `- What the review said: ${text}`,
  /** The review's reason at the place of a finding with no block. */
  reviewSaidOfPlaceFull: (text: Inert) => `- What the review said of this place: ${text}`,
  detailsNone: "No finding stands in this scan: nothing was returned as a problem or for your judgement.",
  /** not-checked.md and not-applicable.md. */
  notCheckedIntro: "Nothing on this page is decided. A place here may hold a problem; reading it is the way to know.",
  ruleGroup: (plain: Inert, id: Spanned) => `${plain} (rule \`${id}\`)`,
  /**
   * Under each rule whose places have
   * no verdict, the rule's level, so the person can weigh what was not checked (the first screen counts these places once).
   */
  noVerdictLevel: (levels: readonly [string, number][]) =>
    levels.length === 1 ? `Level: ${levels[0]?.[0]} (the rule's; no verdict was given here).` : `Levels: ${levels.map(([l, n]) => `${n} ${l}`).join(", ")} (no verdict was given here).`,
  /** The intro counts each kind of answer by how its record says it was settled, and says "read" only
   * of answers a review read. */
  notApplicableIntro: (n: number, kinds: readonly Inert[]) =>
    `${n} ${n === 1 ? "answer" : "answers"}, each with its reason: ${kinds.join("; ")}. ${WORDS.ruledOutNotHere}`,
  /** Said whether or not the file holds a verdict: an answer resting on
   * places nobody read is in not-checked.md either way. */
  ruledOutNotHere: "An answer that rests on places nobody read is not here: it is in [not-checked.md](not-checked.md).",
  notApplicableKind: {
    read: (k: number) => `${k} read by the review in this scan and found not to be what the rule looks for`,
    overturned: (k: number) => `${k} overturned by the second review`,
    /* An answer given in this scan over places read in an earlier scan and carried is not "read by the review
     * in this scan" - its carried places were not read again in this one (each says so in its place lines). */
    placesCarried: (k: number) =>
      `${k} answered by the review in this scan from places of which some or all were read in an earlier scan and carried, not read again in this one`,
    carried: (k: number) => `${k} carried from an earlier scan, whose review read ${k === 1 ? "it" : "them"}; not read again in this one`,
    declared: (k: number) => `${k} settled by what you declared, before any review: no review read ${k === 1 ? "it" : "them"}`,
  } as Record<NotApplicableKey, (k: number) => string>,
  notApplicableGroup: (plain: Inert, n: number) => `## ${plain} (${n})`,
} as const);

/* ------------------------------------------------------------------------------------------------
 * Small readers. Every field is read through these, so a missing or mistyped value is visible.
 * ---------------------------------------------------------------------------------------------- */
const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Obj)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "undefined";
}
/**
 * THE WRITTEN FORM: ONE HELPER FOR EVERY COMPARISON OF A DERIVED DOCUMENT WITH THE FILE ON DISK. This command makes four documents again and
 * compares each with the file on disk: the plan and the carried verdicts (`adjudicatePlan`), the
 * assembled copies (`assembledCopies`) and the quote report (`verifyVerdictQuotes`). Each is compared,
 * and then used, as its file holds it - the bytes its producer writes, parsed back - and never as the
 * object in memory, which can hold what no file can. A key whose value is `undefined` is the case that
 * happened: a previous record with no `verdict` key gave `previous_not_taken` a `verdict: undefined`,
 * `JSON.stringify` left it out of the plan `adjudicate` wrote, and the plan was refused as edited
 * against the object it was written from, so a run whose previous run held such a record could never
 * be assembled. A function or a symbol (left out), NaN or an infinity (written as null), and a Date or
 * anything else with a `toJSON` (written as what that returns) would differ the same way.
 *
 * Bytes (a Buffer: what the producer writes) are parsed. Any other value is serialised by
 * `derivedFileContent`, the one function `adjudicate` writes the plan and the carried verdicts with and
 * `verdict-verify` writes its report with, and parsed back. `planDifferences`,
 * `quoteReportDifferences`, `recordDifferences` and `fileDifferences` each put their derived side
 * through it themselves, so no caller can hand one of them an object in memory.
 */
export function asWritten(derived: unknown): unknown {
  if (derived === undefined) return undefined;
  return JSON.parse(Buffer.isBuffer(derived) ? derived.toString("utf8") : derivedFileContent(derived)) as unknown;
}
/**
 * One line of at most `max` characters. A longer text is cut after its
 * last whole sentence in the second half of the room, else after its last whole word there, and "…" marks the cut: never
 * inside a word (the second smoke test's Fix first printed "...and I found no deploymen…"). Only a text with no space in
 * that half (one long token, a minified line) is cut at the limit.
 */
const oneLine = (s: string, max = 400): string => {
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const room = flat.slice(0, Math.max(1, max - 2));
  let sentence = -1;
  for (const m of room.matchAll(/[.!?]["')\]]?(?= )/g)) sentence = (m.index ?? 0) + m[0].length;
  if (sentence >= max / 2) return `${room.slice(0, sentence)} …`;
  const space = room.lastIndexOf(" ");
  if (space >= max / 2) return `${room.slice(0, space).replace(/[\s,;:(]+$/, "")}…`;
  return `${flat.slice(0, max - 1)}…`;
};
/**
 * A text inside a code span the assembly writes: every control character as an
 * escape (`valueText`: a line break, CR, ESC, U+2028), so that a value of the repository (a place's file, a quotation)
 * cannot start a line of its own in a report file or the end screen, and its backticks as quotes (`spanText`; `Spanned`).
 */
const code = spanText;
/**
 * A seat's sentence (its reasoning, a note, an effect) on one line, as inert
 * Markdown text (`markdownText`): the text may quote the code, and a quotation holding backticks, `<style>` or `](` may
 * not change what the rendered report shows (FR5 item 1).
 */
const said = (s: Raw, max?: number): Inert => markdownText(oneLine(s, max));
/** A value as inert Markdown text, or null where there is none. */
const textOrNull = (s: Raw | null | undefined): Inert | null => (s === null || s === undefined ? null : markdownText(s));
/** Prose of a value on one line, its runs of white space one space, as inert Markdown text. */
const proseOf = (text: Raw): Inert => markdownText(text.replace(/\s+/g, " ").trim());

/** Each seat's class field and the word the check writes into an invalidated one (`verdict-verify.ts` CLASS_FIELD). */
const CLASS_FIELD: Record<Seat, string> = { adjudicator: "verdict", refuter: "outcome", "silence-investigator": "outcome" };
const CHECK_FIELDS = ["quote_checks", "quote_check_outcome", "quote_check_notes", "quote_check_failures"];
const KEEP_SUFFIX = "_before_quote_check";
/** The refuter's reply fields that the verdict's closed `refutation` object has no place for. */
const REFUTER_REPLY_ONLY = ["finding_id", "confidence"];
const SILENCE_LOG_FIELDS = ["searched", "evidence", "quote_checks", "quote_check_outcome", "quote_check_notes"];
/**
 * Fields the program writes onto a seat's record and no seat's Output has:
 * `verdict-verify` writes CHECK_FIELDS, every `*_before_quote_check` and the
 * same CHECK_FIELDS on a `reading` block; `verdict-reading` writes `rests_on`; `adjudicate
 * --carry-into` writes `carried_forward_from` and `carried_forward`; this command writes a
 * refutation's `agent_model` from the ledger. An answer carrying one states a check, a premise, a
 * carry or a model that nothing here produced, and the log would copy it as the program's. This command also writes onto the log's copy of a verdict its
 * `refutation` (the refuter's record, `refutationObject`), its `second_look` (the challenge seat's, `secondLookObject`), its
 * `refutation_not_established` (`notEstablished`), its `disposition` and its `folded_under`; a later run reads the first
 * three from a carried row. test:assemble-report's (PO) block holds every field the assemblies it runs are seen writing
 * onto a verdict after the seat to this list.
 */
const PROGRAM_OWNED: Record<Seat, string[]> = {
  adjudicator: [
    ...CHECK_FIELDS,
    "rests_on",
    "carried_forward_from",
    "carried_forward",
    "refutation",
    "second_look",
    "refutation_not_established",
    "disposition",
    "folded_under",
  ],
  refuter: [...CHECK_FIELDS, "agent_model", "claim"],
  "silence-investigator": [...CHECK_FIELDS],
};

/* ------------------------------------------------------------------------------------------------
 * Types
 * ---------------------------------------------------------------------------------------------- */
/** A refusal, and the kinds it can have: one table, recovery.ts. */
export type { Refusal, RefusalKind } from "./recovery.js";

export interface FileRecord {
  source: string;
  index: number;
  seat: Seat;
  id: string;
  record: Obj;
}

export interface QuoteRow {
  source: string;
  index: number;
  seat: Seat;
  id: string;
  outcome: string;
  notes: string[];
  record: Obj;
}

export interface AssembleInput {
  findings: Obj;
  plan: Obj;
  /** The records of the assembled verdicts directory, as `jobsFromVerdictsDir` reads them. */
  fileRecords: FileRecord[];
  /** Files of that directory that never became a record (unreadable, empty, a non-object entry). */
  quoteReport: Obj;
  /** Entries of that directory that never became a record, as `jobsFromVerdictsDir` reports them. */
  dirMalformed?: { source: string; index: number; seat: string; problems: string[] }[];
  carried: FileRecord[];
  shape?: string;
  chosenBy?: string;
  completedAt: string;
  /** The earlier log the plan carried from, read for the log's `comparison` block; absent or null on a run that carried none. */
  earlier?: EarlierForComparison | null;
  /** This run's evidence log as the person names it later (the path the terminal prints), for the report's ask. */
  logPath?: string;
  /** Adjudicator files in the assembled directory: the launches this run made, as far as disk shows. */
  launchesRun: number;
  /** Model per assembled source path, from the ledger when it carries one. */
  modelOf?: Map<string, string>;
  /**
   * In a hooked run, per assembled source path: the launch-list entry and the seat the record was taken from, with the
   * relaunch rule's words for the entry (assemble-hooked.ts `seatOf`). A coverage gap names them.
   */
  seatOf?: Map<string, { entry: string; seat: string; advice: string; relaunch?: Relaunch }>;
  /** The refuter entries made from bytes their record no longer holds (assemble-hooked.ts `superseded`): their answers are no refutation. */
  superseded?: ReadonlyMap<string, string>;
  agentModel?: string;
  agentEffort?: string;
  /** In a hooked run, by finding_id: the relaunch rule's decision for the entry that launches the seat answering the
   * candidate, and SKILL.md step 5's command where no refuter entry names it (assemble-hooked.ts). */
  decisions?: { verdicts: Map<string, Relaunch>; refutations: Map<string, Relaunch> };
  appendRefuter?: Map<string, string>;
  /** In a hooked run whose launch list did not read as the program's own: a line on a candidate cannot tell its entry. */
  listUnread?: boolean;
  /** Refusals already found by the I/O layer (ledger, unreadable inputs). */
  refusals?: Refusal[];
  /**
   * The run's `declaration-plan.json` (declaration.ts `declarationPlan`), where its `scan_id` is
   * the findings': the one computation of what each answer changes, which the report's open questions read.
   */
  declarationPlan?: Obj | null;
  /** Why a plan the scan wrote was not taken (`boundDeclarationPlan`), or null. */
  declarationPlanNotTaken?: string | null;
  /** The state folder this assembly read and wrote the person's records in (start-record.ts `stateFolderUsed`). */
  stateFolder?: StateFolderUsed | null;
  /**
   * The person's answers in the program's confirmed record, by question
   * id (declaration.ts `givenAnswersOf`), each with its value and the time it was recorded: read only for the date of a
   * region settlement, and only where it holds the same region answer as `profile` (the run's); otherwise the settlement
   * shows no date. The disposition's
   * own answers (rows 6-8) stay the run profile's (`givenAnswersOf` below), the digest-checked profile the scan read.
   */
  confirmedAnswers?: ReadonlyMap<string, { value: unknown; at: string }>;
  /** Seats whose answer stayed invalid (the hook's receipt): reported as not judged, never refused (milestone 3). */
  notJudged?: NotJudgedSets;
  /** The answers step 6 sets aside (assembleOnce's SET ASIDE loop): none of their records is read, and their candidates are listed as not checked, with why. */
  setAside?: SetAside[];
  /**
   * Build unit F4 (design section 3, "How the person sees it"): every candidate read by the place plan, by finding_id,
   * with what the program made of its per-place table and the table's path relative to the `.legal` directory. A
   * verdict's finding carries the place lines; a candidate nobody answered is shown "not answered" with its counts (A7).
   */
  placeTables?: ReadonlyMap<string, PlacesRead>;
  /**
   * The rows of every per-place table, by finding_id, as the assembly writes them: what the severity
   * composed at the place (severity-at-place.ts) reads. Absent, only verdicts hold places.
   */
  placeRows?: ReadonlyMap<string, readonly PlaceRowIn[]>;
  /** Each rule's `short_name` from the bundle (`--bundle`), the report's plain name for it. */
  shortNames?: ReadonlyMap<string, string>;
  /** Each rule's two presentation lines (the bundle's `rule-lines.json`); absent or empty for a bundle with none, where titles are the rules' `short_name`. */
  ruleLines?: Readonly<Record<string, RuleLines>>;
  /** Each rule's `finding_role` from the bundle (rule.schema.json); absent = `duty_check`. */
  ruleRoles?: ReadonlyMap<string, string>;
  /**
   * Each rule's `duty_about`
   * from the bundle (standing.ts `dutyAboutOf`), for the rules that declare one; a rule absent here declares nothing and its
   * findings never take row 4.
   */
  ruleDuties?: ReadonlyMap<string, string>;
  /**
   * The second look's outcome by finding id, laid over what the
   * assembly reads itself (a test's injection; the run's own outcomes come from its challenge records and entries below).
   */
  secondLooks?: ReadonlyMap<string, SecondLook>;
  /**
   * The run's second-look entries that stand (a refuter entry in challenge mode,
   * launch-later.ts `buildChallengeEntries`), finding id to entry id. A finding with an entry and no challenge record that
   * stands has the second look `not_answered`: it keeps the first placement, marked, and the run still assembles.
   */
  challengeEntries?: ReadonlyMap<string, string>;
  /**
   * The claim each of those entries' second look checks (the entry's `claim`, as the launch side wrote it), finding id to
   * claim. Where it names one, the assembly words the look by it, so the launch side and the report never disagree on which
   * review's reason the look checked; a finding with none is asked here (`firstReviewClaimOf`).
   */
  lookClaims?: ReadonlyMap<string, string>;
  /** The main file's name as the command writes it, for the other four files' link back to it. */
  reportName?: string;
  /** As `ReportArgs.reportPlace` and `ReportArgs.numbering`. */
  reportPlace?: { up: string | null; root: string };
  numbering?: { list: NumberList | null; carried: { numbers: ReadonlyMap<string, number>; label: string } | null; recordedMax: number };
  /**
   * The deeper checks on this computer's record for the scanned folder, as the
   * record's own lines (plain data, so the kept input carries them and `decide`'s re-render writes the same section), the
   * folder and the report's folder the sections' links are made from. Each finding's file gets the section of every check
   * of its finding ids (design rf13 3.9), as `deepen` writes it.
   */
  deeperChecks?: { project: string; reportDir: string; lines: readonly DeepRecordLine[]; seen?: LinkedFilesSeen };
  /**
   * The person's decisions for this folder on this computer (decisions.ts
   * `readDecisionRecord`), as a reader the assembly calls only after every count is made (design rf11 3.4: "The assembly
   * computes every count from the log before it reads a decision"). Absent: none read, and no "Decided by you" section.
   */
  personDecisions?: () => DecisionRecord;
  /**
   * The person's answer to the Vendor proxy question (`features.own_domain_endpoints`), as the run
   * context the launch step wrote hands it on, where its profile is the one the scan read (`profile_digest`). Absent or
   * null: not answered, and a self-hostable vendor counts as outside the operator.
   */
  ownDomainEndpoints?: string | null;
  /**
   * The profile the scan read, from this scan's run context
   * (`runProfileOf`): the person's answers the order reads (Minors, Health data) and the questions it shows. Null or
   * absent: not known, so no unanswered product question is shown (W7).
   */
  profile?: Obj | null;
  /** The penalty-tier resolver with its table bound (penalty-tier.ts, brief T item 6). Absent: every duty is unknown (W13). */
  tierOf?: TierOf;
  /** Each rule's `legal_basis[]` (cite and jurisdiction) from the bundle, in order: `L<n>` of a block is the n-th. */
  ruleBases?: ReadonlyMap<string, readonly RuleBasis[]>;
  /** Review R18: every rule the run read on a model other than its own setting (the launch list's `model_overrides`). */
  modelOverrides?: readonly ModelOverride[];
  /** Violation candidates `refuter-entries` held back without an entry, by finding_id, with the reason it wrote. */
  held?: Map<string, string>;
  /** False where no capture ledger was checked (X33): the report says so. Absent says nothing. */
  ledgerChecked?: boolean;
  /** The records, by source path, whose file under verdicts/ the capture ledger does not list, each with every file its
   * situation leaves (assemble-hooked.ts). */
  unlisted?: ReadonlyMap<string, string[]>;
  /**
   * SKILL.md step 7's re-check over the log as written (O7), run by the caller, which holds the tree: the quote check
   * `verdict-verify --log` runs, returning its report as written, or the reason it could not run.
   */
  recheck?: (log: Obj) => { report: Obj } | { problem: string };
  /**
   * `baseline-002`'s clauses compiled for printed text (credential-redaction.ts): with it, every string
   * the log and the report print goes through the one redaction at the writers, and step 7's re-check reads the log in
   * that written form. Absent or null (a bundle without the rule) prints every value as it is.
   */
  redaction?: PrintedRedaction | null;
}

/** What step 7's re-check over the log found (O7): its counts, and how many records it demoted that the first check had not. */
export interface RecheckCounts {
  records: number;
  quotations: number;
  outcomes: Record<string, number>;
  malformed: number;
  /** Records whose class word the re-check demoted and the first check had not (a verdict, a refutation or a silence row). */
  demoted: number;
}

export interface AssembleResult {
  refusals: Refusal[];
  log: Obj | null;
  /** The five files of the report, by name (`report.md` is the one the person opens), or null when refused. */
  report: ReportFiles | null;
  counts: {
    candidates_total: number;
    verdicts: number;
    violation_candidate: number;
    not_applicable: number;
    needs_human: number;
    overturned: number;
    carried: number;
    pre_settled: number;
    unadjudicated: number;
    unknown_rules: number;
    /** Candidates the scanner suppressed that no verdict answers, recorded in the log's `suppressions[]` (O10). */
    suppressed: number;
  };
  /** What the end of the run shows the person, from the report's model; absent where nothing was built. */
  end?: EndSummary;
  /** Step 7's re-check over the log, where it ran (O7). */
  recheck?: RecheckCounts;
  /** Every finding whose record names places no review read, for the terminal summary. */
  not_checked?: NotCheckedFinding[];
  /** The later reading's total, where the plan handed candidates to a seat again with places unread. */
  read_again?: ReadAgainTotal | null;
  /** The F-numbers given, and the number list's lines to add once the report is written. */
  numbers?: NumberResult;
  /** Every finding id that has a file of its own, with that file (`findingFileOf`). */
  findingFiles?: ReadonlyMap<string, string>;
  /** Every ruled-out verdict's finding id, with its rule's file (`ruled-out/<name>.md`). */
  ruledOutFiles?: ReadonlyMap<string, string>;
  /** Each finding the report listed, as it listed it (the log's `listed[]`). */
  listed?: ListedRow[];
  /** The person's decisions as this assembly applied them (the record's page 2 reads it). */
  decisions?: DecisionView;
}

/**
 * One finding's own file, as the report's generator made it from the model of
 * this assembly: never read back from the written markdown, which code that ran in the project can change. `result` is
 * `assemble()`'s, in memory (nothing is written); `handle` is an F-number of that assembly's list or a unique prefix of at
 * least 6 hex characters of a finding id. `ids` holds every match: more than one means the prefix is not unique and no
 * text is given; none means the handle names no finding that has a file.
 */
export function findingFileOf(result: AssembleResult, handle: string): { ids: string[]; file: string | null; text: string | null } {
  const files = result.findingFiles ?? new Map<string, string>();
  const ids = idsOfHandle(handle, files.keys(), result.numbers?.byId ?? new Map<string, number>());
  const file = ids.length > 0 && new Set(ids.map((id) => files.get(id))).size === 1 ? (files.get(ids[0] as string) ?? null) : null;
  return { ids, file, text: file !== null ? (result.report?.[file] ?? null) : null };
}

/** One finding with places no review read, as the terminal summary states it. */
export interface NotCheckedFinding {
  finding_id: string;
  rule_id: string;
  places: number;
  /** The files the places are in, sorted. */
  files: string[];
  /** Its answer is `not_applicable` (dismissed or overturned): the report shows it apart from the clean ones. */
  not_applicable: boolean;
}

/* ------------------------------------------------------------------------------------------------
 * The stale-check guard: the file on disk must be the record the check annotated.
 * ---------------------------------------------------------------------------------------------- */
/** The checked record with everything `verdict-verify` adds taken off and every word it moved put back. */
export function uncheckedForm(checked: Obj, seat: Seat, onDisk: Obj): Obj {
  const c = clone(checked);
  const invalidated = c.quote_check_outcome === "invalidated";
  for (const k of CHECK_FIELDS) delete c[k];
  const reading = obj(c.reading);
  if (reading) for (const k of CHECK_FIELDS) delete reading[k];
  for (const k of Object.keys(c)) {
    if (!k.endsWith(KEEP_SUFFIX) || k in onDisk) continue;
    c[k.slice(0, -KEEP_SUFFIX.length)] = c[k];
    delete c[k];
  }
  const field = CLASS_FIELD[seat];
  if (invalidated && !(field in onDisk) && !(`${field}${KEEP_SUFFIX}` in checked)) delete c[field];
  return c;
}

function stripChecks(o: Obj): Obj {
  const c = clone(o);
  for (const k of CHECK_FIELDS) delete c[k];
  const reading = obj(c.reading);
  if (reading) for (const k of CHECK_FIELDS) delete reading[k];
  return c;
}

/**
 * The record for the log, with the check's annotations taken off its `reading` block and every other
 * annotation kept. The check writes `quote_checks` and
 * `quote_check_outcome` onto the reading block it checked (`verdict-verify.ts`, the trail's own
 * quotations), and `$defs.reading` of `verdict.schema.json`, which the log's verdicts are held to,
 * has no place for them: every census verdict whose reading quoted a line was refused. `verdict-verify`
 * is built on that schema: it validates a record BEFORE its quote pass "because the quote pass writes
 * `reading.quote_checks` and `reading.quote_check_outcome` onto the block it just checked", so
 * `verdict-verify --log --findings` reports a log verdict whose reading kept them as a
 * `verdict-schema` coverage gap and exits 5, and accepts the same log without them with exit 0
 * (measured in test:assemble-report section 12a, on a census verdict with a reader). SKILL.md step 7
 * has the reading travel "as the child wrote it and you assembled it". No outcome is lost: every
 * reading row's outcome is already folded into the record's own `quote_check_outcome`, and an
 * invalidated row's reason into `quote_check_notes`; the rows are in the check's report, and step 7's
 * re-check writes them again over the log.
 */
function withoutReadingChecks(o: Obj): Obj {
  const reading = obj(o.reading);
  if (reading) for (const k of CHECK_FIELDS) delete reading[k];
  return o;
}

/** Every field of PROGRAM_OWNED a seat's answer carries, by name (`reading.` in front of one on its reading block). */
export function programOwnedFields(record: Obj, seat: Seat): string[] {
  const out = Object.keys(record).filter((k) => PROGRAM_OWNED[seat].includes(k) || k.endsWith(KEEP_SUFFIX));
  const reading = obj(record.reading);
  if (reading) for (const k of CHECK_FIELDS) if (k in reading) out.push(`reading.${k}`);
  return out;
}

/**
 * THE FIELDS ONLY THE ASSEMBLY WRITES, refused on a record of this run by the
 * assembly itself, so the refusal holds for every caller and not only for the CLI's check of the seats' answers
 * (`programOwnedFields`). A record of this run reaches the assembly after the quote check (its check fields and the
 * `*_before_quote_check` keeps) and after `verdict-reading` (`rests_on`), so those are not refused here; the fields this
 * function returns are the ones the assembly writes onto the log's copy of a verdict and a later run reads back from a
 * carried row. A carried verdict (`input.carried`) holds them by right and is not read through this.
 */
const WRITTEN_ONLY_BY_ASSEMBLY: Record<Seat, readonly string[]> = {
  adjudicator: ["refutation", "second_look", "refutation_not_established", "disposition", "folded_under"],
  refuter: ["agent_model", "claim"],
  "silence-investigator": [],
};
export function assemblyOwnedFields(record: Obj, seat: Seat): string[] {
  return Object.keys(record).filter((k) => WRITTEN_ONLY_BY_ASSEMBLY[seat].includes(k));
}

/* ------------------------------------------------------------------------------------------------
 * The assembly.
 * ---------------------------------------------------------------------------------------------- */
const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const CONFIDENCE_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

interface Item {
  verdict: Obj;
  candidate: Obj | undefined;
  label: "candidate" | "not_yet_refuted" | "no_second_check" | "counsel" | "dismissed" | "overturned";
  /** How the item's "why" lines are made: each is called only after step 13 has redacted the rows it
   * reads, so no line of the report is made from an unredacted row. */
  why: (() => Inert[])[];
  /** The lines `why` made, after the redaction: what the report prints. */
  whyLines?: Inert[];
  adjSource?: { source: string; index: number };
  refSource?: { source: string; index: number };
  /**
   * The second look at this finding: what it returned (`not_answered` where an entry was
   * appended and no answer stands, or where the finding was due one and none was appended), and its record where one stands.
   */
  secondLook?: { outcome: SecondLook; record?: Obj; due: boolean; model?: string };
  /**
   * The second review overturned it and its second look found against the
   * seat's claim: it is left to the person, and its one line in `details.md` gives both reasons (`passesDisagreeLine`). `undecided` where the second look could not settle it.
   */
  passesDisagree?: "found_against" | "undecided";
  /**
   * `location` where the second look this finding is due checks the ordinary
   * refuter's overturn on a location ground (second-look.ts `locationChallengeOf`), not a claim of the first review: its lines
   * name that reason.
   */
  lookOn?: ChallengeClaim;
  /** A ruled-out verdict of the kind a run with the second check gives a second look (high, not an inventory rule), whether or not this one had it. */
  lookKind?: boolean;
  carriedFrom?: string;
  /** The places its record says no review read, or null where it names none. */
  notChecked?: NotCheckedPlaces | null;
  /** Where the plan says a previous run left places of it unread, how many this run checked. */
  readAgain?: ReadAgain;
  /** Build unit F4: a candidate read by the place plan, its per-place table summed (the place lines of the report). */
  placeRead?: PlacesRead;
  /** The facts at one of its places raise it above its rule's own level (severity-at-place.ts). */
  raise?: SeverityRaise;
  /** The transport raise a raise by weight replaced as the shown level's reason. */
  raisedAlso?: SeverityRaise;
  /** The order of a finding that stands (fix-order.ts), and what it was computed from (W7 recomputes). */
  order?: StandingOrder;
  orderInput?: StandingOrderInput;
  /**
   * The finding's disposition, computed once at
   * assembly (disposition.ts `dispositionOf`): what every presenter reads, never the verdict word. Absent only where the
   * item was refused before step 12d.
   */
  disp?: DispositionResult;
  /** The head finding this one is folded under (fold-findings, WP7). */
  foldedUnder?: string;
  /** Why it is folded: the key, and for key (b) the head's line it was traced to. */
  foldedBecause?: Fold;
  /** A head's shown level where a member's is higher than its own (never lower). */
  foldLevel?: string;
  /**
   * What the transport this finding's line speaks of is, in its rule's words for the form the place
   * establishes (`transportWordsAt`): for a raised finding, the plaintext place its raise rests on; for a finding of the
   * plaintext family that was not raised, its own first held place. Absent where neither is a transport.
   */
  transport?: TransportWords;
  /** For a finding not yet refuted, why its second review is missing, in the report's
   * words (made after step 13's redaction, like the "why" lines). */
  notRefutedBecause?: () => Inert;
}

/**
 * An item a second review overturned without quoting anything (verdict-verify's
 * `overturned_without_evidence`, allowed for that seat): nothing about it was checked, so it is a kind of what was not
 * checked, never a clean "not applicable" answer.
 */
const overturnedUnquoted = (summary: Obj, it: Item): boolean => {
  const src = it.refSource?.source;
  return it.label === "overturned" && !!src && arr(summary.overturned_without_evidence).map(str).some((p) => p.startsWith(`${src}#`) || p.startsWith(`${src}[`));
};

/** C2-1: an item the second review overturned on `already-gated` - never listed with the clean items. */
const overturnedOnGate = (it: Item): boolean => it.label === "overturned" && str(obj(it.verdict.refutation)?.grounds) === "already-gated";

/** A candidate read place by place, as the report and the log carry it: the table's summary and its path under `.legal`. */
export interface PlacesRead {
  summary: PlaceSummary;
  path: string;
  /**
   * Fix C2-2: the name the report shows for an item a seat named (`shownItemNameOf` over the candidate's
   * per-place table): the answer seat named its items against a fold made with no bundle. Absent, a name prints as given.
   */
  itemName?: (name: string) => string;
}

/** The later reading of one finding: the places a previous scan left unread, and how many this run checked. */
export interface ReadAgain {
  scan_id: string;
  previous: number;
  /** Places this run's record opened (a read row stands at the place). */
  checked: number;
  /** Places settled from the form of the line alone (a `covered` row of their unit), not opened. */
  settled: number;
}

/**
 * HOW MANY OF A PREVIOUS SCAN'S UNREAD PLACES THIS RUN CHECKED (
 * a place counts as read only where the seat actually opened the code around it), counted so that it can
 * only say too few, never too many, and only from this run's record, never from what it leaves out. Only where this
 * run's record has a reading block that passed the quote check, and only for a previous place at a line of this run's
 * census (the verification's L1: a place that is no longer one is never counted):
 * - `checked`: a `read` row of this record stands at the place (`memberAtRow`). A read row is a place
 *   the seat's own transcript shows it opened; a row it answered as opened and did not open is a `not_read` row.
 * - `settled`: not opened, and its unit's other members were settled by a `covered` row (a shape ground, `rest`), and
 *   the record locates every place it leaves unread and this is not one of them. Said apart, never as checked.
 * Every other previous place is counted in neither: the report says it is still not checked.
 */
export function readAgainOf(candidate: Obj | undefined, verdict: Obj, previous: Obj): ReadAgain {
  const scan = str(previous.scan_id);
  const places = Math.max(0, Number(previous.places ?? 0) || 0);
  const reading = obj(verdict.reading);
  const none = { scan_id: scan, previous: places, checked: 0, settled: 0 };
  if (!candidate || !reading || !Array.isArray(reading.not_read) || verdict.quote_check_outcome === "invalidated") return none;
  let census: ReturnType<typeof readingUnitsCensusOf> = null;
  try {
    census = readingUnitsCensusOf(candidate as unknown as Candidate);
  } catch {
    census = null;
  }
  if (!census) return none;
  const unitOf = new Map<string, ReadingKind>();
  for (const k of census.kinds) for (const m of k.members) unitOf.set(`${str(m.file)}:${Number(m.start_line)}`, k);
  const byId = new Map(census.kinds.map((k) => [k.id, k] as const));
  const openedAt = new Set<string>();
  for (const r of arr(reading.read).map(obj)) {
    const k = r ? byId.get(str(r.kind)) : undefined;
    if (r && k) openedAt.add(memberAtRow(k, { file: str(r.file), lines: str(r.lines), ...(typeof r.sub_shape === "string" ? { sub_shape: r.sub_shape } : {}) }));
  }
  const coveredUnits = new Set(arr(reading.covered).map(obj).filter((r): r is Obj => !!r && Number(r.members ?? 0) > 0).map((r) => str(r.kind)));
  const now = notCheckedOf(candidate, reading);
  const unread = new Set(now ? notCheckedLocations(now) : []);
  const allLocated = !now || now.unlisted === 0;
  let checked = 0;
  let settled = 0;
  for (const l of new Set(arr(previous.locations).map(str))) {
    const k = unitOf.get(l);
    if (!k) continue;
    if (openedAt.has(l)) checked += 1;
    else if (allLocated && !unread.has(l) && coveredUnits.has(k.id)) settled += 1;
  }
  checked = Math.min(checked, places);
  return { ...none, checked, settled: Math.min(settled, places - checked) };
}

export function assemble(input: AssembleInput): AssembleResult {
  const refusals: Refusal[] = [...(input.refusals ?? [])];
  /* The rule the report and the log are redacted with (step 13), and one string redacted on its own, as a row is: for
   * what a line takes from outside the log. */
  const redaction = input.redaction ?? null;
  const printed = (s: string): string => (redaction ? redactPrintedText(redaction, s) : s);
  const refuse = (kind: RefusalKind, id: string, problem: string, about?: string[], relaunch?: Relaunch) => {
    // A record a line names that the capture ledger does not list gives the line the stray-file recovery, naming every
    // file its situation leaves (recovery.ts `STRAY`: one situation, one recovery); a line about a candidate or a
    // record of a listed entry carries the relaunch rule's decision for that entry.
    const unlisted = [...new Set((about ?? []).flatMap((s) => input.unlisted?.get(s) ?? []))];
    refusals.push({ kind, id, problem, ...(unlisted.length > 0 ? { unlisted } : {}), ...(relaunch !== undefined ? { relaunch } : {}) });
  };
  /** The words a line on a candidate of a listed entry carries: the entry and the rule's advice for it, as the entry's own line says it. */
  const ofEntry = (d: Relaunch, what: string): string => `it is ${what} of the launch list's entry ${d.entry}. ${relaunchAdvice(d)}`;
  /* The class once fixed for the old single report, here: the scan document, the plan
   * and the quotation check's summary as this run's own copies where a redaction is on, so step 13 can redact what the
   * report prints from them as values, before any line is composed or cut, without touching the caller's objects.
   * Every decision above step 13 reads them unredacted. */
  const findings = redaction ? clone(input.findings) : input.findings;
  const plan = redaction ? clone(input.plan) : input.plan;
  const preLaunch = obj(plan.pre_launch);
  const summary0 = obj(input.quoteReport.summary);
  const summary: Obj = summary0 ? (redaction ? clone(summary0) : summary0) : {};
  /** The shape problems the check listed for one record (its `malformed[]`), for the words of a demoted finding (R2). */
  const malformedOf = (source: string, index: number): string[] | undefined => {
    const m = arr(summary.malformed).map(obj).find((x) => !!x && str(x.source) === source && Number(x.index) === index);
    return m ? arr(m.problems).map(str) : undefined;
  };

  /* 1. The run shape: the answer to step 3l is a record like any other, and it is not on disk yet. */
  const shape = input.shape;
  const chosenBy = input.chosenBy;
  if (!shape) {
    // A hooked or in-session run takes the shape from the answer; its refusal is already named (milestone 3).
    if (!refusals.some((r) => r.kind.startsWith("shape-"))) refuse("shape-missing", "-", "the run shape is not recorded anywhere on disk; pass --shape (full, important or refute_later) and --chosen-by (user or default) as the person answered step 3l");
  } else if (!["full", "important", "refute_later"].includes(shape)) {
    refuse("shape-invalid", "-", `--shape ${JSON.stringify(shape)} is not one of full, important, refute_later`);
  }
  if (shape && !chosenBy) refuse("shape-missing", "-", "--chosen-by (user or default) is required with --shape");
  else if (chosenBy && !["user", "default"].includes(chosenBy)) refuse("shape-invalid", "-", `--chosen-by ${JSON.stringify(chosenBy)} is not user or default`);

  /* 2. The quote report is the check's own output. `runAssembleReport` runs that check itself, over
   * the copies it derived from the seats' answers and with the scan document, so no report on disk
   * is taken as input; a caller of this function passes the report of a check it ran. */
  if (input.quoteReport.tool !== "verdict-verify") {
    refuse("quote-report", "-", "the quote report was not written by verdict-verify");
  }
  if (!preLaunch) refuse("plan", "-", "the plan carries no pre_launch block, so the price the person was shown and the pre-settled records are not on disk");

  /* 3. Every record the check could not read is a missing record. */
  const rowKey = (source: string, index: number) => `${source}\u0000${index}`;
  const quoteRows = new Map<string, QuoteRow>();
  for (const r of arr(input.quoteReport.records)) {
    const row = obj(r);
    if (!row) continue;
    quoteRows.set(rowKey(str(row.source), Number(row.index)), {
      source: str(row.source),
      index: Number(row.index),
      seat: str(row.seat) as Seat,
      id: str(row.id),
      outcome: str(row.outcome),
      notes: arr(row.notes).map(str),
      record: obj(row.record) ?? {},
    });
  }
  /* 3a. SET ASIDE: no row of a record set aside whole, and no answer of a candidate set aside, is read. Its
   * candidates are the not-judged ones below, each with why (`notJudged`), so the arithmetic still accounts for each. */
  const setAsideIn = input.setAside ?? [];
  const asideSources = new Set(setAsideIn.flatMap((a) => a.sources));
  const asideAnswers = new Set(setAsideIn.flatMap((a) => [...a.findings.map((id) => `adjudicator\u0000${id}`), ...a.refutations.map((id) => `refuter\u0000${id}`), ...a.silences.map((id) => `silence-investigator\u0000${id}`)]));
  const asideFindings = new Set(setAsideIn.flatMap((a) => a.findings));
  // A refutation of a candidate whose own answer is set aside refutes nothing this run uses: it is not read either.
  const isAside = (source: string, seat: string, record: Obj): boolean =>
    asideSources.has(source) ||
    asideAnswers.has(`${seat}\u0000${str(record[seat === "silence-investigator" ? "rule_id" : "finding_id"])}`) ||
    (seat === "refuter" && asideFindings.has(str(record.finding_id)));
  for (const [k, q] of quoteRows) if (isAside(q.source, q.seat, q.record)) quoteRows.delete(k);
  const fileRecords = input.fileRecords.filter((f) => !isAside(f.source, f.seat, f.record));
  const notJudgedSets: NotJudgedSets | undefined = setAsideIn.length === 0 ? input.notJudged : withSetAside(input.notJudged, setAsideIn);
  const namedMissing = new Set<string>();
  for (const m of [...arr(summary.malformed), ...(input.dirMalformed ?? [])]) {
    const e = obj(m);
    if (!e) continue;
    const key = rowKey(str(e.source), Number(e.index));
    if (asideSources.has(str(e.source))) continue; // set aside whole, listed by its candidates
    if (quoteRows.has(key) || namedMissing.has(key)) continue; // a record (handled as invalidated), or already named
    namedMissing.add(key);
    refuse("record-missing", `${str(e.source)}[${Number(e.index)}]`, `no record could be read here (${arr(e.problems).map(str).join("; ")}); the ${str(e.seat)} seat that wrote it has no answer on disk`, [str(e.source)], input.seatOf?.get(str(e.source))?.relaunch);
  }

  /* 4. The stale-check guard, both ways. */
  const onDisk = new Map<string, FileRecord>();
  for (const f of fileRecords) onDisk.set(rowKey(f.source, f.index), f);
  for (const f of fileRecords) {
    const q = quoteRows.get(rowKey(f.source, f.index));
    if (!q) {
      refuse("record-unchecked", `${f.source}[${f.index}]`, "this record is in the verdicts directory and the quote check has no row for it: the check ran before it was written, or over another directory. Re-run verdict-verify");
      continue;
    }
    if (q.seat !== f.seat) {
      refuse("record-stale", `${f.source}[${f.index}]`, `the check read this position as a ${q.seat} record and the directory holds a ${f.seat} record`);
      continue;
    }
    if (canonical(stripChecks(f.record)) !== canonical(stripChecks(uncheckedForm(q.record, f.seat, f.record)))) {
      refuse("record-stale", `${f.source}[${f.index}]`, "this record changed after the quote check ran: the file on disk is not the record the check annotated. Re-run verdict-verify");
    }
  }
  for (const q of quoteRows.values()) {
    if (!onDisk.has(rowKey(q.source, q.index))) {
      refuse("record-orphan", `${q.source}[${q.index}]`, "the quote check has a row for this record and the verdicts directory holds no such record");
    }
  }
  /* 4b. A record of this run that carries a field only the assembly writes is
   * refused here, as the CLI refuses such an answer: a nested `refutation` planted in an adjudicator's record would otherwise
   * be kept on the log's row and carried into a later run as a refutation no refuter gave. */
  for (const f of fileRecords) {
    const owned = assemblyOwnedFields(f.record, f.seat);
    if (owned.length > 0) {
      refuse("answer-owned-field", `${f.source}[${f.index}]`, `this ${f.seat} record carries ${owned.join(", ")}, which the program writes and no seat's Output has: the log would state a refutation, a second look, a placement or a model nothing here produced. Re-launch that seat`);
    }
  }

  /* 5. The check's coverage gaps: every one but `verdict-missing` is the orchestrator's to act on. In a hooked run the
   * refusal names the launch-list entry and the seat whose answer the record holds, with the relaunch rule's words for
   * that entry: the entry is what the orchestrator acts on. */
  const byWhom = (findingId: string): string => {
    const f = fileRecords.find((r) => r.seat === "adjudicator" && r.id === findingId);
    const s = f ? input.seatOf?.get(f.source) : undefined;
    return f && s ? ` The record ${f.source} holds the answer of seat ${s.seat} to the launch list's entry ${s.entry}. ${s.advice}.` : "";
  };
  for (const g of arr(summary.coverage_gaps)) {
    const gap = obj(g);
    if (!gap || str(gap.check) === "verdict-missing" || asideFindings.has(str(gap.finding_id))) continue;
    refuse("coverage-gap", str(gap.finding_id), `${str(gap.check)}${gap.kind ? ` (kind ${str(gap.kind)})` : ""}: ${oneLine(str(gap.problem), 600)}${byWhom(str(gap.finding_id))}`);
  }

  /* 6. The records, by seat, as the check left them. */
  const candidates = arr(findings.candidates).map(obj).filter((c): c is Obj => !!c);
  const candidateById = new Map(candidates.map((c) => [str(c.finding_id), c]));
  const checked = [...quoteRows.values()].filter((q) => onDisk.has(rowKey(q.source, q.index)));
  const adjudications = new Map<string, QuoteRow>();
  const refutations = new Map<string, QuoteRow>();
  /* A refuter's record in challenge mode is the second look's: it moves the finding's
   * placement (`disposition.ts`), never its verdict, so it is kept apart from the refutations the merge of step 5 reads. */
  const challenges = new Map<string, QuoteRow>();
  const silences = new Map<string, QuoteRow>();
  for (const q of checked) {
    /* An answer counts only for the record bytes it examined. A refuter's record bound to an entry made
     * from bytes its adjudicator record no longer holds answers a verdict that no longer exists: it is not this
     * candidate's refutation (the hooked run's `noted:` line says so), never an orphan that aborts the run. */
    if (q.seat === "refuter") {
      const bound = input.seatOf?.get(q.source)?.entry;
      if (bound !== undefined && input.superseded?.has(bound)) continue;
    }
    const id = str(q.record[q.seat === "silence-investigator" ? "rule_id" : "finding_id"]);
    const into = q.seat === "adjudicator" ? adjudications : q.seat === "refuter" ? (isChallengeRecord(q.record) ? challenges : refutations) : silences;
    if (!id) {
      refuse(q.seat === "silence-investigator" ? "silence-unnamed" : q.seat === "adjudicator" ? "verdict-unnamed" : "refutation-unnamed", `${q.source}[${q.index}]`, `this ${q.seat} record names no ${q.seat === "silence-investigator" ? "rule_id" : "finding_id"}`);
      continue;
    }
    const before = into.get(id);
    if (before) {
      refuse(q.seat === "adjudicator" ? "verdict-duplicate" : q.seat === "refuter" ? "refutation-duplicate" : "silence-duplicate", id, `two ${q.seat} records answer it: ${before.source}[${before.index}] and ${q.source}[${q.index}]`, [before.source, q.source]);
      continue;
    }
    /* An invalidated record carries the check's word and no other (step 5a). The check writes it; a
     * report whose invalidated record says anything else was edited after the check, and assembling
     * it would state a verdict no seat and no check gave. */
    if (q.record.quote_check_outcome === "invalidated") {
      const field = CLASS_FIELD[q.seat];
      const word = invalidWordFor({ seat: q.seat, container: "verdicts-dir" }, q.record[`${field}${KEEP_SUFFIX}`]);
      if (str(q.record[field]) !== word) {
        refuse(
          q.seat === "adjudicator" ? "verdict-word" : q.seat === "refuter" ? "refutation-outcome" : "silence-outcome",
          id,
          `the quote check invalidated this record (${q.source}[${q.index}]), which makes its ${field} ${JSON.stringify(word)}, and the record says ${JSON.stringify(str(q.record[field]) || "(no word)")}: the quote report was changed after the check`,
        );
      }
    }
    into.set(id, q);
  }

  /* 7. Who accounts for each candidate: a fresh verdict, a carried one, the declaration, or the shape. */
  const toAdjudicate = new Set(arr(plan.to_adjudicate).map(str));
  // Each pre-settled record with its disposition (row 1) and, for a region
  // settlement, the date of the answers that settled it where the confirmed record holds them.
  const preSettled = settledRecordsOf(arr(preLaunch?.pre_settled).map(obj).filter((r): r is Obj => !!r), input.confirmedAnswers, input.profile ?? null);
  const preSettledIds = new Set(preSettled.map((r) => str(r.finding_id)));
  const carriedById = new Map<string, FileRecord>();
  for (const c of input.carried) {
    const id = str(c.record.finding_id);
    if (carriedById.has(id)) refuse("verdict-duplicate", id, "two carried verdicts answer it");
    // The carry writes only a whole set (carry-forward.ts, verdict-set.ts) and judges any other finding again; a carried
    // verdict that is not whole was not written by it, and is never placed on the part it holds.
    const set = verdictSetOf(c.record);
    if (set.missing.length > 0) refuse("carried-differs", id, WORDS.carriedNotWhole(markdownText(set.missing.map((m) => m.why).join("; "))));
    carriedById.set(id, c);
  }
  const carriedExpected = Number(obj(preLaunch?.carried)?.candidates ?? 0);
  if (preLaunch && carriedExpected !== carriedById.size) {
    refuse("plan", "-", `the plan says ${carriedExpected} candidate(s) were carried forward and the carried directory holds ${carriedById.size} verdict(s)`);
  }

  /* The payloads the chosen shape launched. `full` and `refute_later` launch every remaining one.
   * `important` is derived again from the scan's payload index, and the derivation must be the one
   * the person was shown: a payload the plan leaves to launch with no row in the
   * index, or a count other than the preview's, means the reach below is not the run's, and a lost
   * verdict would then read as a candidate the shape did not reach. */
  const payloadKeyOf = (c: Obj) => str(obj(c.adjudication_group)?.key) || str(c.finding_id);
  let reached: Set<string> | null = null;
  if (shape === "important") {
    const remainingKeys = new Set(arr(preLaunch?.remaining_payloads).map(str));
    const rows = arr(obj(findings.context_payloads)?.payloads)
      .map(obj)
      .filter((r): r is Obj => !!r && remainingKeys.has(str(r.key))) as unknown as FindingsContextPayloadRow[];
    for (const key of [...remainingKeys].sort()) {
      if (!rows.some((r) => r.key === key)) {
        refuse("plan", key, `the plan leaves payload ${JSON.stringify(key)} to launch and findings.json's context_payloads has no row for it, so which payloads the important shape launched cannot be derived`);
      }
    }
    const remaining = candidates.filter((c) => toAdjudicate.has(str(c.finding_id))) as unknown as Candidate[];
    reached = new Set(importantRows(remaining, rows).map((r) => groupKeyOf(r)));
    const reachedCandidates = new Set((remaining as unknown as Obj[]).filter((c) => reached?.has(payloadKeyOf(c))).map((c) => str(c.finding_id))).size;
    const shown = arr(obj(preLaunch?.preview)?.shapes)
      .map(obj)
      .find((s) => str(s?.shape) === "important");
    if (preLaunch && !shown) {
      refuse("plan", "-", "the plan's preview carries no important shape, so what the person was shown for the shape they chose is not on disk");
    } else if (shown && Number(shown.candidates) !== reachedCandidates) {
      refuse("plan", "-", `the important shape reaches ${reachedCandidates} candidate(s) of findings.json and the preview the person was shown says ${Number(shown.candidates)}: the plan is not this scan's`);
    }
  }

  const unadjudicated: Obj[] = [];
  /* O10 (A-64): a candidate the scanner suppressed, kept only by a diagnostic run (`candidates[].suppressed_by`), that
   * no verdict answers is recorded in the log's `suppressions[]` with the scanner's reason: never refused as outside
   * the plan or as a lost verdict, and never adjudicated by default. One a verdict answers is a verdict like any other. */
  const suppressions: Obj[] = [];
  for (const c of candidates) {
    const id = str(c.finding_id);
    const accountedBy = [adjudications.has(id) && "a verdict of this run", carriedById.has(id) && "a carried verdict", preSettledIds.has(id) && "the declaration (pre_settled)"].filter(Boolean) as string[];
    if (accountedBy.length > 1) {
      const own = adjudications.get(id);
      refuse("verdict-duplicate", id, `this candidate is answered twice: by ${accountedBy.join(" and by ")}${own ? ` (this run's: ${own.source}[${own.index}])` : ""}`, own ? [own.source] : []);
      continue;
    }
    if (accountedBy.length === 1) {
      if (adjudications.has(id) && !toAdjudicate.has(id)) {
        refuse("verdict-unexpected", id, "this run holds a verdict for a candidate the plan did not leave to adjudicate");
      } else if (adjudications.has(id) && reached && !reached.has(payloadKeyOf(c))) {
        refuse("verdict-unexpected", id, `the important run did not launch payload ${JSON.stringify(payloadKeyOf(c))} and this run holds a verdict for this candidate: no seat of this run was asked about it`);
      }
      continue;
    }
    const suppressedBy = typeof c.suppressed_by === "string" ? c.suppressed_by.trim() : "";
    if (suppressedBy !== "") {
      suppressions.push({ finding_id: id, reason: suppressedBy.length >= 3 ? suppressedBy : `suppressed by the scanner (${suppressedBy})`, by: "the scanner" });
      continue;
    }
    if (!toAdjudicate.has(id)) {
      refuse("plan", id, "this candidate of findings.json is neither left to adjudicate, carried, nor settled by the plan: the plan is not this scan's");
      continue;
    }
    if (reached && !reached.has(payloadKeyOf(c))) {
      unadjudicated.push({ finding_id: id, reason: "run_shape", shape: "important" });
      continue;
    }
    const notJudged = notJudgedSets?.findings.get(id);
    const placed = input.placeTables?.get(id);
    if (notJudged?.why !== undefined) {
      // Its answer was set aside (or its entry could not be launched again): listed as not checked, with why.
      unadjudicated.push({ finding_id: id, reason: "unusable_answer", why: notJudged.why });
      continue;
    }
    if (notJudged && placed) {
      // A7 (build unit F4): a candidate read by the place plan whose answer seat, and then its make-up seat, gave no
      // answer that holds is shown "not answered" with its place counts and kept places, never clean, and no verdict
      // (so no `not_applicable`) is made for it.
      const s = placed.summary;
      unadjudicated.push({ finding_id: id, reason: "not_answered", seat: notJudged.seat, kept: notJudged.kept, places: s.places, places_read: s.read, ...(s.carried > 0 ? { places_carried: s.carried, carried_from_scans: s.carried_from_scans } : {}), not_checked: s.not_checked, kept_places: s.kept_places, per_place_table: placed.path });
      continue;
    }
    if (notJudged) {
      // The hook's receipt: the seat's answer stayed invalid, so its candidates are reported as not judged (milestone 3).
      unadjudicated.push({ finding_id: id, reason: "invalid_answer", seat: notJudged.seat, kept: notJudged.kept });
      continue;
    }
    if (shape) {
      // The line states its entry's recovery, decided as the entry's own line decides it; it gives no advice of its own.
      const d = input.decisions?.verdicts.get(id);
      refuse("verdict-lost", id, `the ${shape} run launched payload ${JSON.stringify(payloadKeyOf(c))} for this candidate and no adjudicator record answers it: ${d ? ofEntry(d, "a candidate") : input.listUnread ? LIST_UNREAD : "no entry of a hooked run's launch list names it"}`, [], d);
    }
  }
  for (const id of adjudications.keys()) {
    if (!candidateById.has(id)) refuse("verdict-unexpected", id, "this adjudicator record names a finding_id that is not a candidate of findings.json");
  }
  // A second look answers a finding a verdict seat of this run kept, or nothing.
  for (const id of challenges.keys()) {
    if (!adjudications.has(id)) refuse("refutation-orphan", id, "a second look (a refuter's answer in challenge mode) was written for a finding no adjudicator record of this run answers");
  }
  for (const id of toAdjudicate) {
    if (!candidateById.has(id)) refuse("plan", id, "the plan leaves this finding_id to adjudicate and findings.json has no such candidate: the plan is not this scan's");
  }

  /* 8. The merge of step 5 (SKILL.md L162-170), with step 5a's invalidated records left as the check left them. */
  const deferred = shape === "refute_later";
  if (deferred && refutations.size > 0) {
    refuse("refutation-deferred-but-present", "-", `the shape is refute_later, which launches no refuter, and ${refutations.size} refutation record(s) are in the directory`);
  }
  /* The second look's outcome per finding, from its record and its entry, read
   * before the refutations are merged (a test's injection is laid over it): an ordinary overturn of a finding whose second
   * look found against the seat's claim is decided below with both answers in view. */
  /* A carried verdict brings its second look with it (verdict-set.ts: the carry
   * takes the set whole or not at all), and it is read here as a second look of this run is, so the carried finding is placed
   * as its own run placed it. A `not_answered` one is no answer (such a set is not carried; a planted one is due again below). */
  const carriedLooks = new Map<string, { record: Obj }>();
  for (const [id, c] of carriedById) {
    const sl = obj(c.record.second_look);
    if (sl && str(sl.outcome) !== "not_answered") carriedLooks.set(id, { record: sl });
  }
  const looks = secondLooksOf(challenges, input.challengeEntries, input.secondLooks, carriedLooks, input.modelOf);
  // The run's facts as the disposition reads them, before any second look is laid on (only `firstReviewClaimOf` reads this).
  const earlyCtx = dispositionContextOf(findings, input);
  const items: Item[] = [];
  const refutationsNotEstablished: Obj[] = [];
  /* A refutation that was not established is kept with the verdict as well as in
   * the log's list: the row a later run carries holds `refutation_not_established` (its reason, as the list has it), so the
   * carried finding says why it is not yet refuted, as its own run said, instead of "no second review of it is recorded". */
  const notEstablished = (v: Obj, entry: Obj): void => {
    refutationsNotEstablished.push(entry);
    const { finding_id: _id, ...kept } = entry;
    v.refutation_not_established = clone(kept);
  };
  const counts = { violation_candidate: 0, not_applicable: 0, needs_human: 0, overturned: 0 };
  /* THE ONE PLACEMENT OF A REFUTATION'S ANSWER, for a record of this run
   * and a carried one alike. A carried verdict was labelled by the word its log row ended on, so a finding the two later passes
   * had left to the person came back with the first review's reasoning as its why, and an overturn came back as a plain
   * dismissal; now both are placed from the refutation and the second look they carry, as their own run placed them, so the
   * placement and the why line are run 1's. `ref` is the refuter's record (a carried one: the log's `refutation`). */
  const placeOnRefutation = (id: string, v: Obj, item: Item, ref: Obj, malformed: () => string[] | undefined): void => {
    const outcome = str(ref.outcome);
    /* An overturn on a location ground that stands is due a second look at every
     * level, unless the first review's own claim already has one (that look decides it, as it always has). Asked of the record
     * as the adjudicator wrote it, at the rule's level, as the launch side asks it. */
    /* Where the overturn stands, `lookOn` names the claim the finding's second look checks: the one its entry names (the
     * launch side's), else the one its carried look was recorded with, else the assembly's own reading. `location` is the
     * second review's reason; any other value is the first review's claim, whose look then decides the finding. Either way
     * the look is due: one none answered is marked so (step 12) and said beside the overturn. */
    if (locationOverturnStands(ref, candidateById.get(id))) {
      const named = input.lookClaims?.get(id) ?? str(obj(carriedById.get(id)?.record.second_look)?.claim);
      item.lookOn = (CHALLENGE_CLAIMS as readonly string[]).includes(named) ? (named as ChallengeClaim) : (firstReviewClaimOf(item, earlyCtx, (input.placeRows?.get(id) ?? []) as readonly PlaceRowIn[], str(item.candidate?.severity)) ?? "location");
    }
    // The one test of whether the answer can be used (standing.ts `refutationUnusable`), which the count of the answers so far asks too.
    const unusable = refutationUnusable(ref, candidateById.get(id));
    const groundUnusable = unusable === "ground_not_listed" ? WORDS.groundNotListed(markdownText(JSON.stringify(ref.grounds ?? null)), [...refutationGrounds()].map((g) => markdownText(g))) : unusable === "location_ground" ? WORDS.locationGroundUnusable(markdownText(str(ref.grounds))) : null;
    if (groundUnusable !== null) {
      /* R-2 AGAIN AT THE ASSEMBLY. An ordinary overturn on a location
       * ground (where the line sits, whether it runs or ships) stands only for a finding whose rule opts in
       * (`duty_about: product_runtime`). The capture refuses any other, but only where it has the findings document; a
       * capture with `--ids` and none skips it. Here the answer is set aside as not usable, as a refusal that stayed would
       * leave it: the verdict carries no refutation, and the candidate is not yet refuted, with why. */
      const why = groundUnusable;
      delete v.refutation;
      delete item.refSource;
      item.label = "not_yet_refuted";
      item.why.push(() => [WORDS.whyRefutationUnusable(said(printed(why)))]);
      item.notRefutedBecause = () => WORDS.notRefutedUnusable(said(printed(why)));
      notEstablished(v, { finding_id: id, reason: "unusable_answer", why });
    } else if (outcome === "upheld") {
      item.label = "candidate";
    } else if (outcome === "overturned" && lookLeavesOverturnToPerson(looks.get(id)?.outcome)) {
      /* TWO LATER PASSES THAT DISAGREE. The second review overturned the
       * finding as not applicable, and its second look found against the seat's claim (the duty is not met, the exemption does
       * not apply, or the file ships). Neither answer is taken over the other: the finding goes to the person (`counsel`,
       * row 9), with both reasons beside it, never to row 2 on the second review's word alone. A second look that could not settle it (`needs_human`, which is
       * also what the quote check leaves of one whose quotation was not found) leaves the finding to the person too, as WP9
       * places an undecided second look (disposition.ts `doubted`). A second look that agreed with the seat, or was not run,
       * leaves the overturn as it stands (the branch below). */
      const look = looks.get(id);
      v.verdict = "needs_human";
      item.label = "counsel";
      item.passesDisagree = look?.outcome === "needs_human" ? "undecided" : "found_against";
      item.why.push(() => [passesDisagreeLine(obj(v.refutation) ?? ref, look, printed, placedWords(dispositionOfItem(item)), item.lookOn)]);
    } else if (outcome === "overturned") {
      v.verdict = "not_applicable";
      item.label = "overturned";
    } else if (outcome === "needs_human") {
      v.verdict = "needs_human";
      item.label = "counsel";
      if (ref.quote_check_outcome === "invalidated") item.why.push(() => demotedWhy(v, obj(v.refutation) ?? ref, "refuter", candidateById.get(id), malformed()));
      else item.why.push(() => [WORDS.whyRefuter(said(str((obj(v.refutation) ?? ref).reasoning)))]);
    } else {
      refuse("refutation-outcome", id, `the refutation's outcome is ${JSON.stringify(outcome)}, which is none of upheld, overturned, needs_human`);
    }
  };
  /* A FINDING THE FIRST REVIEW RULED OUT. In a run whose
   * shape has the second check (the person chose "+ second check"), a high one is due a second look (`second-look.ts`
   * `dismissalClaimOf`); `lookOn` names that claim, so a look none answered is marked as not answered (step 12d) and the log
   * keeps the claim with the look (a later run that carries the row places it again here, `fresh` false: a carried row keeps
   * the look its own run gave, and is not made due by this run's shape). A look that found the rule applies, or could not
   * settle it, leaves the finding to the person with both answers (`counsel`, as two later passes that disagree are placed,
   * never counted to fix on one seat's word); a look that agreed leaves it ruled out, with the look beside it. */
  const placeDismissal = (id: string, v: Obj, item: Item, fresh: boolean): void => {
    item.label = "dismissed";
    const look = looks.get(id);
    const role = input.ruleRoles?.get(str(item.candidate?.rule_id));
    const kind = dismissalClaimOf({ verdict: "not_applicable", level: str(item.candidate?.severity), ...(role ? { role } : {}), secondCheck: true }) !== null;
    if (kind) item.lookKind = true;
    const due = fresh && !deferred && kind;
    if (!due && !look) return;
    item.lookOn = "not_applicable";
    if (!lookLeavesOverturnToPerson(look?.outcome)) return;
    v.verdict = "needs_human";
    item.label = "counsel";
    item.passesDisagree = look?.outcome === "needs_human" ? "undecided" : "found_against";
    item.why.push(() => [dismissalDisagreeLine(v, look, printed, placedWords(dispositionOfItem(item)))]);
  };
  for (const [id, q] of adjudications) {
    const v = withoutReadingChecks(clone(q.record));
    const invalidated = v.quote_check_outcome === "invalidated";
    const r = refutations.get(id);
    const item: Item = { verdict: v, candidate: candidateById.get(id), label: "candidate", why: [], adjSource: { source: q.source, index: q.index }, ...(input.placeTables?.has(id) ? { placeRead: input.placeTables.get(id) } : {}) };
    if (r) item.refSource = { source: r.source, index: r.index };
    /* A refutation answers the adjudicator's own word, so it is judged on the words the adjudicator
     * wrote, invalidated or not: the record as written (`uncheckedForm` puts back
     * every word the check moved) read in its class field and in every other field carrying a class
     * word, found by value as the check finds them. Reading `verdict_before_quote_check ?? verdict`
     * alone read the check's word for run 1's ten records whose label was under `class`, and called
     * their refutations orphans of a "needs_human" nobody wrote. A refuter is launched for a
     * violation_candidate only, so a refutation of a record with no such word answers nothing a seat
     * was asked. A record the check invalidated needs no refutation: its word is `needs_human`
     * whatever a refuter said, so a missing refuter would change nothing and relaunching one would
     * spend the person's money for no word. */
    const asWritten = uncheckedForm(q.record, "adjudicator", onDisk.get(rowKey(q.source, q.index))?.record ?? {});
    const writtenWords = [str(asWritten.verdict), ...strayLabelFields({ seat: "adjudicator", holder: asWritten }).map((k) => str(asWritten[k]))].filter(Boolean);
    if (r && !writtenWords.some((w) => labelKey(w) === "violation_candidate")) {
      refuse(
        "refutation-orphan",
        id,
        `a refutation was written for a record the adjudicator returned as ${writtenWords.length > 0 ? writtenWords.map((w) => JSON.stringify(w)).join(" and ") : "(no word)"}: only a violation_candidate is refuted`,
      );
    }
    const refutation = r ? refutationObject(r.record, input.modelOf?.get(r.source)) : undefined;
    if (refutation) v.refutation = refutation;

    if (invalidated) {
      // Step 5a: an invalidated record IS needs_human and is never a candidate or a dismissal.
      item.label = "counsel";
      item.why.push(() => demotedWhy(v, v, "adjudicator", candidateById.get(id), malformedOf(q.source, q.index)?.map(printed)));
    } else if (str(v.verdict) === "violation_candidate") {
      if (deferred) {
        item.label = "no_second_check";
      } else if (!r) {
        const notJudged = notJudgedSets?.refutations.get(id);
        if (notJudged?.why !== undefined) {
          // The refuter's answer was set aside, or its entry could not be launched again: not yet refuted, with why.
          const why = notJudged.why;
          item.label = "not_yet_refuted";
          item.why.push(() => [WORDS.whyRefutationUnusable(said(printed(why)))]);
          item.notRefutedBecause = () => WORDS.notRefutedUnusable(said(printed(why)));
          notEstablished(v, { finding_id: id, reason: "unusable_answer", why });
        } else if (notJudged) {
          // The refuter's answer stayed invalid: the refutation is not established, and the candidate is not yet refuted.
          item.label = "not_yet_refuted";
          item.why.push(() => [WORDS.whyRefutationInvalid(markdownText(printed(notJudged.seat)), code(printed(notJudged.kept)))]);
          item.notRefutedBecause = () => WORDS.notRefutedInvalid(markdownText(printed(notJudged.seat)), code(printed(notJudged.kept)));
          notEstablished(v, { finding_id: id, reason: "invalid_answer", seat: notJudged.seat, kept: notJudged.kept });
        } else if (input.held?.has(id)) {
          /* `refuter-entries` held it back and made no entry, so no second review was launched: not yet refuted,
           * with the reason the launch list records. Never refused (nothing a relaunch of the same request would change)
           * and never silent. */
          const reason = input.held.get(id) ?? "";
          item.label = "not_yet_refuted";
          item.why.push(() => [WORDS.whyRefutationHeld(said(printed(reason)))]);
          item.notRefutedBecause = () => WORDS.notRefutedHeld(said(printed(reason)));
          notEstablished(v, { finding_id: id, reason: "held", held_reason: reason });
        } else {
          /* No refutation record, and neither a hold of `refuter-entries` nor a refuter's invalid answer accounts for
           * it: step 5 was skipped for it. Refused by name, never silent. */
          // Its refuter entry's recovery, decided as that entry's own line decides it; where no refuter entry names it,
          // SKILL.md step 5's command for its record, which appends one.
          const d = input.decisions?.refutations.get(id);
          const append = input.appendRefuter?.get(id);
          const why = d
            ? ofEntry(d, "the candidate")
            : append !== undefined
              ? `no refuter entry of the launch list names it, and \`${append}\` ${APPENDS_ITS_REFUTER}`
              : input.listUnread
                ? LIST_UNREAD
                : "no refuter entry of a hooked run's launch list names it";
          refuse("refutation-missing", id, `this violation_candidate has no refutation record, and neither a hold of refuter-entries nor a refuter's invalid answer accounts for it: ${why}`, [], d);
        }
      } else {
        placeOnRefutation(id, v, item, r.record, () => malformedOf(r.source, r.index)?.map(printed));
      }
    } else if (str(v.verdict) === "needs_human") {
      item.label = "counsel";
      item.why.push(() => [WORDS.whyModel(said(str(v.reasoning)))]);
    } else if (str(v.verdict) === "not_applicable") {
      placeDismissal(id, v, item, true);
    } else {
      refuse("verdict-word", id, `the verdict is ${JSON.stringify(str(v.verdict))}, which is none of violation_candidate, not_applicable, needs_human`);
    }
    items.push(item);
  }
  for (const [id, r] of refutations) {
    if (!adjudications.has(id)) refuse("refutation-orphan", id, `the refutation ${r.source}[${r.index}] answers no adjudicator record of this run`);
  }
  /* A carried violation_candidate whose refutation its own run did not establish: the
   * row keeps why (`refutation_not_established`, written by `notEstablished`), and it is said again with the same words the
   * fresh path uses, and listed again in `refutations_not_established`. A reason this build does not know says nothing here
   * (false), and the finding is labelled as before. */
  const carriedNotEstablished = (id: string, v: Obj, item: Item): boolean => {
    const ne = obj(v.refutation_not_established) ?? {};
    const reason = str(ne.reason);
    if (reason === "unusable_answer") {
      const why = str(ne.why);
      item.why.push(() => [WORDS.whyRefutationUnusable(said(printed(why)))]);
      item.notRefutedBecause = () => WORDS.notRefutedUnusable(said(printed(why)));
    } else if (reason === "invalid_answer") {
      const seat = str(ne.seat);
      const kept = str(ne.kept);
      item.why.push(() => [WORDS.whyRefutationInvalid(markdownText(printed(seat)), code(printed(kept)))]);
      item.notRefutedBecause = () => WORDS.notRefutedInvalid(markdownText(printed(seat)), code(printed(kept)));
    } else if (reason === "held") {
      const held = str(ne.held_reason);
      item.why.push(() => [WORDS.whyRefutationHeld(said(printed(held)))]);
      item.notRefutedBecause = () => WORDS.notRefutedHeld(said(printed(held)));
    } else return false;
    item.label = "not_yet_refuted";
    refutationsNotEstablished.push({ finding_id: id, ...clone(ne) });
    return true;
  };
  /* A carried verdict is labelled as its own record stands: a violation_candidate
   * no second review answered is *not yet refuted*, and a record the check invalidated in its own run
   * says why in the check's words, as a fresh one does. */
  for (const [id, c] of carriedById) {
    const v = clone(c.record);
    const word = str(v.verdict);
    const invalidated = v.quote_check_outcome === "invalidated";
    const ref = obj(v.refutation);
    const item: Item = { verdict: v, candidate: candidateById.get(id), label: "dismissed", why: [], carriedFrom: str(v.carried_forward_from) || WORDS.carriedFromUnnamed };
    if (invalidated) {
      item.label = "counsel";
      item.why.push(() => demotedWhy(v, v, "adjudicator", candidateById.get(id), undefined));
    } else if (ref && verdictSetOf(v).missing.length === 0) {
      /* A refutation is written for a violation_candidate only, and the log
       * row's word is the merge's (`not_applicable` for an overturn, `needs_human` where the passes left it to the person): the
       * record is placed again from its own word and its refutation, by the function that placed it in its own run. A record
       * whose set is not whole (the carry does not write one; verdict-set.ts) keeps the word it was written with, below. */
      v.verdict = "violation_candidate";
      placeOnRefutation(id, v, item, ref, () => undefined);
    } else if (word === "violation_candidate" && !ref && !deferred && obj(v.refutation_not_established) && carriedNotEstablished(id, v, item)) {
      // Placed and worded as its own run left it (not yet refuted, with why).
    } else if (word === "violation_candidate") {
      item.label = ref ? "candidate" : deferred ? "no_second_check" : "not_yet_refuted";
      if (!ref && !deferred) item.notRefutedBecause = () => WORDS.notRefutedNone;
    } else if (str(obj(v.second_look)?.claim) === "not_applicable" && (word === "not_applicable" || word === "needs_human")) {
      // A ruled-out finding and its second look, placed again as its own run placed them.
      v.verdict = "not_applicable";
      placeDismissal(id, v, item, false);
    } else if (word === "needs_human") {
      item.label = "counsel";
      item.why.push(() => [WORDS.whyModel(said(str(v.reasoning)))]);
    }
    // A carried ruled-out verdict of the kind a run with
    // the second check looks at, whether or not its own run gave it a look: `ruled-out.md` counts it from this.
    if (item.label === "dismissed" && item.lookKind === undefined) {
      const role = input.ruleRoles?.get(str(item.candidate?.rule_id));
      if (dismissalClaimOf({ verdict: "not_applicable", level: str(item.candidate?.severity), ...(role ? { role } : {}), secondCheck: true }) !== null) item.lookKind = true;
    }
    items.push(item);
  }
  const countItems = (): void => {
    counts.violation_candidate = counts.not_applicable = counts.needs_human = counts.overturned = 0;
    for (const it of items) {
      const w = str(it.verdict.verdict);
      if (w === "violation_candidate") counts.violation_candidate++;
      else if (w === "not_applicable") counts.not_applicable++;
      else if (w === "needs_human") counts.needs_human++;
      if (it.label === "overturned") counts.overturned++;
    }
  };
  countItems();

  /* 9. Silent rules (step 3c and 3j), one log row each. */
  const silent = arr(findings.rules_without_candidates).map(obj).filter((r): r is Obj => !!r);
  const silentIds = new Set(silent.map((r) => str(r.rule_id)));
  const pra = obj(findings.per_rule_applicability);
  const praRules = new Map(arr(pra?.rules).map(obj).filter((r): r is Obj => !!r).map((r) => [str(r.rule_id), r]));
  const unknownRules: Obj[] = [];
  for (const rule of silent) {
    const id = str(rule.rule_id);
    const applicability = praRules.get(id);
    const setAside = pra?.settled === true && applicability?.adjudicate === false;
    const s = silences.get(id);
    if (setAside) {
      if (s) refuse("silence-unexpected", id, "a silence record was written for a rule the declaration set aside (step 3j sends it to no investigator)");
      unknownRules.push({ rule_id: id, outcome: "out_of_jurisdiction", ...(str(applicability?.settled_premise) ? { note: str(applicability?.settled_premise) } : {}) });
    } else if (str(rule.state) === "not-evaluated") {
      if (s) refuse("silence-unexpected", id, "a silence record was written for a rule the scan did not evaluate");
      const why = arr(rule.unmet_preconditions).map(str).filter(Boolean).join("; ");
      unknownRules.push({ rule_id: id, outcome: "not_evaluated", ...(why ? { note: why } : {}) });
    } else if (s) {
      unknownRules.push(silenceRow(id, s.record));
    } else {
      const notJudged = notJudgedSets?.silences.get(id);
      const note = notJudged?.why !== undefined ? WORDS.silenceUnusableNote(markdownText(notJudged.why)) : notJudged ? WORDS.silenceInvalidNote(markdownText(notJudged.seat), markdownText(notJudged.kept)) : null;
      unknownRules.push({ rule_id: id, outcome: "not_checked", ...(note !== null ? { note } : {}) });
    }
  }
  for (const id of silences.keys()) {
    if (!silentIds.has(id)) refuse("silence-orphan", id, "a silence record names a rule that is not in findings.json's rules_without_candidates");
  }

  /* 10. The arithmetic a reader uses to tell a partial run from a complete one (SKILL.md step 7). */
  const verdicts = items.map((it) => it.verdict).sort((a, b) => (str(a.finding_id) < str(b.finding_id) ? -1 : 1));
  const candidatesTotal = candidates.length;
  if (refusals.length === 0 && verdicts.length + unadjudicated.length + preSettled.length + suppressions.length !== candidatesTotal) {
    /* Named by record: which entry is for no candidate, which candidate is
     * accounted for twice, which by nothing, and the file each entry came from. */
    const sum = `${verdicts.length} verdicts + ${unadjudicated.length} unadjudicated + ${preSettled.length} pre-settled${suppressions.length > 0 ? ` + ${suppressions.length} suppressed by the scanner` : ""} is not candidates_total ${candidatesTotal}`;
    const whence = (id: string): string => {
      const q = adjudications.get(id);
      if (q) return `the verdict ${q.source}[${q.index}]`;
      const c = carriedById.get(id);
      if (c) return `the carried verdict ${c.source}[${c.index}]`;
      if (preSettledIds.has(id)) return "the plan's pre_settled";
      if (suppressions.some((r) => str(r.finding_id) === id)) return "suppressions[]";
      return "unadjudicated[]";
    };
    const times = new Map<string, number>();
    for (const r of [...verdicts, ...unadjudicated, ...preSettled, ...suppressions]) times.set(str(r.finding_id), (times.get(str(r.finding_id)) ?? 0) + 1);
    const named: Refusal[] = [];
    for (const [id, n] of times) {
      if (!candidateById.has(id)) named.push({ kind: "arithmetic", id: id || "-", problem: `${whence(id)} is for no candidate of findings.json: ${sum}` });
      else if (n > 1) named.push({ kind: "arithmetic", id, problem: `this candidate is accounted for ${n} times: ${sum}` });
    }
    for (const id of candidateById.keys()) {
      if (!times.has(id)) named.push({ kind: "arithmetic", id, problem: `no verdict, unadjudicated entry, pre-settled record or suppression accounts for this candidate: ${sum}` });
    }
    if (named.length === 0) refuse("arithmetic", "-", sum);
    else refusals.push(...named);
  }

  const resultCounts = {
    candidates_total: candidatesTotal,
    verdicts: verdicts.length,
    ...counts,
    carried: carriedById.size,
    pre_settled: preSettled.length,
    unadjudicated: unadjudicated.length,
    unknown_rules: unknownRules.length,
    suppressed: suppressions.length,
  };
  if (refusals.length > 0) return { refusals, log: null, report: null, counts: resultCounts };

  /* 11. The log (SKILL.md step 7), every list copied, nothing re-derived. */
  const layer2 = (row: unknown) => ({ ...(obj(row) ?? {}), layer2_outcome: "not_checked" });
  const runShape: Obj = {
    shape,
    chosen_by: chosenBy,
    preview: clone(preLaunch?.preview),
    launches_run: input.launchesRun,
    ...(deferred ? { refutation_deferred: true } : {}),
  };
  const log: Obj = {
    scan_id: str(findings.scan_id),
    bundle: clone(findings.bundle),
    candidates_total: candidatesTotal,
    unknown_rules: unknownRules,
    run_shape: runShape,
    unadjudicated,
    verdicts,
    ...(refutationsNotEstablished.length > 0 ? { refutations_not_established: refutationsNotEstablished } : {}),
    coverage_limits: arr(obj(findings.coverage_limits)?.limits).map(layer2),
    files_not_read: arr(findings.files_not_read).map(layer2),
    files_partially_read: arr(findings.files_partially_read).map(layer2),
    pre_settled: clone(preSettled),
    ...(suppressions.length > 0 ? { suppressions } : {}),
    ...(() => {
      // Build unit F4: every candidate of this run's verdicts read by the place plan, with its counts and its table.
      const rows = [...(input.placeTables ?? new Map<string, PlacesRead>())].filter(([id]) => adjudications.has(id)).sort((x, y) => (x[0] < y[0] ? -1 : 1));
      return rows.length > 0 ? { places_read: rows.map(([id, p]) => placesReadRow(id, p)) } : {};
    })(),
    ...(input.modelOverrides && input.modelOverrides.length > 0 ? { model_overrides: input.modelOverrides.map((o) => ({ ...o })) } : {}),
    ...(input.agentModel ? { agent_model: input.agentModel } : {}),
    ...(input.agentEffort ? { agent_effort: input.agentEffort } : {}),
    // Whose answers about the product the scan used, from its declaration plan (design rf11 3.3).
    ...((u) => (u === null ? {} : { answers_used: u }))(answersUsedOf(input.declarationPlan ?? null)),
    // Which state folder was used, and whether it is the account-home default.
    ...(input.stateFolder ? { state_folder: { path: input.stateFolder.path, account_default: input.stateFolder.account_default } } : {}),
    completed_at: input.completedAt,
    disclaimer: WORDS.disclaimer,
  };

  /* 12. SKILL.md STEP 7'S RE-CHECK OVER THE LOG, RUN BY THE PROGRAM (O7; the parent's correction 2). The check
   * `verdict-verify --target <tree> --log <the log>` runs, over the log as it will be written, and its outcomes go into
   * what is assembled exactly as the check leaves them: every holder it checked (a verdict, its refutation, a silence
   * row) takes the check's annotations and any word it demoted, with the word kept beside it; a demotion the first
   * check had not made relabels the item as step 5a would (counsel, with the check's reason). A quotation's outcome
   * never refuses the assembly: only a re-check that cannot run does. */
  let recheck: RecheckCounts | undefined;
  if (input.recheck) {
    // Over the log as it will be written: redacted (13 below), so the check reads the markers the file will carry.
    const written = redaction ? clone(log) : log;
    if (redaction) redactStringsInPlace(redaction, written);
    const re = input.recheck(written);
    if ("problem" in re) {
      refuse("log-recheck", "-", `step 7's re-check over the log could not run: ${re.problem}`);
      return { refusals, log: null, report: null, counts: resultCounts };
    }
    recheck = applyRecheck(re.report, { verdicts, unknownRules, items, silences, looks });
    countItems();
    Object.assign(resultCounts, counts);
  }

  /* 12c. SEVERITY COMPOSED AT THE PLACE. From the run's records only, as the check above left
   * them: the per-place tables, and for a candidate with none, its verdict where it stands (not dismissed or
   * overturned). A record the quote check invalidated gives no fact on either path, its table's rows included (F1).
   * A finding is raised, never lowered; the rule's own level stays beside the raised one. The entries are the log's
   * `severity_raised[]` and the items' `raise`, one object each, so step 13's redaction reaches both. */
  const holding = new Set(["candidate", "not_yet_refuted", "no_second_check", "counsel"]);
  const verdictHeld = new Set(
    items
      .filter((it) => !input.placeRows?.has(str(it.verdict.finding_id)) && holding.has(it.label) && it.verdict.quote_check_outcome !== "invalidated")
      .map((it) => str(it.verdict.finding_id)),
  );
  const invalidatedRecords = new Set(items.filter((it) => it.verdict.quote_check_outcome === "invalidated").map((it) => str(it.verdict.finding_id)));
  const composeInput = {
    candidates: candidates as unknown as CandidateIn[],
    rows: input.placeRows ?? new Map(),
    verdictHeld,
    invalidated: invalidatedRecords,
    ownInstance: input.ownDomainEndpoints === "own_instance",
  };
  const raises = composeSeverities(composeInput);
  const transportAt = transportWordsAt(composeInput);
  for (const it of items) {
    const id = str(it.verdict.finding_id);
    const r = raises.get(id);
    if (r) it.raise = r;
    // The words of the transport the line speaks of, from the place itself, never a fixed sentence.
    const at = r?.plaintext
      ? { id: r.plaintext.finding_id, file: r.file, line: r.plaintext.line ?? r.line }
      : PLAINTEXT_RULES.has(str(it.candidate?.rule_id))
        ? (() => {
            const row = ((input.placeRows?.get(id) ?? []) as readonly PlaceRowIn[]).find((x) => KEPT_DECISIONS.has(str(x.decision)));
            const loc = obj(arr(it.candidate?.locations)[0]);
            return row ? { id, file: row.file, line: row.line } : loc ? { id, file: str(loc.file), line: Number(loc.start_line) } : null;
          })()
        : null;
    const words = at ? transportAt(at.id, at.file, at.line) : null;
    if (words) it.transport = words;
  }
  /* 12d. THE ORDER BY WEIGHT. Each finding that
   * stands takes its order from its record's `standing` block (fix-order.ts), the program's tier table (`tierOf`) and the
   * person's answers (the profile, never the code). A `duty_unmet` finding of group 0 whose parts that stood put it at O1
   * or O2 is raised to high (D1 = B), recorded beside the transport raises with basis `standing`: never lowered, never a
   * finding waiting on an answer, never on a part the review did not establish. */
  const praOrder = obj(findings.per_rule_applicability);
  const declaredRegions = praOrder && Array.isArray(praOrder.declared_regions) ? arr(praOrder.declared_regions).map(str) : null;
  const regionsOut = praOrder && Array.isArray(praOrder.regions_not_offered) ? arr(praOrder.regions_not_offered).map(str) : undefined;
  const answers = orderAnswersOf(input.profile ?? null);
  const answered = answeredQuestionsOf(input.profile ?? null);
  const weightRaises: SeverityRaise[] = [];
  // The second look's outcome per finding, from its record and its entry, before any
  // disposition is taken; a test's injection is laid over it.
  const dctx = dispositionContextOf(findings, { ...input, secondLooks: new Map([...looks].map(([id, l]) => [id, l.outcome] as const)) });
  for (const it of items) {
    const look = looks.get(str(it.verdict.finding_id));
    if (look) it.secondLook = look;
    if (!holding.has(it.label)) {
      // A "not applicable" answer (dismissed, or overturned by a second review): row 2.
      it.disp = dispositionOf({ verdict: "not_applicable" });
      // A location overturn due a second look that none answered keeps its row and says so.
      // Whichever review's claim the look checks: a standing location overturn is never shown settled with no look answered.
      if (it.lookOn !== undefined && !it.secondLook) it.secondLook = { outcome: "not_answered", due: true };
      continue;
    }
    const rule = str(it.candidate?.rule_id);
    const bases = input.ruleBases?.get(rule);
    // The rule's `duty_about` from the map the disposition reads (one
    // source): a not-shipped `ships` lowers the order only where it is `product_runtime`.
    const dutyAbout = dctx.duties?.get(rule);
    const oi: StandingOrderInput = { verdict: it.verdict, candidate: it.candidate, declaredRegions, answers, answered, ...(bases ? { ruleBases: bases } : {}), ...(regionsOut ? { regionsOut } : {}), ...(input.tierOf ? { tierOf: input.tierOf } : {}), ...(dutyAbout ? { dutyAbout } : {}) };
    const o = standingOrderOf(oi);
    it.order = o;
    it.orderInput = oi;
    // The disposition, from the record, the candidate and the program's facts.
    const rowsHere = (input.placeRows?.get(str(it.verdict.finding_id)) ?? []) as readonly PlaceRowIn[];
    const dIn = dispositionInputOf(it, dctx, rowsHere);
    /* Asked again here with what only the assembly knows (a
     * raise, the kept places): a finding of any shape due a second look that no entry was appended for (raised to
     * high only here, read place by place, or its record never examined) keeps its placement and is marked as not answered,
     * never shown as settled on the first review's word alone. The fold (12e)
     * runs after this, on each finding's own placement, and never folds a finding under a lighter head (fold-findings.ts
     * guard 2): the claim is asked of the finding as placed on its own, and a folded finding keeps its mark. */
    if (!it.secondLook) {
      if (firstReviewClaimOf(it, dctx, rowsHere, it.raise?.severity ?? str(it.candidate?.severity), dIn) !== null) {
        it.secondLook = { outcome: "not_answered", due: true };
        dIn.secondLook = "not_answered";
      }
    }
    it.disp = dispositionOf(dIn);
    const ruleLevel = str(it.candidate?.severity);
    // D1 = B: a raise by weight only for a finding to fix (design section 2.2), on the parts that stood.
    if (!countsAsProblem(it.disp.disposition) || !raisedByWeight(o) || (it.raise?.severity ?? ruleLevel) === "high" || (ruleLevel !== "medium" && ruleLevel !== "low")) continue;
    const at = decisivePlaceOf(it.verdict, (input.placeRows?.get(str(it.verdict.finding_id)) ?? []) as readonly PlaceRowIn[], it.candidate);
    const r: SeverityRaise = {
      finding_id: str(it.verdict.finding_id),
      rule_id: rule,
      rule_severity: ruleLevel,
      severity: "high",
      basis: "standing",
      file: at?.file ?? "",
      line: Math.max(1, at?.line ?? 1),
      // The parts as they stood: one the review did not establish is recorded
      // as not established (no data, `not_established`), never as the heaviest value the order placed it at.
      data: o.heaviest.includes("data") ? [] : [...o.data],
      standing: { order_tier: o.standingTier as "O1" | "O2", duty: o.topBasis ? [o.topBasis.cite] : [], data: o.heaviest.includes("data") ? [] : [...o.data], people: [...o.people], runs: o.heaviest.includes("runs") ? "not_established" : o.runs, reaches: o.heaviest.includes("reaches") ? "not_established" : o.reaches, ships: o.ships },
      // A raise the duty's tier alone carries says so, naming no other part.
      because: inertTrim(raisedOnDutyAlone(o)
        ? WORDS.raisedByDutyAlone(markdownText(ruleLevel), o.topBasis ? WORDS.raiseUnder(programText(o.topBasis.regime || citationOf(o.topBasis.cite)), o.topBasis) : ours(""), standingRunsWords(o))
        : WORDS.raisedByWeight(markdownText(ruleLevel), standingDataWords(o), standingPeopleWords(o, answers), standingRunsWords(o), o.topBasis ? WORDS.raiseUnder(programText(o.topBasis.regime || citationOf(o.topBasis.cite)), o.topBasis) : ours(""))
      ),
    };
    // A transport raise this one replaces keeps its words in details.md.
    if (it.raise) it.raisedAlso = it.raise;
    it.raise = r;
    weightRaises.push(r);
  }
  /* 12e. THE FOLD. Once, after every finding has
   * its own disposition and its own level: a finding of one rule whose places only document a feature another finding of
   * that rule shows in what ships, or whose review traced it to another's kept place, is counted once, in that head, and
   * listed under it. A raise by weight the finding took as a finding to fix on its own stays its own, and the head takes
   * its level (the head's level is the highest of its members', never lowered). */
  const placeRowsOf = (it: Item): readonly PlaceRowIn[] => (input.placeRows?.get(str(it.verdict.finding_id)) ?? []) as readonly PlaceRowIn[];
  const fold = foldFindings(items.map((it) => foldEntryOf(it, holding.has(it.label), dctx, placeRowsOf(it))));
  for (const it of items) {
    const id = str(it.verdict.finding_id);
    const f = fold.folded.get(id);
    if (f) {
      it.foldedUnder = f.head;
      it.foldedBecause = f;
      it.disp = dispositionOf(dispositionInputOf(it, dctx, placeRowsOf(it)));
    }
    const level = fold.levelOf.get(id);
    if (level) it.foldLevel = level;
  }
  const shownRaises = new Map<string, SeverityRaise>(raises);
  for (const r of weightRaises) shownRaises.set(r.finding_id, r);
  const loggedRaises = [...raises.values(), ...weightRaises];
  if (loggedRaises.length > 0) log.severity_raised = loggedRaises.sort((x, y) => (x.finding_id < y.finding_id ? -1 : x.finding_id > y.finding_id ? 1 : x.basis < y.basis ? -1 : 1)) as unknown as Obj[];
  // The evidence log's `standing[]` and `questions_raised[]` (design section 6.6 row 1): what the order was computed from,
  // and the questions the report shows, which `scan --review-declaration` plans from the next run (section 9 item 1).
  const standingRows = items.filter((it) => it.order).map((it) => standingLogRow(it));
  if (standingRows.length > 0) log.standing = standingRows;
  /* The disposition each verdict took, written into the
   * log's copy of the verdict (never by a seat), from the same call every presenter reads; and the facts seats named in
   * words because no question carries them, for the maker to grow the question set from. */
  /* THE SET IN THE LOG. Each verdict row keeps the second look its placement
   * rests on (verdict.schema.json `second_look`), as it keeps its refutation, so a later run that carries the row carries the
   * whole set (verdict-set.ts); a finding due a second look that none answered says so (`not_answered`), and a later run
   * judges it again rather than carry it without one. Written on every run, so a carried copy's earlier one is replaced. */
  for (const it of items) {
    const l = it.secondLook;
    if (!l) {
      delete it.verdict.second_look;
      continue;
    }
    const nested = l.outcome !== "not_answered" && l.record ? secondLookObject(l.record, l.model) : { outcome: l.outcome };
    // Written only here: the claim the look checked, where a standing location overturn made it due (`lookOn`).
    delete nested.claim;
    if (it.lookOn !== undefined && l.outcome !== "not_answered" && l.record) nested.claim = it.lookOn;
    it.verdict.second_look = nested;
    // The lines `details.md` makes from the look read the log's copy, which step 13 redacts with the rest of the log.
    if (l.record && l.outcome !== "not_answered") l.record = nested;
  }
  for (const it of items) {
    if (!it.disp) continue;
    it.verdict.disposition = it.disp.disposition;
    // The head a folded finding is counted with, beside its disposition;
    // computed again on every run like `disposition`, so a carried copy's earlier head is never kept.
    if (it.disp.disposition === "folded" && it.foldedUnder) it.verdict.folded_under = it.foldedUnder;
    else delete it.verdict.folded_under;
  }
  /* THE COMPARISON IN THE LOG: this run's basis (each finding's list, level and place count,
   * from the same dispositions every presenter reads), and on a later run each finding's change against the earlier log's
   * basis, the gone rows and the still-gone rows carried forward (comparison.ts). */
  {
    const basis = new Map<string, BasisRow>();
    /* When the review each verdict stands on was made, so that changes.md can
     * date every carried verdict and the next run can carry the date on: this run's completion time for a verdict read
     * in it; for a carried one, what the log it was carried from records (comparison.ts `reviewedOfEarlier`), and null
     * where that log is not the one read for the comparison or does not say. */
    const earlierLog = input.earlier ?? null;
    const reviewedAt = (it: Item, id: string): string | null => {
      const from = str(it.verdict.carried_forward_from);
      if (!from) return input.completedAt;
      if (earlierLog === null || from !== earlierLog.label) return null;
      return reviewedOfEarlier(earlierLog, str(obj(it.verdict.carried_forward)?.finding_id) || id);
    };
    for (const it of items) {
      const id = str(it.verdict.finding_id);
      if (!it.disp || !id || basis.has(id)) continue;
      const loc = obj(arr(it.candidate?.locations)[0]);
      const level = levelOfItem(it);
      basis.set(id, {
        finding_id: id,
        rule_id: str(it.candidate?.rule_id),
        disposition: it.disp.disposition,
        level: level || null,
        places: arr(it.candidate?.locations).length,
        file: str(loc?.file) || null,
        line: Number.isInteger(loc?.start_line) ? (loc?.start_line as number) : null,
        place_keys: placeSetOf(keyedLocationsOf(it.candidate)),
        reviewed_at: reviewedAt(it, id),
      });
    }
    const candidateOf = new Map(arr(findings.candidates).map(obj).filter((c): c is Obj => !!c && !!str(c.finding_id)).map((c) => [str(c.finding_id), c] as const));
    for (const p of arr(preSettled).map(obj)) {
      const id = str(p?.finding_id);
      if (!id || basis.has(id)) continue;
      const c = candidateOf.get(id);
      const loc = obj(arr(c?.locations)[0]);
      basis.set(id, {
        finding_id: id,
        rule_id: str(p?.rule_id) || str(c?.rule_id),
        disposition: "settled_by_answer",
        level: str(c?.severity) || null,
        places: Number.isInteger(p?.locations) ? (p?.locations as number) : arr(c?.locations).length,
        place_keys: placeSetOf(keyedLocationsOf(c)),
        file: str(loc?.file) || null,
        line: Number.isInteger(loc?.start_line) ? (loc?.start_line as number) : null,
      });
    }
    log.comparison = comparisonOf({ basis: [...basis.values()], plan: input.plan, earlier: input.earlier ?? null, raised: new Set(candidateOf.keys()), completedAt: input.completedAt });
  }
  const facts = items
    .filter((it) => it.disp?.disposition === "question" && factOf(it))
    .map((it) => ({ finding_id: str(it.verdict.finding_id), rule_id: str(it.candidate?.rule_id), ...(factOf(it) as { words: string; about: string }) }));
  if (facts.length > 0) log.facts_named_in_words = facts;
  // Every second look of the run, with what it returned (evidence-log.schema.json `challenges`).
  const challengeRows = items
    .filter((it) => it.secondLook)
    .map((it) => {
      const l = it.secondLook as NonNullable<Item["secondLook"]>;
      const grounds = l.outcome === "overturned" ? str(l.record?.grounds) : "";
      return { finding_id: str(it.verdict.finding_id), outcome: l.outcome, ...(grounds ? { grounds } : {}) };
    })
    .sort((x, y) => (x.finding_id < y.finding_id ? -1 : x.finding_id > y.finding_id ? 1 : 0));
  if (challengeRows.length > 0) log.challenges = challengeRows;
  const questions = questionSlotsOf(items, input.profile ?? null);
  // The log's `questions_raised[]` keeps the two kinds it has always held: a question of the program's list findings wait on,
  // and a product question that moves the order. A fact in words is in `facts_named_in_words[]`; "check your answer" is the
  // person's own answer, already recorded in the profile.
  const logged = questions.filter((q) => q.kind === "waits_on_answer" || q.kind === "order_moving");
  if (logged.length > 0) log.questions_raised = logged.map((q) => ({ question: q.question, header: q.header, kind: q.kind, finding_ids: q.findingIds, rules: q.rules }));
  // The data of connection places that rest on no line the seat named apart from the connection, set
  // aside by the composition (the places stay held), each with why.
  const aside = dataSetAside(composeInput);
  if (aside.length > 0) log.data_set_aside = aside as unknown as Obj[];

  /* 13. ONE REDACTION AT THE WRITERS, BEFORE ANY LINE IS MADE
   * Every string the log holds and every silence record goes through `redactPrintedText` with `baseline-002`'s
   * own clauses, in place, each row on its own - so a clause anchored at a line's start reads the row as its writer
   * wrote it - and only then is a line of the report made from them: the "why" lines (made here, by the functions each
   * item keeps, from the redacted records), the "classification not confirmed" lines (12b below) and the report itself.
   * A line composed first and redacted after is where a value slipped through: inside a composed line a quotation no
   * longer starts its line, and `API_TOKEN=<value>` was printed under the note that says it is not.
   * What a line takes from outside the log - a launch list's hold reason, a check's shape problems - is redacted
   * on its own the same way (`printed`). The report as a whole is passed through the rule again below, for what it
   * prints from elsewhere (the scan document). A value the rule recognises is written nowhere: the file and line stay,
   * and the marker stands where the value was. Nothing is counted or decided from a redacted string: every verdict,
   * count and check above is taken first. */
  /* THE VALUES, BEFORE ANY LINE IS COMPOSED OR CUT, IN ALL FIVE FILES. The report cuts
   * values to a width in many places (`oneLine` at 120 to 4,000 characters, a place's short "why" at 170 on the first
   * screen, a citation at its first separator): a credential the cut splits is no longer recognised by its clause, and
   * a redaction of the finished file printed its first characters (19 of 20 of a key id on the first screen). So every
   * value `buildReportFiles` reads is redacted here, as a value: the log and the silence records (above, in place), the
   * scan document, the plan and the check's summary (this run's copies), the rows the log does not hold, and copies of
   * what the caller passed in (the per-place tables and their rows, the seats whose answers stayed invalid, the model
   * overrides, the short names, the log's path). The pass over the five finished files below stays, as a second net.
   * ONE PATH, ONE RULE: this is the only values-first pass. An earlier version
   * had built the same pass for the old single report (the scan document, the plan, the rows, the raises); this one
   * holds all of it and more. The rule is always the CLI's own copy of baseline-002 (`productPrintedRedaction`, set by
   * `assembleOnce`), never a bundle's, so no bundle can turn the redaction off or change it. */
  const copyRedacted = <T>(v: T): T => {
    const c = clone(v);
    if (redaction) redactStringsInPlace(redaction, c);
    return c;
  };
  const mapRedacted = <K, V>(mm: ReadonlyMap<K, V> | undefined): Map<K, V> | undefined => (mm ? new Map([...mm].map(([k, v]) => [k, copyRedacted(v)] as const)) : undefined);
  let reportRows = input.placeRows;
  let reportNotJudged = notJudgedSets;
  let reportOverrides = input.modelOverrides;
  let reportNames = input.shortNames;
  if (redaction) {
    redactStringsInPlace(redaction, log);
    for (const s of silences.values()) redactStringsInPlace(redaction, s);
    redactStringsInPlace(redaction, findings);
    redactStringsInPlace(redaction, plan);
    redactStringsInPlace(redaction, summary);
    for (const rows of [unadjudicated, suppressions, unknownRules, preSettled, refutationsNotEstablished]) redactStringsInPlace(redaction, rows);
    for (const r of raises.values()) redactStringsInPlace(redaction, r);
    for (const r of weightRaises) redactStringsInPlace(redaction, r);
    for (const it of items) if (it.placeRead) it.placeRead = { ...it.placeRead, summary: copyRedacted(it.placeRead.summary), path: printed(it.placeRead.path) };
    reportRows = mapRedacted(input.placeRows);
    reportNotJudged = notJudgedSets && {
      findings: mapRedacted(notJudgedSets.findings) ?? new Map(),
      refutations: mapRedacted(notJudgedSets.refutations) ?? new Map(),
      silences: mapRedacted(notJudgedSets.silences) ?? new Map(),
    };
    reportOverrides = input.modelOverrides && copyRedacted([...input.modelOverrides]);
    reportNames = input.shortNames && new Map([...input.shortNames].map(([k, v]) => [k, printed(v)] as const));
  }
  for (const it of items) it.whyLines = it.why.flatMap((make) => make());

  /* 12b. LOCATIONS WHOSE DISMISSAL THE CHECK WITHDREW, made from the
   * rows step 13 has just redacted. A failed row that dismissed a location other than the ones the conclusion stands on,
   * on a record that keeps its finding, withdrew only that dismissal (`quote_check_failures[].effect`, written by
   * `verdict-verify`, after step 7's re-check). Each such location is reported as "classification not confirmed", never
   * as cleared: in the report as one line per group (the count, the covering row, the quotation that failed), and in the
   * log with every location. A group is one census kind (the failed trail row's kind, or the kind of the trail row an
   * `item` entry pairs with), and it holds every member of that kind except the locations other rows of the same record
   * opened and the check confirmed: a cover row settles members by count, not by name, so a member nobody can place
   * under another representative is shown, not cleared.
   * ONE PLACE FOR EVERY RECORD. The lines are gathered here from every record that can hold a withdrawn
   * dismissal - an adjudicator's record and its refutation, fresh or carried - whatever the record's label, and the
   * report prints them together under WHAT WAS NOT ESTABLISHED, each naming its record and where the report shows it.
   * They used to be printed inside the item's block in the findings section only, so the withdrawn locations of a
   * record a refuter overturned were in the log and nowhere in the report. A silence
   * investigator's record never holds one: its reply has no reading trail (`silence-reply.schema.json` is closed and
   * names no `reading`, and the log's silence row keeps none), so no row of it dismisses another location. */
  const unconfirmed: Obj[] = [];
  const unconfirmedLines: Inert[] = [];
  for (const it of items) {
    const c = it.candidate ?? {};
    const record = WORDS.unconfirmedRecord(markdownText(str(c.rule_id)), code(str(it.verdict.finding_id)), WORDS.unconfirmedStanding(markdownText(overturnedOnGate(it) ? "overturned_on_gate" : overturnedUnquoted(summary, it) ? "overturned_unquoted" : it.label)));
    const holders: [Obj | undefined, "adjudicator" | "refuter"][] = [[it.verdict, "adjudicator"], [obj(it.verdict.refutation), "refuter"]];
    for (const [holder, seat] of holders) {
      if (!holder) continue;
      const withdrawn = arr(holder.quote_check_failures).map(obj).filter((f): f is Obj => !!f && str(f.effect) === "withdraws_dismissal");
      if (withdrawn.length === 0) continue;
      const read = arr(obj(holder.reading)?.read).map(obj);
      const groups = new Map<string, Obj[]>();
      for (const f of withdrawn) {
        const key = str(f.kind) ? `k${str(f.kind)}` : `l${str(f.file)}:${str(f.lines)}`;
        groups.set(key, [...(groups.get(key) ?? []), f]);
      }
      for (const rows of groups.values()) {
        const trail = rows.find((f) => str(f.row).startsWith("reading.")) ?? rows[0];
        const rowIndex = Number((str(trail.row).match(/\[(\d+)\]$/) ?? [])[1] ?? -1);
        const quoted = str(trail.row).startsWith("reading.") ? read[rowIndex] : obj(arr(holder.evidence)[rowIndex]);
        const kind = str(trail.kind);
        const locs = arr(c.locations).map(obj);
        const withdrawnRows = new Set(rows.map((f) => str(f.row)));
        const confirmedElsewhere = new Set(
          read
            .map((r, j) => ({ r, j }))
            .filter(({ r, j }) => !!r && str(r.kind) === kind && !withdrawnRows.has(`reading.read[${j}]`) && !arr(holder.quote_check_failures).map(obj).some((f) => f && str(f.row) === `reading.read[${j}]`))
            .map(({ r }) => `${str(r?.file)}:${Number(str(r?.lines).split("-")[0])}`),
        );
        // A member is an index into the candidate's `locations` (the census as the scan writes it) or a location itself.
        let members: unknown[] = [];
        if (isUnitId(kind)) members = [placeIndexOf(placeOfUnit(kind)) ?? -1];
        else if (/^\d+$/.test(kind)) members = arr(obj(arr(obj(c.kinds)?.groups)[Number(kind)])?.members);
        let locations = members
          .map((m) => (typeof m === "number" ? locs[m] : obj(m)))
          .filter((l): l is Obj => !!l)
          .map((l) => ({ file: str(l.file), line: Number(l.start_line) }))
          .filter((l) => !confirmedElsewhere.has(`${l.file}:${l.line}`));
        if (locations.length === 0) locations = [{ file: str(trail.file), line: Number(str(trail.lines).split("-")[0]) }];
        const place = `${str(trail.file)}:${str(trail.lines)}`;
        const reason = str(trail.reason);
        const fw = WORDS.failureWords;
        const said = reason === "other_file" ? fw.other_file(code(str(trail.found_in))) : (fw as Record<string, unknown>)[reason];
        const text = oneLine(str(quoted?.quote), 120);
        unconfirmed.push({
          finding_id: str(it.verdict.finding_id),
          rule_id: str(c.rule_id),
          seat,
          rows: rows.map((f) => str(f.row)),
          file: str(trail.file),
          lines: str(trail.lines),
          ...(kind ? { kind } : {}),
          reason,
          locations,
        });
        unconfirmedLines.push(
          WORDS.unconfirmedGroup(
            locations.length,
            WORDS.unconfirmedKind(code(place), locations.length - 1),
            record,
            seat === "adjudicator" ? WORDS.unconfirmedFirst : WORDS.unconfirmedSecond,
            code(text),
            code(place),
            typeof said === "string" ? programText(said) : markdownText(reason),
          ),
        );
      }
    }
  }
  if (redaction) redactStringsInPlace(redaction, unconfirmed);
  if (unconfirmed.length > 0) log.unconfirmed_classifications = unconfirmed;
  /* The places each finding's record says no review read, for the report and the terminal summary. */
  const notCheckedFindings: NotCheckedFinding[] = [];
  const previousPlaces = new Map(
    arr(plan.rows)
      .map(obj)
      .filter((r): r is Obj => !!r && !!obj(r.previous_not_checked))
      .map((r) => [str(r.finding_id), obj(r.previous_not_checked) as Obj] as const),
  );
  for (const it of items) {
    it.notChecked = notCheckedOf(it.candidate, obj(it.verdict.reading));
    const previous = previousPlaces.get(str(it.verdict.finding_id));
    if (previous && !it.carriedFrom) it.readAgain = readAgainOf(it.candidate, it.verdict, previous);
    if (!it.notChecked) continue;
    notCheckedFindings.push({
      finding_id: str(it.verdict.finding_id),
      rule_id: str(it.candidate?.rule_id),
      places: it.notChecked.places,
      files: it.notChecked.files.map((f) => printed(f.file)),
      not_applicable: it.label === "dismissed" || it.label === "overturned",
    });
  }
  const readAgainTotal = readAgainTotalOf(plan, items);
  const reportArgs: ReportArgs = { declarationPlan: input.declarationPlan ?? null, declarationPlanNotTaken: input.declarationPlanNotTaken ?? null, logPath: input.logPath === undefined ? undefined : printed(input.logPath), unconfirmed: unconfirmedLines, findings, plan, items, preSettled, unknownRules, silences, unadjudicated, suppressions, summary, shape: shape as string, chosenBy: chosenBy as string, deferred, candidates, silent, notJudged: reportNotJudged, ledgerChecked: input.ledgerChecked, modelOverrides: reportOverrides, raises: shownRaises, questions, profile: input.profile ?? null, placeRows: reportRows, shortNames: reportNames, ruleLines: input.ruleLines, comparison: obj(log.comparison) ?? null, ruleBases: input.ruleBases, reportName: input.reportName, reportPlace: input.reportPlace, numbering: input.numbering, ...(redaction ? { printed: (t: string) => redactPrintedText(redaction, t) } : {}) };
  /* ONE MODEL, ONE COUNT: the report's files and
   * the end of the run's screen are made from the same model, so their counts come from one computation of the
   * dispositions (one real re-scan printed "19 to fix first" on the screen against "21" in report.md). */
  const model = reportModel(reportArgs);
  if (!model.files) model.files = fileModelOf(model);
  const listedRows = listedRowsOf(model);
  /* DECISIONS ARE AN OVERLAY AFTER COUNTS (design rf11 3.4): every count above (the
   * model's `counts`, `resultCounts`, the log) is made; only now is the person's record read, and it changes which list
   * a finding is shown in, never a number. test:assemble-report holds the counts and the log equal with and without it. */
  if (input.personDecisions) model.decisions = decisionViewOf(input.personDecisions(), listedRows, input.completedAt.slice(0, 10));
  const built = buildReportFiles(reportArgs, model);
  // The end of the run's screen, from the same model the report is built from (the mock-up's screen 10).
  const end = endSummaryOf(model, redaction ? (t: string) => redactPrintedText(redaction, t) : (t: string) => t);
  /* Step 13's printed redaction over every file the person reads, every new string included (the place rows'
   * `why` on the first screen, the review's reasoning in details.md). A file that carries a marker says so under its
   * title; where only the log carries one, details.md (the evidence) says it. */
  const report = { ...built };
  if (redaction) {
    const MARK = "[redacted:baseline-002#";
    /* The second net reads each file's composed lines before the wrap
     * (`composedNet`, buildReportFiles); this pass over the finished files stays as the net under it, for any line composed
     * outside the builders. A value the first net hid begins with its marker, which clause 18 never reads as a value, so
     * this pass no longer takes the rest of a wrapped row. */
    for (const name of Object.keys(report)) report[name] = inertRedacted((report[name] ?? ours("")), (t) => redactPrintedText(redaction, t));
    const marked = Object.keys(report).filter((name) => (report[name] as string).includes(MARK));
    const noted = marked.length > 0 ? marked : JSON.stringify(log).includes(MARK) ? ["report.md"] : [];
    for (const name of noted) {
      const lines = inertLines((report[name] ?? ours("")));
      /* A finding's card is its fixed fields only (mocks M3, M3a; design 3.1.1):
       * the note opens the first section under the card, where a marker on the card is explained before anything else. */
      const under = name.startsWith("findings/") ? lines.findIndex((l, i) => i > 0 && /^## /.test(l)) : -1;
      /* report.md's first screen keeps to its 45 rows: one
       * line under the title points to the full note, which opens the file's own "About this report" section. */
      const about = name === "report.md" ? lines.indexOf(md`## ${WORDS.identityHeading}`) : -1;
      if (about > 0) {
        lines.splice(about + 2, 0, WORDS.redactionNote, ours(""));
        lines.splice(2, 0, WORDS.redactionPointer(markdownText(anchorOfHeading(WORDS.identityHeading)), marked.length === 0), ours(""));
      } else if (under > 0) lines.splice(under + 2, 0, WORDS.redactionNote, ours(""));
      else lines.splice(2, 0, WORDS.redactionNote, ours(""));
      report[name] = inertJoin(lines, ours("\n"));
    }
    // The markers and the note reach the files after the one form pass, so every file passes through it again (design 3.1.1 rule 3).
    for (const name of Object.keys(report)) report[name] = formMarkdown(inertLines((report[name] ?? ours(""))));
  }
  /* THE DEEPER CHECKS' SECTIONS, last, on the finished files: `deepen` writes a
   * check's section into the finished file of the report that is then the latest (deepen.ts withCheckSection), so the
   * section is added here to the finished text by the same function, and a later `deepen` step or `decide`'s re-render
   * finds the file as it would have written it. The record's values pass the values-first net, each line the second. */
  if (input.deeperChecks && model.files) {
    const deep = input.deeperChecks;
    const deepLines = copyRedacted(deep.lines);
    for (const l of model.files.listed) {
      const text = report[l.file];
      if (typeof text !== "string") continue;
      const ids = new Set(l.items.map((it) => str(it.verdict.finding_id)));
      // deepen.ts writes a deeper check's section from `Inert` lines (`checkSectionLines`, `withCheckSection`).
      report[l.file] = withDeeperChecks(text, deepLines, ids, deep.project, dirname(join(deep.reportDir, l.file)), printed, deep.seen);
    }
  }
  // The log records the number each listed finding was shown with (design 3.5).
  if (model.files && log) (log as Obj).finding_numbers = [...model.files.numbers.byId].map(([finding_id, number]) => ({ finding_id, number }));
  // What a person's decision is recorded against, and compared with at each assembly (design 3.4).
  if (log) (log as Obj).listed = listedRows;
  // The record's summary, from the same model and end summary as the report (design rf11 3.7).
  if (log) (log as Obj).summary = recordSummaryOf(model, end, redaction ? (t: string) => redactPrintedText(redaction, t) : (t: string) => t, arr((log as Obj).challenges).length) as unknown as Obj;
  return { refusals, log, report, counts: resultCounts, end, listed: listedRows, ...(model.decisions ? { decisions: model.decisions } : {}), ...(model.files ? { numbers: model.files.numbers, findingFiles: new Map(model.files.listed.flatMap((l) => l.items.map((it) => [str(it.verdict.finding_id), l.file] as const))), ruledOutFiles: new Map(model.files.ruledOutOf ?? []) } : {}), ...(recheck ? { recheck } : {}), ...(notCheckedFindings.length > 0 ? { not_checked: notCheckedFindings } : {}), ...(readAgainTotal ? { read_again: readAgainTotal } : {}) };
}

/**
 * Copy what the quote check writes onto one holder: CHECK_FIELDS as the check left them, and the seat's class word
 * where the check demoted it, with the word kept beside it. Only the class field: the check also demotes any other
 * field carrying a class word (a silence row's `note: "undetermined"` is one), and the log's schema has no place for
 * the word it would keep there, so those stay as the log wrote them; the class word is what the verdict states.
 */
function overlayCheck(onto: Obj, checked: Obj, classField: string): void {
  for (const k of CHECK_FIELDS) {
    if (k in checked) onto[k] = clone(checked[k]);
    else delete onto[k];
  }
  const keep = `${classField}${KEEP_SUFFIX}`;
  if (keep in checked) {
    onto[keep] = clone(checked[keep]);
    onto[classField] = clone(checked[classField]);
  }
}

/**
 * The re-check's outcomes, into the log and the items (O7). The report's `records[]` hold the log's own entries as the
 * check annotated them: a verdict (its adjudicator and refuter jobs share the one object, at `index` in `verdicts[]`)
 * or a silence row (at `index` in `unknown_rules[]`). The reading block's annotations stay off the log.
 */
function applyRecheck(report: Obj, into: { verdicts: Obj[]; unknownRules: Obj[]; items: Item[]; silences: Map<string, QuoteRow>; looks?: Map<string, NonNullable<Item["secondLook"]>> }): RecheckCounts {
  const summary = obj(report.summary) ?? {};
  const itemOf = new Map<Obj, Item>(into.items.map((it): [Obj, Item] => [it.verdict, it]));
  const invalid = (o: Obj | undefined): boolean => o?.quote_check_outcome === "invalidated";
  let demoted = 0;
  const seen = new Set<string>();
  for (const row of arr(report.records).map(obj)) {
    const checked = obj(row?.record);
    if (!row || !checked) continue;
    const seat = str(row.seat);
    const index = Number(row.index);
    const key = `${seat === "silence-investigator" ? "u" : "v"}${index}`;
    if (seen.has(key)) continue; // a verdict's two jobs carry the one annotated object
    seen.add(key);
    if (seat === "silence-investigator") {
      const onto = into.unknownRules[index];
      if (!onto) continue;
      const was = invalid(onto);
      overlayCheck(onto, checked, CLASS_FIELD["silence-investigator"]);
      if (!was && invalid(onto)) {
        demoted++;
        const s = into.silences.get(str(onto.rule_id));
        if (s) into.silences.set(str(onto.rule_id), { ...s, notes: arr(onto.quote_check_notes).map(str) });
      }
      continue;
    }
    const v = into.verdicts[index];
    if (!v) continue;
    const it = itemOf.get(v);
    const adjWas = invalid(v);
    const refWas = invalid(obj(v.refutation));
    overlayCheck(v, checked, CLASS_FIELD.adjudicator);
    const ref = obj(v.refutation);
    const refChecked = obj(checked.refutation);
    if (ref && refChecked) overlayCheck(ref, refChecked, CLASS_FIELD.refuter);
    /* A carried second look is re-checked like the rest of the set (verdict-verify.ts
     * `jobsFromEvidenceLog`). One whose quotation the check no longer finds takes the check's word (`needs_human`), as a fresh
     * look whose quotation was not found does, and the finding is placed on that (the look below is read by the disposition,
     * which runs after this step): it is never placed on a look that quotes a line no longer there. */
    const look = obj(v.second_look);
    const lookChecked = obj(checked.second_look);
    if (look && lookChecked) {
      const lookWas = invalid(look);
      overlayCheck(look, lookChecked, CLASS_FIELD.refuter);
      const held = into.looks?.get(str(v.finding_id));
      if (!lookWas && invalid(look) && held) {
        demoted++;
        held.outcome = lookAnswerOf(look.outcome);
        held.record = look;
        if (it?.passesDisagree === "found_against") it.passesDisagree = "undecided";
      }
    }
    /* A finding the two later passes left to the person had one why line
     * with both reasons. The check's reason replaces that line, so the second look's own line is printed again
     * (`secondLookLinesOf` prints none beside `passesDisagree`): its reason is never lost with the line it shared. */
    if (!adjWas && invalid(v)) {
      demoted++;
      if (it) {
        it.label = "counsel";
        delete it.passesDisagree;
        it.why = [() => demotedWhy(v, v, "adjudicator", it.candidate, undefined)];
      }
    } else if (!refWas && invalid(ref)) {
      // Step 8's needs_human branch: the refutation the check demoted leaves the verdict needs_human, with the check's reason.
      demoted++;
      v.verdict = "needs_human";
      if (it) {
        it.label = "counsel";
        delete it.passesDisagree;
        it.why = [() => demotedWhy(v, ref ?? {}, "refuter", it.candidate, undefined)];
      }
    }
  }
  const outcomes = obj(summary.outcomes) ?? {};
  return {
    records: Number(summary.records ?? 0),
    quotations: Number(summary.total ?? 0),
    outcomes: Object.fromEntries(Object.entries(outcomes).map(([k, n]) => [k, Number(n)])),
    malformed: arr(summary.malformed).length,
    demoted,
  };
}

/** The verdict's `refutation` object: the refuter's record as the check left it, less the two reply-only fields and the check's annotations on its reading. */
export function refutationObject(record: Obj, model?: string): Obj {
  const r = withoutReadingChecks(clone(record));
  for (const k of REFUTER_REPLY_ONLY) delete r[k];
  if (model) r.agent_model = model;
  return r;
}

/**
 * The verdict's `second_look` object: the challenge seat's record as the quote
 * check left it, less the reply-only fields and the mode (the field it sits under says what it is), with the model that ran it.
 */
export function secondLookObject(record: Obj, model?: string): Obj {
  const r = refutationObject(record, model);
  delete r.mode;
  return r;
}

/** A silence record as a log row: `undetermined` is `not_checked` with the word in `note` (SKILL.md L196). */
export function silenceRow(ruleId: string, record: Obj): Obj {
  const row: Obj = { rule_id: ruleId };
  const outcome = str(record.outcome);
  if (outcome === "undetermined") {
    row.outcome = "not_checked";
    row.note = "undetermined";
  } else {
    row.outcome = outcome;
  }
  for (const k of SILENCE_LOG_FIELDS) if (k in record) row[k] = clone(record[k]);
  // Copied as the check kept it. A word outside the log's enum makes the log invalid, and the schema
  // check below then refuses by name rather than this line choosing another word.
  if (record.outcome_before_quote_check !== undefined) row.outcome_before_quote_check = clone(record.outcome_before_quote_check);
  return row;
}

function firstNote(q: { notes?: string[]; record: Obj }): string {
  const notes = (q.notes && q.notes.length > 0 ? q.notes : arr(q.record.quote_check_notes).map(str)).filter(Boolean);
  return notes[0] ?? WORDS.noReasonGiven;
}

/**
 * A FINDING THE CHECK DEMOTED, SAID IN WORDS. Report #48 of live run 2 gave only the check's own note,
 * which names a JSON path and a search. The person is told what the finding is about - the rule is the item's heading,
 * and this line gives the place and what the seat concluded before the demotion, with its reasoning - and why the
 * program did not keep it: every quotation the check could not confirm, at its file and lines, in words
 * (`quote_check_failures`, written by `verdict-verify`), or the record-level reason where no quotation failed (the
 * record's shape, or no quotation where one is required). A record written before the check wrote its failures keeps
 * the check's own note. `v` is the verdict (the finding's places are its evidence); `holder` is the record the check
 * demoted: `v` itself, or its refutation.
 */
function demotedWhy(v: Obj, holder: Obj, seat: "adjudicator" | "refuter", candidate: Obj | undefined, malformed: string[] | undefined): Inert[] {
  const failures = arr(holder.quote_check_failures)
    .map(obj)
    .filter((f): f is Obj => !!f && str(f.effect) !== "withdraws_dismissal");
  const evidence = arr(v.evidence).map(obj).filter((e): e is Obj => !!e);
  const places = [...new Set(evidence.map((e) => `${str(e.file)}:${str(e.lines)}`))];
  const loc = arr(candidate?.locations).map(obj).filter((l): l is Obj => !!l)[0];
  const where =
    places.length > 0
      ? md`${inSpan(code(places[0] as string))}${places.length > 1 ? md` and ${places.length - 1} other place${places.length === 2 ? ours("") : ours("s")}` : ours("")}`
      : loc
        ? md`${inSpan(code(`${str(loc.file)}:${Number(loc.start_line)}`))}`
        : WORDS.unrecordedLocation;
  const adjWord = str(v.verdict_before_quote_check ?? v.verdict);
  // Each review's own reasoning beside its own conclusion; quoted before the line's own stop, so its
  // own final marks are dropped.
  const firstReasoning = clause(str(v.reasoning), 300);
  let because: Inert;
  if (failures.length > 0) because = WORDS.demotedRows(failures.length, seat === "adjudicator" ? WORDS.demotedWhoseFirst : WORDS.demotedWhoseSecond);
  else if (malformed && malformed.length > 0) because = WORDS.demotedMalformed(said(malformed.join("; "), 300));
  else if (arr(holder.evidence).length === 0 && holder.quote_check_outcome === "invalidated") because = WORDS.demotedNoEvidence;
  else because = WORDS.demotedOther(said(firstNote({ record: holder })));
  const lines = [
    seat === "adjudicator"
      ? WORDS.demotedLead(WORDS.demotedFirstReview, WORDS.wordOf(markdownText(adjWord)), where, firstReasoning, because)
      : WORDS.demotedLeadSecond(where, firstReasoning, WORDS.wordOf(markdownText(str(holder.outcome_before_quote_check ?? holder.outcome))), clause(str(holder.reasoning), 300), because),
  ];
  for (const f of failures) {
    const row = str(f.row);
    const n = Number((row.match(/\[(\d+)\]$/) ?? [])[1] ?? -1) + 1;
    const ownRow = row.startsWith("reading") ? WORDS.demotedRowReading(n) : WORDS.demotedRowEvidence(n);
    const rowWords = seat === "refuter" ? WORDS.demotedRowSecond(ownRow) : ownRow;
    const reason = str(f.reason);
    const fw = WORDS.failureWords;
    const said =
      reason === "other_file"
        ? fw.other_file(code(str(f.found_in)))
        : reason === "not_found" || reason === "several_files" || reason === "first_line_only" || reason === "no_content" || reason === "redacted"
          ? fw[reason]
          : WORDS.demotedOther(markdownText(reason));
    lines.push(WORDS.demotedRow(code(`${str(f.file) || "(no file named)"}:${str(f.lines) || "?"}`), rowWords, said));
  }
  return lines;
}

/* ------------------------------------------------------------------------------------------------
 * The report (SKILL.md step 6), in its order.
 * ---------------------------------------------------------------------------------------------- */
interface ReportArgs {
  /** Every withdrawn group's line, of every record. */
  unconfirmed: Inert[];
  /** This run's evidence log, for the line saying how to have the places not checked read. */
  logPath?: string;
  findings: Obj;
  plan: Obj;
  items: Item[];
  preSettled: Obj[];
  unknownRules: Obj[];
  silences: Map<string, QuoteRow>;
  /** Candidates the scanner suppressed that no verdict answers (O10). */
  suppressions?: Obj[];
  /** False where no capture ledger was checked (X33). */
  ledgerChecked?: boolean;
  unadjudicated: Obj[];
  notJudged?: NotJudgedSets;
  /** Review R18: the rules read on a model other than their own setting. */
  modelOverrides?: readonly ModelOverride[];
  summary: Obj;
  shape: string;
  chosenBy: string;
  deferred: boolean;
  candidates: Obj[];
  silent: Obj[];
  /** Every finding the facts at its place raise, by finding_id (a candidate nobody answered among them). */
  raises?: ReadonlyMap<string, SeverityRaise>;
  /** The profile the scan read, where known (questions shown in the report: W5, W7, W21). */
  profile?: Obj | null;
  /** The questions the report shows in Fix first (W5, W7), the log's `questions_raised[]`. */
  questions?: QuestionSlot[];
  /** Every per-place table's rows, by finding_id (the first screen's data, recipients and short `why`). */
  placeRows?: ReadonlyMap<string, readonly PlaceRowIn[]>;
  /** Each rule's `short_name` from the bundle, where it has one. */
  shortNames?: ReadonlyMap<string, string>;
  /** Each rule's two presentation lines (the bundle's `rule-lines.json`); absent or empty for a bundle with none, where titles are the rules' `short_name`. */
  ruleLines?: Readonly<Record<string, RuleLines>>;
  /** Each rule's bases (the input's `ruleBases`), for `settledExclusionsOf`. */
  ruleBases?: ReadonlyMap<string, readonly RuleBasis[]>;
  /** The main file's name as written (`report.md`, or the name `--out-report <path>.md` gave it). */
  reportName?: string;
  /** The run's declaration plan, where it is this scan's. */
  declarationPlan?: Obj | null;
  /** Why the scan's plan was not taken, or null. */
  declarationPlanNotTaken?: string | null;
  /** Where the report folder lies against the project (`up` null: outside it, absolute links). */
  reportPlace?: { up: string | null; root: string };
  /** The number list and the carried numbers (number-list.ts); absent: numbered as a first run. */
  numbering?: { list: NumberList | null; carried: { numbers: ReadonlyMap<string, number>; label: string } | null; recordedMax: number };
  /** The printed redaction (step 13), so that a row budget counts the rows the file will hold once its values are hidden. */
  printed?: (text: string) => string;
  /** The log's `comparison` block (comparison.ts); null or absent where none was written. */
  comparison?: Obj | null;
}

/** The later reading's total, as the report and the terminal state it. */
export interface ReadAgainTotal {
  /** The scans whose verdicts left the places unread, sorted and joined. */
  scans: string;
  /** The path the person named that run by, as typed (the plan's `previous`), or null. */
  named: string | null;
  findings: number;
  previous: number;
  checked: number;
  /** Places settled from the form of the line alone, not opened (`ReadAgain.settled`). */
  settled: number;
  unanswered_findings: number;
  unanswered_places: number;
}

/**
 * Over every candidate the plan handed to a seat again with places its previous verdict left unread: how many places
 * that was and how many this run checked; the ones with no answer in this run are counted apart, their places still not
 * checked. Null where the plan names none. One count for the report and the terminal.
 */
function readAgainTotalOf(plan: Obj, items: Item[]): ReadAgainTotal | null {
  const asked = new Set(arr(plan.to_adjudicate).map(str));
  const rows = arr(plan.rows)
    .map(obj)
    .filter((r): r is Obj => !!r && !!obj(r.previous_not_checked) && asked.has(str(r.finding_id)));
  if (rows.length === 0) return null;
  const byId = new Map(items.map((it) => [str(it.verdict.finding_id), it] as const));
  const total: ReadAgainTotal = { scans: "", named: str(plan.previous) || null, findings: rows.length, previous: 0, checked: 0, settled: 0, unanswered_findings: 0, unanswered_places: 0 };
  const scans = new Set<string>();
  for (const r of rows) {
    const p = obj(r.previous_not_checked) as Obj;
    const n = Math.max(0, Number(p.places ?? 0) || 0);
    total.previous += n;
    scans.add(str(p.scan_id));
    const it = byId.get(str(r.finding_id));
    if (it?.readAgain) {
      total.checked += it.readAgain.checked;
      total.settled += it.readAgain.settled;
    } else {
      total.unanswered_findings += 1;
      total.unanswered_places += n;
    }
  }
  total.scans = [...scans].sort().join(", ");
  return total;
}

/** The earlier run as the report names it: its label beside the path the person named it by. */
function earlierRun(a: ReportArgs, label: string): Inert {
  // carry-forward's sentence, with the run's path in a code span (`code`) and every other part inert text.
  const path = str(a.plan.previous);
  const [before, after] = earlierRunWords(label, { who: "you", path: path || null, quote: () => "\u0000" }).split("\u0000");
  return after === undefined ? markdownText(before ?? "") : md`${markdownText(before ?? "")}${inSpan(code(path))}${markdownText(after)}`;
}

function readAgainTotalLines(a: ReportArgs): Inert[] {
  const t = readAgainTotalOf(a.plan, a.items);
  if (!t) return [];
  const out = [WORDS.readAgainTotal(t.checked, t.settled, t.previous, earlierRun(a, t.scans), t.findings)];
  if (t.unanswered_findings > 0) out.push(WORDS.readAgainUnanswered(t.unanswered_findings, t.unanswered_places));
  return [...out, ours("")];
}

/**
 * The blocks of the applicability section, in the document's order. `findings.json`
 * holds one entry per checklist, and the checklists whose scope gate is one instrument's same article (the CRA's four, at
 * Art. 2(1)) print the same block: A1's and A2a's reports printed it four times, and live run 3's too. The grouping is
 * the scan console's own (report.ts `applicabilityByInstrument`, which compares everything that section prints for an
 * entry), so the two outputs collapse the same entries; a group is one block only where its entries also share the cite
 * this section prints, and that block names every checklist it stands for. Entries of one instrument that differ are each
 * a block (`apart`), named by their checklist; an instrument with one entry is one block, as before.
 */
function applicabilityBlocksOf(app: Obj[]): { entries: Obj[]; apart: boolean }[] {
  const records = app.map((x) => ({
    ...x,
    limbs: arr(x.limbs).map((l) => ({ ...(obj(l) ?? {}), supporting: arr(obj(l)?.supporting), opposing: arr(obj(l)?.opposing) })),
    contradictions: arr(x.contradictions).map((c) => ({ ...(obj(c) ?? {}), evidence: arr(obj(c)?.evidence) })),
    unresolved_limbs: arr(x.unresolved_limbs),
  }));
  const groups = applicabilityByInstrument(records as unknown as Parameters<typeof applicabilityByInstrument>[0]);
  return groups.flatMap((g): { entries: Obj[]; apart: boolean }[] => {
    const entries = g.entries as unknown as Obj[];
    if (entries.length === 1) return [{ entries, apart: false }];
    if (g.identical && entries.every((e) => str(e.cite) === str(entries[0]?.cite))) return [{ entries, apart: false }];
    return entries.map((e) => ({ entries: [e], apart: true }));
  });
}

/**
 * WHICH RULE BUNDLE RAN: the report names it by the version and content digest the scan
 * document records (`bundle`, scan.ts), and says plainly when it is not the bundle shipped with the program assembling
 * the report (bundle.ts `isShippedIdentity`: its digest and its version, the one decision the scan's lines ask too). The
 * bundle chooses every rule a scan runs, and a person reading another party's report depends on knowing whether the
 * shipped rules ran. Exported for a test.
 */
export function rulesLineOf(f: Obj): Inert {
  const b = obj(f.bundle);
  const digest = str(b?.sha256);
  if (!b || !digest) return WORDS.rulesUnnamed;
  const named = md`bundle ${markdownText(str(b.version) || "(no version)")}, sha256 ${markdownText(digest)}`;
  // The shipped bundle is the one whose content digest AND version are the shipped bundle's: a copy with
  // another version in its manifest has the shipped digest. Asked of bundle.ts's one decision, never here.
  const shipped = isShippedIdentity(digest, str(b.version));
  if (shipped === null) return WORDS.rulesNoneToCompare(named);
  return shipped ? WORDS.rulesShipped(named) : WORDS.rulesNotShipped(named);
}

/* ------------------------------------------------------------------------------------------------
 * THE REPORT'S FIVE FILES.
 *
 * `report.md` is what the person opens: a first screen (what to fix first, the not-checked count, what was not read,
 * the laws in one line) and then every finding that stands, by area, one line per rule and level, with the places no
 * review answered beside the findings of their area. `details.md` holds every standing finding's evidence under an
 * anchor named by its finding id; `not-checked.md` everything that was not established; `not-applicable.md` the clean
 * "not applicable" answers; `laws.md` the applicability block.
 *
 * THE ASYMMETRY, KEPT: a place not read never looks read. The not-checked count is on the first screen whatever it is
 * (a zero is said); the Not checked block is always there; each area of the work list carries its own not-checked
 * lines; a "not applicable" answer with any place not checked, undetermined or kept is never in `not-applicable.md`
 * (A4, RK-4, C2-1: it is in `not-checked.md`); and how each answer's places were read stays beside it.
 * ---------------------------------------------------------------------------------------------- */

/** The five files, in the order the first screen names them. */
/** The report's files of fixed name; beside them `findings/<short id>.md` and `ruled-out/<rule>.md`. */
export const REPORT_FILES = ["report.md", "not-checked.md", "ruled-out.md", "laws.md"] as const;
export type ReportFileName = (typeof REPORT_FILES)[number];
/** Every file of the report by its path in the report folder: the fixed ones and the folders' files. */
export type ReportFiles = Record<string, Inert>;

/**
 * Every kind of item `not-checked.md` holds, in the file's order. The file and the first screen's Not
 * checked block are both made from one list of these (`uncheckedKinds`): each kind's section and its count come from the
 * same entry, and every entry names the block's line it is counted on, so no kind can be in the file and missing from
 * the count. A kind added here needs its heading below, its phrase in `WORDS.uncheckedKind` and its line (the compiler
 * holds all three: each is a record over this union).
 */
export type UncheckedKey =
  | "no-ledger"
  | "unconfirmed"
  | "no-usable-answer"
  | "not-reviewed"
  | "partly"
  | "gap"
  | "absent"
  | "not-checked-rules"
  | "not-evaluated"
  | "by-declaration"
  | "did-not-read"
  | "files-not-read"
  | "lines-not-read"
  | "files-refused"
  | "files-outside"
  | "overturned-unquoted"
  | "not-refuted"
  | "places-not-opened"
  | "questions"
  | "answers-not-taken"
  | "suppressed"
  | "settlement";
/** The lines of the first screen's Not checked block, in order (`WORDS.uncheckedLead` holds one lead for each). */
export type ScreenLine = "noAnswer" | "answers" | "rules" | "notRead" | "also";
/** How a "not applicable" answer was settled, from its record. */
export type NotApplicableKey = "read" | "overturned" | "placesCarried" | "carried" | "declared";
interface UncheckedKind {
  key: UncheckedKey;
  /** How many items of this kind the run holds: the rows its section lists (a ledger not checked counts one). */
  n: number;
  /** Its lines in `not-checked.md`, heading included; a section SKILL.md quotes prints "No entry" when `n` is 0. */
  lines: Inert[];
  /** What the first screen says of it: `WORDS.uncheckedKind[key](n)` and any detail; "" when `n` is 0. */
  screen: Inert;
  /** (rf11) The phrases M2's "Not read" item prints for it in place of its bare count, where the scan counted them. */
  parts?: Inert[];
}
/** Each kind's line on the first screen. */
export const KIND_LINE: Readonly<Record<UncheckedKey, ScreenLine>> = {
  "no-ledger": "also",
  unconfirmed: "also",
  "no-usable-answer": "noAnswer",
  "not-reviewed": "noAnswer",
  partly: "answers",
  "overturned-unquoted": "answers",
  "not-refuted": "answers",
  gap: "rules",
  absent: "rules",
  "not-checked-rules": "rules",
  "not-evaluated": "rules",
  "by-declaration": "rules",
  "did-not-read": "notRead",
  "files-not-read": "notRead",
  "lines-not-read": "notRead",
  "files-refused": "notRead",
  "files-outside": "notRead",
  "places-not-opened": "answers",
  questions: "also",
  "answers-not-taken": "also",
  suppressed: "noAnswer",
  settlement: "also",
};
/**
 * The headings each kind's section has in `not-checked.md` (for the ledger, its one sentence, which has no heading): the
 * sections are written under these, and the gate reads the file by them.
 */
export const UNCHECKED_KIND_HEADINGS: Readonly<Record<UncheckedKey, readonly string[]>> = {
  "no-ledger": [WORDS.noLedgerChecked],
  unconfirmed: [WORDS.unconfirmedHeading],
  "no-usable-answer": [WORDS.notAnswered, WORDS.notJudgedInvalid, WORDS.notJudgedUnusable],
  "not-reviewed": [WORDS.notAdjudicated],
  partly: [WORDS.partlyCheckedHeading],
  "overturned-unquoted": [WORDS.overturnedUnquotedHeading],
  "not-refuted": [WORDS.notRefutedHeading],
  gap: [WORDS.gapFound],
  absent: [WORDS.apparentlyAbsent],
  "not-checked-rules": [WORDS.unknownNotChecked],
  "not-evaluated": [WORDS.notEvaluated],
  "by-declaration": [WORDS.notApplicableByDeclaration],
  "did-not-read": [WORDS.didNotRead],
  "files-not-read": [WORDS.filesNotRead],
  "lines-not-read": [WORDS.linesNotRead],
  "files-refused": [WORDS.filesRefusedHeading],
  "files-outside": [WORDS.filesOutsideHeading],
  "places-not-opened": [WORDS.placesNotChecked],
  questions: [WORDS.questionsUnanswered],
  "answers-not-taken": [WORDS.answersNotTaken],
  suppressed: [WORDS.suppressedHeading],
  settlement: [WORDS.settlementNotHonoured],
};

/** How many rules the first screen lists under Fix first (proposal section 1: at most eight groups). */
const FIRST_SCREEN_GROUPS = 8;
/** Fix first holds five entries, To clarify three, on report.md's first screen (design 3.1). */
const FIRST_SCREEN_FIXES = 5;
const FIRST_SCREEN_CLARIFY = 3;
/**
 * The rows Fix first's entries and To clarify's items may take on the
 * first screen: mock M2's, five entries of two rows and three items in eight rows. A title is printed in full (design 3.1:
 * plain text, not cut), so a long one takes more rows; the block then shows fewer entries, in order, always at least one,
 * and its last line counts the rest, which follow below in the same order.
 */
const FIRST_SCREEN_FIX_ROWS = 10;
/** The rows "Now to fix" gives up on a later run to the since section and the still-to-fix lines. */
const LATER_FIRST_ROWS = 4;
const FIRST_SCREEN_CLARIFY_ROWS = 8;

/** How many of a block's entries (each its logical lines) fit `rows` once formed and printed: in order, at least one. */
function entriesWithin(entries: readonly (readonly Inert[])[], rows: number, printed: (t: string) => string): number {
  let used = 0;
  let n = 0;
  for (const e of entries) {
    const r = formMarkdown(e.map((x) => inertRedacted(x, printed))).split("\n").filter((l) => l !== "").reduce((k, l) => k + rowsAt(l), 0);
    if (n > 0 && used + r > rows) break;
    used += r;
    n += 1;
  }
  return n;
}
/** How many places a work-list line links before "and N more". */
const WORK_LIST_LINKS = 3;

function listWords(xs: readonly Inert[]): Inert;
function listWords(xs: readonly string[]): string;
function listWords(xs: readonly string[]): string {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** A place row as the report reads it (place-fold.ts `PlaceTableRow`; `why` is the seat's short line for the place). */
type ReportRow = PlaceRowIn & { why?: string };

/** What every builder reads, made once. */
interface ReportModel {
  a: ReportArgs;
  project: string;
  titleOf: Map<string, string>;
  plainOf: (ruleId: string) => Inert;
  sevOf: (it: Item) => string;
  heldOf: (it: Item) => ReportRow[];
  /** The findings that stand (a candidate, or one that needs judgement), by severity, then confidence, then id. */
  shown: Item[];
  /** "Not applicable" answers that rest on places not read (A4, RK-4, C2-1): `not-checked.md`. */
  partly: Item[];
  /** "not applicable" answers of a second review that quoted nothing: `not-checked.md`, never with the clean ones. */
  overturnedUnquoted: Item[];
  /** Findings that stand with no usable second review (`not_yet_refuted`). */
  notRefuted: Item[];
  /** The clean "not applicable" answers: `not-applicable.md`. */
  dismissed: Item[];
  /** Every item whose record names places no review read. */
  unread: Item[];
  notAnswered: Obj[];
  invalidAnswers: Obj[];
  /** Candidates whose answer step 6 set aside, each with why (`unadjudicated[]` reason `unusable_answer`). */
  unusableAnswers: Obj[];
  byShape: Obj[];
  candidateById: Map<string, Obj>;
  contradictedBy: Map<string, { rule: string; where: string }>;
  /** A shown finding's disposition (the assembly's one computation; absent = to fix). */
  dispOf: (it: Item) => Disposition;
  /** The shown findings by id. */
  itemById: Map<string, Item>;
  /** What every screen counts, from the dispositions (`dispositionCountsOf`). */
  counts: DispositionCounts;
  /** The entries the files list, their short ids and F-numbers (`fileModelOf`). */
  files?: FileModel;
  /** The person's decisions, read after `counts` was made; absent where none was read. */
  decisions?: DecisionView;
}

/**
 * THE COUNTS EVERY SCREEN TAKES: the
 * headline, the "Also" line, the end of the run's screen and the partition all read these, made once from the shown
 * findings' dispositions. Every shown finding is in exactly one of `toFix`, `counsel`, `waiting`, `recorded`,
 * `notShipped`, `forOperators`, `folded`; `settled` counts the candidates no seat reviewed because of the person's answers.
 */
export interface DispositionCounts {
  toFix: { high: number; medium: number; low: number };
  counsel: number;
  /** Findings in a question slot (`question`, `check_answer`), and how many slots they make. */
  waiting: number;
  questions: number;
  recorded: number;
  notShipped: number;
  forOperators: number;
  folded: number;
  settled: number;
}
function dispositionCountsOf(shown: readonly Item[], sevOf: (it: Item) => string, slots: readonly QuestionSlot[], settled: number): DispositionCounts {
  const d = (it: Item): Disposition => dispositionOfItem(it);
  const toFix = shown.filter((it) => d(it) === "to_fix");
  const n = (x: Disposition): number => shown.filter((it) => d(it) === x).length;
  return {
    toFix: { high: toFix.filter((it) => sevOf(it) === "high").length, medium: toFix.filter((it) => sevOf(it) === "medium").length, low: toFix.filter((it) => sevOf(it) !== "high" && sevOf(it) !== "medium").length },
    counsel: n("counsel"),
    waiting: n("question") + n("check_answer"),
    questions: slots.filter((q) => q.kind !== "order_moving").length,
    recorded: n("recorded"),
    notShipped: n("not_shipped"),
    forOperators: n("for_operators"),
    folded: n("folded"),
    settled,
  };
}

const ruleOfRecord = (m: ReportModel, u: Obj): string => str(m.candidateById.get(str(u.finding_id))?.rule_id) || WORDS.ruleNotInFindings;
const sevOfRecord = (m: ReportModel, u: Obj): string => m.a.raises?.get(str(u.finding_id))?.severity ?? str(m.candidateById.get(str(u.finding_id))?.severity);
const placesOfRecord = (m: ReportModel, u: Obj): number =>
  u.places !== undefined ? Number(u.places) || 0 : arr(m.candidateById.get(str(u.finding_id))?.locations).length;
const sumOf = <T>(xs: readonly T[], f: (x: T) => number): number => xs.reduce((n, x) => n + f(x), 0);

/* ------------------------------------------------------------------------------------------------
 * The order's helpers: the decisive place, the block's
 * words, the evidence log's `standing[]` rows and the question slots of Fix first (W5, W7).
 * ---------------------------------------------------------------------------------------------- */

/** The `decisive` quotation's place (`E<n>` an entry of the verdict's evidence, `P<n>` a kept place row), or null (T6). */
function decisivePlaceOf(v: Obj, rows: readonly PlaceRowIn[], c?: Obj): { file: string; line: number } | null {
  const d = str(obj(v.standing)?.decisive);
  // ref-ids.ts: `E<n>` counts from E1, `P<n>` from P0 (the smoke test's decisive `P0` was refused here too).
  const ei = evidenceIndexOf(d);
  if ((ei !== null || isPlaceId(d)) && v.quote_check_outcome !== "invalidated") {
    if (ei !== null) {
      const e = obj(arr(v.evidence)[ei]);
      const line = parseInt(str(e?.lines), 10);
      if (e && str(e.file) && line > 0) return { file: str(e.file), line };
    } else {
      const r = rows.find((x) => x.place === d && KEPT_DECISIONS.has(str(x.decision)));
      if (r) return { file: r.file, line: r.line };
    }
  }
  if (c === undefined) return null;
  // Where the decisive place is not at hand (a raise must name one): the first kept place, quotation, or matched line.
  const h = rows.find((x) => KEPT_DECISIONS.has(str(x.decision)));
  if (h) return { file: h.file, line: h.line };
  const e = arr(v.evidence).map(obj).find((x): x is Obj => !!x);
  if (e && parseInt(str(e.lines), 10) > 0) return { file: str(e.file), line: parseInt(str(e.lines), 10) };
  const l = arr(c.locations).map(obj).find((x): x is Obj => !!x);
  return l ? { file: str(l.file), line: Number(l.start_line) || 1 } : null;
}
/**
 * W8: the data a block names; "" where the review did not establish them: the placeholder "data" printed there named no kind and read as a
 * reason for a raise that rested on the duty alone.
 */
const standingDataWords = (o: StandingOrder): Inert => (o.heaviest.includes("data") ? ours("") : listWords(o.data.map((d) => WORDS.standingData[d] ?? markdownText(d))));
/**
 * How it runs, where that part stood; "" where it did not: the order
 * placed it at its heaviest (`default`), and printing that as "on the shipped defaults" stated as a fact what the review
 * never established. W13 says it is not established and what it is placed as.
 */
const standingRunsWords = (o: StandingOrder): Inert => (o.heaviest.includes("runs") ? ours("") : (WORDS.standingRuns[o.runs] ?? markdownText(o.runs)));
/** W9: whose data, with the person's Minors answer beside it. */
const standingPeopleWords = (o: StandingOrder, answers: { minors?: boolean }): Inert => {
  const ws = listWords(o.people.map((p) => WORDS.standingPeople[p] ?? markdownText(p)).filter(Boolean));
  return ws && answers.minors ? md`${ws} ${WORDS.minorsAnswered}` : ws;
};
/** A provision as the resolver reads it ("5(1)(ba)", "Annex I", "Recital 31"), as the report prints it. */
const provisionWords = (p: string): string => (/^\d/.test(p) ? `Art ${p}` : p);
/**
 * W11's later date, from the resolver's `appliesFrom`, `appliesLater` and `provisions` (penalty-tier.ts), compared with
 * the scan's own date (`day`, ISO; "" where unknown, and then every date is still to come): "" where the duty applies on
 * that day; "applies from {date}" where the whole duty applies later; where only some of the provisions the cite names
 * apply later, the others as applying and each later one with its date. A recital is never named as applying.
 */
function laterWordsOf(b: ResolvedBasis, day: string): Inert {
  const ahead = (d: string): boolean => day === "" || d > day;
  // Where the duty applies on that day and its fine provision applies later, the
  // fines' date, only while the scan's date is before it; never beside a duty that itself applies later.
  const finesLater = (): Inert => (b.penaltyAppliesFrom && ahead(b.penaltyAppliesFrom) ? WORDS.finesApplyFrom(programText(b.penaltyAppliesFrom)) : ours(""));
  const parts = (b.appliesLater ?? []).filter((l) => ahead(l.appliesFrom));
  if ((b.appliesLater ?? []).length === 0) return b.appliesFrom && ahead(b.appliesFrom) ? WORDS.appliesFrom(programText(b.appliesFrom)) : finesLater();
  if (parts.length === 0) return finesLater();
  const later = new Set(parts.map((l) => l.provision));
  // Where every duty the cite names applies later and none has come, the provisions not listed lay down no duty.
  const allLater = b.appliesFrom !== undefined && parts.length === (b.appliesLater ?? []).length;
  const now = allLater ? [] : (b.provisions ?? []).filter((p) => !later.has(p) && !p.startsWith("Recital"));
  return WORDS.appliesInPart(now.map((p) => programText(provisionWords(p))), parts.map((l) => ({ what: programText(provisionWords(l.provision)), from: programText(l.appliesFrom) })));
}
/**
 * W11: the duty's cite and tier words, where a duty stood; `day` is the scan's date (laterWordsOf). The cite is printed
 * as the law line prints it (`citationOf`: up to the first explanation), never the bundle's whole cite.
 */
const lawWordsOf = (o: StandingOrder, day: string): Inert =>
  o.topBasis ? md`${programText(citationOf(o.topBasis.cite))} (${WORDS.tierWords(programText(o.topBasis.regime || citationOf(o.topBasis.cite)), o.topBasis, laterWordsOf(o.topBasis, day))})` : ours("");
/** The resolver with the bundle's table bound, each cite and jurisdiction resolved once. */
export function tierOfMemo(table: PenaltyTierTable): TierOf {
  const seen = new Map<string, ReturnType<TierOf>>();
  return (cite, jurisdiction) => {
    const k = `${jurisdiction ?? ""}\n${cite}`;
    let t = seen.get(k);
    if (t === undefined) seen.set(k, (t = tierOfBasis(cite, jurisdiction, table)));
    return t;
  };
}
/** The scan's own date (the findings document's `completed_at`), against which a later date is read. */
const scanDayOf = (m: ReportModel): string => (/^\d{4}-\d{2}-\d{2}/.test(str(m.a.findings.completed_at)) ? str(m.a.findings.completed_at).slice(0, 10) : "");
/**
 * Why the capture set a part aside, in the person's words. The
 * reason the record holds (`standing_set_aside[].why`) is the program's own message to the seat (standing.ts, place-reply.ts
 * `lineStandsAsBeyond`); it is read here by its form, never printed as it is. A form not known here is said generally.
 */
export function asideReasonWords(why: string): Inert {
  // Each form is read whole, its code at the message's end: the seat's own
  // value (a word, a file name) stands inside the message, before the program's words, and cannot pick another reason. S5 holds for every part in words: `effect`, and fixes A-D's `element`,
  // `exemption.limb` and `fact.words` (standing.ts `wordsProblem`, one message form for all four).
  const words = /^`(?:effect|element|exemption\.limb|fact\.words)` has (\d+) words; at most (\d+) \(S5\)$/.exec(why);
  if (words) return WORDS.asideReason.tooLong(Number(words[1]), Number(words[2]));
  const noRead = /^your transcript shows no Read of (.+) covering line (\d+) \(C9\) \(S2\)$/.exec(why);
  if (noRead) return WORDS.asideReason.notOpened(code(`${noRead[1]}:${noRead[2]}`));
  const notFile = /^`at` names (.+), which is not a file of the scanned tree \(C9\) \(S2\)$/.exec(why);
  if (notFile) return WORDS.asideReason.notAFile(code(notFile[1] ?? ""));
  if (/^`at`'s quote is not a verbatim part of .+, nor of any line of that file \(C9\) \(S2\)$/.test(why)) return WORDS.asideReason.notVerbatim;
  if (/^`at` quotes a line, and no tree was at hand to check it against \(C9's rule\): a quotation nobody checked gives no fact \(S2\)$/.test(why)) return WORDS.asideReason.noTree;
  if (/^`at` \S+ is not a place row of this candidate that you kept and that passed the place checks \(S2\)$/.test(why)) return WORDS.asideReason.notKept;
  if (/^`at` \S+ names no entry of this verdict's `evidence\[\]` \(it holds \d+, E1 to E-?\d+\) \(S2\)$/.test(why)) return WORDS.asideReason.noEntry;
  if (/^`(?:effect|element|exemption\.limb|fact\.words)` is one line \(S5\)$/.test(why)) return WORDS.asideReason.notOneLine;
  if (/^`(?:effect|element|exemption\.limb|fact\.words)` is English \(S5\)$/.test(why)) return WORDS.asideReason.notEnglish;
  if (why === "`status` `duty_met` with the verdict `needs_human` contradicts itself (S6)") return WORDS.asideReason.contradicts;
  if (why === "`status` `exempt` with the verdict `needs_human` contradicts itself (S6)") return WORDS.asideReason.contradictsExempt;
  // Fixes A-D's messages (standing.ts, WP1), read whole by their form.
  if (STATUS_MET_NO_ELEMENT.test(why)) return WORDS.asideReason.metNoElement(null);
  if (STATUS_EXEMPT_NO_EXEMPTION.test(why)) return WORDS.asideReason.exemptNoExemption(null);
  if (STATUS_WAIT_NO_QUESTION_NOR_FACT.test(why)) return WORDS.asideReason.noQuestionNorFact(null);
  if (why === "`element` goes only with a `status` `duty_met` that stood (S8)") return WORDS.asideReason.elementWithoutMet;
  if (why === "`exemption` goes only with a `status` `exempt` that stood (S8)") return WORDS.asideReason.exemptionWithoutExempt;
  if (/^`exemption` is `\{"basis", "limb"\}`: .+ \(S8\)$/.test(why)) return WORDS.asideReason.exemptionForm;
  if (why === "`fact` goes only with `status` `waits_on_answer` (S4)") return WORDS.asideReason.factWithoutWait;
  if (/^`fact` is for a fact no question of the program's list carries; .+ \(S4\)$/.test(why)) return WORDS.asideReason.factBesideQuestion;
  if (/^`fact` is `\{"words", "about"\}`: .+ \(S4\)$/.test(why)) return WORDS.asideReason.factForm;
  if (/^`same_as` is one object `\{file, line, quote\}`: .+ \(S2\)$/.test(why)) return WORDS.asideReason.sameAsForm;
  // The status's S4 message alone does not say which of its three causes it
  // was (`setAsideOf` reads the question's own row for that); without it, the words are true of all three.
  if (STATUS_WAIT_NO_QUESTION.test(why)) return WORDS.asideReason.noQuestionStood;
  if (why === "`question` goes only with `status` `waits_on_answer` (S4)") return WORDS.asideReason.questionWithoutWait;
  if (/^`question\.value` .+ is not a question of the program's list \(S4\)$|^`settles` names .+, not a question of the program's list \(S4\)$/.test(why)) return WORDS.asideReason.noQuestion;
  if (/\(S3\)$/.test(why)) return WORDS.asideReason.notOwnBasis;
  if (/\(S1\)$/.test(why)) return WORDS.asideReason.notInList;
  return WORDS.asideReason.otherForm;
}
/** The capture's one message for `status` `waits_on_answer` set aside because no question stood (standing.ts, S4). */
const STATUS_WAIT_NO_QUESTION = /^`status` `waits_on_answer` names no question of the program's list that stood \(S4\)$/;
/* The capture's messages for a status of fixes A-D set aside because
 * the part it needs did not stand (standing.ts, S8 and S4; WP1). */
const STATUS_MET_NO_ELEMENT = /^`status` `duty_met` names no `element` that stood: .+ \(S8\)$/;
const STATUS_EXEMPT_NO_EXEMPTION = /^`status` `exempt` names no `exemption` that stood: .+ \(S8\)$/;
const STATUS_WAIT_NO_QUESTION_NOR_FACT = /^`status` `waits_on_answer` names no question of the program's list and no fact in words that stood \(S4\)$/;
/**
 * Why a status of fixes A-D was set aside, with the cause its own part
 * gave (as D2 does for a question): the element's row for `duty_met`, the exemption's for `exempt`, the fact's for a wait.
 * Null for any other message.
 */
function statusPartAsideWords(why: string, rowOf: (part: string) => Obj | undefined): Inert | null {
  const own = (part: string): Inert | null => {
    const r = rowOf(part);
    return r ? asideReasonWords(str(r.why)) : null;
  };
  if (STATUS_MET_NO_ELEMENT.test(why)) return WORDS.asideReason.metNoElement(own("element"));
  if (STATUS_EXEMPT_NO_EXEMPTION.test(why)) return WORDS.asideReason.exemptNoExemption(own("exemption"));
  if (STATUS_WAIT_NO_QUESTION_NOR_FACT.test(why)) return WORDS.asideReason.noQuestionNorFact(own("fact"));
  return null;
}
/**
 * Why `status` `waits_on_answer` was set aside, by its cause: the record's
 * own row for `question` says which (none: no question was named; S4: not a question of the list; S2: a question of the list
 * whose quotation did not stand; else a form not read). Before, all three were said as "not one this program asks".
 */
export function waitAsideWords(questionWhy: string | null): Inert {
  if (questionWhy === null) return WORDS.asideReason.noQuestionNamed;
  if (/^`question\.value` .+ is not a question of the program's list \(S4\)$/.test(questionWhy)) return WORDS.asideReason.noQuestion;
  if (/ \(S2\)$/.test(questionWhy)) return WORDS.asideReason.questionNotQuoted(asideReasonWords(questionWhy));
  return WORDS.asideReason.questionOtherForm;
}
/** The person's region answers that set laws aside, as the law line names them ("Region US: No"). */
function regionNoWords(jurisdictions: readonly (string | undefined)[]): Inert {
  return inertJoin([...new Set(jurisdictions)].map((j) => md`${markdownText(questionTextOf("distribution_regions").header.replace("{code}", str(j)))}: No`), ours("; "));
}
/**
 * The parts of a record the capture set aside, each with its first reason in the person's words. With the order: a duty whose every law that lays down a duty the
 * person's region answer set aside (`regionOut`, S3's region half) is not used for that reason, as the law line beside it
 * says, never "not established".
 */
function setAsideOf(v: Obj, o?: StandingOrder): Map<string, Inert> {
  const out = new Map<string, Inert>();
  const rows = arr(v.standing_set_aside).map(obj);
  const question = rows.find((x) => str(x?.part) === "question");
  for (const x of rows) {
    const part = str(x?.part);
    const why = str(x?.why);
    if (part && !out.has(part))
      out.set(
        part,
        STATUS_WAIT_NO_QUESTION.test(why)
          ? waitAsideWords(question ? str(question.why) : null)
          : (statusPartAsideWords(why, (p) => rows.find((y) => str(y?.part) === p) ?? undefined) ?? asideReasonWords(why)),
      );
  }
  // S7: a record the final quotation check invalidated gives no fact; the parts it gave are not used, for that reason.
  if (v.quote_check_outcome === "invalidated") for (const part of Object.keys(obj(v.standing) ?? {})) if (!out.has(part)) out.set(part, WORDS.asideReason.invalidated);
  if (o && o.heaviest.includes("duty") && o.regionOut.length > 0 && !out.has("duty")) {
    out.set("duty", WORDS.asideReason.regionOut([...new Set(o.regionOut.map((b) => citationOf(b.cite)))].map((c) => programText(c)), regionNoWords(o.regionOut.map((b) => b.jurisdiction))));
  }
  return out;
}
/** A `standing` the capture dropped whole for not being an object (standing.ts). */
const blockDroppedWhole = (v: Obj): boolean =>
  !obj(v.standing) && arr(v.standing_set_aside).some((x) => str(obj(x)?.part) === "standing" && /, so the block is dropped whole$/.test(str(obj(x)?.why)));
/**
 * W13: the parts the review did not establish, as one sentence; "" where every order part stood. A part the review gave and the capture set aside is said as
 * not used, with its reason, never as not established: only a part the review did not give is "not established".
 */
const notEstablishedWords = (o: StandingOrder, v: Obj): Inert => {
  if (o.heaviest.length === 0) return ours("");
  if (blockDroppedWhole(v)) return WORDS.standingBlockNotUsed(o.heaviest.map((p) => WORDS.heaviestAs[p] ?? p));
  const aside = setAsideOf(v, o);
  const absent = o.heaviest.filter((p) => !aside.has(p));
  const byReason = groupBy(
    o.heaviest.filter((p) => aside.has(p)),
    (p) => aside.get(p) ?? ours(""),
  );
  return WORDS.standingNotEstablished(
    absent.map((p) => WORDS.notEstablishedPart[p] ?? markdownText(p)),
    [...byReason].map(([why, ps]) => ({ parts: ps.map((p) => WORDS.notEstablishedPart[p] ?? markdownText(p)), why: aside.get(ps[0] ?? "") ?? ours("") })),
    o.heaviest.map((p) => WORDS.heaviestAs[p] ?? p),
  );
};

/** One row of the evidence log's `standing[]`. */
function standingLogRow(it: Item): Obj {
  const o = it.order as StandingOrder;
  return {
    finding_id: str(it.verdict.finding_id),
    rule_id: str(it.candidate?.rule_id),
    group: o.group,
    order_tier: o.tier,
    status: o.status,
    ...(o.question ? { question: o.question } : {}),
    heaviest: [...o.heaviest],
    set_aside: [...new Set(arr(it.verdict.standing_set_aside).map((x) => str(obj(x)?.part)).filter(Boolean))],
    ...(o.regionOut.length > 0 ? { not_applying: o.regionOut.map((b) => b.cite) } : {}),
    raised: it.raise?.basis === "standing",
  };
}

/**
 * A question Fix first shows: a question
 * of the program's list findings wait on (`waits_on_answer`, NV3), a fact a seat named in words that no question carries
 * (`fact`, NV4), an answer of the person's the review found the code disagrees with (`check_answer`, NV12), or an
 * unanswered product question whose answer moves the order of what is to fix (`order_moving`, W7). Findings of every
 * level; none of them is counted as a problem, and none is cleared.
 */
export interface QuestionSlot {
  /** The profile field the question sets; for a fact, `fact:` and the rule id and the words. */
  question: string;
  header: string;
  text: string;
  kind: "waits_on_answer" | "order_moving" | "fact" | "check_answer";
  findingIds: string[];
  rules: string[];
  /** Its place in the order: the key of its heaviest finding under the unfavourable answer (W5) or the answer Yes (W7). */
  key: number[];
  /** Every finding it decides is high. */
  high: boolean;
  /** How many of its findings are at each level. */
  levels: { high: number; medium: number; low: number };
  /** A fact in words: the seat's words and the citation its `about` names. */
  fact?: { words: string; cite: string };
  /** Check your answer: the person's answer as the profile holds it (the option's label, else the value). */
  answer?: string;
}
interface QuestionText {
  header: string;
  text: string;
  /** The label of the option the value is, or null. */
  labelOf: (v: unknown) => string | null;
  /** The question's kind (`x-question.kind`, WP4), where it declares one. */
  kind?: string;
  /** The `settles_as` of the option the value is (WP4), where it declares one. */
  settlesAsOf: (v: unknown) => string | undefined;
  /** What an out-of-scope answer settles (`x-question.settled_covers`), where it says. */
  covers?: string;
}
/** The program's question source, read once per process; null where it cannot be read (then a field's own name is said). */
let declarationSource: DeclarationSource | null | undefined;
const declarationSourceOf = (): DeclarationSource | null => {
  if (declarationSource === undefined) {
    try {
      declarationSource = loadDeclarationSource();
    } catch {
      declarationSource = null;
    }
  }
  return declarationSource;
};
let questionTexts: Map<string, QuestionText> | null = null;
const questionTextOf = (field: string): QuestionText => {
  if (!questionTexts) {
    questionTexts = new Map();
    const source = declarationSourceOf();
    if (source)
      for (const f of source.fields)
        questionTexts.set(f.field, {
          header: f.x.header,
          text: f.x.question,
          labelOf: (v) => (v === undefined ? null : (f.x.options.find((op) => JSON.stringify(op.value) === JSON.stringify(v))?.label ?? null)),
          ...(typeof f.x.settled_covers === "string" && f.x.settled_covers !== "" ? { covers: f.x.settled_covers } : {}),
          ...(questionKindOf(source, f.field) ? { kind: questionKindOf(source, f.field) as string } : {}),
          settlesAsOf: (v) => {
            const op = v === undefined ? undefined : (f.x.options.find((o) => JSON.stringify(o.value) === JSON.stringify(v)) as { settles_as?: unknown } | undefined);
            return typeof op?.settles_as === "string" ? op.settles_as : undefined;
          },
        });
    /* no question source: the field's own name is said */
  }
  return questionTexts.get(field) ?? { header: field, text: field, labelOf: () => null, settlesAsOf: () => undefined };
};
const valueAt = (o: Obj | null, path: string): unknown => path.split(".").reduce<unknown>((v, k) => obj(v)?.[k], o);
/**
 * The questions the profile at hand answers: each question field of the program
 * holding a value that is not "unknown" (an empty or "unknown" list is no answer). Empty without a profile.
 */
function answeredQuestionsOf(profile: Obj | null): Set<string> {
  if (profile === null) return new Set();
  const held = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 && !v.includes("unknown") : v !== undefined && v !== null && v !== "unknown");
  return new Set(loadDeclarationSource().fields.map((f) => f.field).filter((f) => held(valueAt(profile, f))));
}
/** The order-moving product questions (section 3.4): `Minors` and `Health data`, and what each answer Yes moves. */
const ORDER_MOVING: readonly { field: string; which: "minors" | "health" }[] = [
  { field: "audience.minors_possible", which: "minors" },
  { field: "features.health_context", which: "health" },
];

/** What the disposition reads from the run, made once per assembly. */
interface DispositionContext {
  premises?: ReadonlyMap<string, string>;
  answers: ReadonlyMap<string, GivenAnswer>;
  roles?: ReadonlyMap<string, string>;
  duties?: ReadonlyMap<string, string>;
  secondLooks?: ReadonlyMap<string, SecondLook>;
}
/**
 * The person's answers a disposition reads (rows 6-8, 10): each question of the program the profile at hand answers
 * (`answeredQuestionsOf`), with the `settles_as` of the option the answer is. An option that declares none gives no
 * `settles_as`, and a wait on that question is then to fix (the direction of doubt; as H5a placed a wait on an answered
 * question at its heaviest).
 */
function givenAnswersOf(profile: Obj | null): Map<string, GivenAnswer> {
  const out = new Map<string, GivenAnswer>();
  for (const field of answeredQuestionsOf(profile)) {
    const settlesAs = questionTextOf(field).settlesAsOf(valueAt(profile, field));
    out.set(field, settlesAs === undefined ? {} : { settlesAs });
  }
  return out;
}
/**
 * The second look per finding: what its challenge record
 * returned (as the quote check left it: an invalidated one says `needs_human`), else `not_answered` where an entry of the run
 * stands for it; `injected` (a test's) is laid over both.
 */
/**
 * The first review's claim a finding is due a second look on (`claimOf`), from
 * its record, its kept places and the run's facts at `level`: the one asking of it, for the placement (step 12d) and for
 * telling a location look from a look at the first review's claim.
 */
function firstReviewClaimOf(it: Item, ctx: DispositionContext, rows: readonly PlaceRowIn[], level: string, dIn: DispositionInput = dispositionInputOf(it, ctx, rows)): ReturnType<typeof claimOf> {
  const decisiveFile = decisivePlaceOf(it.verdict, rows.filter((r) => KEPT_DECISIONS.has(str(r.decision))), it.candidate)?.file;
  const decisivePremise = decisiveFile !== undefined ? ctx.premises?.get(decisiveFile) : undefined;
  return claimOf({ input: dIn, level, ...(typeof dIn.role === "string" ? { role: dIn.role } : {}), ...(decisivePremise !== undefined ? { decisivePremise } : {}) });
}
function secondLooksOf(
  records: ReadonlyMap<string, { record: Obj; source?: string }>,
  entries: ReadonlyMap<string, string> | undefined,
  injected: ReadonlyMap<string, SecondLook> | undefined,
  carried: ReadonlyMap<string, { record: Obj }> = new Map(),
  modelOf?: ReadonlyMap<string, string>,
): Map<string, NonNullable<Item["secondLook"]>> {
  const out = new Map<string, NonNullable<Item["secondLook"]>>();
  for (const [id, q] of records) {
    const model = q.source !== undefined ? modelOf?.get(q.source) : undefined;
    out.set(id, { outcome: lookAnswerOf(q.record.outcome), record: q.record, due: false, ...(model ? { model } : {}) });
  }
  // A carried verdict's second look, read as its own run read it.
  for (const [id, c] of carried) if (!out.has(id)) out.set(id, { outcome: lookAnswerOf(c.record.outcome), record: c.record, due: false });
  for (const id of entries?.keys() ?? []) if (!out.has(id)) out.set(id, { outcome: "not_answered", due: false });
  for (const [id, o] of injected ?? []) out.set(id, { ...(out.get(id) ?? { due: false }), outcome: o });
  return out;
}
function dispositionContextOf(findings: Obj, input: AssembleInput): DispositionContext {
  // A premise the program does not know is `unknown`, which ships (design section 5.2); the one reading of the document's
  // premises, which the second look's launch side reads too (second-look.ts).
  const premises = premisesOfFindings(findings);
  return {
    ...(premises ? { premises } : {}),
    answers: givenAnswersOf(input.profile ?? null),
    ...(input.ruleRoles ? { roles: input.ruleRoles } : {}),
    ...(input.ruleDuties ? { duties: input.ruleDuties } : {}),
    ...(input.secondLooks ? { secondLooks: input.secondLooks } : {}),
  };
}
/**
 * One finding's disposition input, resolved from its record, its candidate, its kept place rows and the run's facts
 * (design section 2.1). A record the final quotation check invalidated gives no part (S7): its block is set aside whole.
 */
function dispositionInputOf(it: Item, ctx: DispositionContext, rows: readonly PlaceRowIn[]): DispositionInput {
  const v = it.verdict;
  const id = str(v.finding_id);
  const invalid = v.quote_check_outcome === "invalidated";
  const raw = obj(v.standing);
  const st = !invalid && raw ? (raw as StandingRecord) : undefined;
  const setAside = [...new Set([...arr(v.standing_set_aside).map((x) => str(obj(x)?.part)).filter(Boolean), ...(invalid && raw ? ["standing"] : [])])];
  const kept = rows.filter((r) => KEPT_DECISIONS.has(str(r.decision)));
  const keptFiles = kept.length > 0 ? kept.map((r) => r.file) : arr(it.candidate?.locations).map((l) => str(obj(l)?.file)).filter(Boolean);
  const seat = typeof st?.ships?.value === "string" ? st.ships.value : undefined;
  const decisiveFile = decisivePlaceOf(v, kept, it.candidate)?.file;
  // Row 5's input through declaration.ts's one reading (WP4's kinds).
  const declared = declaredInapplicableOf(declarationSourceOf(), it.candidate?.declared_inapplicable_preconditions);
  const role = ctx.roles?.get(str(it.candidate?.rule_id));
  const dutyAbout = ctx.duties?.get(str(it.candidate?.rule_id));
  const second = ctx.secondLooks?.get(id);
  const folded = it.foldedUnder;
  return {
    verdict: str(v.verdict),
    ...(st ? { standing: st } : {}),
    ...(setAside.length > 0 ? { setAside } : {}),
    ...(folded ? { foldedUnder: folded } : {}),
    ships: effectiveShipsOf({ ...(seat !== undefined ? { seat } : {}), ...(decisiveFile !== undefined ? { decisiveFile } : {}), keptFiles, ...(ctx.premises ? { premises: ctx.premises } : {}) }),
    ...(declared.length > 0 ? { declaredInapplicable: declared } : {}),
    answers: ctx.answers,
    ...(role ? { role } : {}),
    ...(dutyAbout ? { dutyAbout } : {}),
    ...(second ? { secondLook: second } : {}),
  };
}
/**
 * One finding as the fold reads it (fold-findings.ts): its own disposition and level,
 * the effective `ships` of its places, its kept places as lines, and the line its review traced it to where that part
 * stood (an invalidated record gives none, S7). A finding with no disposition (refused before step 12d) is not shown.
 */
function foldEntryOf(it: Item, holds: boolean, ctx: DispositionContext, rows: readonly PlaceRowIn[]): FoldEntry {
  const x = dispositionInputOf(it, ctx, rows);
  const kept = rows.filter((r) => KEPT_DECISIONS.has(str(r.decision)));
  const decided = (r: PlaceRowIn): { file: string; from: number; to: number }[] => {
    const m = /^(\d+)(?:-(\d+))?$/.exec(String(r.line_decided ?? "").trim());
    return m ? [{ file: r.file, from: Number(m[1]), to: Number(m[2] ?? m[1]) }] : [];
  };
  const places =
    kept.length > 0
      ? kept.flatMap((r) => [{ file: r.file, from: r.line, to: r.line }, ...decided(r), ...(r.beyond && str(r.beyond.file) ? [{ file: r.beyond.file, from: r.beyond.line, to: r.beyond.line }] : [])])
      : arr(it.candidate?.locations)
          .map(obj)
          .filter((l): l is Obj => !!l && str(l.file) !== "")
          .map((l) => ({ file: str(l.file), from: Number(l.start_line), to: Number(l.end_line ?? l.start_line) }));
  const sa = obj(x.standing?.same_as);
  const settles = typeof x.standing?.settles === "string" ? x.standing.settles : "";
  const waitsOn = str(obj(x.standing?.question)?.value) || (settles.startsWith("question:") ? settles.slice("question:".length) : "");
  return {
    id: str(it.verdict.finding_id),
    rule: str(it.candidate?.rule_id),
    shown: holds && it.disp !== undefined,
    disposition: it.disp?.disposition ?? "to_fix",
    level: it.raise?.severity ?? str(it.candidate?.severity),
    ...(x.ships ? { ships: x.ships } : {}),
    places,
    ...(sa && typeof sa.file === "string" ? { sameAs: { file: sa.file, line: Number(sa.line) } } : {}),
    ...(waitsOn ? { waitsOn } : {}),
  };
}
/** The fact a finding waits on, named in words by its seat (a `waits_on_answer` with no question), or null. */
function factOf(it: Item): { words: string; about: string } | null {
  if (it.verdict.quote_check_outcome === "invalidated") return null;
  const st = obj(it.verdict.standing) as StandingRecord | null;
  const f = st?.fact;
  if (str(obj(st?.status)?.value) !== "waits_on_answer" || str(obj(st?.question)?.value) !== "" || !f || typeof f.words !== "string" || typeof f.about !== "string") return null;
  return { words: f.words, about: f.about };
}
/** The level a finding is shown at: a fold head's (the highest of its members', never lower), else its raise's, else its rule's. */
const levelOfItem = (it: Item): string => it.foldLevel ?? it.raise?.severity ?? str(it.candidate?.severity);
const levelsOf = (its: readonly Item[]): QuestionSlot["levels"] => ({
  high: its.filter((it) => levelOfItem(it) === "high").length,
  medium: its.filter((it) => levelOfItem(it) === "medium").length,
  low: its.filter((it) => levelOfItem(it) !== "high" && levelOfItem(it) !== "medium").length,
});
const dispositionOfItem = (it: Item): Disposition => it.disp?.disposition ?? "to_fix";
/**
 * THE ONE FUNCTION a line that tells the person where a finding sits takes its
 * words from (`details.md`, `not-checked.md`), given the finding's final placement (`dispositionOfItem`, after the fold). A
 * line keyed on one answer (the second look's) said "It is counted to fix" beside a finding placed with counsel.
 */
export const placedWords = (d: Disposition | string): Inert => WORDS.placedNV[d] ?? markdownText(d);

/**
 * The question slots of Fix first, from the findings' dispositions (design
 * sections 2.2 and 3.1). Findings whose disposition is `question` and that wait on one question of the program make
 * one slot (NV3); those that wait on a fact in words make one slot per rule and fact (NV4); those whose disposition is
 * `check_answer` make one slot per answer and rule (NV12). Each takes the key of its heaviest finding as it stands (the
 * unfavourable answer). A product question the person left unanswered makes a slot only where its answer Yes would move
 * a finding to fix into O1 or O2 (W7); with no profile at hand nothing is known to be unanswered, and no such slot is made.
 */
export function questionSlotsOf(items: readonly Item[], profile: Obj | null): QuestionSlot[] {
  const out: QuestionSlot[] = [];
  const keyOf = (its: readonly Item[]): number[] => its.map((it) => (it.order ? orderKeyOf(it.order) : [0, 0, 0, 0])).sort(compareKeys)[0] as number[];
  const slot = (its: Item[], rest: Omit<QuestionSlot, "findingIds" | "rules" | "key" | "high" | "levels">): QuestionSlot => ({
    ...rest,
    findingIds: its.map((it) => str(it.verdict.finding_id)).sort(),
    rules: [...new Set(its.map((it) => str(it.candidate?.rule_id)))].sort(),
    key: keyOf(its),
    high: its.every((it) => levelOfItem(it) === "high"),
    levels: levelsOf(its),
  });
  const asking = items.filter((it) => dispositionOfItem(it) === "question");
  for (const [q, its] of groupBy(asking.filter((it) => it.order?.question), (it) => it.order?.question as string)) {
    const t = questionTextOf(q);
    out.push(slot(its, { question: q, header: t.header, text: t.text, kind: "waits_on_answer" }));
  }
  for (const [k, its] of groupBy(asking.filter((it) => !it.order?.question && factOf(it)), (it) => `fact:${str(it.candidate?.rule_id)}:${factOf(it)?.words}`)) {
    const f = factOf(its[0] as Item) as { words: string; about: string };
    const bi = basisIndexOf(f.about);
    const cite = bi !== null ? str(arr(its[0]?.candidate?.legal_basis_refs)[bi]) : "";
    out.push(slot(its, { question: k, header: f.words, text: f.words, kind: "fact", fact: { words: f.words, cite: cite ? citationOf(cite) : f.about } }));
  }
  const checking = items.filter((it) => dispositionOfItem(it) === "check_answer");
  const fieldOf = (it: Item): string => declaredInapplicableOf(declarationSourceOf(), it.candidate?.declared_inapplicable_preconditions).find((d) => d.kind === "feature")?.field ?? "";
  for (const [, its] of groupBy(checking, (it) => `${fieldOf(it)} ${str(it.candidate?.rule_id)}`)) {
    const field = fieldOf(its[0] as Item);
    const t = questionTextOf(field);
    const value = valueAt(profile, field);
    out.push(slot(its, { question: field, header: t.header, text: t.text, kind: "check_answer", answer: t.labelOf(value) ?? (value === undefined ? "" : String(value)) }));
  }
  if (profile) {
    for (const { field, which } of ORDER_MOVING) {
      const v = valueAt(profile, field);
      if (v !== undefined && v !== null) continue;
      const moved = items.filter((it) => it.order && it.orderInput && dispositionOfItem(it) === "to_fix" && tierIfAnswered(it.order, it.orderInput, which) !== null);
      if (moved.length === 0) continue;
      const key = moved.map((it) => orderKeyOf(standingOrderOf({ ...(it.orderInput as StandingOrderInput), answers: { ...it.orderInput?.answers, [which]: true } }))).sort(compareKeys)[0] as number[];
      const t = questionTextOf(field);
      out.push({ ...slot(moved, { question: field, header: t.header, text: t.text, kind: "order_moving" }), key, high: false });
    }
  }
  return out;
}

function reportModel(a: ReportArgs): ReportModel {
  const titleOf = new Map<string, string>();
  for (const c of a.candidates) if (str(c.title)) titleOf.set(str(c.rule_id), str(c.title));
  for (const r of a.silent) titleOf.set(str(r.rule_id), str(r.title));
  // The rule's own short plain name (`short_name` in rule.yaml, compiled into rules.json)
  // where it has one; until then the mock's fallback, its title up to the first " - ".
  // A rule's plain name is the bundle's; a rule id the bundle does not name (a record's) is a value.
  const plainOf = (ruleId: string): Inert => {
    const named = a.shortNames?.get(ruleId) || (titleOf.get(ruleId) ?? "").split(" - ")[0];
    return named ? programText(named) : markdownText(ruleId.split(" - ")[0] || ruleId);
  };
  // One level per finding for every presenter: a fold head's is the highest of its members'.
  const sevOf = levelOfItem;
  const heldOf = (it: Item): ReportRow[] =>
    ((a.placeRows?.get(str(it.verdict.finding_id)) ?? []) as readonly ReportRow[]).filter((r) => KEPT_DECISIONS.has(str(r.decision)));
  const shown = a.items.filter((it) => it.label === "candidate" || it.label === "not_yet_refuted" || it.label === "no_second_check" || it.label === "counsel");
  shown.sort((x, y) => {
    const s = (SEVERITY_RANK[sevOf(x)] ?? 3) - (SEVERITY_RANK[sevOf(y)] ?? 3);
    if (s !== 0) return s;
    // Within a level, the order key: group, order tier, how it runs, who it reaches.
    const k = x.order && y.order ? compareKeys(orderKeyOf(x.order), orderKeyOf(y.order)) : 0;
    if (k !== 0) return k;
    const c = (CONFIDENCE_RANK[str(x.verdict.confidence)] ?? 3) - (CONFIDENCE_RANK[str(y.verdict.confidence)] ?? 3);
    return c !== 0 ? c : str(x.verdict.finding_id) < str(y.verdict.finding_id) ? -1 : 1;
  });
  /* Which "not applicable" answers are partly checked. */
  const notApplicable = a.items.filter((it) => it.label === "dismissed" || it.label === "overturned");
  notApplicable.sort((x, y) => (str(x.verdict.finding_id) < str(y.verdict.finding_id) ? -1 : 1));
  // An answer a second review gave without quoting anything is one kind of its own, in neither list.
  const unquoted = notApplicable.filter((it) => overturnedUnquoted(a.summary, it));
  const partly = notApplicable.filter((it) => !unquoted.includes(it) && (it.notChecked || placesOpen(it) || overturnedOnGate(it)));
  const dismissed = notApplicable.filter((it) => !unquoted.includes(it) && !it.notChecked && !placesOpen(it) && !overturnedOnGate(it));
  // The first finding (in the order above) that disagrees with each answer the person gave, for `not-checked.md`.
  const contradictedBy = new Map<string, { rule: string; where: string }>();
  for (const it of shown) {
    for (const expr of arr(it.candidate?.declared_inapplicable_preconditions).map(str)) {
      if (!contradictedBy.has(expr)) contradictedBy.set(expr, { rule: str(it.candidate?.rule_id) || WORDS.ruleNotInFindings, where: whereOf(it.verdict, it.candidate ?? {}, heldOf(it)) });
    }
  }
  const target = str(a.findings.target);
  return {
    a,
    project: (target && basename(target.replace(/[\\/]+$/, ""))) || str(a.findings.scan_id) || "(unnamed)",
    titleOf,
    plainOf,
    sevOf,
    heldOf,
    shown,
    partly,
    overturnedUnquoted: unquoted,
    notRefuted: a.items.filter((it) => it.label === "not_yet_refuted"),
    dismissed,
    unread: a.items.filter((it) => it.notChecked),
    notAnswered: a.unadjudicated.filter((u) => str(u.reason) === "not_answered"),
    invalidAnswers: a.unadjudicated.filter((u) => str(u.reason) === "invalid_answer"),
    unusableAnswers: a.unadjudicated.filter((u) => str(u.reason) === "unusable_answer"),
    byShape: a.unadjudicated.filter((u) => !["invalid_answer", "not_answered", "unusable_answer"].includes(str(u.reason))),
    candidateById: new Map(a.candidates.map((c) => [str(c.finding_id), c] as const)),
    contradictedBy,
    dispOf: dispositionOfItem,
    itemById: new Map(shown.map((it) => [str(it.verdict.finding_id), it] as const)),
    counts: dispositionCountsOf(shown, sevOf, a.questions ?? [], a.preSettled.length),
  };
}

/* A4 (VA-1), RK-4 and C2-1, as `buildReport` held them: kept for the not-applicable split. */
const keptUnder = (it: Item): number => (it.placeRead && it.label === "dismissed" ? it.placeRead.summary.kept : 0);
const placesOpen = (it: Item): boolean =>
  !!it.placeRead && ((it.placeRead.summary.undetermined ?? 0) > 0 || it.placeRead.summary.not_checked.some((r) => r.places > 0) || keptUnder(it) > 0);

/**
 * THE LINE THAT NAMES A FINDING, on every screen: the review's
 * decisive quotation, where its block names one that stood; else its first kept place; else its first quotation; else
 * its first matched line. details.md's heading, Findings by area, the end screen's "Start with these" and not-checked.md
 * all name a finding by it. A screen that shows another line on purpose (Fix first, the line a raise rests on) says
 * what that line is beside it. `rows` are the finding's kept place rows.
 */
function namingPlaceOf(v: Obj, rows: readonly PlaceRowIn[], c: Obj | undefined): string {
  // The review's decisive quotation, where its block names one that stood.
  const d = decisivePlaceOf(v, rows);
  if (d) return `${d.file}:${d.line}`;
  const h = rows[0];
  if (h) return `${h.file}:${h.line}`;
  const e = arr(v.evidence).map(obj).filter((x): x is Obj => !!x)[0];
  if (e) return `${str(e.file)}:${str(e.lines)}`;
  const l = arr(c?.locations).map(obj).filter((x): x is Obj => !!x)[0];
  return l ? `${str(l.file)}:${Number(l.start_line)}` : WORDS.unrecordedLocation;
}
/** Where the report puts one finding: `namingPlaceOf` over its kept place rows. */
function placeOf(m: ReportModel, it: Item): string {
  return namingPlaceOf(it.verdict, m.heldOf(it), it.candidate);
}
/** A finding named by its place, linked to its own file (in a group's file, to its place's section). */
const detailLink = (m: ReportModel, it: Item): Inert => {
  const l = m.files?.byId.get(str(it.verdict.finding_id));
  const short = m.files?.shortOf.get(str(it.verdict.finding_id)) ?? hexOf(str(it.verdict.finding_id));
  const target = !l ? "ruled-out.md" : l.items.length > 1 ? `${l.file}#${anchorOfHeading(WORDS.groupMemberHeading(markdownText(short)))}` : l.file;
  return md`[${inSpan(code(placeOf(m, it)))}](${linkTarget(target)})`;
};
const areaOf = (ruleId: string): Inert => (WORDS.areas.find(([p]) => ruleId.startsWith(p)) ?? [ours(""), WORDS.areaOther])[1];
const areaRank = (area: string): number => {
  const i = WORDS.areas.findIndex(([, n]) => n === area);
  return i < 0 ? WORDS.areas.length : i;
};
function dataPhrase(words: ReadonlySet<string>): Inert {
  const ws = Object.keys(WORDS.dataWords).filter((w) => words.has(w)).map((w) => WORDS.dataWords[w] ?? ours(""));
  const shownWs = ws.length > 3 ? [...ws.slice(0, 3), WORDS.moreKinds(ws.length - 3)] : ws;
  return ws.length > 0 ? WORDS.peoples(listWords(shownWs)) : ours("");
}
/*
 * A host the record establishes, or none. Established: the host of a URL (`https://api.example.com/v1`,
 * a quoted `//cdn.example.net/x`), or a configured endpoint - a quoted host given to a key or argument that names a host
 * (`host: "smtp.example.org"`, `:address => 'smtp.example.org'`) or as the first argument of a connection call
 * (`Net::HTTP.new('www.gravatar.com', 80)`). Never a quoted dotted string on its own, which is as often an identifier
 * (`localStorage.setItem("app.token", t)`, `params["user.email"]`, `require("lodash.debounce")`): before this fix Before this, any quoted dotted string was taken as a host.
 */
const HOST = "([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)";
const HOST_ESTABLISHED: readonly RegExp[] = [
  new RegExp(`\\b(?:https?|wss?|ftps?|smtps?|mqtts?|amqps?)://(?:[^\\s/@'"\`]+@)?${HOST}`, "i"),
  new RegExp(`['"\`]//${HOST}`, "i"),
  new RegExp(`(?:^|[^a-z0-9_])(?:host|hostname|endpoint|server|domain|address|api_?host|smtp_?host|base_?url)['"]?\\s*(?:=>|[:=])\\s*['"\`]${HOST}['"\`/:]`, "i"),
  new RegExp(`(?:^|[^a-z0-9_])(?:HTTP\\.(?:new|start)|(?:SMTP|FTP|IMAP|POP3)\\.(?:new|start)|TCPSocket\\.(?:new|open)|createConnection|connect)\\(\\s*['"\`]${HOST}['"\`]`, "i"),
];
/*
 * A quoted name given to a host-named key or to a connection call is a host only where
 * its last label is a top-level domain a service is reached under - so neither a file name (`sqlite3.connect("users.db")`,
 * `"config.json"`) nor an API method (`endpoint: 'chat.postMessage'`) is ever named as a recipient. Two-letter labels are
 * country domains, except the extensions source and data files carry far more often than a host does; longer labels are
 * the generic domains below and the private suffixes a deployment's own hosts use. A URL's host is taken as written: the
 * URL itself establishes it. A host not named here is left unnamed, and the line takes the rule's own words.
 */
const FILE_EXTENSION_LABELS = new Set(["db", "js", "ts", "rb", "py", "md", "sh", "rs", "go", "pl", "so", "cs", "fs", "kt", "gz", "xz", "bz", "ps", "el", "mk", "hs", "ex", "jl", "pm", "vb", "ml"]);
const HOST_TLDS = new Set([
  "com", "org", "net", "edu", "gov", "mil", "int", "info", "biz", "name", "pro", "aero", "coop", "mobi", "asia", "tel", "travel", "jobs",
  "dev", "app", "cloud", "tech", "online", "site", "xyz", "top", "shop", "store", "blog", "news", "live", "page", "link", "host", "run",
  "services", "systems", "network", "email", "digital", "software", "solutions", "website", "space", "world", "zone", "works", "tools",
  "local", "internal", "localdomain", "lan", "corp", "home", "test", "example", "invalid", "localhost",
]);
const isServiceHost = (h: string): boolean => {
  const last = (h.toLowerCase().split(".").pop() ?? "").trim();
  if (!/^[a-z]+$/.test(last)) return false;
  return last.length === 2 ? !FILE_EXTENSION_LABELS.has(last) : HOST_TLDS.has(last);
};
const hostOf = (s: string): string | undefined => {
  for (const [i, re] of HOST_ESTABLISHED.entries()) {
    const m = s.match(re);
    if (m?.[1] && (i < 2 || isServiceHost(m[1]))) return m[1];
  }
  return undefined;
};

/**
 * The recipient a held place's row names, for its Fix-first line, or none (found by comparing the report with a
 * mock-up on one run's records, where a destination rule's line read "go to 4,13, 31 and 15" and a secret-in-a-URL line
 * named the secret's parameters as recipients): a quoted host in the program's item or the shown item, wherever it is;
 * else, for a rule whose construct IS a recipient outside the operator (OUTSIDE_OPERATOR_RULES), the shown item where it
 * is a name (the matched vendor word, or the seat's own item). Never the program's identity of a clause set or of a
 * line's shape, and never another flow rule's item, which names what is sent (a parameter, a field), not who gets it.
 * None named, an outside-recipient rule's line takes the rule's own words for its recipient.
 */
function recipientOf(rule: string, source: string | null, r: ReportRow): string | undefined {
  const host = hostOf(str(r.program_item)) ?? hostOf(str(r.item));
  if (host) return host;
  if (!OUTSIDE_OPERATOR_RULES.has(rule)) return undefined;
  if (r.program_item === undefined || source !== "token") return undefined;
  /* A vendor the rule knows, never a word the code happened to hold. A token item is shown by the
   * name of the vocabulary entry its matched word spells ("Sentry") where the rule has one; a matched word that spells
   * no entry is shown by the word itself, quoted (item-label.ts `matchedWordsLabel`), and that is a name the code holds
   * - a configuration key, say - not a company. A seat's own name for an item (no
   * program item) is not taken either: nothing the rule carries says it is a vendor. Unnamed, the line takes the rule's
   * own words for its recipient. */
  const x = str(r.item);
  return x !== "" && x !== matchedWordsLabel(r.program_item) && !/[(=]/.test(x) && !/^[\d,\s]+$/.test(x) ? x : undefined;
}

/** A standing item's second-line words (W2b), with W3/W4/W21 by its group and W13 where a part did not stand. */
function standingWhyOf(m: ReportModel, it: Item): Inert {
  const o = it.order as StandingOrder;
  const answers = orderAnswersOf(m.a.profile ?? null);
  const at = (part: "ships" | "status"): Inert => {
    const a = obj(it.verdict.standing)?.[part];
    const ref = obj(a)?.at;
    const d = typeof ref === "string" ? decisivePlaceOf({ ...it.verdict, standing: { decisive: ref } }, m.heldOf(it)) : obj(ref) ? { file: str(obj(ref)?.file), line: Number(obj(ref)?.line) } : null;
    return d ? md`${inSpan(code(`${d.file}:${d.line}`))}` : WORDS.unrecordedLocation;
  };
  const parts: Inert[] = [];
  // Why a finding is not counted is said by its disposition (NV5-NV8); here
  // only what describes a finding that ships (W3's maker site and example deployment) and an answer it stands against (W21).
  if (o.ships === "maker_site" || o.ships === "documented_example") parts.push((WORDS.shipsWords[o.ships] ?? ((x: Inert) => x))(at("ships")));
  if (arr(it.candidate?.declared_inapplicable_preconditions).length > 0 && m.dispOf(it) !== "check_answer") parts.push(...againstAnswerWords(m, it));
  // Data that did not stand are not named, not even as "data".
  const why = WORDS.fixWhy(standingDataWords(o), standingPeopleWords(o, answers), standingRunsWords(o), lawWordsOf(o, scanDayOf(m)));
  if (why) parts.push(why);
  const ne = notEstablishedWords(o, it.verdict);
  if (ne) parts.push(ne);
  return inertJoin(parts, ours(" "));
}
/** W21: for each answer of the person's the candidate stands against, its question and the answer. */
function againstAnswerWords(m: ReportModel, it: Item): Inert[] {
  return declaredInapplicableOf(declarationSourceOf(), it.candidate?.declared_inapplicable_preconditions)
    .map(({ field }) => {
      const t = questionTextOf(field);
      const v = valueAt(m.a.profile ?? null, field);
      // Never an answer the profile does not hold.
      return WORDS.againstAnswer(markdownText(t.header), textOrNull(t.labelOf(v) ?? (v === undefined ? null : String(v))));
    });
}

/** The two lines of one Fix-first group (proposal section 1, item 2). */
function fixLines(m: ReportModel, i: number, group: Item[], placeOfEarlier: ReadonlyMap<string, number>): { place: string; lines: Inert[]; facts: { body: Inert; short: Inert; why: string; place: string; decisive: Item } } {
  const it0 = group[0] as Item;
  const rule = str(it0.candidate?.rule_id);
  /* Where a finding of the group was raised, the line speaks of the place the raise rests on: its
   * data (the raise's own), its recipients (the rows there), the transport its plaintext place establishes, and the
   * place shown is that one - never another place of the finding, whose line may be no transport at all. A raise at a
   * call with transport without protection is preferred; else a raise by another finding of the same flow at one line. */
  const raised = group.find((it) => it.raise?.basis === "place" && it.raise.plaintext) ?? group.find((it) => it.raise);
  const r0 = raised?.raise;
  const inCall = (r: ReportRow): boolean => !!r0 && r.file === r0.file && r.line >= r0.line && r.line <= (r0.to_line ?? r0.line);
  const callRows = raised ? m.heldOf(raised).filter(inCall) : [];
  const held = callRows.length > 0 ? callRows : group.flatMap((it) => m.heldOf(it));
  /* Where the review's block established the data, "involves" says them and
   * whose they are, from the block; the place rows' six words keep deciding the transport raise as before. */
  const o = it0.order;
  const answers = orderAnswersOf(m.a.profile ?? null);
  const blockData = !!o && o.hasBlock && !o.heaviest.includes("data");
  const peopleW = o && blockData ? standingPeopleWords(o, answers) : "";
  const dp =
    o && blockData
      ? md`${standingDataWords(o)}${peopleW ? md` of ${peopleW}` : ours("")}`
      : dataPhrase(new Set(r0 && r0.basis !== "standing" && r0.data.length > 0 ? r0.data : held.flatMap((r) => [...(r.data ?? [])])));
  const facts: Inert[] = [];
  if (rule === CREDENTIAL_RULE_ID) {
    const names = [...new Set(held.map((r) => str(r.item)).filter(Boolean))];
    facts.push(WORDS.credentialWhere(inertJoin(names.map((n) => md`${inSpan(code(n))}`), ours(", ")) || WORDS.aCredential));
  } else if (FLOW_RULES.has(rule)) {
    const source = it0.candidate ? programItemSourceOf(it0.candidate as unknown as Candidate) : null;
    const to = held.map((r) => recipientOf(rule, source, r)).filter((x): x is string => !!x);
    // FLOW_RULES' words for a rule that is not an outside recipient describe the construct ("a secret in a URL query built
    // for sending"), not who receives the data: such a line says what is involved instead.
    const recip = to.length > 0 ? listWords([...new Set(to)].slice(0, 3)) : (OUTSIDE_OPERATOR_RULES.get(rule) ?? "");
    if (recip) facts.push(dp ? WORDS.goesTo(dp, markdownText(recip)) : WORDS.goesToUnnamed(markdownText(recip)));
    else if (dp) facts.push(WORDS.involves(dp));
  } else if (dp) facts.push(WORDS.involves(dp));
  // The transport's words follow what its place establishes (`Item.transport`); a place that is no transport has none.
  const tw = (raised?.raise?.plaintext ? raised : group.find((it) => it.transport))?.transport;
  const how = tw ? WORDS.transport(markdownText(tw.over), markdownText(tw.reads)) : ours("");
  const raisedFrom = r0?.rule_severity;
  const raisedWords = !r0
    ? ours("")
    : r0.basis === "standing"
      ? md` ${markdownProse(r0.because)}`
      : r0.basis === "flow" && r0.flow
        ? WORDS.raisedByFlow(markdownText(r0.rule_severity), m.plainOf(r0.flow.rule_id))
        : WORDS.raisedFrom(markdownText(r0.rule_severity));
  // How many of the group's findings need judgement, where the group holds more than one.
  const nCounsel = group.filter((it) => it.label === "counsel").length;
  const counsel = nCounsel > 0 ? md` (${WORDS.counselOf(nCounsel, group.length)})` : ours("");
  const body = inertTrim(md`${inertJoin(facts, ours(", "))}${how}`);
  // The item line leads with the review's effect where its block gave one, and names the rule after it.
  const effect = o?.hasBlock ? said(str(obj(it0.verdict.standing)?.effect), 170) : ours("");
  const count = md`${group.length > 1 ? md` (${group.length})` : ours("")}${counsel}`;
  const head = effect
    ? md`${WORDS.fixEffect(i, effect, count, m.plainOf(rule))}${raisedFrom ? raisedWords : ours("")}`
    : md`${i}. **${m.plainOf(rule)}**${count}${body ? md`: ${body}` : ours("")}.${raisedFrom ? raisedWords : ours("")}`;
  const places = placesOfItems(m, group);
  const shownRow = callRows[0] ?? m.heldOf(it0)[0];
  // The second line: the block's data, people, how it runs and the duty's tier
  // where they stood; for an item of group 1-3 the words that say why it is not counted as to fix; what was not established.
  /* A block's item takes the block's words whatever part did not
   * stand (W13 says which; they no longer print how it runs as a fact). Before, an item whose `runs` did not stand fell
   * back to the place row's reason, the seat's own prose: the second smoke test printed "...and I found no deploymen…".
   * Where a place row's reason is printed (an item with no block), it is the review's, said as such, and cut only
   * between words (`oneLine`). */
  const rowWhy = said(str(shownRow?.why), 170);
  const why = rule === CREDENTIAL_RULE_ID && !(o && blockData) ? ours("") : o?.hasBlock ? standingWhyOf(m, it0) : rowWhy ? WORDS.reviewSaidOfPlace(rowWhy) : ours("");
  const place = raised && r0 && r0.basis !== "standing" ? `${r0.file}:${r0.line}` : placeOf(m, it0);
  const sameAs = placeOfEarlier.get(place);
  // The line a raise rests on, shown on purpose, says what it is
  // where it is not the line that names the finding on every other screen.
  const own = placeOf(m, raised ?? it0);
  const link = md`[${inSpan(code(place))}](${linkTarget(m.files?.byId.get(str((raised ?? it0).verdict.finding_id))?.file ?? "report.md")})${place !== own ? WORDS.raiseLineIs(code(own)) : ours("")}`;
  const more = places > 1 ? md` ${WORDS.morePlaces(places - 1)}` : ours("");
  /* A group that opens at the place an earlier group of the list already showed is that same
   * sending seen by another check; it is one line, marked with the number it shares the place with, and the place's own
   * line is not written twice. */
  const sentence = (t: Inert): Inert => (t ? md`${inertCapital(t)}.` : ours(""));
  const cardFacts = { body: sentence(body), short: sentence(inertTrim(inertJoin(facts, ours(", ")))), why: str(shownRow?.why), place, decisive: raised ?? it0 };
  return sameAs === undefined
    ? { place, facts: cardFacts, lines: [head, md`   ${link}${more}${why ? md` — ${why}` : ours("")}`] }
    : { place, facts: cardFacts, lines: [md`${head}${WORDS.fixSamePlace(sameAs, link, more)}${why ? md` — ${why}` : ours("")}`] };
}

/** `report.md`: the first screen, then the work list by area, then the coverage sentence and the disclaimer. */
/* A finding waiting on an answer is shown in its
 * question's slot, not as an item of its own; "to fix first" counts the high findings whose disposition is `to_fix` (NV1). */
/** One entry of Fix first: a group of high findings of one rule, or a question slot. */
type FixEntry = { group: Item[]; key: number[] } | { question: QuestionSlot; key: number[] };
/**
 * Fix first's entries in their order: the high findings waiting on no answer, grouped by rule, and the question slots. One order for report.md's Fix first and the end screen's "Start with
 * these" (`endSummaryOf`), which before broke ties its own way (confidence, then finding id) and so could list two
 * findings of one key the other way round.
 */
function fixFirstEntries(m: ReportModel): FixEntry[] {
  // The high findings to fix (design section 2.2 row 10), by rule.
  const high = m.shown.filter((it) => m.sevOf(it) === "high" && m.dispOf(it) === "to_fix");
  const groups = [...groupBy(high, (it) => str(it.candidate?.rule_id)).values()];
  const score = (g: Item[]): number[] => {
    const rule = str(g[0]?.candidate?.rule_id);
    return [g.some((it) => it.raise) ? 0 : 1, PLAINTEXT_RULES.has(rule) ? 0 : 1, FLOW_RULES.has(rule) ? 0 : 1, Math.min(...g.map((it) => CONFIDENCE_RANK[str(it.verdict.confidence)] ?? 3))];
  };
  // A group takes the key of its heaviest member; today's score and the rule id break ties.
  const keyOfGroup = (g: Item[]): number[] => g.map((it) => (it.order ? orderKeyOf(it.order) : [0, 0, 0, 0])).sort(compareKeys)[0] ?? [0, 0, 0, 0];
  groups.sort((x, y) => {
    const k = compareKeys(keyOfGroup(x), keyOfGroup(y));
    if (k !== 0) return k;
    const p = score(x);
    const q = score(y);
    for (let k = 0; k < p.length; k++) if (p[k] !== q[k]) return (p[k] as number) - (q[k] as number);
    return str(x[0]?.candidate?.rule_id) < str(y[0]?.candidate?.rule_id) ? -1 : 1;
  });
  // Questions take Fix-first slots like groups, at their key (stable: a group goes before a question of the same key).
  const entries: FixEntry[] = [...groups.map((g) => ({ group: g, key: keyOfGroup(g) })), ...(m.a.questions ?? []).map((q) => ({ question: q, key: q.key }))];
  // Design section 3.1: a "check your answer" slot goes before an ordinary question of the same key.
  const rank = (e: FixEntry): number => ("group" in e ? 0 : e.question.kind === "check_answer" ? 1 : 2);
  entries.sort((x, y) => compareKeys(x.key, y.key) || rank(x) - rank(y));
  return entries;
}
/** A part of the review's block as the line it names (`file:line`), or "". */
function standingAtOf(m: ReportModel, it: Item, part: "ships" | "status"): string {
  const ref = obj(obj(it.verdict.standing)?.[part])?.at;
  const d = typeof ref === "string" ? decisivePlaceOf({ ...it.verdict, standing: { decisive: ref } }, m.heldOf(it)) : obj(ref) ? { file: str(obj(ref)?.file), line: Number(obj(ref)?.line) } : null;
  return d && d.file ? `${d.file}:${d.line}` : "";
}
/** The question a finding waits on, from its block (`question`, or a `needs_human`'s `settles: question:`), or "". */
function waitQuestionOf(it: Item): string {
  const st = obj(it.verdict.standing);
  const q = str(obj(st?.question)?.value);
  if (q) return q;
  const settles = str(st?.settles);
  return settles.startsWith("question:") ? settles.slice("question:".length) : "";
}
/** NV5-NV7 and the answered "met": why a `recorded` finding records processing and is not counted. */
function recordedWhyOf(m: ReportModel, it: Item): Inert {
  const st = obj(it.verdict.standing) as StandingRecord | null;
  const status = str(obj(st?.status)?.value);
  const at = code(standingAtOf(m, it, "status") || placeOf(m, it));
  if (status === "duty_met") return WORDS.dutyMetNV(at, markdownText(str(st?.element)));
  if (status === "exempt") {
    const bi = basisIndexOf(str(st?.exemption?.basis));
    const cite = bi !== null ? str(arr(it.candidate?.legal_basis_refs)[bi]) : "";
    return WORDS.exemptNV(cite ? programText(citationOf(cite)) : markdownText(str(st?.exemption?.basis)), markdownText(str(st?.exemption?.limb)), at);
  }
  const q = waitQuestionOf(it);
  if (q) {
    const t = questionTextOf(q);
    const v = valueAt(m.a.profile ?? null, q);
    return WORDS.answeredMetNV(markdownText(t.header), markdownText(t.labelOf(v) ?? String(v)));
  }
  return WORDS.inventoryNV;
}
/** The program's premise of a file (findings.json `ships_premises`), where the scan recorded one. */
const premiseOfFile = (m: ReportModel, file: string): Obj | null => obj(obj(m.a.findings.ships_premises)?.[file]) ?? null;
/** NV8: why a `not_shipped` finding is not part of the shipped product, by reason, with the line that shows it. */
function notShippedWhyOf(m: ReportModel, it: Item): { reason: string; words: Inert } {
  const seat = str(obj(obj(it.verdict.standing)?.ships)?.value);
  const at = standingAtOf(m, it, "ships");
  if (seat === "development" || seat === "test" || seat === "documentation") return { reason: seat, words: (WORDS.notShippedNV[seat] as (x: Spanned) => Inert)(code(at || placeOf(m, it))) };
  const file = placeOf(m, it).replace(/:\d+$/, "");
  const pr = premiseOfFile(m, file);
  const premise = str(pr?.premise);
  const reason = premise === "ci" ? "ci" : premise === "outside_artifacts" ? "outside" : premise === "test" ? "test" : premise === "documentation" ? "documentation" : "development";
  const because = obj(arr(pr?.because)[0]);
  const line = because ? `${str(because.file)}:${Number(because.line) || 1}` : placeOf(m, it);
  return { reason, words: (WORDS.notShippedNV[reason] as (x: Spanned) => Inert)(code(line)) };
}
/** One question slot's line (NV3, NV4, NV12), with `lead` "3." in Fix first or "-" in laws.md's Questions open. */
function slotLines(m: ReportModel, q: QuestionSlot, lead: Inert, rules: Inert): Inert[] {
  const levels = WORDS.levelsWords(q.levels);
  const rule = m.plainOf(q.rules[0] ?? "");
  const first = m.itemById.get(q.findingIds[0] ?? "");
  if (q.kind === "fact") return [WORDS.factSlotNV(lead, markdownText(q.fact?.words ?? q.text), markdownText(q.fact?.cite ?? ""), q.findingIds.length, rule)];
  const entrance = WORDS.questionEntrance(code(reviewDeclarationCommand()));
  if (q.kind === "check_answer") return [WORDS.checkAnswerNV(lead, markdownText(q.header), markdownText(q.answer ?? ""), code(first ? placeOf(m, first) : WORDS.unrecordedLocation), q.findingIds.length, rule), entrance];
  return [WORDS.questionSlotNV(lead, markdownText(q.text), q.findingIds.length, levels, rules), entrance];
}
/** A rule's line in a section below the first screen: its level, plain name and count, then its findings' links. */
function sectionRuleLines(m: ReportModel, its: readonly Item[], why?: (it: Item) => Inert): Inert[] {
  const out: Inert[] = [];
  const lines = [...groupBy(its, (it) => `${m.sevOf(it)} ${str(it.candidate?.rule_id)}`).values()].sort(
    (x, y) => (SEVERITY_RANK[m.sevOf(x[0] as Item)] ?? 3) - (SEVERITY_RANK[m.sevOf(y[0] as Item)] ?? 3) || y.length - x.length || (str(x[0]?.candidate?.rule_id) < str(y[0]?.candidate?.rule_id) ? -1 : 1),
  );
  for (const gl of lines) {
    const links = gl.slice(0, WORK_LIST_LINKS).map((it) => detailLink(m, it));
    if (gl.length > WORK_LIST_LINKS) links.push(WORDS.andMore(gl.length - WORK_LIST_LINKS));
    out.push(WORDS.ruleLine(markdownText(m.sevOf(gl[0] as Item)), m.plainOf(str(gl[0]?.candidate?.rule_id)), gl.length, inertJoin(links, ours(", "))));
    if (why) for (const it of gl.slice(0, WORK_LIST_LINKS)) out.push(md`  - ${detailLink(m, it)}: ${why(it)}`);
  }
  return out;
}
/**
 * THE PRE-SETTLED RECORDS AS THE LOG KEEPS THEM. Each record of the
 * plan's `pre_settled` (a candidate no seat read, because the person's answer set its rule aside) takes `dispositionOf`'s row
 * 1, `settled_by_answer`, through the one function: a scope settlement with its own `settled_by` (WP4: field, answer and
 * the time it was recorded), a region settlement with the region answers that rule out every jurisdiction the rule
 * declares. A region settlement's date (`answered_at`) is the latest of the confirmed record's No answers that take in
 * those jurisdictions, and only where the record holds such an answer for every one of them: a date is never borrowed from
 * an answer that did not settle it. And only where the confirmed record
 * holds the same region answer as the profile this run read (`sameRegionAnswer`): a run that read another file's regions
 * (`--profile`), or a record answered again after the scan, was not settled by the record's answer, so its settlement
 * shows no date. The plan's records are copied, never changed.
 */
function settledRecordsOf(raw: readonly Obj[], confirmed: ReadonlyMap<string, { value: unknown; at: string }> | undefined, profile: Obj | null): Obj[] {
  const noRows = sameRegionAnswer(profile, confirmed)
    ? [...(confirmed ?? new Map<string, { value: unknown; at: string }>())]
        .filter(([id, a]) => id.startsWith(`${REGION_FIELD}:`) && a.value === false)
        .map(([id, a]) => ({ code: id.slice(REGION_FIELD.length + 1), at: a.at }))
    : [];
  return raw.map((p) => {
    const sb = obj(p.settled_by);
    if (sb) {
      const d = dispositionOf({ settledBy: { field: str(sb.field), answer: sb.answer, recorded_at: str(sb.recorded_at) } }).disposition;
      return { ...p, disposition: d };
    }
    const js = arr(p.rule_jurisdiction).map(str).filter((j) => j !== "");
    const used = js.map((j) => noRows.filter((r) => jurisdictionAnsweredOut(j, [], [r.code])));
    const at = js.length > 0 && used.every((u) => u.length > 0) ? used.flat().map((r) => r.at).sort().at(-1) : undefined;
    const d = dispositionOf({ settledBy: { field: REGION_FIELD, answer: [...new Set(used.flat().map((r) => r.code))], recorded_at: at ?? "" } }).disposition;
    return { ...p, disposition: d, ...(at ? { answered_at: at } : {}) };
  });
}
const REGION_FIELD = "distribution_regions";
/**
 * Whether the confirmed record holds the region answer the run's profile
 * holds: the profile's Yes set (`distribution_regions`, `"unknown"` aside) and No set (`regions_not_offered`, which every
 * profile the program writes carries) equal the record's Yes and No region answers, as `profileFromRows` (declaration.ts)
 * makes them. A profile that is not the run's (null), or one without `regions_not_offered` (a closed list written by
 * hand), is never the record's answer.
 */
function sameRegionAnswer(profile: Obj | null, confirmed: ReadonlyMap<string, { value: unknown; at: string }> | undefined): boolean {
  if (!profile || !confirmed || !Array.isArray(profile.regions_not_offered)) return false;
  const key = (xs: readonly string[]): string => JSON.stringify([...new Set(xs)].sort());
  const yes = arr(profile[REGION_FIELD]).map(str).filter((r) => r !== "" && r !== "unknown");
  const no = arr(profile.regions_not_offered).map(str).filter((r) => r !== "");
  const rows = [...confirmed].filter(([id]) => id.startsWith(`${REGION_FIELD}:`));
  const of = (v: boolean): string[] => rows.filter(([, a]) => a.value === v).map(([id]) => id.slice(REGION_FIELD.length + 1));
  return key(yes) === key(of(true)) && key(no) === key(of(false));
}

/**
 * THE DOCUMENTED EXCLUSIONS SAID BESIDE A
 * SETTLEMENT. Each names the law a rule rests on (a cite of its legal basis, as the bundle ships it) and the sentence a
 * scope answer that settles such a rule adds to its settled line: the coverage map leaves the Web Accessibility Directive
 * out as public-sector only and puts the private-sector case on the European Accessibility Act's rows, so a rule resting
 * on that Act is an accessibility rule. Read from the rule's own basis, so no list of rule ids is kept beside the rules.
 */
const SETTLED_EXCLUSIONS: readonly { instrument: string; words: string }[] = [{ instrument: "eu-2019/882", words: WORDS.wadNotCheckedNV }];
/**
 * The EU instruments a cite names, as one identifier each (`eu-<year>/<number>`),
 * whatever the spelling: "Directive (EU) 2019/882", "Directive 2019/882/EU", "(EU) 2019/882", "Regulation (EU) No 2019/882",
 * the CELEX number "32019L0882", with any space in them a no-break, thin or other Unicode space, or none; "European
 * Accessibility Act" names 2019/882 too. The type of act is not part of the identifier: since 1 January 2015 the EU's acts
 * share one numbering by year, so "(EU) 2019/882" names one act whatever word precedes it. Older acts written "<year>/<n>/EC"
 * or "/EU" (directives) are read the same way; a number written with no "(EU)", no "/EU" or "/EC" and no CELEX form names
 * nothing here, since a bare "<year>/<n>" may be any series.
 */
export function euInstrumentsOf(cite: string): Set<string> {
  const t = cite.replace(/[\s\u00a0\u2000-\u200b\u202f\u205f\u3000]+/g, " ");
  const out = new Set<string>();
  const add = (year: string, n: string): void => void out.add(`eu-${year}/${Number(n)}`);
  for (const m of t.matchAll(/\(\s?EU\s?\)\s?(?:No\.?\s?)?((?:19|20)\d\d)\s?\/\s?(\d{1,4})(?!\d)/gi)) add(m[1], m[2]);
  for (const m of t.matchAll(/(?<![\d/])((?:19|20)\d\d)\s?\/\s?(\d{1,4})\s?\/\s?(?:EU|EC|EEC)\b/gi)) add(m[1], m[2]);
  for (const m of t.matchAll(/\b3((?:19|20)\d\d)[LRD]0*(\d{1,4})\b/g)) add(m[1], m[2]);
  if (/\bEuropean Accessibility Act\b/i.test(t)) out.add("eu-2019/882");
  return out;
}
/** The exclusion sentences for the rules a scope answer settled, once each, in the table's order; none without the bases. */
export function settledExclusionsOf(bases: ReadonlyMap<string, readonly RuleBasis[]> | undefined, ruleIds: readonly string[]): Inert[] {
  if (!bases) return [];
  const named = new Set(ruleIds.flatMap((id) => (bases.get(id) ?? []).flatMap((b) => [...euInstrumentsOf(b.cite)])));
  return SETTLED_EXCLUSIONS.filter((x) => named.has(x.instrument)).map((x) => programText(x.words));
}
/** The plan's pre-settled rows, by the answer that settled them (NV10's entries). */
function settledAnswersOf(m: ReportModel): { header: string; answer: string; date: string; covers: string; excluded: Inert[]; rows: Obj[] }[] {
  const ruleRows = arr(obj(m.a.findings.per_rule_applicability)?.rules).map(obj).filter((r): r is Obj => !!r);
  const byRule = new Map(ruleRows.map((r) => [str(r.rule_id), obj(r.settled_by)] as const));
  const keyed = m.a.preSettled.map((p) => {
    const sb = byRule.get(str(p.rule_id)) ?? null;
    if (sb) {
      const field = str(sb.field);
      const t = questionTextOf(field);
      return { key: `${field}\n${JSON.stringify(sb.answer)}\n${str(sb.recorded_at)}`, header: t.header, answer: t.labelOf(sb.answer) ?? String(sb.answer), date: str(sb.recorded_at).slice(0, 10), covers: t.covers ?? "", scope: true, p };
    }
    const field = str(p.answered_from).replace(/^(?:ScanProfile|profile)\./, "");
    const regions = arr(p.declared_regions).map(str).join(", ");
    // A region settlement's date, where the confirmed record holds it.
    const date = markdownText(str(p.answered_at).slice(0, 10));
    return { key: `${field}\n${regions}\n${date}`, header: questionTextOf(field).header, answer: regions, date, covers: "", scope: false, p };
  });
  // A region answer takes no exclusion sentence: the rule's own region is the one answered out.
  return [...groupBy(keyed, (k) => k.key).values()].map((g) => ({
    header: g[0]?.header ?? "",
    answer: g[0]?.answer ?? "",
    date: g[0]?.date ?? "",
    covers: g[0]?.covers ?? "",
    excluded: g[0]?.scope === true ? settledExclusionsOf(m.a.ruleBases, g.map((k) => str(k.p.rule_id))) : [],
    rows: g.map((k) => k.p),
  }));
}
/**
 * THE SECTIONS BELOW THE FIRST SCREEN: To answer
 * (design 3.1), Recorded: duty met, exempt, or a record of processing, Not part of the shipped product, Set aside on your answers, For each organisation
 * that runs it. Each is written where it holds anything, and every finding in it links to its evidence in details.md.
 */
function belowSectionsOf(m: ReportModel): Inert[] {
  const out: Inert[] = [];
  const of = (d: Disposition): Item[] => m.shown.filter((it) => m.dispOf(it) === d);
  const items = (q: QuestionSlot): Item[] => q.findingIds.map((id) => m.itemById.get(id)).filter((it): it is Item => !!it);
  // Design 3.1's "To answer": the findings waiting on an answer, by rule, with
  // the link to the one list of the questions in words (`laws.md`, the parent's ruling (a)); no question text here.
  const slots = (m.a.questions ?? []).filter((q) => q.kind !== "order_moving");
  const waiting = [...new Set(slots.flatMap((q) => items(q)))];
  if (waiting.length > 0) out.push(WORDS.questionsHeading, ours(""), WORDS.toAnswerLead, ours(""), ...sectionRuleLines(m, waiting), ours(""));
  out.push(...decidedSectionLines(m));
  const recorded = of("recorded");
  if (recorded.length > 0) out.push(WORDS.recordedHeading, ours(""), ...sectionRuleLines(m, recorded, (it) => recordedWhyOf(m, it)), ours(""));
  const notShipped = of("not_shipped");
  if (notShipped.length > 0) {
    out.push(WORDS.notShippedHeading, ours(""));
    const order = ["ci", "development", "test", "documentation", "outside"];
    const why = new Map(notShipped.map((it) => [it, notShippedWhyOf(m, it)] as const));
    for (const reason of order) {
      const its = notShipped.filter((it) => why.get(it)?.reason === reason);
      if (its.length > 0) out.push(...sectionRuleLines(m, its, (it) => why.get(it)?.words ?? ours("")));
    }
    out.push(ours(""));
  }
  const settled = settledAnswersOf(m);
  if (settled.length > 0) {
    out.push(WORDS.setAsideHeading, ours(""));
    for (const g of settled) {
      const ids = new Set(g.rows.map((p) => str(p.finding_id)));
      const locs = a2l(m, ids);
      out.push(md`- ${WORDS.setAsideNV(markdownText(g.header), markdownText(g.answer), g.date ? md` on ${markdownText(g.date)}` : ours(""), [...new Set(g.rows.map((p) => md`"${m.plainOf(str(p.rule_id))}"`))], locs.places, locs.files, code(reviewDeclarationCommand()), programText(g.covers), g.excluded)}`);
    }
    out.push(ours(""));
  }
  const operators = of("for_operators");
  if (operators.length > 0) {
    out.push(WORDS.forOperatorsHeading, ours(""));
    for (const [q, its] of groupBy(operators, (it) => waitQuestionOf(it))) {
      const t = questionTextOf(q);
      out.push(md`- ${WORDS.forOperatorsNV(markdownText(t.header), its.length, markdownText(t.text))}`, ...sectionRuleLines(m, its).map((l) => md`  ${l}`));
    }
    out.push(ours(""));
  }
  return out;
}
/** The places and files of the candidates `ids` (their locations as the scan recorded them). */
function a2l(m: ReportModel, ids: ReadonlySet<string>): { places: number; files: number } {
  const locs = [...ids].flatMap((id) => arr(m.candidateById.get(id)?.locations).map(obj).filter((l): l is Obj => !!l));
  return { places: locs.length, files: new Set(locs.map((l) => str(l.file))).size };
}

function buildMainReport(m: ReportModel): Inert {
  const { a } = m;
  if (!m.files) m.files = fileModelOf(m);
  const refs: Inert[] = [];
  const out: Inert[] = firstScreenLines(m, refs);
  out.push(ours(""));
  const isHigh = (it: Item) => m.sevOf(it) === "high";
  const level = (xs: Item[], l: string) => xs.filter((it) => m.sevOf(it) === l);

  /* Below the first screen: everything that stands, and everything of its area not answered, to work through. */
  out.push(WORDS.byAreaHeading, ours(""), WORDS.byAreaIntro, ours(""));
  type Unchecked = { area: string; rule: string; kind: "no-answer" | "partly" | "unquoted"; n: number; places: number; high: boolean; anchor: string };
  const unchecked: Unchecked[] = [];
  for (const [rule, us] of groupBy([...m.notAnswered, ...m.invalidAnswers, ...m.unusableAnswers], (u) => ruleOfRecord(m, u))) {
    unchecked.push({ area: areaOf(rule), rule, kind: "no-answer", n: us.length, places: sumOf(us, (u) => placesOfRecord(m, u)), high: us.some((u) => sevOfRecord(m, u) === "high"), anchor: `u-${rule}` });
  }
  for (const [rule, its] of groupBy(m.partly, (it) => str(it.candidate?.rule_id) || WORDS.ruleNotInFindings)) {
    unchecked.push({ area: areaOf(rule), rule, kind: "partly", n: its.length, places: 0, high: its.some(isHigh), anchor: `p-${rule}` });
  }
  for (const [rule, its] of groupBy(m.overturnedUnquoted, (it) => str(it.candidate?.rule_id) || WORDS.ruleNotInFindings)) {
    unchecked.push({ area: areaOf(rule), rule, kind: "unquoted", n: its.length, places: 0, high: its.some(isHigh), anchor: `o-${rule}` });
  }
  // What is to fix, and what needs judgement (as
  // today, marked); every other disposition has its own section below. Every finding that stands and is not decided in this folder (design 3.1): a decided
  // one is listed under "Decided by you" below, and counted as before.
  const leftList = (it: Item): boolean => { const l = m.files?.byId.get(idOf(it)); return l !== undefined && decidedListed(m, l); };
  const worked = m.shown.filter((it) => (m.dispOf(it) === "to_fix" || m.dispOf(it) === "counsel") && !leftList(it));
  const areas = new Set([...worked.map((it) => areaOf(str(it.candidate?.rule_id))), ...unchecked.map((u) => u.area)]);
  const best = (area: string) => Math.min(...worked.filter((it) => areaOf(str(it.candidate?.rule_id)) === area).map((it) => SEVERITY_RANK[m.sevOf(it)] ?? 3), 9);
  const size = (area: string) => worked.filter((it) => areaOf(str(it.candidate?.rule_id)) === area).length + unchecked.filter((u) => u.area === area).reduce((n, u) => n + u.n, 0);
  const areaOrder = [...areas].sort((x, y) => best(x) - best(y) || size(y) - size(x) || areaRank(x) - areaRank(y) || (x < y ? -1 : 1));
  // Empty only because every standing finding is decided: say so, never "none stands".
  const allDecided = m.shown.some((it) => (m.dispOf(it) === "to_fix" || m.dispOf(it) === "counsel") && leftList(it));
  if (areaOrder.length === 0) out.push(allDecided ? WORDS.byAreaAllDecided : WORDS.byAreaNone, ours(""));
  for (const area of areaOrder) {
    const held = worked.filter((it) => areaOf(str(it.candidate?.rule_id)) === area);
    const un = unchecked.filter((u) => u.area === area);
    const counts = ["high", "medium", "low"].map((l) => [l, level(held, l).length] as const).filter(([, n]) => n > 0).map(([l, n]) => md`${n} ${markdownText(l)}`);
    const nu = un.reduce((n, u) => n + u.n, 0);
    if (nu > 0) counts.push(md`${nu} not checked`);
    out.push(WORDS.areaHead(markdownText(area), inertJoin(counts, ours(", "))), ours(""));
    // One line per rule and level, high first: a rule raised at one place shows that place on its own line. Within a level, in the order key's order; findings waiting on one answer on a line of
    // their own, marked with the question.
    const lineKey = (g: Item[]): number[] => g.map((it) => (it.order ? orderKeyOf(it.order) : [0, 0, 0, 0])).sort(compareKeys)[0] ?? [0, 0, 0, 0];
    const lines = [...groupBy(held, (it) => `${m.sevOf(it)} ${str(it.candidate?.rule_id)} ${it.order?.question ?? ""}`).values()].sort(
      (x, y) =>
        (SEVERITY_RANK[m.sevOf(x[0] as Item)] ?? 3) - (SEVERITY_RANK[m.sevOf(y[0] as Item)] ?? 3) ||
        compareKeys(lineKey(x), lineKey(y)) ||
        y.length - x.length ||
        (str(x[0]?.candidate?.rule_id) < str(y[0]?.candidate?.rule_id) ? -1 : 1),
    );
    for (const gl of lines) {
      const links = gl.slice(0, WORK_LIST_LINKS).map((it) => md`${detailLink(m, it)}${it.label === "counsel" && !it.order?.question ? md` (${WORDS.counselMark})` : ours("")}`);
      if (gl.length > WORK_LIST_LINKS) links.push(WORDS.andMore(gl.length - WORK_LIST_LINKS));
      const q = gl[0]?.order?.question;
      out.push(md`${WORDS.ruleLine(markdownText(m.sevOf(gl[0] as Item)), m.plainOf(str(gl[0]?.candidate?.rule_id)), gl.length, inertJoin(links, ours(", ")))}${q ? WORDS.waitsOn(markdownText(questionTextOf(q).header)) : ours("")}`);
    }
    for (const u of un)
      out.push(
        u.kind === "no-answer"
          ? WORDS.areaNoAnswer(m.plainOf(u.rule), u.n, u.places, u.high, linkTarget(u.anchor))
          : u.kind === "unquoted"
            ? WORDS.areaOverturnedUnquoted(m.plainOf(u.rule), u.n, linkTarget(u.anchor))
            : WORDS.areaPartly(m.plainOf(u.rule), u.n, linkTarget(u.anchor)),
      );
    out.push(ours(""));
  }

  out.push(...belowSectionsOf(m));

  /* The closing coverage sentence, and the disclaimer. */
  const withCandidates = new Set(a.candidates.map((c) => str(c.rule_id))).size;
  const evaluatedSilent = a.silent.filter((r) => str(r.state) !== "not-evaluated");
  const searched = evaluatedSilent.filter((r) => a.silences.has(str(r.rule_id))).length;
  out.push(WORDS.coverage(withCandidates + evaluatedSilent.length, withCandidates, evaluatedSilent.length, searched, a.silent.length - evaluatedSilent.length), ours(""));
  out.push(...identityLines(m));
  out.push(ours("---"), ours(""), md`*${WORDS.disclaimer}*`, ours(""));
  // The code places' reference definitions close the file (design 3.1.1 rule 2).
  if (refs.length > 0) out.push(...refs.map((t, i) => md`[${i + 1}]: ${t}`));
  return formMarkdown(composedNet(m.a, out));
}

/**
 * The sentence that says where a finding is and why (NV4, NV5-NV9, NV12-NV14),
 * and, for a finding to fix by default, the part the review did not give (`missing`, besides the status W13 already names).
 */
function dispositionLinesOf(m: ReportModel, it: Item): Inert[] {
  const d = m.dispOf(it);
  const rule = m.plainOf(str(it.candidate?.rule_id));
  if (d === "recorded") return [md`- ${recordedWhyOf(m, it)}`];
  if (d === "not_shipped") return [md`- ${notShippedWhyOf(m, it).words}`];
  if (d === "folded") {
    const head = m.itemById.get(str(it.foldedUnder));
    const at = it.foldedBecause?.at;
    const why = it.foldedBecause?.key === "documentation" ? WORDS.foldedDocumentsNV : at ? WORDS.foldedTracedNV(code(`${at.file}:${at.line}`)) : ours("");
    return [md`- ${WORDS.foldedNV(head ? detailLink(m, head) : md`${inSpan(code(str(it.foldedUnder)))}`, why)}`];
  }
  if (d === "for_operators") {
    const t = questionTextOf(waitQuestionOf(it));
    return [md`- ${WORDS.forOperatorsNV(markdownText(t.header), 1, markdownText(t.text))}`];
  }
  const slot = (m.a.questions ?? []).find((q) => q.kind !== "order_moving" && q.findingIds.includes(str(it.verdict.finding_id)));
  if ((d === "question" || d === "check_answer") && slot && slot.kind !== "waits_on_answer") return slotLines(m, slot, ours("-"), md`"${rule}"`).slice(0, 1);
  const out: Inert[] = [];
  const members = m.shown.filter((x) => m.dispOf(x) === "folded" && str(x.foldedUnder) === str(it.verdict.finding_id));
  if (members.length > 0) out.push(md`- ${WORDS.foldHeadNV(sumOf(members, (x) => Math.max(m.heldOf(x).length, 1)), inertJoin(members.map((x) => detailLink(m, x)), ours(", ")))}`);
  if (d !== "to_fix") return out;
  const seat = str(obj(obj(it.verdict.standing)?.ships)?.value);
  const pr = premiseOfFile(m, placeOf(m, it).replace(/:\d+$/, ""));
  if (pr && ["ci", "build_tooling", "development", "test", "documentation", "outside_artifacts"].includes(str(pr.premise)) && seat && !["development", "test", "documentation"].includes(seat)) {
    out.push(md`- ${WORDS.shipsAfterAllNV(code(standingAtOf(m, it, "ships") || placeOf(m, it)))}`);
  }
  const missing = (it.disp?.missing ?? []).filter((x) => x !== "status");
  if (missing.length > 0) out.push(md`- ${WORDS.toFixMissingNV(placedWords(d), missing.map((x) => WORDS.missingPart[x] ?? x))}`);
  return out;
}

/**
 * The line under a finding whose second review overturned it while its
 * second look found against the seat's claim: both reasons, each with the line it quoted. Called after step 13 (an item's
 * `why`): the refutation is the log's redacted copy, and the second look's words go through `printed` one value at a time.
 */
/**
 * A SEAT'S SENTENCE JOINED BEFORE THE LINE'S OWN STOP (". It is ...", ". The second look ...", a file named in brackets and
 * then the stop) ends with exactly one terminal mark, the line's: its own final marks (`.`, `?`, `!`, an ellipsis, also
 * just before a closing quote or bracket) are dropped, and a text cut for room keeps its "…" with no stop after it
 * (`oneStop`). Until 2026-11-12 one final full stop of the second look's reasoning alone was dropped: "construct.." where
 * the first review named no file, "?." after a question, four dots after an ellipsis.
 */
const clauseEnd = (s: string): string => s.replace(/\s+$/, "").replace(/[.?!\u2026]+(["'\u201d\u2019)\]]*)$/u, "$1");
const clause = (s: string, max?: number): Inert => said(clauseEnd(s), max);
/** A line's stop after a text cut for room ("…."), and after a cut followed by a file in brackets, dropped: one mark ends it. */
const oneStop = (line: Inert): Inert => {
  let out = line;
  for (let at = out.search(/\u2026\.(?=\s|$)/); at >= 0; at = out.search(/\u2026\.(?=\s|$)/)) out = md`${inertSlice(out, at + 1)}${inertSliceFrom(out, at + 2)}`;
  return out;
};

function passesDisagreeLine(ref: Obj, second: Item["secondLook"], printed: (s: string) => string, placed: Inert, lookOn?: Item["lookOn"]): Inert {
  const rev = arr(ref.evidence).map(obj).find((e): e is Obj => !!e && str(e.file) !== "");
  const revAt = rev ? md` (${inSpan(code(`${str(rev.file)}:${str(rev.lines)}`))})` : ours("");
  const look = second?.record;
  // An undecided second look: its own reasoning, or, where the quote
  // check invalidated it, that its quotation was not found (its reasoning rests on a line the file does not hold).
  if (second?.outcome === "needs_human") {
    const lookReason = look?.quote_check_outcome === "invalidated" ? WORDS.passesLookUnusableNV : clause(printed(str(look?.reasoning)), 600);
    return oneStop(md`- ${(lookOn === "location" ? WORDS.passesUndecidedLocationNV : WORDS.passesUndecidedNV)(markdownText(str(ref.grounds)) || WORDS.noGroundNamed, md`${clause(str(ref.reasoning), 600)}${revAt}`, lookReason, placed)}`);
  }
  const lev = arr(look?.evidence).map(obj).find((e): e is Obj => !!e && str(e.file) !== "");
  const lookAt = lev ? code(`${printed(str(lev.file))}${str(lev.lines) || typeof lev.lines === "number" ? `:${String(lev.lines)}` : ""}`) : null;
  // `ground` is the program's words around a code span of `code()` values (the
  // line number too: a seat's `lines` is free text), inert as it is: `oneLine`, never `said`, which would escape the span.
  const ground = WORDS.secondLookGround[str(look?.grounds)]?.(lookAt ?? code("")) ?? (lookAt ? inSpan(lookAt) : WORDS.noGroundNamed);
  return oneStop(md`- ${(lookOn === "location" ? WORDS.passesDisagreeLocationNV : WORDS.passesDisagreeNV)(markdownText(str(ref.grounds)) || WORDS.noGroundNamed, md`${clause(str(ref.reasoning), 600)}${revAt}`, inertCut(ground, 400), clause(printed(str(look?.reasoning)), 600), placed)}`);
}

/**
 * The line under a high finding the first review ruled out whose second look found the
 * rule applies, or could not settle it: both answers, each with the line it quoted. Called after step 13, as
 * `passesDisagreeLine` is: the verdict is the log's redacted copy.
 */
function dismissalDisagreeLine(v: Obj, second: Item["secondLook"], printed: (s: string) => string, placed: Inert): Inert {
  const first = arr(v.evidence).map(obj).find((e): e is Obj => !!e && str(e.file) !== "");
  const firstAt = first ? md` (${inSpan(code(`${str(first.file)}:${str(first.lines)}`))})` : ours("");
  const look = second?.record;
  if (second?.outcome === "needs_human") {
    const lookReason = look?.quote_check_outcome === "invalidated" ? WORDS.passesLookUnusableNV : clause(printed(str(look?.reasoning)), 600);
    return oneStop(md`- ${WORDS.dismissalUndecidedNV(md`${clause(str(v.reasoning), 600)}${firstAt}`, lookReason, placed)}`);
  }
  const lev = arr(look?.evidence).map(obj).find((e): e is Obj => !!e && str(e.file) !== "");
  const lookAt = lev ? code(`${printed(str(lev.file))}${str(lev.lines) || typeof lev.lines === "number" ? `:${String(lev.lines)}` : ""}`) : null;
  const ground = WORDS.secondLookGround[str(look?.grounds)]?.(lookAt ?? code("")) ?? (lookAt ? inSpan(lookAt) : WORDS.noGroundNamed);
  return oneStop(md`- ${WORDS.dismissalDisagreeNV(md`${clause(str(v.reasoning), 600)}${firstAt}`, inertCut(ground, 400), clause(printed(str(look?.reasoning)), 600), placed)}`);
}

/** The second look's line under a finding in `details.md`, where it had one. */
function secondLookLinesOf(m: ReportModel, it: Item): Inert[] {
  const l = it.secondLook;
  if (!l) return [];
  // Its why line gives both answers.
  if (it.passesDisagree) return [];
  // Where it is placed, from its final placement (never the look's answer alone).
  const placed = placedWords(m.dispOf(it));
  if (l.outcome === "upheld") {
    // Where the look agreed and the finding is counted all the same, the line says why.
    const disposition = m.dispOf(it);
    if (!countsAsProblem(disposition)) return [md`- ${(it.lookOn === "location" ? WORDS.secondLookLocationUpheldNV : WORDS.secondLookUpheldNV)(placed)}`];
    const ships = str(obj(obj(it.verdict.standing)?.ships)?.value);
    return [md`- ${NOT_SHIPPED.has(ships) ? WORDS.secondLookUpheldCountedShipsNV(placed) : WORDS.secondLookUpheldCountedNV(placed)}`];
  }
  if (l.outcome === "needs_human") return [md`- ${WORDS.secondLookOpenNV(placed)}`];
  if (l.outcome === "not_answered") return [md`- ${(it.lookOn === "location" ? WORDS.secondLookLocationNotAnsweredNV : WORDS.secondLookNotAnsweredNV)(placed)}`];
  const e = arr(l.record?.evidence).map(obj).find((x): x is Obj => !!x && str(x.file) !== "");
  const at = e ? code(`${str(e.file)}${str(e.lines) || typeof e.lines === "number" ? `:${String(e.lines)}` : ""}`) : null;
  // As `passesDisagreeLine`'s `ground`: inert as it is, so `oneLine`, never `said`. Inert as it is (`inertCut`, as `passesDisagreeLine`'s ground):
  // `said` escaped the code span's backticks, so the reader saw them and the path's escapes.
  const words = WORDS.secondLookGround[str(l.record?.grounds)]?.(at ?? code("")) ?? (at ? inSpan(at) : ours(""));
  return [md`- ${WORDS.secondLookOverturnedNV(inertCut(words, 400), placed)}`];
}

/** One "not applicable" answer's own lines (overturned or dismissed): its reason and what is said beside it. */
function dismissedLinesOf(m: ReportModel, it: Item): Inert[] {
  const { a } = m;
  const lines: Inert[] = [];
  const ruleId = str(it.candidate?.rule_id);
  if (it.label === "overturned") {
    const ref = obj(it.verdict.refutation) ?? {};
    const ev = arr(ref.evidence).map(obj).filter((e): e is Obj => !!e)[0];
    const quote = ev ? md` ${inSpan(code(`${str(ev.file)}:${str(ev.lines)}`))} — ${inSpan(code(oneLine(str(ev.quote), 200)))}` : ours("");
    lines.push(WORDS.overturned(markdownText(ruleId), code(str(it.verdict.finding_id)), markdownText(str(ref.grounds)) || WORDS.noGroundNamed, md`${said(str(ref.reasoning))}${quote}`));
    if (overturnedOnGate(it)) lines.push(WORDS.overturnedOnGate);
    if (overturnedUnquoted(a.summary, it)) lines.push(WORDS.overturnedUnchecked);
    // The second look at a location overturn, beside it (agreed, or not
    // answered), as its own sub-item like the lines above it.
    if (it.lookOn !== undefined) for (const l of secondLookLinesOf(m, it)) lines.push(md`  ${l}`);
  } else {
    lines.push(WORDS.dismissed(markdownText(ruleId), code(str(it.verdict.finding_id)), said(str(it.verdict.reasoning))));
    if (it.carriedFrom) lines.push(md`  ${WORDS.carried(earlierRun(a, it.carriedFrom))}`);
    // The second look at a high finding ruled out (agreed, or not answered), beside it.
    if (it.lookOn === "not_applicable") for (const l of secondLookLinesOf(m, it)) lines.push(md`  ${l}`);
  }
  return lines;
}

/** How a "not applicable" answer's places were read: its kept places (RK-4), then the place lines (B5: carried included). */
function placeLinesOfAnswer(it: Item, own: VendorSoftware | null): Inert[] {
  const lines: Inert[] = [];
  const n = keptUnder(it);
  if (n > 0 && it.placeRead) {
    const first = it.placeRead.summary.kept_places.slice(0, PLACE_SUMMARY_FIRST).map((k) => {
      const at = k.indexOf(" ");
      return md`${markdownText(k.slice(0, at))} at ${inSpan(code(k.slice(at + 1)))}`;
    });
    lines.push(md`  ${WORDS.placesKeptUnderNotApplicable(n, inertJoin(first, ours(", ")), n - first.length)}`);
  }
  if (it.placeRead) lines.push(...placeLines(it.placeRead, own).map((l) => md`  ${l}`));
  return lines;
}

/**
 * THE ONE LIST of what was not checked - every kind of item `not-checked.md` holds, in the file's order
 * (every heading of WHAT WAS NOT ESTABLISHED, the answers with no answer first), each with its count, its section and its
 * phrase for the first screen. `buildNotChecked` writes the sections and `buildMainReport` the phrases, both from this
 * list, so a kind cannot be in the file and missing from the first screen's count.
 */
function uncheckedKinds(m: ReportModel): UncheckedKind[] {
  const { a } = m;
  const f = a.findings;
  const pra = obj(f.per_rule_applicability);
  const H = UNCHECKED_KIND_HEADINGS;
  const kind = (key: UncheckedKey, n: number, lines: Inert[], detail: Inert = ours("")): UncheckedKind => ({ key, n, lines, screen: n > 0 ? md`${WORDS.uncheckedKind[key](n)}${detail}` : ours("") });
  /** A section SKILL.md quotes: always printed, "No entry" said where it holds none. */
  const section = (heading: Inert, rows: Inert[]): Inert[] => [heading, ours(""), ...(rows.length > 0 ? rows : [WORDS.emptySection]), ours("")];
  const kinds: UncheckedKind[] = [];
  kinds.push(kind("no-ledger", a.ledgerChecked === false ? 1 : 0, a.ledgerChecked === false ? [programText(H["no-ledger"][0] ?? ""), ours("")] : []));
  // Every withdrawn group of every record, in one place, whatever section the record is in.
  kinds.push(kind("unconfirmed", a.unconfirmed.length, a.unconfirmed.length > 0 ? [programText(H.unconfirmed[0] ?? ""), ours(""), ...a.unconfirmed, ours("")] : []));
  /* A rule's heading over records with no verdict, and the level of each record (its rule's, or the one raised for it). */
  const levelsOf = (us: readonly Obj[]): [string, number][] =>
    [...groupBy([...us], (u) => sevOfRecord(m, u) || "unknown").entries()]
      .map(([l, xs]) => [l, xs.length] as [string, number])
      .sort((x, y) => (SEVERITY_RANK[x[0]] ?? 3) - (SEVERITY_RANK[y[0]] ?? 3));
  const noVerdictHead = (rule: string, us: readonly Obj[]): Inert[] => [md`#### ${WORDS.ruleGroup(m.plainOf(rule), code(rule))}`, ours(""), WORDS.noVerdictLevel(levelsOf(us)), ours("")];
  /* What has no answer, first (proposal section 1): by rule, each rule under the anchor the work list links to. */
  const byRule = (records: Obj[], prefix: string, linesOf: (u: Obj) => Inert[]): Inert[] =>
    [...groupBy(records, (u) => ruleOfRecord(m, u)).entries()].flatMap(([rule, us]) => [...noVerdictHead(rule, us), ...us.flatMap(linesOf), ours("")]);
  const noAnswer: Inert[] = [];
  if (m.notAnswered.length > 0) {
    // Unit U1: the line under the heading counts read and not-read places over every entry.
    const total = (g: (u: Obj) => number) => m.notAnswered.reduce((n, u) => n + g(u), 0);
    const places = total((u) => Number(u.places));
    const read = total((u) => Number(u.places_read));
    // Fix F3: carried places are neither read in this scan nor not read.
    const carried = total((u) => Number(u.places_carried ?? 0));
    noAnswer.push(
      ...section(WORDS.notAnswered, [
        WORDS.notAnsweredLead(m.notAnswered.length, places, read, places - read - carried, carried),
        ours(""),
        ...byRule(m.notAnswered, "u-", (u) => {
          const r = a.raises?.get(str(u.finding_id));
          return [...notAnsweredLines(u), ...(r ? [WORDS.severityRaisedNotAnswered(markdownText(r.severity), markdownProse(r.because))] : [])];
        }),
      ]),
    );
  }
  if (m.invalidAnswers.length > 0) {
    // The work list links a rule with answers of both kinds to its `u-` anchor: here only where no `not_answered` one holds it.
    const taken = new Set(m.notAnswered.map((u) => ruleOfRecord(m, u)));
    noAnswer.push(
      ...section(
        WORDS.notJudgedInvalid,
        [...groupBy(m.invalidAnswers, (u) => ruleOfRecord(m, u)).entries()].flatMap(([rule, us]) => [
          ...noVerdictHead(rule, us),
          ...us.map((u) => WORDS.notJudgedInvalidRow(code(str(u.finding_id)), markdownText(str(u.seat)), code(str(u.kept)))),
          ours(""),
        ]),
      ),
    );
  }
  if (m.unusableAnswers.length > 0) {
    // Answers step 6 set aside, by rule, each with the program's reason; the work list's `u-` anchor where no row above took it.
    const taken = new Set([...m.notAnswered, ...m.invalidAnswers].map((u) => ruleOfRecord(m, u)));
    noAnswer.push(
      ...section(
        WORDS.notJudgedUnusable,
        [...groupBy(m.unusableAnswers, (u) => ruleOfRecord(m, u)).entries()].flatMap(([rule, us]) => [
          ...noVerdictHead(rule, us),
          ...us.map((u) => WORDS.notJudgedUnusableRow(code(str(u.finding_id)), said(str(u.why)))),
          ours(""),
        ]),
      ),
    );
  }
  kinds.push(kind("no-usable-answer", m.notAnswered.length + m.invalidAnswers.length + m.unusableAnswers.length, noAnswer));
  const byShape: Inert[] = [];
  if (m.byShape.length > 0) {
    const preview = obj(obj(a.plan.pre_launch)?.preview);
    const lines: Inert[] = [WORDS.notAdjudicatedBody(m.byShape.length, markdownText(a.shape), markdownText(a.chosenBy)), ours(""), WORDS.noVerdictLevel(levelsOf(m.byShape)), ours(""), WORDS.shownWhenChosen];
    for (const s of arr(preview?.shapes).map(obj)) {
      if (s) lines.push(WORDS.shownRow(markdownText(str(s.shape)), Number(s.launches), Number(s.candidates), Number(s.estimated_tokens_low), Number(s.estimated_tokens_high), Number(s.estimated_seconds)));
    }
    byShape.push(...section(WORDS.notAdjudicated, lines));
  }
  kinds.push(kind("not-reviewed", m.byShape.length, byShape));
  /* A `not_applicable` answer whose record names places no review read is never with the clean ones. */
  const partly: Inert[] = [];
  if (m.partly.length > 0) {
    partly.push(WORDS.partlyCheckedHeading, ours(""), WORDS.partlyCheckedIntro, ours(""));
    if (m.partly.some(overturnedOnGate)) partly.push(WORDS.partlyCheckedGateIntro, ours(""));
    for (const [rule, its] of groupBy(m.partly, (it) => str(it.candidate?.rule_id) || WORDS.ruleNotInFindings)) {
      partly.push(md`#### ${WORDS.ruleGroup(m.plainOf(rule), code(rule))}`, ours(""));
      for (const it of its) {
        partly.push(...dismissedLinesOf(m, it), ...(it.notChecked ? notCheckedLines(it.notChecked, ours("  ")) : []), ...placeLinesOfAnswer(it, vendorSoftwareOf(m.a.profile ?? null)));
        if (it.readAgain) partly.push(md`  ${WORDS.readAgain(it.readAgain.checked, it.readAgain.settled, it.readAgain.previous, earlierRun(a, it.readAgain.scan_id))}`);
      }
      partly.push(ours(""));
    }
  }
  const partlyPlaces = sumOf(m.partly, (it) => it.notChecked?.places ?? 0);
  kinds.push(kind("partly", m.partly.length, partly, partlyPlaces > 0 ? WORDS.uncheckedPartlyPlaces(partlyPlaces) : ours("")));
  /* An answer a second review gave without quoting anything, by rule, with its lines -
   * once only in not-applicable.md, outside this list and the first screen's count. */
  const unquoted: Inert[] = [];
  if (m.overturnedUnquoted.length > 0) {
    unquoted.push(WORDS.overturnedUnquotedHeading, ours(""), WORDS.overturnedUnquotedIntro, ours(""));
    for (const [rule, its] of groupBy(m.overturnedUnquoted, (it) => str(it.candidate?.rule_id) || WORDS.ruleNotInFindings)) {
      unquoted.push(md`#### ${WORDS.ruleGroup(m.plainOf(rule), code(rule))}`, ours(""));
      for (const it of its) {
        unquoted.push(...dismissedLinesOf(m, it), ...(it.notChecked ? notCheckedLines(it.notChecked, ours("  ")) : []), ...placeLinesOfAnswer(it, vendorSoftwareOf(m.a.profile ?? null)));
        if (it.readAgain) unquoted.push(md`  ${WORDS.readAgain(it.readAgain.checked, it.readAgain.settled, it.readAgain.previous, earlierRun(a, it.readAgain.scan_id))}`);
      }
      unquoted.push(ours(""));
    }
  }
  kinds.push(kind("overturned-unquoted", m.overturnedUnquoted.length, unquoted));
  /* A finding that stands with no usable second review is a kind of the list, not only a
   * line in details.md: the log records it as not established (`refutations_not_established`), and a mark on its Fix-first
   * line would reach only the high findings of the first eight groups. */
  const notRefuted: Inert[] = [];
  if (m.notRefuted.length > 0) {
    notRefuted.push(WORDS.notRefutedHeading, ours(""), WORDS.notRefutedIntro, ours(""));
    for (const it of m.notRefuted) {
      notRefuted.push(WORDS.notRefutedRow(markdownText(str(it.candidate?.rule_id)) || WORDS.ruleNotInFindings, code(str(it.verdict.finding_id)), it.notRefutedBecause ? it.notRefutedBecause() : WORDS.notRefutedNone, detailLink(m, it), placedWords(m.dispOf(it))));
    }
    notRefuted.push(ours(""));
  }
  kinds.push(kind("not-refuted", m.notRefuted.length, notRefuted));
  const byOutcome = (o: string) => a.unknownRules.filter((r) => r.outcome === o);
  const gap = byOutcome("construct_found");
  kinds.push(
    kind(
      "gap",
      gap.length,
      section(
        WORDS.gapFound,
        gap.flatMap((r) => {
          const id = str(r.rule_id);
          const lines = [WORDS.gapRow(markdownText(id), programText(m.titleOf.get(id) ?? ""))];
          for (const e of arr(r.evidence).map(obj)) if (e) lines.push(md`  ${WORDS.evidence(code(str(e.file)), code(str(e.lines)), code(oneLine(str(e.quote), 300)))}`);
          return lines;
        }),
      ),
    ),
  );
  const absent = byOutcome("apparently_absent");
  kinds.push(
    kind(
      "absent",
      absent.length,
      section(
        WORDS.apparentlyAbsent,
        absent.flatMap((r) => {
          const id = str(r.rule_id);
          const lines = [WORDS.absentRow(markdownText(id), programText(m.titleOf.get(id) ?? ""))];
          for (const s of arr(r.searched)) lines.push(WORDS.searchedRow(markdownCode(oneLine(str(s), 300))));
          const raw = a.silences.get(id)?.record;
          if (raw && str(raw.contradicts_profile)) lines.push(WORDS.contradictsProfile(said(str(raw.contradicts_profile))));
          if (r.quote_check_outcome === "no_evidence") lines.push(md`  ${WORDS.unchecked(WORDS.uncheckedThisRow)}`);
          return lines;
        }),
      ),
    ),
  );
  const unknown = byOutcome("not_checked");
  const unknownKind = kind(
    "not-checked-rules",
    unknown.length,
    section(
      WORDS.unknownNotChecked,
      unknown.flatMap((r) => {
        const id = str(r.rule_id);
        // No place to fill a template with; the row says so.
        const invalid = a.notJudged?.silences.get(id);
        const silentRow = a.silent.find((s) => str(s.rule_id) === id);
        const removed = silentRow ? removalsOf({ matches_removed_by_corroboration: silentRow.matches_removed_by_corroboration as number | undefined }) : 0;
        const lines = [WORDS.unknownRow(markdownText(id), programText(m.titleOf.get(id) ?? ""), removed > 0 ? WORDS.noPlaceCorroborated(removed) : WORDS.noPlaceSilent, invalid ? ours("") : markdownText(str(r.note)))];
        if (invalid) lines.push(WORDS.silenceInvalidAnswer(markdownText(invalid.seat), code(invalid.kept)));
        const s = a.silences.get(id);
        if (s && r.outcome_before_quote_check !== undefined) lines.push(WORDS.silenceInvalidated(markdownText(str(r.outcome_before_quote_check)), said(firstNote(s))));
        return lines;
      }),
    ),
  );
  // The silent rules nobody checked are said on the first screen even at zero (the asymmetry: a zero said).
  kinds.push({ ...unknownKind, screen: WORDS.uncheckedKind["not-checked-rules"](unknown.length) });
  const notEvaluated = byOutcome("not_evaluated");
  kinds.push(kind("not-evaluated", notEvaluated.length, section(WORDS.notEvaluated, notEvaluated.map((r) => WORDS.notEvaluatedRow(markdownText(str(r.rule_id)), programText(m.titleOf.get(str(r.rule_id)) ?? ""), markdownText(str(r.note)) || WORDS.notEvaluatedWhyUnnamed)))));
  const outside = byOutcome("out_of_jurisdiction");
  kinds.push(
    kind(
      "by-declaration",
      outside.length,
      section(
        WORDS.notApplicableByDeclaration,
        outside.map((r) => WORDS.outOfJurisdictionRow(markdownText(str(r.rule_id)), programText(m.titleOf.get(str(r.rule_id)) ?? ""), markdownText(arr(pra?.declared_regions).map(str).join(", ")), markdownText(str(r.note)))),
      ),
    ),
  );
  /* What the scan did not read: each coverage note is a row, and the first screen counts them with the scan's own counts
   * (findings.json `coverage_limits.limits[].counts`), never parsed from their sentences. */
  const limits = arr(obj(f.coverage_limits)?.limits).map((l) => obj(l) ?? {});
  const partial = arr(f.files_partially_read).map(obj).filter((x): x is Obj => !!x);
  const walkerRows = arr(f.excluded_by_walker).map((x) => obj(x) ?? {}).filter((x) => WORDS.filesRefusedWhy[str(x.reason)] !== undefined);
  // A link to a file outside the scanned folder is its own line and section, so the first screen says so.
  const refused = walkerRows.filter((x) => str(x.reason) !== "link-to-outside");
  const outsideLinks = walkerRows.filter((x) => str(x.reason) === "link-to-outside");
  const counted: Inert[] = [];
  for (const l of limits) {
    const n = obj(l.counts) ?? {};
    const num = (k: string) => Number(n[k] ?? 0) || 0;
    const scope = WORDS.notReadScope[str(l.id)];
    if (scope && num("files") > 0) counted.push(md`${markdownText(num("files").toLocaleString("en"))} ${scope}${typeof l.lift === "string" && l.lift ? WORDS.notReadScopeLift(code(l.lift)) : ours("")}`);
    if (str(l.id) === "refused-by-rule" && num("files_in_directories") + num("files") + num("directories_not_enumerated") > 0) counted.push(WORDS.notReadMachine(num("files_in_directories") + num("files"), num("directories_not_enumerated")));
    if (str(l.id) === "not-readable-as-code") {
      // Counted by their own kinds below where findings.json names the files; said here only where it does not.
      if (num("refused_by_the_walker") > 0 && refused.length === 0) counted.push(WORDS.notReadBinary(num("refused_by_the_walker")));
      if (num("read_to_no_rule") > 0 && arr(f.files_not_read).length === 0) counted.push(WORDS.notReadNoRule(num("read_to_no_rule")));
      if (num("lines_left_out") > 0) counted.push(WORDS.notReadLines(num("lines_left_out"), partial.length === 1 ? code(str(partial[0]?.file)) : null));
    }
  }
  /* M2's "Not read" item prints the notes' own counts (the read-scope
   * counts come from `notReadParts`, the end screen's, so they are left out here): a machine-written folder whose files
   * were not counted keeps its "+" on the first screen. */
  const scopeWords = new Set(Object.values(WORDS.notReadScope));
  const onScreen = counted.filter((c) => ![...scopeWords].some((w) => c.includes(` ${w}`)));
  kinds.push({ ...kind("did-not-read", limits.length, section(WORDS.didNotRead, limits.map((o) => WORDS.limitRow(markdownText(str(o.sentence)), typeof o.lift === "string" ? code(o.lift) : null))), WORDS.uncheckedNotes(counted)), ...(onScreen.length > 0 ? { parts: onScreen } : {}) });
  const filesNotRead = arr(f.files_not_read).map((r) => obj(r) ?? {});
  const wholeForTime = filesNotRead.filter((o) => str(o.reason) === "time-budget").length;
  const partForTime = partial.filter((o) => o.stopped_for_time !== undefined).length;
  kinds.push(
    kind(
      "files-not-read",
      filesNotRead.length,
      section(
        WORDS.filesNotRead,
        filesNotRead.map((o) => {
          const extra = [o.longest_line !== undefined ? WORDS.longestLine(Number(o.longest_line)) : "", o.elapsed_ms !== undefined ? WORDS.stoppedForTime(Number(o.elapsed_ms), Number(o.budget_ms)) : "", str(o.detail)].filter(Boolean).join("; ");
          return WORDS.fileNotReadRow(code(str(o.file)), markdownText(`${str(o.reason)}${extra ? ` (${extra})` : ""}`));
        }),
      ),
      wholeForTime > 0 ? WORDS.uncheckedForTime(wholeForTime) : ours(""),
    ),
  );
  kinds.push(
    kind(
      "lines-not-read",
      partial.length,
      section(
        WORDS.linesNotRead,
        partial.map((o) => {
          const lines = arr(o.lines).map((x) => obj(x) ?? {}).map((x) => WORDS.lineNotRead(Number(x.line), Number(x.length)));
          const stopped = obj(o.stopped_for_time);
          return WORDS.linesNotReadRow(code(str(o.file)), lines.length > 0 ? inertJoin(lines, ours(", ")) : stopped ? WORDS.timeBudgetStoppedRead(markdownText(canonical(stopped))) : WORDS.noLineRecorded);
        }),
      ),
      partForTime > 0 ? WORDS.uncheckedForTime(partForTime) : ours(""),
    ),
  );
  /* The files the walker did not open as code - binary, over the size
   * ceiling, or of a type not scanned - by folder, with the examples the scan kept; counted in files. */
  const refusedFiles = sumOf(refused, (x) => Number(x.files ?? 0) || 0);
  kinds.push(
    kind(
      "files-refused",
      refusedFiles,
      refusedFiles > 0
        ? section(
            WORDS.filesRefusedHeading,
            refused.map((x) => WORDS.filesRefusedRow(code(str(x.dir)), Number(x.files ?? 0) || 0, WORDS.filesRefusedWhy[str(x.reason)] ?? markdownText(str(x.reason)), arr(x.examples).map((e) => code(str(e))))),
          )
        : [],
    ),
  );
  const outsideFiles = sumOf(outsideLinks, (x) => Number(x.files ?? 0) || 0);
  kinds.push(
    kind(
      "files-outside",
      outsideFiles,
      outsideFiles > 0
        ? section(
            WORDS.filesOutsideHeading,
            outsideLinks.map((x) => WORDS.filesRefusedRow(code(str(x.dir)), Number(x.files ?? 0) || 0, WORDS.filesRefusedWhy["link-to-outside"] ?? ours(""), arr(x.examples).map((e) => code(str(e))))),
          )
        : [],
    ),
  );
  /* Every place no review read, by finding and by file, whatever file the finding is in. */
  const unread = [...m.unread].sort((x, y) => (str(x.verdict.finding_id) < str(y.verdict.finding_id) ? -1 : 1));
  kinds.push(
    kind(
      "places-not-opened",
      unread.length,
      unread.length > 0
        ? section(
            WORDS.placesNotChecked,
            unread.flatMap((it) => {
              const nc = it.notChecked as NotCheckedPlaces;
              return [WORDS.placesNotCheckedRow(markdownText(str(it.candidate?.rule_id)) || WORDS.ruleNotInFindings, code(str(it.verdict.finding_id)), nc.places, notCheckedWhy(nc)), ...notCheckedLines(nc, ours(""), Infinity).slice(1)];
            }),
          )
        : [],
      WORDS.uncheckedOpenedPlaces(sumOf(unread, (it) => it.notChecked?.places ?? 0), unread.filter((it) => m.partly.includes(it) || m.overturnedUnquoted.includes(it)).length),
    ),
  );
  const answers = new Map<string, Set<string>>();
  const note = (mm: Map<string, Set<string>>, expr: string, rule: string) => {
    const set = mm.get(expr) ?? new Set<string>();
    set.add(rule);
    mm.set(expr, set);
  };
  for (const c of [...a.candidates, ...a.silent]) for (const e of arr(c.declared_inapplicable_preconditions).map(str)) note(answers, e, str(c.rule_id));
  const ruleList = (ids: Set<string>): Inert => inertJoin([...ids].sort().map((id) => md`${markdownText(id)} (${programText(m.titleOf.get(id) ?? "")})`), ours("; "));
  // The parent's ruling (a): one item "Questions open" (design 4: the count, the
  // findings they would settle, how to answer, the link to the full list in words in laws.md); the rows of the fields the
  // rules read went to that list, so the questions are listed in one place.
  const open = openQuestionsOf(m);
  kinds.push(kind("questions", open.count, section(WORDS.questionsUnanswered, open.count > 0 ? [open.item] : [])));
  kinds.push(
    kind(
      "answers-not-taken",
      answers.size,
      section(
        WORDS.answersNotTaken,
        [...answers.keys()].sort().map((e) => {
          const hit = m.contradictedBy.get(e) ?? contradictionOf(e, a.candidates);
          return hit ? WORDS.answerContradicted(code(e), markdownText(hit.rule), markdownText(hit.where)) : WORDS.answerNotContradicted(code(e), ruleList(answers.get(e) as Set<string>));
        }),
      ),
    ),
  );
  const suppressed = a.suppressions ?? [];
  kinds.push(kind("suppressed", suppressed.length, suppressed.length > 0 ? section(WORDS.suppressedHeading, [WORDS.noVerdictLevel(levelsOf(suppressed)), ours(""), ...suppressed.map((x) => WORDS.suppressedRow(code(str(x.finding_id)), said(str(x.reason))))]) : []));
  const notTaken = arr(a.plan.previous_not_taken).map(obj).filter((x): x is Obj => !!x);
  kinds.push(
    kind(
      "settlement",
      notTaken.length,
      notTaken.length > 0
        ? section(WORDS.settlementNotHonoured, [...notTaken.map((x) => WORDS.settlementRow(markdownText(Object.entries(x).map(([k, v]) => `${k}: ${typeof v === "string" ? v : canonical(v)}`).join("; ")))), ours(""), WORDS.settlementSentence])
        : [],
    ),
  );
  return kinds;
}

/** The declaration plan beside the findings (the scan writes it there), where it is this scan's; else null. */
export function declarationPlanOf(dir: string, findings: Obj): Obj | null {
  const r = readJson(join(dir, DECLARATION_PLAN_FILE));
  const plan = r.ok ? obj(r.value) : undefined;
  return plan && str(plan.kind) === "declaration-plan" && str(plan.scan_id) === str(findings.scan_id) && str(findings.scan_id) !== "" ? plan : null;
}

/** What the scan and the assembly say when the plan is not bound. */
export const PLAN_DIGEST_WORDS = {
  notRecorded: (why: string) =>
    `The declaration plan's digest was not recorded in your state folder (${why}), so the report will not say whose answers this scan used.${stateFolderAdvice(why)}`,
  notTaken: (why: string) =>
    `The report does not say whose answers this scan used: .legal/declaration-plan.json ${why}, so it is not taken as the scan's own.`,
  changed: "changed since the scan wrote it",
  none: "has no digest kept on this computer",
  unread: (why: string) => `cannot be checked (the record of the files WolfBoy wrote could not be read: ${why})`,
  // Words
  unreadable: (why: string) => `cannot be read (${why})`,
};

/**
 * THE PLAN, BOUND: `declarationPlanOf`, taken only while the plan's
 * bytes have the sha256 the scan recorded for its scan id in the person's state folder (log-digest.ts `planDigestName`).
 * A plan changed since, or one with no digest kept here, is not the scan's statement of whose answers it used: null, and
 * one sentence for the person. A check against an edit made without knowing of the record, as the logs' digests are.
 */
export function boundDeclarationPlan(dir: string, findings: Obj, stateDir: string | null, target: string): { plan: Obj | null; note: string | null; why: string | null } {
  const plan = declarationPlanOf(dir, findings);
  if (plan === null) {
    // No plan of this scan beside the findings (deleted, malformed or
    // another scan's), while the state folder keeps this scan's plan digest: the scan wrote one, so the report says so
    // and never "no answer in your declaration".
    const scanId = str(findings.scan_id);
    if (scanId !== "" && digestMarkOf(readLogDigests(stateDir, target), planDigestName(scanId), "") === "changed") {
      const why = PLAN_DIGEST_WORDS.unreadable("it is missing, or it is not this scan's plan");
      return { plan: null, note: PLAN_DIGEST_WORDS.notTaken(why), why };
    }
    return { plan: null, note: null, why: null };
  }
  const got = readProgramFile("the declaration plan", join(dir, DECLARATION_PLAN_FILE));
  // A plan this scan wrote that is not taken says why, here and beside
  // every open question it would have answered (`questionStatusOf`), never "no answer in your declaration".
  if (!got.ok) return { plan: null, note: PLAN_DIGEST_WORDS.notTaken(PLAN_DIGEST_WORDS.unreadable(got.problem)), why: PLAN_DIGEST_WORDS.unreadable(got.problem) };
  const mark = digestMarkOf(readLogDigests(stateDir, target), planDigestName(str(findings.scan_id)), createHash("sha256").update(got.value).digest("hex"));
  if (mark === "matches") return { plan, note: null, why: null };
  const digests = readLogDigests(stateDir, target);
  const why = mark === "changed" ? PLAN_DIGEST_WORDS.changed : mark === "none" ? PLAN_DIGEST_WORDS.none : PLAN_DIGEST_WORDS.unread(digests.ok ? "" : digests.why);
  return { plan: null, note: PLAN_DIGEST_WORDS.notTaken(why), why };
}

/**
 * What became of the question an open
 * precondition names, as the run's declaration plan records it: the plan and the report say the same thing about every
 * question, and a question the plan chose not to ask is never called one nobody answered. A field asked in parts is
 * matched on any of its rows; a plan from another scan, or none, says only that the declaration holds no answer.
 */
export function questionStatusOf(plan: Obj | null, expr: string, notTaken: Inert | null = null): Inert {
  if (plan === null && notTaken !== null) return WORDS.questionStatus.notTaken(notTaken);
  const field = preconditionField(expr);
  const rows = arr(plan?.questions).map(obj).filter((q): q is Obj => !!q && str(q.field) === field);
  const st = new Set(rows.map((q) => str(q.status)));
  if (rows.length === 0) return WORDS.questionStatus.noPlan;
  if (st.has("asked")) return WORDS.questionStatus.asked;
  if (st.has(NOT_ASKED_LATER)) return WORDS.questionStatus.later(code(reviewDeclarationCommand()));
  if (st.has("answered before")) return WORDS.questionStatus.before;
  return WORDS.questionStatus.none;
}

/** `not-checked.md`: every kind of `uncheckedKinds`, in its order, under WHAT WAS NOT ESTABLISHED. */
/** The candidates the plan carried from an earlier run without a new review (0 where it names none). */
/** The review the carried verdicts come from, and its log's mark (`WORDS.carriedMark`). */
function carriedFromOf(m: ReportModel): [Inert, Inert] {
  const later = laterOf(m);
  const earlier = later?.earlier ?? m.a.numbering?.carried?.label;
  return [earlier !== undefined ? markdownText(earlier) : WORDS.reviewEarlier, WORDS.carriedMark[later?.c.digest ?? "matches"] ?? ours("")];
}
function carriedCountOf(a: ReportArgs): number {
  return str(a.plan.previous_scan_id) ? Number(obj(obj(a.plan.pre_launch)?.carried)?.candidates ?? 0) : 0;
}

/**
 * The run-wide lines `details.md` opened with before rf11 (design 3.1.1
 * replaced that file with one file per finding): the carry line, a rule read on a model other than its own, the places
 * asked to be read again, and the places no review read with how to have them read.
 * Each is about what this run did not read or read differently, so `not-checked.md` ("every item of Not checked") opens
 * with them, once (design 3.1 item 4: a run-wide fact said once per view).
 */
function runWideLines(m: ReportModel): Inert[] {
  const { a } = m;
  const out: Inert[] = [];
  if (str(a.plan.previous_scan_id)) {
    out.push(WORDS.carryLine(earlierRun(a, str(a.plan.previous_scan_id)), carriedCountOf(a), arr(a.plan.to_adjudicate).length, arr(a.plan.gone).length, arr(a.plan.not_chosen).length), ours(""));
    // What the carry did not look at, said where the carry is.
    out.push(...carriedPastLines(a));
  }
  // Review R18: a rule read on a model other than its own setting is named, with its place count, in every report.
  const overridden = modelOverrideLine(a.modelOverrides ?? []);
  if (overridden) out.push(WORDS.modelOverride(markdownText(overridden)), ours(""));
  // A run with no second check says so once, on the first screen's Laws item ("each place reviewed once", design 3.1 item 4).
  out.push(...readAgainTotalLines(a));
  if (m.unread.length > 0) out.push(WORDS.notCheckedTotal(m.unread.reduce((n, it) => n + (it.notChecked?.places ?? 0), 0), m.unread.length), ours(""));
  if (m.unread.length > 0) out.push(WORDS.notCheckedAsk(a.logPath ? md`${inSpan(code(a.logPath))}` : md`the log of scan ${markdownText(str(a.findings.scan_id) || "(unnamed)")}`), ours(""));
  return out;
}

/**
 * THE CARRY'S LIMITS, IN THE REPORT: an answer carried
 * past a change to a package it does not rest on (the plan row's `packages_changed_not_rested_on`), with the packages and
 * their counts and what the comparison cannot see; and, wherever any answer was carried, the lock files it does not read.
 * Before, the report said only that nothing the answers rested on had changed, and the packages were in the plan file alone.
 */
export function carriedPastLines(a: { plan: Record<string, unknown> }): Inert[] {
  const byPackage = new Map<string, number>();
  let answers = 0;
  let carriedRows = 0;
  for (const row of arr(a.plan.rows)) {
    const r = obj(row);
    if (str(r?.outcome) !== "carried") continue;
    carriedRows += 1;
    const names = arr(r?.packages_changed_not_rested_on).filter((n): n is string => typeof n === "string");
    if (names.length === 0) continue;
    answers += 1;
    for (const n of names) byPackage.set(n, (byPackage.get(n) ?? 0) + 1);
  }
  const out: Inert[] = [];
  if (answers > 0) {
    const ranked = [...byPackage.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
    const list = inertJoin(ranked.slice(0, 8).map(([n, k]) => md`${inSpan(code(n))} (${k} ${k === 1 ? ours("answer") : ours("answers")})`), ours(", "));
    out.push(WORDS.carriedPastPackages(answers, list, Math.max(0, ranked.length - 8)), ours(""));
  }
  if (carriedRows > 0) out.push(WORDS.carriedLockLimit, ours(""));
  return out;
}

/**
 * THE ONE COUNT of the rules that found nothing (rf11-b1a-2026-11-06.md 12.7):
 * `n` is the scan's own count (its coverage limit "rules-silent") where the scan gave one, never fewer than the rules
 * not-checked.md lists under "Rules that found nothing" (`listed`: the three kinds under that heading, each a rule that
 * found nothing); where the scan gave none, `n` is what that page lists. The first screen, the end screen and the
 * page's own lead line print this `n`, so no two places count it apart.
 */
function rulesNothingOf(m: ReportModel): { n: number; listed: number } {
  const listed = sumOf(uncheckedKinds(m).filter((k) => RULES_NOTHING_KINDS.has(k.key)), (k) => k.n);
  const limit = arr(obj(m.a.findings.coverage_limits)?.limits).map(obj).find((l) => str(l?.id) === "rules-silent");
  const scan = Number(obj(limit?.counts)?.rules_silent);
  return { n: limit && Number.isInteger(scan) && scan >= 0 ? Math.max(scan, listed) : listed, listed };
}
const RULES_NOTHING_KINDS: ReadonlySet<UncheckedKey> = new Set<UncheckedKey>(["gap", "absent", "not-checked-rules"]);

function buildNotChecked(m: ReportModel): Inert {
  const out: Inert[] = [WORDS.notCheckedTitle(markdownText(m.project)), ours(""), WORDS.backToReport(linkTarget(m.a.reportName ?? "report.md")), ours(""), WORDS.notCheckedIntro, ours("")];
  out.push(...runWideLines(m));
  out.push(WORDS.notEstablished, ours(""));
  for (const k of uncheckedKinds(m)) {
    // The first screen's "Rules that found nothing" links here: one plain heading over the three sections it counts.
    if (k.key === "gap") {
      const rn = rulesNothingOf(m);
      out.push(WORDS.rulesNothingHeading, ours(""), WORDS.rulesNothingLead(rn.n, rn.listed), ours(""));
    }
    out.push(...k.lines);
  }
  out.push(ours("---"), ours(""), md`*${WORDS.disclaimer}*`, ours(""));
  return inertJoin(out, ours("\n"));
}

/**
 * THE ONE COMPUTATION of the open questions (the parent's rulings (a) and (b) of
 * 2026-11-06; design 4, "Open questions": an item of Not checked with the count, the findings they would settle and how to
 * answer; the full list in words in `laws.md`): the question slots in the order's key (those that settle findings to answer,
 * and the product question that changes only the order, W7), and the fields the rules read that no answer gave, each with
 * the rules it holds open. `not-checked.md`'s item and `laws.md`'s list are both written from it.
 */
function openQuestionsOf(m: ReportModel): { count: number; item: Inert; slots: QuestionSlot[]; fields: Map<string, Set<string>> } {
  const rank = (q: QuestionSlot): number => (q.kind === "check_answer" ? 0 : 1);
  const slots = [...(m.a.questions ?? [])].sort((x, y) => compareKeys(x.key, y.key) || rank(x) - rank(y));
  const fields = new Map<string, Set<string>>();
  for (const c of [...m.a.candidates, ...m.a.silent]) {
    for (const e of arr(c.unanswered_preconditions).map(str)) fields.set(e, (fields.get(e) ?? new Set<string>()).add(str(c.rule_id)));
  }
  const settling = slots.filter((q) => q.kind !== "order_moving");
  const settled = new Set(settling.flatMap((q) => q.findingIds)).size;
  const order = slots.length - settling.length;
  const bare = (field: string): string => field.replace(/^(?:ScanProfile|profile)\./, "");
  const asked = new Set(slots.map((q) => bare(q.question)));
  const more = [...fields.keys()].filter((e) => !asked.has(bare(preconditionField(e))));
  const held = new Set(more.flatMap((e) => [...(fields.get(e) as Set<string>)])).size;
  const count = slots.length + more.length;
  return { count, item: count > 0 ? WORDS.questionsOpenItem(settling.length, settled, order, more.length, held, code(reviewDeclarationCommand())) : ours(""), slots, fields };
}

/**
 * `laws.md`'s "Questions open" (design 3.1.1: `laws.md`
 * holds "every open question in words"; design 4): every question slot in the order's key, each with what its answer
 * decides and the entrance that asks it, the product question that changes only the order (W7) marked as such; then the
 * fields the rules read that no answer gave, each with the rules it holds open (what `not-checked.md`'s "Questions still
 * open" listed before).
 */
function questionsOpenLines(m: ReportModel): Inert[] {
  const { slots, fields } = openQuestionsOf(m);
  if (slots.length === 0 && fields.size === 0) return [];
  const out: Inert[] = [ours(""), WORDS.questionsOpenHeading, ours("")];
  for (const q of slots) {
    const rules = listWords(q.rules.slice(0, 3).map((r) => md`"${m.plainOf(r)}"`).concat(q.rules.length > 3 ? [WORDS.andMore(q.rules.length - 3)] : []));
    const lines = q.kind === "order_moving" ? [WORDS.questionMovesOpen(markdownText(q.text), q.findingIds.length), WORDS.questionEntrance(code(reviewDeclarationCommand()))] : slotLines(m, q, ours("-"), rules);
    const [head, ...rest] = lines;
    if (head !== undefined) out.push(head, ...rest.map((l) => md`  ${inertTrim(l)}`));
  }
  if (fields.size > 0) {
    const ruleList = (ids: Set<string>): Inert => inertJoin([...ids].sort().map((id) => md`${markdownText(id)} (${programText(m.titleOf.get(id) ?? "")})`), ours("; "));
    if (slots.length > 0) out.push(ours(""));
    out.push(WORDS.questionsRulesLead, ours(""));
    for (const e of [...fields.keys()].sort()) out.push(WORDS.questionRow(code(e), ruleList(fields.get(e) as Set<string>), questionStatusOf(m.a.declarationPlan ?? null, e, textOrNull(m.a.declarationPlanNotTaken))));
  }
  return out;
}

/**
 * The provisions limited to a region the person answered No (design
 * 3.1.1: `laws.md` holds the regions and whose answers; section 3.5, W14): for each rule of a finding that stands, its law
 * line naming those provisions as not applying on the answers, with the answers that settled them. Each cite's region is
 * the bundle's, by the order's own membership test.
 */
function regionLimitedLines(m: ReportModel): Inert[] {
  const out: Inert[] = [];
  for (const g of groupBy(m.shown, (it) => str(it.candidate?.rule_id)).values()) {
    const it = g[0] as Item;
    const oi = it.orderInput;
    const raw = arr(it.candidate?.legal_basis_refs).map(str);
    const outIdx = new Set(raw.map((_, n) => n).filter((n) => !!oi && basisAnsweredOut(oi, oi.ruleBases?.[n]?.jurisdiction, raw[n])));
    if (outIdx.size === 0) continue;
    const cites = (keep: boolean): Inert => inertJoin([...new Set(raw.filter((r, n) => r && outIdx.has(n) !== keep).map(citationOf))].map((c) => programText(c)), ours("; "));
    const answer = regionNoWords([...outIdx].map((n) => oi?.ruleBases?.[n]?.jurisdiction));
    out.push(md`### ${m.plainOf(str(it.candidate?.rule_id))}`, ours(""), WORDS.lawByAnswers(cites(true), cites(false), answer), ours(""));
  }
  return out.length > 0 ? [ours(""), WORDS.regionLimitedHeading, ours(""), ...out] : [];
}

/**
 * An instrument's open questions in laws.md, in
 * the words of each limb's question (findings.json `limbs[].question`), not its id: the questions that decide whether the
 * law reaches the product, then the exemptions, then a count of the limbs that only annotate a finding, with their ids, and
 * one line on what this version can record. A findings document with no `limbs` keeps the ids, as before.
 */
export function lawQuestionsOf(x: Obj): Inert[] {
  const open = arr(x.unresolved_limbs).map(str).filter(Boolean);
  const byId = new Map(arr(x.limbs).map(obj).filter((l): l is Obj => !!l).map((l) => [str(l.limb_id), l] as const));
  if (open.length === 0) return [];
  const suggested = suggestedByCodeOf(x);
  const known = open.filter((id) => byId.has(id));
  const out: Inert[] = open.filter((id) => !byId.has(id)).map((id) => WORDS.openQuestion(markdownText(id)));
  if (known.length === 0) return out;
  const limb = (id: string): Obj => byId.get(id) as Obj;
  const bears = (id: string): boolean => limb(id).bears_on_verdict === true;
  const required = known.filter((id) => bears(id) && str(limb(id).closes_gate_when) !== "true");
  const exempt = known.filter((id) => bears(id) && str(limb(id).closes_gate_when) === "true");
  const detail = known.filter((id) => !bears(id));
  const asked = (id: string): Inert => WORDS.lawQuestion(markdownText(oneLine(str(limb(id).question), 400) || id), code(id), suggested.get(id));
  if (required.length > 0) out.push(WORDS.lawRequiredHead(required.length), ...required.map(asked));
  if (exempt.length > 0) out.push(WORDS.lawExemptHead(exempt.length), ...exempt.map(asked));
  if (detail.length > 0) out.push(WORDS.lawDetail(detail.length, detail.map((id) => code(id))));
  if (required.length + exempt.length > 0) out.push(WORDS.lawRecordable);
  return out;
}

/**
 * Where the code suggests
 * an answer to a question about the product that decides whether a law applies (`bears_on_verdict`): the first place and
 * the count of the rest, by limb id, for the question's own line. Since R10-CRA such a limb is never counted as met from
 * code: it stays in `unresolved_limbs` and is asked, so this is shown beside the question and the verdict does not rest
 * on it. A `decided_by: code` limb (a fact about the code itself, which the code settles), a premise and the person's own
 * answer are not suggestions and are not listed.
 */
function suggestedByCodeOf(x: Obj): Map<string, Inert> {
  const out = new Map<string, Inert>();
  for (const l of arr(x.limbs).map(obj)) {
    if (!l || l.bears_on_verdict !== true || str(l.decided_by) === "code") continue;
    const state = str(l.state);
    // The product question with nothing users install or run: what that looks like.
    if (str(l.limb_id) === CRA_PRODUCT_LIMB && state === "unresolved" && (Number(l.supporting_count) || 0) === 0) {
      out.set(str(l.limb_id), WORDS.lawShowsNothingInstalled);
      continue;
    }
    if (state !== "supported" && !(state === "contradicted-by-declaration" && (Number(l.supporting_count) || 0) > 0)) continue;
    // Both states hold at least one supporting fact (scope.ts); a document without one names no place, so no line. A web manifest or service worker is said as what
    // it is, and a dependency, shown last, as a library; neither is said as a yes.
    const listed = arr(l.supporting).map(obj).filter((e): e is Obj => !!e);
    const web = listed.filter((e) => str(e.kind) === "installable_web_client");
    const rest = listed.filter((e) => str(e.kind) !== "installable_web_client").sort((p, q) => Number(str(p.kind) === "dependency") - Number(str(q.kind) === "dependency"));
    const total = Math.max(0, (Number(l.supporting_count) || 0) - web.length);
    const against = state === "contradicted-by-declaration";
    const first = rest[0];
    const at = (e: Obj): Spanned => code(`${str(e.file)}:${Number(e.line) || 0}`);
    const parts: Inert[] = [];
    if (first) parts.push(str(first.kind) === "dependency" ? WORDS.lawSuggestedDependency(at(first), Math.max(0, total - 1), against) : WORDS.lawSuggested(at(first), Math.max(0, total - 1), against));
    if (web[0]) parts.push(WORDS.lawSuggestedWebClient(at(web[0]), web.length - 1));
    if (parts.length > 0) out.set(str(l.limb_id), inertJoin(parts, ours(" ")));
  }
  return out;
}
/** The CRA gate's product limb (rules/gates/cra-scope.yaml). */
const CRA_PRODUCT_LIMB = "is-a-product-with-digital-elements";

/**
 * The open questions the laws line counts: those that decide whether the law applies (`bears_on_verdict`); every open one
 * where the document holds no `limbs`. An
 * exclusion (`closes_gate_when: "true"`) decides only once every condition is met, so while a condition is open only the
 * open conditions are counted: until 2026-11-13 the CRA's line said "15 questions" for four conditions and eleven
 * exclusions. laws.md still lists every open question.
 */
function decidingOpenOf(x: Obj): string[] {
  const open = arr(x.unresolved_limbs).map(str).filter(Boolean);
  const limbs = arr(x.limbs).map(obj).filter((l): l is Obj => !!l);
  if (limbs.length === 0) return open;
  const bears = new Set(limbs.filter((l) => l.bears_on_verdict === true).map((l) => str(l.limb_id)));
  const exclusion = new Set(limbs.filter((l) => str(l.closes_gate_when) === "true").map((l) => str(l.limb_id)));
  const deciding = open.filter((id) => bears.has(id));
  const conditions = deciding.filter((id) => !exclusion.has(id));
  return conditions.length > 0 ? conditions : deciding;
}

/** `laws.md`: the applicability block (step 3a), as the report opened with it in earlier versions. */
function buildLaws(m: ReportModel): Inert {
  const { a } = m;
  const f = a.findings;
  const out: Inert[] = [WORDS.lawsTitle(markdownText(m.project)), ours(""), WORDS.backToReport(linkTarget(m.a.reportName ?? "report.md")), ours("")];
  const pra = obj(f.per_rule_applicability);
  const regions = pra ? pra.declared_regions : undefined;
  if (!pra || regions === null || regions === undefined) out.push(WORDS.regionsUnanswered, ours(""));
  const whose = whoseAnswersOf(m, "long");
  if (whose) out.push(whose, ours(""));
  out.push(WORDS.applicabilityHeading, ours(""));
  const app = arr(f.applicability).map(obj).filter((x): x is Obj => !!x);
  if (app.length === 0) out.push(WORDS.applicabilityNone);
  for (const block of applicabilityBlocksOf(app)) {
    const x = block.entries[0] as Obj;
    out.push(WORDS.applicabilityLine(markdownText(str(x.law)), markdownText(str(x.cite)), markdownText(str(x.verdict)), said(str(x.because))));
    if (block.entries.length > 1) out.push(WORDS.applicabilityShared(block.entries.map((e) => markdownText(str(e.checklist_id)))));
    else if (block.apart) out.push(WORDS.applicabilityChecklist(markdownText(str(x.checklist_id))));
    out.push(...lawQuestionsOf(x));
    for (const c of arr(x.contradictions).map(obj)) if (c) out.push(WORDS.contradiction(markdownText(str(c.limb_id)), markdownText(str(c.declared_by)), Number(c.evidence_count ?? 0)));
  }
  if (arr(f.applicability_not_assessed).length > 0) out.push(ours(""), WORDS.notAssessedLead, ours(""));
  for (const n of arr(f.applicability_not_assessed)) {
    const o = obj(n);
    out.push(WORDS.notAssessed(markdownText(o ? str(o.checklist_id) || str(o.law) || canonical(o) : str(n))));
  }
  /* The places out of scope by the person's answers (they were in not-applicable.md): each
   * rule settled by an answer, the answer quoted with its date, by rule. */
  type Row = { rule: string; lines: Inert[] };
  const settledRows: Row[] = [
    ...a.preSettled.map((p): Row => {
      // A rule settled by a scope answer (WP4's `settled_by`):
      // the answer quoted, its date, the candidate and its places (NV11); a region answer as today.
      const sb = obj(arr(obj(a.findings.per_rule_applicability)?.rules).map(obj).find((r) => str(r?.rule_id) === str(p.rule_id))?.settled_by);
      if (!sb) return { rule: str(p.rule_id), lines: [WORDS.byDeclaration(markdownText(str(p.rule_id)), code(str(p.finding_id)), said(str(p.because)), markdownText(arr(p.declared_regions).map(str).join(", ")), markdownText(str(p.answered_from)), markdownText(str(p.answered_at).slice(0, 10)))] };
      const t = questionTextOf(str(sb.field));
      const places = arr(m.candidateById.get(str(p.finding_id))?.locations).length;
      return { rule: str(p.rule_id), lines: [md`- ${markdownText(str(p.rule_id))} ${inSpan(code(str(p.finding_id)))}: ${WORDS.byAnswerNV(markdownText(t.header), markdownText(t.labelOf(sb.answer) ?? String(sb.answer)), markdownText(str(sb.recorded_at).slice(0, 10)), places, programText(t.covers ?? ""), settledExclusionsOf(a.ruleBases, [str(p.rule_id)]))}`] };
    }),
  ];
  out.push(...regionLimitedLines(m));
  out.push(...questionsOpenLines(m));
  if (settledRows.length > 0) {
    out.push(ours(""), WORDS.outOfScopeHeading, ours(""));
    for (const g of [...groupBy(settledRows, (r) => r.rule).values()]) out.push(WORDS.notApplicableGroup(m.plainOf(str(g[0]?.rule)), g.length), ours(""), ...g.flatMap((r) => r.lines), ours(""));
  }
  out.push(ours(""), ours("---"), ours(""), md`*${WORDS.disclaimer}*`, ours(""));
  return inertJoin(out, ours("\n"));
}

/** The first-screen composer and the five builders: every file the person reads, before step 13's printed redaction. */
/** The possible issues by severity, and the first three to start with, as the report orders them. */
export interface EndSummary {
  severities: { high: number; medium: number; low: number };
  /**
   * The possible issues the first screen counts to fix first, from the same computation
   * (`headlineCountsOf`); the high ones that need judgement are in the screen's own row. Absent: not stated.
   */
  toFix?: number;
  first: { title: string; place: string }[];
  /** The counts report.md's first screen shows, from the same model. */
  counts?: DispositionCounts;
  /** What the end screen of design rf11 3.1 shows besides (mock M1), from the same model. */
  screen?: {
    project: string;
    day: string;
    once: boolean;
    /** `reviewWords`' short form, from the rows. */
    review?: string;
    laws: string[];
    ruledOut: number;
    outOfScope: number;
    notCounted: number;
    noVerdict: number;
    partly: number;
    /** The verdicts carried from an earlier run, not re-read in this one (design 3.1 item 3; mock M8); 0 on a first run. */
    carried: number;
    /** Rules that found nothing: `rulesNothingOf`, the same count the first screen and not-checked.md say. */
    silent: number;
    fixFirst: { f: string; short: string; title: string; place: string; more: number }[];
    startsAt: number | null;
    /** The earlier review the carried verdicts come from ("4 Nov"), and its log's mark. */
    carriedFrom?: string;
    carriedMark?: string;
    /** (mock M8) What changed since the earlier review; absent on a run that carried from none. */
    later?: {
      day: string;
      compared: boolean;
      why: string;
      up: number;
      down: number;
      downParts: string;
      /** "gone, was high: F1 <title>" where a finding that was high is lower or gone. */
      highDown: string | null;
      same: number;
      /** New or higher, in the order the end screen shows them (to fix first, the last kept for a new to-clarify item). */
      items: { f: string; short: string; title: string; place: string; more: number; note: string; clarify: boolean }[];
      upListed: number;
      upDecided: number;
      still: { n: number; high: number; first: { f: string; short: string; title: string } | null };
    };
    /** Findings counted in a row and listed under "Decided by you" (mock M8). */
    decided: { toFix: number; counsel: number };
  };
}

/**
 * What the end of the run shows: the counts of the first screen (the
 * model's `counts`, so the two screens cannot differ) and the first three findings to fix in Fix first's order.
 */
function endSummaryOf(m: ReportModel, printedText: (t: string) => string): EndSummary {
  const c = m.counts;
  if (!m.files) m.files = fileModelOf(m);
  const inFixFirst = fixFirstEntries(m).flatMap((e) => ("group" in e ? e.group : []));
  const listed = new Set(inFixFirst);
  const toFix = m.shown.filter((it) => m.dispOf(it) === "to_fix");
  const first = [...inFixFirst, ...toFix.filter((it) => !listed.has(it))].slice(0, 3).map((it) => ({
    title: printedText(((l) => (l ? titleOfListed(m, l).replace(/ \(\d+ places\)$/, "") : m.plainOf(ruleIdOf(it))))(m.files?.byId.get(idOf(it)))),
    place: valueText(printedText(placeOf(m, it))),
  }));
  if (!m.files) m.files = fileModelOf(m);
  const noAnswer = [...m.a.unadjudicated, ...(m.a.suppressions ?? [])];
  const fixFirst = m.files.listed
    .filter((l) => l.kind === "to_fix" && !decidedListed(m, l))
    .slice(0, 3)
    .map((l) => ({ f: fOf(l), short: l.short, title: printedText(titleOfListed(m, l).replace(/ \(\d+ places\)$/, "")), place: valueText(printedText(placeOf(m, l.items[0] as Item))), more: placesOfListed(m, l) - 1 }));
  const note = m.files.numbers.note;
  const lt = laterOf(m);
  const titleOf = (l: Listed): string => printedText(titleOfListed(m, l).replace(/ \(\d+ places\)$/, ""));
  const screenLater = lt
    ? {
        day: lt.day,
        compared: lt.c.compared,
        why: lt.c.why,
        up: lt.s.up.length + lt.back,
        down: lt.s.down.length,
        downParts: downParts(lt.s),
        highDown: ((hd) => (hd ? ((e) => `${downWord(hd)}, was high: ${e.f ? `${e.f} ` : ""}${printedText(e.title)}`)(lt.look.listed(hd.id) ?? lt.look.earlier(hd.earlier?.id ?? hd.id, hd.rule)) : null))(lt.s.highDown),
        same: lt.s.unchanged - lt.back,
        items: upShownOf(lt, 3).map((l) => ({ f: fOf(l), short: l.short, title: titleOf(l), place: valueText(printedText(placeOf(m, l.items[0] as Item))), more: placesOfListed(m, l) - 1, note: upNoteOf(m, lt, l), clarify: l.kind === "counsel" })),
        upListed: lt.up.length,
        upDecided: lt.upDecided,
        // Counted as before; the first named is one not decided (design 3.2.1).
        still: { n: lt.stillAll.length, high: lt.stillAll.filter((l) => m.sevOf(l.items[0] as Item) === "high").length, first: lt.still[0] ? { f: fOf(lt.still[0]), short: lt.still[0].short, title: titleOf(lt.still[0]) } : null },
      }
    : null;
  const screen = {
    project: m.project,
    day: dayWords(str(m.a.findings.completed_at)),
    once: !!m.a.deferred,
    // What the end screen's first line says of the reviews.
    review: reviewWords(!!m.a.deferred, reviewRowsOf(m), "short"),
    laws: lawPartsOf(m),
    ruledOut: m.dismissed.length,
    outOfScope: c.settled,
    notCounted: c.recorded + c.notShipped + c.forOperators + c.folded,
    noVerdict: sumOf(noAnswer, (u) => placesOfRecord(m, u)),
    partly: m.unread.length,
    carried: carriedCountOf(m.a),
    silent: rulesNothingOf(m).n,
    fixFirst,
    startsAt: note?.kind === "start" ? note.from : null,
    ...((cf) => (screenLater ? { carriedFrom: cf[0].replace(/^the review of /, ""), carriedMark: cf[1], later: screenLater } : { carriedFrom: cf[0].replace(/^the review of /, ""), carriedMark: cf[1] }))(carriedFromOf(m)),
    decided: { toFix: decidedIn(m, "to_fix"), counsel: decidedIn(m, "counsel") },
  };
  return { severities: { ...c.toFix }, toFix: c.toFix.high, first, counts: c, screen };
}

/**
 * What was not read, as the first screen lists it: the folders the walker refused (most files
 * first) and every other part with a count. One computation for the first screen and the record (design rf11 3.7 item 4).
 */
function notReadItemsOf(
  m: ReportModel,
  kinds: UncheckedKind[] = uncheckedKinds(m),
  parts: { notRead: string[]; silent: number } = notReadParts(m.a.findings as unknown as Findings),
): { folders: string[]; rest: Inert[] } {
  const nOf = (key: UncheckedKey): number => kinds.find((k) => k.key === key)?.n ?? 0;
  const folders = [
    ...new Set(
      arr(m.a.findings.excluded_by_walker)
        .map((x) => obj(x) ?? {})
        .filter((x) => WORDS.filesRefusedWhy[str(x.reason)] !== undefined)
        .sort((x, y) => (Number(y.files ?? 0) || 0) - (Number(x.files ?? 0) || 0))
        .map((x) => valueText(str(x.dir)))
        .filter(Boolean),
    ),
  ];
  const rest = [
    ...parts.notRead.map((x) => markdownText(x)),
    ...Object.keys(WORDS.notReadPart)
      .filter((key) => nOf(key as UncheckedKey) > 0)
      .flatMap((key) => kinds.find((k) => k.key === key)?.parts ?? [(WORDS.notReadPart[key] as (n: number) => Inert)(nOf(key as UncheckedKey))]),
  ];
  return { folders, rest };
}

/**
 * THE RECORD'S SUMMARY (delivery design rf11, 3.7 and section 4's `summary.json`): the counts,
 * what was not checked and the findings that stand, without a code line, from the same model and the same end summary
 * as the report's first screen and the end screen, so the record cannot show another number. The assembly writes it into
 * the evidence log (`summary`), whose digest this computer records (A4), and `record` reads it from there.
 */
export function recordSummaryOf(m: ReportModel, end: EndSummary, printedText: (t: string) => string, secondLooks: number): RecordSummary {
  if (!m.files) m.files = fileModelOf(m);
  const c = m.counts;
  const sc = end.screen as NonNullable<EndSummary["screen"]>;
  const f = m.a.findings;
  const stats = obj(f.stats) ?? {};
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const toFix = c.toFix.high + c.toFix.medium + c.toFix.low;
  // The same terms as the first screen's two group lines (`firstScreenLines`), so the totals cannot differ.
  const setAside = (m.a.suppressions ?? []).length;
  const notCounted = c.recorded + c.notShipped + c.forOperators + c.folded;
  const parts = notReadParts(f as unknown as Findings);
  const { folders, rest } = notReadItemsOf(m, uncheckedKinds(m), parts);
  const disposition = { to_fix: "to_fix", counsel: "to_clarify", answer: "to_answer" } as const;
  const items = m.files.listed
    .filter((l): l is Listed & { kind: keyof typeof disposition } => l.kind in disposition)
    .map((l) => {
      const it = l.items[0] as Item;
      return {
        f: fOf(l),
        short: l.short,
        finding_ids: l.items.map((x) => str(x.verdict.finding_id)),
        title: printedText(titleOfListed(m, l)),
        place: valueText(printedText(placeOf(m, it))),
        more_places: Math.max(0, placesOfListed(m, l) - 1),
        provisions: provisionsOf(m, it).map((p) => printedText(p.cite)),
        disposition: disposition[l.kind],
        level: m.sevOf(it),
        area: areaOf(ruleIdOf(it)),
      };
    });
  const commit = str(obj(f.repository)?.commit) || str(f.commit);
  return {
    project: printedText(m.project),
    completed_at: str(f.completed_at),
    code: { commit: commit || null, files_read: num(stats.files_scanned), rules: num(stats.rules_evaluated) },
    review: { once: !!m.a.deferred, second_looks: secondLooks },
    counts: {
      needs_action: toFix + c.counsel + c.waiting,
      to_fix: toFix,
      high: c.toFix.high,
      medium: c.toFix.medium,
      low: c.toFix.low,
      to_clarify: c.counsel,
      to_answer: c.waiting,
      questions: c.questions,
      taken_off: m.dismissed.length + c.settled + setAside + notCounted,
      ruled_out: m.dismissed.length,
      out_of_scope: c.settled,
      set_aside: setAside,
      not_counted: notCounted,
    },
    not_checked: {
      no_verdict: sc.noVerdict,
      partly: sc.partly,
      // B1b's one count of the rules that found nothing (`rulesNothingOf`), the number the first screen says.
      rules_nothing: rulesNothingOf(m).n,
      carried: sc.carried,
      folders: folders.map(printedText),
      not_read: rest.map(printedText),
    },
    laws: sc.laws.map(printedText),
    items,
  };
}

/**
 * The commit the scanned folder stands at when the assembly runs, its date, and whether
 * tracked files under the folder differ from it, through the git runner that lets nothing the folder holds choose a
 * program (child-program.ts), with `--no-optional-locks` so git writes nothing into the folder. Where git is not run or
 * there is no commit, `commit` is null and `commit_why` says why in words the record prints.
 */
function scanCommitOf(target: string): { commit: string | null; commit_date?: string; tree_changed?: boolean; commit_why?: string } {
  const g = gitRunnerOrWhy(target);
  if (!("run" in g)) return { commit: null, commit_why: g.why };
  const inside = g.run(["--no-optional-locks", "rev-parse", "--is-inside-work-tree"]);
  if (inside.status !== 0 || str(inside.stdout).trim() !== "true") return { commit: null, commit_why: "the folder is not in a git work tree" };
  const head = g.run(["--no-optional-locks", "rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  const id = head.status === 0 ? str(head.stdout).trim() : "";
  if (!/^[0-9a-f]{40,64}$/.test(id)) return { commit: null, commit_why: "the work tree has no commit" };
  /* The commit's date from `fuller`'s CommitDate row, strict ISO 8601. Not a `--format` with a committer placeholder: the
   * told-command lint reads a percent sign and `c` as a value put in (util.format's placeholder), and this argument is
   * not a command anyone is told. `--no-show-signature`: no signature check, so no other program runs. */
  const date = g.run(["--no-optional-locks", "log", "-1", "--no-show-signature", "--date=iso-strict", "--pretty=fuller", id]);
  const committed = date.status === 0 ? (/^CommitDate:[ \t]*(\S+)[ \t]*$/m.exec(str(date.stdout))?.[1] ?? "") : "";
  const status = g.run(["--no-optional-locks", "status", "--porcelain", "--untracked-files=no", "--", "."]);
  return {
    commit: id,
    ...(committed ? { commit_date: committed } : {}),
    ...(status.status === 0 ? { tree_changed: str(status.stdout).trim() !== "" } : {}),
  };
}

/* ------------------------------------------------------------------------------------------------
 * THE REPORT FILES (delivery design rf11, sections 3.1.1, 3.5 and 5): `report.md`, one
 * file per finding that stands under `findings/` (a group of one rule at one level is one file), `ruled-out.md` with one
 * file per rule under `ruled-out/`, `not-checked.md` and `laws.md`. Every builder writes logical lines; one pass
 * (`formMarkdown`) wraps them at 75 and escapes what would be read as HTML, so no line escapes the raw-view rules.
 * ---------------------------------------------------------------------------------------------- */

/** One entry `report.md` lists: findings to fix of one rule at one level (a group), or one finding. */
interface Listed {
  items: Item[];
  kind: "to_fix" | "counsel" | "answer" | "other";
  /** Its F-number; null for a finding not counted as a problem, which takes none. */
  n: number | null;
  short: string;
  /** Its file, relative to the report folder. */
  file: string;
}

/** What the report files are made from, beside the model: the entries, their short ids and their numbers. */
export interface FileModel {
  listed: Listed[];
  byId: Map<string, Listed>;
  shortOf: Map<string, string>;
  numbers: NumberResult;
  /** Each ruled-out verdict's rule file, as `ruledOutFiles` names it while writing it. */
  ruledOutOf?: Map<string, string>;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "4 Nov 2026" from an ISO date or time; "" where it does not read. */
export function dayWords(iso: string): Inert {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  /* Digits and a month's name only: `programText` is that claim. */
  return d ? md`${Number(d[3])} ${programText(MONTHS[Number(d[2]) - 1] ?? (d[2] as string))} ${programText(d[1] as string)}` : ours("");
}

/** A place's file and line from its `file:line` (or `file:line-line`) form. */
function placeParts(place: string): { file: string; line: number | null } {
  // `[\s\S]`: a file name may hold a line break, CR or U+2028 (FR5 item 4).
  const p = /^([\s\S]*):(\d+)(?:-\d+)?$/.exec(place);
  return p ? { file: p[1] as string, line: Number(p[2]) } : { file: place, line: null };
}

/** The way from a report file `depth` folders below the report folder to the project's root; null for absolute links. */
function upOf(a: ReportArgs, depth: number): string | null {
  const up = a.reportPlace === undefined ? "../../../" : a.reportPlace.up;
  return up === null ? null : `${"../".repeat(depth)}${up}`;
}
const rootOf = (a: ReportArgs): string => a.reportPlace?.root ?? str(a.findings.target);
const ruleIdOf = (it: Item): string => str(it.candidate?.rule_id) || str(it.verdict.rule_id);
const idOf = (it: Item): string => str(it.verdict.finding_id);

/** Fix order over every finding to fix: the high groups in Fix first's order, then medium and low, each group one rule. */
function toFixGroupsOf(m: ReportModel): Item[][] {
  const high = fixFirstEntries(m).flatMap((e) => ("group" in e ? [e.group] : []));
  const keyOfGroup = (g: Item[]): number[] => g.map((it) => (it.order ? orderKeyOf(it.order) : [0, 0, 0, 0])).sort(compareKeys)[0] ?? [0, 0, 0, 0];
  const rest = ["medium", "low"].flatMap((l) => {
    const its = m.shown.filter((it) => m.dispOf(it) === "to_fix" && (l === "low" ? m.sevOf(it) !== "high" && m.sevOf(it) !== "medium" : m.sevOf(it) === l));
    return [...groupBy(its, (it) => ruleIdOf(it)).values()].sort((x, y) => compareKeys(keyOfGroup(x), keyOfGroup(y)) || (ruleIdOf(x[0] as Item) < ruleIdOf(y[0] as Item) ? -1 : 1));
  });
  return [...high, ...rest];
}

/** The entries in the order `report.md` first lists them (design 3.5): to fix in fix order, to clarify, to answer; then the rest. */
function fileModelOf(m: ReportModel): FileModel {
  const a = m.a;
  const shortOf = shortIdsOf([...a.candidates.map((c) => str(c.finding_id)), ...m.shown.map(idOf), ...m.dismissed.map(idOf)].filter(Boolean));
  const groups: { items: Item[]; kind: Listed["kind"] }[] = toFixGroupsOf(m).map((g) => ({ items: g, kind: "to_fix" }));
  for (const it of m.shown.filter((x) => m.dispOf(x) === "counsel")) groups.push({ items: [it], kind: "counsel" });
  const rank = (q: QuestionSlot): number => (q.kind === "check_answer" ? 0 : 1);
  const slotted = [...(a.questions ?? [])].filter((q) => q.kind !== "order_moving").sort((x, y) => compareKeys(x.key, y.key) || rank(x) - rank(y));
  const waiting = m.shown.filter((x) => m.dispOf(x) === "question" || m.dispOf(x) === "check_answer");
  const inSlots = slotted.flatMap((q) => q.findingIds.map((id) => m.itemById.get(id)).filter((it): it is Item => !!it && waiting.includes(it)));
  for (const it of [...new Set([...inSlots, ...waiting])]) groups.push({ items: [it], kind: "answer" });
  for (const it of m.shown.filter((x) => !["to_fix", "counsel", "question", "check_answer"].includes(m.dispOf(x)))) groups.push({ items: [it], kind: "other" });
  const counted = groups.filter((g) => g.kind !== "other");
  const numbering = a.numbering ?? { list: null, carried: null, recordedMax: 0 };
  const numbers = assignNumbers({ groups: counted.map((g) => ({ ids: g.items.map(idOf), rule: ruleIdOf(g.items[0] as Item) })), scan: str(a.findings.scan_id), ...numbering });
  const listed: Listed[] = [];
  const byId = new Map<string, Listed>();
  let ci = 0;
  for (const g of groups) {
    const short = shortOf.get(idOf(g.items[0] as Item)) ?? hexOf(idOf(g.items[0] as Item));
    const l: Listed = { items: g.items, kind: g.kind, n: g.kind === "other" ? null : (numbers.numbers[ci++] ?? null), short, file: `findings/${short}.md` };
    listed.push(l);
    for (const it of g.items) byId.set(idOf(it), l);
  }
  return { listed, byId, shortOf, numbers };
}

/** A later run's note without its "to clarify, " lead (the list it stands in says so). */
const inertAfterClarify = (t: Inert): Inert => (t.startsWith("to clarify, ") ? inertSliceFrom(t, "to clarify, ".length) : t);
/** A count as `group` writes it, its digits and separators: program text. */
const groupOf = (n: number): Inert => programText(group(n));
const fOf = (l: Listed): Inert => (l.n === null ? markdownText(l.short) : programText(fNumber(l.n)));

/**
 * EACH FINDING THE REPORT LISTED, AS IT LISTED IT (the log's `listed[]`; design rf11 3.4,
 * "What an entry records" and "When a decision comes back"): one row per finding id, the places of a group under the
 * group's short id. The one function both sides read: `decide` records a decision against the row of the log it names,
 * and every later assembly makes the rows again and compares (decisions.ts `decisionViewOf`).
 */
const LIST_OF_KIND: Record<Listed["kind"], ListName> = { to_fix: "to_fix", counsel: "to_clarify", answer: "to_answer", other: "not_counted" };
function openPointOf(it: Item): OpenPoint {
  const s = it.order?.settles ?? "";
  return s.startsWith("question:") ? "question" : s.startsWith("law_unclear:") ? "law_unclear" : s.startsWith("code_not_readable:") ? "code_not_readable" : null;
}
function listedRowsOf(m: ReportModel): ListedRow[] {
  const fm = m.files as FileModel;
  const unread = new Set(m.unread);
  return fm.listed.flatMap((l) => {
    const title = titleOfListed(m, l);
    return l.items.map((it) => {
      const held = m.heldOf(it);
      // The kept places as the comparison reads them (place-key.ts): the held rows'
      // places, else every location, each by its file and line-text fingerprint, so a decided finding that gains a place
      // needs a new look; the naming place only where the finding has no location at all.
      const set = placeSetOfItem(held, it.candidate);
      const places = set.length > 0 ? set : [placeOf(m, it)].filter(Boolean);
      const digest = str(obj(obj(it.verdict.rests_on)?.rule)?.hash);
      return {
        finding_id: idOf(it),
        short_id: fm.shortOf.get(idOf(it)) ?? hexOf(idOf(it)),
        group: l.short,
        title,
        list: LIST_OF_KIND[l.kind],
        level: m.sevOf(it),
        places,
        provisions: provisionsOf(m, it).map((p) => ({ cite: p.cite, region: p.region })),
        rule_id: ruleIdOf(it),
        rule_digest: digest === "" ? null : digest,
        open_point: openPointOf(it),
        read_in_part: unread.has(it),
      };
    });
  });
}

/** Whether an entry leaves its list for "Decided by you": every place of it decided and applied. */
const decidedListed = (m: ReportModel, l: Listed): boolean => l.items.every((it) => decidedApplies(m.decisions, idOf(it)));
/** How many findings of an entry hold a decision that applies (findings, not places: two can share a place). */
const decidedPlaces = (m: ReportModel, l: Listed): number => l.items.filter((it) => decidedApplies(m.decisions, idOf(it))).length;
/** One decision in words: "counsel's answer, "<words>" · until 10 Nov 2027". */
function decisionWords(e: DecisionEntry): Inert {
  const kind = programText(DECISION_WORDS.kind[e.kind]);
  if (e.kind === "refused") return md`${kind}: ${proseOf(e.why ?? "")}`;
  if (e.kind === "withdrawn") return kind;
  return md`${kind}, ${e.reason !== null ? md`"${proseOf(e.reason)}"` : programText(DECISION_WORDS.noReason)}${e.until ? md` · until ${dayWords(e.until)}` : ours("")}`;
}
const listWordsOf = (l: Listed): Inert => (l.kind === "counsel" ? ours("to clarify") : ours("to fix"));

/** The card's decision line (mock M10c), or none where nothing is decided. */
function decisionCardLines(m: ReportModel, l: Listed): Inert[] {
  const v = m.decisions;
  if (!v) return [];
  const states = l.items.map((it) => v.stateOf.get(idOf(it))).filter((x): x is NonNullable<typeof x> => x !== undefined);
  if (states.length === 0) return [];
  const back = states.filter((x) => x.state !== "applied");
  const out: Inert[] = [];
  if (back.length > 0) {
    const e = (back[0] as (typeof back)[number]).entry;
    out.push(md`- **Your decision of ${dayWords(e.at)} needs a new look:** ${inertJoin([...new Set(back.flatMap((x) => x.changed))].map(markdownText), ours("; "))}`);
  }
  const applied = states.filter((x) => x.state === "applied");
  if (l.items.length > 1 && applied.length < l.items.length) {
    // Findings, not places: a decision is made per finding, and two findings can share one place.
    if (applied.length > 0) out.push(md`- ${groupOf(applied.length)} of ${groupOf(l.items.length)} findings decided by you; the others are not`);
  } else if (applied.length > 0) {
    const e = (applied[0] as (typeof applied)[number]).entry;
    out.push(md`- Your decision, ${dayWords(e.at)}: ${decisionWords(e)} · still counted in "${listWordsOf(l)}"`);
  }
  return out;
}

/** The finding file's "Your decisions" section: every entry, in order (design 3.4). */
function decisionHistoryLines(m: ReportModel, l: Listed): Inert[] {
  const v = m.decisions;
  if (!v || v.read === "none") return [WORDS.decisionsNone];
  if (v.read === "unreadable") return [WORDS.decisionsUnreadable(markdownText(v.why ?? ""))];
  const short = (it: Item): Inert => markdownText(m.files?.shortOf.get(idOf(it)) ?? hexOf(idOf(it)));
  const out: Inert[] = [];
  for (const it of l.items) {
    const h = v.historyOf.get(idOf(it)) ?? [];
    for (const e of h) out.push(md`- ${l.items.length > 1 ? md`Place ${short(it)}, ` : ours("")}${dayWords(e.at)}: ${decisionWords(e)}`);
    const st = v.stateOf.get(idOf(it));
    if (st && st.state !== "applied") out.push(md`- ${l.items.length > 1 ? md`Place ${short(it)}: ` : ours("")}it needs a new look: ${inertJoin(st.changed.map(markdownText), ours("; "))}`);
  }
  return out.length > 0 ? out : [WORDS.decisionsNone];
}

/** report.md's "Decided by you" (design 3.1, 3.4): each decided entry, still counted. */
function decidedSectionLines(m: ReportModel): Inert[] {
  const v = m.decisions;
  if (!v) return [];
  const out: Inert[] = [WORDS.decidedHeading, ours("")];
  if (v.read === "none") return [...out, WORDS.decidedNone, ours("")];
  if (v.read === "unreadable") return [...out, WORDS.decisionsUnreadable(markdownText(v.why ?? "")), ours("")];
  const fm = m.files as FileModel;
  const decided = fm.listed.filter((l) => (l.kind === "to_fix" || l.kind === "counsel") && decidedListed(m, l));
  const partly = fm.listed.filter((l) => !decidedListed(m, l) && decidedPlaces(m, l) > 0);
  const back = fm.listed.filter((l) => l.items.some((it) => { const x = v.stateOf.get(idOf(it)); return x !== undefined && x.state !== "applied"; }));
  if (decided.length === 0 && partly.length === 0 && back.length === 0) out.push(WORDS.decidedNoneApply);
  for (const l of decided) {
    const e = (v.stateOf.get(idOf(l.items[0] as Item)) as NonNullable<ReturnType<typeof v.stateOf.get>>).entry;
    out.push(md`- ${fOf(l)} · ${titleOfListed(m, l)} · [${markdownText(l.short)}](${linkTarget(l.file)})\\`, md`  ${dayWords(e.at)}: ${decisionWords(e)} · still counted in "${listWordsOf(l)}"`);
  }
  for (const l of partly) out.push(md`- ${fOf(l)} · ${titleOfListed(m, l)} · [${markdownText(l.short)}](${linkTarget(l.file)}): ${groupOf(decidedPlaces(m, l))} of ${groupOf(l.items.length)} findings decided by you; it stays in its list`);
  for (const l of back) out.push(md`- ${fOf(l)} · ${titleOfListed(m, l)} · [${markdownText(l.short)}](${linkTarget(l.file)}): your decision needs a new look; it is back in its list`);
  if (v.gone.length > 0) out.push(ours(""), WORDS.decidedGone(v.gone.length));
  out.push(ours(""));
  return out;
}

/** The findings of one list whose entry left it for "Decided by you", for the count rows ("2 decided by you"): a count of finding ids, as the rows count. */
const decidedIn = (m: ReportModel, kind: Listed["kind"]): number => sumOf((m.files?.listed ?? []).filter((l) => l.kind === kind && m.decisions !== undefined && decidedListed(m, l)), (l) => l.items.length);

/**
 * WHAT CHANGED SINCE THE EARLIER REVIEW, once per model (design rf13 3.2.1):
 * the log's `comparison` block read by later-run.ts, the review it names, and the findings of the two lists in fix
 * order: `up`, new or higher (to fix first, then to clarify), and `still`, to fix and not new or higher. Null on a run
 * that carried from no earlier review, where the first run's screens stand.
 */
interface Later {
  c: LaterComparison;
  s: Since;
  /** "the review of 4 Nov" */
  earlier: Inert;
  /** "4 Nov", for the since label; "" where the earlier log gave no date. */
  day: string;
  look: LaterLookup;
  /** The new-or-higher entries as the since row counts them, the person's decisions aside. */
  upAll: Listed[];
  /**
   * "New or higher" as listed (the end screen's lines, "Now to fix"; design 3.2.1,
   * 3.4): `upAll` without the entries decided by you, with the entries to fix or to clarify whose decision came back to the
   * list (it needs a new look, or its date passed), in fix order. Read at each use, so it holds the decisions however early
   * the comparison was first read.
   */
  readonly up: Listed[];
  /** How many entries of `upAll` left the list for "Decided by you". */
  readonly upDecided: number;
  noteOf: Map<Listed, Inert>;
  /** To fix and not new or higher, the person's decisions aside: the still-to-fix count. Without an entry back in "New or higher". */
  readonly stillAll: Listed[];
  /** Unchanged findings back for a new look (`backRowsOf`). */
  readonly back: number;
  /** `stillAll` as listed, for the one it names first: without the entries decided by you. */
  readonly still: Listed[];
}
const LATER = new WeakMap<ReportModel, Later | null>();
/** An entry to fix or to clarify whose decision came back to its list (design 3.4). */
const backListed = (m: ReportModel, l: Listed): boolean =>
  (l.kind === "to_fix" || l.kind === "counsel") && l.items.some((it) => ((st) => st !== undefined && st.state !== "applied")(m.decisions?.stateOf.get(idOf(it))));
/** The tag of an entry back in "New or higher" for its decision. */
function upNoteOf(m: ReportModel, lt: Later, l: Listed): Inert {
  const own = lt.noteOf.get(l);
  if (own !== undefined && !backListed(m, l)) return own;
  const st = l.items.map((it) => m.decisions?.stateOf.get(idOf(it))).find((x) => x !== undefined && x.state !== "applied");
  if (!st) return own ?? ours("");
  const back = md`your decision of ${dayWords(st.entry.at)} needs a new look${st.state === "expired" ? ours(": its date passed") : ours("")}`;
  return own ? md`${own}; ${back}` : back;
}
function laterOf(m: ReportModel): Later | null {
  if (LATER.has(m)) return LATER.get(m) ?? null;
  const c = laterComparisonOf(m.a.comparison ?? null);
  if (!m.files) m.files = fileModelOf(m);
  const fm = m.files;
  let out: Later | null = null;
  if (c !== null) {
    const s = sinceOf(c);
    const day = dayWords(c.earlierAt ?? "").replace(/ \d{4}$/, "");
    const earlier = day ? WORDS.reviewOfDay(markdownText(day)) : m.a.numbering?.carried?.label !== undefined ? markdownText(m.a.numbering.carried.label) : WORDS.reviewEarlier;
    const list = m.a.numbering?.list;
    const numberOf = (id: string): number | undefined => (list && list.ok ? list.byId.get(id)?.n : undefined) ?? m.a.numbering?.carried?.numbers.get(id) ?? fm.numbers.byId.get(id);
    const dismissed = new Set(m.dismissed.map(idOf));
    const look: LaterLookup = {
      listed: (id) => {
        const l = fm.byId.get(id);
        return l ? { f: fOf(l), title: titleOfListed(m, l), link: md`[${markdownText(l.short)}](${linkTarget(l.file)})` } : null;
      },
      earlier: (id, rule) => ((n) => ({ f: n === undefined ? null : programText(fNumber(n)), title: m.plainOf(rule) }))(numberOf(id)),
      describe: (id) => {
        const l = fm.byId.get(id);
        if (l) return md`${l.kind === "to_fix" ? ours("to fix") : l.kind === "counsel" ? ours("to clarify") : l.kind === "answer" ? ours("to answer") : ours("not counted")}, ${fOf(l)} · [${markdownText(l.short)}](${linkTarget(l.file)})`;
        return dismissed.has(id) ? WORDS.laterRuledOut : WORDS.laterNoVerdict;
      },
      area: (rule) => areaOf(rule),
      place: (id) => ((it) => (it ? code(placeOf(m, it)) : null))(fm.byId.get(id)?.items.find((x) => str(x.verdict.finding_id) === id)),
      // The year is said only where it is not this scan's year.
      day: (iso) => ((d, y) => (y && d.endsWith(` ${y}`) ? inertSlice(d, d.length - 5) : d))(dayWords(iso), /^(\d{4})-/.exec(str(m.a.findings.completed_at))?.[1] ?? ""),
      /* The person's decision about a finding of this scan or a gone one, read
       * when changes.md is written (after the decisions are read), for its marks (design 3.4). */
      decision: (id) => {
        const v = m.decisions;
        const st = v?.stateOf.get(id) ?? v?.gone.find((g) => g.entry.finding_id === id);
        return st ? { state: v?.stateOf.has(id) ? st.state : "gone", at: st.entry.at } : null;
      },
    };
    const noteOf = new Map<Listed, Inert>();
    for (const r of s.up) {
      const l = fm.byId.get(r.id);
      // A new finding where a gone one of the same rule sat in the same file names it.
      const g = r.kind === "new_place" ? goneWhereOf(c, r.id) : null;
      const where = g ? (look.earlier(g.id, g.rule).f ?? WORDS.goneFindingWords) : null;
      if (l && (l.kind === "to_fix" || l.kind === "counsel") && !noteOf.has(l)) noteOf.set(l, upNote(r, where));
    }
    const upAll = [...fm.listed.filter((l) => l.kind === "to_fix" && noteOf.has(l)), ...fm.listed.filter((l) => l.kind === "counsel" && noteOf.has(l))];
    const stillBase = fm.listed.filter((l) => l.kind === "to_fix" && !noteOf.has(l));
    // The lists with the person's decisions, read at each use (design 3.2.1, 3.4).
    const inUp = (l: Listed): boolean => (noteOf.has(l) && !decidedListed(m, l)) || backListed(m, l);
    out = {
      c,
      s,
      earlier,
      day,
      look,
      upAll,
      get up() {
        return [...fm.listed.filter((l) => l.kind === "to_fix" && inUp(l)), ...fm.listed.filter((l) => l.kind === "counsel" && inUp(l))];
      },
      get upDecided() {
        return upAll.filter((l) => decidedListed(m, l)).length;
      },
      noteOf,
      // One place, one count: an entry back in
      // "New or higher" is not also still to fix.
      get stillAll() {
        return stillBase.filter((l) => !backListed(m, l));
      },
      get still() {
        return this.stillAll.filter((l) => !decidedListed(m, l));
      },
      get back() {
        return backRowsOf(c, look).length;
      },
    };
  }
  LATER.set(m, out);
  return out;
}
/** (mock M9) report.md's since section: the three rows, before "Now to fix". */
function sinceSectionLines(lt: Later): Inert[] {
  const out: Inert[] = [WORDS.sinceHeading];
  if (!lt.c.compared) return [...out, WORDS.sinceNotCompared(lt.earlier, markdownText(lt.c.why || "its log holds no comparison basis"))];
  const s = lt.s;
  const upFix = lt.up.filter((l) => l.kind === "to_fix").length;
  const hd = s.highDown;
  const high = hd ? ((e) => md`was high: ${e.f ? md`${e.f} · ` : ours("")}${e.title} (${downWord(hd)})`)(lt.look.listed(hd.id) ?? lt.look.earlier(hd.earlier?.id ?? hd.id, hd.rule)) : ours("");
  out.push(WORDS.sinceLead(lt.earlier), WORDS.sinceUp(s.up.length + lt.back, upFix <= FIRST_SCREEN_FIXES && lt.up.length - upFix <= FIRST_SCREEN_CLARIFY && s.up.length === lt.upAll.length && lt.upDecided === 0, lt.back), WORDS.sinceDown(s.down.length, downParts(s), high), WORDS.sinceSame(s.unchanged - lt.back));
  return out;
}
/** The end screen's three item lines on a later run: to fix first, and the last kept for the first new to-clarify item. */
function upShownOf(lt: Later, room: number): Listed[] {
  const fix = lt.up.filter((l) => l.kind === "to_fix");
  const clarify = lt.up.filter((l) => l.kind === "counsel");
  const n = Math.min(3, room);
  if (clarify.length === 0 || n === 0) return fix.slice(0, n);
  return [...fix.slice(0, n - 1), clarify[0] as Listed].slice(0, n);
}
/* A place is one location, a file and a line (the parent's ruling of 2026-11-06): a
 * group whose findings hold the same line counts that line once. One count for
 * every view that says "places" of listed findings (the card's title, Fix first's and the end screen's "+N more places"):
 * a finding's held rows, else its candidate's locations, else its decisive place - never one per finding where the
 * finding has several locations. */
const placeKeysOf = (m: ReportModel, it: Item): string[] => {
  const held = m.heldOf(it);
  if (held.length > 0) return held.map((r) => `${r.file}:${r.line}`);
  const locs = arr(it.candidate?.locations).map(obj).filter((l): l is Obj => !!l && !!str(l.file));
  if (locs.length > 0) return locs.map((l) => `${str(l.file)}:${Number.isInteger(l.start_line) ? (l.start_line as number) : ""}`);
  return [placeOf(m, it) || `#${str(it.verdict.finding_id)}`];
};
/** A candidate's locations as place-key.ts reads them. */
const keyedLocationsOf = (c: Obj | undefined): KeyedLocation[] =>
  arr(c?.locations)
    .map(obj)
    .filter((l): l is Obj => !!l && !!str(l.file) && Number.isInteger(l.start_line))
    .map((l) => ({ file: str(l.file), start_line: l.start_line as number, line_key: l.line_key }));
/**
 * A listed finding's place set (place-key.ts `placeSetOf`): its held rows' places, each
 * the candidate's location at that file and line (a row with no such location by its file and line), else every location.
 */
const placeSetOfItem = (held: readonly ReportRow[], candidate: Obj | undefined): string[] => {
  const locs = keyedLocationsOf(candidate);
  if (held.length === 0) return placeSetOf(locs);
  const at = new Map(locs.map((l) => [`${l.file}:${l.start_line}`, l] as const));
  return placeSetOf(held.map((r) => at.get(`${r.file}:${r.line}`) ?? { file: r.file, start_line: r.line }));
};
const placesOfItems = (m: ReportModel, items: readonly Item[]): number => new Set(items.flatMap((it) => placeKeysOf(m, it))).size;
const placesOfListed = (m: ReportModel, l: Listed): number => placesOfItems(m, l.items);

/**
 * The facts at a group's decisive place that a rule's title template may name
 * (`rule-lines.ts` slots), from the rows `fixLines` says them from: `data`, the kinds of data (the review's block where it
 * established them, else the place rows' data words; none where it names no personal data or more than three kinds);
 * `recipient`, who receives them, only for a rule in `FLOW_RULES` (the hosts or vendor names the rows hold, else the
 * rule's own words for its recipient). An empty fact is missing, and the title is then the rule's general text.
 */
function titleFactsOf(m: ReportModel, group: readonly Item[]): Partial<Record<RuleLineSlot, string>> {
  const it0 = group[0] as Item;
  const rule = ruleIdOf(it0);
  const raised = group.find((it) => it.raise?.basis === "place" && it.raise.plaintext) ?? group.find((it) => it.raise);
  const r0 = raised?.raise;
  const inCall = (r: ReportRow): boolean => !!r0 && r.file === r0.file && r.line >= r0.line && r.line <= (r0.to_line ?? r0.line);
  const callRows = raised ? m.heldOf(raised).filter(inCall) : [];
  const held = callRows.length > 0 ? callRows : group.flatMap((it) => m.heldOf(it));
  const o = it0.order;
  const blockData = !!o && o.hasBlock && !o.heaviest.includes("data");
  const kinds = blockData && o
    ? o.data.filter((d) => d !== "no_personal_data").map((d) => WORDS.standingData[d] ?? d)
    : Object.keys(WORDS.dataWords)
        .filter((w) => new Set(r0 && r0.basis !== "standing" && r0.data.length > 0 ? r0.data : held.flatMap((r) => [...(r.data ?? [])])).has(w))
        .map((w) => WORDS.dataWords[w] as string);
  const data = kinds.length > 0 && kinds.length <= 3 ? listWords(kinds) : "";
  let recipient = "";
  if (FLOW_RULES.has(rule)) {
    const source = it0.candidate ? programItemSourceOf(it0.candidate as unknown as Candidate) : null;
    const to = held.map((r) => recipientOf(rule, source, r)).filter((x): x is string => !!x);
    recipient = to.length > 0 ? listWords([...new Set(to)].slice(0, 3)) : (OUTSIDE_OPERATOR_RULES.get(rule) ?? "");
  }
  return { data, recipient };
}

/**
 * THE ONE TITLE FUNCTION (design 5; rf11-a2-2026-11-06.md section 7): every
 * heading and list line that names a finding takes its title here. A finding to fix is titled by its rule's
 * `problem_line` (the template filled from the facts at its decisive place, else the general text; `rule-lines.ts`
 * `problemLineFor`); a finding to clarify, and any finding of a bundle with no `rule-lines.json`, by the rule's
 * `short_name`; a finding waiting on an answer by its question.
 */
function titleOfListed(m: ReportModel, l: Listed): Inert {
  const it = l.items[0] as Item;
  const rule = ruleIdOf(it);
  if (l.kind === "answer") {
    const q = it.order?.question ?? waitQuestionOf(it);
    return WORDS.cardWaits(q ? markdownText(questionTextOf(q).header) : m.plainOf(rule));
  }
  const lineOf = l.kind === "to_fix" ? problemLineFor(m.a.ruleLines?.[rule], titleFactsOf(m, l.items)) : null;
  // A rule's problem line is filled with facts of the code (a recipient's name): inert text as a whole.
  const base = lineOf !== null ? markdownText(lineOf) : m.plainOf(rule);
  const places = placesOfListed(m, l);
  return places > 1 ? md`${base} (${places} places)` : base;
}

/** The marks of an entry (legend: ⚑ placed as if the worst case held), and the places the AI did not open. */
function marksOf(l: Listed): Inert {
  const worst = l.items.some((it) => (it.order?.heaviest?.length ?? 0) > 0);
  const notOpened = sumOf(l.items, (it) => it.notChecked?.places ?? 0);
  return md`${worst ? ours(" ⚑") : ours("")}${notOpened > 0 ? md` · ${WORDS.cardNotOpened(notOpened)}` : ours("")}`;
}

/** One provision of a finding's rule, as the card and the file say it. */
type Provision = { cite: Inert; region: Inert; whose: Inert; url: Inert; checked: Inert };
/** A finding's provisions with their regions, those of regions answered No left out (design 4, "Laws and provisions"). */
function provisionsOf(m: ReportModel, it: Item): Provision[] {
  const c = it.candidate ?? {};
  const oi = it.orderInput;
  const declared = obj(m.a.findings.per_rule_applicability)?.declared_regions;
  const yes = Array.isArray(declared) ? new Set(declared.map(str)) : null;
  const out: Provision[] = [];
  const seen = new Set<string>();
  arr(c.legal_basis_refs).map(str).forEach((ref, n) => {
    if (!ref) return;
    const region = str(oi?.ruleBases?.[n]?.jurisdiction);
    // The basis's link and checked day (the rule's own, mock M3a).
    const url = readableProvisionUrl(str(oi?.ruleBases?.[n]?.url), citationOf(ref));
    const checked = dayWords(str(oi?.ruleBases?.[n]?.checked_at));
    if (oi && basisAnsweredOut(oi, region || undefined, ref)) return;
    const cite = citationOf(ref);
    if (seen.has(cite)) return;
    seen.add(cite);
    const whose = yes === null ? WORDS.cardRegionsUnanswered : region && yes.has(region) ? WORDS.cardYourAnswers : WORDS.cardNotAnswered;
    /* The rule's bases as the bundle states them (program text); the region a code from the same bundle. */
    out.push({ cite: programText(cite), region: programText(region), whose, url: programText(url), checked });
  });
  return out;
}

/**
 * "(EU: your answers · US: not answered)": each region of the provisions shown once, the regions with the same words
 * together ("EU, JP, US: regions not answered").
 */
function regionWordsOf(ps: readonly { region: Inert; whose: Inert }[]): Inert {
  const byWhose = new Map<Inert, Inert[]>();
  for (const p of ps) {
    const rs = byWhose.get(p.whose) ?? [];
    if (p.region && !rs.includes(p.region)) rs.push(p.region);
    byWhose.set(p.whose, rs);
  }
  const parts = [...byWhose].map(([whose, rs]) => (rs.length > 0 ? md`${inertJoin(rs, ours(", "))}: ${whose}` : whose));
  return parts.length > 0 ? md` (${inertJoin(parts, ours(" · "))})` : ours("");
}

/**
 * A provision's short form for the card (design 5: "at most two in short form"): the citation without the description
 * in parentheses at its end ("GDPR Art. 32 (security of processing; ...)" is "GDPR Art. 32"); a point such as "(2)(e)" is
 * kept. The file's "Provisions" section gives each in full.
 */
function shortCite(cite: string): string {
  const t = cite.trimEnd();
  /* Every parenthesised part holding a space is left to the
   * "Provisions" section, wherever it stands: the description at the end, and an act's official reference after its
   * name ("EU Cyber Resilience Act (Regulation (EU) 2024/2847), Annex I" is "EU Cyber Resilience Act, Annex I"). A part
   * with no space ("(2)(e)", "(EU)") is a point or a short name and is kept; so is a citation that opens with one. */
  let out = "";
  let depth = 0;
  let start = -1;
  for (let i = 0; i < t.length; i++) {
    const c = t[i] as string;
    if (c === "(" && depth++ === 0) start = i;
    else if (c === ")" && depth > 0 && --depth === 0) {
      const part = t.slice(start, i + 1);
      out += /\s/.test(part) && start > 0 ? "" : part;
      continue;
    }
    if (depth === 0) out += c;
  }
  if (depth > 0) return t; // unbalanced: as written
  const short = out.replace(/\s+([,;.])/g, "$1").replace(/\s{2,}/g, " ").trim();
  return short || t;
}

/**
 * The card's reason (design 5): what the code does at the decisive place (its `why`), then what happens to people (the
 * effect, at most 20 words). Where the place's `why` is missing or over its budget, the program's own fact line stands in
 * its place with the pointer to the reasoning below: the data, who receives it and the transport, or, where that is
 * longer than `FACT_LINE_MAX` (the card's 15 rows, design 6), the data and who receives it; with neither, the pointer.
 * A raise is said in the file's "About this finding" section, not on the card.
 */
const FACT_LINE_MAX = 200;
/* The reason's forms, longest first: the card takes the first that keeps it
 * within its rows (design 6: 15 rows at 75 columns), now that "What to do" is the rule's fix_line (up to 120 characters,
 * two rows): the full reason; the place's `why` and the pointer; the fact line and the pointer; the pointer alone. */
function reasonFormsOf(m: ReportModel, it: Item, f: { body: Inert; short: Inert; why: string } = { body: ours(""), short: ours(""), why: "" }): Inert[] {
  const first = reasonOf(m, it, f);
  const cut = (t: Inert): Inert => { const at = t.lastIndexOf(", ", FACT_LINE_MAX); return at > 40 ? md`${inertSlice(t, at)}.` : ours(""); };
  const factLine = f.body.length <= FACT_LINE_MAX ? f.body : f.short || cut(f.body);
  // A block item whose `runs` the review did not establish keeps release/rc's
  // card: a place reason over 170 characters is dropped, never cut (the h5a check, section 9 item 4), and a shorter one is
  // printed (FX4b item 2). The record's proposal asks which of the two rules the design means; elsewhere `cardWhyOf` cuts.
  const placeWhy = oneLine(f.why || str(m.heldOf(it)[0]?.why), 400);
  const rawWhy = it.order?.hasBlock && it.order.heaviest.includes("runs") && placeWhy.length > 170 ? "" : placeWhy;
  const why = cardWhyOf(rawWhy);
  const end = (t: Inert): Inert => (/[.!?…]$/.test(t) ? t : md`${t}.`);
  const forms = [first, why ? md`${end(why)} ${WORDS.cardReasonBelow}` : ours(""), factLine ? md`${end(factLine)} ${WORDS.cardReasonBelow}` : ours(""), f.short ? md`${end(f.short)} ${WORDS.cardReasonBelow}` : ours(""), WORDS.cardReasonBelow];
  return [...new Set(forms.filter(Boolean))];
}
/**
 * The place's `why` as the card gives it:
 * whole where it fits in 170 characters; else its first sentence where that fits; else cut at a word before 166 characters
 * and marked "…". A reason over the budget gave the card only the pointer to the reasoning below (21 of 24 to-fix cards in
 * one recorded run); the reasoning below is still whole.
 */
export function cardWhyOf(rawWhy: string): Inert {
  if (rawWhy.length <= 170) return markdownText(rawWhy);
  const first = /^(.{20,169}?[.!?])(?=\s)/.exec(rawWhy)?.[1];
  if (first) return markdownText(first);
  const at = rawWhy.lastIndexOf(" ", 166);
  return at > 40 ? markdownText(`${rawWhy.slice(0, at).replace(/[\s,;:]+$/, "")} …`) : ours("");
}
/** A finding card's rows at most (design 6): a single place's card, and a group's card before its "Places". */
const CARD_ROWS = 15;
const GROUP_CARD_ROWS = 13;
function reasonOf(m: ReportModel, it: Item, f: { body: Inert; short: Inert; why: string } = { body: ours(""), short: ours(""), why: "" }): Inert {
  /* A fact line that is only the transport (no data, no recipient) has no short
   * form: over the budget it is cut at its last clause that fits, so the card still says what the place establishes. */
  const cut = (t: Inert): Inert => { const at = t.lastIndexOf(", ", FACT_LINE_MAX); return at > 40 ? md`${inertSlice(t, at)}.` : ours(""); };
  const factLine = f.body.length <= FACT_LINE_MAX ? f.body : f.short || cut(f.body);
  // A block item whose `runs` the review did not establish keeps release/rc's
  // card: a place reason over 170 characters is dropped, never cut (the h5a check, section 9 item 4), and a shorter one is
  // printed (FX4b item 2). The record's proposal asks which of the two rules the design means; elsewhere `cardWhyOf` cuts.
  const placeWhy = oneLine(f.why || str(m.heldOf(it)[0]?.why), 400);
  const rawWhy = it.order?.hasBlock && it.order.heaviest.includes("runs") && placeWhy.length > 170 ? "" : placeWhy;
  const why = cardWhyOf(rawWhy);
  const effect = oneLine(str(obj(it.verdict.standing)?.effect), 400);
  const shortEffect = effect && effect.split(/\s+/).length <= 20 ? markdownText(effect) : ours("");
  const end = (s: Inert): Inert => (/[.!?…]$/.test(s) ? s : md`${s}.`);
  if (!why) return factLine ? md`${end(factLine)} ${WORDS.cardReasonBelow}` : WORDS.cardReasonBelow;
  // Design 5 "where either is missing": with no effect (or one over 20
  // words) the program's fact line says what happens to the data, as the old first screen's entry did.
  const text = inertJoin([why, shortEffect || factLine].filter(Boolean).map(end), ours(" "));
  if (text.length <= 360) return text;
  return shortEffect ? WORDS.cardReasonBelow : md`${end(why)} ${WORDS.cardReasonBelow}`;
}

/**
 * The card's action line: the rule's `fix_line` (from the bundle's `rule-lines.json`), or, for a bundle with none, its
 * guidance's first sentence (at most 120; `firstSentence` never stops at "Art."), or the pointer below.
 */
function actionOf(m: ReportModel, it: Item): Inert {
  const fix = str(m.a.ruleLines?.[ruleIdOf(it)]?.fix_line);
  if (fix) return proseOf(fix);
  const first = firstSentence(oneLine(str(it.candidate?.remediation_template).replace(/[#*_`>]/g, " "), 400));
  return first && first.length <= 120 ? proseOf(first) : WORDS.cardGuidanceBelow;
}

const CARD_QUOTE_MAX = 71;
const CARD_PROVISION_ROWS = 2;

/** The matched line at a place: the evidence quotation at that place, or the first one; "" where none. */
function quoteAt(it: Item, place: { file: string; line: number | null }): string {
  const ev = arr(it.verdict.evidence).map(obj).filter((e): e is Obj => !!e);
  const at = ev.find((e) => str(e.file) === place.file && Number(String(e.lines ?? "").split("-")[0]) === place.line) ?? ev[0];
  const q = oneLine(str(at?.quote), 400);
  /* 71 characters, not design 5's 76: with the two-space indent and
   * the code span's marks, 71 is the length that fits one 75-column row (a correction of design 5's figure). */
  return Array.from(q).length > CARD_QUOTE_MAX ? `${Array.from(q).slice(0, CARD_QUOTE_MAX - 1).join("")}…` : q;
}

/** A place as a link from a file `depth` folders below the report folder, with its matched line where one is given. */
function placeLink(m: ReportModel, place: string, depth: number): Inert {
  const p = placeParts(place);
  return md`[${markdownText(place)}](${codeTarget(upOf(m.a, depth), rootOf(m.a), p.file, p.line)})`;
}

/** The top of a finding's own file (design 5; mocks M3, M4, M5): logical lines, wrapped later. */
function cardLines(m: ReportModel, l: Listed): Inert[] {
  const it = l.items[0] as Item;
  const d = m.dispOf(it);
  const f = fOf(l);
  const day = dayWords(str(m.a.findings.completed_at));
  const out: Inert[] = [md`# ${l.n !== null ? md`${f} · ` : ours("")}${titleOfListed(m, l)}`, ours("")];
  const level = l.kind === "to_fix" ? md` · ${markdownText(m.sevOf(it))}` : ours("");
  const decided = m.decisions !== undefined && (l.kind === "to_fix" || l.kind === "counsel") && decidedListed(m, l) ? ours(" · decided by you") : ours("");
  out.push(md`- ${programText(WORDS.cardDisposition[d] ?? d)}${level}${decided}${marksOf(l)} · ${markdownText(l.short)}${day ? md` · ${WORDS.cardReviewOf(day)}` : ours("")} · [${WORDS.cardBack}](../${linkTarget(m.a.reportName ?? "report.md")})`);
  // The counsel mark stays on every to-clarify finding and every decided high finding (design 3.4): nothing removes it.
  if (l.kind === "counsel" || l.items.some((x) => x.label === "counsel") || (decided !== "" && l.items.some((x) => m.sevOf(x) === "high"))) out.push(md`- ${WORDS.cardCounsel}`);
  out.push(...decisionCardLines(m, l));
  /* The program's own facts at the decisive place (design 5: the place a raise
   * rests on, its data, its recipients, the transport it establishes), the words today's first screen printed. */
  const facts = fixLines(m, 1, l.items, new Map()).facts;
  if (l.items.length === 1) {
    const place = facts.place;
    const q = quoteAt(it, placeParts(place));
    const link = placeLink(m, place, 1);
    /* A link longer than the row's room stands on a row of its own,
     * and a "·" after it would then take a row alone: the matched line follows a hard break instead (mock M3's two
     * rows where the link fits beside "Place:"). */
    const head = md`- ${WORDS.cardPlace}: ${link}`;
    if (q && Array.from(`${head} ·`).length > REPORT_WIDTH) out.push(md`${head}\\`, md`  ${markdownCode(q)}`);
    else out.push(md`${head}${q ? md` · ${markdownCode(q)}` : ours("")}`);
    /* Where the Place is the line a raise rests on, the finding's own line
     * is said on the next row, a link to the code, so the person finds it in its own file (the old fix line's words). */
    const own = placeOf(m, it);
    if (own && own !== place) out.push(md`${out.pop() ?? ours("")}\\`, md`  ${WORDS.cardOwnLine(placeLink(m, own, 1))}`);
  }
  const ps = provisionsOf(m, it);
  out.push(provisionLine(ps));
  const reasons = reasonFormsOf(m, facts.decisive, facts);
  const reasonAt = out.length;
  out.push(md`- ${WORDS.cardReason}: ${reasons[0]}`);
  if (l.kind === "to_fix") out.push(md`- ${WORDS.cardWhatToDo}: ${actionOf(m, it)}`);
  else if (l.kind === "counsel") out.push(md`- ${WORDS.cardSettles}: ${settlesWordsOf(it)}`);
  else if (l.kind === "answer") out.push(md`- ${WORDS.cardSettles}: ${WORDS.cardAnswerSettles}`);
  else out.push(md`- ${WORDS.cardNotCounted}: ${inertCut(inertUnlisted(dispositionLinesOf(m, it)[0] ?? ours("")), 300) || programText(WORDS.cardDisposition[d] ?? d)}`);
  out.push(md`- ${WORDS.cardSay(f, markdownText(l.kind))}`);
  // The reason gives up rows, in the order of its forms, until the card fits.
  const cap = l.items.length > 1 ? GROUP_CARD_ROWS : CARD_ROWS;
  const rowsOfCard = (): number => formMarkdown([...out]).split("\n").reduce((n, x) => n + rowsAt(x), 0);
  for (const r of reasons.slice(1)) {
    if (rowsOfCard() <= cap) break;
    out[reasonAt] = md`- ${WORDS.cardReason}: ${r}`;
  }
  return out;
}

/**
 * The card's provision line: at most two provisions in short form (design 5), within two rows at the report's width. Where they do not fit, the card names those that fit and "and N
 * more", a link to the file's "Provisions" section, which keeps the full list.
 */
function provisionLine(ps: readonly Provision[]): Inert {
  const target = linkTarget(`#${anchorOfHeading(WORDS.provisionsHeading)}`);
  const lineOf = (k: number): Inert => {
    const shown = ps.slice(0, k).map((p) => programText(shortCite(p.cite)));
    const rest = ps.length - k;
    const body = shown.length > 0 ? inertJoin(shown, ours(" · ")) : ps.length > 0 ? ours("") : WORDS.cardNoProvision;
    const more = rest > 0 ? md`[${WORDS.cardMoreBelow(rest, shown.length > 0)}](${target})` : ours("");
    return md`- ${WORDS.cardProvision}: ${inertJoin([body, more].filter(Boolean), ours(" "))}${regionWordsOf(ps)}`;
  };
  const rowsOf = (line: Inert): number => formMarkdown([line]).split("\n").filter((l) => l !== "").reduce((n, l) => n + rowsAt(l), 0);
  for (let k = Math.min(2, ps.length); k > 0; k--) if (rowsOf(lineOf(k)) <= CARD_PROVISION_ROWS) return lineOf(k);
  return lineOf(0);
}

/** What settles a finding to clarify: the review's own statement (`standing.settles`), with the program's words for its kind. */
function settlesWordsOf(it: Item): Inert {
  const s = it.order?.settles ?? "";
  if (s.startsWith("law_unclear:")) return md`${proseOf(s.slice("law_unclear:".length))} ${WORDS.cardSettlesLaw}`;
  if (s.startsWith("code_not_readable:")) return WORDS.cardSettlesCode(markdownCode(s.slice("code_not_readable:".length)));
  return s ? proseOf(s.replace(/^[a-z_]+:/, "")) : WORDS.cardSettlesNone;
}

/**
 * One finding's file (design 3.1.1 "What the files hold"): the card, then every section always present, in order, with
 * "None" where empty. A group lists its places after the card, each place's reasoning under its own heading.
 * THE GENERATOR `explain` prints through (unit B2): `findingFileText(m, files, l)`.
 */
function findingFileLines(m: ReportModel, l: Listed): Inert[] {
  const out = cardLines(m, l);
  const group = l.items.length > 1;
  const partsOf = new Map(l.items.map((it) => [it, itemParts(m, it)] as const));
  const shortOf = (it: Item): Inert => markdownText(m.files?.shortOf.get(idOf(it)) ?? hexOf(idOf(it)));
  if (group) {
    out.push(ours(""), md`## ${WORDS.groupListHeading}`, ours(""));
    // Each entry's places by the title's own count (`placeKeysOf`), a place an
    // earlier entry holds counted there, so the entries add up to `placesOfListed` (the title's "(N places)").
    const counted = new Set<string>();
    l.items.forEach((it, i) => {
      const place = placeOf(m, it);
      const why = oneLine(str(m.heldOf(it)[0]?.why), 120);
      const own = [...new Set(placeKeysOf(m, it))];
      const fresh = own.filter((k) => !counted.has(k));
      for (const k of fresh) counted.add(k);
      const count = WORDS.groupEntryPlaces(fresh.length, own.length - fresh.length);
      out.push(md`${i + 1}. ${placeLink(m, place, 1)}\\`, md`   [${shortOf(it)}](${linkTarget(`#${anchorOfHeading(WORDS.groupMemberHeading(shortOf(it)))}`)}) · ${count}${why ? md` · ${proseOf(why)}` : ours("")}`);
    });
  }
  const section = (heading: Inert, pick: (p: ItemParts) => Inert[]): void => {
    out.push(ours(""), md`## ${heading}`, ours(""));
    const all = l.items.map((it) => ({ it, lines: pick(partsOf.get(it) as ItemParts) }));
    if (all.every((x) => x.lines.length === 0)) {
      out.push(WORDS.sectionNone);
      return;
    }
    for (const x of all) {
      if (group) out.push(heading === WORDS.reasoningHeading ? md`### ${WORDS.groupMemberHeading(shortOf(x.it))}` : md`${WORDS.groupMemberHeading(shortOf(x.it))}:`, ours(""));
      out.push(...(x.lines.length > 0 ? x.lines : [WORDS.sectionNone]), ours(""));
    }
    while (out[out.length - 1] === "") out.pop();
  };
  section(WORDS.reasoningHeading, (p) => p.reasoning);
  section(WORDS.evidenceHeading, (p) => p.evidence);
  section(WORDS.readHeading, (p) => p.read);
  const it0 = l.items[0] as Item;
  const ps = provisionsOf(m, it0);
  out.push(ours(""), md`## ${WORDS.provisionsHeading}`, ours(""));
  if (ps.length === 0) out.push(WORDS.sectionNone);
  for (const p of ps) out.push(md`- ${p.cite}${p.region ? md` (${p.region}: ${p.whose})` : md` (${p.whose})`}${WORDS.provisionSource(p.url, p.checked)}`);
  out.push(ours(""), WORDS.provisionsNoText); // its own paragraph, not a continuation of the last provision's item
  out.push(ours(""), md`## ${WORDS.guidanceHeading}`, ours(""));
  /* The rule's guidance as the scan copied it from the bundle the program ships (its Markdown meant): program text. */
  const guidance = str(it0.candidate?.remediation_template).trim();
  out.push(...(guidance ? inertLines(programText(guidance)) : [WORDS.sectionNone]));
  out.push(ours(""), md`## ${WORDS.decisionsHeading}`, ours(""), ...decisionHistoryLines(m, l));
  out.push(ours(""), md`## ${WORDS.deeperHeading}`, ours(""), WORDS.deeperNone(fOf(l)));
  out.push(ours(""), md`## ${WORDS.aboutHeading}`, ours(""));
  const nums = m.files?.numbers;
  const gi = m.files ? m.files.listed.filter((x) => x.kind !== "other").indexOf(l) : -1;
  const also = gi >= 0 ? nums?.alsoShownAs.get(gi) : undefined;
  if (also && also.length > 0) out.push(WORDS.alsoShownAs(also.map((n) => markdownText(fNumber(n)))));
  const was = gi >= 0 ? nums?.shownInCarried.get(gi) : undefined;
  if (was !== undefined && nums?.note?.kind === "differs") out.push(WORDS.shownInCarried(markdownText(fNumber(was)), markdownText(nums.note.label)));
  for (const it of l.items) {
    const p = partsOf.get(it) as ItemParts;
    out.push(...p.about);
    out.push(WORDS.aboutLine(markdownText(idOf(it)), markdownText(ruleIdOf(it)), markdownText(str(m.a.findings.scan_id))), ours(""));
  }
  while (out[out.length - 1] === "") out.pop();
  return out;
}

/** A finding file's text as written: its logical lines, with links to the report folder's files made relative to `findings/`. */
function findingFileText(m: ReportModel, l: Listed): Inert {
  const lines = findingFileLines(m, l).map((line) =>
    inertRelinked(line, ours("../"), ours("findings/")),
  );
  return formMarkdown(composedNet(m.a, lines));
}

/**
 * The raw-view form of a file (design 3.1.1, rules 1 and 3): every logical line wrapped at 75 (its list marker kept and its
 * continuation indented to the marker's width); headings, table rows, reference definitions, rules and fenced blocks left
 * as they are; and every `<` outside a code span that would open an HTML tag escaped, so no file holds HTML.
 */
export function formMarkdown(lines: readonly Inert[], width: number = REPORT_WIDTH): Inert {
  const out: string[] = [];
  let fenced = false;
  /* Every control character but the line break and the tab as an escape, in every
   * line of every file whatever wrote it (`controlsEscaped`): an ESC, CR, U+2028 or C1 control of a value cannot reach a
   * file. A line break of a value cannot be told from the file's own here: a value that may hold one goes through
   * `valueText` where its line is made (`code`, a place's link label, the end screen's place). */
  for (const raw of lines.flatMap((l) => l.split("\n")).map(controlsEscaped)) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced;
      out.push(raw);
      continue;
    }
    if (fenced || raw.trim() === "" || /^#{1,6}\s/.test(raw) || /^\s*\|/.test(raw) || /^\s{0,3}\[[^\]]+\]:\s/.test(raw) || /^(-{3,}|\*{3,})\s*$/.test(raw)) {
      out.push(raw.trimEnd());
      continue;
    }
    /* Code spans as CommonMark pairs them (`codeSpanParts`), and a backslash
     * escape taken whole, so that the `<` this escapes is every `<` markdown-it reads outside a code span (FR5 item 1). */
    const safe = codeSpanParts(raw)
      .map((part, i) => (i % 2 === 1 ? part : part.replace(/\\[\s\S]|<(?=[A-Za-z/!?])/g, (x) => (x === "<" ? "\\<" : x))))
      .join("");
    const mk = /^(\s*)((?:[-*+]|\d{1,9}[.)])\s+)?/.exec(safe) as RegExpExecArray;
    const lead = `${mk[1] ?? ""}${mk[2] ?? ""}`;
    out.push(...wrapProse(`${safe.slice(lead.length)}`, { width, first: lead, indent: " ".repeat(lead.length) }));
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  /* The form pass's one cast: every line it is given is `Inert`, and it only
   * escapes a `<` and a control character, and wraps; the class test allows a cast here and in the producers only. */
  return `${out.join("\n")}\n` as Inert;
}

/** `ruled-out.md` and one file per rule under `ruled-out/` (design 3.1.1; mock M6): every clean "not applicable" answer. */
function ruledOutFiles(m: ReportModel): Record<string, string> {
  const a = m.a;
  const files: Record<string, string> = {};
  const how = (it: Item): NotApplicableKey =>
    it.carriedFrom ? "carried" : it.label === "overturned" ? "overturned" : (it.placeRead?.summary.carried ?? 0) > 0 ? "placesCarried" : "read";
  const counts: Record<NotApplicableKey, number> = { read: 0, overturned: 0, placesCarried: 0, carried: 0, declared: 0 };
  for (const it of m.dismissed) counts[how(it)]++;
  const kinds = (Object.keys(WORDS.notApplicableKind) as NotApplicableKey[]).filter((k) => counts[k] > 0).map((k) => WORDS.notApplicableKind[k](counts[k]));
  // A run with the second check gives each high one a second look, and the page says so. Counted from the rows: a carried row keeps the look its
  // own run gave or had none, whatever this run's shape.
  const lookedRows = m.dismissed.filter((it) => it.lookOn === "not_applicable");
  const looked = lookedRows.length;
  const high = m.dismissed.filter((it) => it.lookOn === "not_applicable" || it.lookKind === true).length;
  const carriedLooked = lookedRows.filter((it) => !!it.carriedFrom).length;
  const carriedNone = a.deferred ? 0 : m.dismissed.filter((it) => it.lookOn !== "not_applicable" && it.lookKind === true && !!it.carriedFrom).length;
  const secondCheck = !a.deferred;
  const plainShape = carriedNone === 0 && (secondCheck ? carriedLooked === 0 : looked === 0);
  const intro = plainShape ? (looked > 0 ? WORDS.ruledOutIntroLooked : WORDS.ruledOutIntro) : programText(WORDS.ruledOutIntroRows(secondCheck, looked - carriedLooked, carriedLooked, carriedNone));
  const index: Inert[] = [WORDS.ruledOutTitle(m.dismissed.length, looked, high), ours(""), intro, ours("")];
  if (m.dismissed.length === 0) index.push(WORDS.dismissedNone, ours(""), WORDS.ruledOutNotHere);
  else index.push(WORDS.notApplicableIntro(m.dismissed.length, kinds), ours(""));
  const byRule = [...groupBy(m.dismissed, (it) => ruleIdOf(it) || WORDS.ruleNotInFindings).values()].sort(
    (x, y) => (SEVERITY_RANK[m.sevOf(x[0] as Item)] ?? 3) - (SEVERITY_RANK[m.sevOf(y[0] as Item)] ?? 3) || y.length - x.length || (ruleIdOf(x[0] as Item) < ruleIdOf(y[0] as Item) ? -1 : 1),
  );
  const taken = new Set<string>();
  for (const g of byRule) {
    const rule = ruleIdOf(g[0] as Item) || WORDS.ruleNotInFindings;
    const name = `ruled-out/${plainFileName(m.plainOf(rule), taken)}.md`;
    if (m.files) for (const it of g) (m.files.ruledOutOf ??= new Map()).set(idOf(it), name);
    index.push(md`- [${markdownText(labelOf(m.plainOf(rule)))}](${linkTarget(name)}) · ${markdownText(m.sevOf(g[0] as Item))} · ${groupOf(g.length)}`);
    const out: Inert[] = [md`# ${WORDS.ruledOutRuleTitle(m.plainOf(rule), g.length)}`, ours(""), md`- [${WORDS.cardBack}](../${linkTarget(m.a.reportName ?? "report.md")}) · [${WORDS.ruledOutIndex}](../ruled-out.md)`, md`- ${inertUnlisted(WORDS.ruleNamed(code(rule), programText(m.titleOf.get(rule) ?? "")))}`, ours("")];
    for (const it of g) {
      const short = markdownText(m.files?.shortOf.get(idOf(it)) ?? hexOf(idOf(it)));
      const reason = oneLine(str(obj(it.verdict.refutation)?.reasoning) || str(it.verdict.reasoning), 400);
      const first = firstSentence(reason).slice(0, 120);
      out.push(md`- ${placeLink(m, placeOf(m, it), 1)}\\`, md`  [${short}](${linkTarget(`#${anchorOfHeading(`Verdict ${short}`)}`)})${first ? md` · ${proseOf(first)}` : ours("")}`);
    }
    for (const it of g) {
      const short = markdownText(m.files?.shortOf.get(idOf(it)) ?? hexOf(idOf(it)));
      out.push(ours(""), md`### Verdict ${short}`, ours(""), ...dismissedLinesOf(m, it), ...placeLinesOfAnswer(it, vendorSoftwareOf(m.a.profile ?? null)));
      if (it.readAgain) out.push(md`  ${WORDS.readAgain(it.readAgain.checked, it.readAgain.settled, it.readAgain.previous, earlierRun(a, it.readAgain.scan_id))}`);
    }
    files[name] = formMarkdown(composedNet(a, out.map((line) => inertRelinked(line, ours("../")))));
  }
  index.push(ours(""), ours("---"), ours(""), md`*${WORDS.disclaimer}*`);
  files["ruled-out.md"] = formMarkdown(composedNet(a, index));
  return files;
}

/** One finding's lines, by the section of its file they belong to (design 3.1.1): what was `itemLines`, kept line for line. */
interface ItemParts {
  reasoning: Inert[];
  evidence: Inert[];
  read: Inert[];
  about: Inert[];
}
function itemParts(m: ReportModel, it: Item): ItemParts {
  const { a } = m;
  const p: ItemParts = { reasoning: [], evidence: [], read: [], about: [] };
  const summaryList = (k: string) => arr(a.summary[k]).map(str);
  const marks = (prefix: string) => ({
    elided: summaryList("elided_quotes").some((x) => x.startsWith(prefix)),
    short: summaryList("short_quotes").some((x) => x.startsWith(prefix)),
    redacted: summaryList("redacted_quotes").some((x) => x.startsWith(prefix)),
  });
  const c = it.candidate ?? {};
  // The label is the disposition's.
  const d = m.dispOf(it);
  const label =
    d === "counsel"
      ? WORDS.labelCounsel
      : d !== "to_fix"
        ? (WORDS.dispositionLabel[d] ?? WORDS.labelCandidate)
        : it.label === "not_yet_refuted"
          ? WORDS.labelNotYetRefuted
          : it.label === "no_second_check"
            ? WORDS.labelNoSecondCheck
            : WORDS.labelCandidate;
  const shownLevel = it.foldLevel ? WORDS.severityBoth(markdownText(it.foldLevel), markdownText(str(c.severity))) : it.raise ? WORDS.severityBoth(markdownText(it.raise.severity), markdownText(it.raise.rule_severity)) : str(c.severity);
  p.about.push(WORDS.itemMeta(label, code(idOf(it)), markdownText(shownLevel), markdownText(str(it.verdict.confidence))));
  if (it.raise) p.about.push(WORDS.severityRaised(markdownText(it.raise.severity), markdownProse(it.raise.because)));
  if (it.raisedAlso) p.about.push(WORDS.severityRaisedAlso(markdownText(it.raisedAlso.severity), markdownProse(it.raisedAlso.because)));
  // The review's reasoning in full first (today's report printed none for a finding that stands). Not beside a record the
  // quotation check invalidated: its reasoning rests on lines the check could not find.
  if (str(it.verdict.reasoning) && it.verdict.quote_check_outcome !== "invalidated") p.reasoning.push(WORDS.reviewSaid(said(str(it.verdict.reasoning), 4000)));
  /* A finding with no block: the review's reason at its place, in full
   * and said as the review's (the old Fix-first item printed it cut at 170; the card's "reasoning is below" points here).
   * A block's finding takes the block's words instead (fix-h5a-order-2026-10-28.md, section 9, item 4). */
  const placeWhy = it.order?.hasBlock ? "" : oneLine(str(m.heldOf(it)[0]?.why), 4000);
  if (placeWhy && it.verdict.quote_check_outcome !== "invalidated") p.reasoning.push(WORDS.reviewSaidOfPlaceFull(proseOf(placeWhy)));
  /* What the review's block established, what settles a finding that
   * needs judgement, what was not established, and why an item of group 1-3 is not counted as to fix. */
  const o = it.order;
  if (o) {
    const answers = orderAnswersOf(a.profile ?? null);
    if (o.settles?.startsWith("law_unclear:")) p.reasoning.push(md`- ${WORDS.counselLaw(markdownText(o.settles.slice("law_unclear:".length)), placedWords(d))}`);
    else if (o.settles?.startsWith("code_not_readable:")) p.reasoning.push(md`- ${WORDS.counselCode(code(o.settles.slice("code_not_readable:".length)), placedWords(d))}`);
    if (o.question) p.reasoning.push(md`-${WORDS.waitsOn(markdownText(questionTextOf(o.question).header))}`);
    if (o.hasBlock) {
      const aside = setAsideOf(it.verdict, o);
      // A part set aside is printed as not established,
      // as an absent part is: "In the product: not used (...)" read as "not used in the product" and could make a person drop a
      // real finding. Why it was set aside is said in the bullet after (`notEstablishedWords`).
      const or = (words: Inert, part: string): Inert => words || (aside.has(part) ? ours(WORDS.partSetAside) : ours(""));
      const effect = said(str(obj(it.verdict.standing)?.effect), 400) || (aside.has("effect") ? WORDS.effectNotUsed(aside.get("effect") ?? ours("")) : ours(""));
      const ships = o.heaviest.includes("ships") ? ours("") : (WORDS.shipsPhrase[o.ships] ?? markdownText(o.ships));
      p.reasoning.push(WORDS.whyItMatters(effect, or(standingDataWords(o), "data"), or(standingPeopleWords(o, answers), "people"), or(standingRunsWords(o), "runs"), or(ships, "ships"), or(lawWordsOf(o, scanDayOf(m)), "duty")));
    }
    const ne = notEstablishedWords(o, it.verdict);
    if (ne) p.reasoning.push(md`- ${ne}`);
    if (o.hasBlock && (o.ships === "maker_site" || o.ships === "documented_example" || (arr(c.declared_inapplicable_preconditions).length > 0 && d !== "check_answer"))) p.reasoning.push(md`- ${standingWhyOf(m, it)}`);
  }
  p.reasoning.push(...dispositionLinesOf(m, it));
  p.read.push(...secondLookLinesOf(m, it));
  p.reasoning.push(...(it.whyLines ?? []));
  p.evidence.push(...evidenceLines(it.verdict, it.adjSource ? marks(`${it.adjSource.source}[${it.adjSource.index}]`) : null, c, it.placeRead?.itemName));
  if (it.verdict.quote_check_outcome === "no_evidence") p.evidence.push(WORDS.unchecked(WORDS.uncheckedThisRecord));
  // Build unit F4: a candidate read place by place says how every place was read, in place of the kinds' reading line.
  const reading = it.placeRead ? null : readingLine(c, obj(it.verdict.reading));
  if (reading) p.read.push(reading);
  if (it.placeRead) p.read.push(...placeLines(it.placeRead, vendorSoftwareOf(m.a.profile ?? null)));
  if (it.notChecked) p.read.push(...notCheckedLines(it.notChecked));
  if (it.readAgain) p.read.push(WORDS.readAgain(it.readAgain.checked, it.readAgain.settled, it.readAgain.previous, earlierRun(a, it.readAgain.scan_id)));
  for (const expr of arr(c.declared_inapplicable_preconditions).map(str)) p.reasoning.push(WORDS.answerDisagrees(code(expr)));
  const ref = obj(it.verdict.refutation);
  if (ref && it.verdict.quote_check_outcome === "invalidated") p.read.push(WORDS.secondReviewOfInvalidated(markdownText(str(ref.outcome))));
  else if (ref && str(ref.outcome) === "upheld" && it.label === "candidate") p.read.push(WORDS.upheld);
  if (ref && ref.quote_check_outcome === "no_evidence") p.read.push(WORDS.unchecked(WORDS.uncheckedSecondReview));
  if (it.refSource) {
    const mk = marks(`${it.refSource.source}[${it.refSource.index}]`);
    if (mk.elided) p.evidence.push(WORDS.elided);
    if (mk.short) p.evidence.push(WORDS.short);
    if (mk.redacted) p.evidence.push(WORDS.redacted);
  }
  if (it.carriedFrom) p.read.push(WORDS.carried(earlierRun(a, it.carriedFrom)));
  p.read.push(...restsOnReadLines(obj(it.verdict.rests_on)));
  return p;
}

/**
 * (mock M3a; M7's counted "How it was read") The files the verdict rests on
 * and the searches it ran, as the verdict's `rests_on` holds them (the files and searches a later run compares): each list
 * with its count. None where the verdict holds no `rests_on` (a place read place by place records its own).
 */
function restsOnReadLines(ro: Obj | undefined): Inert[] {
  if (!ro) return [];
  const files = [...new Set(arr(ro.files).map(obj).filter((f): f is Obj => !!f && f.missing !== true).map((f) => str(f.path)).filter(Boolean))];
  const searches = [...new Set(arr(ro.searches).map(obj).filter((x): x is Obj => !!x).map((x) => str(x.pattern)).filter(Boolean))];
  const list = (xs: string[]): Inert => (xs.length === 0 ? ours(".") : md`: ${inertJoin(xs.map(markdownCode), ours(" · "))}`);
  return [md`- ${WORDS.filesRead(files.length)}${list(files)}`, md`- ${WORDS.searchesRun(searches.length)}${list(searches)}`];
}

/** One row as `reviewWords` counts it. */
export interface ReviewRow {
  toFix: boolean;
  refuted: boolean;
  carried: boolean;
}
/** The rows of a report as `reviewWords` counts them: each finding that stands, with its own refutation and carry. */
function reviewRowsOf(m: ReportModel): ReviewRow[] {
  return m.shown.map((it) => ({ toFix: m.dispOf(it) === "to_fix", refuted: !!obj(it.verdict.refutation), carried: !!it.carriedFrom }));
}
/**
 * HOW MANY REVIEWS THE FINDINGS TO FIX HAD, FROM THE
 * ROWS, never from this run's shape alone: a finding to fix with a refutation was reviewed twice, one without (a finding
 * carried from an earlier run with no second review among them) once. With no finding to fix, or where every row is what
 * the shape says, the shape's words, as before. One computation for `report.md`'s Laws item ("long"), the end screen's
 * first line ("short") and `record.html`'s How line (record.ts, from the log's rows). Until 2026-11-12 the three read the
 * shape alone, so a "+ second check" run that carried a finding never refuted said "findings to fix reviewed twice".
 */
export function reviewWords(once: boolean, rows: readonly ReviewRow[], form: "long" | "short"): string {
  const fix = rows.filter((r) => r.toFix);
  const toFix = fix.length;
  const twice = fix.filter((r) => r.refuted).length;
  const carried = fix.filter((r) => !r.refuted && r.carried).length === toFix - twice;
  const long = form === "long";
  if (toFix === 0 || (once && twice === 0)) return once ? (long ? "each place reviewed once" : "each place once") : long ? "findings to fix reviewed twice" : "findings to fix twice";
  if (twice === toFix) return long ? "findings to fix reviewed twice" : "findings to fix twice";
  if (twice === 0) return long ? `findings to fix reviewed once${carried ? " (carried from an earlier run)" : ""}` : `findings to fix once${carried ? " (carried)" : ""}`;
  return long
    ? `${group(twice)} of ${group(toFix)} findings to fix reviewed twice, ${group(toFix - twice)} ${carried ? "carried from an earlier run and " : ""}reviewed once`
    : `${group(twice)} of ${group(toFix)} to fix twice, ${group(toFix - twice)} once`;
}

/**
 * `report.md`'s first screen (design 3.1 "Report first screen"; mock M2): the title, the two count groups and the laws
 * line, Not checked (places without a verdict first), Fix first (up to five entries within ten rows), To clarify (up to
 * three within eight rows) and the legend. The code places are reference links whose definitions close the file (`refs`).
 */
function firstScreenLines(m: ReportModel, refs: Inert[]): Inert[] {
  const { a } = m;
  const f = a.findings;
  const fm = m.files as FileModel;
  const day = dayWords(str(f.completed_at));
  const out: Inert[] = [WORDS.firstTitle(markdownText(m.project), day), ours("")];
  const hc = m.counts;
  const toFix = hc.toFix.high + hc.toFix.medium + hc.toFix.low;
  out.push(md`- ${WORDS.firstNeeds(toFix + hc.counsel + hc.waiting, toFix, hc.toFix, hc.counsel, hc.waiting, hc.questions, decidedIn(m, "to_fix"), decidedIn(m, "counsel"))}`);
  const notCounted = hc.recorded + hc.notShipped + hc.forOperators + hc.folded;
  // The group holds every row the end screen prints under it, the set-aside ones included (design 6: "Taken off the list"
  // is ruled out, out of scope, set aside and not counted), so its total is the sum of its rows on both screens.
  const setAside = (a.suppressions ?? []).length;
  const scopeBy = answersUsedOf(m.a.declarationPlan ?? null)?.whose === "team" ? WORDS.scopeByTeam : undefined;
  out.push(md`- ${WORDS.firstTaken(m.dismissed.length + hc.settled + setAside + notCounted, m.dismissed.length, hc.settled, notCounted, setAside, scopeBy)}`);
  const lawParts = lawPartsOf(m);
  out.push(md`- ${WORDS.firstLaws(lawParts, programText(reviewWords(a.deferred, reviewRowsOf(m), "long")))}`);
  /* Not checked: always, a zero said, places without a verdict first: one line per `ScreenLine`, each
   * the phrases of the kinds counted on it, from the list `not-checked.md` is made from. */
  const noAnswer = [...a.unadjudicated, ...(a.suppressions ?? [])];
  const kinds = uncheckedKinds(m);
  /* M2's form (design 3.1 item 5, at most 6 items): the counts the end screen prints (`endSummaryOf`), rules that found
   * nothing with a link to their section, what was not read with up to three folders by name, the policy, and every other
   * kind with a count on one "Also not checked" line. The questions stay in `not-checked.md` only (design 3.1 item 5, rf10). */
  // A decided entry leaves Fix first and the to-clarify list for "Decided by you" (design 3.4).
  const fixes = fm.listed.filter((l) => l.kind === "to_fix" && !decidedListed(m, l));
  const printed = a.printed ?? ((t: string) => t);
  /* (design 3.2.1; mock M9) On a later run that compared, "Now to fix" takes
   * Fix first's place and holds only the findings to fix that are new or higher, each with what changed; the others are
   * named by the still-to-fix lines. Its rows give up what the since section and those lines take (45 rows in all). */
  const later = laterOf(m);
  const lt = later && later.c.compared ? later : null;
  const listedFix = lt ? lt.up.filter((l) => l.kind === "to_fix") : fixes;
  // Fix first's entries, two logical lines each, their code place numbered after the references already taken.
  const fixEntries = listedFix.slice(0, FIRST_SCREEN_FIXES).map((l, i) => {
    const it = l.items[0] as Item;
    const place = placeOf(m, it);
    const p = placeParts(place);
    const more = placesOfListed(m, l) > 1 ? md` ${WORDS.morePlaces(placesOfListed(m, l) - 1)}` : ours("");
    return {
      target: codeTarget(upOf(m.a, 0), rootOf(m.a), p.file, p.line),
      lines: [md`- ${fOf(l)} · ${titleOfListed(m, l)}${lt ? md` · ${upNoteOf(m, lt, l)}` : ours("")}\\`, md`  ${markdownText(m.sevOf(it))}${marksOf(l)} · [${markdownText(l.short)}](${linkTarget(l.file)}) · [${markdownText(place)}][${refs.length + i + 1}]${more}`],
    };
  });
  const fixShown = entriesWithin(fixEntries.map((e) => e.lines), lt ? FIRST_SCREEN_FIX_ROWS - LATER_FIRST_ROWS : FIRST_SCREEN_FIX_ROWS, printed);
  // The same counts and names the end screen prints (`notReadParts`), so the two cannot disagree.
  const parts = notReadParts(f as unknown as Findings);
  const rulesN = rulesNothingOf(m).n;
  const rulesRef = rulesN > 0 ? refs.length + fixShown + 1 : null;
  // One computation of what was not read, for this screen and the record (`recordSummaryOf`).
  const { folders, rest } = notReadItemsOf(m, kinds, parts);
  const notRead = [...folders.slice(0, 3).map((x) => markdownCode(x)), ...(folders.length > 3 ? [WORDS.notReadMoreFolders(folders.length - 3)] : []), ...rest];
  const onOtherItems = new Set<UncheckedKey>(["places-not-opened", "gap", "absent", "not-checked-rules", "questions"]);
  const also = kinds.filter((k) => KIND_LINE[k.key] !== "noAnswer" && KIND_LINE[k.key] !== "notRead" && !onOtherItems.has(k.key) && k.screen !== "").map((k) => k.screen);
  if (out[out.length - 1] !== "") out.push(ours("")); // M2: a blank line before each heading of the first screen
  out.push(WORDS.uncheckedHeading, md`- ${WORDS.notCheckedFirst(sumOf(noAnswer, (u) => placesOfRecord(m, u)), m.unread.length)}`);
  const carriedN = carriedCountOf(m.a);
  if (carriedN > 0) out.push(md`- ${WORDS.carriedItem(carriedN, ...carriedFromOf(m))}`);
  out.push(md`- ${WORDS.rulesNothing(rulesN, rulesRef)}`, md`- ${WORDS.notReadLine(notRead)}`, md`- ${WORDS.policyNotCompared}`);
  if (also.length > 0) out.push(WORDS.uncheckedLine(WORDS.uncheckedLead.also, also));
  out.push(ours(""));
  if (later) out.push(...sinceSectionLines(later), ours(""));
  // Fix first: up to five entries of what is to fix, in fix order, within M2's ten rows (FIRST_SCREEN_FIX_ROWS).
  out.push(lt ? WORDS.nowHeading : WORDS.fixHeading);
  // A first run (or one that compared nothing) whose findings to fix are all decided.
  if (listedFix.length === 0)
    out.push(
      lt
        ? lt.upAll.some((l) => l.kind === "to_fix") ? WORDS.nowAllDecided : WORDS.nowNone
        : fm.listed.some((l) => l.kind === "to_fix" && decidedListed(m, l)) ? WORDS.fixAllDecided : WORDS.fixNone,
    );
  for (const e of fixEntries.slice(0, fixShown)) {
    refs.push(e.target);
    out.push(...e.lines);
  }
  if (listedFix.length > fixShown) out.push(ours(""), lt ? WORDS.nowRest(listedFix.length - fixShown) : WORDS.fixRest(fixes.length - fixShown));
  // Counted as before, decided entries included; the first named is one not decided.
  if (lt && lt.stillAll.length > 0) {
    const first = lt.still[0];
    const high = lt.stillAll.filter((l) => m.sevOf(l.items[0] as Item) === "high").length;
    out.push(ours(""), first ? WORDS.stillToFix(lt.stillAll.length, high, md`${fOf(first)} · ${titleOfListed(m, first)} · [${markdownText(first.short)}](${linkTarget(first.file)})`) : WORDS.stillAllDecided(lt.stillAll.length, high));
  }
  out.push(ours(""));
  // The Not checked block's "[each][n]" (numbered after the code places, as in M2) targets its section of not-checked.md.
  if (rulesRef !== null) refs.push(linkTarget(`not-checked.md#${anchorOfHeading(WORDS.rulesNothingHeading.replace(/^#+ /, ""))}`));
  const clarify = fm.listed.filter((l) => l.kind === "counsel" && !decidedListed(m, l));
  if (clarify.length > 0) {
    out.push(WORDS.clarifyHeading);
    /* (design 3.2.1; mock M9) On a later run that compared, the section lists
     * the new or moved-in points (at most three, each with what changed), so a new point for counsel is never only a +1,
     * and one line counts the rest: the new ones not listed, and those open as in the earlier review. */
    const fresh = lt ? clarify.filter((l) => lt.noteOf.has(l)) : clarify;
    const items = fresh.slice(0, FIRST_SCREEN_CLARIFY).map((l) => [md`- ${fOf(l)} · ${titleOfListed(m, l)}${lt ? md` · ${inertAfterClarify(lt.noteOf.get(l) ?? ours(""))}` : ours("")} · [${markdownText(l.short)}](${linkTarget(l.file)})\\`, md`  ${WORDS.openPoint(settlesWordsOf(l.items[0] as Item))}`]);
    const shown = entriesWithin(items, lt ? FIRST_SCREEN_CLARIFY_ROWS - 1 : FIRST_SCREEN_CLARIFY_ROWS, printed);
    for (const lines of items.slice(0, shown)) out.push(...lines);
    if (lt) {
      const open = clarify.length - fresh.length;
      if (fresh.length > shown || open > 0) out.push(WORDS.clarifyLaterRest(fresh.length - shown, open, shown > 0, lt.day ? md`as on ${markdownText(lt.day)}` : md`as in ${lt.earlier}`));
    } else if (clarify.length > shown) out.push(ours(""), WORDS.clarifyRest(clarify.length - shown));
    out.push(ours(""));
  }
  const worst = fm.listed.some((l) => l.items.some((it) => (it.order?.heaviest?.length ?? 0) > 0));
  out.push(md`${WORDS.legendVsCode}${worst ? ours("\\") : ours("")}`);
  if (worst) out.push(WORDS.legendWorst);
  return out;
}

/** The laws line's parts: each law with its verdict and open questions, and the regions where none was answered. */
function lawPartsOf(m: ReportModel): Inert[] {
  const f = m.a.findings;
  const app = arr(f.applicability).map(obj).filter((x): x is Obj => !!x);
  const laws = [...groupBy(app, (x) => str(x.law)).values()].map((xs) =>
    WORDS.lawLine(markdownText(str(xs[0]?.law).replace(/^Regulation \(EU\) \d+\/\d+ \((.+)\)$/, "$1")), markdownText(str(xs[0]?.verdict).replace(/-/g, " ")), new Set(xs.flatMap((x) => decidingOpenOf(x))).size),
  );
  const pra = obj(f.per_rule_applicability);
  const regions = pra ? pra.declared_regions : undefined;
  const whose = whoseAnswersOf(m, "short");
  return [...(laws.length > 0 ? laws : [WORDS.lawsNone]), ...(whose ? [whose] : []), ...(!pra || regions === null || regions === undefined ? [WORDS.lawsRegions] : [])];
}
/**
 * (design 3.3) WHOSE ANSWERS THE SCAN USED, read from its own plan's (and log's)
 * `answers_used` (rf11-a3), never from the answer files as they stand now. Null where the plan records none, or where the
 * scan had no saved answers to use (a first scan: the regions line says so).
 */
function whoseAnswersOf(m: ReportModel, form: "short" | "long"): Inert | null {
  const u = answersUsedOf(m.a.declarationPlan ?? null);
  if (!u) return null;
  const day = (iso: string | undefined): string => dayWords(iso ?? "").replace(/ \d{4}$/, "");
  if (u.whose === "own") return form === "short" ? WORDS.whoseShort.own(markdownText(day(u.saved_at))) : WORDS.whoseLong.own(markdownText(day(u.saved_at)));
  if (u.whose === "team") {
    const c = u.commit;
    const commit = c ? `commit ${c.id.slice(0, 7)}, ${c.author} as git records it` : "";
    return form === "short" ? WORDS.whoseShort.team(markdownText(day(u.saved_at))) : WORDS.whoseLong.team(markdownText(day(u.saved_at)), markdownText(commit), markdownText(day(u.confirmed_at)));
  }
  if (u.whose === "file") return form === "short" ? WORDS.whoseShort.file(markdownText(u.file ?? "")) : WORDS.whoseLong.file(markdownText(u.file ?? ""));
  return u.reason === "no-saved-answers" ? null : form === "short" ? WORDS.whoseShort.none : WORDS.whoseLong.none;
}

/** The report's identity line and what the numbers say once (design 4 "Identity line", 3.5). */
function identityLines(m: ReportModel): Inert[] {
  const f = m.a.findings;
  const out: Inert[] = [md`## ${WORDS.identityHeading}`, ours("")];
  const stats = obj(f.stats) ?? {};
  const scanned = [
    markdownText(str(f.completed_at).slice(0, 10)),
    stats.files_scanned !== undefined ? WORDS.scannedFiles(Number(stats.files_scanned) || 0) : ours(""),
    stats.rules_evaluated !== undefined ? WORDS.scannedRules(Number(stats.rules_evaluated) || 0) : ours(""),
    str(f.scan_id) ? WORDS.scannedId(code(str(f.scan_id))) : ours(""),
  ].filter(Boolean);
  out.push(scanned.length > 0 ? md`${WORDS.scanned(scanned)}. ${rulesLineOf(f)}` : rulesLineOf(f), ours(""));
  const commit = str(obj(f.repository)?.commit) || str(f.commit);
  if (commit) out.push(WORDS.identityCommit(markdownText(commit)), ours(""));
  const note = m.files?.numbers.note;
  out.push(WORDS.identityNumbers(note ? (note.kind === "start" ? note : { ...note, label: markdownText(note.label) }) : null), ours(""));
  return out;
}

/**
 * STEP 13'S SECOND NET, OVER THE LINES AS COMPOSED, BEFORE THE WRAP. The printed
 * redaction (the same function as the values-first pass, `a.printed`) reads a whole file's composed lines, each a line
 * as written, before the form pass wraps them at 75. Until rf11 I-B it ran only over the finished files: there, a wrap
 * that put a secret-named key at a row's start (`API_TOKEN=<value> and more. Places without a verdict: 3`) made clause 18
 * read the rest of the row as the key's value and hide the report's own words and counts, and a value a wrap split
 * across two rows would no longer be recognised. Before the wrap neither can happen; the markers it writes are wrapped
 * like any other words. The pass over the finished files stays as the net under this one (`assemble()`): a value this
 * pass hid begins with its marker, which clause 18 never reads as a value, so that net no longer takes a row's words.
 */
function composedNet(a: ReportArgs, lines: readonly Inert[]): readonly Inert[] {
  return a.printed ? inertLines(inertRedacted(inertJoin(lines, ours("\n")), a.printed)) : lines;
}

function buildReportFiles(a: ReportArgs, model?: ReportModel): ReportFiles {
  const m = model ?? reportModel(a);
  if (!m.files) m.files = fileModelOf(m);
  const net = (t: Inert): Inert => inertJoin(composedNet(a, [t]), ours("\n"));
  const files: ReportFiles = {
    "report.md": buildMainReport(m),
    "not-checked.md": net(buildNotChecked(m)),
    ...ruledOutFiles(m),
    "laws.md": net(buildLaws(m)),
  };
  // (mock M9b) What changed, in full, on a run that carried from an earlier review.
  const later = laterOf(m);
  if (later) files["changes.md"] = net(inertJoin(changesLines(later.c, later.s, later.look, { earlier: later.earlier, project: markdownText(m.project), today: dayWords(str(a.findings.completed_at)) }), ours("\n")));
  for (const l of m.files.listed) files[l.file] = findingFileText(m, l);
  /* Every file leaves through the one raw-view form pass (design 3.1.1, rules 1 and 3), whatever built it: a builder that
   * forgets to wrap at 75 or to escape HTML cannot reach the folder. The pass leaves a file it already formed unchanged. */
  for (const [name, text] of Object.entries(files)) files[name] = formMarkdown(inertLines(text));
  return files;
}


/**
 * Fix C2-7: an identifier-shaped name (`consent_gate`, `sdkInitReference`) as words ("consent gate"); any
 * other name as it is. For an element name or a role, never for an item, whose name is the item's own.
 */
export function plainName(name: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(name) || !/[_-]|[a-z0-9][A-Z]/.test(name)) return name;
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Fix C2-7: how an `element` evidence entry's name is printed: the rule's own words for that element
 * (`reading_class.elements[].text`, carried on the candidate), or, for a name the rule does not declare, the name as
 * words. The element's internal name never reaches the person.
 */
export function elementNameOf(candidate: Obj | undefined, name: string): string {
  const declared = arr(obj(candidate?.reading_class)?.elements).map(obj).find((e) => e && str(e.name) === name);
  const text = declared ? str(declared.text).trim() : "";
  return text !== "" ? text : plainName(name);
}

export function evidenceLines(v: Obj, m: { elided: boolean; short: boolean; redacted: boolean } | null, candidate?: Obj, itemName?: (name: string) => string): Inert[] {
  const ev = arr(v.evidence).map(obj).filter((e): e is Obj => !!e);
  if (ev.length === 0) return [WORDS.noEvidence];
  /* One line per cited line, naming every role it is cited in. A seat
   * rightly cites one line as the premise and as an item; the role was dropped, so the line printed twice. */
  const groups = new Map<string, { file: string; lines: string; quote: string; roles: Inert[] }>();
  for (const e of ev) {
    const key = `${str(e.file)}\u0000${str(e.lines)}\u0000${str(e.quote)}`;
    const g = groups.get(key) ?? { file: str(e.file), lines: str(e.lines), quote: str(e.quote), roles: [] as Inert[] };
    const r = str(e.role);
    // Fix C2-2: an item is named as the report's per-place table names it (the seat named it against the fold).
    const name = r === "element" ? elementNameOf(candidate, str(e.name)) : r === "item" && itemName && str(e.name) ? itemName(str(e.name)) : str(e.name);
    const role = r ? WORDS.evidenceRole(markdownText(r), said(name, 120)) : "";
    if (role && !g.roles.includes(role)) g.roles.push(role);
    groups.set(key, g);
  }
  const lines = [...groups.values()].map((g) => WORDS.evidence(code(g.file), code(g.lines), code(oneLine(g.quote, 300)), g.roles));
  if (m?.elided) lines.push(WORDS.elided);
  if (m?.short) lines.push(WORDS.short);
  if (m?.redacted) lines.push(WORDS.redacted);
  return lines;
}

/** The reading line of SKILL.md L189, for a candidate that carries a census (`kinds` is the census object). */
export function readingLine(candidate: Obj, reading: Obj | undefined): Inert | null {
  const hasKinds = Array.isArray(candidate.kinds) ? candidate.kinds.length > 0 : !!obj(candidate.kinds);
  if (!hasKinds || !reading) return null;
  const members = (row: Obj) => (Array.isArray(row.members) ? row.members.length : Number(row.members ?? 0));
  const read = arr(reading.read).map(obj).filter((r): r is Obj => !!r);
  const covered = arr(reading.covered).map(obj).filter((r): r is Obj => !!r);
  const notRead = arr(reading.not_read).map(obj).filter((r): r is Obj => !!r);
  // Why, in the plain words the *Not checked* line uses, never the record's reason names.
  const byReason = new Map<string, number>();
  for (const r of notRead) byReason.set(str(r.reason), (byReason.get(str(r.reason)) ?? 0) + members(r));
  const why = [...byReason].map(([reason, n]) => (WORDS.notCheckedWhy[reason] ?? ((k: number) => WORDS.notCheckedWhyOther(k, markdownText(reason))))(n)).join("; ");
  // Build unit F4 (the F3 smoke session's second run): a place given as a fact the program verified was not opened, so it
  // is counted apart and never as "opened and read".
  const own = read.filter((r) => !r.also_read_by_reader);
  const fact = own.filter((r) => r.read_basis === "fact").length;
  // Integration: a place read in a data summary the program verified was not opened either.
  const summarized = own.filter((r) => r.read_basis === "data_summary").length;
  return WORDS.reading(own.length - fact - summarized, covered.reduce((n, r) => n + members(r), 0), notRead.reduce((n, r) => n + members(r), 0), markdownText(why), fact, summarized);
}

/* `NotCheckedPlaces` and `notCheckedOf` live in reading.ts (the later run's partition names them too);
 * they are re-exported here, where the report and its gate take them. */
export { notCheckedOf, type NotCheckedPlaces };

/** Why, in the report's plain words: each reason with its count and the review's own sentences. */
function notCheckedWhy(nc: NotCheckedPlaces): Inert {
  return inertJoin(
    nc.reasons.map((r) => {
      const say = WORDS.notCheckedWhy[r.reason];
      const said = say ? say(r.places) : WORDS.notCheckedWhyOther(r.places, markdownText(r.reason));
      // A `not_opened` row's note is the program's, said by the phrase itself; only a review's own sentence is quoted.
      return r.notes.length > 0 && r.reason !== "not_opened" ? md`${said} (${inertJoin(r.notes.map((x) => WORDS.notCheckedSaid(markdownText(x))), ours("; "))})` : said;
    }),
    ours("; "),
  );
}

/**
 * The lines beside one finding: the count, why, and where — the first `inline` files with every line, and the rest
 * counted and pointed to the full list (`inline` = Infinity there). `indent` puts them under a list item.
 */
export function notCheckedLines(nc: NotCheckedPlaces, indent: Inert = ours(""), inline = 5): Inert[] {
  const out = [WORDS.notChecked(nc.places, nc.files.length, notCheckedWhy(nc))];
  const shown = nc.files.slice(0, inline);
  for (const f of shown) out.push(WORDS.notCheckedFile(code(f.file), WORDS.notCheckedLines(f.lines)));
  const rest = nc.files.slice(shown.length);
  if (rest.length > 0) out.push(WORDS.notCheckedMoreFiles(rest.length, rest.reduce((n, f) => n + f.lines.length, 0)));
  if (nc.unlisted > 0) out.push(WORDS.notCheckedUnlisted(nc.unlisted));
  return out.map((l) => md`${indent}${l}`);
}

/**
 * A `legal_basis_refs` entry cut to its citation. The scan writes the citation followed by the
 * provision's own text, which ran to 34,447 characters on one line of run 1's report; the full text
 * stays in findings.json (`legal_basis_refs`), which the log's reader holds beside it.
 */
export function citationOf(ref: string): string {
  /* The cite's heading, whole, where the penalty resolver reads it to end
   * (`headingEnd`: the first dash, colon, opening quotation mark or sentence end), never its prose cut part-way. Before,
   * this cut at a few marks within 200 characters or else at 160 characters, mid-word ("terminal equipment, appli…"), or
   * after a sentence of prose ("... CELEX 02002L0058-20091219. The paragraph opens"). A heading end inside a parenthesis
   * steps back to before that parenthesis, so none is left open. A
   * sentence end before a number ends it too: the Code of Practice heading ran on past "... vice-chairs." into "38 pages". */
  const flat = ref.replace(/\s+/g, " ").trim();
  let end = headingEnd(flat, { sentenceBeforeNumber: true });
  let depth = 0;
  let open = -1;
  for (let i = 0; i < end; i++) {
    if (flat[i] === "(") {
      if (depth === 0) open = i;
      depth++;
    } else if (flat[i] === ")") depth = Math.max(0, depth - 1);
  }
  if (depth > 0 && open > 0) end = open;
  const head = flat.slice(0, end).replace(/[\s,;]+$/, "");
  return head || oneLine(flat, 160);
}

/** A finding by the line that names it (`namingPlaceOf`), with the review's quotation of that line where it gave one. */
function whereOf(v: Obj, c: Obj, rows: readonly PlaceRowIn[] = []): string {
  const place = namingPlaceOf(v, rows, c);
  if (place === WORDS.unrecordedLocation) return place;
  const e = arr(v.evidence)
    .map(obj)
    .find((x): x is Obj => !!x && `${str(x.file)}:${str(x.lines)}` === place);
  return e ? `\`${code(place)}\` (\`${code(oneLine(str(e.quote), 160))}\`)` : `\`${code(place)}\``;
}

function contradictionOf(expr: string, candidates: Obj[]): { rule: string; where: string } | null {
  const c = candidates.find((x) => arr(x.declared_inapplicable_preconditions).map(str).includes(expr));
  return c ? { rule: str(c.rule_id), where: whereOf({}, c) } : null;
}

/* ------------------------------------------------------------------------------------------------
 * The I/O layer: read, hash, validate, write — or write nothing.
 * ---------------------------------------------------------------------------------------------- */
export interface RunOptions {
  /** The person's state folder for the number list; absent: this process's (start-record.ts). */
  stateDir?: string | null;
  findings: string;
  plan: string;
  verdicts: string;
  quotes: string;
  carried?: string;
  /** The `.legal` directory the hooks and the capture write to (default: the parent of `rawVerdicts`). */
  legal?: string;
  /** The run's launch directory (default: `<legal>/launch`). */
  launchDir?: string;
  /** The environment the in-session test reads (default: this process's). */
  env?: NodeJS.ProcessEnv;
  /** The directory the seats' answers were written to. Always needed: see `runAssembleReport`. */
  rawVerdicts?: string;
  /** Readers' replies outside the verdicts directory, as `verdict-reading --readers` takes them. */
  readers?: string;
  /** The tree the quote check reads and the premise blocks are taken over. */
  target: string;
  /** The rule bundle, for the premise blocks. */
  bundle?: string;
  shape?: string;
  chosenBy?: string;
  outLog?: string;
  outReport?: string;
  completedAt?: string;
  /** Tests: the OS account's home the state folder is compared with (default `os.userInfo().homedir`). */
  accountHome?: string;
}

/** A JSON file the program wrote (an input of the assembly or a raw record), through the one reader. */
/** readJson, with the sha256 of the bytes it parsed. */
function readJsonDigested(path: string): { ok: true; value: unknown; sha256: string } | { ok: false; problem: string } {
  const got = readProgramFile("the file", path);
  if (!got.ok) return { ok: false, problem: got.problem };
  try {
    return { ok: true, value: JSON.parse(got.value.toString("utf8")), sha256: createHash("sha256").update(got.value).digest("hex") };
  } catch (e) {
    return { ok: false, problem: (e as Error).message };
  }
}

/** The assembly's refusals in a recorded project. */
export const PLACE_WORDS = {
  plan: (given: string, project: string, expected: string) =>
    `the plan named, ${given}, is not this project's own plan: this command names a folder in ${project}, where Claude Code with the wolfboy plugin has run, so the assembly takes the plan only at ${expected}, where the pre-launch step writes it`,
  carried: (given: string, project: string, expected: string) =>
    `the carried verdicts named, ${given}, are not this project's own: this command names a folder in ${project}, where Claude Code with the wolfboy plugin has run, so the assembly takes them only at ${expected}, where the pre-launch step writes them`,
  planDigest: (given: string, project: string, why: string) =>
    `the plan ${given} is not one the pre-launch step wrote (${why}): in ${project}, where Claude Code with the wolfboy plugin has run, the assembly takes only the plan whose digest the pre-launch step recorded in your state folder when it wrote it; run the pre-launch step again`,
  unvouched: (project: string) =>
    `is neither a log this computer recorded when WolfBoy wrote it nor the log the person chose through the earlier-run question, so in ${project}, where Claude Code with the wolfboy plugin has run, its verdicts are not carried into the report; run the pre-launch step again in Claude Code, where the program asks which earlier log is yours`,
};

function readJson(path: string): { ok: true; value: unknown } | { ok: false; problem: string } {
  const got = readProgramFile("the file", path);
  if (!got.ok) return { ok: false, problem: got.problem };
  try {
    return { ok: true, value: JSON.parse(got.value.toString("utf8")) };
  } catch (e) {
    return { ok: false, problem: (e as Error).message };
  }
}

/** Every `.json` file under a directory; a directory or entry it cannot read is named (command-boundary.ts). */
function filesUnder(dir: string): string[] {
  return existsSync(dir) ? jsonFilesUnder(dir) : [];
}

/** What differs between a file on disk and the file derived for it, record by record and field by field, both as written. */
function recordDifferences(onDisk: unknown, derived: unknown): string {
  const disk = asWritten(onDisk);
  const own = asWritten(derived);
  const a = Array.isArray(disk) ? disk : [disk];
  const b = Array.isArray(own) ? own : [own];
  const out: string[] = [];
  if (Array.isArray(disk) !== Array.isArray(own)) out.push("one is a list and the other is not");
  if (a.length !== b.length) out.push(`${a.length} record(s) on disk, ${b.length} derived`);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = obj(a[i]) ?? {};
    const y = obj(b[i]) ?? {};
    const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => canonical(x[k]) !== canonical(y[k]));
    if (keys.length > 0) out.push(`[${i}] ${keys.join(", ")}`);
  }
  return out.length > 0 ? out.join("; ") : "the same records written with other bytes";
}

/**
 * A derived file against the file on disk, byte for byte: the carried verdicts and the assembled copies
 * are made as the bytes their producer writes. Null where the two are the same bytes; otherwise what
 * differs, record by record, between the two as written.
 */
function fileDifferences(onDisk: Buffer, content: string | Buffer): string | null {
  const want = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  if (onDisk.equals(want)) return null;
  let disk: unknown;
  try {
    disk = JSON.parse(onDisk.toString("utf8"));
  } catch {
    return "the file on disk is not JSON";
  }
  try {
    return recordDifferences(disk, asWritten(want));
  } catch {
    return "the derived file is not JSON";
  }
}

/** How many entries of `x` are not matched by an entry of `y`, counting repeats. */
function unmatched(x: string[], y: string[]): number {
  const left = new Map<string, number>();
  for (const k of y) left.set(k, (left.get(k) ?? 0) + 1);
  let n = 0;
  for (const k of x) {
    const c = left.get(k) ?? 0;
    if (c > 0) left.set(k, c - 1);
    else n += 1;
  }
  return n;
}

/**
 * The quote report on disk against the report of the check this command ran itself. It is a
 * cross-check and never an input. Only what is a path as the person typed it is set aside (`target`,
 * `inputs[].path`, `coverage_checked`, and that findings path where a note or a gap repeats it);
 * every row, note, annotated record, coverage gap and malformed entry must be the same. The check's
 * report is compared as `verdict-verify` writes it.
 */
export function quoteReportDifferences(onDisk: Obj, derived: Obj): Refusal[] {
  const own = obj(asWritten(derived)) ?? {};
  const refusals: Refusal[] = [];
  const why =
    "the quote report on disk is not the check this command runs: it was edited, or it was run against other records, another findings.json or without --require-rests-on; re-run verdict-verify";
  // The texts compared are canonical JSON, where each back-slash of the typed path (every separator of a Windows path) is
  // written as two: the typed path is set aside
  // in the spelling JSON gives it, and as it is. Before, on Windows a check typed with another path was never the same
  // check, and the run was refused until verdict-verify was run with the very same spelling.
  const untyped = (text: string, report: Obj) => {
    const typed = str(obj(report.summary)?.coverage_checked);
    if (!typed) return text;
    return text.split(JSON.stringify(typed).slice(1, -1)).join("<findings>").split(typed).join("<findings>");
  };
  const rowsOf = (report: Obj) => {
    const rows = new Map<string, Obj>();
    for (const r of arr(report.records)) {
      const row = obj(r);
      if (row) rows.set(`${str(row.source)}[${Number(row.index)}]`, row);
    }
    return rows;
  };
  const mine = rowsOf(own);
  const theirs = rowsOf(onDisk);
  for (const [key, row] of mine) {
    const other = theirs.get(key);
    if (!other) {
      refusals.push({ kind: "quote-report", id: key, problem: `${why} (it has no row for this record)` });
      continue;
    }
    const fields = [
      str(row.seat) !== str(other.seat) && "seat",
      str(row.outcome) !== str(other.outcome) && "outcome",
      untyped(canonical(arr(row.notes)), own) !== untyped(canonical(arr(other.notes)), onDisk) && "notes",
      untyped(canonical(row.record), own) !== untyped(canonical(other.record), onDisk) && "record",
    ].filter(Boolean);
    if (fields.length > 0) refusals.push({ kind: "quote-report", id: key, problem: `${why} (${fields.join(", ")} differ${fields.length === 1 ? "s" : ""})` });
  }
  for (const key of theirs.keys()) {
    if (!mine.has(key)) refusals.push({ kind: "quote-report", id: key, problem: `${why} (it has a row for a record this command's check does not have)` });
  }
  for (const part of ["coverage_gaps", "malformed"]) {
    const entries = (report: Obj) => arr(obj(report.summary)?.[part]).map((e) => untyped(canonical(e), report));
    const a = entries(own);
    const b = entries(onDisk);
    const onlyDisk = unmatched(b, a);
    const onlyOwn = unmatched(a, b);
    if (onlyDisk > 0 || onlyOwn > 0) {
      refusals.push({ kind: "quote-report", id: "-", problem: `${why} (summary.${part}: ${onlyDisk} only in the report on disk, ${onlyOwn} only in this command's check)` });
    }
  }
  return refusals;
}

/**
 * The plan on disk against the plan `adjudicatePlan` makes from the same inputs,
 * field by field, and `pre_launch` one level down. A list of finding ids names
 * the ids on one side only; every other field says what each side holds, cut short. The derived plan
 * is compared as `adjudicate` writes it, never as the object it is written from.
 */
export function planDifferences(onDisk: Obj, made: Obj): Refusal[] {
  const derived = obj(asWritten(made)) ?? {};
  const out: Refusal[] = [];
  const why = "the plan on disk is not what the pre-launch step makes from findings.json and the previous run the plan names: it was edited, or made from other inputs. Re-run adjudicate";
  const short = (v: unknown) => (v === undefined ? "(absent)" : oneLine(canonical(v), 160));
  const idsOf = (v: unknown) => arr(v).map((x) => (typeof x === "string" ? x : str(obj(x)?.finding_id)));
  const detail = (key: string, a: unknown, b: unknown): string => {
    if (key === "to_adjudicate" || key === "pre_launch.pre_settled") {
      const x = new Set(idsOf(a));
      const y = new Set(idsOf(b));
      const onlyDisk = [...x].filter((id) => !y.has(id));
      const onlyDerived = [...y].filter((id) => !x.has(id));
      if (onlyDisk.length > 0 || onlyDerived.length > 0) {
        return `on disk and not derived: ${onlyDisk.join(", ") || "none"}; derived and not on disk: ${onlyDerived.join(", ") || "none"}`;
      }
      return "the same finding ids with other contents";
    }
    return `on disk ${short(a)}; derived ${short(b)}`;
  };
  const compare = (key: string, a: unknown, b: unknown) => {
    if (canonical(a) !== canonical(b)) out.push({ kind: "plan", id: key, problem: `${detail(key, a, b)}. ${why}` });
  };
  for (const key of [...new Set([...Object.keys(derived), ...Object.keys(onDisk)])]) {
    const a = obj(onDisk[key]);
    const b = obj(derived[key]);
    if (key === "pre_launch" && a && b) {
      for (const sub of [...new Set([...Object.keys(b), ...Object.keys(a)])]) compare(`pre_launch.${sub}`, a[sub], b[sub]);
    } else compare(key, onDisk[key], derived[key]);
  }
  return out;
}

/**
 * A violation of the log's schema as a refusal that names its record: a pointer
 * into a list of the log names that entry's `finding_id` (`verdicts[]`, `unadjudicated[]`,
 * `pre_settled[]`) or `rule_id` (`unknown_rules[]`), and the validator's own parameters name the
 * property it did not expect or the words it allows.
 */
export function logSchemaRefusal(log: Obj, e: SchemaViolation): Refusal {
  const [, list, index] = e.instancePath.split("/");
  const entry = list !== undefined && /^\d+$/.test(index ?? "") ? obj(arr(log[list])[Number(index)]) : undefined;
  const id = str(entry?.finding_id) || str(entry?.rule_id) || "-";
  const params = e.params ?? {};
  const detail =
    typeof params.additionalProperty === "string"
      ? `: ${params.additionalProperty}`
      : Array.isArray(params.allowedValues)
        ? `: ${params.allowedValues.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(", ")}`
        : "";
  return { kind: "log-schema", id, problem: `${e.instancePath || "/"} ${e.message}${detail}` };
}

/** True when the path lies under a `.legal/evidence/` directory, however it was typed. */
function underEvidence(full: string): boolean {
  const s = full.split(/[\\/]+/).filter(Boolean);
  return s.some((x, i) => x === ".legal" && s[i + 1] === "evidence" && i + 2 < s.length);
}

/**
 * The path with its longest existing head resolved through every symbolic link, and the rest as typed: `link/report.md`, with `link` a link to `.legal/evidence`, is a
 * file under `.legal/evidence/` although no part of the typed path says so.
 */
function realPathOf(full: string): string {
  let head = full;
  const rest: string[] = [];
  while (!existsSync(head)) {
    const up = dirname(head);
    if (up === head) return full;
    rest.unshift(basename(head));
    head = up;
  }
  try {
    return join(realpathSync(head), ...rest);
  } catch {
    return full;
  }
}

/**
 * The two documents go where the flow reads them. Step 3k of the next run reads
 * every file under `.legal/evidence/` as a previous log, so the log goes there, as a `.json` file,
 * and the report never does.
 */
function placementRefusals(opts: RunOptions, at: (p: string) => string): Refusal[] {
  const out: Refusal[] = [];
  const evidence = (p: string) => underEvidence(at(p)) || underEvidence(realPathOf(at(p)));
  if (opts.outLog !== undefined && !(evidence(opts.outLog) && opts.outLog.endsWith(".json"))) {
    out.push({
      kind: "out-log-location",
      id: opts.outLog,
      problem: "the evidence log goes in a .json file under a .legal/evidence/ directory, where step 3k of the next run reads previous logs; written anywhere else, the next run never finds it",
    });
  } else if (opts.outLog !== undefined && !isEvidenceLogName(basename(opts.outLog))) {
    // The readers take only the names legal-dir.ts `isEvidenceLogName` takes; a log written under
    // another name would sit under .legal/evidence/ and never be read.
    out.push({
      kind: "out-log-location",
      id: opts.outLog,
      problem: "the evidence log's file name is scan-<completed_at>.json, as the default names it: the only names step 3k and the review entrance of the next run read as a log; under any other name the next run never finds it",
    });
  } else if (opts.outLog === undefined && opts.completedAt !== undefined && !isEvidenceLogName(evidenceLogName(opts.completedAt))) {
    out.push({
      kind: "out-log-location",
      id: defaultEvidenceLogPath(opts.completedAt),
      problem: "--completed-at gives a time the default log name cannot carry in a name the next run reads as a log (scan-<completed_at>.json, letters, digits, '.', '_', ':' and '-'): give the time in ISO 8601 UTC, as 2026-10-28T10:22:34.469Z",
    });
  }
  if (opts.outReport !== undefined && evidence(opts.outReport)) {
    out.push({
      kind: "out-report-location",
      id: opts.outReport,
      problem: "the report is not an evidence log, and step 3k of the next run reads every file under .legal/evidence/ as one; write it anywhere else (the default is .legal/reports/)",
    });
  }
  return out;
}

/**
 * Both documents, or neither. Each is written under a temporary name in its own
 * directory and then renamed into place; on any error every temporary file and every rename already
 * made are removed, so no reader finds one document without the other. Returns the problem, or null.
 */
export function writeBothOrNeither(files: [string, string][]): string | null {
  const temps: string[] = [];
  const placed: string[] = [];
  // Every directory this call made, in the order made, so a failed write leaves no empty
  // `.legal/reports/scan-<stamp>/` behind; only an empty one is removed (rmdir), never one holding anything.
  const made: string[] = [];
  let doing = "";
  try {
    for (const [to, content] of files) {
      doing = `write ${to}`;
      // A folder inside a `.legal` folder gets that folder's ignore files
      // before it is made, whatever named the path (an option, or this command's own default), as index.ts's writes do
      // through prepareOutputFolder; the report's files quote code lines.
      const legal = legalDirOf(dirname(to));
      if (legal !== null) writeLegalIgnore(legal);
      // What the folder holds and what may be deleted; never fails the report.
      if (legal !== null) {
        try {
          writeLegalReadme(legal);
        } catch {
          // the README is a courtesy; the report stands without it
        }
      }
      const first = makeFolder(dirname(to), { recursive: true });
      if (first) {
        const chain: string[] = [];
        for (let d = dirname(to); ; d = dirname(d)) {
          chain.unshift(d);
          if (d === first || dirname(d) === d) break;
        }
        made.push(...chain);
      }
      const tmp = join(dirname(to), `.${basename(to)}.${process.pid}.assemble-report.tmp`);
      temps.push(tmp);
      writeFileAt(tmp, content);
    }
    files.forEach(([to], i) => {
      doing = `write ${to}`;
      // A rename replaces what is there, and the rollback below would then remove it: a file this
      // command did not write is never replaced.
      if (existsSync(to)) throw new Error("something is already at this path, and this command replaces nothing it did not write");
      renamePath(temps[i], to);
      placed.push(to);
    });
    return null;
  } catch (e) {
    for (const p of [...temps, ...placed]) {
      try {
        removePath(p, { force: true });
      } catch {
        // A path that cannot be removed is named by the caller's message; nothing else can be done here.
      }
    }
    for (const d of [...made].reverse()) {
      try {
        removeEmptyFolder(d);
      } catch {
        // Not empty (something else is in it) or already gone: left as it is.
      }
    }
    return `could not ${doing}: ${(e as Error).message}`;
  }
}

/**
 * THE RECOVERY OF A REFUSAL: one table for every kind step 5a or this assembly emits, recovery.ts `RECOVERY` (before
 * it, the switch here, which had no case for four kinds of this
 * assembly and whose relaunch recovery left out step 5a). Re-exported for the gates that import it from here.
 */
export { recoveryOf } from "./recovery.js";

const refusedLines = (refusals: Refusal[]): string[] => [
  `✘ REFUSED — nothing was written. ${refusals.length} record(s) stopped the assembly:`,
  ...refusals.map((r) => {
    const recovery = recoveryOf(r);
    return `refused: ${r.kind} ${r.id} — ${r.problem}${/[.]$/.test(r.problem) ? "" : "."} ${recovery}.`;
  }),
];

/**
 * The command. After an assembly that wrote (exit 0) the run's active-run marker is ended (A-36, `endActiveRun`). A
 * refused assembly (exit 5) wrote nothing and leaves the run active, saying how to go on or end it (the parent's
 * ruling on M3-2); an input it cannot read (exit 1) leaves it standing and says nothing more.
 */
/** Build unit F4: a candidate's per-place table as the assembly writes it, with where it goes. */
interface PlaceTableOnDisk {
  candidate: Candidate;
  table: PlaceTableRow[];
  summary: PlaceSummary;
  /** The table's path, absolute, and relative to the `.legal` directory (as the log and the report name it). */
  full: string;
  rel: string;
}

/**
 * The per-place table of every candidate read by the place plan (design section 3): from the readers' accepted records
 * and, where the candidate's own seat held its places, that seat's rows - the same table the capture hook writes before
 * the answer seat launches (`verdict-reading --fold`), written again here for every candidate so that a candidate that
 * fits one seat has one too.
 */
export function placeTablesOf(
  candidates: readonly Candidate[],
  read: { seats: { finding_id: string; rows: ReadingReadRow[] }[]; replies: ReaderReply[] },
  legalDir: string,
  /** Fix C2-2: the bundle's rules (`--bundle`), from which each token item is named (`itemLabelsOfCandidate`). */
  rules?: ReadonlyMap<string, Rule>,
): Map<string, PlaceTableOnDisk> {
  const out = new Map<string, PlaceTableOnDisk>();
  for (const candidate of candidates) {
    if (!isPlacePlanCandidate(candidate)) continue;
    const seatRows = read.seats.filter((s) => s.finding_id === candidate.finding_id).flatMap((s) => s.rows);
    const table = placeTableOf(candidate, read.replies, seatRows, itemLabelsOfCandidate(candidate, rules?.get(candidate.rule_id)));
    const full = placeTablePath(legalDir, candidate.finding_id);
    out.set(candidate.finding_id, { candidate, table, summary: placeSummaryOf(candidate, table), full, rel: relativePath(legalDir, full) });
  }
  return out;
}

/** The evidence log's `places_read[]` row of one finding (build unit F4). */
export function placesReadRow(id: string, p: PlacesRead): Obj {
  const s = p.summary;
  return {
    finding_id: id,
    places: s.places,
    places_read: s.read,
    ...(s.carried > 0 ? { carried: s.carried, carried_from_scans: s.carried_from_scans } : {}),
    window: s.window,
    fact: s.fact,
    summary: s.summary,
    not_checked: s.not_checked,
    beyond: s.beyond,
    kept: s.kept,
    ...(s.items ? { items: s.items } : {}),
    // Fix C2-5: the record that lists the items also says how many kept places name none.
    ...(s.items && s.items_missing ? { items_missing: s.items_missing } : {}),
    ...(s.own_name ? { own_name: s.own_name } : {}),
    per_place_table: p.path,
  };
}

/** The report's lines for a finding read place by place (design section 3, "How the person sees it"). */
export function placeLines(p: PlacesRead, own: VendorSoftware | null = null): Inert[] {
  const s = p.summary;
  const unchecked = s.not_checked.reduce((n, r) => n + r.places, 0);
  const out = [WORDS.placesRead(s.read, s.places, s.window, s.fact, s.summary, unchecked, inertJoin(s.not_checked.map((r) => WORDS.placesNotCheckedWhy(markdownText(r.reason), r.places)), ours("; ")))];
  if (s.carried > 0) out.push(WORDS.placesCarried(s.carried, markdownText(s.carried_from_scans.join(", "))));
  for (const r of s.not_checked_first) out.push(WORDS.placeNotCheckedRow(markdownText(r.place), code(r.at), WORDS.placeReason(markdownText(r.reason))));
  if (unchecked > s.not_checked_first.length) out.push(WORDS.placesNotCheckedMore(unchecked - s.not_checked_first.length));
  // Verification A, VA-1: places read and left undecided are named as the not-checked ones are (both bar not_applicable).
  const undetermined = s.undetermined ?? 0;
  if (undetermined > 0) {
    // A carried undecided place is said to have been read in the earlier scan, not in this one.
    out.push(WORDS.placesUndetermined(undetermined, s.undetermined_carried ?? 0));
    for (const r of s.undetermined_first ?? []) out.push(WORDS.placeUndeterminedRow(markdownText(r.place), code(r.at), r.carried === true));
    if (undetermined > (s.undetermined_first ?? []).length) out.push(WORDS.placesUndeterminedMore(undetermined - (s.undetermined_first ?? []).length));
  }
  // How each place was read, file by file (the F3 smoke session's second run: counts alone did not say it), the first
  // PLACE_FILES_SHOWN files inline and the rest counted; every place is a row of the table.
  for (const f of s.files.slice(0, PLACE_FILES_SHOWN)) {
    const how = [
      f.window.length > 0 ? WORDS.placeHowWindow(WORDS.notCheckedLines(f.window)) : ours(""),
      f.fact.length > 0 ? WORDS.placeHowFact(WORDS.notCheckedLines(f.fact)) : ours(""),
      f.summary.length > 0 ? WORDS.placeHowSummary(WORDS.notCheckedLines(f.summary)) : ours(""),
      f.carried.length > 0 ? WORDS.placeHowCarried(WORDS.notCheckedLines(f.carried)) : ours(""),
      ...[...groupBy(f.not_checked, (r) => r.reason)].map(([reason, rows]) => WORDS.placeHowNotChecked(WORDS.notCheckedLines(rows.map((r) => r.line)), WORDS.placeReason(markdownText(reason)))),
    ].filter(Boolean);
    out.push(WORDS.placeHowFile(code(f.file), inertJoin(how, ours("; "))));
  }
  const restFiles = s.files.slice(PLACE_FILES_SHOWN);
  if (restFiles.length > 0) out.push(WORDS.placeHowMoreFiles(restFiles.length, restFiles.reduce((n, f) => n + f.window.length + f.fact.length + f.summary.length + f.carried.length + f.not_checked.length, 0)));
  out.push(WORDS.placesBeyond(s.beyond));
  // The items are the program's where it holds them, so every kept place is counted; kept places that
  // name no item (a rule whose items are found by reading) are counted and named, never left unsaid.
  if (s.items) out.push(s.items.length > 0 ? WORDS.placesItems(inertJoin(s.items.map((i) => WORDS.placesItem(markdownText(i.item), i.places)), ours("; "))) : WORDS.placesItemsNone);
  const noItem = s.items_missing;
  if (s.items && noItem && noItem.places > 0) out.push(WORDS.placesItemsMissing(noItem.places, inertJoin(noItem.first.map((f) => md`${markdownText(f.place)} at ${inSpan(code(f.at))}`), ours(", ")), noItem.places - noItem.first.length));
  // The places read in own-name seats, one item, every place in the per-place table.
  if (s.own_name) out.push(WORDS.placesOwnName({ ...s.own_name, entry: markdownText(s.own_name.entry), item: markdownText(s.own_name.item) }, own !== null && own.entry === s.own_name.entry ? own.relation : null));
  out.push(WORDS.placesTable(code(p.path)));
  return out;
}

/** The report's lines for a candidate nobody answered (A7): its counts and its kept places, never clean. */
function notAnsweredLines(u: Obj): Inert[] {
  const kept = arr(u.kept_places).map(str);
  const unchecked = arr(u.not_checked).map(obj).reduce((n, r) => n + Number(r?.places ?? 0), 0);
  const out = [WORDS.notAnsweredRow(code(str(u.finding_id)), markdownText(str(u.seat)), code(str(u.kept)), Number(u.places), Number(u.places_read), unchecked, kept.length, code(str(u.per_place_table)), Number(u.places_carried ?? 0), arr(u.carried_from_scans).map((x) => markdownText(str(x))))];
  for (const k of kept.slice(0, PLACE_SUMMARY_SHOWN)) out.push(WORDS.notAnsweredKept(code(k)));
  if (kept.length > PLACE_SUMMARY_SHOWN) out.push(WORDS.notAnsweredKeptMore(kept.length - PLACE_SUMMARY_SHOWN));
  return out;
}

/** How many files of a finding read place by place the report lists line by line (the table holds every place). */
const PLACE_FILES_SHOWN = 10;

const groupBy = <T>(rows: readonly T[], key: (r: T) => string): Map<string, T[]> => {
  const out = new Map<string, T[]>();
  for (const r of rows) out.set(key(r), [...(out.get(key(r)) ?? []), r]);
  return out;
};

/** How many kept places of a candidate nobody answered the report lists one by one (the table and the log hold every one). */
const PLACE_SUMMARY_SHOWN = 10;

/**
 * The person's answer to the Vendor proxy question, from the run context the launch step wrote
 * (`<launch>/run-context.json`, launch-plan.ts `RunContext`), taken only where that context is this scan's and its
 * profile is the one the scan read (`profileDigest` equal to the findings' `profile_digest`). Anything else - no file,
 * another scan, another profile, no answer - is not an answer, and a self-hostable vendor counts as outside the operator.
 */
export function ownDomainEndpointsOf(launchDir: string, findings: Obj): string | null {
  const answer = obj(runProfileOf(launchDir, findings)?.features)?.own_domain_endpoints;
  return typeof answer === "string" ? answer : null;
}

/**
 * The confirmed record's answers by question id, with value and time,
 * through declaration.ts's one reader (`readDeclaration`, `givenAnswersOf`). Empty where there is no question source or no
 * confirmed record: then a region settlement shows no date, and nothing else changes.
 */
export function confirmedAnswersAt(dir: string, plan: Obj | null, scanAt = ""): Map<string, { value: unknown; at: string }> {
  /* The answers THIS SCAN used are its plan's `answers_used` (the log's copy),
   * never the answer files as they stand later: an answer counts only where the scan used saved answers (`own` or
   * `team`) and the record still holds the same answer to that question, whose value and time are then the record's.
   * A question answered again after the scan, or a run that read a --profile or no saved answers, gives no date; so does
   * an answer the record dates after the scan (`scanAt`, the findings' completion), which answering the round again
   * restamps even where the label stayed the same. */
  const used = answersUsedOf(plan);
  const source = declarationSourceOf();
  if (!source || !used || (used.whose !== "own" && used.whose !== "team")) return new Map();
  const same = new Map((used.answers ?? []).map((a) => [a.id, a.answer] as const));
  try {
    return new Map([...confirmedAnswersOf(source, readDeclaration(dir))].filter(([id, a]) => a.label !== null && same.get(id) === a.label && !(Date.parse(a.at) > Date.parse(scanAt))).map(([id, a]) => [id, { value: a.value, at: a.at }] as const));
  } catch {
    return new Map();
  }
}

/**
 * The profile the scan read, from this scan's run context,
 * on the same terms: the context is this scan's and its profile's digest is the findings' `profile_digest`. Else null.
 */
export function runProfileOf(launchDir: string, findings: Obj): Obj | null {
  const path = join(launchDir, "run-context.json");
  if (!existsSync(path)) return null;
  let ctx: Obj | undefined;
  try {
    ctx = obj(JSON.parse(readRegularFile(path, "utf8")));
  } catch {
    return null;
  }
  const digest = str(findings.profile_digest);
  if (!ctx || ctx.kind !== "run-context" || str(ctx.scan_id) !== str(findings.scan_id) || !digest || !obj(ctx.profile)) return null;
  if (profileDigest(ctx.profile as unknown as ScanProfile) !== digest) return null;
  return obj(ctx.profile) ?? null;
}

/**
 * ONE ANSWER NEVER REFUSES THE REPORT. Before it,
 * a problem with one seat's answer - a transcript no route finds, a record changed or removed outside the program, a
 * premise block that could not be derived, a word the record cannot hold - refused the whole assembly, and where no step
 * of the run could correct it (the line's recovery: run-abort) the person had no report at all.
 *
 * THE CLASS, CLOSED ONCE. Every refusal is either about the run - its plan, scan, bundle, launch list, ledgers as a
 * whole, the step-5a outputs, the paths the person named: it stays a refusal, because nothing is sound to assemble on -
 * or about ONE ANSWER (`ONE_ANSWER_KINDS`): one record, one verdict, one entry. A line about one answer
 *  - stays a refusal only while the run is active and the line's own recovery continues it (the entry is launched again,
 *    a seat is waited for, an entry appended again, step 5a run again): the run puts it right;
 *  - otherwise SETS THE ANSWER ASIDE: no record of it is read (`assemble`'s step 3a), and its candidates are listed as not
 *    checked, each with the reason (`unadjudicated[]` reason `unusable_answer`; the report's `no-usable-answer` kind,
 *    counted on the first screen). Never dropped, never counted as read.
 * Setting one answer aside can expose another line (its candidate then has no verdict), so the loop runs until no new
 * answer is set aside. A line that cannot be tied to the answer it is about stays a refusal (nothing to list it by).
 */
export const ONE_ANSWER_KINDS: ReadonlySet<RefusalKind> = new Set<RefusalKind>([
  // A record whose file, ledger line or transcript was changed or removed outside the program (717's list B).
  "transcript-unreadable",
  "transcript-mismatch",
  "ledger-mismatch",
  "ledger-missing-file",
  "record-not-via-hook",
  "record-missing",
  "record-unbound",
  "answer-owned-field",
  // An entry, candidate or rule with no usable answer (the relaunch rule decides whether the run can still launch it).
  "entry-unanswered",
  "seat-cut-off",
  "verdict-lost",
  "refutation-missing",
  // Where the program disagrees with one record (717's list C), and a premise block that could not be derived.
  "coverage-gap",
  "verdict-word",
  "refutation-outcome",
  "silence-outcome",
  "verdict-duplicate",
  "refutation-duplicate",
  "silence-duplicate",
]);

/** An answer step 6 set aside, and what it held: its candidates are the not-judged ones with `why`. */
export interface SetAside {
  /** The line that set it aside (its kind and what it names), and what it is about, for the terminal's noted line. */
  kind: RefusalKind;
  id: string;
  label: string;
  /** Every line about this answer, the first one included: each is printed whole as set aside, never dropped unseen. */
  lines: Refusal[];
  entry: string | null;
  seat: string;
  role: string;
  why: string;
  /** Records (paths under the verdicts directory) none of whose rows is read. */
  sources: string[];
  findings: string[];
  refutations: string[];
  silences: string[];
  /** For a record set aside whole, the position of each candidate's own readable row in it. */
  rowOf?: Readonly<Record<string, number>>;
}

/**
 * Each set-aside candidate's own reason. Where a record is set aside whole because of lines that
 * name rows of it (`<record>[<n>]`), a candidate with a readable row of its own at another position was not wrong
 * itself: its reason says the file was set aside because of another answer in it, and names that one's position. A
 * candidate whose own row a line names, or that has no readable row there, keeps that line's reason.
 */
function asideWhyOf(a: SetAside, id: string): string {
  if (a.rowOf === undefined) return a.why;
  const named = a.lines
    .map((l) => ({ l, at: /\[(\d+)\]$/.exec(l.id)?.[1] }))
    .filter((x): x is { l: Refusal; at: string } => x.at !== undefined && a.sources.includes(x.l.id.replace(/\[\d+\]$/, "").replace(/^verdicts\//, "")));
  if (named.length === 0) return a.why;
  const mine = a.rowOf[id];
  const own = named.find((x) => Number(x.at) === mine);
  if (own) return `${own.l.kind}: ${own.l.problem}`;
  if (mine === undefined) return a.why;
  const first = named[0] as { l: Refusal; at: string };
  return WORDS.asideWithItsFile(markdownText(first.l.id.replace(/\[\d+\]$/, "")), mine, Number(first.at), markdownText(`${first.l.kind}: ${first.l.problem}`));
}

/** The not-judged sets with every set-aside answer's candidates added, each with why; an answer already not judged keeps its own row. */
export function withSetAside(base: NotJudgedSets | undefined, aside: SetAside[]): NotJudgedSets {
  const out: NotJudgedSets = { findings: new Map(base?.findings ?? []), refutations: new Map(base?.refutations ?? []), silences: new Map(base?.silences ?? []) };
  for (const a of aside) {
    const nj = (id: string) => ({ entry: a.entry ?? "-", role: a.role, seat: a.seat, kept: "", why: asideWhyOf(a, id) });
    for (const id of a.findings) if (!out.findings.has(id)) out.findings.set(id, nj(id));
    for (const id of a.refutations) if (!out.refutations.has(id)) out.refutations.set(id, nj(id));
    for (const id of a.silences) if (!out.silences.has(id)) out.silences.set(id, nj(id));
  }
  return out;
}

/** True where the line's recovery ends the run (run-abort): nothing within the run corrects it. Read from the one table. */
function recoveryEndsRun(r: Refusal): boolean {
  return /end the run with run-abort/i.test(recoveryOf(r));
}

/**
 * The answer a line is about, or null where it cannot be told (the line then stays a refusal). Candidate-level kinds set
 * aside that candidate's answer of that seat; record-level kinds the record whole, with every candidate its rows answer
 * and, in a hooked run, every id of its entry; entry-level kinds the entry's ids.
 */
function answerOfRefusal(r: Refusal, run: HookedRun, fileRecords: FileRecord[]): SetAside | null {
  if (!ONE_ANSWER_KINDS.has(r.kind)) return null;
  const why = `${r.kind}: ${r.problem}`;
  const srcOf = (id: string): string => id.replace(/\[\d+\]$/, "").replace(/^verdicts\//, "");
  const entries = run.list?.entries ?? [];
  const idsOfEntry = (entryId: string | null): { role: string; findings: string[]; refutations: string[]; silences: string[] } => {
    // A superseded refuter entry (launch-list-file.ts `standingRefuters`, the run's `superseded`) answers a
    // verdict that no longer exists, so setting its answer aside lists no candidate: none is "not yet refuted" for it.
    if (entryId !== null && run.superseded.has(entryId)) return { role: "refuter", findings: [], refutations: [], silences: [] };
    const e = entryId === null ? undefined : entries.find((x) => x.id === entryId);
    const role = e ? String(e.role) : "";
    const ids = e ? ((role === "silence-investigator" ? e.rule_ids : e.finding_ids) ?? []) : [];
    return { role, findings: role === "refuter" || role === "silence-investigator" ? [] : ids, refutations: role === "refuter" ? ids : [], silences: role === "silence-investigator" ? ids : [] };
  };
  const make = (label: string, entry: string | null, seat: string, sources: string[], ids: { role: string; findings: string[]; refutations: string[]; silences: string[] }, rowOf?: Record<string, number>): SetAside => ({
    kind: r.kind,
    id: r.id,
    label,
    lines: [r],
    entry,
    seat,
    role: ids.role,
    why,
    sources,
    findings: [...new Set(ids.findings)],
    refutations: [...new Set(ids.refutations)],
    silences: [...new Set(ids.silences)],
    ...(rowOf ? { rowOf } : {}),
  });
  const seatKind = (k: string): "adjudicator" | "refuter" | "silence-investigator" => (/^refutation-/.test(k) ? "refuter" : /^silence-/.test(k) ? "silence-investigator" : "adjudicator");
  switch (r.kind) {
    case "entry-unanswered":
    case "seat-cut-off": {
      const entry = r.relaunch?.entry ?? (r.kind === "entry-unanswered" ? r.id : null);
      if (entry === null) return make(`seat ${r.id}, bound to no entry`, null, r.id, [], { role: "", findings: [], refutations: [], silences: [] });
      return make(`entry ${entry}`, entry, r.relaunch?.seat ?? "-", [], idsOfEntry(entry));
    }
    case "verdict-lost":
    case "refutation-missing":
    case "coverage-gap":
    case "verdict-word":
    case "refutation-outcome":
    case "silence-outcome":
    case "verdict-duplicate":
    case "refutation-duplicate":
    case "silence-duplicate": {
      if (!r.id || r.id === "-") return null;
      const seat = seatKind(r.kind);
      const decision = seat === "refuter" ? run.decisions.refutations.get(r.id) : seat === "adjudicator" ? run.decisions.verdicts.get(r.id) : undefined;
      const entry = r.relaunch?.entry ?? decision?.entry ?? null;
      return make(`${seat === "adjudicator" ? "the answer" : seat === "refuter" ? "the second review" : "the investigation"} of ${r.id}${entry ? ` (entry ${entry})` : ""}`, entry, r.relaunch?.seat ?? "-", [], {
        role: seat,
        findings: seat === "adjudicator" ? [r.id] : [],
        refutations: seat === "refuter" ? [r.id] : [],
        silences: seat === "silence-investigator" ? [r.id] : [],
      });
    }
    default: {
      // A record: the record whole, every candidate its rows answer, and in a hooked run every id of the entry it answers.
      if (!r.id || r.id === "-") return null;
      const src = srcOf(r.id);
      const bound = run.seatOf.get(src);
      const entry = bound?.entry ?? r.relaunch?.entry ?? null;
      const rows = fileRecords.filter((f) => f.source === src);
      const ofEntry = idsOfEntry(entry);
      const ids = {
        role: ofEntry.role || rows[0]?.seat || "",
        findings: [...ofEntry.findings, ...rows.filter((f) => f.seat === "adjudicator").map((f) => f.id)],
        refutations: [...ofEntry.refutations, ...rows.filter((f) => f.seat === "refuter").map((f) => f.id)],
        silences: [...ofEntry.silences, ...rows.filter((f) => f.seat === "silence-investigator").map((f) => f.id)],
      };
      // A record that holds no row and that no entry binds (an empty or unreadable file the orchestrator wrote outside a
      // hooked run): set aside whole; the candidates it was to answer are named by their own `verdict-lost` lines, which
      // set those aside and list them, so nothing is dropped. Any other kind with nothing to tie it to stays a refusal.
      if (rows.length === 0 && entry === null) return r.kind === "record-missing" && src.endsWith(".json") ? make(`the record ${src}`, null, "-", [src], { role: "", findings: [], refutations: [], silences: [] }) : null;
      return make(`the record ${src}${entry ? ` (entry ${entry})` : ""}`, entry, bound?.seat ?? "-", [src], ids, Object.fromEntries(rows.map((f) => [f.id, f.index])));
    }
  }
}

/**
 * The loop (see ONE_ANSWER_KINDS): assemble; set aside every answer whose line the run cannot put right; assemble again,
 * until nothing new is set aside. A line about an answer already set aside is not printed: its candidates are listed.
 */
export function settleOneAnswers(
  assembleWith: (aside: SetAside[], outer: Refusal[]) => AssembleResult,
  outer: Refusal[],
  run: HookedRun,
  launchDir: string,
  fileRecords: FileRecord[],
): { result: AssembleResult; aside: SetAside[] } {
  const marker = readActiveRun(launchDir);
  // The run can still act while its marker stands: for the launch list's run, or - where the list does not read - any run.
  const active = marker.state === "active" && (run.list === null || run.list === undefined || marker.marker.run_id === run.list.run_id);
  const aside: SetAside[] = [];
  const seen = new Set<string>();
  const keyOf = (a: SetAside): string => JSON.stringify([a.sources, a.findings, a.refutations, a.silences]);
  const covered = (a: SetAside): boolean =>
    a.sources.every((x) => aside.some((b) => b.sources.includes(x))) &&
    a.findings.every((x) => aside.some((b) => b.findings.includes(x))) &&
    a.refutations.every((x) => aside.some((b) => b.refutations.includes(x))) &&
    a.silences.every((x) => aside.some((b) => b.silences.includes(x)));
  for (let pass = 0; ; pass++) {
    // A line made before the assembly about an answer already set aside is not handed in: it would stop the log.
    const result = assembleWith([...aside], aside.length === 0 ? outer : outer.filter((r) => {
      const a = answerOfRefusal(r, run, fileRecords);
      return a === null || !covered(a);
    }));
    const kept: Refusal[] = [];
    const fresh: SetAside[] = [];
    for (const r of result.refusals) {
      const a = answerOfRefusal(r, run, fileRecords);
      if (a === null) {
        kept.push(r);
        continue;
      }
      if (aside.length > 0 && covered(a)) {
        // Already set aside: listed, and the line named among that answer's (`also`), never printed as a refusal.
        const holder = aside.find((b) => a.sources.some((x) => b.sources.includes(x)) || a.findings.some((x) => b.findings.includes(x)) || a.refutations.some((x) => b.refutations.includes(x)) || a.silences.some((x) => b.silences.includes(x))) ?? aside[0];
        if (!holder.lines.some((x) => x.kind === r.kind && x.id === r.id && x.problem === r.problem)) holder.lines.push(r);
        continue;
      }
      // The run can still put it right by the line's own recovery: it stays a line, and the run goes on.
      const incomplete = r.kind === "coverage-gap" && /^rests-on-incomplete/.test(r.problem);
      // Past the relaunch cap nothing within the run puts the entry right either: it is listed (entry-answer.ts RELAUNCHES_MAX).
      const capped = r.relaunch?.ok === false && r.relaunch.state === "capped";
      if (active && !incomplete && !capped && !recoveryEndsRun(r)) {
        kept.push(r);
        continue;
      }
      if (!seen.has(keyOf(a))) {
        seen.add(keyOf(a));
        fresh.push(a);
      }
    }
    // Bounded: each pass sets aside at least one new answer, and there are finitely many.
    if (fresh.length === 0 || pass > 64) return { result: { ...result, refusals: kept }, aside };
    aside.push(...fresh);
  }
}

export function runAssembleReport(opts: RunOptions, cwd = process.cwd()): { exitCode: number; lines: string[] } {
  const result = assembleOnce(opts, cwd);
  const legal = opts.legal ?? (opts.rawVerdicts ? dirname(opts.rawVerdicts) : undefined);
  const launchDir = opts.launchDir ? resolve(cwd, opts.launchDir) : legal !== undefined ? join(resolve(cwd, legal), "launch") : undefined;
  if ((result.exitCode === 0 || result.exitCode === 5) && launchDir !== undefined && existsSync(launchDir)) result.lines.push(...endRunLines(launchDir, new Date(), result.exitCode === 0));
  return result;
}

function assembleOnce(opts: RunOptions, cwd: string): { exitCode: number; lines: string[] } {
  const lines: string[] = [];
  const at = (p: string) => resolve(cwd, p);
  /* IN A RECORDED PROJECT (a session of the plugin's
   * hooks, or that session's scan, recorded for this account: plugin-sessions.ts, asked by index.ts for every command
   * before its action, the state folder and key held to the recorded ones there), the assembly takes the run's files only
   * at the project's own `.legal`, the plan only with the digest the pre-launch step recorded when it wrote it, and the
   * earlier run the plan names only where this computer recorded it as a log WolfBoy wrote or the person chose it through
   * the earlier-run question (below, with the plan's other checks). Before anything is read. */
  const governed = commandSessions();
  const recorded = governed !== null && governed.kind === "recorded" ? governed : null;
  if (recorded !== null) {
    const own = (rel: string): string => canonicalPath(join(recorded.project, ".legal", rel));
    const misplaced: Refusal[] = [];
    if (canonicalPath(at(opts.plan)) !== own("adjudicate-plan.json")) {
      misplaced.push({ kind: "plan", id: "place", problem: PLACE_WORDS.plan(at(opts.plan), recorded.projectDir, join(recorded.project, ".legal", "adjudicate-plan.json")) });
    }
    if (opts.carried !== undefined && canonicalPath(at(opts.carried)) !== own("verdicts-carried")) {
      misplaced.push({ kind: "plan", id: "carried", problem: PLACE_WORDS.carried(at(opts.carried), recorded.projectDir, join(recorded.project, ".legal", "verdicts-carried")) });
    }
    if (misplaced.length > 0) return { exitCode: 5, lines: refusedLines(misplaced) };
  }
  const inputs: Record<string, unknown> = {};
  for (const [name, path] of [["findings", opts.findings], ["plan", opts.plan], ["quotes", opts.quotes]] as const) {
    // The plan read once, its digest taken from the bytes parsed.
    const r = name === "plan" && recorded !== null ? readJsonDigested(at(path)) : readJson(at(path));
    if (!r.ok) return { exitCode: 1, lines: [`✘ cannot read --${name} ${path}: ${r.problem}`] };
    inputs[name] = r.value;
    if (name === "plan" && recorded !== null && "sha256" in r) {
      const planOwner = dirname(dirname(at(path)));
      const digests = readLogDigests(processStateDir(), planOwner);
      const want = digests.ok ? digests.byName.get(adjudicatePlanDigestName(at(path))) : undefined;
      if (want !== r.sha256) {
        const why = !digests.ok ? `the record of what WolfBoy wrote could not be read (${digests.why})` : want === undefined ? "this computer recorded no digest of it" : "its sha256 is not the one recorded";
        return { exitCode: 5, lines: refusedLines([{ kind: "plan", id: "digest", problem: PLACE_WORDS.planDigest(at(path), recorded.projectDir, why) }]) };
      }
    }
  }
  // A findings document whose sha256 is not the one the scan recorded in the state folder is refused
  // before anything is read from it: the report prints its candidates' rule text (log-digest.ts `findingsChangedProblem`).
  const findingsChanged = findingsChangedProblem(at(opts.findings), readRegularFile(at(opts.findings)), [at(opts.target)]);
  if (findingsChanged !== null) return { exitCode: 5, lines: refusedLines([{ kind: "findings-mismatch", id: opts.findings, problem: findingsChanged }]) };
  if (!existsSync(at(opts.verdicts))) return { exitCode: 1, lines: [`✘ --verdicts ${opts.verdicts} does not exist`] };
  const placement = placementRefusals(opts, at);
  /* The two documents' paths, fixed here so that a file already at either is refused before any work
   *: the write below replaces nothing, and its rollback can then
   * only ever remove what this command wrote. A directory there is left to the write, which fails and
   * names it. */
  const completedAt = opts.completedAt ?? new Date().toISOString();
  const stamp = completedAt.replace(/[:.]/g, "-");
  const logPath = at(opts.outLog ?? defaultEvidenceLogPath(completedAt));
  /* The report is one folder, `.legal/reports/scan-<ISO8601>/` by default: `report.md`,
   * `not-checked.md`, `ruled-out.md` and `laws.md`, with `findings/` and `ruled-out/` (rf11-b1a-2026-11-06.md). `--out-report`
   * names that folder; a path ending in `.md` (the option's earlier form, kept working) names the main file,
   * and the others are written beside it. Every one is held to the same rule as the log: never replaced. */
  const outReportIsFile = opts.outReport !== undefined && opts.outReport.endsWith(".md");
  const reportDir = opts.outReport === undefined ? at(`.legal/reports/scan-${stamp}`) : outReportIsFile ? dirname(at(opts.outReport)) : at(opts.outReport);
  const reportPaths = Object.fromEntries(REPORT_FILES.map((name) => [name, name === "report.md" && outReportIsFile ? at(opts.outReport as string) : join(reportDir, name)])) as Record<ReportFileName, string>;
  const reportPath = reportPaths["report.md"];
  for (const [kind, path, typed] of [
    ["out-log-exists", logPath, opts.outLog],
    ...REPORT_FILES.map((name) => ["out-report-exists", reportPaths[name], name === "report.md" && outReportIsFile ? opts.outReport : undefined] as const),
  ] as const) {
    if (existsSync(path) && !statSync(path).isDirectory()) {
      placement.push({
        kind,
        id: typed ?? relativePath(cwd, path),
        problem: "a file is already at this path, and this command never replaces a file it did not write: an earlier log or report would be lost. Name another path, or move that file first",
      });
    }
  }

  /* THE SEATS' ANSWERS ARE THE ONE INPUT TAKEN AS GIVEN. Every other record this
   * command reads is derived here from them: the assembled copies are made again the way
   * `verdict-reading --assemble-into` makes them and must equal `--verdicts` byte for byte, and the
   * quote check is run here over those copies. Without the answers nothing ties a copy to a seat. */
  if (!opts.rawVerdicts) {
    return {
      exitCode: 5,
      lines: refusedLines([
        ...placement,
        {
          kind: "raw-verdicts-missing",
          id: "-",
          problem:
            "--raw-verdicts is not given: without the seats' own answers nothing ties the assembled copies to what the seats returned, so no record can be shown to be a seat's. Pass the directory the answers were written to (.legal/verdicts)",
        },
      ]),
    };
  }
  const named: [string, string][] = [["raw-verdicts", opts.rawVerdicts], ["target", opts.target]];
  if (opts.readers) named.push(["readers", opts.readers]);
  for (const [name, path] of named) {
    if (!existsSync(at(path))) return { exitCode: 1, lines: [`✘ --${name} ${path} does not exist`] };
  }
  /* WHERE THE HOOKS WROTE (milestone 3): the `.legal` directory and the run's launch directory. */
  const legalDir = at(opts.legal ?? dirname(opts.rawVerdicts));
  const launchDir = opts.launchDir ? at(opts.launchDir) : join(legalDir, "launch");
  const layout = legalLayoutRefusals(legalDir, at(opts.rawVerdicts), opts.readers ? at(opts.readers) : null, { raw: opts.rawVerdicts, readers: opts.readers });
  if (layout.length > 0) return { exitCode: 5, lines: refusedLines([...placement, ...layout]) };
  const findings = obj(inputs.findings) ?? {};
  const candidates = arr(findings.candidates).filter((c) => !!obj(c)) as Candidate[];
  let premise: PremiseInputs;
  let tiers: PenaltyTierTable;
  // The redaction at the writers: the CLI's own baseline-002 (engine.ts `productPrintedRedaction`),
  // never the bundle's, so no bundle can turn it off.
  const redaction: PrintedRedaction | null = productPrintedRedaction();
  let bundleDir = opts.bundle ?? "";
  let ruleLines: Readonly<Record<string, RuleLines>> = {};
  try {
    // --bundle, else LEGAL_BUNDLE_DIR, else the bundle shipped with this program.
    const opened = openBundle("assemble-report", opts.bundle ? at(opts.bundle) : undefined);
    bundleDir = opened.dir;
    ruleLines = opened.ruleLines;
    premise = premiseInputs(at(opts.target), bundleDir);
    // The penalty-tier table from the same bundle, its digest checked against the manifest.
    tiers = loadPenaltyTiers(bundleDir);
  } catch (e) {
    return { exitCode: 1, lines: [`✘ ${(e as Error).message}`] };
  }

  const refusals: Refusal[] = [...placement];
  /* WHAT THE HOOKS WROTE, read before the records so that a line about a record states its situation's recovery;
   * its own refusals are printed where they were (below). */
  /* While the run can still launch, a record removed or changed outside
   * the program is set aside first, so the relaunch rule launches its entry again instead of its candidates being listed. */
  for (const a of setAsideChangedRecords(legalDir, launchDir)) lines.push(`noted: set aside so that its entry is launched again: ${valueText(a.file)} (entry ${a.entry}, seat ${a.seat}) — ${a.why}`);
  const run = readHookedRun(legalDir, launchDir, at(opts.verdicts));
  /** A line about the record at `rel` (a path under verdicts/): the removal of every file a copy the capture ledger does not
   * list leaves, or, for a record that cannot be read, the relaunch rule's decision for the entry the ledger binds it to. */
  const situated = (r: Refusal, rel: string | undefined): Refusal => {
    const files = rel === undefined ? undefined : run.unlisted.get(rel);
    if (files) return { ...r, unlisted: files };
    const relaunch = rel === undefined || r.kind !== "record-missing" ? undefined : run.seatOf.get(rel)?.relaunch;
    return relaunch !== undefined ? { ...r, relaunch } : r;
  };

  /* THE CHECK'S INPUTS ARE THE SCAN'S.
   * The quote check and the premise blocks read --target and --bundle, and everything is derived from
   * --findings: each is tied to what the scan and the plan record, or refused. The findings document
   * is tied by bytes to the one the plan names, so a copy is accepted and another document is not;
   * what neither record can show is that the document itself is the scan's unedited output, which
   * needs a digest recorded outside the orchestrator's reach (an open item for the capture unit). */
  const planOnDisk = obj(inputs.plan) ?? {};
  const plannedFindings = str(planOnDisk.findings);
  if (!plannedFindings || !existsSync(at(plannedFindings)) || !programFileBytes("the findings document the plan names", at(plannedFindings)).equals(programFileBytes("the findings document", at(opts.findings)))) {
    refusals.push({
      kind: "findings-mismatch",
      id: opts.findings,
      problem: plannedFindings
        ? `the plan was made from ${plannedFindings}, and ${existsSync(at(plannedFindings)) ? "--findings is another document" : "no such file is here"}: every candidate, verdict and payload below would be read against a scan the plan was not made from`
        : "the plan names no findings document, so nothing shows it was made from this scan",
    });
  }
  const realOf = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  const scannedTree = str(findings.target);
  if (!scannedTree || realOf(at(opts.target)) !== realOf(at(scannedTree))) {
    refusals.push({
      kind: "target-mismatch",
      id: opts.target,
      problem: scannedTree
        ? `the scan read ${scannedTree}, and --target is ${at(opts.target)}: the quote check and the premise blocks must read the tree the scan read`
        : "findings.json records no target, so the tree the quote check reads cannot be shown to be the one the scan read",
    });
  }
  const scannedBundle = str(obj(findings.bundle)?.version);
  if (premise.version !== scannedBundle) {
    refusals.push({
      kind: "bundle-mismatch",
      id: bundleDir,
      problem: `the scan ran bundle ${scannedBundle || "(no version recorded)"}, and --bundle is ${premise.version}: the premise blocks must be taken over the bundle the scan ran`,
    });
  }

  /* THE PLAN AND THE CARRIED VERDICTS ARE DERIVED FILES, made again here.
   * `adjudicatePlan` is the function `adjudicate` writes both
   * with, run over the same inputs: findings.json, the previous run the plan names, the tree and the
   * bundle. Every field of the plan and every byte of a carried file that differs is refused by
   * name, and only what is derived here is used below. Two things are taken from the plan as its own
   * record, because no input reproduces them: which previous run the person named (`previous`) and the
   * label its verdicts carry (`previous_scan_id`). The previous run's content is untied for the same
   * reason as findings.json's (an open item for the hooks and capture units). */
  const previousTyped = typeof planOnDisk.previous === "string" && planOnDisk.previous ? planOnDisk.previous : null;
  /* An input the derivation cannot use stops the command with a message that names it, never with a
   * stack trace: findings.json holding an applicability row its
   * schema forbids, a null `jurisdiction_question`, reached `adjudicatePlan` outside every guard. */
  const cannotDerive = (e: unknown) => ({
    exitCode: 1,
    lines: [`✘ cannot make the plan again from --findings ${opts.findings}${previousTyped ? ` and the previous run ${previousTyped}` : ""}: ${(e as Error).message}`],
  });
  let previousRun: PreviousRun | null = null;
  if (previousTyped) {
    let problem = "";
    if (!existsSync(at(previousTyped))) problem = "is not on disk";
    else {
      try {
        previousRun = readPreviousRun(at(previousTyped));
      } catch (e) {
        if (!(e instanceof PreviousRunUnreadable)) return cannotDerive(e);
        problem = `could not be read as JSON (${e.path}: ${e.message})`;
      }
    }
    // The bytes the pre-launch step read
    // and vouched for: a log swapped since is not the one the person chose or the state folder vouched for.
    const planSha = planOnDisk.previous_sha256;
    if (!problem && previousRun !== null && (typeof planSha !== "string" || planSha !== previousRun.sha256)) {
      problem = typeof planSha !== "string" ? "has no sha256 in the plan (a plan made before the pre-launch step kept one)" : `changed after the pre-launch step read it (sha256 then ${planSha}, now ${previousRun.sha256 ?? "unknown"})`;
    }
    // In a recorded project the vouch again, on the bytes
    // read here: a log this computer recorded when WolfBoy wrote it, or the one the person chose (recorded by the pre-launch
    // step that took their answer, under the project that holds the plan).
    if (!problem && previousRun !== null && recorded !== null && typeof previousRun.sha256 === "string") {
      const owner = dirname(dirname(at(opts.plan)));
      const chosen = readLogDigests(processStateDir(), owner);
      const byChoice = chosen.ok && chosen.byName.get(earlierRunChosenName(previousRun.sha256)) === previousRun.sha256;
      if (!byChoice && previousVouchRefusal(at(previousTyped), previousRun, at(opts.target), processStateDir(), recorded.projectDir) !== null) {
        problem = PLACE_WORDS.unvouched(recorded.projectDir);
      }
    }
    if (problem) {
      return {
        exitCode: 5,
        lines: refusedLines([
          ...refusals,
          { kind: "plan", id: "previous", problem: `the plan names the previous run ${previousTyped}, which ${problem}: the carried verdicts cannot be made again, so neither can the plan` },
        ]),
      };
    }
  }
  let derivation: ReturnType<typeof adjudicatePlan>;
  try {
    derivation = adjudicatePlan({
      findings: findings as unknown as Findings,
      findingsTyped: plannedFindings,
      orientationSheet: orientationSheetBeside(dirname(at(opts.findings)), (findings as { scan_id?: unknown }).scan_id) !== null,
      // The run-wide `--seat-model` the plan records, which the partition took as the model now.
      ...(typeof planOnDisk.seat_model_override === "string" && planOnDisk.seat_model_override ? { seatModelOverride: planOnDisk.seat_model_override } : {}),
      previous:
        previousTyped && previousRun
          ? { typed: previousTyped, run: previousRun, scanId: str(planOnDisk.previous_scan_id), tree: premise.tree, bundle: { rules: premise.rules, version: premise.version, files: premise.files } }
          : null,
    });
  } catch (e) {
    return cannotDerive(e);
  }
  // The plan as `adjudicate` writes it: compared, and used below, in that form only.
  const planWritten = obj(asWritten(Buffer.from(derivation.content, "utf8"))) ?? {};
  refusals.push(...planDifferences(planOnDisk, planWritten));
  /* --carried is the directory `adjudicate --carry-into` writes, one file per carried verdict. A file
   * named there is refused by name (the walk below crashed on it). */
  const carriedDir = opts.carried ? at(opts.carried) : null;
  const carriedNotADirectory = carriedDir !== null && existsSync(carriedDir) && !statSync(carriedDir).isDirectory();
  if (carriedNotADirectory) {
    refusals.push({
      kind: "carried-not-directory",
      id: opts.carried ?? "",
      problem: "--carried names a file, and the pre-launch step writes each carried verdict as its own file in a directory (adjudicate --carry-into): name that directory (.legal/verdicts-carried)",
    });
  }
  const carried: FileRecord[] = [];
  const carriedNames = new Set<string>();
  for (const c of derivation.carried) {
    carriedNames.add(c.rel);
    carried.push({ source: c.rel, index: 0, seat: "adjudicator", id: c.finding_id, record: obj(arr(asWritten(Buffer.from(c.content, "utf8")))[0]) ?? {} });
    if (carriedNotADirectory) continue;
    const onDiskPath = carriedDir ? join(carriedDir, c.rel) : "";
    if (!carriedDir || !existsSync(onDiskPath)) {
      refusals.push({
        kind: "carried-missing",
        id: c.rel,
        problem: `the pre-launch step carries this verdict forward from ${previousTyped} and writes it here, and ${carriedDir ? "--carried does not hold it" : "--carried was not given"}`,
      });
      continue;
    }
    const detail = fileDifferences(programFileBytes("the carried verdict", onDiskPath), c.content);
    if (detail !== null) {
      refusals.push({
        kind: "carried-differs",
        id: c.rel,
        problem: `the file in --carried is not what the pre-launch step carries forward from ${previousTyped} (${detail}): it was changed after it was written, or carried from another run`,
      });
    }
  }
  if (carriedDir && !carriedNotADirectory && existsSync(carriedDir)) {
    for (const full of filesUnder(carriedDir)) {
      const rel = relativePath(carriedDir, full);
      if (!carriedNames.has(rel)) {
        refusals.push({
          kind: "carried-unlisted",
          id: rel,
          problem: `this file is in --carried and the pre-launch step carries no such verdict ${previousTyped ? `from ${previousTyped}` : "(the plan names no previous run)"}: nothing ties it to an earlier answer`,
        });
      }
    }
  }

  const rawDir = at(opts.rawVerdicts);
  let read: ReturnType<typeof readingInputsOfRun>;
  let placeTables = new Map<string, PlaceTableOnDisk>();
  let copies: ReturnType<typeof assembledCopies>;
  try {
    /* The run's inputs by the one derivation `verdict-reading` uses
     * (run-reading.ts `readingInputsOfRun`); the rows of the reader seats the run did not launch (every place carried,
     * build unit F5 M3) come from the plan as this command made it again (`planWritten`, compared field by field above),
     * never from the file on disk. */
    read = readingInputsOfRun({ verdictsDir: rawDir, candidates, readersDir: opts.readers ? at(opts.readers) : undefined, plan: planWritten });
    // Integration: the per-place tables are made after the carried rows enter `read.replies`, so a carried
    // place's row is in its table (shown as carried, `place-fold.ts`).
    placeTables = placeTablesOf(candidates, read, legalDir, premise.rules);
    const reading = assembleReadingForVerdicts({ candidates, seats: read.seats, replies: read.replies });
    copies = assembledCopies({
      verdictsDir: rawDir,
      read,
      assembled: reading,
      candidates,
      perRuleApplicability: (findings as unknown as Findings).per_rule_applicability,
      premise,
      handed: findings as unknown as Findings,
      orientationSheet: orientationSheetBeside(dirname(at(opts.findings)), (findings as { scan_id?: unknown }).scan_id) !== null,
    });
  } catch (e) {
    return { exitCode: 1, lines: [`✘ cannot assemble the copies from --raw-verdicts ${opts.rawVerdicts} with --findings ${opts.findings}: ${(e as Error).message}`] };
  }
  for (const u of read.unreadable) {
    refusals.push(situated({ kind: "record-missing", id: u.path, problem: `${u.problem}; verdict-reading makes no copy of it, so what that seat returned is in no record` }, u.path));
  }
  /* What is not a regular file with one name among the records was never opened (the one reader):
   * it is not a record the capture wrote, and it is refused by name. */
  for (const r of read.refused) {
    refusals.push({ kind: "record-not-a-file", id: r.path, problem: `${r.problem}; the capture writes each record as a new regular file, so this is not one of its records` });
  }
  /* No seat writes a field the program owns: an answer that
   * carries one is refused by name, because the log would copy it as the program's own record. */
  const answers: { rel: string; parsed: unknown; seat: Seat }[] = read.verdictDocs.map((d) => ({ rel: d.rel, parsed: d.parsed, seat: "adjudicator" as Seat }));
  for (const p of read.passthrough) {
    // The bytes the walk read through the one reader (reading-assembly.ts): the file is not read a second time.
    let parsed: unknown;
    try {
      parsed = JSON.parse(p.bytes.toString("utf8"));
    } catch {
      continue;
    }
    answers.push({ rel: p.rel, parsed, seat: p.rel.startsWith("silence/") ? "silence-investigator" : "refuter" });
  }
  for (const a of answers) {
    (Array.isArray(a.parsed) ? a.parsed : [a.parsed]).forEach((r, i) => {
      const record = obj(r);
      const owned = record ? programOwnedFields(record, a.seat) : [];
      if (owned.length > 0) {
        refusals.push({
          kind: "answer-owned-field",
          id: `${a.rel}[${i}]`,
          problem: `this ${a.seat} answer carries ${owned.join(", ")}, which the program writes and no seat's Output has: the log would state a check, a premise, a carry or a model nothing here produced. Re-launch that seat`,
        });
      }
    });
  }

  /* The copies on disk must be the copies derived here. */
  const verdictsDir = at(opts.verdicts);
  const derived = new Set<string>();
  for (const f of copies.files) {
    derived.add(f.rel);
    const onDiskPath = join(verdictsDir, f.rel);
    if (!existsSync(onDiskPath)) {
      refusals.push(situated({ kind: "assembled-missing", id: f.rel, problem: "verdict-reading makes this file from the seats' answers in --raw-verdicts and it is not in --verdicts: the assembly on disk is not of these answers" }, f.rel));
      continue;
    }
    const detail = fileDifferences(programFileBytes("the file", onDiskPath), f.content);
    if (detail !== null) {
      refusals.push(
        situated(
          {
            kind: "assembled-differs",
            id: f.rel,
            problem: `the file in --verdicts is not what verdict-reading makes from the seats' answers in --raw-verdicts (${detail}): it was changed after it was assembled, or assembled from other answers`,
          },
          f.rel,
        ),
      );
    }
  }
  for (const full of filesUnder(verdictsDir)) {
    const rel = relativePath(verdictsDir, full);
    if (!derived.has(rel)) {
      refusals.push({ kind: "assembled-unlisted", id: rel, problem: "this file is in --verdicts and verdict-reading makes no such file from the seats' answers in --raw-verdicts: nothing ties it to a seat" });
    }
  }

  /* The quote check, run here over the copies this command derived, with the scan document and with
   * every premise block required: the same functions `verdict-verify` runs. */
  const tmp = makeTempFolder("assemble-report-");
  let dir: ReturnType<typeof jobsFromVerdictsDir>;
  let fileRecords: FileRecord[];
  let check: ReturnType<typeof verifyVerdictQuotes>;
  try {
    for (const f of copies.files) {
      const to = join(tmp, f.rel);
      makeFolder(dirname(to), { recursive: true });
      writeFileAt(to, f.content);
    }
    dir = jobsFromVerdictsDir(tmp);
    // The records as the copies hold them, taken before the check annotates the same objects in
    // place: `assemble` reads a record as written through them (the stale-check guard, and the
    // orphan test, which must see the word the adjudicator wrote rather than the check's).
    fileRecords = dir.jobs.map((j) => ({ source: j.source, index: j.index, seat: j.seat, id: j.id, record: clone(j.record) }));
    check = verifyVerdictQuotes({
      targetRoot: at(opts.target),
      displayTarget: opts.target,
      fromDir: { dir: tmp, ...dir },
      fromFindings: { path: opts.findings, findings: findings as unknown as Findings },
      requireRestsOn: true,
      credentials: redaction,
      // The refutations step 6 skips (a superseded refuter entry's) demote no other record's note here either.
      supersededRefutations: supersededRefutationFiles(run),
    });
  } finally {
    removePath(tmp, { recursive: true, force: true });
  }
  if (check.target_problem) return { exitCode: 1, lines: [`✘ --target ${opts.target}: ${check.target_problem}`] };
  // The check's report as `verdict-verify` writes it: compared with the one on disk, and used below, in that form only.
  const quoteReport = obj(asWritten(check.report)) ?? {};
  const launchesRun = dir.files.filter((f) => f.seat === "adjudicator").length;
  for (const u of dir.unreadable) refusals.push(situated({ kind: "record-missing", id: u.path, problem: u.problem }, u.path));
  // A quote report row is keyed `<source>[<index>]`: a row of a copy the capture ledger does not list states its removal.
  refusals.push(...quoteReportDifferences(obj(inputs.quotes) ?? {}, quoteReport).map((r) => situated(r, /^(.+)\[\d+\]$/.exec(r.id)?.[1])));

  /* WHAT THE HOOKS WROTE (milestone 3): the capture ledger, the hook ledger, the launch list and the transcripts;
   * model and effort from the launch list (read above, `run`). */
  refusals.push(...run.refusals);
  const { modelOf, seatOf, agentModel, agentEffort } = run;
  /* THE RUN SHAPE (item 3): in a hooked run, or inside Claude Code, the person's answer as the hook recorded it and
   * never a flag; outside, the flags, which must agree with the launch list where one exists. */
  let shape = opts.shape;
  let chosenBy = opts.chosenBy;
  if (run.hooked || claudeCodeSigns(opts.env ?? process.env).length > 0) {
    const why = run.hooked ? `run ${run.list?.run_id} was launched in a Claude Code session` : "this command runs inside a Claude Code session";
    if (opts.shape !== undefined || opts.chosenBy !== undefined) {
      refusals.push({
        kind: "shape-flag-in-session",
        id: opts.shape !== undefined ? "--shape" : "--chosen-by",
        problem: `${why}, where the run shape is the person's answer to the run-shape question as the plugin's hook recorded it: --shape and --chosen-by are not taken there`,
      });
    }
    shape = undefined;
    chosenBy = undefined;
    if (!run.list) {
      refusals.push({ kind: "shape-answer", id: run.listPath, problem: `${why}, and there is no launch list at ${run.listPath}: no run shape can be tied to the person's answer` });
    } else {
      const taken = runShapeFromAnswer(launchDir, run.listPath);
      if ("refused" in taken) refusals.push({ kind: "shape-answer", id: run.listPath, problem: `${taken.refused}: the run shape cannot be tied to the person's answer` });
      else {
        shape = taken.shape;
        // A list written in the recommended plan without asking (a later scan) is recorded as the default.
        chosenBy = "byDefault" in taken ? "default" : "user";
      }
    }
  } else if (run.list && opts.shape !== undefined && opts.shape !== run.list.shape) {
    refusals.push({ kind: "shape-mismatch", id: "--shape", problem: `--shape ${opts.shape}, and the launch list ${run.listPath} was written for ${run.list.shape}: the log would record a shape the run was not launched in` });
  }

  /* The report folder against the project (relative code links, or absolute where it lies
   * outside), and the number list (design 3.5): this computer's list for the folder, else the numbers the carried log
   * recorded. A list the state folder refuses is read as missing, and the person is told why in one sentence. */
  const targetAbs = at(opts.target);
  const upPath = relativePath(reportDir, targetAbs);
  const reportPlace = { up: upPath === "" ? "" : upPath.split("/").every((x) => x === "..") ? `${upPath}/` : null, root: targetAbs };
  const stateDir = opts.stateDir === undefined ? processStateDir() : opts.stateDir;
  const numberNotes: string[] = [];
  const listRead = readStateRecord(stateDir, targetAbs, NUMBER_LIST_KIND);
  let numberList: NumberList | null = null;
  if (listRead.read) {
    numberList = parseNumberList(listRead.text);
    if (!numberList.ok) numberNotes.push(WORDS.numberListUnreadable(markdownText(numberList.why)));
  } else if (!listRead.absent) numberNotes.push(WORDS.numberListRefused(markdownText(listRead.why)));
  let carriedNumbers: { numbers: ReadonlyMap<string, number>; label: string } | null = null;
  if (previousTyped && existsSync(at(previousTyped)) && statSync(at(previousTyped)).isFile()) {
    try {
      const prevLog = JSON.parse(readRegularFile(at(previousTyped), "utf8")) as Obj;
      const day = dayWords(str(prevLog.completed_at));
      carriedNumbers = { numbers: numbersOfLog(prevLog), label: day ? WORDS.reviewOfDay(day) : WORDS.reviewEarlier };
    } catch {
      carriedNumbers = null;
    }
  }
  /* (design 3.5) F-numbers are never given twice in a folder. Where this computer
   * has the folder's number list, the list is the source (`assignNumbers` numbers above the highest it ever held, a
   * finding gone since included). Where it has none, `recordedMax` is the highest number in the logs of the evidence
   * folder whose digest this computer recorded (`recordedMaxOf`); a digest record that does not read gives 0, as before. */
  const usable = numberList && numberList.ok ? numberList : null;
  const digestsForNumbers = usable ? null : readLogDigests(stateDir, targetAbs);
  const recordedMax = digestsForNumbers && digestsForNumbers.ok ? recordedMaxOf(dirname(logPath), digestsForNumbers.byName) : 0;
  const numbering = { list: usable, carried: carriedNumbers, recordedMax };
  /* The earlier log the plan names, read for the comparison, with its digest mark from the
   * person's state folder (log-digest.ts): the same state folder as the number list's. */
  const earlierForComparison =
    previousTyped && previousRun
      ? readEarlierForComparison({ abs: at(previousTyped), typed: previousTyped, label: str(planOnDisk.previous_scan_id), stateDir, target: targetAbs })
      : null;
  /* The input of the assembly whose report is written, kept so that `decide` can
   * write the report again with the person's decisions without reading the tree (report-render.ts). The last call is the
   * one whose result stands (`settleOneAnswers`). */
  let renderKeep: ReturnType<typeof keepRenderInput> | null = null;
  /* The deeper checks' record of this folder (the person's state folder), read
   * once: each finding's file shows its checks while the finding stands (design rf13 3.9). Where it cannot be read, the
   * person is told in one sentence and the files say "None." under "Deeper checks". */
  const deepRead = readDeepRecord(stateDir, targetAbs);
  // With the linked files as read now, kept with the render input.
  const deeperChecks = deepRead.ok ? { project: targetAbs, reportDir, lines: deepRead.lines, seen: linkedFilesSeen(deepRead.lines, targetAbs) } : undefined;
  const itemSources = new Map([...placeTables].map(([id, t]) => [id, programItemSourceOf(t.candidate)] as const));
  const assembleWith = (setAside: SetAside[], outer: Refusal[]): AssembleResult => {
    renderKeep = keepRenderInput(assembleInputWith(setAside, outer), { tiers, itemSources });
    return assemble(renderKeep.input);
  };
  const boundPlan = boundDeclarationPlan(dirname(at(opts.findings)), findings, stateDir, targetAbs);
  if (boundPlan.note !== null) numberNotes.push(boundPlan.note);
  const assembleInputWith = (setAside: SetAside[], outer: Refusal[]): AssembleInput => ({
    setAside,
    earlier: earlierForComparison,
    reportPlace,
    numbering,
    // Read by the assembly only after its counts are made (design rf11 3.4).
    personDecisions: () => readDecisionRecord(stateDir, targetAbs),
    ...(deeperChecks ? { deeperChecks } : {}),
    redaction,
    logPath: relativePath(cwd, logPath) || logPath,
    reportName: basename(reportPath),
    findings: obj(inputs.findings) ?? {},
    plan: planWritten,
    fileRecords,
    quoteReport,
    dirMalformed: dir.malformed.filter((m) => !fileRecords.some((f) => f.source === m.source && f.index === m.index)),
    carried,
    shape,
    chosenBy,
    completedAt,
    stateFolder: stateFolderUsed(stateDir, process.platform, opts.accountHome ?? accountHomeNow()),
    launchesRun,
    modelOf,
    seatOf,
    agentModel,
    agentEffort,
    refusals: outer,
    notJudged: run.notJudged,
    placeTables: new Map(
      [...placeTables].map(([id, t]) => [id, { summary: t.summary, path: t.rel, itemName: (name: string) => shownItemNameOf(t.table, programItemSourceOf(t.candidate), name) }]),
    ),
    placeRows: new Map([...placeTables].map(([id, t]) => [id, t.table])),
    ruleLines,
    shortNames: new Map([...premise.rules].filter(([, r]) => typeof r.short_name === "string" && r.short_name.trim() !== "").map(([id, r]) => [id, (r.short_name as string).trim()] as const)),
    // Each rule's role from
    // the bundle, read by the one reader of it (standing.ts `findingRoleOf`): `inventory` only where the rule declares it.
    ruleRoles: new Map([...premise.rules].map(([id, r]) => [id, findingRoleOf(r)] as const)),
    // Each rule's `duty_about` from the bundle, through its one reader.
    ruleDuties: new Map([...premise.rules].flatMap(([id, r]) => { const d = dutyAboutOf(r); return d ? [[id, d] as const] : []; })),
    ownDomainEndpoints: ownDomainEndpointsOf(launchDir, findings),
    // The profile the scan read, each rule's bases with their regions and the bundle's tier table, for
    // the order (fix-order.ts); each cite is resolved once.
    profile: runProfileOf(launchDir, findings),
    tierOf: tierOfMemo(tiers),
    ruleBases: new Map([...premise.rules].map(([id, r]) => [id, (r.legal_basis ?? []).map((b) => {
      const j = (b as { jurisdiction?: unknown }).jurisdiction;
      // The link and the day it was checked, for the Provisions section.
      const u = (b as { url?: unknown }).url;
      const at = (b as { checked_at?: unknown }).checked_at;
      return { cite: b.cite, ...(typeof j === "string" && j ? { jurisdiction: j } : {}), ...(typeof u === "string" && /^https?:\/\/\S+$/.test(u) ? { url: u } : {}), ...(typeof at === "string" && at ? { checked_at: at } : {}) };
    })] as const)),
    // Only the plan whose digest the scan kept in the state folder.
    declarationPlan: boundPlan.plan,
    declarationPlanNotTaken: boundPlan.why,
    // The confirmed record's answers, for a region settlement's date only.
    confirmedAnswers: confirmedAnswersAt(dirname(at(opts.findings)), boundPlan.plan, str(findings.completed_at)),
    modelOverrides: run.list?.model_overrides ?? [],
    held: run.held,
    superseded: run.superseded,
    // The run's second-look entries that stand: one with no answer is `not_answered`.
    challengeEntries: run.challengeEntries,
    lookClaims: run.lookClaims,
    ledgerChecked: run.ledgerChecked,
    unlisted: run.unlisted,
    decisions: run.decisions,
    appendRefuter: run.appendRefuter,
    listUnread: run.listUnread,
    /* SKILL.md step 7's re-check, in the form its command runs (`verdict-verify --target <tree> --log <the log>`: no
     * --findings, because a carried verdict's reading was written against the previous scan's document, and no
     * --require-rests-on), over the log as it will be written, named by its path as typed (O7). */
    recheck: (log) => {
      const re = verifyVerdictQuotes({
        targetRoot: at(opts.target),
        displayTarget: opts.target,
        fromLog: { path: opts.outLog ?? defaultEvidenceLogPath(completedAt), log: asWritten(log) as EvidenceLog },
        credentials: redaction,
      });
      if (re.target_problem) return { problem: `--target ${opts.target}: ${re.target_problem}` };
      return { report: obj(asWritten(re.report)) ?? {} };
    },
  });
  /* ONE ANSWER NEVER REFUSES THE REPORT: an answer the assembly cannot use is set aside and its candidates
   * listed as not checked, unless the run can still put it right by the line's own recovery (below, `settleOneAnswers`). */
  const settled = settleOneAnswers(assembleWith, refusals, run, launchDir, fileRecords);
  const result = settled.result;

  // The commit the scanned folder stands at, for the record's "What was examined" (design rf11 3.7).
  const summary = obj(result.log?.summary);
  if (summary && !str(obj(summary.code)?.commit)) summary.code = { ...(obj(summary.code) ?? {}), ...scanCommitOf(targetAbs) };
  /* The log must be what its schema says, or nothing is written. */
  if (result.log) {
    const v = validateAgainstSchema("evidence-log.schema.json", result.log, {
      register: ["scan-profile.schema.json", "verdict.schema.json", "declarations.schema.json", "findings.schema.json"],
    });
    if (!v.ran) result.refusals.push({ kind: "log-schema", id: "-", problem: "the schema validator did not run here, so the log cannot be shown to satisfy evidence-log.schema.json" });
    else if (!v.ok) {
      const named = v.errors.map((e) => logSchemaRefusal(result.log as Obj, e));
      for (const r of named.slice(0, 50)) result.refusals.push(r);
      if (named.length > 50) result.refusals.push({ kind: "log-schema", id: "-", problem: `and ${named.length - 50} more violations` });
    }
  }

  const c = result.counts;
  lines.push(...run.noted.map((n) => `noted: ${n}`));
  for (const a of settled.aside) {
    // Every line about the answer, whole, then what is listed for it - what was not checked stays as visible as a refusal.
    for (const x of a.lines) lines.push(`noted: set aside: ${x.kind} ${x.id} — ${oneLine(x.problem, 1200)}`);
    const what = [a.findings.length > 0 ? `candidate(s) ${a.findings.join(", ")}` : "", a.refutations.length > 0 ? `the second review of ${a.refutations.join(", ")}` : "", a.silences.length > 0 ? `silent rule(s) ${a.silences.join(", ")}` : ""];
    lines.push(`noted: listed as not checked: ${a.label}; ${what.filter(Boolean).join("; ") || "no candidate"}`);
  }
  lines.push(
    `assemble-report: ${c.candidates_total} candidates — ${c.verdicts} verdicts (${c.violation_candidate} violation_candidate, ${c.needs_human} needs_human, ${c.not_applicable} not_applicable of which ${c.overturned} overturned; ${c.carried} carried), ${c.pre_settled} pre-settled, ${c.unadjudicated} not adjudicated${c.suppressed > 0 ? `, ${c.suppressed} suppressed by the scanner` : ""}; ${c.unknown_rules} silent rules`,
  );
  const rc = result.recheck;
  if (rc) {
    const o = (k: string) => rc.outcomes[k] ?? 0;
    lines.push(
      `  step 7's re-check over the log (run here, as verdict-verify --log runs it): ${rc.records} record(s), ${rc.quotations} quotation(s) — confirmed ${o("confirmed")}, position repaired ${o("repaired")}, parts confirmed ${o("parts_confirmed")}, no evidence ${o("no_evidence")}, invalidated ${o("invalidated")}${rc.malformed > 0 ? `; ${rc.malformed} malformed` : ""}; ${rc.demoted} record(s) demoted by it that the first check had not, each shown in the report with the check's reason`,
    );
  }
  if (result.refusals.length > 0) {
    lines.push(...refusedLines(result.refusals));
    if (settled.aside.length > 0) lines.push(`  and ${settled.aside.length} answer(s) noted above as set aside: once nothing above refuses, the report lists their candidates as not checked, with why (nothing to do for them)`);
    return { exitCode: 5, lines };
  }
  // Build unit F4: the per-place table of every candidate read by the place plan that the log names (a verdict's
  // `places_read[]` row, or a `not_answered` entry), written before the log that names it. A candidate the run did not
  // reach, carried or settled gets none: no seat of this run held its places, so "not answered" would not be true of them.
  const tabled = new Set<string>([
    ...arr(result.log?.places_read).map((r) => str(obj(r)?.finding_id)),
    ...arr(result.log?.unadjudicated).map(obj).filter((u) => str(u?.reason) === "not_answered").map((u) => str(u?.finding_id)),
  ]);
  try {
    for (const [id, t] of placeTables) if (tabled.has(id)) writePlaceTable(t.full, t.candidate, t.table);
  } catch (e) {
    lines.push(`✘ nothing was written: a per-place table could not be written (${(e as Error).message})`);
    return { exitCode: 1, lines };
  }
  const failed = writeBothOrNeither([
    [logPath, `${JSON.stringify(result.log, null, 2)}\n`],
    // Every file of the report, the folders' files included, whole or not at all.
    ...Object.entries(result.report ?? {}).map(([name, text]): [string, string] => [(reportPaths as Record<string, string>)[name] ?? join(reportDir, name), text]),
  ]);
  if (failed) {
    lines.push(`✘ nothing was written: ${failed}`);
    return { exitCode: 1, lines };
  }
  /* The log's sha256 into the person's state folder, beside the start record, so the next
   * scan's earlier-run question can mark a log changed since WolfBoy wrote it. A refused record is said in one sentence. */
  {
    const digestWrite = recordLogDigest(stateDir, targetAbs, basename(logPath), createHash("sha256").update(`${JSON.stringify(result.log, null, 2)}\n`).digest("hex"));
    if (!digestWrite.written) lines.push(`noted: ${DIGEST_WORDS.notRecorded(digestWrite.why)}`);
  }
  /* Every report file's sha256, and which finding ids each finding's file holds, into the
   * person's state folder (report-files.ts), so `explain`, `ruled-out` and `fix` print a file only as this assembly
   * wrote it. A refused record is said in one sentence; the report stands. */
  {
    const texts = Object.fromEntries(
      Object.entries(result.report ?? {}).map(([name, text]) => [relativePath(reportDir, (reportPaths as Record<string, string>)[name] ?? join(reportDir, name)), text] as const),
    );
    /* What this report was made from, value-redacted, in the person's state folder
     * (never in the project), its sha256 with the report's line: `decide` writes the report again from it. Where it cannot
     * be kept, the person is told in one sentence. */
    if (!deepRead.ok) lines.push(`${FOR_THE_PERSON} ${WORDS.deeperNotRead(markdownText(deepRead.why))}`);
    let renderInput: { sha256: string } | undefined;
    const keep = (renderKeep as ReturnType<typeof keepRenderInput> | null)?.text({
      names: Object.fromEntries(Object.keys(result.report ?? {}).map((name) => [name, relativePath(reportDir, (reportPaths as Record<string, string>)[name] ?? join(reportDir, name))] as const)),
      files: Object.fromEntries(Object.entries(texts).map(([path, text]) => [path, sha256Of(text)] as const)),
      code: obj(result.log?.summary)?.code ?? null,
    }) ?? { problem: "the assembly kept no input" };
    try {
      if ("problem" in keep) throw new Error(keep.problem);
      const w = writeRenderInput(stateDir, targetAbs, keep.text);
      if ("problem" in w) throw new Error(w.problem);
      renderInput = w;
    } catch (e) {
      lines.push(`${FOR_THE_PERSON} ${WORDS.renderInputNotKept(markdownText((e as Error).message))}`);
    }
    const kept = recordReportFiles(stateDir, targetAbs, reportDir, texts, { log: basename(logPath), findingFiles: result.findingFiles ?? new Map(), ruledOutFiles: result.ruledOutFiles ?? new Map(), ...(renderInput ? { renderInput } : {}) });
    if (!kept.written) lines.push(`${FOR_THE_PERSON} ${WORDS.reportFilesNotRecorded(markdownText(kept.why))}`);
  }
  lines.push(`✔ wrote the evidence log ${relativePath(cwd, logPath) || logPath} and the report ${relativePath(cwd, reportPath) || reportPath}, with ${REPORT_FILES.filter((n) => n !== "report.md").join(", ")} beside it`);
  lines.push(WORDS.reportFindHint);
  // A Dockerfile whose context would copy .legal/ into an image, said once per run.
  const dockerGap = dockerIgnoreGap(targetAbs);
  if (dockerGap) lines.push(dockerGap);
  /* The F-numbers this report showed, added to the person's number list (append-only, in their
   * state folder). Where the state folder refuses it, the person is told why in one sentence; the report stands. */
  if (result.numbers && result.numbers.append.length > 0) {
    const kept = appendStateRecord(stateDir, targetAbs, NUMBER_LIST_KIND, numberLines(result.numbers.append));
    if (!kept.written) numberNotes.push(WORDS.numberListNotKept(markdownText(kept.why)));
  }
  for (const n of numberNotes) lines.push(`${FOR_THE_PERSON} ${n}`);
  lines.push(...notCheckedSummaryLines(result.not_checked ?? [], { logPath: relativePath(cwd, logPath) || logPath, readAgain: result.read_again ?? null }));
  lines.push("  Step 7's re-check over the log has run (the counts above); its outcomes are in the log and the report.");
  // The run's own record of its launches; one that cannot be read names no time (the report is written already).
  let events: LaunchEvent[] = [];
  try {
    if (existsSync(join(launchDir, "launch-events.jsonl"))) events = readLaunchEvents(join(launchDir, "launch-events.jsonl")).events;
  } catch {
    events = [];
  }
  /* The end screen lists findings by place, rule and law:
   * in CI it goes to the report's files only, whatever else is in the environment (declaration.ts `ciSet`), so a Claude
   * Code session run in a job gets its report and leaves none of it in the log. */
  if (ciSet(opts.env ?? process.env)) lines.push(WORDS.endScreenInCi);
  else lines.push(...endScreenLines(result, inputs.findings as Obj, resolve(reportPath), reviewSecondsOf(events), deepCopyEndLines(stateDir, targetAbs, logPath)));
  // Seat reports Claude Code held back reach the person as one plain line at the end (held-reports.ts).
  const held = heldReportsSentence(run.heldReports);
  if (held !== null) lines.push(`${FOR_THE_PERSON} ${held}`);
  return { exitCode: 0, lines };
}

/**
 * How long the AI review took, from the run's launch events: from the first launch to the last part that returned
 * (the mock-up's "Review done in 43 min"). Null where no part was launched or none returned, or a time does not
 * read: then the done line names no time.
 */
export function reviewSecondsOf(events: readonly LaunchEvent[]): number | null {
  let first = Infinity;
  let last = -Infinity;
  for (const e of events) {
    const t = Date.parse(e.at);
    if (!Number.isFinite(t)) continue;
    if (e.event === "launched" && t < first) first = t;
    if (e.event === "returned" && t > last) last = t;
  }
  return Number.isFinite(first) && Number.isFinite(last) && last >= first ? (last - first) / 1000 : null;
}

/** The marker lines of the end of the run's screen, which the skill passes on as they are (SKILL.md step 6). */
export const END_SCREEN_OPEN = "FOR THE PERSON (show the person every line up to END OF SCREEN as it is, in a code block, and nothing in its place):";
export const END_SCREEN_CLOSE = "END OF SCREEN";

/**
 * THE END OF THE RUN'S SCREEN (the mock-up's screen 10). Every count is the
 * program's: the places of the scan by outcome, which add up to the scan's places (the assembly refuses a run where
 * they do not, `candidates_total`), the possible issues by severity, the first three of them with their places, the
 * report's path, what was not read and what found nothing.
 * The done line names how long the review took, from the program's own record of it (`reviewSecondsOf`).
 * The mock-up's "39 M tokens used" is not printed: the program records no count of the tokens a run used (the launch
 * events of a returned part carry none, and a part's transcript holds its final context, not what it used), so the
 * screen claims no figure it does not have.
 */
/**
 * The end screen's lines for the copies of a deeper check's test still in place
 * (crf11d-r2 W3; D3b's `endScreenCopyLines`), each led by its finding's F-number from this folder's number list (its short
 * id where the list has none), one per place. Outside the block's budget and never cut.
 */
export function deepCopyEndLines(stateDir: string | null, target: string, logPath: string): string[] {
  const copies = deepCopiesOnRecord(stateDir, target);
  if (copies.length === 0) return [];
  const numbers = numbersFor(stateDir, target, logPath);
  const seen = new Set<string>();
  const list: CopyOnRecord[] = [];
  for (const c of copies) {
    if (seen.has(c.path)) continue;
    seen.add(c.path);
    const n = numbers.get(c.findingId);
    list.push({ label: n === undefined ? c.short : fNumber(n), path: c.path });
  }
  return endScreenCopyLines(list);
}

export function endScreenLines(result: AssembleResult, findings: Obj, reportPath: string, reviewSeconds: number | null = null, copyLines: readonly string[] = []): string[] {
  const sc = result.end?.screen;
  const d0 = result.end?.counts;
  if (sc && d0) return endScreenRf11(result, d0, sc, findings, reportPath, reviewSeconds, copyLines);
  const c = result.counts;
  const d = result.end?.counts;
  /* The rows of the findings that stand, from report.md's own counts: what is
   * to fix (by level), what needs judgement, and each kind not counted as a problem where it holds any. Words WP3. */
  const held: [number, string, string][] = d
    ? [
        [d.toFix.high + d.toFix.medium + d.toFix.low, "to fix", `${group(d.toFix.high)} high · ${group(d.toFix.medium)} medium · ${group(d.toFix.low)} low`],
        [d.counsel, "for you to decide", "the code alone cannot settle them"],
        ...(d.waiting > 0 ? [[d.waiting, "wait on your answer", `${group(d.questions)} ${plural(d.questions, "question", "questions")}, in the report`] as [number, string, string]] : []),
        ...(d.recorded > 0 ? [[d.recorded, "recorded", "the duty is met or exempt, or a record of processing"] as [number, string, string]] : []),
        ...(d.notShipped > 0 ? [[d.notShipped, "not shipped", "in files that are not part of the shipped product"] as [number, string, string]] : []),
        ...(d.forOperators > 0 ? [[d.forOperators, "for operators", "each organisation that runs it decides"] as [number, string, string]] : []),
        ...(d.folded > 0 ? [[d.folded, "counted with another", "the same processing as a finding to fix"] as [number, string, string]] : []),
      ]
    : [];
  const rows: [number, string, string][] = d ? [...held, [c.not_applicable, "ruled out by Claude", "each with its reason in the report"]] : [
    // Where not every high one is to fix first, the report's count of those beside it.
    [c.violation_candidate, "possible issues", result.end ? `${group(result.end.severities.high)} high${result.end.toFix !== undefined && result.end.toFix !== result.end.severities.high ? ` (${group(result.end.toFix)} to fix first)` : ""} · ${group(result.end.severities.medium)} medium · ${group(result.end.severities.low)} low` : ""],
    [c.needs_human, "for you to decide", "the code alone cannot settle them"],
    [c.not_applicable, "ruled out by Claude", "each with its reason in the report"],
  ];
  if (c.pre_settled > 0) rows.push([c.pre_settled, "settled by answers", "your answers about the product rule them out"]);
  if (c.suppressed > 0) rows.push([c.suppressed, "set aside by step 1", "the report names each one"]);
  rows.push([c.unadjudicated, "not finished", "listed in the report"]);
  const width = Math.max(...rows.map(([n]) => group(n).length));
  const took = reviewSeconds === null ? "" : ` in ${humanSeconds(Math.round(reviewSeconds))}`;
  const out = [END_SCREEN_OPEN, `✔ Review done${took} · ${group(c.candidates_total)} ${plural(c.candidates_total, "place", "places")}`, ""];
  for (const [n, what, note] of rows) out.push(`  ${group(n).padStart(width)}  ${what.padEnd(20)}  ${note}`.trimEnd());
  const first = result.end?.first ?? [];
  if (first.length > 0) {
    out.push("", "  Start with these");
    for (const f of first) out.push(`    ● ${f.title}`, `      ${f.place}`);
  }
  const parts = notReadParts(findings as unknown as Findings);
  out.push(
    "",
    `  ${"Report".padEnd(14)}  ${reportPath}`,
    // The quick scan's 80-column fold, the one function both print through.
    notReadFolded(parts, (items) => `  ${"Not read".padEnd(14)}  ${items.length === 0 ? "none" : items.join(", ")}`),
    `  ${"Found nothing".padEnd(14)}  ${group(parts.silent)} ${plural(parts.silent, "check", "checks")} - that does not mean the code is fine`,
    "",
    "  Possible issues for you to judge, not legal conclusions.",
    END_SCREEN_CLOSE,
    ...copyLines,
  );
  return out;
}

/**
 * The end screen's one line where the state folder used is not the account-home
 * default (the log's `state_folder`), or null. Within the block's budget (Fix first gives up an entry first) and 80
 * columns: a path too long for the line is not cut (a cut could split a value the printed redaction recognises whole);
 * the line then points to the evidence log, which names the folder.
 */
export function stateFolderLine(log: unknown): string | null {
  const sf = obj(obj(log)?.state_folder);
  if (!sf || sf.account_default !== false) return null;
  const line = typeof sf.path === "string" ? `  Records kept in ${valueText(sf.path)}, not the usual folder` : "  Records kept in no state folder: none could be named";
  return [...line].length <= 80 ? line : "  Records kept outside the usual folder; the evidence log names it";
}

/**
 * THE END SCREEN OF A FIRST RUN (delivery design rf11, 3.1; mock M1): the done line, the laws
 * line, the two count groups each led by its total, Not checked in the person's terms, one blank line, Fix first (three
 * entries, or two where the set-aside row is shown), the Say line and the disclaimer: a block of at most 24 lines of at
 * most 80 columns. The report's absolute path follows the block on its own line (VS Code's terminal opens a path it can
 * find, and an absolute one is found wherever Claude Code was started).
 */
function endScreenRf11(result: AssembleResult, d: DispositionCounts, sc: NonNullable<EndSummary["screen"]>, findings: Obj, reportPath: string, reviewSeconds: number | null, copyLines: readonly string[]): string[] {
  const c = result.counts;
  const toFix = d.toFix.high + d.toFix.medium + d.toFix.low;
  const took = reviewSeconds === null ? "" : ` · AI review ${humanSeconds(Math.round(reviewSeconds))}`;
  const block: string[] = [];
  const fit = (line: string): string => (line.length <= 80 ? line : `${line.slice(0, 79)}…`);
  block.push(fit(`WolfBoy · ${sc.project}${sc.day ? ` · ${sc.day}` : ""}${took}, ${sc.review ?? (sc.once ? "each place once" : "findings to fix twice")}`));
  block.push(fit(`Laws: ${sc.laws.join(" · ")}`));
  /* (design 3.2.1; mock M8) A later run's since block: three rows under
   * "Since <date>", and one more naming a high finding that is lower or gone; one row where the run could not compare. */
  const L = sc.later;
  if (L) {
    const label = `  Since ${L.day || "then"}`.padEnd(15);
    const since = (what: string, n: number, note: string): string => fit(`${label}${what.padEnd(14)}${group(n).padStart(5)}  ${note}`.trimEnd());
    if (!L.compared) block.push(fit(`${label}not compared: ${L.why || "the earlier log holds no comparison basis"}`));
    else {
      block.push(since("new or higher", L.up, L.up === 0 ? "" : L.items.length >= L.upListed && L.upDecided === 0 ? "listed below" : "in the report"));
      block.push(since("lower or gone", L.down, L.downParts).replace(label, " ".repeat(15)));
      if (L.highDown) block.push(`${" ".repeat(17)}${cutTitle(L.highDown, 80 - 17)}`);
      block.push(since("unchanged", L.same, "same list, level and places").replace(label, " ".repeat(15)));
    }
  }
  const row = (n: number, what: string, note: string): string => fit(`  ${group(n).padStart(5)}  ${what.padEnd(12)}  ${note}`.trimEnd());
  block.push(`  Needs your action: ${group(toFix + d.counsel + d.waiting)}`);
  // Mock M8: "· 2 decided by you" inside the same row; the row's number never changes.
  block.push(row(toFix, "to fix", `${group(d.toFix.high)} high · ${group(d.toFix.medium)} medium · ${group(d.toFix.low)} low${sc.decided.toFix > 0 ? ` · ${group(sc.decided.toFix)} decided by you` : ""}`));
  block.push(row(d.counsel, "to clarify", sc.decided.counsel > 0 ? `${group(sc.decided.counsel)} decided by you · law, or code the AI could not read` : "a point of law, or code the AI could not read"));
  block.push(row(d.waiting, "to answer", d.waiting > 0 ? `${group(d.questions)} ${d.questions === 1 ? "question settles" : "questions settle"} them: "review my answers"` : "no question open"));
  const setAside = c.suppressed;
  block.push(fit(`  Taken off the list: ${group(sc.ruledOut + sc.outOfScope + setAside + sc.notCounted)}, by one AI review each or by your answers`));
  block.push(row(sc.ruledOut, "ruled out", "by that one review; it can miss a real problem"));
  if (sc.outOfScope > 0) block.push(row(sc.outOfScope, "out of scope", answersUsedOf(result.log)?.whose === "team" ? WORDS.scopeByTeamEnd : "by your answers about the product"));
  if (setAside > 0) block.push(row(setAside, "set aside", "by the scanner, not reviewed"));
  if (sc.notCounted > 0) block.push(row(sc.notCounted, "not counted", "met · not shipped · for operators · same as another"));
  const parts = notReadParts(findings as unknown as Findings);
  const pad = " ".repeat(15);
  // One place is one location, a file and a line: "1 place", never "1 places".
  block.push(fit(`  Not checked  ${group(sc.noVerdict)} ${sc.noVerdict === 1 ? "place" : "places"} without a verdict · ${group(sc.partly)} ${sc.partly === 1 ? "finding" : "findings"} the AI read only in part`));
  // (as mock M8 shows it): the carried count, as the first screen's Not checked item.
  if (sc.carried > 0) {
    block.push(fit(`${pad}${group(sc.carried)} ${sc.carried === 1 ? "verdict" : "verdicts"} carried from ${sc.carriedFrom || "the earlier run"}, not re-read in this one`));
    // A marked log is named on a row of its own, so the line keeps to 80 columns.
    if (sc.carriedMark) block.push(fit(`${pad}  its log ${sc.carriedMark}`));
  }
  block.push(fit(`${pad}${group(sc.silent)} ${sc.silent === 1 ? "rule" : "rules"} found nothing, which is not a clean result`));
  // What the walker did not open is counted here too (`notReadAll`), as on the quick scan's screen.
  const allNotRead = notReadAll(parts);
  block.push(fit(`${pad}not read: ${allNotRead.length === 0 ? "none" : `${allNotRead.slice(0, 3).join(", ")}${allNotRead.length > 3 ? `, and ${allNotRead.length - 3} more` : ""}`}`));
  block.push(`${pad}privacy policy not compared: say "compare my privacy policy"`);
  // One line, only where the records were kept outside the account-home default.
  const folderLine = stateFolderLine(result.log);
  if (folderLine !== null) block.push(folderLine);
  // The block holds at most 24 lines (31 on a later run, design 3.2.1): Fix first gives up entries before anything else does.
  const tail = 3; // the Say line, the disclaimer, and the blank line before Fix first
  const upMode = !!L && L.compared;
  const stillRows = upMode && L.still.first ? 2 : 0;
  const room = Math.max(0, Math.floor(((upMode ? 31 : 24) - block.length - tail - 1 - stillRows) / 2));
  const shown = sc.fixFirst.slice(0, Math.min(3, room));
  block.push("");
  if (upMode) {
    // (mock M8): what is new or higher, then the first finding still to fix.
    const items = L.items.slice(0, room);
    // Every new or higher finding decided by you (design 3.4).
    if (L.upListed === 0) block.push(L.up > 0 ? "  New or higher: each one decided by you, all in the report" : "  Nothing new or higher this run");
    else block.push(fit(`  New or higher${items.length < L.upListed ? ` (${items.length} of ${group(L.upListed)} shown, all in the report)` : ""}`));
    for (const e of items) {
      const lead = `  ${e.clarify ? "\u25c7" : "\u25c6"} ${e.f} ${e.short}  `;
      block.push(`${lead}${cutTitle(e.title, 80 - lead.length)}`);
      block.push(fit(`${" ".repeat(lead.length)}${e.place}${e.more > 0 ? ` +${group(e.more)} ${e.more === 1 ? "place" : "places"}` : ""}${e.note ? ` · ${e.note}` : ""}`));
    }
    if (L.still.first) {
      block.push(fit(`  Still to fix from earlier reviews: ${group(L.still.n)} (${group(L.still.high)} high), all in the report; first:`));
      const lead = `    ${L.still.first.f} ${L.still.first.short}  `;
      block.push(`${lead}${cutTitle(L.still.first.title, 80 - lead.length)}`);
    }
    const f = items[0]?.f ?? L.still.first?.f ?? "F1";
    block.push(fit(`  Say: "what changed" · "explain ${f}" · "decide ${f}" · "look deeper at ${f}"`));
    block.push("  Possible issues for you to judge, not legal conclusions.");
    return [END_SCREEN_OPEN, ...block, END_SCREEN_CLOSE, ...copyLines, `Report: ${reportPath} ${WORDS.reportPathEnd}`];
  }
  // Never "nothing to fix": no product output is a pass. Every finding to fix is decided by you, so none is listed; each still stands.
  if (shown.length === 0) block.push(sc.decided.toFix > 0 ? "  Fix first: each finding to fix is decided by you; see the report" : "  Fix first: no finding to fix stands in this scan");
  else {
    const total = Math.min(3, sc.fixFirst.length);
    const head = `  Fix first${shown.length < total ? ` (${shown.length} of ${total} shown, all in the report)` : ""}${sc.startsAt !== null ? ` · F-numbers start at F${sc.startsAt}, see the report` : ""}`;
    block.push(fit(head));
    for (const e of shown) {
      const lead = `    ${e.f} ${e.short}  `;
      block.push(`${lead}${cutTitle(e.title, 80 - lead.length)}`);
      block.push(`${" ".repeat(lead.length)}${e.place}${e.more > 0 ? ` +${group(e.more)} ${e.more === 1 ? "place" : "places"}` : ""}`);
    }
  }
  const f1 = shown[0]?.f ?? "F1";
  block.push(fit(`  Say: "explain ${f1}" · "fix ${f1}" · "decide ${f1}" · "look deeper at ${f1}"`));
  block.push("  Possible issues for you to judge, not legal conclusions.");
  return [END_SCREEN_OPEN, ...block, END_SCREEN_CLOSE, ...copyLines, `Report: ${reportPath} ${WORDS.reportPathEnd}`];
}

/**
 * THE TERMINAL'S LINES ON PLACES NO REVIEW READ: the total, then one line per finding with its count and
 * the files they are in, and whether its "not applicable" holds only for the places read. Nothing where every finding's
 * record names none.
 */
export function notCheckedSummaryLines(found: NotCheckedFinding[], later: { logPath?: string; readAgain?: ReadAgainTotal | null } = {}): string[] {
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  /* The later reading's total, before the places still not checked. */
  const t = later.readAgain;
  const head = t
    ? [
        `  Asked to be read again: ${t.checked} of the ${plural(t.previous, "place")} not checked in ${earlierRunWords(t.scans, { who: "you", path: t.named })} ${t.checked === 1 ? "was" : "were"} opened and checked in this run` +
          (t.settled > 0 ? `; ${t.settled} ${t.settled === 1 ? "was" : "were"} settled from the form of the matched line alone, without being opened` : "") +
          (t.unanswered_findings > 0 ? `; ${plural(t.unanswered_findings, "finding")} with ${plural(t.unanswered_places, "place")} of them ${t.unanswered_findings === 1 ? "has" : "have"} no answer in this run.` : "."),
      ]
    : [];
  if (found.length === 0) return head;
  const total = found.reduce((n, f) => n + f.places, 0);
  const lines = [
    ...head,
    `  Not checked: ${plural(total, "place")} in ${plural(found.length, "finding")} ${total === 1 ? "was" : "were"} not read in this run, and nothing is known about ${total === 1 ? "it" : "them"}. The report lists each one beside its finding and under "Places not checked":`,
  ];
  for (const f of found) {
    const files = f.files.length <= 3 ? f.files.join(", ") : `${f.files.slice(0, 3).join(", ")} and ${plural(f.files.length - 3, "more file")}`;
    lines.push(`    ${f.rule_id} ${f.finding_id}: ${plural(f.places, "place")}${files ? ` in ${files}` : ""}${f.not_applicable ? `; its "not applicable" holds only for the places that were read` : ""}`);
  }
  if (later.logPath) lines.push(`  To have them read, run the scan again and, when it asks for your earlier run, name this run's evidence log: ${later.logPath}`);
  return lines;
}

/** The CLI registration, kept here so the shared `index.ts` carries one line for it. */
export function registerAssembleReport(program: Command): void {
  program
    .command("assemble-report")
    .description(
      "Assemble the evidence log and the person's report after verdict-verify (SKILL.md steps 5-7): derive the assembled copies from the seats' answers again and require --verdicts to be exactly those, run the quote check over them itself (with --findings and every premise block required) and require --quotes to be that check's report, merge the refutations, keep every record the check invalidated as it left it, and write both files — or write neither and name every record that is missing, unchecked, changed or contradicted. Exit 0 wrote, 1 an input could not be read, 5 refused.",
    )
    .requiredOption("--findings <file>", "the scan's findings.json")
    .requiredOption("--plan <file>", "the pre-launch plan (.legal/adjudicate-plan.json)")
    .requiredOption("--verdicts <dir>", "the assembled verdicts directory verdict-reading --assemble-into wrote (.legal/verdicts-assembled); it must be exactly what verdict-reading makes from --raw-verdicts")
    .requiredOption("--quotes <file>", "the quote check's report (.legal/verdict-quotes.json); compared with the check this command runs itself, and never used as input")
    .requiredOption("--target <dir>", "the tree the scan read: the quote check this command runs reads it, and the premise blocks are taken over it")
    .option("--bundle <dir>", "the rule bundle the scan ran, for the premise blocks; default: LEGAL_BUNDLE_DIR, else the bundle shipped with this program")
    .option("--raw-verdicts <dir>", "the directory the seats' answers were written to (.legal/verdicts). Required: without it the command refuses (raw-verdicts-missing). Where <legal>/capture/ledger.jsonl exists it must be <legal>/verdicts, and every file in it must be in that ledger")
    .option("--readers <dir>", "readers' replies outside the verdicts directory (.legal/readers), as verdict-reading --readers takes them")
    .option("--carried <dir>", "the carried verdicts (.legal/verdicts-carried)")
    .option("--legal <dir>", "the .legal directory the plugin's hooks and verdict-capture write to: its capture/ledger.jsonl and capture/hook-ledger.jsonl are read (default: the parent of --raw-verdicts)")
    .option("--launch-dir <dir>", "the run's launch directory: its launch list, launch events, active-run marker and run-shape answer are read, and its active run is ended after an assembly that wrote or refused (default: <legal>/launch)")
    .option("--shape <shape>", "outside Claude Code only: the run shape the person chose in step 3l (full, important or refute_later); it must be the launch list's where one exists. In a hooked run, or inside Claude Code, it is refused: the shape is the person's answer the hook recorded")
    .option("--chosen-by <who>", "outside Claude Code only, with --shape: user where the person was asked and answered, default where nobody could be")
    .option("--out-log <file>", "where the evidence log goes: a .json file under a .legal/evidence/ directory, where step 3k reads previous logs; anywhere else is refused (default .legal/evidence/scan-<ISO8601>.json)")
    .option("--out-report <folder>", "the folder the report's files go in: report.md, not-checked.md, ruled-out.md and laws.md, with one file per finding that stands under findings/ and one per ruled-out rule under ruled-out/ (default .legal/reports/scan-<ISO8601>/; a path ending in .md names report.md and the others go beside it); refused under .legal/evidence/, which step 3k reads as previous logs. The log and every report file are written, or none")
    .option("--completed-at <iso>", "the completion time to record (default now)")
    .action((opts) => {
      const { exitCode, lines } = runAssembleReport({
        findings: opts.findings as string,
        plan: opts.plan as string,
        verdicts: opts.verdicts as string,
        quotes: opts.quotes as string,
        carried: opts.carried as string | undefined,
        legal: opts.legal as string | undefined,
        launchDir: opts.launchDir as string | undefined,
        rawVerdicts: opts.rawVerdicts as string | undefined,
        readers: opts.readers as string | undefined,
        target: opts.target as string,
        bundle: opts.bundle as string | undefined,
        shape: opts.shape as string | undefined,
        chosenBy: opts.chosenBy as string | undefined,
        outLog: opts.outLog as string | undefined,
        outReport: opts.outReport as string | undefined,
        completedAt: opts.completedAt as string | undefined,
      });
      process.stdout.write(`${lines.join("\n")}\n`);
      process.exitCode = exitCode;
    });
}
