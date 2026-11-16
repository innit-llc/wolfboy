/**
 * The deeper check's copy places, the read that says a copy is still in place, and the limits on a test's text and on
 * the person's report.
 *
 * This module takes every path and every name as a parameter. The runner table chooses each copy's place and each
 * test's selected name; the check's own record holds the copies of earlier checks; nothing here imports either, and
 * nothing here is in the verdict-rules closure. It reads with `lstat` and `realpath` only, and writes nothing.
 *
 * Nothing here is a protection, and no sentence it returns presents one: the copy places keep the person's own `cp`
 * from writing through a name the repository holds, the limits on a test's text serve the person's reading of it, and
 * no check of what a test does is made. There is no allow-list of imports, on purpose: a runner's own API loads any
 * module with no import in the text, so a list of imports would check nothing.
 */
import { lstatSync, type Stats } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { PROGRAM_MARKER_RE } from "./credential-redaction.js";
import { relativePath } from "./project-path.js";
import { realPathIn } from "./project-read.js";
import { redactForPrint } from "./printed-output.js";

/* ============================================ copy places ============================================ */

/** A copy of an earlier check of the same finding, as the check's record holds it. */
export interface EarlierCopy {
  /** Where that check's copy line put the copy (absolute). */
  path: string;
  /** The check's folder name, `2026-11-07T14-02-31`. */
  checkStamp: string;
}

/** Why no copy line is printed for a place, with the sentence the person reads in place of the three lines. */
export type CopyPlaceRefusal =
  | { kind: "earlier-copy"; path: string; checkStamp: string; line: string }
  | { kind: "taken"; path: string; what: string; line: string }
  | { kind: "folder"; path: string; folder: string; what: string; line: string }
  | { kind: "outside"; path: string; line: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A check's folder name as the person reads it: `2026-11-07T14-02-31` is "7 Nov 14-02-31". */
export function checkTimeLabel(stamp: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})$/.exec(stamp);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  if (!m || month === undefined) return stamp;
  return `${Number(m[3])} ${month} ${m[4]}-${m[5]}-${m[6]}`;
}

/** What `lstat` found at a name, in the person's words. */
export function whatStands(st: Stats): string {
  if (st.isSymbolicLink()) return "a link";
  if (st.isDirectory()) return "a folder";
  if (st.isFile()) return st.nlink > 1 ? "a file with another name elsewhere (a hard link)" : "a file";
  if (st.isFIFO()) return "a named pipe";
  if (st.isSocket()) return "a socket";
  if (st.isCharacterDevice() || st.isBlockDevice()) return "a device";
  return "something that is not a file";
}

type Look = { found: false } | { found: true; st: Stats } | { found: true; st: null; code: string };

/** One `lstat`: nothing there, what is there, or a name that could not be looked at (which counts as found). */
function look(path: string): Look {
  try {
    return { found: true, st: lstatSync(path) };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? "unknown";
    if (code === "ENOENT") return { found: false };
    return { found: true, st: null, code };
  }
}

const describe = (l: Look & { found: true }): string => (l.st === null ? `a name WolfBoy could not look at (${l.code})` : whatStands(l.st));

/** "the copy from the check of 7 Nov 14-02-31 is still at <path>; delete it first". */
export function earlierCopyLine(checkStamp: string, path: string): string {
  return `the copy from the check of ${checkTimeLabel(checkStamp)} is still at ${path}; delete it first`;
}

/**
 * Whether a copy line may name `copyPath` inside `projectRoot`. It may only where
 * nothing stands at the name, a link of any kind included (an `lstat`, never `existsSync`, which is false for a link
 * that leads nowhere), and where every folder on the way from the project folder to it is a folder, not a link of any
 * kind, and leads inside the project by its real path (a Windows junction that `lstat` reports as a folder). A name an
 * earlier check of the same finding gave its copy, still a file there, gets the "delete it first" line.
 * `null`: the place is free and the three lines may be printed. The project folder itself is the person's and is not
 * looked at. Paths must be absolute. `makes`: how many of the last folders on the way the printed lines make
 * (`RunnerChoice.missingFolders`); one of those not there is no refusal, since the make line makes it under the folders
 * looked at so far (rf11 I-D part 3: without it, every copy into a folder D5's make line makes was refused here, so the
 * make and unmake lines were never printed).
 */
export function copyPlaceRefusal(projectRoot: string, copyPath: string, earlier: readonly EarlierCopy[] = [], makes = 0): CopyPlaceRefusal | null {
  if (!isAbsolute(projectRoot) || !isAbsolute(copyPath)) throw new TypeError("copyPlaceRefusal: the project folder and the copy's place must be absolute paths");
  const root = resolve(projectRoot);
  const path = resolve(copyPath);
  const rel = relativePath(root, path);
  const names = rel.split("/");
  // The sentences below, in place of the three lines.
  if (rel === "" || isAbsolute(rel) || names[0] === "..") {
    return { kind: "outside", path, line: `WolfBoy prints no copy line: ${path} is outside this project folder` };
  }
  let folder = root;
  const way = names.slice(0, -1);
  for (const [i, name] of way.entries()) {
    folder = join(folder, name);
    const l = look(folder);
    if (!l.found && i >= way.length - makes) return null;
    const refuse = (what: string): CopyPlaceRefusal => ({
      kind: "folder",
      path,
      folder,
      what,
      line: `WolfBoy prints no copy line: ${folder}, a folder on the way to ${path}, is ${what}, and a copy there could land outside this project`,
    });
    if (!l.found) return { kind: "folder", path, folder, what: "nothing", line: `WolfBoy prints no copy line: the folder ${folder} is not there` };
    if (l.st === null || !l.st.isDirectory()) return refuse(describe(l));
    try {
      if (!realPathIn(folder, root).inside) return refuse("a name that leads outside this project folder");
    } catch (e) {
      return refuse(`a name WolfBoy could not follow (${(e as NodeJS.ErrnoException).code ?? "unknown"})`);
    }
  }
  const at = look(path);
  if (!at.found) return null;
  const mine = earlier.find((e) => isAbsolute(e.path) && relativePath(resolve(e.path), path) === "");
  if (mine && at.st !== null && at.st.isFile() && !at.st.isSymbolicLink()) {
    return { kind: "earlier-copy", path, checkStamp: mine.checkStamp, line: earlierCopyLine(mine.checkStamp, path) };
  }
  const what = describe(at);
  return { kind: "taken", path, what, line: `WolfBoy prints no copy line: ${what} already stands at ${path}, and WolfBoy never names a place where anything stands` };
}

/* ===================================== a copy still in place, in either class ===================================== */

/** A copy on record: the finding's label on this screen (`F1`) and where the check's copy line put the copy. */
export interface CopyOnRecord {
  label: string;
  path: string;
}

/**
 * Whether a copy is still at its place: one `lstat`, nothing else. Anything found there
 * counts, a link included; a name that cannot be looked at counts too, so that the line is shown rather than lost.
 */
export function copyStillInPlace(path: string): boolean {
  return look(path).found;
}

/** The reply's, the finding file's and `explain`'s line: "the copy is still at <path>; delete it". */
export function copyStillLine(path: string): string {
  return `the copy is still at ${path}; delete it`;
}

/**
 * The end screen's lines for the copies still in place, one per copy, never cut: "F1: the copy of its test is still at
 * <path>; delete it". They go after the block and before the report's path, outside the block's budget
 * (assemble-report.ts `endScreenRf11`: between `END_SCREEN_CLOSE` and `Report: <path>`).
 */
export function endScreenCopyLines(copies: readonly CopyOnRecord[]): string[] {
  return copies.filter((c) => copyStillInPlace(c.path)).map((c) => `${c.label}: the copy of its test is still at ${c.path}; delete it`);
}

/**
 * `explain`'s lines for one finding's copies still in place: each is the line after the first, and the file's first
 * screen shows that many lines fewer (explain.ts `explainLines`). Never cut: a path is never cut.
 */
export function explainCopyLines(paths: readonly string[]): string[] {
  return paths.filter((p) => copyStillInPlace(p)).map(copyStillLine);
}

/* ======================= the test's text: lines, width, characters and the selected name ======================= */

export const TEST_TEXT_MAX_LINES = 80;
export const TEST_TEXT_MAX_WIDTH = 120;
export const TEST_TEXT_TAB_WIDTH = 8;

/** Why WolfBoy writes no test from the seat's text, with step 2's sentence. */
export type TestTextRefusal =
  | { kind: "lines"; lines: number; line: string }
  | { kind: "width"; at: number; width: number; line: string }
  | { kind: "character"; at: number; codePoint: number; name: string; line: string }
  | { kind: "name"; name: string; line: string };

/** A name the printed command selects; `declared`, where the runner table gives it, is the form that declares it. */
export interface SelectedName {
  name: string;
  declared?: RegExp;
}

/**
 * The characters refused, judged by Unicode category rather than by a list: Cc (but
 * the tab and the line end, held apart below), Cf, Zl, Zp, Zs (but the space), Co, Cn and Cs as this Node.js knows
 * them, every Default_Ignorable_Code_Point (the class the invisible letters belong to: the Hangul fillers, the variation
 * selectors, U+034F, U+17B4-U+17B5, U+180B-U+180F), and the four Hangul fillers by name.
 */
// Built from a string, so that the compiled file holds the escapes and no invisible character (tsc writes a regular
// expression literal's \u escapes out as the characters it names).
const REFUSED_CHARACTER = new RegExp("[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}\\p{Zs}\\p{Co}\\p{Cn}\\p{Cs}\\p{Default_Ignorable_Code_Point}\\u115F\\u1160\\u3164\\uFFA0]", "u");

/** Whether a character is refused in a test's text (the tab and the space are not; a line end is held apart by the caller). */
export function refusedCharacter(ch: string): boolean {
  return ch !== "\t" && ch !== " " && REFUSED_CHARACTER.test(ch);
}

/* The Unicode names of the refused characters that have one, beside the categories' own (from Python 3.12's unicodedata,
 * Unicode 15.0, checked once against it); a refused character with no name here is
 * named by its kind ("<unassigned>", "<private use>"). The variation selectors and the tag characters are named by rule. */
const C0_NAMES =
  "NULL|START OF HEADING|START OF TEXT|END OF TEXT|END OF TRANSMISSION|ENQUIRY|ACKNOWLEDGE|ALERT|BACKSPACE|CHARACTER TABULATION|" +
  "LINE FEED|LINE TABULATION|FORM FEED|CARRIAGE RETURN|SHIFT OUT|SHIFT IN|DATA LINK ESCAPE|DEVICE CONTROL ONE|DEVICE CONTROL TWO|" +
  "DEVICE CONTROL THREE|DEVICE CONTROL FOUR|NEGATIVE ACKNOWLEDGE|SYNCHRONOUS IDLE|END OF TRANSMISSION BLOCK|CANCEL|END OF MEDIUM|" +
  "SUBSTITUTE|ESCAPE|INFORMATION SEPARATOR FOUR|INFORMATION SEPARATOR THREE|INFORMATION SEPARATOR TWO|INFORMATION SEPARATOR ONE";
const C1_NAMES =
  "PADDING CHARACTER|HIGH OCTET PRESET|BREAK PERMITTED HERE|NO BREAK HERE|INDEX|NEXT LINE|START OF SELECTED AREA|END OF SELECTED AREA|" +
  "CHARACTER TABULATION SET|CHARACTER TABULATION WITH JUSTIFICATION|LINE TABULATION SET|PARTIAL LINE FORWARD|PARTIAL LINE BACKWARD|" +
  "REVERSE LINE FEED|SINGLE SHIFT TWO|SINGLE SHIFT THREE|DEVICE CONTROL STRING|PRIVATE USE ONE|PRIVATE USE TWO|SET TRANSMIT STATE|" +
  "CANCEL CHARACTER|MESSAGE WAITING|START OF GUARDED AREA|END OF GUARDED AREA|START OF STRING|SINGLE GRAPHIC CHARACTER INTRODUCER|" +
  "SINGLE CHARACTER INTRODUCER|CONTROL SEQUENCE INTRODUCER|STRING TERMINATOR|OPERATING SYSTEM COMMAND|PRIVACY MESSAGE|" +
  "APPLICATION PROGRAM COMMAND";
const NAMED =
  "00A0 NO-BREAK SPACE;00AD SOFT HYPHEN;034F COMBINING GRAPHEME JOINER;0600 ARABIC NUMBER SIGN;0601 ARABIC SIGN SANAH;" +
  "0602 ARABIC FOOTNOTE MARKER;0603 ARABIC SIGN SAFHA;0604 ARABIC SIGN SAMVAT;0605 ARABIC NUMBER MARK ABOVE;" +
  "061C ARABIC LETTER MARK;06DD ARABIC END OF AYAH;070F SYRIAC ABBREVIATION MARK;0890 ARABIC POUND MARK ABOVE;" +
  "0891 ARABIC PIASTRE MARK ABOVE;08E2 ARABIC DISPUTED END OF AYAH;115F HANGUL CHOSEONG FILLER;1160 HANGUL JUNGSEONG FILLER;" +
  "1680 OGHAM SPACE MARK;17B4 KHMER VOWEL INHERENT AQ;17B5 KHMER VOWEL INHERENT AA;180B MONGOLIAN FREE VARIATION SELECTOR ONE;" +
  "180C MONGOLIAN FREE VARIATION SELECTOR TWO;180D MONGOLIAN FREE VARIATION SELECTOR THREE;180E MONGOLIAN VOWEL SEPARATOR;" +
  "180F MONGOLIAN FREE VARIATION SELECTOR FOUR;2000 EN QUAD;2001 EM QUAD;2002 EN SPACE;2003 EM SPACE;2004 THREE-PER-EM SPACE;" +
  "2005 FOUR-PER-EM SPACE;2006 SIX-PER-EM SPACE;2007 FIGURE SPACE;2008 PUNCTUATION SPACE;2009 THIN SPACE;200A HAIR SPACE;" +
  "200B ZERO WIDTH SPACE;200C ZERO WIDTH NON-JOINER;200D ZERO WIDTH JOINER;200E LEFT-TO-RIGHT MARK;200F RIGHT-TO-LEFT MARK;" +
  "2028 LINE SEPARATOR;2029 PARAGRAPH SEPARATOR;202A LEFT-TO-RIGHT EMBEDDING;202B RIGHT-TO-LEFT EMBEDDING;" +
  "202C POP DIRECTIONAL FORMATTING;202D LEFT-TO-RIGHT OVERRIDE;202E RIGHT-TO-LEFT OVERRIDE;202F NARROW NO-BREAK SPACE;" +
  "205F MEDIUM MATHEMATICAL SPACE;2060 WORD JOINER;2061 FUNCTION APPLICATION;2062 INVISIBLE TIMES;2063 INVISIBLE SEPARATOR;" +
  "2064 INVISIBLE PLUS;2066 LEFT-TO-RIGHT ISOLATE;2067 RIGHT-TO-LEFT ISOLATE;2068 FIRST STRONG ISOLATE;2069 POP DIRECTIONAL ISOLATE;" +
  "206A INHIBIT SYMMETRIC SWAPPING;206B ACTIVATE SYMMETRIC SWAPPING;206C INHIBIT ARABIC FORM SHAPING;206D ACTIVATE ARABIC FORM SHAPING;" +
  "206E NATIONAL DIGIT SHAPES;206F NOMINAL DIGIT SHAPES;3000 IDEOGRAPHIC SPACE;3164 HANGUL FILLER;FEFF ZERO WIDTH NO-BREAK SPACE;" +
  "FFA0 HALFWIDTH HANGUL FILLER;FFF9 INTERLINEAR ANNOTATION ANCHOR;FFFA INTERLINEAR ANNOTATION SEPARATOR;" +
  "FFFB INTERLINEAR ANNOTATION TERMINATOR;110BD KAITHI NUMBER SIGN;110CD KAITHI NUMBER SIGN ABOVE;" +
  "13430 EGYPTIAN HIEROGLYPH VERTICAL JOINER;13431 EGYPTIAN HIEROGLYPH HORIZONTAL JOINER;13432 EGYPTIAN HIEROGLYPH INSERT AT TOP START;" +
  "13433 EGYPTIAN HIEROGLYPH INSERT AT BOTTOM START;13434 EGYPTIAN HIEROGLYPH INSERT AT TOP END;" +
  "13435 EGYPTIAN HIEROGLYPH INSERT AT BOTTOM END;13436 EGYPTIAN HIEROGLYPH OVERLAY MIDDLE;13437 EGYPTIAN HIEROGLYPH BEGIN SEGMENT;" +
  "13438 EGYPTIAN HIEROGLYPH END SEGMENT;13439 EGYPTIAN HIEROGLYPH INSERT AT MIDDLE;1343A EGYPTIAN HIEROGLYPH INSERT AT TOP;" +
  "1343B EGYPTIAN HIEROGLYPH INSERT AT BOTTOM;1343C EGYPTIAN HIEROGLYPH BEGIN ENCLOSURE;1343D EGYPTIAN HIEROGLYPH END ENCLOSURE;" +
  "1343E EGYPTIAN HIEROGLYPH BEGIN WALLED ENCLOSURE;1343F EGYPTIAN HIEROGLYPH END WALLED ENCLOSURE;" +
  "1BCA0 SHORTHAND FORMAT LETTER OVERLAP;1BCA1 SHORTHAND FORMAT CONTINUING OVERLAP;1BCA2 SHORTHAND FORMAT DOWN STEP;" +
  "1BCA3 SHORTHAND FORMAT UP STEP;1D173 MUSICAL SYMBOL BEGIN BEAM;1D174 MUSICAL SYMBOL END BEAM;1D175 MUSICAL SYMBOL BEGIN TIE;" +
  "1D176 MUSICAL SYMBOL END TIE;1D177 MUSICAL SYMBOL BEGIN SLUR;1D178 MUSICAL SYMBOL END SLUR;1D179 MUSICAL SYMBOL BEGIN PHRASE;" +
  "1D17A MUSICAL SYMBOL END PHRASE";
/* The tag characters U+E0021-U+E007E are "TAG " and the name of the ASCII character 0x21-0x7E. */
const ASCII_PUNCTUATION_NAMES: Record<string, string> = {
  "!": "EXCLAMATION MARK", '"': "QUOTATION MARK", "#": "NUMBER SIGN", $: "DOLLAR SIGN", "%": "PERCENT SIGN", "&": "AMPERSAND",
  "'": "APOSTROPHE", "(": "LEFT PARENTHESIS", ")": "RIGHT PARENTHESIS", "*": "ASTERISK", "+": "PLUS SIGN", ",": "COMMA",
  "-": "HYPHEN-MINUS", ".": "FULL STOP", "/": "SOLIDUS", ":": "COLON", ";": "SEMICOLON", "<": "LESS-THAN SIGN", "=": "EQUALS SIGN",
  ">": "GREATER-THAN SIGN", "?": "QUESTION MARK", "@": "COMMERCIAL AT", "[": "LEFT SQUARE BRACKET", "\\": "REVERSE SOLIDUS",
  "]": "RIGHT SQUARE BRACKET", "^": "CIRCUMFLEX ACCENT", _: "LOW LINE", "`": "GRAVE ACCENT", "{": "LEFT CURLY BRACKET",
  "|": "VERTICAL LINE", "}": "RIGHT CURLY BRACKET", "~": "TILDE",
};
const DIGIT_NAMES = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE"];
let namedTable: Map<number, string> | undefined;

function asciiName(ch: string): string {
  if (/[A-Z]/.test(ch)) return `LATIN CAPITAL LETTER ${ch}`;
  if (/[a-z]/.test(ch)) return `LATIN SMALL LETTER ${ch.toUpperCase()}`;
  if (/[0-9]/.test(ch)) return `DIGIT ${DIGIT_NAMES[Number(ch)]}`;
  return ASCII_PUNCTUATION_NAMES[ch] ?? "";
}

/** A refused character's Unicode name, or its kind in angle brackets where it has none (a control's is its alias). */
export function characterName(cp: number): string {
  if (cp <= 0x1f) return C0_NAMES.split("|")[cp] as string;
  if (cp === 0x7f) return "DELETE";
  if (cp >= 0x80 && cp <= 0x9f) return C1_NAMES.split("|")[cp - 0x80] as string;
  if (cp >= 0xfe00 && cp <= 0xfe0f) return `VARIATION SELECTOR-${cp - 0xfe00 + 1}`;
  if (cp >= 0xe0100 && cp <= 0xe01ef) return `VARIATION SELECTOR-${cp - 0xe0100 + 17}`;
  if (cp === 0xe0001) return "LANGUAGE TAG";
  if (cp === 0xe0020) return "TAG SPACE";
  if (cp === 0xe007f) return "CANCEL TAG";
  if (cp >= 0xe0021 && cp <= 0xe007e) return `TAG ${asciiName(String.fromCharCode(cp - 0xe0000))}`;
  namedTable ??= new Map(NAMED.split(";").map((e) => [Number.parseInt(e.slice(0, e.indexOf(" ")), 16), e.slice(e.indexOf(" ") + 1)]));
  const named = namedTable.get(cp);
  if (named !== undefined) return named;
  const ch = String.fromCodePoint(cp);
  if (/\p{Cs}/u.test(ch)) return "<surrogate>";
  if (/\p{Co}/u.test(ch)) return "<private use>";
  if (/\p{Cn}/u.test(ch)) return (cp & 0xfffe) === 0xfffe || (cp >= 0xfdd0 && cp <= 0xfdef) ? "<noncharacter>" : "<unassigned>";
  if (/\p{Cf}/u.test(ch)) return "<format character>";
  if (/\p{Zs}/u.test(ch)) return "<space>";
  return "<invisible character>";
}

/** `U+3164 HANGUL FILLER`: the code point in at least four hex digits and its name. */
export function codePointLabel(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")} ${characterName(cp)}`;
}

/** A text's lines: split at each line feed, a carriage return before it kept on its line; a final line feed ends the last. */
function textLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return text === "" ? [] : lines;
}

/** A line's width as the limit counts it: each character one (a code point), a tab eight. */
export function lineWidth(line: string): number {
  let w = 0;
  for (const ch of line) w += ch === "\t" ? TEST_TEXT_TAB_WIDTH : 1;
  return w;
}

const ID_CHAR = "[\\p{ID_Continue}$\\u200C\\u200D]";
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether `text` carries `name` as a whole name: no letter, digit, `_` or `$` joined to it on either side. */
export function carriesName(text: string, name: string): boolean {
  return new RegExp(`(?<!${ID_CHAR})${escapeRe(name).replace(/ +/g, "[ \\t]+")}(?!${ID_CHAR})`, "u").test(text);
}

/**
 * Whether WolfBoy writes the seat's text as the test (a name check, which protects
 * nothing): at most 80 lines, each at most 120 characters (a tab counted as 8), no refused character (a carriage
 * return only directly before a line feed), and, where the runner selects a test by name, every selected name in it.
 * `null`: it is written. The first reason found is returned, its line named; nothing here looks at what the test does.
 * There is no list of imports: a text that imports a shell, a file system or a network module is written like any other.
 */
export function testTextRefusal(text: string, selected: readonly (string | SelectedName)[] = []): TestTextRefusal | null {
  const lines = textLines(text);
  if (lines.length > TEST_TEXT_MAX_LINES) {
    return { kind: "lines", lines: lines.length, line: `WolfBoy wrote no test: the AI's text has ${lines.length} lines, too many to read whole (at most ${TEST_TEXT_MAX_LINES})` };
  }
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] as string;
    const line = raw.endsWith("\r") && i < lines.length - (text.endsWith("\n") ? 0 : 1) ? raw.slice(0, -1) : raw;
    for (const ch of line) {
      if (!refusedCharacter(ch)) continue;
      const cp = ch.codePointAt(0) as number;
      return {
        kind: "character",
        at: i + 1,
        codePoint: cp,
        name: characterName(cp),
        line: `WolfBoy wrote no test: line ${i + 1} of the AI's text holds a character that can make what you read differ from what runs (${codePointLabel(cp)})`,
      };
    }
    const width = lineWidth(line);
    if (width > TEST_TEXT_MAX_WIDTH) {
      return { kind: "width", at: i + 1, width, line: `WolfBoy wrote no test: line ${i + 1} is longer than ${TEST_TEXT_MAX_WIDTH} characters, too long to read whole` };
    }
  }
  for (const s of selected) {
    const { name, declared } = typeof s === "string" ? { name: s, declared: undefined } : s;
    if (declared ? declared.test(text) : carriesName(text, name)) continue;
    return { kind: "name", name, line: `WolfBoy wrote no test: the AI's text does not carry ${name}, the name the command selects` };
  }
  return null;
}

/* ============================================ the person's report ============================================ */

export const REPORT_MAX_LINES = 400;

/** What is kept of an answer to the report's question, and the reply that says so. */
export type ReportAnswer = { kept: false; lines: number; reply: string } | { kept: true; text: string; lines: number; replaced: number; reply: string };

/** An answer's line count: its line feeds, and one more where the last line does not end in one. */
export function answerLines(text: string): number {
  return textLines(text).length;
}

const markerCount = (s: string): number => s.match(new RegExp(PROGRAM_MARKER_RE.source, "g"))?.length ?? 0;

/**
 * The person's answer to the report's question. Over 400 lines: refused,
 * nothing of it returned, so nothing of it can be kept, and the check stays open. Otherwise kept as given, credential
 * patterns redacted as in printed text (`redact`, the CLI's printed redaction unless a test passes another), with the
 * reply that says how many lines were kept and how many strings that looked like keys were replaced. Pure: it runs
 * nothing and writes nothing, whatever the text holds.
 */
export function reportAnswer(answer: string, label: string, redact: (text: string) => string = redactForPrint): ReportAnswer {
  return reportReplyOf(reportScreen(answer, redact), label);
}

/**
 * The check alone, with no reply: what the relay runs on the person's typed
 * answer BEFORE it writes anything of it (hook-question.ts `screenTypedAnswers`, registered in hook-child.ts), so a refused
 * answer is never written and a kept one is never written unredacted. `reportAnswer` is this and its reply.
 */
export function reportScreen(answer: string, redact: (text: string) => string = redactForPrint): { kept: false; lines: number } | { kept: true; text: string; lines: number; replaced: number } {
  const lines = answerLines(answer);
  if (lines > REPORT_MAX_LINES) return { kept: false, lines };
  const text = redact(answer);
  const replaced = text === answer ? 0 : Math.max(1, markerCount(text) - markerCount(answer));
  return { kept: true, text, lines, replaced };
}

/** The reply to a checked answer (`reportScreen`'s result), for the finding `label`. */
export function reportReplyOf(r: { kept: false; lines: number } | { kept: true; text: string; lines: number; replaced: number }, label: string): ReportAnswer {
  if (!r.kept) {
    return {
      kept: false,
      lines: r.lines,
      reply: `Your answer has ${r.lines} lines, and WolfBoy keeps at most ${REPORT_MAX_LINES}; nothing was kept. Say 'I ran it' again and paste the end of the output, where the runner prints its result.`,
    };
  }
  const { text, lines, replaced } = r;
  // The plural and the singular of the reply.
  const keys = replaced === 0 ? "nothing looked like a key" : replaced === 1 ? "1 string that looked like a key was replaced" : `${replaced} strings that looked like keys were replaced`;
  return { kept: true, text, lines, replaced, reply: `Kept in ${label}'s file as your report: ${lines} ${lines === 1 ? "line" : "lines"}; ${keys}.` };
}

/** The reply where the relay could not check the answer, so it wrote none of it. */
export const REPORT_UNCHECKED_REPLY = "WolfBoy could not check your answer, so nothing of it was kept. Say 'I ran it' again and paste the end of the output.";

/**
 * The report as the relay checked it: `keptText` is the answer file's kept text
 * (the taken label), `lines` and `replaced` the counts the relay's check gave. Nothing is checked again here.
 */
export function reportFromRelay(screened: { kept: boolean; lines: number | null; replaced: number | null }, keptText: string, label: string): ReportAnswer {
  if (screened.kept && screened.lines !== null && screened.replaced !== null) return reportReplyOf({ kept: true, text: keptText, lines: screened.lines, replaced: screened.replaced }, label);
  if (!screened.kept && screened.lines !== null) return reportReplyOf({ kept: false, lines: screened.lines }, label);
  return { kept: false, lines: screened.lines ?? 0, reply: REPORT_UNCHECKED_REPLY };
}
