/**
 * Applicability — does an instrument reach this project at all.
 *
 * This is coverage-map row C1 (CRA Article 2(1)) and the shape rows C29 and B11 share. It is not a
 * finding and must never be reported as one: the map's own words on row C29 are *"an applicability
 * signal, not a finding — it must be worded that way or every password manager on GitHub gets a
 * violation candidate"*, and on row B11 *"output should be 'this looks Annex III — classify
 * yourself', never 'you are high-risk'"*.
 *
 * ## Where the definition lives, and why there is only one
 *
 * The limbs are read out of the **checklist gates the bundle already ships**. They are not restated
 * here and there is no second scope file. On 2026-07-29 twenty-one gate defects were found in one
 * day and four of them were the same shape — one fact written in two places that then disagreed —
 * so a pillar-1 copy of a pillar-2 gate would be that defect by construction. Pillar 1 and pillar 2
 * ask the same question about the same project; they read the same answer.
 *
 * ## What this module decides, and what it refuses to decide
 *
 * It decides **which limbs the code answers**, from census facts, and nothing else. It never reads
 * the law. A limb with no `code_evidence` is one the code does not settle, and it is reported
 * unresolved rather than assumed in either direction — including every exemption limb, so an
 * exemption nobody has claimed never removes anything.
 *
 * **A fact about the product is never settled by code**, by the standing rule on facts about the
 * product. What a product is, who it
 * serves, whether it is supplied and whether that supply is commercial are asked of the person
 * running the scan or read from their declared documents; the code may corroborate or contradict
 * such a fact and may never decide it. The limb's own `decided_by` says which kind of fact it turns
 * on, and `codeMaySettle` below is the one place that reads it: only a `decided_by: code` limb — a
 * fact about the code itself — is settled, opposed or exempted by census facts. Every other limb
 * keeps its facts in `supporting` and `opposing`, where they are printed as what the code suggests,
 * and stays in `unresolved_limbs` until the person answers it. The CRA gate has no `code` limb: all
 * thirty-seven of its limbs are facts about the product, or the EU pack's premise.
 *
 * The asymmetry that governs the whole product governs the verdict too. Over-including produces a
 * question a reader dismisses in a line; under-including produces silence, and silence is
 * indistinguishable from a clean result. So:
 *
 * - `does-not-apply` requires evidence **against** a required limb and none for it. Absence of
 *   evidence is never enough.
 * - An exemption limb (`closes_gate_when: "true"`) can only take a project out when it is actually
 *   resolved, which code never does — every one of them is `ask` or `either`. They appear in the
 *   unresolved list and nowhere else.
 * - Nothing here removes, suppresses or downgrades a finding. A verdict annotates the citations
 *   that depend on it. That is the same decision the owner took on 2026-07-29 for the addressee
 *   limbs, applied one level up.
 *
 * ## THE DECLARATION PATH
 *
 * **This section is the statement of record, and it is the only one.** What a declaration does to a
 * verdict is stated here, once. Nothing else in this repository may restate it: not the module
 * comments below, not `census.ts`, not `scan.ts`, not the three schema and type files that describe
 * `declared_by`, which point here instead. A gate's own `scope_note` says what this rule means for
 * its instrument — which provision, which profile field, which repositories were measured — and
 * that is a different statement about a different subject, not a second copy of this one.
 *
 * The rule lived in four places until 2026-08-03 and went stale in a different subset on each of
 * three consecutive changes: corrected in the CRA gate's YAML on 2026-07-30 and left wrong in three
 * schema files; corrected in those three; then changed again in the code and left wrong in the same
 * three for a second time. A test now fails if the rule is restated outside the
 * two files entitled to state it.
 *
 * **Two tests, with different powers.** A limb may name a `declared_by` field — a dotted path into
 * the scan profile, the answer the person running the scan already gave.
 *
 * 1. **What settles the limb** is `code_evidence.supports`, kept deliberately narrow, because
 *    settling a required limb produces the instrument's strongest verdict — **and only on a limb
 *    whose `decided_by` is `code`** (`codeMaySettle`). On a limb about the product, test 1 never
 *    settles anything: its facts are what the code suggests, printed beside the question.
 * 2. **What contradicts a declaration** is every fact in the limb's `evidence_categories`, which is
 *    wider. Running test 2 with test 1's set is how a commercial open-core product
 *    carrying 263 commercial facts, returned `does-not-apply` from a single profile field while the
 *    report said nothing contradicted it.
 *
 * Passing test 2 stops a declaration closing the limb; it does not settle the limb. Only test 1
 * settles it, and only on a `code` limb.
 *
 * **Which answers a field gives** (2026-11-11).
 * A profile field is wired to a limb whose question is often wider than the field's, and then only
 * one of the field's answers carries over to the limb. So a limb that names `declared_by` also
 * names `declared_answers`, the values of that field that answer the limb's own question
 * (`checklist.schema.json` requires it), and **a value it does not list is no answer to the limb**:
 * cases 1 and 2 below are reached only by a listed value, and an unlisted one leaves the limb as
 * case 5 leaves it — except that an unlisted no is still tested against the tree as case 3
 * describes, because whether the tree contradicts what the person said is a question about the
 * answer, not about the limb. The instance that made this a rule: the CRA commercial-activity limb
 * was wired to `features.payments.present`; a yes (the product takes payments) answered it yes, but a
 * no answers nothing, because Article 3(22) reaches a supply "whether in return for payment or free
 * of charge", and reading the no as "not commercial" printed `does-not-apply` for a company's free
 * product (checker L, 2026-11-11, D1). The limb then listed `[true]`; since the second round the same
 * day it reads `cra.commercial_activity`, a field that asks Article 3(22)'s own question and lists
 * `[true, false]`, and the payments field reaches it in neither direction.
 *
 * **Five cases, and they are exhaustive:**
 *
 * 1. **Declared true, and true answers the limb.** The limb is settled by the declaration and counts
 *    toward the duty. The verdict can be stronger than the same tree gives with no profile, and that
 *    is intended — see "Which direction a declaration may move a verdict" below.
 * 2. **Declared false, false answers the limb, and the census holds no fact at all in the limb's
 *    `evidence_categories`.** The declaration answers the limb. This is the only route a gate has to
 *    `does-not-apply` from a declaration, and the verdict sentence names the declaration as the
 *    ground. No CRA limb lists false since 2026-11-11, so on the CRA gate this case is not reached.
 * 3. **Declared false, and the census holds facts in those categories, and none of them can settle
 *    the limb** — none is of a kind in `code_evidence.supports`, or the limb is about the product,
 *    where no fact can. The limb is `contradicted-by-declaration`, the disagreement is printed, and
 *    **the limb stays open**: the declaration cannot close it because the tree disagrees, and the
 *    tree cannot close it because only the person decides a fact about the product and only evidence a reader can open the line and
 *    confirm may decide a verdict at all. The verdict is
 *    `likely-applies` (`unresolved` where nothing but the EU pack's premise is settled, since 2026-11-13) and the
 *    limb is listed for the reader to answer.
 * 4. **Declared false, on a `decided_by: code` limb, and the census holds a fact of a kind in
 *    `code_evidence.supports`.** The limb is `contradicted-by-declaration` and is settled **by the
 *    tree**; the duty stands, and the disagreement is printed above it. No limb of the CRA gate is
 *    a `code` limb, so this case is not reached there: before 2026-11-10 it was, on
 *    `in-the-course-of-a-commercial-activity` off a billing call site, which let code decide a
 *    fact about the business against the person's own answer.
 * 5. **No profile, the profile has no value at that path, or its value is not one the limb's
 *    `declared_answers` lists (and is not a no the tree contradicts, case 3).** A `code` limb is
 *    decided by the tree alone. A limb about the product is not decided: it is open, and its facts
 *    are printed as what the code suggests; where the person gave a value, the verdict sentence
 *    names it and says it does not answer the limb.
 *
 * **Which direction a declaration may move a verdict.** A declaration of **no** never makes a
 * verdict stronger than the same tree produces with no profile at all: cases 3 and 4 above give
 * exactly the no-profile answer, and case 2 is strictly weaker. Case 3 was counted as case 4 from
 * 2026-07-30 to 2026-08-03, and in that state a truthful `features.payments.present = false`
 * produced `applies` — the instrument's strongest verdict — on 18 of 24 measured trees, decided by
 * a README sponsor badge, an `amount:` in a test mock, an `amount:` in a third-party OpenAPI
 * example, the string `'license_key'` in a list of column names and an LLM token count, each of
 * them printed four lines below its own verdict under the label "annotation only - cannot decide
 * the verdict".
 *
 * A declaration of **yes** can and does make a verdict stronger, and that is the intended
 * behaviour, not a defect. Measured 2026-08-03: `features.payments.present = true` moves 13 of the
 * same 24 trees from `likely-applies` to `applies`. Three reasons it is right. **First**, the limb
 * asks a question about the business — is the supply in the course of a commercial activity — and
 * the person who runs the business is a better source on it than any call site; the code can only
 * ever see part of it. **Second**, it moves the verdict toward the duty applying and never away
 * from it, which is the direction this product's whole asymmetry runs in: an over-stated verdict
 * produces a question a reader dismisses in a line, an under-stated one produces silence, and
 * silence is indistinguishable from a clean result. **Third**, the protection this gate needs runs
 * the other way — a declaration must not take an instrument off a project by itself — and that is
 * what cases 2 to 4 are about.
 *
 * **Since 2026-11-10 that yes no longer reaches `applies` on the CRA gate by itself, and since
 * 2026-11-11 the payments field reaches no CRA limb at all**; the measurement above describes the
 * evaluator before those dates. The CRA gate's four non-premise conditions — `is-a-product-with-
 * digital-elements`, `data-connection-in-intended-purpose-or-foreseeable-use`, `supplied-for-
 * distribution-or-use` and `in-the-course-of-a-commercial-activity` — are facts about the product,
 * each answered by the person in its own field (`cra.product_with_digital_elements`,
 * `cra.data_connection`, `cra.supplied_for_distribution_or_use`, `cra.commercial_activity`, asked by
 * `scan --review-declaration`), never settled by the code. With no answer the CRA verdict is
 * `unresolved` (since 2026-11-13,; before, the
 * EU pack's premise alone made it `likely-applies`), with a yes to one of them `likely-applies`; a product no the tree
 * does not contradict reaches `does-not-apply`, and four
 * yeses settle Article 2(1) - but reach `applies` only with every exclusion of
 * Article 2(2)-(7) answered no too, and stay `likely-applies` while one is open (since 2026-11-12,).
 *
 * `features.payments.present` is **narrower than Article 3(22)**, which reaches paid support,
 * monetisation intent and more, so its no understated the limb even when answered truthfully.
 * Reading that no as no answer was decided on Article 3(22)'s text; an earlier version of this
 * paragraph called the field's narrowness the owner's to decide, which was not so. The owner, told on
 * 2026-11-11, kept it so long as the reading is correct, and the non-author legal check found it correct.
 */

import type { CensusFact, Checklist, ChecklistLimb, ScanProfile } from "wolfboy-schemas";
import { jurisdictionAnsweredOut } from "./per-rule-applicability.js";
import { regimeCarried } from "./region-reach.js";

/**
 * Whether census facts may settle this limb: only where the limb turns on a fact about the code
 * itself (`decided_by: code`). A limb about the product — `either`, `documents`, `ask` — is
 * answered by the person or their declared documents, and its facts are what the code suggests;
 * `premise` is the EU pack's premise. The one reader of `decided_by` for this question, so the
 * evaluator, `unresolved_limbs`, the console in `scan.ts` and the one in `reconcile.ts` cannot hold
 * different rules.
 */
export function codeMaySettle(limb: { decided_by: ChecklistLimb["decided_by"] | string }): boolean {
  return limb.decided_by === "code";
}

/**
 * Whether the tree's facts settle this emitted limb on their own: a `code` limb the facts support,
 * including one the person answered no to while the tree holds a fact of a settling kind (case 4
 * of § THE DECLARATION PATH). False for every limb about the product, whatever the facts.
 */
export function settledByCode(o: Pick<LimbOutcome, "decided_by" | "state" | "supporting_count">): boolean {
  return (
    codeMaySettle(o) &&
    (o.state === "supported" || (o.state === "contradicted-by-declaration" && o.supporting_count > 0))
  );
}

/**
 * Whether a limb is still open for the person: nobody answered it and the code may not, or the
 * code may and its facts disagree or are absent. The test `unresolved_limbs` is built from.
 */
export function limbIsOpen(o: Pick<LimbOutcome, "decided_by" | "state" | "supporting_count">): boolean {
  if (o.state === "settled-by-premise" || o.state === "settled-by-declaration") return false;
  if (o.state === "unresolved" || o.state === "contested") return true;
  if (!codeMaySettle(o)) return true;
  // A `code` limb: supported or opposed is answered; a contradiction is open unless a fact settles it.
  return o.state === "contradicted-by-declaration" && o.supporting_count === 0;
}

/** Read a dotted path out of the profile. Returns undefined where any step is missing. */
function atPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export type LimbState =
  | "supported"
  | "opposed"
  | "contested"
  | "settled-by-premise"
  /** The person answered it in their own profile, and the code agrees or is silent — cases 1, 2
   *  and 5 of § THE DECLARATION PATH above. "Silent" is no fact at all in the limb's
   *  `evidence_categories`, not merely no fact able to settle it. */
  | "settled-by-declaration"
  /** The person said no and the tree carries something on the same subject — cases 3 and 4 of
   *  § THE DECLARATION PATH above. Whether the limb is settled is decided by `supporting`, not by
   *  being in this state; read the section rather than inferring the rule from the name. */
  | "contradicted-by-declaration"
  | "unresolved";

/**
 * One census fact as a limb cites it. It names the line and never quotes it: the census fact's
 * `line_text` is not copied here, because since 2026-09-23 findings.json carries no raw source
 * text. A reader opens `file` at `line`; the fact itself stays in the census under `fact_id`.
 */
export interface LimbEvidence {
  fact_id: string;
  kind: string;
  value: string;
  file: string;
  line: number;
}

export interface LimbOutcome {
  limb_id: string;
  question: string;
  // Narrowed 2026-08-13 to the checklist's own declaration rather than to `string`. These two values
  // are copied verbatim from a `ChecklistLimb` a few lines below, and `findings.schema.json` now
  // states both as enums — so `string` here was the loosest of three copies of one fact, and the
  // one that let the other two drift apart unnoticed.
  decided_by: ChecklistLimb["decided_by"];
  closes_gate_when: NonNullable<ChecklistLimb["closes_gate_when"]>;
  /** Citations of the provisions this limb rests on, so a reader can check it against the law. */
  quote_ref: string[];
  state: LimbState;
  /**
   * Facts the tree carries for this limb, and facts it carries against it. Never netted off, and
   * **capped at `LIMB_EVIDENCE_EXAMPLES` examples each, with the exact totals beside them.**
   *
   * The cap was added 2026-09-03, when the census stopped deciding a file's collector surface from
   * its extension. These two arrays are a SECOND COPY of facts that are already in `census.facts`
   * with their own `fact_id`s, re-serialised once per limb of every gate that names the kind — so a
   * tree whose fact count grows multiplies here, and one limb on one tree carries 70,440 evidence
   * rows. Layer 2 runs in the user's agent and the user pays for every byte of that.
   *
   * **The measurement, in bytes and with the unit named — the first record of it gave 1024-based
   * figures under a decimal label and read 5 % low** (independent verification, 2026-09-03). Same
   * build, same command, same tree, this constant the only difference:
   *
   *   one tree's `reconcile-input.json`   uncapped 216,772,862 B   capped 61,507,274 B   3.52x
   *
   * — 216.8 MB against 61.5 MB decimal, or 206.7 MiB against 58.7 MiB, the same bytes both ways.
   * Both real trees this wave measured end up SMALLER than before the census ungating despite
   * carrying more facts.
   *
   * ## The two containments that were built, measured and REJECTED
   *
   * Recorded here, beside the accepted one, because a rejection asserted in a commit message and
   * evidenced nowhere in the repository is not a record anybody can check. Both were rejected on the
   * same ground: the constraint on this wave is that census facts on the pinned trees may only gain,
   * and each of these loses BASELINE rows — rows the scanner produced before any of the work.
   *
   * **1. A per-file repeat cap** — at most N rows for one identical `(collector, kind, value)` in one
   * file. Against one tree's 4,474 pre-wave rows: a cap of 3 drops 2,767 of them, 20 drops 2,504, 50
   * drops 2,414. No ceiling bites the 460 bot-written consent records without biting the baseline
   * first, because the baseline's own worst file
   * (one test-data file) carries 2,582 rows by itself —
   * more than any consent record.
   *
   * **2. A record-set screen** — decline outbound-host rows from a file that is nothing but records
   * (`isRecordLine` over at least 80 % of its non-empty lines) and carries no request construct. It
   * declines 66,575 of the new rows, which is most of the growth, and it declines that same 2,582-row
   * baseline file too, which is a `.ts` the census has always read.
   *
   * So the residual is reported as cost rather than narrowed: **66,031 of that tree's 71,708 facts sit
   * under one folder** — 460 stored GitHub API webhook payloads written by a CLA bot, 66,013 of
   * them outbound-host rows naming `api.github.com` and its siblings. The project's standing rule is
   * that high candidate volume triggers the target-correctness question and never a narrowing, and
   * the target-correctness answer here is that those URLs really are URLs.
   *
   * **Nothing is lost and nothing is silent.** `supporting_count` and `opposing_count` are exact and
   * always written, so a limb settled by 70,440 facts still says 70,440; every one of those facts is
   * in `census.facts` under the `fact_id` this array's entries carry; and the skill's own rule
   * already reads these counts as "a count of rows, not a measure of evidence". No state, no
   * verdict, no `because` sentence and no contradiction test reads the array's length — all of them
   * are computed from the full sets before the cap is applied. **The CONSOLE reads the counts too**,
   * since 2026-09-03: three sites in `reconcile.ts` and `scan.ts` printed the capped array's length
   * as the population ("holds 20 fact(s) … and 19 more" over a limb carrying 228) while the exact
   * figure sat one field away, which made this paragraph's own claim false of the one thing a person
   * actually reads.
   */
  supporting: LimbEvidence[];
  opposing: LimbEvidence[];
  /** Exact, computed before the cap: `supporting.length` is a sample and this is the population. */
  supporting_count: number;
  /** Exact, computed before the cap. */
  opposing_count: number;
  /** Set when the limb bears on the verdict; annotation-only limbs carry false. */
  bears_on_verdict: boolean;
  /** The profile field this limb declares it can be settled by, and what the person answered. */
  declared_by?: string;
  declared_value?: boolean | null;
}

export type ScopeVerdict = "applies" | "likely-applies" | "does-not-apply" | "unresolved";

export interface ScopeAssessment {
  checklist_id: string;
  law: string;
  /** The official text this gate was verified against. Its CELEX number is what ties a rule's
   *  citation to this assessment, because a citation names the instrument and not the checklist. */
  source_url: string;
  /** The scope provision in its own words, so the verdict is never printed without its basis. */
  quote: string;
  cite: string;
  verdict: ScopeVerdict;
  /**
   * Why the verdict is what it is, in one sentence assembled from the limb states. Deliberately
   * mechanical: this module does not write prose about the law.
   */
  because: string;
  limbs: LimbOutcome[];
  /** Limb ids the code did not settle, in order. What a reader or an agent has to resolve. */
  unresolved_limbs: string[];
  /**
   * Limbs where the person running the scan said no and the tree says yes. Reported at the top of
   * the verdict, never resolved silently: this is the declaration-reconciliation pillar's own
   * question — does what you said match what you built — applied to the scope test.
   */
  contradictions: {
    limb_id: string;
    declared_by: string;
    /** Capped at `LIMB_EVIDENCE_EXAMPLES`, for the reason `LimbOutcome.supporting` gives. */
    evidence: LimbEvidence[];
    /** Exact, computed before the cap. */
    evidence_count: number;
  }[];
}

/**
 * Evidence rows one limb carries into `findings.json` and `reconcile-input.json`.
 *
 * **A display cap on a second copy, never a filter on the census.** See `LimbOutcome.supporting` for
 * the measurement that put it here. Twenty rather than the three `INVENTORY_CALL_SITE_EXAMPLES`
 * uses, because a limb's rows are heterogeneous — a gate limb reading `commercial` draws licence
 * checks, price identifiers, donation links and checkout routes, and three of them would routinely
 * be three of one kind — while an inventory's call sites are all the same import repeated.
 * Measured against the two committed fixture trees: no limb on either reaches twenty, so this cap
 * changes neither golden and is exercised by its own gate case rather than by a tree.
 */
export const LIMB_EVIDENCE_EXAMPLES = 20;

function evidenceOf(fact: CensusFact): LimbEvidence {
  return {
    fact_id: fact.fact_id,
    kind: fact.kind,
    value: fact.value,
    file: fact.file,
    line: fact.line,
  };
}

/**
 * Assess every checklist gate in the bundle that carries `limbs`.
 *
 * A gate without `limbs` is skipped and named in `skipped`, not silently dropped: eight of the nine
 * checklists were still prose-only when this was written, and a scan that quietly assessed one
 * instrument would look like a scan that had considered all nine.
 */
export function assessScope(
  checklists: Checklist[],
  facts: CensusFact[],
  profile?: ScanProfile | null,
): { assessments: ScopeAssessment[]; skipped: string[] } {
  const assessments: ScopeAssessment[] = [];
  const skipped: string[] = [];

  for (const checklist of checklists) {
    const gate = checklist.applicability;
    const limbs = gate?.limbs;
    if (!gate || !limbs || limbs.length === 0) {
      skipped.push(checklist.checklist_id);
      continue;
    }

    /**
     * Limb id -> every fact that contradicts a declared "no" on it.
     *
     * **Two different questions, run as one until 2026-07-30.** "What settles this limb?" is
     * `code_evidence.supports`, deliberately narrow, because settling a required limb produces the
     * instrument's strongest verdict. "Does the tree contradict what the person told us?" is wider:
     * a licence-key check or a price identifier cannot settle Article 3(22) and it plainly
     * contradicts `features.payments.present = false`. Running the second test with the first
     * test's set made a commercial open-core product carrying 263 commercial facts —
     * return `does-not-apply` from one profile field, above a report that said nothing contradicted
     * it.
     *
     * Held in a local map rather than on `LimbOutcome` because the emitted limb shape is pinned by
     * `findings.schema.json` with `additionalProperties: false`; the facts themselves reach
     * `findings.json` through `contradictions[].evidence` and through the characterisation limbs
     * that consult their kinds.
     */
    const contradictingByLimb = new Map<string, LimbEvidence[]>();

    const outcomes: LimbOutcome[] = limbs.map((limb) => {
      const supportsKinds = new Set(limb.code_evidence?.supports ?? []);
      const opposesKinds = new Set(limb.code_evidence?.opposes ?? []);
      // Kinds that say nothing either way about this limb's question.
      const neutralKinds = new Set(limb.code_evidence?.neutral ?? []);
      const supporting = facts.filter((f) => supportsKinds.has(f.kind)).map(evidenceOf);
      const opposing = facts.filter((f) => opposesKinds.has(f.kind)).map(evidenceOf);

      // Every fact in the categories this limb declares it reads, minus the ones already counted as
      // settling it: weaker than `supporting`, never able to settle anything, and enough to
      // contradict a declaration.
      const limbCategories = new Set<string>(limb.evidence_categories ?? []);
      const annotating =
        limbCategories.size === 0
          ? []
          : facts
              .filter((f) => !supportsKinds.has(f.kind) && !opposesKinds.has(f.kind) && !neutralKinds.has(f.kind))
              .filter((f) => f.categories.some((c) => limbCategories.has(c)))
              .map(evidenceOf);
      contradictingByLimb.set(limb.id, [...supporting, ...annotating]);

      // What the person running the scan already told us, where the limb names a profile field.
      // Owner observation, 2026-07-29: a question about the business is cheaper to ask than to
      // infer, and the profile is confirmed before the first scan. Inferring it was how a striped
      // progress bar came to decide whether the Cyber Resilience Act reached a project.
      const declaredRaw = limb.declared_by && profile ? atPath(profile, limb.declared_by) : undefined;
      // What the person declared, and whether it
      // answers THIS limb: only a value the limb's `declared_answers` lists does (§ THE DECLARATION PATH, "Which answers
      // a field gives"). `declared` keeps what they said, for the contradiction test and the printout; `answers` is
      // whether it settles anything.
      const declared = typeof declaredRaw === "boolean" ? declaredRaw : undefined;
      const answers = declared !== undefined && (limb.declared_answers ?? []).includes(declared);

      // **A declaration of "no" is contradicted by anything the tree carries on this limb's
      // subject, not only by what could settle the limb.** Owner decision 2026-07-30. Before it,
      // the test read `supporting.length > 0`, so a tree holding 263 commercial facts and no
      // payment route was reported as containing nothing that contradicts a declaration of no
      // payments — measured on one tree, and printed two lines above the facts themselves.
      const contradicting = declared === false ? [...supporting, ...annotating] : [];

      // The EU pack's premise that the
      // product is offered into the Union is the person's to deny: a No to the region question for the EU (which asks,
      // among its limbs, whether the product is offered to people or organisations there - making available on the
      // Union market, Article 3(22)) answers the premise limb no, and the gate follows that answer. Before this, a
      // region No set eu-cra-001 aside while this block still printed the premise as "taken as given". Since 2026-11-13 no region answer
      // reaches this for the CRA: Article 3(22) is supply "for distribution or use on the Union market", and the EU question
      // does not ask use, so `regimeCarried("cra")` is false, the premise stands and the four product questions decide.
      // The branch stays for a region question that asks every part the CRA's test needs.
      const premiseDenied = limb.decided_by === "premise" && regionAnsweredNo(profile);
      let state: LimbState;
      if (premiseDenied) state = "settled-by-declaration";
      else if (limb.decided_by === "premise") state = "settled-by-premise";
      else if (declared === false && contradicting.length > 0) state = "contradicted-by-declaration";
      else if (declared === true && answers) state = "settled-by-declaration";
      // A listed no the tree does not contradict is the answer, also
      // where the tree holds facts that agree with it (`opposes`, such as a package marked as not published): before, an
      // opposing fact took the limb to `opposed`, which no person-decided limb can count, and a truthful no stayed open.
      else if (declared === false && answers) state = "settled-by-declaration";
      else if (supporting.length > 0 && opposing.length > 0) state = "contested";
      else if (supporting.length > 0) state = "supported";
      else if (opposing.length > 0) state = "opposed";
      else state = "unresolved";

      return {
        limb_id: limb.id,
        question: limb.question,
        decided_by: limb.decided_by,
        closes_gate_when: limb.closes_gate_when ?? "never",
        quote_ref: limb.quote_ref ?? [],
        state,
        // Capped AFTER every decision above has been taken on the full sets: `state`,
        // `contradicting` and the verdict all read `supporting.length` and `opposing.length` before
        // this line, so the cap can move no outcome. The counts below are those full lengths.
        supporting: supporting.slice(0, LIMB_EVIDENCE_EXAMPLES),
        opposing: opposing.slice(0, LIMB_EVIDENCE_EXAMPLES),
        supporting_count: supporting.length,
        opposing_count: opposing.length,
        // `never` is how the owner's 2026-07-29 decision is written in data: a limb that closes on
        // no answer cannot change the verdict, only annotate it.
        bears_on_verdict: (limb.closes_gate_when ?? "never") !== "never",
        declared_by: premiseDenied ? REGION_ANSWER_FIELD : limb.declared_by,
        declared_value: premiseDenied ? false : declared === undefined ? null : declared,
      };
    });

    // Limbs that must be true for the instrument to reach the project.
    const required = outcomes.filter((o) => o.bears_on_verdict && o.closes_gate_when === "false");
    // Exemptions. Kept separate because they can only ever be resolved by a person, and an
    // unresolved exemption must not be read as a claimed one.
    const exemptions = outcomes.filter((o) => o.bears_on_verdict && o.closes_gate_when === "true");

    // **A contradiction never settles a limb that the same evidence could not settle on its own.**
    // This line is cases 3 and 4 of § THE DECLARATION PATH at the top of the file, which is where
    // the rule is stated; it is not restated here. What the code does: being in the
    // `contradicted-by-declaration` state settles nothing by itself, and `supporting` decides,
    // exactly as it does on a scan with no profile.
    //
    // The measurement that produced the correction, recorded because it is the reason this line
    // exists. The two paths were rebuilt and re-run over 24 trees on 2026-08-03. Before it,
    // `settled` accepted the state itself rather than what the state held, and **18 of the 24**
    // returned `applies` off a truthful `features.payments.present = false` while returning
    // `likely-applies` with no profile at all, sixteen real trees.
    // They were decided by exactly the evidence the same commit had
    // demoted to annotation and labelled as unable to decide. After it, all 24 agree.
    //
    // Two earlier counts of this defect were wrong and are corrected here: the first named a tree
    // that cannot reach `applies` on any path because `supplied-for-distribution-or-use` is
    // unresolved on it, and the second counted one tree twice and inherited the first one's error.
    //
    // **And since 2026-11-10 the tree settles nothing about the product** (`codeMaySettle`, and the
    // module header). Before it, `supported` and a contradicted limb holding a supporting fact
    // counted as met on every limb, so a package.json settled "is supplied for distribution or use"
    // and a billing call site settled "in the course of a commercial activity" over the person's own
    // answer of no. Now only the person's answer and the EU pack's premise settle such a limb, only
    // the person's no counts against it, and no code fact claims an exemption; on a `code` limb the
    // tree still decides, exactly as before.
    const settled = (o: LimbOutcome) =>
      o.state === "settled-by-premise" ||
      settledByCode(o) ||
      (o.state === "settled-by-declaration" && o.declared_value !== false);
    const against = required.filter(
      (o) =>
        (codeMaySettle(o) && o.state === "opposed") ||
        (o.state === "settled-by-declaration" && o.declared_value === false),
    );
    const claimedExemption = exemptions.filter((o) => codeMaySettle(o) && o.state === "supported");

    let verdict: ScopeVerdict;
    let because: string;
    if (claimedExemption.length > 0) {
      verdict = "does-not-apply";
      because = `exemption limb ${claimedExemption.map((o) => o.limb_id).join(", ")} is met by evidence in the tree`;
    } else if (against.length > 0) {
      verdict = "does-not-apply";
      // Name the source. The first version of this sentence said "the tree carries evidence
      // against" for a limb the *person* had answered, which tells a reader their repository said
      // something it never said. The second said "and nothing in the repository contradicts it",
      // which was false wherever the tree held a fact of a kind that annotates rather than settles;
      // the state above can no longer be reached in that case, and the sentence now says what
      // makes the claim true rather than asserting the claim.
      const byRegion = against.filter((o) => o.decided_by === "premise");
      const declared = against.filter((o) => o.state === "settled-by-declaration" && o.decided_by !== "premise");
      const fromTree = against.filter((o) => o.state !== "settled-by-declaration");
      because = [
        // Words
        byRegion.length > 0
          ? Array.isArray((profile as unknown as { regions_not_offered?: unknown } | null | undefined)?.regions_not_offered)
            ? `you answered No to the region question for the EU (no office, staff or other stable presence there, not offered to people or organisations there, no tracking or profiling of people there, no output of its AI used there), which answers ${byRegion.map((o) => o.limb_id).join(", ")}: the product is not made available on the Union market (Article 3(22)), so this law follows that answer`
            : // A list without regions_not_offered never asked the EU question's parts.
              `the EU is not in your distribution_regions, a list written without regions_not_offered, which answers only that the product is not offered there; that answers ${byRegion.map((o) => o.limb_id).join(", ")}: the product is not made available on the Union market (Article 3(22)), so this law follows that answer`
          : null,
        declared.length > 0
          ? `you declared ${declared.map((o) => `${o.declared_by} = false`).join(", ")}, which answers required limb ${declared.map((o) => o.limb_id).join(", ")}, and the census found no fact of any kind on that limb's subject — nothing that settles it and nothing that annotates it — so there is nothing in the repository to contradict what you said`
          : null,
        fromTree.length > 0
          ? `the tree carries evidence against required limb ${fromTree.map((o) => o.limb_id).join(", ")} and none for it`
          : null,
      ]
        .filter(Boolean)
        .join("; ");
    } else if (required.every(settled)) {
      // **An open exclusion keeps the verdict at
      // `likely-applies`.** Until 2026-11-12 this branch said `applies` and named the count of exclusions nobody answered.
      // Against the text that claims more than the answers settle: CRA Art 2(1) states the conditions and Art 2(2)-(4),
      // (6) and (7) say "This Regulation does not apply to" the products they name (and Art 2(5) lets a delegated act
      // exclude more), so the law reaches the product only where the conditions hold and no exclusion does; whether the
      // product is a medical device or a spare part is a fact about the product, asked and never assumed (the standing
      // rule as R10-CRA applied it: with no answer the verdict stays `likely-applies`, never `applies`). `applies` now
      // needs every exclusion answered no as well (https://publications.europa.eu/resource/celex/32024R2847, read 2026-11-12).
      const openExemptions = exemptions.filter((o) => !claimedExemption.includes(o) && limbIsOpen(o));
      verdict = openExemptions.length > 0 ? "likely-applies" : "applies";
      // **Name what settled each required limb.** This sentence read "settled by the tree or by the
      // pack's standing premise" until 2026-07-30, which was false whenever a declaration settled
      // one: the single input that moved the verdict was named nowhere in the output.
      // Only `code` limbs can be in the first and third counts (`settledByCode`).
      const byTree = required.filter((o) => codeMaySettle(o) && o.state === "supported").length;
      const byPremise = required.filter((o) => o.state === "settled-by-premise").length;
      const byDeclaration = required.filter((o) => o.state === "settled-by-declaration").length;
      const overDeclaration = required.filter((o) => codeMaySettle(o) && o.state === "contradicted-by-declaration").length;
      const parts = [
        byTree > 0 ? `${byTree} settled by evidence in the tree` : null,
        byDeclaration > 0 ? `${byDeclaration} by what you declared in your scan profile` : null,
        overDeclaration > 0
          ? `${overDeclaration} by evidence in the tree that contradicts what you declared`
          : null,
        byPremise > 0 ? `${byPremise} by the pack's standing premise` : null,
      ].filter(Boolean);
      // **Name the exemptions nobody answered.** This sentence read "all N limbs the instrument
      // requires are settled" until 2026-08-04, and "the instrument" is the whole Regulation. The
      // CRA gate's required limbs are the conditions of Article 2(1); the same instrument also has
      // five paragraphs of Article 2 that take a product back out, and a sixth — Article 2(5) —
      // empowering the Commission to adopt a delegated act that excludes, plus the exemptions its
      // recitals carry. An exemption limb can never be `supported` because no exemption in that
      // gate declares `code_evidence` — a route out of a Regulation may not be claimed by a
      // collector. So the strongest verdict was emitted over twelve unanswered exemptions while the
      // sentence asserted that the settled limbs exhausted what the instrument requires. The
      // verdict logic is unchanged; what changed is what the sentence claims about it.
      //
      // **"would take the product back out of it" is checked against the limbs it covers, not
      // assumed.** It reads only limbs whose `closes_gate_when` is `"true"`, and in the CRA gate all
      // eleven of those do subtract the product when answered yes — the three from recitals 16 and 18
      // by defeating "made available on the market", the seven from Article 2's excluding paragraphs,
      // and the eighth from a delegated act under Article 2(5) that EXCLUDES. Article 2(5)'s
      // limitation branch is a separate limb and is not an exemption, precisely so that this
      // sentence stays true; before 2026-08-04 the two branches were one exemption limb and the
      // sentence was false of it. The recital count was four until 2026-08-05, when
      // `not-for-profit-development` was demoted to `closes_gate_when: never`: Recital 18 says the
      // DEVELOPMENT of free and open-source software by a not-for-profit is not a commercial
      // activity and draws the development/supply distinction in terms, while Article 3(22) makes
      // the SUPPLY the thing that must be in the course of a commercial activity, so a
      // not-for-profit that develops such software and then sells it answered that limb truthfully
      // yes while supplying commercially — and the sentence below would have been false of it.
      //
      // The ids are deliberately not spelled out here. `unresolved_limbs` below carries every limb
      // whose `state` is `unresolved`, `contested`, or `contradicted-by-declaration` with no
      // supporting evidence — and an unanswered exemption is `unresolved` — so `scan.ts` prints each
      // with its question, one block below this sentence. (The filter reads `state`, not
      // `bears_on_verdict`; this comment named the wrong mechanism until 2026-08-04. The conclusion
      // was right either way, and the two agree here only because every exemption limb both bears on
      // the verdict and is unresolved.) Repeating eleven ids inside the verdict line would bury the
      // count that is the point. R10-REPORT's words without "what the code
      // suggests": since R10-CRA no product fact is taken as met from code, only an answer, a premise or a `code` limb. The sentence says why the verdict stops at likely-applies; the open
      // exclusions are listed by `unresolved_limbs`, each with its question, one block below (the reason given above
      // for not repeating their ids here still holds).
      because =
        `all ${required.length} conditions for this law to reach the project are taken as met (from your answers, the EU rules' premise or a fact about the code itself): ${parts.join(", ")}` +
        (openExemptions.length > 0
          ? `; but the law does not reach a product that one of its exclusions takes back out, and ${openExemptions.length === 1 ? "1 exclusion question is" : `${openExemptions.length} exclusion questions are`} not answered (listed with the open questions), so the verdict is likely-applies, not applies`
          : "");
    } else if (required.some(settled)) {
      const open = required.filter((o) => !settled(o));
      // **The pack's premise alone decides
      // nothing about the product.** `on-the-union-market` is settled by the EU pack's premise on every run, so until
      // 2026-11-13 this branch was taken with no answer and no fact at all, and every first report said the Cyber
      // Resilience Act likely applies, also for a web app run on the team's own servers, which Article 3(1) and Recital 12
      // leave outside it unless it is a product's remote data processing (https://publications.europa.eu/resource/celex/32024R2847).
      // With only premise limbs settled the verdict is `unresolved`, with the same sentence and the same questions;
      // a condition settled by an answer or by a `code` limb gives `likely-applies` as before. No rule is launched or set
      // aside by a gate verdict (the plugin's SKILL.md step 3a; scan.ts only annotates `depends_on_applicability`).
      verdict = required.some((o) => settled(o) && o.state !== "settled-by-premise") ? "likely-applies" : "unresolved";
      // A limb left open by case 2 above is named as what it is. The sentence used to say only
      // "not settled by code", which is true of it but hides the more important half: the person
      // answered this limb and their own tree disagrees with the answer. That is the single most
      // valuable thing the gate learned about the project, and a reader who is not told it will
      // read `likely-applies` as "the scanner found nothing here".
      const disputed = open.filter((o) => o.state === "contradicted-by-declaration");
      // A limb the person gave a value for that
      // does not answer it (a value its `declared_answers` does not list) is named with that value, so a person who
      // answered the field is told why the question is still put to them.
      const notAnswered = open.filter(
        (o) => o.state !== "contradicted-by-declaration" && o.declared_by !== undefined && typeof o.declared_value === "boolean",
      );
      // A limb about the product
      // that the code bears on is named as what it is: the code suggests it, and only the person can
      // confirm it. It is never counted as met.
      const suggested = open.filter(
        (o) =>
          o.state !== "contradicted-by-declaration" &&
          !codeMaySettle(o) &&
          (o.supporting_count > 0 || o.opposing_count > 0),
      );
      const quiet = open.filter((o) => !disputed.includes(o) && !suggested.includes(o));
      const ids = (xs: LimbOutcome[]) => xs.map((o) => o.limb_id).join(", ");
      const parts = [
        ...notAnswered.map(
          (o) =>
            `you declared ${o.declared_by} = ${String(o.declared_value)}, which does not answer ${o.limb_id}, so that question is still open`,
        ),
        suggested.length > 0
          ? `${ids(suggested)} ${suggested.length === 1 ? "is a fact" : "are facts"} about the product that the code suggests and only you can confirm, so ${suggested.length === 1 ? "it is" : "they are"} not counted as met and ${suggested.length === 1 ? "has" : "have"} to be answered`
          : null,
        quiet.length > 0
          ? `${ids(quiet)} ${quiet.length === 1 ? "is" : "are"} not shown by the code and ${quiet.length === 1 ? "has" : "have"} to be answered`
          : null,
        disputed.length > 0
          ? `${ids(disputed)} ${disputed.length === 1 ? "is" : "are"} disputed — you declared ${disputed.map((o) => `${o.declared_by} = false`).join(", ")} and the tree carries facts on that subject, none of which can decide the limb, so it stays open for you to answer`
          : null,
      ].filter(Boolean);
      const met = required.filter(settled);
      const metBy = [
        met.filter((o) => o.state === "settled-by-declaration").length > 0
          ? `${met.filter((o) => o.state === "settled-by-declaration").length} by your answers`
          : null,
        met.filter((o) => o.state === "settled-by-premise").length > 0
          ? `${met.filter((o) => o.state === "settled-by-premise").length} by the EU pack's premise`
          : null,
        met.filter((o) => settledByCode(o)).length > 0 ? `${met.filter((o) => settledByCode(o)).length} by evidence in the tree` : null,
      ].filter(Boolean);
      because = `${met.length} of ${required.length} required limbs are settled (${metBy.join(", ")}); ${parts.join("; ")}`;
    } else {
      verdict = "unresolved";
      // Same wording as the `applies` branch above, and for the same reason: "the limbs this
      // instrument requires" says the gate's required limbs are everything the instrument asks,
      // which is what the 2026-08-04 correction removed one screen up. It survived here because this
      // branch is unreachable for the CRA gate — `on-the-union-market` is `decided_by: premise`, so
      // at least one required limb is always settled — and an unreachable branch is exactly where a
      // sentence goes stale unnoticed.
      because = `none of the ${required.length} limbs required for this instrument to reach the project is settled`;
    }

    assessments.push({
      checklist_id: checklist.checklist_id,
      law: checklist.law,
      source_url: checklist.source_url,
      quote: gate.quote,
      cite: gate.cite,
      verdict,
      because,
      limbs: outcomes,
      // A limb the person answered "no" and the tree disagrees with, where nothing in the
      // disagreement could settle it, is a limb the reader has to resolve — so it belongs here.
      // Added 2026-08-03 with the correction above: without it the limb vanished from the output
      // between the contradiction block and the verdict sentence, and `scan.ts` printed no
      // `TO ANSWER` line for the one question the scan had actually raised.
      //
      // Since 2026-11-10 a limb about the product that the code supports or opposes is here too
      // (`limbIsOpen`): the code suggested an answer and nobody gave one, so it is a question.
      unresolved_limbs: outcomes.filter((o) => limbIsOpen(o)).map((o) => o.limb_id),
      // The evidence shown is the whole contradicting set — what settles the limb first, then what
      // only annotates it. Showing `supporting` alone printed an empty disagreement on any tree
      // whose commercial evidence was all of the annotating kinds, which is the ordinary case.
      contradictions: outcomes
        .filter((o) => o.state === "contradicted-by-declaration")
        .map((o) => {
          /* **Read once, from the uncapped map, and both fields computed from it.**
           *
           * This carried `?? o.supporting` as a fallback, and `o.supporting` is the 20-EXAMPLE
           * SAMPLE — so the fallback would have reported at most 20 in a field whose description
           * says "Exact, computed before the cap" (independent verification, 2026-09-03, LOW 8).
           * Unreachable, because `contradictingByLimb.set(limb.id, …)` runs unconditionally for
           * every limb, so no defect was observable; a fallback that cannot fire and would lie if it
           * did is worth deleting rather than documenting. An empty array is the honest default. */
          const contradicting = contradictingByLimb.get(o.limb_id) ?? [];
          return {
            limb_id: o.limb_id,
            declared_by: o.declared_by ?? "",
            evidence: contradicting.slice(0, LIMB_EVIDENCE_EXAMPLES),
            evidence_count: contradicting.length,
          };
        }),
    });
  }

  return { assessments, skipped };
}

/** The profile field the region answer is recorded in, as a premise limb names it. */
export const REGION_ANSWER_FIELD = "regions_not_offered";

/**
 * Whether the person answered No to the region question for the EU, by the
 * one membership rule (per-rule-applicability.ts `jurisdictionAnsweredOut`), and the CRA is a law that question carries
 * (region-reach.ts). No profile, no region answer or "unknown" is not a No. Since 2026-11-13 the CRA is not such a law
 * (region-reach.ts `cra.needs` holds use, which the EU question does not ask), so this is false for every profile.
 */
function regionAnsweredNo(profile: ScanProfile | null | undefined): boolean {
  if (!profile) return false;
  const p = profile as unknown as { distribution_regions?: unknown; regions_not_offered?: unknown };
  const yes = Array.isArray(p.distribution_regions) ? (p.distribution_regions as unknown[]).filter((r): r is string => typeof r === "string") : null;
  const no = Array.isArray(p.regions_not_offered) ? (p.regions_not_offered as unknown[]).filter((r): r is string => typeof r === "string") : undefined;
  // A list without regions_not_offered answers only CLOSED_LIST_PARTS for a place it leaves out.
  return regimeCarried("cra", no === undefined ? "closed-list" : "place-question") && jurisdictionAnsweredOut("EU", yes, no);
}
