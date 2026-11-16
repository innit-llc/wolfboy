/**
 * THE ORIENTATION SHEET — what every layer-2 child used to re-discover for itself, computed once.
 *
 * ## Why it exists
 *
 * Measured over the 82 adjudicator transcripts of one real run of 2026-09-02:
 * 1,320 tool calls, of which 140 were reads
 * of README, manifests and configuration taken purely to work out what the repository is, 25 were
 * the same consent-vocabulary grep run again, and 74 were globs of the tree's shape. Every child
 * paid for the same answers, and the answers are the same for every child because they are about the
 * repository and not about the candidate. This document is those answers, taken once, by the CLI,
 * with no model involved.
 *
 * ## What it is NOT, and this is the load-bearing part
 *
 * **Nothing here is a fact about the product.** Not what it does, not who it serves, not where it is
 * established, not whether it carries a consent mechanism. Those are asked of the person running the
 * scan or read from their declared documents,
 * and a scanner that inferred one of them from source vocabulary would be doing the
 * thing this project measured, discarded and banned. Every row below is one of three shapes:
 *
 *   - a PATH, or a count of paths, matched by a pattern that is quoted beside it;
 *   - a VERBATIM value out of a manifest, with the file and line it was read from;
 *   - a TEXT MATCH: this term occurs in this many files, and here are the first three.
 *
 * A term occurring nowhere is reported as occurring nowhere, and that is `unknown`, never `absent`
 * and never `clean`. The sheet says so in its own `read_this_first` block, because the
 * block travels with it into every child's brief and the caveat has to travel with the counts.
 *
 * ## Determinism
 *
 * The sheet carries no clock, no `scan_id` and no random value: it is a pure function of the walked
 * file list, the bundle and the bytes of the tree, so two runs of the same tree at `--jobs 1` and
 * `--jobs 2` produce byte-identical documents and a gate asserts it. The run it belongs to is the
 * `findings.json` written beside it.
 *
 * ## It is a separate file and it changes no other output
 *
 * `findings.json` is written by `writeFindingsJson` from the scan's own result and no line of this
 * module reaches it. `--orientation off` (or `PRODUCT_CLI_ORIENTATION=0`) skips the whole of this
 * module including its pass over the tree, and the findings document is byte-identical either way —
 * a test proves it on two real repositories against the pinned baselines.
 */


import { join } from "node:path";
import type { DependencyInventoryEntry } from "wolfboy-schemas";
import type { WalkExclusion } from "./walk.js";
import { readScopeReason, type InformationalPathClass, type ReadScope } from "./read-scope.js";
import { readSourceText } from "./project-read.js";

/**
 * The byte ceiling on the rendered JSON. About 8,000 tokens: the sheet is carried in the launch
 * message of every child, so its size is multiplied by the number of children and is a product cost
 * in exactly the sense the design means. Measured sizes for the corpus are in
 * an internal record.
 *
 * The per-section caps below keep an ordinary tree well under it; the ladder in `applyByteCap`
 * is what a pathological tree meets, and every reduction it makes is written into `truncated[]`
 * rather than taken silently.
 */
/** An `--orientation` value this module cannot act on. `index.ts` makes it exit 1. */
export class OrientationOptionError extends Error {}

/**
 * `--orientation`, resolved before a tree is read.
 *
 * The flag wins over the environment, and only where it was actually typed — the same precedence
 * `--no-prefilter` has over `PRODUCT_CLI_PREFILTER`, for the same reason: an argument somebody typed
 * is a stronger statement than an environment somebody inherited. `PRODUCT_CLI_ORIENTATION=0` is the
 * switch for a harness that cannot edit an argument vector; any other value of that variable, "1"
 * and "" included, leaves the sheet on, because a variable a reader cannot recognise as an
 * instruction must not quietly remove an output.
 */
export function resolveOrientation(spec: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (spec === undefined) return env["PRODUCT_CLI_ORIENTATION"] !== "0";
  if (spec === "on") return true;
  if (spec === "off") return false;
  throw new OrientationOptionError(
    `--orientation must be one of: on, off — got ${JSON.stringify(spec)}. ` +
      `on (the default) writes orientation.json and orientation.md beside --out; off writes neither ` +
      `and skips the pass over the tree they cost. Neither setting changes the findings document, ` +
      `and a gate asserts that byte for byte.`,
  );
}

export const ORIENTATION_MAX_BYTES = 32_768;

/** Per-section caps. Exported so the gate asserts the document against these and not against a copy. */
export const ORIENTATION_CAPS = {
  languages: 20,
  manifests: 25,
  dependencies: 30,
  build_files: 40,
  entry_points: 25,
  path_class_examples: 3,
  consent_paths: 3,
  /**
   * Declaration rows carried per package. A monorepo declares one package in twenty manifests, and
   * twenty rows saying the same thing crowded the whole section off a large Node CMS's sheet: the count beside
   * them is what a reader of an orientation sheet actually needs.
   */
  declarations_per_package: 3,
  /** Manifests actually OPENED for `entry_points`, shallowest first. A monorepo has thousands. */
  manifests_read: 25,
} as const;

type CapKey = keyof typeof ORIENTATION_CAPS;

/**
 * THE ONE PLACE A LIST IS SHORTENED, AND THE REASON IT IS ONE PLACE.
 *
 * On 2026-09-17 an independent verification of this module found a cap that hid what it removed: the
 * `entry_points` ROW cap fired inside the last manifest the loop had opened, so the section came back
 * 25 rows long with `truncated: []` beside it and one tree's plugins manifest
 * `scripts.build` was absent from a document that said it had left nothing out. The defect was not
 * the loop. The defect was that "shorten the list" and "write down what the shortening removed" were
 * two separate acts at every one of eight cap sites, so any site could do the first and forget the
 * second — and three of them already had, in three different ways (a `truncated[]` row pushed by
 * hand, a counter beside the list, nothing at all).
 *
 * So the repair is not a ninth hand-written push. **Every cap in this module is consumed through this
 * ledger, and the truncation rows are DERIVED from what the ledger was told rather than written by
 * the caller.** A section cannot be shortened without the row, because the row is computed from the
 * same two numbers the shortening used. Adding a new capped list without coming here means writing a
 * bare `.slice()` over a cap, which a test refuses by reading this file's own
 * source: `ORIENTATION_CAPS` is referenced nowhere but inside this class.
 *
 * Two shapes of list, and the line between them is the size of the record, not the strength of it:
 *
 *   - a SECTION-level list (`languages`, `manifests`, `entry_points`, `build_and_deploy_files`,
 *     `dependencies.ranked_by_call_sites`) gets a row in `truncated[]`;
 *   - a PER-ROW sub-list (a path class's `examples`, a term's `first_paths`, a package's
 *     `declared_in`) declares its tail with a COUNTER in the same object, because 27 consent terms
 *     would otherwise put 27 rows into `truncated[]` and bury the section-level ones. The ledger
 *     hands the caller the number to place, so the counter cannot be forgotten either: it is the
 *     second half of the return value.
 *
 * One row per section, always: where the byte ladder shortens a list the per-section cap had already
 * shortened, `kept` moves and `population` does not, so the row reads against what the section was
 * computed from and not against an intermediate length nobody can check.
 */
class CapLedger {
  /** Insertion-ordered — which is the order `rows()` emits, so the document's order is the code's. */
  private readonly sections = new Map<string, { population: number; kept: number; declares: "row" | "counter" }>();

  /** A section-level list, shortened to its cap. The truncation row follows from this call. */
  take<T>(section: string, all: readonly T[], cap: CapKey): T[] {
    const kept = all.slice(0, ORIENTATION_CAPS[cap]);
    this.register(section, all.length, kept.length, "row");
    return kept;
  }

  /**
   * A per-row sub-list. Returns what to keep AND how many were dropped, so that the number is at the
   * caller's hand at the moment it shortens the list.
   *
   * IT IS NOT MECHANICALLY ENFORCED, and an earlier version of this comment said it was: "a caller
   * who takes the first and drops the second has written code that does not compile". Re-verification
   * (R4) named the three call sites that do exactly that and compile — `:571`, `:595` and `:688` —
   * each reading `.kept` and discarding `dropped` because a SIBLING FIELD on the same row carries the
   * population (`total`, `files`, `declared`). That is the right thing for them to do; the claim that
   * the shape forbids the wrong thing was not true, and is withdrawn rather than left standing. What
   * the ledger does enforce is the section-level row, which is derived in `rows()` and cannot be
   * forgotten by a caller.
   */
  takeWithCounter<T>(section: string, all: readonly T[], cap: CapKey): { kept: T[]; dropped: number } {
    const kept = all.slice(0, ORIENTATION_CAPS[cap]);
    this.register(section, all.length, kept.length, "counter");
    return { kept, dropped: all.length - kept.length };
  }

  /**
   * A list an incremental loop emitted, where the population is COUNTED rather than sliced: the
   * entry-point loop stops mid-manifest, so the fields the last manifest declared and did not emit
   * are known only to the loop. Its cap is consumed through `capReached` below.
   */
  emitted(section: string, kept: number, population: number): void {
    this.register(section, population, kept, "row");
  }

  /** `true` where an incremental loop has reached its cap. The only other way to read a cap. */
  capReached(cap: CapKey, emitted: number): boolean {
    return emitted >= ORIENTATION_CAPS[cap];
  }

  /**
   * A section whose per-row sub-lists were shortened by `capReached` rather than by `take`, declared
   * ONCE with the totals the caller computed. Registered as a `counter`, so it emits no row of its
   * own while the sibling counts on each row declare the tail — and so that if the byte ladder later
   * shortens the whole section, `shrunk` finds the population the section was COMPUTED FROM instead
   * of the length the per-row cap had already left behind.
   *
   * Added 2026-09-17 for re-verification finding R3. `consent_vocabulary.first_paths` is capped per
   * term at 3 by `capReached`, which registered nothing, so the ladder's sixth step registered the
   * section fresh and took `populationIfUnseen` — the POST-CAP total. On the re-verifier's `ceil`
   * tree the row read `kept 27, dropped 54`, a population of 81, while the section was computed from
   * 180 matched files. That is the very thing this class's own header says it refuses ("the row reads
   * against what the section was computed from and not against an intermediate length nobody can
   * check"), so the invariant is repaired here rather than the sentence softened.
   */
  subList(section: string, kept: number, population: number): void {
    this.register(section, population, kept, "counter");
  }

  /**
   * The byte ladder: a section shortened again, after its own cap has already had it. The population
   * stays the one the section was computed from; `populationIfUnseen` is used only for a section no
   * per-section cap ever touched, where the length the ladder found IS the population.
   */
  shrunk(section: string, kept: number, populationIfUnseen: number): void {
    const row = this.sections.get(section);
    this.register(section, row?.population ?? populationIfUnseen, kept, "row");
  }

  /** What this ledger was told about one section, or `undefined` where nothing capped it. */
  droppedIn(section: string): number {
    const row = this.sections.get(section);
    return row === undefined ? 0 : row.population - row.kept;
  }

  /** The `truncated[]` array. Derived, never appended to by a caller. */
  rows(): OrientationTruncation[] {
    const out: OrientationTruncation[] = [];
    for (const [section, row] of this.sections) {
      if (row.declares !== "row") continue;
      if (row.kept >= row.population) continue;
      out.push({ section, kept: row.kept, dropped: row.population - row.kept });
    }
    return out;
  }

  private register(section: string, population: number, kept: number, declares: "row" | "counter"): void {
    const existing = this.sections.get(section);
    if (existing === undefined) {
      this.sections.set(section, { population, kept, declares });
      return;
    }
    // A per-row sub-list is registered once per row and accumulates; a section is registered once and
    // then only re-shortened, so its population is the first one seen and its `kept` is the latest.
    if (declares === "counter") {
      existing.population += population;
      existing.kept += kept;
      return;
    }
    // PROMOTION, and it is the second half of the R3 repair. A section registered as a `counter`
    // declares its tail through a sibling count on each row and emits no row of its own. Once
    // something shortens the SECTION — only the byte ladder does — the sibling counts no longer
    // account for it, so the section starts owing a row. The population is the one already recorded,
    // which is what the section was computed from.
    existing.declares = "row";
    existing.kept = kept;
  }
}

// ---------------------------------------------------------------------------------------------
// The three authored tables. Each one is a list of PATH SHAPES or of TEXT, and each is authored
// exactly once — nothing below is restated in a brief, in SKILL.md or in a schema description.
// ---------------------------------------------------------------------------------------------

/**
 * Dependency manifests, by the filename the ecosystem gives them.
 *
 * The npm half of this is already parsed by the census (`dependency_inventory`); the rest is not
 * parsed by anything and is listed so that a child reading this sheet knows a `go.mod` exists rather
 * than concluding from an empty npm inventory that the tree declares nothing. The inventory's own
 * schema description makes the same point from the other side.
 */
const MANIFEST_FILES: { pattern: RegExp; ecosystem: string }[] = [
  { pattern: /(^|\/)package\.json$/, ecosystem: "npm" },
  { pattern: /(^|\/)pnpm-workspace\.yaml$/, ecosystem: "npm" },
  { pattern: /(^|\/)(?:pyproject\.toml|setup\.py|setup\.cfg|Pipfile|requirements[^/]*\.txt)$/, ecosystem: "python" },
  { pattern: /(^|\/)go\.mod$/, ecosystem: "go" },
  { pattern: /(^|\/)Cargo\.toml$/, ecosystem: "rust" },
  { pattern: /(^|\/)composer\.json$/, ecosystem: "php" },
  { pattern: /(^|\/)Gemfile$/, ecosystem: "ruby" },
  { pattern: /(^|\/)pom\.xml$/, ecosystem: "maven" },
  { pattern: /(^|\/)build\.gradle(?:\.kts)?$/, ecosystem: "gradle" },
  { pattern: /(^|\/)[^/]+\.csproj$/, ecosystem: "dotnet" },
  { pattern: /(^|\/)mix\.exs$/, ecosystem: "elixir" },
  { pattern: /(^|\/)pubspec\.yaml$/, ecosystem: "dart" },
  { pattern: /(^|\/)Package\.swift$/, ecosystem: "swift" },
  { pattern: /(^|\/)build\.sbt$/, ecosystem: "scala" },
];

/**
 * Build, deploy and framework configuration files, named by their own filename and by nothing else.
 *
 * **The marker is the filename, and the sheet says the filename.** It never says "this is a Next.js
 * application": that is a statement about the product, and a `next.config.js` in a tree is evidence
 * about it and never the answer. What a child gets from this row is where to look, which
 * is the whole of what the 74 measured globs were buying.
 */
const BUILD_AND_DEPLOY_MARKERS: { marker: string; pattern: RegExp }[] = [
  { marker: "Dockerfile", pattern: /(^|\/)(?:Dockerfile|Containerfile)(?:\.[^/]+)?$/ },
  { marker: "docker-compose", pattern: /(^|\/)docker-compose[^/]*\.ya?ml$/ },
  { marker: "GitHub Actions workflow", pattern: /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/ },
  { marker: "GitLab CI", pattern: /(^|\/)\.gitlab-ci\.ya?ml$/ },
  { marker: "Jenkinsfile", pattern: /(^|\/)Jenkinsfile$/ },
  { marker: "CircleCI", pattern: /(^|\/)\.circleci\/config\.ya?ml$/ },
  { marker: "next.config", pattern: /(^|\/)next\.config\.[cm]?[jt]s$/ },
  { marker: "nuxt.config", pattern: /(^|\/)nuxt\.config\.[cm]?[jt]s$/ },
  { marker: "vite.config", pattern: /(^|\/)vite\.config\.[cm]?[jt]s$/ },
  { marker: "webpack.config", pattern: /(^|\/)webpack[^/]*\.config\.[cm]?[jt]s$/ },
  { marker: "rollup.config", pattern: /(^|\/)rollup\.config\.[cm]?[jt]s$/ },
  { marker: "svelte.config", pattern: /(^|\/)svelte\.config\.[cm]?[jt]s$/ },
  { marker: "astro.config", pattern: /(^|\/)astro\.config\.[cm]?[jt]s$/ },
  { marker: "remix.config", pattern: /(^|\/)remix\.config\.[cm]?[jt]s$/ },
  { marker: "angular.json", pattern: /(^|\/)angular\.json$/ },
  { marker: "vercel.json", pattern: /(^|\/)vercel\.json$/ },
  { marker: "netlify.toml", pattern: /(^|\/)netlify\.toml$/ },
  { marker: "Procfile", pattern: /(^|\/)Procfile$/ },
  { marker: "fly.toml", pattern: /(^|\/)fly\.toml$/ },
  { marker: "render.yaml", pattern: /(^|\/)render\.ya?ml$/ },
  { marker: "serverless config", pattern: /(^|\/)serverless\.ya?ml$/ },
  { marker: "app.yaml", pattern: /(^|\/)app\.ya?ml$/ },
  { marker: "wrangler config", pattern: /(^|\/)wrangler\.(?:toml|jsonc?)$/ },
  { marker: "Helm chart", pattern: /(^|\/)Chart\.ya?ml$/ },
  { marker: "Kubernetes kustomization", pattern: /(^|\/)kustomization\.ya?ml$/ },
  { marker: "Terraform", pattern: /(^|\/)[^/]+\.tf$/ },
  { marker: "environment example", pattern: /(^|\/)\.env\.(?:example|sample|template|dist)$/ },
  { marker: "AndroidManifest.xml", pattern: /(^|\/)AndroidManifest\.xml$/ },
  { marker: "Info.plist", pattern: /(^|\/)Info\.plist$/ },
  { marker: "tauri.conf.json", pattern: /(^|\/)tauri\.conf\.json$/ },
  { marker: "capacitor.config", pattern: /(^|\/)capacitor\.config\.[cm]?[jt]s(?:on)?$/ },
  { marker: "electron-builder config", pattern: /(^|\/)electron-builder\.(?:ya?ml|json|js)$/ },
  { marker: "turbo.json", pattern: /(^|\/)turbo\.json$/ },
  { marker: "nx.json", pattern: /(^|\/)nx\.json$/ },
  { marker: "lerna.json", pattern: /(^|\/)lerna\.json$/ },
  { marker: "Makefile", pattern: /(^|\/)Makefile$/ },
  { marker: "Taskfile", pattern: /(^|\/)Taskfile\.ya?ml$/ },
];

/**
 * THE CONSENT-SURFACE VOCABULARY, AUTHORED HERE AND NOWHERE ELSE.
 *
 * This is the grep 25 of the 82 adjudicators of one real run ran for themselves — the fourth check of
 * `legal-adjudicator.md` and step 3 of `legal-refuter.md` both tell a child to run it before
 * concluding that no consent mechanism exists, and every one of them ran it over the same tree.
 *
 * **The sheet writes its own term list into the document** (`consent_vocabulary.terms`), so a brief
 * never restates one: a child is told "these are the terms that were searched, here is what each
 * found", and reads that from the sheet in front of it. That is the reason this constant is not
 * mirrored in any Markdown file (never keep a second copy of anything two places must
 * agree on). The briefs' own instruction to search FURTHER is untouched — the sheet is where a
 * search starts, not where it stops, and a term list of 27 entries is not the set of every spelling
 * a repository might use.
 *
 * `term` is the label the sheet prints; `pattern` is what was actually run, and the sheet prints
 * that too, so a reader can re-run it by hand and get the same number.
 */
const CONSENT_SURFACE_TERMS: { term: string; pattern: RegExp }[] = [
  { term: "consent", pattern: /consent/i },
  { term: "cookie banner", pattern: /cookie[-_\s]?banner/i },
  { term: "cookie consent", pattern: /cookie[-_\s]?consent/i },
  { term: "gtag consent call", pattern: /gtag\s*\(\s*['"`]consent['"`]/i },
  { term: "IAB TCF (__tcfapi)", pattern: /__tcfapi/ },
  { term: "Google funding choices", pattern: /googlefc/i },
  { term: "OneTrust", pattern: /onetrust/i },
  { term: "Cookiebot", pattern: /cookiebot/i },
  { term: "Usercentrics", pattern: /usercentrics/i },
  { term: "TrustArc", pattern: /trustarc/i },
  { term: "Didomi", pattern: /didomi/i },
  { term: "Sourcepoint", pattern: /sourcepoint/i },
  { term: "Iubenda", pattern: /iubenda/i },
  { term: "Termly", pattern: /termly/i },
  { term: "Osano", pattern: /osano/i },
  { term: "Klaro", pattern: /klaro/i },
  { term: "tarteaucitron", pattern: /tarteaucitron/i },
  { term: "CookieYes", pattern: /cookieyes/i },
  { term: "Complianz", pattern: /complianz/i },
  { term: "Axeptio", pattern: /axeptio/i },
  { term: "Borlabs", pattern: /borlabs/i },
  { term: "opt_out_capturing_by_default", pattern: /opt_out_capturing_by_default/ },
  { term: "cookieless_mode", pattern: /cookieless_?mode/i },
  { term: "opt out", pattern: /opt[-_]?out/i },
  { term: "do not track", pattern: /do[-_\s]?not[-_\s]?track|\bdoNotTrack\b|\bDNT\b/ },
  { term: "anonymize IP", pattern: /anonymi[sz]e[-_]?ip/i },
  { term: "GDPR", pattern: /\bgdpr\b/i },
];

/** The manifest fields read verbatim for `entry_points`, in the order they are reported. */
const ENTRY_POINT_FIELDS = ["main", "module", "browser", "exports", "bin", "type"] as const;

// ---------------------------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------------------------

export interface OrientationPathClass {
  id: string;
  /** `read-scope` — a class a run can be told to read; `informational` — a set that declines nothing. */
  kind: "read-scope" | "informational";
  /** The `rules/path-exclusions/` file the patterns come from. */
  source: string;
  /** The set's own authored question, where it has one (informational sets carry it; classes do not). */
  question?: string;
  /** Present on a read-scope class only: whether THIS run was told to read it. */
  read?: boolean;
  /** Files IN this scan whose path the class matches. */
  files_in_scan: number;
  /** Files the walker declined on this class's account; `null` where a tree was not enumerated. */
  files_held_back?: number | null;
  /** Directories the walker declined whole on this class's account. */
  directories_held_back?: number;
  examples: string[];
}

export interface OrientationLanguage {
  extension: string;
  files: number;
}

export interface OrientationManifest {
  file: string;
  ecosystem: string;
}

export interface OrientationEntryPoint {
  file: string;
  line: number;
  field: string;
  value: string;
}

export interface OrientationBuildFile {
  marker: string;
  files: string[];
  total: number;
}

export interface OrientationDependencies {
  packages: number;
  declarations: number;
  declared_only: number;
  /** Of `declared_only`, those whose call sites could be on lines the census did not read. Absent at 0. */
  declared_only_not_read?: number;
  /**
   * The inventory ranked by the number of call sites the census could see, most first, then by name.
   *
   * A row with zero call sites is kept and says zero: the absence of a call site is not the absence
   * of use — a dynamic import built from a variable, a binary invoked from a shell script and a
   * plain HTTP call to the same vendor all evade the census — and a ranking that dropped the tail
   * would be reporting the same silence as an answer.
   */
  ranked_by_call_sites: {
    package: string;
    call_sites: number;
    /** No call site found and lines that could hold one not read: the 0 is a count of what was read. */
    call_sites_not_read?: true;
    declared_in: { file: string; line: number; field: string; version: string }[];
    /** Declaration rows this view left off for this package. Never silent. */
    declarations_not_listed: number;
  }[];
  /** Where the whole inventory is, so this section is a view of it and never a second copy of it. */
  full_list_lives_in: string;
  truncated: number;
}

export interface OrientationConsentTerm {
  term: string;
  /** The regular expression that was run, so the count can be reproduced by hand. */
  pattern: string;
  files: number;
  first_paths: string[];
}

export interface OrientationTruncation {
  section: string;
  kept: number;
  dropped: number;
}

export interface OrientationSheet {
  version: 1;
  /** What this document is, what it is not, and how a child is to use it. Travels into every brief. */
  read_this_first: string[];
  bundle_version: string;
  /** The scan root as the command was given it. No clock and no scan id — see the module header. */
  target: string;
  counts: {
    files_in_scan: number;
    /** Summed over the read-scope classes; `null` where any of them was declined without counting. */
    files_held_back: number | null;
    directories_held_back: number;
  };
  path_classes: OrientationPathClass[];
  languages: OrientationLanguage[];
  languages_not_listed: { extensions: number; files: number };
  manifests: OrientationManifest[];
  entry_points: OrientationEntryPoint[];
  build_and_deploy_files: OrientationBuildFile[];
  dependencies: OrientationDependencies;
  consent_vocabulary: {
    files_searched: number;
    note: string;
    terms: OrientationConsentTerm[];
  };
  /** Every list this document shortened, with what it kept and what it dropped. Never silent. */
  truncated: OrientationTruncation[];
  /** True where the ladder ran and the document is still over `ORIENTATION_MAX_BYTES`. */
  over_cap?: boolean;
}

const READ_THIS_FIRST: string[] = [
  "This sheet is the repository's shape, computed once by the scanner with no model involved. It is handed to every adjudicator and every silence investigator so that none of them has to re-derive it. Start here; read the repository to decide your candidate.",
  "NOTHING HERE IS A FACT ABOUT THE PRODUCT. Not what it does, not who it serves, not where it is established, not whether it has a consent mechanism. Those are asked of the person running the scan or read from their declared documents, and no count below decides one.",
  "Every row is a path, a count of paths, a verbatim value out of a manifest with its file and line, or a text match with the pattern that produced it. A file name is evidence about the code and never a verdict: a directory called examples/ has been measured here being mounted into a live site, and a file outside any sample directory has been measured dead.",
  "A term with zero files is UNKNOWN, not absent. The scanner searched for that spelling and found it nowhere; a repository that writes the same thing differently produces the identical zero. Never write 'no consent mechanism exists' from a zero on this sheet — say what was searched, and search further in the spellings this codebase actually uses.",
  "The counts cover the files THIS scan read. What the run held back is in path_classes and in findings.json's coverage_limits, and a construct sitting in a held-back class is the scan's scope and not a detector gap.",
];

const CONSENT_NOTE =
  "One pass over every file this scan read, one regular expression per term. A hit is the term occurring in the file's text — in code, in a comment, in a string, in a dependency name, in prose. It is a place to look and never a finding that a consent mechanism exists, and a zero is never a finding that one does not.";

function sortedCount(counts: Map<string, number>): [string, number][] {
  return [...counts.entries()].sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1));
}

/** The extension a census row is filed under: the last dot segment, lowercased, or `(no extension)`. */
function extensionOf(rel: string): string {
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "(no extension)";
  return base.slice(dot).toLowerCase();
}

/** How deep a path sits, so that a monorepo's root manifests are the ones that get read. */
function depthOf(rel: string): number {
  let n = 0;
  for (const c of rel) if (c === "/") n += 1;
  return n;
}

/**
 * The 1-based line a JSON key first appears on, searched from `from`.
 *
 * Deliberately textual rather than a parse: the sheet quotes a manifest the way the dependency
 * inventory already does — file, line, verbatim value — and a parsed object has no line numbers. A
 * key this does not find is reported with line 0, which says "the value is this and the line could
 * not be located", never a line that is wrong.
 */
function lineOfKey(lines: string[], key: string, from = 0): number {
  const needle = new RegExp(`^\\s*"${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:`);
  for (let i = from; i < lines.length; i += 1) if (needle.test(lines[i]!)) return i + 1;
  return 0;
}

/** A manifest value rendered as one short line: a string as itself, anything else as its JSON. */
function shortValue(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) return "";
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

export interface OrientationInput {
  targetRoot: string;
  /** The walked, in-scope file list, relative to the root — `PreparedScan.walked.files`. */
  files: string[];
  /** What the walker declined and why — `PreparedScan.walked.excluded`. */
  excluded: WalkExclusion[];
  /** The run's read scope, so a class can say whether THIS run read it. */
  readScope: ReadScope;
  /** `documents.yaml`'s sets, compiled. Empty on a bundle built before 2026-09-17. */
  informational: InformationalPathClass[];
  /** The census's own inventory, as `findings.json` carries it. A view of it is taken, never a copy. */
  dependencyInventory: DependencyInventoryEntry[];
  bundleVersion: string;
  /** Injected so the gate can drive this over a fixture tree without touching a disk. */
  readFile?: (rel: string) => string | null;
}

export function buildOrientation(input: OrientationInput): OrientationSheet {
  const readFile =
    input.readFile ??
    ((rel: string) => {
      try {
        return readSourceText(join(input.targetRoot, rel));
      } catch {
        return null;
      }
    });
  const files = input.files;
  const caps = new CapLedger();

  // --- path classes ---------------------------------------------------------------------------
  const heldFiles = new Map<string, number | null>();
  const heldDirs = new Map<string, number>();
  const heldExamples = new Map<string, string[]>();
  for (const ex of input.excluded) {
    const classId = input.readScope.classes.find((c) => readScopeReason(c.id) === ex.reason)?.id;
    if (classId === undefined) continue;
    heldDirs.set(classId, (heldDirs.get(classId) ?? 0) + 1);
    const running = heldFiles.get(classId);
    // `null` means the tree was not enumerated, and it WINS over a number: a total that silently
    // dropped an uncounted tree would read as a complete count. Same reasoning as `WalkExclusion.files`.
    heldFiles.set(classId, ex.files === null || running === null ? null : (running ?? 0) + ex.files);
    const examples = heldExamples.get(classId) ?? [];
    for (const e of ex.examples) if (!caps.capReached("path_class_examples", examples.length)) examples.push(e);
    heldExamples.set(classId, examples);
  }

  const pathClasses: OrientationPathClass[] = [];
  for (const cls of input.readScope.classes) {
    const matches = files.filter((f) => cls.compiled.some((re) => re.test(f)));
    // `files_in_scan` below IS this list's population, so the tail is declared by the row itself and
    // the ledger's own counter would be a second copy of one subtraction. The held-back fallback is
    // capped upstream, in the loop that collected it.
    const examples =
      matches.length > 0
        ? caps.takeWithCounter("path_classes[].examples", matches, "path_class_examples").kept
        : (heldExamples.get(cls.id) ?? []);
    pathClasses.push({
      id: cls.id,
      kind: "read-scope",
      source: cls.source,
      read: cls.read,
      files_in_scan: matches.length,
      // `has` AND NOT `?? 0`: `null ?? 0` is 0, so the coalescing form would turn "this tree was not
      // enumerated" into "nothing was held back" — the exact substitution the comment above refuses.
      // A class the walker never named is a real 0; a class it named with a null is a real null.
      files_held_back: heldFiles.has(cls.id) ? (heldFiles.get(cls.id) as number | null) : 0,
      directories_held_back: heldDirs.get(cls.id) ?? 0,
      examples,
    });
  }
  for (const cls of input.informational) {
    const matches = files.filter((f) => cls.compiled.some((re) => re.test(f)));
    pathClasses.push({
      id: cls.id,
      kind: "informational",
      source: cls.source,
      question: cls.question,
      files_in_scan: matches.length,
      examples: caps.takeWithCounter("path_classes[].examples", matches, "path_class_examples").kept,
    });
  }

  // --- language census ------------------------------------------------------------------------
  const byExtension = new Map<string, number>();
  for (const f of files) {
    const ext = extensionOf(f);
    byExtension.set(ext, (byExtension.get(ext) ?? 0) + 1);
  }
  const extensionRows = sortedCount(byExtension);
  const keptExtensions = caps.take("languages", extensionRows, "languages");
  const languages = keptExtensions.map(([extension, count]) => ({ extension, files: count }));
  // `languages_not_listed` is not the truncation row said twice: the row counts EXTENSIONS and this
  // counts the FILES under them, which is the number that says whether the tail is a rounding error
  // or half the tree.
  const rest = extensionRows.slice(keptExtensions.length);

  // --- manifests and entry points ---------------------------------------------------------------
  const manifestRows: OrientationManifest[] = [];
  for (const f of files) {
    const hit = MANIFEST_FILES.find((m) => m.pattern.test(f));
    if (hit) manifestRows.push({ file: f, ecosystem: hit.ecosystem });
  }
  manifestRows.sort((a, b) => (depthOf(a.file) !== depthOf(b.file) ? depthOf(a.file) - depthOf(b.file) : a.file < b.file ? -1 : 1));
  const manifests = caps.take("manifests", manifestRows, "manifests");

  const entryPoints: OrientationEntryPoint[] = [];
  // TWO CAPS CUT THIS SECTION AND EACH ONE IS RECORDED SEPARATELY, because they remove different
  // things: `manifests_read` stops the loop opening more files, and `entry_points` stops it emitting
  // more rows — on a monorepo the second bites first, after three or four manifests.
  //
  // The row cap is the one that hid what it removed until 2026-09-17: it can fire INSIDE the last
  // manifest the loop opened, and then "manifests opened" equals "npm manifests" and the old code had
  // nothing left to report. So each manifest's declarable fields are counted as it is opened, whether
  // or not there is room to emit them, and `entry_points (rows)` says how many of that population
  // reached the document. A cap that hides what it removed is the silence this whole file refuses.
  const npmManifests = manifestRows.filter((r) => r.ecosystem === "npm" && /package\.json$/.test(r.file));
  const openable = caps.take("entry_points (npm manifests opened)", npmManifests, "manifests_read");
  let manifestsOpened = 0;
  let fieldsDeclared = 0;
  for (const m of openable) {
    // The cap is tested BEFORE the manifest is opened, so a manifest this loop never read is counted
    // by the row above and never by the row below: no file is reported under both caps.
    if (caps.capReached("entry_points", entryPoints.length)) break;
    manifestsOpened += 1;
    const text = readFile(m.file);
    if (text === null) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== "object") continue;
    const lines = text.split("\n");
    const scripts = parsed["scripts"];
    const scriptFields =
      scripts !== null && typeof scripts === "object"
        ? ["start", "dev", "build"].filter((n) => typeof (scripts as Record<string, unknown>)[n] === "string")
        : [];
    const fields = ENTRY_POINT_FIELDS.filter((f) => Object.hasOwn(parsed, f));
    // Counted from what the manifest DECLARES, before a single row is emitted: the population this
    // section is computed from is the same whether the cap fires on this manifest or on a later one.
    fieldsDeclared += fields.length + scriptFields.length;
    for (const field of fields) {
      if (caps.capReached("entry_points", entryPoints.length)) break;
      entryPoints.push({ file: m.file, line: lineOfKey(lines, field), field, value: shortValue(parsed[field]) });
    }
    if (scriptFields.length > 0) {
      const scriptsLine = lineOfKey(lines, "scripts");
      for (const name of scriptFields) {
        if (caps.capReached("entry_points", entryPoints.length)) break;
        entryPoints.push({
          file: m.file,
          line: lineOfKey(lines, name, scriptsLine),
          field: `scripts.${name}`,
          value: shortValue((scripts as Record<string, unknown>)[name]),
        });
      }
    }
  }
  caps.emitted("entry_points (npm manifests opened)", manifestsOpened, npmManifests.length);
  caps.emitted("entry_points (rows)", entryPoints.length, fieldsDeclared);

  // --- build and deploy files -------------------------------------------------------------------
  const buildRows: OrientationBuildFile[] = [];
  for (const { marker, pattern } of BUILD_AND_DEPLOY_MARKERS) {
    const matches = files.filter((f) => pattern.test(f));
    if (matches.length === 0) continue;
    // `total` is this row's population, so the tail of `files` is declared in the row itself.
    buildRows.push({
      marker,
      files: caps.takeWithCounter("build_and_deploy_files[].files", matches, "path_class_examples").kept,
      total: matches.length,
    });
  }
  const buildFiles = caps.take("build_and_deploy_files", buildRows, "build_files");

  // --- declared dependencies ---------------------------------------------------------------------
  const inventory = input.dependencyInventory;
  const ranked = [...inventory].sort((a, b) => {
    const ac = a.call_site_count ?? 0;
    const bc = b.call_site_count ?? 0;
    return bc !== ac ? bc - ac : a.package < b.package ? -1 : 1;
  });
  const mostCalled = caps.take("dependencies.ranked_by_call_sites", ranked, "dependencies").map((e) => {
    const all = e.declared ?? [];
    // The one per-row sub-list whose counter is a field of its own: a package's declarations have no
    // other number beside them, so the ledger hands it back and it is placed here.
    const { kept, dropped } = caps.takeWithCounter(
      "dependencies.ranked_by_call_sites[].declared_in",
      all,
      "declarations_per_package",
    );
    return {
      package: e.package,
      call_sites: e.call_site_count ?? 0,
      ...(e.call_sites_not_read ? { call_sites_not_read: true as const } : {}),
      declared_in: kept.map((d) => ({ file: d.file, line: d.line, field: d.field, version: d.version })),
      declarations_not_listed: dropped,
    };
  });
  const dependencies: OrientationDependencies = {
    packages: inventory.length,
    declarations: inventory.reduce((n, e) => n + (e.declared?.length ?? 0), 0),
    declared_only: inventory.filter((e) => e.declared_only === true).length,
    ...(inventory.some((e) => e.declared_only === true && e.call_sites_not_read)
      ? { declared_only_not_read: inventory.filter((e) => e.declared_only === true && e.call_sites_not_read).length }
      : {}),
    ranked_by_call_sites: mostCalled,
    full_list_lives_in: "findings.json#/dependency_inventory",
    // Read back out of the ledger rather than subtracted again here: this number and the section's
    // `truncated[]` row are two renderings of one fact and must not be able to disagree.
    truncated: caps.droppedIn("dependencies.ranked_by_call_sites"),
  };

  // --- the consent-vocabulary pass ---------------------------------------------------------------
  // ONE pre-pass with a combined alternation, then the individual terms only on the files that hit.
  // Attribution is therefore exact and order-independent — a term whose spelling contains another's
  // is counted for both, which is what a reader of "cookie consent: 12" expects — and the cost stays
  // near one pass over the tree because hits are sparse.
  //
  // THE PRE-PASS IS DELIBERATELY A SUPERSET AND THAT IS THE ONLY DIRECTION THAT IS SAFE. It compiles
  // every term's source with `i`, while several terms are case-SENSITIVE on their own (`__tcfapi`,
  // `opt_out_capturing_by_default`, `\bDNT\b`), so it lets through files those terms will then
  // reject — and it can never shut out a file one of them would have matched. A filter in front of a
  // count must only ever over-select: under-selecting would make a term read zero over a tree that
  // carries it, which is the one number on this sheet a child is most likely to stop looking on.
  // None of the terms carries a capturing group or an anchor, so joining their sources with `|`
  // changes no match; `test` without `g` keeps no `lastIndex` between files.
  const combined = new RegExp(CONSENT_SURFACE_TERMS.map((t) => t.pattern.source).join("|"), "i");
  const consentFiles = new Map<string, string[]>();
  for (const t of CONSENT_SURFACE_TERMS) consentFiles.set(t.term, []);
  const consentCounts = new Map<string, number>();
  for (const t of CONSENT_SURFACE_TERMS) consentCounts.set(t.term, 0);
  let searched = 0;
  for (const f of files) {
    const text = readFile(f);
    if (text === null) continue;
    searched += 1;
    if (!combined.test(text)) continue;
    for (const t of CONSENT_SURFACE_TERMS) {
      if (!t.pattern.test(text)) continue;
      consentCounts.set(t.term, (consentCounts.get(t.term) ?? 0) + 1);
      const paths = consentFiles.get(t.term)!;
      // `files` on the same row is this list's population, so the tail is declared by the row itself.
      if (!caps.capReached("consent_paths", paths.length)) paths.push(f);
    }
  }
  const consentTerms: OrientationConsentTerm[] = CONSENT_SURFACE_TERMS.map((t) => ({
    term: t.term,
    pattern: t.pattern.source,
    files: consentCounts.get(t.term) ?? 0,
    first_paths: consentFiles.get(t.term) ?? [],
  }));
  // R3: tell the ledger what this section was COMPUTED FROM, once, now. Nothing about the sheet
  // changes while only the per-term cap has shortened it — `subList` registers a counter, and a
  // counter emits no row, because each term's `files` declares its own tail beside its paths. It
  // matters only if the byte ladder shortens the whole section later: the ladder would otherwise
  // register it fresh against the post-cap total (81 on the re-verifier's tree) rather than against
  // the 180 files the paths were chosen from.
  caps.subList(
    "consent_vocabulary.first_paths",
    consentTerms.reduce((n, t) => n + t.first_paths.length, 0),
    consentTerms.reduce((n, t) => n + t.files, 0),
  );

  // NULL WINS OVER A SUM, for the reason a null wins inside one class: a total that quietly dropped
  // an uncounted tree would read as a complete count of what this run did not read.
  const heldValues = [...heldFiles.values()];
  const heldBackTotal: number | null = heldValues.some((v) => v === null)
    ? null
    : heldValues.reduce<number>((n, v) => n + (v ?? 0), 0);
  const sheet: OrientationSheet = {
    version: 1,
    read_this_first: READ_THIS_FIRST,
    bundle_version: input.bundleVersion,
    target: input.targetRoot,
    counts: {
      files_in_scan: files.length,
      files_held_back: heldBackTotal,
      directories_held_back: [...heldDirs.values()].reduce((n, v) => n + v, 0),
    },
    path_classes: pathClasses,
    languages,
    languages_not_listed: {
      extensions: rest.length,
      files: rest.reduce((n, [, c]) => n + c, 0),
    },
    manifests,
    entry_points: entryPoints,
    build_and_deploy_files: buildFiles,
    dependencies,
    consent_vocabulary: { files_searched: searched, note: CONSENT_NOTE, terms: consentTerms },
    truncated: caps.rows(),
  };
  return applyByteCap(sheet, caps);
}

/**
 * The ceiling, applied in a fixed order, with every reduction written down.
 *
 * It exists for the tree that defeats the per-section caps — a monorepo with 40 ecosystems' worth of
 * build markers, say. Nothing is dropped silently: each step tells the ledger the section's new
 * length, `truncated[]` is re-derived from the ledger before the next measurement, and a document
 * still over the ceiling after every step carries `over_cap: true` rather than being shortened past
 * the point where it says what it left out.
 *
 * **The rows are re-derived and not appended**, which is what keeps one section to one row: a list the
 * per-section cap already shortened and the ladder shortened again is one list, and two rows for it
 * would make a reader subtract one number from another to find out what the section was computed
 * from. `kept` moves; the population does not.
 *
 * The re-derivation has to happen BEFORE `size()` is read, because `truncated[]` is itself part of
 * the document being measured.
 */
function applyByteCap(sheet: OrientationSheet, caps: CapLedger): OrientationSheet {
  const settle = () => {
    sheet.truncated = caps.rows();
    // The dependency section says its tail twice — once as a row and once as its own `truncated`
    // integer — so both are read from the ledger every time, and neither can go stale behind the other.
    sheet.dependencies.truncated = caps.droppedIn("dependencies.ranked_by_call_sites");
  };
  const size = () => Buffer.byteLength(JSON.stringify(sheet, null, 2), "utf8");
  settle();
  if (size() <= ORIENTATION_MAX_BYTES) return sheet;
  const steps: { section: string; measure: () => number; shrink: () => void }[] = [
    {
      section: "dependencies.ranked_by_call_sites",
      measure: () => sheet.dependencies.ranked_by_call_sites.length,
      shrink: () => {
        sheet.dependencies.ranked_by_call_sites = sheet.dependencies.ranked_by_call_sites.slice(0, 15);
      },
    },
    {
      section: "build_and_deploy_files",
      measure: () => sheet.build_and_deploy_files.length,
      shrink: () => {
        sheet.build_and_deploy_files = sheet.build_and_deploy_files.slice(0, 15);
      },
    },
    {
      section: "entry_points (rows)",
      measure: () => sheet.entry_points.length,
      shrink: () => {
        sheet.entry_points = sheet.entry_points.slice(0, 10);
      },
    },
    {
      section: "manifests",
      measure: () => sheet.manifests.length,
      shrink: () => {
        sheet.manifests = sheet.manifests.slice(0, 10);
      },
    },
    {
      section: "languages",
      measure: () => sheet.languages.length,
      shrink: () => {
        sheet.languages = sheet.languages.slice(0, 10);
      },
    },
    {
      section: "consent_vocabulary.first_paths",
      measure: () => sheet.consent_vocabulary.terms.reduce((n, t) => n + t.first_paths.length, 0),
      shrink: () => {
        for (const t of sheet.consent_vocabulary.terms) t.first_paths = t.first_paths.slice(0, 1);
      },
    },
  ];
  for (const step of steps) {
    const before = step.measure();
    step.shrink();
    const kept = step.measure();
    // `shrunk` on a section the ledger has never seen registers the length it had before this step as
    // its population, so a ladder-only section still says what the ladder took off it.
    if (kept < before) caps.shrunk(step.section, kept, before);
    settle();
    if (size() <= ORIENTATION_MAX_BYTES) return sheet;
  }
  sheet.over_cap = true;
  return sheet;
}

// ---------------------------------------------------------------------------------------------
// The rendered form
// ---------------------------------------------------------------------------------------------

/**
 * `orientation.md`, rendered from the JSON above and from nothing else.
 *
 * It exists because the sheet is read by a model and Markdown costs about half the bytes of the same
 * content in JSON with two-space indentation. The measured pairs are in
 * an internal record and are deliberately NOT restated here: a
 * comment carrying its own copy of a table is a forbidden second copy, and this one had
 * already gone stale once — two of its three pairs were taken before the per-package declaration cap
 * moved them.
 *
 * It is a RENDERING and never a second source: every number here is read off the object this
 * function is handed, in the same call that wrote the JSON, so the two cannot drift.
 */
export function renderOrientationMarkdown(sheet: OrientationSheet): string {
  const out: string[] = [];
  out.push("# Repository orientation sheet");
  out.push("");
  out.push(
    `Written by the scanner, once, with no model involved. Bundle ${sheet.bundle_version}. Target \`${sheet.target}\`. The run this belongs to is the \`findings.json\` beside this file.`,
  );
  out.push("");
  out.push("## Read this first");
  out.push("");
  for (const line of sheet.read_this_first) out.push(`- ${line}`);
  out.push("");
  out.push(
    `Files this scan read: ${sheet.counts.files_in_scan}. Files held back: ${sheet.counts.files_held_back === null ? "not counted" : sheet.counts.files_held_back} in ${sheet.counts.directories_held_back} director${sheet.counts.directories_held_back === 1 ? "y" : "ies"}.`,
  );
  out.push("");

  out.push("## Path classes");
  out.push("");
  out.push("| class | kind | read by this run | files in scan | files held back | examples |");
  out.push("|---|---|---|---:|---:|---|");
  for (const c of sheet.path_classes) {
    const read = c.kind === "read-scope" ? (c.read ? "yes" : "no") : "always read";
    const held = c.kind === "read-scope" ? (c.files_held_back === null ? "not counted" : String(c.files_held_back)) : "-";
    out.push(`| ${c.id} | ${c.kind} | ${read} | ${c.files_in_scan} | ${held} | ${c.examples.map((e) => `\`${e}\``).join(", ") || "-"} |`);
  }
  out.push("");
  out.push("Each class's patterns are in `rules/path-exclusions/<source>`. A path class is where a file sits, never what it is for.");
  out.push("");

  out.push("## Languages, by file extension");
  out.push("");
  out.push(sheet.languages.map((l) => `${l.extension} ${l.files}`).join(" · ") || "-");
  if (sheet.languages_not_listed.extensions > 0) {
    out.push("");
    out.push(
      `and ${sheet.languages_not_listed.extensions} further extensions covering ${sheet.languages_not_listed.files} files.`,
    );
  }
  out.push("");

  out.push("## Manifests");
  out.push("");
  out.push(sheet.manifests.map((m) => `\`${m.file}\` (${m.ecosystem})`).join(" · ") || "none in this tree");
  out.push("");

  out.push("## Entry points, verbatim from the manifests");
  out.push("");
  if (sheet.entry_points.length === 0) out.push("None declared in the manifests this sheet read.");
  else {
    out.push("| file:line | field | value |");
    out.push("|---|---|---|");
    for (const e of sheet.entry_points) out.push(`| \`${e.file}:${e.line}\` | ${e.field} | \`${e.value}\` |`);
  }
  out.push("");

  out.push("## Build, deploy and framework configuration present");
  out.push("");
  if (sheet.build_and_deploy_files.length === 0) out.push("None of the file names this sheet looks for is in this tree.");
  else {
    for (const b of sheet.build_and_deploy_files) {
      out.push(`- **${b.marker}** (${b.total}): ${b.files.map((f) => `\`${f}\``).join(", ")}`);
    }
  }
  out.push("");
  out.push("A file name says where to look. It does not say what the product is, and it does not say that a file ships.");
  out.push("");

  out.push("## Declared dependencies");
  out.push("");
  out.push(
    `${sheet.dependencies.packages} packages, ${sheet.dependencies.declarations} declarations, ${sheet.dependencies.declared_only} declared and imported from nowhere the census could see${sheet.dependencies.declared_only_not_read ? ` (${sheet.dependencies.declared_only_not_read} of them NOT READ: lines that could hold their imports were past the line ceiling or not read to their end, so whether they are imported is not known)` : ""}. The whole inventory is in \`${sheet.dependencies.full_list_lives_in}\`.`,
  );
  out.push("");
  if (sheet.dependencies.ranked_by_call_sites.length > 0) {
    out.push("Ranked by the call sites the census could see, most first. Zero call sites is not the absence of use.");
    out.push("");
    for (const d of sheet.dependencies.ranked_by_call_sites) {
      const where = d.declared_in.map((x) => `${x.file}:${x.line} ${x.field}@${x.version}`).join("; ");
      const more = d.declarations_not_listed > 0 ? ` (+${d.declarations_not_listed} further declaration(s))` : "";
      out.push(`- \`${d.package}\` — ${d.call_sites} call site(s)${d.call_sites_not_read ? " found, the rest not read" : ""} — ${where}${more}`);
    }
    if (sheet.dependencies.truncated > 0) {
      out.push("");
      out.push(`and ${sheet.dependencies.truncated} further packages, in \`${sheet.dependencies.full_list_lives_in}\`.`);
    }
  }
  out.push("");
  out.push(
    "A declaration is not a transfer, the absence of a call site is not the absence of use, and this covers npm manifests only.",
  );
  out.push("");

  out.push("## Consent-surface vocabulary, searched once over this scan's files");
  out.push("");
  out.push(sheet.consent_vocabulary.note);
  out.push("");
  out.push(`Files searched: ${sheet.consent_vocabulary.files_searched}.`);
  out.push("");
  out.push("| term | pattern | files | first paths |");
  out.push("|---|---|---:|---|");
  for (const t of sheet.consent_vocabulary.terms) {
    out.push(
      `| ${t.term} | \`${t.pattern.replace(/\|/g, "\\|")}\` | ${t.files} | ${t.first_paths.map((p) => `\`${p}\``).join(", ") || "-"} |`,
    );
  }
  out.push("");
  out.push(
    "These are the searches you do not have to run again. They are not the searches you are limited to: a zero here is one spelling that was not found, and the construct may be written another way in this codebase.",
  );
  out.push("");

  if (sheet.truncated.length > 0) {
    out.push("## What this sheet shortened");
    out.push("");
    for (const t of sheet.truncated) out.push(`- ${t.section}: kept ${t.kept}, dropped ${t.dropped}`);
    out.push("");
  }
  if (sheet.over_cap === true) {
    out.push(
      "This sheet is still over its size ceiling after every reduction above. Read `orientation.json` for the whole of it.",
    );
    out.push("");
  }
  return `${out.join("\n")}\n`;
}
