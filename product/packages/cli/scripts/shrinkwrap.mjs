#!/usr/bin/env node
/**
 * npm-shrinkwrap.json of this package, generated from the workspace's pnpm-lock.yaml.
 *
 *   node scripts/shrinkwrap.mjs           write npm-shrinkwrap.json
 *   node scripts/shrinkwrap.mjs --check   exit 1, naming the difference, where the file is not what this writes
 *
 * WHY. Claude Code installs an npm-sourced plugin's dependencies only from a
 * lockfile shipped beside its package.json (npm-shrinkwrap.json for a published package: npm leaves package-lock.json
 * out of a tarball), every dependency a registry package pinned to an exact version, with install scripts off; and
 * `npm install -g` of this package honours the same file. Without it the plugin would load with no node_modules and
 * the program would not start.
 *
 * ONE SOURCE. The versions are the ones pnpm-lock.yaml resolved for this package, which every gate of the workspace
 * runs, never a second resolution: this script copies them (name, version, integrity, and each package's own
 * dependency edges as exact versions) and invents nothing. The registry address is npm's public one. It refuses a
 * dependency tree that cannot be laid out flat (two versions of one package), which would need a nested layout this
 * script does not write.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCK = join(PKG, "..", "..", "pnpm-lock.yaml");
const OUT = join(PKG, "npm-shrinkwrap.json");
const REGISTRY = "https://registry.npmjs.org";

/** `ajv-formats@3.0.1(ajv@8.20.0)` -> `3.0.1`; `8.20.0` -> `8.20.0`. */
const bare = (v) => String(v).replace(/\(.*$/, "");
const tarballUrl = (name, version) => `${REGISTRY}/${name}/-/${name.split("/").pop()}-${version}.tgz`;

export function shrinkwrapFrom(pkg, lock) {
  const importer = lock.importers?.["packages/cli"];
  if (!importer) throw new Error("pnpm-lock.yaml has no importer packages/cli");
  const snapshots = lock.snapshots ?? {};
  const packages = lock.packages ?? {};
  const snapshotOf = (name, version) => {
    const exact = `${name}@${version}`;
    if (snapshots[exact] !== undefined) return snapshots[exact] ?? {};
    // A package resolved with its peers carries them in its key: `ajv-formats@3.0.1(ajv@8.20.0)`.
    const withPeers = Object.keys(snapshots).filter((k) => k.startsWith(`${exact}(`));
    if (withPeers.length > 1) throw new Error(`${exact} is resolved with ${withPeers.length} sets of peers; a flat layout cannot hold them`);
    return withPeers.length === 1 ? (snapshots[withPeers[0]] ?? {}) : {};
  };
  const chosen = new Map();
  const walk = (name, version) => {
    const prior = chosen.get(name);
    if (prior !== undefined) {
      if (prior !== version) throw new Error(`${name} is needed at ${prior} and at ${version}; a flat layout cannot hold both`);
      return;
    }
    chosen.set(name, version);
    const snap = snapshotOf(name, version);
    for (const [dep, v] of Object.entries({ ...(snap.dependencies ?? {}), ...(snap.optionalDependencies ?? {}) })) walk(dep, bare(v));
  };
  const rootDeps = pkg.dependencies ?? {};
  for (const name of Object.keys(rootDeps)) {
    const entry = importer.dependencies?.[name];
    if (!entry) throw new Error(`pnpm-lock.yaml's packages/cli has no resolution for ${name}`);
    if (entry.specifier !== rootDeps[name]) throw new Error(`${name}: package.json asks ${rootDeps[name]} and pnpm-lock.yaml resolved ${entry.specifier}; run pnpm install first`);
    walk(name, bare(entry.version));
  }
  for (const name of Object.keys(importer.dependencies ?? {})) {
    if (!(name in rootDeps)) throw new Error(`pnpm-lock.yaml resolves ${name} for packages/cli, which package.json does not ask for; run pnpm install first`);
  }
  // EVERY PACKAGE OF THE CLOSURE IS ASKED FOR BY NAME AT ITS EXACT VERSION. npm reads
  // this file only where it knows the package holds one: a registry that marks the version `_hasShrinkwrap` (npmjs
  // does; a local registry such as verdaccio does not), never for an install from a tarball file, never with
  // package-lock turned off. Where it does not, it chose each version from package.json's ranges, so a patch release
  // of any package of the closure (yaml 2.9.1 over the pinned 2.9.0, fast-uri 3.1.9 over 3.1.8, both on 2026-11-10)
  // made `npx wolfboy@<version>` install it, and the install guard then refused the run, rightly: it runs only the
  // versions the package was released with. Asked for by name at exact versions, every package of the closure is the
  // pinned one whether npm reads this file or not; the guard keeps refusing anything else.
  for (const [name, version] of chosen) {
    if (rootDeps[name] !== version) {
      throw new Error(`${name}@${version} is in the package's dependency closure, but package.json ${name in rootDeps ? `asks for it as ${rootDeps[name]}` : "does not ask for it"}: npm, where it does not read npm-shrinkwrap.json, would choose its version itself, and the install guard refuses any version but the pinned one. Put "${name}": "${version}" in package.json's dependencies and run pnpm install`);
    }
  }
  const out = {
    name: pkg.name,
    version: pkg.version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: pkg.name,
        version: pkg.version,
        license: pkg.license,
        dependencies: rootDeps,
        ...(pkg.bin ? { bin: pkg.bin } : {}),
        ...(pkg.engines ? { engines: pkg.engines } : {}),
      },
    },
  };
  for (const name of [...chosen.keys()].sort()) {
    const version = chosen.get(name);
    const meta = packages[`${name}@${version}`];
    const integrity = meta?.resolution?.integrity;
    if (typeof integrity !== "string") throw new Error(`pnpm-lock.yaml has no integrity for ${name}@${version}`);
    const snap = snapshotOf(name, version);
    const peers = meta.peerDependencies ?? {};
    const edges = (o) => Object.fromEntries(Object.entries(o ?? {}).map(([d, v]) => [d, bare(v)]));
    const deps = edges(snap.dependencies);
    const optional = edges(snap.optionalDependencies);
    out.packages[`node_modules/${name}`] = {
      version,
      resolved: tarballUrl(name, version),
      integrity,
      ...(Object.keys(deps).length ? { dependencies: deps } : {}),
      ...(Object.keys(optional).length ? { optionalDependencies: optional } : {}),
      ...(Object.keys(peers).length ? { peerDependencies: peers } : {}),
      ...(meta.peerDependenciesMeta ? { peerDependenciesMeta: meta.peerDependenciesMeta } : {}),
      ...(meta.engines ? { engines: meta.engines } : {}),
    };
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const text = shrinkwrapFrom(JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")), parse(readFileSync(LOCK, "utf8")));
  if (process.argv[2] === "--check") {
    let have = "";
    try {
      have = readFileSync(OUT, "utf8");
    } catch {
      // absent: said below
    }
    if (have !== text) {
      console.error(`shrinkwrap: ${OUT} is not the one pnpm-lock.yaml gives; run node scripts/shrinkwrap.mjs in product/packages/cli`);
      process.exit(1);
    }
    process.exit(0);
  }
  writeFileSync(OUT, text);
  console.error(`shrinkwrap: ${Object.keys(JSON.parse(text).packages).length - 1} package(s) -> ${OUT}`);
}
