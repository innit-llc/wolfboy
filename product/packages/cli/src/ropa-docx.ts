import { buildDocx, type DocxBlock, type DocxRun } from "./docx.js";
import {
  DECLARED_VERIFICATION_TEXT,
  GDPR_NOTICE_CHECKLIST_ID,
  NOT_ASSESSED_PREFIX,
  OPERATOR_MARKER_PREFIX,
  absencePhrase,
  adr005State,
  fieldAnswerState,
  operatorMarker,
  renderDeclaredFindingRef,
  renderDeclaredQuote,
  type Adr005State,
  type DeclaredVerification,
  type RopaActivityModel,
  type RopaExport,
  type RopaInput,
  type SilentRuleOutcome,
} from "./ropa.js";

/**
 * The second renderer over `buildRopa`'s data model: the same facts as a standalone Art. 30 record,
 * as an editable word-processor document.
 *
 * ## Why a document and not a spreadsheet
 *
 * The platform this output is aimed at publishes **no data inventory, RoPA or processing-activities
 * object under any name**.
 * What it has is a fill-in-the-brackets policy template whose Appendix A is
 * titled "Record of Processing Activity (ROPA)" and lists the Art. 30 field set, which the customer
 * writes by hand and uploads to a Policies module that accepts PDF, DOCX, ODT, XLSX, ODS, PPTX or
 * ODP. Nothing can fill a structured object
 * that does not exist, so the claim this output makes is the narrower true one: **from code, it
 * produces the document that template asks for.** Of the seven accepted formats, DOCX is the one
 * that is editable — this document ships with blanks a person must answer, so a PDF would be the
 * wrong artefact — and the right shape for prose and nested lists.
 *
 * ## What this document is, and what it deliberately is not
 *
 * It is **our own standalone record, organised under that template's own field headings** so that
 * it drops into its Appendix A. It carries no vendor branding and does not present itself as anyone
 * else's document. The headings are transcribed from the research record rather than paraphrased,
 * so that a reader dropping this into the appendix finds the headings they expect — and because they
 * are transcribed, they are **the template's wording and not the Regulation's**. They follow Art. 30
 * without restating it: the template's processor list omits Art. 30(2)(b) and carries Art. 30(1)(c)
 * in its place, its controller list does not name the controller's representative that Art. 30(1)(a)
 * requires, and its second controller heading adds a lawful basis that Art. 30(1)(b) does not ask
 * for. Sections 3 and 4 print the differences and the field the Article requires; the transcription
 * itself is left alone, because a paraphrased heading would no longer drop into the appendix.
 *
 * **What is reproduced from that template is declared, not described.** `REPRODUCED_FROM_TEMPLATE`
 * is the list, the front matter's sentence is generated from it, and the gate compares it against
 * the research record in both directions. Until 2026-08-24 this comment and the front matter both
 * said the document reproduced none of the template's policy text while section 5.1 reproduced two
 * of its sentences word for word; a sentence generated from the artefact cannot say that again.
 *
 * ## The one constraint this file exists to satisfy
 *
 * A policy document is read as an assertion in a way a spreadsheet with blank cells is not. It is
 * uploaded as audit evidence and read as a claim the customer has made about itself, so **a
 * rendered document that reads as finished while carrying unanswered operator fields or the design's
 * `unknown` rows is worse than no document at all**.
 * Every such value is therefore routed through `blankRun`, which is the only path in this
 * file that produces text for an unanswered value, and which marks it bold, highlighted and
 * bracketed. A test fails if any of them reaches the file as ordinary prose.
 *
 * ## What it does not decide
 *
 * Nothing. Every fact comes from `RopaExport.model` (already derived, already checked against the
 * scan) or from `RopaInput` for the three things the model does not carry: the per-activity purpose
 * reason clause, the structured open questions, and the silent rules' typed outcomes. It reads
 * neither the findings JSON nor any file; it is handed the same `buildRopa` result the CSVs are
 * rendered from, so the document and the spreadsheets cannot disagree about which scan they
 * describe.
 */

/** The file name the `ropa` command writes this document to. */
export const RECORD_DOCUMENT_FILENAME = "record-of-processing-activities.docx";

export const RECORD_DOCUMENT_TITLE = "Record of Processing Activities (GDPR Article 30)";

// ------------------------------------------------------------------------------------------------
// The blank — the one mechanism this phase turns on
// ------------------------------------------------------------------------------------------------

/**
 * The four kinds of unanswered item this document can carry.
 *
 * - `operator` — a fact about the organisation: who the controller is, what the purpose is, who
 *   approved the document. The project's standing rule: asked of the person running the scan or
 *   read from their declared documents, never inferred from source vocabulary.
 * - `unknown` — the scan produced no observation. That is not a statement that
 *   the thing is absent and not a statement that a duty is met.
 * - `not assessed` — the question was not assessed, with the reason attached.
 * - `unverified` — **a quotation of the organisation's own published document that no machine could
 *   confirm.** It is deliberately not folded into `unknown`: there IS an observation here, and it
 *   is the most persuasive kind this export carries — the person's own sentence, apparently out of
 *   their own policy. What is missing is the check, and a document that printed an unconfirmed
 *   quotation in the same words as a missing observation would lose exactly the distinction
 *   `reconcile-verify` exists to draw. It appears only on a run given `--reconcile`.
 */
export type BlankKind = "operator" | "unknown" | "not assessed" | "unverified";

/**
 * Every prefix a blank can open with. Exported so the gate recognises this file's own vocabulary
 * instead of carrying a second copy of it.
 */
export const BLANK_PREFIXES: readonly string[] = [
  OPERATOR_MARKER_PREFIX,
  "[UNKNOWN",
  "[NOT ASSESSED",
  "[UNVERIFIED",
];

export function blankText(kind: BlankKind, detail?: string): string {
  if (kind === "operator") return operatorMarker(detail);
  const label = kind.toUpperCase();
  return detail ? `[${label} — ${detail}]` : `[${label}]`;
}

export function isBlankText(text: string): boolean {
  return BLANK_PREFIXES.some((prefix) => text.startsWith(prefix));
}

/**
 * **The only path in this file by which an unanswered value becomes text.**
 *
 * Bold, highlighted and bracketed, all three: bracketed so it reads as a blank in a plain-text
 * extraction, bold so it reads as a blank in print, highlighted so it reads as a blank to somebody
 * skimming a document that has been uploaded as evidence. The template this record drops into uses
 * bold-and-bracketed for exactly the same purpose — its own guidance text — so the convention is
 * the one its readers already know.
 */
export function blankRun(kind: BlankKind, detail?: string): DocxRun {
  return { text: blankText(kind, detail), bold: true, highlight: true };
}

/**
 * Turn one already-rendered field value from the model into runs, marking it if it is unanswered.
 *
 * The model carries `special_category`, `international_transfer`, `retention` and
 * `security_measures` as prose, not as the `Observation` union they came from, so which kind of
 * value this is has to be recognised rather than branched on. `fieldAnswerState` is the emitter's
 * own classifier over its own closed vocabulary — this file does not carry a second copy of the
 * phrases.
 */
export function valueRuns(text: string): DocxRun[] {
  // The empty string first, because it is the one value `fieldAnswerState` calls "answered" and
  // nobody answered: it is neither an observation nor one of the emitter's absence phrases. An empty
  // cell in a spreadsheet is visibly empty; an empty value on a document line reads as a completed
  // line, which is the exact thing this file exists to refuse. (V1b independent verification,
  // 2026-08-24, SHOULD-FIX 3 and NOTE 5.)
  if (text.trim() === "") return [blankRun("unknown", "no value was supplied for this field")];
  switch (fieldAnswerState(text)) {
    case "operator":
      return [{ text, bold: true, highlight: true }];
    case "not_observed":
      return [blankRun("unknown", text)];
    case "not_assessed":
      return [blankRun("not assessed", text.slice(NOT_ASSESSED_PREFIX.length))];
    case "answered":
      return [{ text }];
  }
}

/**
 * Whether a rendered value leaves its field unanswered.
 *
 * **One predicate, two readers.** `valueRuns` marks exactly the values this returns `true` for, and
 * `unansweredFieldsOf` counts exactly those, so the number the document states about an activity and
 * the marks it prints in that activity cannot disagree. They did disagree until 2026-08-24: two
 * fields were rendered without `valueRuns` and counted by neither, and the CSV beside the document
 * called them unobserved while the document printed them as ordinary prose.
 */
export function isUnansweredValue(text: string): boolean {
  return text.trim() === "" || fieldAnswerState(text) !== "answered";
}

// ------------------------------------------------------------------------------------------------
// The field lists, transcribed from an internal record
// ------------------------------------------------------------------------------------------------

/**
 * The seven fields the controller's record is required to contain, in document order.
 *
 * Transcribed verbatim from an internal record, which extracted them from the
 * template's own structured content rather than from a rendered reading of it. `[COMPANY NAME]` is the
 * template's own unfilled placeholder and is kept: in this record it reads as exactly what it is, a blank
 * the customer fills with their own name.
 */
export const GDPR_CONTROLLER_RECORD_FIELDS: readonly string[] = [
  "Name and contact details of [COMPANY NAME] and the data protection officer; and when applicable, a joint controller",
  "Purpose (lawful basis) of processing personal data",
  "Categories of data subjects and categories of personal data being processed",
  "Categories of recipients to whom the personal data has been or will be disclosed",
  "Third parties in other countries or international organizations who receive the personal data",
  "Retention schedule for each category of personal data",
  "General description of technical and organizational security measures related to each processing activity",
];

/**
 * The four fields the record of a processor acting on another controller's behalf must contain.
 *
 * Same source and same transcription as the controller list above.
 */
export const GDPR_PROCESSOR_RECORD_FIELDS: readonly string[] = [
  "Name and contact details of the processor and of [COMPANY NAME], and when applicable, each of their representatives and data protection officers",
  "Categories of data subjects and categories of personal data being processed",
  "Third parties in other countries or international organizations who receive the personal data",
  "General description of technical and organizational security measures related to each processing activity",
];

/**
 * The CCPA record's field list, in document order.
 *
 * The last entry is a condition introducing `CCPA_CONSUMER_REQUEST_SUBFIELDS` rather than a field with a
 * value of its own, which is why the research record counts this list as seven fields plus a nested group
 * of four while the list itself has eight entries.
 */
export const CCPA_RECORD_FIELDS: readonly string[] = [
  "Date of an activity (e.g., collection, use)",
  "Nature of the activity",
  "Categories of personal information collected about a consumer",
  "Categories of sources from which the personal information is collected",
  "Business or commercial purpose for collecting or selling the personal information",
  "Categories of third parties with whom [COMPANY NAME] shares personal information",
  "Specific pieces of personal information that have been collected about a consumer",
  "If the activity is a consumer request:",
];

/**
 * The four fields recorded where the activity is a consumer request.
 */
export const CCPA_CONSUMER_REQUEST_SUBFIELDS: readonly string[] = [
  "Date and nature of request",
  "Manner in which request was made",
  "Date and nature of response",
  "Basis for denial of a request, if denied in whole or in part",
];

/**
 * The two items the template prints under its own heading "[COMPANY NAME] has no obligation to:".
 *
 * **These are the template's sentences, not field names**, and they sit after and outside every field
 * list in the source. They are reproduced word for word so that a reader comparing this record against
 * the appendix finds them where they expect, and they are declared in `REPRODUCED_FROM_TEMPLATE` so
 * that the document's own account of what it reproduces is generated from them rather than written
 * beside them. This record adopts neither and says nothing about whether either applies. The research
 * record's own parenthetical noting which phrase the source italicises is an annotation about the
 * source and is not part of the item text, so it is not carried here.
 */
export const CCPA_NO_OBLIGATION_ITEMS: readonly string[] = [
  "Retain any personal information about a consumer collected for a single one-time transaction if, in the ordinary course of business, that information about the consumer is not retained.",
  "Reidentify or otherwise link any data that, in the ordinary course of business, is not maintained in a manner that would be considered personal information.",
];

/**
 * The template's own headings that this document quotes inside its prose, where it tells the reader
 * where something in the source sits. Declared for the same reason the field lists are.
 */
export const TEMPLATE_HEADINGS_QUOTED: readonly string[] = ["[COMPANY NAME] has no obligation to:"];

/**
 * **Every line this document reproduces verbatim from the source template, declared rather than
 * described.**
 *
 * The front matter's account of what this document takes from that template is generated from this
 * list (`templateProvenanceText`), and a test check (11) compares the list
 * against the research record in both directions: every entry must be a line of the record's §2
 * verbatim block, and no other line of that block — field heading, nested sub-field, exemption item
 * or policy sentence — may appear in the rendered document. Until 2026-08-24 the front matter said
 * the document "reproduces none of that template's policy text" while section 5.1 carried two of the
 * template's sentences word for word. A sentence written by hand can say that; a sentence generated
 * from this list cannot.
 */
export const REPRODUCED_FROM_TEMPLATE: readonly string[] = [
  // **Deduplicated, because the count is stated in the document.** Three lines appear in both the
  // controller list and the processor list — the data-subject/personal-data heading, the
  // third-country heading and the security-measures heading — so the five lists below hold 26
  // entries drawn from 23 distinct lines of the appendix. A sentence saying "26 lines are reproduced"
  // would be a count of positions in this file dressed up as a count of lines in the source, which is
  // the same class of self-description defect this list exists to close.
  ...new Set([
    ...GDPR_CONTROLLER_RECORD_FIELDS,
    ...GDPR_PROCESSOR_RECORD_FIELDS,
    ...CCPA_RECORD_FIELDS,
    ...CCPA_CONSUMER_REQUEST_SUBFIELDS,
    ...CCPA_NO_OBLIGATION_ITEMS,
    ...TEMPLATE_HEADINGS_QUOTED,
  ]),
];

/**
 * The field GDPR Art. 30(2)(b) requires and the template's processor list does not carry.
 *
 * **Not transcribed and deliberately not in `REPRODUCED_FROM_TEMPLATE`** — it is this document's own
 * addition, worded from the Article, and section 4.1 says so where it prints it.
 */
export const ART_30_2_B_FIELD =
  "Categories of processing carried out on behalf of each controller (GDPR Art. 30(2)(b))";

/**
 * The front matter's account of what this document takes from the template, generated from
 * `REPRODUCED_FROM_TEMPLATE` so that it cannot describe a set it is not counting.
 */
export function templateProvenanceText(): string {
  const total = REPRODUCED_FROM_TEMPLATE.length;
  const items = CCPA_NO_OBLIGATION_ITEMS.length;
  const quoted = TEMPLATE_HEADINGS_QUOTED.length;
  return (
    "The field headings in sections 3, 4 and 5 follow the record-keeping field list published in Drata's " +
    "Personal Data Management Policy template, Appendix A (“Record of Processing Activity”), so that this " +
    `record can be attached to or pasted into that appendix. ${total} distinct lines of that appendix are ` +
    `reproduced here word for word: ${total - items - quoted} field headings and sub-field labels, the ` +
    `${items} items in section 5.1, which in the source are sentences rather than field names, and the ` +
    `${quoted === 1 ? "heading" : `${quoted} headings`} those items sit under, quoted in 5.1 so that a reader ` +
    "can find them there. Nothing else from that template appears in this document — none of its other " +
    "policy text, none of its guidance text, none of its branding, and not its own document title. " +
    "The headings are the template's wording and not the Regulation's: where the two differ, sections 3 " +
    "and 4 say where, and section 4.1 prints the field the Regulation requires and the template's list " +
    "does not carry — that one field is this document's own, worded from the Regulation, and is not the " +
    "template's. This document is not produced by, endorsed by or affiliated with Drata."
  );
}

/**
 * The operator and attestation fields the template's own Revision History table and the Policies
 * module's own data model both ask for.
 *
 * Every one of them is a fact about the organisation and its approval process. None is derivable
 * from source code, so every one of them renders blank.
 */
export const DOCUMENT_CONTROL_FIELDS: readonly string[] = [
  "Policy owner",
  "Editor (author of this version)",
  "Approver",
  "Version",
  "Creation date (effective date)",
  "Approval date",
  "Published date",
  "Renewal date",
  "Description of changes",
];

// ------------------------------------------------------------------------------------------------
// Blocks
// ------------------------------------------------------------------------------------------------

const heading = (level: 1 | 2 | 3 | 4, text: string): DocxBlock => ({ kind: "heading", level, runs: [{ text }] });
const para = (text: string): DocxBlock => ({ kind: "paragraph", runs: [{ text }] });
const runsPara = (runs: DocxRun[], indent = 0): DocxBlock => ({ kind: "paragraph", runs, indent });
const bullet = (runs: DocxRun[], indent = 1): DocxBlock => ({ kind: "paragraph", runs, indent, bullet: true });

/** A `label: value` line where the value may be a blank. */
const labelled = (label: string, value: DocxRun[], indent = 0): DocxBlock =>
  runsPara([{ text: `${label}: `, bold: true }, ...value], indent);

/**
 * The per-activity purpose reason clause, by activity id.
 *
 * `purpose_note` is one of the three things `RopaActivityModel` does not carry — the model writes
 * the composed marker straight into the CSV cell and keeps neither the note nor the composed
 * string — so it is read from the layer-2 input and joined by `id`. **By id, never by position**:
 * the model and the emitted CSV rows correspond positionally only, and building a document on that
 * correspondence would break silently the first time either array is filtered or sorted. Duplicate
 * ids would make the join ambiguous, so they are refused here rather than resolved arbitrarily.
 */
function purposeNotesById(input: RopaInput): Map<string, string | undefined> {
  const notes = new Map<string, string | undefined>();
  for (const a of input.activities) {
    if (notes.has(a.id)) {
      throw new Error(
        `two activities in the layer-2 result carry the id ${a.id}, so the document cannot say which one a ` +
          `purpose note belongs to. Activity ids are the join key between the model and the layer-2 input.`,
      );
    }
    notes.set(a.id, a.purpose_note ?? undefined);
  }
  return notes;
}

/** The recipients value as the CSV renders it, recovered from the model's structured form. */
function recipientText(a: RopaActivityModel): string {
  if (a.recipients.status === "none_observed") return absencePhrase("recipients");
  return a.recipients.vendors.join("; ") + (a.recipients.list_note ? ` — ${a.recipients.list_note}` : "");
}

/** One record field of an activity whose value comes off the model. */
export interface ActivityValueField {
  /** What this field is called in the per-activity unanswered-items sentence. */
  name: string;
  /** The label the line prints under, where the line carries one of its own rather than sitting under a heading. */
  label?: string;
  /** The value, as `buildRopa` already rendered it. */
  read: (a: RopaActivityModel) => string;
}

export type ActivityValueFieldKey =
  | "data_subjects"
  | "personal_data"
  | "special_category"
  | "recipients"
  | "international_transfer"
  | "retention"
  | "security_measures";

/**
 * **Every value this document prints inside an activity, in one table, in document order.**
 *
 * The table is the mechanism, not a tidy-up. Before it existed, `activityBlocks` rendered seven
 * values and `unansweredFieldsOf` knew about five: `data_subjects` and `personal_data` were written
 * as plain runs that never reached `valueRuns`, so an absence phrase in either printed as ordinary
 * black prose while the CSV emitted from the same run counted the same field as unobserved. Patching
 * those two lines would have left the next field added with the same hole. Now the rendering and the
 * count read the same table, a test check (12) enumerates the activity
 * properties `ropa-input.schema.json` declares and fails if one of them is neither in this table nor
 * declared here as carrying no record value, and its negative control plants an absence into every
 * entry of this table in turn rather than into a hand-picked two. (V1b independent verification,
 * 2026-08-24, MUST-FIX 1.)
 *
 * The keys are the model's own property names so that the schema comparison is an equality rather
 * than a mapping somebody has to maintain.
 */
export const ACTIVITY_VALUE_FIELDS: Record<ActivityValueFieldKey, ActivityValueField> = {
  data_subjects: {
    name: "categories of data subjects",
    label: "Categories of data subjects",
    read: (a) => a.data_subjects,
  },
  personal_data: {
    name: "categories of personal data",
    label: "Categories of personal data",
    read: (a) => a.personal_data,
  },
  special_category: {
    name: "special categories of personal data",
    label: "Special categories of personal data (Art. 9)",
    read: (a) => a.special_category,
  },
  recipients: { name: "categories of recipients", label: "Recipients", read: recipientText },
  international_transfer: { name: "third-country recipients", read: (a) => a.international_transfer },
  retention: { name: "retention schedule", read: (a) => a.retention },
  security_measures: { name: "security measures", read: (a) => a.security_measures },
};

/**
 * The activity properties `ropa-input.schema.json` declares that carry no record value of their own,
 * each with the reason. Check (12) requires every declared property to be in this set, in
 * `ACTIVITY_VALUE_FIELDS` or in `DECLARED_ACTIVITY_FIELDS`, so a property added to the schema cannot
 * quietly render outside all three.
 */
export const ACTIVITY_NON_VALUE_PROPERTIES: Readonly<Record<string, string>> = {
  id: "the join key; printed in the activity heading",
  name: "the activity's own name; printed in the activity heading",
  purpose_note: "a reason clause composed INSIDE the operator marker, never a value of its own",
  proposed_by: "provenance; rendered by buildRopa into the provenance sentence",
  evidence: "provenance; rendered as the evidence list under each activity",
  provenance_qualifier: "provenance; consumed by buildRopa, not printed",
};

/**
 * The activity properties that render **only on a run given `--reconcile`**, each read off the
 * model's resolved `declared` block rather than off the raw ids the schema carries.
 *
 * **They are a third table rather than two more entries in `ACTIVITY_VALUE_FIELDS`, and the reason
 * is the one property this whole file turns on.** Everything in that table is rendered on every
 * run; a declared field has nothing to render on a run that read no document, and an entry there
 * would print `[UNKNOWN — no value was supplied for this field]` under every activity of every
 * export that never used pillar 2. That is a blank saying something false — the question was never
 * asked, so nothing about it is unknown in the design's sense — and it would also make the
 * no-reconcile document differ from the one this repository has frozen.
 *
 * What they share with that table is the mechanism: one entry is read by the renderer AND by
 * `unansweredFieldsOf`, through one predicate, so a declared line cannot be printed as a marked
 * blank and left out of the activity's own count.
 */
export type DeclaredActivityFieldKey = "declared_purpose_claims" | "declaration_finding_ids";

/**
 * **One line per quotation, not one line per field**, which is the difference between this table and
 * `ACTIVITY_VALUE_FIELDS`. A row can map four claims that landed on three different verification
 * states; a single joined value would have to take the worst of them, and the whole cell would then
 * print as `[UNVERIFIED — …]` over three quotations a machine did confirm. The CSV has one cell and
 * has to join; a document has lines and does not, so it prints each quotation with its own state.
 */
export interface DeclaredActivityField {
  /** What an unmapped field is called in the per-activity unanswered-items sentence. */
  name: string;
  label: string;
  /** One rendered line per mapped item, each with its own state and its own name for the count. */
  items: (a: RopaActivityModel) => { text: string; state: DeclaredVerification; name: string }[];
  /** The phrase printed when nothing was mapped — one of the emitter's own absence phrases. */
  empty: (a: RopaActivityModel) => string;
}

export const DECLARED_ACTIVITY_FIELDS: Record<DeclaredActivityFieldKey, DeclaredActivityField> = {
  declared_purpose_claims: {
    name: "declared purpose (from your own documents)",
    label: "What your own documents say about this activity — to confirm, not an answer",
    items: (a) =>
      (a.declared?.purpose_quotes ?? []).map((q) => ({
        text: renderDeclaredQuote(q),
        state: q.verification,
        name: `declared purpose quoted from ${q.source}${q.location === "" ? "" : `:${q.location}`}`,
      })),
    empty: (a) => a.declared?.purpose_text ?? absencePhrase("declared_purpose"),
  },
  declaration_finding_ids: {
    name: "declaration reconciliation findings",
    // The heading says whose sentences these are. They are the reconciliation's questions about the
    // document, not lines of it, and the state word after each one describes the quotations behind
    // it rather than the question. (Independent verification, 2026-09-02, V.3.)
    label:
      "Where your documents and this code did not appear to match — the reconciliation's own questions, not " +
      "quotations from your documents",
    items: (a) =>
      (a.declared?.findings ?? []).map((f) => ({
        text: renderDeclaredFindingRef(f),
        state: f.verification,
        name: `declaration finding ${f.finding_id}`,
      })),
    empty: (a) => a.declared?.findings_text ?? absencePhrase("declaration_findings"),
  },
};

/**
 * The operator facts every activity prints a blank for, named as the unanswered-items sentence names
 * them, in the order the record's headings ask for them.
 *
 * They are counted **with** the record values in that sentence so that one number covers every mark a
 * reader can see between an activity's heading and the next one. The sentence used to count the
 * record values only and add "beyond the two operator fields above", which put the sentence and the
 * marks on the page on two different scopes with nothing holding them together. Check (10) re-derives
 * the number by counting blanks in the activity's own paragraphs, which needs one scope.
 */
export const ACTIVITY_OPERATOR_FIELD_NAMES: readonly string[] = [
  "controller and DPO identity",
  "purpose of processing",
];

/** One `label: value` or bare value line, with the value classified by the one predicate. */
function valueLine(field: ActivityValueField, a: RopaActivityModel, indent = 1): DocxBlock {
  const runs = valueRuns(field.read(a));
  return field.label ? labelled(field.label, runs, indent) : runsPara(runs, indent);
}

/**
 * Runs for a declared value, marked when the verification did not confirm it.
 *
 * Three outcomes and one predicate, shared with `declaredIsUnanswered` below:
 *
 * - nothing mapped — the text is one of the emitter's own absence phrases, so `valueRuns` marks it
 *   through the same path every other absence takes;
 * - confirmed or re-attributed — ordinary prose, because a machine found the text in the document;
 * - anything else — `[UNVERIFIED — …]`, bold, highlighted and bracketed, because the quotation
 *   reads as the person's own published sentence and nothing has checked that it is one.
 */
function declaredRuns(text: string, state: DeclaredVerification): DocxRun[] {
  if (state === "verified" || state === "re-attributed") return [{ text }];
  return [blankRun("unverified", text)];
}

function declaredIsUnanswered(state: DeclaredVerification): boolean {
  return !(state === "verified" || state === "re-attributed");
}

/** The label line and one line per mapped item, or the label line and the absence phrase. */
function declaredLines(field: DeclaredActivityField, a: RopaActivityModel, indent = 1): DocxBlock[] {
  const items = field.items(a);
  if (items.length === 0) {
    return [labelled(field.label, valueRuns(field.empty(a)), indent)];
  }
  return [
    runsPara([{ text: `${field.label}:`, bold: true }], indent),
    ...items.map((item) => runsPara(declaredRuns(item.text, item.state), indent + 1)),
  ];
}

function activityBlocks(
  a: RopaActivityModel,
  index: number,
  purposeNote: string | undefined,
  fields: readonly string[],
): DocxBlock[] {
  const blocks: DocxBlock[] = [heading(3, `3.${index + 1}  ${a.id} — ${a.name}`)];

  blocks.push(runsPara([{ text: fields[0], bold: true }]));
  blocks.push(
    runsPara(
      [blankRun("operator", "controller and DPO identity is answered once, in section 3.0, and applies to every activity in this record")],
      1,
    ),
  );

  blocks.push(runsPara([{ text: fields[1], bold: true }]));
  blocks.push(runsPara([blankRun("operator", purposeNote)], 1));
  // Beside the blank and never in it. The operator marker above is composed by `operatorMarker`,
  // which has no parameter a purpose could be passed through; this line is the organisation's own
  // published wording, quoted with its location and the state of the check on it, so the person
  // answering the blank is confirming a sentence rather than writing one.
  if (a.declared) blocks.push(...declaredLines(DECLARED_ACTIVITY_FIELDS.declared_purpose_claims, a));

  blocks.push(runsPara([{ text: fields[2], bold: true }]));
  blocks.push(valueLine(ACTIVITY_VALUE_FIELDS.data_subjects, a));
  blocks.push(valueLine(ACTIVITY_VALUE_FIELDS.personal_data, a));
  blocks.push(valueLine(ACTIVITY_VALUE_FIELDS.special_category, a));

  blocks.push(runsPara([{ text: fields[3], bold: true }]));
  blocks.push(valueLine(ACTIVITY_VALUE_FIELDS.recipients, a));
  // The status line and the caveat under it are about recipients the code offers. Where the scan
  // observed none there is no status to state — the recipients line above already carries the
  // unknown — and printing the emitter's "n/a" placeholder under it would add a word, not a fact.
  if (a.recipients.status !== "none_observed") {
    blocks.push(labelled("Status of those recipients", [{ text: a.recipients.status_text }], 1));
    blocks.push(
      runsPara(
        [
          {
            text:
              "This scanner sees the option the code offers, not the choice the operator made. No entry above " +
              "states that a recipient receives data in this deployment; confirming that is the operator's step.",
            italic: true,
          },
        ],
        1,
      ),
    );
  }

  blocks.push(runsPara([{ text: fields[4], bold: true }]));
  blocks.push(valueLine(ACTIVITY_VALUE_FIELDS.international_transfer, a));

  blocks.push(runsPara([{ text: fields[5], bold: true }]));
  blocks.push(valueLine(ACTIVITY_VALUE_FIELDS.retention, a));

  blocks.push(runsPara([{ text: fields[6], bold: true }]));
  blocks.push(valueLine(ACTIVITY_VALUE_FIELDS.security_measures, a));

  if (a.declared) {
    blocks.push(
      runsPara([
        {
          text: "Declaration reconciliation — your published documents read against this activity's code",
          bold: true,
          italic: true,
        },
      ]),
    );
    blocks.push(...declaredLines(DECLARED_ACTIVITY_FIELDS.declaration_finding_ids, a));
  }

  blocks.push(
    runsPara([
      {
        text: "Evidence and provenance — this scanner's own audit trail, not part of the record's field list",
        bold: true,
        italic: true,
      },
    ]),
  );
  blocks.push(runsPara([{ text: a.provenance.text, mono: true }], 1));
  for (const e of a.evidence) {
    blocks.push(
      bullet(
        [{ text: e.ref, mono: true }, ...(e.note ? [{ text: ` (${e.note})` }] : [])],
        1,
      ),
    );
  }

  const unanswered = [...ACTIVITY_OPERATOR_FIELD_NAMES, ...unansweredFieldsOf(a)];
  blocks.push(
    runsPara([
      { text: "Unanswered in this activity: ", bold: true },
      { text: `${unanswered.length} item(s) — ${unanswered.join(", ")}` },
    ]),
  );
  return blocks;
}

/**
 * The record fields of one activity that carry no answer, by the field's own name in this document.
 *
 * This is the document's counterpart to the CSV's `row_status` cell, which is not on the model and
 * could only be recovered by joining on array position. It reads **the same table `activityBlocks`
 * renders from**, through the same predicate `valueRuns` marks with, so a field cannot be printed as
 * a blank and left out of the count, or counted and printed as prose. Over **this document's** field
 * set rather than the CSV's thirteen columns — the two field sets genuinely differ, so the sentence
 * differs; what does not differ is which values count as unanswered.
 */
export function unansweredFieldsOf(a: RopaActivityModel): string[] {
  const names = Object.values(ACTIVITY_VALUE_FIELDS)
    .filter((f) => isUnansweredValue(f.read(a)))
    .map((f) => f.name);
  // The declared lines are counted here on exactly the same terms, because `activityBlocks` prints
  // them inside the activity and check (10) re-derives this number by counting the marked blanks in
  // that activity's own paragraphs. A declared line that were marked and not counted would make the
  // document's own sentence about itself false, which is the class that check exists to close.
  if (!a.declared) return names;
  for (const field of Object.values(DECLARED_ACTIVITY_FIELDS)) {
    const items = field.items(a);
    if (items.length === 0) names.push(field.name);
    else for (const item of items) if (declaredIsUnanswered(item.state)) names.push(item.name);
  }
  return names;
}

function documentControlBlocks(): DocxBlock[] {
  const blocks: DocxBlock[] = [
    heading(1, "2.  Document control"),
    para(
      "Every field in this section is a fact about your organisation and its own approval process. This " +
        "scanner reads source code, which contains none of them, so it fills none of them.",
    ),
  ];
  for (const field of DOCUMENT_CONTROL_FIELDS) {
    blocks.push(labelled(field, [blankRun("operator")]));
  }
  return blocks;
}

/**
 * The controller identity as the organisation's own notice states it, printed under section 3.0
 * beside the blank and never in it.
 *
 * **The blank above stays exactly what it was**, because Art. 30(1)(a) is answered by a person and
 * a quotation from a privacy notice is not that answer: a notice can name a controller that is not
 * the controller of the activities in this record, and whether a data protection officer has been
 * designated under Art. 37 is a fact about the organisation that no document settles by mentioning
 * one. What these lines do is put the sentence the person already published in front of them, with
 * the document, the line, and whether a machine found that text where the report said it was.
 *
 * Empty on a run given no `--reconcile`, which is what leaves the document byte for byte what it
 * was on that path.
 */
function declaredControllerBlocks(e: RopaExport): DocxBlock[] {
  const d = e.declared;
  if (!d) return [];
  const blocks: DocxBlock[] = [
    runsPara([
      {
        text: "What your own notice says about this — a declaration to confirm, not an answer to this field",
        bold: true,
        italic: true,
      },
    ]),
    para(
      `Read by the declaration reconciliation from ${d.documents_read.length} document(s) recorded in ` +
        `${d.source_label}. The status word under each item is the notice checklist's own and describes the ` +
        `DOCUMENT: it says whether the document carries the information the item asks for, and it says nothing ` +
        `about whether any duty is met. Applicability of checklist ${GDPR_NOTICE_CHECKLIST_ID} to this ` +
        `organisation: ${d.checklist_applicability}.`,
    ),
    para(d.target.note),
  ];
  if (!d.verification_ran) {
    blocks.push(
      runsPara([
        blankRun(
          "unverified",
          "this report never went through reconcile-verify, so nothing has compared the quotations below with " +
            "the documents they cite",
        ),
      ]),
    );
  }
  // What the verification says about ITSELF — a digest that moved under it, or an annotation naming
  // another reconciliation. The same array the console and the README print, marked here because a
  // document is read as an assertion in a way a console line is not. (Independent verification,
  // 2026-09-02, V.4.)
  for (const line of d.verification_disclosures) {
    blocks.push(runsPara([blankRun("unverified", line)]));
  }
  for (const item of d.controller_identity) {
    blocks.push(runsPara([{ text: `${item.item_id} — ${item.asks}`, bold: true }], 1));
    blocks.push(labelled("Status in your document", declaredStatusRuns(item.status, item.walked), 2));
    if (item.quotes.length === 0) {
      blocks.push(labelled("Quoted", valueRuns(absencePhrase("declared_quote")), 2));
    }
    for (const q of item.quotes) {
      blocks.push(labelled("Quoted", declaredRuns(renderDeclaredQuote(q), q.verification), 2));
    }
    if (item.reasoning) blocks.push(labelled("Why the checklist said so", [{ text: item.reasoning }], 2));
  }
  return blocks;
}

/**
 * The checklist's own status word, marked where it is a statement about the reading rather than
 * about the document.
 *
 * `unresolved` and the not-walked phrase both say nobody settled the item, and a document that
 * printed either as ordinary prose beside a heading asking for the controller's identity would read
 * as though the question had been answered. `absent` and `partial` are answers — unwelcome ones —
 * and print as prose, because they are what the document actually does.
 */
function declaredStatusRuns(status: string, walked: boolean): DocxRun[] {
  if (!walked) return valueRuns(status);
  if (status === "unresolved") {
    return [blankRun("unknown", `the notice checklist could not settle this item (status: ${status})`)];
  }
  return [{ text: status }];
}

function controllerBlocks(input: RopaInput, e: RopaExport, fields: readonly string[]): DocxBlock[] {
  const notes = purposeNotesById(input);
  const blocks: DocxBlock[] = [
    heading(1, "3.  GDPR — record of processing activities under this organisation's responsibility"),
    para(
      `One entry per processing activity, under the ${fields.length} headings the template's field list ` +
        "carries. The activities and their field text were written by the adjudicating agent from reading " +
        "this codebase; the provenance line under each one names the detector rules that proposed it.",
    ),
    // Two differences between the template's wording and the Article's, printed rather than smoothed
    // over. The headings are transcribed and stay transcribed — a paraphrase would no longer drop
    // into the appendix — so the correction goes beside them. (V1b verification, 2026-08-24, NOTE 1.)
    para(
      "The headings are the template's wording, not the Regulation's, and they differ from it in two places. " +
        "The second reads “Purpose (lawful basis) of processing personal data”; GDPR Art. 30(1)(b) requires " +
        "the purposes of the processing, and a lawful basis is worth recording beside them but is not an " +
        "Art. 30(1) field. The first does not name the controller's representative, which Art. 30(1)(a) requires " +
        "where one is appointed; the blank under it asks for the representative as well.",
    ),
    // The template's own applicability paragraph is NOT reproduced, and this is the sentence that
    // replaces it. The source says a record is required only above 250 employees or where processing
    // is likely to result in "high risk"; Art. 30(5) says "a risk", and the exemption falls away on
    // any one of three limbs, of which the source states one and a half. Reproducing it would have
    // raised the threshold and dropped two limbs, so it is restated from the Article instead.
    // (V1b verification, 2026-08-24, NOTE 2 — recorded here so the omission is not re-opened.)
    para(
      "Whether Art. 30 applies to this organisation at all is a question this record does not answer. " +
        "Art. 30(5) exempts an enterprise or organisation employing fewer than 250 persons, and that exemption " +
        "falls away on any one of three limbs: processing likely to result in a risk to the rights and freedoms " +
        "of data subjects, processing that is not occasional, or processing of the special categories of data in " +
        "Art. 9(1) or of the data in Art. 10. Head count and how often processing runs are facts about the " +
        "organisation, and neither is in its source code.",
    ),
    heading(2, "3.0  Controller identity (applies to every activity below)"),
    runsPara([{ text: fields[0], bold: true }]),
    runsPara(
      [
        blankRun(
          "operator",
          "the controller's name and contact details, the data protection officer's contact details, any joint controller, and the controller's representative where one is appointed (Art. 30(1)(a) requires the representative; the heading above does not name it)",
        ),
      ],
      1,
    ),
    ...declaredControllerBlocks(e),
    heading(2, `Activities recorded (${e.model.activities.length})`),
  ];
  e.model.activities.forEach((a, i) => {
    if (!notes.has(a.id)) {
      throw new Error(
        `the model carries activity ${a.id}, which is not in the layer-2 input's activity list. The document ` +
          `joins the two by id and will not fall back to array position.`,
      );
    }
    blocks.push(...activityBlocks(a, i, notes.get(a.id), fields));
  });
  return blocks;
}

function processorBlocks(fields: readonly string[]): DocxBlock[] {
  const reason =
    "whether this organisation also processes personal data on another controller's behalf is a fact about " +
    "its contracts, not about its code, and this scanner does not ask it";
  const blocks: DocxBlock[] = [
    heading(1, "4.  GDPR — record of categories of processing carried out on behalf of another controller"),
    para(
      "GDPR Art. 30(2) requires a separate record of a processor acting on another controller's behalf. " +
        "Nothing in a source scan establishes whether this organisation acts in that role for anyone, and no " +
        "question in this product's input asks it, so every field below is unassessed. This section is " +
        "printed rather than omitted: a record that simply left it out would read as an answer.",
    ),
  ];
  for (const field of fields) {
    blocks.push(runsPara([{ text: field, bold: true }]));
    blocks.push(runsPara([blankRun("not assessed", reason)], 1));
  }
  // **Added beside the template's list, never inside it.** Art. 30(2)(b) is "the categories of
  // processing carried out on behalf of each controller", and the four transcribed fields above do
  // not ask for it — while their second item asks for categories of data subjects and of personal
  // data, which Art. 30(2) does not require of a processor at all: that is Art. 30(1)(c), a field of
  // the controller's own record. Until 2026-08-24 the front matter told the reader these headings
  // restated Art. 30(2), so a customer filling this section in by hand would have produced a
  // processor record missing the single most characteristic field of one and believed it complete.
  // The transcription is not the fault and is left exactly as it is; the missing field is printed
  // here, marked as this document's own addition. (V1b independent verification, MUST-FIX 2.)
  blocks.push(heading(2, "4.1  What Art. 30(2) requires that the template's list does not carry"));
  blocks.push(
    para(
      `The ${fields.length} headings above are transcribed from the template. Two things follow from ` +
        "comparing them against the Regulation, and both are printed rather than corrected in place, " +
        "because a paraphrased " +
        "heading would no longer drop into the appendix. First, Art. 30(2)(b) requires a field the list does " +
        "not ask for; it is printed below. Second, the list's second heading — categories of data subjects " +
        "and of personal data — is Art. 30(1)(c), a field of the controller's record; Art. 30(2) does not " +
        "require it of a processor. It is kept, because this section follows the template's list.",
    ),
  );
  blocks.push(runsPara([{ text: ART_30_2_B_FIELD, bold: true }]));
  blocks.push(runsPara([blankRun("not assessed", reason)], 1));
  return blocks;
}

function ccpaBlocks(
  fields: readonly string[],
  subFields: readonly string[],
  carveOuts: readonly string[],
): DocxBlock[] {
  const reason =
    "this product's rule packs are EU-first and its US coverage is not built, so no part of this record " +
    "was assessed against the CCPA";
  const blocks: DocxBlock[] = [
    heading(1, "5.  CCPA — record of personal information processing activity"),
    // The lead used to open "The CCPA has no explicit requirement for a formal record of processing
    // activity, but a record is kept to meet its record-keeping and consumer-request duties." Two
    // things were wrong with one sentence. "A record is kept" asserted a fact about the customer that
    // nobody established, in a document the customer files as its own statement — the template's own
    // equivalent is first-person and forward-looking, an intention adopted by signing, and stripping
    // the subject turned it into an assertion. And the clause before it was an uncited legal claim,
    // made on this product's own authority, about a jurisdiction the next sentence says was not
    // assessed. Both are gone rather than re-sourced: this section says what it is and what it does
    // not know. (V1b independent verification, 2026-08-24, SHOULD-FIX 1.)
    runsPara([
      { text: "This section follows the record-keeping field list the template carries for the CCPA. " },
      { text: "Every field in this section is unassessed.", bold: true },
      {
        text:
          " This product's rule packs cover the EU first; its US coverage is not built, and none of the " +
          "fields below was evaluated — including whether the CCPA applies to this organisation at all, and " +
          "including what the CCPA and its regulations do and do not require to be recorded. The section is " +
          "printed rather than omitted for the same reason as section 4 — an omitted section reads as an " +
          "answered one.",
      },
    ]),
  ];
  fields.forEach((field, i) => {
    blocks.push(runsPara([{ text: field, bold: true }]));
    // The last field of the list is a condition introducing four further fields rather than a field
    // with a value of its own, so its sub-fields carry the blanks and it does not.
    if (i === fields.length - 1) {
      for (const sub of subFields) {
        blocks.push(runsPara([{ text: sub, bold: true }], 1));
        blocks.push(runsPara([blankRun("not assessed", reason)], 2));
      }
    } else {
      blocks.push(runsPara([blankRun("not assessed", reason)], 1));
    }
  });
  // The heading and the paragraph under it used to say "the field list this section follows names
  // two record-keeping exemptions". It names nothing of the kind: in the source these two are
  // sentences under the template's own heading "[COMPANY NAME] has no obligation to:", after and
  // outside every field list. They are the only text in this section that is not a field heading,
  // they are reproduced word for word, and `REPRODUCED_FROM_TEMPLATE` declares them so that the front
  // matter's account of what this document reproduces is generated rather than asserted.
  // (V1b independent verification, 2026-08-24, MUST-FIX 3.)
  blocks.push(heading(2, "5.1  Two items reproduced from the template's own exemption list"));
  blocks.push(
    para(
      "The template this section's field list comes from closes its CCPA appendix with two items under the " +
        "heading “[COMPANY NAME] has no obligation to:”. Those are the template's own sentences rather than " +
        "field names, and they are reproduced here word for word so that a reader comparing this record " +
        "against the appendix finds them where they expect. This record adopts neither and makes no claim " +
        "about either, in either direction — whether one applies to any activity above turns on how the " +
        "business ordinarily operates, which is not in the code.",
    ),
  );
  for (const item of carveOuts) {
    blocks.push(runsPara([{ text: item, bold: true }]));
    blocks.push(runsPara([blankRun("not assessed", reason)], 1));
  }
  return blocks;
}

/**
 * Section 6, rendered from the built export alone.
 *
 * **There is no join here any more, which is why there is nothing left to fail.** This used to walk
 * the layer-2 input and look each question's applicability date up in the export by id, rendering an
 * empty `Applies from: ` when the lookup missed — an unmarked blank in the one field the project's rules
 * calls the plainest of the 2026-08-04 legal-accuracy failures — while the activity join beside it
 * threw on the same mismatch. `buildRopa` has already put every field this section prints onto
 * `e.open_questions`, including the two that were being re-derived here: the date, which
 * `applicabilityDate` throws rather than leaves empty, and the `n/a` default for missing source
 * evidence, which was a second copy of the default `buildRopa` applies. Reading the export is what
 * removes both. (V1b independent verification, 2026-08-24, SHOULD-FIX 2 and SHOULD-FIX 6.)
 */
function openQuestionBlocks(e: RopaExport): DocxBlock[] {
  const blocks: DocxBlock[] = [
    heading(1, `6.  Questions this record cannot answer from code (${e.open_questions.length})`),
    para(
      "Each question below blocks one or more entries in section 3. The reason the code cannot settle it is " +
        "stated with it, and the date is read out of the effective date the relevant rules carry in the scan, " +
        "so a duty already in force is never printed as one that has not started.",
    ),
  ];
  e.open_questions.forEach((q, i) => {
    blocks.push(heading(3, `6.${i + 1}  ${q.question_id}`));
    blocks.push(labelled("Question", valueRuns(q.question)));
    blocks.push(labelled("Why the code cannot answer it", valueRuns(q.why_code_cannot_answer)));
    blocks.push(labelled("Entries it blocks", valueRuns(q.blocks)));
    blocks.push(labelled("Applies from", valueRuns(q.applicability_date)));
    blocks.push(labelled("Source evidence", valueRuns(q.source_evidence)));
    blocks.push(labelled("Answer", [blankRun("operator")]));
  });
  return blocks;
}

const SILENT_STATE_ORDER: readonly Adr005State[] = ["gap found", "apparently absent", "unknown"];

/**
 * What an empty group means, printed under the heading when a group has no rules in it.
 *
 * `7.1  gap found (0)` over a present-tense lead is the closest this document comes to reading clean:
 * a skimming reader can take it as "no gaps were found". The surrounding text does the honest work,
 * but the heading is what is skimmed. (V1b independent verification, 2026-08-24, NOTE 7.)
 */
const SILENT_STATE_EMPTY: Record<Adr005State, string> = {
  "gap found":
    "No rule was placed in this group by this adjudication. That is not a finding that no detector missed " +
    "anything: a construct nobody searched for cannot appear here at all, and the rules nobody searched are " +
    "listed under unknown below.",
  "apparently absent":
    "No rule was placed in this group by this adjudication: no search was recorded as having been run and " +
    "returned nothing.",
  unknown:
    "No rule was placed in this group by this adjudication: every rule that produced no candidate was either " +
    "searched for or located.",
};

const SILENT_STATE_LEAD: Record<Adr005State, string> = {
  "gap found":
    "The construct is in this tree and no detector raised it. This is the most useful thing the second " +
    "layer produces, and it is recorded with the file, the lines and the quote that locate it.",
  "apparently absent":
    "Searched, and the search returned nothing. That is evidence and not proof: what was searched for is " +
    "printed with each rule.",
  unknown:
    "The detector produced nothing and nobody looked further. Every rule in this group is unanswered — it " +
    "is not a statement that the construct is absent, and not a statement that any duty is met.",
};

/**
 * The rules that produced no candidate, grouped into the design's three states.
 *
 * **One derivation, read by section 7 and by section 8.** Section 8 used to print the evidence log's
 * five internal outcome keys raw — `apparently_absent: 4, not_checked: 33`, snake_case, in a
 * customer-facing document — while section 7 grouped the same rules under the three states eight
 * sections earlier. Two vocabularies for one count, and nothing held them to the same total. Both
 * sections now read this. (V1b independent verification, 2026-08-24, SHOULD-FIX 4.)
 *
 * The outcome is read off the built row rather than joined back to the layer-2 input by rule id: the
 * row already carries it, and a join is one more way for a rule to fall out of all three groups while
 * the heading above still counts it.
 */
export function silentRowsByState(e: RopaExport): Record<Adr005State, Record<string, string>[]> {
  const byState: Record<Adr005State, Record<string, string>[]> = {
    "gap found": [],
    "apparently absent": [],
    unknown: [],
  };
  for (const row of e.unknown_rules) {
    const state = adr005State(row.layer2_outcome as SilentRuleOutcome) as Adr005State | undefined;
    if (state === undefined) {
      throw new Error(
        `silent rule ${row.rule_id} carries the outcome "${row.layer2_outcome}", which is not one of the five ` +
          `outcomes a silent rule may carry, so this document cannot say which of the three states it is in.`,
      );
    }
    byState[state].push(row);
  }
  return byState;
}

function silentRuleBlocks(e: RopaExport): DocxBlock[] {
  const byState = silentRowsByState(e);
  const blocks: DocxBlock[] = [
    heading(1, `7.  Rules that produced no candidate (${e.unknown_rules.length})`),
    para(
      "A detector that matched nothing has established that its patterns did not match this text, and nothing " +
        "further. This product's design records the consequence: the absence of a finding is unknown, never " +
        "clean. The rules below are grouped by what the second layer was able to say about each silence.",
    ),
  ];
  let section = 0;
  for (const state of SILENT_STATE_ORDER) {
    const rows = byState[state];
    section++;
    blocks.push(heading(2, `7.${section}  ${state} (${rows.length})`));
    blocks.push(para(SILENT_STATE_LEAD[state]));
    if (rows.length === 0) blocks.push(para(SILENT_STATE_EMPTY[state]));
    for (const row of rows) {
      // The state label and the claim sentence share one paragraph, deliberately. The sentence is
      // honest prose on its own, but this phase is about prose: an `unknown` has to be visible
      // without reading the sentence, and the gate asserts the marker and the claim are together.
      const label: DocxRun[] = [{ text: row.rule_id, bold: true, mono: true }, { text: "  " }];
      const stateRun: DocxRun =
        state === "unknown" ? blankRun("unknown") : { text: `[${state.toUpperCase()}]`, bold: true };
      blocks.push(runsPara([...label, stateRun, { text: "  " }, { text: row.what_this_row_claims }]));
      blocks.push(labelled("What the detector looked for", [{ text: row.what_the_detector_looked_for }], 1));
      blocks.push(labelled("Searched", [{ text: row.layer2_searched }], 1));
      if (row.layer2_evidence) blocks.push(labelled("Located at", [{ text: row.layer2_evidence, mono: true }], 1));
      blocks.push(
        labelled(
          "Files the rule was offered / matches a corroboration gate removed",
          [{ text: `${row.files_on_surface || "n/a"} / ${row.matched_then_gated}` }],
          1,
        ),
      );
    }
  }
  return blocks;
}

function countsBlocks(e: RopaExport): DocxBlock[] {
  // The design's three states section 7 groups by, from the same derivation section 7 reads, rather
  // than the evidence log's five internal outcome keys. See `silentRowsByState`.
  const byState = silentRowsByState(e);
  const outcomes = SILENT_STATE_ORDER.map((state) => `${state}: ${byState[state].length}`).join(", ");
  return [
    heading(1, "8.  Counts"),
    ...[
      `processing activities: ${e.summary.activities}`,
      // Wording unchanged for the reason ropa.ts gives on the same line: this document is compared
      // byte for byte against the frozen export of 2026-08-24 and it is delivered to a user.
      `adjudicated candidates: ${e.summary.candidates_real} ruled real, ${e.summary.candidates_dismissed} dismissed`,
      `open questions: ${e.summary.open_questions}`,
      `rules that produced nothing: ${e.summary.silent_rules} (${outcomes})`,
      `evidence references the second layer found beyond any layer-1 candidate: ${e.summary.layer2_extensions}`,
      // Only on a run that read declared documents, and phrased in the same three states section 3
      // prints, so a reader comparing the two is comparing one vocabulary with itself.
      ...(e.declared
        ? [
            `quotations from your own published documents: ${e.declared.counts.quotes} ` +
              `(${DECLARED_VERIFICATION_TEXT.verified}: ${e.declared.counts.verified}, ` +
              `${DECLARED_VERIFICATION_TEXT["re-attributed"]}: ${e.declared.counts.re_attributed}, ` +
              `UNVERIFIED: ${e.declared.counts.unverified})`,
          ]
        : []),
    ].map((text) => bullet([{ text }])),
  ];
}

function closingBlocks(): DocxBlock[] {
  return [
    heading(1, "9.  What this document does not say"),
    para(
      "Nothing here asserts that anything is unlawful, and nothing here asserts that anything is compliant. " +
        "No field is filled with a statement that a duty is met. A rule that produced no candidate is recorded " +
        "as unknown; where a search was run and returned nothing, that is recorded as evidence and not as proof.",
    ),
    para(
      "A source scan cannot establish a violation, because whether one exists turns on facts no repository " +
        "contains — the consent configuration actually deployed, the deployment itself, and whether there are " +
        "data subjects in the relevant jurisdiction at all. It equally cannot establish the absence of one.",
    ),
    para(
      "This output is informational only and does not constitute legal advice. It identifies code that may " +
        "not meet a cited standard and that requires human review; consult qualified counsel before acting " +
        "on it.",
    ),
  ];
}

/**
 * The forms a blank can take in THIS document, and what each one means.
 *
 * **Generated rather than written out, because the document states how many there are.** The
 * sentence above the list used to say "in one of three forms" beside three hand-written bullets;
 * the fourth form exists only on a run given `--reconcile`, so a hand-written sentence would be
 * wrong on one of the two paths. This is the same repair `templateProvenanceText` makes for the
 * count of reproduced lines: a number a reader can check comes out of the thing it counts.
 */
const BLANK_FORM_EXPLANATIONS: Readonly<Record<BlankKind, string>> = {
  operator:
    " — a fact about your organisation. This scanner reads source code, and facts of this kind are not " +
    "in source code. A person answers them.",
  unknown:
    " — the scan produced no observation for this field. That is not a statement that the thing is " +
    "absent, and not a statement that a duty is met.",
  "not assessed": " — the question was not assessed at all. The reason is printed with it.",
  unverified:
    " — a quotation of your own published document that could not be confirmed in that document. It is " +
    "not a statement that your document does not say it; it is a statement that nothing here has checked.",
};

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six"];

function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

function blankFormsIn(e: RopaExport): BlankKind[] {
  const forms: BlankKind[] = ["operator", "unknown", "not assessed"];
  return e.declared ? [...forms, "unverified"] : forms;
}

function frontMatterBlocks(input: RopaInput, e: RopaExport, blanks: number): DocxBlock[] {
  const forms = blankFormsIn(e);
  const word = numberWord(forms.length);
  return [
    { kind: "title", runs: [{ text: RECORD_DOCUMENT_TITLE }] },
    para(`Subject of this record: ${input.target_label ?? input.scan_id}`),
    para(`Produced from scan ${input.scan_id}, adjudicated ${input.as_of}.`),
    heading(1, "1.  How to read this document"),
    para(
      "This is a record of processing activities assembled from a scan of source code and an adjudication of " +
        "what that scan raised. It is a working document with blanks in it. It is not a finished statement " +
        "about an organisation, and it should not be filed as one until the blanks are answered.",
    ),
    // **The scope is named because the number is measured over a scope.** `countBlanks` runs over the
    // body, so the three examples below — which are the marker forms themselves, printed so a reader
    // knows what to look for — are not among the count. The sentence used to say "in this document",
    // which a reader who counts the markers finds to be three short. Check (10) re-derives this number
    // from the rendered bytes over the same scope. (V1b verification, 2026-08-24, SHOULD-FIX 5.)
    para(
      `${blanks} item(s) in sections 2 to 9 of this document are unanswered. Every one of them is printed in ` +
        `bold, highlighted, inside square brackets, in one of ${word} forms. The ${word} examples below show the ` +
        "forms themselves and are not counted among them:",
    ),
    ...forms.map((kind) =>
      bullet([
        { text: blankText(kind), bold: true, highlight: true },
        { text: BLANK_FORM_EXPLANATIONS[kind] },
      ]),
    ),
    para(templateProvenanceText()),
    para(
      `Counts are in section 8. The same facts are also emitted as spreadsheets beside this file; both come ` +
        `from one run of the scanner over one scan, so they cannot describe different runs.`,
    ),
  ];
}

// ------------------------------------------------------------------------------------------------
// The document
// ------------------------------------------------------------------------------------------------

function countBlanks(blocks: DocxBlock[]): number {
  let n = 0;
  for (const block of blocks) for (const run of block.runs) if (isBlankText(run.text)) n++;
  return n;
}

/**
 * The whole document as blocks, before serialisation.
 *
 * Separated from `renderRopaDocument` so the gate can assert over the structure — which runs are
 * marked, which field headings appear — without unzipping anything, and then assert the same
 * properties again over the bytes that actually ship.
 */
export function buildRopaDocumentBlocks(input: RopaInput, e: RopaExport): DocxBlock[] {
  const body: DocxBlock[] = [
    ...documentControlBlocks(),
    ...controllerBlocks(input, e, GDPR_CONTROLLER_RECORD_FIELDS),
    ...processorBlocks(GDPR_PROCESSOR_RECORD_FIELDS),
    ...ccpaBlocks(CCPA_RECORD_FIELDS, CCPA_CONSUMER_REQUEST_SUBFIELDS, CCPA_NO_OBLIGATION_ITEMS),
    ...openQuestionBlocks(e),
    ...silentRuleBlocks(e),
    ...countsBlocks(e),
    ...closingBlocks(),
  ];
  // The front matter states how many blanks the document carries, so it is composed last and put
  // first. A hand-maintained number here would be the first thing to go stale.
  return [...frontMatterBlocks(input, e, countBlanks(body)), ...body];
}

export function renderRopaDocument(input: RopaInput, e: RopaExport): Buffer {
  return buildDocx(buildRopaDocumentBlocks(input, e), RECORD_DOCUMENT_TITLE);
}
