/**
 * THE KEY OF THE REDACTION MARKER'S DIGEST.
 *
 * WHY. A redacted credential becomes `[redacted:baseline-002#<clause>:<16 hex>]`. Until 2026-11-08 the hex was an unkeyed
 * sha256 of the value's fold, so anyone holding a file that carries a marker (the record handed to a customer, a
 * committed `.legal/`, a report pasted into a ticket) could recover a guessable value by hashing candidates: the marker of
 * `DB_PASSWORD=hunter22` began with the first 16 hex of `sha256("hunter22")` (check C2, item 1).
 *
 * WHAT IT IS NOW. An HMAC-SHA256 of the same fold, cut to the same 16 hex, under a key of 32 random bytes kept in the
 * person's state folder (`<state folder>/legal-scan/redaction-key`, read and written only by this program, mode 0600). The
 * marker keeps its shape, so every reader of the shape is unchanged.
 *
 * WHAT EACH USE OF THE DIGEST KEEPS:
 *   - the same secret in several places, and a label's same-kind group: one key per computer, so equal secrets keep equal
 *     markers within a run and across runs on that computer, and different ones stay different;
 *   - a quotation's marker restored from the named file before the quote check (credential-redaction.ts
 *     `restoreProgramMarkers`): the check runs on the computer that wrote the log, with the same key. A log written on
 *     another computer (a teammate's, or one from CI) carries markers of another key: none is restored, and the
 *     quotation is checked as a redacted one, the way a quotation holding a seat's own marker always was;
 *   - CI: a runner's state folder lasts as long as the job, so every file one job writes agrees; markers of two jobs do
 *     not, and nothing compares them. A finding's identity never rests on a marker: its id and its sub-shape are taken
 *     over the value-free line (credential-redaction.ts `valueFreeText`), the same on every computer.
 *
 * WHERE THE STATE FOLDER CANNOT HOLD IT (no state folder can be named; it lies inside a git work tree, where a commit
 * could carry the key; its key file is not a plain file, is another user's, or does not hold a key): the key is kept in a
 * folder of this user's own in the system's temporary folder (`spareKeyFolder`: made with mode 0700, refused when it is a
 * link, another user's, open to others or inside a git work tree). The commands of one run are separate processes and
 * compare one another's digests (the files a verdict rests on, written by verdict-reading, checked by verdict-verify and
 * again by assemble-report): a key for each process alone made every such run refuse its own quote report. A temporary folder may be emptied (on a
 * restart): a later run then has a new key, its digests match none from before, and the verdicts they carried are judged
 * again (the safe direction). Only where that folder cannot be used either is the key this process's alone, never written.
 */
import { createHmac, randomBytes } from "node:crypto";
import { lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readRegularFile } from "./project-read.js";
import { linkPath, makeFolder, removeFile, writeFileAt } from "./project-write.js";
import { landsInside, processStateDir, scannedFoldersNoted, SPARE_KEY_FOLDER } from "./start-record.js";
import { countedWorkTree } from "./state-record.js";

/** The key's file name in the state folder (`legal-scan/`). */
export const REDACTION_KEY_FILE = "redaction-key";
const KEY_SHAPE = /^[0-9a-f]{64}\n?$/;

let cached: Buffer | undefined;
/** Where this process's key came from: the state folder's file, or this process alone (with the reason). */
let origin: { kept: true; path: string } | { kept: false; why: string } | undefined;

/**
 * The state records' place rule (state-record.ts
 * `stateRecordRefusal`), for the key: never inside a git work tree the rule counts (`countedWorkTree`: a home folder kept
 * in git is not counted), and never inside a folder this process scans
 * (`scannedFoldersNoted`, every folder a record was keyed by), where a copy of the folder would carry the key with the
 * markers it makes reversible. The spare folder is used instead.
 */
function usable(stateDir: string): string | null {
  if (countedWorkTree(stateDir) !== null) return "the state folder lies inside a git work tree";
  for (const project of scannedFoldersNoted()) if (landsInside(stateDir, project)) return "the state folder lies inside the scanned folder";
  return null;
}

/** The spare key folder's path, as `spareKeyFolder` names it; nothing is made or read. */
export function spareKeyFolderPath(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  return join(tmpdir(), uid === null ? SPARE_KEY_FOLDER : `${SPARE_KEY_FOLDER}-${uid}`);
}

/**
 * Where the key may lie: the state folder's key file and the spare folder,
 * as this process's environment names them. The write guard's rows and the read route refuse every tool call on them.
 */
export function redactionKeyPlaces(): { file: string | null; spare: string; holders: string[] } {
  const stateDir = processStateDir();
  return { file: stateDir === null ? null : join(stateDir, REDACTION_KEY_FILE), spare: spareKeyFolderPath(), holders: stateDir === null ? [] : [stateDir, dirname(stateDir)] };
}

function readKey(path: string): Buffer | string {
  let st;
  try {
    st = lstatSync(path);
  } catch {
    return "absent";
  }
  if (!st.isFile()) return "the key file is not a plain file";
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid !== null && st.uid !== uid) return "the key file belongs to another user";
  let text: string;
  try {
    text = readRegularFile(path, "utf8");
  } catch {
    return "the key file could not be read";
  }
  return KEY_SHAPE.test(text) ? Buffer.from(text.slice(0, 64), "hex") : "the key file does not hold a key";
}

/** The key in `folder`: read, or made whole there (a temporary file linked to the key's name), or why neither. */
function keyIn(folder: string): Buffer | string {
  const path = join(folder, REDACTION_KEY_FILE);
  const first = readKey(path);
  if (Buffer.isBuffer(first) || first !== "absent") return first;
  try {
    makeFolder(folder, { recursive: true, mode: 0o700 });
    const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileAt(tmp, `${randomBytes(32).toString("hex")}\n`, { mode: 0o600 });
    try {
      linkPath(tmp, path);
    } catch {
      // another process made it first: its key is read below
    } finally {
      try {
        removeFile(tmp);
      } catch {
        // a temporary file left behind holds a key nobody uses
      }
    }
  } catch {
    return "the key file could not be written";
  }
  const made = readKey(path);
  return Buffer.isBuffer(made) || made !== "absent" ? made : "the key file could not be written";
}

/**
 * The folder that holds the key where the state folder cannot: this user's own folder in the system's temporary folder
 * (per user on Windows already; named by the user id elsewhere), or why it cannot be used.
 */
export function spareKeyFolder(): { folder: string } | { why: string } {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  const folder = spareKeyFolderPath();
  if (countedWorkTree(folder) !== null) return { why: "the temporary folder lies inside a git work tree" };
  try {
    makeFolder(folder, { recursive: true, mode: 0o700 });
    const st = lstatSync(folder);
    if (!st.isDirectory()) return { why: "the temporary key folder is not a folder" };
    if (uid !== null && (st.uid !== uid || (st.mode & 0o077) !== 0)) return { why: "the temporary key folder is another user's or open to others" };
  } catch {
    return { why: "the temporary key folder could not be made" };
  }
  return { folder };
}

function resolveKey(): Buffer {
  const stateDir = processStateDir();
  let why: string;
  if (stateDir === null) why = "no user state folder could be named on this machine";
  else {
    const bad = usable(stateDir);
    const key = bad === null ? keyIn(stateDir) : bad;
    if (Buffer.isBuffer(key)) {
      origin = { kept: true, path: join(stateDir, REDACTION_KEY_FILE) };
      return key;
    }
    why = key;
  }
  const spare = spareKeyFolder();
  const key = "folder" in spare ? keyIn(spare.folder) : spare.why;
  if (Buffer.isBuffer(key) && "folder" in spare) {
    origin = { kept: true, path: join(spare.folder, REDACTION_KEY_FILE) };
    return key;
  }
  origin = { kept: false, why: `${why}; ${String(key)}` };
  return randomBytes(32);
}

/** The 16-hex keyed digest a redaction marker carries: HMAC-SHA256 under this computer's key, cut to 16 hex. */
export function markerDigest(s: string): string {
  cached ??= resolveKey();
  return createHmac("sha256", cached).update(s).digest("hex").slice(0, 16);
}

/**
 * A project file's digest, as WolfBoy writes it anywhere: the files a verdict rests on in the evidence log (and the saved render input, which carries the
 * log), quotes.json's `files_read[]`, the place premises. An HMAC-SHA256 of the file's bytes under this computer's key, 64
 * hex, so the field keeps its shape. An unkeyed sha256 of a file small enough to guess whole (a one-line `.env`) gave its
 * value to anyone holding the log. Compared only with a digest made on this computer (`TreeReader.sha256`, rests-on.ts):
 * a digest made elsewhere (a teammate's log, another CI job's) never matches, so the file counts as changed and the
 * verdict on it is judged again; nothing is carried on a digest this computer did not make.
 */
export function projectFileDigest(bytes: Uint8Array | string): string {
  cached ??= resolveKey();
  return createHmac("sha256", cached).update("project-file\u0000").update(bytes).digest("hex");
}

/**
 * The digest the question relay keeps of
 * words the person typed (a typed answer, a note on a selection) in place of the words: an HMAC-SHA256 under this
 * computer's key, 64 hex, domain-separated from every other keyed digest. An unkeyed sha256 of a short typed line gave a
 * credential typed there to anyone holding the answer file, by hashing candidates.
 * It is kept in the answer record in place of the words; no transcript is read, so nothing compares it.
 */
export function typedTextDigest(text: string): string {
  cached ??= resolveKey();
  return createHmac("sha256", cached).update("typed-text\u0000").update(text, "utf8").digest("hex");
}

/**
 * The digest a premise search records of the lines it matched in the tree
 * (rests-on.ts `hit_hash`) and of the lines that hold a construct the host's search reads otherwise (`dialect`): an
 * HMAC-SHA256 under this computer's key, 64 hex, domain-separated. An unkeyed sha256 of a search's one matched line (a
 * `password = ...` line) gave its value to anyone holding the evidence log, by hashing candidates. Compared only with a
 * replay made on this computer, as `projectFileDigest` is: a log made elsewhere never matches, so its verdict is judged again.
 */
export function treeLinesDigest(text: string): string {
  cached ??= resolveKey();
  return createHmac("sha256", cached).update("tree-lines\u0000").update(text, "utf8").digest("hex");
}

/**
 * The 16 hex a kept seat answer's file name carries (hook-capture.ts
 * `keepWhole`): an HMAC-SHA256 of the answer's bytes under this computer's key, domain-separated. The name travels
 * further than the file: the report, the evidence log and the assembly's notes print it, and an unkeyed sha256 of a short
 * answer holding a credential gave the credential to anyone holding the report, by hashing candidates. The file itself
 * stays on the person's disk; the hook ledger keeps the answer's plain sha256 beside it for the transcript comparison.
 */
export function keptAnswerDigest(bytes: Uint8Array): string {
  cached ??= resolveKey();
  return createHmac("sha256", cached).update("kept-answer\u0000").update(bytes).digest("hex").slice(0, 16);
}

/** Where the key came from, for a test or a note; resolves the key first. */
export function redactionKeyOrigin(): { kept: true; path: string } | { kept: false; why: string } {
  cached ??= resolveKey();
  return origin as { kept: true; path: string } | { kept: false; why: string };
}
