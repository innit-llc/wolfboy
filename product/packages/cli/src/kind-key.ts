/**
 * THE SAME-KIND LINE GROUP KEY — the one derivation, in the product, of the key layer 2 reads by.
 *
 * A candidate that carries more matched locations than one seat reads is not cut into parts any
 * more: the scanner
 * groups its locations into SAME-KIND LINE GROUPS and layer 2 reads one representative per group.
 * This file computes the key those groups are formed on, and nothing else: it forms no group, reads
 * no document and decides nothing about any rule. `kind-census.ts` groups with it, and the engine
 * calls it once per candidate, where the line's own text is still in hand.
 *
 * ## The key
 *
 * `rule id` + `the fired clause set` + `the folded matched token(s)` + `the syntactic context class`
 * — the L2 key of an internal record, spelled exactly as
 * an internal record spells it (its line 732 names the key and its
 * line 1063 names the three components). Beside it travels the L1 SUB-SHAPE: the whole line with
 * everything outside the matched spans folded, kept as a 16-hex digest, which says how homogeneous a
 * group is.
 *
 * ## THE ORACLE, AND WHICH WAY ROUND IT IS
 *
 * `cell-digest.mjs` measured 806 (rule x repository) cells of the 169-tree corpus pass at this key —
 * 1,139,261 matched lines in 169,613 groups — and the design's whole cost case rests on those
 * counts. **That measurement is the oracle and this file must reproduce it, never the other way
 * round.** A test holds the two against each other on recorded cells and goes
 * red on the first group that differs.
 *
 * ## Why this is a PORT and not an import
 *
 * The functions below are the normaliser region of an internal record
 * — the region `cell-digest.mjs` extracts at run time and pins by sha256, so the two cannot drift.
 * an internal record never enters the public monorepo and the product may not depend on it, so the region is
 * ported here instead of imported, and the pin is carried below for the same reason it exists there:
 * a change to that file must be READ, not absorbed. The gate holds the port to the region it was
 * taken from, function by function, on real matched lines; the pin makes the edit loud, the gate
 * makes the divergence red.
 *
 * SHAPE_REGION_SHA256 = 01f295c2a7fb131381d5c8fcf71ef26df3334c29bc60ba6bbbf911a275eafa84.
 */
import { createHash } from "node:crypto";
import { extname, basename } from "node:path";

/** The 16-hex digest the sub-shape is kept as — `cell-digest.mjs`'s `sha16`. */
export function sha16(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------- text helpers

const CTRL = new RegExp("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]", "g");

/** Control bytes to spaces and tabs to spaces, so a key is printable. Never a truncation. */
export function clean(s: string): string {
  return s.replace(CTRL, " ").split("\t").join(" ");
}

/**
 * Interiors of quoted string literals on one line. Approximate by design: one line at a time, no
 * cross-line templates, no language table. It decides a CLASS LABEL and a normalisation, never a
 * candidate.
 */
export function stringRanges(line: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const start = i + 1;
      let j = start;
      while (j < line.length) {
        if (line[j] === "\\") {
          j += 2;
          continue;
        }
        if (line[j] === ch) break;
        j++;
      }
      if (j >= line.length) {
        // Unterminated on this line: treat the rest of the line as interior.
        out.push([start, line.length]);
        return out;
      }
      out.push([start, j]);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

const inRanges = (ranges: [number, number][], a: number, b: number): boolean =>
  ranges.some(([s, e]) => a >= s && b <= e);

/** True when the span was blanked by `contentForGuards`, i.e. it sits in a comment. */
export function spanIsComment(raw: string, code: string, a: number, b: number): boolean {
  if (code === raw || code.length !== raw.length) return false;
  for (let i = a; i < b; i++) {
    if (raw[i] !== " " && code[i] === " ") return true;
  }
  return false;
}

// ---------------------------------------------------------------- context classes
//
// Derived from the data, in this order; the first that fits wins. The order matters twice: a
// comment beats every syntactic reading (the text is prose whatever it looks like), and the
// file-kind classes beat "string literal", because a translation value and a dependency name are
// string literals in every file that carries them and calling them that would say nothing.
export const CONTEXT_CLASSES = [
  "comment",
  "prose-doc",
  "translation-entry",
  "manifest-entry",
  "lockfile-entry",
  "config-entry",
  "sql",
  "css-declaration",
  "import-specifier",
  "html-attribute",
  "string-literal",
  "declaration",
  "call",
  "object-key-or-param",
  "member-access",
  "identifier-use",
  "other",
] as const;

export type ContextClass = (typeof CONTEXT_CLASSES)[number];

export const DOC_EXT = new Set([".md", ".markdown", ".txt", ".rst", ".adoc", ".mdx"]);
const CSS_EXT = new Set([".css", ".scss", ".less", ".sass", ".styl"]);
const CONFIG_EXT = new Set([".yml", ".yaml", ".toml", ".ini", ".cfg", ".conf", ".env", ".properties"]);
export const MANIFEST_NAMES = new Set([
  "package.json",
  "composer.json",
  "Gemfile",
  "requirements.txt",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "build.gradle",
  "pom.xml",
  "bower.json",
]);
export const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "composer.lock",
  "Gemfile.lock",
  "Cargo.lock",
  "poetry.lock",
  "go.sum",
]);

export const LOCALE_DIR = /(^|\/)(locales?|i18n|translations?|lang|langs|messages|intl)(\/|$)/i;
export const LOCALE_FILE = /^[a-z]{2}([-_][A-Za-z]{2,4})?\.(json|ya?ml|po|pot|properties|ts|js)$/;

const KEYWORDS = new Set([
  "const", "let", "var", "function", "class", "def", "interface", "type", "enum", "struct", "impl",
  "fn", "func", "val", "public", "private", "protected", "static", "readonly", "export", "import",
  "return", "await", "async", "new", "if", "for", "while",
]);

// An import/require construct, spelled by its own syntax rather than by the bare word: a line that
// merely contains the word "from" inside a sentence is not an import.
const IMPORT_RE =
  /(^\s*(import|export)\b[^;]*\bfrom\s*['"`])|(^\s*import\s*\(?\s*['"`])|(\brequire(_once)?\s*\(\s*['"`])|(\bimport\s*\(\s*['"`])|(^\s*from\s+[\w.]+\s+import\b)|(^\s*import\s+[\w.]+)|(^\s*use\s+[\w\\]+)|(^\s*#include)|(^\s*@import\b)|(\bimportScripts\s*\()/;

/**
 * Trim a matched span to the identifier / path token it is about, then widen it to that token's own
 * boundaries. A clause regex usually carries a boundary character on one or both sides
 * (`(?:^|[^A-Za-z0-9])`) and often the opening bracket of the call it looks for, so the raw span's
 * edges are the pattern's and not the code's; the class has to be read off the code's.
 */
const TOKEN_CH = /[A-Za-z0-9_.\-/@:$\\]/;
export function tokenSpan(line: string, span: [number, number] | null): [number, number] | null {
  if (!span) return null;
  const [a, b] = span;
  let i = a;
  while (i < b && !/[A-Za-z0-9_$]/.test(line[i])) i++;
  if (i >= b) i = a;
  let s = i;
  let e = i + 1;
  while (s > 0 && TOKEN_CH.test(line[s - 1])) s--;
  while (e < line.length && TOKEN_CH.test(line[e])) e++;
  // A trailing `:` `.` `/` belongs to the syntax around the token, not to the token: `username:` is
  // the key `username` followed by the colon that makes it a declaration, and reading the colon as
  // part of the name hides exactly that.
  while (e - 1 > s && /[.:/@\-\\]/.test(line[e - 1])) e--;
  while (s < e - 1 && /[.:/@\-\\]/.test(line[s])) s++;
  return [s, Math.max(e, s + 1)];
}

const IMPORT_TOKENS = new Set([
  "from", "import", "require", "require_once", "use", "include", "include_once", "importScripts",
]);

/** The syntactic position the matched span sits in — one of `CONTEXT_CLASSES`, first fit wins. */
export function classify(
  file: string,
  raw: string,
  code: string,
  span: [number, number] | null,
): ContextClass {
  const ext = extname(file).toLowerCase();
  const name = basename(file);
  const tspan = tokenSpan(raw, span);
  const [a, b] = tspan ?? [0, raw.length];
  const before = raw.slice(0, a);
  const after = raw.slice(b);
  const token = raw.slice(a, b);
  if (span && spanIsComment(raw, code, span[0], span[1])) return "comment";
  if (DOC_EXT.has(ext)) return "prose-doc";
  if (
    (LOCALE_DIR.test(file) || LOCALE_FILE.test(name)) &&
    // ...and the line has to BE a catalogue entry: a key and a translated value. A code file that
    // happens to live under `lang/` or `messages/` is not a catalogue.
    (/^\s*["'][^"']*["']\s*:\s*/.test(raw) || /^\s*[\w.@-]+\s*[:=]\s*["']/.test(raw) || /^\s*msgid\s/.test(raw))
  )
    return "translation-entry";
  if (LOCKFILE_NAMES.has(name)) return "lockfile-entry";
  if (MANIFEST_NAMES.has(name)) return "manifest-entry";
  if (
    ext === ".sql" ||
    (/(^|\/)migrations?\//i.test(file) &&
      /\b(select\s|insert\s+into|update\s+\w+\s+set|delete\s+from|create\s+table|alter\s+table|drop\s+table|add_column|create_table)\b/i.test(raw))
  )
    return "sql";
  if (CSS_EXT.has(ext)) return "css-declaration";
  const ranges = stringRanges(raw);
  const inString = tspan ? inRanges(ranges, a, b) : false;
  // An import specifier is claimed only when the match sits ON the construct: inside the module-path
  // string that the import opens, or on the import keyword itself. A line that merely contains an
  // import and matches somewhere else is classed by what it matched.
  const im = IMPORT_RE.exec(raw);
  if (im) {
    const path = ranges.find(([s2]) => s2 >= im.index);
    const onPath = span && path && span[0] < path[1] && span[1] > path[0];
    if (inString || onPath || IMPORT_TOKENS.has(token.toLowerCase()) || !/['"`]/.test(raw))
      return "import-specifier";
  }
  if (CONFIG_EXT.has(ext) && /^\s*[-\w."'[\]]+\s*[:=]/.test(raw)) return "config-entry";
  if (
    (ext === ".html" || ext === ".hbs" || ext === ".vue" || ext === ".svelte" || ext === ".xml") &&
    /=\s*["'][^"']*$/.test(before)
  )
    return "html-attribute";
  if (inString) {
    // An attribute value inside markup or JSX is an attribute, not a bare string.
    if (/[\s({[,]([A-Za-z_:][-\w:.]*)\s*=\s*["'{][^"']*$/.test(before) && /^[^"']*["']/.test(after))
      return "html-attribute";
    return "string-literal";
  }
  if (
    KEYWORDS.has(token) &&
    /^[:\s]*[\w$]/.test(after) &&
    !/^\s*\(/.test(after)
  )
    return "declaration";
  if (
    /(^|[^A-Za-z0-9_])(const|let|var|function|class|def|interface|type|enum|struct|impl|fn|func|val|public|private|protected|static|readonly|export)\s+[\w$.]*$/.test(
      before,
    ) ||
    (/^\s*["'\w$.[\]-]*$/.test(before) && /^\s*[?!]?\s*[:=][^=]/.test(after))
  )
    return "declaration";
  if (/^\s*(\.[\w$]+\s*)*\(/.test(after)) return "call";
  if (/[{,([]\s*$/.test(before) && /^\s*[,)}\]:]/.test(after)) return "object-key-or-param";
  if (/[.>:]\s*$/.test(before) || /->\s*$/.test(before)) return "member-access";
  if (/^[A-Za-z_$][\w$.]*$/.test(token)) return "identifier-use";
  return "other";
}

// ---------------------------------------------------------------- normalisation (L1)

/**
 * Normalise everything OUTSIDE the matched spans; keep the matched spans byte-for-byte.
 *  - the interior of a string literal collapses to nothing (the quotes stay, so the syntax shows)
 *  - a run of digits becomes 0
 *  - letters fold to lower case and `_` / `-` between word characters drop out
 *  - whitespace runs collapse to one space
 */
export function normaliseOutside(
  line: string,
  spans: [number, number][],
  keepStringWords = false,
): string {
  const keep = new Array<boolean>(line.length).fill(false);
  for (const [a, b] of spans) for (let i = a; i < b; i++) if (i >= 0 && i < line.length) keep[i] = true;
  const str = new Array<boolean>(line.length).fill(false);
  for (const [a, b] of stringRanges(line)) for (let i = a; i < b; i++) str[i] = true;
  let out = "";
  let lastDigit = false;
  // Whether `out` ends in a space, kept beside it: asking `out.endsWith(" ")` of a string built by appending flattens
  // it each time, which made a whitespace-heavy line cost the square of its length.
  let endsInSpace = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (keep[i]) {
      out += ch;
      endsInSpace = ch === " ";
      lastDigit = false;
      continue;
    }
    if (str[i] && !keepStringWords) {
      lastDigit = false;
      continue; // string interior outside the match: dropped
    }
    if (ch >= "0" && ch <= "9") {
      if (!lastDigit) {
        out += "0";
        endsInSpace = false;
      }
      lastDigit = true;
      continue;
    }
    lastDigit = false;
    if (ch === "_" || ch === "-") {
      const prev = line[i - 1] ?? "";
      const next = line[i + 1] ?? "";
      if (/[A-Za-z0-9]/.test(prev) && /[A-Za-z0-9]/.test(next)) continue;
      out += ch;
      endsInSpace = false;
      continue;
    }
    if (/\s/.test(ch)) {
      if (!endsInSpace) out += " ";
      endsInSpace = true;
      continue;
    }
    const lower = ch.toLowerCase();
    out += lower;
    endsInSpace = lower.endsWith(" ");
  }
  return out.replace(/\s+/g, " ").trim();
}

/** The matched text reduced to the word it is: edges trimmed of punctuation, case and separators folded. */
export function foldToken(s: string): string {
  // The edges are found by two index scans. The form this replaces, `/[^A-Za-z0-9@/._$]+$/`, read a punctuation run
  // again from each of its positions when a kept character followed it, about 24 ms on one 5,000-character label; the characters kept and dropped are the same.
  let a = 0;
  while (a < s.length && !foldKeeps(s.charCodeAt(a))) a++;
  let b = s.length;
  while (b > a && !foldKeeps(s.charCodeAt(b - 1))) b--;
  return s.slice(a, b).toLowerCase().replace(/[_-]/g, "");
}

/** Whether `foldToken` keeps a UTF-16 code unit at an edge: `[A-Za-z0-9@/._$]`. */
function foldKeeps(c: number): boolean {
  return (
    (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) ||
    c === 0x40 || c === 0x2f || c === 0x2e || c === 0x5f || c === 0x24
  );
}

// ---------------------------------------------------------------- spans

const globalCache = new Map<RegExp, RegExp>();
function globalOf(re: RegExp): RegExp {
  let g = globalCache.get(re);
  if (!g) {
    g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    globalCache.set(re, g);
  }
  return g;
}

/**
 * At most this many spans per clause reach the key.
 *
 * NOT A SILENT CUT, and the number is the one the measurement was taken with (`cell-digest.mjs`'s
 * `MAX_SPANS_PER_CLAUSE`): a line that matches one clause forty times contributes the first eight
 * folded tokens and no more, so a key cannot grow without bound on a minified line. Every span is
 * still inside one location, and the location itself is never dropped.
 */
export const MAX_SPANS_PER_CLAUSE = 8;

/**
 * Where each fired clause matched, in `text`. `firedOneBased` is the clause numbering a rule author
 * writes — the numbering `firedClauseIndices` in engine.ts returns — and `clauses` is that rule's
 * compiled `match` array, so `k - 1` indexes it.
 *
 * The span is used AS THE CLAUSE MATCHED IT and is never widened to the surrounding token: widening
 * pulls a whole URL, hash and all, into the key and turns one shape into thousands.
 */
export function spansOfClauses(
  clauses: RegExp[],
  firedOneBased: readonly number[],
  text: string,
): [number, number][] {
  const spans: [number, number][] = [];
  for (const k of firedOneBased) {
    const re = clauses[k - 1];
    if (re === undefined) continue;
    const g = globalOf(re);
    g.lastIndex = 0;
    let m: RegExpExecArray | null;
    let n = 0;
    while ((m = g.exec(text)) !== null && n < MAX_SPANS_PER_CLAUSE) {
      spans.push([m.index, m.index + m[0].length]);
      n++;
      if (g.lastIndex === m.index) g.lastIndex++;
    }
  }
  return spans;
}

// ---------------------------------------------------------------- the key

/**
 * The three variable components of one location's kind key, plus the L1 sub-shape beside it.
 *
 * `clause` is the fired clause set (`"16"`, `"1,3"`) where clauses fired, and the READING LABEL
 * where none did — see `unattributedKindFacts`. `matched_token` is the folded matched text, and the
 * folded whole line where no clause fired. The rule id is the fourth component and is not carried
 * here: it is the candidate's own, and holding it twice per location is a second copy the project
 * forbids.
 */
export interface KindFacts {
  clause: string;
  matched_token: string;
  context_class: ContextClass;
  /** The L1 form of the line with the matched spans kept, as a 16-hex digest. */
  sub_shape: string;
}

/** The whole key, as one string. `\u0000` separates, because no path, token or class can carry it. */
export function kindKey(ruleId: string, facts: KindFacts): string {
  return `${ruleId}\u0000${facts.clause}\u0000${facts.matched_token}\u0000${facts.context_class}`;
}

/**
 * The key facts of a location whose clauses fired — `cell-digest.mjs`'s L2 branch.
 *
 * `text` and `code` are the pair the candidate FIRED ON (the raw line, the alias- or value-resolved
 * line, or the fold), not the pair on disk: a clause set taken from a different text would not be a
 * statement about this candidate.
 */
export function firedKindFacts(
  clauses: RegExp[],
  firedOneBased: readonly number[],
  file: string,
  text: string,
  code: string,
): KindFacts {
  const spans = spansOfClauses(clauses, firedOneBased, text);
  const tokens = [...new Set(spans.map(([a, b]) => foldToken(text.slice(a, b))).filter(Boolean))].sort();
  return {
    clause: firedOneBased.join(","),
    matched_token: tokens.join("+"),
    context_class: classify(file, text, code, spans[0] ?? null),
    sub_shape: sha16(normaliseOutside(clean(text), spans)),
  };
}

/** How a location with no fired clause set is labelled. The label IS the key's clause component. */
export type NoClauseReading =
  | { kind: "unattributed"; reason: string }
  | { kind: "structural"; reason: string }
  | { kind: "split"; reading: string; reason: string; raw: number[]; blanked: number[] };

/**
 * The key facts of a location no per-clause reading attributes — `cell-digest.mjs`'s L1 branch.
 *
 * A candidate can exist with an EMPTY clause set: `matchFires` is two `some`s, so a clause may fire
 * on the raw text and another on the comment-blanked text with none on both (engine.ts
 * `firedClauseIndices` names the case), and the structural reading raises candidates from a parse
 * tree with no clause at all. Such lines are grouped by the SAME normaliser one level coarser — the
 * L1 form of the whole line with no span held back, plus the context class — because bucketing every
 * structural candidate of a cell into one group would hand a reader a thousand lines, three samples,
 * and call that a shape.
 */
export function unattributedKindFacts(
  reading: NoClauseReading,
  file: string,
  text: string,
  code: string,
): KindFacts {
  const label =
    reading.kind === "unattributed"
      ? `unattributed:${reading.reason}`
      : reading.kind === "structural"
        ? `structural:${reading.reason}`
        : `${reading.reading}:${reading.reason}[raw ${reading.raw.join("+")} / blanked ${reading.blanked.join("+")}]`;
  return {
    clause: label,
    matched_token: normaliseOutside(clean(text), []).slice(0, 120),
    context_class: classify(file, text, code, null),
    sub_shape: sha16(clean(text)),
  };
}
