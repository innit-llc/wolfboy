/**
 * THE ORDER OF "FIX FIRST".
 *
 * From a standing finding's accepted `standing` parts (standing.ts, checked at capture), the penalty tier of each legal
 * basis it names (the program's table, never the seat's word: penalty-tier.ts, injected here as `TierOf`) and the
 * person's own answers (who the product serves: only the profile, never the code), this module gives each finding
 *   - its ORDER TIER O1-O4 (section 3.2's table, the yardstick's weights W1-W4),
 *   - its GROUP (0 to fix; 1 stands against an answer the person gave; 2 records a duty met; 3 does not ship), kept for
 *     the evidence log only: since WP3 of the NV design the disposition (disposition.ts) decides what is shown where,
 *   - and whether its level is RAISED TO HIGH by weight (D1 = B).
 *
 * A PART THE REVIEW DID NOT ESTABLISH (missing, set aside at capture, or resting on a quotation the final check
 * invalidated: S7) is placed as its heaviest value for the order (`HEAVIEST`, section 2.5), and the report says so (W13).
 * It never raises a level: the raise is computed from the parts that stood alone, each missing part taken at its
 * lightest, so a level is raised only on what the review established ("never raised on an assumed answer", D1). A
 * finding waiting on an answer is never raised. Nothing here lowers a level (T9).
 *
 * Pure functions only: no file is read here. In the capture's closure (`VERDICT_RULES_SOURCES`) since: the capture's guard on a resend reads the raise
 * (finding-weight.ts `outcomeWeightOf`), so a change here can change which resend is refused.
 */
import { provisionCovered, type TierOfBasis } from "./penalty-tier.js";
import { jurisdictionAnsweredOut } from "./per-rule-applicability.js";
import { regimeCarried, regimePlace } from "./region-reach.js";
import { EXPOSING_REACHES, HEAVIEST, NOT_SHIPPED, SEVERE_DATA, SHIPS_MAY_DECIDE, type StandingRecord } from "./standing.js";
import { basisIndexOf } from "./ref-ids.js";

/**
 * The penalty tier of one legal basis: the resolver's answer (penalty-tier.ts `TierOfBasis`, the bundle's table). The
 * order reads `tier` (a cite no table line resolves is `top` with `unresolved`: it rounds the order up, never a level);
 * the words read the regime, the penalty cite and the dates (`appliesFrom`, `appliesLater` over `provisions`).
 */
export type OrderBasis = TierOfBasis;
/** The resolver with its table bound: `(cite, jurisdiction) => tierOfBasis(cite, jurisdiction, loadPenaltyTiers(bundle))`. */
export type TierOf = (cite: string, jurisdiction: string | undefined) => OrderBasis;
/** The answer where no resolver is given (an in-process caller without a bundle): no duty, so the duty is unknown (W13). */
const NO_TIER: OrderBasis = { tier: "no_duty", regime: "", regimeId: "", penaltyCite: "", tiered: false, line: "", provision: "", provisions: [] };

export type OrderTier = "O1" | "O2" | "O3" | "O4";
export type OrderGroup = 0 | 1 | 2 | 3;
export const ORDER_TIERS: readonly OrderTier[] = ["O1", "O2", "O3", "O4"];
const RUNS_RANK: Record<string, number> = { default: 0, default_setting_fixes: 1, feature_in_use: 2, non_default_setting: 3 };
const NORMAL_RUNS: ReadonlySet<string> = new Set(["default", "default_setting_fixes", "feature_in_use"]);
const GROUP0_SHIPS: ReadonlySet<string> = new Set(["product", "documented_example", "maker_site", "depends_on_deployment"]);
/** Section 3.3 item 4: exposing first (data that has left cannot be recalled), then kept, operator only, nobody. */
const reachesRank = (r: string): number => (EXPOSING_REACHES.has(r) ? 0 : r === "not_about_data" ? 1 : r === "kept" ? 2 : r === "operator_only" ? 3 : 4);

/** The person's answers the order reads (section 2.3, D4): true only where the person answered Yes. */
export interface OrderAnswers {
  minors?: boolean;
  health?: boolean;
}
/** `audience.minors_possible` and `features.health_context` of the profile the scan read, where it is known. */
export function orderAnswersOf(profile: Record<string, unknown> | null | undefined): OrderAnswers {
  const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  return { minors: o(o(profile).audience).minors_possible === true, health: o(o(profile).features).health_context === true };
}

/** The facts the tier table reads (section 3.2). */
export interface TierFacts {
  top: boolean;
  data: readonly string[];
  people: readonly string[];
  runs: string;
  reaches: string;
}

/** Section 3.2's table: the order tier of one finding from its facts and the person's answers. */
export function orderTierOf(f: TierFacts, answers: OrderAnswers = {}): OrderTier {
  const aboutPeople = f.data.some((d) => d !== "no_personal_data");
  const severe = f.data.some((d) => SEVERE_DATA.has(d)) || (answers.minors === true && aboutPeople) || (answers.health === true && f.data.includes("records_about_people"));
  const exposing = EXPOSING_REACHES.has(f.reaches);
  if (f.reaches === "nobody") return "O4";
  const above = (): OrderTier => {
    if (f.top && severe) return "O1";
    if (f.top || (severe && exposing) || (f.runs === "default" && f.people.some((p) => p === "account_holders" || p === "visitors") && exposing)) return "O2";
    return "O3";
  };
  if (NORMAL_RUNS.has(f.runs)) return above();
  // `non_default_setting`: one step below what it would be where it runs normally, at most O4.
  return ORDER_TIERS[Math.min(ORDER_TIERS.indexOf(above()) + 1, 3)] as OrderTier;
}

/** One basis of the rule as the bundle holds it, in `legal_basis[]` order (`L<n>` is the n-th). */
export interface RuleBasis {
  cite: string;
  jurisdiction?: string;
  /** The basis's link and the day it was last checked against its source
   * (the rule's `legal_basis[].url` and `checked_at`), for the finding file's Provisions (mock M3a, M7); never ordered on. */
  url?: string;
  checked_at?: string;
  /** The rule keeps this basis for reference, not as the duty it tests
   * (`legal_basis[].supports_rule_condition: false`): a separate duty (CRA Art 14 beside Annex I Part II). Never ordered on. */
  separate?: boolean;
}

export interface StandingOrderInput {
  /** The record as the assembly reads it: `standing`, `standing_set_aside[]`, `verdict`, `quote_check_outcome`. */
  verdict: Record<string, unknown>;
  /** The candidate's `legal_basis_refs` (the cites `L<n>` names) and `declared_inapplicable_preconditions`. */
  candidate: Record<string, unknown> | undefined;
  /** The rule's `legal_basis[]` from the bundle, for each cite's jurisdiction; absent where the bundle is not at hand. */
  ruleBases?: readonly RuleBasis[];
  /** The regions the person answered in (`per_rule_applicability.declared_regions`), or null where not settled. */
  declaredRegions?: readonly string[] | null;
  /** The regions the person answered out, where the scan records them (`regions_not_offered`). */
  regionsOut?: readonly string[];
  tierOf?: TierOf;
  answers?: OrderAnswers;
  /**
   * The questions the person has answered (the profile at hand holds a value
   * for the field): a status that waits on one of them is not established, and is placed as the heaviest (W13).
   */
  answered?: ReadonlySet<string>;
  /**
   * The rule's `duty_about` as the disposition reads it (the assembly's
   * map from the bundle through standing.ts `dutyAboutOf`); absent declares nothing, and a not-shipped value then never
   * lowers the order.
   */
  dutyAbout?: string;
  /**
   * The effective `ships` of every kept place, as the disposition reads
   * them (disposition.ts `effectiveShipsOf`): a not-shipped value lowers the order only where every kept place is shown
   * not to ship, so a finding another kept place keeps counted is ordered, and raised, as one that ships. Absent (an
   * order asked with no kept places), the seat's value alone decides, as before.
   */
  shipsKept?: readonly (string | undefined)[];
}

/**
 * Whether a basis's jurisdiction is answered out, by the one membership rule. And only where the region question carries the territorial test of the
 * law the cite names (region-reach.ts `regimeCarried`, the cite's regime by the order's own resolver): an ePrivacy cite
 * stays in on a region No, a GDPR cite of the same rule is set aside.
 */
export function basisAnsweredOut(x: Pick<StandingOrderInput, "declaredRegions" | "regionsOut" | "tierOf">, jurisdiction: string | undefined, cite?: string): boolean {
  if (!jurisdiction || !jurisdictionAnsweredOut(jurisdiction, x.declaredRegions, x.regionsOut)) return false;
  if (cite === undefined || !x.tierOf) return true;
  try {
    const regimeId = x.tierOf(cite, jurisdiction).regimeId;
    // Settled only by the No of the question of the law's own place.
    const place = regimePlace(regimeId);
    // A place left out of a list answered without the per-place questions answers
    // only CLOSED_LIST_PARTS, so it settles only the laws those parts carry.
    return regimeCarried(regimeId, Array.isArray(x.regionsOut) ? "place-question" : "closed-list") && (place === undefined || jurisdictionAnsweredOut(place, x.declaredRegions, x.regionsOut));
  } catch {
    return true;
  }
}

/** A basis the finding names, resolved. */
export interface ResolvedBasis extends OrderBasis {
  ref: string;
  cite: string;
  jurisdiction?: string;
}

export interface StandingOrder {
  group: OrderGroup;
  tier: OrderTier;
  status: string;
  runs: string;
  reaches: string;
  ships: string;
  data: string[];
  people: string[];
  /** The question a finding waits on (`waits_on_answer`'s `question`, or a `needs_human` that settles on one). */
  question?: string;
  /** `law_unclear:<cite>` or `code_not_readable:<file>`, where a `needs_human` settles on one. */
  settles?: string;
  /** The order parts the review did not establish, placed as their heaviest value (W13). */
  heaviest: ("status" | "duty" | "data" | "runs" | "reaches" | "ships")[];
  /** The tier from the parts that stood alone, each missing one at its lightest: what a raise may rest on. */
  standingTier: OrderTier | null;
  /**
   * The same with no duty in the top tier: where it is not O1 or O2 and
   * the finding is raised, the duty's tier alone carries the raise, and the words say so (`raisedOnDutyAlone`).
   */
  standingTierWithoutDuty?: OrderTier | null;
  /**
   * The duty alone: a top-tier duty that stood, with `runs` and `reaches` as
   * they stood (each missing one at its lightest) and no data or people. Where it is O1 or O2 the duty's tier is enough for the
   * raise on its own; where it is not, the data that stood carried the raise with it, and the words name that data.
   */
  standingTierDutyOnly?: OrderTier | null;
  /** The heaviest basis that stood and applies on the person's answers (for the words W2b, W11, W12, W19). */
  topBasis?: ResolvedBasis;
  /** Bases set aside because the person answered their jurisdiction out (S3's region half, applied here). */
  regionOut: ResolvedBasis[];
  /** Whether the block stood at all (a finding with no block: O1 and W13 on every order part, T8). */
  hasBlock: boolean;
  /** The verdict is `needs_human`: the review did not settle it, so it is never raised by weight (section 9 item 6). */
  needsHuman: boolean;
}

/** One entry of `DATA_FREE_PROVISIONS`: the provisions of one regime (the table's forms, `"every"` for the whole law), and why. */
export interface DataFreeEntry {
  regime: string;
  provisions: readonly string[] | "every";
  why: string;
}

/**
 * THE PROVISIONS WHOSE DUTY DOES NOT DEPEND ON THE PERSONAL DATA INVOLVED, the one
 * list the order reads (`dutyFreeOfData`). Each entry is a legal reading and says why; a provision not listed keeps the data
 * in the ranking. It holds provisions, not laws: a law some of whose duties or fines are weighed by the data's categories or
 * by minors is listed only for the provisions that are not (`DATA_FREE_LEFT_OUT` names those left out, and why).
 * DEMO6 ranked both CRA findings "at the worst case ... (special-category data)", a category neither duty turns on; D6FIX's
 * fix read whole laws as free of data and also dropped data the review had established and the person's answers (the
 * non-author check, C1 and C2). Adding a provision here is a legal decision: the test pins the rules it makes data-free.
 */
export const DATA_FREE_PROVISIONS: readonly DataFreeEntry[] = [
  {
    regime: "cra",
    provisions: ["Annex I Part II", "Annex II", "13(2)-(25)", "14(1)", "14(2)"],
    why: "The vulnerability handling requirements (Annex I Part II), the information and instructions for the user (Annex II), the manufacturer's obligations of Art. 13(2) to (25) and its notification of actively exploited vulnerabilities (Art. 14(1) and (2)) are owed for every product with digital elements, whatever data it processes; no data category or minors decides whether they apply or their fine tier (Art. 64(2)). Annex I Part I and Art. 13(1), which makes it binding, are left out: Part I(2)(e), (f), (g) and (m) have the data as their object. So is Art. 14(3) to (5): whether an incident is severe turns on the data it affects (Art. 14(5)(a)).",
  },
  {
    regime: "cra",
    provisions: ["Annex VII"],
    why: "The content of the technical documentation the manufacturer keeps, owed whatever data the product processes. Fined under Art. 64(2) through Art. 13(4) and 13(8) (the table's heavier reading) or under Art. 64(3) through Art. 31, whose content Annex VII is: neither turns on the data. Not on the first non-author check's list: added because eu-cra-002's own basis cites Annex VII beside Art. 13(8).",
  },
  {
    regime: "eaa",
    provisions: "every",
    why: "The accessibility requirements (Arts 4 and 13, Annex I) are owed to every user whatever data the product processes, and the penalties (Art. 30) are weighed by the extent and seriousness of the non-compliance and the units or persons affected, not by a data category.",
  },
  {
    regime: "ai-act",
    provisions: ["50(1)", "50(2)", "50(4)"],
    why: "Telling people they are dealing with an AI system (Art. 50(1)), marking generated output (50(2)) and disclosing deep fakes and generated text on matters of public interest (50(4)) are owed whatever data is processed; their fine (Art. 99(4)(g)) names no data category.",
  },
  {
    regime: "data-act",
    provisions: ["23", "30", "34"],
    why: "Switching between data processing services (Arts 23 and 30, Chapter VI) and the interoperability of services used in parallel (Art. 34, Chapter VIII) are owed whatever data the customer holds; their penalties are the Member States' under Art. 40(1), which Art. 40(4)'s route through GDPR Art. 83 does not reach.",
  },
  {
    regime: "dsa",
    provisions: ["17"],
    why: "The statement of reasons to a recipient whose information a hosting provider restricts is owed whatever the information holds; no data category or minors decides the duty or its fine (Art. 52(3)).",
  },
  {
    regime: "us-ny-gbl-47",
    provisions: ["47"],
    why: "Art. 47 (Secs. 1700 to 1704): the safeguards and notifications of an AI companion model (Secs. 1701 and 1702) are owed to every user; no data category or minors decides them. Only Art. 47: the table reads every New York General Business Law cite under this regime, and other articles are defined by minors (Art. 48) or by categories of private information (Sec. 899-aa).",
  },
  {
    regime: "cn-ai-labelling",
    provisions: "every",
    why: "The labels on AI-generated content (the Labelling Measures and GB 45438-2025) are owed on every such output whatever data is processed.",
  },
];

/**
 * Provisions of the laws above that `DATA_FREE_PROVISIONS` leaves out, and why: for
 * the reader of the list and for its test, which holds that none of them is ever covered. A regime the list does not name
 * at all (the GDPR, ePrivacy, the APPI, the CCPA, the FTC Act, Utah's AI law, California S.B. 243 and the like) keeps the
 * data in throughout.
 */
export const DATA_FREE_LEFT_OUT: readonly { regime: string; provision: string; why: string }[] = [
  { regime: "data-act", provision: "40(4)", why: "It lets the GDPR supervisory authorities fine infringements of Chapters II, III and V under GDPR Art. 83, whose Art. 83(2)(g) weighs the categories of personal data affected." },
  { regime: "data-act", provision: "4", why: "One article of Chapter II (Arts 3 to 7), which Art. 40(4) reaches." },
  { regime: "data-act", provision: "9", why: "One article of Chapter III (Arts 8 to 12), which Art. 40(4) reaches." },
  { regime: "data-act", provision: "20", why: "One article of Chapter V (Arts 14 to 22), which Art. 40(4) reaches." },
  { regime: "dsa", provision: "26(3)", why: "No advertising based on profiling with special categories of personal data: defined by the data." },
  { regime: "dsa", provision: "28(1)", why: "The measures for the privacy, safety and security of minors on a platform accessible to them: defined by minors." },
  { regime: "dsa", provision: "28(2)", why: "No advertising based on profiling with a minor's personal data: defined by minors." },
  { regime: "ai-act", provision: "5(1)(g)", why: "The prohibition of biometric categorisation: defined by biometric data." },
  { regime: "ai-act", provision: "50(3)", why: "Informing people exposed to emotion recognition or biometric categorisation: defined by biometric data." },
  { regime: "ai-act", provision: "50", why: "A cite of Art. 50 naming no paragraph could be Art. 50(3)." },
  // The CRA's Annex I Part I, Art. 13(1) and Art. 14(3)
  // to (5), and the New York General Business Law outside Art. 47.
  { regime: "cra", provision: "Annex I Part I(2)(e)", why: "Protecting the confidentiality of stored, transmitted or otherwise processed data, personal or other: the data is its object, and what it requires is set by the risk assessment over the assets to be protected (Part I(2) chapeau, Art. 13(3))." },
  { regime: "cra", provision: "Annex I Part I(2)(f)", why: "Protecting the integrity of stored, transmitted or otherwise processed data, personal or other: the data is its object." },
  { regime: "cra", provision: "Annex I Part I(2)(g)", why: "Processing only data, personal or other, that are adequate, relevant and limited to what is necessary (data minimisation): the data is its object." },
  { regime: "cra", provision: "Annex I Part I(2)(m)", why: "Letting users securely and easily remove on a permanent basis all data and settings: the data is its object." },
  { regime: "cra", provision: "Annex I Part I", why: "The essential requirements of the product's properties, applied on the basis of the cybersecurity risk assessment (Part I(2) chapeau), which weighs the assets to be protected." },
  { regime: "cra", provision: "Annex I", why: "A cite of Annex I naming no Part could be Part I." },
  { regime: "cra", provision: "13(1)", why: "The operative clause of Annex I Part I: it goes with it." },
  { regime: "cra", provision: "13", why: "A cite of Art. 13 naming no paragraph could be Art. 13(1)." },
  { regime: "cra", provision: "14(3)", why: "The notification of severe incidents: whether an incident is severe turns on whether it affects sensitive or important data (Art. 14(5)(a))." },
  { regime: "cra", provision: "14(4)", why: "The content of the notifications of Art. 14(3)'s severe incidents." },
  { regime: "cra", provision: "14(5)", why: "Defines a severe incident, among others by its effect on sensitive or important data (point (a))." },
  { regime: "cra", provision: "14", why: "A cite of Art. 14 naming no paragraph could be Art. 14(3) to (5)." },
  { regime: "us-ny-gbl-47", provision: "48", why: "The prohibition of unsafe AI companion features for minors: defined by minors." },
  { regime: "us-ny-gbl-47", provision: "Sec. 899-aa", why: "The notification of a breach of private information: defined by categories of private information. The reader reads no provision from a Section cited alone, so such a cite keeps the data in." },
];

/** Whether one provision a duty cite names is on `DATA_FREE_PROVISIONS` for its regime. */
function provisionFreeOfData(regimeId: string, label: string): boolean {
  return DATA_FREE_PROVISIONS.some((e) => e.regime === regimeId && (e.provisions === "every" || provisionCovered(e.provisions, label)));
}

/**
 * Condition (b) of `dutyFreeOfData`: every duty provision the finding rests on is on
 * `DATA_FREE_PROVISIONS`. Those are the provisions the table reads as carrying a duty or its fine (`dutyProvisions`: not a
 * recital, a definition or a line of no duty) in each basis the rule rests its condition on (every basis but one it keeps
 * for reference, `separate`) and in each the review's `duty` names. At least one must carry a duty; a basis the table cannot
 * resolve, a resolver that throws or an answer without `dutyProvisions` keeps the data in. A law listed whole counts
 * whatever provision is named, or none.
 */
export function provisionsFreeOfData(x: Pick<StandingOrderInput, "verdict" | "candidate" | "ruleBases" | "tierOf">): boolean {
  if (!x.tierOf) return false;
  const refs = listOf(x.candidate?.legal_basis_refs);
  const raw = x.verdict?.standing;
  const st = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as StandingRecord) : {};
  const named = new Set(listOf(st.duty?.value).map((r) => basisIndexOf(r)).filter((i): i is number => i !== null));
  let duties = 0;
  for (let i = 0; i < refs.length; i++) {
    if (x.ruleBases?.[i]?.separate === true && !named.has(i)) continue;
    let t: OrderBasis;
    try {
      t = x.tierOf(refs[i] as string, x.ruleBases?.[i]?.jurisdiction);
    } catch {
      return false;
    }
    if (t.unresolved === true) return false;
    if (t.tier === "no_duty") continue;
    // A fine is read as part of the duty it fines (C3), so a basis
    // that names only fines of a law this list names is no duty of its own: the duties it fines are read in their own
    // bases. A fine of a law the list does not name (GDPR Art. 83) keeps the data in, as does a cite naming a fine beside a
    // duty, whose fine is then read as a provision.
    if (t.penalty === true && DATA_FREE_PROVISIONS.some((e) => e.regime === t.regimeId)) continue;
    duties++;
    if (DATA_FREE_PROVISIONS.some((e) => e.regime === t.regimeId && e.provisions === "every")) continue;
    if (!Array.isArray(t.dutyProvisions) || t.dutyProvisions.length === 0) return false;
    if (!t.dutyProvisions.every((p) => provisionFreeOfData(t.regimeId, p))) return false;
  }
  return duties > 0;
}

/**
 * Whether a finding is ranked without the data. Only where both hold:
 * (a) no data stood for it - the review established none (`data`, read as the order reads it: nothing from a record the
 * quote check invalidated); (b) `provisionsFreeOfData`. Then a missing `data` is not placed at its heaviest. In every
 * other case the data is ranked as it always was: what the review established, or the heaviest where it established none. The person's Minors and Health answers are not part of (a):
 * `orderTierOf` applies them to the data the review established (Minors to data about people, Health to
 * `records_about_people`), and a duty on the list turns on neither. With them in (a), a Yes put a CRA finding the review
 * found `not_about_data` back at "special-category data", DEMO6's defect. A rule that names data
 * categories of its own (the candidate's `data_categories`, copied from the rule) is never ranked without the data either,
 * as under D6FIX: ai-transparency-004 (a cloned voice, `user.biometric`) rests only on listed provisions and would
 * otherwise enter, unreviewed.
 */
export function dutyFreeOfData(x: Pick<StandingOrderInput, "verdict" | "candidate" | "ruleBases" | "tierOf" | "answers">): boolean {
  const cats = x.candidate?.data_categories;
  if (Array.isArray(cats) && cats.length > 0) return false;
  const raw = x.verdict?.standing;
  const st = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as StandingRecord) : {};
  const stood = x.verdict?.quote_check_outcome === "invalidated" ? [] : listOf(st.data?.value);
  if (stood.length > 0) return false;
  return provisionsFreeOfData(x);
}

const strOf = (v: unknown): string => (typeof v === "string" ? v : "");
const listOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const TIER_RANK: Record<string, number> = { top: 0, not_top: 1, no_duty: 2 };

/** The order of one standing finding (sections 3.2, 3.3), from its record, its candidate, the table and the answers. */
export function standingOrderOf(x: StandingOrderInput): StandingOrder {
  const raw = x.verdict.standing;
  const st: StandingRecord = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as StandingRecord) : {};
  // S7: a record the final quote check invalidated gives no fact, its block included.
  const invalid = x.verdict.quote_check_outcome === "invalidated";
  const got = <K extends keyof StandingRecord>(k: K): StandingRecord[K] | undefined => (invalid ? undefined : st[k]);
  const heaviest: StandingOrder["heaviest"] = [];

  // A wait on a question the person already answered is not established.
  const waitedOn = strOf(got("question")?.value) || (strOf(got("settles")).startsWith("question:") ? strOf(got("settles")).slice("question:".length) : "");
  const answeredWait = waitedOn !== "" && x.answered?.has(waitedOn) === true;
  const statusRaw = strOf(got("status")?.value);
  const statusV = statusRaw === "waits_on_answer" && answeredWait ? "" : statusRaw;
  const status = statusV || HEAVIEST.status;
  if (!statusV) heaviest.push("status");

  // Duty: each `L<n>` through the bundle's jurisdiction and the resolver; a basis answered out is set aside (S3).
  const refs = listOf(x.candidate?.legal_basis_refs);
  const answeredOut = (j: string | undefined, cite?: string): boolean => basisAnsweredOut(x, j, cite);
  const resolved: ResolvedBasis[] = [];
  const regionOut: ResolvedBasis[] = [];
  for (const ref of listOf(got("duty")?.value)) {
    const i = basisIndexOf(ref);
    const cite = i === null ? undefined : refs[i];
    if (cite === undefined || i === null) continue;
    const jurisdiction = x.ruleBases?.[i]?.jurisdiction;
    const t: OrderBasis = x.tierOf ? x.tierOf(cite, jurisdiction) : NO_TIER;
    const b: ResolvedBasis = { ...t, ref, cite, ...(jurisdiction ? { jurisdiction } : {}) };
    (answeredOut(jurisdiction, cite) ? regionOut : resolved).push(b);
  }
  const duties = resolved.filter((b) => b.tier !== "no_duty").sort((p, q) => (TIER_RANK[p.tier] ?? 2) - (TIER_RANK[q.tier] ?? 2));
  const dutyKnown = duties.length > 0;
  if (!dutyKnown) heaviest.push("duty");
  // The order takes a cite the table does not resolve as top (rounds up); a raise rests only on a tier the table gave.
  const topForOrder = duties.some((b) => b.tier === "top");
  const topStood = duties.some((b) => b.tier === "top" && b.unresolved !== true);

  // A finding no data stood for, whose every duty provision is on the list of those
  // that do not turn on the data, is ranked without it (`dutyFreeOfData`); every other finding exactly as before D6FIX.
  const dataFree = dutyFreeOfData(x);
  const dataStood = listOf(got("data")?.value);
  if (dataStood.length === 0 && !dataFree) heaviest.push("data");
  const data = dataStood.length > 0 ? dataStood : dataFree ? [] : [...HEAVIEST.data];
  const dataRanked = dataFree ? ["no_personal_data"] : data;
  const dataStoodRanked = dataStood.length > 0 ? dataStood : ["no_personal_data"];
  const people = listOf(got("people")?.value);
  const runsV = strOf(got("runs")?.value);
  if (!runsV) heaviest.push("runs");
  const reachesV = strOf(got("reaches")?.value);
  if (!reachesV) heaviest.push("reaches");
  const shipsV = strOf(got("ships")?.value);
  if (!shipsV) heaviest.push("ships");
  const runs = runsV || HEAVIEST.runs;
  const reaches = reachesV || HEAVIEST.reaches;
  const ships = shipsV || HEAVIEST.ships;

  const settlesV = strOf(got("settles"));
  const questionV = strOf(got("question")?.value) || (settlesV.startsWith("question:") ? settlesV.slice("question:".length) : "");
  const waits = !answeredWait && (status === "waits_on_answer" || (x.verdict.verdict === "needs_human" && settlesV.startsWith("question:")));
  const answers = x.answers ?? {};
  const tier = orderTierOf({ top: !dutyKnown || topForOrder, data: dataRanked, people, runs, reaches }, answers);
  // The raise rests on the parts that stood: each missing one at its lightest (no duty in the top tier, no personal data,
  // a non-default setting, nobody reached), so a heaviest placement never raises a level.
  const standingTier = statusV
    ? orderTierOf({ top: topStood, data: dataStoodRanked, people, runs: runsV || "non_default_setting", reaches: reachesV || "nobody" }, answers)
    : null;
  const standingTierWithoutDuty = statusV
    ? orderTierOf({ top: false, data: dataStoodRanked, people, runs: runsV || "non_default_setting", reaches: reachesV || "nobody" }, answers)
    : null;
  const standingTierDutyOnly = statusV
    ? orderTierOf({ top: topStood, data: ["no_personal_data"], people: [], runs: runsV || "non_default_setting", reaches: reachesV || "nobody" }, answers)
    : null;
  // `documentation`
  // is a not-shipped value beside `development` and `test` (standing.ts NOT_SHIPPED): group 3, so it never takes the raise by
  // weight, which only a group-0 finding takes. Before, it was placed as `product` (group 0). AN OPT-IN, as the disposition's row 4 (disposition.ts): a
  // not-shipped value lowers the order only for a rule declaring `duty_about: product_runtime`. For every other rule (a
  // live credential, a document, a release duty) the value is placed as the file is shown to be, by weight, as `product`
  // is: before, a counted credential in a test file sat in group 3 and was never raised by weight.
  const everyKeptNotShipped = x.shipsKept === undefined || (x.shipsKept.length > 0 && x.shipsKept.every((v) => typeof v === "string" && NOT_SHIPPED.has(v)));
  const shipsLowers = x.dutyAbout === SHIPS_MAY_DECIDE && NOT_SHIPPED.has(ships) && everyKeptNotShipped;
  const group: OrderGroup =
    shipsLowers
      ? 3
      : status === "duty_met"
        ? 2
        : (GROUP0_SHIPS.has(ships) || NOT_SHIPPED.has(ships)) && listOf(x.candidate?.declared_inapplicable_preconditions).length > 0
          ? 1
          : 0;
  return {
    group,
    tier,
    status: waits ? "waits_on_answer" : status,
    runs,
    reaches,
    ships,
    data,
    people,
    ...(waits && questionV ? { question: questionV } : {}),
    ...(settlesV && !settlesV.startsWith("question:") ? { settles: settlesV } : {}),
    heaviest: invalid || !raw ? ["status", "duty", "data", "runs", "reaches", "ships"] : heaviest,
    standingTier: invalid ? null : standingTier,
    standingTierWithoutDuty: invalid ? null : standingTierWithoutDuty,
    standingTierDutyOnly: invalid ? null : standingTierDutyOnly,
    ...(duties[0] ? { topBasis: duties[0] } : {}),
    regionOut,
    hasBlock: !invalid && !!raw && typeof raw === "object" && Object.keys(st).length > 0,
    needsHuman: x.verdict.verdict === "needs_human",
  };
}

/**
 * D1 = B: a `duty_unmet` finding of group 0 whose tier, from the parts that stood, is O1 or O2 is raised to high. Never a
 * finding waiting on an answer, never one that needs judgement (the review did not settle it: section 9 item 6, "at the
 * rule's level, never raised"), never on a heaviest placement, never lowered.
 */
export function raisedByWeight(o: StandingOrder): boolean {
  // Nor on a `ships` the review did not establish: its lightest (development, test
  // or documentation) would put the finding out of group 0, so a raise never rests on a set-aside `ships`.
  return o.group === 0 && o.status === "duty_unmet" && !o.question && !o.needsHuman && !o.heaviest.includes("ships") && (o.standingTier === "O1" || o.standingTier === "O2");
}

/**
 * A raise by weight that the duty's tier alone carries: without a top-tier duty the parts that stood give O3 or O4 (the duty
 * is needed), and the duty with `runs` and `reaches` as they stood and no data or people gives O1 or O2 (the duty is
 * enough). Needed was not enough: special-category data whose `runs`
 * did not stand also carried the raise, and the words said "on the duty's tier alone" and left that data out.
 */
export function raisedOnDutyAlone(o: StandingOrder): boolean {
  const high = (t: OrderTier | null | undefined): boolean => t === "O1" || t === "O2";
  return raisedByWeight(o) && !high(o.standingTierWithoutDuty) && high(o.standingTierDutyOnly);
}

/**
 * Section 3.3 items 1-4 as numbers, compared in order; items 5 on (level, confidence, today's key, id) are the caller's. The group is retired into the
 * disposition (disposition.ts): what is to fix, what waits on a question and what is not counted is the disposition's,
 * and the order applies within each of them by tier, how it runs and who it reaches. The first number stays, always 0, so
 * a key keeps its length; `group` is still computed and logged as H5a recorded it, and decides nothing shown.
 */
export function orderKeyOf(o: StandingOrder): number[] {
  return [0, ORDER_TIERS.indexOf(o.tier), RUNS_RANK[o.runs] ?? 0, reachesRank(o.reaches)];
}
export function compareKeys(p: readonly number[], q: readonly number[]): number {
  for (let k = 0; k < Math.max(p.length, q.length); k++) if ((p[k] ?? 0) !== (q[k] ?? 0)) return (p[k] ?? 0) - (q[k] ?? 0);
  return 0;
}

/**
 * W7: the tier a finding would take if the person answered an order-moving product question Yes, where it moves the
 * finding into O1 or O2 (higher than now); else null. `minors` reads `audience.minors_possible`, `health`
 * `features.health_context`.
 */
export function tierIfAnswered(o: StandingOrder, x: StandingOrderInput, which: "minors" | "health"): OrderTier | null {
  const now = ORDER_TIERS.indexOf(o.tier);
  const moved = standingOrderOf({ ...x, answers: { ...(x.answers ?? {}), [which]: true } }).tier;
  const to = ORDER_TIERS.indexOf(moved);
  return to < now && to <= 1 ? moved : null;
}
