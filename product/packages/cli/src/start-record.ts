/**
 * Whether the start question is put is decided by the person's own
 * record, never by a file the scanned repository can carry.
 *
 * The start question shows the time and the amount of the person's plan before step 2 spends it. Until this brief it
 * was put only where `<project>/.legal/reports/` held no report, so a repository that commits a report folder made a
 * person who had never scanned it start a paid review without seeing the price. Whether this person has seen this
 * project's price is a fact about the person's run, not about the code: it is read from a record this program writes on
 * the person's machine, outside the scanned folder, when the person's answer to a question that showed the price starts
 * the review - "Start" to the start question, or a plan chosen from the run-shape question's price table
 * (`/legal-scan plan`). "Not now" writes no record, and neither does a shape named on the command line (`--shape`,
 * outside Claude Code), where nothing shows that the price was seen. A committed `.legal/reports/` does nothing to this
 * decision.
 *
 * The place: the platform's user state folder, read by this program from the operating system and the person's own
 * environment, never typed by the model and never inside the scanned folder. Claude Code's documented place for a
 * plugin's own data, `${CLAUDE_PLUGIN_DATA}` (`~/.claude/plugins/data/<id>/`), is exported only to hook, MCP and LSP
 * processes and substituted into skill text; it is not in the environment of a command run through the Bash tool,
 * which is how the skill runs this program, so reaching it would mean the model typing the path on the command line.
 * The one rule therefore serves a run inside Claude Code and a run outside it alike:
 *   - `XDG_STATE_HOME`, where it is set to an absolute path (the XDG Base Directory specification; a relative value is
 *     invalid there and ignored);
 *   - else Windows: `%LOCALAPPDATA%` (the per-user, non-roaming application data folder);
 *   - else macOS: `~/Library/Application Support`;
 *   - else `~/.local/state` (the specification's default for `XDG_STATE_HOME`);
 * each followed by `legal-scan/start-question/`.
 *
 * The key: the SHA-256 of the scanned folder's real path (symbolic links resolved), and the record holds that path,
 * which must match. A folder moved or cloned again to another path has no record there, so its next scan asks; a folder
 * deleted and cloned again to the same path keeps the record, as the same person on the same machine has seen that
 * project's price there.
 *
 * The safe direction is to ask: no state folder, a scanned folder whose real path cannot be read, a missing record, an
 * unreadable one, one that is not a plain file, one another user owns, one that names another folder or another kind,
 * and any record or record folder lying inside the scanned folder (a state folder pointed into it, or reached through a
 * link into it) all leave the start question put. A record that cannot be written is said, and the next scan asks.
 */
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { makeFolder, removePath, renamePath, writeFileAt } from "./project-write.js";
import { homedir, userInfo } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { relativePath } from "./project-path.js";
import { readRegularFile } from "./project-read.js";

export const START_RECORD_KIND = "start-question-record";
export const START_RECORD_VERSION = 1;
/** The folder under the platform's user state folder, and the records' folder under it. */
export const STATE_APP_DIR = "legal-scan";
export const START_RECORD_DIR = "start-question";
/**
 * The redaction key's spare folder's name in the temporary folder, followed by `-<uid>` where the system has user ids
 * (redaction-key.ts `spareKeyFolderPath`). Here, beside the state folder's name, so that hook.ts reads it without
 * loading redaction-key.ts; the hooks' shim reads both from bin/fast-places.bash, which the workspace's generator
 * (npm run gen:fast-places) writes from them.
 */
export const SPARE_KEY_FOLDER = "wolfboy-redaction-key";
/** The person's environment variables that name the state folder (host-env.ts SHELL_ENV_NAMES). */
export const STATE_HOME_ENV = "XDG_STATE_HOME";
export const LOCAL_APP_DATA_ENV = "LOCALAPPDATA";

/** What the record holds. Nothing in it is read but `kind`, `version` and `project`. */
export interface StartRecord {
  kind: typeof START_RECORD_KIND;
  version: typeof START_RECORD_VERSION;
  /** The scanned folder's real path, which the record's file name is the SHA-256 of. */
  project: string;
  /** Which question showed the price: the start question, or the run-shape question (`/legal-scan plan`). */
  question: "start" | "run-shape";
  answer: string;
  run_id: string;
  scan_id: string;
  recorded_at: string;
}

/**
 * This program's folder in the platform's user state folder, or null where none can be named. Every input is the
 * caller's (the CLI passes its own environment, platform and home folder); nothing here reads the scanned folder.
 */
export function userStateDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string | null {
  const xdg = env[STATE_HOME_ENV];
  if (xdg !== undefined && xdg !== "" && isAbsolute(xdg)) return join(xdg, STATE_APP_DIR);
  if (platform === "win32") {
    const local = env[LOCAL_APP_DATA_ENV];
    return local !== undefined && local !== "" && isAbsolute(local) ? join(local, STATE_APP_DIR) : null;
  }
  if (home === "" || !isAbsolute(home)) return null;
  if (platform === "darwin") return join(home, "Library", "Application Support", STATE_APP_DIR);
  return join(home, ".local", "state", STATE_APP_DIR);
}

/**
 * THE STATE FOLDER NEVER MOVES SILENTLY. Claude Code applies a
 * project's own `.claude/settings.json` and `.claude/settings.local.json` `env` to the session's commands and hooks, so a
 * scanned repository could set `XDG_STATE_HOME`, `HOME` or `LOCALAPPDATA` and make every record of the person's read as
 * "nothing recorded on this computer" (their decisions, confirmations and log marks gone at once). A value of one of
 * those names that equals the one a project settings file gives is not used: the folder is placed from the rest of the
 * environment and the OS account's own home folder (`os.userInfo().homedir`, never an environment value), and the person
 * is told in one sentence. The person's own settings (the account home's `.claude`) are not read here: their values
 * are honoured. Every input is the caller's.
 */
export const STATE_PLACE_ENVS: readonly string[] = [STATE_HOME_ENV, "HOME", LOCAL_APP_DATA_ENV];
/**
 * The variable that names the home folder for a program
 * on this platform: the one Node's `os.homedir()` reads first (libuv `uv_os_homedir`), USERPROFILE on Windows and HOME
 * elsewhere. On Windows HOME names no home for this program or for Claude Code (both read `os.homedir()`); Git Bash sets
 * HOME for the shell it runs, and a person may set it for other tools (a network home drive, an editor's settings), so
 * it says nothing about whether a process runs as the account's own there.
 */
export const USER_PROFILE_ENV = "USERPROFILE";
export function homeEnvName(platform: NodeJS.Platform): string {
  return platform === "win32" ? USER_PROFILE_ENV : "HOME";
}
/** The names a project's settings file is read for: the state folder's (above) and the home folder's on Windows. */
const PROJECT_SET_ASIDE_ENVS: readonly string[] = [...STATE_PLACE_ENVS, USER_PROFILE_ENV];
/** The one sentence. */
export const STATE_DIR_WORDS = {
  moved: (names: readonly string[], file: string, dir: string | null) =>
    `WolfBoy: the scanned project's own Claude Code settings (${file}) set ${names.join(" and ")}, which would move your state folder; WolfBoy keeps your records in ${dir ?? "no state folder (none can be named)"} instead.`,
};

/**
 * ONE NAME WHATEVER ITS CASE, ON WINDOWS. Windows
 * reads environment names without regard to case, so a project settings key `UserProfile` or `localappdata` is that
 * variable there; the set-aside compared the names as written, so such a key moved the home or the state folder past it.
 * Names are compared without regard to case on Windows and as written elsewhere, and every value a variable holds under
 * any spelling of its name is compared.
 */
export function envNameIs(key: string, name: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" ? key.toUpperCase() === name.toUpperCase() : key === name;
}
function envValuesOf(env: Readonly<Record<string, unknown>>, name: string, platform: NodeJS.Platform): string[] {
  if (platform !== "win32") return typeof env[name] === "string" ? [env[name] as string] : [];
  return Object.entries(env).flatMap(([k, v]) => (envNameIs(k, name, platform) && typeof v === "string" ? [v] : []));
}
/** Whether the environment holds, for `name`, a value a project's settings file gives it. */
function heldFromProject(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform, projectEnv: ReadonlyMap<string, { value: string; file: string; values?: readonly string[] }>): boolean {
  const s = projectEnv.get(name);
  if (s === undefined) return false;
  const given = s.values ?? [s.value];
  return envValuesOf(env, name, platform).some((v) => given.includes(v));
}

/**
 * The values the project settings files give the names above (the state folder's names, and USERPROFILE, the home
 * folder's name on Windows), with the file that gives each (the first found wins; `values`: every value any of them
 * gives the name, under any spelling Windows reads as it).
 */
export function projectStateEnv(
  dirs: readonly string[],
  read: (path: string) => string | null,
  platform: NodeJS.Platform = process.platform,
): Map<string, { value: string; file: string; values: string[] }> {
  const out = new Map<string, { value: string; file: string; values: string[] }>();
  for (const d of dirs) {
    for (const name of ["settings.local.json", "settings.json"]) {
      const file = join(d, ".claude", name);
      const text = read(file);
      if (text === null) continue;
      let env: unknown;
      try {
        env = (JSON.parse(text) as { env?: unknown }).env;
      } catch {
        continue;
      }
      if (typeof env !== "object" || env === null || Array.isArray(env)) continue;
      for (const n of PROJECT_SET_ASIDE_ENVS) {
        const vs = envValuesOf(env as Record<string, unknown>, n, platform);
        if (vs.length === 0) continue;
        const had = out.get(n);
        if (had === undefined) out.set(n, { value: vs[0] as string, file, values: [...vs] });
        else had.values.push(...vs);
      }
    }
  }
  return out;
}

/** The state folder, and the sentence where a project's settings would have moved it. */
export function stateDirFor(args: {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  home: string;
  accountHome: string;
  projectEnv: ReadonlyMap<string, { value: string; file: string; values?: readonly string[] }>;
}): { dir: string | null; note: string | null } {
  const moved = STATE_PLACE_ENVS.filter((n) => heldFromProject(args.env, n, args.platform, args.projectEnv));
  if (moved.length === 0) return { dir: userStateDir(args.env, args.platform, args.home), note: null };
  const env: NodeJS.ProcessEnv = { ...args.env };
  for (const n of moved) for (const k of Object.keys(env)) if (envNameIs(k, n, args.platform)) delete env[k];
  const home = moved.includes("HOME") ? args.accountHome : args.home;
  if (args.platform === "win32" && moved.includes(LOCAL_APP_DATA_ENV) && args.accountHome !== "" && isAbsolute(args.accountHome)) env[LOCAL_APP_DATA_ENV] = join(args.accountHome, "AppData", "Local");
  const dir = userStateDir(env, args.platform, home);
  return { dir, note: STATE_DIR_WORDS.moved(moved, args.projectEnv.get(moved[0])?.file ?? ".claude/settings.json", dir) };
}

/** The folders whose `.claude` settings are the project's: Claude Code's project folder and the working folder up, short of the homes. */
function projectSettingsDirs(env: NodeJS.ProcessEnv, homes: readonly string[]): string[] {
  const out: string[] = [];
  const add = (d: string): void => {
    if (d !== "" && isAbsolute(d) && !homes.includes(d) && !out.includes(d)) out.push(d);
  };
  if (typeof env.CLAUDE_PROJECT_DIR === "string") add(env.CLAUDE_PROJECT_DIR);
  let d = process.cwd();
  for (let i = 0; i < 64; i += 1) {
    if (homes.includes(d)) break;
    add(d);
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  return out;
}

let toldMoved: string | null = null;
/** The state folder for this process, and the home folder its rule used (a project setting's HOME set aside). */
function processPlace(): { dir: string | null; home: string } {
  let home = "";
  try {
    home = homedir();
  } catch {
    home = "";
  }
  // The account's home is the anchor's: the OS account's
  // (`accountHomeNow`), or a test's scratch account under the seam, so that a project's HOME or USERPROFILE set aside
  // sends a test's process to the scratch account, never to the person's own state folder (a gate leaked a record there).
  const accountHome = anchorHome();
  const readSmall = (p: string): string | null => {
    try {
      return lstatSync(p).isFile() && lstatSync(p).size <= 256 * 1024 ? readRegularFile(p, "utf8") : null;
    } catch {
      return null;
    }
  };
  const projectEnv = projectStateEnv(projectSettingsDirs(process.env, [home, accountHome].filter((h) => h !== "")), readSmall);
  const r = stateDirFor({ env: process.env, platform: process.platform, home, accountHome, projectEnv });
  if (r.note !== null && toldMoved !== r.note) {
    toldMoved = r.note;
    process.stderr.write(`${r.note}\n`);
  }
  return { dir: r.dir, home: processHomeFor({ env: process.env, platform: process.platform, home, accountHome, projectEnv }) };
}
/**
 * The home folder a process runs under, as `homeIsAnchor`
 * reads it: `home` (what `os.homedir()` gave), unless the platform's home variable (`homeEnvName`: HOME, or USERPROFILE on
 * Windows) holds the value a project's settings file gives it, which is set aside for the account's home, as `stateDirFor`
 * sets aside the state folder's names. Before, only a project's HOME was set aside, on every platform; on Windows
 * `os.homedir()` never reads HOME, so a scanned repository whose settings set USERPROFILE kept the plugin from recording
 * its sessions in the anchor there. Every input is the caller's.
 */
export function processHomeFor(args: {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  home: string;
  accountHome: string;
  projectEnv: ReadonlyMap<string, { value: string; file: string; values?: readonly string[] }>;
}): string {
  return heldFromProject(args.env, homeEnvName(args.platform), args.platform, args.projectEnv) ? args.accountHome : args.home;
}
/** The state folder for this process: its own environment and platform, and the OS account's home where a project's settings would move it. */
export function processStateDir(): string | null {
  return processPlace().dir;
}

/**
 * THE ANCHOR: the OS account's own
 * state folder (`accountStateDir` of `os.userInfo().homedir`, the account database's home, never an environment value),
 * where the plugin's SessionStart hook records each session with the state folder it used (plugin-sessions.ts). A command
 * can set XDG_STATE_HOME, HOME or LOCALAPPDATA and so name any state folder it likes; it cannot move this one.
 *
 * `ANCHOR_HOME_SEAM`: a value only code running inside this process can set (a test's preload, `node --import`), never
 * an environment variable or a file: the gates put the anchor in a scratch home with it, so that no test reads or writes
 * the person's own. A command that loads code into the program can do anything the program can; that is the stated
 * limit (an edited program), not a route this closes.
 */
export const ANCHOR_HOME_SEAM = Symbol.for("wolfboy.anchor-home");
export function anchorHome(): string {
  const seam = (globalThis as unknown as Record<symbol, unknown>)[ANCHOR_HOME_SEAM];
  return typeof seam === "string" && seam !== "" ? seam : accountHomeNow();
}
export function anchorStateDir(platform: NodeJS.Platform = process.platform): string | null {
  return accountStateDir(platform, anchorHome());
}
/**
 * Whether this process runs as the OS account's own: its home folder (`processHomeFor`: what `os.homedir()` reads, HOME,
 * or USERPROFILE on Windows, with a project setting's value set aside) is the anchor's. A process whose home names another
 * folder runs in an environment built apart from the account (`sudo -E`, a container, a gate's scratch home), and writes
 * nothing into the anchor: there the state folder's own record decides, as before the anchor. A command run by the AI can
 * set its own HOME, but that only keeps the anchor from being written, never from being read.
 * On Windows the home is USERPROFILE, which Windows sets
 * from the account's profile and which Claude Code and this program read as the home: so every session a person starts
 * there records its state folder in the anchor, whatever HOME their Git Bash or their own settings give (a network home
 * drive, an editor's HOME), and an environment built apart names another USERPROFILE (the gates name a scratch one).
 */
export function homeIsAnchor(platform: NodeJS.Platform = process.platform): boolean {
  const home = processPlace().home;
  const anchor = anchorHome();
  return home !== "" && anchor !== "" && canonicalPath(home, platform) === canonicalPath(anchor, platform);
}

/**
 * A name as the file system compares it: on macOS in Unicode NFC (APFS
 * ignores the normalisation, so `café` typed as NFD names the NFC folder) and in lower case, on Windows in lower case
 * (both volumes ignore case by default). Folding a case-sensitive volume's names too only finds more alike.
 */
export function foldName(path: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === "darwin") return path.normalize("NFC").toLowerCase();
  return platform === "win32" ? path.toLowerCase() : path;
}
/**
 * A path as the file system names it, for comparing and for a record's
 * key: the real path of its nearest existing folder as the operating system reads it (`realpathSync.native`: on Windows
 * an 8.3 short name such as `LONGNA~1` comes back as the long name, on macOS the names as the volume stores them), with
 * the rest as written, then `foldName`. Nothing below the nearest existing folder need exist (a case-folded name on a
 * case-sensitive volume names no folder, and a record keyed by it is still written).
 */
export function canonicalPath(path: string, platform: NodeJS.Platform = process.platform): string {
  let at = resolve(path);
  const rest: string[] = [];
  for (;;) {
    try {
      return foldName(join(realpathSync.native(at), ...rest), platform);
    } catch {
      const up = dirname(at);
      if (up === at) return foldName(resolve(path), platform);
      rest.unshift(basename(at));
      at = up;
    }
  }
}

const within = (child: string, parent: string): boolean => {
  const r = relativePath(parent, child);
  return r === "" || (r !== ".." && !r.startsWith("../") && !isAbsolute(r));
};

/** The OS account's home folder (`os.userInfo().homedir`), or "" where it cannot be read. Never an environment value. */
export function accountHomeNow(): string {
  try {
    return userInfo().homedir;
  } catch {
    return "";
  }
}
/**
 * The state folder the OS account's home gives with no environment value, or null
 * where none can be named: where the person's records are kept unless the environment names another folder, which is
 * honoured and said (`stateFolderUsed`).
 */
export function accountStateDir(platform: NodeJS.Platform, accountHome: string): string | null {
  if (accountHome === "" || !isAbsolute(accountHome)) return null;
  const env: NodeJS.ProcessEnv = platform === "win32" ? { [LOCAL_APP_DATA_ENV]: join(accountHome, "AppData", "Local") } : {};
  return userStateDir(env, platform, accountHome);
}
/**
 * What the evidence log records of the state folder a command used (FC2 item 3: a
 * value on the command line moved it with no sentence). `path`: the folder, written from `~` where it lies in the OS
 * account's home (the account's name is not written into a file that may be shared), null where none could be named;
 * `account_default`: whether it is the folder the account's home gives with no environment value. Where it is not, the
 * end screen says so in one line (assemble-report.ts `stateFolderLine`); nothing is printed on stderr.
 */
export interface StateFolderUsed {
  path: string | null;
  account_default: boolean;
}
export function stateFolderUsed(dir: string | null, platform: NodeJS.Platform = process.platform, accountHome: string = accountHomeNow()): StateFolderUsed {
  const def = accountStateDir(platform, accountHome);
  const fold = (p: string): string => (platform === "win32" || platform === "darwin" ? resolve(p).toLowerCase() : resolve(p));
  let same = dir !== null && def !== null && fold(dir) === fold(def);
  if (!same && dir !== null && def !== null) {
    try {
      same = realpathSync(dir) === realpathSync(def);
    } catch {
      same = false;
    }
  }
  if (dir === null) return { path: null, account_default: def === null };
  const home = def === null ? null : resolve(accountHome);
  const abs = resolve(dir);
  return { path: home !== null && within(abs, home) ? join("~", relativePath(home, abs)) : abs, account_default: same };
}

/**
 * The start record's place for one scanned folder, and its key: the file is named by the SHA-256 of the folder's real
 * path. Exported so that the person's other records in the state folder
 * (state-record.ts) are keyed by this one rule; its behaviour is unchanged.
 */
export type Place = { ok: true; project: string; path: string } | { ok: false; why: string };

/** Every scanned folder this process has keyed a record by (`placeOf`), as real paths. */
const scannedNoted = new Set<string>();
/** The scanned folders this process has named so far: the redaction key's place rule refuses a state folder inside any of them. */
export function scannedFoldersNoted(): readonly string[] {
  return [...scannedNoted];
}
/** Note `target` as a scanned folder of this process before anything is keyed or digested (the redaction key's place rule). */
export function noteScannedFolder(target: string | undefined): void {
  if (typeof target !== "string" || target === "" || !isAbsolute(target)) return;
  try {
    scannedNoted.add(realpathSync(target));
  } catch {
    scannedNoted.add(resolve(target));
  }
}

export function placeOf(stateDir: string | null, target: string | undefined): Place {
  noteScannedFolder(target);
  return placeAsked(stateDir, target);
}

/**
 * `placeOf` without noting `target` as a folder this
 * process scans: for a lookup that asks about a folder (plugin-sessions.ts walks every folder above a path, up to the
 * root). Noting them made the root a scanned folder, so the state folder lay "inside the scanned folder": the redaction
 * key fell back to the spare one, every file digest of an earlier run counted as changed, and nothing was carried.
 */
export function placeAsked(stateDir: string | null, target: string | undefined): Place {
  if (stateDir === null) return { ok: false, why: "no user state folder could be named on this machine" };
  if (typeof target !== "string" || target === "" || !isAbsolute(target)) return { ok: false, why: "the findings name no absolute scanned folder" };
  let project: string;
  try {
    project = realpathSync(target);
  } catch (e) {
    return { ok: false, why: `the scanned folder's real path could not be read (${(e as Error).message})` };
  }
  const key = createHash("sha256").update(project).digest("hex");
  return { ok: true, project, path: join(stateDir, START_RECORD_DIR, `${key}.json`) };
}

/** The real path of `path`, or of the nearest folder above it that exists followed by the rest of `path`. */
export function realOfNearest(path: string): string {
  let at = resolve(path);
  const rest: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(at), ...rest);
    } catch {
      const up = dirname(at);
      if (up === at) return resolve(path);
      rest.unshift(basename(at));
      at = up;
    }
  }
}

/**
 * Whether the real path of `path` (or, where it does not exist, of the nearest folder above it) lies inside `project`.
 * Exported with `placeOf`. `project` is held
 * as written and as its real path (`realOfNearest`): a scanned folder named through a link (macOS's `/var` and `/tmp`
 * are links to `/private/...`) is the folder the link reaches, and a path inside it is inside it.
 */
export function landsInside(path: string, project: string, platform: NodeJS.Platform = process.platform): boolean {
  // As the file system compares names: on macOS and
  // Windows, whose volumes ignore case by default, a path spelled in another case names the same folder (the JavaScript
  // realpathSync keeps the case the caller wrote). Folding a case-sensitive volume's names too only finds more inside. And Unicode NFC on macOS, and the operating system's own reading of
  // the real path (an 8.3 short name on Windows is the long name): `foldName`, `canonicalPath`.
  const fold = (p: string): string => foldName(p, platform);
  const places = [...new Set([project, realOfNearest(project)].map(fold).concat(canonicalPath(project, platform)))];
  let at = path;
  for (;;) {
    try {
      const reals = [fold(realpathSync(at)), fold(realpathSync.native(at))];
      return reals.some((real) => places.some((p) => within(real, p)));
    } catch {
      const up = join(at, "..");
      if (up === at) return false;
      at = up;
    }
  }
}

export type StartRecordRead = { shown: true; path: string } | { shown: false; why: string };

/** Whether this person was shown this project's price before, from the record alone. Any doubt reads as not shown. */
export function readStartRecord(stateDir: string | null, target: string | undefined): StartRecordRead {
  const place = placeOf(stateDir, target);
  if (!place.ok) return { shown: false, why: place.why };
  const { project, path } = place;
  if (landsInside(path, project)) return { shown: false, why: `the record's place ${path} lies inside the scanned folder, so it is not read` };
  let st: import("node:fs").Stats;
  try {
    st = lstatSync(path);
  } catch {
    return { shown: false, why: "no record that the person was shown this project's price on this machine" };
  }
  if (!st.isFile()) return { shown: false, why: `the record ${path} is not a plain file` };
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid !== null && st.uid !== uid) return { shown: false, why: `the record ${path} belongs to another user` };
  let rec: Partial<StartRecord>;
  try {
    rec = JSON.parse(readRegularFile(path, "utf8")) as Partial<StartRecord>;
  } catch (e) {
    return { shown: false, why: `the record ${path} could not be read (${(e as Error).message})` };
  }
  if (rec === null || typeof rec !== "object" || rec.kind !== START_RECORD_KIND || rec.version !== START_RECORD_VERSION) {
    return { shown: false, why: `the record ${path} is not this program's record` };
  }
  if (rec.project !== project) return { shown: false, why: `the record ${path} names another folder` };
  return { shown: true, path };
}

export type StartRecordWrite = { written: true; path: string } | { written: false; why: string };

/** Record that the person's answer to a question that showed this project's price started the review. */
export function writeStartRecord(
  stateDir: string | null,
  target: string | undefined,
  what: Pick<StartRecord, "question" | "answer" | "run_id" | "scan_id">,
  now: Date,
): StartRecordWrite {
  const place = placeOf(stateDir, target);
  if (!place.ok) return { written: false, why: place.why };
  const { project, path } = place;
  const dir = join(path, "..");
  // Checked before the folder is made (nothing is written into the scanned folder) and again after (a link made since).
  if (landsInside(dir, project)) return { written: false, why: `its place ${dir} lies inside the scanned folder` };
  // The state folder is the person's, outside the project; only the scanner's own folder and file in it are
  // looked at for a link (project-write.ts), from the folder that holds them.
  const within = dirname(dir);
  try {
    makeFolder(dir, { recursive: true, mode: 0o700, within });
  } catch (e) {
    return { written: false, why: `its folder ${dir} could not be made (${(e as Error).message})` };
  }
  if (landsInside(dir, project)) return { written: false, why: `its place ${dir} lies inside the scanned folder` };
  const rec: StartRecord = { kind: START_RECORD_KIND, version: START_RECORD_VERSION, project, ...what, recorded_at: now.toISOString() };
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileAt(tmp, `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600, within });
    renamePath(tmp, path, { within });
  } catch (e) {
    removePath(tmp, { force: true, within });
    return { written: false, why: `${path} could not be written (${(e as Error).message})` };
  }
  return { written: true, path };
}

/**
 * WHAT TO DO WHERE THE STATE FOLDER CANNOT BE
 * WRITTEN (a read-only home, a locked-down workstation, a container): the sentence that says a record was not kept says it
 * too. Empty where the reason is not a folder this user may not write.
 */
export function stateFolderAdvice(why: string): string {
  return /EACCES|EPERM|EROFS/.test(why)
    ? ` To keep these records, set ${STATE_HOME_ENV} to a folder you can write (on Windows, ${LOCAL_APP_DATA_ENV} also names one) and run again.`
    : "";
}
