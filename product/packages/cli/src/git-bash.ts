/**
 * THE GIT BASH A SCAN SESSION'S HOOKS RUN IN,
 * ON NATIVE WINDOWS.
 *
 * The plugin's hooks are bash commands. Claude Code runs a hook command in Git Bash on Windows, or in PowerShell where it
 * finds no Git Bash, and there the commands do not start. hooks.json sets `onFailure: "continue"` on PreToolUse and
 * UserPromptExpansion, so that on such a computer an ordinary session runs without the plugin's guards instead of losing
 * every tool call in every project. A scan must never run so: `legal-scan session` names the Git Bash for the Claude
 * Code it starts through `CLAUDE_CODE_GIT_BASH_PATH` (Claude Code's own variable; its setup page gives
 * `C:\Program Files\Git\bin\bash.exe` as the value, read 2026-11-10), and refuses where none is found.
 *
 * Where it looks, in this order, taking the first file that is there:
 * 1. `CLAUDE_CODE_GIT_BASH_PATH` where the person set it: kept as it is. A value that is not the full path of a file
 *    is refused, since Claude Code would then run the hooks in PowerShell, where they do not start.
 * 2. Git Bash beside the `git` found on PATH outside the repository to scan (`programOnPath`, the rule node-choice.bash
 *    applies to node): `<git folder>\..\bin\bash.exe` for `cmd\git.exe` and `bin\git.exe`, and
 *    `<git folder>\..\..\bin\bash.exe` for `mingw64\bin\git.exe` and its kin.
 * 3. Git for Windows' install folders: `Git\bin\bash.exe` under ProgramFiles, ProgramW6432 and ProgramFiles(x86), and
 *    under `%LOCALAPPDATA%\Programs` (the per-user install).
 * A found path inside a folder no program is taken from (the repository to scan) is passed over, as `programOnPath`
 * passes over such a folder: the repository could hold a bash.exe of its own.
 *
 * On every other system nothing is set: Claude Code runs the hooks with `sh -c` there.
 * Imports nothing of the program's own beyond `child-program.ts`, for the PATH rule.
 */
import { statSync } from "node:fs";
import { win32 } from "node:path";
import { foldersNoProgramComesFrom, programFolderHolding, programOnPath } from "./child-program.js";

export const GIT_BASH_ENV = "CLAUDE_CODE_GIT_BASH_PATH";

/** What `gitBashForSession` decides: the variables to set for the session (none where nothing is needed), or a refusal. */
export type GitBashChoice = { set: Record<string, string>; found: string | null } | { refused: string };

/** What the lookup reads of this computer; tests replace it. */
export interface GitBashLook {
  /** True where `p` is a file. */
  isFile(p: string): boolean;
  /** The `git` program on PATH outside the repository to scan, or null. */
  gitOnPath(): string | null;
  /** True where `p` lies inside a folder no program is taken from. */
  avoided(p: string): boolean;
}

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

export const COMPUTER: GitBashLook = {
  isFile,
  gitOnPath: () => programOnPath("git", foldersNoProgramComesFrom()),
  avoided: (p) => programFolderHolding(p, foldersNoProgramComesFrom()) !== null,
};

/** A variable of `env` by its name, compared without case, as Windows compares them; empty or only spaces is not set. */
function windowsVariable(env: NodeJS.ProcessEnv, name: string): string | null {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
  const v = key === undefined ? undefined : env[key];
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Where Git Bash would be, from the `git` program's path: by the folder git sits in. */
function besideGit(git: string): string[] {
  const folder = win32.dirname(git);
  const last = win32.basename(folder).toLowerCase();
  if (last === "cmd" || last === "bin") {
    const up = win32.basename(win32.dirname(folder)).toLowerCase();
    // mingw64\bin\git.exe (and mingw32, clang64, clangarm64, ucrt64): Git's root is two folders up.
    if (last === "bin" && /^(mingw|clang|ucrt)/.test(up)) return [win32.join(folder, "..", "..", "bin", "bash.exe")];
    return [win32.join(folder, "..", "bin", "bash.exe")];
  }
  return [];
}

export const NO_GIT_BASH_SENTENCE =
  "refused: on Windows, Claude Code runs this plugin's checks in Git Bash, and no Git Bash was found (none beside the git on PATH, none in Git for Windows' install folders). " +
  "Without it the checks would not run during the scan. Install Git for Windows (https://git-scm.com/downloads/win), or set CLAUDE_CODE_GIT_BASH_PATH to the full path of its bin\\bash.exe, then run this command again. Nothing was started.";

/**
 * The Git Bash for the Claude Code session `legal-scan session` starts (see the module's comment): on Windows, the
 * variables to set (`CLAUDE_CODE_GIT_BASH_PATH`, where the person has not set it) or a refusal; elsewhere nothing.
 */
export function gitBashForSession(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, look: GitBashLook = COMPUTER): GitBashChoice {
  if (platform !== "win32") return { set: {}, found: null };
  const named = windowsVariable(env, GIT_BASH_ENV);
  if (named !== null) {
    if (win32.isAbsolute(named) && /^([a-z]:[\\/]|\\\\)/i.test(named) && look.isFile(named)) return { set: {}, found: named };
    return {
      refused:
        `refused: ${GIT_BASH_ENV} is set to ${JSON.stringify(named)}, which is not the full path of a file, so Claude Code would not find Git Bash and this plugin's checks would not run during the scan. ` +
        "Set it to the full path of Git for Windows' bin\\bash.exe, or unset it, then run this command again. Nothing was started.",
    };
  }
  const git = look.gitOnPath();
  const places = [
    ...(git === null ? [] : besideGit(git)),
    ...["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"].map((k) => windowsVariable(env, k)).filter((v): v is string => v !== null).map((base) => win32.join(base, "Git", "bin", "bash.exe")),
    ...[windowsVariable(env, "LOCALAPPDATA")].filter((v): v is string => v !== null).map((base) => win32.join(base, "Programs", "Git", "bin", "bash.exe")),
  ];
  const found = places.find((p) => win32.isAbsolute(p) && look.isFile(p) && !look.avoided(p));
  if (found === undefined) return { refused: NO_GIT_BASH_SENTENCE };
  return { set: { [GIT_BASH_ENV]: found }, found };
}
