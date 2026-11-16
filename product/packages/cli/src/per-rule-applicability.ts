/**
 * The questions that are answered ONCE PER RULE, settled here instead of inside every seat.
 *
 * Unit F of the layer-2 cost lane.
 * A layer-2 child costs about the same whatever it is handed
 * so the run's bill is the number of children; and two of the questions every child
 * answers before it reads a line are not questions about its candidate at all. They are questions
 * about the RULE, and their answer is the same for every candidate that rule raised:
 *
 *   1. **Does this rule's jurisdiction reach the regions this product is declared to be made
 *      available in?** Answered from `ScanProfile.distribution_regions` and from nowhere else.
 *   2. **Where the rule declares a premise the profile answers — `applicability_preconditions` —
 *      what did the person answer?** Answered from the profile field the expression names.
 *
 * Both are facts about the PRODUCT, so both are read from the person's own declaration and neither
 * is inferred from source vocabulary. Nothing in this file reads the tree.
 *
 * ## WHAT THIS COMPUTES AND WHAT IT REFUSES TO DO
 *
 * It computes an ANSWER and attaches it to the document. **It removes nothing, downgrades nothing
 * and changes no candidate.** `candidates`, `rules_without_candidates` and the payload files are
 * byte-for-byte what they were before this block existed; a reader diffing two runs sees one added
 * key and nothing else. The owner correction of 2026-07-27 that took a per-rule region gate out of
 * the scan (`engine.ts` `preconditionStatus`) is not reopened: a gate inside the scan DELETES
 * candidates silently, and this writes a sentence beside them.
 *
 * Who APPLIES the answer is the orchestrator, in `legal-scan/SKILL.md` step 4, before it dispatches:
 * a rule answered `does_not_apply` launches no adjudicator and its candidates are reported as "not
 * applicable by declaration", one record per `finding_id`, with the declaration quoted. So the test
 * still lives in exactly one place — it is computed here and applied there — and the thing that
 * changed on 2026-09-22 is that it is computed once per rule rather than re-derived inside each of
 * the 84 to 682 children a run launches.
 *
 * ## THE DIRECTION OF EVERY DOUBT IS TO ADJUDICATE
 *
 * `does_not_apply` is the only answer that removes a launch, and it is reached only from a positive
 * declaration. Every other state — no profile, no `distribution_regions`, an empty array, the
 * recorded answer `"unknown"`, a field the profile's own schema rejected and `profile.ts` therefore
 * downgraded to unanswered — is `unanswered`, and an `unanswered` rule is adjudicated exactly as it
 * is today. This is the design's rule in the one place where an answer can switch checks off: *"a wrong or
 * guessed region turns whole rule packs into 'does not apply' when the truthful answer is 'nobody
 * looked', which is the largest available form of the failure that rule exists to prevent"*
 * (`SKILL.md`, rules of adjudication).
 *
 * **A premise question removes a launch only where it is a SCOPE question answered out of scope from the
 * program's confirmed record** (fixes A-D, 2026-11-02, change the 2026-08-27 decision for scope
 * questions only). Who the product is offered to and what kind of service it is (`audience.consumer`,
 * `scope.eaa_listed_service`, `scope.data_processing_service`) are facts the code cannot speak to, so a detector match
 * is no disagreement with them: such an answer settles every rule whose precondition names the field, as a region's No
 * settles a jurisdiction - `adjudicate: false`, `not_adjudicated_as`, and `settled_by` naming the field, the answer and
 * when it was recorded - and the report lists the rule with this scan's place counts every run. Only where three things
 * hold: the caller hands the answer in `scopeSettlements` (declaration.ts `scopeSettlementsOf`: a confirmed record row,
 * at its question's current version, of a scope question, on an option that settles as `out_of_scope`); the engine's own
 * evaluation of the rule's precondition is `unmet` (the answer and the expression agree); and the rule has candidates
 * on this run. **Every other premise answer still never removes a launch, in either direction**: a `feature` answer
 * that puts a rule's subject out of scope is a DISAGREEMENT with the detector that found the construct anyway, reported
 * and never dismissed on the strength of the answer (`Candidate.declared_inapplicable_preconditions`, adjudicator rule
 * 6b; the report asks the person to check the answer), and a `condition` answer is handed to the seat. A test (block C) holds both halves.
 *
 * **A region No answers a law only where the question carries that law's own territorial test** (2026-11-11). The table of which laws it carries,
 * and why, is region-reach.ts; a rule citing a law it does not carry (the ePrivacy Directive's Article 5(3), for one)
 * stays `unanswered` on a No and is adjudicated with the reason attached, never set aside.
 *
 * ## THE JUDGEMENT, WHICH IS NOT A STRING COMPARISON
 *
 * `SKILL.md` has said since 2026-07-27 that *"a rule declaring `EU` is in scope for a profile
 * declaring `DE`"*. That is a membership fact, and this file is where it is written down:
 *
 *   - a declared region equal to the rule's jurisdiction covers it;
 *   - a product declared available in `EU` is available in every member state, so `EU` covers a rule
 *     declaring a member state's code;
 *   - a rule declaring `EU` is covered by a declared region in the **EEA**, not only in the Union.
 *     The EEA Agreement extends the Union acquis this pack cites to Iceland, Liechtenstein and
 *     Norway (GDPR: EEA Joint Committee Decision 154/2018), and the widening direction is the safe
 *     one: an EEA-only product keeps its EU checks. Switzerland is deliberately NOT here — it is
 *     neither EU nor EEA and its own instrument is not in this bundle.
 *
 * Everything else is outside. **This list is a maintained fact and it has a date**: the Union has 27
 * member states as of 2026-09-22, and a scan run after an accession with a stale list would answer
 * `does_not_apply` for a member state, which is the failure above. It is one list, in one file, and
 * no second copy of it exists.
 */

import type {
  Candidate,
  PerRuleAnswer,
  PerRuleApplicability,
  PerRuleApplicabilityRow,
  PerRuleQuestion,
  Rule,
  ScanProfile,
} from "wolfboy-schemas";
import type { PreconditionStatus } from "./engine.js";
import { leftOpenWhy, regimesLeftOpen, type AnsweredThrough } from "./region-reach.js";

/**
 * The Union's member states, ISO 3166-1 alpha-2, **as of 2026-09-22 (27 states)**. Read by
 * `covers` and by nothing else, and deliberately not exported as data another module could copy.
 */
const EU_MEMBER_STATES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU",
  "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
]);

/**
 * The three EEA states that are not Union members. A product declared available in one of them
 * keeps every rule this bundle declares for `EU`; see the file header for the reason and the
 * instrument. Kept separate from the Union list because they are a different fact.
 */
const EEA_NON_EU = new Set(["IS", "LI", "NO"]);

/** Does a region the person declared cover a jurisdiction the rule declares? */
function covers(declared: string, ruleJurisdiction: string): boolean {
  if (declared === ruleJurisdiction) return true;
  if (declared === "EU" && EU_MEMBER_STATES.has(ruleJurisdiction)) return true;
  if (ruleJurisdiction === "EU" && (EU_MEMBER_STATES.has(declared) || EEA_NON_EU.has(declared))) {
    return true;
  }
  return false;
}

/**
 * Open-world regions: does a region the person answered No to take in a jurisdiction the rule declares? A
 * region takes in itself, and EU takes in each member state. The reverse is not true: No to one member state leaves the
 * rest of the Union open, so an EU rule stays open.
 */
function within(ruleJurisdiction: string, notOffered: string): boolean {
  return ruleJurisdiction === notOffered || (notOffered === "EU" && EU_MEMBER_STATES.has(ruleJurisdiction));
}

/**
 * Whether the person's region answers leave one jurisdiction out, by the
 * membership rule the per-rule test itself uses (`covers`, `within`: EU member states inside "EU"): the order's basis test
 * (fix-order.ts) and the report's law line read this and nothing else. Open world (`regions_not_offered` present): out
 * only where no region answered Yes covers it and a region answered No takes it in. Closed world: out only where the
 * regions are settled and none covers it. No answer, or "unknown", leaves every jurisdiction in.
 */
export function jurisdictionAnsweredOut(jurisdiction: string, declaredRegions: readonly string[] | null | undefined, regionsNotOffered: readonly string[] | undefined): boolean {
  const declared = Array.isArray(declaredRegions) && declaredRegions.length > 0 ? declaredRegions : null;
  const offered = declared !== null && !declared.includes("unknown") ? declared : [];
  if (Array.isArray(regionsNotOffered)) return !offered.some((d) => covers(d, jurisdiction)) && regionsNotOffered.some((n) => within(jurisdiction, n));
  if (declared === null || declared.includes("unknown")) return false;
  return !declared.some((d) => covers(d, jurisdiction));
}

/**
 * One scope answer from the program's confirmed record that puts the
 * rules naming its field out of scope (declaration.ts `scopeSettlementsOf`). `answer` is the option's label as the
 * record holds it; `recorded_at` the time the record holds.
 */
export interface ScopeSettlement {
  field: string;
  header: string;
  answer: string;
  value: unknown;
  recorded_at: string;
}

/** The launches one adjudication group costs: its verdict seat, plus any reader children. */
export function launchesOfGroup(members: Candidate[]): number {
  let readers = 0;
  for (const c of members) readers += c.adjudication_group?.readers ?? 0;
  return 1 + readers;
}

/**
 * Answer, once per rule, the questions that do not depend on the candidate.
 *
 * `preconditions` is the map `scan.ts` already built with `preconditionStatus`, passed in rather
 * than recomputed: the evaluator of record is `engine.ts` and a second walk of the same expressions
 * here would be a forbidden second copy.
 */
export function perRuleApplicability(
  rules: Rule[],
  candidates: Candidate[],
  profile: ScanProfile | null,
  preconditions: Map<string, PreconditionStatus>,
  scopeSettlements: readonly ScopeSettlement[] = [],
): PerRuleApplicability {
  const settlementOf = new Map(scopeSettlements.map((x) => [x.field, x]));
  const declaredRaw = profile?.distribution_regions ?? null;
  const declared =
    Array.isArray(declaredRaw) && declaredRaw.length > 0
      ? declaredRaw.filter((r): r is string => typeof r === "string")
      : null;
  // `"unknown"` is a RECORDED ANSWER meaning the question was put and not settled
  // (`scan-profile.schema.json`), and the schema makes it the only element when it is present. It
  // is not a region, so the test does not run and nothing is removed. A profile the program wrote since then carries `regions_not_offered` (possibly empty) and is read
  // open-world - a region answered Yes reaches a rule, a rule is ruled out only when every jurisdiction it declares lies
  // within a region answered No, and a region not answered is open. Without the key, the earlier closed list.
  const notOfferedRaw = profile?.regions_not_offered;
  const openWorld = Array.isArray(notOfferedRaw);
  const notOffered = openWorld ? notOfferedRaw.filter((r): r is string => typeof r === "string") : [];
  const offered = declared !== null && !declared.includes("unknown") ? declared : [];
  const settled = openWorld ? offered.length > 0 || notOffered.length > 0 : declared !== null && declared.length > 0 && !declared.includes("unknown");

  const byRule = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const list = byRule.get(c.rule_id);
    if (list) list.push(c);
    else byRule.set(c.rule_id, [c]);
  }
  const byGroup = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const key = c.adjudication_group?.key;
    if (key === undefined) continue;
    const list = byGroup.get(key);
    if (list) list.push(c);
    else byGroup.set(key, [c]);
  }

  const answerFor = (rule: Rule): PerRuleQuestion => {
    const question =
      `Is this product made available in any of ${JSON.stringify(rule.jurisdiction)}, which is ` +
      `what ${rule.id} declares? Asked of the person running the scan or read from their declared ` +
      `documents; never inferred from the source.`;
    const answered_from = "ScanProfile.distribution_regions";
    if (openWorld && settled) {
      const reached = offered.some((d) => rule.jurisdiction.some((j) => covers(d, j)));
      const allNo = !reached && rule.jurisdiction.length > 0 && rule.jurisdiction.every((j) => notOffered.some((n) => within(j, n)));
      // A No settles the rule only where the question carries the
      // territorial test of every law it cites (region-reach.ts); a law it does not carry leaves the rule open. And only by the No of the question of each law's own place.
      const open = allNo ? regimesLeftOpen(rule, (place) => notOffered.some((n) => within(place, n))) : [];
      const ruledOut = allNo && open.length === 0;
      return {
        question,
        answer: reached ? "applies" : ruledOut ? "does_not_apply" : "unanswered",
        answered_from,
        declared: { distribution_regions: declaredRaw ?? null, regions_not_offered: notOffered },
        because: reached
          ? `${rule.id} declares ${JSON.stringify(rule.jurisdiction)} and the regions answered Yes ${JSON.stringify(offered)} reach it.`
          : ruledOut
            ? `${rule.id} declares ${JSON.stringify(rule.jurisdiction)} and every one of them lies within a region answered No ` +
              `${JSON.stringify(notOffered)}, on the membership list in per-rule-applicability.ts dated 2026-09-22.`
            : allNo
              ? notCarried(rule, notOffered, open, "place-question")
              : `${rule.id} declares ${JSON.stringify(rule.jurisdiction)}; no region answered Yes reaches it and not every one is ` +
                `answered No, so the question is open for it (a region not asked is open, never No) and it is adjudicated with the open question attached.`,
      };
    }
    if (!settled) {
      return {
        question,
        answer: "unanswered",
        answered_from,
        declared: declaredRaw ?? null,
        because:
          `distribution_regions is not answered (` +
          `${declaredRaw === null ? "no value" : JSON.stringify(declaredRaw)}` +
          `), so the jurisdiction question was put and not settled: ${rule.id} declares ` +
          `${JSON.stringify(rule.jurisdiction)} and is adjudicated with the open question attached.`,
      };
    }
    const hit = declared!.some((d) => rule.jurisdiction.some((j) => covers(d, j)));
    // A list answered without the per-place questions settles only what
    // CLOSED_LIST_PARTS carry (region-reach.ts): a place it leaves out answers whether the product is offered there.
    const openClosed = hit ? [] : regimesLeftOpen(rule, (place) => !declared!.some((d) => covers(d, place)), "closed-list");
    if (!hit && openClosed.length > 0) {
      return { question, answer: "unanswered", answered_from, declared: declared, because: notCarried(rule, declared!, openClosed, "closed-list") };
    }
    return {
      question,
      answer: hit ? "applies" : "does_not_apply",
      answered_from,
      declared: declared,
      because: hit
        ? `${rule.id} declares ${JSON.stringify(rule.jurisdiction)} and the declared ` +
          `distribution_regions ${JSON.stringify(declared)} reach it.`
        : `${rule.id} declares ${JSON.stringify(rule.jurisdiction)} and none of the declared ` +
          `distribution_regions ${JSON.stringify(declared)} is in any of them, on the membership ` +
          `list in per-rule-applicability.ts dated 2026-09-22.`,
    };
  };

  /**
   * The scope answer that settles the rule, if any: the first of its
   * preconditions (in its own order) whose field a confirmed scope answer settles AND whose evaluation is `unmet`.
   */
  const settledByOf = (rule: Rule): { cond: string; s: ScopeSettlement } | null => {
    const status = preconditions.get(rule.id) ?? { unmet: [], unanswered: [] };
    for (const cond of rule.applicability_preconditions ?? []) {
      const s = settlementOf.get(fieldOf(cond));
      if (s !== undefined && status.unmet.includes(cond)) return { cond, s };
    }
    return null;
  };

  const premisesFor = (rule: Rule, settled: { cond: string; s: ScopeSettlement } | null, places: number): PerRuleQuestion[] | undefined => {
    const conds = rule.applicability_preconditions ?? [];
    if (conds.length === 0) return undefined;
    const status = preconditions.get(rule.id) ?? { unmet: [], unanswered: [] };
    return conds.map((cond) => {
      const path = fieldOf(cond);
      const answer: PerRuleAnswer = status.unanswered.includes(cond)
        ? "unanswered"
        : status.unmet.includes(cond)
          ? "declared_out_of_scope"
          : "met";
      return {
        question:
          `What did the person answer to ${cond}, the premise ${rule.id} declares? Asked of the ` +
          `person running the scan or read from their declared documents; never inferred from ` +
          `the source.`,
        answer,
        answered_from: `ScanProfile.${path}`,
        declared: readPath(profile, path),
        because:
          answer === "unanswered"
            ? `${cond} names a profile field nobody answered, so ${rule.id} ran BECAUSE the ` +
              `question is open. It is not a reason to lower a verdict and it removes no launch.`
            : answer === "declared_out_of_scope" && settled !== null && settled.cond === cond
              ? `the person answered ${cond} "${settled.s.answer}" in the program's confirmed record ` +
                `(${settled.s.recorded_at}), a scope answer that puts ${rule.id} out of scope: the rule is ` +
                `settled without review, and the report lists the ${places} place(s) the scanner still found ` +
                `with the answer and how to change it.`
              : answer === "declared_out_of_scope"
              ? `the person answered ${cond} in a way that puts ${rule.id} out of scope and the ` +
                `detector matched the construct anyway. The answer and the code disagree; the ` +
                `candidate is reported with the disagreement attached and no launch is removed.`
              : `the person answered ${cond} in the direction ${rule.id} declares.`,
      };
    });
  };

  const rowsWithCandidates: PerRuleApplicabilityRow[] = [];
  const silentNotApplicable: PerRuleApplicabilityRow[] = [];
  const notApplicableRuleIds = new Set<string>();

  for (const rule of rules) {
    const mine = byRule.get(rule.id) ?? [];
    const jq = answerFor(rule);
    if (jq.answer === "does_not_apply") notApplicableRuleIds.add(rule.id);
    if (mine.length === 0 && jq.answer !== "does_not_apply") continue;

    const settled = jq.answer !== "does_not_apply" && mine.length > 0 ? settledByOf(rule) : null;
    const places = mine.reduce((n, c) => n + c.locations.length, 0);
    const premises = premisesFor(rule, settled, places);
    if (settled !== null) notApplicableRuleIds.add(rule.id);
    const adjudicate = jq.answer !== "does_not_apply" && settled === null;
    const groups = [
      ...new Set(mine.map((c) => c.adjudication_group?.key).filter((k): k is string => !!k)),
    ].sort();
    const row: PerRuleApplicabilityRow = {
      rule_id: rule.id,
      jurisdiction: [...rule.jurisdiction],
      jurisdiction_question: jq,
      ...(premises ? { premise_questions: premises } : {}),
      adjudicate,
      ...(adjudicate ? {} : { not_adjudicated_as: "not applicable by declaration" as const }),
      ...(settled !== null ? { settled_by: { field: settled.s.field, answer: settled.s.answer, recorded_at: settled.s.recorded_at } } : {}),
      settled_premise: settledPremise(rule, jq, premises, settled?.s ?? null),
      candidates: mine.length,
      locations: places,
      groups,
      launches_removed: 0,
    };
    if (mine.length === 0) silentNotApplicable.push(row);
    else rowsWithCandidates.push(row);
  }

  // The groups that vanish, and the ones that only get smaller. A group vanishes when EVERY
  // candidate in it belongs to a rule that does not apply — a bin spans up to three rules by
  // construction, so a bin holding one applying rule still launches, and the saving on it is a
  // shorter payload and not a child.
  let groupsRemoved = 0;
  let groupsReduced = 0;
  let launchesRemoved = 0;
  const removedGroups = new Set<string>();
  for (const [key, members] of byGroup) {
    const settledHere = members.filter((c) => notApplicableRuleIds.has(c.rule_id)).length;
    if (settledHere === 0) continue;
    if (settledHere === members.length) {
      groupsRemoved++;
      removedGroups.add(key);
      launchesRemoved += launchesOfGroup(members);
    } else {
      groupsReduced++;
    }
  }
  for (const row of rowsWithCandidates) {
    if (row.adjudicate) continue;
    for (const key of row.groups) {
      if (removedGroups.has(key)) row.launches_removed += launchesOfGroup(byGroup.get(key) ?? []);
    }
  }

  const notAdjudicated = rowsWithCandidates.filter((r) => !r.adjudicate);
  return {
    answered_from: "ScanProfile.distribution_regions",
    declared_regions: declared,
    ...(openWorld ? { regions_not_offered: notOffered } : {}),
    settled,
    rules: [...rowsWithCandidates, ...silentNotApplicable].sort((a, b) =>
      a.rule_id < b.rule_id ? -1 : a.rule_id > b.rule_id ? 1 : 0,
    ),
    summary: {
      rules_with_candidates: rowsWithCandidates.length,
      rules_not_applicable: notAdjudicated.length,
      silent_rules_not_applicable: silentNotApplicable.length,
      candidates_not_adjudicated: notAdjudicated.reduce((n, r) => n + r.candidates, 0),
      locations_not_adjudicated: notAdjudicated.reduce((n, r) => n + r.locations, 0),
      groups_total: byGroup.size,
      groups_removed: groupsRemoved,
      groups_reduced: groupsReduced,
      launches_removed: launchesRemoved,
    },
  };
}

/**
 * Why a region No leaves a rule open: the laws it cites whose territorial
 * test the region question does not ask, each with its reason (region-reach.ts).
 */
function notCarried(rule: Rule, regions: readonly string[], open: readonly string[], through: AnsweredThrough): string {
  // A closed list's regions are the ones answered Yes; the sentence names
  // them as such and says what leaving a place out answers (the third check's D4: it called them regions answered No).
  if (through === "closed-list") {
    return (
      `${rule.id} declares ${JSON.stringify(rule.jurisdiction)} and none of the declared distribution_regions ${JSON.stringify(regions)} ` +
      `is in any of them, but a list written without regions_not_offered answers, for a place it leaves out, only whether the product is offered there, ` +
      `which does not answer the territorial test of every law the rule cites (${leftOpenWhy(open)}), ` +
      `so the list does not settle it and it is adjudicated with the open question attached.`
    );
  }
  return (
    `${rule.id} declares ${JSON.stringify(rule.jurisdiction)} and every one of them lies within a region answered No ` +
    `${JSON.stringify(regions)}, but that question does not answer the territorial test of every law the rule cites (${leftOpenWhy(open)}), ` +
    `so the answer does not settle it and it is adjudicated with the open question attached.`
  );
}
/** The profile field a precondition expression names (`a.b=val` -> a.b; `a.b[]` -> a.b), as `preconditionStatus` reads it. */
const fieldOf = (cond: string): string => (cond.includes("=") ? cond.slice(0, cond.indexOf("=")) : cond.replace(/\[\]$/, ""));

/** Read a dotted path out of the profile, the way `preconditionStatus` walks it. */
function readPath(profile: ScanProfile | null, path: string): unknown {
  let v: unknown = profile;
  for (const seg of path.split(".")) {
    if (v == null || typeof v !== "object" || !(seg in (v as Record<string, unknown>))) return null;
    v = (v as Record<string, unknown>)[seg];
  }
  return v ?? null;
}

/**
 * The sentence a seat is handed in place of deriving the answer itself. It names the rule, the
 * answer, the field the answer came from and the value that field holds, so a seat citing it is
 * citing a declaration and a reader can check it against `.legal/profile.json` in one line.
 */
function settledPremise(
  rule: Rule,
  jq: PerRuleQuestion,
  premises: PerRuleQuestion[] | undefined,
  settled: ScopeSettlement | null = null,
): string {
  const head =
    settled !== null
      ? `Settled before dispatch: ${rule.id} is not applicable by declaration: the person answered ` +
        `"${settled.header}" with "${settled.answer}" in the program's confirmed record (${settled.recorded_at}), a ` +
        `scope answer that puts it out of scope. No seat is launched for it.`
      : jq.answer === "applies"
      ? `Settled before dispatch: ${rule.id} is in jurisdiction for this product. ${jq.because} ` +
        `Do not re-decide it; cite it as the settled jurisdiction premise.`
      : jq.answer === "does_not_apply"
        ? `Settled before dispatch: ${rule.id} is not applicable by declaration. ${jq.because} ` +
          `No seat is launched for it.`
        : `Not settled: ${jq.because} Adjudicate on the merits and carry the open question.`;
  const tail = (premises ?? [])
    .map((p) => ` Premise ${p.answered_from}: ${p.answer} — ${p.because}`)
    .join("");
  return head + tail;
}
