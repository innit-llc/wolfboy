import { execFileSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { copyFileTo, makeFolder, makeTempFolder, removePath, writeFileAt } from "./project-write.js";
import { join, dirname } from "node:path";
import { relativePath } from "./project-path.js";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { Findings, NotReadFile, PartiallyReadFile, Rule } from "wolfboy-schemas";
import type { LoadedBundle } from "./bundle.js";
import { declaresStructuralChecks } from "./engine.js";
import { presentFixtureName, describeResolution } from "./fixture-names.js";
import { HOST_ENV_NAMES } from "./host-env.js";
import { runScan } from "./scan.js";
import { toSarif } from "./sarif.js";
import { readRegularFile } from "./project-read.js";

interface Expectation {
  file: string; // relative to the scan root
  line: number; // 1-based line the expectation applies to: the line following the annotation
  kind: "ruleid" | "ok";
  ruleId: string;
  /**
   * The tier the `ruleid:` line's place must carry, where the annotation states one (`tier: word` or
   * `tier: construct` after the rule id). Absent: the tier is not asserted.
   */
  tier?: "word" | "construct";
}

interface RuleTestResult {
  ruleId: string;
  fixtures: number; // top-level fixture files carrying an annotation for this rule (per-file mode)
  projects: number; // fixture sub-directories run as whole projects (project mode)
  guards: number; // guard_missing clauses this rule carries
  passed: boolean;
  failures: string[];
  /** Reported, never failing: what this rule's guards do at the scope production uses. */
  scopeNotes: string[];
  /**
   * Per plumbed field (`PLUMBED_FIELDS`): what this rule's own `rule.yaml` declares, whether it
   * declares anything, and whether some fixture scan was actually seen to carry it into both
   * outputs. **The authored value is the source of truth**, read from the authoring file rather
   * than from the bundle. Everything downstream is compared against it: the bundle's copy, the
   * candidates and the SARIF projection. Reading it from the bundle instead was the mistake
   * independent verification found:
   * the whole assertion went vacuous, and printed `0/0` while passing, the moment the field stopped
   * reaching `rules.json`.
   */
  fields: Record<PlumbedFieldName, FieldState>;
}

interface FieldState {
  authored: PlumbedValue;
  declares: boolean;
  asserted: boolean;
}

/** The value a plumbed rule field can take: a scalar, a list, or nothing at all. */
type PlumbedValue = string | string[] | undefined;

type PlumbedFieldName = "effective_date" | "data_categories";

/**
 * Which of the possible statements a declaration makes, and every distinction here is one a
 * delivery bug can destroy while still looking correct:
 *
 * - `[]` and absent are **different statements** — the author named no category, versus the rule
 *   states nothing at all — and a path that collapses one into the other has lost something;
 * - a list of **one** cannot reveal truncation or reordering, and a list of **many** can. This split
 *   is not tidiness: with a single `list` shape, `checkDeliveryEndToEnd` printed
 *   *"list … all exercised"* while the code truncated every list to its first element and while it
 *   reversed every list, because the rules it happened to reach on those fixture trees all declared
 *   exactly one category. Both breakages were caught by the in-memory check and passed the check
 *   that reads the written files, which is precisely the split the earlier `effective_date` work
 *   had to be corrected for one layer down.
 *
 * `checkDeliveryEndToEnd` requires every shape that occurs in the rule base to be exercised against
 * a file the CLI actually wrote.
 */
type PlumbedShape = "value" | "one" | "many" | "empty" | "absent";

function shapeOf(v: PlumbedValue): PlumbedShape {
  if (v === undefined) return "absent";
  if (!Array.isArray(v)) return "value";
  return v.length === 0 ? "empty" : v.length === 1 ? "one" : "many";
}

/**
 * How a value is printed and compared. Absent is rendered as a word rather than as JSON, because
 * `JSON.stringify(undefined)` is not a string and an absent value must never compare equal to `[]`,
 * to `null` or to the empty string. Comparison is order-sensitive inside a list: a delivery path
 * that reordered the categories would be altering the author's statement, not carrying it.
 */
function show(v: PlumbedValue): string {
  return v === undefined ? "(absent)" : JSON.stringify(v);
}

function sameValue(a: PlumbedValue, b: PlumbedValue): boolean {
  return show(a) === show(b);
}

/** Read a plumbed field off any object that carries it under its own name. */
function valueOf(o: unknown, name: PlumbedFieldName): PlumbedValue {
  return (o as Record<string, PlumbedValue> | null | undefined)?.[name];
}

/**
 * A rule field that is parsed, validated, shipped inside `rules.json` — and has to be seen arriving
 * in the outputs a scan writes. **One table, so that a second such field cannot drift into a second
 * mechanism**: everything below (the source-versus-bundle check, the in-memory delivery check, the
 * end-to-end check and the printed coverage lines) iterates this list.
 *
 * `effective_date` is the field this exists for. It was declared by 49 of the 56 rules, validated by
 * the bundle build, carried whole into `rules.json` — and until 2026-08-13 copied into no output at
 * all. Nothing failed while that was true, because no gate asked whether a declared field arrives
 * anywhere. What happened instead is that authors wrote the date into prose to make it visible:
 * `eu-cra-001` and `eu-cra-002` carry `… from 2027-12-11` inside `title`, which is a workaround for
 * a delivery hole and not a fix. The class is recorded: a row
 * was proposed with *"every finding must be worded as preparation"* and shipped with the date in no
 * parsed field. `data_categories` was the same hole at 53 of 56 rules and was wired the same day.
 */
interface PlumbedField {
  readonly name: PlumbedFieldName;
  /**
   * The declaration, read out of a parsed `rule.yaml`. A value of the wrong type is returned as it
   * stands rather than coerced, so a malformed declaration fails the comparison instead of being
   * quietly made to agree with whatever the output happens to carry.
   */
  read(doc: Record<string, unknown>): PlumbedValue;
  /** What a reader loses when the value does not arrive. Printed on a mismatch. */
  readonly whyItMatters: string;
  /** What absence states. Printed when an output carries a value the rule never declared. */
  readonly absenceMeans: string;
  /** The coverage line's own sentence, after `N/M rules declaring one in rule.yaml `. */
  readonly coverage: string;
}

const PLUMBED_FIELDS: readonly PlumbedField[] = [
  {
    name: "effective_date",
    read: (doc) => (doc.effective_date === undefined ? undefined : (doc.effective_date as string)),
    whyItMatters:
      'A declared date that reaches no output can only be seen if an author writes it into prose, which is how "from 2027-12-11" ended up inside eu-cra-001\'s title',
    absenceMeans: "a date the rule never stated must not appear in an output",
    coverage: "carry it into the candidate objects and the SARIF projection",
  },
  {
    name: "data_categories",
    read: (doc) =>
      doc.data_categories === undefined ? undefined : (doc.data_categories as string[]),
    whyItMatters:
      "The list is the only machine-readable statement of what kind of data a candidate is about; a reader that loses it is left inferring the answer from the title. Order and emptiness are part of the statement: [] says the author named no category and an absent field says the rule states nothing at all",
    absenceMeans:
      "a category the rule never named must not appear in an output, and an absent declaration must not be turned into an empty list — they are different statements",
    coverage: "carry it into the candidate objects and the SARIF projection",
  },
];

const ANNOTATION = /(ruleid|ok):\s*([a-z0-9-]+)/;
/**
 * The word tier a place lands in
 * (`detector.word_clauses`, findings.json `locations[].tier`), stated on the annotation line after the rule id:
 * `ruleid: <id> tier: word` or `tier: construct`. Read here only: the other readers of the same annotation (the
 * mutation harness and the fixture-copy check) read the id and nothing after it.
 */
const TIER_ANNOTATION = /ruleid:\s*[a-z0-9-]+\s+tier:\s*(word|construct)\b/;

function parseExpectations(file: string, content: string): Expectation[] {
  const out: Expectation[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(ANNOTATION);
    if (!m) continue;
    const t = lines[i].match(TIER_ANNOTATION);
    out.push({
      file,
      line: i + 2,
      kind: m[1] as "ruleid" | "ok",
      ruleId: m[2],
      ...(t ? { tier: t[1] as "word" | "construct" } : {}),
    });
  }
  return out;
}

/** Every file under `dir`, as paths relative to `base`. */
function listFiles(dir: string, base: string = dir): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(full, base));
    else out.push(relativePath(base, full));
  }
  return out;
}

/** One set of fixture files as the scanner is asked to read them. */
interface PresentedFiles {
  /** The root to hand `runScan`: the fixture directory itself, or a staging copy of it. */
  root: string;
  /** The names to hand `runScan`, in the order they were given. */
  files: string[];
  /** Presented name to the name the file has on disk. Only names that differ have an entry. */
  onDisk: Map<string, string>;
  /** Mutants no name in whose family resolves the way their base does. These fail the rule. */
  unresolved: { file: string; base: string }[];
}

/**
 * Hands each fixture file to the scanner under a name that resolves the way its base fixture's name
 * does — see `fixture-names.ts` for what "resolves" means and why the repair is not in `languageFor`.
 *
 * WHY A COPY IS NEEDED AT ALL: `runScan` reads its files off disk from `targetRoot`, so a file can
 * only be presented under a different name by existing under it. WHY THE WHOLE SET IS COPIED and not
 * only the files whose names changed: project mode and `scopeReport` scan a set of files as one
 * project, and a guard lives in a sibling. Copying the mutant alone would silently drop every guard
 * in the directory and turn a suppressed match into a detected one.
 *
 * WHY NOTHING IS COPIED WHEN NOTHING NEEDS IT: 1,664 of the 1,695 mutants in this rule base resolve
 * correctly under their own names, and a staging copy of every fixture directory would be 2,833
 * pointless file writes per run.
 */
class FixtureStaging {
  private root: string | null = null;
  private serial = 0;

  private nextDir(): string {
    this.root ??= makeTempFolder("test-rules-fixtures-");
    const dir = join(this.root, String(this.serial++));
    makeFolder(dir, { recursive: true });
    return dir;
  }

  present(root: string, files: string[]): PresentedFiles {
    const named = files.map((file) => ({ file, presented: presentFixtureName(file) }));
    const unresolved = named
      .filter((n) => n.presented.unresolved)
      .map((n) => ({ file: n.file, base: n.presented.base ?? n.file }));
    if (!named.some((n) => n.presented.repaired)) {
      return { root, files, onDisk: new Map(), unresolved };
    }

    const dir = this.nextDir();
    const onDisk = new Map<string, string>();
    const presented: string[] = [];
    for (const n of named) {
      const target = join(dir, n.presented.path);
      makeFolder(dirname(target), { recursive: true });
      // `copyFileSync`, not a read-then-write: a round trip through utf8 is not byte-exact for a
      // file that is not valid utf8, and the engine must see the bytes the fixture actually holds.
      copyFileTo(join(root, n.file), target);
      presented.push(n.presented.path);
      if (n.presented.path !== n.file) onDisk.set(n.presented.path, n.file);
    }
    return { root: dir, files: presented, onDisk, unresolved };
  }

  dispose(): void {
    if (this.root) removePath(this.root, { recursive: true, force: true });
    this.root = null;
  }
}

/**
 * Fixture-based regression testing, following the semgrep `ruleid:` / `ok:` annotation convention.
 *
 * Two modes, because the engine has two guard scopes and until 2026-07-27 only one of them was
 * ever tested:
 *
 * - **per-file** — each loose file directly under `fixtures/` is scanned as its own single-file
 *   project, so a guard in one fixture cannot mask the candidate another fixture is asserting.
 *   This is what tests `match`, `match_without` and `also_in_file`.
 * - **project** — each *sub-directory* of `fixtures/` is scanned as one project with
 *   `scope: "project"`, which is the scope `scan` ships with. A rule whose whole semantics is
 *   "the guard appears nowhere in this project" can only be asserted here: the guard lives in one
 *   file and the violation in another, exactly as in a real repository.
 *
 * Fifteen of the forty-two rules carry `guard_missing`, and every one of the seven rules that
 * adversarial review found detector-unsound was an absence rule carrying guards. Their central
 * mechanism had never been executed by any gate, because the only mode that existed evaluated
 * guards in the opposite scope from the one the rule ships in.
 */
export function testRules(bundle: LoadedBundle, rulesDir: string): RuleTestResult[] {
  const staging = new FixtureStaging();
  try {
    return runRuleTests(bundle, rulesDir, staging);
  } finally {
    staging.dispose();
  }
}

function runRuleTests(
  bundle: LoadedBundle,
  rulesDir: string,
  staging: FixtureStaging,
): RuleTestResult[] {
  const results: RuleTestResult[] = [];

  for (const rule of bundle.rules) {
    const fixtureDir = findFixtureDir(rulesDir, rule);
    const res: RuleTestResult = {
      ruleId: rule.id,
      fixtures: 0,
      projects: 0,
      guards: rule.detector.guard_missing?.length ?? 0,
      passed: true,
      failures: [],
      scopeNotes: [],
      fields: {
        effective_date: { authored: undefined, declares: false, asserted: false },
        data_categories: { authored: undefined, declares: false, asserted: false },
      },
    };

    // Read the authoring file BEFORE anything reads the bundle's copy, and take the source of truth
    // from it. The bundle is then one more consumer to be checked rather than the reference.
    const authored = readAuthoredRule(rulesDir, rule);
    if (!authored) {
      res.passed = false;
      res.failures.push(
        `no rule.yaml found for this rule under ${rulesDir} — the bundle carries a rule whose authoring source cannot be located, so nothing here can check what the bundle did to it`,
      );
    } else {
      for (const field of PLUMBED_FIELDS) {
        const declared = field.read(authored);
        res.fields[field.name] = { authored: declared, declares: declared !== undefined, asserted: false };
        if (!sameValue(valueOf(rule, field.name), declared)) {
          res.passed = false;
          res.failures.push(
            `rule.yaml declares ${field.name} ${show(declared)} and the bundle carries ${show(valueOf(rule, field.name))} — the field is being lost or altered between the authoring file and dist/bundle/rules.json`,
          );
        }
      }
    }

    if (!fixtureDir) {
      res.passed = false;
      res.failures.push("no fixtures directory found for this rule");
      results.push(res);
      continue;
    }

    const entries = readdirSync(fixtureDir, { withFileTypes: true });
    const looseFiles = entries.filter((e) => !e.isDirectory()).map((e) => e.name);
    const projectDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

    // ---- per-file mode -------------------------------------------------------------------
    for (const fname of looseFiles) {
      const fpath = join(fixtureDir, fname);
      const expectations = parseExpectations(fname, readRegularFile(fpath, "utf8")).filter(
        (e) => e.ruleId === rule.id,
      );
      if (expectations.length === 0) continue;
      res.fixtures++;
      checkOneScan(res, rule, bundle, staging.present(fixtureDir, [fname]), "per-file", expectations);
    }

    // ---- project mode --------------------------------------------------------------------
    // Every sub-directory is scanned, including one carrying no annotation at all: a project of
    // ordinary code in which the rule must stay silent is a legitimate assertion, and skipping it
    // for having nothing to assert would be the same silent-omission failure this mode exists to
    // close. Because a project directory belongs to exactly one rule, any candidate the rule
    // produces there and the author did not annotate is over-matching.
    for (const dname of projectDirs) {
      const projectRoot = join(fixtureDir, dname);
      const files = listFiles(projectRoot);
      if (files.length === 0) continue;
      const expectations = files.flatMap((f) =>
        parseExpectations(f, readRegularFile(join(projectRoot, f), "utf8")).filter(
          (e) => e.ruleId === rule.id,
        ),
      );
      res.projects++;
      checkOneScan(
        res,
        rule,
        bundle,
        staging.present(projectRoot, files),
        `project ${dname}`,
        expectations,
      );
    }

    if (res.fixtures === 0 && res.projects === 0) {
      res.passed = false;
      res.failures.push("no fixture carries an annotation for this rule id");
    }

    // ---- what the guards do at production scope (reported, never failing) ------------------
    if (res.guards > 0) scopeReport(res, rule, bundle, fixtureDir, looseFiles, staging);

    // A declared value that no scan here could be checked against is an untested delivery path, and
    // an untested delivery path is how both of these fields spent their whole existence unread.
    // Normally unreachable — G1 already fails a rule whose fixtures assert no match — but a rule
    // whose fixtures carry only `ok:` annotations for its own id would otherwise pass with nothing
    // to check, and the assertion would silently cover 55 rules instead of 56.
    for (const field of PLUMBED_FIELDS) {
      const st = res.fields[field.name];
      if (st.declares && !st.asserted) {
        res.passed = false;
        res.failures.push(
          `rule.yaml declares ${field.name} ${show(st.authored)} and no fixture scan produced a candidate to carry it, so nothing here tests that the value reaches an output`,
        );
      }
    }

    results.push(res);
  }

  return results;
}

/**
 * Scan one presented set of files and check every expectation against it.
 *
 * The scanner is handed `presented.files` under `presented.root`, which for a repaired mutant is a
 * staging copy under a name that resolves the way its base's does. EVERYTHING THE READER SEES IS
 * TRANSLATED BACK to the name on disk — hit keys, guard locations and the `where` prefix — because
 * an annotation is written in a file a human can open, and a failure naming a temporary file nobody
 * can find is worse than no failure at all.
 *
 * Returns the hit set it built, keyed `<on-disk name>:<line>`. Nothing in the fixture loop reads it;
 * `checkFixtureNaming` does, so that the naming probe asserts against THIS function's own output
 * rather than against a second scan written to look like it.
 */
function checkOneScan(
  res: RuleTestResult,
  rule: Rule,
  bundle: LoadedBundle,
  presented: PresentedFiles,
  label: string,
  expectations: Expectation[],
): Set<string> {
  // A mutant whose name cannot be repaired would be read by a different engine path from the
  // fixture it mutates. It is still scanned, under its own name, but the rule fails: the
  // alternative is the silent weaker reading `fixture-names.ts` exists to end.
  for (const u of presented.unresolved) {
    res.passed = false;
    res.failures.push(
      `${u.file}: no name carrying the mutation index resolves the way "${u.base}" does ` +
        `(base: ${describeResolution(u.base)}; as named: ${describeResolution(u.file)}), so this ` +
        "mutant would be read by a different engine path than the fixture it mutates",
    );
  }
  const findings = runScan({
    bundle: { ...bundle, rules: [rule] },
    targetRoot: presented.root,
    files: presented.files,
    scope: label === "per-file" ? "per-file" : "project",
  });
  const onDisk = (f: string): string => presented.onDisk.get(f) ?? f;
  const hits = new Set(
    findings.candidates.flatMap((c) => c.locations.map((l) => `${onDisk(l.file)}:${l.start_line}`)),
  );
  // The tier each hit carries, under the same key: "word" only where every location there carries it (a place
  // matched by both tiers carries the construct's).
  const tierAt = new Map<string, "word" | "construct">();
  for (const c of findings.candidates) {
    for (const l of c.locations) {
      const key = `${onDisk(l.file)}:${l.start_line}`;
      const t = l.tier === "word" ? "word" : "construct";
      tierAt.set(key, tierAt.get(key) === "construct" ? "construct" : t);
    }
  }
  // ...and, for the joined-construct exemption in the over-matching check below, the span each hit
  // was folded from, under the SAME key. A location carries `joined_from` only where the rule
  // declared `detector.join_bracketed_constructs` AND the physical line raised nothing, so this map
  // is empty for every rule that does not declare the view, and the check below is then byte-for-byte
  // the check it was before this existed.
  const joinedFrom = new Map<string, { start_line: number; end_line: number }>();
  for (const c of findings.candidates) {
    for (const l of c.locations) {
      if (l.joined_from) joinedFrom.set(`${onDisk(l.file)}:${l.start_line}`, l.joined_from);
    }
  }
  // A missed expectation reads very differently depending on whether nothing matched or a guard
  // deleted the match, so the guard that removed it is named in the failure rather than left for
  // the reader to find.
  const removed = new Map(
    (findings.suppressed_by_guard ?? []).map((s) => [
      `${onDisk(s.file)}:${s.line}`,
      { ...s, guardFile: onDisk(s.guardFile) },
    ]),
  );
  const where = label === "per-file" ? onDisk(presented.files[0]) : label;

  for (const exp of expectations) {
    const key = `${exp.file}:${exp.line}`;
    if (exp.kind === "ruleid" && !hits.has(key)) {
      const g = removed.get(key);
      res.passed = false;
      res.failures.push(
        g
          ? `${where}: ${key} expected a match, but a guard removed it — /${g.guardPattern}/ matched ${g.guardFile}:${g.guardLine}`
          : `${where}: ${key} expected a match, but nothing was detected`,
      );
    }
    if (exp.kind === "ok" && hits.has(key)) {
      res.passed = false;
      res.failures.push(`${where}: ${key} matched a line annotated ok: (false positive)`);
    }
    if (exp.kind === "ruleid" && exp.tier !== undefined && hits.has(key) && tierAt.get(key) !== exp.tier) {
      res.passed = false;
      res.failures.push(
        `${where}: ${key} is annotated tier: ${exp.tier} and its place is in the ${tierAt.get(key)} tier`,
      );
    }
  }

  // A fixture is a known-good file, so a structural degrade on one is a defect rather than a fact
  // about somebody's repository: the grammar this rule's fixtures need is missing, will not load,
  // threw, or the file was refused on size. On a real tree each of these falls back to the
  // line-based reading and is merely counted; here it is the mechanism that turns a grammar which
  // stopped loading RED, per language covered by a fixture. Rules that declare no
  // structural_checks never parse anything and can never reach this.
  const degraded: string[] = [];
  const s = findings.stats ?? {};
  if ((s.structural_grammar_unavailable ?? 0) > 0) {
    const named = (findings.structural_grammars_unavailable ?? [])
      .map((g) => `${g.language}: ${g.error}`)
      .join("; ");
    degraded.push(`${s.structural_grammar_unavailable} file(s) had no usable grammar — ${named}`);
  }
  if ((s.structural_parse_failed ?? 0) > 0) degraded.push(`${s.structural_parse_failed} file(s) failed to parse`);
  if ((s.structural_skipped_too_large ?? 0) > 0) {
    degraded.push(`${s.structural_skipped_too_large} file(s) were over the structural size ceiling`);
  }
  // Counted in findings, not files, and it fails a fixture for its own reason: a check that names a
  // line outside the file it read is a defect in the check, not a hole in what could be read.
  if ((s.structural_findings_out_of_range ?? 0) > 0) {
    degraded.push(
      `${s.structural_findings_out_of_range} structural finding(s) named a line outside the file`,
    );
  }
  for (const d of degraded) {
    res.passed = false;
    res.failures.push(`${where}: the structural reading degraded on a fixture — ${d}`);
  }

  checkPlumbedDelivery(res, rule, findings, where);

  // A match on an unannotated line is unintended over-matching. Fixtures are held to zero
  // noise: anything the author did not deliberately mark is treated as a rule defect.
  const expected = new Set(
    expectations.filter((e) => e.kind === "ruleid").map((e) => `${e.file}:${e.line}`),
  );
  //
  // THE ONE EXEMPTION, AND WHAT IT IS AN EXEMPTION FROM. A rule that declares the joined-construct
  // view is tested against the whole bracket-balanced construct opening on a line, and the engine's
  // shipped rule is that A CONSTRUCT INSIDE ANOTHER IS FOLDED AT EACH OPENING LINE
  // (rule.schema.json, detector.join_bracketed_constructs). So a cookie literal written inside a
  // closure inside a function is read three times — once at the literal, once at the closure and
  // once at the function, each with its own `joined_from` span — and the outer two land on lines no
  // fixture author annotated.
  //
  // SINCE 2026-09-07 THE ENGINE DROPS THE ENCLOSING ONES THAT READ NOTHING THEIR CONTENTS DO NOT
  // (engine.ts `collapseNestedDuplicates`), so fewer such hits ever reach this function than did
  // when the exemption was written. IT IS UNCHANGED AND IT IS STILL NEEDED, for two populations the
  // collapse does not touch: an enclosing fold that fires a clause nothing inside it fires is
  // reported exactly as before, and the INWARD direction below — an annotated OUTER line with the
  // same construct's inner opening lines unannotated — is not a collapse case at all, since a
  // candidate is only ever dropped in favour of one INSIDE it. Before this exemption that cost `baseline-005` 118 fixture failures of
  // one shape, 117 of them the same construct seen further out, and it would have cost every rule
  // that opts in afterwards the same. It is repaired here once instead of by writing 117 annotations
  // into 31 existing fixture files.
  //
  // WHAT IS EXEMPT (both directions): a hit that CARRIES A SPAN and is the same construct
  // as a line this same rule annotated `ruleid:` in the same file — either because that line lies
  // inside this hit's span, or because this hit's opening line lies inside the span of an annotated
  // fold-derived hit. `expectations` reaching this function is already filtered to `rule.id` at both
  // call sites, so "the same rule" is a property of the argument rather than an assumption made here.
  //
  // WHAT IS NOT EXEMPT, and this half is what keeps the check worth having: a fold-raised hit whose
  // span contains NO annotated line still fails exactly as it did before. That is the case where the
  // fold reached a construct the author never marked — a genuine over-match, or a reach the author
  // has to look at and annotate deliberately. `baseline-005`'s own `fixtures/ok.ts` test-assertion
  // helper is the
  // instance that proved the half is live: it survived this exemption, was read, and is annotated in
  // the fixture rather than hidden here. A hit with NO span is untouched, so nothing about
  // line-scope matching changed.
  // THE SAME CONSTRUCT IS SEEN IN BOTH DIRECTIONS, so the exemption reads both.
  // An earlier version covered only the outward direction — the annotated line lies inside this candidate's
  // fold — and `bad.mut-2.ts` showed the mirror image: its `ruleid:` sits at `:129`, the OUTERMOST
  // opening line (`app.use(`, span {129,136}), while `:130` (`session({`) and `:131` (`cookie: {`)
  // are the same construct one and two levels FURTHER IN, with spans {130,135} and {131,134} that
  // contain no annotated line. Both directions are one construct reported at several opening lines,
  // so both are exempt, and the two tables below are the two readings of that one fact.
  const annotatedLines = new Map<string, number[]>();
  const annotatedSpans = new Map<string, { start_line: number; end_line: number }[]>();
  for (const e of expectations) {
    if (e.kind !== "ruleid") continue;
    const lines = annotatedLines.get(e.file);
    if (lines) lines.push(e.line);
    else annotatedLines.set(e.file, [e.line]);
    // ...and, where the ANNOTATED hit is itself fold-derived, the construct it stands for. Only a
    // fold-derived annotated hit contributes a span, so an ordinary line-scope fixture contributes
    // none and the inward branch below can never fire for it.
    const span = joinedFrom.get(`${e.file}:${e.line}`);
    if (!span) continue;
    const spans = annotatedSpans.get(e.file);
    if (spans) spans.push(span);
    else annotatedSpans.set(e.file, [span]);
  }
  const sameConstructAsAnAnnotatedLine = (key: string): boolean => {
    const span = joinedFrom.get(key);
    if (!span) return false;
    const cut = key.lastIndexOf(":");
    const file = key.slice(0, cut);
    const line = Number(key.slice(cut + 1));
    // OUTWARD: an annotated line lies inside this candidate's own construct, so this candidate is
    // that construct seen from further out (the closure, then the function around it).
    const lines = annotatedLines.get(file);
    if (lines?.some((l) => l >= span.start_line && l <= span.end_line)) return true;
    // INWARD: this candidate's opening line lies inside an ANNOTATED construct, so it is that
    // construct seen from further in (the options object inside the call the author marked).
    const spans = annotatedSpans.get(file);
    return spans?.some((s) => line >= s.start_line && line <= s.end_line) ?? false;
  };
  for (const key of hits) {
    if (!expected.has(key) && !sameConstructAsAnAnnotatedLine(key)) {
      res.passed = false;
      res.failures.push(`${where}: ${key} matched an unannotated line (over-matching)`);
    }
  }

  return hits;
}

/**
 * The plumbing assertion: every field in `PLUMBED_FIELDS` arrives in both output shapes a scan
 * produces, in memory, against real candidates from the rule's own fixtures — and **against what
 * `rule.yaml` declares**, never against the bundle's copy of it.
 *
 * - **the candidate objects** — every candidate carries exactly what the rule's authoring file
 *   declares, so a bundle that lost or altered the field fails here as well as at the source check
 *   in `testRules`;
 * - **the SARIF projection** — the rule's `reportingDescriptor` property bag carries it, which is
 *   where `sarif.ts` puts rule-level facts;
 * - **neither invents one** — where `rule.yaml` declares nothing the code must produce nothing,
 *   because "this rule states no date" and "the duty applies now" are different statements, as are
 *   "the author named no data category" and "the rule states nothing about data". Note the limit:
 *   this is a guard on the *code*, not on the rules. A `baseline-*` rule that started declaring a
 *   date would pass here and be counted in the printed fraction; whether a rule should declare one
 *   is rule authoring, which no gate decides.
 *
 * **What it does NOT reach is serialisation.** These are in-memory objects; `index.ts` writes the
 * files. That gap was real — independent verification stripped the key inside `index.ts` and this
 * check stayed green — and it is
 * closed by `checkDeliveryEndToEnd` below, which runs the CLI as a subprocess and reads the two
 * files back off disk.
 *
 * **It asserts delivery and never behaviour.** It says nothing about whether a rule whose date is in
 * the future should fire, or about whether the scanned repository holds any of the data categories
 * a rule names; a rule that fires today keeps firing whatever this check reads.
 *
 * Why here rather than in a new gate tool: it already fails a rule for what its output does
 * (over-matching, a structural degrade, an out-of-range line), it is **per rule**, which is the
 * granularity of the question, and *this* half costs no extra scan — the findings it reads are the
 * ones the fixture assertions just produced.
 *
 * **Two corrections to what this comment used to claim, both of which had gone stale before they
 * shipped and neither of which any gate checks.** It said G1 is "the only gate step that runs the
 * real scan pipeline and reads its output": a check, added by a later commit,
 * spawns `scan --out` over three trees and parses the written files, so it is now one of two. And it
 * said this "keeps `npm run gates` at fourteen steps": that commit had made it fifteen fifteen minutes
 * earlier. No total is stated here any more on purpose — the chain's length is written in prose in
 * several files and verified by nothing, and it went stale three times in one hour on 2026-08-13.
 * The claim that matters, that this check adds no step, is true without a count.
 */
function checkPlumbedDelivery(
  res: RuleTestResult,
  rule: Rule,
  findings: Findings,
  where: string,
): void {
  if (findings.candidates.length === 0) return;

  // The same findings through the SARIF writer. Projected here rather than trusted, because the two
  // outputs are built by different code from the same rule and either one can be dropped alone.
  const sarif = toSarif(findings, [rule]) as {
    runs?: { tool?: { driver?: { rules?: { id: string; properties?: Record<string, PlumbedValue> }[] } } }[];
  };
  const descriptor = sarif.runs?.[0]?.tool?.driver?.rules?.find((d) => d.id === rule.id);
  if (!descriptor) {
    res.passed = false;
    res.failures.push(
      `${where}: the rule raised candidates but no SARIF reportingDescriptor was emitted for it, so no rule-level fact reaches a SARIF reader`,
    );
    return;
  }

  for (const field of PLUMBED_FIELDS) {
    const declared = res.fields[field.name].authored;
    let delivered = true;

    for (const c of findings.candidates) {
      const carried = valueOf(c, field.name);
      if (sameValue(carried, declared)) continue;
      res.passed = false;
      delivered = false;
      res.failures.push(
        declared === undefined
          ? `${where}: candidate ${c.finding_id} carries ${field.name} ${show(carried)} and rule.yaml declares none — ${field.absenceMeans}`
          : `${where}: rule.yaml declares ${field.name} ${show(declared)} and the findings JSON candidate ${c.finding_id} carries ${show(carried)}. ${field.whyItMatters}`,
      );
    }

    const inSarif = descriptor.properties?.[field.name];
    if (!sameValue(inSarif, declared)) {
      res.passed = false;
      delivered = false;
      res.failures.push(
        `${where}: rule.yaml declares ${field.name} ${show(declared)} and its SARIF reportingDescriptor property bag carries ${show(inSarif)}`,
      );
    }

    // Coverage, not a verdict: set only where every output form checked here agreed, so the
    // fraction printed at the end counts rules whose value was actually seen to arrive.
    if (delivered) res.fields[field.name].asserted = true;
  }
}

/**
 * The rule as its author wrote it, read from `rules/packs/<pack>/<id>/rule.yaml`.
 *
 * The source of truth for everything this file asserts about a plumbed field. Both layouts
 * `findFixtureDir` accepts are tried, so a rule tree that moves does not silently stop being
 * checked; a rule whose source cannot be found is a failure rather than a skip.
 *
 * The parsed document is returned whole and each field extracts its own value, uncoerced: a YAML
 * scalar that parses to something other than the declared type (a `Date` under a timestamp tag, a
 * number, a string where a list belongs) is a malformed declaration, and it is reported by failing
 * the comparison rather than by being made to agree with whatever the output happens to carry.
 */
function readAuthoredRule(rulesDir: string, rule: Rule): Record<string, unknown> | null {
  const candidates = [
    join(rulesDir, "packs", rule.pack, rule.id, "rule.yaml"),
    join(rulesDir, rule.pack, rule.id, "rule.yaml"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    return (parseYaml(readRegularFile(path, "utf8")) as Record<string, unknown> | null) ?? {};
  }
  return null;
}

/** Subprocess scans the end-to-end check may spend before it reports what it could not exercise. */
const END_TO_END_ATTEMPTS = 5;

/** What the end-to-end check found. `lines` is printed either way, so a pass is legible too. */
export interface EndToEndResult {
  ok: boolean;
  lines: string[];
}

/**
 * End to end: run the CLI the way a user runs it, and read the values back off disk.
 *
 * **Why a subprocess and not another in-process assertion.** Everything above inspects the objects
 * `runScan` and `toSarif` return. Serialisation — `JSON.stringify` into `--out` and `--sarif` — lives
 * in `index.ts`, and no gate step exercised it. Independent verification proved that gap was real
 * rather than theoretical: patching `index.ts` to delete the key from both written documents left
 * the gate green and still printing `49/49`, while the emitted files contained none. A printed coverage
 * line that survives its own subject being deleted is the failure this work item exists to end,
 * one layer out.
 *
 * So this spawns `node dist/index.js scan --bundle … --target … --out … --sarif …`, parses the two
 * files that land on disk, and asserts that **every candidate in them carries what its own rule's
 * `rule.yaml` declares**, for every field in `PLUMBED_FIELDS`. Argument parsing, `loadBundle`, the
 * structural preparation, `runScan`, `toSarif`, `JSON.stringify` and `writeFileSync` all run exactly
 * as they do for a user.
 *
 * **Chosen by shape, not by position, and this is the part that was wrong before.** The first
 * version scanned one rule's fixtures and checked only that rule's own candidates. On this tree that
 * selected `ai-prohibited-001`, and every rule reachable in that scan happened to declare a
 * single-element `data_categories` list — so a serialiser truncating a list to its first element, or
 * collapsing `[]` into an absent field, would have been invisible to it while the printed line said
 * the values reached the written files. The check therefore keeps scanning until every *shape* that
 * occurs in the rule base has been exercised against a file the CLI actually wrote: a populated
 * list, an empty list, an absent declaration, a scalar. A shape it could not reach inside
 * `END_TO_END_ATTEMPTS` scans is reported as a failure, because "not exercised" and "delivered" are
 * the two states this whole work item exists to stop anyone confusing.
 *
 * **The first target is the whole authoring tree, and the rest are the rules' own fixture
 * directories.** Scanning `rules/packs` as one project raises candidates for 45 of the 56 rules in a
 * single subprocess, against 10 for the four fixture trees the shape rule would otherwise select, so
 * it is the cheapest large gain available: it takes the rules whose *written* output is read back
 * from 10 to 45. An earlier version of this check priced that scan as a *replacement* for the fixture
 * trees and rejected it; as an *addition* it is the better answer, and independent verification is
 * what surfaced the arithmetic.
 *
 * **What it costs is a moving number and is written here as a method rather than as a constant.**
 * This said "+6.6 s measured" and the change's own record said +4.4 s; re-measured on 2026-08-13 for
 * work item #57 it is **+10.1 to +10.8 s** (22.3–23.3 s with the combined tree, 12.2–12.5 s without,
 * two runs each on one quiet machine). Nothing regressed — the price is proportional to the tree, and
 * `rules/packs` held 1,611 files that day, 1,499 of them fixtures, after two sessions added mutation
 * fixtures the same morning. **To re-derive rather than trust any of those three numbers:** time
 * `test-rules` as it stands, then time it again with the `targets.push` of the combined tree below
 * disabled, and take the difference. A number written here instead would be stale by the next
 * fixture batch, which is what happened to both of the earlier ones.
 *
 * **What that coverage is and is not, measured rather than assumed.** In the combined tree 1,080 of
 * the 1,214 reported locations are inside the rule base's own `rule.yaml` and `rule.quotes.json`
 * files: 43 of the 45 rules are reached because their patterns match the text of the rule base
 * itself, and only `baseline-002` and `baseline-003` keep any fixture-directory location. That is
 * irrelevant to what this check asserts — a candidate is serialised by the same code wherever its
 * match came from, and the comparison is against `rule.yaml` — but it is why the coverage is
 * incidental rather than designed, and it can shrink when rule prose changes.
 *
 * **Why eleven rules stay silent there, since the reason matters and a false one was published.**
 * Under `rules/packs` every fixture file's path carries a `fixtures/` segment, which
 * `isNonProductionPath` treats as non-production, and `engine.ts:surfaceAllows` denies that surface
 * to any rule declaring no `detector.file_globs` — 54 of the 56 declare none. So a rule is reached
 * in the combined tree only if its patterns match rule-base source text, or if it is one of the two
 * rules (`baseline-002`, `baseline-003`, both `file_globs: ["**"]`) that opt into non-production
 * paths. **No guard is involved: no rule declares `detector.guard_missing` — the gate above prints
 * `0/0` — and that scan reports `candidates_suppressed_by_guard: 0` with an empty
 * `suppressed_by_guard` array.**
 *
 * After the combined tree, targets are the rules' own fixture directories, ordered by how many
 * still-uncovered shapes the rule's own declarations would contribute, then by rule id. On this tree
 * the combined scan covers every shape by itself, so the fixture trees are not reached; they remain
 * as the mechanism that fills a shape the combined tree ever stops exercising.
 */
export function checkDeliveryEndToEnd(bundle: LoadedBundle, rulesDir: string): EndToEndResult {
  const failures: string[] = [];
  /** Files the scans below opened and read to no rule. See `notReadNote` at the end of this function. */
  const notRead: NotReadFile[] = [];
  /** Files the scans below read with lines blanked by the minification ceiling. Same note, one unit
   * smaller: a delivery check that says a file was scanned must not say so of a file it read in part. */
  const partiallyRead: PartiallyReadFile[] = [];
  const authoredById = new Map<string, Record<string, unknown>>();
  const targets: { label: string; path: string; rule: Rule | null }[] = [];

  // The whole authoring tree first, under whichever of the two layouts `findFixtureDir` accepts.
  const combined = [join(rulesDir, "packs"), rulesDir].find((p) => existsSync(p));
  if (combined) targets.push({ label: "the whole authoring tree", path: combined, rule: null });

  for (const rule of bundle.rules) {
    const authored = readAuthoredRule(rulesDir, rule);
    if (!authored) continue;
    authoredById.set(rule.id, authored);
    const fixtures = findFixtureDir(rulesDir, rule);
    if (fixtures) targets.push({ label: `${rule.id} fixtures`, path: fixtures, rule });
  }

  if (targets.length === 0) {
    return {
      ok: false,
      lines: [
        `no rule under ${rulesDir} has both a locatable rule.yaml and a fixtures directory, so the written outputs were not checked at all`,
      ],
    };
  }

  // Every shape the rule base actually declares, per field — the coverage this check owes.
  const wanted = new Map<string, Set<PlumbedShape>>();
  for (const field of PLUMBED_FIELDS) {
    const shapes = new Set<PlumbedShape>();
    for (const doc of authoredById.values()) shapes.add(shapeOf(field.read(doc)));
    wanted.set(field.name, shapes);
  }
  const covered = new Map<string, Set<PlumbedShape>>(
    PLUMBED_FIELDS.map((f) => [f.name, new Set<PlumbedShape>()]),
  );
  const uncovered = (): number =>
    PLUMBED_FIELDS.reduce(
      (n, f) => n + [...wanted.get(f.name)!].filter((s) => !covered.get(f.name)!.has(s)).length,
      0,
    );
  /**
   * How many still-missing shapes this target's own rule would contribute if it fired. The combined
   * tree has no single rule and is always run first, so it sorts above everything.
   */
  const contribution = (rule: Rule | null): number =>
    rule === null
      ? Number.MAX_SAFE_INTEGER
      : PLUMBED_FIELDS.reduce((n, f) => {
          const s = shapeOf(f.read(authoredById.get(rule.id) ?? {}));
          return n + (covered.get(f.name)!.has(s) ? 0 : 1);
        }, 0);

  const cli = fileURLToPath(new URL("./index.js", import.meta.url));
  const workDir = makeTempFolder("wolfboy-delivery-");
  const scanned: string[] = [];
  let candidatesChecked = 0;
  const rulesChecked = new Set<string>();
  try {
    const remaining = [...targets];
    for (let attempt = 0; attempt < END_TO_END_ATTEMPTS && uncovered() > 0 && remaining.length > 0; attempt++) {
      remaining.sort(
        (a, b) =>
          contribution(b.rule) - contribution(a.rule) ||
          (a.rule?.id ?? "").localeCompare(b.rule?.id ?? ""),
      );
      const target = remaining.shift()!;
      const outPath = join(workDir, "findings.json");
      const sarifPath = join(workDir, "findings.sarif");
      try {
        // The scan runs without the host's variables (host-env.ts, the one list the gates' helper drops too): this
        // check is about the emitted files, not the session or CI, so it gives the same result anywhere. Inside a
        // Claude Code session the scan takes the declaration path and refuses a shell with no project folder or an
        // --out outside it; this command once started it there.
        const env = { ...process.env };
        for (const name of HOST_ENV_NAMES) delete env[name];
        execFileSync(
          process.execPath,
          [cli, "scan", "--bundle", bundle.dir, "--target", target.path, "--out", outPath, "--sarif", sarifPath],
          { stdio: "ignore", env },
        );
      } catch (e) {
        return {
          ok: false,
          lines: [
            `the CLI could not scan ${target.path}: ${(e as Error).message}. Nothing was written, so delivery into the emitted files is untested`,
          ],
        };
      }
      scanned.push(target.label);

      const written = JSON.parse(readRegularFile(outPath, "utf8")) as Findings;
      for (const n of written.files_not_read ?? []) notRead.push(n);
      for (const n of written.files_partially_read ?? []) partiallyRead.push(n);
      const sarif = JSON.parse(readRegularFile(sarifPath, "utf8")) as {
        runs?: { tool?: { driver?: { rules?: { id: string; properties?: Record<string, PlumbedValue> }[] } } }[];
      };
      const descriptors = sarif.runs?.[0]?.tool?.driver?.rules ?? [];

      // Every candidate in the file, not only the target rule's: a scan runs the whole bundle, so
      // this is free breadth, and a serialiser that dropped the field for some rules and not others
      // would otherwise escape.
      // Counted per rule and per field, then reported once each: a rule with ninety-six candidates
      // saying the same thing ninety-six times buries the other rules in the same run.
      // Keyed by rule id and field name, with both carried in the value rather than parsed back
      // out of the key. An earlier version joined them with a literal NUL character and split on
      // it; that worked, and it made this source file binary to `file`, to `grep` and to anything
      // that skips binary files. A source file a repository-wide grep silently passes over is the
      // invisible-hole class this whole work item is about, so the separator is gone and nothing
      // is parsed out of a key at all. Found 2026-08-13, after it had shipped.
      interface Mismatch {
        ruleId: string;
        field: PlumbedFieldName;
        n: number;
        of: number;
        declared: PlumbedValue;
        got: PlumbedValue;
      }
      const wrongInJson = new Map<string, Mismatch>();
      for (const c of written.candidates) {
        const doc = authoredById.get(c.rule_id);
        if (!doc) continue; // a bundle rule with no locatable source is already failing in testRules
        candidatesChecked++;
        rulesChecked.add(c.rule_id);
        const descriptor = descriptors.find((d) => d.id === c.rule_id);
        for (const field of PLUMBED_FIELDS) {
          const declared = field.read(doc);
          const key = `${c.rule_id} ${field.name}`;
          const tally = wrongInJson.get(key) ?? { ruleId: c.rule_id, field: field.name, n: 0, of: 0, declared, got: undefined };
          tally.of++;
          if (!sameValue(valueOf(c, field.name), declared)) {
            tally.n++;
            tally.got = valueOf(c, field.name);
          } else if (!descriptor) {
            failures.push(
              `${c.rule_id}: the SARIF file the CLI wrote carries no reportingDescriptor for a rule that raised candidates`,
            );
          } else if (!sameValue(descriptor.properties?.[field.name], declared)) {
            failures.push(
              `${c.rule_id}: rule.yaml declares ${field.name} ${show(declared)} and the SARIF file the CLI actually wrote carries ${show(descriptor.properties?.[field.name])} in that rule's property bag`,
            );
          } else {
            covered.get(field.name)!.add(shapeOf(declared));
          }
          wrongInJson.set(key, tally);
        }
      }
      for (const t of wrongInJson.values()) {
        if (t.n === 0) continue;
        failures.push(
          `${t.ruleId}: rule.yaml declares ${t.field} ${show(t.declared)} and ${t.n} of ${t.of} candidate(s) in the findings JSON the CLI actually wrote carry ${show(t.got)}`,
        );
      }
    }

    // A shape the rule base declares and no written file was seen to carry. Reported as a failure
    // rather than passed over, because an unexercised delivery path is exactly the state both these
    // fields were in for their whole existence.
    for (const field of PLUMBED_FIELDS) {
      for (const shape of wanted.get(field.name)!) {
        if (covered.get(field.name)!.has(shape)) continue;
        failures.push(
          `${field.name}: no candidate in any file the CLI wrote exercised the "${shape}" declaration, so delivery of that shape is untested. ${END_TO_END_ATTEMPTS} scan(s) were available and ${scanned.length} were spent (${scanned.join(", ") || "none"})`,
        );
      }
    }

    if (candidatesChecked === 0) {
      failures.push(
        `no rule raised a candidate on any of the ${scanned.length} tree(s) scanned, so no written output could be checked at all. That is itself a fixtures problem, since G1 requires every rule to assert at least one match`,
      );
    }

    // **The residual gap, named rather than implied, and it belongs to this check rather than to any
    // one field.** Everything above `checkDeliveryEndToEnd` covers all 56 rules and stops at the
    // objects `runScan` and `toSarif` return; only this check reads the files `index.ts` writes, and
    // only for rules that fire on the trees it scanned. **A serialisation regression scoped to some
    // rules and not others escapes for every field in `PLUMBED_FIELDS` alike — `effective_date` as
    // much as `data_categories`.** Measured, not assumed: deleting either key inside `index.ts` for
    // `eu-consent-*` alone left both this gate and `test:findings-schema` green while the CLI wrote
    // 219 candidates without it.
    // Adding the whole
    // authoring tree as the first target shrank that surface from 46 rules to these, and the rules
    // are printed by id so the remainder is a list a reader can act on rather than a fraction.
    //
    // **The list this prints is THIS check's residual, and the gate chain's residual is one shorter.**
    // `test:findings-schema` scans `test-target` and reads `eu-consent-010`'s written output back off
    // disk, comparing its values against the rule in the built bundle; `testRules` above compares
    // that bundle rule against `rule.yaml` for all 56, so the two compose. Measured for work item #57
    // rather than reasoned: deleting `data_categories` from the written documents for exactly the
    // eleven rules named below is green here and **red** in `test:findings-schema`; deleting it for
    // the ten that remain when `eu-consent-010` is taken out is green in both. Those ten are the
    // rules whose written output is read back by nothing —
    // an internal record names them and shows why the two steps stay separate.
    // The union is not asserted anywhere and cannot be from inside either step: each prints its own
    // half, this one as the rules it could not reach, the other as the rules it did.
    // FILES THE SCAN ITSELF OPENED AND HANDED TO NO RULE, over the trees this check walked.
    //
    // Reported here for exactly the reason `unreadNote` below is reported: a delivery check that
    // says "45 of 63 rules were reached" while a file in the tree was never read has described its
    // own coverage wrongly. The whole authoring tree is one of the targets, so this check reads
    // `rules/packs/**`, and FOUR rule.yaml files in it carry a line over the minification ceiling —
    // measured 2026-08-25: `eu-retention-001` 9,898 characters, `eu-cra-001` 6,842,
    // `ai-transparency-008` 6,319, `ai-prohibited-004` 5,968. Every one of them was invisible to
    // this check, and nothing anywhere said so. Now it says so.
    //
    // It does NOT change what this check passes or fails on. The skip is the scanner's and stays (do not remove the skip, report it); this line only stops the
    // report being silent about it.
    const notReadNote =
      notRead.length === 0
        ? null
        : `${notRead.length} file(s) in the scanned tree(s) were opened and read to no rule, so nothing above covers them — ` +
          notRead
            .slice(0, 8)
            .map((n) => `${n.file}${n.longest_line ? ` (longest line ${n.longest_line})` : ""}`)
            .join(", ") +
          (notRead.length > 8 ? `, and ${notRead.length - 8} more` : "");
    // The same sentence at the unit the ceiling now works in. A file read with three of its lines
    // blanked is inside every count above, so a report that named only `files_not_read` would say by
    // omission that it was read whole. Both notes are emitted, never merged: "not opened" and
    // "opened and read in part" are different states and the reader's next action differs.
    const partiallyReadNote =
      partiallyRead.length === 0
        ? null
        : `${partiallyRead.length} file(s) in the scanned tree(s) were read with ` +
          `${partiallyRead.reduce((n, p) => n + (p.lines?.length ?? 0), 0)} line(s) blanked by the ` +
          `minification ceiling, so nothing above covers those lines — ` +
          partiallyRead
            .slice(0, 8)
            .map((p) => `${p.file} (line(s) ${(p.lines ?? []).map((l) => l.line).join(", ")})`)
            .join(", ") +
          (partiallyRead.length > 8 ? `, and ${partiallyRead.length - 8} more` : "");

    const unread = bundle.rules.map((r) => r.id).filter((id) => !rulesChecked.has(id));
    const unreadNote =
      unread.length === 0
        ? "every rule's written output was read back"
        : `${unread.length} rule(s) had no candidate in any written file and so are covered only in memory, for every plumbed field alike: ${unread.slice(0, 15).join(", ")}${unread.length > 15 ? `, and ${unread.length - 15} more` : ""}`;

    return failures.length > 0
      ? { ok: false, lines: [...new Set(failures)] }
      : {
          ok: true,
          lines: [
            `${candidatesChecked} candidate(s) of ${rulesChecked.size} of ${bundle.rules.length} rule(s), read back out of the findings JSON and the SARIF the CLI wrote over ${scanned.length} tree(s) — ` +
              PLUMBED_FIELDS.map(
                (f) => `${f.name} ${[...wanted.get(f.name)!].sort().join("/")} all exercised`,
              ).join("; "),
            unreadNote,
            ...(notReadNote ? [notReadNote] : []),
            ...(partiallyReadNote ? [partiallyReadNote] : []),
          ],
        };
  } finally {
    removePath(workDir, { recursive: true, force: true });
  }
}

/**
 * Run the rule's loose fixtures once more as a single project, and report which `ruleid:` lines
 * survive per-file but are deleted at the scope `scan` actually ships with.
 *
 * This does not fail. Cross-file suppression is what a project-scoped guard is *for* — a consent
 * gate declared anywhere covers the repository — so a difference here is a fact about the rule,
 * not automatically a defect. It is worth printing because no gate has ever shown an author that
 * fact: eu-dsa-001 shipped with a guard that a single `navigator.sendBeacon(` call silenced across
 * a whole repository, and it passed every gate. The output names the guard and the line, so the
 * author can decide whether that is proof the duty is discharged or an accident.
 *
 * The way to turn any of these into an assertion is a fixture sub-directory: put the guard in one
 * file and the violation in another and the project mode above will hold the rule to it.
 */
function scopeReport(
  res: RuleTestResult,
  rule: Rule,
  bundle: LoadedBundle,
  fixtureDir: string,
  looseFiles: string[],
  staging: FixtureStaging,
): void {
  if (looseFiles.length === 0) return;
  const expectations = looseFiles.flatMap((f) =>
    parseExpectations(f, readRegularFile(join(fixtureDir, f), "utf8")).filter(
      (e) => e.ruleId === rule.id && e.kind === "ruleid",
    ),
  );
  if (expectations.length === 0) return;

  // Presented the same way the assertions above are: a note that a match "is deleted at project
  // scope" must not be produced by a mutant that was never read structurally in the first place.
  const presented = staging.present(fixtureDir, looseFiles);
  const findings = runScan({
    bundle: { ...bundle, rules: [rule] },
    targetRoot: presented.root,
    files: presented.files,
    scope: "project",
  });
  const onDisk = (f: string): string => presented.onDisk.get(f) ?? f;
  const hits = new Set(
    findings.candidates.flatMap((c) => c.locations.map((l) => `${onDisk(l.file)}:${l.start_line}`)),
  );
  const removed = new Map(
    (findings.suppressed_by_guard ?? []).map((s) => [
      `${onDisk(s.file)}:${s.line}`,
      { ...s, guardFile: onDisk(s.guardFile) },
    ]),
  );

  const lost = expectations.filter((e) => !hits.has(`${e.file}:${e.line}`));
  if (lost.length === 0) return;

  const first = removed.get(`${lost[0].file}:${lost[0].line}`);
  res.scopeNotes.push(
    `${lost.length}/${expectations.length} asserted match(es) are deleted when the fixtures are scanned as one project` +
      (first
        ? ` — /${first.guardPattern}/ matched ${first.guardFile}:${first.guardLine}`
        : ""),
  );
}

// ------------------------------------------------------------------ the naming self-check
//
// WHAT THIS EXISTS TO CATCH, AND WHY NOTHING ELSE CAUGHT IT. Until 2026-08-18 this command handed
// every fixture to the scanner under the name it has on disk. For a base whose language is decided
// by a COMPOUND extension the mutation convention breaks that name — `x.blade.mut-1.php` does not
// end in `.blade.php` — so `languageFor` returned null, the parse-tree reading was skipped without a
// word, and the mutant was scored against a strictly weaker detector than its own base. 31 of this
// rule base's 1,695 mutants, across 5 rules, were read that way, and every `ruleid:` line in them
// that only the structural reading can see was reported as *"expected a match, but nothing was
// detected"* — a detector hole that did not exist. A check, reading the same
// files with the same engine, scored those same lines DETECTED. Two gate steps disagreed about what
// language a file is, which is the "never keep a second copy" failure this workspace names; the
// decision now lives in `fixture-names.ts` and both steps import it.
//
// IT IS NOT BEHIND A FLAG. A self-test nobody runs is not a test, and this repository has already
// removed one hidden escape for that reason (a check §2). It runs on every
// `test-rules` invocation and its failures fail the command.
//
// IT ASSERTS THE CALL SITE, NOT THE FUNCTION. `checkFixtureNaming` goes through `FixtureStaging` and
// `checkOneScan` — the same two the fixture loop above goes through — because the defect that
// survived longest was not a wrong presented name, it was a correct presented name that the call
// site never used. `presentFixtureName`'s own behaviour is asserted here only where a call-site
// consequence makes it visible; the unit-level assertions on it live at the foot of
// a check, which is the other consumer.
const NAMING_PROBE_RULE = "eu-accessibility-001";
/** Blade's own comment form, so the two probe files differ in comments alone and hits shift by 2. */
const NAMING_PROBE_SHIFT = 2;
const NAMING_PROBE_BODY =
  '<div class="toolbar">\n    <button class="btn">\n        <i class="fa fa-trash"></i>\n    </button>\n</div>\n';
const NAMING_PROBE_MUTANT =
  "{{-- mutation: reflow --}}\n{{-- these two comment lines shift every hit by NAMING_PROBE_SHIFT --}}\n" +
  NAMING_PROBE_BODY;

export interface NamingCheckResult {
  ok: boolean;
  lines: string[];
}

/** A result object to run one probe scan against, with the plumbed fields already agreed. */
function probeResult(rule: Rule): RuleTestResult {
  return {
    ruleId: rule.id,
    fixtures: 0,
    projects: 0,
    guards: 0,
    passed: true,
    failures: [],
    scopeNotes: [],
    // Taken from the bundle rather than from `rule.yaml`: the probe asserts naming, and the
    // authoring-to-bundle comparison is the fixture loop's job. Leaving these absent would make
    // `checkPlumbedDelivery` report every probe candidate as carrying a field the rule declares.
    fields: {
      effective_date: { authored: valueOf(rule, "effective_date"), declares: false, asserted: false },
      data_categories: { authored: valueOf(rule, "data_categories"), declares: false, asserted: false },
    },
  };
}

export function checkFixtureNaming(bundle: LoadedBundle): NamingCheckResult {
  const rule = bundle.rules.find((r) => r.id === NAMING_PROBE_RULE);
  if (!rule) {
    return {
      ok: false,
      lines: [
        `${NAMING_PROBE_RULE} is not in the bundle, so the "same bytes, two names" check did not run — point it at another rule that declares structural_checks rather than deleting the check`,
      ],
    };
  }
  if (!declaresStructuralChecks([rule])) {
    return {
      ok: false,
      lines: [
        `${NAMING_PROBE_RULE} no longer declares structural_checks, so the "same bytes, two names" check can no longer see the reading it exists to protect — point it at a rule that does`,
      ],
    };
  }

  const failures: string[] = [];
  const assert = (ok: boolean, what: string): void => {
    if (!ok) failures.push(what);
  };
  const staging = new FixtureStaging();
  const dir = makeTempFolder("test-rules-naming-probe-");
  try {
    writeFileAt(join(dir, "probe.blade.php"), NAMING_PROBE_BODY);
    writeFileAt(join(dir, "probe.blade.mut-1.php"), NAMING_PROBE_MUTANT);
    writeFileAt(join(dir, "probe.blade.mut-7.php"), NAMING_PROBE_MUTANT);
    // A name the convention does not break: `probe.html` and `probe.mut-1.html` resolve alike, so
    // this one must never be copied anywhere.
    writeFileAt(join(dir, "probe.mut-1.html"), NAMING_PROBE_BODY);
    // A sibling with no mutation index at all, for the completeness assertion below.
    writeFileAt(join(dir, "sibling.blade.php"), NAMING_PROBE_BODY);

    const scan = (
      files: string[],
      expectations: Expectation[],
    ): { res: RuleTestResult; hits: Set<string> } => {
      const res = probeResult(rule);
      const hits = checkOneScan(res, rule, bundle, staging.present(dir, files), "per-file", expectations);
      return { res, hits };
    };

    // (1) The probe fires under its own name. Without this the comparison below compares nothing:
    //     an empty list shifted by two is still an empty list.
    const base = scan(["probe.blade.php"], []);
    const baseLines = [...base.hits]
      .map((k) => Number(k.slice(k.lastIndexOf(":") + 1)))
      .sort((a, b) => a - b);
    assert(
      baseLines.length > 0,
      `the structural probe fires nowhere under its own name "probe.blade.php" for ${NAMING_PROBE_RULE}, so the two-name comparison below compares nothing — this check is inert until that is fixed`,
    );

    // (2) THE DEFECT ITSELF. The same construct under a mutant's name must produce the same
    //     findings, shifted by the comment lines that are the only difference between the files.
    const shifted: Expectation[] = baseLines.map((line) => ({
      file: "probe.blade.mut-1.php",
      line: line + NAMING_PROBE_SHIFT,
      kind: "ruleid",
      ruleId: rule.id,
    }));
    const mutant = scan(["probe.blade.mut-1.php"], shifted);
    assert(
      mutant.res.failures.length === 0,
      "THE SAME CONSTRUCT IS READ DIFFERENTLY UNDER A MUTANT'S NAME: " +
        `under "probe.blade.php" this rule reports [${baseLines.join(", ")}], and under ` +
        `"probe.blade.mut-1.php" — the same bytes plus ${NAMING_PROBE_SHIFT} leading comment ` +
        `line(s) — it reports [${[...mutant.hits].join(", ")}]. Either a compound extension ` +
        "(.blade.php) is being broken by the .mut-<n> segment, so languageFor returns null and " +
        "every mutant of such a fixture is scored without the structural reading, or the bytes " +
        `being scanned are not the mutant's. Reported: ${mutant.res.failures.join(" | ")}`,
    );

    // (3) Every name a reader is shown is the name on disk. A staged mutant is scanned under a
    //     name that exists only inside a temporary directory, and a failure naming that name sends
    //     the reader to a file that is already deleted by the time they look.
    const misplaced = scan(
      ["probe.blade.mut-1.php"],
      baseLines.map((line) => ({
        file: "probe.blade.mut-1.php",
        line: line + NAMING_PROBE_SHIFT + 1,
        kind: "ruleid" as const,
        ruleId: rule.id,
      })),
    );
    assert(
      misplaced.res.failures.length > 0 &&
        misplaced.res.failures.every((f) => f.includes("probe.blade.mut-1.php")) &&
        !misplaced.res.failures.some((f) => f.includes("probe.mut-1.blade.php")),
      "a failure about a staged mutant names the name it was staged under instead of the name it " +
        `has on disk, so the reader is sent to a file that no longer exists: ${misplaced.res.failures.join(" | ")}`,
    );

    // (4) The repair touches only the names that need it. A fixture directory that needs no
    //     staging must not be copied at all.
    const untouched = staging.present(dir, ["probe.mut-1.html"]);
    assert(
      untouched.root === dir && untouched.onDisk.size === 0,
      'a mutant whose own name already resolves like its base is being copied to a staging directory anyway — the repair must touch only the names that need it',
    );

    // (5) When one file of a set is staged, the WHOLE set is staged with it. Project mode and
    //     `scopeReport` scan a set as one project, and a guard lives in a sibling: staging the
    //     mutant alone would drop every guard in the directory and turn a suppressed match into a
    //     detected one, silently.
    const withSibling = staging.present(dir, ["probe.blade.mut-1.php", "sibling.blade.php"]);
    assert(
      withSibling.files.length === 2 &&
        withSibling.files.every((f) => existsSync(join(withSibling.root, f))),
      `staging a mutant dropped its siblings: presented [${withSibling.files.join(", ")}] under ` +
        `${withSibling.root}, of which ` +
        `[${withSibling.files.filter((f) => !existsSync(join(withSibling.root, f))).join(", ")}] ` +
        "are not there — a project scan would then be missing the files its guards live in",
    );

    // (6) Two mutants of one base keep their own indices. A repair that hard-codes `mut-1` satisfies
    //     every assertion above and then stages both under one name, so the second overwrites the
    //     first and each is scored against the other's bytes.
    const twoIndices = staging.present(dir, ["probe.blade.mut-1.php", "probe.blade.mut-7.php"]);
    assert(
      new Set(twoIndices.files).size === 2,
      `two mutants of one base were presented under the same name [${twoIndices.files.join(", ")}] — ` +
        "the presented name must carry the mutant's own index, or one file's bytes overwrite the other's",
    );
  } finally {
    staging.dispose();
    removePath(dir, { recursive: true, force: true });
  }

  if (failures.length > 0) return { ok: false, lines: failures };
  return {
    ok: true,
    lines: [
      "every fixture is handed to the scanner under a name that resolves to the same language, " +
        "comment syntax and production surface as its base fixture's, the whole set is presented " +
        "together, and every name a failure shows is the name on disk",
    ],
  };
}

function findFixtureDir(rulesDir: string, rule: Rule): string | null {
  const candidates = [
    join(rulesDir, "packs", rule.pack, rule.id, "fixtures"),
    join(rulesDir, rule.pack, rule.id, "fixtures"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

export function formatTestResults(results: RuleTestResult[]): { text: string; ok: boolean } {
  const lines: string[] = [];
  let pass = 0;
  for (const r of results) {
    const counts =
      `${r.fixtures} fixtures` + (r.projects > 0 ? `, ${r.projects} project fixtures` : "");
    if (r.passed) {
      pass++;
      lines.push(`✔ ${r.ruleId} (${counts})`);
    } else {
      lines.push(`✘ ${r.ruleId}`);
      for (const f of r.failures) lines.push(`    - ${f}`);
    }
    for (const n of r.scopeNotes) lines.push(`    ⓘ project scope: ${n}`);
  }

  // The guard-scope debt as a fraction, on the first screen. Governance §9.1 requires coverage to
  // be reported every session whether or not it moved; the same applies to a mechanism that ships
  // in every scan and is asserted by no fixture.
  const guarded = results.filter((r) => r.guards > 0);
  const guardedTested = guarded.filter((r) => r.projects > 0);
  lines.push("");
  lines.push(`rules: ${pass}/${results.length} passed`);
  lines.push(
    `project-scope guards asserted: ${guardedTested.length}/${guarded.length} rules carrying guard_missing have a project fixture`,
  );
  // One line per plumbed field, printed on the same principle as the line above: a mechanism that
  // ships in every scan and is asserted nowhere is the state both these fields spent their whole
  // existence in.
  //
  // **The wording is exact, and it was not before.** This said "reach findings JSON and SARIF",
  // which named the two files — and the check behind it reads the objects `runScan` and `toSarif`
  // return, not the files `index.ts` writes. Independent verification deleted the key from both
  // written documents and this line went on printing 49/49 about files that no longer carried it. The files are now checked by
  // `checkDeliveryEndToEnd`, which prints its own line; this one says what it actually asserts, and
  // the denominator counts what `rule.yaml` declares rather than what the bundle happens to carry.
  //
  // The parenthetical exists because a list field has one more way of declaring nothing than a
  // scalar does: 53 rules declare `data_categories` and 8 of those declare it empty, so a fraction
  // over 53 alone would let a reader believe 53 rules name a category.
  for (const field of PLUMBED_FIELDS) {
    const declaring = results.filter((r) => r.fields[field.name].declares);
    const empty = declaring.filter((r) => shapeOf(r.fields[field.name].authored) === "empty").length;
    lines.push(
      `${field.name} delivery asserted: ${declaring.filter((r) => r.fields[field.name].asserted).length}/${declaring.length} rules declaring one in rule.yaml` +
        (empty > 0 ? ` (${empty} of them declaring it empty)` : "") +
        ` ${field.coverage}`,
    );
  }
  return { text: lines.join("\n"), ok: pass === results.length };
}
