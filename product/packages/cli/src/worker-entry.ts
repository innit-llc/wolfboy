/**
 * THE WORKER SIDE OF `--jobs` — one thread, one compiled bundle, one chunk of file indices at a
 * time (step3-workers/proposal.md §A.1, stage 3c).
 *
 * It holds no cross-file state of its own and decides nothing: every file it scans becomes a
 * `FileRecord` carrying its own index, and `mergeShards` on the main thread turns the records back
 * into the document a single sequential walk produces. Which files this worker got, and in which
 * order, is therefore invisible in the output — that is the property `test:jobs-determinism` and
 * `test:shard-merge` exist to hold, and the reason this file may take its chunks in any order.
 *
 * WHAT IT LOADS, AND WHY IT LOADS IT RATHER THAN RECEIVING IT.
 *
 * - The BUNDLE, from the directory the main thread was given, through the same `loadBundle` +
 *   `selectRules` pair `index.ts` uses — so the integrity digests are verified in this thread too
 *   and the `--rules` narrowing is the same narrowing, applied by the same function, rather than a
 *   second implementation of it. The main thread sends the rule ids it decided on and this file
 *   REFUSES TO SCAN if its own list differs: two threads reading two different rule sets would
 *   produce a merged document that is not a scan of anything, and the failure has to be loud.
 * - `compileForScan`, ONCE (engine.ts): `CompiledRule` holds `RegExp`s and the whole `Rule`
 *   objects, and the prefilter automaton is derived from the bundle, so neither can cross a
 *   `postMessage` boundary and both are cheap to rebuild (§F.3 #1).
 * - `prepareStructural()`, ONCE, awaited before the first chunk, and only when the selected rules
 *   declare a structural check. The grammar cache is module-level and therefore per-thread: a
 *   worker that skipped this would not crash, it would report every language as unavailable and
 *   silently raise none of the candidates a parse tree finds (`scanShard`'s own note in engine.ts).
 *
 * HOW A REFUSAL GETS HOME. `PrefilterSelfCheckFailure` is the one exception this engine throws that
 * a person is meant to read (proposal §E.3): it means a line was skipped that a rule matches, and
 * the scan must stop rather than finish and report "no problems found". A thrown error does not
 * cross `postMessage` as itself, so it crosses as a typed message carrying its message text, and
 * `engine-pool.ts` re-raises it on the main thread as the same class — where `index.ts`'s
 * `throughTheEngine` already turns it into the four-line report and exit 1.
 */
import "./install-guard-on.js"; // FIRST: no package from outside the shipped install
import { parentPort, workerData } from "node:worker_threads";
import { loadBundle, selectRules } from "./bundle.js";
import {
  compileForScan,
  declaresStructuralChecks,
  PrefilterOptionError,
  PrefilterSelfCheckFailure,
  scanShardOf,
  type CompiledScan,
} from "./engine.js";
import { prepareStructural } from "./structural/index.js";
import { declareProjectFolder } from "./project-read.js";

/** What the pool hands a worker once, at construction. Every field is plain data. */
export interface WorkerInit {
  /** The bundle directory the main thread loaded — loaded again here, integrity check included. */
  bundleDir: string;
  /** The `--rules` argument as typed, or `undefined`. Applied by `selectRules`, as `index.ts` does. */
  rulesSpec?: string;
  /** The rule ids the MAIN THREAD ended up with, in order. A mismatch here stops the run. */
  ruleIds: string[];
  targetRoot: string;
  /** The whole walk list, sent once. A chunk is a list of indices into it. */
  files: string[];
  /**
   * The per-file wall-clock budget in milliseconds, or `Infinity` for none. Decided once by the
   * command and sent, rather than resolved again here: two threads resolving an option separately
   * is exactly a forbidden second copy of a decision, and a worker that read a
   * different budget would stop different files.
   */
  fileBudgetMs: number;
  /**
   * Whether every candidate this worker raises carries its kind facts (`--kind-census`).
   *
   * Decided once by the command and sent, on the same terms as the budget above: two threads
   * resolving the switch separately is a forbidden second copy of a decision, and a
   * worker that read it differently would write half a census into one document — a document whose
   * same-kind line groups depend on which thread happened to open which file.
   */
  kindCensus: boolean;
}

/** A chunk of work: the file indices to scan, in the order to scan them. */
export type WorkerRequest = { type: "chunk"; indices: number[] };

/** What a worker sends back. `records` is `ShardResult.records` for the chunk it was given. */
export type WorkerResponse =
  | { type: "ready" }
  | { type: "records"; records: unknown[] }
  | { type: "self-check"; message: string }
  | { type: "option-error"; message: string }
  | { type: "failed"; message: string; stack?: string };

const port = parentPort;
if (port === null) throw new Error("worker-entry.js must be run as a worker thread");
const init = workerData as WorkerInit;
// This thread's own copy of the one reader keeps every read inside the scanned folder, as the main thread's does: the
// folder is declared here too, since a thread shares no module state.
declareProjectFolder(init.targetRoot);

/**
 * Everything this thread needs before it can scan, built once.
 *
 * The rule-id check is the whole reason the main thread sends `ruleIds` at all. `loadBundle` proves
 * the bundle has not been tampered with; it does not prove that THIS thread read the same bundle
 * the main thread read, and after `--rules` it does not prove the same selection either. Comparing
 * the resulting id lists does, in one string comparison, and a divergence is a crash naming both
 * counts rather than a document assembled out of two different scans.
 */
async function prepare(): Promise<{ scan: CompiledScan; targetRoot: string; files: string[] }> {
  const bundle =
    init.rulesSpec === undefined ? loadBundle(init.bundleDir) : selectRules(loadBundle(init.bundleDir), init.rulesSpec);
  const mine = bundle.rules.map((r) => r.id);
  if (mine.length !== init.ruleIds.length || mine.some((id, i) => id !== init.ruleIds[i])) {
    throw new Error(
      `worker bundle mismatch: this thread loaded ${mine.length} rule(s) from ${init.bundleDir} and the main ` +
        `thread selected ${init.ruleIds.length}. The two threads are not scanning with the same rules, so the ` +
        `merged document would not be a scan of anything. Nothing was scanned by this worker.`,
    );
  }
  // Before the first chunk, never per chunk — see this file's header and engine.ts §F.3 #1.
  if (declaresStructuralChecks(bundle.rules)) await prepareStructural();
  return {
    // The labels are redacted with the CLI's own credential patterns, as the main thread's are (engine.ts
    // `productCredentials`): never a bundle's.
    scan: compileForScan(bundle.rules, undefined, init.kindCensus, true),
    targetRoot: init.targetRoot,
    files: init.files,
  };
}

/**
 * The classes that mean "stop the whole scan and tell the person", forwarded as typed messages
 * rather than as a stack. Anything else is a defect and goes home as `failed` with its stack, so
 * that a worker can never die quietly and leave the main thread waiting.
 */
function report(e: unknown): WorkerResponse {
  if (e instanceof PrefilterSelfCheckFailure) return { type: "self-check", message: e.message };
  if (e instanceof PrefilterOptionError) return { type: "option-error", message: e.message };
  const err = e instanceof Error ? e : new Error(String(e));
  return { type: "failed", message: err.message, stack: err.stack };
}

/**
 * THE SETUP RUNS INSIDE A FUNCTION AND NOT AS A TOP-LEVEL `await`, AND THAT IS NOT A STYLE CHOICE.
 *
 * `await prepare()` at the top level of this module would make it an ASYNC MODULE, and a `Worker`
 * whose entry module is still evaluating asynchronously cannot be terminated: V8 aborts the whole
 * process with `Fatal error … Check failed: (location_) != nullptr` out of
 * `SourceTextModule::ExecuteAsyncModule`. The pool terminates workers as a matter of course — the
 * moment the queue drains, every worker that has not been given anything is stopped, and on a tree
 * small enough to fit in one chunk that is most of them, while they are still loading grammars.
 *
 * MEASURED, NOT REASONED ABOUT: with the top-level await, `npm run gates` died at step 33
 * (`test:profile-gating`) with exactly that V8 fatal error, on a case whose planted tree is three
 * files — one chunk, one worker needed, three terminated mid-evaluation. Six tiny-tree scans run by
 * hand beforehand had passed, because the crash needs the terminate to land inside the evaluation
 * window. Inside a function the module finishes evaluating synchronously, the asynchronous work
 * continues in an ordinary microtask, and terminating the worker is the supported operation it is
 * everywhere else.
 */
void (async () => {
  try {
    const { scan, targetRoot, files } = await prepare();
    port.on("message", (msg: WorkerRequest) => {
      try {
        // THE ONE CALL THAT SCANS, and the only one in this file: `scanShardOf` cannot be given the
        // compiled rules without the prefilter built over them, which is why it exists (engine.ts).
        const shard = scanShardOf(scan, targetRoot, msg.indices, files, init.fileBudgetMs);
        const response: WorkerResponse = { type: "records", records: shard.records };
        port.postMessage(response);
      } catch (e) {
        port.postMessage(report(e));
      }
    });
    const ready: WorkerResponse = { type: "ready" };
    port.postMessage(ready);
  } catch (e) {
    port.postMessage(report(e));
  }
})();
