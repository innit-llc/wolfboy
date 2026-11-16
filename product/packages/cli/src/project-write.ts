/**
 * THE ONE WRITE PATH: every byte the CLI and the hooks write, append, create, copy, rename,
 * make a folder for or delete, goes through this module, and nothing here follows a symbolic link.
 *
 * The class. A repository the person scans can hold any path, a symbolic link included, and git checks a committed
 * link out as a link. `writeFileSync` and `appendFileSync` follow a link at the file's own name, and every call follows
 * a link at any folder on the way, so a clone that commits `.legal/launch/scan-under-way.json`, `.legal/launch`, or
 * `.legal` itself as a relative link out of itself had the person's own file outside the clone overwritten, appended
 * to or filled with the scanned code's lines, silently, when the person scanned it. Patching each write would leave
 * the next one open; so every write goes through here, and `test:project-writes` fails on a module other than this one
 * that can reach a writing function of `node:fs` in the CLI's and the hooks' build.
 *
 * What every function here does:
 * - It walks, without following, every name from the project folder down to the path it is about to touch, the path's
 *   own name included, and refuses (`LinkRefusal`) where one is a symbolic link: nothing is written, and the refusal
 *   names the path, the link and where the link points, for the person to read through the printed redaction. A name
 *   that does not exist yet is fine (a folder is made, a file is created).
 * - Where the walk goes by path (no folder descriptors: macOS, Windows), the folder a write lands in is also held to the
 *   reads' containment test by real path (project-read.ts `realPathIn`, here `keepInside`): a name that leads outside
 *   the project folder without being a symbolic link (on Windows a junction whose target is a volume path, which Node's
 *   `lstat` reports as a folder) is refused by name (`LinkRefusal`, kind `outside`), and nothing is made or written.
 * - A new or replaced file is written into a fresh temporary name in the same folder, opened `O_CREAT | O_EXCL |
 *   O_NOFOLLOW | O_NONBLOCK`, and renamed over the path (a rename replaces a link at the path itself, never its
 *   target). An append opens with `O_APPEND | O_NOFOLLOW | O_NONBLOCK`. A folder is made one name at a time.
 * - After every open, before a byte is written, the descriptor itself is looked at (`fstat`):
 * anything but a regular file with one name is refused by name (`LinkRefusal`). A hard link at an
 *   appended file (git cannot carry one; a process on the computer can make one) would have had the line appended to
 *   the file under its other name, outside the project; a FIFO would have held the program for ever (`O_NONBLOCK`
 *   makes the open of a FIFO with no reader fail at once, and the look refuses one with a reader).
 * - A temporary file this module made is removed on every way a write can fail, through the same folder it was made
 *   in.
 *
 * The walk cannot be raced on Linux (a check measured 713 of 1,504 writes landing outside
 * under a process swapping `.legal/launch` for a link). Node has no `openat`, but Linux names an open folder by its
 * descriptor: `/proc/self/fd/<n>/<name>` is resolved inside the folder the descriptor holds, whatever its path has
 * become. So the walk opens each folder by its descriptor (`O_PATH | O_NOFOLLOW`, then `fstat`: a link is refused, a
 * folder is walked into), and the open, the rename, the link, the folder made and the removal all go through the last
 * folder's descriptor: a folder swapped for a link after the walk is not followed, because no later call names the
 * folder by its path. A recursive removal walks the same way, folder by folder. Where `/proc/self/fd` cannot be used
 * (macOS, Windows, a Linux without /proc), the walk looks at each name by its path (`lstat`) and, after an open,
 * walks the names again and then looks at the full path, and compares the opened file's device and inode with the
 * name's. That look is several calls by path, so it does NOT hold against a racing process: a process that swaps a folder on the way for a link to a
 * folder outside, and back, between those calls passes the comparison. Measured on Linux with this path walk forced (the same JavaScript, not the same
 * system calls' timing), a process exchanging `.legal`, `.legal/launch` or a declared `--out` folder with such a link
 * in a loop got whole files written outside (up to 950 new entries, 346 of them with content), files outside deleted
 * (`removeFile` and `removePath` unlink by path after the walk), and temporary files left inside (a refused create
 * leaves its file where the open put it). What an attacker needs there: a process running on the computer while the
 * program writes, able to rename inside the project's `.legal` (or the declared `--out` folder) and looping on it.
 * Within one account that process can already write wherever it would send the file; across accounts it needs a
 * project folder another account can write. A cloned or copied folder cannot race: it is files, not a process. On
 * Linux with /proc none of this holds (the same check: every cell green). fix-harden.md section 2 says the same.
 *
 * Where the walk starts (the project folder, `anchorOf`). The folder a write is about is not always passed in, so it is
 * found from the path itself, in this order:
 * 1. A folder this process made with `makeTempFolder`: that folder (nothing in it is the scanned repository's).
 * 2. A path inside a project folder the command named (`declareProjectFolder`; the program declares every command's
 *    `--target`, index.ts): that folder. So a path the person names with `--out` inside the project is walked from the
 *    project wherever the command runs from (run from outside the project, an `--out` through a
 *    folder the repository holds as a link was followed).
 * 3. A path inside a `.legal` folder: the folder that holds the first `.legal` on the path - the project folder. So
 *    `.legal` itself and every folder under it are walked.
 * 4. A path under the working folder (other than `/`): the working folder.
 * 5. Anything else (the state folder, a path outside the working folder and every project folder): the path's own
 *    folder - its own name is never followed. A caller may name the folder to start from instead (`within`), as the
 *    start record does for the state folder.
 * The folder the walk starts at is taken as it is: a project folder the person reached through a link of their own is
 * not refused.
 */

import { randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readlinkSync, renameSync, rmdirSync, rmSync, statSync, unlinkSync, writeSync } from "node:fs";
import type { Stats } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, parse, resolve, sep } from "node:path";
import { relativePath } from "./project-path.js";
import { lookedId, projectFolderOf, readRegularFile, realPathIn, sameFile } from "./project-read.js";

// The declared project folders are kept by the one reader (project-read.ts), which keeps every read of a path inside
// its project folder; a write inside one is walked from it (rule 2). One set, for both.
export { declareProjectFolder, declaredProjectFolders } from "./project-read.js";

/** What a refused name turned out to be. */
export type RefusedKind = "symbolic" | "hard" | "special" | "changed" | "outside";

/** Where a write was refused because a name on its way is a link or not a regular file. Its message is the sentence the person reads. */
export class LinkRefusal extends Error {
  readonly code = "ELINKREFUSED";
  constructor(
    /** The path the program meant to write. */
    readonly path: string,
    /** The name on the way that was refused (the path itself, or a folder holding it). */
    readonly link: string,
    /** Where that link points, as it says (a symbolic link only). */
    readonly target: string | null,
    /** What the name is: a symbolic link, a hard link, not a regular file, a folder changed during the write, or a name that leads outside the project folder. */
    readonly kind: RefusedKind = "symbolic",
    /** For a hard link, how many names the file has; for a file that is not regular, what it is. */
    readonly detail: string = "",
  ) {
    super(sentenceFor(path, link, target, kind, detail));
    this.name = "LinkRefusal";
  }
}

// Words. The symbolic link's sentence is unchanged.
function sentenceFor(path: string, link: string, target: string | null, kind: RefusedKind, detail: string): string {
  const it = link === path ? "it" : link;
  const head = `wolfboy: stopped before writing ${path}: `;
  const made = "Nothing was written there. Remove or rename it - git never makes one, so a program on this computer did - and run the command again.";
  if (kind === "hard") {
    return (
      `${head}${it} is a hard link (one file with ${detail} names). The program never writes into a file that has another ` +
      "name: a hard link made in the project folder can be a name of a file outside it, and the write would change a file " +
      `that is not the program's. ${made}`
    );
  }
  if (kind === "special") {
    return (
      `${head}${it} is ${detail}, not a regular file. The program writes only into regular files: a FIFO waits for a ` +
      `reader for ever, and a socket or a device hands the bytes to another program. ${made}`
    );
  }
  if (kind === "outside") {
    return (
      `${head}${it} leads outside the project folder${target === null ? "" : ` (to ${target})`} without being a symbolic ` +
      "link (on Windows, a junction to a volume path, or a folder another drive is mounted on). The program never writes " +
      `outside the project folder: the write would change a file that is not the program's. ${made}`
    );
  }
  if (kind === "changed") {
    return (
      `${head}a folder on its way changed while the program opened it (a link was put in its place, or it was moved). ` +
      "The program never writes through a link inside the project folder. Nothing was written there. Stop the program " +
      "that is changing the project folder, and run the command again."
    );
  }
  return (
    `${head}${it} is a symbolic link` +
    `${target === null ? "" : ` (to ${target})`}. The program never writes through a link inside the project ` +
    "folder: a link the scanned repository holds can point outside it, and the write would change a file that is " +
    "not the program's. Nothing was written there. Remove or rename the link - if the repository holds it, it is " +
    "the repository's own file - or scan a copy of the repository without it."
  );
}

export const isLinkRefusal = (e: unknown): e is LinkRefusal => e instanceof LinkRefusal || (e as { code?: unknown } | null)?.code === "ELINKREFUSED";

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const NONBLOCK = constants.O_NONBLOCK ?? 0;
const CREATE_NEW = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW | NONBLOCK;
const APPEND = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | NOFOLLOW | NONBLOCK;
/** Linux's `O_PATH` (Node does not export it): a descriptor that names a folder or a link without reading it. */
const O_PATH = 0o10000000;
const FD_ROOT = "/proc/self/fd";

/** Folders this process made with `makeTempFolder`: the walk starts there. */
const ownFolders = new Set<string>();

const codeOf = (e: unknown): string | undefined => (e as NodeJS.ErrnoException | undefined)?.code;
const inside = (path: string, folder: string): boolean => path === folder || path.startsWith(folder.endsWith(sep) ? folder : `${folder}${sep}`);

/** Whether `/proc/self/fd/<n>/` resolves inside the folder descriptor `n` holds (Linux with /proc mounted). */
function probeDescriptorWalk(): boolean {
  if (process.platform !== "linux") return false;
  let fd: number | undefined;
  try {
    fd = openSync("/", O_PATH | constants.O_DIRECTORY);
    const viaFd = statSync(`${FD_ROOT}/${fd}/`);
    const root = statSync("/");
    return viaFd.isDirectory() && viaFd.ino === root.ino && viaFd.dev === root.dev;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
let fdWalk = probeDescriptorWalk();

/**
 * Whether writes go through folder descriptors (Linux) or by path with a second look after each open (elsewhere).
 * `on` switches it for this process: `test:project-writes` runs every check both ways on Linux.
 */
export function descriptorWalk(on?: boolean): boolean {
  if (on !== undefined) fdWalk = on && probeDescriptorWalk();
  return fdWalk;
}

/** The folder the walk starts at for `abs` (see the header). */
export function anchorOf(abs: string, within?: string): string {
  if (within !== undefined) {
    const w = resolve(within);
    if (inside(abs, w)) return w;
  }
  for (const own of ownFolders) if (inside(abs, own)) return own;
  const project = projectFolderOf(abs);
  if (project !== null) return project;
  const cwd = process.cwd();
  if (cwd !== parse(cwd).root && inside(abs, cwd)) return cwd;
  return dirname(abs);
}

const linkTarget = (p: string): string | null => {
  try {
    return readlinkSync(p);
  } catch {
    return null;
  }
};

const errno = (code: string, path: string, what: string): NodeJS.ErrnoException => {
  const err = new Error(`${code}: ${what}, '${path}'`) as NodeJS.ErrnoException;
  err.code = code;
  err.path = path;
  return err;
};

/** A folder reached by the walk: its descriptor (Linux) or only its path. */
interface Folder {
  fd: number | null;
  path: string;
}
/** The name `name` in `dir`, as the next call resolves it: through the folder's descriptor where there is one. */
const at = (dir: Folder, name: string): string => (dir.fd === null ? join(dir.path, name) : `${FD_ROOT}/${dir.fd}/${name}`);

/** An error from a call made through a descriptor path, with the path the person knows put back in its message. */
function relabel(e: unknown, shown: string): unknown {
  const err = e as NodeJS.ErrnoException | undefined;
  if (err === undefined || err === null || typeof err.message !== "string" || !err.message.includes(`${FD_ROOT}/`)) return e;
  const out = new Error(err.message.replace(/\/proc\/self\/fd\/\d+(?:\/[^']*)?/g, shown)) as NodeJS.ErrnoException;
  if (err.code !== undefined) out.code = err.code;
  if (err.errno !== undefined) out.errno = err.errno;
  if (err.syscall !== undefined) out.syscall = err.syscall;
  out.path = shown;
  return out;
}

const closeQuietly = (fd: number): void => {
  try {
    closeSync(fd);
  } catch {
    // already closed
  }
};

const kindOf = (st: Stats): string =>
  st.isFIFO() ? "a FIFO" : st.isSocket() ? "a socket" : st.isCharacterDevice() ? "a character device" : st.isBlockDevice() ? "a block device" : st.isDirectory() ? "a folder" : "not a file";

/**
 * Where the walk goes by path: the real path of `dirPath`, a folder a write is about to land in (or the name it is about
 * to remove), must lie inside the real path of `abs`'s project folder (project-read.ts `realPathIn`, the test every read
 * makes). Refused by the first name on the way whose real path leaves that folder. A path with no project folder, a
 * folder outside it (the folder above the walk's start) and a folder that does not exist are left as they were: nothing
 * can be written into a folder that is not there, and the operation fails as before.
 */
function keepInside(dirPath: string, abs: string, meant: string): void {
  const project = projectFolderOf(abs);
  if (project === null || !inside(dirPath, project)) return;
  let at: { real: string; inside: boolean };
  try {
    at = realPathIn(dirPath, project);
  } catch (e) {
    if (codeOf(e) === "ENOENT" || codeOf(e) === "ENOTDIR") return;
    throw e;
  }
  if (at.inside) return;
  let here = project;
  for (const n of relativePath(project, dirPath).split("/").filter((x) => x !== "")) {
    here = join(here, n);
    let step: { real: string; inside: boolean } | null;
    try {
      step = realPathIn(here, project);
    } catch {
      step = null;
    }
    if (step !== null && !step.inside) throw new LinkRefusal(meant, here, step.real, "outside");
  }
  throw new LinkRefusal(meant, dirPath, at.real, "outside");
}

/** Look at every name below `anchor` to `abs` by its path (the walk where there are no folder descriptors). */
function lookDown(abs: string, anchor: string, meant: string, own: boolean): void {
  const rel = relativePath(anchor, abs);
  if (rel === "") return;
  const names = rel.split("/");
  let here = anchor;
  const last = own ? names.length : names.length - 1;
  for (let i = 0; i < last; i++) {
    here = join(here, names[i] as string);
    let st;
    try {
      st = lstatSync(here);
    } catch (e) {
      if (codeOf(e) === "ENOENT" || codeOf(e) === "ENOTDIR") return;
      throw e;
    }
    if (st.isSymbolicLink()) throw new LinkRefusal(meant, here, linkTarget(here));
  }
}

/**
 * Walk from the anchor of `abs` to the folder that holds its own name, without following a link, and return that
 * folder and the name. `make` makes each missing folder (and the anchor, as `mkdirSync` with `recursive` would);
 * `made` hears each folder made. With folder descriptors, `done` closes the last one.
 */
function walkTo(
  abs: string,
  opts: { within?: string; meant?: string; make?: boolean; mode?: number; made?: (p: string) => void; all?: boolean } = {},
): { dir: Folder; name: string; done: () => void } {
  const anchor = anchorOf(abs, opts.within);
  const meant = opts.meant ?? abs;
  let start = anchor;
  let names = relativePath(anchor, abs).split("/").filter((n) => n !== "");
  // The anchor itself is taken as it is when a folder is made there; any other call on it is walked from its parent.
  if (names.length === 0 && opts.all !== true) {
    start = dirname(anchor);
    names = [basename(anchor)];
  }
  const name = opts.all === true ? "" : (names.pop() as string);
  if (!fdWalk) {
    const dir = join(start, ...names);
    if (opts.make === true) {
      makeByPath(start, names, meant, opts);
    } else {
      lookDown(dir, start, meant, true);
    }
    keepInside(dir, abs, meant);
    return { dir: { fd: null, path: dir }, name, done: () => undefined };
  }
  let fd: number;
  try {
    fd = openSync(start, O_PATH | constants.O_DIRECTORY);
  } catch (e) {
    if (codeOf(e) !== "ENOENT" || opts.make !== true) throw relabel(e, abs);
    // The start folder itself is outside the walk (the header): made as `mkdirSync` would.
    const first = mkdirSync(start, { recursive: true, ...(opts.mode === undefined ? {} : { mode: opts.mode }) });
    if (first !== undefined) opts.made?.(first);
    fd = openSync(start, O_PATH | constants.O_DIRECTORY);
  }
  let path = start;
  try {
    for (const n of names) {
      const next = join(path, n);
      const p = `${FD_ROOT}/${fd}/${n}`;
      let child: number;
      try {
        child = openSync(p, O_PATH | NOFOLLOW);
      } catch (e) {
        if (codeOf(e) !== "ENOENT" || opts.make !== true) {
          if (codeOf(e) === "ENOENT") throw errno("ENOENT", abs, "no such file or directory");
          if (codeOf(e) === "ENOTDIR") throw errno("ENOTDIR", abs, "not a directory");
          throw relabel(e, abs);
        }
        try {
          mkdirSync(p, opts.mode === undefined ? undefined : { mode: opts.mode });
          opts.made?.(next);
        } catch (e2) {
          if (codeOf(e2) !== "EEXIST") throw relabel(e2, next);
        }
        child = openSync(p, O_PATH | NOFOLLOW);
      }
      let st: Stats;
      try {
        st = fstatSync(child);
      } catch (e) {
        closeQuietly(child);
        throw relabel(e, next);
      }
      if (st.isSymbolicLink()) {
        closeQuietly(child);
        throw new LinkRefusal(meant, next, linkTarget(p));
      }
      if (!st.isDirectory()) {
        closeQuietly(child);
        // A named pipe, a socket or a device where a folder should be is refused by name with its kind, as it is at the
        // file's own name (an --out folder that was a named pipe, for one); a
        // regular file there stays the plain "not a directory".
        if (!st.isFile()) throw new LinkRefusal(meant, next, null, "special", kindOf(st));
        throw errno("ENOTDIR", abs, `not a directory: ${next}`);
      }
      closeSync(fd);
      fd = child;
      path = next;
    }
  } catch (e) {
    closeQuietly(fd);
    throw e;
  }
  const held = fd;
  return { dir: { fd: held, path }, name, done: () => closeQuietly(held) };
}

/** Make the missing folders `names` below `start` one at a time by path, each looked at first (no descriptors). */
function makeByPath(start: string, names: string[], meant: string, opts: { mode?: number; made?: (p: string) => void }): void {
  try {
    lstatSync(start);
  } catch (e) {
    if (codeOf(e) !== "ENOENT") throw e;
    const first = mkdirSync(start, { recursive: true, ...(opts.mode === undefined ? {} : { mode: opts.mode }) });
    if (first !== undefined) opts.made?.(first);
  }
  let here = start;
  for (const name of names) {
    here = join(here, name);
    let st;
    try {
      st = lstatSync(here);
    } catch (e) {
      if (codeOf(e) !== "ENOENT") throw e;
      // Nothing is made in a folder whose real path leaves the project folder.
      keepInside(dirname(here), meant, meant);
      try {
        mkdirSync(here, opts.mode === undefined ? undefined : { mode: opts.mode });
        opts.made?.(here);
        continue;
      } catch (e2) {
        if (codeOf(e2) !== "EEXIST") throw e2;
        st = lstatSync(here);
      }
    }
    if (st.isSymbolicLink()) throw new LinkRefusal(meant, here, linkTarget(here));
    if (!st.isDirectory() && !st.isFile()) throw new LinkRefusal(meant, here, null, "special", kindOf(st)); //
    if (!st.isDirectory()) throw errno("ENOTDIR", meant, "not a directory, mkdir");
  }
}

/** Refuse a symbolic link at the name itself (a name that does not exist is fine). */
function notALink(dir: Folder, name: string, shown: string, meant: string): void {
  let st;
  try {
    st = lstatSync(at(dir, name));
  } catch (e) {
    if (codeOf(e) === "ENOENT" || codeOf(e) === "ENOTDIR") return;
    throw relabel(e, shown);
  }
  if (st.isSymbolicLink()) throw new LinkRefusal(meant, shown, linkTarget(at(dir, name)));
}

/** The error of an open, as the person reads it: a link or a file that is not regular at the name is refused. */
function openFailure(e: unknown, dir: Folder, name: string, shown: string, meant: string): unknown {
  if (codeOf(e) === "ELOOP") return new LinkRefusal(meant, shown, linkTarget(at(dir, name)));
  if (codeOf(e) === "ENXIO" || codeOf(e) === "EOPNOTSUPP") {
    // A FIFO with no reader (O_NONBLOCK) or a socket.
    let what = "not a regular file";
    try {
      what = kindOf(lstatSync(at(dir, name)));
    } catch {
      // gone again
    }
    return new LinkRefusal(meant, shown, null, "special", what);
  }
  return relabel(e, shown);
}

/** After an open, before a byte: the descriptor must be a regular file with one name, and (by path) the walked one. */
function checkOpened(fd: number, dir: Folder, name: string, shown: string, meant: string, anchor: string): void {
  const st = fstatSync(fd);
  if (!st.isFile()) throw new LinkRefusal(meant, shown, null, "special", kindOf(st));
  if (st.nlink !== 1) throw new LinkRefusal(meant, shown, null, "hard", String(st.nlink));
  if (dir.fd !== null) return;
  // No folder descriptors: walk again, and the name must still be the file this open reached, in a folder inside.
  lookDown(join(dir.path, name), anchor, meant, true);
  keepInside(dir.path, meant, meant);
  let same = false;
  try {
    // The name's identity, looked at again after the walk, must be exactly the descriptor's (project-read.ts `sameFile`).
    same = sameFile(lookedId(join(dir.path, name), lstatSync(join(dir.path, name), { bigint: true })), fd);
  } catch {
    same = false;
  }
  if (!same) throw new LinkRefusal(meant, shown, null, "changed");
}

function writeAll(fd: number, data: string | Uint8Array): void {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  let offset = 0;
  while (offset < buf.length) offset += writeSync(fd, buf, offset, buf.length - offset);
}

const removeQuietly = (p: string): void => {
  try {
    unlinkSync(p);
  } catch {
    // not there (any more)
  }
};

/** Create `name` in `dir` holding `data` (`O_EXCL`); on any failure after the create, the file is removed again. */
function createIn(dir: Folder, name: string, data: string | Uint8Array, mode: number | undefined, shown: string, meant: string, anchor: string): void {
  let fd: number;
  try {
    fd = openSync(at(dir, name), CREATE_NEW, mode ?? 0o666);
  } catch (e) {
    throw openFailure(e, dir, name, shown, meant);
  }
  try {
    checkOpened(fd, dir, name, shown, meant, anchor);
    writeAll(fd, data);
  } catch (e) {
    closeQuietly(fd);
    removeQuietly(at(dir, name));
    throw relabel(e, shown);
  }
  closeSync(fd);
}

export interface WriteOptions {
  /** The folder the walk starts at, where the rules of the header would pick another. */
  within?: string;
  /** The new file's permission bits (as `writeFileSync`'s `mode`). */
  mode?: number;
}

const tmpNameFor = (name: string): string => `${name}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;

/**
 * Create `path` holding `data` only where nothing has that name: `O_CREAT | O_EXCL | O_NOFOLLOW`. Throws `EEXIST`
 * where something is there, a link included (`LinkRefusal` where the walk finds one first).
 */
export function createNewFile(path: string, data: string | Uint8Array, opts: WriteOptions = {}): void {
  const abs = resolve(path);
  const w = walkTo(abs, opts);
  try {
    notALink(w.dir, w.name, abs, abs);
    createIn(w.dir, w.name, data, opts.mode, abs, abs, anchorOf(abs, opts.within));
  } finally {
    w.done();
  }
}

/**
 * A FILE ANOTHER PROGRAM HOLDS OPEN, ON WINDOWS.
 * Excel and Word keep a file they show open with no sharing, and antivirus holds a file it is checking for a moment, so a
 * rename over it fails with EPERM, EBUSY or EACCES there. Until 2026-11-10 that ended the command in a Node stack. Now the
 * rename is tried again for about a second and a half, and then the command ends in one sentence that says what to do;
 * nothing was replaced (the caller removes its temporary file). Other platforms rename over an open file, so an error
 * there is not this one and goes on as it was.
 */
export class FileHeldRefusal extends Error {
  constructor(shown: string) {
    // Words
    super(`${shown} is open in another program (Excel and Word keep a file they show open, and antivirus can hold a file it is checking): close it and run the same command again. Nothing was replaced.`);
    this.name = "FileHeldRefusal";
  }
}
export const isFileHeldRefusal = (e: unknown): e is FileHeldRefusal => e instanceof FileHeldRefusal;
const HELD_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
/** `renameSync(from, to)`, tried again on Windows while another program holds `to`; `shown` is the path the sentence names. */
export function renameHeldAware(
  from: string,
  to: string,
  shown: string,
  platform: NodeJS.Platform = process.platform,
  rename: (a: string, b: string) => void = renameSync,
  waitMs = 150,
  tries = 10,
): void {
  for (let i = 0; ; i++) {
    try {
      rename(from, to);
      return;
    } catch (e) {
      if (platform !== "win32" || !HELD_CODES.has((e as NodeJS.ErrnoException | null)?.code ?? "")) throw e;
      if (i + 1 >= tries) throw new FileHeldRefusal(shown);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
    }
  }
}

/** Write `path` as a fresh file holding `data`, renamed over whatever regular file had that name. */
export function writeFileAt(path: string, data: string | Uint8Array, opts: WriteOptions = {}): void {
  const abs = resolve(path);
  const w = walkTo(abs, opts);
  try {
    notALink(w.dir, w.name, abs, abs);
    const tmp = tmpNameFor(w.name);
    createIn(w.dir, tmp, data, opts.mode, join(w.dir.path, tmp), abs, anchorOf(abs, opts.within));
    try {
      renameHeldAware(at(w.dir, tmp), at(w.dir, w.name), abs);
    } catch (e) {
      removeQuietly(at(w.dir, tmp));
      throw relabel(e, abs);
    }
  } finally {
    w.done();
  }
}

/** Append `data` to `path`, creating it where there is none; never through a link (`O_APPEND | O_NOFOLLOW`). */
export function appendFileAt(path: string, data: string | Uint8Array, opts: WriteOptions = {}): void {
  const abs = resolve(path);
  const w = walkTo(abs, opts);
  try {
    notALink(w.dir, w.name, abs, abs);
    let fd: number;
    try {
      fd = openSync(at(w.dir, w.name), APPEND, opts.mode ?? 0o666);
    } catch (e) {
      throw openFailure(e, w.dir, w.name, abs, abs);
    }
    try {
      checkOpened(fd, w.dir, w.name, abs, abs, anchorOf(abs, opts.within));
      writeAll(fd, data);
    } catch (e) {
      throw relabel(e, abs);
    } finally {
      closeQuietly(fd);
    }
  } finally {
    w.done();
  }
}

/**
 * A file written as a stream (findings.json): a fresh temporary file in the path's folder, opened `O_EXCL |
 * O_NOFOLLOW`, renamed over the path by `commit` and removed by `abandon` (and by a `commit` that fails). The folder's
 * descriptor is held until then, so the rename lands in the folder the walk reached.
 */
export function openReplacement(path: string, opts: WriteOptions = {}): { fd: number; commit: () => void; abandon: () => void } {
  const abs = resolve(path);
  const w = walkTo(abs, opts);
  const tmp = tmpNameFor(w.name);
  let fd: number;
  try {
    notALink(w.dir, w.name, abs, abs);
    try {
      fd = openSync(at(w.dir, tmp), CREATE_NEW, opts.mode ?? 0o666);
    } catch (e) {
      throw openFailure(e, w.dir, tmp, join(w.dir.path, tmp), abs);
    }
    try {
      checkOpened(fd, w.dir, tmp, join(w.dir.path, tmp), abs, anchorOf(abs, opts.within));
    } catch (e) {
      closeQuietly(fd);
      removeQuietly(at(w.dir, tmp));
      throw e;
    }
  } catch (e) {
    w.done();
    throw e;
  }
  let open = true;
  let finished = false;
  const close = (): void => {
    if (open) closeSync(fd);
    open = false;
  };
  const finish = (): void => {
    if (!finished) w.done();
    finished = true;
  };
  return {
    fd,
    commit: () => {
      try {
        close();
        if (w.dir.fd === null) {
          lookDown(abs, anchorOf(abs, opts.within), abs, false);
          keepInside(w.dir.path, abs, abs);
        }
        notALink(w.dir, w.name, abs, abs);
        renameHeldAware(at(w.dir, tmp), at(w.dir, w.name), abs);
      } catch (e) {
        removeQuietly(at(w.dir, tmp));
        throw relabel(e, abs);
      } finally {
        finish();
      }
    },
    abandon: () => {
      try {
        close();
        removeQuietly(at(w.dir, tmp));
      } finally {
        finish();
      }
    },
  };
}

/**
 * Make the folder `dir` and every missing folder above it (as `mkdirSync` with `recursive`), walking each name: a
 * link is refused, never followed. Returns the first folder it made, or undefined where all stood.
 */
export function makeFolder(dir: string, opts: WriteOptions & { recursive?: boolean } = {}): string | undefined {
  const abs = resolve(dir);
  let first: string | undefined;
  const w = walkTo(abs, { ...opts, make: true, all: true, meant: abs, made: (p) => (first ??= p) });
  w.done();
  return first;
}

/** Remove `name` in `dir` and, where it is a folder, everything in it, folder by folder through descriptors. */
function removeTree(dir: Folder & { fd: number }, name: string, shown: string, force: boolean): void {
  const p = at(dir, name);
  let fd: number;
  try {
    fd = openSync(p, O_PATH | NOFOLLOW);
  } catch (e) {
    if (force && codeOf(e) === "ENOENT") return;
    throw relabel(e, shown);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isDirectory()) {
      // A file, or a link (removed as a link, its target untouched).
      try {
        unlinkSync(p);
      } catch (e) {
        if (!(force && codeOf(e) === "ENOENT")) throw relabel(e, shown);
      }
      return;
    }
    const here = { fd, path: join(dir.path, name) };
    for (const child of readdirSync(`${FD_ROOT}/${fd}/`)) removeTree(here, child, join(here.path, child), force);
    try {
      rmdirSync(p);
    } catch (e) {
      if (!(force && codeOf(e) === "ENOENT")) throw relabel(e, shown);
    }
  } finally {
    closeQuietly(fd);
  }
}

/** Remove `path` (as `rmSync`), the folders on its way and its own name walked first. */
export function removePath(path: string, opts: { recursive?: boolean; force?: boolean; within?: string } = {}): void {
  const abs = resolve(path);
  const w = walkTo(abs, { within: opts.within });
  try {
    notALink(w.dir, w.name, abs, abs);
    if (w.dir.fd === null || opts.recursive !== true) {
      // A recursive removal by path goes into the name itself: its real path must be inside too.
      if (w.dir.fd === null && opts.recursive === true) keepInside(join(w.dir.path, w.name), abs, abs);
      rmSync(at(w.dir, w.name), { recursive: opts.recursive ?? false, force: opts.force ?? false });
      return;
    }
    removeTree(w.dir as Folder & { fd: number }, w.name, abs, opts.force ?? false);
  } catch (e) {
    throw relabel(e, abs);
  } finally {
    w.done();
  }
}

/** Remove the file `path` (as `unlinkSync`), the folders on its way and its own name walked first. */
export function removeFile(path: string, opts: WriteOptions = {}): void {
  const abs = resolve(path);
  const w = walkTo(abs, opts);
  try {
    notALink(w.dir, w.name, abs, abs);
    unlinkSync(at(w.dir, w.name));
  } catch (e) {
    throw relabel(e, abs);
  } finally {
    w.done();
  }
}

/** Remove the empty folder `path` (as `rmdirSync`), walked first. */
export function removeEmptyFolder(path: string, opts: WriteOptions = {}): void {
  const abs = resolve(path);
  const w = walkTo(abs, opts);
  try {
    notALink(w.dir, w.name, abs, abs);
    rmdirSync(at(w.dir, w.name));
  } catch (e) {
    throw relabel(e, abs);
  } finally {
    w.done();
  }
}

/**
 * Rename `from` to `to` (as `renameSync`), every name on both ways walked first except `from`'s own: a rename moves a
 * link as a link and never writes through it, so a link at `from` is moved, not refused (the declaration's set-aside
 * moves a link at profile.json whole); a link at a folder on its way, or at `to`, is refused.
 */
export function renamePath(from: string, to: string, opts: WriteOptions = {}): void {
  const a = resolve(from);
  const b = resolve(to);
  const wa = walkTo(a, { within: opts.within });
  try {
    const wb = walkTo(b, opts);
    try {
      notALink(wb.dir, wb.name, b, b);
      renameHeldAware(at(wa.dir, wa.name), at(wb.dir, wb.name), b);
    } catch (e) {
      throw relabel(e, b);
    } finally {
      wb.done();
    }
  } finally {
    wa.done();
  }
}

/** Give the file `existing` a second name `newPath` (as `linkSync`), both walked first. */
export function linkPath(existing: string, newPath: string, opts: WriteOptions = {}): void {
  const a = resolve(existing);
  const b = resolve(newPath);
  const wa = walkTo(a, opts);
  try {
    notALink(wa.dir, wa.name, a, a);
    const wb = walkTo(b, opts);
    try {
      notALink(wb.dir, wb.name, b, b);
      linkSync(at(wa.dir, wa.name), at(wb.dir, wb.name));
    } catch (e) {
      throw relabel(e, b);
    } finally {
      wb.done();
    }
  } finally {
    wa.done();
  }
}

/**
 * Copy the file `from` into `to`, written as `writeFileAt` writes. Its read is the one reader's (project-read.ts): it
 * opens `O_NONBLOCK`, copies only a regular file, and nothing from outside the project folder.
 */
export function copyFileTo(from: string, to: string, opts: WriteOptions = {}): void {
  // The way to `to` is walked before `from` is read, so a link on it is refused by name whatever `from` is.
  const abs = resolve(to);
  const w = walkTo(abs, opts);
  try {
    notALink(w.dir, w.name, abs, abs);
  } finally {
    w.done();
  }
  writeFileAt(to, readRegularFile(from), opts);
}

/** A new folder in the system's temporary folder (as `mkdtempSync`); writes inside it are walked from it. */
export function makeTempFolder(prefix: string): string {
  const made = mkdtempSync(join(tmpdir(), prefix));
  ownFolders.add(resolve(made));
  return made;
}
