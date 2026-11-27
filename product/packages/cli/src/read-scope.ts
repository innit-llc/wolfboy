import type { CoverageLimit, CoverageLimits, Findings, WalkerExclusion } from "wolfboy-schemas";
import { toldArgs } from "./scanner-command.js";

/**
 * THE SCAN'S READ SCOPE, AND THE ONE COVERAGE-LIMITS MODEL EVERY OUTPUT RENDERS.
 *
 * ## What was decided
 *
 * A scan does not read test surfaces, vendored code or build output unless the person running it
 * says so — the owner: "what the user asks for is that it does not read them ... 'not read' is not safe. If
 * the user wants them read, the user says so with a command, or tells the agent". The second half is the load-bearing
 * one and it is why this file is not a filter: **"not read" is not "nothing there"**, so what was
 * not read is stated, with its count, in every output the product has.
 *
 * ## Why this is a COVERAGE-LIMITS model and not a `read_scope` block
 *
 * The narrow shape — one block about test directories — was refused by the owner on the day it was
 * proposed: "doing that makes it an optimisation of that one part, so make it consistent with the
 * other outputs too". A scan falls short of "read everything" in five ways and only one of them is the
 * new one; reporting that one in its own block, in its own words, in one output, would leave a
 * reader four other silences to discover for themselves and would make the outputs disagree about
 * the same tree. So the model is the whole question — *what this scan read, what it did not, and
 * whether anything can be done about it* — with one schema, one order and one wording:
 *
 *   1. `read-scope:<class>`  — a class the run did not opt into.        Lift: `--read <class>`.
 *   2. `refused-by-rule`     — paths the walker refuses by rule.        Lift: none today.
 *   3. `not-readable-as-code`— what could not be read as code at all.   Lift: none today.
 *   4. `rules-not-run`       — rules this run did not include, and the profile answers in force.
 *   5. `rules-silent`        — rules that ran and produced nothing.     Lift: none — it is the output.
 *
 * **Every member is emitted whatever its count**, zero included, because "there was nothing to hold
 * back" and "this scanner does not check" are different facts and an absent line cannot tell them
 * apart. That is the same discipline `files_not_read` and `files_partially_read` already ship under.
 *
 * ## One sentence per member, written once
 *
 * `limits[].sentence` is the ONLY wording. The findings JSON carries it, `summarize()` prints it,
 * `toSarif()` puts it in a `note`-level result's message, and the legal-scan skill reproduces it in
 * the report the adjudicating agent writes. No renderer composes a sentence of its own, so no member
 * can be phrased one way on the console and another way in the Security tab (never keep a
 * second copy of anything two places must agree on).
 *
 * ## Where the patterns come from
 *
 * `rules/path-exclusions/{test-surfaces,vendored-code,generated-output}.yaml`, unchanged — the sets
 * that 66 rules already name. The build resolves each of those three files into one class and writes
 * `dist/bundle/read-scope.json`, hashed into `manifest.files`; the engine compiles what the bundle
 * carries and spells nothing itself. A bundle built before this unit carries no such file, and a
 * scan with one excludes nothing on this account and says so in the same block.
 *
 * The wording below is keyed by the class ids the bundle declares. A class the bundle carries and
 * this table does not still works — it gets its own id as its noun — because a scan must never fail
 * to describe what it did; a test asserts that the two agree today.
 */

/** The bundle file the three classes ride in, and the shape they ride in. */
export const READ_SCOPE_FILE = "read-scope.json";

export interface ReadScopeClassSource {
  /** The `rules/path-exclusions/` file this class is, named so a reader can go and read it. */
  source: string;
  /** Every set that file declares, in name order. */
  sets: string[];
  /** The union of those sets' clauses, first-appearance order, one copy each. */
  patterns: string[];
}

/**
 * One set of `rules/path-exclusions/documents.yaml`, carried into the bundle so that something other
 * than a rule can NAME the paths it covers — and carried under a different key from `classes` for
 * one reason: `readScopeFor` turns a member of `classes` into a class the walker HOLDS BACK unless
 * `--read` names it, so adding "prose" or "translation catalogues" there would silently stop the
 * scan from reading them. Nothing here reaches the walker, `parseReadOption` or `coverageLimits`;
 * the orientation sheet (orientation.ts) is the only reader, and it counts paths without declining
 * one.
 *
 * `documents.yaml` is deliberately not a read-scope class — `tools/shared-path-exclusions.mjs` says
 * why — and this does not make it one.
 */
export interface InformationalPathClassSource {
  /** The `rules/path-exclusions/` file the set was declared in. */
  source: string;
  /** The set's own `question` field, verbatim: what a rule naming this set declines to look at. */
  question: string;
  /** The set's clauses, first-appearance order, one copy each. */
  patterns: string[];
}

export interface ReadScopeManifest {
  version: number;
  classes: Record<string, ReadScopeClassSource>;
  /**
   * Path sets that describe a tree and govern no scan, keyed by the SET name as its YAML declares
   * it. Absent on a bundle built before 2026-09-17, which costs the orientation sheet those rows
   * and nothing else.
   */
  informational_classes?: Record<string, InformationalPathClassSource>;
  /**
   * The path classes in their test order
   * (tools/shared-path-exclusions.mjs `PATH_CLASS_SOURCES`, the one table): a read-scope class by its id, or the patterns
   * of the files and sets that compose it. Absent on a bundle built before 0.1.3, where every place is `code` but those a
   * read-scope class names.
   */
  path_classes?: PathClassSource[];
}

/** One path class as the bundle carries it (path-class.ts reads it). */
export type PathClassSource = { id: string; read_scope: string } | { id: string; source: string; sets: string[]; patterns: string[] };

/** One informational set, compiled. */
export interface InformationalPathClass extends InformationalPathClassSource {
  id: string;
  compiled: RegExp[];
}

/**
 * The bundle's informational path sets, compiled, in the order the bundle wrote them.
 *
 * Separate from `readScopeFor` and never merged into a `ReadScope`: a `ReadScope` is the answer to
 * "what did this run decline to read", and no member of this list declines anything.
 */
export function informationalPathClasses(manifest: ReadScopeManifest | null): InformationalPathClass[] {
  if (manifest === null || manifest.informational_classes === undefined) return [];
  return Object.entries(manifest.informational_classes).map(([id, c]) => ({
    id,
    ...c,
    compiled: c.patterns.map((p) => new RegExp(p)),
  }));
}

/** One class, compiled, with the run's answer about whether it is read. */
export interface ReadScopeClass extends ReadScopeClassSource {
  id: string;
  read: boolean;
  compiled: RegExp[];
}

/** The read scope of one run: every class the bundle declares, each read or not read. */
export interface ReadScope {
  classes: ReadScopeClass[];
}

/**
 * The plain-English noun and the consequence sentence for each class.
 *
 * The consequence is here rather than in a general note because it is what makes the line worth
 * reading: a count of skipped files says nothing to a person who has not thought about WHAT kind of
 * thing they are not being told. Each is a statement about visibility in this scan and never a legal
 * conclusion.
 */
const CLASS_WORDING: Record<string, { noun: string; verb: string; consequence: string }> = {
  tests: {
    noun: "Test surfaces",
    verb: "were",
    consequence:
      "a live key or a real person's data inside a test fixture is not visible in this scan",
  },
  vendored: {
    noun: "Vendored code",
    verb: "was",
    consequence: "a network call inside somebody else's code copied into this tree is not visible in this scan",
  },
  build: {
    noun: "Build output",
    verb: "was",
    consequence: "a secret baked into a built file is not visible in this scan",
  },
  //.
  docs: {
    noun: "Documentation sites",
    verb: "were",
    consequence: "a tracking tag or a network call in a documentation site kept in this tree is not visible in this scan",
  },
};

/** The `ExclusionReason` the walker records when a class held a path back. One per class. */
export function readScopeReason(classId: string): string {
  return `read-scope-${classId}`;
}

/** The class a `read-scope-*` walker reason belongs to, or null for every other reason. */
export function readScopeClassOfReason(reason: string): string | null {
  return reason.startsWith("read-scope-") ? reason.slice("read-scope-".length) : null;
}

/**
 * Parse `--read`. `all` is every class the bundle declares; a bare list names classes; an unknown
 * name is a hard error naming it and nothing is scanned.
 *
 * The refusal is the shape `--rules` and `--fail-on-unreviewed` already use, and it is a refusal rather than a
 * warning for one reason: a mistyped `--read tets` that silently read nothing would produce exactly
 * the document a correct `--read` run produces minus the files the person asked for, and the only
 * trace would be a count they had no baseline for.
 */
export function parseReadOption(spec: string | undefined, declared: string[]): Set<string> {
  if (spec === undefined) return new Set();
  const asked = spec
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (asked.length === 0) {
    throw new Error(
      `--read was given with no class name. Say --read all, or name classes from: ${declared.join(", ") || "none in this bundle"}`,
    );
  }
  if (asked.includes("all")) return new Set(declared);
  const unknown = asked.filter((a) => !declared.includes(a));
  if (unknown.length > 0) {
    throw new Error(
      `--read names ${unknown.length === 1 ? "a class" : "classes"} this bundle does not declare: ${unknown.join(", ")}. ` +
        `Nothing was scanned. This bundle declares: ${declared.join(", ") || "none"} (or say --read all)`,
    );
  }
  return new Set(asked);
}

/**
 * The run's read scope: the bundle's classes, compiled, each marked read or not read.
 *
 * A bundle with no `read-scope.json` produces no classes at all, which is not the same as three
 * classes that are all read: the first is a bundle that cannot express the scope and the second is a
 * run that opted into it, and `coverageLimits` below says which of the two happened.
 */
export function readScopeFor(manifest: ReadScopeManifest | null, read: Set<string>): ReadScope {
  if (manifest === null) return { classes: [] };
  return {
    classes: Object.entries(manifest.classes).map(([id, c]) => ({
      id,
      ...c,
      read: read.has(id),
      // Compiled once per run, not once per path. `new RegExp` on a source the build already
      // compiled (tools/shared-path-exclusions.mjs) cannot throw here for a bundle this repository
      // produced; a hand-edited bundle throws at load, with the class named, rather than matching
      // nothing quietly.
      compiled: c.patterns.map((p) => new RegExp(p)),
    })),
  };
}

/**
 * THE CLASSES A FOLDER NAME ONLY NOMINATES.
 *
 * For these, a folder whose name a class matches is a CANDIDATE, and the walker holds it back only where
 * the tree shows that its code came from another project and its files do not import the project's own
 * (vendored-origin.ts). A candidate that fails that test is read, and its path goes into `cleared` below
 * so that neither it nor anything under it is held back again on the same name. The other classes still
 * decide by path alone: a test folder is a test folder whoever wrote it.
 */
export const ORIGIN_TESTED_CLASSES: ReadonlySet<string> = new Set(["vendored"]);

/**
 * THE CLASS A FOLDER NAME ONLY NOMINATES AS A
 * DOCUMENTATION SITE: a folder the `docs` class names is held back only where it shows a site (docs-site.ts), and one
 * that does not is read and goes into `cleared`, exactly as a vendored candidate that fails its origin test does.
 */
export const SITE_TESTED_CLASSES: ReadonlySet<string> = new Set(["docs"]);

/** Every class whose name only nominates a folder, and whose patterns are therefore tested with the cleared folders masked. */
export const NAME_NOMINATED_CLASSES: ReadonlySet<string> = new Set([...ORIGIN_TESTED_CLASSES, ...SITE_TESTED_CLASSES]);

/**
 * THE FOLDERS A TOOL WRITES, BY NAME: the one list, the walker's GENERATED_DIRS (walk.ts, which says what it does with
 * them) and the names the `refused-by-rule` sentence lists, so the two cannot disagree.
 */
export const MACHINE_WRITTEN_FOLDERS: readonly string[] = [
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt",
  "coverage", "vendor", ".venv", "venv", "__pycache__", ".turbo", ".cache",
];

/** A folder named like a class in ORIGIN_TESTED_CLASSES that the walker read, and why. */
export interface ReadDespiteName {
  class: string;
  /** The folder, relative to the scan root. */
  dir: string;
  /**
   * Files the walker passed on to be read beneath it, each counted once, under the deepest folder of this list that
   * holds it (walk.ts). A file held back or refused beneath it is not counted, so no file is counted both as read here
   * and as not read elsewhere; `coverageLimits` takes off the files the engine then could not read.
   */
  files: number;
  /**
   * Vendored: no third-party origin, or files that import the project's own. Documentation sites: the product's code outside it imports it, depends on it or names it as its
   * package's entry point (docs-usage.ts), or it holds neither prose nor program source.
   */
  why: "no-third-party-origin" | "imports-project-modules" | "no-site-sign" | "used-by-product";
  /** How many folders inside it, named like the class on their own, its test left out (they are decided on their own). */
  nested?: number;
}

/** A folder named like a documentation site that the site test held, and why (docs-site.ts). */
export interface HeldAsSite {
  class: string;
  dir: string;
  why: "site-generator" | "unused-source" | "prose" | "unlisted";
  evidence: string;
}

/**
 * Folders by their segments, each looked up in one step per segment of a path: building and looking up every prefix
 * of a path instead costs its depth times its length, which a deep tree turns into minutes.
 */
export class FolderTrie<T> {
  private readonly top: TrieNode<T> = { next: new Map() };
  private count = 0;
  get size(): number {
    return this.count;
  }
  set(dir: string, value: T): void {
    let node = this.top;
    for (const seg of dir.split("/")) {
      let child = node.next.get(seg);
      if (child === undefined) {
        child = { next: new Map() };
        node.next.set(seg, child);
      }
      node = child;
    }
    if (!("value" in node)) this.count++;
    node.value = value;
  }
  /** For each segment of `parts`, in order, the value of the folder it ends where the trie holds one. */
  along(parts: readonly string[], each: (index: number, value: T) => void): void {
    let node: TrieNode<T> | undefined = this.top;
    for (let i = 0; i < parts.length; i++) {
      node = node.next.get(parts[i] as string);
      if (node === undefined) return;
      if ("value" in node) each(i, node.value as T);
    }
  }
}
interface TrieNode<T> {
  next: Map<string, TrieNode<T>>;
  value?: T;
}

/** What the read scope is told of the folders the walker tested and read: how many, and the masked path. */
export interface ClearedMask {
  readonly size: number;
  mask(relPath: string): string;
}

/**
 * The folders the walker tested and read (ORIGIN_TESTED_CLASSES). `mask` gives `relPath` with every segment that ends a
 * cleared folder replaced by a NUL, which no pattern of these sets can match: the cleared folder's own name stops
 * matching, and every other segment, a nested `third_party/` inside it included, is tested as before. Linear in the path.
 */
export class ClearedFolders implements ClearedMask {
  private readonly trie = new FolderTrie<true>();
  get size(): number {
    return this.trie.size;
  }
  add(dir: string): void {
    this.trie.set(dir, true);
  }
  mask(relPath: string, also?: string): string {
    const parts = relPath.split("/");
    const masked = [...parts];
    this.trie.along(parts, (i) => {
      masked[i] = "\u0000";
    });
    if (also !== undefined && (relPath === also || relPath.startsWith(`${also}/`))) masked[also.split("/").length - 1] = "\u0000";
    return masked.join("/");
  }
  /**
   * A new set of the folders of this one that lie on the way to `dir` or are `dir`: what decides a path beneath `dir`
   * (walk.ts `reScanReads`, which walks beneath it and adds folders of its own).
   */
  along(dir: string): ClearedFolders {
    const out = new ClearedFolders();
    const parts = dir.split("/");
    this.trie.along(parts, (i) => out.add(parts.slice(0, i + 1).join("/")));
    return out;
  }
  /** These folders and one more, without a copy. */
  with(dir: string): ClearedMask {
    return { size: this.size + 1, mask: (relPath) => this.mask(relPath, dir) };
  }
}

/** The path a class is tested on: masked for a class a folder name only nominates, as it is for every other class. */
function testedPath(c: ReadScopeClass, relPath: string, cleared?: ClearedMask): string {
  return cleared !== undefined && cleared.size > 0 && NAME_NOMINATED_CLASSES.has(c.id) ? cleared.mask(relPath) : relPath;
}

/**
 * Whether a class of SITE_TESTED_CLASSES, READ IN THIS RUN OR NOT, names the
 * folder `relDir` with the cleared folders masked: the folder is then a candidate the documentation-site test decides, in
 * every run alike, so the class its places carry does not depend on `--read`.
 */
export function siteCandidateClass(scope: ReadScope, relDir: string, cleared?: ClearedMask): string | null {
  for (const c of scope.classes) {
    if (!SITE_TESTED_CLASSES.has(c.id)) continue;
    const probe = `${testedPath(c, relDir, cleared)}/\u0000`;
    for (const re of c.compiled) if (re.test(probe)) return c.id;
  }
  return null;
}

/**
 * The class of ORIGIN_TESTED_CLASSES (not read in this run) that nominates `relDir` by the folder's own name, whatever
 * its parents are called; null where none does. Every parent is masked, as if each had been tested and read.
 */
export function nominatedByOwnName(scope: ReadScope, relDir: string): string | null {
  const parts = relDir.split("/");
  const probe = `${parts.map((seg, i) => (i === parts.length - 1 ? seg : "\u0000")).join("/")}/\u0000`;
  for (const c of scope.classes) {
    if (c.read || !ORIGIN_TESTED_CLASSES.has(c.id)) continue;
    for (const re of c.compiled) if (re.test(probe)) return c.id;
  }
  return null;
}

/**
 * The class, read in this run or not, whose patterns name the folder `relDir` by its own name, whatever its parents are
 * called; null where none does. The walker asks it of a folder a tool writes (walk.ts `folderKind` "generated"): a
 * class that names one decides it, held back unless its `--read` is given, and a folder no class names is never read.
 */
export function classNamingFolder(scope: ReadScope, relDir: string): string | null {
  const parts = relDir.split("/");
  const probe = `${parts.map((seg, i) => (i === parts.length - 1 ? seg : "\u0000")).join("/")}/\u0000`;
  for (const c of scope.classes) for (const re of c.compiled) if (re.test(probe)) return c.id;
  return null;
}

/**
 * Whether any class holds this path back, and which. `null` = the path is in scope. `cleared` holds the
 * folders the walker tested and read (ORIGIN_TESTED_CLASSES); a run without it decides exactly as before.
 */
export function heldBackBy(scope: ReadScope, relPath: string, cleared?: ClearedMask): string | null {
  for (const c of scope.classes) {
    if (c.read) continue;
    const p = testedPath(c, relPath, cleared);
    for (const re of c.compiled) if (re.test(p)) return c.id;
  }
  return null;
}

/**
 * Whether every path under `dir` is held back by the class that holds `dir` back.
 *
 * WHY THE NUL. A regular expression that matches inside the string `dir/` also matches inside
 * `dir/anything`, because the same occurrence is still there — UNLESS the match reached the end of
 * the string through `$`, which `dir/anything` does not have at that point. Appending a character
 * that can appear in no path and in no pattern of these sets is what tells the two apart: a class
 * that still matches `dir/\0` matched without the end anchor, so it matches every descendant, and
 * the whole tree can be declined at the directory instead of file by file. A class that only matches
 * `dir/` relied on `$` and the tree is walked normally, each file tested on its own.
 *
 * This is what makes the read scope cost nothing on a large tree — a 12,000-file `node_modules`-sized
 * test tree is one `readdirSync` and a count, not 12,000 regex passes — without ever declining a file
 * the per-file test would have kept.
 */
export function wholeTreeHeldBackBy(scope: ReadScope, relDir: string, cleared?: ClearedMask): string | null {
  for (const c of scope.classes) {
    if (c.read) continue;
    const probe = `${testedPath(c, relDir, cleared)}/\u0000`;
    for (const re of c.compiled) if (re.test(probe)) return c.id;
  }
  return null;
}

/** The counts one class held back, as the walker recorded them. */
interface ClassCount {
  directories: number;
  files: number;
}

const NOT_CONFIGURABLE = "There is no option that opens them";

/** `n` with thousands separators, so a six-figure file count is readable at a glance. */
/**
 * The walker's reasons about what stood at a path, each as the kind a person reads: the one list of them (walk.ts
 * `NAMED_IN_FULL` is its keys). The last three are the walker's own bounds.
 */
export const NOT_REGULAR_WORDS: Readonly<Record<string, string>> = {
  "named-pipe": "a named pipe",
  socket: "a socket",
  device: "a device",
  "link-to-folder": "a symbolic link to a folder, not followed",
  "link-to-nothing": "a symbolic link that leads nowhere",
  "link-to-outside": "a symbolic link to a file outside the scanned folder, not read",
  "could-not-open": "could not be opened",
  "link-not-followed": "a symbolic link not followed, because resolving it would pass the work the scan allows for symbolic links; not read",
  "name-not-utf8": "a name that is not valid UTF-8, so the scan cannot name it to open it; not read",
  "link-path-too-long":
    "a symbolic link not followed, because a path on the way to what it names is longer than the system takes (4,095 bytes), so the scan cannot see where it leads; not read",
};

function n(value: number): string {
  return value.toLocaleString("en-US");
}

function plural(count: number, one: string, many: string): string {
  return `${n(count)} ${count === 1 ? one : many}`;
}

/**
 * (and D4) WHAT THE SCANNER REFUSES BY RULE, ONE
 * COMPUTATION over the walker's own rows, for this member's sentence (the scan's own section and not-checked.md) and for
 * every screen's "Not read" (progress.ts `foldersNotReadOf`). Two tallies of it disagreed: the screens added the dependency
 * lock files (and the test files refused by name) into the count they worded as "N files in the <named> folders", and
 * this sentence counted WolfBoy's own working folder (`.legal`, the scan's own records, never the project's) among the
 * directories the project was not read in. The folders are counted and named from their rows, `.legal` at the scanned
 * folder's root apart; the files refused by name are counted apart, by kind.
 */
export const OWN_WORKING_FOLDER = ".legal";
const REFUSED_DIR_REASONS: ReadonlySet<string> = new Set(["generated-directory", "hidden-directory", "non-production-directory"]);
export interface RefusedByRule {
  /** The folders refused by rule, `.legal` at the root left out, most files first: each with its files (null: not counted). */
  folders: { dir: string; files: number | null }[];
  /** The files counted in those folders. */
  folderFiles: number;
  /** How many of those folders the walker did not count the files of. */
  uncounted: number;
  /** Dependency lock files (`generated-file`), refused by their names wherever they stand. */
  lockFiles: number;
  /** Test and story files refused by their names (`non-production-file`). */
  testFiles: number;
  /** `.legal`'s files where the walker met it at the root (null: it did not, or did not count them). */
  own: number | null;
}
/**
 * WolfBoy's own working folder at the scanned
 * folder's top (its records), which no count of what was not read includes; a `.legal` deeper down is another project's
 * and is counted. One test for every count (`refusedByRuleOf`, scan.ts `walkerReasonParts`).
 */
export const isOwnWorkingFolder = (dir: string): boolean => dir === OWN_WORKING_FOLDER || dir.startsWith(`${OWN_WORKING_FOLDER}/`);
export function refusedByRuleOf(rows: readonly { reason?: string; dir?: string; files?: number | null }[]): RefusedByRule {
  const own = isOwnWorkingFolder;
  const byDir = new Map<string, number | null>();
  let ownFiles: number | null = null;
  let lockFiles = 0;
  let testFiles = 0;
  for (const r of rows) {
    const reason = String(r.reason ?? "");
    if (reason === "generated-file") lockFiles += r.files ?? 0;
    else if (reason === "non-production-file") testFiles += r.files ?? 0;
    if (!REFUSED_DIR_REASONS.has(reason) || typeof r.dir !== "string" || r.dir === "") continue;
    const files = typeof r.files === "number" ? r.files : null;
    if (own(r.dir)) {
      if (files !== null) ownFiles = (ownFiles ?? 0) + files;
      continue;
    }
    const had = byDir.get(r.dir);
    byDir.set(r.dir, had === undefined ? files : had === null || files === null ? (had ?? files) : had + files);
  }
  const folders = [...byDir].map(([dir, files]) => ({ dir, files })).sort((x, y) => (y.files ?? 0) - (x.files ?? 0) || (x.dir < y.dir ? -1 : 1));
  return {
    folders,
    folderFiles: folders.reduce((sum, f) => sum + (f.files ?? 0), 0),
    uncounted: folders.filter((f) => f.files === null).length,
    lockFiles,
    testFiles,
    own: ownFiles,
  };
}
/** The member's sentence, from `refusedByRuleOf`; `what` names the kinds of path refused (the scan names this run's folders). */
export function refusedByRuleSentence(r: RefusedByRule, what: string): string {
  const files = r.lockFiles + r.testFiles;
  const ownWords = r.own === null ? "" : ` WolfBoy's own ${OWN_WORKING_FOLDER} folder (${plural(r.own, "file", "files")}, this scan's own records) is not counted here.`;
  if (r.folders.length === 0 && files === 0) return `Paths the scanner refuses by rule: none in this tree. ${NOT_CONFIGURABLE}.${ownWords}`;
  // A part that holds nothing is left out ("1 directory holding files not counted, and 0 files"). "1 directory holding 1 file", never "1 files".
  const held = r.folderFiles === 0 && r.uncounted > 0 ? "files not counted" : `${n(r.folderFiles)}${r.uncounted > 0 ? "+" : ""} ${r.folderFiles === 1 && r.uncounted === 0 ? "file" : "files"}`;
  const parts = [r.folders.length > 0 ? `${plural(r.folders.length, "directory", "directories")} holding ${held}` : "", files > 0 ? plural(files, "file", "files") : ""].filter(Boolean);
  return `Paths the scanner refuses by rule: ${parts.join(", and ")} — ${what}. ${NOT_CONFIGURABLE}.${ownWords}`;
}

/** How many folders read despite their names a sentence names before it says "and N more". */
const NAMED_FOLDERS_SHOWN = 10;

/**
 * The sentence for the folders a class's name nominated and the walker read anyway (H6), after the class's own
 * sentence and its lift, so that "Add --read <class> to read them" keeps meaning what was held back (a class that held
 * nothing back carries no such instruction, because there is nothing to read). Each reason has a
 * clause of its own that names its own folders, and the count is of the files actually read under them, so it never
 * repeats a file the class's own sentence counts as not read.
 *
 * A folder whose test left out a folder inside it named like the class (`nested`: that one is decided on its own, and
 * may be another project's) is said to show nothing of another project only once that folder is set aside, so the
 * sentence stays true whatever was decided inside it.
 */
function readDespiteNameSentence(noun: string, named: ReadDespiteName[], filesRead: number): string {
  const one = named.length === 1;
  const clause = (why: ReadDespiteName["why"], withNested: boolean): string | null => {
    const group = named.filter((r) => r.why === why && (why !== "no-third-party-origin" || (r.nested ?? 0) > 0 === withNested));
    const dirs = group.map((r) => r.dir.replace(/\\/g, "/")).sort();
    if (dirs.length === 0) return null;
    const single = dirs.length === 1;
    const shown = dirs.slice(0, NAMED_FOLDERS_SHOWN).map((d) => `\`${d}\``);
    const more = dirs.length - shown.length;
    const list =
      more > 0
        ? `${shown.join(", ")} and ${n(more)} more`
        : shown.length === 1
          ? (shown[0] as string)
          : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1] as string}`;
    if (why === "imports-project-modules") return `${list}, because ${single ? "its" : "their"} files import this project's own code`;
    // DRAFT wording. DRAFT wording.
    if (why === "used-by-product")
      return `${list}, because code of this project outside ${single ? "it" : "them"} imports ${single ? "it" : "them"}, depends on ${single ? "it" : "them"} or names ${single ? "it" : "them"} as its package`;
    if (why === "no-site-sign") return `${list}, because ${single ? "it holds" : "they hold"} neither prose nor program source`;
    if (!withNested) return `${list}, because nothing in ${single ? "it" : "them"} shows that the code came from another project`;
    const k = group.reduce((sum, r) => sum + (r.nested ?? 0), 0);
    return (
      `${list}, because, leaving aside ${plural(k, "directory", "directories")} inside ${single ? "it" : "them"} ` +
      `that ${k === 1 ? "is" : "are"} also named like ${noun.toLowerCase()}, nothing in ${single ? "it" : "them"} shows that the code came from another project`
    );
  };
  const clauses = [
    clause("no-third-party-origin", false),
    clause("no-third-party-origin", true),
    clause("imports-project-modules", false),
    clause("used-by-product", false),
    clause("no-site-sign", false),
  ].filter((c): c is string => c !== null);
  const count =
    filesRead === 0
      ? `No file in ${one ? "it" : "them"} was read.`
      : `${plural(filesRead, "file", "files")} in ${one ? "it" : "them"} ${filesRead === 1 ? "was" : "were"} read.`;
  return `${plural(named.length, "directory", "directories")} named like ${noun.toLowerCase()} ${one ? "was" : "were"} read: ${clauses.join("; ")}. ${count}`;
}

/**
 * Why a documentation site built as an application was held: it shows no site
 * generator, so the sentence names each folder holding program source that nothing of the product uses. DRAFT wording.
 */
function unusedSourceSentence(held: readonly HeldAsSite[]): string {
  const dirs = held.filter((h) => h.why === "unused-source").map((h) => h.dir.replace(/\\/g, "/")).sort();
  if (dirs.length === 0) return "";
  const single = dirs.length === 1;
  const shown = dirs.slice(0, NAMED_FOLDERS_SHOWN).map((d) => `\`${d}\``);
  const more = dirs.length - shown.length;
  const list =
    more > 0 ? `${shown.join(", ")} and ${n(more)} more` : single ? (shown[0] as string) : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1] as string}`;
  const them = single ? "it" : "them";
  return ` ${list} ${single ? "holds" : "hold"} program source that no code of this project outside ${them} imports, depends on or names as its package, so ${single ? "it was" : "they were"} held as ${single ? "a documentation site" : "documentation sites"}.`;
}

/** The files read under the folders read despite their name: the walker's count, less those the engine could not read. */
function filesReadDespiteName(named: ReadDespiteName[], filesNotRead: { file: string }[]): number {
  if (named.length === 0) return 0;
  const dirs = new FolderTrie<true>();
  for (const r of named) dirs.set(r.dir.replace(/\\/g, "/"), true);
  // One step per segment of each path (FolderTrie), so the cost grows neither with the number of folders nor with depth.
  const under = (p: string): boolean => {
    const parts = p.split("/");
    let found = false;
    dirs.along(parts.slice(0, -1), () => {
      found = true;
    });
    return found;
  };
  const unread = new Set(filesNotRead.map((r) => r.file.replace(/\\/g, "/")).filter(under));
  return Math.max(0, named.reduce((sum, r) => sum + r.files, 0) - unread.size);
}

/**
 * THE MODEL. Built once per scan, from the document's own numbers and from nothing else, so every
 * member is checkable against the fields beside it rather than against a second tally.
 */
export function coverageLimits(input: {
  scope: ReadScope;
  bundleDeclaresReadScope: boolean;
  excluded: WalkerExclusion[];
  filesNotRead: Findings["files_not_read"];
  filesPartiallyRead: Findings["files_partially_read"];
  commentSyntaxUnregistered: number;
  /** Files read from UTF-16, and files read with bytes that are not UTF-8 (engine.ts `FileRecord.readAs`); absent is 0. */
  filesReadFromUtf16?: number;
  filesReadNotUtf8?: number;
  maxFileBytes: number;
  lineLimit: number;
  /**
   * The per-file wall-clock budget this run used, in milliseconds, or `Infinity` for none. Read only
   * to word the sentence when the budget actually stopped something; a run where it stopped nothing
   * produces the same member, byte for byte, whatever this says.
   */
  fileBudgetMs: number;
  rulesRun: number;
  rulesInBundle: number;
  narrowedTo: string[] | null;
  unansweredPreconditions: number;
  declaredInapplicable: number;
  profileGiven: boolean;
  rulesSilent: number;
  /**
   * The folders named like a class in ORIGIN_TESTED_CLASSES that the walker read because the tree did not show
   * them to be another project's (`WalkResult.readDespiteName`). Absent or empty, every member is what it was.
   */
  readDespiteName?: ReadDespiteName[];
  /** The folders the documentation-site test held, and why (`WalkResult.heldAsSite`). */
  heldAsSite?: HeldAsSite[];
  /**
   * The classes whose `--read` would read at least one file more (`WalkResult.reScanReads`, decided by the walker's own
   * code in the re-scan's setting), and those its probes could not decide within their limit (walk.ts, THE OFFER PROBES'
   * INVARIANT: undecided means offered). They decide the offer and `lift` only. Absent (no walk), a class that held a file
   * back offers its `--read`.
   */
  reScanReads?: readonly string[];
  /**
   * The files the walker held back as vendored
   * code by their content (`WalkResult.heldByContent`). Absent or empty, every member is what it was.
   */
  heldByContent?: readonly { file: string; evidence: string }[];
}): CoverageLimits {
  const limits: CoverageLimit[] = [];

  // ---- 1. The read scope, one member per class the bundle declares ---------------------------
  const perClass = new Map<string, ClassCount>();
  for (const e of input.excluded) {
    const classId = readScopeClassOfReason(e.reason);
    if (classId === null) continue;
    const c = perClass.get(classId) ?? { directories: 0, files: 0 };
    c.directories += 1;
    c.files += e.files ?? 0;
    perClass.set(classId, c);
  }
  for (const cls of input.scope.classes) {
    const counted = perClass.get(cls.id) ?? { directories: 0, files: 0 };
    const wording = CLASS_WORDING[cls.id];
    const noun = wording?.noun ?? cls.id;
    const verb = wording?.verb ?? "was";
    const flag = toldArgs(["--read", cls.id]);
    const named = cls.read ? [] : (input.readDespiteName ?? []).filter((r) => r.class === cls.id);
    // [standing product decision, 2026-10-30] No instruction to read what a re-scan would not read: the offer stands
    // where the class held a file back AND a re-scan with its `--read` would read a file more, or the walker could not tell
    // (walk.ts `reScanReads`, undecided means offered). The number shown is every file under the folders held, as before
    // H6, whether or not the offer stands.
    const offered = !cls.read && counted.files > 0 && (input.reScanReads === undefined || input.reScanReads.includes(cls.id));
    const namedFiles = filesReadDespiteName(named, input.filesNotRead ?? []);
    // Of the files held back, those the walker recognised by their own content and
    // not by any pattern: the sentence names them apart, so "matching the pattern sets" stays true of the rest.
    const byContent = cls.read || cls.id !== "vendored" ? 0 : (input.heldByContent ?? []).length;
    const byName = counted.files - byContent;
    const matchedWords =
      byContent === 0
        ? `matching the ${cls.sets.length} pattern set(s) of rules/path-exclusions/${cls.source}`
        : `${byName > 0 ? `${plural(byName, "file", "files")} matching the ${cls.sets.length} pattern set(s) of rules/path-exclusions/${cls.source} and ` : ""}` +
          // Every one of them is named, with its
          // sign, in this member's `held_by_content`; `excluded_by_walker` keeps three examples per directory.
          `${plural(byContent, "file", "files")} whose own text shows another project's code (its banner, a bundler's wrapper or a source-map trailer; each named with its sign in held_by_content)`;
    // A run that read every class (`--read all`,
    // or each class named) is not told that one class's own flag was given: it may not have been.
    const everyClassRead = input.scope.classes.length > 1 && input.scope.classes.every((c) => c.read);
    const sentence = cls.read
      ? `${noun} ${verb} read: ${everyClassRead ? "every class was read in this scan (--read all, or each class named)" : `${flag} was given`}, so the ${cls.sets.length} pattern set(s) of ` +
        `rules/path-exclusions/${cls.source} held nothing back in this scan.`
      : counted.files === 0 && counted.directories === 0
        ? named.length === 0
          ? `${noun} ${verb} not read: no path in this tree matched the ${cls.sets.length} pattern set(s) of ` +
            `rules/path-exclusions/${cls.source}, so nothing was held back on this account.`
          : `${noun} ${verb} not read: no directory in this tree that matched the ${cls.sets.length} pattern set(s) of ` +
            `rules/path-exclusions/${cls.source} was held back as ${noun.toLowerCase()}. ` +
            readDespiteNameSentence(noun, named, namedFiles)
        : `${noun} ${verb} not read: ${plural(counted.files, "file", "files")} in ` +
          `${plural(counted.directories, "directory", "directories")}, ${matchedWords}` +
          (wording ? ` — ${wording.consequence}` : "") +
          // [standing product decision, 2026-10-30] No instruction to read what was not held back: a directory that
          // matched with no file in it (an uninitialised submodule), or whose files no re-scan would read, carries none.
          (offered ? `. Add ${flag} to read them.` : ".") +
          (cls.id === "docs" ? unusedSourceSentence(input.heldAsSite ?? []) : "") +
          (named.length === 0 ? "" : ` ${readDespiteNameSentence(noun, named, namedFiles)}`);
    limits.push({
      id: `read-scope:${cls.id}`,
      read: cls.read,
      counts: {
        directories: counted.directories,
        files: counted.files,
        ...(byContent === 0 ? {} : { files_by_content: byContent }),
        ...(named.length === 0 ? {} : { directories_read_despite_name: named.length, files_in_directories_read_despite_name: namedFiles }),
      },
      patterns_set: cls.sets,
      patterns_source: `rules/path-exclusions/${cls.source}`,
      ...(byContent === 0 ? {} : { held_by_content: (input.heldByContent ?? []).map((h) => ({ file: h.file.replace(/\\/g, "/"), evidence: h.evidence })) }),
      // [standing product decision, 2026-10-30] Where no re-scan with `--read` would read anything more (the class was
      // read, nothing matched it, what matched holds no file, or no file a re-scan would read), no renderer may offer
      // one: `lift` is null, as the sentence carries no instruction (`offered` above).
      lift: offered ? flag : null,
      sentence,
    });
  }
  if (input.scope.classes.length === 0) {
    limits.push({
      id: "read-scope:none",
      counts: {},
      lift: null,
      sentence: input.bundleDeclaresReadScope
        ? "Read scope: this bundle declares no class of path that a scan may be told not to read, so nothing was held back on that account."
        : "Read scope: this bundle was built before the scan had a read scope, so no class of path was held back and no option can change that. Rebuild the bundle to get the default that does not read test surfaces, vendored code or build output.",
    });
  }

  // ---- 2. What the walker refuses by rule -----------------------------------------------------
  //
  // The two reason families are counted apart and stated in one sentence, because the reader's
  // question is one question — what did the walk never look inside — and because a directory count
  // and a file count are different units that must never be added. `files: null` is a tree the
  // walker deliberately did not enumerate (counting `node_modules` costs more than the number is
  // worth); it is reported as `+` rather than folded into the number, so "not counted" is never read
  // as "nothing there".
  const dirReasons = REFUSED_DIR_REASONS;
  const fileReasons = new Set(["generated-file", "non-production-file"]);
  let refusedDirs = 0;
  let refusedDirFiles = 0;
  let refusedDirFilesUncounted = false;
  let refusedFiles = 0;
  for (const e of input.excluded) {
    if (readScopeClassOfReason(e.reason) !== null) continue;
    if (dirReasons.has(e.reason)) {
      refusedDirs += 1;
      if (e.files === null) refusedDirFilesUncounted = true;
      else refusedDirFiles += e.files;
    } else if (fileReasons.has(e.reason)) {
      refusedFiles += e.files ?? 0;
    }
  }
  limits.push({
    id: "refused-by-rule",
    counts: {
      directories: refusedDirs,
      files_in_directories: refusedDirFiles,
      files: refusedFiles,
      directories_not_enumerated: refusedDirFilesUncounted ? 1 : 0,
    },
    lift: null,
    // The counts above stay the walker's (every path refused by rule); the sentence is
    // `refusedByRuleOf`'s, which leaves WolfBoy's own `.legal` out and names it apart.
    sentence: refusedByRuleSentence(
      refusedByRuleOf(input.excluded.filter((e) => readScopeClassOfReason(e.reason) === null)),
      // Only the machine-written names no class
      // of this run names: a class's own names are its to hold or read, and a sentence listing them here said `--read`
      // could not open what it can.
      `machine-written trees and files (${MACHINE_WRITTEN_FOLDERS.filter((f) => classNamingFolder(input.scope, f) === null).join(", ")}, ` +
        `and dependency lock files) and dot-directories other than .well-known and .github`,
    ),
  });

  // ---- 3. What could not be read as code ------------------------------------------------------
  //
  // Three different failures in one member because they answer one question — which bytes under this
  // target no rule was ever shown — and each keeps its own unit inside it. The third is the quiet
  // one: a file whose extension this engine has no comment syntax for is read WHOLE, and its
  // comments are read as code, so a line that says "we do not delete anything" can be matched as
  // though the product did it. That is a hole, and a hole nobody counts is a hole nobody closes.
  const unreadableReasons = new Set([
    "binary-extension",
    "binary-content",
    "size-limit",
    "extension-not-scanned",
  ]);
  let unreadable = 0;
  for (const e of input.excluded) {
    if (unreadableReasons.has(e.reason)) unreadable += e.files ?? 0;
  }
  const notRead = (input.filesNotRead ?? []).length;
  const partial = input.filesPartiallyRead ?? [];
  // `p.lines` is OPTIONAL from 2026-09-16: a row that is here for the time budget alone carries no
  // blanked lines, and writing it as an empty array would have stated a ceiling measurement nobody
  // took (see `PartiallyReadFile`). A time-only row therefore contributes 0 here, which keeps
  // `lines_left_out` the count of lines the MINIFICATION CEILING took and nothing else.
  const blankedLines = partial.reduce((sum, p) => sum + (p.lines?.length ?? 0), 0);
  // THE FILES THE CEILING TOUCHED, as against the files in the array. The two were the same number
  // until 2026-09-16 and the SENTENCE below was left reading `partial.length` when the budget's rows
  // joined the array — so a tree whose only partial row was a time stop printed "1 file was read with
  // 0 lines left out for exceeding 5,000 characters" about a file that had no over-long line at all. The COUNT `files_read_in_part` keeps
  // both populations, deliberately and as it always did: its question is "how many files were read in
  // part", which a time stop answers as much as the ceiling does. The sentence names them separately
  // because a sentence has to say WHY, and the two whys are different.
  const ceilingPartial = partial.filter((p) => p.lines !== undefined).length;
  /**
 * The budget as a reader should meet it in a sentence — never "0-second".
 *
 * `Math.round(ms / 1000)` alone renders every budget under half a second as `0-second`, which states
 * a budget that would read nothing and that `resolveFileBudgetMs` refuses outright (independent
 * verification note F2, 2026-09-16). Below a second the honest unit is the millisecond, which is also
 * the unit the document itself carries (`budget_ms`), so the sentence and the record agree.
 */
function budgetInWords(budgetMs: number): string {
  if (budgetMs >= 1000) return `${n(Math.round(budgetMs / 1000))}-second`;
  return `${n(budgetMs)}-millisecond`;
}

// ---- the per-file time budget, read off the same two arrays ------------------------------------
  //
  // The fourth way a file can fail to be read as code, and it joins this member rather than becoming
  // a `coverage_limits` member of its own: the id list is pinned by the schema and the SARIF alert's
  // identity is derived from it, so a new id would close and re-open alerts on a tree nobody touched
  // (design §D.4). It belongs here on the reading, too — the member's question is "which bytes under
  // this target did no rule see", and a file the clock stopped part-way through is exactly that.
  const stoppedPartial = partial.filter((p) => p.stopped_for_time !== undefined);
  // Files every rule read line by line whose structural (parse-tree) reading passed its time
  // allowance. A row of `files_partially_read` like the two causes above, so already in
  // `files_read_in_part`; the sentence names it only when there is one.
  const structuralStopped = partial.filter((p) => p.structural_reading_stopped !== undefined).length;
  const stoppedWhole = (input.filesNotRead ?? []).filter((n) => n.reason === "time-budget").length;
  const stoppedFiles = stoppedPartial.length + stoppedWhole;
  // Lines the interrupted rule did not reach, summed over the files it stopped. A LINE-UNIT COUNT
  // BESIDE A FILE-UNIT ONE, like `lines_left_out` beside `files_read_in_part`, and never added to
  // it: those lines were read by no rule at all, these were read by every rule that had already
  // finished the file. The whole-file stops contribute nothing here, because no rule read a line of
  // them and `read_to_no_rule` already counts the file.
  const linesNotReadForTime = stoppedPartial.reduce(
    (sum, p) => sum + ((p.stopped_for_time?.lines_total ?? 0) - (p.stopped_for_time?.lines_read ?? 0)),
    0,
  );
  // WHAT STOOD AT THE PATH WAS NOT A REGULAR FILE, OR COULD NOT BE OPENED: a
  // named pipe, a socket, a device, a link to a folder or to nothing, an entry the walker could not open. Kept out of
  // `refused_by_the_walker`, whose sentence says "binary or over N bytes", and counted under its own name only where
  // there is one, so a tree with none writes this member byte for byte as before. Each is named here with its kind
  // (the first ten; every one is in excluded_by_walker): a scan that reads less must say what it did not read.
  const notRegularRows = input.excluded.filter((e) => NOT_REGULAR_WORDS[e.reason] !== undefined);
  // A ROW THAT NAMES ITS OWN FOLDER (its one example is its `dir`) is a folder: one whose files were not counted, or a
  // folder whose name is not valid UTF-8, whose files the walker counted by their bytes and did not read. Said here with
  // that count, so the sentence says how many files below it were not read and its parent's count stays its own.
  const folderWords = (e: WalkerExclusion, x: string): string =>
    e.files === null ? ", a folder whose files were not counted" : x === e.dir ? `, a folder whose ${plural(e.files, "file was", "files were")} not read` : "";
  const notRegularNamed = notRegularRows.flatMap((e) => e.examples.map((x) => `\`${x}\` (${NOT_REGULAR_WORDS[e.reason]}${folderWords(e, x)})`));
  const notRegular = notRegularNamed.length;
  // A GIT LFS POINTER, named in full
  // with what it means: the content was never checked out, so nothing of the file was read. And the files whose bytes
  // were not plain UTF-8: read from UTF-16 whole, or read with U+FFFD in place of the bytes that are not UTF-8. Each is
  // counted only where there is one, so a tree with none writes this member byte for byte as before.
  const lfsNamed = input.excluded.filter((e) => e.reason === "git-lfs-pointer").flatMap((e) => e.examples.map((x) => `\`${x}\``));
  const lfs = lfsNamed.length;
  const utf16 = input.filesReadFromUtf16 ?? 0;
  const notUtf8 = input.filesReadNotUtf8 ?? 0;
  const nothingHere =
    unreadable === 0 && notRead === 0 && partial.length === 0 && input.commentSyntaxUnregistered === 0 && notRegular === 0 && lfs === 0 && notUtf8 === 0;
  limits.push({
    id: "not-readable-as-code",
    counts: {
      refused_by_the_walker: unreadable,
      read_to_no_rule: notRead,
      files_read_in_part: partial.length,
      lines_left_out: blankedLines,
      comment_syntax_unregistered: input.commentSyntaxUnregistered,
      // ADDED ONLY WHEN THE BUDGET STOPPED SOMETHING, for the reason `stats.files_stopped_for_time`
      // is: a scan in which no file overran writes the block it wrote before the budget existed,
      // byte for byte, and both counts are recoverable from the arrays this member reads. They
      // OVERLAP with `files_read_in_part` on purpose and are not a decomposition of it — a stopped
      // file is a row of `files_partially_read` like any other — which is why each says its own unit
      // in its own name.
      ...(stoppedFiles > 0
        ? { files_stopped_for_time: stoppedFiles, lines_not_read_for_time: linesNotReadForTime }
        : {}),
      ...(notRegular > 0 ? { entries_not_regular_or_not_opened: notRegular } : {}),
      ...(lfs > 0 ? { git_lfs_pointers_not_read: lfs } : {}),
      ...(utf16 > 0 ? { files_read_from_utf16: utf16 } : {}),
      ...(notUtf8 > 0 ? { files_read_with_bytes_not_utf8: notUtf8 } : {}),
    },
    // The one thing in this member a person can change, and only when it did something: the walker's
    // refusals, the ceiling and the unregistered comment syntaxes have no option at all, which is
    // what `null` says here on every other run.
    lift:
      stoppedFiles === 0 ? null : "re-run with --file-budget <seconds> for a longer budget, or --file-budget off",
    sentence: nothingHere
      ? "Files that could not be read as code: none in this tree. There is no option that changes this."
      : `Files that could not be read as code: ${plural(unreadable, "file was", "files were")} refused as binary or ` +
        `over ${n(input.maxFileBytes)} bytes, ${plural(notRead, "file was", "files were")} opened and read to no rule ` +
        `(named in files_not_read), ${plural(ceilingPartial, "file was", "files were")} read with ` +
        `${plural(blankedLines, "line", "lines")} left out for exceeding ${n(input.lineLimit)} characters ` +
        `(named in files_partially_read), and ${plural(input.commentSyntaxUnregistered, "file was", "files were")} ` +
        `read whole with their comments read as code, because this engine has no comment syntax registered for their ` +
        `file type.${
          stoppedFiles === 0
            ? ""
            : // THE TIME CLAUSE NAMES THE TWO POPULATIONS SEPARATELY AND NAMES ONLY THE ARRAYS THAT
              // HAVE A ROW. Until 2026-09-16 it said "leaving N lines unread" whatever the stops
              // were and pointed at both arrays whether or not either was empty — so a tree whose
              // only stop was a whole-file one read "leaving 0 lines unread … named in
              // files_partially_read and files_not_read", which is a count of nothing and a pointer
              // to an empty array. A file stopped part-way has
              // lines the interrupted rule did not reach; a file stopped before its first line has
              // no such count, because no rule read any of it and `read_to_no_rule` above has
              // already counted the file.
              ` ${plural(stoppedFiles, "file was", "files were")} stopped before being read to every rule because ` +
              `the file's own reading passed the ${budgetInWords(input.fileBudgetMs)} per-file time ` +
              `budget: ${
                stoppedPartial.length === 0
                  ? ""
                  : `${plural(stoppedPartial.length, "file was", "files were")} stopped part-way, leaving ` +
                    `${plural(linesNotReadForTime, "line", "lines")} unread by the rule that was interrupted and ` +
                    `every line unread by the rules below it (named in files_partially_read, each with the line it ` +
                    `stopped at)${stoppedWhole === 0 ? "" : ", and "}`
              }${
                stoppedWhole === 0
                  ? ""
                  : `${plural(stoppedWhole, "file was", "files were")} stopped before the first rule read the ` +
                    `first line, so no rule read any of ${stoppedWhole === 1 ? "it" : "them"} (named in ` +
                    `files_not_read)`
              }.`
        }${
          notRegular === 0
            ? ""
            : ` ${plural(notRegular, "entry was", "entries were")} never opened, because what stood at the path was not ` +
              `a regular file or could not be opened (named in excluded_by_walker): ${notRegularNamed.slice(0, 10).join(", ")}` +
              `${notRegular > 10 ? `, and ${n(notRegular - 10)} more` : ""}.`
        }${
          lfs === 0
            ? ""
            : ` ${plural(lfs, "file was", "files were")} not read because what is there is a Git LFS pointer, not the ` +
              `file's content, which was never checked out (named in excluded_by_walker; git lfs pull fetches it): ` +
              `${lfsNamed.slice(0, 10).join(", ")}${lfs > 10 ? `, and ${n(lfs - 10)} more` : ""}.`
        }${
          notUtf8 === 0
            ? ""
            : ` ${plural(notUtf8, "file was", "files were")} read with bytes that are not UTF-8 (Shift_JIS or Latin-1, ` +
              `say) read as replacement characters: patterns over ASCII text still match there, and patterns written ` +
              `in Japanese or Chinese cannot.`
        }${
          utf16 === 0 ? "" : ` ${plural(utf16, "file was", "files were")} read whole from UTF-16, as its byte-order mark says.`
        }${
          structuralStopped === 0
            ? ""
            : ` ${plural(structuralStopped, "file was", "files were")} read line by line by every rule but not ` +
              `read as a document, because the parse its structural reading needs passed the time allowed for it ` +
              `(named in files_partially_read).`
        } ${
          stoppedFiles === 0
            ? "There is no option that changes this."
            : "Only the time budget can be changed; nothing changes the rest."
        }`,
  });

  // ---- 4. Rules this run did not include, and the answers in force ----------------------------
  const narrowed = input.narrowedTo;
  const profileClause = !input.profileGiven
    ? // no type name in a sentence.
      ` No answers about the product were given, so ${plural(input.unansweredPreconditions, "rule turns", "rules turn")} on a ` +
      `question nobody answered; every one of them ran anyway, and no rule's report carries a declared answer.`
    : ` Your answers about the product leave ${plural(input.unansweredPreconditions, "rule", "rules")} turning on a question they ` +
      `do not answer and put ${plural(input.declaredInapplicable, "rule", "rules")} out of scope; every one of ` +
      `them ran anyway, and each answer is named on the rows it labels.`;
  limits.push({
    id: "rules-not-run",
    counts: {
      rules_run: input.rulesRun,
      rules_in_bundle: input.rulesInBundle,
      unanswered_preconditions: input.unansweredPreconditions,
      declared_inapplicable: input.declaredInapplicable,
    },
    rules: narrowed ?? undefined,
    lift: narrowed === null ? null : "re-run without --rules",
    sentence:
      narrowed === null
        ? `Rules run: ${n(input.rulesRun)} of ${n(input.rulesInBundle)} — every rule this bundle ships.${profileClause}`
        : `Rules run: ${n(input.rulesRun)} of ${n(input.rulesInBundle)}. The run was narrowed with --rules, so ` +
          `${n(input.rulesInBundle - input.rulesRun)} of this bundle's rules read nothing in this scan and this ` +
          `document says nothing about what they look for. Re-run without --rules to include them.${profileClause}`,
  });

  // ---- 5. Rules that ran and produced nothing -------------------------------------------------
  limits.push({
    id: "rules-silent",
    counts: { rules_silent: input.rulesSilent, rules_run: input.rulesRun },
    lift: null,
    sentence:
      `Rules that ran and produced no candidate: ${n(input.rulesSilent)} of ${n(input.rulesRun)}. A rule that ` +
      `matched nothing has not established that the construct is absent, and each one is named in ` +
      `rules_without_candidates with what it was looking for.`,
  });

  return { version: 1, limits };
}

/** The heading every renderer puts above the block, so the block is recognisable across outputs. */
export const COVERAGE_LIMITS_HEADING =
  "COVERAGE — what this scan read past, and what would open it";

/** The block, as lines, for a console or a report. One sentence per member, in model order. */
export function coverageLimitsLines(limits: CoverageLimits): string[] {
  return [COVERAGE_LIMITS_HEADING, ...limits.limits.map((l) => `  ${l.sentence}`)];
}
