/**
 * THE MAIN-THREAD HALF OF `--jobs`: N worker threads, one dynamic queue, one merge
 * (step3-workers/proposal.md §A.1 and §G.2; stage 3c).
 *
 * WHAT IT IS RESPONSIBLE FOR, AND WHAT IT IS NOT. It decides only WHO scans WHICH file and WHEN.
 * It does not decide anything about a finding: every worker returns `FileRecord`s carrying their
 * own walk index, and `mergeShards` — the one implementation, the same one `--jobs 1` runs over a
 * single shard — reads those indices and nothing else. So the document is a function of the walk
 * list alone, and this file may hand the chunks out in any order it likes. That is the property
 * a test holds, and the reason the test-only shuffle below is safe
 * enough to ship behind a refusal rather than dangerous enough to need compiling out.
 *
 * WHY A DYNAMIC QUEUE AND NOT A STATIC SPLIT. Per-file cost is not proportional to bytes: over 62
 * files of one tree the cost per kilobyte ranges from 0.71 to 130.75 ms, a factor of 184, and a
 * synthetic long-line file costs 42x per byte what ordinary source does (§G.2 of the design).
 * Anything that packs shards up front has to guess the cost from size, which is the one thing
 * available before a file is read and is wrong by two orders of magnitude on exactly the files that
 * decide the tail. A queue does not guess: measured imbalance 4.6 % against round-robin's 24 % at
 * N=4. Size is still used, but only to ORDER the queue — largest first, so the one file that is
 * 4.1 % of a whole pass over that tree is dispatched first and overlapped rather than left as a tail
 * nobody can hide.
 */
import { readFileSync, statSync } from "node:fs";
import { availableParallelism, freemem } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import {
  compileRules,
  mergeShards,
  PrefilterOptionError,
  PrefilterSelfCheckFailure,
  type EngineResult,
  type FileRecordListener,
  type GuardScope,
  type ShardResult,
} from "./engine.js";
import type { CensusWorkerInit, CensusWorkerResponse } from "./census-worker.js";
import { testSeamArmed } from "./test-seams.js";
import type { WorkerInit, WorkerRequest, WorkerResponse } from "./worker-entry.js";
import type { CensusResult, Rule, ScanProfile } from "wolfboy-schemas";

/**
 * Files per message. Eight, from the two ends it is squeezed between: a chunk has to be big enough
 * that a round trip (one `postMessage` each way plus the structured clone of the records) is small
 * beside the scanning, and small enough that the LAST chunk of the run is not a tail every other
 * worker waits on. The design asks for 8-16 (§G.2); the low end is taken because the queue is
 * ordered largest-first, so by the time chunk size matters the queue holds only small files.
 */
const CHUNK_FILES = 8;

/**
 * Chunks a worker may hold at once. Two, not one: with one, a worker sits idle from the moment it
 * posts its records until the main thread has deserialised them and posted the next chunk, and the
 * main thread is doing that for every worker in turn. The second chunk covers that gap. It costs at
 * most one extra chunk of imbalance at the very end of the queue, which at 8 files of the smallest
 * files in the tree is not measurable.
 */
const CHUNKS_IN_FLIGHT = 2;

/**
 * The memory a worker is budgeted, in MB.
 *
 * RE-MEASURED 2026-09-16, BECAUSE THE FIGURE THIS WAS SET FROM IS STALE. The design's §C.2 recorded
 * ~100 MB a worker on the pre-3b engine, which made 400 MB a 4x margin. A least-squares fit over
 * one tree at `--jobs` 2, 3, 4 and 8 — the same estimator as before, and the only
 * one comparable with it — now gives
 *
 *     peak RSS  ~  196 MB  +  154 MB x N     (N scan workers; the census worker sits in the 196)
 *
 * so a worker costs about 154 MB and the margin this divisor leaves is 2.6x rather than 4x. The
 * independent verification of stages 3c/3d/3e measured it on this engine; the
 * author's own arithmetic, `(RSS at N - RSS at 1) / (N - 1)`, read about 10 % high because at
 * `--jobs 1` there is no worker at all and at `--jobs N` there are N + 1 threads.
 *
 * The divisor stays at 400: the margin is still real, and on any machine with 2 GB available the cap
 * of 4 binds first, so this term decides only what a small container does.
 */
const MB_PER_WORKER = 400;

/** The cap on `auto`: `min(cores, 4, availableMB/400)`. */
const AUTO_MAX_JOBS = 4;

/**
 * Below this many bytes of walked source, `auto` resolves to 1 and the scan takes the sequential
 * path (2026-09-16, closing the recommendation the 3c/3d/3e verification made in its §6.6).
 *
 * MEASURED, NOT CHOSEN. The sharded path costs a CONSTANT of about 1.5 s — every worker loads and
 * integrity-checks the bundle, compiles the rules, builds the prefilter automaton and starts ten
 * wasm grammars, and the census worker starts beside them — and that constant is not repaid until
 * there is enough source to divide. Over subsets of one tree's own walk plus another's
 * (verification §6.5), every tree at or below 184 KB was SLOWER at `--jobs 4` than at `--jobs 1`
 * (1.35x to 1.84x the wall clock) and every tree at or above 304 KB was faster, so 256 KB sits
 * inside the band where the effect is small in either direction. A threshold set much higher starts
 * forfeiting real gains fast: 483 KB is already a 36 % win.
 *
 * BYTES AND NOT FILE COUNT. Per-file cost is not proportional to file count — 86 real files lose
 * while 100 planted files win — and the byte total predicts the crossover across both content types.
 *
 * WHERE THE PROXY IS WRONG IT IS WRONG IN THE SAFE DIRECTION. A tree that is one pathological 200 KB
 * file takes the sequential path, and one file cannot be split across workers anyway. A person who
 * disagrees types `--jobs 4`, which is never second-guessed: this floor applies to `auto` alone.
 */
const SEQUENTIAL_BELOW_BYTES = 256 * 1024;

/**
 * The ceiling on a `--jobs` value a PERSON TYPED: four workers per usable core, never more than 64.
 *
 * `auto` has always been capped; an explicit value was taken as given, so `--jobs 200` would try to
 * load and integrity-check the bundle in 200 isolates at ~154 MB each and finish the OOM killer's
 * sentence for it. This is deliberately NOT a clamp to the core count — "a
 * person who knows their machine types `--jobs 8`" is the standing decision and oversubscribing a
 * little is a legitimate thing to measure — but a value four times the cores, or above 64 on any
 * machine, is a typo or a misunderstanding rather than a choice, and it is refused with a message
 * naming the ceiling before anything is read.
 */
const MAX_JOBS_PER_CORE = 4;
const MAX_JOBS_ABSOLUTE = 64;

/** The largest `--jobs` this machine accepts as typed. Never below the `auto` cap, so a value `auto`
 *  itself could have chosen is never refused — a one-core box still accepts `--jobs 4`. */
function maxExplicitJobs(cores: number): number {
  return Math.max(AUTO_MAX_JOBS, Math.min(MAX_JOBS_ABSOLUTE, MAX_JOBS_PER_CORE * cores));
}

/** How `--jobs` resolved, for the line the command prints. */
export interface ResolvedJobs {
  jobs: number;
  /** `true` when the number came from `auto` rather than from a number the person typed. */
  auto: boolean;
  /** The two terms `auto` was capped by, for the report — both meaningless when `auto` is false. */
  cores: number;
  availableMB: number;
  /** The test-only dispatch shuffle's seed, or `null`. See `shuffleSeedFromEnv` for its guard. */
  shuffleSeed: number | null;
  /**
   * Why `auto` resolved the way it did, when the reason is not simply this machine's cores and
   * memory — today only `"tree below 256 KB"`, set by `jobsForWalk`. `null` otherwise. It is printed
   * in the `jobs:` line so that a person who sees one worker on a twelve-core box is told which of
   * the two reasons it was, and it is a property of the TREE rather than of the box, so two runs of
   * one tree still do not differ on paper.
   */
  autoNote: string | null;
}

/**
 * CPU parallelism this process may actually use.
 *
 * `os.availableParallelism()` reports the HOST's cores inside a container, which is exactly where
 * the budget is tightest, so a cgroup v2 quota overrides it where one is set: `cpu.max` is
 * `"<quota> <period>"` in microseconds, or `"max <period>"` for no quota at all.
 *
 * WHAT THIS READING FINDS, AND WHAT IT MISSES. The absolute path
 * below is this process's own cgroup only when the container was given a CGROUP NAMESPACE of its own
 * — Docker's default on a cgroup v2 host. Under `cgroupns=host`, inside a systemd slice, or in a
 * Kubernetes pod whose runtime does not namespace cgroups, `/proc/self/cgroup` names a sub-path and
 * the root file reads `max`, so the quota is missed and the host's core count is used. cgroup v1
 * (`/sys/fs/cgroup/cpu/cpu.cfs_quota_us`) is not read at all. Both misses are toward MORE
 * parallelism and both are bounded by `AUTO_MAX_JOBS`, which is why this is recorded rather than
 * repaired; resolving the path from `/proc/self/cgroup` is a few lines if it is ever worth it.
 */
function usableCores(): number {
  const host = Math.max(1, availableParallelism());
  try {
    const raw = readFileSync("/sys/fs/cgroup/cpu.max", "utf8").trim();
    const [quota, period] = raw.split(/\s+/);
    if (quota === "max") return host;
    const q = Number(quota);
    const p = Number(period);
    if (Number.isFinite(q) && Number.isFinite(p) && q > 0 && p > 0) {
      return Math.max(1, Math.min(host, Math.floor(q / p)));
    }
  } catch {
    // No cgroup v2, or no permission to read it: the host count is the best answer available.
  }
  return host;
}

/**
 * Memory this machine can give a worker, in MB.
 *
 * `MemAvailable` and NOT `os.freemem()`: on Linux `freemem()` excludes the page cache, which a scan
 * warms heavily, so it under-reports by gigabytes and would pin a perfectly healthy machine to
 * `--jobs 1` (§C.2). `freemem()` is the fallback for a platform with no `/proc/meminfo`.
 */
function availableMemoryMB(): number {
  try {
    const m = /^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync("/proc/meminfo", "utf8"));
    if (m) return Math.floor(Number(m[1]) / 1024);
  } catch {
    // Not Linux, or /proc is not mounted.
  }
  return Math.floor(freemem() / (1024 * 1024));
}

/**
 * Resolve `--jobs`. A number is taken as typed; `auto` (the default) is
 * `min(cores, 4, floor(availableMB / 400))`, floored at 1.
 *
 * The 4 is measured rather than chosen: at N=8 on one tree the fastest shard finished in 16.4 s
 * against the slowest at 27.9 s, and on another tree N=8 was SLOWER in wall time than N=4.
 * Four is where the measured return stops being worth ~154 MB a head, and a person who knows their
 * machine types `--jobs 8`. A 2 GB container resolves the memory term to 5 and is capped by the 4;
 * a 512 MB one resolves it to 1 and runs the sequential path, with no `Worker` constructed at all.
 *
 * WHAT IS DECIDED HERE AND WHAT IS NOT. This function is called BEFORE anything is read, because a
 * `--jobs` value the CLI cannot act on — and a stray dispatch seam — must be refused now rather than
 * after a scan has walked a tree. The number `auto` produces here is therefore the RESOURCE cap
 * only; the tree it will be run over does not exist yet. `jobsForWalk` below applies the one term
 * that needs the walk, and it applies it to `auto` alone.
 */
export function resolveJobs(spec: string | undefined): ResolvedJobs {
  const cores = usableCores();
  const availableMB = availableMemoryMB();
  // Resolved HERE, on every path including `--jobs 1`, and not inside the pool: a seam that is
  // silently ignored on one path is a seam a harness can believe it enabled when it did not.
  const shuffleSeed = shuffleSeedFromEnv();
  if (spec === undefined || spec === "auto") {
    const jobs = Math.max(1, Math.min(cores, AUTO_MAX_JOBS, Math.floor(availableMB / MB_PER_WORKER)));
    return { jobs, auto: true, cores, availableMB, shuffleSeed, autoNote: null };
  }
  const n = Number(spec);
  if (!Number.isInteger(n) || n < 1) {
    throw new JobsOptionError(`--jobs must be a positive whole number or "auto", got ${JSON.stringify(spec)}`);
  }
  const ceiling = maxExplicitJobs(cores);
  if (n > ceiling) {
    throw new JobsOptionError(
      `--jobs ${n} is above this machine's ceiling of ${ceiling} (${MAX_JOBS_PER_CORE} per usable core, ` +
        `${cores} core(s) here, never above ${MAX_JOBS_ABSOLUTE}). Every worker loads and integrity-checks the ` +
        `whole bundle and costs about 154 MB of resident memory, so a value this far above the core count ` +
        `spends memory and CPU without shortening the scan. Nothing was scanned. Use a value up to ${ceiling}, ` +
        `or "auto".`,
    );
  }
  return { jobs: n, auto: false, cores, availableMB, shuffleSeed, autoNote: null };
}

/** A `--jobs` (or shuffle-seam) value this module cannot act on. `index.ts` turns it into exit 1. */
export class JobsOptionError extends Error {}

/**
 * THE TEST-ONLY DISPATCH SHUFFLE, and the guard that keeps it out of a user's run.
 *
 * A test needs to hand the workers their chunks in an order no ordinary
 * run produces — including a worker's own files in DESCENDING index order — because that is the
 * test that fails if anything in the merge ever reads arrival order. The tool runs the built CLI as
 * a subprocess, so the seam cannot be a function handed programmatically the way
 * `PrefilterLiteralOverrideForTest` is; it has to be readable from the environment.
 *
 * THE GUARD IS TWO VARIABLES AND A REFUSAL, NOT A SILENT IGNORE. The seed is honoured only when
 * `PRODUCT_CLI_TEST_SEAM` names `jobs-shuffle` — a variable that exists for test seams alone and is
 * set by the gates that need one (`test-seams.ts`, which also carries the comma-separated form a
 * gate uses when it needs two). A seed WITHOUT it stops the run with a message rather than being
 * quietly dropped, so the two accidents a single variable allows — a stray export changing a run's
 * behaviour, and a harness believing it enabled a seam it did not — are both impossible: one is a
 * loud stop and the other cannot happen. Setting both, deliberately, still cannot change a
 * document: the shuffle permutes only who scans what and when, which is the one thing `mergeShards`
 * is built to ignore, and the whole gate is the assertion that this is so.
 */
function shuffleSeedFromEnv(): number | null {
  const raw = process.env.PRODUCT_CLI_JOBS_SHUFFLE;
  if (raw === undefined || raw === "") return null;
  if (!testSeamArmed("jobs-shuffle")) {
    throw new JobsOptionError(
      `PRODUCT_CLI_JOBS_SHUFFLE is a test-only seam: it permutes the order in which worker threads ` +
        `are handed their files, and it is honoured only when PRODUCT_CLI_TEST_SEAM names jobs-shuffle ` +
        `as well. Nothing was scanned. Unset PRODUCT_CLI_JOBS_SHUFFLE, or set both if you meant it.`,
    );
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new JobsOptionError(
      `PRODUCT_CLI_JOBS_SHUFFLE must be a non-negative whole number (a seed), got ${JSON.stringify(raw)}`,
    );
  }
  return n;
}

/** mulberry32 — the same small seeded PRNG `scanShardedForTest` uses, so a failing seed is reportable. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The size of every walked file, in walk order, and their total — one `stat` per file. */
export interface WalkSizes {
  /** Bytes per file, indexed by walk position. A file that cannot be stat'ed is 0 — see below. */
  sizes: number[];
  /** The sum. `jobsForWalk` reads a total of this shape to decide whether a worker can pay for
   *  itself — on the `scan` command's path it is the walker's own sizes summed, not this pass. */
  totalBytes: number;
}

/**
 * Stat the walk, once — THE FALLBACK, and not what the `scan` command takes.
 *
 * `buildQueue` needs the per-file size to order the queue largest-first. A caller that WALKED the
 * tree already has those numbers, because the walker stats every file it accepts for its size limit
 * and keeps the result (`WalkResult.sizes`), and it hands them in as `ShardedRunOptions.sizes`; the
 * `scan` command is that caller on every run. This pass is for a caller that supplied its own file
 * list and never walked, and it is the reason `sizes` can be optional at all. Until 2026-09-16 the
 * `scan` command took it as well, one `stat` per file for numbers it was already holding — 5,721 of
 * them on a large Node CMS (independent verification note §9.1).
 *
 * A file that cannot be stat'ed is given size 0. It sinks to the end of the queue, where it belongs:
 * `scanFile` will fail to read it too and turn it into a `files_not_read` record in a few
 * microseconds, and it adds nothing to the byte total, which is the safe direction for a threshold
 * that chooses workers.
 */
export function measureWalk(targetRoot: string, files: string[]): WalkSizes {
  const sizes = new Array<number>(files.length);
  let totalBytes = 0;
  for (let i = 0; i < files.length; i++) {
    try {
      sizes[i] = statSync(join(targetRoot, files[i])).size;
    } catch {
      sizes[i] = 0;
    }
    totalBytes += sizes[i];
  }
  return { sizes, totalBytes };
}

/**
 * The one term of `auto` that needs the tree: below `SEQUENTIAL_BELOW_BYTES` of walked source, one
 * worker is slower than none, so `auto` resolves to 1 and no `Worker` is constructed.
 *
 * IT APPLIES TO `auto` ALONE. A number a person typed is never second-guessed — `--jobs 4` on a
 * two-file tree builds four workers, which is what it has always done and what a measurement of the
 * overhead needs. `resolveJobs` has already refused anything it cannot act on by the time this runs,
 * so nothing here can fail: the walk is the only new input and the answer is a number either way.
 *
 * @param totalBytes the walked tree's size, summed from the walker's own per-file sizes. It is the
 *   number and not the array because the array is the queue's input and this is the only reader of
 *   the total; `prepareScan` calls this one statement after the walk and before the progress display
 *   is opened, so the number the display prints is this function's answer.
 */
export function jobsForWalk(resolved: ResolvedJobs, totalBytes: number): ResolvedJobs {
  if (!resolved.auto || resolved.jobs === 1 || totalBytes >= SEQUENTIAL_BELOW_BYTES) return resolved;
  return { ...resolved, jobs: 1, autoNote: `tree below ${SEQUENTIAL_BELOW_BYTES / 1024} KB` };
}

/**
 * The queue: every file index, in chunks, largest file first.
 *
 * Ties break on the index so the queue is a function of the walk and not of the filesystem's stat
 * order. The sizes come from `measureWalk` and are not read again here.
 */
function buildQueue(files: string[], sizes: number[], seed: number | null): number[][] {
  const order = files.map((_, i) => i).sort((a, b) => sizes[b] - sizes[a] || a - b);
  // ONE FILE PER CHUNK UNDER THE TEST SEAM. A planted tree is a handful of files, and at the
  // shipped chunk size the whole of it fits in one message — so one worker would scan all of it and
  // the gate would assert nothing about two workers disagreeing. A chunk of one puts every file in
  // its own message, which is what spreads the competing files of tree B (two corroborators for one
  // scope key) and tree A (a guard and its candidate) across different threads. It is part of the
  // same guarded seam as the permutation below and reachable only with it.
  const chunkSize = seed === null ? CHUNK_FILES : 1;
  const chunks: number[][] = [];
  for (let i = 0; i < order.length; i += chunkSize) chunks.push(order.slice(i, i + chunkSize));
  if (seed !== null) {
    // Both axes the design names (§B.3(2)): which chunk a worker gets, and in which order the files
    // inside it are scanned. Reversing the indices inside a chunk is the "descending index order"
    // case specifically.
    const next = mulberry32(seed);
    for (const c of chunks) c.reverse();
    for (let i = chunks.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [chunks[i], chunks[j]] = [chunks[j], chunks[i]];
    }
  }
  return chunks;
}

/**
 * Run the census pass in a thread of its own, concurrently with the detector shards.
 *
 * The promise is created BEFORE the pool and awaited AFTER it, so the pass overlaps the whole of the
 * detectors rather than following them: it is 2.5-3.9 % of a sequential scan, which at `--jobs 4` is
 * most of what is left of the serial part. It costs one more thread — a small one: this worker loads
 * no bundle, compiles no rule and starts no parser runtime (see census-worker.ts).
 *
 * A failure inside it is re-raised here with its stack intact. It is never swallowed: a scan whose
 * census silently produced nothing would answer every applicability question with the same blank an
 * in-order tree produces, which is a forbidden conflation.
 */
export function runCensusInWorker(targetRoot: string, files: string[], fileBudgetMs = Infinity): Promise<CensusResult> {
  const init: CensusWorkerInit = { targetRoot, files, fileBudgetMs };
  return new Promise<CensusResult>((resolve, reject) => {
    const w = new Worker(new URL("./census-worker.js", import.meta.url), { workerData: init });
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      void w.terminate();
      fn();
    };
    w.on("message", (msg: CensusWorkerResponse) => {
      if (msg.type === "census") {
        finish(() => resolve(msg.census as CensusResult));
        return;
      }
      const e = new Error(msg.message);
      if (msg.stack) e.stack = msg.stack;
      finish(() => reject(e));
    });
    w.on("error", (e) => finish(() => reject(e instanceof Error ? e : new Error(String(e)))));
    w.on("exit", (code) => {
      if (!settled) finish(() => reject(new Error(`the census worker exited with code ${code} before it produced a census`)));
    });
  });
}

export interface ShardedRunOptions {
  /** The bundle directory, and the `--rules` spec as typed — each worker applies both itself. */
  bundleDir: string;
  rulesSpec?: string;
  /** The rules the MAIN thread selected. Only their ids cross; each worker checks its own against them. */
  rules: Rule[];
  targetRoot: string;
  /** The walk list, in walk order. `fileCount` for the merge is `files.length` and nothing else. */
  files: string[];
  /**
   * The size of each entry of `files`, at the same index, when the caller already has them — the
   * `scan` command does on every run, because the WALKER stats every file it accepts and keeps the
   * number (`WalkResult.sizes`, handed on through `PreparedScan.walked.sizes`). Omitted only by a
   * caller that supplied its own file list and never walked, and this file then stats them itself
   * (`measureWalk`).
   */
  sizes?: number[];
  scope: GuardScope;
  /**
   * KEPT AND DELIBERATELY UNREAD, EXACTLY AS `runBuiltin`'s FIFTH PARAMETER IS, AND FOR THE SAME
   * REASON. The profile does not gate a detector: `engine.ts`'s `runBuiltin` states the decision and keeps the parameter in its signature so that a later reader cannot
   * silently restore the gate without meeting the note that removed it. Until 2026-09-16 the sharded
   * path had no such field at all, so that note stood on the one path a restored gate would still
   * have been right on, and `--jobs 1` and `--jobs N` would have diverged in silence.
   * If a profile is ever read here, it must be read in `runBuiltin` too, and the answer to
   * "should it be?" is in that comment and not in this one.
   */
  profile: ScanProfile | null;
  /** How many workers. Always >= 2 here: `--jobs 1` never reaches this file. */
  jobs: number;
  /** `ResolvedJobs.shuffleSeed` — the test-only dispatch permutation, or `null` for every real run. */
  shuffleSeed: number | null;
  /**
   * The per-file wall-clock budget in milliseconds, or `Infinity` for none (`--file-budget`).
   *
   * IT IS PER FILE AND PER WORKER, so sharding composes with it and needs no arithmetic: each
   * worker calls `scanFile`, and `scanFile` starts a clock per file. Two workers do not share an
   * allowance and a file's budget does not shrink because another thread is busy — which is what
   * makes `--jobs 1` and `--jobs 8` stop the same files at the same budget.
   */
  fileBudgetMs: number;
  /**
   * Whether every candidate carries its kind facts (`--kind-census`), resolved once by the command.
   *
   * It crosses to every worker in `WorkerInit` rather than being read from the environment there,
   * for the reason the budget does: a switch resolved twice is a switch two threads can answer
   * differently, and a document whose same-kind line groups depend on which thread opened which
   * file is not a scan of anything.
   */
  kindCensus: boolean;
  /**
   * The step-5 progress seam. Called on THIS thread, once per record, as each chunk comes home —
   * so the stream is in COMPLETION order (§E.4) and not in walk order, and a file scanned by the
   * slowest worker appears when it is done rather than when its neighbours are. It changes nothing
   * about the merge: `shards` is pushed in arrival order either way and `mergeShards` sorts on
   * `FileRecord.index`, which is the one thing it reads.
   */
  onRecord?: FileRecordListener;
}

/**
 * Scan `files` across `jobs` worker threads and merge the result into the `EngineResult` a
 * sequential walk produces.
 *
 * `fileCount` handed to `mergeShards` is `files.length` — THE WALK — and never `records.length`.
 * That is what lets the permutation assertion there catch a dropped LAST file: indices 0..n-2
 * arriving for an n-file walk are a perfectly good permutation of 0..len-1 and would otherwise be
 * silent (`followup-3ab-2026-09-15.md` §5, `integration-2026-09-15.md` §8 item 2).
 */
export async function runShardedBuiltin(opts: ShardedRunOptions): Promise<EngineResult> {
  const queue = buildQueue(opts.files, opts.sizes ?? measureWalk(opts.targetRoot, opts.files).sizes, opts.shuffleSeed);
  // Compiled on the main thread too, because `mergeShards` needs it: it re-binds each `WireMatch`
  // to its `Rule` by id and seeds `filesOnSurface` from the rule list so that "no file was offered"
  // and "the rule was not in the run" stay different answers. The prefilter is NOT built here — no
  // file is read on this thread — so the main process pays the compile and not the automaton.
  const compiled = compileRules(opts.rules);
  const init: WorkerInit = {
    bundleDir: opts.bundleDir,
    ...(opts.rulesSpec === undefined ? {} : { rulesSpec: opts.rulesSpec }),
    ruleIds: opts.rules.map((r) => r.id),
    targetRoot: opts.targetRoot,
    files: opts.files,
    // `Infinity` survives the structured clone `workerData` is copied by, so "off" crosses as
    // itself and no sentinel is needed on either side.
    fileBudgetMs: opts.fileBudgetMs,
    kindCensus: opts.kindCensus,
  };
  const workerUrl = new URL("./worker-entry.js", import.meta.url);

  const shards: ShardResult[] = [];
  let next = 0;
  await new Promise<void>((resolve, reject) => {
    const workers: Worker[] = [];
    /** Chunks each worker currently holds. The budget is PER WORKER, so one fast thread cannot take
     * the whole allowance and leave the others with one chunk each. */
    const inFlight = new Map<Worker, number>();
    let outstanding = 0;
    let settled = false;
    /**
     * Stop everything, once. A worker that has already been asked to stop must not be able to turn
     * a failure into a second rejection, and a failure must not leave threads running: the process
     * would not exit and the person would see a hang where there was an error.
     */
    const finish = (err?: Error): void => {
      if (settled) return;
      settled = true;
      for (const w of workers) void w.terminate();
      if (err) reject(err);
      else resolve();
    };
    const pump = (w: Worker): void => {
      while (next < queue.length && (inFlight.get(w) ?? 0) < CHUNKS_IN_FLIGHT) {
        const chunk = queue[next++];
        inFlight.set(w, (inFlight.get(w) ?? 0) + 1);
        outstanding++;
        const req: WorkerRequest = { type: "chunk", indices: chunk };
        w.postMessage(req);
      }
    };
    for (let i = 0; i < opts.jobs; i++) {
      const w = new Worker(workerUrl, { workerData: init });
      workers.push(w);
      w.on("message", (msg: WorkerResponse) => {
        switch (msg.type) {
          case "ready":
            pump(w);
            // An empty walk, or more workers than chunks: there is nothing for this thread to do
            // and nothing outstanding anywhere, so the run is already over.
            if (next >= queue.length && outstanding === 0) finish();
            return;
          case "records":
            inFlight.set(w, (inFlight.get(w) ?? 1) - 1);
            outstanding--;
            {
              const records = msg.records as ShardResult["records"];
              shards.push({ records });
              // AFTER the push and BEFORE `pump`: the records are already in `shards` whatever the
              // listener does, and the screen is told about a chunk before the next one is handed
              // out. The listener is contracted not to throw (`FileRecordListener`), and a throw
              // here is an uncaught exception inside a `message` handler — the process, not a
              // rejected scan, and at this point the findings document has not been written.
              //
              // THAT CONTRACT IS HELD IN `progress.ts`, AND THIS COMMENT NO LONGER ASSUMES IT. It
              // used to read "`progress.ts` is written so that nothing in it can", and EPIPE made
              // that false: with `--progress always` and the reader of stderr gone (`2>&1 | head`,
              // `| less` then `q`), the write's error arrived here and killed the run BEFORE
              // `writeFindingsJson` — exit 1 and no document at all, where `--progress never` under
              // the identical close exited 0 and wrote it.
              // `progress.ts` now latches itself off on the stream's own `error` event
              // and wraps every write in a `try/catch`, which is what makes the contract true.
              if (opts.onRecord) for (const r of records) opts.onRecord(r);
            }
            pump(w);
            if (next >= queue.length && outstanding === 0) finish();
            return;
          case "self-check":
            // §E.3: the scan is stopped rather than allowed to finish and report "no problems
            // found". The class is re-raised here so `index.ts`'s `throughTheEngine` prints the
            // four-line report and exits 1, exactly as it does for a sequential run.
            finish(new PrefilterSelfCheckFailure(msg.message));
            return;
          case "option-error":
            finish(new PrefilterOptionError(msg.message));
            return;
          case "failed": {
            const e = new Error(msg.message);
            if (msg.stack) e.stack = msg.stack;
            finish(e);
            return;
          }
        }
      });
      w.on("error", (e) => finish(e instanceof Error ? e : new Error(String(e))));
      w.on("exit", (code) => {
        // A WORKER THAT IS GONE WHILE THE POOL IS STILL WAITING FAILS THE RUN, whatever its exit
        // code. The condition is `!settled` and not `code !== 0` on purpose: the defect this closes
        // is not "a worker crashed", it is "the pool is waiting for a thread that will never
        // answer", and an exit code of 0 produces exactly that — a scan that never finishes and
        // never says why. Every worker that exits during a SUCCESSFUL run exits after `finish`
        // terminated it, so `settled` is already true and this line is silent for all of them.
        //
        // It is never left to the merge, either. `mergeShards`' permutation assertion would catch
        // the missing indices, but it would name the files rather than the cause, and a worker the
        // OOM killer took is the cause a person needs to read.
        if (!settled) {
          finish(
            new Error(
              `a scan worker exited (code ${code}) before the scan finished (--jobs ${opts.jobs}) — ` +
                `${queue.length - next} chunk(s) had not been dispatched and ${outstanding} were still out`,
            ),
          );
        }
      });
    }
  });

  // THE ONLY ORDERING AUTHORITY IS `FileRecord.index`, which is why `shards` may be pushed in
  // arrival order here and handed over exactly as it arrived.
  return mergeShards(compiled, shards, opts.scope, opts.files.length);
}
