/**
 * THE FORM OF A REPORT FILE'S RAW TEXT (delivery design rf11, section 3.1.1, "How a line
 * reads in the raw view"). The person opens the report files in VS Code, whose editor shows a `.md` file's text, wrapped
 * at the editor's width; the files are written for an editor 75 columns wide. Every report file the program writes is
 * made with these helpers:
 *
 *   - prose is wrapped at 75 by the program (`wrapProse`), never inside a code span or a link, list continuations
 *     indented, so the editor wraps nothing at 75 columns or more. A link or code quotation longer than the room left
 *     stands on a line of its own, which may then be longer (the rule's one exception besides headings, table rows and
 *     reference definitions);
 *   - a code place is a link relative to the report file, percent-encoded where a path holds characters a link target
 *     cannot carry, with `#L<line>` (`codeTarget`), so that it opens at its line in the editor, the preview and GitHub;
 *   - a finding is named by its short id: the shortest prefix of its finding id, of at least 6 hex characters, that no
 *     other finding of the record shares (`shortIdsOf`). It names the finding's file and is the same on every computer;
 *   - a heading that a link targets is plain words, digits and hyphens, so every renderer makes the same anchor of it
 *     (`anchorOfHeading`, GitHub's documented rule). No HTML and no hex anchor is written.
 *
 * The rows the editor shows are counted by the workspace's raw-view gate, which reads what this
 * program wrote. The program counts rows once, with `rowsAt`: where a block of the first screen has a row budget
 * (Fix first, To clarify) and an entry's own words decide how many rows it takes.
 */
import { PROGRAM_MARKER_RE, redactPrintedText, type PrintedRedaction } from "./credential-redaction.js";
import { productPrintedRedaction } from "./product-redaction.js";
import { valueText } from "./value-text.js";

/** The width every report file is written for (design 3.1.1). */
export const REPORT_WIDTH = 75;
/** The width of the terminal views (the end screen, `explain`). */
export const SCREEN_WIDTH = 80;

/**
 * One unbreakable piece of a paragraph: a code span, a link (inline or by reference) with its label, or a run of other
 * characters with no space in it. Text following a link or a code span with no space between stays in the same piece.
 */
function atomsOf(text: string): string[] {
  const atoms: string[] = [];
  let cur = "";
  let i = 0;
  const flush = (): void => {
    if (cur !== "") atoms.push(cur);
    cur = "";
  };
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === " ") {
      flush();
      i += 1;
      continue;
    }
    if (ch === "\\" && i + 1 < text.length) {
      // A backslash escape is two characters of the piece: an escaped backtick or bracket opens nothing.
      cur += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === "`") {
      // A code span runs to the next run of the same number of backticks (`codeSpanParts`, CommonMark's rule).
      const [before, span] = codeSpanParts(text.slice(i));
      if (before === "" && span !== undefined) {
        cur += span;
        i += span.length;
        continue;
      }
      let n = 0;
      while (text[i + n] === "`") n += 1;
      cur += text.slice(i, i + n);
      i += n;
      continue;
    }
    if (ch === "[") {
      // A link: [label](target) or [label][ref], the label taken whole, nested brackets counted.
      let depth = 0;
      let j = i;
      for (; j < text.length; j += 1) {
        if (text[j] === "\\") {
          j += 1;
          continue;
        }
        if (text[j] === "[") depth += 1;
        else if (text[j] === "]") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (depth === 0 && j < text.length) {
        const after = text[j + 1];
        const close = after === "(" ? text.indexOf(")", j + 2) : after === "[" ? text.indexOf("]", j + 2) : -1;
        if (close >= 0) {
          cur += text.slice(i, close + 1);
          i = close + 1;
          continue;
        }
      }
    }
    cur += ch;
    i += 1;
  }
  flush();
  return atoms;
}

/**
 * A piece that would start a new block if a line began with it (a list item, a quotation, a heading, a rule or a
 * numbered item). Such a piece is kept on the line of the piece before it, so wrapping never changes what a paragraph
 * is.
 */
const BLOCK_START = /^(?:[-+*>]|#{1,6}|=+|-{2,}|\d{1,9}[.)])$/;

/** The rows VS Code would show for a line of `width` or fewer characters: one. Counted, not measured: see the gate. */
const fits = (line: string, width: number): boolean => line.length <= width;

/**
 * The rows one written line takes in an editor `width` columns wide (wrap.py's `rows`, as the raw-view gate counts them):
 * a line breaks at its last space within the width, its continuation keeps the line's indent, and a piece longer than a
 * row breaks where the row ends.
 */
export function rowsAt(line: string, width: number = REPORT_WIDTH): number {
  let rest = Array.from(line);
  if (rest.length <= width) return 1;
  const ind = rest.length - Array.from(line.replace(/^ +/, "")).length;
  let n = 1;
  while (rest.length > width) {
    let cut = -1;
    for (let i = Math.min(width, rest.length - 1); i >= ind + 1; i -= 1) {
      if (rest[i] === " ") {
        cut = i;
        break;
      }
    }
    if (cut <= ind) cut = width;
    const tail = rest.slice(cut);
    let k = 0;
    while (k < tail.length && tail[k] === " ") k += 1;
    rest = [...Array<string>(ind).fill(" "), ...tail.slice(k)];
    n += 1;
  }
  return n;
}

/**
 * A piece of plain text longer than a line even on its own (a path, an address, a recorded value, a redaction marker)
 * is set as a code quotation, its punctuation outside: Markdown cannot break it, and rule 3 of design 3.1.1 lets only a
 * link or a code quotation stand longer than the line. What the preview prints is unchanged: a backslash escape of
 * punctuation, which the preview does not print, is dropped inside the quotation, where it would print. A piece holding
 * a code span, a link or a backtick, or ending in a hard break, is left as it is.
 */
function quotedIfLong(p: string, lead: string, width: number): string {
  if (fits(lead + p, width) || /[`\s]|\]\(|^\[|\\$/.test(p)) return p;
  const m = /^([("']*)([\s\S]*?)([)"'.,;:!?\]]*)$/.exec(p);
  if (!m || !m[2]) return p;
  let body = m[2] as string;
  let tail = m[3] as string;
  // A backslash that escapes the tail's first mark stays with it, outside.
  if (tail !== "" && /(?:^|[^\\])(?:\\\\)*\\$/.test(body)) {
    body = body.slice(0, -1);
    tail = `\\${tail}`;
  }
  if (!body) return p;
  const core = body.replace(/\\([!-/:-@[-`{-~])/g, "$1");
  if (core.includes("`")) return p;
  return `${m[1]}\`${core}\`${tail}`;
}

/**
 * Wrap one paragraph of Markdown prose at `width`: the first line starts with `first` (a list marker, or nothing), every
 * further line with `indent` (the list item's continuation indent). A piece longer than the room left stands on a line
 * of its own; nothing is ever broken inside a piece.
 */
export function wrapProse(text: string, opts: { width?: number; first?: string; indent?: string } = {}): string[] {
  const width = opts.width ?? REPORT_WIDTH;
  const first = opts.first ?? "";
  const indent = opts.indent ?? "";
  const pieces: string[] = [];
  // Runs of white space are one space outside code spans; a code span keeps its own spaces (a quoted line is the code's).
  const squeezed = codeSpanParts(text)
    .map((part, i) => (i % 2 === 1 ? part.replace(/[\r\n]+/g, " ") : part.replace(/\s+/g, " ")))
    .join("")
    .trim();
  for (const a of atomsOf(squeezed)) {
    if (pieces.length > 0 && BLOCK_START.test(a)) pieces[pieces.length - 1] += ` ${a}`;
    else pieces.push(a);
  }
  const lines: string[] = [];
  let cur = first;
  let curHas = false;
  let lone = false;
  for (const p of pieces) {
    const lead = lines.length === 0 ? first : indent;
    if (!curHas) {
      cur = lead + quotedIfLong(p, lead, width);
      curHas = true;
      lone = !fits(cur, width);
      continue;
    }
    if (!lone && fits(`${cur} ${p}`, width)) {
      cur += ` ${p}`;
      continue;
    }
    lines.push(cur);
    cur = indent + quotedIfLong(p, indent, width);
    lone = !fits(cur, width);
  }
  if (curHas || lines.length === 0) lines.push(cur);
  return lines;
}

/**
 * Prose written by a review seat or taken from a record, made safe to stand in a Markdown paragraph: characters that
 * Markdown would read as markup are escaped with a backslash, so the raw view shows the seat's words and the preview
 * shows the same words, with nothing the seat wrote turned into a link, a heading, emphasis or HTML.
 */
export function proseOf(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\`*_[\]<>|]/g, (c) => `\\${c}`);
}

/** A code quotation as a Markdown code span, whatever backticks it holds. */
export function codeSpan(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  let n = 1;
  for (const m of t.match(/`+/g) ?? []) n = Math.max(n, m.length + 1);
  const fence = "`".repeat(n);
  const pad = t.startsWith("`") || t.endsWith("`") || t === "" ? " " : "";
  return `${fence}${pad}${t || " "}${pad}${fence}`;
}

/**
 * The texts of a list of code spans as `codeSpan` writes them, joined by `sep`: its inverse, so that a reader takes a
 * list's items from its spans and never splits on a separator that a path or a search may hold [C4 item 7, 2026-11-08:
 * a path holding " · " was counted twice]. Null where the text is not that form.
 */
export function codeSpanTexts(list: string, sep = " · "): string[] | null {
  const out: string[] = [];
  let i = 0;
  while (i < list.length) {
    const open = /^`+/.exec(list.slice(i));
    if (open === null) return null;
    const n = open[0].length;
    const run = /`+/g;
    run.lastIndex = i + n;
    let close = -1;
    for (let m = run.exec(list); m !== null; m = run.exec(list)) {
      if (m[0].length === n) {
        close = m.index;
        break;
      }
    }
    if (close < 0) return null;
    const t = list.slice(i + n, close);
    out.push(t.length >= 2 && t.startsWith(" ") && t.endsWith(" ") ? t.slice(1, -1) : t);
    i = close + n;
    if (i < list.length) {
      if (!list.startsWith(sep, i)) return null;
      i += sep.length;
    }
  }
  return out;
}

/** A link label: its brackets and backslashes escaped, so a path such as `[id]/route.ts` stays one label. */
export function labelOf(text: string): string {
  return text.replace(/[\\[\]]/g, (c) => `\\${c}`);
}

/** Characters a path segment keeps as they are in a link target; every other byte is percent-encoded. */
const TARGET_SAFE = /[A-Za-z0-9._~@+,=!$&*;:-]/;

/** A path in the form a link target carries: each segment's other bytes percent-encoded (spaces, brackets, parentheses). */
export function encodePath(path: string): string {
  return path
    .split("/")
    .map((seg) =>
      [...seg]
        .map((c) =>
          TARGET_SAFE.test(c)
            ? c
            : [...Buffer.from(c, "utf8")].map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`).join(""),
        )
        .join(""),
    )
    .join("/");
}

/**
 * Whether a link target in a report file names another report file, for readers that show a report file as terminal
 * text (explain.ts drops such links): the inverse of the link kinds this module and the assembly write, kept beside
 * `codeTarget` so that the two agree. A report file's link is relative, ends ".md" with no "#L<n>" anchor, and climbs at
 * most one folder (`../report.md` from `findings/`). A code place's link is a `file:` address, carries "#L<n>", or climbs
 * from the report folder to the project's root, three folders from `.legal/reports/scan-<stamp>/`. [C4 item 3, 2026-11-08:
 * every link to a `.md` target was dropped, so a finding in a Markdown file was shown with no place.] The one form both
 * share is a place with no line in a `.md` file when the report folder is the project's root or one folder below it,
 * read as a report file.
 */
export function isReportFileTarget(target: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("/")) return false;
  const hash = target.indexOf("#");
  const path = hash < 0 ? target : target.slice(0, hash);
  const anchor = hash < 0 ? "" : target.slice(hash + 1);
  // A code place's line anchor, "#L<n>" (tested as "L" then a digit: ref-ids.ts alone tests id forms such as basis ids).
  if (anchor.startsWith("L") && /^\d/.test(anchor.slice(1))) return false;
  return path.endsWith(".md") && !/^(?:\.\.\/){2}/.test(path);
}

/** A link label as `labelOf` or `markdownText` (printed-output.ts) wrote it, its escapes removed: the text it shows. */
export function labelText(label: string): string {
  return markdownUnescaped(label);
}

/**
 * A line's parts as CommonMark reads its code spans: the odd parts are code
 * spans (a backtick run that no backslash escapes, closed by the next run of the same length, the two runs included),
 * the even parts the text around them. A run with no closer of its length is text. FR5 item 1: the assembly paired
 * any run with any other (`` `` `` closed by `` ` ``), so that text markdown-it reads outside a span was taken for code
 * and its `<` left raw.
 */
export function codeSpanParts(line: string): string[] {
  const parts: string[] = [];
  let text = "";
  let i = 0;
  const runAt = (j: number): number => {
    let n = 0;
    while (line[j + n] === "`") n++;
    return n;
  };
  while (i < line.length) {
    const c = line[i] as string;
    if (c === "\\" && i + 1 < line.length) {
      text += line.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c !== "`") {
      text += c;
      i++;
      continue;
    }
    const n = runAt(i);
    let close = -1;
    for (let j = i + n; j < line.length; ) {
      if (line[j] !== "`") {
        j++;
        continue;
      }
      const k = runAt(j);
      if (k === n) {
        close = j;
        break;
      }
      j += k;
    }
    if (close < 0) {
      text += line.slice(i, i + n);
      i += n;
      continue;
    }
    parts.push(text, line.slice(i, close + n));
    text = "";
    i = close + n;
  }
  parts.push(text);
  return parts;
}

/** A line's text with CommonMark's backslash escapes removed outside its code spans (`codeSpanParts`): the characters it shows. */
export function markdownUnescaped(line: string): string {
  return codeSpanParts(line)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/\\([!-/:-@[-`{-~])/g, "$1")))
    .join("");
}

/** A finding id's hex part (`fp_e41d7a…` gives `e41d7a…`). */
export const hexOf = (id: string): string => id.replace(/^fp_/, "");

/**
 * Every finding id's short id: the shortest prefix of its hex part, of at least 6 characters, that is the prefix of no
 * other id in `ids` (design 3.5). An id that is a prefix of another (never, for ids of equal length) takes its whole hex.
 */
export function shortIdsOf(ids: Iterable<string>): Map<string, string> {
  const hexes = [...new Set([...ids].map(hexOf))].sort();
  const byHex = new Map<string, string>();
  hexes.forEach((h, i) => {
    // In sorted order the longest prefix shared with any other id is shared with a neighbour.
    const common = (o: string | undefined): number => {
      if (o === undefined) return 0;
      let n = 0;
      while (n < h.length && n < o.length && h[n] === o[n]) n += 1;
      return n;
    };
    const need = Math.max(common(hexes[i - 1]), common(hexes[i + 1])) + 1;
    byHex.set(h, h.slice(0, Math.min(h.length, Math.max(6, need))));
  });
  const out = new Map<string, string>();
  for (const id of ids) out.set(id, byHex.get(hexOf(id)) ?? hexOf(id));
  return out;
}

/** The anchor every renderer makes of a heading of plain words, digits and hyphens (GitHub's rule, design B15). */
export function anchorOfHeading(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, "")
    .replace(/ /g, "-");
}

/** A heading's text with everything but plain words, digits, spaces and hyphens taken out, so its anchor is the same everywhere. */
export function plainHeading(text: string): string {
  return text
    .replace(/[^A-Za-z0-9 -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Words after which a full stop is not the end of a sentence: legal and
 * reference abbreviations, compared in lower case without their dots. A card's "What to do" once stopped at "GDPR Art."
 * because the cut was taken at the first full stop followed by a space.
 */
const NOT_A_SENTENCE_END = new Set([
  "art", "arts", "no", "nos", "para", "paras", "sec", "secs", "s", "ss", "e.g", "i.e", "cf", "vs", "v", "etc", "al",
  "ch", "cl", "p", "pp", "rec", "recs", "reg", "dir", "ann", "fig", "vol", "ed", "inc", "ltd", "co", "corp", "dr", "mr",
  "mrs", "ms", "st", "approx", "incl", "esp", "min", "max", "u.s", "u.k", "e.u",
]);

/**
 * The first sentence of `text`: up to the first ".", "!" or "?" that is followed by a space and ends a sentence. A full
 * stop does not end one after an abbreviation in `NOT_A_SENTENCE_END` ("GDPR Art. 6", "e.g. the", "No. 3"), after a
 * single capital letter ("U.S.", "J. Smith"), or after a number ("Art. 5. the", "1.5"). The whole text where nothing
 * ends a sentence. Trimmed.
 */
export function firstSentence(text: string): string {
  const t = text.trim();
  const re = /[.!?]["')\]]?(?=\s)/g;
  for (let m = re.exec(t); m !== null; m = re.exec(t)) {
    const end = m.index + m[0].length;
    if (t[m.index] !== ".") return t.slice(0, end);
    const word = (t.slice(0, m.index).split(/\s/).pop() ?? "").replace(/^[("'[]+/, "");
    const bare = word.toLowerCase();
    if (NOT_A_SENTENCE_END.has(bare)) continue;
    if (/^[A-Z]$/.test(word) || /(^|\.)[A-Za-z]$/.test(word) || /\d$/.test(word)) continue;
    return t.slice(0, end);
  }
  return t;
}

/**
 * A title cut at a word boundary with "…" so that `lead + title` fits `width`; a title that fits is returned whole.
 * Used where a title shares a line of fixed width (the end screen, the report's first screen); a place is never cut.
 */
export function cutTitle(title: string, room: number): string {
  if (title.length <= room) return title;
  const words = title.split(" ");
  let out = "";
  for (const w of words) {
    const next = out === "" ? w : `${out} ${w}`;
    if (next.length + 1 > room) break;
    out = next;
  }
  if (out === "") out = title.slice(0, Math.max(1, room - 1));
  return `${out.replace(/[\s,;:·.-]+$/, "")}…`;
}

/**
 * A file name of plain words for a rule's ruled-out file (mock M6): the rule's plain name, lower case, words joined by
 * hyphens, cut at 30 characters at a word boundary; `taken` holds names already given, and a repeated name takes `-2`,
 * `-3` and on.
 */
export function plainFileName(name: string, taken: Set<string>): string {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  let base = "";
  for (const w of words) {
    const next = base === "" ? w : `${base}-${w}`;
    if (next.length > 30 && base !== "") break;
    base = next.slice(0, 30);
  }
  if (base === "") base = "rule";
  let name2 = base;
  for (let n = 2; taken.has(name2); n += 1) name2 = `${base}-${n}`;
  taken.add(name2);
  return name2;
}

/*
 * THE MARKDOWN ESCAPES OF A VALUE, here and not in
 * printed-output.ts, which keeps `markdownText` and every other printer: report-budget.ts measures a text as the report
 * prints it, and the capture (standing.ts) reads report-budget from the hooks, whose static import graph must not hold
 * printed-output.js (the entry loads it only to print: a redaction that cannot load must never stop the module that
 * decides). One copy: printed-output.ts imports these.
 */
/** The printed redaction from the CLI's own copy of `baseline-002`, compiled once (product-redaction.ts), the report's. */
export function printedOutputRedaction(): PrintedRedaction {
  return productPrintedRedaction();
}

/** ASCII punctuation that opens no construct of CommonMark, GFM's tables, markdown-it's strikethrough and linkify or VS Code's math, in any position. */
const MARKDOWN_INERT = new Set([..."/,;'\"?%^{}"]);
const isWordChar = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const isSpaceOrEnd = (c: string | undefined): boolean => c === undefined || /\s/.test(c);

/**
 * `markdownText`'s escapes of a value `enteredValue` returned. The printed redaction runs on the value BEFORE its
 * escapes: an escape splits a credential's shape
 * (`API_TOKEN\=...`, `eyJ...\.eyJ...`), so step 13's net over the finished file and the log's net no longer recognise it
 * and the value reached not-checked.md and the log in clear. It runs once more after `valueText`, for a shape that reads
 * only on one line. The marker it leaves is kept as it is below, for its readers (an inert `[...]`: no `(`, `[` or
 * definition follows).
 */
export function markdownEscaped(r: string): string {
  return redactPrintedText(printedOutputRedaction(), valueText(r))
    .split(PROGRAM_MARKER_SPLIT())
    // A `:` right after the marker is escaped: at a block's start `[marker]: url` would define a link reference.
    .map((part, i) => (i % 2 === 1 ? part : i > 0 && part.startsWith(":") ? `\\:${inertPart(part.slice(1))}` : inertPart(part)))
    .join("");
}
/** `PROGRAM_MARKER_RE` as one capturing group, for `split`. */
/* Made on first use, not at load (PROGRAM_MARKER_RE is set when credential-redaction.js has loaded). */
let programMarkerSplit: RegExp | null = null;
const PROGRAM_MARKER_SPLIT = (): RegExp => (programMarkerSplit ??= new RegExp(`(${PROGRAM_MARKER_RE.source.replace(/\((?!\?)/g, "(?:")})`));
/**
 * A digit run that is a whole word up to `i` and could mark an ordered list: one that reads as 1 (the one marker that
 * can interrupt a paragraph), or any that starts the value, which may itself start a block (a list item's content, a
 * paragraph).
 */
const listOneBefore = (t: readonly string[], i: number): boolean => {
  let j = i;
  while (j > 0 && /\d/.test(t[j - 1] as string)) j--;
  return j < i && (j === 0 || (/\s/.test(t[j - 1] as string) && Number(t.slice(j, i).join("")) === 1));
};
function inertPart(text: string): string {
  const t = [...text];
  let out = "";
  for (let i = 0; i < t.length; i++) {
    const c = t[i] as string;
    const prev = t[i - 1];
    // A `/` after a `/` is escaped: linkify reads `//host:port/path` as a link with no dot in the host (`//localhost`).
    if (!/[!-/:-@[-`{-~]/.test(c) || (MARKDOWN_INERT.has(c) && !(c === "/" && prev === "/"))) {
      out += c;
      continue;
    }
    const next = t[i + 1];
    const kept =
      (c === "-" && prev !== undefined && !/\s/.test(prev)) ||
      (c === "_" && isWordChar(prev) && isWordChar(next)) ||
      (c === "." && prev !== undefined && !listOneBefore(t, i) && isSpaceOrEnd(next)) ||
      (c === ")" && prev !== undefined && !listOneBefore(t, i)) ||
      (c === "(" && prev !== undefined) ||
      (c === ":" && next !== "/");
    out += kept ? c : `\\${c}`;
  }
  return out;
}


/** `markdownText`'s text as a string, for a measure of rows (report-budget.ts): the value redacted, then escaped. */
export function markdownTextOf(s: string): string {
  return markdownEscaped(redactPrintedText(printedOutputRedaction(), s));
}
