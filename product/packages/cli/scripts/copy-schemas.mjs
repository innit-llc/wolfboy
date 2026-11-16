#!/usr/bin/env node
/**
 * Copy the JSON Schemas into this package, as `schemas/`, for the packed package to SHIP them for people to read
 * (`copy`, the `prepack` step), and remove that copy after the pack (`remove`, the `postpack` step).
 *
 * WHAT IT IS NOT: anything the program reads. The CLI carries its schemas in its own compiled code
 * (`src/schemas.generated.ts`, `scripts/schemas-module.mjs`); for a time it read this folder at run
 * time, which only `npm run build` wrote, and every other way of building or copying the CLI broke on it (seven times).
 * The package still ships the files because they are the public statement of the documents the program writes and
 * reads (`findings.json`, the evidence log, a ScanProfile, the replies): a user, a CI job or an agent validating one
 * of them needs the schema, and `test:release-package` (C) checks the shipped files are exactly the compiled-in ones.
 *
 * WHY A COPY AT ALL. The schemas used to reach the CLI through a dependency on `wolfboy-schemas` declared as
 * `workspace:*`, and `npm pack` writes that range into the tarball verbatim, so `npm install` of the packed CLI failed
 * with EUNSUPPORTEDPROTOCOL. The schemas package
 * stays the one source: this directory is generated, ignored by git, and removed first so a schema deleted at the
 * source cannot survive here.
 */
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(PKG, "..", "schemas", "schemas");
const TARGET = join(PKG, "schemas");

if (process.argv[2] === "remove") {
  rmSync(TARGET, { recursive: true, force: true });
  process.exit(0);
}
const names = readdirSync(SOURCE).filter((n) => n.endsWith(".schema.json")).sort();
if (names.length === 0) {
  console.error(`copy-schemas: no *.schema.json under ${SOURCE}`);
  process.exit(1);
}
rmSync(TARGET, { recursive: true, force: true });
mkdirSync(TARGET, { recursive: true });
for (const n of names) cpSync(join(SOURCE, n), join(TARGET, n));
// stderr, not stdout: `npm pack --json` prints its JSON on stdout after the prepack scripts.
console.error(`copy-schemas: ${names.length} schemas -> ${TARGET}`);
