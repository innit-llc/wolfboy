/**
 * THE PLUGIN'S HOOKS: one
 * handler for every hook event the plugin registers in product/plugin/hooks/hooks.json. Claude Code runs
 * the light entry (hook-entry.ts) once per event with the event's JSON on stdin; the handler dispatches on
 * `hook_event_name` and `tool_name` and returns the decision JSON that event takes. The call is taken from
 * stdin and never from the session's transcript, which lags behind the hooks (probe fact (e)).
 *
 * FAIL-OPEN IS THE PLATFORM'S RULE, SO EVERY FAILURE IS WRITTEN DOWN. A hook that times out or exits 1
 * lets the tool call or the stop go ahead (probe fact (f)). The handler cannot change that. What it does
 * is leave one line in `.legal/capture/hook-failures.jsonl` for every failure it sees, so that a later
 * step sees that a hook failed open instead of inferring it from a record that is not there.
 *
 * WHERE THE RUN IS: `$CLAUDE_PROJECT_DIR/.legal`. The event's `cwd` follows the session's `cd`: in the
 * probe's runs A, B and G every event after `cd sub`, the seat's own included, carried `.../work/sub`,
 * while CLAUDE_PROJECT_DIR stayed `.../work`, the folder the session started in. SKILL.md runs the scan
 * there, with `--out .legal/findings.json`. With CLAUDE_PROJECT_DIR unset there is no run to act on.
 *
 * WHOSE EVENTS: each route names the callers it acts for (`who`): the plugin's own seats, recognised by
 * `agent_type` `<plugin name>:<agent name>` as the probe recorded it (`rp1probe:seat`); the main session, whose
 * events carry no `agent_id`; internal agents, which carry `agent_type` "" or none at all (probe fact (i)); and
 * any other agent. The capture and the seat's reads act for the seats only; the question relay's AskUserQuestion
 * routes for the main session; the write guard, `question:shape-flag` and the launch unit's gates for every caller,
 * since a write, a shape flag, a launch or a message from any of them reaches the run as a seat's would; the launch
 * unit's seat routes (`launch-seat-*`) for seats and other agents. An event that no route names for its caller
 * passes untouched. (Until relay item 4's routes, every agent other than the plugin's seats passed untouched:
 * hooks-launch report S5.)
 *
 * WHAT THIS FILE DECIDES (integration part B item 6, S5). The routes' own work is in the relay units' modules,
 * loaded only when a route runs. This file holds the dispatcher, the run's paths, the `begun` and failure logs, and
 * what decides whether a route runs and what happens when it cannot finish: the entry (`runHookEntry`: the stdin
 * deadline, the routes run off the entry's thread under the process deadline - in a second process where a route
 * refuses on failure or captures, in a thread of the entry's own process elsewhere - a refusing route's own deadline,
 * and a refusing route's exit 2 ending the event at once; part B item 1), the route table (`ROUTES`) with each route's
 * `when` and `failClosed`, and the light checks they use without loading a module (`runMarkerStands`, part B
 * item 3; `seatReadFailsClosed`, part B item 4).
 */
import { spawn } from "node:child_process";
import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { atOrInside, dotDotReadings, locate } from "./file-identity.js";
import { appendFileAt, makeFolder, removeFile, writeFileAt } from "./project-write.js";
import { readProgramFile } from "./program-file.js";
import { valueText } from "./value-text.js";
import { launchRecordPath } from "./state-record.js";
import { accountHomeNow, accountStateDir, ANCHOR_HOME_SEAM, anchorStateDir, noteScannedFolder, processStateDir, SPARE_KEY_FOLDER, STATE_APP_DIR } from "./start-record.js";
// The one writer of told commands; it imports only Node's own modules, so the
// refusal below still reads where the gate module failed to load.
import { scannerCommand, toldArgs } from "./scanner-command.js";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { relativePath } from "./project-path.js";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { Worker } from "node:worker_threads";

export const HOOK_VERSION = 1;

/** The plugin's name, as `.claude-plugin/plugin.json` declares it and Claude Code prefixes it to an agent's type. */
export const HOOK_PLUGIN_NAME = "wolfboy";
/** The project folder Claude Code sets for every hook command it runs (read by hook-entry.ts; host-env.ts lists it). */
export const HOOK_PROJECT_ENV = "CLAUDE_PROJECT_DIR";
/** The seats whose answers the program captures: the three agent definitions of the legal-scan skill. */
export const SEAT_AGENT_TYPES: readonly string[] = ["legal-adjudicator", "legal-refuter", "legal-silence-investigator"].map(
  (a) => `${HOOK_PLUGIN_NAME}:${a}`,
);
/**
 * The relay: the one listed agent that launches the seats,
 * whose only tool is `Agent`. It is not a seat. Its starts, stops and hand-back are never captured and never counted
 * (the trial's condition 3: it fires SubagentStart and SubagentStop at every wake, and a first mid-run stop read as a
 * seat's would free a place or be read as an answer), and its hand-back is refused while any listed seat is outstanding
 * (condition 2). Its `Agent` calls reach the launch gate like the main session's (condition 4).
 */
export const RELAY_AGENT_TYPE = `${HOOK_PLUGIN_NAME}:legal-relay`;

/**
 * The directories under `.legal` that only the program writes (relay item 3, milestone 4). Each is named by
 * the code that writes it, and the gate checks this list against those names: context.ts CONTEXT_PAYLOAD_DIR,
 * verdict-capture.ts recordPathFor and LEDGER_FILE, runPaths' launch directory, SKILL.md's --carry-into and
 * --assemble-into. It is a checked copy and not an import so that the entry loads no more than this file.
 */
export const RECORD_DIRS: readonly string[] = ["verdicts", "readers", "capture", "launch", "payloads", "verdicts-carried", "verdicts-assembled"];
/**
 * WOLFBOY'S RUN FILES AND OUTPUTS beside the record
 * directories, each with what writes it: the text of the file tools' refusal (hook-guard.ts `onFileWrite`, in every session,
 * in any project's `.legal`). The program writes each in its own process, and the next step reads it as written: the plan
 * and the findings the assembly takes, the logs a later scan carries from, the report and record the person and their
 * auditors read. A file tool has no step that writes one (the orchestrator's own file, `.legal/orientation-notes.md`, and
 * the person's, `.legal/memory.md` and `.legal/declarations.verified.json`, are not among them). A folder's entry covers
 * every file under it.
 */
export const RUN_OUTPUTS: Readonly<Record<string, string>> = {
  "findings.json": "`legal-scan scan` writes the findings document, and records its digest in your state folder",
  "findings.sarif": "`legal-scan scan` writes the SARIF copy of the findings",
  "adjudicate-plan.json": "the pre-launch step (`legal-scan adjudicate`) writes the plan, and records its digest in your state folder",
  "declaration-plan.json": "`legal-scan scan` writes the declaration plan, and records its digest in your state folder",
  "orientation.json": "`legal-scan scan` writes the orientation sheet",
  "orientation.md": "`legal-scan scan` renders the orientation sheet",
  "verdict-reading.json": "`legal-scan verdict-reading` writes it",
  "verdict-quotes.json": "`legal-scan verdict-verify` writes the quote check's report",
  "evidence/": "the assembly writes each evidence log, and records its digest in your state folder",
  "reports/": "the assembly writes the report's files, and records their digests in your state folder",
  "records/": "`legal-scan record` writes the record of a run",
};

/** Relative to the run's `.legal` directory. Append-only, one JSON object per line. */
export const HOOK_FAILURE_LOG = "capture/hook-failures.jsonl";

/** Relative to `.legal`: one line per capture route about to run (recordBegun). Append-only, one JSON object per line. */
export const HOOK_BEGUN_LOG = "capture/hook-begun.jsonl";

/** How long the entry waits for stdin to close before it gives up, well inside every timeout in hooks.json. */
export const HOOK_STDIN_DEADLINE_MS = 5000;

/**
 * How long the entry may take, counted from its start, before it gives up on the event. It then ends at once: exit 2
 * (the call refused) when a route that fails closed for the call has not finished, and otherwise exit 1 with one
 * failure line (`stage: "deadline"`), which lets the call or the stop go ahead (probe fact (f)); either way the
 * failure is on record before the platform's own time-out cancels the hook. The gate pins it above
 * HOOK_ROUTE_DEADLINE_MS plus HOOK_STDIN_DEADLINE_MS and below the smallest timeout in hooks.json (30 s). It covers a
 * route's work, not only reading stdin and loading the route: the routes run in a child process (hook-child.ts) and
 * the entry, which runs none, keeps the timers (a timer in the process a route works in never fires while the route works synchronously).
 */
export const HOOK_PROCESS_DEADLINE_MS = 20000;

/**
 * THE CAPTURE ROUTES' OWN LIMIT (`HookRoute.ownLimitMs`). A capture
 * route's process is let go at the entry's deadline to finish on its own (`HookRoute.continues`), so the entry's timers no
 * longer end it: it ends itself this long after the route began, let go or not (hook-child.ts, a timer in a thread of its
 * own, which keeps time while the route holds the process's thread). A hand-back's check takes well under a second on
 * this build (0.6 s on a real run's shape) and took 18 s on the base build under load, so the limit is three times the
 * entry's deadline. A seat's stop may first wait for a check of its hand-back still running (at most that check's own
 * limit, hook-capture.ts `liveChecks`), so its limit is twice the check's.
 */
export const CAPTURE_HANDBACK_LIMIT_MS = 3 * HOOK_PROCESS_DEADLINE_MS;
export const CAPTURE_STOP_LIMIT_MS = 2 * CAPTURE_HANDBACK_LIMIT_MS;

/** The fields of a hook event this handler reads (probe facts (a), (b), (c)); every other field is kept as sent. */
export interface HookInput {
  hook_event_name: string;
  session_id?: string;
  cwd?: string;
  permission_mode?: string;
  agent_id?: string;
  agent_type?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_use_id?: string;
  tool_response?: unknown;
  last_assistant_message?: unknown;
  agent_transcript_path?: string;
  transcript_path?: string;
  stop_hook_active?: boolean;
  /** UserPromptSubmit or UserPromptExpansion: the prompt's text, whoever submitted it (no route reads it). */
  prompt?: unknown;
  /** UserPromptExpansion: the name of the typed command being expanded (`expansionLiftsTheStop` reads it). */
  command_name?: unknown;
  /** SessionStart: how the session started - `startup`, `resume`, `clear`, `compact` or `fork` (`resume` of the run's own conversation, hook-launch.ts RESUMES_FILE). */
  source?: unknown;
  [field: string]: unknown;
}

/** Who made the call or stopped: the main session, one of this plugin's seats, its relay, an internal agent, or any other agent. */
export type Who = "main" | "seat" | "relay" | "internal" | "other";

export function whoIs(input: HookInput): Who {
  if (typeof input.agent_id !== "string" || input.agent_id === "") return "main";
  const type = input.agent_type;
  if (typeof type !== "string" || type === "") return "internal";
  if (type === RELAY_AGENT_TYPE) return "relay";
  return SEAT_AGENT_TYPES.includes(type) ? "seat" : "other";
}

/** Where one run's files are, all under `<project>/.legal` (the launch list's own default layout). */
export interface RunPaths {
  projectDir: string;
  legalDir: string;
  launchDir: string;
  listPath: string;
  eventsPath: string;
  findingsPath: string;
}

export function runPaths(projectDir: string): RunPaths {
  const legalDir = join(projectDir, ".legal");
  const launchDir = join(legalDir, "launch");
  return {
    projectDir,
    legalDir,
    launchDir,
    listPath: join(launchDir, "launch-list.json"),
    eventsPath: join(launchDir, "launch-events.jsonl"),
    findingsPath: join(legalDir, "findings.json"),
  };
}

/**
 * What the hook tells Claude Code. `pass` prints nothing and exits 0: the call or the stop goes ahead unchanged. `pass` and `replace-input` may carry a `systemMessage`, the message at each tenth of the review
 * (hook-launch.ts `withTenthMessage`), printed as the output's top-level `systemMessage`, the field Claude Code shows
 * the person. Whether a seat's hook message reaches the person's screen is not yet seen in a real session.
 */
export type HookDecision =
  | { kind: "pass"; systemMessage?: string }
  /** PreToolUse: the call is cancelled and the reason reaches the caller behind a fixed prefix (probe fact (c)). */
  | { kind: "deny"; reason: string }
  /** PreToolUse: the call runs with this input (probe fact (c): the hand-back's message replaced by a receipt). */
  | { kind: "replace-input"; updatedInput: Record<string, unknown>; systemMessage?: string }
  /** SubagentStop: the seat is not let stop and reads the reason as its next message (probe fact (c)). */
  | { kind: "block"; reason: string }
  /**
   * PermissionDenied: the caller reads `context` (additionalContext) and the person sees
   * `systemMessage`. Never `retry`: nothing the auto-mode classifier did not allow is launched again on its own.
   */
  | { kind: "notify"; context: string; systemMessage: string };

export const PASS: HookDecision = { kind: "pass" };

export interface HookEnv {
  /** `CLAUDE_PROJECT_DIR` as Claude Code sets it for the hook. */
  projectDir?: string;
  now?: () => Date;
  /**
   * Called just before each route runs, with its name (hook-child.ts reports it to the entry, which times the route) and
   * the route itself (hook-child.ts starts a route's own limit, `HookRoute.ownLimitMs`).
   */
  onRoute?: (route: string, r: HookRoute) => void;
  /** Whether the entry that started this process has ended (HookContext.entryGone). */
  entryGone?: () => boolean;
}

/**
 * How long a route that fails closed may run, counted from its own start, before the entry refuses the call itself
 * (exit 2): §3.5's own deadline of a refusing hook, set before the hook's time-out. With HOOK_STDIN_DEADLINE_MS it
 * passes before HOOK_PROCESS_DEADLINE_MS (12 + 5 < 20; the question gate pins the order), so a stuck refusing route
 * is refused by its own deadline and never let through by the process deadline.
 * The entry keeps it from outside the routes' process, like every deadline (runHookEntry: one
 * rule; integration part B item 1), so it fires whatever the route is doing.
 */
export const HOOK_ROUTE_DEADLINE_MS = 12000;

export interface HookContext {
  input: HookInput;
  who: Who;
  /** Null when CLAUDE_PROJECT_DIR is unset. */
  run: RunPaths | null;
  now: () => Date;
  /**
   * True once the entry that started this route has ended (it gave up at its deadline
   * and let the route finish on its own, `HookRoute.continues`): what the route decides now reaches nobody, so it records
   * and writes nothing that only a delivered decision needs. Absent where the route runs in the entry's own process.
   */
  entryGone?: () => boolean;
}

/** One route: what is done for one event (and tool), for whom. Every matching route runs, in table order. */
export interface HookRoute {
  name: string;
  event: string;
  tools?: readonly string[];
  who: readonly Who[];
  run(ctx: HookContext, prior: HookDecision): HookDecision | Promise<HookDecision>;
  /**
   * For a route that refuses calls: true where a failure of the route (a throw, a module that does not load, or
   * HOOK_ROUTE_DEADLINE_MS passing) must refuse this call instead of letting it through. It is decided here,
   * without the route's module, and a predicate that throws counts as true. The handler then exits 2 with the
   * reason on stderr, which cancels the call (§3.5: a refusing hook fails closed). Routes without it fail open.
   */
  failClosed?(ctx: HookContext): boolean;
  /**
   * For a route that captures a seat's answer: a `begun` line is appended to HOOK_BEGUN_LOG, synchronously, just
   * before the route runs (recordBegun; integration part B item 1).
   */
  begun?: boolean;
  /**
   * For a capture route:
   * at the entry's process deadline the route is not stopped. Its process is let go to finish the check and record what
   * it decided (the entry stops listening and ends), and the entry ends with `refuse` - exit 2, the call refused with
   * STILL_CHECKING, so that the seat sends the same answer again and is given the stored decision - or `go-ahead` -
   * exit 1, the stop goes ahead as before while the capture finishes. Before, a capture check slower than the deadline
   * was killed and the hand-back went through to the caller with nothing recorded or refused (fail-open).
   */
  continues?: "refuse" | "go-ahead";
  /**
   * For a route that `continues`: the most its process may run after the route began.
   * The process ends itself there, whatever the route is doing (hook-child.ts), so a check let go always ends on its own.
   */
  ownLimitMs?: number;
  /**
   * Where the route acts at all: false leaves the event to the other routes, and an event no route acts on starts no
   * routes' process. Decided in the entry, without the route's module, like failClosed; a predicate that throws
   * counts as true (the route runs). A route whose work needs more than this light check makes the rest of the check
   * itself (integration part B, area hooks, item 3).
   */
  when?(ctx: HookContext): boolean;
}

/** The active-run marker's file name in the launch folder: a checked copy of hook-launch.ts ACTIVE_RUN_FILE (the gate compares them), since importing that module would load it into the light entry. */
export const ACTIVE_RUN_MARKER = "active-run.json";

/**
 * Whether a scan run's active-run marker stands in this project (it is there, readable or not). It is the entry's
 * light check, decided without any route's module:
 * - the rows that refuse calls fail closed while it holds (the launch gates and question:relay; integration part B
 *   item 1: a refusing route that cannot finish refuses, at every failure, not only when its module does not load), and
 *   launchGateRoute refuses on its own when the module does not load;
 * - the scan-time rows act only while it holds (`when`, item 3). This no longer
 *   keeps a Write, Edit, MultiEdit or NotebookEdit from starting the routes' process outside a run: since rf11 the guard
 *   rows act in every session with no `when` (guard-file-write, guard-key-read, guard-bash, guard-code in ROUTES), so a
 *   Write, Edit, Read, Grep, Glob or shell call starts it in every session.
 * Whether the event belongs to that run (the marker names its session) is the launch unit's rule, which the routes
 * that act on `.legal` apply once loaded (hook-launch.ts `eventInActiveRun`).
 */
export const runMarkerStands = (ctx: HookContext): boolean => ctx.run !== null && existsSync(join(ctx.run.launchDir, ACTIVE_RUN_MARKER));
/**
 * Whether a round of declaration questions stands for the launch
 * directory: the scan writes it to the person's state folder (state-record.ts), never to `.legal/launch` since S1+S2. A
 * place the state folder cannot give reads as standing, so the question route fails closed rather than open.
 */
export function declarationRoundOnRecord(launchDir: string): boolean {
  try {
    return existsSync(launchRecordPath(launchDir, "declaration-question.json"));
  } catch {
    return true;
  }
}

/**
 * The declaration ledger's file name in the launch folder (hook-question.ts imports it from here, so that the light
 * entry reads the one name) and the active-run history's (hook-launch.ts imports it from here too).
 */
export const DECLARATION_LEDGER_FILE = "declaration-ledger.jsonl";
export const ACTIVE_RUN_HISTORY_FILE = "active-run-history.jsonl";

/**
 * The one form the program writes a time in
 * (`Date.prototype.toISOString`), and its instant. The windows compare times as instants, never as text: `Date.parse`
 * takes forms such as "Thu, 01 Jan 2026 00:00:00 GMT" that sort after every ISO time as text, so one committed run end
 * in such a form shut every declaration window. A time in any other form is not the program's: null.
 */
export const PROGRAM_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
export function programInstant(v: unknown): number | null {
  if (typeof v !== "string" || !PROGRAM_TIME.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * THE ONE SIGNAL FOR "A SCAN IS UNDER WAY HERE" THAT THE PLUGIN'S SHIM READS:
 * a hook whose program cannot run fails closed only where a guard is due, and the shim
 * (product/plugin/bin/legal-hook) cannot run this entry's checks, so the program keeps one file for it, in the launch
 * folder, and the shim only asks whether that file stands (or whether a folder on its way cannot be searched).
 * - Written before every line of either question ledger (hook-question.ts `appendLedger`: the scan's `scan-started`,
 *   each question round, each answer, `scan-closed`) and before the active-run marker (hook-launch.ts, the run's start).
 * - Removed when a run ends (hook-launch.ts `endActiveRun`, from run-abort or the assembly), after its history line.
 * So it stands wherever the entry's own light checks can hold - the run's marker (`runMarkerStands`) and a ledger line
 * no older than the last run's end (`declarationMayBeUnderWay`) - and is a superset of them: no session is named in it,
 * because the shim reads no JSON. After run-abort of a scan that never reached a run it stays, as the write guard's
 * window does ("the declaration's own files stay the program's until a run ends"). Nothing reads its contents; it says
 * what wrote it and when, for a person. The guard refuses a tool call's write, move or delete of it while its window
 * is open (hook-guard.ts WINDOW_WRITTEN_BY).
 */
export const SCAN_UNDER_WAY_FILE = "scan-under-way.json";

/** Write the scan-under-way marker (SCAN_UNDER_WAY_FILE) in `launchDir`, creating the folder. Throws where it cannot. */
export function markScanUnderWay(launchDir: string, by: string, at: Date): void {
  makeFolder(launchDir, { recursive: true });
  writeFileAt(join(launchDir, SCAN_UNDER_WAY_FILE), `${JSON.stringify({ v: 1, by, at: at.toISOString() })}\n`);
}

/**
 * Whether a scan may be under way in this
 * project, decided as the plugin's shim decides it (product/plugin/bin/legal-hook: the scan-under-way marker stands, or a
 * folder on its way cannot be searched, so whether it stands cannot be told), or the run's marker stands. Node's own
 * `fs` only, no module of any route's: it is guard-bash's and guard-code's `failClosed`, which holds where hook-guard.js
 * cannot load (any module of its start-up graph missing or throwing), so that a shell command or code call those rows
 * would read is refused while a scan is under way and goes ahead, as before, outside one.
 */
export function scanMayBeUnderWay(ctx: HookContext): boolean {
  if (ctx.run === null) return false;
  if (runMarkerStands(ctx)) return true;
  try {
    lstatSync(join(ctx.run.launchDir, SCAN_UNDER_WAY_FILE));
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code !== "ENOENT" && code !== "ENOTDIR";
  }
}

/** Remove the scan-under-way marker; absent is fine. Throws on any other failure. */
export function clearScanUnderWay(launchDir: string): void {
  try {
    removeFile(join(launchDir, SCAN_UNDER_WAY_FILE));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

/**
 * THE DEEPER CHECK'S OWN MARKER (design rf13 3.9, "The check's own run").
 * A deeper check of one finding (`legal-scan deepen`) launches two seats of its
 * own kind, `legal-deep-checker` (the plan, then the reading), and only while one of them is pending does the hook
 * capture a `legal-deep-checker` answer: `.legal/deep/active.json` names the finding, the session, the check's launch
 * folder (`.legal/deep/<id>/<time>/launch/`), the seat, its start time and an end time 30 minutes later. It is written
 * by the command that writes a seat's launch entry (launch-plan.ts `writeDeepLaunchEntry`) and removed by the command
 * that takes that seat's answer, by any exit that ends the check, by `legal-scan run-abort`, by a scan's start, by a new
 * check, or at its end time (`endDeepCheck`, `readDeepMarker`). It is not a scan's marker: nothing that decides whether
 * a scan is under way reads it, no guard row depends on it, and no line goes through the question ledger, so when the
 * hook cannot start nothing is captured and `deepen` finds no answer and writes nothing.
 *
 * A marker the tree supplied is ignored (`readDeepMarker`): the reader uses it only when its session is the reader's,
 * the launch folder it names is this project's `.legal/deep/<id>/<time>/launch/` for its own finding, its start is not
 * later than the reader's clock, its end is after its start and at most 30 minutes after it, its end has not passed,
 * and git does not track it. Otherwise it is removed with a history line, except a marker git tracks, which is left
 * where it is (the program never changes a tracked file, legal-dir.ts) and named in the history line; while it stands
 * no check starts (`deepStartRefusal`, W5). Every removal and every end has a line in `.legal/deep/history.jsonl`.
 */
export const DEEP_AGENT_NAME = "legal-deep-checker";
export const DEEP_AGENT_TYPE = `${HOOK_PLUGIN_NAME}:${DEEP_AGENT_NAME}`;
/** `.legal/deep`: the deeper checks' own folder, beside the scan's records. */
export const DEEP_FOLDER = "deep";
export const DEEP_MARKER_FILE = "active.json";
export const DEEP_HISTORY_FILE = "history.jsonl";
/** How long a marker may stand after its own start (design 3.9: "an end time 30 minutes later"). */
export const DEEP_MARKER_LIFE_MS = 30 * 60 * 1000;
/** The check's folder's time, to the second (`2026-11-07T14-02-31`, the person's local clock). */
export const DEEP_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;
/** A finding id the check's folder may be named by: one plain name, never a path. */
export const DEEP_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type DeepSeat = "plan" | "reading";
export interface DeepMarker {
  v: 1;
  finding_id: string;
  session_id: string;
  /** Absolute: `<project>/.legal/deep/<finding_id>/<time>/launch`. */
  launch_dir: string;
  seat: DeepSeat;
  started_at: string;
  ends_at: string;
}
/** Why a marker was removed or a check ended, as its history line says it. */
export type DeepEnd =
  | "answer taken"
  | "reading done"
  | "finished without the test"
  | "refused"
  | "error"
  | "ended: run-abort"
  | "ended: a scan started"
  | "ended: a new check started"
  | "expired"
  | "another session's"
  | "start time in the future"
  | "end time beyond 30 minutes"
  | "launch folder elsewhere"
  | "unreadable"
  | "ignored: tracked by git";
export interface DeepHistoryLine {
  v: 1;
  at: string;
  /** `removed`: the marker was taken away; `ignored`: it was left where it was (git tracks it); `ended`: no marker stood. */
  event: "removed" | "ignored" | "ended";
  why: DeepEnd;
  finding_id: string | null;
  launch_dir: string | null;
  session_id: string | null;
}

export const deepDirOf = (projectDir: string): string => join(projectDir, ".legal", DEEP_FOLDER);
export const deepMarkerPath = (projectDir: string): string => join(deepDirOf(projectDir), DEEP_MARKER_FILE);
export const deepHistoryPath = (projectDir: string): string => join(deepDirOf(projectDir), DEEP_HISTORY_FILE);
/** The marker's path relative to the project, as git and the person name it. */
export const DEEP_MARKER_REL = `.legal/${DEEP_FOLDER}/${DEEP_MARKER_FILE}`;
/** The light check a route's `when` makes, with no module loaded: something stands at the marker's name. */
export const deepMarkerMayStand = (ctx: HookContext): boolean => ctx.run !== null && existsSync(deepMarkerPath(ctx.run.projectDir));
/** Whether the event is a call of, or by, this plugin's deeper-check seat kind. */
export const isDeepChecker = (input: HookInput): boolean => typeof input.agent_id === "string" && input.agent_id !== "" && input.agent_type === DEEP_AGENT_TYPE;
/** Whether the call launches this plugin's deeper-check seat kind (an `Agent` call). */
export const launchesDeepChecker = (input: HookInput): boolean => {
  const ti = input.tool_input;
  return ti !== null && typeof ti === "object" && [DEEP_AGENT_TYPE, DEEP_AGENT_NAME].includes(String((ti as Record<string, unknown>).subagent_type ?? ""));
};

/** The check's folder's time for `at`, to the second, on the person's own clock. */
export function deepCheckTime(at: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}T${p(at.getHours())}-${p(at.getMinutes())}-${p(at.getSeconds())}`;
}

/**
 * Whether git tracks the marker: true, false, or null where git was not run (the caller's runner, legal-dir.ts's way:
 * `ls-files` through child-program.ts `gitRunner`, so that nothing the folder's own git configuration names runs).
 */
export type DeepTracked = (rel: string) => boolean | null;

function appendDeepHistory(projectDir: string, line: Omit<DeepHistoryLine, "v">): void {
  makeFolder(deepDirOf(projectDir), { recursive: true });
  appendFileAt(deepHistoryPath(projectDir), `${JSON.stringify({ v: 1, ...line } satisfies DeepHistoryLine)}\n`);
}

/** Every history line, oldest first; a line that is not one is skipped. */
export function readDeepHistory(projectDir: string): DeepHistoryLine[] {
  const got = readProgramFile("the deeper checks' history", deepHistoryPath(projectDir));
  if (!got.ok) return [];
  const out: DeepHistoryLine[] = [];
  for (const l of got.value.toString("utf8").split("\n")) {
    if (l.trim() === "") continue;
    try {
      const v = JSON.parse(l) as DeepHistoryLine;
      if (v && v.v === 1 && typeof v.why === "string") out.push(v);
    } catch {
      // not a line of this file
    }
  }
  return out;
}

/** The marker's own fields, or null where it is not a marker this program writes. */
function deepMarkerOf(v: unknown): DeepMarker | null {
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  const str = (k: string): boolean => typeof m[k] === "string" && m[k] !== "";
  if (m.v !== 1 || !["finding_id", "session_id", "launch_dir", "started_at", "ends_at"].every(str)) return null;
  if (m.seat !== "plan" && m.seat !== "reading") return null;
  if (!DEEP_ID.test(m.finding_id as string)) return null;
  return m as unknown as DeepMarker;
}

/** Why the marker's own fields do not let this reader use it, or null where they do. */
function deepMarkerFault(m: DeepMarker, projectDir: string, sessionId: string | null, now: Date): DeepEnd | null {
  if (sessionId === null || m.session_id !== sessionId) return "another session's";
  const started = Date.parse(m.started_at);
  const ends = Date.parse(m.ends_at);
  if (!Number.isFinite(started) || !Number.isFinite(ends)) return "unreadable";
  if (started > now.getTime()) return "start time in the future";
  if (ends <= started || ends - started > DEEP_MARKER_LIFE_MS) return "end time beyond 30 minutes";
  const time = basename(dirname(m.launch_dir));
  const own = join(deepDirOf(resolve(projectDir)), m.finding_id, time, "launch");
  if (!isAbsolute(m.launch_dir) || basename(m.launch_dir) !== "launch" || !DEEP_TIME.test(time) || !samePlace(m.launch_dir, own)) return "launch folder elsewhere";
  if (now.getTime() >= ends) return "expired";
  return null;
}

/** Whether two absolute paths name one place: equal as written, or, where both exist, by their real paths (a project named through a link). */
function samePlace(a: string, b: string): boolean {
  if (resolve(a) === resolve(b)) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

export type DeepMarkerRead =
  | { kind: "none" }
  | { kind: "live"; marker: DeepMarker }
  /** Git tracks it: left where it is, and no check starts while it stands (W5). */
  | { kind: "tracked" };

/**
 * The marker this reader may use, for `sessionId` at `now`. A marker it may not use is removed with its history line
 * (`another session's`, `expired`, ...), except one git tracks, which is left in place and named in the history line.
 */
export function readDeepMarker(projectDir: string, sessionId: string | null, now: Date, tracked: DeepTracked): DeepMarkerRead {
  const path = deepMarkerPath(projectDir);
  if (!standsAt(path)) return { kind: "none" };
  const at = now.toISOString();
  if (tracked(DEEP_MARKER_REL) === true) {
    appendDeepHistory(projectDir, { at, event: "ignored", why: "ignored: tracked by git", finding_id: null, launch_dir: null, session_id: sessionId });
    return { kind: "tracked" };
  }
  const marker = markerAt(path);
  const fault: DeepEnd | null = marker === null ? "unreadable" : deepMarkerFault(marker, projectDir, sessionId, now);
  if (fault === null && marker !== null) return { kind: "live", marker };
  removeDeepMarker(projectDir);
  appendDeepHistory(projectDir, { at, event: "removed", why: fault ?? "unreadable", finding_id: marker?.finding_id ?? null, launch_dir: marker?.launch_dir ?? null, session_id: marker?.session_id ?? null });
  return { kind: "none" };
}

/** Whether anything stands at `path`, a link included (not followed). */
function standsAt(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** The marker at `path` read as a regular file of this user's, or null. */
function markerAt(path: string): DeepMarker | null {
  const got = readProgramFile("the deeper check's marker", path);
  if (!got.ok) return null;
  try {
    return deepMarkerOf(JSON.parse(got.value.toString("utf8")));
  } catch {
    return null;
  }
}

function removeDeepMarker(projectDir: string): void {
  try {
    removeFile(deepMarkerPath(projectDir));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

/** The refusal `deepen` gives while a tracked marker stands (crf11d-r2 W5; design 3.9). */
export const DEEP_TRACKED_REFUSAL =
  `No deeper check can start in this folder: the repository commits ${DEEP_MARKER_REL}, and WolfBoy never changes a file git tracks. ` +
  `Removing it from git in your own terminal (${toldArgs(["git", "rm", DEEP_MARKER_REL])}) lets a check start.`;

/** Where no check may start in this folder now, the sentence that says why; null where one may. Reads the marker as every reader does. */
export function deepStartRefusal(projectDir: string, sessionId: string | null, now: Date, tracked: DeepTracked): string | null {
  return readDeepMarker(projectDir, sessionId, now, tracked).kind === "tracked" ? DEEP_TRACKED_REFUSAL : null;
}

/**
 * Write the marker for one pending seat, replacing a marker of this program's that stands (the plan's, when the reading
 * is launched); never one git tracks, which is refused. Returns the marker written.
 */
export function writeDeepMarker(
  projectDir: string,
  m: { finding_id: string; session_id: string; launch_dir: string; seat: DeepSeat },
  at: Date,
  tracked: DeepTracked,
): { ok: true; marker: DeepMarker } | { ok: false; why: string } {
  if (tracked(DEEP_MARKER_REL) === true) return { ok: false, why: DEEP_TRACKED_REFUSAL };
  if (!DEEP_ID.test(m.finding_id)) return { ok: false, why: `"${m.finding_id}" is not a finding id a check's folder may take` };
  const marker: DeepMarker = { v: 1, ...m, started_at: at.toISOString(), ends_at: new Date(at.getTime() + DEEP_MARKER_LIFE_MS).toISOString() };
  const fault = deepMarkerFault(marker, projectDir, m.session_id, at);
  if (fault !== null) return { ok: false, why: `the marker would not be read back (${fault})` };
  makeFolder(deepDirOf(projectDir), { recursive: true });
  writeFileAt(deepMarkerPath(projectDir), `${JSON.stringify(marker)}\n`);
  return { ok: true, marker };
}

/**
 * End the check's pending seat: remove the marker (where one stands and git does not track it) and write the history
 * line. Every exit that ends a check calls it, and so do the commands that take a seat's answer (`answer taken`).
 * Where no marker stands, the line is still written for a check's end (`event: "ended"`), so that every end has one,
 * in a project that has a `.legal/deep` (none is made for it). Returns whether a marker was removed.
 */
export function endDeepCheck(projectDir: string, why: DeepEnd, at: Date, tracked: DeepTracked, sessionId: string | null = null): boolean {
  const path = deepMarkerPath(projectDir);
  const present = standsAt(path);
  if (present && tracked(DEEP_MARKER_REL) === true) {
    appendDeepHistory(projectDir, { at: at.toISOString(), event: "ignored", why: "ignored: tracked by git", finding_id: null, launch_dir: null, session_id: sessionId });
    return false;
  }
  if (!present && !existsSync(deepDirOf(projectDir))) return false;
  const marker = present ? markerAt(path) : null;
  if (present) removeDeepMarker(projectDir);
  appendDeepHistory(projectDir, {
    at: at.toISOString(),
    event: present ? "removed" : "ended",
    why,
    finding_id: marker?.finding_id ?? null,
    launch_dir: marker?.launch_dir ?? null,
    session_id: marker?.session_id ?? sessionId,
  });
  return present;
}

/**
 * Whether a run's declaration may be under way in this project: the declaration ledger
 * was written no earlier than the active-run history (the last run's end), or there is no history. The entry's light
 * check for the write guard's rows, two `stat` calls: the declaration is read before the active-run marker is written
 * (by the scan and the pre-launch step), so the guard acts from every scan in a session (its `scan-started` line,
 * written whether or not the scan asks anything), not only while the marker stands. The guard decides
 * from the lines themselves (hook-guard.ts): the ledger's last scan or round later than the last run's end, in the
 * session it names. Both files are refused to a tool call while the window is open (a `touch` of the
 * history made this check false and so turned the guard off), so a write the guard reads cannot end the window early.
 */
/**
 * The launch-shell route's light check, without loading its module - a Bash command that may start Claude Code
 * (hook-launch.ts `startsClaudeCode` decides), so that a failure of the route refuses only such a command while the run's
 * marker stands, and every other Bash call fails open, as the write guard's route does. A superset of what the gate
 * refuses: the word `claude` or `session` anywhere, quotation marks and backslashes taken out, or a command it cannot read. The gate's own check names Claude Code as a program (a word or a path's last part `claude`, its install
 * path `claude/versions/<version>`, its package `@anthropic-ai/claude-code`), never the letters inside another word or
 * path part; each of those holds the letters, so this letters rule stays its superset. Only where the module fails does
 * it also refuse a command whose paths merely hold the letters (an installed plugin's root under `~/.claude/`, Claude
 * Code's temporary folder). After `legal-scan run-abort` ends a scan that never reached a run, the ledger is newer than
 * the history, so `declarationMayBeUnderWay` stays true and the route's own check (`scanClosedEnds`) decides.
 */
const mayStartClaudeCode = (ctx: HookContext): boolean => {
  const ti = ctx.input.tool_input;
  const command = ti && typeof ti === "object" ? (ti as Record<string, unknown>).command : undefined;
  return typeof command !== "string" || /claude|session/i.test(command.replace(/["'\\]/g, ""));
};

/** The calls that can submit a prompt to the session, gated from the scan's start (hook-launch.ts `deliveryBeforeTheRun`). */
const PROMPT_CARRIERS: readonly string[] = ["SendMessage", "ScheduleWakeup", "CronCreate"];

export const declarationMayBeUnderWay = (ctx: HookContext): boolean => {
  if (ctx.run === null) return false;
  let ledger: number;
  try {
    ledger = statSync(launchRecordPath(ctx.run.launchDir, DECLARATION_LEDGER_FILE)).mtimeMs;
  } catch {
    return false;
  }
  try {
    // A history touched in the future (an archive extracted with its times kept, a clock
    // set ahead) says nothing about the last run's end: the routes' own checks decide (hook-launch.ts `latestRunEndAt`).
    const history = statSync(launchRecordPath(ctx.run.launchDir, ACTIVE_RUN_HISTORY_FILE)).mtimeMs;
    return ledger >= history || history > Date.now();
  } catch {
    return true;
  }
};

/** The tools of a seat the seat-read route checks (Read, Grep and Glob). */
export const SEAT_READ_TOOLS: readonly string[] = ["Read", "Grep", "Glob"];

/** A glob pattern's wildcard characters, as ripgrep's globs read them. */
const GLOB_WILDCARD = /[*?[\]{}]/;
/** A `.legal` folder a glob pattern names: a whole component, in any case, or an item of a brace list. */
const PATTERN_NAMES_LEGAL = /(^|[/{,])\.legal($|[/},])/i;

/**
 * The folders a glob pattern names before its first component with a wildcard (`.legal/verdicts/*.json` gives
 * `.legal/verdicts`, `**` + `/*.json` gives ""); a pattern with no wildcard names one path, all of it.
 */
export function patternLead(pattern: string): string {
  if (!GLOB_WILDCARD.test(pattern)) return pattern;
  const parts = pattern.split("/");
  const lead: string[] = [];
  for (const part of parts.slice(0, -1)) {
    if (GLOB_WILDCARD.test(part)) break;
    lead.push(part);
  }
  return lead.join("/");
}

/**
 * What a seat's Read, Grep or Glob reaches, as the seat-read route and its fail-closed check read it:
 * - `searched`: the path the call names (Read's `file_path`; Grep's and Glob's `path`, the event's working folder where
 *   none is given), and, for a pattern (Glob's `pattern`, Grep's `glob`), that path joined to the pattern's leading
 *   folders (for a Grep, each piece of its glob that takes files in, `grepGlobPieces`); each as text and, where it
 *   exists, as the file system resolves it;
 * - `inLegal`: one of them lies under the run's `.legal` (as text, or as the file system resolves `.legal`; in any
 *   case, since a file system that ignores case reaches the same files), or the pattern names a `.legal` folder (a
 *   Grep's: a piece that takes files in; a `!` piece leaves files out and reaches nothing);
 * - `file`: the path of a Read, or of a Grep that gives a path and no glob, which may be a file a launch entry names
 *   (as text and resolved); null for a Glob and for a Grep with a glob, which can never be "that file".
 * - `legalBelow`: for a Grep of a folder that holds the run's `.legal` below it, that `.legal` as a
 *   path relative to the folder (`.legal` for a search of the project), with `/` between its parts; null otherwise;
 * - `legalExact`: `legalBelow` is spelled, name by
 *   name, as the folder's own listing spells it, so a glob piece anchored at the folder matches the names ripgrep lists;
 *   false where only a file system that ignores case finds `.legal` below the folder, or where the path is spelled
 *   otherwise on disk (another case, a short name), and the piece must then name `.legal` alone;
 * - `admits`: the Grep's glob has a piece that takes files in (grepGlobPieces), which ripgrep lets past `.legal/.ignore`.
 * Null for a call that names no path the route can read (a Read without `file_path`).
 */
export interface SeatReach {
  tool: string;
  target: string;
  searched: string[];
  file: string[] | null;
  inLegal: boolean;
  legalBelow: string | null;
  legalExact: boolean;
  admits: boolean;
}

/**
 * The pieces Claude Code's Grep makes of its `glob` (2.1.285: split at whitespace; a piece that holds both `{` and `}`
 * is kept whole, any other is split at commas), each passed to ripgrep as one `--glob`. A piece that does not start
 * with `!` takes files in, and ripgrep's globs override its ignore files: `.legal/.ignore` then hides only the folders
 * below `.legal` that no piece matches, so `*.json` reaches `.legal/findings.json` and `*` reaches every file under
 * `.legal`.
 */
export function grepGlobPieces(glob: string): string[] {
  return glob.split(/\s+/).flatMap((p) => (p.includes("{") && p.includes("}") ? [p] : p.split(","))).filter((p) => p !== "");
}

/** The shell's variable for the home folder: the hooks read a leading `~` of a path as its value (`homePath`). */
export const HOME_ENV = "HOME";

/**
 * THE ONE PATH NORMALISER OF THE HOOKS' PATH CHECKS.
 * A path as a tool call names it, with a leading `~` - alone or before
 * `/` - read as the home folder, as Claude Code 2.1.284's own path helper reads it for its tools and bash reads it in a
 * command; before this, the seat-read route (`seatReach`) and the write guard's Write/Edit route read `~/p/.legal/...`
 * as a folder named `~` under the working folder, and let it through. Every other path is returned as it is, so each
 * check keeps its own resolution: the seat-read route `resolve` from the event's cwd and realpath, the write guard
 * `kernelPath`. `~user`, `~+` and `~-` are not read (GUARD_BASH_LIMITS); with no home folder known nothing changes.
 * Every hook path check goes through it: `seatReach` (Read's `file_path`, Grep's and Glob's `path` and a pattern's
 * lead), the write guard's Write, Edit, MultiEdit and NotebookEdit target (`onFileWrite`) and every Bash word it reads
 * (`expand`).
 */
export function homePath(named: string, home: string | undefined): string {
  return home && (named === "~" || named.startsWith("~/")) ? home + named.slice(1) : named;
}

/*
 * THE GUARD ROWS FAIL CLOSED
 * (the rule the other refusing routes already follow). guard-file-write and
 * guard-key-read act in every session and load hook-guard.js, whose start-up graph is some 67 modules: where one is
 * missing or throws, the rows could not decide, and a call they refuse went ahead. Their `failClosed` is this light
 * check, made in the entry with no module of the guard's: a file-tool call whose target COULD be a guarded one is
 * refused while the guard cannot run. Could be: a path (or a Glob's pattern, a Grep's glob) one of whose parts, in any
 * spelling (Unicode-folded, case-folded, backslashes made slashes, trailing dots and spaces and an NTFS stream suffix
 * dropped, an 8.3 short name or a wildcard that may stand for one of them), is the state folder's name (legal-scan),
 * `.legal` or the spare key folder's name (wolfboy-redaction-key), as named and as the file system resolves it: the real
 * path (`realpathSync.native`) of the nearest folder of the target that exists, with the names below it, so a link a
 * repository commits (`st -> ~/.local/state/legal-scan`, a folder below it not made yet) is followed; for Grep and Glob also a folder at or above the
 * state folder, the spare key folder or the project's `.legal` (no path: the working folder, which holds `.legal`),
 * the folder and a pattern's folders before its first wildcard resolved the same way. A call with none of these goes
 * ahead as before. It refuses more than the guard in places (a project folder whose own path holds `.legal`, any file
 * of a `.legal` outside its record folders). It refuses less in these, which the guard's rows refuse: a Write into the
 * session's transcript folder or a `.git` at or above a protected folder (no guarded name on the path); a path the
 * deeper checks' rows name (their test names); a hard link to the redaction key under another name (a command makes
 * one); a Windows spelling whose names are none of the three and not short names (none is known: FR6 and FR8 found
 * every such spelling resolved to a guarded name by `realpathSync.native`, or not opened). The shim (plugin
 * bin/legal-hook) asks the same where the entry itself cannot start, of the event's text and, where a node runs, of the
 * target's real path the same way.
 */
/** Exported for the generator of the shim's bin/fast-places.bash (npm run gen:fast-places). */
export const GUARDED_NAMES: readonly string[] = [STATE_APP_DIR, ".legal", SPARE_KEY_FOLDER];
const FILE_GUARD_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit", "Read", "Grep", "Glob"];
/** One path in the form the check compares: Unicode- and case-folded, `/` for `\`, runs of `/` as one. */
const guardForm = (p: string): string => p.normalize("NFKC").toLowerCase().replace(/\\/g, "/").replace(/\/{2,}/g, "/");
/** Whether one part of a path may name a guarded folder. */
function partMayBeGuarded(raw: string): boolean {
  const part = raw.replace(/:.*$/, "").replace(/[. ]+$/, (m) => (raw.startsWith(".") && m.length === raw.length ? m : ""));
  if (part === "") return false;
  if (/~\d/.test(part)) return true;
  if (/[*?[{]/.test(part)) {
    let re = "";
    for (const c of part) re += c === "*" ? ".*" : c === "?" ? "." : /[[\]{}]/.test(c) ? "." : c.replace(/[.+^$()|\\]/g, "\\$&");
    try {
      const x = new RegExp(`^${re}$`);
      return GUARDED_NAMES.some((n) => x.test(n) || x.test(`${n}-0`));
    } catch {
      return true;
    }
  }
  return part === "legal-scan" || part === ".legal" || part.startsWith("wolfboy-redaction-key");
}
const namesGuarded = (p: string): boolean => guardForm(p).split("/").some(partMayBeGuarded);
/** Whether `dir` (in guardForm) is `place` or a folder above it. */
const atOrAbove = (dir: string, place: string): boolean => {
  const d = dir.replace(/\/+$/, "");
  return place === d || place.startsWith(`${d}/`) || d === "";
};
/**
 * `p` as the file system resolves it, where only its first part may exist: the real path (`realpathSync.native`, links
 * and `..` read as the kernel reads them) of its nearest existing folder, with the names below it; null where nothing
 * of it resolves. Node's own `fs` only.
 */
/** The longest path, pattern or glob `guardTargetMayBe` reads (characters). */
export const GUARD_TEXT_LIMIT = 8192;
/** The most pieces of a Grep's glob `guardTargetMayBe` reads. */
export const GUARD_LEAD_LIMIT = 64;

export function nearestReal(p: string): string | null {
  const below: string[] = [];
  let at = p;
  for (let n = 0; n < 4096; n++) {
    try {
      const r = realpathSync.native(at);
      return below.length === 0 ? r : join(r, ...below);
    } catch {
      const up = dirname(at);
      if (up === at) return null;
      below.unshift(basename(at));
      at = up;
    }
  }
  return null;
}
/**
 * For the fail-closed checks, which do not load
 * hook-guard.ts: the other readings of a file tool's path (hook-guard.ts `otherReadings`) as far as they are known
 * here, or null where they are not. On macOS and Linux a path with a `..` name after a link, read by its text too
 * (file-identity.ts `dotDotReadings`). On Windows a path rooted on no drive (`/c/<path>`, `/tmp/...`) may be a Git Bash
 * spelling of a path on another drive (hook-guard.ts `gitBashPath`), which is not read here: null.
 */
export function failClosedReadings(p: string, cwd: string): string[] | null {
  if (process.platform === "win32") return /^[\\/](?![\\/])/.test(p) ? null : [];
  return dotDotReadings(p, cwd);
}
export function guardTargetMayBe(ctx: HookContext): boolean {
  const tool = String(ctx.input.tool_name ?? "");
  if (!FILE_GUARD_TOOLS.includes(tool)) return false;
  const ti = (typeof ctx.input.tool_input === "object" && ctx.input.tool_input !== null ? ctx.input.tool_input : {}) as Record<string, unknown>;
  const text = (v: unknown): string => (typeof v === "string" ? v : "");
  const home = process.env[HOME_ENV] ?? "";
  const cwd = typeof ctx.input.cwd === "string" && isAbsolute(ctx.input.cwd) ? ctx.input.cwd : (ctx.run?.projectDir ?? process.cwd());
  // Not normalised by text: `..` after a link is read by the file system, as the kernel reads it (`nearestReal`).
  const abs = (p: string): string => {
    const h = homePath(p, home);
    return isAbsolute(h) || /^[A-Za-z]:[\\/]/.test(h) || h.startsWith("\\\\") ? h : `${cwd.replace(/[\\/]+$/, "")}${sep}${h}`;
  };
  const real = (p: string): string | null => {
    try {
      return realpathSync(p);
    } catch {
      return null;
    }
  };
  const named = tool === "NotebookEdit" ? text(ti.notebook_path) : tool === "Grep" || tool === "Glob" ? text(ti.path) : text(ti.file_path);
  const paths = [named, ...(tool === "Glob" ? [text(ti.pattern)] : []), ...(tool === "Grep" ? [text(ti.glob)] : [])].filter((p) => p !== "");
  // Held without being read, where reading
  // it could keep this thread, and so the entry's deadline timers, past Claude Code's time-out: a path, pattern or glob
  // longer than GUARD_TEXT_LIMIT characters, or a glob of more than GUARD_LEAD_LIMIT pieces (each piece's folder is
  // looked up; 100,000 of them took 4 s, and the time grows with their number and length). No path a tool opens is that
  // long on Linux or macOS (4,096 and 1,024 bytes), and the guard route itself still decides the call.
  if (paths.some((p) => p.length > GUARD_TEXT_LIMIT)) return true;
  if (tool === "Grep" && grepGlobPieces(text(ti.glob)).length > GUARD_LEAD_LIMIT) return true;
  if (paths.some(namesGuarded)) return true;
  const target = named === "" ? cwd : abs(named);
  // The path's other readings, where the tool may open another file than the kernel's.
  const others = failClosedReadings(target, cwd);
  if (others === null) return true;
  const searches = tool === "Grep" || tool === "Glob";
  // Each path as the file system resolves it, through its nearest existing
  // folder: a file not written yet, in a folder not made yet, below a link a commit planted. A search's folder, and the
  // folders a Glob's pattern or a Grep's glob names before its first wildcard, the same way.
  const leads = tool === "Glob" ? [text(ti.pattern)] : tool === "Grep" ? grepGlobPieces(text(ti.glob)).filter((p) => !p.startsWith("!")) : [];
  const under = leads.map(patternLead).filter((l) => l !== "").map((l) => (isAbsolute(l) ? l : `${target.replace(/[\\/]+$/, "")}${sep}${l}`));
  const seen = [target, ...others, ...[target, ...others, ...under].map(nearestReal)].filter((p): p is string => p !== null);
  if (seen.some(namesGuarded)) return true;
  if (tool === "Glob" && text(ti.pattern) !== "" && namesGuarded(resolve(target, text(ti.pattern)))) return true;
  if (!searches) return false;
  const places = [join(cwd, ".legal"), ...(ctx.run?.projectDir ? [join(ctx.run.projectDir, ".legal")] : []), join(tmpdir(), SPARE_KEY_FOLDER)];
  for (const d of [processStateDir(), accountStateDir(process.platform, accountHomeNow()), anchorStateDir()]) if (d) places.push(join(d, STATE_APP_DIR));
  const forms = places.flatMap((p) => [p, real(p)]).filter((p): p is string => p !== null).map(guardForm);
  return seen.map(guardForm).some((d) => forms.some((p) => atOrAbove(d, p)));
}

export function seatReach(ctx: HookContext): SeatReach | null {
  const run = ctx.run;
  const tool = ctx.input.tool_name;
  if (!run || typeof tool !== "string" || !SEAT_READ_TOOLS.includes(tool)) return null;
  const input = (typeof ctx.input.tool_input === "object" && ctx.input.tool_input !== null ? ctx.input.tool_input : {}) as Record<string, unknown>;
  const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
  const base = typeof ctx.input.cwd === "string" && isAbsolute(ctx.input.cwd) ? ctx.input.cwd : run.projectDir;
  const both = (p: string): string[] => {
    try {
      const real = realpathSync(p);
      return real === p ? [p] : [p, real];
    } catch {
      return [p];
    }
  };
  let named: string | null;
  let pattern: string | null;
  if (tool === "Read") {
    named = text(input.file_path);
    if (named === null) return null;
    pattern = null;
  } else {
    named = text(input.path);
    pattern = text(tool === "Glob" ? input.pattern : input.glob);
  }
  const home = process.env[HOME_ENV];
  const at = resolve(base, homePath(named ?? ".", home));
  const searched = both(at);
  // What a pattern reaches is decided from the pieces
  // ripgrep is given, not from its text: a Grep's glob is split as Claude Code splits it (`grepGlobPieces`), and only a piece
  // that takes files in can reach `.legal`. A `!` piece only leaves files out, so `!{node_modules,.legal}/**` excludes
  // `.legal` and reaches nothing: seats' searches written so were refused in the runs of 2026-10-26/27. A Glob's pattern is one piece, read as written.
  const reaching = pattern === null ? [] : tool === "Grep" ? grepGlobPieces(pattern).filter((p) => !p.startsWith("!")) : [pattern];
  for (const piece of reaching) {
    const lead = patternLead(piece);
    if (lead !== "") searched.push(...both(resolve(at, homePath(lead, home))));
  }
  const legals = [resolve(run.legalDir), ...both(resolve(run.legalDir)).slice(1)].map((l) => l.toLowerCase());
  const underLegal = (p: string): boolean =>
    legals.some((l) => {
      const rel = relativePath(l, p.toLowerCase());
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    });
  // And by identity (file-identity.ts `atOrInside`): every spelling of a path
  // that opens a file under the run's `.legal` (on Windows `C:/`, `\\?\`, a short name, a trailing dot, a stream suffix).
  const legalPlace = locate(run.legalDir, base);
  const inLegal = searched.some((p) => underLegal(p) || atOrInside(locate(p, base), legalPlace)) || reaching.some((p) => PATTERN_NAMES_LEGAL.test(p));
  const file = tool === "Read" || (tool === "Grep" && named !== null && pattern === null) ? both(at) : null;
  // The run's `.legal` below the folder a Grep searches: as the file system resolves both first, since
  // ripgrep walks the folder it opened; where only a file system that ignores case says so, by its name alone. The path
  // is exact (`legalExact`) only where the folder's listing spells each of its names so: ripgrep matches
  // a glob piece against the names it lists, and a name spelled otherwise on disk would let the anchored piece miss.
  let legalBelow: string | null = null;
  let legalExact = false;
  if (tool === "Grep") {
    const below = (from: string, to: string): string | null => {
      const rel = relativePath(from, to);
      return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel) ? rel : null;
    };
    const listed = (from: string, rel: string): boolean => {
      let dir = from;
      for (const name of rel.split("/")) {
        try {
          if (!readdirSync(dir).includes(name)) return false;
        } catch {
          return false;
        }
        dir = join(dir, name);
      }
      return true;
    };
    const folders = both(at).reverse();
    const legalPaths = both(resolve(run.legalDir)).reverse();
    for (const f of folders) {
      for (const l of legalPaths) {
        const rel = below(f, l);
        if (rel === null || legalExact) continue;
        if (listed(f, rel)) [legalBelow, legalExact] = [rel, true];
        else legalBelow ??= rel;
      }
    }
    if (legalBelow === null && folders.some((f) => legals.some((l) => below(f.toLowerCase(), l) !== null))) legalBelow = basename(run.legalDir);
    if (legalBelow === null && atOrInside(legalPlace, locate(at, base))) legalBelow = basename(run.legalDir);
  }
  const admits = tool === "Grep" && pattern !== null && grepGlobPieces(pattern).some((p) => !p.startsWith("!"));
  return { tool, target: [named ?? "(the working folder)", ...(pattern === null ? [] : [`pattern ${pattern}`])].join(", "), searched, file, inLegal, legalBelow, legalExact, admits };
}

/**
 * Whether a seat's Read, Grep or Glob must be refused if the seat-read route fails:
 * a run's marker stands and the call reaches under the run's `.legal` (seatReach), where the program
 * writes every file the launch list names that it wrote and every record of the run; and a Grep of
 * a folder that holds the run's `.legal` with a glob that takes files in, which reaches under `.legal` unless the
 * route leaves it out. Decided without the route's module; every other call fails open.
 */
export const seatReadFailsClosed = (ctx: HookContext): boolean => {
  if (!ctx.run || !runMarkerStands(ctx)) return false;
  const holds = (c: HookContext): boolean => {
    const reach = seatReach(c);
    return reach !== null && (reach.inLegal || (reach.legalBelow !== null && reach.admits));
  };
  if (holds(ctx)) return true;
  // And on each other reading of the path (`failClosedReadings`), as the route does.
  const field = ctx.input.tool_name === "Read" ? "file_path" : "path";
  const ti = (typeof ctx.input.tool_input === "object" && ctx.input.tool_input !== null ? ctx.input.tool_input : {}) as Record<string, unknown>;
  const named = ti[field];
  if (typeof named !== "string" || named === "") return false;
  const base = typeof ctx.input.cwd === "string" && isAbsolute(ctx.input.cwd) ? ctx.input.cwd : ctx.run.projectDir;
  const others = failClosedReadings(homePath(named, process.env[HOME_ENV]), base);
  return others === null || others.some((p) => holds({ ...ctx, input: { ...ctx.input, tool_input: { ...ti, [field]: p } } }));
};

/**
 * A gate route of relay item 4 (hook-launch.ts). A route that throws lets the call through, so while a scan
 * run is active a gate module that cannot load refuses the call instead.
 */
function launchGateRoute(name: "gateLaunch" | "gateDelivery" | "gateShell"): HookRoute["run"] {
  return async (ctx) => {
    let gate: (c: HookContext) => Promise<HookDecision>;
    try {
      gate = (await import("./hook-launch.js"))[name];
    } catch (e) {
      // The Bash route refuses on a failure only a command that may start Claude Code; any other Bash call
      // fails open, as the write guard's route does (relay-question N5d+).
      if (!ctx.run || !runMarkerStands(ctx) || (name === "gateShell" && !mayStartClaudeCode(ctx))) throw e;
      const why = valueText(e instanceof Error ? e.message : String(e));
      return {
        kind: "deny",
        reason: `wolfboy launch gate: the gate could not be loaded (${why}), so no ${String(ctx.input.tool_name ?? "such")} call goes ahead while a scan run is active. To end the run: ${scannerCommand(["run-abort", "--launch-dir", ctx.run.launchDir])}`,
      };
    }
    return gate(ctx);
  };
}

/**
 * The route table. Relay units add their routes here; with none, every event passes. A route's `run`
 * imports the module that does the work (`await import("./<module>.js")`) so that the entry stays light
 * for every event the route does not match. Routes for one event run in table order and each sees the
 * decision taken so far (`prior`): a route that counts stopped seats and runs after the capture sees a
 * `block` there, which means the seat did not stop. The first decision other than `pass` is the one printed.
 */
/** The pre-launch step's flag that sets the run shape outside Claude Code (index.ts); hook-question.ts imports it. */
export const SHAPE_FLAG = "--shape";
/**
 * The pre-launch step's flag that names an earlier run's log outside Claude Code
 * (index.ts); inside a session the log is the person's answer to the program's earlier-run question. The same word rule
 * as SHAPE_FLAG refuses it (hook-question.ts `passesPreviousFlag`), so a Bash command that removes the session signs
 * cannot carry a log without that answer.
 */
export const PREVIOUS_FLAG = "--previous";
/**
 * Whether a Bash call's command could name SHAPE_FLAG or PREVIOUS_FLAG as hook-question.ts reads it (`shellCommands`,
 * which may be the module that failed): its text, with backslashes, quotes, `$` and new lines removed, names either
 * flag; or it holds a backslash and, with backslashes, double quotes and new lines removed, a `$'`, since the escapes of
 * `$'...'` can spell any character. Within a word, at any depth, that reading only removes those characters or
 * decodes `$'...'`, so this holds wherever the route can refuse.
 */
const mentionsShapeFlag = (input: unknown): boolean => {
  const command = typeof input === "object" && input !== null ? (input as { command?: unknown }).command : undefined;
  if (typeof command !== "string") return false;
  const plain = command.replace(/[\\'"$\n]/g, "");
  if (plain.includes(SHAPE_FLAG) || plain.includes(PREVIOUS_FLAG)) return true;
  return command.includes("\\") && command.replace(/[\\"\n]/g, "").includes("$'");
};

/**
 * The capture's decision with the message at a tenth of the review added where a return reached one
 * (hook-launch.ts `withTenthMessage`). The capture runs first and its decision always stands: where the message's module
 * cannot be loaded or throws, the failure is recorded and the decision goes out as the capture made it.
 */
async function withTenth(ctx: HookContext, decision: HookDecision): Promise<HookDecision> {
  try {
    return await (await import("./hook-launch.js")).withTenthMessage(ctx, decision);
  } catch (e) {
    recordHookFailure(ctx.run, ctx.input, { stage: "tenth-message", error: messageOf(e) }, ctx.now());
    return decision;
  }
}

/**
 * The tools that run a shell command, each with the command in
 * `tool_input.command` (Claude Code's tools reference): Bash; PowerShell, on Windows and wherever the person turns it on
 * ("Match `Bash|PowerShell` in hooks that inspect shell commands"); and Monitor, which runs a command in the background
 * under Bash's permission rules (a WebSocket watch takes `ws` in place of `command` and runs none). Every route that
 * reads a shell command matches all three, and the plugin's group for them is `Bash|PowerShell|Monitor` (hooks.json).
 */
export const SHELL_TOOLS: readonly string[] = ["Bash", "PowerShell", "Monitor"];
/**
 * (crf11d-r2 W4) The code tool Claude Code's VS Code extension provides without the person
 * adding anything ("Execute python code in the Jupyter kernel for the current notebook file"); its input is `code`.
 * The plugin's command group matches it beside the three shell tools (`Bash|PowerShell|Monitor|mcp__ide__executeCode`).
 */
export const IDE_CODE_TOOL = "mcp__ide__executeCode";

export const ROUTES: HookRoute[] = [
  // Integration: the question rows come first. A refusing route's
  // deadline (HOOK_ROUTE_DEADLINE_MS) counts from the route's own start, so no route for the same event (Bash:
  // guard-bash, launch-seat-call) may run before it and push its refusal past HOOK_PROCESS_DEADLINE_MS.
  // Relay item 4, question side (hook-question.ts): the orchestrator's AskUserQuestion checked, character by
  // character, against the program's question and passed as it is (no input is put in
  // its place), the person's answer written from PostToolUse, and the program's `adjudicate --shape` refused.
  // The two refusing routes fail closed: question:relay while a run's marker stands, question:shape-flag where the
  // command names --shape or --previous. question:relay refuses a look-alike of the run-shape question only while the event belongs
  // to the active run (integration part B item 3); the program's own question is checked and recorded whenever it comes.
  {
    name: "question:relay",
    event: "PreToolUse",
    tools: ["AskUserQuestion"],
    who: ["main"],
    // Also while a round of declaration questions is on disk (relay item 7): the scan writes it before any run marker. The round is a record in the state folder since S1+S2, where the scan
    // writes it; a place that cannot be named fails closed too.
    failClosed: (ctx) => runMarkerStands(ctx) || (ctx.run !== null && declarationRoundOnRecord(ctx.run.launchDir)),
    run: async (ctx) => {
      const launch = await import("./hook-launch.js");
      return (await import("./hook-question.js")).questionPre(ctx, launch.eventInActiveRun, launch.latestRunEndAt);
    },
  },
  { name: "question:answer", event: "PostToolUse", tools: ["AskUserQuestion"], who: ["main"], run: async (ctx) => (await import("./hook-question.js")).questionPost(ctx) },
  {
    name: "question:shape-flag",
    event: "PreToolUse",
    tools: SHELL_TOOLS,
    who: ["main", "seat", "relay", "internal", "other"],
    // `when` is the same light check: it holds wherever the route can refuse
    // (mentionsShapeFlag's own contract), so a Bash call that names neither flag no longer loads hook-question.js.
    when: (ctx) => mentionsShapeFlag(ctx.input.tool_input),
    failClosed: (ctx) => mentionsShapeFlag(ctx.input.tool_input),
    run: async (ctx) => (await import("./hook-question.js")).shapeFlagPre(ctx),
  },
  // Relay item 3, milestone 2: a seat's answer, taken where Claude Code hands it over (probe fact (b)). Where a seat's return carries the review past a tenth of its places, the decision also carries the
  // message at that tenth (hook-launch.ts `withTenthMessage`; never a refusal, and never in the way of the capture).
  {
    name: "capture-handback",
    event: "PreToolUse",
    tools: ["SubagentHandback"],
    who: ["seat"],
    begun: true,
    continues: "refuse",
    ownLimitMs: CAPTURE_HANDBACK_LIMIT_MS,
    // A decision its entry is no longer there to deliver sends no tenth message (it would be recorded as sent).
    run: async (ctx) => {
      const d = await (await import("./hook-capture.js")).onHandback(ctx);
      return ctx.entryGone?.() ? d : withTenth(ctx, d);
    },
  },
  {
    name: "capture-stop",
    event: "SubagentStop",
    who: ["seat"],
    begun: true,
    continues: "go-ahead",
    ownLimitMs: CAPTURE_STOP_LIMIT_MS,
    // A decision its entry is no longer there to deliver sends no tenth message (it would be recorded as sent).
    run: async (ctx) => {
      const d = await (await import("./hook-capture.js")).onSubagentStop(ctx);
      return ctx.entryGone?.() ? d : withTenth(ctx, d);
    },
  },
  // (design rf13 3.9, "The check's own run") THE DEEPER CHECK'S SEAT, `legal-deep-checker`:
  // its launch, binding and answer go through the check's own launch folder and marker (hook.ts `readDeepMarker`,
  // hook-capture.ts `onDeepLaunch` ...), never the scan's. It is not one of SEAT_AGENT_TYPES, so no scan route takes it for
  // a seat. A launch of it fails closed (it costs a seat's price and is refused unless the check's entry names it); its
  // answer's routes act only where the check's marker may stand, and fail open, like every capture: nothing is then taken.
  { name: "deep-launch", event: "PreToolUse", tools: ["Agent"], who: ["main", "seat", "relay", "internal", "other"], when: (ctx) => launchesDeepChecker(ctx.input), failClosed: (ctx) => launchesDeepChecker(ctx.input), run: async (ctx) => (await import("./hook-capture.js")).onDeepLaunch(ctx) },
  { name: "deep-bind", event: "PostToolUse", tools: ["Agent"], who: ["main", "seat", "relay", "internal", "other"], when: (ctx) => launchesDeepChecker(ctx.input) && deepMarkerMayStand(ctx), run: async (ctx) => (await import("./hook-capture.js")).onDeepLaunched(ctx) },
  { name: "deep-capture-handback", event: "PreToolUse", tools: ["SubagentHandback"], who: ["other"], when: (ctx) => isDeepChecker(ctx.input) && deepMarkerMayStand(ctx), run: async (ctx) => (await import("./hook-capture.js")).onDeepHandback(ctx) },
  { name: "deep-capture-stop", event: "SubagentStop", who: ["other"], when: (ctx) => isDeepChecker(ctx.input) && deepMarkerMayStand(ctx), run: async (ctx) => (await import("./hook-capture.js")).onDeepStop(ctx) },
  // The relay's hand-back is refused while any listed seat is outstanding, since
  // the host delivers one hand-back only and the trial's relay handed back before its seats had answered. The relay is
  // in no other capture or counting route (condition 3). Fails open by design: a failure lets the hand-back through, the
  // main session is woken, and SKILL.md step 4 has it launch from launch-next as before (a lost saving, not a lost seat).
  { name: "relay-handback", event: "PreToolUse", tools: ["SubagentHandback"], who: ["relay"], when: runMarkerStands, run: async (ctx) => (await import("./hook-launch.js")).relayHandback(ctx) },
  // Milestone 4: no tool call writes into the run's record directories, whoever makes it, while the event belongs to
  // the active run (integration part B item 3: `when` here, the session in the guard): a person's own later session
  // is never refused. The declaration's files too, and the
  // files that decide these windows, from every scan in the session to the run's end (declarationMayBeUnderWay here, the
  // lines and the session in the guard). (design rf11 3.4, section 9 "Guard rows") Both rows now act in every
  // session, with no `when`: the person's records in the state folder (the decisions, the confirmation of saved answers,
  // the finding numbers) are refused whether or not a scan or run is under way, since decisions are taken after a run.
  // The rows above keep their windows: hook-guard.ts `whereOf` decides them from the lines and the session, as before,
  // and outside them only the state records' rows act. The cost is one routes' process per Write, Edit and shell call. and per Read, Grep and Glob call (guard-key-read below), in every session and
  // project: on Linux some 160 ms a call before r10, and on native Windows (Git Bash, Windows Node) some 1.5 s, measured
  // in the record. The guard's module loads the scan's launch and question code only where the run's .legal stands
  // (hook-guard.ts `decideWithWindows`).
  { name: "guard-file-write", event: "PreToolUse", tools: ["Write", "Edit", "MultiEdit", "NotebookEdit"], who: ["main", "seat", "relay", "internal", "other"], failClosed: guardTargetMayBe, run: async (ctx) => { const g = await import("./hook-guard.js"); return g.onEveryReading(ctx, (c) => g.decideWithWindows(c, g.onFileWrite)); } },
  // The redaction key is read by no tool call, in every session.
  { name: "guard-key-read", event: "PreToolUse", tools: ["Read", "Grep", "Glob"], who: ["main", "seat", "relay", "internal", "other"], failClosed: guardTargetMayBe, run: async (ctx) => { const g = await import("./hook-guard.js"); return g.onEveryReading(ctx, g.onKeyRead); } },
  // guard-bash and guard-code fail closed while a scan may be under way
  // (`scanMayBeUnderWay`); outside a scan a failure of either lets the call go ahead, as before.
  { name: "guard-bash", event: "PreToolUse", tools: SHELL_TOOLS, who: ["main", "seat", "relay", "internal", "other"], failClosed: scanMayBeUnderWay, run: async (ctx) => { const g = await import("./hook-guard.js"); return g.decideWithWindows(ctx, g.onBash); } },
  // (design rf13 3.9; crf11d-r2 W4) The VS Code extension's own code tool runs Python in the
  // open notebook's kernel, which can start any program: its `tool_input.code` is read with the rows that act in every
  // session (the deeper checks' `.legal/deep/` and test names, the person's records in the state folder), best effort.
  // The scan-time rows still read the shell tools only.
  { name: "guard-code", event: "PreToolUse", tools: [IDE_CODE_TOOL], who: ["main", "seat", "relay", "internal", "other"], failClosed: scanMayBeUnderWay, run: async (ctx) => (await import("./hook-guard.js")).onCode(ctx) },
  // Integration part B item 4 (B8; hooks-launch T1): a seat's Read of a file the launch list names is checked against the
  // list's sha256 at the moment of the Read, closing the window after the launch gate's check. A
  // seat's Read, Grep or Glob that reaches under the run's `.legal` is refused unless it reads a file the seat's own
  // launch entry names. Before launch-seat-call, which runs for the same event: a refusing route's deadline counts
  // from its own start.
  {
    name: "seat-read",
    event: "PreToolUse",
    tools: SEAT_READ_TOOLS,
    who: ["seat"],
    when: runMarkerStands,
    failClosed: seatReadFailsClosed,
    // On every reading of the path the seat may be opening (hook-guard.ts `onEveryReading`).
    run: async (ctx) => {
      const [g, s] = await Promise.all([import("./hook-guard.js"), import("./hook-seat-read.js")]);
      return g.onEveryReading(ctx, s.onSeatRead);
    },
  },
  // Relay item 4, hook side (hook-launch.ts): the session id for the active-run marker, the launch gate,
  // the gate on every other call that puts text into a seat (SendMessage, Skill, Workflow) and on every call that
  // schedules a prompt for the session (ScheduleWakeup, CronCreate: one that holds the skill command, fix R2; any slash
  // command, and a SendMessage to main that holds one, from the scan's start to the run's end,:
  // fail-closed in that window too), the binding of a launch to its seat, and the seats a run counts. The gates and the binding act whoever makes the call
  // (live run 1's seats were launched by a fork), internal agents included, since a fork's own events may
  // carry an empty agent_type; the routes that count seats never act for an internal agent.
  { name: "launch-session", event: "SessionStart", who: ["main"], run: async (ctx) => (await import("./hook-launch.js")).onSessionStart(ctx) },
  { name: "launch-gate", event: "PreToolUse", tools: ["Agent"], who: ["main", "seat", "relay", "internal", "other"], failClosed: runMarkerStands, run: launchGateRoute("gateLaunch") },
  {
    name: "launch-deliver",
    event: "PreToolUse",
    tools: ["SendMessage", "Skill", "Workflow", "ScheduleWakeup", "CronCreate"],
    who: ["main", "seat", "relay", "internal", "other"],
    failClosed: (ctx) => runMarkerStands(ctx) || (PROMPT_CARRIERS.includes(String(ctx.input.tool_name ?? "")) && declarationMayBeUnderWay(ctx)),
    run: launchGateRoute("gateDelivery"),
  },
  // A Bash command that may start Claude Code or the plugin's
  // session command is refused (hook-launch.ts `startsClaudeCode`, `gateShell`). From the scan's start,
  // the window `launch-deliver` keeps for a scheduled prompt (`declarationMayBeUnderWay`), as well as while the marker stands.
  { name: "launch-shell", event: "PreToolUse", tools: SHELL_TOOLS, who: ["main", "seat", "relay", "internal", "other"], when: (ctx) => runMarkerStands(ctx) || declarationMayBeUnderWay(ctx), failClosed: (ctx) => (runMarkerStands(ctx) || declarationMayBeUnderWay(ctx)) && mayStartClaudeCode(ctx), run: launchGateRoute("gateShell") },
  { name: "launch-bind", event: "PostToolUse", tools: ["Agent"], who: ["main", "seat", "relay", "internal", "other"], run: async (ctx) => (await import("./hook-launch.js")).bindLaunch(ctx) },
  { name: "launch-failed", event: "PostToolUseFailure", tools: ["Agent"], who: ["main", "seat", "relay", "internal", "other"], run: async (ctx) => (await import("./hook-launch.js")).launchFailed(ctx) },
  { name: "launch-seat-start", event: "SubagentStart", who: ["seat", "other"], run: async (ctx) => (await import("./hook-launch.js")).seatSeen(ctx) },
  // `when`: outside a run seatSeen does nothing for PreToolUse, so this route starts no routes' process for a Read by any
  // agent (item 4). The guard rows above still do, in every session: a Read,
  // Grep or Glob starts it for guard-key-read, a Write or Edit for guard-file-write, a shell call for guard-bash.
  { name: "launch-seat-call", event: "PreToolUse", who: ["seat", "other"], when: runMarkerStands, run: async (ctx) => (await import("./hook-launch.js")).seatSeen(ctx) },
  // U2 item 2: a launch of the run that Claude Code's auto mode did not allow stops the run's launching until
  // the person types the skill command in the main conversation (hook-launch.ts `onAutoModeDenied`, `onPersonExpanded`).
  // Both record only. The typed command lifts the stop only as a UserPromptExpansion whose name is exactly
  // the plugin's (`expansionLiftsTheStop`); no route takes UserPromptSubmit, whose text another session's message or a
  // scheduled prompt can hold (an earlier fix lifted the stop on it, and its route is gone).
  { name: "launch-denied", event: "PermissionDenied", tools: ["Agent"], who: ["main", "seat", "relay", "internal", "other"], when: runMarkerStands, run: async (ctx) => (await import("./hook-launch.js")).onAutoModeDenied(ctx) },
  { name: "launch-person-expansion", event: "UserPromptExpansion", who: ["main"], when: runMarkerStands, run: async (ctx) => (await import("./hook-launch.js")).onPersonExpanded(ctx) },
  // The main conversation's stop while a run is outstanding and nothing will wake it: blocked
  // once with the one command to run in the background (hook-launch.ts `mainStopped`). Never fail-closed: a hook that cannot run lets the stop through.
  { name: "launch-main-stop", event: "Stop", who: ["main"], when: runMarkerStands, run: async (ctx) => (await import("./hook-launch.js")).mainStopped(ctx) },
  // Keep this one after the capture's SubagentStop route: a seat the capture blocks has not stopped.
  { name: "launch-seat-stop", event: "SubagentStop", who: ["seat", "other"], run: async (ctx, prior) => (await import("./hook-launch.js")).seatStopped(ctx, prior) },
];

export interface HookResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  decision: HookDecision;
  /** The route whose decision was taken, or null for a pass. */
  route: string | null;
  failures: string[];
}

export interface FailureNote {
  stage: string;
  error: string;
  route?: string;
  /**
   * At a deadline: the capture route had begun (running, or ended with a later
   * route running) and its process was let go to finish on its own (`HookRoute.continues`), so what it decided was not
   * delivered on this call. The only mark of an undelivered decision (hook-capture.ts `storedCheck`).
   */
  continued?: boolean;
  /**
   * At a deadline on an event a capture route acts on: where that route was -
   * `not-begun` (the process was stopped before it), `running`, or `finished` (a later route was running).
   */
  capture?: "not-begun" | "running" | "finished";
}

/**
 * What a seat is told when its hand-back's result does not
 * reach the call within the entry's deadline: the call is refused (exit 2) without a decision on the answer, and the same
 * answer sent again is given the result. One text for every case the entry and the check store meet - the check still
 * running, the check ended with a later route still running, the check not begun, a check of the same answer still
 * running when it is sent again - so it says only what is true of all of them. Neutral words, as every receipt's (it
 * reaches the relay as a peer's message). Not a refusal of the answer: no refusal is counted against REFUSALS_MAX.
 */
export const STILL_CHECKING =
  "wolfboy: the hook's time limit passed before the program's result on this answer reached this call. This is not a refusal of the answer. Call SubagentHandback again with the same answer, unchanged, as its message: the result is given then, or this message again while the program is still at work on it.";

/**
 * How many calls of one seat's hand-back may end at the entry's
 * deadline with the capture route not yet begun (its process too slow to start) before the next such call goes ahead
 * without the capture (fail-open, as every hook failure), instead of being refused again without a bound.
 */
export const CAPTURE_NOT_BEGUN_MAX = 3;

/**
 * Append one line to the failure log. Nothing is written when the project has no `.legal` directory: the
 * plugin's hooks run in every session the plugin is enabled in, and a project nobody scanned is not given
 * one. Never throws: a failure to record a failure is reported on stderr by the caller's exit.
 */
export function recordHookFailure(run: RunPaths | null, input: Partial<HookInput> | null, note: FailureNote, at: Date): boolean {
  if (!run || !existsSync(run.legalDir)) return false;
  try {
    const abs = join(run.legalDir, HOOK_FAILURE_LOG);
    makeFolder(dirname(abs), { recursive: true });
    const line = {
      v: HOOK_VERSION,
      at: at.toISOString(),
      event: input?.hook_event_name ?? null,
      tool: input?.tool_name ?? null,
      agent_id: input?.agent_id ?? null,
      agent_type: input?.agent_type ?? null,
      session_id: input?.session_id ?? null,
      tool_use_id: input?.tool_use_id ?? null,
      ...note,
    };
    appendFileAt(abs, `${JSON.stringify(line)}\n`);
    return true;
  } catch {
    return false;
  }
}

/**
 * How many earlier calls of this seat at this event and tool ended at the entry's
 * deadline with the capture route not begun (`capture: "not-begun"` lines of the failure log). A log that cannot be read
 * counts none, so the call is refused again as before.
 */
function notBegunBefore(run: RunPaths | null, input: Partial<HookInput> | null): number {
  if (!run || typeof input?.agent_id !== "string" || input.agent_id === "") return 0;
  const got = readProgramFile("the hook failure log", join(run.legalDir, HOOK_FAILURE_LOG));
  if (!got.ok) return 0;
  let n = 0;
  for (const line of got.value.toString("utf8").split("\n")) {
    try {
      const l = JSON.parse(line) as Record<string, unknown>;
      if (l.stage === "deadline" && l.capture === "not-begun" && l.agent_id === input.agent_id && l.event === (input.hook_event_name ?? null) && l.tool === (input.tool_name ?? null)) n++;
    } catch {
      // a line that does not read is about no call
    }
  }
  return n;
}

/** The JSON a decision prints, in the forms the probe saw take effect (probe fact (c)). */
export function renderDecision(event: string, decision: HookDecision): string {
  switch (decision.kind) {
    case "pass":
      return decision.systemMessage === undefined ? "" : JSON.stringify({ systemMessage: decision.systemMessage });
    case "deny":
      return JSON.stringify({
        hookSpecificOutput: { hookEventName: event, permissionDecision: "deny", permissionDecisionReason: decision.reason },
      });
    case "replace-input":
      return JSON.stringify({
        ...(decision.systemMessage === undefined ? {} : { systemMessage: decision.systemMessage }),
        hookSpecificOutput: { hookEventName: event, updatedInput: decision.updatedInput },
      });
    case "block":
      return JSON.stringify({ decision: "block", reason: decision.reason });
    case "notify":
      return JSON.stringify({ systemMessage: decision.systemMessage, hookSpecificOutput: { hookEventName: event, additionalContext: decision.context } });
  }
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Whether a failure of this route refuses the call; a predicate that throws counts as yes. */
function failsClosed(r: HookRoute, ctx: HookContext): boolean {
  if (!r.failClosed) return false;
  try {
    return r.failClosed(ctx) === true;
  } catch {
    return true;
  }
}

function failed(run: RunPaths | null, input: Partial<HookInput> | null, note: FailureNote, at: Date): HookResult {
  const logged = recordHookFailure(run, input, note, at);
  return {
    exitCode: 1,
    stdout: "",
    stderr: `wolfboy hook: ${note.stage}: ${valueText(note.error)}${logged ? "" : " (not recorded: no .legal directory)"}\n`,
    decision: PASS,
    route: null,
    failures: [note.stage],
  };
}

/** The event on stdin, or the failure result when stdin is not one (written down like any failure). */
function readEvent(raw: string, run: RunPaths | null, now: () => Date): { input: HookInput } | { failure: HookResult } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { failure: failed(run, null, { stage: "stdin", error: `the event on stdin is not JSON (${valueText(messageOf(e))}; ${raw.length} characters)` }, now()) };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof (parsed as HookInput).hook_event_name !== "string") {
    return { failure: failed(run, null, { stage: "stdin", error: "the event on stdin is not an object with a hook_event_name" }, now()) };
  }
  return { input: parsed as HookInput };
}

/** Whether a route's `when` holds; a route without one always acts, and a predicate that throws counts as true. */
function wanted(r: HookRoute, ctx: HookContext): boolean {
  if (!r.when) return true;
  try {
    return r.when(ctx) !== false;
  } catch {
    return true;
  }
}

/** The routes that act on this event, in table order: its event, its tool and who made the call all match, and its `when` holds. */
function routesFor(ctx: HookContext, routes: readonly HookRoute[]): HookRoute[] {
  return routes.filter((r) => r.event === ctx.input.hook_event_name && (!r.tools || r.tools.includes(ctx.input.tool_name ?? "")) && r.who.includes(ctx.who) && wanted(r, ctx));
}

/**
 * Append one `begun` line to HOOK_BEGUN_LOG, synchronously, just before a capture route runs (a route with `begun`).
 * A route the platform cuts off then leaves a `begun` line with no hook-ledger line after it for the same agent
 * (capture/hook-ledger.jsonl), which assembly can name. The
 * line is in a file of its own because the capture reads its seat's history from the hook ledger. Like the failure
 * log, nothing is written where the project has no `.legal`; never throws.
 */
export function recordBegun(run: RunPaths | null, input: HookInput, route: string, at: Date): boolean {
  if (!run || !existsSync(run.legalDir)) return false;
  try {
    const abs = join(run.legalDir, HOOK_BEGUN_LOG);
    makeFolder(dirname(abs), { recursive: true });
    const line = {
      v: HOOK_VERSION,
      at: at.toISOString(),
      route,
      event: input.hook_event_name,
      tool: input.tool_name ?? null,
      agent_id: input.agent_id ?? null,
      agent_type: input.agent_type ?? null,
      session_id: input.session_id ?? null,
      tool_use_id: input.tool_use_id ?? null,
    };
    appendFileAt(abs, `${JSON.stringify(line)}\n`);
    return true;
  } catch {
    return false;
  }
}

/** What a check that fails closed says when it could not run: the call is refused (exit 2, the reason on stderr). */
export function failClosedReason(route: string, why: string): string {
  // The two rows that read shell commands and code fail closed only while a scan
  // may be under way, and the repair the person can make is the plugin's install.
  if (route === "guard-bash" || route === "guard-code") {
    return `wolfboy: WolfBoy's hook could not load or run its check of shell commands and code (${valueText(why)}), so this call is refused while a scan is under way in this project; reinstall the plugin to repair the hook.`;
  }
  return (
    `wolfboy: the check ${route} could not run (${why}), so this call is refused rather than let through unchecked; ` +
    "a refusing check fails closed. The plugin's build (product/packages/cli/dist) needs repair, or the person can disable the plugin."
  );
}

/**
 * Handle one event: run every route that acts on it, in table order. Returns what the entry prints and its exit code:
 * - a decision: exit 0 and its JSON;
 * - nothing to do: exit 0 and nothing printed;
 * - a failure (stdin that is not an event, a route that threw): exit 1, which lets the call or stop go ahead (probe
 *   fact (f)), one line on stderr, and one line in the failure log where there is a run;
 * - a route that fails closed for this call failed: exit 2 with the reason on stderr, and at once: no later route
 *   runs, whatever it would decide (integration part B item 1; part A's list, item 4).
 * A route that throws otherwise does not stop the routes after it; a decision taken before or after it still stands.
 * This function keeps no deadline: no timer fires while a route works synchronously, so the entry keeps every deadline
 * from outside the process the routes run in (runHookEntry).
 */
export async function handleHookEvent(raw: string, env: HookEnv, routes: readonly HookRoute[] = ROUTES): Promise<HookResult> {
  const now = env.now ?? (() => new Date());
  const run = typeof env.projectDir === "string" && env.projectDir !== "" ? runPaths(env.projectDir) : null;
  // The project folder before any route digests: the redaction key's place rule refuses a state folder inside it.
  if (run !== null) noteScannedFolder(resolve(run.projectDir));
  const read = readEvent(raw, run, now);
  if ("failure" in read) return read.failure;
  const input = read.input;
  const ctx: HookContext = { input, who: whoIs(input), run, now, ...(env.entryGone ? { entryGone: env.entryGone } : {}) };
  let decision: HookDecision = PASS;
  let route: string | null = null;
  const failures: string[] = [];
  const notes: string[] = [];
  for (const r of routesFor(ctx, routes)) {
    if (r.begun) recordBegun(run, input, r.name, now());
    env.onRoute?.(r.name, r);
    try {
      const d = await r.run(ctx, decision);
      // A pass that carries a message is a decision: it is printed, as a refusal or a receipt would be. A
      // later route's own decision still takes its place (the order of the table is unchanged), and a receipt keeps the
      // message; no route after the two capture routes decides anything on their events today.
      if (decision.kind === "pass" && d.kind !== "pass") {
        decision = decision.systemMessage !== undefined && d.kind === "replace-input" && d.systemMessage === undefined ? { ...d, systemMessage: decision.systemMessage } : d;
        route = r.name;
      } else if (decision.kind === "pass" && decision.systemMessage === undefined && d.kind === "pass" && d.systemMessage !== undefined) {
        decision = d;
        route = r.name;
      }
    } catch (e) {
      const note: FailureNote = { stage: "route", route: r.name, error: messageOf(e) };
      const logged = recordHookFailure(run, input, note, now());
      failures.push(r.name);
      if (failsClosed(r, ctx)) {
        const reason = failClosedReason(r.name, note.error);
        return { exitCode: 2, stdout: "", stderr: `${reason}\n`, decision: { kind: "deny", reason }, route: r.name, failures };
      }
      notes.push(`wolfboy hook: route ${r.name} failed: ${valueText(note.error)}${logged ? "" : " (not recorded: no .legal directory)"}`);
    }
  }
  if (failures.length > 0 && decision.kind === "pass") {
    return { exitCode: 1, stdout: "", stderr: `${notes.join("\n")}\n`, decision, route, failures };
  }
  return { exitCode: 0, stdout: renderDecision(input.hook_event_name, decision), stderr: notes.length ? `${notes.join("\n")}\n` : "", decision, route, failures };
}

/** What the entry runs with: its stdin and project, where its output goes, how it ends, and (for a gate) the deadlines and routes. */
export interface HookEntryIO {
  stdin: NodeJS.ReadableStream;
  /** `CLAUDE_PROJECT_DIR`. */
  projectDir?: string;
  write(stream: "stdout" | "stderr", text: string): void;
  /** Called once, after the output is written; the entry ends there, whatever the code (one rule for every end). */
  exit(code: number): void;
  stdinDeadlineMs?: number;
  processDeadlineMs?: number;
  routeDeadlineMs?: number;
  /**
   * A gate's planted routes, run in this process. Unset (the product), the table's routes run in hook-child.js, as a
   * child process or a worker thread (runHookEntry, WHERE THE ROUTES RUN), which the entry ends at its first deadline,
   * however the route holds its thread.
   */
  routes?: readonly HookRoute[];
  /**
   * false: every event's routes run in a child process, as before
   * the worker thread existed (a gate compares the two ways with it; hook-entry.ts never sets it).
   */
  routesInProcess?: boolean;
  /**
   * The plugin's shim read the
   * event's head itself and hands the entry that head and the rest, copied unread, in one stream (hook-entry.ts
   * `--event-joined`). An event that then does not parse, or a stdin that does not close within `stdinDeadlineMs`, is a
   * copy that was cut or held, not Claude Code's event, and is refused (exit 2) instead of going ahead (exit 1).
   */
  joinedEvent?: boolean;
  now?: () => Date;
}

/** [P3] The refusal of a joined event that did not arrive whole. */
export function joinedEventRefusal(why: string): string {
  return `wolfboy hook: this call is refused: its event reached the hook incomplete (${valueText(why)}), so the hook's checks could not run on it.\n`;
}

/** The event's own fields, for a failure line, when stdin was read and is a JSON object; null otherwise. */
function eventFields(raw: string): Partial<HookInput> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Partial<HookInput>) : null;
  } catch {
    return null;
  }
}

/** What a way of running the routes reports to the entry. */
interface RunnerEvents {
  /** A route is about to run: the one before it has finished. */
  begun(route: string): void;
  result(r: HookResult): void;
  /** The routes ended without a result (their process could not start, crashed, or the handler threw). */
  gone(why: string): void;
}

/** The routes' own module (hook-child.ts), started as a process or as a thread of the entry's process. */
const ROUTES_MODULE = new URL("./hook-child.js", import.meta.url);

/**
 * The anchor seam (start-record.ts
 * ANCHOR_HOME_SEAM), where code loaded into this process set one (a test's preload, which neither a thread nor a child
 * process runs), handed to the routes so they read the same anchor as the entry.
 */
function anchorSeamData(): { anchorHome?: string } {
  const seam = (globalThis as unknown as Record<symbol, unknown>)[ANCHOR_HOME_SEAM];
  return typeof seam === "string" && seam !== "" ? { anchorHome: seam } : {};
}

/**
 * The product's runner for an event that a route refusing on failure, or a capture route, acts on: the routes in a
 * child process, which the entry kills (SIGKILL) when it ends first - or, at the
 * process deadline of a route that continues (`HookRoute.continues`), lets go (`detach`: the entry stops listening and
 * the child finishes on its own). The child has a process group of its own, so that ending the hook's command does not
 * end a check let go.
 */
function childRunner(raw: string, projectDir: string | undefined, on: RunnerEvents): { stop: () => void; detach: () => void } {
  const child = spawn(process.execPath, [fileURLToPath(ROUTES_MODULE)], { stdio: ["pipe", "pipe", "ignore"], detached: true });
  let over = false;
  let buffered = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (s: string) => {
    buffered += s;
    for (let i = buffered.indexOf("\n"); i >= 0 && !over; i = buffered.indexOf("\n")) {
      const one = buffered.slice(0, i);
      buffered = buffered.slice(i + 1);
      let m: { begun?: unknown; result?: HookResult };
      try {
        m = JSON.parse(one) as typeof m;
      } catch {
        continue;
      }
      if (typeof m.begun === "string") on.begun(m.begun);
      else if (m.result && typeof m.result === "object") {
        over = true;
        on.result(m.result);
      }
    }
  });
  const end = (why: string) => {
    if (over) return;
    over = true;
    on.gone(why);
  };
  child.on("error", (e) => end(`the routes' process could not start (${valueText(messageOf(e))})`));
  child.on("close", (code, signal) => end(`the routes' process ended without a decision (${signal ?? `exit ${code}`})`));
  child.stdin.on("error", () => {});
  child.stdin.end(JSON.stringify({ raw, projectDir: projectDir ?? null, ...anchorSeamData() }));
  return {
    stop: () => {
      over = true;
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    },
    detach: () => {
      over = true;
      child.stdout.removeAllListeners("data");
      child.stdout.destroy();
      child.unref();
    },
  };
}

/**
 * The product's runner for every
 * other event: the same routes' module (hook-child.ts, `runRoutes`) as a worker thread of the entry's own process,
 * which costs no second Node start (some 0.5 s on native Windows, measured; the file, search, edit and shell calls of
 * every session take this way). The entry's own thread keeps every deadline as it does for a process: its timers fire
 * whatever the routes' thread does, and at its end it stops the thread (`terminate`, which ends a thread held by a
 * synchronous loop or wait at once). The thread's stdout and stderr go to the entry, which reads neither, so nothing a
 * route prints reaches Claude Code. Never let go (no route that continues runs here).
 */
function workerRunner(raw: string, projectDir: string | undefined, on: RunnerEvents): { stop: () => void } {
  let over = false;
  const end = (why: string) => {
    if (over) return;
    over = true;
    on.gone(why);
  };
  let worker: Worker;
  try {
    // The anchor seam, where code loaded into this process set one (a
    // test's preload, which a thread does not run): the routes' thread reads the same anchor as this one.
    worker = new Worker(ROUTES_MODULE, { workerData: { raw, projectDir: projectDir ?? null, ...anchorSeamData() }, stdout: true, stderr: true });
  } catch (e) {
    end(`the routes' thread could not start (${valueText(messageOf(e))})`);
    return { stop: () => {} };
  }
  worker.stdout.resume();
  worker.stderr.resume();
  worker.on("message", (m: { begun?: unknown; result?: HookResult } | null) => {
    if (over || m === null || typeof m !== "object") return;
    if (typeof m.begun === "string") on.begun(m.begun);
    else if (m.result && typeof m.result === "object") {
      over = true;
      on.result(m.result);
    }
  });
  worker.on("error", (e) => end(`the routes' thread failed (${valueText(messageOf(e))})`));
  worker.on("exit", (code) => end(`the routes' thread ended without a decision (exit ${code})`));
  return {
    stop: () => {
      over = true;
      void worker.terminate().catch(() => {});
    },
  };
}

/**
 * The entry's whole run (hook-entry.ts is one call to this): read the event from stdin, run the routes that act on
 * it, print the decision, end. ONE DEADLINE RULE:
 * the entry keeps every deadline itself, and no route runs on its
 * thread (they run in hook-child.js), so each deadline fires whatever a route is doing. At every deadline the entry
 * ends at once, refusing the call (exit 2) when a route that fails closed for it has not finished, since that check
 * would otherwise be skipped, and letting it go ahead (exit 1, fail-open, probe fact (f)) otherwise:
 * - stdin not closed after `stdinDeadlineMs` (no route has started): exit 1;
 * - a route that fails closed for this call still running `routeDeadlineMs` after it began: exit 2 (HOOK_ROUTE_DEADLINE_MS
 *   plus HOOK_STDIN_DEADLINE_MS pass before HOOK_PROCESS_DEADLINE_MS, so this comes first);
 * - no decision `processDeadlineMs` after the start: exit 2 if a route that fails closed has not finished, exit 1 otherwise.
 * A result ends it too, exit 2 included (a route that fails closed failed: handleHookEvent runs no route after it).
 * Every end is written down where there is a run, stops the routes' process or thread, writes the output and exits
 * (one rule). An event no route acts on starts neither. Resolves with the exit code.
 * WHERE THE ROUTES RUN. In a
 * second process (`childRunner`) where a route that acts on the event fails closed for it, or continues; in a thread of
 * this process (`workerRunner`) everywhere else. The one case the two ends differ in is a thread held inside a system
 * call (a read of a pipe nobody writes, a file system that stops answering): a thread ends only when that call
 * returns, so the entry, which has written its answer at its deadline, ends when the call returns or when Claude Code's
 * time-out ends the hook's command, whichever is first. Where no route fails closed, every deadline's answer is exit 1,
 * the call or the stop going ahead, and a hook's command that Claude Code times out goes ahead in the same way on every
 * event of hooks.json (PreToolUse and UserPromptExpansion: onFailure continue; the events that cannot block: the
 * action already happened or goes on); so no decision differs. A route that fails closed, whose deadline refuses, and
 * a capture route, which must outlive the entry, keep their process.
 */
export function runHookEntry(io: HookEntryIO): Promise<number> {
  const stdinMs = io.stdinDeadlineMs ?? HOOK_STDIN_DEADLINE_MS;
  const processMs = io.processDeadlineMs ?? HOOK_PROCESS_DEADLINE_MS;
  const routeMs = io.routeDeadlineMs ?? HOOK_ROUTE_DEADLINE_MS;
  const now = io.now ?? (() => new Date());
  const run = typeof io.projectDir === "string" && io.projectDir !== "" ? runPaths(io.projectDir) : null;
  if (run !== null) noteScannedFolder(resolve(run.projectDir));
  return new Promise((resolveExit) => {
    let settled = false;
    let input: Partial<HookInput> | null = null;
    let stop = (): void => {};
    let detach: (() => void) | null = null;
    /** The routes that act on the event, whether each fails closed for it, and the one running now (-1: none yet). */
    let plan: { name: string; closed: boolean; continues?: "refuse" | "go-ahead" }[] = [];
    let at = -1;
    let routeTimer: ReturnType<typeof setTimeout> | undefined;
    const chunks: Buffer[] = [];
    const finish = (code: number, stdout: string, stderr: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(stdinTimer);
      clearTimeout(processTimer);
      clearTimeout(routeTimer);
      stop();
      if (stdout) io.write("stdout", stdout);
      if (stderr) io.write("stderr", stderr);
      io.exit(code);
      resolveExit(code);
    };
    /** The end at a deadline or a lost runner: refuse if a check that fails closed has not finished, else go ahead. */
    const deadline = (note: FailureNote) => {
      if (settled) return;
      /* A CAPTURE ROUTE THAT HAS BEGUN IS NEVER STOPPED AT A
       * DEADLINE, whichever route is running then: the capture route itself (its check still going), or a route after it
       * (its decision made and not yet delivered). Its process is let go to finish (the check is stored by the answer's
       * hash, hook-capture.ts `onHandback`, and ends by its own limit, `HookRoute.ownLimitMs`), and the line written says
       * so (`continued`), which is what lets the same answer sent again be given that decision. One not yet begun is
       * stopped with the process, and the same answer sent again is checked afresh. Before, only a capture route running
       * at that moment was let go, so a decision made a moment before the deadline was lost with the later route. */
      const ci = note.stage === "stdin" || note.stage === "handler" ? -1 : plan.findIndex((p) => p.continues);
      const going = ci >= 0 ? plan[ci] : undefined;
      const capture: FailureNote["capture"] = at < ci ? "not-begun" : at === ci ? "running" : "finished";
      // A gate's planted routes run in this process, and a route still working goes on after the entry ends (nothing stops it).
      const letGo = going !== undefined && capture !== "not-begun" && (detach !== null || io.routes !== undefined);
      if (letGo && detach !== null) {
        detach();
        stop = () => {};
      }
      const about: Partial<FailureNote> = going ? { capture, ...(letGo ? { continued: true } : {}) } : {};
      const open = plan.slice(Math.max(at, 0)).find((p) => p.closed);
      if (open) {
        recordHookFailure(run, input, { ...note, route: open.name, ...about }, now());
        finish(2, "", `${failClosedReason(open.name, note.error)}\n`);
        return;
      }
      if (going && note.stage === "deadline") {
        // A hand-back whose capture could not even begin, on CAPTURE_NOT_BEGUN_MAX calls of this seat, goes ahead without it.
        const tooSlow = going.continues === "refuse" && capture === "not-begun" && notBegunBefore(run, input) + 1 >= CAPTURE_NOT_BEGUN_MAX;
        const kept = recordHookFailure(run, input, { ...note, route: going.name, ...about }, now());
        const unkept = kept ? "" : " (not recorded: no .legal directory)";
        if (going.continues === "refuse" && !tooSlow) {
          finish(2, "", `${STILL_CHECKING}\n`);
          return;
        }
        const after = tooSlow
          ? `; the capture of this seat's hand-back could not begin within the hook's time limit on ${CAPTURE_NOT_BEGUN_MAX} calls, so this call goes ahead without it (its stop is captured as any stop is)`
          : capture === "running"
            ? "; the stop goes ahead, and the capture goes on to finish and record what it took"
            : capture === "finished"
              ? "; the stop goes ahead, and the routes after the capture, which had finished, go on to their end"
              : "; the call or the stop goes ahead without this hook";
        finish(1, "", `wolfboy hook: ${valueText(note.error)}${after}${unkept}\n`);
        return;
      }
      const logged = recordHookFailure(run, input, note, now());
      const ahead = note.stage === "stdin" ? "" : "; the call or the stop goes ahead without this hook";
      finish(1, "", `wolfboy hook: ${valueText(note.error)}${ahead}${logged ? "" : " (not recorded: no .legal directory)"}\n`);
    };
    const stdinTimer = setTimeout(() => {
      const note: FailureNote = { stage: "stdin", error: `stdin did not close within ${stdinMs} ms` };
      if (io.joinedEvent === true && !settled) {
        recordHookFailure(run, input, note, now());
        finish(2, "", joinedEventRefusal(note.error));
        return;
      }
      deadline(note);
    }, stdinMs);
    const processTimer = setTimeout(() => deadline({ stage: "deadline", error: `no decision within ${processMs} ms of the entry's start` }), processMs);
    io.stdin.on("data", (c: Buffer | string) => chunks.push(typeof c === "string" ? Buffer.from(c, "utf8") : c));
    io.stdin.on("end", () => {
      if (settled) return;
      clearTimeout(stdinTimer);
      const raw = Buffer.concat(chunks).toString("utf8");
      input = eventFields(raw);
      const read = readEvent(raw, run, now);
      if ("failure" in read) {
        if (io.joinedEvent === true) {
          finish(2, "", joinedEventRefusal(`${raw.length} characters that are not one JSON event`));
          return;
        }
        finish(read.failure.exitCode, read.failure.stdout, read.failure.stderr);
        return;
      }
      const ctx: HookContext = { input: read.input, who: whoIs(read.input), run, now };
      const routes = routesFor(ctx, io.routes ?? ROUTES);
      if (routes.length === 0) {
        finish(0, "", "");
        return;
      }
      plan = routes.map((r) => ({ name: r.name, closed: failsClosed(r, ctx), ...(r.continues ? { continues: r.continues } : {}) }));
      const on: RunnerEvents = {
        begun: (name) => {
          if (settled) return;
          clearTimeout(routeTimer);
          at = plan.findIndex((p) => p.name === name);
          const p = plan[at];
          if (p?.closed) routeTimer = setTimeout(() => deadline({ stage: "route", error: `it did not finish within ${routeMs} ms` }), routeMs);
        },
        result: (r) => finish(r.exitCode, r.stdout, r.stderr),
        gone: (why) => deadline({ stage: "handler", error: why }),
      };
      if (io.routes) {
        handleHookEvent(raw, { projectDir: io.projectDir, now, onRoute: on.begun }, io.routes).then(on.result, (e: unknown) => on.gone(messageOf(e)));
      } else if (io.routesInProcess === false || plan.some((p) => p.closed || p.continues !== undefined)) {
        ({ stop, detach } = childRunner(raw, io.projectDir, on));
      } else {
        ({ stop } = workerRunner(raw, io.projectDir, on));
      }
    });
  });
}
