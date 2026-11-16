/**
 * WHETHER A TOOL'S PATH IS A PROTECTED FILE OR LIES INSIDE A PROTECTED FOLDER,
 * DECIDED BY THE FILE, NOT BY THE PATH'S TEXT. One path has many spellings that the operating system opens as the same
 * file: on Windows `C:/...`, `\\?\C:\...`, `\\.\C:\...`, `\\localhost\C$\...`, a short (8.3) name, a trailing dot or
 * space, a `::$DATA` or other stream suffix, any case; on macOS a firmlink (`/System/Volumes/Data/Users/...`) and any
 * case; on every system a symbolic link, a hard link, `..` and doubled separators. Comparing text after resolving links
 * alone let every one of the Windows spellings read the redaction key and write the person's records (fix check FR6,
 * item 1). So a guard row compares identities: the identity of the target (`idOf`), where it exists, with the protected
 * file's or folder's own; and for a path not there yet, the identity of its nearest existing folder and the names that
 * remain, each normalised the way the operating system reads a name (case folded; a trailing dot or space and a stream
 * suffix dropped). Every guard row that compares a tool's path with a protected path goes through `atOrInside` here.
 * Folding case and dropping those suffixes everywhere refuses a few more names on a case-sensitive Linux volume than the
 * volume would treat as the same; that only refuses, it never lets a protected file through. A hard link is found where the tool names it: a hard link to a protected
 * file is that file (the same identity). A hard link from elsewhere to a file INSIDE a protected folder is not found:
 * nothing but a search of the folder could find it, and only a command (`ln`, `mklink /H`) makes one, which is the
 * stated limit (a Bash command is outside the guard's reach). The search that stood here, capped at 20,000 entries,
 * refused every Edit of a file with a second hard link (pnpm's `node_modules`) once the transcript folder grew past it
 * (fix check FR8, item 3), and was removed.
 */
import { lstatSync, readlinkSync, realpathSync, statSync, type BigIntStats } from "node:fs";
import { hostname } from "node:os";
import { isAbsolute, parse, posix, sep, win32 } from "node:path";

/** Windows path rules: `/` is a separator, `..` is resolved by text before the file system sees the path. */
const WINDOWS = sep === "\\";
const SPLIT = WINDOWS ? /[\\/]+/ : /\/+/;
/** How many symlinks one path may pass through, as Linux allows; past that the rest is kept as text. */
const MAX_LINKS = 40;

/** This computer's own names for itself, as a share's server: a loopback share names a local drive. */
const isLoopback = (server: string): boolean => {
  const h = server.toLowerCase();
  return h === "localhost" || h === "::1" || h === "[::1]" || h === "0--1.ipv6-literal.net" || /^127\.\d+\.\d+\.\d+$/.test(h) || h === hostname().toLowerCase();
};

/**
 * A path as a tool names it, made absolute in the one spelling the platform's own path rules give it. On Windows: `/`
 * read as `\`; a `\\?\` or `\\.\` prefix dropped (`\\?\UNC\server\share` is `\\server\share`); a loopback
 * administrative share (`\\localhost\C$`, `\\127.0.0.1\C$`, this computer's name) read as its drive, since Windows
 * reports another device number for a file reached through a share; `.`, `..`, doubled separators and a drive-relative
 * path resolved as Win32 resolves them, by text. On other systems the path is only made absolute: `..` is resolved
 * after links, as the kernel does (`kernelPath`).
 */
export function plainPath(named: string, cwd: string): string {
  if (!WINDOWS) return isAbsolute(named) ? named : `${cwd}${sep}${named}`;
  const p = named
    .replace(/\//g, "\\")
    .replace(/^\\\\[?.]\\UNC\\/i, "\\\\")
    .replace(/^\\\\[?.]\\(?=[A-Za-z]:)/, "")
    .replace(/^\\\\([^\\]+)\\([A-Za-z])\$(?=\\|$)/, (whole, server: string, drive: string) => (isLoopback(server) ? `${drive}:\\` : whole));
  return win32.resolve(cwd, p);
}

/**
 * `target` resolved as the kernel resolves it when it opens the path: from `cwd` unless absolute, one component
 * at a time. A symlink is replaced by its target's components, read before the rest (from the root when the
 * target is absolute); `..` goes up from the real folder reached so far; a component that is not there is kept
 * as text, and so is everything after it that does not exist. On Windows the path is first spelled as `plainPath` gives it.
 */
export function kernelPath(target: string, cwd: string): string {
  const whole = plainPath(target, cwd);
  let root = parse(whole).root || sep;
  const rest = whole.slice(root.length).split(SPLIT);
  const real: string[] = [];
  let links = 0;
  // The number of names kept where one could not be
  // looked up (not there, or not readable), or -1: no longer path through it can be looked up either, so none is asked
  // until a `..` takes that name out again. Asking each one took a time that grew with the square of the parts.
  let gone = -1;
  while (rest.length > 0) {
    const c = rest.shift() as string;
    if (c === "" || c === ".") continue;
    if (c === "..") {
      real.pop();
      if (real.length <= gone) gone = -1;
      continue;
    }
    let to: string | null = null;
    if (gone < 0) {
      const at = root + [...real, c].join(sep);
      try {
        if (links < MAX_LINKS && lstatSync(at).isSymbolicLink()) to = readlinkSync(at);
      } catch {
        // Not there (or not readable): kept as text, and nothing below it is asked.
        gone = real.length;
      }
    }
    if (to === null) {
      real.push(c);
      continue;
    }
    links++;
    if (WINDOWS) to = plainPath(to, root + real.join(sep));
    if (isAbsolute(to)) {
      root = parse(to).root || sep;
      real.length = 0;
      rest.unshift(...to.slice(root.length).split(SPLIT));
    } else rest.unshift(...to.split(SPLIT));
  }
  return root + real.join(sep);
}

/**
 * One name as the operating system reads it when it looks a file up: case folded (Windows and macOS volumes ignore
 * case), a stream suffix dropped (`name::$DATA`, `name:stream`, `name:$I30:$INDEX_ALLOCATION` name `name`'s data), and
 * trailing dots and spaces dropped (Win32 drops them before the file system sees the name).
 */
export function plainName(name: string): string {
  return name.toLowerCase().replace(/:.*$/s, "").replace(/[. ]+$/, "");
}

/** A path located: each prefix from the root down, its plain name and, where it exists, its identity. */
export interface Located {
  /** The path as located: the existing part as the file system spells it (links resolved), the rest as named. */
  path: string;
  /** Its root, and its names after the root as spelled in `path`. */
  root: string;
  parts: string[];
  /** Plain names after the root (`plainName`), the existing part's as the file system spells them. */
  names: string[];
  /** Identity of each existing prefix: `ids[0]` the root's, `ids[j]` that of the prefix ending at `names[j - 1]`. */
  ids: string[];
  /** The located path itself where it exists. */
  stat: BigIntStats | null;
}

const statOf = (p: string): BigIntStats | null => {
  try {
    return statSync(p, { bigint: true });
  } catch {
    return null;
  }
};

/**
 * A file's identity: device and file number; where the file system gives no file number, its path's plain text. On
 * Windows the device is not used: Windows Node reports device 0 for a file on a local drive and the volume's serial
 * number for the same file reached through a share (a drive mapped to `\\localhost\C$`, this computer's own address or
 * any other name for it), so the device would make one file two. In its place the drive letter of the located path, which `locate` reads
 * from the file system (`realpathSync.native`: a `subst` drive reads as the drive it stands on, a loopback
 * administrative share as its drive through `plainPath`), and the file number: `c#<number>`. A path the file system
 * spells as a share (`\\server\share\...`, a mapped network drive, a share of this computer under a name `plainPath`
 * does not know) has no drive this computer can name: `*#<number>`, which `sameFile` matches with the same number on
 * any drive, as before. Without the drive, every NTFS volume's root (file record 5, sequence 5: `C:\` is file number
 * 0x5000000000005, measured) was `C:\`, and a search of `D:\` was refused as reaching the redaction key (fix check FR8,
 * item 4).
 */
export const idOf = (st: BigIntStats, path: string): string => {
  if (st.ino === 0n) return `path:${path.split(SPLIT).map(plainName).join("/")}`;
  if (!WINDOWS) return `${st.dev}:${st.ino}`;
  const drive = /^([A-Za-z]):[\\/]/.exec(path);
  return `${drive ? drive[1].toLowerCase() : "*"}#${st.ino}`;
};

/**
 * Whether two identities (`idOf`) are one file: the same text; on Windows also the same file number where either side
 * was reached through a share, whose drive is not known (`*`). Two drives' files with one file number are two files.
 */
export function sameFile(a: string, b: string): boolean {
  if (a === b) return true;
  if (!WINDOWS) return false;
  const x = /^([a-z*])#(\d+)$/.exec(a);
  const y = /^([a-z*])#(\d+)$/.exec(b);
  return x !== null && y !== null && x[2] === y[2] && (x[1] === "*" || y[1] === "*");
}

/** `named` (from `cwd` unless absolute) located: links followed, the existing part read from the file system. */
export function locate(named: string, cwd: string): Located {
  const text = kernelPath(named, cwd);
  const root = parse(text).root || sep;
  const parts = text.slice(root.length).split(SPLIT).filter((x) => x !== "");
  // The deepest prefix that is there, as the file system spells it: long names for short ones, links and firmlinks
  // as the file system reports them; what is not there is kept as named. The root itself too: on Windows a `subst` drive's root reads as the folder on the drive it
  // stands for (measured), so the drive letter in `idOf` is the volume's own. Found by halving, not one folder up at a time: a
  // prefix resolves only where every shorter one does (kernelPath has taken out every `.` and `..`, and a missing or
  // unreadable folder stops every longer prefix), so the deepest that resolves is the same one, in a number of
  // look-ups that grows with the logarithm of the parts. One at a time, a path of 50,000 parts took 20 s, the entry's
  // whole deadline.
  let existing = root;
  const resolved = (n: number): string | null => {
    try {
      return realpathSync.native(root + parts.slice(0, n).join(sep));
    } catch {
      return null; // not there, or not readable
    }
  };
  let k = -1;
  let lo = 0;
  let hi = parts.length;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const r = resolved(mid);
    if (r !== null) {
      existing = r;
      k = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (k < 0) k = 0;
  const realRoot = parse(existing).root || root;
  const realParts = existing.slice(realRoot.length).split(SPLIT).filter((x) => x !== "");
  const all = [...realParts, ...parts.slice(k)];
  const ids: string[] = [];
  let st: BigIntStats | null = null;
  for (let j = 0; j <= all.length; j++) {
    const p = realRoot + all.slice(0, j).join(sep);
    const s = statOf(p);
    if (s === null) break;
    ids.push(idOf(s, p));
    st = s;
  }
  return { path: realRoot + all.join(sep), root: realRoot, parts: all, names: all.map(plainName), ids, stat: ids.length === all.length + 1 ? st : null };
}

/**
 * Whether `path` is the file or folder `place`, or lies inside it, as the operating system opens them: the same
 * identity (`sameFile`) at `place` or at any folder of `path` above it, so a hard link to the file `place` is `place`;
 * or, where `place` is not there (or `path` names it in a spelling the volume treats as another name), the nearest
 * existing folder of `place` met on `path` and followed by the same plain names. Both located (`locate`). A hard link
 * from `path` to a file inside the folder `place` is not found (the stated limit in this file's header).
 */
export function atOrInside(path: Located, place: Located): boolean {
  const n = place.names.length;
  if (place.stat !== null && path.ids.some((id) => sameFile(id, place.ids[n]))) return true;
  // The nearest existing folder above `place` (its parent where it exists), and the plain names below it.
  const anchor = Math.min(place.ids.length - 1, n - 1);
  if (anchor >= 0) {
    const rest = place.names.slice(anchor);
    for (let i = 0; i < path.ids.length; i++) {
      if (!sameFile(path.ids[i], place.ids[anchor])) continue;
      if (rest.every((name, r) => path.names[i + r] === name)) return true;
    }
  }
  return false;
}

/**
 * A path with a `..` name after a symbolic link has
 * two readings: the kernel's (`kernelPath`: `..` goes up from the folder the link leads to) and the text's (`..` drops
 * the name before it, as Node's `path.resolve` and `path.normalize` do, and so would any tool that tidies a path before
 * it opens it). On macOS `/tmp` is a link to `/private/tmp`: `/tmp/../Users/<me>/...` is `/private/Users/<me>/...` to
 * the kernel and `/Users/<me>/...` to the text. Which of them Claude Code's file tools open is not documented, so a guard
 * compares both and refuses where either names a protected file or folder (hook-guard.ts `onEveryReading`; the parent's
 * decision of 2026-11-10 on proposal P1 of r10-mac-2026-11-10.md). Both readings, text first; none where `named` holds no
 * `..` name, where the two readings are one file or folder (`atOrInside` both ways), and on Windows, whose path rules
 * resolve `..` by text before the file system sees the path (`plainPath`).
 */
export function dotDotReadings(named: string, cwd: string): string[] {
  if (WINDOWS) return [];
  const whole = isAbsolute(named) ? named : `${cwd}${sep}${named}`;
  if (!whole.split(SPLIT).includes("..")) return [];
  const text = posix.resolve(whole);
  const kernel = kernelPath(whole, cwd);
  const a = locate(text, cwd);
  const b = locate(kernel, cwd);
  return atOrInside(a, b) && atOrInside(b, a) ? [] : [text, kernel];
}

/** `atOrInside` of two paths as named, each from `cwd` unless absolute. */
export const pathAtOrInside = (path: string, place: string, cwd: string): boolean => atOrInside(locate(path, cwd), locate(place, cwd));
