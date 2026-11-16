/**
 * THE ANSWER SEAT AND ITS CHECKS A1-A6.
 *
 * A place-plan candidate larger than one seat is read by place seats; when they (and any make-up seat) have ended, the
 * program writes the bounded fold (`place-fold.ts`) and launches one answer seat: a fresh `legal-adjudicator` in answer
 * mode that decides no place and answers the candidate once. Its answer is checked at capture, beside C1-C9, and each
 * failure refuses it naming what to amend:
 *
 *   A1 every place id the answer rests on as a premise (`{role: "premise", unit: "P<n>"}`), or names as an item (`{role:
 *      "item", unit: "P<n>"}`, unit U1), is a kept place
 *      (`is_the_construct` / `construct_but_gated`) of the per-place table; the program writes its file, line and quote
 *      from the table (today's `premise-not-affirmative`);
 *   A2 every element the answer found itself (an entry given by `file`, `lines` and `quote`) lies in a range the seat's
 *      own transcript shows it Read (the H1 rule for evidence given by file and line);
 *   A3 enumeration (the class, or a limb of a mixed rule): every item of the table's kept places is named by an `item`
 *      entry, and every item named is an `item` of the table (`unknown-item`); an item entry may be `{role: "item",
 *      name}` alone, and the program writes the location of its first kept place;
 *   A4 `not_applicable` only where no place is kept, none is `undetermined` and none is not checked - for every class;
 *   A5 C7 over the fold: the seat's Reads cover every line of the fold file;
 *   A6 every quote the answer gives by file and line is a verbatim part of those lines of the tree (C5's rule: at least
 *      15 characters, or the whole line; compared as the final quote check compares it, place-reply.ts `quoteStanding`).
 *
 * A7 is the make-up answer seat (`makeup-seat.ts`) and, after it, the candidate shown "not answered" in the report
 * (`assemble-report.ts`). An answer seat writes no `decisions`: no seat retypes a place.
 */
import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { relativePath } from "./project-path.js";
import type { Candidate } from "wolfboy-schemas";
import { answerPremisesOf, type AnswerSeatWork } from "./answer-premises.js";
import { foldClassesOf, isKeptPlace, programItemSourceOf, sameProgramItem, type PlaceTableRow } from "./place-fold.js";
import { PLACE_QUOTE_MIN_CHARS, quoteStanding } from "./place-reply.js";
import { readingPlanOf } from "./reading.js";
import { readCovers, sawAt, type SeatSight } from "./seat-opened.js";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** A place-plan candidate whose verdict seat came after place seats: its seat is the answer seat. */
export function isAnswerSeatCandidate(c: Candidate): boolean {
  return (c.reading_plan as { unit?: string } | undefined)?.unit === "place" && (readingPlanOf(c)?.reader_slices.length ?? 0) > 0;
}

/* A4 and the place it counts live in place-bar.ts (the carry-forward step holds an earlier
 * answer to the same bar), and are exported from here as before. */
export { notApplicableBar, type PlaceStanding } from "./place-bar.js";
import { notApplicableBar } from "./place-bar.js";
import { readRegularFile, readSourceText } from "./project-read.js";
import { placeOfUnit } from "./ref-ids.js";

/** What the answer seat's checks are made against. */
export interface AnswerCapture {
  table: readonly PlaceTableRow[];
  /** The fold file the seat's brief names, absolute; null where the entry names none. */
  foldPath: string | null;
  sight?: SeatSight;
  /** The scanned tree's root. */
  root: string;
  /** The model the answer seat's launch entry named, recorded in its premises; null where the capture has none. */
  model?: string | null;
  /** The answer's tree-wide work, one slot per answer (answer-premises.ts `AnswerSeatWork`). */
  work?: AnswerSeatWork;
}

const lineCount = (path: string): number => {
  const t = readRegularFile(path, "utf8");
  const n = t.split("\n").length;
  return t.endsWith("\n") ? n - 1 : n;
};

/** The lines `first`-`last` of a tree file, or null where the file is not a regular file inside the tree. */
function treeLines(root: string, file: string, first: number, last: number): string[] | null {
  const abs = isAbsolute(file) ? file : resolve(root, file);
  try {
    const real = realpathSync(abs);
    const rel = relativePath(realpathSync(root), real);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel) || rel.split("/")[0] === "..") return null;
    if (!statSync(real).isFile()) return null;
    const lines = readSourceText(real).split("\n");
    if (first < 1 || last > lines.length) return null;
    return lines.slice(first - 1, last);
  } catch {
    return null;
  }
}

const span = (lines: string): [number, number] | null => {
  const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(lines);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  return a >= 1 && b >= a ? [a, b] : null;
};

/**
 * Check one answer-seat verdict entry (A1-A6) and write its evidence from the table where it names places or items by
 * id. Returns the entry as the record holds it (no `decisions`; `reading` with no rows of its own and its `searched`)
 * and the problems that refuse it.
 */
export function answerOfPlaces(args: { candidate: Candidate; entry: Obj; capture: AnswerCapture }): { entry: Obj; problems: string[] } {
  const { candidate, entry, capture } = args;
  const problems: string[] = [];
  const table = capture.table;
  const byPlace = new Map(table.map((r) => [r.place, r]));
  const kept = table.filter(isKeptPlace);

  if (Array.isArray(entry.decisions) && entry.decisions.length > 0) {
    problems.push("an answer seat decides no place: its place seats did, and the fold and the per-place table hold their rows. Remove `decisions` and answer the candidate from the fold");
  }

  // A5: every line of the fold Read.
  if (!capture.foldPath || !existsSync(capture.foldPath)) {
    problems.push(`A5: the fold your brief names (${capture.foldPath ?? "none"}) is not on disk, so no answer can rest on it`);
  } else {
    const n = lineCount(capture.foldPath);
    if (!capture.sight || !readCovers(capture.sight, capture.foldPath, 1, Math.max(1, n))) {
      problems.push(`A5: your Reads do not cover every line of the fold ${capture.foldPath} (${n} lines): Read each of its fixed ranges your brief lists, then answer again`);
    }
  }

  const evidence = Array.isArray(entry.evidence) ? entry.evidence : [];
  const tableItems = new Map<string, PlaceTableRow[]>();
  for (const r of kept) if (r.item) tableItems.set(r.item, [...(tableItems.get(r.item) ?? []), r]);
  /* Where the program holds the items the table's are the program's; a name the answer gives is that
   * item where it is the same item by the census's own fold of the word (`Mixpanel` is the census's `mixpanel`). */
  const source = programItemSourceOf(candidate);
  /* Fix C2-2: the table's `item` is the name the item is shown by ("Mixpanel"); a name the answer gives is
   * that item where it is the name, the program's identity of it (`program_item`), or the census's fold of the word. */
  const tableItemOf = (name: string): string | undefined =>
    tableItems.has(name) ? name : kept.find((r) => r.item && sameProgramItem(source, name, r.program_item ?? r.item, r.item))?.item;
  /* The name the record keeps for an item of a kept place. Where the program holds the
   * items (`token`), the table shows one by its matched words quoted (`"turnstile"`) and the record's own check (step 5a,
   * `reading.ts`) knows it only by the census's token, which is the place's `program_item`: fm1's answer seats named
   * every item as the fold shows it, A3 accepted the name and wrote it, and the record's check refused it (162
   * entries over the refused and invalid hand-backs). The record keeps the program's name; the report shows it by the table's (`shownItemNameOf`). */
  const programNameOf = (r: PlaceTableRow): string => (source === "token" && r.program_item ? r.program_item : (r.item ?? ""));
  const named = new Set<string>();
  const out = evidence.map((value, i) => {
    if (!isObj(value)) return value;
    const label = `evidence ${i + 1}`;
    const role = text(value.role);
    const unit = text(value.unit);
    // A1: a premise named by place id.
    if (unit) {
      const id = placeOfUnit(unit) ?? unit;
      const row = byPlace.get(id);
      /* An item named by the kept place it was found at. The place's row already says which
       * item it is, so the program writes the name (the program's, where it holds the items) and the location from it;
       * a `name` the seat gives beside the id must be that item, and a census id (`item`) beside it is not needed. fm1's
       * answer seats gave 31 such entries over their refused and invalid hand-backs, and every one was refused (A1, and
       * its location absent). */
      if (role === "item") {
        if (!row) problems.push(`A3: ${label} names the place ${unit}, which is no place of this candidate`);
        else if (!isKeptPlace(row)) {
          problems.push(`A3: ${label} names the place ${id} as an item, and that place is not kept (${row.not_checked ? `not checked: ${row.not_checked}` : `decided ${row.decision}`}); an item names a place decided is_the_construct or construct_but_gated`);
        } else if (!row.item) problems.push(`A3: ${label} names the place ${id} as an item, and the per-place table names no item for that place: name the item by \`name\` instead`);
        else {
          const given = text(value.name).trim();
          if (given && tableItemOf(given) !== row.item) {
            problems.push(`A3: ${label} names the place ${id} and the item ${JSON.stringify(given)}, and that place is the item ${JSON.stringify(row.item)}: give the place alone, or the item's name alone`);
            return value;
          }
          named.add(row.item);
          return { role: "item", name: programNameOf(row), file: row.file, lines: row.line_decided ?? String(row.line), quote: row.quote ?? "" };
        }
        return value;
      }
      if (role !== "premise") problems.push(`A1: ${label} names a place (${unit}) but its role is ${JSON.stringify(role)}: only a premise or an item names a place by id`);
      else if (!row) problems.push(`A1: premise ${unit} is no place of this candidate`);
      else if (!isKeptPlace(row)) {
        problems.push(`A1: premise ${id} is not a kept place of the per-place table (${row.not_checked ? `not checked: ${row.not_checked}` : `decided ${row.decision}`}); a premise names a place decided is_the_construct or construct_but_gated`);
      } else {
        return { role: "premise", file: row.file, lines: row.line_decided ?? String(row.line), quote: row.quote ?? "" };
      }
      return value;
    }
    // A3: an item named alone takes the location of its first kept place.
    if (role === "item") named.add(tableItemOf(text(value.name).trim()) ?? text(value.name).trim());
    if (role === "item" && !("file" in value) && !("lines" in value) && !("quote" in value)) {
      const name = tableItemOf(text(value.name).trim()) ?? text(value.name).trim();
      const first = tableItems.get(name)?.[0];
      if (!first) {
        problems.push(`A3 (unknown-item): ${label} names the item ${JSON.stringify(name)}, which is no \`item\` of a kept place of the per-place table`);
        return value;
      }
      return { role: "item", name: programNameOf(first), file: first.file, lines: first.line_decided ?? String(first.line), quote: first.quote ?? "" };
    }
    // A2 and A6: an element (or an item, or a premise) given by file, line and quote.
    const file = text(value.file);
    const lines = text(value.lines);
    const quote = text(value.quote);
    if (!file && !lines) return value;
    const at = span(lines);
    if (!file || !at) {
      problems.push(`A2: ${label} gives no file and line range (\`file\`, \`lines\` "12" or "12-14")`);
      return value;
    }
    let renamed: Obj | null = null;
    if (role === "item") {
      const shown = tableItemOf(text(value.name).trim());
      if (shown === undefined) {
        problems.push(`A3 (unknown-item): ${label} names the item ${JSON.stringify(text(value.name))}, which is no \`item\` of a kept place of the per-place table`);
      } else {
        const keptRow = tableItems.get(shown)?.[0];
        if (keptRow && programNameOf(keptRow) !== text(value.name)) renamed = { ...value, name: programNameOf(keptRow) };
      }
    }
    if (!capture.sight || !sawAt(capture.sight, capture.root, file, lines)) {
      problems.push(`A2: ${label} (${file}:${lines}): your transcript shows no Read covering that line; Read the file around it, then answer again`);
    }
    const got = treeLines(capture.root, file, at[0], at[1]);
    if (!got) problems.push(`A6: ${label} (${file}:${lines}) is not a line range of a file in the scanned tree`);
    else if (!quote.trim()) problems.push(`A6: ${label} (${file}:${lines}) has no \`quote\``);
    else {
      // C5's rule over those lines, as the final quote check compares a quotation with its file (`quoteStanding`).
      const standing = quoteStanding(quote, got.join("\n"), file);
      if (standing === null) problems.push(`A6: ${label}: \`quote\` is not a verbatim part of ${file}:${lines}`);
      else if (standing === "short") problems.push(`A6: ${label}: \`quote\` is shorter than ${PLACE_QUOTE_MIN_CHARS} characters and is not the whole line`);
    }
    return renamed ?? value;
  });

  // A3: enumeration names every item of the table.
  if (foldClassesOf(candidate).includes("enumeration")) {
    const missing = [...tableItems.keys()].filter((name) => !named.has(name));
    if (missing.length > 0) {
      problems.push(`A3: the answer names ${missing.length} item(s) of the kept places with no \`item\` entry: ${missing.slice(0, 20).map((m) => JSON.stringify(m)).join(", ")}${missing.length > 20 ? `, and ${missing.length - 20} more` : ""}; an item entry may be {"role": "item", "name": "<item>"} and the program writes its first kept place`);
    }
  }

  // A4: not_applicable bars (the one rule for both seats that answer a candidate read place by place).
  const a4 = notApplicableBar(entry.verdict, table);
  if (a4) problems.push(a4);

  const searched = Array.isArray(entry.searched) ? entry.searched : undefined;
  const next: Obj = {};
  for (const [k, v] of Object.entries(entry)) {
    if (k === "decisions" || k === "searched" || k === "reading") continue;
    next[k] = k === "evidence" ? out : v;
  }
  /* VA-5: an answer that holds carries its own premises - the fold's digest over the table it was checked
   * against, and the files and searches of the seat's own transcript - which the assembly moves into `rests_on.answer`. */
  next.reading = {
    read: [],
    ...(searched && searched.length > 0 ? { searched } : {}),
    ...(problems.length === 0 ? { answer_premises: answerPremisesOf({ candidate, table, foldPath: capture.foldPath, sight: capture.sight, root: capture.root, model: capture.model ?? null, ...(capture.work ? { work: capture.work } : {}) }) } : {}),
  };
  return { entry: next, problems };
}
