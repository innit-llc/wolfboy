/**
 * WHAT A SEAT OPENED, AS ITS OWN TRANSCRIPT SHOWS IT (a place counts as
 * read only where the seat actually opened the code around it, and a place seen only as one line in a search result
 * is not read and is shown to the person as not checked).
 *
 * Before this, a location counted as opened on the strength of a quote of its matched line, and a search result
 * supplies that quote: in a non-author verification
 * a seat recorded 80 places as opened while it had Read no file that held them, and the later run told the person
 * "56 of the 56 places ... were checked". So the capture no longer takes the seat's word for it. A location counts as
 * opened only where one of two things shows that the seat saw the code around the line:
 *
 * - a Read in the seat's own transcript whose returned range covers every line the row names (the host writes the
 *   range it returned on the result line: `toolUseResult.file` `startLine` and `numLines`); or
 * - the payload's own excerpt of that location (the program's context window), where the transcript shows the seat
 *   Read the payload whole: every line of the file its brief names for it (`reads[]` role `payload`, the reading copy
 *   where one was written). A payload read in part shows no excerpt.
 *
 * A search shows nothing here, with or without context lines. A Grep returns what matched the seat's pattern, sized by
 * the seat's output mode, `-C` and `head_limit` (one returned the matched line 112 and never line 104 that decided the
 * finding, verification H1); its lines are not the seat's choice of what to read around a place, and nothing in the
 * transcript says which lines of a file it showed as anything but text to be parsed back. A Read is the one tool whose
 * returned range the transcript states exactly, and a seat that wants a place counted as read reads it. Glob shows
 * no line at all.
 *
 * Where the transcript cannot be read, nothing is shown as opened: the capture fails closed, toward "not checked".
 */
import { realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { readRegularFile } from "./project-read.js";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Where Claude Code keeps an agent's own transcript, beside the session's: `<session transcript without .jsonl>/
 * subagents/agent-<agent id>.jsonl` (the path a SubagentStop event gives a seat; PreToolUse:SubagentHandback gives
 * only the session's). Where the file is is only where to look: a line counts only when stamped with the agent's id.
 */
export const agentTranscriptOf = (sessionTranscript: string, agent: string): string =>
  join(sessionTranscript.replace(/\.jsonl$/, ""), "subagents", `agent-${agent}.jsonl`);

/** Which lines of a seat's transcript count as its own where the file was found by its place: those stamped with both. */
export type SeatStamp = { agentId: string; sessionId: string };

/**
 * THE SEAT'S OWN TRANSCRIPT: the one lookup every reader of it uses (the assembly's transcript check;
 * the capture's premises, which took a second copy of it inline). Where an event named it - the
 * record's `via.agent_transcript_path`, the hook ledger's `stopped` line written at the seat's SubagentStop, or the
 * SubagentStop event itself - that path, as named. Otherwise where Claude Code keeps an agent's transcript, beside the
 * session's (`agentTranscriptOf`): PreToolUse:SubagentHandback names only the session's transcript, and a seat whose
 * Claude Code process ended after its hand-back and before its SubagentStop has no `stopped` line. On that second route
 * the place is only where to look: a line counts only when stamped with the seat's agent id and session (`stamp`) -
 * for the assembly the hand-back, for the capture the Reads, searches and effort its premises are taken from, so a
 * premise is never taken from a line the transcript check would not accept as the seat's. `own` is null only where
 * no event named it and there is no session transcript to find it beside.
 */
export function seatTranscriptOf(a: { named: string | null | undefined; session: string | null | undefined; agentId: string; sessionId: string | null | undefined }): { own: string | null; stamp?: SeatStamp } {
  if (a.named) return { own: a.named };
  if (!a.session) return { own: null };
  return { own: agentTranscriptOf(a.session, a.agentId), stamp: { agentId: a.agentId, sessionId: a.sessionId ?? "" } };
}

const realOf = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

/** The payload a seat was handed: the file its brief names (and how many lines it has), and the scanner's file. */
export interface SeatPayload {
  /** The path the brief names for the payload (`reads[]` role `payload`): the reading copy where one was written. */
  readPath: string;
  /** Its length in lines as the pre-launch step counted it, where it did. */
  lines?: number;
  /** The scanner's payload file (`payload_path`), whose `excerpts` are the context windows. */
  payloadPath: string;
  /** Build unit F5: the model the launch entry named for the seat (premise 4 of every place it reads). */
  model?: string;
}

/** What the seat saw: sorted, merged line ranges, by real absolute path (its Reads) and by the scan's own relative path
 * (the payload's excerpts, which name a file exactly as the candidate's locations do). */
/** One search a seat ran (build unit F5): the host tool, its pattern, its path and whether it ignored case. */
export interface SeatSearch {
  tool: "grep" | "glob";
  pattern: string;
  path?: string;
  case_insensitive?: boolean;
  /** Verification A, VA-7: the host's Grep ran with `multiline: true` (a match may span lines), and is replayed so. */
  multiline?: boolean;
  /**
   * The host call's whole input, every key the seat passed, as its transcript holds it (before the
   * plugin's guard, which appends its `.legal` piece to a Grep's `glob`). The replay reads `glob` and `type` from it,
   * and refuses any key or value it does not understand (host-search.ts `searchInputProblem`); before, only the four
   * fields above were kept, and a Grep narrowed by `glob` was replayed over every file in scope.
   */
  input?: Record<string, unknown>;
  /**
   * What the host returned for this search, from the seat's own transcript, so that the
   * capture can compare the replay with it (place-premises.ts `searchPremiseOf`). Absent where the transcript holds no
   * result for the call.
   */
  host?: SeatSearchHost;
}

/** What the host returned for one Grep or Glob, as the transcript's result line states it. */
export interface SeatSearchHost {
  /** The host returned an error (a refusal included), not a result. */
  error?: string;
  /** Grep `content` mode: the text it printed (`path:line:text` per matched line, or `line:text` for one file). */
  content?: string;
  /** Whether `content` carries line numbers (the Grep's `-n`, on unless the seat turned it off). */
  numbered?: boolean;
  /** Grep `count` mode: the text it printed (`path:count` per file, or `count` for one file). */
  counts?: string;
  /** Glob, and Grep `files_with_matches`: the files it named. */
  files?: string[];
  /** Only part of the result was returned (a `head_limit` or `offset`, or the host's own limit or truncation). */
  partial?: boolean;
}

/** A search call's result line read as `SeatSearchHost`. */
function hostResultOf(tool: "grep" | "glob", input: Obj, d: Obj, result: Obj): SeatSearchHost {
  const r = d.toolUseResult;
  if (result.is_error === true || !isObj(r)) {
    const said = typeof r === "string" ? r : typeof result.content === "string" ? result.content : JSON.stringify(result.content ?? "");
    return { error: said.slice(0, 200) };
  }
  const partial =
    input.head_limit !== undefined || input.offset !== undefined || r.appliedLimit !== undefined || r.appliedOffset !== undefined || r.truncated === true;
  const files = Array.isArray(r.filenames) ? r.filenames.filter((f): f is string => typeof f === "string") : [];
  if (tool === "glob") return { files, ...(partial ? { partial: true } : {}) };
  const mode = typeof r.mode === "string" ? r.mode : typeof input.output_mode === "string" ? input.output_mode : "files_with_matches";
  const text = typeof r.content === "string" ? r.content : "";
  if (mode === "content") return { content: text, numbered: input["-n"] !== false, ...(partial ? { partial: true } : {}) };
  if (mode === "count") return { counts: text, ...(partial ? { partial: true } : {}) };
  return { files, ...(partial ? { partial: true } : {}) };
}

export interface SeatSight {
  ranges: Map<string, [number, number][]>;
  excerpts: Map<string, [number, number][]>;
  /**
   * Build unit F5 (full-read design section 4, premise 8): every Grep and Glob the seat's own transcript shows it ran, as
   * it ran them (a search never counts as a Read; it is a premise of every place of the seat, replayed by a later run).
   */
  searches?: SeatSearch[];
  /** For the record: the transcript read, how many Reads it showed, whether the payload was read whole. */
  basis: { transcript: string | null; reads: number; payload_whole: boolean | null; problem?: string };
}

function addRange(ranges: Map<string, [number, number][]>, file: string, first: number, last: number): void {
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first) return;
  const list = ranges.get(file) ?? [];
  list.push([first, last]);
  list.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const r of list) {
    const top = merged.at(-1);
    if (top && r[0] <= top[1] + 1) top[1] = Math.max(top[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  ranges.set(file, merged);
}

const covers = (list: [number, number][] | undefined, first: number, last: number): boolean =>
  (list ?? []).some(([a, b]) => a <= first && last <= b);

/**
 * The seat's Reads, from its own transcript: each Read call's result line, stamped with the agent's id, not an error,
 * carrying the range the host returned. Returns the ranges by real path and, per path, the file's total lines as the
 * host reported them; or why the transcript could not be read.
 */
function transcriptReads(path: string, agentId: string, sessionId?: string): { ranges: Map<string, [number, number][]>; totals: Map<string, number>; reads: number; searches: SeatSearch[] } | { problem: string } {
  let text: string;
  try {
    text = readRegularFile(path, "utf8");
  } catch (e) {
    return { problem: `the seat's own transcript ${path} cannot be read (${(e as Error).message})` };
  }
  const readCalls = new Set<string>();
  const results: Obj[] = [];
  const searches: SeatSearch[] = [];
  /* Each search's call id, so that its result line can be laid beside it. */
  const searchCalls = new Map<string, { search: SeatSearch; input: Obj }>();
  /* How many lines of the transcript are the seat's own. A transcript that reads but
   * holds none (every line another agent's, another session's at the place, or unstamped) shows nothing of this seat:
   * that is "cannot be taken", by a reason below, never "the seat opened nothing". */
  let own = 0;
  for (const line of text.split("\n")) {
    // A line of the seat's names its agent id; any other line is skipped unparsed, as before.
    if (!line.includes(agentId)) continue;
    const tool = line.includes('"Read"') || line.includes("toolUseResult") || line.includes('"Grep"') || line.includes('"Glob"');
    if (!tool && own > 0) continue;
    let d: unknown;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObj(d) || d.agentId !== agentId) continue;
    // A transcript found by its place (`seatTranscriptOf`'s stamp): the line must name the seat's session as well.
    if (sessionId !== undefined && d.sessionId !== sessionId) continue;
    own += 1;
    if (!tool) continue;
    const content = isObj(d.message) && Array.isArray(d.message.content) ? d.message.content.filter(isObj) : [];
    if (d.type === "assistant") {
      for (const b of content) if (b.type === "tool_use" && b.name === "Read" && typeof b.id === "string") readCalls.add(b.id);
      // Build unit F5: every search the seat ran, as it ran it (premise 8), whatever it returned.
      for (const b of content) {
        if (b.type !== "tool_use" || (b.name !== "Grep" && b.name !== "Glob") || !isObj(b.input)) continue;
        const input = b.input;
        const search: SeatSearch = {
          tool: b.name === "Grep" ? "grep" : "glob",
          pattern: typeof input.pattern === "string" ? input.pattern : "",
          ...(typeof input.path === "string" && input.path !== "" ? { path: input.path } : {}),
          ...(input["-i"] === true ? { case_insensitive: true } : {}),
          ...(b.name === "Grep" && input.multiline === true ? { multiline: true } : {}),
          input: { ...input },
        };
        searches.push(search);
        if (typeof b.id === "string") searchCalls.set(b.id, { search, input });
      }
    } else if (d.type === "user" && (isObj(d.toolUseResult) || typeof d.toolUseResult === "string")) {
      // A string result is the host's error text (a refused search among them): kept for RK-2, never a Read's range.
      results.push(d);
    }
  }
  if (own === 0) {
    return { problem: `the seat's own transcript ${path} holds no line stamped as this seat's (agent ${agentId}${sessionId !== undefined ? `, session ${sessionId}` : ""}), so nothing in it shows what the seat opened` };
  }
  const ranges = new Map<string, [number, number][]>();
  const totals = new Map<string, number>();
  let reads = 0;
  for (const d of results) {
    const content = isObj(d.message) && Array.isArray(d.message.content) ? d.message.content.filter(isObj) : [];
    // A search's result, laid beside the search (the first result line for the call stands).
    for (const b of content) {
      const call = b.type === "tool_result" && typeof b.tool_use_id === "string" ? searchCalls.get(b.tool_use_id) : undefined;
      if (call && !call.search.host) call.search.host = hostResultOf(call.search.tool, call.input, d, b);
    }
    const result = content.find((b) => b.type === "tool_result" && typeof b.tool_use_id === "string" && readCalls.has(b.tool_use_id));
    if (!result || result.is_error === true) continue;
    const r = d.toolUseResult as Obj;
    const f = isObj(r.file) ? r.file : null;
    if (r.type !== "text" || !f || typeof f.filePath !== "string" || !isAbsolute(f.filePath)) continue;
    const start = Number(f.startLine);
    const n = Number(f.numLines);
    if (!Number.isInteger(start) || !Number.isInteger(n) || n < 1) continue;
    const file = realOf(f.filePath);
    addRange(ranges, file, start, start + n - 1);
    if (Number.isInteger(Number(f.totalLines))) totals.set(file, Number(f.totalLines));
    reads += 1;
  }
  return { ranges, totals, reads, searches };
}

/**
 * WHAT THE SEAT SAW: its Reads, and the excerpts of the payload it Read whole. `transcript` null, or a transcript that
 * cannot be read, shows nothing. With `stamp` (a transcript found by its place, `seatTranscriptOf`), only the lines
 * stamped with the seat's agent id and session count.
 */
export function seatSightOf(a: { transcript: string | null; agentId: string | null; payload?: SeatPayload | null; stamp?: SeatStamp }): SeatSight {
  if (!a.transcript) return { ranges: new Map(), excerpts: new Map(), basis: { transcript: null, reads: 0, payload_whole: null, problem: "no transcript of the seat's own was named, so nothing shows what it opened" } };
  // With no agent id no line of a transcript can be shown to be the seat's own, so
  // none is taken (fails closed); before, a null id took every agent's lines.
  if (!a.agentId) return { ranges: new Map(), excerpts: new Map(), basis: { transcript: a.transcript, reads: 0, payload_whole: null, problem: "no agent id was named, so no line of the transcript can be shown to be the seat's own" } };
  // Found by its place: only the lines stamped with the seat's agent id and session (`seatTranscriptOf`).
  if (a.stamp && a.stamp.agentId !== a.agentId) return { ranges: new Map(), excerpts: new Map(), basis: { transcript: a.transcript, reads: 0, payload_whole: null, problem: "the transcript was found for another agent than the seat's, so no line of it can be shown to be the seat's own" } };
  const got = transcriptReads(a.transcript, a.agentId, a.stamp?.sessionId);
  if ("problem" in got) return { ranges: new Map(), excerpts: new Map(), basis: { transcript: a.transcript, reads: 0, payload_whole: null, problem: got.problem } };
  const ranges = got.ranges;
  const excerpts = new Map<string, [number, number][]>();
  let whole: boolean | null = null;
  if (a.payload) {
    const copy = realOf(a.payload.readPath);
    const total = a.payload.lines ?? got.totals.get(copy);
    whole = total !== undefined && total >= 1 && covers(got.ranges.get(copy), 1, total);
    if (whole) {
      try {
        const payload = JSON.parse(readRegularFile(a.payload.payloadPath, "utf8")) as { excerpts?: unknown };
        for (const e of Array.isArray(payload.excerpts) ? payload.excerpts : []) {
          if (!isObj(e) || typeof e.file !== "string") continue;
          addRange(excerpts, e.file, Number(e.start_line), Number(e.end_line));
        }
      } catch {
        // A payload that cannot be read back shows no excerpt: only the seat's own Reads count.
      }
    }
  }
  return { ranges, excerpts, searches: got.searches, basis: { transcript: a.transcript, reads: got.reads, payload_whole: whole } };
}

/** Every line a row's `lines` names ("12", "12-14", "8,10", "L8 to L9"); null where it names none. */
export function linesNamed(lines: string): [number, number][] | null {
  const parts = lines.split(/\s*(?:,|;|&|and)\s*/i).filter((p) => p.trim() !== "");
  const out: [number, number][] = [];
  for (const p of parts) {
    const n = (p.match(/\d+/g) ?? []).map(Number);
    if (n.length === 1) out.push([n[0]!, n[0]!]);
    else if (n.length === 2 && n[0]! <= n[1]!) out.push([n[0]!, n[1]!]);
    else return null;
  }
  return out.length > 0 ? out : null;
}

/**
 * Whether the seat saw every line `lines` names of `file` (the scan's relative path, resolved against `root` for its
 * Reads): each line within one of its Reads of that file, or within the payload's excerpt of it.
 */
export function sawAt(sight: SeatSight, root: string, file: string, lines: string): boolean {
  const named = linesNamed(lines);
  if (!named) return false;
  const read = sight.ranges.get(realOf(isAbsolute(file) ? file : resolve(root, file)));
  const excerpt = sight.excerpts.get(file);
  return named.every(([a, b]) => covers(read, a, b) || covers(excerpt, a, b));
}

/**
 * Whether the seat's own Reads of the file at `path` (absolute; compared by real path) returned every line `first`-`last`
 * (build unit F3: the place form's C7 and C9). Only Reads count here: no excerpt of a payload Read whole, no search.
 */
export function readCovers(sight: SeatSight, path: string, first: number, last: number): boolean {
  return covers(sight.ranges.get(realOf(path)), first, last);
}
