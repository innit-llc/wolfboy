/**
 * The oldest Claude Code the plugin's hooks are written for, and the check of the
 * one installed.
 *
 * WHY THIS VERSION: the newest of the Claude Code behaviours product/plugin/hooks/hooks.json relies on, each as Claude
 * Code's hooks reference states its version (https://code.claude.com/docs/en/hooks, read 2026-11-10):
 * - a hook entry's `onFailure` field, which the SessionStart, SubagentStart, PostToolUse, PostToolUseFailure and
 *   PermissionDenied entries set to "block" and the PreToolUse and UserPromptExpansion entries to "continue" (git-bash.ts
 *   says why): "Requires Claude Code v2.1.295 or later";
 * - the Bash group's matcher also running on the commands Claude starts with the Monitor tool ("A PreToolUse ... hook
 *   with a `Bash` matcher also runs on shell commands Claude starts with the Monitor tool ... Requires Claude Code
 *   v2.1.314 or later"), which the guard rows read;
 * - a seat's hand-back through the SubagentHandback tool, which the capture reads at PreToolUse: v2.1.271.
 * Below it, what those entries do was never tried, and the guards' fail-closed answers are written against the
 * behaviour above. A later hooks.json field with a stated version raises this constant; the record says how it was
 * found.
 */
import { spawnStart } from "./child-program.js";

export const CLAUDE_CODE_FLOOR = "2.1.314";

/** The first `major.minor.patch` in Claude Code's `--version` text ("2.1.321 (Claude Code)"), or null. */
export function claudeCodeVersionOf(text: string): string | null {
  const m = /(?:^|\s|v)(\d+)\.(\d+)\.(\d+)(?![\d.])/.exec(text);
  return m === null ? null : `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}`;
}

/** Whether version `v` (major.minor.patch) is older than CLAUDE_CODE_FLOOR. */
export function belowClaudeCodeFloor(v: string, floor: string = CLAUDE_CODE_FLOOR): boolean {
  const a = v.split(".").map(Number);
  const b = floor.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

export type ClaudeCodeVersion =
  | { kind: "ok"; version: string }
  | { kind: "below"; version: string; sentence: string }
  | { kind: "unknown"; sentence: string };

/**
 * Ask the Claude Code program `program` (a path, as the caller found it) for its version (`--version`, which starts no
 * session), and compare it with the floor.
 */
export function claudeCodeVersion(
  program: string,
  env: NodeJS.ProcessEnv = process.env,
  // how `program` is started with no shell (child-program.ts `programStart`): on Windows
  // npm's `claude.cmd` is started as the Node file it names, which Node can start and a batch file it cannot.
  start: { file: string | null; lead: string[] } = { file: program, lead: [] },
): ClaudeCodeVersion {
  const r = spawnStart(start, ["--version"], { env, encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  const version = r.error || r.status !== 0 ? null : claudeCodeVersionOf(r.stdout ?? "");
  if (version === null) {
    return {
      kind: "unknown",
      sentence: `note: the Claude Code version could not be read from ${JSON.stringify(program)} --version; this plugin's checks need Claude Code ${CLAUDE_CODE_FLOOR} or later.`,
    };
  }
  if (!belowClaudeCodeFloor(version)) return { kind: "ok", version };
  return {
    kind: "below",
    version,
    sentence:
      `refused: this is Claude Code ${version}, and this plugin's checks need Claude Code ${CLAUDE_CODE_FLOOR} or later (older versions handle its hook settings differently, so its checks could not be relied on). ` +
      "Update Claude Code (claude update, or your package manager, or ask whoever pins your version), then run this command again.",
  };
}
