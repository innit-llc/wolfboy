/**
 * THE HOST'S SEARCH, AS A SEAT RAN IT.
 *
 * A seat's Grep and Glob are premises of every place it read (place-premises.ts, premise 8): a later run replays each
 * one and carries the place only where the replay returns what it returned when the place was read. Three things decide
 * whether a replay can stand for the host's search, and this module holds them.
 *
 * 1. WHAT THE SEAT PASSED. The capture records the host call's whole input (seat-opened.ts `SeatSearch.input`), and a
 *    replay reads it only where it understands every key and value in it (`searchInputProblem`). A key this program
 *    does not know - one a later Claude Code build adds, say - makes the search unreplayable, so the place is read
 *    again rather than carried on a search the replay ran differently. Before this module the capture kept four keys
 *    (pattern, path, `-i`, multiline) and dropped the rest: every Grep narrowed by `glob` was replayed over every file in
 *    scope, and the 646 rows of one real run's log that the replay "found more" on were all of that kind.
 *
 * 2. THE HOST'S OWN ENGINE, FIRST. Where it is found (`hostEngineNow`), every search is replayed by the ripgrep that
 *    Claude Code ships, run as the host's Grep or Glob runs it (`hostEngineArgs`, `hostGlobToolArgs`), over the files the
 *    host's search walks. That engine is a premise of the row it replays: its path and its version text are recorded,
 *    and a later run with another engine, or none, reads the place again (a Claude Code update reads every engine row
 *    again once: the price of searching the host's own file set).
 *
 * 3. TODAY'S REPLAY, ONLY WHERE NO ENGINE IS FOUND, AND ONLY WHERE IT SEARCHES AT LEAST WHAT THE HOST COULD. Today's
 *    replay reads the scanner's own read scope, which leaves out tests, specs, mocks, fixtures, lock files, hidden
 *    folders, large files and `node_modules`; the host's ripgrep searches them. So a Grep replayed without the engine
 *    stands only where every file under its scope that the host's pieces let through is one the replay reads
 *    (rests-on.ts `fallbackReplay`, from a plain listing of the folder): one such file the replay does not read makes
 *    the search unreplayable, at capture and at every later run. A Glob is replayed over that plain listing itself. The
 *    replay reads a `glob` as ripgrep does (`hostGlobFilter`) for the shapes whose meaning is settled here and refuses
 *    every other shape (a character class, an escape, a `?`, a nested or empty alternative, a `**` outside a whole path
 *    component).
 *
 * Either replay is held to the host's own result at capture (place-premises.ts `hostDifference`); neither is trusted
 * on its own.
 *
 * A ROW WITH NO INPUT - a row of a log written before the capture kept the input, or a reply's own `searched[]` row -
 * has no host result to be held to and names no call the engine could repeat exactly: it is never replayed by the
 * engine, and today's replay stands for it only by point 3's rule, checked on each run's own tree (rests-on.ts
 * `inputlessReplay`).
 *
 * ONE SCOPE FOR EVERY ROW. A row is judged over the file set of its canonical scope, computed by `searchScopeOf` alone: every row kind and every replay above turns a scope's text into a folder
 * or file of the tree only through it, and every function that lists files takes the `TreeScope` it returns. Before,
 * a scope was turned into files in several ways - the capture followed a link only in an absolute path, a reply's row
 * kept the seat's spelling (`src/`, `.`), and the replays matched files against the text as written - so a row could be
 * judged over a set of files the host never searched (none at all, for `src/` or a linked folder).
 *
 * THE INVARIANT: THE HOST'S BEHAVIOUR IS ALWAYS APPLIED TO THE SEAT'S
 * WRITTEN INPUT, AT EVERY RUN; THE CANONICAL SCOPE IS DERIVED FROM IT EACH TIME, NEVER STORED IN ITS PLACE. The canonical
 * scope is a function of the tree's links at the moment it is computed, so the scope a row records is only what the
 * row was digested over. Every later run derives the scope again from what the seat wrote - the host call's `path`, or
 * the folder a reply's row names - with `searchScopeOf` on that run's tree, and reads the place again wherever the two
 * differ (rests-on.ts `scopeNowOf`): a link re-pointed, made or removed in the path makes the host's search read
 * another folder. The host's own handling of the written path is modelled on the path as written, never on its target:
 * its expansion (`hostPathOf`) before any link is followed, and its Glob's pattern cut on that expansion
 * (`hostGlobCutProblem`). A spelling this program cannot place in the tree is outside it, never a missing folder inside.
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { relativePath } from "./project-path.js";
import { foldersNoProgramComesFrom, programFolderHolding } from "./child-program.js";

/** The variable Claude Code sets in every process it starts: the path of its own executable, which carries its ripgrep. */
export const HOST_ENGINE_ENV = "CLAUDE_CODE_EXECPATH";

/* --------------------------------------------------------------------------------------------- *
 * A search's scope: the one place its text becomes a folder or a file of the tree.
 * --------------------------------------------------------------------------------------------- */

declare const treeScopeBrand: unique symbol;
/**
 * A scope as `searchScopeOf` returns it for a folder or file of the tree: the
 * path from the tree's real root, `/`-separated, with no `.`, `..`, empty or trailing part and no symbolic link in it;
 * the empty string is the whole tree. Only `searchScopeOf` makes one, and every function that turns a scope into files
 * (`replaySearch`, `fallbackReplay`, the host's pieces, the engine's request) takes this type, so no other spelling of
 * a scope reaches a file list.
 */
export type TreeScope = string & { readonly [treeScopeBrand]: true };

/** The whole tree as a scope. */
export const WHOLE_TREE = "" as TreeScope;

/**
 * Where a search's scope is: a folder or file of the tree (`tree`, its canonical scope), a path inside the tree that
 * names nothing there (`missing`, the path from the tree's real root), or a place outside the tree (`outside`, and
 * `why` where it is a spelling this program cannot place rather than a path whose real path leaves the tree). `real` is
 * the absolute real path (for a missing path, its deepest existing folder's real path and the rest of the path).
 */
export type SearchScope =
  | { at: "tree"; scope: TreeScope; real: string }
  | { at: "missing"; scope: string; real: string }
  | { at: "outside"; real: string; why?: string };

/**
 * A path's real path, every symbolic link in it followed; where it names nothing, its deepest existing folder's real
 * path and the rest (`rest`: how many of its last names are not there).
 */
function realPathOf(asked: string): { real: string; found: boolean; rest: number } {
  try {
    return { real: realpathSync(asked), found: true, rest: 0 };
  } catch {
    /* below: the deepest folder that is there */
  }
  const rest: string[] = [];
  let up = asked;
  for (;;) {
    const parent = dirname(up);
    if (parent === up) return { real: asked, found: false, rest: rest.length };
    rest.unshift(basename(up));
    up = parent;
    try {
      return { real: join(realpathSync(up), ...rest), found: false, rest: rest.length };
    } catch {
      /* one folder further up */
    }
  }
}

/**
 * THE PATH THE HOST'S GREP AND GLOB SEARCH, for the `path` a seat wrote:
 * Claude Code's own expansion of it (2.1.312: the tools' `getPath` gives the written path to the expansion `ct`, read
 * from the executable's bytes), lexical, before any symbolic link is followed. No path, or an empty one, is the host's
 * working folder (`cwd`). Otherwise the text is trimmed; `~` is the home folder and `~/rest` the rest below it; an
 * absolute path is normalised; anything else is resolved from `cwd`. A path holding a NUL is one the host refuses
 * (null), and so is `~` where no home folder can be read (this program cannot name the place). The host's Windows-only
 * rewrite of `/c/...` and its mode that passes the path through unexpanded are not modelled (Linux is the platform this
 * program reads the host on).
 */
export function hostPathOf(cwd: string, written: string | undefined): string | null {
  if (written === undefined || written === "") return resolve(cwd);
  if (written.includes("\0")) return null;
  const text = written.trim();
  if (text === "") return resolve(cwd);
  if (text === "~" || text.startsWith("~/")) {
    let home: string;
    try {
      home = homedir();
    } catch {
      return null; // no home folder to read it from: a place this program cannot name
    }
    return text === "~" ? home : join(home, text.slice(2));
  }
  if (isAbsolute(text)) return normalize(text);
  return resolve(cwd, text);
}

/**
 * Whether every name of a path below `top` is listed in its folder under
 * exactly that spelling. On a file system that matches names without regard to case or Unicode form (macOS by default, a
 * Windows folder seen from WSL, a case-folding Linux folder), `realpath` keeps a name as the seat wrote it (`Src` for the
 * folder `src`), while every listing of the tree holds the folder's own spelling: such a scope would be digested over
 * no file and never move. It is a spelling this program cannot place in the tree.
 */
function listedAsWritten(top: string, names: readonly string[]): boolean {
  let at = top;
  for (const name of names) {
    try {
      if (!readdirSync(at).includes(name)) return false;
    } catch {
      return false;
    }
    at = join(at, name);
  }
  return true;
}

/**
 * THE ONE FUNCTION THAT DECIDES A SEARCH ROW'S SCOPE. A row is judged over
 * the file set of its canonical scope, computed by this function alone: for every row kind (a seat's search captured
 * with its input or without it, a reply's own `searched[]` row, a row of an earlier log) and for every consumer (the
 * plain listing, the walker's replay, the engine's replay, the `.legal` exemption, the outside-the-tree test, the
 * missing-path test). The text is expanded as the host expands it (`hostPathOf`: read from the tree's root where it is
 * not absolute, `~` the home folder, trimmed); `.`, `..`, repeated and trailing `/` and `./` are normalised (`app/`,
 * `./app`, `app/.`, `app//` and `.legal/../app` are all `app`; `.` is the whole tree); then every symbolic link in it is
 * followed, for a relative path exactly as for an absolute one, because the host's ripgrep follows a link named as the
 * searched path (checked with the 2.1.312 engine: a Grep of `lnk`, a link to `real`, returns `real`'s lines) and follows
 * none it meets below it. A path whose real path leaves the tree is `outside`, never a scope of the tree; so is a
 * spelling this program cannot place in it (a NUL; a name the folder lists only under another case or Unicode form,
 * `listedAsWritten`); a path inside the tree that names nothing there is `missing`. Nothing is opened and nothing is run.
 * IT IS GIVEN WHAT THE SEAT WROTE, AT EVERY RUN: the host call's `path`
 * (or, for a reply's row, the folder its words name), never a scope this function returned on an earlier run. Its answer
 * depends on the tree's links when it runs, so a later run that gave it the canonical text recorded earlier would replay
 * the old target of a link re-pointed since. A scope it returned is compared with the scope a row was digested over
 * (rests-on.ts `scopeNowOf`), never fed back into it.
 */
export function searchScopeOf(root: string, path: string | undefined): SearchScope {
  // A value that is not a path (a record of another shape) is never a scope of the tree: outside, so never complete.
  if (typeof root !== "string" || (path !== undefined && typeof path !== "string")) return { at: "outside", real: "" };
  const top = realPathOf(resolve(root)).real;
  const asked = hostPathOf(resolve(root), path);
  if (asked === null) return { at: "outside", real: "", why: "the host refuses a path holding a NUL character, and a `~` with no home folder to read names no place" };
  const { real, found, rest } = realPathOf(asked);
  const rel = relativePath(top, real);
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) return { at: "outside", real };
  const names = rel === "" ? [] : rel.split("/");
  if (!listedAsWritten(top, names.slice(0, names.length - rest))) {
    return { at: "outside", real, why: "a name in the path is not listed under that spelling in its folder (another case or Unicode form of a name there), so this program cannot place it in the tree" };
  }
  const scope = names.join("/");
  return found ? { at: "tree", scope: scope as TreeScope, real } : { at: "missing", scope, real };
}

type Obj = Record<string, unknown>;

const isWhole = (v: unknown): boolean => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isFlag = (v: unknown): boolean => typeof v === "boolean";
const isText = (v: unknown): boolean => typeof v === "string";

/**
 * Every key of the host's Grep input this program understands, with the values it understands. `pattern`, `path`,
 * `glob`, `type`, `-i` and `multiline` decide which lines the search returns, and the replay reads each; the output
 * shape (`output_mode`, `-n`, `-o`, the context lines) and the limits (`head_limit`, `offset`) decide only how the host
 * printed them, which the capture reads when it compares the replay with the host's result (seat-opened.ts
 * `hostResultOf`). Taken from Claude Code's Grep tool as the version the record names builds its ripgrep call.
 */
export const GREP_INPUT_KEYS: Readonly<Record<string, (v: unknown) => boolean>> = {
  pattern: isText,
  path: isText,
  glob: isText,
  type: isText,
  output_mode: (v) => v === "content" || v === "files_with_matches" || v === "count",
  "-i": isFlag,
  "-n": isFlag,
  "-o": isFlag,
  multiline: isFlag,
  "-A": isWhole,
  "-B": isWhole,
  "-C": isWhole,
  context: isWhole,
  head_limit: isWhole,
  offset: isWhole,
};

/** Every key of the host's Glob input this program understands. */
export const GLOB_INPUT_KEYS: Readonly<Record<string, (v: unknown) => boolean>> = { pattern: isText, path: isText };

/**
 * Why a replay cannot read the host call's input, or null where it understands every key and value in it. The reason
 * names the first key it does not understand, so the record says what to teach the replay.
 */
export function searchInputProblem(tool: "grep" | "glob", input: Obj): string | null {
  const known = tool === "grep" ? GREP_INPUT_KEYS : GLOB_INPUT_KEYS;
  for (const [key, value] of Object.entries(input)) {
    const ok = Object.prototype.hasOwnProperty.call(known, key) ? known[key]! : null;
    if (ok === null) return `the seat's ${tool === "grep" ? "Grep" : "Glob"} passed ${JSON.stringify(key)}, which this program's replay does not understand, so the search is not replayed.`;
    if (!ok(value)) return `the seat's ${tool === "grep" ? "Grep" : "Glob"} passed ${JSON.stringify(key)} as ${JSON.stringify(value).slice(0, 60)}, a value this program's replay does not understand, so the search is not replayed.`;
  }
  return null;
}

/**
 * The host Grep's own split of a `glob` value into ripgrep `--glob` pieces: the value cut at white space, and each part
 * that does not hold both `{` and `}` cut again at commas (Claude Code's Grep tool).
 */
export function hostGlobPieces(glob: string): string[] {
  const out: string[] = [];
  for (const part of glob.split(/\s+/)) {
    if (part.includes("{") && part.includes("}")) out.push(part);
    else out.push(...part.split(","));
  }
  return out.filter((p) => p !== "");
}

/** The pieces the host's Grep puts before the seat's: version-control folders, which it never searches. */
export const HOST_GLOB_LEAD = ["!.git", "!.svn", "!.hg", "!.bzr", "!.jj", "!.sl"] as const;
/**
 * The piece the plugin's seat guard appends after the seat's on a search of the folder that holds the run's `.legal`
 * (hook-seat-read.ts `leaveLegalOut`): the transcript holds the seat's own input, before the guard, so a replay of a
 * search of the tree's root appends it. A search of a folder below the root never reaches `.legal`, and the guard
 * appends nothing there.
 */
export const HOST_GLOB_TAIL = ["!/.legal"] as const;

/** Every `--glob` piece the host's ripgrep is given for a search of `scope`, in order: the host's, the seat's, the guard's. */
export function hostGlobPiecesFor(glob: string | undefined, scope: TreeScope): string[] {
  return [...HOST_GLOB_LEAD, ...(glob ? hostGlobPieces(glob) : []), ...(scope === "" ? HOST_GLOB_TAIL : [])];
}

interface CompiledPiece {
  ignore: boolean;
  onlyDir: boolean;
  re: RegExp;
}

/** A literal character of a glob, as a regular expression reads it (`/` stays bare: the `**` forms look for it). */
const escapeRe = (c: string): string => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One piece as ripgrep's override reads it (the `ignore` crate's gitignore rules over `globset` with a literal path
 * separator), for the shapes this program settles; any other shape is refused with its reason. A piece without `!`
 * keeps a file (a whitelist), one with `!` leaves it out. A piece holding no `/` matches at any depth (`**\/` before
 * it); one holding a `/` is anchored at ripgrep's working folder, which the host's Grep makes the searched folder
 * itself; a trailing `/**` matches what is below the folder, not the folder.
 */
function compilePiece(raw: string): CompiledPiece | { unsupported: string } {
  let line = raw;
  const refuse = (why: string) => ({ unsupported: `the glob piece ${JSON.stringify(raw)} ${why}` });
  let ignore = false;
  if (line.startsWith("!")) {
    ignore = true;
    line = line.slice(1);
  }
  if (line.startsWith("#")) return refuse("starts as a comment would in ripgrep's reading");
  if (/[\\[\]]/.test(line)) return refuse("holds an escape or a character class, which this replay does not read");
  // ripgrep's `?` is one byte of the name's UTF-8 and a JavaScript expression's one
  // UTF-16 code unit: `??.rb` keeps `é.rb` in ripgrep and not here. Not translated, so the search goes to the engine.
  if (line.includes("?")) return refuse("holds a `?`, which ripgrep reads as one byte of the name and this replay could only read as one character");
  let anchored = false;
  if (line.startsWith("/")) {
    anchored = true;
    line = line.slice(1);
  }
  let onlyDir = false;
  if (line.endsWith("/")) {
    onlyDir = true;
    line = line.slice(0, -1);
  }
  if (line === "") return refuse("names nothing");
  if (!anchored && !line.includes("/") && !line.startsWith("**/")) line = `**/${line}`;
  if (line.endsWith("/**")) line = `${line}/*`;
  const body = translateGlob(line);
  if (typeof body !== "string") return refuse(body.unsupported);
  return { ignore, onlyDir, re: new RegExp(`^${body}$`) };
}

/** `globset`'s regular expression for a glob with a literal separator, for the settled shapes only. */
function translateGlob(glob: string): string | { unsupported: string } {
  const top: string[] = [];
  let branches: string[][] | null = null;
  let branch = top;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    const next = glob[i + 1];
    if (c === "{") {
      if (branches) return { unsupported: "nests one alternative group in another, which ripgrep refuses" };
      branches = [[]];
      branch = branches[0]!;
      continue;
    }
    if (c === "}") {
      if (!branches) return { unsupported: "closes an alternative group it never opened" };
      if (branches.some((b) => b.length === 0)) return { unsupported: "holds an empty alternative, which ripgrep drops" };
      top.push(`(?:${branches.map((b) => b.join("")).join("|")})`);
      branches = null;
      branch = top;
      continue;
    }
    if (c === "," && branches) {
      branches.push([]);
      branch = branches.at(-1)!;
      continue;
    }
    if (c === "*" && next === "*") {
      const prev = glob[i - 1];
      const after = glob[i + 2];
      if (branch.length === 0 && (prev === undefined || prev === "{" || prev === ",") && after === "/") {
        // A leading `**/`: any number of folders, none included.
        branch.push("(?:/?|.*/)");
        i += 2;
        continue;
      }
      const ends = after === undefined || (branches !== null && (after === "," || after === "}"));
      if (prev === "/" && branch.at(-1) === "/" && (ends || after === "/")) {
        branch.pop();
        if (ends) branch.push("/.*");
        else {
          branch.push("(?:/|/.*/)");
          i += 1;
        }
        i += 1;
        continue;
      }
      return { unsupported: "holds a `**` that is not a whole path component" };
    }
    if (c === "*") branch.push("[^/]*");
    else branch.push(escapeRe(c));
  }
  if (branches) return { unsupported: "leaves an alternative group open, which ripgrep refuses" };
  return top.join("");
}

/**
 * The seat's `glob` as ripgrep's overrides read it: whether a file of the tree (its path from the tree's root) is
 * searched by a search of the folder `scope` (the empty string is the whole tree). The host's Grep runs ripgrep IN the
 * searched folder (Claude Code's Grep: the folder's own descriptor as the working folder, `.` as the path, on Linux with
 * its own ripgrep), so every piece is read against the file's path from that folder - a piece with a `/` is anchored
 * there, not at the tree's root. The pieces are `hostGlobPiecesFor`'s, in order; the last piece that matches decides. A
 * folder below the searched one that a `!` piece matches is not entered; a file no piece matches is left out where any
 * piece keeps files, searched otherwise.
 */
export function hostGlobFilter(glob: string, scope: TreeScope): ((rel: string) => boolean) | { unsupported: string } {
  return piecesFilter(hostGlobPiecesFor(glob, scope), scope);
}

/**
 * The host's Glob as ripgrep reads it: Claude Code's Glob lists files with
 * `rg --files --no-ignore --hidden --glob <pattern>`, run in the searched folder, with no piece of its own before the
 * pattern (no version-control folder is left out) and no guard piece after it. Whether a file of the tree is listed by
 * a Glob of the folder `scope`; a pattern of a shape this program does not read is refused, as `hostGlobFilter` refuses.
 */
export function hostGlobToolFilter(pattern: string, scope: TreeScope): ((rel: string) => boolean) | { unsupported: string } {
  return piecesFilter([pattern], scope);
}

/** The override pieces `raws`, in order, as a filter of the files below the searched folder `scope`. */
function piecesFilter(raws: readonly string[], scope: TreeScope): ((rel: string) => boolean) | { unsupported: string } {
  const pieces: CompiledPiece[] = [];
  for (const raw of raws) {
    const p = compilePiece(raw);
    if ("unsupported" in p) return p;
    pieces.push(p);
  }
  const keeps = pieces.some((p) => !p.ignore);
  const last = (path: string, dir: boolean): CompiledPiece | null => {
    for (let k = pieces.length - 1; k >= 0; k--) {
      const p = pieces[k]!;
      if (p.onlyDir && !dir) continue;
      if (p.re.test(path)) return p;
    }
    return null;
  };
  return (rel: string) => {
    const from = scope === "" ? rel : rel.startsWith(`${scope}/`) ? rel.slice(scope.length + 1) : null;
    if (from === null || from === "") return false;
    const parts = from.split("/");
    for (let k = 1; k < parts.length; k++) {
      const m = last(parts.slice(0, k).join("/"), true);
      if (m?.ignore) return false;
    }
    const m = last(from, false);
    return m ? !m.ignore : !keeps;
  };
}

/** The variables Claude Code's Glob reads to drop `--no-ignore` or `--hidden`; this program models their default only. */
export const GLOB_NO_IGNORE_ENV = "CLAUDE_CODE_GLOB_NO_IGNORE";
export const GLOB_HIDDEN_ENV = "CLAUDE_CODE_GLOB_HIDDEN";

/**
 * Why neither replay can stand for a seat's Glob as the host ran it, or null.
 * The host's Glob rewrites some patterns before ripgrep sees them, and this program does not copy those rewrites: an
 * absolute pattern (split into a folder and the rest), and a pattern whose leading plain folders repeat the searched
 * folder's last ones (`app/models/*.rb` on `.../app`, which it may cut to `/models/*.rb`). A Glob run under either of
 * the variables that change its flags is not modelled either. `folder` is the searched folder's absolute path AS THE HOST
 * HOLDS IT - the seat's path expanded, no link followed (`hostGlobCutProblem`) - never its real path: the host compares
 * the pattern with the last names of the path as written.
 */
export function globToolProblem(pattern: string, folder: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const set = env[GLOB_NO_IGNORE_ENV] !== undefined ? GLOB_NO_IGNORE_ENV : env[GLOB_HIDDEN_ENV] !== undefined ? GLOB_HIDDEN_ENV : undefined;
  if (set !== undefined) return `the host's Glob ran with ${set} set, which changes the files it lists, and this program replays its default only.`;
  if (pattern.startsWith("/") || /^[A-Za-z]:[\\/]/.test(pattern)) return "the Glob's pattern is an absolute path, which the host splits into a folder and a pattern before it lists, and this program does not.";
  const parts = pattern.split("/");
  let plain = 0;
  while (plain < parts.length - 1 && parts[plain] !== "" && !/[*?[\]{}!]/.test(parts[plain]!)) plain++;
  const tail = folder.split(/[\\/]+/).filter(Boolean);
  for (let y = plain; y > 0; y--) {
    const lead = parts.slice(0, y);
    if (tail.length >= y && tail.slice(-y).every((name, k) => name === lead[k])) {
      return `the Glob's pattern begins with ${JSON.stringify(lead.join("/"))}, the searched folder's own last name(s), which the host may cut from the pattern before it lists, and this program does not.`;
    }
  }
  return null;
}

/**
 * `globToolProblem` for a seat's Glob as the host held it: the pattern cut
 * is tested on the path the seat wrote, expanded as the host expands it (`hostPathOf`) and with no link followed, as
 * the 2.1.312 Glob tests it (its `dqo` compares the pattern's leading plain names with that path's last names; `mqo`
 * keeps the pattern only where `<path>/<names>` are folders that are not links). A path that names a link, or holds
 * one anywhere in it, ends in the link's own name, not its target's: testing the real path missed the cut there. With
 * no path, or a relative one, the host reads from its working folder, whose spelling no row records: the cut is
 * tested on the tree's root as this program was given it and on its real path, and either refuses. Every later run
 * tests it again from the written path, with the engine and without (rests-on.ts `replayRecorded`, `fallbackReplay`).
 */
export function hostGlobCutProblem(pattern: string, root: string, written: string | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  const given = resolve(root);
  const cwds = [...new Set([given, realPathOf(given).real])];
  for (const cwd of cwds) {
    const folder = hostPathOf(cwd, written);
    if (folder === null) return "the Glob's path holds a NUL character, which the host refuses, so no replay can stand for it.";
    const problem = globToolProblem(pattern, folder, env);
    if (problem) return problem;
  }
  return null;
}

/* --------------------------------------------------------------------------------------------- *
 * The host's own engine.
 * --------------------------------------------------------------------------------------------- */

/** The host's search engine, as a row records it: the executable's real path and the version text it prints. */
export interface HostEngine {
  path: string;
  version: string;
}

const versions = new Map<string, HostEngine | { missing: string }>();

/**
 * How long the engine may run, per run and in all, the version question included. A run that would pass either bound
 * is not made, and its search is unreplayable: the place is read again, never carried.
 * Two clocks, because the engine now replays every search and runs in
 * two kinds of process. The CAPTURE (place-premises.ts `searchPremiseOf`) runs in the hook process that checks one
 * seat's hand-back, and that entry answers "still checking" at its deadline (hook.ts HOOK_PROCESS_DEADLINE_MS, 20 s):
 * its engine time is held to half of it, so a capture's searches never push the hand-back past the deadline; a search
 * past it is read again later. The CARRY (rests-on.ts `replayRecorded`) runs in the continuation's own command, once
 * over every earlier row: a longer bound, which still ends it within the two minutes a command is given.
 */
export const ENGINE_RUN_MS = 10_000;
export const ENGINE_CAPTURE_MS = 10_000;
export const ENGINE_CARRY_MS = 60_000;

/** One process's engine time against one bound. Mutable on purpose: the time is the process's own. */
export interface EngineClock {
  readonly name: string;
  readonly limitMs: number;
  spentMs: number;
}
export const CAPTURE_CLOCK: EngineClock = { name: "capture", limitMs: ENGINE_CAPTURE_MS, spentMs: 0 };
export const CARRY_CLOCK: EngineClock = { name: "carry", limitMs: ENGINE_CARRY_MS, spentMs: 0 };

const timeLeft = (clock: EngineClock): number => Math.min(ENGINE_RUN_MS, clock.limitMs - clock.spentMs);
const spentAll = (clock: EngineClock): string => `this process has spent the ${clock.limitMs / 1000} s the engine is given in a ${clock.name}`;

/**
 * No program can be given an argument holding a NUL: Node's `spawnSync` throws
 * on one instead of returning. The engine's arguments come from a seat's input, so a NUL there is a value (`failed`),
 * never a throw out of the capture.
 */
const NUL = String.fromCharCode(0);
const holdsNul = (values: readonly string[]): boolean => values.some((v) => v.includes(NUL));

/**
 * The ripgrep this process's Claude Code carries, or why there is none: Claude Code's executable (`HOST_ENGINE_ENV`)
 * answers as ripgrep when it is started under the name `rg` with `--no-config` first, as the host's own Grep starts it.
 * Read from the environment at each call; the version is asked once per executable. Like every program the CLI starts
 * (child-program.ts), it is never taken from the working folder, a declared project folder, CLAUDE_PROJECT_DIR or the
 * searched tree (`tree`, the caller's): an executable there is not run, not even to ask its version.
 */
export function hostEngineNow(env: NodeJS.ProcessEnv = process.env, tree?: string, clock: EngineClock = CAPTURE_CLOCK): HostEngine | { missing: string } {
  const named = env[HOST_ENGINE_ENV];
  if (!named) return { missing: `${HOST_ENGINE_ENV} is not set, so no Claude Code executable is named` };
  if (holdsNul([named])) return { missing: `${HOST_ENGINE_ENV} holds a NUL character, so it names no executable` };
  let path: string;
  try {
    path = realpathSync(named);
  } catch (e) {
    return { missing: `${HOST_ENGINE_ENV} names ${named}, which cannot be resolved (${(e as Error).message})` };
  }
  const held = programFolderHolding(path, foldersNoProgramComesFrom(...(tree !== undefined ? [tree] : [])));
  if (held !== null) return { missing: `${HOST_ENGINE_ENV} names ${path}, inside ${held}, and no program is taken from the working folder, a project folder or the searched tree` };
  const known = versions.get(path);
  if (known) return known;
  // The version question is a run of the engine too, held to the same bounds.
  const left = timeLeft(clock);
  if (left <= 0) return { missing: spentAll(clock) };
  const began = Date.now();
  let r: SpawnSyncReturns<string>;
  try {
    r = spawnSync(path, ["--no-config", "--version"], { argv0: "rg", encoding: "utf8", timeout: left, maxBuffer: 1024 * 1024 });
  } catch (e) {
    return { missing: `${path} could not be asked its version (${(e as Error).message})` };
  } finally {
    clock.spentMs += Date.now() - began;
  }
  const text = typeof r.stdout === "string" ? r.stdout.trim() : "";
  const out = r.status === 0 && text.startsWith("ripgrep ") ? { path, version: text } : { missing: `${path} does not answer as ripgrep (exit ${r.status ?? "none"}${r.error ? `, ${r.error.message}` : ""})` };
  versions.set(path, out);
  return out;
}

/** What a replay asks of the engine: the row's own fields. */
export interface EngineRequest {
  /** The host tool the seat called: a Grep searches lines, a Glob lists files. Absent on a request built before Glob was replayed (a Grep). */
  tool?: "grep" | "glob";
  pattern: string;
  /** The searched path, as `searchScopeOf` returns it for the tree; the empty string is the whole tree. */
  scope: TreeScope;
  caseless: boolean;
  multiline: boolean;
  glob?: string;
  type?: string;
}

/**
 * The arguments the host's Grep gives ripgrep, for every matched line with its number (`--json`, `-n`), whatever output
 * shape the seat chose: `--hidden`, the version-control pieces, the column cap, `-U --multiline-dotall` across lines,
 * `-i`, the pattern (behind `-e` where it starts with `-`), `--type`, the seat's glob pieces, the guard's piece, and the
 * path searched from ripgrep's working folder (`target`: `.` for a folder, which is then the working folder).
 */
export function hostEngineArgs(q: EngineRequest, target: string): string[] {
  const args = ["--no-config", "--hidden"];
  for (const p of HOST_GLOB_LEAD) args.push("--glob", p);
  args.push("--max-columns", "500");
  if (q.multiline) args.push("-U", "--multiline-dotall");
  if (q.caseless) args.push("-i");
  args.push("--json", "-n");
  if (q.pattern.startsWith("-")) args.push("-e", q.pattern);
  else args.push(q.pattern);
  if (q.type) args.push("--type", q.type);
  for (const p of hostGlobPiecesFor(q.glob, q.scope).slice(HOST_GLOB_LEAD.length)) args.push("--glob", p);
  args.push(target);
  return args;
}

/**
 * The arguments the host's Glob gives ripgrep (Claude Code's Glob, at the
 * default of `GLOB_NO_IGNORE_ENV` and `GLOB_HIDDEN_ENV`): every file, ignore files and hidden names included, that the one pattern keeps,
 * each name ended by a NUL. Its own `--sort=modified` only orders the names, which the replay sorts itself.
 */
export function hostGlobToolArgs(pattern: string, target: string): string[] {
  return ["--no-config", "--files", "--null", "--no-ignore", "--hidden", "--glob", pattern, target];
}

/**
 * The most output one engine run may give, in bytes: past it the run is `failed` and its search read again. A search of
 * a large tree for a common pattern prints hundreds of megabytes of JSON, more than one string can hold.
 */
export const ENGINE_OUTPUT_MAX = 64 * 1024 * 1024;

/** One line ripgrep matched: the file from the tree's root, the first line's number, and the matched lines' text. */
export interface EngineMatch {
  file: string;
  line: number;
  text: string;
}

/**
 * Run the engine over the tree as the host's Grep or Glob runs it: a search of a folder with that folder as the working
 * folder and `.` as the path (so a glob piece is anchored there), a search of one file from the tree's root. A Grep's
 * matches, each file from the tree's root, or a Glob's files (`listed`); or, where ripgrep refused the arguments (exit 2
 * before it searched anything: a glob, a type or a pattern it cannot read), what it said; or why the run cannot stand
 * for the search (an error while searching, a path or text that is not UTF-8, an argument no program can be given, no
 * answer within the clock's time).
 */
export function runHostEngine(
  engine: HostEngine,
  root: string,
  q: EngineRequest,
  clock: EngineClock = CAPTURE_CLOCK,
): { matches: EngineMatch[] } | { listed: string[] } | { refused: string } | { failed: string } {
  const glob = q.tool === "glob";
  let folder = q.scope === "";
  if (!folder) {
    try {
      folder = statSync(join(root, q.scope)).isDirectory();
    } catch {
      folder = false;
    }
  }
  if (glob && !folder) return { failed: "a Glob of a path that is not a folder is not replayed by the engine" };
  const cwd = folder ? join(root, q.scope) : root;
  const fromRoot = (p: string): string => {
    const own = p.replace(/^\.\//, "");
    return folder && q.scope !== "" ? `${q.scope}/${own}` : own;
  };
  const target = folder ? "." : `./${q.scope}`;
  const args = glob ? hostGlobToolArgs(q.pattern, target) : hostEngineArgs(q, target);
  if (holdsNul([...args, cwd])) return { failed: "an argument the search would give the engine holds a NUL character, which no program can be given" };
  const left = timeLeft(clock);
  if (left <= 0) return { failed: spentAll(clock) };
  const began = Date.now();
  let r: SpawnSyncReturns<string>;
  try {
    r = spawnSync(engine.path, args, { argv0: "rg", cwd, encoding: "utf8", maxBuffer: ENGINE_OUTPUT_MAX, timeout: left });
  } catch (e) {
    // Node throws on an output it cannot hold as one string, too.
    return { failed: `the engine's run could not be read (${(e as Error).message})` };
  } finally {
    clock.spentMs += Date.now() - began;
  }
  if (r.error) return { failed: `the engine did not answer within its time or its output bound (${r.error.message})` };
  const stdout = r.stdout ?? "";
  const stderr = (r.stderr ?? "").trim();
  if (r.status === 2 && stdout.trim() === "") return { refused: stderr };
  if (r.status !== 0 && r.status !== 1) return { failed: `the engine ended with exit ${r.status ?? "none"} while searching (${stderr.split("\n")[0]?.slice(0, 120) ?? ""})` };
  if (glob) {
    const names = stdout.split(NUL).filter((n) => n !== "");
    if (names.some((n) => n.includes("�"))) return { failed: "the engine listed a name that is not UTF-8" };
    return { listed: names.map(fromRoot).sort() };
  }
  const matches: EngineMatch[] = [];
  for (const line of stdout.split("\n")) {
    if (line === "") continue;
    let d: unknown;
    try {
      d = JSON.parse(line);
    } catch {
      return { failed: "the engine printed a line that is not JSON" };
    }
    if (typeof d !== "object" || d === null || (d as Obj).type !== "match") continue;
    const data = (d as Obj).data as Obj;
    const path = (data.path as Obj | undefined)?.text;
    const text = (data.lines as Obj | undefined)?.text;
    if (typeof path !== "string" || typeof text !== "string" || typeof data.line_number !== "number") return { failed: "the engine reported a match whose path or text is not UTF-8" };
    matches.push({ file: fromRoot(path), line: data.line_number, text: text.replace(/\r?\n$/, "") });
  }
  return { matches };
}

/** Whether the host's error is ripgrep refusing its arguments (not the plugin's guard, not a missing path). */
export function hostErrorIsRefusal(error: string): boolean {
  if (/PreToolUse|hook error/i.test(error)) return false;
  return /ripgrep|regex parse error|error parsing glob|unrecognized file type/i.test(error);
}

/** Whether the host's error is its own check that the searched path exists (made before ripgrep runs). */
export function hostErrorIsMissingPath(error: string): boolean {
  return /Path does not exist/.test(error) && !/PreToolUse|hook error/i.test(error);
}
