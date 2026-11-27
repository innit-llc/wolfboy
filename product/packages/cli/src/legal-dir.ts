/**
 * THE RUN'S `.legal` FOLDER: its name, its two ignore files and the one writer of both.
 * Moved here from hook-launch.ts so that any command can write them before it writes into `.legal`, without loading
 * the hook modules; hook-launch.ts re-exports every name.
 */
import { accessSync, constants as fsConstants, existsSync, lstatSync, readdirSync, statSync } from "node:fs";
import { makeFolder } from "./project-write.js";
import { basename, dirname, join, resolve } from "node:path";
import { relativePath } from "./project-path.js";
import { createExclusive } from "./program-file.js";
import { gitRunnerOrWhy } from "./child-program.js";
import { asNotRegular, readRegularFile, whyNotRead } from "./project-read.js";

/** The run's working folder's name (hook.ts runPaths: `<project>/.legal`). */
export const LEGAL_DIR_NAME = ".legal";
/**
 * WHERE THE EVIDENCE LOG IS WRITTEN AND WHERE A LATER RUN FINDS IT. One place
 * names both, so the writer (the assembly's default `--out-log`) and every reader (the earlier-run question of step 3k,
 * the review entrance's raised questions) cannot disagree: in the build the check read, the review entrance read
 * `.legal/evidence/log.json`, a name nothing writes, and so never saw a question the report raised.
 */
export const EVIDENCE_DIR_NAME = "evidence";
/** The names the assembly writes under `<legal>/evidence/` by default, and the only ones a reader takes as a log. */
export const EVIDENCE_LOG_NAME = /^scan-[A-Za-z0-9._:-]{1,100}\.json$/;
/** The log's file name for a run completed at `completedAt` (ISO 8601), with `:` and `.` written as `-`. */
export function evidenceLogName(completedAt: string): string {
  return `scan-${completedAt.replace(/[:.]/g, "-")}.json`;
}
/** The assembly's default `--out-log`, relative to the folder it runs in: `.legal/evidence/scan-<completed_at>.json`. */
export function defaultEvidenceLogPath(completedAt: string): string {
  return `${LEGAL_DIR_NAME}/${EVIDENCE_DIR_NAME}/${evidenceLogName(completedAt)}`;
}
/**
 * Whether a file name is one the readers take as an evidence log. The writer holds `--out-log` to
 * the same rule (assemble-report.ts `placementRefusals`), so a log can never be written where no reader looks.
 */
export const isEvidenceLogName = (name: string): boolean => EVIDENCE_LOG_NAME.test(name);
/**
 * A log's own completion time, as the assembly writes it (`completed_at`); "" where the file does
 * not read as a log that carries one. Logs are ordered by it, newest first, and by name only between equal times, so a
 * name that sorts late (`scan-manual.json`) never stands in front of a newer run's log.
 */
export function evidenceLogCompletedAt(path: string): string {
  try {
    const doc = JSON.parse(readRegularFile(path).toString("utf8")) as { completed_at?: unknown };
    return doc && typeof doc.completed_at === "string" ? doc.completed_at : "";
  } catch {
    return "";
  }
}
/** Newest first by `completed_at` (compared as instants where both read as times), then by name; a log with no time last. */
export function compareEvidenceLogs(a: { name: string; completedAt: string }, b: { name: string; completedAt: string }): number {
  const ta = Date.parse(a.completedAt);
  const tb = Date.parse(b.completedAt);
  const ha = Number.isFinite(ta);
  const hb = Number.isFinite(tb);
  if (ha !== hb) return ha ? -1 : 1;
  if (ha && hb && ta !== tb) return tb - ta;
  return a.name < b.name ? 1 : a.name > b.name ? -1 : 0;
}
/**
 * The latest log under `<legalDir>/evidence/`: of the regular files whose names the readers take (`isEvidenceLogName`),
 * the one completed last by its own `completed_at` (`compareEvidenceLogs`). Null where there is none. Never throws.
 */
export function latestEvidenceLog(legalDir: string): string | null {
  const dir = join(legalDir, EVIDENCE_DIR_NAME);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  const logs: { name: string; completedAt: string }[] = [];
  for (const name of names.filter(isEvidenceLogName)) {
    try {
      if (lstatSync(join(dir, name)).isFile()) logs.push({ name, completedAt: evidenceLogCompletedAt(join(dir, name)) });
    } catch {
      // gone between the listing and the look: the next one
    }
  }
  const newest = logs.sort(compareEvidenceLogs)[0];
  return newest ? join(dir, newest.name) : null;
}
/** Inside the run's `.legal`: ripgrep's own ignore file, which Claude Code's Grep honours in and outside git. */
export const LEGAL_IGNORE_FILE = ".ignore";
export const LEGAL_IGNORE_TEXT = "*\n";
/** Inside the run's `.legal`: git's own ignore file. */
export const LEGAL_GITIGNORE_FILE = ".gitignore";
/**
 * THE FILES UNDER `.legal` THE PRODUCT ASKS THE PERSON TO COMMIT, and no other. The declaration and its
 * record: they are committed so that teammates can confirm the saved answers instead of answering again. No answer about the product is read in CI, and elsewhere a committed pair settles
 * nothing until the person running the scan confirms it in that folder on that computer (team-answers.ts). Both hold only the person's answers to the closed
 * questions (declaration.ts `writeDeclaration`, `rowFor`: a value is one of the question's own options, never text from
 * the tree), so neither can carry a line of the scanned code. Every other file under `.legal` is a working file of the
 * run, and many hold matched lines in clear on purpose (the payload windows, every seat's record, the quote check's
 * record): git ignores them all, including files a later version adds.
 */
export const LEGAL_COMMITTED_FILES = ["profile.json", "profile-record.json"] as const;
export const LEGAL_GITIGNORE_TEXT = [
  // what to keep, said here.
  "# Written by the compliance scanner. git ignores this folder except your answers about the product: many files here",
  "# hold lines of this repository's code in clear, including lines from files git ignores. evidence/ holds your",
  "# reviews, which the next scan reuses; README.txt says what may be deleted.",
  "*",
  ...LEGAL_COMMITTED_FILES.map((f) => `!/${f}`),
  "",
].join("\n");

/**
 * THE ONE WRITER OF `.legal/.ignore` AND `.legal/.gitignore`.
 * `.legal/` sits inside the tree a seat searches, and in the
 * owner's second live run 42 content-mode Greps by 35 refuters printed lines from the run's own records there. A
 * `.ignore` holding `*` inside `.legal` hides every file below it from Claude Code's Grep, which is ripgrep with its
 * ignore files on, whether or not the tree is a git repository. It does not hide them from Glob (which passes
 * `--no-ignore` by default, so the names are still listed), from a Grep or Read aimed at an explicit file, or from a
 * Grep glob that whitelists a file (ripgrep's globs override ignore files); the seat-read route (hook-seat-read.ts)
 * refuses the calls aimed at `.legal`.
 *
 * THE `.gitignore` BESIDE IT. Until 2026-10-12 only the `.ignore` was written, "so git's view
 * of the person's tree does not change", and so git saw every file under `.legal`: `git add -A` staged the payload
 * windows, which copy lines from git-ignored files (`.env`) into a folder git does not ignore. The `.gitignore` is an
 * allow-list - `*`, then `!/<file>` for each of `LEGAL_COMMITTED_FILES` - so a working file is ignored by default, and a
 * file a later version writes cannot reach git by being forgotten here. It matches itself and the `.ignore`, so `git
 * status` shows neither; git still reads an ignored `.gitignore`. ripgrep reads it too, but `.ignore` ranks above
 * `.gitignore` there, so the seats' view is the `.ignore`'s alone. It never touches a tracked file: git ignores only
 * what it does not track.
 *
 * Each is written once, where there is none: one already there is kept as it is (the person's own). Called where a run
 * starts (writeActiveRun), where the scan creates the folder its findings go to (index.ts, `scan --out
 * .legal/findings.json`), and before every command whose path options name a place inside a `.legal` folder (index.ts,
 * the program's `preAction` hook); it creates `.legal` where it is missing. Returns whether it wrote the `.ignore`.
 */
export function writeLegalIgnore(legalDir: string): boolean {
  const existed = existsSync(legalDir);
  makeFolder(legalDir, { recursive: true });
  const git = createExclusive(join(legalDir, LEGAL_GITIGNORE_FILE), LEGAL_GITIGNORE_TEXT);
  const own = createExclusive(join(legalDir, LEGAL_IGNORE_FILE), LEGAL_IGNORE_TEXT);
  if (git || own || !existed) ignoreFilesWritten.add(legalDir);
  return own;
}

/** The `.legal` folders this process created or gave ignore files to, in the order it did. */
const ignoreFilesWritten = new Set<string>();

/**
 * "NOTHING WAS WRITTEN", AS IT IS. The program's
 * `preAction` hook gives every `.legal` folder a command names its ignore files before the command runs (index.ts), so a
 * command refused afterwards has written those two files, and the folder where it was missing. Until 2026-11-10 its
 * refusal said "Nothing was scanned or written" all the same. Every such sentence takes its words from here: "Nothing was
 * written", or, where this process wrote them, which folder's ignore files it wrote and why.
 */
export function nothingWrittenWords(): string {
  if (ignoreFilesWritten.size === 0) return "Nothing was written";
  const folders = [...ignoreFilesWritten].map((d) => JSON.stringify(d)).join(", ");
  return `Nothing was written but the ignore files (.gitignore and .ignore) of ${folders}, which keep the working files of a .legal folder out of git`;
}

/**
 * THE FOLDER THAT STOPS A WRITE INTO `dir` FOR
 * WANT OF PERMISSION, asked before a byte of the tree is read: `dir` itself where it exists, else the nearest folder above
 * it that exists (where `dir` would be made), when this process may not write and enter it (the permission bits, an ACL,
 * a read-only mount: `access`). Null where it can be written, and where what stands there is not a folder or cannot be
 * looked at (not a permission matter: the write's own refusal says what it is). Nothing is written.
 */
export function folderNotWritable(dir: string): string | null {
  let at = resolve(dir);
  for (;;) {
    let isFolder: boolean;
    try {
      isFolder = statSync(at).isDirectory();
    } catch (e) {
      const up = dirname(at);
      if ((e as NodeJS.ErrnoException).code !== "ENOENT" || up === at) return null;
      at = up;
      continue;
    }
    if (!isFolder) return null;
    try {
      accessSync(at, fsConstants.W_OK | fsConstants.X_OK);
      return null;
    } catch {
      return at;
    }
  }
}

/**
 * THE FOLDER OF A FILE A COMMAND IS ABOUT TO WRITE: created, and where it sits inside a
 * `.legal` folder, that folder's ignore files written first. The `preAction` hook (index.ts) sees only the values
 * commander holds, and a default a command applies in its own code (`opts.out ?? ".legal/verdict-reading.json"`) is not
 * one of them: run without `--out` in a project with no `.legal`, `verdict-reading` created the folder and wrote its
 * file with no ignore file. So the guard sits at the write: every output folder index.ts creates goes through here, and
 * test:line-text-redaction holds index.ts to that (no bare `mkdirSync(dirname(...))` left).
 */
export function prepareOutputFolder(file: string): void {
  const dir = dirname(resolve(file));
  const legal = legalDirOf(dir);
  if (legal !== null) writeLegalIgnore(legal);
  makeFolder(dir, { recursive: true });
}

/**
 * The `.legal` folder a path sits in - the nearest folder of that name among the path's own segments - or null. Used by
 * the program's `preAction` hook (index.ts) to write that folder's ignore files before a command writes into it.
 */
export function legalDirOf(path: string): string | null {
  let at = resolve(path);
  for (;;) {
    if (basename(at) === LEGAL_DIR_NAME) return at;
    const up = dirname(at);
    if (up === at) return null;
    at = up;
  }
}

/**
 * A WORKING FOLDER OUTSIDE `.legal`. The class: a file holding the scanned code in clear is
 * written only into a folder that carries the product's ignore files. `scan --out out/findings.json` wrote its payload
 * windows to `out/payloads/`, where `git add -A` stages them; so did `--carry-into`, `--assemble-into` and a
 * `--launch-dir` outside `.legal`. THE SHAPE CHOSEN: the ignore files go into every working folder the program writes
 * such files to, rather than the payloads always going under `.legal` - that would write into the scanned tree's
 * `.legal` from any `--out`, and change the payload paths findings.json and the launch list record.
 *
 * Inside a `.legal` folder: that folder's own two files (`writeLegalIgnore`). Elsewhere: this folder's `.gitignore` and
 * `.ignore`, each `*`, written once where there is none (one already there is the person's own, and kept). Only into a
 * folder the program owns: one it creates now, one that is empty, or (`owned`) one only this program writes, such as
 * `payloads/`, or one holding this program's own `.gitignore` from an earlier run. A folder the person named that already holds other files is never given a `*` ignore file, which would
 * hide their own files from git: the program says once, on stderr, that the files it writes there hold lines of the
 * scanned code in clear. Returns the folder's state.
 */
export const WORKING_GITIGNORE_TEXT = [
  "# Written by the compliance scanner. The files in this folder hold lines of the scanned code in clear: git ignores",
  "# all of them.",
  "*",
  "",
].join("\n");
const warnedFolders = new Set<string>();
export function guardWorkingFolder(dir: string, owned = false): "legal" | "guarded" | "warned" {
  const at = resolve(dir);
  const legal = legalDirOf(at);
  if (legal !== null) {
    writeLegalIgnore(legal);
    makeFolder(at, { recursive: true });
    return "legal";
  }
  let empty = true;
  try {
    empty = readdirSync(at).filter((n) => n !== LEGAL_GITIGNORE_FILE && n !== LEGAL_IGNORE_FILE).length === 0;
  } catch {
    empty = true;
  }
  let ours = false;
  try {
    ours = readRegularFile(join(at, LEGAL_GITIGNORE_FILE), "utf8") === WORKING_GITIGNORE_TEXT;
  } catch {
    ours = false;
  }
  makeFolder(at, { recursive: true });
  if (owned || empty || ours) {
    createExclusive(join(at, LEGAL_GITIGNORE_FILE), WORKING_GITIGNORE_TEXT);
    createExclusive(join(at, LEGAL_IGNORE_FILE), LEGAL_IGNORE_TEXT);
    return "guarded";
  }
  if (!warnedFolders.has(at)) {
    warnedFolders.add(at);
    process.stderr.write(
      `Note: ${at} already holds other files, so this program wrote no ignore file there. The files it writes into it hold lines of the scanned code in clear: keep them out of git (a .gitignore in that folder, or a folder of their own).\n`,
    );
  }
  return "warned";
}

/**
 * WHEN THE PERSON'S OWN `.legal/.gitignore` LETS A WORKING FILE THROUGH. `writeLegalIgnore`
 * keeps a `.gitignore` already there as it is - the person's own - and git ignores only what it does not track. So
 * a working file can still reach git two ways: the person's own `.gitignore` does not ignore it, or git already tracks
 * it (committed before the product wrote its own). Asked of git itself, once per command and folder (the program's
 * `preAction` hook, index.ts; never inside `writeLegalIgnore`, which the hooks call on every event): a probe path of
 * the shape the payload windows take, `git check-ignore`, where the `.gitignore` is not the product's text; and `git
 * ls-files` under the folder, beyond `LEGAL_COMMITTED_FILES`. Returns the plain sentences to print on stderr - none
 * outside a git work tree, or where nothing gets through.
 *
 * WHERE GIT IS NOT RUN. `gitRunnerOrWhy` refuses a git older than 2.31 (it would run what the folder's own
 * config names), one it cannot find outside the project, and one that cannot read the folder's config. These two checks
 * are the only things git is asked in a scan: the files a scan reads come from its own walk (walk.ts), which takes
 * neither its file list nor its ignore rules from git, so a scan without git reads exactly what it reads with it. What
 * is lost is the two checks, and until this was fixed they were lost silently: no note read the same as "nothing gets through".
 * Inside a git work tree (a `.git` at the folder or above it, found by name the way git looks, with no git run) the
 * person is now told that git was not run, why, that the scan read the same files, and what to do.
 */
const toldFolders = new Set<string>();

/**
 * The nearest of `folder` and the folders above it that holds a `.git` (a folder, or the file a worktree or submodule
 * has), or null where none does. Exported for the person's state-folder records, which
 * are refused inside any git work tree by this same rule.
 */
export function workTreeHolding(folder: string): string | null {
  for (let at = resolve(folder); ; at = dirname(at)) {
    if (existsSync(join(at, ".git"))) return at;
    if (dirname(at) === at) return null;
  }
}

/** Whether `folder` or a folder above it holds a `.git` (a folder, or the file a worktree or submodule has). */
function insideWorkTreeByName(folder: string): boolean {
  return workTreeHolding(folder) !== null;
}

/** The sentence a person reads where git was not run in a work tree: what was not checked, why, what did not change. */
export function gitNotRunNote(legalDir: string, why: string): string {
  return `Note: git was not run: ${why}. So this program did not check whether git would stage its working files under ${legalDir}, which hold lines of the scanned code in clear (the .gitignore this program writes there keeps them out of git, unless that .gitignore is your own or git already tracks them). What the scan read does not change: it never takes its file list or its ignore rules from git. Put git 2.31 or later on PATH to have this checked.`;
}

export function legalIgnoreLeaks(legalDir: string): string[] {
  const at = resolve(legalDir);
  if (toldFolders.has(at)) return [];
  toldFolders.add(at);
  const cwd = dirname(at);
  // Git is run so that nothing the folder holds chooses a program for it - its own
  // config's fsmonitor, hooks, drivers and transports, or a `git` of its own on PATH (child-program.ts).
  const runner = gitRunnerOrWhy(cwd);
  if ("why" in runner) return insideWorkTreeByName(cwd) ? [gitNotRunNote(at, runner.why)] : [];
  const git = runner.run;
  const inside = git(["rev-parse", "--is-inside-work-tree"]);
  if (inside.error || inside.status !== 0 || inside.stdout.trim() !== "true") return [];
  const out: string[] = [];
  let own = "";
  try {
    own = readRegularFile(join(at, LEGAL_GITIGNORE_FILE), "utf8");
  } catch (e) {
    own = "";
    // A .gitignore that is not a regular file is named, not taken for a missing one: it was not
    // read, so what it would keep out of git was not checked.
    const not = asNotRegular(e);
    if (not !== null) {
      out.push(
        `Note: ${not.path} is ${whyNotRead(not.kind, not.throughLink)}, so this program did not read it, and did not check whether git would stage its working files under ${at}, which hold lines of the scanned code in clear. Delete it and the program writes its own .gitignore there.`,
      );
    }
  }
  if (own !== "" && own !== LEGAL_GITIGNORE_TEXT) {
    // Two probe paths of the shapes the run writes: a payload window and the evidence log. Written in git's own "/" form
    // on every system: git
    // prints the paths it ignores in that form, so a probe made with the system's separator ("\" on Windows) was never
    // found in its answer, and a .gitignore that ignores everything but the two committed files was said to let the
    // working files through.
    const probes = [`${LEGAL_DIR_NAME}/payloads/fp_probe-0000000000.json`, `${LEGAL_DIR_NAME}/evidence/log.json`];
    const ignored = git(["check-ignore", "--no-index", ...probes]);
    const through = ignored.error || ignored.status === 128 ? [] : probes.filter((p) => !ignored.stdout.split(/\r?\n/).includes(p));
    const probe = through[0];
    if (probe !== undefined) {
      out.push(
        `Note: git would stage this program's working files under ${at}: its .gitignore is your own and does not ignore them (git check-ignore ${probe}). They hold lines of the scanned code in clear. Make that .gitignore ignore everything but profile.json and profile-record.json (\`*\`, \`!/profile.json\`, \`!/profile-record.json\`), or delete it and the program writes its own.`,
      );
    }
  }
  const listed = git(["ls-files", "-z", "--", LEGAL_DIR_NAME]);
  if (!listed.error && listed.status === 0) {
    const keep = new Set<string>(LEGAL_COMMITTED_FILES);
    const tracked = listed.stdout
      .split("\0")
      .filter((f) => f !== "")
      .filter((f) => !keep.has(relativePath(at, resolve(cwd, f))));
    if (tracked.length > 0) {
      out.push(
        `Note: git tracks ${tracked.length} working file(s) under ${at} (${tracked.slice(0, 3).join(", ")}${tracked.length > 3 ? ", ..." : ""}): they can hold lines of the scanned code in clear. Only profile.json and profile-record.json belong in git; take the others out of it with \`git rm --cached\`.`,
      );
    }
  }
  return out;
}

/**
 * The `.legal` folders a command's options name: every option value, of every option the command defines,
 * that lies inside a `.legal` folder - where the folder exists, or where the person gave the value on the command line.
 * Derived from the command's own option definitions (`opts()` and `getOptionValueSource`), so no list of options is
 * kept anywhere. Exported for a test, which drives it with every path option of every
 * command the CLI's help lists.
 */
/**
 * AN OPTION THAT ONLY READS AN EARLIER RECORD names a
 * folder the command reads and never writes, which can be another project's: `adjudicate --previous` (and its
 * `--previous-findings`). The mark is on the option itself (`readOnlyInput`), so no list of options is kept here and an
 * option not marked is looked at as before.
 */
const READ_ONLY_OPTIONS = new WeakSet<object>();
export function readOnlyInput<T extends object>(option: T): T {
  READ_ONLY_OPTIONS.add(option);
  return option;
}

/**
 * The `.legal` folders a command names ONLY through read-only options (`readOnlyInput`), less the scanned project's own
 * (`projectLegal`, the `.legal` of --target): the `preAction` hook writes no ignore file into them. A folder another
 * option also names, or the project's own, keeps the protective write.
 */
export function legalFoldersOnlyRead(
  command: { opts(): Record<string, unknown>; getOptionValueSource(key: string): string | undefined; options?: readonly object[] },
  projectLegal: string | null,
): Set<string> {
  const readOnlyKeys = new Set(
    (command.options ?? []).filter((o) => READ_ONLY_OPTIONS.has(o)).map((o) => (o as { attributeName(): string }).attributeName()),
  );
  if (readOnlyKeys.size === 0) return new Set();
  const written = new Set(
    legalFoldersNamed({
      opts: () => Object.fromEntries(Object.entries(command.opts()).filter(([k]) => !readOnlyKeys.has(k))),
      getOptionValueSource: (k) => command.getOptionValueSource(k),
    }),
  );
  return new Set(legalFoldersNamed(command).filter((l) => !written.has(l) && l !== projectLegal));
}

export function legalFoldersNamed(command: {
  opts(): Record<string, unknown>;
  getOptionValueSource(key: string): string | undefined;
}): string[] {
  const found = new Set<string>();
  for (const [key, value] of Object.entries(command.opts())) {
    const given = command.getOptionValueSource(key) === "cli";
    for (const v of Array.isArray(value) ? value : [value]) {
      if (typeof v !== "string" || v === "" || v.includes("://")) continue;
      const legal = legalDirOf(v);
      if (legal !== null && (given || existsSync(legal))) found.add(legal);
    }
  }
  return [...found];
}
