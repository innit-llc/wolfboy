/**
 * ONE FINDING AS THE PROGRAM REPORTS IT, FROM ITS RECORD.
 *
 * The report (assemble-report.ts) and the capture's guard on a resend (verdict-capture.ts `captureAnswer`, amend.ts
 * module comment THE OUTCOME) read a finding from one record the same way, here: the decisive place, the file a `ships`
 * part quotes, the disposition's input (`dispositionInputOfRecord`), and, for the guard, the weight of the finding
 * (`outcomeWeightOf`). The level, the count and the disposition are the program's own functions (fix-order.ts
 * `standingOrderOf`, `raisedByWeight`; disposition.ts `dispositionOf`, `DISPOSITION_WEIGHT`); nothing here is a second copy
 * of them. Moved out of assemble-report.ts so the capture reads a record as the report does.
 *
 * Pure: no file is read, no clock, no randomness. In the capture's closure (`VERDICT_RULES_SOURCES`).
 */

import { countsAsProblem, dispositionOf, DISPOSITION_WEIGHT, effectiveShipsOf, lineSpansOf, notShipped, rowFourShipsOf, type Disposition, type DispositionInput, type GivenAnswer, type LineSpan, type SecondLook } from "./disposition.js";
import { raisedByWeight, standingOrderOf, type TierOf } from "./fix-order.js";
import { onlyDocumentation } from "./fold-findings.js";
import { KEPT_DECISIONS } from "./place-bar.js";
import { evidenceIndexOf, isPlaceId, placeIndexOf } from "./ref-ids.js";
import type { ChallengeClaim } from "./second-look.js";
import type { PlaceRowIn } from "./severity-at-place.js";
import { NOT_SHIPPED, type StandingRecord } from "./standing.js";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A place a finding stands on: its file, its first line, and the lines of its quotation where it is one. */
export interface FindingPlace {
  file: string;
  line: number;
  spans?: LineSpan[];
}

/**
 * The finding's decisive place: the `decisive` quotation's place (`E<n>` an entry of the verdict's evidence, `P<n>` a kept
 * place row), where its block names one that resolves; else, where a candidate is given, the heaviest of the places the
 * finding stands on (`heaviestPlaceOf`, weighed with `facts`); else null (T6). A screen that only names a finding passes no
 * candidate and takes no stand-in (assemble-report.ts `namingPlaceOf`). `P<n>` is read one way everywhere: the kept place row with that id, else
 * the candidate's location of that index (as `shipsAtFileOf` reads a `ships` part's `P<n>`); before, with no row at hand
 * it fell to the first quotation, while the second look read the location (second-look.ts, which now reads it here). The one reading of the decisive place: the guard on a resend
 * (`outcomeWeightOf`), the report (`dispositionInputOfRecord`, its first review's claim, the place a raise rests on) and
 * the second look (second-look.ts `challengeOf`) all read it here, with the same facts.
 */
export function decisivePlaceOf(v: Obj, rows: readonly PlaceRowIn[], c?: Obj, facts: WeighFacts = {}): FindingPlace | null {
  const d = str(obj(v.standing)?.decisive);
  // ref-ids.ts: `E<n>` counts from E1, `P<n>` from P0 (the smoke test's decisive `P0` was refused here too).
  const ei = evidenceIndexOf(d);
  if ((ei !== null || isPlaceId(d)) && v.quote_check_outcome !== "invalidated") {
    if (ei !== null) {
      const e = obj(arr(v.evidence)[ei]);
      // The quotation's lines: row 4 gives the seat's `ships` to the kept
      // places inside the decisive quotation (disposition.ts `effectiveShipsOf`). Read by `lineSpansOf`, as the capture reads them:
      // "12, 15" is lines 12 and 15 (before, line 12 alone), "L12" is line 12 (before, no line, so the first kept place stood
      // in for the decisive one).
      const spans = e ? lineSpansOf(e.lines) : [];
      if (e && str(e.file) && spans.length > 0) return { file: str(e.file), line: spans[0]!.from, spans };
    } else {
      const r = rows.find((x) => x.place === d && KEPT_DECISIONS.has(str(x.decision)));
      if (r) return { file: r.file, line: r.line };
      const pi = placeIndexOf(d);
      const l = pi !== null ? obj(arr(c?.locations)[pi]) : undefined;
      if (l && str(l.file)) return { file: str(l.file), line: Number(l.start_line) || 1 };
    }
  }
  return c === undefined ? null : heaviestPlaceOf(v, rows, c, facts);
}

/**
 * THE HEAVIEST PLACE (the parent's decision):
 * where the block names no usable decisive place (`decisive` left out, set aside after the last refusal, or naming no
 * entry), the program reads as decisive the heaviest of the places the finding stands on, never the first by order, so
 * the order of `evidence` never decides whether a finding is counted, and a part set aside is read as if it were at its
 * heaviest (legal-adjudicator.md, the `standing` item). Before, the first kept place or the first quotation stood in.
 *
 * The places: the finding's kept places (its kept place rows, else the candidate's locations) and every quotation of its
 * `evidence` that names lines (`lineSpansOf`). One of them stood in before, so the heaviest is never lighter than that one.
 * Each is weighed as row 4, the second look and the fold read the decisive place (what `outcomeWeightOf` weighs of it), with
 * the scan's premise for each place's file read as the report reads it (`facts`), by three counts, the first that differs
 * deciding:
 * 1. row 4 does not hold there on the seat's word (disposition.ts `effectiveShipsOf`, `notShipped`): where the seat gave no
 *    `ships`, a place whose file ships beats one whose file does not; where its `ships` does not ship, a place whose
 *    quotation gives that value to no kept place that ships beats one that gives it to such a place;
 * 2. the premise does not class the place's file as not shipped: there a seat's own not-shipped `ships` is a claim a
 *    second look must answer before row 4 reads it (`claimOf`, at high), where at a not-shipped place it is not;
 * 3. the finding is not counted inside another there as documentation only (fold-findings.ts `onlyDocumentation`).
 * Places equal on all three give the finding the same placement, look and fold; of those the first is taken, in the
 * order kept places, quotations, locations (the order the stand-in was looked for before).
 * Computed, never stored: the capture's merge writes no `decisive` for it (amend.ts `followPointers`).
 */
function heaviestPlaceOf(v: Obj, rows: readonly PlaceRowIn[], c: Obj, facts: WeighFacts = {}): FindingPlace | null {
  const kept = rows.filter((x) => KEPT_DECISIONS.has(str(x.decision)));
  const places: FindingPlace[] = [
    ...kept.map((r) => ({ file: r.file, line: r.line })),
    ...arr(v.evidence).flatMap((x): FindingPlace[] => {
      const e = obj(x);
      const spans = e ? lineSpansOf(e.lines) : [];
      return e && str(e.file) && spans.length > 0 ? [{ file: str(e.file), line: spans[0]!.from, spans }] : [];
    }),
    ...(kept.length > 0 ? [] : arr(c.locations).flatMap((x): FindingPlace[] => {
      const l = obj(x);
      return l && str(l.file) ? [{ file: str(l.file), line: Number(l.start_line) || 1 }] : [];
    })),
  ];
  const parts = rowFourPartsOf(v, kept, c);
  const weightAt = (p: FindingPlace): number[] => {
    const ships = shipsAt(parts, p, facts, parts.seat);
    const premise = facts.premises?.get(p.file);
    return [notShipped(ships) ? 0 : 1, premise !== undefined && NOT_SHIPPED.has(premise) ? 0 : 1, onlyDocumentation({ ships }) ? 0 : 1];
  };
  // The first place that differs decides; equal on every count, the earlier place stays.
  const heavier = (a: readonly number[], b: readonly number[]): boolean => {
    const i = a.findIndex((x, n) => x !== b[n]);
    return i >= 0 && a[i]! > b[i]!;
  };
  let best: { place: FindingPlace; weight: number[] } | null = null;
  for (const place of places) {
    const weight = weightAt(place);
    if (best === null || heavier(weight, best.weight)) best = { place, weight };
  }
  return best?.place ?? null;
}

/** What row 4 reads of a record besides its decisive place: the kept places, and the seat's `ships` with the file of its line. */
interface RowFourParts {
  keptFiles: string[];
  keptLines: (number | undefined)[];
  seat?: string;
  seatAtFile?: string;
}
function rowFourPartsOf(v: Obj, kept: readonly PlaceRowIn[], candidate: Obj | undefined): RowFourParts {
  const raw = obj(v.standing);
  const st = v.quote_check_outcome !== "invalidated" && raw ? (raw as StandingRecord) : undefined;
  const locations = arr(candidate?.locations).map(obj);
  const seat = typeof st?.ships?.value === "string" ? st.ships.value : undefined;
  const seatAtFile = shipsAtFileOf(st?.ships?.at, v, kept, candidate);
  return {
    keptFiles: kept.length > 0 ? kept.map((r) => r.file) : locations.map((l) => str(l?.file)).filter(Boolean),
    keptLines: kept.length > 0 ? kept.map((r) => r.line) : locations.filter((l) => str(l?.file)).map((l) => Number(l?.start_line) || undefined),
    ...(seat !== undefined ? { seat } : {}),
    ...(seatAtFile !== undefined ? { seatAtFile } : {}),
  };
}
/** Row 4's `ships` with `place` as the decisive place (disposition.ts `effectiveShipsOf`); `seat` undefined: the premises alone. */
function shipsAt(p: RowFourParts, place: FindingPlace | null, facts: WeighFacts, seat: string | undefined): NonNullable<DispositionInput["ships"]> {
  return effectiveShipsOf({
    ...(seat !== undefined ? { seat } : {}),
    ...(seat !== undefined && p.seatAtFile !== undefined ? { seatAtFile: p.seatAtFile } : {}),
    ...(place ? { decisiveFile: place.file, decisiveLines: place.spans ?? [{ from: place.line, to: place.line }] } : {}),
    keptFiles: p.keptFiles,
    keptLines: p.keptLines,
    ...(facts.premises ? { premises: facts.premises } : {}),
    ...(facts.documentationPages ? { documentationPages: facts.documentationPages } : {}),
  });
}
/**
 * The file of the line a `ships` part quotes: a line read (`{ file, line }`), an
 * evidence entry (`E<n>`), or a kept place (`P<n>`: its row, else the candidate's location); undefined where it resolves
 * to none, which `effectiveShipsOf` reads as a line inside the decisive place's file (the narrower reach).
 */
export function shipsAtFileOf(at: unknown, v: Obj, rows: readonly PlaceRowIn[], c?: Obj): string | undefined {
  if (v.quote_check_outcome === "invalidated") return undefined;
  const o = obj(at);
  if (o) return str(o.file) || undefined;
  const ei = evidenceIndexOf(at);
  if (ei !== null) return str(obj(arr(v.evidence)[ei])?.file) || undefined;
  if (!isPlaceId(at)) return undefined;
  const r = rows.find((x) => x.place === at);
  if (r) return r.file || undefined;
  const pi = placeIndexOf(at);
  return pi !== null ? str(obj(arr(c?.locations)[pi])?.file) || undefined : undefined;
}

/** What the disposition reads from the run, by rule id or finding id (assemble-report.ts makes it once per assembly). */
export interface DispositionFacts {
  premises?: ReadonlyMap<string, string>;
  /** The files whose premise is `documentation`. */
  documentationPages?: ReadonlySet<string>;
  answers?: ReadonlyMap<string, GivenAnswer>;
  roles?: ReadonlyMap<string, string>;
  duties?: ReadonlyMap<string, string>;
  settlers?: ReadonlyMap<string, readonly string[]>;
  secondLooks?: ReadonlyMap<string, SecondLook>;
}

/**
 * One finding's disposition input, resolved from its record, its candidate, its kept place rows and the run's facts
 * (design section 2.1). A record the final quotation check invalidated gives no part (S7): its block is set aside whole.
 * `foldedUnder`: the head the fold put it under; `declared`: its declared-inapplicable preconditions as declaration.ts reads
 * them (WP4's kinds), which the caller resolves.
 */
export function dispositionInputOfRecord(v: Obj, candidate: Obj | undefined, rows: readonly PlaceRowIn[], ctx: DispositionFacts, extra: { foldedUnder?: string; declared?: readonly { field: string; kind?: string }[] } = {}): DispositionInput {
  const id = str(v.finding_id);
  const invalid = v.quote_check_outcome === "invalidated";
  const raw = obj(v.standing);
  const st = !invalid && raw ? (raw as StandingRecord) : undefined;
  const setAside = [...new Set([...arr(v.standing_set_aside).map((x) => str(obj(x)?.part)).filter(Boolean), ...(invalid && raw ? ["standing"] : [])])];
  const kept = rows.filter((r) => KEPT_DECISIONS.has(str(r.decision)));
  // Each kept place's line, the decisive quotation's lines and the file of the
  // line the seat's `ships` quotes: its value reaches only the kept places it was given for (disposition.ts `effectiveShipsOf`). With no usable `decisive`, the heaviest place (`decisivePlaceOf`).
  const parts = rowFourPartsOf(v, kept, candidate);
  const decisivePlace = decisivePlaceOf(v, kept, candidate, ctx);
  // Row 5's input through declaration.ts's one reading (WP4's kinds).
  const declared = extra.declared ?? [];
  const role = ctx.roles?.get(str(candidate?.rule_id));
  const dutyAbout = ctx.duties?.get(str(candidate?.rule_id));
  const settling = ctx.settlers?.get(str(candidate?.rule_id)) ?? [];
  const second = ctx.secondLooks?.get(id);
  const folded = extra.foldedUnder;
  const shipsBy = (s: string | undefined) => shipsAt(parts, decisivePlace, ctx, s);
  return {
    verdict: str(v.verdict),
    ...(st ? { standing: st } : {}),
    ...(setAside.length > 0 ? { setAside } : {}),
    ...(folded ? { foldedUnder: folded } : {}),
    ships: shipsBy(parts.seat),
    // Row 4 while a look due on the
    // finding is not answered: the premises alone, as if the seat had given no `ships` (disposition.ts `rowFourShipsOf`).
    shipsWithoutSeat: shipsBy(undefined),
    ...(declared.length > 0 ? { declaredInapplicable: declared } : {}),
    ...(ctx.answers ? { answers: ctx.answers } : {}),
    ...(settling.length > 0 ? { settlingQuestions: settling } : {}),
    ...(role ? { role } : {}),
    ...(dutyAbout ? { dutyAbout } : {}),
    ...(second ? { secondLook: second } : {}),
  };
}

/**
 * The claim of a finding that rests on the seat's word alone, or null. `input` is the finding's disposition input as its
 * caller resolved it; its answers, role and second look are not read (a placement by an answer or by the rule's role is
 * not the seat's word, and a second look is what this decides on). `decisivePremise` is the program's premise for the
 * decisive place's file, as a `ships` value, where one was recorded. Moved
 * here from second-look.ts, which re-exports it: the capture's guard on a resend asks it too (`outcomeWeightOf`).
 */
export function claimOf(x: { input: DispositionInput; level: string; role?: string; decisivePremise?: string }): ChallengeClaim | null {
  if (x.level !== "high" || x.input.verdict !== "violation_candidate" || x.role === "inventory") return null;
  const placed = dispositionOf({ ...x.input, answers: new Map(), role: undefined, secondLook: undefined }).disposition;
  const st = x.input.standing;
  if (placed === "recorded") {
    const s = st?.status?.value;
    return s === "duty_met" || s === "exempt" ? s : null;
  }
  if (placed === "not_shipped") {
    const ships = st?.ships;
    // The capture filled it from the premise, or the seat agreed with it without a line of its own: the build files' word.
    if (!ships || ships.premise !== undefined || !NOT_SHIPPED.has(ships.value)) return null;
    // The seat and the premise both say the decisive place does not ship.
    if (x.decisivePremise !== undefined && NOT_SHIPPED.has(x.decisivePremise)) return null;
    return "not_shipped";
  }
  return null;
}

/**
 * THE WEIGHT OF ONE FINDING, FOR THE GUARD ON A RESEND
 * (the parent's decision: guard the outcome, not the inputs; amend.ts module comment, THE OUTCOME). The capture weighs the
 * finding two answers make, over the same candidate and the same facts, and asks only whether one is lighter.
 *
 * AS THE REPORT WEIGHS IT. Every input the report's disposition reads
 * (assemble-report.ts, step 12d: `dispositionInputOf`, `firstReviewClaimOf`, the raise by weight, the fold) is read here
 * the same way, or, where the capture cannot know it, weighed under every value it could take, or left out where leaving
 * it out can only make the guard refuse more:
 * - the record, the candidate, the scan's premises and documentation pages, the rule's `duty_about` and `finding_role`
 *   (copied into the findings document): read as the report reads them (`dispositionInputOfRecord`);
 * - the kept places: the place table of a candidate read place by place, made from the readers' records and the answer's
 *   own rows as the assembly makes it (reading-assembly.ts `weigh`, `rows`); else the candidate's locations, as the report;
 * - the second look: asked as the report asks it (`claimOf`, at the level, with the role and the decisive file's
 *   premise), and a look that is due is weighed as not answered (at capture none has answered): so a seat's own
 *   not-shipped `ships`, which a look must answer before row 4 reads it, is not as light as one the premise fills;
 * - the level: the rule's own, and high where the rule's own is lower (a raise the capture cannot see, the transport's at
 *   one call, severity-at-place.ts `composeSeverities`, rests on other findings): the look is asked at each; a raise by
 *   weight is weighed only where the level is medium or low, as the report raises (F5);
 * - the penalty table: none at the top, and each basis alone at the top (the raise rests only on whether a basis that
 *   stood is at the top);
 * - the fold: a `same_as` that stood is weighed as the fold it asks for; every kept place documentation (key (a),
 *   fold-findings.ts `onlyDocumentation`) as a finding that may be counted inside another of its rule (`folds`).
 * Not read: the person's answers and the rule's `settling_questions` (rows 5 to 8 by an answer: the questions a rule lists
 * are in the rule bundle, which the capture does not load, and an answer is the person's, not the seat's), weighed as no
 * answer; a declared-inapplicable precondition (row 5), the candidate's alone, the same for both answers, so leaving it
 * out only weighs the rows below it more finely; the final quotation check (S7, at assembly).
 */
export interface OutcomeWeight {
  /** Per level the finding may be shown at (the rule's own first): its placement and its raise by weight. */
  worlds: OutcomeWorld[];
  /** The disposition its verdict and its status alone give (no `ships`, no fold, no answer): the weight of its status. */
  status: Disposition;
  /** It may be counted inside another finding of its rule: every kept place's `ships` is documentation (fold key (a)). */
  folds: boolean;
}
export interface OutcomeWorld {
  level: string;
  /** The disposition the program places the finding at (`dispositionOf`), with a look that is due not answered. */
  placed: Disposition;
  /** Per table (none at the top, then each basis alone, in `legal_basis_refs` order): raised to high by weight as a finding to fix (`raisedByWeight`). */
  raised: boolean[];
}

/** The facts of the scan the guard weighs a finding with (`outcomeWeightOf`): the findings document's premises. */
export interface WeighFacts {
  premises?: ReadonlyMap<string, string>;
  documentationPages?: ReadonlySet<string>;
}

/** A table that puts `top` at the top tier and every other cite below it (`top` null: none at the top). */
const tableWith =
  (top: string | null): TierOf =>
  (cite) => ({ tier: top !== null && cite === top ? "top" : "not_top", regime: "", regimeId: "", penaltyCite: "", tiered: true, line: "", provision: "", provisions: [] });

/**
 * The finding one record entry makes, weighed (`OutcomeWeight`). `rows`: the candidate's place table where it is read
 * place by place (the report's kept places), else none.
 */
export function outcomeWeightOf(entry: Obj, candidate: Obj | undefined, facts: WeighFacts = {}, rows: readonly PlaceRowIn[] = []): OutcomeWeight {
  const rule = str(candidate?.rule_id);
  const dutyAbout = str(candidate?.duty_about);
  const role = str(candidate?.finding_role);
  const sameAs = entry.quote_check_outcome === "invalidated" ? undefined : obj(obj(entry.standing)?.same_as);
  const input = dispositionInputOfRecord(
    entry,
    candidate,
    rows,
    { ...facts, ...(dutyAbout ? { duties: new Map([[rule, dutyAbout]]) } : {}), ...(role ? { roles: new Map([[rule, role]]) } : {}) },
    sameAs ? { foldedUnder: `${str(sameAs.file)}:${String(sameAs.line ?? "")}` } : {},
  );
  const status = dispositionOf({ verdict: input.verdict, ...(input.standing ? { standing: input.standing } : {}), ...(input.setAside ? { setAside: input.setAside } : {}) }).disposition;
  // The decisive file's premise, as the report's `firstReviewClaimOf` reads it (its kept rows only, the same facts).
  const decisiveFile = decisivePlaceOf(entry, rows.filter((r) => KEPT_DECISIONS.has(str(r.decision))), candidate, facts)?.file;
  const decisivePremise = decisiveFile !== undefined ? facts.premises?.get(decisiveFile) : undefined;
  const own = str(candidate?.severity);
  const levels = own === "high" || own === "critical" ? [own] : [own, "high"];
  const refs = arr(candidate?.legal_basis_refs).filter((c): c is string => typeof c === "string");
  const worlds = levels.map((level): OutcomeWorld => {
    const due = claimOf({ input, level, ...(role ? { role } : {}), ...(decisivePremise !== undefined ? { decisivePremise } : {}) }) !== null;
    const x: DispositionInput = due ? { ...input, secondLook: "not_answered" } : input;
    const placed = dispositionOf(x).disposition;
    const shipsKept = rowFourShipsOf(x)?.kept ?? [];
    const raises = (level === "medium" || level === "low") && countsAsProblem(placed);
    const raised = [null, ...refs].map((top) => raises && raisedByWeight(standingOrderOf({ verdict: entry, candidate, tierOf: tableWith(top), ...(dutyAbout ? { dutyAbout } : {}), shipsKept })));
    return { level, placed, raised };
  });
  return { worlds, status, folds: !sameAs && onlyDocumentation({ ...(input.ships ? { ships: input.ships } : {}) }) };
}

/** The weight of a disposition (`DISPOSITION_WEIGHT`); one with none is lighter than all. */
const weightOf = (d: Disposition): number => DISPOSITION_WEIGHT[d] ?? 0;

/**
 * How `now` is lighter than `before`, in words for the record; null where it is not: at some level, out of the count, a
 * disposition further from "to fix", or no longer raised by weight under some table; a weaker status; or counted inside
 * another finding where it was not.
 */
export function lighterOutcome(now: OutcomeWeight, before: OutcomeWeight): string | null {
  for (const [i, b] of before.worlds.entries()) {
    const n = now.worlds[i];
    if (!n) continue;
    const at = i > 0 ? ` at level ${b.level}` : "";
    if (countsAsProblem(b.placed) && !countsAsProblem(n.placed)) return `out of the count (${b.placed} to ${n.placed})${at}`;
    if (weightOf(n.placed) < weightOf(b.placed)) return `placed further from to_fix (${b.placed} to ${n.placed})${at}`;
    if (b.raised.some((r, j) => r && n.raised[j] !== true)) return "a lower level (no longer raised to high by weight)";
  }
  if (weightOf(now.status) < weightOf(before.status)) return `a weaker status (${before.status} to ${now.status})`;
  if (now.folds && !before.folds) return "counted inside another finding of its rule (every kept place documentation)";
  return null;
}
