/**
 * THE TEST-ONLY SEAMS, AND THE ONE VARIABLE THAT ARMS THEM.
 *
 * Two gates need the engine to do something no ordinary run does — hand the workers their chunks in
 * a permuted order (`jobs-shuffle`), and run with every tree-sitter grammar unavailable
 * (`no-grammars`) — and both gates drive the BUILT CLI as a subprocess, so neither can be handed a
 * function the way `PrefilterLiteralOverrideForTest` is. They have to be readable from the
 * environment.
 *
 * ONE VARIABLE, A LIST OF NAMES. `PRODUCT_CLI_TEST_SEAM` holds a comma-separated set of seam names
 * (`PRODUCT_CLI_TEST_SEAM=jobs-shuffle,no-grammars`), so a gate that needs two of them arms both
 * without a second variable, and a reader of a shell line sees every seam that is on in one place.
 * A single name is still exactly what it was, which is why nothing that set `jobs-shuffle` had to
 * change. An unknown name arms nothing: each seam is asked for BY NAME below, so a typo is a seam
 * that is off rather than a seam that is on.
 *
 * WHAT A SEAM MAY AND MAY NOT DO. A seam may change only what the engine ALREADY REPORTS HONESTLY
 * ABOUT ITSELF — how the work is divided, or which capability the process admits to having — and it
 * may never change a rule, a pattern or a threshold. `jobs-shuffle` permutes dispatch, which the
 * output is independent of and which the gates assert. `no-grammars` produces exactly the state a
 * machine with no vendored grammars is already in, which the engine reports as
 * `structural_grammars_unavailable` in the document and on the first screen of the summary.
 *
 * THE TWO ARE NOT THE SAME STRENGTH, and an earlier version of this comment said they were — it
 * claimed a seam may never change "anything a finding is built from", which `no-grammars` can:
 * the shipped bundle has a rule declaring `structural_checks`, and with the seam armed no structural
 * candidate can be raised, exactly as on a machine with no grammars (independent verification note
 * F2, 2026-09-16; on the tree used there the count happened to be unchanged, which was luck and not
 * a property). The rule is the sentence above: the CAPABILITY may change and be reported; the
 * detector may not.
 */

/** Every seam name this build understands. Adding one here is the whole registration. */
export type TestSeam = "jobs-shuffle" | "no-grammars";

/** Is this seam named in `PRODUCT_CLI_TEST_SEAM`? Read at the point of use, never cached. */
export function testSeamArmed(name: TestSeam): boolean {
  const raw = process.env.PRODUCT_CLI_TEST_SEAM;
  if (raw === undefined || raw === "") return false;
  return raw
    .split(",")
    .map((s) => s.trim())
    .includes(name);
}
