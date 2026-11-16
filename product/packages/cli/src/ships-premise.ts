/**
 * DOES IT SHIP: THE PROGRAM'S PREMISE
 *
 * Decided once per file at scan time, from the repository's own build and tooling files, for every file holding a
 * location (`scan.ts` writes the table as findings.json `ships_premises`). It is a premise handed to the seats, which
 * may contradict it with a quotation; it is never used to skip a file and it changes no candidate: it is computed after
 * the candidates are final, from their location paths alone.
 *
 * THE RULE (the design's, and the order every branch below keeps):
 *   1. A not-shipped premise needs a POSITIVE signal of a non-shipping class: a line of a manifest, or a convention the
 *      toolchain itself defines (Go `_test.go`, Maven `src/test/`, a CI system's own definition files). Path names alone
 *      are never a signal, so a folder called `docs/` or `scripts/` says nothing on its own.
 *   2. If anything says the file ships, it ships: a declared artifact that includes the file makes it `product`, and any
 *      non-shipping signal it also has is recorded in `conflict` rather than dropped.
 *   3. Unknown means ships. No signal, a conflict of open-ended routes, or a signal whose quotation does not stand at its
 *      line gives `unknown` (`depends_on_deployment`, counted as shipping).
 *   4. A generator config at the repository root makes the repository the site, not a docs site: no docs premise.
 *   5. `outside_artifacts` (nothing the repository builds includes it) only in a CLOSED world: the file lies inside the
 *      root of at least one artifact whose contents this module read whole (a Dockerfile with no variable source, a
 *      package with an explicit file list), and no open route covers it (a deployment manifest that ships a folder as it
 *      is, a package published whole, a compose bind mount, a Dockerfile source it could not resolve, a walk cut short).
 *
 * Every `because` line is held to `programLineStands` (place-reply.ts, the comparison the capture itself uses, WP1)
 * before it is written; a signal whose line does not stand is dropped, so the table never carries a premise the capture
 * would refuse. Reading the tree's manifests is reading data: nothing here runs, installs or builds anything.
 */
import { lstatSync, readdirSync } from "node:fs";
import { readSourceText } from "./project-read.js";
import { join, posix } from "node:path";
import { programLineStands } from "./place-reply.js";
import type { ShipsPremise } from "./standing.js";

export interface ShipsBecause {
  file: string;
  line: number;
  quote: string;
}
export type NotShippedPremise = Exclude<ShipsPremise, "product" | "unknown">;
export interface ShipsPremiseRow {
  premise: ShipsPremise;
  because?: ShipsBecause[];
  conflict?: NotShippedPremise[];
}
/** Which family of build files decided a row (for counts; never written into findings.json). */
export type ShipsEcosystem = "node" | "docker" | "ci" | "docs" | "python" | "go" | "ruby" | "rust" | "java" | "text";
export interface ShipsPremiseResult {
  premises: Record<string, ShipsPremiseRow>;
  decidedBy: Record<string, ShipsEcosystem | null>;
  manifests: number;
  truncated: boolean;
}

interface Signal {
  premise: ShipsPremise;
  eco: ShipsEcosystem;
  because: ShipsBecause[];
}

/** Folders the manifest walk never enters: package stores, caches and version-control data, never a build file of the repository. */
const SKIP_DIRS = new Set([".git", ".hg", ".svn", "node_modules", "bower_components", ".venv", "venv", "__pycache__", ".tox", ".nox", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".gradle", ".next", ".nuxt", ".svelte-kit", ".cache", ".legal", ".terraform"]);
/** The most directory entries the manifest walk visits; past it the walk is cut short and the world is open (rule 5). */
export const SHIPS_WALK_MAX_ENTRIES = 1_000_000;
/** The largest build file read (bytes); a larger one is not read and opens nothing it would have closed. */
const MANIFEST_MAX_BYTES = 2_000_000;
/** The longest quotation written; a longer line is quoted by a verbatim part of it (at least the place-quote minimum). */
const QUOTE_MAX = 200;
/** The most `because` lines a row carries. */
const BECAUSE_MAX = 2;

/* ------------------------------------------------------------------------------------------------ *
 * Paths and globs.
 * ------------------------------------------------------------------------------------------------ */

function clean(p: string): string | null {
  let s = p.replace(/\\/g, "/").trim();
  if (s === "" || s === ".") return "";
  s = posix.normalize(s);
  while (s.startsWith("./")) s = s.slice(2);
  if (s.startsWith("/")) s = s.replace(/^\/+/, "");
  if (s.endsWith("/")) s = s.replace(/\/+$/, "");
  if (s === "." || s === "") return "";
  if (s === ".." || s.startsWith("../")) return null;
  return s;
}
const joinRel = (dir: string, p: string): string | null => clean(dir === "" ? p : `${dir}/${p}`);
const dirOf = (p: string): string => {
  const d = posix.dirname(p);
  return d === "." ? "" : d;
};
const under = (p: string, dir: string): boolean => dir === "" || p === dir || p.startsWith(`${dir}/`);
const relTo = (p: string, dir: string): string => (dir === "" ? p : p === dir ? "" : p.slice(dir.length + 1));
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const hasGlob = (s: string): boolean => /[*?[{]/.test(s);

const GLOB_CACHE = new Map<string, RegExp>();
function globRe(glob: string): RegExp {
  const known = GLOB_CACHE.get(glob);
  if (known) return known;
  const made = globReOf(glob);
  if (GLOB_CACHE.size < 100_000) GLOB_CACHE.set(glob, made);
  return made;
}
function globReOf(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "[") {
      const j = glob.indexOf("]", i + 1);
      if (j > i + 1) {
        re += `[${glob.slice(i + 1, j).replace(/^!/, "^").replace(/\\/g, "\\\\")}]`;
        i = j;
      } else re += "\\[";
    } else if (c === "{") {
      const j = glob.indexOf("}", i + 1);
      if (j > i) {
        re += `(?:${glob.slice(i + 1, j).split(",").map(escapeRe).join("|")})`;
        i = j;
      } else re += "\\{";
    } else re += escapeRe(c);
  }
  return new RegExp(`^${re}$`);
}
/** A path pattern covers `p` where it names `p` or a folder `p` is inside (how npm `files`, COPY and .dockerignore read a folder). */
function covers(pattern: string, p: string): boolean {
  if (pattern === "") return true;
  if (!hasGlob(pattern)) return under(p, pattern);
  const re = globRe(pattern);
  const parts = p.split("/");
  for (let k = parts.length; k >= 1; k--) if (re.test(parts.slice(0, k).join("/"))) return true;
  return false;
}

/* ------------------------------------------------------------------------------------------------ *
 * The tree, read as data.
 * ------------------------------------------------------------------------------------------------ */

class Tree {
  private readonly kinds = new Map<string, "file" | "dir" | null>();
  private readonly texts = new Map<string, string[] | null>();
  readonly standCache = new Map<string, string[] | null>();
  constructor(readonly root: string) {}
  kind(rel: string): "file" | "dir" | null {
    const got = this.kinds.get(rel);
    if (got !== undefined) return got;
    let out: "file" | "dir" | null = null;
    try {
      const st = lstatSync(join(this.root, rel));
      out = st.isDirectory() ? "dir" : st.isFile() || st.isSymbolicLink() ? "file" : null;
    } catch {
      out = null;
    }
    this.kinds.set(rel, out);
    return out;
  }
  lines(rel: string): string[] | null {
    if (this.texts.has(rel)) return this.texts.get(rel)!;
    let out: string[] | null = null;
    try {
      const st = lstatSync(join(this.root, rel));
      // Read through project-read.ts (test:project-writes 1b): a
      // regular file inside the project folder only, never a pipe or a link out of it put at that path after the look.
      if (st.isFile() && st.size <= MANIFEST_MAX_BYTES) out = readSourceText(join(this.root, rel)).split("\n").map((l) => l.replace(/\r$/, ""));
    } catch {
      out = null;
    }
    this.texts.set(rel, out);
    return out;
  }
  /** A quotation of line `n` (1-based) of `rel`, around `needle` where the line is long; null where it would not stand. */
  because(rel: string, n: number, needle?: string): ShipsBecause | null {
    const lines = this.lines(rel);
    if (!lines || n < 1 || n > lines.length) return null;
    const text = lines[n - 1]!.trim();
    if (text === "") return null;
    let quote = text;
    if (text.length > QUOTE_MAX) {
      const at = needle ? Math.max(0, text.indexOf(needle)) : 0;
      quote = text.slice(Math.max(0, at - 20), Math.max(0, at - 20) + 120).trim();
    }
    return programLineStands(this.root, rel, n, quote, this.standCache) ? { file: rel, line: n, quote } : null;
  }
  /** The first line (1-based) of `rel` matching `re`, from line `from`; 0 where none does. */
  find(rel: string, re: RegExp, from = 1): number {
    const lines = this.lines(rel);
    if (!lines) return 0;
    for (let i = Math.max(0, from - 1); i < lines.length; i++) if (re.test(lines[i]!)) return i + 1;
    return 0;
  }
  firstContent(rel: string): number {
    return this.find(rel, /^\s*[^\s#/;<!-]/) || this.find(rel, /\S/);
  }
}

/* ------------------------------------------------------------------------------------------------ *
 * The manifest walk.
 * ------------------------------------------------------------------------------------------------ */

type Kind =
  | "package" | "dockerfile" | "dockerignore" | "compose" | "devcontainer" | "bake" | "ci" | "script"
  | "pyproject" | "setup.py" | "setup.cfg" | "manifest.in" | "pytest.ini" | "tox.ini" | "requirements" | "gomod" | "goreleaser"
  | "gemspec" | "gemfile" | "rails" | "cargo" | "pom" | "gradle" | "docsgen" | "testcfg" | "open" | "procfile" | "dev";

const CI_RE = [
  /^\.github\/workflows\/[^/]+\.ya?ml$/, /^\.github\/actions\//, /^\.gitlab-ci\.ya?ml$/, /^\.circleci\//, /(^|\/)azure-pipelines[^/]*\.ya?ml$/,
  /^\.azure-pipelines\//, /(^|\/)Jenkinsfile[^/]*$/, /^\.buildkite\//, /^\.travis\.ya?ml$/, /^bitbucket-pipelines\.ya?ml$/, /^\.drone\.(ya?ml|star)$/,
  /^\.woodpecker(\.ya?ml$|\/)/, /^buildspec[^/]*\.ya?ml$/, /^cloudbuild[^/]*\.ya?ml$/, /^\.?appveyor\.ya?ml$/, /^\.cirrus\.ya?ml$/, /^codemagic\.ya?ml$/,
  /^bitrise\.ya?ml$/, /^\.semaphore\//, /^wercker\.ya?ml$/,
];
const isCi = (rel: string): boolean => CI_RE.some((re) => re.test(rel));
const OPEN_NAMES = new Set(["Procfile", "app.json", "fly.toml", "vercel.json", "now.json", "netlify.toml", "serverless.yml", "serverless.yaml", "Capfile", "render.yaml", "railway.json", "railway.toml", "wrangler.toml", "wrangler.json", "wrangler.jsonc", "firebase.json", "amplify.yml", "nixpacks.toml", ".platform.app.yaml", "appspec.yml", "app.yaml", "app.yml"]);

function kindOf(rel: string, base: string): Kind | null {
  if (isCi(rel)) return "ci";
  if (base === "package.json") return "package";
  if (base === ".dockerignore" || base.endsWith(".dockerignore")) return "dockerignore";
  if (/^(Dockerfile|Containerfile)([.-][^/]*)?$/.test(base) || /\.(dockerfile|containerfile)$/i.test(base)) return "dockerfile";
  if (/^(docker-)?compose([.-][^/]*)?\.ya?ml$/.test(base)) return "compose";
  if (rel === ".devcontainer.json" || /(^|\/)\.devcontainer\/(?:[^/]+\/)?devcontainer\.json$/.test(rel)) return "devcontainer";
  if (/^docker-bake[^/]*\.(hcl|json)$/.test(base)) return "bake";
  if (base === "pyproject.toml") return "pyproject";
  if (base === "setup.py") return "setup.py";
  if (base === "setup.cfg") return "setup.cfg";
  if (base === "MANIFEST.in") return "manifest.in";
  if (base === "pytest.ini") return "pytest.ini";
  if (base === "tox.ini") return "tox.ini";
  if (/^requirements[^/]*\.(txt|in)$/.test(base)) return "requirements";
  if (base === "go.mod") return "gomod";
  if (/^\.?goreleaser\.ya?ml$/.test(base)) return "goreleaser";
  if (base.endsWith(".gemspec")) return "gemspec";
  if (base === "Gemfile") return "gemfile";
  if (/(^|\/)config\/application\.rb$/.test(rel)) return "rails";
  if (base === "Cargo.toml") return "cargo";
  if (base === "pom.xml") return "pom";
  if (base === "build.gradle" || base === "build.gradle.kts") return "gradle";
  if (/^docusaurus\.config\.[cm]?[jt]s$/.test(base) || /^mkdocs\.ya?ml$/.test(base) || base === "conf.py" || base === "book.toml" || /(^|\/)\.vitepress\/config\.[cm]?[jt]s$/.test(rel) || /^hugo\.(toml|ya?ml|json)$/.test(base) || base === "_config.yml" || base === "antora.yml" || /^astro\.config\.[cm]?[jt]s$/.test(base)) return "docsgen";
  if (/^(jest|vitest|playwright|cypress)\.config\.[cm]?[jt]s(on)?$/.test(base) || /^karma\.conf\.[cm]?[jt]s$/.test(base) || /^\.mocharc(\.[a-z]+)?$/.test(base) || base === "conftest.py" || base === "noxfile.py") return "testcfg";
  if (base === "Procfile") return "procfile";
  if (OPEN_NAMES.has(base) || /(^|\/)config\/deploy\.rb$/.test(rel)) return "open";
  if (base === "Procfile.dev" || base === "Tiltfile" || /(^|\/)\.storybook\/main\.[cm]?[jt]sx?$/.test(rel)) return "dev";
  if (/\.(sh|bash)$/.test(base) || base === "Makefile" || base.endsWith(".mk")) return "script";
  return null;
}

function walkManifests(tree: Tree): { byKind: Map<Kind, string[]>; count: number; truncated: boolean } {
  const byKind = new Map<Kind, string[]>();
  let entries = 0;
  let truncated = false;
  let count = 0;
  const stack: string[] = [""];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let names: import("node:fs").Dirent[];
    try {
      names = readdirSync(join(tree.root, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of names) {
      if (++entries > SHIPS_WALK_MAX_ENTRIES) {
        truncated = true;
        stack.length = 0;
        break;
      }
      const rel = dir === "" ? d.name : `${dir}/${d.name}`;
      if (d.isDirectory()) {
        if (!SKIP_DIRS.has(d.name)) stack.push(rel);
        continue;
      }
      if (!d.isFile()) continue;
      const k = kindOf(rel, d.name);
      if (!k) continue;
      count++;
      const list = byKind.get(k) ?? [];
      list.push(rel);
      byKind.set(k, list);
    }
  }
  for (const list of byKind.values()) list.sort();
  return { byKind, count, truncated };
}

/* ------------------------------------------------------------------------------------------------ *
 * The repository model: every signal, by kind, before any file is classified.
 * ------------------------------------------------------------------------------------------------ */

interface Inclusion {
  /** The artifact's root folder; `pattern` is relative to it. */
  dir: string;
  pattern: string;
  /** `.dockerignore` patterns of the artifact's context, applied before `pattern` (Docker only). */
  ignore?: IgnoreRule[];
  /** A file-name test: the artifact includes only the files `pattern` covers whose name passes it. */
  name?: RegExp;
  eco: ShipsEcosystem;
  because: ShipsBecause;
}
interface PathSignal {
  dir: string;
  pattern: string;
  /** A file-name test inside `dir` (a toolchain's own naming convention); absent: every file `pattern` covers. */
  name?: RegExp;
  premise: NotShippedPremise;
  eco: ShipsEcosystem;
  because: ShipsBecause;
}
interface Scope {
  dir: string;
  why: string;
}
interface Closed {
  dir: string;
  ignore?: IgnoreRule[];
  eco: ShipsEcosystem;
  because: ShipsBecause;
}
interface Site {
  root: string;
  content: string[];
  because: ShipsBecause;
}
interface IgnoreRule {
  pattern: string;
  negate: boolean;
}

interface Model {
  inclusions: Inclusion[];
  signals: PathSignal[];
  open: Scope[];
  closed: Closed[];
  sites: Site[];
  /** Scopes inside which a product renders Markdown: an `.md` file there gets no documentation premise from its type. */
  mdRendered: Scope[];
  /** A documentation generator's config at the repository root: the repository is the site, and no file is docs by its type. */
  rootSite: boolean;
  /**
   * Folders a separate build may publish as a website (Storybook's own folder):
   * a file there gets no `development` and no `outside_artifacts` premise, so it stays `unknown` (counted).
   */
  siteBuilt: Scope[];
  /** Exact files a manifest names, by premise, with the line naming them. */
  named: Map<string, Signal[]>;
  truncated: boolean;
  manifests: number;
}

function addNamed(m: Model, file: string, s: Signal): void {
  const list = m.named.get(file) ?? [];
  list.push(s);
  m.named.set(file, list);
}

/** Path-like tokens of a command line: with a slash or a file extension, quotes and `./` taken off. */
function pathTokens(text: string): { token: string; raw: string; index: number }[] {
  const out: { token: string; raw: string; index: number }[] = [];
  const re = /(?:\.{1,2}\/)?[A-Za-z0-9_@+.-]+(?:\/[A-Za-z0-9_@+.-]+)*/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const raw = m[0];
    if (!raw.includes("/") && !/\.[A-Za-z0-9]{1,8}$/.test(raw)) continue;
    if (/^[0-9.]+$/.test(raw) || /:\/\//.test(text.slice(Math.max(0, m.index - 3), m.index + 3))) continue;
    out.push({ token: raw, raw, index: m.index });
  }
  return out;
}
const EXECUTORS = /(?:^|[\s;&|(])(?:bash|sh|zsh|dash|pwsh|powershell|source|\.|python[0-9.]*|node|deno|bun|ruby|perl|php|ts-node|tsx|zx|npx|exec|cp|mv|ln|cat|install|rsync)\s+(?:-[^\s]+\s+)*$/;
const CONFIG_FLAG = /(?:--config|--config-file|-c|--file|-f|--rcfile|--settings)(?:=|\s+)$/;
/**
 * A CI definition that PUBLISHES or DEPLOYS the product is how the product is supplied, not code that does not ship: it
 * takes no `ci` premise, and nothing it names takes one from it. A finding the re-check
 * rated REAL (a CRA supply duty) rested on the release workflows; `ci` there would have listed it as not shipped.
 */
const PUBLISHES = /\b(docker\s+(buildx\s+)?push|--push\b|push:\s*(true|\$\{\{)|npm\s+publish|yarn\s+(npm\s+)?publish|pnpm\s+publish|twine\s+upload|pypi-publish|poetry\s+publish|uv\s+publish|cargo\s+publish|gem\s+push|goreleaser|gh\s+release\s+(create|upload)|action-gh-release|create-release|release-action|helm\s+(push|upgrade|install)|mvn\b.*\bdeploy\b|gradlew?\b.*\bpublish|nuget\s+push|fly(ctl)?\s+deploy|kubectl\s+(apply|set\s+image|rollout)|heroku\b|skopeo\b|imagetools\s+create|crane\s+(copy|tag|push|append)|oras\s+push|login-action|docker\s+login|deploy)\b/i;
/** A deploy step that copies files from the tree to where they are served: the world is open (rule 5). */
const COPIES_OUT = /\b(rsync|scp|s3\s+(sync|cp)|gsutil\b.*\b(rsync|cp)|az\s+storage|firebase\s+deploy|netlify\s+deploy|vercel\b|surge\b|actions-gh-pages|github-pages-deploy-action|deploy-pages|upload-pages-artifact|ftp-deploy|lftp)\b/i;
/** Entry points no CI or developer mention may class as not shipped: path names used only to WITHHOLD a premise. */
const ENTRY_POINT = /^(server|app|main|index|manage|wsgi|asgi|worker|cli|run)\.[a-z]+$/;

/**
 * PLAIN CI ONLY. `ci` is decided
 * over plain inputs only: a GitHub Actions workflow whose `on:` names nothing but `push`, `pull_request` or `merge_group`
 * (the repository's own code under review), and no line of which deploys, releases, publishes, names a data service or
 * reads a repository secret. Anything else is operations, or cannot be read cheaply, and gets no premise from its CI
 * definition, nor do the files it runs: `unknown`, counted. That covers a `schedule`, a manual or dispatched run, a call
 * from another workflow, a composite action (its triggers are its callers'), and every other CI system, whose schedules
 * are set outside the file. A workflow that deletes preview database branches holding a copy of production data on a
 * nightly schedule was `ci`, so an opted-in retention finding there could be listed as not part of the shipped product.
 */
const PLAIN_CI_TRIGGERS = new Set(["push", "pull_request", "merge_group"]);
const CI_OPERATIONS = /\bsecrets\s*(?:\.|\[|:\s*inherit\b)|\b(?:deploy|release|publish)|\b(?:psql|pg_dump|pg_dumpall|pg_restore|mysql|mysqldump|mongo|mongosh|mongodump|mongorestore|redis-cli|sqlcmd|neonctl|neondatabase|supabase|pscale|turso|gcloud|gsutil|kubectl|helm|terraform|pulumi|flyctl|heroku|doctl|DATABASE_URL)\b|\b(?:aws|az|bq)\s+[a-z]|\bprisma\s+(?:migrate|db)\b/i;
/** The line of a plain CI definition's `on:` (1-based), or 0 where the definition is not plain CI. */
function plainCiLine(tree: Tree, f: string): number {
  if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(f)) return 0;
  const code = (tree.lines(f) ?? []).map((l) => (/^\s*#/.test(l) ? "" : l));
  if (code.some((l) => CI_OPERATIONS.test(l))) return 0;
  const at = code.findIndex((l) => /^["']?on["']?\s*:/.test(l));
  if (at < 0) return 0;
  const inline = code[at]!.replace(/^["']?on["']?\s*:/, "").replace(/\s+#.*$/, "").trim();
  const triggers: string[] = [];
  if (inline !== "") {
    const seq = /^\[([^\]]*)\]$/.exec(inline);
    for (const s of seq ? seq[1]!.split(",") : [inline]) triggers.push(s.trim().replace(/^["']|["']$/g, ""));
  } else {
    let indent = -1;
    for (let i = at + 1; i < code.length; i++) {
      const l = code[i]!;
      if (l.trim() === "") continue;
      const ind = /^\s*/.exec(l)![0].length;
      if (ind === 0) break;
      if (indent < 0) indent = ind;
      if (ind < indent) return 0;
      if (ind > indent) continue;
      const k = /^\s*(?:-\s+)?["']?([A-Za-z_]+)["']?\s*(?::(?:\s|$)|$)/.exec(l);
      if (!k) return 0;
      triggers.push(k[1]!);
    }
  }
  return triggers.length > 0 && triggers.every((t) => PLAIN_CI_TRIGGERS.has(t)) ? at + 1 : 0;
}

function buildModel(tree: Tree): Model {
  const walked = walkManifests(tree);
  const list = (k: Kind): string[] => walked.byKind.get(k) ?? [];
  const m: Model = { inclusions: [], signals: [], open: [], closed: [], sites: [], mdRendered: [], rootSite: false, siteBuilt: [], named: new Map(), truncated: walked.truncated, manifests: walked.count };
  if (walked.truncated) m.open.push({ dir: "", why: "walk cut short" });
  const devNamed = new Set<string>();
  const dockerTargets = new Set<string>();
  const dockerContexts = new Map<string, Set<string>>();
  const addContext = (dockerfile: string | null, ctx: string | null): void => {
    if (dockerfile === null || ctx === null) return;
    const set = dockerContexts.get(dockerfile) ?? new Set<string>();
    set.add(ctx);
    dockerContexts.set(dockerfile, set);
  };

  /* -- Dev containers: their compose files and Dockerfiles are development, and nothing they build is an artifact. -- */
  // ONLY INSIDE THE DEV CONTAINER'S OWN FOLDER. Naming a file
  // says the development environment uses it, not that only development does: the dev-container spec's own pattern reuses
  // the project's compose file, and a root `.devcontainer.json` may name the Dockerfile a release builds and pushes. A
  // compose file or Dockerfile named outside the `.devcontainer/` folder that holds the dev container (a root
  // `.devcontainer.json` has none) keeps whatever premise its other build files give it.
  // ONLY AT THE REPOSITORY ROOT. The convention is the repository's own
  // dev container: `.devcontainer.json` or the `.devcontainer/` folder at the root. A dev container nested deeper
  // (`src/<image>/.devcontainer/`) is as often the product itself, in a repository that builds and publishes dev-container
  // images, so its files are `build_tooling` (information only, `shipsLentByPremise`), never `development`, and a
  // Dockerfile in it is read as any other Dockerfile.
  for (const f of list("devcontainer")) {
    const lines = tree.lines(f) ?? [];
    const base = dirOf(f);
    const first = tree.firstContent(f);
    const own = first ? tree.because(f, first) : null;
    const devDir = f === ".devcontainer.json" ? null : dirOf(f);
    const folder = /^(.*?(?:^|\/)\.devcontainer)\//.exec(f)?.[1] ?? null;
    const atRoot = f === ".devcontainer.json" || folder === ".devcontainer";
    const premise = atRoot ? "development" : "build_tooling";
    if (own && devDir !== null) m.signals.push({ dir: devDir, pattern: "", premise, eco: "docker", because: own });
    if (own) addNamed(m, f, { premise, eco: "docker", because: [own] });
    lines.forEach((line, i) => {
      const mm = /"(dockerComposeFile|dockerfile|dockerFile)"\s*:\s*(\[[^\]]*\]|"[^"]*")/.exec(line);
      if (!mm) return;
      for (const v of mm[2]!.match(/"([^"]+)"/g) ?? []) {
        const p = joinRel(base, v.slice(1, -1));
        const b = tree.because(f, i + 1, v.slice(1, -1));
        if (p === null || !b || folder === null || !p.startsWith(`${folder}/`)) continue;
        if (atRoot) devNamed.add(p);
        addNamed(m, p, { premise, eco: "docker", because: [b] });
      }
    });
  }

  /* -- Compose: build contexts and targets; bind mounts open what they mount (unless the compose is a dev container's). -- */
  for (const f of list("compose")) {
    const lines = tree.lines(f) ?? [];
    const base = dirOf(f);
    const dev = devNamed.has(f);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const b = /^(\s*)build:\s*(.*)$/.exec(line);
      if (b) {
        const indent = b[1]!.length;
        let ctx: string | null = b[2]!.trim() && !b[2]!.trim().startsWith("#") ? b[2]!.trim().replace(/^["']|["']$/g, "") : null;
        let df: string | null = null;
        for (let j = i + 1; j < lines.length; j++) {
          const l = lines[j]!;
          if (l.trim() === "" || l.trim().startsWith("#")) continue;
          if (l.length - l.trimStart().length <= indent) break;
          const kv = /^\s*(context|dockerfile|target):\s*["']?([^"'#\s]+)/.exec(l);
          if (kv?.[1] === "context") ctx = kv[2]!;
          if (kv?.[1] === "dockerfile") df = kv[2]!;
          if (kv?.[1] === "target") dockerTargets.add(kv[2]!.toLowerCase());
        }
        const c = joinRel(base, ctx ?? ".");
        if (c !== null && !ctx?.includes("$")) addContext(joinRel(c, df ?? "Dockerfile"), c);
      }
      if (dev) continue;
      const short = /^\s*-\s*["']?(\.{1,2}\/[^:"'\s]*|\.)(?::|["']?\s*$)/.exec(line);
      const long = /^\s*source:\s*["']?(\.{1,2}\/[^"'\s]*|\.)/.exec(line);
      const env = /^\s*(?:-\s*)?(?:env_file|file):\s*["']?(\.{0,2}\/?[^"'\s]+)/.exec(line);
      for (const src of [short?.[1], long?.[1], env?.[1]]) {
        if (!src) continue;
        const p = joinRel(base, src);
        if (p !== null) m.open.push({ dir: p, why: `bind mount in ${f}` });
      }
    }
  }

  /* -- Docker bake files, CI files and shell scripts: build contexts and targets. -- */
  const contextLines = (f: string, base: string): void => {
    const lines = tree.lines(f) ?? [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const t of line.matchAll(/--target[=\s]+["']?([A-Za-z0-9_.-]+)/g)) dockerTargets.add(t[1]!.toLowerCase());
      const tk = /^\s*target\s*[:=]\s*["']?([A-Za-z0-9_.-]+)/.exec(line);
      if (tk) dockerTargets.add(tk[1]!.toLowerCase());
      if (/docker\s+(?:buildx\s+)?build\b/.test(line)) {
        const args = line.slice(line.search(/docker\s+(?:buildx\s+)?build\b/)).split(/\s+/).slice(2);
        let df: string | null = null;
        const pos: string[] = [];
        for (let k = 0; k < args.length; k++) {
          const a = args[k]!;
          if (a === "-f" || a === "--file") df = args[++k] ?? null;
          else if (a.startsWith("--file=")) df = a.slice(7);
          else if (/^-/.test(a)) {
            if (!a.includes("=") && /^(-t|--tag|--build-arg|--target|--platform|--label|--secret|--ssh|--cache-from|--cache-to|--output|-o|--progress|--network|--iidfile|--metadata-file)$/.test(a)) k++;
          } else if (/^[;&|]/.test(a)) break;
          else pos.push(a);
        }
        const ctx = pos[0];
        if (!ctx || ctx.includes("$") || /:\/\//.test(ctx)) continue;
        const c = joinRel(base, ctx);
        if (c === null) continue;
        addContext(df && !df.includes("$") ? joinRel(base, df) : joinRel(c, "Dockerfile"), c);
      }
      // A bake target's `dockerfile` is relative to its `context`; a CI step's `file` is relative to the workspace.
      const ctxKey = /^\s*(?:-\s*)?context\s*[:=]\s*["']?([^"'\s,]+)/.exec(line);
      if (ctxKey && !ctxKey[1]!.includes("$")) {
        const ctx = joinRel(base, ctxKey[1]!);
        let df: string | null = null;
        for (let j = Math.max(0, i - 8); j < Math.min(lines.length, i + 9); j++) {
          const fk = /^\s*(?:-\s*)?(?:file|dockerfile)\s*[:=]\s*["']?([^"'\s,]+)/.exec(lines[j]!);
          if (fk && !fk[1]!.includes("$")) df = fk[1]!;
        }
        const bake = f.endsWith(".hcl") || f.endsWith(".json");
        if (ctx !== null) addContext(df === null ? joinRel(ctx, "Dockerfile") : bake ? joinRel(ctx, df) : joinRel(base, df), ctx);
      }
    }
  };
  for (const f of list("bake")) contextLines(f, dirOf(f));
  for (const f of list("ci")) contextLines(f, "");
  for (const f of list("script")) {
    const text = (tree.lines(f) ?? []).join("\n");
    if (/docker|--target/.test(text)) contextLines(f, dirOf(f));
  }

  /* -- Node packages. -- */
  const mdRenderers = /^(marked|markdown-it|remark|remark-parse|react-markdown|@next\/mdx|@mdx-js\/[a-z-]+|contentlayer|gray-matter|showdown|micromark|unified|mdast-util-from-markdown|@nuxt\/content|markdown-to-jsx|snarkdown)$/;
  const runners = /^(jest|vitest|mocha|ava|jasmine|karma|uvu|tap|@playwright\/test|cypress|@jest\/core)$/;
  for (const f of list("package")) {
    const lines = tree.lines(f);
    if (!lines) continue;
    let pkg: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(lines.join("\n"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      pkg = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    const dir = dirOf(f);
    const keyLine = (key: string, from = 1): number => tree.find(f, new RegExp(`"${escapeRe(key)}"\\s*:`), from);
    const valueLine = (value: string, from: number): number => tree.find(f, new RegExp(`"${escapeRe(value)}"`), from);
    const files = Array.isArray(pkg.files) ? pkg.files.filter((x): x is string => typeof x === "string") : null;
    const isPrivate = pkg.private === true;
    // Entry points a published or installed package resolves: main, module, browser, types, bin, exports.
    const entries: string[] = [];
    const collect = (v: unknown): void => {
      if (typeof v === "string") entries.push(v);
      else if (v && typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) collect(x);
    };
    for (const k of ["main", "module", "browser", "types", "typings", "bin", "exports"]) collect(pkg[k]);
    for (const e of entries) {
      const p = joinRel(dir, e);
      const n = p === null ? 0 : valueLine(e, 1);
      const b = n ? tree.because(f, n, e) : null;
      if (p !== null && b) m.inclusions.push({ dir: "", pattern: p, eco: "node", because: b });
    }
    if (files) {
      const at = keyLine("files");
      const fb = at ? tree.because(f, at, "files") : null;
      for (const pat of files) {
        if (pat.startsWith("!")) continue;
        const n = at ? valueLine(pat, at) : 0;
        const b = n ? tree.because(f, n, pat) : null;
        const c = clean(pat);
        if (c !== null && b) m.inclusions.push({ dir, pattern: c, eco: "node", because: b });
      }
      // npm always packs the manifest, README and licence of a package with a `files` list.
      if (fb) for (const always of ["package.json", "README*", "LICENSE*", "LICENCE*", "readme*", "license*"]) m.inclusions.push({ dir, pattern: always, eco: "node", because: fb });
      // Closed only where the listed contents are the tree's own files: a package that builds what it lists compiles its
      // sources into it, so a source outside the list may ship (the world under the package stays open).
      const scriptNames = pkg.scripts && typeof pkg.scripts === "object" ? Object.keys(pkg.scripts as object) : [];
      const builds = scriptNames.some((n) => /^(pre|post)?(build|prepare|prepack|prepublish|prepublishOnly|compile|bundle|dist)([:-]|$)/.test(n));
      const listedHere = files.every((p) => p.startsWith("!") || hasGlob(p) || tree.kind(joinRel(dir, p) ?? "\u0000") !== null);
      if (fb && !builds && listedHere) m.closed.push({ dir, eco: "node", because: fb });
      else m.open.push({ dir, why: `${f} lists contents a build step makes` });
    } else if (!isPrivate && typeof pkg.name === "string" && typeof pkg.version === "string") {
      m.open.push({ dir, why: `${f} publishes its folder whole` });
    }
    const deps = { ...(pkg.dependencies as Record<string, unknown> | undefined), ...(pkg.devDependencies as Record<string, unknown> | undefined), ...(pkg.peerDependencies as Record<string, unknown> | undefined) };
    if (Object.keys(deps).some((d) => mdRenderers.test(d))) m.mdRendered.push({ dir, why: `${f} depends on a Markdown renderer` });
    const runner = Object.keys(deps).find((d) => runners.test(d)) ?? (pkg.jest ? "jest" : undefined);
    if (runner) {
      const n = pkg.jest && runner === "jest" && !deps.jest ? keyLine("jest") : valueLine(runner, 1);
      const b = n ? tree.because(f, n, runner) : null;
      if (b) {
        m.signals.push({ dir, pattern: "", name: /\.(test|spec)\.[cm]?[jt]sx?$/, premise: "test", eco: "node", because: b });
        m.signals.push({ dir, pattern: "**/__tests__", premise: "test", eco: "node", because: b });
        if (runner === "cypress") m.signals.push({ dir, pattern: "cypress", premise: "test", eco: "node", because: b });
      }
    }
    const storybook = Object.keys(deps).find((d) => /^(storybook|@storybook\/[a-z0-9-]+)$/.test(d));
    if (storybook) {
      const n = valueLine(storybook, 1);
      const b = n ? tree.because(f, n, storybook) : null;
      if (b) m.siteBuilt.push({ dir: posix.join(dir, ".storybook"), why: `${f} depends on ${storybook}` });
    }
    // Scripts: a file named by start/serve ships; one run or configured by a build step only is build tooling. A file
    // named only by any other script (dev, test, lint, generate, ...) gets no premise from it, so it stays `unknown`
    // (counted) unless something else speaks: a `dev` script
    // names the same entry file `build` compiles and `start` runs (`tsx watch src/index.ts`, then `tsc`, then
    // `node dist/index.js`), and a generator writes files the shipped code imports. `development` is left to toolchain
    // conventions that name a file outright (dev containers, Rails `config/environments/development.rb`, Go
    // `//go:build ignore|tools`, Procfile.dev, Tiltfile). Storybook's own folder is not among them: a Storybook build is
    // often published as a website, so its folder stays `unknown` (`siteBuilt`).
    const scripts = pkg.scripts && typeof pkg.scripts === "object" ? (pkg.scripts as Record<string, unknown>) : {};
    const scriptsAt = keyLine("scripts");
    for (const [name, cmd] of Object.entries(scripts)) {
      if (typeof cmd !== "string") continue;
      const n = scriptsAt ? keyLine(name, scriptsAt) : 0;
      const b = n ? tree.because(f, n, name) : null;
      if (!b) continue;
      const ships = /^(start|serve|server|prod|production)([:-]|$)/.test(name);
      const build = /^(pre|post)?(build|prepare|prepack|postpack|prepublish|prepublishOnly|install|compile|bundle|dist|package|release|vercel-build|heroku-postbuild)([:-]|$)/.test(name);
      for (const t of pathTokens(cmd)) {
        const p = joinRel(dir, t.token);
        if (p === null || tree.kind(p) !== "file") continue;
        const before = cmd.slice(0, t.index);
        const run = EXECUTORS.test(before) || CONFIG_FLAG.test(before) || /(^|[\s;&|])$/.test(before) && t.raw.startsWith("./");
        if (ships) addNamed(m, p, { premise: "product", eco: "node", because: [b] });
        else if (build) addNamed(m, p, run ? { premise: "build_tooling", eco: "node", because: [b] } : { premise: "unknown", eco: "node", because: [b] });
      }
    }
  }

  /* -- Procfile: every file a process line names ships; the folder is deployed as it is (open). -- */
  for (const f of list("procfile")) {
    m.open.push({ dir: dirOf(f), why: `${f} deploys its folder` });
    (tree.lines(f) ?? []).forEach((line, i) => {
      const b = tree.because(f, i + 1);
      if (!b) return;
      for (const t of pathTokens(line)) {
        const p = joinRel(dirOf(f), t.token);
        if (p !== null && tree.kind(p) === "file") addNamed(m, p, { premise: "product", eco: "node", because: [b] });
      }
    });
  }
  for (const f of list("open")) {
    const base = posix.basename(f);
    if (/^app\.ya?ml$/.test(base) && !tree.find(f, /^\s*runtime\s*:/)) continue;
    // Netlify builds and deploys its `base` folder; Firebase hosting serves its `public` folder: the route is open there.
    let dir: string | null = dirOf(f);
    const key = base === "netlify.toml" ? /^\s*base\s*=\s*["']([^"']*)["']/ : base === "firebase.json" ? /"public"\s*:\s*"([^"]*)"/ : null;
    const n = key ? tree.find(f, key) : 0;
    if (n) dir = joinRel(dirOf(f), key!.exec(tree.lines(f)![n - 1]!)![1]!);
    m.open.push({ dir: dir ?? dirOf(f), why: `${f} deploys a folder as it is` });
  }

  /* -- Docker. -- */
  const ignoresOf = (ctx: string, dockerfile: string): IgnoreRule[] => {
    const rules: IgnoreRule[] = [];
    for (const f of [joinRel(ctx, ".dockerignore"), `${dockerfile}.dockerignore`]) {
      if (f === null) continue;
      for (const raw of tree.lines(f) ?? []) {
        let s = raw.trim();
        if (s === "" || s.startsWith("#")) continue;
        const negate = s.startsWith("!");
        if (negate) s = s.slice(1).trim();
        const c = clean(s);
        if (c !== null) rules.push({ pattern: c, negate });
      }
    }
    return rules;
  };
  const manifestHere = (d: string): boolean => ["package.json", "go.mod", "requirements.txt", "pyproject.toml", "setup.py", "Gemfile", "pom.xml", "build.gradle", "build.gradle.kts", "Cargo.toml", "composer.json", "mix.exs"].some((x) => tree.kind(joinRel(d, x) ?? "") === "file");
  for (const f of list("dockerfile")) {
    const parsed = parseDockerfile(tree.lines(f) ?? []);
    if (parsed.stages.length === 0) continue;
    // Only the root dev container's folder (see above).
    const isDev = devNamed.has(f) || /^\.devcontainer\//.test(f);
    const last = parsed.stages[parsed.stages.length - 1]!;
    const lastFrom = tree.because(f, last.line);
    if (!isDev && lastFrom) addNamed(m, f, { premise: "product", eco: "docker", because: [lastFrom] });
    if (isDev) continue;
    // Shipping stages: the last, every stage a build names as its target, and every stage those reach.
    const byName = new Map<string, number>();
    parsed.stages.forEach((s, i) => {
      byName.set(String(i), i);
      if (s.name) byName.set(s.name, i);
    });
    const reach = new Set<number>();
    const todo = [parsed.stages.length - 1, ...parsed.stages.map((s, i) => (s.name && dockerTargets.has(s.name) ? i : -1)).filter((i) => i >= 0)];
    while (todo.length > 0) {
      const i = todo.pop()!;
      if (reach.has(i)) continue;
      reach.add(i);
      const s = parsed.stages[i]!;
      for (const ref of [s.base, ...s.copies.map((c) => c.from), ...s.mounts.map((x) => x.from)]) {
        const j = ref === undefined ? undefined : byName.get(ref.toLowerCase());
        if (j !== undefined && j !== i) todo.push(j);
      }
    }
    // A COPY --from another stage or an outside image brings no file of the tree; only a COPY or ADD without --from does.
    const sources = parsed.stages.flatMap((s, i) => (reach.has(i) ? s.copies.filter((c) => c.from === undefined) : []));
    const mounts = parsed.stages.flatMap((s, i) => (reach.has(i) ? s.mounts.filter((x) => x.from === undefined) : []));
    // The build context: what a compose file, bake file, CI step or script names; else the ancestor where most sources exist.
    let contexts = [...(dockerContexts.get(f) ?? [])];
    if (contexts.length === 0) {
      const named = sources.flatMap((c) => c.sources).filter((s) => s !== "" && s !== "." && !s.includes("$") && !hasGlob(s));
      const ancestors: string[] = [];
      for (let d = dirOf(f); ; d = dirOf(d)) {
        ancestors.push(d);
        if (d === "") break;
      }
      const score = (d: string): number => named.filter((s) => tree.kind(joinRel(d, s) ?? "\u0000") !== null).length;
      const best = Math.max(...ancestors.map(score));
      const tied = ancestors.filter((d) => score(d) === best);
      contexts = [manifestHere(dirOf(f)) ? tied[0]! : tied[tied.length - 1]!];
    }
    let resolved = true;
    for (const ctx of contexts) {
      const ignore = ignoresOf(ctx, f);
      for (const c of sources) {
        const b = tree.because(f, c.line);
        for (const raw of c.sources) {
          if (/:\/\//.test(raw) || raw.startsWith("git@")) continue;
          // A build argument inside a source path is read as any value within its path segment (a wider inclusion, never
          // a narrower one); a source that is a variable as a whole could be anything, and leaves the context open.
          const s = raw.replace(/\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*/g, "*");
          if (/^[*/.]*$/.test(s) && raw.includes("$")) {
            resolved = false;
            continue;
          }
          const p = clean(s);
          if (p === null) continue;
          // A source the tree does not hold is made before the image is built (a build output): the image may hold
          // compiled sources of files it never names, so the context is open.
          if (p !== "" && !hasGlob(p) && tree.kind(joinRel(ctx, p) ?? "\u0000") === null) resolved = false;
          if (b) m.inclusions.push({ dir: ctx, pattern: p, ignore, eco: "docker", because: b });
        }
      }
      for (const x of mounts) {
        const p = x.source === undefined ? null : clean(x.source);
        const b = tree.because(f, x.line);
        if (p !== null && p !== "" && b && !x.source!.includes("$")) m.signals.push({ dir: ctx, pattern: p, premise: "build_tooling", eco: "docker", because: b });
      }
      if (!resolved) m.open.push({ dir: ctx, why: `${f} copies a source it names by a variable` });
      else if (lastFrom) m.closed.push({ dir: ctx, ignore, eco: "docker", because: lastFrom });
    }
  }

  /* -- CI definitions, and files only a CI definition runs or copies. -- */
  const ciMentions = new Map<string, ShipsBecause>();
  for (const f of list("ci")) {
    const text = (tree.lines(f) ?? []).filter((l) => !/^\s*#/.test(l)).join("\n");
    if (COPIES_OUT.test(text) || /buildspec|appspec/.test(f)) m.open.push({ dir: "", why: `${f} copies files out of the tree` });
    if (PUBLISHES.test(text) || COPIES_OUT.test(text)) continue;
    // Only plain CI is `ci`, and only plain CI lends `ci` to the files it runs (PLAIN CI ONLY above).
    const plain = plainCiLine(tree, f);
    if (plain === 0) continue;
    const own = tree.because(f, plain);
    if (own) addNamed(m, f, { premise: "ci", eco: "ci", because: [own] });
    (tree.lines(f) ?? []).forEach((line, i) => {
      if (/^\s*#/.test(line)) return;
      for (const t of pathTokens(line)) {
        if (!t.raw.includes("/")) continue;
        const before = line.slice(0, t.index);
        if (!(EXECUTORS.test(before) || CONFIG_FLAG.test(before) || /(^|[\s;&|]|run:\s*|-\s+)$/.test(before) && t.raw.startsWith("./") || /^\s*(-\s*)?(local|template|file|config|script|path):\s*["']?$/.test(before))) continue;
        for (const p of [clean(t.token), joinRel(dirOf(f), t.token)]) {
          if (p === null || p === f || tree.kind(p) !== "file" || ENTRY_POINT.test(posix.basename(p))) continue;
          if (!ciMentions.has(p)) {
            const b = tree.because(f, i + 1, t.token);
            if (b) ciMentions.set(p, b);
          }
          break;
        }
      }
    });
  }
  for (const [p, b] of ciMentions) addNamed(m, p, { premise: "ci", eco: "ci", because: [b] });

  /* -- Python. -- */
  const pyRenderers = /^\s*["']?(markdown|mistune|markdown2|markdown-it-py|commonmark|pymdown-extensions)\b/i;
  for (const f of list("requirements")) if (tree.find(f, pyRenderers)) m.mdRendered.push({ dir: dirOf(f), why: `${f} names a Markdown renderer` });
  for (const f of list("pyproject")) {
    const lines = tree.lines(f) ?? [];
    const dir = dirOf(f);
    let section = "";
    let explicit = false;
    let project = false;
    lines.forEach((line, i) => {
      const sec = /^\s*\[\[?([^\]]+)\]\]?\s*$/.exec(line);
      if (sec) {
        section = sec[1]!.trim();
        if (section === "project" || section === "tool.poetry") project = true;
        if (section === "tool.pytest.ini_options") {
          const b = tree.because(f, i + 1);
          if (b) m.signals.push({ dir, pattern: "", name: /^(test_[^/]*|[^/]*_test)\.py$/, premise: "test", eco: "python", because: b });
        }
        return;
      }
      const b = (needle?: string): ShipsBecause | null => tree.because(f, i + 1, needle);
      // pytest's `testpaths` names where pytest searches, not what a test is (`["."]`, or a Django app package whose tests
      // live beside its views): it makes nothing `test`. The
      // section's `test_*.py`/`*_test.py` names above, conftest and the runner's own files stay.
      if ((section === "tool.setuptools" || section === "tool.hatch.build.targets.wheel" || section === "tool.hatch.build.targets.sdist" || section === "tool.hatch.build") && /^\s*(packages|include|only-include)\s*=/.test(line)) {
        for (const v of arrayValues(lines, i)) {
          explicit = true;
          const p = clean(section === "tool.setuptools" ? v.replace(/\./g, "/") : v);
          const bb = b(v) ?? b();
          if (p !== null && bb) {
            m.inclusions.push({ dir, pattern: p, eco: "python", because: bb });
            m.inclusions.push({ dir, pattern: joinRel("src", p) ?? p, eco: "python", because: bb });
          }
        }
      }
      if (section === "tool.poetry" && /^\s*packages\s*=/.test(line)) {
        explicit = true;
        for (let j = i; j < Math.min(lines.length, i + 40); j++) {
          for (const inc of lines[j]!.matchAll(/include\s*=\s*["']([^"']+)["'](?:[^}]*from\s*=\s*["']([^"']+)["'])?/g)) {
            const p = joinRel(inc[2] ?? "", inc[1]!);
            const bb = tree.because(f, j + 1, inc[1]!);
            if (p !== null && bb) m.inclusions.push({ dir, pattern: p, eco: "python", because: bb });
          }
          if (j > i && /^\s*\[/.test(lines[j]!)) break;
        }
      }
      if (section === "project.scripts" || section === "tool.poetry.scripts") {
        const mm = /=\s*["']([A-Za-z0-9_.]+)(?::[A-Za-z0-9_.]+)?["']/.exec(line);
        const bb = mm ? b(mm[1]!) : null;
        if (mm && bb) {
          const mod = mm[1]!.replace(/\./g, "/");
          for (const p of [`${mod}.py`, mod, `src/${mod}.py`, `src/${mod}`]) {
            const q = joinRel(dir, p);
            if (q !== null) m.inclusions.push({ dir: "", pattern: q, eco: "python", because: bb });
          }
        }
      }
      if (section.startsWith("project") && pyRenderers.test(line.replace(/^\s*["']/, ""))) m.mdRendered.push({ dir, why: `${f} names a Markdown renderer` });
    });
    if (project && !explicit) m.open.push({ dir, why: `${f} packages what setuptools discovers` });
    if (project && explicit) {
      const at = tree.find(f, /^\s*\[(project|tool\.poetry)\]\s*$/);
      const b = at ? tree.because(f, at) : null;
      if (b) m.closed.push({ dir, eco: "python", because: b });
    }
  }
  for (const f of list("setup.py")) {
    const dir = dirOf(f);
    const lines = tree.lines(f) ?? [];
    let explicit = false;
    lines.forEach((line, i) => {
      const mm = /\b(packages|py_modules|scripts)\s*=\s*\[([^\]]*)\]/.exec(line);
      if (!mm) return;
      explicit = true;
      for (const v of mm[2]!.match(/["']([^"']+)["']/g) ?? []) {
        const name = v.slice(1, -1);
        const p = mm[1] === "scripts" ? clean(name) : clean(name.replace(/\./g, "/") + (mm[1] === "py_modules" ? ".py" : ""));
        const b = tree.because(f, i + 1, name);
        if (p !== null && b) m.inclusions.push({ dir, pattern: p, eco: "python", because: b });
      }
    });
    if (!explicit || lines.some((l) => /find_(namespace_)?packages\s*\(|package_dir|entry_points|data_files|package_data/.test(l))) m.open.push({ dir, why: `${f} is a package whose contents are not read whole` });
  }
  for (const f of list("setup.cfg")) {
    const dir = dirOf(f);
    const pyt = tree.find(f, /^\s*\[tool:pytest\]\s*$/);
    const b = pyt ? tree.because(f, pyt) : null;
    if (b) m.signals.push({ dir, pattern: "", name: /^(test_[^/]*|[^/]*_test)\.py$/, premise: "test", eco: "python", because: b });
    if (tree.find(f, /^\s*\[options\]\s*$/)) m.open.push({ dir, why: `${f} declares a package` });
  }
  for (const f of list("manifest.in")) {
    const dir = dirOf(f);
    (tree.lines(f) ?? []).forEach((line, i) => {
      const mm = /^\s*(include|recursive-include|graft)\s+(.+)$/.exec(line);
      if (!mm) return;
      const b = tree.because(f, i + 1);
      const parts = mm[2]!.trim().split(/\s+/);
      const pats = mm[1] === "include" ? parts : [parts[0]!];
      for (const v of pats) {
        const p = clean(v);
        if (p !== null && b) m.inclusions.push({ dir, pattern: p, eco: "python", because: b });
      }
    });
  }
  for (const f of [...list("pytest.ini"), ...list("tox.ini")]) {
    const dir = dirOf(f);
    const own = tree.firstContent(f);
    const b = own ? tree.because(f, own) : null;
    if (b) addNamed(m, f, { premise: "test", eco: "python", because: [b] });
    const sec = tree.find(f, /^\s*\[(pytest|tool:pytest)\]\s*$/);
    const sb = sec ? tree.because(f, sec) : null;
    if (sb) m.signals.push({ dir, pattern: "", name: /^(test_[^/]*|[^/]*_test)\.py$/, premise: "test", eco: "python", because: sb });
    // `testpaths` here makes nothing `test` either (section 14).
  }

  /* -- Toolchain-own config files of test runners (conftest.py, noxfile.py, jest/vitest/... configs). -- */
  for (const f of list("testcfg")) {
    const own = tree.firstContent(f);
    const b = own ? tree.because(f, own) : null;
    if (b) addNamed(m, f, { premise: "test", eco: f.endsWith(".py") ? "python" : "node", because: [b] });
  }

  /* -- Go. -- */
  const goModules: { dir: string; because: ShipsBecause }[] = [];
  for (const f of list("gomod")) {
    const n = tree.find(f, /^\s*module\s+\S+/);
    const b = n ? tree.because(f, n) : null;
    if (!b) continue;
    goModules.push({ dir: dirOf(f), because: b });
    m.signals.push({ dir: dirOf(f), pattern: "**/testdata", premise: "test", eco: "go", because: b });
  }
  for (const f of list("goreleaser")) {
    const n = tree.find(f, /^\s*(-\s*)?main\s*:/) || tree.find(f, /^\s*builds\s*:/);
    const b = n ? tree.because(f, n) : null;
    const mod = goModules.filter((g) => under(f, g.dir)).sort((a, z) => z.dir.length - a.dir.length)[0];
    if (b && mod) m.inclusions.push({ dir: mod.dir, pattern: "", name: /^(?!.*_test\.go$).*\.go$/, eco: "go", because: b });
    if (tree.find(f, /^\s*(files|extra_files)\s*:/)) m.open.push({ dir: dirOf(f), why: `${f} archives files beside the binary` });
  }

  /* -- Ruby and Rails. -- */
  for (const f of list("rails")) {
    if (!tree.find(f, /Rails::Application/)) continue;
    const app = dirOf(dirOf(f));
    for (const [env, premise] of [["development", "development"], ["test", "test"]] as const) {
      const p = joinRel(app, `config/environments/${env}.rb`);
      if (p === null || tree.kind(p) !== "file") continue;
      const n = tree.find(p, /Rails\.application\.configure|configure\s+do/);
      const b = n ? tree.because(p, n) : tree.because(f, tree.find(f, /Rails::Application/));
      if (b) addNamed(m, p, { premise, eco: "ruby", because: [b] });
    }
  }
  for (const f of list("gemfile")) {
    const dir = dirOf(f);
    if (tree.find(f, /^\s*gem\s+["'](redcarpet|kramdown|commonmarker|rdiscount|github-markup|markdown|maruku|bluecloth)["']/)) m.mdRendered.push({ dir, why: `${f} names a Markdown renderer` });
    const rs = tree.find(f, /^\s*gem\s+["']rspec(-rails)?["']/);
    const b = rs && tree.kind(joinRel(dir, ".rspec") ?? "") === "file" ? tree.because(f, rs) : null;
    if (b) m.signals.push({ dir, pattern: "spec", premise: "test", eco: "ruby", because: b });
  }
  for (const f of list("gemspec")) {
    const dir = dirOf(f);
    const n = tree.find(f, /\.files\s*=/);
    const line = n ? tree.lines(f)![n - 1]! : "";
    if (!n || /git\s+ls-files|`|%x|IO\.popen|Open3/.test(line)) {
      m.open.push({ dir, why: `${f} packages files it lists at build time` });
      continue;
    }
    const b = tree.because(f, n);
    for (const g of line.matchAll(/["']([^"']+)["']/g)) {
      const p = clean(g[1]!);
      if (p !== null && b) m.inclusions.push({ dir, pattern: p, eco: "ruby", because: b });
    }
    for (const w of /%w[[(]([^\])]*)[\])]/.exec(line)?.[1]?.split(/\s+/) ?? []) {
      const p = clean(w);
      if (p !== null && p !== "" && b) m.inclusions.push({ dir, pattern: p, eco: "ruby", because: b });
    }
    if (b) m.closed.push({ dir, eco: "ruby", because: b });
  }

  /* -- Rust. -- */
  for (const f of list("cargo")) {
    const dir = dirOf(f);
    const pk = tree.find(f, /^\s*\[package\]\s*$/);
    const b = pk ? tree.because(f, pk) : null;
    if (!b) continue;
    m.inclusions.push({ dir, pattern: "src", eco: "rust", because: b });
    for (const t of ["tests", "benches"]) m.signals.push({ dir, pattern: t, premise: "test", eco: "rust", because: b });
    const bl = tree.find(f, /^\s*build\s*=\s*["']/);
    const buildFile = bl ? /=\s*["']([^"']+)["']/.exec(tree.lines(f)![bl - 1]!)?.[1] : "build.rs";
    const bb = bl ? tree.because(f, bl) : b;
    if (buildFile && bb) m.signals.push({ dir, pattern: clean(buildFile) ?? "build.rs", premise: "build_tooling", eco: "rust", because: bb });
    if (!tree.find(f, /^\s*include\s*=/)) m.open.push({ dir, why: `${f} publishes its crate folder` });
  }

  /* -- Java (Maven, Gradle): the standard source sets. -- */
  for (const f of [...list("pom"), ...list("gradle")]) {
    const dir = dirOf(f);
    const n = f.endsWith("pom.xml") ? tree.find(f, /<artifactId>/) : tree.find(f, /^\s*(plugins\s*\{|apply\s+plugin|id\s*[("'])/) || tree.firstContent(f);
    const b = n ? tree.because(f, n) : null;
    if (!b) continue;
    m.inclusions.push({ dir, pattern: "src/main", eco: "java", because: b });
    for (const t of ["src/test", "src/androidTest", "src/testFixtures", "src/integrationTest", "src/testDebug", "src/testRelease"]) m.signals.push({ dir, pattern: t, premise: "test", eco: "java", because: b });
  }

  /* -- Development tooling by its own convention: Procfile.dev, Tiltfile. Storybook's folder may be published: unknown. -- */
  for (const f of list("dev")) {
    if (/\.storybook\//.test(f)) {
      m.siteBuilt.push({ dir: dirOf(f), why: `${f} is Storybook's configuration` });
      continue;
    }
    const own = tree.firstContent(f);
    const b = own ? tree.because(f, own) : null;
    if (!b) continue;
    addNamed(m, f, { premise: "development", eco: "node", because: [b] });
  }

  /* -- Documentation sites (a generator config NOT at the repository root). -- */
  for (const f of list("docsgen")) {
    const base = posix.basename(f);
    let root = dirOf(f);
    let content: string[] = [];
    let n = 0;
    if (base.startsWith("docusaurus.config")) {
      n = tree.find(f, /\b(title|presets|themeConfig)\b/);
      content = ["docs", "blog", "static", "versioned_docs", "i18n"];
    } else if (base.startsWith("mkdocs")) {
      n = tree.find(f, /^\s*site_name\s*:/);
      const dd = tree.find(f, /^\s*docs_dir\s*:/);
      content = [dd ? (/:\s*["']?([^"'#\s]+)/.exec(tree.lines(f)![dd - 1]!)?.[1] ?? "docs") : "docs"];
    } else if (base === "conf.py") {
      n = tree.find(f, /^\s*(extensions|html_theme|master_doc|root_doc)\s*=/);
      content = [""];
    } else if (base === "book.toml") {
      n = tree.find(f, /^\s*\[book\]\s*$/);
      content = ["src"];
    } else if (/\.vitepress\/config/.test(f)) {
      root = dirOf(dirOf(f));
      n = tree.find(f, /\b(defineConfig|title|themeConfig)\b/);
      content = ["", "public"];
    } else if (base.startsWith("hugo.")) {
      n = tree.find(f, /\b(baseURL|baseurl|title)\b/);
      content = ["content", "static", "data"];
    } else if (base === "_config.yml") {
      n = tree.firstContent(f);
      content = ["", "_posts", "_data"];
    } else if (base === "antora.yml") {
      n = tree.find(f, /^\s*name\s*:/);
      content = ["modules"];
    } else if (base.startsWith("astro.config")) {
      n = tree.find(f, /starlight/);
      content = ["src/content", "public"];
    }
    const b = n ? tree.because(f, n) : null;
    if (b && root === "") m.rootSite = true;
    if (!b || root === "") continue;
    m.sites.push({ root, content: content.map((c) => joinRel(root, c) ?? root), because: b });
  }
  // A project no declared artifact includes is deployed some other way (a sibling app of a monorepo, a tool with its own
  // dependencies): the world under it is open. A project manifest is a package.json with scripts or an entry point, a
  // pyproject with a project table, setup.py, requirements, go.mod, Gemfile, Cargo.toml, pom.xml or build.gradle.
  const projects = [
    ...list("package").filter((f) => tree.find(f, /"(scripts|main|bin|exports)"\s*:/) > 0),
    ...list("pyproject").filter((f) => tree.find(f, /^\s*\[(project|tool\.poetry)\]\s*$/) > 0),
    ...list("setup.py"), ...list("requirements"), ...list("gomod"), ...list("gemfile"), ...list("cargo"), ...list("pom"), ...list("gradle"),
  ];
  for (const f of projects) {
    // The manifest of a package this module closed declares that artifact itself; it opens nothing.
    if (m.closed.some((c) => c.eco !== "docker" && c.dir === dirOf(f))) continue;
    const included = m.inclusions.some((x) => under(f, x.dir) && covers(x.pattern, relTo(f, x.dir)) && !(x.name && !x.name.test(posix.basename(f))) && !ignored(x.ignore, relTo(f, x.dir)));
    if (!included) m.open.push({ dir: dirOf(f), why: `${f} is a project no declared artifact includes` });
  }
  return m;
}

/** The string values of a TOML array starting at line `i` (one line or several). */
function arrayValues(lines: string[], i: number): string[] {
  const out: string[] = [];
  let text = lines[i]!.slice(lines[i]!.indexOf("=") + 1);
  for (let j = i + 1; !text.includes("]") && j < Math.min(lines.length, i + 60); j++) text += `\n${lines[j]!}`;
  for (const v of text.matchAll(/["']([^"']+)["']/g)) out.push(v[1]!);
  return out;
}

/* ------------------------------------------------------------------------------------------------ *
 * Dockerfile reading.
 * ------------------------------------------------------------------------------------------------ */

interface DockerStage {
  line: number;
  name?: string;
  base: string;
  copies: { line: number; from?: string; sources: string[] }[];
  mounts: { line: number; from?: string; source?: string }[];
}

function parseDockerfile(lines: string[]): { stages: DockerStage[] } {
  const stages: DockerStage[] = [];
  let i = 0;
  while (i < lines.length) {
    const start = i;
    let text = lines[i]!;
    if (/^\s*(#|$)/.test(text)) {
      i++;
      continue;
    }
    while (/\\\s*$/.test(text) && i + 1 < lines.length) {
      i++;
      if (/^\s*#/.test(lines[i]!)) continue;
      text = `${text.replace(/\\\s*$/, " ")}${lines[i]!}`;
    }
    i++;
    const here = /<<-?\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?/.exec(text);
    if (here) {
      const word = here[1]!;
      while (i < lines.length && lines[i]!.trim() !== word) i++;
      i++;
    }
    const mm = /^\s*([A-Za-z]+)\s+(.*)$/.exec(text);
    if (!mm) continue;
    const op = mm[1]!.toUpperCase();
    const rest = mm[2]!.trim();
    if (op === "FROM") {
      const parts = rest.split(/\s+/).filter((p) => !p.startsWith("--"));
      const as = parts.findIndex((p) => p.toLowerCase() === "as");
      stages.push({ line: start + 1, base: (parts[0] ?? "").toLowerCase(), ...(as >= 0 && parts[as + 1] ? { name: parts[as + 1]!.toLowerCase() } : {}), copies: [], mounts: [] });
      continue;
    }
    const stage = stages[stages.length - 1];
    if (!stage) continue;
    if (op === "COPY" || op === "ADD") {
      let body = rest;
      let from: string | undefined;
      for (;;) {
        const flag = /^--([a-z-]+)(?:=(\S+))?\s*/.exec(body);
        if (!flag) break;
        if (flag[1] === "from") from = flag[2]?.toLowerCase();
        body = body.slice(flag[0].length);
      }
      let args: string[];
      if (body.startsWith("[")) {
        try {
          const arr: unknown = JSON.parse(body);
          args = Array.isArray(arr) ? arr.map(String) : [];
        } catch {
          args = body.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
        }
      } else args = body.split(/\s+/).map((s) => s.replace(/^["']|["']$/g, ""));
      if (here) args = args.filter((a) => !a.startsWith("<<"));
      if (args.length >= 2) stage.copies.push({ line: start + 1, ...(from !== undefined ? { from } : {}), sources: args.slice(0, -1) });
      continue;
    }
    if (op === "RUN") {
      for (const mount of rest.matchAll(/--mount=(\S+)/g)) {
        const kv = new Map(mount[1]!.split(",").map((p) => p.split("=") as [string, string]));
        const type = kv.get("type") ?? "bind";
        if (type !== "bind") continue;
        const from = kv.get("from")?.toLowerCase();
        const source = kv.get("source") ?? kv.get("src");
        stage.mounts.push({ line: start + 1, ...(from !== undefined ? { from } : {}), ...(source !== undefined ? { source } : {}) });
      }
    }
  }
  return { stages };
}

/* ------------------------------------------------------------------------------------------------ *
 * Classification.
 * ------------------------------------------------------------------------------------------------ */

/** Whether a context's `.dockerignore` excludes `rel`, memoized per rule list (one list per Dockerfile and context). */
const IGNORED = new WeakMap<IgnoreRule[], Map<string, boolean>>();
const ignored = (rules: IgnoreRule[] | undefined, rel: string): boolean => {
  if (!rules || rules.length === 0) return false;
  let memo = IGNORED.get(rules);
  if (!memo) IGNORED.set(rules, (memo = new Map()));
  const known = memo.get(rel);
  if (known !== undefined) return known;
  let out = false;
  for (const r of rules) if (covers(r.pattern, rel)) out = !r.negate;
  memo.set(rel, out);
  return out;
};

/** The order a file's non-shipping signals are taken in: the counted docs-site class first, the plainest class last. */
const NOT_SHIPPED_ORDER: NotShippedPremise[] = ["docs_site", "test", "ci", "build_tooling", "development", "documentation"];
/**
 * The only files `outside_artifacts` is given to: program source, the kind an artifact either compiles in or leaves out.
 * Deployment and configuration material (compose files, charts, manifests, install scripts, samples, CI yaml) is handed
 * to operators by the repository itself whether or not an image holds it, so being outside every image says nothing
 * about whether it ships: it stays `unknown`.
 */
const SOURCE_TYPES = /\.(py|pyi|ipynb|js|mjs|cjs|jsx|ts|mts|cts|tsx|vue|svelte|go|rb|java|kt|scala|groovy|rs|c|cc|cpp|cxx|h|hh|hpp|cs|fs|vb|php|swift|m|mm|dart|ex|exs|erl|clj|cljs|lua|r|jl|zig|nim)$/i;
const DOC_TEXT = /\.(md|markdown|rst|adoc|asciidoc)$/i;
const SITE_TEXT = /\.(md|markdown|rst|adoc|asciidoc|txt)$/i;

/**
 * A DOCS SITE'S PROSE FILE IS DOCUMENTATION ONLY WHERE IT IS PLAIN.
 * A docs site is a website the maker runs, and its generator passes what a prose file holds besides prose to the
 * page: raw markup (an iframe, a script, an image, an object, any element), a component (Docusaurus compiles `.md` as
 * MDX), an ESM import or export, front matter whose `head` or `script` entries the generator writes into the page
 * (VitePress), a reStructuredText `raw` or media directive, an AsciiDoc passthrough or media macro, or a Markdown image
 * whose address is absolute. Any such line, anywhere in the file outside a fenced code block and an inline code span,
 * makes the whole file the maker's website (`docs_site`, counted), with that line first among the reasons. The file is
 * judged, not the matched line: an element opened on one line and given its address on the next, a component and an
 * `object` element all load something on the maker's site. Only a file with none of these is `documentation`.
 */
const SITE_TAG = /<\/?[A-Za-z][A-Za-z0-9-]*(?:[.:][A-Za-z][\w-]*)*(?=[\s/>]|$)/;
const MDX_ESM = /^\s*(?:import\s|export\s+(?:default|const|let|var|function|class|\{|\*))/;
const SITE_DIRECTIVE = /^\s*\.\.\s+(?:raw|image|figure|video|audio|youtube|vimeo|iframe|embed)\s*::|^\s*(?:image|video|audio)::\s*\S|^\s*\+{4}\s*$|\bpass:\[/i;
const MD_IMAGE = /!\[[^\]]*\]\(\s*<?(https?:)?\/\//i;
const FRONT_MATTER_LOADS = /^\s*(?:head|scripts?)\s*:|\bscript\b/i;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const withoutInlineCode = (l: string): string => l.replace(/(`+)[^`]*?\1/g, "");
/** The first line (1-based) of a docs-site prose file that is not plain prose (see above), or 0 where every line is. */
function nonPlainLineOf(tree: Tree, file: string): number {
  const lines = tree.lines(file);
  if (!lines) return 0;
  let i = 0;
  const open = /^\uFEFF?(---|\+\+\+)\s*$/.exec(lines[0] ?? "");
  if (open) {
    for (i = 1; i < lines.length; i++) {
      if (/^(---|\.\.\.|\+\+\+)\s*$/.test(lines[i]!)) break;
      if (FRONT_MATTER_LOADS.test(lines[i]!)) return i + 1;
    }
    i++;
  }
  let fence: string | null = null;
  for (; i < lines.length; i++) {
    const f = FENCE.exec(lines[i]!);
    if (f) {
      if (fence === null) fence = f[1]![0]!;
      else if (f[1]![0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const l = withoutInlineCode(lines[i]!);
    if (SITE_TAG.test(l) || MDX_ESM.test(l) || SITE_DIRECTIVE.test(l) || MD_IMAGE.test(l)) return i + 1;
  }
  return 0;
}

function classify(tree: Tree, m: Model, file: string): { row: ShipsPremiseRow; eco: ShipsEcosystem | null } {
  const inc: Signal[] = [];
  const non: Signal[] = [];
  for (const x of m.inclusions) {
    if (!under(file, x.dir)) continue;
    const rel = relTo(file, x.dir);
    // The pattern first: most inclusions do not cover a given file, and the ignore list is read only for those that do.
    if (!covers(x.pattern, rel) || (x.name && !x.name.test(posix.basename(file))) || ignored(x.ignore, rel)) continue;
    inc.push({ premise: "product", eco: x.eco, because: [x.because] });
  }
  // A file a build step names as a source, or one in a folder a separate build may publish as a website (`siteBuilt`).
  let buildNamed = m.siteBuilt.some((s) => under(file, s.dir));
  for (const s of m.named.get(file) ?? []) {
    if (s.premise === "product") inc.push(s);
    else if (s.premise === "unknown") buildNamed = true;
    else non.push(s);
  }
  for (const s of m.signals) {
    if (!under(file, s.dir)) continue;
    const rel = relTo(file, s.dir);
    if (s.name ? covers(s.pattern, rel) && s.name.test(posix.basename(file)) : covers(s.pattern, rel)) non.push({ premise: s.premise, eco: s.eco, because: [s.because] });
  }
  const base = posix.basename(file);
  if (/\.go$/.test(file)) {
    if (/_test\.go$/.test(file)) {
      const n = tree.find(file, /^\s*package\s+\w+/);
      const b = n ? tree.because(file, n) : null;
      if (b) non.push({ premise: "test", eco: "go", because: [b] });
    }
    const lines = tree.lines(file) ?? [];
    for (let i = 0; i < Math.min(lines.length, 40); i++) {
      if (/^\s*package\s/.test(lines[i]!)) break;
      if (/^\s*\/\/\s*(go:build|\+build)\s+(ignore|tools)\s*$/.test(lines[i]!)) {
        const b = tree.because(file, i + 1);
        if (b) non.push({ premise: "development", eco: "go", because: [b] });
      }
    }
  }
  const site = m.sites.filter((s) => under(file, s.root)).sort((a, z) => z.root.length - a.root.length)[0];
  if (site) {
    // Only prose is `documentation`. A site's data files (an OpenAPI document, a YAML table) and its code are the maker's
    // website, counted (`docs_site`): on one real run a finding the re-check rated REAL had every place in the docs site's
    // OpenAPI file, and `documentation` there would have listed it as not shipped (the design's hard gate, section 8.1). A prose file is documentation only where it is plain:
    // one line of anything else anywhere in it (`nonPlainLineOf`) makes it the maker's website, with that line first among
    // the reasons. The premise is per file, so every finding in such a file is counted; that errs toward showing.
    const markupAt = SITE_TEXT.test(base) ? nonPlainLineOf(tree, file) : 0;
    const markup = markupAt > 0 ? tree.because(file, markupAt) : null;
    const premise: NotShippedPremise = SITE_TEXT.test(base) && !markup ? "documentation" : "docs_site";
    non.push({ premise, eco: "docs", because: markup ? [markup, site.because] : [site.because] });
  } else if (DOC_TEXT.test(base) && !m.rootSite && !m.mdRendered.some((s) => under(file, s.dir))) {
    const n = tree.firstContent(file);
    const b = n ? tree.because(file, n) : null;
    if (b) non.push({ premise: "documentation", eco: "text", because: [b] });
  }
  // A file a build step names as a source (not a script it runs) is compiled into what ships: no developer class for it.
  const nonKept = buildNamed ? non.filter((s) => s.premise !== "development") : non;
  const classes = [...new Set(nonKept.map((s) => s.premise as NotShippedPremise))].sort((a, z) => NOT_SHIPPED_ORDER.indexOf(a) - NOT_SHIPPED_ORDER.indexOf(z));
  if (inc.length > 0) {
    const because = dedupe(inc.flatMap((s) => s.because)).slice(0, BECAUSE_MAX);
    return { row: { premise: "product", because, ...(classes.length > 0 ? { conflict: classes } : {}) }, eco: inc[0]!.eco };
  }
  if (classes.length > 0) {
    const first = classes[0]!;
    const sigs = nonKept.filter((s) => s.premise === first);
    return { row: { premise: first, because: dedupe(sigs.flatMap((s) => s.because)).slice(0, BECAUSE_MAX) }, eco: sigs[0]!.eco };
  }
  if (!buildNamed && SOURCE_TYPES.test(base) && !m.open.some((o) => under(file, o.dir))) {
    const closed = m.closed.filter((c) => under(file, c.dir) && !ignored(c.ignore, relTo(file, c.dir)));
    const ignoredBy = m.closed.filter((c) => under(file, c.dir) && ignored(c.ignore, relTo(file, c.dir)));
    const by = closed.length > 0 ? closed : ignoredBy;
    if (by.length > 0) return { row: { premise: "outside_artifacts", because: dedupe(by.map((c) => c.because)).slice(0, BECAUSE_MAX) }, eco: by[0]!.eco };
  }
  return { row: { premise: "unknown" }, eco: null };
}

function dedupe(list: ShipsBecause[]): ShipsBecause[] {
  const seen = new Set<string>();
  return list.filter((b) => {
    const k = `${b.file}\u0000${b.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * The premise of every file of `files` (tree-relative paths, as `locations[].file` names them), read from the build and
 * tooling files of the tree at `root`. Every file of `files` gets a row; a row other than `unknown` carries at least one
 * `because` line that stands at its line (`programLineStands`).
 */
export function computeShipsPremises(root: string, files: readonly string[]): ShipsPremiseResult {
  const tree = new Tree(root);
  const model = buildModel(tree);
  const premises: Record<string, ShipsPremiseRow> = {};
  const decidedBy: Record<string, ShipsEcosystem | null> = {};
  for (const file of [...new Set(files)].sort()) {
    const rel = clean(file);
    if (rel === null || rel === "") {
      premises[file] = { premise: "unknown" };
      decidedBy[file] = null;
      continue;
    }
    const { row, eco } = classify(tree, model, rel);
    premises[file] = row;
    decidedBy[file] = eco;
  }
  return { premises, decidedBy, manifests: model.manifests, truncated: model.truncated };
}

/**
 * The premises as findings.json writes them: every file holding a location of `candidates`, keyed by the path the
 * location names. Candidates are read, never changed.
 */
export function shipsPremisesForCandidates(root: string, candidates: readonly { locations?: readonly { file?: unknown }[] }[]): Record<string, ShipsPremiseRow> {
  const files = new Set<string>();
  for (const c of candidates) for (const l of c.locations ?? []) if (typeof l.file === "string" && l.file !== "") files.add(l.file);
  return computeShipsPremises(root, [...files]).premises;
}

/** What keeps the world open or closes it, for a record: the open routes and the closed artifacts' roots (never written into findings.json). */
export function shipsWorldOf(root: string): { open: { dir: string; why: string }[]; closed: { dir: string; eco: ShipsEcosystem }[]; truncated: boolean } {
  const m = buildModel(new Tree(root));
  return { open: m.open, closed: m.closed.map((c) => ({ dir: c.dir, eco: c.eco })), truncated: m.truncated };
}
