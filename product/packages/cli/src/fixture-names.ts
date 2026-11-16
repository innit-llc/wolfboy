/**
 * The name a FIXTURE MUTANT is handed to the scanner under.
 *
 * ## What this is for, and why it is not part of the scanner
 *
 * Mutation fixtures are named `<stem>.mut-<n>.<ext>` beside the base they mutate. That convention
 * belongs to this repository's test tooling and to nothing else: no user repository contains a
 * `.mut-<n>.` file, and the shipped scan path must never learn about one.
 *
 * The convention has one collision. Where a base fixture's language is decided by a COMPOUND
 * extension, inserting `.mut-<n>` before the final segment breaks the compound:
 * `x.blade.php` is Blade, and `x.blade.mut-1.php` is nothing at all, because
 * `structural/languages.ts` keys `blade` on `/\.blade\.php$/`. `languageFor` then returns null, the
 * parse-tree reading is skipped without a word, and the mutant is scored against a strictly weaker
 * detector than its own base — so a mutant that the detector genuinely still catches is reported as
 * a hole in the detector. Two harnesses hit this: a check (G3) and the
 * `test-rules` command (gate step `test:rules`).
 *
 * The repair is to move the `.mut-<n>` segment one dot-boundary at a time and take the first
 * position at which the engine's own name-only decisions agree with what they say about the base.
 * `x.blade.mut-1.php` becomes `x.mut-1.blade.php`: still Blade, still distinguishable from the base,
 * still carrying its own index.
 *
 * ## Why the repair lives HERE rather than in `languageFor` or in a tool
 *
 * - NOT in `structural/languages.ts`. That file's own header states `languageFor` is a pure function
 *   of one path with nowhere to hang a heuristic; teaching it `.mut-<n>` would put a fixture
 *   convention into the shipped scanner, where it can only ever be wrong about a real repository.
 * - NOT by generalising the extension tables to match an interior segment. That changes how real
 *   user trees are read — `page.md.php` would become markdown, `x.ts.snap` TypeScript — a live
 *   behaviour change justified by nothing but a test tool's naming scheme.
 * - NOT in `tools/`. `test-rules.ts` compiles into the published package and cannot import from this
 *   repository's private tooling.
 * - NOT inside `test-rules.ts`. Two call sites need this and a shared decision buried inside one of
 *   its two consumers is the second copy waiting to drift. A check imports this
 *   module out of `dist/` exactly as it already imports `markupElementAt`, `languageFor`,
 *   `syntaxFor` and `isNonProductionPath`.
 *
 * So this is product source that is not scanner behaviour, which is the same status `test-rules.ts`
 * has. NOTHING ON THE SCAN PATH IMPORTS IT: not `scan.ts`, not `engine.ts`, not `walk.ts`, not
 * `structural/*`. It is imported by `test-rules.ts` and by a check, and by
 * nothing else. A scan of a real tree — including `checkDeliveryEndToEnd`'s subprocess scans, which
 * walk `rules/packs` as a user's scanner would — reads every file under the name it has on disk, and
 * must: there the mutant is just a file, and presenting it as something else would be inventing a
 * repository that does not exist.
 *
 * ## The three decisions the repair has to preserve, and the two it cannot
 *
 * Three of the scan path's decisions are made from a relative path ALONE, and each one changes what
 * a rule sees, so all three are held equal between a mutant and its base:
 *
 *   - `languageFor` (structural/languages.ts) — which grammar the file is parsed with, if any;
 *   - `syntaxFor` (strip-comments.ts) — which comment syntax the guards see;
 *   - `isNonProductionPath` (walk.ts) — the default surface, via `engine.ts`'s `surfaceAllows`.
 *
 * Two more are made PER RULE — `detector.file_globs` and `detector.path_without` — so they cannot
 * enter a name-only predicate at all. They are the caller's to check, against the name this module
 * returns; a check does so in `checkRuleSurface`.
 *
 * One pair is invariant and is deliberately not checked: `yamlAnchorView` and `importAliasTable`
 * both key on `derive.ts`'s `extensionOf`, which reads the FINAL dot-segment of the basename and
 * nothing else. Neither inserting `.mut-<n>` before that segment nor moving it further left can
 * change it.
 */

import { languageFor } from "./structural/languages.js";
import { syntaxFor } from "./strip-comments.js";
import { isNonProductionPath } from "./walk.js";

/** `<stem>.mut-<n>.<ext>`: the mutation-fixture naming convention, in one place. */
export const MUTANT_NAME = /^(.+)\.mut-(\d+)\.([^.]+)$/;

/**
 * Do two relative paths resolve the same way everywhere the scan path decides from a name alone?
 * All three terms, because each of them changes the detector a file is scored against.
 */
export function resolvesAlike(a: string, b: string): boolean {
  return (
    languageFor(a) === languageFor(b) &&
    syntaxFor(a) === syntaxFor(b) &&
    isNonProductionPath(a) === isNonProductionPath(b)
  );
}

export interface PresentedName {
  /** The relative path to hand the scanner. The file's own, unless `repaired`. */
  path: string;
  /** The base fixture this file mutates; null when the name is not a mutant name at all. */
  base: string | null;
  /** True when `path` differs from the file's own name, so the bytes must be staged under it. */
  repaired: boolean;
  /**
   * True when the name IS a mutant name and no name in its family resolves the way its base does.
   * `path` is then the file's own name and the caller must FAIL: scanning it anyway, quietly, is
   * the silent weaker reading this module exists to end.
   */
  unresolved: boolean;
}

/** Split a relative path into its directory prefix (with trailing separator) and its basename. */
function splitDir(relPath: string): { dir: string; name: string } {
  const i = Math.max(relPath.lastIndexOf("/"), relPath.lastIndexOf("\\"));
  return i < 0
    ? { dir: "", name: relPath }
    : { dir: relPath.slice(0, i + 1), name: relPath.slice(i + 1) };
}

/**
 * The name `relPath` should be handed to the scanner under.
 *
 * Only the basename is rewritten: `isNonProductionPath` reads the directories too, so the prefix has
 * to survive untouched or the repair would move the file to a different surface while claiming to
 * preserve one.
 *
 * The search starts at the FIRST dot boundary and walks right, so the shortest move that works is
 * taken; the file's own name is itself the last candidate in that walk, and is rejected there for
 * the same reason it was rejected at the top. `candidate !== base` is not a formality: the presented
 * name has to stay distinguishable from the base's, or a path-keyed clause would be answering about
 * the wrong file.
 */
export function presentFixtureName(relPath: string): PresentedName {
  const { dir, name } = splitDir(relPath);
  const m = name.match(MUTANT_NAME);
  if (!m) return { path: relPath, base: null, repaired: false, unresolved: false };

  const baseName = `${m[1]}.${m[3]}`;
  const base = dir + baseName;
  if (resolvesAlike(relPath, base)) {
    return { path: relPath, base, repaired: false, unresolved: false };
  }

  const segments = baseName.split(".");
  for (let i = 1; i < segments.length; i++) {
    const candidate =
      dir + [...segments.slice(0, i), `mut-${m[2]}`, ...segments.slice(i)].join(".");
    if (candidate !== base && resolvesAlike(candidate, base)) {
      return { path: candidate, base, repaired: candidate !== relPath, unresolved: false };
    }
  }

  return { path: relPath, base, repaired: false, unresolved: true };
}

/** How a name resolves, in the three terms `resolvesAlike` compares. For failure messages. */
export function describeResolution(relPath: string): string {
  return `language=${languageFor(relPath)}, comments=${syntaxFor(relPath)}, non-production=${isNonProductionPath(relPath)}`;
}
