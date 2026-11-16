/**
 * A value inside a line, with its control characters as escapes. This module
 * imports nothing: a module the hook loads at its start (state-record.ts, launch-list-file.ts) names a path through it,
 * while the hook loads printed-output.ts (the redaction) only at its first write, so that a dist missing that module, or
 * one whose redaction throws, still ends a refused call in its deny with the words withheld (hook-entry.ts).
 * printed-output.ts re-exports `valueText`, so every other importer is unchanged.
 */

/** Every control character a value may not carry raw inside a line: the line break and the tab too. */
const VALUE_CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/** One control character as its escape: `\n`, `\r`, `\t`, else `\uXXXX`. */
export const controlEscape = (c: string): string => (c === "\n" ? "\\n" : c === "\r" ? "\\r" : c === "\t" ? "\\t" : `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

/**
 * One value inside a line (a path, a key, a line of the repository), with every control character written as an escape,
 * its line breaks and tabs included, so that it cannot start a line of its own (GitHub Actions reads a log line starting
 * with `::` as a workflow command). The printed form is applied again at the write.
 */
export function valueText(s: string): string {
  return s.replace(VALUE_CONTROLS, controlEscape);
}
