/**
 * THE RECOVERY OF EVERY REFUSAL STEP 5a OR STEP 6 CAN EMIT (one class:
 * every refusal states a recovery that ends the run when it is
 * followed exactly as written).
 *
 * ONE TABLE. Every kind the program emits is a key of `RECOVERY`, and a refusal's `kind` is typed by those keys
 * (`RefusalKind`), so a kind with no recovery does not compile. The assembly (assemble-report.ts, assemble-hooked.ts)
 * prints each refusal with its row; step 5a's own exits (verdict-reading's exit 2 and the causes of its exit 5,
 * verdict-verify's exit 5; index.ts) print theirs from the same rows by kind (`recoveryFor`). tools/test-assemble-
 * report.mjs section 23 enumerates the kinds from the built modules' emission sites - not from a second list - and fails
 * on one without a recovery in any of its forms.
 *
 * ONE WAY TO GO ON. assemble-report derives the assembled copies from the seats' answers again and requires `--verdicts`
 * to be exactly those, so a seat captured since step 5a last ran is in no assembled file: a recovery that continues the
 * run ends with `THEN_ASSEMBLE` (step 5a's two commands, then assemble-report), never with assemble-report alone.
 * The recoveries are a closed set of shapes: step 5a again; the commands' arguments as SKILL.md writes them; a file the
 * person removes, then step 5a; the relaunch rule's decision for the entry, then step 5a; the command that appends an
 * entry again, then step 5a; the pre-launch step again within the run (never a new attempt behind run-abort),
 * then step 5a; or `run-abort`, which ends the run - only where nothing in the run fixes the situation, which by SKILL.md's
 * flow is read once launch-next says nothing is left to launch, where the run-abort guard does not refuse it.
 *
 * ONE SITUATION, ONE RECOVERY. A line is
 * about a situation, and its recovery is read from the one decision that situation has, never from the line's kind
 * alone: a line about an entry, or about a candidate or a record of an entry, states the relaunch rule's decision for
 * that entry (`relaunch`, read by `relaunchRecovery`), so the entry's own line and the lines on its candidates state
 * one recovery; a line about a file the capture ledger does not list states its removal, naming every file the
 * situation leaves - the copy and, where step 5a has assembled it, its assembled copy (`unlisted`, read by `STRAY`), so
 * one round ends it. A kind that reaches `recoveryOf` with no row (only a cast can make one) is named with
 * run-abort, never a TypeError.
 */
import { REVIEW_DECLARATION_FLAG } from "./declaration.js";
import { HOOKS_POLICY_WORDS } from "./scan-profile.js";
import type { Relaunch } from "./entry-answer.js";

/** The words every recovery that continues the run ends with: never assemble-report alone. */
export const THEN_ASSEMBLE =
  "then run step 5a's two commands again as SKILL.md writes them (verdict-reading, then verdict-verify), then assemble-report";

/** A `record-unbound` line for an entry the run appended ends with the command that appends it again, then these words. */
export const APPENDS_IT_AGAIN = "appends it again with the same id";

const RERUN_5A = "Recovery: run step 5a's two commands again as SKILL.md writes them (verdict-reading, then verdict-verify), then assemble-report; no seat is launched for it";
const ARGUMENTS = "Recovery: this line names what differs from SKILL.md: run step 5a's two commands and assemble-report again exactly as SKILL.md writes them";
const EXISTS =
  "Recovery: a file this command did not write is never replaced: run step 5a's two commands and assemble-report again exactly as SKILL.md writes them, whose default paths carry the time of the run (a path given with --out-log or --out-report is not SKILL.md's)";
const ABORT = "Recovery: no seat can correct it: the record was accepted and its entry is answered, so the relaunch rule does not launch it again. End the run with run-abort";
const NOT_WITHIN_RUN = "Recovery: nothing within this run writes it again (the run's own documents disagree, and no seat or step of this run makes them anew): end the run with run-abort";
const REMOVE = (why: string): string =>
  `Recovery: remove it (${why}); while the run is active the session's writes under .legal are refused, so the person removes it; ${THEN_ASSEMBLE}`;
/**
 * THE RUN'S LIST WRITTEN AGAIN, WITHIN THE RUN. Before it this was a new
 * attempt - run-abort, then the pre-launch step - and live run 2 followed it for entries that only needed launching.
 * While the run is active the pre-launch step continues the same attempt (hook-launch.ts `writeActiveRun`: the marker's
 * session and run stand, so every reservation and every entry the run appended is kept), so writing the list again needs
 * no run-abort, and inside the session run-abort is refused while the run only needs launching (`abortRefusal`): no
 * recovery tells the orchestrator to run a run-abort that the guard then refuses.
 */
const RELIST_STEPS = `run the pre-launch step again (3j-3l) without ending the run: while the run is active it continues the same attempt and keeps every reservation and every entry the run appended; ask the question it prints, where it prints one (and run it again with --shape-from-answer); then launch what launch-next prints, running it again after every returned seat, and once it says NOTHING LEFT TO LAUNCH, ${THEN_ASSEMBLE}`;
/** The recovery of every line about a launch list that does not read as the program's own (`launch-list`), and of a line on a candidate while it did not (`LIST_UNREAD`): one situation, one recovery. */
const LIST_RECOVERY = `Recovery: the launch list does not read as the one the pre-launch step wrote: ${RELIST_STEPS}`;
/**
 * The words a `verdict-lost` or `refutation-missing` line ends with where the run's launch list could not be read: which entry answers the candidate cannot be told, so the line states the list's
 * recovery (`LIST_RECOVERY`), never "no entry names it" with run-abort, which ended run 2's first attempt.
 */
export const LIST_UNREAD = "the launch list could not be read, so which entry answers it cannot be told until the list is written again";
/** A `refutation-missing` line for a violation candidate no refuter entry names ends with SKILL.md step 5's command for its record, then these words. */
export const APPENDS_ITS_REFUTER = "appends its refuter entry (SKILL.md step 5)";
/**
 * A line about a candidate that no entry of a hooked run's launch list names: no relaunch decision exists for it, and
 * the launch gate launches only a listed entry (before it, the words deferred to "a line of this assembly", so beside a line that led on they said the opposite).
 */
const NO_ENTRY =
  "Recovery: no entry of a hooked run's launch list names it, so the relaunch rule decides nothing for it and no seat of this run is launched for it: end the run with run-abort";
/** A record the capture did not write, in a run the capture wrote; a record
 * `record-missing` names that no entry's decision covers and the capture ledger lists or no ledger holds. */
const RECORD_RECOVERY =
  "Recovery: in a run whose records the capture wrote, run `verdict-capture --check-ledger`: each file it names UNLEDGERED was never " +
  "received by the capture and is no seat's answer (step 6 refuses it as ledger-unlisted): remove each (while the run is active the " +
  `session's writes under .legal are refused, so the person removes it), ${THEN_ASSEMBLE}; where it names none UNLEDGERED, such a ` +
  "file was changed after the capture or the capture wrote it, and no seat can correct a record: end the run with run-abort. Outside " +
  `Claude Code, correct the file the orchestrator wrote, or launch the seat again from its entry (step 4) and once its answer is written, ${THEN_ASSEMBLE}`;
/**
 * Step 5a's lines on one record (`reading-row-refused`, `reading-unattributed`, `reading-unreadable`): the
 * stray-file branch as RECORD_RECOVERY's, and otherwise the assembly, never run-abort - step 6 decides that record as it
 * decides any one answer (assemble-report.ts settleOneAnswers): its entry launched again while the run can still launch
 * it, else its candidates listed as not checked, with why. Before, a record changed outside the program ended the run
 * here, at step 5a, with no report.
 */
const READING_RECORD_RECOVERY =
  "Recovery: in a run whose records the capture wrote, run `verdict-capture --check-ledger`: each file it names UNLEDGERED was never " +
  "received by the capture and is no seat's answer (step 6 refuses it as ledger-unlisted): remove each (while the run is active the " +
  `session's writes under .legal are refused, so the person removes it), ${THEN_ASSEMBLE}; where it names none UNLEDGERED, ` +
  "finish step 5a (verdict-verify, as SKILL.md writes it) and run assemble-report as SKILL.md writes it: its lines on that record say " +
  "what follows - its entry launched again where the run can still launch it, otherwise its candidates listed as not checked, with " +
  `why - and one record never stops the report. Outside Claude Code, correct the file the orchestrator wrote, or launch the seat again from its entry (step 4) and once its answer is written, ${THEN_ASSEMBLE}`;
/** Why a file the capture ledger does not list is removed: `ledger-unlisted`'s words, and a duplicate's that names one. */
const LEDGER_WHY = "the capture ledger never recorded receiving it, so it is no seat's answer";
/**
 * ONE SITUATION, ONE RECOVERY: a file copied into verdicts/ by hand is
 * refused `ledger-unlisted` and, where it answers what a record already answers, `*-duplicate`; both lines state this
 * sequence, the file named, where before the second said run-abort and discarded the run's work.
 */
const STRAY = (files: string[]): string =>
  `Recovery: remove ${files.join(" and ")} (${files.length > 1 ? "files" : "a file"} this line names that the capture ledger does not list: ` +
  `${LEDGER_WHY}; step 6 refuses ${files.length > 1 ? "each" : "it"} as ledger-unlisted); while the run is active the session's writes ` +
  `under .legal are refused, so the person removes ${files.length > 1 ? "them" : "it"}; ${THEN_ASSEMBLE}`;

/**
 * What to do about an entry with no record, by the relaunch rule's decision for it (entry-answer.ts `relaunchable`): the
 * recovery of the entry's own line and of every line on its candidates or records. `answered`: the entry's answer
 * was accepted, so a line that still misses it misses a record the capture wrote, removed or changed since - the lines
 * on that file (`ledger-missing-file`, `ledger-mismatch`) end the run, and step 5a again would never make it.
 */
function relaunchRecovery(r: Relaunch | null | undefined): string {
  if (!r) return "Recovery: no launched event names this seat, so no entry is launched again for it and no seat can answer in its place: end the run with run-abort";
  if (r.ok) return `Recovery: launch entry ${r.entry} again as this line says, and once its answer is captured, ${THEN_ASSEMBLE}`;
  switch (r.state) {
    // Never launched, so launched from launch-next within this run, as SKILL.md step 4 launches every entry
    // (before it: "launch entry X as this line says", which sent the orchestrator to read the list for its input).
    case "not-launched":
      return `Recovery: launch-next lists entry ${r.entry} to launch within this run: launch what launch-next prints, and once every answer is captured, ${THEN_ASSEMBLE}`;
    // A seat whose end never reached the program is presumed lost after the bound (hook-launch.ts PRESUMED
    // LOST) and launched again within the run, and a launch whose result never came is released by the gate: in both
    // cases launch-next lists the entry. Before it, the way on was a new attempt, run-abort first.
    case "awaiting-result":
      return (
        `Recovery: wait for its seat's answer, and once it is captured, ${THEN_ASSEMBLE}. A launch whose result never comes is released by the launch gate, ` +
        `and launch-next then lists entry ${r.entry} to launch again within this run: launch what launch-next prints, and once every answer is captured, ${THEN_ASSEMBLE}`
      );
    case "running":
      return (
        `Recovery: wait for its seat's answer, and once it is captured, ${THEN_ASSEMBLE}. A seat whose end never reached the program is presumed lost ` +
        `${r.lost_at ? `at ${r.lost_at}` : "once the bound after its launch has passed"} if no sign of its end comes first (at once where the run's conversation is resumed after its Claude Code process ended), and launch-next then lists entry ${r.entry} ` +
        `to launch again within this run: launch what launch-next prints, and once every answer is captured, ${THEN_ASSEMBLE}. ` +
        // F3 of an internal record: the limit a relay cannot see through.
        `Where a relay launched the seat, no event marks that moment: the relay and the main session wait until the person prompts the main session, which then runs launch-next`
      );
    case "answered":
      // The words of the lines on that record's file (`ledger-mismatch`, `ledger-missing-file`): one situation, one text.
      return ABORT;
    case "invalid":
      return "Recovery: no seat is launched for it again (the refusal cap bounds it) and no seat can answer in its place: end the run with run-abort";
    case "capped":
      return "Recovery: nothing to do for it: the relaunch cap bounds it, and once nothing else is left the assembly lists its candidates as not checked, with why";
  }
}

/** The fields the table's rows read. */
export interface Refusal {
  /** A short fixed code, for a program to act on: a key of `RECOVERY`. */
  kind: RefusalKind;
  /** What it is about: a finding_id, a rule_id, a file, or `-`. */
  id: string;
  problem: string;
  /**
   * The relaunch rule's decision for the entry the line is about (null: no entry names the seat): `entry-unanswered`
   * and `seat-cut-off` for their entry; `verdict-lost` and `refutation-missing` for the entry that launches the seat
   * answering the candidate; `record-missing` for the entry the capture ledger binds the record to.
   */
  relaunch?: Relaunch | null;
  /**
   * For a line about a file the capture ledger does not list (`ledger-unlisted`, a `*-duplicate` naming one, and the
   * lines step 6 derives from it): every file that situation leaves, as `.legal`-relative paths - the copy and, where
   * step 5a has assembled it, its assembled copy.
   */
  unlisted?: string[];
}
type Row = (r: { id: string; problem: string; relaunch?: Relaunch | null; unlisted?: string[] }) => string;
/** A row whose recovery is the stray-file one where the line names a file the capture ledger does not list (`STRAY`). */
const strayOr =
  (otherwise: string | Row): Row =>
  (r) =>
    r.unlisted && r.unlisted.length > 0 ? STRAY(r.unlisted) : typeof otherwise === "string" ? otherwise : otherwise(r);
/** A row whose recovery is the relaunch rule's decision where the line carries one (`relaunch`): one decision, one text. */
const decidedOr =
  (otherwise: string | Row): Row =>
  (r) =>
    r.relaunch !== undefined ? relaunchRecovery(r.relaunch) : typeof otherwise === "string" ? otherwise : otherwise(r);
const always = (text: string): Row => () => text;

/**
 * THE TABLE. A row per kind: the full sequence that ends the run. A kind is added here or it does not compile.
 */
export const RECOVERY = {
  /* Step 6: a record step 5a must assemble or check again. */
  "record-unchecked": always(RERUN_5A),
  "record-stale": always(RERUN_5A),
  "record-orphan": always(RERUN_5A),
  /* ... unless the line is about a file the capture ledger does not list: then its removal, as that file's other lines say. */
  "quote-report": strayOr(RERUN_5A),
  "assembled-missing": strayOr(RERUN_5A),
  "assembled-differs": strayOr(RERUN_5A),
  /* Step 6: a file no seat's answer makes. */
  "assembled-unlisted": always(REMOVE("verdict-reading makes no such file from the seats' answers, so nothing the run needs is in it")),
  "ledger-unlisted": strayOr(REMOVE(LEDGER_WHY)),
  "record-not-a-file": always(REMOVE("a record the capture wrote is a regular file, and this is not one")),
  "carried-unlisted": always(REMOVE("the pre-launch step carries no such verdict, so nothing ties it to an earlier answer")),
  /* Step 6: an entry with no record, by the relaunch rule. */
  "entry-unanswered": (r) => relaunchRecovery(r.relaunch),
  "seat-cut-off": (r) => relaunchRecovery(r.relaunch),
  /* ... and every line on a candidate or a record of such an entry, by the same decision. A record that cannot be
   * read and that no entry's decision covers is the orchestrator's file outside a hooked run (`RECORD_RECOVERY`). */
  "record-missing": strayOr(decidedOr(RECORD_RECOVERY)),
  "verdict-lost": decidedOr((r) => (r.problem.endsWith(LIST_UNREAD) ? LIST_RECOVERY : NO_ENTRY)),
  "refutation-missing": decidedOr((r) =>
    r.problem.endsWith(APPENDS_ITS_REFUTER)
      ? `Recovery: run that command (it appends this candidate's refuter entry, as SKILL.md step 5 does), launch the entry it appends as step 4 does, and once its answer is captured, ${THEN_ASSEMBLE}`
      : r.problem.endsWith(LIST_UNREAD)
        ? LIST_RECOVERY
        : NO_ENTRY,
  ),
  /* Step 6: a record no listed entry binds. */
  "record-unbound": (r) => {
    if (r.problem.endsWith(APPENDS_IT_AGAIN)) return `Recovery: run that command (it makes the same entry, with the same id, and no seat is launched for it), ${THEN_ASSEMBLE}`;
    if (r.problem.includes("is not an entry of the launch list")) {
      return `Recovery: the list does not hold the entry this record answered: adding --ask-shape to both calls and answering full when the run-shape question is asked again, ${RELIST_STEPS}`;
    }
    return "Recovery: none within this run: the launch gate's own reservation and release lines are what bind a seat to its entry, they no longer bind this one, and no command or launch binds it again. End the run with run-abort";
  },
  /* Step 6: the commands' arguments are not SKILL.md's. */
  "shape-missing": always(ARGUMENTS),
  "shape-invalid": always(ARGUMENTS),
  "shape-flag-in-session": always(ARGUMENTS),
  "shape-mismatch": always(ARGUMENTS),
  "out-log-location": always(ARGUMENTS),
  "out-report-location": always(ARGUMENTS),
  "raw-verdicts-missing": always(ARGUMENTS),
  "legal-layout": always(ARGUMENTS),
  "carried-not-directory": always(ARGUMENTS),
  "target-mismatch": always(ARGUMENTS),
  "bundle-mismatch": always(ARGUMENTS),
  "out-log-exists": always(EXISTS),
  "out-report-exists": always(EXISTS),
  "findings-mismatch": (r) => (r.problem.includes("--findings is another document") ? ARGUMENTS : NOT_WITHIN_RUN),
  /* Step 6: the run's launch list or shape answer cannot be read as the program's own. */
  "launch-list": always(LIST_RECOVERY),
  "shape-answer": always(`Recovery: the run shape cannot be tied to the person's answer or to the recommended plan: ${RELIST_STEPS}`),
  /* Step 6: an accepted record, or the run's own documents, that nothing within the run can change. */
  "coverage-gap": (r) => (/^rests-on-/.test(r.problem) ? RERUN_5A : ABORT),
  "verdict-word": (r) => (r.problem.includes("the quote report was changed after the check") ? RERUN_5A : ABORT),
  "refutation-outcome": (r) => (r.problem.includes("the quote report was changed after the check") ? RERUN_5A : ABORT),
  "silence-outcome": (r) => (r.problem.includes("the quote report was changed after the check") ? RERUN_5A : ABORT),
  /* Two records answer one id: where one is a file the capture ledger does not list, removing it is the recovery, as
   * its `ledger-unlisted` line says (one situation, one recovery); otherwise both were received and nothing corrects them. */
  "verdict-duplicate": strayOr(ABORT),
  "refutation-duplicate": strayOr(ABORT),
  "silence-duplicate": strayOr(ABORT),
  "verdict-unexpected": always(ABORT),
  "verdict-unnamed": always(ABORT),
  "refutation-unnamed": always(ABORT),
  "silence-unnamed": always(ABORT),
  "refutation-orphan": always(ABORT),
  "refutation-deferred-but-present": always(ABORT),
  "silence-unexpected": always(ABORT),
  "silence-orphan": always(ABORT),
  "record-not-via-hook": always(ABORT),
  /* A transcript the check could not read is Claude Code's own, which the program only reads; where it can be
   * read again, step 5a again assembles the run, and run-abort (which writes no report) is only for a transcript that is
   * gone. A record the transcripts do not prove (`transcript-mismatch`, after the relay's seats are proven through the
   * relay) is not made provable by any step of the run. */
  "transcript-unreadable": always(
    "Recovery: the file this line names is a transcript Claude Code keeps for this session or one of its agents, which the program only reads: " +
      `where it was moved or can no longer be read, put it back at that path, ${THEN_ASSEMBLE}; where it is gone, no seat can correct it: the record was accepted and its entry is answered, so the relaunch rule does not launch it again. End the run with run-abort`,
  ),
  "transcript-mismatch": always(ABORT),
  "ledger-mismatch": decidedOr(ABORT),
  "ledger-missing-file": decidedOr(ABORT),
  "ledger-unreadable": always(ABORT),
  "capture-ledger-missing": always(ABORT),
  "answer-owned-field": always(RECORD_RECOVERY),
  "carried-missing": always(NOT_WITHIN_RUN),
  "carried-differs": always(NOT_WITHIN_RUN),
  plan: always(NOT_WITHIN_RUN),
  arithmetic: always(NOT_WITHIN_RUN),
  "log-recheck": always(NOT_WITHIN_RUN),
  /* The capture holds every seat's answer to the definitions the log is held to, so in a hooked
   * run a log-schema refusal is the program's own defect, and a new attempt keeps the recorded answers: run-abort could
   * never act on it. The run is kept for a corrected program to finish. */
  "log-schema": always(
    `Recovery: in a run whose records the capture wrote, this is the program's own defect and not the run's: every seat's answer passed the capture, which holds it to the definitions this log is held to, and everything else in the log is the program's own, so no seat, no step and no new attempt of this run can change it (a new attempt keeps the recorded answers). Keep the run as it stands (do not end it with run-abort) and tell the person that the report was not written because of a defect in the program, showing them these lines; once a version of the program that corrects it is installed, ${THEN_ASSEMBLE}, and no seat is launched for it. Outside Claude Code, where the orchestrator wrote the records, correct the record this line names, ${THEN_ASSEMBLE}`,
  ),
  /* Step 5a: verdict-reading's exit 5 causes and verdict-verify's exit 5 (index.ts prints each by its kind). */
  "reading-unaccounted": always(
    "Recovery: finish step 5a (verdict-verify, as SKILL.md writes it) and run assemble-report as SKILL.md writes it: it names each such seat's entry with the relaunch rule's decision for it, and that line's recovery is the one to follow",
  ),
  "reading-row-refused": always(READING_RECORD_RECOVERY),
  "reading-unattributed": always(READING_RECORD_RECOVERY),
  "reading-unreadable": always(READING_RECORD_RECOVERY),
  "quote-check": always(
    "Recovery: step 5a has run: go on to step 6 (assemble-report as SKILL.md writes it). An invalidated record is reported as needs_human and a candidate kept invalid as not judged; whatever else this check lists that cannot be assembled is refused there by name, each refusal with its own recovery",
  ),
  /*
   * The declaration questions. Each line's
   * first action is the one to take (the end-to-end gate follows the first action a line names, and an unattended run
   * takes a line's "or go on" where it offers one), and each ends the run when followed exactly as written, attended or
   * not: the terminal's and CI's lines never say "ask ... input" (the input a
   * session's scan prints for AskUserQuestion; it replaced the short reference).
   */
  "declaration-no-answer": always(
    "Recovery: run the scan again and ask the questions it prints, with exactly the input it prints (the ones left unanswered are asked again), then run the scan with --declaration-from-answer; or go on: an unanswered question switches nothing off.",
  ),
  "declaration-no-round": always(
    "Recovery: run the scan again as it was run, without --declaration-from-answer, and ask the questions it prints, with exactly the input it prints, then run the scan with --declaration-from-answer; where it prints \"No declaration question is left for this run.\", none is left to answer.",
  ),
  "declaration-answer-missing": always(
    "Recovery: talk it over with the person if they chose to, then ask the questions again with exactly the input the scan printed last (every question offers Not answering) and run the scan with --declaration-from-answer.",
  ),
  "declaration-unconfirmed": always(
    "Recovery: ask the questions with exactly the input printed above (the file's values are shown only as hints), then run the scan with --declaration-from-answer: the program writes the declaration and its record itself.",
  ),
  "declaration-question-changed": always(
    "Recovery: ask the questions with exactly the input printed above (only the questions the record holds no answer to at their current version are asked: the ones the rule pack added or changed, and the ones left unanswered), then run the scan with --declaration-from-answer.",
  ),
  "declaration-answer-forged": always(
    "Recovery: never write or copy the answer file; ask the questions again with exactly the input the scan printed last, then run the scan with --declaration-from-answer.",
  ),
  "declaration-prose": always(
    "Recovery: run it without --profile: the scan asks the questions and writes the declaration itself, and the pre-launch step takes --profile only as that declaration (profile.json beside the findings), with none where the scan read none.",
  ),
  // The scan run inside Claude Code with no sign of the plugin (neither its session id nor
  // its project folder): it scans, asks nothing, and lists the questions; this says where they can be answered.
  "declaration-no-plugin": always(
    "Recovery: to answer these questions, run the same command in your own terminal, outside Claude Code, where the scan asks them and records your answers; or install the plugin and ask Claude Code for the scan. Going on is also fine: an unanswered question switches nothing off.",
  ),
  "declaration-no-terminal": always(
    "Recovery: run the scan in a terminal in this project (it asks the questions there and records the answers), or go on: an unanswered question switches nothing off.",
  ),
  // (scan-profile.ts): the scan in a session started without the scan launch profile.
  "scan-profile-off": always(
    "Recovery: the person starts the scan's session from their own terminal with the command printed above, and asks for the scan there; nothing of the run goes on in this session. Going on without the profile is the person's choice, made when the session starts (--without-profile).",
  ),
  "declaration-question-refused": always(
    "Recovery: ask the questions again with exactly the input the scan printed last, alone in its call, every character as it is and nothing added; where the question file is missing or changed, run the scan again and pass the input it prints.",
  ),
  "declaration-session-unbound": always(
    `Recovery: start a new Claude Code session in this project with the wolfboy plugin enabled, so that its SessionStart hook exports the session id and the project folder, and run the scan there as SKILL.md writes it; or run it from a terminal outside Claude Code, where it asks the questions itself. ${HOOKS_POLICY_WORDS}`,
  ),
  "declaration-out-elsewhere": always(
    "Recovery: run the scan again from the session's project folder with --out .legal/findings.json, as SKILL.md writes it (the plugin's hook finds the declaration questions in your state folder only under the project folder whose .legal the scan wrote to), then relay the questions it prints.",
  ),
  "declaration-outstanding": always(
    "Recovery: ask the questions with exactly the input the scan printed last, run the scan with --declaration-from-answer, then run the pre-launch step again.",
  ),
  // --review-declaration where nobody is asked (no terminal, or CI outside a Claude Code session).
  "declaration-review-nobody-to-ask": always(
    // No answer about the product is read in CI (design rf11 3.3), so nothing is committed for CI.
    `Recovery: run the scan with ${REVIEW_DECLARATION_FLAG} in a terminal in this project, with the variable CI unset where it is set (env -u CI, then the same scan command), and answer its questions; or go on: run the scan again as it was run, without ${REVIEW_DECLARATION_FLAG}.`,
  ),
} satisfies Record<string, Row>;

export type RefusalKind = keyof typeof RECOVERY;

/**
 * The recovery a refusal's line ends with: always one. The table's type admits no kind without a row, and a kind that
 * reaches here without one all the same (only a cast makes one, e.g. an object `as never`) is named with run-abort, so
 * the line is printed and nothing is thrown (before, `RECOVERY[r.kind] is not a function`).
 */
export function recoveryOf(r: Refusal): string {
  const row: unknown = Object.prototype.hasOwnProperty.call(RECOVERY, r.kind) ? RECOVERY[r.kind] : undefined;
  if (typeof row !== "function") {
    return `Recovery: none is stated for the kind ${JSON.stringify(r.kind)}: the recovery table (recovery.ts) has no row for it, which is the program's own defect, so no step of this run can act on this line. End the run with run-abort`;
  }
  return (row as Row)(r);
}

/** The recovery of one of step 5a's exits, by its kind (index.ts). */
export function recoveryFor(kind: RefusalKind): string {
  return recoveryOf({ kind, id: "-", problem: "" });
}
