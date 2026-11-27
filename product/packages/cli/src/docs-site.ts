/**
 * WHETHER A FOLDER NAMED LIKE A DOCUMENTATION SITE IS ONE.
 *
 * The `docs` read-scope class (rules/path-exclusions/documentation-sites.yaml,:
 * documentation sites are not read by default) was decided by a folder NAME alone, so a feature module of the product's own that
 * happens to be called `docs` - an indexing service's `docs/` folder imported by the product's core, a workspace crate
 * named `docs`, a generated API-description package the router imports - was held back and counted as "documentation-site
 * files". The read set lost the product's own code under an untrue label.
 *
 * ## The one mechanism change
 *
 * A name match now only makes a folder a CANDIDATE, as it does for vendored code (vendored-origin.ts). The candidate is
 * READ ONLY WHERE THE PRODUCT USES IT: it
 * shows no site generator (1 below), holds program source (outside its own example folders, `EXAMPLE_FOLDER`), and code
 * of the product outside it imports it (a type-only import is not use), another workspace member depends on it, or a
 * package of the product names it as its entry point (docs-usage.ts). A site generator's configuration holds the folder
 * whatever imports it: a docs generator importing a site's types does not make the site the product. Otherwise it is
 * held back as a documentation site, with the first of these as its evidence:
 *
 *   1. **A SITE GENERATOR'S CONFIGURATION** at its top or in a folder directly inside it (`SITE_CONFIG_FILES`,
 *      `SITE_CONFIG_FOLDERS`, a Hugo configuration beside a `layouts/`, `archetypes/` or `content/` folder, a
 *      `package.json` whose dependencies name a site generator, `SITE_GENERATOR_PACKAGES`), or an MkDocs configuration
 *      beside it (MkDocs reads the `docs` folder next to its `mkdocs.yml` by default);
 *   2. **PROGRAM SOURCE NOTHING USES**: a documentation site built as an application (a component library's docs app, a
 *      docs app of live examples), which shows no generator a test could name; the coverage block names each such folder;
 *   3. **PROSE**: no program source, and prose or page files (`PROSE_FILE`).
 *
 * A folder with neither prose nor program source (images, protocol files) shows no site and is read. Being listed only as
 * a workspace member, or holding a package manifest of its own, is not use: a documentation app is both (fixa's
 * `own-package` reason, which read such apps, is withdrawn). A folder that cannot be listed is held back.
 *
 * The decision reads the folder's own entries, one `package.json` per folder looked at, the names of the files in its
 * tree, and the references of the product's files outside every folder a read-scope class names (docs-usage.ts), never
 * anything outside the scanned folder, and it is the same in every run whatever `--read` says, so the class a place
 * carries (path-class.ts) is the same whether or not `--read docs` was given.
  */

/** One entry of a folder as this test sees it. */
export interface SiteEntry {
  name: string;
  dir: boolean;
}

/** What the walker hands the test: the candidate's listings, one file's first bytes, its tree's file names. */
export interface SiteView {
  /** The entries directly in the candidate (`""`) or in a folder directly inside it (its name); null where unlisted. */
  list(sub: string): SiteEntry[] | null;
  /** The entries directly in the candidate's parent folder; null where unlisted. */
  parent(): SiteEntry[] | null;
  /** The text of the first bytes of a file directly in the candidate (`""`) or in a folder directly inside it. */
  read(sub: string, name: string): string | null;
  /**
   * The paths of every file in the candidate's tree, from the candidate with `/` between folders, as the walker counts
   * them; null where a folder could not be listed.
   */
  treeFileNames(): string[] | null;
  /**
   * The first reference of the product's code outside the candidate that imports it, depends on it or names it as its
   * package's entry point, in words with its file; null where none does (docs-usage.ts). `ownName` is the candidate's own
   * `package.json` name, where it has one.
   */
  usedBy(ownName: string | null): string | null;
}

export type SiteWhy = "used-by-product" | "no-site-sign";

/** Why a candidate was held: a generator's configuration, program source nothing uses, prose, or a folder it could not list. */
export type SiteHeldWhy = "site-generator" | "unused-source" | "prose" | "unlisted";

export type SiteDecision = { site: true; why: SiteHeldWhy; evidence: string } | { site: false; why: SiteWhy; evidence: string };

/** Configuration files a documentation site generator reads, by exact name. */
const SITE_CONFIG_FILES: ReadonlySet<string> = new Set([
  "mkdocs.yml", "mkdocs.yaml", // MkDocs
  "conf.py", // Sphinx
  "docusaurus.config.js", "docusaurus.config.cjs", "docusaurus.config.mjs", "docusaurus.config.ts", "docusaurus.config.mts", // Docusaurus
  "hugo.toml", "hugo.yaml", "hugo.yml", "hugo.json", // Hugo
  "_config.yml", "_config.yaml", // Jekyll, Hexo
  "book.toml", // mdBook
  "book.json", // GitBook
  "mint.json", "docs.json", // Mintlify
  "antora.yml", "antora-playbook.yml", // Antora
  "_quarto.yml", // Quarto
  "docfx.json", // DocFX
  "Doxyfile", // Doxygen
  ".nojekyll", // a GitHub Pages site
  "_sidebar.md", // docsify
  "theme.config.js", "theme.config.jsx", "theme.config.ts", "theme.config.tsx", // Nextra
  ".readthedocs.yaml", ".readthedocs.yml", // Read the Docs
]);

/** Folders a documentation site generator keeps its configuration in. */
const SITE_CONFIG_FOLDERS: ReadonlySet<string> = new Set([".vitepress", ".vuepress", ".docusaurus"]);

/** A `package.json` dependency that is a documentation site generator. */
const SITE_GENERATOR_PACKAGES = /^(?:@docusaurus\/core|vitepress|vuepress|@vuepress\/core|nextra|nextra-theme-docs|@astrojs\/starlight|mintlify|docsify|docsify-cli|@nuxt\/content|docus|@nuxt-themes\/docus|fumadocs-core|fumadocs-ui|rspress|@rspress\/core|vocs|hexo|@thulite\/doks-core|typedoc|docz|gatsby-theme-docz)$/;

/** Prose and pages: what a documentation site is mostly made of. */
const PROSE_FILE = /\.(?:md|mdx|markdown|rst|adoc|asciidoc|txt|textile|org|html?)$/i;

/** Program source: what a product is made of. Templates, styles, data and configuration are neither. */
const CODE_FILE = /\.(?:[cm]?jsx?|[cm]?tsx?|py|rb|php|java|kts?|go|rs|c|h|cc|cpp|cxx|hpp|cs|swift|exs?|vue|svelte|astro|scala|dart|lua|pl|pm|groovy|clj|cljs|erl|hs|ml|fs|jl|m|mm)$/i;

/** A folder of examples inside a candidate: its files are never "program source" for this test (live examples of a docs app). */
const EXAMPLE_FOLDER = /^(?:examples?|demos?|snippets?|samples?|playgrounds?)$/i;

/** The dependencies a `package.json` text names, or null where it is not JSON. */
function dependenciesOf(text: string): { deps: string[]; name: string | null } | null {
  try {
    const p = JSON.parse(text) as Record<string, unknown>;
    const deps: string[] = [];
    for (const k of ["dependencies", "devDependencies", "peerDependencies"]) {
      const v = p[k];
      if (v !== null && typeof v === "object") deps.push(...Object.keys(v as Record<string, unknown>));
    }
    return { deps, name: typeof p.name === "string" ? p.name : null };
  } catch {
    return null;
  }
}

/** Sign 1 in one folder (`sub` is `""` for the candidate itself): the evidence, or null. */
function siteSignIn(view: SiteView, sub: string, entries: readonly SiteEntry[]): string | null {
  const at = (n: string) => (sub === "" ? n : `${sub}/${n}`);
  for (const e of entries) {
    if (!e.dir && SITE_CONFIG_FILES.has(e.name)) return `a site generator's configuration (${at(e.name)})`;
    if (e.dir && SITE_CONFIG_FOLDERS.has(e.name)) return `a site generator's configuration folder (${at(e.name)}/)`;
  }
  const names = new Set(entries.map((e) => `${e.dir ? "d" : "f"}:${e.name}`));
  // Hugo: `config.toml` (or yaml) beside its `layouts/`, `archetypes/` or `content/`, or a `config/_default/` folder.
  const hugo = ["config.toml", "config.yaml", "config.yml"].find((n) => names.has(`f:${n}`));
  const beside = ["layouts", "archetypes", "content"].find((n) => names.has(`d:${n}`));
  if (hugo !== undefined && beside !== undefined) return `a Hugo site's configuration (${at(hugo)} beside ${beside}/)`;
  if (names.has("d:config") && (view.list(at("config"))?.some((e) => e.dir && e.name === "_default") ?? false)) return `a Hugo site's configuration (${at("config/_default/")})`;
  if (names.has("f:package.json")) {
    const text = view.read(sub, "package.json");
    const got = text === null ? null : dependenciesOf(text);
    const gen = got?.deps.find((d) => SITE_GENERATOR_PACKAGES.test(d));
    if (gen !== undefined) return `a site generator named in ${at("package.json")} (${gen})`;
  }
  return null;
}

/** THE DECISION for one candidate folder. */
export function documentationSiteOf(view: SiteView): SiteDecision {
  const top = view.list("");
  // A folder this test cannot list is held back, as every candidate was before it.
  if (top === null) return { site: true, why: "unlisted", evidence: "a folder this test could not list" };
  const files = view.treeFileNames();
  if (files === null) return { site: true, why: "unlisted", evidence: "a folder this test could not list" };
  let prose = 0;
  let code = 0;
  for (const f of files) {
    const parts = f.split("/");
    const name = parts[parts.length - 1] as string;
    if (PROSE_FILE.test(name)) prose++;
    else if (CODE_FILE.test(name) && !parts.slice(0, -1).some((p) => EXAMPLE_FOLDER.test(p))) code++;
  }
  const here = siteSignIn(view, "", top);
  if (here !== null) return { site: true, why: "site-generator", evidence: here };
  for (const e of top) {
    if (!e.dir || e.name.startsWith(".") || e.name === "node_modules") continue;
    const inner = view.list(e.name);
    if (inner === null) continue;
    const there = siteSignIn(view, e.name, inner);
    if (there !== null) return { site: true, why: "site-generator", evidence: there };
  }
  const parent = view.parent();
  const mk = parent?.find((e) => !e.dir && (e.name === "mkdocs.yml" || e.name === "mkdocs.yaml"));
  if (mk !== undefined) return { site: true, why: "site-generator", evidence: `an MkDocs configuration beside it (../${mk.name})` };
  // Read only where the product uses it.
  if (code > 0) {
    const pkg = top.some((e) => !e.dir && e.name === "package.json") ? view.read("", "package.json") : null;
    const used = view.usedBy(pkg === null ? null : (dependenciesOf(pkg)?.name ?? null));
    if (used !== null) return { site: false, why: "used-by-product", evidence: used };
  }
  if (code > 0) return { site: true, why: "unused-source", evidence: `${code} source files that no code of the product outside it imports, depends on or names as its package (${prose} prose or page files)` };
  if (prose > 0) return { site: true, why: "prose", evidence: `prose (${prose} prose or page files, no program source)` };
  return { site: false, why: "no-site-sign", evidence: "no site generator, no prose and no program source" };
}
