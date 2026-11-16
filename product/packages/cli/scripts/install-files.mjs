#!/usr/bin/env node
/**
 * install-files.json: every file of every package the plugin's npm-shrinkwrap.json installs, with its size, written at
 * pack time and checked by the program before it loads any of them (src/install-guard.ts).
 *
 *   node scripts/install-files.mjs copy     (prepack) write install-files.json into the package's folder
 *   node scripts/install-files.mjs remove   (postpack) delete it
 *
 * WHY. The
 * launcher checked that the 6 packages the package.json names were present; the 4 that ajv pulls in were not checked,
 * so an install that stopped part way left one out and Node, walking up the folders above the plugin's cache, ran a
 * copy planted there (demonstrated with `fast-deep-equal` in `~/node_modules`). A package folder that kept its
 * package.json but lost its files was not refused either, and the scan ran without validating. The class is closed by
 * two things together: this list, which names the whole lock closure and each package's files, and the guard, which
 * refuses an install that does not hold them and refuses any module resolved outside the install.
 *
 * ONE SOURCE. The packages are the `node_modules/<name>` keys of npm-shrinkwrap.json (itself generated from
 * pnpm-lock.yaml by scripts/shrinkwrap.mjs), and each one's files are read from the workspace's own copy of exactly that
 * version: found the way Node finds it, from this package and then from the package that depends on it, and refused
 * where its package.json names another version. The registry's tarball of a name and version is the same bytes pnpm
 * extracted and npm extracts, so the list is what npm installs. Nothing is invented: a key that cannot be found refuses
 * the pack.
 */
import { cpSync, existsSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// The guard's lookup, from the build (the pack packs dist, so it is built first). Importing it runs nothing, in any
// folder: the guard acts only where the program's entries turn it on (src/install-guard-on.ts). The first form of this
// change turned it on where "this folder holds src/", which a package folder of dist alone does not, and the guard
// refused this script there once the pack had copied the plugin's manifest in.
import { packageFolder } from "../dist/install-guard.js";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
export const LIST_FILE = "install-files.json";

/**
 * The packages npm-shrinkwrap.json in `pkgDir` installs: key, name, version and the names each depends on - its
 * dependencies, optional dependencies and peers that the closure installs (ajv-formats loads ajv, which its lock entry
 * names as an optional dependency and a peer): the guard finds each package as Node does, so it must know every package
 * a lock entry can make Node load.
 */
export function lockClosure(pkgDir) {
  const lock = JSON.parse(readFileSync(join(pkgDir, "npm-shrinkwrap.json"), "utf8"));
  const out = [];
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (key === "") continue;
    const m = /^node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(key);
    if (m === null) throw new Error(`install-files: npm-shrinkwrap.json holds ${key}, a key this script does not lay out (only node_modules/<name>)`);
    const needs = [...new Set([entry.dependencies, entry.optionalDependencies, entry.peerDependencies].flatMap((d) => Object.keys(d ?? {})))];
    out.push({ key, name: m[1], version: entry.version, dependencies: needs.filter((d) => lock.packages[`node_modules/${d}`] !== undefined).sort() });
  }
  const root = Object.keys(lock.packages?.[""]?.dependencies ?? {});
  return { root, packages: out };
}

/**
 * The real folder of package `name` that Node finds from `from` (a folder), or null: the install guard's own lookup
 * (`packageFolder` in dist/install-guard.js, Node's "Loading from node_modules folders"), so the list is made by the
 * lookup the program checks it with. A folder found with no package.json is not a package.
 */
function nodeFinds(name, from) {
  const at = packageFolder(name, from);
  return at !== null && existsSync(join(at, "package.json")) ? realpathSync(at) : null;
}

/**
 * Each package of the closure of `lockDir`'s npm-shrinkwrap.json, as the workspace holds it: a Map key -> real folder,
 * found from `workspaceDir` (the CLI package of the workspace) and then from each package found. Throws where a
 * package is not found or its package.json names another name or version.
 */
export function workspaceCopies(lockDir, workspaceDir = lockDir) {
  const { root, packages } = lockClosure(lockDir);
  const byName = new Map(packages.map((p) => [p.name, p]));
  const found = new Map();
  const queue = root.map((name) => [name, workspaceDir]);
  while (queue.length > 0) {
    const [name, from] = queue.shift();
    const p = byName.get(name);
    if (p === undefined) throw new Error(`install-files: ${name} is depended on but npm-shrinkwrap.json does not install it`);
    if (found.has(p.key)) continue;
    const dir = nodeFinds(name, from);
    if (dir === null) throw new Error(`install-files: the workspace holds no ${name} where Node would find it from ${from}`);
    const own = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    if (own.name !== name || own.version !== p.version) throw new Error(`install-files: the workspace's ${name} at ${dir} is ${own.name}@${own.version}, not ${name}@${p.version} as npm-shrinkwrap.json installs`);
    found.set(p.key, dir);
    for (const d of p.dependencies) queue.push([d, dir]);
  }
  const unreached = packages.filter((p) => !found.has(p.key)).map((p) => p.key);
  if (unreached.length > 0) throw new Error(`install-files: npm-shrinkwrap.json installs ${unreached.join(", ")}, which nothing it installs depends on`);
  return found;
}

/** Every regular file under `dir` (its own node_modules left out), as [path with "/", size], sorted. */
export function filesOf(dir) {
  const out = [];
  const walk = (at, rel) => {
    for (const e of readdirSync(at, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const path = join(at, e.name);
      const r = rel === "" ? e.name : `${rel}/${e.name}`;
      const st = statSync(path);
      if (st.isDirectory()) walk(path, r);
      else if (st.isFile()) out.push([r, st.size]);
    }
  };
  walk(dir, "");
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** The list for `lockDir`'s closure, the packages read from the workspace copies. */
export function installList(lockDir, workspaceDir = lockDir) {
  const copies = workspaceCopies(lockDir, workspaceDir);
  const { root, packages } = lockClosure(lockDir);
  return {
    about: "Every file of every package npm-shrinkwrap.json installs, with its size, and the names each package and the plugin (root) depend on; the program finds each package from the one that depends on it and refuses an install that does not hold them (written by scripts/install-files.mjs at pack time).",
    root,
    packages: Object.fromEntries(packages.map((p) => [p.key, { version: p.version, dependencies: p.dependencies, files: filesOf(copies.get(p.key)) }])),
  };
}

/**
 * `lockDir`'s lock closure laid into `dest` as npm installs it - each package copied flat into dest/node_modules - with
 * the list beside it: how an installed plugin holds its packages. For the tests that build an installed copy of the
 * program, which refuses packages linked in from outside its install.
 */
export function installLikeNpm(dest, lockDir = PKG, workspaceDir = lockDir) {
  for (const [key, dir] of workspaceCopies(lockDir, workspaceDir)) cpSync(dir, join(dest, key), { recursive: true, dereference: true });
  writeFileSync(join(dest, LIST_FILE), `${JSON.stringify(installList(lockDir, workspaceDir))}\n`);
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const mode = process.argv[2];
  const out = join(PKG, LIST_FILE);
  if (mode === "copy") {
    const list = installList(PKG);
    writeFileSync(out, `${JSON.stringify(list)}\n`);
    const n = Object.values(list.packages).reduce((a, p) => a + p.files.length, 0);
    // stderr: `npm pack --json` prints its JSON on stdout, which the release steps read
    process.stderr.write(`install-files: ${Object.keys(list.packages).length} packages, ${n} files listed in ${LIST_FILE}\n`);
  } else if (mode === "remove") {
    rmSync(out, { force: true });
  } else {
    console.error("usage: node scripts/install-files.mjs copy | remove");
    process.exit(2);
  }
}
