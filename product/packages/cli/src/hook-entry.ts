#!/usr/bin/env node
/**
 * The light entry Claude Code runs for every hook the plugin registers (product/plugin/hooks/hooks.json), through the
 * plugin's shim: `/bin/bash -p "${CLAUDE_PLUGIN_ROOT}/bin/legal-hook" <event>` runs it with the node the launcher's rule
 * picks (see UNDER THE PLUGIN'S SHIM below). It hands stdin, CLAUDE_PROJECT_DIR and its
 * output to hook.ts's runHookEntry, which reads the event, starts the routes (hook-child.js) when a route acts on it,
 * and prints the decision. It loads no part of the CLI but the handler: an event nobody acts on costs one Node start-up. One that a route acts on costs
 * a worker thread of this same process, or, where a route that refuses on failure or a capture route acts on it, a
 * second Node start (some 0.07 s on Linux and 0.5 s on native Windows, measured there; before, every such event
 * started that second process).
 *
 * ONE RULE FOR EVERY END (integration part B item 1; part A's list, item 5): runHookEntry keeps every deadline and
 * runs no route on this thread (the routes run in hook-child.js, as a process or a thread, which it stops first), so
 * nothing here can hold the process: whatever the exit code (0, 1 at a deadline, 2 for a refusal), the entry ends as soon as its output has
 * been handed to the streams. Waiting for the writes matters, since process.exit can cut a pending write to stderr,
 * which is where a refusal's reason is. The one exception is a routes' thread held inside a system call, which the
 * process waits for at its end; runHookEntry runs routes in a thread only where every deadline's answer is to go
 * ahead (hook.ts, WHERE THE ROUTES RUN), so that wait changes no decision.
 */
import "./install-guard-on.js"; // FIRST: no package from outside the shipped install
import { writeSync } from "node:fs";
import { HOOK_PROCESS_DEADLINE_MS, HOOK_PROJECT_ENV, runHookEntry } from "./hook.js";

/*
 * UNDER THE PLUGIN'S SHIM: hooks.json runs this entry only through product/plugin/bin/legal-hook,
 * which passes `--stderr-fd=<n>` and takes exit 0 and exit 2 as the entry's answer and every other exit as a hook that
 * did not run (the event's fail-closed result). So, under the shim:
 * - what the entry means for stderr goes to descriptor <n>, the shim's own stderr, since the shim keeps Node's stderr
 *   (a crash's trace) from Claude Code;
 * - the entry's own "go ahead" after a failure that does not refuse (runHookEntry's exit 1: a route that fails open by
 *   design, stdin that is not an event, a deadline with no refusing check open) ends as exit 0, its note carried as the
 *   output's systemMessage, the field Claude Code shows the person, so it is not read as a hook that did not run.
 * Run without the flag (a gate, or a person running the entry by hand), the entry prints and exits as runHookEntry says.
 */
const SHIM_FLAG = "--stderr-fd=";
const shimArg = process.argv.slice(2).find((a) => a.startsWith(SHIM_FLAG));
const shimFd = shimArg === undefined ? null : Number(shimArg.slice(SHIM_FLAG.length));
const underShim = shimFd !== null && Number.isInteger(shimFd) && shimFd > 2;
/**
 * THE DEADLINE COUNTS FROM THE SHIM'S START, not from
 * this module's: Claude Code's time-out (30 s on every PreToolUse group) counts from the moment it starts the shim, and a
 * timed-out PreToolUse goes ahead, during a scan too (its fallback is killed with the shim). So the time already spent
 * is taken off `HOOK_PROCESS_DEADLINE_MS`: the shim's whole seconds (bash's `SECONDS`, passed as `--shim-seconds=<n>`)
 * plus one, the most its rounding down can hide, and this process's own start and module load (`performance.now()`,
 * counted from the process's start). Every route then answers, itself or by the deadline's rule (refuse where a check
 * that fails closed is open), at the latest 20 s after the shim began, and never later than `ANSWER_FLOOR_MS` after
 * this line. Without the flag (the entry started on its own, as tests start it) only this process's time is taken off.
 */
const SHIM_SECONDS_FLAG = "--shim-seconds=";
const ANSWER_FLOOR_MS = 1000;
const shimSecondsArg = process.argv.slice(2).find((a) => a.startsWith(SHIM_SECONDS_FLAG));
const shimSeconds = shimSecondsArg === undefined ? Number.NaN : Number(shimSecondsArg.slice(SHIM_SECONDS_FLAG.length));
const spentMs = (Number.isInteger(shimSeconds) && shimSeconds >= 0 ? (shimSeconds + 1) * 1000 : 0) + performance.now();
const processDeadlineMs = Math.max(ANSWER_FLOOR_MS, Math.floor(HOOK_PROCESS_DEADLINE_MS - spentMs));
/**
 * `--event-joined`: the shim read only
 * the event's head (bash reads a socket one byte per call) and passes it with the rest, copied unread, on stdin; an event
 * that does not then arrive whole is refused (hook.ts `HookEntryIO.joinedEvent`).
 */
const joinedEvent = process.argv.slice(2).includes("--event-joined");

/*
 * EVERY STRING THE HOOKS PRINT GOES THROUGH THE PRINTED REDACTION (area 1
 * F2): the writes below are the only place the hooks' entry prints, and a refusal can quote a seat's own word back to it.
 * The redaction and the printed form (printed-output.ts `printedText`, the CLI's own) are loaded at the first write, so an event nobody
 * acts on still costs one Node start-up and nothing more; the writes keep their order.
 *
 * WHERE THE REDACTION CANNOT RUN, NO TEXT IS PRINTED UNREDACTED AND NO DECISION IS DROPPED: a
 * redaction that cannot be loaded (a dist missing printed-output.js or one of its imports) or that throws on a text
 * leaves the decision as it was and replaces the words. A JSON output keeps its decision fields (DECISION_FIELDS) and
 * has every other string replaced by WITHHELD; any other text (a refusal's reason on stderr, with exit 2) is replaced by
 * WITHHELD. The exit code is the entry's own either way, so a deny stays a deny and a block a block.
 */
const WITHHELD =
  "wolfboy: this hook's message is withheld because the plugin's printed redaction could not run; repair the plugin's build (packages/cli/dist).";
/** The fields of a hook's JSON output that decide, not say, by their place: the top level or hookSpecificOutput. */
const DECISION_FIELDS: Readonly<Record<string, readonly string[]>> = {
  "": ["decision", "continue", "suppressOutput"],
  hookSpecificOutput: ["hookEventName", "permissionDecision", "retry"],
};
function withheldValue(v: unknown, path: readonly string[]): unknown {
  if (typeof v === "string") {
    const parent = path.length === 1 ? "" : path.length === 2 ? path[0] : null;
    return parent !== null && DECISION_FIELDS[parent]?.includes(path[path.length - 1]) ? v : WITHHELD;
  }
  if (Array.isArray(v)) return v.map((x, i) => withheldValue(x, [...path, String(i)]));
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withheldValue(x, [...path, k])]));
  return v;
}
/** The text printed in place of `text` when the redaction cannot run on it. */
function withheld(stream: "stdout" | "stderr", text: string): string {
  if (stream === "stdout") {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return JSON.stringify(withheldValue(parsed, []));
    } catch {
      // not JSON: replaced whole below
    }
  }
  return `${WITHHELD}${text.endsWith("\n") ? "\n" : ""}`;
}

let redaction: Promise<((text: string) => string) | null> | undefined;
/** The redacted text, or the withheld one where the redaction could not be loaded or threw. */
async function printable(stream: "stdout" | "stderr", text: string): Promise<string> {
  redaction ??= import("./printed-output.js").then(
    (m: { printedText?: unknown }) => (typeof m.printedText === "function" ? (m.printedText as (t: string) => string) : null),
    () => null,
  );
  const redact = await redaction;
  if (redact === null) return withheld(stream, text);
  try {
    const out = redact(text);
    return typeof out === "string" ? out : withheld(stream, text);
  } catch {
    return withheld(stream, text);
  }
}

/** Write one text to its stream and resolve when it has been handed over (or the stream refused it). */
function emit(stream: "stdout" | "stderr", text: string): Promise<void> {
  if (stream === "stderr" && underShim) {
    try {
      writeSync(shimFd as number, text);
    } catch {
      // the shim's descriptor is gone: nothing else can carry the text
    }
    return Promise.resolve();
  }
  const s = stream === "stdout" ? process.stdout : process.stderr;
  return new Promise<void>((done) => {
    try {
      s.write(text, () => done());
    } catch {
      done();
    }
  });
}

/** What runHookEntry handed to `write`, in order; printed at `exit`, where the exit code is known. */
const pending: { stream: "stdout" | "stderr"; text: string }[] = [];

void runHookEntry({
  stdin: process.stdin,
  projectDir: process.env[HOOK_PROJECT_ENV],
  processDeadlineMs,
  joinedEvent,
  write: (stream, text) => {
    pending.push({ stream, text });
  },
  exit: (code) => {
    let outs = pending;
    let end = code;
    if (underShim && code === 1) {
      // runHookEntry's exit 1 prints nothing on stdout: its note (stderr) becomes the systemMessage of a pass.
      const note = pending
        .filter((p) => p.stream === "stderr")
        .map((p) => p.text)
        .join("")
        .trim();
      outs = note === "" ? [] : [{ stream: "stdout", text: JSON.stringify({ systemMessage: note }) }];
      end = 0;
    }
    process.exitCode = end;
    const all = outs.reduce<Promise<void>>((prev, o) => prev.then(() => printable(o.stream, o.text)).then((t) => emit(o.stream, t)), Promise.resolve());
    void all.then(
      () => process.exit(end),
      () => process.exit(end),
    );
  },
});
