#!/usr/bin/env node
/**
 * Put the Claude Code plugin into this package for `npm pack` / `npm publish`, and take it out again after.
 *
 *   node scripts/pack-plugin.mjs copy     (prepack)
 *   node scripts/pack-plugin.mjs remove   (postpack)
 *
 * WHY. The plugin runs this program, and an installed plugin is the program's own
 * package: the marketplace entry names this npm package as the plugin's source, Claude Code unpacks it as the plugin's
 * folder and installs its dependencies from npm-shrinkwrap.json, and the plugin's launcher (bin/legal-scan, through
 * bin/node-choice.bash) finds dist/index.js in that same folder. One artefact, so the plugin and the program it runs
 * are always the same version, and nothing is looked up on PATH.
 *
 * WHAT IS COPIED. Every top-level entry of the plugin's folder (product/plugin): .claude-plugin/, agents/, bin/,
 * hooks/ and skills/. They are copied, never linked; `remove` deletes them so the workspace keeps one copy. File modes
 * are kept (bin/legal-scan and bin/legal-hook stay executable). Not its README.md, which stays in the repository
 * (product/plugin/README.md, linked from the root README): since 0.1.2 this package's README, its npm page, is the
 * repository's root README, which scripts/pack-readme.mjs writes.
 *
 * WHAT IS REFUSED: ANY CLASH, COMPUTED.
 * An entry of the plugin's folder whose name this package's folder already holds - any entry, read from the folder at
 * the time of the copy, never from a list of names - is refused, with nothing copied: the copy would overwrite the
 * package's own file, and `remove` would then delete it. The one exception is a file with the same bytes as the
 * package's own file of that name: it is the package's already, so it is neither copied nor removed. That is the
 * licence: product/plugin/LICENSE (for the plugin read from the source tree) and this package's LICENSE are one text,
 * which test:release-package G holds equal.
 *
 * WHAT `remove` DELETES: exactly what `copy` wrote, as `copy` lists it in COPIED (written before the first entry is
 * copied, so a copy that stopped half-way is undone too), and nothing else; then COPIED itself. A `copy` that finds a
 * COPIED left by a pack that never reached its `remove` deletes those copies first, so they are not read as clashes.
 *
 * COPIED IS READ AS A CLAIM, NOT TRUSTED. The file sits in
 * the package's folder, so anything that writes there can change it: a list naming `src` and `package.json` deleted the package's own files, and a list that was not JSON stopped both steps with a stack trace.
 * Every name must be one `copy` could have written - a plain entry name (not empty, not `.` or `..`, holding no `/`,
 * `\`, `:` or NUL, so it cannot reach outside the package on Linux or Windows) that the plugin's folder holds now -
 * and the list must be a JSON array of such names; otherwise nothing is removed and the step stops with one sentence
 * naming the file and the first name refused. What it cannot tell apart: an entry the plugin and the package hold in
 * the same bytes (the licence), which `copy` never lists; a list naming it removes the package's copy of a text the
 * plugin's folder holds too.
 */
import { cpSync, existsSync, lstatSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(PKG, "..", "..", "plugin");
const COPIED = join(PKG, ".pack-plugin-copied.json");
const mode = process.argv[2];

/**
 * Why COPIED's text is not a list `copy` could have written (the first problem, in words), or null. `listing` is the
 * plugin folder's entries now.
 */
function copiedListProblem(text, listing) {
  let names;
  try {
    names = JSON.parse(text);
  } catch {
    return "it is not JSON";
  }
  if (!Array.isArray(names)) return "it is not a list";
  for (const n of names) {
    if (typeof n !== "string" || n === "" || n === "." || n === ".." || /[\\/:\0]/.test(n)) return `it names ${JSON.stringify(n)}, which is not a plain entry name`;
    if (!listing.includes(n)) return `it names ${JSON.stringify(n)}, which the plugin's folder does not hold`;
  }
  return null;
}

/** The entries a `copy` wrote, from COPIED, removed with COPIED itself; a COPIED that is not such a list stops the step. */
const removeCopies = () => {
  if (!existsSync(COPIED)) return [];
  const text = readFileSync(COPIED, "utf8");
  const problem = copiedListProblem(text, existsSync(SOURCE) ? readdirSync(SOURCE) : []);
  if (problem !== null) {
    console.error(`pack-plugin: ${COPIED} is not the list of copies this step writes (${problem}), so nothing was removed; delete it by hand once the package folder holds only its own files.`);
    process.exit(1);
  }
  const names = JSON.parse(text);
  for (const n of names) rmSync(join(PKG, n), { recursive: true, force: true });
  rmSync(COPIED, { force: true });
  return names;
};

if (mode === "remove") {
  removeCopies();
  process.exit(0);
}
if (mode !== "copy") {
  console.error("pack-plugin: usage: pack-plugin.mjs copy|remove");
  process.exit(1);
}
if (!existsSync(join(SOURCE, ".claude-plugin", "plugin.json"))) {
  console.error(`pack-plugin: no plugin at ${SOURCE} (no .claude-plugin/plugin.json)`);
  process.exit(1);
}
removeCopies();
const entries = readdirSync(SOURCE).filter((e) => e !== "README.md").sort();
const holds = (p) => {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
};
// A file of the plugin's folder with the same bytes as the package's own regular file of that name: already here.
const sameFile = (e) => {
  const a = lstatSync(join(SOURCE, e));
  const b = lstatSync(join(PKG, e));
  return a.isFile() && b.isFile() && readFileSync(join(SOURCE, e)).equals(readFileSync(join(PKG, e)));
};
const held = entries.filter((e) => holds(join(PKG, e)));
const shared = held.filter((e) => sameFile(e));
const clash = held.filter((e) => !shared.includes(e));
if (clash.length > 0) {
  console.error(`pack-plugin: the plugin's folder holds ${clash.join(", ")}, which this package holds too; refusing to overwrite the program's own file`);
  process.exit(1);
}
const copied = entries.filter((e) => !shared.includes(e));
writeFileSync(COPIED, `${JSON.stringify(copied)}\n`);
for (const e of copied) cpSync(join(SOURCE, e), join(PKG, e), { recursive: true, preserveTimestamps: false });
// stderr, not stdout: `npm pack --json` prints its JSON on stdout after the prepack scripts.
console.error(`pack-plugin: ${copied.length} entries of the plugin (${copied.join(", ")}) -> ${PKG}${shared.length > 0 ? `; already the package's own, same bytes: ${shared.join(", ")}` : ""}`);
