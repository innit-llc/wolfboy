/**
 * The partition a later run starts from: which candidates already have an answer, and which do not.
 *
 * ## What this is
 *
 * The first run of a repository adjudicates every candidate. The second run of the same repository
 * re-asks most of those questions about material nothing has touched, and layer 2 runs in the user's
 * own agent, so the user pays for every one of them. This module takes the new scan's candidates and
 * the previous run's verdicts and splits them in two, with a reason per candidate:
 *
 *   CARRIED        - the candidate is the same candidate and every premise its verdict rested on is
 *                    reproduced exactly. The verdict moves into the new run with
 *                    `carried_forward_from` naming the scan it came from. It is NOT re-adjudicated.
 *   TO ADJUDICATE  - anything else, with the ONE premise that differs named.
 *
 * and reports a third list, because a disappearance is not a clean result:
 *
 *   GONE           - a previous verdict whose candidate this scan did not raise. It is reported as
 *                    gone, never as resolved and never as clean.
 *
 * **No model runs here.** Every comparison is a digest recomputed from the tree and the bundle.
 *
 * ## The word for a carried verdict
 *
 * CARRIED. Not re-verified, not confirmed, not re-checked. A carried verdict keeps the evidence and
 * the scan id of the run that produced it, and the record says so in the verdict itself - the
 * wording `reconcile-diff.ts` fixed for pillar 2's `saved`, held to here for the same reason: the
 * comparison establishes that nothing this module can see has moved, which is not the same claim as
 * the verdict being right today.
 *
 * ## Safety: what is never carried, whatever its premises say
 *
 * A carried verdict must never become "no violation" by silence, so four cases are refused before
 * any digest is compared at all, and each is reported as its own reason:
 *
 *   (a) the previous record carries no premise block, or one that is not `complete`;
 *   (b) the candidate is read by kinds and the previous record carries no `reading` block - nothing
 *       records what was opened, so nothing can be re-checked;
 *   (c) the previous record's reading leaves matched locations NOT READ. The verdict rested partly
 *       on material nobody opened, and carrying it forward would carry that silence into a run that
 *       looks settled;
 *   (d) the previous record is a refuter's or a silence investigator's file with no candidate of its
 *       own in this scan - it carries on the terms of the verdict it belongs to, never alone;
 *   (e) The previous block records premises its seat's own transcript could not give when the seat
 *       ended (`untaken`: its sight, its effort) - an empty sight there means "could not be read", not "opened
 *       nothing", so nothing can be compared (`previous-premises-untaken`).
 *
 * A changed rule invalidates every verdict of that rule, which falls out of the premise order below
 * rather than being a separate rule: `rule` is compared before anything the seat itself did, so a
 * rule whose clause moved reports every one of its candidates with the same reason.
 *
 * ## The instructions, and what every seat is handed
 *
 * A verdict also rests on what the seat judged BY: the adjudicator's agent text, the legal-scan skill and the program's
 * verdict rules (the capture checks, the bars, the composition), digested in `instructions.ts` and compared as
 * `instructions` straight after `rule`. Until this unit only the bundle's version stood for them, and it had not moved
 * since July, so a product update that changed how a seat judges and no rule carried every verdict unchanged. A verdict
 * written before this unit records no instructions and is given again once. Beside them, `handed` compares the profile
 * and the dependency inventory every brief carries (`rests-on.ts` `handedPremiseOf`). The bundle's version is now
 * recorded and not compared, for the reason `rests-on.ts` states.
 *
 * ## The model a seat ran on
 *
 * Every seat whose answer a later run carries records the model it ran on, and each is compared with `modelNowOf`: a
 * place on its row (build unit F5), a verdict not read place by place on its block (`model`, after `handed`), and an
 * answer seat in its own premises. Before this only the place did, so a whole verdict given under a run-wide
 * `--seat-model` was carried into a run on the rule's own model with nothing to say it had been given on another.
 *
 * ## Unit F's settled answers, from unit GFH-2 (2026-09-22)
 *
 * A verdict also rests on the answers the person's own declaration settled for its rule - whether
 * the rule's jurisdiction reaches the regions the product is declared in, and what the person
 * answered to each premise the rule names. Those are premises of the same kind as the rule's digest,
 * and they are compared as `answers`, straight after `handed`. Two consequences worth naming,
 * because neither is obvious:
 *
 *   - a verdict written BEFORE this unit carries no `answers` block, and it is carried forward only
 *     where this run settles no answer for its rule either. Where the run does settle one, the
 *     verdict is re-adjudicated: nothing records the answer it was given, and a carry would be a
 *     claim about a premise nobody wrote down;
 *   - editing `distribution_regions` between two runs moves the digest of every answer read from
 *     that field, so the verdicts that rested on it are re-adjudicated rather than carried.
 *
 * ## Which previous verdict answers which candidate
 *
 * A candidate is matched to a previous verdict BY ITS CONTENT KEY, which is the identity. A finding
 * id is not one: for a rule grouped by project, directory or file it is derived from the rule id and
 * a path alone, so it survives any change to the matched text. Two indexes on the finding id
 * therefore sit beside the key, and NEITHER can carry a verdict - the first ends in a refusal, the
 * second in `premise-changed`/`candidate`, because the content key is the first premise compared.
 * Before 2026-09-22 there was one such index, it was consulted for records with a premise block as
 * well, and nothing compared the key: a verdict was then carried onto a candidate whose matched text
 * had changed, under an audit sentence saying the key had been reproduced exactly.
 *
 * ## A file that moved
 *
 * A file with the same content at a new path is treated as CHANGED, and the candidate is
 * re-adjudicated. `ideas.md` section H does not decide the case; the brief's fallback is to treat it
 * as changed and record it, and that is the safe direction - the seat's rows, the quotations in
 * `evidence[]` and the run's own audit trail all name the old path, and a verdict carried onto a
 * path that no longer exists is a verdict nobody can check.
 *
 * ## Determinism
 *
 * No clock, no randomness, no network. Rows are emitted in sorted order, so two partitions of the
 * same pair of runs produce byte-identical output and a gate can pin it.
 */

import { join, posix } from "node:path";
import type { Candidate, Rule } from "wolfboy-schemas";
import {
  firstChangedAnswerPremise,
  firstChangedPlacePremise,
  placeAt,
  placeKeyOf,
  placePremisesInWords,
  placePremisesOfBlock,
  rebasedRow,
  specAlikeWords,
  type PlacePremiseKind,
  type PlacePremises,
  type PlaceRowSnapshot,
  type PlaceWindow,
  type ReadingSpecDigest,
} from "./place-premises.js";
import { DEFAULT_SEAT_MODEL } from "./seat-model.js";
import { VERDICT_RULES_VERSION, instructionsDigestOf, instructionsDigestsAlike, instructionsMoved, judgedAsThroughMarks, verdictRulesAlikeWords, verdictRulesBuildMoved, verdictRulesJudgedAs, type InstructionsPremise } from "./instructions.js";
import { kindCensusOf, notCheckedLocations, notCheckedOf, readingPlanOf } from "./reading.js";
import { readSourceText } from "./project-read.js";
import { notApplicableBar } from "./place-bar.js";
import { verdictSetOf, verdictSetRecordsOf } from "./verdict-set.js";
import {
  candidateContentKey,
  scanFactsOf,
  censusContentHash,
  bundleMd5,
  holdersByKey,
  inHolderOrder,
  pairByKey,
  inKeyOrder,
  PREMISE_ORDER,
  seatSightStampOf,
  type RestsOnHanded,
  RESTS_ON_SPEC,
  dialectMoved,
  replayRecorded,
  ruleHash,
  scopeNowOf,
  type PremiseKind,
  type RestsOn,
  type RestsOnAnswer,
  type TreeReader,
  type InventoryPackageNow,
  type RestsOnSearch,
  replaySearch,
} from "./rests-on.js";

/**
 * Why a candidate is not carried. One code per candidate, and the report groups on it.
 * THE ONE LIST of the reasons, exported so that nothing keeps a second copy of it - the legal-scan skill names none of
 * them and points to the plan's rows (`reason`, `premise`, `because`), and test-carry-forward.mjs (r3) fails where a
 * reason or a premise kind (rests-on.ts `PREMISE_ORDER`) is listed in the skill again.
 */
export const CARRY_REASONS = [
  "carried",
  "new-candidate",
  "previous-premises-missing",
  "previous-premises-incomplete",
  /** The earlier verdict's seat's own transcript could not give premises it rests on (`rests_on.untaken`). */
  "previous-premises-untaken",
  "previous-reading-missing",
  "previous-reading-left-locations-unread",
  "premise-changed",
  /** Build unit F5: a place-plan candidate whose verdict's own premises hold, but not every one of its places'. */
  "places-changed",
  /** VA-5: every place is carried, but a premise of the answer seat's own (its fold, files or searches) is not. */
  "answer-changed",
  /**
   * The earlier run's verdict set (verdict-set.ts) is not whole in the record
   * that would be carried: a second look it was due and did not answer, or a record of the set kept apart from the verdict.
   */
  "previous-set-incomplete",
  /**
   * A place-plan candidate whose earlier answer is `not_applicable` over a carried place that
   * is kept or undetermined, or a place with no carried row - the A4 bar, held again before the answer is carried.
   */
  "previous-answer-fails-a4",
] as const;
export type CarryReason = (typeof CARRY_REASONS)[number];

/**
 * Build unit F5 (full-read design section 4): one place of a place-plan candidate, carried or read again, with the one
 * premise that differs. A carried place keeps the earlier run's row, re-based to where its window stands now, and names
 * the run it came from; it is never called re-verified.
 */
export interface PlaceOutcome {
  file: string;
  line: number;
  key: string;
  outcome: "carried" | "read";
  /** `seat-launched` (M3, carried-places.ts): every premise is reproduced, but the place's seat holds a place to read and is launched whole. */
  reason: "carried" | "new-place" | "premises-incomplete" | "premise-changed" | "not-compared" | "seat-launched";
  premise?: PlacePremiseKind;
  because: string;
  from_scan?: string;
  from_finding_id?: string;
  row?: PlaceRowSnapshot;
  /**
   * M3: a carried place's earlier premises, re-based (its window's start and its row where they stand now), which the
   * pre-launch step writes on the carried row; never written into the plan's rows (carried-places.ts takes it off).
   */
  premises?: PlacePremises;
}

export interface PreviousVerdict {
  /** The verdict document as it was written, carried through untouched where it is carried at all. */
  record: Record<string, unknown>;
  finding_id: string;
  verdict: string;
  /** The file it was read from, for the audit record. */
  source: string;
  /** The scan it belongs to, which is what `carried_forward_from` names. */
  scan_id: string;
  /**
   * The kinds of this finding's verdict set (verdict-set.ts) the earlier run
   * recorded apart from `record`: a directory's `refutation/` files, or a log's `challenges[]` row its verdict row does not hold.
   */
  set_apart?: string[];
  /**
   * The row the earlier log's comparison basis (`comparison.basis`) wrote for this finding: its decisive
   * place and level. Absent where the log wrote none (a log made before release 1, or a record from a directory). Read
   * only to say where a gone verdict was; never a premise, so nothing here changes what is carried.
   */
  basis?: { file: string; line: number | null; level: string | null };
}

export interface PartitionRow {
  finding_id: string;
  rule_id: string;
  content_key: string;
  outcome: "carried" | "adjudicate";
  /** Build unit F5: a place-plan candidate's places, each carried or read again. */
  places?: { carried: number; read: number; outcomes: PlaceOutcome[] };
  reason: CarryReason;
  /** The premise that differs, where one does. */
  premise?: PremiseKind;
  /** One sentence a person can act on, naming the thing that moved. */
  because: string;
  /** The previous scan this candidate's answer came from, where one was found. */
  from_scan?: string;
  /** The previous verdict's finding id, which need not equal this run's. */
  from_finding_id?: string;
  /**
   * The places the previous verdict's record says no review read (the later reading), on every row that
   * hands its candidate to a seat again: the brief names them to that seat, and the report says how many of them this
   * run checked. Absent where the previous record names no unread place.
   */
  previous_not_checked?: PreviousNotChecked;
  /**
   * On a carried row: the packages whose declarations
   * changed since the verdict was given and that it does not rest on (`handedChange`). The carry is counted and named, so
   * it is never silent (the design's later item 2D).
   */
  packages_changed_not_rested_on?: string[];
}

/**
 * The places a previous verdict left unread, as the later run hands them on. `places` is the record's own
 * count (`notCheckedOf`); `locations` is every place it locates, as `file:line`: a member a review declined at the line
 * its record wrote, a unit nobody opened at its members in THIS run's census, and only where that census is the one the
 * record was written against (the premise block's position-free `census.content_hash`) - otherwise the unit's places
 * are counted in `unlisted`, never located at another unit's lines.
 */
export interface PreviousNotChecked {
  scan_id: string;
  places: number;
  locations: string[];
  unlisted: number;
}

/** The places `prev`'s record left unread, located against `candidate` where its census is the record's. Null when none. */
export function previousNotCheckedOf(candidate: Candidate, prev: PreviousVerdict): PreviousNotChecked | null {
  const reading = prev.record.reading;
  if (!reading || typeof reading !== "object" || Array.isArray(reading)) return null;
  const census = kindCensusOf(candidate);
  const was = restsOnOf(prev.record)?.census?.content_hash ?? null;
  const locateUnits = census !== null && was !== null && censusContentHash(census) === was;
  const nc = notCheckedOf(candidate as unknown as Record<string, unknown>, reading as Record<string, unknown>, { locateUnits });
  if (!nc) return null;
  return { scan_id: prev.scan_id, places: nc.places, locations: notCheckedLocations(nc), unlisted: nc.unlisted };
}

/**
 * HOW THE EARLIER RUN IS NAMED WHERE IT IS SHOWN. Its label
 * (`previous_scan_id`, every `from_scan`, `carried_forward_from`) is `--previous-scan`, the scan id of
 * `--previous-findings`, a record's own `scan_id` in a directory of that run's files, or else a digest of the path
 * passed - never the scan id a log states for itself, at its top or on a record: a log is a file in the scanned tree,
 * and a label taken from it would let the repository name the run its verdicts are reported as coming from
 * (test-carry-forward.mjs case (p)). A digest names nothing a person recognises, so where the report or the terminal
 * shows the label, it shows it beside the path the person named that run by, as typed (`path`). The seat's brief passes
 * no path: an adjudicator may read every file under `.legal/` its brief names (legal-adjudicator.md), and that log holds
 * the earlier seats' answers and reasoning.
 */
export function earlierRunWords(label: string, by: { who: "you" | "the person"; path?: string | null; quote?: (s: string) => string }): string {
  const named = by.path ? `${(by.quote ?? ((s: string) => s))(by.path)}, ` : "";
  // A label not in the form of a scan id is never printed, wherever it came from (one or several, ", ").
  const shown = label.split(", ").every(isRunLabel) ? label : "unnamed";
  return `the earlier run ${by.who} named (${named}recorded as scan ${shown})`;
}

/** The form a run label must have to be shown - one line of letters, digits and
 * `._:-`, at most 100 characters, starting with a letter or digit: no newline, no markdown, nothing a repository could
 * use to write into a seat's brief, the report or the terminal. */
export function isRunLabel(label: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(label);
}

export interface GoneRow {
  finding_id: string;
  rule_id: string;
  verdict: string;
  because: string;
  /**
   * Where the earlier verdict's finding was: the decisive place the earlier
   * log's comparison basis records (`comparison.basis`), else the first place its premise block lists (no line), else null.
   */
  place?: { file: string; line: number | null } | null;
  /** The disposition the earlier log wrote on the verdict (`disposition`), or null where it wrote none. */
  earlier_disposition?: string | null;
  /**
   * Why no candidate of this scan answers it, where the program can tell, in the order checked: the place's file is not in
   * this tree (`file_removed`); the rule is not in this bundle (`rule_removed`) or is not the clause the verdict was given
   * (`rule_changed`); otherwise the file is there under the same rule and its matched text is not (`line_changed`). Without
   * a place or a premise block, `unknown`. Never "fixed": a gone candidate is not a check that the duty is met.
   */
  cause?: GoneCause;
  /**
   * The same-file link: this scan's candidates of the same rule in the same file that no earlier verdict answered (new
   * places), by finding id, sorted. Empty where there is none; absent where the place's file is not known.
   */
  same_file?: string[];
}

/** The causes a gone row can name (`GoneRow.cause`). */
export const GONE_CAUSES = ["file_removed", "rule_removed", "rule_changed", "line_changed", "unknown"] as const;
export type GoneCause = (typeof GONE_CAUSES)[number];

/**
 * An earlier verdict that a candidate of this scan could have reached and that was not
 * compared, because another earlier verdict was compared with that candidate (its own candidate's, by
 * `pairByKey`; or the one its finding id's route reached), or because every candidate of its content key was paired
 * with another. It is never a `GoneRow`, whose sentence says this scan raised no candidate with its content key.
 */
export interface NotChosenRow extends GoneRow {
  /**
   * The finding id of the earlier verdict compared instead, where one was: with this verdict's own candidate, or with
   * the candidate reached by its finding id. Absent where every candidate of its content key was paired with another
   * earlier verdict: no one verdict was compared in its place.
   */
  held_by?: string;
}

/**
 * What the plan says of an earlier verdict that is gone, or that was not compared, and of
 * a candidate whose content key's earlier verdicts all went to other candidates or could not be placed on it. Each
 * sentence is true of the case it is written for, and only of it. Which list a verdict goes to - gone
 * or not chosen - is decided by `ownFindingOf` alone (whether the verdict's own finding is in this scan), never by
 * whether the verdict was paired; the sentence then says which case it is.
 */
export const NOT_COMPARED_WORDS = {
  /** No candidate of this scan has its finding id, its content key or the places it records. */
  goneByKey: (recordsPlaces: boolean): string =>
    `this scan raised no candidate with that verdict's content key (the same rule over lines with the same text)${recordsPlaces ? ", its finding id or the places it records" : " or its finding id"}. The candidate is gone; that is not the same as the question being resolved.`,
  goneNoBlock:
    "this scan raised no candidate with that verdict's finding id, and the verdict records no premise block, so it has no content key to be found by. The candidate is gone; that is not the same as the question being resolved.",
  /** Its own candidate (the same finding id, or the same places) was compared with another earlier verdict of it. */
  ownTaken: (own: string, by: "finding" | "place", holder: string, sameFinding: boolean): string =>
    `not compared: this scan's candidate ${own} is the one this verdict answered (${by === "finding" ? "the same finding id" : "the same places"}), and it was compared with ${sameFinding ? "another record of this finding in the earlier run" : `the earlier verdict of finding ${holder}`} instead. Where several earlier verdicts answer one candidate only one is compared with it: one of its own finding id before one of its places, then the smallest finding id, then the smallest record. The candidate is not gone.`,
  /**
   * Its own candidate (the same finding id, or the same places) is in this scan under another content
   * key, and was compared with an earlier verdict of that key. It was listed gone, and the report said it was no longer
   * found, while the same finding was in this scan and being reviewed again.
   */
  ownOtherKey: (own: string, by: "finding" | "place", holder: string | undefined, sameFinding: boolean): string =>
    `not compared: this scan's candidate ${own} is the one this verdict answered (${by === "finding" ? "the same finding id" : "the same places"}), but its content key is not the one this verdict recorded (the lines it matched, or how many there are, are not the same), and a candidate is compared first with an earlier verdict of the content key it has now${holder === undefined ? "" : `: it was compared with ${sameFinding ? "another record of this finding in the earlier run" : `the earlier verdict of finding ${holder}`} instead`}. The candidate is not gone.`,
  /** Every candidate of its content key was paired with another earlier verdict, its own first. */
  leftOver: (candidates: number, recordsPlaces: boolean): string =>
    `not compared: this scan raised ${candidates} candidate(s) with that verdict's content key (the same rule over lines with the same text), and none has its finding id${recordsPlaces ? " or the places it records" : ""}; each was compared with another earlier verdict - its own first, where it had one - and each earlier verdict is compared with at most one candidate, so none was left for this one. Its candidate is not found at its own place; that is not the same as the question being resolved.`,
  /**
   * Candidates of its content key were left with no own earlier verdict of that key, beside it and any
   * other verdict of the key with no own candidate of that key, and nothing recorded places it on one of them. The
   * counts are of the key: a candidate counted may have its own earlier verdict under another content key, and a verdict
   * counted may have its own candidate under another. Said only of a verdict whose own finding is not in this scan (the
   * partition: one whose candidate is here under another key is told so, `ownOtherKey`).
   */
  unplaced: (candidates: number, verdicts: number): string =>
    `not compared: this scan raised ${candidates} candidate(s) with that verdict's content key (the same rule over lines with the same text) that no earlier verdict of that key answered by its finding id or its places, and the earlier run holds ${verdicts} verdict(s) of that key, this one among them, whose finding id and places no candidate of that key has. What an earlier verdict records - its finding id and, where it was read place by place, its places - matches none of those candidates, so which line it answered cannot be told: it is compared with none of them, and each is given to a seat again. That is not the same as the question being resolved.`,
  /** A candidate whose content key's earlier verdicts were all paired with other candidates, and none has its finding id. */
  newBesidePaired: (verdicts: number): string =>
    `the previous run's ${verdicts} verdict(s) with this candidate's content key were each compared with another candidate of this scan with that key - each candidate with its own earlier verdict first - and no other earlier verdict has this candidate's finding id, so nothing has answered it.`,
  /** A candidate left with no own earlier verdict, beside verdicts of its key that could not be placed on it. */
  newUnplaced: (candidates: number, verdicts: number): string =>
    `the previous run holds ${verdicts} verdict(s) with this candidate's content key whose finding id and places no candidate of that key has, and this scan raised ${candidates} candidate(s) of that key, this one among them, that no earlier verdict of that key answered by its finding id or its places. What those verdicts record - their finding ids and, where read place by place, their places - matches none of these candidates, so which line each answered cannot be told: none is compared with this candidate, and nothing has answered it.`,
  /** `keyHad` says what became of the earlier verdicts of the candidate's content key. */
  byFinding: (id: string, keyHad: "none" | "paired" | "unplaced"): string =>
    `not compared: this scan's candidate ${id} has a content key ${keyHad === "paired" ? "whose earlier verdicts were each compared with another candidate of this scan" : keyHad === "unplaced" ? "whose earlier verdicts could not be placed on it" : "no earlier verdict has"}, so it was compared with one earlier verdict of its finding id, only to name what changed. The earlier run holds more than one, and the one compared is one that records no premise block before one that does, then the smallest record.`,
  /** A candidate has its content key and none was compared with it (not reached; see the partition). */
  keyRaised:
    "not compared: this scan raised a candidate with that verdict's content key (the same rule over lines with the same text), and none was compared with this verdict. That is not the same as the question being resolved.",
  keyFirst: (id: string, holder: string): string =>
    `not compared: this scan's candidate ${id} has the content key of the earlier verdict of finding ${holder}, which is compared first. This verdict records no premise block, so it is reached only by its finding id, and only where the candidate was not paired with an earlier verdict of its content key. The candidate is not gone.`,
};

export interface PartitionResult {
  rows: PartitionRow[];
  /** The verdict documents to write into the new run, with `carried_forward_from` already on them. */
  carried: { finding_id: string; record: Record<string, unknown> }[];
  gone: GoneRow[];
  /** Earlier verdicts not compared because another held the key a candidate was looked up by. */
  not_chosen: NotChosenRow[];
  counts: {
    candidates: number;
    carried: number;
    adjudicate: number;
    gone: number;
    not_chosen: number;
    by_reason: Record<string, number>;
    by_premise: Record<string, number>;
  };
}

export interface PartitionArgs {
  candidates: Candidate[];
  previous: PreviousVerdict[];
  tree: TreeReader;
  rules: Map<string, Rule>;
  bundleVersion: string;
  bundleFiles?: Record<string, string>;
  /**
   * The per-rule answers THIS run settles, by rule id (`answersFromApplicability` over the new
   * scan's `per_rule_applicability` block). Absent is a run that settles none, and then a verdict
   * that records none is compared on its other premises alone.
   */
  answers?: Map<string, RestsOnAnswer[]>;
  /**
   * The instructions this run judges by (`instructions.ts` `instructionsPremise`). Absent or carrying a
   * problem, no verdict is carried: nothing says the instructions it was judged by still hold.
   */
  instructions?: { premise?: InstructionsPremise; problem?: string };
  /** What every seat of this run is handed beside its payload (`handedPremiseOf` over this run's findings). */
  handed?: RestsOnHanded;
  /** Today's dependency inventory by package (`rests-on.ts` `inventoryNowOf`), to scope a package's change. */
  inventory?: ReadonlyMap<string, InventoryPackageNow>;
  /** This run's ships premises by file (rests-on.ts `shipsFactsOf` over this run's findings), compared in `facts`. */
  ships?: ReadonlyMap<string, string>;
  /**
   * The run-wide `--seat-model` of THIS run, which `adjudicate` takes beside `--previous`
   * and writes in the plan (`seat_model_override`) so `assemble-report` re-derives the same partition. Every seat of this
   * run runs on it, so it is the model "now" for every seat (`modelNowOf`).
   */
  seatModel?: string;
  /**
   * The effort the adjudicator's agent file pins (`seat-effort.ts` `agentFileEffort`), the level a seat of
   * this run runs at. Null or absent, no verdict and no place is carried: nothing says what level they would run at.
   */
  effortNow?: string | null;
  /**
   * Build unit F5: what this run's payloads wrote for each place of a place-plan candidate (premise 5), by
   * `placeAt(file, line)`; null or absent, the candidate's places are not compared and none is carried.
   */
  placesNow?: (candidate: Candidate) => Map<string, PlaceWindow> | null;
  /**
   * Build unit F5: this run's reading spec digest (premise 1); absent, no place is carried. `alike`: the same spec under each version the program's verdict rules are declared to judge as
   * (`place-premises.ts` `readingSpecDigest`).
   */
  readingSpec?: ReadingSpecDigest;
  /**
   * VA-5: the digest of the fold this run would hand a new answer seat over a candidate's carried places
   * (`answer-premises.ts` `foldDigestOfCarried`, given here because importing it would close a load-order cycle through
   * launch-plan.ts); null where not every place is carried. Absent, no answer seat's answer is carried.
   */
  answerFoldNow?: (candidate: Candidate, outcomes: readonly PlaceOutcome[]) => string | null;
}

/**
 * THE MODEL A SEAT OF THIS CANDIDATE WOULD RUN ON NOW - its bin's model (`adjudication_group.seat_model`, the
 * member rules' own setting), the default where it names none. One function for the three seats whose answer a later run
 * carries: a place's (premise `model` of its row), a whole verdict's (`model` of the block) and an answer seat's (its own
 * premises). The run-wide `--seat-model` of this run is seen here (`PartitionArgs.seatModel`, recorded in
 * the plan): a verdict given on one model is never carried into a run on another, and one given under an override is
 * carried into a later run under the same override.
 */
export function modelNowOf(candidate: Candidate, override?: string): string {
  // A run-wide `--seat-model` launches every seat of this run on it.
  if (typeof override === "string" && override) return override;
  const model = (candidate.adjudication_group as { seat_model?: unknown } | undefined)?.seat_model;
  return typeof model === "string" ? model : DEFAULT_SEAT_MODEL;
}

/** A candidate read by the place plan (place-reply.ts `isPlacePlanCandidate`, restated: importing that module here would
 * close a load-order cycle through launch-plan.ts, which imports this one). */
const isPlacePlan = (c: Candidate): boolean => (c.reading_plan as { unit?: string } | undefined)?.unit === "place";
/** A place-plan candidate answered by an answer seat after its place seats (place-answer.ts `isAnswerSeatCandidate`, restated for the same reason). */
const isAnswerSeat = (c: Candidate): boolean => isPlacePlan(c) && (readingPlanOf(c)?.reader_slices.length ?? 0) > 0;

/**
 * BUILD UNIT F5: EVERY PLACE OF A PLACE-PLAN CANDIDATE, CARRIED OR READ AGAIN (design section 4).
 *
 * The earlier run's places are found by content (`placeKeyOf`), in any verdict of the earlier run - a place keeps its
 * identity when its candidate's finding id or its other places change. A place is carried only where its own premises
 * (`firstChangedPlacePremise`: the reading spec, the rule, the answers, what every seat is handed, the model, the window, the followed
 * lines, the files and the searches of its seat) are every one reproduced, its block is complete and the verdict that
 * holds it carried a complete premise block; anything else is read again with the one reason.
 */
function placeOutcomes(
  candidate: Candidate,
  args: PartitionArgs,
  earlier: (key: string) => { place: PlacePremises; block: RestsOn; prev: PreviousVerdict } | undefined,
): { carried: number; read: number; outcomes: PlaceOutcome[] } {
  const outcomes: PlaceOutcome[] = [];
  const windows = args.placesNow?.(candidate) ?? null;
  const seen = new Set<string>();
  const modelNow = modelNowOf(candidate, args.seatModel);
  const answersToday = (args.answers?.get(candidate.rule_id) ?? []).map((a) => `${a.question}\u0000${a.digest}`).sort();
  for (const loc of candidate.locations ?? []) {
    const at = placeAt(loc.file, loc.start_line);
    if (seen.has(at)) continue;
    seen.add(at);
    const id = placeKeyOf(candidate.rule_id, loc.file, loc.start_line, args.tree.lines(loc.file));
    const base = { file: loc.file, line: loc.start_line, key: id?.key ?? "" };
    if (!id) {
      outcomes.push({ ...base, outcome: "read", reason: "not-compared", because: "the place's matched line cannot be read in this tree, so its identity is not known." });
      continue;
    }
    const hit = earlier(id.key);
    if (!hit) {
      outcomes.push({ ...base, outcome: "read", reason: "new-place", because: "no row of the earlier run rests on this place's content: it is new, or it was not checked, or its row was refused." });
      continue;
    }
    const from = { from_scan: hit.prev.scan_id, from_finding_id: hit.prev.finding_id };
    if (hit.block.complete !== true || hit.place.complete !== true) {
      const why = hit.place.complete !== true ? (hit.place.incomplete ?? ["no reason recorded"]).join(" ") : (hit.block.incomplete ?? ["no reason recorded"]).join(" ");
      outcomes.push({ ...base, ...from, outcome: "read", reason: "premises-incomplete", because: `the earlier row's premises are incomplete: ${why}` });
      continue;
    }
    if (!windows || !args.readingSpec) {
      outcomes.push({ ...base, ...from, outcome: "read", reason: "not-compared", because: "this run was not given its payloads' windows or its reading spec, so no place is compared." });
      continue;
    }
    const now = windows.get(at) ?? null;
    const changed = firstChangedPlacePremise(
      hit.place,
      {
        key: id.key,
        window: now,
        model: modelNow,
        effort: args.effortNow ?? null,
        readingSpec: args.readingSpec,
        ruleHash: { today: ruleHash(args.rules.get(candidate.rule_id), candidate.rule_id), was: hit.block.rule.hash },
        answers: { today: answersToday, was: (hit.block.answers ?? []).map((a) => `${a.question}\u0000${a.digest}`).sort() },
        // The verdict that holds the place decides, by the one scoping a whole verdict uses (`handedChange`).
        handed:
          handedChange(hit.block.handed, args.handed, args, verdictReachOf(hit.prev.record, hit.block, candidate)) === null
            ? { today: args.handed?.digest ?? hit.block.handed?.digest ?? null, was: args.handed?.digest ?? hit.block.handed?.digest ?? null }
            : { today: args.handed?.digest ?? null, was: hit.block.handed?.digest ?? null },
      },
      args.tree,
    );
    if (changed || !now) {
      outcomes.push({ ...base, ...from, outcome: "read", reason: "premise-changed", premise: changed?.premise ?? "window", because: changed?.because ?? "this run's payload writes no window for the place." });
      continue;
    }
    outcomes.push({
      ...base,
      ...from,
      outcome: "carried",
      reason: "carried",
      // The premises named from the one list the comparison walks (`PLACE_PREMISE_WORDS`); the effort level was compared and not named.
      because: `every premise of the place's row in scan ${hit.prev.scan_id} is reproduced (${placePremisesInWords()})${specAlikeWords(hit.place.reading_spec, args.readingSpec)}: rule ${candidate.rule_id}, the model ${modelNow} at effort ${args.effortNow ?? "(none)"}, the place's text, ${hit.place.files.length} file(s) its seat Read and ${hit.place.searches.length} search(es) it ran. Carried, not re-verified.`,
      row: rebasedRow(hit.place, now),
      premises: { ...hit.place, window_start: now.window_start, row: rebasedRow(hit.place, now) },
    });
  }
  outcomes.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  const carried = outcomes.filter((o) => o.outcome === "carried").length;
  return { carried, read: outcomes.length - carried, outcomes };
}

/** The premise block of a previous verdict, where it wrote one in the shape this unit writes. */
function restsOnOf(record: Record<string, unknown>): RestsOn | null {
  const block = record.rests_on;
  if (!block || typeof block !== "object" || Array.isArray(block)) return null;
  const rec = block as Record<string, unknown>;
  if (typeof rec.spec !== "string") return null;
  return block as unknown as RestsOn;
}

/**
 * How many matched locations the previous record says nobody opened, or null when the record does not
 * say. NULL, NOT 0, WHEN THE BLOCK CANNOT SAY IT (fix-verify-shape CF2, 2026-09-24): a `not_read`
 * that was absent or not a list read as "nothing left unread", and a row whose `members` was not a
 * count added 0 - so a record that never stated what it left unopened was carried as if it had opened
 * everything. `not_read` is required in the reading block and `members` is an integer of at least 1
 * (verdict.schema.json); anything else is a block that does not say, which is `previous-reading-missing`.
 */
function unreadLocations(record: Record<string, unknown>): number | null {
  const reading = record.reading;
  if (!reading || typeof reading !== "object" || Array.isArray(reading)) return null;
  const rows = (reading as Record<string, unknown>).not_read;
  if (!Array.isArray(rows)) return null;
  let total = 0;
  for (const row of rows) {
    const members = (row as { members?: unknown } | null)?.members;
    // An integer of at least 1, as the schema says: 0 and 2.5 are not a count either.
    if (typeof members !== "number" || !Number.isInteger(members) || members < 1) return null;
    total += members;
  }
  return total;
}

/**
 * The files an earlier verdict's own record says its seat read - the files its seat's sight names
 * (`seat_sight`, from the seat's transcript), its `reading.read[]` rows and its `evidence[]` rows. A file the candidate
 * matched is in the premise block whether or not a seat opened it; this is what says whether one did.
 */
export function filesReadBySeat(record: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  const fileOf = (row: unknown): void => {
    const file = row && typeof row === "object" ? (row as { file?: unknown }).file : undefined;
    if (typeof file === "string" && file) out.add(file);
  };
  /* Every record of the verdict set, not the adjudicator's alone: a file the
   * refutation or the second look opened or quoted was read by a seat as well (verdict-set.ts `verdictSetRecordsOf`). */
  for (const { record: one } of verdictSetRecordsOf(record)) {
    for (const file of seatSightStampOf(one.seat_sight)?.files ?? []) out.add(file);
    const reading = one.reading;
    const read = reading && typeof reading === "object" && !Array.isArray(reading) ? (reading as { read?: unknown }).read : undefined;
    if (Array.isArray(read)) read.forEach(fileOf);
    if (Array.isArray(one.evidence)) one.evidence.forEach(fileOf);
  }
  return out;
}

/**
 * WHY THE `handed` PREMISE DOES NOT HOLD FOR ONE
 * VERDICT, or null where it does. One function for a whole verdict (`firstChangedPremise`) and for each place a verdict
 * holds (`placeOutcomes`), so the two cannot scope a package's change differently.
 *
 *   - Absent on both sides is not a change; absent on one side is.
 *   - The same digest holds.
 *   - Where the profile, the sheet and which packages are listed (with whether each is imported and whether its call sites
 *     were read: `rest`) are the same and only some packages' declarations differ (a version bump, above all), each such
 *     package counts only where the verdict rests on it (`packageChangeCounts`). A verdict carried past such a change
 *     names the packages on its row (`reach.packagesMovedUntouched`), so the carry is visible, never silent.
 *   - Anything else that differs - the profile, the sheet, a package added or removed, a block written before `rest` and
 *     `rows` were recorded - sends the verdict back, as before.
 */
export function handedChange(
  was: RestsOnHanded | undefined,
  today: RestsOnHanded | undefined,
  args: { inventory?: ReadonlyMap<string, InventoryPackageNow>; tree: TreeReader },
  reach?: VerdictReach,
): string | null {
  if (!today && !was) return null;
  if (!was) return "the verdict records nothing of the profile and the dependency inventory its seat was handed, so what it rested on beside its payload cannot be re-derived.";
  if (!today) return "the verdict rests on the profile and the dependency inventory its seat was handed, and this comparison was given neither, so they cannot be reproduced.";
  if (today.digest === was.digest) return null;
  if (today.rest !== undefined && today.rest === was.rest && today.rows && was.rows && args.inventory && reach) {
    const moved = [...new Set([...Object.keys(today.rows), ...Object.keys(was.rows)])].filter((name) => today.rows?.[name] !== was.rows?.[name]).sort();
    if (moved.length > 0) {
      for (const name of moved) {
        const why = packageChangeCounts(name, args.inventory, reach, args.tree);
        // Words
        if (why !== null) return `the declaration of ${name} in the dependency inventory changed since the verdict was given, and the verdict rests on it: ${why}.`;
      }
      reach.packagesMovedUntouched = moved;
      return null;
    }
  }
  return today.profile_digest !== was.profile_digest
    ? `the profile is not the one the verdict's seat was handed: its digest is now ${today.profile_digest ?? "none (no profile)"} and the verdict rests on ${was.profile_digest ?? "none (no profile)"}.`
    : (today.sheet === false) !== (was.sheet === false)
      ? // Words
        `the verdict's seat was ${was.sheet === false ? "handed no orientation sheet" : "handed the orientation sheet"} and this run's seats ${today.sheet === false ? "are handed none" : "are handed one"}, so it is given again.`
      : today.rest !== undefined && was.rest !== undefined && today.rest !== was.rest
        ? // Words
          `the dependency inventory is not the one the verdict's seat was handed: a package was added or removed, or whether one is imported or its call sites were read changed (${today.packages} package(s) now, ${was.packages} then), and a verdict may rest on a package being absent, so it is given again.`
        : `the dependency inventory is not the one the verdict's seat was handed: a package or a declaration of one changed (${today.packages} package(s) now, ${was.packages} then).`;
}

/**
 * WHAT A VERDICT REACHED, for scoping a package's change: the text of every record of its verdict set
 * (folded, so a name is found whatever its case or separators), every file a seat opened or quoted or the block lists or
 * the candidate matched, and every search a seat ran. `packagesMovedUntouched` is written by `handedChange` where the
 * verdict is carried past a change to packages it does not rest on.
 */
export interface VerdictReach {
  text: string;
  files: Set<string>;
  searches: RestsOnSearch[];
  packagesMovedUntouched?: string[];
}

/** Lower case, and every separator a package name or a mention of it may differ by removed. */
export const foldName = (text: string): string => text.toLowerCase().replace(/[\s\-_.]+/g, "");

export function verdictReachOf(record: Record<string, unknown>, block: RestsOn, candidate: Candidate): VerdictReach {
  const files = new Set<string>(filesReadBySeat(record));
  for (const f of block.files ?? []) if (typeof f.path === "string") files.add(f.path);
  const searches: RestsOnSearch[] = [...(block.searches ?? [])];
  for (const place of block.places ?? []) {
    for (const f of (place as { files?: { path?: unknown }[] }).files ?? []) if (typeof f.path === "string") files.add(f.path);
    searches.push(...((place as { searches?: RestsOnSearch[] }).searches ?? []));
  }
  const answer = block.answer as { files?: { path?: unknown }[]; searches?: RestsOnSearch[] } | undefined;
  for (const f of answer?.files ?? []) if (typeof f.path === "string") files.add(f.path);
  searches.push(...(answer?.searches ?? []));
  for (const loc of candidate.locations ?? []) files.add(loc.file);
  const text = verdictSetRecordsOf(record)
    // The premise block is left out: its `handed.rows` lists every package of the inventory, which the seat did not write.
    .map(({ record: one }) => JSON.stringify(one, (key, value) => (key === "rests_on" ? undefined : value)) ?? "")
    .join("\n");
  return { text: foldName(text), files, searches };
}

/**
 * The forms of a package name a verdict's text or a file it read may hold it by, folded: the whole
 * name, each segment of its path (`@scope/name`, `group:artifact`, `host/owner/repo`) and each part of a segment of four
 * characters or more ("PostHog" for `posthog-js`, "Mixpanel" for `mixpanel-browser`). A part shorter than
 * that is left out only as a part; the whole name and its segments are always forms. More forms can only send more
 * verdicts back.
 */
export function packageNameForms(name: string): string[] {
  const forms = new Set<string>([foldName(name)]);
  for (const segment of name.split(/[/:@]+/)) {
    if (segment === "" || /^v\d+$/i.test(segment)) continue;
    forms.add(foldName(segment));
    for (const part of segment.split(/[\-_.]+/)) if (part.length >= 4) forms.add(foldName(part));
  }
  forms.delete("");
  return [...forms];
}

/**
 * WHETHER A CHANGE TO ONE PACKAGE'S DECLARATIONS COUNTS FOR A VERDICT, and why, or null where it does
 * not. The requirements are the design's later item 2D (the delivery design, section 12); every path adds a
 * reason to count, none removes one:
 *
 *   1. its call sites were not read (`call_sites_not_read`): whether any file imports it is not known, so it counts;
 *   2. the verdict names it (any form of `packageNameForms`, in the text of any record of its verdict set);
 *   3. a file the verdict reached holds a call site of it the inventory lists, or names it (an import names the package);
 *   4. a search the verdict ran, replayed today, finds a line that names it, or finds lines in a file that holds a listed
 *      call site of it or names it (a file a search returned lines from was searched), or lists a file whose path names
 *      it (a Glob); a search that cannot be replayed here counts wherever the package has any call site (the scope is not
 *      narrowed by a guess). This holds WHATEVER THE
 *      INVENTORY COUNTS OF ITS IMPORTS: a package loaded with no import (a `<script src>` tag, a name in a configuration
 *      file, a copy under `node_modules`) is tied to a verdict by a search exactly as an imported one is
 *      (`searchTiesPackage`);
 *   5. it is declared by a manifest below the tree's top, and the verdict reached a file in that manifest's folder, or a
 *      file it reached names that folder (a relative import into it), or the package that manifest makes (its npm `name`)
 *      counts by 2-4 (a wrapper: the design's `@acme/telemetry`).
 *
 * A package added or removed never reaches here: `handedChange` sends every verdict back for it, because a verdict may
 * rest on a package being absent and nothing records that.
 * No reason above is skipped because the inventory counts
 * no import of the package: the inventory counts imports, and a verdict can rest on a package it loads another way. A
 * file the verdict reached that cannot be read now counts for every package, for the same reason.
 */
export function packageChangeCounts(
  name: string,
  inventory: ReadonlyMap<string, InventoryPackageNow>,
  reach: VerdictReach,
  tree: TreeReader,
  seen: Set<string> = new Set(),
): string | null {
  if (seen.has(name)) return null;
  seen.add(name);
  const now = inventory.get(name);
  // the reasons below.
  if (!now) return "it is not listed in today's inventory";
  if (now.call_sites_not_read) return "lines that could hold a call site of it were not read, so whether the files the verdict read import it is not known";
  const forms = packageNameForms(name);
  const named = (text: string): boolean => forms.some((f) => text.includes(f));
  if (named(reach.text)) return "the verdict's own record names it";
  for (const file of now.call_sites) if (reach.files.has(file)) return `the inventory lists a call site of it in ${file}, which the verdict read`;
  for (const file of [...reach.files].sort()) {
    const text = foldedFileOf(tree, file);
    // whatever the inventory counts of its imports.
    if (text === null) return `${file}, which the verdict read, cannot be read now to see whether it calls or names it`;
    if (named(text)) return `${file}, which the verdict read, names it`;
  }
  for (const row of reach.searches) {
    const why = searchTiesPackage(row, now, named, tree);
    if (why !== null) return why;
  }
  for (const manifest of now.declared_in) {
    const cut = manifest.lastIndexOf("/");
    if (cut < 0) continue;
    const folder = manifest.slice(0, cut);
    for (const file of reach.files) if (file.startsWith(`${folder}/`)) return `it is declared in ${manifest}, and the verdict read ${file} in that folder`;
    const base = folder.slice(folder.lastIndexOf("/") + 1);
    if (foldName(base).length < 3) return `it is declared in ${manifest}, a folder whose name is too short to tell whether the files the verdict read refer to it`;
    for (const file of reach.files) {
      const lines = tree.lines(file);
      if (lines !== null && foldName(lines.join("\n")).includes(foldName(base))) return `it is declared in ${manifest}, and ${file}, which the verdict read, names the folder ${base}`;
    }
    const own = manifest.endsWith("package.json") ? workspaceNameOf(tree, manifest) : null;
    if (own === undefined) return `it is declared in ${manifest}, whose own package name cannot be read`;
    if (own !== null) {
      const through = inventory.has(own) ? packageChangeCounts(own, inventory, reach, tree, seen) : nameReached(own, reach, tree);
      if (through !== null) return `it is declared by ${own} (${manifest}), and the verdict rests on that package: ${through}`;
    }
  }
  return aliasTie(name, now, reach, tree) ?? wrapperTie(name, now, reach, tree);
}

/**
 * A NAME THE REPOSITORY GIVES A PACKAGE: code may load a
 * package by a name that is not the package's, where the repository says so in a file a program reads: an npm alias key
 * (`"banner-lib": "npm:cookieconsent@3"`, whose files then name the target), a bundler's alias (`resolve.alias`, Parcel's
 * `alias`, tsconfig `paths`, babel's module resolver, vite's `find`/`replacement`), webpack's `ProvidePlugin` global, an
 * import map (an HTML `<script type="importmap">`, `importmap.json`, `deno.json`, Rails' `config/importmap.rb` `pin`), and
 * a copy step that renames a file of the package (`rename:` or `to:` beside a path into it). `where` is the file that says
 * it. Read once per tree from the plain listing (files under `node_modules/` left out); none where the tree cannot be
 * listed, which is no less than before this reason existed.
 */
interface TreeAlias {
  /** The name code uses. */
  key: string;
  /** The text it stands for: a specifier, a path or a URL. */
  target: string;
  where: string;
  kind: "npm" | "alias" | "import-map" | "global" | "copy";
}
const TREE_ALIASES = new WeakMap<TreeReader, TreeAlias[]>();
const ALIAS_CONFIG = /(?:^|\/)(?:(?:vite|vitest|webpack|rollup|rspack|rsbuild|vue|craco|next|nuxt|svelte|astro|quasar|esbuild|tsup|snowpack|metro|babel|parcel)\.config\.[cm]?[jt]s|webpack\.[\w.-]*\.[cm]?[jt]s|\.babelrc(?:\.json)?|[jt]sconfig[\w.-]*\.json)$/i;
const IMPORT_MAP_FILE = /(?:^|\/)(?:importmap\.json|import_map\.json|[\w.-]+\.importmap|deno\.jsonc?)$/i;
const MARKUP_FILE = /\.(?:html?|erb|ejs|hbs|handlebars|php|twig|njk|liquid|mustache|jinja2?|j2|vue|svelte|astro|cshtml|jsp|aspx)$/i;
const STRING_LITERAL = /(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g;
/**
 * FILES OF A CONFIGURATION KIND, BY WHAT THEY ARE
 * WRITTEN IN AND NEVER BY NAME: every JavaScript, TypeScript and JSON file and every `.<name>rc` file is read for an alias
 * declaration, so `config-overrides.js`, `vite.config.prod.js`, `webpack.common.js` and a build script are read as
 * `vite.config.js` is. `ALIAS_CONFIG` above is kept, and its files are read as before as well.
 */
const SCRIPT_OR_DATA_FILE = /(?:\.(?:[cm]?[jt]sx?|json5?|jsonc)|(?:^|\/)\.[\w.-]*rc)$/i;
/**
 * A first look: a file where none of these words stand declares no alias read here. `alias` in any word (`resolveAlias`,
 * `_moduleAliases`) and metro's `extraNodeModules`.
 */
const ALIAS_WORDS = /[Aa]lias|\b(?:paths|entries|imports|moduleNameMapper|extraNodeModules|ProvidePlugin|replacement|rename)\b|\bto\s*:/;

/** The text of the `{...}` or `[...]` that opens at `open` (an index of `{` or `[`), or "" where it does not close. */
function balancedFrom(text: string, open: number): string {
  const close = text[open] === "{" ? "}" : "]";
  let depth = 0;
  for (let i = open; i < text.length && i - open < 20_000; i++) {
    if (text[i] === text[open]) depth += 1;
    else if (text[i] === close && --depth === 0) return text.slice(open, i + 1);
  }
  return "";
}

/** Each `key: <strings>` line of a block: the key (quoted or bare) and every string literal after it on the line. */
function blockPairs(block: string): { key: string; target: string }[] {
  const out: { key: string; target: string }[] = [];
  for (const m of block.matchAll(/(?:(["'`])([^"'`\n]+)\1|([A-Za-z_$][\w$]*))\s*:\s*([^\n]*)/g)) {
    const key = m[2] ?? m[3] ?? "";
    const target = [...(m[4] ?? "").matchAll(STRING_LITERAL)].map((x) => x[2]).join(" ");
    if (key !== "" && target !== "") out.push({ key, target });
  }
  return out;
}

/** The index just past the string, template or comment that starts at `i`, or `i` where none starts there. A quote left open ends at its line's end (a template's at the text's). */
function pastQuoted(text: string, i: number): number {
  const c = text[i];
  if (c === '"' || c === "'" || c === "`") {
    for (let j = i + 1; j < text.length; j++) {
      if (text[j] === "\\") j += 1;
      else if (text[j] === c) return j + 1;
      else if (text[j] === "\n" && c !== "`") return j;
    }
    return text.length;
  }
  if (c === "/" && text[i + 1] === "/") {
    const end = text.indexOf("\n", i);
    return end < 0 ? text.length : end;
  }
  if (c === "/" && text[i + 1] === "*") {
    const end = text.indexOf("*/", i + 2);
    return end < 0 ? text.length : end + 2;
  }
  return i;
}

/**
 * The text of the `{...}`, `[...]` or `(...)` that opens at
 * `open`, over any number of lines, strings and comments not counted; "" where it does not close.
 */
function balancedAcross(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length && i - open < 400_000; i++) {
    const past = pastQuoted(text, i);
    if (past !== i) {
      i = past - 1;
      continue;
    }
    const c = text[i];
    if (c === "{" || c === "[" || c === "(") depth += 1;
    else if ((c === "}" || c === "]" || c === ")") && --depth === 0) return text.slice(open, i + 1);
  }
  return "";
}

/** The entries of a balanced block, split at its own commas: never inside a string, a comment or a nested bracket. */
function topEntries(block: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 1;
  for (let i = 1; i < block.length - 1; i++) {
    const past = pastQuoted(block, i);
    if (past !== i) {
      i = past - 1;
      continue;
    }
    const c = block[i];
    if (c === "{" || c === "[" || c === "(") depth += 1;
    else if (c === "}" || c === "]" || c === ")") depth -= 1;
    else if (c === "," && depth === 0) {
      out.push(block.slice(start, i));
      start = i + 1;
    }
  }
  out.push(block.slice(start, Math.max(start, block.length - 1)));
  return out.map((e) => e.replace(/^(?:\s*(?:\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/))*\s*/, "").trim()).filter((e) => e !== "");
}

const stringsOf = (text: string): string[] => [...text.matchAll(STRING_LITERAL)].map((x) => x[2]).filter((s) => s !== "");

/** An entry's key (a quoted string, a computed `[string]` or a bare name) and the text after its own colon. */
function keyValueOf(entry: string): { key: string; value: string } | null {
  const m = /^(?:(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1|\[\s*(["'`])((?:(?!\3)[^\\\n]|\\.)*)\3\s*\]|([A-Za-z_$#@][\w$#@./*-]*))\s*:(?!:)/.exec(entry);
  const key = m?.[2] ?? m?.[4] ?? m?.[5] ?? "";
  return m && key !== "" ? { key, value: entry.slice(m[0].length) } : null;
}

/** A `find:` value that is a regular expression literal (`/^@consent$/`), as the name it matches. */
const regexKey = (value: string): string => /^\s*\/((?:[^/\\\n]|\\.)+)\/[a-z]*/.exec(value)?.[1]?.replace(/\\(.)/g, "$1") ?? "";

/**
 * EVERY NAME A BLOCK GIVES, WHATEVER ITS LAYOUT: each
 * entry's key with every string of its value, however many lines the entry runs over and however many entries share a line;
 * an entry `{ find, replacement }` (vite, rollup); an entry `[name, target]` (an alias map written as pairs), also as an
 * entry's value. Read beside `blockPairs`, never instead: a name either gives is kept.
 */
function entryPairs(block: string, depth = 0): { key: string; target: string }[] {
  const out: { key: string; target: string }[] = [];
  if (depth > 3) return out;
  for (const entry of topEntries(block)) {
    // a computed key written out (`[\`@consent\`]: ...`)
    // is a key, not a pair: read below with the other keys.
    if (entry.startsWith("[") && !/^\[\s*(["'`])(?:(?!\1)[^\\\n]|\\.)*\1\s*\]\s*:(?!:)/.test(entry)) {
      const pair = topEntries(balancedAcross(entry, 0));
      const key = stringsOf(pair[0] ?? "")[0] ?? "";
      const target = pair.slice(1).flatMap(stringsOf).join(" ");
      if (key !== "" && target !== "") out.push({ key, target });
      continue;
    }
    if (entry.startsWith("{")) {
      const inner = balancedAcross(entry, 0);
      const kvs = topEntries(inner).map(keyValueOf).filter((kv): kv is { key: string; value: string } => kv !== null);
      const find = kvs.find((kv) => kv.key === "find");
      const replacement = kvs.find((kv) => kv.key === "replacement");
      if (find && replacement) {
        const key = stringsOf(find.value)[0] ?? regexKey(find.value);
        const target = stringsOf(replacement.value).join(" ");
        if (key !== "" && target !== "") out.push({ key, target });
      } else out.push(...entryPairs(inner, depth + 1));
      continue;
    }
    const kv = keyValueOf(entry);
    if (!kv) continue;
    const target = stringsOf(kv.value).join(" ");
    if (target !== "") out.push({ key: kv.key, target });
    const value = kv.value.trimStart();
    if (value.startsWith("[")) out.push(...entryPairs(balancedAcross(value, 0), depth + 1));
  }
  return out;
}

/**
 * The alias declarations of one file's text, in every
 * layout C2 found and the ones beside them: a block after `alias`, `paths`, `entries`, `imports` or `moduleNameMapper`
 * (`:` or `=`), after `Object.assign(<...>.alias,` or `alias.merge(`, and `ProvidePlugin`'s; webpack-chain's
 * `alias.set(name, target)`, chained `.set(...)` included; and `alias[name] = target` or `alias.name = target`.
 */
function widerAliasesOf(file: string, text: string, out: TreeAlias[]): void {
  if (!ALIAS_WORDS.test(text)) return;
  const blocksAfter = (re: RegExp): string[] =>
    [...text.matchAll(re)].map((m) => balancedAcross(text, (m.index ?? 0) + m[0].length - 1)).filter((b) => b !== "");
  for (const block of blocksAfter(/\b(?:alias|paths|entries|moduleNameMapper)["']?\s*[:=]\s*[{[]/g)) for (const p of entryPairs(block)) out.push({ ...p, where: file, kind: "alias" });
  // A table under any key that ends in `alias` or
  // `aliases` in either case (Next.js Turbopack's `resolveAlias`, module-alias's `_moduleAliases`), and metro's
  // `extraNodeModules`; read beside the line above, never instead.
  for (const block of blocksAfter(/(?:[\w$]+[Aa]lias(?:es)?|\b[Aa]liases|\bextraNodeModules)["']?\s*[:=]\s*[{[]/g)) for (const p of entryPairs(block)) out.push({ ...p, where: file, kind: "alias" });
  for (const block of blocksAfter(/\balias\s*(?:,|\.\s*merge\s*\()\s*\{/g)) for (const p of entryPairs(block)) out.push({ ...p, where: file, kind: "alias" });
  for (const block of blocksAfter(/["']?\bimports["']?\s*[:=]\s*\{/g)) for (const p of entryPairs(block)) out.push({ ...p, where: file, kind: "import-map" });
  for (const block of blocksAfter(/ProvidePlugin\s*\(\s*\{/g)) for (const p of entryPairs(block)) out.push({ ...p, where: file, kind: "global" });
  for (const m of text.matchAll(/\balias\s*\.\s*set\s*\(/g)) {
    let at = (m.index ?? 0) + m[0].length - 1;
    for (let k = 0; k < 200; k++) {
      const args = balancedAcross(text, at);
      if (args === "") break;
      const parts = topEntries(args);
      const key = stringsOf(parts[0] ?? "")[0] ?? "";
      const target = parts.slice(1).flatMap(stringsOf).join(" ");
      if (key !== "" && target !== "") out.push({ key, target, where: file, kind: "alias" });
      const next = /^\s*\.\s*set\s*\(/.exec(text.slice(at + args.length, at + args.length + 200));
      if (!next) break;
      at = at + args.length + next[0].length - 1;
    }
  }
  for (const m of text.matchAll(/\balias\s*(?:\[\s*(["'`])((?:(?!\1)[^\\\n])+)\1\s*\]|\.\s*([A-Za-z_$][\w$]*))\s*=(?![=>])/g)) {
    const key = m[2] ?? m[3] ?? "";
    let end = (m.index ?? 0) + m[0].length;
    let depth = 0;
    for (; end < text.length && end - (m.index ?? 0) < 20_000; end++) {
      const past = pastQuoted(text, end);
      if (past !== end) {
        end = past - 1;
        continue;
      }
      const c = text[end];
      if (c === "{" || c === "[" || c === "(") depth += 1;
      else if (c === "}" || c === "]" || c === ")") depth -= 1;
      if (depth < 0 || (depth === 0 && (c === ";" || c === "\n" || c === ","))) break;
    }
    const target = stringsOf(text.slice((m.index ?? 0) + m[0].length, end)).join(" ");
    if (key !== "" && key !== "set" && target !== "") out.push({ key, target, where: file, kind: "alias" });
  }
  // A copy step: a flat object that names a path and gives the copy another name.
  for (const m of text.matchAll(/\{[^{}]{0,600}\}/g)) {
    const obj = m[0];
    const renamed = /\b(?:rename|to)\s*:\s*(["'`])([^"'`\n]+)\1/.exec(obj);
    if (!renamed) continue;
    const target = [...obj.matchAll(STRING_LITERAL)].map((x) => x[2]).filter((t) => t !== renamed[2]).join(" ");
    const key = renamed[2].slice(renamed[2].lastIndexOf("/") + 1);
    if (key !== "" && target !== "") out.push({ key, target, where: file, kind: "copy" });
  }
}

/** Every string a JSON value holds, at any depth (Node's conditional `imports`). */
function jsonStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(jsonStrings);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(jsonStrings);
  return [];
}

/** A file's text read once without keeping it (the tree's reader keeps what it reads); null where it cannot be read. */
function textOnce(tree: TreeReader, file: string): string | null {
  try {
    return readSourceText(join(tree.root, file));
  } catch {
    return null;
  }
}

function treeAliasesOf(tree: TreeReader): TreeAlias[] {
  const known = TREE_ALIASES.get(tree);
  if (known) return known;
  const out: TreeAlias[] = [];
  const listing = tree.plainFiles();
  const files = "problem" in listing ? [] : listing.files.filter((f) => !/(?:^|\/)node_modules\//.test(f));
  for (const file of files) {
    const base = file.slice(file.lastIndexOf("/") + 1);
    const isManifest = base === "package.json";
    const isConfig = ALIAS_CONFIG.test(file);
    const isMap = IMPORT_MAP_FILE.test(file) || /(?:^|\/)config\/importmap\.rb$/.test(file);
    const isMarkup = MARKUP_FILE.test(file);
    const isScript = SCRIPT_OR_DATA_FILE.test(file) && !/(?:^|\/)\.git\//.test(file);
    if (!isManifest && !isConfig && !isMap && !isMarkup && !isScript) continue;
    if (!isManifest && !isConfig && !isMap && !isMarkup) {
      // any other file of a configuration kind.
      const text = textOnce(tree, file);
      if (text !== null) widerAliasesOf(file, text, out);
      continue;
    }
    const lines = tree.lines(file);
    if (lines === null) continue;
    const text = lines.join("\n");
    if (isMarkup && !/importmap/i.test(text)) continue;
    // read beside the readings below, never instead.
    widerAliasesOf(file, text, out);
    const blocksAfter = (re: RegExp): string[] =>
      [...text.matchAll(re)].map((m) => balancedFrom(text, (m.index ?? 0) + m[0].length - 1)).filter((b) => b !== "");
    if (isManifest) {
      try {
        const doc = JSON.parse(text) as Record<string, unknown>;
        for (const block of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
          const deps = doc[block];
          if (deps && typeof deps === "object" && !Array.isArray(deps)) {
            for (const [key, spec] of Object.entries(deps as Record<string, unknown>)) if (typeof spec === "string" && spec.startsWith("npm:")) out.push({ key, target: spec, where: file, kind: "npm" });
          }
        }
        const alias = doc.alias;
        if (alias && typeof alias === "object" && !Array.isArray(alias)) {
          for (const [key, target] of Object.entries(alias as Record<string, unknown>)) if (typeof target === "string") out.push({ key, target, where: file, kind: "alias" });
        }
        // Node's own subpath imports (`"#name"`), conditions included.
        const imports = doc.imports;
        if (imports && typeof imports === "object" && !Array.isArray(imports)) {
          for (const [key, target] of Object.entries(imports as Record<string, unknown>)) {
            const said = jsonStrings(target).join(" ");
            if (said !== "") out.push({ key, target: said, where: file, kind: "import-map" });
          }
        }
      } catch {
        // A manifest that is not JSON names no alias here; the census reports it.
      }
      continue;
    }
    if (isConfig) {
      for (const block of blocksAfter(/\b(?:alias|paths|entries)["']?\s*[:=]\s*[{[]/g)) for (const p of blockPairs(block)) out.push({ ...p, where: file, kind: "alias" });
      for (const block of blocksAfter(/ProvidePlugin\s*\(\s*\{/g)) for (const p of blockPairs(block)) out.push({ ...p, where: file, kind: "global" });
      for (const m of text.matchAll(/\bfind\s*:\s*(["'`])([^"'`\n]+)\1[\s\S]{0,200}?\breplacement\s*:\s*([^\n]*)/g)) {
        const target = [...(m[3] ?? "").matchAll(STRING_LITERAL)].map((x) => x[2]).join(" ");
        if (target !== "") out.push({ key: m[2], target, where: file, kind: "alias" });
      }
      // A copy step: a flat object that names a path and gives the copy another name.
      for (const m of text.matchAll(/\{[^{}]{0,600}\}/g)) {
        const obj = m[0];
        const renamed = /\b(?:rename|to)\s*:\s*(["'`])([^"'`\n]+)\1/.exec(obj);
        if (!renamed) continue;
        const target = [...obj.matchAll(STRING_LITERAL)].map((x) => x[2]).filter((t) => t !== renamed[2]).join(" ");
        const key = renamed[2].slice(renamed[2].lastIndexOf("/") + 1);
        if (key !== "" && target !== "") out.push({ key, target, where: file, kind: "copy" });
      }
      continue;
    }
    if (/(?:^|\/)config\/importmap\.rb$/.test(file)) {
      for (const m of text.matchAll(/^\s*pin\s+["']([^"']+)["'](?:\s*,\s*to:\s*["']([^"']+)["'])?/gm)) out.push({ key: m[1], target: m[2] ?? m[1], where: file, kind: "import-map" });
      continue;
    }
    for (const block of blocksAfter(/["']?imports["']?\s*:\s*\{/g)) for (const p of blockPairs(block)) out.push({ ...p, where: file, kind: "import-map" });
  }
  TREE_ALIASES.set(tree, out);
  return out;
}

/** Whether a target's text names a package: the name whole, bounded by the start, a path or version sign, or the end. */
function targetNames(target: string, name: string): boolean {
  const text = target.replace(/%40/gi, "@");
  const at = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[\\s/:"'@=])${at}(?=$|[\\s/@"'?#])`).test(text);
}

/**
 * Rules 2-4 again, through the names the repository gives the
 * package (`treeAliasesOf`): the verdict's record, a file it read, or a search it ran names such a name; and, for an npm
 * alias key, the package it stands for. Only adds to the reasons before it. A name shorter than three characters once
 * folded (`$`, `_`) cannot be told apart from other text, so it counts wherever the verdict read or searched anything. the reasons.
 */
function aliasTie(name: string, now: InventoryPackageNow, reach: VerdictReach, tree: TreeReader): string | null {
  const ways: { form: string; said: string }[] = [];
  for (const a of treeAliasesOf(tree)) {
    if (a.key !== name && a.kind !== "npm" && targetNames(a.target, name)) {
      // A pattern's anchors and wildcards are not part
      // of the name (`^@consent$`, `@ui/(.*)`, `@/*`); each step only shortens the form, so it is found wherever it was.
      const form = foldName(
        a.key
          .replace(/^\^/, "")
          .replace(/\$$/, "")
          .replace(/(?:\(\.[*+]\)|\.[*+])$/, "")
          .replace(/\/\*?$/, "")
          .replace(/\*$/, ""),
      );
      const said = `${a.where} gives it the name ${a.key}`;
      if (form.length < 3) {
        if (reach.files.size > 0 || reach.searches.length > 0) return `${said}, too short to tell whether what the verdict read or searched uses it`;
        continue;
      }
      ways.push({ form, said });
    } else if (a.kind === "npm" && a.key !== name && targetNames(a.target, name)) {
      ways.push({ form: foldName(a.key), said: `${a.where} gives it the name ${a.key}` });
    } else if (a.kind === "npm" && a.key === name) {
      const target = /^npm:((?:@[^/@\s]+\/)?[^@\s]+)/.exec(a.target)?.[1];
      if (target) for (const form of packageNameForms(target)) ways.push({ form, said: `${a.where} makes it ${target} under another name` });
    }
  }
  if (ways.length === 0) return null;
  const via = (text: string): { form: string; said: string } | undefined => ways.find((w) => text.includes(w.form));
  const inRecord = via(reach.text);
  if (inRecord) return `${inRecord.said}, and the verdict's own record names that`;
  for (const file of [...reach.files].sort()) {
    const text = foldedFileOf(tree, file);
    const hit = text === null ? undefined : via(text);
    if (hit) return `${hit.said}, and ${file}, which the verdict read, names that`;
  }
  const named = (text: string): boolean => via(text) !== undefined;
  for (const row of reach.searches) {
    const why = searchTiesPackage(row, now, named, tree);
    if (why !== null) return `${ways[0].said}${ways.length > 1 ? " (and other names)" : ""}, and ${why.replace(/\bnames it\b/, "names that")}`;
  }
  return null;
}

/**
 * A LOCAL WRAPPER: a file the verdict read imports a
 * file of the repository, and that file loads the package (the inventory lists a call site of it there, an import or
 * require of it names the package, or its text names the package whole). The import is a relative path, or a path after
 * an alias prefix (`@/`, `~/`, `$lib/`, `#`) or a base folder, matched at the end of a file's path; one step only: a chain
 * of two or more files of the repository is not followed, and the report says so. Only adds to the reasons before it. Also a specifier of one segment (`baseUrl`'s
 * `'consent'`), a specifier the repository's alias table leads to a path (`aliasedPathsOf`), and a page's script tag. the reasons.
 */
function wrapperTie(name: string, now: InventoryPackageNow, reach: VerdictReach, tree: TreeReader): string | null {
  const sites = new Set(now.call_sites);
  const whole = foldName(name);
  for (const file of [...reach.files].sort()) {
    for (const local of localImportsOf(tree, file)) {
      if (local === file || reach.files.has(local)) continue;
      if (sites.has(local)) return `${file}, which the verdict read, imports ${local}, where the inventory lists a call site of it`;
      const lines = tree.lines(local);
      if (lines === null) continue;
      const text = lines.join("\n");
      if (importSpecifiersOf(text).some((spec) => spec === name || spec.startsWith(`${name}/`))) return `${file}, which the verdict read, imports ${local}, which imports it`;
      if (whole.length >= 3 && foldName(text).includes(whole)) return `${file}, which the verdict read, imports ${local}, which names it`;
    }
  }
  return null;
}

const SCRIPT_EXTENSION = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/i;
/**
 * Every specifier a file imports, requires, re-exports or loads by a written `import(...)`; and every `src` of a page's `<script>` tag.
 */
function importSpecifiersOf(text: string): string[] {
  return [
    ...[...text.matchAll(/(?:\bfrom|\bimport|\brequire\s*\(|\bimport\s*\()\s*(["'`])([^"'`\n]+)\1/g)].map((m) => m[2]),
    ...[...text.matchAll(/<script\b[^>]*?\bsrc\s*=\s*(["'])([^"'\n]+)\1/gi)].map((m) => m[2]),
  ];
}

/** The tree's script files by their path without the extension, and a folder's `index` file by the folder too; once per tree. */
const SCRIPT_STEMS = new WeakMap<TreeReader, Map<string, string[]>>();
function scriptStemsOf(tree: TreeReader): Map<string, string[]> {
  const known = SCRIPT_STEMS.get(tree);
  if (known) return known;
  const out = new Map<string, string[]>();
  const listing = tree.plainFiles();
  const files = "problem" in listing ? [] : listing.files.filter((f) => SCRIPT_EXTENSION.test(f) && !/(?:^|\/)node_modules\//.test(f));
  const add = (stem: string, file: string): void => {
    out.set(stem, [...(out.get(stem) ?? []), file]);
  };
  for (const file of files) {
    const stem = file.replace(SCRIPT_EXTENSION, "");
    add(stem, file);
    if (/(?:^|\/)index$/.test(stem)) add(stem.replace(/\/?index$/, ""), file);
  }
  SCRIPT_STEMS.set(tree, out);
  return out;
}

/** The stems of `scriptStemsOf` by their last segment, once per tree. */
const STEM_TAILS = new WeakMap<TreeReader, Map<string, string[]>>();
function stemTailsOf(tree: TreeReader): Map<string, string[]> {
  const known = STEM_TAILS.get(tree);
  if (known) return known;
  const out = new Map<string, string[]>();
  for (const stem of scriptStemsOf(tree).keys()) {
    const tail = stem.slice(stem.lastIndexOf("/") + 1);
    out.set(tail, [...(out.get(tail) ?? []), stem]);
  }
  STEM_TAILS.set(tree, out);
  return out;
}

/**
 * THE PATHS A SPECIFIER LEADS TO THROUGH THE NAMES THE
 * REPOSITORY GIVES (`treeAliasesOf`: a bundler's or TypeScript's alias, an import map, Node's imports field): a key equal to
 * the specifier, a key the specifier continues after a `/`, or a pattern's fixed start (`lib/*`, `^@ui/(.*)$`) the specifier
 * opens with; each of the target's paths with the rest put in the place of its `*` or `$1`, or after it. Matched at the end
 * of a file's path by the caller, so a target written from any folder is found; it only adds files.
 */
function aliasedPathsOf(tree: TreeReader, spec: string): string[] {
  const out: string[] = [];
  for (const a of treeAliasesOf(tree)) {
    if (a.kind !== "alias" && a.kind !== "import-map") continue;
    const key = a.key.replace(/^\^/, "").replace(/\$$/, "");
    const wild = /^(.*?)(?:\(\.[*+]\??\)|\.[*+]|\*)$/.exec(key);
    const bare = key.replace(/\/$/, "");
    let rest: string | null = null;
    if (wild) rest = spec.startsWith(wild[1]) ? spec.slice(wild[1].length) : null;
    else if (spec === key) rest = "";
    else if (bare !== "" && spec.startsWith(`${bare}/`)) rest = spec.slice(bare.length + 1);
    if (rest === null) continue;
    for (const target of a.target.split(/\s+/)) {
      if (target === "" || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const base = target.replace(/^<rootDir>\/?/, "");
      out.push(/\*|\$\d/.test(base) ? base.replace(/\*|\$\d/, rest) : rest === "" ? base : `${base.replace(/\/$/, "")}/${rest}`);
    }
  }
  return out;
}

/** The files of the repository a file imports, as `wrapperTie` reads them. */
const LOCAL_IMPORTS = new WeakMap<TreeReader, Map<string, string[]>>();
function localImportsOf(tree: TreeReader, file: string): string[] {
  const byFile = LOCAL_IMPORTS.get(tree) ?? new Map<string, string[]>();
  LOCAL_IMPORTS.set(tree, byFile);
  const known = byFile.get(file);
  if (known) return known;
  const lines = tree.lines(file);
  const stems = scriptStemsOf(tree);
  const tails = stemTailsOf(tree);
  const found = new Set<string>();
  const atEnd = (tail: string): void => {
    // a path written from the root or a folder (`/src/x`, `./src/x`) too.
    const clean = tail.replace(/^(?:\.{1,2}\/|\/)+/, "").replace(SCRIPT_EXTENSION, "").replace(/\/$/, "");
    if (clean === "" || clean === "." || clean === "..") return;
    for (const stem of tails.get(clean.slice(clean.lastIndexOf("/") + 1)) ?? []) if (stem === clean || stem.endsWith(`/${clean}`)) for (const f of stems.get(stem) ?? []) found.add(f);
  };
  for (const spec of lines === null ? [] : importSpecifiersOf(lines.join("\n"))) {
    if (/^\.\.?(?:\/|$)/.test(spec)) {
      const joined = posix.normalize(posix.join(posix.dirname(file), spec)).replace(SCRIPT_EXTENSION, "").replace(/\/$/, "");
      for (const f of stems.get(joined === "." ? "" : joined) ?? []) found.add(f);
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(spec)) continue;
    const prefixed = /^(?:[@~#$][^/]*\/|#)(.+)$/.exec(spec);
    if (prefixed) atEnd(prefixed[1]);
    // every other specifier as a path's end, one
    // segment included (`baseUrl`'s `'consent'`), and every path the repository's alias table leads it to.
    atEnd(spec);
    for (const path of aliasedPathsOf(tree, spec)) atEnd(path);
  }
  const out = [...found].sort();
  byFile.set(file, out);
  return out;
}

/**
 * One place a replayed search found: `at` as the replay
 * gives it, the `file` it is in, and the folded text that may name a package - the line for a Grep, the listed path for a
 * Glob. A Glob's `at` is a path with no line; it was read
 * as a file one character short with no text, so a Glob never tied a verdict to a package.
 */
interface SearchPlace {
  at: string;
  file: string;
  folded: string;
}

function searchPlacesOf(tree: TreeReader, row: RestsOnSearch, at: readonly string[]): SearchPlace[] {
  if (row.tool === "glob") return at.map((path) => ({ at: path, file: path, folded: foldName(path) }));
  return at.map((place) => {
    const cut = place.lastIndexOf(":");
    const file = place.slice(0, cut);
    return { at: place, file, folded: foldName(tree.lines(file)?.[Number(place.slice(cut + 1)) - 1] ?? "") };
  });
}

/** Each search's replayed lines, folded, once per tree and search; null where it cannot be replayed here. */
const SEARCH_LINES = new WeakMap<TreeReader, Map<string, SearchPlace[] | null>>();
function searchLinesOf(tree: TreeReader, row: RestsOnSearch): SearchPlace[] | null {
  const byKey = SEARCH_LINES.get(tree) ?? new Map<string, SearchPlace[] | null>();
  SEARCH_LINES.set(tree, byKey);
  const key = JSON.stringify([row.pattern, row.scope, row.flags, row.tool ?? null, row.glob ?? null, row.engine ?? null, row.input ?? null]);
  if (byKey.has(key)) return byKey.get(key) ?? null;
  let out: SearchPlace[] | null = null;
  // Only a search this replay runs as the host did: one the host's own engine ran, or one that was never replayable, is not.
  if (row.engine === undefined && row.input === undefined && row.unreplayable === undefined) {
    const replayed = replaySearch(tree, row.pattern, row.scope as never, row.flags, row.tool, { at: true, ...(row.glob !== undefined ? { glob: row.glob } : {}) });
    if (!("unreplayable" in replayed) && replayed.at) out = searchPlacesOf(tree, row, replayed.at);
  }
  byKey.set(key, out);
  return out;
}

/**
 * The places THE REPLAY THAT STANDS FOR THE HOST'S OWN SEARCH
 * found: `replayRecorded`, the one the search premise compares - the host's engine where the row used it, else today's
 * replay only where it reads every file the host's search could have. Null where none stands here, and where the
 * pattern reads otherwise than ripgrep's on some line of the scope (`dialect`): which lines the host's search found
 * there is not known. Once per tree and row.
 */
const STANDING_LINES = new WeakMap<TreeReader, Map<string, SearchPlace[] | null>>();
function standingLinesOf(tree: TreeReader, row: RestsOnSearch): SearchPlace[] | null {
  const byKey = STANDING_LINES.get(tree) ?? new Map<string, SearchPlace[] | null>();
  STANDING_LINES.set(tree, byKey);
  const { for: _for, ...identity } = row;
  const key = JSON.stringify(identity);
  if (byKey.has(key)) return byKey.get(key) ?? null;
  let out: SearchPlace[] | null = null;
  if (row.unreplayable === undefined) {
    const replayed = replayRecorded(tree, row, { at: true });
    if (!("unreplayable" in replayed) && replayed.at !== undefined && replayed.dialect === undefined) out = searchPlacesOf(tree, row, replayed.at);
  }
  byKey.set(key, out);
  return out;
}

/** A file's whole text, folded (`foldName`), once per tree; null where it cannot be read. */
const FOLDED_FILES = new WeakMap<TreeReader, Map<string, string | null>>();
function foldedFileOf(tree: TreeReader, rel: string): string | null {
  const byFile = FOLDED_FILES.get(tree) ?? new Map<string, string | null>();
  FOLDED_FILES.set(tree, byFile);
  if (byFile.has(rel)) return byFile.get(rel) ?? null;
  const lines = tree.lines(rel);
  const out = lines === null ? null : foldName(lines.join("\n"));
  byFile.set(rel, out);
  return out;
}

/**
 * WHETHER ONE SEARCH A VERDICT RAN TIES IT TO A PACKAGE (rule 4
 * of `packageChangeCounts`), and why, or null. The same for a package the inventory counts imports of and for one it
 * counts none of: the inventory counts imports, and a package loaded another way (a `<script src>` tag, a name in a
 * configuration file, a copy under `node_modules`) is found by a search like any other. Three reasons, each only adding
 * to the others, so nothing that counted before stops counting:
 *   (a) the replay this rule always ran (`searchLinesOf`, the scanner's own walk): a place it found names the package, or
 *       lies in a file that holds a listed call site of it or names it; where it cannot replay the row, a package with a
 *       listed call site counts, as before;
 *   (b) the replay that stands for the host's own search (`standingLinesOf`): its places, read as in (a). The scanner's
 *       walk leaves out tests, lock files, hidden folders and `node_modules`, which the host's search reads, and a row
 *       captured from the host's own call is never replayed by (a) at all;
 *   (c) where no replay stands for the host's search here, any file below its scope in the tree's plain listing (every
 *       file, ignored ones included: wider than the host's search, never narrower) that holds a listed call site of it or
 *       names it: the host's search could have returned lines from it. A scope that cannot be placed, or a tree that
 *       cannot be listed, counts.
 */
function searchTiesPackage(row: RestsOnSearch, now: InventoryPackageNow, named: (folded: string) => boolean, tree: TreeReader): string | null {
  const walked = searchLinesOf(tree, row);
  if (walked === null) {
    if (now.call_site_count > 0) return `a search the verdict ran (${row.pattern}) cannot be replayed here to see whether it finds it`;
  } else {
    const why = placesTie(row, walked, now, named, tree);
    if (why !== null) return why;
  }
  const standing = standingLinesOf(tree, row);
  if (standing !== null) return placesTie(row, standing, now, named, tree);
  return reachableTie(row, now, named, tree);
}

/** (a) and (b) of `searchTiesPackage`: the places a replay found. The Glob reason. */
function placesTie(row: RestsOnSearch, found: readonly SearchPlace[], now: InventoryPackageNow, named: (folded: string) => boolean, tree: TreeReader): string | null {
  const hit = found.find((x) => named(x.folded));
  if (hit) {
    return row.tool === "glob"
      ? `a search the verdict ran (${row.pattern}) lists ${hit.at}, whose path names it`
      : `a search the verdict ran (${row.pattern}) finds a line that names it at ${hit.at}`;
  }
  // A file the search found a line in was searched: it counts as a file read (a listed call site, or the file names it).
  for (const file of [...new Set(found.map((x) => x.file))].sort()) {
    if (now.call_sites.includes(file)) return `a search the verdict ran (${row.pattern}) finds lines in ${file}, where the inventory lists a call site of it`;
    const text = foldedFileOf(tree, file);
    if (text !== null && named(text)) return `a search the verdict ran (${row.pattern}) finds lines in ${file}, which names it`;
  }
  return null;
}

/** (c) of `searchTiesPackage`. The reasons. */
function reachableTie(row: RestsOnSearch, now: InventoryPackageNow, named: (folded: string) => boolean, tree: TreeReader): string | null {
  const where = scopeNowOf(tree.root, row);
  if ("unreplayable" in where) return `a search the verdict ran (${row.pattern}) cannot be replayed here, and where it searched cannot be placed in this tree`;
  // A path the tree no longer holds: nothing there names it now.
  if (where.at === "missing") return null;
  const listing = tree.plainFiles();
  if ("problem" in listing) return `a search the verdict ran (${row.pattern}) cannot be replayed here, and no listing of the tree shows what it could have searched`;
  const scope = where.scope;
  const inScope = (rel: string): boolean => scope === "" || rel === scope || rel.startsWith(`${scope}/`);
  // The manifests that declare it first: each names it, so a search of the whole tree is settled at once.
  const ordered = [...new Set([...now.declared_in, ...now.call_sites, ...listing.files, ...listing.links])].filter(inScope);
  for (const file of ordered) {
    if (now.call_sites.includes(file)) return `a search the verdict ran (${row.pattern}) cannot be replayed here, and ${file}, which it could have searched, holds a call site of it`;
    const text = foldedFileOf(tree, file);
    // A link to a folder, a broken link, or a file that cannot be read: what it holds is not known.
    if (text === null) return `a search the verdict ran (${row.pattern}) cannot be replayed here, and ${file}, which it could have searched, cannot be read`;
    if (named(text) || named(foldName(file))) return `a search the verdict ran (${row.pattern}) cannot be replayed here, and ${file}, which it could have searched, names it`;
  }
  return null;
}

/** The npm `name` of a manifest in the tree; null where it names none, undefined where it cannot be read. */
function workspaceNameOf(tree: TreeReader, manifest: string): string | null | undefined {
  const lines = tree.lines(manifest);
  if (lines === null) return undefined;
  try {
    const parsed = JSON.parse(lines.join("\n")) as { name?: unknown };
    return typeof parsed?.name === "string" && parsed.name !== "" ? parsed.name : null;
  } catch {
    return undefined;
  }
}

/** Whether a package the inventory does not list (a workspace's own) is named by the verdict or a file it read. */
function nameReached(name: string, reach: VerdictReach, tree: TreeReader): string | null {
  const forms = packageNameForms(name);
  if (forms.some((f) => reach.text.includes(f))) return "the verdict's own record names it";
  for (const file of [...reach.files].sort()) {
    const lines = tree.lines(file);
    if (lines !== null && forms.some((f) => foldName(lines.join("\n")).includes(f))) return `${file}, which the verdict read, names it`;
  }
  return null;
}

/**
 * THE COMPARISON, one premise kind at a time and in `PREMISE_ORDER`.
 *
 * It returns the FIRST kind that differs, so that the reason a candidate is re-adjudicated is one
 * named premise. A candidate whose rule changed and whose files also changed is reported under the
 * rule, because that is the change that makes every other comparison beside the point.
 */
export function firstChangedPremise(
  previous: RestsOn,
  candidate: Candidate,
  args: {
    tree: TreeReader;
    rules: Map<string, Rule>;
    bundleVersion: string;
    bundleFiles?: Record<string, string>;
    /** The answers THIS run settles, by rule id, from `answersFromApplicability`. */
    answers?: Map<string, RestsOnAnswer[]>;
    /** The instructions this run judges by. */
    instructions?: { premise?: InstructionsPremise; problem?: string };
    /** What every seat of this run is handed beside its payload. */
    handed?: RestsOnHanded;
    /** Today's dependency inventory by package. */
    inventory?: ReadonlyMap<string, InventoryPackageNow>;
    /** This run's ships premises by file, compared in `facts`. */
    ships?: ReadonlyMap<string, string>;
    /** This run's `--seat-model`, where one was given. */
    seatModel?: string;
    /** The adjudicator's effort pin today. */
    effortNow?: string | null;
  },
  /** The files the verdict's own record says a seat opened or quoted (`filesReadBySeat`). */
  readBySeat?: ReadonlySet<string>,
  /** What the verdict reached (`verdictReachOf`): read by `handed` to scope a package's change. */
  reach?: VerdictReach,
): { premise: PremiseKind; because: string } | null {
  for (const premise of PREMISE_ORDER) {
    if (premise === "spec") {
      if (previous.spec !== RESTS_ON_SPEC) {
        return {
          premise,
          because: `the premise block was written to spec ${previous.spec} and this run derives ${RESTS_ON_SPEC}, so it is not compared: its digests or its reading were derived under other rules.`,
        };
      }
      continue;
    }
    if (premise === "candidate") {
      const was = previous.candidate?.content_key;
      if (typeof was !== "string" || !was) {
        return {
          premise,
          because: "the verdict records no content key for its candidate, so the thing it was given over cannot be re-derived.",
        };
      }
      const { key } = candidateContentKey(candidate, args.tree);
      if (key !== was) {
        return {
          premise,
          because: `the matched text of this candidate is not the text the verdict was given over: its content key is now ${key.slice(0, 12)} and the verdict rests on ${was.slice(0, 12)}.`,
        };
      }
      continue;
    }
    if (premise === "rule") {
      const today = ruleHash(args.rules.get(previous.rule.id), previous.rule.id);
      if (today !== previous.rule.hash) {
        return {
          premise,
          because: `rule ${previous.rule.id} is not the clause this verdict was given: its digest is now ${today.slice(0, 12)} and the verdict rests on ${previous.rule.hash.slice(0, 12)}.`,
        };
      }
      continue;
    }
    if (premise === "instructions") {
      /* WHAT THE SEAT JUDGED BY. Compared on the digest, which `instructionsDigestOf` re-derives from the
       * recorded components, so a block whose digest does not match its own components is a change, never a match. Today's digest, or today's agent text and skill under a version today's is
       * declared to judge as (`instructionsDigestsAlike`, the one derivation `verdictRulesJudgedAs`): a block judged under
       * such a version carries exactly as one judged under today's; one under any other version matches nothing. */
      const today = args.instructions?.premise;
      if (!today) {
        return {
          premise,
          because: `this run cannot digest the instructions it judges by (${args.instructions?.problem ?? "none were handed to the comparison"}), so no verdict is carried.`,
        };
      }
      const was = previous.instructions;
      if (!was || typeof was.digest !== "string") {
        return {
          premise,
          because: "the verdict records no instructions it was judged by (the agent text, the skill and the program's verdict rules), so it is given again under today's.",
        };
      }
      const selfConsistent =
        typeof was.agent === "string" && typeof was.skill === "string" && typeof was.verdict_rules === "string" && instructionsDigestOf(was) === was.digest;
      /* Past a product update, the releases' own marks decide (`judgedAsThroughMarks`): a verdict carries
       * only where no release since marks its rule's judging as changed, and is given again where one does or none says. */
      const alike = selfConsistent && instructionsDigestsAlike(today).some((x) => x.digest === was.digest);
      const marked = selfConsistent && !alike
        ? judgedAsThroughMarks(
            previous.rule.id,
            (s) => s.agent === today.agent && s.skill === today.skill && s.verdict_rules === today.verdict_rules,
            (s) => s.agent === was.agent && s.skill === was.skill && verdictRulesJudgedAs(s.verdict_rules).includes(String(was.verdict_rules)),
          )
        : null;
      if (marked !== null && marked.carried === false) return { premise, because: marked.because };
      if (marked === null && !alike) {
        const moved = selfConsistent ? instructionsMoved(was, today) : [];
        return {
          premise,
          because:
            moved.length > 0
              ? `the verdict was judged under other instructions: ${moved.join(", ")} changed since, so it is given again under today's.`
              : `the verdict's instructions digest ${String(was.digest).slice(0, 12)} is not today's ${today.digest.slice(0, 12)}, so it is given again under today's.`,
        };
      }
      // A build never released, or another build of today's version.
      const build = verdictRulesBuildMoved(was, today);
      if (build !== null) return { premise, because: build };
      continue;
    }
    if (premise === "handed") {
      /* The profile and the dependency inventory every brief carries; a changed
       * package's declarations counted only for a verdict that rests on that package (`handedChange`). */
      const because = handedChange(previous.handed, args.handed, args, reach);
      if (because !== null) return { premise, because };
      continue;
    }
    if (premise === "facts") {
      /* What the scan computed beyond the matched lines and handed the seat on this candidate and its
       * locations - `corroborated_in_project` above all. A verdict that records none is given again once. */
      const today = scanFactsOf(candidate, args.tree, args.ships);
      const was = previous.facts;
      if (!was || typeof was.digest !== "string") {
        return { premise, because: "the verdict records nothing of the facts the scan handed its seat on the candidate (such as whether the whole tree holds the rule's corroborating vocabulary), so it is given again." };
      }
      if (was.digest !== today.digest) {
        return {
          premise,
          because: `the facts the scan handed the seat on this candidate are not the ones the verdict was given on (${today.fields} fact field(s) now, ${was.fields} then): a whole-tree fact such as \`corroborated_in_project\`, a corroborating file, a definition reached through or a scope assessment moved.`,
        };
      }
      continue;
    }
    if (premise === "effort") {
      /* THE EFFORT THE SEAT RAN AT, from its own transcript. Carried only where it ran at the pin alone. */
      if (!args.effortNow) {
        return { premise, because: "this run cannot read the effort the adjudicator's agent file pins, so nothing says what level a seat would run at: no verdict is carried." };
      }
      const was = previous.effort;
      if (!Array.isArray(was) || was.length === 0) {
        return { premise, because: `the verdict records no effort level its seat ran at, so it is given again at ${args.effortNow}.` };
      }
      if (was.length !== 1 || was[0] !== args.effortNow) {
        return { premise, because: `the verdict's seat ran at ${was.join(", ")} and a seat runs at ${args.effortNow} now (the adjudicator's pin), so it is given again.` };
      }
      continue;
    }
    if (premise === "model") {
      /* THE MODEL THE SEAT RAN ON, for a verdict not read place by place. A place-plan candidate
       * compares it on each place's row and on its answer seat's own premises, below the block. A verdict that records
       * none (captured by an earlier version, or by a capture given no launch entry) is given again once, as one that records
       * no instructions is. */
      if (isPlacePlan(candidate)) continue;
      const now = modelNowOf(candidate, args.seatModel);
      const was = previous.model;
      if (typeof was !== "string" || !was) {
        return { premise, because: `the verdict records no model its seat ran on, so it is given again on ${now}.` };
      }
      if (was !== now) {
        return { premise, because: `the verdict was given on ${was} and its seat would run on ${now} now, so it is given again on ${now}.` };
      }
      continue;
    }
    if (premise === "answers") {
      /* UNIT F'S SETTLED ANSWERS. The identity of a row is its rule and its question; its digest is
       * over the answer, the profile field and the value that field held. Absent on both sides is
       * not a change - a document from before unit F, compared by a run that settles nothing, has no
       * answer premise at all - but absent on ONE side is, in either direction. */
      const today = args.answers?.get(previous.rule.id) ?? [];
      const was = previous.answers ?? [];
      if (today.length === 0 && was.length === 0) continue;
      const shorten = (question: string): string =>
        question.length <= 70 ? question : `${question.slice(0, 70)}...`;
      if (was.length === 0) {
        return {
          premise,
          because: `this run settles ${today.length} per-rule answer(s) for ${previous.rule.id} out of the declaration and this verdict records none, so the answer it was given is not on the record and cannot be re-derived.`,
        };
      }
      if (today.length === 0) {
        return {
          premise,
          because: `this verdict rests on ${was.length} settled per-rule answer(s) for ${previous.rule.id} and this run settles none, so they cannot be reproduced.`,
        };
      }
      const rowKey = (row: RestsOnAnswer): string => JSON.stringify([row.rule_id, row.question]);
      const unmatched = new Map(was.map((row) => [rowKey(row), row]));
      for (const row of today) {
        const before = unmatched.get(rowKey(row));
        if (!before) {
          return {
            premise,
            because: `this run settles the question ${JSON.stringify(shorten(row.question))} for ${row.rule_id} and the verdict records no answer to it.`,
          };
        }
        unmatched.delete(rowKey(row));
        if (before.digest !== row.digest) {
          return {
            premise,
            because: `the answer to ${JSON.stringify(shorten(row.question))} is not the answer this verdict rests on: it is now ${row.digest.slice(0, 12)} read from ${row.source} and the verdict rests on ${before.digest.slice(0, 12)} read from ${before.source}.`,
          };
        }
      }
      if (unmatched.size > 0) {
        const first = [...unmatched.values()][0]!;
        return {
          premise,
          because: `this verdict rests on ${unmatched.size} answer(s) this run no longer settles, the first being ${JSON.stringify(shorten(first.question))} for ${first.rule_id}.`,
        };
      }
      continue;
    }
    if (premise === "census") {
      const census = kindCensusOf(candidate);
      const today = census ? censusContentHash(census) : null;
      const was = previous.census?.content_hash ?? null;
      if (today !== was) {
        return {
          premise,
          because:
            was === null
              ? "this candidate now carries a kind census and the verdict was given over one that had none, so what it covers has changed."
              : today === null
                ? "this candidate no longer carries a kind census, so the groups the verdict's trail names are not there to check."
                : "the candidate's census has changed - a group, a member count or the order of the groups is not what the verdict's trail was written against.",
        };
      }
      continue;
    }
    if (premise === "files") {
      /* "which a seat read" is said only of a file a seat read. The block's files are the files the
       * seat's rows, evidence and sight name, the files of the members its rows are credited to, and - for a verdict
       * not read place by place - every file the candidate matched (rests-on.ts `buildRestsOn`), which no seat need
       * have opened: its payload handed it a window. The block does not say which is which, so a file this candidate
       * matches is said to be read by a seat only where the verdict's own record names it (`filesReadBySeat`). The
       * files premise is compared only after the candidate's content key, which names the files it matched, so the
       * candidate's files here are the ones the verdict's candidate matched. */
      const matchedFiles = new Set((candidate.locations ?? []).map((loc) => loc.file));
      const which = (path: string): string => (!matchedFiles.has(path) || readBySeat?.has(path) ? "which a seat read" : "which the candidate matched");
      for (const file of previous.files) {
        const today = args.tree.sha256(file.path);
        if (file.missing || !file.sha256) {
          return { premise, because: `the verdict records ${file.path}, ${which(file.path)}, without a digest, so it cannot be re-checked.` };
        }
        if (today === null) return { premise, because: `${file.path}, ${which(file.path)}, is not in this tree.` };
        if (today !== file.sha256) return { premise, because: `${file.path}, ${which(file.path)}, has changed.` };
      }
      continue;
    }
    // `searches`
    for (const search of previous.searches) {
      if (search.unreplayable || !search.hit_hash) {
        return { premise, because: `a recorded search cannot be replayed: ${search.unreplayable ?? "it carries no hit-set digest"}.` };
      }
      // Replayed as recorded: its glob, its engine, the input it was taken from (rests-on.ts `replayRecorded`).
      const replayed = replayRecorded(args.tree, search);
      if ("unreplayable" in replayed) {
        return { premise, because: `a recorded search no longer replays: ${replayed.unreplayable}` };
      }
      if (replayed.hit_hash !== search.hit_hash) {
        return {
          premise,
          because: `the search for ${JSON.stringify(search.for.slice(0, 60))} now returns ${replayed.hits} line(s) where it returned ${search.hits}, or returns different lines.`,
        };
      }
      // C2-4: a line on which ripgrep and the replay read the pattern differently, added or changed since.
      const moved = dialectMoved(search, replayed);
      if (moved) return { premise, because: moved };
    }
  }
  const md5 = bundleMd5(args.bundleFiles);
  if ((md5 && previous.bundle.md5 && md5 !== previous.bundle.md5) || previous.bundle.version !== args.bundleVersion) {
    /* The md5 AND THE VERSION are RECORDED and not compared: the md5 covers every rule
     * in the bundle, and a version derived from the bundle's content does too, so comparing either would
     * re-adjudicate every verdict of every rule whenever any one rule was edited, and the bound this unit was given
     * scopes a rule change to that rule. The per-rule digest and the instructions digest above are what carry the
     * bound. Nothing is returned here; the line exists so a reader looking for the comparison finds the reason it is
     * absent. */
  }
  return null;
}

/**
 * Every premise of `PREMISE_ORDER` in the words a carried row says it reproduced. Keyed by
 * the kinds `firstChangedPremise` walks, so a premise the comparison gains cannot be missing from what the row says
 * (the sentence had kept its own list, without `facts` and `effort`, both compared). Each is true of a
 * block that was carried: a premise compared place by place on a candidate read so says so.
 */
export function carriedPremiseWords(block: RestsOn, placePlan: boolean): Record<PremiseKind, string> {
  // A block judged under a version today's is declared to judge as says so, and
  // which records declare it: "the instructions it was judged by" alone would claim the version itself was reproduced.
  const alike = typeof block.instructions?.verdict_rules === "string" ? verdictRulesAlikeWords(block.instructions.verdict_rules) : null;
  return {
    spec: `the spec its premise block was written to (${block.spec})`,
    candidate: "the candidate's content key",
    rule: `rule ${block.rule.id}'s clause digest`,
    instructions: alike
      ? `the instructions it was judged by (the adjudicator's agent text and the legal-scan skill as they are today, and the program's verdict rules ${alike})`
      : "the instructions it was judged by",
    handed: block.handed ? "the profile and dependency inventory its seat was handed" : "its seat's having been handed no profile or dependency inventory, as this comparison hands none",
    facts: "the facts the scan handed its seat on the candidate",
    model: placePlan ? "the model each place's review ran on, compared place by place" : `the model ${String(block.model)} its seat ran on`,
    effort: `the effort level its seat ran at (${(block.effort ?? []).join(", ")})`,
    answers: block.answers && block.answers.length > 0 ? `${block.answers.length} settled per-rule answer(s)` : "no settled per-rule answer, as it rested on none",
    census: block.census ? "its kind census" : "its having no kind census, as it had none then",
    files: `${block.files.length} file(s) read`,
    searches: `${block.searches.length} search(es) replayed`,
  };
}

/**
 * The carried record's own audit note. Where the verdict was
 * judged under a version today's is declared to judge as, the verdict rules did move, and the note says so and by what -
 * "nothing has moved" would then be false on the record itself.
 */
function carriedNote(block: RestsOn): string {
  const was = block.instructions?.verdict_rules;
  const alike = typeof was === "string" && was !== VERDICT_RULES_VERSION ? verdictRulesAlikeWords(was) : null;
  return alike
    ? `Carried, not re-verified: nothing this comparison can see has moved but the program's verdict rules - the verdict was judged under ${alike} - and no seat read this candidate in this run.`
    : "Carried, not re-verified: nothing this comparison can see has moved, and no seat read this candidate in this run.";
}

/** A carried row's sentence, from `carriedPremiseWords` in `PREMISE_ORDER` and nothing else's list. */
function carriedBecause(scanId: string, block: RestsOn, placePlan: boolean): string {
  const words = carriedPremiseWords(block, placePlan);
  const parts: string[] = PREMISE_ORDER.map((premise) => words[premise]);
  if (block.answer) {
    parts.push(`the answer seat's own premises (the fold it was given, ${block.answer.files.length} file(s) it Read, ${block.answer.searches.length} search(es) it ran)`);
  }
  const alike = typeof block.instructions?.verdict_rules === "string" && block.instructions.verdict_rules !== VERDICT_RULES_VERSION;
  return `every premise of the verdict of scan ${scanId} is reproduced exactly${alike ? " (the program's verdict rules by a declared equivalence)" : ""}: ${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}. The bundle's version and md5 are recorded and not compared.`;
}

/** Split the new scan's candidates into the ones already answered and the ones that need a seat. */
export function partition(args: PartitionArgs): PartitionResult {
  const { tree } = args;

  // Previous verdicts, indexed by the content key their own premise block recorded - the identity,
  // and the only index a carry can come through. Two finding-id indexes sit beside it:
  //   - records with NO premise block, held aside so that they are reported with their own reason
  //     (`previous-premises-missing`) rather than being silently absent. This is the fallback's
  //     stated purpose, and it is now the whole of it;
  //   - records WITH a block, consulted only after the key has missed (or where every
  //     verdict of the key went to another candidate), and only so that the change is NAMED:
  //     `candidate` is the first premise compared, so a record reached this way always comes out
  //     `premise-changed`/`candidate` and is never carried. EACH FINDING-ID INDEX IS HELD BY THE ONE RULE (rests-on.ts `holdersByKey`) - the
  //   smallest finding id, then the record's canonical text, its source and its scan. Each was a `Map.set` per verdict, so
  //   the LAST listed held a key: which verdict was carried, compared or called gone depended on the listing order. The content key's verdicts are not held by one: they are PAIRED with the key's candidates (`pairByKey`).
  const blockOf = (prev: PreviousVerdict): RestsOn | null => restsOnOf(prev.record);
  const keyOfVerdict = (prev: PreviousVerdict): string | null => {
    const key = blockOf(prev)?.candidate?.content_key;
    return typeof key === "string" && key ? key : null;
  };
  const byFindingWithoutBlock = holdersByKey(args.previous, (prev) => (blockOf(prev) ? [] : [[prev.finding_id, null] as const]));
  const byFindingWithBlock = holdersByKey(args.previous, (prev) => (blockOf(prev) ? [[prev.finding_id, null] as const] : []));

  const rows: PartitionRow[] = [];
  const carried: { finding_id: string; record: Record<string, unknown> }[] = [];
  /* The earlier verdicts compared, by the verdict itself (two of one finding id are two verdicts), and how
   * each candidate reached one: what the verdicts not compared are told (`NOT_COMPARED_WORDS`) is read from these. */
  const matched = new Set<PreviousVerdict>();
  const keysAsked = new Set<string>();
  const byFindingRoute = new Map<string, { verdict: PreviousVerdict; keyHad: "none" | "paired" | "unplaced" }>();
  const answeredBy = new Map<string, PreviousVerdict>();

  /* Build unit F5: every place an earlier verdict recorded, by its content key, and the verdict that holds it where two
   * do: the one with the smallest finding id. CHOSEN, NOT SORTED (a sort's comparator had an arm V8 never
   * reads). By `holdersByKey`; a verdict never displaces itself, so of two rows one block lists under one key
   * the first holds. A paired candidate's places are compared with its own verdict's rows first (`ownRowsOf`),
   * and with these only where that verdict records none for the place. */
  const earlier = new Map<string, { place: PlacePremises; block: RestsOn; prev: PreviousVerdict }>();
  const placeHolders = holdersByKey(args.previous, (prev) => {
    const block = blockOf(prev);
    if (!block) return [];
    return placePremisesOfBlock(block)
      .filter((place) => place.key)
      .map((place) => [place.key, { place, block, prev }] as const);
  });
  for (const [key, { value }] of placeHolders) earlier.set(key, value);
  const placesOf = new Map<string, NonNullable<PartitionRow["places"]>>();

  /* WITHIN ONE CONTENT KEY, EACH CANDIDATE IS PAIRED WITH ITS OWN EARLIER VERDICT (rests-on.ts `pairByKey`):
   * the same finding id, then the same places, then the one rule for what is left on both sides. Two candidates of one
   * key were both handed the key's one holder, so the second was carried the first one's verdict while its own existed. */
  const ordered = inKeyOrder(args.candidates, (c) => c.finding_id);
  const contentKeyOf = new Map(ordered.map((c) => [c, candidateContentKey(c, tree).key] as const));
  const placesTextOf = (prev: PreviousVerdict): string => {
    const block = blockOf(prev);
    const listed = block && Array.isArray(block.places) ? block.places : [];
    const rows = placePremisesOfBlock(block);
    return rows.length === listed.length ? placesText(rows.map((p) => p.key || null)) : "";
  };
  const placesText = (keys: (string | null)[]): string => (keys.length === 0 || keys.some((k) => !k) ? "" : JSON.stringify([...new Set(keys as string[])].sort()));
  const placesOfCandidate = (c: Candidate): string => placesText((c.locations ?? []).map((loc) => placeKeyOf(c.rule_id, loc.file, loc.start_line, tree.lines(loc.file))?.key ?? null));
  const pairing = pairByKey({
    candidates: ordered,
    previous: args.previous,
    keyOfCandidate: (c) => contentKeyOf.get(c) ?? candidateContentKey(c, tree).key,
    keyOfVerdict,
    placesOfCandidate,
    placesOfVerdict: (prev) => placesTextOf(prev),
    // A verdict read place by place lists its places, keyed or not.
    listsPlaces: (prev) => {
      const block = blockOf(prev);
      return !!block && Array.isArray(block.places) && block.places.length > 0;
    },
  });
  /* A place-plan candidate's places are compared first with the rows of the verdict it is paired with, then with any
   * verdict's (`earlier`): a place keeps its identity across verdicts, and the verdict compared reads its own rows. */
  const ownRowsOf = (prev: PreviousVerdict | undefined): Map<string, { place: PlacePremises; block: RestsOn; prev: PreviousVerdict }> => {
    const own = new Map<string, { place: PlacePremises; block: RestsOn; prev: PreviousVerdict }>();
    const block = prev ? blockOf(prev) : null;
    if (prev && block) for (const place of placePremisesOfBlock(block)) if (place.key && !own.has(place.key)) own.set(place.key, { place, block, prev });
    return own;
  };

  for (const candidate of ordered) {
    const key = contentKeyOf.get(candidate) ?? "";
    const paired = pairing.pairOf.get(candidate)?.verdict;
    if (isPlacePlan(candidate)) {
      const own = ownRowsOf(paired);
      placesOf.set(candidate.finding_id, placeOutcomes(candidate, args, (k) => own.get(k) ?? earlier.get(k)));
    }
    const base = { finding_id: candidate.finding_id, rule_id: candidate.rule_id, content_key: key };
    keysAsked.add(key);
    const keyHad = pairing.verdictsOfKey.get(key) ?? 0;
    // Candidates and verdicts of its key were left, and nothing recorded places any verdict on it.
    const unplaced = pairing.unplacedCandidates.get(candidate);
    const byFinding = paired ? undefined : (byFindingWithoutBlock.get(candidate.finding_id)?.holder ?? byFindingWithBlock.get(candidate.finding_id)?.holder);
    const prev = paired ?? byFinding;
    if (byFinding) byFindingRoute.set(candidate.finding_id, { verdict: byFinding, keyHad: unplaced ? "unplaced" : keyHad > 0 ? "paired" : "none" });
    if (prev) answeredBy.set(candidate.finding_id, prev);
    if (!prev) {
      rows.push({
        ...base,
        outcome: "adjudicate",
        reason: "new-candidate",
        because: unplaced
          ? NOT_COMPARED_WORDS.newUnplaced(unplaced.candidates, unplaced.verdicts)
          : keyHad > 0
            ? NOT_COMPARED_WORDS.newBesidePaired(keyHad)
            : "no verdict of the previous run has this candidate's content key, so nothing has answered it.",
      });
      continue;
    }
    matched.add(prev);
    // Every row below that hands the candidate to a seat again names the places its previous verdict left
    // unread, whatever the reason it is not carried; a carried row never has any (the unread check refuses it first).
    const previousNotChecked = previousNotCheckedOf(candidate, prev);
    const withPrev = {
      ...base,
      from_scan: prev.scan_id,
      from_finding_id: prev.finding_id,
      ...(previousNotChecked ? { previous_not_checked: previousNotChecked } : {}),
    };

    const block = restsOnOf(prev.record);
    if (!block) {
      rows.push({
        ...withPrev,
        outcome: "adjudicate",
        reason: "previous-premises-missing",
        because: "the previous verdict records no premise block, so there is nothing to re-check it against.",
      });
      continue;
    }
    if (block.complete !== true) {
      rows.push({
        ...withPrev,
        outcome: "adjudicate",
        reason: "previous-premises-incomplete",
        because: `the previous verdict's premise block is incomplete: ${(block.incomplete ?? ["no reason recorded"]).join(" ")}`,
      });
      continue;
    }
    /* THE SET, WHOLE OR NOT AT ALL. A finding's placement rests on its verdict, its
     * refutation and its second look (verdict-set.ts); the carried record is the earlier record whole, so it carries every
     * kind that record holds. A kind the earlier run owed and did not answer, or kept apart from the record, would be lost
     * on the way: such a finding is judged again, never carried without it. */
    const set = verdictSetOf(prev.record, prev.set_apart);
    if (set.missing.length > 0) {
      rows.push({
        ...withPrev,
        outcome: "adjudicate",
        reason: "previous-set-incomplete",
        because: `the earlier verdict is not carried without the rest of its records: ${set.missing.map((m) => m.why).join("; ")}.`,
      });
      continue;
    }
    /* A block that records premises its seat's own transcript could not give is never carried, by that
     * reason - whatever its other premises say (its sight is empty, which is not "the seat opened nothing"). Present at
     * all is enough: the assembly never writes an empty list, and a value that is not a list cannot say what is missing. */
    if (block.untaken !== undefined) {
      const why = Array.isArray(block.untaken) && block.untaken.length > 0 ? block.untaken.join(" ") : "the block says so without saying which.";
      rows.push({
        ...withPrev,
        outcome: "adjudicate",
        reason: "previous-premises-untaken",
        because: `the previous verdict's seat could not be read for premises the verdict rests on, so nothing can be compared: ${why}`,
      });
      continue;
    }
    if (kindCensusOf(candidate)) {
      const unread = unreadLocations(prev.record);
      if (unread === null) {
        rows.push({
          ...withPrev,
          outcome: "adjudicate",
          reason: "previous-reading-missing",
          because:
            "this candidate is read by kinds and the previous verdict carries no reading block that says what was left unread " +
            "(no block, a `not_read` that is absent or not a list, or a row whose `members` is not a count), so nothing records what was opened.",
        });
        continue;
      }
      if (unread > 0) {
        rows.push({
          ...withPrev,
          outcome: "adjudicate",
          reason: "previous-reading-left-locations-unread",
          because: `the previous verdict left ${unread} matched location(s) unread, and carrying it forward would carry that silence into a run that looks settled.`,
        });
        continue;
      }
    }

    /* A record that names unread places is never carried, read by kinds or not. The check above reads a
     * census candidate's block; this one reads what `notCheckedOf` reads, so a record whose rows locate places on a
     * candidate with no census cannot carry them into a run that looks settled either. */
    if (previousNotChecked && previousNotChecked.places > 0) {
      rows.push({
        ...withPrev,
        outcome: "adjudicate",
        reason: "previous-reading-left-locations-unread",
        because: `the previous verdict left ${previousNotChecked.places} place(s) unread, and carrying it forward would carry that silence into a run that looks settled.`,
      });
      continue;
    }

    const reach = verdictReachOf(prev.record, block, candidate);
    const changed = firstChangedPremise(block, candidate, args, filesReadBySeat(prev.record), reach);
    if (changed) {
      rows.push({ ...withPrev, outcome: "adjudicate", reason: "premise-changed", premise: changed.premise, because: changed.because });
      continue;
    }

    /* Build unit F5: a place-plan candidate's verdict is carried whole only where every one of its places is. */
    const places = placesOf.get(candidate.finding_id);
    if (places && (places.read > 0 || places.outcomes.length === 0)) {
      const first = places.outcomes.find((o) => o.outcome === "read");
      rows.push({
        ...withPrev,
        outcome: "adjudicate",
        reason: "places-changed",
        because: first
          ? `${places.read} of ${places.outcomes.length} place(s) are to be read again (the first, ${first.file}:${first.line}: ${first.because}); the verdict is given again over its places.`
          : "the candidate has no place to compare.",
      });
      continue;
    }

    /* VA-5: an answer seat's answer is carried only on its own premises as well - the fold this run would hand
     * it over the carried places, and the files and searches of its own transcript, replayed as a place's are. One that
     * no longer holds sends the candidate to a fresh answer seat over the carried places (carried-places.ts launches
     * it even when none of its place seats is launched); it is never shown as checked. A candidate read by one seat has
     * no answer seat: its seat's files and searches are premises of every one of its places, compared above. */
    if (places && isAnswerSeat(candidate)) {
      const foldNow = args.answerFoldNow ? args.answerFoldNow(candidate, places.outcomes) : null;
      const answer = firstChangedAnswerPremise(block.answer, foldNow, tree, modelNowOf(candidate, args.seatModel));
      if (answer) {
        rows.push({ ...withPrev, outcome: "adjudicate", reason: "answer-changed", because: `every place is carried, but the earlier answer is not: ${answer.because}` });
        continue;
      }
    }

    /* A4 again before a place-plan answer is carried whole - a `not_applicable` over a carried
     * place that is kept or undetermined (or a place with no carried row) is never carried as clean, whatever path wrote
     * the record (the capture refuses such a record today; this holds a record that reached the log by any other). */
    if (places) {
      const bar = notApplicableBar(
        prev.verdict,
        places.outcomes.map((o) => ({ place: `${o.file}:${o.line}`, ...(o.row?.decision ? { decision: o.row.decision } : {}) })),
      );
      if (bar) {
        rows.push({ ...withPrev, outcome: "adjudicate", reason: "previous-answer-fails-a4", because: `the earlier answer is not carried: ${bar.split(". Answer")[0]}.` });
        continue;
      }
    }

    const untouched = reach.packagesMovedUntouched ?? [];
    rows.push({
      ...withPrev,
      outcome: "carried",
      reason: "carried",
      because:
        carriedBecause(prev.scan_id, block, isPlacePlan(candidate)) +
        // The carry past a changed package, said on the row (visible, not silent: the design's later item 2D).
        (untouched.length > 0
          ? ` Carried although the declarations of ${untouched.length} package(s) changed (${untouched.slice(0, 5).join(", ")}${untouched.length > 5 ? `, and ${untouched.length - 5} more` : ""}): the verdict neither names them nor read, quoted or searched a line that calls or names them.`
          : ""),
      ...(untouched.length > 0 ? { packages_changed_not_rested_on: untouched } : {}),
    });
    carried.push({
      finding_id: candidate.finding_id,
      record: {
        ...prev.record,
        finding_id: candidate.finding_id,
        carried_forward_from: prev.scan_id,
        carried_forward: {
          scan_id: prev.scan_id,
          finding_id: prev.finding_id,
          source: prev.source,
          premises_rechecked: PREMISE_ORDER.filter((p) => p !== "spec"),
          files_rechecked: block.files.length,
          searches_replayed: block.searches.length,
          note: carriedNote(block),
        },
      },
    });
  }

  for (let i = 0; i < rows.length; i++) {
    const places = placesOf.get(rows[i]!.finding_id);
    if (places) rows[i] = { ...rows[i]!, places };
  }

  /* An earlier verdict no candidate was compared with is GONE only where no candidate of
   * this scan could have reached it; one a candidate could have reached is NOT CHOSEN, with the sentence of its case. Within a content key the candidates are paired with the verdicts (`pairByKey`), so a verdict of a key a
   * candidate asked for is not chosen either because its own candidate was compared with another earlier verdict of it
   * (`ownTaken`, naming that verdict), or because every candidate of its key was paired with another (`leftOver`, no
   * single verdict to name). Listed in `inHolderOrder`, so neither list depends on the order the earlier run gave. GONE OR NOT CHOSEN IS DECIDED BY ONE SOURCE, `ownFindingOf` - whether this scan raised a candidate
   * with the verdict's finding id, the places it records, or its content key - and never by whether the verdict was
   * paired. Gone was what was left after every route a pairing could take, so a verdict whose own candidate was paired
   * under its new content key with another earlier verdict fell through to gone: the plan, the printed summary and the
   * report's carry line said a possible problem was no longer found while the same finding was in this scan and was
   * being reviewed again. The plan's two lists, the counts the summary prints and the counts the report's carry line
   * gives are all read from these two lists, so they all follow this one decision. The same source picks the sentence
   * of a verdict not chosen: `leftOver` and `unplaced` say its candidate is not found, so they are said only where
   * `ownFindingOf` finds none by finding id or places; a verdict left in its content key whose own candidate is here
   * under another key is told that (`ownOtherKey`, or the finding-id route's sentence where that candidate went there). */
  const candidateOfFinding = new Map(ordered.map((c) => [c.finding_id, c] as const));
  const candidateOfPlaces = new Map<string, Candidate>();
  for (const candidate of ordered) {
    const places = placesOfCandidate(candidate);
    if (places && !candidateOfPlaces.has(places)) candidateOfPlaces.set(places, candidate);
  }
  const keysOfScan = new Set(contentKeyOf.values());
  const ownFindingOf = (prev: PreviousVerdict): { candidate: Candidate; by: "finding" | "place" } | { by: "key" } | null => {
    const byId = candidateOfFinding.get(prev.finding_id);
    if (byId) return { candidate: byId, by: "finding" };
    const places = placesTextOf(prev);
    const byPlaces = places ? candidateOfPlaces.get(places) : undefined;
    if (byPlaces) return { candidate: byPlaces, by: "place" };
    const key = keyOfVerdict(prev);
    return key !== null && keysOfScan.has(key) ? { by: "key" } : null;
  };
  /* What a gone row says beside its sentence: where the finding was, what the earlier log
   * placed it as, why no candidate answers it where the program can tell, and the new places of its rule in the same file. */
  const newOfRuleFile = new Map<string, string[]>();
  for (const r of rows) {
    if (r.reason !== "new-candidate") continue;
    const file = candidateOfFinding.get(r.finding_id)?.locations?.[0]?.file;
    if (!file) continue;
    const k = JSON.stringify([r.rule_id, file]);
    // Appended in place: copying the list at each new id grew with the square of one rule's new places in one file.
    const ids = newOfRuleFile.get(k);
    if (ids) ids.push(r.finding_id);
    else newOfRuleFile.set(k, [r.finding_id]);
  }
  const goneDetailOf = (prev: PreviousVerdict, block: RestsOn | null): Pick<GoneRow, "place" | "earlier_disposition" | "cause" | "same_file"> => {
    const listed = block && Array.isArray(block.places) ? (block.places as unknown[]) : [];
    const first = listed.find((p): p is { file: string } => !!p && typeof p === "object" && typeof (p as { file?: unknown }).file === "string" && (p as { file: string }).file !== "");
    const place = prev.basis?.file ? { file: prev.basis.file, line: prev.basis.line } : first ? { file: first.file, line: null } : null;
    const ruleId = block?.rule?.id ?? "";
    const cause: GoneCause =
      place === null || !block || !ruleId
        ? "unknown"
        : tree.lines(place.file) === null
          ? "file_removed"
          : !args.rules.has(ruleId)
            ? "rule_removed"
            : ruleHash(args.rules.get(ruleId), ruleId) !== block.rule.hash
              ? "rule_changed"
              : "line_changed";
    const disp = prev.record.disposition;
    return {
      place,
      earlier_disposition: typeof disp === "string" && disp ? disp : null,
      cause,
      ...(place ? { same_file: [...(newOfRuleFile.get(JSON.stringify([ruleId || block?.rule?.id || "", place.file])) ?? [])].sort() } : {}),
    };
  };
  const gone: GoneRow[] = [];
  const notChosen: NotChosenRow[] = [];
  for (const prev of inHolderOrder(args.previous)) {
    if (matched.has(prev)) continue;
    const block = blockOf(prev);
    const key = keyOfVerdict(prev);
    const row = { finding_id: prev.finding_id, rule_id: block?.rule?.id ?? "", verdict: prev.verdict };
    const own = ownFindingOf(prev);
    if (own === null) {
      gone.push({ ...row, because: block ? NOT_COMPARED_WORDS.goneByKey(placesTextOf(prev) !== "") : NOT_COMPARED_WORDS.goneNoBlock, ...goneDetailOf(prev, block) });
      continue;
    }
    const asked = key !== null && keysAsked.has(key);
    const ownTaken = asked ? pairing.ownTaken.get(prev) : undefined;
    const ownComparedWith = ownTaken ? pairing.pairOf.get(ownTaken.own)?.verdict : undefined;
    const leftOver = asked ? pairing.leftOver.get(prev) : undefined;
    const unplaced = asked ? pairing.unplaced.get(prev) : undefined;
    const byItsFinding = byFindingRoute.get(prev.finding_id);
    const keyFirst = block ? undefined : answeredBy.get(prev.finding_id);
    if (ownTaken && ownComparedWith)
      notChosen.push({
        ...row,
        held_by: ownComparedWith.finding_id,
        because: NOT_COMPARED_WORDS.ownTaken(ownTaken.own.finding_id, ownTaken.by, ownComparedWith.finding_id, ownComparedWith.finding_id === prev.finding_id),
      });
    // `leftOver` and `unplaced` say the verdict's own candidate is not found; both are said only where
    // no candidate of this scan has its finding id or the places it records. A verdict left over in its content key
    // whose own candidate is here under another key goes on to the routes below, which name that candidate.
    else if (leftOver !== undefined && own.by === "key") notChosen.push({ ...row, because: NOT_COMPARED_WORDS.leftOver(leftOver, placesTextOf(prev) !== "") });
    else if (unplaced && own.by === "key") notChosen.push({ ...row, because: NOT_COMPARED_WORDS.unplaced(unplaced.candidates, unplaced.verdicts) });
    else if (byItsFinding) notChosen.push({ ...row, held_by: byItsFinding.verdict.finding_id, because: NOT_COMPARED_WORDS.byFinding(prev.finding_id, byItsFinding.keyHad) });
    else if (keyFirst) notChosen.push({ ...row, held_by: keyFirst.finding_id, because: NOT_COMPARED_WORDS.keyFirst(prev.finding_id, keyFirst.finding_id) });
    else if (own.by !== "key") {
      // Its own candidate is in this scan under another content key and was compared there.
      const holder = answeredBy.get(own.candidate.finding_id);
      notChosen.push({
        ...row,
        ...(holder ? { held_by: holder.finding_id } : {}),
        because: NOT_COMPARED_WORDS.ownOtherKey(own.candidate.finding_id, own.by, holder?.finding_id, holder?.finding_id === prev.finding_id),
      });
    } else
      // Not reached: a verdict whose own finding is not in this scan, of a content key this scan raised, is paired,
      // `leftOver` or `unplaced`. Said plainly rather than called gone, which the one source has ruled out.
      notChosen.push({ ...row, because: NOT_COMPARED_WORDS.keyRaised });
  }

  const by_reason: Record<string, number> = {};
  const by_premise: Record<string, number> = {};
  for (const row of rows) {
    by_reason[row.reason] = (by_reason[row.reason] ?? 0) + 1;
    if (row.premise) by_premise[row.premise] = (by_premise[row.premise] ?? 0) + 1;
  }

  return {
    rows,
    carried,
    gone,
    not_chosen: notChosen,
    counts: {
      candidates: ordered.length,
      carried: rows.filter((r) => r.outcome === "carried").length,
      adjudicate: rows.filter((r) => r.outcome === "adjudicate").length,
      gone: gone.length,
      not_chosen: notChosen.length,
      by_reason,
      by_premise,
    },
  };
}
