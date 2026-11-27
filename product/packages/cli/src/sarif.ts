import type { FindingLocation, Findings, Rule, RuleWithoutCandidates } from "wolfboy-schemas";
import { gzipSync } from "node:zlib";
import { censusRoster } from "./scan.js";
import { PROGRAM_HOMEPAGE, PROGRAM_NAME, PROGRAM_VERSION } from "./identity.generated.js";

/**
 * The `reportingDescriptor.id` of the one result this file emits that is not a candidate.
 *
 * Not a rule id and not in any pack: every rule the bundle ships is `<pack>-<nnn>` and this is a
 * statement about the SCAN, so it is deliberately outside that shape. It is looked up by nothing —
 * `test-rules.ts` finds descriptors by rule id — and a bundle that ever shipped a rule with this id
 * would collide, which is why the id says what it is rather than borrowing a pack prefix.
 */
const COVERAGE_ID = "scan-coverage-unknown";

/**
 * The `reportingDescriptor.id` of the results that state what this scan read past.
 *
 * ONE id for every member rather than one id each, so a reader can dismiss the whole class in the
 * Security tab in one action, and so the alerts group under one heading. The member is in the
 * result's `partialFingerprints`, which is what GitHub matches an alert on across commits, so they
 * stay distinct alerts and none of them re-opens when the anchor file changes. (The model has FIVE
 * kinds of member and SEVEN members on an ordinary bundle, because the read scope contributes one
 * per class; this comment said "five" in both places until 2026-09-10.)
 *
 * WHY THESE ARE RESULTS AND NOT `toolExecutionNotifications` OR `run.properties`. The Security tab
 * shows results; it does not show notifications, and GitHub's supported-properties table lists
 * `properties.tags[]` and nothing else on a rule — a property bag is carried and never displayed.
 * A coverage limit nobody sees is the "no problems found" sentence in another form, which is what
 * the design forbids. `note` level rather than `warning`: not reading a test tree is not a defect in
 * the code, and the one existing `warning`-level statement about coverage (`scan-coverage-unknown`,
 * above) is about rules that established nothing, which is the stronger claim.
 */
const COVERAGE_LIMIT_ID = "coverage-limit";

/**
 * The `reportingDescriptor.id` of the one result that counts the places matching rules.
 *
 * No AI review runs where this file is written for code scanning, so a matched place is not a finding: one result per
 * place, at the rule's severity, was each place shown as an alert, which is a finding by another name, and code scanning
 * labels an alert "fixed" when a later analysis no longer contains it, which is the pass the design forbids the product to
 * imply. So by default the file holds the coverage statements and this ONE result, written at zero as well, with the
 * same id and location, so that it does not disappear while a team uploads. One result per place is behind
 * `--sarif-matches`, at `note`.
 */
const PLACES_ID = "places-wait-for-review";

/** The characters a segment of a result's `uri` keeps as they are: RFC 3986's `pchar` but the colon. */
const URI_SAFE = /[A-Za-z0-9._~!$&'()*+,;=@-]/;

/**
 * A path of the tree as a result's `artifactLocation.uri`, which SARIF 2.1.0
 * (3.10.2) makes a URI reference: in each segment (the scanner's paths are already `/`-separated, project-path.ts
 * `slashPath`, so a backslash is a character of a POSIX name and is encoded as `%5C`: rf11-fx4b-2026-11-09.md item 4,
 * FR5 item 3, where `src/x\..\..\package.json` read as `package.json`) every byte RFC 3986 does not
 * let a path segment hold as it is percent-encoded (`%`, `#`, `?`, a space, a line break, ESC, a bracket, every byte of a
 * non-ASCII character), and the colon too, so a first segment never reads as a scheme. A consumer that decodes the
 * reference gets the file's name back: a file named `%2e%2e%2f` cannot read as `../`, nor `a#b` as `a` with a fragment.
 */
export function sarifUri(path: string): string {
  return path
    .split("/")
    .map((seg) =>
      [...seg]
        .map((c) => (URI_SAFE.test(c) ? c : [...Buffer.from(c, "utf8")].map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`).join("")))
        .join(""),
    )
    .join("/");
}

/** How `toSarif` writes the matched places (index.ts passes them; the defaults are the design's). */
export interface SarifOptions {
  /** `--sarif-matches`: one result per counted place, at `note`. Off by default. */
  matches?: boolean;
  /** Which places count: on a comparison only those on lines it adds or changes (ci-check.ts `onChangedLines`). */
  counted?: (loc: FindingLocation) => boolean;
  /** "changed" where a comparison chose the places, else "tree". */
  scope?: "changed" | "tree";
  /** The file the one result sits on, at line 1: the workflow file that runs the step; else the scan's anchor. */
  noteAt?: string | null;
}

/**
 * Minimal SARIF 2.1.0 output, for CI annotations and interop with other scanners.
 *
 * ## What this file carries beyond the findings, and why it is not `results`
 *
 * The design decided that no output of this product may state that the scanned project has no problem,
 * is compliant, passed or is clean; the absence of a finding is `unknown`. That decision shipped
 * with the SARIF path untouched and named the gap as an open residual — **and gave a reason that is
 * false**: it said SARIF has no standard member meaning "this rule ran and found nothing, which is
 * not the same as clean". SARIF 2.1.0 §3.27.9 defines exactly that member. `result.kind` takes
 * `"open"` — *"The specified rule was evaluated, and the tool concluded that there was insufficient
 * information to decide whether a problem exists"* — and `"review"`, *"The result requires review by
 * a human user to decide if it represents a problem"*. The correction is recorded.
 *
 * **The spec-native shape is nevertheless unusable against the consumer this output exists for**,
 * for two independent reasons measured against GitHub's own documentation rather than assumed:
 *
 *  1. **GitHub code scanning does not implement `kind` at all.** Community discussion 65477, with a
 *     GitHub reply of 2023-09-26 placing it on a priority list, is still open; the reporter's file
 *     imports 657 alerts where `kind` would have produced 5. A `kind: "open"` result is therefore
 *     not shown as "unknown" — it is shown as an alert, i.e. as a problem that was found. That is
 *     the same untrue sentence as "no problems found", pointing the other way.
 *  2. **A result with no location is not merely dropped — it fails the whole upload.** SARIF
 *     §3.27.12 permits zero locations (NOTE 1, and EXAMPLE 1: *"If a C++ analyzer detects that no
 *     file defines a global function main, then that result cannot be associated with a file"*),
 *     which is exactly the shape of "this rule matched nothing anywhere". GitHub's ingestion API
 *     rejects it: *"Code Scanning could not process the submitted SARIF file: locationFromSarifResult:
 *     expected at least one location"* (codeql-action issues 1738 and 2459, the second dated
 *     2024-09-04 and titled after this very clause of the spec). Emitting one location-less result
 *     per silent rule would take a user's whole SARIF upload from "some alerts" to "no alerts".
 *
 * So the per-rule fact goes where this file already puts rule-level facts — the
 * `reportingDescriptor` property bag, beside `effective_date` and `data_categories`, for the reason
 * written against those two below: it describes the rule rather than any one occurrence of it. Every
 * rule the bundle ships now gets a descriptor, not only the ones that fired, so a SARIF reader can
 * see that a rule existed at all; `scan_state` says which of the three things happened to it.
 *
 * And because a property bag is carried but never displayed by GitHub — its supported-properties
 * table lists `properties.tags[]` and nothing else on a rule — the fact is ALSO stated as **one**
 * result that no consumer can miss, at `warning` level, with a location. One rather than N: N quiet
 * ones are either dropped (no location, and they take the upload with them) or displayed as N
 * problems that were never found.
 */
export function toSarif(f: Findings, rules: Rule[], opts: SarifOptions = {}): object {
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const counted = opts.counted ?? (() => true);
  const placeCount = f.candidates.reduce((n, c) => n + c.locations.filter(counted).length, 0);
  const onChanged = opts.scope === "changed";

  // The roster restricted to the rules this document describes. `toSarif` is called once with the
  // whole bundle (index.ts) and once with a single rule (test-rules.ts' plumbing assertion), and a
  // SARIF file that counted 55 silent rules while describing 1 would be stating a number about a
  // bundle the reader cannot see.
  const rosterRows: RuleWithoutCandidates[] = (f.rules_without_candidates ?? []).filter((r) =>
    ruleById.has(r.rule_id),
  );
  const rosterById = new Map(rosterRows.map((r) => [r.rule_id, r]));
  // Counted by `censusSilentRules`'s own predicates in scan.ts, over the restricted roster above.
  // This file used to re-derive the four populations with its own copies of those filters — a THIRD
  // copy of the same arithmetic, in the channel a CI consumer reads, kept in step with the other two
  // by nothing but coincidence. `censusRoster` exists so the restriction can be passed in: `toSarif`
  // is called once with the whole bundle and once with a single rule, so it cannot hand over a whole
  // `Findings` and let scan.ts read `rules_without_candidates` itself.
  const census = censusRoster(rosterRows);
  const notEvaluated = census.notEvaluated;
  const noSurface = census.noSurface;
  const gateSilenced = census.gated;
  // COUNTED FROM `matchedNothing`, NOT FROM `evaluated`. Until 2026-08-24 the coverage message's
  // second sentence was built from `census.evaluated`, which CONTAINS both `noSurface` and `gated`,
  // and the four clauses therefore did not add up: on a tree with all four populations non-empty
  // this result read "36 ran over this tree and matched nothing … 20 never ran … 2 of the rules that
  // ran were offered no file at all here … 1 did match their own patterns and were then silenced" —
  // 59 over a 56-rule bundle, with a rule that had matched counted into "matched nothing". `index.ts`
  // had been repaired for exactly this three days earlier and this channel, the one uploaded to
  // GitHub code scanning, was left counting the old way.
  const matchedNothing = census.matchedNothing;

  /**
   * The file the coverage result is anchored at.
   *
   * `scan_anchor` is one file this scan actually read, recorded by `runScan` for this purpose. The
   * candidate fallback is for a `Findings` written before that field existed, and it is a file the
   * scan read for the same reason. When there is neither — a caller that produced no candidate and
   * no anchor — the coverage result is NOT emitted, because the only alternative is a location-less
   * result, and reason 2 above says what that does to the reader's upload. That case is recorded in
   * an internal record as the one hole this change leaves open.
   */
  // WHERE A RESULT ABOUT THE WHOLE SCAN POINTS, and why it now has a third fallback.
  //
  // SARIF §3.27.12 permits a result with no location and GitHub's ingestion rejects the WHOLE
  // uploaded file for one, so a statement about the scan has to point somewhere real. Until
  // 2026-09-10 the somewhere was `scan_anchor` — the smallest path the walker offered a rule — or a
  // candidate's file, and both are absent in a state the read scope made ordinary: a tree the
  // default declines entirely (a repository of tests, the shape of `test:read-scope`'s empty-tree
  // case). Such a scan wrote a SARIF with no results at all, so the one output a code-scanning user
  // reads said nothing while the console and the JSON said the tree had not been read — found by
  // independent verification, 2026-09-10 (MATERIAL 2).
  //
  // The third fallback is a path the walk DECLINED, taken from `excluded_by_walker[].examples[]`,
  // smallest by code unit so it is the same file on every machine for the same tree — the rule
  // `scan_anchor` itself is chosen by (`scan.ts`). It is a real file in the repository and, for the
  // results that say what was not read, it is a member of the population they are about. Absent only
  // when the walk found nothing at all, where no honest location exists and no result is emitted.
  //
  // The examples are in the walker's SHOWN FORM (walk.ts `shownText`), where a backslash begins an escape: such a path
  // (a name that is not valid UTF-8, or one holding a backslash) is not the text of a file, so an example without one is
  // taken first, and one with a backslash only where there is no other (on Windows every nested path has one).
  const declinedAll = [...(f.excluded_by_walker ?? [])]
    .flatMap((e) => e.examples)
    .filter((p) => p !== "")
    .sort();
  const declinedExample = declinedAll.find((p) => !p.includes("\\")) ?? declinedAll[0];
  const anchor = f.scan_anchor?.file ?? f.candidates[0]?.locations[0]?.file ?? declinedExample;
  // The one result about the matched places sits on line 1 of the workflow file that runs the step (GitHub shows no
  // result without a location); outside GitHub Actions on the scan's anchor, like the coverage statements.
  const noteAt = opts.noteAt ?? anchor;
  const placesMessage =
    placeCount === 0
      ? `0 places match rules ${onChanged ? "on the changed lines" : "in this tree"}, which is not a clean result.`
      : `${placeCount} ${placeCount === 1 ? "place matches rules and waits" : "places match rules and wait"} for a review${onChanged ? " on the changed lines" : ""}; they are not findings.`;

  const coverageMessage = (): string => {
    const parts: string[] = [];
    parts.push(
      // The first sentence carries the whole claim, because it is the only one GitHub guarantees to
      // show: "Code scanning displays the message text as the title of the result. Only the first
      // sentence of the message will be displayed when visible space is limited." The wording is
      // `scan.ts`'s own console sentence rather than a second phrasing of it.
      `${rosterRows.length} of ${rules.length} rule(s) in this bundle produced no candidate in this tree, ` +
        `so this scan establishes nothing about them and is not a report that the project meets any standard.`,
    );
    // The four clauses PARTITION the roster: matchedNothing + gated + noSurface + notEvaluated is
    // exactly `rosterRows.length`, the number the first sentence states. Each is in its own unit,
    // and none is a correction of another — the shape `index.ts` and `scan.ts` now also use.
    if (matchedNothing.length > 0) {
      parts.push(
        `${matchedNothing.length} were offered at least one file in this tree and matched nothing — a detector ` +
          `that did not match is not evidence that the construct is absent, it may be spelled a way these ` +
          `patterns do not know.`,
      );
    }
    if (gateSilenced.length > 0) {
      parts.push(
        `${gateSilenced.length} did match their own patterns and were then silenced by a corroboration gate, ` +
          `so the construct is demonstrably in this tree.`,
      );
    }
    if (noSurface.length > 0) {
      parts.push(
        `${noSurface.length} were in scope but were offered no file at all here, so their silence is about ` +
          `this repository's layout and not about its code.`,
      );
    }
    if (notEvaluated.length > 0) {
      parts.push(
        `${notEvaluated.length} never ran, because answers in the ScanProfile put them out of scope before they ` +
          `read a line; check those answers against the project before accepting the silence.`,
      );
    }
    parts.push(
      `Each is named in tool.driver.rules with a scan_state property, and in rules_without_candidates in the ` +
        `findings JSON with what it was looking for.`,
    );
    parts.push(
      `This result is anchored at ${anchor} because SARIF requires a location on every result and GitHub code ` +
        `scanning rejects a result that has none; that file is not its subject.`,
    );
    return parts.join(" ");
  };

  // The rule-level statement of what happened to each rule in this run. Three values, because before
  // the design's correction all three were the same nothing: a rule that matched, a rule that read the tree and
  // matched nothing, and a rule the ScanProfile switched off.
  const firedRuleIds = new Set(f.candidates.map((c) => c.rule_id));
  const scanStateOf = (id: string): Record<string, unknown> => {
    const row = rosterById.get(id);
    // Derived from what the document actually says, in this order, and NOT from "it is not in the
    // roster, so it must have fired". A `Findings` written before the roster existed, or by a caller
    // that built one over a different rule set, would make that inference say "raised-candidates"
    // about a rule that raised nothing — the exact substitution of a comfortable default for an
    // unknown that the design is about. When neither half of the document mentions the rule, the
    // property is absent, and absent means "this document does not say".
    if (!row) return firedRuleIds.has(id) ? { scan_state: "raised-candidates" } : {};
    // Kept although `runScan` has not written this state since 2026-08-27 — a profile answer labels
    // a rule's output and no longer removes the rule. The eight pass-1 documents on disk are in the
    // old state, and a SARIF writer that could not describe a document written last week would be a
    // subtraction of its own.
    if (row.state === "not-evaluated") {
      return { scan_state: "not-evaluated", unmet_preconditions: row.unmet_preconditions };
    }
    return {
      scan_state: "evaluated-no-candidates",
      files_on_surface: row.files_on_surface,
      // The rule ran although the person's own answers put it out of scope, and raised no candidate.
      // Carried into the SARIF because a code-scanning consumer reads this and nothing else: without
      // it the row is indistinguishable from a rule nobody had any reason to doubt. Omitted when the
      // rule was in scope, so an absent property is "no declaration was overridden here" and never
      // "the declaration was checked".
      //
      // **It does NOT by itself mean the detector looked and found nothing**, and this comment said
      // it did until 2026-08-27. Which of the roster's three silences this row is, is read from the
      // two properties beside it: `files_on_surface` above zero with no
      // `matches_removed_by_corroboration` is the only shape that corroborates the declaration;
      // `files_on_surface: 0` means no file was offered to the rule at all; a non-zero removal count
      // means its own patterns DID match here, which is the opposite of a corroboration. The console
      // block built the same claim over all three and printed it beside `files 0 scanned` on an empty
      // directory (`scan.ts`, the declaration block).
      ...((row.declared_inapplicable_preconditions ?? []).length > 0
        ? { declared_inapplicable_preconditions: row.declared_inapplicable_preconditions }
        : {}),
      // Omitted rather than written as 0, on the roster's own terms: a rule whose gate never shut
      // makes no statement here and `0` would read as one.
      ...((row.matches_removed_by_corroboration ?? 0) > 0
        ? { matches_removed_by_corroboration: row.matches_removed_by_corroboration }
        : {}),
      // Carried only for the rules that produced nothing, which is the roster's own rule. For a rule
      // that fired, what it was looking for is on the lines it reported; for a rule that did not,
      // this sentence read backwards is the only statement of it a SARIF reader has.
      evidence_template: row.evidence_template,
    };
  };

  return {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            // package.json's, through identity.generated.ts:
            // the name keys a code-scanning alert, so it is the package's and changes with it everywhere at once.
            name: PROGRAM_NAME,
            informationUri: PROGRAM_HOMEPAGE,
            version: PROGRAM_VERSION,
            rules: [
              // Every rule the bundle shipped, in bundle order, not only the ones that fired. Until
              // 2026-08-19 this array held `[...new Set(f.candidates.map(c => c.rule_id))]`, so a
              // SARIF reader could not learn that a rule existed, let alone that it had run and
              // matched nothing — the same defect `findings.json` carried and the design closed there.
              ...rules.map((r) => {
                const id = r.id;
                const silent = rosterById.get(id);
                return {
                  id,
                  name: id,
                  shortDescription: { text: r?.title ?? id },
                  helpUri: r?.legal_basis?.[0]?.url,
                  properties: {
                    jurisdiction: r?.jurisdiction,
                    // `legal_basis` and `data_categories` are carried for a rule that RAISED
                    // candidates and omitted for one that produced nothing — the same split, for the
                    // same priced reason, as the roster in `findings.json`, which carries
                    // `evidence_template` and drops `context_questions` and `legal_basis`. Measured
                    // here rather than assumed: emitting the citation list for all 56 rules takes the
                    // demo tree's SARIF from 40 KB to 496 KB, of which 395 KB is `legal_basis`, for
                    // rules that reported nothing. A citation list is what an adjudicator needs for a
                    // candidate it is judging; for a rule that produced nothing the useful sentence is
                    // what it was looking for, and the citations ship whole in the bundle.
                    legal_basis: silent ? undefined : r?.legal_basis?.map((b) => b.cite),
                    rule_confidence: r?.rule_confidence,
                    // On the reportingDescriptor's property bag, beside the other rule-level facts,
                    // and deliberately NOT on each result. In SARIF a `reportingDescriptor` describes
                    // the rule and a `result` describes one occurrence of it, and the date is a
                    // property of the obligation rather than of any line: it is identical for every
                    // location the rule reports. Per-result placement would repeat one fact once per
                    // result — on one open-source repository that is 537 results against 21 rule
                    // descriptors — and would suggest to a reader that it varies between them.
                    // A property bag is also where a producer-defined value belongs, SARIF having no
                    // standard field for "the date this obligation starts to apply", so this is the
                    // idiomatic slot rather than a near-miss reuse of `fullDescription` or `help`.
                    //
                    // Undefined for the seven rules that declare no date, and `JSON.stringify` omits
                    // it, so the key is absent rather than null. A SARIF reader sees "this rule states
                    // no date", which is the true statement; it never sees a date this product made up.
                    effective_date: r?.effective_date,
                    // Same slot and the same reason as `effective_date` above: it describes the rule
                    // rather than any one occurrence of it, it is identical for every location the
                    // rule reports, and SARIF defines no standard member meaning "the kinds of data
                    // this rule is about", so the producer-defined property bag is where it belongs.
                    //
                    // Absent — not null and not `[]` — for the three rules that declare no list,
                    // because `JSON.stringify` omits an undefined property: a reader sees "this rule
                    // states nothing", never a list this product made up. A rule declaring `[]` emits
                    // `[]`, which is a different statement (the author considered it and named none).
                    //
                    // The rule author's own labels and not a validated taxonomy — the vocabulary is
                    // open, unnormalised and carries three spelling splits; scan.ts states the census
                    // in full. Carried by reference like `jurisdiction` two lines up, because this
                    // object is a projection built fresh on every call and serialised immediately;
                    // the candidate in scan.ts is accumulated and returned, so that one is copied.
                    //
                    // Omitted for a rule that produced nothing, on the terms set out at
                    // `legal_basis` above.
                    data_categories: silent ? undefined : r?.data_categories,
                    // What happened to this rule in THIS run. The one property here that is about
                    // the scan rather than about the rule, and it is here rather than on a result
                    // because for two of its three values there is no result and no location to
                    // hang it on — see this file's header.
                    ...scanStateOf(id),
                  },
                };
              }),
              ...(noteAt
                ? [
                    {
                      id: PLACES_ID,
                      name: PLACES_ID,
                      shortDescription: { text: "Places that match rules and wait for a review; they are not findings" },
                      fullDescription: {
                        text:
                          "No AI review ran where this file was written, so a place that matches a rule's patterns is not a " +
                          "finding. This one result counts them, and it is written at zero as well; it is not about the file " +
                          "it sits on. Findings come from the AI review in your own Claude Code scans.",
                      },
                      help: {
                        text:
                          "Do not read this as a defect in the file it sits on: GitHub code scanning shows no result without a " +
                          "location. One result per place is written only with --sarif-matches, at note level. If your team stops " +
                          "uploading this file, code scanning labels this result fixed; the label then means only that the uploads " +
                          "stopped.",
                      },
                      defaultConfiguration: { level: "note" },
                      properties: { scan_state: "places-wait-for-review" },
                    },
                  ]
                : []),
              // The descriptor for the coverage result below. Emitted only when there is a coverage
              // result, so a run in which every rule fired carries neither.
              ...(rosterRows.length > 0 && anchor
                ? [
                    {
                      id: COVERAGE_ID,
                      name: COVERAGE_ID,
                      shortDescription: {
                        text: "Rules that produced no candidate — this scan establishes nothing about them",
                      },
                      fullDescription: {
                        text:
                          "The absence of a finding is `unknown`, never `clean`. A detector that matched nothing " +
                          "has not established that the construct is absent; it has established that these patterns " +
                          "did not match this text. This result states how many of the bundle's rules produced " +
                          "nothing on this tree and why, and it is emitted on every scan that has such rules, " +
                          "including scans that produced no candidate at all.",
                      },
                      // `fullDescription.text` and `help.text` are here because GitHub's
                      // supported-properties table marks both Required on a reportingDescriptor and
                      // says it displays them beside the result — and this is the one result whose
                      // whole value is that the reader understands what it means. The 56 rule
                      // descriptors above carry neither; that predates this change and is recorded
                      // as a finding in an internal record rather than
                      // fixed here, because it would rewrite every descriptor in the file.
                      help: {
                        text:
                          "Do not read this as a defect in the anchored file. Open the findings JSON " +
                          "beside this SARIF and read `rules_without_candidates`: it names every rule that " +
                          "produced nothing, whether it ran at all, how many files it was allowed to read, " +
                          "and — in `evidence_template` — what it was looking for. For each rule whose " +
                          "silence is surprising for this product, search the repository yourself before " +
                          "accepting it. This result is emitted on every scan that has such rules; it does " +
                          "not go away by being triaged, and it is not a finding that anything is wrong.",
                      },
                      defaultConfiguration: { level: "warning" },
                      properties: { scan_state: "scan-coverage" },
                    },
                  ]
                : []),
              // The descriptor for the coverage-limit results below. Emitted whenever the document
              // carries the model and an anchor to hang a result on, which is every scan written
              // since 2026-09-10 — including one where every member is zero, because "nothing was
              // held back" is a statement about this tree and its absence is not.
              ...(f.coverage_limits && anchor
                ? [
                    {
                      id: COVERAGE_LIMIT_ID,
                      name: COVERAGE_LIMIT_ID,
                      shortDescription: {
                        text: "What this scan read past — the parts of this tree it did not read, and what would open them",
                      },
                      fullDescription: {
                        text:
                          "A scan reads less than the whole tree in five ways: four classes of path it is told " +
                          "not to read by default (test surfaces, vendored code, build output, documentation sites), paths it refuses " +
                          "by rule, files it cannot read as code, rules the run did not include, and rules that " +
                          "ran and produced nothing. Each is stated here with its count and with the option that " +
                          "lifts it where one exists. Nothing under a coverage limit is covered by any other " +
                          "result in this file.",
                      },
                      // Both are Required on a reportingDescriptor in GitHub's supported-properties
                      // table and both are displayed beside the alert, which is the whole value of
                      // these results: a count with no account of what it means is a number the
                      // reader dismisses.
                      help: {
                        text:
                          "Do not read this as a defect in the anchored file. Each result names one part of the " +
                          "tree this scan did not read and the flag that reads it — `--read tests`, " +
                          "`--read vendored`, `--read build`, or `--read all` for every class. The same block, " +
                          "with the per-file lists these results do not carry, is `coverage_limits` in the " +
                          "findings JSON beside this SARIF. These results are emitted on every scan; they do not " +
                          "go away by being triaged, and they are not a finding that anything is wrong.",
                      },
                      defaultConfiguration: { level: "note" },
                      properties: { scan_state: "coverage-limit" },
                    },
                  ]
                : []),
            ],
          },
        },
        // The whole model, for a consumer that reads the FILE rather than the Security tab — another
        // scanner's aggregator, a CI step, an archive. GitHub displays none of it, which is why the
        // five `note` results above exist beside it; this is not a second statement of the same
        // fact but the same object, carried once.
        ...(f.coverage_limits ? { properties: { coverage_limits: f.coverage_limits } } : {}),
        results: [
          // First, and before any candidate: a reader who stops after one result has read the half
          // of this document that cannot mislead them.
          //
          // `kind` is left absent, which SARIF §3.27.9 defines as `"fail"`, and `level` is
          // `"warning"`. That pairing is forced by the spec once the result has to be visible:
          // §3.27.10 says that if `kind` has any value other than `"fail"` then `level` "SHALL have
          // the value `none`", and §3.27.9 says that if `level` has any value other than `"none"`
          // then `kind` SHALL be `"fail"`. So `kind: "open"` — the honest word for this state, and
          // the one whose absence an earlier version wrongly asserted — costs the severity that makes a CI
          // consumer show it, and buys nothing back from a consumer that does not read `kind` at
          // all. What is claimed as `fail` is not a defect in the code: it is a defect in the
          // EVIDENCE, and the message says which in its first sentence.
          ...(rosterRows.length > 0 && anchor
            ? [
                {
                  ruleId: COVERAGE_ID,
                  level: "warning",
                  message: { text: coverageMessage() },
                  locations: [
                    {
                      physicalLocation: {
                        // No `region`: the statement is about the whole scan, and a line number
                        // would be an invented fact about a file that is only an anchor.
                        artifactLocation: { uri: sarifUri(anchor) },
                      },
                    },
                  ],
                  // `partialFingerprints`, not the `fingerprints` the candidates below carry: this
                  // is the member GitHub code scanning documents as the identity of an alert across
                  // commits and branches. A constant, so the alert survives the anchor file changing
                  // — otherwise GitHub computes an identity from the anchored line, which has
                  // nothing to do with what the result says, and every commit raises a new alert.
                  partialFingerprints: { "product/scan-coverage/v1": COVERAGE_ID },
                },
              ]
            : []),
          // WHAT THIS SCAN READ PAST — one `note`-level result per member, in model order, printed
          // from the member's own sentence and never re-worded here (read-scope.ts). Anchored at
          // `scan_anchor.file` for the reason the result above is: SARIF §3.27.12 permits a result
          // with no location and GitHub's ingestion rejects the whole uploaded file for one, so the
          // statement about the scan has to point somewhere and the only honest somewhere is a file
          // the scan really opened. The message says so, exactly as the other one does.
          //
          // EVERY MEMBER IS EMITTED, zero counts included. The alternative — emit only members with
          // something to report — would make "this scan does not check" and "there was nothing to
          // hold back" the same absence in the Security tab, which is the design's defect one layer
          // out from the one `scan-coverage-unknown` closes.
          ...(f.coverage_limits && anchor
            ? f.coverage_limits.limits.map((l) => ({
                ruleId: COVERAGE_LIMIT_ID,
                level: "note",
                message: {
                  text:
                    `${l.sentence} This result is anchored at ${anchor} because SARIF requires a location on ` +
                    `every result and GitHub code scanning rejects a result that has none; that file is not its subject.`,
                },
                locations: [
                  {
                    physicalLocation: {
                      artifactLocation: { uri: sarifUri(anchor) },
                    },
                  },
                ],
                // The MEMBER's id and not the anchor's, so the five results are five stable alerts:
                // GitHub computes an identity from the anchored line where none is given, and every
                // commit would then raise five new alerts about a tree nobody changed.
                partialFingerprints: { "product/coverage-limit/v1": l.id },
              }))
            : []),
          ...(noteAt
            ? [
                {
                  ruleId: PLACES_ID,
                  level: "note",
                  message: {
                    text:
                      `${placesMessage} This result sits on line 1 of ${noteAt} because GitHub code scanning shows no ` +
                      `result without a location; that file is not its subject.`,
                  },
                  locations: [
                    {
                      physicalLocation: {
                        artifactLocation: { uri: sarifUri(noteAt) },
                        region: { startLine: 1 },
                      },
                    },
                  ],
                  partialFingerprints: { "product/places-wait/v1": PLACES_ID },
                },
              ]
            : []),
          // One result per place only behind --sarif-matches, at `note` whatever the rule's severity:
          // a place is not a finding, and an `error` beside it reads as one.
          ...f.candidates.flatMap((c) =>
            (opts.matches === true ? c.locations.filter(counted) : []).map((loc) => ({
              ruleId: c.rule_id,
              level: "note",
              message: {
                // The contradiction is in the MESSAGE and not only in a properties bag, because a
                // properties bag is what a GitHub code-scanning reader does not see. Where the
                // person declared this rule's subject out of scope and the detector raised it
                // anyway, the one line the alert shows has to say so — otherwise the most valuable
                // thing this scan produced (2026-08-27) reaches a CI reader as an ordinary
                // candidate. It states the disagreement and resolves nothing: a fact about the
                // product is asked of the person.
                // "raised on its subject anyway — either the answer or the candidate is wrong"
                // stood here until 2026-08-27, and said two things the scan does not know (defects
                // D3 and D2). A location is a line that MATCHED A PATTERN; whether it is on the
                // rule's subject is layer 2's question, and this rule's own `evidence_template` is
                // often explicit that the match does not establish it. And the two-way choice is
                // false: the project's own harvest classes 8 of its 21 recorded cases as ones where
                // the declared answer is right and the candidate is legitimate at the same time —
                // an answer about the shipped product beside a line in tooling, or a rule whose
                // construct is wider than the question the person answered. The message now states
                // what was observed and hands the question over.
                text:
                  `${c.title ?? c.rule_id} — a place that matches this rule and waits for a review; not a finding and not a legal determination` +
                  ((c.declared_inapplicable_preconditions ?? []).length > 0
                    ? `. Your ScanProfile answers ${(c.declared_inapplicable_preconditions ?? []).join(" ")} ` +
                      `in a way that puts this rule out of scope, and this line matched this rule's patterns ` +
                      `anyway — read the line and say what it is; an answer that is right about the shipped ` +
                      `product and a line that is right about tooling, a fixture or a dependency can both ` +
                      `stand, and this scan decides neither`
                    : ""),
              },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: sarifUri(loc.file) },
                    region: { startLine: loc.start_line },
                  },
                },
              ],
              // THE GROUP'S ID, NOT THE CANDIDATE'S, AND THE DIFFERENCE ONLY EXISTS FOR A SPLIT
              // GROUP. GitHub code scanning matches an alert across runs on this value, so it is
              // an identity and not a label: an alert whose fingerprint moves closes and re-opens,
              // on a line nobody touched.
              //
              // `finding_id` was the right value while a candidate was always a whole group. Once
              // `splitOversizedGroups` divides one, a location's `finding_id` becomes a function of
              // how many locations sort BEFORE it inside its group — so adding one match earlier in
              // path order moves the identity of locations further down. Measured on one tree:
              // most of its results changed fingerprint the first time the split ran, and 2 of one
              // 141-location group's results moved again when a single match was added ahead of
              // them. `group_part.group_id` is the id the group had before the bound existed and
              // does not move when the split boundary does, so every result keeps exactly the
              // identity it had — verified at 0 of 1,242 changed against the frozen 2026-08-26 file.
              //
              // Two parts of one group therefore share a fingerprint, as the 253 results of one
              // candidate always did: this member has never been unique per result, and per-result
              // uniqueness is not what it is for.
              fingerprints: { "product/v1": c.group_part?.group_id ?? c.finding_id },
            })),
          ),
        ],
      },
    ],
  };
}

/* ------------------------------------------------------------------------------------------- *
 * GitHub code scanning's limits, and the split that keeps every result readable under them.
 * ------------------------------------------------------------------------------------------- *
 *
 * GitHub code scanning reads at most 5,000 results of one run, "prioritized by severity", and drops
 * the rest without saying so; it refuses a file over 10 MB gzip-compressed (docs.github.com, "SARIF
 * support for code scanning", limits table, read 2026-10-12). Severity order puts `note` last, so on
 * a large tree the results dropped first are exactly the coverage statements the design exists for:
 * one real tree gave 5,409 results, 5,088 of them `error` or `warning`, and all 313 `note` results would
 * have been cut (architecture review 2026-09-14, E-distribution-ux.md E13).
 *
 * THE LEVELS STAY AS THEY ARE. Raising the coverage statements to `warning` would change what they
 * say to every consumer, to buy room in one consumer's cut. Instead nothing is ever cut: a document
 * over either limit is written as several complete SARIF files, each under both limits, each with
 * its own `automationDetails.id` (GitHub's category: two uploads of one tool for one commit need
 * different ones), and the statements that are not candidates all go in the first. A document under
 * both limits is written exactly as before, byte for byte.
 */
export const GITHUB_RESULTS_PER_RUN = 5_000;
export const GITHUB_GZIP_BYTES_PER_FILE = 10 * 1024 * 1024;

export interface SarifPart {
  /** The file's text, as it is written. */
  text: string;
  results: number;
  gzipBytes: number;
}

export interface SarifSplit {
  parts: SarifPart[];
  totalResults: number;
  /** Why the document was split: over the result limit, over the size limit, both, or not split. */
  reason: "none" | "results" | "size" | "results-and-size";
}

const NOT_CANDIDATE_IDS = new Set([COVERAGE_ID, COVERAGE_LIMIT_ID, PLACES_ID]);

export function splitSarifForGithub(
  doc: object,
  limits: { results: number; gzipBytes: number } = { results: GITHUB_RESULTS_PER_RUN, gzipBytes: GITHUB_GZIP_BYTES_PER_FILE },
): SarifSplit {
  const whole = JSON.stringify(doc, null, 2);
  const run = (doc as { runs: { results: { ruleId?: string }[]; properties?: Record<string, unknown> }[] }).runs[0];
  const results = run.results;
  const wholeGzip = gzipSync(whole).length;
  const overResults = results.length > limits.results;
  const overSize = wholeGzip > limits.gzipBytes;
  if (!overResults && !overSize) return { parts: [{ text: whole, results: results.length, gzipBytes: wholeGzip }], totalResults: results.length, reason: "none" };

  // The statements lead the array (toSarif writes them first); they all stay in part 1.
  let lead = 0;
  while (lead < results.length && NOT_CANDIDATE_IDS.has(results[lead].ruleId ?? "")) lead++;
  const statements = results.slice(0, lead);
  const candidates = results.slice(lead);
  let perPart = limits.results;
  for (;;) {
    if (perPart <= statements.length) {
      throw new Error(`SARIF: cannot write the ${statements.length} coverage statement(s) in one file under ${limits.gzipBytes} gzip-compressed bytes`);
    }
    const chunks: { ruleId?: string }[][] = [statements.concat(candidates.slice(0, perPart - statements.length))];
    for (let i = perPart - statements.length; i < candidates.length; i += perPart) chunks.push(candidates.slice(i, i + perPart));
    const parts: SarifPart[] = chunks.map((chunk, i) => {
      const partRun = {
        ...run,
        // `part-<n>`, without the count: GitHub tracks alerts per category, and a category no longer
        // uploaded is a stale configuration whose alerts "stay open indefinitely" (docs.github.com, code scanning,
        // "Results different than expected"). With the count in it, a run that went from 4 parts to 5 left all four
        // earlier categories stale; without it, only the parts past a shrunken count go stale. `sarif_split.of` keeps the count.
        automationDetails: { id: `${PROGRAM_NAME}/part-${i + 1}/` },
        properties: {
          ...(run.properties ?? {}),
          sarif_split: {
            part: i + 1,
            of: chunks.length,
            results_in_part: chunk.length,
            results_in_scan: results.length,
            why: `GitHub code scanning reads at most ${limits.results} results of a run and refuses a file over ${limits.gzipBytes} gzip-compressed bytes; this scan's ${results.length} results are written as ${chunks.length} files, each read whole. Upload every one.`,
          },
        },
        results: chunk,
      };
      const text = JSON.stringify({ ...doc, runs: [partRun] }, null, 2);
      return { text, results: chunk.length, gzipBytes: gzipSync(text).length };
    });
    if (parts.every((p) => p.gzipBytes <= limits.gzipBytes)) {
      return { parts, totalResults: results.length, reason: overResults && overSize ? "results-and-size" : overResults ? "results" : "size" };
    }
    perPart = Math.floor(perPart / 2);
  }
}

/** The path part `n` (1-based) is written to: part 1 at `path`, part 2 at `<base>.part-2<ext>`, and so on. */
export function sarifPartPath(path: string, n: number): string {
  if (n === 1) return path;
  const dot = path.lastIndexOf(".");
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return dot > slash ? `${path.slice(0, dot)}.part-${n}${path.slice(dot)}` : `${path}.part-${n}`;
}
