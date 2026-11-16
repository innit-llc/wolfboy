/**
 * THE HOST'S VARIABLES THE CLI READS - one list (the parent's ruling: a gate that is not about the session or CI gives the same result anywhere).
 *
 * The CLI reads three kinds of environment variable, and this file names each kind:
 * - the HOST's: set by Claude Code, by the plugin's SessionStart hook or by a CI service, never by the person for the
 *   program: the session signs (CLAUDECODE, CLAUDE_CODE_SESSION_ID), the variables the SessionStart hook exports
 *   (WOLFBOY_SESSION_ID, WOLFBOY_PROJECT_DIR), CI, the host's sub-agent limit
 *   (CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS), the host's two switches the launch gate reads (CLAUDE_CODE_DISABLE_BACKGROUND_TASKS,
 *   CLAUDE_CODE_SUBAGENT_MODEL_FORCE), the variables Claude Code sets for a hook command that the program reads (CLAUDE_ENV_FILE,
 *   CLAUDE_PROJECT_DIR; never CLAUDE_PLUGIN_ROOT, since the plugin is found from the program's own place), and the scan launch profile's (scan-profile.ts): the Claude Code
 *   variables it sets for a scan's session, the API key that decides its cache part, the mark, the start effort level
 *   and the person's choice `legal-scan session` sets, and the SessionStart hook's verdict, and the host's entrypoint
 *   (CLAUDE_CODE_ENTRYPOINT: relay-entry offers the relay only where it is `cli`, an interactive session; relay-seat.ts,
 *   cost step 2). Each is a named constant at the module that reads
 *   it, and this list is made of those constants, so a renamed variable renames its entry here;
 * - the program's own switches, `PRODUCT_CLI_*` (PROGRAM_ENV_PREFIX), which a gate sets on purpose where it tests one;
 * - the shell's, HOME (SHELL_ENV_NAMES), which the hooks' path checks read for a leading `~` (hook.ts `homePath`), and
 *   the person's state folder, XDG_STATE_HOME and LOCALAPPDATA, where the record of the start question is kept
 *   (start-record.ts).
 *
 * The list is for the gates: a check, the one helper every gate that starts the CLI takes its
 * environment from, drops exactly these names, so a host variable the shell running a gate happens to carry (a seat
 * limit of 1 in the person's Claude Code settings, CI set in a terminal, a session's variables) never reaches a gate
 * that is not about it. test:declaration-questions section enumerates every variable the source reads and fails
 * on one that is none of the three kinds, so a new read cannot be left off the list. In the CLI only test-rules.ts, the
 * CLI's own gate command, imports it: the scans it starts run without these names, for the same reason. The names are
 * read at their own modules.
 */
import { CI_ENV, CI_RUNNER_ENVS } from "./declaration.js";
import { HOME_ENV, HOOK_PROJECT_ENV } from "./hook.js";
import { LOCAL_APP_DATA_ENV, STATE_HOME_ENV, USER_PROFILE_ENV } from "./start-record.js";
import { BACKGROUND_OFF_ENV, CLAUDE_CODE_ENV, CLAUDE_CODE_SESSION_ENV, ENV_FILE_ENV, MODEL_FORCE_ENV, PROJECT_ENV, SESSION_ENV } from "./hook-launch.js";
import { SUBAGENT_LIMIT_ENV } from "./launch-plan.js";
import { BUNDLE_DIR_ENV } from "./bundle.js";
import { ENTRYPOINT_ENV } from "./relay-seat.js";
import { HTTP_PROXY_ENV, HTTP_PROXY_LOWER_ENV, HTTPS_PROXY_ENV, HTTPS_PROXY_LOWER_ENV, NO_PROXY_ENV, NO_PROXY_LOWER_ENV } from "./proxy-env.js";
import {
  API_KEY_ENV,
  BASE_URL_ENV,
  BEDROCK_ENV,
  CACHE_TTL_ENV,
  CONNECTORS_ENV,
  EFFORT_LEVEL_ENV,
  GIT_STATUS_ENV,
  INSTRUCTION_FILES_ENV,
  PROFILE_CHECK_ENV,
  PROFILE_MARK_ENV,
  PROMPT_SUGGESTION_ENV,
  START_EFFORT_ENV,
  VERTEX_ENV,
  WITHOUT_PROFILE_ENV,
} from "./scan-profile.js";
// PATH: child-program.ts reads it to find git and Claude Code; it imports nothing of the CLI's, so no cycle.
import { PATH_ENV } from "./child-program.js";
import { PLUGIN_DATA_ENV } from "./compile-cache.js";
import { GIT_BASH_ENV } from "./git-bash.js";
import { GLOB_HIDDEN_ENV, GLOB_NO_IGNORE_ENV, HOST_ENGINE_ENV } from "./host-search.js";
import {
  GITHUB_ACTIONS_ENV,
  GITHUB_API_URL_ENV,
  GITHUB_EVENT_NAME_ENV,
  GITHUB_EVENT_PATH_ENV,
  GITHUB_REPOSITORY_ENV,
  GITHUB_SHA_ENV,
  GITHUB_STEP_SUMMARY_ENV,
  GITHUB_TOKEN_ENV,
  GITHUB_WORKFLOW_REF_ENV,
  GITHUB_WORKSPACE_ENV,
} from "./ci-check.js";

/** Every host variable the CLI reads (see above); the gates' helper drops each. */
export const HOST_ENV_NAMES: readonly string[] = Object.freeze([
  CLAUDE_CODE_ENV,
  CLAUDE_CODE_SESSION_ENV,
  SESSION_ENV,
  PROJECT_ENV,
  CI_ENV,
  ...CI_RUNNER_ENVS,
  SUBAGENT_LIMIT_ENV,
  BACKGROUND_OFF_ENV,
  MODEL_FORCE_ENV,
  ENV_FILE_ENV,
  HOOK_PROJECT_ENV,
  INSTRUCTION_FILES_ENV,
  GIT_STATUS_ENV,
  CONNECTORS_ENV,
  PROMPT_SUGGESTION_ENV,
  CACHE_TTL_ENV,
  API_KEY_ENV,
  EFFORT_LEVEL_ENV,
  PROFILE_MARK_ENV,
  WITHOUT_PROFILE_ENV,
  PROFILE_CHECK_ENV,
  START_EFFORT_ENV,
  ENTRYPOINT_ENV,
  // The person's bundle location, read where no --bundle is given (bundle.ts resolveBundleDir).
  BUNDLE_DIR_ENV,
  // Where Claude Code sends its requests, named on the start screen (scan-profile.ts step2Destination).
  BEDROCK_ENV,
  VERTEX_ENV,
  BASE_URL_ENV,
  // Claude Code's own executable, whose ripgrep replays a seat's search where today's replay does not (host-search.ts
  // hostEngineNow); a gate that tests that replay names the engine itself.
  HOST_ENGINE_ENV,
  // The two switches of Claude Code's Glob; a Glob captured while either is set is not replayed (host-search.ts
  // globToolProblem).
  GLOB_NO_IGNORE_ENV,
  GLOB_HIDDEN_ENV,
  // The proxy a deeper check's archive requests go through, as Claude Code's sandbox or the person's network sets it
  // (archive.ts archiveProxy).
  HTTPS_PROXY_ENV,
  HTTPS_PROXY_LOWER_ENV,
  HTTP_PROXY_ENV,
  HTTP_PROXY_LOWER_ENV,
  NO_PROXY_ENV,
  NO_PROXY_LOWER_ENV,
  // The GitHub Actions variables the rules check in CI reads: the event, the commit, the workflow file, the step summary,
  // and the token and API address of its one check run (ci-check.ts).
  GITHUB_ACTIONS_ENV,
  GITHUB_EVENT_NAME_ENV,
  GITHUB_EVENT_PATH_ENV,
  GITHUB_SHA_ENV,
  GITHUB_REPOSITORY_ENV,
  GITHUB_TOKEN_ENV,
  GITHUB_API_URL_ENV,
  GITHUB_WORKFLOW_REF_ENV,
  GITHUB_WORKSPACE_ENV,
  GITHUB_STEP_SUMMARY_ENV,
  // The plugin's data folder Claude Code gives every hook process, where the routes' compile cache goes (compile-cache.ts).
  PLUGIN_DATA_ENV,
  // The Git Bash a person named for Claude Code on native Windows, which the hooks' bash lookup keeps (git-bash.ts).
  GIT_BASH_ENV,
]);

/** The program's own switches (engine-pool, test-seams, orientation, scan, context, engine): kept by the helper. */
export const PROGRAM_ENV_PREFIX = "PRODUCT_CLI_";

/**
 * The shell's variables the CLI reads (the hooks' path checks, a leading `~`: hook.ts `homePath`; PATH, to find the
 * programs it starts): kept by the helper.
 */
// CLAUDE_CONFIG_DIR is no longer read: no answer's transcript is located (hook-question.ts). USERPROFILE: the home on Windows (start-record.ts homeEnvName).
export const SHELL_ENV_NAMES: readonly string[] = Object.freeze([HOME_ENV, STATE_HOME_ENV, LOCAL_APP_DATA_ENV, USER_PROFILE_ENV, PATH_ENV]);
