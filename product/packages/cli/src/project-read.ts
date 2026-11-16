/**
 * THE ONE READER OF A PATH IN THE SCANNED FOLDER OR THE PROJECT.
 *
 * The class. A scan of a folder holding a named pipe never finished, and printed nothing: the walk opened every entry
 * that is not a folder with a blocking open to look at its first bytes, and a named pipe with no writer holds such an
 * open for ever; every command read `.legal/.gitignore` the same way, and `.git` was skipped only where it was a
 * folder. A clone cannot carry a named pipe, a socket or a device. A folder copied or unpacked whole (`tar`, `cp -a`,
 * `rsync -a`) can, and any process on the computer can make one; a clone can carry a symbolic link to one, or to
 * nothing. project-write.ts closed the class for writes; this module closes it for reads, and every read of a path
 * the scanned folder or the project holds goes through it:
 *
 * - `regularKind` looks at the path (`stat`, which follows a link and opens nothing). A regular file is reported with
 *   its size; anything else - a named pipe, a socket, a device, a folder, or a symbolic link that leads nowhere - is
 *   reported by its kind, and nothing is opened.
 * - `openRegular` opens a regular file read-only and without blocking (`O_NONBLOCK`), then looks at what it opened
 *   (`fstat`): anything that is not a regular file by then is closed unread and reported by its kind.
 * - `readRegularFile` is `readFileSync` through `openRegular`: the same bytes, the same errors for a missing file or a
 *   refused permission, and a `NotRegularFile` error, which names the path and its kind, where `readFileSync` would
 *   have waited for ever or read a device.
 * - `sniffRegular` reads the first bytes of a regular file, for the walk's NUL test.
 *
 * A link to a regular file is followed, as `readFileSync` follows it, but NO READ OF A PROJECT PATH RETURNS A BYTE FROM
 * OUTSIDE THE PROJECT FOLDER. A clone can carry a symbolic link to a file
 * outside itself (`config/aws.ts -> ../../.aws/credentials`); the walk, the engine and the payload writer followed it,
 * and the person's own file reached the seat material in clear. The project folder of a path is the outermost folder a
 * command declared (`declareProjectFolder`; every command's `--target`), else the folder holding the first `.legal` on
 * the path (`projectFolderOf`); a path in neither (a file the person names elsewhere, the program's state) has none, and
 * is read as before. Where it has one, what was opened must lie inside that folder's real path, or it is closed unread
 * and reported as the kind `outside` ("a symbolic link to a file outside the scanned folder"):
 * - on Linux with `/proc`, after the open, by the descriptor's own path (`/proc/self/fd/<n>`): what is compared is the
 *   file that was opened, so no process racing the read can swap it in between;
 * - elsewhere (macOS, Windows, a Linux without `/proc`), by the real path before the open (`realpath`) and, after it,
 *   by the device and inode of what was opened against those of that real path. That is two calls by path, so it does
 *   NOT hold against a racing process: one that swaps a folder on the way for a link to a folder outside after the
 *   real path is taken, and keeps it there through the open, has the file outside compared with itself, and read. A
 *   clone or a copied folder cannot race; it needs a process running on the computer while the program reads.
 * A link to a file inside the project folder is read, as before. `regularKind` looks at a link's real path too, so the
 * walk names such a link without opening it; the open decides.
 * Where a caller names what it did not read, it names the kind (`kindWords`); the walk names each such entry in
 * `excluded_by_walker` (walk.ts `NOT_REGULAR_REASON`). `program-file.ts` opens through `openInside` as well, so the
 * readers of program-written `.legal` files keep the same rule, and `project-write.ts` reads a copy's source here.
 *
 * `test:project-writes` part 1 holds this: outside this module, program-file.ts and project-write.ts, a module of the
 * CLI's build that calls `readFileSync`, `openSync` or `createReadStream` is on its reviewed list, with the number of
 * such calls and what they read (the program's own files, a descriptor already opened, standard input); and of those
 * two, program-file.ts names no `openSync` and project-write.ts no `readFileSync` (part 1c). Part 7 is the case.
 *
 * **THE BOUND ON A SYMBOLIC LINK: the system resolves a link at a path this module looks at only after the module has
 * walked the link's chain itself, within a bound; past it, the link is not followed and is reported as such, never read**. A clone can carry a chain of links whose
 * bodies run hundreds of folders down and back up: the C library's `realpath` re-walks the path resolved so far for
 * every component, so one such link cost 1.2 s, and three in an ordinary folder held a walk for 10 s. `pastLinkBound` walks the chain the way `realpath` does - one `lstat` per component of the path resolved so far,
 * one `readlink` per link, at most LINK_HOPS links - and charges each call LINK_CALL steps plus the length of the path
 * it hands the system, each body its length and each component one step more. Where the count passes LINK_PATH_WORK, or
 * the caller's own count (`LinkWork`, the walk's) is spent, the path's kind is `unfollowed`; where a path on the way
 * would pass the longest the system takes (LONGEST_PATH), it is `path-too-long`, a limit of its own and not the work
 * bound's.
 * Either way nothing more is asked of the system for it. Otherwise the system is asked exactly as before (`statSync`, `realpath`, the open), and it answers
 * as before: what it does is the same walk or less (`realpath` is the same algorithm, the kernel's own resolution is
 * linear), so its time is bounded by a constant times the steps just charged. So a link whose chain stays within the
 * bound is read, refused or named exactly as before this change, and one past it costs at most the bound. On Windows
 * the gauge is not run (its paths are not POSIX paths) and a link is resolved as before.
 */
import { type BigIntStats, closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readlinkSync, readSync, realpathSync, statSync, type Stats } from "node:fs";
import { isAbsolute, parse, resolve, sep } from "node:path";
import { isUtf8 } from "node:buffer";

/**
 * THE ONE DECODE OF A SOURCE FILE'S BYTES.
 * Every reader of the scanned project's files turns bytes into text here, so the engine's line N, the payload's window
 * on it and the later check of a seat's quotation are the same text: a second decode anywhere is a second answer.
 *
 * A UTF-16 byte-order mark decides UTF-16 (FF FE little-endian, FE FF big-endian) and is dropped with the decode; FF FE
 * 00 00 is UTF-32's mark and is not taken for UTF-16. Everything else is UTF-8 exactly as `toString("utf8")` reads it:
 * a UTF-8 mark is kept as it always was, and bytes that are not UTF-8 (Shift_JIS, Latin-1) become U+FFFD, so ASCII
 * constructs still match and the file is still read. `whole` says whether every byte decoded: false for such a file
 * (a pattern written in non-ASCII text cannot match it), and for UTF-16 with an odd last byte.
 */
export type SourceEncoding = "utf-8" | "utf-16le" | "utf-16be";

export function sourceEncodingOf(bytes: Uint8Array): SourceEncoding {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe && !(bytes.length >= 4 && bytes[2] === 0 && bytes[3] === 0)) return "utf-16le";
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return "utf-8";
}

export function decodeSource(bytes: Buffer): { text: string; encoding: SourceEncoding; whole: boolean } {
  const encoding = sourceEncodingOf(bytes);
  if (encoding === "utf-8") return { text: bytes.toString("utf8"), encoding, whole: isUtf8(bytes) };
  const even = (bytes.length - 2) & ~1;
  const body = Buffer.from(bytes.subarray(2, 2 + even));
  if (encoding === "utf-16be") body.swap16();
  return { text: body.toString("utf16le"), encoding, whole: even === bytes.length - 2 };
}

/** `decodeSource(bytes).text`: the text every reader of a source file uses. */
export function decodeSourceText(bytes: Buffer): string {
  return decodeSource(bytes).text;
}

/** A source file of the scanned project, read through `readRegularFile` and decoded through `decodeSourceText`. */
export function readSourceText(path: string): string {
  return decodeSourceText(readRegularFile(path));
}

/**
 * What stands at a path that is not a regular file. `unfollowed`: a symbolic link whose chain was not walked to its end,
 * because it passes the bound on a link (see the header); `path-too-long`: one whose chain passes, on the way, a path
 * longer than the system takes, so the gauge cannot walk it as the system would. What either leads to is not known,
 * and nothing was read.
 */
export type NotRegularKind = "named-pipe" | "socket" | "device" | "folder" | "link-to-nothing" | "outside" | "unfollowed" | "path-too-long";

/** The kind in words, for a sentence a person reads. */
export function kindWords(kind: NotRegularKind, throughLink = false): string {
  const words: Record<NotRegularKind, string> = {
    "named-pipe": "a named pipe",
    socket: "a socket",
    device: "a device",
    folder: "a folder",
    "link-to-nothing": "a symbolic link that leads nowhere",
    outside: "a file outside the scanned folder, reached through a symbolic link on the way to it",
    unfollowed: "a symbolic link not followed to its end, because its chain of links is longer than the program follows for one file",
    "path-too-long":
      "a symbolic link not followed to its end, because a path on the way to what it names is longer than the system takes (4,095 bytes)",
  };
  if (kind === "outside" && throughLink) return "a symbolic link to a file outside the scanned folder";
  return throughLink && kind !== "link-to-nothing" && kind !== "outside" && kind !== "unfollowed" && kind !== "path-too-long"
    ? `a symbolic link to ${words[kind]}`
    : words[kind];
}

/** Why a path was not read, in words: its kind, and for a kind of file, that it is not a regular one. */
export function whyNotRead(kind: NotRegularKind, throughLink = false): string {
  return kind === "outside" || kind === "unfollowed" || kind === "path-too-long" ? kindWords(kind, throughLink) : `${kindWords(kind, throughLink)}, not a regular file`;
}

/**
 * THE BOUND ON A SYMBOLIC LINK (see the header). LINK_HOPS is Linux's own limit on the links one resolution follows
 * (MAXSYMLINKS): past it the system answers ELOOP, so the gauge stops there too. LINK_CALL is what one system call is
 * charged, beside the length of the path it is handed. LINK_PATH_WORK is the bound on one path, far above what any
 * link of the corpus and the ten trees of the record costs.
 */
const LINK_HOPS = 40;
const LINK_CALL = 512;
const LINK_PATH_WORK = 1_000_000;
/** The longest path the gauge hands the system (Linux's PATH_MAX less its terminating byte). */
const LONGEST_PATH = 4095;

/** A count a caller keeps of the links it has asked about; `charge` throws a `LinkWorkSpent` once it is spent. */
export interface LinkWork {
  charge(steps: number): void;
}
/** Thrown by a `LinkWork` that is spent: the link being walked is not followed. */
export class LinkWorkSpent {}
class PathWorkSpent {}
const PATH_WORK_SPENT = new PathWorkSpent();
const PATH_TOO_LONG = new PathWorkSpent();
const GAUGED = process.platform !== "win32";

/**
 * Where the chain of the symbolic link at `path` passes the bound, the kind it is given, else null: walked as `realpath`
 * walks it, every call charged (see the header), from the real path of the path's project folder where the path lies in
 * one, else from the root. Bytes are kept as bytes (each a `latin1` character), so a name or a body that is not valid
 * UTF-8 is walked as the system walks it. Null where the chain ends within the bound, and also where the walk stops at
 * an error (a component missing, not a folder, not searchable, past LINK_HOPS links): the system then answers the same,
 * at no greater cost. `unfollowed` where the count passes LINK_PATH_WORK or `work` is spent; `path-too-long` where a
 * path on the way would pass LONGEST_PATH first, which no folder the walker lists can reach and the system's own
 * resolution may still walk: a limit of the gauge, named as such, never the work bound's words.
 */
function pastLinkBound(path: string, work?: LinkWork): "unfollowed" | "path-too-long" | null {
  let spent = 0;
  const charge = (k: number): void => {
    spent += k;
    if (spent > LINK_PATH_WORK) throw PATH_WORK_SPENT;
    work?.charge(k);
  };
  const bytes = (s: string): Buffer => Buffer.from(s, "latin1");
  const asBytes = (s: string): string => Buffer.from(s, "utf8").toString("latin1");
  try {
    let rest = asBytes(isAbsolute(path) ? path : `${process.cwd()}/${path}`);
    let cur = "";
    const folder = projectFolderOf(resolve(path));
    if (folder !== null) {
      const at = asBytes(folder.endsWith("/") ? folder : `${folder}/`);
      const real = realFolder(folder);
      if (rest.startsWith(at) && real.startsWith("/")) {
        cur = real === "/" ? "" : asBytes(real);
        rest = rest.slice(at.length);
      }
    }
    // The components still to walk, as a stack of frames: a link's body is walked before what followed the link.
    const frames: { parts: string[]; at: number }[] = [{ parts: rest.split("/"), at: 0 }];
    charge(rest.length);
    let isFolder = true;
    let hops = 0;
    while (frames.length > 0) {
      const top = frames[frames.length - 1] as { parts: string[]; at: number };
      if (top.at >= top.parts.length) {
        frames.pop();
        continue;
      }
      const c = top.parts[top.at++] as string;
      charge(1 + c.length);
      // A component after one that is not a folder: the system answers ENOTDIR here.
      if (!isFolder) return null;
      if (c === "" || c === ".") continue;
      if (c === "..") {
        cur = cur.slice(0, Math.max(0, cur.lastIndexOf("/")));
        continue;
      }
      const next = `${cur}/${c}`;
      if (next.length > LONGEST_PATH) throw PATH_TOO_LONG;
      charge(LINK_CALL + next.length);
      let st: Stats;
      try {
        st = lstatSync(bytes(next));
      } catch {
        return null;
      }
      if (!st.isSymbolicLink()) {
        cur = next;
        isFolder = st.isDirectory();
        continue;
      }
      if (++hops > LINK_HOPS) return null;
      charge(LINK_CALL + next.length);
      let body: string;
      try {
        body = readlinkSync(bytes(next), "latin1");
      } catch {
        return null;
      }
      charge(body.length);
      if (body === "") return null;
      if (body.startsWith("/")) cur = "";
      frames.push({ parts: body.split("/"), at: 0 });
    }
    return null;
  } catch (e) {
    if (e === PATH_TOO_LONG) return "path-too-long";
    if (e === PATH_WORK_SPENT || e instanceof LinkWorkSpent) return "unfollowed";
    throw e;
  }
}

/** The kind of what `st` describes, or null for a regular file. */
export function notRegularKindOf(st: Stats): NotRegularKind | null {
  if (st.isFile()) return null;
  if (st.isDirectory()) return "folder";
  if (st.isFIFO()) return "named-pipe";
  if (st.isSocket()) return "socket";
  return "device";
}

/** A path that holds something other than a regular file: its kind, and whether a symbolic link led there. */
export class NotRegularFile extends Error {
  readonly code = "ENOTREGULAR";
  constructor(
    readonly path: string,
    readonly kind: NotRegularKind,
    readonly throughLink: boolean,
  ) {
    super(`${path} is ${whyNotRead(kind, throughLink)}, so it was not read`);
  }
}

/** `e` as a `NotRegularFile`, or null. */
export function asNotRegular(e: unknown): NotRegularFile | null {
  return e instanceof NotRegularFile ? e : null;
}

const codeOf = (e: unknown): string | undefined => (e as NodeJS.ErrnoException | undefined)?.code;

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

const inside = (path: string, folder: string): boolean => path === folder || path.startsWith(folder.endsWith(sep) ? folder : `${folder}${sep}`);

/** Project folders the command named (`declareProjectFolder`). project-write.ts walks a write inside one from it. */
const projectFolders = new Set<string>();

/** Declare `folder` a project folder this command works in (the program declares every command's `--target`, index.ts). */
export function declareProjectFolder(folder: string): void {
  projectFolders.add(resolve(folder));
}

/** The project folders this command declared (`--target` among them): no program it starts is found inside one (child-program.ts). */
export function declaredProjectFolders(): string[] {
  return [...projectFolders];
}

/**
 * The project folder `abs` lies in: the outermost declared project folder holding it, else the folder holding the first
 * `.legal` on its path; null for any other path. A read of a path that has one stays inside it (see the header);
 * project-write.ts starts its walk there (its rules 2 and 3).
 */
export function projectFolderOf(abs: string): string | null {
  let project: string | undefined;
  for (const p of projectFolders) if (inside(abs, p) && (project === undefined || p.length < project.length)) project = p;
  if (project !== undefined) return project;
  const root = parse(abs).root;
  const parts = abs.slice(root.length).split(sep).filter((p) => p !== "");
  const legalAt = parts.indexOf(".legal");
  return legalAt >= 0 ? root + parts.slice(0, legalAt).join(sep) : null;
}

/** Each project folder's real path, taken once: a folder the person reached through a link of their own is not refused. */
const realFolders = new Map<string, string>();
function realFolder(folder: string): string {
  const known = realFolders.get(folder);
  if (known !== undefined) return known;
  try {
    const real = realpathSync.native(folder);
    realFolders.set(folder, real);
    return real;
  } catch {
    return folder;
  }
}

/**
 * THE ONE CONTAINMENT TEST BY REAL PATH, for reads and writes alike: the real path of `path` (`realpathSync.native`,
 * which throws what it throws) and whether it lies inside the real path of the project folder `folder`. The real path
 * is where the system resolves the name, so a name that leads elsewhere without being a symbolic link is seen by where
 * it leads: on native Windows a junction whose target is written as a volume path (`\\?\Volume{...}\`) is reported by
 * Node's `lstat` as a folder, so a walk that asks each name whether it is a link passes it. `openInside` and
 * `regularKind` ask it of what they read; project-write.ts asks it of the folder a write lands in (`keepInside`).
 */
export function realPathIn(path: string, folder: string): { real: string; inside: boolean } {
  const real = realpathSync.native(path);
  return { real, inside: inside(real, realFolder(folder)) };
}

const FD_ROOT = "/proc/self/fd";
/** Whether `/proc/self/fd/<n>` names the file descriptor `n` holds (Linux with /proc mounted). */
function probeOpenedPaths(): boolean {
  if (process.platform !== "linux") return false;
  let fd: number | undefined;
  try {
    fd = openSync("/", constants.O_RDONLY | constants.O_DIRECTORY);
    return readlinkSync(`${FD_ROOT}/${fd}`) === "/";
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
let viaDescriptor = probeOpenedPaths();

/**
 * Whether an open is kept inside the project folder by the descriptor's own path (Linux with /proc) or by the real path
 * before the open and the device and inode after it (elsewhere). `on` switches it for this process: `test:project-writes`
 * part 7 runs the reader both ways on Linux.
 */
export function readsByDescriptor(on?: boolean): boolean {
  if (on !== undefined) viaDescriptor = on && probeOpenedPaths();
  return viaDescriptor;
}

/** A file's identity, exact: the volume it is on and its index on that volume, each a BigInt. */
export interface FileId {
  readonly dev: bigint;
  readonly ino: bigint;
}

/** The volume of each root a lookup has asked about (native Windows only; see `lookedId`). */
const rootVolumes = new Map<string, bigint>();

/** The volume whose root is the root of `real` (a real path), from a stat of a descriptor opened on that root. */
function volumeOfRoot(real: string): bigint {
  const root = parse(resolve(real)).root;
  const known = rootVolumes.get(root);
  if (known !== undefined) return known;
  const fd = openSync(root, "r");
  try {
    const dev = fstatSync(fd, { bigint: true }).dev;
    rootVolumes.set(root, dev);
    return dev;
  } finally {
    closeSync(fd);
  }
}

/**
 * THE IDENTITY A LOOKUP TAKES, to which the descriptor opened after it is bound.
 * `st` is the lookup's own stat of `path`, taken with `{ bigint: true }` so that the whole index is kept: a
 * Number holds 53 bits, and an NTFS index keeps a sequence number in its high bits, so two files can have one Number.
 * Where the stat names the volume, that is the volume. On native Windows Node's stat by path reports the volume as 0
 * (where a descriptor's names its serial number), so there the volume is that of the root of the path's real path
 * (`real`, where the caller has it), asked of a descriptor on the root: a root is not a name in a folder that anyone can
 * swap for a link. A real path that reaches another volume through a folder it is mounted on is therefore refused as
 * changed, never read on the wrong volume's word.
 */
export function lookedId(path: string, st: BigIntStats, real?: string): FileId {
  if (st.dev !== 0n || process.platform !== "win32") return { dev: st.dev, ino: st.ino };
  return { dev: volumeOfRoot(real ?? realpathSync.native(path)), ino: st.ino };
}

/**
 * THE ONE TEST THAT AN OPEN DESCRIPTOR HOLDS THE FILE A LOOKUP SAW: `fd`'s volume and index, from a stat of the
 * descriptor, are exactly `looked`'s (`lookedId`). Nothing is looked up again by path after the open, so a link or a
 * file put at the name between the lookup and the open, and left there, is not taken for the file looked at.
 */
export function sameFile(looked: FileId, fd: number): boolean {
  const d = fstatSync(fd, { bigint: true });
  return d.ino === looked.ino && d.dev === looked.dev;
}

/**
 * `path` opened for reading only, without blocking (and, with `noFollow`, without following a link at its own name),
 * and what the descriptor holds (`fstat`), where what was opened lies inside the path's
 * project folder (or the path has none); `{ outside: true }` with nothing left open where it lies outside (see the
 * header). Throws the open's own errors, and an `ECHANGED` error where, elsewhere than Linux, the file opened is not the
 * file whose real path was looked at.
 */
export function openInside(path: string, opts: { noFollow?: boolean } = {}): { fd: number; st: Stats } | { outside: true } {
  const folder = projectFolderOf(resolve(path));
  let looked: FileId | null = null;
  let real = "";
  if (folder !== null && !viaDescriptor) {
    const at = realPathIn(path, folder);
    if (!at.inside) return { outside: true };
    real = at.real;
    looked = lookedId(real, statSync(real, { bigint: true }), real);
  }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | (opts.noFollow === true ? constants.O_NOFOLLOW : 0));
  try {
    const st = fstatSync(fd);
    if (folder !== null) {
      if (looked !== null) {
        if (!sameFile(looked, fd)) {
          throw Object.assign(new Error(`${path} changed while it was being opened, so it was not read`), { code: "ECHANGED", path });
        }
      } else if (!inside(readlinkSync(`${FD_ROOT}/${fd}`), realFolder(folder))) {
        closeSync(fd);
        return { outside: true };
      }
    }
    return { fd, st };
  } catch (e) {
    closeSync(fd);
    throw e;
  }
}

export type Kind = { regular: true; size: number } | { regular: false; kind: NotRegularKind; throughLink: boolean };

/**
 * What stands at `path`, looked at without opening it. Throws what `statSync` throws for a path that does not exist or
 * may not be looked at, except a symbolic link that leads nowhere (or round in a loop), which is a kind. A symbolic link
 * at `path` is walked within the bound first (see the header), charged to `work` as well where the caller keeps a count;
 * past the bound its kind is `unfollowed` (or `path-too-long`) and the system is not asked to resolve it.
 */
export function regularKind(path: string, work?: LinkWork): Kind {
  // Whether the path is a link is asked once, before anything follows it, and that answer is used below where the code
  // before the bound asked it again.
  const link = GAUGED ? isLink(path) : undefined;
  const linked = (): boolean => link ?? isLink(path);
  const past = link === true ? pastLinkBound(path, work) : null;
  if (past !== null) return { regular: false, kind: past, throughLink: true };
  let st: Stats;
  try {
    st = statSync(path);
  } catch (e) {
    const code = codeOf(e);
    if ((code === "ENOENT" || code === "ELOOP") && linked()) return { regular: false, kind: "link-to-nothing", throughLink: true };
    throw e;
  }
  const kind = notRegularKindOf(st);
  if (kind !== null) return { regular: false, kind, throughLink: linked() };
  // A link's real path is looked at (nothing is opened), so the walk names a link out of the project folder by its kind.
  const folder = projectFolderOf(resolve(path));
  if (folder !== null && linked()) {
    let outside = false;
    try {
      outside = !realPathIn(path, folder).inside;
    } catch {
      outside = false;
    }
    if (outside) return { regular: false, kind: "outside", throughLink: true };
  }
  return { regular: true, size: st.size };
}

/** A regular file opened read-only without blocking, or the kind that stood there instead (nothing left open). */
export type Opened = { regular: true; fd: number; size: number } | { regular: false; kind: NotRegularKind; throughLink: boolean };

/** `path` opened for reading if it is a regular file (see the header); throws the open's own errors. */
export function openRegular(path: string, work?: LinkWork): Opened {
  const k = regularKind(path, work);
  if (!k.regular) return k;
  // O_NONBLOCK: a named pipe put at the path after the look opens at once instead of waiting for a writer, and is then
  // refused by the look at the descriptor. On a regular file the flag changes nothing. (Windows has neither the flag
  // nor named pipes in a folder; `| undefined` is `| 0`.) The open is kept inside the project folder (`openInside`).
  const o = openInside(path);
  if ("outside" in o) return { regular: false, kind: "outside", throughLink: isLink(path) };
  const kind = notRegularKindOf(o.st);
  if (kind !== null) {
    closeSync(o.fd);
    return { regular: false, kind, throughLink: isLink(path) };
  }
  return { regular: true, fd: o.fd, size: o.st.size };
}

/** `readFileSync(path)` for a path the scanned folder or the project holds (see the header). */
export function readRegularFile(path: string): Buffer;
export function readRegularFile(path: string, encoding: BufferEncoding): string;
export function readRegularFile(path: string, encoding?: BufferEncoding): string | Buffer {
  const o = openRegular(path);
  if (!o.regular) throw new NotRegularFile(path, o.kind, o.throughLink);
  try {
    const bytes = readFileSync(o.fd);
    return encoding === undefined ? bytes : bytes.toString(encoding);
  } finally {
    closeSync(o.fd);
  }
}

/** The first `n` bytes of the regular file at `path`, or the kind that stood there instead; throws the open's own errors. */
export function sniffRegular(path: string, n: number, work?: LinkWork): { regular: true; head: Buffer } | { regular: false; kind: NotRegularKind; throughLink: boolean } {
  const o = openRegular(path, work);
  if (!o.regular) return o;
  try {
    const buf = Buffer.alloc(n);
    const got = readSync(o.fd, buf, 0, n, 0);
    return { regular: true, head: buf.subarray(0, got) };
  } finally {
    closeSync(o.fd);
  }
}
