/**
 * THE PROGRAMS THE CLI STARTS BY NAME, AND WHAT THE SCANNED FOLDER CAN CHOOSE OF THEM.
 *
 * The class. `git ls-files` in the scanned folder ran the command its own `.git/config` names as `core.fsmonitor`: a
 * folder copied or unpacked whole (with its `.git` folder; a clone never carries `.git/config`) chose a program the
 * scan then ran. Two things can choose a program for a child process: what the program reads (git reads the
 * repository's own config, and the attributes that name its drivers), and where the program is found (a PATH that
 * holds a relative folder, or the project folder, finds the scanned folder's own `git` or `claude` file).
 *
 * Every child process the CLI starts, and who chooses its program:
 * - git (legal-dir.ts `legalIgnoreLeaks`: `rev-parse --is-inside-work-tree`, `check-ignore --no-index`, `ls-files`),
 *   and the one config listing below: `gitRunner`, here. The program is `programOnPath("git")`, outside the working
 *   folder, every declared project folder (`--target` among them) and CLAUDE_PROJECT_DIR (`foldersNoProgramComesFrom`); every configuration key
 *   git's documentation names as running a program is set from the environment to a value that runs nothing
 *   (`GIT_NEUTRAL`, and each driver's keys the folder's config names), transports are refused, and the pager is off.
 *   Where git is not run (not found outside the project, older than 2.31, or its config unreadable), the person is
 *   told so, and why, by the same function; no file a scan reads comes from git (walk.ts).
 * - git for the saved answers' question (team-answers.ts `commitFactsOf`: `status
 *   --porcelain`, `log -1`, `symbolic-ref` and `merge-base --is-ancestor` on the record file), through `gitRunnerOrWhy`.
 * - git for the record (assemble-report.ts `scanCommitOf`: `rev-parse` and `log -1` of
 *   HEAD, and `status --porcelain --untracked-files=no` under the folder, at assembly; record.ts `earlierLogOf`: `rev-parse`
 *   of the tag or commit `--since` names), each with `--no-optional-locks`, through `gitRunnerOrWhy`.
 * - Claude Code (index.ts `session`): `--claude <command>`; a bare name is found by `programOnPath`.
 * - The CLI itself (hook-capture.ts, `process.execPath` and the CLI's own file), the hooks' child (hook.ts,
 *   `process.execPath` and `hook-child.js` beside it), and `test-rules`' own scan (`process.execPath`): absolute paths
 *   of the program's own, chosen by nothing the folder holds.
 * - The plugin's launcher and the hooks' shim (`product/plugin/bin/legal-scan`, `legal-hook`): `/bin/bash -p` by its
 *   absolute path and the `node` node-choice.bash finds, outside the project and the working folder, the same rule
 *   as `programOnPath`.
 * - Claude Code's own ripgrep (host-search.ts `hostEngineNow`, `runHostEngine`): the executable
 *   CLAUDE_CODE_EXECPATH names, by its real path, refused inside every folder `foldersNoProgramComesFrom` returns and the
 *   searched tree (`programFolderHolding`); started as `rg` with `--no-config` first, so no configuration file is read,
 *   and with no argument that runs another program (no `--pre`, no `--search-zip`).
 * `test:project-writes` part 1 holds this list: a module of the CLI's build that reaches `node:child_process` and is not
 * on its reviewed list fails it.
 */
import { spawnSync } from "node:child_process";
import type { SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from "node:child_process";
import { accessSync, constants, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { sniffRegular } from "./project-read.js";
import { declaredProjectFolders } from "./project-write.js";

/** PATH, read to find git and Claude Code outside the project folder; host-env.ts lists it as the shell's. */
export const PATH_ENV = "PATH";

const inside = (path: string, folder: string): boolean => path === folder || path.startsWith(folder.endsWith(sep) ? folder : `${folder}${sep}`);
const realOr = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

/**
 * THE FOLDERS NO PROGRAM IS TAKEN FROM: the working folder, every project
 * folder the command declared (`--target` is one: index.ts `preAction`), CLAUDE_PROJECT_DIR, and `extra` (the folder a
 * caller runs the program in). Until this change git avoided only the folder holding `.legal` and CLAUDE_PROJECT_DIR, so
 * with `--target sub`, or `--out` outside the target, an absolute PATH entry into the scanned repository found the
 * repository's own `git`, and the scan ran it.
 */
export function foldersNoProgramComesFrom(...extra: string[]): string[] {
  return [process.cwd(), process.env.CLAUDE_PROJECT_DIR ?? "", ...declaredProjectFolders(), ...extra];
}

/**
 * For a program named by an absolute path rather than found on PATH: the first folder of `outside`
 * (each compared by its real path, as `programOnPath` compares them) that holds the program's real path, or null.
 */
export function programFolderHolding(program: string, outside: string[]): string | null {
  const real = realOr(program);
  return outside.filter((f) => f !== "").map(realOr).find((f) => inside(real, f)) ?? null;
}

/**
 * THE CLAUDE CODE THAT THE VS CODE EXTENSION INSTALLED. The extension does not
 * put `claude` on PATH, but it ships the whole command-line tool at
 * `<editor>/extensions/anthropic.claude-code-<version>-<platform>/resources/native-binary/claude` (`claude.exe` on
 * Windows); version 2.1.319 on linux-x64 was read on this machine and runs `--version`, `--resume` and `--effort`. It
 * signs in with the same Claude Code configuration as the extension. The folders are VS Code's own, its Insiders build's,
 * its remote server's (WSL, SSH, containers) and Cursor's, under the home folder; the highest version found wins. The
 * rule `programOnPath` applies holds here too: nothing under a folder of `outside` is taken.
 */
export function claudeOfEditorExtension(outside: string[], home: string = homedir()): string | null {
  const avoid = outside.filter((f) => f !== "").map(realOr);
  const exe = process.platform === "win32" ? "claude.exe" : "claude";
  const found: { v: number[]; p: string }[] = [];
  for (const editor of [".vscode", ".vscode-insiders", ".vscode-server", ".vscode-server-insiders", ".cursor", ".cursor-server"]) {
    const dir = join(home, editor, "extensions");
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names) {
      const m = /^anthropic\.claude-code-(\d+)\.(\d+)\.(\d+)(?:-[a-z0-9-]+)?$/.exec(n);
      if (!m) continue;
      const p = join(dir, n, "resources", "native-binary", exe);
      try {
        if (!statSync(p).isFile()) continue;
        if (process.platform !== "win32") accessSync(p, constants.X_OK);
      } catch {
        continue;
      }
      if (avoid.some((a) => inside(realOr(p), a))) continue;
      found.push({ v: [Number(m[1]), Number(m[2]), Number(m[3])], p });
    }
  }
  found.sort((a, b) => b.v[0] - a.v[0] || b.v[1] - a.v[1] || b.v[2] - a.v[2]);
  return found[0]?.p ?? null;
}

/**
 * The first `name` on PATH that is an executable file in an absolute folder outside every folder of `outside` (each
 * compared by its real path, so a link into one is skipped too): the rule node-choice.bash applies to `node`. A
 * relative PATH entry is skipped. Null where there is none.
 */
export function programOnPath(name: string, outside: string[]): string | null {
  const avoid = outside.filter((f) => f !== "").map(realOr);
  const names = namesOnPath(name, process.platform);
  for (const folder of (process.env[PATH_ENV] ?? "").split(delimiter)) {
    if (folder === "" || !isAbsolute(folder)) continue;
    let real: string;
    try {
      real = realpathSync(folder);
    } catch {
      continue;
    }
    if (avoid.some((a) => inside(real, a))) continue;
    for (const n of names) {
      const p = join(real, n);
      try {
        if (!statSync(p).isFile()) continue;
        accessSync(p, constants.X_OK);
        return p;
      } catch {
        // not here
      }
    }
  }
  return null;
}

/**
 * The file names `programOnPath` tries for `name` in each folder. Elsewhere than Windows,
 * the name itself. On Windows a file with no extension is never a program Windows can start (npm puts a shell script
 * `claude` beside `claude.cmd`, and it stood first in this list until W1, so an npm-installed Claude Code was "found" as
 * a file no process can be made of): a name with an extension is tried as it is, any other with the extensions a
 * Windows shell tries, in its order (`.com`, `.exe`, `.bat`, `.cmd`).
 */
export function namesOnPath(name: string, platform: NodeJS.Platform): string[] {
  if (platform !== "win32") return [name];
  if (/\.[^.\\/]+$/.test(name)) return [name];
  return [".com", ".exe", ".bat", ".cmd"].map((ext) => `${name}${ext}`);
}

/**
 * How to start a program with no shell between: the file a process is made of (null: the Node this program runs on), and
 * the arguments that go before the caller's.
 */
export type ProgramStart = { file: string | null; lead: string[] } | { refused: string };

/**
 * HOW A PROGRAM FOUND BY PATH IS STARTED, WITH NO SHELL. Elsewhere than Windows, and
 * on Windows for any program that is not a batch file: the program itself. A Windows batch file (`.cmd`, `.bat`) is
 * not a program: Node refuses to start one without a shell (EINVAL, since its April 2024 security releases), and
 * through `cmd.exe` every argument would be read by cmd's own parser, where `%`, `^`, `&` and `"` mean something. So
 * a batch file is read instead, as scanner-command.ts reads npm's shim: a package manager's shim (npm's and pnpm's,
 * `"%dp0%\..."` or `"%~dp0\..."`) names the one file it runs, a JavaScript file (started with the `node.exe` beside the
 * shim where the shim would take that one, else with the Node this program runs on, `file` null, in place of the shim's
 * own PATH search for `node`) or an `.exe` (started as it is). `spawnStart` starts what this returns. The file it names is held to the rule `programOnPath` holds: not
 * under a folder of `outside`, compared by real paths. A batch file of any other form is refused, naming what to do.
 * Read with a cap (a shim is under a kilobyte) and only as a regular file.
 */
export function programStart(program: string, outside: string[], platform: NodeJS.Platform = process.platform): ProgramStart {
  if (platform !== "win32" || !/\.(?:cmd|bat)$/i.test(program)) return { file: program, lead: [] };
  const howTo =
    "Start the session with --claude naming Claude Code's own program (claude.exe, which Claude Code's installer for Windows puts in the .local\\bin folder of your home folder), or install Claude Code with that installer.";
  let text: string;
  try {
    const head = sniffRegular(program, 64 * 1024);
    if (!head.regular) return { refused: `${JSON.stringify(program)} is not a regular file. ${howTo}` };
    text = head.head.toString("utf8");
  } catch (e) {
    return { refused: `${JSON.stringify(program)} could not be read (${(e as Error).message}). ${howTo}` };
  }
  const named = new Set<string>();
  for (const m of text.matchAll(/"%~?dp0%?\\([^"%\r\n]+?\.(?:js|cjs|mjs|exe))"/gi)) {
    if (m[1]!.toLowerCase() !== "node.exe") named.add(m[1]!);
  }
  if (named.size !== 1) {
    return {
      refused: `${JSON.stringify(program)} is a Windows batch file, which this program does not start through cmd.exe (cmd would read every argument), and it is not a package manager's shim naming the one file it runs. ${howTo}`,
    };
  }
  const folder = dirname(program);
  const target = join(folder, ...[...named][0]!.split("\\"));
  let real: string;
  try {
    real = realpathSync(target);
    if (!statSync(real).isFile()) throw new Error("not a file");
  } catch {
    return { refused: `${JSON.stringify(program)} names ${JSON.stringify(target)}, which is not a file. ${howTo}` };
  }
  const held = programFolderHolding(real, outside);
  if (held !== null) {
    return { refused: `${JSON.stringify(program)} names ${JSON.stringify(real)}, inside ${held}, and no program is taken from the working folder or a project folder. ${howTo}` };
  }
  if (/\.exe$/i.test(real)) return { file: real, lead: [] };
  const beside = join(folder, "node.exe");
  let nodeFile: string | null = null;
  try {
    if (statSync(beside).isFile() && programFolderHolding(beside, outside) === null) nodeFile = beside;
  } catch {
    // no node.exe beside the shim: the shim would search PATH for node; this program's own Node stands in
  }
  return { file: nodeFile, lead: [real] };
}

/** Start what `programStart` returned, with `args` after its leading arguments. */
export function spawnStart(start: { file: string | null; lead: string[] }, args: readonly string[], opts: SpawnSyncOptionsWithStringEncoding): SpawnSyncReturns<string> {
  return start.file === null ? spawnSync(process.execPath, [...start.lead, ...args], opts) : spawnSync(start.file, [...start.lead, ...args], opts);
}

/**
 * Every configuration key git 2.43's documentation (git-config(1), gitattributes(5), githooks(5); read 2026-10-20)
 * names as running a program, with no name of the folder's choosing inside it, and the value that runs nothing. The
 * keys with a driver, remote, tool or URL name inside them are found in the folder's config by `driverKeys`. Not here,
 * and why: `alias.*` (git never lets an alias stand for a built-in command, and the program runs only built-ins);
 * `trace2.*` (read from the system and global config only, never the repository's); `.gitmodules` (git does not take
 * a submodule's `update` command from it).
 */
export const GIT_NEUTRAL: ReadonlyArray<readonly [string, string]> = [
  ["core.fsmonitor", "false"], // an index read runs the hook it names
  ["core.hooksPath", "/dev/null"], // every hook, the default .git/hooks folder included, is looked up under it
  ["core.sshCommand", ""],
  ["core.gitProxy", ""],
  ["core.askPass", ""],
  ["core.editor", ":"], // ":" is git's own "no editor"
  ["sequence.editor", ":"],
  ["core.pager", "cat"], // "cat" is git's own "no pager"
  ["core.alternateRefsCommand", ""],
  ["credential.helper", ""], // an empty value empties the list
  ["diff.external", ""],
  ["gpg.program", ""],
  ["gpg.ssh.defaultKeyCommand", ""],
  ["gc.recentObjectsHook", ""],
  ["uploadpack.packObjectsHook", ""],
  ["interactive.diffFilter", ""],
  ["sendemail.toCmd", ""],
  ["sendemail.ccCmd", ""],
  ["sendemail.headerCmd", ""],
  ["sendemail.smtpServer", ""], // an absolute path here is a sendmail-like program
  ["imap.tunnel", ""], // git imap-send runs it to reach the server
  ["instaweb.httpd", ""], // git instaweb's web server
  ["protocol.allow", "never"], // no transport, remote helper or `ext::` command: nothing is fetched, lazily or not
  ["gc.auto", "0"], // no automatic gc, and so no pre-auto-gc hook
  ["maintenance.auto", "false"],
];

/** The variable names (the key's last part) that run a program where a driver, remote, tool or URL names the key. */
const PROGRAM_VARIABLES = new Map<string, string>([
  ["clean", ""], // filter.<driver>.*
  ["smudge", ""],
  ["process", ""],
  ["command", ""], // diff.<driver>.command
  ["textconv", ""], // diff.<driver>.textconv
  ["driver", ""], // merge.<driver>.driver
  ["vcs", ""], // remote.<name>.*
  ["receivepack", ""],
  ["uploadpack", ""],
  ["proxy", ""],
  ["helper", ""], // credential.<url>.helper
  ["program", ""], // gpg.<format>.program
  ["update", "none"], // submodule.<name>.update ("!command")
  ["cmd", ""], // difftool, mergetool, browser, man, guitool
  ["path", ""], // difftool, mergetool, browser, man (the tool's program)
  ["smtpserver", ""], // sendemail.<identity>.smtpServer
]);
/** Sections whose `<name>.path` is not a program. */
const NOT_PROGRAMS = new Set(["include", "includeif"]);

/** The child's environment: the overrides as git's own GIT_CONFIG_COUNT pairs, which nothing in a config file outranks. */
function gitEnv(pairs: ReadonlyArray<readonly [string, string]>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    // Removed: other command-line configuration (which would outrank these pairs) and the folder git's own programs
    // are taken from.
    if (/^GIT_CONFIG_(?:PARAMETERS|COUNT|KEY_\d+|VALUE_\d+)$/.test(k) || k === "GIT_EXEC_PATH") continue;
    env[k] = v;
  }
  pairs.forEach(([k, v], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = k;
    env[`GIT_CONFIG_VALUE_${i}`] = v;
  });
  // Set for the child, not read from the host: GIT_OPTIONAL_LOCKS - no opportunistic index write, so no hook on one;
  // GIT_NO_LAZY_FETCH (git 2.44 and later) - a missing object is not fetched.
  Object.assign(env, { GIT_CONFIG_COUNT: String(pairs.length), GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1" });
  return env;
}

/** The driver, remote, tool and URL keys the configuration git reads in `cwd` names, each with the value that runs nothing. */
function driverKeys(git: string, cwd: string): Array<[string, string]> | null {
  const r = spawnSync(git, ["--no-pager", "config", "--null", "--name-only", "--list"], {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "ignore"],
    env: gitEnv(GIT_NEUTRAL),
  });
  if (r.error || r.status !== 0) return null;
  const out: Array<[string, string]> = [];
  for (const key of r.stdout.split("\0")) {
    const parts = key.split(".");
    if (parts.length < 2) continue;
    const section = (parts[0] as string).toLowerCase();
    const variable = (parts[parts.length - 1] as string).toLowerCase();
    if (NOT_PROGRAMS.has(section)) continue;
    if (section === "pager" && parts.length === 2) out.push([key, "false"]); // pager.<command>
    const neutral = parts.length >= 3 ? PROGRAM_VARIABLES.get(variable) : undefined;
    if (neutral !== undefined) out.push([key, neutral]);
  }
  return out;
}

/**
 * Why this git may not be run, or null where it reads GIT_CONFIG_COUNT (git 2.31, March 2021): an older one would ignore
 * the overrides and read the folder's own keys, so it is not run at all. `git --version` reads no repository and starts
 * no program.
 */
function olderThanConfigCount(git: string, cwd: string): string | null {
  const r = spawnSync(git, ["--version"], { cwd, encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"], env: gitEnv(GIT_NEUTRAL) });
  const m = /\bversion ((\d+)\.(\d+)[0-9A-Za-z.]*)/.exec(r.stdout ?? "");
  if (r.error || r.status !== 0 || m === null) return `${git} --version gave no version this program can read`;
  const major = Number(m[2]);
  if (major > 2 || (major === 2 && Number(m[3]) >= 31)) return null;
  return `the git on PATH is ${m[1]}, older than 2.31: an older git does not take this program's settings from the environment (GIT_CONFIG_COUNT), so it would run any program this folder's own git configuration names`;
}

/** A way to run git in a folder, made by `gitRunner`. */
export type GitRunner = (args: string[]) => SpawnSyncReturns<string>;

/**
 * A way to run git in `cwd` so that nothing the folder holds chooses a program: git found outside `project`, `cwd`, the
 * working folder, every declared project folder and CLAUDE_PROJECT_DIR (`foldersNoProgramComesFrom`), every program key neutralised, transports refused, no pager. Where git is not run - not found,
 * older than 2.31 (it would not read the overrides), or its configuration cannot be read (git would stop on it anyway) -
 * `why` says so in words the person reads (legal-dir.ts `legalIgnoreLeaks` prints it). The folder's config
 * is listed once per runner.
 */
export function gitRunnerOrWhy(cwd: string, project: string = cwd): { run: GitRunner } | { why: string } {
  const git = programOnPath("git", foldersNoProgramComesFrom(project, cwd));
  if (git === null) return { why: "no git was found on PATH outside the project folders and the working folder" };
  const old = olderThanConfigCount(git, cwd);
  if (old !== null) return { why: old };
  const drivers = driverKeys(git, cwd);
  if (drivers === null) return { why: `${git} could not read this folder's git configuration` };
  const env = gitEnv([...GIT_NEUTRAL, ...drivers]);
  return { run: (args) => spawnSync(git, ["--no-pager", ...args], { cwd, encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"], env }) };
}

/** `gitRunnerOrWhy` without the reason: null where git is not run. */
export function gitRunner(cwd: string, project: string = cwd): GitRunner | null {
  const g = gitRunnerOrWhy(cwd, project);
  return "run" in g ? g.run : null;
}
