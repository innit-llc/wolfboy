/**
 * `detector.shared_path_exclusions` — the paths a rule refuses to read, declared once and named by
 * every rule that refuses them.
 *
 * WHY IT EXISTS. `detector.path_without` puts a rule's path exclusions in one place WITHIN THAT
 * RULE, and that is as far as it reaches. Measured on 2026-08-27 over the 63 shipped rules: 32 rules
 * carry 169 `path_without` clauses between them, and 98 of those 169 are a clause some OTHER rule
 * also spells, byte for byte. One regex — `\.(?:test|spec|stories|cy)\.[cm]?[jt]sx?$`, "do not read
 * a JavaScript test file" — is typed out in **fourteen** separate `rule.yaml` files; the standard
 * test-directory clause in twelve, the fixtures/mocks/snapshots clause in twelve, the vendored-code
 * clause in thirteen. That is a forbidden second copy — *never keep a second copy
 * of anything two places must agree on; export it and import it* — and it had already drifted before
 * this module was written: `ai-prohibited-002` and `ai-prohibited-004` spell the same test-directory
 * question with a trailing `/` where the majority spell it `(/|$)`, and `eu-special-categories-001`
 * spells `__tests?__` where the majority spell `__tests__`. Nothing could see the divergence,
 * because nothing held the twelve copies side by side.
 *
 * WHY IT IS NOT `shared_vocabulary`. A shared word list holds LITERAL TEXT that is escaped on the
 * way into a pattern, so `(click)` there matches the six characters `(click)`; a path exclusion IS a
 * regular expression and is compiled raw. One file format serving both would be a file whose entries
 * are escaped by one consumer and not by the other — the "two readings of one list" defect this
 * whole family of mechanisms exists to end, re-created inside its own file. They are also composed
 * differently: a word list is SPLICED into a pattern at `(?&name)`, and an exclusion set is
 * APPENDED to a list of whole clauses. So the two have separate directories, separate schemas and
 * separate fields, and share only the resolution shape below, deliberately mirrored function for
 * function on `vocabulary.ts` so that a reader of one has read both.
 *
 * WHERE RESOLUTION HAPPENS. `tools/build-bundle.mjs` merges every named set into the rule's
 * `detector.path_without` and REMOVES `detector.shared_path_exclusions`, before any lint reads the
 * rule and before `dist/bundle/rules.json` is written — so a shipped bundle carries no import, and
 * the scanner never needs `rules/path-exclusions/`, which a user's machine does not have. The
 * engine's own defence against a bundle built some other way is `assertSharedPathExclusionsResolved`.
 */

/** One named set of path exclusions, exactly as `rules/path-exclusions/*.yaml` declares it. */
export interface PathExclusionSet {
  /** Other sets this one is composed of, in declared order. Resolved before `patterns`. */
  includes?: string[];
  /** Regular-expression sources, tested against the path relative to the scan root. */
  patterns?: { pattern: string; [field: string]: unknown }[];
  [field: string]: unknown;
}

/** Every named set on disk, keyed by the name a rule imports it under. */
export type PathExclusionSets = Record<string, PathExclusionSet>;

/** The `detector` field a rule names exclusion sets in. Written once; imported wherever it is read. */
export const SHARED_PATH_EXCLUSIONS_FIELD = "shared_path_exclusions";

/**
 * The clauses one named set contributes: every set it `includes`, in declared order, then its own
 * `patterns`, in file order.
 *
 * THE PROJECTION, and it is the only way a set becomes clauses — the same decision, for the same
 * reason, as `sharedListItems` in vocabulary.ts. A flat copy of the resolved clauses stored beside
 * the definition would be a second copy of the very thing this module exists to have one of.
 *
 * WHY `includes` EXISTS AT ALL, given that a rule may simply name three sets. Because a rule must be
 * able to say "apply the standard test-surface exclusion" in ONE line, and the standard exclusion is
 * three clauses that answer three questions — a directory named for tests, a filename spelled for a
 * test, a directory of fixture data. Twelve rules want all three; `eu-cra-001`, `eu-cra-002` and
 * `eu-special-categories-001` want the filename clause and MUST NOT have the fixture clause, because
 * a real person's health measurement in a fixture is exposure whether or not the file ships. Without
 * composition the choice is between a one-line standard that those three cannot use and three
 * separate names that nobody can call the standard. With it, `test_surface` names the three and the
 * three stay separately nameable.
 *
 * Four hard errors, each of them something that would otherwise be silent:
 *
 * - A SET THAT CONTRIBUTES NOTHING. An empty exclusion set is a rule declaring an exclusion it does
 *   not get: the declaration reads in review as the standard surface being applied and compiles as
 *   the whole repository being read. Named with its file rather than with the rule that imported it.
 * - A PATTERN THAT IS NOT A NON-EMPTY STRING. An empty regex source matches every path, which would
 *   silently take the importing rule's whole surface away; a number or a null reaches `new RegExp`
 *   as the characters of its own `String()`.
 * - A CYCLE, or a set including itself. Left alone it is an infinite recursion at build time; caught
 *   here it names the chain.
 * - AN `includes` NAMING A SET NOTHING DECLARES. The alternative is a set that quietly resolves to
 *   fewer clauses than it says it has, which is a rule reading MORE than its author declared.
 */
export function pathExclusionClauses(
  name: string,
  sets: PathExclusionSets,
  where: string,
  seen: string[] = [],
): string[] {
  if (seen.includes(name)) {
    throw new Error(
      `${where}: path exclusion set "${name}" includes itself (${[...seen, name].join(" -> ")}), so ` +
        `resolving it never terminates`,
    );
  }
  const set = Object.prototype.hasOwnProperty.call(sets, name) ? sets[name] : undefined;
  if (!set) {
    const available = Object.keys(sets).sort();
    throw new Error(
      `${where}: path exclusion set "${name}" is named but no file in the shared path-exclusion ` +
        `directory declares it (declared: ${available.length > 0 ? available.join(", ") : "none"})`,
    );
  }
  const clauses: string[] = [];
  for (const included of set.includes ?? []) {
    clauses.push(...pathExclusionClauses(included, sets, where, [...seen, name]));
  }
  (set.patterns ?? []).forEach((entry, index) => {
    const pattern = entry?.pattern;
    if (typeof pattern !== "string" || pattern.length === 0) {
      throw new Error(
        `${where}: path exclusion set "${name}" entry [${index}] has a pattern that is not a ` +
          `non-empty string (${JSON.stringify(pattern)}) — an empty source matches every path`,
      );
    }
    clauses.push(pattern);
  });
  if (clauses.length === 0) {
    throw new Error(
      `${where}: path exclusion set "${name}" resolves to no clause at all, so a rule naming it ` +
        `reads the whole tree while its declaration says otherwise`,
    );
  }
  return clauses;
}

/**
 * A rule's EFFECTIVE path exclusions: the sets it imports, in declared order, then the clauses it
 * writes itself.
 *
 * THE ORDER IS FIXED AND IT IS IMPORTS FIRST. Nothing in the engine depends on it — `path_without`
 * is read as `.some()`, so the set of excluded paths is the same whatever the order — but a gate
 * that asserts the compiled clause list byte for byte needs one order to assert against, and a
 * reader of a `rule.yaml` reads the same way: this is the standard surface, and these are the
 * clauses this rule adds on top of it.
 *
 * COLLISION IS A HARD ERROR, IN BOTH DIRECTIONS, AND THERE IS NO PRECEDENCE — the same decision, for
 * the same reasons, as `mergeSharedVocabulary` in vocabulary.ts:
 *
 * - THE SAME CLAUSE FROM TWO IMPORTED SETS. Harmless to the matching and not harmless to a reader:
 *   it means two sets claim one exclusion, and which of them the rule is relying on is a question
 *   the files no longer answer. It is also how `test_surface` would silently start swallowing a set
 *   somebody meant to keep separate.
 * - A CLAUSE THE RULE ALSO WRITES INLINE. Deleting the inline copy would be a correction to the
 *   shared set that never reaches this rule; keeping both leaves one of the two written down and
 *   never read. The error costs one deletion and names both sides.
 *
 * `where` names the rule, so an author is told which rule to change and not only which set.
 */
export function mergeSharedPathExclusions(
  own: string[] | undefined,
  imports: string[] | undefined,
  sets: PathExclusionSets,
  where: string,
): string[] | undefined {
  if (!imports || imports.length === 0) return own;
  const merged: string[] = [];
  const from = new Map<string, string>();
  const seenName = new Set<string>();
  for (const name of imports) {
    if (seenName.has(name)) {
      throw new Error(`${where}: ${SHARED_PATH_EXCLUSIONS_FIELD} names "${name}" twice`);
    }
    seenName.add(name);
    for (const clause of pathExclusionClauses(name, sets, where)) {
      const first = from.get(clause);
      if (first !== undefined) {
        throw new Error(
          `${where}: the clause ${JSON.stringify(clause)} arrives from the path exclusion set ` +
            `"${first}" and again from "${name}" — one exclusion belongs to one set, or a reader ` +
            `cannot tell which set this rule is relying on`,
        );
      }
      from.set(clause, name);
      merged.push(clause);
    }
  }
  for (const clause of own ?? []) {
    const first = from.get(clause);
    if (first !== undefined) {
      throw new Error(
        `${where}: detector.path_without writes the clause ${JSON.stringify(clause)}, which the ` +
          `imported path exclusion set "${first}" already contributes — there is no precedence ` +
          `between them, deliberately, because either precedence leaves one of the two written ` +
          `down and never read. Delete the inline clause and keep the import`,
      );
    }
    merged.push(clause);
  }
  return merged;
}

/**
 * Refuse a rule whose `shared_path_exclusions` was never resolved.
 *
 * Called by the engine on every rule it compiles, and it is the reason this module has an
 * engine-side half at all. Imports are resolved at BUILD time and a bundle therefore carries none; a
 * rule reaching the engine with the field still on it came from a bundle some other path produced,
 * and the engine reads `detector.path_without` and nothing else — so the named sets would simply not
 * be there. The rule would then read every test tree, fixture directory and vendored dependency the
 * author declared it must not read, produce candidates from all of them, and look exactly like a
 * rule that was written that way. A crash naming the field is the only outcome that is not a quiet
 * wrong answer.
 */
export function assertSharedPathExclusionsResolved(
  detector: Record<string, unknown>,
  where: string,
): void {
  const declared = detector?.[SHARED_PATH_EXCLUSIONS_FIELD];
  if (Array.isArray(declared) && declared.length > 0) {
    throw new Error(
      `${where}: detector.${SHARED_PATH_EXCLUSIONS_FIELD} is still present (${declared.join(", ")}), so ` +
        `this rule's shared path exclusions were never merged into detector.path_without. Bundles are ` +
        `built by tools/build-bundle.mjs, which resolves them; a bundle that still carries imports was ` +
        `not built by it, and scanning with it would read every surface those sets exclude`,
    );
  }
}
