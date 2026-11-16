/**
 * DATA SUMMARIES - one summary the program verifies over every record of a data file group (full-read design
 * section 2; review R1, R6, R12, R14; build unit F6).
 *
 * For one rule (one candidate) and one GROUP - the candidate's places in files of one directory and one extension whose
 * format the program reads as data (JSON, YAML, CSV) - the places whose records share one structure and whose values the
 * program can show exactly are given to the seat as ONE summary instead of one window each. Everything else in the
 * group goes back to its window (or keeps the fact `place-facts.ts` tested on its line), and the summary says how many
 * and why. Nothing is folded away silently: every place of a candidate is either covered by exactly one summary, listed
 * by id, or returned in `notSummarized` with the program's reason, and the payload writer windows it as before.
 *
 * What a summary shows (design section 2, items 1-4):
 * 1. the record count and the files; the COMMON STRUCTURE and every record that differs from it, listed in full (its
 *    places windowed). The common structure is defined exactly (R12): a record's structure is the set of its key paths
 *    (array positions written `[]`) with the type of the value at each; the common structure is the structure most of the
 *    group's matched records have EXACTLY, and it is common only when at least half of them have it. Where no structure
 *    is shared by half, there is no summary.
 * 2. at every matched key path, every value: whole with its count when the path holds at most 50 distinct values; past
 *    50, as a PATTERN the program verified - every part that equals another field of the same record written
 *    `<<that field>>`, every other part literal, and the count of values it reproduces exactly - with the values no
 *    pattern reproduces listed whole up to 50; the places of the values past those 50 are windowed.
 * 3. beside the matched key paths (R6), every other key path the summarized records hold: its types, the SHAPES of its
 *    values by value and by key name (e-mail, IP address, phone, URL with a personal parameter, long free text,
 *    identifier-like, username, name, date-time, ...) with how many records carry each, and up to 10 example values.
 * 4. three records verbatim (first, last, one chosen by a fixed seed) and the ids of every place it covers.
 *
 * What it never hides (each a reason in `SUMMARY_WINDOW_REASONS`, each a gate case in a test):
 * 1. a differing record (another key set, another type, a nested structure the others lack): listed in full, its places
 *    windowed; no majority structure: no summary;
 * 2. a value: whole, or reproduced exactly by a verified pattern; never a host or a domain in place of the value;
 * 3. a URL with a query string, a fragment or userinfo, and a URL the program cannot parse: windowed;
 * 4. any substitution syntax in a value (a principle: any construct whose text stands for a value filled in elsewhere):
 *    windowed;
 * 5. a line the program cannot read as ONE key and ONE value, a comment, a value over 200 characters or with a newline,
 *    code in a string value: windowed; a `.js` / `.ts` / `.rb` configuration file is not a data format and never enters
 *    a group;
 * 6. a group under 20 places, or left under 20 by items 1-5: windowed whole;
 * 7. a summary larger than 80,000 bytes (two Read ranges) as the payload holds it: no summary, every place windowed;
 * 8. translation files are never summarized (a string can be the consent text a rule asks about).
 */
import { posix } from "node:path";
import { LineCounter, isAlias, isMap, isScalar, isSeq, parseAllDocuments } from "yaml";
import { hasDuplicateKey } from "./yaml-unique-keys.js";
import type { Candidate, FindingLocation } from "wolfboy-schemas";
import { LOCALE_DIRECTORIES, placeFactsFor } from "./place-facts.js";
import { placeId } from "./ref-ids.js";

/** Rule 6: a group (or what is left of it) under this many places is windowed whole. */
export const SUMMARY_MIN_PLACES = 20;
/** Rule 7: a summary over this many bytes, as the payload holds it, is not written (two Read ranges of 40,000 B). */
export const SUMMARY_MAX_BYTES = 80_000;
/** Item 2: distinct values listed whole at one key path (with patterns past it, then windows). */
export const SUMMARY_WHOLE_VALUES_MAX = 50;
/** Rule 5: a value longer than this is windowed. */
export const SUMMARY_VALUE_MAX_CHARS = 200;
/** Item 3: example values per key path beside the matched ones. */
export const SUMMARY_EXAMPLES_MAX = 10;
/** Item 4: records quoted verbatim. */
export const SUMMARY_VERBATIM_RECORDS = 3;
/** The formats the summarizer reads as data, by extension (design section 2 and R14: JSON, YAML, CSV only). */
export const SUMMARY_FORMATS: Readonly<Record<string, "JSON" | "YAML" | "CSV">> = {
  ".json": "JSON",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".csv": "CSV",
};
/** A pattern substitutes only a field whose text is at least this long (a shorter one reproduces by accident). */
export const SUMMARY_PATTERN_FIELD_MIN_CHARS = 3;
/** The indentation a summary has in a payload (`candidates[].summaries[]`, three levels of two spaces). */
const PAYLOAD_DEPTH_SPACES = 6;

/** Why a place of a data file group is not covered by a summary: the program's reason, one per place. */
export const SUMMARY_WINDOW_REASONS = [
  "translation_file",
  "fact",
  "transcoded",
  "not_parsed",
  "not_key_value",
  "differing_record",
  "no_majority_structure",
  "url_query_fragment_userinfo",
  "substitution_syntax",
  "long_or_multiline_value",
  "code_in_value",
  "values_past_cap",
  "group_under_20",
  "summary_over_ceiling",
] as const;
export type SummaryWindowReason = (typeof SUMMARY_WINDOW_REASONS)[number];

/** What each reason means, in the words a seat and a person read. */
export const SUMMARY_WINDOW_REASON_TEXT: Readonly<Record<SummaryWindowReason, string>> = {
  translation_file: "a translation file: never summarized (rule 8)",
  fact: "its line is a fact the program tested; given as that fact",
  transcoded: "the file's bytes are not UTF-8, so a value quoted from it would not be the file's own text",
  not_parsed: "the file could not be parsed whole as data (or holds an alias, a merge key, a duplicate key or a tag)",
  not_key_value: "the line is not one key and one value (a structure line, two values, a comment, or a match over several lines) (rule 5)",
  differing_record: "its record's structure differs from the common one; the record is listed in full in the summary (rule 1)",
  no_majority_structure: "no structure is shared by half of the group's records, so the group has no summary (rule 1)",
  url_query_fragment_userinfo: "the value holds a URL with a query string, a fragment or userinfo, or one the program cannot parse (rule 3)",
  substitution_syntax: "the value holds substitution syntax: text that stands for a value filled in elsewhere (rule 4)",
  long_or_multiline_value: `the value is over ${SUMMARY_VALUE_MAX_CHARS} characters or holds a newline (rule 5)`,
  code_in_value: "the value, or its key, reads as code in a string (rule 5)",
  values_past_cap: `its value is past the ${SUMMARY_WHOLE_VALUES_MAX} distinct values of its key path that no verified pattern reproduces (item 2)`,
  group_under_20: `the group, or what is left of it, is under ${SUMMARY_MIN_PLACES} places (rule 6)`,
  summary_over_ceiling: `the summary would be over ${SUMMARY_MAX_BYTES} bytes (rule 7)`,
};

/** What a payload says its summaries are (`context.summaries_are`), written only where a payload holds one. */
export const SUMMARIES_ARE =
  "A candidate's `summaries` each stand for the places listed by id in its `places`: places of one rule in data files of one directory and one extension, given as ONE summary the program verified over every record instead of one window each. A place a summary covers has no row in `locations` and is in no other payload. `matched_key_paths` shows every value at each matched key path, whole with its count or as a verified pattern (`<<field>>` is the value of that field of the same record, every other character literal); `beside` shows every other key path of those records with its value shapes and examples; `verbatim` quotes three records; `differing_records` lists in full every record whose structure is not the common one (their places are windowed rows); `not_summarized` gives every other place of the group with the program's reason - each is a row in some payload, with its window or fact. Decide a summary as one, and open any file it lists where the summary is not enough.";

// ---------------------------------------------------------------------------------------------------------------------
// The parsed document: a tree with line numbers, the same for JSON, YAML and CSV.

type ScalarType = "string" | "number" | "boolean" | "null" | "array" | "object";
interface DScalar {
  kind: "scalar";
  type: ScalarType;
  /** The value's text: a string decoded, a number as written, `true`/`false`/`null`, `[]`/`{}` for an empty container. */
  text: string;
  line: number;
  endLine: number;
  /** A comment shares its line (YAML). */
  comment?: true;
}
interface DObject {
  kind: "object";
  members: { key: string; line: number; node: DNode }[];
  line: number;
  endLine: number;
}
interface DArray {
  kind: "array";
  items: DNode[];
  line: number;
  endLine: number;
}
type DNode = DScalar | DObject | DArray;

/** One value of a record: its key path (array positions `[]`), its concrete path, its type and text, its lines. */
export interface Leaf {
  path: string;
  concrete: string;
  type: ScalarType;
  text: string;
  /** The line its key (or, for an array element, the element) starts on. */
  line: number;
  endLine: number;
  comment?: true;
}

/** One record: a file's top-level value, an element of a top-level array of objects, or a CSV row. */
export interface DataRecord {
  file: string;
  index: number;
  line: number;
  endLine: number;
  leaves: Leaf[];
  /** The structure: every `path:type` pair, sorted, joined by a newline. */
  structure: string;
  /** Scalar values at key paths that occur once in a record (no `[]`), by path: the fields a pattern may name. */
  fields: Map<string, string>;
}

/** A data file as the summarizer reads it, or null where it is not parsed whole. */
export interface ParsedDataFile {
  format: "JSON" | "YAML" | "CSV";
  records: DataRecord[];
  /** Leaves by the line they start on. */
  leavesByLine: Map<number, Leaf[]>;
  /** Lines on which a key whose value is a non-empty container starts (a structure line, never a key and a value). */
  openers: Set<number>;
  /** CSV: the column names. */
  columns?: string[];
  /** The record a line belongs to, by an index over the lines (records never overlap). */
  recordAt: (line: number) => DataRecord | undefined;
}

function recordIndex(records: DataRecord[]): (line: number) => DataRecord | undefined {
  let at: (DataRecord | undefined)[] | null = null;
  return (line) => {
    if (at === null) {
      at = [];
      for (const r of records) for (let l = r.line; l <= r.endLine; l++) at[l] = r;
    }
    return at[line];
  };
}

const keyPath = (base: string, key: string): string =>
  /^[A-Za-z0-9_$@-]+$/.test(key) ? (base === "" ? key : `${base}.${key}`) : `${base}[${JSON.stringify(key)}]`;

function flatten(node: DNode, path: string, concrete: string, itemLine: number, out: Leaf[], openers: Set<number>): void {
  if (node.kind === "scalar") {
    out.push({ path, concrete, type: node.type, text: node.text, line: itemLine, endLine: node.endLine, ...(node.comment ? { comment: true as const } : {}) });
    return;
  }
  if (node.kind === "object") {
    if (node.members.length === 0) {
      out.push({ path, concrete, type: "object", text: "{}", line: itemLine, endLine: node.endLine });
      return;
    }
    for (const m of node.members) {
      if (m.node.kind !== "scalar" && !(m.node.kind === "object" ? m.node.members.length === 0 : m.node.items.length === 0)) openers.add(m.line);
      flatten(m.node, keyPath(path, m.key), keyPath(concrete, m.key), m.line, out, openers);
    }
    return;
  }
  if (node.items.length === 0) {
    out.push({ path, concrete, type: "array", text: "[]", line: itemLine, endLine: node.endLine });
    return;
  }
  node.items.forEach((item, i) => flatten(item, `${path}[]`, `${concrete}[${i}]`, item.line, out, openers));
}

function recordOf(file: string, index: number, node: DNode, openers: Set<number>): DataRecord {
  const leaves: Leaf[] = [];
  flatten(node, "", "", node.line, leaves, openers);
  const pairs = [...new Set(leaves.map((l) => `${l.path}:${l.type}`))].sort();
  const fields = new Map<string, string>();
  for (const l of leaves) if (!l.path.includes("[]") && (l.type === "string" || l.type === "number")) fields.set(l.path, l.text);
  return { file, index, line: node.line, endLine: node.endLine, leaves, structure: pairs.join("\n"), fields };
}

function recordsOfRoots(file: string, roots: DNode[], openers: Set<number>): DataRecord[] {
  const out: DataRecord[] = [];
  for (const root of roots) {
    if (root.kind === "array" && root.items.length > 0 && root.items.every((i) => i.kind === "object")) {
      for (const item of root.items) out.push(recordOf(file, out.length, item, openers));
    } else out.push(recordOf(file, out.length, root, openers));
  }
  return out;
}

function indexLeaves(records: DataRecord[]): Map<number, Leaf[]> {
  const byLine = new Map<number, Leaf[]>();
  for (const r of records) {
    for (const l of r.leaves) {
      const list = byLine.get(l.line);
      if (list) list.push(l);
      else byLine.set(l.line, [l]);
    }
  }
  return byLine;
}

const LITERAL = /true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/** JSON with line numbers. The grammar is `JSON.parse`'s (it runs first); a duplicate key refuses the file. */
function parseJsonTree(text: string): DNode | null {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  try {
    JSON.parse(src);
  } catch {
    return null;
  }
  let i = 0;
  let line = 1;
  const n = src.length;
  const ws = (): void => {
    while (i < n) {
      const c = src.charCodeAt(i);
      if (c === 10) {
        line++;
        i++;
      } else if (c === 32 || c === 9 || c === 13) i++;
      else break;
    }
  };
  const str = (): string => {
    const start = i;
    i++;
    while (src[i] !== '"') i += src[i] === "\\" ? 2 : 1;
    i++;
    return JSON.parse(src.slice(start, i)) as string;
  };
  let duplicate = false;
  const value = (): DNode => {
    ws();
    const at = line;
    const c = src[i];
    if (c === "{") {
      i++;
      const members: DObject["members"] = [];
      const seen = new Set<string>();
      ws();
      if (src[i] === "}") {
        i++;
        return { kind: "object", members, line: at, endLine: line };
      }
      for (;;) {
        ws();
        const keyLine = line;
        const key = str();
        if (seen.has(key)) duplicate = true;
        seen.add(key);
        ws();
        i++; // the colon
        const node = value();
        members.push({ key, line: keyLine, node });
        ws();
        if (src[i] === ",") {
          i++;
          continue;
        }
        i++; // the closing brace
        break;
      }
      return { kind: "object", members, line: at, endLine: line };
    }
    if (c === "[") {
      i++;
      const items: DNode[] = [];
      ws();
      if (src[i] === "]") {
        i++;
        return { kind: "array", items, line: at, endLine: line };
      }
      for (;;) {
        items.push(value());
        ws();
        if (src[i] === ",") {
          i++;
          continue;
        }
        i++; // the closing bracket
        break;
      }
      return { kind: "array", items, line: at, endLine: line };
    }
    if (c === '"') return { kind: "scalar", type: "string", text: str(), line: at, endLine: at };
    LITERAL.lastIndex = i;
    const m = LITERAL.exec(src);
    const token = m ? m[0] : "";
    i += token.length;
    const type: ScalarType = token === "true" || token === "false" ? "boolean" : token === "null" ? "null" : "number";
    return { kind: "scalar", type, text: token, line: at, endLine: at };
  };
  const root = value();
  return duplicate ? null : root;
}

/** YAML with line numbers, through the `yaml` package. An alias, an anchor, a tag, a merge key, an error: not parsed. */
function parseYamlTrees(text: string): DNode[] | null {
  const lc = new LineCounter();
  let docs: ReturnType<typeof parseAllDocuments>;
  try {
    // `uniqueKeys: false` and `hasDuplicateKey` below: the package's own test is quadratic in a
    // mapping's size and is asked in linear time instead, with the same answer (yaml-unique-keys.ts).
    docs = parseAllDocuments(text, { lineCounter: lc, uniqueKeys: false, prettyErrors: false });
  } catch {
    return null;
  }
  if (!Array.isArray(docs)) return [];
  const lineOf = (offset: number): number => lc.linePos(Math.max(0, offset)).line;
  const restOfLine = (offset: number): string => {
    const end = text.indexOf("\n", offset);
    return text.slice(offset, end < 0 ? text.length : end);
  };
  let refused = false;
  const conv = (node: unknown, fallbackLine: number): DNode => {
    if (node === null || node === undefined) return { kind: "scalar", type: "null", text: "null", line: fallbackLine, endLine: fallbackLine };
    const anyNode = node as { anchor?: string; tag?: string; range?: [number, number, number]; comment?: string; type?: string; source?: string };
    if (isAlias(node) || anyNode.anchor || (anyNode.tag && !/^tag:yaml\.org,2002:(str|int|float|bool|null|map|seq)$/.test(anyNode.tag))) refused = true;
    const range = anyNode.range ?? [0, 0, 0];
    const line = lineOf(range[0]);
    const endLine = lineOf(Math.max(range[0], range[1] - 1));
    if (isScalar(node)) {
      const v = node.value;
      let type: ScalarType;
      let txt: string;
      if (typeof v === "string") {
        type = "string";
        txt = v;
      } else if (typeof v === "number") {
        type = "number";
        txt = typeof anyNode.source === "string" ? anyNode.source : String(v);
      } else if (typeof v === "boolean") {
        type = "boolean";
        txt = String(v);
      } else if (v === null) {
        type = "null";
        txt = "null";
      } else {
        refused = true;
        type = "string";
        txt = String(v);
      }
      const commented = (anyNode.comment !== undefined && anyNode.comment !== "") || /#/.test(restOfLine(range[1]));
      return { kind: "scalar", type, text: txt, line, endLine, ...(commented ? { comment: true as const } : {}) };
    }
    if (isMap(node)) {
      const members: DObject["members"] = [];
      for (const pair of node.items) {
        const k = pair.key as unknown;
        if (!isScalar(k) || (typeof k.value !== "string" && typeof k.value !== "number") || k.value === "<<") {
          refused = true;
          continue;
        }
        const keyRange = (k as { range?: [number, number, number] }).range ?? range;
        const keyLine = lineOf(keyRange[0]);
        members.push({ key: String(k.value), line: keyLine, node: conv(pair.value, keyLine) });
      }
      return { kind: "object", members, line, endLine };
    }
    if (isSeq(node)) return { kind: "array", items: node.items.map((item) => conv(item, line)), line, endLine };
    refused = true;
    return { kind: "scalar", type: "null", text: "null", line, endLine };
  };
  const roots: DNode[] = [];
  for (const doc of docs) {
    if (doc.errors.length > 0 || doc.warnings.length > 0 || hasDuplicateKey(doc)) return null;
    if (doc.contents === null) continue;
    roots.push(conv(doc.contents, 1));
  }
  return refused ? null : roots;
}

/** CSV (RFC 4180: commas, double quotes, "" inside quotes, newlines inside quotes) with line numbers. */
function parseCsvRows(text: string): { cells: string[]; line: number; endLine: number }[] | null {
  const rows: { cells: string[]; line: number; endLine: number }[] = [];
  let i = 0;
  let line = 1;
  const n = text.length;
  while (i < n) {
    const start = line;
    const cells: string[] = [];
    for (;;) {
      let cell = "";
      if (text[i] === '"') {
        i++;
        for (;;) {
          if (i >= n) return null;
          if (text[i] === '"') {
            if (text[i + 1] === '"') {
              cell += '"';
              i += 2;
              continue;
            }
            i++;
            break;
          }
          if (text[i] === "\n") line++;
          cell += text[i++];
        }
        if (i < n && text[i] !== "," && text[i] !== "\n" && !(text[i] === "\r" && text[i + 1] === "\n")) return null;
      } else {
        while (i < n && text[i] !== "," && text[i] !== "\n") cell += text[i++];
        if (cell.endsWith("\r") && (i >= n || text[i] === "\n")) cell = cell.slice(0, -1);
        if (cell.includes('"')) return null;
      }
      cells.push(cell);
      if (text[i] === "\r") i++;
      if (i < n && text[i] === ",") {
        i++;
        continue;
      }
      break;
    }
    rows.push({ cells, line: start, endLine: line });
    if (i < n && text[i] === "\n") {
      i++;
      line++;
    }
  }
  return rows.filter((r) => !(r.cells.length === 1 && r.cells[0] === ""));
}

/** Parse one data file whole, or null. */
export function parseDataFile(file: string, lines: readonly string[]): ParsedDataFile | null {
  const format = SUMMARY_FORMATS[posix.extname(file).toLowerCase()];
  if (!format) return null;
  const text = lines.join("\n");
  const openers = new Set<number>();
  if (format === "JSON") {
    const root = parseJsonTree(text);
    if (!root) return null;
    const records = recordsOfRoots(file, [root], openers);
    return { format, records, leavesByLine: indexLeaves(records), openers, recordAt: recordIndex(records) };
  }
  if (format === "YAML") {
    const roots = parseYamlTrees(text);
    if (!roots || roots.length === 0) return null;
    const records = recordsOfRoots(file, roots, openers);
    return { format, records, leavesByLine: indexLeaves(records), openers, recordAt: recordIndex(records) };
  }
  const rows = parseCsvRows(text);
  if (!rows || rows.length < 2) return null;
  const header = rows[0].cells;
  const seen = new Map<string, number>();
  const columns = header.map((h, c) => {
    const name = h.trim() === "" ? `#${c + 1}` : h;
    const k = (seen.get(name) ?? 0) + 1;
    seen.set(name, k);
    return k > 1 ? `${name}#${k}` : name;
  });
  const records: DataRecord[] = rows.slice(1).map((row, index) => {
    const leaves: Leaf[] = row.cells.map((cell, c) => {
      const path = c < columns.length ? columns[c] : `#${c + 1}`;
      return { path, concrete: path, type: "string" as const, text: cell, line: row.line, endLine: row.endLine };
    });
    const fields = new Map<string, string>();
    for (const l of leaves) fields.set(l.path, l.text);
    const structure = [...new Set(leaves.map((l) => `${l.path}:string`))].sort().join("\n");
    return { file, index, line: row.line, endLine: row.endLine, leaves, structure, fields };
  });
  return { format, records, leavesByLine: indexLeaves(records), openers, columns, recordAt: recordIndex(records) };
}

// ---------------------------------------------------------------------------------------------------------------------
// The value tests (rules 3, 4, 5).

/**
 * RULE 4 - SUBSTITUTION SYNTAX, A PRINCIPLE AND NOT A LIST: any construct whose text stands for a value that is filled in
 * elsewhere. The forms below are the ones that construct takes in the template languages, URI templates, shells, format
 * strings and route patterns of the corpus; a doubt is a window.
 */
const SUBSTITUTION: readonly RegExp[] = [
  /\$\{/, // ${...}  shell, JS template literal, many config loaders
  /\{\{/, // {{...}} Mustache, Handlebars, Jinja, Go templates
  /\{%/, // {%...%} Jinja, Liquid
  /<%/, // <%...%> ERB, EJS
  /%\{/, // %{...}  Ruby i18n, rails
  /\$\(/, // $(...)  shell, Azure pipelines, make
  /#\{/, // #{...}  Ruby, Sass
  /@\{/, // @{...}
  /\{[^{}\s"':,]{0,64}\}/, // {name}, {/other_user}, {?q}, {0}: single-brace macros and URI templates
  /\[\[[^\]]*\]\]/, // [[...]]
  /%\(?[A-Za-z_][\w.]*\)?[sdif]\b/, // %(name)s, %s-style named format
  /%-?\d*(?:\.\d+)?[sdifx]\b/, // printf %s %d %5.2f
  /%\d+\$[sd]/, // %1$s
  /%[A-Z_][A-Z0-9_]*%/, // %VAR% (Windows), @VAR@
  /@[A-Z_][A-Z0-9_]*@/,
  /\$[A-Za-z_][A-Za-z0-9_]*/, // $VAR, $name
  /(?:^|[/=&?]):[A-Za-z_]\w*/, // :param in a route or a query
  /<[A-Za-z_][\w.-]*>/, // <placeholder>
];
export function hasSubstitutionSyntax(value: string): boolean {
  return SUBSTITUTION.some((re) => re.test(value));
}

/**
 * RULE 3 - every URL in a value: one with a query string, a fragment or userinfo, or one that cannot be parsed, sends
 * the place to its window. A relative reference with a query string (`/i?ssp=1&gdpr=1`) or a bare query string counts.
 */
export function hasUrlQueryFragmentOrUserinfo(value: string): boolean {
  const urls = value.match(/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>]*/g) ?? [];
  for (const raw of urls) {
    if (/[?#]/.test(raw)) return true;
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return true;
    }
    if (u.username !== "" || u.password !== "" || /@/.test(raw.replace(/^[^:]+:\/\//, "").split("/")[0])) return true;
  }
  if (/(?:^|[\s"'(=])\/\/[^\s"'<>]+/.test(value) && /[?#@]/.test(value)) return true;
  if (/\?[^\s=&]+=/.test(value)) return true;
  if (/^[./]?[\w./-]*\/[\w./-]*#/.test(value)) return true;
  return false;
}

/** Keys whose values are code, scripts, commands or queries whatever they look like (rule 5, R12). */
const CODE_KEYS = /^(?:run|script|scripts|exec|jscode|js_code|code|functioncode|function|command|commands|cmd|shell|sql|query|expression|expr|eval|template|formula|handler|source|before_script|after_script|prebuild|postbuild)$/i;
/** Code syntax inside a string value (rule 5: code in data's clothing). */
const CODE_SYNTAX: readonly RegExp[] = [
  /[A-Za-z_$][\w$.]*\([^)]*\)/, // a call (a name touching its parenthesis; "Notes (desktop)" is prose)
  /=>/,
  /;\s*$/,
  /`/,
  /\b(?:function|return|const|let|var|import|require|await|async|lambda|def|echo|curl|wget|sudo|npm|yarn|pip|SELECT|INSERT|UPDATE|DELETE)\b/,
  /\|\||&&/,
  /\b(?:pm|console|document|window|process)\./,
];
export function readsAsCode(key: string, value: string): boolean {
  const last = key.replace(/\[\]$/g, "").split(/[.[\]"]+/).filter((s) => s !== "").pop() ?? "";
  if (CODE_KEYS.test(last)) return true;
  return CODE_SYNTAX.some((re) => re.test(value));
}

/** The first rule of 3, 4 and 5 a value breaks, or null. Applied to every value a matched line holds. */
export function valueWindowReason(key: string, leaf: Pick<Leaf, "type" | "text">): SummaryWindowReason | null {
  if (leaf.type !== "string") return null;
  const v = leaf.text;
  if (v.length > SUMMARY_VALUE_MAX_CHARS || /[\r\n]/.test(v)) return "long_or_multiline_value";
  if (hasSubstitutionSyntax(v)) return "substitution_syntax";
  if (hasUrlQueryFragmentOrUserinfo(v)) return "url_query_fragment_userinfo";
  if (readsAsCode(key, v)) return "code_in_value";
  return null;
}

/** Rule 8: a translation file, by its directory or its name (wider than the fact test's catalogue: the safe side). */
export function isTranslationFile(file: string): boolean {
  const parts = file.toLowerCase().split("/");
  const dirs = new Set<string>([...LOCALE_DIRECTORIES, "messages", "intl", "langs", "languages", "nls", "strings", "translation", "localization", "localisation", "localizations"]);
  if (parts.slice(0, -1).some((p) => dirs.has(p) || /^[a-z]{2,3}(?:[-_][a-z0-9]{2,4})?\.lproj$/.test(p))) return true;
  const base = parts[parts.length - 1].replace(/\.[^.]+$/, "");
  return /^(?:[a-z]{2,3}(?:[-_][a-z0-9]{2,4})?|messages?(?:[-_.][a-z]{2,3}(?:[-_][a-z0-9]{2,4})?)?|translations?(?:[-_.].*)?|i18n(?:[-_.].*)?|locale(?:[-_.].*)?|strings(?:[-_.].*)?)$/.test(base);
}

// ---------------------------------------------------------------------------------------------------------------------
// Shapes of values beside the matched key paths (item 3, R6).

const NAME_SHAPES: readonly [RegExp, string][] = [
  [/^(?:login|username|user_name|username_|userlogin|user_login|handle|nickname|nick|screen_name|screenname|account|account_name)$/i, "username (by key name)"],
  [/^(?:e?mail|email_address|emailaddress|e_mail|mail_address)$/i, "e-mail (by key name)"],
  [/^(?:phone|phone_number|phonenumber|tel|telephone|mobile|cell|msisdn)$/i, "phone (by key name)"],
  [/^(?:ip|ip_address|ipaddress|remote_addr|remote_ip|client_ip)$/i, "IP address (by key name)"],
  [/^(?:name|first_?name|last_?name|full_?name|display_?name|given_?name|family_?name|surname|author|real_?name)$/i, "name (by key name)"],
  [/^(?:address|street|street_address|city|zip|zipcode|zip_code|postcode|postal_code|country)$/i, "address (by key name)"],
  [/^(?:id|uid|uuid|guid|node_id|user_?id|account_?id|customer_?id|member_?id|device_?id|[a-z]+_id|[a-z]+Id)$/, "identifier (by key name)"],
  [/^(?:dob|birth|birthday|birth_?date|date_of_birth|age)$/i, "birth date or age (by key name)"],
  [/^(?:lat|lng|lon|latitude|longitude|location|geo|coordinates)$/i, "location (by key name)"],
  [/^(?:token|secret|password|passwd|api_?key|access_?token|refresh_?token|private_?key|client_?secret)$/i, "secret (by key name)"],
  [/^(?:avatar|avatar_url|gravatar_id|photo|picture|image_url)$/i, "picture of a person (by key name)"],
];
const PERSONAL_QUERY_KEYS = /^(?:e?mail|user|user_?id|uid|id|login|name|phone|token|ip|gdpr|gdpr_consent|us_privacy|gpp|gpp_sid|consent|redirect|redirect_url|surl|ref|referrer|device_?id|advertising_?id|idfa|gaid)$/i;

function shapesOf(path: string, leaf: Leaf, record: DataRecord): string[] {
  const out: string[] = [];
  const last = path.replace(/\[\]/g, "").split(/[.[\]"]+/).filter((s) => s !== "").pop() ?? "";
  for (const [re, shape] of NAME_SHAPES) if (re.test(last)) out.push(shape);
  const v = leaf.text;
  if (leaf.type === "number") {
    if (/^-?\d{5,}$/.test(v)) out.push("identifier-like number (by value)");
    return out;
  }
  if (leaf.type !== "string" || v === "") return out;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) out.push("e-mail (by value)");
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(v) || (/^[0-9a-f:]+$/i.test(v) && (v.match(/:/g) ?? []).length >= 2)) out.push("IP address (by value)");
  if (/^\+\d[\d\s().-]{6,}$/.test(v) || /^\(?\d{2,4}\)?[\s.-]\d{2,4}[\s.-]\d{3,4}$/.test(v)) out.push("phone (by value)");
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(v)) {
    let personal = false;
    try {
      const u = new URL(v);
      for (const k of u.searchParams.keys()) if (PERSONAL_QUERY_KEYS.test(k)) personal = true;
    } catch {
      personal = true;
    }
    for (const [p, f] of record.fields) {
      if (p === path || f.length < SUMMARY_PATTERN_FIELD_MIN_CHARS) continue;
      const lastOf = p.split(".").pop() ?? "";
      if (!NAME_SHAPES.slice(0, 7).some(([re]) => re.test(lastOf))) continue;
      if (tokenIndex(v, f, 0) >= 0) personal = true;
    }
    out.push(personal ? "URL with a personal parameter (by value)" : "URL (by value)");
  }
  if (v.length > 80 && /\s/.test(v)) out.push("long free text (by value)");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) || /^[0-9a-f]{16,}$/i.test(v) || (/^[A-Za-z0-9_=-]{12,}$/.test(v) && /\d/.test(v) && /[A-Za-z]/.test(v)) || /^\d{5,}$/.test(v)) {
    out.push("identifier-like (by value)");
  }
  if (/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/.test(v)) out.push("date-time (by value)");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Patterns (item 2): every part equal to another field of the same record written `<<field>>`, the rest literal.

/** The first index of `needle` in `hay` at or after `from` where it stands as a token (no letter or digit on either side). */
function tokenIndex(hay: string, needle: string, from: number): number {
  for (let at = hay.indexOf(needle, from); at >= 0; at = hay.indexOf(needle, at + 1)) {
    const before = at === 0 ? "" : hay[at - 1];
    const after = hay[at + needle.length] ?? "";
    if (!/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after)) return at;
  }
  return -1;
}

type Part = { lit: string } | { field: string };

function templateOf(value: string, own: string, record: DataRecord): Part[] | null {
  if (value.includes("<<") || value.includes(">>")) return null;
  const fields = [...record.fields]
    .filter(([p, f]) => p !== own && f.length >= SUMMARY_PATTERN_FIELD_MIN_CHARS)
    .sort((a, b) => b[1].length - a[1].length || a[0].length - b[0].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  let parts: Part[] = [{ lit: value }];
  for (const [path, f] of fields) {
    const next: Part[] = [];
    for (const part of parts) {
      if (!("lit" in part)) {
        next.push(part);
        continue;
      }
      let rest = part.lit;
      for (let at = tokenIndex(rest, f, 0); at >= 0; at = tokenIndex(rest, f, 0)) {
        if (at > 0) next.push({ lit: rest.slice(0, at) });
        next.push({ field: path });
        rest = rest.slice(at + f.length);
      }
      if (rest !== "") next.push({ lit: rest });
    }
    parts = next;
  }
  return parts.some((p) => "field" in p) ? parts : null;
}

const templateText = (parts: Part[]): string => parts.map((p) => ("lit" in p ? p.lit : `<<${p.field}>>`)).join("");
/** THE VERIFICATION: the template filled with the record's own fields is the value, character for character. */
const fill = (parts: Part[], record: DataRecord): string | null => {
  let out = "";
  for (const p of parts) {
    if ("lit" in p) out += p.lit;
    else {
      const f = record.fields.get(p.field);
      if (f === undefined) return null;
      out += f;
    }
  }
  return out;
};

// ---------------------------------------------------------------------------------------------------------------------
// The summary.

export interface DataSummary {
  id: string;
  rule_id: string;
  read_as: string;
  format: "JSON" | "YAML" | "CSV";
  directory: string;
  extension: string;
  files: string[];
  records: number;
  records_matched: number;
  places: string;
  place_count: number;
  columns?: string[];
  common_structure: { records_sharing: number; of_records: number; key_paths: { path: string; type: string; records: number }[] };
  differing_records: { file: string; record: number; lines: [number, number]; differs: { only_in_this_record: string[]; missing_here: string[] }; places: string; text: string }[];
  matched_key_paths: {
    path: string;
    types: string[];
    places: number;
    values: { value: string; count: number }[];
    patterns: { pattern: string; reproduces: number }[];
  }[];
  beside: { path: string; types: string[]; records: number; shapes: { shape: string; records: number }[]; examples: string[] }[];
  verbatim: { chosen: "first" | "last" | "seeded"; file: string; record: number; lines: [number, number]; text: string }[];
  not_summarized: { reason: SummaryWindowReason; why: string; count: number; places: string }[];
}

export interface SummaryPlan {
  /** Each summary with the places it covers (the candidate's own location objects). */
  summaries: { summary: DataSummary; locations: FindingLocation[] }[];
  /** Every place of a data file group that no summary covers, with the program's reason (it is windowed, or a fact). */
  notSummarized: Map<FindingLocation, SummaryWindowReason>;
}

/** `P3-P7,P9`: place ids as ascending runs. */
export function placeRanges(ids: readonly number[]): string {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(j > i ? `${placeId(sorted[i]!)}-${placeId(sorted[j]!)}` : placeId(sorted[i]!));
    i = j + 1;
  }
  return out.join(",");
}

/** The bytes a summary takes in a payload (`JSON.stringify(payload, null, 2)` at `candidates[].summaries[]`). */
export function summaryPayloadBytes(summary: DataSummary): number {
  const text = JSON.stringify(summary, null, 2);
  const newlines = (text.match(/\n/g) ?? []).length;
  return Buffer.byteLength(text, "utf8") + newlines * PAYLOAD_DEPTH_SPACES;
}

const fnv = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
};
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const clip = (v: string): string => (v.length > SUMMARY_VALUE_MAX_CHARS ? `${v.slice(0, SUMMARY_VALUE_MAX_CHARS)} ... (first ${SUMMARY_VALUE_MAX_CHARS} of ${v.length} characters)` : v);

interface Seen {
  loc: FindingLocation;
  id: number;
  record?: DataRecord;
  leaves?: Leaf[];
}

/**
 * THE SUMMARIES OF ONE CANDIDATE. `placeIndex` is the place's position in the candidate's `locations` (its id `P<n>`).
 * `parsed` caches parsed files across candidates (one parse per file per write). Pure: reads only through `readLines`.
 */
export function summarizeCandidate(args: {
  candidate: Candidate;
  readLines: (file: string) => string[] | null;
  isTranscoded?: (file: string) => boolean;
  parsed?: Map<string, ParsedDataFile | null>;
}): SummaryPlan {
  const { candidate, readLines } = args;
  const isTranscoded = args.isTranscoded ?? (() => false);
  const parsedCache = args.parsed ?? new Map<string, ParsedDataFile | null>();
  const notSummarized = new Map<FindingLocation, SummaryWindowReason>();
  const summaries: SummaryPlan["summaries"] = [];

  const groups = new Map<string, Seen[]>();
  candidate.locations.forEach((loc, id) => {
    const ext = posix.extname(loc.file).toLowerCase();
    if (!SUMMARY_FORMATS[ext]) return;
    const key = `${posix.dirname(loc.file)}\u0000${ext}`;
    const list = groups.get(key);
    if (list) list.push({ loc, id });
    else groups.set(key, [{ loc, id }]);
  });

  const parse = (file: string): ParsedDataFile | null => {
    if (!parsedCache.has(file)) {
      const lines = readLines(file);
      parsedCache.set(file, lines && lines.length > 0 ? parseDataFile(file, lines) : null);
    }
    return parsedCache.get(file) ?? null;
  };

  for (const key of [...groups.keys()].sort(byText)) {
    const all = groups.get(key)!;
    const [directory, extension] = key.split("\u0000");
    const send = (places: Seen[], reason: SummaryWindowReason): void => {
      for (const p of places) notSummarized.set(p.loc, reason);
    };
    // Rule 6 first where the group cannot reach 20 at all, so a small group costs no parse.
    if (all.length < SUMMARY_MIN_PLACES) {
      send(all, "group_under_20");
      continue;
    }
    // Rule 8, facts, transcoded files, files not parsed whole, lines that are not one key and one value.
    const readable: Seen[] = [];
    const factOf = new Map<string, ReturnType<typeof placeFactsFor>>();
    for (const p of all) {
      const file = p.loc.file;
      if (isTranslationFile(file)) {
        notSummarized.set(p.loc, "translation_file");
        continue;
      }
      // Read first: the writer learns whether a file is transcoded when it reads it.
      const lines = readLines(file);
      if (!lines) {
        notSummarized.set(p.loc, "not_parsed");
        continue;
      }
      if (isTranscoded(file)) {
        notSummarized.set(p.loc, "transcoded");
        continue;
      }
      if (!factOf.has(file)) factOf.set(file, placeFactsFor(file, lines, false));
      const end = p.loc.end_line ?? p.loc.start_line;
      if (factOf.get(file)!(p.loc.start_line, end)) {
        notSummarized.set(p.loc, "fact");
        continue;
      }
      const doc = parse(file);
      if (!doc) {
        notSummarized.set(p.loc, "not_parsed");
        continue;
      }
      const line = p.loc.start_line;
      const record = doc.recordAt(line);
      const here = doc.leavesByLine.get(line) ?? [];
      let leaves: Leaf[] | null = null;
      if (end === line && record) {
        if (doc.format === "CSV") leaves = record.line === line && record.endLine === line ? record.leaves : null;
        else if (here.length === 1 && here[0].endLine === line && !here[0].comment && !doc.openers.has(line)) leaves = here;
      }
      if (record) p.record = record;
      if (!leaves) {
        notSummarized.set(p.loc, "not_key_value");
        continue;
      }
      p.leaves = leaves;
      readable.push(p);
    }

    // RULE 1: the records the group's places sit in; the common structure is the one at least half of them have exactly.
    const touched = [...new Set(all.map((p) => p.record).filter((r): r is DataRecord => r !== undefined))];
    const byStructure = new Map<string, DataRecord[]>();
    for (const r of touched) {
      const list = byStructure.get(r.structure);
      if (list) list.push(r);
      else byStructure.set(r.structure, [r]);
    }
    const modal = [...byStructure.entries()].sort((a, b) => b[1].length - a[1].length || byText(a[0], b[0]))[0];
    if (!modal || modal[1].length * 2 < touched.length) {
      send(readable, "no_majority_structure");
      continue;
    }
    const common = modal[0];
    const differing = touched.filter((r) => r.structure !== common);
    const kept: Seen[] = [];
    for (const p of readable) {
      if (p.record!.structure !== common) {
        notSummarized.set(p.loc, "differing_record");
        continue;
      }
      // RULES 3, 4, 5 on every value the matched line holds.
      let reason: SummaryWindowReason | null = null;
      for (const leaf of p.leaves!) {
        reason = valueWindowReason(leaf.path, leaf);
        if (reason) break;
      }
      if (reason) notSummarized.set(p.loc, reason);
      else kept.push(p);
    }

    // ITEM 2: every value at every matched key path, whole (up to 50 distinct) or as a verified pattern.
    const byPath = new Map<string, { p: Seen; leaf: Leaf }[]>();
    for (const p of kept) {
      for (const leaf of p.leaves!) {
        const list = byPath.get(leaf.path);
        if (list) list.push({ p, leaf });
        else byPath.set(leaf.path, [{ p, leaf }]);
      }
    }
    const pastCap = new Set<Seen>();
    const matched: DataSummary["matched_key_paths"] = [];
    for (const path of [...byPath.keys()].sort(byText)) {
      const occ = byPath.get(path)!;
      const counts = new Map<string, number>();
      for (const o of occ) counts.set(o.leaf.text, (counts.get(o.leaf.text) ?? 0) + 1);
      const types = [...new Set(occ.map((o) => o.leaf.type))].sort();
      const order = (m: Map<string, number>): [string, number][] => [...m.entries()].sort((a, b) => b[1] - a[1] || byText(a[0], b[0]));
      if (counts.size <= SUMMARY_WHOLE_VALUES_MAX) {
        matched.push({ path, types, places: occ.length, values: order(counts).map(([value, count]) => ({ value, count })), patterns: [] });
        continue;
      }
      const tmpl = new Map<string, { parts: Part[]; occ: typeof occ }>();
      const loose: typeof occ = [];
      for (const o of occ) {
        const parts = templateOf(o.leaf.text, o.leaf.concrete, o.p.record!);
        if (parts && fill(parts, o.p.record!) === o.leaf.text) {
          const t = templateText(parts);
          const entry = tmpl.get(t);
          if (entry) entry.occ.push(o);
          else tmpl.set(t, { parts, occ: [o] });
        } else loose.push(o);
      }
      const patterns: { pattern: string; reproduces: number }[] = [];
      for (const [t, e] of tmpl) {
        // A pattern stands only where it reproduces at least two values, each verified again here.
        if (e.occ.length >= 2 && e.occ.every((o) => fill(e.parts, o.p.record!) === o.leaf.text)) patterns.push({ pattern: t, reproduces: e.occ.length });
        else loose.push(...e.occ);
      }
      patterns.sort((a, b) => b.reproduces - a.reproduces || byText(a.pattern, b.pattern));
      const looseCounts = new Map<string, number>();
      for (const o of loose) looseCounts.set(o.leaf.text, (looseCounts.get(o.leaf.text) ?? 0) + 1);
      const listed = order(looseCounts).slice(0, SUMMARY_WHOLE_VALUES_MAX);
      const listedSet = new Set(listed.map(([v]) => v));
      for (const o of loose) if (!listedSet.has(o.leaf.text)) pastCap.add(o.p);
      matched.push({ path, types, places: occ.length, values: listed.map(([value, count]) => ({ value, count })), patterns });
    }
    const summarized = kept.filter((p) => !pastCap.has(p));
    for (const p of pastCap) notSummarized.set(p.loc, "values_past_cap");
    if (pastCap.size > 0) {
      // A path's values are recounted over what stays, so the summary never counts a windowed place.
      const stay = new Set(summarized);
      for (const m of matched) {
        const occ = (byPath.get(m.path) ?? []).filter((o) => stay.has(o.p));
        m.places = occ.length;
        const keep = new Map<string, number>();
        for (const o of occ) keep.set(o.leaf.text, (keep.get(o.leaf.text) ?? 0) + 1);
        m.values = m.values.filter((v) => keep.has(v.value)).map((v) => ({ value: v.value, count: keep.get(v.value)! }));
      }
    }

    // RULE 6 on what is left.
    if (summarized.length < SUMMARY_MIN_PLACES) {
      send(summarized, "group_under_20");
      continue;
    }

    // ITEM 3: every other key path of the summarized records, with value shapes and examples.
    const records = [...new Set(summarized.map((p) => p.record!))].sort((a, b) => byText(a.file, b.file) || a.index - b.index);
    const matchedPaths = new Set(matched.map((m) => m.path));
    const beside: DataSummary["beside"] = [];
    const besidePaths = new Map<string, { types: Set<string>; records: Set<DataRecord>; shapes: Map<string, Set<DataRecord>>; examples: string[] }>();
    for (const r of records) {
      for (const leaf of r.leaves) {
        if (matchedPaths.has(leaf.path)) continue;
        let e = besidePaths.get(leaf.path);
        if (!e) {
          e = { types: new Set(), records: new Set(), shapes: new Map(), examples: [] };
          besidePaths.set(leaf.path, e);
        }
        e.types.add(leaf.type);
        e.records.add(r);
        for (const s of shapesOf(leaf.path, leaf, r)) {
          const set = e.shapes.get(s) ?? new Set<DataRecord>();
          set.add(r);
          e.shapes.set(s, set);
        }
        const ex = clip(leaf.text);
        if (e.examples.length < SUMMARY_EXAMPLES_MAX && !e.examples.includes(ex)) e.examples.push(ex);
      }
    }
    for (const path of [...besidePaths.keys()].sort(byText)) {
      const e = besidePaths.get(path)!;
      beside.push({
        path,
        types: [...e.types].sort(),
        records: e.records.size,
        shapes: [...e.shapes.entries()].map(([shape, rs]) => ({ shape, records: rs.size })).sort((a, b) => b.records - a.records || byText(a.shape, b.shape)),
        examples: e.examples,
      });
    }

    // ITEM 4 and item 1's listing: records verbatim, every differing record in full.
    const textOf = (r: DataRecord): string => (readLines(r.file) ?? []).slice(r.line - 1, r.endLine).join("\n");
    const seeded = records.length > 0 ? fnv(`${candidate.rule_id}\u0000${directory}\u0000${extension}`) % records.length : 0;
    const picks: [DataSummary["verbatim"][number]["chosen"], number][] = [["first", 0], ["last", records.length - 1], ["seeded", seeded]];
    const verbatim: DataSummary["verbatim"] = [];
    const picked = new Set<number>();
    for (const [chosen, at] of picks) {
      if (picked.has(at) || verbatim.length >= SUMMARY_VERBATIM_RECORDS) continue;
      picked.add(at);
      const r = records[at];
      verbatim.push({ chosen, file: posix.basename(r.file), record: r.index, lines: [r.line, r.endLine], text: textOf(r) });
    }
    const commonPairs = new Set(common.split("\n"));
    const idsByRecord = new Map<DataRecord, number[]>();
    for (const p of all) {
      if (!p.record) continue;
      const list = idsByRecord.get(p.record);
      if (list) list.push(p.id);
      else idsByRecord.set(p.record, [p.id]);
    }
    const placesOfRecord = (r: DataRecord): number[] => idsByRecord.get(r) ?? [];
    const differingRecords: DataSummary["differing_records"] = differing
      .sort((a, b) => byText(a.file, b.file) || a.index - b.index)
      .map((r) => {
        const own = new Set(r.structure.split("\n"));
        return {
          file: posix.basename(r.file),
          record: r.index,
          lines: [r.line, r.endLine],
          differs: { only_in_this_record: [...own].filter((x) => !commonPairs.has(x)), missing_here: [...commonPairs].filter((x) => !own.has(x)) },
          places: placeRanges(placesOfRecord(r)),
          text: textOf(r),
        };
      });
    const pairCount = new Map<string, number>();
    for (const r of touched) for (const pair of r.structure.split("\n")) pairCount.set(pair, (pairCount.get(pair) ?? 0) + 1);

    const summarizedSet = new Set(summarized.map((p) => p.loc));
    const rest = all.filter((p) => !summarizedSet.has(p.loc));
    const byReason = new Map<SummaryWindowReason, number[]>();
    for (const p of rest) {
      const reason = notSummarized.get(p.loc)!;
      const list = byReason.get(reason) ?? [];
      list.push(p.id);
      byReason.set(reason, list);
    }
    const doc = parse(summarized[0].loc.file)!;
    const summary: DataSummary = {
      id: `S${summaries.length + 1}`,
      rule_id: candidate.rule_id,
      read_as: `a summary the program verified over every record (${records.length} records)`,
      format: doc.format,
      directory,
      extension,
      files: [...new Set(records.map((r) => posix.basename(r.file)))].sort(byText),
      records: records.length,
      records_matched: touched.length,
      places: placeRanges(summarized.map((p) => p.id)),
      place_count: summarized.length,
      ...(doc.columns ? { columns: doc.columns } : {}),
      common_structure: {
        records_sharing: modal[1].length,
        of_records: touched.length,
        key_paths: [...commonPairs].map((pair) => {
          const at = pair.lastIndexOf(":");
          return { path: pair.slice(0, at), type: pair.slice(at + 1), records: pairCount.get(pair) ?? 0 };
        }),
      },
      differing_records: differingRecords,
      matched_key_paths: matched,
      beside,
      verbatim,
      not_summarized: SUMMARY_WINDOW_REASONS.filter((r) => byReason.has(r)).map((reason) => ({
        reason,
        why: SUMMARY_WINDOW_REASON_TEXT[reason],
        count: byReason.get(reason)!.length,
        places: placeRanges(byReason.get(reason)!),
      })),
    };
    // RULE 7: the ceiling, measured as the payload will hold it.
    if (summaryPayloadBytes(summary) > SUMMARY_MAX_BYTES) {
      send(summarized, "summary_over_ceiling");
      continue;
    }
    summaries.push({ summary, locations: summarized.map((p) => p.loc) });
  }
  return { summaries, notSummarized };
}
