/**
 * THE DISPOSITION OF AN ADJUDICATED FINDING.
 *
 * WHY. The report decided what is a problem from the verdict word and the rule's level, and the verdict word has no way
 * to say "present, and not a problem": a construct a seat kept was counted as a problem whether its duty was met, it was
 * exempt, it waited on a fact only the person holds, or it was not part of what ships. One pure function now gives every
 * adjudicated finding exactly one DISPOSITION, and every presenter (the report's headline and sections, the details'
 * labels, the end-of-run screen, the evidence log) is to read the disposition, never the verdict word. Only `to_fix` is
 * counted as a problem, at every level.
 *
 * THE ORDER (design section 2.2): the first of the ten rows that holds.
 *
 *   1 `settled_by_answer`  the rule was settled by a scope answer from a confirmed record; no seat ran
 *   2 `not_applicable`     the verdict is `not_applicable`
 *   3 `folded`             folded under a head finding of the same rule (counted once, in the head)
 *   4 `not_shipped`        the decisive place and every kept place are documentation, development or test, and the
 *                          rule declares that its duty attaches only to what the product does when it runs
 *                          (`duty_about: product_runtime`); a rule that declares nothing never takes this row
 *   5 `check_answer`       the candidate carries a declared-inapplicable precondition on a `feature` question
 *   6 `question`           waits on a question not yet answered, or on a fact named in words; or `needs_human` settled
 *                          by a question not yet answered
 *   7 `for_operators`      waits on a question the person answered as the maker (`settles_as: maker`)
 *   8 `recorded`           `duty_met` or `exempt` with its part; or an `inventory` rule's finding the seat did not mark
 *                          `duty_unmet`; or waits on a question answered with `settles_as: met`
 *   9 `counsel`            `needs_human` (the law unclear, the code not readable, or nothing that stood)
 *  10 `to_fix`             everything else
 *
 * Rows 4 and 8 never apply to a finding a second look overturned. Rows 1-5 rest on the program's facts (the person's
 * confirmed answer, the verdict word, the fold, the ships premise, the candidate's preconditions); rows 6-8 rest on the
 * seat's `standing` parts, each with its own quotation checked at capture.
 *
 * WHAT IS NOT ESTABLISHED STAYS IN SIGHT. A finding the
 * review could not settle is never placed where the report lists it as not counted as a problem: a `needs_human`
 * verdict (the seat's, or a second review's that the merge made the verdict) never reaches row 4 or row 8, and a second look that answered
 * `needs_human` turns a row-4 or row-8 placement into `counsel`. `counsel` is counted on the first screen beside the
 * findings to fix ("need your judgement"), at every level.
 *
 * THE DIRECTION OF DOUBT (H5a, design section 2.5): a part that was needed and is not there places the finding as if
 * the heaviest value stood, and the heaviest value is `to_fix`. A status the capture set aside is `duty_unmet`; a
 * `waits_on_answer` with neither a question nor a fact, a `duty_met` without its `element` and an `exempt` without its
 * `exemption` are placed as `duty_unmet`; a verdict word that is not one of the three, and an answered question whose
 * option carries no known `settles_as`, are `to_fix`. Each such part is named in `missing`, so the report can say why. A
 * status the seat left out is not a status set aside: it reaches row 8 only for an `inventory` rule (whose role is the
 * rule's, verified, not the seat's), and is otherwise `to_fix` (row 10) or, on `needs_human`, `counsel` (row 9).
 *
 * WHAT THIS MODULE IS NOT (yet). It takes its inputs RESOLVED by the caller: the effective `ships` of each kept place
 * (the seat's accepted value, else the program's premise), the fold's head, the settlement by a scope answer, the
 * person's confirmed answers by question id with each option's `settles_as`, the kinds of the candidate's declared
 * inapplicable preconditions and the second look's outcome. Computing those, and calling this function from the
 * assembly, are the later packages' (design section 7: WP1 capture, WP3 the report, WP4 questions, WP6 the premise, WP7
 * the fold, WP9 the second look). Nothing calls it yet, so it changes no output.
 *
 * Pure: no file is read, no clock, no randomness. Not in the capture's closure (`VERDICT_RULES_SOURCES`): the
 * disposition decides what the report counts, never what a verdict may be.
 */

import { HEAVIEST, NOT_SHIPPED, SHIPS_MAY_DECIDE, type DutyAbout, type FindingRole, type QuestionKind, type SettlesAs, type StandingRecord } from "./standing.js";

/** The ten dispositions, in the order of the rows (row n is index n-1). */
export const DISPOSITIONS = [
  "settled_by_answer",
  "not_applicable",
  "folded",
  "not_shipped",
  "check_answer",
  "question",
  "for_operators",
  "recorded",
  "counsel",
  "to_fix",
] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

/** The one disposition counted as a problem, at every level. */
export const COUNTED_AS_PROBLEM: Disposition = "to_fix";
export const countsAsProblem = (d: Disposition): boolean => d === COUNTED_AS_PROBLEM;

/** The verdict words a record may carry (verdict.schema.json `verdict`). */
const VERDICTS: ReadonlySet<string> = new Set(["violation_candidate", "needs_human", "not_applicable"]);
const SETTLES_AS_KNOWN: ReadonlySet<string> = new Set<SettlesAs>(["out_of_scope", "met", "stands", "maker"]);

/** A settlement by a scope answer, as findings.json's per-rule applicability row records it (`settled_by`). */
export interface SettledBy {
  field: string;
  answer: unknown;
  recorded_at: string;
}

/** The second look's outcome on this finding (design section 2.5); absent where none was appended. */
export type SecondLook = "upheld" | "overturned" | "needs_human" | "not_answered";

/** One answer the person gave and a later scan may use (a confirmed record), by the option's `settles_as`. */
export interface GivenAnswer {
  /** The `settles_as` of the option the person chose; absent where the option declares none. */
  settlesAs?: SettlesAs | string;
}

export interface DispositionInput {
  /** The verdict word as the record holds it after the merge; absent where no seat ran (row 1 only). */
  verdict?: string;
  /** The `standing` parts that stood (standing.ts `checkStanding`, and the final quote check S7 at assembly). */
  standing?: StandingRecord;
  /** The parts the capture or S7 set aside (`standing_set_aside[].part`): `status` or the whole `standing` is heaviest. */
  setAside?: readonly string[];
  /** Row 1: the rule was settled by a scope answer from a confirmed record (findings.json `settled_by`); no seat ran. */
  settledBy?: SettledBy;
  /** Row 3: the id of the head finding this one is folded under (fold-findings, design section 6.1). */
  foldedUnder?: string;
  /**
   * Row 4: the effective `ships` of the decisive place and of every kept place (the seat's accepted value, else the
   * program's premise for the place's file; a place with neither is `undefined`, which ships).
   */
  ships?: { decisive?: string; kept: readonly (string | undefined)[] };
  /**
   * Row 4: the rule's `duty_about` (rule.schema.json; standing.ts `dutyAboutOf`).
   * Only `product_runtime` may take row 4: the duty attaches only to
   * what the product does when it runs, so a file outside every shipped artifact cannot create it. Absent, or any other
   * value (`release_supply_documentation`), never takes row 4, whatever the effective `ships`.
   */
  dutyAbout?: DutyAbout | string;
  /** Row 5: the candidate's declared-inapplicable preconditions, each with the kind of the question that set it. */
  declaredInapplicable?: readonly { field: string; kind?: QuestionKind | string }[];
  /** Rows 6-8, 10: the person's confirmed answers, by question id (`field` or `field:code`); absent id = not answered. */
  answers?: ReadonlyMap<string, GivenAnswer>;
  /** Row 8: the rule's role (rule.schema.json `finding_role`); absent or unknown = `duty_check`. */
  role?: FindingRole | string;
  /**
   * Rows 4 and 8: the second look's outcome. `overturned` skips both rows; `needs_human` turns a placement in either row into
   * `counsel` (WP3 reading (d)); `upheld` and `not_answered` move nothing.
   */
  secondLook?: SecondLook;
}

/** A part whose absence placed the finding at its heaviest. */
export type MissingPart = "verdict" | "status" | "question" | "element" | "exemption" | "settles_as";

export interface DispositionResult {
  disposition: Disposition;
  /** The row that held, 1-10. */
  row: number;
  /** The needed parts that were not there (set aside, left out, or a status without its own part); empty where none. */
  missing: readonly MissingPart[];
}

const result = (disposition: Disposition, missing: MissingPart[] = []): DispositionResult => ({ disposition, row: DISPOSITIONS.indexOf(disposition) + 1, missing });

/** Row 4: the decisive place and every kept place (at least one) carry a value that does not ship. */
function notShipped(ships: DispositionInput["ships"]): boolean {
  if (!ships || typeof ships.decisive !== "string" || !NOT_SHIPPED.has(ships.decisive)) return false;
  return ships.kept.length > 0 && ships.kept.every((v) => typeof v === "string" && NOT_SHIPPED.has(v));
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * The status as the order reads it: the record's value where it stood with the part it needs, `duty_unmet` (the
 * heaviest, `HEAVIEST.status`) where it was set aside, is not a known value or lacks that part, and `undefined` where
 * the seat left it out.
 */
function statusOf(x: DispositionInput, missing: MissingPart[]): string | undefined {
  const aside = new Set(x.setAside ?? []);
  if (aside.has("status") || aside.has("standing")) {
    missing.push("status");
    return HEAVIEST.status;
  }
  const s = x.standing;
  const value = s?.status?.value;
  if (value === undefined) return undefined;
  if (value === "duty_unmet") return value;
  if (value === "waits_on_answer") {
    if (nonEmpty(s?.question?.value) || (nonEmpty(s?.fact?.words) && nonEmpty(s?.fact?.about))) return value;
    missing.push("question");
    return HEAVIEST.status;
  }
  if (value === "duty_met") {
    if (nonEmpty(s?.element)) return value;
    missing.push("element");
    return HEAVIEST.status;
  }
  if (value === "exempt") {
    if (nonEmpty(s?.exemption?.basis) && nonEmpty(s?.exemption?.limb)) return value;
    missing.push("exemption");
    return HEAVIEST.status;
  }
  missing.push("status");
  return HEAVIEST.status;
}

/** The question a finding waits on: the standing's own (with `waits_on_answer`), else a `needs_human`'s `settles`. */
function waitOf(x: DispositionInput, status: string | undefined): { question: string } | { fact: true } | null {
  if (status === "waits_on_answer") {
    const q = x.standing?.question?.value;
    return nonEmpty(q) ? { question: q } : { fact: true };
  }
  if (x.verdict === "needs_human" && typeof x.standing?.settles === "string") {
    const m = /^question:(.+)$/.exec(x.standing.settles);
    if (m && nonEmpty(m[1])) return { question: m[1] };
  }
  return null;
}

/** The disposition of one adjudicated finding: the first of design section 2.2's ten rows that holds. */
export function dispositionOf(x: DispositionInput): DispositionResult {
  if (x.settledBy) return result("settled_by_answer");
  if (typeof x.verdict !== "string" || !VERDICTS.has(x.verdict)) return result("to_fix", ["verdict"]);
  if (x.verdict === "not_applicable") return result("not_applicable");
  if (nonEmpty(x.foldedUnder)) return result("folded");
  const overturned = x.secondLook === "overturned";
  // Readings b and d: rows 4 and 8 are not counted as problems; a finding the review
  // left to a person (`needs_human`) never takes them, and one a second look could not settle goes to a person instead.
  const unsettled = x.verdict === "needs_human";
  const doubted = x.secondLook === "needs_human";
  if (!overturned && !unsettled && x.dutyAbout === SHIPS_MAY_DECIDE && notShipped(x.ships)) return doubted ? result("counsel") : result("not_shipped");
  if ((x.declaredInapplicable ?? []).some((d) => d.kind === "feature")) return result("check_answer");
  const missing: MissingPart[] = [];
  const status = statusOf(x, missing);
  const wait = waitOf(x, status);
  let answeredMet = false;
  if (wait) {
    const given = "question" in wait ? x.answers?.get(wait.question) : undefined;
    if (!given) return result("question", missing);
    const settles = typeof given.settlesAs === "string" && SETTLES_AS_KNOWN.has(given.settlesAs) ? given.settlesAs : null;
    if (settles === "maker") return result("for_operators", missing);
    if (settles === "met") answeredMet = true;
    else return result("to_fix", settles === null ? [...missing, "settles_as"] : missing);
  }
  if (!overturned && !unsettled) {
    const met = answeredMet || status === "duty_met" || status === "exempt" || (x.role === "inventory" && status !== "duty_unmet");
    if (met) return doubted ? result("counsel", missing) : result("recorded", missing);
  }
  if (x.verdict === "needs_human") return result("counsel", missing);
  return result("to_fix", status === undefined ? [...missing, "status"] : missing);
}

/**
 * Row 4's input, resolved (design sections 2.1 and 2.5 item 4): the
 * effective `ships` of the decisive place and of every kept place.
 *
 * - `seat`: the `ships` value the capture let stand (WP1 fills an omitted one from the premise of the decisive place).
 * - `premises`: the program's premise per file, as a `ships` value (`shipsLentByPremise`: only `test` and `development`
 *   lend a not-shipped one, section 13 of nv-fix-check-rules-2026-11-02.md); absent where the scan recorded no
 *   premise at all (a findings document written before the premise existed), and then the seat's value is the finding's,
 *   as H5a read it.
 *
 * The decisive place takes the seat's value, else its file's premise. A kept place in the decisive place's file takes the
 * decisive place's value (the seat read that file and quoted its line); a kept place in another file takes that file's
 * premise, and a file the premise does not list is `depends_on_deployment` (it ships). So a finding is not shipped only
 * where every place it keeps is shown not to ship, by the seat's own line or by the build files.
 */
export function effectiveShipsOf(x: { seat?: string; decisiveFile?: string; keptFiles: readonly string[]; premises?: ReadonlyMap<string, string> }): NonNullable<DispositionInput["ships"]> {
  const fromPremise = (f: string | undefined): string | undefined => (x.premises === undefined || f === undefined ? undefined : (x.premises.get(f) ?? "depends_on_deployment"));
  const decisive = x.seat ?? fromPremise(x.decisiveFile);
  const kept = x.keptFiles.map((f) => (f === x.decisiveFile ? decisive : x.premises === undefined ? x.seat : fromPremise(f)));
  return { ...(decisive !== undefined ? { decisive } : {}), kept };
}
