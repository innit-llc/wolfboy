/**
 * THE RULES CHECK IN CI (release 1). No AI review runs in CI in release 1, so what a
 * team's pull request is shown is the rules check: places that match rules, COUNTED by the rule's plain name and never
 * listed by line (an unjudged match listed by line reads as a finding, and it is not one), the changes the pull request
 * makes to the team's saved answers, and what was not checked. The step is in the team's own job; the program creates
 * no job and never sets `success`.
 *
 * What this module holds:
 *  - the changed lines of a comparison (`changedLinesOrWhy`): the lines HEAD adds or changes against a base commit, read
 *    through the one git runner (child-program.ts), so nothing the folder holds chooses a program;
 *  - which matched places a run counts (`countedPlaces`): on a comparison only those on changed lines, else every place;
 *  - the step summary (`ciSummaryLines`), the check run's title, the annotations on changed answer files;
 *  - the check run itself (`postCheckRun`), posted where the job's token may write checks, and only there.
 *
 * Answers about the product are not read in CI in release 1: this module never reads
 * them to decide anything. It reads the two committed answer files of the base and of HEAD only to say what a pull
 * request changes in them, which the summary and the annotation show.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Findings, FindingLocation, Rule } from "wolfboy-schemas";
import { gitRunnerOrWhy, type GitRunner } from "./child-program.js";
import { LEGAL_COMMITTED_FILES } from "./legal-dir.js";
import { relativePath } from "./project-path.js";
import { inertJoin, inertPrinted, inertSlice, markdownText, markdownValue, md, ours, programText, valueShown, valueText, type Inert } from "./printed-output.js";
import { appendFileAt, makeTempFolder, removePath } from "./project-write.js";
import { fetchHonouringProxy } from "./proxied-fetch.js";

/**
 * The GitHub Actions variables the rules check reads (GitHub sets each in a job; the README's example passes GITHUB_TOKEN).
 * host-env.ts lists them, so the gates' helper drops each and no real token or address reaches a gate's run.
 */
export const GITHUB_ACTIONS_ENV = "GITHUB_ACTIONS";
export const GITHUB_EVENT_NAME_ENV = "GITHUB_EVENT_NAME";
export const GITHUB_EVENT_PATH_ENV = "GITHUB_EVENT_PATH";
export const GITHUB_SHA_ENV = "GITHUB_SHA";
export const GITHUB_REPOSITORY_ENV = "GITHUB_REPOSITORY";
export const GITHUB_TOKEN_ENV = "GITHUB_TOKEN";
export const GITHUB_API_URL_ENV = "GITHUB_API_URL";
export const GITHUB_WORKFLOW_REF_ENV = "GITHUB_WORKFLOW_REF";
export const GITHUB_WORKSPACE_ENV = "GITHUB_WORKSPACE";
export const GITHUB_STEP_SUMMARY_ENV = "GITHUB_STEP_SUMMARY";

/** The step's name in the README's example and the check run's name: the tick beside it means only that it ran. */
export const CHECK_NAME = "WolfBoy rules check (no AI review)";

/** One changed file of the comparison, its path relative to the scanned folder. */
export interface ChangedFile {
  path: string;
  status: "added" | "changed" | "deleted";
  binary: boolean;
}

/** A comparison of HEAD with a base commit, from the scanned folder. */
export interface ChangedLines {
  /** The base as given (`--changed-since`, or HEAD^1 on a pull request) and the commit it names. */
  base: string;
  baseSha: string;
  /** Path relative to the scanned folder -> the HEAD-side line ranges [first, last] that HEAD adds or changes. */
  lines: Map<string, Array<[number, number]>>;
  /** Every changed file under the scanned folder. */
  files: ChangedFile[];
  /**
   * The committed answer files the comparison changes, path relative to the repository's root, with what changed: `what`
   * for the markdown the summary and the check run show, `plain` for the annotation, which GitHub shows as plain text.
   */
  answerFiles: Array<{ path: string; status: ChangedFile["status"]; what: Inert[]; plain: string[] }>;
}

/** Reverses git's C-style quoting of a path in a diff header ("a/x\tb" with octal escapes for bytes). */
export function unquoteGitPath(s: string): string {
  if (!s.startsWith('"')) return s;
  const bytes: number[] = [];
  const named: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
  for (let i = 1; i < s.length - 1; i++) {
    const ch = s[i] as string;
    if (ch !== "\\") {
      bytes.push(...Buffer.from(ch, "utf8"));
      continue;
    }
    const next = s[i + 1] as string;
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(s.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      bytes.push(named[next] ?? next.charCodeAt(0));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/**
 * The HEAD-side ranges each file's hunks add or change, from `git diff -U0` output. A hunk header is
 * `@@ -a[,b] +c[,d] @@`; `b` or `d` omitted means 1, and `d` = 0 is a pure deletion, which adds no line.
 *
 * Each hunk's body is read by its header's counts: `-U0` has no context lines, so exactly `b` deleted and `d` added lines
 * follow the header (git's "\ No newline at end of file" lines aside), and only a line outside a body is read as a header.
 * A body line is the pull request's own text: an added line whose text starts with "++ " is shown as "+++ ...", and read
 * as a file header it moved every later hunk of that file onto a path of the author's choosing (C4 item 1, 2026-11-08).
 */
export function parseUnifiedZero(patch: string): Map<string, Array<[number, number]>> {
  const out = new Map<string, Array<[number, number]>>();
  let current: string | null = null;
  let body = 0;
  for (const line of patch.split("\n")) {
    if (body > 0) {
      if (line.startsWith("\\")) continue;
      if (line.startsWith("-") || line.startsWith("+") || line.startsWith(" ")) {
        body -= 1;
        continue;
      }
      // Not a body line where one was due: the patch is not what -U0 writes; read the line as a header.
      body = 0;
    }
    if (line.startsWith("diff --git ")) {
      current = null;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const p = line.slice(4).replace(/\t$/, "");
      const path = unquoteGitPath(p);
      current = path === "/dev/null" ? null : path.replace(/^"?b\//, "");
      if (current !== null && !out.has(current)) out.set(current, []);
      continue;
    }
    const m = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m !== null) {
      const deleted = m[1] === undefined ? 1 : Number(m[1]);
      const start = Number(m[2]);
      const count = m[3] === undefined ? 1 : Number(m[3]);
      body = deleted + count;
      if (current !== null && count > 0) (out.get(current) as Array<[number, number]>).push([start, start + count - 1]);
    }
  }
  return out;
}

/**
 * Text printed in CI with every control character written as an escape (`\n`, `\r`, `\t`, `\u001b`, ...), the line
 * separators U+2028 and U+2029 included. A path, a key or a value holding a line break otherwise starts a log line of a
 * pull request's choosing, and GitHub Actions runs a log line starting with `::` as a workflow command (C4 item 2,
 * 2026-11-08). Every value the rules check prints passes through here; the line breaks between its lines are the
 * program's own. It is printed-output.ts `valueText`: the printed form, applied to every write there, does the rest.
 */
export const ciText = valueText;

/**
 *
 * Repository text as every printer shows it: `ciText`, then the printed form (printed-output.ts `printedForm`, which every
 * write passes through, terminal included: the CI openers and the control characters escaped). GitHub Actions reads
 * `::` commands at the start of a line only, and stops reading them for the whole step (`stopWorkflowCommands`).
 */
export const ciShown = valueShown;

/**
 * A copy of `value` with every string in it, object keys included, as `ciShown` prints it: what the CI form's printers
 * (the first screen, the candidate rows, the summary, the cost preview) read, so that no path or line of the
 * repository reaches the log as it is. The document written to `--out` and every count keep the scan's own `value`.
 */
export function ciShownCopy<T>(value: T): T {
  const walk = (v: unknown): unknown =>
    typeof v === "string"
      ? ciShown(v)
      : Array.isArray(v)
        ? v.map(walk)
        : v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [ciShown(k), walk(x)]))
          : v;
  return walk(value) as T;
}

/**
 * Stops GitHub Actions from running workflow commands in this step's log until `resume` [GitHub's documented
 * `::stop-commands::<token>` ... `::<token>::`]. The rules check prints repository text in its report (paths, matched
 * lines) as well as in its summary, and a line of it starting with `::` would otherwise run as a command (C4 item 2).
 * The token is random per run, so no text in the repository can end the stop. The step resumes only to print the
 * program's own annotations; on any other exit the handler resumes, so that commands the job prints later in the same
 * step still run.
 */
export function stopWorkflowCommands(write: (line: string) => void = (l) => process.stdout.write(`${l}\n`)): { resume: () => void } {
  const token = randomBytes(16).toString("hex");
  write(`::stop-commands::${token}`);
  let resumed = false;
  const resume = (): void => {
    if (resumed) return;
    resumed = true;
    write(`::${token}::`);
  };
  process.once("exit", resume);
  return { resume };
}

const STATUS: Record<string, ChangedFile["status"]> = { A: "added", D: "deleted" };

/** `git diff --name-status -z` output -> path and status pairs (copies and renames are off: `--no-renames`). */
function nameStatus(out: string): Array<{ path: string; status: ChangedFile["status"] }> {
  const parts = out.split("\0").filter((p) => p !== "");
  const rows: Array<{ path: string; status: ChangedFile["status"] }> = [];
  for (let i = 0; i + 1 < parts.length; i += 2) rows.push({ path: parts[i + 1] as string, status: STATUS[(parts[i] as string)[0] as string] ?? "changed" });
  return rows;
}

/** `git diff --numstat -z` output -> the paths git calls binary ("-\t-\t<path>"). */
function binaryPaths(out: string): Set<string> {
  const set = new Set<string>();
  for (const row of out.split("\0")) {
    const m = /^-\t-\t(.*)$/s.exec(row);
    if (m !== null) set.add(m[1] as string);
  }
  return set;
}

/** One JSON document's leaves, as dotted key -> JSON text, for saying what a change of an answer file changed. */
function leaves(value: unknown, prefix: string, out: Map<string, string>): void {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) leaves(v, prefix === "" ? k : `${prefix}.${k}`, out);
    return;
  }
  out.set(prefix, JSON.stringify(value));
}

/** The keys two texts of `profile.json` differ on, sorted, each with its JSON text on both sides; null where one is not JSON. */
function answerDiff(before: string | null, after: string | null): Array<{ key: string; before: string | undefined; after: string | undefined }> | null {
  const parse = (t: string | null): Map<string, string> | null => {
    if (t === null) return new Map();
    try {
      const m = new Map<string, string>();
      leaves(JSON.parse(t), "", m);
      return m;
    } catch {
      return null;
    }
  };
  const a = parse(before);
  const b = parse(after);
  if (a === null || b === null) return null;
  return [...new Set([...a.keys(), ...b.keys()])]
    .filter((k) => a.get(k) !== b.get(k))
    .sort()
    .map((key) => ({ key, before: a.get(key), after: b.get(key) }));
}

/** What changed between two texts of `profile.json`, at most `cap` keys: "key: before -> after" ("not answered" where absent). */
export function answerChanges(before: string | null, after: string | null, cap = 4): Inert[] {
  const diff = answerDiff(before, after);
  if (diff === null) return [ours("not JSON on one side")];
  // Each key and value in a code span: the summary and the check run are
  // markdown, and a pull request writes the profile.
  const value = (v: string | undefined): Inert => (v === undefined ? ours("not answered") : markdownValue(v));
  const said = diff.slice(0, cap).map((d) => md`${markdownValue(d.key)}: ${value(d.before)} → ${value(d.after)}`);
  if (diff.length > cap) said.push(md`${diff.length - cap} more`);
  return said;
}

/**
 * The same changes for an annotation, which GitHub shows as plain text, so a code span's backticks would show as they are: the key in double quotes, each value as its JSON text
 * (a string already in quotes), every control character through `ciText`. The workflow command's own escaping is the
 * caller's (`answerFileAnnotations`).
 */
export function answerChangesPlain(before: string | null, after: string | null, cap = 4): string[] {
  const diff = answerDiff(before, after);
  if (diff === null) return ["not JSON on one side"];
  const value = (v: string | undefined): string => (v === undefined ? "not answered" : ciText(v));
  const said = diff.slice(0, cap).map((d) => `${ciText(JSON.stringify(d.key))}: ${value(d.before)} → ${value(d.after)}`);
  if (diff.length > cap) said.push(`${diff.length - cap} more`);
  return said;
}

/**
 * The lines HEAD adds or changes against `base`, read in the scanned folder. HEAD, not the working tree: on a pull request
 * the checkout is the merge commit, and a step before this one (installing a tool, a build) may write tracked files that
 * the pull request did not change. Null `why` explains, in words the person reads, why there is no comparison.
 */
export function changedLinesOrWhy(target: string, base: string): ChangedLines | { why: string } {
  const runner = gitRunnerOrWhy(target);
  if ("why" in runner) return { why: `git was not run: ${runner.why}` };
  const git: GitRunner = runner.run;
  const inside = git(["rev-parse", "--is-inside-work-tree"]);
  if (inside.status !== 0 || (inside.stdout ?? "").trim() !== "true") return { why: `${target} is not inside a git work tree, so there are no changed lines to compare` };
  const baseSha = git(["rev-parse", "--verify", "--quiet", "--end-of-options", `${base}^{commit}`]);
  if (baseSha.status !== 0 || (baseSha.stdout ?? "").trim() === "") {
    return { why: `the base ${JSON.stringify(base)} is not a commit in this checkout (on a pull request, actions/checkout needs fetch-depth: 2 so that the merge commit's first parent is present)` };
  }
  const sha = (baseSha.stdout ?? "").trim();
  // The prefixes are named so that the folder's own diff.noprefix or diff.mnemonicPrefix cannot change the headers read below.
  const common = ["--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/"];
  const names = git(["diff", ...common, "--relative", "--name-status", "-z", sha, "HEAD"]);
  const nums = git(["diff", ...common, "--relative", "--numstat", "-z", sha, "HEAD"]);
  const rootNames = git(["diff", ...common, "--name-status", "-z", sha, "HEAD"]);
  if (names.status !== 0 || nums.status !== 0 || rootNames.status !== 0) return { why: `git could not compare ${base} with HEAD` };
  // The patch goes to a file, not through the runner's pipe, whose buffer a large pull request would overflow.
  const tmp = makeTempFolder("wolfboy-diff-");
  try {
    const patchFile = join(tmp, "patch");
    const patch = git(["diff", ...common, "--relative", "-U0", `--output=${patchFile}`, sha, "HEAD"]);
    if (patch.status !== 0) return { why: `git could not compare ${base} with HEAD` };
    const lines = parseUnifiedZero(readFileSync(patchFile, "utf8"));
    const binary = binaryPaths(nums.stdout ?? "");
    const files = nameStatus(names.stdout ?? "").map((r) => ({ ...r, binary: binary.has(r.path) }));
    const committed = new Set<string>(LEGAL_COMMITTED_FILES);
    const answerFiles = nameStatus(rootNames.stdout ?? "")
      .filter((r) => /(^|\/)\.legal\/[^/]+$/.test(r.path) && committed.has(r.path.slice(r.path.lastIndexOf("/") + 1)))
      .map((r) => {
        if (!r.path.endsWith("profile.json")) return { ...r, what: [], plain: [] };
        const show = (rev: string): string | null => {
          const s = git(["show", `${rev}:${r.path}`]);
          return s.status === 0 ? (s.stdout ?? "") : null;
        };
        const before = r.status === "added" ? null : show(sha);
        const after = r.status === "deleted" ? null : show("HEAD");
        return { ...r, what: answerChanges(before, after), plain: answerChangesPlain(before, after) };
      });
    return { base, baseSha: sha, lines, files, answerFiles };
  } finally {
    removePath(tmp, { recursive: true, force: true });
  }
}

/** The parts of a GitHub event's payload the rules check reads; null where the payload is absent or not JSON. */
interface EventPayload {
  pull_request?: { number?: unknown; head?: { sha?: unknown }; base?: { sha?: unknown } };
  merge_group?: { head_sha?: unknown; base_sha?: unknown };
}

function eventPayload(env: NodeJS.ProcessEnv): EventPayload | null {
  const path = env[GITHUB_EVENT_PATH_ENV];
  if (!path) return null;
  try {
    const ev = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return ev !== null && typeof ev === "object" ? (ev as EventPayload) : null;
  } catch {
    return null;
  }
}

/** A commit name from the payload: a hex object name, else null (never an option or a revision expression). */
const objectName = (v: unknown): string | null => (typeof v === "string" && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(v) ? v : null);

const short = (sha: string): string => sha.slice(0, 12);

/**
 * THE BASE A CI RUN COMPARES WITH WHEN NONE IS GIVEN,
 * the design's "gate's scope". Null on an event with nothing to compare with (a push, a schedule): the whole tree counts.
 *
 * - `pull_request`: the lines the pull request adds or changes. With the merge commit checked out (actions/checkout's
 *   default, `GITHUB_SHA`, or a merge commit whose second parent is the pull request's head), its first parent, the base
 *   branch's head, as before. With any other checkout (a job that checks out `pull_request.head.sha`), HEAD^1 is the
 *   pull request's own previous commit, and comparing with it counted only the last commit's lines: a pull request whose
 *   first commit added 9 places counted 0, and the gate never fired. That checkout compares with the merge base of HEAD and
 *   the pull request's base (`pull_request.base.sha`) where the base is in the checkout, and is refused, naming the fix,
 *   where it is not. A payload that names no head keeps HEAD^1.
 * - `merge_group`: the lines the queued entry adds or changes against the queue's base (`merge_group.base_sha`), so the
 *   gate never stops a queued pull request on matches it did not add; the whole tree counted before, and every queued
 *   pull request failed while any place at the gate's level stood anywhere in the base. Refused, naming the fix, where the
 *   base is not in the checkout (the entry sits one or more commits above it).
 */
export function ciBase(env: NodeJS.ProcessEnv, target: string): { base: string } | { why: string } | null {
  const name = env[GITHUB_EVENT_NAME_ENV];
  if (name !== "pull_request" && name !== "merge_group") return null;
  const ev = eventPayload(env);
  const runner = gitRunnerOrWhy(target);
  // No git: the comparison's own refusal (changedLinesOrWhy) says why, with the base it would have used.
  if ("why" in runner) return { base: name === "pull_request" ? "HEAD^1" : (objectName(ev?.merge_group?.base_sha) ?? "HEAD^1") };
  const git: GitRunner = runner.run;
  const out = (args: string[]): string | null => {
    const r = git(args);
    return r.status === 0 ? (r.stdout ?? "").trim() : null;
  };
  const headNow = out(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  const present = (sha: string): boolean => out(["rev-parse", "--verify", "--quiet", "--end-of-options", `${sha}^{commit}`]) === sha;
  const mergeBase = (sha: string): string | null => (present(sha) ? out(["merge-base", "HEAD", sha]) : null);
  if (name === "pull_request") {
    const head = objectName(ev?.pull_request?.head?.sha);
    const base = objectName(ev?.pull_request?.base?.sha);
    if (head === null || headNow === null || headNow === env[GITHUB_SHA_ENV]) return { base: "HEAD^1" };
    const parents = (out(["rev-list", "--parents", "-n", "1", "HEAD"]) ?? "").split(" ").slice(1);
    if (parents.length === 2 && parents[1] === head) return { base: "HEAD^1" };
    const from = base === null ? null : mergeBase(base);
    if (from !== null && from !== "") return { base: from };
    const what = headNow === head ? "is the pull request's head commit" : "is neither the pull request's merge commit nor its head";
    return {
      why:
        `this checkout's HEAD (${short(headNow)}) ${what}, and the pull request's base ${base === null ? "is not named in the event" : `(${short(base)}) is not in this checkout`}, ` +
        "so the lines this pull request adds or changes cannot be found: check out the merge commit (actions/checkout without ref:, with fetch-depth: 2), " +
        "or fetch the base too (fetch-depth: 0), or pass --changed-since <base>",
    };
  }
  const base = objectName(ev?.merge_group?.base_sha);
  if (base === null) return { why: "the merge_group event names no base commit (merge_group.base_sha), so the lines this entry adds or changes cannot be found: pass --changed-since <base>" };
  const from = mergeBase(base);
  if (from !== null && from !== "") return { base: from };
  return {
    why: `the merge queue's base (${short(base)}) is not in this checkout, so the lines this entry adds or changes cannot be found: give actions/checkout fetch-depth: 0 (an entry sits one or more commits above its base), or pass --changed-since <base>`,
  };
}

const slash = (p: string): string => p.replace(/\\/g, "/");

/** Whether one matched place is on a line the comparison adds or changes; every place counts where there is none. */
export function onChangedLines(changed: ChangedLines | null, loc: FindingLocation): boolean {
  if (changed === null) return true;
  const ranges = changed.lines.get(slash(loc.file));
  if (ranges === undefined) return false;
  const last = loc.end_line ?? loc.start_line;
  return ranges.some(([a, b]) => loc.start_line <= b && last >= a);
}

/** The places a run counts, by rule id, with the severity of each rule's candidates. */
export interface CountedPlaces {
  total: number;
  byRule: Map<string, number>;
  /** Places at each severity, for `--fail-on-unreviewed`. */
  bySeverity: { high: number; medium: number; low: number };
  /** Every rule the run ran (candidates and the roster of rules without one). */
  rulesRun: number;
}

export function countedPlaces(f: Findings, changed: ChangedLines | null): CountedPlaces {
  const byRule = new Map<string, number>();
  const bySeverity = { high: 0, medium: 0, low: 0 };
  let total = 0;
  for (const c of f.candidates) {
    const n = c.locations.filter((l) => onChangedLines(changed, l)).length;
    if (n === 0) continue;
    total += n;
    byRule.set(c.rule_id, (byRule.get(c.rule_id) ?? 0) + n);
    bySeverity[c.severity] += n;
  }
  const rulesRun = new Set([...f.candidates.map((c) => c.rule_id), ...(f.rules_without_candidates ?? []).map((r) => r.rule_id)]).size;
  return { total, byRule, bySeverity, rulesRun };
}

/** At or above a level, counted. */
export function placesAtOrAbove(p: CountedPlaces, level: "high" | "medium" | "low"): number {
  return level === "high" ? p.bySeverity.high : level === "medium" ? p.bySeverity.high + p.bySeverity.medium : p.total;
}

/**
 * What the GitHub event names: the pull request's number and head commit, else the commit `GITHUB_SHA` names (on a
 * `merge_group` event the queued entry's head, where a required check is read), and whether it is a merge queue's entry.
 */
export interface EventFacts {
  pullRequest: number | null;
  headSha: string | null;
  mergeGroup: boolean;
}

export function eventFacts(env: NodeJS.ProcessEnv): EventFacts {
  if (env[GITHUB_EVENT_NAME_ENV] === "pull_request" && env[GITHUB_EVENT_PATH_ENV]) {
    // No payload to read: the check run is not posted on a guess (below).
    const ev = eventPayload(env);
    const pr = typeof ev?.pull_request?.number === "number" ? ev.pull_request.number : null;
    const head = typeof ev?.pull_request?.head?.sha === "string" ? ev.pull_request.head.sha : null;
    return { pullRequest: pr, headSha: head, mergeGroup: false };
  }
  return { pullRequest: null, headSha: env[GITHUB_SHA_ENV] ?? null, mergeGroup: env[GITHUB_EVENT_NAME_ENV] === "merge_group" };
}

/**
 * The workflow file that runs the step, relative to the scanned folder, from `GITHUB_WORKFLOW_REF`
 * (`owner/repo/.github/workflows/ci.yml@refs/heads/main`); null outside GitHub Actions.
 */
export function workflowFile(env: NodeJS.ProcessEnv, target: string): string | null {
  const ref = env[GITHUB_WORKFLOW_REF_ENV];
  if (!ref) return null;
  const at = ref.lastIndexOf("@");
  const path = (at > 0 ? ref.slice(0, at) : ref).split("/").slice(2).join("/");
  if (path === "") return null;
  const workspace = env[GITHUB_WORKSPACE_ENV];
  if (!workspace || resolve(workspace) === resolve(target)) return path;
  return relativePath(resolve(target), join(resolve(workspace), path));
}

/** What the run's summary and check run say, gathered once. */
export interface CiOutcome {
  changed: ChangedLines | null;
  places: CountedPlaces;
  /** No rule was offered a file (today's exit 4 outside CI): a line and the title, exit 0. */
  reachedNothing: boolean;
  /** Changed files under the scanned folder the scan did not read (not deleted). */
  notRead: { binary: number; other: number };
  /** Set when `--fail-on-unreviewed` stopped the step. */
  gate: { level: string; count: number } | null;
  /**
   * True where the scan ran inside a Claude Code session in
   * CI and read the saved answers about the product (the session's own path), so the summary does not say none were used.
   * Absent on the rules check, which never reads them.
   */
  answersUsedInSession?: boolean;
}

const plural = (n: number, one: Inert, many: Inert): Inert => md`${n} ${n === 1 ? one : many}`;

/** The check run's title: what ran, and the count. Plain text: GitHub shows a check run's title as it is. */
export function checkRunTitle(o: CiOutcome): string {
  if (o.gate !== null) return `--fail-on-unreviewed ${o.gate.level} stopped this step · ${plural(o.gate.count, ours("place"), ours("places"))} at ${o.gate.level} or above wait for a review`;
  if (o.reachedNothing) return "No AI review ran · no rule was offered a file, which is not a clean result";
  if (o.places.total === 0) return `No AI review ran · 0 places match rules ${o.changed ? "on the changed lines" : "in the whole tree"}, which is not a clean result`;
  return `No AI review ran · ${plural(o.places.total, ours("place waits"), ours("places wait"))} for a review`;
}

/**
 * The step summary. Markdown, shown by GitHub only: its lines
 * are `Inert`, every value of the event, the tree or the findings in a code span
 * (`markdownValue`) or through `markdownText`, and a rule's name the bundle's text.
 */
export function ciSummaryLines(o: CiOutcome, rules: Rule[], ev: EventFacts): Inert[] {
  // A rule's name as the bundle the program ships holds it: the program's text.
  const nameOf = new Map(rules.map((r) => [r.id, programText(ciText(r.short_name ?? r.title ?? r.id))]));
  const pr =
    o.changed !== null && ev.pullRequest !== null
      ? md` · pull request #${markdownText(String(ev.pullRequest))}`
      : o.changed !== null && ev.mergeGroup
        ? ours(" · merge queue")
        : ours("");
  const base = o.changed === null ? ours("") : markdownValue(o.changed.base);
  const where =
    o.changed === null
      ? ours("in the whole tree")
      : ev.pullRequest !== null
        ? ours("on lines this pull request adds or changes")
        : ev.mergeGroup
          ? ours("on lines this merge queue entry adds or changes")
          : md`on lines changed since ${base}`;
  const lines: Inert[] = [md`### ${programText(CHECK_NAME)}${pr}`, ours(""), ours("No AI review ran, so nothing below is a finding. A tick beside this step means only that the step ran."), ours("")];
  if (o.changed === null) lines.push(ours("- **Not a pull request:** matches in the whole tree, counted by rule name."));
  else if (o.changed.answerFiles.length > 0) {
    const files = inertJoin(o.changed.answerFiles.map((a) => md`${markdownValue(a.path)} ${markdownText(a.status)}`), ours(", "));
    const what = o.changed.answerFiles.flatMap((a) => a.what);
    lines.push(
      md`- **${ev.pullRequest !== null ? ours("This pull request changes") : ev.mergeGroup ? ours("This merge queue entry changes") : md`The commits since ${base} change`} the team's saved answers about the product** (${files}${what.length > 0 ? md`; ${inertJoin(what, ours("; "))}` : ours("")}). CI does not use them. The next scan asks before using them, except in the folder where they were written.`,
    );
  }
  if (o.reachedNothing) lines.push(ours("- **No rule was offered a file** in this tree, so nothing was matched against it. This is not a clean result."));
  const ranked = [...o.places.byRule.entries()].sort((a, b) => b[1] - a[1] || String(nameOf.get(a[0])).localeCompare(String(nameOf.get(b[0]))));
  // A rule id the bundle does not name comes from the findings: a value.
  const named = inertJoin(ranked.map(([id, n]) => md`"${nameOf.get(id) ?? markdownText(id)}" (${n})`), ours(" · "));
  lines.push(
    o.places.total === 0
      ? md`- **Places that match rules, waiting for a review:** 0 ${where}, which is not a clean result.`
      : md`- **Places that match rules, waiting for a review:** ${o.places.total} ${where}, under ${plural(ranked.length, ours("rule"), ours("rules"))}: ${named}. Only a review decides whether any is a problem.`,
  );
  if (o.gate !== null) {
    const level = markdownText(o.gate.level);
    lines.push(md`- **--fail-on-unreviewed ${level} stopped this step:** ${plural(o.gate.count, ours("place"), ours("places"))} at ${level} or above ${where} wait for a review. They are not findings.`);
  }
  lines.push(
    o.answersUsedInSession === true
      ? // Words
        ours("- **Answers about the product:** this scan ran inside a Claude Code session, which read the saved answers; the rules of every region ran.")
      : ours("- **Answers about the product:** none are used in CI, so the rules of every region ran."),
  );
  const silent = o.places.rulesRun - o.places.byRule.size;
  const notRead = o.notRead.binary + o.notRead.other;
  const notReadWords =
    notRead === 0
      ? ours("")
      : md` · ${plural(notRead, ours("changed file"), ours("changed files"))} not read (${o.notRead.other === 0 ? ours("binary") : o.notRead.binary === 0 ? ours("outside what this scan reads") : md`${o.notRead.binary} binary, ${o.notRead.other} outside what this scan reads`})`;
  lines.push(
    md`- **Not checked:** no AI review has run${pr === "" ? ours("") : ev.mergeGroup ? ours(" on this merge queue entry") : ours(" on this pull request")} · ${plural(silent, ours("rule"), ours("rules"))} found nothing ${o.changed === null ? ours("in this tree") : ours("on the changed files")}, which is not a clean result${o.changed === null ? ours("") : notReadWords}.`,
  );
  lines.push(ours("- **Findings** come from the AI review in your own Claude Code scans. A scan of the merged code reviews these places."));
  return lines;
}

/** The step summary's text in the printed form, as the step writes it and posts it. */
export function ciSummaryText(o: CiOutcome, rules: Rule[], ev: EventFacts): Inert {
  return inertPrinted(inertJoin(ciSummaryLines(o, rules, ev), ours("\n")));
}

/** The step summary appended to the file GitHub names: `Inert` only. */
export function appendStepSummary(path: string, body: Inert): void {
  appendFileAt(path, md`${body}\n`);
}

/** The workflow commands that annotate changed answer files (never a matched place). Repository-relative paths. */
export function answerFileAnnotations(changed: ChangedLines | null): string[] {
  if (changed === null) return [];
  const esc = (s: string): string => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const prop = (s: string): string => esc(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
  return changed.answerFiles.map(
    (a) =>
      `::notice file=${prop(a.path)},title=${prop("Saved answers about the product changed")}::` +
      esc(`This change ${a.status === "added" ? "adds" : a.status === "deleted" ? "deletes" : "changes"} ${ciText(a.path)}${a.plain.length > 0 ? ` (${a.plain.join("; ")})` : ""}. CI does not use it. The next scan asks before using it, except in the folder where it was written.`),
  );
}

/**
 * Posts the one check run, where the job's token may write checks. Returns the line the log prints. Never throws, and the
 * step's exit does not depend on it: on a fork's pull request the token is read-only and the summary is all there is.
 */
export async function postCheckRun(env: NodeJS.ProcessEnv, ev: EventFacts, o: CiOutcome, body: Inert): Promise<string> {
  if (env[GITHUB_ACTIONS_ENV] !== "true") return "";
  const token = env[GITHUB_TOKEN_ENV];
  const repo = env[GITHUB_REPOSITORY_ENV];
  if (!token || !repo) return "No check run was created: GITHUB_TOKEN is not given to this step (the README's example passes it, with checks: write). The step summary is all there is.";
  if (!ev.headSha) return "No check run was created: the event names no commit to post it on. The step summary is all there is.";
  const api = (env[GITHUB_API_URL_ENV] ?? "https://api.github.com").replace(/\/+$/, "");
  const conclusion = o.gate !== null ? "failure" : "neutral";
  const max = 65_535;
  try {
    // Through the proxy the environment names, as every request of this program.
    const res = await fetchHonouringProxy(`${api}/repos/${repo}/check-runs`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "wolfboy-rules-check", "content-type": "application/json" },
      body: JSON.stringify({
        name: CHECK_NAME,
        head_sha: ev.headSha,
        status: "completed",
        conclusion,
        completed_at: new Date().toISOString(),
        output: { title: checkRunTitle(o), summary: body.length > max ? md`${inertSlice(body, max - 40)}\n\n(cut at GitHub's limit)` : body },
      }),
      signal: AbortSignal.timeout(15_000),
    }, env);
    if (res.ok) return `Check run created on ${ciText(ev.headSha.slice(0, 12))}: ${conclusion}.`;
    return `No check run was created: GitHub answered ${res.status}${res.status === 403 ? " (on a fork's pull request the job's token is read-only)" : ""}. The step summary is all there is.`;
  } catch (e) {
    return `No check run was created: ${ciText((e as Error).message)}. The step summary is all there is.`;
  }
}
