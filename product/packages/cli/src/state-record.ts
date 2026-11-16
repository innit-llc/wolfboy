/**
 * The person's own records in their state folder, for one scanned folder: written by
 * this program on the person's machine, outside the project, so that nothing the scanned repository carries can stand
 * for them.
 *
 * Release 1 keeps several such records (the person's decisions about findings, the confirmation of a team's saved
 * answers, the list of finding numbers, the digests of the evidence logs, the deeper checks). This module is the one
 * place they are put, read and refused; what each one holds is its caller's.
 *
 * The place and the key are the start record's (start-record.ts `placeOf`): the platform's user state folder, and a
 * file named by the SHA-256 of the scanned folder's real path, each kind of record under a folder of its own beside
 * `start-question/`. So a record belongs to one folder on one computer: a second clone or worktree has none.
 *
 * Refused, for reading and for writing alike, and in the safe direction (a refused record is read as none and is not
 * written):
 *   - a place whose real path lies inside the scanned folder (start-record.ts `landsInside`, the start record's rule);
 *   - a place inside any git work tree: a `.git` at the place's folder or above it, found by name as legal-dir.ts
 *     `workTreeHolding` finds it, with no git run. Both the place as named and its real path are looked at, so a state
 *     folder pointed into a work tree, or reached through a link into one, is refused. A file in a work tree is a file
 *     a commit can carry and a clone can bring, which is the planted-file class these records exist to close. One work
 *     tree is not counted: one whose top is the OS account's home folder or a folder above it (`countedWorkTree`). That
 *     tree is the person's own (a `~/.git` kept for dotfiles), not one a scanned project brings: a clone of a project
 *     lands below it with a `.git` of its own, which is found first and still counts;
 *   - a record that is not a plain file, or that another user owns.
 *
 * Written whole or not at all: the new bytes go to a fresh temporary file in the record's folder, which is renamed over
 * the record only when every byte is written (project-write.ts `openReplacement`, as findings.json is written); a write
 * that fails leaves the record as it was and removes the temporary file.
 *
 * Two kinds of record. A whole record is replaced by each write. An append-only record is only ever added to: the
 * program never rewrites or shortens it, so `writeStateRecord` refuses it, and `appendStateRecord` writes the record's
 * bytes as read followed by the new entry, refusing where the record changed between the read and the rename (another
 * write in between, whose entry would otherwise be lost) or where it does not end at a line's end. The check is best
 * effort: a write landing between the last comparison and the rename is not seen.
 */
import { valueText } from "./value-text.js";
import { createHash } from "node:crypto";
import { lstatSync, writeSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { workTreeHolding } from "./legal-dir.js";
import { readRegularFile } from "./project-read.js";
import { makeFolder, openReplacement } from "./project-write.js";
import { accountHomeNow, landsInside, placeAsked, placeOf, processStateDir, realOfNearest, START_RECORD_DIR, STATE_HOME_ENV } from "./start-record.js";

/** One kind of record in the state folder: its own folder there, the extension of its files, and how it is written. */
export interface StateRecordKind {
  /** A single plain name: lower-case letters, digits and hyphens, never the start record's own folder. */
  folder: string;
  /** The files' extension with its dot, as `.json` or `.jsonl`. */
  extension: string;
  /** True where the record is only ever added to (`appendStateRecord`), never rewritten. */
  appendOnly: boolean;
}

/**
 * The kinds of record release 1 keeps that no tool call may write: each with what writes
 * it, the text of the hook guard's refusal (hook-guard.ts, in every session the plugin's hooks run in). A later unit
 * takes its kind from here, so the guard and the writer name one folder: the decisions (design rf11 3.4), the
 * confirmation of a team's saved answers (3.3), the finding numbers (3.5), the report files' digests (3.5,
 * rf11-b2-2026-11-06.md) and the evidence logs' digests (rf11-a4-2026-11-06.md). The deeper checks' kind is added by the
 * unit that writes them. Every kind is defined here and nowhere else (the number list was
 * once written under a second definition the guard did not know; test:relay-hooks fails on a kind defined elsewhere).
 */
export const DECISIONS_RECORD: StateRecordKind = { folder: "decisions", extension: ".jsonl", appendOnly: true };
export const TEAM_ANSWERS_RECORD: StateRecordKind = { folder: "team-answers", extension: ".json", appendOnly: false };
export const NUMBERS_RECORD: StateRecordKind = { folder: "numbers", extension: ".jsonl", appendOnly: true };
/** Each report's files by sha256, which `explain`, `ruled-out` and `fix` read back (report-files.ts). */
export const REPORT_FILES_RECORD: StateRecordKind = { folder: "report-files", extension: ".jsonl", appendOnly: true };
/** Each evidence log's sha256, which the next scan's earlier-run question compares (log-digest.ts). */
export const LOG_DIGESTS_RECORD: StateRecordKind = { folder: "evidence-digests", extension: ".jsonl", appendOnly: true };
/**
 * What the latest report was made from, value-redacted, gzip in base64, which
 * `decide` writes the report again from (report-render.ts). A whole record: each report's input replaces the last.
 */
export const RENDER_INPUT_RECORD: StateRecordKind = { folder: "report-input", extension: ".b64", appendOnly: false };
/**
 * The deeper checks of this folder's findings (design rf13 3.9, step 8), one line per step
 * of a check, appended by `legal-scan deepen`. A line that records the test written carries `test_id`, the id the
 * check's test names are made from (`legal_check_<test_id>`, `LegalCheck<test_id>`): the hook guard reads every line's
 * `test_id` here to refuse a tool call that names one (hook-guard.ts `deepTestIds`).
 */
export const DEEP_CHECKS_RECORD: StateRecordKind = { folder: "deep-checks", extension: ".jsonl", appendOnly: true };
/**
 * The Claude Code sessions whose hooks ran in a
 * project folder: one line per SessionStart the plugin's hook saw there (plugin-sessions.ts).
 */
export const PLUGIN_SESSIONS_RECORD: StateRecordKind = { folder: "plugin-sessions", extension: ".jsonl", appendOnly: true };
/**
 * THE RELAY'S RECORDS AND THE RUN HISTORY, once files under
 * `.legal/launch/`: the question the program asks through the hook, the answer the hook writes from what Claude Code
 * hands it at AskUserQuestion time (its tool response and session id), and the ledger of both, for each of the four
 * questions the relay carries (the run shape, the declaration questions, the earlier run, the program's confirmation),
 * and the ledger of run ends that closes the declaration window. A file in the project is a file a commit, a clone or
 * a tool call can write, and twice a guard row on them was got past; so they are kept here, outside the project and any
 * git work tree, with a guard row each, and the program reads only these records: no transcript is located or read.
 * Each file name keeps its own folder, `launch-<name>`, keyed by the folder that holds `.legal/launch` (the launch
 * directory's parent where it is not named so).
 */
const LAUNCH_RECORD_ROWS: readonly [file: string, noun: string, writtenBy: string][] = [
  ["run-shape-question.json", "the run-shape question", "only the pre-launch step (`legal-scan adjudicate`) writes it"],
  ["run-shape-answer.json", "the person's answer to the run-shape question", "only the plugin's hook writes it, from the question dialog"],
  ["run-shape-ledger.jsonl", "the run-shape ledger", "only the pre-launch step and the plugin's hook write it"],
  ["declaration-question.json", "the declaration questions", "only `legal-scan scan` writes each round"],
  ["declaration-answer.json", "the person's answers to the declaration questions", "only the plugin's hook writes them, from the question dialog"],
  ["declaration-ledger.jsonl", "the declaration ledger", "only the scan, the plugin's hook and `legal-scan run-abort` write it"],
  ["earlier-run-question.json", "the earlier-run question", "only the pre-launch step (`legal-scan adjudicate`) writes it"],
  ["earlier-run-answer.json", "the person's answer to the earlier-run question", "only the plugin's hook writes it, from the question dialog"],
  ["earlier-run-ledger.jsonl", "the earlier-run ledger", "only the pre-launch step and the plugin's hook write it"],
  ["confirmation-question.json", "the program's confirmation question", "only the program writes it, when a command asks the person to confirm"],
  ["confirmation-answer.json", "the person's answer to the program's confirmation", "only the plugin's hook writes it, from the question dialog"],
  ["confirmation-ledger.jsonl", "the confirmation's ledger", "only the program and the plugin's hook write it"],
  ["active-run-history.jsonl", "the active-run history", "only `legal-scan run-abort` and the assembly write it, when a run ends"],
  // Nothing under the project's `.legal/` is taken as where a verdict, a
  // launch or an answer came from: the marker is compared with the program's own copy here, and each seat answer the
  // assembly accepts with the hook's own line here.
  ["active-run.json", "the program's copy of the active-run marker", "only the program writes it, with the marker, when a run starts, when its launch list is written and when it ends"],
  ["seat-captures.jsonl", "the record of each seat answer the plugin's hook took and where Claude Code keeps that seat's transcript", "only the plugin's hook writes it, from what Claude Code hands it when a seat hands back or stops"],
];
const launchKindOf = (file: string): StateRecordKind => {
  const dot = file.lastIndexOf(".");
  return { folder: `launch-${file.slice(0, dot)}`, extension: file.slice(dot), appendOnly: file.endsWith(".jsonl") };
};
/** Each relay or history file's kind, by the file name the program has always used for it. */
export const LAUNCH_RECORDS: ReadonlyMap<string, StateRecordKind> = new Map(LAUNCH_RECORD_ROWS.map(([file]) => [file, launchKindOf(file)]));
/** The folder whose records a launch directory's are: the folder holding `.legal/launch`, or the launch directory's parent. */
export function launchRecordOwner(launchDir: string): string {
  const abs = resolve(launchDir);
  const legal = dirname(abs);
  return basename(abs) === "launch" && basename(legal) === ".legal" ? dirname(legal) : legal;
}
let stateDirMemo: { at: string; dir: string | null } | null = null;
/** The process's state folder, read once for the same environment and working folder. */
function stateDirNow(): string | null {
  const at = JSON.stringify([process.cwd(), process.env.XDG_STATE_HOME, process.env.HOME, process.env.LOCALAPPDATA, process.env.CLAUDE_PROJECT_DIR]);
  if (stateDirMemo === null || stateDirMemo.at !== at) stateDirMemo = { at, dir: processStateDir() };
  return stateDirMemo.dir;
}
/**
 * Where the relay's or the history's file `file` of the launch directory `launchDir` is kept in the state folder. Throws,
 * naming why, where it has no place or its place is refused (`stateRecordRefusal`): every caller reads a throw as a record
 * that cannot be read or written. With `make`, its folder is made first.
 */
/**
 * Where one of those records has no place in the state folder, or its place is
 * refused (inside the scanned folder or any git work tree). Its message is the sentence the person reads: every
 * command ends in it, never in a stack (command-boundary.ts). Since S1 the scan stops on it, so a person whose home
 * folder is itself a git work tree (a `~/.git` for dotfiles) could not scan at all: the sentence names the way past it, `XDG_STATE_HOME`, which `userStateDir` (start-record.ts) reads before
 * anything else on every platform. A place that fails for a reason that setting cannot change (the scanned folder's real
 * path cannot be read) is said without it.
 */
export class LaunchRecordRefusal extends Error {
  readonly code = "ESTATERECORD";
}
export const isLaunchRecordRefusal = (e: unknown): e is LaunchRecordRefusal => e instanceof LaunchRecordRefusal;
/** The way past the refusal, the end of its one sentence. */
export const STATE_FOLDER_REMEDY = `set ${STATE_HOME_ENV} to an absolute folder outside the scanned folder and outside any git work tree before you start Claude Code, then run this again`;
export function launchRecordPath(launchDir: string, file: string, make = false): string {
  const kind = LAUNCH_RECORDS.get(file);
  if (kind === undefined) throw new Error(`${file} is not a record the state folder keeps`);
  const stateDir = stateDirNow();
  const place = stateRecordPlace(stateDir, launchRecordOwner(launchDir), kind);
  if (!place.ok && stateDir === null) throw new LaunchRecordRefusal(`WolfBoy cannot keep its record ${file}: there is no state folder for it (${place.why}); ${STATE_FOLDER_REMEDY}.`);
  if (!place.ok) throw new LaunchRecordRefusal(`WolfBoy cannot keep its record ${file}: there is no place for it in your state folder (${place.why}).`);
  const refused = stateRecordRefusal(place.path, place.project);
  if (refused !== null) throw new LaunchRecordRefusal(`WolfBoy cannot keep its record ${file} in your state folder: ${refused}; ${STATE_FOLDER_REMEDY}.`);
  if (make) makeFolder(place.dir, { recursive: true, mode: 0o700, within: place.within });
  return place.path;
}
export const GUARDED_STATE_RECORDS: readonly { kind: StateRecordKind; noun: string; writtenBy: string }[] = [
  { kind: DECISIONS_RECORD, noun: "the person's decisions about findings", writtenBy: "only `legal-scan decide` writes them, from the person's answer to the program's own question" },
  {
    kind: TEAM_ANSWERS_RECORD,
    noun: "the confirmation of saved answers about the product",
    writtenBy: "only `legal-scan scan` writes it, when the person answers the program's questions in this folder or confirms the saved answers through the program's own question",
  },
  { kind: NUMBERS_RECORD, noun: "the finding numbers", writtenBy: "only the program writes them, as each report numbers its findings" },
  { kind: REPORT_FILES_RECORD, noun: "the record of the report files WolfBoy wrote", writtenBy: "only the program writes it, as each report is written" },
  { kind: LOG_DIGESTS_RECORD, noun: "the record of the evidence logs WolfBoy wrote", writtenBy: "only the program writes it, as each evidence log is written" },
  { kind: RENDER_INPUT_RECORD, noun: "what the latest report was made from", writtenBy: "only the program writes it, as each report is written" },
  { kind: DEEP_CHECKS_RECORD, noun: "the record of the deeper checks", writtenBy: "only `legal-scan deepen` writes it, as each step of a check is taken" },
  { kind: PLUGIN_SESSIONS_RECORD, noun: "the record of the Claude Code sessions the plugin's hooks ran in", writtenBy: "only the plugin's SessionStart hook writes it, as each session starts" },
  ...LAUNCH_RECORD_ROWS.map(([file, noun, writtenBy]) => ({ kind: launchKindOf(file), noun, writtenBy })),
];

export type StateRecordPlace =
  | { ok: true; project: string; key: string; dir: string; path: string; within: string }
  | { ok: false; why: string };

const FOLDER_NAME = /^[a-z0-9][a-z0-9-]*$/;
const EXTENSION = /^\.[a-z0-9]+$/;

/** Where `kind`'s record for the scanned folder `target` lies, keyed as the start record is; nothing is read or made. */
export function stateRecordPlace(stateDir: string | null, target: string | undefined, kind: StateRecordKind, scanned = true): StateRecordPlace {
  if (!FOLDER_NAME.test(kind.folder) || kind.folder === START_RECORD_DIR) return { ok: false, why: `"${kind.folder}" is not a folder name a record may take` };
  if (!EXTENSION.test(kind.extension)) return { ok: false, why: `"${kind.extension}" is not an extension a record may take` };
  // `scanned` false: `target` is a folder asked about, not one this process scans (start-record.ts `placeAsked`).
  const place = scanned ? placeOf(stateDir, target) : placeAsked(stateDir, target);
  if (!place.ok) return place;
  // `placeOf` names the start record's file `<key>.json`; the key is the part before the extension.
  const key = basename(place.path, ".json");
  const within = dirname(dirname(place.path));
  const dir = join(within, kind.folder);
  return { ok: true, project: place.project, key, dir, path: join(dir, `${key}${kind.extension}`), within };
}

/**
 * Where `kind`'s record lies when it is
 * keyed by a text the caller made (plugin-sessions.ts: a folder as the file system names it, case and Unicode form folded
 * where the volume ignores them), not by the real path of a folder that must exist: on a case-sensitive macOS volume the
 * folded name may name no folder, and the record is still written. The key is the text's SHA-256, as `placeOf`'s is the
 * real path's.
 */
export function stateRecordPlaceKeyed(stateDir: string | null, key: string, kind: StateRecordKind): StateRecordPlace {
  if (!FOLDER_NAME.test(kind.folder) || kind.folder === START_RECORD_DIR) return { ok: false, why: `"${kind.folder}" is not a folder name a record may take` };
  if (!EXTENSION.test(kind.extension)) return { ok: false, why: `"${kind.extension}" is not an extension a record may take` };
  if (stateDir === null) return { ok: false, why: "no user state folder could be named on this machine" };
  if (key === "") return { ok: false, why: "the record's key is empty" };
  const hex = createHash("sha256").update(key).digest("hex");
  const dir = join(stateDir, kind.folder);
  return { ok: true, project: key, key: hex, dir, path: join(dir, `${hex}${kind.extension}`), within: stateDir };
}

/**
 * The place rule for the anchor (start-record.ts `anchorStateDir`), the
 * OS account's own state folder, placed from the account database and never from the environment: no command can point
 * it into a scanned folder, so of the rule only the git work tree applies (a commit could carry a record there).
 */
function anchorPlaceRefusal(path: string, home: string = accountHomeNow()): string | null {
  for (const at of new Set([resolve(path), realOfNearest(path)])) {
    const tree = countedWorkTree(dirname(at), home);
    if (tree !== null) return `its place ${valueText(path)} lies inside the git work tree at ${valueText(tree)}`;
  }
  return null;
}

/**
 * Whether a git work tree whose top is `top` counts for the place rule:
 * not where the OS account's home folder (`os.userInfo().homedir`, never an environment value, which a project's
 * settings can set) lies at `top` or below it. Such a tree is the person's own, not one a scanned project brings, and
 * counting it would refuse every record and every transcript of a person whose home is kept in git.
 */
export function workTreeCounted(top: string, home: string = accountHomeNow()): boolean {
  return !(home !== "" && isAbsolute(home) && landsInside(home, realOfNearest(top)));
}

/** The git work tree holding `folder` (legal-dir.ts `workTreeHolding`, the nearest `.git` by name) where the place rule counts it, or null. */
export function countedWorkTree(folder: string, home: string = accountHomeNow()): string | null {
  const tree = workTreeHolding(folder);
  return tree !== null && workTreeCounted(tree, home) ? tree : null;
}

/** Why a record may not lie at `path` for the scanned folder `project`, or null where it may. */
export function stateRecordRefusal(path: string, project: string, home: string = accountHomeNow()): string | null {
  if (landsInside(path, project)) return `its place ${valueText(path)} lies inside the scanned folder`;
  for (const at of new Set([resolve(path), realOfNearest(path)])) {
    const tree = countedWorkTree(dirname(at), home);
    if (tree !== null) return `its place ${valueText(path)} lies inside the git work tree at ${valueText(tree)}`;
  }
  return null;
}

/**
 * Why a Claude Code transcript the assembly
 * is to read at `path` is not taken, or null where it is. Every path the assembly reads is one Claude Code handed the
 * plugin's hook, kept by the hook in the state folder (`seat-captures.jsonl`), never one a project file names; so the
 * one rule left is the scanned folder's: a transcript there is a file the scanned project could carry. A git work tree
 * is no longer a reason (a `~/.claude` kept in git holds every transcript Claude Code writes). The launch gate applies
 * this rule to the session's transcript before any seat launches (hook-launch.ts `assemblyBlocked`).
 */
export function transcriptPlaceRefusal(path: string, project: string): string | null {
  if (!landsInside(path, project) && !landsInside(realOfNearest(path), project)) return null;
  return `the transcript ${valueText(path)} lies inside the scanned folder ${valueText(project)}, so a file the scanned project carries could stand for it, and it is not taken; scan a folder that does not hold Claude Code's own folder, or start Claude Code with CLAUDE_CONFIG_DIR set to a folder outside the scanned one`;
}

/**
 * The files of kept place rows (`.legal/capture/places-kept/`, verdict-capture.ts
 * `keepReadPlaces`) the plugin's hook wrote, by file (relative to `.legal`) and sha256, taken from the hook's own `kept`
 * lines in `seat-captures.jsonl` in the state folder (hook-capture.ts `noteSeatCapture`), never from `.legal/capture`: a
 * file or a line there is one a commit, a clone or a file tool could have written. A later seat's brief, its capture and
 * the assembly read a kept file only where it is named here with its bytes' sha256; `runId` takes only that run's lines
 * (a run sets its working area aside first, SKILL.md step 1a, while this record stays). Empty where the record cannot be
 * read, so a kept file is then read by no one.
 */
export function keptPlacesNamed(legalDir: string, launchDir: string = join(legalDir, "launch"), runId?: string): Map<string, string> {
  const named = new Map<string, string>();
  let text: string;
  try {
    text = readRegularFile(launchRecordPath(launchDir, "seat-captures.jsonl"), "utf8");
  } catch {
    return named;
  }
  for (const l of text.split("\n")) {
    if (l.trim() === "") continue;
    let line: unknown;
    try {
      line = JSON.parse(l);
    } catch {
      continue;
    }
    const l2 = line as { kind?: unknown; places_kept?: unknown; run_id?: unknown } | null;
    if (l2?.kind !== "kept" || (runId !== undefined && l2.run_id !== runId)) continue;
    const kept = l2.places_kept;
    if (!Array.isArray(kept)) continue;
    for (const k of kept as { file?: unknown; sha256?: unknown }[]) if (typeof k?.file === "string" && typeof k.sha256 === "string") named.set(k.file, k.sha256);
  }
  return named;
}

type Existing = { found: true; text: string } | { found: false; absent: boolean; why: string };

/** The record at `path` as it stands, read only where it is a plain file of this user's. */
function readExisting(path: string): Existing {
  let st: import("node:fs").Stats;
  try {
    st = lstatSync(path);
  } catch {
    return { found: false, absent: true, why: `no record at ${valueText(path)}` };
  }
  if (!st.isFile()) return { found: false, absent: false, why: `the record ${valueText(path)} is not a plain file` };
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid !== null && st.uid !== uid) return { found: false, absent: false, why: `the record ${valueText(path)} belongs to another user` };
  try {
    return { found: true, text: readRegularFile(path, "utf8") };
  } catch (e) {
    return { found: false, absent: false, why: `the record ${valueText(path)} could not be read (${valueText((e as Error).message)})` };
  }
}

export type StateRecordRead =
  | { read: true; path: string; text: string }
  /** Nothing is recorded for this folder on this computer. */
  | { read: false; absent: true; why: string }
  /** Something stands in the way: no place, a refused place, or a record that cannot be read. Read as none. */
  | { read: false; absent: false; why: string };

/** `kind`'s record for the scanned folder `target`, read only from a place that is not refused. */
export function readStateRecord(stateDir: string | null, target: string | undefined, kind: StateRecordKind, scanned = true): StateRecordRead {
  const place = stateRecordPlace(stateDir, target, kind, scanned);
  if (!place.ok) return { read: false, absent: false, why: place.why };
  const refused = stateRecordRefusal(place.path, place.project);
  if (refused !== null) return { read: false, absent: false, why: `${refused}, so it is not read` };
  const got = readExisting(place.path);
  if (!got.found) return got.absent ? { read: false, absent: true, why: got.why } : { read: false, absent: false, why: got.why };
  return { read: true, path: place.path, text: got.text };
}

/**
 * `placeRefused`: the write was refused for its place, a cause `XDG_STATE_HOME` can change (no state folder could be named,
 * or the place lies inside the scanned folder or a git work tree), so a command that stops on it names that way past it
 * (`STATE_FOLDER_REMEDY`).
 */
export type StateRecordWrite = { written: true; path: string } | { written: false; why: string; placeRefused?: true };

type Ready = { ok: true; place: Extract<StateRecordPlace, { ok: true }> } | { ok: false; why: string; placeRefused?: true };
/** A record keyed by the caller's text (`stateRecordPlaceKeyed`); `anchor`: it lies in the anchor (`anchorPlaceRefusal`). */
type Keyed = { key: string; anchor: boolean };

/** The record's place with its folder made, refused before the folder is made and again after (a link made since). */
function readyPlace(stateDir: string | null, target: string | undefined, kind: StateRecordKind, keyed?: Keyed): Ready {
  const place = keyed === undefined ? stateRecordPlace(stateDir, target, kind) : stateRecordPlaceKeyed(stateDir, keyed.key, kind);
  if (!place.ok) return stateDir === null ? { ...place, placeRefused: true } : place;
  const refusal = (): string | null => (keyed?.anchor === true ? anchorPlaceRefusal(place.path) : stateRecordRefusal(place.path, place.project));
  const before = refusal();
  if (before !== null) return { ok: false, why: before, placeRefused: true };
  try {
    makeFolder(place.dir, { recursive: true, mode: 0o700, within: place.within });
  } catch (e) {
    return { ok: false, why: `its folder ${place.dir} could not be made (${(e as Error).message})` };
  }
  const after = refusal();
  if (after !== null) return { ok: false, why: after, placeRefused: true };
  return { ok: true, place };
}

/**
 * Put `text` at `path` whole or not at all. Where `unchanged` is given, the record must still hold exactly those bytes
 * (or, where it is the empty string, still be absent) when the new bytes are in place, or nothing is renamed.
 */
function putWhole(path: string, within: string, text: string, unchanged?: string): StateRecordWrite {
  let out: ReturnType<typeof openReplacement>;
  try {
    out = openReplacement(path, { mode: 0o600, within });
  } catch (e) {
    return { written: false, why: `${valueText(path)} could not be written (${valueText((e as Error).message)})` };
  }
  try {
    const bytes = Buffer.from(text, "utf8");
    for (let at = 0; at < bytes.length; ) at += writeSync(out.fd, bytes, at, bytes.length - at);
    if (unchanged !== undefined) {
      const now = readExisting(path);
      const same = now.found ? now.text === unchanged : now.absent && unchanged === "";
      if (!same) {
        out.abandon();
        return { written: false, why: `${valueText(path)} changed while this entry was being written, so nothing was added to it` };
      }
    }
  } catch (e) {
    out.abandon();
    return { written: false, why: `${valueText(path)} could not be written (${valueText((e as Error).message)})` };
  }
  try {
    out.commit();
  } catch (e) {
    return { written: false, why: `${valueText(path)} could not be written (${valueText((e as Error).message)})` };
  }
  return { written: true, path };
}

/** `appendStateRecord` for a record keyed by the caller's text (`stateRecordPlaceKeyed`). */
export function appendStateRecordKeyed(stateDir: string | null, key: string, kind: StateRecordKind, entry: string, anchor: boolean): StateRecordWrite {
  return appendStateRecord(stateDir, undefined, kind, entry, { key, anchor });
}

/** Replace `kind`'s whole record for the scanned folder `target` with `text`. Refused for an append-only kind. */
export function writeStateRecord(stateDir: string | null, target: string | undefined, kind: StateRecordKind, text: string): StateRecordWrite {
  if (kind.appendOnly) return { written: false, why: `the ${kind.folder} record is only ever added to, never rewritten` };
  const ready = readyPlace(stateDir, target, kind);
  if (!ready.ok) return { written: false, why: ready.why, ...(ready.placeRefused ? { placeRefused: true as const } : {}) };
  const { path, within } = ready.place;
  const was = readExisting(path);
  if (!was.found && !was.absent) return { written: false, why: was.why };
  return putWhole(path, within, text);
}

/**
 * Add `entry` (one or more whole lines, each ending with a line feed) to the end of `kind`'s append-only record for the
 * scanned folder `target`, making the record where there is none. The bytes already there are kept exactly.
 */
export function appendStateRecord(stateDir: string | null, target: string | undefined, kind: StateRecordKind, entry: string, keyed?: Keyed): StateRecordWrite {
  if (!kind.appendOnly) return { written: false, why: `the ${kind.folder} record is written whole, not added to` };
  if (entry === "" || !entry.endsWith("\n")) return { written: false, why: "an entry is one or more whole lines, each ending with a line feed" };
  const ready = readyPlace(stateDir, target, kind, keyed);
  if (!ready.ok) return { written: false, why: ready.why, ...(ready.placeRefused ? { placeRefused: true as const } : {}) };
  const { path, within } = ready.place;
  const was = readExisting(path);
  if (!was.found && !was.absent) return { written: false, why: was.why };
  const old = was.found ? was.text : "";
  if (old !== "" && !old.endsWith("\n")) return { written: false, why: `the record ${valueText(path)} does not end at a line's end, so nothing is added to it` };
  return putWhole(path, within, old + entry, old);
}
