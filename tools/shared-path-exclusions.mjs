#!/usr/bin/env node
/**
 * Reading `rules/path-exclusions/` — the one place every authoring-side tool loads shared path
 * exclusion sets.
 *
 * ## What a shared exclusion set is, and why it is not a rule's `path_without`
 *
 * `detector.path_without` puts a rule's path exclusions in one place WITHIN THAT RULE. A clause that
 * SEVERAL rules must agree on is a different problem, and the field did not solve it. Measured
 * 2026-08-27 over the 63 shipped rules: 32 rules carry 169 clauses between them, and 98 of those are
 * a clause some other rule also spells byte for byte — `\.(?:test|spec|stories|cy)\.[cm]?[jt]sx?$`
 * in fourteen separate `rule.yaml` files, the standard test-directory clause in twelve, the
 * fixtures/mocks clause in twelve, the vendored-code clause in thirteen. That is the second copy
 * the project's rules forbid by name, and the copies had already drifted before anything held them side by
 * side. A shared set is authored once under `rules/path-exclusions/` and named by each rule in
 * `detector.shared_path_exclusions`.
 *
 * ## Why the loading lives HERE and the merging does not
 *
 * The merge — what a named set contributes, how `includes` resolves, and what happens when one
 * clause arrives twice — is `mergeSharedPathExclusions` in
 * `product/packages/cli/src/path-exclusions.ts`, beside the engine's own assertion that the merge
 * happened, and it is IMPORTED from the CLI's compiled output by everything that needs it. That is
 * the same decision `tools/shared-vocabulary.mjs` already made and wrote down for
 * `mergeSharedVocabulary`, for the same reason: re-deriving the merge in a second place would be a
 * copy that agrees on the day it is written.
 *
 * What is left over is reading the files and validating their shape, which is a build-time concern
 * the shipped scanner has no use for: a user's machine has a bundle and no authoring tree.
 *
 * ## Every way this fails, and it fails loudly in all of them
 *
 * - A file that does not parse as YAML. Skipping it would leave every set it declared "not
 *   declared", and the rules naming them would fail one step later blaming the wrong file.
 * - A file that does not satisfy `path-exclusions.schema.json` — a set with no question, a pattern
 *   with no `excludes` prose, an unknown field.
 * - A PATTERN THAT DOES NOT COMPILE. It reaches `new RegExp` inside `engine.ts` `compile()` and
 *   throws at SCAN time, on a user's machine, with no set name in the message. Compiled here
 *   instead, on the same reasoning `tools/lint-patterns.mjs` gives for a rule's own patterns.
 * - TWO FILES DECLARING ONE SET NAME. Which one a rule got would otherwise depend on the order
 *   `readdirSync` returned, which is not a decision anybody made.
 * - A name a rule imports that no file declares (`mergeSharedPathExclusions`).
 * - A name a rule imports whose clause it ALSO writes inline (`mergeSharedPathExclusions`) — no
 *   precedence, in either direction, for the reasons written there.
 *
 * A MISSING DIRECTORY IS NOT AN ERROR: it means no shared sets exist, which is the state this
 * mechanism was introduced into. Every import then fails by name, which is the loud half of the
 * same fact.
 */
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { CJK_PATTERN, stringLeaves } from "./lint-patterns.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * THE RULES DIRECTORY AND THE PATH-EXCLUSION DIRECTORY MOVE TOGETHER, BY CONSTRUCTION.
 *
 * Identical in shape and reasoning to `deriveVocabularyDir` in tools/shared-vocabulary.mjs, and
 * written separately rather than generalised because the two answer to different environment
 * variables and a shared helper would have to be told which — at which point the caller is naming
 * the directory again. The defect it forecloses is the one recorded there: a harness that redirects
 * `RULES_DIR` to a snapshot and silently resolves that snapshot's imports against the WORKING
 * TREE's sets, which is the same input on both sides of a comparison that exists to find a
 * difference.
 *
 * `PATH_EXCLUSIONS_DIR` stays an explicit override, with precedence over the derivation, for the
 * one case the derivation cannot serve: a harness whose `RULES_DIR` is a copy of REAL rules and
 * which therefore wants the REAL sets.
 */
export function derivePathExclusionsDir(env = process.env) {
  if (env.PATH_EXCLUSIONS_DIR) return resolve(env.PATH_EXCLUSIONS_DIR);
  if (env.RULES_DIR) return join(dirname(resolve(env.RULES_DIR)), "path-exclusions");
  return join(ROOT, "rules", "path-exclusions");
}

/** Where shared exclusion sets live for this process. See `derivePathExclusionsDir`. */
export const PATH_EXCLUSIONS_DIR = derivePathExclusionsDir();

const PATH_EXCLUSIONS_SCHEMA_PATH = join(
  ROOT,
  "product/packages/schemas/schemas/path-exclusions.schema.json",
);

/**
 * Every shared exclusion set on disk, keyed by the name a rule imports it under.
 *
 * Returns `{ sets, errors, files }`. `errors` is a list of messages and is never thrown from:
 * `tools/build-bundle.mjs` collects errors from a dozen checks and reports them together so an
 * author fixes a tree in one pass, and a loader that threw would report the first one alone.
 * A caller with no error list of its own uses `loadSharedPathExclusionsOrThrow`.
 */
export function loadSharedPathExclusions(dir = PATH_EXCLUSIONS_DIR) {
  // NOT `{}`, for the reason `loadSharedVocabulary` gives at length: a set name is authored text,
  // `__proto__` matches `propertyNames` here as it does there, and on a plain object assigning it
  // invokes Object.prototype's setter instead of creating an own property — readable in memory,
  // invisible to JSON.stringify, green build and a broken artefact.
  const sets = Object.create(null);
  const errors = [];
  const files = [];
  // Which FILE each set was declared in. Returned because a set's file is what says which question
  // it answers — every file here declares exactly one — and the scan's read-scope classes are those
  // questions (`READ_SCOPE_CLASSES` below). Built from the same loop that populates `sets`, so the
  // two cannot disagree; `declaredIn` below already had the value and threw it away.
  const setFiles = Object.create(null);
  if (!existsSync(dir)) return { sets, errors, files, setFiles };

  let validate;
  try {
    const ajv = addFormats(new Ajv2020({ allErrors: true, strict: false }));
    validate = ajv.compile(JSON.parse(readFileSync(PATH_EXCLUSIONS_SCHEMA_PATH, "utf8")));
  } catch (e) {
    errors.push(
      `the shared path-exclusion schema could not be read from ${PATH_EXCLUSIONS_SCHEMA_PATH}: ` +
        `${String(e.message).split("\n")[0]}. No set is loaded without it — an unvalidated set is ` +
        `how a pattern with no account of what it removes from the scan reaches a rule`,
    );
    return { sets, errors, files };
  }

  // Sorted so the run is reproducible and a collision message names the same two files every time.
  const declaredIn = new Map();
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
    const path = join(dir, file);
    files.push(path);
    let doc;
    try {
      doc = parseYaml(readFileSync(path, "utf8"));
    } catch (e) {
      errors.push(`path-exclusions/${file}: YAML parse error: ${e.message}`);
      continue;
    }
    if (!validate(doc)) {
      for (const err of validate.errors ?? []) {
        errors.push(`path-exclusions/${file}: ${err.instancePath || "/"} ${err.message}`);
      }
      continue;
    }
    // Field-scoped CJK lint, the same discipline the vocabulary loader applies. NOTHING is
    // exempt here, and that is the difference from `anchors` there: an anchor may legitimately spell
    // a non-English token, while a path exclusion's pattern is a path shape and its prose is prose.
    for (const [leaf, text] of stringLeaves(doc)) {
      const chars = [...new Set(text.match(CJK_PATTERN) ?? [])];
      if (chars.length === 0) continue;
      errors.push(
        `path-exclusions/${file}: field ${leaf} contains CJK characters (${chars.slice(0, 12).join("")}) — ` +
          `a shared set's prose and patterns are English (the project's English-first rule)`,
      );
    }
    for (const [name, set] of Object.entries(doc.sets)) {
      // Compiled HERE, not left to the engine. A source that does not compile throws out of
      // `new RegExp` in engine.ts on a user's machine, in a message that names neither the set nor
      // the file — and every rule that named the set is dead at once, not just the one being read.
      for (const [index, entry] of (set.patterns ?? []).entries()) {
        try {
          new RegExp(entry.pattern);
        } catch (e) {
          errors.push(
            `path-exclusions/${file}: set "${name}" pattern [${index}] does not compile: ` +
              `${String(e.message).split("\n")[0]} (${JSON.stringify(entry.pattern)})`,
          );
        }
      }
      const first = declaredIn.get(name);
      if (first !== undefined) {
        errors.push(
          `path-exclusions/${file}: declares the set "${name}", which path-exclusions/${first} ` +
            `already declares. One set has one home: which of the two a rule imported would ` +
            `otherwise depend on the order the directory was read in`,
        );
        continue;
      }
      declaredIn.set(name, file);
      sets[name] = set;
      setFiles[name] = file;
    }
  }
  return { sets, errors, files, setFiles };
}

/**
 * The scan-level READ SCOPE: which file of this directory is which class of thing a scan may be told
 * not to read, and the name a user types for it.
 *
 * WHY THE UNIT IS A FILE. Every file here declares ONE question in its own header — "does this file
 * exist in order to exercise the product", "is this somebody else's code, copied into this tree",
 * "was this file written by a tool rather than by a person" — and a set is one spelling of that
 * question. A class is therefore the file, and its patterns are the union of every set the file
 * declares. Taking a subset instead would mean the global default covered some spellings of the
 * question and not others, and every rule that names an uncovered set would have to keep it: the
 * per-rule copies this directory exists to remove would survive in the awkward half.
 *
 * `documents.yaml` is deliberately NOT a class. Prose, translation catalogues and interface
 * descriptions are not one of the three things the decision of 2026-09-10 names, and which
 * rule reads a changelog stays a per-rule question — the header of `documents.yaml` says why.
 *
 * The user-facing wording for each class lives in `product/packages/cli/src/read-scope.ts`, keyed by
 * the id below; the patterns live in the YAML. Neither is a copy of the other, and
 * a test asserts that every class the build emits has wording in the engine.
 */
export const READ_SCOPE_CLASSES = {
  tests: "test-surfaces.yaml",
  vendored: "vendored-code.yaml",
  build: "generated-output.yaml",
};

/**
 * The file whose sets are carried into the bundle to be COUNTED and never to be declined.
 *
 * `documents.yaml` asks one question — "is the text in this file prose, a translation catalogue or
 * an interface description, rather than a statement the product executes?" — and the note above says
 * why the decision of 2026-09-10 does not make it a read-scope class. The orientation sheet
 * (unit C, 2026-09-17) needs to be able to say that a tree's 412 translation catalogues are
 * translation catalogues, which is the same patterns answering a different question: not "should the
 * scan decline this file" but "what kind of path is this". So the build writes those sets under
 * `informational_classes`, a key `readScopeFor` does not read, and the unit there is the SET rather
 * than the file — `documents.yaml` declares seven of them, and "prose" and "translation catalogue"
 * are two answers a reader wants kept apart.
 *
 * Nothing is copied: the patterns and the `question` sentence are the YAML's own, resolved through
 * the same `pathExclusionClauses` a rule's import goes through.
 */
export const INFORMATIONAL_PATH_CLASS_FILE = "documents.yaml";

/** `loadSharedPathExclusions` for callers with no error list of their own: the first problem throws. */
export function loadSharedPathExclusionsOrThrow(dir = PATH_EXCLUSIONS_DIR) {
  const { sets, errors } = loadSharedPathExclusions(dir);
  if (errors.length > 0) {
    throw new Error(`shared path exclusions could not be loaded:\n  ${errors.join("\n  ")}`);
  }
  return sets;
}

/**
 * One rule's EFFECTIVE path exclusions: the sets it imports, then the clauses it writes itself.
 *
 * The merge itself is the engine-side `mergeSharedPathExclusions`, handed in by the caller from
 * `product/packages/cli/dist/path-exclusions.js`, so the clauses a tool reasons about are the
 * clauses the build merges — see the header for why it is not reimplemented here.
 */
export function effectivePathExclusions(detector, sets, where, mergeSharedPathExclusions) {
  return mergeSharedPathExclusions(
    detector?.path_without,
    detector?.shared_path_exclusions,
    sets ?? {},
    where,
  );
}
