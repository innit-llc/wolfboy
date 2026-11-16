/**
 * One JSON Schema check, shared by every command in this CLI that has one.
 *
 * ## Why this file exists rather than a second validator
 *
 * `questionnaire.ts` grew the first runtime schema check on 2026-09-01 (W8): an answers document is
 * written by an agent, which is exactly the input runtime validation is for, and until then every
 * lane rule the schema carried was advisory at run time. W5 needs the same thing for a ScanProfile
 * on 2026-09-02, at two more load sites. Writing a second loader would be the defect the project's rules name
 * outright — two copies of something that must agree — so the loader, the degrade disclosure and the
 * violation record live here once, and `validateAnswersDocument` and `loadScanProfile` are both
 * callers of it.
 *
 * ## `ran: false` is a state of its own and is never a pass
 *
 * A machine that cannot load the validator still runs the tool. What it does not get is silence:
 * every caller carries `unavailable_reason` into what it writes and what it prints, and `ok` stays
 * `false`, so nothing anywhere can read "the check did not run" as "the document passed".
 *
 * ## Why the validator is loaded at call time, and why synchronously
 *
 * **At call time**, through `createRequire`, rather than as a static import. `ajv` and
 * `ajv-formats` are DECLARED in `product/packages/cli/package.json` since 2026-09-24 (relay unit
 * `capture`): `product/pnpm-lock.yaml` was regenerated with `pnpm install --lockfile-only` (49 added
 * lines, nothing else changed) and `pnpm install --frozen-lockfile --lockfile-only` exits 0 against
 * it. Until then they were deliberately undeclared, on the belief that the lockfile could not be
 * regenerated here. Inside this monorepo they still resolve from the root `node_modules` where the
 * CLI's own `node_modules` holds no link yet. The load stays inside `try` for the callers that
 * degrade with a `ran: false` disclosure; `capture` does not degrade: it refuses to write a record
 * whenever `ran` is false.
 *
 * **Synchronously**, where W8 used `await import(...)`: `runScan` is synchronous and two gate tools
 * consume it synchronously (two tools), so the profile
 * load site inside it cannot await anything — making `runScan` async would have those two read a
 * promise as a findings object and report nothing, which is the silent reduction this repository
 * builds against. `ajv` and `ajv-formats` are both CommonJS with no `exports` map, so `require`
 * resolves them by the same walk `import()` did and the degrade path is unchanged: a machine without
 * them throws inside the same `try` and gets the same `ran: false`. `validateAnswersDocument` keeps
 * its `async` signature so that not one of its callers changes.
 */

import { createRequire } from "node:module";
import { SCHEMA_TEXTS } from "./schemas.generated.js";

/**
 * One violation as the validator reported it, before any caller decides what to do about it.
 *
 * Kept beside the rendered `violations` strings rather than replacing them: a caller that only
 * prints wants the sentence, and a caller that has to act on the violating FIELD — which is what
 * W5's profile load does — needs the path and the keyword, and re-parsing them back out of a
 * sentence would be a second copy of the same fact.
 */
export interface SchemaViolation {
  /** JSON Pointer to the value the validator objected to. `""` is the document itself. */
  instancePath: string;
  /** Where in the schema the objection came from, for a reader who wants to look it up. */
  schemaPath: string;
  /** `type`, `pattern`, `enum`, `const`, `required`, `additionalProperties`, `minItems`, … */
  keyword: string;
  /** The validator's own words, e.g. `must be boolean`. */
  message: string;
  /** The keyword's parameters, e.g. `{ additionalProperty: "probe" }` or `{ type: "boolean" }`. */
  params: Record<string, unknown>;
}

/** What a schema check found, or why it did not run. */
export interface SchemaValidation {
  ran: boolean;
  ok: boolean;
  /** The first violation as `<instancePath> <message>`, empty when there is none. */
  first_violation: string;
  /** Every violation, for the record. */
  violations: string[];
  /** The same violations as the validator reported them, for a caller that must act per field. */
  errors: SchemaViolation[];
  /** Why the check did not run. Empty when it did, and never empty when it did not. */
  unavailable_reason: string;
}

/**
 * THE SCHEMAS ARE PART OF THIS PROGRAM'S COMPILED CODE. `schemas.generated.ts` holds the exact text of every
 * `product/packages/schemas/schemas/*.schema.json`, generated from those files (the one source) by
 * `scripts/schemas-module.mjs`, and the CLI's build and the bundle build fail while it differs from them.
 *
 * Why not a folder. From 2026-10-12 the schemas were read at run time from `schemas/` beside `dist/`, which
 * only `scripts/copy-schemas.mjs` wrote as the last step of `npm run build`, and later from the workspace's
 * `product/packages/schemas/schemas` where that copy was absent. Anything that built the CLI any other way (`tsc -b`
 * alone) or copied its `dist/` elsewhere got a program that refused every scan with a profile, and it broke seven times:
 * four gates and two test drivers on 2026-10-12, the rule-diff sweep's private copy of the CLI on 2026-10-13. Compiled
 * in, the schemas travel with every build and every copy of `dist/`, and nothing is looked up.
 */

/** The names of the schemas this program carries, sorted (`findings.schema.json`, ...). */
export const SCHEMA_NAMES: readonly string[] = Object.keys(SCHEMA_TEXTS).sort();

/**
 * A schema's exact text, as its file holds it. Throws, naming the schema, where this program carries none of that name:
 * a programming error (a name the schemas package does not have), never a state of the installation.
 */
export function schemaText(schemaFile: string): string {
  if (!Object.prototype.hasOwnProperty.call(SCHEMA_TEXTS, schemaFile)) {
    throw new Error(`this program carries no schema named ${JSON.stringify(schemaFile)} (it carries ${SCHEMA_NAMES.join(", ")})`);
  }
  return SCHEMA_TEXTS[schemaFile]!;
}

/** A schema parsed: a fresh object on every call, so no caller can change what another one reads. */
export function schemaDocument(schemaFile: string): unknown {
  return JSON.parse(schemaText(schemaFile));
}

/**
 * Validate a document against one of the schemas this program carries (`SCHEMA_NAMES`).
 *
 * `register` names further schema files to add to the instance first, for the cross-file `$ref`s
 * that `declarations.schema.json`'s own `$comment` requires of every loader. A schema with no
 * cross-file `$ref` — `scan-profile.schema.json` is one, measured 2026-09-02 — passes none.
 */
export function validateAgainstSchema(
  schemaFile: string,
  document: unknown,
  options: { register?: string[] } = {},
): SchemaValidation {
  const compiled = compileSchemaValidator(schemaFile, options);
  return compiled(document);
}

/**
 * The same check, compiled ONCE and applied many times — for a caller with a list of documents.
 *
 * `verdict-verify` validates every adjudicator record of a run against `verdict.schema.json`, and a
 * run holds hundreds of them; compiling the schema per record would pay ajv's compile for each. The
 * loader, the degrade disclosure and the violation record are the ones above and not a second copy:
 * `validateAgainstSchema` is now one call of this, so a defect fixed in either is fixed in both.
 *
 * **A load failure is still not a pass.** Where the validator cannot be loaded, every call of the
 * returned function reports `ran: false` with the same `unavailable_reason`, exactly as the
 * single-document form does.
 */
export function compileSchemaValidator(
  schemaFile: string,
  options: { register?: string[] } = {},
): (document: unknown) => SchemaValidation {
  const unavailable = (reason: string): SchemaValidation => ({
    ran: false,
    ok: false,
    first_violation: "",
    violations: [],
    errors: [],
    unavailable_reason: reason,
  });

  let validate: ((d: unknown) => boolean) & {
    errors?: { instancePath?: string; schemaPath?: string; keyword?: string; message?: string; params?: unknown }[] | null;
  };
  try {
    const require = createRequire(import.meta.url);
    const { Ajv2020 } = require("ajv/dist/2020.js") as {
      Ajv2020: new (opts: Record<string, unknown>) => {
        addSchema: (s: unknown) => unknown;
        compile: (s: unknown) => ((d: unknown) => boolean) & {
          errors?: { instancePath?: string; schemaPath?: string; keyword?: string; message?: string; params?: unknown }[] | null;
        };
      };
    };
    const formatsModule = require("ajv-formats") as { default?: (a: unknown) => unknown } & ((a: unknown) => unknown);
    const addFormats = formatsModule.default ?? formatsModule;
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    for (const ref of options.register ?? []) {
      ajv.addSchema(schemaDocument(ref));
    }
    validate = ajv.compile(schemaDocument(schemaFile));
  } catch (e) {
    const reason = `the JSON Schema validator could not be loaded or the schema could not be compiled (${(e as Error).message}).`;
    return () => unavailable(reason);
  }

  return (document: unknown): SchemaValidation => {
    if (validate(document)) {
      return { ran: true, ok: true, first_violation: "", violations: [], errors: [], unavailable_reason: "" };
    }
    const raw = validate.errors ?? [];
    const errors: SchemaViolation[] = raw.map((e) => ({
      instancePath: e.instancePath ?? "",
      schemaPath: e.schemaPath ?? "",
      keyword: e.keyword ?? "",
      message: e.message ?? "is invalid",
      params: (e.params as Record<string, unknown>) ?? {},
    }));
    const violations = errors.map((e) => `${e.instancePath || "/"} ${e.message}`);
    return {
      ran: true,
      ok: false,
      first_violation: violations[0] ?? "/ is invalid",
      violations,
      errors,
      unavailable_reason: "",
    };
  };
}
