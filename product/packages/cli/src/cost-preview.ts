import type { Candidate, FindingsContextPayloadRow, FindingsCostPreview, FindingsCostPreviewShape } from "wolfboy-schemas";
import { SHIPS_MAY_DECIDE } from "./standing.js";

/**
 * WHAT THE NEXT LAYER WILL COST, STATED BEFORE IT IS SPENT.
 *
 * Layer 2 runs in the user's own agent and the user pays for it. Until this module existed the
 * first number a user saw was the bill: the scan printed candidates, the skill launched one child
 * per payload, and the price of that fan-out appeared nowhere before the fan-out happened.
 * The project's rule says it in terms — *candidate volume is a product cost* — and a cost the product can
 * compute and does not show is a cost the user cannot consent to.
 *
 * THIS IS AN ESTIMATE AND IT SAYS SO WHEREVER IT IS PRINTED. The launch count is exact — it is the
 * number of payload files this run wrote, which is the number of ADJUDICATOR children the skill
 * launches — and the two multipliers are measured medians from other trees. A tree whose children
 * read more than the median will cost more than this says.
 *
 * THE COUNT IS THIS RUN'S ADJUDICATION LAUNCHES AND NOTHING ELSE.
 * The skill launches children on both sides of this price and neither is in it: the silence
 * investigators of step 3c, which run BEFORE the price is ever shown, and the refuters of step 5,
 * which run after the verdicts only in a shape with the second check. The silence searches are not this module's to
 * price — the skill, not the CLI, decides how many to run — so the printed line says what the number covers instead of
 * letting a reader take it for the whole bill; the refuters are priced, as a range, in the shapes that run them.
 *
 * WHAT THE SCAN PRINTS IS AN UPPER BOUND, AND SOMETHING ELSE NOW PRICES THE REMAINDER.
 * The launch count this module computes inside the
 * scan covers every payload the run wrote, and unit F's per-rule settlement and unit H's
 * carry-forward partition remove launches from that set afterwards — so the scan's figure is an
 * upper bound on the run's cost and not the count that will remain. This module still cannot
 * subtract them: it is a pure function over the scan's own document, and the declaration's
 * settlement and the previous run's partition are not in that document's arguments.
 *
 * THE FIX IS A SECOND CALL OF THIS SAME FUNCTION, NOT A SECOND ARITHMETIC. `pre-launch.ts` runs
 * before any seat is launched, applies F's settlement and H's partition to the candidates and the
 * payload rows, and calls `costPreview` again over what is left; the skill shows that block and asks
 * the shape from it. Nothing here was changed to make that work, and the scan's own sentence stays
 * true.
 *
 * A PURE FUNCTION OVER THE DOCUMENT, deliberately: it takes the candidates and the payload index
 * rows and reads no file, no clock and no environment. Two runs of one tree therefore produce the
 * same preview, which is what lets it be written into `findings.json` beside the index rather than
 * printed and forgotten (see the `scan_id` note in `context.ts` for the property this preserves).
 */

/**
 * THE PRICE MODEL, RE-FITTED ON TWO MEASURED RUNS. It was
 * first built (2026-10-07) from one run on one open-source repository alone; a run on a second repository (2026-10-12) cost 67.36 M
 * host against a preview of 23.23-58.12 M, and
 * the pre-registration says the model is re-fitted from both runs' lines before a price is shown again. The shape is
 * the first fit's, one line per kind of work:
 *
 * - **reading, by payload bytes**: a reader seat's whole cost over the bytes of its payload.
 * - **verdicts, per candidate that fits one seat**: the one-seat bins' cost (their make-ups included) less their reading
 *   at the readers' byte rate.
 * - **answer seats, per candidate over one seat**: their own line, make-ups included.
 * - **orchestration, per launch**: the relays and the main session after the run-shape answer, over the run's launches.
 * - **the second check, per violation candidate**: run 2's refuters (neither of the two runs ran one), and the share of
 *   candidates that became violation candidates in run 2 (low) and in the larger of the two runs (high).
 *
 * Each of the four line coefficients is U3's derivation run on each run's record, then the two averaged: the trees are
 * weighted equally because the tree is what varies (on payloads of the same size per seat, the second run's readers cost 1.49
 * times the first run's per payload byte and its read-and-judge bins 2.05 times U3's line; its seats made more calls and read
 * outside their windows four times as often per place). Refused hand-backs, their re-tries and make-up seats are inside
 * each line, as both runs measured them. Units: tokens counted at the input price (a cache read a tenth, a cache write
 * 1.25 or 2 times, output five times), each hand-back's output counted (a tool). Derived by
 * an internal record, which the cost-preview gate compares with these constants.
 *
 * **EVERY COEFFICIENT IS A TUNING NUMBER FROM TWO REPOSITORIES**, so the person never sees a point: the central figure is
 * widened to 0.7-1.6 times. The top, 1.6, is the worst miss a one-tree fit made on the other tree (U3, fitted on the first run,
 * priced the second at 1 / 1.598 of what it cost), kept whole as headroom; the low, 0.7, is U3's and holds both runs. The
 * host's record, which ran 27 % (fm1) and 29 % (the second run) over the transcripts' own priced units for a reason not
 * established, is applied at the high end at the larger of the two, and the smoke's 1.5 % at the low end. The range is
 * what is printed; the central figure is not stored. A third repository, never used in fitting, is the test of this model.
 */
export const PRICE_MODEL = {
  read_tokens_per_payload_byte: 1.1892,
  verdict_tokens_per_one_seat_candidate: 32_065,
  answer_seat_tokens: 216_547,
  orchestration_tokens_per_launch: 20_518,
  second_check_tokens_per_violation_candidate: 419_203,
  violation_candidate_share: [0.2377, 0.4242] as [number, number],
  host_over_priced: [1.015, 1.2892] as [number, number],
  widened: [0.7, 1.6] as [number, number],
} as const;

/**
 * Where the price model was measured, cited with it into the document and printed on the basis line. Public words
 * that name no repository and no internal record.
 * The rates are tuning numbers, fitted to the same two runs they describe; the
 * words say where they come from without repeating PRICE_BASIS_WORDS, which the basis line prints beside them.
 */
export const PRICE_MODEL_SOURCE =
  "the runs of 2026-10-06 and 2026-10-12, one open-source repository each, to which the rates were fitted; the second check's rate from an earlier run";

/**
 * WALL SECONDS ONE LAUNCH TAKES, whatever it is handed. Measured: the median wall time of the same
 * 10 adjudicator seats of arm H.
 * It replaced 174 s, the
 * median of one real run's 82 adjudicators on claude-sonnet-5 at effort `max`.
 */
export const LAUNCH_WALL_SECONDS = 204;

/**
 * Where the seat times were measured, in public words: one text, cited into the document beside
 * `LAUNCH_WALL_SECONDS` and imported by `launch-plan.ts` for both of its figures, the median and the longest. It names no
 * repository and no internal record.
 */
export const SEAT_TIMES_SOURCE =
  "10 adjudicator seats timed in one run on an open-source repository on 2026-09-30, claude-sonnet-5-5 at effort high";
/** Where `LAUNCH_WALL_SECONDS` was measured, cited with it into the document (`costPreview`). */
export const LAUNCH_WALL_SECONDS_SOURCE = `the median of ${SEAT_TIMES_SOURCE}`;

/**
 * HOW MANY CHILDREN THE SKILL KEEPS IN FLIGHT. Design E and `SKILL.md` step 4, which says **keep 20 in
 * flight** and states the same floor this module computes: `ceil(payloads / 20) x about 174 s`.
 *
 * THE SKILL READS THE RESULT RATHER THAN RECOMPUTING IT (never keep a second copy of
 * anything two places must agree on). Step 3l tells the orchestrator to read the numbers off
 * `context_payloads.cost_preview`; step 4's prose explains why the bound is 20 and is not a second
 * copy of the arithmetic.
 */
export const LAUNCH_CONCURRENCY = 20;

/**
 * THE GROUP A PAYLOAD ROW BELONGS TO.
 *
 * A candidate read by kinds is written as one payload per reader — `<key>#reader-<n>` — followed by
 * the verdict seat's payload under the group's own key (`payloadJobs` in `context.ts`). Each of
 * those files is one launch, so they all count, but only the base key appears on a candidate's
 * `adjudication_group`, which is what this strips back to.
 *
 * EXPORTED FOR `pre-launch.ts`, which decides whether a payload row still launches once unit F's
 * settlement and unit H's partition have been applied to the candidates. It is exported rather than
 * copied: the mapping from a reader row back to its group is one fact and two places must agree on
 * it.
 */
export function groupKeyOf(row: FindingsContextPayloadRow): string {
  const cut = row.key.lastIndexOf("#reader-");
  return cut === -1 ? row.key : row.key.slice(0, cut);
}

/** Seconds a fan-out of `launches` takes at `LAUNCH_CONCURRENCY`, as whole waves. */
function wallSecondsFor(launches: number): number {
  // WHOLE WAVES, NOT `launches x seconds / concurrency`. SKILL.md step 4 states the reason and this
  // is the same arithmetic: 22 payloads over a bound of 20 are two waves, not 1.1 — dividing
  // understates exactly the small run a user looks at first.
  return Math.ceil(launches / LAUNCH_CONCURRENCY) * LAUNCH_WALL_SECONDS;
}

/** A row's seat: a reader, the answer seat of a candidate read by readers, or a one-seat bin (as `seatSkeleton` classes it). */
function roleOf(row: FindingsContextPayloadRow, groupsWithReaders: ReadonlySet<string>): "reader" | "answer" | "bin" {
  if (row.key.lastIndexOf("#reader-") !== -1) return "reader";
  return groupsWithReaders.has(groupKeyOf(row)) ? "answer" : "bin";
}

/** The price of a set of rows, as the range the person sees; never a point. */
export interface PriceRange {
  /** The whole range, the second check included where `secondCheck` is true. */
  low: number;
  high: number;
  /** The second check's own part of that range, where it runs. */
  second_check?: { low: number; high: number };
}

/**
 * THE PRICE OF ROWS, from the fm1 model above. `extra` prices seats a standing run still has to go that are not rows of
 * the plan: refuter entries already appended (one second check each) and other appended seats (priced as answer seats,
 * the nearest measured kind: a fresh seat that reads what it is handed once).
 */
export function priceRows(
  rows: FindingsContextPayloadRow[],
  byGroup: Map<string, Candidate[]>,
  secondCheck: boolean,
  extra: { refuters?: number; seats?: number } = {},
): PriceRange {
  const m = PRICE_MODEL;
  const withReaders = new Set(rows.filter((r) => r.key.lastIndexOf("#reader-") !== -1).map(groupKeyOf));
  const candidates = new Set<string>();
  let central = 0;
  for (const row of rows) {
    const members = byGroup.get(groupKeyOf(row)) ?? [];
    for (const c of members) candidates.add(c.finding_id);
    const role = roleOf(row, withReaders);
    central += m.orchestration_tokens_per_launch;
    if (role === "answer") central += m.answer_seat_tokens;
    else central += m.read_tokens_per_payload_byte * (row.bytes ?? 0) + (role === "bin" ? m.verdict_tokens_per_one_seat_candidate * members.length : 0);
  }
  central += (extra.seats ?? 0) * (m.answer_seat_tokens + m.orchestration_tokens_per_launch);
  const fixedRefuters = (extra.refuters ?? 0) * m.second_check_tokens_per_violation_candidate;
  const refuters = secondCheck
    ? [0, 1].map((i) => candidates.size * (m.violation_candidate_share[i] as number) * m.second_check_tokens_per_violation_candidate + fixedRefuters)
    : [fixedRefuters, fixedRefuters];
  const lowOf = (x: number): number => Math.round(x * m.widened[0] * m.host_over_priced[0]);
  const highOf = (x: number): number => Math.round(x * m.widened[1] * m.host_over_priced[1]);
  const [rLow, rHigh] = refuters as [number, number];
  return {
    low: lowOf(central + rLow),
    high: highOf(central + rHigh),
    ...(secondCheck || fixedRefuters > 0 ? { second_check: { low: lowOf(rLow), high: highOf(rHigh) } } : {}),
  };
}

/**
 * THE SECOND LOOK'S PART OF EACH SHAPE (design-not-violations.md section
 * 2.5 item 5, the owner's answer to its question 3 of 2026-11-02). Every shape appends one refuter seat in challenge mode for
 * each high finding the review takes out of the count on its own word (`refute_later`, which runs no second check, since
 * WP9; the shapes with the second check beside it since). How many there will be is known
 * only once the verdicts are in, and no measured share of it exists yet, so the part is priced as a range from none to one
 * seat for every high candidate the shape reads: the low end adds nothing, the high end one second check
 * (`second_check_tokens_per_violation_candidate`, the program's own figure for one refuter seat) per high candidate,
 * widened as every high end is. `seats` is that number of high candidates, which the price table names. The shapes with the second check also give a
 * second look to each high candidate the review rules out as not applicable. A finding gets one second look at most, so the
 * high end (one per high candidate, whatever its verdict) already holds those seats; the price table's words name them.
 */
export function secondLookPart(rows: FindingsContextPayloadRow[], candidates: Candidate[], secondCheck = false): SecondLookPart {
  return lookPart(rows, candidatesByGroup(candidates), secondCheck);
}

/**
 * The second look's seats a shape may launch, at most one per finding (second-look.ts `challengeEntryId`): each high
 * candidate, and in a shape with the second check
 * each candidate whose rule opts in to the location look (`duty_about` `product_runtime`, standing.ts `SHIPS_MAY_DECIDE`;
 * second-look.ts `locationChallengeOf`), at any level: that look waits on the refuter's record, so `chained` says the
 * shape may need one more wave after the refuters.
 *
 * `seats` and `high` are the looks' own most (the printed "at most k seat(s)" and "up to"): every high candidate, and the
 * opt-in candidates that are not high as far as there are refuters to overturn them. What the shape's high end adds for
 * the looks is less where refuters must sit on plain high candidates (`looksBeside`).
 */
export interface SecondLookPart {
  seats: number;
  low: number;
  high: number;
  chained: boolean;
  /** The distinct candidates the shape reads, by what may follow their verdict (`AfterVerdict`). */
  kinds: AfterVerdict;
}
/**
 * The candidates a shape reads, by the
 * seats that may follow their verdict. `highOptIn`: high and opting in to the location look (a look after a dismissal, or
 * a refuter and then a location look); `high`: high and not opting in (a look after a dismissal, or a refuter, never
 * both); `optIn`: not high and opting in (a refuter and then a location look); `plain`: neither (a refuter). Opting in
 * counts only in a shape with the second check, the one that launches refuters.
 */
export interface AfterVerdict {
  highOptIn: number;
  high: number;
  optIn: number;
  plain: number;
}
/**
 * The looks a shape's high end holds beside `refuters` refuter seats: the looks' own most, less one for each refuter that
 * finds no candidate but a plain high one to sit on (its look's place). The refuters are placed where they leave the most
 * seats: on the opt-in candidates that are not high (each keeps a location look), then on the opt-in high ones and the
 * plain ones that are not high (no look lost), then on the plain high ones. So the seats after the verdicts, `refuters`
 * plus this, are at most one per candidate plus the location looks.
 */
export function looksBeside(k: AfterVerdict, refuters: number): number {
  const onOptIn = Math.min(k.optIn, refuters);
  return k.highOptIn + k.high + onOptIn - Math.max(0, refuters - onOptIn - k.highOptIn - k.plain);
}
function lookPart(rows: FindingsContextPayloadRow[], byGroup: Map<string, Candidate[]>, secondCheck: boolean): SecondLookPart {
  const kindOf = new Map<string, keyof AfterVerdict>();
  let chained = false;
  for (const row of rows) {
    for (const c of byGroup.get(groupKeyOf(row)) ?? []) {
      const optsIn = secondCheck && (c as { duty_about?: unknown }).duty_about === SHIPS_MAY_DECIDE;
      if (optsIn) chained = true;
      kindOf.set(c.finding_id, c.severity === "high" ? (optsIn ? "highOptIn" : "high") : optsIn ? "optIn" : "plain");
    }
  }
  const kinds: AfterVerdict = { highOptIn: 0, high: 0, optIn: 0, plain: 0 };
  for (const k of kindOf.values()) kinds[k] += 1;
  const m = PRICE_MODEL;
  const refuters = secondCheck ? kindOf.size * m.violation_candidate_share[1] : 0;
  const seats = kinds.highOptIn + kinds.high + Math.min(kinds.optIn, Math.ceil(refuters));
  const most = kinds.highOptIn + kinds.high + Math.min(kinds.optIn, refuters);
  return { seats, low: 0, high: Math.round(most * m.second_check_tokens_per_violation_candidate * m.widened[1] * m.host_over_priced[1]), chained, kinds };
}

/** `priceRows` over candidates rather than a group map: the price table's way in, for a standing run's remainder. */
export function priceFor(
  candidates: Candidate[],
  rows: FindingsContextPayloadRow[],
  secondCheck: boolean,
  extra: { refuters?: number; seats?: number } = {},
): PriceRange {
  return priceRows(rows, candidatesByGroup(candidates), secondCheck, extra);
}

/** Whether a shape launches the second check (a `legal-refuter` seat per violation candidate) after its verdicts. */
export const shapeHasSecondCheck = (shape: FindingsCostPreviewShape["shape"]): boolean => shape !== "refute_later";

/** One seat's wall time, the low and the high end of the measured range (launch-plan.ts `SEAT_TIME_MEASUREMENTS`). */
export interface SeatTimes {
  fast: number;
  slow: number;
}

/**
 * THE ONE PRICE AND TIME OF A RUN SHAPE.
 *
 * The paid run of 2026-11-12 printed two prices for one shape in one session: the scan's "Everything" 0.82M-2.4M and the
 * start question's 0.82M-12M, "+ second check" 2M-8.6M and 2M-18M. The class: the scan priced the shapes in `costPreview`
 * and the price table added the second look on top in its own code, so two places computed one figure. Now every figure
 * a person reads is this function's: the scan's lines, the pre-launch step's line, the price table, the run-shape
 * question and the start question. It holds every seat the shape launches: its adjudicators (`priceRows`), the second
 * check's refuters where the shape has it, and the second look (`lookPart`), which every shape launches.
 *
 * THE TIME COUNTS THOSE SEATS TOO. `waves` is the adjudicators' wave count (launch-plan.ts `waveCount`, which knows the
 * readers); a seat after a verdict starts only once that verdict is in, so the refuters and the second looks are one or
 * more waves after it (`capacity` seats a wave), and a location look one more after its refuter. The low end runs the
 * fewest such seats the price's low end does (none for the recommended shape, the low share of violation candidates
 * for a shape with the second check) at the median seat time; the high end the most, at the longest.
 */
export interface ShapeFigure {
  tokens_low: number;
  tokens_high: number;
  second_check?: { low: number; high: number };
  second_look: { seats: number; high: number };
  waves: number;
  seconds_low: number;
  seconds_high: number;
}
export function shapeFigure(
  shape: FindingsCostPreviewShape["shape"],
  rows: FindingsContextPayloadRow[],
  candidates: Candidate[],
  at: { waves: number; capacity: number; times: SeatTimes; extra?: { refuters?: number; seats?: number } },
): ShapeFigure {
  return figureOf(shape, rows, candidatesByGroup(candidates), at);
}
function figureOf(
  shape: FindingsCostPreviewShape["shape"],
  rows: FindingsContextPayloadRow[],
  byGroup: Map<string, Candidate[]>,
  at: { waves: number; capacity: number; times: SeatTimes; extra?: { refuters?: number; seats?: number } },
): ShapeFigure {
  const secondCheck = shapeHasSecondCheck(shape);
  const base = priceRows(rows, byGroup, secondCheck, at.extra ?? {});
  const look = lookPart(rows, byGroup, secondCheck);
  const ids = new Set<string>();
  for (const row of rows) for (const c of byGroup.get(groupKeyOf(row)) ?? []) ids.add(c.finding_id);
  const m = PRICE_MODEL;
  const share = m.violation_candidate_share;
  const after = (n: number): number => (n > 0 ? Math.ceil(n / Math.max(1, at.capacity)) : 0);
  // The high end's refuters are the high share of the candidates (as
  // `priceRows` prices them) and the looks beside them (`looksBeside`): at most one seat after a verdict per candidate,
  // plus the location looks. The time counts the same seats, with whole refuters.
  const refutersHigh = secondCheck ? ids.size * share[1] : 0;
  const lookTokensHigh = Math.round(looksBeside(look.kinds, refutersHigh) * m.second_check_tokens_per_violation_candidate * m.widened[1] * m.host_over_priced[1]);
  // Seats a standing run already appended (`extra`) are entries of its list, so the caller's `waves` holds them.
  const lowSeats = secondCheck ? Math.ceil(ids.size * share[0]) : 0;
  const wholeRefuters = secondCheck ? Math.ceil(ids.size * share[1]) : 0;
  const highSeats = wholeRefuters + looksBeside(look.kinds, wholeRefuters);
  const highWaves = after(highSeats) + (look.chained && highSeats > 0 ? 1 : 0);
  return {
    tokens_low: base.low,
    tokens_high: base.high + lookTokensHigh,
    ...(base.second_check ? { second_check: base.second_check } : {}),
    second_look: { seats: look.seats, high: look.high },
    waves: at.waves,
    seconds_low: (at.waves + after(lowSeats)) * at.times.fast,
    seconds_high: (at.waves + highWaves) * at.times.slow,
  };
}

/**
 * THE PRICE OF ONE RUN SHAPE. `candidates` is the number of the document's candidates that shape adjudicates in this
 * run, counted by distinct `finding_id`: a candidate read by kinds occupies several payload files and is still one.
 */
function shapeOf(
  shape: FindingsCostPreviewShape["shape"],
  rows: FindingsContextPayloadRow[],
  candidates: number,
  byGroup: Map<string, Candidate[]>,
  extra: Partial<FindingsCostPreviewShape> = {},
): FindingsCostPreviewShape {
  const secondCheck = shapeHasSecondCheck(shape);
  // The tokens are the one figure's (`figureOf`), the second look included; the
  // document's single time stays the adjudicators' whole waves (findings.schema.json `estimated_seconds`), and no
  // person reads it: every printed time is `figureOf`'s range.
  const price = figureOf(shape, rows, byGroup, { waves: 0, capacity: LAUNCH_CONCURRENCY, times: { fast: 0, slow: 0 } });
  return {
    shape,
    launches: rows.length,
    candidates,
    estimated_tokens_low: price.tokens_low,
    estimated_tokens_high: price.tokens_high,
    estimated_seconds: wallSecondsFor(rows.length),
    second_check: secondCheck,
    ...(price.second_check ? { second_check_tokens_low: price.second_check.low, second_check_tokens_high: price.second_check.high } : {}),
    ...extra,
  };
}

/** Candidates by the group key their `adjudication_group` names — the payload row's own key. */
function candidatesByGroup(candidates: Candidate[]): Map<string, Candidate[]> {
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
 * THE PAYLOAD ROWS THE `important` SHAPE LAUNCHES, and the two overlapping counts behind them.
 *
 * Split out of `costPreview` (relay rework item 4, 2026-09-24) so that the launch list of
 * `launch-plan.ts` launches exactly the rows this price counted: the partition is one fact and the
 * price and the list must agree on it, so the list calls `importantRows` below rather than
 * re-deriving the two limbs.
 */
function importantSelection(
  byGroup: Map<string, Candidate[]>,
  launchesPerRule: Map<string, number>,
  payloads: FindingsContextPayloadRow[],
): { rows: FindingsContextPayloadRow[]; forHighSeverity: number; forSingleLaunchRule: number } {
  const rows: FindingsContextPayloadRow[] = [];
  let forHighSeverity = 0;
  let forSingleLaunchRule = 0;
  for (const row of payloads) {
    const members = byGroup.get(groupKeyOf(row)) ?? [];
    const high = members.some((c) => c.severity === "high");
    const single = members.some((c) => launchesPerRule.get(c.rule_id) === 1);
    if (high) forHighSeverity++;
    if (single) forSingleLaunchRule++;
    if (high || single) rows.push(row);
  }
  return { rows, forHighSeverity, forSingleLaunchRule };
}

/** Candidates by the group key their `adjudication_group` names, and payload rows per rule. */
function groupsAndRuleLaunches(
  candidates: Candidate[],
  payloads: FindingsContextPayloadRow[],
): { byGroup: Map<string, Candidate[]>; launchesPerRule: Map<string, number> } {
  const byGroup = candidatesByGroup(candidates);
  const launchesPerRule = new Map<string, number>();
  for (const row of payloads) {
    const seen = new Set<string>();
    for (const c of byGroup.get(groupKeyOf(row)) ?? []) seen.add(c.rule_id);
    for (const id of seen) launchesPerRule.set(id, (launchesPerRule.get(id) ?? 0) + 1);
  }
  return { byGroup, launchesPerRule };
}

/**
 * The payload rows the `important` shape launches, in the order `payloads` gives them: the ONE export of
 * the partition (relay integration part B, A-7). `launch-plan.ts` launches exactly these rows and
 * `assemble-report.ts` tells a candidate this shape did not reach from a verdict that was lost by them;
 * `costPreview` prices the same `importantSelection`. `importantPayloadRows`, a second export of the same
 * partition with its two counts, is gone: no caller read the counts.
 */
export function importantRows(candidates: Candidate[], payloads: FindingsContextPayloadRow[]): FindingsContextPayloadRow[] {
  const { byGroup, launchesPerRule } = groupsAndRuleLaunches(candidates, payloads);
  return importantSelection(byGroup, launchesPerRule, payloads).rows;
}

/**
 * THE THREE SHAPES AND WHAT EACH COSTS, from the candidates and the payload index this run wrote.
 *
 * **`important` IS DEFINED HERE AND THE DEFINITION IS THE UNIT'S, NOT THE IDEA'S.**
 * an internal record defines the priority shape as "adjudicate in
 * severity order under a stated budget in children or yen" — an ordering plus a budget the user
 * states, which is not a partition a scanner can compute before anyone is asked anything. The
 * brief of unit G therefore fixes the partition: **a payload is important when it holds a candidate
 * of severity `high`, or when it carries a rule this run launches exactly once.** The second limb is
 * what stops the shape from being "high severity only": a rule whose whole output is one payload
 * costs one launch to cover completely, and dropping it saves a launch while losing a rule.
 * Recorded as a deviation for the owner to confirm in an internal record.
 *
 * **`refute_later` LAUNCHES THE SAME ADJUDICATORS AS `full` AND NO SECOND CHECK** (since the
 * decision of 2026-10-07 it is the recommended shape, offered first). `full` and `important` run the second check, one
 * refuter per `violation_candidate`; how many there will be is a fact about what the adjudicators decide, so it is priced
 * as a range over the share two measured runs gave (`PRICE_MODEL.violation_candidate_share`), and stated as its own part.
 */
export function costPreview(
  candidates: Candidate[],
  payloads: FindingsContextPayloadRow[],
): FindingsCostPreview {
  /* Candidates by the group key their `adjudication_group` names — the payload row's own key — and
   * HOW MANY PAYLOAD FILES EACH RULE COSTS, which is what the second limb of `important` reads. A
   * rule is counted once per ROW it appears in, reader rows included: they are launches too. */
  const { byGroup, launchesPerRule } = groupsAndRuleLaunches(candidates, payloads);

  const { rows: importantRows, forHighSeverity, forSingleLaunchRule } = importantSelection(byGroup, launchesPerRule, payloads);

  /** Distinct candidates the given rows adjudicate. */
  const candidatesIn = (rows: FindingsContextPayloadRow[]): number => {
    const ids = new Set<string>();
    for (const row of rows) for (const c of byGroup.get(groupKeyOf(row)) ?? []) ids.add(c.finding_id);
    return ids.size;
  };

  const all = candidatesIn(payloads);
  // The document's own figure is the adjudication of every payload without the second check: the upper bound of this
  // run's adjudication launches, which the pre-launch step then prices again over what is left.
  const whole = priceRows(payloads, byGroup, false);
  return {
    launches: payloads.length,
    candidates: all,
    // The model and its citation travel with the figures, into the document and out of it: a constant a reader cannot
    // trace is a constant nobody can re-measure.
    price_model: { ...PRICE_MODEL, source: PRICE_MODEL_SOURCE },
    seconds_per_launch: LAUNCH_WALL_SECONDS,
    seconds_per_launch_source: LAUNCH_WALL_SECONDS_SOURCE,
    concurrency: LAUNCH_CONCURRENCY,
    estimated_tokens_low: whole.low,
    estimated_tokens_high: whole.high,
    estimated_seconds: wallSecondsFor(payloads.length),
    shapes: [
      shapeOf("full", payloads, all, byGroup),
      shapeOf("important", importantRows, candidatesIn(importantRows), byGroup, {
        // Both counts are stated and they OVERLAP: a payload selected for both limbs is in both
        // numbers, so their sum may exceed `launches`. Written this way rather than as a
        // partition because the two limbs are two different reasons to keep a payload and a
        // reader deciding whether the shape is honest needs to see each one's weight.
        selected_for_high_severity: forHighSeverity,
        selected_as_single_launch_rule: forSingleLaunchRule,
      }),
      shapeOf("refute_later", payloads, all, byGroup),
    ],
  };
}

/** `3600` as `1 h 0 min`, `174` as `3 min`, `40` as `40 s`. Whole units; this is an estimate. */
export function humanSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** `3600000` as `3,600,000`. */
export function grouped(n: number): string {
  return n.toLocaleString("en-US");
}

const SHAPE_WORDS: Record<FindingsCostPreviewShape["shape"], string> = {
  full: "everything + second check",
  important: "important only + second check",
  refute_later: "everything (recommended)",
};

/**
 * Where every payload holds a high candidate
 * or a rule launched once, "important only" launches everything, and nothing is left for a later run.
 */
export const IMPORTANT_IS_EVERYTHING = "on this project that is every payload, so nothing is left for a later run";

/** The order shapes are offered in: the recommended one, with no second check, first. */
const OFFER_ORDER: FindingsCostPreviewShape["shape"][] = ["refute_later", "full", "important"];

/**
 * `30,150,000` as `30 million`, `2,340,000` as `2.3 million`, `640,000` as `640 thousand`: two significant figures,
 * because the range is built on two repositories' rates and a third figure would claim a precision it does not have.
 */
export function roughTokens(n: number): string {
  if (n >= 1e6) return `${Number((n / 1e6).toPrecision(2)).toLocaleString("en-US")} million`;
  if (n >= 1e3) return `${Number((n / 1e3).toPrecision(2)).toLocaleString("en-US")} thousand`;
  return String(Math.round(n));
}

/** "about 30 million to 75 million tokens": the range, in words. */
export function tokenRangeWords(low: number, high: number): string {
  return `about ${roughTokens(low)} to ${roughTokens(high)} tokens`;
}

/**
 * MONEY AT LIST PRICES, for a session paid per token. The ranges above are tokens counted at
 * the input price, so their money is the model's own input price per token; the one rate this product has measured is
 * Claude Code's own cost record of a whole run, every call on Claude Sonnet: USD 119.12 for 58.71 M of these units. Another model costs in proportion to its input price, and the
 * words say so.
 */
export const LIST_PRICE_RATE = { usd_per_million: 119.12 / 58.71, model: "Claude Sonnet" } as const;

/** A token range as US dollars at `LIST_PRICE_RATE`, in whole dollars, never a point below one dollar. */
export function usdRangeWords(low: number, high: number): string {
  const usd = (n: number): number => (n * LIST_PRICE_RATE.usd_per_million) / 1_000_000;
  const hi = usd(high);
  if (hi < 1) return "under USD 1";
  return `about USD ${Math.max(1, Math.floor(usd(low)))} to ${Math.ceil(hi)}`;
}

/**
 * WHERE THE RANGE COMES FROM, in the person's words: one text for the scan's lines, the pre-launch block and the
 * run-shape question. A later re-fit changed only what it made untrue: "two measured runs on two repositories" (was
 * one on one), "up to" and "in those runs" (the host's gap was measured twice). The
 * figures in the sentence come from PRICE_MODEL.
 */
export const PRICE_BASIS_WORDS =
  "Tokens are counted at the input price (a cache read counts a tenth, a cache write 1.25 times, output five times). " +
  "The rates come from two measured runs on two repositories, so each figure is a wide range rather than a point: " +
  `it is the measured rates' result widened to ${PRICE_MODEL.widened[0]} to ${PRICE_MODEL.widened[1]} times, and its top end also allows for Claude Code's own record running up to ` +
  `${Math.round((PRICE_MODEL.host_over_priced[1] - 1) * 100)} % above the seats' measured tokens in those runs, ` +
  "a difference not yet explained. The silence searches before this step are not in these figures.";

/**
 * THE COST LINES THE `scan` COMMAND PRINTS, at the end of the full report and before the
 * disclaimer.
 *
 * It is printed where it is because it is not provenance: the four lines above it say how THIS scan
 * was run, and these say what the NEXT step will cost, which is the last thing a reader needs
 * before deciding whether to take it. `--report-detail first-screen` does not print it, for the
 * reason it prints no other line of the full section.
 *
 * THE LAUNCH COUNT IS EXACT AND CARRIES NO HEDGE; EVERY TOKEN FIGURE IS A RANGE. A user who is about to
 * authorise a fan-out is entitled to see which number is counted and which is estimated, and an estimate from two
 * repositories' rates is never shown as a point.
 */
export function costPreviewLines(preview: FindingsCostPreview, figures: ReadonlyMap<FindingsCostPreviewShape["shape"], ShapeFigure>): string[] {
  // Every figure below is `shapeFigure`'s, the one the
  // pre-launch step's price table and both questions print: the head line is the recommended shape's, never a second
  // figure of the adjudicators alone, and each shape's time counts the seats it launches after its verdicts (item 3).
  const timeWords = (f: ShapeFigure): string => (f.seconds_low === f.seconds_high ? `about ${humanSeconds(f.seconds_low)}` : `about ${humanSeconds(f.seconds_low)} to ${humanSeconds(f.seconds_high)}`);
  const recommended = figures.get("refute_later");
  const lines = [
    `layer 2 cost: ${preview.launches} launch(es) — ` +
      (recommended ? `${tokenRangeWords(recommended.tokens_low, recommended.tokens_high)}, ${timeWords(recommended)} in the recommended shape` : "not priced") +
      // no step number, no file word.
      ` — every group of places this scan wrote, read and judged once, and the second look; the searches for rules that found nothing, run` +
      ` before this price is shown, are not counted, and the second check is counted only in the shapes that include it`,
  ];
  const everything = preview.shapes.find((x) => x.shape === "full");
  for (const name of OFFER_ORDER) {
    const s = preview.shapes.find((x) => x.shape === name);
    const f = figures.get(name);
    if (!s || !f) continue;
    const head = `  ${SHAPE_WORDS[s.shape]}: ${s.launches} launch(es), ${tokenRangeWords(f.tokens_low, f.tokens_high)}, ${timeWords(f)}, ${s.candidates} candidate(s) adjudicated`;
    const check = f.second_check
      ? `; the second check is ${tokenRangeWords(f.second_check.low, f.second_check.high)} of that (one more seat per violation candidate, how many known only after the verdicts)`
      : "; no second check";
    const look = f.second_look.seats > 0 ? `; up to ${roughTokens(f.second_look.high)} tokens of it is the second look (at most ${f.second_look.seats} seat(s))` : "";
    if (s.shape === "important") {
      lines.push(
        `${head}${check}${look} — payloads holding a high-severity candidate (${s.selected_for_high_severity})` +
          ` or a rule this run launches only once (${s.selected_as_single_launch_rule}); ` +
          (everything && s.launches === everything.launches ? IMPORTANT_IS_EVERYTHING : "the rest are not dropped, they are left for a later run"),
      );
    } else {
      lines.push(`${head}${check}${look}`);
    }
  }
  // THE MODEL AND WHERE IT WAS MEASURED, on their own line rather than inside the figures above: a citation belongs
  // beside the number it justifies, and a reader who is deciding whether to spend money should not have to read past a
  // file path to reach the price. Printed on every run, because a constant nobody can trace is a constant nobody can re-take.
  lines.push(`  basis: ${PRICE_BASIS_WORDS} Source: ${preview.price_model.source}; ${preview.seconds_per_launch} s per launch (${preview.seconds_per_launch_source}).`);
  lines.push(
    "run shape: not chosen by this command — the skill asks before the first adjudicator is launched, and records the answer in the run's evidence log",
  );
  return lines;
}
