/**
 * THE ONE READER OF PROGRAM-WRITTEN FILES, THE ONE EXCLUSIVE CREATE, AND THE ONE REFUSAL BY ERROR CODE
 *
 * The program writes every file it reads back as a new regular file with one name: a brief, a reading copy,
 * the launch list, the active-run marker, a lock. Whatever else stands at such a path - a symbolic link, a
 * directory, a named pipe, a socket, a device, or a file with a second name (a hard link) - is not a file the
 * program wrote, and is refused by name with what to do; it is never followed and never waited on:
 *
 * - `readProgramFile` looks at the path without following it (`lstat`), opens it without blocking and without
 *   following a link, checks that what it opened is what it looked at, and, where a digest was recorded for the
 *   file, reads it back only while it still has that sha256. A named pipe no longer blocks the reader (the hook's 30 s timeout would let the launch go ahead unchecked; the lock's reader spun until killed).
 * - `createExclusive` creates a file holding its text only where nothing has that name, with the text in place
 *   before the name is (a temporary file linked into place). Where the file system refuses hard links (FAT,
 *   exFAT, some shared-folder and FUSE mounts), it falls back to an exclusive create.
 * - `refusalFor` words an error's remedy by its code: the cause the person can act on, naming the file
 *   the program meant (a lock, never the lock's temporary file).
 */

import { createHash, randomBytes } from "node:crypto";
import { type BigIntStats, closeSync, lstatSync, readFileSync, realpathSync, statSync, type Stats } from "node:fs";
import { type FileId, kindWords, lookedId, openInside, sameFile } from "./project-read.js";
import { createNewFile, linkPath, removePath } from "./project-write.js";
import { toldArgs } from "./scanner-command.js";
import { valueText } from "./value-text.js";
import { dirname } from "node:path";

export const sha256Of = (s: string | Uint8Array): string => createHash("sha256").update(s).digest("hex");

/**
 * Exit classes of a read-back: `unreadable` (the file is missing or is not what it should parse as), `refused`
 * (it is not the file the program wrote). `code` is the error code where the file system gave one. `kind` says what
 * stands at the path where it is not a regular file with one name (a named pipe, a directory, a link, a file with a
 * second name): the file was never opened, which a caller that has one code for an input it cannot read needs to
 * tell apart from a file it read and refused for its content (run-status; m4 of the integration verification).
 */
export type ReadBack<T> = { ok: true; value: T; sha256: string } | { ok: false; exit: "unreadable" | "refused"; problem: string; code?: string; kind?: string };

const codeOf = (e: unknown): string | undefined => (e as NodeJS.ErrnoException | undefined)?.code;

/** What stands at a path, in words, for a refusal. */
export function kindOf(st: Stats | BigIntStats): string {
  if (st.isFile()) return "a regular file";
  if (st.isSymbolicLink()) return "a symbolic link";
  if (st.isDirectory()) return "a directory";
  if (st.isFIFO()) return "a named pipe";
  if (st.isSocket()) return "a socket";
  if (st.isCharacterDevice() || st.isBlockDevice()) return "a device";
  return "not a regular file";
}

/** The remedy for a path that holds something the program never writes there. */
const removeIt = (path: string, st: Stats | BigIntStats): string => toldArgs(st.isDirectory() ? ["rm", "-r", path] : ["rm", path]);

/** A digest to check the file against, and what recorded it (for the refusal's wording). */
export interface Recorded {
  sha256: string | null | undefined;
  where: string;
}

/**
 * Where a regular file is not required to have one name only. The lock has two for a moment while it is being
 * created (its temporary file is linked to it, then removed), so a reader of the lock checks the kind only.
 */
export interface ReadOptions {
  anyLinks?: boolean;
}

/**
 * `path` read as a file the program wrote. In order: `lstat` (a missing path or a missing directory is
 * `unreadable`); anything that is not a regular file is `refused`, naming what it is; a second name (hard link)
 * is `refused` unless `opts.anyLinks`; the file is opened read-only, without blocking and without following a
 * link, and what was opened must be the regular file that was looked at (same device and inode), else the name is
 * looked up again (`PROGRAM_FILE_PASSES`) and, replaced at every pass, `refused`; it is read and closed. Where
 * `recorded` is given, the file is read back only while its sha256 is the recorded one; a record with no sha256 is
 * `refused` before anything is opened.
 */
export function readProgramFile(what: string, path: string, recorded?: Recorded, opts: ReadOptions = {}): ReadBack<Buffer> {
  if (recorded && (typeof recorded.sha256 !== "string" || recorded.sha256 === "")) {
    return { ok: false, exit: "refused", problem: `${what} ${path}: ${recorded.where} records no sha256 for it, so it cannot be read back as the file the program wrote` };
  }
  let once = readOnce(what, path, opts);
  for (let pass = 1; "problem" in once && once.replaced && pass < PROGRAM_FILE_PASSES; pass++) once = readOnce(what, path, opts);
  if ("problem" in once) return once.problem;
  const bytes = once.bytes;
  const sha = sha256Of(bytes);
  if (recorded && sha !== recorded.sha256) {
    return { ok: false, exit: "refused", problem: `${what} ${path} is not the file the program wrote: its sha256 is ${sha.slice(0, 16)}..., and ${recorded.where} records ${String(recorded.sha256).slice(0, 16)}...` };
  }
  return { ok: true, value: bytes, sha256: sha };
}

/**
 * A NAME REPLACED BETWEEN THE LOOKUP AND THE OPEN IS LOOKED UP AGAIN. The
 * program replaces every file it reads back in one rename (project-write.ts `writeFileAt`), and another of its processes
 * (a hook, a command) can do so between this reader's lookup and its open: the open then reaches the file that replaced
 * the one looked at. That is a write that moved on, not a file changed outside the program, so the name is looked up
 * again and every check runs on what stands there now; a file is read only where its open reached the file its own
 * lookup saw. Before, the first such open was refused ("was replaced while it was being read"), and a reader of the
 * active-run marker, its copy or the launch list refused the program's own pair now and then.
 * Nothing waits: each pass is taken only because the name was replaced, and a name replaced at every pass is refused
 * as before. Elsewhere than Linux, the open kept inside the project folder compares the real path's file with the one
 * opened (project-read.ts `openInside`, `ECHANGED`): the same replacement, looked up again the same way.
 */
const PROGRAM_FILE_PASSES = 8;

/** One lookup, open and read of `path`: its bytes, or the refusal, with whether the name was replaced between the two. */
type ReadOnce = { bytes: Buffer } | { problem: ReadBack<Buffer>; replaced: boolean };
const refusedOnce = (problem: ReadBack<Buffer>, replaced = false): ReadOnce => ({ problem, replaced });

function readOnce(what: string, path: string, opts: ReadOptions): ReadOnce {
  let st: BigIntStats;
  try {
    st = lstatSync(path, { bigint: true });
  } catch (e) {
    const code = codeOf(e);
    if (code === "ENOENT" || code === "ENOTDIR") return refusedOnce({ ok: false, exit: "unreadable", problem: `${what} ${path} cannot be read: it does not exist`, code });
    return refusedOnce({ ok: false, exit: "unreadable", problem: `${what}: ${refusalFor(e, path)}`, code });
  }
  if (!st.isFile()) {
    return refusedOnce({
      ok: false,
      exit: "refused",
      kind: kindOf(st),
      problem: `${what} ${path} is ${kindOf(st)}, not a file the program wrote (it writes each one as a new regular file), so it is not read: remove it (${removeIt(path, st)}) and run the step that writes it again`,
    });
  }
  if (!opts.anyLinks && st.nlink !== 1n) {
    return refusedOnce({
      ok: false,
      exit: "refused",
      kind: `a file with ${st.nlink} names`,
      problem: `${what} ${path} has ${st.nlink} names (hard links), and the program writes each file it reads back with one, so it is not read: remove it (${toldArgs(["rm", path])}) and run the step that writes it again`,
    });
  }
  // The identity the open below must reach, taken at this lookup (project-read.ts `lookedId`).
  let looked: FileId;
  try {
    looked = lookedId(path, st);
  } catch (e) {
    return refusedOnce({ ok: false, exit: "unreadable", problem: `${what}: ${refusalFor(e, path)}`, code: codeOf(e) });
  }
  let fd: number;
  let now: Stats;
  try {
    // Opened by the one reader's open, which keeps it inside the project folder:
    // a folder on the way that is a link out of it (`.legal` itself, a repository can commit one) is not read through.
    const o = openInside(path, { noFollow: true });
    if ("outside" in o) {
      return refusedOnce({ ok: false, exit: "refused", kind: kindWords("outside"), problem: `${what} ${path} is ${kindWords("outside")}, not a file the program wrote, so it is not read: remove the link and run the step that writes it again` });
    }
    fd = o.fd;
    now = o.st;
  } catch (e) {
    const code = codeOf(e);
    if (code === "ENOENT") return refusedOnce({ ok: false, exit: "unreadable", problem: `${what} ${path} cannot be read: it was removed while it was being read`, code });
    if (code === "ELOOP") return refusedOnce({ ok: false, exit: "refused", problem: `${what} ${path} became a symbolic link while it was being read, so it is not read: remove it (${toldArgs(["rm", path])}) and run the step that writes it again`, code });
    return refusedOnce({ ok: false, exit: "unreadable", problem: `${what}: ${refusalFor(e, path)}`, code }, code === "ECHANGED");
  }
  let bytes: Buffer;
  try {
    if (!now.isFile() || !sameFile(looked, fd)) {
      return refusedOnce({ ok: false, exit: "refused", problem: `${what} ${path} was replaced while it was being read, so it is not read: run this command again` }, true);
    }
    bytes = readFileSync(fd);
  } catch (e) {
    return refusedOnce({ ok: false, exit: "unreadable", problem: `${what}: ${refusalFor(e, path)}`, code: codeOf(e) });
  } finally {
    closeSync(fd);
  }
  return { bytes };
}

/**
 * A file the program wrote, as its bytes, or a throw whose message names the file and why (a missing file included):
 * `readProgramFile` for a caller whose failure boundary words the throw (command-boundary.ts). It is
 * the one such read: command-boundary.ts `bytesOf` and verdict-capture.ts `readNamed`, two copies of
 * "readFileSync that names the path", are gone.
 */
export function programFileBytes(what: string, path: string): Buffer {
  const got = readProgramFile(what, path);
  if (!got.ok) throw Object.assign(new Error(got.problem), { path });
  return got.value;
}

/** Where a path the person named is a symbolic link, what it leads to, for a refusal; "" otherwise. */
function throughLink(path: string): string {
  try {
    if (!lstatSync(path).isSymbolicLink()) return "";
  } catch {
    return "";
  }
  try {
    return ` (a symbolic link to ${realpathSync(path)})`;
  } catch {
    return " (a symbolic link whose target does not exist)";
  }
}

/**
 * A FILE THE PERSON NAMED. `adjudicate --previous`
 * reads a previous run the person names, which may legitimately be a symbolic link or a hard-linked backup, so this
 * reader follows links and takes a file with several names, both of which `readProgramFile` refuses. What it never does
 * is open a file that can block: the path's target is looked at first (`stat`, which follows links and opens nothing),
 * anything there that is not a regular file (a named pipe, a directory, a socket, a device) is refused by its kind and by
 * name before anything is opened, and the regular file is then opened without blocking and must be the file that was
 * looked at (same device and inode), else refused.
 */
export function readNamedFile(what: string, path: string): ReadBack<Buffer> {
  let st: BigIntStats;
  try {
    st = statSync(path, { bigint: true });
  } catch (e) {
    const code = codeOf(e);
    if (code === "ENOENT" || code === "ENOTDIR") return { ok: false, exit: "unreadable", problem: `${what} ${path}${throughLink(path)} cannot be read: it does not exist`, code };
    return { ok: false, exit: "unreadable", problem: `${what}: ${refusalFor(e, path)}`, code };
  }
  if (!st.isFile()) {
    return {
      ok: false,
      exit: "refused",
      kind: kindOf(st),
      problem: `${what} ${path}${throughLink(path)} is ${kindOf(st)}, not a regular file, so it is not read: name the file itself`,
    };
  }
  // The identity the open below must reach, taken at this lookup (project-read.ts `lookedId`).
  let looked: FileId;
  try {
    looked = lookedId(path, st);
  } catch (e) {
    return { ok: false, exit: "unreadable", problem: `${what}: ${refusalFor(e, path)}`, code: codeOf(e) };
  }
  let fd: number;
  let now: Stats;
  try {
    // A file the person names inside a project folder is read only from inside it.
    const o = openInside(path);
    if ("outside" in o) {
      const words = kindWords("outside", throughLink(path) !== "");
      return { ok: false, exit: "refused", kind: words, problem: `${what} ${path} is ${words}, so it is not read: name a file inside the project folder` };
    }
    fd = o.fd;
    now = o.st;
  } catch (e) {
    return { ok: false, exit: "unreadable", problem: `${what}: ${refusalFor(e, path)}`, code: codeOf(e) };
  }
  let bytes: Buffer;
  try {
    if (!now.isFile() || !sameFile(looked, fd)) {
      return { ok: false, exit: "refused", problem: `${what} ${path} was replaced while it was being read, so it is not read: run this command again` };
    }
    bytes = readFileSync(fd);
  } catch (e) {
    return { ok: false, exit: "unreadable", problem: `${what}: ${refusalFor(e, path)}`, code: codeOf(e) };
  } finally {
    closeSync(fd);
  }
  return { ok: true, value: bytes, sha256: sha256Of(bytes) };
}

/** link(2) codes of a file system that has no hard links, or will not make one here. */
const NO_HARD_LINKS = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV"]);

/**
 * Create `path` holding `text` only where nothing has that name yet: true when this call made it, false where
 * something is already there. The text is in place before the name is: a temporary file is written and linked
 * to `path`. Where the file system will not link, `path` is created exclusively (`O_EXCL`) and the text
 * written into it: for that moment the file is empty, which a reader of a lock takes as torn (`LOCK_TORN_MS`,
 * launch-list-file.ts) and a reader of a reservation as not yet written. Any other error is thrown, for the
 * caller to word (`refusalFor`).
 */
export function createExclusive(path: string, text: string): boolean {
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  createNewFile(tmp, text);
  try {
    linkPath(tmp, path);
    return true;
  } catch (e) {
    const code = codeOf(e);
    if (code === "EEXIST") return false;
    if (!NO_HARD_LINKS.has(code ?? "")) throw e;
  } finally {
    removePath(tmp, { force: true });
  }
  try {
    createNewFile(path, text);
  } catch (e) {
    if (codeOf(e) === "EEXIST") return false;
    throw e;
  }
  return true;
}

/** The file an error is about, as the program means it: a temporary file of the program's is named by the file it was for. */
const meant = (e: NodeJS.ErrnoException, path: string): { at: string; viaTemporary: boolean } => {
  const raw = typeof e.path === "string" ? e.path : path;
  const at = raw.replace(/\.\d+\.[0-9a-f]+\.tmp$/, "").replace(/\.\d+\.tmp$/, "");
  return { at, viaTemporary: at !== raw };
};

/**
 * A file-system error as a refusal that names its real cause and what to do. `path` is the file the
 * program meant; the error's own path is used where it names another file of the program's (a take-over file),
 * and a temporary file is named by the file it was for. The caller adds what it did not do.
 */
export function refusalFor(err: unknown, path: string): string {
  const e = (err ?? {}) as NodeJS.ErrnoException;
  const code = typeof e.code === "string" ? e.code : "error";
  const { at, viaTemporary } = meant(e, path);
  const dir = dirname(at);
  // The path, its folder and the error's message in the sentence through
  // `valueText`; the told command (`toldArgs`) quotes the path itself.
  const atText = valueText(at);
  const dirText = valueText(dir);
  switch (code) {
    case "EACCES":
    case "EPERM":
      return viaTemporary
        ? `${dirText} does not let this user create files (${code}), so ${atText} cannot be written: correct the directory's permissions and run this command again`
        : `${atText} cannot be used (${code}: permission denied): remove it (${toldArgs(["rm", at])}) or correct its permissions, and run this command again`;
    case "ELINKREFUSED":
      // The one write path's refusal (project-write.ts): its own sentence names the path, the link and what to do.
      return e.message;
    case "ELOOP":
      return `${atText} is a symbolic link that leads to itself (ELOOP): remove the link (${toldArgs(["rm", at])}) and run this command again`;
    case "ENOSPC":
      return `the file system that holds ${dirText} is full (ENOSPC), so ${atText} cannot be written: free space and run this command again`;
    case "EDQUOT":
      return `this user's disk quota on the file system that holds ${dirText} is used up (EDQUOT), so ${atText} cannot be written: free space and run this command again`;
    case "EROFS":
      return `${dirText} is on a read-only file system (EROFS), so ${atText} cannot be written: run this command where the launch directory is on a writable file system`;
    case "EISDIR":
      return `${atText} is a directory where the program keeps a file: remove it (${toldArgs(["rm", "-r", at])}) and run this command again`;
    case "ENOTDIR":
      return `a part of the path ${dirText} is not a directory (ENOTDIR), so ${atText} cannot be used: remove the file that stands where a directory should be, and run this command again`;
    case "ENOENT":
      return `the directory ${dirText} does not exist, so ${atText} cannot be used: it is made by the step that writes the files in it`;
    default:
      return `${atText} cannot be used (${code}: ${valueText(e.message ?? String(err))}): correct that and run this command again`;
  }
}
