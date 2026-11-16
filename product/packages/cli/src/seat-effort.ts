import { closeSync, lstatSync, readFileSync, readSync } from "node:fs";
import { openRegular } from "./project-read.js";
import { join } from "node:path";
import { ownPackage, ownPlugin } from "./scanner-command.js";

/**
 * EACH SEAT'S OWN EFFORT LEVEL.
 *
 * The three judging seats are pinned at `effort: high` in their agent files.
 * Only `CLAUDE_CODE_EFFORT_LEVEL` outranks that pin, and `legal-scan session` removes it; a session started otherwise
 * with the variable set runs every seat at the variable's level. So the level a seat ran at is not the session's, and
 * a launch cannot name one: the one place it shows is the seat's own transcript, where the host writes `effort` on
 * every assistant line.
 *
 * The capture hook reads it at SubagentStop, the event that names the seat's transcript (`agent_transcript_path`),
 * onto the hook-ledger line (`agent_effort`); the assembly names it on the evidence log (`agent_effort`), and the run's
 * status compares each seat with its agent file's pin (hook-launch.ts `effortChanges`).
 */

/**
 * The agent files whose `effort` the seats are compared with: the three judging seats. The relay pins its own `low`
 * (legal-relay.md) and is not compared: it launches and judges nothing.
 */
export const PINNED_SEAT_AGENTS: readonly string[] = ["legal-adjudicator", "legal-refuter", "legal-silence-investigator"];

/** Bytes read at a time from a seat's transcript: it is read line by line, never loaded whole. */
const CHUNK_BYTES = 1 << 20;

const levelOf = (e: unknown): string | null => {
  if (typeof e === "string") return e === "" ? null : e;
  const level = e !== null && typeof e === "object" ? (e as { level?: unknown }).level : undefined;
  return typeof level === "string" && level !== "" ? level : null;
};

/**
 * The effort levels a seat's own transcript records on its assistant lines, distinct, in the order they first appear;
 * `[]` where no assistant line carries one; null where there is no transcript to read (no path, not a regular file,
 * unreadable). Read in chunks of `CHUNK_BYTES`: only a line that holds both `"effort"` and `"assistant"` is parsed,
 * and only its top-level `effort` counts (a quotation inside a message cannot name a level). With `stamp` (a transcript
 * found by its place, seat-opened.ts `seatTranscriptOf`), only a line stamped with the seat's agent id and
 * session counts, as the assembly's transcript check counts the hand-back there. On the
 * route where an event named the transcript, the capture passes the seat's agent id alone, and only that agent's lines
 * count, as the sight (seat-opened.ts) counts its Reads on both routes - so a premise is never taken from another
 * agent's lines. Without `stamp` (the hook ledger's `agent_effort`, the run status's check, not a premise) every
 * assistant line counts, as before.
 */
export function transcriptEffort(path: string | null | undefined, stamp?: { agentId: string; sessionId?: string }): string[] | null {
  if (typeof path !== "string" || path === "") return null;
  let fd: number;
  try {
    if (!lstatSync(path).isFile()) return null;
    // Without blocking, and only a regular file: project-read.ts.
    const o = openRegular(path);
    if (!o.regular) return null;
    fd = o.fd;
  } catch {
    return null;
  }
  const levels: string[] = [];
  const take = (line: Buffer): void => {
    if (line.indexOf('"effort"') === -1 || line.indexOf('"assistant"') === -1) return;
    try {
      const o: unknown = JSON.parse(line.toString("utf8"));
      if (typeof o !== "object" || o === null || (o as { type?: unknown }).type !== "assistant") return;
      if (stamp && ((o as { agentId?: unknown }).agentId !== stamp.agentId || (stamp.sessionId !== undefined && (o as { sessionId?: unknown }).sessionId !== stamp.sessionId))) return;
      const level = levelOf((o as { effort?: unknown }).effort);
      if (level !== null && !levels.includes(level)) levels.push(level);
    } catch {
      // A line that does not parse (one being written as the seat stops) names no level.
    }
  };
  try {
    const buf = Buffer.alloc(CHUNK_BYTES);
    let partial: Buffer[] = [];
    for (;;) {
      const n = readSync(fd, buf, 0, CHUNK_BYTES, null);
      if (n <= 0) break;
      let start = 0;
      for (let nl = buf.indexOf(10, start); nl !== -1 && nl < n; nl = buf.indexOf(10, start)) {
        const piece = buf.subarray(start, nl);
        take(partial.length > 0 ? Buffer.concat([...partial, piece]) : piece);
        partial = [];
        start = nl + 1;
      }
      if (start < n) partial.push(Buffer.from(buf.subarray(start, n)));
    }
    if (partial.length > 0) take(Buffer.concat(partial));
  } catch {
    return levels.length > 0 ? levels : null;
  } finally {
    closeSync(fd);
  }
  return levels;
}

/**
 * The plugin's folder, from this program's own place and never from a variable:
 * scanner-command.ts `ownPlugin` - this CLI's own package where it carries the plugin (an installed plugin: the npm
 * package holds the plugin's files at its root, `.claude-plugin/` beside `dist/`), else the plugin beside this CLI's
 * package in the source checkout (`product/plugin`, as `bin/node-choice.bash` places the two).
 * Where neither is found (a copy of `dist/` alone), the checkout's place, whose files are then missing and read as such.
 * Until that change `CLAUDE_PLUGIN_ROOT` came first; a project's settings can set it, and the plugin whose agent text and
 * skill a verdict is judged by is the one this program belongs to.
 */
export function pluginRoot(): string {
  return ownPlugin() ?? join(ownPackage(), "..", "..", "plugin");
}

/** The `effort` an agent file's front matter pins, or null where it names none or the file cannot be read. */
export function agentFileEffort(name: string, root: string = pluginRoot()): string | null {
  let text: string;
  try {
    text = readFileSync(join(root, "agents", `${name}.md`), "utf8");
  } catch {
    return null;
  }
  const front = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)?.[1];
  const m = front === undefined ? null : /^effort:[ \t]*["']?([A-Za-z]+)["']?[ \t]*$/m.exec(front);
  return m?.[1] ?? null;
}

/** The pin of each plugin seat type, keyed by the full agent type the host names (`wolfboy:<name>`). */
export function seatPins(pluginName: string, root: string = pluginRoot()): Map<string, string | null> {
  return new Map(PINNED_SEAT_AGENTS.map((n): [string, string | null] => [`${pluginName}:${n}`, agentFileEffort(n, root)]));
}

/** One seat's recorded level: the last hook-ledger line of that agent id that read its transcript. */
export interface SeatEffort {
  agent_id: string;
  agent_type: string;
  entry: string | null;
  levels: string[];
}

/** Ledger lines as the capture writes them: only the fields read here. */
export interface EffortLedgerLine {
  agent_id?: unknown;
  agent_type?: unknown;
  entry?: unknown;
  agent_effort?: unknown;
}

/**
 * Each seat's levels from the hook ledger: per agent id, the last line carrying `agent_effort` (a later SubagentStop
 * re-reads the whole transcript, so the last read covers every earlier one). `entries`, where given, keeps only the
 * seats bound to those launch-list entries (one run's).
 */
export function seatEfforts(lines: readonly EffortLedgerLine[], entries?: ReadonlySet<string>): SeatEffort[] {
  const byAgent = new Map<string, SeatEffort>();
  for (const l of lines) {
    if (typeof l.agent_id !== "string" || !Array.isArray(l.agent_effort)) continue;
    const entry = typeof l.entry === "string" ? l.entry : null;
    if (entries && (entry === null || !entries.has(entry))) continue;
    byAgent.set(l.agent_id, {
      agent_id: l.agent_id,
      agent_type: typeof l.agent_type === "string" ? l.agent_type : "",
      entry,
      levels: l.agent_effort.filter((x): x is string => typeof x === "string"),
    });
  }
  return [...byAgent.values()];
}

/**
 * The evidence log's `agent_effort` from the seats' own levels: the one level where every seat recorded exactly that
 * one; otherwise each level with its seat count (`high (29 seats), max (2 seats), not recorded (1 seat)`). Null where
 * no seat recorded a level (a run captured before the field, or with no transcript read).
 */
export function runAgentEffort(seats: readonly SeatEffort[]): string | null {
  if (!seats.some((s) => s.levels.length > 0)) return null;
  const counts = new Map<string, number>();
  for (const s of seats) {
    const k = s.levels.length === 0 ? "not recorded" : s.levels.join("+");
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const only = [...counts.keys()];
  if (only.length === 1 && only[0] !== "not recorded" && !only[0]!.includes("+")) return only[0]!;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([k, n]) => `${k} (${n} seat${n === 1 ? "" : "s"})`)
    .join(", ");
}
