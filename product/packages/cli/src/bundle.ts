import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BundleManifest, Checklist, Rule } from "wolfboy-schemas";
import { READ_SCOPE_FILE, type ReadScopeManifest } from "./read-scope.js";
import { StartupRefusal } from "./startup-refusal.js";
import { CREDENTIAL_RULE_ID } from "./credential-redaction.js";
import { PRODUCT_CREDENTIAL_RULE } from "./credential-rule.generated.js";
import { PENALTY_TIERS_FILE } from "./penalty-tier.js";
import { registerInstruments } from "./region-reach.js";

export interface LoadedBundle {
  dir: string;
  manifest: BundleManifest;
  rules: Rule[];
  /**
   * Notice-completeness checklists shipped alongside the rules (pillar 2).
   *
   * They ride in `manifest.files`, so the integrity loop below already verifies them: a checklist
   * is legal content that gets quoted back to the user, and it has to be as tamper-evident as a
   * rule. Empty for a bundle built before checklists existed — a missing asset is not an error,
   * because old bundles must stay loadable.
   */
  checklists: Checklist[];
  /**
   * The scan's read scope, as the build resolved it out of `rules/path-exclusions/`.
   *
   * `null` for a bundle built before 2026-09-10, and that is a different state from "three classes,
   * all of them read": the first cannot express the scope at all and the second is a run that opted
   * in. `coverage_limits` states which of the two happened, so a user scanning with an old bundle is
   * told that the default they read about in the README is not in force here.
   *
   * It rides in `manifest.files` like `checklists.json`, so the integrity loop above already
   * verifies it: it decides which files 117 rules are shown, and a tampered read scope is a scan
   * that quietly reads less.
   */
  readScope: ReadScopeManifest | null;
  /**
   * Each rule's two presentation lines, by rule id: the
   * title of a finding to fix (`problem_line`) and what to do (`fix_line`). The build moves them out of the rules into
   * `rule-lines.json`, so no rule digest (`rests-on.ts` `ruleHash`) covers them and no review seat is handed them; they
   * ride in `manifest.files` like every other asset, so the integrity loop below verifies them. Empty for a bundle that
   * carries none; a rule without an entry has no lines yet (`rule-lines.ts` `problemLineFor` answers null for it).
   */
  ruleLines: Readonly<Record<string, RuleLines>>;
  /**
   * The bundle's content digest (`bundleContentDigest`), computed here from the bytes of the files just
   * read and never from the manifest's word for them; every file the loader reads is among them, `rules.json`
   * included. `findings.json` records it as `bundle.sha256`, so a result can be tied to the exact
   * rule set that produced it.
   */
  digest: string;
  /**
   * What this CLI can say about the manifest's signature. "unsigned": the manifest carries the
   * explicit unsigned marker (or, for a bundle built before 2026-10-12, `null`). "not-verified": it
   * carries a signature object, which this CLI has no key to check. Signing is not decided yet.
   */
  signature: "unsigned" | "not-verified";
}

/** A rule's two presentation lines as `rule-lines.json` carries them (rule.schema.json `problem_line`, `fix_line`). */
export interface RuleLines {
  problem_line: { text: string; template?: string };
  fix_line: string;
}

/**
 * The rules' presentation lines, apart from `rules.json`.
 * `{ "version": 1, "rules": { <rule id>: RuleLines } }`.
 * Written by tools/build-bundle.mjs, which imports this name, only when a rule carries lines.
 */
export const RULE_LINES_FILE = "rule-lines.json";

/** Non-rule assets the bundle may carry, keyed as they appear in `manifest.files`. */
const CHECKLISTS_FILE = "checklists.json";
/** The rules, which every bundle carries and its manifest must list. */
const RULES_FILE = "rules.json";

export function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** The marker a bundle manifest carries in `signature` while bundles are unsigned. */
export const UNSIGNED_MARKER = "unsigned";

/**
 * The bundle's content digest: the sha256 of its file list written the way `sha256sum` writes one —
 * `<sha256>  <name>` per file, sorted by name, each line ending in a newline. It covers what the
 * scan reads (every file the manifest lists) and nothing the build stamps on the side (`created_at`),
 * so a rebuild of the same rules keeps it, and any change to a listed file moves it. An auditor can
 * re-derive it without this CLI: `sha256sum <the listed files, sorted> | sha256sum`.
 *
 * One function for both ends: `tools/build-bundle.mjs` imports it from the compiled CLI to derive
 * the bundle version, and `loadBundle` uses it for the digest `findings.json` records.
 */
export function bundleContentDigest(files: Record<string, string>): string {
  return sha256(
    Object.keys(files)
      .sort()
      .map((name) => `${files[name]}  ${name}\n`)
      .join(""),
  );
}

/**
 * The variable a person can name a bundle by, OUTSIDE the plugin. The plugin's launcher (`product/plugin/bin/legal-scan`)
 * removes it before it runs the program: a scanned repository's own `.claude/settings.json` can set
 * it inside a Claude Code session, and the bundle chooses every rule the scan runs.
 */
export const BUNDLE_DIR_ENV = "LEGAL_BUNDLE_DIR";

/** Where a run's bundle came from: `--bundle`, the variable, or the bundle shipped with this program. */
export type BundleSource = "option" | "env" | "shipped";

/**
 * THE BUNDLE SHIPPED WITH THIS PROGRAM. The packed CLI carries its bundle in `bundle/`
 * beside `dist/` (package.json `files`; scripts/pack-bundle.mjs). A CLI built inside this repository's workspace
 * (`product/packages/cli`, the plugin's P0 launcher runs it) has none there, and its bundle is the one the same tree
 * builds, `dist/bundle` at the repository's root, taken only where the CLI sits in that workspace (the workspace's
 * `pnpm-workspace.yaml` two folders up and the rule tree beside it), never a folder of a project the package is
 * installed into. Null where neither holds a manifest.
 */
function shippedBundleDir(): string | null {
  const { cliPackage, workspace } = programLayout();
  const packaged = join(cliPackage, "bundle");
  if (existsSync(join(packaged, "manifest.json"))) return packaged;
  const built = workspace === null ? null : join(workspace, "dist", "bundle");
  if (built !== null && existsSync(join(built, "manifest.json"))) return built;
  return null;
}

/**
 * Where this program sits: its package's folder (the parent of `dist/`) and, where the CLI is built inside this
 * repository's workspace (the workspace's `pnpm-workspace.yaml` two folders up and the rule tree beside it), that
 * checkout's root. The one test of the layout, for the shipped bundle above and for the program's own folder below.
 */
function programLayout(): { cliPackage: string; workspace: string | null } {
  const cliPackage = join(dirname(fileURLToPath(import.meta.url)), "..");
  const repo = join(cliPackage, "..", "..", "..");
  const inWorkspace = existsSync(join(cliPackage, "..", "..", "pnpm-workspace.yaml")) && existsSync(join(repo, "rules", "packs"));
  return { cliPackage: resolve(cliPackage), workspace: inWorkspace ? resolve(repo) : null };
}

/**
 * THIS PROGRAM'S OWN FOLDER: the checkout's root where the
 * CLI runs from a source checkout (its rules, tools and sources are all its own), else the package's folder (its bundle,
 * grammars and plugin files). own-install.ts refuses a scan whose folder holds it where the walk reads.
 */
export function programFolder(): string {
  const { cliPackage, workspace } = programLayout();
  return workspace ?? cliPackage;
}

/**
 * WHERE THE BUNDLE IS. In order: `--bundle` as given (an explicit choice always wins);
 * `LEGAL_BUNDLE_DIR` where it is set and not empty (outside the plugin: the launcher removes it); the bundle shipped
 * with this program. Null where none of the three exists. Never a path read from the scanned tree.
 * This and shippedBundleDir are private to this module, so the only way another module reaches a
 * bundle's files is through openBundle, openShippedBundle or loadBundle, whose bytes are the bytes the whole-bundle check
 * saw (a hook read rules.json from the resolved folder itself, outside the check).
 */
function resolveBundleDir(given: string | undefined): { dir: string; from: BundleSource } | null {
  if (typeof given === "string" && given !== "") return { dir: resolve(given), from: "option" };
  const env = process.env[BUNDLE_DIR_ENV];
  if (typeof env === "string" && env !== "") return { dir: resolve(env), from: "env" };
  const shipped = shippedBundleDir();
  return shipped === null ? null : { dir: shipped, from: "shipped" };
}

/** The refusal where `resolveBundleDir` found none: one plain sentence, what to pass. */
export function noBundleMessage(command: string): string {
  return (
    `${command}: no rule bundle. Pass --bundle <dir>, or set ${BUNDLE_DIR_ENV}; this installation carries no bundle of ` +
    `its own (no bundle/manifest.json beside the program). Nothing was written.`
  );
}

/**
 * EVERY COMMAND FINDS AND LOADS ITS BUNDLE HERE: `resolveBundleDir`, then `loadBundle`, and every
 * way either can fail - no bundle anywhere, a folder that does not exist, a manifest that is not JSON, a file whose
 * digest differs - ends in one plain sentence naming the folder and where it came from (`StartupRefusal`), never a
 * stack. `from` and `shipped` say which bundle ran, for the terminal and the report.
 */
export function openBundle(command: string, given: string | undefined): LoadedBundle & { from: BundleSource; shipped: boolean | null } {
  const found = resolveBundleDir(given);
  if (found === null) throw new StartupRefusal(noBundleMessage(command));
  return openFound(command, found);
}

/**
 * THE HOOKS' BUNDLE: the bundle shipped with this program and no other, opened and checked as
 * `openBundle` opens one. The hooks run in the scanned project's own session, whose environment a project's settings can
 * set, so no bundle location is taken from it (LEGAL_BUNDLE_DIR is not read here; the plugin's shim removes it too, by
 * the launcher's rule); and every byte they use is one the whole-bundle check saw. Throws a StartupRefusal where this
 * program carries no bundle or its bundle cannot be used.
 */
export function openShippedBundle(command: string): LoadedBundle & { from: BundleSource; shipped: boolean | null } {
  const shipped = shippedBundleDir();
  if (shipped === null) throw new StartupRefusal(noBundleMessage(command));
  return openFound(command, { dir: shipped, from: "shipped" });
}

/** Load and check the bundle `found` names; every failure is one plain sentence (openBundle says which). */
function openFound(command: string, found: { dir: string; from: BundleSource }): LoadedBundle & { from: BundleSource; shipped: boolean | null } {
  const named = found.from === "option" ? "--bundle" : found.from === "env" ? BUNDLE_DIR_ENV : "the bundle shipped with this program";
  let loaded: LoadedBundle;
  try {
    loaded = loadBundle(found.dir);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    const why = err.code === "ENOENT" ? `${err.path ?? "a file"} does not exist` : err.message;
    throw new StartupRefusal(
      `${command}: the rule bundle at ${found.dir} (${named}) cannot be used: ${why}. Name a folder that holds a whole ` +
        `bundle (its manifest.json, rules.json and the files the manifest lists), or give no --bundle to use the one ` +
        `shipped with this program. Nothing was written.`,
    );
  }
  /* The bundle's credential rule must be the one this program redacts with. Every redaction
   * compiles the CLI's own copy of baseline-002 (engine.ts `productCredentials`), never the bundle's; a bundle whose
   * baseline-002 differs would detect with one rule and redact with another - a shape only the bundle's rule knows found
   * and written in clear, and the rule's clauses numbered one way in a location and another in its marker. A bundle
   * without baseline-002 detects no credential and is redacted by the CLI's copy all the same, so it is not refused. */
  const credential = loaded.rules.find((r) => r?.id === CREDENTIAL_RULE_ID);
  if (credential !== undefined) {
    // Compared over the fields the CLI's copy carries (tools/credential-rule-copy.mjs picks them: the id, the pack and the
    // detector), read off the copy itself so the list is written once; a rule's prose may differ.
    const fields = Object.keys(PRODUCT_CREDENTIAL_RULE);
    const inBundle = credentialRuleDigest(Object.fromEntries(fields.map((k) => [k, (credential as unknown as Record<string, unknown>)[k]])));
    const ours = credentialRuleDigest(PRODUCT_CREDENTIAL_RULE);
    if (inBundle !== ours) {
      throw new StartupRefusal(
        `${command}: the rule bundle at ${found.dir} (${named}) cannot be used: its ${CREDENTIAL_RULE_ID}, the rule that finds ` +
          `credentials, is not the one this program redacts credentials with (sha256 ${inBundle.slice(0, 12)} in the bundle, ` +
          `${ours.slice(0, 12)} in this program). A credential that rule finds and this program does not recognise would be ` +
          `written in clear. Give no --bundle to use the bundle shipped with this program, or use a program built from the ` +
          `same rules as this bundle. Nothing was written.`,
      );
    }
  }
  // The shipped bundle's identity, where this is the shipped bundle's folder, is this load's (no second read of it).
  const shippedDir = shippedBundleDir();
  if (shippedDir !== null && resolve(shippedDir) === resolve(found.dir)) {
    shippedIdentityCache = { dir: shippedDir, identity: { digest: loaded.digest, version: String(loaded.manifest.bundle_version) } };
  }
  return { ...loaded, from: found.from, shipped: isShippedBundle(loaded) };
}

/** A rule's digest independent of key order: sha256 over its JSON with every object's keys sorted. */
export function credentialRuleDigest(rule: unknown): string {
  const canonical = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
    if (v !== null && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return `{${Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
        .join(",")}}`;
    }
    return JSON.stringify(v) ?? "null";
  };
  return sha256(Buffer.from(canonical(rule), "utf8"));
}

/**
 * Is this the bundle shipped with this program? Its content digest compared with the shipped bundle's (the manifest's
 * file digests, `bundleContentDigest`), so a copy of the shipped bundle named by `--bundle` counts as the shipped one.
 * Null where this program carries no bundle to compare with.
 */
export function isShippedBundle(loaded: LoadedBundle): boolean | null {
  return isShippedIdentity(loaded.digest, String(loaded.manifest.bundle_version));
}

/**
 * THE ONE "SHIPPED" DECISION (where the bundle check meets the shipped words): a bundle
 * named by this content digest and this version is the one shipped with this program only where BOTH are the shipped
 * bundle's (`shippedBundleIdentity`). The scan's `bundle:` line and the terminal's `checks` line (through
 * `isShippedBundle`, at `openBundle`) and the report's `Rules:` line (`assemble-report.ts` `rulesLineOf`, from
 * findings.json's `bundle`) all ask this function; none compares a digest or a version of its own. Null where this
 * program carries no bundle to compare with.
 */
export function isShippedIdentity(digest: string, version: string): boolean | null {
  const shipped = shippedBundleIdentity();
  return shipped === null ? null : shipped.digest === digest && shipped.version === version;
}

/**
 * The name and the digest of the bundle shipped with this program: its manifest's `bundle_version` and its content
 * digest. A bundle is the shipped one only where BOTH are the shipped bundle's:
 * the digest covers the files and not the manifest, so a copy of the shipped bundle with
 * another version written in its manifest has the shipped digest, and was named "the one shipped with this program" under
 * a version that was never shipped. Null where this program carries no bundle, or its manifest cannot be read.
 */
export function shippedBundleIdentity(): { digest: string; version: string } | null {
  const shipped = shippedBundleDir();
  if (shipped === null) return null;
  if (shippedIdentityCache?.dir === shipped) return shippedIdentityCache.identity;
  // Taken from a checked load of the shipped bundle (loadBundle, the one reader of bundle files),
  // once per process, so a shipped bundle whose files no longer match its manifest names no bundle "shipped".
  let identity: { digest: string; version: string } | null;
  try {
    const loaded = loadBundle(shipped);
    identity = { digest: loaded.digest, version: String(loaded.manifest.bundle_version) };
  } catch {
    identity = null;
  }
  shippedIdentityCache = { dir: shipped, identity };
  return identity;
}
/** The shipped bundle's identity for this process: set by its first checked load (openFound or shippedBundleIdentity). */
let shippedIdentityCache: { dir: string; identity: { digest: string; version: string } | null } | undefined;

/**
 * The content digest of the bundle shipped with this program (`bundleContentDigest` over its manifest's files), the value
 * findings.json's `bundle.sha256` holds for a scan that ran it. Null where this program carries no bundle, or its
 * manifest cannot be read. The report compares a scan's digest with it (assemble-report.ts).
 */
export function shippedBundleDigest(): string | null {
  return shippedBundleIdentity()?.digest ?? null;
}

/**
 * Load a local rule bundle and verify its integrity against the sha256 digests in manifest.files.
 * A tampered or partially written bundle must fail loudly rather than scan with unknown rules:
 * findings are only meaningful if the rule set that produced them is exactly the published one.
 */
export function loadBundle(dir: string): LoadedBundle {
  const manifest = JSON.parse(
    readFileSync(join(dir, "manifest.json"), "utf8"),
  ) as BundleManifest;
  // The shapes the code below reads, said plainly where they are not there: before, a
  // manifest without `files` quoted a JavaScript error and a rules.json that is not a list ended a scan in a stack.
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("manifest.json is valid JSON but not an object");
  }
  if (manifest.files === null || typeof manifest.files !== "object" || Array.isArray(manifest.files)) {
    throw new Error('manifest.json lists no files (its "files" field is missing or not an object)');
  }

  /* THE BUNDLE IS TAKEN WHOLE OR NOT AT ALL. Every
   * file the loader reads is one the manifest lists with its digest, and is read once: its bytes are checked against that
   * digest and the same bytes are what the program uses, so nothing is read that no digest covers and nothing changes
   * between the check and the use. Before, `rules.json` was read whether or not the manifest listed it, so a manifest
   * without it ran any rules.json unchecked, under one digest for every such rules.json. The digest that names the bundle
   * is taken over the bytes read. Every rule id is held once: a second rule under an id ran beside the first, and the
   * credential rule's check (openBundle) compared only the first of them. */
  if (!Object.hasOwn(manifest.files, RULES_FILE)) {
    throw new Error(`manifest.json does not list ${RULES_FILE}, so the rules a scan would run are covered by no digest`);
  }
  const bytes = new Map<string, Buffer>();
  const actualDigests: Record<string, string> = {};
  for (const [file, expected] of Object.entries(manifest.files)) {
    const content = readFileSync(join(dir, file));
    const actual = sha256(content);
    if (actual !== expected) {
      throw new Error(
        `bundle integrity error: ${file} sha256 mismatch (expected ${String(expected).slice(0, 12)}…, got ${actual.slice(0, 12)}…)`,
      );
    }
    bytes.set(file, content);
    actualDigests[file] = actual;
  }
  const verified = (file: string): string => (bytes.get(file) as Buffer).toString("utf8");

  const rules = JSON.parse(verified(RULES_FILE)) as Rule[];
  if (!Array.isArray(rules)) throw new Error("rules.json is valid JSON but not a list of rules");
  const seen = new Map<string, number>();
  for (const r of rules) {
    const id = String((r as { id?: unknown } | null)?.id);
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  const twice = [...seen].filter(([, n]) => n > 1).map(([id, n]) => `${id} (${n} times)`);
  if (twice.length > 0) {
    throw new Error(`rules.json holds a rule id more than once: ${twice.join(", ")}; a bundle holds each rule once`);
  }

  const checklists = bytes.has(CHECKLISTS_FILE) ? (JSON.parse(verified(CHECKLISTS_FILE)) as Checklist[]) : [];

  const readScope = bytes.has(READ_SCOPE_FILE) ? (JSON.parse(verified(READ_SCOPE_FILE)) as ReadScopeManifest) : null;

  const ruleLines = bytes.has(RULE_LINES_FILE) ? ruleLinesOf(JSON.parse(verified(RULE_LINES_FILE))) : {};
  // Which law each rule cites, by this
  // bundle's own penalty table (the bytes the digest check above saw), so a region answer settles a rule only where the
  // question carries the territorial test of every law it cites (region-reach.ts).
  if (bytes.has(PENALTY_TIERS_FILE)) registerInstruments(rules, JSON.parse(verified(PENALTY_TIERS_FILE)));

  const signature: LoadedBundle["signature"] =
    manifest.signature === undefined || manifest.signature === null || manifest.signature === UNSIGNED_MARKER ? "unsigned" : "not-verified";

  return {
    dir,
    manifest,
    rules,
    checklists,
    readScope,
    ruleLines,
    digest: bundleContentDigest(actualDigests),
    signature,
  };
}

/** `rule-lines.json`'s table, said plainly where its shape is not the one the build writes. */
function ruleLinesOf(doc: unknown): Record<string, RuleLines> {
  const table = (doc as { version?: unknown; rules?: unknown } | null)?.rules;
  if ((doc as { version?: unknown } | null)?.version !== 1 || table === null || typeof table !== "object" || Array.isArray(table)) {
    throw new Error(`${RULE_LINES_FILE} is not version 1 of the rule-lines table (an object with "version": 1 and "rules")`);
  }
  const out: Record<string, RuleLines> = {};
  for (const [id, v] of Object.entries(table as Record<string, unknown>)) {
    const l = v as { problem_line?: { text?: unknown; template?: unknown }; fix_line?: unknown } | null;
    const ok =
      typeof l?.problem_line?.text === "string" &&
      (l.problem_line.template === undefined || typeof l.problem_line.template === "string") &&
      typeof l.fix_line === "string";
    if (!ok) throw new Error(`${RULE_LINES_FILE}: the entry for ${id} is not a problem_line with a text and a fix_line`);
    out[id] = l as RuleLines;
  }
  return out;
}

/**
 * Narrow a loaded bundle to the rules named in `spec`, a comma-separated list of rule ids.
 *
 * ## Why it is here and not in the engine
 *
 * The selection has to happen AFTER `loadBundle` — the integrity digests in `manifest.files` are
 * about the published bundle and not about one run's selection, so they are verified whole — and
 * BEFORE anything reads `bundle.rules`. Every consumer downstream (`prepareStructuralIfDeclared`,
 * `runScan`, `summarize`, `toSarif`) already takes its rule set from that one array, so replacing
 * the array once here is the whole of the change: no consumer learns that a selection exists and no
 * filtering logic is written twice. Putting it inside `runBuiltin` instead would have left
 * `summarize`, the roster and the SARIF run to filter themselves — four copies of one predicate.
 *
 * ## What it does not do
 *
 * It does not touch `checklists`, `manifest` or `dir`. A checklist is not a rule; the applicability
 * assessment reads the checklists and the run's own facts, so on a narrowed run it answers about
 * the narrowed run, exactly as every other per-run counter does.
 *
 * ## Order, and duplicates
 *
 * The kept rules stay in the bundle's own order rather than the order the caller typed, and a rule
 * named twice is kept once: the engine walks the compiled array per file, so bundle order is the
 * order in which a file is offered to rules, and reproducing it means a narrowed run and a whole
 * run offer the same file to the same rules in the same relative order.
 *
 * An unknown id is a hard error rather than a silent no-op. The whole purpose of the option is to
 * stand in for a full scan when checking that no matched line disappeared, and a mistyped id that
 * scanned nothing would answer that check with a confident, empty "nothing disappeared".
 */
export function selectRules(bundle: LoadedBundle, spec: string): LoadedBundle {
  const wanted = spec
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (wanted.length === 0) {
    throw new Error(`--rules was given no rule id: "${spec}"`);
  }
  const present = new Set(bundle.rules.map((r) => r.id));
  const unknown = wanted.filter((id) => !present.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `--rules names ${unknown.length} rule id(s) this bundle does not contain: ${unknown.join(", ")}. ` +
        `Nothing was scanned. The bundle at ${bundle.dir} carries ${bundle.rules.length} rules.`,
    );
  }
  const keep = new Set(wanted);
  return { ...bundle, rules: bundle.rules.filter((r) => keep.has(r.id)) };
}
