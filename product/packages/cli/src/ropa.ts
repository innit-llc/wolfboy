import type {
  Candidate,
  ChecklistResult,
  DeclarationClaim,
  DeclarationFinding,
  DeclarationsReport,
  Findings,
  QuoteCheck,
  RuleWithoutCandidates,
} from "wolfboy-schemas";
import { inertJoin, markdownCode, markdownText, md, ours, type Inert } from "./printed-output.js";

/**
 * The RoPA emitter: a layer-1 scan plus a layer-2 adjudication in, a compliance platform's
 * bulk-import spreadsheet out.
 *
 * GDPR Art. 30(1) requires a controller to keep a record of processing activities. Vanta's data
 * inventory has no public write API and documents its intake as a spreadsheet bulk import,
 * so v1 of this channel is an output format
 * rather than an integration. This file is that output format.
 *
 * ## What this file may and may not do
 *
 * **It renders. It does not decide.** The activity rows, their field text and the verdicts all
 * arrive in `RopaInput`, written by layer 2 — the LLM adjudication that runs in the user's own
 * agent, reads the matched lines in context, and is the only part of the pipeline permitted to
 * conclude anything. Layer 1 is a hypothesis generator,
 * and this emitter is downstream of both.
 *
 * What it does own is the part that has to be the same on every row of every export:
 *
 * 1. **Operator fields are never filled from source.** `purpose_of_processing` and controller
 *    identity are facts about what an organisation does, not about what its code contains, and
 *    the project's rules forbid inferring them from source vocabulary. There is no code path in this file
 *    by which layer 2 can supply a purpose: the cell is composed here, always, and always says a
 *    human must answer it. Vanta requires that same field to import, so an export from this product
 *    is deliberately unimportable until a person answers one question per row — see
 *    `unansweredOperatorFields`.
 * 2. **Absence is never rendered as compliance**. Every empty cell is filled from a
 *    closed vocabulary of absence phrases; a caller cannot put "none", "clean" or "compliant" into
 *    one, because the phrase is chosen here from the field, not passed in.
 * 3. **Recipients are offered, never in use.** The status enum has no `in_use` member and
 *    `assertNeverInUse` refuses free text that says it anyway — on **both** recipient cells, the
 *    status and the vendor list, which is every free-text path a caller has into either. Wiki.js is
 *    the worked example the rule comes from: every analytics provider it ships is an optional
 *    module an operator switches on, so the code shows the option and the operator settles the
 *    choice.
 * 4. **The provenance chain is checked, not asserted — in both directions.** Every evidence
 *    reference either names a (rule id, file) pair that appears in the layer-1 findings, or is
 *    marked as a layer-2 extension — a place layer 2 read beyond what any detector raised.
 *    `buildRopa` throws when a row claims a backing the scan does not contain, so a row that says
 *    "layer1 X -> layer2 real" means it. **The absence half is checked too**: an extension label is
 *    not written from the caller's empty `backed_by` alone, it is looked up in the scan, and where
 *    some other rule did raise a candidate at that reference the cell says which. An absence claim
 *    this product emits is checked by this product; that is the same argument the design makes about
 *    `apparently_absent`, one column over.
 * 5. **`declared` is a fifth thing a cell can be, and it is not an answer.** Beside `derived`,
 *    `layer2`, `operator` and the absence vocabulary there is now one more source: a statement
 *    **the organisation itself published**, read by pillar 2 out of the developer's own documents,
 *    quoted verbatim with its location, and **machine-checked against the pinned document by
 *    `reconcile-verify`**. It is never inferred from source code and it never fills an operator
 *    field: `purpose_of_processing` is composed by `operatorMarker` on every row on every path,
 *    whether or not a declared purpose was found beside it. What the declared cells do is put the
 *    person's own words in front of them, so the answer they still have to give is a confirmation
 *    rather than a blank page. **Nothing declared is ever rendered without its verification
 *    state** — a quotation nobody could confirm reads `UNVERIFIED`, and a report that never went
 *    through `reconcile-verify` makes every declared cell say so. A quotation of somebody's own
 *    published policy is the most persuasive thing this export can carry, and an unchecked one is
 *    the confabulated contradiction the pillar-2 skill calls its worst failure mode.
 *
 * ## Where the declared route is on, and where it is not
 *
 * The declared columns, the document's controller-identity pre-fill and the README's declared
 * section exist **only when the `ropa` command was given `--reconcile`**. Without it the six
 * emitted files are byte for byte what they were before this feature existed, which
 * a test asserts rather than asserts about. That the documents were not
 * read is not left silent: it is on the console, on the export summary, and in `absencePhrase`'s
 * own closed vocabulary as `Declared documents not read (ropa run without --reconcile)`.
 */

// ------------------------------------------------------------------------------------------------
// The column table
// ------------------------------------------------------------------------------------------------

/**
 * **The one place the output's column set is declared.** Adding, removing, renaming or reordering a
 * column of `processing-activities.csv` is an edit to this array and to nothing else: the header
 * line, the cell order and the per-row renderer all walk it.
 *
 * It is a single table for a reason that is not stylistic. Vanta publishes its own downloadable
 * spreadsheet template for this import — "Click Download the Vanta template to prepare your
 * spreadsheet"
 * — and **nobody has read that template's actual
 * column headers**, because the download sits behind a login and no account has been created. The
 * headers below are the hand-assembled 2026-08-20 prototype's, which is the best shape available
 * today and is certain to need re-mapping once the template is seen. When it is, this array is the
 * edit.
 *
 * `required_by_platform` records the one hard fact the research did establish: Vanta requires
 * exactly two fields — "Only the processing activity name and data processing purpose are required
 * to create a processing activity" — and one of those two is an operator field this product refuses
 * to infer.
 */
export interface RopaColumn {
  /** Internal key. Stable; not written to the file. */
  key: string;
  /** The header written to the CSV. Re-map here when the platform's own template is read. */
  header: string;
  /**
   * `derived` — composed by this file from the layer-1 findings and the layer-2 verdicts.
   * `layer2` — observation text written by the adjudicating agent.
   * `operator` — a fact about the organisation. Never filled from source, on any path.
   * `declared` — **stated in the organisation's own published documents as read by pillar 2,
   * quoted verbatim with the document and the line it came from, and machine-verified against the
   * pinned document by `reconcile-verify`.** Never inferred from source vocabulary, and never a
   * substitute for the person's own answer: a `declared` cell sits beside an `operator` cell and
   * shows the person what their own document already says, with the quotation, the location and
   * the verification state, so that confirming it is a reading rather than a composition. A
   * `declared` cell is not an evidence column — it says nothing about what the code does — so
   * `renderRowStatus` excludes it from the observed/unobserved count and reports it in a clause of
   * its own.
   */
  source: "derived" | "layer2" | "operator" | "declared";
  /** True for the fields Vanta's documentation names as required to create a processing activity. */
  required_by_platform: boolean;
  /**
   * What the customer has to create on the platform side to receive this column, and of what type.
   *
   * **Vanta's field set is not fixed**, which is why this is a per-column property rather than an
   * attempt to hit a foreign schema: beyond the two required built-in fields and the built-in
   * Processing vendors field, the account owner adds their own custom fields, typed "text, number,
   * date, or multi-select".
   * The customer creates fields to receive these
   * columns and maps them at upload, so the output does not have to be contorted toward a guessed
   * shape.
   *
   * **It is emitted because the setup step is one-time, invisible, and not something this tool can
   * do or undo.** A multi-select field and a text field are not interchangeable: create
   * `personal_data_categories` as text and the platform can never filter or group by category
   * afterwards, and nothing about the import will complain. `vanta-custom-fields.csv` carries this
   * table so that whoever does the setup has it in front of them.
   */
  platform_field:
    | { kind: "built_in"; as: string; note?: string }
    | { kind: "custom"; type: "text" | "number" | "date" | "multi_select"; note?: string };
}

const TEXT = { kind: "custom", type: "text" } as const;
const MULTI = { kind: "custom", type: "multi_select" } as const;

export const PROCESSING_ACTIVITY_COLUMNS: readonly RopaColumn[] = [
  {
    key: "processing_activity_name",
    header: "processing_activity_name",
    source: "layer2",
    required_by_platform: true,
    platform_field: { kind: "built_in", as: "Processing activity name" },
  },
  {
    key: "purpose_of_processing",
    header: "purpose_of_processing",
    source: "operator",
    required_by_platform: true,
    platform_field: {
      kind: "built_in",
      as: "Data processing purpose",
      note: "Required by the platform and never filled by this tool. A person answers one per row before import.",
    },
  },
  { key: "data_subject_categories", header: "data_subject_categories", source: "layer2", required_by_platform: false, platform_field: MULTI },
  { key: "personal_data_categories", header: "personal_data_categories", source: "layer2", required_by_platform: false, platform_field: MULTI },
  { key: "special_category_data", header: "special_category_data", source: "derived", required_by_platform: false, platform_field: TEXT },
  {
    key: "recipients",
    header: "recipients",
    source: "derived",
    required_by_platform: false,
    platform_field: {
      kind: "built_in",
      as: "Processing vendors",
      // The impedance mismatch, recorded where the mapping is decided rather than in a document
      // nobody re-reads. Vanta's Processing vendors field is a search-and-select against the
      // account's own existing vendor list, not free text, so a semicolon-separated string of
      // vendor names does not simply land in it. Reconciling a detected vendor with a platform's
      // vendor record is the recipients family's problem (V2b) and a later phase's, not this one's.
      note: "Search-and-select against the account's own vendor list, not free text. A vendor this scan names may not exist there yet; reconciling the two is not solved here.",
    },
  },
  { key: "recipient_status", header: "recipient_status", source: "derived", required_by_platform: false, platform_field: TEXT },
  { key: "international_transfer", header: "international_transfer", source: "derived", required_by_platform: false, platform_field: TEXT },
  { key: "retention_period", header: "retention_period", source: "derived", required_by_platform: false, platform_field: TEXT },
  { key: "security_measures", header: "security_measures", source: "derived", required_by_platform: false, platform_field: TEXT },
  { key: "source_evidence", header: "source_evidence", source: "derived", required_by_platform: false, platform_field: TEXT },
  { key: "provenance", header: "provenance", source: "derived", required_by_platform: false, platform_field: TEXT },
  { key: "row_status", header: "row_status", source: "derived", required_by_platform: false, platform_field: TEXT },
] as const;

/**
 * The two columns the declared route adds, and the only two `declared` columns that exist.
 *
 * **They are a separate array rather than two more entries in the table above, and the reason is
 * mechanical.** A `ropa` run with no `--reconcile` has read no declared document, and a column set
 * that carried these anyway would put two cells on every row of every export saying so — which is
 * both wider than the change and impossible to reconcile with the requirement that the no-reconcile
 * output stay byte for byte what it was. `processingActivityColumns()` is the one place the two
 * shapes are chosen between, and `vanta-custom-fields.csv` is derived from whichever it returns, so
 * a customer who never runs pillar 2 is never told to create two custom fields nothing will fill.
 *
 * They sit immediately after `purpose_of_processing` because that is the whole design: the
 * declared purpose is read BESIDE the operator blank, not instead of it.
 */
export const DECLARED_ACTIVITY_COLUMNS: readonly RopaColumn[] = [
  {
    key: "declared_purpose",
    header: "declared_purpose",
    source: "declared",
    required_by_platform: false,
    platform_field: {
      kind: "custom",
      type: "text",
      note: "What your own published documents already say about this activity, quoted with the document, the line and whether the quotation was confirmed in that document. It is not the processing purpose the platform requires: a person still answers that.",
    },
  },
  {
    key: "declaration_findings",
    header: "declaration_findings",
    source: "declared",
    required_by_platform: false,
    platform_field: {
      kind: "custom",
      type: "text",
      note: "Places where pillar 2 read your published documents against this activity's code and the two did not appear to match. A question for the people who own both, never a conclusion about the law.",
    },
  },
] as const;

/**
 * The column set of `processing-activities.csv` for one run.
 *
 * Two shapes and no third: the thirteen columns this export has always had, and those thirteen with
 * the two declared columns spliced in after the operator's purpose cell. Every reader of the shape —
 * the header line, the per-row renderer, `renderRowStatus`'s evidence-column filter and the
 * custom-field setup sheet — walks what this returns, so the two shapes cannot disagree about where
 * a column sits.
 */
export function processingActivityColumns(withDeclared: boolean): readonly RopaColumn[] {
  if (!withDeclared) return PROCESSING_ACTIVITY_COLUMNS;
  const at = PROCESSING_ACTIVITY_COLUMNS.findIndex((c) => c.key === "purpose_of_processing");
  const after = at < 0 ? PROCESSING_ACTIVITY_COLUMNS.length : at + 1;
  return [
    ...PROCESSING_ACTIVITY_COLUMNS.slice(0, after),
    ...DECLARED_ACTIVITY_COLUMNS,
    ...PROCESSING_ACTIVITY_COLUMNS.slice(after),
  ];
}

export const OPEN_QUESTION_COLUMNS: readonly RopaColumn[] = [
  { key: "question_id", header: "question_id", source: "layer2", required_by_platform: false, platform_field: TEXT },
  { key: "blocks", header: "blocks", source: "layer2", required_by_platform: false, platform_field: TEXT },
  { key: "question", header: "question", source: "layer2", required_by_platform: false, platform_field: TEXT },
  { key: "why_code_cannot_answer", header: "why_code_cannot_answer", source: "layer2", required_by_platform: false, platform_field: TEXT },
  { key: "applicability_date", header: "applicability_date", source: "derived", required_by_platform: false, platform_field: TEXT },
  { key: "source_evidence", header: "source_evidence", source: "layer2", required_by_platform: false, platform_field: TEXT },
] as const;

/**
 * The one-time setup list: what to create on the platform side, and of what type, before the first
 * import. Derived from `PROCESSING_ACTIVITY_COLUMNS` — there is no second copy of the mapping.
 */
export const CUSTOM_FIELD_COLUMNS: readonly RopaColumn[] = [
  { key: "csv_column", header: "csv_column", source: "derived", required_by_platform: false, platform_field: TEXT },
  { key: "create_as", header: "create_as", source: "derived", required_by_platform: false, platform_field: TEXT },
  { key: "field_type", header: "field_type", source: "derived", required_by_platform: false, platform_field: TEXT },
  { key: "who_fills_it", header: "who_fills_it", source: "derived", required_by_platform: false, platform_field: TEXT },
  { key: "note", header: "note", source: "derived", required_by_platform: false, platform_field: TEXT },
] as const;

/**
 * The third file, and the reason the export is a directory rather than two loose spreadsheets.
 *
 * The design is explicit that the three states a silent rule can be in must be carried "by
 * the output format, not by prose describing it". The 2026-08-20 prototype recorded them in its
 * method document instead — its own README says so: "Rules that produced no candidate at all are
 * recorded as `unknown` in the method document, never as clean." That is the honest thing to do
 * with a hand-assembled artefact and the wrong thing to do with a feature: what gets pushed into a
 * compliance platform is the export, and an export that carries only what was found says by
 * omission that everything else was in order. That is decision 1's statement one file over.
 */
export const UNKNOWN_RULE_COLUMNS: readonly RopaColumn[] = [
  { key: "rule_id", header: "rule_id", source: "derived", required_by_platform: false, platform_field: TEXT },
  { key: "state", header: "state", source: "derived", required_by_platform: false, platform_field: TEXT },
  { key: "what_the_detector_looked_for", header: "what_the_detector_looked_for", source: "derived", required_by_platform: false, platform_field: TEXT },
  { key: "files_on_surface", header: "files_on_surface", source: "derived", required_by_platform: false, platform_field: { kind: "custom", type: "number" } },
  { key: "matched_then_gated", header: "matched_then_gated", source: "derived", required_by_platform: false, platform_field: { kind: "custom", type: "number" } },
  { key: "layer2_outcome", header: "layer2_outcome", source: "derived", required_by_platform: false, platform_field: MULTI },
  { key: "layer2_searched", header: "layer2_searched", source: "layer2", required_by_platform: false, platform_field: TEXT },
  /**
   * The design calls `gap found — detector missed it` "the most valuable output in the
   * design" and says it is "Reported with file, line and quote". Until 2026-08-24 those three
   * things reached no emitted file: the row pointed the reader at "the evidence quoted in the
   * layer-2 record", a file an importing auditor does not have. This column carries them.
   */
  { key: "layer2_evidence", header: "layer2_evidence", source: "layer2", required_by_platform: false, platform_field: TEXT },
  { key: "what_this_row_claims", header: "what_this_row_claims", source: "derived", required_by_platform: false, platform_field: TEXT },
] as const;

// ------------------------------------------------------------------------------------------------
// The input: what layer 2 hands the emitter
// ------------------------------------------------------------------------------------------------

/** One (rule id, file) pair that a layer-1 candidate actually raised. Verified against the scan. */
export interface EvidenceBacking {
  rule_id: string;
  file: string;
}

/**
 * One entry in a row's `source_evidence` cell.
 *
 * `ref` is the display text and may be a path, a path with a line, or a brace/glob shorthand for a
 * set of them — the prototype uses all three. `backed_by` is what makes the cell audit evidence
 * rather than a claim: each entry names a layer-1 candidate location that must exist in the scan.
 *
 * **An empty `backed_by` is not an error and is not hidden.** Layer 2 reads the repository and
 * routinely finds what no detector raised — a wiki application's `comments` schema carries the commenter's
 * IP address and no rule declared it. That is the most valuable thing the second layer does
 * (the design's `gap found` outcome), so the emitter labels it in the row's provenance
 * instead of letting it read as though a detector had produced it.
 */
export interface EvidenceRef {
  ref: string;
  /** Parenthesised after `ref`. Free text from layer 2. */
  note?: string;
  /** Ask the emitter to compute the note instead: `location_count` renders "(N locations)". */
  note_from_backing?: "location_count";
  backed_by: EvidenceBacking[];
}

/** Recipients as the design permits them to be stated, and no other way. */
export type RecipientBlock =
  | { status: "none_observed" }
  | {
      /** The codebase offers the vendor; an operator switch decides whether it is used. */
      status: "offered";
      vendors: string[];
      /** Appended after the vendor list, following an em dash. */
      list_note?: string;
      /** What the operator has to confirm. Rendered after "Offered by the codebase — ". */
      confirm: string;
    }
  | {
      /** The vendor is compiled into or shipped with an artefact; no operator switch was found. */
      status: "shipped";
      vendors: string[];
      list_note?: string;
      /** The status cell verbatim. Still may not say the recipient is in use — see assertNeverInUse. */
      status_text: string;
    };

/** A field layer 2 either observed, observed the absence of, or could not assess. */
export type Observation = string | null | { observed: false; scope?: AbsenceScope } | { not_assessed: string };

/**
 * The closed vocabulary of absence phrases. A caller picks the SCOPE; the emitter picks the words.
 *
 * This is the mechanical half of the design's rule. If absence were free text, an export could say
 * "none", "compliant" or "no issues found" in a cell, and the whole discipline would rest on
 * whoever wrote that string. It cannot: `absencePhrase` is the only producer of these cells.
 */
export type AbsenceScope = "activity" | "path" | "source";

export interface RopaActivity {
  id: string;
  name: string;
  /**
   * A reason clause layer 2 may supply, printed INSIDE the operator marker after a colon.
   *
   * **It is free text and nothing reads it**: a caller that writes a purpose here gets that sentence
   * printed inside the marker. Until 2026-09-03 this comment said the opposite — *"it never contains
   * a purpose and cannot"* — which is not a property of the field and is enforced nowhere.
   * (Independent verification, 2026-09-02, V.8.)
   *
   * What IS enforced is the thing that claim was reaching for, one level up: **the cell this text
   * lands in cannot stop being an operator blank.** `purpose_of_processing` is
   * `operatorMarker(purpose_note)` on every row on every path, `operatorMarker` takes no argument by
   * which the marker can be suppressed or replaced, and the note can only follow the marker's own
   * opening — so the cell still begins with `OPERATOR_MARKER_PREFIX`, `fieldAnswerState` still calls
   * it `operator`, and `renderRowStatus`, the `.docx` and the README all still count it as an answer
   * a person owes. A note that reads like a purpose is therefore text printed beside an unanswered
   * question, never an answer to it, and the blocked-row count does not move when one is supplied.
   *
   * `ropa-input.schema.json` declares `additionalProperties: false` on an activity, but **the `ropa`
   * command does not validate `--layer2` against it** (`index.ts` parses the file and casts it), so
   * what stops a purpose arriving in a field of its own is that `buildRopa` reads no activity key
   * but `purpose_note` — its single reader is the `operatorMarker` call in the row builder. The
   * schema is enforced only by the gates, over committed fixtures. Neither it nor this file polices
   * the wording of this one. (This paragraph replaced a false enforcement claim of its own on
   * 2026-09-03: independent verification, F3, fed an input carrying `purpose`,
   * `purpose_of_processing` and an unknown key and got exit 0 with all six files written.)
   */
  purpose_note?: string;
  data_subjects: string;
  personal_data: string;
  special_category: Observation;
  recipients: RecipientBlock;
  international_transfer: Observation;
  retention: Observation;
  security_measures: Observation;
  /**
   * The layer-1 rules that proposed this activity and that layer 2 ruled real. Checked twice: every
   * rule here must carry at least one `real` verdict, and every rule named in an evidence backing
   * must appear here.
   */
  proposed_by: string[];
  evidence: EvidenceRef[];
  /**
   * What to put in the provenance cell's parentheses. `inventory` says the rule was adjudicated as
   * a store inventory rather than pass/fail; `location_count` asks the emitter to count locations
   * and their verdicts; `null` asks for no qualifier.
   */
  provenance_qualifier: "inventory" | "location_count" | null;
  /**
   * Claim ids from the pillar-2 report whose quotations bear on what this activity is FOR.
   *
   * **Ids, not text.** The layer-2 agent decides which of the organisation's own published
   * statements answer to this row; the emitter resolves each id in the report and renders the
   * report's own verbatim quotation, its document and line, and its verification state. Writing the
   * text here instead would let a paraphrase reach the export wearing a quotation's authority, which
   * is the one thing a declared cell may never do. An id the report does not carry makes `buildRopa`
   * throw, on the same discipline as an evidence backing the scan does not contain.
   */
  declared_purpose_claims?: string[];
  /** Finding ids from the pillar-2 report that bear on this activity. Resolved the same way. */
  declaration_finding_ids?: string[];
}

export interface RopaOpenQuestion {
  id: string;
  blocks: string[];
  question: string;
  why_code_cannot_answer: string;
  /**
   * The rules whose obligation this question blocks. **Required, and the reason is a recorded
   * defect.** The project's rules name the missing applicability date as "the plainest" of the 2026-08-04
   * legal-accuracy failures: checklists shipped with no date in any parsed field, against a written
   * requirement that every finding be worded as preparation. Here the date is not written down at
   * all — it is read out of the rules' own `effective_date` in the scan, so a question about a duty
   * that has not started cannot be rendered as one that has.
   */
  rule_ids: string[];
  /** Rendered after "in force since". Use where layer 2 wants the date shown on a duty already in force. */
  date_style?: "since";
  /** Free text appended in the parenthesis of a not-yet-in-force date, e.g. "preparation only". */
  date_note?: string;
  source_evidence: string | null;
}

/** The design's outcomes, on the evidence-log schema's own terms. */
export type SilentRuleOutcome =
  | "not_checked"
  | "construct_found"
  | "apparently_absent"
  | "not_evaluated"
  | "out_of_jurisdiction";

export interface SilentRule {
  rule_id: string;
  outcome: SilentRuleOutcome;
  /** Every search run, including the ones that returned nothing. Required in substance for `apparently_absent`. */
  searched?: string[];
  /** For `construct_found`: where the construct layer 1 missed actually is. */
  evidence?: { file: string; lines: string; quote: string }[];
  note?: string;
}

export interface RopaInput {
  format: "ropa-input/1";
  scan_id: string;
  target_label?: string;
  as_of: string;
  verdicts: { finding_id: string; rule_id: string; verdict: "real" | "dismissed"; basis?: string; recorded_in?: string }[];
  activities: RopaActivity[];
  open_questions: RopaOpenQuestion[];
  silent_rules: SilentRule[];
}

// ------------------------------------------------------------------------------------------------
// Absence, operator fields and the recipient rule — the three things this file will not delegate
// ------------------------------------------------------------------------------------------------

/**
 * The absence phrase for a column and a scope. **Every empty cell in every emitted file comes from
 * here**, which is what makes the design's rule a property of the code rather than of the prose.
 *
 * The three scopes are the prototype's own: "for this activity" where the question was asked of one
 * activity, "for this path" where it was asked of one code path, and "in source" where the scan as
 * a whole saw nothing. None of them says a duty is met.
 */
export function absencePhrase(columnKey: string, scope?: AbsenceScope): string {
  if (scope === "activity") return "None observed for this activity";
  if (scope === "path") return "None observed for this path";
  if (scope === "source") return "Not observed in source";
  // Column defaults, where layer 2 named no scope.
  if (columnKey === "special_category_data") return "None observed";
  if (columnKey === "recipients") return "None observed for this activity";
  // The declared route's own four, and they are here rather than as free text for exactly the
  // reason the rest of this vocabulary is: an empty declared cell is the one a reader is most
  // likely to read as "we checked your policy and it was fine". None of these says that. The three
  // states they keep apart are the three that matter — the documents were never read, they were
  // read and nothing in them was mapped to this row, and the checklist item that would have
  // answered it was never walked.
  if (columnKey === "declared_purpose") return "No declared purpose mapped for this activity";
  if (columnKey === "declaration_findings") return "No declaration finding mapped for this activity";
  if (columnKey === "declared_documents") return "Declared documents not read (ropa run without --reconcile)";
  if (columnKey === "declared_checklist_item") return "Checklist item not walked in the declaration reconciliation";
  if (columnKey === "declared_quote") return "No quotation recorded for this checklist item";
  if (columnKey === "declared_checklist") return "Checklist not carried in the declaration reconciliation";
  return "Not observed in source";
}

/**
 * Every string `absencePhrase` can produce, as a set.
 *
 * Exported so that `renderRowStatus` can recognise its own output and so that the gate can assert
 * the two agree, rather than either of them carrying a second hand-written copy of the vocabulary — Never keep a second copy of anything two places must agree on.
 */
export const ABSENCE_PHRASES: ReadonlySet<string> = new Set([
  absencePhrase("", "activity"),
  absencePhrase("", "path"),
  absencePhrase("", "source"),
  absencePhrase("special_category_data"),
  absencePhrase("recipients"),
  absencePhrase("declared_purpose"),
  absencePhrase("declaration_findings"),
  absencePhrase("declared_documents"),
  absencePhrase("declared_checklist_item"),
  absencePhrase("declared_quote"),
  absencePhrase("declared_checklist"),
  absencePhrase(""),
]);

/**
 * The prefix `renderObservation` writes when layer 2 declines to assess a field.
 *
 * Exported because it had already been copied twice — once inline in `renderObservation`, once as a
 * literal inside the gate — and V1b's document renderer would have been the third. It is the same
 * argument `ABSENCE_PHRASES` makes one constant up: never keep a second copy of anything two places
 * must agree on.
 */
export const NOT_ASSESSED_PREFIX = "Not assessed — ";

/** The prefix every operator marker opens with, whether or not it carries a reason clause. */
export const OPERATOR_MARKER_PREFIX = "[REQUIRED — OPERATOR MUST ANSWER";

/**
 * The operator marker. **There is deliberately no argument by which the marker can be suppressed or
 * replaced**: every return value opens with `OPERATOR_MARKER_PREFIX`, and `note` can only ever
 * follow it after a colon, inside the brackets.
 *
 * That is the true form of a claim this comment carried until 2026-09-03 — *"there is deliberately
 * no parameter by which a purpose can be supplied"* — which was the same false-as-worded sentence
 * ruled on in V.8 for `RopaActivity.purpose_note`, one function away and in the function that
 * comment cites as its guarantee. `note` is free text and nothing reads it, so purpose-shaped words
 * CAN be supplied; what cannot be supplied is an answer, because whatever the note says is printed
 * beside the unanswered question rather than in place of it. Found beside F3 by the independent
 * verification of 2026-09-03, which demanded no repair for it; corrected here because it is the
 * second instance of one defect shape and the first was ruled a defect.
 *
 * Vanta requires this field to import. This
 * product refuses to fill it. Both are true at once and the consequence is stated rather than
 * smoothed over: an export from this tool cannot be imported until a person answers one question
 * per row. `emitRopa` counts those rows and says so in the emitted README and on the console.
 */
export function operatorMarker(note?: string): string {
  return note ? `${OPERATOR_MARKER_PREFIX}: ${note}]` : `${OPERATOR_MARKER_PREFIX}]`;
}

/**
 * Which of the four things a rendered field value is: a real observation, an absence, a declined
 * assessment, or a marker saying a person has to answer it.
 *
 * **The classification exists because the model throws the distinction away.** `special_category`,
 * `international_transfer`, `retention` and `security_measures` are already-rendered prose on
 * `RopaActivityModel`, not the `Observation` union they came from, so a second renderer cannot
 * branch on a type — it has to recognise the emitter's own closed vocabulary. Recognising it here,
 * once, is what stops that renderer carrying its own copy of the phrases.
 *
 * `renderRowStatus` and V1b's document renderer both read this, and the answer is the same word in
 * both, which is the point.
 */
export type FieldAnswerState = "answered" | "not_observed" | "not_assessed" | "operator";

export function fieldAnswerState(text: string): FieldAnswerState {
  if (text.startsWith(OPERATOR_MARKER_PREFIX)) return "operator";
  if (ABSENCE_PHRASES.has(text)) return "not_observed";
  if (text.startsWith(NOT_ASSESSED_PREFIX)) return "not_assessed";
  return "answered";
}

/**
 * Refuses any recipient text that says the recipient is in use.
 *
 * The `RecipientBlock` enum has no `in_use` member, so such a claim can only reach the file through
 * one of the free-text fields a caller supplies. The fit test's second limit is the reason the
 * check exists at all: "The scan sees the option, not the choice ... the RoPA output must present
 * recipients as *offered / to be confirmed*, never as *in use*." A RoPA row is audit evidence about
 * what an organisation actually does, and this scan cannot see that.
 *
 * **It guards BOTH recipient cells, and that is a repair rather than a design.** Until 2026-08-24
 * it was applied to `recipient_status` alone, which is one of the three free-text paths a caller
 * has: `status_text` / `confirm` (the status cell), `vendors[]` and `list_note` (the recipients
 * cell). Independent verification planted "in use in production" into a vendor name and into
 * `list_note` and both emitted with no throw, while three documents — this file's own header,
 * `ropa-input.schema.json` `$defs.recipients` and `SKILL.md` step 9 — all stated the invariant over
 * free text generally. The `recipients` cell is also the one that maps onto Vanta's built-in
 * Processing vendors field, so it is the cell most likely to be read as a statement of fact about
 * the organisation. Both cells are checked here; nothing was removed to do it. The limit the message states is the
 * fit test's second one.
 */
function assertNeverInUse(where: string, what: string, text: string): string {
  if (/\bin[ -]use\b/i.test(text) || /\bcurrently used\b/i.test(text)) {
    throw new Error(
      `${where}: the ${what} may not state that a recipient is in use — the scan sees the option, ` +
        `not the operator's choice. Got: ${text}`,
    );
  }
  return text;
}

/**
 * Refuses a recipient field the schema requires and the input did not supply.
 *
 * `undefined` interpolated into a template literal becomes the six letters "undefined", and an empty
 * vendor list joins to the empty string. Both then travel as an ordinary value: in the CSV as a cell
 * reading `Offered by the codebase — undefined`, and in V1b's document as a finished line with
 * nothing on it. `ropa-input.schema.json` `$defs.recipients` already requires `vendors` (minItems 1)
 * and requires `confirm` on an `offered` block and `status_text` on a `shipped` one; nothing enforced
 * it, because the `ropa` command parses its input rather than validating it. Refused here, once, for
 * both renderers — a second copy of this guard inside the document renderer would be free to drift
 * from this one. (V1b independent verification, 2026-08-24, SHOULD-FIX 3 and NOTE 5.)
 */
function requiredRecipientText(where: string, what: string, value: string | undefined): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `${where}: the recipient block supplies no ${what}. ropa-input.schema.json $defs.recipients requires ` +
        `it, and a cell filled with an empty string or with the word "undefined" reads as an answered field ` +
        `where nothing was answered.`,
    );
  }
  return value;
}

function renderRecipients(a: RopaActivity): { recipients: string; recipient_status: string } {
  const r = a.recipients;
  if (r.status === "none_observed") {
    return { recipients: absencePhrase("recipients"), recipient_status: "n/a" };
  }
  const where = `${a.id} (${a.name})`;
  // The composed cell rather than the parts: joining can only add text, so a check on the rendered
  // string reaches every claim either part could carry and any claim the join itself could create.
  const list = requiredRecipientText(
    where,
    "vendor name",
    r.vendors.join("; ") + (r.list_note ? ` — ${r.list_note}` : ""),
  );
  const status =
    r.status === "offered"
      ? `Offered by the codebase — ${requiredRecipientText(where, "confirm clause", r.confirm)}`
      : requiredRecipientText(where, "status text", r.status_text);
  return {
    recipients: assertNeverInUse(where, "recipients cell (vendor names and list note)", list),
    recipient_status: assertNeverInUse(where, "recipient status", status),
  };
}

function renderObservation(columnKey: string, value: Observation): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return absencePhrase(columnKey);
  if ("not_assessed" in value) return `${NOT_ASSESSED_PREFIX}${value.not_assessed}`;
  return absencePhrase(columnKey, value.scope);
}

// ------------------------------------------------------------------------------------------------
// Declared — the organisation's own published words, and the state of the check on them
// ------------------------------------------------------------------------------------------------

/**
 * What a machine was able to say about one declared quotation.
 *
 * Five states and not three, because the two extra ones are the two a reader would otherwise have
 * to infer from an absence. `not-run` says the report never went through `reconcile-verify` at all;
 * `no-check` says it did and this particular quotation was not among the ones it covered. Both of
 * those are silences, and the design's whole argument is that a silence must not wear the word a pass
 * wears.
 */
export type DeclaredVerification =
  | "verified"
  | "re-attributed"
  | "unverified"
  | "not-run"
  | "no-check"
  | "different-bytes"
  | "different-run";

/**
 * The words each state renders as. **A closed vocabulary, for the same reason `absencePhrase` is
 * one**: if a caller could write this text, an unverified quotation could be labelled verified by
 * whoever assembled the input, and the check would rest on that person rather than on the tool.
 *
 * The last two are provenance states rather than match states, added 2026-09-02 after independent
 * verification (V.4). They do NOT say the text was absent — it was found — they say the check that
 * found it read bytes the report does not vouch for, so they carry their own words instead of
 * borrowing `unverified`'s.
 */
export const DECLARED_VERIFICATION_TEXT: Readonly<Record<DeclaredVerification, string>> = {
  verified: "verified",
  "re-attributed": "re-attributed",
  unverified: "UNVERIFIED — quote not confirmed in the document",
  "not-run": "unverified (reconcile-verify not run)",
  "no-check": "UNVERIFIED — no quote check covers this quotation",
  "different-bytes":
    "UNVERIFIED — confirmed against different bytes from the ones this report records reading",
  "different-run":
    "UNVERIFIED — the verification and this report may describe different reconciliations",
};

/** Every string `DECLARED_VERIFICATION_TEXT` can produce, as a set, for a second reader. */
export const DECLARED_VERIFICATION_PHRASES: ReadonlySet<string> = new Set(
  Object.values(DECLARED_VERIFICATION_TEXT),
);

/**
 * Worst-first order. A cell covering several quotations reports the worst of them, because the
 * question a reader asks of such a cell is whether anything in it needs looking at.
 */
const DECLARED_VERIFICATION_RANK: Readonly<Record<DeclaredVerification, number>> = {
  verified: 0,
  "re-attributed": 1,
  "no-check": 2,
  "different-bytes": 3,
  "different-run": 4,
  unverified: 5,
  "not-run": 6,
};

/**
 * One quotation's state, from the `reconcile-verify` row that covers it.
 *
 * **`fallback` overrides the status word, and that is the point of the flag.** A check whose text
 * was found only by its FIRST LINE comes back wearing `repaired` — the same word an ordinary
 * drifted line number gets — while the rest of the quotation is nowhere in scope, which is what a
 * real first line with an invented remainder looks like. `reconcile-verify` puts such a row into
 * its non-zero exit for that reason and the skill sends it back to the source. Rendering it as
 * `verified` here would be the guard's whole purpose undone one consumer downstream.
 */
export function declaredVerificationOf(
  check: QuoteCheck | undefined,
  verificationRan: boolean,
): DeclaredVerification {
  if (!verificationRan) return "not-run";
  if (!check) return "no-check";
  if (check.fallback) return "unverified";
  switch (check.status) {
    case "confirmed_at_declared":
    case "repaired":
      return "verified";
    case "re_attributed":
      return "re-attributed";
    case "ambiguous":
    case "unverifiable":
      return "unverified";
    default:
      // A status this build does not know is not a pass. `reconcile-verify` owns the enum and may
      // grow it; a consumer that treated an unrecognised word as success would fail open.
      return "unverified";
  }
}

function worstVerification(states: DeclaredVerification[]): DeclaredVerification | null {
  if (states.length === 0) return null;
  return states.reduce((worst, s) =>
    DECLARED_VERIFICATION_RANK[s] > DECLARED_VERIFICATION_RANK[worst] ? s : worst,
  );
}

/** One verbatim quotation from a published document, with where it is and what confirmed it. */
export interface DeclaredQuote {
  /** The document's own words, exactly as the pillar-2 report carries them. Never paraphrased. */
  text: string;
  /** The document the quotation is in: the report's own path or URL, or the corrected one. */
  source: string;
  /** Line numbers in that document, joined. Empty where none is asserted. */
  location: string;
  verification: DeclaredVerification;
}

/**
 * `"<verbatim quote>" (<document>:<location>; <verification state>)`.
 *
 * The three parts are always present and always in that order, so that a reader skimming a
 * spreadsheet cell never has the quotation without the state. Where the state asserts no position —
 * `ambiguous` and `unverifiable` do not, by design — the location is the one the report DECLARED,
 * because that is the assertion that could not be confirmed and it is what a person has to go and
 * check.
 */
export function renderDeclaredQuote(q: DeclaredQuote): string {
  const where = q.location === "" ? q.source : `${q.source}:${q.location}`;
  return `"${q.text}" (${where}; ${DECLARED_VERIFICATION_TEXT[q.verification]})`;
}

function locationText(lines: number[] | undefined): string {
  return (lines ?? []).join(", ");
}

/**
 * What the report's own `quote_verification.provenance` says about the bytes the check read.
 *
 * Carried because a match state and a provenance state are different facts and only one of them was
 * being read. `reconcile-verify` records both, and its schema says in terms that "a quotation
 * confirmed under a mismatch was confirmed against different bytes from the ones the agent read".
 */
export interface DeclaredVerificationContext {
  verification_ran: boolean;
  /** Documents whose digest in the report differs from the reconciliation input's. */
  pin_mismatched_documents: ReadonlySet<string>;
  /** False where the report and the input the check ran against may describe different runs. */
  reconcile_id_matches: boolean;
}

/**
 * A success word demoted where the verification's own provenance does not support it.
 *
 * **Disclosure, never deletion, and never an exit code.** `reconcile-verify` itself does not fail a
 * run on a pin mismatch — `declaration-reconcile/SKILL.md` step 9 states the reason: "which bytes
 * were read and whether a quotation is real are different questions" — so refusing the export here
 * would contradict the tool the state comes from. What this does instead is stop the RoPA printing
 * `verified` over it: the quotation stays in the cell, with its text, its location, and words saying
 * exactly which of the two questions is open. Nothing is removed from any cell.
 *
 * Only success words are demoted. A quotation already `unverified`, `no-check` or `not-run` says
 * something weaker and keeps saying it.
 */
export function demoteForProvenance(
  state: DeclaredVerification,
  source: string,
  ctx: DeclaredVerificationContext,
): DeclaredVerification {
  if (state !== "verified" && state !== "re-attributed") return state;
  // The whole-report taint first: an id mismatch says the annotation may belong to another
  // reconciliation entirely, which is a larger doubt than one document's digest.
  if (!ctx.reconcile_id_matches) return "different-run";
  if (ctx.pin_mismatched_documents.has(source)) return "different-bytes";
  return state;
}

/**
 * The quotation and its state, from a report object that owns its own `quote_checks`.
 *
 * **`path` is matched EXACTLY, never as a suffix.** A check carries the position of the object it
 * describes (`claims[2].quote`, `checklist_results[0].evidence[1]`), so an exact match joins on
 * position; a suffix match joins on KIND, and any check in the array whose path merely ends in
 * `.quote` would then supply this quotation's state and its location. Independent verification
 * demonstrated it on 2026-09-02 (V.2): moving one claim's check into another claim's `quote_checks`
 * made a fabricated sentence render `verified` at a line it never occupied, out of a report that
 * still validated against its own schema. A path this build does not recognise now falls to
 * `no-check` and renders UNVERIFIED — the safe direction, and nothing is dropped from any cell.
 *
 * A verified position replaces the declared one; an unverified state keeps the declared one — see
 * `renderDeclaredQuote`.
 */
function quoteWithState(
  text: string,
  declaredSource: string,
  declaredLines: number[],
  checks: QuoteCheck[] | undefined,
  path: string,
  ctx: DeclaredVerificationContext,
): DeclaredQuote {
  const check = (checks ?? []).find((c) => c.path === path);
  const matched = declaredVerificationOf(check, ctx.verification_ran);
  const useFinal = (matched === "verified" || matched === "re-attributed") && check?.final != null;
  const source = useFinal ? (check as QuoteCheck).final!.source : declaredSource;
  return {
    text,
    source,
    location: useFinal ? locationText((check as QuoteCheck).final!.lines) : locationText(declaredLines),
    verification: demoteForProvenance(matched, source, ctx),
  };
}

/**
 * The checklist and the two items GDPR Art. 30(1)(a) turns on, named here and checked against the
 * checklist itself by the gate.
 *
 * **This is a second copy of two identifiers and the repair for that is a check, not a lookup.**
 * The item ids live in `rules/checklists/gdpr-notice-13-14.yaml`, which is a private-workspace file
 * the shipped CLI never reads; the compiled bundle carries the checklist, but the `ropa` command is
 * given a findings file and a layer-2 result and no bundle, and threading one in to read two strings
 * would be a larger change than the thing it protects. So the ids are written down once, here, with
 * what each item asks — and a test compares this list against the
 * checklist's own items IN BOTH DIRECTIONS: every id named here must exist there, and every item
 * there whose `article` is 13(1)(a) or 13(1)(b) must be named here. The failure this closes is the
 * quiet one: an id renamed in the checklist would otherwise make the pre-fill silently disappear,
 * and a disappearing pre-fill looks exactly like a document that says nothing about its controller.
 */
export const GDPR_NOTICE_CHECKLIST_ID = "gdpr-notice-13-14";

export const DECLARED_CONTROLLER_IDENTITY_ITEMS: readonly { item_id: string; article: string; asks: string }[] = [
  {
    item_id: "art-13-1-a",
    article: "13(1)(a)",
    asks: "the identity and the contact details of the controller and, where applicable, of the controller's representative",
  },
  {
    item_id: "art-13-1-b",
    article: "13(1)(b)",
    asks: "the contact details of the data protection officer, where applicable",
  },
];

/** One controller-identity item as the record level renders it. */
export interface DeclaredChecklistItem {
  checklist_id: string;
  item_id: string;
  /** What the item asks the document to carry, in the Regulation's own terms. */
  asks: string;
  /**
   * The checklist's own status word, verbatim — `present`, `partial`, `absent`, `unresolved`,
   * `not-applicable` — or the absence phrase where the item was never walked. **Never translated
   * into a word about compliance**: `present` says the document contains the information the item
   * asks for and says nothing about whether any duty is met.
   */
  status: string;
  /** False where the report carries no result for this item at all. */
  walked: boolean;
  /** The document quotations the result rests on, each with its own verification state. */
  quotes: DeclaredQuote[];
  /** The result's own reasoning, where it walked. Empty otherwise. */
  reasoning: string;
}

/**
 * How the tree the pillar-2 report describes compares with the tree the scan read.
 *
 * **Two states, and the second is deliberately not called "different".** Both documents carry a
 * `target` string, which is the root each was pointed at. When the two normalise to the same string
 * the roots are the same and that is a fact. When they do not, nothing here establishes that the
 * trees differ: the same tree reached by a relative path and by an absolute one, through a symlink,
 * or from a different working directory produces two different strings, and a copy of one tree at a
 * second path produces two strings that could each be either. `findings.json` carries no file
 * inventory and no digest of the tree, so there is nothing further to compare — the same limit
 * `checkLayer2Extensions` records for a display-shorthand reference, one document over.
 *
 * So the emitter says which of the two it knows and never guesses, and it **does not refuse**. A
 * refusal on two strings that differ would delete the developer's own published words from the
 * record on evidence that establishes nothing, and subtraction is the only operation that can
 * create a miss. The `scan_id` check upstream is a different case and still throws: there the two
 * documents carry the SAME identifier field written by the SAME run, so a mismatch is a fact rather
 * than an ambiguity.
 */
export interface TargetComparison {
  scan_target: string;
  report_target: string;
  state: "same-root" | "not-established";
  note: string;
}

function normalizeRoot(target: string): string {
  return target.replace(/[/\\]+$/, "");
}

export function compareTargets(scanTarget: string, reportTarget: string): TargetComparison {
  const scan = normalizeRoot(scanTarget ?? "");
  const report = normalizeRoot(reportTarget ?? "");
  if (scan !== "" && scan === report) {
    return {
      scan_target: scanTarget,
      report_target: reportTarget,
      state: "same-root",
      note: `The scan and the declaration reconciliation name the same root: ${scan}`,
    };
  }
  return {
    scan_target: scanTarget,
    report_target: reportTarget,
    state: "not-established",
    note:
      `The scan was run over "${scanTarget}" and the declaration reconciliation over "${reportTarget}". ` +
      "Those are different strings, and nothing here establishes whether they are the same tree: a " +
      "relative and an absolute path to one tree differ as strings, and two trees at different paths " +
      "differ in the same way. The declared cells below are rendered in full and this is stated rather " +
      "than resolved. Check that the two runs describe the same checkout before relying on them together.",
  };
}

/** The pillar-2 report as the emitter is handed it, with the label a reader sees it under. */
export interface DeclarationsInput {
  report: DeclarationsReport;
  /** Where the report came from, precisely enough to open it. Printed in the README. */
  source_label: string;
}

/**
 * Every id resolved once, so a row's lookup is a map read rather than a scan of the report.
 *
 * Duplicate ids are refused rather than resolved to the first match: `claim_id` is the join key
 * between the pillar-2 report and this export, and two claims sharing one id make the join ambiguous
 * in exactly the way `purposeNotesById` refuses for activity ids in the document renderer.
 */
export interface DeclarationsIndex {
  report: DeclarationsReport;
  source_label: string;
  /** False when the report carries no `quote_verification` at all: nobody has run the check. */
  verification_ran: boolean;
  claimById: Map<string, DeclarationClaim>;
  /** Each claim's position in `report.claims`, which is what an EXACT quote-check path needs. */
  claimIndexById: Map<string, number>;
  findingById: Map<string, DeclarationFinding>;
  /** Each finding's position in `report.findings`, for the same reason. */
  findingIndexById: Map<string, number>;
  target: TargetComparison;
  verification: DeclaredVerificationContext;
  /**
   * Everything the verification says about itself that a reader of this export has to be told, in
   * sentences. Empty on a clean report. Printed on the console, in the README and in the document —
   * one derivation, three readers, so they cannot disagree about what was disclosed.
   */
  verification_disclosures: string[];
}

/**
 * What the report's own `quote_verification` says about itself, checked against what it carries.
 *
 * **Two different silences and neither of them was being read** (independent verification,
 * 2026-09-02, V.4 and V.8). The provenance block records whether the bytes the check read are the
 * bytes the report says it read; the counts block records how many quotations the check covered. A
 * report whose counts disagree with the checks actually attached is one whose annotation was not
 * written by the tool that claims to have written it, or was edited after it was — and the README
 * states, in the reader's hearing, that a `verified` quotation is one `reconcile-verify` confirmed.
 * Neither is refused: both are disclosed, and the provenance one also demotes the success words it
 * touches (`demoteForProvenance`).
 */
function verificationDisclosures(report: DeclarationsReport): {
  ctx: DeclaredVerificationContext;
  disclosures: string[];
} {
  const qv = report.quote_verification;
  const ctx: DeclaredVerificationContext = {
    verification_ran: qv !== undefined,
    pin_mismatched_documents: new Set((qv?.provenance?.documents_with_pin_mismatch ?? []).map((d) => d.doc)),
    reconcile_id_matches: qv?.provenance?.reconcile_id_matches ?? true,
  };
  const disclosures: string[] = [];
  if (!qv) return { ctx, disclosures };
  if (ctx.pin_mismatched_documents.size > 0) {
    disclosures.push(
      `reconcile-verify ran over ${ctx.pin_mismatched_documents.size} document(s) whose digest differs from the ` +
        `one this report records reading (${[...ctx.pin_mismatched_documents].join(", ")}), so a quotation it ` +
        `confirmed in one of them was confirmed against different bytes. Every such quotation below reads ` +
        `UNVERIFIED for that reason and for no other. Re-read those documents, run reconcile-verify again, and ` +
        `emit this export again before relying on them.`,
    );
  }
  if (!ctx.reconcile_id_matches) {
    disclosures.push(
      `The quote verification names reconciliation "${qv.provenance?.input_reconcile_id ?? ""}" and this report is ` +
        `"${qv.provenance?.report_reconcile_id ?? ""}". They may describe different runs, which is said out loud ` +
        `rather than resolved: nothing here picks one of them to believe. Every quotation in this export therefore ` +
        `reads UNVERIFIED.`,
    );
  }
  // The cheap provenance tell V.8 asks for. `QuoteCheck` carries no digest of the text it checked,
  // so a hand-written annotation cannot be told from a real one with certainty; what CAN be checked
  // is whether the block's own arithmetic closes over the checks actually attached. A disagreement
  // is not proof of anything and is not called one.
  const attached = [
    ...(report.claims ?? []).flatMap((c) => c.quote_checks ?? []),
    ...(report.findings ?? []).flatMap((f) => f.quote_checks ?? []),
    ...(report.checklist_results ?? []).flatMap((r) => r.quote_checks ?? []),
  ];
  if (typeof qv.total === "number" && qv.total !== attached.length) {
    disclosures.push(
      `The quote verification says it checked ${qv.total} quotation(s) and ${attached.length} check row(s) are ` +
        `attached to this report. The two should be equal. This says nothing about whether any one quotation is ` +
        `real; it says the annotation and what it annotates do not agree about their own size, which is a reason ` +
        `to re-run reconcile-verify rather than to trust either number.`,
    );
  }
  const tallied: Record<string, number> = {};
  for (const c of attached) tallied[c.status] = (tallied[c.status] ?? 0) + 1;
  const disagreeing = Object.entries(qv.counts ?? {})
    .filter(([status, n]) => (tallied[status] ?? 0) !== n)
    .map(([status, n]) => `${status}: says ${n}, attached ${tallied[status] ?? 0}`);
  if (disagreeing.length > 0) {
    disclosures.push(
      `The quote verification's per-status counts do not match the check rows attached to this report ` +
        `(${disagreeing.join("; ")}). Same reading as the line above: the annotation and what it annotates ` +
        `disagree about themselves.`,
    );
  }
  return { ctx, disclosures };
}

export function indexDeclarations(findings: Findings, declarations: DeclarationsInput): DeclarationsIndex {
  const { report } = declarations;
  const claimById = new Map<string, DeclarationClaim>();
  const claimIndexById = new Map<string, number>();
  (report.claims ?? []).forEach((claim, i) => {
    if (claimById.has(claim.claim_id)) {
      throw new Error(
        `the declaration report carries two claims with the id ${claim.claim_id}, so an activity naming that id ` +
          `cannot be resolved to one quotation. Claim ids are the join key between the reconciliation and this ` +
          `export and must be unique within a report.`,
      );
    }
    claimById.set(claim.claim_id, claim);
    claimIndexById.set(claim.claim_id, i);
  });
  const findingById = new Map<string, DeclarationFinding>();
  const findingIndexById = new Map<string, number>();
  (report.findings ?? []).forEach((finding, i) => {
    if (findingById.has(finding.finding_id)) {
      throw new Error(
        `the declaration report carries two findings with the id ${finding.finding_id}, so an activity naming ` +
          `that id cannot be resolved to one finding.`,
      );
    }
    findingById.set(finding.finding_id, finding);
    findingIndexById.set(finding.finding_id, i);
  });
  const { ctx, disclosures } = verificationDisclosures(report);
  return {
    report,
    source_label: declarations.source_label,
    verification_ran: ctx.verification_ran,
    claimById,
    claimIndexById,
    findingById,
    findingIndexById,
    target: compareTargets(findings.target, report.target),
    verification: ctx,
    verification_disclosures: disclosures,
  };
}

/** The declared purpose quotations of one activity, resolved from the ids the row names. */
export function declaredPurposeQuotes(a: RopaActivity, index: DeclarationsIndex): DeclaredQuote[] {
  return (a.declared_purpose_claims ?? []).map((claimId) => {
    const claim = index.claimById.get(claimId);
    if (!claim) {
      throw new Error(
        `${a.id} (${a.name}) names the declared purpose claim ${claimId}, which the declaration report does not ` +
          `carry. A declared cell quotes the organisation's own document, so the id it rests on is checked ` +
          `against that report exactly as an evidence backing is checked against the scan.`,
      );
    }
    return quoteWithState(
      claim.quote,
      claim.source_location.doc,
      [claim.source_location.line],
      claim.quote_checks,
      // The check's own position in the report, exactly. See `quoteWithState`.
      `claims[${index.claimIndexById.get(claimId)}].quote`,
      index.verification,
    );
  });
}

/**
 * Every quotation one finding owns, as the position `reconcile-verify` writes a check at and the
 * file or document that quotation declares itself to come from.
 *
 * **A second copy of an enumeration, and the reason it is one.** `reconcile-verify` owns the mapping
 * from a report's objects to check paths; nothing exports it, and a `QuoteCheck` carries no back
 * reference to the object it describes. So the expected set is derived here from the same three
 * places the verifier walks, in the same order, under the same condition — including the one that
 * matters most: **a finding whose `quote.text` is absent or empty owns no document quotation**,
 * because that is what a direction-B finding is and the verifier records it as
 * `skipped_no_document_quote` rather than as a check. Demanding one here would make every
 * direction-B finding read UNVERIFIED forever, which is the penalty the pillar-2 skill says
 * discards "where the value is". A test holds this against the real
 * verifier's own output on the committed fixture, in both directions.
 */
export function ownedQuotePositions(
  finding: DeclarationFinding,
  at: number,
): { path: string; source: string }[] {
  const positions: { path: string; source: string }[] = [];
  if (finding.quote && typeof finding.quote.text === "string" && finding.quote.text.length > 0) {
    positions.push({ path: `findings[${at}].quote`, source: finding.quote.doc ?? "" });
  }
  (finding.evidence ?? []).forEach((ev, j) => {
    positions.push({ path: `findings[${at}].evidence[${j}]`, source: ev.file ?? "" });
  });
  (finding.searches ?? []).forEach((search, j) => {
    (search.hits ?? []).forEach((hit, k) => {
      positions.push({ path: `findings[${at}].searches[${j}].hits[${k}]`, source: hit.file ?? "" });
    });
  });
  return positions;
}

/** One mapped declaration finding, with the direction it ran in and the state of its quotations. */
export interface DeclaredFindingRef {
  finding_id: string;
  direction: "A" | "B";
  text: string;
  verification: DeclaredVerification;
}

/**
 * The declaration findings of one activity, resolved from the ids the row names.
 *
 * The verification state is the WORST over every quotation the finding owns — its document quote,
 * its code excerpts and its listed search hits — because that is the question a reader of the cell
 * is asking. A direction-B finding carries no document quotation by design and is never penalised
 * for it: `reconcile-verify` records that as `skipped_no_document_quote` rather than as a failure,
 * and here it simply means the state comes off the code side.
 */
export function declaredFindingRefs(a: RopaActivity, index: DeclarationsIndex): DeclaredFindingRef[] {
  return (a.declaration_finding_ids ?? []).map((findingId) => {
    const finding = index.findingById.get(findingId);
    if (!finding) {
      throw new Error(
        `${a.id} (${a.name}) names the declaration finding ${findingId}, which the declaration report does not ` +
          `carry. A row may not cite a reconciliation finding that report never made.`,
      );
    }
    // **The fold runs over the quotations this finding OWNS, not over the check rows it carries.**
    //
    // Asking only "does this check name this finding?" leaves the other half of the same question
    // open, and independent verification demonstrated it on 2026-09-02 (V.11): deleting only the
    // `unverifiable` row from a finding's `quote_checks` took its cell from UNVERIFIED to `verified`,
    // because the uncovered quotation simply stopped voting. For a claim and for a checklist evidence
    // entry the exact path answers both halves at once — there is one expected position, and a
    // missing check is `no-check`, which renders UNVERIFIED. A finding owns a VARIABLE set of them,
    // so the expected set has to be enumerated, and it is enumerated exactly as `reconcile-verify`
    // enumerates it (`reconcile-verify.ts` `verifyDeclarationQuotes`, the `report.findings` loop):
    // the document quote where there is one, each `evidence[]` excerpt, each listed search hit.
    // Anything with no check falls to `no-check`. It can only move a cell toward UNVERIFIED.
    const at = index.findingIndexById.get(findingId);
    const own = finding.quote_checks ?? [];
    const states = ownedQuotePositions(finding, at ?? 0).map((position) => {
      const check = own.find((c) => c.path === position.path);
      const matched = declaredVerificationOf(check, index.verification_ran);
      const useFinal = (matched === "verified" || matched === "re-attributed") && check?.final != null;
      return demoteForProvenance(
        matched,
        useFinal ? (check as QuoteCheck).final!.source : position.source,
        index.verification,
      );
    });
    // The branch is not redundant: a finding whose `quote_checks` array is absent folds to null, and
    // null has to become `not-run` where nobody ran the verifier and `no-check` where they did and
    // this finding was not among what it covered. Those are different silences.
    const worst = index.verification_ran ? worstVerification(states) : "not-run";
    return {
      finding_id: finding.finding_id,
      direction: finding.direction,
      text: finding.finding_text,
      verification: worst ?? "no-check",
    };
  });
}

/**
 * One mapped finding as both renderers print it: direction, the finding's own prose, and the state
 * of the quotations BEHIND it.
 *
 * **The state word is qualified, and the qualifier is the repair.** `finding_text` is the pillar-2
 * agent's own sentence — a question about the document, phrased as one — and not a quotation of
 * anything. Until 2026-09-02 this printed `(verified)` after it, which reads as a confirmed mismatch
 * and is the word `declaration-reconcile/SKILL.md` calls this pillar's worst failure mode applied to
 * an unadjudicated question. What the state actually describes is the quotations the finding rests
 * on, which this cell does not print, so it now says so in the cell. (Independent verification,
 * 2026-09-02, V.3.)
 */
export function renderDeclaredFindingRef(r: DeclaredFindingRef): string {
  return (
    `direction ${r.direction}: ${r.text} ` +
    `(the reconciliation's own words; quotations behind it: ${DECLARED_VERIFICATION_TEXT[r.verification]})`
  );
}

function renderDeclaredFindings(refs: DeclaredFindingRef[]): string {
  if (refs.length === 0) return absencePhrase("declaration_findings");
  return refs.map(renderDeclaredFindingRef).join("; ");
}

function renderDeclaredPurpose(quotes: DeclaredQuote[]): string {
  if (quotes.length === 0) return absencePhrase("declared_purpose");
  return quotes.map(renderDeclaredQuote).join("; ");
}

/**
 * The word `row_status` uses for the row's declared purpose. Short, because the cell it goes into
 * is already a sentence, and `not mapped` rather than an absence phrase because the clause is about
 * this row's mapping and not about the export's evidence.
 */
export function declaredPurposeWord(worst: DeclaredVerification | null): string {
  if (worst === null) return "not mapped";
  if (worst === "verified" || worst === "re-attributed" || worst === "not-run") {
    return DECLARED_VERIFICATION_TEXT[worst];
  }
  return "UNVERIFIED";
}

/**
 * The record-level controller identity, read out of the notice checklist the reconciliation walked.
 *
 * GDPR Art. 30(1)(a) asks the record for the controller's identity and contact details; Art. 13(1)(a)
 * and 13(1)(b) ask the notice for the same facts plus the data protection officer's. So a walked
 * notice checklist has already established what the organisation's own document says about them, and
 * this is where that reaches the record — **beside the operator blank and never in place of it**.
 * A person still answers section 3.0; what changes is that they are shown their own sentence first.
 */
export function declaredControllerIdentity(index: DeclarationsIndex): DeclaredChecklistItem[] {
  const results = index.report.checklist_results ?? [];
  return DECLARED_CONTROLLER_IDENTITY_ITEMS.map((item) => {
    // **Refused, exactly as two claims sharing an id are.** `(checklist_id, item_id)` is the same
    // kind of join key and no schema imposes uniqueness on it, so taking the first match resolves an
    // ambiguity silently — and in the deleting direction: independent verification planted a second
    // `absent` result ahead of the real one on 2026-09-02 (V.5) and the real, verified controller
    // quotation left the export with nothing said. Subtraction is the only operation that can create
    // a miss, so the ambiguity is reported rather than resolved.
    const matches = results.filter(
      (r) => r.checklist_id === GDPR_NOTICE_CHECKLIST_ID && r.item_id === item.item_id,
    );
    if (matches.length > 1) {
      throw new Error(
        `the declaration report carries ${matches.length} results for ${GDPR_NOTICE_CHECKLIST_ID}/${item.item_id}, ` +
          `so the record's controller-identity pre-fill cannot be resolved to one of them. A checklist item is ` +
          `walked once per report; two results are the same ambiguity two claims sharing an id are, and resolving ` +
          `it to whichever came first would drop the other silently.`,
      );
    }
    const at = results.findIndex(
      (r) => r.checklist_id === GDPR_NOTICE_CHECKLIST_ID && r.item_id === item.item_id,
    );
    if (at < 0) {
      return {
        checklist_id: GDPR_NOTICE_CHECKLIST_ID,
        item_id: item.item_id,
        asks: item.asks,
        status: absencePhrase("declared_checklist_item"),
        walked: false,
        quotes: [],
        reasoning: "",
      };
    }
    const result = results[at] as ChecklistResult;
    return {
      checklist_id: result.checklist_id,
      item_id: result.item_id,
      asks: item.asks,
      // The checklist's own word, verbatim. `present` and `absent` are statements about the
      // document, and translating either into a word about the law is the one thing this cell may
      // not do — so nothing is translated.
      status: result.status,
      walked: true,
      quotes: (result.evidence ?? []).map((e, j) =>
        quoteWithState(
          e.quote,
          e.doc,
          [e.line],
          result.quote_checks,
          // The check's own position in the report, exactly. See `quoteWithState`.
          `checklist_results[${at}].evidence[${j}]`,
          index.verification,
        ),
      ),
      reasoning: result.reasoning ?? "",
    };
  });
}

/** The applicability verdict for the notice checklist, or the phrase for a report that carries none. */
export function declaredChecklistApplicability(index: DeclarationsIndex): string {
  const verdict = (index.report.applicability_verdicts ?? []).find(
    (v) => v.checklist_id === GDPR_NOTICE_CHECKLIST_ID,
  );
  return verdict ? verdict.status : absencePhrase("declared_checklist");
}

// ------------------------------------------------------------------------------------------------
// The provenance chain
// ------------------------------------------------------------------------------------------------

/**
 * Compresses a run of rule ids that share a family prefix, as the prototype writes them:
 * `eu-consent-001/005/013/014` rather than four full ids. A single id is written out in full.
 */
export function compressRuleIds(ids: string[]): string {
  const groups: { prefix: string; suffixes: string[] }[] = [];
  for (const id of ids) {
    const cut = id.lastIndexOf("-");
    const prefix = cut < 0 ? id : id.slice(0, cut);
    const suffix = cut < 0 ? "" : id.slice(cut + 1);
    const last = groups[groups.length - 1];
    if (last && last.prefix === prefix) last.suffixes.push(suffix);
    else groups.push({ prefix, suffixes: [suffix] });
  }
  return groups.map((g) => (g.suffixes[0] === "" ? g.prefix : `${g.prefix}-${g.suffixes.join("/")}`)).join(", ");
}

/**
 * The composite key a (rule id, file) pair is looked up under.
 *
 * The separator is a NUL rather than a space or a colon because a path may contain either, and a
 * key collision here would let a fabricated citation pass the provenance check that exists to catch
 * one. It is written as an escape because a literal NUL byte in source is rejected by
 * `npm run lint:source-text`, and correctly: a NUL makes the file binary to file(1), grep, ripgrep
 * and diff, all of which then go quiet about it. (Found by that gate on 2026-08-24, in the first
 * version of this file, which had the byte itself.)
 */
function locationKey(ruleId: string, file: string): string {
  return `${ruleId}\u0000${file}`;
}

export interface ScanIndex {
  candidatesByRule: Map<string, Candidate[]>;
  locationPairs: Set<string>;
  /**
   * File -> the rules that raised a candidate location in it, across the whole scan.
   *
   * `locationPairs` answers "did THIS rule match this file"; this answers "did ANY rule match it",
   * which is the question a `layer2 extension (no layer-1 candidate)` label makes and could not
   * previously check. See `renderProvenance`.
   */
  rulesByFile: Map<string, Set<string>>;
  /**
   * File -> the subset of `rulesByFile` whose candidate at that file carried
   * `declared_inapplicable_preconditions`: the person's own ScanProfile answers put that rule out of
   * scope and it raised the location anyway.
   *
   * Kept beside `rulesByFile` rather than folded into it, so nothing is dropped and no existing
   * reader changes meaning. Before 2026-08-27 such a rule raised no candidate at all and this map
   * would have been empty by construction; from that date the RoPA can name a rule at a reference
   * without saying that the reference's own product declaration disputes it.
   */
  declaredInapplicableRulesByFile: Map<string, Set<string>>;
  verdictByFindingId: Map<string, "real" | "dismissed">;
  silentByRuleId: Map<string, RuleWithoutCandidates>;
  effectiveDateByRule: Map<string, string>;
}

function indexScan(findings: Findings, input: RopaInput): ScanIndex {
  const candidatesByRule = new Map<string, Candidate[]>();
  const locationPairs = new Set<string>();
  const rulesByFile = new Map<string, Set<string>>();
  const declaredInapplicableRulesByFile = new Map<string, Set<string>>();
  const effectiveDateByRule = new Map<string, string>();
  for (const c of findings.candidates) {
    const list = candidatesByRule.get(c.rule_id) ?? [];
    list.push(c);
    candidatesByRule.set(c.rule_id, list);
    const declaredInapplicable = (c.declared_inapplicable_preconditions ?? []).length > 0;
    for (const loc of c.locations) {
      locationPairs.add(locationKey(c.rule_id, loc.file));
      const at = rulesByFile.get(loc.file) ?? new Set<string>();
      at.add(c.rule_id);
      rulesByFile.set(loc.file, at);
      if (declaredInapplicable) {
        const flagged = declaredInapplicableRulesByFile.get(loc.file) ?? new Set<string>();
        flagged.add(c.rule_id);
        declaredInapplicableRulesByFile.set(loc.file, flagged);
      }
    }
    if (c.effective_date) effectiveDateByRule.set(c.rule_id, c.effective_date);
  }
  const silentByRuleId = new Map<string, RuleWithoutCandidates>();
  for (const r of findings.rules_without_candidates ?? []) {
    silentByRuleId.set(r.rule_id, r);
    if (r.effective_date) effectiveDateByRule.set(r.rule_id, r.effective_date);
  }
  const verdictByFindingId = new Map<string, "real" | "dismissed">();
  for (const v of input.verdicts) verdictByFindingId.set(v.finding_id, v.verdict);
  return {
    candidatesByRule,
    locationPairs,
    rulesByFile,
    declaredInapplicableRulesByFile,
    verdictByFindingId,
    silentByRuleId,
    effectiveDateByRule,
  };
}

/**
 * `<real> of <total>` locations, over the rules that proposed this activity.
 *
 * The unit is locations rather than candidates because that is what the prototype counted: its
 * `eu-data-act-001` row reads "(8 of 8)" over one candidate holding eight locations. On the
 * analytics row the two units happen to coincide at 23, which is why the prototype's own text
 * cannot settle the question and this comment has to.
 */
function locationCount(index: ScanIndex, ruleIds: string[]): { real: number; total: number } {
  let real = 0;
  let total = 0;
  for (const ruleId of ruleIds) {
    for (const c of index.candidatesByRule.get(ruleId) ?? []) {
      total += c.locations.length;
      if (index.verdictByFindingId.get(c.finding_id) === "real") real += c.locations.length;
    }
  }
  return { real, total };
}

/**
 * One evidence reference layer 2 supplied with no layer-1 backing, checked against the scan.
 *
 * `layer1_rules_at_ref` is the rules that DID raise a candidate location at this reference — empty
 * where the scan raised none. It is the checked half of the label `renderProvenance` writes.
 */
export interface Layer2ExtensionCheck {
  ref: string;
  layer1_rules_at_ref: string[];
  /**
   * The subset of `layer1_rules_at_ref` whose candidate at this reference carried
   * `declared_inapplicable_preconditions` — the reader's own ScanProfile answers put the rule out of
   * scope and the detector raised the location anyway.
   *
   * Added 2026-08-27, when profile answers stopped removing rules from a scan: without it the RoPA
   * names a rule at a reference as flat layer-1 backing while the person's own declaration disputes
   * that the rule's subject is in this product at all. It qualifies the label and removes nothing
   * from it — `layer1_rules_at_ref` still lists every rule, and this array is empty on every
   * reference where no answer was overridden.
   */
  layer1_rules_declared_inapplicable_at_ref: string[];
}

/**
 * The extension refs of a row, each checked against the whole scan rather than against the caller's
 * own `backed_by`.
 *
 * **Which absence claim the emitter asserts, and why.** An entry with an empty `backed_by`
 * establishes exactly one thing on its own: layer 2 attached no layer-1 candidate to it. That is a
 * fact about the *input*. The cell, however, said `no layer-1 candidate` — a statement about the
 * *scan*, and a strictly stronger one. Those are different claims, and the emitter was making the
 * stronger one from evidence for the weaker: `server/models/comments.js` shipped in
 * an internal record labelled "no layer-1 candidate" while `eu-consent-018` had
 * matched it at line 38 and `eu-dsa-002` at line 164. The eval document's justification —
 * "eu-dsr-001 never matched server/models/comments.js" — was true and was the scoped claim, not the
 * one printed. (Found by independent verification, 2026-08-24, MF-3.)
 *
 * **The repair is to check the strong claim rather than to retreat to the weak one.** The scan
 * knows, for every file, which rules raised a location in it. So:
 *
 * - no rule raised anything at this reference -> the strong claim is now CHECKED, and kept;
 * - some rule did -> the strong claim is false, so the cell states the scoped claim and NAMES the
 *   rules layer 1 raised there. Nothing is dropped: the reader gets more than before, not less.
 *
 * **The residual limit, stated rather than papered over.** A ref may be display shorthand rather
 * than a path (`migration 2.5.122.js`, a brace glob over two files) — the prototype writes all
 * three forms. Such a ref matches no scanned file and therefore takes the first branch, where the
 * check is true but vacuous. `findings.json` carries `stats.files_scanned` as a count and no file
 * inventory, so the emitter cannot tell "a path the scan read and no rule matched" from "not a path
 * at all". Distinguishing them needs a scan-side change and is not one this file can make.
 */
export function checkLayer2Extensions(a: RopaActivity, index: ScanIndex): Layer2ExtensionCheck[] {
  return a.evidence
    .filter((e) => e.backed_by.length === 0)
    .map((e) => ({
      ref: e.ref,
      layer1_rules_at_ref: [...(index.rulesByFile.get(e.ref) ?? [])].sort(),
      layer1_rules_declared_inapplicable_at_ref: [...(index.declaredInapplicableRulesByFile.get(e.ref) ?? [])].sort(),
    }));
}

function renderProvenance(a: RopaActivity, index: ScanIndex): string {
  let text = `layer1 ${compressRuleIds(a.proposed_by)} -> layer2 real`;
  if (a.provenance_qualifier === "inventory") text += " (inventory)";
  else if (a.provenance_qualifier === "location_count") {
    const { real, total } = locationCount(index, a.proposed_by);
    text += ` (${real} of ${total})`;
  }
  // The design's second outcome, in the RoPA itself: layer 2 read past what any detector
  // raised. Labelled rather than blended, because a reference with no candidate behind it is not
  // the same kind of evidence as one with, and a row that presents them as one has claimed a chain
  // it does not have. The label is now checked against the scan — see checkLayer2Extensions.
  const checked = checkLayer2Extensions(a, index);
  const unraised = checked.filter((c) => c.layer1_rules_at_ref.length === 0).map((c) => c.ref);
  if (unraised.length > 0) {
    text += `; layer2 extension (no layer-1 candidate): ${unraised.join(", ")}`;
  }
  // One clause per ref, because the rules layer 1 raised differ from reference to reference and a
  // merged clause would not say which belongs to which.
  for (const c of checked.filter((x) => x.layer1_rules_at_ref.length > 0)) {
    text +=
      `; layer2 extension (no candidate of this row's rules; layer 1 raised ` +
      `${c.layer1_rules_at_ref.join(", ")} at this file` +
      // The qualifier travels with the rule name. A rule the reader's own ScanProfile answers out of
      // scope still raised the location — that is the whole point of the change of 2026-08-27 — but a
      // RoPA cell that names it without saying so presents a candidate the person's declaration
      // disputes as flat layer-1 backing. Appended rather than substituted: the rule is still named.
      (c.layer1_rules_declared_inapplicable_at_ref.length > 0
        ? `, of which ${c.layer1_rules_declared_inapplicable_at_ref.join(", ")} your ScanProfile answers out of scope`
        : "") +
      `): ${c.ref}`;
  }
  return text;
}

function renderSourceEvidence(a: RopaActivity): string {
  return a.evidence
    .map((e) => {
      const note = e.note_from_backing === "location_count" ? `${e.backed_by.length} locations` : e.note;
      return note ? `${e.ref} (${note})` : e.ref;
    })
    .join("; ");
}

/**
 * The operator-answered fields this row is still missing, in column order. Today that is always
 * exactly `purpose_of_processing` — there is no path by which it can be answered from a scan — but
 * it is computed from `PROCESSING_ACTIVITY_COLUMNS` rather than hard-coded, so a second operator
 * column added to that table appears here without a second edit.
 */
export function unansweredOperatorFields(): string[] {
  return PROCESSING_ACTIVITY_COLUMNS.filter((c) => c.source === "operator").map((c) => c.key);
}

/**
 * The row's status cell, computed from the row's own cells.
 *
 * **It used to take no arguments at all**, so every row of every export carried the same string —
 * `evidence-complete except purpose` — including rows where three or four Art. 30(1) fields read
 * `Not observed in source`. An auditor opening the file in a spreadsheet read a completeness claim
 * over ground nobody examined, which is decision 1's failure mode one column over. (Independent
 * verification, 2026-08-24, SF-3; the hand-made 2026-08-20 prototype has the same defect, which is
 * where the constant came from.)
 *
 * The unobserved fields are recognised by matching the cell against `ABSENCE_PHRASES` — the same
 * closed vocabulary that produced them — so there is no second list to keep in step. `not assessed`
 * is counted separately and not folded in: "nobody looked" and "we looked and found nothing" are
 * different sentences, and collapsing them here would rebuild the defect the design names in the
 * `row_status` column.
 */
function renderRowStatus(
  cells: Record<string, string>,
  columns: readonly RopaColumn[],
  declaredWord?: string,
): string {
  const unanswered = unansweredOperatorFields();
  const base =
    unanswered.length === 1 && unanswered[0] === "purpose_of_processing"
      ? "evidence-complete except purpose"
      : `evidence-complete except operator fields: ${unanswered.join("; ")}`;
  // **`declared` is excluded from the evidence set on purpose, and the exclusion is the decision.**
  // The observed/unobserved clause is a statement about what was looked for IN THE CODE. A declared
  // cell is a statement about the organisation's own document, so counting an unmapped declared
  // purpose as a "field not observed" would say the code had been examined for something no
  // detector ever looked for — the design's failure one column over, with the arrow pointing the other
  // way. It is reported instead in a clause of its own, which is where a reader can see both the
  // mapping and the verification state without either being folded into the other.
  const evidenceColumns = columns.filter(
    (c) =>
      c.source !== "operator" &&
      c.source !== "declared" &&
      !["processing_activity_name", "source_evidence", "provenance", "row_status"].includes(c.key),
  );
  const notObserved = evidenceColumns.filter((c) => fieldAnswerState(cells[c.key] ?? "") === "not_observed").map((c) => c.key);
  const notAssessed = evidenceColumns.filter((c) => fieldAnswerState(cells[c.key] ?? "") === "not_assessed").map((c) => c.key);
  let text = base;
  if (notObserved.length > 0) text += `; ${notObserved.length} field(s) not observed: ${notObserved.join(", ")}`;
  if (notAssessed.length > 0) text += `; ${notAssessed.length} field(s) not assessed: ${notAssessed.join(", ")}`;
  if (declaredWord !== undefined) text += `; declared purpose: ${declaredWord}`;
  return text;
}

// ------------------------------------------------------------------------------------------------
// The design's three states, rendered
// ------------------------------------------------------------------------------------------------

/**
 * The `layer2_evidence` cell: where the construct layer 1 missed actually is.
 *
 * `file:lines — "quote"` per entry, because that is the form the design names and the form
 * an importing auditor can act on without the layer-2 record in front of them. Empty for every
 * outcome but `construct_found`, where `buildRopa` requires it.
 */
export function renderSilentRuleEvidence(s: SilentRule): string {
  return (s.evidence ?? []).map((e) => `${e.file}:${e.lines} — "${e.quote}"`).join("; ");
}

/**
 * What a silent rule's row claims, in words, one sentence per outcome.
 *
 * The whole point of that design rule is that "we looked and found nothing" and "nobody looked" stop
 * being the same sentence. If these three collapsed into one line saying "no candidates", the
 * defect would have been rebuilt in a new place — so they are written out separately here and the
 * gate asserts all three appear.
 */
export function claimForOutcome(outcome: SilentRuleOutcome, gated: number): string {
  const state = adr005State(outcome);
  const gatedClause =
    gated > 0
      ? ` This rule's own patterns matched ${gated} line(s) and a corroboration gate removed them, so the construct is demonstrably in this tree.`
      : "";
  switch (outcome) {
    case "not_checked":
      return (
        `${state} — not checked. The detector produced nothing and no search was run. This is not a statement ` +
        "that the construct is absent, and not a statement that this obligation is met." + gatedClause
      );
    case "apparently_absent":
      return (
        `${state} — searched, nothing found. Evidence, not proof: see layer2_searched for what was ` +
        "looked for." + gatedClause
      );
    case "construct_found":
      return (
        `${state} — the construct is present and layer 1 did not raise it. See layer2_searched for what was ` +
        "looked for and layer2_evidence for the file, line and quote." + gatedClause
      );
    case "not_evaluated":
      return (
        `${state} — never ran. The ScanProfile's own answers put this rule out of scope before it read a line, ` +
        "so this is evidence about the declaration and not about the code." + gatedClause
      );
    case "out_of_jurisdiction":
      return (
        `${state} — out of jurisdiction. The rule's jurisdiction is absent from the declared distribution ` +
        "regions, so it was not adjudicated." + gatedClause
      );
  }
}

/**
 * The design's three reportable states, from the roster's five fine-grained outcomes.
 *
 * The three are what the design names and what a report must render separately; the five are the
 * evidence-log schema's own vocabulary. The collapse used to exist only as the opening word of each
 * sentence in `claimForOutcome`, so any second reader — the gate, and now V1b's document renderer —
 * had to recover it by string-matching the sentence it had just been handed. It is a function now,
 * `claimForOutcome` composes its sentences from it, and the mapping is written down once.
 *
 * `unknown` is the state the phase's headline constraint is about: it must be visibly unanswered
 * wherever it is rendered, because a document that reads as finished while carrying one is worse
 * than no document.
 */
export type Adr005State = "unknown" | "apparently absent" | "gap found";

export function adr005State(outcome: SilentRuleOutcome): Adr005State {
  switch (outcome) {
    case "apparently_absent":
      return "apparently absent";
    case "construct_found":
      return "gap found";
    case "not_checked":
    case "not_evaluated":
    case "out_of_jurisdiction":
      return "unknown";
  }
}

// ------------------------------------------------------------------------------------------------
// Applicability dates
// ------------------------------------------------------------------------------------------------

/**
 * The applicability cell for an open question, read out of the rules' own `effective_date`.
 *
 * Not stored on the question and not writable by layer 2, so that a question blocking a duty which
 * has not started yet cannot be rendered as one already in force. That exact defect is on the
 * record: the project's rules name the missing applicability date as the plainest of the 2026-08-04
 * legal-accuracy failures, where the requirement ("every finding must be worded as preparation")
 * was written by the same session that then shipped checklists with no date in any parsed field.
 *
 * Throws when no rule the question names carries a date, because a silent fallback here is that
 * defect with a different spelling.
 */
export function applicabilityDate(q: RopaOpenQuestion, index: ScanIndex, asOf: string): string {
  const dates = q.rule_ids.map((id) => index.effectiveDateByRule.get(id)).filter((d): d is string => Boolean(d));
  if (dates.length === 0) {
    throw new Error(
      `${q.id}: none of the rules it names (${q.rule_ids.join(", ")}) carries an effective_date in this scan, ` +
        `so the applicability of the duty it blocks cannot be stated. Name a rule that does.`,
    );
  }
  // **The EARLIEST of them, with the later ones named beside it.**
  //
  // This used to take the latest, on the argument that "a question blocking two duties is not
  // answerable before the later one bites". That is a statement about ANSWERABILITY; the column is
  // named `applicability_date` and is read as a statement about APPLICABILITY, and under the old
  // rule a question naming an in-force duty and a 2027 duty rendered as `2027-12-11` — an
  // obligation already in force reading as not yet applicable. That is the 2026-08-04 defect this
  // field exists to prevent, running in the more dangerous direction. (Independent verification,
  // 2026-08-24, SF-5. Latent at the time: 0 of the 15 frozen questions mix dates, so no emitted
  // cell changes.) The answerability point is real and is not lost — it is carried by the clause
  // that names the later duty and the rule that carries it.
  const sorted = [...dates].sort();
  const earliest = sorted[0];
  const latest = sorted[sorted.length - 1];
  let text: string;
  if (earliest > asOf) text = q.date_note ? `${earliest} (${q.date_note})` : earliest;
  else if (q.date_style === "since") text = `in force since ${earliest}`;
  else text = "in force";
  if (latest !== earliest) {
    const later = [...new Set(sorted)]
      .filter((d) => d !== earliest)
      .map((d) => `${d} for ${q.rule_ids.filter((id) => index.effectiveDateByRule.get(id) === d).join(", ")}`);
    text += `; also ${later.join("; ")}`;
  }
  return text;
}

// ------------------------------------------------------------------------------------------------
// Build
// ------------------------------------------------------------------------------------------------

/**
 * One activity with everything derived and nothing yet flattened into a cell.
 *
 * **This exists so that a second renderer never has to re-derive anything.** Drata has no
 * importable inventory object at all, so the
 * same facts have to come out as a document rather than as a spreadsheet — a second renderer over
 * the same data. A renderer given only the flattened CSV rows would have to unpick a
 * semicolon-joined vendor list and re-parse a provenance sentence to get back what `buildRopa`
 * already computed; one given this needs neither the findings JSON nor the layer-2 file.
 */
export interface RopaActivityModel {
  id: string;
  name: string;
  /** Column keys a person must answer before this row is complete, in column order. */
  operator_fields: string[];
  data_subjects: string;
  personal_data: string;
  special_category: string;
  recipients: { status: RecipientBlock["status"]; vendors: string[]; list_note?: string; status_text: string };
  international_transfer: string;
  retention: string;
  security_measures: string;
  provenance: {
    rules: string[];
    qualifier: RopaActivity["provenance_qualifier"];
    /** Present only for `location_count`: locations ruled real, and locations in total. */
    locations?: { real: number; total: number };
    /**
     * The references layer 2 supplied with no layer-1 backing, as strings: the design's
     * `gap found` in the RoPA itself.
     *
     * **This list carries no absence claim and a renderer must not print one from it.** It says
     * only that the caller attached no backing; whether the scan raised anything at that reference
     * is `layer2_extension_checks`, which is the same references with that question answered. The
     * gate holds the two the same length so they cannot drift apart.
     */
    layer2_extensions: string[];
    /**
     * The same references, each checked against the whole scan rather than against this row's own
     * backing. A second renderer gets the checked fact rather than having to re-derive it from the
     * findings JSON, which is the whole reason this model exists. See `checkLayer2Extensions`.
     */
    layer2_extension_checks: Layer2ExtensionCheck[];
    /** Rendered sentence, for a renderer that wants the same wording the CSV uses. */
    text: string;
  };
  evidence: { ref: string; note?: string; backed_by: EvidenceBacking[]; is_layer2_extension: boolean }[];
  /**
   * The organisation's own published words about this activity, resolved from the ids the layer-2
   * result named. **Present only on a run given `--reconcile`**, so a second renderer can tell "the
   * documents were not read" from "they were read and said nothing about this row" — which are the
   * two states a single empty field would collapse.
   */
  declared?: {
    /** The claim quotations, each with its document, its line and its verification state. */
    purpose_quotes: DeclaredQuote[];
    /** The `declared_purpose` cell as the CSV renders it, so a second renderer re-derives nothing. */
    purpose_text: string;
    /** The worst verification state over `purpose_quotes`; null where the row mapped no claim. */
    purpose_verification: DeclaredVerification | null;
    findings: DeclaredFindingRef[];
    /** The `declaration_findings` cell as the CSV renders it. */
    findings_text: string;
    /** The worst verification state over `findings`; null where the row mapped none. */
    findings_verification: DeclaredVerification | null;
  };
}

/**
 * The record-level half of the declared route, plus everything a reader needs to weigh it.
 *
 * It is one block rather than five fields on `summary` because its absence is the meaningful state:
 * `declared === undefined` says the `ropa` command was run without `--reconcile` and no published
 * document was read at all, and every renderer branches on exactly that.
 */
export interface DeclaredRecord {
  /** Where the pillar-2 report came from, precisely enough for a reader to open it. */
  source_label: string;
  /** Whether the scan and the reconciliation name the same root, or whether that is unestablished. */
  target: TargetComparison;
  /** False when the report carries no `quote_verification`: nobody has run `reconcile-verify`. */
  verification_ran: boolean;
  /** The notice checklist's own applicability verdict, verbatim, or the not-walked phrase. */
  checklist_applicability: string;
  /** Art. 30(1)(a): what the organisation's own notice says about who the controller is. */
  controller_identity: DeclaredChecklistItem[];
  /** Every document the report rests on, with the digest that pins which version was read. */
  documents_read: { path_or_url: string; sha256: string; read_at: string }[];
  /**
   * What `quote_verification` says about ITSELF: whether the bytes it read are the bytes this report
   * records reading, and whether it and this report name the same reconciliation. Carried because
   * dropping it made a quotation confirmed against different bytes render `verified` with nothing
   * said (independent verification, 2026-09-02, V.4).
   */
  verification_provenance: { pin_mismatched_documents: string[]; reconcile_id_matches: boolean };
  /**
   * Everything the verification says about itself that the reader has to be told, in sentences.
   * Empty on a clean report. **One derivation, three readers** — the console, the README and the
   * document all print this array, so none of them can disclose less than another.
   */
  verification_disclosures: string[];
  /**
   * Quotations rendered into this export, by state. `unverified` is the number the console and the
   * README lead with: it is how many of the organisation's own sentences this export quotes without
   * a machine having confirmed that the document contains them.
   */
  counts: { quotes: number; verified: number; re_attributed: number; unverified: number };
}

export interface RopaExport {
  processing_activities: Record<string, string>[];
  open_questions: Record<string, string>[];
  unknown_rules: Record<string, string>[];
  custom_fields: Record<string, string>[];
  /**
   * The column set this run's `processing-activities.csv` and `vanta-custom-fields.csv` were built
   * over. Carried rather than recomputed by each renderer, so the header line, the cells and the
   * setup sheet cannot disagree about whether the declared columns are in this export.
   */
  activity_columns: readonly RopaColumn[];
  /** Absent when the run was given no `--reconcile`. See `DeclaredRecord`. */
  declared?: DeclaredRecord;
  /** The unflattened form of the same facts. See `RopaActivityModel`. */
  model: { activities: RopaActivityModel[] };
  /** Counts for the console line and the emitted README. Not written into any CSV. */
  summary: {
    activities: number;
    rows_blocked_on_operator_answer: number;
    open_questions: number;
    silent_rules: number;
    silent_by_outcome: Record<string, number>;
    layer2_extensions: number;
    /**
     * QUESTIONS ruled real, not verdicts. A group the scanner split because it carried more
     * locations than one agent reads is adjudicated as several parts, and counting the parts makes
     * one question contribute four. A group whose parts were not ruled the same way counts in both
     * of these, which is the honest reading and not a rounding: it means the adjudication of that
     * question disagreed with itself, and the RoPA README prints both numbers beside each other.
     */
    candidates_real: number;
    candidates_dismissed: number;
    /** Verdicts returned, one per candidate record. Equal to the two above summed unless a group was split. */
    verdict_records: number;
  };
}

export function buildRopa(
  findings: Findings,
  input: RopaInput,
  declarations?: DeclarationsInput,
): RopaExport {
  if (input.format !== "ropa-input/1") {
    throw new Error(`unsupported RoPA input format: ${String(input.format)}`);
  }
  if (input.scan_id !== findings.scan_id) {
    throw new Error(
      `the layer-2 result is for scan ${input.scan_id} and the findings are scan ${findings.scan_id}. ` +
        `Emitting a RoPA across two scans would attach one run's verdicts to another run's evidence.`,
    );
  }
  const index = indexScan(findings, input);

  // Every candidate carries a verdict, and every verdict names a candidate. Half an adjudication is
  // not a smaller RoPA, it is a RoPA whose silent rows nobody can tell from adjudicated ones.
  const findingIds = new Set(findings.candidates.map((c) => c.finding_id));
  const missing = findings.candidates.filter((c) => !index.verdictByFindingId.has(c.finding_id));
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} of ${findings.candidates.length} candidate(s) carry no layer-2 verdict ` +
        `(first: ${missing[0].rule_id} ${missing[0].finding_id}). Adjudicate them or state them as unknown; ` +
        `a RoPA emitted over a partial adjudication cannot say which rows were judged.`,
    );
  }
  for (const v of input.verdicts) {
    if (!findingIds.has(v.finding_id)) {
      throw new Error(`verdict names ${v.finding_id}, which is not a candidate of scan ${findings.scan_id}`);
    }
    // A VERDICT WITH NO WORD OF THE TWO IS REFUSED, NOT COUNTED AS DISMISSED (fix-verify-shape RP1,
    // 2026-09-24). Everything below reads `verdict === "real"` and treats the rest as dismissed, so a
    // missing or foreign word - `not_applicable` borrowed from verdict.schema.json, a label written
    // under another field - was a silent dismissal of a candidate nobody dismissed.
    if (v.verdict !== "real" && v.verdict !== "dismissed") {
      throw new Error(
        `the verdict for ${v.finding_id} carries ${v.verdict === undefined ? "no `verdict`" : `\`verdict\` ${JSON.stringify(v.verdict)}`}, ` +
          `which is neither "real" nor "dismissed" (ropa-input.schema.json). A RoPA counts every other verdict as dismissed, ` +
          `so this one is refused rather than read as a dismissal nobody made.`,
      );
    }
  }

  // The declared route, resolved once for the whole export. Absent where `--reconcile` was not
  // given, which every renderer below branches on rather than inferring from an empty cell.
  const declaredIndex = declarations ? indexDeclarations(findings, declarations) : undefined;
  const activityColumns = processingActivityColumns(declaredIndex !== undefined);
  const declaredCounts = { quotes: 0, verified: 0, re_attributed: 0, unverified: 0 };
  const countQuote = (state: DeclaredVerification): void => {
    declaredCounts.quotes++;
    if (state === "verified") declaredCounts.verified++;
    else if (state === "re-attributed") declaredCounts.re_attributed++;
    else declaredCounts.unverified++;
  };

  const processing_activities: Record<string, string>[] = [];
  const model: RopaActivityModel[] = [];
  let extensions = 0;
  for (const a of input.activities) {
    for (const ruleId of a.proposed_by) {
      const anyReal = (index.candidatesByRule.get(ruleId) ?? []).some(
        (c) => index.verdictByFindingId.get(c.finding_id) === "real",
      );
      if (!anyReal) {
        throw new Error(
          `${a.id} (${a.name}) says it was proposed by ${ruleId}, but no candidate of that rule was ruled real ` +
            `in this adjudication. A RoPA row rests on an adjudicated finding, never on a layer-1 hypothesis.`,
        );
      }
    }
    for (const e of a.evidence) {
      if (e.backed_by.length === 0) extensions++;
      for (const b of e.backed_by) {
        if (!index.locationPairs.has(locationKey(b.rule_id, b.file))) {
          throw new Error(
            `${a.id} (${a.name}) cites ${b.rule_id} at ${b.file}, which is not a location of any candidate in ` +
              `scan ${findings.scan_id}. The provenance chain is checked, not asserted.`,
          );
        }
        if (!a.proposed_by.includes(b.rule_id)) {
          throw new Error(
            `${a.id} (${a.name}) cites evidence from ${b.rule_id} but does not name it in proposed_by, so the ` +
              `row's provenance cell would credit a rule that did not produce that evidence.`,
          );
        }
      }
    }
    // **Refused on every path, not only the declared one.** An activity that names declared ids on
    // a run with no reconciliation report would have those ids silently dropped, and the row would
    // then read as though the documents had been read and said nothing.
    if (
      declaredIndex === undefined &&
      ((a.declared_purpose_claims ?? []).length > 0 || (a.declaration_finding_ids ?? []).length > 0)
    ) {
      throw new Error(
        `${a.id} (${a.name}) names declared claim or finding ids, but this run was given no --reconcile report, ` +
          `so there is nothing to resolve them against. Pass the pillar-2 report, or remove the ids; a row that ` +
          `drops them silently reads as one whose documents were read and said nothing.`,
      );
    }
    const declaredPurpose = declaredIndex ? declaredPurposeQuotes(a, declaredIndex) : [];
    const declaredFindings = declaredIndex ? declaredFindingRefs(a, declaredIndex) : [];
    if (declaredIndex) {
      for (const q of declaredPurpose) countQuote(q.verification);
    }
    // Null means the row mapped no claim at all, which is a different sentence from any of the five
    // verification states and is what `declaredPurposeWord` prints as `not mapped`. Every mapped
    // quotation already carries a state — `not-run` where the report was never verified — so the
    // fold needs no branch for that case.
    const declaredPurposeWorst = worstVerification(declaredPurpose.map((q) => q.verification));

    const { recipients, recipient_status } = renderRecipients(a);
    const cells: Record<string, string> = {
      processing_activity_name: a.name,
      purpose_of_processing: operatorMarker(a.purpose_note),
      data_subject_categories: a.data_subjects,
      personal_data_categories: a.personal_data,
      special_category_data: renderObservation("special_category_data", a.special_category),
      recipients,
      recipient_status,
      international_transfer: renderObservation("international_transfer", a.international_transfer),
      retention_period: renderObservation("retention_period", a.retention),
      security_measures: renderObservation("security_measures", a.security_measures),
      source_evidence: renderSourceEvidence(a),
      provenance: renderProvenance(a, index),
      row_status: "",
    };
    if (declaredIndex) {
      // Composed HERE and never taken from the caller, exactly as `purpose_of_processing` is. The
      // two sit side by side in the column table and neither can be written by layer 2: one is a
      // marker, the other is the report's own verbatim quotation with the verifier's own state.
      cells.declared_purpose = renderDeclaredPurpose(declaredPurpose);
      cells.declaration_findings = renderDeclaredFindings(declaredFindings);
    }
    // Last, because it reads the row's own cells. See renderRowStatus.
    cells.row_status = renderRowStatus(
      cells,
      activityColumns,
      declaredIndex ? declaredPurposeWord(declaredPurposeWorst) : undefined,
    );
    processing_activities.push(cells);
    model.push({
      id: a.id,
      name: a.name,
      operator_fields: unansweredOperatorFields(),
      data_subjects: a.data_subjects,
      personal_data: a.personal_data,
      special_category: cells.special_category_data,
      recipients: {
        status: a.recipients.status,
        vendors: a.recipients.status === "none_observed" ? [] : a.recipients.vendors,
        list_note: a.recipients.status === "none_observed" ? undefined : a.recipients.list_note,
        status_text: recipient_status,
      },
      international_transfer: cells.international_transfer,
      retention: cells.retention_period,
      security_measures: cells.security_measures,
      provenance: {
        rules: a.proposed_by,
        qualifier: a.provenance_qualifier,
        locations: a.provenance_qualifier === "location_count" ? locationCount(index, a.proposed_by) : undefined,
        layer2_extensions: a.evidence.filter((e) => e.backed_by.length === 0).map((e) => e.ref),
        layer2_extension_checks: checkLayer2Extensions(a, index),
        text: cells.provenance,
      },
      evidence: a.evidence.map((e) => ({
        ref: e.ref,
        note: e.note_from_backing === "location_count" ? `${e.backed_by.length} locations` : e.note,
        backed_by: e.backed_by,
        is_layer2_extension: e.backed_by.length === 0,
      })),
      declared: declaredIndex
        ? {
            purpose_quotes: declaredPurpose,
            purpose_text: cells.declared_purpose,
            purpose_verification: declaredPurposeWorst,
            findings: declaredFindings,
            findings_text: cells.declaration_findings,
            findings_verification: worstVerification(declaredFindings.map((f) => f.verification)),
          }
        : undefined,
    });
  }

  const open_questions = input.open_questions.map((q) => ({
    question_id: q.id,
    blocks: q.blocks.join("; "),
    question: q.question,
    why_code_cannot_answer: q.why_code_cannot_answer,
    applicability_date: applicabilityDate(q, index, input.as_of),
    source_evidence: q.source_evidence ?? "n/a",
  }));

  const silent_by_outcome: Record<string, number> = {};
  const unknown_rules = input.silent_rules.map((s) => {
    const row = index.silentByRuleId.get(s.rule_id);
    if (!row) {
      throw new Error(
        `the layer-2 result rules on ${s.rule_id} as a silent rule, but scan ${findings.scan_id} does not list ` +
          `it in rules_without_candidates.`,
      );
    }
    if (s.outcome === "apparently_absent" && (s.searched ?? []).length === 0) {
      throw new Error(
        `${s.rule_id}: "apparently absent" with no search behind it is an assertion, not evidence ` +
          `(a silent rule's outcome needs its searches). Record the searches, including the ones that returned nothing.`,
      );
    }
    // The sibling guard, which `apparently_absent` had from the start and `construct_found` did not.
    // The design requires this outcome to be "Reported with file, line and quote"; a gap
    // claim with neither a search nor a located quote behind it is the same assertion one outcome
    // over, and it is the outcome the design calls the most valuable in the design.
    if (s.outcome === "construct_found") {
      if ((s.searched ?? []).length === 0) {
        throw new Error(
          `${s.rule_id}: "gap found" with no search behind it is an assertion, not evidence ` +
            `(a silent rule's outcome needs its searches). Record the searches that located the construct.`,
        );
      }
      const located = (s.evidence ?? []).filter((e) => e.file && e.lines && e.quote);
      if (located.length === 0) {
        throw new Error(
          `${s.rule_id}: "gap found" says layer 1 missed a construct that is present, so it must be ` +
            `reported with file, line and quote. Record at least one evidence entry carrying ` +
            `all three; a gap nobody can locate is not a reportable fact.`,
        );
      }
    }
    silent_by_outcome[s.outcome] = (silent_by_outcome[s.outcome] ?? 0) + 1;
    const gated = row.matches_removed_by_corroboration ?? 0;
    return {
      rule_id: s.rule_id,
      state: row.state,
      // Read backwards, the rule's own evidence_template is the best available statement of what
      // the detector was hunting — the reason the design made it required rather than
      // optional on the roster. Placeholders are left unsubstituted because there is no location
      // for them to stand for, which is precisely the state being reported.
      what_the_detector_looked_for: row.evidence_template ?? row.title,
      files_on_surface: String(row.files_on_surface ?? ""),
      matched_then_gated: String(gated),
      layer2_outcome: s.outcome,
      layer2_searched: (s.searched ?? []).join("; ") || "n/a",
      layer2_evidence: renderSilentRuleEvidence(s),
      what_this_row_claims: claimForOutcome(s.outcome, gated),
    };
  });

  // COUNTED AS QUESTIONS, NOT AS VERDICTS. A group the scanner split because it carried more
  // locations than one agent reads is adjudicated part by part, so counting verdicts makes one
  // question contribute four to a RoPA README that says "adjudicated candidates". The question id
  // is `group_part.group_id` where there is one and the candidate's own id where there is not.
  // A group whose parts came back with different verdicts lands in BOTH counts, deliberately: that
  // is what happened, and the two numbers are printed side by side so it is visible rather than
  // resolved by a rule nobody chose. `verdict_records` carries the underlying count.
  const questionOf = new Map(
    findings.candidates.map((c) => [c.finding_id, c.group_part?.group_id ?? c.finding_id] as const),
  );
  const realQuestions = new Set<string>();
  const dismissedQuestions = new Set<string>();
  for (const v of input.verdicts) {
    const q = questionOf.get(v.finding_id) ?? v.finding_id;
    (v.verdict === "real" ? realQuestions : dismissedQuestions).add(q);
  }
  // The record level: the controller identity the organisation's own notice states, and everything
  // a reader needs to weigh it. Its quotations are counted into the same totals the activity ones
  // are, because "how many of your own sentences does this export quote unconfirmed" is one number.
  let declaredRecord: DeclaredRecord | undefined;
  if (declaredIndex) {
    const controller = declaredControllerIdentity(declaredIndex);
    for (const item of controller) for (const q of item.quotes) countQuote(q.verification);
    declaredRecord = {
      source_label: declaredIndex.source_label,
      target: declaredIndex.target,
      verification_ran: declaredIndex.verification_ran,
      checklist_applicability: declaredChecklistApplicability(declaredIndex),
      controller_identity: controller,
      documents_read: (declaredIndex.report.documents_read ?? []).map((d) => ({
        path_or_url: d.path_or_url,
        sha256: d.sha256,
        read_at: d.read_at,
      })),
      verification_provenance: {
        pin_mismatched_documents: [...declaredIndex.verification.pin_mismatched_documents],
        reconcile_id_matches: declaredIndex.verification.reconcile_id_matches,
      },
      verification_disclosures: declaredIndex.verification_disclosures,
      counts: declaredCounts,
    };
  }

  return {
    processing_activities,
    open_questions,
    unknown_rules,
    custom_fields: customFieldRows(activityColumns),
    activity_columns: activityColumns,
    declared: declaredRecord,
    model: { activities: model },
    summary: {
      activities: processing_activities.length,
      rows_blocked_on_operator_answer: processing_activities.length * unansweredOperatorFields().length,
      open_questions: open_questions.length,
      silent_rules: unknown_rules.length,
      silent_by_outcome,
      layer2_extensions: extensions,
      candidates_real: realQuestions.size,
      candidates_dismissed: dismissedQuestions.size,
      verdict_records: input.verdicts.length,
    },
  };
}

// ------------------------------------------------------------------------------------------------
// CSV
// ------------------------------------------------------------------------------------------------

/**
 * The prefix that stops a spreadsheet reading a cell as a formula. One character, and it is the
 * convention Excel, Google Sheets and LibreOffice use themselves for "this is literal text".
 */
export const CSV_TEXT_PREFIX = "'";

/**
 * A cell whose text a spreadsheet would parse as a formula when it imports the file.
 *
 * **The source for the character set is OWASP's CSV Injection page**, which names `=`, `+`, `-`,
 * `@`, tab (0x09), carriage return (0x0D) and line feed (0x0A), recommends prepending a single
 * quote, and additionally names *"full-width (double-byte) variants of formula-initiating characters
 * such as U+FF1D, U+FF0B, U+FF0D and U+FF20, which may be interpreted as formulas in some locales
 * (e.g. Japanese environments)"*. Two clauses, because there are two mechanisms:
 *
 * - `FORMULA_OPERATOR_LEAD` — the characters a formula may begin with, ASCII `=`, `+`, `-`, `@` and
 *   their four full-width forms, looked for **past any leading whitespace**. The whitespace part is
 *   not decoration: importers strip leading whitespace before they decide what the cell is, which is
 *   precisely why a tab or a carriage return in front of an `=` has been a working bypass of guards
 *   that only tested the first character. The full-width forms are written as `\uFF1D` escapes
 *   rather than as glyphs, on the same reasoning `docx.ts` gives for its control-character class:
 *   the code point is legible, the file stays ASCII, and the project's field-scoped CJK rule has nothing
 *   to argue with. They were added on 2026-09-03 after an independent verification planted the
 *   full-width DDE payload through the real CLI and watched it emerge bare. They are not a curiosity
 *   here: the JP pack is this
 *   product's stated P2 differentiator, and the declared route carries verbatim quotations out of
 *   the organisation's own published documents — a Japanese privacy policy being exactly the case
 *   OWASP names.
 * - `STRIPPED_WHITESPACE_LEAD` — a leading tab or carriage return on its own. Both are named as
 *   triggers in their own right, and neither has a legitimate form at the head of a RoPA cell, so
 *   the guard does not wait for an operator to follow one.
 *
 * **Bare line feed is a deliberate departure from that source, and it is the only one.** Inside a
 * quoted field an LF is an ordinary in-cell line break this export's free text really does contain,
 * `FORMULA_OPERATOR_LEAD` already covers an LF standing in front of an operator, and what is left
 * uncovered — a bare leading LF with benign text behind it — is not evaluated by any importer. The
 * alternative was an apostrophe in front of real multi-line prose.
 *
 * **The unit of this defence is the cell, not the physical line, and that boundary is real.** A cell
 * containing an embedded newline puts whatever follows that newline at the head of a physical line
 * of the file; the guard tests position 0 of the cell, so the neutralised cell's *second* physical
 * line can still open with `=`. Under RFC 4180 that text is inside a quoted field and inert, and 0
 * of the 9,296 cells in every RoPA export committed to this repository is evaluable — but 109 of
 * them do carry an embedded newline and 16 physical lines already open with a formula character, all
 * of them quoted source code (a SQL comment, diff hunks, a CSS `@import`). Neutralising per physical
 * line would insert apostrophes into the middle of quoted source, so it is not done; a
 * line-splitting importer would defeat this guard, and no importer has ever been tested.
 * (Independent verification, 2026-09-03, F5.)
 *
 * **Zero-width and format characters are outside the class, as a recorded boundary rather than an
 * oversight.** U+200B, U+0085, U+0000 and U+180E in front of an operator pass through un-prefixed.
 * OWASP says nothing about them, no source was found stating that any importer strips one before
 * deciding whether a cell is a formula, and the Google Sheets guidance treats them as characters a
 * user removes with `CLEAN`/`SUBSTITUTE` — that is, they survive as text. If evidence of an importer
 * that strips them appears, adding them here is additive and free. (F6.)
 */
const FORMULA_OPERATOR_LEAD = /^\s*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/;
const STRIPPED_WHITESPACE_LEAD = /^[\t\r]/;

/**
 * **The whole of the CSV formula-injection guard, applied by `toCsv` to every field it writes.**
 *
 * The reason it lives at the writer and not at any of the places text is composed: this export's
 * free-text columns take their content from layer 2, from the operator's own note and — since the
 * declared route — from quotations out of the organisation's published documents, and the set of
 * such columns grows. A guard sited per column is a list somebody has to remember to extend; a guard
 * sited at the one function that turns a value into a field cannot be forgotten by a new column.
 * `processing-activities.csv`, `open-questions.csv`, `unknown-rules.csv` and
 * `vanta-custom-fields.csv` are all written by `toCsv` and there is no second CSV writer in the
 * `ropa` command, so "every CSV this command emits" is a property of one call site.
 *
 * **What the prefix buys, stated exactly.** A formula must begin with `=`, `+`, `-` or `@`; a cell
 * beginning with `'` cannot, so nothing in it is evaluated on import into Excel, Google Sheets or
 * LibreOffice. What the prefix does NOT promise is invisibility: whether the apostrophe is consumed
 * as the literal-text marker or displayed as a character depends on the importer and the import
 * path. A visible apostrophe in front of a hostile cell is the intended trade — the alternative is a
 * cell that runs.
 *
 * **Write time only.** The row records on `RopaExport`, the model a second renderer consumes and the
 * `.docx` all keep the raw text. The `.docx` is not a formula surface: every value in it is written
 * as a literal `<w:t>` run by `docx.ts` and the renderer emits no field-code construct
 * (`w:fldSimple`, `w:fldChar`, `w:instrText`) anywhere, so there is nothing in it for a leading `=`
 * to become. Neutralising there would only put an apostrophe in front of the operator's own words in
 * the document they have to read.
 */
export function neutraliseFormulaLead(value: string): string {
  const v = value ?? "";
  if (!FORMULA_OPERATOR_LEAD.test(v) && !STRIPPED_WHITESPACE_LEAD.test(v)) return v;
  return CSV_TEXT_PREFIX + v;
}

/**
 * RFC 4180 with one house convention: LF line endings and a trailing newline, matching every other
 * text file this repository writes and what `npm run lint:source-text` accepts.
 *
 * `quoteAll` reproduces the 2026-08-20 prototype exactly. It quotes every data cell of
 * `processing-activities.csv` and leaves `question_id` bare in `open-questions.csv` — a hand-made
 * inconsistency, carried because the prototype is the shape the golden test compares against and
 * normalising it silently would make that comparison meaningless. It is a one-line change when the
 * platform's own template settles the question.
 *
 * **Header cells and data cells go through ONE field writer**, so both are neutralised and both are
 * quoted on the same RFC 4180 condition. Until 2026-09-03 the header line was joined raw: it was
 * neutralised but never quoted, so a header containing a comma emitted two fields in a one-column
 * file and an inner quote was left undoubled — the exception was inside the very scenario the
 * column table's comment describes, a re-mapping to the platform's own template. (Independent
 * verification, 2026-09-03, F4.) A header is written bare when it needs no quotes, which is what
 * keeps today's header lines byte for byte what they were.
 */
export function toCsv(
  columns: readonly RopaColumn[],
  rows: Record<string, string>[],
  opts: { bareColumns?: string[] } = {},
): string {
  const bare = new Set(opts.bareColumns ?? []);
  /**
   * One field of the file, header or data.
   *
   * Neutralised BEFORE the quoting decision, so the RFC 4180 test runs over the text that will
   * actually be written: a field may stay bare only when the guard did not add anything the quoting
   * rule cares about and the value itself carries no quote, comma, CR or LF.
   */
  const field = (value: string, mayStayBare: boolean): string => {
    const v = neutraliseFormulaLead(value ?? "");
    if (mayStayBare && !/[",\n\r]/.test(v)) return v;
    return `"${v.replace(/"/g, '""')}"`;
  };
  const lines = [columns.map((c) => field(c.header, true)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => field(row[c.key] ?? "", bare.has(c.key))).join(","));
  return lines.join("\n") + "\n";
}

export function renderProcessingActivitiesCsv(
  rows: Record<string, string>[],
  columns: readonly RopaColumn[] = PROCESSING_ACTIVITY_COLUMNS,
): string {
  return toCsv(columns, rows);
}

export function renderOpenQuestionsCsv(rows: Record<string, string>[]): string {
  return toCsv(OPEN_QUESTION_COLUMNS, rows, { bareColumns: ["question_id"] });
}

/**
 * The one-time platform setup, derived from the column table so there is no second copy of it.
 *
 * `who_fills_it` is on the sheet because it is the fact the setup step keeps getting wrong: the
 * platform's second required field is answered by a person, not by this tool, and somebody reading
 * only a column list would assume the export fills every column it declares.
 */
export function customFieldRows(
  columns: readonly RopaColumn[] = PROCESSING_ACTIVITY_COLUMNS,
): Record<string, string>[] {
  return columns.map((c) => {
    const who =
      c.source === "operator"
        ? "a person in your organisation, before import"
        : c.source === "layer2"
          ? "the adjudicating agent, from reading the code"
          : c.source === "declared"
            ? // **Not "quoting your own published documents", which was true of one of the two
              // declared columns and false of the other**: `declaration_findings` prints the
              // reconciliation's own sentences and quotes nothing. One wording that is true of both
              // is cheaper than a per-column branch and does not understate either. (Independent
              // verification, 2026-09-02, V.3.)
              "this tool, restating what the declaration reconciliation found; the quotations in it are your own published wording"
            : "this tool, from the scan and the adjudication";
    return {
      csv_column: c.header,
      create_as:
        c.platform_field.kind === "built_in"
          ? `built-in field: ${c.platform_field.as}`
          : `custom field (create it before the first import)`,
      field_type: c.platform_field.kind === "built_in" ? "n/a — the platform already has it" : c.platform_field.type,
      who_fills_it: who,
      note: c.platform_field.note ?? (c.required_by_platform ? "Required by the platform to create a processing activity." : ""),
    };
  });
}

export function renderCustomFieldsCsv(rows: Record<string, string>[]): string {
  return toCsv(CUSTOM_FIELD_COLUMNS, rows, { bareColumns: ["csv_column", "field_type"] });
}

export function renderUnknownRulesCsv(rows: Record<string, string>[]): string {
  return toCsv(UNKNOWN_RULE_COLUMNS, rows, { bareColumns: ["rule_id", "state", "files_on_surface", "matched_then_gated", "layer2_outcome"] });
}

/**
 * The README's declared section, and the paragraph the declared counts lead with.
 *
 * **Both halves are empty arrays on a run with no `--reconcile`**, which is what keeps that run's
 * README byte for byte what it was. The fact that no document was read is not dropped with them: it
 * is on the console, in `summarizeRopa`, and in the closed absence vocabulary.
 */
function declaredReadmeLead(e: RopaExport): Inert[] {
  const d = e.declared;
  if (!d) return [];
  const lines: Inert[] = [
    ours(""),
    md`**${d.counts.quotes} quotation(s) from your own published documents appear in this export`,
    md`(${d.counts.verified} verified, ${d.counts.re_attributed} re-attributed, ${d.counts.unverified} UNVERIFIED).**`,
    ours("A quotation is `verified` where `reconcile-verify` found that exact text in the document the report named,"),
    ours("`re-attributed` where it found the text in a different document in scope and the cell names that one instead,"),
    ours("and `UNVERIFIED` where it could not confirm the text at all. An UNVERIFIED quotation is not evidence that the"),
    ours("document does not say it; it is evidence that nothing here has checked, and it must be read against the"),
    ours("document before it is relied on."),
  ];
  if (!d.verification_ran) {
    lines.push(
      ours(""),
      ours("**This report never went through `reconcile-verify`, so every declared cell in this export reads"),
      ours("`unverified (reconcile-verify not run)`.** Nothing has compared these quotations with the documents they"),
      ours("cite. Run `reconcile-verify` over the report and emit this export again before quoting any of them."),
    );
  }
  // What the verification says about ITSELF, in the reader's hearing rather than only in the JSON.
  // Same array the console and the document print, so none of the three can disclose less. Every value of the README prints through `markdownText` or `markdownCode`.
  for (const line of d.verification_disclosures) lines.push(ours(""), md`**${markdownText(line)}**`);
  return lines;
}

function declaredReadmeSection(e: RopaExport): Inert[] {
  const d = e.declared;
  if (!d) return [];
  const lines: Inert[] = [
    ours(""),
    ours("## What your own documents say"),
    ours(""),
    // **The sentence used to stand over lines it was not true of** — the checklist's own status
    // words, the applicability verdict, the target note and a `why:` paragraph that is entirely the
    // reconciliation's reasoning — and a reader was told all of it was their own published wording.
    // The two kinds are now named separately, which is the whole of the repair: what was quoted
    // FROM the document carries a verification state, and what the reconciliation wrote ABOUT the
    // document says whose sentence it is. (Independent verification, 2026-09-02, V.3.)
    md`Read by \`declaration-reconcile\` and taken from ${markdownCode(d.source_label)}. Every quoted line below is your`,
    ours("organisation's own published wording, quoted verbatim with the document and the line it came from. The status"),
    ours('words are the notice checklist\'s own and the "why" lines are the reconciliation\'s reasoning, not your text.'),
    ours("**Nothing here fills an operator field.** The processing purpose and the controller identity are"),
    ours("still answered by a person; what these lines do is show that person what their own document already says."),
    ours(""),
    md`- documents read: ${d.documents_read.length}`,
  ];
  for (const doc of d.documents_read) {
    lines.push(md`  - ${markdownCode(doc.path_or_url)} (sha256 ${markdownText(doc.sha256.slice(0, 12))}…, read ${markdownText(doc.read_at)})`);
  }
  lines.push(
    md`- notice checklist ${markdownCode(GDPR_NOTICE_CHECKLIST_ID)} applicability: ${markdownText(d.checklist_applicability)}`,
    md`- ${markdownText(d.target.note)}`,
    ours(""),
    ours("### Controller identity as your notice states it (GDPR Art. 30(1)(a))"),
    ours(""),
    ours("The record's own controller field is an operator blank and stays one. This is what the notice checklist found"),
    ours("in your documents when it was walked, with the checklist's own status word:"),
    ours(""),
  );
  for (const item of d.controller_identity) {
    lines.push(md`- **${markdownText(item.item_id)}** — ${markdownText(item.asks)}`);
    lines.push(md`  - status: ${markdownText(item.status)}`);
    if (item.quotes.length === 0) {
      lines.push(md`  - quoted: ${markdownText(absencePhrase("declared_quote"))}`);
    }
    // A quotation is the document's own text, and the reasoning is the reconciliation seat's: values.
    for (const q of item.quotes) lines.push(md`  - quoted: ${markdownText(renderDeclaredQuote(q))}`);
    if (item.reasoning) lines.push(md`  - why: ${markdownText(item.reasoning)}`);
  }
  return lines;
}

/**
 * The README written beside the CSVs.
 *
 * It exists to carry one sentence into the hands of whoever opens the export: **this file cannot be
 * imported until a human answers one question per row.** Vanta requires the processing purpose to
 * create a processing activity, and this product will not infer it. Leaving the cell merely empty
 * would let that read as an oversight; it is a design decision, and the export says so where the
 * export is read.
 */
export function renderExportReadme(input: RopaInput, e: RopaExport, notices: string[] = []): Inert {
  const outcomes = Object.entries(e.summary.silent_by_outcome)
    .sort()
    .map(([k, v]) => md`${markdownText(k)}: ${v}`);
  return inertJoin([
    md`# RoPA export — ${markdownText(input.target_label ?? input.scan_id)}`,
    ours(""),
    md`Emitted by \`wolfboy ropa\` from scan ${markdownCode(input.scan_id)}, adjudicated ${markdownText(input.as_of)}.`,
    ours(""),
    ours("## Before you import this"),
    ours(""),
    md`**${e.summary.rows_blocked_on_operator_answer} cell(s) across ${e.summary.activities} row(s) must be`,
    ours("answered by a person before this file can be imported.** Vanta requires exactly two fields to create a"),
    ours("processing activity — the activity name and the data processing purpose — and the purpose is a fact"),
    ours("about what your organisation does, not about what your code contains. This scanner does not infer it,"),
    ours("so every `purpose_of_processing` cell reads `[REQUIRED — OPERATOR MUST ANSWER]`."),
    ours(""),
    ours("That is by design and not an omission. It is also the reason `open-questions.csv` exists: those are the"),
    ours("other facts the code cannot settle, each with the reason it cannot."),
    // Anything the RUN has to disclose about itself — today, only that a schema check could not be
    // loaded. It reaches the README rather than the console alone because the console scrolls away
    // and this file travels with the export. Empty on every ordinary run, so no emitted byte moves.
    // (Independent verification, 2026-09-02, V.7.)
    ...notices.flatMap((n) => [ours(""), md`**${markdownText(n)}**`]),
    ...declaredReadmeLead(e),
    ...declaredReadmeSection(e),
    ours(""),
    ours("## What each file is"),
    ours(""),
    ours("- `processing-activities.csv` — one row per processing activity, with a provenance cell naming the"),
    ours("  layer-1 rule that proposed it and what layer 2 ruled. Where layer 2 read past what any detector"),
    ours("  raised, the cell says so rather than presenting it as a detector result."),
    // **The fourth instance of the sentence V.3 is about, one section below the three that were
    // repaired.** It said both declared columns carried the customer's own published wording, each
    // with a quotation; `declaration_findings` quotes no document. The two columns are described
    // separately here rather than under one wording, because the file list is where a reader decides
    // what each column IS. (Independent verification, 2026-09-02, V.3, re-check.)
    ...(e.declared
      ? [
          ours("  Two of its columns are `declared`. `declared_purpose` carries your own published wording, quoted"),
          ours("  verbatim with the document, the line and whether that text was confirmed there."),
          ours("  `declaration_findings` carries the reconciliation's own questions about your documents, each with the"),
          ours("  state of the quotations behind it. They sit beside `purpose_of_processing` and do not fill it."),
        ]
      : []),
    ours("- `open-questions.csv` — the questions that must be answered before a row is complete, each with the"),
    ours("  reason the code cannot answer it and the date the duty applies."),
    ours("- `unknown-rules.csv` — the rules that produced no candidate. **`unknown`, never `clean`.** A rule"),
    ours("  matching nothing has established that these patterns did not match this text, and nothing more."),
    ours("- `vanta-custom-fields.csv` — the one-time setup: which of the columns above the platform already has,"),
    ours("  which have to be created as custom fields, and what type each needs. A multi-select and a text field"),
    ours("  are not interchangeable, and getting it wrong at setup degrades the data silently rather than failing"),
    ours("  the import."),
    ours("- `record-of-processing-activities.docx` — the same facts as a standalone Art. 30 document, for a"),
    ours("  platform that has no inventory object to import into and takes an uploaded policy file instead. It is"),
    ours("  a second rendering of this one run, not a second scan. **Every unanswered item in it is printed bold,"),
    ours("  highlighted and bracketed**, because a document is read as an assertion in a way a spreadsheet with"),
    ours("  blank cells is not."),
    ours(""),
    ours("## What this export does not say"),
    ours(""),
    ours("Nothing here asserts that anything is unlawful, and nothing here asserts that anything is compliant."),
    ours("No cell is filled with a statement that a duty is met. A rule that produced no candidate is recorded as"),
    ours("unknown; where a search was run and returned nothing, that is recorded as evidence and not as proof."),
    ours(""),
    ours("## Counts"),
    ours(""),
    md`- processing activities: ${e.summary.activities}`,
    // The unit is questions, not verdicts — see `candidates_real` in the summary type. The line's
    // WORDING is unchanged on purpose: this README is compared byte for byte against the frozen
    // export of 2026-08-24 (a test), and it is a document delivered to a user,
    // so what it says about itself is not a thing to change in passing. `verdict_records` carries
    // the other count for any consumer that needs it.
    md`- adjudicated candidates: ${e.summary.candidates_real} real, ${e.summary.candidates_dismissed} dismissed`,
    md`- open questions: ${e.summary.open_questions}`,
    md`- rules that produced nothing: ${e.summary.silent_rules} (${inertJoin(outcomes, ours(", "))})`,
    md`- evidence references layer 2 found beyond any layer-1 candidate: ${e.summary.layer2_extensions}`,
    ...(e.declared
      ? [
          md`- quotations from your own documents: ${e.declared.counts.quotes} (verified: ${e.declared.counts.verified}, re-attributed: ${e.declared.counts.re_attributed}, UNVERIFIED: ${e.declared.counts.unverified})`,
        ]
      : []),
    ours(""),
    ours("This output is informational only and does not constitute legal advice."),
    ours(""),
  ], ours("\n"));
}

export function summarizeRopa(e: RopaExport): string {
  const outcomes = Object.entries(e.summary.silent_by_outcome)
    .sort()
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  return [
    `RoPA: ${e.summary.activities} processing activities from ${e.summary.candidates_real} real and ` +
      `${e.summary.candidates_dismissed} dismissed candidate question(s), adjudicated in ${e.summary.verdict_records} verdict(s).`,
    `${e.summary.rows_blocked_on_operator_answer} cell(s) need a human answer before this imports — the ` +
      `processing purpose is an operator fact and is never taken from source.`,
    `${e.summary.open_questions} open question(s) for the operator.`,
    `${e.summary.silent_rules} rule(s) produced nothing and are recorded as unknown, never as clean ` +
      `(${outcomes}).`,
    `${e.summary.layer2_extensions} evidence reference(s) were found by layer 2 beyond any layer-1 candidate ` +
      `and are labelled as such in the provenance cell.`,
    ...declaredConsoleLines(e),
  ].join("\n");
}

/**
 * What the console says about the declared route, on BOTH paths.
 *
 * **The no-reconcile line is the one that matters and it is why this is not inside an `if`.** The
 * emitted files on that path are byte for byte what they were before this feature existed, so the
 * console is the only place left to say that no published document was read — and an export that
 * says nothing about it is one a reader can mistake for an export whose documents were read and
 * agreed. That is the design's sentence about a silent rule, applied to a whole pillar.
 */
function declaredConsoleLines(e: RopaExport): string[] {
  const d = e.declared;
  if (!d) {
    return [
      `${absencePhrase("declared_documents")}. No published document was read for this export, so nothing ` +
        `here says what your privacy policy, terms or store declarations state about any of these activities. ` +
        `Run \`declaration-reconcile\`, then \`reconcile-verify\`, then pass the verified report with --reconcile.`,
    ];
  }
  const lines = [
    `Declared documents read: ${d.documents_read.length}, from ${d.source_label}. ` +
      `${d.counts.quotes} quotation(s) of your own published wording appear in this export ` +
      `(${d.counts.verified} verified, ${d.counts.re_attributed} re-attributed, ${d.counts.unverified} UNVERIFIED). ` +
      `None of them fills an operator field.`,
  ];
  if (!d.verification_ran) {
    lines.push(
      "This report carries no quote_verification, so reconcile-verify has not been run over it and every " +
        "declared cell says so. Nothing has compared these quotations with the documents they cite.",
    );
  }
  for (const line of d.verification_disclosures) lines.push(line);
  if (d.target.state !== "same-root") lines.push(d.target.note);
  return lines;
}
