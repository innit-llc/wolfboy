/**
 * THE `yaml` PACKAGE'S DUPLICATE-KEY TEST, ASKED IN LINEAR TIME.
 *
 * WHY. `parseAllDocuments` tests every key it adds to a mapping against every key already in it
 * (`mapIncludes` in `dist/compose/util-map-includes.js` of yaml 2.9.0, on by default as
 * `uniqueKeys: true`), so a mapping of n keys costs n * n / 2 comparisons. Measured alone on one
 * 998,001-byte file of 166,000 distinct keys and one alias: the `yaml-anchors` gate view took 235 s
 * and the data summary 219 s, inside one call the per-file clock cannot reach. The package offers no
 * time-out and no progress callback, and its option for the test is the cause, so the test is turned
 * off in the parse (`uniqueKeys: false`) and asked here instead, once per mapping, with a set.
 *
 * THE SAME ANSWER, NOT A NEW ONE. The package calls two keys equal when `a === b`, or when both are
 * scalars and `a.value === b.value`, and reports `DUPLICATE_KEY` into `doc.errors` without changing
 * what it composes; both callers read any error as "this document is not used". So the question
 * both callers need is only whether SOME mapping of the document holds two such keys, and that is
 * what `hasDuplicateKey` answers. A set compares by SameValueZero, which differs from `===` in one
 * value only, NaN, so NaN is never entered: under `===` two NaN keys are not equal. A merge key read
 * with `merge: true` is a scalar holding a new `Symbol` each time, so two of them are not equal
 * under either test, as before.
 */
import { isScalar, visit } from "yaml";

export function hasDuplicateKey(doc: Parameters<typeof visit>[0]): boolean {
  let duplicate = false;
  visit(doc, {
    Map(_, map) {
      const nodes = new Set<unknown>();
      const values = new Set<unknown>();
      for (const pair of map.items) {
        const key = pair.key;
        if (nodes.has(key)) duplicate = true;
        nodes.add(key);
        if (isScalar(key)) {
          const v = key.value;
          // NaN is the one value `===` never finds equal to itself; a set would.
          if (v !== v) continue;
          if (values.has(v)) duplicate = true;
          values.add(v);
        }
        if (duplicate) return visit.BREAK;
      }
      return undefined;
    },
  });
  return duplicate;
}
