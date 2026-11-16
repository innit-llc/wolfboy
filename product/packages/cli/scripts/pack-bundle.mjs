#!/usr/bin/env node
/**
 * Put the rule bundle into this package for `npm pack` / `npm publish`, and take it out again after.
 *
 *   node scripts/pack-bundle.mjs copy     (prepack)
 *   node scripts/pack-bundle.mjs remove   (postpack)
 *
 * WHY. The CLI scans nothing without a bundle, and the decision of 2026-09-05
 * is that the bundle ships inside the CLI. The bundle is a build output, so it is copied in at pack
 * time and never committed; `remove` deletes the copy so a later dev build cannot read a stale one.
 *
 * WHICH BUNDLE. `PACK_BUNDLE_DIR` when it is set, else `dist/bundle` at the repository root. The
 * public release must pack the bundle built from the public form of the rules, not the private
 * sources; that build does not exist yet, and naming it is the release's
 * job, through this variable. Whichever bundle this step copies, the last prepack step (pack-public-only.mjs) reads
 * the copy and refuses one whose rules carry their authoring record (`provenance`) or name a path into the private
 * workspace.
 *
 * WHAT IT REFUSES. A directory with no manifest, a manifest that lists no files, and any listed file
 * whose sha256 differs from the manifest's. Only the manifest and the files it lists are copied.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = join(PKG, "bundle");
const mode = process.argv[2];

if (mode === "remove") {
  rmSync(TARGET, { recursive: true, force: true });
  process.exit(0);
}
if (mode !== "copy") {
  console.error("pack-bundle: usage: pack-bundle.mjs copy|remove");
  process.exit(1);
}

const SOURCE = process.env.PACK_BUNDLE_DIR ? resolve(process.env.PACK_BUNDLE_DIR) : join(PKG, "..", "..", "..", "dist", "bundle");
const manifestPath = join(SOURCE, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`pack-bundle: no bundle at ${SOURCE} (no manifest.json). Build it first (npm run build:bundle), or set PACK_BUNDLE_DIR.`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const files = Object.entries(manifest.files ?? {});
if (files.length === 0) {
  console.error(`pack-bundle: ${manifestPath} lists no files`);
  process.exit(1);
}
for (const [name, digest] of files) {
  const got = createHash("sha256").update(readFileSync(join(SOURCE, name))).digest("hex");
  if (got !== digest) {
    console.error(`pack-bundle: ${name} does not match the manifest (sha256 ${got}, manifest ${digest}); refusing to pack it`);
    process.exit(1);
  }
}
rmSync(TARGET, { recursive: true, force: true });
mkdirSync(TARGET, { recursive: true });
cpSync(manifestPath, join(TARGET, "manifest.json"));
for (const [name] of files) cpSync(join(SOURCE, name), join(TARGET, name));
// stderr, not stdout: `npm pack --json` prints its JSON on stdout after the prepack scripts.
console.error(`pack-bundle: bundle ${manifest.bundle_version} (${files.length} files) -> ${TARGET}`);
