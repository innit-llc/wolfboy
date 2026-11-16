/**
 * THE SCAN LAUNCH PROFILE.
 *
 * What a scan's Claude Code session is started with, for that session only - no settings file of the person is
 * written (the owner: the problem is only the scan's session). Each part closes something the seats received in live
 * run 2 or costs the run without changing any verdict input:
 * - the scanned repository's instruction files off (`CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`): the one control that closes
 *   all three routes by which a repository's CLAUDE.md and AGENTS.md reach a seat - at its start, after a Read in a
 *   subfolder (`nested_memory`), and through the built-in agents-md plugin's tool.call context; the agent field `omitClaudeMd` closes the first only;
 * - git status off (`CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS=1`, report.md T4);
 * - MCP instructions off: the claude.ai connectors are not fetched (`ENABLE_CLAUDEAI_MCP_SERVERS=false`) and no MCP
 *   server of another configuration is loaded (`--strict-mcp-config`, with no `--mcp-config`);
 * - prompt suggestions off (`CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false`): a request after every turn that reads the
 *   whole context;
 * - the effort level KEPT as the person has it (a thinking level is pinned
 *   only after a pre-registered comparison chooses it, so the launcher chooses none): `--effort <level>`
 *   is passed only where the person gives one, and where `CLAUDE_CODE_EFFORT_LEVEL` is set its value is carried over as
 *   the flag and the variable removed - the variable outranks the seats' own `effort` frontmatter and the flag does not
 *   (best-practices.md (a)), so a later seat pin would be void under it, and carrying it over keeps the level unchanged.
 *   Where the person names none, the session runs at their own level (their settings or the model's default). The level
 *   the launcher named is recorded (`START_EFFORT_ENV`, the run's marker `start_effort`) and shown beside the price
 *   table; a change during the run does not keep the cached prefix (P3). The seats run at the level their agent files
 *   pin, and a seat recorded at another level is reported, never refused (hook-launch.ts `effortChanges`);
 * - a one-hour prompt cache for the main conversation where an API key is in use (`CLAUDE_CODE_PROMPT_CACHE_TTL=1h`;
 *   a subscription gets one hour already, an API key five minutes: P2).
 *
 * `legal-scan session` starts Claude Code with the profile and marks the session (`PROFILE_MARK_ENV`), which stands
 * for the two flags no hook can see. The plugin's SessionStart hook checks the session's own environment
 * (`scanProfileState`) and exports its verdict into the session's Bash (`PROFILE_CHECK_ENV`); the scan and the
 * pre-launch step refuse, inside a session whose verdict is `off`, before anything is written or any seat is
 * launched, printing the one command that starts a profiled session. Going on without the profile is the person's
 * choice alone, made when the session is started (`legal-scan session --without-profile`, which sets
 * `WITHOUT_PROFILE_ENV`): the hook reads it from the session's own environment, which no tool call of the session can
 * change, and the run records it (the active-run marker's `scan_profile`).
 *
 * WHAT THIS DOES NOT STOP: the verdict reaches the program through the session's Bash, so a command line that sets
 * `PROFILE_CHECK_ENV` itself passes the program's check (as a command line can set the session id; hook-launch.ts
 * `markerSessionRefusal`). The hook's own verdict stays what it was; nothing the program does can make a session that
 * was started without the profile carry it.
 *
 * This module is loaded by the hook entry at every SessionStart, so it imports nothing but Node's own modules.
 */
import { IN_BASH, scannerCommand } from "./scanner-command.js";

/** Set by `legal-scan session` to the profile's version: the session was started by the launcher. */
export const PROFILE_MARK_ENV = "WOLFBOY_SCAN_PROFILE";
export const PROFILE_VERSION = "1";
/** Set by `legal-scan session --without-profile`: the person chose, at the session's start, to go on without it. */
export const WITHOUT_PROFILE_ENV = "WOLFBOY_WITHOUT_PROFILE";
/** Exported into the session's Bash by the plugin's SessionStart hook: its verdict (`profileCheckValue`). */
export const PROFILE_CHECK_ENV = "WOLFBOY_SCAN_PROFILE_CHECK";
/** Where it is set, the person uses an API key, and the main conversation's cache lasts five minutes unless set. */
export const API_KEY_ENV = "ANTHROPIC_API_KEY";
/**
 * Removed from a scan session's environment, its value carried over as `--effort`: it would outrank the seats' own
 * `effort` frontmatter (best-practices.md (a)).
 */
export const EFFORT_LEVEL_ENV = "CLAUDE_CODE_EFFORT_LEVEL";
/** Set by `legal-scan session` to the effort level it named at the session's start; removed where it named none. */
export const START_EFFORT_ENV = "WOLFBOY_START_EFFORT";
export const INSTRUCTION_FILES_ENV = "CLAUDE_CODE_DISABLE_CLAUDE_MDS";
export const GIT_STATUS_ENV = "CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS";
export const CONNECTORS_ENV = "ENABLE_CLAUDEAI_MCP_SERVERS";
export const PROMPT_SUGGESTION_ENV = "CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION";
export const CACHE_TTL_ENV = "CLAUDE_CODE_PROMPT_CACHE_TTL";
/** The levels `claude --effort` takes (Claude Code 2.1.284's own help). */
export const EFFORT_LEVELS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];

const ON = new Set(["1", "true", "yes", "on"]);
const OFF = new Set(["0", "false", "no", "off"]);
const said = (v: string | undefined, words: Set<string>): boolean => words.has((v ?? "").trim().toLowerCase());
const apiKeyInUse = (env: NodeJS.ProcessEnv): boolean => (env[API_KEY_ENV] ?? "").trim() !== "";

interface ProfilePart {
  /** What the part does, as the person reads it. */
  part: string;
  env: string;
  /** The value the launcher sets. */
  value: string;
  holds: (env: NodeJS.ProcessEnv) => boolean;
  /** Where the part applies; everywhere where absent. */
  applies?: (env: NodeJS.ProcessEnv) => boolean;
}

/** The parts a hook can see in the session's environment, in the order the texts name them. */
export const PROFILE_PARTS: readonly ProfilePart[] = [
  { part: "the scanned repository's instruction files (CLAUDE.md, AGENTS.md) off", env: INSTRUCTION_FILES_ENV, value: "1", holds: (e) => said(e[INSTRUCTION_FILES_ENV], ON) },
  { part: "git status off", env: GIT_STATUS_ENV, value: "1", holds: (e) => said(e[GIT_STATUS_ENV], ON) },
  { part: "the claude.ai connectors and their MCP instructions off", env: CONNECTORS_ENV, value: "false", holds: (e) => said(e[CONNECTORS_ENV], OFF) },
  { part: "prompt suggestions off", env: PROMPT_SUGGESTION_ENV, value: "false", holds: (e) => said(e[PROMPT_SUGGESTION_ENV], OFF) },
  { part: "a one-hour prompt cache (an API key is in use)", env: CACHE_TTL_ENV, value: "1h", holds: (e) => (e[CACHE_TTL_ENV] ?? "").trim() === "1h", applies: apiKeyInUse },
  {
    part: "started by legal-scan session (the other MCP configurations off, the effort level recorded at the start)",
    env: PROFILE_MARK_ENV,
    value: PROFILE_VERSION,
    holds: (e) => (e[PROFILE_MARK_ENV] ?? "").trim() === PROFILE_VERSION,
  },
];

export interface ScanProfileState {
  /** Every part that applies holds. */
  on: boolean;
  /** The parts that apply and do not hold, in words. */
  missing: string[];
  /** The person started the session with `WITHOUT_PROFILE_ENV` set. */
  waived: boolean;
}

/** The profile as a session's own environment carries it (the SessionStart hook's view). */
export function scanProfileState(env: NodeJS.ProcessEnv): ScanProfileState {
  const missing = PROFILE_PARTS.filter((p) => (p.applies ? p.applies(env) : true) && !p.holds(env)).map((p) => p.part);
  return { on: missing.length === 0, missing, waived: said(env[WITHOUT_PROFILE_ENV], ON) };
}

/** The SessionStart hook's verdict as exported: `on`, `waived: <parts>` or `off: <parts>`. */
export function profileCheckValue(s: ScanProfileState): string {
  if (s.on) return "on";
  return `${s.waived ? "waived" : "off"}: ${s.missing.join("; ")}`;
}

/** The verdict read back from `PROFILE_CHECK_ENV` in the session's Bash; `absent` where the hook exported none. */
export function readProfileCheck(env: NodeJS.ProcessEnv): { state: "on" | "off" | "waived" | "absent"; missing: string[] } {
  const v = (env[PROFILE_CHECK_ENV] ?? "").trim();
  if (v === "") return { state: "absent", missing: [] };
  if (v === "on") return { state: "on", missing: [] };
  const m = /^(off|waived): (.*)$/s.exec(v);
  // A value the hook did not write is read as off: the safe side.
  if (!m) return { state: "off", missing: [`an unreadable verdict ${JSON.stringify(v)}`] };
  return { state: m[1] as "off" | "waived", missing: (m[2] ?? "").split("; ").filter((x) => x !== "") };
}

/**
 * The one command that starts a profiled scan session, as every told command is made (scanner-command.ts
 * `scannerCommand`):
 * the plugin's launcher where this program is the plugin's, else this Node and the CLI's `index.js`.
 */
export function sessionCommand(): string {
  return scannerCommand(["session"]);
}

/**
 * Why the scan or the pre-launch step does not go on in this session, or null where it may: inside a session whose
 * SessionStart verdict is `off`. `absent` passes (no SessionStart hook of this build ran: the session-id refusals say
 * so where it matters), and so does `waived`, the person's own choice. `absent` is kept: this check is the profile's, and the scan's layer 1
 * pays for no seat. The session-id refusal where seats are paid for is hook-launch.ts `hooksNotRunningRefusal`, which the
 * pre-launch step, launch-next, wait-next and relay-entry apply on every system.
 */
export function profileRefusal(env: NodeJS.ProcessEnv, step: string): string | null {
  const check = readProfileCheck(env);
  if (check.state !== "off") return null;
  // Every command told here is written whole by `scannerCommand`: the
  // conversation's id and the added flag were put into the text by hand before, unquoted.
  const id = env.CLAUDE_CODE_SESSION_ID;
  const keep = id
    ? `to keep this conversation: ${scannerCommand(["session", "--", "--resume", id])}`
    : "add -- --resume <this conversation's id> to keep this conversation";
  return (
    `${step} stops here: this Claude Code session was not started with the scan launch profile (missing: ${check.missing.join("; ")}), ` +
    "so the scanned repository's instruction files, its git status and MCP instructions would reach every seat, and the run would pay for what no verdict uses. " +
    `Tell the person to start the scan's session from their own terminal, in this folder, ${IN_BASH}, with: ${sessionCommand()} ` +
    `(${keep}; not --continue, which takes the folder's most recent one), and to ask for the scan there. Going on without the profile is the person's choice alone, made when the session starts (${scannerCommand(["session", "--without-profile"])}); never set these variables yourself.`
  );
}

/** What a run records of the profile (the active-run marker's `scan_profile`); null where the hook exported no verdict. */
export function profileRecord(env: NodeJS.ProcessEnv): { state: "on" | "off" | "waived"; missing: string[] } | null {
  const check = readProfileCheck(env);
  return check.state === "absent" ? null : { state: check.state, missing: check.missing };
}

/**
 * The effort level a scan session starts with: the person's `--effort`, else `EFFORT_LEVEL_ENV`'s value
 * carried over as it is, else none - the person's own level, which the launcher does not name. `from` says which. A
 * value that is not one of `EFFORT_LEVELS` is refused, never mapped: carrying it over as another value, or dropping the
 * variable without carrying it, could change the level.
 */
export function sessionEffort(given: string | undefined, env: NodeJS.ProcessEnv): { level: string | null; from: "--effort" | typeof EFFORT_LEVEL_ENV | null } | { refused: string } {
  const levels = EFFORT_LEVELS.join(", ");
  if (given !== undefined) {
    if (!EFFORT_LEVELS.includes(given)) return { refused: `--effort ${JSON.stringify(given)} is not a level; the levels are ${levels}` };
    return { level: given, from: "--effort" };
  }
  const carried = env[EFFORT_LEVEL_ENV];
  if (carried === undefined || carried === "") return { level: null, from: null };
  if (!EFFORT_LEVELS.includes(carried)) {
    return {
      refused:
        `${EFFORT_LEVEL_ENV} is set to ${JSON.stringify(carried)}, which is not a level --effort takes (${levels}), and the scan's session does not get the variable ` +
        "(it would outrank the seats' own effort level); name this session's level with --effort <level>, or unset the variable to keep your own level",
    };
  }
  return { level: carried, from: EFFORT_LEVEL_ENV };
}

/** The effort level `legal-scan session` named at this session's start (`START_EFFORT_ENV`), or null where it named none. */
export function startEffort(env: NodeJS.ProcessEnv): string | null {
  const v = env[START_EFFORT_ENV];
  return typeof v === "string" && EFFORT_LEVELS.includes(v) ? v : null;
}

export interface ProfiledLaunch {
  args: string[];
  /** The variables set (or, with `without`, the person's choice and the start level) on top of the caller's environment. */
  set: Record<string, string>;
  /** The variables removed from it: the effort variable, whose value the flag carries over, and the start level where none is named. */
  unset: string[];
}

/**
 * Where step 2 sends code, as the start screen names it: Anthropic, unless Claude Code's own variables send its requests
 * elsewhere (Amazon Bedrock, Google Vertex AI, or a service named by ANTHROPIC_BASE_URL).
 */
export function step2Destination(env: NodeJS.ProcessEnv): string {
  const on = (name: string): boolean => (env[name] ?? "") !== "" && env[name] !== "0" && env[name]?.toLowerCase() !== "false";
  if (on(BEDROCK_ENV)) return "Amazon Bedrock";
  if (on(VERTEX_ENV)) return "Google Vertex AI";
  if ((env[BASE_URL_ENV] ?? "") !== "") return "the service your Claude Code is set to use";
  return "Anthropic";
}
/** Claude Code's own variables that send its requests elsewhere than Anthropic, read by `step2Destination` (host-env.ts lists them). */
export const BEDROCK_ENV = "CLAUDE_CODE_USE_BEDROCK";
export const VERTEX_ENV = "CLAUDE_CODE_USE_VERTEX";
export const BASE_URL_ENV = "ANTHROPIC_BASE_URL";

/**
 * WHERE AN ORGANISATION'S SETTINGS STOP PLUGIN HOOKS. Every refusal that says "start a
 * new session with the plugin enabled" (the session id or the project folder missing inside Claude Code) also names the
 * one case where a new session cannot help: managed settings with `allowManagedHooksOnly` run hooks only of plugins the
 * managed `enabledPlugins` force-enables, and `disableAllHooks` runs none (code.claude.com/docs/en/settings-reference,
 * read 2026-11-10). The scan does not run without the hooks; that stays. The plugin id is `wolfboy@wolfboy`: the plugin
 * and the marketplace are both named `wolfboy` (named 2026-11-10; the manifests still carry the working name until renamed).
 */
export const HOOKS_POLICY_WORDS =
  "If a new session says the same, your organisation's managed settings may stop plugin hooks (allowManagedHooksOnly or disableAllHooks), and the scan cannot run without this plugin's hooks: ask your administrator to enable wolfboy@wolfboy in the managed settings' enabledPlugins.";

/**
 * THE START SCREEN: what will happen, in two steps,
 * and where code goes. `legal-scan session` prints it before Claude Code starts; the session's settings, which it
 * printed until then, are in its --help. The quick scan's time is not printed: the program does not know it for a tree it
 * has not read, so the line says what the person will see instead.
 */
export function startScreenLines(project: string, env: NodeJS.ProcessEnv, without: boolean): string[] {
  const where = without
    ? ["  Step 1 sends nothing anywhere. Step 2 sends code through your own Claude", "  Code, with your own settings, as you chose: its connectors stay on."]
    : [`  Step 1 sends nothing anywhere. Step 2 sends code only to ${step2Destination(env)},`, "  through your own Claude Code."];
  return [
    "",
    `  Checking ${project} against EU and US requirements for digital products`,
    "",
    // Inside Claude Code the scan's output goes to a file (SKILL.md step 2), so no progress
    // line shows while it reads: the line says what the person will see there.
    "  1  Quick scan   on this computer, no AI          result shown when it ends",
    "  2  AI review    Claude reads each place found    time and cost first",
    "",
    ...where,
    "",
  ];
}

/**
 * The Claude Code arguments and variables of a scan session: the profile, or `without` it (the person's choice,
 * recorded). `effort` is `sessionEffort`'s level: passed as `--effort` and recorded in `START_EFFORT_ENV` only where it
 * is named; either way `EFFORT_LEVEL_ENV` is removed, since a named level already carries its value.
 */
export function profiledLaunch(opts: { effort: string | null; without: boolean; env: NodeJS.ProcessEnv; passThrough: string[] }): ProfiledLaunch {
  const effortArgs = opts.effort === null ? [] : ["--effort", opts.effort];
  const start: Record<string, string> = opts.effort === null ? {} : { [START_EFFORT_ENV]: opts.effort };
  const unset = opts.effort === null ? [EFFORT_LEVEL_ENV, START_EFFORT_ENV] : [EFFORT_LEVEL_ENV];
  if (opts.without) return { args: [...effortArgs, ...opts.passThrough], set: { [WITHOUT_PROFILE_ENV]: "1", ...start }, unset };
  const set: Record<string, string> = {};
  for (const p of PROFILE_PARTS) if (p.applies ? p.applies(opts.env) : true) set[p.env] = p.value;
  return { args: ["--strict-mcp-config", ...effortArgs, ...opts.passThrough], set: { ...set, ...start }, unset: [...unset, WITHOUT_PROFILE_ENV] };
}
