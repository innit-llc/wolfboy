/**
 * THE NUMBER LIST: the F-numbers of one scanned folder, on this computer (delivery design
 * rf11, section 3.5, "F-numbers stay with their finding", "Where the number list lives", "When the list is missing or does
 * not match").
 *
 * A finding keeps the F-number it was first shown with for as long as it exists in the folder: the number belongs to the
 * finding id, not to a place in a list. A new finding takes the next unused number, in the order `report.md` first lists
 * the new findings; a ruled-out verdict takes none; no number is ever given to a second finding of the folder.
 *
 * The list is one append-only record per scanned folder in the person's state folder (state-record.ts: refused inside the
 * scanned folder or any git work tree, written whole or not at all, never rewritten). Each line is one JSON object: a
 * finding id, its number, the scan that recorded it and the finding's rule. Every place of a group has its own line, and
 * an id's latest line holds its number.
 *
 * Groups (one rule at one level, several places, each its own finding id) are numbered through their places. A group
 * shows the earliest number any of its present places holds. A split (a group's places now in two groups): the part
 * holding the place first recorded with the shared number keeps it; the other part takes the next unused number. A merge
 * (the places of two numbers now in one group): the group shows the earlier number, the other number's places are
 * recorded under it, and the group says it was also shown under the other.
 *
 * A list in which, by their latest lines, one number is held by findings of different rules was not written by this
 * program (a group's places share one number and one rule); it is read as unreadable, which is read as missing. A missing
 * list takes the numbers the carried log recorded (the log the person chose at the earlier-run question); every other
 * finding takes a number above the highest that log, or any log of this folder whose digest this computer recorded,
 * holds. A list that disagrees with the carried log wins (the program wrote it outside the project), and the report says
 * how many findings the log numbered differently.
 */
import { createHash } from "node:crypto";
import { lstatSync, readdirSync } from "node:fs";
// A log in the project is read through project-read.ts, as every read of the project is.
import { readRegularFile } from "./project-read.js";
import { join } from "node:path";
import { NUMBERS_RECORD, type StateRecordKind } from "./state-record.js";

/**
 * The number list's kind of state-folder record: the one the hook guard refuses tool calls to write
 * (state-record.ts `GUARDED_STATE_RECORDS`), taken from there so the guard and the writer name one folder. It was a
 * second kind, "finding-numbers", which no guard row named.
 */
export const NUMBER_LIST_KIND: StateRecordKind = NUMBERS_RECORD;

/** One line of the list. */
export interface NumberEntry {
  id: string;
  n: number;
  scan: string;
  rule: string;
}

/** The list as read: every id's latest number, and where each id was first recorded with it (its line). */
export type NumberList =
  | { ok: true; byId: Map<string, { n: number; rule: string; since: number }>; max: number; lines: number }
  | { ok: false; why: string };

/** A finding id as the verdict definition holds it (verdict.schema.json `finding_id`: any non-empty string), never stricter. */
const ID = { test: (id: string): boolean => id.length > 0 };

/** Read the list's text. Any line that is not the program's own form makes the whole list unreadable. */
export function parseNumberList(text: string): NumberList {
  const byId = new Map<string, { n: number; rule: string; since: number }>();
  let max = 0;
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  for (let i = 0; i < lines.length; i += 1) {
    let e: unknown;
    try {
      e = JSON.parse(lines[i] as string);
    } catch {
      return { ok: false, why: `line ${i + 1} is not a record this program writes` };
    }
    const o = e as Partial<NumberEntry> | null;
    if (!o || typeof o !== "object" || typeof o.id !== "string" || !ID.test(o.id) || !Number.isInteger(o.n) || (o.n as number) < 1 || typeof o.scan !== "string" || typeof o.rule !== "string" || o.rule === "") {
      return { ok: false, why: `line ${i + 1} is not a record this program writes` };
    }
    const prev = byId.get(o.id);
    byId.set(o.id, { n: o.n as number, rule: o.rule, since: prev && prev.n === o.n ? prev.since : i });
    max = Math.max(max, o.n as number);
  }
  // By their latest lines, one number is held by findings of one rule only.
  const ruleOfNumber = new Map<number, string>();
  for (const [, v] of byId) {
    const r = ruleOfNumber.get(v.n);
    if (r !== undefined && r !== v.rule) return { ok: false, why: `F${v.n} is held by findings of two rules, which this program never writes` };
    ruleOfNumber.set(v.n, v.rule);
  }
  return { ok: true, byId, max, lines: lines.length };
}

/** One entry the report lists and numbers: a single finding, or a group's places, with its rule. */
export interface NumberedGroup {
  ids: readonly string[];
  rule: string;
}

export interface NumberRequest {
  /** What `report.md` lists, in the order it first lists it (to fix in fix order, then to clarify, then to answer). */
  groups: readonly NumberedGroup[];
  scan: string;
  /** The list as read; null where there is none or it cannot be read (both read as missing). */
  list: NumberList | null;
  /** The numbers the carried log recorded, with the words that name its review ("the review of 4 Nov"). */
  carried: { numbers: ReadonlyMap<string, number>; label: string } | null;
  /** The highest number in any log of this folder whose digest this computer recorded; 0 where none is known. */
  recordedMax: number;
}

/** What the report's identity line says once about the numbers, where it says anything. */
export type NumberNote =
  | { kind: "taken"; label: string }
  | { kind: "start"; from: number }
  | { kind: "differs"; label: string; count: number };

export interface NumberResult {
  /** Each group's number, in the order of `groups`. */
  numbers: number[];
  /** The lines to add to the list (ids new to it, or whose number changed). */
  append: NumberEntry[];
  note: NumberNote | null;
  /** For a group that merged numbers, the other numbers it was shown as ("also shown as F12"). */
  alsoShownAs: Map<number, number[]>;
  /** For a group whose number the carried log gave differently, that number ("shown as F9 in the review of 4 Nov"). */
  shownInCarried: Map<number, number>;
  /** Every numbered finding id with its number: what the evidence log records. */
  byId: Map<string, number>;
}

/** Give every group its number. Pure: nothing is read or written. */
export function assignNumbers(req: NumberRequest): NumberResult {
  const fromList = req.list && req.list.ok ? req.list : null;
  const carriedMax = req.carried ? Math.max(0, ...req.carried.numbers.values()) : 0;
  // Where each id's number comes from: the list where there is one, else the carried log.
  const known = new Map<string, { n: number; since: number }>();
  if (fromList) for (const [id, v] of fromList.byId) known.set(id, { n: v.n, since: v.since });
  else if (req.carried) {
    let i = 0;
    for (const [id, n] of req.carried.numbers) known.set(id, { n, since: i++ });
  }
  let next = Math.max(fromList ? fromList.max : 0, fromList ? 0 : carriedMax, fromList ? 0 : req.recordedMax) + 1;
  const startAt = next;

  // Each group's claim: the earliest number any of its places holds, and how early that place was recorded with it.
  const claims = req.groups.map((g) => {
    let best: { n: number; since: number } | null = null;
    const held = new Set<number>();
    for (const id of g.ids) {
      const k = known.get(id);
      if (!k) continue;
      held.add(k.n);
      if (!best || k.n < best.n || (k.n === best.n && k.since < best.since)) best = k;
    }
    return { best, held };
  });
  // A number claimed by two groups (a split) stays with the group holding the place recorded with it first.
  const winner = new Map<number, number>();
  claims.forEach((c, gi) => {
    if (!c.best) return;
    const w = winner.get(c.best.n);
    if (w === undefined) winner.set(c.best.n, gi);
    else {
      const other = claims[w]?.best;
      if (other && c.best.since < other.since) winner.set(c.best.n, gi);
    }
  });
  const numbers: number[] = [];
  const alsoShownAs = new Map<number, number[]>();
  claims.forEach((c, gi) => {
    const n = c.best && winner.get(c.best.n) === gi ? c.best.n : next++;
    numbers.push(n);
    const others = [...c.held].filter((x) => x !== n && winner.get(x) === undefined).sort((x, y) => x - y);
    if (others.length > 0) alsoShownAs.set(gi, others);
  });

  const byId = new Map<string, number>();
  const append: NumberEntry[] = [];
  req.groups.forEach((g, gi) => {
    const n = numbers[gi] as number;
    for (const id of g.ids) {
      byId.set(id, n);
      const had = fromList?.byId.get(id);
      if (!had || had.n !== n) append.push({ id, n, scan: req.scan, rule: g.rule });
    }
  });

  const shownInCarried = new Map<number, number>();
  let note: NumberNote | null = null;
  if (fromList && req.carried) {
    let count = 0;
    req.groups.forEach((g, gi) => {
      const was = g.ids.map((id) => req.carried?.numbers.get(id)).find((x) => x !== undefined);
      if (was !== undefined && was !== numbers[gi]) {
        count += 1;
        shownInCarried.set(gi, was);
      }
    });
    if (count > 0) note = { kind: "differs", label: req.carried.label, count };
  } else if (!fromList && req.carried && req.carried.numbers.size > 0) note = { kind: "taken", label: req.carried.label };
  else if (!fromList && startAt > 1 && numbers.length > 0) note = { kind: "start", from: Math.min(...numbers) };
  return { numbers, append, note, alsoShownAs, shownInCarried, byId };
}

/** The list's lines for `entries`, each ending with a line feed. */
export const numberLines = (entries: readonly NumberEntry[]): string =>
  entries.map((e) => `${JSON.stringify({ id: e.id, n: e.n, scan: e.scan, rule: e.rule })}\n`).join("");

/**
 * The numbers an evidence log recorded (its `finding_numbers`), or an empty map where it recorded none or they do not
 * read: a log is a file in the project, so nothing in it is trusted beyond being a number for an id.
 */
export function numbersOfLog(log: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const rows = (log as { finding_numbers?: unknown } | null)?.finding_numbers;
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    const o = r as { finding_id?: unknown; number?: unknown } | null;
    if (o && typeof o.finding_id === "string" && ID.test(o.finding_id) && Number.isInteger(o.number) && (o.number as number) >= 1) out.set(o.finding_id, o.number as number);
  }
  return out;
}

/**
 * (the "Missing" case) The highest F-number recorded by any evidence log in
 * `evidenceDir` whose sha256 matches the digest this computer recorded for its name (`log-digest.ts`; `digestOf` is
 * `readLogDigests(...).byName`), or 0. It is `assignNumbers`' `recordedMax`: where this computer has no number list for
 * the folder, a new finding takes a number above it, so a number shown in an earlier report here never goes to a
 * second finding, and a log nobody on this computer wrote (no matching digest) cannot raise the numbers.
 */
export function recordedMaxOf(evidenceDir: string, digestOf: ReadonlyMap<string, string>): number {
  let names: string[];
  try {
    names = readdirSync(evidenceDir).filter((n) => n.endsWith(".json") && digestOf.has(n));
  } catch {
    return 0;
  }
  let max = 0;
  for (const name of names) {
    try {
      const full = join(evidenceDir, name);
      if (!lstatSync(full).isFile()) continue;
      const bytes = readRegularFile(full);
      if (createHash("sha256").update(bytes).digest("hex") !== digestOf.get(name)) continue;
      for (const n of numbersOfLog(JSON.parse(bytes.toString("utf8"))).values()) max = Math.max(max, n);
    } catch {
      // A log that does not read gives no number.
    }
  }
  return max;
}

/** "F12" etc.: an F-number's handle. */
export const fNumber = (n: number): string => `F${n}`;

/**
 * Look a handle up: an F-number of this folder's list ("F3", "f3") or a short-id prefix of at least 6 hex characters.
 * Returns every finding id it names among `ids` (several where a prefix is shared: the caller lists them and acts on
 * none), or an empty list. B2's commands take their handles through this.
 */
export function idsOfHandle(handle: string, ids: Iterable<string>, numberOf: ReadonlyMap<string, number>): string[] {
  const h = handle.trim().toLowerCase();
  const f = /^f(\d{1,9})$/.exec(h);
  const all = [...ids];
  if (f) {
    const n = Number(f[1]);
    return all.filter((id) => numberOf.get(id) === n);
  }
  const hex = h.replace(/^fp_/, "");
  if (!/^[0-9a-f]{6,64}$/.test(hex)) return [];
  return all.filter((id) => id.replace(/^fp_/, "").startsWith(hex));
}
