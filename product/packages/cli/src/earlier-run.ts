/**
 * THE EARLIER-RUN QUESTION, WRITTEN AND TAKEN BY THE PRE-LAUNCH STEP.
 *
 * The class. Which log under `.legal/evidence/` is the person's own earlier run of this project is a fact only the
 * person holds. Step 3k of SKILL.md left the listing and the question to the model, as prose, and in 2 of 2 trials with
 * an earlier log the model ran without `--previous` and never asked: a skipped question carries nothing, silently. The
 * mechanism change: inside a Claude Code session the program asks it, through the relay that already asks the start
 * and run-shape questions (hook-question.ts EARLIER_RUN_KIND). Where `.legal/evidence/` holds a log, the step's first
 * call writes the question (every log numbered: its path, the scan id, completion time and verdict count it states of
 * itself, and whether git tracks it and its last commit) and writes nothing else; a later call whose question is the
 * same bytes takes the log only from the answer the hook recorded. A typed `--previous` is refused in a session
 * (index.ts), so no path carries a log without the person's recorded answer. Outside a session nothing changes: a log
 * is carried only where the command line names it.
 *
 * Imported by index.ts only (not by any hook module): it starts git through child-program.ts, never by itself.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { askInputLines } from "./launch-plan.js";
import { relativePath } from "./project-path.js";
import { launchRecordPath } from "./state-record.js";
import { isRunLabel } from "./carry-forward.js";
import { gitRunnerOrWhy } from "./child-program.js";
import {
  EARLIER_RUN_HEADER,
  EARLIER_RUN_NONE,
  EARLIER_RUN_QUESTION_FILE,
  PASS_EXACTLY,
  earlierRunOutstanding,
  earlierRunQuestionRecorded,
  recordEarlierRunQuestion,
  takeEarlierRun,
} from "./hook-question.js";
import { readRegularFile } from "./project-read.js";
import { compareEvidenceLogs, EVIDENCE_DIR_NAME, EVIDENCE_LOG_NAME } from "./legal-dir.js";
import { makeFolder, renamePath, writeFileAt } from "./project-write.js";
import { DIGEST_WORDS, digestMarkOf, readLogDigests, type DigestMark, type LogDigests } from "./log-digest.js";

/** The names the assembly gives a log (step 6: `scan-<ISO8601>.json`); a file of any other name is not offered. */
/** The names the assembly writes, from the one place that names them (legal-dir.ts). */
const LOG_NAME = EVIDENCE_LOG_NAME;
/** AskUserQuestion takes 2 to 4 options: three logs and "None of these". A later log is named by typing its label. */
const OFFERED = 3;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?$/;

const sha256 = (b: string | Buffer): string => createHash("sha256").update(b).digest("hex");
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** A file's own text, shown to the person: one line, printable, at most `max` characters. */
const shown = (s: string, max = 80): string => {
  const one = s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 3)}...` : one;
};

/** One log under `.legal/evidence/`, as the question lists it. */
export interface EarlierLog {
  label: string;
  /** Relative to the folder the step runs in (what `--previous` would have been): the plan records it as typed. */
  path: string;
  sha256: string;
  /** The file's own claims, shown only where they have the form they claim; null otherwise. */
  scan_id: string | null;
  completed_at: string | null;
  verdicts: number | null;
  /** Whether git tracks the file, and its last commit, in words; or why that is not known. */
  git: string;
  /**
   * The log's sha256 against the one this computer recorded when WolfBoy wrote it
   * (log-digest.ts): `matches`, `changed`, `none` (no digest kept here), or `unread` (the record could not be read).
   */
  digest: DigestMark;
  /** The commit the log says it scanned (`summary.code.commit`), hex only; null where it names none. */
  commit: string | null;
  /** That commit in words, against the folder's current branch (git `merge-base --is-ancestor`); "" where the log names none. */
  scanned: string;
}

/** What the question says of a log whose digest does not match, or "" where it matches. */
export function digestMarkWords(mark: DigestMark, digests: LogDigests): string {
  if (mark === "matches") return "";
  if (mark === "changed") return DIGEST_WORDS.changed;
  if (mark === "none") return DIGEST_WORDS.none;
  return DIGEST_WORDS.unread(digests.ok ? "" : digests.why);
}

/**
 * Every log under `<legal>/evidence/` the question can offer, newest first by its own `completed_at` (then by name), and how many other entries are there
 * (a name the assembly does not write, not a regular file, or a file that does not read as JSON). Never throws.
 */
export function listEarlierLogs(evidenceDir: string, target: string, cwd: string, digests: LogDigests = { ok: true, byName: new Map() }): { logs: EarlierLog[]; notOffered: number; digests: LogDigests } {
  let names: string[];
  try {
    names = existsSync(evidenceDir) && lstatSync(evidenceDir).isDirectory() ? readdirSync(evidenceDir) : [];
  } catch {
    return { logs: [], notOffered: 0, digests };
  }
  let notOffered = 0;
  const found: Omit<EarlierLog, "label" | "git" | "scanned">[] = [];
  for (const name of [...names].sort().reverse()) {
    const abs = join(evidenceDir, name);
    if (!LOG_NAME.test(name)) {
      notOffered += 1;
      continue;
    }
    let bytes: Buffer;
    let doc: unknown;
    try {
      bytes = readRegularFile(abs);
      doc = JSON.parse(bytes.toString("utf8"));
    } catch {
      notOffered += 1;
      continue;
    }
    const d = isRecord(doc) ? doc : {};
    const scanId = typeof d.scan_id === "string" ? d.scan_id : isRecord(d.scan) && typeof d.scan.scan_id === "string" ? d.scan.scan_id : null;
    const rel = relativePath(cwd, abs);
    found.push({
      path: rel !== "" && !rel.startsWith("..") && !isAbsolute(rel) ? rel : abs,
      sha256: sha256(bytes),
      scan_id: scanId !== null && isRunLabel(scanId) ? scanId : null,
      completed_at: typeof d.completed_at === "string" && ISO_TIME.test(d.completed_at) ? d.completed_at : null,
      verdicts: Array.isArray(d.verdicts) ? d.verdicts.length : null,
      digest: digestMarkOf(digests, name, sha256(bytes)),
      commit: ((c) => (typeof c === "string" && /^[0-9a-f]{7,64}$/.test(c) ? c : null))(isRecord(d.summary) && isRecord(d.summary.code) ? d.summary.code.commit : null),
    });
  }
  // Newest first by the log's own completion time, as the review entrance orders them (legal-dir.ts
  // `compareEvidenceLogs`), so a name that sorts late is never offered as the latest run. The logs whose digest matches the one recorded when WolfBoy wrote them come first; a log
  // that changed since, or of which this computer kept no digest, is listed after them, newest first within each group.
  found.sort(
    (a, b) =>
      Number(a.digest !== "matches") - Number(b.digest !== "matches") ||
      compareEvidenceLogs({ name: basename(a.path), completedAt: a.completed_at ?? "" }, { name: basename(b.path), completedAt: b.completed_at ?? "" }),
  );
  const git = found.length > 0 ? gitWords(target) : () => "";
  const scanned = found.some((f) => f.commit !== null) ? commitWords(target) : () => "";
  return { logs: found.map((f, i) => ({ label: `Log ${i + 1}`, ...f, git: git(isAbsolute(f.path) ? f.path : join(cwd, f.path)), scanned: scanned(f.commit) })), notOffered, digests };
}

/**
 * The commit a log scanned, in words: whether
 * it is in the history of the branch checked out now. `.legal/` is ignored by git, so it stays across a branch switch, and a
 * log of another branch was offered with nothing to tell it apart.
 */
function commitWords(target: string): (commit: string | null) => string {
  const runner = gitRunnerOrWhy(target);
  return (commit) => {
    if (commit === null) return "";
    const short = commit.slice(0, 7);
    if ("why" in runner) return `scanned commit ${short}`;
    const r = runner.run(["merge-base", "--is-ancestor", commit, "HEAD"]);
    if (r.status === 0) return `scanned commit ${short}, in this branch's history`;
    if (r.status === 1) return `scanned commit ${short}, not in this branch's history: a review of another branch, or of history since rewritten`;
    return `scanned commit ${short}, which this repository does not hold`;
  };
}

/** Whether git tracks a file of the scanned folder, and its last commit, through the one runner (child-program.ts). */
function gitWords(target: string): (abs: string) => string {
  const runner = gitRunnerOrWhy(target);
  if ("why" in runner) return () => `git was not run (${shown(runner.why, 160)})`;
  const inside = runner.run(["rev-parse", "--is-inside-work-tree"]);
  if (inside.status !== 0 || (inside.stdout ?? "").trim() !== "true") return () => "the scanned folder is not a git repository: no git provenance to show";
  return (abs) => {
    const rel = relativePath(target, abs);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return "outside the scanned folder: no git provenance to show";
    const listed = runner.run(["ls-files", "--", rel]);
    if (listed.status !== 0) return "git could not say whether it tracks the file";
    if ((listed.stdout ?? "").trim() === "") return "not tracked by git";
    const last = runner.run(["log", "-1", "--format=%an, %ad", "--", rel]);
    const said = (last.stdout ?? "").trim();
    return said === "" ? "tracked by git (no commit of it found)" : `tracked by git; last commit ${shown(said)}`;
  };
}

/** The question file's text for these logs, and the input it carries. The same logs of the same scan give the same bytes. */
export function earlierRunQuestionText(scanId: string, logs: EarlierLog[], notOffered: number, digests: LogDigests = { ok: true, byName: new Map() }): { text: string; runId: string; input: Record<string, unknown> } {
  const runId = `earlier-${sha256(JSON.stringify([scanId, logs.map((l) => [l.path, l.sha256])])).slice(0, 12)}`;
  const line = (l: EarlierLog): string =>
    `${l.label}: ${l.path} - scan id ${l.scan_id ?? "(none in the form of a scan id)"}, completed ${l.completed_at ?? "(no date in the form of one)"}, ` +
    `${l.verdicts === null ? "no verdicts array" : `${l.verdicts} verdict(s)`}${l.scanned ? `, ${l.scanned}` : ""}; ${l.git}${l.digest === "matches" ? "" : `; ${digestMarkWords(l.digest, digests)}`}`;
  const offered = logs.slice(0, OFFERED);
  const question = [
    "Is one of these logs the record of your own earlier scan of this project? The log you name is carried: each finding it answered whose code and premises are unchanged keeps that answer, with no AI review in this run. " +
      "A log under .legal/evidence is a file in the scanned folder and may have come with the repository; the program cannot tell who wrote it, so it asks you. Each line says what the file states of itself, and what git says of it.",
    ...logs.map(line),
    ...(notOffered > 0 ? [`${notOffered} other entr${notOffered === 1 ? "y" : "ies"} under .legal/evidence ${notOffered === 1 ? "is" : "are"} not listed: not a log the assembly writes, or not readable as one.`] : []),
    ...(logs.length > OFFERED ? [`Only Log 1 to Log ${OFFERED} are offered as choices; to name another, type its label (for example "Log ${OFFERED + 1}").`] : []),
  ].join("\n");
  const input = {
    questions: [
      {
        question,
        header: EARLIER_RUN_HEADER,
        multiSelect: false,
        options: [
          ...offered.map((l) => ({
            label: l.label,
            description: `${l.path} (${l.verdicts === null ? "no verdicts array" : `${l.verdicts} verdict(s)`}${l.digest === "matches" ? "" : `; ${l.digest === "changed" ? DIGEST_WORDS.changed : DIGEST_WORDS.none}`})`,
          })),
          { label: EARLIER_RUN_NONE, description: "Carry nothing: every finding this scan raised is reviewed again" },
        ],
      },
    ],
  };
  const logByLabel: Record<string, string | null> = Object.fromEntries([...logs.map((l) => [l.label, l.path] as const), [EARLIER_RUN_NONE, null] as const]);
  const text = `${JSON.stringify({ kind: "earlier-run-question", version: 1, scan_id: scanId, run_id: runId, logs, not_offered: notOffered, ask_user_question_input: input, log_by_label: logByLabel }, null, 2)}\n`;
  return { text, runId, input };
}

export type EarlierRunStep =
  /** No log the question could offer: nothing is asked and nothing is carried. */
  | { kind: "no-logs"; lines: string[] }
  /** The question is (or stays) put: print the lines and write nothing else. */
  | { kind: "ask"; lines: string[]; exitCode: number }
  /** The person's answer, taken: `log` is the log to compare against, or null (none). */
  /** `sha256`: the chosen log's, as this step listed it (null for none). */
  | { kind: "taken"; log: string | null; sha256: string | null; lines: string[] };

/**
 * The pre-launch step's earlier-run question, inside a Claude Code session. Where `<legal>/evidence/` holds no log,
 * nothing is asked. Where the question file on disk is not this call's question byte for byte (or the ledger does not
 * record writing it), it is written and recorded, and the lines carry the input to pass. Where it is, the answer is
 * taken (`takeEarlierRun`); no answer yet puts the same question again; any other refusal is exit 1. `sessionId` is the
 * session the step runs in and `endedAt` the last run end the active-run history records: where the question is as
 * written but not outstanding for this session (`earlierRunOutstanding`: written in another session, or before a run
 * ended), the step records it again for this session, file unchanged, before it takes the answer, so that the hook's
 * look-alike refusal holds in the session whose step puts or takes the question, and only there.
 */
export function earlierRunStep(args: {
  findingsPath: string;
  scanId: string;
  launchDir: string;
  target: string;
  cwd: string;
  now: Date;
  sessionId: string | null;
  endedAt: string | null;
  /** The person's state folder, where the assembly recorded each log's digest (log-digest.ts); null reads none. */
  stateDir?: string | null;
}): EarlierRunStep {
  const evidenceDir = join(dirname(args.findingsPath), EVIDENCE_DIR_NAME);
  const { logs, notOffered, digests } = listEarlierLogs(evidenceDir, args.target, args.cwd, readLogDigests(args.stateDir ?? null, args.target));
  if (logs.length === 0) {
    return { kind: "no-logs", lines: notOffered > 0 ? [`EARLIER RUN: ${notOffered} entr${notOffered === 1 ? "y" : "ies"} under ${evidenceDir}, none a log the assembly writes: nothing is asked and nothing is carried.`] : [] };
  }
  const { text, runId, input } = earlierRunQuestionText(args.scanId, logs, notOffered, digests);
  const path = launchRecordPath(args.launchDir, EARLIER_RUN_QUESTION_FILE, true);
  // Built only where it is printed, since it writes
  // the readable copy of the input (launch-plan.ts `askInputLines`).
  const ask = (): string[] => [
    `EARLIER RUN QUESTION for scan ${args.scanId}: ${evidenceDir} holds ${logs.length} log(s), and which of them, if any, is the person's own earlier run of this project is theirs to say. ` +
      "Nothing was written but the question: no plan and no launch list.",
    `To ask the person the earlier-run question, ${PASS_EXACTLY}, alone in its call and with every character as it is - copy the line below whole; do not re-word, shorten or re-type any of it. ` +
      `The scanner's hook compares it with ${path} character by character, refuses any difference (saying what differs and what to pass), and records the answer. Then run this same command again:`,
    ...askInputLines(input, dirname(args.launchDir)),
  ];
  let onDisk: Buffer | null = null;
  try {
    onDisk = existsSync(path) ? readRegularFile(path) : null;
  } catch {
    onDisk = null;
  }
  if (onDisk === null || onDisk.toString("utf8") !== text || !earlierRunQuestionRecorded(args.launchDir, text)) {
    try {
      makeFolder(args.launchDir, { recursive: true });
      const partial = `${path}.${process.pid}.partial`;
      writeFileAt(partial, text);
      renamePath(partial, path);
      recordEarlierRunQuestion(args.launchDir, runId, text, args.now, args.sessionId);
    } catch (e) {
      return { kind: "ask", lines: [`EARLIER RUN QUESTION: refused - the question could not be written and recorded beside ${path} (${(e as Error).message}), so the hook would not pass it. No plan and no launch list were written.`], exitCode: 1 };
    }
    return { kind: "ask", lines: ask(), exitCode: 0 };
  }
  if (!earlierRunOutstanding(args.launchDir, args.sessionId, args.endedAt)) {
    try {
      recordEarlierRunQuestion(args.launchDir, runId, text, args.now, args.sessionId);
    } catch (e) {
      return { kind: "ask", lines: [`EARLIER RUN QUESTION: refused - the question could not be recorded for this session beside ${path} (${(e as Error).message}). No plan and no launch list were written.`], exitCode: 1 };
    }
  }
  const taken = takeEarlierRun(args.launchDir);
  if ("refused" in taken) {
    if (taken.missing) return { kind: "ask", lines: ask(), exitCode: 0 };
    return { kind: "ask", lines: [`EARLIER RUN QUESTION: refused - ${taken.refused}. No plan and no launch list were written.`, ...ask().slice(1)], exitCode: 1 };
  }
  return {
    kind: "taken",
    log: taken.log,
    sha256: taken.log === null ? null : (logs.find((l) => l.path === taken.log || resolve(args.cwd, l.path) === resolve(args.cwd, taken.log as string))?.sha256 ?? null),
    lines: [
      taken.log === null
        ? `EARLIER RUN: the person answered "${EARLIER_RUN_NONE}" (call ${taken.toolUseId}): no earlier run is carried, and every candidate the declaration leaves standing needs a seat.`
        : `EARLIER RUN: the person named ${taken.label}, ${taken.log}, as their own earlier run (call ${taken.toolUseId}): it is compared, and a verdict is carried only where every premise it recorded holds.`,
    ],
  };
}
