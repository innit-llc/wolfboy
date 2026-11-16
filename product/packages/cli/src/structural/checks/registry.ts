/**
 * The named structural check sets a rule may declare in `detector.structural_checks`.
 *
 * A rule names a CHECK SET rather than setting a boolean, for the same reason `gate_view` names a
 * view: the rule has to say WHICH structural reading it wants, so a second rule adopting a different
 * set is a new entry here and not a new field. A name that is not in this registry is a hard error
 * at compile time, never a silent no-op — a rule that believes it is being read a second way and is
 * not is precisely the silent reduction this design exists to prevent.
 */

import type { IrNode } from "../ir.js";
import type { Vocabulary } from "../../vocabulary.js";
import { accessibilityElementsV1, REQUIRED_VOCABULARY, type StructuralFinding } from "./accessibility-elements-v1.js";

export type { StructuralFinding };

export type StructuralCheckSet = "accessibility-elements-v1";

interface CheckSet {
  /** The `detector.vocabulary` lists this set reads. Missing one is a compile-time error. */
  requires: readonly string[];
  run: (nodes: IrNode[], vocab: Vocabulary | undefined, where: string) => StructuralFinding[];
}

export const CHECK_SETS: Record<StructuralCheckSet, CheckSet> = {
  "accessibility-elements-v1": { requires: REQUIRED_VOCABULARY, run: accessibilityElementsV1 },
};

/**
 * The registry's names, exported so that the enum in `rule.schema.json` can be checked against them
 * rather than maintained beside them. JSON Schema cannot import from TypeScript, so the two lists
 * exist in two files; `tools/build-bundle.mjs` imports this array from the CLI's compiled output and
 * fails the build if the enum and this registry are not the same set, in either direction.
 */
export const CHECK_SET_NAMES = Object.keys(CHECK_SETS) as StructuralCheckSet[];

export function isCheckSet(name: string): name is StructuralCheckSet {
  return Object.prototype.hasOwnProperty.call(CHECK_SETS, name);
}

/** Run every named set over one file's IR, in the order the rule declared them. */
export function runCheckSets(
  names: StructuralCheckSet[],
  nodes: IrNode[],
  vocab: Vocabulary | undefined,
  where: string,
): StructuralFinding[] {
  const out: StructuralFinding[] = [];
  for (const name of names) out.push(...CHECK_SETS[name].run(nodes, vocab, where));
  return out;
}
