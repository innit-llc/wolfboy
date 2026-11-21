import type { Command } from "commander";
import { ours, type Inert } from "./printed-output.js";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { FOLD_LINE, PROVISION_CHECKED_WORD, WORDS } from "./assemble-report.js";
import { idsOfHandle, NUMBER_LIST_KIND, parseNumberList } from "./number-list.js";
import { explainCopyLines } from "./deep-copy-text.js";
import { deepCopiesOnRecord } from "./deepen.js";
import { latestReport, readReportFile, type ReportFilesEntry } from "./report-files.js";
import { codeSpanParts, codeSpanTexts, isReportFileTarget, labelText, markdownUnescaped } from "./report-form.js";
import { processStateDir } from "./start-record.js";
import { legalTidyLines } from "./legal-tidy.js";
import { readStateRecord } from "./state-record.js";
import { ciSet } from "./declaration.js";

/**
 * `explain`, `ruled-out` and the line `fix` shows (design rf11 3.5, 3.1.1; mocks M6, M7).
 *
 * Each prints what the latest report's files hold, read back only as the assembly wrote them (report-files.ts), and
 * composes no sentence about a finding of its own: the finding's file is printed in a terminal form (links shown as their
 * labels, links to the other report files dropped, heading marks and line-end breaks removed), its first screen or, "in
 * full", the whole of it, and then the file's absolute path. A handle is an F-number of this folder's list or a short-id
 * prefix of at least 6 characters (number-list.ts `idsOfHandle`); a prefix that matches more than one finding lists the
 * candidates by their first lines and acts on none; a ruled-out verdict's id is answered with where its section lies in
 * its rule's file (`path:line`), since it has no finding's file.
 *
 * The first screen is mock M7's layout of the same text: the card's labelled rows ("Place", "Provision", "Reason", ...)
 * as two columns, the start of the review's reasoning, one line each for how it was read, the person's decisions and the
 * deeper checks, then the file's path; within design section 6's budget (at most 30 lines and 2,600 characters, at most
 * 80 columns a line but the path's). Every word in it is the file's but the few labels of EXPLAIN_WORDS.
 */

export interface ExplainOptions {
  target: string;
  stateDir: string | null;
  handle: string;
  /** "in full": the whole file. */
  full?: boolean;
  /** Only the line that names the finding (what `fix` shows above its diff). */
  lineOnly?: boolean;
}

/** What these commands say beside the files they print. */
export const EXPLAIN_WORDS = {
  notUnderstood: (words: string) => `"${words}" is not understood after the handle: only "in full" is.`,
  // What `changes` says for a first review.
  noChanges: (dir: string) => `The latest review was not compared with an earlier one, so it wrote no changes.md: ${dir}`,
  /** What `explain`, `ruled-out` and `changes` print in CI. */
  notPrintedInCi: (command: string) =>
    `${command} prints nothing here: this runs in CI, where the output is a job's log that anyone who can read the repository may read. The findings are in the report's files; where they are:`,
  badHandle: (h: string) => `"${h}" is not a finding's handle: name it by its F-number in this folder ("F2") or by at least 6 characters of its id ("e41d7a").`,
  noNumbers: (why: string) => `F-numbers are read from this computer's list for this folder, and ${why}; name the finding by its 6-character id instead.`,
  noNumbersAbsent: "there is none",
  noNumbersUnreadable: (why: string) => `it cannot be read (${why})`,
  noNumbersUnusable: (why: string) => `it cannot be used (${why})`,
  noneNamed: (h: string, dir: string) => `${h} names no finding that stands in the latest report (${dir}). Ruled-out verdicts are listed in its ruled-out.md.`,
  several: (h: string, n: number) => `${h} matches ${n} findings, so nothing is shown; name one by a longer id:`,
  continues: "[continues in the file]",
  whereFirst: "Everything above, every evidence line, the provisions and the rule's guidance are in the finding's file:",
  whereFull: "The finding's file:",
  places: (n: number) => `${n} ${n === 1 ? "place" : "places"}`,
  ruledOutHigh: "High-level rules",
  ruledOutOther: "Medium and low rules",
  ruledOutRest: (verdicts: number, rules: number) => `${verdicts} in ${rules} ${rules === 1 ? "rule" : "rules"}: ruled-out.md`,
  ruledOutMoreHigh: (rules: number) => `${rules} more high-level ${rules === 1 ? "rule" : "rules"}: ruled-out.md`,
  ruledOutWhere: "Every verdict, with its full reasoning: ruled-out.md and its rule files:",
  fromReview: (words: string) => `From the ${words}`,
  /** The group's findings not shown, and their places where each entry names its count. */
  moreFindings: (n: number, places: number | null) =>
    `[${n} more ${n === 1 ? "finding" : "findings"}${places === null ? "" : `, ${places} ${places === 1 ? "place" : "places"},`} in the file]`,
  ruledOutVerdict: (short: string, title: string) =>
    `${short} was judged not a problem, so it has no file among the findings to fix and nothing is proposed to fix. Its review's reasoning is the section "Finding ${short}" of its check's file (${title}):`,
  // 17 Nov (d7): the pages' words, "judged not a problem" and "finding".
  ruledOutCandidate: (short: string, title: string) => `${short} · judged not a problem · ${title}`,
  noSection: (short: string, path: string) => `${path} holds no section for the finding ${short} judged not a problem, so it is not pointed at.`,
};

/** The terminal width the printed lines are held to (the one line allowed past it is a path, which is never cut). */
const WIDTH = 80;
/** How many lines of the review's reasoning the first screen shows at most (mock M7: its start, then where it continues). */
const REASONING_LINES = 6;
/** The first screen's budget (design rf13 section 6, `explain`, first screen): lines, and characters with line ends. */
const FIRST_SCREEN_LINES = 30;
const FIRST_SCREEN_CHARS = 2600;
/** `ruled-out` prints at most this many lines, its path included (design 3.5). */
const RULED_OUT_LINES = 20;

/** A markdown link as the assembly writes it: its label may hold `\[`, `\]` and `\\` (report-form.ts `labelOf`). */
const LINK_SOURCE = String.raw`\[((?:\\.|[^\]\\])*)\]\(((?:[^()\s]|\([^()\s]*\))*)\)`;
const LINK = new RegExp(LINK_SOURCE, "g");

/**
 * One line of a report file as terminal text: a link to another report file (report-form.ts `isReportFileTarget`) is
 * dropped with the "·" before it, any other link is shown as its label (a code place's link, a `.md` file's included,
 * C4 item 3), a reference definition line is dropped, and heading marks, the line-end hard break and the escapes before
 * "<" and in a label are removed. The words are the file's.
 */
export function terminalLine(line: string): string | null {
  if (/^\s{0,3}\[[^\]]+\]:\s/.test(line)) return null;
  let out = line.replace(/^#{1,6}\s+/, "");
  out = out.replace(new RegExp(String.raw`(\s·\s)?${LINK_SOURCE}`, "g"), (whole, dot: string | undefined, label: string, target: string) =>
    isReportFileTarget(target) ? "" : `${dot ?? ""}${label}`,
  );
  /* Every backslash escape outside a code span is removed (`markdownUnescaped`):
   * a value reaches a report file through `markdownText`, which escapes the punctuation that could open markup. */
  out = markdownUnescaped(out.replace(/\[((?:\\.|[^\]\\])*)\]\[[^\]]*\]/g, "$1").replace(/\\$/, "")).trimEnd();
  if (/^\s*[-*]\s*$/.test(out)) return null;
  return out;
}

const terminalLines = (lines: readonly string[]): string[] => lines.map(terminalLine).filter((l): l is string => l !== null);

/** The short id a finding's file is named by (`findings/e41d7a.md`). */
const shortOfFile = (name: string): string => basename(name).replace(/\.md$/, "");

/**
 * The line that names a finding, from its file: the F-number and title of its heading (`# F2 · <title>`), the short id
 * it is named by, and its place from the card ("Place: …"), or for a group its number of places. `explain` prints it
 * first; `fix` shows it above the diff (design 3.5).
 */
export function nameLineOf(text: string, file: string): string {
  const lines = text.split("\n");
  const head = /^#\s+(?:(F\d+) · )?(.*)$/.exec(lines[0] ?? "");
  const f = head?.[1];
  let title = (head?.[2] ?? "").trim();
  // The card's "Place" item, its wrapped rows joined (a long link stands on a row of its own below "- Place:").
  const lead = `- ${WORDS.cardPlace}:`;
  const at0 = lines.findIndex((l) => l === lead || l.startsWith(`${lead} `));
  let placeRow = at0 >= 0 ? (lines[at0] as string) : "";
  if (at0 >= 0) {
    for (const l of lines.slice(at0 + 1)) {
      if (!/^\s+\S/.test(l)) break;
      placeRow = `${placeRow.replace(/\\$/, "")} ${l.trim()}`;
    }
  }
  let where = "";
  if (at0 >= 0) {
    LINK.lastIndex = 0;
    // A place's label is code (`[`src/a.ts:3`](...)`): its text, a bracket in it included.
    const parts = codeSpanParts(placeRow.slice(lead.length).trim());
    const spanned = parts.length > 1 && parts[0] === "[" ? codeSpanTexts(parts[1] ?? "")?.[0] : undefined;
    // Or a numbered reference (`[label][1]`), which a card too long for its rows uses.
    const m = spanned === undefined ? (LINK.exec(placeRow) ?? /\[((?:\\.|[^\]\\])*)\]\[\d+\]/.exec(placeRow)) : null;
    where = spanned ?? (m ? labelText(m[1] ?? "") : placeRow.slice(lead.length).replace(/\\$/, "").trim());
  } else {
    // A group's count is its places, the sum of its entries' own counts, which
    // is the title's "(N places)" (never the number of entries, which are findings); the title's count is not said twice.
    const n = placesOfGroup(sectionOf(lines, WORDS.groupListHeading));
    if (n !== null) {
      where = EXPLAIN_WORDS.places(n);
      title = title.replace(new RegExp(` \\(${n} places\\)$`), "");
    }
  }
  return [`${f ? `${f} ` : ""}${shortOfFile(file)}`, title, where].filter((x) => x !== "").join(" · ");
}

/** A group list's entries (`## <WORDS.groupListHeading>`), each as its lines: "1. <place>", then its own rows. */
function groupEntriesOf(section: readonly string[]): string[][] {
  const entries: string[][] = [];
  for (const l of section) {
    if (/^\d+\.\s/.test(l)) entries.push([l]);
    else if (entries.length > 0 && l.trim() !== "") (entries[entries.length - 1] as string[]).push(l);
  }
  return entries;
}

/**
 * One entry's own place count, read back through the generator's own words
 * (`WORDS.groupEntryPlaces`): the part of a row that is exactly what it writes for some count. Null where no part is.
 */
export function placesOfGroupEntry(entry: readonly string[]): number | null {
  for (const row of entry.slice(1)) {
    for (const part of row.trim().replace(/\\$/, "").split(" · ")) {
      const nums = (part.match(/\d+/g) ?? []).map(Number);
      const tries: [number, number][] = nums.length === 2 ? [[nums[0] as number, nums[1] as number]] : nums.length === 1 ? [[nums[0] as number, 0], [0, nums[0] as number]] : nums.length === 0 ? [[0, 1]] : [];
      for (const [n, earlier] of tries) if (WORDS.groupEntryPlaces(n, earlier) === part) return n;
    }
  }
  return null;
}

/** A group's places: the sum of its entries' own counts; null where there is no list, or an entry names no count. */
export function placesOfGroup(section: readonly string[] | null): number | null {
  if (section === null) return null;
  const counts = groupEntriesOf(section).map(placesOfGroupEntry);
  if (counts.length === 0 || counts.some((c) => c === null)) return null;
  return counts.reduce<number>((a, c) => a + (c as number), 0);
}

/** This folder's F-numbers by finding id, from the person's list (number-list.ts); or why they cannot be read. */
function numbersOf(stateDir: string | null, target: string): { ok: true; byId: Map<string, number> } | { ok: false; why: string } {
  const read = readStateRecord(stateDir, target, NUMBER_LIST_KIND);
  if (!read.read) return { ok: false, why: read.absent ? EXPLAIN_WORDS.noNumbersAbsent : EXPLAIN_WORDS.noNumbersUnreadable(read.why) };
  const list = parseNumberList(read.text);
  if (!list.ok) return { ok: false, why: EXPLAIN_WORDS.noNumbersUnusable(list.why) };
  return { ok: true, byId: new Map([...list.byId].map(([id, v]) => [id, v.n] as const)) };
}

/**
 * A ruled-out verdict's place in its rule's file: the file, the 1-based line of its `### Finding <short>` heading
 * ( the pages' name since 17 Nov; a report an earlier
 * version wrote has `### Verdict <short>`, read the same).
 */
interface VerdictAt {
  id: string;
  short: string;
  file: string;
  path: string;
  line: number;
  title: string;
}

/** Where a ruled-out verdict's section lies, read from its rule's file as written; or why it cannot be said. */
function verdictAt(entry: ReportFilesEntry, id: string, file: string): { ok: true; at: VerdictAt } | { ok: false; why: string } {
  const got = readReportFile(entry, file);
  if (!got.ok) return { ok: false, why: got.why };
  const lines = got.text.split("\n");
  const hex = id.replace(/^fp_/, "");
  let found: { short: string; line: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const short = /^### (?:Finding|Verdict) ([0-9a-f]{6,64})$/.exec(lines[i] as string)?.[1];
    if (short !== undefined && hex.startsWith(short) && (found === null || short.length > found.short.length)) found = { short, line: i + 1 };
  }
  if (found === null) return { ok: false, why: EXPLAIN_WORDS.noSection(hex.slice(0, 6), got.path) };
  /* The check's name: the file's
   * title without its count (" · judged not a problem 1 time"), which the line says already ("9a4e07c · judged not a
   * problem · <name> · judged not a problem 1 time" before). */
  const title = terminalLine(lines[0] ?? "") ?? "";
  const named = title.includes(" · ") ? title.slice(0, title.lastIndexOf(" · ")) : title;
  return { ok: true, at: { id, short: found.short, file, path: got.path, line: found.line, title: named } };
}

/** The finding's file a handle names in the latest report, a ruled-out verdict's section, or the lines to print instead. */
export function resolveHandle(
  entry: ReportFilesEntry,
  handle: string,
  numberOf: ReadonlyMap<string, number> | { why: string },
): { ok: true; file: string } | { ok: true; verdict: VerdictAt } | { ok: false; exitCode: number; lines: string[] } {
  const h = handle.trim();
  const isNumber = /^f\d{1,9}$/i.test(h);
  if (!isNumber && !/^(fp_)?[0-9a-f]{6,64}$/i.test(h)) return { ok: false, exitCode: 2, lines: [EXPLAIN_WORDS.badHandle(h)] };
  if (isNumber && "why" in numberOf) return { ok: false, exitCode: 1, lines: [EXPLAIN_WORDS.noNumbers(numberOf.why as string)] };
  const numbers = "why" in numberOf ? new Map<string, number>() : (numberOf as ReadonlyMap<string, number>);
  const ids = idsOfHandle(h, entry.findingFiles.keys(), numbers);
  const ruled = isNumber ? [] : idsOfHandle(h, [...entry.ruledOutFiles.keys()].filter((id) => !entry.findingFiles.has(id)), numbers);
  const files = [...new Set(ids.map((id) => entry.findingFiles.get(id) as string))].sort();
  if (files.length === 1 && ruled.length === 0) return { ok: true, file: files[0] as string };
  if (files.length === 0 && ruled.length === 1) {
    const at = verdictAt(entry, ruled[0] as string, entry.ruledOutFiles.get(ruled[0] as string) as string);
    return at.ok ? { ok: true, verdict: at.at } : { ok: false, exitCode: 1, lines: [at.why] };
  }
  if (files.length === 0 && ruled.length === 0) return { ok: false, exitCode: 1, lines: [EXPLAIN_WORDS.noneNamed(isNumber ? h.toUpperCase() : h, entry.dir)] };
  const lines = [EXPLAIN_WORDS.several(h, files.length + ruled.length)];
  for (const file of files) {
    const got = readReportFile(entry, file);
    lines.push(`  ${got.ok ? nameLineOf(got.text, file) : `${shortOfFile(file)} · ${got.why}`}`);
  }
  for (const id of [...ruled].sort()) {
    const at = verdictAt(entry, id, entry.ruledOutFiles.get(id) as string);
    lines.push(`  ${at.ok ? EXPLAIN_WORDS.ruledOutCandidate(at.at.short, at.at.title) : at.why}`);
  }
  return { ok: false, exitCode: 1, lines };
}

/** The display width of a line (code points; the report's own measure). */
const widthOf = (line: string): number => Array.from(line).length;

/** A web address, which a terminal opens only whole. */
const isLink = (w: string): boolean => /^https?:\/\/\S+$/.test(w);
/**
 * Words wrapped to `width` columns; a single word longer than the width keeps its end ("…" before it), where a path's file
 * and line are. A web address is never cut: a cut one opens
 * nothing, and the EUR-Lex reader's address with its article (74 characters) is wider than a card row's 68.
 */
function wrapWords(text: string, width: number): string[] {
  const rows: string[] = [];
  let row = "";
  for (const w0 of text.split(/ +/).filter((w) => w !== "")) {
    const w = widthOf(w0) > width && !isLink(w0) ? `…${Array.from(w0).slice(-(width - 1)).join("")}` : w0;
    if (row === "") row = w;
    else if (widthOf(row) + 1 + widthOf(w) <= width) row = `${row} ${w}`;
    else {
      rows.push(row);
      row = w;
    }
  }
  if (row !== "") rows.push(row);
  return rows;
}

/** A line cut to `width` columns at a word, with "…" where cut. */
function cutTo(line: string, width: number): string {
  const cs = Array.from(line);
  if (cs.length <= width) return line;
  const cut = cs.slice(0, width - 1).join("");
  const sp = cut.lastIndexOf(" ");
  return `${(sp > width / 2 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

/** The raw lines of the section under `## <heading>`, without the blank lines at its ends; null where the file has none. */
function sectionOf(body: readonly string[], heading: string): string[] | null {
  const at = body.indexOf(`## ${heading}`);
  if (at < 0) return null;
  const out: string[] = [];
  for (const l of body.slice(at + 1)) {
    if (l.startsWith("## ")) break;
    // A fold's own lines are not words: the terminal shows what the fold holds.
    if (FOLD_LINE.test(l)) continue;
    out.push(l);
  }
  while (out[0] === "") out.shift();
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

/**
 * The region words that end a card's Provision row, " (EU: your answers · US: not
 * answered)" (assemble-report.ts `regionWordsOf`), split from the provisions before them; null where the row does not end
 * with them. Each part is one of the card's own words for whose regions they are, after its regions or alone.
 */
function regionWordsOfRow(row: string): { rest: string; words: string } | null {
  const m = / \(([^()]*)\)$/.exec(row);
  if (!m) return null;
  const whose = [WORDS.cardYourAnswers, WORDS.cardNotAnswered, WORDS.cardRegionsUnanswered];
  const words = m[1] as string;
  /* Since R19-F's P12 the card
   * says them as sentences joined by "; " (`regionsOffered`, `regionsNotSaid`, `regionsNotSaidAny`): each part is one of
   * those, read by their own words around the names they hold; the earlier "EU: your answers" parts are still read. */
  const shapeOf = (f: (names: Inert) => string): ((p: string) => boolean) => {
    const [a = "", b = ""] = f(ours("\u0000")).split("\u0000");
    return (p) => p.length > a.length + b.length && p.startsWith(a) && p.endsWith(b);
  };
  const sentences = [shapeOf(WORDS.regionsOffered), shapeOf(WORDS.regionsNotSaid), (p: string) => p === WORDS.regionsNotSaidAny || p === WORDS.regionsOffered(ours(""))];
  const old = words.split(" · ").every((p) => whose.some((w) => p === w || p.endsWith(`: ${w}`)));
  if (!old && !words.split("; ").every((p) => sentences.some((ok) => ok(p)))) return null;
  return { rest: row.slice(0, m.index), words };
}

/** The card's items, each as its rows: a wrapped row is joined to the one before, a hard break ("\" at a line's end) starts a new row. */
function cardItems(card: readonly string[]): string[][] {
  const items: string[][] = [];
  let hard = false;
  for (const l of card) {
    if (/^- /.test(l)) {
      items.push([l.slice(2).replace(/\\$/, "")]);
      hard = /\\$/.test(l);
    } else if (/^\s+\S/.test(l) && items.length > 0) {
      const rows = items[items.length - 1] as string[];
      const t = l.trim().replace(/\\$/, "");
      if (hard) rows.push(t);
      else rows[rows.length - 1] = `${rows[rows.length - 1] as string} ${t}`;
      hard = /\\$/.test(l);
    }
  }
  return items;
}

/**
 * A group's label for one of its findings in the file's sections
 * ("Finding <short>:"), read from the one wording the file is written with (`WORDS.groupMemberHeading`).
 */
const reText = (t: string): string => t.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&");
const MEMBER_PARTS = WORDS.groupMemberHeading(ours("\x01")).split("\x01");
const MEMBER_LABEL = new RegExp(`^${reText(MEMBER_PARTS[0] ?? "")}\\S+${reText(MEMBER_PARTS[1] ?? "")}:$`);
/** Whether a line of a finding's file is a group's label or heading for one of its findings. */
export function isGroupMemberLine(l: string): boolean {
  return MEMBER_LABEL.test(l) || (l.startsWith("### ") && MEMBER_LABEL.test(`${l.slice(4)}:`));
}

/**
 * Each provision's link and checked day from the file's Provisions section
 * (`WORDS.provisionSource`): "<link> (checked 20 Aug 2026)", in the section's order; none where the file holds neither.
 */
export function provisionSourcesOf(section: readonly string[] | null): string[] {
  const checked = new RegExp(`\\b${reText(PROVISION_CHECKED_WORD)} (\\d{1,2} \\S+ \\d{4})`);
  return listItems(section ?? []).flatMap((item) => {
    const t = item.replace(/\\?\n/g, " ");
    // The link's text is the address (`provisionLink`), escapes removed; a file
    // written before the inline link holds the bare address.
    const linked = /\[((?:[^\]\\]|\\.)*)\]\(https?:\/\/[^)\s]*\)/.exec(t)?.[1]?.replace(/\\(.)/g, "$1");
    const url = linked !== undefined && /^https?:\/\//.test(linked) ? linked : (/(?:^|\s)(https?:\/\/[^\s<>]+)/.exec(t)?.[1] ?? "");
    const day = checked.exec(t)?.[1] ?? "";
    const when = day ? `(${PROVISION_CHECKED_WORD} ${day})` : "";
    return url || when ? [[url, when].filter((x) => x !== "").join(" ")] : [];
  });
}

/** The counted label of "How it was read"'s lists ("Files read (4)"), as a pattern from the one wording. */
const countLabel = (words: (n: number) => string): RegExp => {
  const [pre, post] = words(1).split("1");
  return new RegExp(`^- ${reText(pre ?? "")}(\\d+)${reText(post ?? "")}(?::\\s*(.*)|\\.)$`, "s");
};
const FILES_READ = countLabel(WORDS.filesRead);
const SEARCHES_RUN = countLabel(WORDS.searchesRun);

/**
 * "Files read (4) · Searches run (3)" from the section's counted lists; a
 * group's findings each hold theirs, and a file or a search two of them share is counted once. "" where the file holds none.
 */
function readCountsOf(section: readonly string[] | null): string {
  // [C4 item 7, 2026-11-08] Each list's items are its code spans (report-form.ts `codeSpanTexts`), never the text split on
  // " · ", which a path or a search may hold; where a list is not in the assembly's form its label's own count stands.
  const lists = { files: { items: new Set<string>(), unparsed: 0 }, searches: { items: new Set<string>(), unparsed: 0 } };
  let seen = false;
  for (const item of listItems(section ?? []).map((x) => x.replace(/\\?\n/g, " "))) {
    for (const [re, into] of [[FILES_READ, lists.files], [SEARCHES_RUN, lists.searches]] as const) {
      const m = re.exec(item);
      if (!m) continue;
      seen = true;
      const n = Number(m[1]);
      const texts = codeSpanTexts((m[2] ?? "").trim());
      if (texts !== null && texts.length === n) for (const x of texts) into.items.add(x);
      else into.unparsed += n;
    }
  }
  const count = (l: { items: Set<string>; unparsed: number }): number => l.items.size + l.unparsed;
  return seen ? `${WORDS.filesRead(count(lists.files))} · ${WORDS.searchesRun(count(lists.searches))}` : "";
}

/** The first sentence of a section's first paragraph, in terminal form ("None." where it is that). */
function firstSentenceOf(section: readonly string[] | null): string {
  if (section === null) return "";
  const para: string[] = [];
  for (const l of section) {
    if (l.trim() === "" || l.startsWith("### ") || isGroupMemberLine(l)) {
      if (para.length > 0) break;
      continue;
    }
    para.push(l.trim().replace(/\\$/, ""));
  }
  const text = terminalLine(para.join(" ")) ?? "";
  return (text.replace(/^[-*]\s+/, "").split(/(?<=[.;])\s/)[0] ?? "").trim();
}

/** How much the first screen shows, from the most to the least; the first that fits the budget is printed. */
interface ScreenShape {
  reasoning: number;
  places: number;
  rowLines: number;
}
const SCREEN_SHAPES: readonly ScreenShape[] = [
  { reasoning: REASONING_LINES, places: 8, rowLines: 6 },
  { reasoning: 4, places: 5, rowLines: 4 },
  { reasoning: 2, places: 3, rowLines: 3 },
  { reasoning: 1, places: 1, rowLines: 2 },
];

/** The first screen of a finding's file (mock M7) in one shape; `name` is its first line, `path` its last. */
function firstScreenOf(text: string, file: string, path: string, shape: ScreenShape): string[] {
  const lines = text.replace(/\n+$/, "").split("\n");
  const head = /^#\s+(?:(F\d+) · )?(.*)$/.exec(lines[0] ?? "");
  const short = shortOfFile(file);
  const body = lines.slice(1);
  const firstHeading = body.findIndex((l) => l.startsWith("## "));
  const items = cardItems(firstHeading >= 0 ? body.slice(0, firstHeading) : body);
  const labels: readonly string[] = [WORDS.cardPlace, WORDS.cardProvision, WORDS.cardReason, WORDS.cardWhatToDo, WORDS.cardSettles, WORDS.cardNotCounted];
  const say = `${WORDS.cardSay(ours("F0"), ours("")).split(":")[0] as string}:`;
  // The card's first item is its disposition line: what it is, its level and marks, its short id, the review's day.
  const lead = (terminalLine((items[0] ?? []).join(" ")) ?? "").split(" · ").filter((p) => p !== "" && p !== short);
  const review = lead.findIndex((p) => p.startsWith(WORDS.cardReviewOf(ours(""))));
  const kinds = lead.filter((_, i) => i !== review);
  const out: string[] = wrapWords([`${head?.[1] ? `${head[1]} ` : ""}${short}`, (head?.[2] ?? "").trim(), ...kinds].filter((x) => x !== "").join(" · "), WIDTH);
  const rows: { label: string; rows: string[] }[] = [];
  const unlabelled: string[] = [];
  for (const it of items.slice(1)) {
    const m = /^([^:]+): (.*)$/.exec(it[0] ?? "");
    if (m && labels.includes(m[1] as string)) rows.push({ label: m[1] as string, rows: [m[2] as string, ...it.slice(1)] });
    else if (!(it[0] ?? "").startsWith(say)) for (const r of it) unlabelled.push(...wrapWords(terminalLine(r) ?? "", WIDTH));
  }
  // Mock M7 puts the region words of the card's Provision row ("EU: your
  // answers") on the second line, after the review's day where the card has one; the row keeps its provisions.
  const provision = rows.find((r) => r.label === WORDS.cardProvision);
  const regions = provision ? regionWordsOfRow(provision.rows[provision.rows.length - 1] ?? "") : null;
  if (provision && regions) provision.rows[provision.rows.length - 1] = regions.rest;
  // Mock M7: under the provisions, each one's link and the day it was
  // checked, as the file's Provisions section gives them.
  if (provision) provision.rows.push(...provisionSourcesOf(sectionOf(body, WORDS.provisionsHeading)));
  const second = [review >= 0 ? EXPLAIN_WORDS.fromReview(lead[review] as string) : "", regions?.words ?? ""].filter((x) => x !== "").join(" · ");
  if (second !== "") out.push(...wrapWords(second, WIDTH));
  out.push(...unlabelled);
  if (rows.length > 0) {
    const col = Math.max(12, ...rows.map((r) => widthOf(r.label) + 2));
    const room = WIDTH - col;
    out.push("");
    for (const r of rows) {
      const shown: string[] = [];
      for (const raw of r.rows) {
        // The place and the line it quotes stand on rows of their own (mock M7); a quoted line is cut, never wrapped.
        const parts = r.label === WORDS.cardPlace ? raw.split(/ · (?=`)/) : [raw];
        for (const part of parts) {
          const code = /^`+\s?(.*?)\s?`+$/.exec(part.trim());
          if (code) shown.push(cutTo(code[1] as string, room));
          else {
            // The place is a link whose label is code (`[`src/a.ts:2`][1]`): its text, as before.
            const line = terminalLine(part) ?? "";
            const label = r.label === WORDS.cardPlace ? /^`+\s?(.*?)\s?`+$/.exec(line.trim()) : null;
            shown.push(...wrapWords(label ? (label[1] as string) : line, room));
          }
        }
      }
      const kept = shown.length > shape.rowLines ? [...shown.slice(0, shape.rowLines - 1), cutTo(`${shown[shape.rowLines - 1] as string} …`, room)] : shown;
      // A whole web address wider than the row's room moves left, so it still ends by column 80 where it can (RR3-14).
      kept.forEach((l, i) => out.push(i > 0 && widthOf(l) > room && isLink(l) ? `${" ".repeat(Math.max(0, WIDTH - widthOf(l)))}${l}` : `${(i === 0 ? r.label : "").padEnd(col)}${l}`));
    }
  }
  const places = sectionOf(body, WORDS.groupListHeading);
  if (places !== null) {
    const entries = groupEntriesOf(places);
    out.push("", WORDS.groupListHeading);
    for (const e of entries.slice(0, shape.places)) for (const l of e) out.push(cutTo(`  ${terminalLine(l.trimEnd()) ?? ""}`, WIDTH));
    const hidden = entries.slice(shape.places);
    if (hidden.length > 0) {
      const counts = hidden.map(placesOfGroupEntry);
      out.push(`  ${EXPLAIN_WORDS.moreFindings(hidden.length, counts.some((c) => c === null) ? null : counts.reduce<number>((a, c) => a + (c as number), 0))}`);
    }
  }
  const reasoning = sectionOf(body, WORDS.reasoningHeading);
  if (reasoning !== null) {
    const all = terminalLines(reasoning).flatMap((l) => (l === "" ? [""] : wrapWords(l, WIDTH - 2)));
    while (all.length > 0 && all[all.length - 1] === "") all.pop();
    const shown = all.slice(0, shape.reasoning);
    while (shown.length > 0 && shown[shown.length - 1] === "") shown.pop();
    out.push("", terminalLine(`## ${WORDS.reasoningHeading}`) as string, ...shown.map((l) => (l === "" ? "" : `  ${l}`)));
    if (all.length > shown.length) out.push(`  ${EXPLAIN_WORDS.continues}`);
  }
  const summaries = [WORDS.readHeading, WORDS.decisionsHeading, WORDS.deeperHeading]
    .map((h) => ({ h, s: firstSentenceOf(sectionOf(body, h)) }))
    // Mock M7's counted "How it was read": the files read and the searches
    // run, from the file's own counted lists, before the section's first sentence (which a narrow screen cuts).
    .map((x) => (x.h === WORDS.readHeading ? { h: x.h, s: [readCountsOf(sectionOf(body, x.h)), x.s].filter((y) => y !== "").join(" · ") } : x))
    .filter((x) => x.s !== "")
    .map((x) => cutTo(`${x.h}: ${x.s}`, WIDTH));
  if (summaries.length > 0) out.push("", ...summaries);
  out.push("", ...wrapWords(EXPLAIN_WORDS.whereFirst, WIDTH), path);
  return out;
}

/**
 * Whether a first screen keeps to design section 6's budget: lines, characters, and 80 columns but the path's line.
 * `reserve`: lines kept free for what goes in beside the screen and is never cut (a copy still in place, W3).
 */
export function withinFirstScreen(lines: readonly string[], reserve = 0): boolean {
  return (
    lines.length <= FIRST_SCREEN_LINES - reserve &&
    widthOf(lines.join("\n")) <= FIRST_SCREEN_CHARS &&
    lines.slice(0, -1).every((l) => widthOf(l) <= WIDTH)
  );
}

/** `legal-scan explain <handle> [in full]`: the finding's file, its first screen or all of it, then its path. */
export function explainLines(o: ExplainOptions): { exitCode: number; lines: string[] } {
  const target = resolve(o.target);
  const latest = latestReport(o.stateDir, target);
  if (!latest.ok) return { exitCode: 1, lines: [latest.why] };
  const entry = latest.entry;
  const numbers = numbersOf(o.stateDir, target);
  const named = resolveHandle(entry, o.handle, numbers.ok ? numbers.byId : { why: numbers.why });
  if (!named.ok) return { exitCode: named.exitCode, lines: named.lines };
  if ("verdict" in named) {
    const v = named.verdict;
    // A ruled-out verdict: where its section is, as `path:line` (a terminal opens the file there); `fix` proposes nothing.
    return { exitCode: o.lineOnly ? 1 : 0, lines: [...wrapWords(EXPLAIN_WORDS.ruledOutVerdict(v.short, v.title), WIDTH), `${v.path}:${v.line}`] };
  }
  const got = readReportFile(entry, named.file);
  if (!got.ok) return { exitCode: 1, lines: [got.why] };
  const first = nameLineOf(got.text, named.file);
  if (o.lineOnly) return { exitCode: 0, lines: [first] };
  /* crf11d-r2 W3: each copy of a deeper check's test still in place, for a
   * finding of this file, is the line after the first (D3b's `explainCopyLines`); never cut, and the first screen is that
   * many lines shorter. */
  const copy = explainCopyLines([...new Set(deepCopiesOnRecord(o.stateDir, target).filter((c) => entry.findingFiles.get(c.findingId) === named.file).map((c) => c.path))]);
  const withCopy = (lines: readonly string[]): string[] => [...lines.slice(0, 1), ...copy, ...lines.slice(1)];
  if (o.full) {
    const body = got.text.replace(/\n+$/, "").split("\n").slice(1);
    while (body[0] === "") body.shift();
    return { exitCode: 0, lines: withCopy([first, ...terminalLines(body), "", EXPLAIN_WORDS.whereFull, got.path]) };
  }
  let screen: string[] = [];
  for (const shape of SCREEN_SHAPES) {
    screen = firstScreenOf(got.text, named.file, got.path, shape);
    if (withinFirstScreen(screen, copy.length)) return { exitCode: 0, lines: withCopy(screen) };
  }
  // Past the narrowest shape (a card of very many rows): its lines from the top to the budget, then where the rest is.
  const tail = ["", ...wrapWords(EXPLAIN_WORDS.whereFirst, WIDTH), got.path];
  const top = screen.slice(0, FIRST_SCREEN_LINES - tail.length - 1 - copy.length).map((l) => cutTo(l, WIDTH));
  return { exitCode: 0, lines: withCopy([...top, EXPLAIN_WORDS.continues, ...tail]) };
}

/** A list item of a raw-view file, its wrapped rows joined (formMarkdown wraps at 75 and indents the continuation). */
function listItems(lines: readonly string[]): string[] {
  const items: string[] = [];
  for (const l of lines) {
    if (/^- /.test(l)) items.push(l);
    else if (/^\s+\S/.test(l) && items.length > 0) items[items.length - 1] = `${(items[items.length - 1] as string).replace(/\\$/, "")}\n${l.trim()}`;
    else if (l.trim() === "" || /^#/.test(l)) {
      if (/^#/.test(l)) break;
    }
  }
  return items;
}

/** Cut a line to the terminal width at a word, with "…" where cut. */
function fitWidth(line: string): string {
  const cs = Array.from(line);
  if (cs.length <= WIDTH) return line;
  const cut = cs.slice(0, WIDTH - 1).join("");
  const sp = cut.lastIndexOf(" ");
  return `${(sp > WIDTH / 2 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

/** `legal-scan ruled-out`: the ruled-out verdicts by rule, high-level rules first with up to 3 examples each, at most 20 lines. */
export function ruledOutLines(o: { target: string; stateDir: string | null }): { exitCode: number; lines: string[] } {
  const latest = latestReport(o.stateDir, resolve(o.target));
  if (!latest.ok) return { exitCode: 1, lines: [latest.why] };
  const entry = latest.entry;
  const index = readReportFile(entry, "ruled-out.md");
  if (!index.ok) return { exitCode: 1, lines: [index.why] };
  const raw = index.text.replace(/\n+$/, "").split("\n");
  const head: string[] = [terminalLine(raw[0] ?? "") ?? ""];
  let i = 1;
  while (raw[i] === "") i += 1;
  while (i < raw.length && raw[i] !== "") head.push(raw[i++] as string);
  const rules = listItems(raw.slice(i))
    .map((item) => {
      const m = /^- \[([^\]]*)\]\(([^)]+)\)\s*·\s*(\S+)\s*·\s*([\d,]+)/.exec(item.replace(/\n/g, " "));
      return m ? { label: m[1] as string, file: m[2] as string, level: m[3] as string, count: Number((m[4] as string).replace(/,/g, "")) } : null;
    })
    .filter((r): r is { label: string; file: string; level: string; count: number } => r !== null);
  const where = [EXPLAIN_WORDS.ruledOutWhere, index.path];
  if (rules.length === 0) return { exitCode: 0, lines: [...head, ...terminalLines(raw.slice(i)).filter((l) => l !== "" && l !== "---" && !/^\*.*\*$/.test(l)), "", ...where] };
  const high = rules.filter((r) => r.level === "high");
  const rest = rules.filter((r) => r.level !== "high");
  const restLines = rest.length > 0 ? [`  ${EXPLAIN_WORDS.ruledOutOther}`, `  ${EXPLAIN_WORDS.ruledOutRest(rest.reduce((n, r) => n + r.count, 0), rest.length)}`] : [];
  let room = RULED_OUT_LINES - head.length - 1 - restLines.length - where.length - (high.length > 0 ? 1 : 0);
  const shownHigh = high.length <= room ? high : high.slice(0, Math.max(0, room - 1));
  room -= shownHigh.length + (shownHigh.length < high.length ? 1 : 0);
  const examples = new Map<string, string[]>();
  for (const r of shownHigh) {
    const got = readReportFile(entry, r.file);
    const items = got.ok ? listItems(got.text.split("\n").slice(1)) : [];
    examples.set(
      r.file,
      // A verdict's entry is its place, then its short id (a link to its section) and its reason, wrapped over rows; the
      // file's other list items (the links back, the rule's name) are not verdicts.
      items.filter((it) => /\]\(#(?:finding|verdict)-/.test(it)).map((it) => {
        const [placeRow, ...rows] = it.split("\n");
        const idRow = rows.join(" ");
        const place = (terminalLine(placeRow ?? "") ?? "").replace(/^-\s*/, "");
        const reason = idRow.includes(" · ") ? (terminalLine(idRow.slice(idRow.indexOf(" · ") + 3)) ?? "") : "";
        return fitWidth(`       ${place}${reason ? `  ${reason}` : ""}`);
      }),
    );
  }
  const take = new Map<string, number>(shownHigh.map((r) => [r.file, 0]));
  for (let k = 0; k < 3 && room > 0; k++) {
    for (const r of shownHigh) {
      if (room <= 0) break;
      if ((examples.get(r.file)?.length ?? 0) > k) {
        take.set(r.file, k + 1);
        room -= 1;
      }
    }
  }
  const out = [...head, ""];
  if (high.length > 0) out.push(`  ${EXPLAIN_WORDS.ruledOutHigh}`);
  for (const r of shownHigh) out.push(fitWidth(`  ${String(r.count).padStart(4)}  ${r.label}`), ...(examples.get(r.file) ?? []).slice(0, take.get(r.file) ?? 0));
  if (shownHigh.length < high.length) out.push(`  ${EXPLAIN_WORDS.ruledOutMoreHigh(high.length - shownHigh.length)}`);
  out.push(...restLines, ...where);
  return { exitCode: 0, lines: out };
}

/** The report file "what changed" prints (assemble-report.ts writes it on a later run only). */
export const CHANGES_FILE = "changes.md";

/**
 * "What changed" (design rf13 3.5): the top of
 * the latest report's changes.md, from its heading down to the line before its second `## ` heading (the comparison line
 * and "New or higher"), then its path. Read only while its sha256 is the one the assembly (or a later rewrite) recorded,
 * as every file these commands print (B2), so a changes.md anyone changed is never shown as WolfBoy's. A report that
 * recorded no changes.md and has none on disk was not compared with an earlier review (a first review is one): one
 * sentence says so, with the folder. A changes.md on disk that the report did not record is not printed.
 */
export function changesTopLines(o: { target: string; stateDir: string | null }): { exitCode: number; lines: string[] } {
  const latest = latestReport(o.stateDir, resolve(o.target));
  if (!latest.ok) return { exitCode: 1, lines: [latest.why] };
  const entry = latest.entry;
  if (!entry.files.has(CHANGES_FILE) && !existsSync(join(entry.dir, CHANGES_FILE))) return { exitCode: 0, lines: [EXPLAIN_WORDS.noChanges(entry.dir)] };
  const got = readReportFile(entry, CHANGES_FILE);
  if (!got.ok) return { exitCode: 1, lines: [got.why] };
  const raw = got.text.replace(/\n+$/, "").split("\n");
  let end = raw.length;
  let seen = 0;
  for (let i = 0; i < raw.length; i++) {
    if (!/^## /.test(raw[i] as string)) continue;
    seen += 1;
    if (seen === 2) {
      end = i;
      break;
    }
  }
  const top = terminalLines(raw.slice(0, end));
  while (top.length > 0 && top[top.length - 1] === "") top.pop();
  return { exitCode: 0, lines: [...top, "", got.path] };
}

/**
 * The `report` command's lines: the latest
 * report of the folder (the state folder's record of the report files, as `explain` reads it), its folder and the files beside
 * it, and why VS Code's own search does not find them.
 */
export function reportPathLines(o: { target: string; stateDir: string | null }): { exitCode: number; lines: string[] } {
  const latest = latestReport(o.stateDir, resolve(o.target));
  if (!latest.ok) return { exitCode: 1, lines: [latest.why] };
  const entry = latest.entry;
  const main = [...entry.files.keys()].includes("report.md") ? join(entry.dir, "report.md") : entry.dir;
  return {
    exitCode: 0,
    lines: [
      `The latest report: ${main}`,
      `Its folder: ${entry.dir} (laws.md, not-checked.md, ruled-out.md and one file per finding under findings/)`,
      "VS Code's Quick Open and search skip .legal/ (its ignore files hide it from them): open the file by this path (File > Open File).",
    ],
  };
}

/**
 * IN CI A COMMAND THAT PRINTS FINDINGS ON
 * REQUEST PRINTS WHERE THEY ARE, NOT THEM: the same decision as the scan's log and the assembly's end screen
 * (declaration.ts `ciSet`), so a CI job that runs Claude Code with the plugin or a team that commits `.legal/`
 * never puts a finding's place, title or reasoning into a log the repository's readers read. Exit 1: not printed. True
 * where it printed that and the command is done.
 */
function inCiLog(out: NodeJS.WritableStream, command: string, target: string): boolean {
  if (!ciSet(process.env)) return false;
  const where = reportPathLines({ target, stateDir: processStateDir() });
  out.write(`${[EXPLAIN_WORDS.notPrintedInCi(command), ...where.lines].join("\n")}\n`);
  process.exitCode = 1;
  return true;
}

/** The CLI registration, kept here so the shared `index.ts` carries one line for it. */
export function registerExplain(program: Command): void {
  program
    .command("explain")
    .description(
      "Print a finding's file from the latest report of this folder, as the scan wrote it: its first screen (the card and the start of the review's reasoning), or with \"in full\" the whole file, then the file's path. The finding is named by its F-number in this folder (F2) or by at least 6 characters of its id (e41d7a); where a prefix matches more than one finding, the candidates are listed and nothing is printed. Prints nothing from a file that changed after the scan wrote it. Writes nothing. Exit 0 printed, 1 not printed, 2 not a handle.",
    )
    .argument("<handle>", "an F-number of this folder's list (F2) or at least 6 characters of a finding id (e41d7a)")
    .argument("[words...]", "\"in full\": the whole file")
    .option("--line", "print only the line that names the finding (F-number, short id, title, place): the line shown above a proposed fix")
    .option("--target <dir>", "the scanned folder whose latest report is read", ".")
    .action((handle: string, words: string[], opts: { line?: boolean; target: string }) => {
      const said = words.join(" ").trim().toLowerCase();
      if (said !== "" && said !== "in full") {
        process.stdout.write(`${EXPLAIN_WORDS.notUnderstood(words.join(" "))}\n`);
        process.exitCode = 2;
        return;
      }
      if (inCiLog(process.stdout, "explain", opts.target)) return;
      const { exitCode, lines } = explainLines({ target: opts.target, stateDir: processStateDir(), handle, full: said === "in full", lineOnly: opts.line === true });
      process.stdout.write(`${lines.join("\n")}\n`);
      process.exitCode = exitCode;
    });
  program
    .command("report")
    .description("Print where the latest report of this folder is: the path of its report.md and its folder, as the scan wrote them.")
    .option("--target <dir>", "the scanned folder whose latest report is named", ".")
    .action((opts: { target: string }) => {
      const { exitCode, lines } = reportPathLines({ target: opts.target, stateDir: processStateDir() });
      process.stdout.write(`${lines.join("\n")}\n`);
      process.exitCode = exitCode;
    });
  program
    .command("tidy")
    .description("List what in .legal/ to keep (the reviews the next scan reuses) and the folders earlier scans set aside, with their sizes and the command that deletes them. Deletes nothing.")
    .option("--target <dir>", "the scanned folder whose .legal/ is listed", ".")
    .action((opts: { target: string }) => {
      process.stdout.write(`${legalTidyLines(opts.target, process.cwd()).join("\n")}\n`);
      process.exitCode = 0;
    });
  program
    .command("ruled-out")
    .description(
      "Print the latest report's ruled-out verdicts by rule, high-level rules first with up to three one-line examples each, in at most 20 lines, then the path of ruled-out.md, as the scan wrote them. Prints nothing from a file that changed after the scan wrote it. Writes nothing. Exit 0 printed, 1 not printed.",
    )
    .option("--target <dir>", "the scanned folder whose latest report is read", ".")
    .action((opts: { target: string }) => {
      if (inCiLog(process.stdout, "ruled-out", opts.target)) return;
      const { exitCode, lines } = ruledOutLines({ target: opts.target, stateDir: processStateDir() });
      process.stdout.write(`${lines.join("\n")}\n`);
      process.exitCode = exitCode;
    });
  program
    .command("changes")
    .description(
      "Print what changed since the review before the latest one: the top of its changes.md (the comparison and \"New or higher\"), then the file's path, as the scan wrote it. Prints nothing from a changes.md that changed after the scan wrote it; says in one sentence when the latest review was not compared with an earlier one, which writes none.",
    )
    .option("--target <dir>", "the scanned folder whose latest report is read", ".")
    .action((opts: { target: string }) => {
      if (inCiLog(process.stdout, "changes", opts.target)) return;
      const { exitCode, lines } = changesTopLines({ target: opts.target, stateDir: processStateDir() });
      process.stdout.write(`${lines.join("\n")}\n`);
      process.exitCode = exitCode;
    });
}
