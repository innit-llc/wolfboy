#!/usr/bin/env node
/**
 * The last step of `npm pack` / `npm publish` (prepack): refuse to pack anything but the public form, by reading every
 * file the pack would ship, after the earlier steps have copied their parts in.
 *
 *   node scripts/pack-public-only.mjs
 *
 * WHY. The package is released
 * only from the public tree, which the export writes with every record marker removed and with the rules in their
 * public form. The private source tree holds the same package with its markers in place - in the plugin's text, in the
 * comments the compiler keeps in dist/, in the schemas' descriptions - and nothing refused a pack there.
 *
 * WHAT IS READ, AND WHEN: every file the pack ships, by its content, whatever chose it. This step read the trees the copy steps copy from, before
 * they ran, and never the bundle: `pack-bundle.mjs` takes the bundle from PACK_BUNDLE_DIR where that is set, and a pack
 * of the public export with it pointed at the private tree's bundle passed and would have published every rule's
 * authoring record (550,210 characters of it) to npm, which cannot be undone. So it runs last, after every copy, and
 * reads exactly the files npm itself lists for this pack: `npm pack --dry-run --json --ignore-scripts` in the package's
 * folder. Until this change the step read its own reading of npm's
 * rules (the `files` field with its globs, the files npm adds whatever `files` says), which agreed on this package but
 * not on every shape npm reads - a brace or character-class glob in `files`, `bundleDependencies` - so a file npm ships
 * could go unread. Which source a copy step chose, and by
 * which variable, does not matter: what npm would ship is what is read. Where npm cannot give that list, nothing is
 * packed.
 *
 * WHAT IS REFUSED (scripts/public-only-check.mjs, the check release-pack.mjs also runs on the tarball npm wrote,
 * because npm can change the files after this step): three signs the public form never carries, each by content, and
 * anything it cannot read for them.
 * - A record marker, its opener followed by any white space or by nothing. The export removes every one and refuses a
 *   tree where one survives.
 * - A path into the private workspace's record folders: the evaluation folder as a path part (at the start, after a
 *   slash or backslash - so absolute, `./`, `../` and Windows paths too - or after a character no path holds, then a
 *   separator and a name), or the corpus cache's own name; never a word. The export's term check refuses both in every
 *   file it copies, and the rule build in every field of a rule but its authoring record.
 * - `provenance`, the rule's authoring record, at any depth of any file of the bundle (a key of the parsed JSON; in a
 *   file that is not JSON, a quoted key and a colon), which the public projection drops (its list of public fields
 *   leaves it out) and nothing that runs reads.
 * - A file that is not UTF-8 text with no NUL, unless it is a binary the pack ships on purpose (`KNOWN_BINARY`: the
 *   grammars' WebAssembly modules), whose bytes are still read for the first two signs; and a file or folder it cannot
 *   read at all. A sign in UTF-16 or in a compressed file is not one this step can see, so such a file is refused, not
 *   passed unread.
 * On a refusal this step runs the package's own postpack, so the copies the earlier steps made are removed again and
 * nothing is left behind, and npm writes no tarball. The words that would be refused are spelled in pieces below, so
 * this file holds none of them.
 *
 * WHEN IT DOES NOT RUN: `npm pack --ignore-scripts`, or `ignore-scripts=true` in any npmrc (a common hardening), skips
 * every prepack step, this one with them. So a release is packed with `node scripts/release-pack.mjs`, which runs the
 * prepack steps and this one itself, whatever npm's settings, then packs with npm's scripts off, then runs postpack, and then runs the same check on the tarball npm wrote: npm's
 * scripts off still run the package's `prepare`, after this step.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { publicOnlyRefusals } from "./public-only-check.mjs";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));

/** The package's own postpack, which removes the copies the earlier prepack steps made, then exit 1. */
const refuse = (sentences) => {
  for (const r of sentences) console.error(r);
  const undo = spawnSync(pkg.scripts?.postpack ?? "", { cwd: PKG, shell: true, stdio: ["ignore", 2, 2] });
  if (undo.status !== 0) console.error(`pack: the copies the earlier steps made could not all be removed (postpack exit ${undo.status}); remove them by hand.`);
  process.exit(1);
};

// The files npm would ship, from npm: the npm that runs this step where it is npm (npm_execpath), else npm on PATH. Its
// scripts are off, so this step is not run again; the npm_config_ variables npm set for this step are the outer
// command's own options (a pack destination, a workspace, --json) and are not handed on.
const npmCli = /npm-cli\.[cm]?js$/.test(process.env.npm_execpath ?? "") ? process.env.npm_execpath : null;
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_config_/i.test(k)));
const npmArgs = ["pack", "--dry-run", "--json", "--ignore-scripts"];
const listed = npmCli
  ? spawnSync(process.execPath, [npmCli, ...npmArgs], { cwd: PKG, env, encoding: "utf8", maxBuffer: 1 << 28 })
  : spawnSync("npm", npmArgs, { cwd: PKG, env, encoding: "utf8", maxBuffer: 1 << 28, shell: process.platform === "win32" });
let npmFiles = null;
try {
  const doc = listed.status === 0 ? JSON.parse(listed.stdout) : null;
  const paths = Array.isArray(doc) && doc.length === 1 && Array.isArray(doc[0]?.files) ? doc[0].files.map((f) => f?.path) : null;
  npmFiles = paths !== null && paths.length > 0 && paths.every((f) => typeof f === "string" && f !== "") && paths.includes("package.json") ? paths : null;
} catch {
  npmFiles = null;
}
if (npmFiles === null) {
  const why = listed.error ? listed.error.message : `exit ${listed.status}${(listed.stderr ?? "").trim() ? `: ${(listed.stderr ?? "").trim().split("\n").at(-1).slice(0, 200)}` : ""}`;
  refuse([`pack: refusing to pack: npm did not list the files this package would ship (npm pack --dry-run --json --ignore-scripts, ${why}), so what would ship cannot be checked.`]);
}
const files = new Set();
const unreadable = [];
for (const f of npmFiles) {
  const path = resolve(PKG, f);
  if (path !== PKG && !path.startsWith(PKG + sep)) unreadable.push([path, "outside the package's folder"]);
  else files.add(path);
}

const shown = (f) => relative(join(PKG, "..", ".."), f);
// The check itself is scripts/public-only-check.mjs, which release-pack.mjs also runs on the tarball npm wrote, since
// npm can still change a file after this step.
const entries = unreadable.map(([f, error]) => ({ rel: relative(PKG, f), shown: shown(f), error }));
for (const f of files) {
  try {
    entries.push({ rel: relative(PKG, f), shown: shown(f), bytes: readFileSync(f) });
  } catch (e) {
    entries.push({ rel: relative(PKG, f), shown: shown(f), error: e.code ?? e.message });
  }
}
const refusals = publicOnlyRefusals(entries);
// The copies the earlier prepack steps made are removed by the package's own postpack, so a refusal leaves nothing behind.
if (refusals.length > 0) refuse(refusals);
// stderr, not stdout: `npm pack --json` prints its JSON on stdout after the prepack scripts.
console.error(`pack: ${files.size} file(s) read, none with a record marker, a path into the private workspace, a rule's authoring record or content it cannot read`);
