/**
 * THE DEEPER CHECK'S RUNNER TABLE: the 25 test runners a deeper check of one finding can
 * write a test for, in two classes, each with its manifest reader, its test template, its name rule and its printed
 * command in a POSIX and a Windows form.
 *
 * WolfBoy runs no test. This module reads manifests (never runs a runner, a build tool or anything the folder holds) and
 * returns text: the names the test is stored and copied under, the template the deeper-check seat is given, and the
 * lines the person may run in their own terminal. The one process it can start is git, through the git runner the
 * scan already uses (`gitRunnerOrWhy`, with the folder's own settings neutralised), to ask whether git would stage an
 * in-place copy where `.legal/.gitignore` is not the program's own.
 *
 * - "in place": the runner takes the copy's path, so the copy stays beside the stored test under `.legal/deep/`.
 * - "copy in": the build compiles a test only from a folder its own settings read, so the copy goes there.
 *
 * The test is stored under its runnable name with `.held` added, a name no runner's default pattern was read to match;
 * every runner gets three lines (copy to the runnable name, run the copy, delete the copy), and the line before them
 * says that copying is the decision to run it. A copy-in folder the project does not have yet gets a line that makes it
 * before the copy and one that removes it, while empty, after the delete (rf11 D5). What the run itself leaves for the
 * test under the test's own name (a compiled class, Python's byte-code) gets a delete line after the copy's, so nothing
 * the test produced can run again unasked (rf11 I-D part 3). The printed command names no tool or package the project does not
 * itself name, apart from a runner that ships with the language: a JavaScript runner is the folder's own copy in
 * `node_modules/.bin`, and Maven and Gradle go through the project's wrapper where it has one.
 *
 * This module sits outside the closure of the verdict rules (no capture module imports it), so a change here moves no
 * verdict-rules version. The places a copy may be made, and whether a copy is still in place, are checked elsewhere,
 * from paths; this module only names them.
 */
import { lstatSync, readdirSync, type Dirent } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, posix, resolve, win32 } from "node:path";
import { parse as parseYaml } from "yaml";
import { gitRunnerOrWhy } from "./child-program.js";
import { LEGAL_DIR_NAME, LEGAL_GITIGNORE_FILE, LEGAL_GITIGNORE_TEXT } from "./legal-dir.js";
import { relativePath } from "./project-path.js";
import { declareProjectFolder, readRegularFile, readSourceText, regularKind } from "./project-read.js";

/** The two classes of the table. */
export type RunnerClass = "in place" | "copy in";

/** The 25 runners, in the table's order. */
export const RUNNER_IDS = [
  "vitest",
  "jest",
  "mocha",
  "jasmine",
  "bun",
  "deno",
  "angular-karma",
  "node-test",
  "pytest",
  "django",
  "unittest",
  "rspec",
  "minitest",
  "phpunit",
  "pest",
  "dart-test",
  "flutter",
  "go",
  "exunit",
  "maven",
  "gradle",
  "dotnet",
  "cargo",
  "swiftpm",
  "xcode",
] as const;
export type RunnerId = (typeof RUNNER_IDS)[number];

/** One row of the table, as the design gives it: the language, the runner as the program recognises it, the class. */
export interface RunnerRow {
  readonly id: RunnerId;
  readonly language: string;
  /** The runner's name in the plan's step 2 ("a test of 11 lines for vitest 2.1.4"). */
  readonly runner: string;
  readonly klass: RunnerClass;
  /** How the program recognises it, from manifests alone. */
  readonly recognisedBy: string;
}

const row = (id: RunnerId, language: string, runner: string, klass: RunnerClass, recognisedBy: string): RunnerRow => ({ id, language, runner, klass, recognisedBy });

/** The table (design 3.9, "The runner table"): 16 rows in place and 9 copy in, in the table's order. */
export const RUNNER_ROWS: readonly RunnerRow[] = [
  row("vitest", "JavaScript, TypeScript", "vitest", "in place", "vitest, named in the nearest package.json"),
  row("jest", "JavaScript, TypeScript", "jest", "in place", "jest, named in the nearest package.json"),
  row("mocha", "JavaScript, TypeScript", "mocha", "in place", "mocha, named in the nearest package.json"),
  row("jasmine", "JavaScript, TypeScript", "Jasmine", "in place", "Jasmine, without Karma"),
  row("bun", "JavaScript, TypeScript", "Bun", "in place", "Bun: bun test in the test script, or a bun.lock"),
  row("deno", "JavaScript, TypeScript", "Deno", "in place", "Deno: a deno.json or deno.jsonc"),
  row("angular-karma", "JavaScript, TypeScript", "Karma through the Angular CLI", "copy in", "Karma through the Angular CLI (@angular/cli and karma)"),
  row("node-test", "JavaScript, TypeScript", "Node's own test runner", "in place", "Node's own test runner: node --test in the test script, or a Node project that names none of the above (or only Playwright or Cypress)"),
  row("pytest", "Python", "pytest", "in place", "pytest, named in pyproject.toml, setup.cfg, tox.ini, pytest.ini, a requirements file, or a conftest.py"),
  row("django", "Python", "Django's test runner", "in place", "Django's test runner: a manage.py that sets Django's settings, and no pytest"),
  row("unittest", "Python", "unittest", "in place", "unittest, for any other Python project (it ships with Python)"),
  row("rspec", "Ruby", "RSpec", "in place", "RSpec, named in Gemfile"),
  row("minitest", "Ruby", "Minitest", "in place", "Minitest, named in Gemfile (a Rails application names it through rails), or a Ruby project with no Gemfile (it ships with Ruby)"),
  row("phpunit", "PHP", "PHPUnit", "in place", "PHPUnit, named in composer.json"),
  row("pest", "PHP", "Pest", "in place", "Pest, named in composer.json"),
  row("dart-test", "Dart", "Dart's test package", "in place", "test, named in pubspec.yaml"),
  row("flutter", "Dart", "Flutter's test runner", "in place", "Flutter: flutter_test"),
  row("go", "Go", "go test", "copy in", "go test, for any module (go.mod; it ships with Go)"),
  row("exunit", "Elixir", "ExUnit", "copy in", "ExUnit through mix test, for any Mix project (it ships with Elixir)"),
  row("maven", "Java, Kotlin", "Maven", "copy in", "Maven with JUnit 4, JUnit 5 or TestNG, named in the module's pom.xml"),
  row("gradle", "Java, Kotlin", "Gradle", "copy in", "Gradle with JUnit or TestNG, named in the module's build.gradle or build.gradle.kts"),
  row("dotnet", "C#", "dotnet test", "copy in", "dotnet test with xUnit, NUnit or MSTest: an SDK-style test project (Microsoft.NET.Test.Sdk) that references the finding's project"),
  row("cargo", "Rust", "cargo test", "copy in", "cargo test, for a crate with a library target (it ships with Rust)"),
  row("swiftpm", "Swift", "SwiftPM", "copy in", "SwiftPM with a test target in Package.swift"),
  row("xcode", "Swift, Objective-C", "Xcode", "copy in", "Xcode, where the test target's folder is a synchronized folder (Xcode 16) and a shared scheme tests that target"),
];

/** The row of `id`. */
export function runnerRow(id: RunnerId): RunnerRow {
  const r = RUNNER_ROWS.find((x) => x.id === id);
  if (r === undefined) throw new Error(`no runner row ${id}`);
  return r;
}

/** A finding's short id, as the names carry it (`7c1e02`). */
export const FINDING_ID = /^[0-9a-f]{6,12}$/;

/** The suffix that makes the stored test a name no runner collects by default. */
export const HELD_SUFFIX = ".held";

/** The stored name of a test whose runnable name is `runnable`. */
export function heldNameOf(runnable: string): string {
  return runnable + HELD_SUFFIX;
}

// ---------------------------------------------------------------------------------------------------------------
// What the person reads. Each sentence is product wording (see the record's list of draft strings).
// ---------------------------------------------------------------------------------------------------------------

/** The line before the three lines, in both classes. */
export const DECISION_LINE = "Copying it is the decision: until deleted, a watcher or test run can run it.";

/** The line before the copy line where git would stage an in-place copy. */
export const GIT_STAGE_LINE = "Git would stage the copy: your own .legal/.gitignore does not ignore it.";

/** The first line of the run lines: where the commands are run from. */
export function leadLine(runFrom: string): string {
  return `To run it yourself, in your own terminal, in ${runFrom}:`;
}

/** Why no test is written, in the plan's step 2. */
export type NoTestKind = "needs a build change" | "no runner" | "karma without the Angular CLI";

export interface NoTest {
  readonly kind: NoTestKind;
  /** For "no runner": the runner the folder would need, or null where no language was recognised. */
  readonly need: string | null;
  readonly sentence: string;
}

function noTest(kind: NoTestKind, need: string | null = null): NoTest {
  if (kind === "needs a build change") return { kind, need: null, sentence: "this folder's build compiles a new test only after its own build files change, so WolfBoy writes no test" };
  if (kind === "karma without the Angular CLI")
    return { kind, need: null, sentence: "this folder runs its tests through Karma without the Angular CLI, and Karma takes no test file on its command line, so WolfBoy writes no test" };
  return { kind, need, sentence: `this folder names no test runner WolfBoy can write for${need === null ? "" : ` (it would need ${need})`}, so it writes no test` };
}

/** The plan's note where the runner is named but not installed in the folder: the test is still written. */
export const NOT_INSTALLED_NOTE = "the runner is not installed in this folder; the command needs it, and installing the project's packages runs their own setup scripts";

const TS_NODE_NOTE = "A TypeScript test runs under Node's own runner only where your Node removes types itself or your settings load a loader; otherwise the runner's output says so.";
const CARGO_NOTE = "A test in the crate's tests folder reaches the crate's public items only.";
const SIMULATOR_NOTE = "Replace <simulator> with the name of a simulator on your computer (xcrun simctl list devices lists them).";

const DOWNLOAD_IMPORTS = "It also downloads any package or address the test itself imports.";

// ---------------------------------------------------------------------------------------------------------------
// The choice for one finding.
// ---------------------------------------------------------------------------------------------------------------

/** What the runner is, as it is in the folder: its version where the folder holds it, or that it is not there. */
export type Installed = { readonly version: string } | "not installed" | "not read";

/**
 * The table's row resolved for one finding: its class, its runnable and held names for this finding's test, the names
 * the test's text must carry, its copy place (copy in), and what is needed to print its three lines. Paths are kept
 * as segments relative to the project folder, so that `runLines` prints them in either form.
 */
export interface RunnerChoice {
  readonly row: RunnerRow;
  readonly klass: RunnerClass;
  readonly findingId: string;
  /** The finding's file, relative to the project folder. */
  readonly finding: readonly string[];
  /** The folder the run line runs from, relative to the project folder (empty: the project folder). */
  readonly runFrom: readonly string[];
  /** The manifest that named the runner, relative to the project folder, or null for a runner that ships with the language and was not named. */
  readonly namedIn: string | null;
  readonly installed: Installed;
  /** The name the runner needs (`check.test.ts`, `legal_check_7c1e02_test.go`). */
  readonly runnable: string;
  /** The stored name: the runnable name with `.held` added. */
  readonly held: string;
  /** The name rule: each string the test's text must carry, because the printed command selects by it. Empty where the command names the file. */
  readonly testNames: readonly string[];
  /** Copy in: the folder the copy goes into, relative to the project folder. Null for an in-place runner. */
  readonly copyFolder: readonly string[] | null;
  /**
   * Copy in: how many of the copy folder's last segments are not in the folder yet (a module with no tests in the
   * finding's package, a crate with no tests folder), so the lines make them before the copy and remove them after the
   * delete. 0 where the copy folder is there, and in place.
   */
  readonly missingFolders: number;
  /** What the run leaves for the test under the test's own name, which the lines delete after the copy. Empty for most runners. */
  readonly leftovers: readonly Leftover[];
  /** The skeleton the deeper-check seat is given for this runner. */
  readonly template: string;
  /** The runner as the command reaches it, for the finding's file ("vitest as it is in node_modules"). */
  readonly reachesAs: string;
  /** What the run itself can download and build before it runs, or null where it downloads nothing. */
  readonly downloads: string | null;
  /** Copy in: the screen's line on why the copy goes into the project; null in place. */
  readonly copyInLine: string | null;
  /** Copy in: the finding file's opening of the same, before "until you delete the copy, ..."; null in place. */
  readonly copyInWhy: string | null;
  /** Further lines of the plan for this runner (not installed, a TypeScript test under Node, ...). */
  readonly notes: readonly string[];
  /** The run line's words, before they are printed in a form. */
  readonly run: readonly Tok[];
}

/**
 * A file the run itself leaves for the test, under the test's own name and never a wider path, which the lines delete
 * after the copy. rf11 D5: Maven kept the deleted test's compiled class in `target/test-classes`, and the module's next
 * plain `mvn test` ran the deleted test again where the module had no other test source; Python leaves the test's
 * byte-code in `__pycache__` beside the copy. `folder` is relative to the project folder, or to the copy's folder where
 * `inCopyFolder`. `name` is the file's name, or, with `tagThen`, its start, which Python follows with the interpreter's
 * tag (`test_check.cpython-312.pyc`), so the line names `test_check.*.pyc`. `folderToo`: the folder is the run's own
 * (Python's `__pycache__` in the check's folder) and is removed after, while empty.
 */
export interface Leftover {
  readonly inCopyFolder: boolean;
  readonly folder: readonly string[];
  readonly name: string;
  readonly tagThen: string | null;
  readonly folderToo: boolean;
}

/** Python's byte-code for the test, beside the copy in the check's folder (pytest adds its own tag; both end `.pyc`). */
const PY_LEFTOVER: Leftover = { inCopyFolder: true, folder: ["__pycache__"], name: "test_check", tagThen: ".pyc", folderToo: true };

/**
 * A word of the run line. A plain string is one argument, quoted where it needs it. `exe` is a program in a folder of
 * the run folder (`./node_modules/.bin/vitest`, `.\gradlew.bat`); `copy` the copy's absolute path (with a fixed
 * prefix in the same argument where given); `copyDir` the copy's folder; `rel` a path relative to the run folder.
 */
export type Tok =
  | string
  | { readonly exe: readonly string[]; readonly winExe?: readonly string[]; readonly dot: boolean }
  | { readonly copy: true; readonly prefix?: string }
  | { readonly copyDir: true }
  | { readonly rel: readonly string[]; readonly dot: boolean };

export interface ChooseInput {
  /** The project folder (absolute). */
  readonly project: string;
  /** The finding's file (absolute, inside the project folder). */
  readonly findingFile: string;
  /** The finding's short id. */
  readonly findingId: string;
}

export type ChooseResult = { readonly ok: true; readonly runner: RunnerChoice } | { readonly ok: false; readonly noTest: NoTest };

interface Ctx {
  readonly project: string;
  readonly finding: string;
  readonly id: string;
  /** The finding's folder and its parents up to the project folder, nearest first. */
  readonly chain: readonly string[];
}

/** A resolved spec, with absolute paths, before it becomes a `RunnerChoice`. */
interface Spec {
  id: RunnerId;
  runFrom: string;
  namedIn: string | null;
  installed: Installed;
  runnable: string;
  testNames: string[];
  copyFolder: string | null;
  template: string;
  reachesAs: string;
  downloads: string | null;
  copyInLine?: string;
  copyInWhy?: string;
  notes: string[];
  run: Tok[];
  leftovers?: Leftover[];
}

/**
 * The runner for the finding's file, read from the manifests of its folder and of its parents up to the project folder,
 * nearest first; or why no test is written. Runs nothing.
 */
export function chooseRunner(input: ChooseInput): ChooseResult {
  if (!FINDING_ID.test(input.findingId)) throw new Error(`not a finding's short id: ${JSON.stringify(input.findingId)}`);
  if (!isAbsolute(input.project) || !isAbsolute(input.findingFile)) throw new Error("the project folder and the finding's file must be absolute paths");
  const project = resolve(input.project);
  const finding = resolve(input.findingFile);
  const rel = relativePath(project, finding);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`the finding's file is not inside the project folder: ${finding}`);
  declareProjectFolder(project);
  const chain: string[] = [];
  for (let at = dirname(finding); ; at = dirname(at)) {
    chain.push(at);
    if (at === project || dirname(at) === at) break;
  }
  const ctx: Ctx = { project, finding, id: input.findingId, chain };
  const got = resolveFamily(ctx);
  if ("kind" in got) return { ok: false, noTest: got };
  return { ok: true, runner: choiceOf(ctx, got) };
}

function segs(project: string, abs: string): string[] {
  const r = relativePath(project, abs);
  return r === "" ? [] : r.split("/");
}

function choiceOf(ctx: Ctx, s: Spec): RunnerChoice {
  const r = runnerRow(s.id);
  return {
    row: r,
    klass: r.klass,
    findingId: ctx.id,
    finding: segs(ctx.project, ctx.finding),
    runFrom: segs(ctx.project, s.runFrom),
    namedIn: s.namedIn === null ? null : segs(ctx.project, s.namedIn).join("/"),
    installed: s.installed,
    runnable: s.runnable,
    held: heldNameOf(s.runnable),
    testNames: s.testNames,
    copyFolder: r.klass === "copy in" && s.copyFolder !== null ? segs(ctx.project, s.copyFolder) : null,
    missingFolders: r.klass === "copy in" && s.copyFolder !== null ? missingUnder(ctx.project, s.copyFolder) : 0,
    leftovers: s.leftovers ?? [],
    template: s.template,
    reachesAs: s.reachesAs,
    downloads: s.downloads,
    copyInLine: r.klass === "copy in" ? (s.copyInLine ?? null) : null,
    copyInWhy: r.klass === "copy in" ? (s.copyInWhy ?? null) : null,
    notes: s.installed === "not installed" ? [NOT_INSTALLED_NOTE, ...s.notes] : s.notes,
    run: s.run,
  };
}

/**
 * How many of the last segments of `folder` (inside `project`) have nothing standing at them. rf11 D5: Maven and Gradle
 * compiled no test where the finding's package had no test folder yet (cp: "No such file or directory", and Gradle
 * then reported BUILD SUCCESSFUL with no test run).
 */
function missingUnder(project: string, folder: string): number {
  let n = 0;
  for (let d = folder; d !== project && d !== dirname(d) && !standsAt(d); d = dirname(d)) n++;
  return n;
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the folder: regular files only, each read through the project's own read rule, and bounded.
// ---------------------------------------------------------------------------------------------------------------

const MANIFEST_MAX = 1 << 20;
const PBXPROJ_MAX = 16 << 20;

function textOf(path: string, max = MANIFEST_MAX): string | null {
  try {
    const k = regularKind(path);
    if (!k.regular || k.size > max) return null;
    return readSourceText(path);
  } catch {
    return null;
  }
}

function isFile(path: string): boolean {
  try {
    return regularKind(path).regular;
  } catch {
    return false;
  }
}

/** Whether anything stands at `path` (a link of any kind included), by `lstat`. */
function standsAt(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function entriesOf(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function jsonOf(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function yamlOf(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const v: unknown = parseYaml(text);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function keysOf(v: unknown): string[] {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? Object.keys(v as object) : [];
}

// ---------------------------------------------------------------------------------------------------------------
// Which language family the finding is in.
// ---------------------------------------------------------------------------------------------------------------

type Family = "js" | "python" | "ruby" | "php" | "dart" | "go" | "elixir" | "jvm" | "dotnet" | "rust" | "swift" | "c";

const FAMILY_BY_EXT: Record<string, Family> = {
  ".js": "js", ".jsx": "js", ".mjs": "js", ".cjs": "js", ".ts": "js", ".tsx": "js", ".mts": "js", ".cts": "js", ".vue": "js", ".svelte": "js", ".astro": "js",
  ".py": "python",
  ".rb": "ruby", ".erb": "ruby", ".rake": "ruby",
  ".php": "php",
  ".dart": "dart",
  ".go": "go",
  ".ex": "elixir", ".exs": "elixir", ".heex": "elixir", ".eex": "elixir",
  ".java": "jvm", ".kt": "jvm", ".kts": "jvm",
  ".cs": "dotnet", ".cshtml": "dotnet", ".razor": "dotnet",
  ".rs": "rust",
  ".swift": "swift", ".m": "swift", ".mm": "swift",
  ".c": "c", ".cc": "c", ".cpp": "c", ".cxx": "c", ".h": "c", ".hpp": "c", ".hh": "c", ".hxx": "c",
};

/** The manifests that mark a folder as one family's, for a finding whose file's extension names none. */
function familyOfFolder(dir: string): Family | "bazel" | null {
  const names = new Set(entriesOf(dir).filter((e) => e.isFile()).map((e) => e.name));
  if (names.has("package.json") || names.has("deno.json") || names.has("deno.jsonc")) return "js";
  if (["pyproject.toml", "setup.py", "setup.cfg", "manage.py", "requirements.txt", "Pipfile"].some((n) => names.has(n))) return "python";
  if (names.has("Gemfile")) return "ruby";
  if (names.has("composer.json")) return "php";
  if (names.has("pubspec.yaml")) return "dart";
  if (names.has("go.mod")) return "go";
  if (names.has("mix.exs")) return "elixir";
  if (names.has("pom.xml") || names.has("build.gradle") || names.has("build.gradle.kts")) return "jvm";
  if ([...names].some((n) => n.endsWith(".csproj"))) return "dotnet";
  if (names.has("Cargo.toml")) return "rust";
  if (names.has("Package.swift") || xcodeProjectsIn(dir).length > 0) return "swift";
  if (names.has("CMakeLists.txt") || names.has("Makefile") || names.has("meson.build")) return "c";
  if (BAZEL_FILES.some((n) => names.has(n))) return "bazel";
  return null;
}

const BAZEL_FILES = ["BUILD", "BUILD.bazel", "WORKSPACE", "WORKSPACE.bazel", "MODULE.bazel"];

function bazelIn(ctx: Ctx): boolean {
  return ctx.chain.some((d) => BAZEL_FILES.some((n) => isFile(join(d, n))));
}

const NEED: Record<Family, string> = {
  js: "a JavaScript test runner",
  python: "pytest",
  ruby: "RSpec or Minitest",
  php: "PHPUnit",
  dart: "the test package",
  go: "a go.mod",
  elixir: "a Mix project",
  jvm: "JUnit or TestNG with Maven or Gradle",
  dotnet: "a test project with xUnit, NUnit or MSTest",
  rust: "a Cargo crate",
  swift: "a SwiftPM test target or an Xcode test target",
  c: "a test runner",
};

function resolveFamily(ctx: Ctx): Spec | NoTest {
  let family: Family | "bazel" | null = FAMILY_BY_EXT[extname(ctx.finding).toLowerCase()] ?? null;
  if (family === null) {
    for (const d of ctx.chain) {
      family = familyOfFolder(d);
      if (family !== null) break;
    }
  }
  if (family === null) return noTest("no runner");
  if (family === "bazel") return noTest("needs a build change");
  if (family === "c") {
    // A C or C++ build (CMake, Make, Meson, Bazel) compiles a new test only once its own build files change; a header in
    // an Xcode or SwiftPM project is that project's.
    if (ctx.chain.some((d) => isFile(join(d, "Package.swift")) || xcodeProjectsIn(d).length > 0)) family = "swift";
    else return noTest("needs a build change");
  }
  const got = RESOLVERS[family](ctx);
  if (got !== null) return got;
  return bazelIn(ctx) ? noTest("needs a build change") : noTest("no runner", NEED[family]);
}

const RESOLVERS: Record<Exclude<Family, "c">, (ctx: Ctx) => Spec | NoTest | null> = {
  js: resolveJs,
  python: resolvePython,
  ruby: resolveRuby,
  php: resolvePhp,
  dart: resolveDart,
  go: resolveGo,
  elixir: resolveElixir,
  jvm: resolveJvm,
  dotnet: resolveDotnet,
  rust: resolveRust,
  swift: resolveSwift,
};

/** The copy-in names carry the finding's id. */
const camel = (id: string): string => `LegalCheck${id}`;
const snake = (id: string): string => `legal_check_${id}`;

// ---------------------------------------------------------------------------------------------------------------
// JavaScript and TypeScript.
// ---------------------------------------------------------------------------------------------------------------

type JsPick = Exclude<RunnerId, "pytest" | "django" | "unittest" | "rspec" | "minitest" | "phpunit" | "pest" | "dart-test" | "flutter" | "go" | "exunit" | "maven" | "gradle" | "dotnet" | "cargo" | "swiftpm" | "xcode"> | "karma";

function depsOf(pkg: Record<string, unknown> | null): Record<string, unknown> {
  if (pkg === null) return {};
  const out: Record<string, unknown> = {};
  for (const k of ["peerDependencies", "optionalDependencies", "dependencies", "devDependencies"]) {
    const v = pkg[k];
    if (v !== null && typeof v === "object" && !Array.isArray(v)) Object.assign(out, v);
  }
  return out;
}

function testScriptOf(pkg: Record<string, unknown> | null): string {
  const scripts = pkg?.["scripts"];
  if (scripts === null || typeof scripts !== "object") return "";
  const t = (scripts as Record<string, unknown>)["test"];
  return typeof t === "string" ? t : "";
}

/** The runner a package.json names, or null where it names none the table knows. */
function jsNamed(dir: string, pkg: Record<string, unknown>): JsPick | null {
  const deps = depsOf(pkg);
  const has = (n: string): boolean => Object.prototype.hasOwnProperty.call(deps, n);
  const karma = has("karma");
  const cli = has("@angular/cli");
  const script = testScriptOf(pkg);
  // The test script first, by the earliest runner it names.
  const inScript: [JsPick, RegExp][] = [
    ["vitest", /\bvitest\b/],
    ["jest", /\bjest\b/],
    ["mocha", /\bmocha\b/],
    ["angular-karma", /\bng\s+test\b/],
    ["jasmine", /\bjasmine\b/],
    ["bun", /\bbun\s+test\b/],
    ["deno", /\bdeno\s+test\b/],
    ["node-test", /\bnode\b[^&|;]*\s--test\b/],
  ];
  let best: { pick: JsPick; at: number } | null = null;
  for (const [pick, re] of inScript) {
    const m = re.exec(script);
    if (m !== null && (best === null || m.index < best.at)) best = { pick, at: m.index };
  }
  if (best !== null) {
    if (best.pick === "angular-karma") {
      if (karma) return cli ? "angular-karma" : "karma";
    } else if (best.pick === "jasmine" && karma) {
      return cli ? "angular-karma" : "karma";
    } else return best.pick;
  }
  if (has("vitest")) return "vitest";
  if (has("jest")) return "jest";
  if (has("mocha")) return "mocha";
  if (karma) return cli ? "angular-karma" : "karma";
  if (has("jasmine")) return "jasmine";
  if (isFile(join(dir, "bun.lock")) || isFile(join(dir, "bun.lockb"))) return "bun";
  return null;
}

function resolveJs(ctx: Ctx): Spec | NoTest | null {
  let first: { dir: string; pkg: Record<string, unknown> } | null = null;
  for (const dir of ctx.chain) {
    const pkgPath = join(dir, "package.json");
    const pkg = jsonOf(textOf(pkgPath));
    if (pkg !== null) {
      if (first === null) first = { dir, pkg };
      const pick = jsNamed(dir, pkg);
      if (pick === "karma") return noTest("karma without the Angular CLI");
      if (pick !== null) return jsSpec(ctx, pick, dir, pkg, pkgPath);
    }
    for (const n of ["deno.json", "deno.jsonc"]) if (isFile(join(dir, n))) return jsSpec(ctx, "deno", dir, pkg, join(dir, n));
  }
  // A Node project that names none of the table's runners (an end-to-end runner only, or ava, tap, uvu, qunit) gets
  // Node's own runner, which ships with Node; so does a script with no package.json.
  if (first !== null) return jsSpec(ctx, "node-test", first.dir, first.pkg, null);
  return jsSpec(ctx, "node-test", ctx.project, null, null);
}

const JS_PACKAGE: Partial<Record<RunnerId, string>> = { vitest: "vitest", jest: "jest", mocha: "mocha", jasmine: "jasmine", "angular-karma": "@angular/cli" };

function jsSpec(ctx: Ctx, id: Exclude<JsPick, "karma">, dir: string, pkg: Record<string, unknown> | null, namedIn: string | null): Spec {
  const deps = depsOf(pkg);
  const ext = extname(ctx.finding).toLowerCase();
  const ts = [".ts", ".tsx", ".mts", ".cts"].includes(ext) || isFile(join(dir, "tsconfig.json")) || Object.prototype.hasOwnProperty.call(deps, "typescript");
  const esm = pkg?.["type"] === "module";
  const x = ts ? "ts" : "js";
  const pkgName = JS_PACKAGE[id];
  let installed: Installed = "not read";
  if (pkgName !== undefined) {
    const v = jsonOf(textOf(join(dir, "node_modules", ...pkgName.split("/"), "package.json")))?.["version"];
    installed = typeof v === "string" && /^[0-9A-Za-z.+-]{1,40}$/.test(v) ? { version: v } : "not installed";
  }
  // On Windows the .cmd shim by name: PowerShell would pick the .ps1 shim first, and its default policy (Restricted) refuses
  // to load it (rf11 D5: PSSecurityException before vitest started); Command Prompt and PowerShell both run the .cmd.
  const bin = (name: string): Tok => ({ exe: ["node_modules", ".bin", name], winExe: ["node_modules", ".bin", `${name}.cmd`], dot: true });
  const title = `F? ${ctx.id}`;
  const spec = (runnable: string, run: Tok[], template: string, reachesAs: string, extra: Partial<Spec> = {}): Spec => ({
    id,
    runFrom: dir,
    namedIn,
    installed,
    runnable,
    testNames: [],
    copyFolder: null,
    template,
    reachesAs,
    downloads: null,
    notes: [],
    run,
    ...extra,
  });
  const body = (open: string): string =>
    `${open}describe(${JSON.stringify(title)}, () => {\n  it("does what the finding says", () => {\n    // Call the code path the finding names, then expect what it sends or stores.\n  });\n});\n`;
  switch (id) {
    case "vitest":
      return spec(`check.test.${x}`, [bin("vitest"), "run", { copy: true }], body(`import { describe, expect, it } from "vitest";\n\n`), "vitest as it is in node_modules");
    case "jest":
      // A plain CommonJS project has no transform for an import statement (rf11 D5: jest 29 stopped at "Cannot use import
      // statement outside a module"), so its test requires the globals; jest serves @jest/globals itself either way.
      return spec(
        `check.test.${x}`,
        [bin("jest"), "--ci", "--runTestsByPath", { copy: true }],
        body(ts || esm ? `import { describe, expect, it } from "@jest/globals";\n\n` : `const { describe, expect, it } = require("@jest/globals");\n\n`),
        "jest as it is in node_modules",
      );
    case "mocha":
      return spec(
        `check.test.${x}`,
        [bin("mocha"), { copy: true }],
        body(ts || esm ? `import assert from "node:assert/strict";\n\n` : `const assert = require("node:assert/strict");\n\n`),
        "mocha as it is in node_modules",
      );
    case "jasmine":
      return spec(`check.spec.${x}`, [bin("jasmine"), { copy: true }], body(""), "Jasmine as it is in node_modules");
    case "bun":
      return spec(`check.test.${x}`, ["bun", "test", { copy: true }], body(`import { describe, expect, it } from "bun:test";\n\n`), "Bun as it is installed on your computer", {
        downloads: standsAt(join(dir, "node_modules")) ? null : DOWNLOAD_IMPORTS,
      });
    case "deno":
      return spec(
        "check.test.ts",
        ["deno", "test", { copy: true }],
        `Deno.test(${JSON.stringify(title)}, () => {\n  // Call the code path the finding names, then throw where it does not send or store what the finding says.\n});\n`,
        "Deno as it is installed on your computer, with this folder's Deno settings",
        { downloads: DOWNLOAD_IMPORTS },
      );
    case "angular-karma": {
      const fromDir = segs(dir, dirname(ctx.finding));
      const copyFolder = fromDir.includes("src") ? dirname(ctx.finding) : join(dir, "src");
      return spec(`legal-check-${ctx.id}.spec.ts`, [bin("ng"), "test", "--watch=false", { copy: true, prefix: "--include=" }], body(""), "the Angular CLI and Karma as they are in node_modules, with the browser Karma starts", {
        copyFolder,
        copyInLine: "The Angular CLI needs the copy beside the finding's file: delete it before you commit.",
        copyInWhy: "The Angular CLI builds a test only from the project's source folder, so the steps copy it there",
      });
    }
    case "node-test":
      return spec(
        ts ? "check.test.ts" : "check.test.mjs",
        ["node", "--test", { copy: true }],
        body(`import { describe, it } from "node:test";\nimport assert from "node:assert/strict";\n\n`),
        "Node.js as it is installed on your computer",
        { notes: ts ? [TS_NODE_NOTE] : [] },
      );
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Python.
// ---------------------------------------------------------------------------------------------------------------

/** The manifest of `dir` that names pytest, or null. */
function pytestIn(dir: string): string | null {
  const named = (n: string, re: RegExp): string | null => {
    const t = textOf(join(dir, n));
    return t !== null && re.test(t) ? join(dir, n) : null;
  };
  for (const n of ["pytest.ini", "conftest.py"]) if (isFile(join(dir, n))) return join(dir, n);
  const direct =
    named("pyproject.toml", /\bpytest\b/) ?? named("setup.cfg", /\bpytest\b/) ?? named("tox.ini", /\bpytest\b/) ?? named("Pipfile", /\bpytest\b/) ?? named("setup.py", /["']pytest\b/);
  if (direct !== null) return direct;
  for (const e of entriesOf(dir)) {
    if (e.isFile() && /^requirements.*\.(txt|in)$/i.test(e.name)) {
      const hit = named(e.name, /^\s*pytest\b/im);
      if (hit !== null) return hit;
    }
  }
  return null;
}

function resolvePython(ctx: Ctx): Spec | null {
  const PY_HEAD = "# Import the code the finding names, relative to the project folder, which the command runs from.\n";
  for (const dir of ctx.chain) {
    const at = pytestIn(dir);
    if (at !== null)
      return {
        id: "pytest", runFrom: dir, namedIn: at, installed: "not read", runnable: "test_check.py", testNames: [], copyFolder: null,
        template: `${PY_HEAD}\n\ndef test_legal_check_${ctx.id}():\n    # Call the code path the finding names, then assert what it sends or stores.\n    pass\n`,
        reachesAs: "pytest as it is in your Python environment", downloads: null, notes: [],
        run: ["python", "-m", "pytest", { copy: true }],
        leftovers: [PY_LEFTOVER],
      };
  }
  for (const dir of ctx.chain) {
    const t = textOf(join(dir, "manage.py"));
    if (t !== null && /DJANGO_SETTINGS_MODULE/.test(t))
      return {
        id: "django", runFrom: dir, namedIn: join(dir, "manage.py"), installed: "not read", runnable: "test_check.py", testNames: [], copyFolder: null,
        template: `from django.test import TestCase\n\n\nclass ${camel(ctx.id)}Test(TestCase):\n    def test_finding(self):\n        # Call the code path the finding names, then assert what it sends or stores.\n        pass\n`,
        reachesAs: "Django's test runner, which creates a test database on the database server your settings name", downloads: null, notes: [],
        run: ["python", "manage.py", "test", { copyDir: true }],
        leftovers: [PY_LEFTOVER],
      };
  }
  const root = ctx.chain.find((d) => ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile"].some((n) => isFile(join(d, n)))) ?? ctx.project;
  return {
    id: "unittest", runFrom: root, namedIn: null, installed: "not read", runnable: "test_check.py", testNames: [], copyFolder: null,
    template: `import unittest\n\n\nclass ${camel(ctx.id)}Test(unittest.TestCase):\n    def test_finding(self):\n        # Call the code path the finding names, then assert what it sends or stores.\n        pass\n`,
    reachesAs: "Python's unittest, with the Python on your PATH", downloads: null, notes: [],
    run: ["python", "-m", "unittest", "discover", "-s", { copyDir: true }, "-p", "test_check.py"],
    leftovers: [PY_LEFTOVER],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Ruby.
// ---------------------------------------------------------------------------------------------------------------

function resolveRuby(ctx: Ctx): Spec | NoTest | null {
  for (const dir of ctx.chain) {
    const gemfile = textOf(join(dir, "Gemfile"));
    if (gemfile === null) continue;
    let all = gemfile;
    if (/^\s*gemspec\b/m.test(gemfile)) for (const e of entriesOf(dir)) if (e.isFile() && e.name.endsWith(".gemspec")) all += "\n" + (textOf(join(dir, e.name)) ?? "");
    const named = (n: string): boolean => new RegExp(`["']${n}["']`).test(all);
    const autoInstall = /BUNDLE_AUTO_INSTALL:\s*["']?(true|1)\b/i.test(textOf(join(dir, ".bundle", "config")) ?? "");
    const downloads = autoInstall ? "Before it runs, this command can download and install the gems the Gemfile lists, because this folder's Bundler settings turn on its automatic install; their own build steps run too." : null;
    if (named("rspec") || named("rspec-rails") || named("rspec-core"))
      return {
        id: "rspec", runFrom: dir, namedIn: join(dir, "Gemfile"), installed: "not read", runnable: "check_spec.rb", testNames: [], copyFolder: null,
        template: `RSpec.describe "F? ${ctx.id}" do\n  it "does what the finding says" do\n    # Call the code path the finding names, then expect what it sends or stores.\n  end\nend\n`,
        reachesAs: "RSpec through Bundler, as your Gemfile sets it", downloads, notes: [],
        run: ["bundle", "exec", "rspec", { copy: true }],
      };
    if (named("minitest") || named("rails")) return minitestSpec(ctx, dir, join(dir, "Gemfile"), true, named("rails"), downloads);
    return noTest("no runner", NEED.ruby);
  }
  return minitestSpec(ctx, ctx.project, null, false, false, null);
}

function minitestSpec(ctx: Ctx, dir: string, namedIn: string | null, bundle: boolean, rails: boolean, downloads: string | null): Spec {
  const helper = isFile(join(dir, "test", "test_helper.rb"));
  const head = helper ? `require "test_helper"\n` : `require "minitest/autorun"\n`;
  const base = helper && rails ? "ActiveSupport::TestCase" : "Minitest::Test";
  return {
    id: "minitest", runFrom: dir, namedIn, installed: "not read", runnable: "check_test.rb", testNames: [], copyFolder: null,
    template: `${head}\nclass ${camel(ctx.id)}Test < ${base}\n  def test_finding\n    # Call the code path the finding names, then assert what it sends or stores.\n  end\nend\n`,
    reachesAs: bundle ? "Ruby with Minitest through Bundler, as your Gemfile sets it" : "Ruby with Minitest, as it is installed on your computer",
    downloads, notes: [],
    run: bundle ? ["bundle", "exec", "ruby", "-Itest", "-Ilib", { copy: true }] : ["ruby", "-Itest", "-Ilib", { copy: true }],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// PHP.
// ---------------------------------------------------------------------------------------------------------------

function resolvePhp(ctx: Ctx): Spec | NoTest | null {
  for (const dir of ctx.chain) {
    const composer = jsonOf(textOf(join(dir, "composer.json")));
    if (composer === null) continue;
    const req = [...keysOf(composer["require"]), ...keysOf(composer["require-dev"])];
    const pick: RunnerId | null = req.includes("phpunit/phpunit") ? "phpunit" : req.includes("pestphp/pest") ? "pest" : null;
    if (pick === null) return noTest("no runner", NEED.php);
    const name = pick === "phpunit" ? "phpunit" : "pest";
    const cls = `${camel(ctx.id)}Test`;
    return {
      id: pick, runFrom: dir, namedIn: join(dir, "composer.json"),
      installed: standsAt(join(dir, "vendor", "bin", name)) ? "not read" : "not installed",
      runnable: `${cls}.php`,
      testNames: pick === "phpunit" ? [cls] : [],
      copyFolder: null,
      template:
        pick === "phpunit"
          ? `<?php\n\nuse PHPUnit\\Framework\\TestCase;\n\nfinal class ${cls} extends TestCase\n{\n    public function testFinding(): void\n    {\n        // Call the code path the finding names, then assert what it sends or stores.\n    }\n}\n`
          : `<?php\n\ntest('F? ${ctx.id}', function () {\n    // Call the code path the finding names, then expect what it sends or stores.\n});\n`,
      reachesAs: pick === "phpunit" ? "PHPUnit as it is in vendor, with your phpunit.xml" : "Pest as it is in vendor, with your Pest.php and phpunit.xml",
      downloads: null, notes: [],
      run: [{ exe: ["vendor", "bin", name], dot: false }, { copy: true }],
    };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Dart and Flutter.
// ---------------------------------------------------------------------------------------------------------------

function resolveDart(ctx: Ctx): Spec | NoTest | null {
  for (const dir of ctx.chain) {
    const pub = yamlOf(textOf(join(dir, "pubspec.yaml")));
    if (pub === null) continue;
    const deps = [...keysOf(pub["dependencies"]), ...keysOf(pub["dev_dependencies"])];
    const flutter = deps.includes("flutter_test");
    if (!flutter && !deps.includes("test")) return noTest("no runner", NEED.dart);
    const lib = flutter ? "package:flutter_test/flutter_test.dart" : "package:test/test.dart";
    return {
      id: flutter ? "flutter" : "dart-test", runFrom: dir, namedIn: join(dir, "pubspec.yaml"), installed: "not read", runnable: "check_test.dart", testNames: [], copyFolder: null,
      template: `import '${lib}';\n\nvoid main() {\n  test('F? ${ctx.id}', () {\n    // Call the code path the finding names, then expect what it sends or stores.\n  });\n}\n`,
      reachesAs: flutter ? "Flutter's test runner as it is installed on your computer" : "Dart's test package, as your pubspec.yaml sets it",
      downloads: flutter ? "Before it runs, this command can download Flutter's engine files, the first time Flutter runs a test on this computer." : null,
      notes: [],
      run: flutter ? ["flutter", "test", { copy: true }] : ["dart", "test", { copy: true }],
    };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Go.
// ---------------------------------------------------------------------------------------------------------------

const GO_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function goPackageOf(folder: string, finding: string): string {
  const clause = (t: string | null): string | null => {
    const m = t === null ? null : /^\s*package\s+([A-Za-z_][A-Za-z0-9_]*)/m.exec(t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, ""));
    return m === null ? null : (m[1] ?? null);
  };
  if (finding.endsWith(".go")) {
    const p = clause(textOf(finding));
    if (p !== null) return p.replace(/_test$/, "");
  }
  for (const e of entriesOf(folder)) {
    if (e.isFile() && e.name.endsWith(".go") && !e.name.endsWith("_test.go")) {
      const p = clause(textOf(join(folder, e.name)));
      if (p !== null) return p;
    }
  }
  const base = basename(folder).replace(/[^A-Za-z0-9_]/g, "_");
  return GO_IDENT.test(base) ? base : "main";
}

function resolveGo(ctx: Ctx): Spec | null {
  for (const dir of ctx.chain) {
    const mod = textOf(join(dir, "go.mod"));
    if (mod === null) continue;
    const pkgDir = dirname(ctx.finding);
    const rel = segs(dir, pkgDir);
    const pkg = goPackageOf(pkgDir, ctx.finding);
    const fn = `Test${camel(ctx.id)}`;
    const toolchain = /^\s*toolchain\s+\S+/m.test(mod);
    return {
      id: "go", runFrom: dir, namedIn: join(dir, "go.mod"), installed: "not read", runnable: `${snake(ctx.id)}_test.go`,
      testNames: [fn, `package ${pkg}`], copyFolder: pkgDir,
      template: `package ${pkg}\n\nimport "testing"\n\nfunc ${fn}(t *testing.T) {\n\t// Call the code path the finding names, then fail where it does not send or store what the finding says.\n}\n`,
      reachesAs: "the Go tool, with the package's other tests and their init functions",
      downloads: `Before it runs, this command can download the modules go.mod lists${toolchain ? ", and the Go toolchain its toolchain line names" : ""}, and build them.`,
      copyInLine: "Go needs the copy in its package's folder: delete it before you commit.",
      copyInWhy: "Go compiles a test only inside its package's folder, so the steps copy it there",
      notes: [],
      run: ["go", "test", rel.length === 0 ? "." : "./" + rel.join("/"), "-run", fn],
    };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Elixir.
// ---------------------------------------------------------------------------------------------------------------

function resolveElixir(ctx: Ctx): Spec | null {
  for (const dir of ctx.chain) {
    if (!isFile(join(dir, "mix.exs"))) continue;
    const runnable = `${snake(ctx.id)}_test.exs`;
    return {
      id: "exunit", runFrom: dir, namedIn: join(dir, "mix.exs"), installed: "not read", runnable, testNames: [], copyFolder: join(dir, "test"),
      template: `defmodule ${camel(ctx.id)}Test do\n  use ExUnit.Case, async: false\n\n  test "F? ${ctx.id}" do\n    # Call the code path the finding names, then assert what it sends or stores.\n  end\nend\n`,
      reachesAs: "Mix, with this project's mix.exs and test helper",
      downloads: null,
      copyInLine: "Mix needs the copy in the app's test folder: delete it before you commit.",
      copyInWhy: "Mix runs a test only from the app's test folder, so the steps copy it there",
      notes: [],
      run: ["mix", "test", { rel: ["test", runnable], dot: false }],
    };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Java and Kotlin: Maven and Gradle.
// ---------------------------------------------------------------------------------------------------------------

type JvmFramework = "junit5" | "junit4" | "testng" | "kotlin-test";

function javaPackageOf(project: string, finding: string): string[] {
  const t = finding.endsWith(".java") || finding.endsWith(".kt") || finding.endsWith(".kts") ? textOf(finding) : null;
  const m = t === null ? null : /^\s*package\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*;?\s*$/m.exec(t);
  if (m !== null && m[1] !== undefined) return m[1].split(".");
  const parts = segs(project, finding);
  for (let i = parts.length - 2; i >= 2; i--) {
    if (parts[i - 2] === "src" && parts[i - 1] === "main" && (parts[i] === "java" || parts[i] === "kotlin")) {
      const pkg = parts.slice(i + 1, -1);
      return pkg.every((p) => GO_IDENT.test(p)) ? pkg : [];
    }
  }
  return [];
}

function frameworkIn(text: string): JvmFramework | null {
  if (/junit-jupiter|org\.junit\.jupiter|spring-boot-starter-test|useJUnitPlatform/.test(text)) return "junit5";
  if (/<artifactId>\s*testng\s*<|org\.testng|["']testng|useTestNG/.test(text)) return "testng";
  if (/<artifactId>\s*junit\s*<|junit:junit|["']junit["']/.test(text)) return "junit4";
  if (/kotlin\(\s*["']test|kotlin-test/.test(text)) return "kotlin-test";
  return null;
}

function jvmTemplate(id: string, pkg: string[], fw: JvmFramework, kotlin: boolean): string {
  const cls = `${camel(id)}Test`;
  const comment = "// Call the code path the finding names, then assert what it sends or stores.";
  if (kotlin) {
    const imp = fw === "junit5" ? "org.junit.jupiter.api.Test" : fw === "junit4" ? "org.junit.Test" : fw === "testng" ? "org.testng.annotations.Test" : "kotlin.test.Test";
    return `${pkg.length > 0 ? `package ${pkg.join(".")}\n\n` : ""}import ${imp}\n\nclass ${cls} {\n    @Test\n    fun finding() {\n        ${comment}\n    }\n}\n`;
  }
  const imp = fw === "junit4" ? "org.junit.Test" : fw === "testng" ? "org.testng.annotations.Test" : "org.junit.jupiter.api.Test";
  const vis = fw === "junit5" || fw === "kotlin-test" ? "" : "public ";
  return `${pkg.length > 0 ? `package ${pkg.join(".")};\n\n` : ""}import ${imp};\n\n${vis}class ${cls} {\n    @Test\n    ${vis}void finding() {\n        ${comment}\n    }\n}\n`;
}

function resolveJvm(ctx: Ctx): Spec | NoTest | null {
  const at = ctx.chain.findIndex((d) => ["pom.xml", "build.gradle", "build.gradle.kts"].some((n) => isFile(join(d, n))));
  if (at < 0) return null;
  const module = ctx.chain[at]!;
  const above = ctx.chain.slice(at);
  const pkg = javaPackageOf(ctx.project, ctx.finding);
  const cls = `${camel(ctx.id)}Test`;
  if (isFile(join(module, "pom.xml"))) {
    const texts = above.map((d) => textOf(join(d, "pom.xml")) ?? "").join("\n");
    const fw = frameworkIn(texts);
    if (fw === null) return noTest("no runner", NEED.jvm);
    const wrapAt = above.find((d) => isFile(join(d, "mvnw")));
    const root = wrapAt ?? [...above].reverse().find((d) => isFile(join(d, "pom.xml"))) ?? module;
    const modRel = segs(root, module);
    return {
      id: "maven", runFrom: root, namedIn: join(module, "pom.xml"), installed: "not read", runnable: `${cls}.java`, testNames: [cls],
      copyFolder: join(module, "src", "test", "java", ...pkg),
      template: jvmTemplate(ctx.id, pkg, fw === "kotlin-test" ? "junit5" : fw, false),
      reachesAs: wrapAt !== undefined ? "Maven through this folder's wrapper, with the plugins the build names" : "Maven as it is installed on your computer, with the plugins the build names",
      downloads:
        wrapAt !== undefined
          ? "Before it runs, this command can download Maven from the address this folder's wrapper names, and the dependencies and plugins the project lists, and build them; their own build steps run too."
          : "Before it runs, this command can download the dependencies and plugins the project lists, and build them; their own build steps run too.",
      copyInLine: "Maven needs the copy in the module's test sources: delete it before you commit.",
      copyInWhy: "Maven compiles a test only from the module's test sources, so the steps copy it there",
      notes: [],
      run: [
        wrapAt !== undefined ? { exe: ["mvnw"], winExe: ["mvnw.cmd"], dot: true } : "mvn",
        ...(modRel.length > 0 ? (["-pl", { rel: modRel, dot: true }] as Tok[]) : []),
        "test",
        `-Dtest=${cls}`,
      ],
      // The compiled class, in Maven's default test output folder: Maven compiles no test where the module has no test
      // source left, so it keeps the class and a later plain `mvn test` runs it again (rf11 D5, section 4.1).
      leftovers: [{ inCopyFolder: false, folder: segs(ctx.project, join(module, "target", "test-classes", ...pkg)), name: `${cls}.class`, tagThen: null, folderToo: false }],
    };
  }
  const buildText = (d: string): string => (textOf(join(d, "build.gradle")) ?? "") + "\n" + (textOf(join(d, "build.gradle.kts")) ?? "");
  const own = buildText(module);
  const fw = frameworkIn(above.map(buildText).join("\n"));
  if (fw === null) return noTest("no runner", NEED.jvm);
  const settingsAt = above.find((d) => isFile(join(d, "settings.gradle")) || isFile(join(d, "settings.gradle.kts")));
  const wrapAt = above.find((d) => isFile(join(d, "gradlew")));
  const root = settingsAt ?? wrapAt ?? module;
  const wrapper = isFile(join(root, "gradlew"));
  const android = /com\.android\.(application|library)/.test(own);
  const task = android ? "testDebugUnitTest" : "test";
  const modRel = segs(root, module);
  const kotlin = /\.kts?$/.test(ctx.finding) && !ctx.finding.endsWith("build.gradle.kts");
  return {
    id: "gradle", runFrom: root, namedIn: isFile(join(module, "build.gradle.kts")) ? join(module, "build.gradle.kts") : join(module, "build.gradle"), installed: "not read",
    runnable: `${cls}.${kotlin ? "kt" : "java"}`, testNames: [cls],
    copyFolder: join(module, "src", "test", kotlin ? "kotlin" : "java", ...pkg),
    template: jvmTemplate(ctx.id, pkg, fw, kotlin),
    reachesAs: wrapper ? "Gradle through this folder's wrapper, with its build scripts" : "Gradle as it is installed on your computer, with its build scripts",
    downloads: wrapper
      ? "Before it runs, this command can download Gradle from the address this folder's wrapper names, and the dependencies the project lists, and build them; their own build steps run too."
      : "Before it runs, this command can download the dependencies the project lists, and build them; their own build steps run too.",
    copyInLine: "Gradle needs the copy in the module's test sources: delete it before you commit.",
    copyInWhy: "Gradle compiles a test only from the module's test sources, so the steps copy it there",
    notes: [],
    run: [wrapper ? { exe: ["gradlew"], winExe: ["gradlew.bat"], dot: true } : "gradle", modRel.length > 0 ? `:${modRel.join(":")}:${task}` : task, "--tests", cls],
    // The compiled class, in Gradle's default test output folder (rf11 D5: Gradle's next run removes it itself; until then
    // it stays). Not for Android, whose unit-test classes go to folders the plugin's version decides.
    leftovers: android ? [] : [{ inCopyFolder: false, folder: segs(ctx.project, join(module, "build", "classes", kotlin ? "kotlin" : "java", "test", ...pkg)), name: `${cls}.class`, tagThen: null, folderToo: false }],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// C#: dotnet test.
// ---------------------------------------------------------------------------------------------------------------

const WALK_SKIP = new Set(["node_modules", "bin", "obj", "vendor", "target", "build", "dist", "packages"]);

/** The .csproj files under `root`, by a walk that follows no link and stops at 6 levels and 4,000 folders. */
function csprojsUnder(root: string): string[] {
  const out: string[] = [];
  let folders = 0;
  const walk = (dir: string, depth: number): void => {
    if (depth > 6 || folders >= 4000) return;
    folders++;
    for (const e of entriesOf(dir)) {
      if (e.isFile() && e.name.endsWith(".csproj")) out.push(join(dir, e.name));
      else if (e.isDirectory() && !e.name.startsWith(".") && !WALK_SKIP.has(e.name)) walk(join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return out.sort();
}

function resolveDotnet(ctx: Ctx): Spec | NoTest | null {
  let own: string | null = null;
  for (const dir of ctx.chain) {
    const p = entriesOf(dir).find((e) => e.isFile() && e.name.endsWith(".csproj"));
    if (p !== undefined) {
      own = join(dir, p.name);
      break;
    }
  }
  if (own === null) return null;
  const ownText = textOf(own) ?? "";
  if (!/<Project\s[^>]*\bSdk\s*=/.test(ownText)) return noTest("needs a build change");
  const testOf = (path: string, text: string): boolean => {
    if (!/Microsoft\.NET\.Test\.Sdk/.test(text)) return false;
    if (path === own) return true;
    for (const m of text.matchAll(/<ProjectReference\s+Include\s*=\s*"([^"]+)"/g)) {
      if (m[1] !== undefined && resolve(dirname(path), m[1].replace(/\\/g, "/")) === own) return true;
    }
    return false;
  };
  let testProject: string | null = null;
  let testText = "";
  for (const p of csprojsUnder(ctx.project)) {
    const t = textOf(p) ?? "";
    if (testOf(p, t)) {
      testProject = p;
      testText = t;
      break;
    }
  }
  if (testProject === null) return noTest("no runner", NEED.dotnet);
  if (!/<Project\s[^>]*\bSdk\s*=/.test(testText)) return noTest("needs a build change");
  const cls = `${camel(ctx.id)}Test`;
  const comment = "// Call the code path the finding names, then assert what it sends or stores.";
  const template = /\bxunit\b/i.test(testText)
    ? `using Xunit;\n\npublic class ${cls}\n{\n    [Fact]\n    public void Finding()\n    {\n        ${comment}\n    }\n}\n`
    : /\bNUnit\b/i.test(testText)
      ? `using NUnit.Framework;\n\n[TestFixture]\npublic class ${cls}\n{\n    [Test]\n    public void Finding()\n    {\n        ${comment}\n    }\n}\n`
      : `using Microsoft.VisualStudio.TestTools.UnitTesting;\n\n[TestClass]\npublic class ${cls}\n{\n    [TestMethod]\n    public void Finding()\n    {\n        ${comment}\n    }\n}\n`;
  return {
    id: "dotnet", runFrom: ctx.project, namedIn: testProject, installed: "not read", runnable: `${cls}.cs`, testNames: [cls], copyFolder: dirname(testProject), template,
    reachesAs: "dotnet, with the test project's build",
    downloads: "Before it runs, this command can download the packages the projects list, from the sources this folder's nuget.config names, and build them; their own build steps run too.",
    copyInLine: "dotnet needs the copy in the test project's folder: delete it before you commit.",
    copyInWhy: "dotnet compiles a test only inside a test project's folder, so the steps copy it there",
    notes: [],
    run: ["dotnet", "test", { rel: segs(ctx.project, testProject), dot: true }, "--filter", `FullyQualifiedName~${camel(ctx.id)}`],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Rust: cargo test.
// ---------------------------------------------------------------------------------------------------------------

function tomlSection(text: string, name: string): string | null {
  const m = new RegExp(`^\\[${name.replace(/[.]/g, "\\.")}\\]\\s*$([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, "m").exec(text);
  return m === null ? null : (m[1] ?? "");
}

function resolveRust(ctx: Ctx): Spec | NoTest | null {
  for (const dir of ctx.chain) {
    const t = textOf(join(dir, "Cargo.toml"));
    if (t === null) continue;
    const pkg = tomlSection(t, "package");
    if (pkg === null) continue;
    const name = /^\s*name\s*=\s*"([A-Za-z][A-Za-z0-9_-]{0,63})"/m.exec(pkg)?.[1];
    if (name === undefined) continue;
    if (tomlSection(t, "lib") === null && !isFile(join(dir, "src", "lib.rs"))) return noTest("needs a build change");
    const toolchain = isFile(join(dir, "rust-toolchain.toml")) || isFile(join(dir, "rust-toolchain")) || isFile(join(ctx.project, "rust-toolchain.toml")) || isFile(join(ctx.project, "rust-toolchain"));
    const file = snake(ctx.id);
    return {
      id: "cargo", runFrom: dir, namedIn: join(dir, "Cargo.toml"), installed: "not read", runnable: `${file}.rs`, testNames: [], copyFolder: join(dir, "tests"),
      template: `use ${name.replace(/-/g, "_")} as _;\n\n#[test]\nfn ${file}() {\n    // Call the crate's public items the finding names, then assert what they send or store.\n}\n`,
      reachesAs: "Cargo, with the crate's build scripts",
      downloads: `Before it runs, this command can download the crates the project lists${toolchain ? ", and the Rust toolchain this folder's rust-toolchain file names" : ""}, and build them; their own build scripts run too.`,
      copyInLine: "Cargo needs the copy in the crate's tests folder: delete it before you commit.",
      copyInWhy: "Cargo compiles a separate test only from the crate's tests folder, so the steps copy it there",
      notes: [CARGO_NOTE],
      run: ["cargo", "test", "-p", name, "--test", file],
    };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Swift and Objective-C: SwiftPM and Xcode.
// ---------------------------------------------------------------------------------------------------------------

function xcodeProjectsIn(dir: string): string[] {
  return entriesOf(dir)
    .filter((e) => e.isDirectory() && e.name.endsWith(".xcodeproj"))
    .map((e) => join(dir, e.name))
    .sort();
}

const SWIFT_NAME = /^[A-Za-z_][A-Za-z0-9_ .-]{0,99}$/;

function resolveSwift(ctx: Ctx): Spec | NoTest | null {
  for (const dir of ctx.chain) {
    const pkgText = textOf(join(dir, "Package.swift"));
    if (pkgText !== null) return swiftPm(ctx, dir, pkgText);
    const projects = xcodeProjectsIn(dir);
    if (projects.length > 0) return xcode(ctx, dir, projects);
  }
  return null;
}

function swiftTemplate(id: string, objc: boolean, module: string | null): string {
  const cls = `${camel(id)}Tests`;
  if (objc) return `#import <XCTest/XCTest.h>\n\n@interface ${cls} : XCTestCase\n@end\n\n@implementation ${cls}\n- (void)testFinding {\n    // Call the code path the finding names, then assert what it sends or stores.\n}\n@end\n`;
  return `import XCTest\n${module !== null ? `@testable import ${module}\n` : ""}\nfinal class ${cls}: XCTestCase {\n    func testFinding() {\n        // Call the code path the finding names, then assert what it sends or stores.\n    }\n}\n`;
}

function swiftPm(ctx: Ctx, dir: string, text: string): Spec | NoTest {
  const starts = [...text.matchAll(/\.(testTarget|target|executableTarget|macro|plugin|binaryTarget|systemLibrary)\s*\(/g)];
  const targets = starts.map((m, i) => {
    const body = text.slice(m.index ?? 0, starts[i + 1]?.index ?? text.length);
    return { test: m[1] === "testTarget", body, name: /name:\s*"([^"]+)"/.exec(body)?.[1], path: /path:\s*"([^"]+)"/.exec(body)?.[1] };
  });
  const tests = targets.filter((t) => t.test && t.name !== undefined && SWIFT_NAME.test(t.name));
  if (tests.length === 0) return noTest("needs a build change");
  const rel = segs(dir, ctx.finding);
  const findingTarget = rel[0] === "Sources" && rel.length > 2 ? rel[1]! : null;
  const chosen = (findingTarget !== null ? tests.find((t) => t.body.includes(`"${findingTarget}"`)) : undefined) ?? tests[0]!;
  const folderRel = chosen.path !== undefined && !chosen.path.split("/").includes("..") && !chosen.path.startsWith("/") ? chosen.path.split("/").filter((p) => p !== "" && p !== ".") : ["Tests", chosen.name!];
  const cls = `${camel(ctx.id)}Tests`;
  const module = findingTarget !== null && /^[A-Za-z_][A-Za-z0-9_]*$/.test(findingTarget) ? findingTarget : null;
  return {
    id: "swiftpm", runFrom: dir, namedIn: join(dir, "Package.swift"), installed: "not read", runnable: `${cls}.swift`, testNames: [cls], copyFolder: join(dir, ...folderRel),
    template: swiftTemplate(ctx.id, false, module),
    reachesAs: "SwiftPM, with the package's build plugins",
    downloads: "Before it runs, this command can download the packages Package.swift lists, and build them; their own build plugins run too.",
    copyInLine: "SwiftPM needs the copy in the test target's folder: delete it before you commit.",
    copyInWhy: "SwiftPM compiles a test only from a test target's folder, so the steps copy it there",
    notes: [],
    run: ["swift", "test", "--filter", cls],
  };
}

function xcode(ctx: Ctx, dir: string, projects: string[]): Spec | NoTest {
  for (const proj of projects) {
    const pbx = textOf(join(proj, "project.pbxproj"), PBXPROJ_MAX);
    if (pbx === null) continue;
    // Synchronized folders (Xcode 16): object id -> path.
    const groups = new Map<string, string>();
    for (const m of pbx.matchAll(/([0-9A-Fa-f]{24})\s*(?:\/\*[^*]*\*\/)?\s*=\s*\{\s*isa\s*=\s*PBXFileSystemSynchronizedRootGroup;([^}]*)\}/g)) {
      const path = /\bpath\s*=\s*("([^"]*)"|[^;\s]+)\s*;/.exec(m[2] ?? "");
      const value = path === null ? undefined : (path[2] ?? path[1]);
      if (m[1] !== undefined && value !== undefined) groups.set(m[1], value);
    }
    for (const m of pbx.matchAll(/\{\s*isa\s*=\s*PBXNativeTarget;([\s\S]*?)\n\t\t\};/g)) {
      const body = m[1] ?? "";
      if (!/productType\s*=\s*"com\.apple\.product-type\.bundle\.unit-test"/.test(body)) continue;
      const name = /\bname\s*=\s*("([^"]*)"|[^;\s]+)\s*;/.exec(body);
      const target = name === null ? undefined : (name[2] ?? name[1]);
      if (target === undefined || !SWIFT_NAME.test(target)) continue;
      const sync = /fileSystemSynchronizedGroups\s*=\s*\(([^)]*)\)/.exec(body)?.[1] ?? "";
      const groupId = [...sync.matchAll(/([0-9A-Fa-f]{24})/g)].map((g) => g[1]!).find((g) => groups.has(g));
      if (groupId === undefined) continue;
      const groupPath = groups.get(groupId)!;
      if (groupPath.startsWith("/") || groupPath.split("/").includes("..")) continue;
      const schemesDir = join(proj, "xcshareddata", "xcschemes");
      const scheme = entriesOf(schemesDir)
        .filter((e) => e.isFile() && e.name.endsWith(".xcscheme"))
        .map((e) => e.name)
        .sort()
        .find((n) => new RegExp(`<TestableReference[\\s\\S]*?BlueprintName\\s*=\\s*"${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(textOf(join(schemesDir, n)) ?? ""));
      if (scheme === undefined || !SWIFT_NAME.test(scheme.slice(0, -".xcscheme".length))) continue;
      const schemeName = scheme.slice(0, -".xcscheme".length);
      const ios = /SDKROOT\s*=\s*iphoneos\b/.test(pbx);
      const objc = /\.(m|mm|h)$/.test(ctx.finding);
      const cls = `${camel(ctx.id)}Tests`;
      const several = projects.length > 1 || entriesOf(dir).some((e) => e.isDirectory() && e.name.endsWith(".xcworkspace"));
      if (several && !SWIFT_NAME.test(basename(proj))) continue;
      return {
        id: "xcode", runFrom: dir, namedIn: join(proj, "project.pbxproj"), installed: "not read", runnable: `${cls}.${objc ? "m" : "swift"}`, testNames: [cls],
        copyFolder: join(dir, ...groupPath.split("/").filter((p) => p !== "" && p !== ".")),
        template: swiftTemplate(ctx.id, objc, null),
        reachesAs: "xcodebuild, with the project's build phases and scripts",
        downloads: "Before it runs, this command can download the Swift packages the project lists, and build them; their own build plugins run too.",
        copyInLine: "Xcode needs the copy in the test target's folder: delete it before you commit.",
        copyInWhy: "Xcode builds a test only from the test target's folder, so the steps copy it there",
        notes: ios ? [SIMULATOR_NOTE] : [],
        run: [
          "xcodebuild",
          "test",
          ...(several ? (["-project", basename(proj)] as Tok[]) : []),
          "-scheme",
          schemeName,
          `-only-testing:${target}/${cls}`,
          ...(ios ? (["-destination", "platform=iOS Simulator,name=<simulator>"] as Tok[]) : []),
        ],
      };
    }
  }
  return noTest("needs a build change");
}

// ---------------------------------------------------------------------------------------------------------------
// The lines.
// ---------------------------------------------------------------------------------------------------------------

/** The two forms a command is printed in. */
export type CommandForm = "posix" | "windows";

/** The form for the computer the program runs on. */
export function formHere(): CommandForm {
  return process.platform === "win32" ? "windows" : "posix";
}

export interface RunLines {
  readonly form: CommandForm;
  /** The folder the run line runs from, absolute. */
  readonly runFrom: string;
  /** Where the stored test is: the check's folder and the held name. */
  readonly heldPath: string;
  /** Where the copy goes: beside the stored test (in place) or in the project (copy in). */
  readonly copyPath: string;
  /** The finding's file as an import from the copy's folder would name it (slash-separated, relative). */
  readonly findingFromCopy: string;
  readonly lead: string;
  readonly decision: string;
  /** Copy in: why the copy goes into the project. */
  readonly copyInLine: string | null;
  /** Copy in, where the copy's folder is not there yet: the line that makes it, before the copy line; else null. */
  readonly make: string | null;
  /** The three lines. */
  readonly copy: string;
  readonly run: string;
  readonly remove: string;
  /** The lines that delete what the run left for the test (`RunnerChoice.leftovers`), after the delete line; empty for most runners. */
  readonly leftovers: readonly string[];
  /** With `make`: the line that removes the folders it made (each only while empty), after the delete line; else null. */
  readonly unmake: string | null;
}

export interface LinesInput {
  readonly form: CommandForm;
  /** The project folder, absolute, in the form's own path syntax. */
  readonly project: string;
  /** The check's folder (`.legal/deep/<id>/<time>/`), absolute, in the form's own path syntax. */
  readonly checkFolder: string;
}

export type LinesResult = { readonly ok: true; readonly lines: RunLines } | { readonly ok: false; readonly why: string };

/**
 * Characters that do not show as themselves: control, format, line and paragraph separators, private use, unassigned,
 * and every default-ignorable code point (the Hangul fillers, and the variation selectors and the combining grapheme
 * joiner, which are combining marks the POSIX form's allowlist would otherwise let in).
 */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\p{Default_Ignorable_Code_Point}\u115F\u1160\u3164\uFFA0]/u;
/**
 * The characters a path or a name read from the folder may hold for WolfBoy to print a line with it, in both forms
 * (rf11 C3 items 1 and 1b): Unicode letters and decimal digits, "-", "_", ".", the space, and the form's separator ("/",
 * or "\" in the Windows form, whose paths also take ":" after the drive letter). Nothing else, because no quoting is
 * read the same by every shell the lines may be pasted into, and a blocklist missed two: PowerShell passes an argument
 * holding no space to cmd.exe without quotes, so Command Prompt's "& | < > ^ ( ) , ; =" act there (a module folder
 * named "m&c3hit" ran a program the tree supplied from the line that removes the made folders, in Windows PowerShell
 * 5.1), and fish reads "\" before "'" as an escape inside single quotes. With the characters left, a POSIX line is
 * quoted only around spaces, letters past ASCII and the POSIX form's own additions below, and holds no "'" or "\", which sh, bash, dash, zsh (also with
 * RC_QUOTES) and fish all read as the same literal text; a Windows line is double-quoted only around the same, which
 * both Windows shells read as literal text, PowerShell 7 adding its own quotes only where there is a space, as 5.1
 * does. The Spacing Modifier Letters (U+02B0 to U+02FF) are left out although they are letters: a program that reads
 * its command line in an ANSI code page gets several of them as a quote ("best fit"). "/" is left out of the Windows
 * form's paths, where cmd reads it as a switch.
 *
 * The POSIX form also takes the combining marks (macOS keeps many names decomposed: a Japanese "ga" stored as "ka"
 * followed by U+3099, an accented Latin letter as the letter followed by its accent) and "~ + @ ( ) ," (iCloud Drive's
 * folder is "com~apple~CloudDocs"), and only because each of them reaches the shell inside single quotes: quote() leaves
 * a POSIX word bare only where it holds just ASCII letters, digits and "_ % = : . / -", so a word holding any of them,
 * or any letter past ASCII, is single-quoted. Inside single quotes sh, bash, dash and zsh read every character but "'"
 * as itself, and zsh's RC_QUOTES changes only "''"; fish reads only "\" and "'" there, as escapes. "'" and "\" stay
 * refused, and a combining mark is bytes of 0x80 and above in UTF-8, none of them "'" or "\". So no shell named sees the
 * syntax these characters have outside quotes: tilde expansion, zsh's EXTENDED_GLOB "~" (an unquoted "a~b" is a pattern
 * there, which an rm line could match against another file), the "@(" and "+(" patterns of bash's extglob and zsh's
 * KSH_GLOB, fish's "(" command substitution, a brace expansion's ",". The default-ignorable marks (the variation
 * selectors) stay refused as hidden. The Windows form takes none of them: both Windows shells read them unquoted where
 * PowerShell passes an argument with no space to cmd.exe as it is (cmd's "( ) ,", copy's "+" that joins files,
 * PowerShell's "@(" and leading "~"), and a program that reads its command line in an ANSI code page gets several
 * combining marks by "best fit" as "`", "^" or "~".
 */
const NAME_CHAR = /^[\p{L}\p{Nd}_. -]$/u;
const MODIFIER_LETTER = /^[\u02B0-\u02FF]$/u;
const POSIX_ONLY = /^[\p{M}~+@(),]$/u;
/** The punctuation the table's own fixed words carry ("-Dtest=", "--include=", "FullyQualifiedName~", Xcode's "-only-testing:" and its "-destination" placeholder): allowed in a plain string word, whose parts taken from the folder are folder names also in a path checked here, or names the table reads only where they match its own pattern (Cargo's, SwiftPM's and Xcode's). */
const FIXED_WORD_PUNCT = /^[=:~,<>/]$/u;

/** The first character of `s` outside the allowlist, else null. `kind` is "path" (absolute, in the form's syntax), "segments" (a relative path of the form) or "word" (a plain string word of the table). */
function outsideAllowlist(form: CommandForm, s: string, kind: "path" | "segments" | "word"): string | null {
  const chars = [...s];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (NAME_CHAR.test(ch) && !MODIFIER_LETTER.test(ch)) continue;
    if (form === "posix" && POSIX_ONLY.test(ch)) continue;
    if (kind === "word" && FIXED_WORD_PUNCT.test(ch)) continue;
    if (kind !== "word" && ch === (form === "windows" ? "\\" : "/")) continue;
    if (form === "windows" && kind === "path" && ch === ":" && i === 1 && /^[A-Za-z]$/.test(chars[0]!)) continue;
    return ch;
  }
  return null;
}

// A POSIX word is left bare only where it holds just these (see the allowlist's note above: "~ + @ ," and every letter
// past ASCII are always single-quoted); one that starts with "=" is quoted too (zsh's EQUALS reads "=name" as a path).
const POSIX_PLAIN = /^[A-Za-z0-9_%=:./-]+$/;
const WINDOWS_PLAIN = /^[A-Za-z0-9_+:.\\/-]+$/;

function codePoint(ch: string): string {
  return "U+" + (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0");
}

function quote(form: CommandForm, arg: string): string {
  if (form === "posix") return POSIX_PLAIN.test(arg) && !arg.startsWith("=") ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
  return WINDOWS_PLAIN.test(arg) ? arg : `"${arg}"`;
}

/**
 * The run lines for a choice, in one form: the lead, the decision line, the copy-in line, and the three lines (copy the
 * stored test to its runnable name, run the copy, delete the copy), with the make and unmake lines around them where
 * the copy's folder is not there yet, and after the delete line those that delete what the run left for the test. Refused, with the reason, where a path or a name
 * read from the folder holds a character that does not show as itself, or, in the Windows form, one a Windows shell
 * would read as part of the command.
 */
export function runLines(choice: RunnerChoice, input: LinesInput): LinesResult {
  const p = input.form === "windows" ? win32 : posix;
  if (!p.isAbsolute(input.project) || !p.isAbsolute(input.checkFolder)) throw new Error(`the project folder and the check's folder must be absolute ${input.form} paths`);
  const project = p.normalize(input.project);
  const checkFolder = p.normalize(input.checkFolder);
  const runFrom = p.join(project, ...choice.runFrom);
  const heldPath = p.join(checkFolder, choice.held);
  const copyFolder = choice.copyFolder === null ? checkFolder : p.join(project, ...choice.copyFolder);
  const copyPath = p.join(copyFolder, choice.runnable);
  const word = (t: Tok): string => {
    if (typeof t === "string") return t;
    if ("exe" in t) {
      const parts = input.form === "windows" ? (t.winExe ?? t.exe) : t.exe;
      return (t.dot ? (input.form === "windows" ? ".\\" : "./") : "") + parts.join(input.form === "windows" ? "\\" : "/");
    }
    if ("copy" in t) return (t.prefix ?? "") + copyPath;
    if ("copyDir" in t) return copyFolder;
    return (t.dot ? (input.form === "windows" ? ".\\" : "./") : "") + t.rel.join(input.form === "windows" ? "\\" : "/");
  };
  const words = choice.run.map(word);
  const leftFiles = choice.leftovers.map((o) => p.join(o.inCopyFolder ? copyFolder : project, ...o.folder, o.name));
  const all = [project, checkFolder, runFrom, heldPath, copyPath, ...words, ...leftFiles];
  for (const s of all) {
    const m = HIDDEN.exec(s);
    if (m !== null) return { ok: false, why: `a path or name on the way to the test holds a character that does not show as itself (${codePoint(m[0])}), so WolfBoy prints no lines to run it` };
  }
  // Every path, and every part of a word taken from the folder, holds only the allowlist's characters; the table's own
  // words may add the punctuation they carry (FIXED_WORD_PUNCT).
  const checked: [string, "path" | "segments" | "word"][] = [
    ...[project, checkFolder, runFrom, heldPath, copyPath, copyFolder, ...leftFiles].map((s): [string, "path"] => [s, "path"]),
    ...choice.run.map((t): [string, "segments" | "word"] => (typeof t === "string" ? [t, "word"] : "copy" in t ? [t.prefix ?? "", "word"] : "copyDir" in t ? ["", "word"] : [word(t), "segments"])),
  ];
  for (const [s, kind] of checked) {
    const ch = outsideAllowlist(input.form, s, kind);
    if (ch !== null) return { ok: false, why: `${s} holds "${ch}" (${codePoint(ch)}); WolfBoy prints the lines to run the test only where each path and name holds just ${input.form === "posix" ? 'letters (with any accents or other marks on them), digits, spaces, "-", "_", ".", "~", "+", "@", "(", ")", ","' : 'letters, digits, spaces, "-", "_", "."'} and the folder separator, so it prints none` };
  }
  const q = (s: string): string => quote(input.form, s);
  const [cp, rm] = input.form === "windows" ? ["copy", "del"] : ["cp", "rm"];
  // Removes folders only while empty, in both Windows shells: PowerShell's own rmdir asks before deleting a folder that
  // holds files, and Enter (its default answer) deletes them (tried, rf11 I-D part 3), so the Windows line is Command
  // Prompt's rmdir, which refuses a folder that is not empty, run through cmd /c from either shell.
  const rmdirLine = (dirs: readonly string[]): string => `${input.form === "windows" ? "cmd /c rmdir" : "rmdir"} ${dirs.map(q).join(" ")}`;
  // The folders the copy needs and the project does not have, deepest first. Command Prompt and PowerShell both make the
  // parents with mkdir.
  const made: string[] = [];
  for (let i = 0, d = copyFolder; i < (choice.copyFolder === null ? 0 : choice.missingFolders); i++, d = p.dirname(d)) made.push(d);
  const make = made.length === 0 ? null : input.form === "windows" ? `mkdir ${q(copyFolder)}` : `mkdir -p ${q(copyFolder)}`;
  const unmake = made.length === 0 ? null : rmdirLine(made);
  // What the run left for the test, by the test's own name: rm -f (POSIX) and del, as the run may have left nothing (the
  // test not run, or no byte-code written). A tagged name's wildcard stays outside the POSIX quotes so the shell expands it.
  const leftovers = choice.leftovers.flatMap((o) => {
    const dir = o.inCopyFolder ? p.join(copyFolder, ...o.folder) : p.join(project, ...o.folder);
    const file = p.join(dir, o.name);
    const named = o.tagThen === null ? q(file) : input.form === "windows" ? q(`${file}.*${o.tagThen}`) : `${q(file)}.*${o.tagThen}`;
    return [input.form === "windows" ? `del ${named}` : `rm -f ${named}`, ...(o.folderToo ? [rmdirLine([dir])] : [])];
  });
  // The copy's folder as segments under the project (the check's folder is always inside it), then the finding's file
  // from there, by segments alone, joined by "/" as an import names it.
  const prefix = project.endsWith(p.sep) ? project : project + p.sep;
  if (choice.copyFolder === null && !checkFolder.startsWith(prefix)) throw new Error(`the check's folder is not inside the project folder: ${checkFolder}`);
  const copySegs = choice.copyFolder ?? checkFolder.slice(prefix.length).split(p.sep).filter((x) => x !== "");
  let common = 0;
  while (common < copySegs.length && common < choice.finding.length - 1 && copySegs[common] === choice.finding[common]) common++;
  const fromCopy = [...copySegs.slice(common).map(() => ".."), ...choice.finding.slice(common)].join("/");
  return {
    ok: true,
    lines: {
      form: input.form,
      runFrom,
      heldPath,
      copyPath,
      findingFromCopy: fromCopy.startsWith(".") ? fromCopy : "./" + fromCopy,
      lead: leadLine(runFrom),
      decision: DECISION_LINE,
      copyInLine: choice.copyInLine,
      make,
      copy: `${cp} ${q(heldPath)} ${q(copyPath)}`,
      run: words.map(q).join(" "),
      remove: `${rm} ${q(copyPath)}`,
      leftovers,
      unmake,
    },
  };
}

/**
 * The lines the person runs, in order: the make line, the three lines, the leftovers' delete lines and the unmake line,
 * where there are any. The screen prints these and command.txt keeps these, from this one list.
 */
export function runSteps(lines: RunLines): string[] {
  return [...(lines.make !== null ? [lines.make] : []), lines.copy, lines.run, lines.remove, ...lines.leftovers, ...(lines.unmake !== null ? [lines.unmake] : [])];
}

/**
 * The run lines as the screen prints them: the lead, the decision line, then the copy-in line or, for an in-place copy
 * git would stage, the git line, then the lines to run (`runSteps`).
 */
export function screenLines(lines: RunLines, gitStages: boolean): string[] {
  return [
    lines.lead,
    lines.decision,
    ...(lines.copyInLine !== null ? [lines.copyInLine] : []),
    ...(lines.copyInLine === null && gitStages ? [GIT_STAGE_LINE] : []),
    ...runSteps(lines),
  ];
}

/**
 * Whether git would stage an in-place copy at `copyPath` (inside the project's `.legal/`): asked of git with
 * `git check-ignore --no-index`, through the scan's git runner, wherever `.legal/.gitignore` is not the program's own
 * text (absent included). "product ignore": the program's own `.gitignore` ignores everything in `.legal/`, so git is
 * not asked. "not asked": git is not run here, or the folder is not in a git work tree, or git could not answer.
 */
export type GitStage = "stages" | "ignored" | "product ignore" | "not asked";

export function gitWouldStageCopy(project: string, copyPath: string): GitStage {
  const at = resolve(project);
  declareProjectFolder(at);
  let own: string | null = null;
  try {
    own = readRegularFile(join(at, LEGAL_DIR_NAME, LEGAL_GITIGNORE_FILE), "utf8");
  } catch {
    own = null;
  }
  if (own === LEGAL_GITIGNORE_TEXT) return "product ignore";
  const runner = gitRunnerOrWhy(at);
  if ("why" in runner) return "not asked";
  const inside = runner.run(["rev-parse", "--is-inside-work-tree"]);
  if (inside.error || inside.status !== 0 || inside.stdout.trim() !== "true") return "not asked";
  const rel = relativePath(at, resolve(copyPath));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return "not asked";
  const r = runner.run(["check-ignore", "--no-index", "-q", "--", rel]);
  if (r.error) return "not asked";
  return r.status === 0 ? "ignored" : r.status === 1 ? "stages" : "not asked";
}
