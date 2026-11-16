/**
 * The structural (parse-tree) reading of a file — A SECOND EYE BESIDE LINE MATCHING, never a
 * replacement for it.
 *
 * Both readings run on every file. The line reading runs first and is untouched; this one may only
 * ADD candidates, at lines of the original file, and every way it can fail falls back to the line
 * reading and is counted. `engine.ts` holds the hook and states the guarantees it is written under;
 * `parse.ts` states what this module may not do; `grammars.ts` states why loading is prepared up
 * front rather than lazily on first encounter.
 *
 * This is the module's whole public surface. Nothing above it sees tree-sitter, a grammar, a wasm
 * file or a language name it did not ask for.
 */

export { prepareStructural, grammarReport, GRAMMAR_DIR, grammarFile } from "./grammars.js";
export { languageFor, GRAMMAR_NAMES, GRAMMARS_FOR } from "./languages.js";
export type { StructuralLanguage, GrammarName } from "./languages.js";
export {
  parseForStructure,
  refuseForPartialSource,
  newCounters,
  MAX_STRUCTURAL_BYTES,
  STRUCTURAL_ALLOWANCE_MS,
  structuralAllowanceMs,
  type ParseOutcome,
  type ParseResult,
  type StructuralCounters,
} from "./parse.js";
export {
  CHECK_SETS,
  CHECK_SET_NAMES,
  isCheckSet,
  runCheckSets,
  type StructuralCheckSet,
  type StructuralFinding,
} from "./checks/registry.js";
export type { IrNode, IrElement, IrText, IrExpr, IrAttr } from "./ir.js";
