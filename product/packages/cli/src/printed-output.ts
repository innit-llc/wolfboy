/**
 * EVERY STRING THE PROGRAM PRINTS GOES THROUGH THE PRINTED REDACTION.
 *
 * WHY. The report, the evidence log, the exports and the progress stream each redacted what they wrote, writer by writer
 * (credential-redaction.ts `redactPrintedText`), and a writer that did not was a hole: the terminal of `assemble-report`
 * printed a record's own word in its set-aside and refusal lines, the capture's refusal quoted a seat's word back to the
 * seat, and `ropa`'s refusal printed an activity's name in a Node stack. Each could have been given a redaction of its
 * own; the class is closed here instead, once: the CLI's entry (index.ts) calls `installPrintedRedaction` before it does
 * anything else, and from then on every write to stdout or stderr of the process - `console.*`, a direct
 * `process.stdout.write`, commander's own messages, a crash's stack - is handed to `redactForPrint` first. The hooks'
 * entry (hook-entry.ts) prints through one `write`, which hands its text to the same function.
 *
 * THE SAME RULE. What is redacted is what the report redacts: `baseline-002`'s clauses from the CLI's own copy
 * (credential-rule.generated.ts), compiled once by product-redaction.ts, with `new RegExp` exactly as `compileRules`
 * compiles a rule without word lists (`test:line-text-redaction` holds the two compiles equal), and the program's marker in place of a value. Text already
 * redacted is unchanged, so a writer that redacted its own text loses nothing by passing through here again.
 *
 * JSON STAYS JSON. A write that is a JSON document (the hooks' decisions, a command's `--json` output), or a line of one,
 * is redacted inside its strings and written again as JSON, so a marker never breaks what a program reads; a document
 * with nothing to redact is written as it came.
 *
 * THE PRINTED FORM. After the
 * redaction, every write is put in the one form every reader of it is safe with - a person's terminal, a CI's log (the CI
 * form in every CI, and every run whose output is not a terminal), Claude Code reading a hook's reply - by `printedForm`:
 * each control character but the line break and the tab (ESC and the other C0 controls, CR, DEL, the C1 controls, U+2028
 * and U+2029) is written as an escape (`\u001b`, `\r`), so an escape sequence in a file name cannot erase rows of a
 * terminal or print text this program did not; and the openers Azure Pipelines (`##vso[`, `##[`) and TeamCity
 * (`##teamcity[`) read anywhere in a log line are written with the `#` before the last `#` as `\u0023`, so no text of a
 * repository reads as a CI's command. Both are position-free, so they need no call per value and cover every printer,
 * later ones included. In a JSON write both are JSON's own escapes, so a program reading it gets the original string
 * back. The program's own control sequence (the progress line's erase) is written by `writeOwnErase`, past the form. The
 * step summary and the check run, written to a file and posted rather than printed, are put in the same form where they
 * are written (index.ts), and a value inside their markdown goes in a code span (`markdownValue`).
 *
 * WHAT IT DOES NOT DO. It sees each write as it is handed over: a value split across two writes would be tested in two
 * halves (every writer of this program writes whole lines). It cannot tell a line break of a value from one of the
 * program's own, so a value that may hold one is written through `valueText` where its line is made (ci-check.ts
 * `ciText`, the scan's `shown` copy). A child process that writes to the terminal itself (the Claude Code session
 * `session` starts) is not this program's output.
 */
import { writeSync } from "node:fs";
import { inspect } from "node:util";
import { PROGRAM_MARKER_RE, redactPrintedText, redactStringsInPlace, type PrintedRedaction } from "./credential-redaction.js";
import { productPrintedRedaction } from "./product-redaction.js";
import { codeSpan } from "./report-form.js";
import { controlEscape, valueText } from "./value-text.js";

/** The printed redaction from the CLI's own copy of `baseline-002`, compiled once (product-redaction.ts), the report's. */
export function printedOutputRedaction(): PrintedRedaction {
  return productPrintedRedaction();
}

const JSON_START = /^\s*[[{]/;

/** `text` as JSON with its strings redacted, or null where it is not a JSON object or list. */
function redactedJson(text: string): string | null {
  if (!JSON_START.test(text)) return null;
  const body = text.trimEnd();
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  if (redactStringsInPlace(printedOutputRedaction(), value) === 0) return text;
  const indent = /\n( +)\S/.exec(body)?.[1]?.length ?? 0;
  return `${JSON.stringify(value, null, indent)}${text.slice(body.length)}`;
}

/** One printed text with every credential the printed redaction recognises replaced by the program's marker. */
export function redactForPrint(text: string): string {
  if (text.length === 0) return text;
  const whole = redactedJson(text);
  if (whole !== null) return whole;
  const pr = printedOutputRedaction();
  const lines = text.split("\n");
  if (!lines.some((l) => JSON_START.test(l))) return redactPrintedText(pr, text);
  // Lines of JSON among lines of text (a JSON-lines stream): each JSON line as JSON, each run of other lines as text.
  const out: string[] = [];
  let run: string[] = [];
  const flush = (): void => {
    if (run.length > 0) out.push(redactPrintedText(pr, run.join("\n")));
    run = [];
  };
  for (const line of lines) {
    const json = redactedJson(line);
    if (json === null) run.push(line);
    else {
      flush();
      out.push(json);
    }
  }
  flush();
  return out.join("\n");
}

/** Every control character a printed line may not carry raw: all but the line break and the tab. */
const PRINTED_CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/g;
/** The `#` before the last `#` of an opener Azure Pipelines or TeamCity reads anywhere in a log line. */
const CI_OPENER = /#(?=#(?:vso|teamcity)?\[)/gi;
const escaped = controlEscape;

/**
 * One text with every control character but the line break and the tab
 * written as an escape: the printed form's first half, and the form every report file leaves in (assemble-report.ts
 * `formMarkdown`), where an escape sequence or a CR in a value has nothing to do but no CI reads the file as a log.
 */
export function controlsEscaped(text: string): string {
  return text.replace(PRINTED_CONTROLS, escaped);
}

/** One printed text in the printed form (the header's THE PRINTED FORM): its line breaks and tabs are kept. */
export function printedForm(text: string): string {
  return controlsEscaped(text).replace(CI_OPENER, "\\u0023");
}

/* `valueText` lives in value-text.ts (no imports), so that a module the hook loads at its start can name a value
 * without loading this one: the hook loads this module (the redaction) at its first write only. */
export { valueText };

/**
 * THE ONE WAY A VALUE COMES IN. Every function of this module that
 * makes printed or Markdown text from a value (`valueShown`, `markdownText`, `markdownProse`, `spanText`, `linkTarget`,
 * `markdownCode`, `markdownValue`, `markdownCodeBlock`, `programText`) hands the value to `enteredValue` before anything
 * else: the printed redaction runs on the value as it came, before an escape, an encoding, a split at backticks or a
 * control escape changes one of its characters. A producer that changed the value first hid a credential's shape from
 * every net after it: `linkTarget` encoded `password="v"` as `password=%22v%22`, and `markdownProse` escaped
 * `API_TOKEN\=` before the backticked value. The marker it leaves holds no backtick, so every producer keeps it whole.
 * The class test (test:line-text-redaction, case 10p) calls every function this module exports with each credential shape,
 * so a producer added later without this first step fails it.
 */
export function enteredValue(s: string): Raw {
  return redactPrintedText(printedOutputRedaction(), s) as Raw;
}

/** One value as the CI form and every printer of repository text show it: redacted (`enteredValue`), `valueText`, then the printed form. */
export function valueShown(s: string): string {
  return printedForm(valueText(enteredValue(s)));
}

/* THE INERT TYPE. A value of the project, a seat, a person or a tool reached
 * a report file raw at a site the rule below missed, three rounds running (FR3, FR5, FR7). The rule is now a type: every
 * WORDS template's text parameter, and every line a Markdown file of the person's is written from, is `Inert`, a string
 * only these functions make: `markdownText` and `markdownCode` (a value), the assembly's `said` and `code` (which call
 * them or escape the same way), `linkTarget` (a link's destination, percent-encoded), `ours` (a string literal of the
 * program's source), `md` (a template whose every value is `Inert` or a number), `inertJoin`, `inertLines`, and
 * `programText` (the bundle's text or a WORDS entry read by key, written as authored). A
 * raw `string` given where `Inert` is wanted does not compile, so a site that forgets the rule cannot be built. */
declare const INERT: unique symbol;
/** Text that reads in a Markdown file of the person's as its own characters, or that the program wrote. */
export type Inert = string & { readonly [INERT]: true };
declare const SPANNED: unique symbol;
/**
 * The text inside a code span a template opens with its own
 * backticks: a value with its control characters escaped and its backticks written as quotes (`spanText`), and NOT
 * escaped as text, since a backslash inside a code span is shown as itself. It is not `Inert` (outside a code span its
 * Markdown would be live) and `Inert` is not it (an escaped text inside a code span shows its backslashes, which the
 * person would copy: `.legal/capture/kept/fB\.txt`). Where each may stand in a template is a source check
 * of the class test (`spanPositions`): `Inert` never inside a template's own backticks, `Spanned` never
 * outside them.
 */
export type Spanned = string & { readonly [SPANNED]: true };
/**
 * A raw value: any string that is neither `Inert` nor `Spanned`. The escapers take only this, so a text escaped once
 * cannot be escaped again (`markdownText` is not idempotent) or put in a code span after its escapes: either does not
 * compile.
 */
export type Raw = string & { readonly [INERT]?: never; readonly [SPANNED]?: never };
/** A `Spanned` text in a code span of its own, as `Inert`: `spanText` left no backtick in it, so one backtick each side holds it. */
export function inSpan(s: Spanned): Inert {
  return asInert(`\`${s}\``);
}
/**
 * A sentence the program composed around values, which marks a
 * value as code with a pair of single backticks (severity-at-place.ts `because`: "reaches `src/a.ts:77` over ..."):
 * each marked part as `Spanned` in a code span of its own, every other part as `markdownText`. Escaped whole, the
 * sentence showed its backticks as characters and its path's escapes as text. A sentence with an unpaired backtick is
 * escaped whole. Inert either way: each part is escaped for where it stands.
 */
export function markdownProse(s: Raw): Inert {
  // Redacted whole before the split (`enteredValue`): a key outside the backticks and its value inside them are one shape.
  const r = enteredValue(s);
  const parts = r.split("`");
  if (parts.length % 2 === 0) return escapedText(r);
  return asInert(parts.map((p, i) => (i % 2 === 1 ? inSpan(spannedForm(p)) : escapedText(p))).join(""));
}
/** A value as the text inside a code span a template opens with its own backticks (see `Spanned`). It takes a `Raw`, so a text escaped as `Inert` cannot be put in a span. */
export function spanText(s: Raw): Spanned {
  return spannedForm(enteredValue(s));
}
/** `spanText`'s form of a value `enteredValue` returned: control characters as `valueText` writes them, backticks as quotes. */
const spannedForm = (r: string): Spanned => valueText(r).replace(/`/g, "'") as Spanned;
const asInert = (s: string): Inert => s as Inert;
/** A string literal of the program's own source, as `Inert`. A value whose type is `string` does not compile here. */
export function ours<const T extends string>(s: string extends T ? never : T): Inert {
  return asInert(s);
}
/** A line or a part the program composes: its literal text is the program's, and each value must be `Inert` or a number. */
export function md(parts: TemplateStringsArray, ...values: ReadonlyArray<Inert | number>): Inert {
  let out = parts[0] ?? "";
  for (let i = 0; i < values.length; i++) out += String(values[i]) + (parts[i + 1] ?? "");
  return asInert(out);
}
/** `Inert` parts joined by `Inert` text. */
export function inertJoin(parts: readonly Inert[], separator: Inert): Inert {
  return asInert(parts.join(separator));
}
/**
 * The program's own text that is not a literal of this source, written as authored (its backticks are meant): a rule's
 * text from the bundle the program ships (its name, citation, card line, applies-from date), or an entry of a WORDS
 * table read by a key. Never a value of the project, a seat, a person or a tool: each call is a claim a reviewer reads.
 */
export function programText(s: string): Inert {
  return asInert(enteredValue(s));
}
/**
 * A link's destination: every character outside the ones a percent-encoded path carries (letters, digits,
 * `-._~@+,=!$&*;:/#%`) percent-encoded as UTF-8, so no space, bracket, parenthesis, backslash or control character can
 * end the destination or the link. A path `encodePath` (report-form.ts) wrote passes unchanged.
 */
export function linkTarget(s: string): Inert {
  return asInert(
    [...enteredValue(s)]
      .map((c) => (/[A-Za-z0-9\-._~@+,=!$&*;:/#%]/.test(c) ? c : [...Buffer.from(c, "utf8")].map((x) => `%${x.toString(16).toUpperCase().padStart(2, "0")}`).join("")))
      .join(""),
  );
}
/**
 * An `Inert` text on one line, cut to `max` characters with "…": its white space runs one space. A cut can leave a
 * backslash or a backtick run without its pair, which CommonMark reads as the character itself.
 */
export function inertCut(s: Inert, max: number): Inert {
  const flat = s.replace(/\s+/g, " ").trim();
  return asInert(flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`);
}
/**
 * An `Inert` text through the printed-output redaction (`a.printed` of the assembly): it puts the program's own marker
 * where a secret-shaped value stood and changes nothing else, so what it returns is `Inert` when its input is.
 */
export function inertRedacted(s: Inert, redact: (t: string) => string): Inert {
  return asInert(redact(s));
}
/**
 * An `Inert` line whose every relative link destination (not `https:`, `file:`, `mailto:`, `#` or `../`) has the program's
 * `prefix` put before it: a file one folder down links to the report's files (`ruled-out/<rule>.md`).
 */
export function inertRelinked(line: Inert, prefix: Inert, own?: Inert): Inert {
  return asInert(line.replace(/\]\((?!https?:|file:|mailto:|#|\.\.\/)([^)\s]+)\)/g, (_, t: string) => (own !== undefined && t.startsWith(own) ? `](${t.slice(own.length)})` : `](${prefix}${t})`)));
}
/** The first `end` characters of an `Inert` text: as `inertCut`, a cut can leave a backslash or a backtick run without its pair, which CommonMark reads as the character itself. */
export function inertSlice(s: Inert, end: number): Inert {
  return asInert(s.slice(0, end));
}
/** An `Inert` text from character `start` on, where `start` ends the program's own words (a lead it does not repeat). */
export function inertSliceFrom(s: Inert, start: number): Inert {
  return asInert(s.slice(start));
}
/** An `Inert` list item's text without its marker (`- `), to stand inside a line: inert in any position, as its words are. */
export function inertUnlisted(s: Inert): Inert {
  return asInert(s.replace(/^\s*[-*+]\s+/, ""));
}
/** An `Inert` text as a GFM table cell: every `|` escaped (a backslash added), so the cell cannot end early. */
export function inertCell(s: Inert): Inert {
  return asInert(s.replace(/\|/g, "\\|"));
}
/** An `Inert` line without its leading and trailing white space (to be indented under a list item again). */
export function inertTrim(s: Inert): Inert {
  return asInert(s.trim());
}
/** An `Inert` text with its first character upper-cased: a letter's case opens nothing. */
export function inertCapital(s: Inert): Inert {
  return asInert(`${s.charAt(0).toUpperCase()}${s.slice(1)}`);
}
/**
 * An `Inert` text cut at its runs of spaces, for a wrap that puts each piece on a row of a list item's paragraph
 * (deepen.ts `bullet`). Each piece is inert where it lands when the text holds no code span: `markdownText`'s output
 * reads as its own characters at a row's start too, and a cut inside a code span could start a row with `#` or `-`.
 */
export function inertSpaced(s: Inert): Inert[] {
  return s.split(/ +/).map(asInert);
}
/**
 * A value of several lines (a quotation) as a fenced code block whose every row starts with `indent` (a list item's
 * continuation indent): the fence is a backtick run longer than any the value holds, at least three, so no line of the
 * value can close the block, and each line's control characters are written as `valueText` writes them.
 */
export function markdownCodeBlock(value: Raw, indent: Inert): Inert[] {
  const text = enteredValue(value);
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return [`${indent}${fence}`, ...text.split(/\r?\n/).map((l) => `${indent}${valueText(l)}`), `${indent}${fence}`].map(asInert);
}
/** One `Inert` line cut at its line breaks: each line of an `Inert` text is `Inert`. */
export function inertLines(s: Inert): Inert[] {
  return s.split("\n").map(asInert);
}

/** ASCII punctuation that opens no construct of CommonMark, GFM's tables, markdown-it's strikethrough and linkify or VS Code's math, in any position. */
const MARKDOWN_INERT = new Set([..."/,;'\"?%^{}"]);
const isWordChar = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const isSpaceOrEnd = (c: string | undefined): boolean => c === undefined || /\s/.test(c);

/**
 * One value of the project or of a seat (a file or folder name, a place, a
 * matched line, a seat's sentence) as inert Markdown text: the one function every such value passes on its way into a
 * report file outside a code span, a link label included. Its control characters are written as `valueText` writes
 * them (a line break as `\n`), and every ASCII punctuation character that can open, close or continue a construct is
 * escaped with a backslash, which CommonMark allows before any ASCII punctuation: wherever the value lands in a line,
 * and wherever the line is wrapped, it reads as its own characters (no heading, list, quote, fence, code span, emphasis,
 * link, raw HTML, entity, table cell, automatic link or math). A character is left as it is only where it opens
 * nothing: `MARKDOWN_INERT` always but a `/` after a `/` (`//localhost:9200/x` is a link to linkify); `-` inside a word (a list marker, a rule or an underline starts a word); `_` between
 * two letters or digits (CommonMark's flanking rule); `.` and `)` not after a word `1` (the one ordered-list marker
 * that can interrupt a paragraph) or a digit run that starts the value (which may start a block) and, for `.`, before a space or the value's end (an automatic link needs `x.y`); `:`
 * not before `/` (an automatic link's scheme needs `://`; `mailto:` needs `@`, always escaped); `(` but first (a link's
 * destination follows a `]`). The program's redaction marker (`PROGRAM_MARKER_RE`) is kept as it is, and a `:` right after it
 * escaped. `<` is never left raw: VS Code's preview renders with
 * `html: true`. Not idempotent (a backslash is escaped).
 */
export function markdownText(s: Raw): Inert {
  return escapedText(enteredValue(s));
}
/**
 * `markdownText`'s escapes of a value `enteredValue` returned. The printed redaction runs on the value BEFORE its
 * escapes: an escape splits a credential's shape
 * (`API_TOKEN\=...`, `eyJ...\.eyJ...`), so step 13's net over the finished file and the log's net no longer recognise it
 * and the value reached not-checked.md and the log in clear. It runs once more after `valueText`, for a shape that reads
 * only on one line. The marker it leaves is kept as it is below, for its readers (an inert `[...]`: no `(`, `[` or
 * definition follows).
 */
function escapedText(r: string): Inert {
  return redactPrintedText(printedOutputRedaction(), valueText(r))
    .split(PROGRAM_MARKER_SPLIT())
    // A `:` right after the marker is escaped: at a block's start `[marker]: url` would define a link reference.
    .map((part, i) => (i % 2 === 1 ? part : i > 0 && part.startsWith(":") ? `\\:${inertPart(part.slice(1))}` : inertPart(part)))
    .join("") as Inert;
}
/** `PROGRAM_MARKER_RE` as one capturing group, for `split`. */
/* Made on first use, not at load: credential-redaction.js and this module import each other, and a module that loads
 * credential-redaction first reaches this one before PROGRAM_MARKER_RE is set (a ReferenceError at load). */
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

/**
 * One value of the project as a code span of a report file: its control
 * characters as `valueText` writes them, inside a backtick fence longer than any backtick run it holds, with a space
 * inside each end where it starts or ends with a backtick (`codeSpan`, CommonMark's rule).
 */
export function markdownCode(s: Raw): Inert {
  return asInert(codeSpan(valueText(enteredValue(s))));
}

/** One value inside markdown the program writes (the step summary, the check run): in a code span, so its markdown is text. */
export function markdownValue(s: Raw): Inert {
  return asInert(codeSpan(valueShown(s)));
}

/**
 * An `Inert` text in the printed form (`printedForm`): a control character other than the line break and the tab written
 * as an escape, and a `#` that opens a CI log command (`##[`, `##vso[`) as the six characters of `\u0023`. Neither opens a
 * Markdown construct (an `Inert` text's own `#` and `[` from a value are already escaped), so the text stays inert.
 */
export function inertPrinted(s: Inert): Inert {
  return asInert(printedForm(s));
}

/** The program's own redaction and printed form, as every write of the CLI and of the hooks' entry is handed over. */
export function printedText(text: string): string {
  return printedForm(redactForPrint(text));
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * A chunk handed to a stream's `write`, as `printedText` makes it where it is text; a buffer that is not UTF-8 is not
 * redacted (as before) but is put in the printed form byte for byte, and passed on as bytes.
 */
function printedChunk(chunk: unknown): unknown {
  if (typeof chunk === "string") return printedText(chunk);
  if (chunk instanceof Uint8Array) {
    let text: string;
    try {
      text = strictUtf8.decode(chunk);
    } catch {
      // Read byte for byte (latin1 maps each byte to the code point of its value), so each control byte is one match.
      const bytes = Buffer.from(chunk).toString("latin1");
      const formed = printedForm(bytes);
      return formed === bytes ? chunk : Buffer.from(formed, "latin1");
    }
    const next = printedText(text);
    return next === text ? chunk : Buffer.from(next, "utf8");
  }
  return chunk;
}

/** Each stream's own `write`, from before the hook. */
const unhooked = new Map<NodeJS.WriteStream, (...args: unknown[]) => boolean>();

/** The progress line's erase (progress.ts): the only control sequence this program writes, and so the one past the form. */
export const OWN_ERASE = "\r\u001b[K";

/** Write `OWN_ERASE` to `stream`, past the printed form (a fixed text: no value reaches a terminal this way). */
export function writeOwnErase(stream: NodeJS.WriteStream): boolean {
  const own = unhooked.get(stream);
  return own ? own(OWN_ERASE) : stream.write(OWN_ERASE);
}

let installed = false;

/**
 * From now on every write of this process to stdout and stderr goes through `printedText` (the redaction, then the printed
 * form), and an uncaught error is printed through it too (its stack, then Node's version, as Node prints one) before the
 * process ends with Node's own exit code for it, 1. Called once, first, by the CLI's entry.
 */
export function installPrintedRedaction(): void {
  if (installed) return;
  installed = true;
  for (const stream of [process.stdout, process.stderr]) {
    const original = stream.write.bind(stream) as (...args: unknown[]) => boolean;
    unhooked.set(stream, original);
    stream.write = ((chunk: unknown, ...rest: unknown[]) => original(printedChunk(chunk), ...rest)) as typeof stream.write;
  }
  process.on("uncaughtException", (e: unknown) => {
    const text = e instanceof Error ? (e.stack ?? `${e.name}: ${e.message}`) : `Uncaught ${inspect(e)}`;
    try {
      writeSync(2, `${printedText(text)}\n\nNode.js ${process.version}\n`);
    } finally {
      process.exit(1);
    }
  });
}
