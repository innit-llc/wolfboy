/**
 * BUILD UNIT F5, M3 (full-read design section 4): THE LAUNCH READS ONLY THE PLACES TO READ.
 *
 * The partition (carry-forward.ts `placeOutcomes`) says, for every place of a place-plan candidate whose verdict is not
 * carried whole, whether the place is carried (every premise of its earlier row reproduced) or read again. This module
 * turns that into what the run launches and what its record holds:
 *
 * - **A reader seat whose places are all carried is not launched.** Its rows enter the run as carried rows: the earlier
 *   run's row, re-based to where the place's window stands now, labelled `carried_from` (the scan and the finding it
 *   came from) and carrying its premises, so a later run can compare it again. Never "re-verified".
 * - **A seat that holds any place to read is launched whole**, and the carried places in it are read again
 *   (`seat-launched`). The safe direction: a seat's windows depend on the places it holds (review R21), so a seat cut
 *   down to its places to read would hand every one of them a different text, and the payloads are the scan's.
 *   A candidate read by one seat (no reader slices) is that case: its one seat reads and answers.
 * - **The answer seat runs over carried and new rows**: the verdict seat after readers is launched whenever its
 *   candidate's verdict is not carried whole, even when none of its readers is (then it waits for none), and the fold
 *   and the assembly read the carried rows beside the readers' replies (`carriedReaderReplies`).
 *
 * The carried rows are written in the pre-launch plan (`carried_places`), which `assemble-report` makes again with the
 * same function and refuses where it differs; the launch list names the plan by path and digest (`plan`), which is how
 * the fold command and the capture find them (`carriedRepliesOfLaunchDir`). A plan that cannot be read, or whose digest
 * is not the one the list recorded, gives no carried row: its places are then not answered, never clean.
 */
import { createHash } from "node:crypto";

import { join } from "node:path";
import type { PartitionRow, PlaceOutcome } from "./carry-forward.js";
import { placeAt } from "./place-premises.js";
import { programFileBytes } from "./program-file.js";
import type { ReaderReply, ReadingDisposition, ReadingReadRow } from "./reading.js";
import { readRegularFile } from "./project-read.js";
import { isPlaceId, placeIndexOf, unitOfPlace } from "./ref-ids.js";

const sha256Hex = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const READER_KEY = /#reader-([0-9]+)$/;

/** One place a payload holds: the candidate it belongs to, its location and this run's place id (`P<n>`). */
export interface SeatPlace {
  finding_id: string;
  file: string;
  line: number;
  place: string;
}

/**
 * The places each payload holds, by payload key: every location of a candidate row that carries a place id. A payload
 * is read back only while it has the digest the scan recorded; one that cannot be read has no entry, and its seat is
 * then launched (nothing is known to be carried in it).
 */
export function seatPlacesOfPayloads(findingsDir: string, rows: readonly { key?: unknown; path?: unknown; sha256?: unknown }[]): Map<string, SeatPlace[]> {
  const out = new Map<string, SeatPlace[]>();
  for (const row of rows) {
    if (typeof row.key !== "string" || typeof row.path !== "string") continue;
    let parsed: unknown;
    try {
      const bytes = readRegularFile(join(findingsDir, row.path));
      if (typeof row.sha256 === "string" && sha256Hex(bytes) !== row.sha256) continue;
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      continue;
    }
    const places: SeatPlace[] = [];
    for (const c of isObj(parsed) && Array.isArray(parsed.candidates) ? parsed.candidates : []) {
      if (!isObj(c) || typeof c.finding_id !== "string" || !Array.isArray(c.locations)) continue;
      for (const l of c.locations) {
        if (!isObj(l) || typeof l.place !== "string" || !isPlaceId(l.place) || typeof l.file !== "string") continue;
        const line = Number(l.start_line);
        if (Number.isInteger(line)) places.push({ finding_id: c.finding_id, file: l.file, line, place: l.place });
      }
    }
    out.set(row.key, places);
  }
  return out;
}

/** A reader seat that is not launched: every place it holds is carried. */
export interface CarriedSeat {
  key: string;
  finding_id: string;
  reader: number;
  places: number;
}

/** What the plan writes for a seat that is not launched: its carried rows, in place order. */
export interface CarriedPlacesEntry extends CarriedSeat {
  /** The earlier runs its rows came from (one, unless the earlier rows were in several runs' records). */
  from_scan: string[];
  rows: ReadingReadRow[];
}

/** A carried place's row as this run's record holds it: the earlier row, re-based, labelled, with its premises. */
export function carriedRow(o: PlaceOutcome, place: string): ReadingReadRow | null {
  const r = o.row;
  if (!r || !o.premises || !o.from_scan || !o.from_finding_id) return null;
  return {
    kind: unitOfPlace(place) ?? place,
    file: o.file,
    lines: String(r.line),
    quote: r.quote,
    disposition: r.decision as ReadingDisposition,
    ground: r.why,
    place,
    data: [...r.data],
    read_basis: r.read_basis,
    ...(r.item !== undefined ? { item: r.item } : {}),
    ...(r.beyond !== undefined ? { beyond: r.beyond } : {}),
    ...(r.line_declared !== undefined ? { line_declared: r.line_declared } : {}),
    ...(r.gate !== undefined ? { gate: r.gate } : {}),
    ...(r.gate_words !== undefined ? { gate_words: r.gate_words } : {}),
    premises: o.premises,
    carried_from: { scan_id: o.from_scan, finding_id: o.from_finding_id },
  };
}

const placeOrder = (p: string): number => placeIndexOf(p) ?? -1;

/**
 * WHICH SEATS ARE LAUNCHED. `rows` are the partition's; `seats` the places each payload holds. Returns the rows as the
 * plan records them (a carried place in a launched seat relabelled `seat-launched`, read again; no outcome keeps its
 * premises, which only a carried row carries) and every reader seat that is not launched, with its carried rows.
 */
export function placesToRead(args: { rows: readonly PartitionRow[]; seats: ReadonlyMap<string, SeatPlace[]> }): { rows: PartitionRow[]; seats: CarriedPlacesEntry[] } {
  const outcomesOf = new Map<string, Map<string, PlaceOutcome>>();
  for (const row of args.rows) {
    if (row.outcome !== "adjudicate" || !row.places) continue;
    outcomesOf.set(row.finding_id, new Map(row.places.outcomes.map((o) => [placeAt(o.file, o.line), o])));
  }
  const seats: CarriedPlacesEntry[] = [];
  const carriedAt = new Set<string>();
  for (const [key, held] of [...args.seats].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const m = READER_KEY.exec(key);
    if (!m || held.length === 0) continue;
    const ids = new Set(held.map((p) => p.finding_id));
    if (ids.size !== 1) continue;
    const findingId = held[0]!.finding_id;
    const outcomes = outcomesOf.get(findingId);
    if (!outcomes) continue;
    const rows: ReadingReadRow[] = [];
    for (const p of [...held].sort((a, b) => placeOrder(a.place) - placeOrder(b.place))) {
      const o = outcomes.get(placeAt(p.file, p.line));
      const row = o && o.outcome === "carried" ? carriedRow(o, p.place) : null;
      if (!row) break;
      rows.push(row);
    }
    if (rows.length !== held.length) continue;
    for (const p of held) carriedAt.add(`${findingId}\u0000${placeAt(p.file, p.line)}`);
    const fromScan = [...new Set(rows.map((r) => r.carried_from!.scan_id))].sort();
    seats.push({ key, finding_id: findingId, reader: Number(m[1]), places: held.length, from_scan: fromScan, rows });
  }
  const rows = args.rows.map((row): PartitionRow => {
    if (!row.places) return row;
    const outcomes = row.places.outcomes.map((o): PlaceOutcome => {
      const { premises: _premises, ...kept } = o;
      if (row.outcome !== "adjudicate" || o.outcome !== "carried" || carriedAt.has(`${row.finding_id}\u0000${placeAt(o.file, o.line)}`)) return kept;
      return {
        ...kept,
        outcome: "read",
        reason: "seat-launched",
        because:
          "every premise of the place's earlier row is reproduced, but its seat holds a place to read and is launched whole, so it is read again: a seat's windows depend on the places it holds.",
      };
    });
    const carried = outcomes.filter((o) => o.outcome === "carried").length;
    return { ...row, places: { carried, read: outcomes.length - carried, outcomes } };
  });
  return { rows, seats };
}

/** The carried rows the plan holds, as the readers' replies the fold and the assembly read beside those on disk. */
export function carriedReaderReplies(plan: unknown): ReaderReply[] {
  if (!isObj(plan) || !Array.isArray(plan.carried_places)) return [];
  const out: ReaderReply[] = [];
  for (const e of plan.carried_places) {
    if (!isObj(e) || typeof e.key !== "string" || typeof e.finding_id !== "string" || !Number.isInteger(e.reader) || !Array.isArray(e.rows)) continue;
    out.push({ source: `carried/${e.key}`, finding_id: e.finding_id, reader: e.reader as number, rows: e.rows.filter(isObj) as unknown as ReadingReadRow[] });
  }
  return out;
}

/**
 * The carried rows of the run whose launch directory this is: the plan the launch list names, read only while it has
 * the digest the list recorded. Anything that cannot be read gives none (its places are then not answered).
 */
export function carriedRepliesOfLaunchDir(launchDir: string): ReaderReply[] {
  try {
    const list = JSON.parse(programFileBytes("the launch list", join(launchDir, "launch-list.json")).toString("utf8")) as { plan?: unknown };
    const named = list.plan;
    if (!isObj(named) || typeof named.path !== "string" || typeof named.sha256 !== "string") return [];
    const bytes = programFileBytes("the pre-launch plan", named.path);
    if (sha256Hex(bytes) !== named.sha256) return [];
    return carriedReaderReplies(JSON.parse(bytes.toString("utf8")));
  } catch {
    return [];
  }
}
