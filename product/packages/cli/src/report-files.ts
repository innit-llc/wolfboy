import { isAbsolute, join, resolve } from "node:path";
import { relativePath } from "./project-path.js";
import { readProgramFile, sha256Of } from "./program-file.js";
import { appendStateRecord, readStateRecord, REPORT_FILES_RECORD, type StateRecordKind, type StateRecordWrite } from "./state-record.js";

/**
 * THE REPORT'S FILES AS THE PROGRAM WROTE THEM (design rf11 3.5, 3.1.1).
 *
 * `explain`, `ruled-out` and the line `fix` shows print what a report's files hold and never text of their own. Those
 * files sit in the project folder, where any process running as the person can rewrite them; so when the assembly
 * writes a report it records here, in the person's state folder and outside the project (state-record.ts), the sha256
 * of every file it wrote, which finding ids each finding's file holds, and the evidence log written beside them. A
 * command prints a file only where its sha256 is the one recorded; a file that differs, or one with no record, is named
 * and not printed. As with the evidence logs' digests (log-digest.ts), code that writes both the file and the state
 * folder defeats the check: it is a check against an edit made without knowing of it, not a proof.
 *
 * Why the written file and not a model made again (B1a's record, section 6, left this to B2): the model is made from
 * the run's inputs and a quote check and premise blocks taken over the tree, so once the person changes a file a
 * verdict rests on (the first fix does), it can no longer be made again equal to the log, and `fix` could not name the
 * next finding. The recorded digest ties the file to the assembly that wrote it, whatever the tree does after.
 *
 * One append-only record per scanned folder, one JSON line per report written:
 * `{"report": <the report folder, relative to the scanned folder where it lies inside it>, "log": <the evidence log's
 * file name>, "files": {<path inside the report folder>: <sha256>}, "finding_files": {<finding id>: <path>},
 * "ruled_out_files": {<a ruled-out verdict's finding id>: <its rule's file>}}` (the last so that `explain` on a ruled-out
 * verdict's id can point at its section; a line without it points at none).
 * The last line with `finding_files` names the latest report. A line with only `report` and `files` records a file of
 * that report the program wrote again later (`recordReportFiles` with no finding files); the last line for a path counts.
 */
export const REPORT_FILES_KIND: StateRecordKind = REPORT_FILES_RECORD;

const HEX64 = /^[0-9a-f]{64}$/;

/** What one report wrote, as the record keeps it: paths inside the report folder, by sha256. */
export interface ReportFilesEntry {
  /** The report folder as recorded (relative to the scanned folder where inside it, else absolute). */
  report: string;
  /** The report folder's absolute path. */
  dir: string;
  log: string;
  files: ReadonlyMap<string, string>;
  findingFiles: ReadonlyMap<string, string>;
  /** Each ruled-out verdict's finding id, with its rule's file (empty for a record written before it was kept). */
  ruledOutFiles: ReadonlyMap<string, string>;
  /**
   * What the assembly made this report from, kept so that `decide` can write the
   * report again with the person's decisions and without reading the project (report-render.ts): the sha256 of its record
   * in the state folder. Absent on a line written before it was kept, or
   * where it could not be written.
   */
  renderInput?: { sha256: string };
}

/**
 * Record the files a report wrote (`texts`: path inside the report folder to the text written), with the finding ids
 * of each finding's file. Called by the assembly once every file is written, and by any later writer of one of the
 * report's files with only that file (no `findingFiles`, no `log`).
 */
export function recordReportFiles(
  stateDir: string | null,
  target: string,
  reportDir: string,
  texts: Readonly<Record<string, string>>,
  more: { log?: string; findingFiles?: ReadonlyMap<string, string>; ruledOutFiles?: ReadonlyMap<string, string>; renderInput?: { sha256: string } } = {},
): StateRecordWrite {
  const root = resolve(target);
  const abs = resolve(reportDir);
  const rel = relativePath(root, abs);
  const report = rel === "" ? "." : rel === ".." || rel.startsWith("../") || isAbsolute(rel) ? abs : rel;
  const files = Object.fromEntries(Object.entries(texts).map(([name, text]) => [name, sha256Of(text)] as const).sort((x, y) => (x[0] < y[0] ? -1 : 1)));
  const line = {
    report,
    ...(more.log !== undefined ? { log: more.log } : {}),
    files,
    ...(more.findingFiles ? { finding_files: Object.fromEntries([...more.findingFiles].sort((x, y) => (x[0] < y[0] ? -1 : 1))) } : {}),
    ...(more.ruledOutFiles ? { ruled_out_files: Object.fromEntries([...more.ruledOutFiles].sort((x, y) => (x[0] < y[0] ? -1 : 1))) } : {}),
    ...(more.renderInput ? { render_input: { sha256: more.renderInput.sha256 } } : {}),
  };
  return appendStateRecord(stateDir, root, REPORT_FILES_KIND, `${JSON.stringify(line)}\n`);
}

/** The latest report this computer wrote for `target`, or why there is none to read. */
export type LatestReport = { ok: true; entry: ReportFilesEntry } | { ok: false; why: string };

/** The sentences a command says when it prints no file. */
export const REPORT_FILE_WORDS = {
  // Until 2026-11-12 it ended "Run a scan here first.",
  // which sent a person who had just run the free scan back to it: the free scan writes no report, the AI review does.
  noReport:
    "WolfBoy has no report of this folder recorded on this computer, so it has no finding's file to print. The report comes " +
    'from the AI review, which the free scan does not run: in Claude Code, in this folder, say "Scan this repository."',
  recordUnread: (why: string) => `WolfBoy cannot read its record of this folder's reports (${why}), so it prints no report file it cannot show it wrote.`,
  notRecorded: (path: string) => `${path} is not among the files WolfBoy recorded for this report, so it is not printed.`,
  changed: (path: string) => `${path} is not the file WolfBoy wrote: it changed after the scan wrote it, so it is not printed. Run the scan again for a report WolfBoy can print.`,
  unreadable: (path: string, problem: string) => `${path} cannot be read (${problem}), so it is not printed.`,
};

/** Read the record and pick the latest report, with every later rewrite of its files applied. */
export function latestReport(stateDir: string | null, target: string): LatestReport {
  const root = resolve(target);
  const read = readStateRecord(stateDir, root, REPORT_FILES_KIND);
  if (!read.read) return { ok: false, why: read.absent ? REPORT_FILE_WORDS.noReport : REPORT_FILE_WORDS.recordUnread(read.why) };
  const rows: { report: string; log?: string; files: Map<string, string>; findingFiles?: Map<string, string>; ruledOutFiles?: Map<string, string>; renderInput?: { sha256: string } }[] = [];
  for (const line of read.text.split("\n")) {
    if (line.trim() === "") continue;
    let o: { report?: unknown; log?: unknown; files?: unknown; finding_files?: unknown; ruled_out_files?: unknown; render_input?: unknown } | null;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // A line of another form names no report.
    }
    if (!o || typeof o !== "object" || typeof o.report !== "string" || o.report === "" || !o.files || typeof o.files !== "object") continue;
    const files = new Map(Object.entries(o.files as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && HEX64.test(e[1])));
    const pathsOf = (v: unknown): Map<string, string> | undefined =>
      v && typeof v === "object" ? new Map(Object.entries(v as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "")) : undefined;
    const ff = pathsOf(o.finding_files);
    const ro = pathsOf(o.ruled_out_files);
    const ri = o.render_input as { sha256?: unknown } | undefined;
    const renderInput = ri && typeof ri === "object" && typeof ri.sha256 === "string" && HEX64.test(ri.sha256) ? { sha256: ri.sha256 } : undefined;
    rows.push({ report: o.report, ...(typeof o.log === "string" ? { log: o.log } : {}), files, ...(ff ? { findingFiles: ff } : {}), ...(ro ? { ruledOutFiles: ro } : {}), ...(renderInput ? { renderInput } : {}) });
  }
  let at = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]?.findingFiles) {
      at = i;
      break;
    }
  }
  if (at < 0) return { ok: false, why: REPORT_FILE_WORDS.noReport };
  const head = rows[at] as (typeof rows)[number];
  const files = new Map(head.files);
  for (const r of rows.slice(at + 1)) if (r.report === head.report && !r.findingFiles) for (const [k, v] of r.files) files.set(k, v);
  const dir = isAbsolute(head.report) ? head.report : join(root, head.report);
  return { ok: true, entry: { report: head.report, dir, log: head.log ?? "", files, findingFiles: head.findingFiles ?? new Map(), ruledOutFiles: head.ruledOutFiles ?? new Map(), ...(head.renderInput ? { renderInput: head.renderInput } : {}) } };
}

/** One of the report's files, read back only while its sha256 is the recorded one; else why, in one sentence. */
export function readReportFile(entry: ReportFilesEntry, name: string): { ok: true; path: string; text: string } | { ok: false; path: string; why: string } {
  const path = join(entry.dir, name);
  const sha256 = entry.files.get(name);
  if (sha256 === undefined) return { ok: false, path, why: REPORT_FILE_WORDS.notRecorded(path) };
  const got = readProgramFile("the report file", path);
  if (!got.ok) return { ok: false, path, why: REPORT_FILE_WORDS.unreadable(path, got.problem) };
  if (got.sha256 !== sha256) return { ok: false, path, why: REPORT_FILE_WORDS.changed(path) };
  return { ok: true, path, text: got.value.toString("utf8") };
}
