/**
 * THE RELAY ENTRY.
 * `relay-entry` appends to the active run's launch list one relay entry (`LaunchList.relays`): the Agent
 * input that launches the plugin's relay (agents/legal-relay.md), whose only tool is Agent, with the entries to launch
 * now - the launch gate's own computation, as launch-next prints it - in its prompt. The main session launches it and
 * then nothing more: each seat the relay launches reports to the relay, and in auto mode the capture's receipt (M1)
 * names the next launches, each with its exact input, so the main session makes no call while the seats run and is
 * woken by the relay's hand-back, which the plugin refuses while any listed seat is outstanding (hook-launch.ts
 * `relayHandback`). The launch gate checks the relay's launch and every launch the relay makes byte for byte.
 *
 * OFFERED ONLY IN AN INTERACTIVE CLAUDE CODE SESSION (`CLAUDE_CODE_ENTRYPOINT` is `cli`): in a headless run (`claude
 * -p`) the host makes the relay hand back at its first stop and its seats then report to the main session (the trial's
 * run H2), so the program keeps today's path there, and outside Claude Code there is no session to relay in. Also not
 * while a listed seat is already running (its answer would come back to the main session, not to the relay), while
 * another relay of the attempt is live, or when nothing is to launch now. Auto mode, where the receipts exist, is checked
 * by the launch gate, which alone sees the session's permission mode. Where it is not offered it prints NO RELAY and
 * writes nothing, and the main session launches from launch-next as before.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFileAt } from "./project-write.js";
import { dirname, join, resolve } from "node:path";
import type { Command } from "commander";
import { readAnswerLedgers, relaunchable } from "./entry-answer.js";
import { RELAY_AGENT_TYPE } from "./hook.js";
import { CLAUDE_CODE_SESSION_ENV, FOR_THE_PERSON, SESSION_ENV, barFixes, hooksNotRunningRefusal, claudeCodeSigns, launchBars, launchHostOf, launchNowLines, liveRelayOf, otherConversationText, programVersionSentence, readNextLaunches, resumedSentence, type NextLaunches, type NextRead } from "./hook-launch.js";
import { readLaunchList, replaceLaunchList, withListLock } from "./launch-list-file.js";
import { LAUNCH_FORM, type LaunchList, type RelayEntry } from "./launch-plan.js";

/** The variable Claude Code sets in its tools' environment to how the session was started: `cli` for an interactive session. */
export const ENTRYPOINT_ENV = "CLAUDE_CODE_ENTRYPOINT";
export const INTERACTIVE_ENTRYPOINT = "cli";

/**
 * Why this session is not an interactive one, or null where it is (`CLAUDE_CODE_ENTRYPOINT` is `cli`). The one test for
 * both places that admit a relay: `relay-entry`, which offers one, and the launch gate, which lets its entry through.
 */
export function notInteractive(env: NodeJS.ProcessEnv): string | null {
  const entrypoint = env[ENTRYPOINT_ENV];
  if (entrypoint === INTERACTIVE_ENTRYPOINT) return null;
  return `this Claude Code session is not an interactive one (${ENTRYPOINT_ENV} is ${JSON.stringify(entrypoint ?? null)}, not "${INTERACTIVE_ENTRYPOINT}"), and in a headless run the host makes the relay hand back at its first stop, after which its seats report to the main session`;
}

export const RELAY_EXIT = { written: 0, notOffered: 0, refused: 1, unreadable: 2, locked: 3 } as const;

type Outcome = { exit: number; lines: string[] };

/** The relay's prompt: the entries to launch now, each with its exact input, as launch-next lists them. */
export function relayPrompt(runId: string, n: NextLaunches): string {
  return [
    `Scan run ${runId}: launch these ${n.launch.length} entr${n.launch.length === 1 ? "y" : "ies"} now, one Agent call per entry, all in one message, each input exactly as given (no field added, none left out, no value changed):`,
    ...launchNowLines(n, false),
    "Then end your turn. What comes next reaches you in the program's receipts.",
  ].join("\n");
}

/**
 * WHETHER A RELAY IS OFFERED NOW: why `relay-entry` would print NO RELAY for the run `read` reads, or
 * null where it would offer one. The one predicate `relay-entry` and `launch-next` read, so that after a resume both name
 * the same path: a new relay where one can run, the main session's own launches where it cannot. `then`: what to do
 * instead, where it is not "launch the seats yourself".
 */
export function relayNotOffered(launchDir: string, env: NodeJS.ProcessEnv, now: Date, read: Extract<NextRead, { state: "active" }>): { why: string; then?: string } | null {
  if (claudeCodeSigns(env).length === 0) return { why: "this command is not running inside a Claude Code session, where a relay would run" };
  const headless = notInteractive(env);
  if (headless !== null) return { why: headless };
  // U2 item 3: in a conversation other than the run's, nothing of the run is launched; the run's own continues it.
  const own = env[SESSION_ENV] || env[CLAUDE_CODE_SESSION_ENV] || "";
  if (own !== "" && read.marker.session_id !== null && own !== read.marker.session_id) return { why: otherConversationText(read.marker, own).replace(/\.$/, ""), then: "Launch nothing: tell the person the command above." };
  const live = liveRelayOf(launchDir, now);
  if (live) return { why: `relay ${live.entry} of this attempt was let through at ${live.reserved_at} and has not handed back, and one relay runs at a time` };
  const n = read.next;
  const running = n.occupancy.listed_running + n.occupancy.pending;
  if (running > 0) return { why: `${running} listed seat(s) are already running or awaiting their launch result, and a seat's answer comes back to whoever launched it, not to a relay` };
  if (n.launch.length === 0) return { why: "the launch gate's computation has nothing to launch now" };
  // F2 of an internal record: the launch gate's own answer for each entry to launch now
  // (hook-launch.ts `launchBars`, which the relay's launches get): no relay where it would refuse one - where the session
  // runs every launch in the foreground (background tasks turned off, or a launch that ran so), or a command must run first.
  const host = launchHostOf(launchDir, read.marker, env, true);
  for (const x of n.launch) {
    const bars = launchBars(x.entry, host);
    const person = bars.find((b) => b.clears === "person");
    if (person) return { why: `the launch gate would launch none of the run's seats in this session: ${person.text.replace(/\.$/, "")}`, then: "Launch nothing: tell the person what the reason above asks of them." };
    if (bars.length > 0) return { why: `entry ${x.entry.id} is refused by the launch gate until a command has run: ${barFixes(bars).join("; ")}` };
  }
  return null;
}

/** Where `relay-entry` writes the relay's Agent input, alone, so that its own output is short. */
export const relayInputPath = (launchDir: string, id: string): string => join(launchDir, `${id}.agent-input.json`);

export function runRelayEntry(opts: Record<string, unknown>, env: NodeJS.ProcessEnv, now: Date): Outcome {
  const launchDir = resolve(typeof opts.launchDir === "string" ? opts.launchDir : join(".legal", "launch"));
  const listPath = join(launchDir, "launch-list.json");
  const no = (why: string, then = "Launch the seats yourself: run launch-next and launch what it prints (SKILL.md step 4)."): Outcome => ({
    exit: RELAY_EXIT.notOffered,
    lines: [`NO RELAY: ${why}. Nothing was written. ${then}`],
  });
  if (claudeCodeSigns(env).length === 0) return no("this command is not running inside a Claude Code session, where a relay would run");
  const headless = notInteractive(env);
  if (headless !== null) return no(headless);
  if (!existsSync(launchDir)) return no(`the launch directory ${launchDir} does not exist`);
  const r = withListLock(listPath, (): Outcome => {
    const l = readLaunchList(listPath);
    if (!l.ok) return { exit: l.exit === "unreadable" ? RELAY_EXIT.unreadable : RELAY_EXIT.refused, lines: [`relay-entry: refused - ${l.problem}. Nothing was written.`] };
    const list = l.value;
    const read = readNextLaunches(launchDir, now, (runId, at) => {
      const ledgers = readAnswerLedgers(dirname(launchDir), launchDir, runId, at);
      return (id) => relaunchable(ledgers, id);
    });
    if (read.state === "none") return no("no scan run is active");
    if (read.state === "unreadable") return { exit: RELAY_EXIT.unreadable, lines: [`relay-entry: refused - ${read.problem}. Nothing was written.`] };
    const not = relayNotOffered(launchDir, env, now, read);
    if (not) return no(not.why, not.then);
    const n = read.next;
    // The entry's id is in its input, so no two relay entries have one
    // input and the gate's match (hook-launch.ts decideLaunch) finds each; before, a relay entry written after a failed
    // relay launch repeated the first one's input and was refused as that one, already launched.
    const id = `relay-${(list.relays?.length ?? 0) + 1}`;
    const agentInput = { subagent_type: RELAY_AGENT_TYPE, description: `Relay ${id}: launch the seats of scan run ${list.run_id}`, prompt: relayPrompt(list.run_id, n), model: list.model };
    const entry: RelayEntry = {
      id,
      role: "relay",
      launch: LAUNCH_FORM,
      agent_input: agentInput,
      agent_input_sha256: createHash("sha256").update(JSON.stringify(agentInput)).digest("hex"),
      first: n.launch.map((x) => x.entry.id),
      written_at: now.toISOString(),
    };
    const next: LaunchList = { ...list, relays: [...(list.relays ?? []), entry] };
    // The Agent input, which names every
    // entry's input and runs to thousands of characters, is written alone to a file, and the output stays a few short
    // lines, so nothing in it has to be cut to be read.
    const inputPath = relayInputPath(launchDir, id);
    const inputText = JSON.stringify(agentInput);
    try {
      writeFileAt(inputPath, `${inputText}\n`);
      replaceLaunchList(listPath, next, "relay-entry", new Map(), l.sha256);
    } catch (e) {
      return { exit: RELAY_EXIT.refused, lines: [`relay-entry: refused - ${(e as Error).message}. Nothing was written.`] };
    }
    return {
      exit: RELAY_EXIT.written,
      lines: [
        `RELAY for scan run ${list.run_id}: entry ${entry.id} appended to ${listPath}. Its Agent input, ${inputText.length} characters on one line, is written alone to ${inputPath}: read that file whole (cat it; cut nothing) and launch the relay now, passing its content as the Agent input exactly and nothing else.`,
        `Then launch nothing else, run no command and end your turn: the relay launches the ${n.launch.length} entr${n.launch.length === 1 ? "y" : "ies"} to launch now (${entry.first.join(", ")}) and every later one from the program's receipts, and its hand-back wakes you when no listed seat is outstanding. If the launch gate refuses the relay, launch the seats yourself from launch-next.`,
        // LOST AT THE RESUME: the person is told once, here too, where the relay launches what the earlier process lost.
        ...[resumedSentence(n)].flatMap((x) => (x === null ? [] : [`${FOR_THE_PERSON} ${x}`])),
        // A run started by another version of the program: said here too, as launch-next says it.
        ...[programVersionSentence(read.marker, launchDir)].flatMap((x) => (x === null ? [] : [`${FOR_THE_PERSON} ${x}`])),
      ],
    };
  });
  return "locked" in r ? { exit: RELAY_EXIT.locked, lines: [`relay-entry: refused - ${r.locked}. Nothing was written.`] } : r;
}

export function registerRelaySeat(program: Command): void {
  program
    .command("relay-entry")
    .description(
      "Append to the active run's launch list the relay entry: the Agent input that launches the plugin's relay, whose only tool is Agent, with the entries to launch now in its prompt. Offered only inside an interactive Claude Code session, with no listed seat running, no other relay live and something to launch; otherwise prints NO RELAY and writes nothing. Exit 0 on RELAY or NO RELAY, 1 when refused, 2 when the list cannot be read, 3 when the list is locked",
    )
    .option("--launch-dir <dir>", "the launch directory (default: .legal/launch)")
    .action((opts) => {
      // No relay in a session where the plugin's hooks are not running.
      const stop = hooksNotRunningRefusal(process.env);
      if (stop !== null) {
        console.error(stop);
        process.exitCode = 4;
        return;
      }
      const r = runRelayEntry(opts as Record<string, unknown>, process.env, new Date());
      for (const l of r.lines) console.log(l);
      process.exitCode = r.exit;
    });
}
