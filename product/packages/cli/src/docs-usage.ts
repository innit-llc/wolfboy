import { posix } from "node:path";

/**
 * WHETHER THE PRODUCT USES A FOLDER NAMED LIKE A DOCUMENTATION SITE.
 *
 * Documentation sites are not read by default. A folder named like one that holds
 * program source is read only where the product USES it: code of the product outside the folder imports it, another
 * member of the workspace depends on it, or a package of the product names it as its own entry point. Being listed only
 * as a workspace member is not use: a documentation app is a workspace member too.
 *
 * This module is the evidence for that test. The walker hands it the text of every file of the product it may look at
 * (outside every folder a read-scope class names, whatever this run reads, so the answer is the same in every run), and
 * it keeps only the references that could land in a folder named like a documentation site: a reference that does
 * passes through the folder's own name, which is a name the `docs` class nominates (`named`). Nothing here runs or
 * evaluates anything from the tree: every file is matched as text, and a commented-out import counts (the direction
 * that reads more).
 *
 * What counts as a reference:
 *   - an import of a path (JavaScript and TypeScript `import`/`export ... from`/`import()`/`require()`, Python relative
 *     `from .x import`, Ruby `require_relative`, PHP `require __DIR__ . '/x'`), resolved from the importing file's folder;
 *   - an import by a name: a JavaScript package subpath or path alias (`@/features/billing/docs/drawer`, matched by the
 *     candidate's last two or more folder names), a Python dotted module (`backend.docs.views`, likewise, or the whole
 *     path of a top-level folder), a Go import path under a `go.mod` module that holds the folder, a Rust `mod x;`;
 *   - a manifest: a `package.json` dependency on the folder's own package name, a `package.json` entry point (`main`,
 *     `module`, `browser`, `types`, `typings`, `bin`, `exports`) inside it, a `Cargo.toml` `path = "..."` and a `go.mod`
 *     `replace ... => ./x` that land in it.
 *
 * KNOWN LIMITS (stated, not guessed): a PHP namespace or Composer autoload, a Ruby `require` by load path, a Java, Kotlin
 * or C# package import, and an alias of one folder name only (`@docs/x`) are not followed: such a folder is held, counted
 * and offered `--read docs`. An importer in an example or template folder counts as the product's code.
 */

/** What one reference says, kept only where it could land in a folder named like a documentation site. */
type Ref =
  | { kind: "path"; from: string; target: string; spec: string; how: string }
  | { kind: "bare"; from: string; spec: string }
  | { kind: "dotted"; from: string; spec: string }
  | { kind: "go"; from: string; spec: string }
  | { kind: "dep"; from: string; spec: string };

/** The files this module reads, by name: program source it takes imports from, and the manifests it parses. */
const JS_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|mdx)$/i;
const PY_FILE = /\.py$/i;
const GO_FILE = /\.go$/i;
const RS_FILE = /\.rs$/i;
const RB_FILE = /\.rb$/i;
const PHP_FILE = /\.php$/i;
const MANIFESTS: ReadonlySet<string> = new Set(["package.json", "Cargo.toml", "go.mod"]);

/** Whether this module reads a file of this base name. */
export function usageReads(name: string): boolean {
  return MANIFESTS.has(name) || JS_FILE.test(name) || PY_FILE.test(name) || GO_FILE.test(name) || RS_FILE.test(name) || RB_FILE.test(name) || PHP_FILE.test(name);
}

const JS_SPEC = /(?:\bfrom[ \t]*|\bimport[ \t]*\([ \t]*|\brequire[ \t]*\([ \t]*|\bimport[ \t]+)(["'`])([^"'`\n]{1,512})\1/g;
const PY_FROM = /^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+([^\n#]{1,512})/gm;
const PY_IMPORT = /^[ \t]*import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)/gm;
const GO_BLOCK = /\bimport[ \t]*\(([^)]{0,65536})\)/g;
const GO_ONE = /\bimport[ \t]+(?:[\w.]+[ \t]+)?"([^"\n]{1,512})"/g;
const GO_STRING = /"([^"\n]{1,512})"/g;
const RS_MOD = /^[ \t]*(?:pub(?:\([^)\n]*\))?[ \t]+)?mod[ \t]+([A-Za-z_]\w*)[ \t]*;/gm;
const RB_REL = /\brequire_relative[ \t]*\(?[ \t]*["']([^"'\n]{1,512})["']/g;
const PHP_REL = /\b(?:require|include)(?:_once)?[ \t]*\(?[ \t]*__DIR__[ \t]*\.[ \t]*["']([^"'\n]{1,512})["']/g;
const CARGO_PATH = /\bpath[ \t]*=[ \t]*"([^"\n]{1,512})"/g;
const GO_MODULE = /^module[ \t]+(\S{1,512})/m;
const GO_REPLACE = /=>[ \t]*(\.\.?\/[^\s]{0,512})/g;

/** A path made of `/` segments, normalised, or null where it leaves the tree. */
function inTree(p: string): string | null {
  const n = posix.normalize(p).replace(/\/+$/, "");
  if (n === "." || n === "") return "";
  if (n === ".." || n.startsWith("../") || n.startsWith("/")) return null;
  return n;
}

/** Whether `target` is the folder `dir` or a path inside it. */
function within(target: string, dir: string): boolean {
  return target === dir || target.startsWith(`${dir}/`);
}

/** Whether the first `k` segments of `rest` are the last `k` of `dir`, for some k of at least `least` (or the whole of `dir`). */
function tailMatches(dirSegs: readonly string[], rest: readonly string[]): boolean {
  for (let k = Math.min(dirSegs.length, rest.length); k >= 1; k--) {
    if (k < 2 && k !== dirSegs.length) continue;
    let ok = true;
    for (let i = 0; i < k; i++) if (dirSegs[dirSegs.length - k + i] !== rest[i]) ok = false;
    if (ok) return true;
  }
  return false;
}

/** The references of the product to folders named like documentation sites, and the `go.mod` modules of the tree. */
export class DocsUsageIndex {
  private readonly refs: Ref[] = [];
  private readonly goModules: { dir: string; module: string }[] = [];
  /** False where the walker stopped before it had handed over every file (a budget, a folder it could not list). */
  complete = true;
  /** @param named whether a folder of this name is one the `docs` class nominates (rules/path-exclusions/documentation-sites.yaml). */
  constructor(private readonly named: (segment: string) => boolean) {}

  private names(p: string, sep: string): boolean {
    return p.split(sep).some((s) => s !== "" && this.named(s));
  }

  private path(from: string, base: string, spec: string, how: string): void {
    const target = inTree(posix.join(base, spec));
    if (target !== null && this.names(target, "/")) this.refs.push({ kind: "path", from, target, spec, how });
  }

  /** Takes the references of one file of the product, `rel` its path from the scan root with `/` between folders. */
  addFile(rel: string, text: string): void {
    const name = posix.basename(rel);
    const dir = posix.dirname(rel) === "." ? "" : posix.dirname(rel);
    if (name === "package.json") {
      let p: Record<string, unknown>;
      try {
        p = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return;
      }
      if (p === null || typeof p !== "object") return;
      for (const k of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        const v = p[k];
        if (v !== null && typeof v === "object") for (const dep of Object.keys(v as Record<string, unknown>)) this.refs.push({ kind: "dep", from: rel, spec: dep });
      }
      const strings = (v: unknown, depth: number, out: string[]): void => {
        if (depth > 8) return;
        if (typeof v === "string") out.push(v);
        else if (v !== null && typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) strings(x, depth + 1, out);
      };
      const entries: string[] = [];
      for (const k of ["main", "module", "browser", "types", "typings", "bin", "exports"]) strings(p[k], 0, entries);
      for (const en of entries) this.path(rel, dir, en.split("*")[0] as string, "names as its package's entry point");
      return;
    }
    if (name === "Cargo.toml") {
      for (const m of text.matchAll(CARGO_PATH)) this.path(rel, dir, m[1] as string, "depends on by path");
      return;
    }
    if (name === "go.mod") {
      const mod = GO_MODULE.exec(text);
      if (mod !== null) this.goModules.push({ dir, module: mod[1] as string });
      for (const m of text.matchAll(GO_REPLACE)) this.path(rel, dir, m[1] as string, "replaces a module with");
      return;
    }
    if (JS_FILE.test(name)) {
      for (const m of text.matchAll(JS_SPEC)) {
        const spec = m[2] as string;
        // A type-only import (`import type { X } from "..."`, `export type ...`) is erased when the product is built: not use.
        const lineStart = text.lastIndexOf("\n", m.index) + 1;
        if (/^[ \t]*(?:import|export)[ \t]+type\b/.test(text.slice(lineStart, m.index + 1))) continue;
        if (spec.startsWith(".")) this.path(rel, dir, spec, "imports");
        else if (this.names(spec, "/")) this.refs.push({ kind: "bare", from: rel, spec });
      }
      return;
    }
    if (PY_FILE.test(name)) {
      for (const m of text.matchAll(PY_FROM)) {
        const dots = (m[1] as string).length;
        const mod = m[2] as string;
        const imported = (m[3] as string).replace(/[()]/g, "").split(",").map((x) => x.trim().split(/[ \t]+/)[0] ?? "").filter((x) => /^\w+$/.test(x));
        if (dots > 0) {
          let base = dir;
          for (let i = 1; i < dots; i++) base = posix.dirname(base) === "." ? "" : posix.dirname(base);
          const modPath = mod === "" ? "" : mod.split(".").join("/");
          const at = modPath === "" ? base : posix.join(base, modPath);
          this.path(rel, at, ".", "imports");
          for (const n of imported) this.path(rel, at, n, "imports");
        } else if (mod !== "") {
          for (const full of [mod, ...imported.map((n) => `${mod}.${n}`)]) if (this.names(full, ".")) this.refs.push({ kind: "dotted", from: rel, spec: full });
        }
      }
      for (const m of text.matchAll(PY_IMPORT)) for (const mod of (m[1] as string).split(",").map((x) => x.trim())) if (this.names(mod, ".")) this.refs.push({ kind: "dotted", from: rel, spec: mod });
      return;
    }
    if (GO_FILE.test(name)) {
      const specs: string[] = [];
      for (const b of text.matchAll(GO_BLOCK)) for (const s of (b[1] as string).matchAll(GO_STRING)) specs.push(s[1] as string);
      for (const m of text.matchAll(GO_ONE)) specs.push(m[1] as string);
      for (const spec of specs) if (this.names(spec, "/")) this.refs.push({ kind: "go", from: rel, spec });
      return;
    }
    if (RS_FILE.test(name)) {
      const stem = name.replace(/\.rs$/i, "");
      const modDir = stem === "lib" || stem === "main" || stem === "mod" ? dir : posix.join(dir, stem);
      for (const m of text.matchAll(RS_MOD)) this.path(rel, modDir, m[1] as string, "declares the module");
      return;
    }
    if (RB_FILE.test(name)) {
      for (const m of text.matchAll(RB_REL)) this.path(rel, dir, m[1] as string, "requires");
      return;
    }
    if (PHP_FILE.test(name)) for (const m of text.matchAll(PHP_REL)) this.path(rel, dir, (m[1] as string).replace(/^\//, ""), "requires");
  }

  /**
   * The first reference of the product that lands in the folder `dir` (from the scan root, `/` between folders), in words
   * with its file; null where none does. `ownName` is the folder's own `package.json` name, where it has one.
   */
  usedBy(dir: string, ownName: string | null): string | null {
    const segs = dir.split("/");
    const last = segs[segs.length - 1] as string;
    for (const r of this.refs) {
      if (within(r.from, dir)) continue;
      switch (r.kind) {
        case "path":
          if (within(r.target, dir)) return `${r.from} ${r.how} ${JSON.stringify(r.spec)}`;
          break;
        case "dep":
          if (ownName !== null && r.spec === ownName) return `${r.from} depends on ${JSON.stringify(ownName)}`;
          break;
        case "bare": {
          if (ownName !== null && (r.spec === ownName || r.spec.startsWith(`${ownName}/`))) return `${r.from} imports ${JSON.stringify(r.spec)}`;
          const ss = r.spec.split("/");
          if (!ss.includes(last)) break;
          for (const drop of [1, 2]) if (ss.length > drop && tailMatches(segs, ss.slice(drop)) && segs.length >= 2) return `${r.from} imports ${JSON.stringify(r.spec)}`;
          break;
        }
        case "dotted":
          if (r.spec.split(".").includes(last) && tailMatches(segs, r.spec.split("."))) return `${r.from} imports ${JSON.stringify(r.spec)}`;
          break;
        case "go":
          for (const g of this.goModules) {
            if (g.dir !== "" && !within(dir, g.dir)) continue;
            const want = `${g.module}/${g.dir === "" ? dir : dir.slice(g.dir.length + 1)}`;
            if (r.spec === want || r.spec.startsWith(`${want}/`)) return `${r.from} imports ${JSON.stringify(r.spec)}`;
          }
          break;
      }
    }
    return null;
  }
}
