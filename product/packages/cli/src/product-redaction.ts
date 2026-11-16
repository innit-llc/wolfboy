/**
 * THE PRODUCT'S OWN CREDENTIAL PATTERNS, COMPILED ONCE. Every redaction the CLI does
 * compiles `PRODUCT_CREDENTIAL_RULE`, the copy of `baseline-002` the CLI carries (credential-rule.generated.ts, exported
 * from the rule by tools/credential-rule-copy.mjs and held to it by the bundle build). Before, every redaction took the
 * rule from the LOADED bundle, which `--bundle` or `LEGAL_BUNDLE_DIR` chooses: a bundle without `baseline-002` turned the
 * redaction of findings.json, the report and the exports off without a word. Nothing here reads a bundle, so nothing a
 * bundle holds can change what is redacted. The bundle's own `baseline-002` still DETECTS (it is a rule like any
 * other); it no longer redacts.
 *
 * WHY A MODULE OF ITS OWN. The judging
 * closure (census.ts, rests-on.ts, place-premises.ts) takes ids and digests over the value-free line, which needs the
 * printed redaction; taking it from engine.ts brought the engine's whole tree into the closure that moves the verdict
 * rules' version. This module imports the credential copy and the redaction and nothing else, and it is the one place
 * the copy is compiled: engine.ts (the scan's labels, the report) and printed-output.ts (the terminal) import it too.
 *
 * THE COMPILE. Each clause with `new RegExp` and no flags, which is what `compileRules` (engine.ts) does to a rule that
 * declares no word lists (`test:line-text-redaction` holds the two compiles equal). A copy that declared word lists, or
 * spliced one, would need the engine's expansion: it is refused here rather than compiled to something else.
 */
import {
  compileCredentialRedaction,
  compilePrintedRedaction,
  type CredentialRedaction,
  type PrintedRedaction,
} from "./credential-redaction.js";
import { PRODUCT_CREDENTIAL_RULE } from "./credential-rule.generated.js";

/** The copy's clauses as fresh RegExp objects (each redaction holds its own). */
export function productCredentialClauses(): RegExp[] {
  const detector = PRODUCT_CREDENTIAL_RULE.detector as unknown as Record<string, unknown>;
  const words = ["vocabulary", "shared_vocabulary", "vocabulary_matching"].filter((k) => detector[k] !== undefined);
  const match = (detector.match ?? []) as string[];
  if (detector.engine !== "builtin-regex" || words.length > 0 || match.some((p) => p.includes("(?&"))) {
    throw new Error(
      `the CLI's copy of ${PRODUCT_CREDENTIAL_RULE.id} is not a plain regular-expression rule (engine ${String(detector.engine)}${words.length > 0 ? `, word lists ${words.join(", ")}` : ""}): it cannot be compiled without the engine`,
    );
  }
  return match.map((p) => new RegExp(p));
}

let credentialsCache: CredentialRedaction | undefined;
let printedCache: PrintedRedaction | undefined;
/** The redacting clauses for labels and evidence values (findings.json, reconcile-input.json). */
export function productCredentials(): CredentialRedaction {
  credentialsCache ??= compileCredentialRedaction(productCredentialClauses());
  return credentialsCache;
}
/** The redaction of printed text: the report, the evidence log, the exports, the progress stream, the terminal. */
export function productPrintedRedaction(): PrintedRedaction {
  printedCache ??= compilePrintedRedaction(productCredentialClauses());
  return printedCache;
}
