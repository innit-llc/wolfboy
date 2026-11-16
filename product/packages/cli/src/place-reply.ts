/**
 * THE PER-PLACE REPLY AND ITS CAPTURE CHECKS.
 *
 * A seat handed places of a candidate read by the place plan (`reading-plan-2`, unit `place`; build unit F1) answers one
 * row per place, by the place's id (`P<n>`, written into its payload by build unit F2): `decision`, `data`, `item` where
 * the rule's items are found by reading, `line` and a verbatim `quote` on every row, `why`, and `beyond` only where a
 * decision or its data rests on a line outside the place's window. There is no group row and nothing to decline: no
 * `unit`, `units`, `rest`, `also`, `decline`, `declined` or `not_checked` (design 1.5, the reply).
 *
 * The checks, each refusing the answer with the ids it names (design 1.7; the seat amends what the refusal named):
 *   C1 every place of the seat's payload has exactly one row;            C2 no id outside the seat's payload;
 *   C3 the decision and data words; `item` where the rule needs it; `data` is `[]` on `not_the_construct` (W0);
 *   C4 `line` inside the place's window (a fact place: its matched line);
 *   C5 `quote` a verbatim part of that line, at least 15 characters or the whole line, on every row;
 *   C6 one row decides one place (no `unit`, `units`, `places`, `members`);
 *   C7 THE H1 READ RULE, per Read range: the seat's own transcript shows a Read whose returned range covers the lines of
 *      its payload's reading copy that hold this place's window (the excerpt; a fact place: its row), every range of it,
 *      or a Read of the source covering the window's lines. A search never counts; no transcript, nothing counts;
 *   C8 no field of the old form (`not_checked`, `declined`, `decline`, `rest`, `also`, `disposition`, `ground`, `at`);
 *   C9 `beyond`: its file is in the tree, its quote a verbatim part of its line (moved to the nearest line holding it
 *      where the line number drifted, as C5), and the seat's own Reads of that file cover that line.
 *   C10 ON A ROW THAT CLOSES A PLACE (`not_the_construct`, place-bar.ts
 *      `isClosingDecision`, the definition A4 reads too):
 *      a `why` that names a line outside the place's window (`file:line`, a range, `file line N`, `file#L6`,
 *      `lines 6-8 of file`, an absolute path included) rests only on lines the seat's own Reads cover, and one of them
 *      is the row's `beyond`: a seat cannot close a place on the strength of a line it never opened. A row that keeps a
 *      place or leaves it `undetermined` stays in front of the person whatever its `why` names, and is not held.
 *
 * An accepted row becomes the record's `reading.read` row of the place's unit (`L<n>`, the plan's id for the same
 * location), at the seat's line, with the place's fields beside it, so the assembly, the coverage check and the quote
 * check read it as any row. A place that is `unreadable` (the program could not write its window) owes no row: the
 * program records it as not checked before launch.
 */
import { existsSync, readdirSync, realpathSync, statSync, type Dirent } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { relativePath } from "./project-path.js";
import type { Candidate } from "wolfboy-schemas";
import type { PlaceStanding } from "./place-answer.js";
import { lineSafeJson, payloadAtomic, READ_LINE_LIMIT } from "./launch-plan.js";
import { readCovers, type SeatPayload, type SeatSight } from "./seat-opened.js";
import { compactIds, PLACE_GATE_KINDS, readingClassOf, type PlaceGateKind, type ReadingDisposition, type ReadingReadRow } from "./reading.js";
import { isClosingDecision } from "./place-bar.js";
import { PLACE_PREMISES_SPEC, placeAt, placeKeyOf, placeWindowsOfPayload, seatPremisesOf, seatUntakenOf, type PlacePremises, type PlaceWindow } from "./place-premises.js";
import { TreeReader } from "./rests-on.js";
import { readRegularFile, readSourceText } from "./project-read.js";
import { quotationRanges } from "./reconcile-verify.js";
import { isPlaceId, placeId, unitOfPlace } from "./ref-ids.js";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** The decision words (design 1.5): the four a seat disposes with. */
export const PLACE_DECISIONS: readonly string[] = ["is_the_construct", "not_the_construct", "construct_but_gated", "undetermined"];
/** The data words (design 1.5), and no seventh. */
export const PLACE_DATA_WORDS: readonly string[] = ["email", "name", "user_id", "ip_or_device", "user_content", "other_personal"];
/** The fields of a place row (design 1.5); anything else is refused. */
export const PLACE_ROW_FIELDS: readonly string[] = ["place", "decision", "gate", "gate_words", "data", "item", "line", "quote", "why", "beyond"];
/** C6: the fields of a row that decides more than one place, or a unit of them. */
export const GROUP_ROW_FIELDS: readonly string[] = ["unit", "units", "places", "members"];
/** C8: the fields of the old form (the shape cover, the seat's declines, the seat's not-checked list, the old words). */
export const OLD_FORM_FIELDS: readonly string[] = ["not_checked", "declined", "decline", "rest", "also", "disposition", "ground", "at", "reading"];
/** C5: the shortest quote accepted unless it is the whole line. */
export const PLACE_QUOTE_MIN_CHARS = 15;

/** A candidate read by the place plan (`reading-plan-2`, unit `place`; build unit F1). */
export function isPlacePlanCandidate(c: Candidate): boolean {
  return (c.reading_plan as { unit?: string } | undefined)?.unit === "place";
}

/** One place as the seat's payload gave it. */
export interface PlaceGiven {
  place: string;
  /** The plan's unit id for the same location (`L<n>`). */
  unit: string;
  file: string;
  matched: number;
  given: "window" | "fact" | "unreadable";
  /** The place's own window lines (windowed places). */
  window?: [number, number];
  /** The excerpts the place's text is in: its window's first, then its import region's and enclosing lines' excerpts. */
  excerpts: string[];
  /** A fact place's line, as the payload carries it. */
  factText?: string;
  /** The lines of the payload's reading copy that hold the place's row (1-based), where the copy could be matched. */
  rowSpan?: [number, number];
}

interface ExcerptGiven {
  file: string;
  start: number;
  end: number;
  lines: string[];
  /** The lines of the reading copy that hold this excerpt (1-based), where the copy could be matched. */
  span?: [number, number];
}

/** What a seat was handed, read back from its payload and its reading copy (`placePayloadOf`). */
export interface PlacePayload {
  /** The places of each candidate the payload holds in the place form, by finding id. */
  places: Map<string, PlaceGiven[]>;
  excerpts: Map<string, ExcerptGiven>;
  /** The reading copy the seat's brief names, absolute; its spans are known only where `copyMatches`. */
  copyPath: string;
  copyMatches: boolean;
  /** Build unit F5: the payload file itself, absolute, and each place's window digest (premise 5), by finding id. */
  payloadPath?: string;
  windows?: Map<string, Map<string, PlaceWindow>>;
}

/**
 * THE PLACES A SEAT WAS HANDED, from the payload its launch entry names (`payload_path`) and the reading copy its brief
 * names: every candidate row that carries a `place` id, with what it was given, and, where the reading copy is exactly
 * the line-safe text the pre-launch step writes of that payload (`seatReadOf`), the copy's lines that hold each excerpt
 * and each place row (`lineSafeJson`'s atomic values: a Read range never cuts one unless it is larger than a range).
 * A payload that cannot be read gives `problem`; a copy that does not match gives no span, so only a Read of the source
 * counts for C7 then (fails closed).
 */
export function placePayloadOf(p: SeatPayload, ships?: ReadonlyMap<string, string>): PlacePayload | { problem: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readRegularFile(p.payloadPath, "utf8"));
  } catch (e) {
    return { problem: `the payload ${p.payloadPath} cannot be read back (${(e as Error).message})` };
  }
  if (!isObj(parsed)) return { problem: `the payload ${p.payloadPath} is not a JSON object` };
  const atomic = { at: payloadAtomic, spans: [] as [number, number][], paths: [] as (string | number)[][] };
  let copyMatches = false;
  let copyLines: string[] = [];
  try {
    const copy = `${lineSafeJson(parsed, READ_LINE_LIMIT, "", true, atomic)}\n`;
    copyMatches = readRegularFile(p.readPath, "utf8") === copy;
    if (copyMatches) copyLines = copy.split("\n");
  } catch {
    copyMatches = false;
  }
  /* A place row (or an excerpt) with no line of its own: the reading copy writes an object whose one-line form fits on one line
   * (`rowsOnOneLine`), so in a small payload a whole candidate, or the whole `candidates` array, is one line and its
   * place rows are inside it. That line holds the row's own one-line form verbatim (an object's one-line form is its
   * members' one-line forms joined), so the line is found by that text; a row on no line, or on two, has no span. */
  const lineHolding = (value: unknown): [number, number] | undefined => {
    const text = JSON.stringify(value);
    const at = copyLines.flatMap((l, i) => (l.includes(text) ? [i + 1] : []));
    return at.length === 1 ? [at[0]!, at[0]!] : undefined;
  };
  const spanOf = new Map<string, [number, number]>();
  if (copyMatches) atomic.paths.forEach((path, i) => spanOf.set(path.join("/"), [atomic.spans[i]![0] + 1, atomic.spans[i]![1] + 1]));
  const excerpts = new Map<string, ExcerptGiven>();
  (Array.isArray(parsed.excerpts) ? parsed.excerpts : []).forEach((e, i) => {
    if (!isObj(e) || typeof e.id !== "string" || typeof e.file !== "string") return;
    const start = Number(e.start_line);
    const end = Number(e.end_line);
    if (!Number.isInteger(start) || !Number.isInteger(end)) return;
    // An excerpt with no line of its own (a small payload's whole `excerpts` array on one line) is found the same way
    // as a place row with none: by the one line that holds its one-line form (F3 smoke session, test:place-plan P31).
    const span = spanOf.get(`excerpts/${i}`) ?? (copyMatches ? lineHolding(e) : undefined);
    excerpts.set(e.id, { file: e.file, start, end, lines: typeof e.text === "string" ? e.text.split("\n") : [], ...(span ? { span } : {}) });
  });
  const places = new Map<string, PlaceGiven[]>();
  (Array.isArray(parsed.candidates) ? parsed.candidates : []).forEach((c, j) => {
    if (!isObj(c) || typeof c.finding_id !== "string" || !Array.isArray(c.locations)) return;
    const list: PlaceGiven[] = [];
    c.locations.forEach((l, k) => {
      if (!isObj(l) || !isPlaceId(l.place) || typeof l.file !== "string") return;
      const given = l.given === "window" || l.given === "fact" ? l.given : "unreadable";
      const ctx = isObj(l.context) ? l.context : null;
      const wl = ctx && Array.isArray(ctx.window_lines) ? ctx.window_lines.map(Number) : [];
      const named = ctx ? [ctx.window, ctx.imports, ...(Array.isArray(ctx.encloses) ? ctx.encloses : [])].filter((x): x is string => typeof x === "string") : [];
      const fact = isObj(l.fact) ? l.fact : null;
      const rowSpan = spanOf.get(`candidates/${j}/locations/${k}`) ?? (copyMatches ? lineHolding(l) : undefined);
      list.push({
        place: l.place,
        unit: unitOfPlace(l.place) ?? l.place,
        file: l.file,
        matched: Number(l.start_line),
        given,
        ...(given === "window" && wl.length === 2 && wl.every(Number.isInteger) ? { window: [wl[0]!, wl[1]!] as [number, number] } : {}),
        excerpts: named,
        ...(fact && typeof fact.text === "string" ? { factText: fact.text } : {}),
        ...(rowSpan ? { rowSpan } : {}),
      });
    });
    if (list.length > 0) places.set(c.finding_id, list);
  });
  return { places, excerpts, copyPath: resolve(p.readPath), copyMatches, payloadPath: resolve(p.payloadPath), windows: placeWindowsOfPayload(parsed, ships) };
}

/** What the capture holds to check a place seat's rows: its payload, its own transcript's Reads, and the tree. */
/**
 * Unit U1: where the capture keeps, under the project's `.legal/`, the place rows of a seat whose answer
 * ended without a record (verdict-capture.ts `keepReadPlaces`). Here, beside the place checks, so that the make-up seat
 * (makeup-seat.ts) and the readers' walk (reading-assembly.ts) name one directory.
 */
export const PLACES_KEPT_DIR = "capture/places-kept";

export interface PlaceCapture {
  payload: PlacePayload | { problem: string } | null;
  sight: SeatSight | undefined;
  root: string;
  /**
   * Build unit F5 (design section 4): where given, every accepted row carries its place's premises 1, 4-8 (`premises`),
   * which the assembly gathers into the verdict's `rests_on.places` for a later run to compare. Premises 2 and 3 (the
   * rule, the answers) are the verdict's own block's.
   */
  premises?: { readingSpec: { digest: string; problem?: string }; model: string | null; /** The effort levels the seat's own transcript records; null where it could not be read (a reason on the row), absent where no hook took it. */ effort?: string[] | null };
  /**
   * Unit U1: the rows of this candidate's places that a seat before this one read and that passed every
   * place check, recorded apart from its verdict when that verdict did not hold (`.legal/capture/places-kept/`). A place
   * they hold is read: this seat owes no row for it (C1), a row it gives for it is refused (a kept
   * row is never decided again, so a kept `is_the_construct` cannot be overridden into `not_applicable`), its evidence
   * may name it by id, and A4 counts the kept row.
   */
  kept?: (findingId: string) => ReadingReadRow[];
}

/**
 * ONE PlaceCapture IS ONE ANSWER, AND THE TREE-WIDE WORK IS TAKEN ONCE PER ANSWER: the tree's reader (a walk of every scanned file),
 * the seat's files and searches as premises (every Grep and Glob it ran, replayed) and the tree's index of base names
 * hang on the capture object, not on one candidate's check. They were local to `readingOfPlaceDecisions`, which runs once
 * per candidate, so a 32-candidate bin walked the tree 32 times (about 18 s on a real run) and passed the hook's deadline.
 * Every caller that checks several candidates of one answer passes the same object (reading-assembly.ts `placeCapture`).
 */
interface AnswerWork {
  tree?: TreeReader;
  basis?: ReturnType<typeof seatPremisesOf>;
  index?: TreeIndex;
}
const ANSWER_WORK = new WeakMap<PlaceCapture, AnswerWork>();
function answerWorkOf(cap: PlaceCapture): AnswerWork {
  let w = ANSWER_WORK.get(cap);
  if (!w) ANSWER_WORK.set(cap, (w = {}));
  return w;
}

export interface PlaceDecisionsOut {
  /** The accepted rows as the record's `reading.read` rows (empty where any problem refuses the answer). */
  read: ReadingReadRow[];
  /**
   * Unit U1: the rows that passed every place check of their own (C3-C5, C7, C9), decided once, whatever
   * else refuses the answer, and not of a place already kept from a seat before this one. What the capture keeps as read
   * where the answer's verdict does not hold; nothing that failed a place check is in it.
   */
  passed?: ReadingReadRow[];
  problems: string[];
  /** The row each place id (and its unit id) became, for evidence that names a place by id. */
  rowById: Map<string, ReadingReadRow>;
  /** Set where no row can be checked at all (no payload or no transcript to check against): nothing is written. */
  unconvertible?: string;
  /**
   * Verification A, VA-1: every place of the candidate as A4 counts it (place-answer.ts `notApplicableBar`), for the
   * verdict of a candidate that fits one seat: decided by a row the checks accepted; `unreadable` where the payload gave
   * it no window; `not_answered` where this seat's payload does not hold it. A readable place still owed a row is left
   * out: C1 refuses its silence.
   */
  standing?: PlaceStanding[];
  /**
   * Fix R1: the positions in `decisions` of the rows refused for what they are, not for what they say (no row
   * object, no `place`, a group or old-form row, a place not handed, unreadable or kept): the seat is told to remove
   * each, so it is not part of the base a later answer amends (amend.ts `RefusalRemoved`).
   */
  removed?: number[];
}

const realOf = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

/** The file's lines, where `file` names a regular file inside the tree; null otherwise. */
function treeLines(root: string, file: string, cache: Map<string, string[] | null>): string[] | null {
  if (cache.has(file)) return cache.get(file)!;
  let out: string[] | null = null;
  const abs = resolve(root, file);
  const rel = relativePath(realOf(root), realOf(abs));
  if (!isAbsolute(file) && rel !== "" && !rel.startsWith("../") && rel !== ".." && !isAbsolute(rel) && existsSync(abs)) {
    try {
      if (statSync(abs).isFile()) out = readSourceText(abs).split("\n").map((l) => l.replace(/\r$/, ""));
    } catch {
      out = null;
    }
  }
  cache.set(file, out);
  return out;
}

/**
 * C5's rule, and A6's (place-answer.ts), for one quote against the text of the lines it names, of the file `file`: "fits" where the quote stands for a part of that text, as the final quote check compares a quotation
 * with the file it names (reconcile-verify.ts `quotationRanges`, the one comparison: as written, then whitespace
 * collapsed, then in a document or translation file canonical forms and typographic marks folded), and that part is at
 * least 15 characters or a whole (trimmed) line; "short" where it stands for a part and no such part; null where it
 * stands for none. The part is counted as the file holds it, so a quotation written in another canonical form counts as
 * the one written byte for byte does; where the quotation is the file's own bytes this is the raw test it was before.
 */
export function quoteStanding(quote: string, text: string, file: string): "fits" | "short" | null {
  const q = quote.trim();
  if (!q) return null;
  const norm = text.replace(/\r\n|\r/g, "\n");
  const found = quotationRanges(q, norm, file);
  if (found.length === 0) return null;
  const lines = norm.split("\n").map((l) => l.trim());
  return found.some(({ start, end }) => {
    const part = norm.slice(start, end);
    return part.length >= PLACE_QUOTE_MIN_CHARS || lines.includes(part);
  })
    ? "fits"
    : "short";
}

/**
 * C9's rule for a `standing` part's `{file, line, quote}`,
 * the same as a place row's `beyond`: the file is in the tree, the quote stands at the line (or at the nearest line holding
 * it) by the one comparison (`quoteStanding`), and the seat's own Reads cover that line. The line it stands at, or why not.
 */
export function lineStandsAsBeyond(cap: { root: string; sight: SeatSight | undefined | null }, file: string, line: number, quote: string): { line: number } | { why: string } {
  const lines = treeLines(cap.root, file, new Map());
  if (!lines) return { why: `\`at\` names ${file}, which is not a file of the scanned tree (C9)` };
  const at = line >= 1 && line <= lines.length && quoteFits(quote, lines[line - 1]!, file) ? line : nearestHolding(quote, line, lines.map((t, k) => [k + 1, t]), file);
  if (at === null) return { why: `\`at\`'s quote is not a verbatim part of ${file}:${line}, nor of any line of that file (C9)` };
  if (!cap.sight || !readCovers(cap.sight, resolve(cap.root, file), at, at)) return { why: `your transcript shows no Read of ${file} covering line ${at} (C9)` };
  return { line: at };
}

/**
 * A line the program itself quoted (a ships premise's
 * `because`, written at scan time from the repository's manifests) stands: the file is in the tree and the quote fits
 * that very line by the one comparison (`quoteStanding`). No Read is asked for: no seat wrote it.
 */
export function programLineStands(root: string, file: string, line: number, quote: string, cache: Map<string, string[] | null> = new Map()): boolean {
  const lines = treeLines(root, file, cache);
  return lines !== null && Number.isInteger(line) && line >= 1 && line <= lines.length && quote.trim() !== "" && quoteFits(quote, lines[line - 1]!, file);
}

/** C5's test of one quote against one line's text of `file` (`quoteStanding`): it fits. */
export function quoteFits(quote: string, lineText: string, file: string): boolean {
  return quoteStanding(quote, lineText, file) === "fits";
}

/** The line among `candidates` holding the quote nearest to `declared` (drift recovery); null where none does. */
function nearestHolding(quote: string, declared: number, candidates: [number, string][], file: string): number | null {
  let best: number | null = null;
  for (const [n, text] of candidates) if (quoteFits(quote, text, file) && (best === null || Math.abs(n - declared) < Math.abs(best - declared))) best = n;
  return best;
}

/*
 * C10: the lines a `why` names, written any of the ways a line is named -
 * `stance.rb:31-37`, `stance.rb: 31`, `stance.rb:L31`, `stance.rb#L31-L37`, `stance.rb line 31`, `stance.rb (lines
 * 31-37)`, `lines 31-37 of stance.rb` - by a path from the tree's root, a part of one, or an absolute path (the seat's
 * Read tool takes absolute paths). A line named with no file (`line 243`, `(lines 55-57)`, `at L41`) is the place's own
 * file's (`path` ""). A path segment may carry `+` and `$` (SvelteKit `+page.server.ts`, Remix `$id.tsx`), bracketed or
 * parenthesised parts (`[id]`, `[...slug]`, `[[...slug]]`, `(auth)`) and letters outside ASCII. A reference preceded by
 * `/` or `@` is part of an address (`https://api.example.com:443`), not a line of the tree. Whether the rest IS a file of
 * the tree is decided against the tree (`filesNamedInTree`), not by its spelling. The range's dash is a hyphen or an en
 * dash (built from its code point, so this source stays ASCII).
 *
 * A later change adds, each a path that finds a line the earlier reading passed over:
 *  - a file with no extension (`Gemfile:3`, `ios/Podfile:2`; kind `noext`). It is a line of the tree only where the tree
 *    holds a file of that name; otherwise it is nothing (`localhost:3000`, `note: 3`), and a `line N` written after it
 *    is read as a bare line. In words (`Gemfile line 3`) it is taken only where the name has a directory or begins with
 *    a capital letter;
 *  - every line of a list: `stance.rb:53 and :62`, `lines 92, 101 and 182`, `lines 6 and 8 of stance.rb`;
 *  - a path straight after a colon (`see:app/x.rb:7`; `afterColon`), which is a line of the tree where the tree holds it
 *    and was an address otherwise (now read as the same path after a space is);
 *  - a doubled slash (`src//app.ts:41`);
 *  - a number grouped in thousands (`line 1,234`, the way this program prints a line) is one number, not line 1;
 *  - a `line N` that is part of an address field (`address line 2`, `street line 1`) is not a line of code;
 *  - a bare line after a file named with no line (`in app/x.rb, which ...; see line 7`) may be that file's line:
 *    `alsoPaths` carries every file named with no line before it, and C10 holds the line against them and the place's own
 *    file alike.
 *
 * A later change adds, each a path that finds a line the earlier reading passed over:
 *  - a path, a space, then a bare number or range (`client.en.yml 3058-3062`; `heldOnly`), a line only where the tree
 *    holds the path; and `L<n>-L<m>` wherever it stands (a range of lines is never a cache level);
 *  - a bare name with an extension that ends tree files' base names after a dot (`en.yml` for `client.en.yml`), tried
 *    last in `filesNamedInTree`, only where no other spelling finds a file;
 *  - a bare `line N` is held against every file named with no line in the same `why`, after it as well as before it
 *    (`line 3 of the Gemfile`, `line 7 of the app/policies/note_rules.rb`);
 *  - a path segment in braces (`src/pages/{Product.name}.js`); a file name with a space, where the tree holds it
 *    (`app/my file.rb:7`; `alts`); a link to a file on a repository host with `#L` (`.../blob/<ref>/<path>#L7`, where
 *    the tree holds the path); a `~/` path (read as the absolute path it names); a fullwidth colon and a no-break space
 *    (read as their plain forms); `file.rb(7)` (where the tree holds the file); a path with a directory that the tree
 *    does not hold, whatever its extension (a source extension was needed before); and a path straight after a colon
 *    that the tree does not hold, read as the same path after a space is;
 *  - after a colon a line is digits only, so `:41,300` is the list 41 and 300; after the word `line` a grouped number
 *    stays one number;
 *  - `address line N` is an address field only for N of 1 to 3 or before the word `field`, and only where `address` (or
 *    `street`) is a word of its own: `normalize_ip_address line 300` and `the ip address line 300` are lines again.
 * It withdraws one reading: a word with no directory and no extension (`Version: 2`, `The License`) is not a tree file
 * whose base name is in capitals (`VERSION`, `LICENSE`) unless written as the tree writes it.
 *
 * Not taken for a line: a path with no line, and a method or constant name. A file named with no line names nothing a
 * Read can be checked against - holding it to "some Read of that file" would let a one-line Read anywhere in the file
 * stand for the basis, a check that looks held and holds nothing - and a method name becomes a line only through a
 * search of the tree, which the read rule never counts. Both are left to the seat text ("A capability, a permission or
 * a default": decide on the line that sets it, Read and given as `beyond`).
 */
const DASH = `[-${String.fromCharCode(0x2013)}]`;
/** A line number: digits, or digits grouped in thousands with commas (`1,234`, as this program's own texts print one). */
const NUM = "(?:\\d{1,3}(?:,\\d{3})+(?!\\d)|\\d{1,7})";
/** After a colon, or in `file.rb(7)`, a line is digits only: `:41,300` is the list 41 and 300. */
const NUM_COLON = "\\d{1,7}";
const num = (s: string): number => Number(s.replace(/,/g, ""));
const PATH_ATOM = "(?:[\\p{L}\\p{N}\\p{M}_@.+$-]|\\[\\[[^\\[\\]/\\s:]*\\]\\]|\\[[^\\[\\]/\\s:]*\\]|\\([^()/\\s:]*\\)|\\{[^{}/\\s:]*\\})";
const PATH = `(?:~/|/)?(?:${PATH_ATOM}+/+)*${PATH_ATOM}*\\.[A-Za-z][A-Za-z0-9]{0,9}`;
/** Read as their plain forms before a `why` is read, one character for one so every place in it stays where it is:
 * a no-break, figure, thin or narrow no-break space as a space, a fullwidth colon as a colon. */
const SPACE_LIKE = new RegExp(`[${String.fromCharCode(0xa0, 0x2007, 0x2009, 0x202f)}]`, "g");
const FULLWIDTH_COLON = new RegExp(String.fromCharCode(0xff1a), "g");
/** A path whose last part has no extension (`Gemfile`, `ios/Podfile`, `Dockerfile`). */
const PATH_NOEXT = `/?(?:${PATH_ATOM}+/+)*[\\p{L}_][\\p{L}\\p{N}\\p{M}_-]*`;
/** Where a path may not start: after a path character, `/`, `~`, a closing bracket or a hyphen. */
const NOT_AFTER = "(?<![\\p{L}\\p{N}\\p{M}_@.+$/~\\])\\-])";
/** After a path, its line: `:N`, `: N`, `:LN`, `#LN`, ` line N`, `, line N`, ` (lines N-M)`, ` at line N`, ` LN`, `(N)`. */
const LINE_FORMS =
  `(?::\\s*L?(${NUM_COLON})(?:\\s*${DASH}\\s*L?(${NUM_COLON}))?` +
  `|#L(${NUM})(?:${DASH}L?(${NUM}))?` +
  `|(?:,?[ \\t]+\\(?|[ \\t]*\\()[ \\t]*(?:(?:at|on|in)[ \\t]+)?(?:[Ll]ines?[ \\t]+L?|L)(${NUM})(?:[ \\t]*(?:${DASH}|to|through)[ \\t]*L?(${NUM}))?` +
  `|\\((${NUM_COLON})\\))` +
  `(?!\\d)`;
const LINE_AFTER = new RegExp(`${NOT_AFTER}(${PATH})${LINE_FORMS}`, "gu");
const LINE_AFTER_NOEXT = new RegExp(`${NOT_AFTER}(${PATH_NOEXT})${LINE_FORMS}`, "gu");
/** One item of a list of lines: `N`, `N-M`, `N to M`. */
const NUM_ITEM = `${NUM}(?:[ \\t]*(?:${DASH}|to|through)[ \\t]*L?${NUM})?`;
const ITEM = new RegExp(`(${NUM})(?:[ \\t]*(?:${DASH}|to|through)[ \\t]*L?(${NUM}))?`, "gu");
/** A line, or a list of them, then its path: `line N of <path>`, `lines N-M in <path>`, `lines N and M of <path>`. */
const LINE_BEFORE = new RegExp(
  `(?<![\\p{L}])[Ll]ines?[ \\t]+L?(${NUM_ITEM}(?:(?:[ \\t]*,[ \\t]*(?:and[ \\t]+)?|[ \\t]+and[ \\t]+)L?${NUM_ITEM})*),?[ \\t]+(?:of|in|at)[ \\t]+(?:the[ \\t]+file[ \\t]+)?[\`'"]?(${PATH})(?![\\p{L}\\p{N}_])`,
  "gu",
);
/** A line with no file: `line N`, `lines N-M`, `lines N to M` (taken where no path is written beside it). */
const LINE_BARE = new RegExp(`(?<![\\p{L}])[Ll]ines?[ \\t]+L?(${NUM})(?:[ \\t]*(?:${DASH}|to|through)[ \\t]*L?(${NUM}))?(?!\\d)`, "gu");
/** A bare `L41` or `L41-L44`, taken where a word or mark that introduces a place stands before it (`at L41`, `(L41`). */
const L_BARE = new RegExp(`(?<![\\p{L}\\p{N}_#/.:-])#?L(${NUM})(?:[ \\t]*${DASH}[ \\t]*L?(${NUM}))?(?![\\p{L}\\p{N}_])`, "gu");
const L_BARE_BEFORE = /(?:\b(?:at|on|in|see|near|from|to|and|or|line|lines)[ \t]+|[(\[,][ \t]*)$/i;
/** A `line N` that is part of an address field, not a line of code: `address line 1` to `3`, or before the
 * word `field`, where `address` (or `street`) is a word of its own - never after an identifier (`normalize_ip_address line
 * 300`) and never a larger number (`the ip address line 300`). */
const ADDRESS_BEFORE = /(?<![\p{L}\p{N}_])(?:address|street)[ \t_-]+$/iu;
const isAddressField = (before: string, to: number, after: string): boolean => ADDRESS_BEFORE.test(before) && (to <= 3 || /^[ \t]+fields?\b/i.test(after));
/** A path, a space, then a bare number or range (`client.en.yml 3058-3062`): a line only where the tree holds
 * the path. Not where the number runs on into a count or a version (`app.rb 3 times`, `app.js 1.2`). */
const LINE_SPACED = new RegExp(
  `${NOT_AFTER}(${PATH})[ \\t]+(\\d{1,7})(?:[ \\t]*${DASH}[ \\t]*(\\d{1,7}))?(?!${DASH}|[\\p{L}\\p{N}_%]|[.,:/]\\p{N}|[ \\t]+(?:times?|x|more|other|of|lines?|places?|files?|calls?|occurrences?|matches?|rows?|entries|items?|bytes?|chars?|characters?|percent|ms|seconds?|minutes?|hours?|days?|weeks?|months?|years?|[kKMG]i?B)\\b)`,
  "gu",
);
/** A link to a file on a repository host with its line (`https://github.com/o/r/blob/main/app/x.rb#L7`, GitLab's
 * `/-/blob/`): the path after the ref, a line only where the tree holds it (or a shorter end of it, where
 * the ref has a slash). */
const LINE_URL = new RegExp(`https?://[^\\s/]+/(?:[^\\s/#]+/)*?(?:blob|blame|raw|src)/[^\\s/#]+/(${PATH})#L(${NUM_COLON})(?:${DASH}L?(${NUM_COLON}))?(?!\\d)`, "gu");
/** An `L<n>-L<m>` range, a range of lines wherever it stands. */
const L_RANGE = new RegExp(`${DASH}[ \\t]*L`);
/** The next item of a list after a line: `, 41`, ` and :62`, `, L62`, ` and line 62`. */
const LIST_NEXT = new RegExp(
  `(?:[ \\t]*,[ \\t]*(?:(?:and|or)[ \\t]+)?|[ \\t]+(?:and|or|&)[ \\t]+)(:[ \\t]*L?|#?L|(?:(?:at|on|in)[ \\t]+)?[Ll]ines?[ \\t]+L?)?(${NUM})(?:[ \\t]*(?:${DASH}|to|through)[ \\t]*L?(${NUM}))?(?![\\d\\p{L}])`,
  "uy",
);
/** Where a bare number may end a list that began with one line (`stance.rb:53, 62.`), not run on into prose (`and 3 other files`). */
const LIST_END = /^[ \t]*(?:$|[,;.)\]:]|(?:and|or)\b)/;
/** A file named with no line (a path with an extension, a path with a directory, or a capitalised name). */
const MENTION = new RegExp(`${NOT_AFTER}(${PATH}|/?(?:${PATH_ATOM}+/+)+[\\p{L}_][\\p{L}\\p{N}\\p{M}_-]*|\\p{Lu}\\p{Ll}[\\p{L}\\p{N}\\p{M}_-]*)(?![\\p{L}\\p{N}\\p{M}_/(\\[])`, "gu");
/** A reference that resolves to no file of the tree still counts as a line the seat claims where it has a directory and its extension is a source file's (a bare name the tree does not hold is an address, a module or a vendor's script - `collector.example.pl:8443`, `jquery.min.js:2`). */
const SOURCE_EXT = /\.(rb|erb|haml|slim|rake|js|jsx|mjs|cjs|ts|tsx|vue|svelte|py|go|java|kt|kts|scala|groovy|php|cs|rs|swift|m|mm|c|h|cc|cpp|hpp|ex|exs|erl|dart|lua|pl|pm|sh|bash|sql|yml|yaml|json|toml|ini|xml|html|htm|gradle|properties|tf|graphql|proto)$/i;

/** One line (or range) a `why` names. `kind`: a path with an extension, one without, or none (the place's own file). */
export interface NamedLine {
  path: string;
  from: number;
  to: number;
  text: string;
  kind: "path" | "noext" | "bare";
  /** Where in the `why` the reference stands (its list item, for an item after the first). */
  at: number;
  end: number;
  /** The line is given in words after the name (`posthog.init on line 9`), not with a colon or `#L`. */
  worded?: boolean;
  /** The path stands straight after a colon (`see:app/x.rb:7`). */
  afterColon?: boolean;
  /** For a bare line: the files named with no line in the same `why`, before it or after it. */
  alsoPaths?: string[];
  /** A form that is a line only where the tree holds its file (a path then a bare number, `file.rb(7)`, a link to a
   * repository host); where it holds none, it is no line of the tree. */
  heldOnly?: boolean;
  /** Other spellings of the path, tried in order where the tree holds none under the path as written: the path with the
   * words before it (`app/my file.rb`), or the shorter ends of a link's path. */
  alts?: string[];
}

export function linesNamedIn(written: string): NamedLine[] {
  const why = written.replace(SPACE_LIKE, " ").replace(FULLWIDTH_COLON, ":");
  const out: NamedLine[] = [];
  const spans: [number, number][] = [];
  const noextSpans: [number, number][] = [];
  const overlaps = (list: [number, number][], a: number, b: number): boolean => list.some(([x, y]) => a < y && b > x);
  const push = (path: string, a: string, b: string | undefined, text: string, kind: NamedLine["kind"], at: number, end: number, extra: Partial<NamedLine> = {}) => {
    const from = num(a);
    const to = b !== undefined ? num(b) : from;
    if (!(from >= 1) || to < from) return;
    const p = path.replace(/^\.\//, "").replace(/\/{2,}/g, "/");
    if (!out.some((o) => o.path === p && o.from === from && o.to === to && o.kind === kind)) out.push({ path: p, from, to, text, kind, at, end, ...extra });
  };
  /* The rest of a list after one reference, read as lines of the same file; returns where the list ends. A bare number
   * continues a list that began with `lines`, or one that ends there (`stance.rb:53, 62.`). */
  const listAfter = (path: string, start: number, kind: NamedLine["kind"], plural: boolean, extra: Partial<NamedLine>): number => {
    let at = start;
    for (;;) {
      LIST_NEXT.lastIndex = at;
      const m = LIST_NEXT.exec(why);
      if (!m) return at;
      const end = at + m[0].length;
      // A comma straight before the number (`:41,300`) continues the list wherever it ends.
      if (m[1] === undefined && !plural && !/^,\d/.test(m[0]) && !LIST_END.test(why.slice(end))) return at;
      const item = m[0].replace(/^[ \t]*,?[ \t]*/, "");
      push(path, m[2]!, m[3], kind === "bare" ? `${item} (of the place's file)` : `${path} ${item}`, kind, at, end, extra);
      at = end;
    }
  };
  const lineOf = (m: RegExpMatchArray): [string, string | undefined] =>
    m[2] !== undefined ? [m[2], m[3]] : m[4] !== undefined ? [m[4], m[5]] : m[6] !== undefined ? [m[6], m[7]] : [m[8]!, undefined];
  /* The path with up to three words before it, joined by single spaces (`app/my file.rb` for `file.rb`): a file name with
   * a space, tried where the tree holds none as written. */
  const spacedAlts = (at: number, path: string): string[] => {
    const alts: string[] = [];
    let i = at;
    let prefix = "";
    for (let k = 0; k < 3 && why[i - 1] === " "; k++) {
      const w = /[^\s`'"()[\]<>,;:]+$/u.exec(why.slice(Math.max(0, i - 201), i - 1));
      if (!w) break;
      prefix = `${w[0]} ${prefix}`;
      i -= 1 + w[0].length;
      alts.push(`${prefix}${path}`);
    }
    return alts;
  };
  // A link to a file on a repository host, first, so no other reading takes a part of it.
  for (const m of why.matchAll(LINE_URL)) {
    const at = m.index!;
    const end = at + m[0].length;
    const parts = m[1]!.split("/").filter(Boolean);
    const alts = parts.slice(1, -1).map((_, k) => parts.slice(k + 1).join("/"));
    push(m[1]!, m[2]!, m[3], m[0], "path", at, end, { heldOnly: true, alts });
    spans.push([at, end]);
  }
  for (const m of why.matchAll(LINE_AFTER)) {
    const [a, b] = lineOf(m);
    const at = m.index!;
    const end = at + m[0].length;
    if (overlaps(spans, at, end)) continue;
    const alts = spacedAlts(at, m[1]!);
    const extra: Partial<NamedLine> = {
      ...(m[6] !== undefined ? { worded: true } : {}),
      ...(why[at - 1] === ":" ? { afterColon: true } : {}),
      ...(m[8] !== undefined ? { heldOnly: true } : {}),
      ...(alts.length > 0 ? { alts } : {}),
    };
    push(m[1]!, a!, b, m[0], "path", at, end, extra);
    spans.push([at, listAfter(m[1]!, end, "path", /lines/i.test(m[0]), extra)]);
  }
  for (const m of why.matchAll(LINE_BEFORE)) {
    const at = m.index!;
    for (const it of m[1]!.matchAll(ITEM)) push(m[2]!, it[1]!, it[2], m[0], "path", at, at + m[0].length);
    spans.push([at, at + m[0].length]);
  }
  // A path, a space, then a bare number or range: a line only where the tree holds the path.
  // Its path still counts as a file named with no line for a bare line (`alsoPaths`), as it did before it was read so.
  const spacedSpans: [number, number][] = [];
  for (const m of why.matchAll(LINE_SPACED)) {
    const at = m.index!;
    const end = at + m[0].length;
    if (overlaps(spans, at, end)) continue;
    const extra: Partial<NamedLine> = { heldOnly: true };
    push(m[1]!, m[2]!, m[3], m[0], "path", at, end, extra);
    const span: [number, number] = [at, listAfter(m[1]!, end, "path", false, extra)];
    spans.push(span);
    spacedSpans.push(span);
  }
  for (const m of why.matchAll(LINE_AFTER_NOEXT)) {
    const at = m.index!;
    const end = at + m[0].length;
    if (overlaps(spans, at, end)) continue;
    if (m[6] !== undefined && !m[1]!.includes("/") && !/^\p{Lu}\p{Ll}/u.test(m[1]!)) continue;
    // `name(7)` with no extension is a call far more often than a file (`setup(3)`): not taken.
    if (m[8] !== undefined) continue;
    const [a, b] = lineOf(m);
    const extra: Partial<NamedLine> = { ...(m[6] !== undefined ? { worded: true } : {}), ...(why[at - 1] === ":" ? { afterColon: true } : {}) };
    push(m[1]!, a!, b, m[0], "noext", at, end, extra);
    // Not added to `spans`: a name that is no file of the tree leaves its `line N` to the bare reading (C10 drops the bare
    // reading where the name IS a file of the tree).
    noextSpans.push([at, listAfter(m[1]!, end, "noext", /lines/i.test(m[0]), extra)]);
  }
  for (const m of why.matchAll(LINE_BARE)) {
    const at = m.index!;
    const end = at + m[0].length;
    if (overlaps(spans, at, end) || isAddressField(why.slice(0, at), num(m[2] ?? m[1]!), why.slice(end))) continue;
    push("", m[1]!, m[2], `${m[0]} (of the place's file)`, "bare", at, end);
    spans.push([at, listAfter("", end, "bare", /lines/i.test(m[0]), {})]);
  }
  for (const m of why.matchAll(L_BARE)) {
    const at = m.index!;
    const end = at + m[0].length;
    // `L<n>-L<m>` is a range of lines wherever it stands (`listed as kinds L39-L43`).
    if (overlaps(spans, at, end) || (!L_BARE_BEFORE.test(why.slice(0, at)) && !(m[2] !== undefined && L_RANGE.test(m[0])))) continue;
    push("", m[1]!, m[2], `${m[0]} (of the place's file)`, "bare", at, end);
    spans.push([at, listAfter("", end, "bare", false, {})]);
  }
  const mentions: { path: string; at: number }[] = [];
  for (const m of why.matchAll(MENTION)) {
    const at = m.index!;
    const end = at + m[0].length;
    if ((!overlaps(spans, at, end) || overlaps(spacedSpans, at, end)) && !overlaps(noextSpans, at, end)) mentions.push({ path: m[1]!.replace(/^\.\//, "").replace(/\/{2,}/g, "/"), at });
  }
  // A bare line may be a line of any file the same `why` names with no line, before it or after it (`line 3 of the
  // Gemfile`).
  const named = [...new Set(mentions.map((x) => x.path))];
  for (const o of out) if (o.kind === "bare" && named.length > 0) o.alsoPaths = named;
  return out;
}

/**
 * The tree's files by path from its root, walked once per answer and only when a named path must be looked up (`.git`
 * skipped); `complete` is false where the walk stopped at its cap. A symbolic link that ends
 * inside the tree is followed - a linked file is listed under its link's name too, and a linked directory is walked
 * once - so a file named by its link's name is found.
 */
const TREE_INDEX_CAP = 400_000;
export interface TreeIndex {
  files: string[];
  complete: boolean;
  /** Per way of comparing a name (`NAME_KEYS`), the files by their base name so compared; built when first asked for. */
  keyed?: Map<string, string[]>[];
  /** Per bare name, the files whose base name ends with it after a dot (`en.yml`: `client.en.yml`); built when asked for. */
  suffixed?: Map<string, string[]>;
}
export function treeIndexOf(root: string): TreeIndex {
  const base = realOf(root);
  const files: string[] = [];
  const walked = new Set<string>([base]);
  const inTree = (real: string): boolean => {
    const rel = relativePath(base, real);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  };
  const stack = [""];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir ? resolve(base, dir) : base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      let isDir = e.isDirectory();
      let isFile = e.isFile();
      if (e.isSymbolicLink()) {
        try {
          const real = realpathSync(resolve(base, rel));
          if (!inTree(real)) continue;
          const st = statSync(real);
          isFile = st.isFile();
          isDir = st.isDirectory() && !walked.has(real);
          if (isDir) walked.add(real);
        } catch {
          continue;
        }
      } else if (isDir) walked.add(resolve(base, rel));
      if (isDir) {
        if (e.name !== ".git") stack.push(rel);
      } else if (isFile) {
        files.push(rel);
        if (files.length >= TREE_INDEX_CAP) return { files: files.sort(), complete: false };
      }
    }
  }
  return { files: files.sort(), complete: true };
}

/**
 * The ways a named file is compared with the tree's files, tried in order until one finds a file:
 * as written; ignoring case (letters outside ASCII composed the same way, NFC); and ignoring case, `_` and `-`
 * (`NoteRules.rb` for `note_rules.rb`). A name the tree holds under none of these is no file of the tree.
 */
const NAME_KEYS: ((s: string) => string)[] = [
  (s) => s,
  (s) => s.normalize("NFC").toLowerCase(),
  (s) => s.normalize("NFC").toLowerCase().replace(/[_-]/g, ""),
];
const baseNameOf = (p: string): string => p.slice(p.lastIndexOf("/") + 1);
/** A base name written in capitals (`VERSION`, `LICENSE`, `CODE_OWNERS`). */
const CAPITALS = /^[\p{Lu}\p{N}_-]*\p{Lu}[\p{Lu}\p{N}_-]*$/u;
function keyedOf(index: TreeIndex, t: number): Map<string, string[]> {
  index.keyed ??= [];
  let m = index.keyed[t];
  if (!m) {
    m = new Map();
    const key = NAME_KEYS[t]!;
    for (const f of index.files) {
      const k = key(baseNameOf(f));
      const list = m.get(k);
      if (list) list.push(f);
      else m.set(k, [f]);
    }
    index.keyed[t] = m;
  }
  return m;
}

/** A named path from the tree's root: an absolute path inside the tree made relative; null for one outside it. */
function treePathOf(written: string, root: string): string | null {
  // A `~/` path is the absolute path it names.
  const path = written.startsWith("~/") ? join(homedir(), written.slice(2)) : written;
  if (!isAbsolute(path)) return path;
  for (const base of new Set([realOf(root), resolve(root)])) {
    for (const abs of new Set([realOf(path), resolve(path)])) {
      const rel = relativePath(base, abs);
      if (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)) return rel;
    }
  }
  return null;
}

/**
 * Whether every name of `p` (from the tree's root) is spelled as its folder
 * lists it. A volume that ignores case (macOS's and Windows' defaults) opens `App/Policies/x.rb` for
 * `app/policies/x.rb`, and taking the name as written there made it a second file beside the one the seat Read: the
 * spelling the tree holds is found by `NAME_KEYS`, as on a volume that keeps case.
 */
function spelledAsTree(root: string, p: string): boolean {
  let dir = root;
  for (const name of p.split("/")) {
    if (name === "" || name === ".") continue;
    if (name === "..") {
      dir = dirname(dir);
      continue;
    }
    try {
      if (!readdirSync(dir).includes(name)) return false;
    } catch {
      return false;
    }
    dir = join(dir, name);
  }
  return true;
}

/**
 * Every tree file a named path can be. A path with a directory that the tree holds as
 * written, from its root, is that file. Otherwise every file of the tree whose path is the name or ends with it, compared
 * by the first of `NAME_KEYS` that finds one: a base name more than one file of the tree has (`app.ts`, `stance.rb`)
 * names all of them, and the caller holds the line against each - not silently against the place's own file. Where the
 * walk stopped at its cap, `extra` (the place's file, `beyond`'s and the files the seat Read) are compared too. Empty
 * where the tree holds no such file.
 */
function filesNamedInTree(path: string, root: string, extra: string[], cache: Map<string, string[] | null>, index: () => TreeIndex, endings = true): string[] {
  const p0 = treePathOf(path, root);
  if (p0 === null) return [];
  const p = p0.replace(/\/{2,}/g, "/").replace(/^\.\//, "");
  if (!p) return [];
  if (p.includes("/") && spelledAsTree(root, p) && treeLines(root, p, cache)) return [p];
  const idx = index();
  // A word with no directory and no extension (`Version`, `License`) is a tree file whose base name is in capitals
  // (`VERSION`, `LICENSE`) only as the tree writes it: in another case it is a word of prose.
  const word = !p.includes("/") && !p.includes(".");
  for (let t = 0; t < NAME_KEYS.length; t++) {
    const key = NAME_KEYS[t]!;
    const want = key(p);
    const pool = [...(keyedOf(idx, t).get(key(baseNameOf(p))) ?? []), ...(idx.complete ? [] : extra)];
    const hit = [...new Set(pool.filter((f) => {
      const k = key(f);
      return (k === want || k.endsWith(`/${want}`)) && !(t > 0 && word && CAPITALS.test(baseNameOf(f)));
    }))].sort();
    if (hit.length > 0) return hit;
  }
  return endings ? filesEndingWith(p, extra, idx) : [];
}

/**
 * Last, a bare name with an extension that ends tree files' base names after a dot (`en.yml` for `client.en.yml` and
 * `server.en.yml`: seats have shortened a locale file so). Tried only where no spelling of
 * `filesNamedInTree` finds a file; where it finds several, the line is held against each, as a shared base name is.
 */
function filesEndingWith(p: string, extra: string[], idx: TreeIndex): string[] {
  if (!p.includes("/") && !p.startsWith(".") && p.includes(".")) {
    const key = NAME_KEYS[1]!;
    const want = `.${key(p)}`;
    idx.suffixed ??= new Map();
    let hit = idx.suffixed.get(want);
    if (!hit) {
      hit = idx.files.filter((f) => key(baseNameOf(f)).endsWith(want));
      idx.suffixed.set(want, hit);
    }
    const all = [...new Set([...hit, ...(idx.complete ? [] : extra.filter((f) => key(baseNameOf(f)).endsWith(want)))])].sort();
    if (all.length > 0) return all;
  }
  return [];
}

/** One line a closing row's `why` names outside its place's window, as C10 holds it: `files` are the tree files it can be
 * (empty for none), `pastEnd` says it lies past the end of every file it was taken for. */
export interface OutsideLine {
  files: string[];
  from: number;
  to: number;
  text: string;
  pastEnd?: string[];
}
/** What C10 reads a `why` against: the tree, the place's file and window, the files a lookup may also compare where the
 * tree could not be listed whole (`extra`), and the seat's Reads (null where there is no transcript). */
export interface C10Context {
  root: string;
  placeFile: string;
  inWindow: (line: number) => boolean;
  extra: string[];
  cache: Map<string, string[] | null>;
  index: () => TreeIndex;
  sight: SeatSight | null | undefined;
}

/**
 * C10's reading of one closing row's `why`: every line it names that lies outside the
 * place's window, with the tree files each can be. Exported so a replay over a recorded run reads `why` exactly as the
 * capture check does.
 */
export function outsideLinesOf(why: string, c: C10Context): OutsideLine[] {
  const out: OutsideLine[] = [];
  const refs = linesNamedIn(why);
  const named = (p: string): string[] => filesNamedInTree(p, c.root, c.extra, c.cache, c.index);
  const namedAsWritten = (p: string): string[] => filesNamedInTree(p, c.root, c.extra, c.cache, c.index, false);
  // A file with no extension that the tree holds (`Gemfile:3 and line 5`) takes the `line N` read beside it.
  const heldNoext: [number, number][] = refs.filter((r) => r.kind === "noext" && named(r.path).length > 0).map((r) => [r.at, r.end]);
  for (const ref of refs) {
    if (ref.kind === "bare" && heldNoext.some(([a, b]) => ref.at < b && ref.end > a)) continue;
    let files: string[];
    if (ref.kind === "bare") {
      // A bare line is the place's own file's; after a file named with no line it may be that file's too.
      files = [...new Set([...(ref.alsoPaths ?? []).flatMap(named), c.placeFile])];
    } else {
      files = namedAsWritten(ref.path);
      // Another spelling of the path (a name with a space, the shorter ends of a link's path) where the tree holds none as
      // written.
      for (const alt of files.length === 0 ? (ref.alts ?? []) : []) {
        files = namedAsWritten(alt);
        if (files.length > 0) break;
      }
      // Last, the files whose base name the name ends after a dot (`en.yml`). Added to what the reading
      // before did with a name the tree does not hold, never in its place: a name with a line in words stays the place's
      // own line too, and a name held as no file of the tree is still held so.
      const ending = files.length === 0 ? filesEndingWith(ref.path, c.extra, c.index()) : [];
      if (ending.length > 0) {
        files = ending;
        if (!ref.heldOnly && ref.kind !== "noext") {
          if (ref.worded && !ref.path.includes("/")) files = [...files, c.placeFile];
          else if (ref.path.includes("/") || (SOURCE_EXT.test(ref.path) && !c.index().complete)) out.push({ files: [], from: ref.from, to: ref.to, text: ref.text });
        }
      }
      if (files.length === 0) {
        // A name with no extension that is no file of the tree is no line of it, nor is a form read as a line only where
        // the tree holds its file (a path then a bare number, `file.rb(7)`, a link to a repository host). A path straight
        // after a colon is read as the same path after a space is.
        if (ref.kind === "noext" || ref.heldOnly) continue;
        // A name that is no file of the tree, then a line in words (`posthog.init on line 9`): the line is the place's
        // own file's, as a bare `line N` is. Written with a colon (`collector.example.pl:8443`) it is an address.
        if (ref.worded && !ref.path.includes("/")) files = [c.placeFile];
        else {
          // No file of the tree: held where it reads as a path into one (a directory, or an absolute path), whatever
          // its extension (`docs/missing/notes.md:7`), or, with a source extension, where the tree could
          // not be listed whole; a bare name the tree does not hold is an address, a module or a vendor's script, not a
          // line of the tree.
          if (ref.path.includes("/") || (SOURCE_EXT.test(ref.path) && !c.index().complete)) out.push({ files: [], from: ref.from, to: ref.to, text: ref.text });
          continue;
        }
      }
    }
    files = orderFiles(files, c.placeFile);
    // A line past the end of a file is no line of it: where it is past the end of every file
    // it was taken for, the seat is asked for the file it means.
    const lengthOf = (f: string): number | null => {
      const t = treeLines(c.root, f, c.cache);
      return t === null ? null : t.length > 0 && t[t.length - 1] === "" ? t.length - 1 : t.length;
    };
    const fits = files.filter((f) => {
      const n = lengthOf(f);
      return n === null || ref.to <= n;
    });
    if (fits.length === 0) {
      out.push({ files: [], from: ref.from, to: ref.to, text: ref.text, pastEnd: files.map((f) => `${f} has ${n0(lengthOf(f) ?? 0)} lines`) });
      continue;
    }
    let inWindow = true;
    for (let n = ref.from; inWindow && n <= ref.to; n++) if (!c.inWindow(n)) inWindow = false;
    // Inside the window of the one file it can be, it needs nothing; where it can also be another file of the tree, it
    // is inside only where the seat Read those lines of the place's own file.
    if (inWindow && fits.includes(c.placeFile) && (fits.length === 1 || (!!c.sight && readCovers(c.sight, resolve(c.root, c.placeFile), ref.from, ref.to)))) continue;
    out.push({ files: fits, from: ref.from, to: ref.to, text: ref.text });
  }
  return out;
}

/** The files of the tree the seat's own transcript shows Reads of, by their path from the tree's root. */
function seatReadFiles(sight: SeatSight | null | undefined, root: string): string[] {
  if (!sight) return [];
  const base = realOf(root);
  const out: string[] = [];
  for (const abs of sight.ranges.keys()) {
    const rel = relativePath(base, abs);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) continue;
    out.push(rel);
  }
  return out;
}

const merge = (spans: [number, number][]): [number, number][] => {
  const sorted = [...spans].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const s of sorted) {
    const top = out.at(-1);
    if (top && s[0] <= top[1] + 1) top[1] = Math.max(top[1], s[1]);
    else out.push([s[0], s[1]]);
  }
  return out;
};
const n0 = (n: number): string => n.toLocaleString("en-US");
/** Directories of installed dependencies: where a base name is shared with files there, the place's own
 * file and the project's own files are named first. */
const INSTALLED_DIR = /(?:^|\/)(?:node_modules|bower_components|jspm_packages|vendor|\.bundle|site-packages|dist-packages|\.venv|venv|Pods|Carthage|\.yarn|\.pnpm-store)\//;
function orderFiles(files: string[], placeFile: string): string[] {
  const rank = (f: string): number => (f === placeFile ? 0 : INSTALLED_DIR.test(f) ? 2 : 1);
  return [...files].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
}
/** How many files of a shared base name a refusal names; the rest are counted, never listed (in a tree
 * with installed dependencies `package.json` is the base name of hundreds or thousands of files). */
const FILES_SHOWN = 5;
const filesShown = (files: string[]): string =>
  files.length > FILES_SHOWN ? `one of the ${n0(files.length)} tree files of that name (${files.slice(0, FILES_SHOWN).join(", ")}, and ${n0(files.length - FILES_SHOWN)} more)` : `one of ${files.join(", ")}`;
const pastEndShown = (pastEnd: string[]): string =>
  pastEnd.length > FILES_SHOWN ? `${pastEnd.slice(0, FILES_SHOWN).join(", ")}, and ${n0(pastEnd.length - FILES_SHOWN)} more tree files of that name, each shorter than that` : pastEnd.join(", ");

/**
 * ONE SEAT'S PLACE ROWS FOR ONE CANDIDATE, CHECKED (C1-C10) AND TURNED INTO THE RECORD'S READ ROWS. `decisions` is the
 * seat's array for this candidate (a verdict entry's `decisions`, or a reader's whole reply).
 */
export function readingOfPlaceDecisions(args: { candidate: Candidate; decisions: unknown; capture: PlaceCapture | null }): PlaceDecisionsOut {
  const rowById = new Map<string, ReadingReadRow>();
  const empty = (unconvertible: string): PlaceDecisionsOut => ({ read: [], problems: [], rowById, unconvertible });
  const cap = args.capture;
  if (!cap || !cap.payload) return empty("this candidate is read place by place, and its rows are checked against the seat's payload and its own transcript (full-read design 1.7, C4 and C7), which the plugin's capture hook passes and this command is not given: nothing is written");
  if ("problem" in cap.payload) return empty(`the place rows cannot be checked: ${cap.payload.problem}`);
  const payload = cap.payload;
  const owned = payload.places.get(args.candidate.finding_id) ?? [];
  const byPlace = new Map(owned.map((g) => [g.place, g]));
  // Unit U1: the places a seat before this one read and the capture kept apart from its verdict.
  const keptById = new Map((cap.kept?.(args.candidate.finding_id) ?? []).filter((r) => typeof r.place === "string").map((r) => [r.place as string, r]));
  for (const [place, r] of keptById) {
    rowById.set(place, r);
    rowById.set(r.kind, r);
  }
  const problems: string[] = [];
  const cls = new Map<string, string[]>();
  const add = (k: string, id: string) => cls.set(k, [...(cls.get(k) ?? []), id]);
  const removed: number[] = [];
  const read: ReadingReadRow[] = [];
  const seen = new Map<string, number>();
  const unread: { place: string; spans: [number, number][]; source: string }[] = [];
  const beyondUnread: string[] = [];
  const whyUnread: string[] = [];
  const whyNoFile: string[] = [];
  const whyPastEnd: string[] = [];
  const work = answerWorkOf(cap);
  const treeIndex = (): TreeIndex => (work.index ??= treeIndexOf(cap.root));
  const lineCache = new Map<string, string[] | null>();
  const needsItem = readingClassOf(args.candidate)?.item_source === "reading";
  /* Build unit F5: one place's premises. The seat's files and searches (premises 7 and 8) are taken once per answer: a
   * Read or a search is not attributed to one place, so it is a premise of every place of the seat. Once per answer
   * indeed, not once per candidate: they hang on the capture object (`answerWorkOf`). */
  const premisesOf = (g: PlaceGiven, row: PlacePremises["row"]): PlacePremises | undefined => {
    if (!cap.premises) return undefined;
    const premiseTree = (work.tree ??= new TreeReader(cap.root));
    const seatBasis = (work.basis ??= seatPremisesOf(cap.sight, premiseTree, [payload.copyPath, ...(payload.payloadPath ? [payload.payloadPath] : [])]));
    /* What the seat's own transcript could not give - its sight (premises 7 and 8) and its effort - is a
     * reason on the row, never an empty premise that reads as "opened nothing". A place's `incomplete` only stops its
     * carry; it is no coverage gap for this run. */
    const incomplete = [...seatBasis.incomplete, ...seatBasis.untaken, ...seatUntakenOf({ effort: cap.premises.effort })];
    const id = placeKeyOf(args.candidate.rule_id, g.file, g.matched, premiseTree.lines(g.file));
    if (!id) incomplete.push(`the place's matched line ${g.file}:${g.matched} cannot be read, so its identity is not known.`);
    const w = payload.windows?.get(args.candidate.finding_id)?.get(placeAt(g.file, g.matched));
    if (!w) incomplete.push("the payload's text for the place cannot be digested.");
    if (cap.premises.readingSpec.problem || !cap.premises.readingSpec.digest) incomplete.push(`the reading spec cannot be digested: ${cap.premises.readingSpec.problem ?? "no digest"}.`);
    return {
      spec: PLACE_PREMISES_SPEC,
      key: id?.key ?? "",
      rule_id: args.candidate.rule_id,
      file: g.file,
      occurrence: id?.occurrence ?? 0,
      reading_spec: cap.premises.readingSpec.digest,
      model: cap.premises.model,
      effort: cap.premises.effort ?? null,
      window: w?.window ?? "",
      window_start: w?.window_start ?? g.matched,
      followed: [],
      files: seatBasis.files,
      searches: seatBasis.searches,
      row,
      complete: incomplete.length === 0,
      ...(incomplete.length > 0 ? { incomplete } : {}),
    };
  };
  if (!Array.isArray(args.decisions)) {
    const owed = owned.filter((g) => g.given !== "unreadable").map((g) => g.place);
    return { read, rowById, problems: [`\`decisions\` must be an array with one row per place you were handed (${compactIds(owed)})`] };
  }
  args.decisions.forEach((value, i) => {
    const label = `row ${i + 1}`;
    if (!isObj(value)) {
      add("not-a-row", label);
      removed.push(i);
      return;
    }
    const d = value;
    const id = typeof d.place === "string" ? d.place : "";
    const name = id || label;
    const group = GROUP_ROW_FIELDS.filter((f) => f in d);
    if (group.length > 0) add(`group:${group.join(",")}`, name);
    const old = OLD_FORM_FIELDS.filter((f) => f in d);
    if (old.length > 0) add(`old:${old.join(",")}`, name);
    if (group.length > 0 || old.length > 0) {
      removed.push(i);
      return;
    }
    if (!id) {
      add("no-place", label);
      removed.push(i);
      return;
    }
    const g = byPlace.get(id);
    if (!g) {
      add("foreign", id);
      removed.push(i);
      return;
    }
    if (g.given === "unreadable") {
      add("unreadable", id);
      removed.push(i);
      return;
    }
    // Fix F1: a place a seat before this one read and the capture kept is read already; a row for it is
    // refused, so the kept row is the only one A4 and the per-place table count for it.
    if (keptById.has(id)) {
      add("kept", id);
      removed.push(i);
      return;
    }
    seen.set(id, (seen.get(id) ?? 0) + 1);
    if (seen.get(id) === 2) add("twice", id);
    if (seen.get(id)! > 1) return;
    // C3: the words.
    const decision = typeof d.decision === "string" ? d.decision : "";
    let rowOk = true;
    if (!PLACE_DECISIONS.includes(decision)) {
      add("decision", id);
      rowOk = false;
    }
    const data = Array.isArray(d.data) ? d.data : null;
    if (!data || data.some((w) => typeof w !== "string" || !PLACE_DATA_WORDS.includes(w)) || new Set(data).size !== data.length) {
      add("data", id);
      rowOk = false;
    } else if (decision === "not_the_construct" && data.length > 0) {
      add("data-on-dismissal", id);
      rowOk = false;
    }
    const item = typeof d.item === "string" ? d.item.trim() : "";
    if ("item" in d && !item) {
      add("item-form", id);
      rowOk = false;
    }
    if (needsItem && (decision === "is_the_construct" || decision === "construct_but_gated") && !item) {
      add("item-missing", id);
      rowOk = false;
    }
    const why = typeof d.why === "string" ? d.why.trim() : "";
    if (!why) {
      add("why", id);
      rowOk = false;
    }
    // C3: a gated row names its gate's kind from the closed list, and only a gated row names one; `other`
    // says the gate in the seat's own words, and only `other` does.
    const gate = typeof d.gate === "string" ? d.gate.trim() : "";
    const gateWords = typeof d.gate_words === "string" ? d.gate_words.trim() : "";
    if (decision === "construct_but_gated") {
      if (!("gate" in d)) {
        add("gate-missing", id);
        rowOk = false;
      } else if (!(PLACE_GATE_KINDS as readonly string[]).includes(gate)) {
        add("gate-form", id);
        rowOk = false;
      } else if (gate === "other" ? !gateWords : "gate_words" in d) {
        add("gate-words", id);
        rowOk = false;
      }
    } else if ("gate" in d || "gate_words" in d) {
      add("gate-not-gated", id);
      rowOk = false;
    }
    // C4 and C5: the line and its quote, from what the place was given.
    const declared = typeof d.line === "number" && Number.isInteger(d.line) ? d.line : null;
    const quote = typeof d.quote === "string" ? d.quote : "";
    if (declared === null) {
      add("line-form", id);
      return;
    }
    if (!quote.trim()) {
      add("quote-empty", id);
      return;
    }
    const given: [number, string, string | null][] = []; // line, text, the excerpt holding it (null: the fact row)
    if (g.given === "fact") {
      given.push([g.matched, g.factText ?? "", null]);
    } else {
      for (const exId of g.excerpts) {
        const ex = payload.excerpts.get(exId);
        if (!ex || ex.file !== g.file) continue;
        const own = exId === g.excerpts[0];
        ex.lines.forEach((text, k) => {
          const n = ex.start + k;
          if (own && g.window && (n < g.window[0] || n > g.window[1])) return;
          if (!given.some((x) => x[0] === n)) given.push([n, text, exId]);
        });
      }
    }
    const atDeclared = given.find((x) => x[0] === declared);
    if (!atDeclared) {
      add(g.given === "fact" ? "fact-line" : "outside-window", id);
      return;
    }
    let line = declared;
    // The quote against the place's file as the final quote check compares it (`quoteStanding`).
    if (!quoteFits(quote, atDeclared[1], g.file)) {
      const moved = nearestHolding(quote, declared, given.map((x) => [x[0], x[1]]), g.file);
      if (moved === null) {
        add(quoteStanding(quote, atDeclared[1], g.file) === "short" ? "quote-short" : "quote", id);
        return;
      }
      line = moved;
    }
    // C9: beyond.
    let beyond: { file: string; line: number; quote: string } | undefined;
    if (d.beyond !== undefined) {
      const b = isObj(d.beyond) ? d.beyond : null;
      const bf = b && typeof b.file === "string" ? b.file : "";
      const bl = b && typeof b.line === "number" && Number.isInteger(b.line) ? b.line : null;
      const bq = b && typeof b.quote === "string" ? b.quote : "";
      if (!b || !bf || bl === null || !bq.trim() || Object.keys(b).some((k) => k !== "file" && k !== "line" && k !== "quote")) {
        add("beyond-form", id);
        return;
      }
      const lines = treeLines(cap.root, bf, lineCache);
      if (!lines) {
        add("beyond-file", id);
        return;
      }
      const at = bl >= 1 && bl <= lines.length && quoteFits(bq, lines[bl - 1]!, bf) ? bl : nearestHolding(bq, bl, lines.map((t, k) => [k + 1, t]), bf);
      if (at === null) {
        add("beyond-quote", id);
        return;
      }
      if (!cap.sight || !readCovers(cap.sight, resolve(cap.root, bf), at, at)) {
        beyondUnread.push(`${id} (${bf}:${at})`);
        return;
      }
      beyond = { file: bf, line: at, quote: bq };
    }
    // C10: on a row that CLOSES the place, a `why` that names a line outside the place's
    // window rests only on lines the seat Read, and carries one of them as `beyond` - a seat cannot close a place on a line
    // it never opened. A row that keeps the place, or leaves it undetermined, is not held (it stays in front of the
    // person). What closes a place is place-bar.ts `isClosingDecision`, the one definition A4 reads too.
    // `files`: every tree file the reference can be (more than one where a base name is shared, or where a bare line
    // follows a file named with no line); empty for no file of the tree. `pastEnd`: the line lies past the end of every
    // file it was taken for.
    const outsideNamed: OutsideLine[] = isClosingDecision(decision)
      ? outsideLinesOf(why, { root: cap.root, placeFile: g.file, inWindow: (n) => given.some((x) => x[0] === n), extra: [g.file, ...(beyond ? [beyond.file] : []), ...seatReadFiles(cap.sight, cap.root)], cache: lineCache, index: treeIndex, sight: cap.sight })
      : [];
    if (outsideNamed.length > 0) {
      const sightNow = cap.sight;
      const noFile = outsideNamed.filter((o) => o.files.length === 0 && !o.pastEnd);
      const pastEnd = outsideNamed.filter((o) => o.pastEnd);
      if (noFile.length > 0 || pastEnd.length > 0) {
        if (noFile.length > 0) whyNoFile.push(`${id} (${noFile.map((o) => o.text).join(", ")})`);
        if (pastEnd.length > 0) whyPastEnd.push(`${id} (${pastEnd.map((o) => `${o.text}: ${pastEndShown(o.pastEnd!)}`).join("; ")})`);
        return;
      }
      const notRead = outsideNamed.filter((o) => !sightNow || !o.files.some((f) => readCovers(sightNow, resolve(cap.root, f), o.from, o.to)));
      if (notRead.length > 0) {
        // A name more than one tree file has: the seat is told which (the first few and the count), and that
        // the file it means is named by its path.
        whyUnread.push(`${id} (${notRead.map((o) => (o.files.length > 1 ? `${o.text}, a line of ${filesShown(o.files)} - name the one you mean by its path from the tree's root` : o.text)).join(", ")})`);
        return;
      }
      const b = beyond;
      const sameFile = (x: string, y: string): boolean => x === y || realOf(resolve(cap.root, x)) === realOf(resolve(cap.root, y));
      if (!b || !outsideNamed.some((o) => o.files.some((f) => sameFile(f, b.file)) && b.line >= o.from && b.line <= o.to)) {
        add("why-beyond", id);
        return;
      }
    }
    // C7: the read rule, per Read range.
    const holder = atDeclared[2] === null ? null : given.find((x) => x[0] === line)![2];
    const need: [number, number][] = [];
    let copyOk = payload.copyMatches;
    if (g.given === "fact") {
      if (g.rowSpan) need.push(g.rowSpan);
      else copyOk = false;
    } else {
      for (const exId of new Set([g.excerpts[0]!, ...(holder ? [holder] : [])])) {
        const span = payload.excerpts.get(exId)?.span;
        if (span) need.push(span);
        else copyOk = false;
      }
    }
    const sight = cap.sight;
    const src = resolve(cap.root, g.file);
    const viaCopy = !!sight && copyOk && need.every(([a, b]) => readCovers(sight, payload.copyPath, a, b));
    const windowSpan: [number, number] = g.given === "fact" ? [g.matched, g.matched] : (g.window ?? [g.matched, g.matched]);
    const viaSource = !!sight && readCovers(sight, src, windowSpan[0], windowSpan[1]) && readCovers(sight, src, line, line);
    if (!viaCopy && !viaSource) {
      unread.push({ place: id, spans: copyOk ? need : [], source: `${g.file}:${windowSpan[0]}-${windowSpan[1]}` });
      return;
    }
    if (!rowOk) return;
    const row = {
      kind: g.unit,
      file: g.file,
      lines: String(line),
      quote,
      disposition: decision as ReadingDisposition,
      ground: why,
      place: id,
      data: data as string[],
      read_basis: g.given,
      ...(item ? { item } : {}),
      ...(beyond ? { beyond } : {}),
      ...(line !== declared ? { line_declared: declared } : {}),
      ...(decision === "construct_but_gated" ? { gate: gate as PlaceGateKind, ...(gate === "other" ? { gate_words: gateWords } : {}) } : {}),
    } as ReadingReadRow;
    const premises = premisesOf(g, {
      line,
      quote,
      decision,
      data: data as string[],
      why,
      read_basis: g.given as "window" | "fact",
      ...(item ? { item } : {}),
      ...(beyond ? { beyond } : {}),
      ...(line !== declared ? { line_declared: declared } : {}),
      ...(decision === "construct_but_gated" ? { gate: gate as PlaceGateKind, ...(gate === "other" ? { gate_words: gateWords } : {}) } : {}),
    });
    if (premises) row.premises = premises;
    read.push(row);
    rowById.set(id, row);
    rowById.set(g.unit, row);
  });
  // C1: every place handed (and readable) has its row.
  const missing = owned.filter((g) => g.given !== "unreadable" && !seen.has(g.place) && !keptById.has(g.place)).map((g) => g.place);
  const decidedElsewhere = new Set([...(cls.get("foreign") ?? [])]);
  for (const k of [...cls.keys()]) if (k.startsWith("group:") || k.startsWith("old:")) for (const id of cls.get(k)!) decidedElsewhere.add(id);
  const silent = missing.filter((p) => !decidedElsewhere.has(p));
  if (silent.length > 0) problems.push(`${compactIds(silent)} have no row: every place you were handed gets exactly one row of its own (C1)`);
  for (const [k, ids] of cls) problems.push(placeProblemText(k, compactIds(ids)));
  if (unread.length > 0) {
    const spans = merge(unread.flatMap((u) => u.spans));
    const where = spans.length > 0
      ? `Read lines ${spans.map(([a, b]) => `${n0(a)}-${n0(b)}`).join(", ")} of ${payload.copyPath} (${spans.map(([a, b]) => `offset ${a} and limit ${b - a + 1}`).join("; ")}), or each place's window in its source file (${unread.map((u) => u.source).slice(0, 6).join(", ")}${unread.length > 6 ? ", ..." : ""})`
      : `Read each place's window in its source file (${unread.map((u) => u.source).slice(0, 6).join(", ")}${unread.length > 6 ? ", ..." : ""})`;
    problems.push(`${compactIds(unread.map((u) => u.place))}: your transcript shows no Read of these places' windows, and a place counts as read only where a Read returned its window; a search result never counts (C7). ${where}, then decide them again`);
  }
  if (beyondUnread.length > 0) problems.push(`\`beyond\` of ${beyondUnread.join(", ")}: your transcript shows no Read of that file covering that line; a search result never counts. Read it, or remove \`beyond\` and what rests on it (C9)`);
  if (whyUnread.length > 0) problems.push(`\`why\` of ${whyUnread.join(", ")}: on a row that closes the place (\`not_the_construct\`), names a line outside the place's window that your transcript shows no Read of; a search result never counts. Read that line and give it as \`beyond\` (the line that sets a capability, a permission or a default included), or take it out of \`why\` and decide on what you read - \`undetermined\`, naming the line you would need, where that is not enough; a row that keeps the place or leaves it undetermined is not held to this (C10)`);
  if (whyNoFile.length > 0) problems.push(`\`why\` of ${whyNoFile.join(", ")}: on a row that closes the place (\`not_the_construct\`), names a line of a file the scanned tree does not hold, so nothing you Read in the tree can carry it. Name the tree file and line the decision rests on, by its path from the tree's root, Read it and give it as \`beyond\`; or decide \`undetermined\`, naming what you would need (C10)`);
  if (whyPastEnd.length > 0) problems.push(`\`why\` of ${whyPastEnd.join(", ")}: on a row that closes the place (\`not_the_construct\`), names a line past the end of the file it was taken for, so it is a line of some other file. Name the file it is a line of, by its path from the tree's root, Read that line and give it as \`beyond\`; or decide \`undetermined\`, naming what you would need (C10)`);
  const standing: PlaceStanding[] = args.candidate.locations.flatMap((_, n): PlaceStanding[] => {
    const place = placeId(n);
    // Fix F1: the kept row first, whatever else holds the id.
    const k = keptById.get(place);
    if (k) return [{ place, decision: k.disposition }];
    const row = rowById.get(place);
    if (row) return [{ place, decision: row.disposition }];
    const g = byPlace.get(place);
    if (!g) return [{ place, not_checked: "not_answered" }];
    return g.given === "unreadable" ? [{ place, not_checked: "unreadable" }] : [];
  });
  const twice = new Set(cls.get("twice") ?? []);
  const passed = read.filter((r) => !twice.has(r.place ?? "") && !keptById.has(r.place ?? ""));
  return { read: problems.length > 0 ? [] : read, problems, rowById, standing, passed, ...(removed.length > 0 ? { removed } : {}) };
}

function placeProblemText(k: string, ids: string): string {
  if (k.startsWith("group:")) return `${ids}: \`${k.slice(6).split(",").join("`, `")}\` decides more than one place, or a unit of them; there are no group rows: one row per place, by its \`place\` id (C6)`;
  if (k.startsWith("old:")) return `${ids}: \`${k.slice(4).split(",").join("`, `")}\` is the old form; a place row has only \`place\`, \`decision\`, \`data\`, \`item\`, \`line\`, \`quote\`, \`why\` and \`beyond\`, nothing is declined or left not checked, and no ground covers another place (C8)`;
  switch (k) {
    case "not-a-row":
      return `${ids}: is not a row object (C1)`;
    case "no-place":
      return `${ids}: names no \`place\` id (C1)`;
    case "foreign":
      return `${ids}: not a place of your payload; decide only the places you were handed (C2)`;
    case "unreadable":
      return `${ids}: the program could not read this place's file and it is recorded as not checked; remove its row (C2)`;
    case "twice":
      return `${ids}: decided twice; exactly one row per place (C1)`;
    case "kept":
      return `${ids}: read already by the seat before you and recorded in \`.legal/capture/places-kept/\`; give no row for a place it holds, and rest your verdict on its kept row and your own rows (C1)`;
    case "decision":
      return `${ids}: \`decision\` must be one of ${PLACE_DECISIONS.join(", ")} (C3)`;
    case "data":
      return `${ids}: \`data\` must be an array of distinct words from ${PLACE_DATA_WORDS.join(", ")}, or [] (C3)`;
    case "data-on-dismissal":
      return `${ids}: \`data\` is [] where the decision is not_the_construct: personal data on a line that is not this rule's construct is another rule's to report (C3)`;
    case "item-form":
      return `${ids}: \`item\` must be the item's name as text (C3)`;
    case "item-missing":
      return `${ids}: this rule's items are found by reading: write \`item\`, the item this place is, on every is_the_construct and construct_but_gated row (C3)`;
    case "why":
      return `${ids}: \`why\` is required on every row (C3)`;
    case "gate-missing":
      return `${ids}: a construct_but_gated row names its gate's kind in \`gate\`, one of ${PLACE_GATE_KINDS.join(", ")} (C3)`;
    case "gate-form":
      return `${ids}: \`gate\` must be one of ${PLACE_GATE_KINDS.join(", ")} (C3)`;
    case "gate-words":
      return `${ids}: \`gate_words\` says the gate in your own words where \`gate\` is other, and is absent otherwise (C3)`;
    case "gate-not-gated":
      return `${ids}: \`gate\` and \`gate_words\` are written only on a construct_but_gated row (C3)`;
    case "line-form":
      return `${ids}: \`line\` must be a line number (C4)`;
    case "fact-line":
      return `${ids}: a place given as a fact is decided on its own matched line: \`line\` is that line and \`quote\` comes from the fact's text (C4)`;
    case "outside-window":
      return `${ids}: \`line\` is outside the place's window (its \`window_lines\`); a line outside it goes in \`beyond\`, with the line inside the window that rests on it as \`line\` (C4)`;
    case "quote-empty":
      return `${ids}: \`quote\` is empty; every row quotes its line, whatever its decision (C5)`;
    case "quote-short":
      return `${ids}: \`quote\` is shorter than ${PLACE_QUOTE_MIN_CHARS} characters and not the whole line; quote at least ${PLACE_QUOTE_MIN_CHARS} characters of it, or all of it (C5)`;
    case "quote":
      return `${ids}: \`quote\` is not a verbatim part of the line named, nor of any line of the place's window; copy it from the window as your payload shows it (C5)`;
    case "beyond-form":
      return `${ids}: \`beyond\` is one object, \`{"file", "line", "quote"}\`, and nothing else (C9)`;
    case "beyond-file":
      return `${ids}: \`beyond\` names a file that is not in the scanned tree; name it by its path from the tree's root (C9)`;
    case "beyond-quote":
      return `${ids}: \`beyond\`'s quote is not a verbatim part of the line named, nor of any line of that file; quote the line you Read (C9)`;
    case "why-beyond":
      return `${ids}: on a row that closes the place (\`not_the_construct\`), \`why\` names a line outside the place's window, and \`beyond\` does not carry it; give the line the decision rests on as \`beyond\`, \`{"file", "line", "quote"}\` - the line that sets a capability, a permission or a default included (C10)`;
    default:
      return `${ids}: ${k}`;
  }
}
