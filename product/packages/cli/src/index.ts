#!/usr/bin/env node
import "./install-guard-on.js"; // FIRST of all: no package from outside the shipped install
// NEXT, before any other module of the CLI runs: every write to stdout and stderr of this process, and an
// uncaught error's stack, goes through the printed redaction (printed-output.ts). The import is evaluated before the
// others, and the module only installs when `installPrintedRedaction` is called, here.
import { installPrintedRedaction, printedForm, valueText } from "./printed-output.js";
import { Command, Option } from "commander";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { appendFileAt, declareProjectFolder, makeFolder, removePath, writeFileAt } from "./project-write.js";
import { claudeOfEditorExtension, foldersNoProgramComesFrom, programOnPath, programStart, spawnStart } from "./child-program.js";
import { CLAUDE_CODE_FLOOR, claudeCodeVersion } from "./claude-version.js";
import { gitBashForSession } from "./git-bash.js";
import { ownPackageFacts, pluginEntriesOf, pluginNameOf, sessionCopy, type PluginEntry } from "./session-copy.js";
import { ownPackage, ownPlugin } from "./scanner-command.js";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { relativePath } from "./project-path.js";
import { BUNDLE_DIR_ENV, type LoadedBundle, loadBundle, openBundle, selectRules } from "./bundle.js";
import { redactStringsInPlace, type PrintedRedaction } from "./credential-redaction.js";
import { annotateLocatables, loadPillar1Index } from "./join.js";
import { buildReconcileInput, DEFAULT_FETCH_TIMEOUT_SECONDS, MAX_DOCUMENT_BYTES, MAX_FETCH_TIMEOUT_SECONDS, parseFetchTimeout, reconcileExitCode, summarizeReconcile } from "./reconcile.js";
import {
  quoteVerificationExitCode,
  summarizeQuoteVerification,
  verifyDeclarationQuotes,
} from "./reconcile-verify.js";
import {
  RECONCILE_DIFF_DISCLAIMER,
  ReconcileDiffRefusal,
  buildReconcileDiff,
  readRunArtifacts,
  reconcileDiffExitCode,
  summarizeReconcileDiff,
} from "./reconcile-diff.js";
import {
  jobsFromVerdictsDir,
  SEAT_CLASS_WORDS,
  summarizeVerdictQuotes,
  verdictQuoteExitCode,
  verifyVerdictQuotes,
} from "./verdict-verify.js";
import { recoveryFor } from "./recovery.js";
import { spawnSync } from "node:child_process";
import {
  EFFORT_LEVELS,
  EFFORT_LEVEL_ENV,
  WITHOUT_PROFILE_ENV,
  profileRecord,
  profileRefusal,
  profiledLaunch,
  sessionEffort,
  startEffort,
  startScreenLines,
} from "./scan-profile.js";
import { registerVerdictCapture } from "./verdict-capture.js";
import { examinedRecords, registerLaunchLater } from "./launch-later.js";
import { registerRelaySeat, relayNotOffered } from "./relay-seat.js";
import {
  assembleReadingForVerdicts,
  kindCensusOf,
  parseReaderReply,
  readersAccountOf,
  seatInputsFor,
  seatRowsOfVerdict,
  unattributedRecordProblem,
  type ReaderReply,
  type ReadingReadRow,
  type ReadingSearchRow,
} from "./reading.js";
import { answersFromApplicability, buildRestsOn, ORIENTATION_SCAN_FILE, orientationScanText, orientationSheetBeside, TreeReader, type RestsOn } from "./rests-on.js";
import { assembledCopies, premiseInputs, type PremiseInputs } from "./reading-assembly.js";
import { foldOfPlaces, placeTableOf, placeTablePath, writePlaceTable } from "./place-fold.js";
import { isPlacePlanCandidate } from "./place-reply.js";
import { launchDirBeside, planOfLaunchDir, readingInputsOfRun } from "./run-reading.js";
import { adjudicatePlan, assertFindingsUsable, derivedFileContent, PreviousRunUnreadable, readPreviousRun, type PreviousRun } from "./adjudicate-plan.js";
import { earlierRunWords, isRunLabel } from "./carry-forward.js";
import { VERDICT_RULES_VERSION, verdictRulesAlikeWords, verdictRulesJudgedAs } from "./instructions.js";
import { programFileBytes, readNamedFile } from "./program-file.js";
import { launchRecordPath } from "./state-record.js";
import { writeFindingsJson } from "./findings-writer.js";
import { readLaunchList } from "./launch-list-file.js";
import { ContextWindowOptionError, resolveContextWindow, writeContextPayloads } from "./context.js";
import { costPreviewLines } from "./cost-preview.js";
import { preLaunchLines, preLaunchPlan } from "./pre-launch.js";
import { askInputLines, ORCHESTRATOR_RESERVED_PLACES, PLATFORM_SUBAGENT_LIMIT, PLUGIN_NAME, RESERVE_FLAG, SUBAGENT_LIMIT_ENV, deepTracked, shapeFigures, subagentLimitFrom, laterRunOf, lineSafeJson, preLaunchTexts, readLaunchEvents, runStatus, type LaunchList, type RunStatus } from "./launch-plan.js";
import { endDeepCheck } from "./hook.js";
import { noteScannedFolder, processStateDir, realOfNearest } from "./start-record.js";
import { FINDINGS_DIGEST_WORDS, FindingsChanged, findingsDigestName, planDigestName, readFindingsText, recordLogDigest, stateFolderPlaceNote } from "./log-digest.js";
import { PLAN_DIGEST_WORDS } from "./assemble-report.js";
import { agentFileEffort, seatPins } from "./seat-effort.js";
import { EVIDENCE_DIR_NAME, EVIDENCE_LOG_NAME, guardWorkingFolder, legalDirOf, legalFoldersNamed, legalFoldersOnlyRead, legalIgnoreLeaks, prepareOutputFolder, nothingWrittenWords, readOnlyInput } from "./legal-dir.js";
import {
  LEGAL_DIR_NAME,
  SESSION_ENV,
  activeRunLines,
  dueWithoutPerson,
  effortChangeLine,
  endActiveRun,
  lastRunEnd,
  latestRunEndAt,
  launchDirRefusal,
  launchGateLines,
  launchGateSummary,
  markerSessionRefusal,
  readActiveRun,
  runEffortChanges,
  writeActiveRun,
  writeLegalIgnore,
} from "./hook-launch.js";
import { earlierRunStep } from "./earlier-run.js";
import { abortRefusal, entriesLeft, launchInput, launchNowLines, readNextLaunches, type NextRead, type RelaunchOf } from "./hook-launch.js";
import { keptInvalidFindings, keptInvalidOf, readAnswerLedgers, relaunchable, type AnswerLedgers } from "./entry-answer.js";
import { readHookedRun, supersededRefutationFiles } from "./assemble-hooked.js";
import { REFUSALS_MAX } from "./hook-capture.js";
import { FOR_THE_PERSON, launchHostOf, otherConversationText, programVersionSentence, refuterEntriesDueFor, relayRefusedSinceResume, resumedSentence, scannerCommand, shapeFlagRefusal, stopBar } from "./hook-launch.js";
import { CLAUDE_CODE_SESSION_ENV, PROJECT_ENV, claudeCodeSigns, hooksNotRunningRefusal, recordedLaunchDirRefusal } from "./hook-launch.js";
import { adjudicatePlanDigestName, commandNamedPaths, commandPaths, commandSessions, earlierRunChosenName, noteCommandSessions, pluginSessionsAround, previousVouchRefusal, recordSessionScan } from "./plugin-sessions.js";
import {
  askedText,
  choices,
  CI_ENV,
  ciSet,
  currentRows,
  DECLARATION_PROFILE_FILE,
  DECLARATION_RECORD_FILE,
  declarationPlan,
  figures,
  questionScreenLines,
  writeDeclarationPlan,
  firstRound,
  hintsFor,
  jurisdictionsOf,
  loadDeclarationSource,
  mergeRows,
  plannedQuestions,
  NOT_ASKED_LATER,
  QUESTIONS_PER_ROUND,
  readDeclaration,
  scopeSettlementsOf,
  staleOrderFields,
  addedAsked,
  askedBeforeReview,
  questionsRaisedOf,
  REVIEW_DECLARATION_FLAG,
  rowFor,
  savedAnswers,
  selectQuestions,
  setAsideNote,
  setAsideUnconfirmed,
  TerminalAsker,
  usable,
  writeDeclaration,
  type AnswersUsed,
  type DeclarationSource,
  type PlannedQuestion,
  type ReadDeclaration,
  type RecordRow,
  reviewDeclarationCommand,
  answersWrittenLine,
} from "./declaration.js";
import {
  DECLARATION_QUESTION_FILE,
  removeRelayRecord,
  declarationAsking,
  declarationOutstanding,
  withdrawDeclarationRound,
  PASS_EXACTLY,
  markDeclarationAnswerUsed,
  recordDeclarationQuestion,
  recordDeclarationScan,
  recordDeclarationScanClosed,
  takeDeclarationAnswer,
  confirmationOutstanding,
  loadConfirmationQuestion,
  markConfirmationUsed,
  takeConfirmation,
  writeConfirmationQuestion,
  type AskQuestion,
  type LoadedDeclarationQuestion,
  type TakenDeclaration,
} from "./hook-question.js";
import { commitFactsOf, confirmTeamAnswers, NOT_NOW, TEAM_ANSWERS_PURPOSE, teamAnswersQuestion, teamAnswersState, USE_THEM, type TeamState } from "./team-answers.js";
import { loadScanProfile } from "./profile.js";
import { contradictionSentence, manifestNamesOf, nameWordsOf, ownNamePremiseOf, SELF_NAME_RULES, vendorSoftwareOf } from "./own-name.js";
import { profileDigest } from "./scan.js";
import {
  KindCensusOptionError,
  PackGroupsOptionError,
  censusSilentRules,
  prepareScan,
  resolveKindCensus,
  resolvePackGroups,
  runScan,
  runScanSharded,
  summarize,
} from "./scan.js";
import {
  buildRopa,
  renderExportReadme,
  renderCustomFieldsCsv,
  renderOpenQuestionsCsv,
  renderProcessingActivitiesCsv,
  renderUnknownRulesCsv,
  summarizeRopa,
  type DeclarationsInput,
  type RopaInput,
} from "./ropa.js";
import { RECORD_DOCUMENT_FILENAME, renderRopaDocument } from "./ropa-docx.js";
import { ownFilesInsideTarget, ownFilesRefusal } from "./own-install.js";
import { PROGRAM_NAME, PROGRAM_VERSION } from "./identity.generated.js";
import { GITHUB_GZIP_BYTES_PER_FILE, GITHUB_RESULTS_PER_RUN, sarifPartPath, splitSarifForGithub, toSarif } from "./sarif.js";
import {
  answerFileAnnotations,
  ciText,
  ciShownCopy,
  changedLinesOrWhy,
  ciSummaryText,
  appendStepSummary,
  countedPlaces,
  ciBase,
  eventFacts,
  onChangedLines,
  placesAtOrAbove,
  postCheckRun,
  stopWorkflowCommands,
  workflowFile,
  GITHUB_ACTIONS_ENV,
  GITHUB_EVENT_NAME_ENV,
  GITHUB_STEP_SUMMARY_ENV,
  type ChangedLines,
  type CiOutcome,
} from "./ci-check.js";
import {
  testRules,
  formatTestResults,
  checkDeliveryEndToEnd,
  checkFixtureNaming,
} from "./test-rules.js";
import {
  declaresStructuralChecks,
  resolveFileBudgetMs,
  resolvePrefilterRuntimeOptions,
  FileBudgetOptionError,
  PrefilterOptionError,
  PrefilterSelfCheckFailure,
  compileRules,
  productPrintedRedaction,
} from "./engine.js";
import { parseReadOption } from "./read-scope.js";
import { OrientationOptionError, renderOrientationMarkdown, resolveOrientation } from "./orientation.js";
import { orientationSheetFor } from "./orientation-inputs.js";
import { JobsOptionError, resolveJobs, type ResolvedJobs } from "./engine-pool.js";
import { createProgress, ProgressOptionError, resolveProgressDetail, resolveProgressMode } from "./progress.js";
import {
  candidateLineCount,
  candidateTopics,
  dividerLines,
  bundleNamedLines,
  firstScreenLines,
  screenAgainLines,
  NEXT_STEP_WORDS,
  nextStepLines,
  notShippedWords,
  QUICK_SCAN_DETAIL_FILE,
  ReportDetailOptionError,
  resolveReportDetail,
  SHIPPED_WORDS,
} from "./report.js";
import { grammarReport, prepareStructural } from "./structural/index.js";
import {
  ANSWERS_FILE,
  ANSWER_INPUT_FILE,
  INGEST_FILE,
  ITEMS_FILE,
  QUESTIONNAIRE_DISCLAIMER,
  QuestionnaireRefusal,
  answerVerificationExitCode,
  assembleAnswerInput,
  exportAnswers,
  exportExitCode,
  ingestExitCode,
  ingestQuestionnaire,
  questionnaireDir,
  readStoredQuestionnaire,
  samePath,
  isQuestionnaireRecordFile,
  slugify,
  summarizeAnswerVerification,
  summarizeAssemble,
  summarizeExport,
  summarizeIngest,
  validateAnswersDocument,
  verifyAnswerQuotes,
} from "./questionnaire.js";
import { validateAgainstSchema } from "./schema-validate.js";
import { registerAssembleReport } from "./assemble-report.js";
import { registerExplain } from "./explain.js";
import { registerDecide } from "./decisions.js";
import { registerDeepen } from "./deepen.js";
import { rerenderLatestReport } from "./report-render.js";
import { registerRecord } from "./record.js";
import type {
  DeclarationsReport,
  Findings,
  QuestionnaireAnswers,
  ReconcileInput,
  Rule,
} from "wolfboy-schemas";
import { readRegularFile } from "./project-read.js";
import { atOrInside, locate } from "./file-identity.js";

installPrintedRedaction();

/**
 * Start the parser runtime and load the grammars, but only when the bundle contains a rule that
 * asks to be read structurally.
 *
 * This is the one await the structural reading needs, and it is here rather than inside the scan
 * because `runScan` is synchronous and two gate tools consume it synchronously — making it async
 * would have them read a promise as a findings object and report nothing, which is precisely the
 * silent reduction the structural design is built against. See structural/grammars.ts.
 */
async function prepareStructuralIfDeclared(bundle: { rules: Rule[] }): Promise<void> {
  if (declaresStructuralChecks(bundle.rules)) await prepareStructural();
}

/**
 * What follows `jobs: N` on the provenance line the `scan` command prints.
 *
 * Five shapes, each of which tells a reader comparing two runs something the number alone does not:
 * `jobs: 4` (typed), `jobs: 4 (auto)`, `jobs: 1 (sequential)` — typed, and a different code path
 * rather than a pool of one — `jobs: 1 (auto, sequential)` when this machine's cores or memory left
 * room for one, and `jobs: 1 (auto: tree below 256 KB, sequential)` when the TREE was the reason.
 * The last is worth its words: a person on a twelve-core box who sees one worker would otherwise
 * have no way of telling a small tree from a misdetected machine.
 */
function jobsLineSuffix(jobs: ResolvedJobs): string {
  const parts = [
    jobs.auto ? (jobs.autoNote === null ? "auto" : `auto: ${jobs.autoNote}`) : "",
    jobs.jobs === 1 ? "sequential" : "",
  ].filter((p) => p !== "");
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}

const DISCLAIMER =
  "This output is informational only and does not constitute legal advice. It identifies code that may not meet a cited standard and that requires human review; consult qualified counsel before acting on it.";

/**
 * What the filesystem can say about `--target` before anything is read into it, as one sentence, or
 * `""` when the path is an ordinary directory.
 *
 * **This lives in one place because it belongs on every path, and until 2026-08-24 it was emitted
 * only inside the `--fail-on` branch.** A mistyped `--target` without `--fail-on` printed
 * "56 ran over this tree and matched nothing … so their silence is about the layout of this
 * repository", then "No detector matched anything in this tree", and exited 0 — about a repository
 * that does not exist. The exit code is a separate question and it is deliberately NOT changed here:
 * refusing a missing path outright would change the exit code of every run that passes no
 * `--fail-on`, which is a behaviour change beyond this repair. What was free to fix, and is fixed,
 * is the wording — a run that reached no filesystem at all now says so wherever it speaks.
 */
function targetPathProblem(targetRoot: string): string {
  if (!existsSync(targetRoot)) {
    return (
      `The target path ${targetRoot} does not exist, so this is not a statement about any ` +
      `repository — check the --target argument.`
    );
  }
  if (!statSync(targetRoot).isDirectory()) {
    return (
      `The target path ${targetRoot} is not a directory, so there was no tree to walk — ` +
      `check the --target argument.`
    );
  }
  return "";
}

/**
 * `--rules` applied, or the bundle unchanged when the option was not given.
 *
 * The selection itself is `selectRules` (bundle.ts); the only thing this adds is the CLI's own
 * convention for a caller's mistake — the message on stderr and exit 1, the same pair `--fail-on-unreviewed`
 * uses a few lines below for an unreadable level. It is written as a function rather than a
 * try/catch inside the action so that the action keeps one statement per step.
 */
function narrowToNamedRules(bundle: LoadedBundle, spec: string | undefined): LoadedBundle {
  if (spec === undefined) return bundle;
  try {
    return selectRules(bundle, spec);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

/**
 * `--read` applied, or the product default when the option was not given.
 *
 * The parsing is `parseReadOption` (read-scope.ts); the only thing this adds is the CLI's own
 * convention for a caller's mistake — the message on stderr and exit 1, the pair `--rules` and
 * `--fail-on-unreviewed` already use. Written as a function, like `narrowToNamedRules` above, so the action
 * keeps one statement per step.
 */
function readClasses(bundle: LoadedBundle, spec: string | undefined): Set<string> {
  try {
    return parseReadOption(spec, Object.keys(bundle.readScope?.classes ?? {}));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

/**
 * Run one command's engine work so that the prefilter's two ways of stopping a run reach the person
 * as a message rather than as a Node stack trace, and reach them IDENTICALLY on every command that
 * can get there (the handling once existed on `scan` alone, while
 * `test-rules` — which reaches `runBuiltin` through `testRules` -> `runScan`, twice — would have
 * printed a stack).
 *
 * The commands that reach `runBuiltin` are exactly `scan` and `test-rules`. `reconcile` and its
 * family run `runCensus` instead, which is a separate set of collectors with their own `exec()`
 * passes and no prefilter anywhere in them (census.ts states why the engine is not reused for it),
 * and no other command reads a target tree at all — so there is no third site to cover.
 *
 * - `PrefilterSelfCheckFailure` is the §E.3 abort. Its message is already the complete four-line
 *   report the person is asked to send back, so nothing is added to it here beyond the exit itself.
 * - `PrefilterOptionError` is a switch handed a value it cannot act on
 *   (`PRODUCT_CLI_PREFILTER_SELFCHECK=banana`). Nothing has been read when it is thrown.
 * - `FileBudgetOptionError` is the same for `--file-budget`, and is thrown before the walk for the
 *   same reason `--jobs` is: a value this CLI cannot act on must be refused now rather than after a
 *   tree has been read.
 */
function engineFailure(e: unknown): never {
  if (
    e instanceof PrefilterSelfCheckFailure ||
    e instanceof PrefilterOptionError ||
    e instanceof JobsOptionError ||
    e instanceof FileBudgetOptionError ||
    e instanceof ProgressOptionError ||
    e instanceof ReportDetailOptionError ||
    e instanceof PackGroupsOptionError ||
    e instanceof KindCensusOptionError ||
    e instanceof ContextWindowOptionError ||
    e instanceof OrientationOptionError
  ) {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  }
  throw e;
}

function throughTheEngine<T>(work: () => T): T {
  try {
    return work();
  } catch (e) {
    return engineFailure(e);
  }
}

/**
 * The same handling for the sharded path. `--jobs 2` and above returns a promise — the engine runs
 * in worker threads and the main thread waits — and a `PrefilterSelfCheckFailure` raised inside a
 * worker reaches this `catch` as the same class, re-raised by `engine-pool.ts` from the typed
 * message the worker sent home. So the scan stops the same way at `--jobs 1` and at `--jobs 8`: the
 * same four-line report in the same form, the same exit 1, and no document either way; a worker
 * cannot die quietly.
 *
 * WHAT IS NOT IDENTICAL, MEASURED. When SEVERAL skips are
 * unsound, WHICH ONE is named first is a race between the workers — one broken build named
 * `ai-transparency-008 clause 9` at `--jobs 1` and `ai-transparency-001 clause 14` at `--jobs 4`.
 * Both are true reports of the same defect, the instruction in them is the same ("re-run with
 * --no-prefilter"), and the SET the self-check samples is identical at every `--jobs` (the sampler's
 * own note in prefilter.ts). It is left as it is, and written down here rather than in a claim that
 * the two runs print the same text.
 */
async function throughTheEngineAsync<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    return engineFailure(e);
  }
}

// ------------------------------------------------------------------------------------------------
// THE DECLARATION QUESTIONS AT THE SCAN.
// The program asks after the first result:
// inside a Claude Code session through the question relay (a round of at most four, taken back with
// --declaration-from-answer), in a terminal all at once, in CI never (CI reads no answers about the product and is never
// stopped by a question, design rf11 3.3), and with no terminal it lists them as not asked. The scan reads a declaration
// only from the program's own file under its record (declaration.ts `usable`); a file it did not write is never an
// answer, and its values are shown beside the questions only as labelled hints.

type DeclarationPath = "session" | "ci" | "terminal" | "no-terminal";
interface DeclarationContext {
  /** Never "ci": in CI declarationBeforeScan returns "ci" before any context is built (design rf11 3.3). */
  path: Exclude<DeclarationPath, "ci"> | "claude-code";
  source: DeclarationSource;
  /** The declaration directory (R4): the directory of --out, `.legal` by default; the relay's files in its launch/. */
  dir: string;
  /**
   * Whether the scan writes its output (--out given). A scan with no --out writes no file, so the
   * declaration plan is written only beside a findings file (the chain of 2026-10-14 found a gate's scan with no --out
   * leaving `.legal/declaration-plan.json` in the directory it ran from).
   */
  writesOutput: boolean;
  launchDir: string;
  jurisdictions: string[];
  declared: ReadDeclaration;
  verdict: ReturnType<typeof usable>;
  /** The scanned folder (--target): the key of the person's confirmation of the saved answers. */
  target: string;
  /**
   * Whether the saved pair (status ok) is confirmed in this folder on this computer
   * (team-answers.ts); null where there is no pair the program wrote. (CI builds no context: no pair is read there.)
   */
  team: TeamState | null;
}
interface DeclarationStep {
  c: DeclarationContext;
  /** The file the first pass reads: the program's declaration where it is usable; outside a session and CI, a --profile. */
  profilePath: string | undefined;
  /** --declaration-from-answer: the round taken, the rows it made, and every row of the declaration written from them. */
  taken: { question: LoadedDeclarationQuestion; fresh: RecordRow[]; rows: RecordRow[] } | null;
  /** Printed at the head of the declaration's block, after the report. */
  notes: string[];
  /**
   * --review-declaration on a plain scan (session or terminal): the saved answers the statement would name are asked
   * again. False on a take (--declaration-from-answer), which carries on the rounds the reviewing scan wrote.
   */
  review: boolean;
  /** A take of the saved answers' question: what the person chose; null otherwise. */
  team: "use" | "not-now" | null;
}
interface ScanPassResult {
  findings: Findings;
  pathProblem: string;
  /**
   * The profile this pass read, as profile.ts `loadScanProfile` handed it to the engine (null where it read none): the
   * declaration the statement of the saved answers names, so that it says what the scan used.
   */
  profile: unknown;
  /** The files the walk offered the rules, relative to the target: what the rules check says it did not read (ci-check.ts). */
  readFiles?: string[];
}

/** Where the questions are asked. Inside a session through the relay, whatever CI says. */
function declarationPathOf(env: NodeJS.ProcessEnv): DeclarationPath {
  if (claudeCodeSigns(env).length > 0) return "session";
  if (ciSet(env)) return "ci";
  return process.stdin.isTTY === true && process.stdout.isTTY === true ? "terminal" : "no-terminal";
}
/**
 * A CLAUDE CODE SHELL WITH NO SIGN OF THE
 * PLUGIN: neither the plugin's session id nor its project folder, which its SessionStart hook exports. No hook of the plugin
 * relays a question there, so the scan takes the path a run with no terminal takes (it asks nothing, scans, and lists the
 * questions it did not ask) and never the plugin's round; --declaration-from-answer, --review-declaration and --profile are
 * refused there as in a session, so no answer about the product reaches the program but from the person. Until 2026-11-10
 * the scan refused here and sent a person who had installed only the CLI to a plugin they did not have.
 */
function pluginlessSession(env: NodeJS.ProcessEnv): boolean {
  const blank = (k: string): boolean => (env[k] ?? "").trim() === "";
  return blank(SESSION_ENV) && blank(PROJECT_ENV);
}
/** Why nobody is asked in a Claude Code shell without the plugin. */
const PLUGINLESS_NOBODY = "inside Claude Code without the plugin: the program asks these only in your own terminal or through the plugin";

/**
 * A person reads this command's stdout as it is printed: stdout is a terminal,
 * and the run is neither inside a Claude Code session (the plugin's run reads stdout) nor in CI (the rules check's form).
 * Stdin is not asked: what is printed is read on the screen whether or not anyone can answer a question there.
 */
function personsScreen(env: NodeJS.ProcessEnv): boolean {
  return claudeCodeSigns(env).length === 0 && !ciSet(env) && process.stdout.isTTY === true;
}
/** What the scan and the pre-launch step print where the person started the session without the profile. */
const profileWaivedLine = (missing: string[]): string =>
  `This run goes on without the scan launch profile, by the person's choice when the session was started (${WITHOUT_PROFILE_ENV}; missing: ${missing.join("; ")}); the run's marker records it.`;
/** Beside the price table: the effort level this session started with, as `legal-scan session` named it. */
const effortStartLine = (level: string | null): string =>
  (level === null
    ? "EFFORT: no effort level was named when this session started (legal-scan session passes --effort only where the person gives one), so it runs at the person's own level; the run takes the level its first launch records as the start."
    : `EFFORT: this session started at effort ${level}, as legal-scan session named it; the run's marker records it.`) +
  ` Keep the level as it is until the run ends: a change discards the cached prefix. The judging seats run at the level their agent files pin (${pinnedLevels()}), whatever this session's level; launch-next and run-gate report a seat whose own transcript records another. The level is the person's to set; do not change it.`;
/** The levels the judging seats' agent files pin (seat-effort.ts `seatPins`), for a person: "high", or each distinct one. */
const pinnedLevels = (): string => {
  const pins = [...new Set([...seatPins(PLUGIN_NAME).values()].map((v) => v ?? "none pinned"))];
  return pins.join(", ");
};
/**
 * Beside the price table: `CLAUDE_CODE_EFFORT_LEVEL` present in this session, which `legal-scan session`
 * removes, so the session was started otherwise; it outranks the seats' pin. Reported, never refused (the
 * level is the person's). Null where the variable is not set.
 */
const effortVariableLine = (env: NodeJS.ProcessEnv): string | null => {
  const v = env[EFFORT_LEVEL_ENV];
  if (typeof v !== "string" || v === "") return null;
  return (
    `EFFORT: ${EFFORT_LEVEL_ENV} is set to ${JSON.stringify(v)} in this session, which was therefore not started by legal-scan session (it removes the variable). ` +
    `The variable outranks the level the judging seats' agent files pin (${pinnedLevels()}), so every seat of this run will run at ${JSON.stringify(v)}; each seat's own level is recorded from its transcript. ` +
    // The cost of a level other than the pin a later run compares with, in one sentence.
    (v !== agentFileEffort("legal-adjudicator") ? `A later run compares each verdict's level with that pin, so the verdicts this run gives at ${JSON.stringify(v)} are given again then, never carried. ` : "") +
    "Reported, not refused: the level is the person's to set. Tell them, and do not change it yourself."
  );
};
/** A refusal before any cost: the reason, then its recovery line (recovery.ts), exit 1. */
function refuseScan(reason: string, recovery: string): null {
  console.error(`refused: ${reason} ${nothingWrittenWords().replace("Nothing was written", "Nothing was scanned or written")}.`);
  console.error(recovery);
  process.exitCode = 1;
  return null;
}

/**
 * The row kind of the later-run line an earlier build asked through the relay ("Same answers as on <date>?",
 * Yes / Review). This build asks no such line; a round an earlier build wrote may still hold one, and the hook may have
 * recorded its answer. Such a row is not taken, and the take says so by name: the answers
 * to the round's other questions are taken as any others, and the saved answers stand whatever the line's answer was.
 */
const EARLIER_LINE_KIND = "same-answers";
/**
 * The rows a taken round makes: each question of the round with the row the scan wrote for it (the version it was
 * asked at). `earlier`: the answer to an earlier build's later-run line where the round held one (EARLIER_LINE_KIND),
 * the label chosen or null; it makes no row.
 */
function rowsFromRound(t: TakenDeclaration, source: DeclarationSource): { rows: RecordRow[]; earlier: { label: string | null } | null } | string {
  const rows: unknown[] = Array.isArray(t.question.doc.rows) ? t.question.doc.rows : [];
  if (rows.length !== t.question.questions.length) return `${t.question.path} holds ${rows.length} row(s) for ${t.question.questions.length} question(s)`;
  const at = new Date();
  const out: RecordRow[] = [];
  let earlier: { label: string | null } | null = null;
  for (const [i, q] of t.question.questions.entries()) {
    const r = rows[i] as Record<string, unknown> | null;
    if (r !== null && typeof r === "object" && r.kind === EARLIER_LINE_KIND) {
      earlier = { label: t.answers[q.question] ?? null };
      continue;
    }
    const byLabel = r !== null && typeof r === "object" && typeof r.value_by_label === "object" && r.value_by_label !== null ? (r.value_by_label as Record<string, unknown>) : null;
    if (r === null || typeof r !== "object" || typeof r.id !== "string" || typeof r.field !== "string" || typeof r.digest !== "string" || typeof r.header !== "string" || !(r.code === null || typeof r.code === "string") || byLabel === null) {
      return `row ${i + 1} of ${t.question.path} is not a question row the scan writes`;
    }
    const planned: PlannedQuestion = {
      id: r.id,
      field: r.field,
      code: r.code as string | null,
      header: r.header,
      text: q.question,
      digest: r.digest,
      options: Object.entries(byLabel).map(([label, value]) => ({ label, value, description: "" })),
      unanswered: undefined,
      multiSelect: r.multi_select === true,
      candidates: 0,
      rules: [],
      seats: 0,
      seatRules: [],
      affected: [],
      launches: null,
      of: 0,
      totalLaunches: 0,
      severity: 0,
      changes: true,
      premiseRules: [],
      changesReview: true,
      kind: null,
      added: false,
      overCap: false,
      settles: 0,
      raised: false,
      hint: null,
    };
    out.push(rowFor(planned, source, t.answers[q.question] ?? null, "plugin", at, t.toolUseId));
  }
  return { rows: out, earlier };
}

/**
 * ONE PLACE FOR A SESSION'S ROUND. Inside a Claude Code session the scan writes its
 * round where the plugin's hook reads it and bound to the session the hook's events carry, or it refuses by name
 * before any cost. The round names its session: `SESSION_ENV` (the plugin's SessionStart hook exports it), else
 * `CLAUDE_CODE_SESSION_ENV` (Claude Code's own); neither set, or the two naming different sessions, is refused,
 * since the hook refuses a look-alike only in the session a round names. The round lives only at
 * `$PROJECT_ENV/.legal/launch`, the project folder the same SessionStart hook exports from the hooks' own
 * `CLAUDE_PROJECT_DIR`: an --out that puts it anywhere else is refused, and so is a shell that carries no project
 * folder, where the scan cannot tell where the hook reads (the pre-launch step's `launchDirRefusal` and `markerSessionRefusal` refuse the same situations at their own step).
 * Null where the round has its one place.
 */
function sessionRoundRefusal(dir: string, env: NodeJS.ProcessEnv): { reason: string; kind: "declaration-session-unbound" | "declaration-out-elsewhere" } | null {
  const valueOf = (k: string): string | null => {
    const v = env[k];
    return typeof v === "string" && v.trim() !== "" ? v : null;
  };
  const inside = `${claudeCodeSigns(env).join(" and ")} set`;
  const plugin = valueOf(SESSION_ENV);
  const own = valueOf(CLAUDE_CODE_SESSION_ENV);
  if (plugin === null && own === null) {
    return {
      kind: "declaration-session-unbound",
      reason: `this shell runs inside Claude Code (${inside}) but carries no session id (neither ${SESSION_ENV} nor ${CLAUDE_CODE_SESSION_ENV} is set): a round of declaration questions must name the session it is asked in, or the plugin's hook cannot refuse a question that imitates it there`,
    };
  }
  if (plugin !== null && own !== null && plugin !== own) {
    return {
      kind: "declaration-session-unbound",
      reason: `${SESSION_ENV} names the session ${JSON.stringify(plugin)} and ${CLAUDE_CODE_SESSION_ENV} names ${JSON.stringify(own)}: a round bound to one of them would be checked against the other session's questions`,
    };
  }
  const project = valueOf(PROJECT_ENV);
  if (project === null) {
    return {
      kind: "declaration-session-unbound",
      reason: `this shell runs inside Claude Code (${inside}) but carries no project folder (${PROJECT_ENV} is unset): the plugin's SessionStart hook, which exports it, did not run in this session, so the scan cannot tell where the hook reads its questions`,
    };
  }
  const expected = resolve(project, ".legal");
  // The same folder spelled through a link (macOS's `/var` for `/private/var`,
  // the physical path a shell's working folder reports) is the folder the hook reads: compared as written and by real path.
  if (resolve(dir) !== expected && realOfNearest(dir) !== realOfNearest(expected)) {
    return {
      kind: "declaration-out-elsewhere",
      reason: `--out puts the findings in ${resolve(dir)}, and the scan writes its declaration questions beside them in ${join(resolve(dir), "launch")}; in this session the plugin's hook reads them only at ${join(expected, "launch")} (${PROJECT_ENV}), so they would never reach the person`,
    };
  }
  return null;
}

/**
 * Before any cost (no file of the tree read yet): the refusals in order, then the round an answer closes:
 * --declaration-from-answer outside a session; inside a session, a round with no one place (sessionRoundRefusal);
 * inside a session, a --profile that is not the program's declaration under its record; an answer
 * the hook's records do not bind (hook-question.ts takeDeclarationAnswer); --review-declaration where nobody is
 * asked (no terminal, CI). Null where the scan is refused (exit 1, nothing written).
 */
function declarationBeforeScan(opts: { out?: string; profile?: string; declarationFromAnswer?: boolean; reviewDeclaration?: boolean; target?: string }, rules: Rule[]): DeclarationStep | "ci" | null {
  const path = declarationPathOf(process.env);
  const out = resolve(opts.out ?? join(".legal", "findings.json"));
  const dir = dirname(out);
  // Inside a session, the scan launch profile first (scan-profile.ts), before every other refusal.
  const profileStop = path === "session" ? profileRefusal(process.env, "The scan") : null;
  if (profileStop !== null) return refuseScan(profileStop, recoveryFor("scan-profile-off"));
  const profileNow = path === "session" ? profileRecord(process.env) : null;
  if (profileNow?.state === "waived") console.log(profileWaivedLine(profileNow.missing));
  const pluginless = path === "session" && pluginlessSession(process.env);
  if (opts.declarationFromAnswer && (path !== "session" || pluginless)) {
    return refuseScan(
      pluginless
        ? `--declaration-from-answer takes the answers the plugin's hook recorded inside a Claude Code session, and this shell carries no sign of the plugin (neither ${SESSION_ENV} nor ${PROJECT_ENV} is set): no hook records an answer here.`
        : `--declaration-from-answer takes the answers the plugin's hook recorded inside a Claude Code session, and this scan runs outside one (${path === "ci" ? "CI" : "no Claude Code sign in its environment"}): no hook records an answer here.`,
      recoveryFor("declaration-no-terminal"),
    );
  }
  if (opts.reviewDeclaration && (path === "ci" || path === "no-terminal" || pluginless)) {
    // Refused before any cost, as --declaration-from-answer is outside a session (F12), since
    // a review asks and nobody is asked here; ignoring the flag would scan as if the person had not asked for it.
    const why =
      pluginless
        ? PLUGINLESS_NOBODY
        : path === "ci"
        ? `CI: ${CI_ENV}=${JSON.stringify(process.env[CI_ENV] ?? "")} is set in this environment, and outside a Claude Code session the scanner never asks where it is set, a terminal included`
        : "no terminal: stdin or stdout is not a terminal, so there is nobody to ask";
    return refuseScan(`${REVIEW_DECLARATION_FLAG} puts the saved declaration answers back to the person as questions, and nobody is asked here (${why}).`, recoveryFor("declaration-review-nobody-to-ask"));
  }
  // Release 1 reads no answers about the product in CI, from anywhere: the
  // rules of every region run, the rules check's summary says so, and no question stops the run (no exit 5 in CI).
  if (path === "ci") return "ci";
  const unbound = path === "session" && !pluginless ? sessionRoundRefusal(dir, process.env) : null;
  if (unbound !== null) return refuseScan(`${unbound.reason}.`, unbound.kind === "declaration-out-elsewhere" ? recoveryFor("declaration-out-elsewhere") : recoveryFor("declaration-session-unbound"));
  const source = loadDeclarationSource();
  const jurisdictions = jurisdictionsOf(rules);
  const declared = readDeclaration(dir);
  const verdict = usable(source, declared, jurisdictions);
  // Design rf11 3.3: CI returned above, reading no saved answer; here a pair settles
  // nothing until the person running the scan has confirmed it in this folder on this computer.
  const target = resolve(opts.target ?? ".");
  const team = teamAnswersState(processStateDir(), target, declared);
  const c: DeclarationContext = { path: pluginless ? "claude-code" : path, source, dir, writesOutput: opts.out !== undefined, launchDir: join(dir, "launch"), jurisdictions, declared, verdict, target, team };
  const own = verdict.ok && team?.confirmed === true ? declared.profilePath : undefined;
  const given = opts.profile ? resolve(opts.profile) : undefined;
  if ((c.path === "session" || c.path === "claude-code") && given !== undefined && given !== own) {
    const why = given === declared.profilePath ? (!verdict.ok ? ` (${verdict.why})` : " (its answers are not confirmed in this folder on this computer)") : "";
    return refuseScan(
      `--profile ${given} inside a Claude Code session: the scan reads a declaration only from ${declared.profilePath} under the record the program writes when the person answers its questions${why}, and a declaration written in prose is never taken as the person's answers.`,
      recoveryFor("declaration-prose"),
    );
  }
  if (opts.declarationFromAnswer && verdict.ok && team !== null && !team.confirmed && teamQuestionWritten(c.launchDir)) {
    // The round held the saved answers' question: take the person's choice from the hook's record.
    const t = takeConfirmation(c.launchDir, { purpose: TEAM_ANSWERS_PURPOSE, about: team.about });
    if ("refused" in t) return refuseScan(`--declaration-from-answer: ${t.refused}.`, t.missing ? recoveryFor("declaration-answer-missing") : recoveryFor("declaration-question-refused"));
    const at = new Date();
    const use = t.value === "use";
    const notes: string[] = [];
    let state: TeamState = team;
    if (use) {
      const commit = commitFactsOf(dir, target);
      const kept = confirmTeamAnswers(processStateDir(), target, declared, "confirmed", commit.facts, at);
      state = { ...team, confirmed: true, record: kept.record };
      notes.push(kept.refused ?? `The saved answers in ${declared.profilePath} are confirmed in this folder on this computer, and the scan above read them.`);
    } else {
      notes.push(`The saved answers in ${declared.profilePath} are not used this run (${t.value === null ? "the question was closed with no choice" : JSON.stringify(NOT_NOW)}): every region's rules ran, and the next scan asks again.`);
    }
    markConfirmationUsed(c.launchDir, t, at, use ? "the scan, which read the saved answers" : "the scan, which read no saved answers");
    declarationWindowOpens(c, out);
    return { c: { ...c, team: state }, profilePath: use ? declared.profilePath : undefined, taken: null, notes, review: false, team: use ? "use" : "not-now" };
  }
  if (opts.declarationFromAnswer) {
    const t = takeDeclarationAnswer(c.launchDir);
    if ("refused" in t) {
      const recovery = t.kind === "declaration-no-round" ? recoveryFor("declaration-no-round") : t.kind === "declaration-answer-missing" ? recoveryFor("declaration-answer-missing") : recoveryFor("declaration-answer-forged");
      return refuseScan(`--declaration-from-answer: ${t.refused}.`, recovery);
    }
    const got = rowsFromRound(t, source);
    if (typeof got === "string") return refuseScan(`--declaration-from-answer: ${got}.`, recoveryFor("declaration-question-refused"));
    const fresh = got.rows;
    const at = new Date();
    // A saved pair not confirmed here is never merged into the person's own answers (it would be confirmed unseen).
    const rows = mergeRows(team?.confirmed === true ? currentRows(source, declared) : [], fresh);
    const notes: string[] = [];
    if (got.earlier !== null) {
      notes.push(
        `The answer to the later-run line an earlier build of the scanner put in ${t.question.asking} (${got.earlier.label === null ? "no answer" : JSON.stringify(got.earlier.label)}) is not taken: this build asks no such line, the saved answers stand whatever it was, every scan outside CI states them, and a scan with ${REVIEW_DECLARATION_FLAG} asks them again.`,
      );
    }
    let profilePath: string;
    let state = team;
    let reads = true;
    if (fresh.length === 0 && verdict.ok) {
      // A round an earlier build wrote with its later-run line alone: nothing to write, the declaration stays byte for byte
      // (and is read only where it is confirmed in this folder).
      profilePath = declared.profilePath;
      reads = team?.confirmed === true;
      notes.push(`Nothing was written: the answers in ${profilePath} stand as they are.`);
    } else {
      // A declaration the program did not write is moved aside whole before the first write over it.
      const aside = setAsideUnconfirmed(declared, at);
      if (aside) notes.push(setAsideNote(declared, aside));
      profilePath = writeDeclaration(dir, rows, source, jurisdictions, at);
      notes.push(`The answers to ${t.question.asking} are written to ${profilePath} with its record ${join(dir, DECLARATION_RECORD_FILE)} (path plugin), and the scan above read that declaration.`);
      const kept = confirmWrittenHere(dir, target, at);
      state = kept.state;
      if (kept.refused !== null) notes.push(kept.refused);
    }
    markDeclarationAnswerUsed(c.launchDir, t, profilePath, at);
    declarationWindowOpens(c, out);
    // A take carries on the rounds a reviewing scan wrote (their rows already left the record): it reviews nothing again.
    return { c: { ...c, declared: readDeclaration(dir), team: state }, profilePath: reads ? profilePath : undefined, taken: { question: t.question, fresh, rows }, notes, review: false, team: null };
  }
  const notes: string[] = [];
  if (declared.status !== "none" && !verdict.ok) notes.push(`The declaration ${declared.profilePath} is not read this run: ${verdict.why}.`);
  else if (verdict.ok && team !== null && !team.confirmed) {
    notes.push(`The answers about the product saved in ${declared.profilePath} are not confirmed in this folder on this computer, so this scan read none of them: every region's rules ran.${team.unreadable !== null ? ` (The confirmation could not be read: ${team.unreadable}.)` : ""}`);
  }
  // What the scan leaves out of the saved answers it reads.
  if (own !== undefined) {
    for (const field of staleOrderFields(source, declared)) {
      const header = source.fields.find((f) => f.field === field)?.x.header ?? field;
      notes.push(`Your saved answer to ${JSON.stringify(header)} was given to an earlier version of that question and is not used. Where a finding turns on it, the finding waits for your answer and the report asks the question again.`);
    }
  }
  let profilePath = own;
  if (given !== undefined && given !== own) {
    profilePath = given;
    notes.push(`--profile ${given} was read as given, unconfirmed: no record of the program's questions stands behind it, so its answers are the file's, not answers the person gave the program.`);
  }
  declarationWindowOpens(c, out);
  return { c, profilePath, taken: null, notes, review: opts.reviewDeclaration === true, team: null };
}

/** Whether the launch folder holds the saved answers' question (the program's confirmation of that purpose). */
function teamQuestionWritten(launchDir: string): boolean {
  const q = loadConfirmationQuestion(launchDir);
  return !("problem" in q) && q.purpose === TEAM_ANSWERS_PURPOSE;
}

/**
 * Answers the program has just written from the person's own answers are confirmed in
 * this folder by being written (design rf11 3.3): the pair's two sha256s and the answers go into the person's record.
 */
function confirmWrittenHere(dir: string, target: string, at: Date): { state: TeamState | null; refused: string | null } {
  const read = readDeclaration(dir);
  const kept = confirmTeamAnswers(processStateDir(), target, read, "answered-here", null, at);
  const state = teamAnswersState(processStateDir(), target, read);
  return { state: state === null ? null : { ...state, confirmed: true, record: kept.record }, refused: kept.refused };
}

/** The session a round or a scan's line names: the plugin's own id, else Claude Code's (sessionRoundRefusal checked they agree). */
const roundSessionId = (): string | null => [SESSION_ENV, CLAUDE_CODE_SESSION_ENV].map((k) => process.env[k]).find((v): v is string => typeof v === "string" && v.trim() !== "") ?? null;

/**
 * THE RUN STARTS HERE ON THE SESSION PATH: once a scan in a Claude Code
 * session has gone past every refusal (each writes nothing, F5c-F18), the declaration ledger records it, naming the
 * session, whether or not the scan will write a round. From that line to the end of the run that follows (the
 * active-run history: run-abort or the assembly) the write guard refuses a tool's write, move or delete of the
 * declaration's files in that session (hook-question.ts declarationUnderWay): a later run whose answers are all saved
 * writes no round, and the orchestrator works between the scan and the pre-launch step. Outside a session no hook runs.
 */
function declarationWindowOpens(c: DeclarationContext, out: string): void {
  endDeepChecksAtScan(c.dir);
  if (c.path === "session") recordDeclarationScan(c.launchDir, out, new Date(), roundSessionId());
}

/**
 * (design rf13 3.9, "The check's own run") A scan's start ends a deeper check whose seat is
 * pending in the folder (`.legal/deep/active.json`, hook.ts `endDeepCheck`, history "ended: a scan started"), so that no
 * seat answer of the check is captured across a scan. The folder is the one holding the scan's `.legal`, and the
 * session's project folder where Claude Code names one. A failure to end it is not the scan's: it is printed and the scan
 * goes on, and the check's marker then expires at its end time.
 */
function endDeepChecksAtScan(declarationDir: string): void {
  const projects = new Set<string>();
  if (basename(resolve(declarationDir)) === ".legal") projects.add(dirname(resolve(declarationDir)));
  const env = process.env.CLAUDE_PROJECT_DIR;
  if (typeof env === "string" && env !== "" && isAbsolute(env)) projects.add(resolve(env));
  for (const project of projects) {
    try {
      endDeepCheck(project, "ended: a scan started", new Date(), deepTracked(project), roundSessionId());
    } catch (e) {
      console.error(`Note: the deeper check pending in ${project} could not be ended (${(e as Error).message}); its marker ends at its own end time.`);
    }
  }
}

/** Write a round (at most four questions) for the relay and record its bytes in the ledger: the hook passes only a recorded round. */
/**
 * The review a round carries on, read from the round the scan wrote (its bytes
 * are the ledger's): the raised questions the reviewing scan read, as fields the question source holds; null for a round
 * of an ordinary scan.
 */
function reviewOfRound(doc: Record<string, unknown>, source: DeclarationSource): Set<string> | null {
  const r = doc.review;
  if (typeof r !== "object" || r === null || Array.isArray(r)) return null;
  const known = new Set(source.fields.map((f) => f.field));
  const raised = (r as Record<string, unknown>).raised;
  return new Set((Array.isArray(raised) ? raised : []).filter((f): f is string => typeof f === "string" && known.has(f)));
}

/**
 * The questions the run chose to ask before review, read from the
 * round the scan wrote, as question ids: the take plans with exactly these (the cap is per run, not per round), so a take
 * never opens a second set. A round of an earlier build carries no `asked_before_review`: its own rows and its `added`
 * list stand for it.
 */
function askedOfRound(doc: Record<string, unknown>): Set<string> {
  const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((id): id is string => typeof id === "string") : []);
  if (Array.isArray(doc.asked_before_review)) return new Set(ids(doc.asked_before_review));
  const rows = Array.isArray(doc.rows) ? doc.rows.map((r) => (r !== null && typeof r === "object" ? (r as Record<string, unknown>).id : undefined)) : [];
  return new Set([...ids(doc.added), ...ids(rows)]);
}

function writeDeclarationRound(c: DeclarationContext, round: PlannedQuestion[], roundNo: number, scanId: string, hints: unknown, review: ReadonlySet<string> | null = null, added: string[] = [], asked: string[] | null = null): { path: string; asking: string; input: Record<string, unknown> } {
  const headers: string[] = [];
  for (const f of c.source.fields) {
    if (f.x.per === "jurisdiction") headers.push(...c.jurisdictions.map((code) => f.x.header.split("{code}").join(code)));
    else if (f.x.per === "part") headers.push(...(f.x.parts ?? []).map((p) => p.header));
    else headers.push(f.x.header);
  }
  const sessionId = roundSessionId();
  const asking = declarationAsking(scanId, roundNo);
  const doc = {
    kind: "declaration-question",
    version: 1,
    written_by: "the scan (legal-scan scan)",
    scan_id: scanId,
    asking,
    round: roundNo,
    session_id: sessionId,
    // A multi-select question (Ships as) is asked as one; its row says so.
    ask_user_question_input: { questions: round.map((q) => ({ question: askedText(q), header: q.header, multiSelect: q.multiSelect, options: choices(q, c.source) })) },
    rows: round.map((q) => ({ id: q.id, field: q.field, code: q.code, digest: q.digest, header: q.header, value_by_label: Object.fromEntries(q.options.map((o) => [o.label, o.value])), ...(q.multiSelect ? { multi_select: true } : {}) })),
    look_alike_headers: [...new Set(headers)],
    look_alike_labels: [c.source.notAnswering.label],
    ...(hints === null || hints === undefined ? {} : { hints }),
    ...(review === null ? {} : { review: { raised: [...review].sort() } }),
    added,
    ...(asked === null ? {} : { asked_before_review: asked }),
  };
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  makeFolder(c.launchDir, { recursive: true });
  const path = launchRecordPath(c.launchDir, DECLARATION_QUESTION_FILE, true);
  writeFileAt(path, text);
  recordDeclarationQuestion(c.launchDir, asking, text, new Date(), sessionId);
  return { path, asking, input: doc.ask_user_question_input };
}

/** The questions not asked (no terminal), each with its text and figures. */
function notAskedLines(c: DeclarationContext, selected: PlannedQuestion[], why: string): string[] {
  return [
    "",
    `THE DECLARATION QUESTIONS: ${selected.length} question(s) this run's candidates turn on have no answer confirmed in ${join(c.dir, DECLARATION_RECORD_FILE)}, and they were not asked (${why}):`,
    ...selected.map((q) => `  - ${q.header}: ${q.text} ${figures(q)}`),
  ];
}

/**
 * After the first result (decision 2: before the run-shape question), by path. On a plain scan outside CI over a
 * declaration under its record, the saved answers this run's candidates turn on are STATED first, one sentence made by
 * declaration.ts `savedAnswers` and the same on every path (the later-run line, display-only since 2026-09-27);
 * with --review-declaration they are asked again instead (their rows leave the record, so each
 * is asked as a question never put). Session: the next round written and its input printed, or none left and a
 * stale round withdrawn (P7). Terminal: every question asked at once, the declaration written (path terminal), and the
 * scan run again with it (F9). CI never reaches this function: declarationBeforeScan returns "ci" (design rf11 3.3).
 * No terminal: the questions listed as not asked (F7). Returns the last pass and the exit.
 */
async function declarationAfterScan(step: DeclarationStep, rules: Rule[], first: ScanPassResult, again: (profilePath: string) => Promise<ScanPassResult>): Promise<{ last: ScanPassResult; exitCode: number }> {
  const { c } = step;
  const unconfirmedFile = c.declared.status === "no-record" || c.declared.status === "changed";
  // A saved pair not confirmed in this folder is no answer: its values are hints only.
  const pairConfirmed = c.team?.confirmed === true;
  const hintsFrom: unknown = step.taken ? (step.taken.question.doc.hints ?? null) : unconfirmedFile || (c.team !== null && !pairConfirmed) ? c.declared.content : null;
  let rows = step.taken ? step.taken.rows : pairConfirmed ? currentRows(c.source, c.declared) : [];
  // Planned with the answers already held, so a region is weighed with those answered (open-world). The review entrance also plans the questions the previous run's report raised. A review is every round of the run it starts, not its first pass only:
  // each round it writes says so (`review` in the round's document, with the raised questions it read), and a take of
  // such a round carries the review on, so every round selects every planned question that has no row (`all`), raised
  // ones first, whether or not the record held a saved answer. An ordinary scan, and a take of its rounds, select as before.
  const carried = step.taken ? reviewOfRound(step.taken.question.doc, c.source) : null;
  const reviewing = step.review || carried !== null;
  const raised = step.review ? questionsRaisedOf(c.dir, c.source) : carried ?? new Set<string>();
  // What the last report raised, kept apart from the
  // open conditions the review adds below, so the line that names them says which is which.
  const raisedByReport = new Set(raised);
  // The review entrance also asks the field of
  // every limb this scan's applicability left open, where the question source holds it (the CRA's `cra.*` limbs): no
  // candidate turns on those fields, so no report raises them, and the review is the entrance the TO ANSWER lines name.
  // A round this review writes keeps them in its `review.raised`, so a take of that round asks them too.
  if (step.review) {
    for (const a of first.findings.applicability ?? []) {
      for (const l of a.limbs ?? []) {
        if ((a.unresolved_limbs ?? []).includes(l.limb_id) && l.declared_by && c.source.fields.some((f) => f.field === l.declared_by)) raised.add(l.declared_by);
      }
    }
  }
  // The questions asked before review are chosen once per run (its
  // first plan), at most ASKED_BEFORE_REVIEW_MAX over every declaration question, and carried by every round it writes; a
  // take plans with the round's choice, so the run asks one round. The review entrance asks every question without the
  // cap (the person asked to review the answers). CI never reaches this function (declarationBeforeScan returns "ci").
  const capped = !reviewing;
  const chosen = step.taken && capped ? askedOfRound(step.taken.question.doc) : null;
  // The root manifests' own names order the self-name question (never answer it).
  const manifestNames = manifestNamesOf(c.target);
  let planned = plannedQuestions(c.source, rules, first.findings.candidates, hintsFrom, rows, raised, chosen, capped, manifestNames);
  const runAdded = addedAsked(planned);
  const runAsked = capped ? askedBeforeReview(planned) : null;
  let selected = selectQuestions(planned, rows, step.taken ? "after-answer" : "scan", reviewing);
  // Design rf11 3.3: the round that holds the saved answers' question, and the take of
  // it, ask nothing else; every question they leave open is left for the report, as the questions beyond the cap are.
  const teamRound = c.verdict.ok && c.team !== null && !pairConfirmed && step.team === null && !step.taken && !step.review;
  if (teamRound || step.team !== null) {
    const left = new Set(selected.map((q) => q.id));
    planned = planned.map((q) => (left.has(q.id) ? { ...q, changes: false, changesReview: true, overCap: true } : q));
    selected = [];
  }
  // The later-run line, on a plain scan only (the rescan of a take states nothing this run has stated already), never in
  // CI. The saved answers are asked again only on --review-declaration (refused before the scan with no terminal and in
  // CI). The statement says this run used them, so it is printed only where this pass read the program's declaration
  // under its record: not where the declaration is not read (a question changed, a region the record has no row for)
  // and not where a --profile of another file was read in its place. It names the values that pass read:
  // the profile it handed the engine, and the regions its per_rule_applicability settled, never the record's rows.
  const applied = first.findings.per_rule_applicability;
  const readByPass = step.profilePath !== undefined && step.profilePath === c.declared.profilePath;
  const usedByPass = readByPass ? { profile: first.profile, regions: applied?.settled === true && Array.isArray(applied.declared_regions) ? applied.declared_regions : null } : null;
  const saved = step.taken || !pairConfirmed ? null : savedAnswers(c.source, c.declared, planned, selected, usedByPass);
  const used = saved !== null && saved.statement !== null ? saved : null;
  const review = step.review ? saved : null;
  if (review !== null) {
    const out = new Set(review.reviews);
    rows = rows.filter((r) => !out.has(r.id));
    // A review asks every question this run's candidates turn on, those no answer to which changes it included.
    selected = selectQuestions(planned, rows, "scan", true);
  }
  // Every planned question and what became of it, beside the declaration.
  const plan = declarationPlan(planned, selected, rows);
  if (c.writesOutput) {
    const written = writeDeclarationPlan(c.dir, first.findings.scan_id, plan, new Date(), answersUsedNow(c, step, readByPass));
    // The plan's digest outside the project, as each evidence log's is (log-digest.ts).
    const bound = recordLogDigest(processStateDir(), c.target, planDigestName(first.findings.scan_id), written.sha256);
    if (!bound.written) {
      // The state folder's place said once a run, in plain words (log-digest.ts).
      const note = bound.placeRefused === true ? stateFolderPlaceNote(processStateDir(), c.target) : PLAN_DIGEST_WORDS.notRecorded(bound.why);
      if (note !== null) console.log(note);
    }
  }
  const overCap = plan.questions.filter((q) => q.over_cap && q.status === NOT_ASKED_LATER).length;
  const screen = questionScreenLines(selected.length, plan.not_asked, plan.not_asked_later - overCap, selected.filter((q) => q.added).length, overCap);
  if (step.notes.length > 0 || selected.length > 0 || step.taken || used !== null || step.review) console.log("");
  for (const n of step.notes) console.log(n);
  if (step.review && raisedByReport.size > 0) {
    console.log(`${REVIEW_DECLARATION_FLAG}: the last report raised ${raisedByReport.size} question(s) (${[...raisedByReport].sort().join(", ")}); the review asks each of them first, whatever the record holds.`);
  }
  // The open conditions are this scan's, not the
  // last report's (a fresh project has no last report): named as what they are.
  const openConditions = [...raised].filter((f) => !raisedByReport.has(f)).sort();
  if (step.review && openConditions.length > 0) {
    console.log(`${REVIEW_DECLARATION_FLAG}: this scan left ${openConditions.length} condition(s) open that decide whether a law applies and that only your answer settles (${openConditions.join(", ")}); the review asks each of them first, whatever the record holds.`);
  }
  if (review !== null) {
    console.log(`Review (${REVIEW_DECLARATION_FLAG}): the ${review.reviews.length} saved answer(s) this run's candidates turn on, saved on ${review.day} (${review.reviewed}), are asked again; until each is answered, every rule it turns on runs with the question open.`);
  } else if (step.review && c.team !== null && !pairConfirmed) {
    console.log(`${REVIEW_DECLARATION_FLAG}: the answers saved in ${c.declared.profilePath} are not confirmed in this folder on this computer, so every question is asked, with the saved values shown beside it as hints, never as answers.`);
  } else if (step.review) {
    console.log(`${REVIEW_DECLARATION_FLAG}: ${join(c.dir, DECLARATION_RECORD_FILE)} confirms no saved answer this run's candidates turn on, so none is asked again.`);
  } else if (used !== null && used.statement !== null) {
    console.log(used.statement);
  }
  const noAnswer = step.taken ? step.taken.fresh.filter((r) => r.outcome === "no-answer") : [];
  if (step.taken && noAnswer.length > 0) {
    console.log(
      `${noAnswer.length} question(s) of ${step.taken.question.asking} have no answer (the dialog closed with none, or with text of the person's own, which is never taken as an answer): ${noAnswer.map((r) => r.header).join(", ")}. They are recorded as no answer and the next scan asks them again; until then every rule they turn on runs with the question open.`,
    );
    // Where the take leaves a round, that round's block (below) says what to do next, and a Recovery line here
    // would restart the rounds, so a run nobody answers would never end; where it leaves none, the recovery offers
    // going on (an unanswered question switches nothing off).
    if (selected.length === 0) console.log(recoveryFor("declaration-no-answer"));
  }
  if (teamRound) return teamAnswersRound(c, first, screen, again);
  if (c.path === "session") {
    if (selected.length === 0) {
      for (const l of screen) console.log(`FOR THE PERSON (tell them this sentence as it is): ${l}`);
      // A round the ledger still holds open (written, never taken) is withdrawn as its file goes: a round is
      // outstanding by the ledger alone (hook-question.ts declarationOutstanding).
      withdrawDeclarationRound(c.launchDir, new Date());
      removeRelayRecord(c.launchDir, DECLARATION_QUESTION_FILE);
      console.log("No declaration question is left for this run.");
      return { last: first, exitCode: 0 };
    }
    if (review !== null) {
      // The reviewed rows leave the record now, as the line's Review did at its take in earlier versions, so that every
      // round that follows asks the ones this round has no room for (a take selects only questions never put).
      const reduced = writeDeclaration(c.dir, rows, c.source, c.jurisdictions, new Date());
      console.log(`They are taken out of ${reduced} and its record ${join(c.dir, DECLARATION_RECORD_FILE)}, and asked in the rounds below.`);
      const kept = confirmWrittenHere(c.dir, c.target, new Date());
      if (kept.refused !== null) console.log(kept.refused);
    }
    const round = firstRound(selected, QUESTIONS_PER_ROUND);
    const roundNo = step.taken ? step.taken.question.round + 1 : 1;
    const written = writeDeclarationRound(c, round, roundNo, first.findings.scan_id, hintsFor(selected, hintsFrom), reviewing ? raised : null, runAdded, runAsked);
    console.log(
      `THE DECLARATION QUESTIONS, round ${roundNo}: ${round.length} of the ${selected.length} question(s) ${reviewing ? "the review asks" : "this run's candidates turn on"} that have no answer in ${join(c.dir, DECLARATION_RECORD_FILE)}${review !== null ? ` (the ${review.reviews.length} under review among them)` : ""}, ordered by the candidates they affect. Every question offers ${JSON.stringify(c.source.notAnswering.label)}; no answer is drafted from the code.`,
    );
    for (const q of round) console.log(`  - ${q.header}: ${figures(q)}`);
    for (const l of screen) console.log(`FOR THE PERSON (tell them this sentence as it is): ${l}`);
    console.log(
      `To ask the person, ${PASS_EXACTLY}, alone in its call and with every character as it is - copy the line below whole; do not re-word, shorten or re-type any of it. ` +
        `The scanner's hook compares it with ${written.path} character by character, refuses any difference (saying what differs and what to pass), and records the answers:`,
    );
    for (const l of askInputLines(written.input, c.dir)) console.log(l);
    console.log(
      `Then run this scan again as it was run, with --declaration-from-answer added: the program takes the answers only from the hook's record, writes ${join(c.dir, DECLARATION_PROFILE_FILE)} with its record, and scans again with the declaration. The pre-launch step waits until then.`,
    );
    if (!step.taken && !step.review && c.declared.status !== "none" && selected.length > 0) console.log(c.declared.status === "ok" ? recoveryFor("declaration-question-changed") : recoveryFor("declaration-unconfirmed"));
    return { last: first, exitCode: 0 };
  }
  if (c.path === "terminal" && selected.length > 0) {
    const asker = new TerminalAsker();
    try {
      for (const l of screen) console.log(`  ${l}`);
      let answered = await asker.questions(selected, c.source, () => new Date());
      // Open-world regions: an answer of No can make another region's No matter, so the questions are
      // planned again with the answers given, and only a question never put is asked, until none is left.
      for (;;) {
        const held = mergeRows(rows, answered);
        const next = selectQuestions(plannedQuestions(c.source, rules, first.findings.candidates, hintsFrom, held, raised, runAsked === null ? null : new Set(runAsked), capped, manifestNames), held, "after-answer", reviewing);
        if (next.length === 0) break;
        answered = [...answered, ...(await asker.questions(next, c.source, () => new Date()))];
      }
      const aside = setAsideUnconfirmed(c.declared, new Date());
      if (aside) console.log(`\n${setAsideNote(c.declared, aside)}`);
      const profilePath = writeDeclaration(c.dir, mergeRows(rows, answered), c.source, c.jurisdictions, new Date());
      const kept = confirmWrittenHere(c.dir, c.target, new Date());
      if (kept.refused !== null) console.log(`\n${kept.refused}`);
      // What happened, in the person's words: how many questions were answered, and
      // that a question left open switches nothing off (a "written answers" line over four skips said otherwise).
      console.log(`\n${answersWrittenLine(answered, profilePath, join(c.dir, DECLARATION_RECORD_FILE))}\n`);
      return { last: await again(profilePath), exitCode: 0 };
    } finally {
      asker.close();
    }
  }
  if (selected.length === 0) return { last: first, exitCode: 0 };
  for (const l of notAskedLines(c, selected, c.path === "claude-code" ? PLUGINLESS_NOBODY : "no terminal: stdin or stdout is not a terminal, so there is nobody to ask")) console.log(l);
  console.log(recoveryFor(c.path === "claude-code" ? "declaration-no-plugin" : "declaration-no-terminal"));
  return { last: first, exitCode: 0 };
}

/**
 * THE ROUND THAT HOLDS THE SAVED ANSWERS' QUESTION (design rf11 3.3, mock M17), in place
 * of the region questions and with nothing else: in a session through the relay's program confirmation (taken back by
 * the scan with --declaration-from-answer), in a terminal at once (USE_THEM: kept as confirmed and the scan runs again
 * with them), and with no terminal nobody is asked and the pair stays unconfirmed. The first pass read no saved answer.
 */
async function teamAnswersRound(c: DeclarationContext, first: ScanPassResult, screen: string[], again: (profilePath: string) => Promise<ScanPassResult>): Promise<{ last: ScanPassResult; exitCode: number }> {
  const team = c.team!;
  const commit = commitFactsOf(c.dir, c.target);
  const q = teamAnswersQuestion(c.source, c.declared, c.jurisdictions, commit, team.earlier);
  const head = `THE TEAM'S SAVED ANSWERS: ${c.declared.profilePath} and its record hold answers about the product that are not confirmed in this folder on this computer, so the scan above read none of them and every region's rules ran.`;
  if (c.path === "session") {
    withdrawDeclarationRound(c.launchDir, new Date());
    removeRelayRecord(c.launchDir, DECLARATION_QUESTION_FILE);
    const written = writeConfirmationQuestion(c.launchDir, { purpose: TEAM_ANSWERS_PURPOSE, about: team.about, question: q.question, valueByLabel: q.valueByLabel }, new Date(), roundSessionId());
    console.log(`${head} This run's question round holds one question, in place of the declaration questions; nothing else is asked this run, and the questions the saved answers leave open are listed in the report.`);
    for (const l of screen) console.log(`FOR THE PERSON (tell them this sentence as it is): ${l}`);
    console.log(
      `To ask the person, ${PASS_EXACTLY}, alone in its call and with every character as it is - copy the line below whole; do not re-word, shorten or re-type any of it. ` +
        `The scanner's hook compares it with ${written.path} character by character, refuses any difference (saying what differs and what to pass), and records the answer:`,
    );
    for (const l of askInputLines(written.input, c.dir)) console.log(l);
    console.log(
      `Then run this scan again as it was run, with --declaration-from-answer added: the program takes the answer only from the hook's record; with ${JSON.stringify(USE_THEM)} it keeps the saved answers as confirmed in this folder on this computer and the scan reads them, with ${JSON.stringify(NOT_NOW)} it reads none. The pre-launch step waits until then.`,
    );
    return { last: first, exitCode: 0 };
  }
  if (c.path === "terminal") {
    const asker = new TerminalAsker();
    try {
      const label = await asker.one(1, 1, q.question.header, q.question.question, null, q.question.options);
      if (label === USE_THEM) {
        const kept = confirmTeamAnswers(processStateDir(), c.target, c.declared, "confirmed", commit.facts, new Date());
        console.log(`\n${kept.refused ?? `The saved answers in ${c.declared.profilePath} are confirmed in this folder on this computer.`} The scan runs again with them:\n`);
        return { last: await again(c.declared.profilePath), exitCode: 0 };
      }
      console.log(`\nThe saved answers in ${c.declared.profilePath} are not used this run: every region's rules ran, and the next scan asks again.`);
      return { last: first, exitCode: 0 };
    } finally {
      asker.close();
    }
  }
  console.log(`${head} Nobody is asked here (${c.path === "claude-code" ? PLUGINLESS_NOBODY : "no terminal: stdin or stdout is not a terminal"}), so they stay unconfirmed.`);
  console.log(recoveryFor(c.path === "claude-code" ? "declaration-no-plugin" : "declaration-no-terminal"));
  return { last: first, exitCode: 0 };
}

/** Whose answers this pass used (declaration.ts `AnswersUsed`), for the plan and through it the evidence log. */
function answersUsedNow(c: DeclarationContext, step: DeclarationStep, readByPass: boolean): AnswersUsed {
  if (readByPass && c.declared.record !== null) {
    const rec = c.team?.record ?? null;
    const team = rec?.how === "confirmed";
    return {
      whose: team ? "team" : "own",
      saved_at: c.declared.record.written_at,
      ...(rec !== null ? { confirmed_at: rec.confirmed_at, profile_sha256: rec.profile_sha256, record_sha256: rec.record_sha256 } : {}),
      ...(team ? { commit: rec!.commit } : {}),
      answers: currentRows(c.source, c.declared)
        .filter((r) => r.outcome === "answered" && r.label !== null)
        .map((r) => ({ id: r.id, header: r.header, answer: r.label! })),
    };
  }
  if (step.profilePath !== undefined) return { whose: "file", file: step.profilePath };
  if (c.declared.status === "none") return { whose: "none", reason: "no-saved-answers" };
  if (step.team === "not-now") return { whose: "none", reason: "not-now" };
  return { whose: "none", reason: c.verdict.ok && c.team !== null && c.team.confirmed !== true ? "not-confirmed-here" : "not-usable" };
}

/** The line a command prints where `--findings` cannot be used: the digest's one sentence where the document changed after the scan (log-digest.ts `FindingsChanged`). */
function findingsUnreadable(path: string, e: unknown): string {
  return e instanceof FindingsChanged ? e.message : `--findings ${path} could not be read as JSON: ${(e as Error).message}`;
}

const program = new Command();
/*
 * THE REDACTION AN EXPORT GOES THROUGH. An export is built to leave the machine -
 * the RoPA's CSVs and `.docx`, a questionnaire's answer sheet - and both carry quotations of the scanned code a layer-2
 * agent wrote verbatim. Both redact the VALUES before any format encodes them, with the CLI's own credential patterns
 * (engine.ts `productPrintedRedaction`), so no bundle is needed and none can turn the redaction off: `ropa` here, the
 * questionnaire inside `exportAnswers` (questionnaire.ts).
 */
program.name(PROGRAM_NAME).description("WolfBoy: checks what your code does against the law and your own privacy policy").version(PROGRAM_VERSION);

/* THE ANCHOR, ASKED BY EVERY COMMAND, before its
 * action and before the hook below writes anything: from every option and argument the command was given or defaulted, the
 * working folder and the session's project folder (plugin-sessions.ts `commandPaths`). In a project where a session of the
 * plugin's hooks, or that session's scan, was recorded for this account, a state folder or redaction key other than the
 * recorded ones, or a record that cannot be read, is refused here, for the assembly, the report commands, the relay's
 * commands and every other as for the pre-launch step; what each command adds in such a project it reads from
 * `commandSessions()`. */
program.hook("preAction", (_program, actionCommand) => {
  // And refused where the command's own values lie in
  // two recorded projects, whatever the order they were typed in.
  const around = pluginSessionsAround(processStateDir(), commandPaths(actionCommand), undefined, commandNamedPaths(actionCommand));
  noteCommandSessions(around);
  if (around.kind === "refused") {
    console.error(`refused: ${around.why}. ${nothingWrittenWords()}.`);
    process.exit(1);
  }
});

// EVERY COMMAND THAT NAMES A PLACE INSIDE A `.legal` FOLDER WRITES THAT FOLDER'S IGNORE FILES FIRST.
// `.legal` holds working files with lines of the scanned code in clear (payload windows, seat records); its
// `.gitignore` keeps them out of git (legal-dir.ts). Every option of the command is looked at - its own definitions,
// with no list kept here - so a command or an option added later is covered without being named: where a value sits
// inside a `.legal` folder, the folder's ignore files are written where missing, for a folder that already exists or
// for any value the person gave on the command line (which the command may be about to create). In earlier versions only
// four output options created the folder's ignore files, and `--assemble-into`, `--carry-into`, `--out-report`,
// `--out-log`, `--legal` and `--launch-dir` were missing from that list. A default value names a folder
// only where it exists, so a command run with its defaults outside a project creates nothing. A URL is not a path.
program.hook("preAction", (_program, actionCommand) => {
  // The folder a command names with --target is the project folder, and every path
  // the command writes inside it is walked from it (project-write.ts rule 2), wherever the command runs from.
  const target = actionCommand.opts().target;
  // A --target spelled with "://" in it is read as a
  // path by every command that takes one (path.resolve), so it is a path here too.
  if (typeof target === "string" && target !== "") declareProjectFolder(target);
  // The scanned folder, and every folder holding a `.legal` the
  // command names, before anything is digested: the redaction key's place rule refuses a state folder inside either.
  if (typeof target === "string" && target !== "") noteScannedFolder(resolve(target));
  // A folder named only by an option that reads an earlier
  // record (`--previous`) is read, never written: it can be another project's. The scanned project's own `.legal` keeps
  // the write, as does any folder another option names.
  const projectLegal = typeof target === "string" && target !== "" ? resolve(target, LEGAL_DIR_NAME) : null;
  const onlyRead = legalFoldersOnlyRead(actionCommand, projectLegal);
  for (const legal of legalFoldersNamed(actionCommand)) {
    noteScannedFolder(dirname(resolve(legal)));
    if (onlyRead.has(legal)) continue;
    writeLegalIgnore(legal);
    // Where the person's own `.gitignore` or git's index lets a working file through, say so once.
    for (const line of legalIgnoreLeaks(legal)) process.stderr.write(`${line}\n`);
  }
});

program
  .command("scan")
  .description(
    `Scan a target with the rules in a bundle and write findings JSON / SARIF. After the first result the program asks the declaration questions this run's candidates turn on that have no saved answer (inside Claude Code through the plugin's hook, taken back with --declaration-from-answer; in a terminal at once; with no terminal they are listed as not asked) and runs the scan again with the answers. The saved answers this run used are stated, never asked again unless ${REVIEW_DECLARATION_FLAG} is given. Saved answers are read only once the person running the scan has confirmed them in that folder on that computer (answers the program writes there are confirmed by being written; any other saved pair is put to the person as one question, in place of the region questions). In CI (CI set, outside a Claude Code session) the scan is the rules check: no answers about the product are read, so the rules of every region run, nothing is asked, places that match rules are counted by rule name in a summary (GitHub's step summary and one check run where the token may write checks), and it exits 0 unless --fail-on-unreviewed stops it`,
  )
  .option("--bundle <dir>", `local rule bundle directory; default: ${BUNDLE_DIR_ENV}, else the bundle this package ships`)
  .option("--target <dir>", "root directory to scan; default: the current folder, and then, with no --out, the files go under ./.legal/ (--out .legal/findings.json)")
  .option(
    "--rules <ids>",
    "comma-separated rule ids: run ONLY these rules and leave everything else about the run unchanged. An id the bundle does not carry is a hard error naming it, and nothing is scanned. The candidates written are exactly the named rules' candidates, byte for byte as a whole-bundle run writes them, except adjudication_group, which divides an entire run's candidates among the agents of layer 2 - by file, and since 2026-09-17 by packing them rule by rule into bins - across all rules at once, and is therefore about the run, not about a rule. Per-run counters (stats, the rules_without_candidates roster, applicability) are likewise about the run that was asked for",
  )
  .option(
    "--read <classes>",
    "comma-separated classes of path this scan may read, or `all`. By DEFAULT a scan does not read test surfaces, vendored code or build output — what was held back is counted in every output of the run, under coverage_limits, with this flag named beside it. Classes: tests, vendored, build. A name this bundle does not declare is a hard error naming it, and nothing is scanned",
  )
  .option(
    "--profile <file>",
    "ScanProfile JSON. Its answers label what each rule reports; no answer switches a rule off. Inside a Claude Code session only the program's own declaration (profile.json beside --out, under the record the program writes when the person answers its questions) is accepted; in CI none is read, so the rules of every region run",
  )
  .option(
    "--declaration-from-answer",
    "inside a Claude Code session: take the person's answers to the round of declaration questions this scan wrote last, only from the answer the plugin's hook recorded in the person's state folder, write the declaration (profile.json and profile-record.json beside --out) and scan again with it. Refused outside a session",
  )
  .option(
    REVIEW_DECLARATION_FLAG,
    "put the saved declaration answers this run's candidates turn on back to the person as questions (inside Claude Code through the plugin's hook, a round like any other; in a terminal at once): their rows leave the record, and each is asked as a question never put. Every other run states the saved answers it used and asks none of them. Refused with no terminal and in CI, where nobody is asked (exit 1, nothing scanned); a scan run with --declaration-from-answer carries on the rounds and asks nothing again",
  )
  .option("--out <file>", "write findings JSON here")
  .option(
    "--sarif <file>",
    "write SARIF here: the coverage statements and one result counting the places that match rules, which wait for a review and are not findings (on line 1 of the workflow file that runs the step in GitHub Actions)",
  )
  .option("--sarif-matches", "also write one SARIF result per counted place, at note level: they are places that wait for a review, not findings")
  .option(
    "--changed-since <rev>",
    "count only the places on lines that HEAD adds or changes since this commit (committed changes; the working tree's uncommitted edits are not compared). In CI on a GitHub pull_request event the default is HEAD^1, the merge commit's first parent (the checkout needs fetch-depth: 2); on every other event the whole tree",
  )
  .option(
    "--fail-on-unreviewed <level>",
    "high|medium|low. Exit 3 if any counted place at or above this level waits for a review: on a comparison (--changed-since, or a pull request in CI) only places on the lines it adds or changes, else the whole tree. Places are not findings: no AI review decides them here. Outside CI, exit 4 if no rule was offered a file, which is not a pass. Omitted: never fail",
  )
  .option("--fail-on <severity>", "renamed: use --fail-on-unreviewed, which says what it counts")
  .option(
    "--jobs <n>",
    "how many worker threads scan the tree: a whole number, or `auto` (the default). `auto` is min(cores, 4, availableMB/400), floored at 1, and resolves to 1 on a tree below 256 KB of source, where a worker costs more than it saves. A number you type is used as typed, up to a ceiling of 4 per core. `--jobs 1` is the sequential engine exactly as it was: no worker thread is constructed and nothing crosses a thread boundary. The result is identical at every value - a gate asserts it byte for byte - UNLESS a file exceeds the per-file budget (--file-budget): that budget is a wall clock, workers share the machine, so the same file can take longer under more threads and be stopped at one value of --jobs and read whole at another. Such files are named in coverage_limits, in files_partially_read and in files_not_read, and a rule that had candidates only in one of them moves into rules_without_candidates. With --file-budget off, and on any scan that stops no file, this is a speed and memory choice and never a coverage one; each worker costs about 154 MB of resident memory",
  )
  .option(
    "--file-budget <seconds>",
    "how long one FILE may take before the scan stops reading it and records the file as a coverage limit: a positive number of seconds, or `off`. 60 seconds by default, which is twice the slowest real file measured in the open-source repositories this scanner was tested on - a 613 KB vendored debug build that costs 28.4 seconds - and enough that no file the walker will open reaches it on the machine it was measured on. A file that passes it keeps every candidate already raised from it and is named in coverage_limits, in files_partially_read (with the line it stopped at, and how many rules had read it) or, if no rule read a line of it, in files_not_read. This is the one option on this command that can change what a scan reports, and only on a file that passes the budget: without it, one pathological file can hold the whole scan open for hours and every later file's candidates are lost with no record that anything was skipped. Because it is a WALL clock and not a CPU clock - Node offers no per-thread CPU time inside worker_threads - a scan that stops a file is not reproducible run to run: elapsed_ms, lines_read and rules_completed move with how busy the machine is, and --jobs can change which files stop at all. Every stop is named in the document, so the difference between two such runs can always be read off it rather than guessed at",
  )
  .option(
    "--progress <mode>",
    "auto|always|never. Show the scan's progress WHILE it runs, and name the topics waiting to be reviewed when it ends. Everything it prints goes to stderr and nothing goes to stdout, so neither the summary this command prints nor the findings document changes in any mode — a gate asserts both, byte for byte. `auto` (the default) streams only when stderr is a terminal, so a pipe, a log file and every CI run are silent unless `always` is asked for. Nothing is counted for a topic until nothing left in the run can remove or alter it",
  )
  .option(
    "--progress-detail <level>",
    "topics|candidates. How much the display shows, in whichever mode --progress resolved to. `topics` (the default) shows one line that is rewritten in place — files read, elapsed, an estimate once it means anything, and how many TOPICS are waiting to be reviewed — and ends with one line per topic naming how many FILES carry a candidate. A topic is a rule pack. `candidates` additionally prints each confirmed location as its file finishes, which is the power user's view. Neither level writes to stdout, neither changes the findings document, and neither says how many candidates survive review: that is layer 2's answer, taken in your own agent",
  )
  .option(
    "--report-detail <level>",
    "full|first-screen. How much of the report this command prints to stdout. `full` prints the first screen — what was scanned, how many places worth a look in how many areas, what was not read, and what happens next — then a divider, then the whole report: every applicability limb, every coverage sentence, the silent rules, your declaration against what was found, and the candidate list. `first-screen` stops before the divider and, outside Claude Code and CI with an --out folder, writes the rest to quick-scan.txt beside the findings document and names it on the screen. The default is `first-screen` in a terminal (stdout a terminal, outside Claude Code and CI, with --out or no --target) and `full` everywhere else: a pipe, a file, CI, the plugin's run. Neither writes the findings document differently and neither changes what was scanned: the document is written before a byte of this report is composed, and it is the complete record either way",
  )
  .option(
    "--pack-groups <mode>",
    "on|off. Whether the run's candidates are PACKED into adjudication payloads of useful size before the document is written. `on` (the default) merges whole candidates, rule by rule, into bins of at most 70 locations and at most 3 rules, and each bin becomes one `adjudication_group.key` — one agent in layer 2, instead of one agent per file group. It was adopted because a layer-2 child costs about the same whatever it is handed (measured over one run on an open-source repository, 2026-09-02: 47 of 84 children held one location each and cost what a child holding fifty cost), so the run's bill is the number of children: on two repositories measured, 682 payloads became 208 and 85 became 22. `off` writes one payload per file group, which is the document this scanner wrote before packing existed, byte for byte, and it is the control arm of the comparison measurement that runs before packing is trusted. Nothing else in the document changes either way: the same candidates, the same locations, the same ids, in the same order. PRODUCT_CLI_PACK_GROUPS=0 in the environment does the same as `off`, for a harness that cannot edit an argument vector",
  )
  .option(
    "--kind-census <mode>",
    "on|off. Whether a candidate carrying more locations than one agent reads is written WHOLE, with the same-kind line groups its locations fall into and the plan for reading them, instead of being cut into parts. `on` (the default) writes `kinds` and `reading_plan` on such a candidate and counts the payload bound in reading units: one question keeps one finding_id, one verdict and one refutation. A candidate that fits one seat carries them too: its seat holds every one of its places and answers the candidate with one decision row per place. `off` cuts the candidate into parts of 70 locations with `group_part` on each, which is the document this scanner wrote before the census existed, byte for byte, and it is the control arm the census is proved identical against. What differs between the two arms is the shape of an over-bound candidate and what each location carries: the same rules fire on the same lines either way and no location is added, dropped or merged, and with the census on every location also records the clause that fired, the token it matched, its context class and its sub-shape — the four facts a same-kind group is keyed on — so the document is larger for it. PRODUCT_CLI_KIND_CENSUS=0 in the environment does the same as `off`, for a harness that cannot edit an argument vector",
  )
  .option(
    "--context-window <n>",
    "how many lines each side of a matched line the scanner copies into the per-group PAYLOAD FILES it writes beside --out: a whole number, 40 by default, or 0 to write no payload files at all. The payloads are what the adjudicating agent is handed instead of being sent to read the files itself, and THEY HOLD VERBATIM SOURCE EXCERPTS from the scanned tree - they are written under the directory --out names (the user's own .legal/ on a default run), nothing about them leaves the machine, and a person who shares one shares code. findings.json itself never holds an excerpt: it carries an index of the payload files under context_payloads. PRODUCT_CLI_CONTEXT=0 in the environment does the same as 0 here, for a harness that cannot edit an argument vector, and a --context-window you type wins over it. With the excerpts off the document is byte-for-byte the document this command wrote before they existed",
  )
  .option(
    "--no-prefilter",
    "disable the required-literal prefilter (speed-up lane step 2). The result is provably identical either way (a gate asserts it); this exists for debugging a scan you suspect the prefilter of, and it is what the runtime self-check tells you to re-run with if it ever fires. PRODUCT_CLI_PREFILTER=0 in the environment does exactly the same thing, for a harness that cannot edit an argument vector, and the `prefilter:` line this command prints reports whichever of the two was used",
  )
  .option(
    "--orientation <mode>",
    "on|off. Write an orientation sheet beside --out: orientation.json and orientation.md, the repository's manifests, declared dependencies, path classes, language census, entry points and a fixed consent-vocabulary search, computed once with no model involved. It exists because every layer-2 child used to derive the same answers for itself — 140 orientation reads and 25 repeated consent greps over 82 measured adjudicators. `on` is the default; PRODUCT_CLI_ORIENTATION=0 in the environment turns it off for a harness that cannot edit an argument vector. It is a SEPARATE file: the findings document is byte-identical either way and a gate asserts that on two real repositories. Off also skips the pass over the tree it costs. Nothing is written without --out, because the sheet is written beside the document and there is nowhere else to put it",
  )
  .action(async (opts) => {
    // A scan that runs in a session recorded in a folder
    // above the scanned one is recorded under the scanned folder (plugin-sessions.ts `recordSessionScan`), before it writes.
    try {
      recordSessionScan(processStateDir(), resolve((opts.target as string | undefined) ?? "."), process.env, new Date());
    } catch {
      // a record that cannot be written leaves the folder governed as before: by the session's own record where it lies in it
    }
    // THE READER OF STDOUT MAY GO AWAY, AND THAT MUST NOT COST THE SCAN ITS DOCUMENT.
    //
    // `… | head` closes the pipe as soon as it has its lines. Node reports the write that follows as
    // an `error` event on `process.stdout`, ASYNCHRONOUSLY, and with no listener that event is
    // thrown. WHAT WAS MEASURED, exactly (step-5 independent verification §3, 2026-09-16, which
    // isolated it with `--progress never` controls and established that it is this command's stdout
    // and not the progress display): at `--jobs >= 2` the command exited 1, deterministically, 5 runs
    // of 5, while `--jobs 1` exited 0 — and the findings document was written and byte-identical to
    // the pristine baseline in every one of those runs. So it is a WRONG EXIT CODE and not a lost
    // scan: 1 means "usage error" to a CI reading it, over a scan that in fact succeeded.
    //
    // It is repaired rather than documented because of where the throw lands. On the pool path it
    // arrives inside the worker pool's `message` handler, which is the one place in this command
    // where an exception is raised between the last worker's result and `writeFindingsJson` — the
    // document surviving is a matter of which of the two the event beats, and that is not a property
    // to leave to timing.
    //
    // Registered FIRST, before any of this command's own output, and swallowing rather than
    // re-raising: nothing this command writes to stdout is the product of the scan — the document
    // goes to `--out`, the SARIF to `--sarif` — so a stream that cannot be written to has lost
    // provenance and a summary, never a finding. EPIPE is named because it is the one this is for;
    // any other error on a stream nobody is reading has the same remedy, which is to stop writing.
    // Exit codes are decided below, by `--fail-on-unreviewed` and by the engine, exactly as they were.
    process.stdout.on("error", () => {
      // DELIBERATELY EMPTY, and that is the whole of the repair. There is no single funnel for this
      // command's stdout writes to latch off the way `progress.ts` latches its own, and there does
      // not need to be: every one of them is `console.log`, which already ignores a SYNCHRONOUS
      // write failure. What was killing the scan is the ASYNCHRONOUS `error` event, and a listener —
      // any listener — is what turns that from a throw into nothing at all.
    });
    // THE BARE COMMAND: `scan` with no
    // --target scans the folder it is run in and, with no --out either, writes its files where the plugin's run writes
    // them, ./.legal/ (the README's one line of the free try). A --target given without --out writes nothing, as before:
    // the gate tools scan fixture trees that way and read stdout only.
    if (opts.target === undefined) {
      opts.target = ".";
      if (opts.out === undefined) opts.out = join(LEGAL_DIR_NAME, "findings.json");
    }
    // Commander gives `opts.prefilter === false` only when `--no-prefilter` was actually typed —
    // there is no positive `--prefilter` flag to distinguish "explicitly on" from "defaulted on" —
    // so this is the one and only way the CLI can know the user asked for it explicitly, and it
    // wins over whatever `PRODUCT_CLI_PREFILTER` already says by simply overwriting it right before
    // the scan runs. `runBuiltin` (engine.ts `resolvePrefilterRuntimeOptions`) reads the SAME
    // variable when no explicit override reaches it, which is how `test-rules.ts` and any other
    // harness that shells out get the identical switch without this file threading a second copy of
    // it through `ScanOptions`. Left untouched when the flag is absent, so a `PRODUCT_CLI_PREFILTER`
    // already set in the environment (the "equivalent for harnesses" case) is never clobbered back on.
    if (opts.prefilter === false) process.env.PRODUCT_CLI_PREFILTER = "0";
    // Resolved HERE, through the engine's own resolver and before a single file is read, for two
    // reasons. A malformed `PRODUCT_CLI_PREFILTER_SELFCHECK` is refused now, with the CLI's own
    // message, rather than surfacing as a stack trace from inside a scan that has already run for
    // twenty minutes. And the `prefilter:` line below reports what the ENGINE resolved
    // rather than what this command was told: `PRODUCT_CLI_PREFILTER=0` with no flag disables the
    // filter, and the line used to say `on` anyway. One resolver, read twice — the
    // precedence between flag and environment is stated in exactly one place, `engine.ts`.
    const prefilterState = throughTheEngine(() => resolvePrefilterRuntimeOptions());
    // Resolved before the bundle is loaded, for the same reason the prefilter switch is: a `--jobs`
    // value this CLI cannot act on must be refused with a message, now, rather than after a scan
    // has read a tree. `auto` reads this machine's cores and available memory — see `resolveJobs`
    // (engine-pool.ts) for the cgroup quota and the `MemAvailable` reading, both of which exist so
    // that a container is measured rather than the host it sits on.
    const jobs = throughTheEngine(() => resolveJobs(opts.jobs));
    // Resolved here, for the third time on the same reasoning as the two above: a `--file-budget`
    // this CLI cannot act on is refused before a tree is read, not after. The DEFAULT LIVES IN THE
    // RESOLVER, not in this file — `resolveFileBudgetMs(undefined)` is 60 seconds — so the CLI
    // carries no second copy of the decided number.
    const fileBudgetMs = throughTheEngine(() => resolveFileBudgetMs(opts.fileBudget));
    // Resolved here for the fourth time on the same reasoning: `--pack-groups banana` is refused with
    // a message before a tree is read, not after. The PRECEDENCE between the flag and
    // `PRODUCT_CLI_PACK_GROUPS` lives in the resolver, in `scan.ts`, and is not restated here.
    const packGroups = throughTheEngine(() => resolvePackGroups(opts.packGroups));
    // The kind census, resolved on the same reasoning and in the same place: `--kind-census banana`
    // is refused with a message before a tree is read. The PRECEDENCE between the flag and
    // `PRODUCT_CLI_KIND_CENSUS` lives in the resolver, in `scan.ts`, and is not restated here.
    const kindCensus = throughTheEngine(() => resolveKindCensus(opts.kindCensus));
    // Resolved before the bundle is loaded, for the reason `--jobs` and the prefilter switch are:
    // a value this CLI cannot act on is refused now, with a message, rather than after a tree has
    // been read. The DISPLAY itself is built a few lines below, once the rule selection exists —
    // it needs the severities and the streamable set of the rules this run will actually compile.
    const progressMode = throughTheEngine(() => resolveProgressMode(opts.progress));
    // The DETAIL level, resolved beside the mode and for the same reason: a value this CLI cannot
    // act on is refused before a tree is read. `topics` is the default — the
    // display exists for the waiting experience, and a wall of matched lines is not that.
    const progressDetail = throughTheEngine(() => resolveProgressDetail(opts.progressDetail));
    // `--report-detail`, resolved here for the reason every option above it is: a value this CLI
    // cannot act on is refused before a tree is read, not after. `full` is the default (owner,
    // 2026-09-16) — nothing this command printed before is removed from the default output. Unset, the default is `first-screen` on a
    // person's terminal where there is an --out folder for the rest (`QUICK_SCAN_DETAIL_FILE`), `full` everywhere else. And in a Claude Code session with an --out
    // folder: what the scan prints there reaches the person's screen through the skill, and the paid run of 2026-11-12
    // showed all 146 lines of it, the applicability limbs whole, before the person was asked anything.
    const reportDetail = throughTheEngine(() => resolveReportDetail(opts.reportDetail, opts.out !== undefined && (personsScreen(process.env) || claudeCodeSigns(process.env).length > 0)));
    // `--context-window`, resolved here for the reason every option above it is: a value this CLI
    // cannot act on is refused before a tree is read, not after. THE DEFAULT LIVES IN THE RESOLVER
    // (`DEFAULT_CONTEXT_WINDOW`, 40 lines each side), so this file carries no second copy of it,
    // and the resolver is also where `PRODUCT_CLI_CONTEXT=0` is read — a typed flag wins over it.
    const contextWindow = throughTheEngine(() => resolveContextWindow(opts.contextWindow));
    /**
     * How many payload files of an EARLIER run of this scanner were removed from the payload
     * directory before this run wrote its own. Provenance for the console line
     * only: it is a fact about the directory and not about the tree, so it is deliberately not a
     * field of the findings document.
     */
    let stalePayloadsRemoved = 0;
    // `--orientation`, resolved here for the reason every option above it is: a value this CLI cannot
    // act on is refused before a tree is read, not after. `on` is the default, and the flag wins over
    // `PRODUCT_CLI_ORIENTATION` for the same reason `--no-prefilter` wins over `PRODUCT_CLI_PREFILTER`
    // — an argument somebody typed is a stronger statement than an environment somebody inherited.
    const orientationOn = throughTheEngine(() => resolveOrientation(opts.orientation));
    // `--rules` narrows the bundle at exactly one point: after the integrity check, which is about
    // the published bundle and not about this run's selection, and before the first read of
    // `bundle.rules`. So the structural runtime is started on the SELECTION's account (a selection
    // that declares no structural check loads no grammar), the engine compiles the selection, and
    // the roster, the summary and the SARIF run all describe the selection — with no second copy of
    // the predicate anywhere downstream. See `selectRules` in bundle.ts.
    // No --bundle: LEGAL_BUNDLE_DIR, else the bundle shipped with this program; every failure one plain sentence
    // (bundle.ts openBundle). `opened.shipped` is said on the first screen.
    const opened = openBundle("scan", opts.bundle);
    const bundle = narrowToNamedRules(opened, opts.rules);
    const targetRoot = resolve(opts.target);
    // Never this program's own files counted as the
    // project's: refused, nothing read, where the scanned folder holds them where the walk reads (own-install.ts).
    const ownFiles = ownFilesInsideTarget(targetRoot, opened.dir);
    if (ownFiles !== null) {
      console.error(ownFilesRefusal(ownFiles));
      process.exit(1);
    }
    // `--read` is read against the classes THIS BUNDLE declares, so the CLI never carries a second
    // list of class names: an old bundle declares none and says so in the coverage block, and a
    // bundle that grows a fourth class accepts it the day it ships. A name the bundle does not
    // declare is refused before anything is scanned, on the same reasoning `--rules` is: a mistyped
    // class that quietly read nothing would produce the document a correct run produces minus the
    // files the person asked for, with nothing in the output naming the mistake.
    const read = readClasses(bundle, opts.read);
    // `undefined` whenever the stream is off — `--progress never`, or `auto` with stderr not a
    // terminal, which is every gate tool and every piped run. With it undefined, `prepareScan` opens
    // nothing, no listener is registered and every seam in the engine is one optional read. (The
    // display no longer stats anything in any mode: it reads the sizes the walker already took —
    // `WalkResult.sizes`.)
    //
    // HOW `--jobs` RESOLVED IS NOT HANDED IN HERE. It reaches the display at `start`, from inside
    // `prepareScan`, because the last term of `auto` is the size of the tree and the tree has not
    // been walked yet at this line — see `ScanOptions.jobs`.
    //
    // THE DECLARATION, BEFORE ANY COST (relay item 7): the refusals that write nothing (--declaration-from-answer
    // outside a session, a session's round with no one place, a prose --profile inside one, an answer the hook's records
    // do not bind), then the file the
    // first pass reads. The scan below is ONE PASS, run again with the declaration where answers arrive after the first
    // result (the terminal path); its body keeps its indentation so that the change shows as the change it is.
    // THE RULES CHECK'S USAGE, BEFORE ANY COST: the renamed gate, its level, and the comparison
    // that chooses which places are counted. A base that is not in the checkout is a misconfigured step (exit 1).
    if (opts.failOn !== undefined) {
      console.error("--fail-on is renamed --fail-on-unreviewed <level>: it counts places that match rules and wait for a review, which are not findings. Nothing was scanned.");
      process.exit(1);
    }
    const gateLevel = opts.failOnUnreviewed as "high" | "medium" | "low" | undefined;
    if (gateLevel !== undefined && !["high", "medium", "low"].includes(gateLevel)) {
      console.error("--fail-on-unreviewed must be one of: high, medium, low. Nothing was scanned.");
      process.exit(1);
    }
    // The rules check: CI and no Claude Code session (its comparison with the pull request's base, its check run, its
    // annotations).
    const ciForm = declarationPathOf(process.env) === "ci";
    /* WHAT THE LOG GETS: in CI, the CI form, whatever else is
     * in the environment. Until 2026-11-11 a Claude Code sign put a scan in CI on the session's path before CI was tested
     * (`declarationPathOf`), and the first screen, with its candidate rows by line, severity and law, went into a job log
     * anyone can read on a public repository. A session in CI keeps everything else of the session (its relay, its
     * payloads, its report files); only what is printed changes. */
    const ciLog = ciSet(process.env);
    // Under GitHub Actions the rules check prints with workflow commands stopped (ci-check.ts `stopWorkflowCommands`): its
    // report and its summary hold repository text, and only the program's own annotations run as commands (C4 item 2).
    const commandsStopped = ciLog && process.env[GITHUB_ACTIONS_ENV] === "true" ? stopWorkflowCommands() : null;
    // The pull request's or the queued entry's
    // own lines, whatever the job checked out, or a refusal naming the fix (ci-check.ts `ciBase`).
    const found = opts.changedSince === undefined && ciForm ? ciBase(process.env, targetRoot) : null;
    if (found !== null && "why" in found) {
      const what = process.env[GITHUB_EVENT_NAME_ENV] === "merge_group" ? "this merge queue entry" : "this pull request";
      console.error(`The rules check counts the places on lines ${what} adds or changes, and there is no comparison: ${ciText(found.why)}. Nothing was scanned.`);
      process.exit(1);
    }
    const base: string | null = opts.changedSince ?? found?.base ?? null;
    let changed: ChangedLines | null = null;
    if (base !== null) {
      const got = changedLinesOrWhy(targetRoot, base);
      if ("why" in got) {
        console.error(`The places this scan counts are those on lines changed since ${ciText(base)}, and there is no comparison: ${ciText(got.why)}. Nothing was scanned.`);
        process.exit(1);
      }
      changed = got;
    }
    const declaration = declarationBeforeScan(opts, bundle.rules);
    if (declaration === null) return;
    // The variable and its value are named, since a terminal where CI is set takes this path too.
    if (declaration === "ci") console.log(`CI: ${CI_ENV}=${JSON.stringify(process.env[CI_ENV] ?? "")} is set in this environment, so outside a Claude Code session this scan is the rules check: it reads no answers about the product and asks nothing.`);
    if (declaration === "ci" && opts.profile) console.log(`--profile ${opts.profile} is not read: in CI no answers about the product are read, so the rules of every region run.`);
    if (declaration === "ci" && opts.reportDetail !== undefined) {
      console.log(
        `--report-detail ${reportDetail} is not used in CI: the rules check prints its summary, which counts places by rule name and lists none, because a place listed by line reads as a finding and it is not one.${opts.out ? " The places are in the file --out names." : ""}`,
      );
    }
    // Outside Claude Code and CI the
    // first screen ends with the next step, and where it is all the screen shows (a person's terminal by default, or
    // `--report-detail first-screen`) and there is an --out folder, the rest is written beside the document.
    const nextStepShown = !ciForm && claudeCodeSigns(process.env).length === 0;
    // In a session too (the next step is not printed there: the person is in it), and
    // never in CI, whose log prints no local report.
    const detailPath = reportDetail === "first-screen" && opts.out && !ciForm && !ciLog ? join(dirname(resolve(opts.out)), QUICK_SCAN_DETAIL_FILE) : null;
    // The first screen a person's terminal showed, so that the pass the declaration
    // runs again shows only what the answers changed on it (`screenAgainLines`); the detail file holds the whole screen.
    let screenShown: string[] | null = null;
    const scanPass = async (profilePath: string | undefined): Promise<ScanPassResult> => {
    const progress = createProgress(progressMode, progressDetail, bundle.rules);
    // What writing the files has to tell the person, printed after the first
    // screen rather than before it.
    const notesAfterScreen: string[] = [];
    // The runtime self-check (proposal §E.3) stops a scan rather than letting it finish and report
    // "no problems found" over a line the prefilter provably should not have skipped. `throughTheEngine`
    // is what turns that into the four-line report and exit 1, here and on `test-rules` alike. A scope answer settles rules only where this pass reads the
    // program's declaration under its record (read again here: a take or the terminal has just written it); a
    // --profile of another file, or no declaration, settles nothing.
    const step = declaration === "ci" ? null : declaration;
    const ownDeclaration = step !== null && profilePath !== undefined && resolve(profilePath) === resolve(step.c.declared.profilePath) ? readDeclaration(step.c.dir) : null;
    const scopeSettlements = step !== null && ownDeclaration !== null ? scopeSettlementsOf(step.c.source, ownDeclaration) : [];
    // An answer recorded at an earlier version of a
    // question nothing asks before review is read as unanswered (the pre-launch step leaves out the same).
    const profileLeftOut = step !== null && ownDeclaration !== null ? staleOrderFields(step.c.source, ownDeclaration) : [];
    const scanOptions = {
      bundle,
      targetRoot,
      read,
      profilePath,
      scopeSettlements,
      profileLeftOut,
      // THE ONE PATH ON WHICH THE BUDGET IS ON BY DEFAULT. Every other
      // caller of `runScan` — the gate tools, the mutation harness, the fixtures runner — leaves it
      // absent and gets no budget, because a wall-clock ceiling inside a gate would make that gate's
      // output depend on how busy the machine was. See `scanShard` in engine.ts.
      fileBudgetMs,
      progress,
      // UNFINISHED ON PURPOSE — `resolveJobs` above has refused anything this CLI cannot act on,
      // before a byte was read, and `prepareScan` applies the one term that needs the walk. See
      // `ScanOptions.jobs`, and `prepared.jobs` below for the answer.
      jobs,
      // Already resolved (above), so `runScan` reads a boolean and never an argument vector. Absent
      // from every other caller of `runScan`, which is what leaves the environment in charge there.
      packGroups,
      // The same, for the kind census: the one caller that has a flag to read resolves it and hands
      // the boolean over; a gate or a harness passes nothing and the environment decides for it.
      kindCensus,
    };
    // THE WALK, TAKEN HERE AND ONCE — because the LAST term of `auto` is the size of the tree, and
    // the tree does not exist until it has been walked. `resolveJobs` above has already refused a
    // `--jobs` value this CLI cannot act on, before anything was read, which is the part that has to
    // happen early; the NUMBER `auto` produces is finished INSIDE this call (`jobsForWalk`, applied
    // where the byte total first exists and before the display is opened). `prepareScan` also PRINTS
    // the scan-profile report, so it is called once and handed to whichever path runs — never twice.
    const prepared = throughTheEngine(() => prepareScan(scanOptions));
    // THE ANSWER, READ BACK — not computed a second time here. `prepareScan` applied `jobsForWalk`
    // one statement before it opened the display, so the number on the display's opening line and
    // the number this command prints below are the same resolution; deciding it here instead is what
    // made a small tree say `jobs 4` on stderr and `jobs: 1 (auto: tree below 256 KB, sequential)`
    // on stdout (open item 4 of the closing merge, repaired 2026-09-16).
    //
    // NO `stat` PASS OF ITS OWN EITHER. The tree-size term reads the walker's own sizes summed, and
    // the pool is handed the same array through `prepared`, so the tree is stat'ed once — by the
    // walk. Until this repair a `--jobs >= 2` run stat'ed every walked file a second time here,
    // 5,721 of them on a large Node CMS (independent verification note §9.1, 2026-09-16).
    //
    // `?? jobs` is unreachable: `scanOptions.jobs` above is always set, so `prepareScan` always
    // returns a resolution. It is written as a fallback rather than an assertion because the value
    // it falls back to is the number this line would otherwise have used itself.
    const jobsForThisTree = prepared.jobs ?? jobs;
    // THE GRAMMARS ARE LOADED BY THE THREAD THAT PARSES, AND NO OTHER. On the sharded path this
    // thread scans no file — every parse happens in a worker, each of which awaits
    // `prepareStructural()` itself (worker-entry.ts) — so loading ten wasm grammars here bought a
    // grammar cache nothing on the scan path would ever read. `doctor` is the
    // only other consumer of that cache and it prepares its own. Nothing between this line and the
    // scan reads a parse tree, so the load is simply moved to the branch that needs it.
    if (jobsForThisTree.jobs === 1) await prepareStructuralIfDeclared(bundle);
    // ONE SCAN, TWO WAYS OF RUNNING IT. `--jobs 1` is `runScan` itself — the synchronous engine two
    // gate tools consume synchronously (two tools), with
    // no `Worker` constructed, no structured clone and no second copy of the bundle in memory.
    // Anything above 1 runs the same per-file scan in worker threads and the same `mergeShards` over
    // what they return; both assemble the document through the same `runScan` body, over the same
    // `prepared` walk.
    const findings =
      jobsForThisTree.jobs === 1
        ? throughTheEngine(() => runScan(scanOptions, prepared))
        : await throughTheEngineAsync(() => runScanSharded(scanOptions, jobsForThisTree, opts.rules, prepared));

    if (opts.out) {
      prepareOutputFolder(resolve(opts.out));
      // Findings written into a `.legal` folder: its `.ignore` too, where there is none (one writer,
      // hook-launch.ts writeLegalIgnore, which the run's start calls as well).
      if (basename(dirname(resolve(opts.out))) === LEGAL_DIR_NAME) writeLegalIgnore(dirname(resolve(opts.out)));
      // THE SOURCE EXCERPTS, WRITTEN BESIDE THE DOCUMENT AND NEVER INSIDE IT.
      // One payload file per
      // `adjudication_group.key`, each holding that group's candidates and the verbatim
      // neighbourhood of every matched line, so the orchestrator hands a child one small file's
      // contents inline instead of sending it to read the tree. A large Node CMS's document would be 34 MB
      // with the excerpts in it and is 19.7 MB with them beside it - see context.ts.
      //
      // AFTER BOTH SCAN PATHS HAVE CONVERGED, deliberately: this runs on the main thread over the
      // one merged `Findings` object and reads the files itself, so there is no second
      // implementation for `--jobs` to disagree with and no excerpt crosses a thread boundary.
      //
      // ASSIGNED ONTO `findings` RATHER THAN BUILT INSIDE `runScan`, because the payload directory
      // is derived from `--out`, which `runScan` neither takes nor should: a caller with no `--out`
      // has nowhere to put payload files, and `runScan` stays the pure assembly of the document
      // that two tools consume in process. The key
      // lands LAST in the document because `writeFindingsJson` writes `Object.keys` order.
      if (contextWindow > 0) {
        const written = writeContextPayloads({
          findings,
          targetRoot,
          outPath: resolve(opts.out),
          windowLines: contextWindow,
          // The place form (full-read design 1.2-1.4; build unit F2) where the scan wrote the place plan.
          placeForm: kindCensus,
          // Data summaries (build unit F6) stay off in the product until their capture exists.
          dataSummaries: false,
          // The self-name answer, where the profile the scan read holds one (none in CI).
          profile: prepared.profile,
          rules: bundle.rules,
        });
        // Where the root manifests contradict the self-name answer, the person is asked to
        // check it (the premise never decides; the seats are told it too).
        const vendor = vendorSoftwareOf(prepared.profile);
        if (vendor) {
          const rule = bundle.rules.find((r) => SELF_NAME_RULES.has(r.id) && r.detector?.vocabulary_owners !== undefined && Object.values(r.detector.vocabulary_owners).some((l) => Object.values(l).includes(vendor.entry)));
          const names = manifestNamesOf(targetRoot);
          // A manifest's name and the answer are the project's text: each
          // control character written as an escape (printed-output.ts `valueText`), so neither starts a line of its own.
          const shownNames = names.map((n) => ({ ...n, file: valueText(n.file), name: valueText(n.name) }));
          if (ownNamePremiseOf(vendor, names, nameWordsOf(rule, vendor.entry)) === "contradicts") notesAfterScreen.push(contradictionSentence({ ...vendor, entry: valueText(vendor.entry) }, shownNames, reviewDeclarationCommand()));
        }
        if (written) {
          findings.context_payloads = written.index;
          // Reported on the provenance line below rather than written into the document: it is a
          // fact about the DIRECTORY this run found, not about the tree it scanned, and two runs of
          // one tree would disagree on it — the first finds stale files, the second finds none —
          // which is exactly the kind of field that makes a document stop being a pure function of
          // the tree (see the `scan_id` note in context.ts).
          stalePayloadsRemoved = written.stale_removed;
        }
      }
      // Streamed rather than `writeFileSync(path, JSON.stringify(findings, null, 2))`: a tree dense
      // enough with distinct matched lines can make that single string longer than V8 allows,
      // throwing `RangeError: Invalid string length` after detection has already finished. See
      // findings-writer.ts for why this produces byte-identical output. The document's sha256 in the state folder, as the declaration plan's (log-digest.ts).
      const findingsWritten = writeFindingsJson(resolve(opts.out), findings);
      const findingsBound = recordLogDigest(processStateDir(), targetRoot, findingsDigestName(resolve(opts.out)), findingsWritten.sha256);
      if (!findingsBound.written) {
        // After the first screen; where the state folder's place is the cause, in
        // plain words and once a run (a terminal's second pass meets the same place).
        const note = findingsBound.placeRefused === true ? stateFolderPlaceNote(processStateDir(), targetRoot) : FINDINGS_DIGEST_WORDS.notRecorded(findingsBound.why);
        if (note !== null) notesAfterScreen.push(note);
      }
    }
    if (opts.sarif) {
      const sarifPath = resolve(opts.sarif);
      prepareOutputFolder(sarifPath);
      // Never silently cut (sarif.ts, splitSarifForGithub): a document over GitHub code scanning's
      // limits is written as several files, each read whole, and the person is told here. Part files
      // a previous, larger run left beside this one are removed first, so none is uploaded stale.
      const split = splitSarifForGithub(
        toSarif(findings, bundle.rules, {
          matches: opts.sarifMatches === true,
          counted: (l) => onChangedLines(changed, l),
          scope: changed === null ? "tree" : "changed",
          noteAt: workflowFile(process.env, targetRoot),
        }),
      );
      for (let n = 2; existsSync(sarifPartPath(sarifPath, n)); n++) removePath(sarifPartPath(sarifPath, n));
      split.parts.forEach((part, i) => writeFileAt(sarifPartPath(sarifPath, i + 1), part.text));
      if (split.parts.length > 1) {
        console.log(
          `SARIF: this scan has ${split.totalResults} results, more than GitHub code scanning reads from one upload ` +
            `(${GITHUB_RESULTS_PER_RUN} results of a run, ${GITHUB_GZIP_BYTES_PER_FILE / 1024 / 1024} MB compressed per file). ` +
            `Nothing was left out: they are written as ${split.parts.length} files, each read whole - ` +
            `${split.parts.map((p, i) => `${sarifPartPath(sarifPath, i + 1)} (${p.results})`).join(", ")}. ` +
            `Upload every one: each carries its own category (${PROGRAM_NAME}/part-<n>/, n from 1 to ${split.parts.length}), and the coverage statements are in the first.`,
        );
      }
    }

    // THE ORIENTATION SHEET (unit C, 2026-09-17), written AFTER the findings document and never into
    // it. Two properties this placement buys and that a test asserts: the
    // document above is written from `findings` alone, so the sheet cannot change a byte of it; and a
    // failure here — an unreadable tree, a manifest that will not parse — cannot cost the scan its
    // document, because the document is already on disk.
    //
    // It goes beside `--out` because that is where the skill's `.legal/` directory is and the sheet
    // is read with the document. With no `--out` there is no such directory to write into, and this
    // command invents none.
    if (orientationOn && opts.out) {
      const outDir = dirname(resolve(opts.out));
      // Built in `orientation-inputs.ts`, a listed verdict-rules source and a root of the closure the version gate
      // derives: how the sheet is made is a premise of every verdict.
      const sheet = orientationSheetFor({
        targetRoot,
        walked: prepared.walked,
        readScope: prepared.readScope,
        bundleReadScope: bundle.readScope,
        dependencyInventory: findings.dependency_inventory,
        bundleVersion: bundle.manifest.bundle_version,
      });
      writeFileAt(join(outDir, "orientation.json"), `${JSON.stringify(sheet, null, 2)}\n`);
      writeFileAt(join(outDir, "orientation.md"), renderOrientationMarkdown(sheet));
      // The scan this sheet was made for, so that no later scan's briefs name it.
      writeFileAt(join(outDir, ORIENTATION_SCAN_FILE), orientationScanText(findings.scan_id));
    }

    // THE STREAM IS CLOSED BEFORE THE SUMMARY IS PRINTED, and after the document has been written,
    // so that its last line can name the file and so that stderr is finished before stdout starts.
    // A reader whose terminal carries both sees the closing count, then the summary the counts are
    // reconciled against; a reader who redirected one of the two sees a complete stream either way.
    // THE CLOSING BLOCK IS COUNTED FROM THE DOCUMENT (parent decision, 2026-09-16): `findings` is
    // the document just written above (`writeFindingsJson`), so the block reports what the merge
    // decided rather than what could be confirmed file by file while the walk was going.
    // See `finish` in progress.ts.
    progress?.finish({ outPath: opts.out ? resolve(opts.out) : null, findings });

    // Printed BEFORE the summary, on every run, with or without `--fail-on-unreviewed`: a reader whose only
    // mistake was a typo must not be sent off to audit code the scanner never opened. The scan still
    // runs, still writes its outputs and still exits as it did — only the sentence is new.
    const pathProblem = targetPathProblem(targetRoot);
    if (pathProblem) console.log(`${pathProblem} Nothing below is about a repository.\n`);
    // THE FIRST SCREEN, AND WHY IT IS PRINTED HERE AND NOT INSIDE `summarize()`.
    //
    // `summarize(f, rules)` is a pure function of the written document and is exported — the eval
    // tooling calls it on documents this version did not write. The first screen needs three things
    // the document does not carry (how `--jobs` resolved, what the per-file budget was, and where
    // `--out` put the file), so it takes them as arguments here rather than widening that function's
    // contract. Everything else it prints, it reads off `findings`.
    //
    // THE SCAN-PROFILE BLOCK IS STILL THE FIRST THING ON STDOUT, and nothing here changes that: it
    // is printed by `prepareScan`, before the walk, which is several seconds before this line runs.
    // A test asserts `stdout.trimStart().startsWith("SCAN PROFILE …")`, and
    // it should: a profile the schema rejected is the first thing to fix. In every form, a person's terminal
    // included, every printer below reads `shown`, the document with each string as ci-check.ts `ciShown` prints it (a
    // line break of a path or a line escaped, which the printed form at the write cannot tell from the program's own);
    // the written document and the counts keep `findings`.
    const shown = ciShownCopy(findings);
    const firstScreen = firstScreenLines(shown, bundle.rules, {
      targetRoot,
      jobs: jobsForThisTree.jobs,
      fileBudgetMs,
      outPath: opts.out ? resolve(opts.out) : null,
      bundle: { dir: opened.dir, from: opened.from, shipped: opened.shipped },
    });
    // THE CI FORM PRINTS NO LOCAL REPORT: its first screen
    // counts the whole tree by area and its candidate rows list unjudged places by line with their severity and law, in a
    // job log anyone can read on a public repository, beside a summary that counts the pull request's own lines. What the
    // rules check prints is the summary (mock M11: places counted by rule name, never listed by line); the places are in
    // the documents --out and --sarif write.
    const report = ciLog ? "none" : reportDetail;
    if (report !== "none") console.log((screenShown !== null && nextStepShown ? screenAgainLines(screenShown, firstScreen) : firstScreen).join("\n"));
    if (screenShown === null && report !== "none") screenShown = firstScreen;
    // WHAT FOLLOWS THE FIRST SCREEN. The
    // full section is composed into `detail` in every form that keeps it: under `full` it is printed below the divider,
    // as before; where the screen shows the first screen only and there is an --out folder (outside Claude Code and CI),
    // it is written to `QUICK_SCAN_DETAIL_FILE` beside the document, after the first screen, and the screen names the
    // file. Outside Claude Code and CI the first screen then ends with the next step; the notes the file writes raised
    // (`notesAfterScreen`) follow it, so nothing is printed before the first screen but a mistyped target's sentence.
    const detail: string[] = [];
    const full = (text: string): void => {
      detail.push(text);
    };
    let divider: string[] = [];
    const writesFull = report === "full" || detailPath !== null;
    // `first-screen` STOPS HERE, and the divider is not printed with it. The divider's sentence says
    // the full report follows and how to stop before it; printing it under `--report-detail
    // first-screen` would be this command contradicting itself on the next line, over a run where
    // nothing follows. Under `full` — the default — the divider is printed and NOTHING that was
    // printed before this change is removed.
    if (writesFull) {
      // The divider names how many candidate lines are below it, so the count is taken from the
      // same grouping `summarize()` prints rather than from the record count: the per-topic cap
      // means the two are different numbers, and the record count is on the `document` line above.
      // On stdout only: the detail file holds no divider, since nothing in it is "below" a screen.
      divider = ["", ...dividerLines(candidateLineCount(candidateTopics(shown, bundle.rules)))];
      // The shipped bundle, named by version and digest: below the divider; a bundle
      // that is not the shipped one is named on the first screen itself (report.ts firstScreenLines).
      if (opened.shipped === true) full(bundleNamedLines(shown, { targetRoot, jobs: jobsForThisTree.jobs, fileBudgetMs, outPath: opts.out ? resolve(opts.out) : null, bundle: { dir: opened.dir, from: opened.from, shipped: opened.shipped } }).join("\n"));
      full("");
      full(summarize(shown, bundle.rules));
    }
    // THE THREE PROVENANCE LINES BELONG TO THE FULL SECTION (proposal §A8), so `first-screen` does
    // not print them: they say how the scan was run, which is what a reader comparing two runs needs
    // and not what a reader deciding where to look next needs. Under `full` — the default, and what
    // every gate runs — they are printed exactly as they were, AT COLUMN 0, because
    // two tests and
    // a test match them with `^…$`-anchored regexes.
    if (writesFull) {
      // Provenance only — never a field of `findings.json` (proposal §H4/§E.4): the filter provably
      // removes no candidate, so a run's OUTPUT never depends on this line, and it is what lets the
      // byte-identity comparison between prefilter on and off stay meaningful. It reports the state
      // the ENGINE RESOLVED, with the switch that decided it named, because a provenance line that can
      // be wrong is worse than no line at all — `PRODUCT_CLI_PREFILTER=0` disabled the filter and this
      // line said `on`, which is the opposite of what the `--no-prefilter` help text
      // promises. `opts.prefilter === false` still distinguishes the flag from the variable, since the
      // flag's only effect is to set the variable and the resolver cannot tell them apart afterwards.
      full(
        `prefilter: ${prefilterState.enabled ? "on" : opts.prefilter === false ? "off (--no-prefilter)" : "off (PRODUCT_CLI_PREFILTER=0)"}`,
      );
      // Provenance, like the line above it: the excerpts provably change no candidate - they are
      // copied out of files the scan has already read, after every verdict layer 1 takes - so a
      // reader comparing two runs needs to be able to see whether this one wrote them and how wide
      // they were. It reports the RESOLVED setting with the switch that decided it named, for the
      // reason the prefilter line does: `PRODUCT_CLI_CONTEXT=0` with no flag turns them off, and a
      // line that says `40` over a run that wrote nothing is worse than no line at all.
      full(
        contextWindow > 0
          ? `context: ${contextWindow} lines each side${opts.contextWindow === undefined ? "" : " (--context-window)"}${
              opts.out ? "" : " (no --out: no payload file written)"
            }${
              stalePayloadsRemoved > 0
                ? ` (${stalePayloadsRemoved} payload file(s) this scanner wrote to that directory on an earlier run were removed: they held source excerpts of a tree state this run no longer describes)`
                : ""
            }`
          : `context: off (${opts.contextWindow === undefined ? "PRODUCT_CLI_CONTEXT=0" : "--context-window 0"})`,
      );
      // THE BYTE CAP'S EFFECT ON THIS RUN, beside the context line because it is the same fact seen
      // from the child's side: how many bins were divided so that no child is handed more than the
      // cap, and how many payloads are over it anyway. The second number is the one that matters and
      // is the one nothing can lower — a candidate is one seat, so its payload is written whole
      // rather than shortened, and the run says so here instead of letting the orchestrator find out
      // by pasting it. Printed only where the cap did something, so a run it never bound does not
      // grow a line that always says zero.
      const capIndex = findings.context_payloads;
      if (
        capIndex?.max_bytes_per_payload !== undefined &&
        ((capIndex.bins_divided_by_cap ?? 0) > 0 || (capIndex.payloads_oversized ?? 0) > 0)
      ) {
        full(
          `payload cap: ${capIndex.max_bytes_per_payload} bytes per payload holding more than one candidate` +
            ` — ${capIndex.bins_divided_by_cap} bin(s) divided, ${capIndex.payloads_oversized} payload(s) over the cap` +
            ` (one candidate each, written whole)`,
        );
      }
      // Provenance, like the line above it and for the same reason: the number of threads provably
      // changes no candidate, so a reader who compares two runs needs to be able to see which one was
      // sharded. `sequential` is named rather than implied, because `--jobs 1` is a different code
      // path and not a pool of size one. Nothing machine-specific is printed — a line that moved with
      // the box's free memory would make two runs of the same tree differ on paper — and the one
      // reason that IS printed, `auto: tree below 256 KB`, is a property of the tree, so two runs of
      // one tree still read the same.
      full(`jobs: ${jobsForThisTree.jobs}${jobsLineSuffix(jobsForThisTree)}`);
      // Which rule bundle ran, its folder and its whole digest; the first screen's `rules` field
      // says the same in short. The skill reads a rule's questions from this folder's rules.json. Whether it is the
      // shipped bundle is said in the terminal's one phrase (report.ts `SHIPPED_WORDS`, `notShippedWords`).
      full(
        `bundle: ${opened.dir} (${bundle.manifest.bundle_version}, sha256 ${opened.digest}, ` +
          `${opened.shipped === true ? SHIPPED_WORDS : opened.shipped === false ? notShippedWords("checks") : "this program carries no bundle of its own to compare it with"})`,
      );
      // THE ONE PROVENANCE LINE HERE THAT IS NOT ONLY PROVENANCE. The two above it report settings
      // that provably change no candidate; this one reports a setting that can, so it prints the
      // budget AND what it did — and the count is read from the document rather than from a variable
      // this file keeps, so the line cannot say 0 while `findings.json` names a stopped file. The
      // count is absent from the document exactly when it is 0 (see `stats.files_stopped_for_time`),
      // which is what `?? 0` is reading.
      const stoppedForTime = findings.stats?.files_stopped_for_time ?? 0;
      // NAME ONLY THE ARRAYS THAT HAVE A ROW. This line used to name both of them on every stop, so a
      // run whose files were all stopped before their first line sent the reader to a
      // `files_partially_read` that was `[]`.
      // Read off the document, like the count above it, so the line cannot name an array the document
      // does not fill.
      const namedIn = [
        "coverage_limits",
        ...((findings.files_partially_read ?? []).some((p) => p.stopped_for_time !== undefined)
          ? ["files_partially_read"]
          : []),
        ...((findings.files_not_read ?? []).some((f) => f.reason === "time-budget") ? ["files_not_read"] : []),
      ];
      full(
        `file budget: ${
          Number.isFinite(fileBudgetMs) ? `${fileBudgetMs / 1000}s per file` : "off (--file-budget off)"
        } — ${stoppedForTime} file(s) stopped for time${
          stoppedForTime === 0
            ? ""
            : ` (named in ${namedIn.slice(0, -1).join(", ")} and ${namedIn[namedIn.length - 1]})`
        }`,
      );
      // WHAT THE NEXT LAYER WILL COST, AND THE THREE SHAPES IT MAY BE RUN IN.
      // Layer 2 runs in the user's own agent and the user pays for it, so the run that
      // is about to ask for one child per payload says here what that costs — before it is spent,
      // and with the cheaper shapes priced beside it.
      //
      // LAST IN THE FULL SECTION AND NOT AMONG THE PROVENANCE LINES, deliberately: the four lines
      // above say how THIS scan was run, and this says what the NEXT step will cost, which is the
      // last thing a reader needs before deciding whether to take it. Under `--report-detail
      // first-screen` it is not printed, for the reason no other line of the full section is.
      //
      // READ OFF THE DOCUMENT, never recomputed here: `findings.context_payloads.cost_preview` is
      // the object `writeContextPayloads` wrote, so what is printed and what is in the document
      // cannot disagree. Absent exactly where the index is — `--context-window 0`, or no `--out` —
      // and nothing is printed then, because a launch count with no payloads under it would be a
      // number this command cannot stand behind.
      const preview = shown.context_payloads?.cost_preview;
      // Each shape's figure is the one the price table
      // prints (`shapeFigures`), over the document's own candidates and payload rows, at the host's sub-agent limit less the
      // one the pre-launch step keeps free by default: never a second computation of a price.
      if (preview) {
        const limit = subagentLimitFrom(undefined, process.env[SUBAGENT_LIMIT_ENV]);
        const capacity = "limit" in limit ? Math.max(1, limit.limit - ORCHESTRATOR_RESERVED_PLACES) : PLATFORM_SUBAGENT_LIMIT - ORCHESTRATOR_RESERVED_PLACES;
        full(costPreviewLines(preview, shapeFigures(shown.candidates ?? [], shown.context_payloads?.payloads ?? [], capacity)).join("\n"));
      }
    }
    // THE DISCLAIMER IS UNCHANGED AND STAYS AT THE END OF THE OUTPUT, which
    // under `first-screen` puts it immediately after the first screen and under `full` where it has
    // always been.
    let detailShown: string | null = null;
    if (detailPath !== null) {
      try {
        writeFileAt(detailPath, `${[...firstScreen, "", ...detail, "", DISCLAIMER].join("\n")}\n`);
        const rel = relativePath(process.cwd(), detailPath);
        detailShown = valueText(rel !== "" && !rel.startsWith("..") && !isAbsolute(rel) ? rel : detailPath);
      } catch (e) {
        // Not written: the rest is printed here instead, below the divider, so nothing the file was to hold is lost.
        notesAfterScreen.push(`${valueText(detailPath)} could not be written (${valueText((e as Error).message)}), so everything else this scan has to say follows here.`);
        divider = ["", ...dividerLines(candidateLineCount(candidateTopics(shown, bundle.rules)))];
      }
    }
    if (nextStepShown) console.log(nextStepLines(detailShown).join("\n"));
    // In a session the first screen ends with the line naming the file that holds the
    // rest, the last line the skill shows the person (SKILL.md step 2); what follows it is for the skill alone.
    else if (detailShown !== null) console.log(NEXT_STEP_WORDS.detailFile(detailShown));
    if (notesAfterScreen.length > 0) console.log(["", ...notesAfterScreen].join("\n"));
    if (report === "full" || (detailPath !== null && detailShown === null)) console.log([...divider, ...detail].join("\n"));
    console.log(`\n${DISCLAIMER}`);
    return { findings, pathProblem, profile: prepared.profile, readFiles: prepared.walked.files };
    };

    // THE DECLARATION QUESTIONS, AFTER THE FIRST RESULT (decision 2: before the run-shape question). `--fail-on-unreviewed`
    // reads the last pass; CI asks nothing and reads no answer, so its one pass is the last (design rf11 3.3).
    const done =
      declaration === "ci"
        ? { last: await scanPass(undefined), exitCode: 0 }
        : await declarationAfterScan(declaration, bundle.rules, await scanPass(declaration.profilePath), scanPass);
    if (done.exitCode !== 0) {
      process.exitCode = done.exitCode;
      return;
    }
    const { findings, pathProblem } = done.last;
    // The places counted: on a comparison only those on the lines it adds or changes, else every place (ci-check.ts).
    const places = countedPlaces(findings, changed);
    const gateCount = gateLevel === undefined ? 0 : placesAtOrAbove(places, gateLevel);
    const where = changed === null ? "in this tree" : `on lines changed since ${changed.base}`;

    if (ciLog) {
      // THE RULES CHECK'S SUMMARY: counts by rule name, no place listed; exit 0 for every result, matches and a
      // tree no rule was offered included; 3 only where --fail-on-unreviewed stops the step.
      const silentCensus = censusSilentRules(findings);
      const reachedNothing = findings.candidates.length === 0 && silentCensus.readSomething.length === 0;
      const notReadAs = new Set((findings.files_not_read ?? []).map((n) => n.file.replace(/\\/g, "/")));
      const readAs = new Set((done.last.readFiles ?? []).map((p) => p.replace(/\\/g, "/")).filter((p) => !notReadAs.has(p)));
      const unread = (changed?.files ?? []).filter((c) => c.status !== "deleted" && !readAs.has(c.path));
      const outcome: CiOutcome = {
        changed,
        places,
        reachedNothing,
        notRead: { binary: unread.filter((c) => c.binary).length, other: unread.filter((c) => !c.binary).length },
        gate: gateLevel !== undefined && gateCount > 0 ? { level: gateLevel, count: gateCount } : null,
        ...(!ciForm && findings.profile_digest ? { answersUsedInSession: true } : {}),
      };
      const ev = eventFacts(process.env);
      // Written to a file and posted, not printed: in the printed form here.
      const body = ciSummaryText(outcome, bundle.rules, ev);
      console.log(`\n${body}`);
      const summaryFile = process.env[GITHUB_STEP_SUMMARY_ENV];
      if (summaryFile) {
        try {
          appendStepSummary(summaryFile, body);
        } catch (e) {
          console.log(`The step summary could not be written to ${ciText(summaryFile)}: ${ciText((e as Error).message)}`);
        }
      }
      commandsStopped?.resume();
      // The annotations and the check run are the rules
      // check's: a Claude Code session in CI holds a credential, and no check run is posted from a job that holds one.
      if (ciForm && process.env[GITHUB_ACTIONS_ENV] === "true") for (const a of answerFileAnnotations(changed)) console.log(a);
      const posted = ciForm ? await postCheckRun(process.env, ev, outcome, body) : "";
      if (posted !== "") console.log(posted);
      if (outcome.gate !== null) process.exitCode = 3;
      return;
    }

    if (gateLevel !== undefined) {
      if (gateCount > 0) {
        console.log(
          `--fail-on-unreviewed ${gateLevel}: ${gateCount} place(s) at ${gateLevel} or above ${where} match rules and wait for a review, so this scan exits 3. ` +
            "They are not findings: no AI review has decided them.",
        );
        process.exit(3);
      }

      // The absence of a finding is `unknown`, never `clean` — and until now that
      // discipline covered findings.json, the SARIF file and the layer-2 report, but not this exit
      // code. A threshold nothing met used to print and exit 0 whether 56 rules read the tree and
      // found nothing, or the scan never reached a single file — and in CI those are not the same
      // fact: the second is not "we checked and it's fine", it is "nothing was checked".
      //
      // Told apart using the roster runScan() already built (`rules_without_candidates`), and
      // counted by `censusSilentRules` in scan.ts — the same function `summarize()` above counts
      // from, never a second copy of the arithmetic here. The first version of this block did keep
      // a second copy, and the two immediately disagreed: over a tree of only `test/` and `spec/`
      // files `summarize()` printed "56 ran over this tree and matched nothing … of which 54 were
      // offered no file at all" and this message printed "56 rule(s) ran and found nothing" with no
      // correction — two rules had read a file. The line a CI operator reads was the false one.
      const census = censusSilentRules(findings);
      if (findings.candidates.length === 0 && census.readSomething.length === 0) {
        // WHY the scan reached nothing, when the filesystem can say so. Exit 4 is right either way
        // — nothing was checked — but until 2026-08-21 a mistyped `--target` and a genuinely empty
        // repository printed the identical sentence, and that sentence was "nothing in this
        // repository was ever checked": it sent a reader whose only mistake was a typo off to
        // audit their code. The cause is stated first, because it is the thing to act on.
        //
        // Stated here rather than as a hard failure before `runScan`, because refusing a missing
        // path outright would change the exit code of runs that pass no `--fail-on` at all, which
        // is a behaviour change beyond this repair.
        //
        // The sentence itself comes from `targetPathProblem` at the top of this file, which the
        // console path above also prints. It was written out twice here until 2026-08-24 — once in
        // this branch and nowhere else — which is how a run without `--fail-on` came to say nothing
        // about a `--target` that does not exist.
        console.error(
          `--fail-on-unreviewed ${gateLevel}: the scan reached nothing. ${pathProblem ? `${pathProblem} ` : ""}0 of ` +
            // "both cleared their ScanProfile preconditions and" stood here until 2026-08-27, when
            // the second half was deleted and "both" was left governing nothing — the sentence
            // shipped as "0 of 7 rule(s) both were offered a file to read", which an independent
            // verifier found the same day and which a test could not see, because
            // its exit-4 assertions were /reached nothing/, /not a pass/ and a rule count and never
            // the clause between them. That gap is closed there as well, on this exact sentence.
            //
            // The deleted half named a condition that no longer exists: a profile answer labels a
            // rule's output and never stops it from running, so the only way a rule reaches nothing
            // now is that no file was offered to it. Both populations are still counted and still
            // printed — `notEvaluated` because a document written before that date can carry rows in
            // that state, and because a zero that is explained is a fact where a zero the reader has
            // to interpret is not.
            `${census.all.length} rule(s) were offered a file to read ` +
            `(${census.noSurface.length} were evaluated and offered no file in this tree; ` +
            `${census.notEvaluated.length} never ran because the ScanProfile put them out of scope, ` +
            `a state this scanner has not written since 2026-08-27). This is not a pass — nothing under ` +
            `${targetRoot} was ever checked.`,
        );
        process.exit(4);
      }

      // Each population named in its own clause and in its own unit, and the four clauses partition
      // the roster: matchedNothing + gated + noSurface + notEvaluated === all.
      //
      // "matched nothing" is counted from `matchedNothing` and NOT from `readSomething`, which
      // contains the gate-silenced rules. That was this message's second false clause, found by an
      // independent verifier on 2026-08-21 after the first was repaired: `readSomething` is "was
      // offered a file", and a rule can be offered a file, match it, and still produce no candidate
      // because a corroboration gate removed the matches. On one real tree this line
      // called 35 rules silent when 5 of them had matched — `eu-retention-001` 590 times — while
      // summarize(), three lines above it in the same run, said so correctly.
      //
      // `gated` is therefore stated as its own sentence rather than as an "of which" correction,
      // and it names the rules, because it is the population the design calls "the least
      // `unknown`-like silence in the array and the most worth reading": the construct is
      // demonstrably in the tree and only the corroboration requirement kept it off the report.
      //
      // The pointer to the UNKNOWN block is conditional because that block is: scan.ts prints it
      // only when the roster is non-empty, so on a scan where every rule produced a candidate this
      // sentence used to send the reader to a block that was never printed.
      console.log(
        `--fail-on-unreviewed ${gateLevel}: no candidate${changed === null ? "" : ` on lines changed since ${changed.base}`} reached the threshold. ` +
          `${census.matchedNothing.length} rule(s) were offered at least one file in this tree and ` +
          `matched nothing; ` +
          (census.gated.length > 0
            ? `${census.gated.length} DID match their own patterns and were then silenced by a ` +
              `corroboration gate, so the construct is in this tree: ` +
              `${census.gated.map((r) => `${r.rule_id} (${r.matches_removed_by_corroboration})`).join(", ")}; `
            : "") +
          `${census.noSurface.length} were in scope but were offered no file at all ` +
          `(their declared surface matched nothing here), so their silence is about this ` +
          `repository's layout and not about its code; ${census.notEvaluated.length} never ran (out ` +
          `of scope by the ScanProfile).` +
          (census.all.length > 0 ? " See the UNKNOWN block above." : "") +
          " This is not a statement that the project is clean.",
      );
    }
  });

program
  .command("test-rules")
  .description("Run rule regression tests against fixtures annotated with ruleid:/ok:")
  .requiredOption("--bundle <dir>", "local rule bundle directory")
  .requiredOption("--rules-dir <dir>", "rule authoring directory (searched for fixtures)")
  .action(async (opts) => {
    // A bundle folder that cannot be used is one plain sentence, exit 1, not a
    // Node stack (openBundle throws a StartupRefusal, command-boundary.ts prints it).
    const bundle = openBundle("test-rules", opts.bundle as string);
    await prepareStructuralIfDeclared(bundle);
    // The fixture runs below reach `runBuiltin` through `runScan`, so the prefilter's self-check can
    // stop this command exactly as it stops `scan`, and must say the same four lines when it does. Resolving the options first also refuses a malformed
    // `PRODUCT_CLI_PREFILTER_SELFCHECK` before any fixture is staged.
    throughTheEngine(() => resolvePrefilterRuntimeOptions());
    const results = throughTheEngine(() => testRules(bundle, resolve(opts.rulesDir)));
    const { text, ok } = formatTestResults(results);
    console.log(text);
    // Whether the fixtures above were read as the files they are. A mutant whose name breaks its
    // base's compound extension is scored without the parse-tree reading, and every assertion in it
    // that only that reading can see fails as a detector hole that does not exist — which is what
    // the whole run above would then be reporting. Printed next to the counts because it decides
    // what those counts mean.
    const naming = checkFixtureNaming(bundle);
    for (const line of naming.lines) {
      console.log(`${naming.ok ? "✔" : "✘"} fixtures as the engine reads them: ${line}`);
    }
    // The one check that reads a written file rather than an object in this process. It runs the
    // `scan` command below as a subprocess, so the serialisation this file performs is under a gate
    // for the first time; everything else in `test-rules` stops at the objects the engine returns.
    // The label is generic because the check covers every field in `PLUMBED_FIELDS`, not just the
    // one it was first written for; each line names the field it is about.
    const endToEnd = checkDeliveryEndToEnd(bundle, resolve(opts.rulesDir));
    for (const line of endToEnd.lines) {
      console.log(`${endToEnd.ok ? "✔" : "✘"} plumbed rule fields reach the written outputs: ${line}`);
    }
    if (!ok || !naming.ok || !endToEnd.ok) process.exit(1);
  });

program
  .command("reconcile")
  .description(
    "Find the target's own declarations, read them, take a census of what the code does, and write the reconciliation input the declaration-reconcile skill adjudicates",
  )
  .option("--bundle <dir>", `local rule bundle directory (supplies the Art 13/14 checklist); default: ${BUNDLE_DIR_ENV}, else the bundle this package ships`)
  .requiredOption("--target <dir>", "root directory to scan")
  .option(
    "--policy <path|url>",
    "a declaration to read in addition to whatever auto-discovery finds; repeatable. A relative path is read under --target (or from the working directory, where that lands inside --target); an absolute path is read as it is, so /PRIVACY.md is the filesystem's, not the target's. Exit 11: at least one --policy was given and not one of them could be read — every URL failed to fetch, every path was unreadable or over the size limit. The summary names each one with its error before anything else, the reconciliation input is still written with --out and records each failure, and whatever auto-discovery found in the tree is still reconciled. 11 because 1 and 2 are what this CLI reserves for a caller's mistake and an unreadable input file, where a command stops and writes nothing, 3 to 7 each already mean something else here (scan's threshold and reached-nothing, a quotation or a reading that could not be verified, differences found or no questions, answers that do not fit a questionnaire), 8 is reserved for the planned policy check command, and 9, 10, 12 and 13 are exit codes Node itself uses (9 for an invalid option, including one in NODE_OPTIONS); 11 means only this. Exit 0 otherwise — including a run where some requested documents were read and some were not, which lists the rest in the summary and in discovery.fetch_failures and discovery.unextractable — and a run with no --policy, whatever discovery found",
    (value: string, previous: string[] = []) => [...previous, value],
  )
  .option("--findings <file>", "pillar-1 findings JSON, to annotate where the code scan already reported something")
  .option("--profile <file>", "ScanProfile JSON. Checked against scan-profile.schema.json as it is read: violations are printed first and the run continues with each rejected field treated as unanswered. Carried into the reconciliation input as this run read it, and read there twice — its declared_artifacts answers are put beside what this run observed, and its answers drive the mechanical applicability assessment — for gates whose applicability turns on a fact about the product rather than the code (e.g. features.annex_iii_use) — see, in schemas/reconcile-input.schema.json of this program's npm package (product/packages/schemas/schemas/ in a source checkout), `profile`, `declared_artifacts_reconciliation` and `applicability` fields")
  .option("--out <file>", "write the reconciliation input JSON here")
  .option("--from-answer", "in a Claude Code session: take the person's answer to the agents' start question this command asked for the input at --out, from the plugin hook's record, and say whether the agents start; nothing is read or fetched again")
  .option(
    "--fetch-timeout <seconds>",
    `how long one --policy URL may take, from the request to the last byte, before it is recorded as a failure (default ${DEFAULT_FETCH_TIMEOUT_SECONDS}, at most ${MAX_FETCH_TIMEOUT_SECONDS}). A response over ${MAX_DOCUMENT_BYTES} bytes is a failure too: reading stops at that size and the failure says so`,
  )
  .action(async (opts) => {
    const fetchTimeout = parseFetchTimeout(opts.fetchTimeout);
    if ("problem" in fetchTimeout) {
      console.error(fetchTimeout.problem);
      process.exit(1);
    }
    const fetchTimeoutSeconds = fetchTimeout.seconds;
    // The answer to the agents' start question, bound to the input at --out as written.
    if (opts.fromAnswer) {
      if (!opts.out) {
        console.error("reconcile --from-answer: name the input the question was asked for with --out. Start no agent.");
        process.exit(1);
      }
      const took = agentsStartTake(opts.target, "reconcile-agents", resolve(opts.out), "policy comparison");
      console.log(took.lines.join("\n"));
      if (took.code !== 0) process.exitCode = took.code;
      return;
    }
    const bundle = openBundle("reconcile", opts.bundle);
    const input = await buildReconcileInput({
      bundle,
      targetRoot: resolve(opts.target),
      policies: opts.policy,
      findingsPath: opts.findings ? resolve(opts.findings) : undefined,
      profilePath: opts.profile ? resolve(opts.profile) : undefined,
      fetchTimeoutSeconds,
    });

    let handoff = "";
    if (opts.out) {
      prepareOutputFolder(resolve(opts.out));
      // **Indented on purpose, and the indentation is load-bearing** (2026-09-02, hole 6 of the
      // first real-repository pillar-2 run). A subagent's file reader pages by LINE, so a JSON
      // document written on one line cannot be paged into at all once it exceeds one read's token
      // cap: every offset and limit returns the same single line. That run's orchestrator minified
      // its own hand-built batch files and two of seven seats could not read theirs; one returned
      // zero of nineteen checklist results rather than guess. This command has always written
      // indented JSON and must go on doing so — the note below says why to whoever passes the file
      // on, because the failure was on the far side of this boundary and a size nobody states is a
      // size nobody plans around.
      const bytes = JSON.stringify(input, null, 2);
      writeFileAt(resolve(opts.out), bytes);
      const lines = bytes.split("\n").length;
      const mb = (Buffer.byteLength(bytes) / 1_000_000).toFixed(1);
      handoff =
        `\nWrote ${opts.out}: ${mb} MB across ${lines.toLocaleString("en-US")} lines, indented so a line-indexed reader can page it.\n` +
        "  Hand it on as written. Never minify it for size: a one-line JSON file larger than one read's cap cannot be paged into by any offset, which is how a seat ends up reporting nothing rather than reporting a blocker.\n" +
        "  Larger than one context: give each subagent a slice — one checklist family, or one direction — rather than the whole file, and say in the brief which fields the slice carries and which it does not.";
    }

    console.log(summarizeReconcile(input));
    if (handoff) console.log(handoff);
    // The count before any agent starts, and the person's go through the program's question.
    const docs = input.discovery.found.length;
    console.log(`\n${reconcileAgentsLine(docs)}`);
    if (opts.out) for (const l of agentsStartAsk(opts.target, "reconcile-agents", resolve(opts.out), `Compare your ${docs} declaration document(s) with the code now? This starts ${reconcileAgentsWords(docs)} on your plan or API key. They were never measured, so no token figure is given.`, "this reconcile command")) console.log(l);
    console.log(`\n${DISCLAIMER}`);
    // After everything is written and printed: the code changes what a caller branches on, never what
    // the run records. See EXIT_NO_REQUESTED_DOCUMENT. **Set, never `process.exit(code)`**: stdout
    // to a pipe is written asynchronously, and `process.exit` ends the process with the rest still
    // queued — a 648,474-byte summary arrived through `| cat` as 65,536 bytes, without its tail or
    // the disclaimer. Setting the code lets the queue drain first.
    const code = reconcileExitCode(input);
    if (code !== 0) {
      process.exitCode = code;
      return;
    }
  });

program
  .command("reconcile-annotate")
  .description(
    "Annotate a declarations report with the pillar-1 candidates that sit on the same file and line. Annotation only — a shared line can carry two unrelated questions, so nothing is ever removed",
  )
  .requiredOption("--report <file>", "declarations report JSON written by the reconciliation skill")
  .requiredOption("--findings <file>", "pillar-1 findings JSON")
  .option("--out <file>", "write the annotated report here (default: overwrite --report)")
  .action((opts) => {
    const reportPath = resolve(opts.report);
    const report = JSON.parse(readRegularFile(reportPath, "utf8")) as DeclarationsReport;
    let index: ReturnType<typeof loadPillar1Index>;
    try {
      index = loadPillar1Index(resolve(opts.findings));
    } catch (e) {
      // A findings document changed after the scan: its one sentence, exit 2 (unreadable).
      if (!(e instanceof FindingsChanged)) throw e;
      console.error(e.message);
      process.exit(2);
    }

    // A finding's evidence is a list of locations; the first one is what it is anchored on.
    const anchors = (report.findings ?? []).map((f) => {
      const first = f.evidence?.[0];
      const line = Number.parseInt(String(first?.lines ?? "0").split(/[^0-9]/)[0] ?? "0", 10);
      return { finding: f, file: first?.file ?? "", line: Number.isFinite(line) ? line : 0 };
    });
    const locatables = anchors.map((a) => ({ file: a.file, line: a.line }));
    annotateLocatables(locatables, index);
    for (let i = 0; i < anchors.length; i++) {
      const overlaps = (locatables[i] as { pillar1_overlaps?: unknown }).pillar1_overlaps;
      if (overlaps) anchors[i].finding.pillar1_overlaps = overlaps as never;
    }

    const outPath = resolve(opts.out ?? opts.report);
    prepareOutputFolder(outPath);
    writeFileAt(outPath, JSON.stringify(report, null, 2));

    const withOverlap = anchors.filter((a) => a.finding.pillar1_overlaps?.length).length;
    const sameLine = anchors.filter((a) =>
      a.finding.pillar1_overlaps?.some((o) => o.same_line),
    ).length;
    console.log(
      `${anchors.length} finding(s) annotated against ${index.candidates} pillar-1 candidate(s): ${withOverlap} share a file, ${sameLine} share a line.`,
    );
    console.log(
      "Set overlap_disposition on each: different-question | duplicate | related. A shared line is not a duplicate — baseline-006 sits on the exact line that sends coordinates abroad and is reading the API key, not the destination.",
    );
  });

/**
 * `reconcile-refuters` - THE SECOND CHECKS' START QUESTION of the policy
 * comparison, through the program's confirmation, as the comparison's first agents' question goes (`agentsStartAsk`): the
 * count is known only once the report's findings are drafted and joined (step 7), so it is asked by this command, run at
 * step 8's start. One refuter per finding the report holds (step 7 removes none). Bound to the report's bytes: the answer
 * is taken by the same command with --from-answer before any refuter changes the report.
 */
export function reconcileRefutersLine(findings: number): string {
  return findings === 0
    ? "SECOND CHECKS: the report holds no finding, so no second-check agent starts."
    : `SECOND CHECKS, BEFORE ANY STARTS: the report holds ${findings} finding(s), so the second check starts ${findings} agent(s), one per finding, each trying to prove its finding wrong. No token figure is given: these agents were never measured. Start none until the person says go.`;
}
program
  .command("reconcile-refuters")
  .description(
    "Step 8 of the policy comparison, before its first second-check agent: count the agents (one per finding in --report) and, in a Claude Code session, ask the person through the program's own question whether to start them. The same command with --from-answer takes the answer from the hook's record alone and prints GO or NOT STARTED; it reads nothing else. Outside a session the count is printed and nothing is asked",
  )
  .requiredOption("--report <file>", "the declarations report after step 7 (reconcile-annotate)")
  .option("--target <dir>", "the project folder the comparison runs in", ".")
  .option("--from-answer", "take the person's answer to the question this command wrote, from the hook's record alone")
  .action((opts) => {
    const reportPath = resolve(opts.report);
    if (opts.fromAnswer) {
      const took = agentsStartTake(opts.target, "reconcile-refuters", reportPath, "policy comparison's second check");
      console.log(took.lines.join("\n"));
      if (took.code !== 0) process.exitCode = took.code;
      return;
    }
    let findings: number;
    try {
      const report = JSON.parse(readRegularFile(reportPath, "utf8")) as DeclarationsReport;
      findings = Array.isArray(report.findings) ? report.findings.length : 0;
    } catch (e) {
      console.error(`reconcile-refuters: ${reportPath} could not be read as a declarations report (${(e as Error).message}). Start no agent.`);
      process.exitCode = 2;
      return;
    }
    console.log(reconcileRefutersLine(findings));
    if (findings === 0) return;
    for (const l of agentsStartAsk(opts.target, "reconcile-refuters", reportPath, `Start the second check of the policy comparison now? It starts ${findings} agent(s) on your plan or API key, one per finding, each trying to prove its finding wrong. They were never measured, so no token figure is given.`, "this reconcile-refuters command")) console.log(l);
  });

program
  .command("reconcile-verify")
  .description(
    "Check every quotation in a declarations report against the text it cites — the documents pinned in the reconciliation input, and the real files under --target. Nothing is deleted: a quotation found nowhere flags its claim or finding and stays, because it is the record of what the agent asserted",
  )
  .requiredOption("--report <file>", "declarations report JSON written by the reconciliation skill")
  .requiredOption("--input <file>", "the reconciliation input the report was produced from (its documents[] are the document half of the check)")
  .requiredOption("--target <dir>", "root the report's file paths are relative to")
  .option(
    "--out <file>",
    "write the annotated copy here (default: .legal/declarations.verified.json). Neither --report nor --input is ever modified — the agent's own numbers are the evidence that anything needed correcting. Exit 0: every quotation was verified, at the position declared, at a corrected one, or (for an ambiguous row) in more than one source. Exit 5: at least one quotation could not be verified AS WRITTEN — either found nowhere, or found only by its first line, which is what a real first line with an invented remainder looks like; both carry the same duty, to re-read the source and correct or withdraw the item, which is why they share one code. Exit 1: bad arguments. Exit 2: --report or --input could not be read as JSON. A digest mismatch between the report and the input is printed loudly and does not change the exit code: it says which bytes were read, not whether a quotation is real",
  )
  .action((opts) => {
    const reportPath = resolve(opts.report);
    const inputPath = resolve(opts.input);
    const outPath = resolve(opts.out ?? ".legal/declarations.verified.json");

    // Both inputs are refused as the output. --report is the agent's own assertion and --input is
    // the pinned text every document quotation is checked against; writing the annotated report
    // over either destroys the evidence the next run would need, and the input's `documents` array
    // in particular would simply be gone.
    if (outPath === reportPath || outPath === inputPath) {
      const which = outPath === reportPath ? "--report" : "--input";
      console.error(
        `--out is the same file as ${which}. Neither the report the agent wrote nor the reconciliation input is written to by this command, so the annotated copy goes to a separate file; choose another --out.`,
      );
      process.exit(1);
    }

    let report: DeclarationsReport;
    let input: ReconcileInput;
    try {
      report = JSON.parse(readRegularFile(reportPath, "utf8")) as DeclarationsReport;
    } catch (e) {
      console.error(`--report ${reportPath} could not be read as JSON: ${(e as Error).message}`);
      process.exit(2);
    }
    try {
      input = JSON.parse(readRegularFile(inputPath, "utf8")) as ReconcileInput;
    } catch (e) {
      console.error(`--input ${inputPath} could not be read as JSON: ${(e as Error).message}`);
      process.exit(2);
    }

    const result = verifyDeclarationQuotes({
      report: report!,
      input: input!,
      targetRoot: resolve(opts.target),
    });

    prepareOutputFolder(outPath);
    writeFileAt(outPath, JSON.stringify(result.annotated, null, 2));

    console.log(summarizeQuoteVerification(result, report!, outPath));
    console.log(`\n${DISCLAIMER}`);
    const code = quoteVerificationExitCode(result);
    if (code !== 0) process.exit(code);
  });

/**
 * `verdict-verify` — the mechanical check of layer 2's own quotations.
 *
 * Beside `reconcile-verify` rather than under a noun group, because the naming follows the existing
 * pair: `reconcile-verify` is pillar 2's and `questionnaire verify` is a subcommand of a group that
 * exists; there is no `verdicts` group. It runs the same waterfall as both — called, never copied.
 */
program
  .command("verdict-verify")
  .description(
    "Check every quotation in a layer-2 record against the real file it names — adjudicator verdicts, refutations and silence investigations. A record whose quotation is found nowhere, only by its first line, or in a DIFFERENT file from the one it names is invalidated and routed to the weakest word its own vocabulary has, with the word the model wrote kept beside it. Nothing is deleted and nothing is re-adjudicated. It does not establish that a quotation supports the verdict it is attached to: a weaker model also produces correctly quoted wrong judgments, which no mechanical check can catch",
  )
  .requiredOption("--target <dir>", "root the records' file paths are relative to — the scanned tree, which is the only body of text a quotation may come from")
  .option("--verdicts <dir>", "the directory the children wrote into (default: .legal/verdicts). Every .json under it is read; the seat is taken from the subdirectory, on the scheme the skill fixes — refutation/ is the refuter's and silence/ is the silence investigator's")
  .option("--log <file>", "an assembled EvidenceLog. Its verdicts, their refutation objects and its unknown_rules rows are checked on the same terms. Either this or --verdicts, or both")
  .option(
    "--findings <file>",
    "the scan's own findings.json, which turns on the READING COVERAGE CHECK: every verdict over a candidate that layer 1 grouped into same-kind line groups is checked against that census — every group read or declared not read with a reason, every covered member under a group whose representative was read, the member counts adding up, a quotation on every group read, and no `not_applicable` over a group left unread because the repository answered the question. Without it the check does not run and the output says so; an absence is not a pass. Exit 5 on a gap, the same code an unverifiable quotation takes",
  )
  .option(
    "--legal <dir>",
    "the run's .legal directory. With it, NO VERDICT names each candidate whose seat's answer the plugin's hook kept invalid after its refusals (the hooks' ledger under <dir>/capture, the launch list under <dir>/launch), which step 6 reports as not judged. Nothing it reads changes the check or the file it writes",
  )
  .option(
    "--require-rests-on",
    "refuse a verdict that carries no complete `rests_on` block: the files it read, the searches it ran, the clause it was given and the candidate's content key, so that a later run can re-derive them with no model. Off by default, because every verdict written before the block existed carries none and reporting those would be a claim about records nobody changed; a run assembled with `verdict-reading --tree` turns it on and gets the guarantee that every verdict it stores is re-checkable. A block that is PRESENT and says of itself that it is incomplete is a gap with or without this flag",
  )
  .option(
    "--bundle <dir>",
    "not needed and not read: a log this program wrote carries its own redaction markers where a credential-shaped value was, and each marker is restored from the named file by its digest with the program's own credential patterns before the quotation is checked (accepted for scripts that still pass it)",
  )
  .option(
    "--out <file>",
    "write the annotated copy here (default: .legal/verdict-quotes.json). Neither --verdicts nor --log is ever modified — what the model wrote is the evidence that anything needed correcting. Exit 0: every quotation was found in the file its record names, at the line declared or at a corrected one. Exit 5: at least one record was invalidated, which is the same code and the same duty reconcile-verify and questionnaire verify carry — a record whose quotation could not be verified as written must not reach a user as it stands. Exit 1: bad arguments, or an --out that is one of the inputs. Exit 2: --log could not be read as JSON",
  )
  .action((opts) => {
    const targetRoot = resolve(opts.target);
    const outPath = resolve(opts.out ?? ".legal/verdict-quotes.json");
    const verdictsDir = opts.verdicts ? resolve(opts.verdicts) : undefined;
    const logPath = opts.log ? resolve(opts.log) : undefined;

    if (!verdictsDir && !logPath) {
      console.error(
        "Neither --verdicts nor --log was given, so there is nothing to check. Pass the directory the children wrote into, the assembled evidence log, or both.",
      );
      process.exitCode = 1;
      return;
    }
    // Both inputs are refused as the output, on the same terms `reconcile-verify` refuses --report
    // and --input: what the model wrote is the record of what was asserted, and writing the
    // annotated copy over it destroys the evidence that anything needed correcting. Compared by identity (file-identity.ts),
    // not by text: `verdictsDir + "/"` never prefixed a Windows path, so there the annotated copy went into --verdicts.
    const outPlace = locate(outPath, process.cwd());
    const logPlace = logPath ? locate(logPath, process.cwd()) : null;
    if (logPath && (outPath === logPath || (logPlace !== null && atOrInside(outPlace, logPlace) && atOrInside(logPlace, outPlace)))) {
      console.error(
        "--out is the same file as --log. The record the agents wrote is not written to by this command; the annotated copy goes to a separate file. Choose another --out.",
      );
      process.exitCode = 1;
      return;
    }
    if (verdictsDir && (outPath === verdictsDir || atOrInside(outPlace, locate(verdictsDir, process.cwd())))) {
      console.error(
        "--out is inside --verdicts. The files the children wrote are not written to by this command, and an annotated copy sitting among them would be read as one of them on the next run. Choose another --out.",
      );
      process.exitCode = 1;
      return;
    }

    let fromDir;
    if (verdictsDir) {
      if (!existsSync(verdictsDir)) {
        console.error(
          `--verdicts ${verdictsDir} does not exist. A run whose children wrote nowhere has no record to check, and this command will not report that as a clean result.`,
        );
        process.exitCode = 1;
        return;
      }
      fromDir = { dir: verdictsDir, ...jobsFromVerdictsDir(verdictsDir) };
    }

    let fromLog;
    if (logPath) {
      try {
        // The path as the caller TYPED it goes into the record, not the resolved one: an absolute
        // path baked into an output makes every byte of it machine-dependent, which is the defect
        // the orientation sheet was found carrying on 2026-09-17.
        // An assembled log is a file the program wrote: read through the one reader, which refuses by kind and by name
        // what is not one (a named pipe here hung the command).
        fromLog = { path: opts.log as string, log: JSON.parse(programFileBytes("the evidence log", logPath).toString("utf8")) };
      } catch (e) {
        console.error(`--log ${logPath} could not be read as JSON: ${(e as Error).message}`);
        process.exitCode = 2;
        return;
      }
    }

    let fromFindings;
    if (opts.findings) {
      const findingsPath = resolve(opts.findings as string);
      try {
        // The path as the caller TYPED it goes into the record, for the reason --log's does: an
        // absolute path baked into an output makes every byte of it machine-dependent.
        fromFindings = { path: opts.findings as string, findings: JSON.parse(readFindingsText(findingsPath, [resolve(opts.target)])) };
      } catch (e) {
        console.error(findingsUnreadable(findingsPath, e));
        process.exitCode = 2;
        return;
      }
    }

    // The program's own markers are restored with the program's own credential patterns, whatever bundle a scan ran: `--bundle` is no longer needed for it.
    const credentials: PrintedRedaction | null = productPrintedRedaction();

    /* With --legal, the refutations whose refuter entry does not stand (assemble-hooked.ts
     * `supersededRefutationFiles`, the same binding the assembly's own check is given), so this report and the
     * assembly's agree and a superseded refutation's failure is said of no other record. */
    let supersededRefutations: Set<string> | undefined;
    if (opts.legal) {
      const legalDir = resolve(opts.legal as string);
      try {
        supersededRefutations = supersededRefutationFiles(readHookedRun(legalDir, join(legalDir, "launch")));
      } catch (e) {
        console.error(`--legal ${String(opts.legal)}: the refuter entries that no longer stand could not be read, because ${(e as Error).message}`);
      }
    }

    const result = verifyVerdictQuotes({
      targetRoot,
      displayTarget: opts.target,
      fromDir,
      fromLog,
      fromFindings,
      requireRestsOn: opts.requireRestsOn === true,
      credentials,
      ...(supersededRefutations ? { supersededRefutations } : {}),
    });

    prepareOutputFolder(outPath);
    writeFileAt(outPath, derivedFileContent(result.report));

    // m5 of the integration verification: the candidates step 6 reports as not judged, named under NO VERDICT (the
    // not-judged rule, entry-answer.ts). Only the printed summary reads them; the report written above is unchanged.
    let keptInvalid: ReturnType<typeof keptInvalidFindings> | undefined;
    if (opts.legal) {
      try {
        keptInvalid = keptInvalidFindings(resolve(opts.legal as string));
      } catch (e) {
        console.error(`--legal ${String(opts.legal)}: the candidates kept invalid are not named, because ${(e as Error).message}`);
      }
    }
    console.log(summarizeVerdictQuotes(result, outPath, keptInvalid));
    // Exit 5 is not a stop in a run (SKILL.md step 5a): what follows is step 6, and the line says so (recovery.ts).
    if (verdictQuoteExitCode(result) !== 0) console.log(`\n${recoveryFor("quote-check")}.`);
    console.log(`\n${DISCLAIMER}`);
    /* `process.exitCode`, NEVER `process.exit()`, after a long print.
     * Writes to a pipe are asynchronous: `process.exit` ended the process with the rest of the summary
     * still queued, so through `| cat` live run 1 delivered its first 64 KiB and lost the malformed
     * count, the counts line and the disclaimer. Setting the code lets the queued output drain. */
    process.exitCode = verdictQuoteExitCode(result);
  });

// `verdict-capture` — the program, not the AI, writes a seat's answer as the record (relay item 2). A
// top-level command beside `verdict-verify` for the reason given above it; its code is in its own file.
registerVerdictCapture(program);
registerLaunchLater(program);
registerRelaySeat(program);

/**
 * `verdict-reading` — the trail of what layer 2 actually read, assembled by this CLI.
 *
 * **Why a command and not a step in a prompt.** A candidate that layer 1 grouped into same-kind line
 * groups can carry tens of thousands of matched lines under one question — one tree's `recipients-003`
 * carries 58,712 in 202 groups — and the record that says which of them was read, which was settled
 * by the representative of its own group and which nobody opened is one row per location. A seat
 * cannot write that: its reply would be O(locations) and no model returns 58,712 rows. So the seat
 * returns what it OPENED and QUOTED, and this command folds the census over that reply
 * (`product/packages/cli/src/reading.ts`, `assembleReading`). Nothing here is a judgement, and the
 * whole of it re-derives from the findings document and the reply files with no model.
 *
 * `--fold` is the other direction: what the orchestrator HANDS the verdict seat of one candidate —
 * the bounded catalogue of the whole census and the readers' dispositions folded by item and
 * disposition — so that the seat's input is a few hundred rows whatever the candidate holds.
 */
program
  .command("verdict-reading")
  .description(
    "Assemble the `reading` block of every verdict over a candidate layer 1 grouped into same-kind line groups: every group the seats opened with its quotation, every member settled by the representative of its own group, and every group nobody opened with the reason from a fixed list. Deterministic and model-free - the seats say what they opened, and this folds the scan's own census over that. Nothing is judged and no input file is written to. Exit 5: at least one group is accounted for by nobody, which means a seat that was dispatched did not return and the run is incomplete; or an entry of a verdict file names no candidate (no `finding_id` string, or not an object at all), so what it read was never assembled and is listed under `inputs_unattributed`; or a verdict file could not be read as JSON, so its verdicts were never assembled (listed under `inputs_unreadable`)",
  )
  .requiredOption("--findings <file>", "the scan's findings.json, which carries the census the trail is folded from")
  .requiredOption(
    "--verdicts <dir>",
    "the directory the children wrote into (.legal/verdicts). The verdict seats' own files are read at the top level and the readers' replies under readers/, on the scheme the skill fixes",
  )
  .option("--out <file>", "write the assembled trails here (default: .legal/verdict-reading.json)")
  .option(
    "--readers <dir>",
    "a directory of readers' replies OUTSIDE the verdict directory (.legal/readers, the scheme the skill fixes). Replies under <verdicts>/readers/ are still read, so a run written the older way assembles unchanged",
  )
  .option(
    "--assemble-into <dir>",
    "write one copy of every verdict file with its assembled `reading` block merged in, and copy the refutations beside them. This is the directory `verdict-verify` is then run over: a seat writes only `read[]` and `searched[]`, so gating the seats' own files reports the census, the covers and the not-read rows as missing, and the readers' replies are left out of the copy because the quote check reads a disposition array as an unevidenced verdict",
  )
  .option(
    "--tree <dir>",
    "the scanned tree, which turns on the PREMISE BLOCK: every assembled verdict gains `rests_on` - the candidate's identity keyed on content, the sha256 of every file a seat opened, a replay and hit-set digest of every search it ran, the rule's own clause and the bundle's version - so that a later run can tell an untouched question from a moved one with no model. The seat is never asked for a digest; all of it is computed here from the rows the seat already wrote. Requires --bundle",
  )
  .option(
    "--bundle <dir>",
    "the rule bundle the run was scanned with, for the per-rule clause digest and the bundle version the premise block records. Only read when --tree is given",
  )
  .option(
    "--fold <finding_id>",
    "instead of assembling, print what the VERDICT SEAT of this candidate is handed: the bounded catalogue of its whole census and the readers' dispositions folded by item and disposition. Writes nothing unless --fold-out is given",
  )
  .option("--fold-out <file>", "with --fold: also write the fold to this file - the path a launch list's verdict seat after readers names (relay rework item 4)")
  .option(
    "--launch-dir <dir>",
    "the run's launch directory (default: `launch` beside --verdicts, which is .legal/launch on the skill's scheme). The rows of the readers the run did not launch because every place each holds is carried are read from the plan its launch list names, and enter the fold and the assembly labelled carried, as assemble-report reads them; an assembly whose launch list names a plan that cannot be read at the digest the list recorded is refused (exit 2). With --fold, and only where this option is given, the fold also names, for each reader of the candidate whose answer is not on disk, its launch-list entry, and says whether its seat's answer was kept invalid (the hooks' ledger beside it)",
  )
  .action((opts) => {
    const findingsPath = resolve(opts.findings as string);
    let findings;
    try {
      findings = JSON.parse(readFindingsText(findingsPath));
    } catch (e) {
      console.error(findingsUnreadable(findingsPath, e));
      process.exitCode = 2;
      return;
    }
    // A document the per-rule reads cannot use is refused by name, before them (part B, item 4; O11): exit 2 at the boundary.
    assertFindingsUsable(findings, opts.findings as string);
    const candidates = (findings.candidates ?? []) as Parameters<typeof assembleReadingForVerdicts>[0]["candidates"];

    const verdictsDir = resolve(opts.verdicts as string);
    if (!existsSync(verdictsDir)) {
      console.error(
        `--verdicts ${verdictsDir} does not exist. A run whose children wrote nowhere has no reading to assemble, and this command will not report that as a clean result.`,
      );
      process.exitCode = 1;
      return;
    }

    const readersDir = opts.readers ? resolve(opts.readers as string) : undefined;
    if (readersDir && !existsSync(readersDir)) {
      console.error(`--readers ${readersDir} does not exist.`);
      process.exitCode = 2;
      return;
    }
    /* The run's inputs, derived by the one function `assemble-report` derives them
     * with (run-reading.ts `readingInputsOfRun`): the seats' files, the readers' replies, and the rows of the readers that
     * were not launched because every place each holds is carried (build unit F5 M3), read from the plan the run's launch
     * list names. The launch directory is the run's own (`.legal/launch` beside --verdicts) unless --launch-dir names
     * another: whether the carried rows enter is no longer a flag the skill's text can leave out. */
    const launchDir = opts.launchDir ? resolve(opts.launchDir as string) : launchDirBeside(verdictsDir);
    const runPlan = planOfLaunchDir(launchDir);
    if ("problem" in runPlan && !opts.fold) {
      console.error(
        `✘ verdict-reading: ${runPlan.problem}. The carried rows of the run are read from that plan, and an assembly without them would be refused at step 6; nothing was assembled and nothing was written. Run the pre-launch step again (skill step 3j-3l), or name the run's launch directory with --launch-dir.`,
      );
      process.exitCode = 2;
      return;
    }
    // The fold (a relay's `left_to_main` line, a verdict seat's brief) keeps its earlier reading of an unreadable plan: none of its rows.
    const { seats, replies, unreadable, unreadableVerdicts, unattributed, verdictDocs, passthrough, refused: notRecords } = readingInputsOfRun({
      verdictsDir,
      candidates,
      readersDir,
      plan: "problem" in runPlan ? null : runPlan.plan,
    });
    // A file among the records that is not a regular file with one name was never opened (the one reader of program-written files):
    // the command stops here, naming each, and writes nothing.
    if (notRecords.length > 0) {
      for (const r of notRecords) console.error(`✘ verdict-reading: refused ${r.path} - ${r.problem}`);
      console.error(
        `${notRecords.length} file(s) under --verdicts or --readers ${notRecords.length === 1 ? "is not a record" : "are not records"} the capture wrote, so nothing was assembled and nothing was written. ${recoveryFor("record-not-a-file")}.`,
      );
      process.exitCode = 2;
      return;
    }

    if (opts.fold) {
      const candidate = candidates.find((c) => c.finding_id === opts.fold);
      if (!candidate) {
        console.error(`--fold ${opts.fold} names no candidate in ${opts.findings}.`);
        process.exitCode = 1;
        return;
      }
      // BUILD UNIT F4 (full-read design section 3, review R4): a place-plan candidate's answer seat is handed the bounded
      // fold of its place rows, and the per-place table is written whole beside the evidence log.
      if (isPlacePlanCandidate(candidate)) {
        const table = placeTableOf(candidate, replies);
        const tablePath = placeTablePath(dirname(resolve(opts.findings as string)), candidate.finding_id);
        writePlaceTable(tablePath, candidate, table);
        const account = readersAccountOf(candidate, replies);
        const readers = account ? foldReadersBlock(account, candidate.finding_id, opts.launchDir ? resolve(opts.launchDir as string) : null) : null;
        const fold = foldOfPlaces(candidate, table, { tablePath, ...(readers ? { readers } : {}) });
        if (opts.foldOut) {
          prepareOutputFolder(resolve(opts.foldOut as string));
          writeFileAt(resolve(opts.foldOut as string), fold.text);
        }
        console.log(`the fold of ${candidate.finding_id}: ${table.length} places, level ${fold.level}, ${Buffer.byteLength(fold.text, "utf8")} bytes; the per-place table: ${tablePath}`);
        return;
      }
      const inputs = seatInputsFor({
        candidate,
        readerRows: replies.filter((r) => r.finding_id === opts.fold).flatMap((r) => r.rows),
      });
      if (!inputs) {
        console.error(
          `--fold ${opts.fold} names a candidate that carries no kind census, so it is read location by location and its seat is handed its locations, not a fold.`,
        );
        process.exitCode = 1;
        return;
      }
      // The readers: each one whose answer is not on disk, the units it held, and the
      // outcome rule over them, so that the verdict seat reads what the capture will hold its answer to.
      const account = readersAccountOf(candidate, replies);
      const readers = account ? foldReadersBlock(account, candidate.finding_id, opts.launchDir ? resolve(opts.launchDir as string) : null) : null;
      const foldDoc = { finding_id: opts.fold, ...inputs, ...(readers ? { readers } : {}) };
      const foldText = JSON.stringify(foldDoc, null, 2);
      if (opts.foldOut) {
        prepareOutputFolder(resolve(opts.foldOut as string));
        // Written line-safe: the verdict seat after readers reads this file (launch-plan.ts, READ_LINE_LIMIT).
        writeFileAt(resolve(opts.foldOut as string), `${lineSafeJson(foldDoc)}\n`);
      }
      /* In CI the fold (the census's lines,
       * the readers' dispositions) is not printed into the job's log (declaration.ts `ciSet`, as the scan's log): it is in
       * --fold-out's file where one is given, which is how the launch list runs it; otherwise nothing is printed, exit 1. */
      if (ciSet(process.env)) {
        // Words
        console.log(
          opts.foldOut
            ? `The fold of ${opts.fold} is written to ${resolve(opts.foldOut as string)}; it is not printed here, because this runs in CI, where the output is a job's log that anyone who can read the repository may read.`
            : `The fold of ${opts.fold} is not printed here, because this runs in CI, where the output is a job's log that anyone who can read the repository may read: give --fold-out <file> to have it written to a file.`,
        );
        if (!opts.foldOut) process.exitCode = 1;
        return;
      }
      console.log(foldText);
      return;
    }

    const assembled = assembleReadingForVerdicts({ candidates, seats, replies });
    const outPath = resolve(opts.out ?? ".legal/verdict-reading.json");
    prepareOutputFolder(outPath);
    writeFileAt(
      outPath,
      `${JSON.stringify(
        {
          tool: "verdict-reading",
          findings: opts.findings,
          verdicts: opts.verdicts,
          assembled,
          inputs_unreadable: unreadable,
          inputs_unattributed: unattributed,
        },
        null,
        2,
      )}\n`,
    );

    /* `--assemble-into`: the directory the quote check is then run over. The seats write `read[]`
     * and `searched[]` and nothing else — `census`, `covered[]` and `not_read[]` are this command's
     * to add — so gating the seats' own files reports every kind of the census as unaccounted and
     * the record as schema-invalid (one real tree, 2026-09-21: exit 5 with hundreds of reported gaps, none of
     * them a gap). Neither input is written to: the copies go to a separate directory. */
    if (opts.assembleInto) {
      const dest = resolve(opts.assembleInto as string);
      if (dest === verdictsDir || dest.startsWith(verdictsDir + sep)) {
        console.error(
          `--assemble-into ${dest} is inside --verdicts ${verdictsDir}. The seats' own files are the record of what was asserted and this command never writes into them; give the copies a directory of their own.`,
        );
        process.exitCode = 1;
        return;
      }
      /* THE PREMISE BLOCK (unit H). It is written HERE, in the assembly step, and not by a seat: a
       * seat writes which file it opened and which pattern it searched for, and a digest over those
       * is something only a machine with the tree in front of it can produce. `--tree` is what turns
       * it on, because a run assembled without one has nothing to hash and must still assemble. */
      const treeRoot = opts.tree ? resolve(opts.tree as string) : null;
      let premise: PremiseInputs | null = null;
      if (treeRoot) {
        if (!existsSync(treeRoot)) {
          console.error(`--tree ${treeRoot} does not exist, so the files and searches a seat recorded cannot be re-derived from it.`);
          process.exitCode = 1;
          return;
        }
        // --bundle, else LEGAL_BUNDLE_DIR, else the bundle shipped with this program.
        premise = premiseInputs(treeRoot, openBundle("verdict-reading", opts.bundle as string | undefined).dir);
      }
      // The merge and the copies are in `reading-assembly.ts`, where `assemble-report` calls them too.
      const { files: copies, merged, premised, copied } = assembledCopies({
        verdictsDir,
        read: { verdictDocs, passthrough },
        assembled,
        candidates,
        perRuleApplicability: findings.per_rule_applicability,
        premise,
        handed: findings,
        orientationSheet: orientationSheetBeside(dirname(resolve(opts.findings as string)), findings.scan_id) !== null,
      });
      guardWorkingFolder(dest); // The copies hold the seats' quotations in clear.
      for (const f of copies) {
        const to = join(dest, f.rel);
        prepareOutputFolder(to);
        writeFileAt(to, f.content);
      }
      console.log(
        `assembled into ${dest}: ${verdictDocs.length} verdict file(s), ${merged} record(s) with an assembled reading block, ` +
          `${premise ? `${premised} record(s) with a premise block` : "no premise blocks (--tree not given)"}, ` +
          `${copied} refutation/silence file(s) copied unchanged, readers' replies not copied.`,
      );
    }

    const short = assembled.filter((a) => a.unaccounted.length > 0);
    // M5: a row naming no reading unit is REFUSED here, with its bytes, and the run stops. Before
    // this the row was dropped without a word and the trail simply came back short — eleven disposed
    // units read as `read: 0` on one tree's `recipients-001` and produced thirteen gaps downstream.
    const refused = assembled.filter((a) => a.refused.length > 0);
    for (const row of assembled) {
      const r = row.reading;
      console.log(
        `${row.finding_id} (${row.rule_id}): read ${r.read.length} group(s), covered ${r.covered.reduce((n, c) => n + c.members, 0)} ` +
          `location(s) by their representatives, did not read ${r.not_read.reduce((n, c) => n + c.members, 0)} ` +
          `location(s) in ${r.not_read.length} group(s); ${row.readers_returned} of ${row.readers_planned} reader(s) returned.`,
      );
    }
    for (const u of unreadable) console.log(`  input not read — ${u.path}: ${u.problem}`);
    for (const u of unattributed) console.log(`  record not assembled — ${u.path}[${u.index}]: ${u.problem}`);
    for (const row of assembled) {
      for (const unused of row.declined_unused) {
        console.log(`  ${row.finding_id}: \`declined[]\` names the unit ${JSON.stringify(unused.kind)} — ${unused.because}`);
      }
    }
    console.log(`\nwritten to ${outPath}`);
    if (refused.length > 0) {
      console.log(
        `\n${refused.length} candidate(s) carry a row this step refuses rather than drops, because a dropped row is a reading that ` +
          "happened and left no trail: a row whose `kind` names no reading unit (a seat writes the unit key exactly as it was handed, " +
          "with nothing appended), or a second row for a unit and sub-shape a row already disposed (the partition rule). " +
          `${recoveryFor("reading-row-refused")}:`,
      );
      for (const row of refused) {
        for (const r of row.refused) {
          console.log(`  ${row.finding_id}: ${r.where}${r.source ? ` ${r.source}` : ""} writes kind ${JSON.stringify(r.kind)}, which ${r.problem}`);
        }
      }
    }
    if (short.length > 0) {
      console.log(
        `\n${short.length} candidate(s) have group(s) nobody accounted for. A seat that was dispatched did not return a row for them, ` +
          "and no reason from the fixed list describes that — so none was written. The capture refuses an answer that leaves a unit " +
          "unaccounted (reading-assembly.ts `answerRulesAtCapture`), so such a unit is one whose verdict seat has not answered: its " +
          `answer was lost, or it is still running. ${recoveryFor("reading-unaccounted")}:`,
      );
      for (const row of short) {
        console.log(`  ${row.finding_id}: ${row.unaccounted.length} group(s), ${row.unaccounted.reduce((n, u) => n + u.members, 0)} location(s)`);
      }
    }
    if (unattributed.length > 0) {
      const one = unattributed.length === 1;
      console.log(
        `\n${unattributed.length} entr${one ? "y" : "ies"} of the verdict files (listed above as "record not assembled") ` +
          `name${one ? "s" : ""} no candidate, so nothing ${one ? "it" : "they"} read was assembled and no gate downstream can tell ` +
          `which candidate ${one ? "it answers" : "they answer"}. A verdict names its candidate by \`finding_id\`. ${recoveryFor("reading-unattributed")}.`,
      );
    }
    if (unreadableVerdicts.length > 0) {
      console.log(
        `\n${unreadableVerdicts.length} verdict file(s) could not be read as JSON (listed above as "input not read"), so the verdicts in ` +
          "them were not assembled and the quote check run over the assembly never sees them: the candidates they answer have no verdict " +
          `there. ${recoveryFor("reading-unreadable")}.`,
      );
    }
    console.log(`\n${DISCLAIMER}`);
    // `process.exitCode`, never `process.exit()`, after a long print: see the verdict-verify action.
    if (short.length > 0 || refused.length > 0 || unattributed.length > 0 || unreadableVerdicts.length > 0) process.exitCode = 5;
  });

/**
 * THE READERS' BLOCK OF A FOLD. The fold is written after the
 * readers and before the verdict seat's launch, so it is where the seat learns which readers' answers are not on disk:
 * each such reader by its number, its launch-list entry and, where the hooks' ledger shows it, the seat whose answer was
 * kept invalid (entry-answer.ts `keptInvalidOf`, the not-judged rule's one copy); the units it held (reading.ts
 * `readersAccountOf`, the units step 5a leaves `not_read: budget`); and the outcome rule over them, which the capture
 * holds the verdict seat's answer to (reading.ts `budgetOutcomeProblem`).
 */
function foldReadersBlock(
  account: NonNullable<ReturnType<typeof readersAccountOf>>,
  findingId: string,
  launchDir: string | null,
): Record<string, unknown> {
  let list: LaunchList | null = null;
  let answers: AnswerLedgers | null = null;
  let listNote: string | null = null;
  if (launchDir) {
    const listPath = join(launchDir, "launch-list.json");
    const read = readLaunchList(listPath);
    if (read.ok) {
      list = read.value;
      answers = readAnswerLedgers(dirname(launchDir), launchDir, list.run_id);
    } else listNote = `the launch list could not be read (${read.problem}), so each reader is named by its number only`;
  }
  const notReturned = account.not_returned.map((r) => {
    const entry = list?.entries.find((e) => e.role === "reader" && (e.finding_ids ?? []).includes(findingId) && e.reader?.index === r.reader);
    const invalid = entry && answers ? keptInvalidOf(answers, entry.id) : null;
    return {
      reader: `reader ${r.reader} of ${r.of}`,
      ...(entry ? { entry: entry.id } : {}),
      ...(invalid ? { seat: invalid.agent_id } : {}),
      what: invalid
        ? `its answer was kept invalid after ${REFUSALS_MAX} refusals: it is not on disk and nothing it said is used`
        : "no answer of it is on disk: it did not return, or its answer was not taken",
      units_held: r.units.length,
      units: r.units,
    };
  });
  const n = account.units_not_read;
  return {
    planned: account.planned,
    returned: account.returned,
    not_returned: notReturned,
    units_not_read: n,
    ...(listNote ? { note: listNote } : {}),
    ...(n > 0
      ? {
          verdict:
            `${n} unit(s) of this candidate were held by the reader(s) above, whose answer is not on disk, and nobody has read them. ` +
            "A verdict over a candidate a reader never finished is `needs_human` naming how many units were not read (design section 3.6): " +
            "your verdict over this candidate is `needs_human`, and it says how many units were not read. The capture refuses any other word.",
        }
      : {}),
  };
}

/**
 * `adjudicate --previous` — the deterministic step that starts a later run (unit H).
 *
 * **No model runs here.** It takes the new scan's candidates and the previous run's verdicts and
 * partitions the candidates into the ones already answered and the ones a seat has to read, with the
 * ONE premise that moved named per candidate. The orchestrator then launches seats for the second
 * list only, and the carried verdicts are written into the new run with `carried_forward_from`.
 *
 * `ideas.md` section H names this step `<cli> adjudicate --previous <log>`, and that is the name it
 * carries here. What it will never do is adjudicate: the word is the step's, not the act's — the act
 * belongs to the user's own agent, which is the whole architecture.
 */
program
  .command("adjudicate")
  .description(
    "THE PRE-LAUNCH STEP: run it before a single adjudicator is launched. It applies the person's own declaration (a rule whose jurisdiction the declared distribution_regions do not reach launches no seat and its candidates are recorded as not applicable by declaration), then the previous run where one is given (a verdict is CARRIED FORWARD only when every premise it recorded is reproduced exactly — the candidate's content key, its census, the settled per-rule answers, the sha256 of every file a seat opened, a replay of every search it ran, the rule's own clause and the bundle's version), and then prices what is LEFT (launches, tokens, wall clock and the three run shapes). It prints one block, which is what the skill puts in front of the person before it asks which shape to run. A candidate the previous run answered and this scan does not raise is reported as GONE, never as resolved. Nothing is judged, no model is consulted, and a carried verdict is CARRIED — not re-verified",
  )
  .requiredOption("--findings <file>", "the NEW scan's findings.json: the candidates to partition and the declaration's settled answers")
  .addOption(
    readOnlyInput(
      new Option(
        "--previous <path>",
        "the previous run's verdicts: a directory of verdict JSON files (the run's assembled verdicts), or one assembled EvidenceLog JSON. WITHOUT IT nothing is carried forward and the step is the declaration's settlement and the price of the rest — which is what a first run of a project needs",
      ),
    ),
  )
  .option("--target <dir>", "the scanned tree, as it is TODAY. Every premise is re-derived from it. Required with --previous")
  .option("--bundle <dir>", "the rule bundle this run scans with, for the per-rule clause digest and the bundle version. Required with --previous")
  .addOption(readOnlyInput(new Option("--previous-findings <file>", "the PREVIOUS scan's findings.json, read only for its scan id — which is what every carried verdict is labelled with")))
  .option("--previous-scan <id>", "the previous scan's id, where its findings document is not to hand")
  .option("--out <file>", "write the partition here (default: .legal/adjudicate-plan.json)")
  .option(
    "--carry-into <dir>",
    "write the carried verdicts into this directory, each with `carried_forward_from` and the re-check record on it. Without it the partition is computed and reported and nothing is written but the plan",
  )
  // Relay rework item 4 (launch-plan.ts): the price table and run-shape question on every call, the launch list once a shape is chosen.
  .option("--launch-dir <dir>", "where the run-shape question, the launch list, its briefs and the run context are written (default: a `launch` directory beside --out)")
  .option("--shape <shape>", "for a run outside Claude Code: the run shape chosen (full, important, refute_later), which writes the launch list for it. Inside Claude Code the plugin's hook refuses it; use --shape-from-answer")
  .option("--shape-from-answer", "write the launch list for the shape the person chose, taken only from the answer the plugin's hook recorded in the person's state folder to this run's question")
  // The run shape is not asked by default.
  .option(
    "--ask-shape",
    "put the run-shape question (what /legal-scan plan runs; pass it to both calls). Without it a project's first scan puts the start question, with the time and amount of the recommended plan, and a later scan puts none and writes the launch list in the recommended plan",
  )
  .option("--profile <file>", "the ScanProfile the scan read (step 2's --profile); checked against the findings' profile_digest and handed on in the run context")
  .option("--subagent-limit <n>", "sub-agents the host runs at once (default: CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS where set, else 20)")
  .option(`${RESERVE_FLAG} <n>`, "sub-agents of that limit kept free for the orchestrator (default 1); --reserve-places, its earlier name, is still accepted")
  // The earlier name of the option above, still accepted (SKILL.md names it).
  .option("--reserve-places <n>", `the earlier name of ${RESERVE_FLAG}, still accepted`)
  .option("--seat-model <model>", "the model every listed launch names, in place of each rule's own setting (default: each rule's own seat_model, sonnet today for every rule)")
  .action((opts) => {
    // The reserve under one of its two names, never both.
    if (opts.reserveSubagents !== undefined && opts.reservePlaces !== undefined) {
      console.error(`Give ${RESERVE_FLAG} or --reserve-places (its earlier name), not both. No run-shape question and no launch list were written.`);
      process.exit(1);
    }
    // Decision 5, second option: inside a Claude Code session --shape is refused before anything is written (hook-launch.ts).
    const shapeRefused = shapeFlagRefusal(opts.shape, process.env);
    if (shapeRefused !== null) {
      console.error(shapeRefused);
      process.exit(1);
    }
    /* "INSIDE A SESSION", READ FROM WHAT THE COMMAND CANNOT
     * WRITE: a folder this step names (the findings, the plan, the launch folder, the tree, the earlier run, the working
     * folder) inside a project where the plugin's SessionStart hook recorded a session (plugin-sessions.ts), whatever the
     * environment says. There a typed run shape is refused, a typed earlier run is taken only where the state folder
     * vouches for it, and the launch list goes only to that project's .legal/launch. */
    // Asked once for the command, from every option it
    // was given (--carry-into, --previous-findings, --profile and --bundle among them), by the hook above.
    const around = commandSessions() ?? pluginSessionsAround(processStateDir(), [process.cwd()]);
    // The anchor (plugin-sessions.ts): a state folder or redaction key
    // other than the recorded ones, or a record that cannot be read, is refused before anything else.
    if (around.kind === "refused") {
      console.error(`refused: ${around.why}. ${nothingWrittenWords()}.`);
      process.exit(1);
    }
    const recordedSessions = around.kind === "recorded" ? around : null;
    if (opts.shape !== undefined && recordedSessions !== null) {
      console.error(
        `--shape ${String(opts.shape)}: refused - this step names a folder in ${recordedSessions.projectDir}, where Claude Code with the wolfboy plugin has run, so the run shape is ` +
          "the person's answer to the run-shape question there, and nothing else. Run this command without --shape inside Claude Code; once the person has answered, " +
          "run it again with --shape-from-answer. Nothing was written: no plan, no carried verdict, no run-shape question, no launch list and no active-run marker.",
      );
      process.exit(1);
    }
    // In a recorded project the launch list goes only to its .legal/launch,
    // wherever the findings lie, and before anything is written.
    if (recordedSessions !== null) {
      const outAt = resolve((opts.out as string | undefined) ?? ".legal/adjudicate-plan.json");
      const recordedDir = recordedLaunchDirRefusal(resolve((opts.launchDir as string | undefined) ?? join(dirname(outAt), "launch")), recordedSessions.projectDir);
      if (recordedDir !== null) {
        console.error(recordedDir);
        process.exit(1);
      }
    }
    const findingsPath = resolve(opts.findings as string);
    let findings: Findings;
    try {
      findings = JSON.parse(readFindingsText(findingsPath)) as Findings;
    } catch (e) {
      console.error(findingsUnreadable(findingsPath, e));
      process.exit(2);
    }
    // THE DECLARATION (relay item 7, R10), inside a Claude Code session only and before any write: first a round of
    // declaration questions the scan wrote and nobody has taken back (F11), then a --profile that is not the program's
    // declaration beside the findings under its record (F6). The region test is the scan's (it read the file under
    // `usable` with the run's jurisdictions, and the findings' profile_digest is that file's); here the file and its record.
    if (claudeCodeSigns(process.env).length > 0) {
      // First: the plugin's hooks running in this session, before anything is
      // written (the same sentence markerSessionRefusal gives at the write).
      const hooksStop = hooksNotRunningRefusal(process.env);
      if (hooksStop !== null) {
        console.error(`${hooksStop} Nothing was written.`);
        process.exit(1);
      }
      // The scan launch profile first, before anything is written (scan-profile.ts).
      const profileStop = profileRefusal(process.env, "The pre-launch step");
      if (profileStop !== null) {
        console.error(`refused: ${profileStop} ${nothingWrittenWords()}.`);
        console.error(recoveryFor("scan-profile-off"));
        process.exit(1);
      }
      const declDir = dirname(findingsPath);
      const outstanding = declarationOutstanding(join(declDir, "launch"));
      if (outstanding !== null) {
        console.error(`refused: the pre-launch step waits for the declaration questions: ${outstanding}. ${nothingWrittenWords()}.`);
        console.error(recoveryFor("declaration-outstanding"));
        process.exit(1);
      }
      // The round that holds the saved answers' question is waited for as a declaration round is.
      const teamLaunch = join(declDir, "launch");
      if (teamQuestionWritten(teamLaunch) && confirmationOutstanding(teamLaunch, roundSessionId())) {
        console.error(`refused: the pre-launch step waits for the question about the saved answers, which nobody has answered through the scanner's hook. ${nothingWrittenWords()}.`);
        console.error(recoveryFor("declaration-outstanding"));
        process.exit(1);
      }
      if (opts.profile) {
        const given = resolve(opts.profile as string);
        const declared = readDeclaration(declDir);
        const verdict = given === declared.profilePath ? usable(loadDeclarationSource(), declared, []) : null;
        if (verdict === null || !verdict.ok) {
          console.error(
            `refused: --profile ${given} inside a Claude Code session: the pre-launch step takes a declaration only from ${declared.profilePath} under the record the program writes when the person answers its questions${verdict !== null && !verdict.ok ? ` (${verdict.why})` : ""}. ${nothingWrittenWords()}.`,
          );
          console.error(recoveryFor("declaration-prose"));
          process.exit(1);
        }
      }
    }
    /* THE EARLIER RUN, inside a Claude Code session: the log the person named in
     * answer to the program's own question (earlier-run.ts), never a `--previous` typed on the command line, which is
     * refused before anything is written, as a typed run shape is. Outside a session: the command line, as before. */
    let previousFromAnswer: string | null = null;
    // The person answered "None of these" to the earlier-run question (the later-run start question's cause).
    let earlierNoneChosen = false;
    // The sha256 of the log the person chose, as the question listed it.
    let previousChosenSha: string | null = null;
    if (claudeCodeSigns(process.env).length > 0) {
      if (opts.previous !== undefined) {
        console.error(
          "refused: --previous inside a Claude Code session: which log under .legal/evidence is the person's own earlier run is the person's answer to the program's earlier-run question, " +
            `which this step puts and takes itself. Run the same command without --previous; where a log is there, it prints the question to pass. ${nothingWrittenWords()}.`,
        );
        process.exit(1);
      }
      const outEarly = resolve((opts.out as string | undefined) ?? ".legal/adjudicate-plan.json");
      const launchDirEarly = resolve((opts.launchDir as string | undefined) ?? join(dirname(outEarly), "launch"));
      const dirRefused = launchDirRefusal(launchDirEarly, findingsPath, process.env) ?? (recordedSessions === null ? null : recordedLaunchDirRefusal(launchDirEarly, recordedSessions.projectDir));
      if (dirRefused !== null) {
        console.error(dirRefused);
        process.exit(1);
      }
      const f = findings as unknown as { scan_id?: unknown; scan?: { scan_id?: unknown } };
      const scanId = typeof f.scan_id === "string" ? f.scan_id : typeof f.scan?.scan_id === "string" ? f.scan.scan_id : "";
      const step = earlierRunStep({
        findingsPath,
        scanId,
        launchDir: launchDirEarly,
        target: resolve((opts.target as string | undefined) ?? "."),
        cwd: process.cwd(),
        now: new Date(),
        sessionId: roundSessionId(),
        endedAt: latestRunEndAt(launchDirEarly),
        // The person's state folder, where each log's digest was recorded when WolfBoy wrote it.
        stateDir: processStateDir(),
      });
      if (step.kind === "ask") {
        console.log(step.lines.join("\n"));
        process.exitCode = step.exitCode;
        return;
      }
      if (step.lines.length > 0) console.log(`${step.lines.join("\n")}\n`);
      if (step.kind === "taken") {
        previousFromAnswer = step.log;
        previousChosenSha = step.sha256;
      }
      if (step.kind === "taken" && step.log === null) earlierNoneChosen = true;
    }
    const previousOpt: string | undefined = previousFromAnswer ?? (opts.previous as string | undefined);
    /* `--previous` IS OPTIONAL, and what it turns on is the comparison alone. The declaration's
     * settlement and the price of what is left are computed on every run, including the first one a
     * project ever does — that is what makes this one step rather than three. `--target` and
     * `--bundle` are needed only by the comparison, so they are required exactly where it runs. */
    const comparing = typeof previousOpt === "string" && previousOpt.length > 0;
    if (comparing && !opts.target) {
      console.error(
        "--previous needs --target: every premise of the previous run's verdicts is re-derived from the tree as it is today and from the rule bundle (--bundle, else the one shipped with this program), and neither is in the findings document.",
      );
      process.exit(1);
    }
    const targetRoot = comparing ? resolve(opts.target as string) : "";
    if (comparing && !existsSync(targetRoot)) {
      console.error(
        `--target ${targetRoot} does not exist. Every premise is re-derived from the tree, and a comparison against a tree that is not there would report every verdict as carryable or as changed for the wrong reason.`,
      );
      process.exit(1);
    }

    /* THE PREVIOUS RUN'S VERDICTS, read by `readPreviousRun` (adjudicate-plan.ts), the function
     * `assemble-report` reads them with again (relay item 5, N13-N14): a directory of the run's own
     * files, or one assembled log. */
    const previousPath = comparing ? resolve(previousOpt as string) : "";
    if (comparing && !existsSync(previousPath)) {
      console.error(`--previous ${previousPath} does not exist. A later run with no earlier run to compare against adjudicates everything, and this command will not pretend otherwise.`);
      process.exit(1);
    }
    /* READ ONCE: the vouch below, the question's choice and the carry all
     * rest on the bytes read here (`readPreviousRun` hashes what it parses), and the plan keeps their sha256
     * (`previous_sha256`), which the assembly checks when it reads the log again. The vouch read the file, then the carry
     * read it again: a file swapped in between was carried unvouched (checker G2, 1 in 30 tries). */
    let previousRun: PreviousRun = { previous: [], notTaken: [] };
    if (comparing) {
      try {
        previousRun = readPreviousRun(previousPath);
      } catch (e) {
        if (!(e instanceof PreviousRunUnreadable)) throw e;
        console.error(`--previous ${e.path} could not be read: ${e.message}`);
        process.exit(2);
      }
    }
    // A typed earlier run, where a plugin session was recorded around this step: vouched for or refused.
    if (comparing && previousFromAnswer === null && recordedSessions !== null) {
      const unvouched = previousVouchRefusal(previousPath, previousRun, targetRoot, processStateDir(), recordedSessions.projectDir);
      if (unvouched !== null) {
        console.error(unvouched);
        process.exit(1);
      }
    }
    if (comparing && previousFromAnswer !== null && previousRun.sha256 !== previousChosenSha) {
      console.error(
        `refused: the log the person chose, ${previousPath}, changed after the earlier-run question listed it (sha256 then ${previousChosenSha ?? "not listed"}, now ${previousRun.sha256 ?? "unknown"}), so it is not the log they chose. ` +
          `Run the same command again: the question is put again with the logs as they are now. ${nothingWrittenWords()}.`,
      );
      process.exit(1);
    }
    const { notTaken } = previousRun;

    /* WHICH SCAN EVERY CARRIED VERDICT IS LABELLED WITH. The previous findings document is the
     * record of it; the two options below exist for a run whose document is not to hand, and the
     * last resort is a digest of the path so that the label is never empty — a carried verdict whose
     * source run cannot be named is a carried verdict nobody can audit. A log never names it, by its
     * top-level `scan_id` or a record's (`readPreviousRun` gives no record's from a log):
     * the label is shown beside the path the person typed
     * instead (carry-forward.ts `earlierRunWords`). */
    let previousScanId = (opts.previousScan as string | undefined) ?? "";
    if (!previousScanId && opts.previousFindings) {
      try {
        // A file the person names, like --previous: followed where it is a link, never opened where it can block.
        const named = readNamedFile("--previous-findings", resolve(opts.previousFindings as string));
        if (!named.ok) throw new Error(named.problem);
        const doc = JSON.parse(named.value.toString("utf8")) as { scan?: { scan_id?: string }; scan_id?: string };
        previousScanId = doc.scan?.scan_id ?? doc.scan_id ?? "";
      } catch (e) {
        console.error(`--previous-findings could not be read as JSON: ${(e as Error).message}`);
        process.exit(2);
      }
    }
    /* A label is shown in the seat's brief, the report and the terminal, so one not in
     * the form of a scan id (one line of letters, digits and `._:-`) is never used: a findings document the person
     * names can be a file in the scanned tree. The digest of the path names the run instead, and the person is told. */
    if (previousScanId && !isRunLabel(previousScanId)) {
      console.error(`The earlier run's scan id is not in the form of a scan id (one line of letters, digits and "._:-", at most 100 characters), so it is neither used nor shown: the run is named by a digest of the path you gave.`);
      previousScanId = "";
    }
    if (!previousScanId) previousScanId = `unnamed-run-${createHash("sha256").update(previousPath).digest("hex").slice(0, 12)}`;

    const loaded = comparing ? openBundle("adjudicate", opts.bundle as string | undefined) : null;
    /* THE PLAN AND THE CARRIED VERDICTS, made by `adjudicatePlan` (adjudicate-plan.ts): the
     * declaration first, the previous run second, the price of what is left third. `assemble-report`
     * makes both again with the same function and refuses a plan field or a carried byte that differs. */
    const { plan, result, content, carried } = adjudicatePlan({
      findings,
      findingsTyped: opts.findings as string,
      orientationSheet: orientationSheetBeside(dirname(resolve(opts.findings as string)), findings.scan_id) !== null,
      ...(typeof opts.seatModel === "string" && opts.seatModel ? { seatModelOverride: opts.seatModel } : {}),
      previous:
        comparing && loaded
          ? {
              typed: previousOpt as string,
              run: previousRun,
              scanId: previousScanId,
              tree: new TreeReader(targetRoot),
              bundle: { rules: new Map(loaded.rules.map((r) => [r.id, r])), version: loaded.manifest.bundle_version, files: loaded.manifest.files },
            }
          : null,
    });

    const outPath = resolve((opts.out as string | undefined) ?? ".legal/adjudicate-plan.json");
    // Relay integration part B, item 3 (STOP 2): the plan and the carried verdicts are the first of the step's writes,
    // made under the launch list's lock (`writeUnderLock`, launch-plan.ts `preLaunchTexts`); a refusal decided before
    // any write - the launch directory, the sub-agent limit, the lock itself - writes neither.
    const planWrite = { written: false };
    const writePlan = (): void => {
      prepareOutputFolder(outPath);
      writeFileAt(outPath, content);
      planWrite.written = true;
      /* The plan's sha256, and the earlier run the
       * person chose where it came from their answer, in the record of the logs WolfBoy wrote, keyed by the project that
       * holds the plan's `.legal` (the assembly looks it up there): a plan written by another hand, or by this step in
       * another folder, is not one the assembly takes in a recorded project. A record that cannot be written is said;
       * the assembly then refuses this plan in a recorded project, as it would one written by hand. */
      {
        const planOwner = basename(dirname(outPath)) === LEGAL_DIR_NAME ? dirname(dirname(outPath)) : dirname(outPath);
        const planSha = createHash("sha256").update(content).digest("hex");
        const notes = [recordLogDigest(processStateDir(), planOwner, adjudicatePlanDigestName(outPath), planSha)];
        if (previousFromAnswer !== null && typeof previousRun.sha256 === "string") notes.push(recordLogDigest(processStateDir(), planOwner, earlierRunChosenName(previousRun.sha256), previousRun.sha256));
        for (const w of notes) if (!w.written) console.error(`noted: the plan's digest was not recorded in your state folder (${w.why}); in a project where Claude Code with the wolfboy plugin has run, the assembly will not take this plan.`);
      }
      if (opts.carryInto) {
        const dest = resolve(opts.carryInto as string);
        guardWorkingFolder(dest); // A carried verdict holds its quotations in clear.
        for (const c of carried) {
          const to = join(dest, c.rel);
          prepareOutputFolder(to);
          writeFileAt(to, c.content);
        }
        console.log(`carried ${carried.length} verdict(s) into ${dest}, each labelled with the scan it came from.`);
      }
    };

    console.log(preLaunchLines(plan, comparing ? (previousOpt as string) : null).join("\n"));
    {
      const profilePath = opts.profile ? resolve(opts.profile as string) : undefined;
      // The program's declaration is read as the scan
      // read it: an answer recorded at an earlier version of a question nothing asks before review is left out.
      const ownDeclaration = profilePath !== undefined ? readDeclaration(dirname(findingsPath)) : null;
      const leftOut = ownDeclaration !== null && profilePath === ownDeclaration.profilePath ? staleOrderFields(loadDeclarationSource(), ownDeclaration) : [];
      const loadedProfile = profilePath && existsSync(profilePath) ? loadScanProfile(profilePath, leftOut).profile : null;
      const launchDir = resolve((opts.launchDir as string | undefined) ?? join(dirname(outPath), "launch"));
      // Relay item 4: writing the run-shape question starts the scan run the launch gate acts on (hook-launch.ts). And by the project a recorded plugin session ran in, whatever the environment says.
      const refusedDir = launchDirRefusal(launchDir, findingsPath, process.env) ?? (recordedSessions === null ? null : recordedLaunchDirRefusal(launchDir, recordedSessions.projectDir));
      const runLines: string[] = [];
      // The step writes the marker twice (the question, then the list): the first write decides whether a new attempt
      // started and what it released, and the report keeps that, not the second write's "the same attempt continues".
      let started: { newAttempt: boolean; released: string[] } | null = null;
      const texts =
        refusedDir !== null
          ? { lines: [refusedDir], exitCode: 1 }
          : preLaunchTexts({
              plan,
              planFile: { path: outPath, sha256: createHash("sha256").update(content).digest("hex") },
              findings,
              findingsPath,
              // The places each re-adjudicated candidate's previous verdict left unread, for its brief.
              previousNotChecked: Object.fromEntries(
                (result?.rows ?? []).flatMap((row) => (row.previous_not_checked ? [[row.finding_id, row.previous_not_checked] as const] : [])),
              ),
              launchDir,
              // An entry answered or kept not judged, by the relaunch rule, is not priced again.
              entryDone: (runId) => {
                const ledgers = readAnswerLedgers(dirname(launchDir), launchDir, runId);
                return (id) => {
                  const r = relaunchable(ledgers, id);
                  return !r.ok && (r.state === "answered" || r.state === "invalid");
                };
              },
              writeUnderLock: writePlan,
              shape: opts.shape as string | undefined,
              shapeFromAnswer: opts.shapeFromAnswer === true,
              askShape: opts.askShape === true,
              // The person's own record of the start question, in their state folder (start-record.ts).
              startRecordDir: processStateDir(),
              /* Why a later run asks the start question again: it would judge
               * most earlier verdicts again, or carries none (no log in this folder, or none chosen, or none named). */
              later: laterRunOf({
                comparing,
                noneWhy:
                  earlierNoneChosen ||
                  (() => {
                    try {
                      return readdirSync(join(dirname(findingsPath), EVIDENCE_DIR_NAME)).some((n) => EVIDENCE_LOG_NAME.test(n));
                    } catch {
                      return false;
                    }
                  })()
                    ? "chosen"
                    : "folder",
                rows: result?.rows ?? [],
                toAdjudicate: plan.to_adjudicate,
                // Counted in places: the candidates carried whole, less those the
                // declaration set aside (as pre-launch.ts counts `carried.candidates`), and every candidate's locations.
                carried: ((settled) => (result?.carried ?? []).map((r) => r.finding_id).filter((id) => !settled.has(id)))(new Set(plan.pre_settled.map((r) => r.finding_id))),
                candidates: findings.candidates ?? [],
              }),
              profilePath,
              profile: loadedProfile ? { value: loadedProfile, digest: profileDigest(loadedProfile) } : null,
              subagentLimitFlag: opts.subagentLimit,
              reservePlaces: opts.reserveSubagents ?? opts.reservePlaces,
              reserveFlag: opts.reservePlaces !== undefined ? "--reserve-places" : RESERVE_FLAG,
              seatModel: opts.seatModel as string | undefined,
              env: process.env[SUBAGENT_LIMIT_ENV],
              refuseRun: () => markerSessionRefusal(process.env),
              onRunWritten: (r) => {
                const scanProfile = profileRecord(process.env);
                // Inside a Claude Code session, the level it started with, recorded on the marker and shown
                // beside the price table; outside one there is no session level, and nothing is recorded or said.
                const inSession = claudeCodeSigns(process.env).length > 0;
                const startLevel = inSession ? startEffort(process.env) : undefined;
                const w = writeActiveRun({ launchDir, runId: r.runId, scanId: r.scanId, sessionId: process.env[SESSION_ENV], listPath: r.listPath, scanProfile, startEffort: startLevel, now: new Date() });
                started ??= { newAttempt: w.newAttempt, released: w.released };
                runLines.splice(0, runLines.length, ...activeRunLines({ ...w, ...started }));
                if (scanProfile?.state === "waived") runLines.push(profileWaivedLine(scanProfile.missing));
                if (startLevel !== undefined) runLines.push(effortStartLine(startLevel));
                const variable = inSession ? effortVariableLine(process.env) : null;
                if (variable !== null) runLines.push(variable);
              },
            });
      // "Not now" to the start question ends the run the question started, as run-abort does.
      if ("notStarted" in texts && texts.notStarted === true) {
        const ended = endActiveRun(launchDir, "not-started", new Date());
        runLines.splice(0, runLines.length, `RUN ENDED: ${ended.note}; the launch gate no longer acts in this session.`);
      }
      console.log(`\n${[...texts.lines, ...runLines].join("\n")}`);
      if (texts.exitCode !== 0) process.exitCode = texts.exitCode;
    }

    if (notTaken.length > 0) {
      console.log(
        `\n${notTaken.length} previous record(s) carry no verdict word of the three (violation_candidate, not_applicable, ` +
          "needs_human) and were not taken as verdicts: nothing is carried from them, and a candidate only they answered is " +
          "adjudicated again as `new-candidate`:",
      );
      for (const n of notTaken) {
        console.log(`  ${n.source}: ${n.finding_id} — \`verdict\` is ${n.verdict === undefined ? "absent" : JSON.stringify(n.verdict)}`);
      }
    }

    if (result) {
      const c = result.counts;
      console.log(
        `\n${c.candidates} candidate(s) compared against ${earlierRunWords(previousScanId, { who: "you", path: previousOpt as string })}: ${c.carried} carried forward, ${c.adjudicate} to adjudicate, ${c.gone} previous verdict(s) whose candidate is gone${c.not_chosen > 0 ? `, ${c.not_chosen} previous verdict(s) not compared because a candidate each could answer is in this scan and was compared with another earlier verdict or, where nothing recorded places the verdict on one of several such candidates, given to a seat again (listed as not_chosen, each saying why)` : ""}.\n` +
          `  (this ${c.carried} counts the carried verdicts the declaration ALSO settles; the block above counts what is left after that settlement, which is what --carry-into writes.)`,
      );
      for (const [reason, n] of Object.entries(c.by_reason).sort()) console.log(`  ${reason}: ${n}`);
      for (const [premise, n] of Object.entries(c.by_premise).sort()) console.log(`  premise that changed — ${premise}: ${n}`);
      console.log(
        `\nA carried verdict is CARRIED, not re-verified: no seat read its candidate in this run, and the claim is only that every ` +
          `premise it recorded was reproduced exactly.`,
      );
      // A declared equivalence of the verdict rules is said, so "exactly" stays true.
      const alike = verdictRulesJudgedAs(VERDICT_RULES_VERSION).slice(1);
      if (alike.length > 0) {
        console.log(
          `The program's verdict rules count as reproduced where a verdict was judged under ${alike.map((v) => verdictRulesAlikeWords(v)).join("; or under ")}.`,
        );
      }
    } else {
      console.log(
        "\nNo previous run was given, so nothing was carried forward and no premise was compared: every candidate the declaration leaves standing needs a seat. Pass --previous on the next run of this project.",
      );
    }
    console.log(planWrite.written ? `\nWritten to ${outPath}.` : `\n${nothingWrittenWords()}: the step was refused before its first write.`);
    console.log(`\n${DISCLAIMER}`);
  });

/**
 * `run-status` - THE ONE STATUS LINE of a run (relay rework item 4, `launch-plan.ts`): seats returned
 * of listed, elapsed time, the remaining time from this run's own returned seats, and the tokens its
 * records carry. It reads the launch list and the program's own event records and nothing else.
 */
program
  .command("run-status")
  .description(
    "Print ONE line: seats returned of those listed (a seat that returned with its answer lost counted apart, and a seat known lost before returning counted apart from those running), time since the first launch, the remaining time estimated from THIS run's returned seats (never from a constant; it says so when none has returned) or, for a run that has ended, how and when it ended, and the tokens the program's own records carry. Reads the launch list, the launch events and the run's records beside it",
  )
  .requiredOption("--launch-list <file>", "the launch list the pre-launch step wrote (.legal/launch/launch-list.json)")
  .option("--events <file>", "the program's launch and capture records, one JSON object per line (default: launch-events.jsonl beside the list)")
  .option("--now <iso>", "the moment to report at, for a replay (default: the clock)")
  .option("--json", "print the status as JSON instead of the line")
  .action((opts) => {
    const got = runStatusOf(resolve(opts.launchList as string), opts.events as string | undefined, opts.now as string | undefined);
    if (!got.ok) {
      console.error(got.message);
      process.exitCode = got.exit;
      return;
    }
    console.log(opts.json ? JSON.stringify(got.status) : `${got.status.line}\nFOR THE PERSON (tell them this sentence as it is): ${got.status.person}`);
  });

/**
 * THE ONE STATUS LINE's computation, read by `run-status` and by `launch-next`, which prints it under the
 * entries to launch: the status, or why an input cannot be read and the exit code that says so.
 */
function runStatusOf(listPath: string, eventsOpt: string | undefined, nowOpt: string | undefined): { ok: true; status: RunStatus; now: Date } | { ok: false; message: string; exit: number } {
  // Relay integration part B, item 7 (A-21): the list and the events are read through the one reader of
  // program-written files - the list against the digest its run's marker records (`readLaunchList`), the events as a
  // regular file with one name, opened without blocking (`readLaunchEvents`). Only the hooks write the events: the
  // launch gate's `launched` and `failed` (hook-launch.ts `appendEvent`) and the capture's `returned` (hook-capture.ts).
  // A list it cannot read is 2, run-status's code for an input it cannot use, whatever stands at the path: missing, a
  // named pipe, a directory, a link, a file with a second name, or a file it may not open (m4 of the integration
  // verification: it was 1 for all but a missing list). A list it read that is not the list the program last wrote
  // stays 1 (A-21, test:launch-later's I7).
  const listRead = readLaunchList(listPath);
  if (!listRead.ok) return { ok: false, message: `--launch-list ${listPath}: refused - ${listRead.problem}`, exit: listRead.exit === "unreadable" || listRead.kind !== undefined ? 2 : 1 };
  const list: LaunchList = listRead.value;
  const now = nowOpt ? new Date(nowOpt) : new Date();
  if (Number.isNaN(now.getTime())) return { ok: false, message: `--now ${String(nowOpt)} is not a date.`, exit: 1 };
  const eventsPath = resolve(eventsOpt ?? join(dirname(listPath), "launch-events.jsonl"));
  let eventsRead: ReturnType<typeof readLaunchEvents>;
  try {
    eventsRead = readLaunchEvents(eventsPath);
  } catch (e) {
    return { ok: false, message: `--events ${eventsPath}: refused - ${(e as Error).message}`, exit: 1 };
  }
  const { events, unreadable } = eventsRead;
  // m1 and m2 of the integration verification: a seat that returned with its answer lost is counted
  // apart, by the relaunch rule the launch gate and the assembly ask (entry-answer.ts), from the ledgers beside the
  // list; a run that has ended says so, from its history line. The same rule's answer for a seat with no
  // end (lost at the resume of the run's conversation, or past the bound) counts it as lost, not running.
  const launchDir = dirname(listPath);
  let lost: Set<string>;
  // The verdict records examined for refuters as their bytes are now (launch-later.ts `examines`).
  let examined: Set<string>;
  // The refuter entries superseded, from the same ledgers the relaunch rule reads (entry-answer.ts).
  let superseded: Set<string>;
  try {
    const answers = readAnswerLedgers(dirname(launchDir), launchDir, list.run_id, now);
    lost = new Set(list.entries.filter((e) => relaunchable(answers, e.id).ok).map((e) => e.id));
    examined = examinedRecords(list, dirname(launchDir));
    superseded = new Set(answers.refuters.superseded.keys());
  } catch (e) {
    return { ok: false, message: `the ledgers beside ${listPath} could not be read: refused - ${(e as Error).message}`, exit: 1 };
  }
  const standing = readActiveRun(launchDir);
  const end = standing.state === "active" && standing.marker.run_id === list.run_id ? null : lastRunEnd(launchDir, list.run_id);
  return { ok: true, now, status: runStatus(list, events, now, unreadable, { lost, examined, superseded, ended: end ? { how: end.how, ended_at: end.ended_at } : null }) };
}

/** The relaunch rule for `readNextLaunches` and the run-abort guard: the ledgers of run `runId` beside `launchDir`, read once, at `now`. */
const relaunchFor =
  (launchDir: string) =>
  (runId: string, now: Date): RelaunchOf => {
    const ledgers = readAnswerLedgers(dirname(launchDir), launchDir, runId, now);
    return (id) => relaunchable(ledgers, id);
  };

/**
 * What the person runs in their own terminal to end the run, by absolute paths, made as every told
 * command is (scanner-command.ts `scannerCommand`).
 */
const personAbortCommand = (launchDir: string): string => scannerCommand(["run-abort", "--launch-dir", launchDir]);

/**
 * `launch-next` - WHAT TO LAUNCH NOW. Live run 2 (2026-09-29) left four listed entries unlaunched
 * because the orchestrator counted from its own notes; the program knew, and printed nothing that said so. This prints,
 * from the launch gate's own computation (hook-launch.ts `readNextLaunches`), every entry to launch now with the Agent
 * input the gate accepts, what is still to come, the seats running and the run's status line. It writes nothing.
 * SKILL.md step 4 launches only from its output, runs it again after every returned seat and every refusal, and keeps no
 * list of its own.
 */
program
  .command("launch-next")
  .description(
    "Print what to launch NOW in the active scan run, from the launch gate's own computation: each entry not yet launched (or launched again by the relaunch rule) whose waits have returned, as many as there are free places, with the Agent input to pass exactly; then what is still to come, the seats running and the run's status line. The last line says NOTHING TO LAUNCH NOW (run it again when a seat returns) or NOTHING LEFT TO LAUNCH. Writes nothing. Exit 0 when it read the run (or found none active), 2 when the marker or the list cannot be read",
  )
  .option("--launch-dir <dir>", "the run's launch directory (default: .legal/launch)")
  .option("--now <iso>", "the moment to decide at, for a replay (default: the clock)")
  .option("--json", "print it as JSON")
  .action(async (opts) => {
    // Nothing to launch in a session where the plugin's hooks are not running.
    const hooksStop = hooksNotRunningRefusal(process.env);
    if (hooksStop !== null) {
      console.error(hooksStop);
      process.exitCode = 4;
      return;
    }
    const launchDir = resolve((opts.launchDir as string | undefined) ?? join(".legal", "launch"));
    const now = opts.now ? new Date(opts.now as string) : new Date();
    if (Number.isNaN(now.getTime())) {
      console.error(`--now ${String(opts.now)} is not a date.`);
      process.exitCode = 1;
      return;
    }
    const read = readNextLaunches(launchDir, now, relaunchFor(launchDir));
    if (read.state === "unreadable") {
      console.error(`launch-next: refused - ${read.problem}. Nothing is launched while it stands; run the pre-launch step again to write the list.`);
      process.exitCode = 2;
      return;
    }
    const status = read.state === "active" ? runStatusOf(read.list_path, undefined, now.toISOString()) : null;
    const statusLine = status === null ? null : status.ok ? status.status.line : status.message;
    if (opts.json) {
      console.log(JSON.stringify(launchNextJson(read, statusLine)));
      return;
    }
    // The verdict records the capture could not run refuter-entries for, each with its command.
    let due: string[] = [];
    if (read.state === "active") {
      try {
        due = await refuterEntriesDueFor(read.launch_dir, read.list_path, read.marker, now);
      } catch (e) {
        due = [`the records still due refuter-entries cannot be named now (${valueText((e as Error).message)})`];
      }
    }
    console.log(launchNextLines(read, statusLine, due).join("\n"));
  });

/**
 * `wait-next` - THE PROGRAM-OWNED WAKER. The main conversation runs it in the
 * background where the scanner's stop hook (hook-launch.ts `mainStopped`) finds the run outstanding and nothing that
 * will wake the conversation. It reads the launch gate's own computation (`readNextLaunches`, as launch-next does) every
 * few seconds and exits as soon as an entry is launchable now (a reservation whose result never came counts as released
 * once it falls due), a listed seat is running, nothing will come due without the person, or no run is active - or at
 * its bound - and prints launch-next's lines; the exit of a background command wakes the conversation. What it waits for
 * is the Stop hook's own predicate (hook-launch.ts `dueWithoutPerson`). It writes
 * nothing and launches nothing.
 */
program
  .command("wait-next")
  .description(
    "Wait, writing nothing, until the active scan run's next launch is possible, then print what launch-next prints. Exits as soon as an entry the launch gate admits is launchable now (a launch reserved whose result never came counts once the gate would release it), a listed seat is running, nothing will come due without the person (no reservation the gate will release, nothing launchable), or no run is active; or at --max-wait. Run it in the background where the scanner's stop hook says so: its exit wakes the conversation. Exit 0, or 2 when the marker or the list cannot be read",
  )
  .option("--launch-dir <dir>", "the run's launch directory (default: .legal/launch)")
  .option("--max-wait <seconds>", "the longest it waits before printing launch-next's lines anyway (default 900)")
  .option("--poll-ms <ms>", "how often it reads the gate's files again (default 2000)")
  .action(async (opts) => {
    const launchDir = resolve((opts.launchDir as string | undefined) ?? join(".legal", "launch"));
    const maxWait = opts.maxWait === undefined ? 900 : Number(opts.maxWait);
    const poll = opts.pollMs === undefined ? 2000 : Number(opts.pollMs);
    if (!Number.isFinite(maxWait) || maxWait < 0 || !Number.isInteger(poll) || poll < 1) {
      console.error("wait-next: --max-wait takes seconds (0 or more) and --poll-ms a whole number of milliseconds (1 or more).");
      process.exitCode = 1;
      return;
    }
    // As launch-next: nothing to launch where the plugin's hooks are not running.
    const hooksStop = hooksNotRunningRefusal(process.env);
    if (hooksStop !== null) {
      console.error(hooksStop);
      process.exitCode = 4;
      return;
    }
    const until = Date.now() + maxWait * 1000;
    for (;;) {
      const now = new Date();
      const read = readNextLaunches(launchDir, now, relaunchFor(launchDir));
      if (read.state === "unreadable") {
        console.error(`wait-next: refused - ${read.problem}. Nothing is launched while it stands; run the pre-launch step again to write the list.`);
        process.exitCode = 2;
        return;
      }
      const n = read.state === "active" ? read.next : null;
      // The Stop hook's own predicate (`dueWithoutPerson`): an entry the gate refuses
      // is not launchable, and a reservation the gate keeps is not waited for. It waits only while a reservation the gate
      // will release is not yet due, nothing is launchable now and no listed seat is running.
      const due = read.state === "active" ? dueWithoutPerson(read, launchHostOf(launchDir, read.marker, process.env)) : null;
      const ends = n === null || due === null || n.occupancy.listed_running > 0 || due.launchable.length > 0 || due.releasable.length === 0;
      const nothing = n !== null && due !== null && n.occupancy.listed_running === 0 && due.launchable.length === 0 && due.releasable.length === 0;
      if (ends || Date.now() >= until) {
        if (!ends) console.log(`WAIT ENDED at its bound (${maxWait} s) with no launch possible yet. Where the scanner's stop hook says so again, run wait-next again in the background.`);
        else if (nothing && (entriesLeft(n).length > 0 || n.occupancy.pending > 0)) {
          console.log(
            "NOTHING TO WAIT FOR: no entry is launchable now, no listed seat is running, and no launch reserved is one the launch gate will release; what is left waits for something only a seat's end, a relay's hand-back or the person brings (launch-next's lines below say what). The scanner's stop hook lets the next stop through.",
          );
        }
        const status = read.state === "active" ? runStatusOf(read.list_path, undefined, now.toISOString()) : null;
        console.log(launchNextLines(read, status === null ? null : status.ok ? status.status.line : status.message).join("\n"));
        return;
      }
      await new Promise((r) => setTimeout(r, Math.min(poll, Math.max(1, until - Date.now()))));
    }
  });

/** `launch-next --json`: the same content as the lines, for a program. */
function launchNextJson(read: Exclude<NextRead, { state: "unreadable" }>, statusLine: string | null): Record<string, unknown> {
  if (read.state === "none") return { active: false, run_id: read.run_id, ended: read.end ? { how: read.end.how, ended_at: read.end.ended_at } : null };
  const n = read.next;
  const item = (x: { entry: LaunchList["entries"][number]; again: { seat: string; how: string } | null }) => ({ id: x.entry.id, wave: x.entry.wave, agent_input: launchInput(x.entry), again: x.again });
  return {
    active: true,
    run_id: read.marker.run_id,
    attempt: read.marker.attempt,
    launch: n.launch.map(item),
    waiting_for_place: n.waitingPlace.map(item),
    waiting_for_entries: n.waitingFor.map((w) => ({ id: w.entry.id, waits: w.waits })),
    left: entriesLeft(n).length,
    for_the_person: resumedSentence(n),
    // After a resume, a relay first where one can run; launches an undelivered receipt named.
    relay_first: relayFirst(read),
    promised: n.promised.map((x) => ({ id: x.entry.id, by: x.by })),
    free: n.free,
    occupancy: n.occupancy,
    presumed_lost: n.lost,
    released_as_stale: read.released,
    state: n.launch.length > 0 ? "launch" : entriesLeft(n).length > 0 || n.occupancy.listed_running + n.occupancy.pending > 0 ? "wait" : "done",
    status: statusLine,
    // The run's seats whose own transcript records another effort level than their agent file pins.
    effort_changes: runEffortChanges(read.launch_dir, read.marker.run_id),
  };
}

/**
 * After a resume, ONE PATH. While entries
 * lost at the resume are to launch again (`resumedSentence`) and `relay-entry` would offer a relay now (relay-seat.ts
 * `relayNotOffered`, its own predicate), `launch-next` points at `relay-entry` and lists no Agent input, as SKILL.md step 4
 * says: the run goes on as it began, and the relay keeps every seat's report out of the main session's context. Where
 * relay-entry would print NO RELAY, or the gate has refused a relay since the resume, the entries are listed as before.
 */
function relayFirst(read: Extract<NextRead, { state: "active" }>): boolean {
  if (resumedSentence(read.next) === null) return false;
  if (relayNotOffered(read.launch_dir, process.env, new Date(), read) !== null) return false;
  return !relayRefusedSinceResume(read.launch_dir, read.marker);
}

/** `launch-next`'s lines: the header, one block per entry to launch now, what is still to come, the seats running, the status line, and the terminal line. */
function launchNextLines(read: Exclude<NextRead, { state: "unreadable" }>, statusLine: string | null, due: readonly string[] = []): string[] {
  if (read.state === "none") {
    const ended = read.end ? `; run ${read.run_id} ended (${read.end.how}) at ${read.end.ended_at}` : "";
    return [`LAUNCH NEXT: no scan run is active in ${read.launch_dir}${ended}. Nothing is launched outside a run: the pre-launch step (SKILL.md 3j-3l) starts one.`];
  }
  // U2 item 3: in a conversation other than the run's, nothing of the run is launched; the run's own continues it.
  const own = process.env[SESSION_ENV] || process.env[CLAUDE_CODE_SESSION_ENV] || "";
  if (own !== "" && read.marker.session_id !== null && own !== read.marker.session_id) return [`LAUNCH NEXT: launch nothing in this conversation. ${otherConversationText(read.marker, own)}`];
  // U2 item 2: under the run's auto-mode stop no entry is printed as launchable; the person decides first.
  const stopped = stopBar(launchHostOf(read.launch_dir, read.marker, process.env));
  if (stopped) return [`LAUNCH NEXT for scan run ${read.marker.run_id} (attempt ${read.marker.attempt}): LAUNCHING STOPPED: ${stopped.text}`, ...(statusLine !== null ? [`STATUS: ${statusLine}`] : [])];
  const n = read.next;
  const o = n.occupancy;
  const lines = [`LAUNCH NEXT for scan run ${read.marker.run_id} (attempt ${read.marker.attempt}): ${n.launch.length} entr${n.launch.length === 1 ? "y" : "ies"} to launch now, ${n.free} of ${o.capacity} seat(s) free.`];
  // A run started by another version of the program: said to the person, never decided here.
  const versions = programVersionSentence(read.marker, read.launch_dir);
  if (versions !== null) lines.push(`${FOR_THE_PERSON} ${versions}`);
  // LOST AT THE RESUME: the one sentence the person is told, while entries lost with the earlier process are to launch again.
  const resumed = resumedSentence(n);
  if (resumed !== null) lines.push(`${FOR_THE_PERSON} ${resumed}`);
  // After a resume, the run goes on as it began - through a relay, where relay-entry would offer one.
  if (relayFirst(read)) {
    lines.push(
      `RELAY FIRST: the run's conversation was resumed, no relay is live and no listed seat is running, so a new relay launches these ${n.launch.length} entr${n.launch.length === 1 ? "y" : "ies"}, as at the run's start (SKILL.md step 4): run ${scannerCommand(["relay-entry", "--launch-dir", read.launch_dir])} and launch the relay it names. Launch the entries yourself only where it prints NO RELAY or the launch gate refuses the relay; launch-next then lists them.`,
    );
    if (statusLine !== null) lines.push(`STATUS: ${statusLine}`);
    return lines;
  }
  // One text with the receipts': hook-launch.ts launchNowLines.
  lines.push(...launchNowLines(n));
  // Launches a receipt named whose report has not reached its launcher yet are that receipt's.
  if (n.promised.length > 0) lines.push(`Named in a receipt not yet delivered (Claude Code has not yet handed that seat's report to whoever launched it): ${n.promised.map((x) => `${x.entry.id} (seat ${x.by}'s receipt)`).join(", ")}. Whoever that report reaches launches them from it; launch-next lists them here only if the report arrives without them.`);
  const waitsText = n.waitingFor.map((w) => `${w.entry.id} waits for ${w.waits.join(", ")}`).join("; ");
  const toCome = n.waitingPlace.length + n.waitingFor.length;
  lines.push(
    `Still to come after these: ${toCome}${toCome > 0 ? ` (${n.waitingPlace.length} waiting for a free place${n.waitingFor.length > 0 ? `, ${n.waitingFor.length} waiting for entries that have not returned: ${waitsText}` : ""})` : ""}.`,
    `Seats running: ${o.listed_running} listed, ${o.pending} launch(es) awaiting their result, ${o.unlisted_running} without a listed launch${n.lost.length > 0 ? `; presumed lost (no sign of their end past the bound, or none before the run's conversation was resumed after its process ended; their entries are launched again): ${n.lost.map((l) => `${l.entry} seat ${l.seat} since ${l.lost_at}${l.by === "resume" ? " (lost at the resume)" : ""}`).join(", ")}` : ""}.`,
  );
  if (read.released.length > 0) lines.push(`Reservations the launch gate releases before its next decision (no launch result came): ${read.released.join(", ")}.`);
  const effortLine = effortChangeLine(runEffortChanges(read.launch_dir, read.marker.run_id));
  if (effortLine !== null) lines.push(effortLine);
  if (statusLine !== null) lines.push(`STATUS: ${statusLine}`);
  // What the capture could not append: the main session's command, before anything ends.
  if (due.length > 0) lines.push(`REFUTER ENTRIES DUE: ${due.join("; ")}. Run each command named, then run launch-next again.`);
  if (n.launch.length > 0) lines.push("Launch each entry above, in the background, then run launch-next again after every returned seat and after every refusal: launch only what it prints.");
  else if (due.length > 0) lines.push("NOTHING TO LAUNCH NOW: run the refuter-entries command(s) above, then launch-next again.");
  else if (toCome > 0 || o.listed_running + o.pending > 0) lines.push("NOTHING TO LAUNCH NOW: every free place waits for a running seat's answer. Run launch-next again when a seat returns.");
  else lines.push("NOTHING LEFT TO LAUNCH: every listed entry has been launched and no listed seat is running. Go on: step 5 for records captured since, then step 5a.");
  return lines;
}

/**
 * What the session command says where it cannot start Claude Code. The scan runs in Claude
 * Code's command-line tool, which the VS Code extension does not put on PATH: someone who has Claude Code only as the
 * extension reads "Install Claude Code" as wrong.
 */
export const CLI_NOT_FOUND_WORDS =
  "The scan runs in Claude Code's command-line tool, in a terminal (VS Code's own terminal is fine). The VS Code extension alone does not install that tool: install it as https://code.claude.com/docs/en/setup says, or name it with --claude <path>.";

/**
 * `session` - THE SCAN LAUNCH PROFILE (scan-profile.ts). Starts
 * the Claude Code session a scan runs in, with the profile set for that session only: no settings file of the person is
 * written. From the person's own terminal only: inside a Claude Code session it is refused (a session started from a
 * tool call would have no terminal). It will later be folded into the one-line `npx` entry.
 */
program
  .command("session")
  .description(
    "Start the Claude Code session a scan runs in, with the scan launch profile, for that session only - no settings file is written: the scanned repository's instruction files (CLAUDE.md, AGENTS.md) off, git status off, the claude.ai connectors and every other MCP configuration off, prompt suggestions off, and, where ANTHROPIC_API_KEY is set, a one-hour prompt cache. The effort level stays yours: --effort is passed only where you give one, and a level set in CLAUDE_CODE_EFFORT_LEVEL is passed as --effort instead of the variable; the start level is recorded, and the judging agents run at the level their agent files pin. Keep the effort level as it is until the run ends: a change discards the cached prefix. It prints the start screen (the two steps, and where code goes) and starts Claude Code; these settings are not printed. Run it from your own terminal, in the repository to scan; Claude Code's own arguments go after -- (for example -- --resume <conversation id>, which continues that conversation; not --continue, which takes the folder's most recent one). The plugin's SessionStart hook checks the profile, and the scan and the pre-launch step stop in a session without it. --without-profile starts the session without it, as your own choice, which the run records",
  )
  .argument("[claude-args...]", "arguments passed to Claude Code as they are, after --")
  .option("--effort <level>", `the effort level for the whole session (${EFFORT_LEVELS.join(", ")}); without it, your own level`)
  .option("--without-profile", "start the session without the profile: your own choice, which the plugin's hook reads and the run records")
  .option("--claude <command>", "the Claude Code command to start", "claude")
  .action((claudeArgs: string[] | undefined, opts) => {
    const inside = claudeCodeSigns(process.env);
    if (inside.length > 0) {
      console.error(
        `refused: this shell is inside a Claude Code session (${inside.join(" and ")} set), and legal-scan session starts a session of its own. ` +
          "Run it from your own terminal, in the repository to scan. Nothing was started.",
      );
      process.exitCode = 4;
      return;
    }
    // The person's level is kept - named only where they give one or set the variable (scan-profile.ts).
    const effort = sessionEffort(opts.effort === undefined ? undefined : String(opts.effort), process.env);
    if ("refused" in effort) {
      console.error(`refused: ${effort.refused}. Nothing was started.`);
      process.exitCode = 1;
      return;
    }
    const without = opts.withoutProfile === true;
    const launch = profiledLaunch({ effort: effort.level, without, env: process.env, passThrough: claudeArgs ?? [] });
    const env: NodeJS.ProcessEnv = { ...process.env, ...launch.set };
    for (const name of launch.unset) delete env[name];
    // A bare --claude name is found on PATH outside the folder the session
    // starts in, as node-choice.bash finds node, so the repository's own `claude` file (reached through a relative PATH
    // entry or a folder inside the repository) is never the program started.
    const named = String(opts.claude);
    const onPath = /[\\/]/.test(named) ? named : programOnPath(named, foldersNoProgramComesFrom());
    // Where no `claude` is on PATH, the copy the VS Code extension installed
    // (child-program.ts `claudeOfEditorExtension`): the person who has Claude Code only as the extension can scan.
    const fromExtension = onPath === null && named === "claude" ? claudeOfEditorExtension(foldersNoProgramComesFrom()) : null;
    const program = onPath ?? fromExtension;
    if (fromExtension !== null) console.log(`  Claude Code's command-line tool is not on PATH; using the copy the VS Code extension installed:\n  ${fromExtension}`);
    if (program === null) {
      console.error(
        `refused: ${JSON.stringify(named)} was not found on PATH in a folder outside the repository to scan (a relative PATH entry, or a folder inside the repository, is skipped: the repository could hold a program of that name). ${CLI_NOT_FOUND_WORDS} Nothing was started.`,
      );
      process.exitCode = 2;
      return;
    }
    // On Windows an npm-installed Claude Code is `claude.cmd`, a batch file Node does not
    // start without a shell: it is started as the file the shim names (child-program.ts `programStart`), never through cmd.
    const start = programStart(program, foldersNoProgramComesFrom());
    if ("refused" in start) {
      console.error(`refused: ${start.refused} Nothing was started.`);
      process.exitCode = 2;
      return;
    }
    // Order at the merge of R10-SESSION over R10-HOOKS: the copy check first (a
    // hand-over to the plugin's own copy leaves every later check to that copy, which matches its hooks), then the Claude
    // Code floor and Git Bash refusals, then the start screen, so no refusal follows a screen that promised a scan. Which copy starts the session (session-copy.ts): the installed plugin's own
    // copy, which matches its hooks; a global copy of another version hands the start to it and says so; the plugin's copy
    // offers the short command while no command of that name is on PATH. A --plugin-dir session (a source checkout) is not
    // in Claude Code's listing, so nothing is read for it.
    let offer: string | null = null;
    if (!(claudeArgs ?? []).includes("--plugin-dir")) {
      const mine = ownPlugin();
      const own = ownPackageFacts(ownPackage());
      const pluginName = mine === null ? null : pluginNameOf(mine);
      let entries: PluginEntry[] | null = null;
      if (mine !== null && own !== null && pluginName !== null) {
        const listed = spawnStart(start, ["plugin", "list", "--json"], { encoding: "utf8", timeout: 30_000, env, maxBuffer: 1 << 24 });
        try {
          entries = listed.status === 0 ? pluginEntriesOf(JSON.parse(listed.stdout), pluginName) : null;
        } catch {
          entries = null;
        }
      }
      const shortOnPath = own?.bin ? programOnPath(own.bin, foldersNoProgramComesFrom()) !== null : false;
      const copy = sessionCopy({ mine, own, pluginName, entries, shortOnPath });
      if (copy.kind === "plugin-instead") {
        const theirs = join(copy.entry.installPath, "dist", "index.js");
        console.log(copy.line);
        if (!existsSync(theirs) || process.argv[2] !== "session") {
          console.error(`refused: the plugin's own copy has no program at ${theirs}, or this command was not started as "session". Reinstall the plugin, or run the command the plugin prints. Nothing was started.`);
          process.exitCode = 2;
          return;
        }
        process.on("SIGINT", () => {});
        const handed = spawnSync(process.execPath, [theirs, ...process.argv.slice(2)], { stdio: "inherit", env: process.env });
        process.exitCode = handed.status ?? 1;
        return;
      }
      if (copy.kind === "plugin-copy") offer = copy.offer;
      else if (copy.kind === "unchecked" && copy.line !== null) console.log(copy.line);
    }
    // The plugin's hooks are written for Claude Code CLAUDE_CODE_FLOOR or later
    // (claude-version.ts says why): an older one is refused before the session starts; one whose version cannot be read
    // starts, with a note.
    const cc = claudeCodeVersion(program, env, start);
    if (cc.kind === "below") {
      console.error(cc.sentence);
      process.exitCode = 2;
      return;
    }
    if (cc.kind === "unknown") console.error(cc.sentence);
    // On Windows a scan's hooks must run in Git Bash: named for the session, or refused.
    const bash = gitBashForSession(process.platform, env);
    if ("refused" in bash) {
      console.error(bash.refused);
      process.exitCode = 2;
      return;
    }
    Object.assign(env, bash.set);
    // The start screen only once the program is found: a screen that promises a scan and
    // then refuses reads as a broken install to someone who has Claude Code only as the VS Code extension. The start screen (the mock-up's screen 1) in place of the settings sentence, which the --help holds.
    console.log(startScreenLines(basename(process.cwd()), process.env, without).join("\n"));
    if (offer !== null) console.log(offer);
    // The session's own keys reach Claude Code through the terminal; this process only waits for it.
    process.on("SIGINT", () => {});
    const child = spawnStart(start, launch.args, { stdio: "inherit", env, encoding: "utf8" });
    if (child.error) {
      console.error(`refused: ${JSON.stringify(String(opts.claude))} could not be started (${child.error.message}). ${CLI_NOT_FOUND_WORDS}`);
      process.exitCode = 2;
      return;
    }
    process.exitCode = child.status ?? 1;
  });

/**
 * `run-abort` and `run-gate` - THE ACTIVE-RUN MARKER'S END AND THE LAUNCH GATE'S COUNTS (relay item 4,
 * hook side, `hook-launch.ts`). While the marker exists, the plugin's hooks let an Agent launch through
 * only as an unlaunched entry of the launch list; `run-abort` removes it without assembling the run.
 */
program
  .command("run-abort")
  .description(
    "End the active scan run without assembling it: remove the active-run marker, so the plugin's launch gate stops acting on Agent launches in this session. The launch list, the briefs, the launch records and every answer stay on disk; the gate's counts are printed. Ending a run is the person's decision: inside a Claude Code session it is refused (exit 4, nothing written) while no listed seat is running or awaiting its launch result and listed entries are still to launch - launch what launch-next prints instead; from the person's own terminal, outside Claude Code, it always ends the run. Where no run is active and a scan has not reached one, it closes the window of the plugin's checks before the run (a command that names Claude Code, a scheduled prompt or a message that holds a slash command): they stop refusing in that scan's conversation. The scan itself is not withdrawn - its pre-launch step can still take it to a run - and the declaration's own files stay the program's until a run ends",
  )
  .option("--launch-dir <dir>", "the run's launch directory (default: .legal/launch)")
  .option("--json", "print the counts as JSON")
  .action((opts) => {
    const launchDir = resolve((opts.launchDir as string | undefined) ?? join(".legal", "launch"));
    // (design rf13 3.9) run-abort also ends a deeper check whose seat is pending in the
    // folder (hook.ts `endDeepCheck`, history "ended: run-abort"), whatever it does with the scan's run below.
    const deepProject = dirname(dirname(launchDir));
    let deepNote = "";
    try {
      if (endDeepCheck(deepProject, "ended: run-abort", new Date(), deepTracked(deepProject), roundSessionId())) deepNote = " The deeper check whose seat was pending in this folder is ended.";
    } catch (e) {
      deepNote = ` The deeper check pending in this folder could not be ended (${(e as Error).message}).`;
    }
    if (deepNote !== "") process.on("exit", () => console.error(deepNote.trim()));
    // (hook-launch.ts `abortRefusal`, where the reasoning is recorded): inside a Claude Code session the
    // orchestrator does not end a run that only needs launching. A run the guard cannot read is ended as before: the
    // guard refuses only on what it read.
    let refused: ReturnType<typeof abortRefusal> = null;
    try {
      refused = abortRefusal(launchDir, new Date(), process.env, relaunchFor(launchDir), personAbortCommand(launchDir));
    } catch {
      refused = null;
    }
    if (refused !== null) {
      if (opts.json) console.log(JSON.stringify({ ended: false, refused: refused.text, left: refused.left }));
      else console.error(refused.text);
      process.exitCode = 4;
      return;
    }
    const ended = endActiveRun(launchDir, "aborted", new Date());
    // Where no run was active, a scan whose window is open never
    // reached a run; close that window, so that the plugin's checks before the run stop refusing in that conversation, as
    // their refusals say (hook-question.ts `recordDeclarationScanClosed`). The declaration's own files stay guarded until a
    // run ends. The text says only what this does - the checks' window closes; the scan is not withdrawn,
    // and its pre-launch step (which reads the question rounds only, `declarationOutstanding`) can still take it to a run.
    let scanClosed = false;
    let scanNote = "";
    if (!ended.ended) {
      try {
        scanClosed = recordDeclarationScanClosed(launchDir, latestRunEndAt(launchDir), new Date(), roundSessionId());
        if (scanClosed) scanNote = "; the scan had not reached a run, so the window of the plugin's checks before the run is closed in that conversation: they no longer refuse a command that names Claude Code, or a scheduled prompt or a message that holds a slash command. The scan itself is not withdrawn: its pre-launch step can still take it to a run, and the declaration's own files stay the program's until a run ends";
      } catch (e) {
        scanNote = `; the scan had not reached a run, and the window of the plugin's checks before the run could not be closed (${(e as Error).message})`;
      }
    }
    const summary = launchGateSummary(launchDir);
    if (opts.json) console.log(JSON.stringify({ ended: ended.ended, note: `${ended.note}${scanNote}`, scan_closed: scanClosed, summary }));
    else console.log([`RUN ABORT: ${ended.note}${scanNote}.`, ...launchGateLines(summary)].join("\n"));
  });

program
  .command("run-gate")
  .description(
    "Print the launch gate's counts for the active scan run (or the last one that ended): calls refused and why (launches, and messages, skills and workflows that would reach a seat), listed launches bound to a seat, seats that started with no listed launch, and places in use. Reads only the launch directory",
  )
  .option("--launch-dir <dir>", "the run's launch directory (default: .legal/launch)")
  .option("--json", "print the counts as JSON")
  .action((opts) => {
    const summary = launchGateSummary(resolve((opts.launchDir as string | undefined) ?? join(".legal", "launch")));
    console.log(opts.json ? JSON.stringify(summary) : launchGateLines(summary).join("\n"));
  });

program
  .command("reconcile-diff")
  .description(
    "Compare two reconciliation runs and say which side moved — the code or the documents — and which of the earlier conclusions may no longer describe the current state. Deterministic and model-free: it names the checklist items, claims and findings worth re-judging, and counts the ones an incremental re-check may skip. Nothing is re-judged here and neither run's artifacts are written to",
  )
  .requiredOption(
    "--before <dir>",
    "the earlier run's artifacts directory. It must hold reconcile-input.json; declarations.json (or the annotated declarations.verified.json) and findings.json are optional, and an absent one is reported in words rather than read as nothing having changed",
  )
  .requiredOption("--after <dir>", "the later run's artifacts directory, on the same terms")
  .option(
    "--out <file>",
    "write the comparison here (default: .legal/reconcile-diff.json). It is a THIRD file: neither run's reconcile-input.json, declarations.json or findings.json is modified, because the two runs are the evidence the comparison rests on. Exit 0: the two runs describe the same state under the content keys. Exit 6: differences were found — NOT an error, since two runs of a repository under development are expected to differ; the code exists so a caller can branch on whether a re-judgement pass is worth running. 6 is deliberately reused rather than unique: `questionnaire ingest` also returns 6, for its own meaning (a source that decomposed into no questions at all), and no invocation runs both commands, so 6 from THIS command means differences-found and nothing else. It is not 3 or 4 (`scan`), 5 (`reconcile-verify`) or 7 (`questionnaire verify` and `export`), each of which already means something else here, nor 1 or 2, which this CLI reserves for a caller's mistake and an unreadable file. Exit 1: bad arguments, or a run directory with no reconcile-input.json. Exit 2: one of the artifacts could not be read as JSON. A bundle-version mismatch between the two runs is printed first of everything and does not change the exit code ON ITS OWN — a bundle upgrade that adds or drops a checklist item does exit 6, through checklist_items, because that is a real difference in the questions being asked",
  )
  .action((opts) => {
    try {
      const before = readRunArtifacts("before", resolve(opts.before));
      const after = readRunArtifacts("after", resolve(opts.after));
      const diff = buildReconcileDiff({ before, after });

      const outPath = resolve(opts.out ?? ".legal/reconcile-diff.json");
      // Both runs' own files are refused as the output, all six of them. The comparison is drawn
      // from those bytes, and writing over one of them destroys the input the next comparison
      // needs — the same rule `reconcile-verify` holds for --report and --input, applied to a
      // command that reads six files instead of two.
      const sources = [before, after].flatMap((run) =>
        [run.input_file, run.report_file, run.findings_file]
          .filter((f): f is string => Boolean(f))
          .map((f) => ({ path: resolve(join(run.dir, f)), side: run.side, file: f })),
      );
      const clash = sources.find((s) => s.path === outPath);
      if (clash) {
        console.error(
          `--out is the same file as the ${clash.side} run's ${clash.file}. The two runs are the ` +
            `evidence this comparison rests on and neither is written to; the comparison goes to a ` +
            `separate file. Choose another --out.`,
        );
        process.exit(1);
      }

      prepareOutputFolder(outPath);
      writeFileAt(outPath, `${JSON.stringify(diff, null, 2)}\n`);

      console.log(summarizeReconcileDiff(diff, outPath));
      console.log(`\n${RECONCILE_DIFF_DISCLAIMER}`);
      const code = reconcileDiffExitCode(diff);
      if (code !== 0) process.exit(code);
    } catch (e) {
      if (e instanceof ReconcileDiffRefusal) {
        console.error(e.message);
        process.exit(e.exitCode);
      }
      throw e;
    }
  });

/* --------------------------------------------------------------------------------------------- *
 * `questionnaire` — answering a form somebody else wrote.
 *
 * Four subcommands, in the order they are used: ingest (decompose it, and print the split for a
 * person to confirm), assemble (the material inventory the answering agent starts from), verify
 * (every quotation in the drafted answers, against the real files), export (back into the shape it
 * arrived in). The judgement between assemble and verify belongs to the `questionnaire-answer`
 * skill and to no command here.
 * --------------------------------------------------------------------------------------------- */

const questionnaire = program
  .command("questionnaire")
  .description(
    "Answer a questionnaire the user brought in from outside — a customer's security review, an auditor's schedule, a marketplace's form — from the code, with evidence. This is not the ScanProfile: that is the declaration form this product asks, and these are somebody else's questions",
  );

/**
 * THE AGENTS' START QUESTION of the questionnaire and of the policy comparison, through the
 * relay's program confirmation (hook-question.ts CONFIRMATION_KIND), as the scan's start question goes through the relay: the
 * command that wrote the input pack asks, in a Claude Code session; the same command with --from-answer takes the answer
 * from the hook's record alone, bound to the pack's bytes (`about`), and says whether the agents start. The agents are the
 * orchestrator's own launches, so the answer tells it what to do; nothing here launches or refuses an agent.
 */
const AGENTS_START = { header: "Agents", start: "Start", startWhat: "Start the agents now, on your plan or API key", no: "Not now", noWhat: "Start nothing; nothing is spent on agents" } as const;
function agentsStartLaunchDir(target: string): string {
  return join(realpathSync(resolve(target)), LEGAL_DIR_NAME, "launch");
}
function agentsStartAsk(target: string, purpose: string, packPath: string, question: string, rerun: string): string[] {
  if (declarationPathOf(process.env) !== "session") return [];
  const about = createHash("sha256").update(readRegularFile(packPath)).digest("hex");
  const q: AskQuestion = {
    question,
    header: AGENTS_START.header,
    multiSelect: false,
    options: [
      { label: AGENTS_START.start, description: AGENTS_START.startWhat },
      { label: AGENTS_START.no, description: AGENTS_START.noWhat },
    ],
  };
  const written = writeConfirmationQuestion(agentsStartLaunchDir(target), { purpose, about, question: q, valueByLabel: { [AGENTS_START.start]: "start", [AGENTS_START.no]: "no" } }, new Date(), roundSessionId());
  return [
    "",
    `START QUESTION: start no agent before the person answers it. To ask the person, ${PASS_EXACTLY}, alone in its call and with every character as it is - copy the line below whole; do not re-word, shorten or re-type any of it. The scanner's hook compares it with ${written.path} character by character and records the answer:`,
    ...askInputLines(written.input, dirname(agentsStartLaunchDir(target))),
    `Then run ${rerun} again exactly as it was run, with --from-answer added: the program takes the answer only from the hook's record, and the agents start only where the person chose "${AGENTS_START.start}".`,
  ];
}
function agentsStartTake(target: string, purpose: string, packPath: string, what: string): { code: number; lines: string[] } {
  if (!existsSync(packPath)) return { code: 1, lines: [`--from-answer: ${packPath} does not exist, so there is no question to take an answer for. Start no agent; run the command without --from-answer first.`] };
  const launchDir = agentsStartLaunchDir(target);
  const about = createHash("sha256").update(readRegularFile(packPath)).digest("hex");
  const t = takeConfirmation(launchDir, { purpose, about });
  if ("refused" in t) return { code: 1, lines: [`--from-answer: ${t.refused}. Start no agent: ask the person through the program's question first.`] };
  const start = t.value === "start";
  markConfirmationUsed(launchDir, t, new Date(), start ? `${what}, whose agents the person chose to start` : `${what}, which started no agent`);
  return start
    ? { code: 0, lines: [`GO: the person chose "${AGENTS_START.start}". Launch the ${what}'s agents as its steps say.`] }
    : { code: 0, lines: [`NOT STARTED: the person chose "${AGENTS_START.no}" (or did not choose Start). Start no agent; nothing has been spent on agents. Tell the person the run stops here.`] };
}

/** The agents the policy comparison starts, as far as they are known before the first. */
function reconcileAgentsWords(docs: number): string {
  return `${docs > 1 ? `2 to ${2 * docs}` : "2"} reading agent(s) (the checklist walk and the claim extraction, once or once per document), then one second-check agent for each finding that survives the comparison with the code scan, a number known only then`;
}
export function reconcileAgentsLine(docs: number): string {
  return `AGENTS, BEFORE ANY STARTS: this comparison starts ${reconcileAgentsWords(docs)}. No token figure is given: these agents were never measured. Tell the person this, and start none until they say go; before the second checks, reconcile-refuters asks again with their number.`;
}

/** Every questionnaire command ends the same way: print, then exit on the module's own code. */
function endQuestionnaireCommand(text: string, code: number): void {
  console.log(text);
  console.log(`\n${QUESTIONNAIRE_DISCLAIMER}`);
  if (code !== 0) process.exit(code);
}

/**
 * Check an answers document against its schema, and say what that means for this run.
 *
 * **Invalid is a REFUSAL, and it writes nothing.** `answers.json` is agent-written, and every lane
 * rule that keeps unsupported material out of a customer's document lives in that schema: a `human`
 * answer carries a marker, a `scan` answer names what it rests on, a `targeted` answer records its
 * searches. A document that breaks one of them cannot be rendered faithfully, because the renderers
 * are written against exactly those guarantees — so the run stops and names the first violation by
 * its path, rather than exporting something nobody can vouch for.
 *
 * **Unavailable is NOT a pass.** Where the validator cannot be loaded the run continues and says so
 * in every output it writes, and the renderers' own safe behaviour still holds: a `human` answer
 * with no marker exports a marker-shaped refusal and never the drafted prose.
 */
async function checkAnswersSchema(answers: unknown, path: string): Promise<string> {
  const result = await validateAnswersDocument(answers);
  if (result.ran && !result.ok) {
    throw new QuestionnaireRefusal(
      `${path} does not match questionnaire-answers.schema.json.\n` +
        `  first violation: ${result.first_violation}\n` +
        `  ${result.violations.length} violation(s) in total.\n` +
        `  ${nothingWrittenWords()}. This document is written by an agent, and the rules it breaks are the ones that ` +
        `keep unsupported material out of a document going to somebody else's customer — a question needing a ` +
        `person carries a marker, an answer drawn from the scan names what it rests on, an answer from a targeted ` +
        `investigation records its searches. Fix the document and run this again.`,
      2,
    );
  }
  return result.ran ? "" : result.unavailable_reason;
}

/** A refusal from the module is a message and an exit code, and it is never a stack trace. */
async function runQuestionnaire(action: () => void | Promise<void>): Promise<void> {
  try {
    await action();
  } catch (e) {
    // A findings document changed after the scan: its one sentence, exit 2 (unreadable).
    if (e instanceof FindingsChanged) {
      console.error(e.message);
      process.exit(2);
    }
    if (e instanceof QuestionnaireRefusal) {
      console.error(e.message);
      process.exit(e.exitCode);
    }
    throw e;
  }
}

questionnaire
  .command("ingest")
  .description(
    "Read a questionnaire, copy it verbatim, and decompose it into items with stable ids. The split is PRINTED for the person to confirm, and every line that produced no item is listed with the reason — nothing is dropped in silence",
  )
  .requiredOption("--source <file>", "the questionnaire: a CSV, a markdown file, or plain text")
  .option("--format <format>", "csv|markdown|text. Omitted: decided from the file extension, and a file whose extension this tool does not know is read as plain text, which is stated rather than assumed")
  .option("--question-column <name|index>", "CSV only: the header name, or a 1-based column number, of the column holding the questions. A name matching no header is refused rather than falling back to a guess")
  .option("--name <slug>", "what to file this questionnaire under (default: a slug of the source filename). It becomes a directory under .legal/questionnaires/")
  .option("--target <dir>", "root of the repository the answers will be drawn from", ".")
  .action(async (opts) => {
    await runQuestionnaire(() => {
      const sourcePath = resolve(opts.source);
      let bytes: Buffer;
      try {
        bytes = readRegularFile(sourcePath);
      } catch (e) {
        throw new QuestionnaireRefusal(
          `--source ${sourcePath} could not be read: ${(e as Error).message}`,
          2,
        );
      }
      const name = opts.name ?? slugify(basename(sourcePath));
      const dir = questionnaireDir(opts.target, name);
      // The questionnaire's folder is under `<target>/.legal`, named by no option: its ignore files too.
      writeLegalIgnore(legalDirOf(dir) ?? dirname(dirname(dir)));

      // An answers document already here is answers written against THIS questionnaire's item ids.
      // Re-ingesting can renumber them, and there is no way to tell afterwards which answer was
      // written against which question. Refused rather than overwritten, with both ways out named.
      if (existsSync(join(dir, ANSWERS_FILE))) {
        throw new QuestionnaireRefusal(
          `${join(dir, ANSWERS_FILE)} already exists. Re-ingesting can change which question each item id ` +
            `names, and an answer written against the old ids would then sit against a different question ` +
            `with nothing to show that it had moved. File this one under a different --name, or move that ` +
            `answers file aside first if you mean to start again.`,
          1,
        );
      }

      const result = ingestQuestionnaire({
        sourcePath: opts.source,
        sourceText: bytes.toString("utf8"),
        sourceBytes: bytes.length,
        sourceSha256: createHash("sha256").update(bytes).digest("hex"),
        name,
        format: opts.format,
        questionColumn: opts.questionColumn,
        ingestedAt: new Date().toISOString(),
      });

      makeFolder(dir, { recursive: true });
      // The bytes that were read, written back unchanged. Not a re-encode of the parsed text: the
      // copy is the thing every digest below is over, and an export rebuilds its rows from it.
      writeFileAt(join(dir, result.stored_as), bytes);
      writeFileAt(join(dir, ITEMS_FILE), `${JSON.stringify(result.items, null, 2)}\n`);
      writeFileAt(join(dir, INGEST_FILE), `${JSON.stringify(result.ingest, null, 2)}\n`);

      endQuestionnaireCommand(summarizeIngest(result, dir), ingestExitCode(result));
    });
  });

questionnaire
  .command("assemble")
  .description(
    "Build the answer-input pack: every item, plus an inventory of the material available to answer with and its digests. NOTHING IS PRE-MATCHED — which material answers which question is judgement — and material that is absent is stated in words rather than left out",
  )
  .requiredOption("--name <slug>", "the questionnaire, as it was ingested")
  .option("--target <dir>", "root of the repository the answers will be drawn from", ".")
  .option("--findings <file>", "pillar-1 findings JSON (default: .legal/findings.json under --target)")
  .option("--reconcile-input <file>", "the reconciliation input, which carries the census and the extracted documents (default: .legal/reconcile-input.json under --target)")
  .option("--out <file>", "write the pack here (default: the questionnaire's own answer-input.json)")
  .option("--from-answer", "in a Claude Code session: take the person's answer to the agents' start question this command asked, from the plugin hook's record, and say whether the agents start; the pack is not built again")
  .action(async (opts) => {
    await runQuestionnaire(() => {
      const stored = readStoredQuestionnaire(opts.target, opts.name);
      // The answer to the agents' start question, bound to the pack as written.
      if (opts.fromAnswer) {
        const took = agentsStartTake(opts.target, "questionnaire-agents", resolve(opts.out ?? join(stored.dir, ANSWER_INPUT_FILE)), "questionnaire");
        endQuestionnaireCommand(took.lines.join("\n"), took.code);
        return;
      }
      const targetRoot = resolve(opts.target);
      const findingsPath = resolve(opts.findings ?? join(targetRoot, ".legal", "findings.json"));
      const inputPath = resolve(
        opts.reconcileInput ?? join(targetRoot, ".legal", "reconcile-input.json"),
      );
      const answersPath = join(stored.dir, ANSWERS_FILE);
      const readIfPresent = (p: string): string | null =>
        existsSync(p) ? readRegularFile(p, "utf8") : null;

      const pack = assembleAnswerInput({
        items: stored.items,
        ingest: stored.ingest,
        targetRoot: opts.target,
        findings: { path: findingsPath, text: existsSync(findingsPath) ? readFindingsText(findingsPath, [targetRoot]) : null },
        reconcileInput: { path: inputPath, text: readIfPresent(inputPath) },
        answers: { path: answersPath, text: readIfPresent(answersPath) },
      });

      const outPath = resolve(opts.out ?? join(stored.dir, ANSWER_INPUT_FILE));
      prepareOutputFolder(outPath);
      writeFileAt(outPath, `${JSON.stringify(pack, null, 2)}\n`);
      const items = pack.items.length;
      const asked = agentsStartAsk(
        opts.target,
        "questionnaire-agents",
        outPath,
        `Answer the ${items} question(s) of this questionnaire now? This starts at most ${2 * items} agent(s) on your plan or API key: one that reads the code for each question it answers from the code, and one second check for each drafted answer. They were never measured, so no token figure is given.`,
        "this assemble command",
      );
      endQuestionnaireCommand([summarizeAssemble(pack, outPath), ...asked].join("\n"), 0);
    });
  });

questionnaire
  .command("verify")
  .description(
    "Check every quotation in an answers document against the real files, and every answer against the question it claims to answer. The same waterfall and the same five statuses as `reconcile-verify`, called and not copied. Nothing is deleted: an unverifiable quotation flags its answer and stays. Exit 0: everything checked out. Exit 5: at least one quotation could not be verified as written — found nowhere, or found only by its first line. Exit 7: the answers do not fit this questionnaire. When both apply the run exits 5, because that is the failure that must not reach a customer",
  )
  .requiredOption("--name <slug>", "the questionnaire, as it was ingested")
  .option("--target <dir>", "root the answers' file paths are relative to", ".")
  .option("--answers <file>", "the answers document (default: the questionnaire's own answers.json)")
  .option("--out <file>", "write the annotated copy here (default: answers.verified.json beside the answers). The file given to --answers is never written to: what the agent asserted is the evidence that anything needed correcting")
  .action(async (opts) => {
    await runQuestionnaire(async () => {
      const stored = readStoredQuestionnaire(opts.target, opts.name);
      const answersPath = resolve(opts.answers ?? join(stored.dir, ANSWERS_FILE));
      const outPath = resolve(opts.out ?? join(stored.dir, "answers.verified.json"));
      if (samePath(outPath, answersPath)) {
        throw new QuestionnaireRefusal(
          `--out is the same file as --answers. The answers the agent wrote are the record of what was asserted, ` +
            `so the annotated copy goes to a separate file; choose another --out.`,
          1,
        );
      }
      let answers: QuestionnaireAnswers;
      try {
        answers = JSON.parse(readRegularFile(answersPath, "utf8")) as QuestionnaireAnswers;
      } catch (e) {
        throw new QuestionnaireRefusal(
          `--answers ${answersPath} could not be read as JSON: ${(e as Error).message}`,
          2,
        );
      }
      const schemaProblem = await checkAnswersSchema(answers, answersPath);
      if (schemaProblem) {
        console.log(
          `THIS ANSWERS DOCUMENT WAS NOT CHECKED AGAINST ITS SCHEMA: ${schemaProblem} Every lane rule the schema ` +
            `carries is unenforced on this run, and what follows checks quotations only.\n`,
        );
      }

      const result = verifyAnswerQuotes({
        answers,
        items: stored.items,
        targetRoot: opts.target,
        storedSha256: stored.storedSha256,
      });
      prepareOutputFolder(outPath);
      writeFileAt(outPath, `${JSON.stringify(result.annotated, null, 2)}\n`);
      endQuestionnaireCommand(
        summarizeAnswerVerification(result, outPath),
        answerVerificationExitCode(result),
      );
    });
  });

questionnaire
  .command("export")
  .description(
    "Put the answers back into the shape the questionnaire arrived in. A CSV source comes back as THE SAME CSV with four columns added at the end and every original column byte for byte what it was; a markdown or text source comes back as an answer sheet that leads with what could not be answered. Exit 7 when the answers do not fit the questionnaire: the file is still written, because refusing to write it would hide what is wrong rather than show it",
  )
  .requiredOption("--name <slug>", "the questionnaire, as it was ingested")
  .requiredOption("--out <file>", "where to write the export. Never the questionnaire's own source, items.json, ingest.json or answers.json")
  .option("--target <dir>", "root of the repository", ".")
  .option("--answers <file>", "the answers document (default: the questionnaire's own answers.json)")
  .option(
    "--bundle <dir>",
    "not needed and not read: every quotation the export carries is redacted with the program's own credential patterns, whatever bundle a scan ran (accepted for scripts that still pass it)",
  )
  .option(
    "--export-despite-alarms <reason>",
    "export a document whose verification found quotations that are in no file, and return the run to exit 0. It changes NOTHING else: every alarm is still printed, every affected row is still flagged in its answer cell, and this reason is echoed on the console and written into the companion file beside the spreadsheet. The reason is required, because an override that leaves no trace is a way out of the alarm rather than a decision recorded against it",
  )
  .action(async (opts) => {
    await runQuestionnaire(async () => {
      const stored = readStoredQuestionnaire(opts.target, opts.name);
      const answersPath = resolve(opts.answers ?? join(stored.dir, ANSWERS_FILE));
      const outPath = resolve(opts.out);
      // The source is what the export rebuilds its rows from, and items/ingest/answers are the
      // record of the split and of what was asserted. Writing the export over any of the four
      // destroys the input of the next run, and for the source it destroys the customer's own file.
      if (isQuestionnaireRecordFile(stored, outPath)) {
        throw new QuestionnaireRefusal(
          `--out ${outPath} is one of the files that ARE this questionnaire's record — its verbatim source copy, ` +
            `${ITEMS_FILE}, ${INGEST_FILE} or ${ANSWERS_FILE}. The export is a new document; choose another --out.`,
          1,
        );
      }
      let answers: QuestionnaireAnswers;
      try {
        answers = JSON.parse(readRegularFile(answersPath, "utf8")) as QuestionnaireAnswers;
      } catch (e) {
        throw new QuestionnaireRefusal(
          `--answers ${answersPath} could not be read as JSON: ${(e as Error).message}`,
          2,
        );
      }

      const schemaProblem = await checkAnswersSchema(answers, answersPath);
      const result = exportAnswers({
        answers,
        items: stored.items,
        sourceText: stored.sourceText,
        storedSha256: stored.storedSha256,
        outPath,
        despiteAlarmsReason: opts.exportDespiteAlarms,
        schemaNotValidated: schemaProblem || undefined,
      });
      // The answer sheet leaves for a customer: `exportAnswers` rendered it from redacted answer values.
      prepareOutputFolder(outPath);
      writeFileAt(outPath, result.document);
      if (result.companion) writeFileAt(result.companion.path, result.companion.contents);
      endQuestionnaireCommand(summarizeExport(result, outPath), exportExitCode(result));
    });
  });

program
  .command("ropa")
  .description(
    "Emit a GDPR Art. 30(1) record of processing activities, in a compliance platform's bulk-import shape, from a scan and the layer-2 adjudication of it",
  )
  .requiredOption("--findings <file>", "findings JSON written by `scan --out`")
  .requiredOption(
    "--layer2 <file>",
    "the layer-2 RoPA result: the adjudicated verdicts and the activities they support (schemas/ropa-input.schema.json in this program's npm package; product/packages/schemas/schemas/ in a source checkout). Refused, with nothing written, when a candidate of the scan carries no verdict, a verdict names no candidate of the scan, or a verdict's `verdict` is not `real` or `dismissed` - a verdict with no word of the two is never counted as dismissed",
  )
  .option(
    "--reconcile <file>",
    "a declaration-reconciliation report (product/packages/schemas/schemas/declarations.schema.json), normally after `reconcile-verify` has stamped it. Adds what your own published documents say, quoted with its location and its verification state, beside the operator fields it never fills. Omit it and the export is exactly what it was without this option",
  )
  .requiredOption("--out-dir <dir>", "directory to write processing-activities.csv, open-questions.csv, unknown-rules.csv, vanta-custom-fields.csv, record-of-processing-activities.docx and README.md into")
  .option(
    "--bundle <dir>",
    "not needed and not read: every quotation the export carries is redacted with the program's own credential patterns, whatever bundle a scan ran (accepted for scripts that still pass it)",
  )
  .action((opts) => {
    const redaction = productPrintedRedaction();
    const findings = JSON.parse(readFindingsText(resolve(opts.findings))) as Findings;
    const input = JSON.parse(readRegularFile(resolve(opts.layer2), "utf8")) as RopaInput;

    // The pillar-2 half, when it was asked for. Read, validated and labelled here; everything that
    // happens to it afterwards is `buildRopa`'s, which is the same division the layer-1 and layer-2
    // inputs already follow — this file reads files, that file decides nothing and renders.
    let declarations: DeclarationsInput | undefined;
    let declarationsSchemaNotChecked = "";
    if (opts.reconcile) {
      const path = resolve(opts.reconcile);
      let report: DeclarationsReport;
      try {
        report = JSON.parse(readRegularFile(path, "utf8")) as DeclarationsReport;
      } catch (e) {
        console.error(`--reconcile ${path} could not be read as JSON: ${(e as Error).message}`);
        process.exit(2);
      }
      // Refused rather than degraded, on the same terms as the questionnaire's answers document:
      // this file is written by an agent, the renderers below are written against the shape the
      // schema declares, and a report that breaks it cannot be rendered faithfully. Nothing is
      // written when it does.
      const checked = validateAgainstSchema("declarations.schema.json", report);
      if (checked.ran && !checked.ok) {
        console.error(
          `--reconcile ${path} does not match declarations.schema.json.\n` +
            `  first violation: ${checked.first_violation}\n` +
            `  ${checked.violations.length} violation(s) in total.\n` +
            `  ${nothingWrittenWords()}. The declared cells of a RoPA quote a developer's own published words back at ` +
            `them, so the document they come from is checked before any of it is rendered.`,
        );
        process.exit(2);
      }
      // UNAVAILABLE IS NOT A PASS. The run continues and says so BOTH on the console and in the
      // emitted README, exactly as a scan does when it cannot check a profile. Until 2026-09-02 this
      // comment claimed the README and only the console carried it; the console scrolls away and the
      // README is what travels with the export, so the promise was made true rather than trimmed.
      // (Independent verification, 2026-09-02, V.7.)
      if (!checked.ran) declarationsSchemaNotChecked = checked.unavailable_reason;
      declarations = { report, source_label: opts.reconcile };
    }

    const exported = buildRopa(findings, input, declarations);
    // Every string the renderers print goes through the report's redaction: the export as built, and a
    // copy of the layer-2 input the document renderer and the README read beside it. Decided before, rendered after.
    const shownInput = structuredClone(input);
    redactStringsInPlace(redaction, exported);
    redactStringsInPlace(redaction, shownInput);

    const outDir = resolve(opts.outDir);
    makeFolder(outDir, { recursive: true });
    writeFileAt(
      join(outDir, "processing-activities.csv"),
      renderProcessingActivitiesCsv(exported.processing_activities, exported.activity_columns),
    );
    writeFileAt(join(outDir, "open-questions.csv"), renderOpenQuestionsCsv(exported.open_questions));
    writeFileAt(join(outDir, "unknown-rules.csv"), renderUnknownRulesCsv(exported.unknown_rules));
    writeFileAt(join(outDir, "vanta-custom-fields.csv"), renderCustomFieldsCsv(exported.custom_fields));
    // The same facts as a standalone Art. 30 document, for a platform that has no inventory object to
    // import into. It is a second RENDERER, not a second pipeline: it is handed the `exported` object
    // above and the layer-2 input already parsed, so it re-reads no file and cannot describe a
    // different scan than the CSVs beside it.
    writeFileAt(join(outDir, RECORD_DOCUMENT_FILENAME), renderRopaDocument(shownInput, exported));
    // The README is emitted rather than written once by hand because the sentence it carries — this
    // file cannot be imported until a human answers one question per row — is a property of every
    // export and has to travel with the files, not with the documentation.
    // Anything this RUN has to disclose about itself, in the file that travels with the export.
    // Empty on every run whose schema check loaded, so no emitted byte moves on the ordinary path.
    const runNotices =
      declarationsSchemaNotChecked === ""
        ? []
        : [
            `DECLARATION REPORT NOT CHECKED — ${opts.reconcile} was used as written because the schema check ` +
              `could not run (${declarationsSchemaNotChecked.replace(/\.$/, "")}). This is not a pass: nothing ` +
              `here says the report matches declarations.schema.json.`,
          ];
    writeFileAt(join(outDir, "README.md"), renderExportReadme(shownInput, exported, runNotices));

    console.log(summarizeRopa(exported));
    for (const notice of runNotices) console.log(`\n${notice}`);
    console.log(`\nWritten to ${outDir}`);
    console.log(`\n${DISCLAIMER}`);
  });

program
  .command("doctor")
  .description("Diagnose the environment and configuration")
  .option("--bundle <dir>")
  .action(async (opts) => {
    console.log(`node: ${process.version}`);
    // The Claude Code the session command would start, against the plugin's floor.
    {
      const found = programOnPath("claude", foldersNoProgramComesFrom());
      const start = found === null ? null : programStart(found, foldersNoProgramComesFrom());
      const cc = found === null || start === null || "refused" in start ? null : claudeCodeVersion(found, process.env, start);
      console.log(
        start !== null && "refused" in start
          ? `claude code: found on PATH but not startable: ${start.refused}`
          : found === null || cc === null
          ? `claude code: not found on PATH (the plugin's checks need Claude Code ${CLAUDE_CODE_FLOOR} or later)`
          : cc.kind === "ok"
            ? `claude code: ${cc.version} (the plugin's checks need ${CLAUDE_CODE_FLOOR} or later)`
            : cc.kind === "below"
              ? `claude code: ${cc.version}, older than ${CLAUDE_CODE_FLOOR}, which the plugin's checks need; update Claude Code`
              : `claude code: its version could not be read (the plugin's checks need ${CLAUDE_CODE_FLOOR} or later)`,
      );
    }
    // What the structural reading can and cannot open ON THIS MACHINE. A grammar that fails to load
    // does not stop a scan — the files it covers fall back to the line-based patterns and are
    // counted — so this is where a user finds out that half of one reading is missing before they
    // wonder why a template never reports anything. The preflight gate asks the same question of CI;
    // this asks it of the machine in front of you.
    await prepareStructural();
    const grammars = grammarReport();
    const failed = grammars.filter((g) => !g.ok);
    console.log(
      `structural grammars: ${grammars.length - failed.length}/${grammars.length} loaded` +
        (failed.length === 0 ? "" : ` — ${failed.map((g) => g.name).join(", ")} unavailable`),
    );
    for (const g of failed) console.log(`  ${g.name}: ${g.error}`);
    if (opts.bundle) {
      try {
        const b = loadBundle(resolve(opts.bundle));
        console.log(
          `bundle: ${b.manifest.bundle_version} (${b.rules.length} rules; every file matches the manifest; content sha256 ${b.digest}; ${b.signature === "unsigned" ? "unsigned, so the manifest itself is not authenticated" : "carries a signature this CLI cannot verify, so the manifest itself is not authenticated"})`,
        );
      } catch (e) {
        console.error(`bundle: FAILED — ${(e as Error).message}`);
        process.exit(2);
      }
    }
    console.log("ok");
  });

// Relay rework item 5: the program assembles the report and the evidence log (`assemble-report.ts`).
registerAssembleReport(program);
registerExplain(program);
// The person's own decisions about findings (design rf11 3.4), asked where every question is.
registerDecide(program, { pathOf: () => declarationPathOf(process.env), sessionId: roundSessionId, rerender: rerenderLatestReport });
registerDeepen(program, { pathOf: () => declarationPathOf(process.env), sessionId: roundSessionId });
registerRecord(program);

// `parseAsync`, because two commands await work before they scan: `reconcile` fetches declarations,
// and `scan` and `test-rules` start the structural parser runtime when the bundle asks for it.
// Run at the relay's ONE failure boundary (part B, area γ, item 4; command-boundary.ts): a relay
// command whose action throws on an input it cannot use ends in one named line and its own exit code.
const { runAtBoundary } = await import("./command-boundary.js");
await runAtBoundary(program);
