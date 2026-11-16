/**
 * TypeScript types for the public data contracts, one-to-one with the JSON
 * Schemas in ../schemas/*.schema.json.
 *
 * The schemas are authoritative and these types follow them. If the two ever
 * disagree, change the types to match the schema, never the reverse: the
 * schemas are what already-emitted findings.json / evidence logs validate
 * against.
 */

export type Platform = "web" | "mobile" | "desktop" | "api";
export type Severity = "high" | "medium" | "low";
export type Confidence = "high" | "medium" | "low";

/**
 * The only payload that may ever leave the machine. It describes what the
 * product is, never what the code says: no snippets, paths or identifiers.
 *
 * **A profile IS validated against the JSON Schema at runtime, from 2026-09-02**. Both `--profile` consumers go through one shared
 * step, `product/packages/cli/src/profile.ts` `loadScanProfile`, which parses the
 * file, checks it against `scan-profile.schema.json`, prints every violation before
 * anything else the command says, and then **continues the run** with each violating
 * field treated as unanswered — `null` at that path, which `engine.ts`
 * `preconditionStatus` reads as "not answered" and never as "no". A profile that is
 * not an object of answers at all is discarded whole and the run continues with none.
 * The record of the check is `profile_validation` on `Findings` and `ReconcileInput`,
 * including the disclosure that the check did not run where the validator could not
 * be loaded.
 *
 * **What this deliberately is NOT: a reason to refuse.** Nothing here rejects a
 * profile, because a scan the tool declined to run is the largest form of the failure
 * this product exists to prevent. The downgrade only ever widens what runs — an
 * unanswered precondition suppresses nothing.
 *
 * **The history, kept because the record is the point.** Until 2026-09-02 this comment
 * read: *"Nothing validates a profile against the JSON Schema at runtime (measured
 * 2026-08-05): no Ajv instance in this repository compiles `scan-profile.schema.json`,
 * and both `--profile` consumers cast a parsed file to this type without checking it.
 * Every constraint in the schema is a specification its producer is expected to honour,
 * not a check that rejects a profile which does not. Turning validation on is a
 * behaviour change needing its own approval."* That was true, and the approval it
 * asked for is the one this change was made under.
 */
export interface ScanProfile {
  profile_version: "1";
  /**
   * Every form the product ships in. A single value (a profile written before
   * the list form) is read as a one-item list; "unknown" alone is the recorded "asked and not settled".
   */
  platform: Platform | "unknown" | (Platform | "unknown")[];
  /**
   * Which product the scanned code is, asked and never inferred: whether it is the software
   * of a vendor the recipient rules name (by the entry's name), or a fork of it, or neither.
   */
  product_identity?: { vendor_software?: "none" | { entry: string; relation: "own" | "fork" } };
  stacks?: string[];
  distribution_regions: string[]; // "EU" or an ISO 3166-1 alpha-2 country code
  /**
   * Open-world regions: the regions the person answered No to. A region in neither list is open, never No;
   * absent on a profile written under the earlier closed list, where `distribution_regions` is the whole list.
   */
  regions_not_offered?: string[];
  audience?: { minors_possible?: boolean; consumer?: boolean };
  /**
   * What kind of service the product is, where an instrument's scope turns on it. Asked of the person, never inferred from code; questions of kind
   * `scope`, so an out-of-scope answer from the program's confirmed record settles a rule naming the field.
   */
  scope?: { eaa_listed_service?: boolean; data_processing_service?: boolean | "maker" };
  /**
   * Facts about the **enterprise** running the scan, as distinct from the product it ships.
   * **Asked of the person running the scan, never inferred from code** — a headcount, a turnover
   * and a balance sheet total are not in a repository at all, and nothing in a tree corroborates or
   * contradicts them.
   *
   * Added 2026-09-07 (add the one
   * enterprise-size question first, the rest as each map is written). It holds one question today.
   * The retention-floor proposal, if approved, adds `business.retention_floors` and
   * `business.regulated_status` to this same object; the W9 A2 approval of 2026-09-02 also named
   * `business.establishment_country`, which is not built yet.
   *
   * **An answer here labels what a rule reports and never stops a rule from reading** (the ruling of
   * 2026-08-27, asserted by a test for the engine, over other fields), and
   * **no rule reads this field yet** — measured across `rules/` on 2026-09-07: no
   * `applicability_preconditions` expression, gate limb or checklist item names a `business.` path.
   * (Corrected 2026-09-07: this read "nothing names `business` in any form", which is false —
   * `rules/reconcile-fixtures/checklist-cases/eaa-accessibility-statement-13-2/EXPECTATIONS.md` names
   * `business.microenterprise` twice as a profile path, in prose about a deferral. It is not a rule, a
   * gate or a checklist and reads nothing, so the conclusion stands and only its evidence was wrong.)
   * The map rows that
   * would are the EU map's DSA Art. 19(1) and NIS2 Art. 2(1) rows, the eIDAS 2 row
   * of the finance map (Art. 5f(2)) and the P2B candidates of the consumer-contract map.
   *
   * See the JSON Schema for the full reasoning; it is authoritative. Each field's `description`
   * there is the question as a person answering it should read it, with the thresholds quoted from
   * Commission Recommendation 2003/361/EC, and its `$comment` carries the provenance.
   */
  business?: {
    /**
     * Enterprise size under Commission Recommendation 2003/361/EC. Every field is optional and
     * `unknown` is a real answer: a size-gated row is then reported as an open question and never as
     * one that does not reach this enterprise.
     */
    size?: {
      /**
       * The operator's own classification — the smallest category the enterprise is in. `large` is
       * not a category the Recommendation defines; it means only "outside the SME category". Nor is
       * `medium` a standalone category there: Art. 2(1) draws the whole SME category and Arts. 2(2)
       * and 2(3) carve the two smaller ones out of it, so `medium` means "inside Art. 2(1) and
       * outside Arts. 2(2) and 2(3)" — which is what answering with the smallest category produces.
       * **Declared, never computed from the bands below**: Annex Art. 3 makes the category turn on
       * autonomous / partner / linked relationships this profile does not carry, and Art. 6(2)'s
       * proportional aggregation cannot be done from band labels. Where the class and the bands
       * disagree, the class is the answer and the disagreement is worth reporting.
       */
      class?: "micro" | "small" | "medium" | "large" | "unknown";
      /** Annual work units per Annex Art. 5, banded at the Art. 2 boundaries. Never the number. */
      staff_headcount_band?: "lt_10" | "10_to_49" | "50_to_249" | "250_plus" | "unknown";
      /** Banded at the Art. 2 ceilings; each value names the lowest ceiling the figure does not exceed. */
      annual_turnover_band_eur?: "le_2m" | "le_10m" | "le_50m" | "gt_50m" | "unknown";
      /** Same shape, different top ceiling: Art. 2(1)'s balance-sheet limb is EUR 43 million, not 50. */
      balance_sheet_band_eur?: "le_2m" | "le_10m" | "le_43m" | "gt_43m" | "unknown";
      /** Whether partner and linked enterprises (Annex Arts. 3 and 6(2)) are inside the figures above. */
      linked_enterprises_counted?: boolean;
      /** The accounting period the figures belong to (Annex Art. 4(1)), ISO 8601 date. */
      as_of?: string;
      /**
       * Free text. **The one field in this block that can narrow who is asking**, which is why it is
       * optional and why it states its own residual in its own description. The root prohibition
       * applies unchanged: no source fragment, no file path, no identifier read from the tree.
       */
      basis_note?: string;
    };
  };
  /**
   * On what terms the product is supplied. **Asked of the person running the scan, never
   * inferred from code.** Deliberately not a single `is_open_source` boolean: AI Act Art. 2(12)
   * with recital 103, and CRA Art. 3(22) with recitals 15, 16 and 18, both turn on the licence
   * answer AND the monetisation answer together, and the monetisation answer has to say *how* —
   * charging a price and accepting donations that do not exceed costs point in opposite
   * directions under the same recital. Neither instrument is settled here: a system placed on
   * the market as high-risk is inside the AI Act however it is licensed, and the CRA's
   * free-and-open-source routes out are exemptions a person claims. The monetisation question
   * is asked twice because the two instruments ask it differently — `by_the_manufacturer` for
   * the CRA, `by_anyone_including_third_parties` for the AI Act. See the JSON Schema for the
   * full reasoning on each field; it is authoritative. Each field's `description` there is the
   * question as a person answering it should read it, and its `$comment` carries the
   * provenance, the measurements and the correction history.
   */
  supply?: {
    licence?: {
      free_and_open_source?: boolean;
      /**
       * SPDX identifier or expression the product is released under. A **closed** vocabulary
       * with no free text in any position, which the schema's pattern **enumerates**: every
       * operand must be an identifier on the published SPDX Licence List, optionally `+`-suffixed
       * and optionally followed by ` WITH ` and one of the 86 published exception identifiers,
       * with operands joined only by `AND`, `OR` and parentheses, so a bespoke or `LicenseRef-`
       * name is not expressible. A `maxLength` of 128 caps the whole expression, so the schema
       * does not admit a longer truthful one either.
       *
       * **Closed is not the same as small** (corrected 2026-08-05): this read "a published,
       * closed vocabulary of at most 733 values", which is false of the field as specified —
       * the pattern accepts *expressions*, so `Apache-2.0 OR MIT` passes and is not one of the
       * 733. The accepted set is combinatorial over 733 operands and 86 exception terms up to
       * 128 characters. Closure is what the confidentiality argument needs; cardinality was
       * never what it rested on.
       *
       * **It does not fingerprint nothing** — that claim was falsified by enumerating the
       * accepted set (independent check, 2026-08-05). Some ids name their licence's author
       * (`Intel`, `Nokia`, `HPND-Markus-Kuhn`, `curl`), and single-vendor ids such as
       * `Zimbra-1.4` or `SugarCRM-1.1.3` narrow the answer to the products built on one
       * vendor's stack. An SPDX id names the licence's author rather than the declarant, so
       * `Intel` does not make the product Intel's, and an id that names nobody — `MIT`,
       * `Apache-2.0` — narrows to the products released under that licence and no further.
       * A *combination* carries the residual of every operand in it: `Zimbra-1.4 OR Elastic-2.0`
       * identifies more sharply than `Zimbra-1.4` alone, while `MIT OR Apache-2.0` names nobody
       * and carries no more than `MIT` does. The single-vendor operands in a combination decide
       * it, not the fact that it is a combination. (Corrected 2026-08-05: the schema briefly said
       * "a dual-licence answer carries more of the residual", which is a claim about how projects
       * declare their licences that nothing here has measured, and is false of the common ones.)
       * The narrowing is real for the vendor-named ids, the field is optional for that
       * reason, and the schema description states the residual so the person filling it in
       * can choose to omit it. It is the one field in `supply` that can narrow; **five** fields
       * elsewhere in the profile (`stacks[]`, `features.llm.providers[]`,
       * `features.payments.provider`, `features.analytics_ads[]`, `business.size.basis_note`) take
       * arbitrary strings. (Corrected 2026-09-07: this sentence read "four fields" and was written
       * in the present tense, so `business.size.basis_note` made it short by one the day that field
       * was added. The two sentences in `scan-profile.schema.json` that count four are explicitly
       * dated 2026-08-05 and are left standing as the measurements they were.)
       *
       * Nothing validates this at runtime. Regenerate the pattern with
       * a tool when SPDX publishes a release; it is a snapshot and ages.
       * Corroborates `free_and_open_source`, never decides it.
       */
      spdx_id?: string;
    };
    /** CRA recitals 15, 16 and 18; AI Act recital 103. None of these is wired to a gate limb yet. */
    monetisation?: {
      /**
       * True if the **manufacturer** monetises the product. **The CRA's question, and the
       * limitation to the manufacturer is the CRA's own**: `monetis*` occurs 7 times in
       * 32024R2847 and the CRA names the agent three times (recital 15 once, recital 18
       * twice). Monetisation by an unrelated third party is `false` here; the AI Act's
       * version of the question is `by_anyone_including_third_parties` below.
       */
      by_the_manufacturer?: boolean;
      /**
       * True if **anyone at all** monetises the product or its AI components — the releasing
       * party, a reseller, a hosting provider, anyone. **The AI Act's question, and it does
       * not say who does the monetising**: neither `monetis*` occurrence in 32024R1689
       * attaches an agent, the word "by" not occurring anywhere in recital 103, and the AI
       * Act's actor there is the *provider*, not the manufacturer. (Corrected 2026-08-05:
       * this read "agentless passive", which is false of the second occurrence — the noun "a
       * monetisation" inside an active clause. Agentlessness is the whole of what the
       * argument needs.)
       *
       * Split out of `by_the_manufacturer` on 2026-08-05. Carrying the manufacturer
       * limitation across to the AI Act was this repository's reading and is contestable: on
       * recital 103's literal words a freely licensed component resold by a third party with
       * paid support may be one "provided against a price or otherwise monetised", so a
       * `false` on a manufacturer-limited field claimed an Art. 2(12) exception the literal
       * words may not give — the unsafe direction. This field asks the widest reading
       * instead, so it is always `true` where `by_the_manufacturer` is `true`.
       *
       * **Naming Art. 2(12) is a reading, not the recital's own word** (added 2026-08-05).
       * Recital 103 says "the exceptions", plural, and the AI Act's enacting terms carry four
       * free-and-open-source exceptions — Arts. 2(12), 25(4), 53(2) and 54(6). This block
       * reads the carve-back as reaching Art. 2(12), that being the only one of the four
       * addressed to an AI *system*. The schema's `$comment` records why and what is arguable.
       *
       * **Omit it rather than answering `false` where you do not monetise it yourself and
       * cannot establish whether anyone downstream does** — a `false` here is a claim on the
       * Art. 2(12) exception, so the blank is the safe direction and the confident `false` is
       * not. Nothing under `supply` is required, and an omission cannot be told apart from a
       * field nobody read, so an absent answer must not be read as a `false`.
       */
      by_anyone_including_third_parties?: boolean;
      price_charged?: boolean;
      /**
       * CRA-only qualifier: AI Act recital 103 names technical support with no cost-recovery
       * limit, so a `true` here answers both instruments while a `false` answers only the CRA,
       * and the AI Act answer is `by_anyone_including_third_parties`. (Added 2026-08-05: this
       * carried the CRA-only header without the `true` half, where its structural twin
       * `personal_data_required_as_a_condition_of_use` already had it.)
       */
      paid_technical_support_beyond_cost_recovery?: boolean;
      intention_to_monetise?: boolean;
      /**
       * CRA-only qualifier: AI Act recital 103 has no "as a condition for use" limb, so the AI
       * Act answer is `by_anyone_including_third_parties`.
       */
      personal_data_required_as_a_condition_of_use?: boolean;
      donations_exceeding_costs?: boolean;
      fee_recovers_operating_costs_only?: boolean;
      not_for_profit_organisation?: boolean;
      /**
       * AI Act recital 103 only; settles nothing under the CRA's commercial-activity test.
       * Recital 103 says "transactions between microenterprises", so **both** parties to every
       * transaction must qualify — an unverifiable counterparty means the answer is not `true`.
       * (Scoped 2026-08-05: the CRA does define microenterprises, in Art. 3(19), and devotes
       * Art. 33 and Art. 64(10)(a) to them; what it has no counterpart for is this carve-back.)
       */
      only_between_microenterprises?: boolean;
    };
    /**
     * CRA Art. 3(6) and recital 18's component route out of scope.
     *
     * **The AI Act's counterpart is Art. 25(4), second sentence** (corrected 2026-08-05: this
     * read "The AI Act does not use this route", which is false). Art. 25(4) disapplies *that
     * paragraph's* value-chain written-agreement duty to third parties making tools, services,
     * processes or components — other than general-purpose AI models — accessible to the public
     * under a free and open-source licence, with recital 89 naming the integration relationship
     * expressly. It relieves one duty rather than putting the supplier outside the Regulation, so
     * it is not a route out the way the CRA's is.
     *
     * **Art. 25(4) prints no monetisation condition — `monetis*` occurs zero times in Art. 25 —
     * but that is not an answer for a supplier who monetises** (corrected 2026-08-05: this read
     * "and it carries no monetisation condition", flat and unqualified). Recital 103 withdraws
     * "the exceptions", plural, from monetised free-and-open-source components; the enacting terms
     * carry four and Art. 25(4) is one of them; which of the four the withdrawal reaches is
     * unsettled and the schema's `$comment` records it as such.
     *
     * **Art. 25(4) is also wider than this field**: its first sentence reaches a third party
     * supplying tools, services, components or processes *used or integrated* in a high-risk AI
     * system — used, not only integrated; tools, services and processes, not only components — so
     * a `false` here does not close it.
     */
    component_for_integration_by_other_manufacturers?: boolean;
  };
  /**
   * The Cyber Resilience Act's
   * conditions that are facts about the product, answered by the person and read by the CRA gate's limbs (`declared_by`).
   * Never inferred from code.
   */
  cra?: {
    product_with_digital_elements?: boolean;
    data_connection?: boolean;
    supplied_for_distribution_or_use?: boolean;
    commercial_activity?: boolean;
  };
  features?: {
    llm?: { present?: boolean; providers?: string[]; companion_like?: boolean };
    payments?: { present?: boolean; recurring?: boolean; provider?: string };
    analytics_ads?: string[];
    /**
     * Whether an own-domain or configured address the product sends analytics, error reports, session recordings or
     * telemetry to passes the data on to the vendor (a reverse proxy) or is the operator's own instance. **Asked of the
     * person running the scan, never inferred from code**: the code is identical either way.
     */
    own_domain_endpoints?: "forward_to_vendor" | "own_instance" | "mixed";
    health_context?: boolean;
    ugc?: boolean;
    genai_media?: boolean;
    /**
     * AI Act Annex III areas. **Asked of the person running the scan, never inferred from code.**
     * `candidate_id` in a tree does not make the product an applicant-tracking system, and an
     * applicant-tracking system need not contain it. Same principle as `health_context` above and
     * as the CRA gate's commercial-activity limb.
     */
    annex_iii_use?: {
      hiring_or_worker_management?: boolean;
      education_assessment_or_admission?: boolean;
      creditworthiness_or_insurance_pricing?: boolean;
      /** Annex III pt 5(d) carries no public-authority qualifier, unlike pt 5(a). */
      emergency_triage_or_dispatch?: boolean;
    };
  };
  /**
   * Facts about the organisation that runs the product, which the code cannot show: questions of kind `condition`.
   */
  operator?: {
    special_category_condition?: "yes" | "no" | "maker";
    ai_text_public_interest?: boolean | "maker";
    model_purpose_stated?: boolean | "maker";
  };
  declared_artifacts?: {
    privacy_policy?: boolean;
    tos?: boolean;
    xcprivacy?: boolean;
    play_data_safety?: boolean;
  };
}

/**
 * How a run treated the profile as a whole (W5, 2026-09-02).
 *
 * `as-written` covers THREE states, and is read with `ran` AND `valid`, never with either alone:
 *
 *  - the valid profile (`ran: true`, `valid: true`);
 *  - the one nothing could check (`ran: false`), used as written — which is exactly what makes
 *    `ran: false` a disclosure and never a pass;
 *  - the one that WAS checked, is invalid, and had nothing that could be downgraded (`ran: true`,
 *    `valid: false`) — a missing required field is absent already, so there is no value to replace.
 *
 * **Corrected 2026-09-02**: this said the first two were told apart by `ran`, which does not
 * separate the third from the first. Found by the independent check, which measured a profile with
 * `distribution_regions` deleted coming back `ran: true, valid: false, as-written`.
 */
export type ProfileTreatment = "as-written" | "fields-downgraded" | "discarded";

/** One thing `scan-profile.schema.json` objected to, and what the run did about it. */
export interface ProfileViolation {
  /** JSON Pointer into the profile. `/` is the profile itself. */
  path: string;
  /** What the schema requires at that path, in the validator's own words. */
  expected: string;
  /**
   * The value that was there, as JSON, truncated past 200 characters and marked when it is.
   *
   * This is where the file's own answer survives. The profile carried in the same document is the
   * profile AS READ, so a downgraded field reads `null` there; the rejected value is here, beside
   * the path it sat at, so a reader can see both without guessing either from the other.
   */
  found: string;
  /** What the run did with it. Never a repair and never a guess: the field becomes unanswered. */
  treated_as: string;
}

/**
 * The record of the profile schema check, on `Findings` and on `ReconcileInput` (W5, 2026-09-02).
 *
 * **The check never refuses and never narrows.** A violating field is treated as unanswered, which
 * is the state in which the rules naming it still run and carry the open question; a profile that is
 * not an object of answers is discarded whole, which is the state in which every rule runs. Both
 * directions are widenings, which is what makes it safe to apply to somebody's declaration without
 * asking first.
 */
export interface ProfileValidation {
  /** Whether the schema check ran at all. `false` is a disclosure and is never read as a pass. */
  ran: boolean;
  /** Whether the profile matched the schema. Always `false` where the check did not run. */
  valid: boolean;
  /** Why the check did not run. Empty when it did, and never empty when it did not. */
  unavailable_reason: string;
  /** What the run did with the profile as a whole. Read it with `ran` and `valid`, not alone. */
  profile_treated_as: ProfileTreatment;
  /**
   * Every violation, in the order the validator reported them. Empty where the profile is valid and
   * where the validator could not be loaded — but **not** where the check did not run at all: a file
   * that is not JSON and a file that is not a JSON object each carry one violation at `/` with
   * `ran: false`, and those are the loudest cases this block has.
   */
  violations: ProfileViolation[];
}

/** A citation to the statute, guidance or ruling a rule rests on. */
export interface LegalBasis {
  cite: string;
  url?: string;
  checked_at: string; // date the citation was last verified against the source
}

export type DetectorEngine = "builtin-regex" | "ast-grep" | "opengrep";

/**
 * How far a rule's `also_in_file` corroboration may look (`detector.gate_scope`).
 *
 * `"file"` is the default and the only behaviour that existed before this field. `"directory"` is
 * the file's own immediate parent, the same reading `fingerprint_spec: "directory"` has, and does
 * not descend into subdirectories. `"project"` is every file the rule is allowed to read in the
 * scan. Declared here as a named type rather than spelled out at both use sites, because the engine
 * imports it and the project's rules forbid a second copy of a fact two places must agree on.
 */
/**
 * What a rule does with the `also_in_file` corroboration computed for the clauses
 * `detector.gate_applies_to` names (`detector.gate_mode`). `"annotate"` is the default and the only
 * one of the two that cannot create a miss: it removes no candidate and writes the answer onto the
 * location as `corroborated_in_project`. `"gate"` removes the subject clauses' uncorroborated
 * candidates and records them as a corroboration suppression.
 */
export type GateMode = "annotate" | "gate";

export type GateScope = "file" | "directory" | "project";

/**
 * How a rule finds candidates. The negative fields exist to keep precision
 * high: a detector that fires on every plausible line is worse than useless,
 * because reviewers stop reading the output.
 */
export interface Detector {
  engine: DetectorEngine;
  match?: string[];         // a line matching any of these raises a candidate
  match_without?: string[]; // drop it if the same line also matches these (same-line negation)
  guard_missing?: string[]; // the rule only fires when the guard is *missing*: suppress if any appears in scope
  also_in_file?: string[];  // suppress unless at least one of these appears elsewhere in the same file
  path_without?: string[];  // skip candidates whose file path matches (tests, vendored code, examples)
  file_globs?: string[];
  // Derived views this rule opts into. Both are additive and neither can move a reported line
  // number; see product/packages/cli/src/derive.ts for what each resolves and why.
  // also_in_file is ALSO tested against each named derived view. "comments-visible" is the file's
  // own text with nothing blanked; it is admissible because also_in_file is POSITIVE corroboration,
  // and nothing like it may ever reach the negative guard_missing. See rule.schema.json.
  gate_view?: ("yaml-anchors" | "comments-visible")[];
  /**
   * How far this rule's `also_in_file` corroboration may look. Absent and `"file"` are the same
   * evaluation, character for character: the clause list is tested against this file's own
   * comment-blanked text and nothing else. A wider scope is a UNION with that test — the file's own
   * result is taken first and its `true` stands — so it can only open a gate that was shut. Opt-in
   * per rule, inert when absent, and a hard error at build time without `also_in_file`. See
   * rule.schema.json for the whole contract and product/packages/cli/src/engine.ts for the two
   * phases it is decided in.
   */
  gate_scope?: GateScope;
  /**
   * WHICH OF THIS RULE'S OWN CLAUSES THE `also_in_file` CORROBORATION IS ABOUT — `match[i]` with the
   * index 0-based, the reference grammar `detector.cost_exempt` and `detector.volume_exempt` already
   * use. Absent means EVERY clause, which is what every rule declaring `also_in_file` has always
   * done, byte for byte.
   *
   * The gate had a scope and no SUBJECT. On a rule whose clause groups are deliberately written so
   * that any one of them can fire alone, a rule-global gate silences the clauses that were never
   * ambiguous together with the one that was — which is why `remote-actuation-001` (rule.yaml:136)
   * and `eu-minors-001` (rule.yaml:482) each record, in their own file, a decision AGAINST declaring
   * one. Those decisions are about a gate with no subject.
   *
   * A candidate is in the subject only when EVERY clause it fired is named here and at least one
   * fired: a line that also fired an unnamed clause is never touched, and a structural-reading
   * candidate, which fires no `match` clause, is never touched either. Both directions are the safe
   * one — subtraction is the only operation that can create a miss.
   */
  gate_applies_to?: string[];
  /**
   * WHAT THE ENGINE DOES with the corroboration computed for the clauses `gate_applies_to` names —
   * read only when that field is present.
   *
   * `"annotate"` is the default and removes nothing: every candidate stands and each location of a
   * subject clause carries `corroborated_in_project`, so layer 2 gets the fact layer 1 computed as a
   * named premise instead of a silence. `"gate"` is the subtracting form, recorded in
   * `suppressed_by_corroboration` exactly as a rule-global gate's removal is. The mode that
   * subtracts is the one a rule has to ask for in terms.
   */
  gate_mode?: GateMode;
  resolve_import_aliases?: boolean; // match is ALSO tested against the alias-resolved line
  /**
   * When true, `match` is ALSO tested against a copy of each line in which a name defined in the
   * SAME FILE as a string literal has been replaced by that literal, and adjacent literals joined
   * by `+`, `.` or `<>` have been folded into one. One hop: a definition whose right-hand side is
   * another name binds nothing, so no chain can be walked. Additive, opt-in per rule, and inert
   * when absent. See product/packages/cli/src/derive.ts `localValueTable`.
   */
  resolve_local_values?: boolean;
  /**
   * When true, `match` is ALSO tested against the whole of the BRACKET-BALANCED construct that opens
   * on each line, folded onto one string — so an options object, a struct literal or a call whose
   * arguments are written over several physical lines is matched as one text. The construct is the
   * run of lines from the one whose brackets open it to the one at which they balance again,
   * counting only brackets outside string literals; a trailing operator with no bracket and a
   * backslash continuation are deliberately NOT folded. The ORIGINAL line is tested first and is the
   * sole authority for the candidate's line number and quoted text — a finding on a five-line
   * literal reports the line it OPENS on — and the candidate carries the span it was folded from in
   * `locations[].joined_from`. Additive, opt-in per rule, and inert when absent. See
   * product/packages/cli/src/derive.ts `joinedConstructView`.
   *
   * A CONSTRUCT INSIDE ANOTHER IS FOLDED AT EACH OPENING LINE, AND THE ENCLOSING REPORT IS DROPPED
   * WHEN IT READS NOTHING NEW. A literal written inside a closure folds on its own opening line and
   * so does the closure, and both folds carry the literal. From 2026-09-07 the outer one is not
   * reported when EVERY clause it fired is also fired by candidates of the same rule lying inside
   * its own fold span; it is counted in `stats.joined_outer_duplicates_dropped` and its opening line
   * is kept on the first surviving report inside that span, in file order, in
   * `locations[].also_opens_at`. An outer candidate
   * that fires a clause NOTHING inside it fires is REPORTED UNCHANGED — a clause requiring a
   * cookie-family word on the line is satisfied at the enclosing construct, whose opening line
   * carries the word, and is not satisfied inside it, so that reading exists nowhere else and is
   * never dropped. Nothing without a fold span is ever dropped, and no line number moves.
   * See product/packages/cli/src/engine.ts `collapseNestedDuplicates`.
   */
  join_bracketed_constructs?: boolean;
  /**
   * When true, `match` is tested against the raw line ONLY, so this rule may fire on evidence that
   * exists only inside a comment. Every other rule must match the raw line AND the same line with
   * its comments blanked. Opt-in, per rule, and it is a widening: absent, a comment cannot raise a
   * candidate. See product/packages/cli/src/engine.ts `matchFires`.
   */
  match_in_comments?: boolean;
  /**
   * Named sets of structural (parse-tree) checks this rule is ALSO read by. Opt-in and inert by
   * absence: no file is parsed and no grammar is loaded for a rule that names none. A set may only
   * ADD candidates, at lines of the original file, and every way the parse can fail falls back to
   * the line-based reading and is counted. See product/packages/cli/src/structural/.
   */
  structural_checks?: ("accessibility-elements-v1")[];
  /**
   * Named lists of literal strings this rule matches on, declared once and spliced into its
   * patterns with `(?&name)` — and read by name by any structural check set it declares, so that
   * the words the two readings look for cannot drift apart. See
   * product/packages/cli/src/vocabulary.ts.
   */
  vocabulary?: Record<string, string[]>;
  /**
   * How named lists above are spelled into the patterns that splice them: `case_insensitive` folds
   * an item's ASCII letters, `separator_insensitive` lets a `-`/`_`/`.` run BETWEEN two
   * alphanumerics match any separators or none. Opt-in per list and inert by absence — an unflagged
   * list compiles the byte-identical alternation it compiled before the capability existed. Both
   * flags only ever WIDEN what a list matches, which is why a flagged list may not be spliced into
   * `match_without`, `path_without` or `guard_missing`. A shared list declares its own matching in
   * `rules/vocabulary/*.yaml` and the build merges it here, the way it merges the anchors. See
   * product/packages/cli/src/vocabulary.ts.
   */
  vocabulary_matching?: Record<string, { case_insensitive?: boolean; separator_insensitive?: boolean }>;
  /**
   * WHAT each shared list's items are — the `kind` its file in `rules/vocabulary/` declares,
   * merged in by the build the way the anchors and the matching flags are.
   *
   * **Written by `tools/build-bundle.mjs`, never by a rule author.** It is deliberately absent from
   * `rule.schema.json`, whose `detector` sets `additionalProperties: false` and which the build
   * validates a rule against BEFORE the merge — so a hand-written `vocabulary_kinds` fails the
   * build, and the build's own write happens after validation. There is nothing for an author to
   * declare: `kind` is a property of a shared list, stated once in the file that owns it.
   *
   * What reads it: `scan.ts`, to tell a list of vendor spellings (`kind: "recipient"`) from a list
   * of construct spellings once `mergeSharedVocabulary` has flattened both into `vocabulary` above.
   * Absent on every rule that imports no shared list, and on every list whose file declares no kind.
   */
  vocabulary_kinds?: Record<string, string>;
  /**
   * WHO each shared anchor is a spelling of, by list and anchor: the name of the `rules/vocabulary/` entry that owns it
   * (a recipient entry's `vendor` up to its em dash, or a term entry's `term`). **Written by `tools/build-bundle.mjs`,
   * never by a rule author**, after validation, exactly as `vocabulary_kinds` above. What reads it: `assemble-report`,
   * which names a candidate's token items in the report from it (`item-label.ts`); the scanner does
   * not, so the findings document is what it was. Absent on a rule that imports no shared list.
   */
  vocabulary_owners?: Record<string, Record<string, string>>;
  /**
   * The legal entity each recipient entry names after its name, by the entry's name (the `vocabulary_owners` values).
   * Written by `tools/build-bundle.mjs` after validation (vocabulary.ts `mergeVocabularyEntities`); read by the self-name
   * question, which offers each vendor by its name and legal entity.
   */
  vocabulary_entities?: Record<string, string>;
  query_ref?: string;       // external query for ast-grep/opengrep (W2+)
}

export interface Rule {
  id: string;
  pack: string;
  title: string;
  /**
   * A short plain name for the person (the drafted
   * names go into the product now): what the report's first screen and work list call the rule ("Tracking
   * script placed on a page"), where `title` is detector-shaped. Required, at most 60 characters, never shared by two
   * rules (rule.schema.json; tools/build-bundle.mjs).
   */
  short_name: string;
  jurisdiction: string[];
  legal_basis: LegalBasis[];
  effective_date?: string;
  sunset?: string | null;
  superseded_by?: string | null;
  severity: Severity;
  rule_confidence: number; // 0..1; how much we trust the detector itself, not the finding
  applicability_preconditions?: string[];
  detector: Detector;
  context_questions: string[];
  evidence_template?: string;
  remediation_template: string;
  data_categories?: string[];
  fingerprint_spec?: "default" | "file" | "directory" | "project" | "file+component";
  /**
   * The model layer 2 reads this rule's places on (full-read design section 1.6). Absent means
   * `sonnet`; the packer never mixes two models in one seat, and a run-wide `--seat-model` that
   * reads the rule on another model is named in the run's output with its place count.
   */
  seat_model?: SeatModel;
  provenance?: { compiled_by?: string; reviewed_by?: string };
}

/** The models a rule may name for its seats (`rule.schema.json` `seat_model`). */
export type SeatModel = "sonnet" | "opus";

export interface BundleManifest {
  bundle_version: string; // YYYY.MM.n
  created_at: string;
  packs: { pack_id: string; rules: number; jurisdiction?: string[] }[];
  files: Record<string, string>; // filename -> sha256
  engine_pins?: Record<string, string>;
  /** "unsigned" while bundles are unsigned; `null` in bundles built before 2026-10-12. */
  signature?: "unsigned" | { alg: string; sig: string; key_id: string } | null;
  changelog_url?: string;
}

export interface FindingLocation {
  file: string;
  start_line: number;
  end_line?: number;
  /**
   * The same-file definitions this location was reached THROUGH, where it was reached through any.
   *
   * Written only by the local-value reading (`detector.resolve_local_values`), and only where the
   * substitution is what made the line match. `start_line` is the USE site, whose text does not
   * contain the value the rule matched; this names the DEFINITION site, so a reader can check the
   * reading without searching the file. Absent everywhere else, including on every location a rule
   * matched directly.
   */
  resolved_from?: ResolvedValue[];
  /**
   * The OTHER FILE whose text opened this candidate's corroboration gate.
   *
   * Written only where the rule declared a wider `detector.gate_scope` and the gate was shut on this
   * file's own text — so the candidate exists because a fact the rule requires is written somewhere
   * else in the scope. Absent everywhere else, including on every candidate whose own file carried
   * the corroboration.
   *
   * It exists for the reason `resolved_from` does: a reader who cannot see the corroboration cannot
   * check the reading, and a candidate nobody can check is worse than one that was never raised.
   * What it does NOT establish is that the two files belong to the same code path — see
   * `CorroboratedFrom.scope`.
   */
  corroborated_from?: CorroboratedFrom;
  /**
   * THE PROJECT-WIDE FACT LAYER 1 COMPUTED FOR THIS LOCATION'S CLAUSE — `true` when the vocabulary
   * the rule's `also_in_file` names appears somewhere in the scanned tree, `false` when the whole
   * scope carried none of it.
   *
   * Written only on locations whose clauses `detector.gate_applies_to` names, and only for a rule in
   * `gate_mode: "annotate"` — so it is absent from every location of every rule that does not
   * declare the subject. IT REMOVES NOTHING: both values are written, no candidate is deleted and no
   * repository falls silent because of it. `false` is the strong reading — the tree names nothing
   * the rule's own purpose-built vocabulary would recognise — and it is handed to the adjudicating
   * agent as a premise to decide with, never as a verdict (product/plugin/agents/legal-adjudicator.md).
   *
   * It is deliberately NOT one of the fields that make a location its own kind in the census: at
   * project scope the answer is one fact about the whole scan, identical on every location that
   * carries it, and the fired clause set is already in the census key — so it cannot split a bin and
   * a representative cannot carry an annotation its bin-mates lack (kind-census.ts).
   */
  corroborated_in_project?: boolean;
  /**
   * WHERE THE PROJECT-WIDE CORROBORATION WAS FOUND — written only beside
   * `corroborated_in_project: true`, and absent when it is `false`, because a fact that was not
   * found has no line to name.
   *
   * The same shape and the same contract as `corroborated_from`: a reader opens the named file at
   * the named line and checks the reading. It is a different field because it means a different
   * thing — `corroborated_from` says a gate that would otherwise have DELETED this candidate was
   * opened by that file, and this says nothing was gated at all.
   */
  corroborated_in_project_from?: CorroboratedFrom;
  /**
   * The fingerprint of this location's line text (cli place-key.ts
   * `lineKeyOf`, which says exactly what it covers): a place's identity across runs is its file and this. Absent on a
   * document written before it.
   */
  line_key?: string;
  /**
   * The span of THIS FILE the text that matched was folded from.
   *
   * Written only by the joined-construct reading (`detector.join_bracketed_constructs`), and only
   * where the fold is what made the line match. `start_line` equals this location's own
   * `start_line` — the line the construct OPENS on, which is the line the finding reports — and
   * `end_line` is the line it closes on.
   *
   * NOT OPTIONAL WHERE THE FOLD RAISED THE CANDIDATE, and for the reason `resolved_from` is not:
   * the reported line's own text does not carry what the rule matched. A cookie literal is reported
   * at `http.SetCookie(writer, &http.Cookie{`, and the attributes it does not set are absent four
   * lines below that. A reader handed the opening line alone is reading half a sentence, and a
   * candidate nobody can check is worse than one that was never raised.
   */
  joined_from?: JoinedFrom;
  /**
   * The opening lines of the ENCLOSING constructs that were collapsed into this location, ascending.
   *
   * A construct written inside another is folded at each opening line, so one cookie literal inside
   * a closure inside a function used to arrive as three candidates. From 2026-09-07 the enclosing
   * one is not reported when EVERY `match` clause it fired is also fired by reports lying inside its
   * own fold span — the same rule, the same file, the same clauses — and its opening line is
   * recorded here, on the FIRST surviving report, in file order, that lies inside it — one pointer
   * per removal, so the entries across a document can be counted.
   *
   * IT IS A POINTER, NOT A SECOND LOCATION. The construct that opens here is still in the file and
   * the reader can open it; what is no longer reported is a second candidate carrying nothing this
   * one does not already carry. An enclosing candidate that fires a clause NOTHING inside it fires
   * is reported exactly as before and appears in nobody's `also_opens_at`.
   *
   * ON THE LOCATION AND NOT INSIDE `joined_from`, because the report that absorbs an enclosing fold
   * is frequently not fold-derived at all — an ordinary matched line inside the span — and such a
   * location has no `joined_from`. Absent everywhere else, which is every location of every rule
   * that does not declare `detector.join_bracketed_constructs`. Every entry across a whole document
   * stands for exactly one removed candidate, so their total is
   * `stats.joined_outer_duplicates_dropped`.
   */
  also_opens_at?: number[];
  /**
   * WHICH OF THE RULE'S `match` CLAUSES READ THIS LINE — 1-based and ascending, comma-joined
   * (`"16"`, `"1,3"`), which is the numbering a rule author uses when they write "clause (13)".
   *
   * Present on every location of a document written with the kind census on (`--kind-census on`,
   * the default) and on none of a document written with it off. With the three fields below it, it
   * is the key the scanner groups a large candidate's locations by (`kinds`), written onto the
   * location so that a reader of this document can re-derive every group with no model and no
   * second scan.
   *
   * **Where no clause can be named it carries the READING instead**, prefixed so the two can never
   * be confused: `structural:structural_span` (a candidate the parse-tree reading raised),
   * `raw:clauses_split_raw_vs_comment_blanked[raw 3 / blanked 7]` (one clause fired on the line as
   * written and another on its comment-blanked view, with none on both — `matchFires` is two
   * `some`s and can produce this), `unattributed:no_clause_fires_on_this_line`. One line of the
   * 1,139,261 in the recorded corpus population is the split case.
   */
  clause?: string;
  /**
   * WHAT THE CLAUSES MATCHED, folded: edges trimmed of punctuation, case folded, `_` and `-`
   * dropped; several spans deduplicated, sorted and joined with `+`. Where no clause could be
   * named it is the whole line folded one level coarser and cut at 120 characters.
   *
   * It is the matched span AS THE CLAUSE MATCHED IT and is never widened to the surrounding token:
   * widening pulls a whole URL, hash and all, into the key and turns one group into thousands.
   */
  matched_token?: string;
  /**
   * THE SYNTACTIC POSITION the match sits in — one of seventeen: `comment`, `prose-doc`,
   * `translation-entry`, `manifest-entry`, `lockfile-entry`, `config-entry`, `sql`,
   * `css-declaration`, `import-specifier`, `html-attribute`, `string-literal`, `declaration`,
   * `call`, `object-key-or-param`, `member-access`, `identifier-use`, `other`.
   *
   * It is what keeps a locale catalogue from crowding the one migration out of what a seat reads:
   * the existence-class reading order puts code shapes first and prose and catalogues last.
   */
  context_class?: string;
  /**
   * THE LINE ITSELF, folded outside the matched spans, as a 16-hex digest — how alike two members
   * of one group really are.
   *
   * Everything outside the match is normalised (string interiors emptied, digit runs to `0`, case
   * and inner separators folded, whitespace collapsed) and the match is kept byte for byte, so two
   * locations with the same digest are the same line up to that normalisation. Three of a large Node CMS's
   * twenty largest groups merge constructs an adjudicator has to see separately, and the sub-shape
   * is what says so before anyone reads them.
   */
  sub_shape?: string;
}

/**
 * ONE SAME-KIND LINE GROUP of one candidate — what layer 2 reads one representative of.
 *
 * See `KindCensus` below for what the catalogue is for and what it may not do.
 */
export interface KindGroup {
  /**
   * The rule id, the fired clause set, the folded token and the context class, joined by NUL.
   *
   * NOT UNIQUE in `groups[]`: a location whose evidence is not the line it names is its own group
   * (`own_evidence`), so one key can carry an ordinary group beside several single-member ones. A
   * group is identified by its INDEX in `groups[]`.
   */
  key: string;
  /**
   * This group holds exactly one location, because that location's evidence is not its own line — a
   * value hop, a fold, an absorbed enclosing construct, a multi-line span, or a corroboration from
   * another file. Absent on every ordinary group. What makes such a location a candidate is not on
   * any representative's line, so no representative can be read for it.
   */
  own_evidence?: true;
  /** The `clause` of every member — they are equal by construction. */
  clause: string;
  /** The `matched_token` of every member. */
  matched_token: string;
  /** The `context_class` of every member. */
  context_class: string;
  member_count: number;
  /**
   * The members' indices into this candidate's own `locations[]`, ascending.
   *
   * THE CANDIDATE'S LOCATIONS ARE IN PATH-THEN-LINE ORDER wherever a census exists — the order the
   * split used before the census replaced it — so an index is a stable name for a location and
   * `members[0]` is the first member in that order.
   */
  members: number[];
  /**
   * The member a seat opens: the FIRST in path-then-line order. Never "the most typical", which is
   * a judgement and has no place in a scanner's output.
   */
  representative: { index: number; file: string; start_line: number };
  /** Distinct files the members sit in. */
  files: number;
  /** Distinct first-three-segment directories the members sit in. */
  directories: number;
  /** How many distinct `sub_shape`s the members fall into — the true total, listed or not. */
  sub_shape_count: number;
  /**
   * The largest of them, with how many members each holds and the index of its first member.
   *
   * Cut at `KindCensus.sub_shapes_listed_per_kind`, which is stated on the census rather than left
   * to be inferred; the ones not listed are the smallest. Listing every sub-shape would put one row
   * per location back into the document, which is the cost the census exists to remove.
   */
  sub_shapes: { sub_shape: string; members: number; first: number }[];
}

/**
 * THE CATALOGUE of a candidate that carries more locations than one seat reads.
 *
 * Present exactly on the candidates that used to be cut into parts of
 * `MAX_LOCATIONS_PER_CANDIDATE` — and where it is present, `group_part` is absent, because the
 * question is no longer divided. A document written with `--kind-census off` carries `group_part`
 * and no census, which is the document this scanner wrote before the census existed, byte for byte.
 *
 * **Nothing here removes a location.** `locations[]` is complete and the census points into it by
 * index: every location is in exactly one group, and a group is read or declared not read
 * (`reading_plan`). A narrowing hidden in packaging is the one thing this may not do.
 */
export interface KindCensus {
  /** The shape of this object. `kind-census-1` is the first. */
  spec: string;
  /** The clustering level the key is taken at. `L2` is rule + clause set + token + context class. */
  level: "L2";
  /** The location count above which a candidate gets a census at all. */
  bound: number;
  /** How many groups there are to read — `groups.length`, the `own_evidence` singletons included. */
  kinds_total: number;
  /**
   * How many DISTINCT KEYS the locations fall into.
   *
   * It is the number the corpus-wide measurement of 2026-09-17 counted at this key, and it is
   * written beside `kinds_total` rather than instead of it so that the measured number and the
   * reading number are two statements and nobody has to subtract to get either. It is never above
   * `kinds_total`: the own-evidence rule only ever splits a group.
   */
  kinds_at_key: number;
  /** This candidate's own location count — the sum of every group's `member_count`. */
  locations_total: number;
  /** The cut on `KindGroup.sub_shapes`, stated rather than silent. */
  sub_shapes_listed_per_kind: number;
  groups: KindGroup[];
}

/**
 * How a rule's findings are read: one question for the installation (`existence`), a list to be
 * enumerated to the end (`enumeration`), one possible violation per line (`per-location`), or a
 * mixture of those limbs (`mixed`).
 */
export type ReadingClass = "existence" | "enumeration" | "per-location" | "mixed";

/** One reader's consecutive slice of the reading order, both ends inclusive, in units. */
export interface ReaderSlice {
  reader: number;
  from: number;
  to: number;
  /**
   * A place seat holding ONE place whose payload alone is over the byte bound (full-read design 1.2, review R15; build
   * unit F2): the place is never cut, its seat is its own, and the plan records it.
   */
  oversized?: true;
  /**
   * A summary seat (full-read design section 2; build unit F6): the slice holds exactly the places the data summary with
   * this id covers, and its payload holds that summary and no row or window for them.
   */
  summary?: string;
}

/**
 * WHAT ONE SEAT READS, IN WHICH ORDER, AND WHAT IS DECLARED NOT READ — written beside the census.
 *
 * The plan is a pure function of this document: a consumer can count the agents a run will spend
 * before dispatching any of them, and can say, per large candidate, how many groups the seat will
 * not open.
 */
export interface ReadingPlan {
  /** The shape of this object. `reading-plan-1` is the first. */
  spec: string;
  reading_class: ReadingClass;
  /**
   * Where the class came from: `rule` (the compiled rule declares `reading_class`) or
   * `default-per-location` (it declares none and the candidate is read line by line, which can only
   * read more than a class would, never less). The scanner's embedded copy of annex §4.2 was deleted
   * when the 55 rules gained the field, and `design-table-4.2` went with it.
   */
  class_source: "rule" | "default-per-location";
  /** `kind` for the existence, enumeration and mixed classes; `location` for the per-location one. */
  /** `place` for every plan written since the full-read form (`reading-plan-2`); `kind` and `location` are `reading-plan-1` units, which keep parsing. */
  unit: "kind" | "location" | "place";
  /** What ONE seat reads — `MAX_LOCATIONS_PER_ADJUDICATION`. It bounds reading and nothing else. */
  cap: number;
  /**
   * The reading order: indices into `kinds.groups`, or into `locations` where the unit is the
   * location. A TOTAL ordering of every unit — what no seat reaches is declared not read, never
   * omitted from the plan.
   *
   * For the existence class the order is by context class (code shapes first, prose and catalogues
   * last) and then by member count descending, so that the seat's 70 are the ones a question about
   * the installation turns on.
   */
  order: number[];
  /** The verdict seat's own slice, `order[0 .. read_by_seat - 1]`. `0` where readers read it all. */
  read_by_seat: number;
  /** One entry per reader child, each a consecutive slice of `order`. */
  reader_slices: ReaderSlice[];
  /**
   * The slack rule applied: an existence-class candidate of at most twice the cap gets ONE reader
   * for the remainder, so that nothing is left unread for the sake of a few groups.
   */
  /** `reading-plan-1` only (the retired slack rule); a `reading-plan-2` plan omits it. */
  slack_rule?: boolean;
  /**
   * The units no seat opens, with the reason — the existence-class tail, and nothing else.
   *
   * ABSENT where every unit is read, which is the ordinary case: the field is written only where
   * there is a tail, so that its own constraints are probed the day one exists instead of sitting
   * beside a `null` no value can violate (a check, the constraint probe).
   *
   * `repository_answer`: the verdict rests on the premise established from the groups that WERE
   * read, on the recorded repository-wide search for the duty's elements, and on this catalogue.
   * The cap binds in one direction only: such a verdict may be `violation_candidate` or
   * `needs_human` naming the number not read, and never `not_applicable` — a dismissal is a claim
   * about every group.
   */
  not_read?: { from: number; to: number; units: number; reason: "repository_answer" };
}

/**
 * The span of one file that a joined-construct fold covered — the whole bracketed construct that
 * opens on `start_line` and closes on `end_line`, both 1-based as `start_line` is.
 *
 * `end_line` is always greater than `start_line`: a construct that opens and closes on one physical
 * line is not folded at all, because there is nothing for the fold to join.
 */
export interface JoinedFrom {
  start_line: number;
  end_line: number;
}

/**
 * The corroborating file and line a wider `detector.gate_scope` opened a gate on. The line is named
 * and never quoted: its `line_text` was removed on 2026-09-23, when the findings document stopped
 * carrying raw source text; a reader opens `file` at `line` in their own tree.
 *
 * ONE per location and not a list: the gate is a disjunction that stops at the first clause that
 * matches, so there is exactly one file the engine can name — the first one in walk order whose own
 * comment-blanked text satisfied a clause. It is evidence that the fact is present in the scope,
 * never a claim that this is the only place it is present.
 */
export interface CorroboratedFrom {
  /** Path relative to the scan target, as the walker produces it. A DIFFERENT file from `file`. */
  file: string;
  /**
   * The line of that file the clause's match STARTS on, 1-indexed as `start_line` is, and never 0.
   *
   * A clause is tested against the whole file text, so it may match across a line break; this is the
   * line the match's first character is on, which is where a reader has to start reading. Until
   * 2026-09-06 the engine looked for the first single line the clause matched on its own and wrote
   * `0` with the text `(matched across lines)` when there was none, which was half the records the
   * first rule opt-in produced. `suppressed_by_guard.guardLine` still carries the older reading and
   * this field no longer shares it.
   */
  line: number;
  /**
   * The scope the rule declared, so a reader knows how far the engine was allowed to look before it
   * found this file: `"directory"` means the same immediate parent as the candidate's file,
   * `"project"` means anywhere in the scan. `"file"` never appears here — at file scope there is no
   * other file to name.
   */
  scope: GateScope;
}

/**
 * One name a location was resolved through, with the same-file line that defined it. The line is
 * named and never quoted: `definition_text` was removed on 2026-09-23, when the findings document
 * stopped carrying raw source text; a reader opens `definition_line` in the location's `file`.
 */
export interface ResolvedValue {
  /** The name as the definition wrote it, sigil included (`HOST`, `$host`, `@endpoint`). */
  name: string;
  /** The definition's line, 1-indexed, as `start_line` is. */
  definition_line: number;
}

/**
 * A candidate is a detector hit, not a conclusion. Nothing here asserts that
 * anything is unlawful; adjudication happens downstream and produces a Verdict.
 */
export interface Candidate {
  finding_id: string; // fp_<16 hex chars>, stable across scans
  rule_id: string;
  title?: string;
  severity: Severity;
  rule_confidence: number;
  locations: FindingLocation[];
  dataflow?: object[];
  context_questions: string[];
  /**
   * The `applicability_preconditions` of this candidate's rule that name a ScanProfile field the
   * profile does not answer. Present only when non-empty.
   *
   * **This candidate was raised on an open premise, and the reader has to be told so.** Before
   * 2026-08-25 an unanswered precondition removed the rule from the scan altogether, so no such
   * candidate existed; the rule now runs (engine.ts `preconditionStatus`) and the ruling
   * is that its candidates reach layer 2 carrying the open question. It is a question to
   * put to the person, never a fact to infer from the code, and it is not a reason to drop,
   * downgrade or defer the candidate.
   */
  unanswered_preconditions?: string[];
  /**
   * The `applicability_preconditions` of this candidate's rule that the profile ANSWERED in a way
   * that puts the rule out of scope. Present only when non-empty.
   *
   * **The person declared this rule's subject out of scope, and lines in this tree matched the
   * rule's patterns anyway.** Read it as a disagreement to put back to them, never as a reason to
   * drop, downgrade or defer the candidate, and never as something to resolve from the code: a fact
   * about the product is asked of the person.
   *
   * **Not "the detector found the construct", which is what this said until 2026-08-27, and not a
   * two-way choice between a wrong answer and a wrong candidate.** Whether a matched line is on the
   * rule's subject is the question layer 2 exists to answer, and the rule's own `evidence_template`
   * beside this field is frequently explicit that the match does not establish it. And the project's
   * own harvest classes 8 of its 21 recorded cases as ones where the declared answer is right AND the
   * candidate is legitimate — an answer about the shipped product beside a line in tooling, a test
   * fixture or a dependency, or a rule whose construct is wider than the question the person
   * answered. Both sides standing at once is the common case, not the exception.
   *
   * Before 2026-08-27 the answer removed the rule from the scan, so no such candidate existed and
   * the document reported `state: not-evaluated`. Measured over the eight pass-1 runs of 2026-08-26,
   * that accounted for 21 of the 69 located misses.
   *
   * **A sibling of `unanswered_preconditions`, never the same field**: that one says *nobody
   * answered*, this one says *somebody answered no and the scanner found something anyway*. A
   * candidate can carry both.
   */
  declared_inapplicable_preconditions?: string[];
  legal_basis_refs?: string[];
  /**
   * The date the obligation behind this candidate starts to apply, copied verbatim from
   * `Rule.effective_date`. Declared by 49 of the 56 rules and, until 2026-08-13, copied into no
   * output at all: the field was parsed, validated and shipped inside `rules.json`, and every
   * reader who needed the date had to take it from prose. `eu-cra-001` and `eu-cra-002` carry
   * `from 2027-12-11` inside their `title` for exactly that reason, which is the workaround and
   * not the fix.
   *
   * **It says when the duty starts, and nothing else.** It is not a filter: a rule whose date is in
   * the future still fires, and its findings are still worded as preparation. Whether that should
   * change is a product decision for the owner and is not encoded here.
   */
  effective_date?: string;
  /**
   * The kinds of personal data the rule's author says the matched construct involves, copied from
   * `Rule.data_categories`. Declared by 53 of the 56 rules and, until 2026-08-13, copied into no
   * output at all — the same defect class as `effective_date` above, at nearly the same scale.
   *
   * **The author's own labels, not a validated taxonomy.** `rule.schema.json` calls them fideslang
   * keys and constrains their shape but never their membership: no enum, no registry file, and the
   * rule base records several of them as unverified house extensions. A census on 2026-08-13 found
   * 33 distinct values over 99 entries with three unreconciled splits — `user.behavior` /
   * `user.behaviour`, `user.credentials` / `user.authorization.credentials`, `user.date_of_birth` /
   * `user.demographic.date_of_birth` — so a consumer may group or display these strings but must
   * never read a difference in spelling as a difference in meaning.
   *
   * **It says what kind of data the rule is about, and nothing else.** It is not a filter and not a
   * finding: nothing here asserts that the scanned repository holds any of the named categories.
   *
   * Three states, three statements: a populated list names categories; `[]` says the author
   * considered the question and named none (8 rules); absent says the rule states nothing
   * (`eu-cra-001`, `eu-cra-002`, `eu-data-act-001`).
   */
  data_categories?: string[];
  /**
   * The rule's own account of what a match establishes and what it does not, copied verbatim from
   * `Rule.evidence_template` — `{file}` and `{line}` placeholders included, standing for the first
   * entry of `locations`. Several rules use this field as the only place a known limit of their
   * detection is disclosed (eu-retention-001's cited line may be a setting's name rather than the
   * line that bound; eu-consent-021 and eu-consent-017 state what a candidate is not a finding of),
   * and until 2026-08-11 nothing copied it out of the bundle, so no reader ever saw it.
   */
  evidence_template?: string;
  remediation_template?: string;
  suppressed_by?: string | null;
  /**
   * Applicability verdicts this candidate's own citations turn on. Annotation only: a verdict
   * never removes, suppresses or downgrades a candidate. Attached per citation rather than per
   * candidate because the baseline rules are deliberately dual-cited to CRA and to GDPR Art 32,
   * and the coverage map's instruction is that "the CRA scope gate never silences the GDPR basis".
   */
  depends_on_applicability?: { checklist_id: string; verdict: string; because: string }[];
  /**
   * THE SAME-KIND LINE GROUPS of a candidate that carries more locations than one seat reads.
   *
   * Present exactly where `group_part` used to be, and never beside it: with the kind census on
   * (`--kind-census on`, the default) such a candidate is written WHOLE, with this catalogue; with
   * it off the candidate is cut into parts and carries no census.
   *
   * **It is one question with one `finding_id`, one verdict and one refutation.** The catalogue says
   * what is in it; `reading_plan` beside it says what a seat reads of it.
   */
  kinds?: KindCensus;
  /**
   * WHAT ONE SEAT READS of this candidate, in which order, and what is declared not read. Present
   * exactly where `kinds` is.
   */
  reading_plan?: ReadingPlan;
  /**
   * Present only on a candidate that is one PART of a group the engine split because it carried
   * more locations than one agent can be expected to read — `MAX_LOCATIONS_PER_CANDIDATE` in
   * `scan.ts`. Absent means this candidate is a whole group, which is the ordinary case: 95 % of
   * real candidates carry 70 locations or fewer.
   *
   * **ABSENT BY DEFAULT from the date the kind census shipped**, and present only on a document
   * written with `--kind-census off`: a candidate above the bound now carries `kinds` instead, and
   * the two never appear together.
   *
   * **The parts are one question, not several findings.** They share a rule, a title, a citation
   * set and a `group_id`; they were one candidate before the bound existed and they cover exactly
   * the locations that candidate covered, in path-then-line order, with none dropped, added or
   * repeated. A consumer that counts findings should count groups; one that reads locations should
   * read every part.
   */
  group_part?: {
    /** 1-indexed position of this part in its group. */
    part: number;
    /** How many parts the group was emitted as. Always at least 2 — a group of one is not split. */
    of: number;
    /**
     * `finding_id` of the group as a whole: the fingerprint the single oversized candidate carried
     * before the split, and the key that ties the parts together. No candidate in the document
     * carries it as its own `finding_id` — every part's id is derived from it and its part number,
     * so a suppression or a verdict stored against the group matches no part and the group comes
     * back to be looked at rather than being half-silenced.
     */
    group_id: string;
    /** Locations in the whole group, across all parts. This part carries a slice of them. */
    locations_in_group: number;
  };
  /**
   * Which adjudication payload this candidate belongs to. **Present on every candidate**, so an
   * orchestrator has one instruction — group by `key`, one key to one fresh agent — and no fallback
   * rule of its own that could drift from the scanner's.
   *
   * `product/plugin/skills/legal-scan/SKILL.md` step 4 hands one group to one agent, and the group,
   * not the candidate, is what that agent must read in full. The scanner therefore computes the
   * grouping and bounds it: no `key` in a document carries more than
   * `MAX_LOCATIONS_PER_ADJUDICATION` locations. The key is the file of the candidate's first
   * location, unchanged from what a tool has always used; where that file's
   * candidates carry more than the bound between them, they are divided into BATCHES.
   *
   * **Where the scan PACKED its payloads** (the default since 2026-09-17; `--pack-groups off` turns
   * it back off), the key is a BIN instead — whole candidates merged rule by rule up to the same
   * location bound and at most `MAX_RULES_PER_ADJUDICATION_BIN` rules, so that a run spends one
   * agent on several small questions rather than one agent on each. `bin`, `rules_in_bin`,
   * `candidates_in_bin` and `locations_in_bin` describe it, the file-group fields go on saying what
   * they said, and the instruction is the one it always was: group by `key`.
   *
   * **Do not confuse this with `group_part`.** `group_part` divides one candidate that was too big;
   * this divides one file's group of candidates that were too many. A candidate can carry both, and
   * counting either as a finding double-counts.
   */
  adjudication_group?: {
    /** The payload: every candidate sharing this string goes to one agent, and only to that one. */
    key: string;
    /** The file the group is named for — the file of this candidate's first location. */
    file: string;
    /** 1-indexed batch of that file's group. */
    batch: number;
    /** How many batches the file's group needed. 1 means it was not divided. */
    batches: number;
    /**
     * Locations in THIS batch of this file's group, across every candidate in it. Never above the
     * bound. **It is the payload only where `bin` is absent** — a packed document's payload is the
     * bin, and `locations_in_bin` is what one agent is being asked to read.
     */
    locations_in_batch: number;
    /**
     * READING UNITS in this batch — what the bound is in once a candidate may be read by same-kind
     * line groups: kinds where the candidate carries a `kinds` census, locations where it does not.
     * Written only where a candidate of this batch carries one, so a `--kind-census off` document
     * carries none of them.
     */
    reading_units_in_batch?: number;
    /** Locations across every batch of this file's group — how big the file's whole group is. */
    locations_in_file_group: number;
    /**
     * 1-indexed bin this candidate was packed into, present on every candidate of a packed document
     * and on none of an unpacked one (`--pack-groups off`, `PRODUCT_CLI_PACK_GROUPS=0`).
     *
     * The five fields above still describe the file group this candidate belongs to; the bin is what
     * one agent receives. `key` names it, and where `bin` is present every key in the document is a
     * bin key.
     *
     * **Neither this number nor `key` is an identity across runs.** Bins are numbered per document in
     * packing order, so one candidate more or fewer renumbers every bin after it. Anything meant to
     * survive a re-scan — a stored verdict, a suppression, a carried-forward premise — is keyed on
     * `finding_id`.
     */
    bin?: number;
    /** The rule ids sharing this bin, sorted. At most `MAX_RULES_PER_ADJUDICATION_BIN` of them. */
    rules_in_bin?: string[];
    /** How many candidates are in this bin — how many the agent handed it must answer for. */
    candidates_in_bin?: number;
    /**
     * Locations in this bin, across every candidate in it. **Never above the bound in READING
     * UNITS** — which for a bin holding a candidate with a `kinds` census counts that candidate's
     * kinds, so this field may exceed 70 by the members those kinds stand for.
     */
    locations_in_bin?: number;
    /**
     * The one model every seat of this bin reads on: the rules' own `seat_model` (`sonnet` where absent). The packer
     * never mixes two models in one bin (full-read design 1.4, 1.6). Written on every packed marker.
     */
    seat_model?: SeatModel;
    /**
     * HOW MANY READING UNITS THIS CANDIDATE IS — the unit the bound is counted in from the date the
     * kind census shipped.
     *
     * Its groups where it has a census and its locations where it has none; the reading class
     * decides which (`reading_plan.unit`). Present on every candidate of a document written with the
     * census on. A candidate of 54,770 locations in 37 groups is 37 reading units and packs like any
     * other; a candidate of 202 groups is its own payload with readers beside it.
     */
    reading_units?: number;
    /**
     * How many READER children this candidate takes, beside its one verdict seat. Present only where
     * there are any.
     *
     * It equals `reading_plan.reader_slices.length` — the same fact, in the place an orchestrator
     * looks — and `test:kind-census` asserts the identity rather than trusting it, exactly as
     * `corroboration_suppressed.matches` is asserted against its own array.
     */
    readers?: number;
    /**
     * Reading units in this bin — what one agent is asked to read, and the number the bound is in.
     * Written only where a candidate of this bin carries a `kinds` census.
     */
    reading_units_in_bin?: number;
    /**
     * THE SIZE OF THIS CANDIDATE'S OWN PAYLOAD FILE, in bytes, written only where that file is over
     * the payload byte cap and holds this candidate alone.
     *
     * A payload holding more than one candidate is divided until it is under the cap; a candidate
     * whose payload alone is over it is written WHOLE, because a candidate is one seat and a seat
     * handed part of its evidence answers about part of its evidence. This field and `oversized`
     * are what the run states instead of shortening it.
     */
    payload_bytes?: number;
    /** True exactly where `payload_bytes` is written: this candidate's payload is over the cap. */
    oversized?: true;
  };
}

/**
 * ONE WAY THIS SCAN FELL SHORT OF READING EVERYTHING, with its count and what would lift it.
 *
 * The five members and the reasoning behind the model are in
 * `product/packages/cli/src/read-scope.ts`. What matters at the contract is that `sentence` is the
 * ONE wording: the console block, the SARIF `note` results and the layer-2 report all print this
 * string and none of them composes its own. A member is emitted whatever its counts say — zero
 * included — because "nothing was held back" and "this scanner does not check" are different facts
 * and an absent line cannot tell them apart.
 */
export interface CoverageLimit {
  /**
   * `read-scope:<class>`, `refused-by-rule`, `not-readable-as-code`, `rules-not-run` or
   * `rules-silent`. Stable: the SARIF alert's identity across commits is derived from it.
   */
  id: string;
  /** The counts this member states, each in its own unit. Never added across members. */
  counts: Record<string, number>;
  /** The one sentence, in model order. Every renderer prints exactly this. */
  sentence: string;
  /** The option that lifts this limit, or `null` where nothing does today. */
  lift: string | null;
  /** Read-scope members only: whether the run opted into this class. */
  read?: boolean;
  /** Read-scope members only: the sets of `rules/path-exclusions/` this class is composed of. */
  patterns_set?: string[];
  /** Read-scope members only: the file those sets live in, so a reader can go and read them. */
  patterns_source?: string;
  /** `rules-not-run` only, and only under `--rules`: the rules the run was narrowed to. */
  rules?: string[];
}

/**
 * WHAT THIS SCAN READ PAST — the whole of it, in one place, rendered identically by every output.
 *
 * Versioned with the findings document rather than on its own: a consumer that knows `version: 1`
 * knows the member ids above and the order they arrive in.
 */
export interface CoverageLimits {
  version: 1;
  limits: CoverageLimit[];
}

/** CLI scan output, and the input to adjudication. */
/**
 * ## The questions that are answered once per RULE, and not once per candidate
 *
 * Unit F of the layer-2 cost lane.
 * The producer, the whole of the design and the membership list the jurisdiction
 * judgement turns on are in `product/packages/cli/src/per-rule-applicability.ts`; these types
 * describe the block it writes and restate none of its reasoning.
 *
 * **Nothing here removes, downgrades or changes a candidate.** It is an ANSWER written beside the
 * findings, and the orchestrator (`legal-scan/SKILL.md` step 4) is what acts on it.
 */
/** The answers a per-rule question can carry. Every one of them but `does_not_apply` adjudicates. */
export type PerRuleAnswer =
  /** The declaration reaches this rule. Adjudicated as today. */
  | "applies"
  /** The declaration does not reach this rule. THE ONLY ANSWER THAT REMOVES A LAUNCH. */
  | "does_not_apply"
  /** Nobody answered. Adjudicated, with the open question carried into the verdict. */
  | "unanswered"
  /** A premise the person answered, in the direction the rule needs. Never removes a launch. */
  | "met"
  /** A premise the person answered the other way. A disagreement to report; never removes a launch. */
  | "declared_out_of_scope";

/** One settled question: what was asked, what the answer is, where the answer was read. */
export interface PerRuleQuestion {
  /** The question in words, as the person would be asked it. */
  question: string;
  answer: PerRuleAnswer;
  /** The profile field the answer was read from, in `ScanProfile.<path>` form. Never a code path. */
  answered_from: string;
  /** The value read, verbatim, or `null` where the field was not answered. */
  declared: unknown;
  /** One sentence quoting both sides, so a reader can overturn the answer in one line. */
  because: string;
}

/** One rule's settled answers, and what they cost or saved on this run. */
export interface PerRuleApplicabilityRow {
  rule_id: string;
  /** The rule's declared jurisdictions, copied. */
  jurisdiction: string[];
  jurisdiction_question: PerRuleQuestion;
  /** One entry per `applicability_preconditions` expression. Absent where the rule declares none. */
  premise_questions?: PerRuleQuestion[];
  /**
   * Whether this rule's candidates are to be adjudicated. `false` ONLY where
   * `jurisdiction_question.answer` is `does_not_apply`, or where a `scope` answer from the program's confirmed record
   * puts the rule out of scope (`settled_by`); no other premise answer moves it.
   */
  adjudicate: boolean;
  /** Present only where `adjudicate` is false. The words the report and the log must use. */
  not_adjudicated_as?: "not applicable by declaration";
  /**
   * Present only where a scope answer from the program's confirmed record settled this rule (`adjudicate` false, no
   * seat runs): the profile field, the answer as the record holds it (the option's label) and the time it was recorded.
   */
  settled_by?: { field: string; answer: unknown; recorded_at: string };
  /**
   * THE ONE SENTENCE THE ORCHESTRATOR HANDS TO THE SEAT, once per rule in the bin, in place of the
   * seat deriving it. A seat may cite it by name; it may not re-decide it from the code.
   */
  settled_premise: string;
  /** Candidates this rule raised on this tree. */
  candidates: number;
  /** Locations across those candidates. */
  locations: number;
  /** The adjudication-group keys this rule's candidates sit in, sorted. */
  groups: string[];
  /**
   * Launches removed BY THIS RULE'S ANSWER: the launches of the groups that vanish and in which
   * this rule takes part. **These do not sum to the run figure.** A bin holding two rules that both
   * answer `does_not_apply` vanishes once and is counted once under each of them; the distinct
   * count is `summary.launches_removed`.
   */
  launches_removed: number;
}

/** The block `findings.json` carries. */
export interface PerRuleApplicability {
  /** The field every jurisdiction answer here was read from. */
  answered_from: string;
  /** What the person declared, verbatim, or `null` where they did not. */
  declared_regions: string[] | null;
  /** The regions answered No, where the profile read carries them (open-world regions); absent otherwise. */
  regions_not_offered?: string[];
  /**
   * Whether the jurisdiction question was settled at all on this run. `false` means no profile, no
   * `distribution_regions`, an empty array, or the recorded answer `"unknown"` — and then every
   * rule is adjudicated and this block removes nothing.
   */
  settled: boolean;
  /**
   * One row per rule that raised a candidate, plus every rule that raised none and whose
   * jurisdiction does not apply — the second group is what `unknown_rules` needs to record
   * `out_of_jurisdiction` without the orchestrator re-deriving it. A rule that raised nothing and
   * applies gets no row: its roster entry already says everything, and a row would be bytes the
   * user pays to read.
   */
  rules: PerRuleApplicabilityRow[];
  summary: {
    rules_with_candidates: number;
    /** Rules with candidates whose jurisdiction does not reach the declaration. */
    rules_not_applicable: number;
    /** Rules with no candidate whose jurisdiction does not reach the declaration. */
    silent_rules_not_applicable: number;
    candidates_not_adjudicated: number;
    locations_not_adjudicated: number;
    groups_total: number;
    /** Groups every one of whose candidates belongs to a rule that does not apply. */
    groups_removed: number;
    /** Groups that still launch, holding at least one candidate of a rule that does not apply. */
    groups_reduced: number;
    /**
     * Children not launched: one verdict seat per removed group, plus the reader children the
     * removed groups carried. **Refutations are not counted** — a refutation depends on a verdict
     * that was never taken, so the figure here is a floor and the run saves at least it.
     */
    launches_removed: number;
  };
}

export interface Findings {
  scan_id: string;
  bundle: { version: string; sha256?: string; signature?: "unsigned" | "not-verified" };
  profile_digest?: string | null;
  /**
   * What the profile schema check found (W5, 2026-09-02). Emitted only where `--profile` was given,
   * because with no profile there is nothing to check. `profile_digest: null` with this absent is a
   * run that was given no profile; a digest with this absent is a document written before that date.
   *
   * The digest is taken over the profile AS READ, so it covers the downgraded fields rather than the
   * file's own bytes; `violations[].found` is where the rejected values are.
   */
  profile_validation?: ProfileValidation;
  started_at: string;
  completed_at?: string;
  target: string;
  stats?: {
    files_scanned?: number;
    files_skipped?: number;
    rules_evaluated?: number;
    rules_suppressed_by_precondition?: number;
    /**
     * Rules that RAN although one of their `applicability_preconditions` names a ScanProfile field
     * the profile does not answer. Never a subset of `rules_suppressed_by_precondition`: these are
     * rules that ran. Before 2026-08-25 an unanswered question was read as an answer of no and the
     * rule was removed, so this population sat inside the counter above and said the person had put
     * the rule out of scope when the person had said nothing.
     */
    rules_run_on_unanswered_precondition?: number;
    /**
     * Rules that RAN although the profile's own answers put them out of scope. Until 2026-08-27 this
     * population was `rules_suppressed_by_precondition` — the same rules, on the other side of the
     * change, when the answer stopped them from reading a line.
     *
     * A cost figure and never a quality figure: how many rules read the tree on a
     * premise the person denied, not how many of them were right to.
     */
    rules_run_on_declared_inapplicable_precondition?: number;
    candidates_suppressed_by_guard?: number;
    /**
     * Match LINES the corroboration gate removed, summed over `suppressed_by_corroboration` — the
     * same relationship `files_excluded_by_walker` has to `excluded_by_walker`.
     *
     * The unit word differs from `candidates_suppressed_by_guard` above deliberately: both count
     * match lines, and calling them candidates is inaccurate in both places, because a suppressed
     * line never reached the fingerprint collapse and so was never a candidate. Renaming the older
     * counter is a contract change and was not taken here.
     */
    matches_suppressed_by_corroboration?: number;
    files_excluded_by_walker?: number;
    /**
     * Files the ENGINE opened and read to no rule — the same relationship `files_excluded_by_walker`
     * has to `excluded_by_walker`, one layer further in. A subset of `files_skipped`, which also
     * carries every walker skip and therefore cannot be decomposed by a reader; `files_not_read`
     * names them.
     */
    files_not_read_by_engine?: number;
    /**
     * Files the engine READ with at least one line blanked by the minification ceiling — the count
     * of `files_partially_read`, which names every one of them and every line it lost.
     *
     * **Never added to `files_not_read_by_engine` and never to `files_skipped`.** These files were
     * scanned, so they are inside `files_scanned`; the other two count files that were not scanned
     * at all. Adding the two together produces a number that names no population — which is the
     * distinction the pair exists to keep.
     */
    files_partially_read?: number;
    /**
     * Files whose read the PER-FILE WALL-CLOCK BUDGET stopped (`--file-budget`, 60 s by default) —
     * the number of rows the two arrays beside it carry for that reason: `files_partially_read`
     * entries with a `stopped_for_time` block, plus `files_not_read` entries whose `reason` is
     * `time-budget`. Never a second tally: it is recomputable from the document that carries it.
     *
     * **WRITTEN ONLY WHEN IT IS NON-ZERO, and it is the one counter in this block that is, so the
     * reason is stated here rather than left to be inferred.** Every other counter here is written
     * on every scan, zero included, because a counter present only when something happened cannot be
     * told apart from a producer that stopped writing it. That argument does not reach this one: the
     * fact it states is already in the document without it. `files_partially_read` and
     * `files_not_read` are BOTH written on every scan, empty or not, so a reader can ask "was any
     * file cut short for time?" of an always-present array and get an answer — and a pre-budget
     * producer answers the same "no file was", because it had no budget to stop one with. What
     * writing it unconditionally WOULD cost is the property the budget was approved under
     * and the one the whole speed-up lane is gated on: a scan whose files
     * all finish inside the budget writes the document it wrote before the budget existed, byte for
     * byte. A key whose only value on such a run is 0 would end that for every tree to buy nothing.
     *
     * **RE-TAKEN AND KEPT ON 2026-09-16**, after independent verification asked for both readings of
     * the house rule. The reasoning is written out here rather than left to `gates_opened_by_scope`,
     * because that precedent differs in kind: it is written when the BUNDLE declares `gate_scope`, so
     * its presence is fixed for a given bundle and the same for every tree, while this key's presence
     * depends on the tree AND on how loaded the machine was. What decides it is the property, not the
     * precedent — byte identity of a scan that stops nothing is the standing gate of the whole
     * speed-up lane, and this key is the only thing in step 4 that would break it on every tree at
     * once. `"minimum": 1` makes the convention machine-checkable, and `test:file-budget` case (A2)
     * goes red if the key ever appears on a run that stopped nothing.
     */
    files_stopped_for_time?: number;
    /**
     * Refusals the CENSUS recorded while reading manifests — one per `package.json` that fails
     * `JSON.parse`, and one per dependency block whose value is not a name-to-version map.
     *
     * **A count of refusals, not of files**, and the block-level refusal is per block: a manifest
     * whose `devDependencies` is malformed still contributes every package its `dependencies` block
     * declares, so a non-zero count here does not mean a manifest was lost whole.
     *
     * A different population from `files_not_read_by_engine`, and the two must not be added: those
     * files were read by no RULE, these were read by every rule and refused by the DEPENDENCY
     * parse. It exists because `dependency_inventory: []` from a tree whose only manifest carries a
     * UTF-8 BOM was indistinguishable from `dependency_inventory: []` from a tree with no npm
     * manifest, while the inventory's own description told the reader that an empty inventory is a
     * statement about npm manifests. `CensusResult.manifests_not_usable` names the files.
     */
    manifests_not_usable?: number;
    /**
     * Files the engine read WHOLE and whose comments it therefore read as code, because
     * `strip-comments.ts` has no comment syntax registered for their file type (`.vm`, `.rst`,
     * `.adoc`, `.clj`, `.erl`, `.hs`, `.jsp` and every other extension `BY_EXT` does not carry).
     *
     * A count of a HOLE, not of a refusal, and it is the only counter in this block that describes
     * files that were fully read: a maintainer's note saying "we have no deletion flow" inside such
     * a file is offered to every rule as though the product executed it. The opposite direction of
     * `files_not_read` and worth the same line — a file read too generously is as invisible as a
     * file not read at all. Reported in `coverage_limits`; the fix is a row in `BY_EXT`, which is an
     * engine backlog item and not a scan-time option.
     */
    files_comment_syntax_unregistered?: number;
    /**
     * Files whose extension is registered but whose language has a comment form the registered mode
     * reads as code (strip-comments.ts COMMENT_FORMS_READ_AS_CODE); added 2026-10-12.
     */
    files_comment_form_read_as_code?: number;
    /** The same, by declared form; every declared form is a key, zero included. */
    comment_forms_read_as_code?: Record<string, number>;
    derived_views_built?: number;
    /**
     * Files where a declared derived view could not be produced and the gate fell back to the
     * file's own unexpanded text: malformed YAML, a recursive anchor, a document over the size
     * ceiling, and from 2026-09-07 **a YAML file the minification ceiling reduced** — `yaml-anchors`
     * parses the document and a blanked line changes the document it would parse, so the view is
     * refused there. Applicability is asked first, so a file this view never had an answer for is
     * `not-applicable` and is not counted here (`yamlViewApplies`). The added cause does not make
     * this counter unreadable, because `files_partially_read` names the files it can apply to.
     */
    derived_views_failed?: number;
    /**
     * (rule, file) corroboration gates that were SHUT on the file's own text and were opened by a
     * wider `detector.gate_scope` — the count of what that field did on this tree.
     *
     * ABSENT WHEN NO RULE IN THE BUNDLE DECLARES A WIDER SCOPE, and present with its true value —
     * zero included — as soon as one does. The counters above it are written on every scan because
     * any bundle can move them; this one cannot move at all for a bundle where nothing declares the field, and the
     * default-unchanged proof the mechanism ships under is that such a scan's document is identical
     * to the one written before the field existed. So its ABSENCE says "no rule in this bundle can
     * widen a gate", its `0` says "one can and none did on this tree", and the two are different
     * facts rather than a producer that stopped writing a key.
     *
     * A count of GATE DECISIONS, not of candidates: one opened gate releases every line that gate
     * held in that file, and those lines are ordinary candidates carrying `corroborated_from`.
     */
    gates_opened_by_scope?: number;
    /**
     * What the joined-construct view (`detector.join_bracketed_constructs`) did on this tree.
     *
     * ALL THREE ARE ABSENT WHEN NO RULE IN THE BUNDLE DECLARES THE FIELD, and present with their
     * true values — zero included — as soon as one does, on exactly the reasoning
     * `gates_opened_by_scope` above is written under: no bundle without a declaring rule can move
     * them, and the default-unchanged proof this view ships under is that such a scan's document is
     * the one written before the view existed.
     *
     * They count different populations and must never be added together. `joined_views_built`
     * counts FILES for which the fold produced at least one string that differs from its line;
     * `joined_views_not_applicable` counts files a declaring rule asked for and where nothing could
     * be folded at all; `joined_constructs_refused` counts CONSTRUCTS a ceiling turned down — one
     * that never closes in its file, one longer than the line ceiling, or one folding past the
     * character ceiling. Every refusal leaves its opening line to be tested exactly as it is
     * without the view, so a refusal can never remove a candidate; it is counted because a degrade
     * nobody can see is a degrade nobody audits, which is what `derived_views_failed` is for.
     */
    joined_views_built?: number;
    joined_views_not_applicable?: number;
    joined_constructs_refused?: number;
    /**
     * CANDIDATES the nested-duplicate collapse removed, written under exactly the condition the
     * three above are written under and absent for every bundle that declares the view nowhere.
     *
     * A FOURTH POPULATION — the two above it count FILES and the third counts CONSTRUCTS — and the
     * four must never be added together. A construct inside another is folded at each opening line;
     * the enclosing report is dropped when every clause it fired is also fired by reports inside its
     * own span, and this counts those drops. It is the joined view's ONE subtraction, which is why
     * it is counted at all: every other counter here sizes a widening or a degrade. Each drop is
     * also named individually — the collapsed opening line sits on the report that absorbed it, in
     * `locations[].also_opens_at` — so this number is checkable against the document that carries
     * it and is never the only trace.
     */
    joined_outer_duplicates_dropped?: number;
    /**
     * What the structural (parse-tree) reading did on this tree. The first five count FILES and say
     * what it could and could not read — different answers that must never be added together. The
     * last four count FINDINGS and are what it cost. The unit is stated on each because one counter
     * carried both until 2026-08-11 and no reader could tell how many files had failed.
     * All zero on a bundle where no rule declares `structural_checks`.
     */
    structural_trees_built?: number;
    structural_no_adapter?: number;
    structural_grammar_unavailable?: number;
    structural_parse_failed?: number;
    structural_skipped_too_large?: number;
    /**
     * Files the structural reading refused because the minification ceiling had blanked a line in
     * them. A parse tree of text with an emptied line is a tree of a document that does not exist,
     * so the file is read by the line patterns only — which is what every one of these files got
     * before 2026-09-07, when the whole file was refused to every rule alike. Counted apart from
     * `structural_skipped_too_large` because "there is too much of it" and "this is not the
     * document" are different refusals; `files_partially_read` names the files.
     */
    structural_skipped_partial_source?: number;
    structural_findings_out_of_range?: number;
    structural_candidates_added?: number;
    structural_candidates_duplicate?: number;
    structural_candidates_dropped_by_match_without?: number;
  };
  candidates: Candidate[];
  /**
   * Every rule the bundle shipped that produced **no** candidate on this tree, with what it was
   * looking for. See `RuleWithoutCandidates`.
   */
  rules_without_candidates?: RuleWithoutCandidates[];
  /**
   * One file this scan actually read, recorded so that an output format which demands a location on
   * every result has one that exists.
   *
   * **Not a finding, and not a fact about that file.** It exists because of a collision between two
   * things this product does not control. SARIF 2.1.0 §3.27.12 permits a result with no location and
   * its own EXAMPLE 1 is precisely our case — a result about something the analysis did *not* find
   * cannot be tied to a line — while GitHub's code-scanning ingestion rejects the entire uploaded
   * file if any result has none (`locationFromSarifResult: expected at least one location`). So the
   * one result that says how much of this scan established nothing has to point somewhere, and the
   * only honest somewhere is a file the scan really opened. `sarif.ts` says so in the result's own
   * message.
   *
   * The smallest path the walker offered, **compared by code unit rather than by locale**, so it is
   * the same file on every machine for the same tree rather than whatever the filesystem enumerated
   * first — see `scan.ts`, where the first draft used `localeCompare` and did not have that
   * property. Absent when the scan read no file at all.
   */
  scan_anchor?: { file: string };
  /**
   * Whether each instrument reaches this project at all, above the findings and never among them.
   * Coverage-map row C29 states why in terms: this is "an applicability signal, not a finding",
   * and reporting it as a finding puts a violation candidate on every password manager on GitHub.
   */
  applicability?: ScopeAssessmentRecord[];
  /** Gates the bundle ships that carry no `limbs` yet — named, so partial cover is not silence. */
  applicability_not_assessed?: string[];
  /**
   * The per-rule questions this run settled from the person's own declaration, so that no
   * adjudication seat re-derives them: which rules the declared `distribution_regions` reach, what
   * the profile answered to the premises a rule declares, and the launches the answers remove.
   *
   * **It removes nothing.** `candidates` and `rules_without_candidates` are what they were before
   * this key existed, and a rule answered `does_not_apply` is REPORTED as not applicable by
   * declaration, never dropped (the owner's asymmetry rule). A missing answer adjudicates.
   */
  per_rule_applicability?: PerRuleApplicability;
  /**
   * What the walker refused to open, aggregated by reason and directory.
   *
   * The same remedy as `suppressed_by_guard`, applied one layer earlier: a file the walker never
   * opens can never reach the adjudicating agent, so an exclusion that is wrong is invisible. The
   * non-production exclusion is the larger form of the problem — one hidden setting deciding the
   * scanning surface of all 42 rules at once — and `detector.file_globs` is what replaces it.
   */
  excluded_by_walker?: WalkerExclusion[];
  /**
   * WHAT THIS SCAN READ PAST, and what would open it — the one model every output renders.
   *
   * It is a READING of the fields around it (`excluded_by_walker`, `files_not_read`,
   * `files_partially_read`, `stats.*`, `rules_without_candidates`) and never a second tally: every
   * number here can be recomputed from the document that carries it. It exists as a field rather
   * than as four renderers each doing that reading because four readings drift, and because a SARIF
   * consumer and an adjudicating agent must be told the same sentence about the same tree.
   *
   * Emitted on every scan, with every member present whatever its counts say. Absent only from a
   * document written before 2026-09-10.
   */
  coverage_limits?: CoverageLimits;
  /**
   * Every file the engine opened and handed to no rule, named, with the reason.
   *
   * The third of this document's three refusal channels and the last one that was silent:
   * `excluded_by_walker` says what was never opened, this says what was opened and then set aside,
   * and `suppressed_by_guard` / `suppressed_by_corroboration` say what matched and was then removed.
   * Until 2026-08-25 the middle one was one integer folded into `stats.files_skipped`, so a file the
   * minification proxy misjudged produced the same output as a file that was read and held nothing.
   * Present even when empty: an absent key would be indistinguishable from a scanner that does not
   * record. See `NotReadFile`.
   */
  files_not_read?: NotReadFile[];
  /**
   * Every file the engine read with at least one line blanked by the minification ceiling, named,
   * with each blanked line and its length. Emitted even when empty, like `files_not_read`, and for
   * the same reason: "every file was read whole" is a statement about this scan, and an absent key
   * would be indistinguishable from a scanner that does not record. See `PartiallyReadFile`.
   */
  files_partially_read?: PartiallyReadFile[];
  /**
   * Candidates a `guard_missing` pattern removed before adjudication, with the guard that removed
   * them. A suppressed candidate never reaches the adjudicating agent, so a guard that is wrong is
   * otherwise invisible — adversarial review found one rule silenced on 81% of real repositories
   * by country-flag image paths and emoji category names, with no trace in any output. Guards stay;
   * silent guards do not.
   */
  suppressed_by_guard?: SuppressedCandidate[];
  /**
   * Every `detector.also_in_file` gate that shut on a file whose lines the rule's `match` patterns
   * did hit — one entry per (rule, file), which is the unit the gate decides in.
   *
   * The same remedy as `suppressed_by_guard`, applied to the field that is actually used: no rule
   * has declared `detector.guard_missing` since 2026-07-27 (0 of 56), while nine declare
   * `detector.also_in_file`, so the array above describes a suppression that never happens and this
   * one describes 11,976 of them over the pinned corpus.
   * Emitted even when empty: "no gate shut in this tree" is a statement about the tree, and an
   * absent key would be indistinguishable from a scanner that does not record.
   */
  suppressed_by_corroboration?: CorroborationSuppression[];
  /**
   * Languages the structural reading could not open at all, named once each with the error and the
   * number of files it cost. Present only when something failed. A count says a hole exists; this
   * says where it is and what would close it. One load attempt is made per grammar per process, so
   * a language appears here at most once however many files hit it.
   */
  structural_grammars_unavailable?: { language: string; error: string; files: number }[];
  /**
   * Every dependency the tree's `package.json` manifests declare **in `dependencies`,
   * `optionalDependencies`, `devDependencies` or `peerDependencies`**, with where it is declared,
   * which of those four blocks declares it, and where it is called. Facts, above the findings and
   * never among them: nothing here is a candidate and nothing here decides one.
   *
   * **All four blocks, each declaration labelled with `field`**. Until
   * that day it was the two runtime blocks only, and an analytics SDK in `devDependencies` or a
   * payment SDK in `peerDependencies` reached no reader at all. `bundledDependencies` is still not
   * read: it is an array of names, not a declaration map, and its members are declared in one of
   * the four blocks anyway.
   *
   * **It reaches the adjudicating agent** (`SKILL.md` step 4), which is the whole reason it is in
   * this document rather than only in the reconciliation input. Until 2026-08-28 the census
   * computed it for the scope assessment and pillar 2, and layer 2 — the part of the system that
   * actually reads code in context — was handed candidate fields, the ScanProfile and
   * `.legal/memory.md` and no dependency information at all.
   *
   * Emitted even when empty: a tree with no npm manifest is a statement about the tree, and an
   * absent key would be indistinguishable from a scanner that does not record — the same rule
   * `suppressed_by_corroboration` and `files_not_read` follow. See `DependencyInventoryEntry` for
   * the three things an entry does not establish.
   */
  dependency_inventory?: DependencyInventoryEntry[];
  /**
   * Dependencies whose name matches an anchor of a recipient vocabulary list while no candidate of
   * the rules that splice that list names them in this scan.
   *
   * **An observation, and the weakest kind of one.** It says two things were read and did not meet:
   * a manifest declares a package spelled like a vendor the recipient rules know, and no candidate
   * of those rules carries that spelling. It does not say the vendor receives anything, does not say
   * a detector missed anything, and does not say the manifest is wrong. Each of those is a reading a
   * person makes with the files open, and this record exists to let them make it rather than to make
   * it for them.
   *
   * The inverse direction — a candidate naming a vendor that no manifest declares — is deliberately
   * NOT here. A vendor is routinely reached with no dependency at all, over plain HTTP, so that
   * direction is ordinary rather than notable, and `SKILL.md` step 4 hands it to the adjudicator as
   * something worth stating in a verdict instead.
   *
   * Emitted even when empty, for the reason `dependency_inventory` above is.
   */
  declared_vendors_without_candidates?: DeclaredVendorWithoutCandidate[];
  /**
   * The index of the per-group PAYLOAD FILES this run wrote beside the document — one per
   * `adjudication_group.key`, each carrying that group's candidates and the verbatim source
   * excerpts around their matched lines.
   *
   * Present only where `--out` named a document to write them beside AND the source excerpts are
   * on; `--context-window 0` or `PRODUCT_CLI_CONTEXT=0` turns them off and this key is then absent,
   * which is the document exactly as it was written before 2026-09-17.
   *
   * **The payload files hold source code, and this document does not.** See
   * `FindingsContextPayloads` for what that means for a person who shares a scan.
   */
  context_payloads?: FindingsContextPayloads;
}

/**
 * Where the per-group payload files went, and what they hold.
 *
 * **THESE FILES HOLD VERBATIM SOURCE EXCERPTS FROM THE SCANNED TREE.** `findings.json` itself holds
 * paths, line numbers and matched-line text; a payload file holds up to `window_lines` lines each
 * side of every matched line, the file's import region and the opening line of each enclosing
 * construct the structural reading recorded. They are written under the directory `--out` names —
 * the user's own `.legal/` on a default run — and nothing about them leaves the machine. A person
 * who shares a payload file shares code, which is a stronger act than sharing the document.
 *
 * **A payload writes each rule's prose once** (unit P(a) of the layer-2 cost lane, 2026-09-18): the
 * eight fields that belong to the rule rather than to the candidate are in the payload's own `rules`
 * array, one block per rule id, and each candidate names its block with the `rule_id` it already
 * carries. Nothing was dropped, shortened or summarised, and nothing in THIS document changed but
 * each row's `bytes` and `sha256`. The eight fields, the reason and the measurement are in the
 * producing module's own header (`product/packages/cli/src/context.ts`,
 * `RULE_OWNED_IN_PAYLOAD`) and are deliberately not repeated here.
 */
export interface FindingsContextPayloads {
  /** The payload directory, relative to the directory the findings document is in. */
  directory: string;
  /** Lines each side of a matched line the excerpts were built with (`--context-window`). */
  window_lines: number;
  /** The most excerpt text one location may be given. A hard ceiling. */
  max_bytes_per_location: number;
  /**
   * The least excerpt text one location is given however many share its payload — about 40 lines of
   * ordinary source. `bytes_per_payload_budget` below YIELDS TO THIS: a window too small to hold the
   * neighbourhood of the match is not worth writing.
   */
  min_bytes_per_location: number;
  /**
   * The excerpt budget one payload file is given, divided evenly over its locations and then clamped
   * between the two figures above. A budget and not a ceiling — see `min_bytes_per_location`.
   */
  bytes_per_payload_budget: number;
  /**
   * The most bytes a payload holding MORE THAN ONE candidate may have. A bin over it is divided,
   * by reading units, until every part is under it or holds one candidate. Written only where the
   * scan packed its payloads (`--pack-groups off` writes the index it wrote before the cap existed).
   */
  max_bytes_per_payload?: number;
  /** Payload files over the cap: single candidates, written whole. Only where packing applies. */
  payloads_oversized?: number;
  /** How many of the packer's bins the cap divided. Only where packing applies. */
  bins_divided_by_cap?: number;
  /** Always `true`, and written rather than implied: see this interface's own description. */
  holds_source_excerpts: true;
  /**
   * WHAT LAYER 2 WILL COST OVER THESE PAYLOADS, AND THE THREE SHAPES THE RUN MAY TAKE.
   *
   * It is in the payload index rather than at the top level of the document because every figure in
   * it is derived from `payloads` below: the launch count IS the row count, and a document with no
   * payload index has no launch count to state. Written wherever the index is — `--context-window
   * 0` writes neither.
   */
  cost_preview?: FindingsCostPreview;
  /** One row per adjudication group, in the order the document's candidates first name the group. */
  payloads: FindingsContextPayloadRow[];
}

/**
 * THE PRICE OF THE NEXT LAYER, STATED BEFORE IT IS SPENT.
 *
 * Layer 2 runs in the user's own agent and the user pays for it, so the run that is about to launch
 * a child per payload says here what that will cost and what the cheaper shapes cost instead. The
 * launch count is EXACT — it is the number of payload files this run wrote. Everything derived from
 * it is an ESTIMATE built on two measured medians, and each carries the citation of its own
 * measurement so that a reader can re-take it rather than trust it.
 *
 * COUNTED AT THE INPUT PRICE, AS A RANGE: the price model
 * is the lines of two runs on two open-source repositories (reading by payload bytes, verdicts per one-seat candidate,
 * answer seats, orchestration per launch, the second check per violation candidate), two repositories' tuning numbers, so
 * every figure is a low and a high and never a point. Producer:
 * `cost-preview.ts` (`PRICE_MODEL`, `priceRows`).
 */
export interface FindingsCostPreview {
  /** Adjudicator launches this document implies: one per payload file, reader payloads included. */
  launches: number;
  /** Distinct candidates those launches adjudicate. A candidate read by kinds is one candidate. */
  candidates: number;
  /** The model the figures were computed with, and where it was measured. */
  price_model: FindingsPriceModel;
  /** Wall seconds one launch takes, whatever it is handed. */
  seconds_per_launch: number;
  /** Where `seconds_per_launch` was measured. */
  seconds_per_launch_source: string;
  /** Children the skill keeps in flight (design E; `SKILL.md` step 4). */
  concurrency: number;
  /** Every payload read and judged once, no second check: the low and high ends of the range. */
  estimated_tokens_low: number;
  estimated_tokens_high: number;
  /** `ceil(launches / concurrency) x seconds_per_launch` — whole waves, as `SKILL.md` step 4 says. */
  estimated_seconds: number;
  /** The three shapes, always all three and always in this order: full, important, refute_later (the question offers refute_later first). */
  shapes: FindingsCostPreviewShape[];
}

/** The price model's coefficients, in tokens counted at the input price (`cost-preview.ts` `PRICE_MODEL`). */
export interface FindingsPriceModel {
  read_tokens_per_payload_byte: number;
  verdict_tokens_per_one_seat_candidate: number;
  answer_seat_tokens: number;
  orchestration_tokens_per_launch: number;
  second_check_tokens_per_violation_candidate: number;
  /** Violation candidates per candidate adjudicated, low and high (run 2; the larger of the two runs). */
  violation_candidate_share: [number, number];
  /** The host's record over the seats' priced tokens, low and high (the smoke; the larger of the two runs; the gap is not explained). */
  host_over_priced: [number, number];
  /** The widening for two repositories' rates, low and high multipliers of the central figure. */
  widened: [number, number];
  source: string;
}

/** One run shape and what it costs. The user chooses one of these before the first launch. */
export interface FindingsCostPreviewShape {
  /**
   * `full` adjudicates every payload, then the second check; `important` adjudicates the payloads that hold a
   * high-severity candidate or carry a rule this run launches exactly once, leaves the rest for a later run, then the
   * second check; `refute_later` adjudicates every payload with no second check - the recommended shape since the
   * decision of 2026-10-07 (the id is older than the decision).
   */
  shape: "full" | "important" | "refute_later";
  /** Launches this shape spends IN THIS RUN, before any second check. */
  launches: number;
  /** Distinct candidates this shape adjudicates in this run. */
  candidates: number;
  /** The whole range, the second check included where it runs. */
  estimated_tokens_low: number;
  estimated_tokens_high: number;
  estimated_seconds: number;
  /** Whether the shape runs the second check (a refuter per violation candidate) after its verdicts. */
  second_check: boolean;
  /** Where `second_check`: its own part of the range. */
  second_check_tokens_low?: number;
  second_check_tokens_high?: number;
  /** `important` only: payloads kept because they hold a candidate of severity `high`. */
  selected_for_high_severity?: number;
  /** `important` only: payloads kept because a rule of theirs has exactly one payload in this run. */
  selected_as_single_launch_rule?: number;
}

/** One payload file: which group it carries, where it is, how big it is and what it hashes to. */
export interface FindingsContextPayloadRow {
  /** The `adjudication_group.key` this file carries. Whatever shape that key has, this is it. */
  key: string;
  /** Path to the file, relative to the directory the findings document is in. */
  path: string;
  candidates: number;
  /** How many locations the payload OPENS — see the schema, which is the contract. */
  locations: number;
  /** Reading units handed to this payload's seat. Written only where a candidate is read by kinds. */
  reading_units?: number;
  /** Matched locations those candidates carry altogether. Written only where one is read by kinds. */
  locations_covered?: number;
  excerpts: number;
  bytes: number;
  sha256: string;
  /**
   * True where `bytes` is over `max_bytes_per_payload`. The payload then holds ONE candidate — a
   * payload of several is divided until it is under the cap — and is written whole.
   */
  oversized?: true;
}

/**
 * One dependency spelled like a known recipient vendor, with no candidate of the rules that know
 * that spelling naming it in this scan.
 *
 * Facts only: the package, the vocabulary lists whose anchors it matched, where it is declared,
 * whether anything imports it, and the candidate count — which is 0 by construction and is written
 * anyway, because a record whose defining property is invisible is a record a reader has to take on
 * trust.
 */
export interface DeclaredVendorWithoutCandidate {
  /** The package name, exactly as the manifest writes it. */
  package: string;
  /**
   * The recipient vocabulary lists whose anchors this name matched, sorted. A list name, not a
   * vendor identity: which vendor an anchor belongs to is in `rules/vocabulary/`, and the bundle
   * carries the anchors flattened.
   */
  matched_anchor_lists: string[];
  /** The anchors that matched, sorted. Literal text out of the vocabulary, never a pattern. */
  matched_anchors: string[];
  /**
   * Every declaration of it — **one entry per manifest AND per block** — copied from its
   * `dependency_inventory` entry. Not a count of files: one manifest declaring the package in two
   * blocks contributes two entries, and `field` says which block each came from.
   */
  declared: DependencyDeclaration[];
  /** Copied from the inventory entry. A declared-only dependency counts here like any other. */
  declared_only: boolean;
  /** Copied from the inventory entry where present: no call site found, lines that could hold one not read. */
  call_sites_not_read?: CallSitesNotRead;
  /**
   * Candidates of the rules that splice the matched lists whose matched text names this package.
   * **Always 0** — a non-zero row is not written — and present so that the claim is on the record
   * rather than implied by the row's existence.
   */
  candidates_naming_it: number;
  /** The rules that splice the matched lists, sorted. Which rules were looked at, not which failed. */
  rules_consulted: string[];
}

/**
 * One rule that shipped in this bundle and raised no candidate on this tree.
 *
 * THE POINT OF THE RECORD. A scan that reports only what it found reports the absence of
 * a finding as nothing at all, and a reader cannot tell "this detector read your code and matched
 * none of it" from "this detector never ran", from "this detector cannot express the way you spell
 * it". Measured in this repository's own G3 harness: 212 of the 450 mutants that record it take
 * their whole file to zero candidates, so the rule goes silent and nothing anywhere says so. The absence of a candidate is `unknown`, never
 * `clean` — and an `unknown` nobody can enumerate is the same silence with a better conscience.
 *
 * WHAT IS NOT HERE. Rules that DID raise a candidate — they are in `candidates`, and repeating them
 * would be a forbidden second copy. Rules the installed packs do not ship: this array is
 * built from the loaded bundle, so a rule that is not in it is not reported as anything. And the
 * rule's `context_questions` and `legal_basis`, which ship whole inside that same bundle: a row is
 * read by the orchestrator, which has the bundle open, so copying 651 KB of them into every scan
 * would be paid for by the user's own agent for content it can already read. A candidate carries
 * them because a candidate is posted to a fresh subagent that has no bundle beside it.
 *
 * JURISDICTION IS CARRIED, NEVER APPLIED. `jurisdiction` is the rule's own declaration, copied
 * verbatim; nothing in the CLI compares it with `ScanProfile.distribution_regions`. That comparison
 * is the adjudicating agent's (`product/plugin/skills/legal-scan/SKILL.md`), which already makes it
 * for candidates, and it stays in one place: a per-rule jurisdiction gate was written in the engine
 * on 2026-07-27 and removed the same day on the owner's correction — the region choice belongs to
 * pack selection, and repeating it inside the scan deletes candidates silently. It is also not a
 * string comparison: a rule declaring `["EU"]` is in scope for a profile declaring `["DE","FR"]`.
 */
export interface RuleWithoutCandidates {
  rule_id: string;
  /** The rule's own title, copied verbatim, so the record reads without the bundle beside it. */
  title: string;
  /**
   * `evaluated` — the rule was in scope and raised no candidate, **and that is all this value
   * says**. It does not by itself mean the detector read anything: `files_on_surface: 0` means the
   * rule was offered no file at all, and a non-zero `matches_removed_by_corroboration` means its own
   * patterns DID match and a corroboration gate then silenced them. **Only a row with
   * `files_on_surface` above zero and no corroboration removals is the one where the detector read
   * code and matched none of it — that is the `unknown` population**, and the one an adjudicator has
   * to reason about. (This comment said "the rule ran over this tree and matched nothing" until
   * 2026-08-24; `scan.ts` `censusRoster` names the three shapes separately for exactly this reason.)
   *
   * `not-evaluated` — the ScanProfile's own answers put the rule out of scope before it read a
   * line; `unmet_preconditions` names which answers. Different from `evaluated` in kind: nothing
   * was looked at, so this is not evidence about the code either way, and the thing worth checking
   * is the declaration.
   *
   * **From 2026-08-27 this scanner never writes `not-evaluated`.** A profile answer labels a rule's
   * output and no longer removes the rule, so every row is `evaluated` and the rows that used to be
   * `not-evaluated` are the ones now carrying `declared_inapplicable_preconditions`. The value stays
   * in the union because documents written before that date carry it and every consumer has to keep
   * reading them.
   */
  state: "evaluated" | "not-evaluated";
  /** The rule's declared jurisdictions, verbatim. Carried, never applied — see above. */
  jurisdiction: string[];
  /**
   * The rule author's account of what a match establishes and what it does not, copied verbatim
   * from the rule exactly as `Candidate.evidence_template` is.
   *
   * **This is the field that makes the record usable rather than a list of names.** Read backwards
   * it is the best available statement of what the rule was looking for, which is what an
   * adjudicator needs in order to decide whether this silence is surprising in THIS project. The
   * same field was authored in all 56 rules, shipped inside the bundle, and copied into no output
   * at all until 2026-08-11 (SKILL.md step 4); a roster that named rules and dropped it would
   * repeat that defect one array over.
   *
   * `{file}` and `{line}` are left unsubstituted, as in `Candidate` — here they have no location to
   * stand for at all, which is precisely the state being reported.
   */
  evidence_template?: string;
  /** When the duty starts to apply, verbatim from the rule. Absent where the rule declares none. */
  effective_date?: string;
  /**
   * The ScanProfile expressions that did not hold, verbatim from
   * `rule.applicability_preconditions`. Present only when `state` is `not-evaluated`, and never
   * empty there: it is the whole reason the rule did not run.
   *
   * **No longer written by this scanner, and kept because documents already on disk carry it.** From
   * 2026-08-27 a profile answer does not stop a rule from running, so no row is `not-evaluated` and
   * this field has no row to sit on. `declared_inapplicable_preconditions` below carries the same
   * expressions for the rules that used to be here — under a different name, deliberately, because
   * this one means *the rule never ran* and `SKILL.md` step 3b tells an agent to report it as
   * `not_applicable`. Reusing the name would have an agent report `not_applicable` about a rule that
   * raised a contradiction.
   */
  unmet_preconditions?: string[];
  /**
   * The ScanProfile expressions this rule turns on that the profile does not answer at all, verbatim
   * from `rule.applicability_preconditions`. Present only when non-empty, on EITHER state: a rule
   * can be switched off by one answered precondition while a second is left open, and both belong
   * in front of the reader before they decide whether the declaration is right.
   *
   * **Unanswered is not `not_applicable`.** Until 2026-08-25 an unanswered precondition was read as
   * an answer of no and the rule never ran; it runs now, and `SKILL.md` step 3b requires this row to
   * be reported as `unknown` with the open question named.
   */
  unanswered_preconditions?: string[];
  /**
   * The ScanProfile expressions this rule turns on that the profile ANSWERED in a way that puts the
   * rule out of scope — and the rule ran anyway. Present only when non-empty.
   *
   * **This field says the rule was allowed to run under an answer of no. On its own it says nothing
   * about what the rule then read or matched**, and which of the roster's three silences this row is
   * must be read from the OTHER fields of the same row:
   *
   * - `files_on_surface` above zero AND no `matches_removed_by_corroboration` — the only shape that
   *   supports "the detector was allowed to look for it and it found nothing", and the only one that
   *   corroborates the declaration. Weakly: a detector that did not find a construct has not
   *   established that the construct is absent, and every caveat on any other silent row applies.
   * - `files_on_surface` of 0 — no file was offered to the rule at all, so this pass neither
   *   contradicted nor corroborated the answer.
   * - `matches_removed_by_corroboration` above zero — the rule's own patterns DID match here and a
   *   corroboration gate then removed them. That is the opposite of a corroboration: the construct is
   *   in this tree.
   *
   * This comment asserted the corroboration unconditionally until 2026-08-27, as did the console line
   * built the same way, which independent verification reproduced calling a gate-silenced rule and a
   * rule with no surface "answered out of scope and raised nothing" — four lines under a block saying
   * the construct was in the tree, and on an empty directory beside `files 0 scanned`. `censusRoster`
   * in `scan.ts` is where the three are told apart; nothing may re-derive them.
   *
   * The same expressions `unmet_preconditions` above used to carry, under a different name because
   * the fact is different: that one says the rule never ran.
   */
  declared_inapplicable_preconditions?: string[];
  /**
   * How many of the files this scan opened the rule was allowed to read. Written on every row from
   * 2026-08-27; before then, present only when `state` was `evaluated`.
   *
   * **Zero is the reading this field exists for.** A rule whose `detector.file_globs` matched no
   * file in this tree, or whose `detector.path_without` carved out every file that did, has said
   * nothing about the code — its silence is a fact about the tree's layout. A rule that read four
   * thousand files and matched none of them has said something quite different. Both produce zero
   * candidates, and until 2026-08-19 no output could tell them apart.
   */
  files_on_surface?: number;
  /**
   * Match lines this rule's `detector.also_in_file` gate removed in this tree, summed over the
   * rule's entries in `suppressed_by_corroboration`. Omitted when zero. Reachable on every row from
   * 2026-08-27; before then, present only when `state` was `evaluated`.
   *
   * **A rule that appears here did match its own patterns and was then silenced**, which is the
   * least `unknown`-like of all the silences in this array and the most worth reading: the
   * construct is in the tree and a corroboration gate decided the file did not corroborate it.
   * Derived from the same array a reader can open, never recomputed from the patterns.
   */
  matches_removed_by_corroboration?: number;
}

/**
 * One instrument's applicability verdict, computed from the checklist gate's limbs and the code
 * census. Produced by `scope.ts` in the CLI; this is the contract it writes to.
 */
export interface ScopeAssessmentRecord {
  checklist_id: string;
  law: string;
  source_url: string;
  quote: string;
  cite: string;
  verdict: "applies" | "likely-applies" | "does-not-apply" | "unresolved";
  because: string;
  limbs: {
    limb_id: string;
    question: string;
    // Narrowed 2026-08-13, following `findings.schema.json` rather than leading it: this file's own
    // header says the schemas are authoritative and these types follow them, and the findings schema
    // now states both of these as enums instead of `type: string`.
    //
    // Written as an indexed access rather than as the union spelled out again, because the union was
    // already spelled out twice — in `ChecklistLimb` below and in `scope.ts`'s `LimbOutcome` — and a
    // third copy is what the project's rules forbid: "never keep a second copy of anything two places must
    // agree on". The three copies had in fact already disagreed, which is why this line was `string`.
    // `closes_gate_when` is optional upstream (a limb that omits it annotates only) and required
    // here, because `scope.ts` substitutes `"never"` before emitting.
    decided_by: ChecklistLimb["decided_by"];
    closes_gate_when: NonNullable<ChecklistLimb["closes_gate_when"]>;
    quote_ref: string[];
    state:
      | "supported"
      | "opposed"
      | "contested"
      | "settled-by-premise"
      | "settled-by-declaration"
      | "contradicted-by-declaration"
      | "unresolved";
    /**
     * Facts the tree carries for and against this limb, **capped at 20 examples each since
     * 2026-09-03, with the exact totals in `supporting_count` / `opposing_count`.**
     *
     * These arrays are a second copy of rows that already sit in `census.facts` under the same
     * `fact_id`, re-serialised once per limb of every gate that names the kind. Measured on one tree
     * the day the census stopped gating collectors on file extension: `applicability` went from
     * 5.67 MB to 103.88 MB of a 149 MB reconciliation input, one limb carrying 70,440 rows, and
     * layer 2 runs in the user's agent and the user pays for every byte. No verdict, limb state or
     * contradiction reads the array's length — they are computed from the full sets before the cap.
     */
    supporting: ScopeEvidence[];
    opposing: ScopeEvidence[];
    /** Exact population, computed before the example cap. Read this, never `supporting.length`. */
    supporting_count: number;
    /** Exact population, computed before the example cap. Read this, never `opposing.length`. */
    opposing_count: number;
    bears_on_verdict: boolean;
    declared_by?: string;
    declared_value?: boolean | null;
  }[];
  unresolved_limbs: string[];
  /**
   * Limbs where the person running the scan said no and the tree says yes. Never resolved
   * silently: a declaration that could switch an instrument off by itself would make this product
   * a self-assessment form.
   */
  contradictions: {
    limb_id: string;
    declared_by: string;
    /** Capped at 20 examples, for the reason `supporting` gives. */
    evidence: ScopeEvidence[];
    /** Exact population, computed before the example cap. */
    evidence_count: number;
  }[];
}

/**
 * One census fact carried into an applicability verdict, with the line a reader can check. The line
 * is named and never quoted: the census fact's `line_text` is not copied into the findings
 * document since 2026-09-23, when it stopped carrying raw source text.
 */
export interface ScopeEvidence {
  fact_id: string;
  kind: string;
  value: string;
  file: string;
  line: number;
}

/**
 * One exclusion the walker made, aggregated by reason and directory.
 *
 * `extension-not-scanned` is retained so that findings files written before 2026-07-28 still
 * validate; the walker stopped producing it when its extension allowlist was inverted into a
 * denylist plus a content sniff. `binary-extension` records a decision made from the file's name,
 * `binary-content` one made from its bytes.
 */
export interface WalkerExclusion {
  reason:
    | "generated-directory"
    | "non-production-directory"
    | "hidden-directory"
    | "non-production-file"
    | "generated-file"
    | "size-limit"
    | "binary-extension"
    | "binary-content"
    | "extension-not-scanned"
    // The scan's READ SCOPE, one reason per class of
    // `rules/path-exclusions/`. They are walker exclusions like any other — the walk declined the
    // path and counted it — and they are named apart from the reasons above because these three are
    // the only ones an option can lift, and `coverage_limits` has to be able to say so. A run that
    // opted in with `--read` produces none of them.
    | "read-scope-tests"
    | "read-scope-vendored"
    | "read-scope-build"
    // What stood at the path was not a regular file, or could not be opened: named in full, with
    // its kind, never one of three examples (cli walk.ts `NAMED_IN_FULL`).
    | "named-pipe"
    | "socket"
    | "device"
    | "link-to-folder"
    | "link-to-nothing"
    | "link-to-outside"
    | "could-not-open"
    // The walker's own bounds.
    | "link-not-followed"
    | "name-not-utf8"
    | "link-path-too-long"
    | "git-lfs-pointer";
  dir: string;
  /** Null where the tree was skipped without descending, so "not counted" is never read as "none". */
  files: number | null;
  examples: string[];
}

/**
 * One file the walker handed to the engine, the engine opened, and no rule was then allowed to read.
 *
 * **The distinction from `WalkerExclusion` is which layer refused, and it matters to the reader.**
 * A walker exclusion is a decision taken from a path or from four kilobytes of bytes, before any
 * rule existed for the file; this is a decision taken with the whole file in memory. The walker
 * summarises by (reason, directory) with three examples, which is the right shape for "what part of
 * the tree did we not go into"; this names every file, which is the only shape that answers "was
 * THIS file read".
 *
 * **Why it exists at all.** Until 2026-08-25 the engine's own refusals were a single integer added
 * into `stats.files_skipped`, and `files_skipped` also carries every walker skip, so no consumer
 * could recover even the count. To a reader of `findings.json`, of the SARIF, of the console line or
 * of the layer-2 report, *"we did not read this file"* and *"there was nothing in this file"* were
 * the same output — which is the state the design exists to forbid, at file granularity. The
 * ruling is: do not remove the skip, report it.
 */
export interface NotReadFile {
  /** Path relative to the scan root, exactly as the walker produced it. */
  file: string;
  /**
   * `long-line` — **no line of the file is under the minification ceiling**, so nothing was left to
   * read once the over-long lines were taken out (`blankLongLines` in the CLI's walker). This is
   * strictly narrower than it was before 2026-09-07, when the row meant only that the file
   * CONTAINED such a line: a document with one squashed value among 2,478 ordinary lines is not in
   * this array at all any more — it is in `files_partially_read`, read minus that line. What is
   * here is what the ceiling exists for, a build output with nothing a person could remediate;
   * measured over fifteen corpus trees, 398 of the 1,201 files the ceiling touched. The ceiling is
   * still a **proxy** and is still reported as one. `longest_line` carries the measurement the
   * decision was taken on.
   *
   * `unreadable` — the file could not be read as UTF-8 text at the moment the engine asked for it
   * (removed, permission denied, a race with another process). `detail` carries what the runtime
   * said. This was silent for exactly as long as `long-line` was.
   *
   * `time-budget` — the PER-FILE WALL-CLOCK BUDGET (`--file-budget`, 60 s by default) was already
   * spent when the first rule reached the first line, so no rule read a line of this file. `budget_ms`
   * and `elapsed_ms` carry the measurement the stop was taken on. The ordinary case is the other one:
   * a budget that runs out part-way through leaves the file in `files_partially_read` with a
   * `stopped_for_time` block, because lines WERE read. A row here means none were. Added 2026-09-16;
   * a scan run with `--file-budget off` can never write one.
   */
  reason: "long-line" | "unreadable" | "time-budget";
  /** Characters in the file's longest line. Present for `long-line`. */
  longest_line?: number;
  /** The ceiling that line exceeded, so the row is self-describing a year later. */
  threshold?: number;
  /** What the runtime said, for `unreadable`. */
  detail?: string;
  /** The per-file budget in force, in milliseconds. Present for `time-budget`, and at least 1:
   * `resolveFileBudgetMs` refuses a `--file-budget` that rounds to 0 ms, so no document carries a
   * budget that would stop every file before its first line. `findings.schema.json` and
   * `evidence-log.schema.json` both bound it at `minimum: 1` (note F2, 2026-09-16). */
  budget_ms?: number;
  /** Wall-clock milliseconds this file had already cost when the budget stopped it. Present for
   * `time-budget`, and always >= `budget_ms`: the clock is read between lines, so the reading that
   * stops a file is taken after the work that overran it. */
  elapsed_ms?: number;
}

/**
 * One file the engine READ WITHOUT READING ALL OF IT, and what was left out — by the minification
 * ceiling (`lines`), by the per-file wall-clock budget (`stopped_for_time`), or by both.
 *
 * **A different population from `NotReadFile`, and the two are never added.** That array is the
 * files no rule read at all; this is the files every rule read, minus some lines. The ceiling itself
 * did not move — it is still `MINIFIED_LINE_LIMIT`, still a proxy, still reported as one — but from
 * 2026-09-07 it is applied to the LINE rather than to the file.
 * The ruling keeps all of its substance: a collapsed line reaches no
 * rule, no quote and no adjudicator.
 *
 * **Why it is written down.** A file whose content was reduced and which says nothing about the
 * reduction is the silence of 2026-08-25 one unit further in — a reader of a scan that says nothing
 * here cannot tell a file that was read whole from one that was read with 1,472 characters missing.
 * `files_not_read` answers "was THIS file read"; this answers "was ALL of it read".
 *
 * **What a row also tells a reader that nothing else does.** A file partially read BY THE CEILING is
 * refused by every reading that is not line-local — the `yaml-anchors` gate view and the structural
 * (parse-tree) reading — because a blanked line changes the document those two parse. The line
 * readings are unaffected, because a blanked line is decided exactly as an empty line is.
 *
 * **TWO CAUSES SINCE 2026-09-16, AND A ROW SAYS WHICH IT IS BY WHICH BLOCK IT CARRIES.** `lines` is
 * the minification ceiling; `stopped_for_time` is the per-file wall-clock budget (`--file-budget`,
 * 60 s by default), which stops a file mid-read so that one pathological file is a named coverage
 * limit instead of a scan that never finishes. A row carries at least one of the two and may carry
 * both. `threshold` belongs to `lines` and is present exactly when it is, which is why both fields
 * became optional on that date — a file the budget stopped and the ceiling never touched has no
 * ceiling to name, and writing one anyway would state a measurement that was never taken. Consumers
 * that read `row.lines.length` unguarded must read `row.lines?.length ?? 0`; nothing else changed.
 */
export interface PartiallyReadFile {
  /** Path relative to the scan root, exactly as the walker produced it. */
  file: string;
  /** The ceiling the lines below exceeded, carried per row so the record is self-describing when
   * the ceiling later moves. Present exactly when `lines` is. */
  threshold?: number;
  /**
   * Every line replaced by the empty string, in ascending line order, with the length it held.
   *
   * The LINE NUMBERS ARE THE FILE'S OWN and are unchanged by the blanking: the line is emptied in
   * place and never removed, so a reader can open the file and see exactly what was not read.
   *
   * Absent — not empty — on a row that is here for the time budget alone.
   */
  lines?: { line: number; length: number }[];
  /**
   * The PER-FILE WALL-CLOCK BUDGET stopped this file's read, and the measurement it was stopped on.
   *
   * **WHAT THE SHAPE MEANS, because it is not "the file was read down to line N".** The engine reads
   * a file rule by rule, and each rule reads every line: the outer loop is the rules, the inner loop
   * is the lines (`scanFile` in engine.ts). So a stop splits the rules into three groups, and the
   * four counts below are what lets a reader reconstruct which is which:
   *
   *   - rules 1..`rules_completed` FINISHED WITH the file and are in the document exactly as they would
   *     be without the budget — they either read every line of it or declined it on `file_globs` /
   *     `path_without`, which finishes with a file as surely as reading it does;
   *   - rule `rules_completed + 1` read lines 1..`lines_read` of it and stopped before the next line
   *     — every candidate it raised over those lines is kept;
   *   - rules `rules_completed + 2`..`rules_total` never read this file at all.
   *
   * `lines_total` is the file's own line count, so `lines_total - lines_read` is what the interrupted
   * rule did not see. **Only candidates are affected. Nothing already raised is dropped**, and the
   * one reading that can go the other way is named where the stop is taken: a `guard_missing` clause
   * of a rule that did not finish is not evaluated on this file, and a guard DELETES candidates, so
   * the stop can leave a candidate standing elsewhere that a complete read would have removed.
   *
   * Added 2026-09-16. Absent on every scan in which no file
   * exceeded its budget, and on every scan run with `--file-budget off`.
   */
  /**
   * The census's stop on this file: the census is a second pass over the file with its own
   * clock, and when it spent the budget it read the file only up to `stage`. Present only on such a file.
   */
  census_stopped_for_time?: Omit<CensusStoppedFile, "file">;
  stopped_for_time?: {
    /** The budget in force for this file, in milliseconds, and at least 1 — see
     * `FileNotRead.budget_ms` for why a budget below that cannot reach a document. */
    budget_ms: number;
    /**
     * Wall-clock milliseconds this file had cost when the clock was read. Always >= `budget_ms`: the
     * clock is read between lines, so the reading that stops a file is taken after the work that
     * overran it.
     *
     * **THE DIFFERENCE IS ONE CLOCK WINDOW OF THE INTERRUPTED RULE, NOT ONE LINE.** This comment said
     * "what one line of one rule cost" until 2026-09-16, when independent verification measured
     * overshoots of up to +74 % of the budget against it. The window is sized from the per-line cost
     * of the window just measured so that it cannot spend more than a quarter of what is LEFT, and it
     * is one line as soon as fewer than four such lines fit — so a rule whose per-line cost is steady
     * stops within one (rule, line), re-measured at +0.4 % to +1.9 % on the input that produced the
     * +74 %. A rule whose cost rises sharply inside one window can still overshoot by that window.
     * **A measurement of one run on one machine, never a bound the tool guarantees.**
     */
    elapsed_ms: number;
    /**
     * Lines of this file the INTERRUPTED RULE read before the stop; the stop is before line
     * `lines_read + 1`.
     *
     * `0` is a real value and says something precise: the clock ran out on that rule's first reading
     * of line 1. With `rules_completed` above 0 the file was still read WHOLE by every rule before
     * it, which is why the row is here and not in `files_not_read`. The one combination that cannot
     * appear is `0` with `rules_completed: 0` — no rule read a line of that file, and it is in
     * `files_not_read` with reason `time-budget`.
     */
    lines_read: number;
    /** Lines the file has. Unchanged by the stop: nothing is removed from the file's own numbering. */
    lines_total: number;
    /**
     * Rules that had FINISHED WITH this file when the stop came, in the bundle's compiled order:
     * those that read every line of it, and those that declined it on `file_globs` / `path_without`.
     *
     * The second group is counted deliberately, and this sentence says so because it used to say
     * "read the whole file" — exact only while no rule excluded the stopped file by glob, which was
     * true of every case measured and is a property of the bundle rather than of this field. What the count is FOR is the subtraction:
     * `rules_total - rules_completed` is the interrupted rule plus every rule below it, and a rule
     * that declined the file belongs on the finished side of that line.
     */
    rules_completed: number;
    /**
     * Rules this run compiled — the whole bundle, or the selection `--rules` narrowed it to. The
     * number that would have finished with the file had the scan not been stopped, on the same
     * reading as `rules_completed`: some of them would have declined it rather than read it.
     */
    rules_total: number;
  };
  /**
   * THE STRUCTURAL (PARSE-TREE) READING OF THIS FILE PASSED ITS TIME ALLOWANCE AND WAS ABANDONED. Every rule still read every line of the file - the line patterns are the first
   * reading and nothing of theirs is undone - but the rules that also read a file as a document
   * (`detector.structural_checks`) got no parse tree of this one, exactly as when a parse throws; the
   * file is also counted in `stats.structural_parse_failed`. Why the allowance exists: one hostile
   * 1 MB HTML file held a single parse for fifteen minutes, out of reach of the per-file budget.
   * Absent on every file whose structural reading finished, was never asked for, or was refused.
   */
  structural_reading_stopped?: {
    /** The allowance in force for this file, in milliseconds: half its per-file budget, at most 10,000. */
    allowance_ms: number;
    /**
     * Wall-clock milliseconds the structural reading had taken when the allowance was read as spent.
     * A measurement of one run on one machine, like `stopped_for_time.elapsed_ms`.
     */
    elapsed_ms: number;
  };
}

/**
 * One corroboration gate that shut, and what it cost.
 *
 * A sibling of `SuppressedCandidate` rather than a variant of it, because the two record different
 * events and share no field but `file`. A guard suppression names the thing that FIRED — the guard
 * pattern, its file, its line, its text — and happens after the candidate exists. A corroboration
 * suppression is the absence of a match: nothing fired, so there is no cause to point at, and it
 * happens before any line is pushed. Merging them would mean either making the guard record's four
 * evidence fields optional, which weakens a contract that already holds, or a `kind` discriminator,
 * which findings.schema.json cannot express: the schema forbids `if`/`oneOf`/`allOf` and
 * a check asserts their absence, because everything that gate derives walks
 * `properties` and `items` in step with the document.
 *
 * Field names are snake_case, like the rest of the findings document (`rule_id`, `fact_id` in
 * `ScopeEvidence`, every `stats` counter) and unlike `SuppressedCandidate`, whose camelCase is an
 * engine interface that reached the wire because `scan.ts` passes it through unmapped. Renaming
 * that one is a contract change and was not taken here; copying its casing into a new field would
 * have spread it.
 */
export interface CorroborationSuppression {
  /** The rule whose gate shut. Always a rule declaring a non-empty `detector.also_in_file`. */
  rule_id: string;
  /** Path relative to the scan target, as the walker produces it. */
  file: string;
  /**
   * First line in this file the gate removed for this rule, 1-indexed. Always `lines[0].line`.
   * Named, never quoted: its `line_text` was removed on 2026-09-23 with every other raw-text field
   * of the findings document, and a reader opens `file` at `line` in their own tree.
   */
  line: number;
  /**
   * How many lines in this file the gate removed for this rule — at least 1, because a gate that
   * shut over a file where nothing matched cost nothing and is not recorded. Always
   * `lines.length`; every one of those lines is named in `lines`.
   */
  matches: number;
  /**
   * How many `detector.also_in_file` clauses were tested, every one of which failed. The field is
   * OR-ed, so a shut gate means the whole disjunction failed and "which clause failed" has exactly
   * one answer — all of them. The clause TEXT is not copied here: it ships whole in the bundle's
   * `rules.json`, and repeating it per record would keep one fact in two places.
   */
  clauses_failed: number;
  /**
   * Which mechanism silenced these lines. `also_in_file` — the clause list was tested against the
   * file's own comment-blanked text and every clause failed. `also_in_file+gate_view` — the same
   * clause list was ALSO tested against at least one derived view of the file that was actually
   * built (`detector.gate_view`, see derive.ts), and failed there too.
   *
   * The two `+gate_scope` members say the same thing about the OTHER widening beside the views: the
   * rule declared `detector.gate_scope: "directory"` or `"project"`, so the clause list was also
   * weighed against every other file in that scope the rule is allowed to read, and no file in the
   * whole scope carried the corroboration. That is a stronger statement than a shut file-scope gate
   * and must be legible as one — a reader who takes `also_in_file+gate_scope` for `also_in_file`
   * concludes the corroboration may be one file away when the engine has already looked there.
   *
   * Not derivable from anything else the document carries: `stats.derived_views_built` is a
   * tree-wide count that also counts alias probes, and the rule's own `gate_view` says what was
   * declared rather than what was produced — a view that could not be built was never consulted.
   */
  cause:
    | "also_in_file"
    | "also_in_file+gate_view"
    | "also_in_file+gate_scope"
    | "also_in_file+gate_view+gate_scope";
  /**
   * Every line the gate removed in this file for this rule, in file order — `lines.length` is
   * `matches` and `lines[0].line` is `line`.
   *
   * ADDED 2026-08-27, and it is the field that makes the record answer the question it exists to
   * answer. Until then the record quoted the first removed line and counted the rest, so lines
   * 2..N had no line number anywhere in the document: measured on the eight pass-1 runs of
   * 2026-08-26, 202 records named 202 lines of 379 removed, so 177 removed lines were recoverable
   * only as an integer. `suppressed_by_guard`, the sibling mechanism no rule declares, had
   * recorded every suppressed match individually since 2026-07-27.
   *
   * IT IS REQUIRED, HERE AND IN THE JSON SCHEMA, AND THAT IS A BREAKING CHANGE IN BOTH DIRECTIONS.
   * A document written before 2026-08-27 does not validate against today's findings.schema.json
   * (`must have required property 'cause'` / `'lines'`, once per record), and a document written
   * after it does not validate against a schema pinned before it, because the item sets
   * `additionalProperties: false`. All 20 findings documents frozen under an internal record are in
   * the first class, measured with ajv on 2026-08-27, and none was rewritten. Optional would have been compatible and was refused: it
   * would let a freshly written record omit `lines` and still validate, which is the state this
   * field exists to end. The whole disclosure is in findings.schema.json's top-level `description`.
   */
  lines: CorroborationSuppressedLine[];
}

/**
 * One line a corroboration gate removed.
 *
 * It carries no `rule_id` and no `file`: both are on the `CorroborationSuppression` that owns it,
 * one per (rule, file), which is the unit the gate decides in — `alsoOk` is computed once per file
 * per rule and silences every line below it. Repeating them per line would be the second copy of a
 * fact that two places must agree on, and would make the array a record of N decisions where the
 * engine took one.
 */
export interface CorroborationSuppressedLine {
  /**
   * The removed line, 1-indexed, as `candidates[].locations[].start_line` is. Named, never quoted
   * (its `line_text` was removed on 2026-09-23); a reader opens it in their own tree.
   */
  line: number;
}

/**
 * A candidate removed by a guard, paired with the guard evidence that removed it. Both lines are
 * named and never quoted: `lineText` and `guardLineText` were removed on 2026-09-23, when the
 * findings document stopped carrying raw source text.
 */
export interface SuppressedCandidate {
  ruleId: string;
  file: string;
  line: number;
  guardPattern: string;
  guardFile: string;
  /** 0 when the guard matched across a line break and no single line carries it. */
  guardLine: number;
}

/** One quotation of the real source, as an adjudicator or a refuter returns it. */
export interface VerdictEvidence {
  file: string;
  lines: string;
  quote: string;
}

/**
 * What `verdict-verify` did with one layer-2 record.
 *
 * `confirmed` — every quotation is in the file it names, at the lines it names. `repaired` — every
 * quotation is in the file it names and a line number drifted, which is the common and harmless
 * case. `invalidated` — a quotation was found nowhere, only by its first line, in a DIFFERENT file,
 * or in several at once, or the record carried no evidence its own seat requires. `no_evidence` —
 * the record carried no quotation at all and its seat's contract allows that, so NOTHING WAS
 * CHECKED. That is an absence and never a pass: the two must not render alike in the field a
 * downstream tool reads, which is the design's rule one level up. `parts_confirmed` — the quotation is ELIDED:
 * each part is in the file it names, in the order written and spread within the declared span plus 40 lines, and the
 * quotation AS WRITTEN is in no file. THE LINES BETWEEN THE PARTS WERE NOT CHECKED. It is a weaker
 * claim than `repaired`, which asserts the quotation itself is there, and a record takes it over
 * `repaired` when any of its rows earns it.
 */
/** One quotation row `verdict-verify` could not confirm (verdict.schema.json `$defs.quoteCheckFailure`). */
export interface QuoteCheckFailureRow {
  row: string;
  file: string;
  lines: string;
  reason: "not_found" | "other_file" | "several_files" | "first_line_only" | "no_content" | "redacted";
  effect: "demotes" | "withdraws_dismissal";
  found_in?: string;
  kind?: string;
}

export type VerdictQuoteOutcome =
  | "confirmed"
  | "no_evidence"
  | "repaired"
  | "parts_confirmed"
  | "invalidated";

/**
 * The refuter's second pass, as `verdict.schema.json` carries it.
 *
 * `evidence` was added on 2026-09-17 with the quote check: `legal-refuter.md` had always asked the
 * refuter for quotations and this object had no field for them, so every one was dropped at assembly
 * and none was checkable — on the one seat whose mistake takes a finding out of the report body.
 */
export interface VerdictRefutation {
  outcome: "upheld" | "overturned" | "needs_human";
  reasoning: string;
  grounds?:
    | "non-production-code"
    | "doc-example"
    | "dead-code"
    | "server-side-context"
    | "identifier-uri"
    | "already-gated"
    | "legal-interest-not-engaged";
  agent_model?: string;
  evidence?: VerdictEvidence[];
  /** Written by `verdict-verify`, never by the agent. Absent means the check has not been run. */
  quote_checks?: QuoteCheck[];
  quote_check_outcome?: VerdictQuoteOutcome;
  /** The refuter's own word, kept when the check moved `outcome` to `needs_human`. */
  outcome_before_quote_check?: VerdictRefutation["outcome"];
  quote_check_notes?: string[];
  /** Written by `verdict-verify`: the rows it could not confirm, with the reason and the effect. */
  quote_check_failures?: QuoteCheckFailureRow[];
}

/**
 * One adjudicated candidate. "violation_candidate" is deliberately the
 * strongest verdict available: the pipeline never concludes that the law has
 * been broken, only that something needs review.
 */
export interface Verdict {
  finding_id: string;
  verdict: "violation_candidate" | "not_applicable" | "needs_human";
  confidence: Confidence;
  evidence: VerdictEvidence[];
  reasoning: string;
  fix_available?: boolean;
  refutation?: VerdictRefutation;
  /** Written by `verdict-verify`, never by the agent. Absent means the check has not been run. */
  quote_checks?: QuoteCheck[];
  quote_check_outcome?: VerdictQuoteOutcome;
  /** The model's own word, kept when the check moved `verdict` to `needs_human`. */
  verdict_before_quote_check?: Verdict["verdict"];
  quote_check_notes?: string[];
  /** Written by `verdict-verify`: the rows it could not confirm, with the reason and the effect. */
  quote_check_failures?: QuoteCheckFailureRow[];
  /**
   * WHAT WAS READ, WHAT WAS COVERED BY WHAT WAS READ, AND WHAT NOBODY OPENED — one row for every
   * same-kind line group of the candidate.
   *
   * Present only on a verdict whose candidate carries a `kinds` census. **Assembled by the CLI**
   * (`product/packages/cli/src/reading.ts`, `assembleReading`) from the census and what the seats
   * returned, and never written by a model: a seat says which representatives it opened and quoted,
   * and the CLI classifies every member of every kind from that. The shape is the schema's; this
   * type names the object so a consumer can reach it, and `verdict.schema.json` is the contract.
   */
  reading?: Record<string, unknown>;
  /**
   * WHAT THIS VERDICT RESTS ON, so a later run can tell an untouched question from a moved one with
   * no model (unit H; `ideas.md` section H names the block `rests_on`).
   *
   * **Written by the CLI's assembly step, never by a seat** — `product/packages/cli/src/rests-on.ts`
   * computes it from what the seat already recorded, because asking a model for a digest is asking
   * it to assert something it cannot compute. The shape is the schema's (`$defs.restsOn`), which is
   * the contract; this type names the object so a consumer can reach it.
   */
  rests_on?: Record<string, unknown>;
  /**
   * The scan this verdict was given in, present only on a verdict no seat read in THIS run.
   *
   * **Carried is not re-verified.** Its premises were re-derived and every one was reproduced
   * exactly, so it was carried rather than re-asked; nothing re-read the code, and the claim is only
   * that nothing the comparison can see has moved — the wording `reconcile-diff` fixed for `saved`.
   */
  carried_forward_from?: string;
  /** The re-check itself: which premises were re-derived, and how much was re-hashed and replayed. */
  carried_forward?: Record<string, unknown>;
}

/**
 * One rule that produced no candidate, and what was done about it.
 *
 * The four fields after `note` are the quote check's, written by `verdict-verify` and never by the
 * agent. An invalidated `construct_found` lands on `not_checked` here rather than on the silence
 * seat's own `undetermined`, which this enum does not carry — see the schema's own note on
 * `outcome_before_quote_check`.
 */
export interface UnknownRule {
  rule_id: string;
  outcome: "not_checked" | "construct_found" | "apparently_absent" | "not_evaluated" | "out_of_jurisdiction";
  searched?: string[];
  evidence?: Record<string, unknown>[];
  note?: string;
  quote_checks?: QuoteCheck[];
  quote_check_outcome?: VerdictQuoteOutcome;
  outcome_before_quote_check?: UnknownRule["outcome"];
  quote_check_notes?: string[];
}

/**
 * The shape a run was launched in, and the price the person was shown before they chose it.
 *
 * `preview` is COPIED from the scan document's `context_payloads.cost_preview`, verbatim, for the
 * reason `profile` is copied: the log is the audit record and must stand on its own, while
 * `findings.json` is overwritten by the next scan. It is a snapshot of what was shown, never a
 * recomputation — a recomputed figure would silently become the numbers of a later run.
 */
export interface EvidenceRunShape {
  shape: FindingsCostPreviewShape["shape"];
  /**
   * `user` where the person was asked and answered; `default` where the run could not ask and fell
   * back to `full`. The distinction is the point of the field: a shape nobody chose is not consent.
   */
  chosen_by: "user" | "default";
  /** The preview as the scan wrote it, copied from `context_payloads.cost_preview`. */
  preview?: FindingsCostPreview;
  /** Adjudicator launches this run actually made. Compare with `preview.shapes[].launches`. */
  launches_run?: number;
  /** True where the run shape had no second check (`refute_later`, recommended since 2026-10-07): no refuter ran. The name predates that decision. */
  refutation_deferred?: boolean;
}

/** One candidate this run did not adjudicate, and why. */
export interface UnadjudicatedCandidate {
  finding_id: string;
  /** `run_shape` where the chosen shape did not reach it; `budget` where a stated budget stopped. */
  reason: "run_shape" | "budget";
  /** The shape that did not reach it, where `reason` is `run_shape`. */
  shape?: FindingsCostPreviewShape["shape"];
  /** The order candidates were taken in, where one was stated. */
  ordering?: "severity";
}

/**
 * The auditable record of a scan: what was checked, decided, and on what evidence.
 *
 * **This interface is behind its own schema and has been for some time.** `coverage_limits`,
 * `files_not_read`, `files_partially_read` and `agent_effort` are all in
 * `evidence-log.schema.json` and not here. `unknown_rules` was added on 2026-09-17 because the quote
 * check reads it; the other four are left alone rather than half-typed, and the gap is recorded in
 * an internal record. The schema is the contract, as it is everywhere
 * else in this file.
 */
export interface EvidenceLog {
  scan_id: string;
  profile?: ScanProfile;
  bundle: { version: string; sha256?: string; signature?: "unsigned" | "not-verified" };
  candidates_total: number;
  unknown_rules?: UnknownRule[];
  /**
   * WHICH RUN SHAPE THE USER CHOSE, AND THE NUMBERS THEY WERE SHOWN WHEN THEY CHOSE IT (unit G,
   * 2026-09-22). A partial run must never read as a complete one, and the shape is the first thing
   * that makes it partial.
   */
  run_shape?: EvidenceRunShape;
  /**
   * EVERY CANDIDATE THIS RUN DID NOT ADJUDICATE, NAMED. Non-empty exactly where
   * `candidates_total` exceeds the verdict count for a reason the run chose, and the report's
   * `not-checked.md` (the WHAT WAS NOT ESTABLISHED section, in its own file of the report's five) must carry
   * the heading and the count whenever it is non-empty, and the first screen of `report.md` counts them.
   * Nothing is sampled: the ordering and the stop point are recorded and every skipped candidate is
   * named.
   */
  unadjudicated?: UnadjudicatedCandidate[];
  verdicts: Verdict[];
  suppressions?: { finding_id: string; reason: string; by?: string }[];
  /**
   * Candidates disposed of BEFORE dispatch, by the person's own declaration and by no reading of
   * the code — unit F of the layer-2 cost lane. One record per `finding_id`, never deleted and
   * never absent; see `evidence-log.schema.json` for why these are not `verdicts` and not
   * `suppressions`.
   */
  pre_settled?: {
    finding_id: string;
    rule_id: string;
    outcome: "not_applicable";
    /** `out_of_scope_by_answer`: a scope answer from the confirmed record settled the rule (`settled_by`). */
    ground: "out_of_jurisdiction" | "out_of_scope_by_answer";
    rule_jurisdiction: string[];
    declared_regions: string[];
    answered_from: string;
    because: string;
    locations?: number;
    settled_by?: { field: string; answer: unknown; recorded_at: string };
  }[];
  agent_model?: string;
  completed_at: string;
  server_signature?: { digest: string; sig: string; signed_at: string } | null;
  disclaimer?: string; // must state that the output is informational and not legal advice
}

/* ------------------------------------------------------------------------- *
 * Pillar 2 — declaration reconciliation
 *
 * Diffing what the developer published against what their code does. The
 * contracts below are one-to-one with checklist.schema.json,
 * reconcile-input.schema.json and declarations.schema.json, and follow the
 * same rule as everything above: the schema is authoritative.
 *
 * Two producers, two contracts. `ReconcileInput` is what the CLI settles
 * without judgement — documents, their text, code facts, overlaps.
 * `DeclarationsReport` is what the agent concludes from it. They are separate
 * files for the same reason findings.json and the evidence log are separate:
 * one can be regression-tested and the other cannot.
 * ------------------------------------------------------------------------- */

/**
 * The axis shared between the law and the code census. A checklist item names
 * the categories whose facts answer it, so the law decides what to look at.
 */
export type CensusCategory =
  | "recipients"
  | "transfers"
  | "retention"
  | "collection"
  | "distribution"
  | "commercial"
  | "provenance"
  /**
   * What the product is FOR — the use case, not the data. Added 2026-08-04 for AI Act Annex III,
   * whose areas are purposes ("recruitment or selection of natural persons", "evaluate
   * creditworthiness") rather than kinds of data or kinds of recipient.
   *
   * It is a separate axis rather than a reuse of `collection` on purpose: an item that names
   * `collection` asks what data is gathered, and quietly handing it purpose facts would answer a
   * question it did not ask. **A purpose fact never decides a purpose** — the answer comes from
   * the person (`features.annex_iii_use`) and from what they publish; this category exists so a
   * gate can corroborate or contradict that answer, and say which it is doing.
   */
  | "purpose";

/**
 * One thing a privacy notice must contain, in the same shape as a rule's
 * `legal_basis`: the statutory words, where they come from, and the question
 * to ask of the document.
 */
export interface ChecklistItem {
  id: string;
  article: string;
  /** The requirement in the instrument's own words, quoted from the source at `url`. */
  quote: string;
  cite: string;
  url?: string;
  checked_at: string;
  /** What to ask of the document. Never phrased as a conclusion about legality. */
  question: string;
  /** Census categories whose facts bear on this item; empty where the item is document-only. */
  census_categories?: CensusCategory[];
  /** Where the item's applicability is itself in question, rather than its answer. */
  applicability_note?: string;
  /** Which answer is the problem. Default `absent`; `present` for items that look for a prohibited thing. */
  finding_when?: "absent" | "present";
}

/**
 * Whether an instrument reaches the scanned project at all, asked once for a whole checklist.
 *
 * Present because most of the instruments this pillar walks bind a named kind of provider, and
 * walking a list of requirements at a project the law does not reach produces a wrong answer for
 * every item rather than one. `when_unresolved` is mandatory: the gate must never resolve to a
 * guess in either direction.
 */
export interface ChecklistApplicability {
  question: string;
  quote: string;
  cite: string;
  url?: string;
  checked_at: string;
  census_categories?: CensusCategory[];
  /**
   * Further provisions the gate turns on, each quoted verbatim and each verified against its own
   * source. A scope test is rarely one sentence: the DSA gate needs the Scope article, the
   * definition of the service it scopes, and the definition that one refers to — in another act.
   */
  supporting_quotes?: {
    quote: string;
    cite: string;
    url?: string;
    checked_at: string;
    why?: string;
  }[];
  /** True where only the person running the scan can answer — establishment, headcount. */
  ask_the_user?: boolean;
  /**
   * The gate's requirements, one entry each. Added 2026-07-29 because every gate defect found
   * that day lived in the prose, and four of them were one fact written in two places that then
   * disagreed. Optional while the nine checklists convert one at a time.
   */
  limbs?: ChecklistLimb[];
  when_unresolved: string;
}

/** One condition the scope provision imposes, asked on its own. */
export interface ChecklistLimb {
  id: string;
  question: string;
  decided_by: "code" | "documents" | "premise" | "ask" | "either";
  quote_ref: string[];
  evidence_categories?: CensusCategory[];
  /**
   * `true` — answering yes puts the project outside. `false` — the limb must be true for the
   * instrument to reach. `never` — the answer annotates and cannot change the verdict, which is
   * how the owner's 2026-07-29 decision about the addressee limbs is written in data.
   */
  closes_gate_when?: "true" | "false" | "never";
  /**
   * Census fact kinds bearing on this limb. `evidence_categories` is too coarse to decide on:
   * `marked_not_published` and `publishable_package` are both `distribution` and point opposite
   * ways. A limb with no `code_evidence` is one the code does not settle.
   *
   * **This is the set that SETTLES the limb, and it is not the set that contradicts a
   * declaration** — see `declared_by`. The two are different questions and the evaluator ran them
   * as one until 2026-07-30.
   */
  code_evidence?: { supports?: string[]; opposes?: string[]; neutral?: string[] };
  /**
   * Dotted path into the ScanProfile whose value settles this limb — the answer the person running
   * the scan already gave, e.g. `features.payments.present`. Added 2026-07-29 on the owner's
   * observation that a question about the business is cheaper to ask than to infer.
   *
   * **What a declaration does to a verdict is stated in one place and is deliberately not restated
   * here: `product/packages/cli/src/scope.ts` § THE DECLARATION PATH.** Read it there. This comment
   * carried a copy of the rule and went stale twice, on 2026-07-30 and again on 2026-08-03, both
   * times in the same three files at once — here, `checklist.schema.json` and
   * `reconcile-input.schema.json` — because the behaviour changed and the copies did not.
   * A test now fails if the rule is restated in this file.
   */
  declared_by?: string;
  /**
   * Which values of the `declared_by` field answer this limb's question; required wherever `declared_by` is
   * (`checklist.schema.json`). A value not listed is no answer to the limb.
   */
  declared_answers?: boolean[];
  note?: string;
}

/** One declared collected data type in a store declaration, in the store's own taxonomy. */
export interface StoreCollectedType {
  type: string;
  label?: string;
  linked?: boolean;
  tracking?: boolean;
  purposes: { id: string; label?: string }[];
  categories: CensusCategory[];
}

/** A store declaration found in the tree, parsed deterministically (coverage row A14, store half). */
export interface StoreDeclaration {
  file: string;
  format: "apple-xcprivacy" | "play-data-safety-csv";
  tracking?: boolean;
  tracking_domains: string[];
  collected: StoreCollectedType[];
  accessed_api_types: { type: string; reasons: string[] }[];
  /** Play CSV only: raw rows. Column meanings are deliberately not interpreted by this layer. */
  rows?: string[][];
  /** What could not be understood in THIS file. Usable as "look at this one". */
  problems: string[];
  /**
   * Decisions true of every file of the kind, which say nothing about this one. Split out of
   * `problems` on 2026-07-28: a note emitted on every Play CSV made `problems.length > 0` useless.
   */
  notes: string[];
}

export interface Checklist {
  checklist_id: string;
  title: string;
  law: string;
  source_url: string;
  checked_at: string;
  scope_note: string;
  items: ChecklistItem[];
  applicability?: ChecklistApplicability;
}

/**
 * How a declaration was reached. `glob`, `sibling` and `url` all start from a name;
 * `content` starts from what the file says and is the only route that survives a
 * repository whose legal documents are called something nobody would guess.
 */
export type FoundBy = "glob" | "sibling" | "explicit" | "url" | "content";

export interface DiscoveredDoc {
  path: string;
  kind: "file" | "url";
  found_by: FoundBy;
  matched_glob?: string;
  sibling_of?: string;
  /** The phrases that identified this file as a legal document, when `found_by` is `content`. */
  markers?: string[];
  /**
   * The declaration glob this document's own NAME matches, whatever route reached it.
   *
   * **Different from `matched_glob`, which says the document was FOUND BY that glob.** Added
   * 2026-09-02 (a gap found in one real run): that tree's real Terms and Privacy Policy for its paid
   * hosted tier are two route files, `terms.ts` and `privacy.ts` — names that
   * match `**\/terms*` and `**\/privacy*` exactly — and the name passes never tested them, because
   * `ts` was not one of the extensions those passes then considered. The content pass found both
   * correctly, they arrived carrying no name signal at all, and they were read past at lines 120 and
   * 121 of a 165-line listing whose other 108 rows were near-identical translation catalogues; the
   * run then told six of seven subagents that no terms-of-service document existed in the repository.
   * **The extension restriction itself was removed later the same day**, so those two are now found
   * by NAME; this field still carries the name shape of every document another pass reaches.
   *
   * This field is what lets a consumer sort the list by "how likely is this the document that
   * decides the run". It changes nothing about which documents are found or by which pass.
   */
  name_shape_glob?: string;
  /**
   * Which document kinds this document's NAME makes it a candidate for, derived from
   * `matched_glob ?? name_shape_glob` by `reconcile.ts`'s `nameShapeKinds`. Present only where the
   * name settles at least one kind.
   *
   * **A candidate, never an identification.** Discovery classifies nothing and neither does this: it
   * is a statement about the name, which is why the field that carries it says `name_shape`.
   */
  name_shape_kinds?: DocumentNameShapeKind[];
  /**
   * A store-metadata POINTER: a file whose whole content is one URL naming a document published
   * outside the repository.
   *
   * **A different kind of thing from every other document in this array, and it was being read as
   * the same kind.** `fastlane/metadata_bwpm_prod/default/privacy_url.txt` holds exactly
   * a link to a privacy page — about 30 characters, one line. Discovery found both of
   * that tree's copies correctly and offered them as candidate declarations, so the run's own
   * thin-document warning fired on them, and a reader had to work out from the content that these
   * are not thin privacy policies but complete, correct pointers AT one. The tree's premise for that
   * run was written as "this repository carries no privacy policy"; it does not carry the PROSE, and
   * it states twice, affirmatively, where the prose is published. (Hole #2 of the run of
   * 2026-09-03.)
   *
   * What this field is for: **a URL-route run can consume it.** `--policy <url>` is the flag that
   * fetches a published page, and a run that wants to reconcile against the real policy no longer
   * has to have a person notice one line in a sixty-document listing.
   *
   * **It adds nothing to the document set and removes nothing from it.** The file is still
   * discovered, still extracted, still listed. This says what it is.
   */
  url_pointer?: {
    /** The URL the file names, exactly as written. */
    url: string;
    /**
     * The store-metadata convention the filename belongs to (`privacy_url`, `support_url`,
     * `marketing_url`), or `bare-url-file` where the name is not one of those but the file is
     * nonetheless a single URL and nothing else.
     */
    convention: string;
  };
}

/**
 * What the content pass measured about a file that cleared the marker threshold, and which of the
 * three confirming paths decided it was a document rather than a file that mentions legal phrases.
 *
 * **Why this exists** (2026-09-02, a gap found in one real run). The marker threshold alone asks
 * "does this file contain three legal phrases", which every translation catalogue in a localised
 * application answers yes to: one tree's fourteen `.xlf` files, 8,196–9,058 lines each, cleared it
 * on the UI labels `Privacy Policy`, `Terms and Conditions`, `per User` and one sentence containing
 * `we share`, and were reported as fourteen candidate declarations to be read in full.
 *
 * **The repair is a confirming clause beside the threshold, never a narrower threshold and never an
 * extension exclusion** (subtraction is the only operation that can create a miss). A file
 * has to clear the threshold AND be document-shaped, where document-shaped has three independent
 * routes and any one is enough — a file that is mostly sentences, a file whose markers all sit
 * beside sentences, or a file short enough that reading it costs nothing. Measured over the
 * fourteen `.xlf` files and five real documents: `prose_char_ratio` is 0.024–0.049 on the
 * catalogues and 0.455–0.930 on the documents, an order of magnitude apart on either side of the
 * threshold.
 *
 * **What a screened file is NOT.** It is not dropped and it is not invisible: it is named, with
 * these numbers and its markers, in `content_scan.screened[]`, and `--policy <path>` puts it back
 * into the run as an explicitly supplied document. "We looked at this and it did not read like a
 * document" is a statement about the reading, and it is written down.
 */
export interface ContentShape {
  /** Lines in the file. */
  lines: number;
  /**
   * Characters of prose divided by characters in the file. A prose line is one that, with markup
   * tags removed, is at least 40 characters long and holds at least 8 words — a sentence rather
   * than a label, a key, a tag or a record separator — or, in a script that does not separate words
   * with spaces, a dense enough run of its characters.
   *
   * **From 2026-09-02 a prose line that is a CATALOGUE RECORD does not count towards the numerator**
   * (a third gap of one real run): `"site.notice": "…a full sentence…"`, `msgstr "…"`,
   * `<source>…</source>`, or a whole minified object of such pairs, is a record whatever its value
   * says, and a file made of them is a record set. The denominator is untouched, so a real
   * document's ratio does not move — measured on one tree, every declaration's ratio is identical to
   * three decimals and every locale catalogue's falls from 0.19–0.99 to 0.00.
   *
   * **The discount is confined to this field.** The neighbourhood and passage routes read the
   * undiscounted prose lines, which is what keeps a policy kept INSIDE a message catalogue — a case
   * this project has built a fixture for and has not yet observed in a scanned repository — and what keeps the space-less-script repair of the same day
   * intact.
   */
  prose_char_ratio: number;
  /**
   * Sentence-length lines that are a key and a quoted value and nothing else, and therefore do not
   * count towards `prose_char_ratio`. Emitted so the ratio can be disputed from the record: a
   * catalogue of full sentences reports hundreds of these beside a ratio near zero, and a real
   * document reports none.
   *
   * **Optional in the schema and emitted on every run from 2026-09-02**: absent means the document
   * predates the record-shape discount, which is not the same as a file measured and found to hold
   * no records.
   */
  record_value_lines?: number;
  /** Markers whose line has a prose line within ten lines either side of it. */
  markers_with_prose_nearby: number;
  /** Markers this file matched, which is what `markers_with_prose_nearby` is out of. */
  markers_matched: number;
  /** Whether at least one confirming route held. */
  document_shaped: boolean;
  /** Which route decided it, or why none did, in words a reader can act on. */
  reason: string;
}

/** A file the content scan judged to be a legal document, with the phrases that decided it. */
export interface ContentMatch {
  file: string;
  /**
   * The phrases that matched. **Empty where the file was screened before it was read for phrases at
   * all** — a file whose bytes are not text carries no markers and is not silent about why.
   */
  markers: string[];
  /**
   * What the document-shape test measured. **Optional in the schema and emitted on every run from
   * 2026-09-02**: absent means either that the document was produced before the content pass had a
   * shape test, or that no shape was measured because the file was screened for readability — in
   * which case `screened_reason` says so. Neither is the same statement as a file that was measured
   * and found shapeless.
   */
  shape?: ContentShape;
  /**
   * Why a file was screened when no `shape` was measured, in words a reader can act on.
   *
   * It carries **one of three different statements, and they must not be read as one** (corrected
   * 2026-09-03): the bytes were read and hold a NUL, so the file is not text; the walker refused the
   * file for its EXTENSION and never opened it, so nothing here says anything about its bytes; or the
   * file is over the walker's size ceiling and was not read, which usually means readable text that
   * this run does not have. Added 2026-09-02 with the ruling that a file extension is
   * meaningless as evidence of whether something is a declaration ("the extension does not matter"), which made
   * the name passes extension-agnostic — `privacy.png` and `privacy.pdf` now match `**\/privacy*`
   * like any other file, and what is left is only whether this tool read them. None of the three is a
   * statement about what the file IS, which is why each is written down rather than acted on
   * silently, and `--policy <path>` still reads the file as a supplied document.
   */
  screened_reason?: string;
  /**
   * The same decision in two or three words, for a listing: `not text`, `not read (binary extension —
   * the bytes were never opened)`, `not read (over the size ceiling)`.
   *
   * Present only where `screened_reason` is. It exists so a console line and the JSON cannot come to
   * describe one refusal differently — the first version of the console printed `not text` for all
   * three, which stated a byte fact about a decision taken from a name (F3 of the 2026-09-03
   * verification).
   */
  screened_label?: string;
}

export interface ReferencingFile {
  file: string;
  line: number;
  key: string;
  document: string;
  line_text: string;
  /**
   * True when this reference sits in a file the content pass screened (a translation catalogue, a
   * record set). Present only when true. A screened file pointing AT a real document is a genuine
   * reference and is surfaced, not withheld; the flag lets a consumer weigh it, since a translated
   * link label is a weaker signal than a version log recording a practice the policy omits.
   */
  from_screened_file?: boolean;
  /**
   * True when this reference sits in a file that is itself one of the discovered documents. Present
   * only when true.
   *
   * **Added 2026-09-02 with the extension-agnostic name passes.** The rule has always been "a
   * document is not a reference to itself", and until that date it was implemented as "a document is
   * not a reference at all" — so a page component naming the markdown asset it renders, or a version
   * log inside `legal/` naming the policy whose changes it records, lost its reference row the moment
   * the file itself qualified as a document. Only the self-row is dropped now. The flag is here so a
   * consumer can tell a cross-reference between two declarations from a pointer out of ordinary
   * source, which are different kinds of evidence.
   */
  from_discovered_document?: boolean;
}

/** Why the sibling pass did not add a neighbour it reached. Never a silent drop. */
export type SiblingNotAddedReason = "over-the-per-directory-limit" | "not-a-declaration-neighbourhood";

export interface SiblingExpansion {
  root: string;
  from: string;
  added: number;
  dropped_over_limit: number;
  /**
   * The numbers the neighbourhood test was decided on, added 2026-09-02 (a second gap of one real run).
   *
   * The pass used to expand any non-root directory holding one glob hit, and on one tree that read
   * `readme/dev/` — the project's internal developer documentation — as a neighbourhood of legal
   * pages and swept in 50 build guides and technical specifications from the single correct hit
   * `readme/dev/accessibility.md`. The existing guard against exactly that shape only fires at the
   * repository root, and `readme/` in that repository is functionally a second root.
   *
   * `neighbourhood_confirmed` says whether the root held at least two declaration-NAMED candidates
   * AND they were at least a quarter of the candidates under it. Where it is false, the WHOLESALE
   * SWEEP is declined and nothing else is: a neighbour is still added when it is a router-role file
   * (`page.tsx` and its family, whose text is routinely in an imported component that no content
   * test can see), when its own name is a declaration's name, or when it carries a legal phrase
   * inside something that reads like a document. Every other neighbour is named in `not_added`.
   * That last route was added after the run-2 verification demonstrated a genuine cookie notice —
   * fewer than the content pass's three markers, in a directory scoring 1 of 22 — reaching the found
   * set by no route at all.
   *
   * Optional: absent means a document written before the neighbourhood test existed.
   */
  candidates_under_root?: number;
  declaration_named_under_root?: number;
  neighbourhood_confirmed?: boolean;
  /**
   * Every neighbour this pass reached and did not add, NAMED with its reason.
   *
   * `dropped_over_limit` has been a count since this pass was written, and a count is not a record:
   * on one tree 105 files were dropped over the limit and the output said only "105". A declined
   * neighbour is still read by the content pass, which reads every walked file whatever it is
   * called, and `--policy <path>` still reads any of them in full as a supplied document — but which
   * files those were has to be legible, on the same principle as `excluded_by_walker` and
   * `content_scan.screened`.
   */
  not_added?: { file: string; reason: SiblingNotAddedReason }[];
}

/** What discovery found, and what it searched — the second half is not optional. */
export interface DiscoveryResult {
  found: DiscoveredDoc[];
  referencing_files: ReferencingFile[];
  looked_at: {
    globs: string[];
    /**
     * The conventional document formats, reported as a COST LABEL and consulted by nothing.
     *
     * **Until 2026-09-02 this list bounded the name passes**, and the ruling of that date
     * removed it from every place an extension acted as a judgement: a file whose name matches a
     * declaration glob is a candidate whatever it is called after the last dot. What it survives as
     * is display and cost — this list, the count below, and the console's cluster keys — plus a
     * physical-readability filter, which is a statement about bytes and not about meaning.
     */
    extensions: string[];
    files_walked: number;
    /**
     * How many paths the name passes tested — every walked file, since 2026-09-02.
     *
     * **This is the number that says what the name search reached**, and it replaces
     * `files_with_declaration_extension` in that role. Optional in the schema so an input written
     * before that date still validates; emitted on every run from 2026-09-02.
     */
    files_tested_by_name?: number;
    /**
     * How many walked files carry one of the conventional document extensions. **A format statistic,
     * and no longer the reach of the name search** — see `files_tested_by_name` for that. Kept
     * because the format mix of a tree is worth seeing, and because removing a required field breaks
     * every reader of an existing input pack.
     */
    files_with_declaration_extension: number;
    sibling_expansions: SiblingExpansion[];
    reference_keys: string[];
    unreadable: { file: string; error: string }[];
    /**
     * The name-independent pass: how many files were read for content, how many
     * distinct legal-document phrases made one a candidate, and which files
     * cleared that bar. Reported so that "nothing was found" can be read as
     * "N files were read and none said anything a legal document says".
     */
    content_scan: {
      files_read: number;
      marker_threshold: number;
      matched: ContentMatch[];
      /**
       * Every file discovery reached and did not offer as a candidate declaration, with the reason.
       *
       * **Two populations, one list.** A file that cleared the marker threshold and did not read like
       * a document carries its phrases and the numbers that decided it in `shape`. A file that could
       * not be read as text at all — since 2026-09-02, when the name passes stopped consulting the
       * extension, a name match like `privacy.png` can reach this point — carries `screened_reason`
       * and no shape, because nothing about its content was measured.
       *
       * **This list is the whole of what makes either screen an addition rather than a subtraction.**
       * A screened file is named here, so a reader can see that it was reached, what it said, and why
       * it was not offered — and `--policy <path>` puts any of them back into the run as an
       * explicitly supplied document, which is the recovery path a hard extension exclusion would not
       * have.
       *
       * **Optional in the schema and emitted on every run from 2026-09-02**, empty list included:
       * absent means the document predates the shape test, which is not the same as a run in which
       * nothing was screened.
       */
      screened?: ContentMatch[];
    };
  };
}

/** Discovery plus what the run itself could not obtain. */
export interface DiscoveryReport extends DiscoveryResult {
  /** A URL that could not be retrieved. Reported so it is not read as "no policy". */
  fetch_failures: { url: string; error: string }[];
  unextractable: { path: string; reason: string }[];
}

export interface ExtractedLine {
  line: number;
  text: string;
}

export type ExtractorKind = "tsx" | "markdown" | "html" | "text";

/** A declaration's readable text, with the line numbers a quotation will cite. */
export interface ExtractedDoc {
  doc_path: string;
  kind: "file" | "url";
  extractor: ExtractorKind;
  sha256: string;
  read_at: string;
  fetched_at?: string;
  bytes: number;
  lines: ExtractedLine[];
  stats: { source_lines: number; text_lines: number; characters: number };
  /**
   * What a reader has to know about THIS extraction, in words, present only when there is something
   * to say.
   *
   * Added 2026-09-02 with the extension-agnostic name passes. A document is now reached by its name
   * whatever format it is in, so the extractor that runs on it can be the fallback one, and the
   * failure mode that matters is an extraction that produced NOTHING out of a file that plainly has
   * content — a masker meeting a shape it was not written for. The document is still emitted, with
   * its digest and its byte count, and this field says what happened; an empty `lines[]` beside no
   * explanation is the silent absence this product is organised against.
   */
  notes?: string[];
}

export interface CensusCallSite {
  file: string;
  line: number;
  line_text: string;
}

/**
 * One thing the code does. A fact, not a suspicion: whether it involves
 * personal data, and whether the declaration covers it, are layer-2 questions.
 */
export interface CensusFact {
  fact_id: string;
  collector: string;
  kind: string;
  categories: CensusCategory[];
  value: string;
  file: string;
  line: number;
  line_text: string;
  /** Environment variables on the same line: a gated path is a conditional, not a fact. */
  depends_on_runtime_config: string[];
  call_sites?: CensusCallSite[];
  pillar1_overlaps?: Pillar1Overlap[];
}

/**
 * A package that is declared and never imported. Not a fact and not a
 * recipient — reporting one as a recipient of personal data is a false
 * statement about a real company — but recorded, because "we looked and found
 * no call site" is a different thing from silence.
 *
 * **It is not evidence that the vendor receives nothing.** An application can
 * carry a vendor's SDK in `package.json`, never import it, and still call that
 * vendor over plain HTTP from somewhere else — which is exactly what the first
 * agent run found for one AI provider. This list answers "is this package the
 * route?", never "is this company a recipient?".
 */
export interface DeclaredOnlyDependency {
  package: string;
  version: string;
  declared_in: string;
  /** Present where lines that could hold this package's call site were not read: see `CallSitesNotRead`. */
  call_sites_not_read?: CallSitesNotRead;
}

/**
 * Where a call site could be and was not read. An entry that claims no call site (`declared_only`, an entry
 * of `declared_only_dependencies`) carries this where the census did not read every line a call site could be on: the
 * import pass reads every readable file, so a line past the line ceiling anywhere in the tree (named in
 * `files_long_lines_not_read`), a file the per-file budget stopped before its import pass ended (named in
 * `files_stopped_for_time`) or a file that could not be read leaves the absence UNKNOWN: no call site was found in what
 * was read, and whether the package is imported is not known. Absent where every such line was read.
 */
export interface CallSitesNotRead {
  /** Lines past the line ceiling, emptied before the import pass, in files it read. */
  lines_past_ceiling: number;
  /** Files not read to their end by the import pass: holding those lines, stopped for time before it ended, or not readable. */
  files: number;
}

/**
 * The four map-shaped blocks of a `package.json` the census reads a declaration from.
 *
 * **`bundledDependencies` is deliberately absent, and it is not an oversight.** It is an ARRAY OF
 * NAMES, not a name-to-version map, so reading it as one recreates defect D7 exactly — `dependencies`
 * held a string once and produced six packages named `0`…`5` at versions `s`,`t`,`r`,`i`,`p`,`e`,
 * each carrying `declared_only`, the one marker in this file whose job is to prevent a false
 * accusation. Its members are also required by npm to be declared in one of the four blocks below,
 * so nothing it names is lost by not reading it.
 */
export type DependencyManifestBlock =
  | "dependencies"
  | "optionalDependencies"
  | "devDependencies"
  | "peerDependencies"
  // The Swift/Apple blocks, added 2026-09-03. Three DIRECT populations — what a developer wrote —
  // and two RESOLVED ones, which are a resolver's output over the whole transitive graph.
  //
  // The distinction is load-bearing and is not decoration. `declared_only_dependencies` and the
  // `facts` dependency rows are drawn from the direct blocks only, for the reason
  // `devDependencies` is excluded from them: "declared and imported from nowhere" is the ORDINARY
  // state of a transitive pin (`nanopb`, `leveldb`, `abseil-cpp-binary` in one real iOS tree), and
  // publishing that sentence about each of them would turn the anti-false-accusation half of this
  // record into a machine for making false statements about a developer's code.
  | "spm-dependencies"
  | "spm-resolved"
  | "pods"
  | "pods-resolved"
  | "xcodegen-packages";

/**
 * Which manifest family a declaration was read from.
 *
 * **A label on the record, never an input to any judgement.** It exists because an empty inventory
 * has to be readable as a statement about the formats that were parsed — the failure the third real
 * pillar-2 run measured, where a pure Swift/SwiftPM tree produced `dependency_inventory: []` and a
 * reader had no way to tell that from a product that declares nothing.
 */
export type DependencyEcosystem = "npm" | "swiftpm" | "cocoapods";

/** One manifest's statement about one package: the version it names, and the line it names it on. */
export interface DependencyDeclaration {
  /** The manifest, relative to the scan target. */
  file: string;
  /** The line the package's key is written on, 1-based. 1 where the manifest is one line. */
  line: number;
  /** The version range **as declared**. Not resolved, not normalised, not compared to anything. */
  version: string;
  /**
   * **Which block of that manifest declares it.** Owner ruling, 2026-08-28: the inventory reads all
   * four blocks, and every declaration says which one it came from.
   *
   * A package declared in two blocks carries TWO entries here, one per block, each with that block's
   * own line and its own version — which is the ordinary shape of a tool that is both a runtime
   * dependency of the product and a build-time dependency of one workspace. Without this field the
   * two would be indistinguishable, and a reader would have no way to tell a payment SDK from a test
   * runner in an array that now carries both.
   *
   * **It is a fact about the manifest, and it is not a verdict about the package.** A
   * `devDependencies` entry is not "safe" and a `dependencies` entry is not "in production": what a
   * dev-time package does with data happens at build or CI time, which is a different moment, not an
   * absent one.
   */
  field: DependencyManifestBlock;
  /**
   * Which manifest family this declaration came from. Always written, on every declaration
   * including an npm one — a label that appeared only on the new branches could not be told apart
   * from a producer that stopped writing it, which is the reason `declared_only` is unconditional.
   */
  ecosystem: DependencyEcosystem;
}

/** A call site, reduced to what a reader needs to open it. No text — see `DependencyInventoryEntry`. */
export interface DependencyCallSite {
  file: string;
  line: number;
}

/**
 * A manifest the census opened and could take no declaration from.
 *
 * Two reasons, and they are different failures: `parse-failed` is a `package.json` that is not
 * JSON as this runtime reads it (a UTF-8 BOM, a trailing comma, a truncated file), and
 * `block-not-an-object` is a manifest one of whose four dependency blocks holds a string, a number
 * or an array where a name-to-version map belongs. The second is invalid npm; both used to produce
 * an empty inventory with nothing anywhere recording why.
 *
 * **The type guard is per block, and the record names the block.** One malformed `devDependencies`
 * costs its own block and nothing else: the packages the same manifest declares in `dependencies`
 * are read, published and counted exactly as they would have been, and one row here says which
 * block was refused. A guard that gave up on the whole manifest would let one bad block delete a
 * healthy one's packages, which is the direction that produces silence.
 */
/**
 * A file the census stopped reading because the file's time budget was spent: the census's own
 * pass, which reads every file a second time with its own clock. What it raised before the stop stays.
 */
export interface CensusStoppedFile {
  file: string;
  /** Where it stopped: `binary-check`, `long-line-ceiling`, `line-split`, `probe:<kind>`, `swift-manifests`, `package-manifest`, `comment-blanking`, `imports`, `collector:<name>` or `request-construct`. */
  stage: string;
  budget_ms: number;
  elapsed_ms: number;
  /** For a stage that reads line by line: the lines it read before the stop, and the file's lines. */
  lines_read?: number;
  lines_total?: number;
}

/**
 * A file the census read without some of its lines because each was longer than the line ceiling.
 *
 * The census reads every file through the engine's own ceiling (`blankLongLines` in the CLI's walker, the
 * `MINIFIED_LINE_LIMIT` of 5,000 characters on a line ended by a line feed), so that no pattern is ever handed a
 * line longer than that: a held census pattern costs the square of its line, and one line of a megabyte (a file of
 * lone carriage returns, or of U+2028, is one such line) was one unit of the census's work past any time budget.
 * Each line named here was emptied in place, as the engine empties it, and the census raised nothing from it. In a
 * scan the engine names the same lines in `files_partially_read` (or the file in `files_not_read`), since both passes
 * apply the one function to the same text; `reconcile` runs the census alone, so the census names them itself.
 */
export interface CensusLongLinesFile {
  file: string;
  /** The ceiling the lines exceeded, in characters. */
  threshold: number;
  /** Every line not read, 1-based as in the file, with the characters it held. */
  lines: { line: number; length: number }[];
}

export interface ManifestNotUsable {
  /** Path relative to the scan root, exactly as the walker produced it. */
  file: string;
  /**
   * `no-dependency-block` was added 2026-09-03 with the SwiftPM readers: a `Package.resolved` that
   * parses as JSON and carries no `pins` array in either the v1 (`object.pins`) or the v2/v3 (`pins`)
   * position is a manifest this census opened and took nothing from, which is a different sentence
   * from a tree with no lockfile — the same distinction the other two reasons exist to keep.
   */
  reason: "parse-failed" | "block-not-an-object" | "no-dependency-block";
  /** What the runtime said, or which block held what shape. Cut at 300 characters. */
  detail: string;
}

/**
 * One declared dependency, as the manifest and the tree state it.
 *
 * **FACTS ONLY, AND THE ABSENCES ARE FACTS TOO.** There is no severity here, no confidence, no
 * vendor classification beyond the name the manifest itself writes, and no field that says a
 * finding is real. That is the same reasoning `SKILL.md` step 4 gives for withholding `severity`
 * and `rule_confidence` from an adjudicator — a producer's opinion, handed over before the file is
 * opened, anchors the judgement it was meant to inform — applied one layer earlier, to a producer
 * that has no opinion to give: a manifest line and an import line are things a reader confirms in
 * one second, and everything that could be concluded from them is somebody else's to conclude.
 *
 * **What an entry does NOT establish**, stated here because the schema is where a consumer looks:
 *
 * - A DECLARATION IS NOT A TRANSFER. `@sendgrid/mail` in a manifest is a package that was installed.
 *   It is not evidence that SendGrid received anything, and reporting it as a recipient of personal
 *   data would be a false statement about a real company — the reason `declared_only_dependencies`
 *   exists at all.
 * - THE ABSENCE OF A CALL SITE IS NOT THE ABSENCE OF USE. `call_site_count: 0` means no import
 *   specifier naming this package was found in a file the walker offered and the census reads. A
 *   dynamic import built from a variable, a binary invoked from a shell script, a plugin loaded by
 *   name from configuration and a call made over plain HTTP to the same vendor all evade it.
 * - THE INVENTORY IS NOT THE TREE'S DEPENDENCIES. It is what a `package.json` declares in its
 *   `dependencies`, `optionalDependencies`, `devDependencies` and `peerDependencies` blocks — those
 *   four, each declaration labelled with `field` — and nothing else: a `pyproject.toml`, `go.mod`,
 *   `composer.json`, `Cargo.toml`, `mix.exs` or `.csproj` contributes nothing, and neither does
 *   `bundledDependencies`, which is an array of names rather than a declaration map and whose
 *   members npm requires to be declared in one of the four anyway. An empty inventory is a
 *   statement about those four blocks of npm manifests and never about the product.
 *
 * **The population widened on 2026-08-28,.** Until that day it was the two
 * runtime blocks only, so an analytics SDK in `devDependencies` and a payment SDK in
 * `peerDependencies` — both ordinary manifest shapes — reached no reader at all. What the widening
 * does NOT do is move `field` into the judgement: a dev-time package's data flows happen at build or
 * CI time, which is a different moment from the product's runtime and not an absent one.
 */
export interface DependencyInventoryEntry {
  /** The package name, exactly as the manifest writes it. */
  package: string;
  /**
   * Every declaration of this package, in walk order: **one entry per manifest AND per block.**
   *
   * More than one in a monorepo, and they can name different versions — which is why this is a list
   * and not a single version string. Since the widening of 2026-08-28 a second entry is also what
   * ONE manifest declaring the package in two blocks produces, so the length of this array is a
   * count of declarations and never a count of files; `field` says which block each came from, and
   * the number of distinct `file` values is the number of manifests.
   */
  declared: DependencyDeclaration[];
  /**
   * Call sites found, **exact**. Counted before `call_sites` is truncated, so a reader comparing the
   * two lengths is reading the example cap and never a smaller census.
   */
  call_site_count: number;
  /**
   * `true` where `call_site_count` is 0: declared, and imported from nowhere the census can see.
   *
   * Written on every entry rather than only where it is true. `call_site_count: 0` says the same
   * thing, and a marker present on one branch only cannot be told apart from a producer that
   * stopped writing it — the reason `suppressed_by_corroboration` and `files_not_read` are emitted
   * empty rather than omitted.
   *
   * **READ IT BESIDE `declared[].field`, ALWAYS.** Since 2026-09-03 this inventory also carries
   * RESOLVED declarations — `spm-resolved` (`Package.resolved`) and `pods-resolved`
   * (`Podfile.lock`) — which are a resolver's output over the whole TRANSITIVE graph, and for most
   * of a transitive graph "declared and imported from nowhere" is the ORDINARY state rather than an
   * observation: 15 of one iOS tree's 21 rows and all 39 of another's are transitive C
   * and support libraries the application never names. `declared_only_dependencies` and the `facts`
   * dependency rows are drawn from the DIRECT blocks only for exactly that reason, and this boolean
   * is the one place the resolved rows still carry the sentence. It is a fact about call sites, not
   * an accusation about a package: a consumer that reports "declared and unused" from this field
   * without filtering on `field` will publish that sentence about packages nobody claimed to import.
   * (Independent verification, 2026-09-03, LOW 7.)
   */
  declared_only: boolean;
  /**
   * Present only where `declared_only` is true and lines that could hold a call site were not read: the
   * absence is then NOT KNOWN, and a reader says "not read", never "not imported". See `CallSitesNotRead`.
   */
  call_sites_not_read?: CallSitesNotRead;
  /**
   * Up to N call sites, file and line only, absent when there are none.
   *
   * **No `line_text`, deliberately.** Measured 2026-08-28 over the eight pinned pass-1 trees:
   * carrying the text costs 90,250 B against 66,036 B, 1.37x, for a line the reader can open, and
   * layer 2 runs in the user's agent and the user pays for every byte.
   * `CensusFact.call_sites` still carries text and is unchanged. N is 3; the two curves that set it
   * are in `census.ts` `INVENTORY_CALL_SITE_EXAMPLES`.
   */
  call_sites?: DependencyCallSite[];
}

/**
 * One file whose outbound-host rows have no request construct anywhere in it.
 *
 * Grouped per file rather than per row because the file is the unit a reader judges: "one hundred
 * and forty hostnames, all of them in a marketing comparison table" is one decision, and a hundred
 * and forty rows saying it separately is not. `fact_ids` is carried so that a
 * `ScopeEvidence.fact_id` in an `applicability[]` limb joins straight to this entry; the values
 * themselves are not repeated here, because `facts` already holds them and a second copy of a list
 * two places must agree on is the defect class this repository has recorded three times.
 */
export interface OutboundHostFileWithoutRequestConstruct {
  file: string;
  /** Outbound-host rows this file contributed. */
  facts: number;
  /** Distinct hostnames among them. */
  distinct_values: number;
  /** Every row's `fact_id`, sorted, so a supporting-fact reference resolves without a scan. */
  fact_ids: string[];
  /**
   * Whether the path reads as a test, spec, mock or fixture file. Recorded separately because a
   * hostname in a unit test's fixture data is a different kind of non-recipient from a hostname in
   * a static product-comparison list, and a reader weighs them differently.
   */
  test_or_fixture_file: boolean;
  /**
   * Lines of this file past the line ceiling, not read by the request-construct pass: "no request construct
   * anywhere in the file" is then not known for them. The lines are named in `files_long_lines_not_read`. Absent at 0.
   */
  long_lines_not_read?: number;
}

export interface CensusResult {
  facts: CensusFact[];
  declared_only_dependencies: DeclaredOnlyDependency[];
  /**
   * Every package a `package.json` declares in its `dependencies`, `optionalDependencies`,
   * `devDependencies` or `peerDependencies` block, called or not, in one ordered list, each
   * declaration labelled with the `field` it came from. Sorted by package name.
   *
   * **It is a superset of the two populations above, and the surplus is exactly the dev and peer
   * declarations.** `facts` carries the called runtime packages (first call site plus a capped
   * sample, no version) and `declared_only_dependencies` the uncalled runtime ones; both were left
   * on the two runtime blocks when this array widened on 2026-08-28, because moving a build-time
   * package into `facts` — where every dependency row is categorised `recipients` — would be a
   * detection change and this ruling was about what the inventory carries. `field` is what lets a
   * reader tell the two populations apart without joining anything.
   *
   * `bundledDependencies` is not read: it is an array of names rather than a declaration map, and
   * npm requires its members to be declared in one of the four blocks anyway — see
   * `DependencyManifestBlock`.
   */
  dependency_inventory: DependencyInventoryEntry[];
  /**
   * Manifests this census opened and could take no declaration from, named with the reason.
   *
   * **Present only when it has a member.** An empty array on every tree would rewrite two golden
   * census documents to say nothing; what this closes is the case where something DID go wrong and
   * the output said nothing, which is the state the design forbids. Measured 2026-08-28 over the 3,507
   * `package.json` files of the 98-tree corpus: 0 fail `JSON.parse` and 0 carry a BOM, so it is
   * absent on every tree read so far. `Findings.stats.manifests_not_usable` carries the count.
   */
  manifests_not_usable?: ManifestNotUsable[];
  /**
   * Files the census did not read whole because the file's time budget was spent, each with the stage
   * it stopped in. Present only when it has a member, as `manifests_not_usable` is, for the
   * same reason; each is also named in the findings document's `files_partially_read`.
   */
  files_stopped_for_time?: CensusStoppedFile[];
  /**
   * Files the census read without the lines longer than the line ceiling, each line named. Present
   * only when it has a member, as `manifests_not_usable` is.
   */
  files_long_lines_not_read?: CensusLongLinesFile[];
  /**
   * Files whose outbound-host facts sit in a file that carries no request construct at all, grouped
   * one entry per file.
   *
   * **The same discipline `declared_only_dependencies` already has, applied to the other collector
   * that has it** (a gap found in one real run, 2026-09-02). A declared dependency with no call
   * site is not a recipient, and the census keeps those out of `facts` for that reason. A hostname
   * in a static comparison table of *other companies' products*, in a "featured on" logo carousel,
   * or in a unit-test spec's fixture data is the same shape of false signal — measured on
   * one tree: 235 outbound-host rows over 184 distinct hostnames, of which roughly 170 come from
   * three files containing no network code at all, and those rows then made up most of the 319 and
   * 322 "supporting facts" behind two CRA scope-gate limbs.
   *
   * **Nothing is moved out of `facts` and no verdict changes.** Removing a row would be subtraction,
   * and a bare hostname in a string is exactly the shape that reaches a real recipient the loose
   * patterns exist for (`aiplatform.googleapis.com`, a CSP `connect-src` allowance, a host whose
   * scheme is added elsewhere). This is an annotation: it says which rows have no call site *in
   * their own file*, so that a reader or an agent knows which ones to go and find a call site for
   * before naming a company as a recipient or counting a row as scope-gate evidence.
   *
   * **What it does not say.** It is a statement about the file, not about the program: a host whose
   * request is built two modules away is listed here and is still a real recipient. It is a reason
   * to look, never a reason to drop.
   *
   * Present on every run from 2026-09-02, empty list included.
   */
  outbound_hosts_without_a_request_construct?: OutboundHostFileWithoutRequestConstruct[];
  stats: {
    files_read: number;
    files_matched: number;
    by_collector: Record<string, number>;
    /**
     * Packages declared in a `dependencies` or `optionalDependencies` block — the RUNTIME
     * population, not the inventory's. `dependency_inventory` also carries `devDependencies` and
     * `peerDependencies` declarations since 2026-08-28 and is therefore longer than this on most
     * npm trees. The narrower count is kept because this number minus `packages_with_call_sites`
     * is `declared_only_dependencies.length`, an identity two schema descriptions state and a
     * consumer can check; widening one of the three without the others would break it silently.
     */
    packages_declared: number;
    packages_with_call_sites: number;
    /** Of `declared_only_dependencies`, those carrying `call_sites_not_read`. Absent at 0. */
    packages_declared_only_not_read?: number;
    /**
     * URLs that name a vocabulary rather than a destination (JSON-LD contexts,
     * XML namespaces). Counted rather than dropped in silence, so that a
     * suppression stays checkable.
     */
    identifiers_not_requests: number;
    /**
     * Manifests marked unpublishable (`"private": true`) across the whole tree.
     * Only the shallowest few are emitted as facts, because in a monorepo this
     * is a fact about the layout rather than about what the product supplies —
     * in one large monorepo, hundreds of them would otherwise have been
     * hundreds of census rows all saying the same thing. The total is here so the
     * cap is countable rather than silent.
     */
    manifests_marked_not_published: number;
    /**
     * Files the census opened and refused because their bytes are not text — a
     * NUL inside the first 4096 characters, the walker's own test, imported
     * rather than restated. Since 2026-09-03 no collector asks about a file's
     * extension, so this readability check is the only capability test left in
     * front of them.
     *
     * **Absent where it is 0**, which is every tree the shipped pipeline scans:
     * `walkTarget` has already applied the identical test, so this can fire only
     * for a caller handing the census a file list nobody sniffed. Emitted when
     * it fires, because a refusal nobody can count is a refusal nobody can
     * check.
     */
    files_not_text?: number;
  };
}

/**
 * A pillar-1 candidate sitting where a reconciliation item sits. Annotation
 * only: the same line can carry two unrelated questions, and a suppressor
 * keyed on line overlap would delete real findings.
 */
export interface Pillar1Overlap {
  /**
   * A candidate this row covers. Where the row covers a group the scanner split, this is the FIRST
   * part of it and `group_id` names the group: one row per question, never one per part, because a
   * file whose locations straddle a part boundary is still one thing pillar 1 reports there.
   */
  finding_id: string;
  /** Present only where this row covers a split group; `group_part.group_id` of its parts. */
  group_id?: string;
  rule_id: string;
  title?: string;
  first_context_question?: string;
  same_line: boolean;
  locations_in_file: number;
  /**
   * The `applicability_preconditions` of the overlapping rule that the person's ScanProfile ANSWERED
   * in a way that puts that rule out of scope — copied verbatim from the pillar-1 candidate's own
   * `declared_inapplicable_preconditions`. Present only when non-empty.
   *
   * **Carried so that pillar 2 is not told a qualified candidate is an unqualified one.** Until
   * 2026-08-27 a rule the profile answered out of scope raised no candidate at all, so no such
   * overlap could exist and this field had nothing to say; from that date the rule runs anyway and
   * the overlap is real. Measured the day the change landed: one tree reconciled against a fresh
   * scan carried 199 overlaps over 16 rules, `eu-dsa-001` and `eu-dsa-002` among them, on a profile
   * answering `features.ugc: false` — and nothing in the object said so.
   *
   * **It qualifies and never suppresses**, exactly as the overlap itself does: it is not a reason to
   * drop, downgrade or defer anything on either side. And the reconciler may not resolve it from the
   * code — whether the product carries the feature is a fact about the product, which is asked of the
   * person. The reconcile input does carry the profile verbatim, but recovering the fact from there
   * means re-evaluating `applicability_preconditions` a second time, which is the second copy
   * the project's rules forbid.
   */
  declared_inapplicable_preconditions?: string[];
}

export type Pillar1Status =
  | {
      computed: true;
      source: string;
      scan_id: string;
      target: string;
      /** Questions. A split group counts once, however many records it was emitted as. */
      candidates: number;
      /** Rows of `findings.candidates`. Equal to `candidates` unless a group was split. */
      candidate_records?: number;
      locations: number;
    }
  | { computed: false; reason: string };

/* ------------------------------------------------------------------------- *
 * declared_artifacts — the operator's own answer about their own documents,
 * put beside what this run observed. W1 of the pillar-2 plan, 2026-09-01.
 * ------------------------------------------------------------------------- */

/** One artifact the profile's `declared_artifacts` block can answer for. */
export type DeclaredArtifactKind = "privacy_policy" | "tos" | "xcprivacy" | "play_data_safety";

/**
 * The two of those four kinds a DOCUMENT's name can make it a candidate for.
 *
 * The other two are store manifests, identified by their format and never by a name shape. Derived
 * from `DeclaredArtifactKind` rather than written out a second time, and `reconcile.ts`'s own
 * `DocumentKind` is an alias of this: three files needed the same two words and a copy in any of
 * them is a defect with a delay fuse.
 */
export type DocumentNameShapeKind = Extract<DeclaredArtifactKind, "privacy_policy" | "tos">;

/**
 * What the observed side of one entry rests on, and therefore how much it may claim.
 *
 * `store-manifest-format` — the parser identified the file BY ITS FORMAT: an Apple privacy manifest
 * is a `.xcprivacy` plist and a Play data-safety export is a CSV filed under a data-safety name.
 * That is an identification of the kind, not a guess at it.
 *
 * `document-name-shape` — discovery does NOT type documents (`discover.ts`: "It classifies
 * nothing"), so there is no identification to be had for a privacy policy or a set of terms. What
 * exists is the glob that matched the document's name, and a name shape is a candidate rather than
 * an answer. Never read an entry on this basis as saying what a document IS.
 */
export type DeclaredArtifactObservationBasis = "store-manifest-format" | "document-name-shape";

/**
 * What one piece of evidence in a `DeclaredArtifactReconciliation` is, and whether it counts.
 *
 * Roles exist so that "was not read" never prints as "is not there". An unread declaration is not a
 * missing one, and a vendored dependency's manifest is not the developer's own declaration.
 */
export type DeclaredArtifactEvidenceRole =
  /** A manifest of this kind the parser read. Counts as observed. */
  | "store-manifest-parsed"
  /**
   * A manifest of this kind that exists and was NOT read — unreadable, or refused by the walker.
   * **Counts as observed**, because the file is in the tree: what is unknown is its contents, not
   * its existence. Distinguished here so a reader is never told a manifest was examined.
   */
  | "store-manifest-unread"
  /**
   * A manifest of this kind inside a vendored dependency tree. It declares what THAT dependency
   * collects, not what this app declares to the store (`store-declarations.ts` `isVendoredManifest`),
   * so it never counts as the app's own declaration in either direction. Listed because it is there.
   */
  | "store-manifest-vendored"
  /**
   * A discovered document whose NAME makes it a candidate for this kind — its matched glob's word
   * names the kind and the name carries whatever qualifier that word needs, or the name carries this
   * kind's vocabulary beside the other kind's. **A name that carries both kinds' words is a
   * candidate for both, never for neither**: that is the only arrangement that leaves a question
   * standing whichever way either field is answered. A candidate, never an identification.
   */
  | "document-name-shape"
  /**
   * The count of discovered documents whose kind this pass could not derive, with the reasons split:
   * reached by the sibling, content, explicit or url pass and carrying no `matched_glob` at all;
   * matched a glob that names a document of neither kind; carried the other kind's name shape and is
   * accounted for by that kind's entry; or carried a name that settles no kind (a word that needs a
   * qualifier the name lacks, or a third kind's standing title such as an NDA's).
   */
  | "document-kind-not-derivable"
  /**
   * A document the person handed over themselves with `--policy`, listed as its own evidence rather
   * than only counted inside `document-kind-not-derivable`.
   *
   * **It never counts as observed**, and that is deliberate: discovery types nothing, an explicitly
   * supplied document can never acquire a `matched_glob`, and calling it an observation of this kind
   * would be the classifier this project designed, measured and discarded. What it is for is the
   * put-back — the sentence has to be able to name what the person already gave, beside whatever
   * name shape the run found, so that neither disappears (a gap found in one real run, 2026-09-02:
   * a run supplied the real privacy policy with `--policy`, discovery separately globbed a
   * 14-character route-wrapper page, and the sentence asked the person to confirm the wrapper
   * without mentioning the document they had just supplied).
   */
  | "document-supplied-explicitly"
  /** Nothing of this kind was observed: the pointer to where the looking itself is recorded. */
  | "nothing-observed";

/** One pointer a reader can check inside this same file. */
export interface DeclaredArtifactEvidence {
  role: DeclaredArtifactEvidenceRole;
  /** Where in this file the pointer resolves — `discovery.found[]`, `store_declarations[]`, … */
  field: string;
  /** The file this evidence is about, where it is about one file. */
  path?: string;
  /** The glob that matched, the walker's refusal reason, or the counts behind a summary role. */
  detail?: string;
}

/**
 * Why `declared` is null. Null is never "no": it records that nobody was asked.
 *
 * `field-not-a-boolean` exists because a field holding `"yes"`, `null` or `1` reaches this code, and
 * so does a `declared_artifacts` that is a string rather than an object of answers. Reading any of
 * those as an answer would be inventing one, and reading them as `false` would be the worse half of
 * that. A malformed profile is reported here and the run continues: an unusable answer must never
 * stop the scan or narrow it.
 *
 * **Written on 2026-09-01 because NOTHING VALIDATED A PROFILE AT RUNTIME then (measured 2026-08-05):
 * `--profile` was parsed and cast. Something does from 2026-09-02 (W5), and these five values are
 * unchanged.** The load step now downgrades a field the schema rejects to `null` before this code
 * sees it, so on the `--profile` path a wrong-typed answer arrives here as `null` and comes back
 * `field-not-a-boolean` exactly as it did — the reason is the same one and the value it names is
 * what the reconciliation read, with `profile_validation.violations[].found` carrying what the file
 * held. This check is kept rather than retired because it is the only reader that a caller can still
 * hand a raw profile object to without going through the load step, and because these five values
 * are a published contract. Defence in depth, not a duplicate.
 */
export type DeclaredArtifactAbsentReason =
  | "no-profile"
  | "no-declared-artifacts-object"
  | "declared-artifacts-not-an-object"
  | "field-not-answered"
  | "field-not-a-boolean";

/**
 * The relation between the person's answer and this run's observation. It is never a statement
 * about whether the document exists — only about what was answered and what was seen.
 *
 * - `consistent` — the two do not disagree. Nothing to put to the person.
 * - `declared-but-not-observed` — the answer is yes and this run did not observe one. The scan may
 *   simply not have reached it: a policy published only on the website, a manifest the walker
 *   refused, a document under a name no glob knows. The put_back asks; nothing is concluded.
 * - `observed-but-not-declared` — the answer is no and this run observed something of the kind.
 *   **Not an accusation.** A repository can carry a document the product does not publish, a name
 *   shape is not an identification, and the answer may be about something the tree does not show.
 * - `unanswered` — nobody was asked. Never a "no", and never resolved from the code.
 */
export type DeclaredArtifactStatus =
  | "consistent"
  | "declared-but-not-observed"
  | "observed-but-not-declared"
  | "unanswered";

/** One `declared_artifacts` answer, beside what this run observed, and the question to put back. */
export interface DeclaredArtifactReconciliation {
  kind: DeclaredArtifactKind;
  /** The profile field this entry is about, named in full so the put_back can quote it. */
  profile_field: string;
  /** The answer, or null where nobody was asked. Null is never read as "no". */
  declared: boolean | null;
  /** Why `declared` is null; null itself where an answer was given. */
  declared_absent_reason: DeclaredArtifactAbsentReason | null;
  observation: {
    basis: DeclaredArtifactObservationBasis;
    /** How many pieces of evidence count as observing this kind. Vendored manifests never count. */
    observed: number;
    evidence: DeclaredArtifactEvidence[];
    /** What this observation can and cannot say, in one sentence, carried with the entry. */
    note: string;
  };
  status: DeclaredArtifactStatus;
  /**
   * The standard talk-back sentence, or null where the status is `consistent` and there is nothing
   * to ask. One template for every entry: it names the field and the answer, names the observation
   * and where to check it, says the scanner settles it in neither direction, and asks.
   */
  put_back: string | null;
}

/** What the CLI settles without judgement. Input to the reconciliation skill. */
export interface ReconcileInput {
  reconcile_id: string;
  bundle: { version: string; sha256?: string; signature?: "unsigned" | "not-verified" };
  generated_at: string;
  target: string;
  discovery: DiscoveryReport;
  documents: ExtractedDoc[];
  checklists: Checklist[];
  /** Store declarations found in the tree (Apple `.xcprivacy`, Play data safety CSV), parsed without judgement. */
  store_declarations: StoreDeclaration[];
  /** Store-declaration files that exist and could not be read. Reported, never dropped. */
  store_declarations_unreadable: string[];
  /**
   * Files that look like a store declaration and that the walker never offered, with its reason.
   * A binary plist inside a vendored `.framework`, a Play CSV over the size limit, anything in a
   * skipped tree. All three used to end in silence, which read as "no declaration exists".
   */
  store_declarations_excluded?: { file: string; reason: string }[];
  /**
   * Every checklist id the bundle carries, in order. None is selected here — which instruments
   * reach the project is a legal test, decided by each checklist's own applicability gate.
   * Replaced `checklist_id` on 2026-07-28, which named the first checklist and hid the rest.
   */
  checklist_ids: string[];
  /**
   * The ScanProfile supplied to the scan, as this run READ it, or null if none was given.
   * Corroborates or contradicts what the code and the documents show; never decides the AGENT's
   * applicability gate alone. It is an input to the mechanical assessment in `applicability` from
   * 2026-09-01, where a declared answer can move a limb's state — see that field, and `scope.ts`
   * § THE DECLARATION PATH.
   *
   * **"Verbatim" until 2026-09-02, and "as read" since.** The two differ only where a field
   * `scan-profile.schema.json` rejects was downgraded to `null` on load (W5), and `profile_validation`
   * names every such path with the value the file held. This field is what the reconciliation
   * actually read, which is the thing a reader of this document needs it to be.
   */
  profile: ScanProfile | null;
  /**
   * What the profile schema check found (W5, 2026-09-02). Emitted only where `--profile` was given.
   * Absent with a non-null `profile` means a document written before that date.
   */
  profile_validation?: ProfileValidation;
  /**
   * One entry per `declared_artifacts` kind — all four, always, whether or not a profile was given.
   *
   * Optional in the schema and always emitted here, for the reason `profile` and
   * `store_declarations_excluded` are: a file written before this field existed is still a valid
   * ReconcileInput. **Absent means "produced by a CLI that did not compute this"; four `unanswered`
   * entries mean "computed, and nobody was asked".** Those are different statements.
   */
  declared_artifacts_reconciliation?: DeclaredArtifactReconciliation[];
  /**
   * One mechanical applicability assessment per bundled gate that carries `limbs`, computed here
   * the way `scan` computes it — the same `assessScope`, over this run's own census facts and
   * profile (W2, 2026-09-01).
   *
   * The type is `ScopeAssessmentRecord`, which is the same type `Findings.applicability` carries,
   * and it is referenced rather than restated for the reason the project's rules give: two copies of one
   * shape are two things that can disagree. What these states are, and how they stand to the
   * agent's own gate walk, is stated once in `reconcile-input.schema.json`'s `applicability`.
   *
   * Optional in the schema and always emitted here, on the same terms as
   * `declared_artifacts_reconciliation`: a file written before this field existed is still a valid
   * ReconcileInput. **Absent means "produced by a CLI that did not compute this"; an empty array
   * means "computed, and no bundled gate carries limbs".** Those are different statements.
   */
  applicability?: ScopeAssessmentRecord[];
  /**
   * Gates the bundle ships that carry no `limbs`, named rather than dropped — the same field
   * `Findings` carries, for the same reason: a run that silently assessed the gates with limbs
   * would look like a run that had considered every instrument in the bundle.
   */
  applicability_not_assessed?: string[];
  census: CensusResult;
  pillar1: Pillar1Status;
  stats: {
    files_walked: number;
    documents_found: number;
    documents_extracted: number;
    /**
     * Files discovery reached and did not offer as candidate declarations —
     * `content_scan.screened.length`, which since 2026-09-02 counts two populations: files that
     * carried legal phrases and were not document-shaped, and files whose bytes are not text.
     * Optional so a document written before 2026-09-02 still validates; emitted on every run from
     * that date. It sits beside `documents_found` so screening never lowers that number with nothing
     * to say why.
     */
    documents_screened?: number;
    /**
     * Found documents whose own NAME is a declaration's name — `found[].name_shape_kinds` non-empty
     * — whatever pass reached them. Optional so a document written before 2026-09-02 still
     * validates; emitted on every run from that date.
     *
     * Beside `documents_found` because the two answer different questions, and the second run of
     * this pillar showed what happens when only the first is available: 165 candidates, of which 7
     * were named like a declaration, printed as one flat list of 165 rows, and the two rows that
     * decided the run were read past. This count is a statement about names and never an
     * identification.
     */
    documents_declaration_shaped?: number;
    referencing_files: number;
    census_facts: number;
    store_declarations_found: number;
    declared_only_dependencies: number;
    /** Of those, the ones whose call sites could be on lines the census did not read. Absent at 0. */
    declared_only_dependencies_not_read?: number;
    /** Facts sharing a file with a pillar-1 candidate. Loose: a rule with many locations puts
     * most of a repository "in overlap", so this number alone overstates redundancy. */
    facts_with_pillar1_overlap: number;
    /** Facts on the same line as a pillar-1 candidate. Still not duplicates — see Pillar1Overlap. */
    facts_on_a_pillar1_line: number;
  };
  excluded_by_walker?: WalkerExclusion[];
  disclaimer: string;
}

/**
 * A search the agent actually ran, in a form a reader can re-run verbatim.
 * Without this the output is an opinion; with it, it is a finding a developer
 * can check in thirty seconds.
 */
export interface ReconSearch {
  pattern: string;
  paths: string[];
  flags?: string;
  hit_count: number;
  /**
   * The matching lines. **Exactly one of `file` and `document_ref` names where the line is**, and
   * `document_ref` is the addition of 2026-09-03 — see `CodeEvidence` for the whole account. A hit
   * inside a fetched policy had nowhere to go before it: a URL is not a path relative to `--target`
   * and can never become one.
   */
  hits: { file?: string; document_ref?: string; line: number; line_text: string }[];
}

/**
 * Something the document asserts that can be checked against code.
 *
 * `direction` records which way the check runs: A starts from the claim, B
 * starts from a code fact the document is silent about. `falsifiable_by` is
 * what would show the claim untrue — a claim broad enough that nothing could
 * falsify it is not a finding waiting to happen, it is boilerplate.
 */
export interface DeclarationClaim {
  claim_id: string;
  claim: string;
  quote: string;
  source_location: { doc: string; line: number };
  law_ref?: string;
  falsifiable_by: string;
  direction: "A" | "B";
  depends_on_runtime_config?: string[];
  /** Added by `reconcile-verify`, never by the agent. Absent means the check has not been run. */
  quote_checks?: QuoteCheck[];
}

/** Whether one instrument reaches this project, answered before its items are walked. */
export interface ApplicabilityVerdict {
  checklist_id: string;
  status: "applies" | "does-not-apply" | "unresolved";
  reasoning: string;
  /** True where the agent had to ask the person running the scan. */
  asked_the_user?: boolean;
  /** What they said, in their own words. */
  user_answer?: string;
}

export interface ChecklistResult {
  /** Item ids are unique within a checklist, not across them. */
  checklist_id: string;
  item_id: string;
  status: "present" | "partial" | "absent" | "unresolved" | "not-applicable";
  /**
   * Where the document satisfies the item, when it does.
   *
   * **`quote` stays REQUIRED here, unlike a finding's code evidence**, and the reason is not
   * symmetry but what the two entries are. A finding's evidence is a RANGE OF SOURCE the reader
   * opens; a checklist item's evidence is the sentence in the developer's own document that answers
   * the question, and choosing that sentence — out of a page that says many things — is the work the
   * item exists to do. Extracting "whatever is on line 412" would let an item answer `present` from
   * a location with no sentence chosen at all. One of run 3's twelve quotation defects was a
   * checklist quote, against seven in finding evidence; the smaller class is left to the mechanical
   * check that already catches it.
   */
  evidence?: { doc: string; line: number; quote: string }[];
  reasoning: string;
  /** Added by `reconcile-verify`, never by the agent. Absent means the check has not been run. */
  quote_checks?: QuoteCheck[];
}

export type OverlapDisposition = "different-question" | "duplicate" | "related";

/**
 * One verbatim excerpt of real source, with the file and the line range it covers.
 *
 * Named rather than written inline on `DeclarationFinding` because a questionnaire answer carries
 * the same shape and is checked by the same waterfall — `reconcile-verify` reads `file`, `lines`
 * and `quote` off both. The project's rule: never keep a second copy of anything two places must
 * agree on. `questionnaire-answers.schema.json` does the JSON half of this with a cross-file `$ref`
 * into `declarations.schema.json`.
 */
/**
 * Where a quotation's text came from.
 *
 * Absent means the agent typed it, which is every quotation written before 2026-09-03 and every one
 * an agent still chooses to transcribe. `extracted-from-declared-range` means `reconcile-verify`
 * wrote it from the real bytes at the location the agent declared, because the agent supplied a
 * location and no text — the mechanism that removes the transcription defect class rather than
 * catching it. See `QuoteVerificationSummary.extractions` for why it exists and for what an
 * extracted quote is and is not worth.
 */
export type QuoteSource = "agent-transcribed" | "extracted-from-declared-range";

export interface CodeEvidence {
  /**
   * Path relative to the scanned tree, for a citation of the repository. **Exactly one of this and
   * `document_ref` is present**, which the JSON schema enforces with a `oneOf` and which
   * `reconcile-verify` reports on rather than guessing at when a document breaks it.
   */
  file?: string;
  /**
   * The DOCUMENT this citation is in, named by its `documents_read[].path_or_url` — a repository
   * path or the full URL a `--policy <url>` run fetched.
   *
   * **Added 2026-09-03, and the shape it repairs is structural rather than cosmetic** (hole 8 of the
   * bitwarden-url run). Until then this entry and `ReconSearch.hits[]` had one addressing scheme
   * between them, `file`, documented "Path relative to target" — so a citation of a DOCUMENT was
   * only ever valid by accident, when the document happened to be a file in the tree and its path
   * happened to be a filesystem path as well. A live-fetched policy breaks that accident for the
   * first time: `https://bitwarden.com/privacy/` is a real, digest-pinned entry of
   * `documents_read[]` and is never a path, so `reconcile-verify` resolved it under `--target` and
   * failed with `ENOENT ... 'https:/bitwarden.com/privacy'` on all six citations of it, and all six
   * were reworded out of the report to reach exit 0.
   *
   * **Two of those six were byte-exact quotations of the policy and four were not** — three search
   * hits carrying literal `...` elision markers, one with a space typed where the page carries a
   * private-use icon glyph (measured against the real extracted text; independent verification,
   * 2026-09-03). This shape verifies the two; it removes the ENOENT, never the transcription defect
   * underneath one. That is what makes the gap structural rather than cosmetic: under the ENOENT all
   * six read as one failure, so a true citation and a spliced one were indistinguishable and the
   * report could be "repaired" by deleting either.
   *
   * **What it points AT is an identity, not a location.** `documents_read[]` pins each document by
   * `sha256` and `read_at`/`fetched_at`; the lines below are lines of the EXTRACTED text those bytes
   * produced, which is the same text `claims[].quote` is checked against. So a document citation is
   * verified by exactly the waterfall a file citation is, over exactly the corpus the claims use, and
   * reaches exactly the same five states.
   */
  document_ref?: string;
  /** Line or line range the quote covers (e.g. "42" or "42-47"). Only the endpoints are read. */
  lines: string;
  /**
   * The excerpt. **Optional since 2026-09-03**: an agent that supplies `file` and `lines` and no
   * `quote` has `reconcile-verify` write the text from the real bytes, and the transcription defect
   * class cannot then occur at all. Supplying it is still permitted and is verified exactly as
   * before.
   */
  quote?: string;
  /** Written by `reconcile-verify`, never by the agent. Absent means the agent transcribed it. */
  quote_source?: QuoteSource;
}

/**
 * The second pass: a separate agent, instructed to prove the thing wrong, reporting what it found.
 *
 * Named for the same reason `CodeEvidence` is — a questionnaire answer goes through the same
 * refutation step a reconciliation finding does, and the outcome vocabulary has to be one
 * vocabulary.
 */
export interface DeclarationRefutation {
  outcome: "upheld" | "overturned" | "needs_human";
  reasoning: string;
  grounds?:
    | "already-disclosed"
    | "dependency-not-called"
    | "no-user-data-on-path"
    | "not-falsifiable-from-code"
    | "claim-holds"
    | "over-disclosure-not-a-contradiction"
    | "pillar1-duplicate"
    | "strained-reading";
  agent_model?: string;
}

/** One reconciliation finding: the document and the code do not appear to match. */
export interface DeclarationFinding {
  finding_id: string;
  direction: "A" | "B";
  categories: CensusCategory[];
  claim_ref?: string;
  fact_refs?: string[];
  /** The user's own words, in the source language, with the line that carries them. */
  quote?: { doc: string; line: number; text: string };
  /** Present where the source language is not English, per the delegated 2026-07-28 decision. */
  quote_translation?: string;
  searches: ReconSearch[];
  evidence: CodeEvidence[];
  law_ref?: string;
  /** Named env vars the finding is conditional on; the finding must be phrased as conditional. */
  depends_on_runtime_config?: string[];
  pillar1_overlaps?: Pillar1Overlap[];
  overlap_disposition?: OverlapDisposition;
  confidence: Confidence;
  /** The finding in prose. A question where runtime configuration could resolve it. */
  finding_text: string;
  refutation?: DeclarationRefutation;
  /**
   * Added by `reconcile-verify`, never by the agent. Covers every quotation this finding owns: its
   * own document quote, each `evidence[]` excerpt, and each listed search hit. Absent means the
   * check has not been run.
   */
  quote_checks?: QuoteCheck[];
}

/**
 * The five outcomes `reconcile-verify` can reach for one quotation.
 *
 * The first four carry the meanings a tool measured them into. The fifth is this
 * tool's own: loop-probe calls a quote it cannot find `discarded`, because a sweep fact that cannot
 * be placed leaves that sweep's population. Nothing leaves anything here — an agent's quotation of
 * a developer's own document is the evidence of what the agent said — so it is `unverifiable`, it
 * flags the object that carries it, and the object stays.
 */
export type QuoteVerificationStatus =
  | "confirmed_at_declared"
  | "repaired"
  | "re_attributed"
  | "ambiguous"
  | "unverifiable";

/** A document path/URL or a tree-relative file path, with the line numbers that go with it. */
export interface QuoteLocation {
  source: string;
  lines: number[];
}

/** Which tier found the text. Carried as data so a gate can pin it without parsing prose. */
export type QuoteMatchTier = "T1-exact" | "T2-collapsed" | "T2-normalized" | "T3-fragment";

/**
 * One quotation, checked against the text it claims to come from.
 *
 * `declared` is a copy of what the report said, never a correction of it; `final` is where the text
 * really is. Both are carried because the report's own numbers stay exactly as the agent wrote
 * them — they are the record of what was asserted, and a verifier that overwrote them would destroy
 * the only evidence that anything needed correcting.
 */
export interface QuoteCheck {
  /** Where in the report this quotation lives, e.g. `findings[2].searches[0].hits[1]`. */
  path: string;
  corpus: "document" | "code";
  declared: QuoteLocation;
  status: QuoteVerificationStatus;
  /** Where the text really is; null for `ambiguous` and `unverifiable`, which assert no position. */
  final: QuoteLocation | null;
  /** The tier that matched, or null when nothing did. */
  tier: QuoteMatchTier | null;
  /**
   * True when ONLY the quotation's first line was found and the rest of the text is nowhere in
   * scope, so `final` is an anchor rather than a verification.
   *
   * This is carried on the data rather than left in prose because the rendering that only said it in
   * a note let a fabricated second line pass as an ordinary drift repair: a quote whose first line
   * is real and whose remainder is invented reaches `repaired`, and a console that printed it beside
   * genuine drifts erased the distinction. A fallback row is treated as `unverifiable` is, at the
   * exit code and in the skill.
   */
  fallback: boolean;
  /** Which tier matched, what was searched, and every disclosure. Always present, may be empty. */
  notes: string[];
}

/** Counts, provenance and what this tool does not check. Written to the annotated copy only. */
export interface QuoteVerificationSummary {
  tool: "reconcile-verify";
  verifier_version: number;
  counts: Record<QuoteVerificationStatus, number>;
  /**
   * Checks whose position rests on the first-line fallback alone. Counted separately from `counts`
   * because such a row wears the `repaired` or `re_attributed` word while carrying the evidential
   * weight of an unverified one, and the exit code turns on this number as well as on `unverifiable`.
   */
  fallback_anchored: number;
  total: number;
  document_checks: number;
  code_checks: number;
  /** Files named anywhere in the report, which is the scope a code quote can be re-attributed in. */
  code_scope: number;
  /** Findings carrying no document quotation. Direction B has none by design; never a penalty. */
  skipped_no_document_quote: { path: string; direction: "A" | "B" }[];
  provenance: {
    report_reconcile_id: string;
    input_reconcile_id: string;
    reconcile_id_matches: boolean;
    documents_with_pin_mismatch: { doc: string; report_sha256: string; input_sha256: string }[];
    documents_in_report_not_in_input: string[];
    documents_in_input_not_read_by_report: string[];
    unplaced_document_lines: { doc: string; lines: number }[];
  };
  /** Stated in the output itself, so a reader never takes this for a check of the whole report. */
  not_verified_here: string[];
  searches_reporting_more_hits_than_listed: string[];
  /**
   * Evidence entries whose quote THIS TOOL wrote from a declared location, and the ones it refused
   * to write. Present only where at least one entry named a location and no text.
   *
   * **Why the mechanism exists.** The transcription defect class — an ellipsis joining two real
   * strings that are not adjacent — has now recurred in three consecutive real runs, in each case
   * after the rule against it was pasted verbatim into every brief that could produce one (10 of 28
   * defects in run 1, 3 in 126 quotations in run 2, 10 of 12 in run 3, the last of those after run
   * 2's own mandatory three-step quoting ORDER was in force). A rule stated three times and broken
   * three times is removed by changing who does the copying, not by stating it a fourth time.
   *
   * **What an extracted quote is worth, stated so it cannot be over-read.** It cannot carry a
   * transcription defect, so its verification below is a tautology; it says the bytes came from the
   * file, never that those lines support the finding. Which lines are the evidence stays the agent's
   * judgement and is checked by the refuter and by the reader.
   */
  extractions?: {
    /** JSON path of the entry, in the same vocabulary `QuoteCheck.path` uses. */
    path: string;
    /** The source named — a `documents[]` path, or a file under `--target`. */
    source: string;
    /** The range as the report declared it. */
    declared: string;
    /** Lines taken, where the extraction succeeded. */
    lines?: number;
    /** Why nothing was taken, where it did not. The entry then carries no quote at all. */
    refusal?: string;
  }[];
  /**
   * Identifiers the report's own PROSE names, checked against the identifiers the report actually
   * carries. Absent means the check has not been run, which is this file's standing convention and
   * not a pass.
   *
   * **The gap it closes** (hole 9 of the bitwarden-url run, 2026-09-03). Assembly renumbers
   * `claims[]` and `findings[]` globally, because each seat numbers its own output from `C1`/`F1`.
   * The assembly step rewrote every STRUCTURED reference — `findings[].claim_ref` — and could not
   * rewrite the plain-text mentions inside `finding_text`, where one finding's narrative said "C1 is
   * an unqualified claim … C3 discloses … (C7)" about a seat's local numbering that the same run had
   * renumbered to C13/C15/C19. Nothing mechanical could see it: a bare `C3` inside a prose field is
   * not a quotation and not a reference the schema knows about, so neither the quote waterfall nor
   * schema validation looks at it, and the reader of the report is sent to the wrong claim.
   *
   * **The check is a cross-reference and nothing more.** The id-shaped tokens it looks for are
   * derived FROM THIS REPORT'S OWN IDS — the prefixes its `claim_id`s and `finding_id`s actually use
   * — so a report whose ids are `C1`/`F1` has `C\d+` and `F\d+` searched and nothing else, and a
   * report whose ids carry no digits is not searched at all. It never rewrites prose: what to do
   * about a dangling reference is the orchestrator's, with the two objects open, exactly as it is for
   * an unverifiable quotation.
   */
  id_cross_references?: {
    /**
     * Exactly the shapes that were searched for, derived from this report's own ids — each id's
     * leading prefix, plus the bare letter at the end of a namespaced one (`store-C` also yields
     * `C`, so a stale bare `C1` is still caught under the per-seat-namespace repair). Empty means
     * nothing was searched for at all.
     */
    prefixes: string[];
    /** Id-shaped tokens found in prose and resolved against the id set. */
    checked: number;
    /** Tokens that look like this report's ids and name no claim or finding in it. */
    dangling: { path: string; id: string; context: string }[];
    /**
     * Ids that contributed no searchable shape: one of bare digits, whose empty prefix would match
     * every number in every prose field, and one with no trailing digits at all. Counted apart
     * because a report with a non-zero count here has had LESS checked than `checked` suggests, and
     * that must not have to be inferred from a zero. Absent on a report written before 2026-09-03.
     */
    ids_not_cross_referenced?: number;
  };
}

/* --------------------------------------------------------------------------------------------- *
 * Layer 2's quote check — the same waterfall, a third caller.
 * --------------------------------------------------------------------------------------------- */

/** Which seat wrote a record. The subdirectory under `.legal/verdicts/` is the scheme. */
export type VerdictSeat = "adjudicator" | "refuter" | "silence-investigator";

/**
 * One layer-2 record, checked.
 *
 * The record itself is carried VERBATIM in `record`, deep-copied, with the quote check's own fields
 * added to it and nothing removed. Where the check invalidated it, the class field on `record` holds
 * the invalidated value and the field beside it holds the original — so the audit trail shows what
 * the model said and what the check did, which is the same discipline `QuoteCheck.declared` keeps
 * one level down.
 */
export interface VerdictQuoteRecord {
  /** The file this record was read from, relative to where the command was pointed. */
  source: string;
  /** Index of the record inside that file's array, so a reader can go straight to it. */
  index: number;
  seat: VerdictSeat;
  /** `finding_id` for a verdict or a refutation, `rule_id` for a silence record. Empty if neither. */
  id: string;
  outcome: VerdictQuoteOutcome;
  /** Why it was invalidated, one sentence per reason. Empty otherwise. */
  notes: string[];
  /** The record as the child wrote it, plus `quote_checks[]` and the outcome fields. */
  record: Record<string, unknown>;
}

/** Counts, the file hashes, and what this check does not establish. */
export interface VerdictQuoteSummary {
  tool: "verdict-verify";
  /**
   * The shared waterfall's version (`QUOTE_VERIFIER_VERSION`), bumped when the tiers every caller runs
   * change. A tier only this caller asks for (T2n) is marked by `mapping_version` instead.
   */
  verifier_version: number;
  /**
   * Bumped when the mapping from a waterfall status to an outcome changes, or when a tier only this
   * caller asks for changes (3: T2n). Its own number.
   */
  mapping_version: number;
  counts: Record<QuoteVerificationStatus, number>;
  fallback_anchored: number;
  /** Quotations checked. NOT the number of records: a record carries one or more. */
  total: number;
  outcomes: Record<VerdictQuoteOutcome, number>;
  records: number;
  per_seat: Record<VerdictSeat, { records: number; quotes: number } & Record<VerdictQuoteOutcome, number>>;
  /**
   * Records that carried no evidence at all, by id, each saying whether its own seat's contract
   * allows that. Counted apart and never folded into the quotation counts: a record with no
   * quotations produces no rows, so a reader of the counts alone would see it as indistinguishable
   * from a record whose every quotation confirmed.
   *
   * The three seats differ and the difference is a contract and not a convenience — a verdict must
   * carry one in every direction, an `apparently_absent` silence row has nothing to quote by design,
   * and `refutation.evidence` did not exist before 2026-09-17.
   */
  no_evidence: string[];
  /**
   * Refutations that overturned a candidate and quoted nothing, by id.
   *
   * Not invalidated — the field to put a quotation in did not exist until 2026-09-17 — but named,
   * because this is the one combination SKILL.md step 5 asks for a quotation on ("keep the refuter's
   * grounds and quote as the reason") and it is the direction that takes a finding out of the report
   * body.
   */
  overturned_without_evidence: string[];
  /**
   * Quote-check paths whose matched text collapses to fewer than 8 characters. A DISCLOSURE, never a
   * status: thin evidence and absent evidence are different results, and a length floor would be a
   * subtraction, which is the only operation that can create a miss.
   */
  short_quotes: string[];
  /**
   * Quotations written in parts joined by an ellipsis, where every part was found on its own in the
   * file the entry names, in the order written and spread within the declared span plus 40 lines.
   *
   * Counted apart because they are the commonest shape a quotation takes when it fails the flat
   * search — twenty of the twenty-four failures on the first real record this check was pointed at —
   * and because what they are worth differs from an unbroken quotation: an elided quotation shows
   * that each part is real and says NOTHING about the lines between them. They are `repaired`, never
   * `confirmed`.
   */
  elided_quotes: string[];
  /**
   * Quotations carrying a redaction marker, so that they are not verbatim by their own record's
   * account.
   *
   * The ordinary shape of a credential finding: the child quotes the line it found and writes
   * `[REDACTED - 64-character value]` where the value is, which is the right thing to do with a live
   * secret. Nothing mechanical can confirm such a quotation, so it is invalidated with everything
   * else — which for a credential finding is the correct place, since a person has to look — but it
   * is counted apart and said apart, because "found nowhere" reads as a possible fabrication and
   * this is not one. The marker is never trusted to excuse the quotation: it is a string the same
   * model typed.
   */
  redacted_quotes: string[];
  /**
   * Quotations that carried this program's own redaction marker (`[redacted:baseline-002#<clause>:<digest>]`,
   * written where the report and the evidence log are assembled) and were checked with each marker
   * restored from the named file by its digest. Absent from a report written before that unit. A marker that
   * could not be restored leaves its quotation in `redacted_quotes` instead.
   */
  restored_redactions?: string[];
  /**
   * Quotation rows that dismissed a location other than the ones their record's conclusion stands on, failed the check,
   * and so withdrew only that dismissal instead of demoting the record.
   * Absent from a report written before that change.
   */
  withdrawn_dismissals?: string[];
  /**
   * Quotations that carry no content of its own — punctuation only, a placeholder (`null`, `none`,
   * `n/a`, …) or a bare keyword (`else`, `end`, `true`, …) — invalidated whatever the search found,
   * because finding `-` in a file shows nothing about that file (fix/quote-elision, 2026-09-25).
   * A short part INSIDE an otherwise real elided quotation is not
   * one of these: the test is on the whole quotation, or on every part of an elided one at once.
   */
  contentless_quotes: string[];
  /**
   * Every file a quotation was checked against, with the digest of its bytes as this run read them.
   *
   * **This is the FILE HALF of what ideas.md idea H calls `rests_on`, and it is deliberately not
   * named that.** H also needs the searches a child ran, replayed; this tool sees no searches, and it
   * covers the files a quotation was checked against rather than every file the child opened. What it
   * is worth is that a tool computed it: a child can name a file it did not read, and this cannot.
   */
  files_read: { path: string; sha256: string; bytes: number }[];
  /** Files a quotation named and this run would not open, with the reason. */
  files_refused: { path: string; problem: string }[];
  /**
   * READER REPLIES FOUND IN THE VERDICTS DIRECTORY AND EXCLUDED FROM THE VERDICT POPULATION.
   *
   * A reader in reading mode returns a JSON array of disposition rows and no verdict word (design
   * section 10.2). This tool had no notion of reading mode and read each such row as an unevidenced
   * verdict: one run's first attempt shows 104 records invalidated by it (U4 finding M2). The reply is
   * recognised BY ITS SHAPE and not by where it sits, because a directory convention is the thing
   * that drifts; it is named here so that "excluded" is a disclosure rather than a silence.
   */
  reader_replies_excluded: { path: string; rows: number }[];
  /**
   * Records, or entries where a record belongs, whose SHAPE the checks cannot read as written: a class
   * word missing or outside the seat's list, a second field carrying one, a missing `finding_id`, a
   * non-list `evidence`, a quotation row without file, lines or quote, a non-object `reading` or
   * `rests_on`, a non-object entry, an unparseable file, a log with no `verdicts` list. Every one is
   * handled as invalidated and makes the run exit 5 (fix-verify-shape, 2026-09-24). Optional only
   * because a report written before the field existed has none.
   */
  malformed?: { source: string; index: number; seat: VerdictSeat; id: string; problems: string[] }[];
  /**
   * How many quotations came out of verdicts' `reading.read[]` trails rather than out of
   * `evidence[]`. Counted apart because they answer a different question: `evidence[]` is what the
   * finding is SHOWN with, and the trail is the record of what was READ.
   */
  reading_quotes?: number;
  /**
   * The findings document the coverage check ran against, or `null` where none was given and the
   * check therefore did not run. **An absent document is an absence, stated, and never a pass** —
   * the same discipline `no_evidence` keeps one field up.
   */
  coverage_checked?: string | null;
  /**
   * Every way a verdict's `reading` block fails to account for its candidate: a same-kind line group
   * in neither `read` nor `not_read`, a `covered` row under a group nobody read, a member count that
   * does not add up, a trail row with no quotation, a `not_applicable` over a group left unread on
   * the repository-answer rule, and — for a rule whose items ARE the matched word — an item the
   * finding neither lists nor quotes a dismissal of.
   *
   * Empty is a pass only where `coverage_checked` names a document.
   */
  coverage_gaps?: { check: string; finding_id: string; kind?: string; problem: string }[];
  /**
   * Files a record quoted whose bytes do not decode as text, with their size.
   *
   * The corpus reads with `utf8`, so a PDF or a UTF-16 source file becomes replacement characters
   * and NUL runs, and a quotation of whatever ASCII survives still matches. The status is NOT
   * changed by this — the bytes are there and the match is real, and calling it invalidated would
   * assert a defect nobody has shown — but a confirmation against mojibake is not a check against
   * the file a person would open, and a reader has to be told which rows those are. The byte count
   * is also this run's answer to "how much did it read": there is no size bound on a file a record
   * names, and the honest floor is to say how large it was rather than to invent a ceiling.
   */
  binary_files: { path: string; bytes: number }[];
  /** Stated in the output itself, so nobody reads this for more than it is. */
  not_verified_here: string[];
}

/** What `verdict-verify` writes. Deterministic: same records, same tree, same bytes out. */
export interface VerdictQuoteReport {
  tool: "verdict-verify";
  /** The tree the quotations were checked against, as the caller named it. */
  target: string;
  /** Every input file read, in the order read. */
  inputs: { path: string; seat: VerdictSeat | "evidence-log"; records: number }[];
  summary: VerdictQuoteSummary;
  records: VerdictQuoteRecord[];
}

/** What the agent concluded. The auditable output of pillar 2. */
export interface DeclarationsReport {
  reconcile_id: string;
  target: string;
  bundle: { version: string; sha256?: string; signature?: "unsigned" | "not-verified" };
  /** Every document read, pinned by digest and time — a policy changes without the repo changing. */
  documents_read: {
    path_or_url: string;
    sha256: string;
    read_at: string;
    fetched_at?: string;
  }[];
  checklist_ids: string[];
  /** One verdict per checklist carried, walked or not. A skipped list and an unexamined one differ. */
  applicability_verdicts: ApplicabilityVerdict[];
  checklist_results: ChecklistResult[];
  claims: DeclarationClaim[];
  findings: DeclarationFinding[];
  /** Candidates considered and not reported, with the reason. The discipline, made visible. */
  considered_and_rejected?: { subject: string; reason: string }[];
  agent_model?: string;
  completed_at: string;
  disclaimer: string;
  /**
   * Written by `reconcile-verify` into its annotated copy, never into the report the agent wrote.
   * Absent means no quotation in this document has been checked against the text it cites.
   */
  quote_verification?: QuoteVerificationSummary;
}

/* ------------------------------------------------------------------------- *
 * Questionnaires the user brings in from outside (W8).
 *
 * A ScanProfile is the declaration form THIS product defines and asks. These types are for the
 * other direction: a form written by somebody else — a customer's security review, an auditor's
 * schedule, a marketplace's onboarding questions — that arrives asking things no detector was
 * built to ask. The answers are drafted from the code, and they leave the user's machine for a
 * third party, which is why every one of them carries where it came from and why the one thing
 * that is never done is guessing.
 *
 * The JSON contract is `questionnaire-answers.schema.json`, which imports its `searches`,
 * `evidence`, `refutation`, `quote_checks` and status `counts` shapes from
 * `declarations.schema.json` by cross-file `$ref`. The types below do the same thing on this side,
 * by naming the interfaces rather than restating them.
 * ------------------------------------------------------------------------- */

/** How the ingest read the source. `markdown` and `text` share one line-based decomposition. */
export type QuestionnaireFormat = "csv" | "markdown" | "text";

/** Where in the source an item came from, so a person confirming the split can open the place. */
export interface QuestionnaireAnchor {
  kind: "csv-cell" | "text-line";
  /** 1-based physical line where the record or the item's first line starts. */
  line: number;
  /** CSV only: 1-based record number, the header being record 1. */
  record?: number;
  /** CSV only: 1-based index of the column the question was read from. */
  column_index?: number;
  /** CSV only: that column's header text, as the file spells it. */
  column_header?: string;
  /** Last physical line, where the item runs over more than one. */
  end_line?: number;
}

/**
 * One question, verbatim.
 *
 * `parse_note` is the field that keeps a guess from being silent: an ambiguous row is ingested WITH
 * the doubt attached rather than dropped or tidied into something that reads as certain.
 */
export interface QuestionnaireItem {
  item_id: string;
  question: string;
  anchor: QuestionnaireAnchor;
  /** An answer cell the source already carried, untouched. Evidence for the drafting, not an answer. */
  existing_answer?: string;
  /** The heading this item sits under, for a markdown source. Context; nothing routes on it. */
  section?: string;
  parse_note?: string;
}

/** items.json — the decomposition. Never hand-edited: a mis-split is repaired by re-ingesting. */
export interface QuestionnaireItemsDocument {
  questionnaire: string;
  source_file: string;
  source_sha256: string;
  format: QuestionnaireFormat;
  items: QuestionnaireItem[];
}

/** Which column was read, and WHY — the second half is what the person confirms. */
export interface CsvColumnChoice {
  index: number;
  header: string;
  chosen_by:
    | "flag-header-name"
    | "flag-column-index"
    | "header-name-match"
    | "longest-average-cell"
    | "only-column";
}

/** ingest.json — every decision the ingest made, so the split can be argued with. */
export interface QuestionnaireIngestRecord {
  tool: "questionnaire-ingest";
  ingest_version: number;
  questionnaire: string;
  source: {
    given_path: string;
    stored_as: string;
    bytes: number;
    sha256: string;
    lines: number;
  };
  /** The only clock in the ingest: items.json carries none, so the decomposition is comparable. */
  ingested_at: string;
  format: { value: QuestionnaireFormat; decided_by: "flag" | "extension" | "default" };
  csv?: {
    delimiter: string;
    records: number;
    header_fields: string[];
    question_column: CsvColumnChoice;
    answer_column: CsvColumnChoice | null;
    unterminated_quote?: boolean;
  };
  text?: {
    rule_used: "numbered-or-bulleted" | "question-mark-lines" | "every-non-blank-line";
    headings: number;
    fenced_code_lines: number;
  };
  items: number;
  /** Every record or line that produced no item, with the reason and its own text. Nothing is dropped. */
  rows_without_item: { record?: number; line: number; reason: string; raw: string }[];
  items_with_parse_note: string[];
  notes: string[];
  disclaimer: string;
}

/** Which questionnaire, in which version, a document belongs to. The digest is the pin. */
export interface QuestionnairePin {
  name: string;
  source_file: string;
  source_sha256: string;
  ingested_at: string;
  items?: number;
}

/** What material an answering agent has, counted and named — never matched to an item. */
export interface QuestionnaireMaterial {
  kind: "pillar1-findings" | "reconcile-input" | "census" | "questionnaire-answers";
  present: boolean;
  /** Where it was looked for, whether or not it was found. */
  path: string;
  sha256?: string;
  counts?: Record<string, number>;
  /** What it can and cannot answer, or — when absent — what is missing and what would supply it. */
  note: string;
}

/** answer-input.json — the items plus an inventory of the material. Nothing is pre-matched. */
export interface QuestionnaireAnswerInput {
  tool: "questionnaire-assemble";
  assemble_version: number;
  questionnaire: QuestionnairePin;
  target: string;
  materials: QuestionnaireMaterial[];
  items: QuestionnaireItem[];
  matching_note: string;
  detector_gap_items: string[];
  disclaimer: string;
}

/** Where an answer came from. The three are exhaustive, and one of them is "nobody can tell". */
export type AnswerProvenance = "scan" | "targeted" | "human";

/** One drafted answer. `answer_draft` is the word that matters: a draft for the person to review. */
export interface QuestionnaireAnswer {
  item_id: string;
  /** The question, copied verbatim from items.json, and compared against it by `questionnaire verify`. */
  question: string;
  answer_draft: string;
  provenance: AnswerProvenance;
  /** Pillar-1 candidates this rests on, for `scan` provenance. */
  finding_refs?: string[];
  /** Census facts this rests on, for `scan` provenance. */
  fact_refs?: string[];
  /** Every search a targeted investigation ran, the zero-hit ones included. */
  searches?: ReconSearch[];
  /** The RoPA marker, imported from the emitter rather than re-invented. Only for `human`. */
  human_marker?: string;
  evidence: CodeEvidence[];
  /** Required for `scan` and `targeted`; absent on `human`, where there is nothing to be confident about. */
  confidence?: Confidence;
  refutation?: DeclarationRefutation;
  /**
   * True when the code could answer this and no rule or collector covers its subject.
   * The log that grows the net: a customer's questionnaire asks what the detectors were never
   * built to ask. Only a `targeted` answer may set it.
   */
  detector_gap: boolean;
  /** Added by `questionnaire verify`, never by the agent. Absent means the check has not been run. */
  quote_checks?: QuoteCheck[];
}

/** Counts, coverage and what the check does not cover. Written to the annotated copy only. */
export interface AnswerVerificationSummary {
  tool: "questionnaire-verify";
  /** The quote verifier's own version, carried through from reconcile-verify. */
  verifier_version: number;
  counts: Record<QuoteVerificationStatus, number>;
  fallback_anchored: number;
  total: number;
  code_scope: number;
  answers_checked: number;
  /** Items no answer names. Not an error, and never silent. */
  items_without_answer: string[];
  /** Answer ids items.json does not carry. They cannot be exported, so they are named loudly. */
  answers_naming_no_item: string[];
  /** Answers whose copy of the question is not byte-identical to the item's. */
  question_text_mismatches: { item_id: string; in_items: string; in_answer: string }[];
  answers_without_refutation: string[];
  detector_gap_items: string[];
  /**
   * Searches whose `hit_count` exceeds the hits they list. Only listed lines can be checked, so a
   * search claiming 47 hits and listing none has had nothing checked while reading, wherever it is
   * printed, as 47 found lines. The same population `QuoteVerificationSummary` carries, computed by
   * the same exported function.
   */
  searches_reporting_more_hits_than_listed: string[];
  /** Whether the questionnaire these answers name is the questionnaire on disk. */
  source_pin: { answers_sha256: string; stored_sha256: string; matches: boolean };
  /**
   * Evidence entries whose quote this tool wrote from a declared location, and the ones it refused
   * to write — the same field `QuoteVerificationSummary` carries, produced by the same exported
   * pass over the same `CodeEvidence` shape. Present only where at least one entry named a location
   * and no text.
   */
  extractions?: QuoteVerificationSummary["extractions"];
  not_verified_here: string[];
}

/** answers.json — the drafted answers. This is the document that leaves the user's machine. */
export interface QuestionnaireAnswers {
  questionnaire: QuestionnairePin;
  target: string;
  agent_model?: string;
  answers: QuestionnaireAnswer[];
  answered_at: string;
  disclaimer: string;
  /** Written by `questionnaire verify` into its annotated copy, never into the agent's own file. */
  quote_verification?: AnswerVerificationSummary;
}

/* --------------------------------------------------------------------------------------------- *
 * reconcile-diff.json — what moved between two pillar-2 runs.
 *
 * The comparison of two reconciliation runs: which side moved (the code, or the documents), and
 * which of the earlier conclusions that leaves stale. `reconcile-diff.schema.json` is authoritative
 * for the shape AND for how two runs' records are matched — `$defs.contentKey` there is the single
 * statement of the normalisation, and it is deliberately not restated in these types or in the CLI.
 * --------------------------------------------------------------------------------------------- */

/** Which of the two runs a record, a conclusion or an absence belongs to. */
export type ReconcileDiffSide = "before" | "after";

/** One run, as its own artifacts describe it. Nullable fields are written as an explicit null. */
export interface ReconcileRunIdentity {
  dir: string;
  reconcile_id: string;
  generated_at: string;
  target: string;
  bundle_version: string;
  bundle_sha256: string | null;
  documents: number;
  census_facts: number;
  input_file: string;
  /** Which agent report was read: the agent's own file, the annotated copy, or null for neither. */
  report_file: string | null;
  report_reconcile_id: string | null;
  report_completed_at: string | null;
  findings_file: string | null;
  findings_scan_id: string | null;
  findings_target: string | null;
  /** Rows of the findings file's candidates array. The candidates themselves are never compared. */
  findings_candidates: number | null;
}

/** One census fact, copied out of the run that carried it. `value` is never normalised. */
export interface ReconcileDiffFactRef {
  fact_id: string;
  collector: string;
  kind: string;
  value: string;
  categories: string[];
  file: string;
  line: number;
}

/** A fact present in both runs at two line numbers. Its `fact_id` and `line` are the after run's. */
export interface ReconcileDiffMovedFact extends ReconcileDiffFactRef {
  before_line: number;
  after_line: number;
  before_fact_id: string;
}

/** One document, as each run read it. A null says which run did not have it. */
export interface ReconcileDiffDocumentEntry {
  doc_path: string;
  before_sha256: string | null;
  after_sha256: string | null;
  before_bytes: number | null;
  after_bytes: number | null;
}

export type ReconcileDiffStaleRefKind =
  | "checklist_item"
  | "checklist_result"
  | "claim"
  | "finding";

/**
 * The conclusion a stale entry is about.
 *
 * `checklist_item` and `checklist_result` are deliberately two kinds rather than one: the first is a
 * question in the bundle, reached through its own `census_categories`, and the second is an answer in
 * a report, reached through its quoted evidence. They are reached by different evidence, and merging
 * them would hide which.
 */
export interface ReconcileDiffStaleRef {
  kind: ReconcileDiffStaleRefKind;
  checklist_id?: string;
  item_id?: string;
  claim_id?: string;
  finding_id?: string;
  doc?: string;
  direction?: string;
  found_in: ReconcileDiffSide;
}

/** How a conclusion was tied to what moved. Named so a reader can disagree with the link. */
export type ReconcileDiffStaleLink =
  | "census-categories"
  | "fact-refs"
  | "search-touches-file"
  | "runtime-config-shared"
  | "claim-in-document"
  | "evidence-in-document"
  | "quote-in-document"
  /**
   * The finding CITES the document — in `evidence[].document_ref`, or in a search hit's
   * `document_ref`. Added 2026-09-03 with those two fields: before them a finding's only document
   * link was its own singular `quote`, and a finding whose document passages sit in `evidence[]`
   * would have gone unflagged when that document's bytes moved. A new field a reader does not read
   * is a link that silently stops being followed.
   */
  | "cites-document";

/**
 * One conclusion worth looking at again.
 *
 * `possibly-stale` and `needs-re-checking` are the strongest words this document has, and neither
 * asserts that anything is wrong. One entry per conclusion, per side, per link — never one per
 * trigger; every trigger is kept in `moved_facts` and `moved_documents`, complete and uncut.
 */
export interface ReconcileDiffStaleEntry {
  ref: ReconcileDiffStaleRef;
  side: "code" | "documents";
  status: "possibly-stale" | "needs-re-checking";
  link: ReconcileDiffStaleLink;
  moved_facts: ReconcileDiffFactRef[];
  moved_documents: string[];
  reason: string;
}

/**
 * Where the before run's claim quotation sits in the after run's text.
 *
 * The same waterfall `reconcile-verify` runs, called and not copied, with the needle and the haystack
 * taken from two different runs. `QuoteCheck` is the statement of record for what the five statuses
 * mean; `fallback` carries the same warning it carries there.
 */
export interface ReconcileDiffReAnchor {
  status: QuoteVerificationStatus;
  tier: QuoteMatchTier | null;
  fallback: boolean;
  final_source: string | null;
  final_lines: number[];
  notes: string[];
}

/** One claim followed across the two runs. Nullable fields are written as an explicit null. */
export interface ReconcileDiffClaimPair {
  claim_id_before: string | null;
  claim_id_after: string | null;
  doc: string;
  outcome: "unchanged" | "moved" | "changed" | "vanished" | "appeared";
  before_line: number | null;
  after_line: number | null;
  /** Which key paired the two. Null for an unpaired row. */
  matched_on: "claim-and-quote" | "claim-text" | "quote-text" | null;
  re_anchor: ReconcileDiffReAnchor | null;
}

/**
 * One record that paired with nothing on the other side.
 *
 * The ledger that makes the comparison checkable: for each class and side, the matched pairs plus
 * these equal that side's total, so a record cannot be dropped in silence.
 */
export interface ReconcileDiffUnmatched {
  record_class:
    | "document"
    | "census_fact"
    | "checklist_item"
    | "checklist_result"
    | "claim"
    | "finding";
  side: ReconcileDiffSide;
  key: string;
  label: string;
}

/** One record class, counted the same way as every other. `unchanged` never counts as a difference. */
export interface ReconcileDiffCounts {
  before: number;
  after: number;
  added: number;
  removed: number;
  moved: number;
  unchanged: number;
}

/** A section that was not computed, with the reason. Two branches, so a gap is never a zero. */
export interface ReconcileDiffNotComputed {
  computed: false;
  reason: string;
}

export type ReconcileDiffMaybeCounts = ReconcileDiffCounts | ReconcileDiffNotComputed;

/**
 * What an incremental re-check may skip.
 *
 * What that is NOT is stated in `ReconcileDiff.not_asserted`, which is written on every output
 * whatever each run carried. It used to sit here, and here it went missing in exactly the shape this
 * command is most used in — an earlier run with a report, a later run with only the deterministic
 * half — where this whole object is replaced by a not-computed branch.
 */
export interface ReconcileDiffSaved {
  computed: true;
  checklist_results: number;
  claims: number;
  findings: number;
  total: number;
  of_matched: number;
}

/** reconcile-diff.json — the whole comparison. */
export interface ReconcileDiff {
  tool: "reconcile-diff";
  diff_version: number;
  runs: { before: ReconcileRunIdentity; after: ReconcileRunIdentity };
  bundle_mismatch: {
    before_version: string;
    after_version: string;
    before_sha256: string | null;
    after_sha256: string | null;
    note: string;
  } | null;
  reconcile_id_collision: string | null;
  target_mismatch: string | null;
  absences: string[];
  documents: {
    added: ReconcileDiffDocumentEntry[];
    removed: ReconcileDiffDocumentEntry[];
    changed: ReconcileDiffDocumentEntry[];
    unchanged: number;
  };
  census_facts: {
    added: ReconcileDiffFactRef[];
    removed: ReconcileDiffFactRef[];
    moved: ReconcileDiffMovedFact[];
    unchanged: number;
  };
  checklist_items: { added: string[]; removed: string[]; unchanged: number };
  checklist_results: ReconcileDiffMaybeCounts;
  claims: ReconcileDiffMaybeCounts;
  findings: ReconcileDiffMaybeCounts;
  claim_tracking: ReconcileDiffClaimPair[];
  possibly_stale: ReconcileDiffStaleEntry[];
  /**
   * What this comparison cannot see, on every output whatever each run carried: which links it
   * follows, the glob qualification on the searches link, that a saved conclusion is not a
   * re-verified one, and which of those links were available in THIS run's shape.
   */
  not_asserted: string;
  unmatched: ReconcileDiffUnmatched[];
  stats: {
    documents: ReconcileDiffCounts;
    census_facts: ReconcileDiffCounts;
    checklist_items: ReconcileDiffCounts;
    checklist_results: ReconcileDiffMaybeCounts;
    claims: ReconcileDiffMaybeCounts;
    findings: ReconcileDiffMaybeCounts;
    possibly_stale: number;
    needs_re_checking: number;
    unmatched: number;
    /** The number the exit code turns on: added + removed + moved over the six blocks above. */
    differences: number;
    saved: ReconcileDiffSaved | ReconcileDiffNotComputed;
  };
  disclaimer: string;
}
