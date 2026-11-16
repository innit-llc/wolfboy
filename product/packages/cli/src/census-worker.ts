/**
 * THE CENSUS, IN A THREAD OF ITS OWN.
 *
 * `runCensus` is a SECOND, INDEPENDENT PASS over the same file list as the detectors, with its own
 * collectors and its own reads (census.ts states why the engine is not reused for it). It is not
 * sharded and this file does not shard it: one thread reads the whole list in walk order, exactly
 * as a sequential scan does, so the last-wins-in-walk-order state inside it — `xcodeGenAliases`
 * above all — is decided by the same file it has always been decided by. What the thread buys is
 * that the pass overlaps the detectors instead of following them.
 *
 * IT LOADS NO BUNDLE AND COMPILES NOTHING. The census is a set of collectors over file text; it has
 * no rules, no prefilter and no parse trees, so this worker is a fraction of a scan worker's
 * resident memory and starts in milliseconds. That is why it is its own entry point rather than a
 * mode of `worker-entry.ts`: a census worker that went through that file's `prepare()` would load
 * and integrity-check the bundle, compile 117 rules and start the wasm parser runtime, for a pass
 * that reads none of it.
 *
 * THE PASS ITSELF IS `runCensusPass` (orientation-inputs.ts), the same function `runScan` calls on the sequential
 * path. Nothing about which files are read, or how, is written twice. This module is a root of the judging closure the
 * version gate derives: a worker is started by URL, which no static import names, so the
 * gate could not reach it from the pool.
 */
import "./install-guard-on.js"; // FIRST: no package from outside the shipped install
import { parentPort, workerData } from "node:worker_threads";
import { runCensusPass } from "./orientation-inputs.js";
import { declareProjectFolder } from "./project-read.js";

/** What the pool hands this worker once, at construction. Both fields are plain data. */
export interface CensusWorkerInit {
  targetRoot: string;
  /** The walk list, in walk order — the ONLY order this pass may read them in. */
  files: string[];
  /** The scan's per-file budget in milliseconds, `Infinity` for none; a structured clone carries it. */
  fileBudgetMs: number;
}

/** What it sends back: the census, or the failure that stopped it. */
export type CensusWorkerResponse =
  | { type: "census"; census: unknown }
  | { type: "failed"; message: string; stack?: string };

const port = parentPort;
if (port === null) throw new Error("census-worker.js must be run as a worker thread");
const init = workerData as CensusWorkerInit;
// The scanned folder, declared in this thread too, so the census's reads stay inside it.
declareProjectFolder(init.targetRoot);

try {
  const response: CensusWorkerResponse = { type: "census", census: runCensusPass(init.targetRoot, init.files, init.fileBudgetMs) };
  port.postMessage(response);
} catch (e) {
  const err = e instanceof Error ? e : new Error(String(e));
  const response: CensusWorkerResponse = { type: "failed", message: err.message, stack: err.stack };
  port.postMessage(response);
}
