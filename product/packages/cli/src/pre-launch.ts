/**
 * THE ONE DETERMINISTIC STEP THAT RUNS BEFORE ANY SEAT IS LAUNCHED.
 *
 * ## The defect this exists to remove
 *
 * Three units each answered one question and each answered it in its own place: unit F settles the
 * per-rule questions from the person's declaration and removes the launches of the rules the
 * declaration does not reach; unit H compares the previous run's premises and removes the launches
 * of the candidates whose answers still hold; unit G prices the fan-out. G's price is computed
 * inside the scan (`cost-preview.ts`, a pure function over the scan's own document) and F's and H's
 * removals happen afterwards, so the figure a person was asked to decide on counted launches the
 * next two steps then took away. On one real tree declared `["US"]`, F removed 10 of 20 launches and the
 * printed price still said 20 - twice what the run would cost.
 *
 * This module is the class fix rather than a patch of that number: F's settlement, H's partition and
 * G's price become ONE step with the declaration and the previous run in front of it, computed once,
 * printed once, and read by the skill verbatim. The scan's own `cost_preview` stays exactly what it
 * is - the upper bound over every payload the scan wrote - and its sentence saying so stays true.
 *
 * ## What it does NOT do
 *
 * It answers nothing and judges nothing. The jurisdiction judgement is `per-rule-applicability.ts`'s
 * and is READ here from the block the scan wrote (`adjudicate: false` rows), never re-derived - the
 * membership list of the Union lives in one file and this is not a second copy of it. The premise
 * comparison is `carry-forward.ts`'s and is passed in as a set of finding ids. The arithmetic of the
 * price is `cost-preview.ts`'s `costPreview`, called here over the REMAINING candidates and the
 * REMAINING payload rows - the same pure function, not a second one that would have to agree with
 * it.
 *
 * ## The order, and why it is this order
 *
 * The declaration first, the previous run second. A rule the person's own declaration does not reach
 * launches no seat whatever an earlier run decided about it, and its candidates are reported as *not
 * applicable by declaration* rather than as a carried verdict: the declaration is this run's answer
 * and the carried verdict is the previous run's. Where both would apply to one candidate the
 * settlement wins and the overlap is COUNTED and printed (`carried.also_settled`), because a
 * precedence nobody can see is a precedence nobody can check.
 *
 * ## Determinism
 *
 * No clock, no network, no file. Two runs over the same document, the same block and the same
 * carried set produce the same plan and the same block of text, which is what lets a gate pin it.
 */

import type {
  Candidate,
  FindingsContextPayloadRow,
  FindingsCostPreview,
  PerRuleApplicability,
} from "wolfboy-schemas";
import { PRICE_BASIS_WORDS, costPreview, groupKeyOf, grouped, tokenRangeWords } from "./cost-preview.js";
import { earlierRunWords } from "./carry-forward.js";

/**
 * One candidate set aside by the declaration, in the shape `evidence-log.schema.json`'s
 * `pre_settled[]` requires - so the orchestrator copies these rows into the log instead of
 * assembling them by hand from the block. `because` is the scan's own sentence, copied and never
 * re-worded: the reason of record has one author.
 */
export interface PreSettledRecord {
  finding_id: string;
  rule_id: string;
  outcome: "not_applicable";
  /** `out_of_scope_by_answer`: a scope answer of the confirmed record (`settled_by`). */
  ground: "out_of_jurisdiction" | "out_of_scope_by_answer";
  rule_jurisdiction: string[];
  declared_regions: string[];
  answered_from: string;
  because: string;
  locations: number;
  settled_by?: { field: string; answer: unknown; recorded_at: string };
}

export interface PreLaunchPlan {
  /** What the scan wrote, which is what its own `cost_preview` is over: the upper bound. */
  wrote: { launches: number; candidates: number };
  /**
   * Whether a settlement was applied at all. False where the document carries no
   * `per_rule_applicability` block (a scan written before unit F) or where its `settled` is false -
   * no profile, no `distribution_regions`, an empty array, or the recorded answer `"unknown"`. Then
   * nothing is removed here and every candidate is adjudicated, which is the design's direction.
   */
  settlement_applied: boolean;
  settled: {
    /** Rules whose `adjudicate` is false and which raised at least one candidate on this tree. */
    rules: number;
    candidates: number;
    /** Payload files removed: every row of a group all of whose candidates are settled. */
    launches_removed: number;
    /** Payload groups that vanish, and the ones that only get smaller. */
    groups_removed: number;
    groups_reduced: number;
  };
  /** False where no previous run was given, and then nothing is carried and nothing is compared. */
  partition_applied: boolean;
  carried: {
    candidates: number;
    launches_removed: number;
    /** Carried candidates the declaration had already set aside. The settlement wins; this is the size of the overlap. */
    also_settled: number;
    from_scan: string | null;
  };
  remaining: { launches: number; candidates: number };
  /** The candidates that still need a seat, by finding id, sorted. This is what step 4 dispatches. */
  to_adjudicate: string[];
  /** The payload keys that still launch, sorted. Reader rows included: each one is a launch. */
  remaining_payloads: string[];
  /**
   * Build unit F5 M3 (carried-places.ts): the reader seats of candidates still read that are not launched, because
   * every place each holds is carried. Present only where there is one; their keys are not in `remaining_payloads`.
   */
  carried_seats?: { key: string; finding_id: string; reader: number; places: number }[];
  pre_settled: PreSettledRecord[];
  /** G's price, over the remainder, from `costPreview` and from no other arithmetic. */
  preview: FindingsCostPreview;
}

export interface PreLaunchArgs {
  candidates: Candidate[];
  /** The scan's payload index rows (`context_payloads.payloads`). Empty where the scan wrote none. */
  payloads: FindingsContextPayloadRow[];
  /** The block the scan wrote. Null or absent is a document from before unit F, and settles nothing. */
  applicability?: PerRuleApplicability | null;
  /** Finding ids unit H carried forward. Empty where no previous run was given. */
  carried?: string[];
  /** True where a previous run was compared at all, which is not the same as carrying something. */
  partitionApplied?: boolean;
  previousScanId?: string | null;
  /** Build unit F5 M3: reader seats whose places are all carried (carried-places.ts `placesToRead`). */
  carriedSeats?: { key: string; finding_id: string; reader: number; places: number }[];
}

/** The candidates of each payload group, by the key `adjudication_group` names. */
function groupMembers(candidates: Candidate[]): Map<string, Candidate[]> {
  const byGroup = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const key = c.adjudication_group?.key ?? c.finding_id;
    const list = byGroup.get(key);
    if (list) list.push(c);
    else byGroup.set(key, [c]);
  }
  return byGroup;
}

/**
 * Apply the declaration, then the previous run, then price what is left.
 *
 * A payload row survives while its group still holds one candidate that needs a seat. A row whose
 * group holds no candidate at all survives too, deliberately: the price is then an over-estimate
 * rather than a launch nobody was told about, and a document in that state is malformed in a way
 * this step is not the place to decide about.
 */
export function preLaunchPlan(args: PreLaunchArgs): PreLaunchPlan {
  const { candidates, payloads } = args;
  const block = args.applicability ?? null;
  const settlementApplied = block !== null && block.settled === true;

  /* THE RULES THE DECLARATION DOES NOT REACH, READ OFF THE BLOCK. `adjudicate: false` is reached
   * only from a positive declaration (`per-rule-applicability.ts`), and the judgement behind it is
   * not repeated here: a jurisdiction the regions answered leave out (the block `settled`), or a scope answer of the confirmed record (the row's `settled_by`),
   * which needs no region to be answered. */
  const notApplicable = new Map<string, PerRuleApplicability["rules"][number]>();
  if (block !== null) {
    for (const row of block.rules) if (row.adjudicate === false && (settlementApplied || row.settled_by !== undefined)) notApplicable.set(row.rule_id, row);
  }

  const settledIds = new Set<string>();
  const preSettled: PreSettledRecord[] = [];
  for (const c of candidates) {
    const row = notApplicable.get(c.rule_id);
    if (!row) continue;
    settledIds.add(c.finding_id);
    // A rule its jurisdiction leaves out is that, whatever else holds; otherwise the scope answer that settled it, its
    // reason the scan's own premise sentence for the field, copied.
    const byScope = row.jurisdiction_question.answer !== "does_not_apply" && row.settled_by !== undefined ? row.settled_by : null;
    const premise = byScope === null ? undefined : (row.premise_questions ?? []).find((p) => p.answered_from === `ScanProfile.${byScope.field}`);
    preSettled.push({
      finding_id: c.finding_id,
      rule_id: c.rule_id,
      outcome: "not_applicable",
      ground: byScope === null ? "out_of_jurisdiction" : "out_of_scope_by_answer",
      rule_jurisdiction: [...row.jurisdiction],
      declared_regions: [...(block?.declared_regions ?? [])],
      answered_from: byScope === null ? row.jurisdiction_question.answered_from : `ScanProfile.${byScope.field}`,
      because: byScope === null ? row.jurisdiction_question.because : (premise?.because ?? row.settled_premise),
      locations: (c.locations ?? []).length,
      ...(byScope === null ? {} : { settled_by: { field: byScope.field, answer: byScope.answer, recorded_at: byScope.recorded_at } }),
    });
  }
  preSettled.sort((a, b) => (a.finding_id < b.finding_id ? -1 : a.finding_id > b.finding_id ? 1 : 0));

  const carriedGiven = new Set(args.carried ?? []);
  let alsoSettled = 0;
  const carriedIds = new Set<string>();
  for (const id of carriedGiven) {
    if (settledIds.has(id)) alsoSettled += 1;
    else carriedIds.add(id);
  }

  const remainingCandidates = candidates.filter(
    (c) => !settledIds.has(c.finding_id) && !carriedIds.has(c.finding_id),
  );
  const byGroup = groupMembers(candidates);
  const needsSeat = (key: string, done: Set<string>): boolean => {
    const members = byGroup.get(key);
    if (!members || members.length === 0) return true;
    return members.some((c) => !done.has(c.finding_id));
  };
  const rowsAfterSettlement = payloads.filter((row) => needsSeat(groupKeyOf(row), settledIds));
  const both = new Set([...settledIds, ...carriedIds]);
  const remainingCandidateIds = new Set(remainingCandidates.map((c) => c.finding_id));
  /* Build unit F5 M3: a reader seat of a candidate still read whose places are all carried is not launched. Its rows
   * are carried into the record (carried-places.ts); the verdict seat after readers still runs, over them. */
  const carriedSeats = (args.carriedSeats ?? [])
    .filter((s) => remainingCandidateIds.has(s.finding_id))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const carriedSeatKeys = new Set(carriedSeats.map((s) => s.key));
  const remainingRows = rowsAfterSettlement.filter((row) => needsSeat(groupKeyOf(row), both) && !carriedSeatKeys.has(row.key));

  let groupsRemoved = 0;
  let groupsReduced = 0;
  for (const key of new Set(payloads.map(groupKeyOf))) {
    const members = byGroup.get(key) ?? [];
    const settledHere = members.filter((c) => settledIds.has(c.finding_id)).length;
    if (settledHere === 0) continue;
    if (settledHere === members.length) groupsRemoved += 1;
    else groupsReduced += 1;
  }

  const sortedIds = (list: Candidate[]): string[] =>
    [...list.map((c) => c.finding_id)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return {
    wrote: { launches: payloads.length, candidates: candidates.length },
    // Applied where the regions settled the block or a scope answer settled a rule.
    settlement_applied: settlementApplied || preSettled.length > 0,
    settled: {
      rules: new Set(preSettled.map((r) => r.rule_id)).size,
      candidates: settledIds.size,
      launches_removed: payloads.length - rowsAfterSettlement.length,
      groups_removed: groupsRemoved,
      groups_reduced: groupsReduced,
    },
    partition_applied: args.partitionApplied === true,
    carried: {
      candidates: carriedIds.size,
      launches_removed: rowsAfterSettlement.length - remainingRows.length,
      also_settled: alsoSettled,
      from_scan: args.previousScanId ?? null,
    },
    remaining: { launches: remainingRows.length, candidates: remainingCandidates.length },
    to_adjudicate: sortedIds(remainingCandidates),
    remaining_payloads: remainingRows.map((r) => r.key).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    ...(carriedSeats.length > 0 ? { carried_seats: carriedSeats.map((s) => ({ key: s.key, finding_id: s.finding_id, reader: s.reader, places: s.places })) } : {}),
    pre_settled: preSettled,
    // THE PRICE, over the remainder, by the same function the scan calls over the whole. The
    // `important` shape's second limb - a rule this run launches exactly once - is therefore
    // computed over the remainder too, which is the correct reading of it: it is a statement about
    // the fan-out that is about to happen, not about the one the scan wrote.
    preview: costPreview(remainingCandidates, remainingRows),
  };
}

/**
 * THE BLOCK THE SKILL PUTS IN FRONT OF THE PERSON, verbatim.
 *
 * Four accounting lines (a fifth where places are carried inside candidates still read, build unit F5 M3), then the launches and tokens of the remainder. The accounting lines are above
 * the price because a person reading a number is entitled to see what was taken out of it before they
 * are asked to decide on it. ONE TIME ESTIMATE (relay integration part B, item 7; A-22): the time is the
 * price table's alone - each run shape's range between two measured seat times (launch-plan.ts
 * `priceTable`), which the status line then re-estimates from the run's own seats. The single figure
 * `costPreviewLines` makes from one constant is the `scan` command's, and is not printed beside it here.
 * `previousNamed`: the path the person named the previous run by, as typed, shown beside its label.
 */
export function preLaunchLines(plan: PreLaunchPlan, previousNamed: string | null = null): string[] {
  const lines = [
    "pre-launch plan: the declaration and the previous run applied, then the price of what is left",
    `  this scan wrote: ${plan.wrote.launches} payload file(s) over ${plan.wrote.candidates} candidate(s)` +
      ` — the upper bound in findings.json's context_payloads.cost_preview`,
    plan.settlement_applied
      ? `  not applicable by declaration: ${plan.settled.rules} rule(s), ${plan.settled.candidates} candidate(s),` +
        ` ${plan.settled.launches_removed} launch(es) removed (${plan.settled.groups_removed} payload group(s) removed,` +
        ` ${plan.settled.groups_reduced} reduced) — reported as not applicable by declaration, never as assessed`
      : `  not applicable by declaration: nothing settled — the scan's per_rule_applicability block is absent or` +
        ` its distribution_regions question was not answered and no scope answer settled a rule, so none is ruled out`,
    plan.partition_applied
      ? `  carried forward from ${plan.carried.from_scan ? earlierRunWords(plan.carried.from_scan, { who: "you", path: previousNamed }) : "scan (unnamed)"}: ${plan.carried.candidates} candidate(s),` +
        ` ${plan.carried.launches_removed} launch(es) removed` +
        `${plan.carried.also_settled > 0 ? `, and ${plan.carried.also_settled} the declaration had already set aside` : ""}` +
        ` — carried, not re-verified: no seat read them in this run`
      : "  carried forward: no previous run was given, so every candidate that survives the declaration needs a seat",
    ...(plan.carried_seats && plan.carried_seats.length > 0
      ? [
          `  places carried inside candidates still read: ${plan.carried_seats.reduce((n, s) => n + s.places, 0)} place(s), every place of` +
            ` ${plan.carried_seats.length} review(s) of part of ${new Set(plan.carried_seats.map((s) => s.finding_id)).size} candidate(s), which are not launched` +
            " — carried, not re-verified: nothing each such place's earlier answer rested on has changed, and the review that answers its candidate answers over it",
        ]
      : []),
    `  remaining to adjudicate: ${plan.remaining.launches} launch(es) over ${plan.remaining.candidates} candidate(s)`,
  ];
  const p = plan.preview;
  // The recommended shape's figure (cost-preview.ts
  // `shapeFigure`, the one the price table and the start question print), never the adjudicators' alone beside it.
  const recommended = p.shapes.find((x) => x.shape === "refute_later") ?? p;
  return [
    ...lines,
    `layer 2 cost: ${p.launches} launch(es) — ${tokenRangeWords(recommended.estimated_tokens_low, recommended.estimated_tokens_high)} at the input price in the recommended shape, to read and judge them once with the second look (a range: the price table gives each run shape's figure, the second check included where it runs)` +
      " — no time is estimated here: the pre-launch step's price table gives each run shape's time, as a range from the measured median seat time to the longest",
    // Where the range comes from is one sentence, the scan's and the run-shape question's own
    // (cost-preview.ts `PRICE_BASIS_WORDS`), never a copy kept here.
    `  basis: ${PRICE_BASIS_WORDS}`,
  ];
}
