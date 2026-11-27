import { readdirSync, type Dirent } from "node:fs";
import { join, sep } from "node:path";
import { relativePath } from "./project-path.js";
import { decodeSourceText, LinkWorkSpent, regularKind, sniffRegular, sourceEncodingOf, type LinkWork, type NotRegularKind } from "./project-read.js";
import {
  MACHINE_WRITTEN_FOLDERS,
  NOT_REGULAR_WORDS,
  ORIGIN_TESTED_CLASSES,
  SITE_TESTED_CLASSES,
  classNamingFolder,
  heldBackBy,
  nominatedByOwnName,
  siteCandidateClass,
  readScopeClassOfReason,
  readScopeReason,
  wholeTreeHeldBackBy,
  ClearedFolders,
  FolderTrie,
  type HeldAsSite,
  type ReadDespiteName,
  type ReadScope,
} from "./read-scope.js";
import { originTester, type OriginTest, type WalkerFolderKind } from "./vendored-origin.js";
import { CONTENT_TAIL_BYTES, TAIL_READ, ownNamesOf, vendoredByContent, type OwnNames } from "./vendored-content.js";
import { documentationSiteOf, type SiteEntry, type SiteView } from "./docs-site.js";
import { DocsUsageIndex, usageReads } from "./docs-usage.js";

// Layer 1 casts the net; the agent decides. A file this walker never opens can never reach the
// agent, so anything a rule might legitimately want to see must be readable here.
//
// **This is a denylist, and it is a denylist on purpose.** Until 2026-07-28 it was an allowlist of
// extensions, and an allowlist has one failure mode that no amount of care removes: a format nobody
// thought of is invisible, silently, to every rule at once, and the product reports "no problems
// found". The allowlist was widened twice on exactly that discovery — past JS/TS on 2026-07-27
// (two real trees' Ruby and Go backends were unreadable, so the two flagship DSA Art 16
// addressees in the corpus produced nothing) and again the same day for native extensions (CRA
// firmware). The third occurrence, on 2026-07-28, is the one that settled the design: a rule
// (eu-consent-008, AdSense) emitted no candidate at all on real trees, while its exact pattern was
// sitting in a plugin component written as a `.gjs` file. Applying the rule's own regular
// expression to that file matches the line. The rule was never wrong; `.gjs` was not on the list,
// so every file of that kind was invisible.
//
// Three failures with the same shape is a design defect, not three oversights. Widening the list a
// fourth time would only postpone the fourth. So the question the walker asks was inverted: not
// "is this extension one we recognise?" but "is there a positive reason not to read this file?" —
// and the only such reasons are that the bytes are not text, or that the file is machine-generated.
// Anything else is read. A format nobody has thought of is now readable by default, and that is the
// whole point of the change.
//
// This follows the project's rule "Build wide, complete, then evaluate": reading too much produces
// candidates the agent dismisses — visible, countable, fixable. Reading too little produces nothing,
// and nothing is invisible. Widening costs scan time, not agent tokens: matching is regex over
// lines, and tokens are spent only on candidates, which are held down by the rules' own
// `detector.file_globs`, by IGNORE_FILES and by the exclusion sets below — never by refusing to
// read a language.

/**
 * Extensions never opened, because their bytes are not text a rule can read. Media, archives,
 * compiled objects, model weights and binary document formats.
 *
 * Membership here is a claim about the *encoding*, never about relevance. "This file is unlikely to
 * contain anything interesting" is not a reason to add an extension — that judgement belongs to the
 * rules' `detector.file_globs` and to layer 2, both of which are visible and countable. An entry
 * here is invisible, which is why the bar for adding one is that the contents cannot be matched at
 * all.
 *
 * Unknown binary formats do not need an entry: BINARY_SNIFF_BYTES below catches them by content.
 * This list exists only to skip the read for the common cases.
 */
export const BINARY_EXTS = new Set([
  // Images
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".icns", ".bmp", ".tif", ".tiff",
  ".avif", ".heic", ".heif", ".psd", ".ai", ".eps", ".raw", ".cr2", ".nef",
  // Fonts
  ".woff", ".woff2", ".ttf", ".otf", ".eot", ".ttc",
  // Audio and video
  ".mp3", ".mp4", ".wav", ".ogg", ".oga", ".opus", ".flac", ".aac", ".m4a", ".m4v",
  ".webm", ".mov", ".avi", ".mkv", ".wmv", ".flv", ".mpg", ".mpeg", ".3gp",
  // Archives and packages
  ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".zst", ".7z", ".rar", ".lz4",
  ".jar", ".war", ".ear", ".whl", ".egg", ".rpm", ".deb", ".apk", ".aab", ".ipa",
  ".dmg", ".iso", ".pkg", ".msi", ".cab", ".crx", ".xpi", ".nupkg", ".gem",
  // Compiled objects and libraries
  ".so", ".dylib", ".dll", ".exe", ".o", ".obj", ".a", ".lib", ".pdb", ".class",
  ".pyc", ".pyo", ".pyd", ".wasm", ".node", ".bin", ".elf", ".ko", ".beam", ".dex",
  // Binary document formats
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp",
  ".rtf", ".pages", ".numbers", ".key", ".epub", ".mobi",
  // Databases, serialised data and model weights
  ".db", ".sqlite", ".sqlite3", ".mdb", ".accdb", ".realm", ".mo", ".dat",
  ".parquet", ".avro", ".orc", ".feather", ".arrow", ".pkl", ".pickle",
  ".npy", ".npz", ".h5", ".hdf5", ".pb", ".tflite", ".onnx", ".mlmodel",
  ".safetensors", ".gguf", ".ggml", ".ckpt", ".pt", ".pth", ".caffemodel",
  // Miscellaneous binary
  ".lockb", ".swp", ".swo", ".pyz", ".jks", ".keystore", ".p12", ".pfx", ".der",
]);

/**
 * Bytes read to decide whether a file is text.
 *
 * A NUL byte inside this window means the file is not text, whatever it is called. This is the
 * safety net that lets the denylist above stay a convenience rather than a correctness
 * requirement: an unrecognised binary format costs one 4 KiB read and is then reported as
 * `binary-content`, rather than being handed to the engine as a wall of mojibake.
 */
const BINARY_SNIFF_BYTES = 4096;

/**
 * Whether the walker will open a file, judged on its name alone.
 *
 * Exported so that a tool can ask the real walker instead of keeping a copy of
 * its rules. The copy drifted twice in one day — once when the walker widened past JS/TS and every
 * `.py` fixture was reported unreachable against a walker that reads `.py`, and again when native
 * extensions were added and a rule author had to route their firmware fixtures around a check that
 * was wrong. A duplicated constant that must stay in sync is a defect with a delay fuse.
 *
 * Note what `lastIndexOf(".") > 0` does for dotfiles: `.env` yields no extension and is therefore
 * read. That is deliberate. A live `.env` is where
 * hard-coded credentials actually are, which is precisely what baseline-001…003 look for, and the
 * scanner runs on the user's own machine and sends nothing off it. Under the old allowlist `.env`
 * derived the extension `.env`, which was not on the list, so it was invisible — while
 * `.env.example`, the file that by construction holds only placeholders, had to be named explicitly
 * to be readable. The scanner could read the fake secrets and not the real ones.
 */
export function isScannableName(name: string): boolean {
  const lower = name.toLowerCase();
  if (IGNORE_FILES.has(lower)) return false;
  const dot = lower.lastIndexOf(".");
  const ext = dot > 0 ? lower.slice(dot) : "";
  return !BINARY_EXTS.has(ext);
}

// Generated or vendored payloads that are large, machine-written and carry no remediable signal.
// Excluded by name rather than by extension so that the formats themselves stay readable.
const IGNORE_FILES = new Set([
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "npm-shrinkwrap.json", "bun.lockb",
  "composer.lock", "gemfile.lock", "poetry.lock", "pdm.lock", "cargo.lock", "go.sum",
  "packages.lock.json", "podfile.lock", "flake.lock",
]);

// `changelog.md`, `license.md` and `license.txt` were in the list above until 2026-07-29 and are
// not any more. Neither is a generated or vendored payload, and the entry cost real evidence:
//
// - A licence file is what the CRA's Recital 18 free-and-open-source carve-out turns on, and its
//   copyright line is the only statement most repositories carry about **who** the manufacturer is
//   (Article 3(13)). Measured the same day: one tree names its company in `LICENSE`, which the
//   walker read, while another names its author in `LICENSE.md`, which it refused — so the
//   same fact was visible or invisible depending on a file extension.
// - A changelog's earliest dated entry is the only ordinary trace of when a product was first
//   placed on the market, which is what Article 69(2) turns on.
//
// Both are now read. They are large in some repositories, which costs scan time and not agent
// tokens: matching is regex over lines, and what reaches the agent is held down by the rules'
// own `file_globs` and by the census kinds a limb names.

// Machine-written trees: dependencies, build output, caches. Nothing here is source a team can
// remediate, and none of it is what the 2026-07-27 decision is about.
//
// A NAME HERE THAT A READ-SCOPE CLASS ALSO NAMES IS THAT CLASS'S, FROM 2026-11-12. `node_modules`, `vendor`, `.venv` and `venv` are named by
// `rules/path-exclusions/vendored-code.yaml`, and `dist`, `build`, `out`, `.next`, `.nuxt` and `coverage` by
// `generated-output.yaml`: such a folder is not read by default, as before, and is now counted under its class; it is
// read when the person gives that class's `--read` (the read-scope design of 2026-09-10). Until then this set
// refused them by name before the read scope was asked, so `--read build` said build output "was read" while `dist/` was
// never opened. The names no class names are never read: `.git` alone since 2026-11-13, when `generated-output.yaml` took
// `.cache`, `.turbo` and `__pycache__`. The names
// are read-scope.ts `MACHINE_WRITTEN_FOLDERS`, the one list the coverage block's sentence also lists from.
const GENERATED_DIRS = new Set(MACHINE_WRITTEN_FOLDERS);

/** The bounds of the usage index (docs-usage.ts): files read, and bytes of their heads. */
const USAGE_FILES = 50_000;
const USAGE_BYTES = 512 * 1024 * 1024;

/**
 * Trees excluded because the code in them is held not to ship.
 *
 * This set is the subject of a decision, and it is separated from
 * GENERATED_DIRS so that the two policies can be reported and changed independently. W4 measured
 * that placeholder keys and dummy URLs under `test/`, `tests/` and `fixtures/` were the dominant
 * false-positive source for baseline-002/003, which is why the set exists.
 *
 * **It is also wrong as a repository-wide setting**, and the reason is that "is this a test?" is
 * not the question. The question is "does it matter, for THIS rule, that this is a test?" — and
 * the answer differs by rule. A consent gate or an AI disclosure inside a test file carries no
 * legal exposure and should be excluded. A live API key or a real person's data inside a test
 * fixture is exposure whether or not the file ships: a test database holding real personal data
 * is a GDPR matter regardless of distribution. Those two facts cannot both be served by one set
 * of directory names hidden in the scanner.
 *
 * The replacement is `detector.file_globs`, declared per rule, with this set as the default. Until
 * every rule carries that declaration the set still applies repository-wide — but from today every
 * exclusion it makes is reported in the findings file rather than happening silently.
 */
const NON_PRODUCTION_DIRS = new Set([
  "test", "tests", "spec", "specs", "testing", "fixtures", "__fixtures__",
  "mocks", "__mocks__", "__snapshots__", "e2e", "cypress", "playwright",
  "stories", ".storybook",
]);

/**
 * WHAT THE WALKER DOES WITH A FOLDER BY ITS NAME ALONE, the one source for `visit` below and for the test of a folder
 * named like vendored code (vendored-origin.ts `treeOf`), so that the test examines every folder the walker reads:
 * `.git` (any entry of that name), a machine-written folder (GENERATED_DIRS), a hidden folder other than the two that
 * carry what rules need to see (`.well-known`, `.github`), a non-production folder (read under
 * `--include-non-production` only), or null for an ordinary folder.
 */
export function folderKind(name: string): WalkerFolderKind {
  if (name === ".git") return "git";
  if (GENERATED_DIRS.has(name)) return "generated";
  if (NON_PRODUCTION_DIRS.has(name)) return "non-production";
  if (name.startsWith(".") && name !== ".well-known" && name !== ".github") return "hidden";
  return null;
}

/** The names `folderKind` knows, for the test that every folder the walker reads is examined (`test:read-scope` (M)). */
export const FOLDER_NAMES_BY_KIND = {
  generated: [...GENERATED_DIRS],
  nonProduction: [...NON_PRODUCTION_DIRS],
  readHidden: [".well-known", ".github"],
} as const;

// Test and Storybook story files never ship to end users, so a candidate there carries no
// legal exposure — subject to the same qualification as NON_PRODUCTION_DIRS above.
// Excluded by default after W2 adjudication confirmed them as a false-positive source.
const NON_PRODUCTION_FILE = /\.(test|spec|stories|cy)\.[cm]?[jt]sx?$/;

/**
 * The largest file the scanner opens. Exported because the structural reading refuses the same size
 * and must refuse it at the same number: a second ceiling written down somewhere else is a second
 * policy, and the two would drift the first time either moved.
 */
export const MAX_FILE_BYTES = 1_000_000;

/**
 * Whether a file's leading bytes are text, or the kind that stood at the path instead of a regular file.
 *
 * A NUL byte is the test. It is the one signal that separates text from binary across every
 * encoding a source tree realistically contains, it needs no heuristics about character
 * distributions, and it does not misjudge UTF-8 with non-ASCII content — which matters here,
 * because Japanese and other non-Latin source and legal text must stay readable.
 *
 * Read through the one reader of the scanned folder (project-read.ts): the
 * open does not block and only a regular file is read, so a named pipe at the path is a kind, never a scan that waits
 * for ever. A file the walker cannot open is a file the engine cannot read either, and the caller records it as an
 * exclusion like any other: `could-not-open`, never `binary-content`, which is a statement about bytes nobody read.
 */
function looksTextual(path: string, links?: LinkWork, sniffed?: { head?: Buffer; tail?: Buffer }): boolean | NotRegularKind | "could-not-open" | "git-lfs-pointer" {
  try {
    // The head this test reads, and the last
    // bytes of a JavaScript or CSS file on the same open, are handed back in `sniffed` for the content test of vendored
    // code (vendored-content.ts), so that test opens nothing of its own.
    const got = sniffRegular(path, BINARY_SNIFF_BYTES, links, sniffed !== undefined && TAIL_READ.test(path) ? CONTENT_TAIL_BYTES : undefined);
    if (!got.regular) return got.kind;
    if (sniffed !== undefined) {
      sniffed.head = got.head;
      sniffed.tail = got.tail;
    }
    if (isGitLfsPointer(got.head)) return "git-lfs-pointer";
    // A UTF-16 file (its byte-order mark) is asked the same NUL question of its decoded text, which holds a NUL only
    // where the file does; without the mark the byte test runs as before.
    if (sourceEncodingOf(got.head) !== "utf-8") return !decodedTextIsBinary(decodeSourceText(got.head));
    return got.head.indexOf(0) === -1;
  } catch {
    return "could-not-open";
  }
}

/**
 * The same NUL test as `looksTextual`, asked of bytes that have ALREADY been decoded as UTF-8.
 *
 * Exported for `discover.ts`, whose only access to a file is the caller's `readFile(path): string`.
 * **One rule, in one place, expressed over the two representations the two callers actually hold** —
 * a second "is this text?" policy written next to the first is a forbidden duplicated constant,
 * and it would drift the first time either moved.
 *
 * `readFileSync(path, "utf8")` maps a NUL byte to U+0000 and never invents one, so the decoded test
 * answers exactly what the byte test answers. A file that is text in some other encoding — Latin-1,
 * Shift-JIS — decodes to replacement characters and no NUL, and is deliberately still called text:
 * mojibake an agent can read past is the cheap direction, and refusing a file for being oddly encoded
 * is the silent absence this project is written against.
 */
export function decodedTextIsBinary(text: string): boolean {
  return text.slice(0, BINARY_SNIFF_BYTES).includes("\u0000");
}

/**
 * Why the walker did not hand a path to the engine.
 *
 * `extension-not-scanned` is retained as a value so that findings files written before 2026-07-28
 * still validate against the schema; the walker no longer produces it. Its replacements name the
 * evidence rather than the list: `binary-extension` is a decision made from the file's name,
 * `binary-content` one made from its bytes.
 */
export type ExclusionReason =
  | "generated-directory"
  | "non-production-directory"
  | "hidden-directory"
  | "non-production-file"
  | "generated-file"
  | "size-limit"
  | "binary-extension"
  | "binary-content"
  | "extension-not-scanned"
  // THE SCAN'S READ SCOPE. One reason per class of
  // `rules/path-exclusions/`, so that the exclusion mechanism this file already has — aggregate by
  // (reason, directory), count the tree, keep three examples — carries the new refusal too and
  // there is exactly one tally of what a walk declined. They are separate values rather than one
  // `read-scope` because `coverage_limits` reports per class and an option lifts per class.
  | "read-scope-tests"
  | "read-scope-vendored"
  | "read-scope-build"
  // Documentation sites.
  | "read-scope-docs"
  // WHAT STOOD AT THE PATH WAS NOT A REGULAR FILE, OR COULD NOT BE OPENED. One
  // reason per kind, so the kind is named wherever the reason is (`excluded_by_walker`, `coverage_limits`, the report),
  // and every such entry is named in full, never one of three examples (`NAMED_IN_FULL`). A named pipe was once opened
  // here, and the scan waited for ever; a link that led nowhere was dropped without a word.
  | "named-pipe"
  | "socket"
  | "device"
  | "link-to-folder"
  | "link-to-nothing"
  // A symbolic link to a file outside the scanned folder: never read.
  | "link-to-outside"
  | "could-not-open"
  // NOTHING DROPPED SILENTLY BY THE WALKER'S OWN BOUNDS.
  // A symbolic link whose chain passes the bound on one link, or met after the walk's links have spent theirs
  // (`LINK_WALK_WORK`): never resolved, never read. An entry whose name is not valid UTF-8, so that the text the walk
  // holds for it names another entry or none: never opened, and a folder's files counted by their bytes, never read.
  | "link-not-followed"
  | "name-not-utf8"
  // A symbolic link whose chain passes, on the way, a path longer than the system takes (4,095 bytes), which the gauge
  // cannot walk as the system would: never resolved, never read. A limit of its own, so not in the work bound's words.
  | "link-path-too-long"
  // A GIT LFS POINTER: the few lines Git keeps in
  // place of a file whose content was never checked out. The pointer is not the file, so nothing of the file was read,
  // and it is named in full like the kinds above; its `oid sha256:` line is a content hash, which no rule is shown.
  | "git-lfs-pointer";

/**
 * The exact Git LFS pointer format (git-lfs docs/spec.md, "The Pointer"): the version line first, then any extension
 * lines, `oid sha256:<64 hex>`, `size <bytes>`, each ending in a line feed, nothing else, and under 1024 bytes in all.
 * The older version URL (hawser) is the same format. Only a file that is exactly this is a pointer: a file that quotes
 * one, or carries anything more, is read as any other file.
 */
const GIT_LFS_POINTER = /^version https:\/\/(?:git-lfs|hawser)\.github\.com\/spec\/v1\n(?:ext-\d+-[a-z0-9]+ sha256:[0-9a-f]{64}\n)*oid sha256:[0-9a-f]{64}\nsize \d+\n$/;

export function isGitLfsPointer(bytes: Uint8Array): boolean {
  return bytes.length < 1024 && GIT_LFS_POINTER.test(Buffer.from(bytes).toString("latin1"));
}

/** The walker's reason for an entry of `kind` (project-read.ts): a folder reached here only through a link. */
export const NOT_REGULAR_REASON: Readonly<Record<NotRegularKind, ExclusionReason>> = {
  "named-pipe": "named-pipe",
  socket: "socket",
  device: "device",
  folder: "link-to-folder",
  "link-to-nothing": "link-to-nothing",
  outside: "link-to-outside",
  unfollowed: "link-not-followed",
  "path-too-long": "link-path-too-long",
};

/**
 * The reasons about WHAT STOOD AT THE PATH rather than what its bytes or its name are. Every entry refused for one of
 * them is named in full in `excluded_by_walker` (no cap on examples), counted in `coverage_limits`' not-readable member
 * under its own count, and named there with its kind: reading less without saying so is the worst miss.
 */
export const NAMED_IN_FULL: ReadonlySet<ExclusionReason> = new Set([...(Object.keys(NOT_REGULAR_WORDS) as ExclusionReason[]), "git-lfs-pointer"]);

/**
 * The refusals that are about whether the FILE CAN BE READ AT ALL, as against where it sits or what
 * kind of tree it is in.
 *
 * Named here, in one place, because `discover.ts` has to tell the two apart: a file whose name is a
 * declaration's name and which the walker refused for one of these reasons is a document this tool
 * could not open, and that is worth a line in `content_scan.screened[]` — while one refused for
 * sitting in `node_modules/` or in a test directory is a placement decision the aggregated
 * `excluded_by_walker` already reports.
 *
 * The distinction became load-bearing with the owner's extension ruling of 2026-09-02. Once every
 * walked path is tested by name, the only files whose names say "declaration" and which discovery
 * still never sees are the ones the walker refused first — a `privacy.pdf`, a `terms.docx`, a
 * 2 MB `privacy.md` — and the aggregated summary caps its examples at three per directory, so a real
 * one can be there and be unnamed.
 */
export const UNREADABLE_REASONS: ReadonlySet<ExclusionReason> = new Set<ExclusionReason>([
  "binary-extension",
  "binary-content",
  "size-limit",
  ...NAMED_IN_FULL,
]);

/**
 * One exclusion the walker made, aggregated by reason and directory.
 *
 * Emitted for the same reason `suppressed_by_guard` is emitted: a file the walker never opens can
 * never reach the adjudicating agent, so a wrong exclusion is invisible. That is exactly the
 * failure that hid a broken guard for weeks, and the walker's exclusion set is a larger version of
 * it — one hidden setting applying to all 42 rules at once.
 */
export interface WalkExclusion {
  reason: ExclusionReason;
  /** Directory the exclusion applies to, relative to the scan root ("" for the root itself). */
  dir: string;
  /**
   * Files excluded. `null` where the tree was not enumerated: generated trees are skipped without
   * descending, because counting `node_modules` costs more than the number is worth. Reported as
   * null rather than 0 so that "not counted" is never read as "nothing there".
   */
  files: number | null;
  /** A few example paths, so the reader can judge the exclusion without re-running the scan. */
  examples: string[];
}

export interface WalkResult {
  files: string[]; // paths relative to the target root
  /**
   * The size in bytes of each entry of `files`, at the same index. **The walker already stats every
   * file it accepts** — the `MAX_FILE_BYTES` test below is that `statSync` — so this array is the
   * number that test read, kept instead of thrown away. It exists so that nothing downstream has to
   * walk the tree a second time for a size: step 5's progress display used to stat every file again
   * for its byte-based ETA, and now reads this.
   * A file whose `statSync` threw is not in `files` at all, so every entry here is a real size.
   */
  sizes: number[];
  skipped: number;
  excluded: WalkExclusion[];
  /**
   * Every refused path matching `opts.alwaysReport`, in full and with its reason. Separate from
   * `excluded` because that list is a *summary*: it aggregates by (reason, directory), caps
   * examples at three, and does not enumerate generated trees at all. A summary is the right shape
   * for "what did the walker not read"; it is the wrong shape for "did the walker refuse the one
   * file this question is about", and reading the second out of the first is how three real store
   * manifests became invisible.
   *
   * Each in both its forms (`shownText`): `path` the match form, the one `alwaysReport` was asked with and every pattern
   * is matched against; `shown` the form a person reads, the name of exactly one entry. Where the path holds a byte that
   * is not valid UTF-8, `path` may be the text of another entry, so a consumer that asks whether a refused path is a
   * path it holds compares `shown` with that path's `shownText`, never `path`.
   */
  refused: { path: string; reason: ExclusionReason; shown: string }[];
  /**
   * The folders a read-scope class's NAME nominated and the walker read, because the tree did not show
   * them to be another project's or their files import the project's own (read-scope.ts
   * `ORIGIN_TESTED_CLASSES`, vendored-origin.ts). Empty where no such folder was met; `coverage_limits` names them.
   */
  readDespiteName: ReadDespiteName[];
  /** The folders the same test held back, each with the sign of third-party origin it found. For records and gates. */
  heldOnOrigin: { class: string; dir: string; evidence: string }[];
  /** The folders named like documentation sites the site test held, and why. */
  heldAsSite: HeldAsSite[];
  /** The steps that test counted in this walk and the milliseconds it took (vendored-origin.ts, the invariant of its cost). */
  originWork: { steps: number; ms: number };
  /**
   * The files held back as vendored code BY
   * THEIR CONTENT (vendored-content.ts), each with the sign it found; each is also a `read-scope-vendored` row of
   * `excluded`. Empty where the run read vendored code, or its scope has no `vendored` class.
   */
  heldByContent?: { file: string; evidence: string }[];
  /** The files the same test found vendored in a run that READS vendored code: read, and classed `vendored` (path-class.ts). */
  vendoredByContentRead?: string[];
  /**
   * The steps the walk's symbolic links were charged (THE WALKER'S BOUND), and whether they reached `LINK_WALK_WORK`, after
   * which every link met was refused as `link-not-followed`. For records and gates. Absent where no walk was made.
   */
  linkWork?: { steps: number; limitReached: boolean };
  /**
   * THE CLASSES WHOSE `--read` WOULD READ MORE: the read-scope classes this walk held a file back under where a re-scan
   * with `--read <class>` would read at least one file more, decided by this walker's own code run on each held path in
   * the re-scan's setting (`reScanReads`), and every class whose probes could not decide (THE OFFER PROBES' INVARIANT). They feed the `--read`
   * offer and `lift` only (read-scope.ts); the counts the coverage block shows stay every file under a held folder, as
   * before H6. Absent where no walk was made.
   */
  reScanReads?: string[];
  /** The work the probes of `reScanReads` counted, and whether they reached their limit (THE OFFER PROBES' INVARIANT). */
  probeWork?: { units: number; limitReached: boolean };
}

export interface WalkOptions {
  /**
   * Walk `test/`, `spec/`, `fixtures/` and their siblings instead of skipping them, leaving the
   * decision to each rule's `detector.file_globs`. Default false — the pre-2026-07-27 behaviour —
   * so that turning it on is a deliberate, measurable change rather than a side effect.
   */
  includeNonProduction?: boolean;
  /**
   * Paths the caller must hear about even when the walker refuses them. Matching paths go to
   * `refused` in full, uncapped, **including inside generated and hidden trees that are otherwise
   * never enumerated** — a vendored SDK's privacy manifest lives in exactly those trees, and its
   * absence from a report is indistinguishable from the developer having filed nothing.
   *
   * The predicate is matched on the path alone; no file is opened for it. Cost is one extra
   * `readdirSync` recursion over the excluded trees, paid only when the option is passed.
   */
  alwaysReport?: (relPath: string) => boolean;
  /**
   * The scan's READ SCOPE: which classes of path this run was told not to read.
   *
   * **Placed here, and not in `engine.ts:surfaceAllows`, because this is the one point where paths
   * are decided and it is before any rule exists.** A per-rule surface answers "does it matter, for
   * THIS rule, that this is a test file?"; the read scope answers a question the person running the
   * scan asked, about the whole run, and it must give the same answer to all 117 rules or the
   * console cannot state one number. It also has to be here to be counted honestly: a tree declined
   * at the directory is one `readdirSync` and a count, where a decision taken per rule would test
   * every path 117 times and could not say how many directories were declined.
   *
   * Absent (the default of this module) means no class is held back — which is what every caller
   * that supplies its own file list gets, and what a bundle built before the read scope existed
   * gets. `scan.ts` passes the run's scope; `reconcile.ts` deliberately does not, because
   * reconciliation is looking for the developer's own documents and a policy under `docs/test/`
   * is still their policy.
   */
  readScope?: ReadScope;
}

const EXAMPLE_LIMIT = 3;

/** What a symbolic link leads to where that is not a regular file, looked at without opening anything; null otherwise. */
function linkKind(full: string, links: LinkWork): NotRegularKind | null {
  try {
    const k = regularKind(full, links);
    return k.regular ? null : k.kind;
  } catch {
    return null;
  }
}

/**
 * THE WALKER'S BOUND: every path the walk hands the system is made of folders it listed itself, by names whose text is
 * their bytes, and ends at an entry whose own type it read in that listing; a symbolic link there is resolved by the
 * system only once project-read.ts has walked its chain within the bound on one link, every step charged to the walk's
 * count as well (`WalkLinks`); once that count passes LINK_WALK_WORK, no further link of the walk is resolved.
 *
 * - So the system never follows a link the count does not see: what it does per entry is one listing, one look and one
 *   open of a path of at most PATH_MAX bytes that holds no link, plus, for a link, a walk no longer than the one charged
 *   (project-read.ts says why). The walk's time is bounded by a constant times its entries plus a constant times the
 *   steps its links were charged, and those by twice LINK_WALK_WORK plus the bound on one link (`WalkLinks`).
 * - A name is read as bytes (`listFolder`). A name whose bytes are not valid UTF-8 has no text that names it, so its
 *   entry is never opened, never entered and never resolved: it is refused as `name-not-utf8`, a folder with its files
 *   counted by their bytes (which never leaves the tree: a listing does not follow a link). Until this change such a name
 *   was handed back to the system as text with U+FFFD in it, which named another entry or none: a folder beside a link
 *   so named was walked through the link, outside the tree.
 * - Nothing is dropped silently: a link not resolved within the bound is refused as `link-not-followed`, one whose chain
 *   passes a path longer than the system takes as `link-path-too-long`, and all three reasons are named in full in
 *   `excluded_by_walker` and in the not-readable-as-code member of the coverage limits, with words a person reads
 *   (read-scope.ts `NOT_REGULAR_WORDS`), and where a caller asks to hear of a refused path (`alwaysReport`, discovery's
 *   declarations) it is asked in the path's match form, never its shown form (`shownText`). A probe of what a re-scan
 *   would read (`reScanReads`) that meets a link it does not resolve cannot decide, so the class is offered; a name that
 *   is not valid UTF-8 a re-scan does not read either.
 * - On every tree whose links all resolve within the bound and whose names are all valid UTF-8 - the 171 corpus entries
 *   and the ten trees of the record among them - the walk reads, refuses and counts exactly what it did before this
 *   change: every question whose answer it acts on is asked as before and answered as before. What is added is one
 *   look at each path before the rest (whether it is a link, which was asked later or, with no project folder, not at
 *   all) and, for a link, the gauge's looks, whose answers decide nothing but whether to go on; so the ORDER of the calls
 *   is not the same, and the answers acted on are (the record's sections 3 and 5).
 *
 * The limit: an ordinary link is charged some 6,000 steps (two looks at it, each about 3,000), so the walk resolves some
 * 30,000 such links before it stops resolving; the most any walk of the 171 corpus entries and the ten trees was charged
 * is 191,857 steps. A step took 14 to 49 ns, the system's own answers included, on the hostile shapes measured (the
 * higher under load), so the links of one walk (at most twice the limit, `WalkLinks`) cost at most some 20 s.
 */
const LINK_WALK_WORK = 200_000_000;

/**
 * The count a walk and its probes keep of their links' steps (THE WALKER'S BOUND). The walk looks at a link twice (its
 * kind and size, then its first bytes): the first look is charged and refused past the limit; the second, made only of
 * a link the first look resolved, is charged too (`tally`) and never refused, since it walks the same chain within the
 * same bound on one link. So the links of a walk cost at most twice LINK_WALK_WORK plus that bound.
 */
class WalkLinks implements LinkWork {
  spent = 0;
  reached = false;
  charge(k: number): void {
    if (this.reached) throw new LinkWorkSpent();
    this.spent += k;
    if (this.spent > LINK_WALK_WORK) {
      this.reached = true;
      throw new LinkWorkSpent();
    }
  }
  /** The second look's count: charged, never refused. */
  readonly tally: LinkWork = {
    charge: (k: number): void => {
      this.spent += k;
    },
  };
}

/** An entry of a folder as `readdirSync` lists it with its name as bytes. */
type RawEntry = Pick<Dirent, "isDirectory" | "isSymbolicLink" | "isFIFO" | "isSocket" | "isCharacterDevice" | "isBlockDevice"> & { name: Buffer };

/**
 * One entry of a folder, its name read as BYTES (THE WALKER'S BOUND). `name` is the text the walk uses; `odd` says that
 * text is not the bytes on disk (they are not valid UTF-8), so handed back to the system it would name another entry or
 * none; `raw` is the bytes. What the entry is comes from its own type, as `readdirSync` reports it: nothing is followed.
 */
class Listed {
  readonly name: string;
  readonly odd: boolean;
  constructor(private readonly d: RawEntry) {
    this.name = d.name.toString("utf8");
    this.odd = !Buffer.from(this.name, "utf8").equals(d.name);
  }
  get raw(): Buffer {
    return this.d.name;
  }
  isDirectory(): boolean {
    return this.d.isDirectory();
  }
  isSymbolicLink(): boolean {
    return this.d.isSymbolicLink();
  }
  isFIFO(): boolean {
    return this.d.isFIFO();
  }
  isSocket(): boolean {
    return this.d.isSocket();
  }
  isCharacterDevice(): boolean {
    return this.d.isCharacterDevice();
  }
  isBlockDevice(): boolean {
    return this.d.isBlockDevice();
  }
}

/** The entries of the folder at `dir` (text, or bytes below a name that is not valid UTF-8), in the system's order. */
function listFolder(dir: string | Buffer): Listed[] {
  return readdirSync(dir, { withFileTypes: true, encoding: "buffer" }).map((d) => new Listed(d));
}

/** The path of `e` in the folder at `dir`: text where both are text, else bytes (never handed back as lossy text). */
function pathOf(dir: string | Buffer, e: Listed): string | Buffer {
  if (typeof dir === "string" && !e.odd) return join(dir, e.name);
  return Buffer.concat([typeof dir === "string" ? Buffer.from(dir, "utf8") : dir, Buffer.from(sep), e.raw]);
}

/**
 * THE TWO FORMS OF A PATH THE WALK NAMES, AND WHICH ONE IS MATCHED. A path the walk refuses or holds back is
 * named in two forms, made in `walkIn` (`matched`, `shown`) and nowhere else:
 *
 * - THE MATCH FORM is what every pattern is matched against: the caller's `alwaysReport`, discovery's declaration
 *   patterns, the store manifests' names, a read-scope class. It is the path as text; below or at a name that is not
 *   valid UTF-8, the text that name decodes to with U+FFFD for each byte that is not (as release/rc's listings decoded
 *   it), which keeps every character a pattern can name where it stands. It is never handed to the system, and it is
 *   never taken for the name of an entry: it may be the text of another one. It is `WalkResult.refused[].path`.
 * - THE SHOWN FORM is what a person reads, and nothing is matched against it: every path in `excluded_by_walker` (its
 *   `dir` and its `examples`) and `WalkResult.refused[].shown`. In it a backslash always begins an escape: `\\` is a
 *   backslash of the name and `\xNN` a byte that is not valid UTF-8, so a shown path is the name of exactly one entry
 *   (before, a file named with the literal text `lit\xff.js` and one whose name holds the byte 0xff were both shown
 *   `lit\xff.js`). A name with neither is shown as its text, byte for byte as before. Where a backslash is the
 *   system's separator (Windows) it is never in a name, and is left as it is.
 *
 * The shown form was once matched: asked of the patterns with `\xed` written out, discovery's
 * patterns, which read a backslash as a separator, met `pol/xedtica.md` where the name's own letters stood, and a
 * privacy policy whose name is Latin-1 was no longer named as a declaration this tool could not open. Paths the walk READ (`files`,
 * `readDespiteName`, `heldOnOrigin`) are text, the names the system is handed, and are not in the shown form.
 */
export function shownText(rel: string): string {
  return sep === "/" ? rel.replace(/\\/g, "\\\\") : rel;
}

/** A path held as bytes in the shown form (see `shownText`): its valid UTF-8 as text, each other byte as `\xNN`. */
export function bytesShown(b: Buffer): string {
  let out = "";
  let i = 0;
  while (i < b.length) {
    const c = b[i] as number;
    const n = c < 0x80 ? 1 : c >= 0xc2 && c <= 0xdf ? 2 : c >= 0xe0 && c <= 0xef ? 3 : c >= 0xf0 && c <= 0xf4 ? 4 : 0;
    if (n > 0 && i + n <= b.length) {
      const piece = b.subarray(i, i + n);
      const text = piece.toString("utf8");
      if (Buffer.from(text, "utf8").equals(piece)) {
        out += shownText(text);
        i += n;
        continue;
      }
    }
    out += `\\x${c.toString(16).padStart(2, "0")}`;
    i++;
  }
  return out;
}

/** The kind an entry's own type says it is, where that type alone says it is not a regular file (no call is made). */
function direntKind(e: Listed): NotRegularKind | null {
  if (e.isFIFO()) return "named-pipe";
  if (e.isSocket()) return "socket";
  if (e.isCharacterDevice() || e.isBlockDevice()) return "device";
  return null;
}

export function walkTarget(targetRoot: string, opts: WalkOptions = {}): WalkResult {
  return walkIn(targetRoot, opts, null);
}

/**
 * THE OFFER PROBES' INVARIANT: the probes list each folder at most once between them and are bounded by a work limit of
 * their own; undecided means offered.
 *
 * - The walk hands each probe the entries it held (their listed entries, kept by `holds`), so no probe lists the folder it
 *   starts in; a probe lists only the folders beneath those entries, and a probe hands a nested probe the entries of the
 *   folder it listed. Every entry is held by one class in one setting, so no two probes reach the same folder. (The walk's
 *   own listing of every folder and its count of a held folder, `countTree`, are as before H6.)
 * - Each held folder is probed at most once per class: the walk groups its held entries by class and folder, and a probe
 *   groups the entries a further class holds by class, in the folder it listed, and runs one nested probe per group.
 * - Every entry a probe looks at, every folder it lists, every file whose kind and size it reads and every file it opens
 *   is charged to one count shared by all the probes of the walk (`ProbeWork`); past PROBE_WORK the probes stop.
 * - Whatever the probes do not decide - their limit reached, a folder they cannot list, a file they cannot look at -
 *   counts as a file the re-scan would read: the class is offered, as every class that held a file back was before H6.
 *   So the fall-back costs at most an offer whose re-scan reads nothing more, never an offer withheld.
 */
/**
 * The probes' limit: about 9,000 files opened, half a second; on the ten real trees of the record the probes counted at
 * most 1,710.
 */
const PROBE_WORK = 200_000;
/** What each unit of a probe's work is charged (`ProbeWork`), and the limit: exported for `test:read-scope`. */
export const PROBE_CHARGES = { entry: 1, listing: 1, stat: 4, open: 16, limit: PROBE_WORK } as const;

/** The work count all the probes of one walk share. */
class ProbeWork {
  spent = 0;
  charge(k: number): void {
    this.spent += k;
    if (this.spent > PROBE_WORK) throw RE_SCAN_UNDECIDED;
  }
}

/**
 * A RE-SCAN'S WALK OF HELD PATHS: what `--read <class>` would read beneath paths this scan held back, found by this same
 * walker (`walkIn`, its `visit`) run in the re-scan's setting, on the held entries of one folder (`entries`, as the walk
 * or the probe holding them saw them), with the folders the scan read despite their name on the way (`cleared`), the
 * scan's own origin test and the walk's one probe count.
 */
interface Probe {
  dir: string;
  entries: readonly Listed[];
  cleared: ClearedFolders;
  origin: { test: OriginTest | null };
  work: ProbeWork;
  /** The walk's count of its links' steps (THE WALKER'S BOUND), which its probes share. */
  links: WalkLinks;
}
/** Thrown inside a probe at the first file it would read: the answer is known. */
class ReScanReads {}
const RE_SCAN_READS = new ReScanReads();
/** Thrown inside a probe where it cannot decide (its limit, a folder it cannot list, a file it cannot look at): offered. */
class ReScanUndecided {}
const RE_SCAN_UNDECIDED = new ReScanUndecided();

/**
 * Whether a re-scan with `cls` read as well would read a file of the entries `entries` of the folder `dir`, which this
 * walk (or the probe asking) held back under `cls`; true also where the probe cannot decide (the invariant above). A path
 * the re-scan reaches and another class then holds is walked in turn with that class read as well (a file two classes
 * hold is read by a re-scan with both read, so the offer of the first leads to it), so the answer is yes wherever SOME
 * re-scan that reads `cls` reads a file there. Each nesting reads one class more, so it is at most as deep as the scope
 * has classes.
 */
function reScanReads(targetRoot: string, opts: WalkOptions, scope: ReadScope, cls: string, dir: string, entries: readonly Listed[], cleared: ClearedFolders, origin: { test: OriginTest | null }, work: ProbeWork, links: WalkLinks): boolean {
  const reScope: ReadScope = { classes: scope.classes.map((c) => (c.id === cls ? { ...c, read: true } : c)) };
  try {
    const rel = relativePath(targetRoot, dir);
    work.charge(PROBE_CHARGES.listing + (rel.length >> 6));
    walkIn(targetRoot, { includeNonProduction: opts.includeNonProduction, readScope: reScope }, { dir, entries, cleared: cleared.along(rel), origin, work, links });
    return false;
  } catch (err) {
    if (err instanceof ReScanReads || err instanceof ReScanUndecided) return true;
    throw err;
  }
}

function walkIn(targetRoot: string, opts: WalkOptions, probe: Probe | null): WalkResult {
  const files: string[] = [];
  /** Parallel to `files`: the size the size-limit test below already read. See `WalkResult.sizes`. */
  const sizes: number[] = [];
  let skipped = 0;
  const excluded = new Map<string, WalkExclusion>();
  const refused: { path: string; reason: ExclusionReason; shown: string }[] = [];
  const refusedSeen = new Set<string>();
  /** Folders a class's name nominated, tested, and read (read-scope.ts `ORIGIN_TESTED_CLASSES`). */
  const cleared = probe?.cleared ?? new ClearedFolders();
  const readDespiteName: ReadDespiteName[] = [];
  const heldOnOrigin: { class: string; dir: string; evidence: string }[] = [];
  const heldAsSite: HeldAsSite[] = [];
  /** The vendored class of this walk's scope, which the content test serves; undefined where it has none. */
  const vendoredClass = opts.readScope?.classes.find((c) => c.id === "vendored");
  const heldByContent: { file: string; evidence: string }[] = [];
  const vendoredByContentRead: string[] = [];
  let own: OwnNames | null = null;
  /** The project's own names (vendored-content.ts), read from the scan root on the first file that needs them. */
  const ownNames = (): OwnNames => (own ??= ownNamesOf(targetRoot));
  /** Built on the first nominated folder: a tree with none opens no file it did not open before. One for a scan and its probes. */
  const origin: { test: OriginTest | null } = probe?.origin ?? { test: null };
  /** The count of the steps this walk's links are charged, shared with its probes (THE WALKER'S BOUND). */
  const links = probe?.links ?? new WalkLinks();
  /**
   * The entries a read-scope class held back, by class and by the folder holding them, as this walk saw them, for the
   * probes after the walk (which so never list that folder again).
   */
  const held = new Map<string, Map<string, Listed[]>>();
  const holds = (cls: string, dir: string, e: Listed) => {
    let byDir = held.get(cls);
    if (byDir === undefined) held.set(cls, (byDir = new Map()));
    let entries = byDir.get(dir);
    if (entries === undefined) byDir.set(dir, (entries = []));
    entries.push(e);
  };

  /**
   * THE TWO FORMS OF A PATH THE WALK NAMES (see `shownText`): `matched` is the form every pattern is matched against, `shown`
   * the form a person reads. The path is relative to the root; below a name that is not valid UTF-8 it is held as bytes,
   * each a `latin1` character while `relative` runs, so no byte is lost or changed on the way.
   */
  const rootLatin1 = Buffer.from(targetRoot, "utf8").toString("latin1");
  const relBytes = (p: Buffer): Buffer => Buffer.from(relativePath(rootLatin1, p.toString("latin1")), "latin1");
  const matched = (p: string | Buffer): string => (typeof p === "string" ? relativePath(targetRoot, p) : relBytes(p).toString("utf8"));
  const shown = (p: string | Buffer): string => (typeof p === "string" ? shownText(relativePath(targetRoot, p)) : bytesShown(relBytes(p)));

  /**
   * Record a refused path once, even where two rules would refuse it. The caller's `alwaysReport` is asked with the MATCH
   * form, never the shown one: asked with `\xNN` text, a declaration's pattern met a slash where the name's characters
   * stood, and a privacy policy whose name is Latin-1 vanished from discovery.
   */
  const refuse = (p: string | Buffer, reason: ExclusionReason) => {
    if (!opts.alwaysReport) return;
    const at = shown(p);
    if (refusedSeen.has(at)) return;
    const path = matched(p);
    if (!opts.alwaysReport(path)) return;
    refusedSeen.add(at);
    refused.push({ path, reason, shown: at });
  };

  /**
   * Every path under an excluded tree that the caller asked to hear about. Directories only.
   *
   * `.git` is not swept, and that is a statement about what it contains rather than a budget: it is
   * an object store, its entries are content-addressed blobs and packs, and no path in it is a file
   * the developer wrote. Sweeping it cost 3.3 seconds on a 223,000-file tree — measured 2026-07-29,
   * 2.1s to 5.4s — for a set of paths that can never match anything a caller asks about. Every other
   * excluded tree IS swept, including `node_modules`, because a vendored SDK's declaration lives
   * there and its absence from a report is indistinguishable from nothing having been filed.
   */
  const sweepRefused = (dir: string | Buffer, reason: ExclusionReason) => {
    if (!opts.alwaysReport) return;
    let entries;
    try {
      entries = listFolder(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      // Below a name that is not valid UTF-8 the walk goes on by bytes (THE WALKER'S BOUND), so no path is lost or misnamed.
      const full = pathOf(dir, e);
      if (e.name === ".git") continue; // by name, whatever its type
      if (e.isDirectory()) sweepRefused(full, reason);
      else refuse(full, reason);
    }
  };

  const note = (reason: ExclusionReason, dir: string, example: string, counted: number | null) => {
    // A probe keeps no summary: only its answer is used.
    if (probe !== null) return;
    const key = `${reason}\0${dir}`;
    let e = excluded.get(key);
    if (!e) {
      e = { reason, dir, files: counted, examples: [] };
      excluded.set(key, e);
    } else if (counted !== null) {
      e.files = (e.files ?? 0) + counted;
    }
    if (e.examples.length < EXAMPLE_LIMIT || NAMED_IN_FULL.has(reason)) e.examples.push(example);
  };

  /**
   * Whether a read-scope class of this run names a machine-written folder (GENERATED_DIRS) by its own name, read or not:
   * such a folder is the class's to decide, never refused by name.
   * A walk without a read scope (a bundle built before it, or a caller that passes none) has no class, and refuses it as before.
   */
  const namedByAClass = (name: string): boolean => opts.readScope !== undefined && classNamingFolder(opts.readScope, name) !== null;

  /**
   * Files under `dir`, counted without deciding anything — used to price an excluded tree. Below a name that is not valid
   * UTF-8 the count goes on by bytes (THE WALKER'S BOUND): it never follows a link, so it never counts a file outside the
   * tree, and it never misses one either.
   */
  const countTree = (dir: string | Buffer): { n: number; examples: string[] } => {
    let n = 0;
    const examples: string[] = [];
    const recurse = (d: string | Buffer) => {
      let entries;
      try {
        entries = listFolder(d);
      } catch {
        return;
      }
      for (const e of entries) {
        const full = pathOf(d, e);
        if (e.isDirectory()) {
          // A machine-written folder a class names is counted with the rest: a `--read` can open it, so its files are
          // files this scan did not read.
          if (!GENERATED_DIRS.has(e.name) || namedByAClass(e.name)) recurse(full);
          continue;
        }
        n++;
        if (examples.length < EXAMPLE_LIMIT) examples.push(shown(full));
      }
    };
    recurse(dir);
    return { n, examples };
  };

  /**
   * THE WALKER'S RULE FOR A FILE BY ITS NAME AND ITS ENTRY ALONE, under the read scope `scope`: the reason it does not read
   * the file, or null where it goes on to look at it (its size and its first bytes): `visit`'s, in a scan and in a probe
   * of what a re-scan would read (`reScanReads`).
   */
  const refusedByName = (e: Listed, relFile: string, scope: ReadScope | undefined): ExclusionReason | null => {
    const fileClass = scope ? heldBackBy(scope, relFile, cleared) : null;
    if (fileClass !== null) return readScopeReason(fileClass) as ExclusionReason;
    const special = direntKind(e);
    if (special !== null) return NOT_REGULAR_REASON[special];
    if (IGNORE_FILES.has(e.name.toLowerCase())) return "generated-file";
    if (!isScannableName(e.name)) return "binary-extension";
    if (!opts.includeNonProduction && NON_PRODUCTION_FILE.test(e.name)) return "non-production-file";
    return null;
  };

  /** The work count of the probes, where this walk is one (THE OFFER PROBES' INVARIANT). */
  const work = probe?.work ?? null;

  /**
   * What the documentation-site test
   * (docs-site.ts) is shown of the candidate folder `full`: its listings, one file's first bytes, the names of the files
   * in its tree (by `countTree`'s rule for which folders it enters). Nothing outside the folder but its parent's names;
   * every listing and open charged to a probe's work count, as the walk's own are.
   */
  /**
   * The product's references to folders named
   * like documentation sites (docs-usage.ts), built once per walk, the first time a candidate holding program source is
   * met: every file of the tree the index reads by name, outside every folder and file a read-scope class names WHATEVER
   * THIS RUN READS (so the answer is the same in every run), outside every folder the walker never enters by its name
   * (`folderKind`), following no symbolic link. Bounded by USAGE_FILES and USAGE_BYTES; past them the index is incomplete,
   * a candidate it has not seen used is held, as an unused one is, and every listing and open is charged to a probe's
   * work count, as the walk's own are.
   */
  let usage: DocsUsageIndex | null = null;
  const usageIndex = (): DocsUsageIndex => {
    if (usage !== null) return usage;
    const scope = opts.readScope as ReadScope;
    const unread: ReadScope = { classes: scope.classes.map((c) => ({ ...c, read: false })) };
    const idx = new DocsUsageIndex((seg) => siteCandidateClass(unread, seg) !== null);
    usage = idx;
    let files = 0;
    let bytes = 0;
    const stack: string[] = [targetRoot];
    while (stack.length > 0) {
      const d = stack.pop() as string;
      work?.charge(PROBE_CHARGES.listing);
      let es: Listed[];
      try {
        es = listFolder(d);
      } catch {
        idx.complete = false;
        continue;
      }
      for (const x of es) {
        if (x.odd || x.isSymbolicLink()) continue;
        const full = join(d, x.name);
        const rel = relativePath(targetRoot, full).replace(/\\/g, "/");
        if (x.isDirectory()) {
          if (folderKind(x.name) !== null || wholeTreeHeldBackBy(unread, rel) !== null) continue;
          stack.push(full);
          continue;
        }
        if (!usageReads(x.name) || heldBackBy(unread, rel) !== null) continue;
        if (files >= USAGE_FILES || bytes >= USAGE_BYTES) {
          idx.complete = false;
          continue;
        }
        work?.charge(PROBE_CHARGES.open);
        try {
          const got = sniffRegular(full, 64 * 1024, links.tally);
          if (!got.regular) continue;
          files++;
          bytes += got.head.length;
          idx.addFile(rel, got.head.toString("utf8"));
        } catch {
          continue;
        }
      }
    }
    return idx;
  };
  const siteView = (full: string, parentDir: string, relDir: string): SiteView => {
    const listed = new Map<string, SiteEntry[] | null>();
    const entriesOf = (at: string): SiteEntry[] | null => {
      work?.charge(PROBE_CHARGES.listing);
      try {
        return listFolder(at)
          .filter((x) => !x.odd)
          .map((x) => ({ name: x.name, dir: x.isDirectory() }));
      } catch {
        return null;
      }
    };
    return {
      list: (sub) => {
        if (!listed.has(sub)) listed.set(sub, entriesOf(sub === "" ? full : join(full, sub)));
        return listed.get(sub) ?? null;
      },
      parent: () => entriesOf(parentDir),
      read: (sub, name) => {
        work?.charge(PROBE_CHARGES.open);
        try {
          const got = sniffRegular(sub === "" ? join(full, name) : join(full, sub, name), 64 * 1024, links.tally);
          return got.regular ? got.head.toString("utf8") : null;
        } catch {
          return null;
        }
      },
      usedBy: (ownName) => usageIndex().usedBy(relDir.replace(/\\/g, "/"), ownName),
      treeFileNames: () => {
        const names: string[] = [];
        const recurse = (d: string, at: string): void => {
          work?.charge(PROBE_CHARGES.listing);
          let es: Listed[];
          try {
            es = listFolder(d);
          } catch {
            return;
          }
          for (const x of es) {
            if (x.odd) continue;
            if (x.isDirectory()) {
              if (!GENERATED_DIRS.has(x.name) || namedByAClass(x.name)) recurse(join(d, x.name), `${at}${x.name}/`);
              continue;
            }
            names.push(`${at}${x.name}`);
          }
        };
        recurse(full, "");
        return names;
      },
    };
  };
  const visit = (dir: string, given?: readonly Listed[]) => {
    let entries: readonly Listed[];
    if (given !== undefined) entries = given;
    else {
      work?.charge(PROBE_CHARGES.listing);
      try {
        entries = listFolder(dir);
      } catch {
        // A probe that cannot list a folder cannot decide: the offer stands (THE OFFER PROBES' INVARIANT).
        if (probe !== null) throw RE_SCAN_UNDECIDED;
        // A folder that cannot be listed is named, not passed over: its files were not counted.
        note("could-not-open", shown(dir), shown(dir) || ".", null);
        return;
      }
    }
    const relDir = relativePath(targetRoot, dir);
    const shownDir = shownText(relDir);
    /** In a probe, the entries of this folder that a further class holds, by class: one nested probe each, after the folder. */
    const further = probe === null ? null : new Map<string, Listed[]>();
    const holdsFurther = (cls: string, e: Listed) => {
      if (further === null) return;
      let list = further.get(cls);
      if (list === undefined) further.set(cls, (list = []));
      list.push(e);
    };
    /**
     * A folder `cls` holds back as a whole: every file under it counted and noted under the class, the caller's paths swept
     * out of it, and the entry kept for the probe of what `--read` would read; in a probe, the entry for the nested probe.
     */
    const holdTree = (cls: string, full: string, relTree: string, e: Listed): void => {
      if (probe !== null) {
        holdsFurther(cls, e);
        return;
      }
      const reason = readScopeReason(cls) as ExclusionReason;
      // EVERY FILE UNDER THE FOLDER is the count the coverage block shows, as before H6, for every class; whether
      // `--read` would read any of them is decided after the walk, by a probe (`reScanReads`), and decides the offer only.
      const t = countTree(full);
      note(reason, shownText(relTree), t.examples[0] ?? "", t.n);
      for (const x of t.examples.slice(1)) note(reason, shownText(relTree), x, null);
      sweepRefused(full, reason);
      skipped += t.n;
      holds(cls, dir, e);
    };
    for (const e of entries) {
      work?.charge(PROBE_CHARGES.entry);
      // A NAME THAT IS NOT VALID UTF-8, first and whatever else holds (THE WALKER'S BOUND): its text names another entry or
      // none, so nothing below hands it to the system. Named in full, in its shown form; offered to the caller's patterns
      // in its match form (`refuse`). A folder is a row of its own, its files counted by their bytes, so the sentence a
      // person reads says it is a folder and how many files below it were not read, and its parent's count stays its own. A re-scan reads it no more than this scan
      // does.
      if (e.odd) {
        if (probe !== null) continue;
        const at = pathOf(dir, e);
        const shownOdd = shown(at);
        if (e.isDirectory()) {
          const t = countTree(at);
          note("name-not-utf8", shownOdd, shownOdd, t.n);
          sweepRefused(at, "name-not-utf8");
          skipped += t.n;
        } else {
          skipped++;
          note("name-not-utf8", shownDir, shownOdd, 1);
          refuse(at, "name-not-utf8");
        }
        continue;
      }
      const full = join(dir, e.name);
      // `.git` BY NAME, WHATEVER ITS TYPE. A `.git` that is a file (a worktree's
      // or a submodule's pointer) or a named pipe was once walked as a file, and a named pipe there held the scan for
      // ever. It is git's own, never the developer's, and nothing in it is opened.
      const kind = folderKind(e.name);
      if (kind === "git") {
        // A probe reads nothing of git's, and looks at nothing to say so.
        if (probe !== null) continue;
        if (e.isDirectory()) note("generated-directory", shown(full), "", null);
        else {
          // A link is looked at (nothing is opened) so that its kind is named too: a `.git` link that leads nowhere is
          // `link-to-nothing`, not a file of git's.
          const special = direntKind(e) ?? (e.isSymbolicLink() ? linkKind(full, links) : null);
          if (special !== null) {
            skipped++;
            note(NOT_REGULAR_REASON[special], shownDir, shown(full), 1);
            refuse(full, NOT_REGULAR_REASON[special]);
          } else {
            skipped++;
            note("generated-file", shownDir, shown(full), 1);
            refuse(full, "generated-file");
          }
        }
        continue;
      }
      // Generated trees are tested first, before the hidden-directory rule, because `.git`,
      // `.next`, `.nuxt`, `.turbo`, `.venv` and `.cache` are hidden AND generated. Reporting them
      // as "hidden" would both mislabel them and pay to enumerate a repository's whole object
      // store, which is the one tree whose file count tells the reader nothing.
      if (e.isDirectory() && kind === "generated") {
        // A READ-SCOPE CLASS THAT NAMES IT DECIDES IT (GENERATED_DIRS above): held back and counted under the class, by name
        // alone and with no origin test (a tool wrote it, so it is not the person's own code by its name), unless the
        // class's `--read` was given, and then walked like any folder, every other class still applying beneath it.
        if (namedByAClass(e.name) && opts.readScope !== undefined) {
          const relGen = relativePath(targetRoot, full);
          const genClass = wholeTreeHeldBackBy(opts.readScope, relGen, cleared);
          if (genClass !== null) holdTree(genClass, full, relGen, e);
          else visit(full);
          continue;
        }
        // Deliberately not enumerated: see WalkExclusion.files. The caller's alwaysReport paths
        // are still swept out of it, because "not enumerated" must not mean "not reported".
        note("generated-directory", shown(full), "", null);
        sweepRefused(full, "generated-directory");
        continue;
      }
      // Hidden directories are tooling, not shipped code — except the two that carry
      // compliance-relevant artifacts rules need to see: `.well-known` (security.txt, gpc.json)
      // and `.github`. The latter was added 2026-07-27, when adversarial review measured that
      // 768 files across 26 of 27 pinned repositories were unreadable, and that **one of the
      // three accusations the CRA disclosure rule made was wrong because of it** — one real tree
      // publishes its security address in `.github/ISSUE_TEMPLATE/`, one of the three locations
      // GitHub documents for a security policy. It also restores `.github/workflows` to the
      // match side, which is where release and publishing evidence lives.
      if (kind === "hidden") {
        if (e.isDirectory()) {
          // A re-scan reads nothing here either; a probe does not count it (THE OFFER PROBES' INVARIANT).
          if (probe !== null) continue;
          const t = countTree(full);
          note("hidden-directory", shown(full), t.examples[0] ?? "", t.n);
          for (const x of t.examples.slice(1)) note("hidden-directory", shown(full), x, null);
          sweepRefused(full, "hidden-directory");
          skipped += t.n;
          continue;
        }
      }
      if (e.isDirectory()) {
        if (!opts.includeNonProduction && kind === "non-production") {
          if (probe !== null) continue;
          const t = countTree(full);
          const rel = shown(full);
          note("non-production-directory", rel, t.examples[0] ?? "", t.n);
          for (const x of t.examples.slice(1)) note("non-production-directory", rel, x, null);
          sweepRefused(full, "non-production-directory");
          skipped += t.n;
          continue;
        }
        // THE READ SCOPE, TAKEN AT THE DIRECTORY WHEREVER IT CAN BE. A class whose clause matches
        // this directory in a way that does not depend on the end of the string matches every path
        // beneath it too (`wholeTreeHeldBackBy` says why), so the whole tree is declined here for one
        // recursive count instead of a regular-expression pass per file. A class whose clause matches
        // the directory only as a whole path — a filename clause — declines nothing here and the
        // files below are each tested on their own.
        //
        // Counted exactly like the non-production case above and reported through the same
        // `excluded_by_walker` channel, so `coverage_limits` reads ONE tally. `sweepRefused` still
        // runs: a caller that asked to hear about a path must hear about it wherever it is, and a
        // privacy policy inside a test tree is still the developer's privacy policy.
        //
        // A CLASS WHOSE NAME ONLY NOMINATES (H6). For `vendored`, the name match makes the folder a candidate and
        // vendored-origin.ts decides: held back only where the tree shows the code came from another project and
        // its files do not import this one's. A candidate read is added to `cleared`, so its own name holds back
        // nothing beneath it, while every other class, and a nested folder named like vendored code, still applies.
        const relTree = relativePath(targetRoot, full);
        let treeClass = opts.readScope ? wholeTreeHeldBackBy(opts.readScope, relTree, cleared) : null;
        //
        // A FOLDER NAMED LIKE A DOCUMENTATION SITE: a candidate, held back only where it shows a site (docs-site.ts). Asked whether or not this run reads
        // the class, so the class of what is read beneath it (path-class.ts, through `readDespiteName`) is the same in
        // every run; a candidate read goes into `cleared`, so its own name holds back nothing beneath it, while a folder
        // inside it named like a site is a candidate of its own.
        const siteClass =
          opts.readScope === undefined || (treeClass !== null && !SITE_TESTED_CLASSES.has(treeClass))
            ? null
            : siteCandidateClass(opts.readScope, relTree, cleared);
        if (siteClass !== null && opts.readScope !== undefined) {
          const decided = documentationSiteOf(siteView(full, dir, relTree));
          if (decided.site) heldAsSite.push({ class: siteClass, dir: relTree, why: decided.why, evidence: decided.evidence });
          else {
            cleared.add(relTree);
            readDespiteName.push({ class: siteClass, dir: relTree, files: 0, why: decided.why });
            treeClass = wholeTreeHeldBackBy(opts.readScope, relTree, cleared);
          }
        }
        if (treeClass !== null && opts.readScope && ORIGIN_TESTED_CLASSES.has(treeClass)) {
          if (origin.test === null) {
            // `notOwnCode`: held back by another class's name alone, whatever this run reads (vendored-origin.ts).
            const everyOtherClass: ReadScope = {
              classes: opts.readScope.classes.filter((c) => !ORIGIN_TESTED_CLASSES.has(c.id)).map((c) => ({ ...c, read: false })),
            };
            // `namedLike`: the class's name nominates the folder by its own name, whatever its parents are called.
            const originScope = opts.readScope;
            origin.test = originTester(
              targetRoot,
              folderKind,
              (relSub) => wholeTreeHeldBackBy(everyOtherClass, relSub) !== null,
              (relSub) => nominatedByOwnName(originScope, relSub) !== null,
            );
          }
          // A folder beneath it that the same class nominates by its own name is a candidate of its own, WHATEVER THIS RUN
          // READS: whether another class holds it (or a folder on the way) does not enter the test, so the test of a
          // folder answers the same in every setting, and adding a `--read` never removes a file from what the scan reads:
          // THE READ SET ONLY GROWS, save where the origin tests of a walk reach their limit together, which holds the
          // folders still to be tested in the order the walk meets them, as before H6.
          // Until 10.13 it was "the class would hold it with this one read", which a held test folder on the way hid:
          // `--read tests` then made a nested `third_party/` a candidate of its own, its import left the outer folder's
          // tree, and the outer folder was held where the scan without it had read it.
          const scope = opts.readScope;
          const nominatedBy = treeClass;
          const decided = origin.test(relTree, (relSub) => nominatedByOwnName(scope, relSub) === nominatedBy);
          if (decided.heldBack) heldOnOrigin.push({ class: treeClass, dir: relTree, evidence: decided.evidence ?? "" });
          else {
            cleared.add(relTree);
            treeClass = wholeTreeHeldBackBy(opts.readScope, relTree, cleared);
            if (treeClass === null) {
              // `files` is filled in after the walk, from the files actually passed on beneath it (below).
              readDespiteName.push({
                class: nominatedBy,
                dir: relTree,
                files: 0,
                why: decided.evidence === null ? "no-third-party-origin" : "imports-project-modules",
                nested: decided.nested,
              });
            }
          }
        }
        if (treeClass !== null) {
          holdTree(treeClass, full, relTree, e);
          continue;
        }
        visit(full);
        continue;
      }
      // The same decision at the file, for the clauses that are about a NAME rather than a tree —
      // `x.test.ts`, `foo_test.go`, `index.d.ts` — and for a file sitting directly in a directory no
      // clause covers. First among the file tests because it is the run's own instruction: a person
      // who said "do not read test surfaces" is told that a test file was not read, rather than that
      // it was binary or over the size limit, which are answers to a question they did not ask.
      const relFile = relativePath(targetRoot, full);
      // The tests by name and entry alone, in this order (`refusedByName`): the read scope's class of the file (first,
      // because it is the run's own instruction); NOT A REGULAR FILE BY ITS ENTRY (a named pipe, a socket, a device: named
      // with its kind and never opened, before any test of its name, because a name test would report it as a file of
      // some type when it is not a file at all; a symbolic link is looked at
      // below, where what it leads to is known); a generated file; a binary extension (named, not counted as skipped);
      // a non-production file.
      const byName = refusedByName(e, relFile, opts.readScope);
      if (byName !== null) {
        const byClass = readScopeClassOfReason(byName);
        if (probe !== null) {
          if (byClass !== null) holdsFurther(byClass, e);
          continue;
        }
        if (byName !== "binary-extension") skipped++;
        note(byName, shownDir, shownText(relFile), 1);
        refuse(full, byName);
        if (byClass !== null) holds(byClass, dir, e);
        continue;
      }
      // The size this test reads is KEPT (`sizes` below), not discarded: it is the only stat the
      // walker makes per file, and a second pass over the tree for the same number is a cost no
      // caller should have to pay twice.
      //
      // Looked at through the one reader (project-read.ts), which opens nothing: what a symbolic link leads to is known
      // here, and a link to a named pipe, a socket, a device or a folder, or to nothing, is named with its kind. Until
      // this change a link that led nowhere was dropped here without a word, and a link to a folder was called binary.
      let bytes = 0;
      work?.charge(PROBE_CHARGES.stat);
      try {
        const k = regularKind(full, links);
        if (!k.regular) {
          // A link not followed within the bound (THE WALKER'S BOUND): a probe cannot decide, so the class is offered.
          if (probe !== null && k.kind === "unfollowed") throw RE_SCAN_UNDECIDED;
          skipped++;
          note(NOT_REGULAR_REASON[k.kind], shownDir, shownText(relFile), 1);
          refuse(full, NOT_REGULAR_REASON[k.kind]);
          continue;
        }
        bytes = k.size;
        if (bytes > MAX_FILE_BYTES) {
          skipped++;
          note("size-limit", shownDir, shownText(relFile), 1);
          refuse(full, "size-limit");
          continue;
        }
      } catch {
        // A file a probe cannot look at is not decided: the offer stands (THE OFFER PROBES' INVARIANT).
        if (probe !== null) throw RE_SCAN_UNDECIDED;
        skipped++;
        note("could-not-open", shownDir, shownText(relFile), 1);
        refuse(full, "could-not-open");
        continue;
      }
      // Last gate, and the one that makes the denylist above a convenience rather than a
      // correctness requirement: a format nobody listed is read if its bytes are text and reported
      // if they are not. Costs one 4 KiB read per file that got this far.
      work?.charge(PROBE_CHARGES.open);
      const sniffed: { head?: Buffer; tail?: Buffer } | undefined = vendoredClass !== undefined ? {} : undefined;
      const textual = looksTextual(full, links.tally, sniffed);
      if (probe !== null && textual === "could-not-open") throw RE_SCAN_UNDECIDED;
      if (textual !== true) {
        const reason: ExclusionReason =
          textual === false ? "binary-content" : textual === "could-not-open" || textual === "git-lfs-pointer" ? textual : NOT_REGULAR_REASON[textual];
        if (reason !== "binary-content") skipped++;
        note(reason, shownDir, shownText(relFile), 1);
        refuse(full, reason);
        continue;
      }
      // VENDORED CODE BY ITS CONTENT, beside the
      // path test above: another project's banner, a bundler's wrapper or a source-map trailer in the file's own bytes.
      // Held back as `vendored` where the run does not read that class, counted with it, and offered by its `--read`.
      const byContent = vendoredClass !== undefined && sniffed?.head !== undefined ? vendoredByContent(e.name, sniffed.head, sniffed.tail, ownNames(), relDir.replace(/\\/g, "/")) : null;
      if (byContent !== null && vendoredClass !== undefined && !vendoredClass.read) {
        if (probe !== null) {
          holdsFurther(vendoredClass.id, e);
          continue;
        }
        skipped++;
        note(readScopeReason(vendoredClass.id) as ExclusionReason, shownDir, shownText(relFile), 1);
        refuse(full, readScopeReason(vendoredClass.id) as ExclusionReason);
        holds(vendoredClass.id, dir, e);
        heldByContent.push({ file: relativePath(targetRoot, full), evidence: byContent });
        continue;
      }
      if (probe !== null) throw RE_SCAN_READS;
      files.push(relativePath(targetRoot, full));
      sizes.push(bytes);
      if (byContent !== null) vendoredByContentRead.push(relativePath(targetRoot, full));
    }
    // In a probe, each further class's entries of this folder in one nested probe, handed the entries already listed.
    if (further !== null && opts.readScope)
      for (const [cls, held] of further) if (reScanReads(targetRoot, opts, opts.readScope, cls, dir, held, cleared, origin, work as ProbeWork, links)) throw RE_SCAN_READS;
  };

  if (probe !== null) {
    visit(probe.dir, probe.entries);
    return { files, sizes, skipped, excluded: [], refused, readDespiteName, heldOnOrigin, heldAsSite, originWork: { steps: 0, ms: 0 } };
  }
  visit(targetRoot);
  // THE OFFER: for each class that held a path back, the probes run until one finds a file the re-scan would read, or
  // cannot decide (THE OFFER PROBES' INVARIANT). After the walk, so that nothing they do changes what this scan read.
  const reScan: string[] = [];
  const probes = new ProbeWork();
  if (opts.readScope)
    for (const [cls, byDir] of held) {
      for (const [dir, entries] of byDir) {
        if (reScanReads(targetRoot, opts, opts.readScope, cls, dir, entries, cleared, origin, probes, links)) {
          reScan.push(cls);
          break;
        }
      }
    }
  // THE FILES READ UNDER A FOLDER READ DESPITE ITS NAME are the files this walk passed on beneath it, each counted once,
  // under the deepest such folder that holds it. A file held back beneath it (by another class, or in a nested folder
  // that is another project's) or refused is never passed on, so it is never counted here as well as where it was held.
  // The deepest is found in one step per segment of the path (FolderTrie), so the cost grows neither with the number of
  // folders read despite their name nor with the depth of the tree.
  if (readDespiteName.length > 0) {
    const at = new FolderTrie<number>();
    readDespiteName.forEach((r, k) => at.set(r.dir, k));
    for (const f of files) {
      const parts = f.split("/");
      let best = -1;
      at.along(parts.slice(0, -1), (_, k) => {
        best = k;
      });
      if (best !== -1) (readDespiteName[best] as ReadDespiteName).files++;
    }
  }
  refused.sort((a, b) => a.path.localeCompare(b.path));
  return {
    files,
    sizes,
    skipped,
    excluded: [...excluded.values()],
    refused,
    readDespiteName,
    heldOnOrigin,
    heldAsSite,
    originWork: origin.test?.work() ?? { steps: 0, ms: 0 },
    heldByContent,
    vendoredByContentRead,
    linkWork: { steps: links.spent, limitReached: links.reached },
    reScanReads: reScan.sort(),
    probeWork: { units: probes.spent, limitReached: probes.spent > PROBE_WORK },
  };
}

/**
 * Whether a path would be excluded as non-production. Exported so that the engine can apply the
 * default per-rule surface once `detector.file_globs` is declared everywhere, without the walker
 * having to decide on behalf of all 42 rules.
 */
export function isNonProductionPath(relPath: string): boolean {
  const parts = relPath.split(/[\\/]/);
  if (parts.slice(0, -1).some((p) => NON_PRODUCTION_DIRS.has(p))) return true;
  return NON_PRODUCTION_FILE.test(parts[parts.length - 1] ?? "");
}

/**
 * The length above which a LINE is treated as build output and is not read to any rule.
 *
 * Exported from 2026-08-25 so that the reason something was not read can be stated with the number
 * it was judged against, in `findings.json` and on the console, instead of the number living only
 * inside the predicate. Nothing may keep a second copy of it, which is why
 * `structural/parse.ts` takes the file ceiling from here rather than writing its own.
 *
 * It said "above which a FILE is treated as build output" until 2026-09-07. The number did not
 * move; the unit it is applied in did — see `blankLongLines`.
 */
export const MINIFIED_LINE_LIMIT = 5000;

/**
 * Whether `content` has any line over the ceiling at all.
 *
 * **THE ENGINE NO LONGER ASKS THIS QUESTION OF A FILE.** Until 2026-09-07 this predicate was the
 * whole of the read decision: one line over the ceiling and the other 2,478 were never offered to
 * any rule. `blankLongLines` below replaced it, so what survives here is a bare test kept for the
 * pilot probes under `product/pilot-structural/`, which read a tree the way the engine read one in
 * August. Nothing in `engine.ts` calls it, and nothing should: a caller that wants the ceiling
 * applied wants `blankLongLines`, which applies it per line and says which lines it took.
 *
 * **IT IS A PROXY AND IT IS REPORTED AS ONE.** A long line is not build output. Measured on this
 * repository's own tracked tree on **2026-09-07, 23 authored files under `rules/` exceed the
 * ceiling** — three `ai-annex3-*` checklists at 10,172 to 10,289 characters, `eu-consent-017/rule.yaml`
 * at 9,315, and twenty more rule and checklist documents — and a squashed SQL migration or a base64
 * blob in a configuration file reaches it the same way. (The count said "eight … on 2026-08-25" until
 * today, naming `eu-retention-001/rule.yaml` at 9,898 characters first; that file is no longer among
 * them and the number had nearly trebled. A dated measurement in a header is read as the current one,
 * so it is re-measured when the paragraph around it is rewritten.)
 */
export function looksMinified(content: string): boolean {
  return longestLine(content) > MINIFIED_LINE_LIMIT;
}

/** One line the ceiling blanked, and the measurement the decision was taken on. */
export interface BlankedLine {
  /** 1-based line number — the same number every candidate, quote and record in this scan uses. */
  line: number;
  /** Characters the line held before it was blanked. */
  length: number;
}

/** `blankLongLines`' answer: the text a rule may read, what was taken out of it, and the ceiling. */
export interface BlankedContent {
  /** `content` with every over-long line replaced by the empty string. Identical to `content`, and
   * the very same string object, when nothing was over the ceiling. */
  text: string;
  /** Every line replaced, in ascending line order. Empty when the file was left alone. */
  blanked: BlankedLine[];
  /** Characters in the file's longest line, measured once and reported by whoever needs it. */
  longest: number;
}

/**
 * `content` with every line longer than `MINIFIED_LINE_LIMIT` replaced by the empty string.
 *
 * **THE UNIT OF THE MINIFICATION SKIP IS THE LINE, NOT THE FILE**.
 * The ruling
 * — *do not remove the skip, report it* — keeps all of its substance: a collapsed line
 * still never reaches a rule, a quote or an adjudicator. What it drops is the part nobody decided,
 * that one such line refuses every other line in the same file. Measured over fifteen corpus trees
 * before the change: 1,151 of 93,804 files were refused whole for 1,472 over-long lines among
 * 80,612, and 75,484 non-blank lines were invisible because of them. One tree's defaults file
 * is 2,479 lines of retention configuration refused for one line.
 *
 * Two properties every caller may rely on, and both are asserted in a test:
 *
 *  - **Line numbers do not move.** The blank is an empty line in place, never a deletion, so
 *    `text.split("\n")` has exactly as many entries as `content.split("\n")` and entry `i` is still
 *    line `i + 1` of the file on disk.
 *  - **A blanked line cannot become a candidate.** It is `""`, so no pattern with a character in it
 *    matches it and no `lineText` can quote it.
 *
 * A file with no over-long line is returned unchanged, as the same string, which is the whole of
 * this change's default-unchanged proof at file granularity: 92,653 of those 93,804 files never
 * enter the loop below.
 */
export function blankLongLines(content: string): BlankedContent {
  // THE CEILING IS COMPARED TWICE IN THIS FUNCTION — here, to decide whether there is anything to do
  // at all, and inside the loop, to decide which line. Both read the one constant, so neither can
  // hold a second NUMBER; what they could hold is a second COMPARISON, and moving one of them by one
  // character leaves the other's behaviour intact on every file that reaches only one of them. A
  // file whose longest line is exactly the ceiling never enters the loop, so a test built from such
  // a file cannot see the loop at all. A test (J2b) therefore feeds a file
  // carrying BOTH lengths, which reaches both comparisons in one call and pins them to each other.
  const longest = longestLine(content);
  if (longest <= MINIFIED_LINE_LIMIT) return { text: content, blanked: [], longest };
  const lines = content.split("\n");
  const blanked: BlankedLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    // `lines[i].length` is the same measurement `longestLine` takes, on the same split, so the
    // length this record publishes is the length the decision was taken on. A CRLF file keeps its
    // trailing carriage return inside the segment in both, which is why they agree on it too.
    const length = lines[i]?.length ?? 0;
    if (length > MINIFIED_LINE_LIMIT) {
      blanked.push({ line: i + 1, length });
      lines[i] = "";
    }
  }
  return { text: lines.join("\n"), blanked, longest };
}

/**
 * Characters in the longest line of `content`, counting the last line whether or not it is
 * newline-terminated.
 *
 * Split out of `looksMinified` rather than measured a second time by the caller: the number a scan
 * reports as its reason for skipping a file has to be the number the decision was actually taken
 * on, and two implementations of "longest line" would be free to disagree. `looksMinified` is now
 * defined in terms of this for the same reason `preconditionsMet` is defined in terms of
 * `preconditionStatus`.
 */
export function longestLine(content: string): number {
  let start = 0;
  let max = 0;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) {
      if (i - start > max) max = i - start;
      start = i + 1;
    }
  }
  return Math.max(max, content.length - start);
}
