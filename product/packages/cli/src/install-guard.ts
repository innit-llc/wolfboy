/**
 * THE INSTALL GUARD: NO MODULE FROM OUTSIDE THE SHIPPED INSTALL.
 *
 * Turned on by install-guard-on.ts, which every module the program starts a process or a thread with imports first
 * (index.js, hook-entry.js, hook-child.js, worker-entry.js, census-worker.js, ruby-prism.js), so it runs before any
 * package's code does: a module is evaluated after the modules it imports, in the order it imports them,
 * install-guard-on.ts imports this module alone, and this module imports only Node's own.
 * IMPORTING THIS MODULE RUNS NOTHING. Before this change the check
 * ran at the top of this module, so whatever imported it for one of its functions ran the check too: the pack's own
 * install-files.mjs, which takes `packageFolder` from here, was refused in a package folder holding dist and no src/,
 * once pack-plugin.mjs had copied the plugin's manifest in beside dist (the pack of the public layout, test:release-
 * package section C). Which folder looks installed cannot tell the two apart (the pack makes the package folder look
 * installed, on purpose); which code runs can: the guard acts where the program starts, through install-guard-on.ts,
 * and nowhere else.
 *
 * What it closes. Node looks for a package in the node_modules of the importing file's folder and of every folder
 * above it, and for `require` also in the person's ~/.node_modules and ~/.node_libraries. The launcher (node-choice.bash)
 * checked only that the 6 packages package.json names were present: the 4 ajv pulls in were not checked, and an install
 * that stopped part way without `fast-deep-equal` ran a copy planted in `~/node_modules` (on native Windows,
 * `C:\node_modules`, a folder any local user may create). A package folder that kept its package.json but lost its
 * files was not refused either. In an installed plugin (its folder holds .claude-plugin/plugin.json) this module:
 * - checks install-files.json, written at pack time (scripts/install-files.mjs): every package of the lock closure
 *   (npm-shrinkwrap.json's `node_modules/<name>` keys), found the way Node finds it from the package that depends on
 *   it (`packageFolder`, beginning with this plugin's own package and the names its lock's root depends on), must sit
 *   inside the install (its real path), at the version listed, with every listed file present at its listed size. Else
 *   it refuses in one sentence and nothing runs. Since every package is then found inside the install, Node never needs
 *   to look above it.
 *   ONE MECHANISM FOR EVERY LAYOUT. The guard's earlier form refused installs npm had made
 *   correctly: it looked in two places it named by hand (the plugin's node_modules and the one it sits in), so it
 *   could not follow a package npm placed elsewhere: under the one that needs it (`node_modules/ajv/node_modules/
 *   fast-deep-equal`, where a project holds another version at the top), or under `node_modules/.store` behind a link
 *   (npm's `install-strategy=linked`). Asking where Node takes each package from the package that depends on it covers
 *   every placement, and the property that matters - nothing from outside the install - is checked on the answer. (The
 *   linked layout itself is still refused, rightly: npm 10.9.3 writes no store folder for ajv's four packages, so their
 *   links dangle, ajv cannot load, and Node walks on to the folders above; the sentence names the install that fixes
 *   it.)
 * - A package at another version than the list's is refused, with what causes it and the install that fixes it, and
 *   `npm ci` in the plugin's folder installs the pinned versions. Since R10-NPX (2026-11-10) package.json asks for every
 *   package of the closure at its exact version (scripts/shrinkwrap.mjs refuses a pack otherwise), so npm installs the
 *   pinned versions whether or not it reads npm-shrinkwrap.json, and another version comes only from outside the
 *   package: an override in the project it was installed into, or a changed folder. Before that, npm chose versions
 *   itself where it did not read the shrinkwrap (an install from a tarball file, a registry that does not mark the
 *   shrinkwrap, package-lock turned off), and `npx` refused on every patch release of a dependency. Why refused rather than
 *   run: the list holds the files of the pinned versions only, so another version's files cannot be checked (a package
 *   that lost its files ran the scan without validating), and the pinned versions are the ones the plugin was
 *   released and checked with; the shrinkwrap pins them so that a version published later is not run unseen.
 * - refuses any module resolved outside the install from then on: `module.registerHooks` (Node 22.15 and later) for
 *   `import` and `require` alike, and `Module._resolveFilename` for `require` in every version. So a module the
 *   list does not name, or one removed after the check, is not taken from a folder above either.
 * In a source checkout (src/ beside dist, or no .claude-plugin/plugin.json) it does nothing: the workspace's own layout
 * serves.
 *
 * A refusal, of the check or of a module found outside: in the main thread, the sentence on stderr and exit 2 (exit 3 under hook-entry.js, which the hooks'
 * launcher reads as "the hook could not run", so a scan under way fails closed); in a worker, an Error with the
 * sentence. Known limit: on a Node without `module.registerHooks` (20.x, 22.0-22.14) an `import` the list does not
 * name is not barred; every `import` the program and its packages make names a listed package, which the check finds
 * inside the install.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import * as nodeModule from "node:module";
import { basename, dirname, isAbsolute, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread } from "node:worker_threads";

export const INSTALL_LIST = "install-files.json";

/**
 * What fixes an install that does not hold the pinned packages in full: the install Claude Code runs
 * for the plugin, `npm ci --ignore-scripts` in the plugin's folder (read from its binary, check-r5-launcher-2026-11-03.md
 * section 1), which reads npm-shrinkwrap.json there and installs exactly its versions, in npm's default layout
 * (`--install-strategy=hoisted`, so an npmrc's `install-strategy=linked` does not apply: npm 10.9.3's linked layout
 * links ajv's four packages to store folders it never writes, so ajv cannot load, and Node, walking up past the dangling
 * links, would take a copy from a folder above the plugin). Before this
 * change the sentence said `claude plugin update`, which repeats the install that made the layout.
 */
const pinnedInstall = (cliDir: string): string =>
  `To install them as pinned, run npm ci --ignore-scripts --install-strategy=hoisted in the plugin's folder, ${cliDir} (npm's linked layout, which an npmrc's install-strategy=linked chooses, leaves out packages ajv needs).`;

/** The folders an install of the program in `cliDir` may load modules from: its own, and the node_modules it sits in. */
export function installRoots(cliDir: string): string[] {
  let up = dirname(cliDir);
  if (basename(up).startsWith("@")) up = dirname(up);
  return basename(up) === "node_modules" ? [cliDir, up] : [cliDir];
}

const fold = (p: string): string => (process.platform === "win32" ? p.toLowerCase() : p);

/** Whether `path` is one of `roots` or inside one. */
export function insideInstall(path: string, roots: readonly string[]): boolean {
  const p = fold(path);
  return roots.some((r) => p === fold(r) || p.startsWith(fold(r.endsWith(sep) ? r : r + sep)));
}

const isFileOf = (path: string, size?: number): boolean => {
  try {
    const st = statSync(path);
    return st.isFile() && (size === undefined || st.size === size);
  } catch {
    return false;
  }
};

/**
 * Whether Node's `require` takes `path` as a file: anything its stat (links followed) does not call a folder - a named
 * pipe, a socket or a device as much as a regular file - as Node's own lookup decides. Nothing is opened.
 */
const takenAsFile = (path: string): boolean => {
  try {
    return !statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** Whether the package folder `at` declares `exports` in its package.json, which `require` reads before any file. */
const declaresExports = (at: string): boolean => {
  try {
    const exportsField = (JSON.parse(readFileSync(join(at, "package.json"), "utf8")) as { exports?: unknown }).exports;
    return exportsField !== undefined && exportsField !== null;
  } catch {
    return false;
  }
};

const isDir = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * The folder Node takes package `name` from, for a module in folder `from`, or null where no folder holds it: the
 * `node_modules/<name>` of `from` and of every folder above it, nearest first, leaving out a folder that is itself
 * named node_modules - `require`'s lookup ("Loading from node_modules folders"); the first that exists is the one
 * `require` takes, whether or not it holds a package.json. Node's `import` reads other places as well, and `require`
 * takes a file before a folder: `otherLoaderPlace` refuses an install where any of those would be taken instead. The folder is given as found, links not followed. Node's
 * global folders (NODE_PATH, ~/.node_modules), which only `require` reads after these, are outside any install, so a
 * package found in none of these is refused whatever they hold. Shared with the pack-time list
 * (scripts/install-files.mjs), which finds the workspace's copy of each package by the same lookup.
 */
export function packageFolder(name: string, from: string): string | null {
  let dir = from;
  for (;;) {
    if (basename(dir) !== "node_modules") {
      const at = join(dir, "node_modules", name);
      if (isDir(at)) return at;
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * A place one of Node's loaders reads for a package before the folder this check read (`otherLoaderPlace`): which
 * loader, the folder whose modules ask for the package there, and whether the place is a file beside a package folder
 * that declares `exports` (which `require` reads first, so that file is not taken while the field is there).
 */
export type OtherPlace = { place: string; loader: "require" | "import"; asking: string; besideExports: boolean };

/**
 * NODE'S TWO LOADERS DO NOT READ THE SAME PLACES. `packageFolder` follows `require`. Node's `import` (its ESM resolver)
 * reads `node_modules/<name>` in every folder from the importing module's own up, a folder that is itself named
 * node_modules included, and takes the first that is a folder; `require` leaves those folders out. In each folder it
 * reads, `require` first reads the `exports` of `<place>/package.json` where there is one; else it takes `<place>`
 * itself, or `<place>.js`, `.json` or `.node`, where that is anything but a folder (`takenAsFile`), before it reads
 * `<place>` as a folder. So where the two would take different places, the copy this check reads is not the one every
 * module loads, and the other loads unchecked (inside the install, which the runtime hooks allow). npm writes none of
 * those places. Returns the first, from `from` up to `at` (`packageFolder`'s answer), where either loader would take
 * `name` instead of `at`, or a file beside `at` that `require` would take if `at` declared no `exports`; null where
 * neither is there.
 */
export function otherLoaderPlace(name: string, from: string, at: string): OtherPlace | null {
  let dir = from;
  for (;;) {
    const place = join(dir, "node_modules", name);
    if (basename(dir) === "node_modules") {
      if (isDir(place)) return { place, loader: "import", asking: dir, besideExports: false };
    } else {
      // the files `require` takes before it reads the place as a folder: the place with each extension it loads
      for (const ext of [".js", ".json", ".node"]) {
        if (takenAsFile(place + ext)) return { place: place + ext, loader: "require", asking: dir, besideExports: place === at && declaresExports(at) };
      }
      if (place === at) return null;
      if (takenAsFile(place)) return { place, loader: "require", asking: dir, besideExports: false };
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** The folders below a package's own folder that hold its files `rels` (`a/b/c.js` gives `a/b` and `a`). */
const foldersOf = (rels: readonly string[]): Set<string> => {
  const out = new Set<string>();
  for (const rel of rels) {
    const parts = rel.split("/");
    for (let k = parts.length - 1; k > 0; k--) out.add(parts.slice(0, k).join("/"));
  }
  return out;
};

/** The program's own build folder `dist` and every folder in it, relative to `cliDir` (links not followed). */
function buildFolders(cliDir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    out.push(rel);
    let entries;
    try {
      entries = readdirSync(join(cliDir, ...rel.split("/")), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) if (e.isDirectory()) walk(`${rel}/${e.name}`);
  };
  walk("dist");
  return out;
}

/**
 * The first node_modules folder inside the folders of a package's own modules (`folders`, relative to `pkg`), or null.
 * Node's loaders start at the importing module's own folder, so one there is read before the package's own
 * node_modules; npm never writes one (its packs leave node_modules out).
 */
function nestedModules(pkg: string, folders: Iterable<string>): string | null {
  for (const f of folders) {
    const nm = join(pkg, ...f.split("/"), "node_modules");
    if (existsSync(nm)) return nm;
  }
  return null;
}

/** The refusal of a place npm never installs to that one of Node's loaders reads for a package. */
const loadedElsewhere = (name: string, other: OtherPlace, at: string): string =>
  other.loader === "import"
    ? `legal-scan: Node's import, asked for ${name} by a module of a package in ${other.asking}, would load ${other.place}, a folder npm never installs, instead of ${at}, the copy this check reads, so nothing was run. Remove ${other.place}.`
    : other.besideExports
      ? `legal-scan: ${other.place} is a file npm never installs, beside ${at}, the copy of ${name} this check reads. Node's require takes a file of that name before the folder of a package whose package.json has no "exports" field; ${name}'s has one, so the file is not taken now, but this check refuses any file at that name, so nothing was run. Remove ${other.place}.`
      : `legal-scan: Node's require, asked for ${name} by a module in ${other.asking}, would load ${other.place}, which npm never installs, instead of ${at}, the copy this check reads, so nothing was run. Remove ${other.place}.`;
/** The refusal of a node_modules inside the folders of a package's own modules. */
const nestedFolder = (nm: string, owner: string): string =>
  isDir(nm)
    ? `legal-scan: ${nm} is a node_modules folder inside the folders of ${owner}'s own modules, where npm never makes one. Node's loaders look in it for a package before the packages this check reads, so a package put there would be loaded instead of them, and nothing was run. Remove ${nm}.`
    : `legal-scan: ${nm} is inside the folders of ${owner}'s own modules, where npm never makes anything of that name. It is not a folder, so Node loads nothing from it as it is, but a node_modules folder there would be read before the packages this check reads, so nothing was run. Remove ${nm}.`;

type ListedPackage = { version?: unknown; files?: unknown; dependencies?: unknown };
const names = (v: unknown): v is string[] => Array.isArray(v) && v.every((n) => typeof n === "string" && /^(?:@[^/.][^/]*\/)?[^/.@][^/]*$/.test(n));

/** Null where the install in `cliDir` holds every package and file install-files.json lists; else the refusal. */
export function installProblem(cliDir: string): string | null {
  const listPath = join(cliDir, INSTALL_LIST);
  let list: { root?: unknown; packages?: Record<string, ListedPackage> };
  try {
    list = JSON.parse(readFileSync(listPath, "utf8"));
  } catch {
    return `legal-scan: this plugin's list of the files its packages install (${listPath}) is missing or cannot be read, so nothing was run. It ships in the plugin, so reinstall the plugin.`;
  }
  const roots = installRoots(cliDir);
  const notInFull = (what: string): string =>
    `legal-scan: this plugin's packages are not installed in full (${what}), so nothing was run. Claude Code installs them with npm when it installs the plugin, and an install that stopped part way leaves some out. ${pinnedInstall(cliDir)}`;
  const listed = new Map<string, ListedPackage>();
  for (const [key, p] of Object.entries(list.packages ?? {})) {
    const name = key.slice("node_modules/".length);
    if (!/^node_modules\/(?:@[^/.][^/]*\/)?[^/.@][^/]*$/.test(key) || typeof p?.version !== "string" || !Array.isArray(p.files) || !names(p.dependencies ?? [])) {
      return notInFull(`${listPath} lists ${key}, which is not a package this check can read`);
    }
    listed.set(name, p);
  }
  if (listed.size === 0 || !names(list.root) || list.root.length === 0) return notInFull(`${listPath} names no package this plugin depends on`);
  const ownNested = nestedModules(cliDir, buildFolders(cliDir));
  if (ownNested !== null) return nestedFolder(ownNested, "this plugin");
  // Each package is checked where Node takes it from the package that depends on it, by its real path (Node reads a
  // package's own imports from its real folder); a folder reached twice is checked once.
  const seen = new Set<string>();
  const queue: Array<[string, string, string]> = list.root.map((name) => [name, cliDir, "this plugin"]);
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const [name, from, by] = next;
    const p = listed.get(name);
    if (p === undefined) return notInFull(`${listPath} names ${name} as a package ${by} depends on, but does not list it`);
    const at = packageFolder(name, from);
    if (at === null) return notInFull(`${join(from, "node_modules")} holds no ${name}, which ${by} depends on, and no folder Node reads after it does`);
    const other = otherLoaderPlace(name, from, at);
    if (other !== null) return loadedElsewhere(name, other, at);
    let real: string;
    try {
      real = realpathSync(at);
    } catch (e) {
      return notInFull(`${at} cannot be read (${(e as NodeJS.ErrnoException).code ?? "error"})`);
    }
    if (!insideInstall(real, roots)) {
      return real === at || !insideInstall(at, roots)
        ? notInFull(`${join(from, "node_modules")} holds no ${name}, which ${by} depends on: Node would take it from ${at}, outside the plugin's install`)
        : `legal-scan: this plugin's package ${name} (${at}) is a link to ${real}, outside the plugin's install, so nothing was run: the plugin runs only the packages installed in its own folder. ${pinnedInstall(cliDir)}`;
    }
    if (seen.has(real)) continue;
    seen.add(real);
    if (!isFileOf(join(real, "package.json"))) return notInFull(`${join(from, "node_modules")} holds no ${name}: ${at} has no package.json`);
    let version: unknown;
    try {
      version = (JSON.parse(readFileSync(join(real, "package.json"), "utf8")) as { version?: unknown }).version;
    } catch {
      version = undefined;
    }
    if (version !== p.version) {
      return `legal-scan: this plugin's package ${name} is installed at version ${String(version)} (${at}), not ${String(p.version)}, the version its npm-shrinkwrap.json pins and the plugin was released with, so nothing was run. The package asks npm for exactly that version, so another one comes from outside it: an override in the project it was installed into (npm's overrides, yarn's resolutions or pnpm's overrides), or a change to the folder after the install. ${pinnedInstall(cliDir)}`;
    }
    for (const f of p.files as unknown[]) {
      const [rel, size] = Array.isArray(f) ? f : [];
      if (typeof rel !== "string" || typeof size !== "number" || rel === "" || isAbsolute(rel) || rel.split("/").includes("..")) {
        return notInFull(`${listPath} lists a file of ${name} this check cannot read`);
      }
      if (!isFileOf(join(real, ...rel.split("/")), size)) return notInFull(`${at} lacks ${rel}, or holds it at another size`);
    }
    const inner = nestedModules(real, foldersOf((p.files as Array<[string, number]>).map(([rel]) => rel)));
    if (inner !== null) return nestedFolder(inner, `the package ${name}`);
    for (const d of (p.dependencies ?? []) as string[]) queue.push([d, real, name]);
  }
  return null;
}

/** The refusal of a module found outside the install. */
export function outsideSentence(specifier: string, path: string, roots: readonly string[]): string {
  return `legal-scan: the module ${JSON.stringify(specifier)} was found at ${path}, outside this plugin's install (${roots.join(", ")}), and was not loaded: the plugin runs only the packages it installed. ${pinnedInstall(roots[0] ?? "")}`;
}

type ResolveResult = { url: string };
type RegisterHooks = (hooks: { resolve: (specifier: string, context: unknown, next: (s: string, c: unknown) => ResolveResult) => ResolveResult }) => unknown;
type CjsModule = { _resolveFilename?: (request: string, ...rest: unknown[]) => unknown };

/** From now on, in this thread, refuse (`refuse`: the sentence and an exit, nothing loaded) any module resolved outside `roots`. Returns which mechanisms took. */
export function barModulesOutside(roots: readonly string[], use: { hooks?: boolean; cjs?: boolean } = {}): { hooks: boolean; cjs: boolean } {
  const done = { hooks: false, cjs: false };
  const registerHooks = (nodeModule as unknown as { registerHooks?: RegisterHooks }).registerHooks;
  if (use.hooks !== false && typeof registerHooks === "function") {
    registerHooks({
      resolve(specifier, context, next) {
        const r = next(specifier, context);
        if (typeof r?.url === "string" && r.url.startsWith("file:")) {
          const path = fileURLToPath(r.url);
          if (!insideInstall(path, roots)) refuse(outsideSentence(specifier, path, roots));
        }
        return r;
      },
    });
    done.hooks = true;
  }
  const cjs = (nodeModule as unknown as { default?: CjsModule }).default;
  const resolveFilename = cjs?._resolveFilename;
  if (use.cjs !== false && cjs !== undefined && typeof resolveFilename === "function") {
    cjs._resolveFilename = function guarded(this: unknown, request: string, ...rest: unknown[]): unknown {
      const f = resolveFilename.call(this, request, ...rest);
      if (typeof f === "string" && isAbsolute(f) && !insideInstall(f, roots)) refuse(outsideSentence(request, f, roots));
      return f;
    };
    done.cjs = true;
  }
  return done;
}

function refuse(sentence: string): never {
  if (!isMainThread) throw new Error(sentence);
  process.stderr.write(`${sentence}\n`);
  process.exit(basename(process.argv[1] ?? "") === "hook-entry.js" ? 3 : 2);
}

/**
 * Turns the guard on for this thread, where the program runs from an installed plugin: its manifest beside dist, and no
 * source. A source checkout holds src/ (the package ships dist only); while `npm pack` runs there, or after a pack that
 * stopped before its postpack, the manifest is copied in beside dist, and the workspace's own layout must still serve.
 * Called by install-guard-on.ts alone, which the program's entries import first; importing this module runs nothing.
 */
export function guardThisInstall(): void {
  const cliDir = dirname(dirname(fileURLToPath(import.meta.url)));
  if (!existsSync(join(cliDir, ".claude-plugin", "plugin.json")) || existsSync(join(cliDir, "src", "install-guard.ts"))) return;
  const problem = installProblem(cliDir);
  if (problem !== null) refuse(problem);
  barModulesOutside(installRoots(cliDir));
}
