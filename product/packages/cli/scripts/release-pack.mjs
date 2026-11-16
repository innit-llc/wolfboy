#!/usr/bin/env node
/**
 * The release's pack of this package: the one way a release tarball is made, from the public export.
 *
 *   node scripts/release-pack.mjs [--pack-destination <folder>] [--json] [--dry-run] [--ignore-scripts]
 *
 * WHY.
 * The pack's safeguard (scripts/pack-public-only.mjs, the last prepack step) refuses a tree that is not the public form. npm runs
 * prepack only when scripts are on: `npm pack --ignore-scripts`, or `ignore-scripts=true` in any npmrc, skips every
 * prepack step (it still runs `prepare`: below), and a pack of the private tree then ships its record markers, refused
 * by nothing; a publish of it cannot be undone. This procedure does not depend on npm's settings: it runs the
 * package's own prepack steps itself, through a
 * shell as npm would, and stops where any of them fails - the safeguard among them - with nothing packed; only then does
 * it run `npm pack --ignore-scripts` (so npm does not run the prepack steps a second time) with the options it was given,
 * and then the package's own postpack, which removes the copies the steps made. Where a prepack step fails, postpack runs
 * too, so nothing is left behind; the safeguard's own refusal has already run it, and a second run removes nothing more.
 *
 * THEN THE TARBALL ITSELF IS READ. npm's scripts off do not stop npm itself: `npm pack --ignore-scripts` still runs the package's `prepare` script
 * (npm 10.9.3), after the safeguard above, so a `prepare` could rewrite a file the safeguard had passed. So once npm has
 * written the tarball, this script reads every entry of it with the safeguard's own check (scripts/public-only-check.mjs,
 * imported before any step of the package runs, so no step can change it) and checks that its bytes are the ones whose
 * integrity npm printed; where either fails, the tarball is removed and nothing is printed on stdout (exit 1). The
 * check reads the artefact, not its inputs, so nothing npm or a script did before the tarball existed can pass it
 * unread. npm is always asked for its JSON (`--json`) and given the destination (`--pack-destination=<folder>`, `.` where
 * none is given), so the tarball's name and place are npm's own answer, whatever its settings; stdout carries npm's
 * JSON where `--json` was given, else the tarball's file name, as `npm pack` prints it.
 *
 * ONLY THOSE OPTIONS, EACH IN ITS OWN SHAPE. Anything else is refused before any step runs: a folder or tarball
 * named on the command line would make npm pack something other than the folder whose prepack steps ran here, and an
 * option this script does not know could do the same. `--json`,
 * `--dry-run` and `--ignore-scripts` are taken as those exact words only (`--json=false` is refused).
 * `--pack-destination` takes one folder, given once, that is not empty and does not begin with `-`, and is handed on as
 * `--pack-destination=<folder>`: until this change the word after it was handed on whatever it was, and npm's option
 * reader takes a word that looks like an option as an option, so `--pack-destination --ignore-scripts=false` turned
 * npm's scripts back on.
 *
 * THE RELEASE PROCEDURE, IN ORDER: the public export, run in the private workspace, writes the public tree; the public
 * tree's README build lines build it; this script, in the public tree's product/packages/cli, packs it.
 * This script never publishes: publishing is a separate step, decided on that tarball, and run on the tarball with
 * npm's scripts off (`npm publish <tarball> --ignore-scripts`), never on the folder.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publicOnlyRefusals, tarballEntries } from "./public-only-check.mjs";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));
const step = (script) => spawnSync(script, { cwd: PKG, shell: true, stdio: ["ignore", 2, 2] });

const given = process.argv.slice(2);
const passed = [];
let destination = null;
const refuse = (sentence) => {
  console.error(`release-pack: ${sentence}, so nothing was run.`);
  process.exit(2);
};
for (let i = 0; i < given.length; i++) {
  const a = given[i];
  if (a === "--ignore-scripts") continue; // npm's scripts are off for the pack below whatever is given
  if (a === "--json" || a === "--dry-run") {
    if (!passed.includes(a)) passed.push(a);
    continue;
  }
  let folder = null;
  if (a === "--pack-destination") {
    if (i + 1 >= given.length) refuse("--pack-destination is given without a folder after it");
    folder = given[++i];
  } else if (a.startsWith("--pack-destination=")) folder = a.slice("--pack-destination=".length);
  else refuse(`${JSON.stringify(a)} is not an option this script hands to npm pack (only --pack-destination <folder>, --json, --dry-run and --ignore-scripts)`);
  if (destination !== null) refuse("--pack-destination is given twice");
  if (folder === "" || folder.startsWith("-")) refuse(`--pack-destination takes a folder, and ${JSON.stringify(folder)} is not one: it is empty or begins with "-", which npm would read as an option`);
  destination = folder;
}
const wantJson = passed.includes("--json");
const dryRun = passed.includes("--dry-run");
const npmArgs = ["pack", "--ignore-scripts", ...passed.filter((a) => a !== "--json"), "--json", `--pack-destination=${destination ?? "."}`];

const pre = step(pkg.scripts?.prepack ?? "false");
if (pre.status !== 0) {
  step(pkg.scripts?.postpack ?? "true");
  console.error(`release-pack: a prepack step refused or failed (exit ${pre.status}), so nothing was packed; the lines above say which and why.`);
  process.exit(1);
}
const packed = spawnSync("npm", npmArgs, { cwd: PKG, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", maxBuffer: 1 << 28 });
const post = step(pkg.scripts?.postpack ?? "true");
if (post.status !== 0) console.error(`release-pack: postpack failed (exit ${post.status}); the copies the prepack steps made may still be in ${PKG}.`);
if (packed.status !== 0) process.exit(1);
let told = null;
try {
  const doc = JSON.parse(packed.stdout);
  told = Array.isArray(doc) && doc.length === 1 && typeof doc[0]?.filename === "string" && typeof doc[0]?.integrity === "string" ? doc[0] : null;
} catch {
  told = null;
}
if (told === null) {
  console.error("release-pack: npm pack did not print the tarball it wrote (its JSON names no filename and integrity), so the tarball cannot be checked; nothing is printed as packed.");
  process.exit(1);
}
if (!dryRun) {
  const tarball = resolve(PKG, destination ?? ".", told.filename);
  let refusals;
  try {
    const bytes = readFileSync(tarball);
    const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    refusals =
      integrity !== told.integrity
        ? [`release-pack: refusing the tarball npm wrote: ${tarball} is not the file whose integrity npm printed (${integrity.slice(0, 20)}..., npm printed ${told.integrity.slice(0, 20)}...).`]
        : publicOnlyRefusals(tarballEntries(bytes), { lead: "release-pack: refusing the tarball npm wrote:", ships: "the tarball holds" });
  } catch (e) {
    refusals = [`release-pack: refusing the tarball npm wrote: ${tarball} cannot be read as a gzip'd tar (${e.code ?? e.message}), so what would ship cannot be checked.`];
  }
  if (refusals.length > 0) {
    for (const r of refusals) console.error(r);
    rmSync(tarball, { force: true });
    console.error(`release-pack: the tarball was removed; a step npm ran after the safeguard, or npm itself, put into it what the safeguard refuses (the package's prepare script runs even with npm's scripts off).`);
    process.exit(1);
  }
  console.error(`release-pack: ${told.filename}: every entry read, none with a record marker, a path into the private workspace, a rule's authoring record or content it cannot read`);
}
process.stdout.write(wantJson ? packed.stdout : `${told.filename}\n`);
process.exit(post.status === 0 ? 0 : 1);
