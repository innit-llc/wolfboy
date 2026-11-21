/**
 * THE SECOND LOOK (design-not-violations.md section 2.5 item 5, and the owner's
 * answer to its question 3 of 2026-11-02).
 *
 * In every run shape (the design named the recommended shape, which runs
 * no second check, and the shapes with it get it too because the ordinary refuter never challenges such a claim), a finding
 * the first review took out of what the report counts as a problem ON ITS OWN WORD gets one more seat: a `legal-refuter` in challenge mode, which tries to show
 * that the finding is one to fix after all. Exactly these findings, and no others (the approved set):
 *
 * - level high (the rule's level, or a raise; a raise by weight never reaches a finding outside "to fix", so before the
 *   assembly the level is the rule's); and
 * - placed `recorded` by the seat's own `duty_met` or `exempt` (never by an answer the person gave, never by the rule's
 *   `inventory` role), or `not_shipped` where the seat's own `ships` value says the decisive place does not ship and the
 *   program's premise for that place's file does not say so too (a value the capture filled from the premise, or one
 *   the premise agrees with, rests on the build files, not on the review's word). Only a `test` or `development`
 *   premise says so; every other class is information and never agrees.
 *
 * Not for a finding waiting on a question or for operators (the person answers those), not for medium or low.
 * AND, IN A SHAPE WITH THE SECOND CHECK ONLY, A HIGH
 * FINDING THE FIRST REVIEW RULED OUT (`not_applicable`, claim `not_applicable`; `dismissalClaimOf`). Until then a high candidate
 * a seat judged `not_applicable` went to the ruled-out list and no second agent read it. The shape the person chooses and pays
 * for with "+ second check" now gives it one more seat that tries to show the rule does apply here; the recommended shape is
 * unchanged. A look that agrees leaves it ruled out with the look beside it; one that finds against it or cannot settle it
 * leaves the finding to the person (the assembly's dismissal branch), never counted to fix on that seat's word alone.
 * AND A LOCATION OVERTURN THAT STANDS, AT EVERY LEVEL. Where the run has the
 * ordinary refuter, its overturn on a location ground (standing.ts `LOCATION_GROUNDS`) of a finding whose rule opts in
 * (`duty_about: product_runtime`) takes the finding out of the count on that seat's word: the ground can be true of the file
 * while the rule's duty still arises there (a server-side relay that discloses to a recipient, a published docs page). Such
 * a finding gets the same second look (`locationChallengeOf`, claim `location`), appended when the refuter's record is
 * captured, and the assembly's two-passes branch decides it: a look that agrees leaves the overturn as it stands, one that
 * finds against it or cannot settle it leaves the finding to the person. A run with no ordinary refuter has no such overturn.
 *
 * Which placement a finding takes is `disposition.ts`'s one function, asked here with no answer, no role and no second
 * look, so this module never decides a placement of its own: it only says which placements rest on the seat's word.
 * The launch side (`launch-later.ts`) asks it of each captured record as the record arrives; the assembly asks it again
 * with what only the assembly knows (a raise, the kept places, the fold), and a finding due a second look that has no
 * challenge entry is shown with the second look not answered, never silently as settled.
 */

import { createHash } from "node:crypto";
import { type DispositionInput, type SecondLook } from "./disposition.js";
import { claimOf, decisivePlaceOf, dispositionInputOfRecord } from "./finding-weight.js";
import type { PlaceRowIn } from "./severity-at-place.js";
import { evidenceIndexOf, placeId, placeIndexOf } from "./ref-ids.js";
import { NOT_SHIPPED, SHIPS_PREMISES, locationOverturnStands, shipsLentByPremise, type ShipsPremise, type StandingAt, type StandingRecord } from "./standing.js";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The launch-list entry field and the reply field that mark a challenge (refuter-reply.schema.json `$defs.challengeItem`). */
export const CHALLENGE_MODE = "challenge";

/** `challenge-` + 12 hex of sha256(finding_id): one challenge per finding. */
export const challengeEntryId = (findingId: string): string => `challenge-${createHash("sha256").update(findingId).digest("hex").slice(0, 12)}`;

/** Whether a launch-list entry is a challenge (a `refuter` entry with `mode: "challenge"`). */
export const isChallengeEntry = (e: unknown): boolean => isObject(e) && e.role === "refuter" && e.mode === CHALLENGE_MODE;

/** Whether a refuter's record object is a challenge reply. */
export const isChallengeRecord = (r: unknown): boolean => isObject(r) && r.mode === CHALLENGE_MODE;

const LOOK_ANSWERS: readonly string[] = ["upheld", "overturned", "needs_human"];
/**
 * A second look's answer as its record gives it: `upheld`, `overturned` or `needs_human`, and any other word (or none) read
 * as `needs_human`, an answer that settles nothing. The quote check writes `needs_human` into a record whose quotation it did
 * not find. The assembly (`assemble-report.ts` `secondLooksOf`) and the progress message at a tenth of the review
 * (`hook-launch.ts` `answersSoFar`) both read a record's outcome through this.
 */
export const lookAnswerOf = (outcome: unknown): Exclude<SecondLook, "not_answered"> =>
  (typeof outcome === "string" && LOOK_ANSWERS.includes(outcome) ? outcome : "needs_human") as Exclude<SecondLook, "not_answered">;

/**
 * Whether a second look leaves to the person a finding the ordinary
 * refuter overturned: one that found against the seat's claim (`overturned`) and one that could not settle it
 * (`needs_human`, as WP9 places an undecided second look). An agreeing second look (`upheld`) and none (`not_answered`, or
 * no entry) leave the overturn as it stands. The assembly's placement and the progress message's count both ask this, so
 * the two read the rule alike (the count runs no quote check: `answersSoFar`).
 */
export const lookLeavesOverturnToPerson = (look: SecondLook | undefined): boolean => look === "overturned" || look === "needs_human";

/**
 * What the first review said that took the finding out of the count, or (`location`) the ordinary refuter's location overturn,
 * or (`not_applicable`, a shape with the second check only) that the rule does not reach the code at all.
 */
export type ChallengeClaim = "duty_met" | "exempt" | "not_shipped" | "location" | "not_applicable";
/** Every claim a second look may check, as the launch list's entries and the log's `second_look.claim` name them. */
export const CHALLENGE_CLAIMS: readonly ChallengeClaim[] = ["duty_met", "exempt", "not_shipped", "location", "not_applicable"];

/** The line a claim rests on, as the challenge brief names it. */
export interface ClaimLine {
  file: string;
  lines: string;
  /** The quotation the record holds for that line; absent where the claim points at a place of the candidate. */
  quote?: string;
}

/** One finding due a second look, and the claim the seat tries to show wrong: the record's own parts, never its reasoning. */
export interface Challenge {
  finding_id: string;
  rule_id: string;
  claim: ChallengeClaim;
  /** `duty_met`: the element of the duty the line is said to meet. */
  element?: string;
  /** `exempt`: the basis of the rule's own and the limb. */
  exemption?: { basis: string; limb: string };
  /** `not_shipped`: the value the seat wrote (`documentation`, `development` or `test`). */
  ships?: string;
  /** `location`: the location ground the ordinary refuter overturned on (standing.ts `LOCATION_GROUNDS`). */
  ground?: string;
  /** The line the claim rests on; null where the record names none this module can resolve. */
  at: ClaimLine | null;
}

/**
 * The program's ships premise per file, as `ships` values (findings.json `ships_premises`; `shipsLentByPremise`), or
 * undefined where the scan recorded none. A premise the program does not know is `unknown`, which ships (design section
 * 5.2). The one reading of the document's premises: the assembly's disposition context reads them through this too. Only `test` and `development` lend a not-shipped value; every
 * other class is information only and reads here as `depends_on_deployment` (it ships), so the second look's "the
 * premise also says not shipped" counts only those two classes.
 */
export function premisesOfFindings(findings: unknown): Map<string, string> | undefined {
  const sp = isObject(findings) && isObject(findings.ships_premises) ? findings.ships_premises : null;
  if (!sp) return undefined;
  const lent = (p: string): string => ((SHIPS_PREMISES as readonly string[]).includes(p) ? shipsLentByPremise(p as ShipsPremise) : null) ?? "depends_on_deployment";
  return new Map(Object.entries(sp).map(([file, row]) => [file, lent(str(isObject(row) ? row.premise : undefined))] as const));
}

/**
 * The files whose ships premise is
 * `documentation` (findings.json `ships_premises`: plain prose the product does not render, ships-premise.ts), or
 * undefined where the scan recorded no premise. It lends no value (`premisesOfFindings` reads it as shipping); it is read
 * only where a seat's own `documentation` agrees with it (disposition.ts `effectiveShipsOf`). The one reading, for the
 * capture's second look and the assembly alike.
 */
export function documentationPagesOf(findings: unknown): Set<string> | undefined {
  const sp = isObject(findings) && isObject(findings.ships_premises) ? findings.ships_premises : null;
  if (!sp) return undefined;
  return new Set(Object.entries(sp).filter(([, row]) => isObject(row) && row.premise === "documentation").map(([file]) => file));
}

/**
 * The claim of a finding that rests on the seat's word alone, or null: finding-weight.ts `claimOf`, re-exported here (the capture's guard on a resend asks it too, and this module reads a
 * record through finding-weight.ts, so it lives there).
 */
export { claimOf };

/**
 * The claim of a high finding the first review ruled out (`not_applicable`), or null: only
 * where the run's shape has the second check (`secondCheck`, the shape the person chose and pays for), at level high, for a
 * rule whose role is not `inventory` (an inventory rule's finding is a record, never one to fix, so a look could not move
 * it). The verdict word is the seat's own; nothing else of the record is read.
 */
export function dismissalClaimOf(x: { verdict: string; level: string; role?: string; secondCheck: boolean }): "not_applicable" | null {
  return x.secondCheck && x.level === "high" && x.verdict === "not_applicable" && x.role !== "inventory" ? "not_applicable" : null;
}

/** The line a part's `at` names: an evidence entry, a place of the candidate, or a line of the tree. */
export function claimLineOf(at: StandingAt | undefined, record: Json, candidate: Json): ClaimLine | null {
  if (at === undefined) return null;
  if (isObject(at)) {
    const file = str(at.file);
    const line = Number(at.line);
    return file !== "" && Number.isInteger(line) && line > 0 ? { file, lines: String(line), ...(str(at.quote) !== "" ? { quote: str(at.quote) } : {}) } : null;
  }
  const ei = evidenceIndexOf(at);
  if (ei !== null) {
    const e = Array.isArray(record.evidence) ? record.evidence[ei] : undefined;
    if (!isObject(e) || str(e.file) === "") return null;
    const lines = typeof e.lines === "number" ? String(e.lines) : str(e.lines);
    return { file: str(e.file), lines, ...(str(e.quote) !== "" ? { quote: str(e.quote) } : {}) };
  }
  const pi = placeIndexOf(at);
  if (pi !== null) {
    const l = Array.isArray(candidate.locations) ? candidate.locations[pi] : undefined;
    if (!isObject(l) || str(l.file) === "") return null;
    return { file: str(l.file), lines: String(l.start_line ?? "") };
  }
  return null;
}

/** The parts of a challenge: the claim's own words and its line, from the record's standing block. */
export function challengeFrom(claim: ChallengeClaim, record: Json, candidate: Json): Challenge {
  const st = (isObject(record.standing) ? record.standing : {}) as StandingRecord;
  const base = { finding_id: str(record.finding_id), rule_id: str(candidate.rule_id), claim };
  if (claim === "not_applicable") {
    // The line the seat quoted as part of why the finding does not hold (an evidence entry of role `dismissal`), else the
    // first line it quoted, else the candidate's first place: a quotation of the repository, never the seat's reasoning.
    const ev = (Array.isArray(record.evidence) ? record.evidence : []).filter((e): e is Json => isObject(e) && str(e.file) !== "");
    const e = ev.find((x) => x.role === "dismissal") ?? ev[0];
    if (e) return { ...base, at: { file: str(e.file), lines: typeof e.lines === "number" ? String(e.lines) : str(e.lines), ...(str(e.quote) !== "" ? { quote: str(e.quote) } : {}) } };
    return { ...base, at: claimLineOf(placeId(0), record, candidate) };
  }
  if (claim === "not_shipped") return { ...base, ships: st.ships?.value ?? "", at: claimLineOf(st.ships?.at, record, candidate) };
  const at = claimLineOf(st.status?.at, record, candidate);
  if (claim === "exempt") return { ...base, ...(st.exemption ? { exemption: { basis: st.exemption.basis, limb: st.exemption.limb } } : {}), at };
  return { ...base, ...(typeof st.element === "string" ? { element: st.element } : {}), at };
}

/**
 * The challenge a captured adjudicator record's verdict object is due, or null: at capture time, from the record, the
 * candidate as the payload holds it, the rule's role and the scan's premises. The level is the rule's (no raise is known
 * before the assembly); the kept places are the candidate's locations (a place-read candidate's kept rows are the
 * assembly's), and the assembly asks again with its own (`claimOf`).
 *
 * THE CAPTURE ASKS WHEREVER THE ASSEMBLY COULD FIND A NOT-SHIPPED CLAIM. A place-read candidate's kept
 * places are decided by its place seats, which the capture does not know: the assembly reads only the places they kept,
 * so a `ships` the seat gave for one place (P1) can take the finding out there while every location read together here
 * still ships, and no look was ever asked. Row 4 holds on a set of kept places only where it holds on each of them kept
 * alone, so where no claim is found over every location, a place-read candidate is asked the not-shipped claim if any one
 * location, kept alone, would give it. That may ask a look the kept places later make needless (a paid seat, never a
 * finding left out); and a look the assembly finds due that none answered no longer lets row 4 take the finding out
 * (disposition.ts `rowFourShipsOf`).
 */
export function challengeOf(a: { record: Json; candidate: Json; role?: string; dutyAbout?: string; declaredInapplicable?: readonly { field: string; kind?: string }[]; premises?: ReadonlyMap<string, string>; documentationPages?: ReadonlySet<string>; secondCheck?: boolean }): Challenge | null {
  // A ruled-out finding: its claim is the verdict word's, in a shape with the second check.
  if (a.record.verdict === "not_applicable") {
    const claim = dismissalClaimOf({ verdict: "not_applicable", level: str(a.candidate.severity), ...(a.role ? { role: a.role } : {}), secondCheck: a.secondCheck === true });
    return claim === null ? null : challengeFrom(claim, a.record, a.candidate);
  }
  const st = isObject(a.record.standing) ? (a.record.standing as StandingRecord) : undefined;
  if (!st) return null;
  /* The record read into a disposition input by the one reading the report and
   * the capture's guard share (finding-weight.ts `dispositionInputOfRecord`, `decisivePlaceOf`): before, this module read
   * it a second way (its own decisive file and lines, its own `ships` line), and `P<n>` named another place than the
   * report's. Its kept places are the candidate's locations (no rows: the assembly's kept rows are its own); a location
   * kept alone is a stand-in row of that place. */
  const rule = str(a.candidate.rule_id);
  const facts = { ...(a.premises ? { premises: a.premises } : {}), ...(a.documentationPages ? { documentationPages: a.documentationPages } : {}), ...(a.dutyAbout ? { duties: new Map([[rule, a.dutyAbout]]) } : {}) };
  const extra = a.declaredInapplicable && a.declaredInapplicable.length > 0 ? { declared: a.declaredInapplicable } : {};
  const claimAt = (rows: readonly PlaceRowIn[]): ChallengeClaim | null => {
    const input = dispositionInputOfRecord(a.record, a.candidate, rows, facts, extra);
    // With no usable `decisive`, the heaviest place, weighed with the same facts.
    const decisiveFile = decisivePlaceOf(a.record, rows, a.candidate, facts)?.file;
    const decisivePremise = decisiveFile !== undefined ? a.premises?.get(decisiveFile) : undefined;
    return claimOf({ input, level: str(a.candidate.severity), ...(a.role ? { role: a.role } : {}), ...(decisivePremise !== undefined ? { decisivePremise } : {}) });
  };
  let claim = claimAt([]);
  const placeRead = isObject(a.candidate.reading_plan) && a.candidate.reading_plan.unit === "place";
  if (claim === null && placeRead && st.ships && NOT_SHIPPED.has(st.ships.value)) {
    const locs = Array.isArray(a.candidate.locations) ? a.candidate.locations : [];
    for (let i = 0; i < locs.length && claim === null; i++) {
      const l = locs[i];
      // A kept place row (place-bar.ts `KEPT_DECISIONS`) standing in for the location, as the assembly would hold it kept alone.
      if (isObject(l) && str(l.file) !== "" && claimAt([{ place: placeId(i), file: str(l.file), line: Number(l.start_line) || 1, decision: "is_the_construct" }]) === "not_shipped") claim = "not_shipped";
    }
  }
  return claim === null ? null : challengeFrom(claim, a.record, a.candidate);
}

/**
 * The second look an ordinary refuter's record object is due, or null: where it
 * overturns on a location ground and the rule opts in (`locationOverturnStands`), at every level. `rule` is the rule's block
 * (or the candidate, which carries `duty_about` as the findings document does). The claim is the ground's word and the
 * first line the refuter quoted; nothing of its reasoning.
 */
export function locationChallengeOf(a: { refutation: Json; candidate: Json; rule?: Json }): Challenge | null {
  if (!locationOverturnStands(a.refutation, a.rule ?? a.candidate)) return null;
  const e = (Array.isArray(a.refutation.evidence) ? a.refutation.evidence : []).find((x) => isObject(x) && str(x.file) !== "");
  const at: ClaimLine | null = isObject(e) ? { file: str(e.file), lines: typeof e.lines === "number" ? String(e.lines) : str(e.lines), ...(str(e.quote) !== "" ? { quote: str(e.quote) } : {}) } : null;
  return { finding_id: str(a.refutation.finding_id), rule_id: str(a.candidate.rule_id), claim: "location", ground: str(a.refutation.grounds), at };
}
