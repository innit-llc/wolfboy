/**
 * THE PROJECTS THE PLUGIN'S HOOKS RAN IN.
 *
 * WHY. Inside a Claude Code session some decisions are the person's alone: which earlier run is carried (`--previous`), the
 * run's shape (`--shape`), and that a run's launch list lies where the hooks read it. The program told "inside a session"
 * by environment variables (hook-launch.ts `claudeCodeSigns`), which the AI's own Bash command can remove
 * (`env -u CLAUDECODE -u CLAUDE_CODE_SESSION_ID -u WOLFBOY_SESSION_ID ...`) or set (`WOLFBOY_SESSION_ID=$CLAUDE_CODE_SESSION_ID`).
 * A check keyed to what the command controls is no guard. So the plugin's SessionStart hook records each session under
 * the project it runs in, and the program reads that record whatever the command's environment says.
 *
 * WHERE. The state folder is named by XDG_STATE_HOME, HOME or LOCALAPPDATA, which a command sets for
 * itself: a record kept only there was not found by a command that named a fresh folder, and a folder seeded with a
 * redaction key the repository shipped then carried a planted log. So the record is kept, first, in THE ANCHOR: the OS
 * account's own state folder, named from the account database's home (`os.userInfo().homedir`, start-record.ts
 * `anchorStateDir`), never from a variable. Each line there says which state folder the session used, whether its own
 * record there was written, and the sha256 of the redaction key that folder held when the session started. The program
 * finds the anchor's record from the folders a command names, and where one is found it refuses a run whose state
 * folder is not the one recorded, whose redaction key is not the one recorded, or whose state folder's own record of
 * the session is missing or cannot be read; and a record that exists and cannot be read is a refusal, never "no
 * record". The state folder's own record is still written and read: where the anchor holds nothing (below), it
 * decides as before.
 *
 * CI AND A FRESH COMPUTER. An account whose anchor holds no record for the folders a command names (a fresh CI runner, a
 * computer where the plugin's hooks never ran in that project) is told apart from a person's by the anchor's contents,
 * which a command's environment cannot move: there the command line is taken as before. Making a person's anchor look
 * fresh takes deleting their records, which is writing the files directly (the stated limit).
 *
 * WHAT IT CLOSES. In a project where the hooks ran for this account: a `--previous` named on the command line is taken only
 * where the state folder vouches for it (a log whose sha256 the assembly recorded there when WolfBoy wrote it), on the
 * bytes the carry reads (index.ts reads the file once); `--shape` on the command line is refused; the launch list goes
 * only to the project's `.legal/launch`, wherever the findings lie; a session id the hook never recorded there is not
 * taken as this session's; and a state folder or redaction key other than the recorded ones is refused. Spelling,
 * variables (the state folder's included) and a delayed or detached command change none of it.
 *
 * WHAT IT DOES NOT. A command that runs an edited copy of the program, or loads code into it (`node --import`, `NODE_OPTIONS`), or writes
 * these records or the state folder's files directly, is not stopped by anything in the program, and the report cannot
 * prove it was not forged so (the stated limit, product/plugin/README.md). A session whose hooks never ran in the
 * project (Windows with no Git Bash, a plugin enabled mid-session) wrote no record. A session started with its home (HOME,
 * USERPROFILE on Windows) naming another folder than the account's (`sudo -E`, a container) writes no anchor
 * (start-record.ts `homeIsAnchor`); its
 * state folder's own record decides there, as before. A copy of the project made outside it is another folder. A
 * command that removes Claude Code's variables reads as one typed at the person's terminal (no program can tell the two
 * apart); in a recorded project it is still held to everything above.
 *
 * The key: the project as the file system names it (start-record.ts `canonicalPath`: the operating system's real path,
 * NFC and lower case on macOS, lower case on Windows), hashed (state-record.ts `stateRecordPlaceKeyed`), so a spelling in
 * another case, Unicode form or 8.3 short name finds the same record, and a folded name that names no folder on a
 * case-sensitive volume is still written.
 */
import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { readRegularFile } from "./project-read.js";
import { REDACTION_KEY_FILE } from "./redaction-key.js";
import { anchorStateDir, canonicalPath, homeIsAnchor } from "./start-record.js";
import { appendStateRecordKeyed, PLUGIN_SESSIONS_RECORD, stateRecordPlaceKeyed, type StateRecordWrite } from "./state-record.js";
import { readLogDigests } from "./log-digest.js";

const sha256 = (b: string | Buffer): string => createHash("sha256").update(b).digest("hex");

/** The folder a record is keyed by: the project as the file system names it (`canonicalPath`). */
export function sessionRecordKey(folder: string, platform: NodeJS.Platform = process.platform): string {
  return canonicalPath(folder, platform);
}

/** Whether two state folders are one (both null, or the same folder as the file system names it). */
export function sameStateFolder(a: string | null, b: string | null, platform: NodeJS.Platform = process.platform): boolean {
  if (a === null || b === null) return a === b;
  return canonicalPath(a, platform) === canonicalPath(b, platform);
}

/** What a file read strictly gives: absent (nothing there), the text, or a reason it cannot be read. */
type Strict = { kind: "absent" } | { kind: "read"; text: string; path: string } | { kind: "unreadable"; why: string };

/** A file read so that "cannot be read" is never "absent": only a name that does not exist is absent. */
function readStrict(path: string): Strict {
  let st: import("node:fs").Stats;
  try {
    st = lstatSync(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
    return { kind: "unreadable", why: `${path} could not be read (${(e as Error).message})` };
  }
  if (!st.isFile()) return { kind: "unreadable", why: `${path} is not a plain file` };
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid !== null && st.uid !== uid) return { kind: "unreadable", why: `${path} belongs to another user` };
  try {
    return { kind: "read", text: readRegularFile(path, "utf8"), path };
  } catch (e) {
    return { kind: "unreadable", why: `${path} could not be read (${(e as Error).message})` };
  }
}

/** The record's file for the project `key` in `stateDir` (null where none can be named). */
function recordFile(stateDir: string | null, key: string): string | null {
  const place = stateRecordPlaceKeyed(stateDir, key, PLUGIN_SESSIONS_RECORD);
  return place.ok ? place.path : null;
}

/** The sha256 of the redaction key `stateDir` holds: none (no key there), the digest, or why it cannot be read. */
function keyDigestIn(stateDir: string | null): Strict | { kind: "digest"; sha256: string } {
  if (stateDir === null) return { kind: "absent" };
  const got = readStrict(join(stateDir, REDACTION_KEY_FILE));
  return got.kind === "read" ? { kind: "digest", sha256: sha256(got.text) } : got;
}

/** One line of a session record: the session, and in the anchor the state folder it used and that folder's key. */
interface SessionLine {
  session_id: string;
  project_dir?: string;
  state_dir?: string | null;
  state_record?: boolean;
  key_sha256?: string | null;
}
function linesOf(text: string): SessionLine[] {
  const out: SessionLine[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const row = JSON.parse(line) as Partial<SessionLine> | null;
      if (row !== null && typeof row === "object" && typeof row.session_id === "string" && row.session_id !== "") out.push(row as SessionLine);
    } catch {
      // a line of another form names no session
    }
  }
  return out;
}

/**
 * Records that the plugin's hooks ran for `sessionId` in `projectDir`: in the state folder (where it is not the anchor),
 * and in the anchor with the state folder used and its key's sha256, where this process runs as the account's own
 * (`homeIsAnchor`). Each write's result; a write that fails leaves the other.
 */
export function recordPluginSession(
  stateDir: string | null,
  projectDir: string,
  sessionId: string,
  at: Date,
  anchorDir: string | null = anchorStateDir(),
  ownAccount: boolean = homeIsAnchor(),
): { state: StateRecordWrite | null; anchor: StateRecordWrite | null } {
  const key = sessionRecordKey(projectDir);
  const inAnchor = anchorDir !== null && sameStateFolder(stateDir, anchorDir);
  const state = inAnchor ? null : appendStateRecordKeyed(stateDir, key, PLUGIN_SESSIONS_RECORD, `${JSON.stringify({ session_id: sessionId, at: at.toISOString() })}\n`, false);
  if (anchorDir === null || !(inAnchor || ownAccount)) return { state, anchor: null };
  const k = keyDigestIn(stateDir);
  const line: SessionLine & { at: string } = {
    session_id: sessionId,
    at: at.toISOString(),
    project_dir: resolve(projectDir),
    state_dir: stateDir,
    state_record: state === null || state.written,
    key_sha256: k.kind === "digest" ? k.sha256 : null,
  };
  return { state, anchor: appendStateRecordKeyed(anchorDir, key, PLUGIN_SESSIONS_RECORD, `${JSON.stringify(line)}\n`, true) };
}

/** The refusals of a run in a recorded project whose state folder, key or record does not agree. */
export const SESSION_RECORD_WORDS = {
  unreadable: (why: string) =>
    `the record of the Claude Code sessions the wolfboy plugin's hooks ran in cannot be read (${why}), so whether this folder is one where an AI may be typing the command cannot be told; give your own account back read and write access to it (chmod u+rw)`,
  stateMoved: (project: string, recorded: string | null, used: string | null) =>
    `this command names a folder in ${project}, where Claude Code with the wolfboy plugin has run, and the plugin's hook recorded your state folder for it as ${recorded ?? "none"}; this command's is ${used ?? "none"} (XDG_STATE_HOME, HOME or LOCALAPPDATA set otherwise), so the records it would read and write are not yours: run it with the environment your Claude Code sessions have`,
  stateRecordMissing: (project: string, why: string) =>
    `this command names a folder in ${project}, where Claude Code with the wolfboy plugin has run, and your account's own record says the hook also recorded that session in your state folder, but that record ${why}`,
  //
  twoProjects: (a: string, b: string) =>
    `this command names folders in ${a} and in ${b}, two projects where Claude Code with the wolfboy plugin has run, so one project's run files could be read or written as the other's; run it for one project at a time, with every path it is given inside that project`,
  keyChanged: (project: string, stateDir: string | null, why: string) =>
    `this command names a folder in ${project}, where Claude Code with the wolfboy plugin has run, and the redaction key in ${stateDir ?? "no state folder"} ${why}, so file digests made with it are not the ones this computer made; start a new Claude Code session (its hook records the key your state folder holds then)`,
};

export type SessionsAround =
  /** No session recorded for this account around these folders: the command line decides, as before (CI, a fresh computer). */
  | { kind: "none" }
  /** A recorded project: its key, the folder Claude Code named it by (where recorded), the session ids, and whether the anchor holds it. */
  | { kind: "recorded"; project: string; projectDir: string; ids: ReadonlySet<string>; anchored: boolean }
  /** The records disagree with this command, or cannot be read. */
  | { kind: "refused"; why: string };

/**
 * THE PROJECT A PATH BELONGS TO, so that a session's
 * record governs the project the session's scan ran on and no other. A path inside a `.legal` folder belongs to the folder
 * that holds the first `.legal` among its names (whatever is made inside a `.legal`, another `.legal` included, is that
 * project's); any other path is walked up from itself, and a folder that holds a `.legal` folder of its own (a project a
 * scan wrote into) ends the walk there: a session recorded in a folder above it (the home folder, say) does not govern it.
 * Read on the path as the file system names it (`canonicalPath`: links resolved), so a link into a project's `.legal` is
 * that project's. A `.legal` that is a link, a file or cannot be looked at ends no walk (the record above still governs).
 */
const LEGAL_NAME = ".legal";
function projectNames(path: string, platform: NodeJS.Platform): { start: string; inLegal: boolean } {
  const c = sessionRecordKey(isAbsolute(path) ? path : resolve(path), platform);
  const m = /[\\/]\.legal(?=[\\/]|$)/i.exec(c);
  if (m === null) return { start: c, inLegal: false };
  const head = c.slice(0, m.index);
  // `/.legal/x` belongs to the root; `c:\.legal\x` to the drive's root.
  return { start: head === "" ? c.slice(0, 1) : /^[A-Za-z]:$/.test(head) ? `${head}${c.charAt(m.index)}` : head, inLegal: true };
}
function holdsOwnLegal(folder: string): boolean {
  try {
    return lstatSync(join(folder, LEGAL_NAME)).isDirectory();
  } catch {
    return false;
  }
}
/**
 * Every folder from each of `paths` up to the root, as record keys, nearest first, each once; with `crossProjects` false
 * (the default) a path's walk ends at the first folder above it that holds a `.legal` of its own (`projectNames`).
 */
function keysAround(paths: readonly (string | null | undefined)[], crossProjects = false, platform: NodeJS.Platform = process.platform): string[] {
  const keys: string[] = [];
  for (const p of paths) {
    if (typeof p !== "string" || p === "") continue;
    const { start, inLegal } = projectNames(p, platform);
    let at = start;
    for (let n = 0; n < 256; n++) {
      if (!keys.includes(at)) keys.push(at);
      // The project's own folder ends the walk: a `.legal` there is a project of its own (the folder that holds the
      // first `.legal` of a path inside one is that path's project, so its walk ends there too).
      if (!crossProjects && ((n === 0 && inLegal) || holdsOwnLegal(at))) break;
      const up = dirname(at);
      if (up === at) break;
      at = up;
    }
  }
  return keys;
}

/**
 * THE RECORDED PROJECTS A COMMAND NAMES, ONE AT A
 * TIME. The project that governs a command is the first recorded one among its paths, in the order the options were typed;
 * a command naming two recorded projects was held to whichever came first, so one order of the same options wrote project
 * Q's run as project P's newest report (checker F1's D2). So the recorded projects whose run files the command's own values
 * name (`named`: every option and argument, `commandNamedPaths`; not the working folder or the session's folder, which say
 * where it runs, not what it reads or writes) are counted, and more than one is refused, whatever the order. A run file is
 * a path inside a `.legal` folder, and it belongs to the folder holding that `.legal` (`projectNames`): the plan, the
 * carried verdicts, the findings, the logs, the reports and the launch list are all there, while a value outside every
 * `.legal` (a privacy policy kept in Downloads, the claude program, a rule bundle) names no project's run, so a session
 * once started in the home folder does not refuse it. One pair is a single project here: the folder a session was started
 * in and a project that session's scan recorded below it (`recordSessionScan` writes the session's folder as the scanned
 * project's `project_dir`), as the session's launch list goes to that folder's `.legal/launch` (hook-launch.ts
 * `recordedLaunchDirRefusal`). The projects apart, or why a record cannot be read.
 */
function projectsApart(dir: string | null, named: readonly (string | null | undefined)[]): { key: string; lines: SessionLine[] }[] | { why: string } {
  const found: { key: string; lines: SessionLine[] }[] = [];
  for (const p of named) {
    if (typeof p !== "string" || p === "") continue;
    const { start: key, inLegal } = projectNames(p, process.platform);
    if (!inLegal || found.some((f) => f.key === key)) continue;
    const file = recordFile(dir, key);
    if (file === null) return [];
    const got = readStrict(file);
    if (got.kind === "unreadable") return { why: got.why };
    if (got.kind === "read") found.push({ key, lines: linesOf(got.text) });
  }
  const sessionFolders = (f: { key: string; lines: SessionLine[] }): Set<string> =>
    new Set(f.lines.map((l) => (typeof l.project_dir === "string" && l.project_dir !== "" ? sessionRecordKey(l.project_dir) : f.key)));
  return found.filter((f) => !found.some((o) => o.key !== f.key && sessionFolders(o).has(f.key)));
}
function twoProjectsRefusal(dir: string | null, named: readonly (string | null | undefined)[]): SessionsAround | null {
  const apart = projectsApart(dir, named);
  if ("why" in apart) return { kind: "refused", why: SESSION_RECORD_WORDS.unreadable(apart.why) };
  const [a, b] = apart;
  return a !== undefined && b !== undefined ? { kind: "refused", why: SESSION_RECORD_WORDS.twoProjects(a.key, b.key) } : null;
}

/**
 * The recorded project that holds one of `paths` (or is one), read from the anchor first and then from `stateDir`, the
 * state folder this command uses; refused where the two disagree (above), a record cannot be read, or the paths in `named`
 * lie in two recorded projects (above; `named` empty, as every caller but the command's anchor passes, counts nothing).
 */
export function pluginSessionsAround(
  stateDir: string | null,
  paths: readonly (string | null | undefined)[],
  anchorDir: string | null = anchorStateDir(),
  named: readonly (string | null | undefined)[] = [],
): SessionsAround {
  const keys = keysAround(paths);
  const stateIsAnchor = anchorDir !== null && sameStateFolder(stateDir, anchorDir);
  const find = (dir: string | null): { key: string; lines: SessionLine[] } | { why: string } | null => {
    for (const key of keys) {
      const file = recordFile(dir, key);
      if (file === null) return null;
      const got = readStrict(file);
      if (got.kind === "unreadable") return { why: got.why };
      if (got.kind === "read") return { key, lines: linesOf(got.text) };
    }
    return null;
  };
  const anchored = anchorDir === null ? null : find(anchorDir);
  if (anchored !== null && "why" in anchored) return { kind: "refused", why: SESSION_RECORD_WORDS.unreadable(anchored.why) };
  if (anchored !== null) {
    const two = twoProjectsRefusal(anchorDir, named);
    if (two !== null) return two;
    const latest = anchored.lines[anchored.lines.length - 1];
    const ids = new Set(anchored.lines.map((l) => l.session_id));
    const project = latest?.project_dir ?? anchored.key;
    if (latest !== undefined && latest.state_dir !== undefined) {
      if (!sameStateFolder(stateDir, latest.state_dir)) return { kind: "refused", why: SESSION_RECORD_WORDS.stateMoved(project, latest.state_dir, stateDir) };
      if (!stateIsAnchor && latest.state_record === true) {
        const file = recordFile(stateDir, anchored.key);
        const own = file === null ? ({ kind: "absent" } as const) : readStrict(file);
        if (own.kind !== "read") return { kind: "refused", why: SESSION_RECORD_WORDS.stateRecordMissing(project, own.kind === "absent" ? `is not at ${file ?? "any place"}` : `cannot be read (${own.why})`) };
        for (const l of linesOf(own.text)) ids.add(l.session_id);
      }
      if (typeof latest.key_sha256 === "string") {
        const k = keyDigestIn(stateDir);
        if (k.kind === "unreadable") return { kind: "refused", why: SESSION_RECORD_WORDS.keyChanged(project, stateDir, `cannot be read (${k.why})`) };
        if (k.kind === "digest" && k.sha256 !== latest.key_sha256) return { kind: "refused", why: SESSION_RECORD_WORDS.keyChanged(project, stateDir, "is not the one the plugin's hook recorded when the session started") };
      }
    }
    return { kind: "recorded", project: anchored.key, projectDir: project, ids, anchored: true };
  }
  if (stateIsAnchor) return { kind: "none" };
  const own = find(stateDir);
  if (own !== null && "why" in own) return { kind: "refused", why: SESSION_RECORD_WORDS.unreadable(own.why) };
  if (own === null) return { kind: "none" };
  const two = twoProjectsRefusal(stateDir, named);
  if (two !== null) return two;
  return { kind: "recorded", project: own.key, projectDir: own.key, ids: new Set(own.lines.map((l) => l.session_id)), anchored: false };
}

/**
 * Where a recorded plugin session's project holds the run: an
 * earlier run named on the command line (`--previous`) is taken only where the state folder vouches for it, a log whose
 * sha256 the assembly recorded for `target` when WolfBoy wrote it. `read`: what index.ts read of it, once (the bytes
 * the carry parses: adjudicate-plan.ts `readPreviousRun`), so a file swapped after this check is not the one carried.
 * Else why not. A folder of run files is never vouched for.
 */
export function previousVouchRefusal(previous: string, read: { sha256?: string; isDirectory?: boolean }, target: string, stateDir: string | null, project: string): string | null {
  const tail =
    `This folder lies in ${project}, where Claude Code with the wolfboy plugin has run, so an earlier run named on the command line is carried only ` +
    "where this computer recorded its digest when WolfBoy wrote it (your own earlier scan's log). To carry another log (a teammate's, or your own from another computer), " +
    "copy it into this project's .legal/evidence and run the scan in Claude Code, where the program asks you which log there is yours. " +
    "Nothing was written: no plan, no carried verdict, no run-shape question, no launch list and no active-run marker.";
  if (read.isDirectory === true) return `refused: --previous ${previous} is a folder of run files, of which this computer records no digest. ${tail}`;
  if (typeof read.sha256 !== "string" || read.sha256 === "") return `refused: --previous ${previous} could not be read whole. ${tail}`;
  const digests = readLogDigests(stateDir, target);
  if (!digests.ok) return `refused: the record of the logs WolfBoy wrote could not be read (${digests.why}). ${tail}`;
  for (const v of digests.byName.values()) if (v === read.sha256) return null;
  return `refused: --previous ${previous} is not a log this computer recorded when WolfBoy wrote it. ${tail}`;
}

/*
 * EVERY COMMAND, EVERY PATH IT IS GIVEN. The
 * pre-launch step alone asked the anchor, from six of its options, and the assembly, which writes the person's report,
 * asked nothing: a plan, a carried folder and a state folder from anywhere were taken there. So every command of the
 * program asks it, once, before its action and before any other hook writes (index.ts), from the value of EVERY option and
 * argument it was given or defaulted (each read as a path; a value that is not one names a folder under the working folder,
 * which is walked anyway), the working folder and the session's project folder where the session exported one. The
 * options are read from the command's own definition (commander's `opts()` and `args`), so no list is kept and an option
 * added later is asked about without being named (test:plugin-sessions (6) adds one and sees it refused). A VALUE WITH "://" IN IT IS A PATH HERE TOO. A value
 * that held "://" was left out as a URL, but the commands read every such value with path.resolve, which takes
 * `x://y/../../..` away and names the path after it, so a command whose every path was so spelled was governed by no
 * record. Every value is now asked about as a path; a URL a command fetches (`reconcile --policy https://...`) then names a
 * folder under the working folder, which is walked anyway, so nothing is treated as a URL here.
 */
export function commandPaths(command: { opts(): Record<string, unknown>; args?: readonly unknown[] }, cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): string[] {
  const out = commandNamedPaths(command, cwd);
  out.push(cwd);
  const project = env.WOLFBOY_PROJECT_DIR;
  if (typeof project === "string" && isAbsolute(project)) out.push(project);
  return [...new Set(out)];
}
/** The command's own values read as paths (`commandPaths` without the working folder and the session's folder). */
export function commandNamedPaths(command: { opts(): Record<string, unknown>; args?: readonly unknown[] }, cwd: string = process.cwd()): string[] {
  const out: string[] = [];
  const take = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) take(x);
      return;
    }
    if (typeof v !== "string" || v === "" || v.includes("\0")) return;
    out.push(isAbsolute(v) ? v : resolve(cwd, v));
  };
  for (const value of Object.values(command.opts())) take(value);
  for (const value of command.args ?? []) take(value);
  return [...new Set(out)];
}

/** The anchor's answer for the command now running (index.ts sets it before the action); null outside the CLI. */
let commandAround: SessionsAround | null = null;
export function noteCommandSessions(around: SessionsAround | null): void {
  commandAround = around;
}
export function commandSessions(): SessionsAround | null {
  return commandAround;
}

/**
 * A SCAN THAT RAN IN A SESSION, RECORDED UNDER ITS OWN
 * PROJECT. A session's record governs the folder it was started in (and the folders below it that hold no `.legal` of
 * their own); a project below it that a scan wrote into is its own (keysAround), so a session once started in the home
 * folder no longer holds every project below it. Where that session's own scan runs on such a project, the project is
 * recorded here for it: one line keyed by the scanned folder, naming the session, the folder the session was started in
 * (its `.legal/launch` is where the hooks read a run, so the launch list still goes there: hook-launch.ts
 * `recordedLaunchDirRefusal`), the state folder and the key's sha256 the session's line recorded. "That session's own
 * scan" is a scan whose environment names a session id the record holds (WOLFBOY_SESSION_ID, or Claude Code's own
 * CLAUDE_CODE_SESSION_ID): a command that removes both reads as one typed at the person's terminal and records nothing, as
 * no program can tell the two apart (the stated limit). Written only where the session's line was (the anchor, by the
 * process of the account's own home: `homeIsAnchor`). The line written, or null where none is due.
 */
export function recordSessionScan(
  stateDir: string | null,
  target: string,
  env: NodeJS.ProcessEnv,
  at: Date,
  anchorDir: string | null = anchorStateDir(),
  ownAccount: boolean = homeIsAnchor(),
): StateRecordWrite | null {
  if (anchorDir === null || !(ownAccount || sameStateFolder(stateDir, anchorDir))) return null;
  const scanned = sessionRecordKey(isAbsolute(target) ? target : resolve(target));
  const ids = [env.WOLFBOY_SESSION_ID, env.CLAUDE_CODE_SESSION_ID].filter((v): v is string => typeof v === "string" && v.trim() !== "");
  if (ids.length === 0) return null;
  for (const key of keysAround([target], true)) {
    const file = recordFile(anchorDir, key);
    if (file === null) return null;
    const got = readStrict(file);
    if (got.kind !== "read") continue;
    if (key === scanned) return null;
    const lines = linesOf(got.text);
    const session = lines.find((l) => ids.includes(l.session_id));
    // A record that holds another session (a session
    // once started in a folder between) does not end the walk: the session running this scan may have been started above it.
    if (session === undefined) continue;
    const latest = lines[lines.length - 1] ?? session;
    const line = {
      session_id: session.session_id,
      at: at.toISOString(),
      project_dir: latest.project_dir ?? key,
      state_dir: latest.state_dir ?? null,
      state_record: false,
      key_sha256: latest.key_sha256 ?? null,
      scan_of: resolve(target),
    };
    return appendStateRecordKeyed(anchorDir, scanned, PLUGIN_SESSIONS_RECORD, `${JSON.stringify(line)}\n`, true);
  }
  return null;
}

/**
 * THE PRE-LAUNCH PLAN'S DIGEST AND THE EARLIER RUN
 * THE PERSON CHOSE, in the record of the logs WolfBoy wrote (log-digest.ts), under names no log file can have: the
 * pre-launch step records the sha256 of the plan it writes, and, where the earlier run came from the person's answer to the
 * earlier-run question, that log's sha256; the assembly, in a recorded project, takes the plan only with that digest, and
 * its earlier log only where this computer recorded it (a log WolfBoy wrote) or the person chose it through the earlier-run question.
 */
export const adjudicatePlanDigestName = (planPath: string): string => `adjudicate-plan:${sessionRecordKey(isAbsolute(planPath) ? planPath : resolve(planPath))}`;
export const earlierRunChosenName = (sha256: string): string => `earlier-run-chosen:${sha256}`;
