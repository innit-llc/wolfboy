/**
 * REPORTS CLAUDE CODE HELD BACK.
 *
 * A seat's report reaches whoever launched it (the relay, or the main session) only when Claude Code delivers it, and
 * Claude Code's auto mode reviews a sub-agent's report on the way: in the run of 2026-10-12 it blocked 4 seat reports to
 * the relay, putting a security warning in their place (it read the program's next-launch instruction inside them as an
 * attempt to get round auto mode). The relay did not act on them; the program had already taken each seat's answer at its
 * hand-back, so no answer was lost, but the launches those receipts named were made late, by the program's other paths,
 * and nothing on the person's screen said so. This module finds, once the run is over, the two cases the person is told
 * of in one plain line at the end (assemble-report's `FOR THE PERSON` line):
 *
 * - `blocked`: a seat whose report Claude Code replaced with its auto-mode block notice, read from the transcripts that
 *   received seat reports - the main session's and each relay's of the run - where the host's notice names the seat's
 *   agent id. The notice's words are Claude Code's own (`HOST_BLOCKED_REPORT`, as Claude Code 2.1.296 wrote them); if
 *   the host changes them this finds none, a stated limit, and the second case below still holds.
 * - `undelivered`: a seat whose answer the hook ledger records as taken at its hand-back (`accepted`) and that has no
 *   SubagentStop - the event that comes with the report's delivery - in the ledger: its report never reached its
 *   launcher (the process ended, or the host never delivered it).
 *
 * In both cases the seat's answer is in the run's record, so its entry is checked: nothing here is listed as not
 * checked (the report's one list, assemble-report.ts `uncheckedKinds`, is unchanged by this). A seat whose report never
 * arrived and whose answer was never taken has no record; the entry is then launched again by the relaunch rule while the
 * run can launch, or reported by the assembly as an entry with no answer (`entry-unanswered`), listed as not
 * checked).
 */

import { existsSync } from "node:fs";
import type { HookLedgerLine } from "./hook-capture.js";
import { agentTranscriptOf } from "./seat-opened.js";
import { readRegularFile } from "./project-read.js";

/** Claude Code's notice where auto mode blocked a sub-agent's report (as 2.1.296 wrote it, in the receiving transcript). */
export const HOST_BLOCKED_REPORT = /auto mode blocked this subagent'?s report/i;
/** The sending agent's id in the delivered report's wrapper. */
const REPORT_FROM = /agent-message from="(a[0-9a-f]{16})"/;

export interface HeldReports {
  /** Seats whose report auto mode blocked on its way to their launcher, by agent id, sorted. */
  blocked: string[];
  /** Seats whose answer was taken at their hand-back and whose report was never delivered (no SubagentStop), by agent id, sorted. */
  undelivered: string[];
}

/** The text of one transcript line's message, whatever its shape (a string, or content blocks of text or tool results). */
function textOf(v: unknown, depth = 0): string {
  if (depth > 4 || v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((x) => textOf(x, depth + 1)).join(" ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return [o.text, o.content, o.message].map((x) => textOf(x, depth + 1)).join(" ");
  }
  return "";
}

/** The agent ids whose report a transcript at `path` received as an auto-mode block notice. */
export function blockedReportsIn(path: string): string[] {
  if (!existsSync(path)) return [];
  let text: string;
  try {
    text = readRegularFile(path, "utf8");
  } catch {
    return [];
  }
  const out = new Set<string>();
  for (const raw of text.split("\n")) {
    if (!HOST_BLOCKED_REPORT.test(raw)) continue;
    let t = raw;
    try {
      t = textOf((JSON.parse(raw) as { message?: unknown }).message);
    } catch {
      // A line that is not JSON is read as it is.
    }
    if (!HOST_BLOCKED_REPORT.test(t)) continue;
    const from = REPORT_FROM.exec(t) ?? REPORT_FROM.exec(t.replace(/\\"/g, '"'));
    if (from?.[1]) out.add(from[1]);
  }
  return [...out];
}

/**
 * The run's held reports, from its hook ledger lines (`lines`), the agent ids of its relays (`relayAgents`) and the seats
 * it launched (`seats`, agent ids): only a seat of the run is named.
 */
export function heldReports(lines: readonly HookLedgerLine[], relayAgents: readonly string[], seats: ReadonlySet<string>): HeldReports {
  const accepted = new Set<string>();
  const stopped = new Set<string>();
  const sessions = new Map<string, number>();
  for (const l of lines) {
    const agent = typeof l.agent_id === "string" ? l.agent_id : "";
    if (agent === "") continue;
    if (l.event === "SubagentStop" || String(l.outcome) === "stopped") stopped.add(agent);
    else if (String(l.outcome) === "accepted") accepted.add(agent);
    if (typeof l.transcript_path === "string" && l.transcript_path !== "") sessions.set(l.transcript_path, (sessions.get(l.transcript_path) ?? 0) + 1);
  }
  const undelivered = [...accepted].filter((a) => !stopped.has(a) && seats.has(a)).sort();
  const blocked = new Set<string>();
  for (const session of sessions.keys()) {
    for (const path of [session, ...relayAgents.map((a) => agentTranscriptOf(session, a))]) {
      for (const a of blockedReportsIn(path)) if (seats.has(a)) blocked.add(a);
    }
  }
  return { blocked: [...blocked].sort(), undelivered };
}

/** The one plain line for the person at the end, or null where no report was held back. */
export function heldReportsSentence(h: HeldReports | undefined): string | null {
  if (!h) return null;
  const b = h.blocked.length;
  const u = h.undelivered.filter((a) => !h.blocked.includes(a)).length;
  if (b + u === 0) return null;
  const parts: string[] = [];
  /* The review's parts are "parts of the review";
   * "checks" is the rules' word on the same screen. */
  if (b > 0) parts.push(`Claude Code's auto mode held back ${b} of the review's progress reports on their way to the part of the scan that starts the next parts of the review`);
  if (u > 0) parts.push(`${u} of the review's progress reports never reached it`);
  return `${parts.join(", and ")}. The answers of those parts of the review had already been recorded, so none was lost; the parts those reports would have started were started from the scan's own list instead, some of them later than planned.`;
}
