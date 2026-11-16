/**
 * The routes' own process or thread (integration part B item 1: one deadline rule). The entry (hook-entry.ts, hook.ts
 * `runHookEntry`) runs no route on its own thread: it starts this module for an event some route acts on, and keeps
 * every deadline. A route's work is synchronous once its module has loaded (the capture and the guard read and write
 * files with synchronous calls), and no timer fires in the thread that does it.
 * Here a route may hold its thread as long as it likes; the entry's timers still fire, and it ends this process
 * (SIGKILL) or thread (`terminate`) at the first deadline or at its first result.
 * TWO WAYS TO RUN, ONE CODE. As a
 * process (`node hook-child.js`, the entry's `childRunner`) where a route that refuses on failure or a capture route
 * acts on the event; as a worker thread of the entry's own process (`workerRunner`) everywhere else, which saves a
 * second Node start on every such call (the file, Grep, edit and shell calls of every session). The routes, their
 * order and their decisions are this one function either way (`runRoutes`).
 *
 * Protocol: the input is one JSON object `{ raw, projectDir }` (the event exactly as the entry read it, and
 * CLAUDE_PROJECT_DIR): a process reads it from stdin, a thread from its workerData. The output is JSON messages, sent
 * so that each is with the entry before the next route starts, however that route then blocks: `{ "begun": <route
 * name> }` just before each route runs, then `{ "result": <HookResult> }`. A process writes them as lines on stdout
 * with a synchronous write; a thread posts them (a post is queued at once, whatever this thread does next). Nothing
 * else is written to stdout; stderr is not read.
 */
import "./install-guard-on.js"; // FIRST: no package from outside the shipped install
import { writeSync } from "node:fs";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { ANCHOR_HOME_SEAM } from "./start-record.js";

/**
 * The entry's own anchor seam, where code
 * loaded into it set one (start-record.ts ANCHOR_HOME_SEAM: a test's preload, which neither a thread nor a child process
 * runs). Only the entry, a process of the program, hands it here.
 */
function takeAnchorSeam(anchorHome: unknown): void {
  if (typeof anchorHome === "string" && anchorHome !== "") (globalThis as unknown as Record<symbol, unknown>)[ANCHOR_HOME_SEAM] = anchorHome;
}
import { enableHookCompileCache } from "./compile-cache.js";

// Before hook.js and the route modules load, so that they are
// compiled from the cache where it may be (compile-cache.ts); it decides nothing.
enableHookCompileCache();
const { handleHookEvent } = await import("./hook.js");

/*
 * The deeper check's report is checked (its line limit, strings that look like
 * keys) BEFORE the relay writes anything of it. The check is registered here, outside the judging closure, and only for
 * an answer to AskUserQuestion (the one event whose route writes an answer), so no other event loads it. Both modules
 * are loaded as the routes load theirs: where either does not load, nothing is registered, the question route fails as
 * it does without its module, and a relay with no check writes none of a checked purpose's typed text.
 */
async function registerTypedScreens(raw: string): Promise<void> {
  let ev: unknown;
  try {
    ev = JSON.parse(raw);
  } catch {
    return;
  }
  const e = ev as { hook_event_name?: unknown; tool_name?: unknown } | null;
  if (e === null || typeof e !== "object" || e.hook_event_name !== "PostToolUse" || e.tool_name !== "AskUserQuestion") return;
  try {
    const [hq, dc] = await Promise.all([import("./hook-question.js"), import("./deep-copy-text.js")]);
    hq.screenTypedAnswers(hq.DEEP_REPORT_PURPOSE, (answer) => dc.reportScreen(answer));
  } catch {
    // not loaded: see above
  }
}

/** The entry that started this process. Once it is gone (the platform killed it), no further route is started. */
const entryPid = process.ppid;
/**
 * Once the entry has ended - at its deadline it may let a capture route finish here on
 * its own (hook.ts `HookRoute.continues`) - nothing reads this process's stdout, and a write to it fails (EPIPE): the
 * route's work is recorded by the route itself, and the failed write is no reason to end it. A thread cannot outlive
 * its entry: the entry ends it before it ends, so for a thread the entry is never gone.
 */
const entryGone = (): boolean => !isMainThread ? false : process.ppid !== entryPid;
const send = (value: unknown): void => {
  if (!isMainThread) {
    parentPort?.postMessage(value);
    return;
  }
  try {
    writeSync(1, `${JSON.stringify(value)}\n`);
  } catch {
    // the entry has gone; see above
  }
};

/**
 * A ROUTE'S OWN LIMIT (hook.ts `HookRoute.ownLimitMs`). A capture route
 * may be let go at the entry's deadline, and then nothing outside ends this process. It ends itself `ms` after such a
 * route began, whatever the route is doing: the timer runs in a thread of its own (a timer of this thread never fires
 * while a route holds it, above), and the signal goes to this process's own pid, never to another's. The first such
 * route's limit holds for the process; the thread is unreferenced, so it never keeps the process alive. Only a
 * process has such a route (hook.ts `runHookEntry` runs every event a capture route acts on in a process).
 */
let limited = false;
const endItselfAfter = (ms: number): void => {
  if (limited || !isMainThread) return;
  limited = true;
  const pid = process.pid;
  new Worker(`setTimeout(() => process.kill(${pid}, "SIGKILL"), ${Math.max(0, Math.floor(ms))});`, { eval: true }).unref();
};

/** Every route that acts on the event, in table order, reported as it goes; then the result. One code for both ways. */
function runRoutes(raw: string, projectDir: string | null): void {
  registerTypedScreens(raw).then(() => handleHookEvent(raw, {
    projectDir: projectDir ?? undefined,
    entryGone,
    onRoute: (route, r) => {
      if (entryGone()) process.exit(0);
      if (typeof r.ownLimitMs === "number") endItselfAfter(r.ownLimitMs);
      send({ begun: route });
    },
  })).then(
    (result) => {
      send({ result });
      process.exit(0);
    },
    () => process.exit(1),
  );
}

if (isMainThread) {
  const chunks: Buffer[] = [];
  process.stdin.on("data", (c: Buffer | string) => chunks.push(typeof c === "string" ? Buffer.from(c, "utf8") : c));
  process.stdin.on("end", () => {
    const { raw, projectDir, anchorHome } = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { raw: string; projectDir: string | null; anchorHome?: unknown };
    takeAnchorSeam(anchorHome);
    runRoutes(raw, projectDir);
  });
} else {
  const { raw, projectDir, anchorHome } = workerData as { raw: string; projectDir: string | null; anchorHome?: unknown };
  takeAnchorSeam(anchorHome);
  runRoutes(raw, projectDir);
}
