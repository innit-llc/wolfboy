import { readdirSync } from "node:fs";
import { isAbsolute, join, posix } from "node:path";
import { sniffRegular } from "./project-read.js";

/**
 * WHETHER A FOLDER NAMED LIKE VENDORED CODE HOLDS SOMEBODY ELSE'S CODE.
 *
 * ## The defect this closes
 *
 * The `vendored` read-scope class (a standing product decision: vendored code is not read unless the
 * person running the scan says so) was decided by a folder NAME alone. A project's own folder that
 * shares the name was never read, and the report said only "vendored code": a project's own provider
 * folder named `vendors`, its own OAuth providers in a folder named `thirdparty` and its own brand
 * logos in a folder named `third_party` were all held back on a word.
 *
 * ## The one mechanism change
 *
 * A name match now only makes a folder a CANDIDATE. It is held back where both hold:
 *
 *   1. **Something in the tree shows third-party origin** (`evidenceOf` below): a git submodule at, in
 *      or around it; a nested git checkout; a `linguist-vendored` mark in the project's own root
 *      `.gitattributes`; a vendoring tool's manifest; another package's manifest; a licence file that
 *      is not the project's own; a licence notice at the head of a file. Looked for over the folder's tree as the
 *      walker reads it, by the walker's own rule for which folders it enters (`folderKind`, walk.ts), so that every
 *      file the scan reads below the folder is one this test examined: the sentence about a folder is decided over
 *      the same files it describes (`treeOf`).
 *   2. **Its files do not import the project's own modules** (`ownImportOf` below): an import, outside
 *      comments, that leaves the folder by a relative path, or names one of the project's workspace
 *      packages, path aliases, Go module, Composer namespaces or Python packages, AND that lands, through
 *      `resolveOwn` and nothing else, on a module FILE of the tree, or a folder holding the language's index or
 *      package file whose `main` (or, with none, its index module) passes the same tests: through any link, inside the tree, outside the folder, outside every machine-written folder,
 *      and outside every folder named like vendored code that shows another project's code. A name that does not
 *      land there is not the project's own code, whatever it looks like.
 *
 * Text taken from the tree (a `.gitattributes` glob, a workspace glob, a manifest) that cannot be
 * parsed or compiled proves nothing either way: it is skipped, and the scan goes on. Should the test
 * of a folder fail for any other reason, the folder is held back, as it was before this change.
 *
 * **THE INVARIANT OF ITS COST: the test's time is bounded by a constant times its work count, and its work count by
 * the limits.** Every operation the test performs is charged to the count in proportion to what it does (the charges are
 * listed above `FOLDER_WORK`), nothing the walk can reuse is done twice (the root's facts, every folder's listing, each
 * parent folder's `package.json`, `tsconfig.json` and `go.mod`, each file's licence and notice facts are read and parsed
 * at most once per walk; a file's import head is read once, by the one candidate whose tree holds it), and no regular
 * expression is built from the tree's text. Nor does the operating system resolve a path the count does not see: by THE
 * FALL-BACK RULE below, every path the test hands it is made of plain folders and ends at a plain file or folder, so
 * there is no symbolic link on it for the system to follow.
 * So ANY tree either finishes within the limits or reaches one, and a folder
 * whose test reaches its limit is held back, as it was before this change, and named in the coverage limits as held. `test:read-scope` part (M)
 * tests the invariant itself, on generated hostile trees, by what each unit of work is charged.
 *
 * **THE FALL-BACK RULE: the origin test decides over plain in-tree files with round-tripping names only; anything else
 * holds the folder as the scan did before H6**. It follows no symbolic link and resolves nothing itself: every folder is listed with its names as the bytes
 * on disk (`listing`), and a name that does not decode to text and encode back to the same bytes is not used. Wherever
 * the test would need a symbolic link (in the candidate's tree or on any path it looks up), such a name, a path that
 * leaves the tree (an import, a `main` or a tsconfig alias that climbs above the root or is absolute), an entry that is
 * neither a file nor a folder, a folder it cannot list or a file it cannot read, or anything else it
 * cannot decide over plain files inside the tree, it stops (`Undecidable`) and the folder is held back by its name, exactly as
 * before H6, when every folder named like vendored code was held: counted, named and offered `--read` as any held
 * folder is. So the test is never worse than the scan before H6 by construction: it reads a folder only on a decision
 * made over plain files of the tree. (Five rounds of this module resolved links, each adding a road; this
 * rule removes the roads.)
 *
 * Otherwise it is read, and the coverage limits name it (read-scope.ts). **This only widens what is
 * read**: a folder is held back now only where it was held back before AND the tree shows it is
 * somebody else's. That decision stands, unchanged, for real vendored code. Where the import
 * test runs out of its budget before it has looked at every file, the folder stays held back, which
 * is what it was before this change, rather than being read on a guess.
 *
 * Every read of the scanned tree goes through project-read.ts (`test:project-writes` part 1), and
 * nothing here runs, installs or evaluates anything from the tree: every file is matched as text.
 */

/** What the test found for one candidate folder. */
export interface CandidateOrigin {
  /** True where the folder stays held back: third-party origin shown and no import of the project's own. */
  heldBack: boolean;
  /** The first sign of third-party origin, in words with its path; null where nothing showed it. */
  evidence: string | null;
  /** The first import of the project's own code, with its path; null where none was found (or not looked for). */
  ownImport: string | null;
  /** How many folders inside it, named like the class on their own, were left out of its test (`treeOf`). */
  nested: number;
}

/** How many bytes of a file's head the licence-notice test reads. */
const NOTICE_HEAD = 2048;
/** How many bytes of a file's head the import test reads. Imports sit at the top of a file. */
const IMPORT_HEAD = 64 * 1024;
/** The import test's budget per candidate. Exhausted without a hit, the folder stays held back (as before H6). */
const IMPORT_FILES_BUDGET = 5000;
const IMPORT_BYTES_BUDGET = 64 * 1024 * 1024;
/** The most bytes read of any one small file this module parses (a manifest, a licence, an attributes file). */
const SMALL_FILE = 256 * 1024;
/**
 * The longest line of a root file (`.gitattributes`, `.gitmodules`, `pnpm-workspace.yaml`, `go.mod`) and the longest
 * value of a manifest (a glob, a path, a name, an import) this test looks at. A longer one is skipped: it proves nothing
 * either way, and no path the system can open is longer.
 */
const LONGEST_VALUE = 4096;
/**
 * THE WORK LIMIT AND WHAT IS CHARGED TO IT. The count charges every operation in proportion to the work it does, so
 * that the test's time is bounded by a constant times the count:
 *
 *   - a system call (a file opened and read, a folder listed, a link's body read): OPEN steps plus the length of the
 *     path it is given (the system walks that path one folder at a time), plus one for every BUFFER_UNIT bytes of the
 *     buffer it fills, plus one for every byte it returns and ENTRY plus the name's length for every entry it lists (and
 *     the sort of the listing). The path is always made of plain folders the test listed itself (THE FALL-BACK RULE),
 *     so it holds no symbolic link for the system to follow;
 *   - every pass over text (a split into lines, a pattern run, a parse, the comment blanker): one step per character it
 *     passes over, and the blanker's look-back at a `/` REGEX_LOOKBACK more;
 *   - a glob: compiling it, one step per character times the logarithm of its length (a set's ranges are sorted and
 *     merged once, per glob, when the root's facts are read); matching, one step per comparison, a set's comparison
 *     costing its binary search over its merged ranges (`GlobChar.cost`);
 *   - a path: one step per character each time it is split, joined, normalised or tested by the read scope
 *     (NAME_TEST more for the read scope's patterns).
 *
 * A folder whose test counts past FOLDER_WORK is held back, as it was before this change, and a walk whose tests count
 * past WALK_WORK, all folders together, holds back every folder it has not yet decided the same way. The limits are
 * set from the time a step takes in the worst shape measured (`test:read-scope` part (M) holds it under a bound) and
 * from the largest need of ten real trees.
 */
const FOLDER_WORK = 50_000_000;
const WALK_WORK = 200_000_000;
/** The two limits, for `test:read-scope` part (M), which checks the work count against them. */
export const WORK_LIMITS = { folder: FOLDER_WORK, walk: WALK_WORK } as const;
const OPEN = 512;
const BUFFER_UNIT = 64;
const ENTRY = 8;
const NAME_TEST = 64;
const REGEX_LOOKBACK = 64;
/** What each unit of work is charged, for `test:read-scope` part (M), which checks the count against the work done. */
export const WORK_CHARGES = { open: OPEN, bufferUnit: BUFFER_UNIT, entry: ENTRY } as const;
/**
 * Thrown where the test would need what THE FALL-BACK RULE says it does not use (a symbolic link, a name that does not
 * round-trip, a path that leaves the tree); caught where the folder is decided, which is then held back by its name.
 * `why` says what was met, for the record of the folders held (`heldOnOrigin`).
 */
class Undecidable extends Error {
  constructor(readonly why: string) {
    super(why);
  }
}
/** Thrown where a test reaches its work limit (`walk`: the limit of all folders of the walk together); caught where the folder is decided. */
class OutOfWork extends Error {
  constructor(readonly walk: boolean) {
    super(walk ? "the work limit of the walk" : "the work limit of the folder");
  }
}

const posixPath = (p: string): string => p.replace(/\\/g, "/");
const inside = (path: string, dir: string): boolean => dir === "" || path === dir || path.startsWith(`${dir}/`);
const short = (s: string): boolean => s.length <= LONGEST_VALUE;
/** A path below a folder relative to the root, where `""` is the root itself. */
const under = (dir: string, name: string): string => (dir === "" ? name : `${dir}/${name}`);
/** `s` without its trailing run of `ch`, in one pass (`/\/+$/` would rescan a long run from every start in it). */
function trimEndOf(s: string, ch: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === ch) end--;
  return s.slice(0, end);
}
/** The lines of a root file, a line longer than LONGEST_VALUE left out. */
const shortLines = (text: string | null): string[] => (text ?? "").split(/\r?\n/).filter(short);

/** JSON text parsed; null where it does not parse. The caller charges the pass (`jsonAt`). */
function parseJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/** JSON with comments and trailing commas (tsconfig.json), parsed; null where it still does not parse. Three passes. */
function parseJsonc(t: string): unknown {
  const parts: string[] = [];
  let from = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < t.length && t[j] !== '"') j += t[j] === "\\" ? 2 : 1;
      i = j;
    } else if (ch === "/" && t[i + 1] === "/") {
      parts.push(t.slice(from, i));
      while (i < t.length && t[i] !== "\n") i++;
      parts.push("\n");
      from = i + 1;
    } else if (ch === "/" && t[i + 1] === "*") {
      parts.push(t.slice(from, i));
      const end = t.indexOf("*/", i + 2);
      i = end === -1 ? t.length : end + 1;
      from = i + 1;
    }
  }
  parts.push(t.slice(from));
  try {
    return JSON.parse(parts.join("").replace(/,(\s*[}\]])/g, "$1"));
  } catch {
    return null;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * One character of a glob's name: a literal, `?`, `*` (any run, a run of stars being one), or a `[...]` set, with what
 * one comparison against it costs (`cost`, charged by `nameMatches`): one, and for a set the steps of its binary search.
 */
type GlobChar =
  | { k: "lit"; c: number; cost: 1 }
  | { k: "one"; cost: 1 }
  | { k: "star"; cost: 1 }
  | { k: "set"; negated: boolean; ranges: number[]; cost: number };
/** One segment of a glob: `**` (any number of whole segments), or a name. */
type GlobSegment = { k: "globstar" } | { k: "name"; chars: GlobChar[] };

/**
 * A `[...]` set's inside, as code-unit ranges sorted and merged, so that a comparison is a binary search over them and
 * not a loop over everything the set lists (4,000 `a`s are one range); null for an out-of-order range such as `z-a`.
 */
function globSet(inner: string): GlobChar | null {
  const negated = inner.startsWith("!") || inner.startsWith("^");
  const body = negated ? inner.slice(1) : inner;
  const pairs: [number, number][] = [];
  for (let j = 0; j < body.length; ) {
    const lo = body.charCodeAt(j);
    if (body[j + 1] === "-" && j + 2 < body.length) {
      const hi = body.charCodeAt(j + 2);
      if (hi < lo) return null;
      pairs.push([lo, hi]);
      j += 3;
    } else {
      pairs.push([lo, lo]);
      j += 1;
    }
  }
  pairs.sort((x, y) => x[0] - y[0]);
  const ranges: number[] = [];
  for (const [lo, hi] of pairs) {
    const last = ranges.length - 1;
    if (last > 0 && lo <= (ranges[last] as number) + 1) ranges[last] = Math.max(ranges[last] as number, hi);
    else ranges.push(lo, hi);
  }
  return { k: "set", negated, ranges, cost: 1 + Math.ceil(Math.log2(ranges.length / 2 + 1)) };
}

/** What compiling a glob of this length costs: one step per character, times the logarithm for a set's sort. */
const compileCost = (glob: string): number => glob.length * (1 + Math.ceil(Math.log2(glob.length + 1)));

/**
 * A glob of the gitignore family over a whole posix path relative to the root, as segments for `globMatches`. No
 * regular expression is built from it: the glob is the scanned tree's text. `anyLevel` makes a pattern with no slash
 * in it match a name at any depth, as `.gitattributes` does. A `**` segment takes any number of whole segments (one or
 * more at the end of the glob, as `a/**` matches what is inside `a` and not `a`), and runs of `**` segments or of `*`
 * are one. A set never takes a `/`.
 *
 * Null where the glob is longer than LONGEST_VALUE, matches no path, or holds an out-of-order range such as `[z-a]`
 * (git matches nothing with such a glob): it is skipped, and a scan never stops on it.
 */
function compileGlob(glob: string, anyLevel: boolean): GlobSegment[] | null {
  if (!short(glob)) return null;
  let g = trimEndOf(glob, "/");
  const anchored = !anyLevel || g.includes("/");
  if (g.startsWith("/")) g = g.slice(1);
  if (g === "") return null;
  const segments: GlobSegment[] = anchored ? [] : [{ k: "globstar" }];
  for (const part of g.split("/")) {
    if (part === "**") {
      if (segments[segments.length - 1]?.k !== "globstar") segments.push({ k: "globstar" });
      continue;
    }
    const chars: GlobChar[] = [];
    for (let i = 0; i < part.length; i++) {
      const ch = part[i];
      if (ch === "*") {
        if (chars[chars.length - 1]?.k !== "star") chars.push({ k: "star", cost: 1 });
      } else if (ch === "?") chars.push({ k: "one", cost: 1 });
      else if (ch === "[" && part.indexOf("]", i + 1) !== -1) {
        const end = part.indexOf("]", i + 1);
        const set = globSet(part.slice(i + 1, end));
        if (set === null) return null;
        chars.push(set);
        i = end;
      } else chars.push({ k: "lit", c: part.charCodeAt(i), cost: 1 });
    }
    segments.push({ k: "name", chars });
  }
  return segments;
}

const oneChar = (g: GlobChar, c: number): boolean => {
  if (g.k === "lit") return g.c === c;
  if (g.k === "one") return true;
  if (g.k === "star") return false;
  let lo = 0;
  let hi = (g.ranges.length >> 1) - 1;
  let hit = false;
  while (lo <= hi && !hit) {
    const mid = (lo + hi) >> 1;
    if (c < (g.ranges[2 * mid] as number)) hi = mid - 1;
    else if (c > (g.ranges[2 * mid + 1] as number)) lo = mid + 1;
    else hit = true;
  }
  return hit !== g.negated;
};

/** Steps of a match, handed to the test's work count in chunks so that a long match is stopped while it runs. */
class Steps {
  private n = 0;
  constructor(private readonly spend: (n: number) => void) {}
  tick(k = 1): void {
    this.n += k;
    if (this.n >= 1024) this.done();
  }
  done(): void {
    const k = this.n;
    this.n = 0;
    this.spend(k);
  }
}

/**
 * Whether a name matches a glob's name. One pass with a return to the last `*` only, as for any pattern whose only
 * wildcard takes any run: at most the name's length times the glob's steps, never a search over the ways to split.
 */
function nameMatches(chars: GlobChar[], name: string, steps: Steps): boolean {
  let g = 0;
  let c = 0;
  let starG = -1;
  let starC = 0;
  while (c < name.length) {
    const k = chars[g];
    steps.tick(k?.cost ?? 1);
    if (k?.k === "star") {
      starG = g++;
      starC = c;
    } else if (k !== undefined && oneChar(k, name.charCodeAt(c))) {
      g++;
      c++;
    } else if (starG !== -1) {
      g = starG + 1;
      c = ++starC;
    } else return false;
  }
  while (chars[g]?.k === "star") g++;
  return g === chars.length;
}

/** Whether a path's segments match a glob's: the same one pass over segments, with `**` as the wildcard. */
function globMatches(segments: GlobSegment[], parts: string[], steps: Steps): boolean {
  const last = segments.length - 1;
  let g = 0;
  let s = 0;
  let starG = -1;
  let starS = 0;
  while (s < parts.length) {
    steps.tick();
    const k = segments[g];
    if (k?.k === "globstar") {
      if (g === last) return true; // `**` at the end takes every segment left, and at least one is left
      starG = g++;
      starS = s;
    } else if (k !== undefined && nameMatches(k.chars, parts[s] as string, steps)) {
      g++;
      s++;
    } else if (starG !== -1) {
      g = starG + 1;
      s = ++starS;
    } else return false;
  }
  return g === segments.length;
}

/** A `.gitattributes` rule about `linguist-vendored`: the paths it matches, and whether it sets or unsets the mark. */
interface VendoredMark {
  glob: GlobSegment[];
  vendored: boolean;
  line: string;
}

/** What the project's root says about itself, read once per walk and only when a first candidate appears. */
interface RootFacts {
  marks: VendoredMark[];
  submodules: string[];
  licences: Set<string>;
  workspaces: { glob: GlobSegment[]; negated: boolean }[];
  pythonPackages: { name: string; dir: string }[];
  composer: { prefix: string; dirs: string[] }[];
}

const LICENCE_STEM = /^(?:licen[cs]es?|copying|copyright|notice|unlicense|patents)/i;
const DOC_EXTENSION = /^\.(?:md|markdown|txt|text|rst|adoc|asciidoc|org|html?)$/i;
const LICENCE_TOKEN =
  /^[-_.](?:mit|apache[\w.-]*|bsd[\w.-]*|[al]?gpl[\w.-]*|mpl[\w.-]*|epl[\w.-]*|cddl[\w.-]*|isc|zlib|boost|lib|lesser|third[-_]?party|thirdparty|ofl|psf|python|bsl[\w.-]*|cc[\w.-]*|unlicense|wtfpl|artistic[\w.-]*|v?\d[\w.]*|[a-z]{2,8}-\d[\w.]*)(?:\.(?:md|markdown|txt|text|rst|adoc|asciidoc|org|html?))?$/i;

/**
 * A licence's name in front of the word: `MIT-LICENSE`, `APACHE-2.0-LICENSE.txt`, `BSD-3-Clause-LICENSE`,
 * `THIRD-PARTY-LICENSES`. Only licence names: a free word in front (`faq-license.md`) is not a licence file.
 */
const LICENCE_PREFIX =
  /^(?:mit|apache|bsd|[al]?gpl|mpl|epl|cddl|isc|zlib|boost|ofl|psf|bsl|wtfpl|artistic|third[-_]?party|thirdparty)(?:[-_.]?v?\d[\d.]*)?(?:[-_.]clause)?[-_.]/i;

/** Whether a file name is a licence file: `LICENSE`, `COPYING.md`, `LICENSE-MIT`, `MIT-LICENSE.txt` — never a code file like `license.ts`. */
export function isLicenceFileName(name: string): boolean {
  const stemFirst = (n: string): boolean => {
    const m = LICENCE_STEM.exec(n);
    if (m === null) return false;
    const rest = n.slice(m[0].length);
    return rest === "" || DOC_EXTENSION.test(rest) || LICENCE_TOKEN.test(rest);
  };
  if (stemFirst(name)) return true;
  const p = LICENCE_PREFIX.exec(name);
  return p !== null && stemFirst(name.slice(p[0].length));
}

/** Files that only a vendoring tool, a package installer or another project's tree writes. */
const VENDORING_MANIFESTS = new Set([
  "vendor.json", "vendor.conf", "Godeps.json", "Manifest.lock", ".gitrepo", "README.chromium", "pyvenv.cfg",
]);
/** Another package's manifest. `package.json` is one only where the project's own workspaces do not claim its folder. */
const PACKAGE_MANIFESTS = new Set([
  "package.json", "bower.json", ".bower.json", "component.json", "composer.json", "go.mod", "Cargo.toml",
  "pyproject.toml", "setup.py", "setup.cfg", "Package.swift", "pubspec.yaml", "mix.exs", "pom.xml", "PKG-INFO", "METADATA",
]);
const PACKAGE_MANIFEST_SUFFIX = /\.(?:gemspec|podspec|nuspec|cabal)$/;
const PACKAGE_DIRECTORY_SUFFIX = /\.(?:dist-info|egg-info)$/;

const normaliseLicence = (t: string): string => t.replace(/\s+/g, " ").trim();

/** One entry of a candidate's tree, posix-relative to the scan root. */
interface Entry {
  rel: string;
  name: string;
  dir: boolean;
}

/** One entry of a folder as listed: its name as text, and what its own entry says it is (nothing is followed). */
interface Listed {
  name: string;
  dir: boolean;
  file: boolean;
  link: boolean;
  /**
   * The name is not the bytes on disk: they do not decode to text and encode back to the same bytes (not valid UTF-8),
   * or two entries decode to the same text. Opening the text would reach another entry, or none (THE FALL-BACK RULE).
   */
  odd: boolean;
}

/**
 * A folder's entries, names sorted. Read with the names as BYTES, so that a name which does not round-trip is known as
 * such (`odd`) and never handed back to the system as text. A
 * symbolic link is flagged (`link`) and is neither a file nor a folder here: it is never followed. A folder that is gone
 * has no entries; one that is there and cannot be listed stops the test (THE FALL-BACK RULE: the test would otherwise
 * decide over a tree it has not read).
 */
function listing(abs: string, shown: string): Listed[] {
  let raw;
  try {
    raw = readdirSync(abs, { withFileTypes: true, encoding: "buffer" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException | null)?.code === "ENOENT") return [];
    throw new Undecidable(`a folder it could not list (\`${shown}\`)`);
  }
  const out: Listed[] = raw.map((e) => {
    const name = e.name.toString("utf8");
    return { name, dir: e.isDirectory(), file: e.isFile(), link: e.isSymbolicLink(), odd: !Buffer.from(name, "utf8").equals(e.name) };
  });
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1] as Listed;
    const b = out[i] as Listed;
    if (a.name === b.name) a.odd = b.odd = true;
  }
  return out;
}

/** A posix path normalised, relative to the root: `""` for the root itself, no `./`, no trailing slash. */
function norm(p: string): string {
  const x = posix.normalize(p).replace(/\/+$/, "");
  return x === "." || x === "" ? "" : x.replace(/^\.\//, "");
}

/** The extensions a JavaScript or TypeScript import may leave out. */
const JS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".d.ts", ".js", ".jsx", ".mjs", ".cjs", ".json", ".vue", ".svelte"];
/** How many folders the search for the project's workspace packages looks at, at most, once per walk. */
const WORKSPACE_DIRS_BUDGET = 50000;

/** How one language writes comments and strings, for `withoutComments`. */
interface Syntax {
  /** Line comments. */
  line: readonly string[];
  /** Block comments, opener and closer. */
  block: readonly (readonly [string, string])[];
  /** Quote characters whose strings are kept as they are: an import names its target in one. */
  quotes: string;
  /** Python: a triple-quoted string (a docstring) is blanked like a comment. */
  tripleBlank?: boolean;
  /** JavaScript: a `/` where an expression may start opens a regular-expression literal, kept as it is. */
  regex?: boolean;
  /** Ruby: `=begin` to `=end` at the start of a line is a comment. */
  rubyBlock?: boolean;
  /** Go: a backtick string is raw (a backslash in it escapes nothing). */
  rawBacktick?: boolean;
}

type ImportKind = "js" | "py" | "go" | "rb" | "php" | "c";

const SYNTAX: Readonly<Record<ImportKind, Syntax>> = {
  js: { line: ["//"], block: [["/*", "*/"]], quotes: "'\"`", regex: true },
  py: { line: ["#"], block: [], quotes: "'\"", tripleBlank: true },
  go: { line: ["//"], block: [["/*", "*/"]], quotes: "\"`'", rawBacktick: true },
  rb: { line: ["#"], block: [], quotes: "'\"", rubyBlock: true },
  php: { line: ["//", "#"], block: [["/*", "*/"]], quotes: "'\"" },
  c: { line: ["//"], block: [["/*", "*/"]], quotes: "'\"" },
};

/** Whether a `/` after this code starts a regular-expression literal rather than a division. */
function regexMayStart(code: string): boolean {
  const t = code.trimEnd();
  if (t === "") return true;
  if ("(,=:[!&|?{};+-*%<>~^".includes(t[t.length - 1] as string)) return true;
  return /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/.test(t);
}

/**
 * `text` with every comment (and every Python docstring) replaced by spaces, line breaks kept so that line-anchored
 * patterns still see the lines; strings and code kept as they are. A commented-out import is not an import. Matched
 * as text only; an unterminated comment or string runs to the end of the text (or of its line, for a string).
 *
 * Linear in the text: each stretch is read once, and a regular-expression literal that does not close on its line is
 * not read again from every later `/` on that line (`failedTo`). Every character it passes over is charged to `tick`,
 * and each look-back at a `/` REGEX_LOOKBACK more.
 */
function withoutComments(text: string, syn: Syntax, tick: (k: number) => void): string {
  const out: string[] = [];
  /** The last stretch of code kept, for `regexMayStart`. */
  let recent = "";
  /**
   * Where the last regular-expression literal that did not close stopped (its line's end). A literal opened at a `/`
   * before that point reads the same characters as that one did, in step with it, and differs from it only in being
   * outside a `[...]` class where that one was inside: so once it meets a `[` or a `]` the two read the rest alike,
   * and it cannot close either. It stops there, with the answer the full read would give.
   */
  let failedTo = -1;
  const keep = (s: string): void => {
    out.push(s);
    recent = (recent + s).slice(-32);
  };
  const blank = (s: string): void => {
    out.push(s.replace(/[^\n]/g, " "));
  };
  const n = text.length;
  let from = 0;
  let i = 0;
  const flush = (): void => {
    if (i > from) keep(text.slice(from, i));
  };
  while (i < n) {
    const ch = text[i] as string;
    let stop = -1;
    let blanked = true;
    tick(1);
    if (syn.rubyBlock && (i === 0 || text[i - 1] === "\n") && text.startsWith("=begin", i)) {
      const end = text.indexOf("\n=end", i);
      const eol = end === -1 ? -1 : text.indexOf("\n", end + 5);
      stop = end === -1 || eol === -1 ? n : eol;
    } else if (syn.line.some((o) => text.startsWith(o, i))) {
      const eol = text.indexOf("\n", i);
      stop = eol === -1 ? n : eol;
    } else {
      const block = syn.block.find(([o]) => text.startsWith(o, i));
      if (block !== undefined) {
        const end = text.indexOf(block[1], i + block[0].length);
        stop = end === -1 ? n : end + block[1].length;
      } else if (syn.quotes.includes(ch)) {
        if (syn.tripleBlank && text.startsWith(ch.repeat(3), i)) {
          const end = text.indexOf(ch.repeat(3), i + 3);
          stop = end === -1 ? n : end + 3;
        } else {
          const raw = syn.rawBacktick === true && ch === "`";
          let j = i + 1;
          while (j < n && text[j] !== ch) {
            if (text[j] === "\\" && !raw) j++;
            else if (text[j] === "\n" && ch !== "`") break;
            j++;
          }
          stop = Math.min(j + 1, n);
          blanked = false;
        }
      } else if (syn.regex === true && ch === "/" && (tick(REGEX_LOOKBACK), regexMayStart((recent + text.slice(Math.max(from, i - 32), i)).slice(-32)))) {
        const known = i < failedTo;
        let j = i + 1;
        let cls = false;
        let read = -1;
        while (j < n && text[j] !== "\n") {
          const c = text[j];
          if (c === "\\") j++;
          else if (c === "[" || c === "]") {
            if (known) {
              // Charged for what it read, not for the stretch it now knows the answer for.
              read = j - i;
              j = failedTo;
              break;
            }
            cls = c === "[";
          } else if (c === "/" && !cls) break;
          j++;
        }
        tick(read === -1 ? j - i : read);
        if (j < n && text[j] === "/") {
          stop = j + 1;
          blanked = false;
        } else failedTo = j;
      }
    }
    if (stop === -1) {
      i++;
      continue;
    }
    // The stretch read (a comment, a string, a literal) is blanked or kept: twice its length, its search included.
    tick(2 * (stop - i));
    flush();
    if (blanked) blank(text.slice(i, stop));
    else keep(text.slice(i, stop));
    i = stop;
    from = stop;
  }
  flush();
  return out.join("");
}

/**
 * The import paths of a Go file, read from its import declarations only (after the package clause, before anything
 * else), with comments already blanked. A string elsewhere in the file that happens to start with the module path is
 * not an import.
 */
function goImportSpecs(code: string): string[] {
  const head = /^﻿?\s*package\s+[A-Za-z_]\w*\s*;?/.exec(code);
  if (head === null) return [];
  const specs: string[] = [];
  let rest = code.slice(head[0].length);
  const decl = /^\s*import\s*(?:\(([^)]*)\)|(?:[A-Za-z_.]\w*\s+)?(?:"([^"\n]*)"|`([^`]*)`))\s*;?/;
  for (let m = decl.exec(rest); m !== null; m = decl.exec(rest)) {
    if (m[1] !== undefined) {
      // Only blanks other than a line break after the separator: `\s*` there would read a run of blank lines again from
      // every line break in it.
      for (const g of m[1].matchAll(/(?:^|[\n;])[^\S\n]*(?:[A-Za-z_.]\w*\s+)?(?:"([^"\n]*)"|`([^`]*)`)/g)) specs.push(g[1] ?? g[2] ?? "");
    } else specs.push(m[2] ?? m[3] ?? "");
    rest = rest.slice(m[0].length);
  }
  return specs;
}

/**
 * What the walker does with a folder by its name alone (walk.ts `folderKind`, the one source for the walker and for
 * this test): `.git`, a machine-written folder, a hidden folder it never enters, a folder of non-production code it
 * enters only under `--include-non-production`, or (null) an ordinary folder it enters.
 */
export type WalkerFolderKind = "git" | "generated" | "hidden" | "non-production" | null;

/** The test of one candidate folder, with the work its walk has counted so far (for `test:read-scope` part (M)). */
export interface OriginTest {
  (relDir: string, nominated?: (relSub: string) => boolean): CandidateOrigin;
  /** The steps this walk's tests counted, and the milliseconds they took. */
  work(): { steps: number; ms: number };
}

/** One import of a file, and the shape of module it must land on (`resolveOwn`). */
interface Import {
  /** The import as written, for the coverage note. */
  what: string;
  /** The path it names, relative to the root and normalised. */
  target: string;
  shape: "js" | "js-folder" | "py-package" | "py-module" | "go-package" | "file";
  /** A path below a package: the package's own folder, which must be a JavaScript folder of the project's own as well. */
  pkg?: string;
}

/**
 * A result kept for the walk (`kept`), with what finding it cost a folder's count; where it could not be found, `why`
 * says what THE FALL-BACK RULE met (absent: the work limit), and every folder that asks for it is held back the same way.
 */
type Kept<V> = { ok: true; value: V; cost: number } | { ok: false; cost: number; why?: string };

/** A JavaScript path alias of a tsconfig.json: its prefix, whether it is exact, and its targets relative to the root. */
interface Alias {
  prefix: string;
  exact: boolean;
  targets: string[];
}
/** What one folder's package.json says: its name, its local dependencies' folders, its `main`. */
interface PackageFacts {
  name: string | null;
  deps: Map<string, string>;
  main: string | null;
}
/** A folder on the way to a candidate, with its own manifests' facts, each read and parsed once per walk. */
interface Folder {
  rel: string;
  next: Map<string, Folder>;
  json?: Kept<unknown>;
  pkg?: Kept<PackageFacts>;
  ts?: Kept<Alias[] | null>;
  go?: Kept<string | null>;
}

/**
 * The test, bound to one scan root. The root's own facts are read on the FIRST candidate and not before, so a
 * tree with no folder named like vendored code is walked exactly as it was, with no extra file opened.
 *
 * `folderKind` is the walker's own rule for which folders it enters (walk.ts): this test enters the same ones, and the
 * non-production ones under either setting (`enters`), and refuses an import into a machine-written folder.
 *
 * `notOwnCode` says whether the read scope holds a folder back by its NAME alone (a test surface, build output),
 * whatever this run reads; a Python package there is not counted as the project's own (`ownImportOf`).
 *
 * `namedLike` says whether the class's name nominates a folder by the folder's own name, whatever its parents are
 * called. An import into such a folder that shows another project's code is not an import of the project's own code
 * (`inAnotherProject`), and the answer is the same whichever folder the walk reaches first.
 */
export function originTester(
  root: string,
  folderKind: (name: string) => WalkerFolderKind,
  notOwnCode: (relDir: string) => boolean = () => false,
  namedLike: (relDir: string) => boolean = () => false,
): OriginTest {
  const abs = (rel: string): string => (rel === "" ? root : join(root, ...rel.split("/")));
  /** The folders this test looks inside: the ones the walker enters, and the non-production ones under either setting. */
  const enters = (name: string): boolean => {
    const k = folderKind(name);
    return k === null || k === "non-production";
  };
  /** A folder the walker never reads because a tool writes it (`node_modules`, `dist`, ...), or git's own. */
  const machineWritten = (name: string): boolean => {
    const k = folderKind(name);
    return k === "generated" || k === "git";
  };

  // ---- THE WORK COUNT (FOLDER_WORK, WALK_WORK) ---------------------------------------------------------------------
  //
  // `spend` charges work done to both counts. A result kept for the walk is found once, under a count of its own
  // (`ownWork`), so that it does not depend on the asking folder's count; `kept` then charges every folder that asks for
  // a fact of its own tree (a listing, a file's licence or notice) what finding it cost, whether it was found then or
  // before, so that a folder's count does not depend on which folder asked first; and a fact of the project (its root,
  // a parent folder's manifests, its workspace packages) is charged to the walk only.
  let folderLeft = FOLDER_WORK;
  let walkLeft = WALK_WORK;
  let ms = 0;
  const spend = (k: number): void => {
    folderLeft -= k;
    walkLeft -= k;
    if (folderLeft < 0 || walkLeft < 0) throw new OutOfWork(walkLeft < 0);
  };
  const chargeFolder = (k: number): void => {
    folderLeft -= k;
    if (folderLeft < 0) throw new OutOfWork(false);
  };
  const ownWork = <T>(run: () => T): { value: T; cost: number } => {
    const saved = folderLeft;
    folderLeft = FOLDER_WORK;
    try {
      const value = run();
      return { value, cost: FOLDER_WORK - folderLeft };
    } finally {
      folderLeft = saved;
    }
  };
  const steps = new Steps(spend);
  const tick = (k: number): void => steps.tick(k);
  const settle = (k: Kept<unknown> | undefined, find: () => unknown): Kept<unknown> => {
    if (k !== undefined) return k;
    // As `ownWork`, keeping what a find that stopped had cost by then.
    const saved = folderLeft;
    folderLeft = FOLDER_WORK;
    try {
      const value = find();
      return { ok: true, value, cost: FOLDER_WORK - folderLeft };
    } catch (err) {
      if (err instanceof Undecidable) return { ok: false, cost: FOLDER_WORK - folderLeft, why: err.why };
      if (!(err instanceof OutOfWork) || err.walk) throw err;
      return { ok: false, cost: FOLDER_WORK };
    } finally {
      folderLeft = saved;
    }
  };
  const use = <V>(k: Kept<V>, chargeAsker: boolean): V => {
    if (chargeAsker) chargeFolder(k.cost);
    if (!k.ok) throw k.why === undefined ? new OutOfWork(false) : new Undecidable(k.why);
    return k.value;
  };
  /** A result kept for the walk, by key, found once (see above). */
  const kept = <V>(memo: Map<string, Kept<V>>, key: string, chargeAsker: boolean, find: () => V): V => {
    spend(1 + (key.length >> 3));
    let k = memo.get(key);
    if (k === undefined) {
      k = settle(undefined, find) as Kept<V>;
      memo.set(key, k);
    }
    return use(k, chargeAsker);
  };

  // ---- READING THE TREE: every read through the one reader (project-read.ts), charged -----------------------------
  //
  // [invariant] Every path this test hands the operating system is made of plain folders it listed itself and ends at a
  // plain file or folder (`placeAt`, THE FALL-BACK RULE), so the system meets no symbolic link on the way (the root's own
  // path aside, which is the person's, not the tree's) and resolves nothing it is not charged for.
  const readHead = (rel: string, max: number, enc: BufferEncoding): string | null => {
    const p = placeAt(rel);
    if (p === null || p.kind !== "file") return null;
    spend(OPEN + p.real.length + Math.ceil(max / BUFFER_UNIT));
    // A plain file the test needs and cannot read stops it (THE FALL-BACK RULE): its text would otherwise be taken as
    // showing nothing.
    let s: ReturnType<typeof sniffRegular>;
    try {
      s = sniffRegular(abs(p.real), max);
    } catch {
      throw new Undecidable(`a file it could not read (\`${p.real}\`)`);
    }
    if (!s.regular) throw new Undecidable(`a file it could not read (\`${p.real}\`)`);
    const head = s.head;
    spend(head.length);
    return head.toString(enc);
  };
  const textOf = (rel: string): string | null => readHead(rel, SMALL_FILE, "utf8");
  const jsonAt = (rel: string): unknown => {
    const t = textOf(rel);
    if (t === null) return null;
    spend(t.length);
    return parseJson(t);
  };
  const jsoncAt = (rel: string): unknown => {
    const t = textOf(rel);
    if (t === null) return null;
    spend(3 * t.length);
    return parseJsonc(t);
  };
  /** The lines of a text, a line longer than LONGEST_VALUE left out: one pass. */
  const linesOf = (text: string | null): string[] => {
    if (text === null) return [];
    spend(text.length);
    return shortLines(text);
  };
  const listings = new Map<string, Kept<Listed[]>>();
  /** The entries of the folder at `real` (plain folders all the way), listed once per walk and charged to every folder that asks. */
  const listedReal = (real: string): Listed[] =>
    kept(listings, real, true, () => {
      spend(OPEN + real.length);
      const l = listing(abs(real), real === "" ? "." : real);
      let k = l.length * Math.ceil(Math.log2(l.length + 1));
      for (const e of l) k += ENTRY + e.name.length;
      spend(k);
      return l;
    });
  /** A folder's entries, where `rel` is a plain folder of the tree; none where nothing is there or it is a file. */
  const listed = (rel: string): Listed[] => {
    const p = placeAt(rel);
    return p !== null && p.kind === "dir" ? listedReal(p.real) : [];
  };

  // ---- THE ROOT'S FACTS, once per walk -----------------------------------------------------------------------------
  const rootMemo = new Map<string, Kept<RootFacts>>();
  const rootFacts = (): RootFacts =>
    kept(rootMemo, "", false, () => {
      // Every root file is read line by line, a line longer than LONGEST_VALUE skipped, and no pattern below can read a
      // run of its line more than once.
      const marks: VendoredMark[] = [];
      for (const raw of linesOf(textOf(".gitattributes"))) {
        spend(2 * raw.length);
        const line = raw.trim();
        if (line === "" || line.startsWith("#") || line.startsWith("!")) continue;
        const [pattern, ...attrs] = line.split(/\s+/);
        if (pattern === undefined) continue;
        for (const a of attrs) {
          const m = /^([-!]?)linguist-vendored(?:=(.*))?$/.exec(a);
          if (m === null) continue;
          const vendored = m[1] === "" && (m[2] === undefined || m[2].toLowerCase() === "true");
          const quoted = pattern.length >= 2 && pattern.startsWith('"') && pattern.endsWith('"');
          const g = quoted ? pattern.slice(1, -1) : pattern;
          spend(compileCost(g));
          const glob = compileGlob(g, true);
          if (glob !== null) marks.push({ glob, vendored, line });
        }
      }
      const submodules: string[] = [];
      for (const raw of linesOf(textOf(".gitmodules"))) {
        // `path = <value>`, read by hand: `^\s*path\s*=\s*(.+?)\s*$` reads a run of blanks again from each of its starts.
        spend(2 * raw.length);
        const line = raw.trim();
        if (!line.startsWith("path")) continue;
        const rest = line.slice("path".length).trimStart();
        if (!rest.startsWith("=")) continue;
        const value = rest.slice(1).trim();
        if (value === "") continue;
        submodules.push(trimEndOf(posixPath(value).replace(/^\.?\//, ""), "/"));
      }
      const licences = new Set<string>();
      for (const e of listed("")) {
        spend(1 + e.name.length);
        if (!e.dir && isLicenceFileName(e.name)) {
          const t = textOf(e.name);
          if (t !== null) {
            spend(2 * t.length);
            licences.add(normaliseLicence(t));
          }
        }
      }
      const globs: string[] = [];
      const pkg = packageJson(topFolder);
      if (isObject(pkg)) {
        globs.push(...strings(pkg.workspaces));
        if (isObject(pkg.workspaces)) globs.push(...strings(pkg.workspaces.packages));
      }
      const lerna = jsonAt("lerna.json");
      if (isObject(lerna)) globs.push(...strings(lerna.packages));
      let inPackages = false;
      for (const raw of linesOf(textOf("pnpm-workspace.yaml"))) {
        spend(2 * raw.length);
        if (/^packages\s*:/.test(raw)) inPackages = true;
        else if (/^\S/.test(raw)) inPackages = false;
        else if (inPackages) {
          // `- <glob>`, the glob optionally quoted and followed by a comment, read by hand: a pattern with a lazy run
          // between two runs of blanks reads a run of blanks again from each of its starts.
          let s = raw.trimStart();
          if (!s.startsWith("-")) continue;
          s = s.slice(1).trimStart();
          if (s.startsWith("'") || s.startsWith('"')) s = s.slice(1);
          let end = 0;
          while (end < s.length && s[end] !== "'" && s[end] !== '"' && s[end] !== "#") end++;
          const glob = s.slice(0, end).trimEnd();
          let after = s.slice(end);
          if (after.startsWith("'") || after.startsWith('"')) after = after.slice(1);
          after = after.trimStart();
          if (glob !== "" && (after === "" || after.startsWith("#"))) globs.push(glob);
        }
      }
      const workspaces: { glob: GlobSegment[]; negated: boolean }[] = [];
      for (const g of globs) {
        spend(2 * g.length + compileCost(g));
        const glob = compileGlob(posixPath(g.replace(/^!/, "")).replace(/^\.\//, ""), false);
        if (glob !== null) workspaces.push({ negated: g.startsWith("!"), glob });
      }
      const pythonPackages: { name: string; dir: string }[] = [];
      for (const base of ["", "src"]) {
        for (const e of listed(base)) {
          spend(1 + e.name.length);
          const rel = base === "" ? e.name : `${base}/${e.name}`;
          if (e.dir && /^[A-Za-z_]\w*$/.test(e.name) && listed(rel).some((f) => f.name === "__init__.py")) {
            pythonPackages.push({ name: e.name, dir: rel });
          }
        }
      }
      const composer: { prefix: string; dirs: string[] }[] = [];
      const comp = jsonAt("composer.json");
      if (isObject(comp)) {
        for (const section of [comp.autoload, comp["autoload-dev"]]) {
          if (!isObject(section)) continue;
          for (const kind of ["psr-4", "psr-0"]) {
            const map = section[kind];
            if (!isObject(map)) continue;
            for (const [prefix, dirs] of Object.entries(map)) {
              const list = (typeof dirs === "string" ? [dirs] : strings(dirs)).filter(short);
              spend(1 + prefix.length + list.reduce((sum, d) => sum + 2 * d.length, 0));
              // An empty prefix (PSR-4's fallback for every namespace) would make every name the project's own: not kept.
              const name = trimEndOf(prefix, "\\");
              if (name === "" || !short(name)) continue;
              composer.push({ prefix: name, dirs: list.map((d) => trimEndOf(posixPath(d).replace(/^\.\//, ""), "/")) });
            }
          }
        }
      }
      return { marks, submodules, licences, workspaces, pythonPackages, composer };
    });

  // ---- THE CANDIDATE'S TREE AND ITS EVIDENCE -----------------------------------------------------------------------
  /**
   * The candidate's tree: every folder and file under it, breadth first, names sorted, entering the folders the walker
   * enters (`enters`: the walker's own rule, plus the non-production folders it reads under `--include-non-production`),
   * so that every file a scan reads below the folder is examined here and the sentence about the folder is decided over
   * the files it describes. A folder beneath it that the class's name nominates on its own is left out (`nested`): it is
   * a candidate of its own and the walker tests it when it gets there, so another project's licence inside
   * `src/vendors/x/third_party/` decides about that folder and not about the whole of `src/vendors/`.
   */
  const treeOf = (relDir: string, nominated: (relSub: string) => boolean): { entries: Entry[]; gitAt: string | null; nested: string[] } => {
    const entries: Entry[] = [];
    const nested: string[] = [];
    let gitAt: string | null = null;
    const queue = [relDir];
    for (let q = 0; q < queue.length; q++) {
      const d = queue[q] as string;
      for (const e of listed(d)) {
        const rel = `${d}/${e.name}`;
        spend(ENTRY + rel.length);
        // THE FALL-BACK RULE: the candidate's tree is decided over plain files and folders only.
        if (e.odd) throw new Undecidable(`a name that is not valid UTF-8 in \`${d}\``);
        if (e.link) throw new Undecidable(`a symbolic link \`${rel}\``);
        if (folderKind(e.name) === "git") {
          gitAt ??= rel;
          continue;
        }
        if (e.dir) {
          spend(NAME_TEST + rel.length);
          if (nominated(rel)) {
            nested.push(rel);
            continue;
          }
          entries.push({ rel, name: e.name, dir: true });
          if (enters(e.name)) queue.push(rel);
        } else if (e.file) entries.push({ rel, name: e.name, dir: false });
      }
    }
    return { entries, gitAt, nested };
  };

  const globParts = (rel: string): string[] => {
    spend(rel.length);
    return rel.split("/");
  };
  const markedVendored = (f: RootFacts, rel: string): VendoredMark | null => {
    if (f.marks.length === 0) return null;
    const parts = globParts(rel);
    let last: VendoredMark | null = null;
    try {
      for (const m of f.marks) if (globMatches(m.glob, parts, steps)) last = m;
    } finally {
      steps.done();
    }
    return last !== null && last.vendored ? last : null;
  };
  const workspaceClaims = (f: RootFacts, dir: string): boolean => {
    if (f.workspaces.length === 0) return false;
    const parts = globParts(dir);
    let claimed = false;
    try {
      for (const w of f.workspaces) if (globMatches(w.glob, parts, steps)) claimed = !w.negated;
    } finally {
      steps.done();
    }
    return claimed;
  };

  /** Each file's licence and notice facts, found once per walk and charged to every folder that asks. */
  const licenceFacts = new Map<string, Kept<boolean>>();
  const noticeFacts = new Map<string, Kept<boolean>>();
  const notOurLicence = (f: RootFacts, rel: string): boolean =>
    kept(licenceFacts, rel, true, () => {
      const t = textOf(rel);
      if (t === null) return false;
      spend(2 * t.length);
      return !f.licences.has(normaliseLicence(t));
    });
  const hasNotice = (rel: string): boolean =>
    kept(noticeFacts, rel, true, () => {
      const head = readHead(rel, NOTICE_HEAD, "latin1");
      if (head === null) return false;
      spend(2 * head.length);
      return /^(?:\xEF\xBB\xBF)?\s*\/\*!/.test(head) || /@license\b/.test(head);
    });

  /** The first sign of third-party origin, in the order of the H6 design; null where the tree shows none. */
  const evidenceOf = (f: RootFacts, relDir: string, entries: Entry[], gitAt: string | null, nested: string[]): string | null => {
    for (const s of f.submodules) {
      spend(1 + s.length * (3 + nested.length));
      if (s === "" || nested.some((n) => inside(s, n))) continue;
      if (s === relDir || inside(s, relDir) || inside(relDir, s)) return `a git submodule at \`${s}\` (.gitmodules)`;
    }
    if (gitAt !== null) return `a separate git checkout (\`${gitAt}\`)`;
    if (f.marks.length > 0) {
      for (const rel of [relDir, ...entries.map((e) => e.rel)]) {
        const m = markedVendored(f, rel);
        if (m !== null) return `a linguist-vendored mark in .gitattributes (\`${m.line}\`) on \`${rel}\``;
      }
    }
    for (const e of entries) {
      spend(1 + e.name.length);
      if (!e.dir && VENDORING_MANIFESTS.has(e.name)) return `a vendoring manifest \`${e.rel}\``;
    }
    for (const e of entries) {
      spend(1 + 2 * e.name.length);
      if (e.dir && PACKAGE_DIRECTORY_SUFFIX.test(e.name)) return `an installed package's metadata \`${e.rel}\``;
      if (e.dir) continue;
      if (e.name === "package.json" && workspaceClaims(f, posix.dirname(e.rel))) continue;
      if (PACKAGE_MANIFESTS.has(e.name) || PACKAGE_MANIFEST_SUFFIX.test(e.name)) return `another package's manifest \`${e.rel}\``;
    }
    for (const e of entries) {
      spend(1 + 2 * e.name.length);
      if (e.dir || !isLicenceFileName(e.name)) continue;
      if (notOurLicence(f, e.rel)) return `a licence file that is not the project's own \`${e.rel}\``;
    }
    for (const e of entries) {
      if (e.dir) continue;
      if (hasNotice(e.rel)) return `a licence notice at the head of \`${e.rel}\``;
    }
    return null;
  };

  // ---- WHERE AN IMPORT LANDS ------------------------------------------------------------------------------------
  //
  // A place is looked up by its path relative to the root, one folder at a time, each folder's entries listed once per
  // walk. By THE FALL-BACK RULE nothing is resolved here: a step onto a symbolic link, onto a name that does not
  // round-trip or onto an entry that is neither a file nor a folder stops the test (`Undecidable`), and so does a folder on
  // the way that cannot be listed and a path that leaves the tree (it climbs above the root, or is absolute), since what
  // lies there cannot be decided over the tree's own plain files. A path to nothing is no place.

  /** What stands at a path of the tree: a plain file or a plain folder, at that very path (posix, `""` for the root). */
  type Place = { kind: "file" | "dir"; real: string };
  type Names = Map<string, Listed>;
  /**
   * The places looked up so far, by their segments (one step per segment of a path, so a path costs its length and not
   * its depth times its length). A node holds its place, its folder's entries once listed, what it shows of another
   * project's code once asked (`inAnotherProject`), and, where the step onto it met what THE FALL-BACK RULE does not use,
   * what that was (`stop`), so that every later step there stops the same way.
   */
  interface PlaceNode {
    place: Place | null;
    names?: Names;
    shows?: string | null | { stop: string };
    stop?: string;
    next: Map<string, PlaceNode>;
  }
  const placeTop: PlaceNode = { place: { kind: "dir", real: "" }, next: new Map() };
  const namesOf = (node: PlaceNode): Names => {
    if (node.names === undefined) {
      const l = node.place !== null && node.place.kind === "dir" ? listedReal(node.place.real) : [];
      spend(l.length);
      node.names = new Map(l.map((e) => [e.name, e]));
    }
    return node.names;
  };
  /** One step down the places: the entry `seg` of the folder at `node`, a plain file or folder, or nothing. */
  const step = (node: PlaceNode, seg: string): PlaceNode => {
    spend(1 + seg.length);
    let child = node.next.get(seg);
    if (child === undefined) {
      let place: Place | null = null;
      let stop: string | undefined;
      const parent = node.place;
      if (parent !== null && parent.kind === "dir") {
        const e = namesOf(node).get(seg);
        const real = under(parent.real, seg);
        spend(real.length);
        if (e?.odd === true) stop = `a name that is not valid UTF-8 in \`${parent.real}\``;
        else if (e?.link === true) stop = `a symbolic link \`${real}\``;
        else if (e?.dir === true) place = { kind: "dir", real };
        else if (e?.file === true) place = { kind: "file", real };
        // Neither a plain file nor a plain folder (a named pipe, a socket, a device): not decided over.
        else if (e !== undefined) stop = `an entry that is neither a file nor a folder \`${real}\``;
      }
      child = { place, next: new Map(), ...(stop === undefined ? {} : { stop }) };
      node.next.set(seg, child);
    }
    if (child.stop !== undefined) throw new Undecidable(child.stop);
    return child;
  };
  /** The node of `rel` (normalised, relative to the root), each folder on the way listed once per walk. */
  const nodeAt = (rel: string): PlaceNode => {
    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) throw new Undecidable(`a path that leaves the tree (\`${rel}\`)`);
    let node = placeTop;
    if (rel !== "") for (const seg of globParts(rel)) node = step(node, seg);
    return node;
  };
  const placeAt = (rel: string): Place | null => nodeAt(rel).place;

  /** Whether the class's name nominates a folder of this name, at the top of the tree or below it: decided once per name. */
  const namedCache = new Map<string, boolean>();
  const isNamedLike = (name: string, top: boolean): boolean => {
    const key = `${top ? "/" : ""}${name}`;
    spend(1 + key.length);
    let named = namedCache.get(key);
    if (named === undefined) {
      // Every parent is masked by `namedLike` whatever it is called, so one stands for all.
      spend(NAME_TEST + key.length);
      named = namedLike(top ? name : `_/${name}`);
      namedCache.set(key, named);
    }
    return named;
  };
  /**
   * What a folder named like the class shows of another project's code, decided with a work count of its own; where its
   * test met what THE FALL-BACK RULE does not use, what that was (`stop`), and every folder asking about it is held.
   */
  const shows = (dir: string): string | null | { stop: string } => {
    try {
      return ownWork(() => {
        const t = treeOf(dir, (relSub) => isNamedLike(posix.basename(relSub), false));
        return evidenceOf(rootFacts(), dir, t.entries, t.gitAt, t.nested);
      }).value;
    } catch (err) {
      if (err instanceof Undecidable) return { stop: err.why };
      if (!(err instanceof OutOfWork)) throw err;
      return err.walk ? "the tests of this walk reached their work limit" : "its test reached its work limit";
    }
  };
  /**
   * Whether a path lies in (or, for a folder, is) a folder named like the class that shows another project's code. Each
   * such folder is decided once per walk, whichever folder's import asks first, so the answer is the same in any order.
   */
  const inAnotherProject = (rel: string, isDir: boolean): boolean => {
    if (rel === "") return false;
    const parts = globParts(rel);
    let node = placeTop;
    let end = -1;
    for (let i = 0; i < parts.length - (isDir ? 0 : 1); i++) {
      const seg = parts[i] as string;
      end += seg.length + 1;
      node = step(node, seg);
      if (node.place?.kind !== "dir") return false;
      if (!isNamedLike(seg, i === 0)) continue;
      node.shows ??= shows(rel.slice(0, end));
      if (typeof node.shows === "object" && node.shows !== null) throw new Undecidable(node.shows.stop);
      if (node.shows !== null) return true;
    }
    return false;
  };

  /** Inside the tree, outside the candidate, and in no machine-written folder the walker never reads (`node_modules`, `dist`, ...). */
  const outsideCandidate = (rel: string, relDir: string): boolean => {
    spend(2 * rel.length);
    return !(rel === ".." || rel.startsWith("../") || rel.startsWith("/") || inside(rel, relDir)) && !(rel !== "" && rel.split("/").some(machineWritten));
  };

  /** A path that leaves the tree: what lies there cannot be decided over the tree's own files (THE FALL-BACK RULE). */
  const leavesTree = (rel: string): boolean => rel === ".." || rel.startsWith("../") || isAbsolute(rel);
  /** Whether a path lies in a machine-written folder, by its segments' names alone (nothing is looked up). */
  const inMachineWritten = (rel: string): boolean => {
    spend(2 * rel.length);
    return rel.split("/").some(machineWritten);
  };

  /**
   * Whether `rel` (normalised, relative to the root) is a plain file, or a plain folder, as `want` asks, where the
   * project's own code can be: inside the tree, outside the candidate and the machine-written folders, and in no folder
   * named like the class that shows another project's code. A path that leaves the tree, or meets a link or a name that
   * does not round-trip on the way, stops the test (THE FALL-BACK RULE). Only `resolveOwn` and the shapes it calls ask it.
   */
  const ownAt = (rel: string, relDir: string, want: "file" | "dir"): boolean => {
    spend(1 + rel.length);
    if (!short(rel)) return false;
    if (leavesTree(rel)) throw new Undecidable(`a path that leaves the tree (\`${rel}\`)`);
    if (!outsideCandidate(rel, relDir)) return false;
    const p = placeAt(rel);
    if (p === null || p.kind !== want) return false;
    return !inAnotherProject(rel, want === "dir");
  };

  // ---- EACH FOLDER'S MANIFESTS, once per walk ------------------------------------------------------------------------
  const topFolder: Folder = { rel: "", next: new Map() };
  /** The folder at `rel` and the folders above it, root first: one step per segment, each folder's path made once. */
  const folderChain = (rel: string): Folder[] => {
    const chain = [topFolder];
    let node = topFolder;
    if (rel !== "") {
      for (const seg of globParts(rel)) {
        spend(1 + seg.length);
        let c = node.next.get(seg);
        if (c === undefined) {
          c = { rel: under(node.rel, seg), next: new Map() };
          spend(c.rel.length);
          node.next.set(seg, c);
        }
        node = c;
        chain.push(c);
      }
    }
    return chain;
  };
  const folderAt = (rel: string): Folder => folderChain(rel).pop() as Folder;
  const keptOn = <V>(fo: Folder, key: "json" | "pkg" | "ts" | "go", find: () => V): V => {
    spend(1);
    const k = settle(fo[key] as Kept<unknown> | undefined, find) as Kept<V>;
    (fo as unknown as Record<string, Kept<V>>)[key] = k;
    return use(k, false);
  };

  /**
   * The project's workspace packages by name, from the folders the root's workspace globs claim; built once, and only
   * when a `workspace:` dependency has to be resolved. Folders past the budget are not looked at, so a name found
   * nowhere stays unresolved and the folder that imports it stays held back, as before H6.
   */
  let workspaceDirs: Map<string, string> | null = null;
  /** What THE FALL-BACK RULE met in the search for the workspace packages, if anything: every folder asking is held. */
  let workspaceStop: string | null = null;
  const workspacePackage = (f: RootFacts, name: string): string | null => {
    if (workspaceStop !== null) throw new Undecidable(workspaceStop);
    if (workspaceDirs === null) {
      const found = new Map<string, string>();
      if (f.workspaces.length > 0) {
        // A count of its own: the map is kept for the walk, so what it holds must not depend on the folder that asked.
        // Where the count runs out the search stops, as it does past WORKSPACE_DIRS_BUDGET.
        try {
          ownWork(() => {
            const queue = [""];
            let seen = 0;
            for (let q = 0; q < queue.length && seen < WORKSPACE_DIRS_BUDGET; q++) {
              const d = queue[q] as string;
              for (const e of listed(d)) {
                spend(ENTRY + e.name.length);
                if (!e.dir || !enters(e.name)) continue;
                const rel = d === "" ? e.name : `${d}/${e.name}`;
                seen++;
                queue.push(rel);
                if (!workspaceClaims(f, rel)) continue;
                const pkg = packageJson(folderAt(rel));
                if (isObject(pkg) && typeof pkg.name === "string" && short(pkg.name) && !found.has(pkg.name)) found.set(pkg.name, rel);
              }
            }
          });
        } catch (err) {
          if (err instanceof Undecidable) {
            workspaceStop = err.why;
            throw err;
          }
          if (!(err instanceof OutOfWork) || err.walk) throw err;
        }
      }
      workspaceDirs = found;
    }
    spend(1 + name.length);
    return workspaceDirs.get(name) ?? null;
  };

  /** A folder's package.json, parsed: read once per walk for every use of it (the root's workspaces, packages, `main`). */
  const packageJson = (fo: Folder): unknown => keptOn(fo, "json", () => jsonAt(under(fo.rel, "package.json")));
  /** A folder's package.json: its name, the folders of its link/file/portal/workspace dependencies, its `main`. */
  const packageFacts = (fo: Folder): PackageFacts =>
    keptOn(fo, "pkg", () => {
      const pkg = packageJson(fo);
      const deps = new Map<string, string>();
      if (!isObject(pkg)) return { name: null, deps, main: null };
      for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        const list = pkg[field];
        if (!isObject(list)) continue;
        for (const [name, spec] of Object.entries(list)) {
          if (typeof spec !== "string") continue;
          spend(1 + name.length + 2 * spec.length);
          if (!short(spec) || !short(name) || deps.has(name)) continue;
          const local = /^(?:link|file|portal):(.*)$/.exec(spec);
          if (local !== null) {
            deps.set(name, norm(posix.join(fo.rel, posixPath(local[1] ?? ""))));
            continue;
          }
          if (!spec.startsWith("workspace:")) continue;
          const range = spec.slice("workspace:".length);
          const alias = /^(@?[^@\s/]+(?:\/[^@\s]+)?)@/.exec(range);
          const target = range.startsWith(".") ? norm(posix.join(fo.rel, posixPath(range))) : workspacePackage(rootFacts(), alias?.[1] ?? name);
          if (target !== null) deps.set(name, target);
        }
      }
      const name = typeof pkg.name === "string" && short(pkg.name) ? pkg.name : null;
      const main = typeof pkg.main === "string" && short(pkg.main) ? posixPath(pkg.main) : null;
      return { name, deps, main };
    });
  /** A folder's tsconfig.json path aliases; null where it is not an object (the nearest that is one decides). */
  const tsAliases = (fo: Folder): Alias[] | null =>
    keptOn(fo, "ts", () => {
      const ts = jsoncAt(under(fo.rel, "tsconfig.json"));
      if (!isObject(ts)) return null;
      const co = isObject(ts.compilerOptions) ? ts.compilerOptions : {};
      const baseUrl = typeof co.baseUrl === "string" ? posixPath(co.baseUrl) : ".";
      // An absolute `baseUrl` or target is kept absolute, as TypeScript reads it from the file system's root: an import
      // through it leaves the tree and stops the test (THE FALL-BACK RULE).
      const base = isAbsolute(baseUrl) ? baseUrl : posix.join(fo.rel, baseUrl);
      const aliases: Alias[] = [];
      // A key that is `*` alone (an empty prefix) would make every package name the project's own, so it is not one.
      if (isObject(co.paths) && short(baseUrl)) {
        for (const [key, targets] of Object.entries(co.paths)) {
          const list = strings(targets).filter(short);
          spend(1 + key.length + list.reduce((sum, t) => sum + 2 * (t.length + base.length), 0));
          const exact = !key.endsWith("*");
          const prefix = exact ? key : key.slice(0, -1);
          if (prefix === "" || !short(key)) continue;
          aliases.push({ prefix, exact, targets: list.map((t) => (isAbsolute(posixPath(t)) ? posixPath(t) : posix.join(base, posixPath(t)))) });
        }
      }
      return aliases;
    });
  /** A folder's go.mod module path, from its first `module` line; null where there is none. */
  const goModuleOf = (fo: Folder): string | null =>
    keptOn(fo, "go", () => {
      for (const line of linesOf(textOf(under(fo.rel, "go.mod")))) {
        spend(line.length);
        const m = /^\s*module\s+"?([^\s"]+)"?/.exec(line);
        if (m?.[1]) return m[1];
      }
      return null;
    });
  const notOwnMemo = new Map<string, boolean>();
  const notOwn = (dir: string): boolean => {
    spend(1 + dir.length);
    let v = notOwnMemo.get(dir);
    if (v === undefined) {
      spend(NAME_TEST + dir.length);
      v = notOwnCode(dir);
      notOwnMemo.set(dir, v);
    }
    return v;
  };

  // ---- THE ONE RESOLUTION ----------------------------------------------------------------------------------------
  //
  // [invariant] An import counts as the project's own only through `resolveOwn`: `ownImportOf` returns a hit only where
  // it says true, and every language's reading of its imports (`importsOf`) yields places to look at and decides nothing.

  /** A JavaScript folder of the project's own: a package (its package.json) or an index module, as Node and the bundlers resolve one. */
  const JS_FOLDER_FILES = ["package.json", ...JS_EXTENSIONS.map((x) => `index${x}`)];
  /**
   * THE FIRST FORM THAT EXISTS, in TypeScript's order, not Node's: the path as a file, the path plus each extension of
   * JS_EXTENSIONS (TypeScript's sources first, `.ts`, `.tsx`, `.mts`, `.cts`, `.d.ts`, then `.js` and the rest), for a
   * `.js`-like path its TypeScript source (`tsVariant`), and then the path as a folder; null where none exists. TypeScript's
   * order because the imports this test resolves are source imports, which `tsc` and a bundler set up for TypeScript
   * resolve so; Node's `require` never adds `.ts`. Where the two orders differ, a `.ts` and a `.js` of one name stand side
   * by side in one folder and either is that folder's own module, so the decision of whose code the import names is the
   * same. No rule of ownership is applied here: the form found
   * decides, whoever's it is. A form that is a folder where a
   * file is looked for is passed over, as Node and TypeScript pass it over. A link, a
   * name that does not round-trip or an entry that is neither a file nor a folder on the way stops the test (`placeAt`).
   */
  const firstForm = (target: string, tsVariant: boolean): Place | null => {
    const at = placeAt(target);
    if (at?.kind === "file") return at;
    for (const x of JS_EXTENSIONS) {
      const p = placeAt(`${target}${x}`);
      if (p?.kind === "file") return p;
    }
    if (tsVariant) {
      spend(target.length);
      const js = /\.([cm]?)js(x?)$/.exec(target);
      const p = js === null ? null : placeAt(`${target.slice(0, js.index)}.${js[1]}ts${js[2]}`);
      if (p?.kind === "file") return p;
    }
    return at?.kind === "dir" ? at : null;
  };
  /** Where Node loads a package's `main` from: its first form, and for a folder the folder's index module; null for nowhere. */
  const landingOf = (target: string): string | null => {
    const p = firstForm(target, false);
    return p === null ? null : p.kind === "file" ? p.real : indexOf(p.real);
  };
  /** The index module a folder loads where nothing names another (`index.js` and the rest, in the bundlers' order). */
  const indexOf = (dir: string): string | null => {
    for (const n of JS_FOLDER_FILES.slice(1)) {
      if (placeAt(under(dir, n))?.kind === "file") return under(dir, n);
    }
    return null;
  };
  /**
   * A package's `main` as a path of the tree, as Node joins it to the package folder. An absolute `main`, or one that
   * climbs above the root, stops the test (THE FALL-BACK RULE): what Node loads there cannot be decided over the tree.
   */
  const mainPath = (dir: string, main: string): string => {
    spend(2 * (dir.length + main.length));
    if (isAbsolute(main)) throw new Undecidable(`an absolute \`main\` in \`${under(dir, "package.json")}\``);
    const to = norm(posix.join(dir, main));
    if (leavesTree(to)) throw new Undecidable(`a \`main\` that leaves the tree in \`${under(dir, "package.json")}\``);
    return to;
  };
  /**
   * A package folder lands in the project's own code where it is a folder of the project's own holding its package.json
   * or an index module, and where what Node loads from it - its `main`, or with no `main` its index module - passes the
   * same tests as every import (`ownAt`): not in the candidate, not in another project's folder. A `main` that lands
   * nowhere in the tree, or in a machine-written folder (a package's build output, `dist/`, not checked in), leaves the
   * folder itself as what the import names.
   */
  const jsFolder = (dir: string, relDir: string): boolean => {
    if (!ownAt(dir, relDir, "dir")) return false;
    const main = packageFacts(folderAt(dir)).main;
    const to = main === null ? null : mainPath(dir, main);
    // Where the `main`'s folder is machine-written, every form of it is: nothing there is looked up.
    const landed = to === null ? indexOf(dir) : inMachineWritten(posix.dirname(to)) ? null : landingOf(to);
    if (landed !== null && !inMachineWritten(landed) && !ownAt(landed, relDir, "file")) return false;
    return JS_FOLDER_FILES.some((name) => ownAt(under(dir, name), relDir, "file"));
  };
  /**
   * A JavaScript or TypeScript module path, resolved as Node and the bundlers do: THE FIRST FORM THAT EXISTS decides
   * (`firstForm`), and it counts where it is the project's own (`ownAt`; a folder, where it is a package of the project's
   * own, `jsFolder`).
   */
  const resolvesJs = (target: string, relDir: string): boolean => {
    spend(1 + target.length);
    // Below the candidate, every form of the path (an extension added, an index file) is the candidate's own file; in a
    // machine-written folder, every form is machine-written. Nothing there is looked up.
    if (relDir !== "" && target.startsWith(`${relDir}/`)) return false;
    if (leavesTree(target)) throw new Undecidable(`a path that leaves the tree (\`${target}\`)`);
    if (inMachineWritten(posix.dirname(target))) return false;
    const p = firstForm(target, true);
    if (p === null) return false;
    return p.kind === "dir" ? jsFolder(p.real, relDir) : ownAt(p.real, relDir, "file");
  };
  /** A Python package: a folder holding its `__init__.py`. */
  const pyPackage = (dir: string, relDir: string): boolean => ownAt(dir, relDir, "dir") && ownAt(under(dir, "__init__.py"), relDir, "file");
  /** A Go package: a folder holding a `.go` file that is not a test file. */
  const goPackage = (dir: string, relDir: string): boolean => {
    if (!ownAt(dir, relDir, "dir")) return false;
    for (const [name, e] of namesOf(nodeAt(dir))) {
      spend(1 + name.length);
      if (e.dir || !name.endsWith(".go") || name.endsWith("_test.go")) continue;
      if (ownAt(under(dir, name), relDir, "file")) return true;
    }
    return false;
  };
  /** THE ONE RESOLUTION: whether an import lands on a module of the project's own, by the shape its language gives it. */
  const resolveOwn = (imp: Import, relDir: string): boolean => {
    if (imp.pkg !== undefined && !jsFolder(imp.pkg, relDir)) return false;
    switch (imp.shape) {
      case "js":
        return resolvesJs(imp.target, relDir);
      case "js-folder":
        return jsFolder(imp.target, relDir);
      case "py-package":
        return pyPackage(imp.target, relDir);
      case "go-package":
        return goPackage(imp.target, relDir);
      default:
        return ownAt(imp.target, relDir, "file");
    }
  };

  /** What a candidate's imports may name besides relative paths, read lazily from the folders above it (each once per walk). */
  interface Context {
    /** The folders above the candidate, nearest first. */
    above: Folder[];
    aliases: () => Alias[];
    goModule: () => { path: string; dir: string } | null;
    python: () => Map<string, string[]>;
  }
  const lazy = <T>(find: () => T): (() => T) => {
    let done = false;
    let v: T | undefined;
    return () => {
      if (!done) {
        v = find();
        done = true;
      }
      return v as T;
    };
  };
  const fromFile = (fileRel: string, spec: string): string => {
    spend(2 * (fileRel.length + spec.length));
    return norm(posix.join(posix.dirname(fileRel), spec));
  };

  /**
   * Every import of a file and the place it names, by language: reading only, no decision. A JavaScript bare name is
   * looked for among the packages of the folders above the candidate (each one's own name and local dependencies,
   * nearest first) and the nearest tsconfig.json's aliases; a path below a package must land as well as the package.
   */
  function* importsOf(kind: ImportKind, text: string, fileRel: string, ctx: Context): Generator<Import> {
    const run = (re: RegExp): IterableIterator<RegExpMatchArray> => {
      spend(text.length);
      return text.matchAll(re);
    };
    if (kind === "js") {
      for (const m of run(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]([^'"\n]+)['"]/g)) {
        const spec = m[1] ?? "";
        spend(1 + spec.length);
        if (!short(spec)) continue;
        if (spec.startsWith(".")) {
          yield { what: spec, target: fromFile(fileRel, spec), shape: "js" };
          continue;
        }
        const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : (spec.split("/")[0] ?? "");
        // Without its leading slash: joined to the root's own folder (""), "/x" would stay "/x" and never be inside anything.
        const sub = spec.slice(name.length).replace(/^\/+/, "");
        for (const fo of ctx.above) {
          spend(1);
          const p = packageFacts(fo);
          const dir = p.name === name ? fo.rel : p.deps.get(name);
          if (dir === undefined) continue;
          yield sub === "" ? { what: spec, target: dir, shape: "js-folder" } : { what: spec, target: norm(posix.join(dir, sub)), shape: "js", pkg: dir };
        }
        for (const a of ctx.aliases()) {
          spend(1 + a.prefix.length);
          if (a.exact ? spec !== a.prefix : !spec.startsWith(a.prefix)) continue;
          const rest = a.exact ? "" : spec.slice(a.prefix.length);
          for (const t of a.targets) yield { what: spec, target: norm(t.replace("*", rest)), shape: "js" };
        }
      }
    } else if (kind === "py") {
      // The dots, then a name that starts with a letter: `(\.+)([\w.]*)` would split a run of dots every way there is.
      for (const m of run(/^[ \t]*from[ \t]+(\.+)(\w[\w.]*)?[ \t]+import\b/gm)) {
        const dots = m[1] ?? "";
        const mod = m[2] ?? "";
        spend(1 + dots.length + mod.length);
        if (!short(dots + mod)) continue;
        const up = Array.from({ length: dots.length - 1 }, () => "..");
        const target = fromFile(fileRel, [".", ...up, ...(mod ? mod.split(".") : [])].join("/"));
        yield { what: `${dots}${mod}`, target, shape: "py-package" };
        if (mod !== "") yield { what: `${dots}${mod}`, target: `${target}.py`, shape: "py-module" };
      }
      for (const m of run(/^[ \t]*(?:from|import)[ \t]+([A-Za-z_]\w*)/gm)) {
        const name = m[1] ?? "";
        spend(1 + name.length);
        for (const dir of ctx.python().get(name) ?? []) yield { what: name, target: dir, shape: "py-package" };
      }
    } else if (kind === "go") {
      const mod = ctx.goModule();
      if (mod === null) return;
      spend(2 * text.length);
      for (const spec of goImportSpecs(text)) {
        spend(1 + spec.length);
        if (!short(spec) || (spec !== mod.path && !spec.startsWith(`${mod.path}/`))) continue;
        yield { what: spec, target: norm(posix.join(mod.dir, spec.slice(mod.path.length).replace(/^\//, ""))), shape: "go-package" };
      }
    } else if (kind === "rb") {
      for (const m of run(/\brequire_relative\s*(?:\(\s*)?['"]([^'"\n]+)['"]/g)) {
        const spec = m[1] ?? "";
        spend(1 + spec.length);
        if (!short(spec)) continue;
        const target = fromFile(fileRel, spec);
        yield { what: spec, target: `${target}.rb`, shape: "file" };
        yield { what: spec, target, shape: "file" };
      }
    } else if (kind === "php") {
      for (const m of run(/__DIR__\s*\.\s*['"]\/(\.\.[^'"\n]*)['"]/g)) {
        const spec = m[1] ?? "";
        spend(1 + spec.length);
        if (short(spec)) yield { what: `__DIR__ . '/${spec}'`, target: fromFile(fileRel, spec), shape: "file" };
      }
      for (const m of run(/^[ \t]*use[ \t]+\\?([A-Za-z_][\w\\]*)/gm)) {
        const ns = m[1] ?? "";
        spend(1 + ns.length);
        if (!short(ns)) continue;
        for (const c of rootFacts().composer) {
          spend(1 + c.prefix.length);
          // In the namespace: the global one (`""`) holds every name, which is why an empty prefix is never kept (rootFacts).
          if (!(c.prefix === "" || ns === c.prefix || ns.startsWith(`${c.prefix}\\`))) continue;
          // PSR-4 maps the rest of the name below the folder, PSR-0 the whole name: either, as a class file.
          const rest = ns.slice(c.prefix.length).replace(/\\/g, "/").replace(/^\/+/, "");
          const whole = ns.replace(/\\/g, "/");
          for (const d of c.dirs) {
            spend(2 * (d.length + ns.length));
            for (const p of [posix.join(d, rest), posix.join(d, whole)]) yield { what: ns, target: `${norm(p)}.php`, shape: "file" };
          }
        }
      }
    } else {
      for (const m of run(/^[ \t]*#[ \t]*(?:include|import)[ \t]*"([^"\n]+)"/gm)) {
        const spec = m[1] ?? "";
        spend(1 + spec.length);
        if (short(spec) && spec.startsWith("..")) yield { what: spec, target: fromFile(fileRel, spec), shape: "file" };
      }
    }
  }

  /** The first import of the project's own code from a file of the candidate; null where none is found within the budget. */
  const ownImportOf = (f: RootFacts, relDir: string, entries: Entry[]): string | null => {
    const above = folderChain(posix.dirname(relDir) === "." ? "" : posix.dirname(relDir)).reverse();
    // Python: a top-level package of the project's, outside the candidate; not one the candidate has a module of its own
    // by the same name; and not one the read scope holds back by its name (`tests`, `test`): nearly every project has
    // such a package, so a file of another project naming it names its own.
    const python = lazy(() => {
      const namesHere = { dirs: new Set<string>(), files: new Set<string>() };
      for (const e of entries) {
        spend(1 + e.name.length);
        (e.dir ? namesHere.dirs : namesHere.files).add(e.name);
      }
      const m = new Map<string, string[]>();
      for (const p of f.pythonPackages) {
        spend(1 + 2 * p.dir.length);
        if (inside(p.dir, relDir) || notOwn(p.dir) || namesHere.dirs.has(p.name) || namesHere.files.has(`${p.name}.py`)) continue;
        m.set(p.name, [...(m.get(p.name) ?? []), p.dir]);
      }
      return m;
    });
    const ctx: Context = {
      above,
      // The nearest tsconfig.json that is an object decides.
      aliases: lazy(() => {
        for (const fo of above) {
          spend(1);
          const a = tsAliases(fo);
          if (a !== null) return a;
        }
        return [];
      }),
      // The Go module the candidate's parent belongs to, from the nearest go.mod with a `module` line.
      goModule: lazy(() => {
        for (const fo of above) {
          spend(1);
          const path = goModuleOf(fo);
          if (path !== null) return { path, dir: fo.rel };
        }
        return null;
      }),
      python,
    };

    let files = 0;
    let bytes = 0;
    for (const e of entries) {
      if (e.dir) continue;
      spend(1 + 2 * e.name.length);
      const ext = (/\.([^./]+)$/.exec(e.name)?.[1] ?? "").toLowerCase();
      const js = /^(?:[cm]?[jt]sx?|mts|cts|vue|svelte)$/.test(ext);
      const kind = js ? "js" : ext === "py" ? "py" : ext === "go" ? "go" : ext === "rb" ? "rb" : ext === "php" ? "php" : /^(?:c|h|cc|cpp|cxx|hpp|hh|m|mm)$/.test(ext) ? "c" : null;
      if (kind === null) continue;
      if (files >= IMPORT_FILES_BUDGET || bytes >= IMPORT_BYTES_BUDGET) return null;
      const raw = readHead(e.rel, IMPORT_HEAD, "utf8");
      if (raw === null) continue;
      files++;
      bytes += raw.length;
      // A commented-out import is not an import: every language's comments are blanked first.
      const text = withoutComments(raw, SYNTAX[kind], tick);
      steps.done();
      for (const imp of importsOf(kind, text, e.rel, ctx)) {
        if (resolveOwn(imp, relDir)) return `\`${e.rel}\` imports \`${imp.what}\``;
      }
    }
    return null;
  };

  const test = (relDirIn: string, nominated: (relSub: string) => boolean = () => false): CandidateOrigin => {
    const relDir = posixPath(relDirIn);
    folderLeft = FOLDER_WORK;
    const t0 = process.hrtime.bigint();
    try {
      const f = rootFacts();
      const { entries, gitAt, nested } = treeOf(relDir, nominated);
      const evidence = evidenceOf(f, relDir, entries, gitAt, nested);
      if (evidence === null) return { heldBack: false, evidence: null, ownImport: null, nested: nested.length };
      const ownImport = ownImportOf(f, relDir, entries);
      return { heldBack: ownImport === null, evidence, ownImport, nested: nested.length };
    } catch (err) {
      // The tree's text is untrusted. Whatever stops this test, the work limit included, the scan goes on, and the folder
      // is held back as it was before H6 rather than read on a test that did not finish.
      const evidence =
        err instanceof Undecidable
          ? `its test met ${err.why}, which it does not decide over, so it is held back by its name as before H6`
          : err instanceof OutOfWork
          ? err.walk
            ? "the tests of this walk's folders reached their work limit together, so it is held back"
            : "the test of this folder reached its work limit, so it is held back"
          : `the test of this folder stopped (${err instanceof Error ? err.message : String(err)}), so it is held back`;
      return { heldBack: true, evidence, ownImport: null, nested: 0 };
    } finally {
      ms += Number(process.hrtime.bigint() - t0) / 1e6;
    }
  };
  return Object.assign(test, { work: () => ({ steps: WALK_WORK - walkLeft, ms }) });
}
