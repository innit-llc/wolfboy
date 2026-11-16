/**
 * `verdict-capture` — the program, not the AI, takes one seat's answer and writes the record (relay item 2).
 *
 * WHY. Live run 1 failed because the orchestrating AI
 * carried every seat's answer to disk by retyping it: every one of the 42 answers is kept verbatim in the
 * seat's own transcript, and the orchestrator received each one with two spaces prefixed to every line, so
 * only a program that reads the answer as the platform stored it can write the original unchanged.
 *
 * WHAT IT DOES, in order, for one answer and the launch it answers:
 *   1. refuses to act where the record slot is already taken, unless `--replace` gives a reason;
 *   2. refuses to act where the JSON Schema validator cannot load (`ran: false`). Other callers of
 *      `compileSchemaValidator` degrade with a disclosure; this one does not, because a record written
 *      unchecked is the defect it exists to end;
 *   3. takes the FIRST JSON value of the answer as an exact byte slice (never re-serialised). Text before
 *      or after it is not merged and is not a reason to refuse (proposal section 3.5): the whole answer is
 *      kept beside the record under `capture/replies/`, and the ledger says where the value starts and ends;
 *   4. checks the value against the seat's reply schema, then against `recordShapeProblems` (the second,
 *      always-running check: a quotation whose `lines` name no line, a second label carried by value), then
 *      against the ids the launch handed over — every one answered exactly once, none that was not handed;
 *   5. on any problem prints the refusal to send back to the seat, in the seat's own field names, and
 *      writes nothing. Counting refusals per seat and storing a third answer whole is item 3's work;
 *   6. otherwise writes the record where the rest of the flow reads it (SKILL.md's path scheme) and appends
 *      a ledger line with the file's sha256, so that a file edited afterwards no longer matches
 *      (`--check-ledger`).
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { appendFileAt, makeFolder, renamePath, writeFileAt } from "./project-write.js";
import { dirname, join, resolve } from "node:path";
import { relativePath, slashPath } from "./project-path.js";
import { amendedReply, amendmentReason, fieldsNamed, nameIn, type RefusalNamed, type RefusalRemoved } from "./amend.js";
import { programFileBytes } from "./program-file.js";
import { answerRulesAtCapture, PLACES_KEPT_DIR, refutationsFromDecisions, verdictsFromDecisions, type DecisionsConversion } from "./reading-assembly.js";
import { carriedRepliesOfLaunchDir } from "./carried-places.js";
import { SKELETON_FIELDS_INSTEAD } from "./reading.js";
import type { Command } from "commander";
import type { VerdictSeat } from "wolfboy-schemas";
import { compileSchemaValidator, schemaDocument, type SchemaViolation } from "./schema-validate.js";
import { elementEntryProblems, lineReferenceProblem, recordShapeProblems } from "./verdict-verify.js";
import { readRegularFile } from "./project-read.js";
import { findingsChangedProblem } from "./log-digest.js";

export const CAPTURE_LEDGER_VERSION = 1;

export type CaptureRole = "adjudicator" | "refuter" | "silence-investigator" | "reader";
export const CAPTURE_ROLES: readonly CaptureRole[] = ["adjudicator", "refuter", "silence-investigator", "reader"];

interface RoleSpec {
  /** The reply schema in `wolfboy-schemas`, and the files its `$ref`s reach. */
  schema: string;
  register: string[];
  /** The field that says which handed item an entry answers. */
  idField: "finding_id" | "rule_id" | "unit";
  idNoun: string;
  /** The seat `recordShapeProblems` knows; a reader's rows are not records it checks. */
  seat: VerdictSeat | null;
}

const VERDICT_REFS = ["declarations.schema.json", "verdict.schema.json"];
// The seat's own shapes (no field the CLI writes, no `not_read` disposition): `seatDisposition` and `seatSearchRow` are
// defined once, in verdict.schema.json's `$defs`, and adjudicator-reply.schema.json keeps aliases of the
// same names; the decision a verdict seat, a reader and a refuter return is adjudicator-reply.schema.json's
// (`decision`, `refuterDecision`), so that file is registered for the reader and the refuter.
const SEAT_ROW_REFS = [...VERDICT_REFS, "adjudicator-reply.schema.json"];
export const CAPTURE_ROLE_SPEC: Record<CaptureRole, RoleSpec> = {
  adjudicator: { schema: "adjudicator-reply.schema.json", register: VERDICT_REFS, idField: "finding_id", idNoun: "candidate", seat: "adjudicator" },
  refuter: { schema: "refuter-reply.schema.json", register: SEAT_ROW_REFS, idField: "finding_id", idNoun: "candidate", seat: "refuter" },
  // evidence-log.schema.json is compiled whole by ajv when one of its fields is referred to, so the two
  // files it refers to must be registered too (measured: without them the compile fails).
  "silence-investigator": {
    schema: "silence-reply.schema.json",
    register: [...VERDICT_REFS, "evidence-log.schema.json", "findings.schema.json", "scan-profile.schema.json"],
    idField: "rule_id",
    idNoun: "rule",
    seat: "silence-investigator",
  },
  // A reader answers in decisions keyed by the skeleton's ids: an entry is named by its `unit`.
  reader: { schema: "reader-reply.schema.json", register: SEAT_ROW_REFS, idField: "unit", idNoun: "unit", seat: null },
};

/** Both relative to the `.legal` directory. */
export const LEDGER_FILE = "capture/ledger.jsonl";
export const REPLIES_DIR = "capture/replies";

const sha256 = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");
const UTF8 = new TextDecoder("utf-8", { fatal: true });

function describe(value: unknown): string {
  if (value === undefined) return "absent";
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") return "an object";
  if (typeof value === "string") return `the text ${JSON.stringify(value.length > 60 ? `${value.slice(0, 57)}...` : value)}`;
  return `the ${typeof value} ${String(value)}`;
}

/** Every character outside A-Za-z0-9._- replaced by `_`, as SKILL.md's path scheme spells it. */
export function sanitiseName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/gu, "_");
}

// ---------------------------------------------------------------------------------------------------
// 1. The first JSON value, as bytes.

export type Extraction =
  | { ok: true; start: number; end: number; value: unknown }
  | { ok: false; problem: string };

/**
 * The first JSON value in `bytes`: it starts at the first `[` or `{` and ends where the bracket depth,
 * counted outside strings, returns to zero.
 * `end` is exclusive. Scanning bytes is exact: no byte of a UTF-8
 * multi-byte sequence is below 0x80, so none of them is a bracket, a quote or a backslash.
 */
export function firstJsonValue(bytes: Uint8Array): Extraction {
  let start = -1;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x5b || bytes[i] === 0x7b) {
      start = i;
      break;
    }
  }
  if (start < 0) return { ok: false, problem: "your reply holds no JSON at all: no `[` or `{` appears anywhere in it" };
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let i = start; i < bytes.length; i++) {
    const b = bytes[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (b === 0x5c) escaped = true;
      else if (b === 0x22) inString = false;
      continue;
    }
    if (b === 0x22) inString = true;
    else if (b === 0x5b || b === 0x7b) depth++;
    else if (b === 0x5d || b === 0x7d) {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) {
    return { ok: false, problem: `the JSON that starts at byte ${start} of your reply never closes: its brackets do not balance before the reply ends` };
  }
  const text = UTF8.decode(bytes.subarray(start, end));
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { ok: false, problem: `the JSON that starts at byte ${start} of your reply is not valid JSON (${(e as Error).message})` };
  }
  const twice = duplicateKeys(text);
  if (twice.length > 0) {
    return {
      ok: false,
      problem: `your reply states ${twice.map((d) => `the key ${JSON.stringify(d.key)} twice in the object at ${d.at}`).join(", and ")}: JSON keeps only the last of the two, so which one you meant is not clear. Write each key once`,
    };
  }
  return { ok: true, start, end, value };
}

/**
 * Every key stated twice in one object of `text`, which is valid JSON (A-9). `JSON.parse` keeps the last of two equal
 * keys and says nothing, so a reply giving a field two values would be recorded with its second value only. Walks the
 * text once, outside strings, keeping the keys of each open object; `at` is the object's path (`$[0].evidence[1]`).
 */
export function duplicateKeys(text: string): { key: string; at: string }[] {
  const found: { key: string; at: string }[] = [];
  const stack: { obj: boolean; keys: Set<string>; path: string; n: number; expectKey: boolean; lastKey: string }[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const top = stack[stack.length - 1];
    if (ch === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      if (top?.obj && top.expectKey) {
        const key = JSON.parse(text.slice(i, j + 1)) as string;
        if (top.keys.has(key)) found.push({ key, at: top.path });
        top.keys.add(key);
        top.lastKey = key;
        top.expectKey = false;
      }
      i = j;
    } else if (ch === "{" || ch === "[") {
      const path = !top ? "$" : top.obj ? `${top.path}.${top.lastKey}` : `${top.path}[${top.n}]`;
      stack.push({ obj: ch === "{", keys: new Set(), path, n: 0, expectKey: ch === "{", lastKey: "" });
    } else if (ch === "}" || ch === "]") {
      stack.pop();
    } else if (ch === "," && top) {
      if (top.obj) top.expectKey = true;
      else top.n++;
    }
  }
  return found;
}

// ---------------------------------------------------------------------------------------------------
// 2. Where the record goes, and which ids the launch handed over.

/** The record's path relative to the `.legal` directory, on SKILL.md's scheme (step 4, step 5, step 3c, readers). */
export function recordPathFor(
  role: CaptureRole,
  opts: { key?: string; ordinal?: number; ids: string[]; challenge?: boolean },
): { rel: string; problem?: undefined } | { rel?: undefined; problem: string } {
  const key = opts.key ?? "";
  switch (role) {
    case "adjudicator":
      if (!key) return { problem: "--key is required for an adjudicator reply: it is the payload's `adjudication_group.key`, and the file is named after it" };
      if (!opts.ordinal) return { problem: "an adjudicator record's file name starts with the key's number: pass --ordinal <n>, or --findings to derive it" };
      return { rel: `verdicts/${String(opts.ordinal).padStart(3, "0")}-${sanitiseName(key)}.json` };
    case "reader":
      if (!key) return { problem: "--key is required for a reader reply: it is the reader payload's key, and the file is named after it" };
      return { rel: `readers/${sanitiseName(key)}.json` };
    case "silence-investigator":
      if (!key) return { problem: "--key is required for a silence investigator reply: it is the batch name, and the file is named after it" };
      return { rel: `verdicts/silence/${sanitiseName(key)}.json` };
    case "refuter":
      // SKILL.md step 5 names a refutation after its one finding_id. A launch handed several is written
      // ONCE, under the launch's own name: splitting one answer into per-id files is itself a rewrite.
      /* A second look (challenge mode) has a name of its own, in every
       * shape: where the run has the second check, one finding can have both an ordinary refutation and a second look, and
       * neither may take the other's file. The readers take the seat from the directory and the pass from `mode`. */
      if (opts.ids.length === 1) return { rel: `verdicts/refutation/${opts.challenge ? "challenge-" : ""}${sanitiseName(opts.ids[0])}.json` };
      if (!key) return { problem: "this refuter launch was handed several candidates, so its answer is written once under the launch's name: pass --key <launch name>" };
      return { rel: `verdicts/refutation/${sanitiseName(key)}.json` };
  }
}

/**
 * The ids a payload hands its seat, read from the scan's own findings.json: an adjudicator's candidates'
 * `finding_id`s, a reader's kinds (the census unit ids its rows name in `kind`, which is what the CLI's
 * assembly matches a row on). The ordinal is the key's 1-based position among every payload key sorted as
 * strings, which reproduces live run 1's file numbers 001-020 exactly.
 */
export function handedFromFindings(
  findingsPath: string,
  key: string,
  role: CaptureRole,
): { ids: string[]; ordinal: number; candidate: string; problem?: undefined } | { problem: string; unreadable: boolean } {
  if (role === "refuter" || role === "silence-investigator") {
    return { problem: `a ${role}'s ids are chosen by the orchestrator at launch and are not in findings.json: pass --ids or --ids-file`, unreadable: false };
  }
  let findings: { context_payloads?: { payloads?: { key?: unknown; path?: unknown }[] } };
  try {
    const bytes = programFileBytes("the findings document", findingsPath);
    // A document changed after the scan is refused (log-digest.ts).
    const changed = findingsChangedProblem(findingsPath, bytes);
    if (changed !== null) return { problem: changed, unreadable: true };
    findings = JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    return { problem: `--findings ${findingsPath} could not be read as JSON (${(e as Error).message})`, unreadable: true };
  }
  const payloads = findings.context_payloads?.payloads ?? [];
  const keys = [...new Set(payloads.map((p) => p.key).filter((k): k is string => typeof k === "string"))].sort();
  const entry = payloads.find((p) => p.key === key);
  if (!entry || typeof entry.path !== "string") {
    return { problem: `--findings ${findingsPath} has no context payload with the key ${JSON.stringify(key)} (it has ${keys.length})`, unreadable: false };
  }
  const payloadPath = join(dirname(findingsPath), entry.path);
  let payload: { candidates?: { finding_id?: unknown; kinds?: { kind?: unknown }[] }[] };
  try {
    payload = JSON.parse(programFileBytes("the payload", payloadPath).toString("utf8"));
  } catch (e) {
    return { problem: `the payload ${payloadPath} could not be read as JSON (${(e as Error).message})`, unreadable: true };
  }
  const candidates = payload.candidates ?? [];
  const ordinal = keys.indexOf(key) + 1;
  if (role === "adjudicator") {
    const ids = candidates.map((c) => c.finding_id);
    if (ids.length === 0 || !ids.every((id): id is string => typeof id === "string" && id !== "")) {
      return { problem: `the payload ${payloadPath} does not name a finding_id on every candidate`, unreadable: false };
    }
    return { ids: ids as string[], ordinal, candidate: "" };
  }
  if (candidates.length !== 1) return { problem: `the reader payload ${payloadPath} holds ${candidates.length} candidates; a reader reads one`, unreadable: false };
  const kinds = (candidates[0].kinds ?? []).map((k) => k.kind);
  if (kinds.length === 0 || !kinds.every((k): k is string => typeof k === "string" && k !== "")) {
    return { problem: `the reader payload ${payloadPath} does not name a kind on every entry of its candidate's \`kinds\``, unreadable: false };
  }
  return { ids: kinds as string[], ordinal, candidate: typeof candidates[0].finding_id === "string" ? candidates[0].finding_id : "" };
}

// ---------------------------------------------------------------------------------------------------
// 3. What is wrong with an answer, in the seat's own terms.

interface Problem {
  /** The array index the problem is about, or null for the reply as a whole. */
  item: number | null;
  /** The field path inside the item the problem names ("" for the item itself), for de-duplication and for the note on
   * an `evidence[]` entry (`zeroHitNotes`). */
  field: string;
  text: string;
}

const segmentsOf = (pointer: string): string[] =>
  pointer === "" ? [] : pointer.slice(1).split("/").map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));

function walk(root: unknown, segments: string[]): { value: unknown; path: string } {
  let value = root;
  let path = "";
  for (const s of segments) {
    if (Array.isArray(value)) {
      path += `[${s}]`;
      value = value[Number(s)];
    } else {
      path += path ? `.${s}` : s;
      value = value && typeof value === "object" ? (value as Record<string, unknown>)[s] : undefined;
    }
  }
  return { value, path };
}

/**
 * A refuter answers in one mode: the
 * ordinary pass (no `mode`) or the second look (`mode: "challenge"`, refuter-reply.schema.json `$defs.challengeItem`). Where
 * the launch's entry is known (`challenge`), every object is held to its mode, so a challenge seat's answer is never taken
 * as a refutation that would dismiss the finding, and an ordinary refuter's never as a second look; where it is not, an
 * answer mixing the two is refused.
 */
export function refuterModeProblems(spec: RoleSpec, reply: unknown, challenge: boolean | undefined): Problem[] {
  if (!Array.isArray(reply)) return [];
  const marked = (v: unknown): boolean => v !== null && typeof v === "object" && !Array.isArray(v) && "mode" in (v as Record<string, unknown>);
  if (challenge === undefined) {
    const n = reply.filter(marked).length;
    return n > 0 && n < reply.length ? [{ item: null, field: "mode", text: "your reply mixes the two modes: some objects carry `mode` and some do not. One answer is in one mode, the one your brief names" }] : [];
  }
  const out: Problem[] = [];
  reply.forEach((v, i) => {
    if (challenge && !marked(v)) out.push({ item: i, field: "mode", text: `${itemLabel(spec, reply, i)}: \`mode\` is missing; your brief puts you in challenge mode, so \`mode\` is \`challenge\` and the grounds are the three of that mode` });
    if (!challenge && marked(v)) out.push({ item: i, field: "mode", text: `${itemLabel(spec, reply, i)}: \`mode\` is written only by a second look in challenge mode, and your brief does not put you in that mode: leave it out` });
  });
  return out;
}

function itemLabel(spec: RoleSpec, reply: unknown, index: number): string {
  const item = Array.isArray(reply) ? reply[index] : undefined;
  const id = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>)[spec.idField] : undefined;
  if (spec.idField === "unit") return typeof id === "string" && id ? `decision ${index + 1} (unit ${JSON.stringify(id)})` : `decision ${index + 1}`;
  return typeof id === "string" && id ? `the object for ${spec.idNoun} ${id}` : `object ${index + 1} of your array`;
}

/** What an `evidence[]` entry is, told to a seat whose entry says nothing in `file`, `lines` or `quote` (`zeroHitNotes`),
 * in that seat's own fields. A search that found nothing is answered by its search row, which the program re-runs, and
 * by `reasoning`; it takes no `evidence[]` entry, because it has no quotation to carry, and a refusal that only asks for
 * the quotation leaves the seat to drop the answer or invent one (the definitions say so from item 6).
 * The reader's reply has no `evidence[]`. */
const quotationsOnly = (searchRow: string): string =>
  `: \`evidence[]\` holds only quotations, each a line you read, with its \`file\`, \`lines\` and \`quote\`. A search that found nothing takes no \`evidence[]\` entry: ${searchRow}, and your \`reasoning\` names it. Where a search found the line, quote that line; never write a quotation you did not read`;
const QUOTATIONS_ONLY: Partial<Record<CaptureRole, string>> = {
  // The adjudicator and the refuter write their searches in `searched`, beside their decisions.
  adjudicator: quotationsOnly("it is a `searched[]` row with `hits: 0`"),
  refuter: quotationsOnly("it is a `searched[]` row with `hits: 0`"),
  "silence-investigator": quotationsOnly("it is an entry of `searched` saying what you looked for, where, and that it had 0 hits"),
};

/** Why a field is required only on some outcomes or entries, or what it takes: the conditional rules the reply schemas
 * carry. An `evidence[]` entry's `file`, `lines` and `quote` take their note from `zeroHitNotes`, whichever check
 * refused them. */
function conditionNote(role: CaptureRole, field: string, keyword: string): string {
  if (role === "refuter" && field === "grounds") return " on an `overturned` outcome";
  if (role === "refuter" && field === "evidence" && keyword === "minItems") return " on an `overturned` outcome: an overturn with no quote is an opinion";
  if (role === "silence-investigator" && field === "evidence") return " on a `construct_found` outcome: quote what the detector missed";
  if (/^evidence\[\d+\]\.name$/.test(field)) return " on an entry whose `role` is \"item\": `name` says which item it is";
  if (/^reading\.searched\[\d+\]\.tool$/.test(field)) return ': "grep" where you searched file content, "glob" where the pattern names file paths';
  return "";
}

/** A value of an `evidence[]` entry's `file`, `lines` or `quote` that says nothing: absent, null, `false`, empty or
 * blank text, an empty object, a list whose members all say nothing (the empty list included), or a `lines` text or
 * number that names no line as `lineReferenceProblem` reads it (a zero, a sign, a count).
 * A value that says something in the wrong form (a line number written as a number, a
 * list holding a quotation) does not. */
function saysNothing(field: string, value: unknown): boolean {
  if (value === undefined || value === null || value === false) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  if (Array.isArray(value)) return value.every((member) => saysNothing(field, member));
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  if (field !== "lines" || (typeof value !== "string" && typeof value !== "number")) return false;
  return lineReferenceProblem(value) !== null;
}

/** The note on where a search that found nothing goes (`QUOTATIONS_ONLY`): once per `evidence[]` entry, on the first
 * refusal of its `file`, `lines` or `quote` whose value says nothing (`saysNothing`), whichever check refused it (the
 * schema's `required`, `minLength` or `type`, or the second check). It is the one place the note is given, for every
 * form in which a seat writes a search that found nothing as an entry: a field left out, an
 * empty or blank `quote`, a `lines` naming no line, a placeholder quotation beside one of these.
 * A refusal of a value that says something, a real quotation merely wrong, keeps its own
 * text alone. Within one entry, `found` is in the order the refusal prints it. */
function zeroHitNotes(role: CaptureRole, reply: unknown, found: Problem[]): void {
  const note = QUOTATIONS_ONLY[role];
  if (!note || !Array.isArray(reply)) return;
  const noted = new Set<string>();
  for (const f of found) {
    // The entry itself, refused as not an object (a search written as the text "grep ... -- 0 hits", or null, or a list, in the place of a quotation),
    // takes the note as a refusal of its fields does.
    const whole = /^evidence\[(\d+)\]$/.exec(f.field);
    if (whole && f.item !== null && !noted.has(`${f.item} ${whole[1]}`)) {
      const entry = walk(reply[f.item], ["evidence", whole[1]]).value;
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        noted.add(`${f.item} ${whole[1]}`);
        f.text += note;
      }
      continue;
    }
    const quotation = /^evidence\[(\d+)\]\.(file|lines|quote)$/.exec(f.field);
    if (!quotation || f.item === null || noted.has(`${f.item} ${quotation[1]}`)) continue;
    const entry = walk(reply[f.item], ["evidence", quotation[1]]).value;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    if (!saysNothing(quotation[2], (entry as Record<string, unknown>)[quotation[2]])) continue;
    noted.add(`${f.item} ${quotation[1]}`);
    f.text += note;
  }
}

type SchemaNode = { [k: string]: unknown };

/** Parses a schema this program carries (schema-validate.ts `schemaDocument`) once per capture. */
function schemaReader(): (file: string) => SchemaNode {
  const read = new Map<string, SchemaNode>();
  return (file) => {
    let schema = read.get(file);
    if (!schema) read.set(file, (schema = schemaDocument(file) as SchemaNode));
    return schema;
  };
}

/** The fields an object of a reply may carry, at any depth, for the refusal's "… carries only …": a top-level entry, a
 * reader row, an `evidence[]` entry, a `reading` row. The reply schema is walked along the object's path (`items` for a
 * list, `properties` for a field), every `$ref` on the way is followed, across files (the seat's rows live in
 * adjudicator-reply.schema.json's `$defs`, an `evidence[]` entry in verdict.schema.json's), and the list is the
 * `properties` of the node whose `additionalProperties: false` refused the field. ajv's own `schemaPath` cannot say which
 * node that is: below a `$ref` it restarts at `#/additionalProperties` (measured 2026-09-24). Reading only the reply
 * schema's own `items.properties` printed an empty list for every reader row (departure 14), and a list was printed
 * for no object below the top level until 2026-09-24. */
function entryFields(read: (file: string) => SchemaNode, schemaFile: string, reply: unknown, segments: string[]): string[] {
  type At = { file: string; node: SchemaNode };
  /* Whether an `if` holds of the value, for the branch that says which fields the object may carry (an
   * `evidence[]` entry is verdict.schema.json's `codeEvidence`, or `evidenceById` where it names an id). Only
   * `required`, `anyOf`, `not` and a `const` under `properties` are read; anything else is null, and both branches are
   * followed. */
  const holds = (cond: unknown, v: unknown): boolean | null => {
    if (!cond || typeof cond !== "object") return null;
    const c = cond as SchemaNode;
    const obj = v && typeof v === "object" && !Array.isArray(v) ? (v as SchemaNode) : null;
    const parts: (boolean | null)[] = [];
    if (Array.isArray(c.required)) parts.push(obj !== null && c.required.every((k) => typeof k === "string" && k in obj));
    if (Array.isArray(c.anyOf)) {
      const each = c.anyOf.map((x) => holds(x, v));
      parts.push(each.includes(true) ? true : each.includes(null) ? null : false);
    }
    if (c.not !== undefined) {
      const n = holds(c.not, v);
      parts.push(n === null ? null : !n);
    }
    if (c.properties && typeof c.properties === "object") {
      for (const [k, sub] of Object.entries(c.properties as SchemaNode)) {
        const want = sub && typeof sub === "object" ? (sub as SchemaNode).const : undefined;
        if (want === undefined) parts.push(null);
        else parts.push(obj === null || !(k in obj) || obj[k] === want);
      }
    }
    if (parts.length === 0 || parts.includes(null)) return parts.includes(false) ? false : null;
    return !parts.includes(false);
  };
  // A node and every node its `$ref` chain reaches (in draft 2020-12 a `$ref` applies beside its siblings), and the
  // branch of an `if` that holds of the value.
  const expand = (at: At, v: unknown, depth = 0): At[] => {
    if (depth > 16) return [at];
    const out: At[] = [at];
    const ref = at.node.$ref;
    if (typeof ref === "string") {
      const [uri, pointer = ""] = ref.split("#");
      const file = uri ? uri.slice(uri.lastIndexOf("/") + 1) : at.file;
      let node: unknown = read(file);
      for (const s of segmentsOf(pointer)) node = node && typeof node === "object" ? (node as SchemaNode)[s] : undefined;
      if (node && typeof node === "object") out.push(...expand({ file, node: node as SchemaNode }, v, depth + 1));
    }
    if (at.node.if !== undefined) {
      const h = holds(at.node.if, v);
      for (const [branch, when] of [["then", true], ["else", false]] as const) {
        const b = at.node[branch];
        if (b && typeof b === "object" && (h === null || h === when)) out.push(...expand({ file: at.file, node: b as SchemaNode }, v, depth + 1));
      }
    }
    return out;
  };
  let value = reply;
  let here = expand({ file: schemaFile, node: read(schemaFile) }, value);
  for (const s of segments) {
    const list = Array.isArray(value);
    const next = list ? (value as unknown[])[Number(s)] : value && typeof value === "object" ? (value as SchemaNode)[s] : undefined;
    here = here.flatMap((at) => {
      const child = list ? at.node.items : (at.node.properties as SchemaNode | undefined)?.[s];
      return child && typeof child === "object" ? expand({ file: at.file, node: child as SchemaNode }, next) : [];
    });
    value = next;
  }
  const closed = here.find((at) => at.node.additionalProperties === false);
  return Object.keys((closed?.node.properties as SchemaNode | undefined) ?? {});
}

/* The element count (at most five entries for one element name) moved into verdict-verify.ts's `recordShapeProblems`
 * (part B, area γ, item 2): capture, verify and the assembly apply it as one check; it is re-exported from here. */
export { ELEMENT_ENTRIES_MAX, elementEntryProblems } from "./verdict-verify.js";

function schemaProblem(role: CaptureRole, spec: RoleSpec, read: (file: string) => SchemaNode, reply: unknown, e: SchemaViolation): Problem | null {
  if (e.keyword === "if") return null; // the branch's own errors say what is wrong
  const segments = segmentsOf(e.instancePath);
  if (segments.length === 0) {
    if (e.keyword === "type") return { item: null, field: "", text: `your reply is ${describe(reply)}; it must be a JSON array holding one entry per ${spec.idNoun} you were handed` };
    if (e.keyword === "minItems") return { item: null, field: "", text: `your reply is an empty array; it must hold one entry per ${spec.idNoun} you were handed` };
    return { item: null, field: "", text: `your reply ${e.message}` };
  }
  const index = Number(segments[0]);
  const item = Array.isArray(reply) ? reply[index] : undefined;
  const { value, path } = walk(item, segments.slice(1));
  const label = itemLabel(spec, reply, index);
  const where = path ? `${label}: \`${path}\`` : label;
  const p = e.params as Record<string, unknown>;
  switch (e.keyword) {
    case "required": {
      const field = path ? `${path}.${String(p.missingProperty)}` : String(p.missingProperty);
      return { item: index, field, text: `${label}: \`${field}\` is missing, and your reply format requires it${conditionNote(role, field, e.keyword)}` };
    }
    case "additionalProperties": {
      const field = path ? `${path}.${String(p.additionalProperty)}` : String(p.additionalProperty);
      const fields = entryFields(read, spec.schema, reply, segments);
      const listed = path.replace(/\[\d+\]/g, "[]");
      const holder = path === "" ? "an entry" : /\[\d+\]$/.test(path) ? `an entry of \`${listed}\`` : `\`${listed}\``;
      const allowed = fields.length > 0 ? ` (${holder} carries only ${fields.map((f) => `\`${f}\``).join(", ")})` : "";
      // A key typed with white space before or
      // after it reads as the field itself between backticks (bin:36's seat was refused twice for " fix_available"), so
      // the refusal names the space and, where the key is a field once the space is gone, the field.
      const key = String(p.additionalProperty);
      const lead = /^\s/.test(key);
      const trail = /\s$/.test(key);
      const spaced =
        lead || trail
          ? `. The key as written is ${JSON.stringify(key)}, with white space ${lead && trail ? "before and after it" : lead ? "before it" : "after it"}${fields.includes(key.trim()) ? `: write it as \`${key.trim()}\`` : ""}`
          : "";
      return { item: index, field, text: `${label}: \`${field}\` is not a field of your reply format${allowed}${spaced}` };
    }
    case "enum":
      return { item: index, field: path, text: `${where} is ${JSON.stringify(value)}, which is not one of ${(p.allowedValues as unknown[]).map((v) => JSON.stringify(v)).join(", ")}` };
    case "const":
      return { item: index, field: path, text: `${where} is ${JSON.stringify(value)}; it must be ${JSON.stringify(p.allowedValue)}` };
    case "type":
      return { item: index, field: path, text: `${where} is ${describe(value)}; it must be of type ${String(p.type)}` };
    case "minItems":
      return { item: index, field: path, text: `${where} holds ${Array.isArray(value) ? value.length : 0} entries; it must hold at least ${String(p.limit)}${conditionNote(role, path, e.keyword)}` };
    case "contains":
      if (path === "evidence" && p.maxContains !== undefined) {
        const premises = Array.isArray(value) ? value.filter((v) => v && typeof v === "object" && (v as Record<string, unknown>).role === "premise").length : 0;
        return { item: index, field: path, text: `${where} holds ${premises} entries whose \`role\` is "premise"; it holds at most ${String(p.maxContains)} (two or three, never a fourth)` };
      }
      return { item: index, field: path, text: `${where} ${e.message}` };
    case "minLength":
      return { item: index, field: path, text: `${where} is empty; it must not be` };
    case "minimum":
      return { item: index, field: path, text: `${where} is ${String(value)}; it must be at least ${String(p.limit)}` };
    case "pattern":
      return { item: index, field: path, text: `${where} is ${JSON.stringify(value)}, which does not have the form ${String(p.pattern)}` };
    case "not":
      if (role === "refuter" && path === "") {
        const outcome = item && typeof item === "object" ? (item as Record<string, unknown>).outcome : undefined;
        return { item: index, field: "grounds", text: `${label}: \`grounds\` is written only on an \`overturned\` outcome, and this one's outcome is ${JSON.stringify(outcome)}` };
      }
      return { item: index, field: path, text: `${where} ${e.message}` };
    default:
      return { item: index, field: path, text: `${where} ${e.message}` };
  }
}

/** A field path as a problem's text starts with it: `evidence[3].lines`, `reading.read[0].quote`. */
const FIELD_PATH = String.raw`[a-z_]+(?:\[\d+\])?(?:\.[a-z_]+(?:\[\d+\])?)*`;

/** The backticked names and the leading field path a shape problem mentions, for de-duplication. */
function namedFields(problem: string): string[] {
  const out = [...problem.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const lead = new RegExp(`^(${FIELD_PATH})`).exec(problem);
  if (lead) out.push(lead[1]);
  return out;
}

/** The field a second-check problem refuses, where its text starts with that field's path and " is ", as every
 * quotation-row problem of `recordShapeProblems` does ("evidence[3].lines is …"); "" where it starts otherwise. */
function refusedField(problem: string): string {
  return new RegExp(`^(${FIELD_PATH}) is `).exec(problem)?.[1] ?? "";
}

/** Every handed id answered exactly once, and no id that was not handed. */
export function idProblems(role: CaptureRole, reply: unknown, handed: string[]): string[] {
  const spec = CAPTURE_ROLE_SPEC[role];
  if (!Array.isArray(reply)) return [];
  const handedSet = new Set(handed);
  const named = handed.length <= 12 ? `: ${handed.join(", ")}` : ` (${handed.length} of them)`;
  const out: string[] = [];
  const count = new Map<string, number>();
  reply.forEach((entry, i) => {
    const id = entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>)[spec.idField] : undefined;
    if (typeof id !== "string") return; // the schema check has already said the field is missing or mistyped
    count.set(id, (count.get(id) ?? 0) + 1);
    if (!handedSet.has(id)) {
      out.push(
        role === "reader"
          ? `row ${i + 1} names the kind ${JSON.stringify(id)}, which is not one of the kinds you were handed${named}. Write each kind exactly as the census handed it to you`
          : `your reply answers ${JSON.stringify(id)}, which is not a ${spec.idNoun} you were handed${named}. Remove that object`,
      );
    }
  });
  for (const id of handed) {
    const n = count.get(id) ?? 0;
    if (n === 0) {
      out.push(
        role === "reader"
          ? `no row of your reply disposes of the kind ${JSON.stringify(id)}, which you were handed. Dispose of every kind you hold`
          : `your reply has no object for the ${spec.idNoun} ${id}, which you were handed. Answer every ${spec.idNoun} you were handed, one object each`,
      );
    } else if (n > 1 && role !== "reader") {
      // None of the objects is kept (`refusalRemoved`), so the refusal says so and asks for the candidate whole.
      out.push(`your reply answers the ${spec.idNoun} ${id} ${n} times, so none of those ${n} objects is kept. Give exactly one object for that ${spec.idNoun}, whole, with every field it needs`);
    }
  }
  if (role === "reader") {
    // A kind may take one row per sub-shape or per location; the same row twice is a duplicate.
    const seen = new Map<string, number>();
    reply.forEach((row, i) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return;
      const r = row as Record<string, unknown>;
      const sig = JSON.stringify([r.kind, r.sub_shape ?? null, r.file ?? null, r.lines ?? null]);
      const first = seen.get(sig);
      if (first !== undefined) out.push(`rows ${first + 1} and ${i + 1} dispose of the same kind, sub-shape, file and lines. Give each disposition once`);
      else seen.set(sig, i);
    });
  }
  return out;
}

/** The text sent back to the seat. Its own field names, what is wrong, and what to send instead. */
export function renderRefusal(role: CaptureRole, problems: string[]): string {
  const spec = CAPTURE_ROLE_SPEC[role];
  const unit = role === "reader" ? "one row per disposition" : `one object per ${spec.idNoun} you were handed`;
  return [
    "Your reply was not accepted, and nothing was written from it.",
    `Send your whole answer again: one JSON array, ${unit}, with nothing before it and nothing after it, and with every point below corrected.`,
    `What is wrong (${problems.length}):`,
    ...problems.map((p) => `- ${p}`),
    "",
  ].join("\n");
}

/**
 * THE CONVERSION ONE SEAT'S ANSWER TAKES: an adjudicator's decisions per candidate; a reader's decisions,
 * attached to the candidate its payload names and to the reader its key names (`<key>#reader-<n>`), never to the lines
 * it quotes. The hook and the command build it the same way.
 */
export function decisionsConverter(
  role: CaptureRole,
  rules: ReturnType<typeof answerRulesAtCapture>,
  key: string,
  candidate: string,
): ((reply: unknown) => DecisionsConversion) | undefined {
  if (role === "adjudicator") return rules.convertVerdicts;
  if (role === "refuter") return rules.convertRefutations;
  if (role !== "reader") return undefined;
  const reader = Number(/#reader-(\d+)$/.exec(key)?.[1] ?? 0);
  return (reply) =>
    reader >= 1 && candidate
      ? rules.convertReader(reply, { finding_id: candidate, reader })
      : { record: null, problems: [], unconvertible: `the reader payload key ${JSON.stringify(key)} names no reader (\`#reader-<n>\`) or no candidate, so the reply cannot be attached to one` };
}

// ---------------------------------------------------------------------------------------------------
// 4. One capture.

export interface LedgerEntry {
  /**
   * Where the seat's answer was an amendment of its last refused answer (amend.ts): the seat's own bytes' sha256 and
   * length, the refused answer it amended, and why it was read as one. `reply` is then the merged whole.
   */
  amends?: { answer_sha256: string; answer_bytes: number; base_file: string; base_sha256: string; why: string };
  v: number;
  at: string;
  seat: string;
  role: CaptureRole;
  key: string | null;
  ids: string[];
  ids_from: string;
  /** The record, relative to the `.legal` directory. */
  file: string;
  sha256: string;
  bytes: number;
  reply: {
    file: string;
    sha256: string;
    bytes: number;
    /** Byte offsets of the record inside the reply; `end` exclusive. */
    json_start: number;
    json_end: number;
    prose_before_bytes: number;
    prose_after_bytes: number;
  };
  schema: string;
  replaces?: { sha256: string; reason: string };
  /** Present when the plugin's hook captured the answer (relay item 3); absent when this command was run. */
  via?: CaptureVia;
  /**
   * 2 where the answer carried the seat's `decisions` and the record is the program's:
   * the seat's fields with the `reading` block the program made from its decisions and the skeleton. The record is then
   * not the answer's byte slice; `answer_sha256` is that slice's digest (the whole answer is kept at `reply.file` as
   * always). Absent where the record is the slice itself.
   */
  form?: 2;
  answer_sha256?: string;
  /**
   * What the capture took out of the record as inert instead of refusing the answer for it (reading.ts
   * `inertDismissals`): each `evidence[]` entry's dropped fields with the seat's values, and why. The record is then the
   * program's (`form` 2); the seat's whole answer is kept at `reply.file` as always. Absent where nothing was dropped.
   */
  normalised?: { item: number; finding_id: string; evidence: number; fields: Record<string, unknown>; why: string }[];
}

/**
 * How a hook capture was made: which hook read the answer, and the seat's binding. The record itself is the
 * same bytes the command writes for the same answer; only this field tells the two apart.
 */
export interface CaptureVia {
  how: "hook";
  /** `PreToolUse:SubagentHandback` (auto mode, the hand-back's `message`) or `SubagentStop` (`last_assistant_message`). */
  event: string;
  /** The launch-list entry the launch hook bound to this agent id (its `launched` event with `seat` = the agent id). */
  entry: string;
  session_id: string | null;
  tool_use_id: string | null;
  permission_mode: string | null;
  /** How many answers of this seat the hook refused before this one. */
  refusals_before: number;
  /**
   * What assembly needs to check this record against the seat's own transcript (proposal §3.5, P:277; the check is
   * built at integration): the session's transcript as the event names it (`transcript_path`, on every event); the
   * seat's own (`agent_transcript_path`, which SubagentStop carries and PreToolUse:SubagentHandback does not; in auto
   * mode the hook ledger's `stopped` line holds it); and the tool_use_id of the Agent call that launched the seat,
   * from the launch reservation that confirms the binding, whose result in the session's transcript names the agentId -
   * or, where the run's relay made that call, in the relay's own transcript beside the session's (the
   * assembly then proves the relay launched from the session's transcript by a listed relay entry of the run).
   */
  transcript_path: string | null;
  agent_transcript_path: string | null;
  launch_tool_use_id: string | null;
}

export interface CaptureRequest {
  role: CaptureRole;
  seat: string;
  key?: string;
  ordinal?: number;
  ids: string[];
  idsFrom: string;
  answer: Uint8Array;
  legalDir: string;
  replace?: string;
  /**
   * Where a record is already at the path and no `replace` is given, the reason to replace it when
   * the run set that record aside (hook-launch.ts A RECORD SET ASIDE), else null: given by the hook capture only, and it
   * answers null for any record that still holds the answer the program received.
   */
  replaceSetAside?: (rel: string, previousSha256: string) => string | null;
  at?: string;
  via?: CaptureVia;
  /**
   * The rules step 5a applies to one seat's answer, applied here where the seat can still answer again (reading-assembly.ts `answerRulesAtCapture`):
   * `entryRule` to each verdict of an adjudicator
   * answer, `replyRule` to a reader's whole reply. Their problems join the answer's others, a verdict's under its label.
   */
  entryRule?: (verdict: Record<string, unknown>) => string[];
  replyRule?: (reply: unknown) => string[];
  /**
   * A refuter's launch: `true` where its entry is a second look in challenge mode,
   * `false` where it is the ordinary pass, absent where the caller does not know the entry (the command line). Every object
   * of the answer is held to that mode; with none given, an answer that mixes the two modes is refused.
   */
  challenge?: boolean;
  /**
   * The seat's decisions turned into the record (reading-assembly.ts `answerRulesAtCapture`
   * `convertVerdicts` / `convertReader`). Without it an adjudicator's answer is held to the same form with no findings
   * document (`verdictsFromDecisions(reply, null)`: `reading` refused, `decisions` not writable), and a reader's reply,
   * which is only decisions, cannot be written.
   */
  convert?: (reply: unknown) => DecisionsConversion;
  /**
   * The seat's last refused answer, as the capture kept it, and what its refusal named (amend.ts).
   * An answer that is an amendment of it is laid over it, and the merged whole is what is checked and,
   * accepted, kept as the reply; a change the refusal did not name is refused. `removed`: what that
   * refusal told the seat to take out, which is not part of the base (amend.ts `withoutRemoved`).
   */
  amend?: { base: Uint8Array; named: RefusalNamed; baseFile: string; removed?: RefusalRemoved };
}

export type CaptureResult =
  | { outcome: "written"; entry: LedgerEntry }
  /** `named`: what the refusal named, for an amendment of this answer; `checked`: the merged whole, where the answer was an amendment. */
  | {
      outcome: "refused";
      problems: string[];
      refusal: string;
      named: RefusalNamed;
      /** Fix R1: the rows and objects this refusal tells the seat to take out (amend.ts `RefusalRemoved`). */
      removed?: RefusalRemoved;
      checked?: Buffer;
      /** Unit U1: the place rows that passed every place check, kept as read if the seat ends without a record (`keepReadPlaces`). */
      placesPassed?: NonNullable<DecisionsConversion["placesPassed"]>;
    }
  | { outcome: "validator-unavailable"; reason: string }
  | { outcome: "not-written"; reason: string };

/** What a refusal named (amend.ts): each problem's candidate and field; a candidate not answered, or answered twice, whole. */
function refusalNamed(role: CaptureRole, reply: unknown, found: readonly Problem[], handed: readonly string[]): RefusalNamed {
  const named: RefusalNamed = {};
  if (role === "reader" || !Array.isArray(reply)) return { [role === "reader" ? "" : "*"]: ["*"] };
  const idAt = (i: number): string | null => {
    const e = reply[i] as Record<string, unknown> | null;
    return e && typeof e === "object" && typeof e.finding_id === "string" ? e.finding_id : null;
  };
  for (const f of found) nameIn(named, f.item === null ? null : idAt(f.item), fieldsNamed(f.field));
  const count = new Map<string, number>();
  reply.forEach((_, i) => {
    const id = idAt(i);
    if (id !== null) count.set(id, (count.get(id) ?? 0) + 1);
  });
  for (const id of handed) if ((count.get(id) ?? 0) !== 1) nameIn(named, id, ["*"]);
  for (const [id] of count) if (!handed.includes(id)) nameIn(named, id, ["*"]);
  return named;
}

/**
 * What a refusal told the seat to take out (amend.ts `RefusalRemoved`): the rows the conversion
 * refused for what they are, and the objects the id check refuses for what they are - one with no string id, one for an
 * id not handed, and every object of an id answered more than once. None of them can be replaced by a later answer's
 * object for its id, so none is part of the base that answer amends. Where one
 * id has two objects, the capture cannot tell which the seat meant to stand, so it keeps neither - before, it kept the
 * first without saying so, and a partial amendment was laid over whichever came first. The refusal says none is kept, and
 * the next answer gives that candidate whole: with no base object for it, an object of its id is read as a whole one.
 */
function refusalRemoved(role: CaptureRole, reply: unknown, rows: Record<string, number[]> | undefined, handed: readonly string[]): RefusalRemoved | undefined {
  const out: RefusalRemoved = {};
  if (rows && Object.keys(rows).length > 0) out.rows = rows;
  if ((role === "adjudicator" || role === "refuter") && Array.isArray(reply)) {
    const idField = CAPTURE_ROLE_SPEC[role].idField;
    const ids = reply.map((e) => (e && typeof e === "object" && !Array.isArray(e) ? (e as Record<string, unknown>)[idField] : undefined));
    const times = new Map<string, number>();
    for (const id of ids) if (typeof id === "string") times.set(id, (times.get(id) ?? 0) + 1);
    const objects: number[] = [];
    ids.forEach((id, i) => {
      if (typeof id !== "string" || !handed.includes(id) || (times.get(id) ?? 0) > 1) objects.push(i);
    });
    if (objects.length > 0) out.objects = objects;
  }
  return out.rows || out.objects ? out : undefined;
}

/**
 * A location the conversion could not write is named once, by the conversion. An evidence
 * entry the seat gave by id (`unit`, `item`) or as an item's name alone carries no `file`, `lines` or `quote` of its own:
 * the program writes them, and where it cannot (an id no decision opened, a place not kept, an item no kept place
 * carries) the conversion's problem says why. The record's check then also finds them absent and asked the seat to write
 * them - which for an entry named by id is the refusal `evidence-both` - so fm1's seats were told two contradictory things
 * about 42 such entries (126 lines of their refusals). Left out here only where the conversion named a problem for the same verdict; the record is
 * refused either way.
 */
function echoesConversion(reply: unknown, item: number, text: string): boolean {
  const m = /^evidence\[(\d+)\]\.(file|lines|quote|name) is absent/.exec(text);
  if (!m || !Array.isArray(reply)) return false;
  const verdict = reply[item] as { evidence?: unknown } | undefined;
  const e = Array.isArray(verdict?.evidence) ? (verdict.evidence[Number(m[1])] as Record<string, unknown> | undefined) : undefined;
  if (!e || typeof e !== "object") return false;
  const byId = "unit" in e || "item" in e;
  const byName = e.role === "item" && !("file" in e) && !("lines" in e) && !("quote" in e);
  return byId || byName;
}

/**
 * Whether a refuter's answer is a second look, for its record's name
 * where the caller does not know the entry (the command line): every object of a non-empty array marked `mode: "challenge"`.
 * An answer that cannot be read, or mixes the modes, takes the ordinary name and is refused by the checks that follow.
 */
export function answerIsChallenge(answer: Uint8Array): boolean {
  try {
    const v = JSON.parse(UTF8.decode(answer)) as unknown;
    return Array.isArray(v) && v.length > 0 && v.every((o) => o !== null && typeof o === "object" && (o as Record<string, unknown>).mode === "challenge");
  } catch {
    return false;
  }
}

export function captureAnswer(req: CaptureRequest): CaptureResult {
  const spec = CAPTURE_ROLE_SPEC[req.role];
  const target = recordPathFor(req.role, { ...req, challenge: req.role === "refuter" && (req.challenge ?? answerIsChallenge(req.answer)) });
  if (target.problem !== undefined) return { outcome: "not-written", reason: target.problem };
  const recordAbs = join(req.legalDir, target.rel);
  const previous = existsSync(recordAbs) ? programFileBytes("the record already there", recordAbs) : null;
  const replaceReason = req.replace ?? (previous ? (req.replaceSetAside?.(target.rel, sha256(previous)) ?? undefined) : undefined);
  if (previous && !replaceReason) {
    return {
      outcome: "not-written",
      reason: `${target.rel} already exists under ${req.legalDir}, and a record is never overwritten without a reason. Pass --replace "<reason>" to replace it; the ledger keeps the reason and the old file's sha256`,
    };
  }

  const validate = compileSchemaValidator(spec.schema, { register: spec.register });
  const probe = validate([]);
  if (!probe.ran) return { outcome: "validator-unavailable", reason: probe.unavailable_reason };

  try {
    UTF8.decode(req.answer);
  } catch {
    const problems = ["your reply is not valid UTF-8 text, so no JSON could be read from it"];
    return { outcome: "refused", problems, refusal: renderRefusal(req.role, problems), named: { "*": ["*"] } };
  }
  const seatExtracted = firstJsonValue(req.answer);
  if (!seatExtracted.ok) return { outcome: "refused", problems: [seatExtracted.problem], refusal: renderRefusal(req.role, [seatExtracted.problem]), named: { "*": ["*"] } };

  // An amendment of the last refused answer (amend.ts): laid over it, and the merged whole is the answer from here on.
  let answer: Uint8Array = req.answer;
  let extracted = seatExtracted;
  let amendment: { reason: string; outside: string[] } | undefined;
  if (req.amend) {
    const base = firstJsonValue(req.amend.base);
    // The refuter's entry is an `if`: its ordinary shape is the `else` branch.
    const itemsNode = schemaReader()(spec.schema).items as { required?: string[]; else?: { required?: string[] } } | undefined;
    const required = itemsNode?.required ?? itemsNode?.else?.required ?? [];
    const reason = base.ok ? amendmentReason(req.role, base.value, seatExtracted.value, required, req.amend.removed) : null;
    if (base.ok && reason) {
      const m = amendedReply(req.role, base.value as unknown[], seatExtracted.value as unknown[], req.amend.named, req.amend.removed);
      answer = m.bytes;
      const merged = firstJsonValue(answer);
      if (merged.ok) {
        extracted = merged;
        amendment = { reason, outside: m.outside };
      } else answer = req.answer;
    }
  }
  const reply = extracted.value;

  // The seat's decisions, turned into the record the program writes (design section 2.3). The form is the payload's:
  // an adjudicator's `reading` block is refused naming the new form, and a reader answers only in decisions.
  if (req.role === "reader" && !req.convert) {
    return { outcome: "not-written", reason: "a reader answers in decisions, which the capture turns into its record from the scan's findings document: pass --findings and the reader payload's --key" };
  }
  const conversion = req.convert
    ? req.convert(reply)
    : req.role === "adjudicator"
      ? verdictsFromDecisions(reply, null)
      : req.role === "refuter"
        ? refutationsFromDecisions(reply, null)
        : null;
  if (conversion?.unconvertible) return { outcome: "not-written", reason: conversion.unconvertible };
  const recordValue = conversion ? conversion.record : reply;
  const convertedItems = new Set((conversion?.problems ?? []).map((p) => p.item));

  const found: Problem[] = [];
  const read = schemaReader();
  for (const e of validate(reply).errors) {
    const p = schemaProblem(req.role, spec, read, reply, e);
    // The old form's block is named once, by the conversion, in the words that name the new form.
    // A skeleton field on a decision is named once too, by the conversion, with what to write instead.
    const skeletonField = new RegExp(`^${req.role === "reader" ? "" : String.raw`decisions\[\d+\]\.`}(${Object.keys(SKELETON_FIELDS_INSTEAD).join("|")})$`);
    if (p && conversion && e.keyword === "additionalProperties" && skeletonField.test(p.field)) continue;
    if (p && !(conversion && p.field === "reading")) found.push(p);
  }
  // The second check, on every entry: what the schema cannot say (a `lines` that names no line, a blank
  // quotation, a second label carried by value). A problem about a field the schema already named is
  // left out, so that the seat reads each defect once.
  if (spec.seat && Array.isArray(recordValue)) {
    recordValue.forEach((entry, i) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
      const named = new Set(found.filter((f) => f.item === i).map((f) => f.field));
      // The element count is never the schema's (it counts by a value), so the schema naming `evidence` for
      // another reason does not stand in for it: it is always printed, as it was when capture ran it apart.
      const counted = new Set(spec.seat === "adjudicator" ? elementEntryProblems(entry) : []);
      for (const text of recordShapeProblems({ seat: spec.seat as VerdictSeat, holder: entry as Record<string, unknown>, container: "verdicts-dir" })) {
        if (!counted.has(text) && namedFields(text).some((f) => named.has(f))) continue;
        if (convertedItems.has(i) && echoesConversion(reply, i, text)) continue;
        found.push({ item: i, field: counted.has(text) ? "evidence" : refusedField(text), text: `${itemLabel(spec, reply, i)}: ${text}` });
      }
      // Step 5a's rules are asked of every entry, as verdict-verify runs its coverage check over a malformed record too:
      // the seat reads every defect at once, and its refusals are not spent one defect at a time.
      // A decision the conversion refused is fixed first: the record made of the others is not the seat's reading yet.
      if (convertedItems.has(i)) return;
      for (const text of req.entryRule?.(entry as Record<string, unknown>) ?? []) found.push({ item: i, field: "reading", text: `${itemLabel(spec, reply, i)}: ${text}` });
    });
  }
  for (const p of conversion?.problems ?? []) {
    found.push({ item: p.item, field: p.field ?? "decisions", text: p.item === null ? p.text : `${itemLabel(spec, reply, p.item)}: ${p.text}` });
  }
  if (!convertedItems.has(null)) for (const text of req.replyRule?.(recordValue) ?? []) found.push({ item: null, field: "", text });
  if (req.role === "refuter") for (const p of refuterModeProblems(spec, reply, req.challenge)) found.push(p);
  zeroHitNotes(req.role, reply, found);
  const ordered = found
    .map((f, n) => ({ f, n }))
    .sort((a, b) => (a.f.item ?? -1) - (b.f.item ?? -1) || a.n - b.n)
    .map(({ f }) => f.text);
  const problems = [...new Set([...(amendment?.outside ?? []), ...ordered, ...(req.role === "reader" ? [] : idProblems(req.role, reply, req.ids))])];
  if (problems.length > 0) {
    const removed = refusalRemoved(req.role, reply, conversion?.removedRows, req.ids);
    return {
      outcome: "refused",
      problems,
      refusal: renderRefusal(req.role, problems),
      named: refusalNamed(req.role, reply, found, req.ids),
      ...(removed ? { removed } : {}),
      ...(amendment ? { checked: Buffer.from(answer) } : {}),
      ...(conversion?.placesPassed && conversion.placesPassed.length > 0 ? { placesPassed: conversion.placesPassed } : {}),
    };
  }

  // Accepted. The record is the byte slice, or, where the seat answered in decisions, the program's record made of them
  // (form 2); the whole reply is kept beside it, content-addressed, either way.
  const slice = answer.subarray(extracted.start, extracted.end);
  const form2 = conversion?.form === 2;
  const record = form2 ? Buffer.from(`${JSON.stringify(recordValue, null, 2)}\n`, "utf8") : slice;
  const replySha = sha256(answer);
  const replyRel = `${REPLIES_DIR}/${target.rel.replace(/\.json$/, "")}.${replySha.slice(0, 16)}.txt`;
  const replyAbs = join(req.legalDir, replyRel);
  makeFolder(dirname(replyAbs), { recursive: true });
  if (!existsSync(replyAbs)) writeFileAt(replyAbs, answer);
  makeFolder(dirname(recordAbs), { recursive: true });
  const temporary = `${recordAbs}.capture-${process.pid}.tmp`;
  writeFileAt(temporary, record);
  renamePath(temporary, recordAbs);

  const entry: LedgerEntry = {
    v: CAPTURE_LEDGER_VERSION,
    at: req.at ?? new Date().toISOString(),
    seat: req.seat,
    role: req.role,
    key: req.key ?? null,
    ids: req.ids,
    ids_from: req.idsFrom,
    file: target.rel,
    sha256: sha256(record),
    bytes: record.length,
    reply: {
      file: replyRel,
      sha256: replySha,
      bytes: answer.length,
      json_start: extracted.start,
      json_end: extracted.end,
      prose_before_bytes: extracted.start,
      prose_after_bytes: answer.length - extracted.end,
    },
    schema: spec.schema,
    ...(previous ? { replaces: { sha256: sha256(previous), reason: replaceReason as string } } : {}),
    ...(req.via ? { via: req.via } : {}),
    ...(form2 ? { form: 2 as const, answer_sha256: sha256(slice) } : {}),
    ...(conversion?.normalised && conversion.normalised.length > 0 ? { normalised: conversion.normalised } : {}),
    ...(amendment && req.amend
      ? { amends: { answer_sha256: sha256(req.answer), answer_bytes: req.answer.length, base_file: req.amend.baseFile, base_sha256: sha256(req.amend.base), why: amendment.reason } }
      : {}),
  };
  const ledgerAbs = join(req.legalDir, LEDGER_FILE);
  makeFolder(dirname(ledgerAbs), { recursive: true });
  appendFileAt(ledgerAbs, `${JSON.stringify(entry)}\n`);
  return { outcome: "written", entry };
}

/** Unit U1: one file of kept place rows, as the hook ledger's line for its seat names it. */
export interface PlacesKept {
  finding_id: string;
  /** Relative to the `.legal` directory. */
  file: string;
  sha256: string;
  places: number;
}

/**
 * READ PLACES KEPT APART FROM THE VERDICT (in one run 192 places read by seats whose verdict object
 * ended invalid were recorded not checked, because a refused answer wrote nothing). Where a seat's answer ends without
 * a record - invalid after its last refusal, or stopped after a refusal - every place row of it that passed the place
 * checks (C3-C5, C7, C9: the row's line is in its window, its quote is a verbatim part of that line, the seat's own
 * transcript shows the Read) is written as read, one file per candidate under `.legal/capture/places-kept/`, in the
 * readers' form with `kept_from` naming the seat. Nothing that failed a place check is in it, and no verdict is: the
 * candidate is still "not answered" until a seat's answer over it holds. Written once, never over a file already there.
 */
export function keepReadPlaces(legalDir: string, seat: string, passed: NonNullable<DecisionsConversion["placesPassed"]>): PlacesKept[] {
  const out: PlacesKept[] = [];
  for (const { finding_id, rows } of passed) {
    if (rows.length === 0) continue;
    const rel = join(PLACES_KEPT_DIR, `${sanitiseName(finding_id)}.${sanitiseName(seat)}.json`);
    const abs = join(legalDir, rel);
    if (existsSync(abs)) continue;
    const bytes = Buffer.from(`${JSON.stringify({ finding_id, kept_from: seat, dispositions: rows }, null, 2)}\n`, "utf8");
    makeFolder(dirname(abs), { recursive: true });
    const temporary = `${abs}.capture-${process.pid}.tmp`;
    writeFileAt(temporary, bytes);
    renamePath(temporary, abs);
    out.push({ finding_id, file: slashPath(rel), sha256: sha256(bytes), places: rows.length });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// 5. The ledger check.

export interface LedgerCheck {
  entries: number;
  records: number;
  matching: number;
  /** A record or a kept reply whose bytes no longer hash to what its ledger entry says. */
  changed: { file: string; recorded: string; now: string }[];
  missing: string[];
  /** A `.json` under verdicts/ or readers/ that no ledger entry names: written by something other than this command. */
  unledgered: string[];
  unreadableLines: number[];
}

function jsonFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const visit = (at: string) => {
    let names: string[];
    try {
      names = readdirSync(at).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(at, name);
      const s = statSync(full);
      if (s.isDirectory()) visit(full);
      else if (s.isFile() && name.endsWith(".json")) out.push(full);
    }
  };
  visit(dir);
  return out;
}

/** The capture ledger as read: every entry that reads, in order; the latest per record file; the kept replies; the lines that do not read. */
export interface CaptureLedger {
  entries: LedgerEntry[];
  /** A --replace entry supersedes the one before it. */
  latest: Map<string, LedgerEntry>;
  /** Each kept reply file, with the sha256 its entry recorded. */
  replies: Map<string, string>;
  /** 1-based line numbers. */
  unreadableLines: number[];
}

/** Read `capture/ledger.jsonl` under a `.legal` directory: the one reader, used by `checkLedger` and by the assembly. */
export function readCaptureLedger(legalDir: string): CaptureLedger {
  const out: CaptureLedger = { entries: [], latest: new Map(), replies: new Map(), unreadableLines: [] };
  const ledgerAbs = join(legalDir, LEDGER_FILE);
  if (!existsSync(ledgerAbs)) return out;
  programFileBytes("the capture ledger", ledgerAbs)
    .toString("utf8")
    .split("\n")
    .forEach((line, i) => {
      if (!line.trim()) return;
      try {
        const entry = JSON.parse(line) as LedgerEntry;
        if (typeof entry.file !== "string" || typeof entry.sha256 !== "string") throw new Error("no file or sha256");
        out.entries.push(entry);
        out.latest.set(entry.file, entry);
        if (entry.reply && typeof entry.reply.file === "string") out.replies.set(entry.reply.file, entry.reply.sha256);
      } catch {
        out.unreadableLines.push(i + 1);
      }
    });
  return out;
}


export function checkLedger(legalDir: string, ledger: CaptureLedger = readCaptureLedger(legalDir)): LedgerCheck {
  const result: LedgerCheck = { entries: ledger.entries.length, records: 0, matching: 0, changed: [], missing: [], unledgered: [], unreadableLines: [...ledger.unreadableLines] };
  const { latest, replies } = ledger;
  const check = (rel: string, recorded: string, isRecord: boolean) => {
    const abs = join(legalDir, rel);
    if (!existsSync(abs)) {
      result.missing.push(rel);
      return;
    }
    const now = sha256(programFileBytes("a file the capture ledger names", abs));
    if (now !== recorded) result.changed.push({ file: rel, recorded, now });
    else if (isRecord) result.matching++;
  };
  for (const [rel, entry] of latest) {
    result.records++;
    check(rel, entry.sha256, true);
  }
  for (const [rel, recorded] of replies) check(rel, recorded, false);
  for (const sub of ["verdicts", "readers"]) {
    for (const full of jsonFilesUnder(join(legalDir, sub))) {
      const rel = relativePath(legalDir, full);
      if (!latest.has(rel)) result.unledgered.push(rel);
    }
  }
  return result;
}

export function ledgerCheckFailed(c: LedgerCheck): boolean {
  return c.changed.length > 0 || c.missing.length > 0 || c.unledgered.length > 0 || c.unreadableLines.length > 0;
}

// ---------------------------------------------------------------------------------------------------
// 6. The command.

export const CAPTURE_EXIT = { written: 0, arguments: 1, unreadable: 2, validatorUnavailable: 3, refused: 4, ledger: 5 } as const;

export function registerVerdictCapture(program: Command): void {
  program
    .command("verdict-capture")
    .description(
      "Take one seat's answer exactly as the platform stored it and write the record, instead of the orchestrator retyping it. The FIRST JSON value of the answer is the record, byte for byte; text before or after it is kept aside in capture/replies/ and never merged. The value is checked against the seat's reply schema, the record shape check and the ids the launch handed over (each answered exactly once, none foreign). A wrong answer prints, on stdout, the refusal to send back to that seat, and nothing is written. An accepted one is written on SKILL.md's path scheme and a ledger line (file, sha256, seat, time) is appended to capture/ledger.jsonl. Exit 0 written; 1 bad arguments or the record exists without --replace; 2 an input could not be read; 3 the schema validator could not be loaded (nothing is written: this command never writes an unchecked record); 4 refused; 5 --check-ledger found a file that no longer matches, is missing or was not written by this command",
    )
    .option("--role <role>", `the seat that answered: ${CAPTURE_ROLES.join(", ")} (a reader is an adjudicator launched in reading mode)`)
    .option("--answer <file>", "the answer text exactly as the platform stored it, or - for stdin")
    .option("--seat <id>", "the answering seat's agent id, for the ledger")
    .option("--key <key>", "the payload key (adjudicator, reader), the batch name (silence investigator), or the launch name (a refuter handed several candidates)")
    .option("--ids <list>", "the ids the launch handed over, comma-separated: finding_ids, rule_ids, or a reader's kinds")
    .option("--ids-file <file>", "the same, as a JSON array of strings, for ids that carry commas")
    .option("--findings <file>", "the scan's findings.json: derive an adjudicator's or a reader's ids, and an adjudicator's file number, from the payload --key names")
    .option("--ordinal <n>", "an adjudicator record's file number (the key's position); derived from --findings when absent")
    .option("--legal <dir>", "the working directory the records live in (default: .legal)")
    .option("--replace <reason>", "replace an existing record; the reason and the old file's sha256 go into the ledger")
    .option("--check-ledger", "check every record and kept reply against the ledger instead of capturing, and list any record the ledger does not name")
    .action((opts) => {
      process.exitCode = runVerdictCapture(opts as Record<string, unknown>);
    });
}

export function runVerdictCapture(opts: Record<string, unknown>): number {
  const legalDir = resolve(typeof opts.legal === "string" ? opts.legal : ".legal");
  if (opts.checkLedger) {
    const c = checkLedger(legalDir);
    console.log(`verdict-capture --check-ledger ${legalDir}: ${c.entries} ledger entries, ${c.records} records, ${c.matching} matching.`);
    for (const x of c.changed) console.log(`  CHANGED   ${x.file}: the ledger recorded sha256 ${x.recorded.slice(0, 16)}..., the file now hashes to ${x.now.slice(0, 16)}...; it was changed after it was captured`);
    for (const f of c.missing) console.log(`  MISSING   ${f}: the ledger names it and it is not there`);
    for (const f of c.unledgered) console.log(`  UNLEDGERED ${f}: no ledger entry names it, so this command did not write it`);
    for (const n of c.unreadableLines) console.log(`  UNREADABLE ledger line ${n}`);
    return ledgerCheckFailed(c) ? CAPTURE_EXIT.ledger : CAPTURE_EXIT.written;
  }

  const fail = (code: number, message: string): number => {
    console.error(`verdict-capture: ${message}. Nothing was written.`);
    return code;
  };
  const role = opts.role as CaptureRole;
  if (!CAPTURE_ROLES.includes(role)) return fail(CAPTURE_EXIT.arguments, `--role must be one of ${CAPTURE_ROLES.join(", ")}`);
  if (typeof opts.answer !== "string") return fail(CAPTURE_EXIT.arguments, "--answer <file> (or - for stdin) is required");
  if (typeof opts.seat !== "string" || opts.seat.trim() === "") return fail(CAPTURE_EXIT.arguments, "--seat <agent id> is required: the ledger says which seat each record came from");
  const key = typeof opts.key === "string" ? opts.key : undefined;
  if (key !== undefined && key.trim() === "") return fail(CAPTURE_EXIT.arguments, "--key is empty");

  // A refuter's and an investigator's ids are chosen at launch, never read from a payload; a refuter's --findings is the
  // document its decisions are turned into its record against, given beside --ids or --ids-file.
  const findingsGivesIds = role === "adjudicator" || role === "reader";
  const sources = ["ids", "idsFile", ...(findingsGivesIds ? ["findings"] : [])].filter((k) => opts[k] !== undefined);
  if (sources.length !== 1) {
    return fail(
      CAPTURE_EXIT.arguments,
      findingsGivesIds
        ? "give exactly one of --ids, --ids-file and --findings: the ids the launch handed over"
        : `give exactly one of --ids and --ids-file: the ids the launch handed over (a ${role}'s --findings is only the document its answer is read against)`,
    );
  }
  let ids: string[];
  let idsFrom: string;
  let ordinal: number | undefined;
  if (opts.ordinal !== undefined) {
    ordinal = Number(opts.ordinal);
    if (!Number.isInteger(ordinal) || ordinal < 1) return fail(CAPTURE_EXIT.arguments, `--ordinal ${String(opts.ordinal)} is not a whole number from 1`);
  }
  if (opts.findings !== undefined && findingsGivesIds) {
    if (!key) return fail(CAPTURE_EXIT.arguments, "--findings needs --key: the payload whose ids are read");
    const handed = handedFromFindings(resolve(String(opts.findings)), key, role);
    if (handed.problem !== undefined) return fail(handed.unreadable ? CAPTURE_EXIT.unreadable : CAPTURE_EXIT.arguments, handed.problem);
    if (ordinal !== undefined && role === "adjudicator" && ordinal !== handed.ordinal) {
      return fail(CAPTURE_EXIT.arguments, `--ordinal ${ordinal} disagrees with the key's position ${handed.ordinal} in --findings`);
    }
    ids = handed.ids;
    ordinal = ordinal ?? handed.ordinal;
    idsFrom = `findings:${String(opts.findings)}#${key}`;
  } else if (opts.idsFile !== undefined) {
    try {
      const parsed = JSON.parse(readRegularFile(resolve(String(opts.idsFile)), "utf8"));
      if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string")) return fail(CAPTURE_EXIT.arguments, `--ids-file ${String(opts.idsFile)} is not a JSON array of strings`);
      ids = parsed;
    } catch (e) {
      return fail(CAPTURE_EXIT.unreadable, `--ids-file ${String(opts.idsFile)} could not be read as JSON (${(e as Error).message})`);
    }
    idsFrom = `ids-file:${String(opts.idsFile)}`;
  } else {
    ids = String(opts.ids).split(",").map((s) => s.trim());
    idsFrom = "ids";
  }
  if (ids.length === 0 || ids.some((id) => id === "")) return fail(CAPTURE_EXIT.arguments, "the handed ids are empty, or one of them is");
  const twice = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (twice.length > 0) return fail(CAPTURE_EXIT.arguments, `the handed ids name ${JSON.stringify(twice[0])} twice`);

  let answer: Buffer;
  try {
    answer = opts.answer === "-" ? readFileSync(0) : readRegularFile(resolve(opts.answer));
  } catch (e) {
    return fail(CAPTURE_EXIT.unreadable, `--answer ${opts.answer} could not be read (${(e as Error).message})`);
  }

  const rules = opts.findings !== undefined ? answerRulesAtCapture(resolve(String(opts.findings)), join(legalDir, "readers"), undefined, undefined, undefined, () => carriedRepliesOfLaunchDir(join(legalDir, "launch"))) : undefined;
  const readerCandidate = opts.findings !== undefined && role === "reader" && key ? handedFromFindings(resolve(String(opts.findings)), key, role) : null;
  const convert = rules ? decisionsConverter(role, rules, key ?? "", readerCandidate && readerCandidate.problem === undefined ? readerCandidate.candidate : "") : undefined;
  const result = captureAnswer({
    role,
    seat: opts.seat,
    key,
    ordinal,
    ids,
    idsFrom,
    answer,
    legalDir,
    replace: typeof opts.replace === "string" ? opts.replace : undefined,
    // With the scan's findings document, the rules step 5a applies to one seat's answer are applied here as the hook
    // applies them (reading-assembly.ts `answerRulesAtCapture`). With --ids or
    // --ids-file there is no document to read them from, and they are left to step 5a (a stated limit).
    ...(rules && role === "adjudicator" ? { entryRule: rules.verdict } : {}),
    ...(rules && role === "reader" ? { replyRule: (reply: unknown) => rules.reader(reply, ids) } : {}),
    ...(convert ? { convert } : {}),
  });
  switch (result.outcome) {
    case "not-written":
      return fail(CAPTURE_EXIT.arguments, result.reason);
    case "validator-unavailable":
      return fail(CAPTURE_EXIT.validatorUnavailable, `the JSON Schema check cannot run here, and this command never writes a record it has not checked: ${result.reason}`);
    case "refused":
      process.stdout.write(result.refusal);
      console.error(`verdict-capture: refused the ${role} reply of seat ${opts.seat} (${result.problems.length} problem(s)); nothing was written. The text on stdout is what to send back to that seat.`);
      return CAPTURE_EXIT.refused;
    case "written": {
      const e = result.entry;
      console.log(`verdict-capture: wrote ${e.file} (${e.bytes} bytes, sha256 ${e.sha256.slice(0, 16)}...) from seat ${e.seat}; ${e.ids.length} ${CAPTURE_ROLE_SPEC[role].idNoun}(s) answered.`);
      console.log(`  whole reply kept at ${e.reply.file}; text before the JSON: ${e.reply.prose_before_bytes} bytes, after it: ${e.reply.prose_after_bytes} bytes (kept there, never merged).`);
      if (e.replaces) console.log(`  replaced a record whose sha256 was ${e.replaces.sha256.slice(0, 16)}..., because: ${e.replaces.reason}`);
      return CAPTURE_EXIT.written;
    }
  }
}
