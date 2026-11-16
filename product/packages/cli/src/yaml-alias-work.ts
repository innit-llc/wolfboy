/**
 * THE `yaml` PACKAGE'S ALIAS WORK, BOUNDED BEFORE THE PACKAGE IS ASKED TO DO IT.
 *
 * WHY. `yamlAnchorView` (derive.ts) hands each document that holds an alias to the package's
 * `toJS` and renders the result with `stringify`. Neither offers a time-out or a progress callback,
 * and the per-file clock cannot reach inside them. Measured,
 * five shapes held that one call
 * for seconds to hours, on inputs from 365 bytes to 1 MB, each through a different path of yaml
 * 2.9.0 that is not linear in the input:
 *   - a document whose anchor holds an alias to itself (`--- &a [*a]`): `toJS` returns a cyclic
 *     value and `stringify` recurses until the stack overflows, about 10 ms a document, so 1 MB of
 *     such documents took about eight minutes;
 *   - many anchors and aliases in one document: `Alias.resolve` scans every anchor and alias before
 *     the one it resolves (`dist/nodes/Alias.js`), quadratic in their number;
 *   - an anchored collection holding many aliases, then aliased: the package's alias count
 *     (`getAliasCount`) resolves every alias inside it against the whole document again, with no
 *     cache, quadratic again;
 *   - aliases of EMPTY collections: their alias count is 0, so the package's own billion-laughs
 *     protection (`maxAliasCount`, count times alias count) never fires, and `stringify` expands
 *     every copy (`aliasDuplicateObjects: false`): six levels of ten in 365 bytes took 7.8 s and
 *     400 MB, and each further level multiplies both by ten;
 *   - merge keys: `<<: *x` re-renders `x` on every merge (`dist/schema/yaml-1.1/merge.js`,
 *     `source.toJSON`) without passing through the alias count at all, so `<<: [*a, *a]` chained
 *     doubles the work per level: eighteen levels in 634 bytes took 0.8 s, and each level adds
 *     two thirds.
 *
 * ONE PASS, BEFORE THE PACKAGE, THAT MAKES EVERY ONE OF THEM BOUNDED. `prepareAliases` walks the
 * parsed document once, iteratively (a deep document does not overflow it), in the order the
 * package's own `visit` takes, and:
 *   1. resolves every alias to the node the package's `Alias.resolve` would return - the LAST
 *      anchored scalar or collection with that name before the alias in that order - and gives the
 *      alias node that answer as its own `resolve`, so each later resolution by `toJS`, by the alias
 *      count or by a merge is one lookup instead of a scan. The answer is the package's, not a new
 *      one; only its cost changes. A version of the package that stopped calling `resolve` would
 *      ignore the property and resolve the old way, slowly but with the same answer;
 *   2. answers a document whose alias refers to one of its own ancestors as RECURSIVE. The view
 *      already read such a document as not used (`stringify` threw on the cycle and the error was
 *      caught); the answer is the same and comes before the work instead of after it. An alias can
 *      only refer to an anchor before it, so any cycle passes through such an alias;
 *   3. counts the EXPANDED SIZE: the nodes (scalars, collections, pairs) of the document with every
 *      alias and merge replaced by what it refers to. It is an upper bound on what `toJS` builds,
 *      merges included, on what the alias count walks, and on what `stringify` renders, so with the
 *      resolutions of step 1 the package's whole work on the document is linear in its own size
 *      plus this count. The count stops once it passes the ceiling it is given, so the pass itself
 *      stays linear however large the expansion would be.
 *
 * THE CEILING (`MAX_YAML_EXPANDED_NODES`) is a work count, so a file gets the same answer on every
 * machine. One million nodes is twice the most a 1 MB input can hold with no alias at all (a flow
 * sequence of one-character items, about 500,000), so no file is refused for its own size, only for
 * an expansion beyond it. Past the ceiling the view answers `too-large`, exactly as for an input
 * over `MAX_YAML_INPUT_BYTES` or an output over `MAX_YAML_OUTPUT_BYTES`: the gate reads the file's
 * own unexpanded text, and the refusal is counted in `stats.derived_views_failed`.
 */
import { isAlias, isCollection, isPair, isScalar } from "yaml";

export const MAX_YAML_EXPANDED_NODES = 1_000_000;

export type AliasWork = { recursive: true } | { recursive: false; expanded: number };

/** The node the package's `Alias.resolve` returns, as the alias's own `resolve`, with the package's one other check. */
function answerAs(alias: object, source: unknown): void {
  Object.defineProperty(alias, "resolve", {
    configurable: true,
    enumerable: false,
    writable: true,
    value(_doc: unknown, ctx?: { maxAliasCount?: number }) {
      if (ctx?.maxAliasCount === 0) throw new ReferenceError("Alias resolution is disabled");
      return source;
    },
  });
}

function childrenOf(node: unknown): readonly unknown[] {
  if (isCollection(node)) return node.items;
  if (isPair(node)) return [node.key, node.value];
  return [];
}

/**
 * Resolves every alias of `contents` once (step 1), and answers whether one refers to its own
 * ancestor (step 2) or else the expanded size (step 3), counted up to `ceiling + 1`.
 */
export function prepareAliases(contents: unknown, ceiling: number): AliasWork {
  const cap = ceiling + 1;
  const lastAnchor = new Map<string, object>();
  const open = new Set<object>();
  const size = new Map<object, number>();
  const sizeOf = (n: unknown): number => (n !== null && typeof n === "object" ? (size.get(n) ?? 0) : 0);
  // Each entry is a node and whether it is being left (its children are done) or entered.
  const stack: Array<[unknown, boolean]> = [[contents, false]];
  while (stack.length > 0) {
    const [node, leaving] = stack.pop() as [unknown, boolean];
    if (node === null || typeof node !== "object") continue;
    if (leaving) {
      let n = 1;
      for (const child of childrenOf(node)) {
        n += sizeOf(child);
        if (n >= cap) {
          n = cap;
          break;
        }
      }
      size.set(node, n);
      open.delete(node);
      continue;
    }
    if (isAlias(node)) {
      const source = lastAnchor.get(node.source);
      if (source !== undefined && open.has(source)) return { recursive: true };
      answerAs(node, source);
      // The source is not an ancestor and comes before the alias, so it has been left already.
      size.set(node, source === undefined ? 1 : Math.min(cap, sizeOf(source)));
      continue;
    }
    if ((isScalar(node) || isCollection(node)) && typeof node.anchor === "string" && node.anchor !== "") {
      lastAnchor.set(node.anchor, node);
    }
    if (isScalar(node)) {
      size.set(node, 1);
      continue;
    }
    open.add(node);
    stack.push([node, true]);
    const children = childrenOf(node);
    for (let i = children.length - 1; i >= 0; i--) stack.push([children[i], false]);
  }
  return { recursive: false, expanded: sizeOf(contents) };
}
