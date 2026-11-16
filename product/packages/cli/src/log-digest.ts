/**
 * THE EVIDENCE LOGS' DIGESTS, KEPT IN THE PERSON'S STATE FOLDER.
 *
 * The next scan takes its earlier verdicts from a log under `.legal/evidence/`, a file in the project that any process
 * running as the person can rewrite, and carry-forward then carries a verdict whose premises match. So the assembly
 * records each log's sha256 here, outside the project, when it writes the log (`recordLogDigest`), and the earlier-run
 * question marks a log whose sha256 is not the one recorded under its name ("changed") or that has none recorded
 * ("none"), and lists it after those that match (earlier-run.ts). Carry-forward itself is unchanged: the person still
 * chooses the log, and the mark goes into the new log's `comparison.earlier.digest` so the report can name it.
 *
 * Code that writes both the log and the state folder defeats the mark: it is a check against an edit made without
 * knowing of it, not a proof.
 *
 * The record is one append-only file per scanned folder (state-record.ts, keyed as the start record is): one JSON line
 * per log written, `{"name": <the log's file name>, "sha256": <hex>}`. The last line for a name is the one that counts.
 */
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { readRegularFile } from "./project-read.js";
import { processStateDir, stateFolderAdvice } from "./start-record.js";
import { appendStateRecord, LOG_DIGESTS_RECORD, readStateRecord, type StateRecordKind, type StateRecordWrite } from "./state-record.js";
import { valueText } from "./value-text.js";
// For `stateFolderPlaceNote` at the end of this file.
import { landsInside, STATE_HOME_ENV } from "./start-record.js";
import { countedWorkTree } from "./state-record.js";

/** The kind is defined once, in state-record.ts, beside the hook guard's rows. */
export const LOG_DIGEST_KIND: StateRecordKind = LOG_DIGESTS_RECORD;

export type DigestMark = "matches" | "changed" | "none" | "unread";

/** The digests recorded for a scanned folder, by log file name; or why they could not be read. */
export type LogDigests = { ok: true; byName: ReadonlyMap<string, string> } | { ok: false; why: string };

const HEX64 = /^[0-9a-f]{64}$/;

/** The record for `target`, read; nothing recorded is an empty map, anything in the way is `ok: false` with why. */
export function readLogDigests(stateDir: string | null, target: string | undefined): LogDigests {
  const read = readStateRecord(stateDir, target, LOG_DIGEST_KIND);
  if (!read.read) return read.absent ? { ok: true, byName: new Map() } : { ok: false, why: read.why };
  const byName = new Map<string, string>();
  for (const line of read.text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const row = JSON.parse(line) as { name?: unknown; sha256?: unknown };
      if (typeof row.name === "string" && row.name && typeof row.sha256 === "string" && HEX64.test(row.sha256)) byName.set(row.name, row.sha256);
    } catch {
      // A line of another form names no log.
    }
  }
  return { ok: true, byName };
}

/** A log's mark: its sha256 against the last one recorded under its file name. */
export function digestMarkOf(digests: LogDigests, name: string, sha256: string): DigestMark {
  if (!digests.ok) return "unread";
  const recorded = digests.byName.get(name);
  return recorded === undefined ? "none" : recorded === sha256 ? "matches" : "changed";
}

/**
 * THE DECLARATION PLAN'S DIGEST, in the same record under a name no log file can
 * have (`declaration-plan:<scan id>`; a log's name is its file name): the scan records the sha256 of the plan it writes
 * (`.legal/declaration-plan.json`, which states whose answers the scan used, `answers_used`), and the assembly takes the
 * plan only while its bytes have that digest (assemble-report.ts `boundDeclarationPlan`).
 */
export const planDigestName = (scanId: string): string => `declaration-plan:${scanId}`;

/** Records a log's sha256 under its file name for `target`, as one appended line. */
export function recordLogDigest(stateDir: string | null, target: string | undefined, name: string, sha256: string): StateRecordWrite {
  return appendStateRecord(stateDir, target, LOG_DIGEST_KIND, `${JSON.stringify({ name, sha256 })}\n`);
}

/**
 * What the earlier-run question says of a log that does not match, in the design's
 * words, and the one sentence the end of a run says where the digest could not be recorded.
 */
export const DIGEST_WORDS = {
  changed: "changed since WolfBoy wrote it",
  none: "this computer kept no digest of this log; WolfBoy cannot say who wrote it",
  unread: (why: string) => `the record of the logs WolfBoy wrote could not be read (${why}); WolfBoy cannot say who wrote it`,
  notRecorded: (why: string) =>
    `The evidence log's digest was not recorded in your state folder (${why}), so the next scan will list this log as one this computer kept no digest of.${stateFolderAdvice(why)}`,
};

/**
 * THE FINDINGS DOCUMENT'S DIGEST, in the same record, under a name no
 * log file can have (`findings:<path>`: the real path of the folder the document is in, then its file name). The scan
 * records the sha256 of the document it writes (index.ts, after `writeFindingsJson`) under the scanned folder; every reader
 * takes the document through `readFindingsText` or `findingsChangedProblem` and refuses it where its sha256 is not the
 * one recorded ("changed"). A document with no digest recorded ("none": one written by hand, or a copy elsewhere) and a
 * record that cannot be read are read as before: the check is against an edit made after the scan, as the plan's is.
 * A symbolic link put where the document was keeps its name, so the document it points to is compared to the scan's.
 */
export function findingsDigestName(path: string): string {
  const abs = resolve(path);
  let folder = dirname(abs);
  try {
    folder = realpathSync(folder);
  } catch {
    // A folder that cannot be resolved is named as given: a reader resolves it the same way.
  }
  return `findings:${join(folder, basename(abs))}`;
}

/**
 * The scanned folders a findings document's digest is looked up under: those the reader names (its `--target`, the
 * session's project), the document's own `target`, and the folder that holds the `.legal` folder it lies in. The scan
 * keys it by the folder it scanned; a document that names another folder is still looked up where it lies.
 */
function findingsTargets(path: string, text: string, named: readonly (string | undefined)[]): string[] {
  const out = named.filter((t): t is string => typeof t === "string" && t !== "").map((t) => resolve(t));
  // The scan writes `target` as a top-level key (two spaces in); read without parsing the document a second time.
  const own = /^ {2}"target": ("(?:[^"\\\n]|\\.)*")/m.exec(text);
  if (own) {
    try {
      const t = JSON.parse(own[1] as string) as unknown;
      if (typeof t === "string" && isAbsolute(t)) out.push(t);
    } catch {
      // Not a string the scan wrote: no folder named by it.
    }
  }
  const abs = resolve(path);
  if (basename(dirname(abs)) === ".legal") out.push(dirname(dirname(abs)));
  return [...new Set(out)];
}

/** The one sentence a reader refuses a changed findings document with, and the scan's note where it could not record the digest. */
export const FINDINGS_DIGEST_WORDS = {
  changed: (path: string) =>
    `${valueText(path)} is not the findings document the scan wrote: its sha256 is not the one the scan recorded in your state folder when it wrote it, so it is not read; run the scan again to write it anew.`,
  notRecorded: (why: string) =>
    `The findings document's digest was not recorded in your state folder (${valueText(why)}), so a later step cannot tell an edit made to it after this scan.${stateFolderAdvice(why)}`,
};

/** The sentence a reader refuses `path` with where `bytes` are not the scan's own, else null. */
export function findingsChangedProblem(path: string, bytes: Buffer | string, named: readonly (string | undefined)[] = [], stateDir: string | null = processStateDir()): string | null {
  const text = typeof bytes === "string" ? bytes : bytes.toString("utf8");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const name = findingsDigestName(path);
  for (const target of findingsTargets(path, text, named)) {
    if (digestMarkOf(readLogDigests(stateDir, target), name, digest) === "changed") return FINDINGS_DIGEST_WORDS.changed(path);
  }
  return null;
}

/** What `readFindingsText` throws where the document changed after the scan: its message is the one sentence, said as it is. */
export class FindingsChanged extends Error {}

/** THE ONE READ of a findings document as text: `readRegularFile`, then `findingsChangedProblem`, which it throws. */
export function readFindingsText(path: string, named: readonly (string | undefined)[] = []): string {
  const bytes = readRegularFile(path);
  const problem = findingsChangedProblem(path, bytes, named);
  if (problem !== null) throw new FindingsChanged(problem);
  return bytes.toString("utf8");
}

/**
 * THE STATE FOLDER'S PLACE, IN PLAIN WORDS, ONCE
 * A RUN. Where a digest was not recorded because the state folder lies inside the scanned folder or inside a git work tree
 * (the place rule of state-record.ts, unchanged), the person is told once, after the first screen, what that costs and
 * the one way past it. Null where it was said already in this process (a terminal's second pass).
 */
let placeNoteSaid = false;
export function stateFolderPlaceNote(stateDir: string | null, project: string): string | null {
  if (placeNoteSaid) return null;
  placeNoteSaid = true;
  if (stateDir === null) {
    return `Note: WolfBoy found no folder on this computer to keep its records in (set ${STATE_HOME_ENV} to one), so a later step cannot tell whether this scan's files were edited after it.`;
  }
  const where = landsInside(stateDir, project) ? "inside the folder you scanned" : `inside a git repository (${valueText(countedWorkTree(stateDir) ?? dirname(stateDir))})`;
  return (
    `Note: WolfBoy keeps its records on this computer in ${valueText(stateDir)}, which is ${where}, so it kept no record of ` +
    `this scan's files there, and a later step cannot tell whether they were edited after it. To keep them, set ` +
    `${STATE_HOME_ENV} to a folder outside your project and run the scan again.`
  );
}
