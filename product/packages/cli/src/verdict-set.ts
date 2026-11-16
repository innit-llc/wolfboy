/**
 * A FINDING'S VERDICT RECORDS ARE ONE SET.
 *
 * A finding's placement rests on more than its adjudicator's record: the ordinary refutation (`refutation/<id>.json`, nested in
 * the log's verdict as `refutation`) and the second look (`refutation/challenge-<id>.json`, nested as `second_look`) each move
 * it. Until this unit a later run carried the verdict and its refutation and dropped the second look, so a high finding the
 * second look found to be a problem (to fix) or could not settle (counsel) came back on an unchanged tree as "recorded, not
 * counted". The class fix: the set is named here once, and carry takes the whole set or none of it.
 *
 * - `VERDICT_SET_KINDS` is the one list of the kinds. A kind added to how a finding is placed is added here, and every reader
 *   of the set (the carry's comparison, the assembly that writes the log) reads it from here.
 * - `verdictSetOf` names the set an earlier run holds for one finding: the kinds its log row carries, and the kinds that are
 *   missing from it. Missing means either that the earlier run held the record apart from the row it would be carried from
 *   (a directory of the run's own files, where the refutation and the second look are separate files the carry does not take,
 *   or a log whose `challenges[]` names a second look its row does not hold), or that the record was due and not answered
 *   (`second_look.outcome: "not_answered"`). A finding whose set is incomplete is not carried: it is judged again
 *   (carry-forward.ts reason `previous-set-incomplete`), the direction that shows more.
 *
 * A violation_candidate with no refutation is NOT incomplete: a run shape with no second check (`refute_later`) writes none by
 * design, and the assembly shows such a finding as not yet refuted, which is never lighter than a refuted one.
 */

import { schemaDocument } from "./schema-validate.js";
import { LOCATION_GROUNDS, overturnGroundListed } from "./standing.js";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);

/** The kinds of record a finding's verdict is made of, as the log's verdict row holds them (its own record, then the nested ones). */
export const VERDICT_SET_KINDS = ["adjudicator", "refutation", "second_look"] as const;
export type VerdictSetKind = (typeof VERDICT_SET_KINDS)[number];

/** The field of the log's verdict row a nested kind is kept under. */
export const VERDICT_SET_FIELD: Readonly<Record<Exclude<VerdictSetKind, "adjudicator">, string>> = { refutation: "refutation", second_look: "second_look" };

/**
 * The records of the set a verdict row holds, kind by kind in `VERDICT_SET_KINDS`
 * order: the row itself (the adjudicator's record), then each nested kind it holds as a record (a `not_answered` second look
 * is not one). EVERY READER OF THE SET ITERATES THIS, never a kind by name: the quote re-check's jobs (verdict-verify.ts
 * `jobsFromEvidenceLog`), the carry's files a seat read (carry-forward.ts `filesReadBySeat`) and the files the carry's
 * premises digest (reading-assembly.ts, into rests-on.ts `buildRestsOn`). A kind added to `VERDICT_SET_KINDS` is then read
 * by all three, and the test `(K2 class)` fails where one of them has no job or no premise for it.
 */
export function verdictSetRecordsOf(row: Json): { kind: VerdictSetKind; record: Json }[] {
  const out: { kind: VerdictSetKind; record: Json }[] = [];
  for (const kind of VERDICT_SET_KINDS) {
    if (kind === "adjudicator") {
      out.push({ kind, record: row });
      continue;
    }
    const nested = row[VERDICT_SET_FIELD[kind]];
    if (isObject(nested) && !(kind === "second_look" && nested.outcome === "not_answered")) out.push({ kind, record: nested });
  }
  return out;
}

/**
 * The kind of the set a refuter seat's own file is (`refutation/<id>.json` or
 * `refutation/challenge-<id>.json`): a record in challenge mode is the second look (adjudicate-plan.ts reads files the same way).
 */
export function verdictSetKindOfRefuterRecord(record: Json): Exclude<VerdictSetKind, "adjudicator"> {
  return record.mode === "challenge" ? "second_look" : "refutation";
}

/** The files the nested records of the set quoted (`evidence[].file`), sorted. */
export function filesQuotedByNestedRecords(row: Json): string[] {
  const out = new Set<string>();
  for (const { kind, record } of verdictSetRecordsOf(row)) {
    if (kind === "adjudicator" || !Array.isArray(record.evidence)) continue;
    for (const e of record.evidence) if (isObject(e) && typeof e.file === "string" && e.file) out.add(e.file);
  }
  return [...out].sort();
}

export interface VerdictSet {
  /** The kinds the row holds as records (a `not_answered` second look is not a record). */
  held: VerdictSetKind[];
  /** The kinds the earlier run had or owed and the row cannot carry, each with why, in the person's words. */
  missing: { kind: VerdictSetKind; why: string }[];
}

/**
 * The set an earlier run holds for one finding. `row` is the record the carry would copy (a log's verdict row, or a directory's
 * adjudicator file); `apart` names the kinds the earlier run kept for this finding outside that record (adjudicate-plan.ts
 * `readPreviousRun` fills it from the run's own files).
 */
export function verdictSetOf(row: Json, apart: readonly string[] = []): VerdictSet {
  const held: VerdictSetKind[] = ["adjudicator"];
  const missing: VerdictSet["missing"] = [];
  for (const kind of VERDICT_SET_KINDS) {
    if (kind === "adjudicator") continue;
    const nested = row[VERDICT_SET_FIELD[kind]];
    const answered = isObject(nested) && !(kind === "second_look" && nested.outcome === "not_answered");
    if (answered) held.push(kind);
    else if (isObject(nested)) missing.push({ kind, why: "the finding was due a second look in the earlier run and none was answered" });
    else if (apart.includes(kind)) {
      missing.push({ kind, why: `the earlier run recorded its ${kind === "refutation" ? "second review" : "second look"} apart from the verdict, so it would not be carried with it` });
    }
  }
  /* A row whose word is the two passes' (`needs_human` beside an overturn the quote check let stand) was placed by a second look
   * (assemble-report.ts `placeOnRefutation`): without that look in the row, the overturn alone would place it as not applicable. */
  const ref = row.refutation;
  if (
    !held.includes("second_look") &&
    !missing.some((m) => m.kind === "second_look") &&
    row.verdict === "needs_human" &&
    row.quote_check_outcome !== "invalidated" &&
    isObject(ref) &&
    ref.outcome === "overturned" &&
    ref.quote_check_outcome !== "invalidated"
  ) {
    missing.push({ kind: "second_look", why: "its word says a second look left it to the person, and that second look is not in the record" });
  }
  /* A row whose refutation is an ordinary overturn on a location ground was due a
   * second look: the assembly keeps such a refutation only for a rule that opts in (a refused one is removed from the row), and
   * writes the look, or `not_answered`, beside it. Without one, the overturn alone would place the finding as not applicable. */
  if (
    !held.includes("second_look") &&
    !missing.some((m) => m.kind === "second_look") &&
    isObject(ref) &&
    ref.outcome === "overturned" &&
    ref.mode !== "challenge" &&
    typeof ref.grounds === "string" &&
    LOCATION_GROUNDS.has(ref.grounds)
  ) {
    missing.push({ kind: "second_look", why: "its second review overturned it on where the line sits, whether it runs or ships, and the second look that overturn was due is not in the record" });
  }
  /* An overturn whose ground is not exactly one listed ground places nothing (standing.ts `overturnGroundListed`): the row
   * cannot carry a second review that stands, so the finding is judged again. */
  if (isObject(ref) && !overturnGroundListed(ref)) {
    missing.push({ kind: "refutation", why: "its second review overturned it without one of the listed grounds, so that overturn cannot stand" });
  }
  /* WHAT THE CARRY READS IS HELD TO THE VERDICT SCHEMA'S FORM OF EACH NESTED RECORD: its fields are fields
   * verdict.schema.json names for that record, and its outcome is one of the schema's words for it. A second review that
   * carries a second look's `mode`, or any field the schema does not name there, places nothing the program wrote, so
   * the finding is judged again (the carry) or the carried row is refused (the assembly), never placed on it. A kind
   * already named missing is not named twice. */
  for (const kind of ["refutation", "second_look"] as const) {
    const nested = row[VERDICT_SET_FIELD[kind]];
    if (!isObject(nested) || missing.some((m) => m.kind === kind)) continue;
    const problem = schemaProblemOf(kind, nested);
    if (problem !== null) missing.push({ kind, why: `its ${kind === "refutation" ? "second review" : "second look"} is not recorded in the form the program writes it (${problem}), so it cannot stand` });
  }
  return { held, missing };
}

const forms = new Map<string, { fields: ReadonlySet<string>; outcomes: readonly unknown[] }>();
/** Why `record` is not in the form verdict.schema.json gives the row's field for `kind` (its field names, its outcome words), or null where it is. */
function schemaProblemOf(kind: "refutation" | "second_look", record: Json): string | null {
  let form = forms.get(kind);
  if (form === undefined) {
    const node = (schemaDocument("verdict.schema.json") as { properties?: Record<string, { properties?: Record<string, { enum?: unknown[] }> }> }).properties?.[VERDICT_SET_FIELD[kind]];
    form = { fields: new Set(Object.keys(node?.properties ?? {})), outcomes: node?.properties?.outcome?.enum ?? [] };
    forms.set(kind, form);
  }
  const foreign = Object.keys(record).filter((k) => !form.fields.has(k));
  if (foreign.length > 0) return `it has ${foreign.length === 1 ? "the field" : "the fields"} ${foreign.map((k) => JSON.stringify(k)).join(", ")}, which that form does not have`;
  if (!form.outcomes.includes(record.outcome)) return `its outcome ${JSON.stringify(record.outcome ?? null)} is not one of that form's (${form.outcomes.map((o) => JSON.stringify(o)).join(", ")})`;
  return null;
}
