/**
 * THE ORIENTATION SHEET'S BUILDER AND EVERY INPUT IT IS BUILT FROM, in one module the version gate roots at (delivery design rf11, section 12 item 6).
 *
 * Every adjudicator reads the sheet (`orientation.ts`) before it opens a file, so how the sheet is made is a premise of
 * every verdict. Until this module existed the sheet was built from inputs `scan.ts` computed (the read scope, the
 * walk, the census pass that holds the dependency inventory) and `index.ts` assembled, none of which was a listed
 * verdict-rules source: a product update that changed how the sheet is made moved no version, and verdicts judged on
 * the old sheet carried silently. The parts of `scan.ts` that build those inputs moved here, verbatim in behaviour, so
 * that the version gate can take this module as a root of the judging closure without
 * taking `scan.ts` and its detector engine with it: the closure gains the sheet's builders (`orientation.ts`,
 * `census.ts` and what they import), not the 22 imports of `scan.ts`.
 *
 * `scan.ts` calls these functions for the scan itself, so the scan and the sheet read one walk, one read scope and one
 * census, and nothing about them is written twice. `census-worker.ts` (the sharded path's census) imports
 * `runCensusPass` from here for the same reason, and is a root of the closure of its own because a worker is started by
 * URL, which no static import names.
 */
import { join } from "node:path";
import type { CensusResult, DependencyInventoryEntry } from "wolfboy-schemas";
import { runCensus } from "./census.js";
import { buildOrientation, type OrientationSheet } from "./orientation.js";
import { readSourceText } from "./project-read.js";
import {
  informationalPathClasses,
  readScopeFor,
  type ReadDespiteName,
  type ReadScope,
  type ReadScopeManifest,
  type HeldAsSite,
} from "./read-scope.js";
import { walkTarget, type WalkExclusion } from "./walk.js";

/** What the walk handed on: the files the scan and the sheet read, and what it declined and why. */
export interface WalkedTree {
  files: string[];
  sizes?: number[];
  skipped: number;
  excluded: WalkExclusion[];
  readDespiteName?: ReadDespiteName[];
  reScanReads?: string[];
  /** walk.ts `WalkResult`'s, unchanged. */
  heldByContent?: { file: string; evidence: string }[];
  vendoredByContentRead?: string[];
  /** walk.ts `WalkResult`'s, unchanged. */
  heldAsSite?: HeldAsSite[];
}

/**
 * The run's read scope and the walk under it, as `prepareScan` computes them once per scan.
 *
 * The walker opens `test/`, `spec/`, `fixtures/` and their siblings, and each rule's `detector.file_globs` decides
 * whether it is about them. A caller that names its own `files` (the fixtures runner, the mutation harness, the
 * reconciliation tests) never reaches the walker and is therefore untouched by the scope: those callers name the exact
 * files they mean, and a scope that second-guessed them would silently delete half a fixture suite.
 * `readScopeFor(null, ...)` is the same no-op for a bundle built before the scope existed.
 */
export function readScopeAndWalk(opts: {
  targetRoot: string;
  bundleReadScope: ReadScopeManifest | null | undefined;
  read?: Set<string>;
  files?: string[];
  includeNonProduction?: boolean;
}): { readScope: ReadScope; walked: WalkedTree } {
  const readScope = readScopeFor(opts.bundleReadScope ?? null, opts.read ?? new Set());
  const walked: WalkedTree = opts.files
    ? { files: opts.files, skipped: 0, excluded: [] as WalkExclusion[] }
    : walkTarget(opts.targetRoot, {
        includeNonProduction: opts.includeNonProduction ?? true,
        readScope,
      });
  return { readScope, walked };
}

/**
 * The census pass (coverage-map row C1), as one function so that `runScan` and the worker pool call
 * the identical thing. It is a SECOND, independent pass over the same file list with its own
 * collectors — see census.ts for why the engine is not reused for it — and it is not sharded
 * (step3-workers/proposal.md §A.5): it holds cross-file state that is last-wins in walk order
 * (`xcodeGenAliases`), and it is 2.5-3.9 % of the pass, so sharding it would buy 4 % and put that
 * map at risk for it.
 */
export function runCensusPass(targetRoot: string, files: string[], fileBudgetMs = Infinity): CensusResult {
  return runCensus({
    files,
    // The scan's own per-file budget: the census is a pass over every file's content too.
    fileBudgetMs,
    readFile: (rel) => {
      try {
        return readSourceText(join(targetRoot, rel));
      } catch {
        return null;
      }
    },
  });
}

/**
 * The dependency inventory a findings document carries and the sheet is built from: the census's own, copied verbatim.
 * `scan.ts` writes `findings.dependency_inventory` through this function, so a change to what reaches the document's
 * inventory (and so the sheet's) is a change to a listed source.
 */
export function dependencyInventoryOf(census: CensusResult): DependencyInventoryEntry[] {
  return census.dependency_inventory;
}

/**
 * The orientation sheet of one scan, from the walk, the read scope, the bundle's read-scope manifest and the
 * document's inventory. `index.ts` writes it beside `--out` after the findings document; see there for why it is
 * written after the document and never into it.
 */
export function orientationSheetFor(input: {
  targetRoot: string;
  walked: WalkedTree;
  readScope: ReadScope;
  bundleReadScope: ReadScopeManifest | null | undefined;
  dependencyInventory: DependencyInventoryEntry[] | undefined;
  bundleVersion: string;
}): OrientationSheet {
  return buildOrientation({
    targetRoot: input.targetRoot,
    files: input.walked.files,
    excluded: input.walked.excluded,
    readScope: input.readScope,
    informational: informationalPathClasses(input.bundleReadScope ?? null),
    dependencyInventory: input.dependencyInventory ?? [],
    bundleVersion: input.bundleVersion,
  });
}
