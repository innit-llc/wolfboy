#!/usr/bin/env node
/**
 * Validates the rule authoring YAML (rules/packs/<pack>/<rule-id>/rule.yaml) and the notice
 * checklists (rules/checklists/*.yaml), and compiles both into the distribution bundle
 * (dist/bundle/{manifest.json, rules.json, checklists.json}).
 *
 * Bundles are currently unsigned: the manifest says so with the explicit marker `signature: "unsigned"`
 * (since 2026-10-12; it was `null` before). Signing is not decided yet; until then,
 * integrity rests on the manifest hashes and the content digest every findings document carries.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  INJECTION_PATTERN,
  ASSERTION_PATTERN,
  cjkLeafHits,
  stringLeaves,
  foldWhitespace,
  lintRuleJoins,
  lintRulePatterns,
  resolveAlsoInFileReferences,
  unresolvedClauseReferenceMessage,
  lintRuleFileGlobs,
  lintWorkspacePaths,
  patternCompileSelfTest,
  BUNDLE_PROMISE_PATTERN,
  lintPersonFacingWords,
  personWordSelfTest,
  PERSON_WORD_PATHS,
  lintAbsenceClaims,
  ABSENCE_CLAIM_EXCEPTIONS,
  correctedWordingProblems,
  CORRECTED_WORDING_FILES,
  exportOnlyPath,
} from "./lint-patterns.mjs";
import {
  VOCABULARY_DIR,
  loadSharedVocabulary,
  effectiveVocabulary,
  effectiveVocabularyMatching,
  effectiveVocabularyKinds,
} from "./shared-vocabulary.mjs";
import {
  PATH_EXCLUSIONS_DIR,
  READ_SCOPE_CLASSES,
  INFORMATIONAL_PATH_CLASS_FILE,
  loadSharedPathExclusions,
  effectivePathExclusions,
} from "./shared-path-exclusions.mjs";
import { checkGateList, deriveGateList } from "./gate-list.mjs";
import { credentialCopyProblem } from "./credential-rule-copy.mjs";
// A `` citation in a rule, gate or checklist source cites the private record; it never reaches a bundle, so
// the bundle built here and the one built from the public form (which the projection writes without them) are the same.
import { stripShippedRecordMarkers } from "./record-marker.mjs";
import { schemasModuleProblem } from "../product/packages/cli/scripts/schemas-module.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
// Limb 1 of the workspace-path lint (does the named path exist in this tree?), the same answer in the workspace and in
// the exported tree: a path the export placed where the workspace holds nothing is absent (lint-patterns.mjs
// `exportOnlyPath`).
const existsInWorkspace = (named) => existsSync(join(ROOT, named)) && !exportOnlyPath(named);
// THE BUILT-CLI PRECONDITION (fix/rc-release-build, 2026-11-01). This file imports the CLI's compiled modules (the
// check-set registry, the pattern expander, path exclusions, globs, penalty tiers and the bundle's content digest, all
// from product/packages/cli/dist), so the CLI is built before the bundle. With no compiled CLI it used to run for about
// 90 s and then crash on the first of those imports that nothing caught (ERR_MODULE_NOT_FOUND .../dist/penalty-tier.js),
// so the remedy the guards below print never reached the person: the README's build failed that way on a fresh checkout. Now it stops at once, saying what to run.
// A dist/ that exists but is older than its sources is the stale-build guard's case, below.
if (!existsSync(join(ROOT, "product/packages/cli/dist/index.js"))) {
  console.error(
    "build-bundle: the CLI is not built (product/packages/cli/dist/index.js does not exist), and the bundle is built with " +
      "the CLI's own compiled code. Build the CLI first - `(cd product && pnpm install && pnpm -r build)`, the first " +
      "build command of the README - and then run this again.",
  );
  process.exit(1);
}
// Overridable so several authoring sessions can build and test their own rules concurrently
// without racing on one output directory. Defaults are unchanged.
const RULES_DIR = process.env.RULES_DIR ? resolve(process.env.RULES_DIR) : join(ROOT, "rules", "packs");
const CHECKLISTS_DIR = process.env.CHECKLISTS_DIR
  ? resolve(process.env.CHECKLISTS_DIR)
  : join(ROOT, "rules", "checklists");
const GATES_DIR = process.env.GATES_DIR ? resolve(process.env.GATES_DIR) : join(ROOT, "rules", "gates");
const OUT_DIR = process.env.BUNDLE_OUT ? resolve(process.env.BUNDLE_OUT) : join(ROOT, "dist", "bundle");
const SCHEMA_PATH = join(
  ROOT,
  "product/packages/schemas/schemas/rule.schema.json",
);
const CHECKLIST_SCHEMA_PATH = join(
  ROOT,
  "product/packages/schemas/schemas/checklist.schema.json",
);
// Overridable for one reason, stated so nobody has to guess it: THE $ref DRIFT GUARD IN THE GATE
// BLOCK IS OTHERWISE UNTESTABLE.
// It asserts that gate.schema.json still imports its body from checklist.schema.json
// rather than carrying a copy, and the only way to prove that assertion bites is to run a build
// against a schema whose $ref has been replaced by an inline copy. Without this override a test
// would have to edit the real file under product/, which this repository forbids a test from doing
// (a test, header). The default is the real schema and `npm run gates`
// never sets this.
const GATE_SCHEMA_PATH = process.env.GATE_SCHEMA
  ? resolve(process.env.GATE_SCHEMA)
  : join(ROOT, "product/packages/schemas/schemas/gate.schema.json");
// THE VERSION IS DERIVED, NOT TYPED (2026-10-12). Until then this line read
// `process.env.BUNDLE_VERSION ?? "2026.07.1"`, and nothing ever set the variable: the bundle went
// from 63 rules to 117 while every findings.json said 2026.07.1 (architecture review 2026-09-14,
// E2 and H F4). It is now derived from what the build wrote, after the files are hashed (see
// `deriveBundleVersion` below the manifest's file list). BUNDLE_VERSION still sets it explicitly,
// for a release that wants a label of its own; it must match the manifest schema's YYYY.MM.n.
const BUNDLE_VERSION_OVERRIDE = process.env.BUNDLE_VERSION ?? null;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const ruleSchemaDoc = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
const validate = ajv.compile(ruleSchemaDoc);

// checklist.schema.json is compiled at most ONCE and then reused, rather than compiled where it is
// needed, because gate.schema.json's `applicability` is a cross-file $ref into it: the reference
// resolves only when the target schema is registered in the SAME Ajv instance, which `compile`
// does by $id, and calling `compile` twice on one $id throws. Lazy because the checklist and gate
// directories are each allowed to be absent, and a schema that nothing needs must not be a
// precondition for building the rules.
let checklistSchemaDoc = null;
let validateChecklist = null;
function checklistSchema() {
  if (checklistSchemaDoc === null) {
    checklistSchemaDoc = JSON.parse(readFileSync(CHECKLIST_SCHEMA_PATH, "utf8"));
    validateChecklist = ajv.compile(checklistSchemaDoc);
  }
  return checklistSchemaDoc;
}

// The three prose lints live in tools/lint-patterns.mjs so that the rule build and the pillar-2
// prose lint cannot drift apart. Nothing about what they enforce changed when they moved.

// Rule assets ship in English, so CJK in a rule field fails the build. The exemptions are the ones the
// public self-scan uses, from one list (tools/lint-patterns.mjs, `cjkExemptFor`, `cjkLeafHits`): a rule's
// legal_basis[].cite carries a law's name in its official form, which for a JP or CN source is the original-script name,
// and its detector PATTERN leaves exist to match non-English source text. Those leaves are named one by one, not the
// `detector` subtree, which also holds prose (`cost_exempt[].reason`, `volume_exempt[].reason`). A file-level grep flags both exemptions, which is why it was rejected
// (verified 2026-07-22).
//
// Everything outside them is checked, mapping keys included - deny by default rather than an allowlist of today's prose
// fields - so a prose field added to the schema later is covered without anyone remembering to extend the list. A new
// pattern-like field would false-positive here; that failure is loud and cheap to fix, whereas an unlinted prose field
// is silent.

const rules = [];
const errors = [];
// Workspace-path hits inside fields the lint deliberately does not fail on — today, only a rule's
// `provenance`. Collected rather than discarded and PRINTED at the end of every build: an exemption
// nobody can count is the same hidden setting the lint exists to remove, one file up.
const exemptedWorkspacePaths = [];
// Hits of the person-facing word list (tools/lint-patterns.mjs, FORBIDDEN_TO_THE_PERSON) in text the
// lint does not hold to it: quoted provision text inside citation fields, prose no output copies to
// the person, and patterns and quotation fields. Collected for the same reason as the list above and
// PRINTED at the end of every build: an escape nobody can count is a silent allowlist.
const personWordTally = { quoted: [], notCopied: [], verbatim: [] };
function personWordMessage(where, p) {
  return (
    `${where}: field ${p.path} says "${p.word}" to the person (${p.excerpt}) — the product does not use this word in ` +
    `what it tells the person (FORBIDDEN_TO_THE_PERSON, tools/lint-patterns.mjs): say the same thing in other words, ` +
    `refer to the provision where the word is part of a statutory term, and keep quoted provision text inside quotation ` +
    `marks in a citation field`
  );
}
// THE ABSENCE-CLAIM LINT's exceptions that excused a line in this build, by their index in ABSENCE_CLAIM_EXCEPTIONS
// (tools/lint-patterns.mjs). Printed on every green build, and a row that excused nothing over the real rule tree fails it.
const absenceExceptionsUsed = new Map();
function absenceClaimMessage(where, p) {
  return (
    `${where}: ${p.field} "${p.line}" states that something is absent ("${p.phrase}"), which this repository alone cannot ` +
    `show (THE ABSENCE-CLAIM LINT, tools/lint-patterns.mjs): say what was checked - "not found", "no ... found", "named" ` +
    `or "to confirm" - or, where the phrase is true of what the rule itself reads, add a row with the reason to ` +
    `ABSENCE_CLAIM_EXCEPTIONS`
  );
}
const packCounts = new Map();
const packJurisdictions = new Map();

// THE GATE-LIST CHECK, added 2026-08-13 (work item #52, owner-approved). It runs before everything
// else in this file because it is the cheapest guard here — two text files, no build, no engine —
// and because what it checks is whether the DESCRIPTION of this run is true, which a reader needs
// before any other verdict in the run means anything.
//
// WHAT IT DOES: derives the ordered gate steps and the tools each one invokes from `scripts.gates`
// in package.json, and fails the build when the block in an internal record does not say
// the same thing. package.json is the only authoritative list; nothing here writes to the document.
//
// WHY IT IS IN THIS FILE RATHER THAN A SEVENTEENTH STEP: this file already carries two guards of
// exactly this class — the stale-build guard immediately below and the check-set drift guard after
// it — each of them a precondition about the run itself rather than a check of a rule, and each of
// them justified in its own comment by the same sentence. Adding a step to police the count of steps
// is also the one shape of fix that would have to change the number it is fixing.
//
// WHY IT EXISTS: the count in §11 went stale three times on 2026-08-13, and the correction block
// written that morning carried a sentence that was false by that afternoon. The block names its own
// cause — the count lived in a document that nothing verified. The reasoning, the format and the
// deliberately weak version kept as a negative control are all in tools/gate-list.mjs.
//
// A TREE WITH NO GATE CHAIN HAS NO GATE LIST TO AGREE WITH. The exported public tree
// (a tool) carries this file and a root package.json with no `scripts.gates` and no
// governance document, so the check is skipped there, and says so. It is skipped on that one
// condition only: a package.json that defines `scripts.gates` is this workspace, and a missing
// governance document is then a failure, as before.
// The document that carries the gate list is named by this workspace's own manifest, `config.gate_list_document`, so
// that this file names no document the public tree lacks (the exported manifest carries no `config`).
const rootManifest = (() => {
  try {
    return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  } catch {
    return null;
  }
})();
const rootScripts = rootManifest === null ? null : rootManifest.scripts ?? {};
const gateListDocument = rootManifest?.config?.gate_list_document;
if (rootScripts !== null && !Object.hasOwn(rootScripts, "gates")) {
  console.log("gate list: package.json defines no `gates` chain (an exported tree), so there is no gate list to check");
} else if (rootScripts === null) {
  errors.push(`${join(ROOT, "package.json")} is missing or unreadable, so the gate list cannot be derived`);
} else if (typeof gateListDocument !== "string" || gateListDocument === "") {
  errors.push("package.json defines a `gates` chain but names no `config.gate_list_document`, so the gate list has no document to be checked against");
} else {
  for (const e of checkGateList(join(ROOT, "package.json"), join(ROOT, gateListDocument))) {
    errors.push(e);
  }
}

// The number of steps `npm run gates` runs, derived rather than written down, so that the messages
// below cannot go stale the way §11's prose did. Falls back to a phrase rather than a wrong number
// if the derivation is unreadable, which the check above has already reported by then.
let gateStepCount = null;
try {
  gateStepCount = deriveGateList(readFileSync(join(ROOT, "package.json"), "utf8")).length;
} catch {
  gateStepCount = null;
}
const gateStepsPhrase = gateStepCount === null ? "its later" : `its ${gateStepCount}`;

// THE STALE-BUILD GUARD, added 2026-08-13 (work item #51). It runs before the check-set
// drift guard below, because that guard reads the engine's COMPILED registry and comparing against
// a stale one is exactly the silent not-running it exists to prevent.
//
// `npm run gates` NEVER COMPILES TYPESCRIPT. Read the script: it runs this file, which builds the
// RULES bundle, and then every later step — and most of them read
// `product/packages/cli/dist`, including `test:rules`, which is literally
// `node product/packages/cli/dist/index.js`. So a gate run made after editing a `.ts` file and
// before building exercises the PREVIOUS engine, reports a green run, and says nothing
// about the change that was just made. A green that is not about your change is worse than a red.
//
// The counts that used to be written into this comment and into the message below — "fifteen more
// steps", "thirteen of the sixteen" — were stale within hours of being written, which is the same
// defect the gate-list check above now closes for §11. The one number that is still printed is
// derived at run time; the unverifiable fraction was removed rather than corrected, because a number
// nothing checks is what this pair of guards exists to stop.
//
// This is the same defect class as the one work item #51 was opened to fix: two places that must
// agree about which version is under test, with nothing making them. The project's rules forbid keeping a
// second copy of anything two places must agree on; where the copy cannot be removed — a compiler's
// output IS a second copy of its input, by construction — what can be had is a build that refuses to
// run while the two disagree. That is what the check-set drift guard below does for one array, and
// what this does for the whole compiled package.
//
// THE TEST IS PER PACKAGE, newest source against newest output, and that choice is deliberate:
// comparing the newest source in the tree against the OLDEST compiled file reports a package as
// stale whenever an incremental build legitimately leaves an unchanged output untouched, and
// comparing across packages reports `cli` as stale because nobody rebuilt `schemas`. Newest against
// newest asks the one question that matters — has a build happened since the last edit — and is the
// same question `make` asks.
const packagesRoot = join(ROOT, "product/packages");
function newestMtime(dir) {
  let newest = { ms: 0, path: null };
  const visit = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) { visit(p); continue; }
      const ms = statSync(p).mtimeMs;
      if (ms > newest.ms) newest = { ms, path: p };
    }
  };
  visit(dir);
  return newest;
}
if (existsSync(packagesRoot)) {
  for (const pkg of readdirSync(packagesRoot)) {
    const srcDir = join(packagesRoot, pkg, "src");
    const distDir = join(packagesRoot, pkg, "dist");
    // No `dist/` at all is a different failure and the drift guard below already reports it with the
    // remedy. No `src/` is not a TypeScript package.
    if (!existsSync(srcDir) || !existsSync(distDir)) continue;
    const src = newestMtime(srcDir);
    const dist = newestMtime(distDir);
    if (src.ms > dist.ms) {
      const drift = Math.round((src.ms - dist.ms) / 1000);
      errors.push(
        `product/packages/${pkg} has not been rebuilt since its sources were last edited: ` +
          `${src.path.slice(ROOT.length)} is ${drift}s newer than the newest file in ` +
          `${distDir.slice(ROOT.length)}. \`npm run gates\` does not compile TypeScript, and most of ` +
          `${gateStepsPhrase} steps read the compiled output, so continuing would test the previous ` +
          `engine and report green about a change it never ran. Run \`pnpm -C product -r build\` ` +
          `and then \`npm run gates\` again`,
      );
    }
  }
}

// THE CHECK-SET DRIFT GUARD. `detector.structural_checks` is validated here against an enum in
// rule.schema.json and dispatched at scan time by name against the registry in
// product/packages/cli/src/structural/checks/registry.ts. JSON Schema cannot import from TypeScript,
// so those are two lists of the same thing — a forbidden second copy, kept only because
// there is no way to have one. What can be had is a build that refuses to run while they disagree,
// which is what this is. Without it the enum is free to accept a name no check set implements: the
// rule validates, the bundle ships, and the engine raises the error in the user's tree at scan time
// instead of here. The other direction is quieter still — a set the engine implements and the enum
// rejects cannot be declared by any rule, so the code is unreachable and nothing says so.
//
// THE REGISTRY IS READ FROM THE CLI'S COMPILED OUTPUT, not parsed out of the .ts source, because
// CHECK_SET_NAMES is the array the engine itself dispatches on and a text pattern over the source is
// only a guess at it. A registry that cannot be read FAILS the build rather than skipping the
// comparison: a guard that can silently not-run is the class of defect this guard exists to prevent,
// and `npm run gates` already requires the built CLI for test:structural-read, test:rules and
// test:mutations.
const CHECK_SET_REGISTRY = join(ROOT, "product/packages/cli/dist/structural/checks/registry.js");
const SCHEMA_CHECK_SETS = ruleSchemaDoc.properties?.detector?.properties?.structural_checks?.items?.enum;
let engineCheckSets = null;
try {
  ({ CHECK_SET_NAMES: engineCheckSets } = await import(pathToFileURL(CHECK_SET_REGISTRY).href));
} catch (e) {
  errors.push(
    `the engine's structural check-set registry could not be read from ${CHECK_SET_REGISTRY}, so ` +
      `rule.schema.json's structural_checks enum could not be checked against it: ${String(e.message).split("\n")[0]}. ` +
      `Build the CLI package (pnpm -r build in product/) — this comparison is not optional, because a ` +
      `schema enum nothing checks is how a rule comes to name a check set that does not exist`,
  );
}
if (engineCheckSets !== null) {
  if (!Array.isArray(engineCheckSets) || !Array.isArray(SCHEMA_CHECK_SETS)) {
    errors.push(
      `the structural check-set lists could not be compared: registry.js exports ` +
        `${Array.isArray(engineCheckSets) ? "an array" : typeof engineCheckSets} as CHECK_SET_NAMES and ` +
        `rule.schema.json's detector.structural_checks.items.enum is ` +
        `${Array.isArray(SCHEMA_CHECK_SETS) ? "an array" : typeof SCHEMA_CHECK_SETS}`,
    );
  } else {
    const notInSchema = engineCheckSets.filter((n) => !SCHEMA_CHECK_SETS.includes(n));
    const notInEngine = SCHEMA_CHECK_SETS.filter((n) => !engineCheckSets.includes(n));
    const differences = [];
    if (notInSchema.length) {
      differences.push(
        `the engine implements ${notInSchema.join(", ")}, which the enum rejects, so no rule can declare it`,
      );
    }
    if (notInEngine.length) {
      differences.push(
        `the enum accepts ${notInEngine.join(", ")}, which no check set implements, so a rule naming it ` +
          `validates here and fails at scan time`,
      );
    }
    if (differences.length > 0) {
      errors.push(
        `rule.schema.json's structural_checks enum and the engine's check-set registry are not the ` +
          `same set: ${differences.join("; and ")}. One list, exported and imported — edit ` +
          `${SCHEMA_PATH} and product/packages/cli/src/structural/checks/registry.ts together`,
      );
    }
  }
}

// THE PATTERN-COMPILE GATE, added 2026-08-19.
//
// WHAT WAS WRONG: this file contained no `new RegExp` at all, so a detector pattern that cannot be
// compiled built green and exited 0. Reproduced deliberately three times — twice during P4 and once more before this gate was written:
// `(?i)console\.log` and `console(\.log` each produced a green build, shipped into rules.json, and
// threw only at scan time out of `new RegExp` inside the engine's `.map`, with no rule id, no field
// name and no index in the message. The reasoning, the P2a seam and the one hole a compile cannot
// see are all in tools/lint-patterns.mjs.
//
// WHY THE EXPANSION IS IMPORTED AND NOT REIMPLEMENTED: `detector.vocabulary` is spliced into a
// pattern BEFORE the engine compiles it, so the string this gate must compile is the expanded one.
// Re-deriving the splice here would be a forbidden second copy, and it would be the worse
// kind — a copy that agrees on the day it is written. The engine's own `expandPattern` is imported
// from the CLI's COMPILED output for the same reason the check-set registry above is: it is the
// function the engine actually runs, and a text pattern over the source would only be a guess at it.
// An expander that cannot be read FAILS the build rather than skipping the check.
const VOCABULARY_MODULE = join(ROOT, "product/packages/cli/dist/vocabulary.js");
let expandPattern = null;
let mergeSharedVocabulary = null;
let mergeVocabularyMatching = null;
let mergeVocabularyKinds = null;
let mergeVocabularyOwners = null;
let mergeVocabularyEntities = null;
let assertVocabularyMatching = null;
let assertTolerantListsAreReadPositively = null;
try {
  ({
    expandPattern,
    mergeSharedVocabulary,
    mergeVocabularyMatching,
    mergeVocabularyKinds,
    mergeVocabularyOwners,
    mergeVocabularyEntities,
    assertVocabularyMatching,
    assertTolerantListsAreReadPositively,
  } = await import(pathToFileURL(VOCABULARY_MODULE).href));
} catch (e) {
  errors.push(
    `the engine's pattern expander could not be read from ${VOCABULARY_MODULE}, so no detector ` +
      `pattern could be compiled at build time: ${String(e.message).split("\n")[0]}. Build the CLI ` +
      `package (pnpm -r build in product/) — this check is not optional, because a pattern that does ` +
      `not compile ships in the bundle and crashes in the user's tree instead of here`,
  );
}
if (typeof expandPattern !== "function") {
  if (expandPattern !== null) {
    errors.push(
      `${VOCABULARY_MODULE} does not export expandPattern as a function, so detector patterns cannot ` +
        `be expanded the way the engine expands them`,
    );
  }
  expandPattern = null;
}
if (typeof mergeSharedVocabulary !== "function") {
  if (mergeSharedVocabulary !== null) {
    errors.push(
      `${VOCABULARY_MODULE} does not export mergeSharedVocabulary as a function, so a rule's ` +
        `detector.shared_vocabulary imports cannot be merged the way the engine's own module merges them`,
    );
  }
  mergeSharedVocabulary = null;
}
if (typeof mergeVocabularyKinds !== "function") {
  if (mergeVocabularyKinds !== null) {
    errors.push(
      `${VOCABULARY_MODULE} does not export mergeVocabularyKinds as a function, so a shared list's ` +
        `own \`kind\` cannot be merged into the rules that import it. The bundle would then carry ` +
        `every list's anchors flattened with nothing saying which of them are vendor spellings, and ` +
        `the only remaining way to know would be a hand-kept list of names, a second copy that two places would then have to keep in agreement`,
    );
  }
  mergeVocabularyKinds = null;
}
if (typeof mergeVocabularyOwners !== "function") {
  if (mergeVocabularyOwners !== null) {
    errors.push(
      `${VOCABULARY_MODULE} does not export mergeVocabularyOwners as a function, so the name each shared anchor is a ` +
        `spelling of cannot be carried into the rules that import it, and the report would name a vendor by the matched ` +
        `word`,
    );
  }
  mergeVocabularyOwners = null;
}
if (typeof mergeVocabularyMatching !== "function") {
  if (mergeVocabularyMatching !== null) {
    errors.push(
      `${VOCABULARY_MODULE} does not export mergeVocabularyMatching as a function, so a shared list's ` +
        `own \`matching\` cannot be merged into the rules that import it. Every flagged list would then ` +
        `ship matching EXACTLY, which is the silent narrowing the flag exists to end`,
    );
  }
  mergeVocabularyMatching = null;
}
for (const [name, fn] of [
  ["assertVocabularyMatching", assertVocabularyMatching],
  ["assertTolerantListsAreReadPositively", assertTolerantListsAreReadPositively],
]) {
  if (typeof fn === "function" || fn === null) continue;
  errors.push(
    `${VOCABULARY_MODULE} does not export ${name} as a function, so a vocabulary_matching declaration ` +
      `that means nothing — a list name the rule does not have, a flag that does not exist, a widened ` +
      `negation — would build green and throw on a user's machine instead of here`,
  );
}
if (typeof assertVocabularyMatching !== "function") assertVocabularyMatching = null;
// ...and the merge for `detector.shared_path_exclusions`, which lives in its own engine-side module
// beside the assertion the engine makes about it. Imported from the CLI's COMPILED output for the
// same reason `expandPattern` and `mergeSharedVocabulary` above are: it is the code the engine's own
// assertion answers to, and a second implementation here would agree on the day it was written.
const PATH_EXCLUSIONS_MODULE = join(ROOT, "product/packages/cli/dist/path-exclusions.js");
let mergeSharedPathExclusions = null;
let pathExclusionClauses = null;
try {
  ({ mergeSharedPathExclusions, pathExclusionClauses } = await import(pathToFileURL(PATH_EXCLUSIONS_MODULE).href));
} catch (e) {
  errors.push(
    `the engine's path-exclusion merge could not be read from ${PATH_EXCLUSIONS_MODULE}: ` +
      `${String(e.message).split("\n")[0]}. Build the CLI package — this check is not optional, ` +
      `because a rule whose shared exclusion sets are not merged reads every test tree, fixture ` +
      `directory and vendored dependency its author declared it must not read`,
  );
}
if (typeof mergeSharedPathExclusions !== "function") {
  if (mergeSharedPathExclusions !== null) {
    errors.push(
      `${PATH_EXCLUSIONS_MODULE} does not export mergeSharedPathExclusions as a function, so a rule's ` +
        `detector.shared_path_exclusions imports cannot be merged the way the engine's own module merges them`,
    );
  }
  mergeSharedPathExclusions = null;
}
if (typeof assertTolerantListsAreReadPositively !== "function") assertTolerantListsAreReadPositively = null;

// SHARED VOCABULARY (rules/vocabulary/*.yaml), read once for the whole build.
//
// WHY IT IS RESOLVED HERE AND NOT IN THE ENGINE: a word list several rules must agree on is
// authored once under `rules/vocabulary/` and named by each rule in `detector.shared_vocabulary`.
// The imports are merged into that rule's `detector.vocabulary` BELOW, before any lint reads it and
// before the bundle is written, so `dist/bundle/rules.json` carries no import and a scanner never
// needs the authoring tree — which a user's machine does not have. It is the same decision, for the
// same reason, that `rules/gates/*.yaml` already ships inlined into the checklists that name it.
//
// A LOAD FAILURE IS A BUILD FAILURE, never a build without shared lists: a file that does not parse
// or does not validate would otherwise make every list it declares "not declared", and every rule
// importing one would fail one step later blaming the wrong file. Errors are collected rather than
// thrown for the reason every check in this file collects them — an author fixes a tree in one pass.
// A MISSING DIRECTORY is not a failure; it means there are no shared lists, which is the state this
// mechanism shipped in, and an import then fails by name.
//
// WHICH DIRECTORY IS READ is `VOCABULARY_DIR`, and it follows `RULES_DIR` by construction — see
// `deriveVocabularyDir` in tools/shared-vocabulary.mjs for why the two are one decision and not
// two. It is printed in the summary line below whenever any shared file was read, so a build
// driven against a snapshot says which snapshot's word lists it used.
const {
  shared: sharedVocabulary,
  errors: sharedVocabularyErrors,
  files: sharedVocabularyFiles,
} = loadSharedVocabulary(VOCABULARY_DIR);
for (const e of sharedVocabularyErrors) errors.push(e);

// SHARED PATH EXCLUSIONS (rules/path-exclusions/*.yaml), read once for the whole build, for exactly
// the reasons above and resolved in the same place: 98 of the 169 `detector.path_without` clauses on
// disk on 2026-08-27 were a clause some other rule also spelled byte for byte, and the copies had
// already drifted. A named set is merged into the importing rule's `detector.path_without` BELOW,
// before any lint reads it, so the bundle carries no import and the scanner never needs this
// directory. See tools/shared-path-exclusions.mjs for why loading is here and merging is not.
const {
  sets: sharedPathExclusions,
  errors: sharedPathExclusionErrors,
  files: sharedPathExclusionFiles,
  setFiles: sharedPathExclusionSetFiles,
} = loadSharedPathExclusions(PATH_EXCLUSIONS_DIR);
for (const e of sharedPathExclusionErrors) errors.push(e);

// W6 (2026-08-21): `detector.file_globs` reaches `new RegExp` too, inside `compileGlobs`
// (product/packages/cli/src/globs.ts), called from `engine.ts` `surfaceAllows` — and until this
// gate nothing compiled it at build time, so an entry `compileGlobs` could not turn into a valid
// pattern shipped green and threw only at scan time, in the one field the pattern-compile gate
// above did not cover (that gate must never compile `file_globs` as a regular expression — see
// `NON_PATTERN_DETECTOR_LIST_FIELDS` in tools/lint-patterns.mjs — `**/*.ts` is a valid glob and an
// invalid regex). Imported from the CLI's COMPILED output for the same reason `expandPattern` is:
// it is the function the engine actually runs.
//
// **This gate had a defect to find on the day it was written, and the first version of this
// comment said the opposite** — that `compileGlobs` was "safe by construction" and no glob made it
// throw. `{*.ts,*.tsx}`, `src/{*.ts,*.js}`, `**\/{*.ts,*.tsx}` and `{*.ts}` all threw, and
// `{a*,b}` silently compiled to a regex matching `""` but not `"ab"`. globs.ts is repaired; this
// gate is what stops the next such entry from reaching a user's tree.
//
// Hard-wired, exactly like VOCABULARY_MODULE above. An earlier draft made the path env-overridable
// so that a test case (k) could point it at a stand-in that always throws;
// that case now uses a REAL glob the REAL compileGlobs rejects, so the override bought nothing and
// left the build able to be pointed at a glob compiler that is not the engine's.
// THE RULE LINES. A rule's
// `problem_line` (the title of a finding to fix) and `fix_line` (what to do) are presentation: the build checks them here
// with the CLI's own checker, then moves them out of the rule into `rule-lines.json`, so `rules.json` - what every rule
// digest is taken over and what the review seats are handed - never carries them. The names, the checker and the file
// name are imported from the compiled CLI, so the build, `ruleHash` and `loadBundle` cannot disagree on any of them.
let ruleLinesComplaints = null;
let RULE_LINE_FIELDS = null;
let RULE_LINES_FILE = null;
try {
  ({ ruleLinesComplaints } = await import(pathToFileURL(join(ROOT, "product/packages/cli/dist/rule-lines.js")).href));
  ({ RULE_LINE_FIELDS } = await import(pathToFileURL(join(ROOT, "product/packages/cli/dist/rests-on.js")).href));
  ({ RULE_LINES_FILE } = await import(pathToFileURL(join(ROOT, "product/packages/cli/dist/bundle.js")).href));
} catch (e) {
  errors.push(
    `the rule-lines checker could not be read from the compiled CLI: ${String(e.message).split("\n")[0]}. Build the ` +
      `CLI package (pnpm -r build in product/): without it a rule's problem_line and fix_line would ride inside the rule ` +
      `and move its digest`,
  );
}
const ruleLines = {};

const GLOBS_MODULE = join(ROOT, "product/packages/cli/dist/globs.js");
let compileGlobs = null;
try {
  ({ compileGlobs } = await import(pathToFileURL(GLOBS_MODULE).href));
} catch (e) {
  errors.push(
    `the engine's glob compiler could not be read from ${GLOBS_MODULE}, so no file_globs entry ` +
      `could be compiled at build time: ${String(e.message).split("\n")[0]}. Build the CLI package ` +
      `(pnpm -r build in product/) — this check is not optional, because a glob that does not ` +
      `compile ships in the bundle and crashes in the user's tree instead of here`,
  );
}
if (typeof compileGlobs !== "function") {
  if (compileGlobs !== null) {
    errors.push(
      `${GLOBS_MODULE} does not export compileGlobs as a function, so file_globs entries cannot be ` +
        `compiled the way the engine compiles them`,
    );
  }
  compileGlobs = null;
}

// The self-test runs unconditionally, before any rule is read, over synthetic inputs only — the
// convention tools/gate-list.mjs follows and a check states: a self-test behind
// a flag is one nobody runs. It re-establishes BOTH failure modes by execution rather than
// asserting them, and proves the check bites on each of the five fields the engine compiles.
for (const f of patternCompileSelfTest()) {
  errors.push(
    `the pattern-compile gate's own self-test failed, so its verdict on the rules means nothing: ${f}`,
  );
}
// The person-facing word lint's self-test, run unconditionally for the same reason.
for (const f of personWordSelfTest()) {
  errors.push(`the person-facing word lint's own self-test failed, so its verdict on the rules means nothing: ${f}`);
}

for (const pack of readdirSync(RULES_DIR)) {
  const packDir = join(RULES_DIR, pack);
  for (const ruleId of readdirSync(packDir)) {
    const ruleFile = join(packDir, ruleId, "rule.yaml");
    if (!existsSync(ruleFile)) continue;
    let rule;
    try {
      rule = parseYaml(readFileSync(ruleFile, "utf8"));
      stripShippedRecordMarkers(rule);
    } catch (e) {
      errors.push(`${pack}/${ruleId}: ${/^record markers:/.test(e.message) ? "" : "YAML parse error: "}${e.message}`);
      continue;
    }
    if (!validate(rule)) {
      for (const err of validate.errors ?? []) {
        errors.push(`${pack}/${ruleId}: ${err.instancePath || "/"} ${err.message}`);
      }
      continue;
    }
    if (rule.id !== ruleId) {
      errors.push(`${pack}/${ruleId}: rule.id (${rule.id}) does not match the directory name`);
      continue;
    }
    if (rule.pack !== pack) {
      errors.push(`${pack}/${ruleId}: rule.pack (${rule.pack}) does not match the pack directory`);
      continue;
    }

    // READING_CLASS — the two things JSON Schema cannot say about it.
    // `limbs[].question` is a map onto `context_questions` BY POSITION,
    // so a number past the rule's own question count names nothing, and it goes stale silently
    // when a rule's questions are renumbered — the schema's own description says so. And a
    // `mixed` class with no limbs leaves an adjudication seat with no reading unit for any
    // question of the rule, because §4.1 of the design annex gives the mixed class its unit as
    // "per limb". Both are refused HERE rather than in `test:rules`: this is the earliest gate
    // that parses every rule.yaml (step 2 of the gate chain), it already holds the validated
    // rule, and a bundle that shipped either shape would carry it into every later gate. One
    // place only — `test:rules` reads the bundle this builds.
    if (rule.reading_class) {
      const questionCount = Array.isArray(rule.context_questions) ? rule.context_questions.length : 0;
      const limbs = rule.reading_class.limbs;
      for (const limb of Array.isArray(limbs) ? limbs : []) {
        if (!Number.isInteger(limb?.question) || limb.question < 1 || limb.question > questionCount) {
          errors.push(
            `${pack}/${ruleId}: reading_class.limbs[].question is ${JSON.stringify(limb?.question)}, outside this rule's 1..${questionCount} context_questions. The limb map is by position, so this number names no question of this rule.`,
          );
        }
      }
      if (rule.reading_class.class === "mixed" && !(Array.isArray(limbs) && limbs.length > 0)) {
        errors.push(
          `${pack}/${ruleId}: reading_class.class is "mixed" with no limbs. A mixed rule's reading unit is "per limb", so this value leaves an adjudication seat with no reading unit for any of its ${questionCount} question(s).`,
        );
      }
    }

    // `detector.gate_scope` WITHOUT `detector.also_in_file` IS A HARD ERROR, NOT A SILENT NO-OP.
    //
    // `gate_scope` says how far the corroboration gate may look; with no clause list there is no
    // gate, so the declaration is read by nothing and the rule behaves exactly as if it were absent.
    // An author who writes it has stated an intention the engine cannot carry out, and the state
    // this refuses is the one `rule.schema.json` names for `structural_checks`: "a rule that opts in
    // without declaring one of the lists its set reads is a hard error rather than a silent
    // fallback". The failure this prevents is invisible by construction — a widened rule that reads
    // no wider, producing exactly the output it produced before, with nothing anywhere saying so.
    //
    // Checked here and not in the engine, so it is one statement rather than two: every bundle a
    // user scans with is written by this file, and a hand-assembled one that skipped it would need a
    // second copy of this rule to be refused twice.
    // `detector.gate_applies_to` — THE GATE'S SUBJECT, AND EVERY WAY OF WRITING IT WRONG IS A HARD
    // ERROR HERE, for the reason the `gate_scope` check above exists: a subject the engine cannot
    // carry out is invisible by construction, because the rule goes on producing exactly what it
    // produced before with nothing anywhere saying the declaration was not read.
    //
    // Five shapes are refused. (1) A subject with no clause list: `gate_applies_to` says which
    // clauses the corroboration is about and there is no corroboration to be about. (2) A reference
    // the grammar does not admit: only `match[i]` may be named, because a gate's subject has to be a
    // clause that raises candidates and `also_in_file[i]` or `path_without[i]` raise none. (3) An
    // index past this rule's own `match` list, which names no clause of this rule — the same failure
    // `detector.cost_exempt` is held to in a check, and the reason the index is
    // 0-based here is that it is 0-based there. (4) `gate_mode` without `gate_applies_to`: the mode
    // says what to do with a subject that was never declared, so it is read by nothing. (5) A
    // subject at `gate_scope: "file"`, which has no after-the-walk phase for a subject to be about.
    if (rule.detector?.gate_applies_to !== undefined) {
      const subject = Array.isArray(rule.detector.gate_applies_to) ? rule.detector.gate_applies_to : [];
      const matchCount = Array.isArray(rule.detector.match) ? rule.detector.match.length : 0;
      if (!Array.isArray(rule.detector.also_in_file) || rule.detector.also_in_file.length === 0) {
        errors.push(
          `${pack}/${ruleId}: detector.gate_applies_to names ${subject.length} clause(s) and the rule ` +
            `declares no detector.also_in_file. The field says WHICH clauses the corroboration is ` +
            `about, and with no clause list there is no corroboration: either declare the clause ` +
            `list, or remove gate_applies_to`,
        );
      }
      // (5) A SUBJECT AT FILE SCOPE, added 2026-09-22 with the engine half. The engine's two
      // readers of a subject both assume a scope wider than the file: `annotate` computes one fact
      // about the whole scope and annotates every subject location with it, and `gate` holds the
      // subject's candidates until the walk ends and the scope can answer. At `gate_scope: "file"`
      // there is no such phase — the answer is the file's own gate, taken before any candidate
      // exists — so the combination would either annotate every location `false` whatever the file
      // said, or let a shut file gate remove candidates of clauses the subject does not name. Both
      // are silently wrong answers rather than failures, so the declaration is refused here.
      if ((rule.detector.gate_scope ?? "file") === "file") {
        errors.push(
          `${pack}/${ruleId}: detector.gate_applies_to names ${subject.length} clause(s) at ` +
            `gate_scope "file". A subject says which clauses a corroboration decision taken AFTER ` +
            `the walk is about, and at file scope the decision is taken during it, on this file ` +
            `alone: either declare gate_scope "directory" or "project", or remove gate_applies_to`,
        );
      }
      const seen = new Set();
      for (const ref of subject) {
        const m = /^match\[([0-9]+)\]$/.exec(String(ref));
        if (m === null) {
          errors.push(
            `${pack}/${ruleId}: detector.gate_applies_to entry ${JSON.stringify(ref)} is not a clause ` +
              `reference this field admits. Write match[i] with the index 0-based; a gate's subject ` +
              `must be a clause that raises candidates`,
          );
          continue;
        }
        if (seen.has(String(ref))) {
          errors.push(
            `${pack}/${ruleId}: detector.gate_applies_to names ${JSON.stringify(ref)} twice. A clause ` +
              `is in the subject or it is not; a second mention says nothing the first did not`,
          );
          continue;
        }
        seen.add(String(ref));
        if (Number(m[1]) >= matchCount) {
          errors.push(
            `${pack}/${ruleId}: detector.gate_applies_to names ${JSON.stringify(ref)}, outside this ` +
              `rule's 0..${Math.max(0, matchCount - 1)} match clauses. The index is 0-based, as it is ` +
              `in detector.cost_exempt, so this reference names no clause of this rule`,
          );
        }
      }
    }
    if (rule.detector?.gate_mode !== undefined && rule.detector.gate_applies_to === undefined) {
      errors.push(
        `${pack}/${ruleId}: detector.gate_mode is "${rule.detector.gate_mode}" and the rule declares ` +
          `no detector.gate_applies_to. The mode says what the engine does with the corroboration ` +
          `computed for the SUBJECT clauses, and no subject was declared, so the value would be read ` +
          `by nothing: either declare the clauses the mode is for, or remove gate_mode`,
      );
    }

    if (rule.detector?.gate_scope !== undefined && rule.detector.gate_scope !== "file") {
      if (!Array.isArray(rule.detector.also_in_file) || rule.detector.also_in_file.length === 0) {
        errors.push(
          `${pack}/${ruleId}: detector.gate_scope is "${rule.detector.gate_scope}" and the rule ` +
            `declares no detector.also_in_file. gate_scope says how far the corroboration gate may ` +
            `look and there is no gate to widen, so the declaration would be read by nothing: ` +
            `either declare the clause list the wider scope is for, or remove gate_scope`,
        );
        continue;
      }
    }

    // CLAUSE REFERENCES IN `detector.also_in_file`, RESOLVED HERE SO THAT NO PATTERN IS EVER COPIED.
    //
    // A corroborator is very often one of the rule's own `match` clauses: the vocabulary that raises
    // a candidate somewhere else in the tree is the vocabulary that corroborates this one. Written
    // out, that is a second copy of a string two places must agree on, which the project's rules forbid -
    // "never keep a second copy of anything two places must agree on; export it and import it" - and
    // the failure it invites is silent, because the copy and the clause go on compiling after the
    // first edit that touches only one of them. A rule may therefore NAME a clause instead of
    // repeating it, in the same grammar `detector.gate_applies_to` uses - `match[i]`, 0-based - and
    // this loop replaces the reference with that clause's pattern, byte for byte, before any lint
    // below reads the rule and before the bundle is written. From this line down, and in the bundle
    // the engine reads, the rule is indistinguishable from one that wrote the pattern out, which is
    // what keeps the engine unchanged: it compiles `detector.also_in_file` exactly as it did.
    //
    // A reference that names no clause of this rule is a HARD ERROR, for the reason the gate checks
    // above are: resolving it to nothing would leave the rule corroborated by a shorter list than it
    // declares, with nothing anywhere saying so.
    //
    // Only `also_in_file` admits references, and only this shape. A corroborator that is meant as a
    // pattern never looks like one: `match[3]` compiled as a regular expression matches the text
    // "match3". `tools/lint-patterns.mjs` knows the shape too, so that a caller handing it an
    // unresolved rule is not told that a reference compiles.
    if (Array.isArray(rule.detector?.also_in_file)) {
      const { resolved, unresolved } = resolveAlsoInFileReferences(rule.detector);
      for (const bad of unresolved) errors.push(`${pack}/${ruleId}: ${unresolvedClauseReferenceMessage(bad)}`);
      rule.detector.also_in_file = resolved;
    }

    // SHARED VOCABULARY RESOLUTION. Every list named in `detector.shared_vocabulary` is merged into
    // this rule's `detector.vocabulary` under the same name, and the import field is REMOVED — so
    // from this line down, and in the bundle, the rule is indistinguishable from one that declared
    // the list itself. That is deliberate and it is what keeps the change to the engine at one
    // assertion: nothing downstream has to know that a list was shared.
    //
    // IT RUNS HERE, before every lint below, because each of them reads the rule as the bundle will
    // carry it: the pattern-compile gate expands `(?&name)` and would report an imported list as
    // undeclared, and the join lint reads the same expanded patterns.
    //
    // THE IMPORT FIELD IS DELETED RATHER THAN KEPT AS PROVENANCE. Keeping it would leave the bundle
    // carrying both the import and its result, and any consumer that resolved the bundle a second
    // time would then hit the name collision this mechanism treats as a hard error — a mechanism
    // whose own output cannot be fed back through it. Provenance stays where it is authored, in
    // `rules/packs/<pack>/<rule>/rule.yaml`, which is the file a reader of the rule opens anyway.
    //
    // A rule that imports nothing is untouched: `mergeSharedVocabulary` returns its own vocabulary
    // object unchanged, and `delete` on an absent key is a no-op. This is why introducing the
    // mechanism moved no pattern of any of the 56 rules.
    if (mergeSharedVocabulary !== null && rule.detector) {
      try {
        const merged = effectiveVocabulary(
          rule.detector,
          sharedVocabulary,
          `${pack}/${ruleId}`,
          mergeSharedVocabulary,
        );
        if (merged !== undefined) rule.detector.vocabulary = merged;
        // ...and, in the same pass and from the same files, HOW those lists are matched. A shared
        // list declares its own `matching` because that is a fact about the anchors rather than
        // about any importer; merged here, it travels in the bundle beside the anchors and the
        // engine needs no access to `rules/vocabulary/`. A list that declares none contributes
        // nothing and the field stays absent, which is the state every rule shipped in before
        // 2026-08-27.
        if (mergeVocabularyMatching !== null) {
          const matching = effectiveVocabularyMatching(
            rule.detector,
            sharedVocabulary,
            `${pack}/${ruleId}`,
            mergeVocabularyMatching,
          );
          if (matching !== undefined) rule.detector.vocabulary_matching = { ...matching };
        }
        // ...and WHAT each shared list's items are, from the same files in the same pass. `kind`
        // is the only thing that distinguishes a list of vendor spellings (`payment_recipients`:
        // Stripe, Paddle, Adyen) from a list of construct spellings (`outbound_webhook_target`:
        // `webhook_url`, `callbackUrl`) once `mergeSharedVocabulary` above has flattened both into
        // `detector.vocabulary`. A consumer that needs the distinction — `scan.ts`, which reports a
        // declared dependency spelled like a vendor the recipient rules know — would otherwise have
        // to keep its own list of which names are vendor lists, and that list goes stale the first
        // time a recipient list is authored, silently and in the direction of reading less.
        if (mergeVocabularyKinds !== null) {
          const kinds = effectiveVocabularyKinds(rule.detector, sharedVocabulary, mergeVocabularyKinds);
          if (kinds !== undefined) rule.detector.vocabulary_kinds = { ...kinds };
        }
        // ...and WHO each shared anchor is a spelling of (the entry's name, nothing else), so the report can name a token
        // item by its vendor and count one recipient once however many of its spellings one line matched (fix C2-2,
        // vocabulary.ts `mergeVocabularyOwners`). Written after validation, as `vocabulary_kinds` is.
        if (mergeVocabularyOwners !== null) {
          const owners = mergeVocabularyOwners(rule.detector.shared_vocabulary, sharedVocabulary);
          if (owners !== undefined) rule.detector.vocabulary_owners = owners;
        }
        // ...and the legal entity each recipient entry names, by its name alone (the entry's `legal_name`), keyed by the
        // entry's name, which the self-name question offers each vendor by (vocabulary.ts `mergeVocabularyEntities`).
        if (typeof mergeVocabularyEntities === "function") {
          const entities = mergeVocabularyEntities(rule.detector.shared_vocabulary, sharedVocabulary);
          if (entities !== undefined) rule.detector.vocabulary_entities = entities;
        }
        // ...and the two ways a matching declaration can be written and mean nothing are refused
        // HERE rather than at scan time. The engine raises both, but the engine runs on a user's
        // machine: an author who mistypes a list name or widens a negation would otherwise get a
        // green build and a crash in somebody else's tree. Same functions, called one step earlier.
        if (assertVocabularyMatching !== null) {
          assertVocabularyMatching(rule.detector.vocabulary, rule.detector.vocabulary_matching, `${pack}/${ruleId}`);
        }
        if (assertTolerantListsAreReadPositively !== null) {
          assertTolerantListsAreReadPositively(rule.detector, rule.detector.vocabulary_matching, `${pack}/${ruleId}`);
        }
        delete rule.detector.shared_vocabulary;
      } catch (e) {
        errors.push(`${e.message}`);
        continue;
      }
    }

    // SHARED PATH EXCLUSION RESOLUTION, and it is the same shape as the block above for the same
    // reasons: every set named in `detector.shared_path_exclusions` contributes its clauses to this
    // rule's `detector.path_without`, and the import field is REMOVED — so from this line down, and
    // in the bundle, the rule is indistinguishable from one that wrote the clauses itself.
    //
    // IT RUNS HERE, before every lint below, because each of them reads the rule as the bundle will
    // carry it: `lintRulePatterns` compiles `path_without` and would report an imported clause not
    // at all rather than compiling it, which is the one direction that is silent.
    //
    // A rule that imports nothing is untouched — `mergeSharedPathExclusions` returns its own array
    // unchanged and `delete` on an absent key is a no-op — which is why introducing the mechanism
    // moved not one clause of the 31 rules that import nothing.
    if (mergeSharedPathExclusions !== null && rule.detector) {
      try {
        const merged = effectivePathExclusions(
          rule.detector,
          sharedPathExclusions,
          `${pack}/${ruleId}`,
          mergeSharedPathExclusions,
        );
        if (merged !== undefined) rule.detector.path_without = merged;
        delete rule.detector.shared_path_exclusions;
      } catch (e) {
        errors.push(`${e.message}`);
        continue;
      }
    }

    // Rule text is fed verbatim into the adjudicator's context, so it is an injection
    // surface: anyone who lands text in a rule can steer the agent that reads it. This is
    // the ContextCrush class of attack (rule injection into a rule-serving MCP), which is
    // why rule text must stay data and never carry imperative phrasing. Rejected
    // mechanically here rather than left to review.
    //
    // Widened from two fields to four on 2026-08-11. `evidence_template` was wired into the
    // candidate payload that day and now reaches the adjudicating agent and the agent that writes
    // the user's report; `title` had reached four consumers all along and was never screened here.
    // The condition this lint exists for is "an agent reads this text", and both fields now meet
    // it. Measured before the change: INJECTION_PATTERN produces 0 hits across all 54
    // `evidence_template` values and all 54 titles, so nothing on disk had to move.
    // These are now the same four fields the assertion lint below covers.
    //
    // Both lints match each field's text with its whitespace folded (`foldWhitespace`, the folding the
    // report applies) BEFORE it is serialised. Their phrases are written with
    // single spaces, and serialising first turned a line break of a `|` block into the two characters
    // `\n`, so a phrase wrapped across one, or written with a doubled or a no-break space, was never
    // seen by either lint.
    const injectionFields = JSON.stringify(
      [rule.title, rule.short_name, rule.context_questions, rule.evidence_template, rule.remediation_template, rule.problem_line, rule.fix_line],
      (_, v) => (typeof v === "string" ? foldWhitespace(v) : v),
    );
    if (INJECTION_PATTERN.test(injectionFields)) {
      errors.push(`${pack}/${ruleId}: rule text contains a suspicious instruction-override pattern`);
      continue;
    }

    // The scanner must never assert that code is illegal or lawful — only that it is a
    // candidate for non-compliance with a cited standard. Enforce that in the build so a
    // single careless rule cannot put an assertion into someone's audit trail.
    // legal_basis is deliberately exempt: statutory citations legitimately use this wording.
    const assertionFields = JSON.stringify(
      [rule.title, rule.short_name, rule.context_questions, rule.evidence_template, rule.remediation_template, rule.problem_line, rule.fix_line],
      (_, v) => (typeof v === "string" ? foldWhitespace(v) : v),
    );
    const assertion = assertionFields.match(ASSERTION_PATTERN);
    if (assertion) {
      errors.push(
        `${pack}/${ruleId}: rule text asserts legality ("${assertion[0]}") — use "candidate for non-compliance" / "may not meet" / "requires review"`,
      );
      continue;
    }

    // THE WORDS THE HOUSE DOES NOT USE TO THE PERSON, over every string leaf of the rule (the list,
    // the three exempt kinds of path and why they are exempt are in tools/lint-patterns.mjs under THE
    // PERSON-FACING WORD LINT). The title, the evidence and remediation templates and the citations
    // are copied into the report, the console, the SARIF file, the RoPA and findings.json as written,
    // so a listed word here reaches the person whatever the program's own wording says.
    const personWords = lintPersonFacingWords(rule, PERSON_WORD_PATHS.rule);
    for (const kind of ["quoted", "notCopied", "verbatim"]) {
      for (const row of personWords[kind]) personWordTally[kind].push({ where: `${pack}/${ruleId}`, ...row });
    }
    if (personWords.problems.length > 0) {
      for (const p of personWords.problems) errors.push(personWordMessage(`${pack}/${ruleId}`, p));
      continue;
    }

    // NO ABSENCE CLAIM IN THE RULE'S TWO LINES: the finding card's title says what was checked, never that a thing
    // does not exist (the list, what passes, the fix line's reading and the exceptions are in tools/lint-patterns.mjs
    // under THE ABSENCE-CLAIM LINT).
    const absence = lintAbsenceClaims(rule);
    for (const row of absence.excused) {
      absenceExceptionsUsed.set(row.exception, [...(absenceExceptionsUsed.get(row.exception) ?? []), `${pack}/${ruleId}`]);
    }
    if (absence.problems.length > 0) {
      for (const p of absence.problems) errors.push(absenceClaimMessage(`${pack}/${ruleId}`, p));
      continue;
    }
    // NO WORDING A CHECK FOUND WRONG, said again (tools/lint-patterns.mjs, THE CORRECTED-WORDING GUARD).
    const corrected = correctedWordingProblems(stringLeaves(rule), ruleId);
    if (corrected.length > 0) {
      for (const p of corrected) errors.push(`${pack}/${ruleId}: ${p.path} says "${p.phrase}" again, which a check found wrong: ${p.why}`);
      continue;
    }

    // A SHIPPED PROSE FIELD MAY NOT SEND THE READER TO A PRIVATE-WORKSPACE FILE.
    //
    // The recogniser, its two limbs, its one carve-out and the honest statement of what it cannot
    // see all live in `tools/lint-patterns.mjs` under THE WORKSPACE-PATH LINT. It is stated once
    // there and not restated here (never keep a second copy of anything two places must
    // agree on) — this file decides only WHICH DOCUMENTS AND WHICH FIELDS it runs over.
    //
    // FROM 2026-08-25 IT RUNS OVER EVERY STRING LEAF OF THE RULE, not four fields of it. The
    // four-field version was green while the bundle carried 244 path references, because 88 of them
    // sat in `provenance` and `legal_basis[].cite` and 155 sat in checklists, which it never read.
    // `legal_basis[].cite` is the sharp one: `scan.ts` copies the whole cite text into every
    // candidate's `legal_basis_refs`, and the skill hands that to the adjudicating agent — so four
    // rules were citing this workspace's own files as their legal basis, to an agent that cannot
    // open them.
    //
    // ONE EXEMPTION, AND ITS SIZE IS PRINTED EVERY BUILD. `provenance` is the rule's authoring
    // record — who compiled it, who reviewed it, against which eval document — and NOTHING READS IT:
    // no CLI code, no skill, no agent contract, no gate. It is not a promise to the reader, so its
    // 71 workspace paths are a record-hygiene question about whether `provenance` should ship at all,
    // which is the owner's and is deliberately not answered here. The count is reported rather than
    // hidden, because a lint whose exemptions are invisible is the defect it exists to catch, one
    // file up.
    const pathLint = lintWorkspacePaths(rule, {
      label: `${pack}/${ruleId}`,
      resolve: existsInWorkspace,
      exempt: [/^provenance(?:\.|\[|$)/],
    });
    for (const e of pathLint.exempted) exemptedWorkspacePaths.push(`${pack}/${ruleId}: ${e.field} -> ${e.path}`);
    if (pathLint.problems.length) {
      for (const m of pathLint.problems) errors.push(m);
      continue;
    }

    // A SHIPPED PROSE FIELD MAY NOT PROMISE CONTENT THE BUNDLE DOES NOT CARRY, EITHER.
    //
    // The path lint above answers an exact question and is complete for the class it covers. This
    // one is a denylist of shapes found in the bundle on 2026-08-25 — five passages in
    // `recipients-002` and `recipients-004` telling the agent that "their entries say so in a fixed
    // tag" when `rules.json` carries no vendor entries at all — and `lint-patterns.mjs` says in
    // terms that it is a net rather than a decision procedure. It is here because the same sentence
    // came back once already after being repaired in a sibling field.
    let promisesMissingContent = false;
    for (const [path_, text] of stringLeaves(rule)) {
      const promise = text.match(BUNDLE_PROMISE_PATTERN);
      if (promise) {
        errors.push(
          `${pack}/${ruleId}: field ${path_} tells the reader that a per-vendor entry or tag says something ("${promise[0]}"), and the bundle carries no vendor entries — dist/bundle/rules.json has no vendor, receives, jurisdiction or jurisdiction_source key. Give the reader the fact here instead of pointing at an entry they do not have.`,
        );
        promisesMissingContent = true;
      }
    }
    if (promisesMissingContent) continue;

    // Field-scoped CJK lint (governance §11, gate G0). See the comment above `const rules = []` for why this
    // walks fields instead of scanning the file.
    const cjkViolations = cjkLeafHits(rule, `rules/packs/${pack}/${ruleId}/rule.yaml`);
    if (cjkViolations.length > 0) {
      for (const { path, chars } of cjkViolations) {
        const shown = chars.slice(0, 12).join("") + (chars.length > 12 ? "..." : "");
        errors.push(
          `${pack}/${ruleId}: field ${path} contains CJK characters (${shown}) — rule prose is English (the project's English-first rule); CJK is allowed only in legal_basis[].cite and detector patterns`,
        );
      }
      continue;
    }

    // THE KEY-TO-VALUE JOIN LINT (work item #71). A detector that joins a key to its value with a
    // bare `[=:]` cannot read Ruby's `key => value`: the class eats the `=` and nothing skips the
    // `>`, so the pattern never reaches the value and the rule is silent on the construct it was
    // written for. This is a REACH check in the design's sense and it belongs in the build for the
    // reason the whole check exists — the defect is invisible from the output, and it was
    // reintroduced by hand inside a file that already carried the rocket-aware spelling eighteen
    // times. The check, its allowlist and the limits of its scope are all in tools/lint-patterns.mjs.
    const joinViolations = lintRuleJoins(rule);
    if (joinViolations.length > 0) {
      for (const v of joinViolations) errors.push(`${pack}/${v}`);
      continue;
    }

    // THE PATTERN-COMPILE GATE (see the block above the rule loop). Every detector pattern the
    // engine compiles is expanded and compiled HERE, so a pattern that cannot be compiled fails the
    // build naming the rule, the field and the index within that field — rather than shipping and
    // throwing in the user's tree with none of the three. All of a rule's bad patterns are reported,
    // not the first, so an author fixes a rule in one pass.
    if (expandPattern !== null) {
      const patternViolations = lintRulePatterns(rule, expandPattern);
      if (patternViolations.length > 0) {
        for (const v of patternViolations) errors.push(`${pack}/${v}`);
        continue;
      }
    }

    // THE FILE_GLOBS COMPILE GATE (W6, see the block above the rule loop). Every `file_globs`
    // entry is compiled HERE the way `engine.ts` `surfaceAllows` compiles it, so an entry that
    // cannot become a valid glob fails the build naming the rule, the field and the index —
    // rather than shipping and throwing in the user's tree the first time this rule's surface is
    // checked against a file.
    if (compileGlobs !== null) {
      const globViolations = lintRuleFileGlobs(rule, compileGlobs);
      if (globViolations.length > 0) {
        for (const v of globViolations) errors.push(`${pack}/${v}`);
        continue;
      }
    }

    // Every declared jurisdiction must be backed by a legal_basis entry that actually
    // establishes the obligation the rule tests. An entry tagged supports_rule_condition:false
    // is kept for reference (e.g. a personality-rights statute next to a marking-duty rule) but
    // does not count as cover. Without this check a rule can declare reach it cannot source —
    // the W4 review found several, including one wearing a citation that carried no such duty.
    const sourcedJurisdictions = new Set(
      (rule.legal_basis ?? [])
        .filter((b) => b.supports_rule_condition !== false && b.jurisdiction)
        .map((b) => b.jurisdiction),
    );
    const unsourced = (rule.jurisdiction ?? []).filter((j) => !sourcedJurisdictions.has(j));
    if (unsourced.length > 0) {
      errors.push(
        `${pack}/${ruleId}: declares jurisdiction ${unsourced.join(", ")} with no supporting legal_basis entry (tag an entry with that jurisdiction, or drop it from jurisdiction)`,
      );
      continue;
    }

    // THE RULE LINES, checked and moved out (see the import above). The schema requires both on every rule, so a rule
    // with neither is refused there; this block checks the pair.
    const lineFields = (RULE_LINE_FIELDS ?? []).filter((f) => Object.hasOwn(rule, f));
    if (lineFields.length > 0) {
      const complaints = ruleLinesComplaints ? ruleLinesComplaints(rule) : [];
      if (complaints.length > 0) {
        for (const c of complaints) errors.push(`${pack}/${ruleId}: ${c}`);
        continue;
      }
      const { text, template } = rule.problem_line;
      ruleLines[rule.id] = { problem_line: template === undefined ? { text } : { text, template }, fix_line: rule.fix_line };
      for (const f of lineFields) delete rule[f];
    }

    rules.push(rule);
    packCounts.set(pack, (packCounts.get(pack) ?? 0) + 1);
    const js = packJurisdictions.get(pack) ?? new Set();
    for (const j of rule.jurisdiction) js.add(j);
    packJurisdictions.set(pack, js);
  }
}

// THE SHORT NAMES. `short_name` is what the layer-2
// report's first screen and work list call a rule, so two rules sharing one would read as one problem; the schema holds
// each name to 1-60 characters and makes it required, and no two rules may share one. Counted over the rules that
// passed every check above (a rule refused there is already an error).
{
  const byName = new Map();
  for (const r of rules) byName.set(r.short_name, [...(byName.get(r.short_name) ?? []), r.id]);
  for (const [name, ids] of byName) if (ids.length > 1) errors.push(`${ids.join(", ")}: share the short_name "${name}"; each rule's short name must be its own`);
  const missing = rules.filter((r) => typeof r.short_name !== "string" || r.short_name.trim() === "" || r.short_name.length > 60);
  for (const r of missing) errors.push(`${r.pack}/${r.id}: short_name is missing, empty or over 60 characters`);
}

// The corrected-wording guard over the seat and the source that say the same thing as a rule (CORRECTED_WORDING_FILES).
for (const rel of CORRECTED_WORDING_FILES) {
  for (const p of correctedWordingProblems([[rel, readFileSync(join(ROOT, rel), "utf8")]])) {
    errors.push(`${rel} says "${p.phrase}" again, which a check found wrong: ${p.why}`);
  }
}

// A STALE ABSENCE-CLAIM EXCEPTION FAILS THE BUILD. A row of ABSENCE_CLAIM_EXCEPTIONS (tools/lint-patterns.mjs) that
// excused nothing names a line that has changed or a rule that has gone, and left in place it would excuse a later line
// nobody read. Checked only for the real rule tree: a test's own RULES_DIR builds a few rules on purpose.
if (!process.env.RULES_DIR) {
  ABSENCE_CLAIM_EXCEPTIONS.forEach((x, i) => {
    if (!absenceExceptionsUsed.has(i)) {
      errors.push(
        `ABSENCE_CLAIM_EXCEPTIONS (tools/lint-patterns.mjs): the row for ${x.rule} ${x.field} "${x.phrase}" excused no line; ` +
          `remove it, or restore the line it was written for`,
      );
    }
  });
}

// Notice-completeness checklists (pillar 2). Structured law rather than a detector: the items are
// what Articles 13 and 14 require a notice to contain, quoted from the Official Journal, each with
// the question to ask of the document. They ride in the bundle so they are version-pinned and
// integrity-checked exactly like the rules — a checklist is legal content that gets quoted back to
// the user, and it has to be as tamper-evident as a rule is.
//
// The assertion lint exempts `quote` and `cite` for the same reason `legal_basis` is exempt in a
// rule: statutory text legitimately uses the vocabulary the lint bans. Nothing else is exempt, and
// unlike a rule there is no CJK exemption at all — these quotations are English.
const checklists = [];
// Statute quoted verbatim is exempt from the no-assertion lint for the obvious reason: the law does
// assert things, and softening its words would be the actual error. The exemption is field-scoped,
// never file-scoped — the same discipline the CJK lint needed.
const CHECKLIST_ASSERTION_EXEMPT = [
  /^items\[\d+\]\.(quote|cite)$/,
  /^applicability\.(quote|cite)$/,
];

/**
 * One instrument's name, reduced to what identifies the instrument. Case is folded and every run of
 * characters that is not a letter, a digit or `/` becomes one space, so "Regulation (EU) 2024/2847
 * (Cyber Resilience Act)" and "Regulation EU 2024/2847 - Cyber Resilience Act" are the same
 * instrument and a bracket is not. Nothing is dropped: the WORDS still have to match. That is
 * deliberate, and it is not brittleness — it is what makes an instrument have one name in this
 * repository. Used by the gate/checklist instrument check below.
 */
const normaliseInstrument = (s) =>
  String(s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}/]+/gu, " ")
    .trim();

/* --------------------------------------------------------------------- *
 * Shared applicability gates (rules/gates/<gate_id>.yaml).
 * --------------------------------------------------------------------- *
 *
 * A gate is one instrument's scope test, authored once and named by more than one checklist through
 * `applicability_ref`. The Cyber Resilience Act forced it: Article 2(1) decomposes into 37 limbs and
 * 50 supporting quotes, and four CRA rows ask that question identically, so the alternative was four
 * copies of ~3,500 lines of YAML. `product/packages/cli/src/scope.ts` records what copies cost here
 * — twenty-one gate defects found in one day on 2026-07-29, four of them one fact written in two
 * places that then disagreed.
 *
 * **Resolution happens HERE, before validation and before the bundle is written**, and every other
 * option was worse. The gate is spliced in
 * as a full `applicability` object, so `checklists.json` carries gates inlined, the manifest hashes
 * the limbs rather than a pointer, and `bundle.ts`, `scan.ts`, `scope.ts` and every bundle-side
 * schema are untouched — they never learn that a reference existed. Resolving later would put a
 * pointer where four consumers read `gate.limbs` directly and treat an empty one as "skip this
 * checklist" (`scope.ts:215-220`, a test, `:1309`, `:1631`), so an
 * unresolved pointer would take a whole instrument off every scanned project in silence.
 *
 * **That is also why an unresolvable reference is a build failure and never a skip.** The failure
 * mode this guards against is invisible by construction: nothing downstream can tell a checklist
 * whose gate went missing from a checklist that never had one. A test
 * pins it.
 */
const gates = new Map(); // gate_id -> the validated gate document
const gateIdsOnDisk = new Set(); // every gate_id a file claimed, whether or not it validated

if (existsSync(GATES_DIR)) {
  const gateFiles = readdirSync(GATES_DIR).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  if (gateFiles.length > 0 && !existsSync(GATE_SCHEMA_PATH)) {
    errors.push(
      `rules/gates holds ${gateFiles.length} file(s) but ${GATE_SCHEMA_PATH} is missing — a gate that is not validated must not be spliced into a checklist`,
    );
  } else if (gateFiles.length > 0 && !existsSync(CHECKLIST_SCHEMA_PATH)) {
    errors.push(
      `rules/gates holds ${gateFiles.length} file(s) and ${CHECKLIST_SCHEMA_PATH} is missing — the gate schema imports its body from the checklist schema and cannot be compiled without it`,
    );
  } else if (gateFiles.length > 0) {
    const gateSchemaDoc = JSON.parse(readFileSync(GATE_SCHEMA_PATH, "utf8"));

    // THE DRIFT GUARD. The gate body is imported from checklist.schema.json, not copied into
    // gate.schema.json, so there is one definition of a gate in this repository and the two files
    // cannot disagree about what a limb is. That property is worth exactly as much as the $ref that
    // creates it, so the $ref itself is asserted: replacing it with an inline copy — the change that
    // would silently make drift possible again — fails the build here rather than passing quietly
    // and diverging over the following weeks. This is the project's standing rule ("never keep a
    // second copy of anything two places must agree on — export it and import it") made mechanical.
    const gateBodyRef = `${checklistSchema().$id}#/$defs/applicability`;
    if (gateSchemaDoc.properties?.applicability?.$ref !== gateBodyRef) {
      errors.push(
        `gate.schema.json no longer imports the gate body from the checklist schema: properties.applicability.$ref is ${JSON.stringify(gateSchemaDoc.properties?.applicability?.$ref ?? null)}, expected ${JSON.stringify(gateBodyRef)}. One definition of a gate, referenced — an inline copy here would drift from checklist.schema.json and both files describe the same object`,
      );
    }

    const validateGate = ajv.compile(gateSchemaDoc);
    for (const file of gateFiles.sort()) {
      let gate;
      try {
        gate = parseYaml(readFileSync(join(GATES_DIR, file), "utf8"));
        stripShippedRecordMarkers(gate);
      } catch (e) {
        errors.push(`gates/${file}: ${/^record markers:/.test(e.message) ? "" : "YAML parse error: "}${e.message}`);
        continue;
      }
      // Recorded before validation so that a checklist naming a gate that exists and is broken gets
      // told which of the two it is. "No such gate" and "that gate did not validate" send an author
      // to different files.
      if (typeof gate?.gate_id === "string") gateIdsOnDisk.add(gate.gate_id);
      if (!validateGate(gate)) {
        for (const err of validateGate.errors ?? []) {
          errors.push(`gates/${file}: ${err.instancePath || "/"} ${err.message}`);
        }
        continue;
      }
      const expectedName = `${gate.gate_id}.yaml`;
      if (file !== expectedName) {
        errors.push(`gates/${file}: gate_id is ${gate.gate_id}, so the file must be named ${expectedName}`);
        continue;
      }
      // Kept, and unreachable as the two checks stand: a second file claiming an already-taken
      // gate_id cannot also be named <gate_id>.yaml, because the first file has that name, so the
      // filename check above always fires first and this message has never been printed. Recorded
      // here rather than deleted so that nobody later reads it as evidence of a check that has run,
      // and so that it is still standing if the filename rule is ever relaxed.
      if (gates.has(gate.gate_id)) {
        errors.push(`gates/${file}: gate_id ${gate.gate_id} is already declared by another file — a reference must name exactly one gate`);
        continue;
      }

      // The same three prose lints the checklists get, run on the gate in its own right. A gate that
      // no checklist references reaches no bundle and would otherwise be linted by nothing; a gate
      // that IS referenced is linted twice, once here and once as part of the checklist it was
      // spliced into, which costs a duplicate message on failure and buys no hole. The exemption
      // paths need no adjustment because the gate's body is under the key `applicability`, exactly
      // as it is in a checklist.
      let gateFailed = false;
      for (const [path_, text] of stringLeaves(gate)) {
        // The two phrase lints match the text with its whitespace folded, as the rule text above is. The CJK lint below reads the raw text: `\s` includes the ideographic space.
        const folded = foldWhitespace(text);
        if (INJECTION_PATTERN.test(folded)) {
          errors.push(`gates/${file}: field ${path_} contains an instruction-override pattern`);
          gateFailed = true;
          break;
        }
        if (!CHECKLIST_ASSERTION_EXEMPT.some((re) => re.test(path_))) {
          const assertion = folded.match(ASSERTION_PATTERN);
          if (assertion) {
            errors.push(
              `gates/${file}: field ${path_} asserts legality ("${assertion[0]}") — a gate asks whether the instrument reaches this project, never whether the project meets a standard`,
            );
            gateFailed = true;
            break;
          }
        }
      }
      // The CJK lint, from the one exemption list (tools/lint-patterns.mjs, `cjkLeafHits`; a gate has no exemption), keys included.
      for (const { path: path_, chars } of gateFailed ? [] : cjkLeafHits(gate, `rules/gates/${file}`).slice(0, 1)) {
        errors.push(
          `gates/${file}: field ${path_} contains CJK characters (${chars.slice(0, 12).join("")}) — gate prose and its quotations are English (the project's English-first rule)`,
        );
        gateFailed = true;
      }
      if (gateFailed) continue;

      // The person-facing word lint, on the gate in its own right, like the three prose lints above.
      // Not tallied here: a referenced gate's text is tallied once per checklist that carries it,
      // below, because that is how often it ships.
      const gateWords = lintPersonFacingWords(gate, PERSON_WORD_PATHS.checklist);
      if (gateWords.problems.length > 0) {
        for (const p of gateWords.problems) errors.push(personWordMessage(`gates/${file}`, p));
        continue;
      }

      // The workspace-path lint, over every string leaf of the gate. A gate is inlined whole into
      // every checklist that references it, so one path written here reaches the user's agent once
      // per referencing checklist — `rules/gates/cra-scope.yaml` carried 40 of them on 2026-08-25
      // and three CRA checklists tripled them into 120 of the bundle's 244. No field exemption: a
      // gate is all prose and quotations, and every leaf of it is read by an agent.
      const gatePathLint = lintWorkspacePaths(gate, {
        label: `gates/${file}`,
        resolve: existsInWorkspace,
      });
      if (gatePathLint.problems.length) {
        for (const m of gatePathLint.problems) errors.push(m);
        continue;
      }

      gates.set(gate.gate_id, gate);
    }
  }
}

if (existsSync(CHECKLISTS_DIR)) {
  const files = readdirSync(CHECKLISTS_DIR).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  if (files.length > 0 && !existsSync(CHECKLIST_SCHEMA_PATH)) {
    errors.push(
      `rules/checklists holds ${files.length} file(s) but ${CHECKLIST_SCHEMA_PATH} is missing — a checklist that is not validated must not ship`,
    );
  } else {
    if (files.length) checklistSchema();
    for (const file of files.sort()) {
      const path = join(CHECKLISTS_DIR, file);
      let checklist;
      try {
        checklist = parseYaml(readFileSync(path, "utf8"));
        stripShippedRecordMarkers(checklist);
      } catch (e) {
        errors.push(`checklists/${file}: ${/^record markers:/.test(e.message) ? "" : "YAML parse error: "}${e.message}`);
        continue;
      }

      // Splice a shared gate in, in the position the reference occupied, BEFORE validation and
      // before any lint. Two consequences, both wanted: the schema then judges the assembled
      // checklist exactly as it judges a checklist that carries its gate inline, so the gate is not
      // validated by a weaker rule for being shared; and the prose lints below walk the gate's own
      // strings, so gate prose is held to the same English/no-assertion/no-injection standard as the
      // checklist that ships it.
      //
      // The object is REBUILT rather than mutated, so `applicability` lands where `applicability_ref`
      // sat. `JSON.stringify` writes keys in insertion order, and assigning the key would append it
      // after `items` — the bundle would then differ byte for byte from the one this refactor is
      // required to reproduce exactly, for no reason anyone could see in a diff of the YAML.
      if (checklist !== null && typeof checklist === "object" && "applicability_ref" in checklist) {
        const ref = checklist.applicability_ref;
        if ("applicability" in checklist) {
          errors.push(
            `checklists/${file}: carries both an inline applicability and applicability_ref (${JSON.stringify(ref)}) — a checklist has exactly one gate, and which of the two is the instrument's scope test cannot be decided here`,
          );
          continue;
        }
        const gate = typeof ref === "string" ? gates.get(ref) : undefined;
        if (!gate) {
          const reason = typeof ref !== "string"
            ? "applicability_ref must be a gate_id string"
            : gateIdsOnDisk.has(ref)
              ? `rules/gates/${ref}.yaml exists and did not validate — see the gate errors above`
              : `no such gate: rules/gates/${ref}.yaml does not exist`;
          errors.push(
            `checklists/${file}: applicability_ref ${JSON.stringify(ref)} could not be resolved (${reason}). A checklist whose gate cannot be found is NOT shipped without one: every consumer reads a gate with no limbs as a gate to skip, so this would take ${checklist.checklist_id ?? file} off every scanned project with nothing failing`,
          );
          continue;
        }

        // THE TWO FILES MUST NAME THE SAME INSTRUMENT.
        //
        // A gate is ONE instrument's scope test and it gates that instrument's checklists only.
        // gate.schema.json has said so on `law` since the day gates were added — "Named here as well
        // as on each referencing checklist so that a gate cannot be pointed at a checklist from
        // another instrument without the disagreement being visible in both files" — and until
        // 2026-08-04 no code read either field. It was measured end to end: a checklist declaring
        // `law: Regulation (EU) 2022/2065 (Digital Services Act)` with `applicability_ref:
        // cra-scope` built with exit 0, passed gate resolution and quote verification, and shipped
        // in dist/bundle/checklists.json carrying the Cyber Resilience Act's Article 2(1) test and
        // all 37 of its limbs. A reader of that bundle is told the Digital Services Act does or does
        // not reach their project on the strength of whether they manufacture a product with digital
        // elements.
        //
        // The refactor is what makes the guard necessary. While the gate lived inside the checklist,
        // pointing one instrument's checklist at another's scope test meant copying ~3,500 lines of
        // that instrument's text into the file, which no diff could hide. Now it is one line and one
        // word, and the three further CRA checklists this mechanism was built for will each
        // hand-type an `applicability_ref` beside a hand-typed `law`.
        //
        // TWO fields are compared, because they fail differently:
        //
        //   `law` is the human-readable name and the field the schema points at. It is compared
        //   normalised (see normaliseInstrument), so punctuation and spacing cannot make two
        //   spellings of one instrument look like two instruments. Word-for-word agreement after
        //   that is required, and the corpus says that costs nothing: the four AI Act checklists,
        //   the three Data Act checklists and the three Digital Services Act checklists already
        //   carry byte-identical `law` strings today.
        //
        //   `source_url` is the document the quotes were actually taken from, and it is the field an
        //   author cannot quietly retype to make a disagreement go away. A check
        //   records it in the receipt and fails offline when the file names a different source from
        //   the one the receipt was written against, so editing it to force agreement breaks quote
        //   verification until every quote is relocated in the new document. Prose can be edited
        //   into agreement; a pinned source cannot.
        //
        // A blank name is not agreement, so an empty `law` on either side is a mismatch rather than
        // a match of two empty strings. Both fields are reported rather than the first, because an
        // author who mistyped one wants to know whether the other is wrong too. This fails the
        // build and the checklist is not shipped: a checklist carrying the wrong instrument's scope
        // test is worse than one carrying none, because it answers.
        const checklistLaw = normaliseInstrument(checklist.law);
        const gateLaw = normaliseInstrument(gate.law);
        const disagreements = [];
        if (checklistLaw === "" || gateLaw === "" || checklistLaw !== gateLaw) {
          disagreements.push(
            `law: the checklist declares ${JSON.stringify(checklist.law ?? null)} and rules/gates/${ref}.yaml declares ${JSON.stringify(gate.law ?? null)}`,
          );
        }
        if (checklist.source_url !== gate.source_url) {
          disagreements.push(
            `source_url: the checklist names ${JSON.stringify(checklist.source_url ?? null)} and rules/gates/${ref}.yaml names ${JSON.stringify(gate.source_url ?? null)}`,
          );
        }
        if (disagreements.length > 0) {
          errors.push(
            `checklists/${file}: applicability_ref ${JSON.stringify(ref)} names a gate for a DIFFERENT INSTRUMENT — ${disagreements.join("; ")}. A gate is one instrument's scope test and gates only that instrument's checklists, so shipping this would put one instrument's scope question in front of another instrument's items and report the answer as if it decided them. Point ${checklist.checklist_id ?? file} at its own instrument's gate; or, if the two really are the same instrument, spell the disagreeing field identically in rules/checklists/${file} and rules/gates/${ref}.yaml`,
          );
          continue;
        }

        const resolved = {};
        for (const [key, value] of Object.entries(checklist)) {
          if (key === "applicability_ref") resolved.applicability = gate.applicability;
          else resolved[key] = value;
        }
        checklist = resolved;
      }

      if (!validateChecklist(checklist)) {
        for (const err of validateChecklist.errors ?? []) {
          errors.push(`checklists/${file}: ${err.instancePath || "/"} ${err.message}`);
        }
        continue;
      }
      const expected = `${checklist.checklist_id}.yaml`;
      if (file !== expected) {
        errors.push(`checklists/${file}: checklist_id is ${checklist.checklist_id}, so the file must be named ${expected}`);
        continue;
      }

      const leaves = stringLeaves(checklist);
      let failed = false;
      for (const [path_, text] of leaves) {
        // The two phrase lints match the text with its whitespace folded, as the rule text is.
        // The CJK lint below reads the raw text: `\s` includes the ideographic space.
        const folded = foldWhitespace(text);
        if (INJECTION_PATTERN.test(folded)) {
          errors.push(`checklists/${file}: field ${path_} contains an instruction-override pattern`);
          failed = true;
          break;
        }
        if (!CHECKLIST_ASSERTION_EXEMPT.some((re) => re.test(path_))) {
          const assertion = folded.match(ASSERTION_PATTERN);
          if (assertion) {
            errors.push(
              `checklists/${file}: field ${path_} asserts legality ("${assertion[0]}") — a checklist item asks whether the notice contains something, never whether the service meets a standard`,
            );
            failed = true;
            break;
          }
        }
      }
      // The CJK lint, from the one exemption list (tools/lint-patterns.mjs, `cjkLeafHits`; a checklist has no exemption), keys included.
      for (const { path: path_, chars } of failed ? [] : cjkLeafHits(checklist, `rules/checklists/${file}`).slice(0, 1)) {
        errors.push(
          `checklists/${file}: field ${path_} contains CJK characters (${chars.slice(0, 12).join("")}) — checklist prose and its quotations are English (the project's English-first rule)`,
        );
        failed = true;
      }
      if (failed) continue;

      // The person-facing word lint, over the resolved checklist, gate included. A limb's question,
      // the instrument's name and the gate's citation are printed to the person by `scan` and
      // `reconcile` and in the report's applicability block.
      const checklistWords = lintPersonFacingWords(checklist, PERSON_WORD_PATHS.checklist);
      for (const kind of ["quoted", "notCopied", "verbatim"]) {
        for (const row of checklistWords[kind]) personWordTally[kind].push({ where: `checklists/${file}`, ...row });
      }
      if (checklistWords.problems.length > 0) {
        for (const p of checklistWords.problems) errors.push(personWordMessage(`checklists/${file}`, p));
        continue;
      }

      // The workspace-path lint, over every string leaf of the resolved checklist — gate included,
      // since resolution has already happened above and what is linted here is what ships.
      //
      // THIS IS THE HALF THAT REACHES AN AGENT UNCONDITIONALLY. `reconcile.ts` copies every
      // checklist verbatim into `reconcile-input.json`, and `skills/declaration-reconcile/SKILL.md`
      // tells the agent to walk *every checklist in `checklists[]` — including the ones that do not
      // apply* and to read its `limbs` and its `when_unresolved` before answering. Measured on
      // 2026-08-25 by running `npm run reconcile:target`: 155 workspace-path references were present
      // in the produced document, 73 of them naming files that never ship, and the build was green
      // because no checklist field was linted at all.
      const checklistPathLint = lintWorkspacePaths(checklist, {
        label: `checklists/${file}`,
        resolve: existsInWorkspace,
      });
      if (checklistPathLint.problems.length) {
        for (const m of checklistPathLint.problems) errors.push(m);
        continue;
      }

      const ids = checklist.items.map((i) => i.id);
      const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
      if (duplicates.length > 0) {
        errors.push(`checklists/${file}: duplicate item id(s): ${[...new Set(duplicates)].join(", ")}`);
        continue;
      }

      checklists.push(checklist);
    }
  }
}

/**
 * THE PENALTY-TIER TABLE (rules/penalty-tiers/penalty-tiers.yaml), H5a stage 1: for every regime the rules cite, which
 * provisions sit in its top penalty tier and which in a lower one, each line quoting the penalty article (receipts:, step test:quotes). The report assembly reads it from the bundle as `penalty-tiers.json`,
 * hashed into `manifest.files`, through `product/packages/cli/src/penalty-tier.ts`, and never from `rules/`.
 *
 * Three checks, each a build error:
 *   - the table has the shape the resolver reads (`penaltyTableShapeProblems`);
 *   - EVERY legal_basis cite of every rule in this bundle resolves to exactly one answer (`penaltyTierCoverage`), so a new
 *     rule with a cite no line covers cannot land silently, and no cite resolves while a reference of its own regime
 *     that its heading names goes unread (`unreadReferences`: the reader's grammar is fixed, so a phrasing it does not
 *     know fails here instead of resolving by the provisions before it). The error names the rule id, the cite and the
 *     unread reference. Applied when the build reads this repository's own rules; a build over RULES_DIR (a test's
 *     fixture rules, whose cites are probes with no legal content) writes the table without it;
 *   - the table answers the legal cases the design fixes (H5a section 6.1, T11), and the provisions each tier line names
 *     agree with the article numbers its own quotation names (`penaltyTierSelfTest` below). The second catches a
 *     provision added to a tier its quotation does not name; it does NOT catch a closed list that misses a point,
 *     because a line cut short in both its quotation and its provisions agrees with itself (legal check of
 *     2026-10-28, attack 5). That class is held by the step test:quotes, which compares every tier line with its
 *     penalty paragraph as fetched from the official text (`closedListProblems` in the quotation tool). It sits there
 *     and not here because the paragraphs live in the quotation receipt, which the public tree leaves out. What the table
 *     DOES with those lists is held here (`penaltyTableGuardProblems`): every line of a list carries the tier the list
 *     declares, every provision a line holds resolves through that line, no line read before the tier lines reaches
 *     into a list, and every carried duty quotes what it carries and ends in a duty; each guard is shown to refuse a
 *     copy of the table with the change it exists to refuse.
 */
const PENALTY_TIERS_DIR = process.env.PENALTY_TIERS_DIR ? resolve(process.env.PENALTY_TIERS_DIR) : join(ROOT, "rules", "penalty-tiers");
const PENALTY_TIERS_SOURCE = join(PENALTY_TIERS_DIR, "penalty-tiers.yaml");
let penaltyTiersJson = null;
{
  const tierModule = await import(pathToFileURL(join(ROOT, "product/packages/cli/dist/penalty-tier.js")).href);
  let table = null;
  try {
    table = parseYaml(readFileSync(PENALTY_TIERS_SOURCE, "utf8"));
    stripShippedRecordMarkers(table);
  } catch (e) {
    errors.push(`penalty-tiers: ${PENALTY_TIERS_SOURCE} cannot be read (${e.message}); the report's order needs it in every bundle`);
  }
  if (table !== null) {
    // The CJK lint, from the one exemption list the public self-scan uses (tools/lint-patterns.mjs, `cjkLeafHits`): a
    // statute's own words in `penalty_quotes[].quote` may stay in the original language, and no other field of the table.
    for (const { path, chars } of cjkLeafHits(table, "rules/penalty-tiers/penalty-tiers.yaml")) {
      errors.push(`penalty-tiers: field ${path} contains CJK characters (${chars.slice(0, 12).join("")}) — the table's prose is English (the project's English-first rule); CJK is allowed only in penalty_quotes[].quote, a statute's own words`);
    }
    const shape = tierModule.penaltyTableShapeProblems(table);
    for (const p of shape) errors.push(`penalty-tiers: ${p}`);
    if (shape.length === 0) {
      for (const p of penaltyTierSelfTest(tierModule, table)) errors.push(`penalty-tiers: ${p}`);
      // A law's full name from one source each (17 Nov, d2, d3).
      // Every abbreviated regime named where the build reads this repository's checklists, which complete the table's
      // names; a harness's own or empty CHECKLISTS_DIR (a rules-only bundle, rules-side.mjs) cannot have them.
      const ownChecklists = resolve(CHECKLISTS_DIR) === resolve(join(ROOT, "rules", "checklists"));
      for (const p of tierModule.lawNameProblems(table, checklists, ownChecklists)) errors.push(`penalty-tiers: ${p}`);
      if (!process.env.RULES_DIR) {
        for (const p of tierModule.penaltyTierCoverage(rules, table)) errors.push(`penalty-tiers: ${p}`);
      }
      penaltyTiersJson = JSON.stringify(table, null, 2);
    }
  }
}

/** The legal cases of H5a section 6.1 T11 and section 3.1, the coverage check's own refusal, and the agreement of each
 * tier line's provisions with its quotation. Returns problems; empty when the table answers as the law reads. */
function penaltyTierSelfTest(m, table) {
  const out = [];
  const expect = (cite, tier, extra = {}) => {
    const r = m.tierOfBasis(cite, "EU", table);
    if (r.tier !== tier) out.push(`self-test: ${JSON.stringify(cite)} resolves to ${r.tier} (${r.line}), the law puts it at ${tier}`);
    for (const [k, v] of Object.entries(extra)) {
      if (r[k] !== v) out.push(`self-test: ${JSON.stringify(cite)} gives ${k} ${JSON.stringify(r[k])}, expected ${JSON.stringify(v)}`);
    }
  };
  expect("AI Act (Regulation (EU) 2024/1689), Art. 6(4)", "not_top", { regime: "AI Act", penaltyCite: "AI Act Art 99(1), as replaced by Regulation (EU) 2026/1744 Art 1 point (38)(a)", appliesFrom: "2027-12-02" });
  expect("AI Act Art. 49(2)", "not_top");
  expect("GDPR Art. 10", "not_top", { penaltyCite: "GDPR Art 84(1)" });
  expect("GDPR Art. 24(1)", "not_top");
  expect("Digital Services Act, Art. 16(1)", "top", { tiered: true, penaltyCite: "DSA Art 52(3), first sentence" });
  expect("Regulation (EU) 2022/2065, Art. 52(3)", "top");
  expect("Data Act (Regulation (EU) 2023/2854), Art. 4(1)", "top", { tiered: false });
  expect("Data Act (Regulation (EU) 2023/2854), Art. 25", "top");
  expect("GDPR (Regulation (EU) 2016/679), Art. 4(4)", "no_duty");
  expect("GDPR Recital 26", "no_duty");
  expect("CRA Art. 18", "not_top", { penaltyCite: "CRA Art 64(3)" });
  expect("Cyber Resilience Act (Regulation (EU) 2024/2847), Art. 53", "not_top");
  expect("CRA Art. 30", "not_top");
  expect("Cyber Resilience Act (Regulation (EU) 2024/2847), Annex I, Part I", "top", { penaltyCite: "CRA Art 64(2)", appliesFrom: "2027-12-11" });
  expect("Cyber Resilience Act (Regulation (EU) 2024/2847), Art. 13(8)", "top");
  expect("CRA Art. 14(1)", "top");
  expect("CRA Art. 24(1)", "not_top", { penaltyCite: "CRA Art 64(1)" });
  // Art 24(3) carries Art 14(1)'s duty, so it takes Art 14(1)'s tier; Art 24 without a paragraph takes the heavier (E7).
  expect("CRA Art. 24(3)", "top", { penaltyCite: "CRA Art 64(2), through Art 24(3)", line: "cra/cra-24-3 -> cra/cra-64-2" });
  expect("CRA Art. 24", "top");
  expect("AI Act Art. 25(2)", "not_top", { penaltyCite: "AI Act Art 99(4)(da), inserted by Regulation (EU) 2026/1744 Art 1 point (38)(b)" });
  expect("AI Act Art. 25(4)", "not_top", { penaltyCite: "AI Act Art 99(4)(da), inserted by Regulation (EU) 2026/1744 Art 1 point (38)(b)" });
  expect("AI Act (Regulation (EU) 2024/1689), Art. 5(1)(e)", "top", { penaltyCite: "AI Act Art 99(3)" });
  expect("AI Act Art. 50(2)", "not_top");
  for (const a of ["5(1)(a)", "6(1)", "7(3)", "9(1)", "12(1)", "13", "17(1)", "21(1)", "22(1)", "44", "46(1)", "49(1)"]) expect(`GDPR Art. ${a}`, "top");
  for (const a of ["25(1)", "25(2)", "32(1)(b)", "32", "8(1)", "30(1)(d)"]) expect(`GDPR Art. ${a}`, "not_top");
  expect("NATIONAL AGE - AT 14. Derogation: YES.", "not_top", { regime: "GDPR", penaltyCite: "GDPR Art 83(4)(a)" });
  expect("EDPB Guidelines 05/2020 on consent under Regulation 2016/679", "no_duty");
  expect("Some Unknown Act, Sec. 1", "top", { unresolved: true });
  // The legal check of 2026-10-28. A cite is read by every provision its heading names, and the heaviest decides
  // (each of these resolved no_duty from its first provision alone before that check).
  expect("GDPR Art. 4(11) and Art. 7 (definition of consent; conditions for valid consent)", "top", { penaltyCite: "GDPR Art 83(5)(a)", provision: "7" });
  expect("Cyber Resilience Act (Regulation (EU) 2024/2847), Recital 56, Art. 13(4) and Annex I Part I point (2)(c) - the automatic-update limb of Annex I Part II point (7)", "top", { penaltyCite: "CRA Art 64(2)", appliesFrom: "2027-12-11" });
  expect("General Data Protection Regulation, Regulation (EU) 2016/679, Art. 4(1) and Art. 11 - what the detector may not decide", "not_top", { penaltyCite: "GDPR Art 83(4)(a)", provision: "11" });
  // Points that apply later are read as such, and a cite mixing them with a duty in force says which part is later.
  expect("EU AI Act (Regulation (EU) 2024/1689), Art. 5(1), first subparagraph, points (ba) and (bb), read with Art. 5(1a) and Art. 5(1b), all inserted by Art. 1(7) of Regulation (EU) 2026/1744", "top", { appliesFrom: "2026-12-02" });
  {
    const r = m.tierOfBasis("AI Act Art. 5(1)(a) and Art. 5(1)(ba)", "EU", table);
    const later = JSON.stringify(r.appliesLater);
    if (r.appliesFrom !== undefined || later !== JSON.stringify([{ provision: "5(1)(ba)", appliesFrom: "2026-12-02" }])) {
      out.push(`self-test: a cite of a prohibition in force with one applying later gives appliesFrom ${JSON.stringify(r.appliesFrom)} and appliesLater ${later}`);
    }
  }
  expect("GDPR Art. 4(11) and Recital 32, read into Art. 13(1) of Directive 2002/58/EC", "no_duty");
  // Paragraphs that lay down duties take their tier.
  expect("Directive (EU) 2019/882 Art. 14(1)", "no_duty");
  expect("Directive (EU) 2019/882 Art. 14(2)", "top");
  expect("Directive (EU) 2019/882 Art. 14(8)", "top");
  expect("EU AI Act (Regulation (EU) 2024/1689), Art. 111(4), added by Art. 1(39)(b) of Regulation (EU) 2026/1744", "not_top", { penaltyCite: "AI Act Art 99(4)(g), through Art 111(4)", appliesFrom: "2026-12-02" });
  expect("AI Act Art. 113", "no_duty");
  // A classification provision lays down no duty; the provider's own duty in Art 6(4) keeps its tier (above).
  expect("AI Act (Regulation (EU) 2024/1689), Art. 6(1)(a) and (b)", "no_duty");
  const refused = m.penaltyTierCoverage([{ id: "probe-untiered", legal_basis: [{ cite: "Some Unknown Act, Sec. 1", jurisdiction: "EU" }] }], table);
  if (!(refused.length === 1 && refused[0].includes("probe-untiered") && refused[0].includes("Some Unknown Act, Sec. 1"))) {
    out.push(`self-test: the coverage check does not refuse an untiered cite by rule id and cite (${JSON.stringify(refused)})`);
  }
  // The re-check of 2026-10-28: phrasings the reader stopped at without a word, each naming a top-tier duty after a
  // definition; and a provision of another instrument named after "of the ...".
  expect("GDPR Art. 4(11) and 7", "top", { provision: "7" });
  expect("GDPR Art. 4(11), 6 and 7", "top", { provision: "6" });
  expect("GDPR Recitals 32 and 42 and Art. 7", "top", { provision: "7" });
  expect("GDPR Art. 4(11) and, for consent, Art. 7", "top", { provision: "7" });
  expect("GDPR Art. 4(11) & Art. 6", "top", { provision: "6" });
  expect("GDPR Art. 4(11) plus Art. 6", "top", { provision: "6" });
  expect("GDPR Art. 4(11) and also Art. 7", "top", { provision: "7" });
  expect("GDPR Art. 24 and 25; GDPR Art. 30 to 32", "not_top");
  expect("GDPR Art. 4(11) and Art. 7 of the GDPR", "top", { provision: "7" });
  for (const other of ["Art. 13(1) of the ePrivacy Directive", "Art. 3 of the Data Act", "Art. 14 of the e-Commerce Directive"]) {
    expect(`GDPR Art. 4(11) and ${other}`, "no_duty", { provision: "4(11)" });
  }
  expect("Data Act (Regulation (EU) 2023/2854), Art. 2(8) and Recitals 80 and 81 - a probe", "no_duty");
  {
    const r = m.tierOfBasis("GDPR Recitals 32 and 42 and Art. 7", "EU", table);
    if (JSON.stringify(r.provisions) !== JSON.stringify(["Recital 32", "Recital 42", "7"])) out.push(`self-test: "Recitals 32 and 42 and Art. 7" reads ${JSON.stringify(r.provisions)}`);
  }
  // A phrasing the reader does not know is refused by the coverage check, naming the rule, the cite and what was unread.
  {
    const cite = "GDPR Art. 4(11), see also Art. 7";
    const got = m.penaltyTierCoverage([{ id: "probe-unread", legal_basis: [{ cite, jurisdiction: "EU" }] }], table);
    if (!(got.length === 1 && got[0].includes("probe-unread") && got[0].includes(cite) && got[0].includes('"Art. 7"'))) {
      out.push(`self-test: the coverage check does not refuse a cite whose heading names a provision the reader did not read (${JSON.stringify(got)})`);
    }
  }
  // A penalty paragraph cited beside a duty is not a duty in force; the transitional dates of Art 111; a CRA annex
  // reached through Art 13 takes the heavier reading.
  expect("AI Act Art. 5(1)(ba) and Art. 99(3)", "top", { appliesFrom: "2026-12-02", appliesLater: undefined });
  expect("AI Act Art. 111(1)", "not_top", { appliesFrom: "2030-12-31" });
  expect("AI Act Art. 111(2)", "not_top", { appliesFrom: "2030-08-02" });
  expect("AI Act Art. 111(3)", "not_top", { appliesFrom: "2027-08-02" });
  expect("CRA Annex V", "top", { penaltyCite: "CRA Art 64(2), through Art 13(12)" });
  expect("CRA Annex VII", "top", { penaltyCite: "CRA Art 64(2), through Art 13(4) and 13(8)" });
  for (const p of m.penaltyTableGuardProblems(table)) out.push(`table guard: ${p}`);
  // The table guards must still see what they exist to see: each case is a copy of this table with one
  // change the law does not allow, and each must be refused. Derived from the table where it can be, so a new closed list
  // is covered the day it is declared.
  const regimeOf = (t, id) => t.regimes.find((r) => r.id === id);
  const mutated = (label, change) => {
    const t = structuredClone(table);
    change(t);
    if (m.penaltyTableGuardProblems(t).length === 0) out.push(`self-test: the table guard does not refuse a table with ${label}`);
    return t;
  };
  for (const regime of table.regimes) {
    for (const line of regime.tiers ?? []) {
      if (typeof line.point !== "string" || (line.provisions ?? []).length === 0) continue;
      const first = line.provisions[0].replace(/-.*$/, "");
      mutated(`${line.id}'s tier flipped`, (t) => {
        const l = regimeOf(t, regime.id).tiers.find((x) => x.id === line.id);
        l.tier = l.tier === "top" ? "not_top" : "top";
      });
      mutated(`a no_duty line over ${regime.id} Art ${first}`, (t) => (regimeOf(t, regime.id).no_duty ??= []).push({ provisions: [first], why: "probe" }));
      mutated(`a carried line over ${regime.id} Art ${first}`, (t) =>
        (regimeOf(t, regime.id).carried_duties ??= []).push({ id: "probe", provisions: [first], duty: first, quote: `Article ${first}` }),
      );
    }
  }
  mutated("a no_duty line over GDPR Art 18", (t) => regimeOf(t, "gdpr").no_duty.push({ provisions: ["18"], why: "probe" }));
  mutated("carried lines GDPR Art 45 -> Art 30 and AI Act Art 5(1)(h) -> Art 50", (t) => {
    (regimeOf(t, "gdpr").carried_duties ??= []).push({ id: "probe-45", provisions: ["45"], duty: "30", quote: "Article 30" });
    regimeOf(t, "ai-act").carried_duties.push({ id: "probe-5-1-h", provisions: ["5(1)(h)"], duty: "50", quote: "Article 50" });
  });
  mutated("a carried line whose quotation does not name its duty", (t) => regimeOf(t, "cra").carried_duties.push({ id: "probe", provisions: ["25"], duty: "24(3)", quote: "Article 24" }));
  mutated("a carried line with no quotation", (t) => regimeOf(t, "cra").carried_duties.push({ id: "probe", provisions: ["25"], duty: "24(3)" }));
  mutated("two carried lines in a loop", (t) =>
    regimeOf(t, "cra").carried_duties.push(
      { id: "probe-a", provisions: ["25"], duty: "26", quote: "Article 26" },
      { id: "probe-b", provisions: ["26"], duty: "25", quote: "Article 25" },
    ),
  );
  // The marks that the Member States lay down the penalties are what the report's
  // words say of the law: each is held to its quotation, and a quotation that says so must be marked.
  mutated("an unlisted line marked member_states whose quotation leaves nothing to the Member States", (t) => (regimeOf(t, "gdpr").unlisted.quote = "probe"));
  mutated("an unlisted national-penalty line left unmarked", (t) => delete regimeOf(t, "cra").unlisted.member_states);
  mutated("a member_states_penalty naming a quotation that leaves nothing to the Member States", (t) => (regimeOf(t, "data-act").member_states_penalty = "data-act-40-4"));
  mutated("a member_states_penalty naming no quotation", (t) => (regimeOf(t, "psd2-sca-rts").member_states_penalty = "psd2/probe"));
  mutated("a member_states_penalty on a tiered regime", (t) => (regimeOf(t, "gdpr").member_states_penalty = "data-act/data-act-40-1"));
  // Red before this change: a mark borrowed from another law passed.
  mutated("a member_states_penalty naming another law's quotation", (t) => (regimeOf(t, "geo-blocking").member_states_penalty = "data-act/data-act-40-1"));
  mutated("a member_states_penalty naming another law's quotation, on a regime with none of its own", (t) => (regimeOf(t, "us-ccpa").member_states_penalty = "eprivacy/eprivacy-15a-1", regimeOf(t, "us-ccpa").tiered = false));
  // A penalty route for some duties gives what it reaches, why and its words, all three.
  mutated("a penalty route for some duties with no words for it", (t) => delete regimeOf(t, "data-act").penalty_quotes.find((q) => q.id === "data-act-40-4").says);
  mutated("a penalty route for some duties on a tiered regime", (t) => (regimeOf(t, "gdpr").penalty_quotes ??= []).push({ id: "probe", cite: "GDPR Art 83(5)", quote: "probe", reaches: ["5"], says: "probe", why: "probe" }));
  mutated("a regime without tiers that quotes a national-penalty provision and names none", (t) => delete regimeOf(t, "eaa").member_states_penalty);
  // A carried duty that is itself carried is followed to its last link: CRA Art 25 -> Art 24(3) -> Art 14(1), top.
  {
    const t = structuredClone(table);
    regimeOf(t, "cra").carried_duties.push({ id: "probe-25", provisions: ["25"], duty: "24(3)", quote: "Article 24(3)" });
    const r = m.tierOfBasis("CRA Art. 25", "EU", t);
    if (r.tier !== "top" || r.line !== "cra/probe-25 -> cra/cra-24-3 -> cra/cra-64-2") out.push(`self-test: a chain of carried duties resolves ${r.tier} through ${r.line}`);
    if (m.penaltyTableGuardProblems(t).length !== 0) out.push(`self-test: the table guard refuses a lawful chain of carried duties (${m.penaltyTableGuardProblems(t).join("; ")})`);
  }
  // Each tier line's provisions against the article numbers its quotation names, both ways. Amounts ("EUR 15 000 000",
  // "2,5 %") and paragraph designators ("(1) to (4)") are taken out first. A line may name provisions its quotation
  // does not (`beyond_quote`, with its `why`); a line naming none (`provisions: []`) must say why.
  const articleNumbers = (q) =>
    [...q.replace(/EUR\s[\d\s.,]+/g, " ").replace(/\d+(?:[.,]\d+)?\s?%/g, " ").replace(/\([^)]*\)/g, " ").matchAll(/\b(\d+[a-z]?)\b/g)].map((x) => x[1]);
  for (const regime of table.regimes) {
    for (const line of regime.tiers ?? []) {
      const specs = line.provisions ?? [];
      if (specs.includes("*") || typeof line.quote !== "string") continue;
      if (specs.length === 0) {
        if (!line.why) out.push(`${regime.id}/${line.id}: names no provisions and does not say why`);
        continue;
      }
      const beyond = new Set(line.beyond_quote ?? []);
      if (beyond.size > 0 && !line.why) out.push(`${regime.id}/${line.id}: beyond_quote without a why`);
      const inQuote = articleNumbers(line.quote);
      for (const spec of specs) {
        if (beyond.has(spec) || /^Annex /.test(spec)) continue;
        for (const end of spec.replace(/\([^)]*\)/g, "").split("-").filter(Boolean)) {
          if (!inQuote.includes(end)) out.push(`${regime.id}/${line.id}: provision ${spec} is not named by the line's quotation`);
        }
      }
      for (const n of inQuote) {
        const covered = specs.some((spec) => {
          const [lo, hi = lo] = spec.replace(/\([^)]*\)/g, "").split("-");
          return n === lo || n === hi || (/^\d+$/.test(n) && Number(n) >= Number(lo) && Number(n) <= Number(hi));
        });
        if (!covered) out.push(`${regime.id}/${line.id}: its quotation names Article ${n}, which the line's provisions do not hold`);
      }
    }
  }
  return out;
}

if (errors.length > 0) {
  console.error(`✘ bundle build failed (${errors.length} error${errors.length === 1 ? "" : "s"}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

rules.sort((a, b) => a.id.localeCompare(b.id));
checklists.sort((a, b) => a.checklist_id.localeCompare(b.checklist_id));
mkdirSync(OUT_DIR, { recursive: true });

const rulesJson = JSON.stringify(rules, null, 2);
writeFileSync(join(OUT_DIR, "rules.json"), rulesJson);

const files = {
  "rules.json": createHash("sha256").update(rulesJson).digest("hex"),
};

// THE RULE LINES' TABLE, beside the rules and hashed into the manifest like every other asset; written only when a rule
// carries lines, so a bundle without them carries no empty asset.
if (Object.keys(ruleLines).length > 0 && RULE_LINES_FILE) {
  const ruleLinesJson = JSON.stringify({ version: 1, rules: ruleLines }, null, 2);
  writeFileSync(join(OUT_DIR, RULE_LINES_FILE), ruleLinesJson);
  files[RULE_LINES_FILE] = createHash("sha256").update(ruleLinesJson).digest("hex");
}

// Written only when there is something to write, so a bundle without checklists carries no empty
// asset and `loadBundle` can tell "no checklists in this bundle" from "an empty checklist".
if (checklists.length > 0) {
  const checklistsJson = JSON.stringify(checklists, null, 2);
  writeFileSync(join(OUT_DIR, "checklists.json"), checklistsJson);
  files["checklists.json"] = createHash("sha256").update(checklistsJson).digest("hex");
}

// The penalty-tier table, checked above; written and hashed like every other bundle file.
if (penaltyTiersJson !== null) {
  writeFileSync(join(OUT_DIR, "penalty-tiers.json"), penaltyTiersJson);
  files["penalty-tiers.json"] = createHash("sha256").update(penaltyTiersJson).digest("hex");
}

// THE SCAN'S READ SCOPE, emitted for the same reason `checklists.json`
// is: the scanner runs on a machine that has no `rules/`, so anything the SCAN needs from the
// authoring tree has to ride in the bundle and be hashed into `manifest.files` with everything else.
//
// One class is one file of `rules/path-exclusions/` — `READ_SCOPE_CLASSES` says which, and says why
// the unit is a file — and its patterns are the union of every set that file declares, resolved
// through the engine's own `pathExclusionClauses` so that a class is composed exactly the way a
// rule's import is. A pattern reached through two sets (`test_surface` includes three sets that are
// also named on their own) is carried ONCE, in first-appearance order, because the engine tests a
// path against the list and a second copy of a clause would only cost time.
//
// This is a projection of the YAML and never a second statement of it: no pattern is written here,
// no set is named here, and a set added to one of those three files tomorrow is in its class the
// same day. The user-facing wording for each class lives in the engine
// (`product/packages/cli/src/read-scope.ts`); a test asserts that the two
// agree on which classes exist.
if (pathExclusionClauses !== null && sharedPathExclusionFiles.length > 0) {
  const classes = {};
  for (const [classId, sourceFile] of Object.entries(READ_SCOPE_CLASSES)) {
    const setNames = Object.keys(sharedPathExclusions)
      .filter((name) => sharedPathExclusionSetFiles[name] === sourceFile)
      .sort();
    if (setNames.length === 0) {
      errors.push(
        `read scope: class "${classId}" names rules/path-exclusions/${sourceFile}, and no set was ` +
          `loaded from that file. A class with no patterns would silently read everything it is ` +
          `supposed to hold back`,
      );
      continue;
    }
    const patterns = [];
    for (const name of setNames) {
      for (const clause of pathExclusionClauses(name, sharedPathExclusions, `read scope class ${classId}`)) {
        if (!patterns.includes(clause)) patterns.push(clause);
      }
    }
    classes[classId] = { source: sourceFile, sets: setNames, patterns };
  }
  // The sets that DESCRIBE a tree and decline nothing — `INFORMATIONAL_PATH_CLASS_FILE` says why
  // they ride under their own key and why the unit here is the set rather than the file. Same
  // resolution as the loop above (`pathExclusionClauses`), so a clause added to `documents.yaml`
  // tomorrow is in the sheet the same day, and each set carries its own authored `question`.
  const informationalClasses = {};
  for (const name of Object.keys(sharedPathExclusions).sort()) {
    if (sharedPathExclusionSetFiles[name] !== INFORMATIONAL_PATH_CLASS_FILE) continue;
    const patterns = [];
    for (const clause of pathExclusionClauses(name, sharedPathExclusions, `informational path class ${name}`)) {
      if (!patterns.includes(clause)) patterns.push(clause);
    }
    informationalClasses[name] = {
      source: INFORMATIONAL_PATH_CLASS_FILE,
      question: String(sharedPathExclusions[name].question ?? "").trim(),
      patterns,
    };
  }
  const readScopeJson = JSON.stringify(
    { version: 1, classes, informational_classes: informationalClasses },
    null,
    2,
  );
  writeFileSync(join(OUT_DIR, "read-scope.json"), readScopeJson);
  files["read-scope.json"] = createHash("sha256").update(readScopeJson).digest("hex");
}

// The content digest is the CLI's own function (product/packages/cli/src/bundle.ts), imported from
// the compiled CLI like GLOBS_MODULE above, so the build and `loadBundle` cannot disagree on it.
const { bundleContentDigest, UNSIGNED_MARKER } = await import(pathToFileURL(join(ROOT, "product/packages/cli/dist/bundle.js")).href);
const CONTENT_DIGEST = bundleContentDigest(files);

/**
 * YYYY.MM.n from the bundle's CONTENT and nothing else (parent's ruling, 2026-10-12): never the build
 * time, never a commit date. carry-forward holds every carried verdict to the bundle version
 * (carry-forward.ts, the `bundle` premise), so a version that moved with the clock would send every
 * earlier verdict back to review after a rebuild of the same rules, and one that never moved
 * (2026.07.1) let any change through unseen. Derived: "0000.00" - this is not a dated release - and n,
 * the first 24 bits of the content digest in decimal. Same content, same version; any change to a
 * file the manifest lists, another version. A release that wants a dated label sets BUNDLE_VERSION
 * (YYYY.MM.n, checked); `findings.json` carries the content digest beside either.
 */
function deriveBundleVersion() {
  if (BUNDLE_VERSION_OVERRIDE !== null) {
    if (!/^\d{4}\.\d{2}\.\d+$/.test(BUNDLE_VERSION_OVERRIDE)) {
      console.error(`✘ BUNDLE_VERSION ${JSON.stringify(BUNDLE_VERSION_OVERRIDE)} is not YYYY.MM.n (bundle-manifest.schema.json)`);
      process.exit(1);
    }
    return { version: BUNDLE_VERSION_OVERRIDE };
  }
  return { version: `0000.00.${parseInt(CONTENT_DIGEST.slice(0, 6), 16)}` };
}
const DERIVED = deriveBundleVersion();
const BUNDLE_VERSION = DERIVED.version;

const manifest = {
  bundle_version: BUNDLE_VERSION,
  created_at: new Date().toISOString(),
  packs: [...packCounts.entries()].map(([pack_id, count]) => ({
    pack_id,
    rules: count,
    jurisdiction: [...(packJurisdictions.get(pack_id) ?? [])].sort(),
  })),
  files,
  engine_pins: { "builtin-regex": "cli-0.1.0" },
  // An explicit marker, not `null`: an unsigned bundle is a decision still to be made (the owner's),
  // and the manifest says so rather than leaving a gap that reads like a signature gone missing.
  signature: UNSIGNED_MARKER,
};
writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));

// The table as the report assembly will read it: from the bundle just written, through the manifest's digest. A table
// that round-trips differently, or a manifest that does not cover it, fails the build here rather than the report later.
if (penaltyTiersJson !== null) {
  const { loadPenaltyTiers, tierOfBasis } = await import(pathToFileURL(join(ROOT, "product/packages/cli/dist/penalty-tier.js")).href);
  try {
    const loaded = loadPenaltyTiers(OUT_DIR);
    if (JSON.stringify(loaded, null, 2) !== penaltyTiersJson || tierOfBasis("GDPR Art. 5(1)(c)", "EU", loaded).tier !== "top") {
      throw new Error("the table read back from the bundle differs from the one compiled");
    }
  } catch (e) {
    console.error(`✘ penalty-tiers: ${e.message}`);
    process.exit(1);
  }
}

const checklistNote = checklists.length
  ? ` / ${checklists.length} checklist${checklists.length === 1 ? "" : "s"} (${checklists.reduce((n, c) => n + c.items.length, 0)} items)`
  : "";
// Printed only when a shared file was actually read, so today's line is unchanged and the day a
// list exists the build says WHERE it came from. `VOCABULARY_DIR` follows `RULES_DIR`, so a build
// driven against a snapshot must be able to show which snapshot's word lists it merged; a run that
// silently used the working tree's is the defect deriveVocabularyDir exists to end.
const vocabularyNote = sharedVocabularyFiles.length
  ? ` / ${sharedVocabularyFiles.length} shared vocabulary file${sharedVocabularyFiles.length === 1 ? "" : "s"}` +
    ` (${Object.keys(sharedVocabulary).length} lists) from ` +
    `${VOCABULARY_DIR.startsWith(ROOT) ? VOCABULARY_DIR.slice(ROOT.length) : VOCABULARY_DIR}/`
  : "";
// The same line for the shared path-exclusion sets, printed for the same reason and under the same
// condition: `PATH_EXCLUSIONS_DIR` follows `RULES_DIR`, so a build driven against a snapshot must be
// able to show whose exclusion sets it merged.
const pathExclusionNote = sharedPathExclusionFiles.length
  ? ` / ${sharedPathExclusionFiles.length} shared path-exclusion file${sharedPathExclusionFiles.length === 1 ? "" : "s"}` +
    ` (${Object.keys(sharedPathExclusions).length} sets) from ` +
    `${PATH_EXCLUSIONS_DIR.startsWith(ROOT) ? PATH_EXCLUSIONS_DIR.slice(ROOT.length) : PATH_EXCLUSIONS_DIR}/`
  : "";
// The output directory is PRINTED FROM THE VARIABLE, not from the default spelled out again. This
// line used to end `→ dist/bundle/` unconditionally, so a concurrent authoring session running with
// BUNDLE_OUT set was told its bundle went somewhere it did not — a small instance of exactly the
// defect §11.0 and the gate-list check exist for, found while running this step on 2026-08-13.
console.log(
  `✔ bundle ${BUNDLE_VERSION}: ${rules.length} rules / ${packCounts.size} packs${checklistNote}${vocabularyNote}${pathExclusionNote} → ` +
    `${OUT_DIR.startsWith(ROOT) ? OUT_DIR.slice(ROOT.length) : OUT_DIR}/`,
);

// THE SIZE OF THE HOLE THE WORKSPACE-PATH LINT IS CHOOSING TO KEEP, printed on every green build.
//
// A lint whose exemptions are invisible is the defect it exists to catch, one file up: the four-field
// version of this check was green while 244 path references sat in the bundle, and nothing anywhere
// said so. So the exempted hits are counted and their fields named, every run, on the success path
// rather than only on failure. Today the exemption is a rule's `provenance` and nothing else — an
// authoring record no CLI code, no skill, no agent contract and no gate reads. Whether it should
// ship at all is a separate question and is not answered here.
if (exemptedWorkspacePaths.length > 0) {
  const byField = new Map();
  for (const row of exemptedWorkspacePaths) {
    const field = row.slice(row.indexOf(": ") + 2, row.indexOf(" -> ")).replace(/\[\d+\]/g, "[]");
    byField.set(field, (byField.get(field) ?? 0) + 1);
  }
  const parts = [...byField].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ${n}`);
  console.log(
    `  note: ${exemptedWorkspacePaths.length} workspace-path reference(s) ship inside fields this ` +
      `lint exempts (${parts.join(", ")}). They are not promises to the reader — nothing reads them — ` +
      `but they do reach the user's machine inside rules.json.`,
  );
}

// WHAT THE PERSON-FACING WORD LINT DOES NOT HOLD TO ITS LIST, printed on every green build for the
// reason the note above gives. The quoted hits are named one by one, because the quotation marks are
// the escape and a reviewer should be able to read each of them; the rest are counted by field.
{
  const byField = (rows) => {
    const counts = new Map();
    for (const row of rows) {
      const field = row.path.replace(/\[\d+\]/g, "[]");
      counts.set(field, (counts.get(field) ?? 0) + 1);
    }
    return [...counts]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([field, n]) => `${field} ${n}`)
      .join(", ");
  };
  const { quoted, notCopied, verbatim } = personWordTally;
  // The absence-claim lint's exceptions, named one by one for the same reason as the quoted hits below.
  if (absenceExceptionsUsed.size > 0) {
    const used = [...absenceExceptionsUsed.keys()].sort((a, b) => a - b).map((i) => ABSENCE_CLAIM_EXCEPTIONS[i]);
    console.log(
      `  note: ${used.length} line(s) pass the absence-claim lint by an exception (ABSENCE_CLAIM_EXCEPTIONS, ` +
        `tools/lint-patterns.mjs): ${used.map((x) => `${x.rule} ${x.field} "${x.phrase}"`).join("; ")}.`,
    );
  }
  if (quoted.length > 0) {
    console.log(
      `  note: ${quoted.length} person-facing listed word(s) sit inside quotation marks in citation fields and ship as ` +
        `quoted provision text: ${quoted.map((r) => `${r.where} ${r.path} "${r.word}"`).join("; ")}.`,
    );
  }
  if (notCopied.length + verbatim.length > 0) {
    console.log(
      `  note: listed words the person-facing word lint does not hold to its list: ${notCopied.length} in prose no ` +
        `output copies to the person (${byField(notCopied) || "none"}); ${verbatim.length} in detector patterns and ` +
        `quotation fields (${byField(verbatim) || "none"}).`,
    );
  }
}

// THE CLI'S OWN COPY OF baseline-002: every redaction compiles the copy the CLI carries, whatever
// bundle runs, so the copy must be the rule this build just wrote. Checked only for the real rule tree (a gate's own
// RULES_DIR builds a bundle of its own on purpose). After rules.json is written, so the command it names reads it.
if (!process.env.RULES_DIR) {
  const credentialCopy = credentialCopyProblem(rules);
  if (credentialCopy !== null) {
    console.error(`✘ bundle build failed: ${credentialCopy}`);
    process.exit(1);
  }
}
// The CLI carries the JSON schemas in its compiled code (product/packages/cli/src/schemas.generated.ts, from
// product/packages/schemas/schemas, the one source). A schema changed without regenerating that module would leave the
// program validating against the old one, so the build that every gate run starts with refuses the difference.
if (!process.env.RULES_DIR) {
  const schemasModule = schemasModuleProblem();
  if (schemasModule !== null) {
    console.error(`✘ bundle build failed: ${schemasModule}`);
    process.exit(1);
  }
}
