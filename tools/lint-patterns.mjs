/**
 * The three prose lints and the detector-join lint, in one place.
 *
 * These patterns were written in `tools/build-bundle.mjs` and applied only to rule YAML. Pillar 2
 * adds prose surfaces that are read by the same agent and shown to the same user — a checklist of
 * statutory questions, a skill document, two agent instruction files — and they need the same
 * checks. Moving the patterns here rather than copying them is not tidiness: this repository has
 * already been bitten twice by a constant that existed in two places and drifted (the walker's
 * extension list, copied into `clause-cover.mjs`, went stale twice in one day and now imports the
 * compiled walker instead). A lint that disagrees with itself is worse than one lint.
 *
 * Nothing here changes what `build-bundle.mjs` enforces by way of the three prose lints — those
 * patterns are the same characters. The join lint at the foot of this file is new (work item #71)
 * and is a fourth check `build-bundle.mjs` runs at G0.
 */

import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";

/** Prompt-injection phrasing, in the languages rules have historically been authored in. */
export const INJECTION_PATTERN =
  /ignore (all )?(previous|prior|above)|disregard (the )?(previous|prior|above)|system prompt|you are now|new instructions:|システムプロンプト|以下の指示に従/i;

/**
 * Verdict language that is off-limits anywhere a human reads this product's output, in English and
 * in Japanese. Matched as whole phrases rather than bare words, so that legitimate wording such as
 * "lawful basis", "non-compliance candidate", or a citation containing "violation" is not caught.
 *
 * The scanner never concludes that the law has been broken. Pillar 2 makes that harder to hold to,
 * not easier: its output quotes the user's own published words back at them, which is a stronger
 * claim than flagging a line of code, and it has to stay a question.
 */
export const ASSERTION_PATTERN =
  /\b(is|are|was|were|becomes?) (clearly |plainly |definitely )?(illegal|unlawful|lawful|legal|compliant|non-?compliant)\b|\bviolates? (the )?(law|GDPR|regulation)|\b(is|are) (a |in )violation\b|\bguarantees? (legal )?compliance\b|\b(fully|100%) compliant\b|違法|適法/i;

/**
 * CJK, written as escapes so this file stays ASCII: Hangul jamo, CJK radicals, CJK symbols and
 * punctuation, kana, Hangul syllables, enclosed CJK, unified ideographs (including extension A),
 * compatibility ideographs, compatibility and fullwidth forms, and the supplementary-plane
 * ideograph extensions.
 */
export const CJK_PATTERN =
  /[\u{1100}-\u{11FF}\u{2E80}-\u{2EFF}\u{3000}-\u{303F}\u{3040}-\u{30FF}\u{3130}-\u{318F}\u{31C0}-\u{31FF}\u{3200}-\u{32FF}\u{3400}-\u{4DBF}\u{4E00}-\u{9FFF}\u{A960}-\u{A97F}\u{AC00}-\u{D7FF}\u{F900}-\u{FAFF}\u{FE30}-\u{FE4F}\u{FF00}-\u{FFEF}\u{20000}-\u{2FA1F}]/gu;

/**
 * Distinct CJK characters in `text`.
 *
 * A function rather than a bare `.test()` because CJK_PATTERN carries the `g` flag, which makes
 * `.test()` stateful: consecutive calls resume from `lastIndex` and the second one silently
 * returns false. That is exactly the shape of bug this file exists to prevent.
 */
export function cjkChars(text) {
  return [...new Set(String(text).match(CJK_PATTERN) ?? [])];
}

/** Flattens a parsed object into [dotted.path[i], string] pairs, one per string leaf. */
export function stringLeaves(value, path = "", out = []) {
  if (typeof value === "string") out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => stringLeaves(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) stringLeaves(v, path ? `${path}.${key}` : key, out);
  }
  return out;
}

/**
 * THE LANGUAGE CHECK'S EXEMPTIONS, the one list the bundle build (tools/build-bundle.mjs) and the self-scan of the
 * published tree both import. Rule assets ship in English; CJK is allowed only where a field holds the original words of something that is not ours to
 * translate, by the leaf path `stringLeaves` gives it, in the file it sits in:
 * - a rule's `legal_basis[].cite` (a law's name in its official form) and its detector PATTERN leaves (text matched
 *   against non-English source), named one by one: the `detector` subtree also holds prose, `cost_exempt[].reason` and
 *   `volume_exempt[].reason`, and a prose field added there later is checked without anyone extending this list;
 * - a shared word list's anchors and near-misses; a path-exclusion set's patterns;
 * - the penalty-tier table's `penalty_quotes[].quote`, a statute's own words quoted with its official source, and no
 *   other field of it (its `why`, `says` and `cite` are the table's own prose);
 * - nothing in a checklist or a gate;
 * - in any other structured file, a `pattern` or `patterns` leaf.
 * A mapping KEY is never exempt: a key is a name, and `cjkLeafHits` checks every key on the way to a leaf.
 */
const RULE_PATTERN_LEAF = /^detector\.(?:match|match_without|path_without|also_in_file|guard_missing|file_globs)\[\d+\]$/;
const RULE_VOCABULARY_LEAF = /^detector\.vocabulary\.[^.[\]]+\[\d+\]$/;
export function cjkExemptFor(rel) {
  if (/^rules\/packs\/.+\/rule\.ya?ml$/.test(rel)) return [/^legal_basis\[\d+\]\.cite$/, RULE_PATTERN_LEAF, RULE_VOCABULARY_LEAF];
  if (/^rules\/vocabulary\//.test(rel)) return [/\.anchors\[\d+\]$/, /\.near_misses(\.|\[)/];
  if (/^rules\/path-exclusions\//.test(rel)) return [/\.pattern$/, /\.patterns\[\d+\]$/];
  if (/^rules\/(checklists|gates)\//.test(rel)) return [];
  if (rel === "rules/penalty-tiers/penalty-tiers.yaml") return [/^regimes\[\d+\]\.penalty_quotes\[\d+\]\.quote$/];
  return [/(^|\.)patterns?(\[\d+\])?$/];
}

/**
 * Every place in a parsed structured file (`rel`, its path from the tree's root) where CJK stands outside the exemptions
 * of `cjkExemptFor`: one `{ path, chars }` per string leaf not exempt, and one per mapping key holding CJK (`path` is
 * then the key's own path, with ` (key)` after it). The bundle build and the public self-scan both call this, so the
 * two checks cannot disagree on what is exempt.
 */
export function cjkLeafHits(value, rel) {
  const exempt = cjkExemptFor(rel);
  const hits = [];
  const walk = (v, path) => {
    if (typeof v === "string") {
      if (exempt.some((re) => re.test(path))) return;
      const chars = cjkChars(v);
      if (chars.length) hits.push({ path, chars });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") {
      for (const [key, x] of Object.entries(v)) {
        const p = path ? `${path}.${key}` : key;
        const chars = cjkChars(key);
        if (chars.length) hits.push({ path: `${p} (key)`, chars });
        walk(x, p);
      }
    }
  };
  walk(value, "");
  return hits;
}

/**
 * Every run of whitespace, line breaks and no-break spaces included, as one space: the folding the
 * report applies before it prints rule text; SARIF and findings.json keep the text as written (`product/packages/cli/src/assemble-report.ts`, `oneLine`:
 * `s.replace(/\s+/g, " ")`). A literal block (`|`) keeps its line breaks as written, and every
 * remediation template is a hard-wrapped one, so a phrase wrapped across a line break, written with a
 * doubled space or with a no-break space reaches the reader as the phrase. `tools/build-bundle.mjs`
 * matches its injection and assertion phrases against folded text for that reason.
 */
export function foldWhitespace(text) {
  return String(text).replace(/\s+/g, " ");
}

/**
 * Run all three lints over the string leaves of `value`.
 *
 * `exempt` is a list of regular expressions over the dotted path. Deny by default: a prose field
 * added later is covered without anyone remembering to extend a list, and a new pattern-like field
 * false-positives loudly rather than going unchecked silently.
 *
 * Returns `[]` when clean; otherwise one message per offending leaf.
 */
export function lintStringLeaves(value, { label, assertionExempt = [], cjkExempt = [] } = {}) {
  const problems = [];
  for (const [path, text] of stringLeaves(value)) {
    const where = `${label ? `${label}: ` : ""}${path || "/"}`;

    if (INJECTION_PATTERN.test(text)) {
      problems.push(`${where} contains an instruction-override pattern — this text is read by an agent as data, never as instructions`);
      continue;
    }
    if (!assertionExempt.some((re) => re.test(path))) {
      const assertion = text.match(ASSERTION_PATTERN);
      if (assertion) {
        problems.push(
          `${where} asserts legality ("${assertion[0]}") — write "may not meet", "requires review", or a question`,
        );
        continue;
      }
    }
    if (!cjkExempt.some((re) => re.test(path))) {
      const chars = cjkChars(text);
      if (chars.length > 0) {
        const shown = chars.slice(0, 12).join("") + (chars.length > 12 ? "..." : "");
        problems.push(
          `${where} contains CJK characters (${shown}) — product-side prose is English (the project's English-first rule)`,
        );
      }
    }
  }
  return problems;
}

/* ------------------------------------------------------------------------- *
 * THE PERSON-FACING WORD LINT (added 2026-09-28).
 * ------------------------------------------------------------------------- *
 *
 * THE WORDS. What the product tells the person never says "illegal", "unlawful", "violates the law",
 * "compliant", "no problems found", "nothing to fix", "passed" or "clean": the scanner reports
 * candidates and open questions, never a verdict on the law and never an all-clear.
 * `FORBIDDEN_TO_THE_PERSON` is that list and the ONLY copy of it: `tools/build-bundle.mjs` holds rule,
 * checklist and gate text to it, and a test holds every report the program
 * assembles to it.
 *
 * THE DEFECT IT CLOSES. Until 2026-09-28 the list lived in a test alone, so
 * it held the program's own wording and nothing the program copies. Rule text reaches the person
 * copied, not composed: a rule's title heads each item of the report and each row of the console's
 * candidate list, its remediation template is printed as the proposed remediation, its evidence
 * template is printed for a rule nobody checked and fills a RoPA cell, and its citations travel whole
 * in findings.json and the SARIF file. Run 1's report printed "passed" twice from one copied title,
 * and five remediation templates told the person "there is nothing to fix here".
 *
 * WHICH FIELDS. Deny by default: every string leaf of a rule, a checklist and a gate is held to the
 * list, so a field added later is covered without anyone extending a list here. Three kinds of path
 * are not, and each one's hits are counted and printed by the build on every run, never dropped:
 *
 * - VERBATIM: text that is not the product's voice and is never rewritten. Detector patterns and
 *   vocabulary match the user's code (`report-illegal-content` is a spelling to find); a checklist's
 *   quotation fields are provision text, checked against their quotes files.
 * - NOT COPIED: product prose that no output of the product prints to the person. A rule's
 *   `provenance` is the authoring record: it ships inside rules.json and nothing reads it. A rule's
 *   `context_questions` go to the adjudicating agent (findings.json candidates, and the first one in
 *   the reconcile join) and no report line, console line, SARIF field or RoPA cell prints them. The
 *   checklist fields listed below go to the reconciling agent inside the reconcile input and are
 *   printed nowhere. They are exempt because nothing copies them to the person, not because their
 *   wording was judged; whether text an agent may relay should be held to the list as well was left
 *   open on 2026-09-28.
 * - QUOTED: inside a citation field (a rule's `legal_basis[].cite`, a checklist's `cite`), a hit
 *   between quotation marks is quoted provision text ('unauthorised or unlawful processing', GDPR
 *   Art. 5(1)(f)) and stays exactly as the provision wrote it. The quotation marks are the escape, and
 *   they sit in the text where a reviewer reads them, in the manner of `[lint:mention]` in
 *   a check; the build names every such hit on every run. Outside the quotation marks
 *   the same field is the product's voice, and there a statutory term containing a listed word is
 *   referred to by its provision instead ("content within Art. 3(h)" for the DSA's defined term).
 *   Quotation marks escape nothing in any other field.
 *
 * THE WORDS OF A PHRASE ARE JOINED BY `\s+`, NEVER BY A LITERAL SPACE. The lint
 * reads the text as parsed, where a literal block keeps its line breaks and a doubled or no-break
 * space stays as written; the report folds every run of whitespace into one space before printing
 * (`foldWhitespace` above). Until 2026-09-28 the three phrases were written with one literal space
 * each, and a phrase split across a line break of a remediation template, written with two spaces or
 * with a no-break space built green and printed as the phrase.
 * `personWordSelfTest` fails if any pattern of
 * the list holds a literal whitespace character, and plants every phrase with each gap as a line
 * break, a doubled space and a no-break space.
 */
export const FORBIDDEN_TO_THE_PERSON = [
  /\billegal\b/i,
  /\bunlawful\b/i,
  /violates\s+the\s+law/i,
  /\bcompliant\b/i,
  /no\s+problems\s+found/i,
  /nothing\s+to\s+fix/i,
  /\bpassed\b/i,
  /\bclean\b/i,
];

/**
 * THE HOUSE'S OWN WORDS, NEVER ON A LINE OF THE TERMINAL'S SCREENS.
 * A different list from
 * `FORBIDDEN_TO_THE_PERSON`, and not a copy of it: that one holds words that would state a verdict on the law or an
 * all-clear, and it is applied to rule, checklist and gate text and to every report; this one holds the words of the
 * product's own machinery (layer, candidate, seat, rule, pack, topic ...), which rule text and the reports' records use
 * correctly, and it is applied to the screens alone: a test holds the quick scan's screen to it
 * and a test the end of the run's screen. A token holding a "/" is a path and is not read.
 */
export const INTERNAL_WORDS_ON_SCREEN = [
  /\blayer\s*[12]\b/i,
  /\bcandidates?\b/i,
  /\bfinding\s+records?\b/i,
  /\bgroups?\b/i,
  /\bbins?\b/i,
  /\bpayloads?\b/i,
  /\bseats?\b/i,
  /\badjudicat/i,
  /\breaders?\b/i,
  /\brelay/i,
  /\borchestrat/i,
  /\blaunch/i,
  /violation_candidate|needs_human|not_applicable/i,
  /\brules?\b/i,
  /\bpacks?\b/i,
  /\btopics?\b/i,
  /\brun\s+shape/i,
  /refute_later/i,
  /\bsecond\s+check/i,
  /\bdeclarations?\b/i,
  /\bScanProfile\b/i,
  /\bpreconditions?\b/i,
  /\bjurisdictions?\b/i,
  /\bsilent\s+rules?\b/i,
  /\bcoverage\s+limits?\b/i,
  /\bread\s+scope\b/i,
];

/** Every hit of either list on one line of a screen, as `word` strings; tokens holding a "/" (paths) are not read. */
export function screenWordHits(line) {
  const text = String(line)
    .split(/(\s+)/)
    .map((t) => (t.includes("/") ? "" : t))
    .join("");
  const hits = [];
  for (const re of [...INTERNAL_WORDS_ON_SCREEN, ...FORBIDDEN_TO_THE_PERSON]) {
    const m = re.exec(text);
    if (m) hits.push(m[0]);
  }
  return hits;
}

/** Path classes over `stringLeaves` paths. A gate is checked with the checklist classes: its body sits under `applicability` exactly as it does once spliced into a checklist. */
export const PERSON_WORD_PATHS = {
  rule: {
    verbatim: [/^detector(\.|\[|$)/],
    notCopied: [/^provenance(\.|\[|$)/, /^context_questions\[\d+\]$/],
    citation: [/^legal_basis\[\d+\]\.cite$/],
  },
  checklist: {
    verbatim: [/(^|\.)quote$/],
    notCopied: [
      /^scope_note$/,
      /^items\[\d+\]\.(question|applicability_note)$/,
      /^applicability\.when_unresolved$/,
      /^applicability\.supporting_quotes\[\d+\]\.why$/,
      /^applicability\.limbs\[\d+\]\.note$/,
    ],
    citation: [/(^|\.)cite$/],
  },
};

/**
 * The spans of `text` inside quotation marks: "...", “...”, '...' and ‘...’. A single quote
 * opens only where no letter or digit precedes it and closes only where no letter or digit follows
 * it, so the apostrophe in "the provider's terms" neither opens nor closes a quotation.
 */
export function quotedSpans(text) {
  const spans = [];
  for (const re of [
    /"[^"]*"/g,
    /“[^”]*”/g,
    /(?<![\p{L}\p{N}])'(?:[^']|'(?=[\p{L}\p{N}]))*'(?![\p{L}\p{N}])/gu,
    /(?<![\p{L}\p{N}])‘(?:[^’]|’(?=[\p{L}\p{N}]))*’(?![\p{L}\p{N}])/gu,
  ]) {
    for (const m of String(text).matchAll(re)) spans.push([m.index, m.index + m[0].length]);
  }
  return spans;
}

/** Every hit of `FORBIDDEN_TO_THE_PERSON` in `text`, in text order, as `{ word, index }`. */
export function forbiddenWordHits(text) {
  const hits = [];
  for (const re of FORBIDDEN_TO_THE_PERSON) {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    for (const m of String(text).matchAll(global)) hits.push({ word: m[0], index: m.index });
  }
  return hits.sort((a, b) => a.index - b.index);
}

/**
 * Holds every string leaf of `value` (a rule, a checklist or a gate) to `FORBIDDEN_TO_THE_PERSON`.
 * `paths` is `PERSON_WORD_PATHS.rule` or `PERSON_WORD_PATHS.checklist`. Returns four lists of
 * `{ path, word, index, excerpt }`: `problems`, which fail the build, and `quoted`, `notCopied` and
 * `verbatim`, which the build counts and prints. `word` and `excerpt` are whitespace-folded, as the
 * report prints them.
 */
export function lintPersonFacingWords(value, paths) {
  const out = { problems: [], quoted: [], notCopied: [], verbatim: [] };
  for (const [path, text] of stringLeaves(value)) {
    const hits = forbiddenWordHits(text);
    if (hits.length === 0) continue;
    const exempt = paths.verbatim.some((re) => re.test(path))
      ? out.verbatim
      : paths.notCopied.some((re) => re.test(path))
        ? out.notCopied
        : null;
    const spans = !exempt && paths.citation.some((re) => re.test(path)) ? quotedSpans(text) : [];
    for (const { word, index } of hits) {
      const excerpt = `...${foldWhitespace(text.slice(Math.max(0, index - 60), index + word.length + 60))}...`;
      // The word as the person reads it: a phrase wrapped across a line break is named on one line.
      const row = { path, word: foldWhitespace(word), index, excerpt };
      if (exempt) exempt.push(row);
      else if (spans.some(([from, to]) => index >= from && index < to)) out.quoted.push(row);
      else out.problems.push(row);
    }
  }
  return out;
}

/* ------------------------------------------------------------------------- *
 * THE ABSENCE-CLAIM LINT ON A RULE'S TWO LINES (added 2026-11-06).
 * ------------------------------------------------------------------------- *
 *
 * A BEST-EFFORT NET, NOT A GUARANTEE.
 * It refuses the forms listed below and nothing else: a class of meaning cannot be closed by a list of words, and the
 * same absence or order said in other words passes (two checks, C5 and FC3, each found a dozen such forms after the
 * list was widened). Passing it says only that a line uses none of these forms. The words of every line it reads
 * are the owner's: every changed line goes to the owner's wording sheet and to a reading by someone who did not write
 * it, and that reading, not this lint, is what holds a line. It is not widened further; a form a reading finds is fixed
 * in the line.
 *
 * THE RULE IT HOLDS. WolfBoy reads one repository and nothing else, so the title of a finding card
 * (`problem_line.text`, `problem_line.template`) says what was checked - "not found", "named", "to confirm" - and never
 * that a thing does not exist: a consent platform, a TLS-terminating proxy, a support desk or a privacy notice can hold
 * it outside the code. On 2026-11-06 a word search found 14 of the 27 lines a reading of all 120 rules changed; the other
 * 13 said the same thing in other words ("not told", "get no", "with no", "unstated"). So this lint holds the class
 * in words of every form the fixer met, and refuses a new rule's line by default.
 *
 * WHAT IS REFUSED. In `short_name` (it titles a to-clarify finding), `problem_line.text` and `problem_line.template`,
 * every hit of `ABSENCE_CLAIMS`. In `fix_line`,
 * which instructs, only a hit that states a state: an entry marked `state` (missing, lacks, absent, nowhere, "no ...
 * exists", "gets no"), which describes a state whatever the sentence's mood ("Add the missing check" presumes the
 * absence), or any other entry with a state verb (is, are, has, stays ...) before it in its own clause. "Stop
 * redirecting without consent" and "keep no finer location than the purpose needs" instruct; "data is sent without
 * encryption" asserts.
 *
 * WHAT PASSES. A hit followed, in its own clause, by what was checked: "found" ("no consent check found", "not
 * found"), "named" ("no Art. 9 basis named") or "to confirm", with no preposition between the hit and that word (a
 * preposition hands the word to another noun: "Consent missing for the trackers found on the page" is refused). One
 * entry is held to the whole line instead: "before consent" passes only where the line says "found" anywhere. In a
 * fix line, also a hit in a clause that a condition or
 * an indirect question opens ("where it has no removal call, ...", "describe ... what stays unencrypted"). A clause ends
 * at a comma, a semicolon, a colon, a bracket, a dash or the full stop of a sentence ("Art. 9" does not end one).
 *
 * WIDENED 2026-11-06 (C5 fix unit, check record q2 section 4.2 and the parent's ruling): any negation ("not", "cannot",
 * a contraction), any un- word in -ed, failure verbs, "neither", place words ("outside", "beyond", "short of"), shortfall
 * words ("gap", "incomplete", "partial", "hidden"), "before consent", the narrower pass word and `short_name`.
 * WIDENED 2026-11-07 (C5 fix check, items 6-8): "before consent" in other words ("before the visitor consents", "before
 * a consent decision", "pre-consent", "before opt-in"); un- words in -able/-ible, "inaccessible", "invisible",
 * "indefinitely"; and two words of a legal conclusion on adequacy, "insufficient" and "inadequate", which no pass word
 * takes out (an entry marked `conclusion`).
 * WIDENED 2026-11-08 (C5 final check, item 6): the third list of forms in three checks, so the class instead. Any word
 * of the person's choice (consent, opt-in/opt-out, a banner, a choice, agreeing, refusing, declining, rejecting,
 * withdrawing) or of an order on the live page (on page load, with the page, immediately, as soon as) passes only
 * where the line says "found"; and words that say a thing happens unseen ("silently", "invisibly") or always
 * ("always", "unconditionally", "regardless", "forever", "permanently").
 *
 * THE EXCEPTIONS. `ABSENCE_CLAIM_EXCEPTIONS` is the only way past the lint: one row per rule id, field and phrase, each
 * with the reason the line was kept. A row excuses its own rule, field and phrase and nothing else, and the build refuses
 * a row that excused nothing over the real rule tree, so a stale row cannot later excuse a rewritten line. The words of
 * a phrase are joined by `\s+`, as in `FORBIDDEN_TO_THE_PERSON`.
 */
export const ABSENCE_CLAIMS = [
  { re: /\bmissing\b/i, state: true },
  { re: /\black(?:s|ing|ed)?\b/i, state: true },
  { re: /\babsen(?:t|ce)\b/i, state: true },
  { re: /\bnowhere\b/i, state: true },
  { re: /\bno\b[^,;:()]*?\bexists?\b/i, state: true },
  { re: /\b(?:does|do|did)\s+not\s+exist\b|\bnon-?existent\b/i, state: true },
  { re: /\b(?:gets?|got|receives?|received)\s+no\b/i, state: true },
  { re: /\bwith\s+no\b/i, state: false },
  { re: /\bwithout\b/i, state: false },
  {
    re: /\bnot\s+(?:been\s+|\w+ly\s+)?(?:told|disclosed|published|stored|shown|given|offered|provided|marked|label(?:l)?ed|recorded|kept|logged|asked|notified|informed|declared|documented|stated|encrypted|masked|gated|obtained|checked|verified|run|enforced|honou?red|applied|set|sent|signed)\b/i,
    state: false,
  },
  // Any un- word ending in -ed (unstated, unenforced, unauthenticated, unconfirmed ...) and four that do not; "under-",
  // "unified" and "united" are not absence words.
  { re: /\bun(?!der|ified\b|ited\b)[a-z]+ed\b|\bun(?:told|used|read|seen)\b/i, state: false },
  // C5 (2026-11-06, check record q2 section 4.2): forms the list above did not see, each probed on a line that passed.
  // A negation: "not" with any word ("not open", "not yet published", "not always encrypted"; "not found" passes as
  // below), "cannot" and a contraction ("isn't told", "can't withdraw").
  { re: /\bnot\b/i, state: false },
  { re: /\bcannot\b|\b[a-z]+n['\u2019]t\b/i, state: false },
  // A failure verb: "fails to reach", "omits the purpose", "skips the backups".
  { re: /\bfail(?:s|ed|ing)?\s+to\b|\bomit(?:s|ted|ting)?\b|\bskip(?:s|ped|ping)?\b/i, state: false },
  // "neither ... nor".
  { re: /\bneither\b/i, state: false },
  // A place word that states an absence: "outside erasure", "beyond the purge", "short of the duty".
  { re: /\boutside\b|\bbeyond\b|\bshort\s+of\b/i, state: false },
  // A shortfall word: "rights route gap", "export incomplete", "partial erasure", "opt-out hidden in the footer".
  { re: /\bgaps?\b|\bincomplete\b|\bpartial(?:ly)?\b|\bhidden\b/i, state: false },
  // An order on the live page that a gate outside the repository can change ("runs before consent"): it passes only
  // where the same line says "found", anywhere in it ("Pixel loads before consent; no consent gate found"). The parent's
  // ruling on C5's class C (q1 item 2). "before consent-based processing" is not this. Widened 2026-11-07 (C5 fix check
  // item 6) to the same order in other words, each probed on a line that passed: "before the visitor consents", "before
  // a consent decision", "pre-consent", "before opt-in".
  {
    re: /\b(?:before|prior\s+to|ahead\s+of)\s+(?:(?:the|a|an|any)\s+)?(?:consent\s+(?:decision|choice)s?\b|(?:visitors?|users?|persons?|people|customers?|(?:data\s+)?subjects?|they)\s+(?:ha(?:s|ve)\s+)?(?:consent(?:s|ed)?|opt(?:s|ed)?\s+in|agree[sd]?)\b|consent\b(?!-)|opt(?:ing)?(?:-|\s+)in\b)|\bpre-?consent\b/i,
    state: false,
    line: true,
  },
  // C5 fix check (2026-11-07, item 7): an un- word in -able or -ible ("unable to withdraw", "export unavailable",
  // "unreachable"), which the -ed entry above does not reach ("under-" is not one); the in- words of that shape that
  // state an absence ("records inaccessible", "notice invisible"); and "indefinite(ly)" ("data kept indefinitely"), which
  // says no expiry exists where a setting outside the repository can hold one.
  { re: /\bun(?!der)[a-z]*(?:able|ible)\b/i, state: false },
  { re: /\bin(?:accessible|visible)\b/i, state: false },
  { re: /\bindefinite(?:ly)?\b/i, state: false },
  // A LEGAL CONCLUSION on adequacy, not an absence (test 5 of check C5; C5 fix check item 7): "encryption insufficient",
  // "masking inadequate". Whether a measure is enough is for the review and the person to decide, and a line never says
  // it, so no pass word takes it out ("Insufficient encryption found" is refused); in a fix line it reads as a state
  // ("Replace the inadequate masking" presumes the conclusion), and only a condition opens it ("where the masking is
  // inadequate, ...").
  { re: /\binsufficient(?:ly)?\b|\binadequate(?:ly)?\b/i, state: true, conclusion: true },
  // C5 final check (2026-11-08, item 6): THE CLASS, not a fourth list of forms. A line about the person's choice - consent,
  // opt-in or opt-out, a banner, a choice, agreeing, refusing, declining, rejecting, withdrawing - or about an order on
  // the live page (on page load, with the page, immediately, as soon as) states what a consent platform, a tag manager
  // or a setting outside the repository can change ("Pixel fires regardless of consent", "Tracker loads ahead of the
  // banner", "Tag runs until the visitor opts out"). Any such word, in any wording, passes only where the same line says
  // "found", anywhere in it, as "before consent" above. "consent-based" is not this. Every current line that names one
  // already says "found", except four short names that title a topic (excepted below, each with its reason).
  {
    re: /\bconsent(?:s|ed|ing)?\b(?!-)|\bopt(?:s|ed|ing)?(?:-|\s+)?(?:in|out)\b|\bbanners?\b|\bchoices?\b|\bagree(?:s|d|ing|ments?)?\b|\brefus(?:e|es|ed|ing|als?)\b|\bdeclin(?:e|es|ed|ing)\b|\breject(?:s|ed|ing|ions?)?\b|\bwithdr[ae]w(?:s|n|ing|als?)?\b|\b(?:on|at)\s+(?:page\s+)?load\b|\bwith\s+the\s+page\b|\bimmediately\b|\bas\s+soon\s+as\b/i,
    state: false,
    line: true,
  },
  // The same check, item 6: a word that says the person is never shown it ("App silently shares contacts", "Data sent
  // invisibly"), where a notice outside the repository can tell them, and a word that says it always or forever happens
  // ("Pixel loads unconditionally", "Tracker always loads", "Data kept forever", "Logs kept permanently"), where a gate
  // or a deletion job outside the repository can bound it. They pass as the other entries do, on what was checked.
  { re: /\b(?:silently|quietly|secretly|covertly|surreptitiously|stealthily|invisibly)\b/i, state: false },
  {
    re: /\b(?:always|forever|permanent(?:ly)?|perpetu(?:al(?:ly)?|ity)|unconditional(?:ly)?|regardless|irrespective(?:ly)?)\b|\bin\s+all\s+cases\b|\bat\s+all\s+times\b|\bevery\s+time\b/i,
    state: false,
  },
  { re: /\bnever\b/i, state: false },
  { re: /\b(?:none|nobody|nothing)\b/i, state: false },
  { re: /\bno\b/i, state: false },
];

/**
 * What a line says it checked, after the hit and in its own clause. The pass word belongs to the hit's own noun phrase:
 * a preposition between the hit and the word hands the word to another noun ("Consent missing for the trackers found on
 * the page", "Data sent without encryption to the host named in config" are refused; C5, q2 section 4.2 item 10).
 * "of" stays inside the phrase ("no record of consent found"), and a word joined by a hyphen is not a preposition.
 */
const ABSENCE_CHECKED = /\bfound\b|\bnamed\b|\bto\s+confirm\b/i;
// A word joined by a hyphen is not a preposition ("sign-in", "opt-in", "add-on").
const OTHER_PHRASE = /(?<![\w-])(?:for|on|in|at|to|from|into|onto|by|via|with|within|across|through|over|under|behind|beside|after|before)(?![\w-])/i;
/** Whether `after` (the rest of the hit's clause) says what was checked about the hit's own noun phrase. */
function checkedAfter(after) {
  const m = ABSENCE_CHECKED.exec(after);
  return m !== null && !OTHER_PHRASE.test(after.slice(0, m.index));
}
/** A state verb before a fix line's hit, in its own clause: the line then asserts rather than instructs. */
const STATE_VERB = /\b(?:is|are|was|were|been|being|has|have|had|remains?|stays?|gets?|got|seems?|appears?)\b/i;
/**
 * A fix line's clause that opens with one of those verbs as an imperative ("below it, get parental consent", "stay
 * within the limit") instructs: the verb is read as a state verb only after a subject (C5 final check, 2026-11-08: the
 * consent entry met "get parental consent" in eu-minors-001's fix line).
 */
const IMPERATIVE_HEAD = /^\s*(?:(?:or|and|but|then)\s+)?(?:get|stay|remain|have)\b/i;
/** A fix line's clause opened by a condition or an indirect question states no fact. */
const FIX_OPENER = /^\s*(?:(?:or|and|but)\s+)?(?:where|wherever|if|when|whenever|unless|until|whether|what|which|who|whose)\b/i;
/** The end of a clause: a comma, a semicolon, a colon, a bracket, a dash, or a sentence's full stop. */
const CLAUSE_END = /[,;:()–—]|\s-\s|\.(?=\s+[A-Z]|\s*$)/g;
/** The fields this lint reads; `short_name` titles a to-clarify finding, so it is held as a problem line is. */
export const ABSENCE_CLAIM_FIELDS = ["short_name", "problem_line.text", "problem_line.template", "fix_line"];

/**
 * The lines kept on purpose, each read against its rule's context questions: rule id, field, the phrase as the lint
 * reports it (lower case, whitespace folded) and the reason. A kept line the lint does not catch gets no row: a row
 * that excuses nothing fails the build.
 */
export const ABSENCE_CLAIM_EXCEPTIONS = [
  {
    rule: "baseline-005",
    field: "problem_line.text",
    phrase: "without",
    reason:
      "'can be' states what the cookie's own Secure attribute, set on the matched line, permits (Q1, Q3); it does not say the cookie is sent so.",
  },
  {
    rule: "acting-as-subject-001",
    field: "problem_line.text",
    phrase: "absent",
    reason:
      "'absent' is the person, which is the rule's construct (title: 'while that person is absent or uninvolved'), not a missing thing.",
  },
  {
    rule: "eu-retention-001",
    field: "problem_line.text",
    phrase: "with no",
    reason:
      "'by default' scopes it to the shipped default written in the source, which Q3 says is what the finding is about.",
  },
  {
    rule: "eu-retention-001",
    field: "problem_line.template",
    phrase: "with no",
    reason: "As the problem line: 'by default' scopes it to the shipped default written in the source (Q3).",
  },
  {
    rule: "exposure-surface-002",
    field: "problem_line.text",
    phrase: "outside",
    reason:
      "'outside' is a place the program read in this repository, not an absence: the route's caller check is in the code and is not the product's own account model (a local OS endpoint checking a process path, a guard that steps aside when nothing is configured); a gate or proxy deployed elsewhere does not make it the product's own sign-in. C5 q3 passed the lines on tests 1 and 2 (Author R, kept).",
  },
  {
    rule: "exposure-surface-002",
    field: "problem_line.template",
    phrase: "outside",
    reason:
      "'outside' is a place the program read in this repository, not an absence: the route's caller check is in the code and is not the product's own account model (a local OS endpoint checking a process path, a guard that steps aside when nothing is configured); a gate or proxy deployed elsewhere does not make it the product's own sign-in. C5 q3 passed the lines on tests 1 and 2 (Author R, kept).",
  },
  {
    rule: "exposure-surface-002",
    field: "short_name",
    phrase: "outside",
    reason:
      "'outside' is a place the program read in this repository, not an absence: the route's caller check is in the code and is not the product's own account model (a local OS endpoint checking a process path, a guard that steps aside when nothing is configured); a gate or proxy deployed elsewhere does not make it the product's own sign-in. C5 q3 passed the lines on tests 1 and 2 (Author R, kept).",
  },
  {
    rule: "recipients-011",
    field: "problem_line.text",
    phrase: "no",
    reason:
      "'no one party' is the claim the rule tests, not a statement that something is absent.",
  },
  {
    rule: "acting-as-subject-001",
    field: "problem_line.text",
    phrase: "uninvolved",
    reason:
      "'uninvolved' is the person, the rule's construct (title: 'while that person is absent or uninvolved'), not a missing thing.",
  },
  {
    rule: "acting-as-subject-001",
    field: "short_name",
    phrase: "not",
    reason:
      "'not there' is the person, the rule's construct, as 'absent' in the problem line.",
  },
  {
    rule: "ai-prohibited-002",
    field: "problem_line.text",
    phrase: "untargeted",
    reason:
      "'untargeted' is the AI Act Art. 5(1)(e) term for the scraping this rule tests ('the untargeted scraping of facial images'), not an absence.",
  },
  {
    rule: "eu-consent-001",
    field: "short_name",
    phrase: "before consent",
    reason:
      "A short_name titles a to-clarify finding: 'may' puts the order on the live page as the question the finding leaves open, not as a fact; a to-fix finding is titled by the problem line, which says 'no consent gate found' (C5 class C).",
  },
  {
    rule: "eu-consent-002",
    field: "short_name",
    phrase: "before consent",
    reason:
      "A short_name titles a to-clarify finding: 'may' puts the order on the live page as the question the finding leaves open, not as a fact; a to-fix finding is titled by the problem line, which says 'no consent gate found' (C5 class C).",
  },
  {
    rule: "eu-consent-003",
    field: "short_name",
    phrase: "before consent",
    reason:
      "A short_name titles a to-clarify finding: 'may' puts the order on the live page as the question the finding leaves open, not as a fact; a to-fix finding is titled by the problem line, which says 'no consent gate found' (C5 class C).",
  },
  {
    rule: "eu-consent-004",
    field: "short_name",
    phrase: "before consent",
    reason:
      "A short_name titles a to-clarify finding: 'may' puts the order on the live page as the question the finding leaves open, not as a fact; a to-fix finding is titled by the problem line, which says 'no consent gate found' (C5 class C).",
  },
  {
    rule: "eu-consent-005",
    field: "short_name",
    phrase: "before consent",
    reason:
      "A short_name titles a to-clarify finding: 'may' puts the order on the live page as the question the finding leaves open, not as a fact; a to-fix finding is titled by the problem line, which says 'consent gate or full masking not found' (C5 class C; kept by Author R).",
  },
  {
    rule: "eu-consent-008",
    field: "short_name",
    phrase: "before consent",
    reason:
      "A short_name titles a to-clarify finding: 'may' puts the order on the live page as the question the finding leaves open, not as a fact; a to-fix finding is titled by the problem line, which says 'no consent gate found' (C5 class C).",
  },
  {
    rule: "eu-consent-015",
    field: "short_name",
    phrase: "before consent",
    reason:
      "A short_name titles a to-clarify finding: 'may' puts the order on the live page as the question the finding leaves open, not as a fact; a to-fix finding is titled by the problem line, which says 'no consent gate found' (C5 class C).",
  },
  {
    rule: "eu-dsr-008",
    field: "problem_line.text",
    phrase: "short of",
    reason:
      "'stop short of' says where this repository's own erasure and correction routine reaches against the event log in the same code (A2 section 13, C5 q2 kept).",
  },
  {
    rule: "eu-dsr-009",
    field: "problem_line.text",
    phrase: "not",
    reason:
      "'may not hold as stated' doubts a declared claim; it says nothing is absent.",
  },
  {
    rule: "eu-retention-001",
    field: "short_name",
    phrase: "with no",
    reason:
      "As the problem line: 'by default' scopes it to the shipped default written in the source (Q3).",
  },
  {
    rule: "recipients-011",
    field: "problem_line.text",
    phrase: "not",
    reason:
      "'may not hold' doubts the claim the rule tests; it says nothing is absent.",
  },
  {
    rule: "recipients-011",
    field: "short_name",
    phrase: "cannot",
    reason:
      "'cannot be rebuilt' quotes the claim the rule tests, not a statement about the code.",
  },
  {
    rule: "recipients-012",
    field: "problem_line.text",
    phrase: "cannot",
    reason:
      "'cannot read what it stores' quotes the claim the rule tests, and 'may overstate' doubts it.",
  },
  {
    rule: "recipients-012",
    field: "short_name",
    phrase: "cannot",
    reason:
      "'cannot read what it stores' quotes the claim the rule tests, not a statement about the code.",
  },
  {
    rule: "remote-actuation-002",
    field: "short_name",
    phrase: "hidden",
    reason:
      "'a hidden mode' is the rule's construct (title: 'with a mode that hides it from them'), a feature in the code, not a missing thing.",
  },
  {
    rule: "eu-consent-016",
    field: "short_name",
    phrase: "consent",
    reason:
      "A topic title (C5 final check item 6): it names what the to-clarify finding asks about, the consent record of who agreed to what and when, and states no order, effect or absence on the live page.",
  },
  {
    rule: "eu-consent-016",
    field: "short_name",
    phrase: "agreed",
    reason:
      "As the row above: 'who agreed' names a field of the record asked about, not something said to happen.",
  },
  {
    rule: "eu-consent-017",
    field: "short_name",
    phrase: "consent",
    reason:
      "A topic title (C5 final check item 6): it names what the to-clarify finding asks about, an equally easy way to withdraw consent once given, and states no order, effect or absence on the live page.",
  },
  {
    rule: "eu-consent-017",
    field: "short_name",
    phrase: "withdraw",
    reason:
      "As the row above: 'a way to withdraw it' names the route asked about, not something said to happen.",
  },
  {
    rule: "eu-consent-018",
    field: "short_name",
    phrase: "opt-in",
    reason:
      "A topic title (C5 final check item 6): it names the two subjects the to-clarify finding asks about, marketing opt-in and opt-out, and states no order, effect or absence.",
  },
  {
    rule: "eu-consent-018",
    field: "short_name",
    phrase: "opt-out",
    reason:
      "As the row above: 'opt-out' names the second subject asked about, not something said to happen.",
  },
  {
    rule: "eu-minors-001",
    field: "short_name",
    phrase: "consent",
    reason:
      "A topic title (C5 final check item 6): it names the subjects the to-clarify finding asks about, an age check and parental consent at sign-up, and states no order, effect or absence.",
  },
];

/** Every hit of `ABSENCE_CLAIMS` in `text`, a hit inside a longer one dropped, as `{ phrase, index, end, state, line, conclusion, entry }`. */
export function absenceClaimHits(text) {
  const hits = [];
  ABSENCE_CLAIMS.forEach(({ re, state, line, conclusion }, entry) => {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    for (const m of String(text).matchAll(global)) {
      hits.push({
        phrase: foldWhitespace(m[0]).toLowerCase(),
        index: m.index,
        end: m.index + m[0].length,
        state,
        line: line === true,
        conclusion: conclusion === true,
        entry,
      });
    }
  });
  hits.sort((a, b) => a.index - b.index || b.end - a.end);
  const kept = [];
  for (const h of hits) if (!kept.some((k) => h.index >= k.index && h.end <= k.end)) kept.push(h);
  return kept;
}

/** The text of the clause around `[from, to)`, before and after the hit. */
function clauseAround(text, from, to) {
  let start = 0;
  let end = text.length;
  for (const m of text.matchAll(CLAUSE_END)) {
    if (m.index + m[0].length <= from) start = m.index + m[0].length;
    else if (m.index >= to) {
      end = m.index;
      break;
    }
  }
  return { before: text.slice(start, from), after: text.slice(to, end) };
}

/**
 * Holds a rule's `problem_line.text`, `problem_line.template` and `fix_line` to `ABSENCE_CLAIMS`. Returns
 * `{ problems, excused }`, rows `{ field, phrase, index, line }`; an excused row also carries `exception`, its index in
 * `exceptions` (by default `ABSENCE_CLAIM_EXCEPTIONS`), so the build can refuse a row that excused nothing.
 */
export function lintAbsenceClaims(rule, exceptions = ABSENCE_CLAIM_EXCEPTIONS) {
  const out = { problems: [], excused: [] };
  const values = {
    short_name: rule?.short_name,
    "problem_line.text": rule?.problem_line?.text,
    "problem_line.template": rule?.problem_line?.template,
    fix_line: rule?.fix_line,
  };
  for (const field of ABSENCE_CLAIM_FIELDS) {
    const text = values[field];
    if (typeof text !== "string") continue;
    for (const h of absenceClaimHits(text)) {
      const { before, after } = clauseAround(text, h.index, h.end);
      if (!h.conclusion && (h.line ? /\bfound\b/i.test(text) : checkedAfter(after))) continue;
      if (field === "fix_line" && (FIX_OPENER.test(before) || (!h.state && !STATE_VERB.test(before.replace(IMPERATIVE_HEAD, ""))))) continue;
      const row = { field, phrase: h.phrase, index: h.index, line: text };
      const exception = exceptions.findIndex((x) => x.rule === rule?.id && x.field === field && x.phrase === h.phrase);
      if (exception >= 0) out.excused.push({ ...row, exception });
      else out.problems.push(row);
    }
  }
  return out;
}

/**
 * THE CORRECTED-WORDING GUARD (C5 final check, 2026-11-08). Wording a non-author check found wrong, which no rule text,
 * seat or source may say again. Each row is the test that failed before its fix and passes after it. A row with `fields`
 * reads only those fields of a rule (a fix line has no room for the allowance its remediation carries, so "rather than
 * mark" there closes the two-stage design the remediation allows); a row without reads every string leaf of every rule
 * and every file of `CORRECTED_WORDING_FILES`. A row with `rules` reads only the rules it names (and no file): the same
 * words can be right on another rule's card. Whitespace is folded before matching.
 */
export const CORRECTED_WORDING = [
  {
    re: /\bshow\s+only\s+consenting\s+adults\b/i,
    fields: ["fix_line"],
    why: "point (ba) reaches identifiable people only; a generator of fictional adults is told to remove a lawful feature (C5 final check item 1)",
  },
  {
    re: /\berase\s+rather\s+than\s+mark\b/i,
    fields: ["fix_line"],
    why: "the remediation allows mark now, remove later by a scheduled job (C5 final check item 3)",
  },
  {
    re: /\bfor\s+whoever\s+runs\s+the\s+software,?\s+the\s+publisher\s+is\s+an\s+outside\s+recipient\b|\boutside\s+recipient\s+for\s+whoever\s+runs\s+the\s+software\b/i,
    why: "false where the publisher runs the code as its own hosted service: a controller does not disclose to itself (C5 final check item 2)",
  },
  {
    re: /\bpublisher's\s+own\s+service\s+is\s+a\s+disclosure\s+to\s+an\s+outside\s+recipient(?!\s+for\s+anyone\s+other\s+than\s+the\s+publisher)/i,
    why: "as the row above (C5 final check item 2)",
  },
  {
    re: /\breaches\s+people\s+beyond\s+the\s+person\b/i,
    why: "Art. 25(2), third sentence, reaches an indefinite number of natural persons, not a defined group (C5 final check item 4)",
  },
  {
    // The card's own sentence, after FXR's
    // fix of the question and the seat: an unqualified "record this service as a recipient" opens the card.
    re: /^\s*record\s+this\s+(?:payment\s+)?service\s+as\s+a\s+recipient\b/i,
    fields: ["fix_line"],
    // Every self-name rule's card (own-name.ts SELF_NAME_RULES).
    rules: ["recipients-001", "recipients-002", "recipients-004", "recipients-005", "recipients-006"],
    why: "tells a publisher running its own hosted service to record itself as a recipient; a controller does not disclose to itself (C5 final check item 2, the card)",
  },
  {
    // A self-name card that opens "Unless you
    // publish and host it" names nothing before its pronoun: the reader supplies the nearest referent, their own product.
    re: /\bunless\s+you\s+publish\s+and\s+host\s+(?:it|them)\b/i,
    fields: ["fix_line"],
    rules: ["recipients-001", "recipients-002", "recipients-004", "recipients-005", "recipients-006"],
    why: "the card's exception has no referent, so a person who publishes and hosts their own product reads it as theirs and records no recipient (FR3 item 3)",
  },
  {
    // A comma after the consent clause
    // joins "none looking under 18" to "real people", as if point (bb) reached real people only.
    re: /\bonly\s+on\s+explicit\s+consent\s*,\s*none\s+looking\s+under\s+18\b/i,
    fields: ["fix_line"],
    why: "point (bb) reaches any person appearing to be a child, real or not; a comma makes the line read as about real people only (FC3 item 6)",
  },
];
/** The files outside the rule tree that `CORRECTED_WORDING` reads, from the repository root. */
export const CORRECTED_WORDING_FILES = ["product/plugin/agents/legal-adjudicator.md", "product/packages/cli/src/own-name.ts"];
/** Every row of `CORRECTED_WORDING` that `leaves` (`[path, text]` pairs, as `stringLeaves` gives) says again. */
export function correctedWordingProblems(leaves, ruleId = undefined) {
  const out = [];
  for (const [path, text] of leaves) {
    const field = path.replace(/[.[].*$/, "");
    for (const row of CORRECTED_WORDING) {
      if (row.fields && !row.fields.includes(field)) continue;
      if (row.rules && !(typeof ruleId === "string" && row.rules.includes(ruleId))) continue;
      const m = row.re.exec(foldWhitespace(text));
      if (m) out.push({ path, phrase: m[0], why: row.why });
    }
  }
  return out;
}
function correctedWordingSelfTest() {
  const failures = [];
  const said = (leaves, ruleId) => correctedWordingProblems(leaves, ruleId).map((p) => `${p.path}:${p.phrase.toLowerCase()}`).join(" | ");
  for (const [leaves, want, ruleId] of [
    [[["fix_line", "From 2 Dec 2026: show only consenting adults; act on misuse."]], "fix_line:show only consenting adults"],
    [[["fix_line", "Erase rather than mark; tell recipients."]], "fix_line:erase rather than mark"],
    [[["remediation_template", "Erase rather than mark,\n  or mark now and remove later."]], ""],
    [[["context_questions[1]", "is one, because for whoever runs the software the publisher is an outside recipient."]], "context_questions[1]:for whoever runs the software the publisher is an outside recipient"],
    [[["file", "For whoever runs the software, the publisher is an outside recipient."]], "file:for whoever runs the software, the publisher is an outside recipient"],
    [[["file", "a call to the publisher's own service is a disclosure to an outside recipient."]], "file:publisher's own service is a disclosure to an outside recipient"],
    [[["file", "a call to the publisher's own service is a disclosure to an outside recipient for\n  anyone other than the publisher running its own hosted service."]], ""],
    [[["remediation_template", "who can connect reaches people\n  beyond the person, change it"]], "remediation_template:reaches people beyond the person"],
    [[["fix_line", "From 2 Dec 2026: show real people only on explicit consent, none looking under 18."]], "fix_line:only on explicit consent, none looking under 18"],
    [[["fix_line", "From 2 Dec 2026: show real people only on explicit consent; none looking under 18."]], ""],
    [[["fix_line", "Record this service as a recipient of personal data, with what it receives and which company you contract with."]], "fix_line:record this service as a recipient", "recipients-006"],
    [[["fix_line", "Unless you publish and host this service, record it as a recipient: what it receives and the company you contract with."]], "", "recipients-006"],
    [[["fix_line", "Record this service as a recipient of personal data, with what it receives and which company you contract with."]], "fix_line:record this service as a recipient", "recipients-002"],
    [[["fix_line", "Record this payment service as a recipient of personal data."]], "fix_line:record this payment service as a recipient", "recipients-001"],
    [[["fix_line", "Record this service as a recipient, with its company."]], "fix_line:record this service as a recipient", "recipients-004"],
    [[["fix_line", "Unless you publish and host it, record it as a recipient: its company, what it gets, where it is established, its role."]], "fix_line:unless you publish and host it", "recipients-004"],
    [[["fix_line", "Unless you publish and host this identity service, record it as a recipient: its company, data, where established, role."]], "", "recipients-004"],
    [[["fix_line", "Record this service as a recipient of personal data, with what it receives and which company you contract with."]], "", "recipients-010"],
    [[["file", "Record this service as a recipient of personal data."]], ""],
  ]) {
    const got = said(leaves, ruleId);
    if (got !== want) failures.push(`corrected wording: expected [${want}], got [${got}] for ${JSON.stringify(leaves)}`);
  }
  return failures;
}

/**
 * The absence-claim lint's cases, run inside `personWordSelfTest` (the person-facing word lint's test, which the build
 * runs before any rule is read). Synthetic rules only, for the reason that function gives.
 */
function absenceClaimSelfTest() {
  const failures = [];
  const got = (rows) => rows.map((r) => `${r.field}:${r.phrase}`).join(" | ");
  const check = (label, rule, problems, excused = [], exceptions = undefined) => {
    const res = lintAbsenceClaims(rule, exceptions);
    if (got(res.problems) !== problems.join(" | ") || got(res.excused) !== excused.join(" | ")) {
      failures.push(
        `absence claims, ${label}: expected problems [${problems.join(" | ")}] and excused [${excused.join(" | ")}], got [${got(res.problems)}] and [${got(res.excused)}]`,
      );
    }
    return res;
  };
  const title = (text, id = "self-test") => ({ id, problem_line: { text }, fix_line: "Record it." });

  // Each phrasing is refused in a problem line, and every entry of the list is the source of at least one refusal.
  const PLANTS = [
    ["Consent gate missing", "consent", "missing"],
    ["Sign-up lacks an age check", "lacks"],
    ["Sign-up lacking an age check", "lacking"],
    ["Notice absent from the page", "absent"],
    ["Retention period stated nowhere", "nowhere"],
    ["No consent record exists for the cookie", "no consent record exists"],
    ["Consent record does not exist", "consent", "does not exist"],
    ["Restricted users get no statement of reasons", "get no"],
    ["Personal data with no rights-request route", "with no"],
    ["Personal data with no rights-request route", "with no"],
    ["Data sent without encryption", "without"],
    ["Chat users not told they talk to an AI", "not told"],
    ["AI-made images not disclosed as AI-made", "not disclosed"],
    ["Disclosure policy not published", "not published"],
    ["Consent decision not stored", "consent", "not stored"],
    ["Database retention period unstated", "unstated"],
    ["Consent never asked before tracking", "consent", "never"],
    ["None of the inputs masked", "none"],
    ["No consent check before the tracking cookie", "no", "consent"],
    // C5 (2026-11-06): the forms check record q2 section 4.2 found passing, one refused line each.
    ["Erasure does not reach the search index", "not"],
    ["Export not available to customers on the free plan", "not"],
    ["Privacy notice not yet published", "not"],
    ["People cannot withdraw consent once given", "cannot", "withdraw", "consent"],
    ["User isn't told about the transfer", "isn't"],
    ["Retention period unenforced", "unenforced"],
    ["Deletion fails to reach the backups", "fails to"],
    ["Consent form omits the purpose", "consent", "omits"],
    ["Neither consent nor notice before tracking", "neither", "consent"],
    ["Copy of personal data outside erasure and expiry", "outside"],
    ["Erasure stops short of the event log", "short of"],
    ["Rights route gap in reach and timing", "gap"],
    ["Data export incomplete", "incomplete"],
    ["Opt-out link hidden in the footer", "opt-out", "hidden"],
    ["Meta Pixel runs before consent", "before consent"],
    // C5 fix check (2026-11-07) item 8: the alternations above with no refused line of their own.
    ["Erasure skips the backups", "skips"],
    ["Copies beyond the purge kept", "beyond"],
    ["Partial erasure of the account", "partial"],
    ["Recipients untold to the person", "untold"],
    ["Consent records unused by the gate", "consent", "unused"],
    ["Withdrawal requests unread by the route", "withdrawal", "unread"],
    ["Privacy notice unseen before sign-up", "unseen"],
    ["Meta Pixel runs prior to consent", "prior to consent"],
    ["Meta Pixel runs ahead of consent", "ahead of consent"],
    // C5 fix check (2026-11-07) items 6 and 7: the forms it found passing, one refused line each.
    ["Pixel fires before the visitor consents", "before the visitor consents"],
    ["Tag loads before a consent decision", "before a consent decision"],
    ["Tracker loads pre-consent", "pre-consent"],
    ["Script runs before opt-in", "before opt-in"],
    ["Person unable to withdraw consent", "unable", "withdraw", "consent"],
    ["Export unavailable to the person", "unavailable"],
    ["Records inaccessible to the person", "inaccessible"],
    ["Notice invisible on small screens", "invisible"],
    ["Data kept indefinitely", "indefinitely"],
    ["Encryption insufficient for the data", "insufficient"],
    ["Masking inadequate on replay", "inadequate"],
    // C5 final check (2026-11-08) item 6, the class: a line about the person's choice (consent, opt-in or opt-out, a
    // banner, a choice, agreeing, refusing, declining, rejecting, withdrawing) or about an order on the live page (on
    // page load, with the page, immediately, as soon as), and a line that says something always, forever or unseen
    // happens. One refused line for each alternation; a row may name more than one refused phrase, in order.
    ["Pixel fires regardless of consent", "regardless", "consent"],
    ["Data shared irrespective of the setting", "irrespective"],
    ["Tag ignores the consent choice", "consent", "choice"],
    ["Tag fires after the visitor declines", "declines"],
    ["Tag runs after the visitor refuses", "refuses"],
    ["Tag runs after a reject-all click", "reject"],
    ["Tag runs once the visitor agrees", "agrees"],
    ["Tracker loads ahead of the banner", "banner"],
    ["Tag runs until the visitor opts out", "opts out"],
    ["Pixel loads even after opt-out", "opt-out"],
    ["Tracking goes on after withdrawal", "withdrawal"],
    ["Cookie set on page load", "on page load"],
    ["Tracker loads with the page", "with the page"],
    ["Pixel fires immediately", "immediately"],
    ["Tag runs as soon as the page opens", "as soon as"],
    ["App silently shares contacts", "silently"],
    ["Data sent invisibly to the vendor", "invisibly"],
    ["Pixel loads unconditionally", "unconditionally"],
    ["Tracker always loads", "always"],
    ["Data kept forever", "forever"],
    ["Logs kept permanently", "permanently"],
    ["Data kept in perpetuity", "perpetuity"],
    ["Pixel fires every time", "every time"],
    ["Cookie set in all cases", "in all cases"],
  ];
  const entries = new Set();
  for (const [text, ...phrases] of PLANTS) {
    check(`"${text}"`, title(text), phrases.map((phrase) => `problem_line.text:${phrase}`));
    for (const h of absenceClaimHits(text)) entries.add(h.entry);
  }
  ABSENCE_CLAIMS.forEach(({ re }, i) => {
    if (!entries.has(i)) failures.push(`absence claims: ${re} has no planted line in this self-test; add one`);
    if (/\s/.test(re.source)) failures.push(`absence claims: ${re} holds a literal whitespace character; join words by \\s+`);
    if (!re.flags.includes("i")) failures.push(`absence claims: ${re} is not case-insensitive`);
  });
  check("a template", { id: "self-test", problem_line: { text: "Data sent", template: "{data} sent without encryption" }, fix_line: "Record it." }, [
    "problem_line.template:without",
  ]);

  // A line that says what was checked passes; the word must follow the hit in its own clause.
  for (const text of [
    "Session recording: consent gate or input masking not found",
    "Data sent over a connection with no encryption found",
    "Health data processed with no Art. 9 basis named",
    "Consent banner offers Accept; no equal Refuse found",
    "Data kept with no expiry period to confirm",
  ]) {
    check(`"${text}"`, title(text), []);
  }
  check("a check named in another clause", title("Consent missing, notice not found"), ["problem_line.text:missing"]);
  check("a check named before the hit", title("Named vendor: consent missing"), ["problem_line.text:consent", "problem_line.text:missing"]);
  // C5 (2026-11-06), one allowed line for each new form: what was checked, in the hit's own phrase.
  for (const text of [
    "Erasure not found to reach the search index",
    "Consent record: unsigned entries found",
    "Personal records: no sign-in found, unlike sibling routes",
    "No record of consent found",
    "Copy of personal data: erasure or expiry for it not found",
    "Meta Pixel runs before consent; no consent gate found",
    "Age check before consent-based processing",
    "Unified profile API called on sign-in",
    "Underlined link text in the footer",
    // C5 fix check (2026-11-07) item 8: an allowed line for the alternations that had none.
    "Consent forms that omit the purpose found on two pages",
    "Copies beyond the erasure path found",
    "Erasure calls stopping short of the event log found",
    "Incomplete export routes found",
    // C5 fix check (2026-11-07) items 6 and 7: an allowed line for each new form.
    "Pixel fires before the visitor consents; no consent gate found",
    "Tag loads before a consent decision; no gate found",
    "Tracker loads pre-consent; no consent gate found",
    "Script runs before opt-in; no opt-in check found",
    "Unreadable backup files found",
    "Understandable notice text on the page",
    "Inaccessible form fields found on the consent page",
    "Indefinitely retained rows found in the export",
    // C5 final check (2026-11-08) item 6: an allowed line for each new form.
    "Tag ignores the consent choice; no consent gate found",
    "Tracker loads ahead of the banner; no consent gate found",
    "Tag runs until the visitor opts out; no opt-out check found",
    "Cookie set on page load; no consent check found",
    "Silently sent push messages found",
    "Permanent retention setting found",
    "Always-on tracking flag found",
  ]) {
    check(`"${text}"`, title(text), []);
  }
  // A legal conclusion is not taken out by a pass word (C5 fix check item 7).
  check("a legal conclusion with found", title("Insufficient encryption found"), ["problem_line.text:insufficient"]);
  check("a legal conclusion with named", title("Masking inadequate, vendor named"), ["problem_line.text:inadequate"]);
  // The pass word belongs to the hit's own noun phrase: a preposition hands it to another noun (q2 section 4.2 item 10).
  check("a pass word given to another noun", title("Consent missing for the trackers found on the page"), ["problem_line.text:missing"]);
  check("a pass word given to another noun", title("Data sent without encryption to the host named in config"), ["problem_line.text:without"]);
  // "before consent" passes on "found" anywhere in the line, and only on "found".
  check("before consent, another clause says found", title("Pixel loads before consent, gate not found"), []);
  check("before consent, named is not found", title("Pixel loads before consent, vendor named"), ["problem_line.text:before consent"]);
  // short_name is read as a problem line is (a to-clarify finding is titled by it).
  check("a short name", { id: "self-test", short_name: "Tracker that may run before consent", problem_line: { text: "Data sent" }, fix_line: "Record it." }, [
    "short_name:before consent",
  ]);
  check("a short name", { id: "self-test", short_name: "Tracker with no consent gate found", problem_line: { text: "Data sent" }, fix_line: "Record it." }, []);

  // A fix line instructs; it is refused only where it states a state.
  for (const fix of [
    "Stop blocking, redirecting without consent or varying payment by country, unless a stated legal requirement needs it.",
    "Put Refuse beside Accept, and never treat closing as consent.",
    "Clear this store on log-out, or, where it has no removal call, do not write personal data to it.",
    "Beside the claim, describe where the key is at every hop, what stays unencrypted, and any recovery path.",
    "Keep no finer location than the purpose needs.",
    "Erase, not mark, the record.",
    "Don't write personal data to it, and skip the backups only where the law keeps them.",
    "Make sure a person cannot be picked out of the export.",
    "Fail closed where the consent gate fails to load.",
    "Send neither the name nor the e-mail address.",
    "Keep the copy outside the public bucket.",
    "Replace the partial export with a full one, and close the gap between the stated and the enforced period.",
    "Move the hidden notice to the top of the page.",
    "Where the hash is insufficient for passwords, switch to a slow one.",
    "If masking is inadequate on replay screens, mask every input.",
    // C5 final check (2026-11-08) item 6: a clause opened by an imperative "get" instructs (eu-minors-001's fix line).
    "Check the age; below the limit, get parental consent before processing.",
    "Stay within the stated period, and always purge the kept copy.",
  ]) {
    check(`fix "${fix}"`, { id: "self-test", problem_line: { text: "Data sent" }, fix_line: fix }, []);
  }
  for (const [fix, phrase] of [
    ["Data is sent without encryption; use TLS.", "without"],
    ["Add the missing consent check.", "missing"],
    ["Users get no notice, so send one.", "get no"],
    ["The period is unstated; state it where people read it.", "unstated"],
    ["The export is not open; publish an API.", "not"],
    ["The notice is hidden in the footer; move it up.", "hidden"],
    ["Replace the inadequate masking with full masking.", "inadequate"],
    ["The hash is insufficient; use a slow one.", "insufficient"],
    // C5 final check (2026-11-08) item 6: after a subject, "get" is still a state verb.
    ["Users get the data without encryption; stop it.", "without"],
    ["The tag is loaded on page load; gate it.", "on page load"],
  ]) {
    check(`fix "${fix}"`, { id: "self-test", problem_line: { text: "Data sent" }, fix_line: fix }, [`fix_line:${phrase}`]);
  }

  // An excepted line passes for its own rule id, field and phrase only.
  const rows = [{ rule: "self-test-kept", field: "problem_line.text", phrase: "lacks", reason: "self-test" }];
  check("an excepted line, its own rule", title("Page markup lacks a label", "self-test-kept"), [], ["problem_line.text:lacks"], rows);
  check("an excepted line, another rule", title("Page markup lacks a label", "self-test-other"), ["problem_line.text:lacks"], [], rows);
  check("an excepted rule, another phrase", title("Page markup label missing", "self-test-kept"), ["problem_line.text:missing"], [], rows);
  check(
    "an excepted rule, another field",
    { id: "self-test-kept", problem_line: { text: "Page markup" }, fix_line: "The page lacks a label; add one." },
    ["fix_line:lacks"],
    [],
    rows,
  );
  // The real list: well formed, one row per rule, field and phrase, and each phrase one the lint reports.
  const keys = new Set();
  for (const x of ABSENCE_CLAIM_EXCEPTIONS) {
    const key = `${x.rule} ${x.field} ${x.phrase}`;
    if (keys.has(key)) failures.push(`absence-claim exceptions: a second row for ${key}`);
    keys.add(key);
    if (!ABSENCE_CLAIM_FIELDS.includes(x.field)) failures.push(`absence-claim exceptions: ${key}: the field is not one this lint reads`);
    if (typeof x.reason !== "string" || x.reason.trim().length < 20) failures.push(`absence-claim exceptions: ${key}: no reason`);
    const hits = absenceClaimHits(x.phrase);
    if (hits.length !== 1 || hits[0].phrase !== x.phrase) failures.push(`absence-claim exceptions: ${key}: the phrase is not one the lint reports`);
  }
  return failures;
}

/**
 * The person-facing word lint's self-test, over synthetic documents only. `tools/build-bundle.mjs`
 * runs it on every build, before any rule is read, and `--self-test` below surfaces it: a rule on disk
 * that fails the lint fails the build, so the negative control cannot live in rules/packs. Returns
 * failure messages; `[]` when the check bites everywhere it should and nowhere else.
 */
export function personWordSelfTest() {
  const failures = [];
  const paths = (rows) => rows.map((r) => `${r.path}:${r.word.toLowerCase()}`).sort().join(" | ");
  const expect = (label, got, want) => {
    if (paths(got) !== [...want].sort().join(" | ")) failures.push(`${label}: expected [${[...want].sort().join(" | ")}], got [${paths(got)}]`);
  };

  if (FORBIDDEN_TO_THE_PERSON.length !== 8 || FORBIDDEN_TO_THE_PERSON.some((re) => !re.flags.includes("i"))) {
    failures.push("the list is not the eight case-insensitive patterns this self-test was written against");
  }
  const rule = lintPersonFacingWords(
    {
      id: "self-test",
      title: "Secret-named value passed to a log call",
      detector: { match: ["report-illegal-content"] },
      legal_basis: [
        {
          cite:
            "GDPR, Art. 5(1)(f) - personal data shall be 'processed in a manner that ensures appropriate security of the " +
            "personal data, including protection against unauthorised or unlawful processing'. The provider's own flag is not thereby clean.",
        },
        { cite: 'DSA, Art. 16(1): "...considers to be illegal content." A notice alleges illegal content.' },
      ],
      context_questions: ["Is the value passed to a log call?"],
      evidence_template: "A 'clean' result is not established here.",
      remediation_template: "If all three are recorded, there is nothing to fix here - dismiss the candidate.",
      provenance: { reviewed_by: "the check passed" },
    },
    PERSON_WORD_PATHS.rule,
  );
  expect("rule problems", rule.problems, [
    "title:passed",
    "legal_basis[0].cite:clean",
    "legal_basis[1].cite:illegal",
    "evidence_template:clean",
    "remediation_template:nothing to fix",
  ]);
  expect("rule quoted", rule.quoted, ["legal_basis[0].cite:unlawful", "legal_basis[1].cite:illegal"]);
  expect("rule not copied", rule.notCopied, ["context_questions[0]:passed", "provenance.reviewed_by:passed"]);
  expect("rule verbatim", rule.verbatim, ["detector.match[0]:illegal"]);

  const checklist = lintPersonFacingWords(
    {
      checklist_id: "self-test",
      law: "Regulation X",
      scope_note: "A skipped check is indistinguishable from a passed one.",
      items: [
        {
          id: "i1",
          quote: "traders that offer products which are non-compliant with this Regulation",
          cite: "Art. 22",
          question: "Does the statement stay compliant?",
          applicability_note: "passed over until now",
        },
      ],
      applicability: {
        cite: "Art. 2(1) - the 'unlawful' reading is not clean",
        limbs: [{ id: "l1", question: "Has the check passed?", note: "a passed check" }],
        when_unresolved: "reads like a clean result",
      },
    },
    PERSON_WORD_PATHS.checklist,
  );
  expect("checklist problems", checklist.problems, ["applicability.limbs[0].question:passed", "applicability.cite:clean"]);
  expect("checklist quoted", checklist.quoted, ["applicability.cite:unlawful"]);
  expect("checklist not copied", checklist.notCopied, [
    "scope_note:passed",
    "items[0].question:compliant",
    "items[0].applicability_note:passed",
    "applicability.limbs[0].note:passed",
    "applicability.when_unresolved:clean",
  ]);
  expect("checklist verbatim", checklist.verbatim, ["items[0].quote:compliant"]);

  // THE WHITESPACE OF A PHRASE. A literal whitespace character in a pattern holds exactly
  // that one character between two words, while the report prints every run of whitespace as one
  // space: the phrase reaches the person and the build stays green.
  for (const re of FORBIDDEN_TO_THE_PERSON) {
    if (/\s/.test(re.source)) {
      failures.push(
        `${re} holds a literal whitespace character: join the words of a phrase with \\s+, so that a line break, a doubled space or a no-break space between them is still the phrase`,
      );
    }
  }
  // Each entry, read off its own pattern (\b dropped, \s+ read as one space), must fail as itself; each
  // phrase is then planted with one gap at a time as a line break (a hard-wrapped | block), a doubled
  // space and a no-break space, in the held fields the verification's attack B used, and each plant
  // must fail as exactly that phrase in exactly that field.
  const GAPS = [
    ["a line break", "\n", "rule", "remediation_template"],
    ["a doubled space", "  ", "rule", "evidence_template"],
    ["a no-break space", "\u00a0", "checklist", "title"],
  ];
  const held = (kind, field, text) =>
    lintPersonFacingWords(
      kind === "rule" ? { id: "self-test", [field]: text } : { checklist_id: "self-test", [field]: text },
      PERSON_WORD_PATHS[kind],
    ).problems;
  for (const re of FORBIDDEN_TO_THE_PERSON) {
    const phrase = re.source.replace(/\\b/g, "").replace(/\\s\+/g, " ");
    const want = (field) => `${field}:${phrase.toLowerCase()}`;
    const plain = held("rule", "title", `As written, ${phrase} here.`);
    if (paths(plain) !== want("title")) {
      failures.push(
        `${re}: the entry read off the pattern ("${phrase}") does not fail as itself in a rule title, got [${paths(plain)}]: write an entry as words joined by \\s+`,
      );
      continue;
    }
    const words = phrase.split(" ");
    for (let gap = 1; gap < words.length; gap++) {
      for (const [label, ws, kind, field] of GAPS) {
        const planted = `${words.slice(0, gap).join(" ")}${ws}${words.slice(gap).join(" ")}`;
        const got = held(kind, field, `As written, ${planted} here.`);
        if (paths(got) !== want(field)) {
          failures.push(
            `${re}: "${phrase}" with ${label} before word ${gap + 1}, in a ${kind} ${field}: expected [${want(field)}], got [${paths(got)}]`,
          );
        }
      }
    }
  }
  // THE ABSENCE-CLAIM LINT on a rule's two lines (above): its cases run here, inside this lint's own test.
  failures.push(...absenceClaimSelfTest());
  failures.push(...correctedWordingSelfTest());
  return failures;
}

/* ------------------------------------------------------------------------- *
 * THE WORKSPACE-PATH LINT (added to build-bundle.mjs 2026-08-25; lifted here
 * and widened to every shipped document the same day).
 * ------------------------------------------------------------------------- *
 *
 * THE DEFECT. Shipped prose tells the user's agent to open a file that exists only in this private
 * workspace. The bundle is `rules.json`, `checklists.json` and a manifest; nothing else reaches the
 * user's machine. An agent told to answer a question by reading a record or a tool of this workspace either invents the answer or drops the question, and
 * what reaches the user is a record with a hole in it. **Whatever the agent must know has to be in
 * the shipped text, or not promised.** A citation may say what a document establishes; it may not
 * send the reader to go and open it.
 *
 * WHY IT MOVED OUT OF build-bundle.mjs. The first version read four fields — `title`,
 * `context_questions`, `evidence_template`, `remediation_template` — **of rules only**, and the
 * build was green. Measured on the bundle built from `main` on 2026-08-25: **244 path references in
 * the shipped bundle and the lint saw 0 of them**, because 88 sat in fields it did not read
 * (`provenance` 71, `legal_basis[].cite` 18) and 155 sat in checklists, which it did not read at
 * all. The checklist half is the one that reaches an agent unconditionally: `reconcile.ts` copies
 * every checklist verbatim into `reconcile-input.json` and the declaration-reconcile skill tells the
 * agent to walk every one of them, including the ones that do not apply. A lint scoped to four
 * fields of one document type is a lint that certifies the half nobody was writing in.
 *
 * HOW THE DECISION IS MADE. Two limbs, unioned, neither able to silence the other:
 *
 *  1. **Does the named path resolve to a file or directory in THIS workspace?** If it does, the
 *     user's machine does not have it. This limb is exact for the one genuinely ambiguous case:
 *     `eu-cra-001` asks about the reader's own `docs/SECURITY.md`, which is a path in the SCANNED
 *     project and does not exist here, so it passes.
 *  2. **Is it under a directory that is unambiguously this workspace's** — a workspace folder of records or tools,
 *     the rules' vocabulary folder — or one of the three
 *     bare workspace files? This limb fires on a stale citation whose file has since been deleted,
 *     which limb 1 alone would wave through.
 *
 * THE ONE CARVE-OUT, and it is a fact about the build rather than a courtesy. Gate files are
 * INLINED into every checklist that names them, so `rules/gates/cra-scope.yaml` names content the
 * reader actually holds. **It is `.yaml`/`.yml` under `rules/gates/` and nothing else**, because
 * that is exactly what `build-bundle.mjs` inlines (`readdirSync(GATES_DIR).filter(f =>
 * f.endsWith(".yaml") || f.endsWith(".yml"))`). Until 2026-08-25 the carve-out was the directory
 * prefix `/^rules\/gates\//`, which also exempted `rules/gates/cra-scope.quotes.json` — a
 * verification receipt that ships nowhere, named twice in `rules.json` today.
 *
 * A SECOND MESSAGE, FOR A DIFFERENT REPAIR. `rules/checklists/<id>.yaml` names a checklist that DOES
 * ship — inside `checklists.json`, under its `checklist_id`. The file path is a stale address rather
 * than missing content, and the repair is to name the id, not to delete the sentence. It is still an
 * error: the reader cannot open the path either way. 83 of the bundle's 244 hits are this shape.
 *
 * WHAT THIS CANNOT SEE, stated because the gap is the interesting part. A passage that promises
 * content without naming a path — *"their entries say so in a fixed tag"*, *"the entry says which
 * document established it"* — names nothing to probe and is invisible here. That class is caught by
 * `BUNDLE_PROMISE_PATTERN` below, which is a denylist of observed shapes and is honest about being
 * one; it is a net, not a decision procedure.
 */

/** Gate documents ARE inlined into the checklists that reference them, so naming one is truthful. */
export const BUNDLE_INLINED_PATH = /^rules\/gates\/[^/]+\.ya?ml$/;

/** A checklist ships under its id inside `checklists.json`; naming its FILE is a stale address. */
export const SHIPPED_UNDER_ANOTHER_ADDRESS = /^rules\/checklists\/([^/]+)\.ya?ml$/;

/**
 * Directories and files that are unambiguously the private workspace's, whatever exists today. The list is the
 * workspace's own (`workspace-only-paths.json` beside this module), read once at load; a tree that does not carry it -
 * the public one - has no such directories, and limb 1 alone decides there.
 */
const WORKSPACE_ONLY = (() => {
  try {
    return JSON.parse(readFileSync(new URL("./workspace-only-paths.json", import.meta.url), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return { directories: [], files: [] };
    throw e;
  }
})();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const WORKSPACE_ONLY_PREFIX = new RegExp(
  [
    WORKSPACE_ONLY.directories.length ? `^(?:${WORKSPACE_ONLY.directories.map(escapeRe).join("|")})\\/` : null,
    WORKSPACE_ONLY.files.length ? `^(?:${WORKSPACE_ONLY.files.map(escapeRe).join("|")})$` : null,
  ]
    .filter(Boolean)
    .join("|") || "(?!)",
);

/**
 * The paths only the exported public tree holds, read as absent by limb 1 (2026-11-10).
 *
 * The export writes some of the repository's public files where the workspace keeps them under another name
 * (`.github/ISSUE_TEMPLATE/`, `HOW-IT-WORKS.md` and the like), so limb 1 (does the named path exist?) answered
 * differently in the two trees: two rules that name `.github/ISSUE_TEMPLATE` as a place in the SCANNED repository built
 * in the workspace and stopped the README's build in the export. The export lists every such path in the file named
 * below, beside this module, and the build reads them as absent, so the lint answers the same in both trees with no rule
 * text changed. The workspace never holds the list (the export refuses to run where it exists), so there the set is
 * empty and nothing changes; a list that is not an array of paths stops the build rather than being half read.
 *
 * HONOURED ONLY IN AN EXPORTED TREE. A copy that reached the workspace (copied back
 * from an export by hand, untracked) made `exportOnlyPath` answer true for the workspace's own real paths, so a rule
 * naming them built, and the export still ran. So the list is read only where it is the export's: never in a tree that
 * carries the workspace's own list of its private paths (`workspace-only-paths.json` beside this module, which the export
 * never ships), and in a git work tree only where that repository tracks it (a clone of the public repository). An
 * untracked copy in a git work tree, or any copy beside the workspace's list, stops the build and says why
 * (`exportOnlyRefusal`); the export also refuses to run while one is present.
 */
export const EXPORT_ONLY_PATHS_NAME = "export-only-paths.json";
/** Why the list at `file` (beside this module) must not be read here, or null where it is the export's own. */
export function exportOnlyRefusal(file) {
  const where = `tools/${EXPORT_ONLY_PATHS_NAME} (beside lint-patterns.mjs)`;
  if (WORKSPACE_ONLY.directories.length + WORKSPACE_ONLY.files.length > 0) {
    return `${where} sits beside workspace-only-paths.json, so this tree is the workspace the export is made from, which never holds it; it would hide this tree's real paths from the bundle's path check. Remove it.`;
  }
  const root = dirname(dirname(file));
  const git = (args) => {
    try {
      return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return null;
    }
  };
  if (git(["rev-parse", "--is-inside-work-tree"])?.trim() !== "true") return null;
  if (!git(["ls-files", "--", `tools/${EXPORT_ONLY_PATHS_NAME}`])?.trim()) {
    return `${where} is not tracked by the repository it sits in. The export writes it into the tree it exports and nowhere else; a copy here would hide this repository's real paths from the bundle's path check. Remove it.`;
  }
  return null;
}
const EXPORT_ONLY = (() => {
  const file = new URL(`./${EXPORT_ONLY_PATHS_NAME}`, import.meta.url);
  let list;
  try {
    list = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return new Set();
    throw e;
  }
  const refused = exportOnlyRefusal(fileURLToPath(file));
  if (refused !== null) throw new Error(refused);
  if (!Array.isArray(list?.paths) || list.paths.some((p) => typeof p !== "string" || !p)) {
    throw new Error(`${EXPORT_ONLY_PATHS_NAME} (beside lint-patterns.mjs): \`paths\` must be an array of repository-relative paths`);
  }
  return new Set(list.paths);
})();
/** True when the export placed `named` where the workspace holds nothing (the set above; empty in the workspace). */
export function exportOnlyPath(named) {
  return EXPORT_ONLY.has(String(named).replace(/^\.\//, "").replace(/\/+$/, ""));
}

/**
 * A path-shaped run of at least two segments, or one of the two bare workspace files.
 *
 * The leading lookbehind rejects a position INSIDE a longer token — which is what keeps the host and
 * path of `https://developer.apple.com/library/…` out — while allowing `./`, `/` and any
 * punctuation an author writes a path behind.
 */
export const PATH_SHAPED = new RegExp(
  String.raw`(?<![A-Za-z0-9._\-/])(?:\.\/|\/)?((?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+` +
    WORKSPACE_ONLY.files
      .filter((f) => !f.includes("/"))
      .map((f) => `|${escapeRe(f)}`)
      .join("") +
    ")",
  "g",
);

/**
 * Every distinct workspace path named in one string, with how each was recognised.
 *
 * `resolve(name)` answers limb 1 — it is injected rather than calling `existsSync` here so that the
 * caller owns the workspace root and this module stays free of filesystem assumptions.
 */
export function workspacePathHits(text, resolve) {
  if (typeof text !== "string") return [];
  const out = [];
  const seen = new Set();
  // matchAll, not match: a field naming three private-workspace files used to be reported once and
  // fixed three times, once per build.
  for (const m of text.matchAll(PATH_SHAPED)) {
    for (const named of candidateSpellings(m[1])) {
      if (seen.has(named)) continue;
      // A traversal segment is never a repository-relative path in prose, and resolving one would
      // ask the filesystem about somewhere outside this workspace.
      if (named.split("/").includes("..")) continue;
      if (BUNDLE_INLINED_PATH.test(named)) continue;
      const staleAddress = SHIPPED_UNDER_ANOTHER_ADDRESS.exec(named);
      const resolvesHere = resolve(named);
      if (!WORKSPACE_ONLY_PREFIX.test(named) && !resolvesHere) continue;
      seen.add(named);
      out.push({ path: named, shipsUnderId: staleAddress ? staleAddress[1] : null });
      break; // the longest spelling that resolves is the one meant; do not report a prefix of it too
    }
  }
  return out;
}

/**
 * The matched run, and then the same run with sentence punctuation peeled off the end.
 *
 * **A hole in the recogniser, found 2026-08-25 by breaking the check on purpose.** `PATH_SHAPED`'s
 * final class contains `.`, `-` and `_`, so a path written at the end of a sentence is captured WITH
 * the full stop — `rules/gates/cra-scope.quotes.json.` — and that string resolves to nothing, so the
 * `existsSync` limb says "not a workspace path" and the reference rides through. It only ever showed
 * up on paths under a directory the prefix limb already covers,
 * which is why nothing had noticed: the limb that was doing the work was the other
 * one. A `rules/gates/…json.` or a `product/…ts.` at the end of a sentence was invisible.
 *
 * Peeling is tried longest-first and stops at the first spelling that resolves, so
 * an internal record is never reported as an internal record. Trailing `/` is peeled too: a
 * directory written as `tools/` inside a sentence is the same reference as `tools`.
 */
const STILL_A_PATH = /^(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+$/;

function candidateSpellings(matched) {
  const out = [matched];
  let s = matched;
  while (s.length > 1 && /[.\-_/]$/.test(s)) {
    s = s.slice(0, -1);
    // Still two or more non-empty segments, which is what PATH_SHAPED itself demands. Without this
    // the peel produced `./` out of `./x` and `existsSync` said yes to the working directory.
    if (STILL_A_PATH.test(s)) out.push(s);
  }
  return out;
}

/**
 * Run the workspace-path lint over every string leaf of one shipped document.
 *
 * `exempt` is a list of regular expressions over the dotted field path. **Deny by default**, as
 * `lintStringLeaves` is: a prose field added later is covered without anyone remembering to extend a
 * list. Every exempted hit is RETURNED rather than dropped, so the caller can print the size of the
 * hole it is choosing to keep — a lint whose exemptions are invisible is the defect it exists to
 * catch, one file up.
 */
export function lintWorkspacePaths(value, { label, resolve, exempt = [] } = {}) {
  const problems = [];
  const exempted = [];
  for (const [path, text] of stringLeaves(value)) {
    const hits = workspacePathHits(text, resolve);
    if (hits.length === 0) continue;
    if (exempt.some((re) => re.test(path))) {
      for (const h of hits) exempted.push({ field: path, path: h.path });
      continue;
    }
    for (const h of hits) {
      problems.push(
        h.shipsUnderId
          ? `${label ? `${label}: ` : ""}${path} names the file "${h.path}". That checklist ships, but ` +
            `inside checklists.json under the id "${h.shipsUnderId}" — a user's machine has no such ` +
            `file. Name the id, or put what the reader needs into the field.`
          : `${label ? `${label}: ` : ""}${path} names the private-workspace path "${h.path}", which a ` +
            `user's machine does not have and the bundle does not carry. Put what the reader needs ` +
            `INTO the field, or ask them to read the primary source; do not point at this repository.`,
      );
    }
  }
  return { problems, exempted };
}

/**
 * Shapes in which shipped prose promises the reader a per-vendor entry, a tag or a field that the
 * bundle does not carry.
 *
 * **This is a denylist of shapes that were actually found in the bundle, and it is not a decision
 * procedure.** The path lint above answers an exact question — does this name resolve here — and is
 * complete for the class it covers. This one cannot be: "the entry says so" names nothing a build
 * can probe, and the only mechanical fact behind it is that `dist/bundle/rules.json` carries no
 * `vendor`, no `receives`, no `jurisdiction` and no `jurisdiction_source` key at all, so a sentence
 * telling an agent to read a per-vendor entry is telling it to read something that is not there.
 *
 * Five passages in `recipients-002` and `recipients-004` carried these shapes on 2026-08-25, one of
 * them promising *"which document established it and how it was read"* — content that lives in
 * `jurisdiction_source`, which the build strips. The repair is to carry the substance into the
 * shipped text, which the same family had already done elsewhere: `recipients-004
 * context_questions[4]` says the vendors are *"given here rather than pointed at, because no vendor
 * file ships with this bundle"*.
 *
 * Written so that the repaired wording passes: the shapes require a definite article and a
 * possessive pointing AT an entry or a tag, so "no vendor file ships with this bundle" and "the
 * entry is not in the bundle" do not match.
 */
export const BUNDLE_PROMISE_PATTERN =
  /\b(?:the|their|its|each)\s+(?:vendor\s+)?entr(?:y|ies)\s+(?:say|says|carr(?:y|ies)|state|states|record|records|name|names)\b|\bcarr(?:y|ies)\s+the\s+fixed\s+tag\b|\bthe\s+fixed\s+tag\s+(?:say|says)\b/i;

/* ------------------------------------------------------------------------- *
 * THE KEY-TO-VALUE JOIN LINT (work item #71, owner-approved 2026-08-17).
 * ------------------------------------------------------------------------- *
 *
 * THE DEFECT. A detector that joins a key to its value with the character class `[=:]` cannot read
 * Ruby's hash-rocket form. Against `{ :threshold => "BLOCK_NONE" }` the class consumes the `=`,
 * nothing in the pattern then skips the `>`, and the pattern never reaches the value — so a rule
 * written to catch a setting goes silent on a spelling real Ruby uses throughout. This was
 * established by running the patterns, not by reading them, and `--self-test` below re-establishes
 * it on every run rather than asserting it.
 *
 * WHAT THE FIX BUYS, stated so nobody oversells it: REACH, not findings. Measured on 2026-08-17
 * over the whole corpus — 16,551 `.rb` files, of which 2,857 carry a hash rocket, 28,312 lines in
 * all. Rewriting each of those lines into Ruby 1.9 shorthand and asking whether any pre-change
 * pattern matches the rewrite and not the original found THREE lines, all three on one SUPPRESSION
 * clause (`ai-prohibited-003.match_without[5]`, `"categories" => "category"` in a Rails forum) and
 * none on any `match` clause. In the other direction, the post-change `match` patterns raise ZERO
 * Ruby lines the pre-change ones did not. A paired before/after scan of all 94 corpus trees with
 * the shipped scanner agrees exactly: 17,541 candidates and 162,970 locations both ways, no rule
 * moved, no location added and none removed, on a corpus where all 22 edited rules do fire.
 * So this corpus contains no finding the defect was hiding. The fix is still right — under-firing
 * is invisible by construction and a null result narrows nothing — but it recovers
 * nothing that was there, and must not be described as if it did.
 *
 * WHY A LINT AND NOT ONE SWEEP. Fourteen different hand-written spellings of a rocket-aware join
 * were already on disk when the sweep was made — 46 occurrences — and one file carried both: on
 * 2026-08-17 `eu-retention-002` held 18 rocket-aware joins and 13 bare ones, in the same rule, in
 * the same construct. A defect that a careful author reintroduces inside the file that already
 * documents it is a defect the build has to catch, not a defect a session fixes once.
 *
 * WHAT IS CHECKED. The character classes `[=:]` and `[:=]`, in the five `detector` fields whose
 * entries the engine compiles with `new RegExp` (DETECTOR_PATTERN_FIELDS). Deny by default within
 * that scope: `path_without` is included even though a hash rocket cannot occur in a file path,
 * because a check whose scope is an author's judgement is a check that goes quietly stale, and the
 * allowlist is there for the case that a path pattern one day needs one.
 *
 * WHAT IS DELIBERATELY NOT CHECKED, and this is the honest limit of the lint. A bare `=`, a literal
 * `:`, and the wider join classes some rules use — eight occurrences in six spellings, `[(\[:=]` (2),
 * `[:=,(]` (2), `[:=><~^@]`, `[:=><~^]`, `[.\[({=:,]`, `[:=(]` — are outside it. Two rules carry the same defect and were
 * verified to on 2026-08-17 by running them, `key: value` matching and `key => value` not:
 *
 *     eu-consent-018.match[4]   `(?:[Tt]emplate|...|[Cc]ampaign)\w{0,14}["'`]?\s*[:=(]\s*["'`]...`
 *     eu-consent-017.match[6]   `(?:[Cc]onsent|CONSENT)\w{0,20}\s*(?:\?)?\s*(?::|(?<!<operators>)=(?!=))\s*...`
 *                               (its `<operators>` is the arithmetic and comparison set, written
 *                               here as a placeholder because the real class ends a block comment)
 *
 * They are left out because a class containing `=` is not mechanically a join — an operator set, a
 * negated class and a base64 alphabet all contain one — so widening the check means an allowlist
 * longer than the finding list, which teaches authors to add allowlist entries instead of fixing
 * patterns. Those two rules are a rule-granularity question and belong to the owner,
 * not to this file. They are named here so the gap is on the record rather than
 * discovered again.
 */

/** `{ start, end, body }` for every character class in a regex source, `end` exclusive. */
export function charClasses(src) {
  const out = [];
  for (let k = 0; k < src.length; k++) {
    if (src[k] === "\\") { k++; continue; }
    if (src[k] !== "[") continue;
    let j = k + 1;
    let body = "";
    // A leading `^` negates and does not close. A leading `]` is NOT literal in JavaScript — `[]`
    // is the empty class — so it is not special-cased here; POSIX's rule would mis-tokenise `[]]`.
    if (src[j] === "^") { body += "^"; j++; }
    for (; j < src.length && src[j] !== "]"; j++) {
      if (src[j] === "\\") { body += src[j] + (src[j + 1] ?? ""); j++; continue; }
      body += src[j];
    }
    out.push({ start: k, end: j + 1, body });
    k = j;
  }
  return out;
}

/** `[open, close]` for every group, skipping parentheses that are escaped or inside a class. */
export function regexGroups(src) {
  const skipTo = new Map(charClasses(src).map((c) => [c.start, c.end - 1]));
  const out = [];
  const stack = [];
  for (let k = 0; k < src.length; k++) {
    if (src[k] === "\\") { k++; continue; }
    if (skipTo.has(k)) { k = skipTo.get(k); continue; }
    if (src[k] === "(") stack.push(k);
    else if (src[k] === ")") { const open = stack.pop(); if (open !== undefined) out.push([open, k]); }
  }
  return out;
}

/** `[from, to)` of each top-level alternative in `src[from, to)` — `|` outside any group or class. */
export function topLevelAlternatives(src, from, to) {
  const skipTo = new Map(charClasses(src).map((c) => [c.start, c.end - 1]));
  const parts = [];
  let depth = 0;
  let start = from;
  for (let k = from; k < to; k++) {
    if (src[k] === "\\") { k++; continue; }
    if (skipTo.has(k)) { k = skipTo.get(k); continue; }
    if (src[k] === "(") depth++;
    else if (src[k] === ")") depth--;
    else if (src[k] === "|" && depth === 0) { parts.push([start, k]); start = k + 1; }
  }
  parts.push([start, to]);
  return parts;
}

const GROUP_OPENER = /^\((?:\?:|\?<[=!]|\?[=!]|\?<[A-Za-z_]\w*>)?/;

/**
 * Can the join class at `[start, end)` read `=>`?
 *
 * Two constructions count and both are on disk. Either the INNERMOST enclosing group offers `=>` as
 * a sibling top-level alternative — `(?:=>|[:=])`, `(?:[:=]|=>)`, `(=>|[:=])` and
 * `(?:=>|[:=]|\(|["']\s*,|,)` all qualify — or the class is immediately followed by `>?`, which is
 * how `ai-transparency-001` spelled it. A group that merely contains `=>` somewhere else, in
 * another branch or behind other tokens, does not qualify: `=>` has to be an alternative to the
 * class itself, in the same position, or the pattern cannot take it.
 */
export function joinIsRocketAware(src, start, end) {
  if (src.slice(end, end + 2) === ">?") return true;
  const enclosing = regexGroups(src).filter(([open, close]) => open < start && close >= end);
  if (enclosing.length === 0) return false;
  const [open, close] = enclosing.reduce((a, b) => (b[0] > a[0] ? b : a));
  const opener = GROUP_OPENER.exec(src.slice(open));
  const bodyFrom = open + (opener ? opener[0].length : 1);
  return topLevelAlternatives(src, bodyFrom, close).some(([s, e]) => src.slice(s, e) === "=>");
}

/** Start offsets of every `[=:]` / `[:=]` in `src` that cannot read a hash rocket. */
export function bareJoins(src) {
  const out = [];
  for (const c of charClasses(src)) {
    if (c.body !== "=:" && c.body !== ":=") continue;
    if (!joinIsRocketAware(src, c.start, c.end)) out.push(c.start);
  }
  return out;
}

/**
 * The `detector` fields the engine compiles with `new RegExp` and runs against source text.
 *
 * Read out of `product/packages/cli/src/engine.ts` `compile()` — five `new RegExp` call sites, in
 * this order — and re-derived rather than inherited on 2026-08-19. `patternFieldDrift` below is what
 * keeps the list honest as the schema grows, and a test case (i) compares
 * it against the call sites written out; a list nothing checks is how a sixth pattern field comes to
 * be compiled by the engine and linted by nothing.
 */
export const DETECTOR_PATTERN_FIELDS = [
  "match",
  "match_without",
  "guard_missing",
  "also_in_file",
  "path_without",
];

/* ------------------------------------------------------------------------- *
 * THE PATTERN-COMPILE GATE (2026-08-19).
 * ------------------------------------------------------------------------- *
 *
 * THE DEFECT. `tools/build-bundle.mjs` carried no `new RegExp` at all, so a detector pattern that
 * cannot be compiled BUILT GREEN AND EXITED 0. Reproduced deliberately twice during P4 and once
 * more before this gate was written: a rule whose `match[0]` is `(?i)console\.log`, and one whose
 * `match[0]` is `console(\.log`, each produced
 * `bundle 2026.07.1: 1 rules / 1 packs` with exit 0, shipped the uncompilable pattern into
 * `rules.json`, and threw only at scan time, out of `new RegExp` inside `compile()`'s `.map` —
 * `Invalid regular expression: /(?i)console\.log/: Invalid group`. That message names no rule, no
 * field and no index, so the author is handed a pattern and left to find which of 56 rules owns it.
 *
 * WHAT THIS GATE IS AND IS NOT. It is L4 of the case-opt-in lint designed in
 * an internal record, built alone and ahead of the rest because P2a
 * is built on a `(?i)` prefix and cannot start while an invalid prefix builds green. L1, L2, L3 and
 * L5 of that design are NOT here and are P2a's to add; `compileDetectorPattern` is the single seam
 * they attach to.
 *
 * ONE KNOWN HOLE, named rather than left to be discovered: `[(?i)]` COMPILES in V8 (it is a
 * character class holding four characters) so no compile gate can see it. That is exactly design
 * L2's cell, it needs a string-level lint rather than a compile, and it is P2a's.
 *
 * THE SECOND COPY, stated plainly because the project's rules forbid keeping one silently. The engine
 * compiles a pattern as `new RegExp(expandPatterns(...))` with NO FLAGS; this file does the same
 * four characters, and nothing makes the two agree. The expansion half is not copied — the build
 * imports the engine's own compiled `expandPattern`, so a rule's vocabulary is spliced by one
 * implementation. Removing the remaining copy means exporting a `compileDetectorPattern` from the
 * engine and having `compile()` call it, which is a change to `engine.ts` and belongs to the phase
 * that is already changing that file. Until then the copy is four characters wide, in one place,
 * and `patternCompileSelfTest()` runs on every build.
 */

/** The case-insensitivity opt-in prefix P2a will introduce. Rejected here until it is supported. */
export const CASE_PREFIX = "(?i)";

/**
 * `detector` fields that hold an ARRAY OF STRINGS and are deliberately not regular expressions, so
 * that `patternFieldDrift` can tell "not a pattern field" from "a pattern field nobody added to the
 * list". Each entry carries its reason here, in the file the build reads.
 *
 *   file_globs        compiled by `compileGlobs` (product/packages/cli/src/globs.ts) as GLOB syntax.
 *                     `**\/*.ts` is a valid glob and an invalid regular expression, so compiling it
 *                     here would fail the build on a correct rule.
 *   structural_checks named check sets, dispatched by name against
 *                     product/packages/cli/src/structural/checks/registry.ts. Already guarded, by
 *                     the check-set drift guard in tools/build-bundle.mjs.
 *   gate_view         named derived views (product/packages/cli/src/derive.ts), a closed enum in
 *                     rule.schema.json.
 *   shared_vocabulary names of word lists in rules/vocabulary/*.yaml that this rule imports. Not a
 *                     pattern and not text the engine ever matches on: the names are resolved into
 *                     `detector.vocabulary` by tools/build-bundle.mjs before any pattern is
 *                     compiled, and the field is removed there, so a rule that still carries one by
 *                     the time anything compiles it came from a path that did not resolve it — which
 *                     is why product/packages/cli/src/vocabulary.ts `assertSharedVocabularyResolved`
 *                     refuses it in the engine rather than leaving it to be linted here.
 *   gate_applies_to   CLAUSE REFERENCES, not patterns: `match[i]` naming which of this rule's own
 *                     `match` clauses a corroboration decision is about, the same grammar
 *                     `detector.cost_exempt` uses. The engine never hands one to `new RegExp` - it
 *                     parses the index out at compile time (product/packages/cli/src/engine.ts,
 *                     `gateAppliesTo`) - and the shape is guarded twice over: by a `pattern` in
 *                     rule.schema.json and by four hard errors in tools/build-bundle.mjs, which
 *                     refuse a reference the grammar does not admit and an index past this rule's
 *                     own `match` list.
 *   word_clauses      CLAUSE REFERENCES, not patterns, in the same `match[i]` grammar: which of this
 *                     rule's own `match` clauses match a word rather than a construct, so that their
 *                     places alone carry `tier: "word"` (0.1.3). Parsed at compile time
 *                     (engine.ts `wordClauses`), never handed to `new RegExp`, and guarded by a
 *                     `pattern` in rule.schema.json and by hard errors in tools/build-bundle.mjs.
 */
export const NON_PATTERN_DETECTOR_LIST_FIELDS = [
  "file_globs",
  "structural_checks",
  "gate_view",
  "shared_vocabulary",
  "gate_applies_to",
  "word_clauses",
];

/**
 * THE SHAPE OF A CLAUSE REFERENCE, and the ONE implementation that resolves one.
 *
 * `detector.also_in_file` may NAME one of the rule's own `match` clauses instead of copying its
 * pattern out - `match[i]`, 0-based, the grammar `detector.gate_applies_to` already uses. A
 * corroborator very often IS one of the rule's clauses (the vocabulary that raises a candidate
 * somewhere else in the tree is the vocabulary that corroborates this one), and writing it out
 * twice is a second copy of a string two places must agree on, which the project's rules forbid: the copy
 * and the clause both go on compiling after the first edit that touches only one of them.
 *
 * `tools/build-bundle.mjs` resolves every reference when it writes the bundle, so the engine never
 * sees one. This function is exported because the bundle is not the only reader: every tool that
 * reads a rule.yaml and compiles its `also_in_file` clauses - a test,
 * two tools - must resolve them the same way, and a reference
 * compiled as a pattern is SILENTLY VALID (`match[1]` is a regular expression matching the text
 * "match1"), so the failure would be a wrong measurement rather than an error. One function, one
 * message, imported by all of them.
 *
 * Returns `{ resolved, unresolved }`: `resolved` is the clause list with every reference replaced
 * by the referenced clause's pattern (`null` when the rule declares no `also_in_file`), and
 * `unresolved` one entry per reference that names no clause of this rule, for the caller to report
 * with `unresolvedClauseReferenceMessage` under its own identity prefix.
 */
export const CLAUSE_REFERENCE = /^match\[([0-9]+)\]$/;

export function resolveAlsoInFileReferences(detector) {
  const entries = Array.isArray(detector?.also_in_file) ? detector.also_in_file : null;
  if (entries === null) return { resolved: null, unresolved: [] };
  const clauses = Array.isArray(detector?.match) ? detector.match : [];
  const unresolved = [];
  const resolved = entries.map((entry, index) => {
    const ref = CLAUSE_REFERENCE.exec(String(entry));
    if (ref === null) return entry;
    const clause = Number(ref[1]);
    if (clause >= clauses.length || typeof clauses[clause] !== "string") {
      unresolved.push({ index, entry, clause, clauseCount: clauses.length });
      return entry;
    }
    return clauses[clause];
  });
  return { resolved, unresolved };
}

/** The message every caller prints for one unresolved reference, under its own identity prefix. */
export function unresolvedClauseReferenceMessage(bad) {
  return (
    `detector.also_in_file[${bad.index}] is ${JSON.stringify(bad.entry)}, which names no clause of ` +
    `this rule: it declares ${bad.clauseCount} match clause(s) ` +
    `(0..${Math.max(0, bad.clauseCount - 1)}). A corroborator may NAME one of the rule's own clauses ` +
    `instead of copying its pattern, in the same 0-based grammar detector.gate_applies_to uses, and ` +
    `tools/build-bundle.mjs resolves the reference into that clause's pattern when it writes the ` +
    `bundle: either name a clause this rule has, or write the pattern out`
  );
}

/**
 * Compile one detector pattern the way the engine will.
 *
 * THE SEAM P2A ATTACHES TO. Today the policy is "no inline flags, no flags at all". P2a changes
 * this function and nothing else in the gate: the `(?i)` branch stops throwing and starts returning
 * `new RegExp(source.slice(CASE_PREFIX.length), "i")`, and the `field` argument — which is passed in
 * today and used only for the message — becomes the L1 field restriction, because the prefix is to
 * be legal in `match` and `also_in_file` and illegal in `match_without`, `path_without` and
 * `guard_missing`. Every caller already hands over the field, so no call site moves.
 *
 * Throws with a message that does NOT name the rule; the caller owns the identity and prefixes it.
 */
export function compileDetectorPattern(source, field) {
  if (source.startsWith(CASE_PREFIX)) {
    throw new Error(
      `starts with the case-insensitivity opt-in prefix ${CASE_PREFIX}, which this engine does not ` +
        `support: JavaScript has no inline flag syntax, so ${CASE_PREFIX} reaches new RegExp as a ` +
        `group and throws "Invalid group" at scan time. Phase P2a introduces the prefix as an opt-in ` +
        `and teaches tools/lint-patterns.mjs compileDetectorPattern to strip it and set the "i" flag; ` +
        `until then, write the case alternatives out ([Ss]cript) or spell the clause both ways` +
        (field && field !== "match" && field !== "also_in_file"
          ? `. Note that ${field} is a SUPPRESSION field and P2a does not plan to accept the prefix there at all`
          : ""),
    );
  }
  // The engine's own call, character for character: no flags. See the second-copy note above.
  return new RegExp(source);
}

/**
 * Every `detector` key that looks like a pattern field and is not one of the five.
 *
 * The same shape as the check-set drift guard in `tools/build-bundle.mjs`: the engine's list and
 * this file's list are two copies of one fact, and what can be had — since a `.mjs` lint cannot
 * import a TypeScript object literal — is a build that refuses to run while a rule carries a
 * string-array detector field that neither list explains. Without it, a sixth compiled field is
 * added to the engine and to the schema, no rule that uses it is ever compile-checked, and nothing
 * says so.
 */
export function patternFieldDrift(rule) {
  const detector = rule?.detector ?? {};
  const out = [];
  for (const [key, value] of Object.entries(detector)) {
    if (DETECTOR_PATTERN_FIELDS.includes(key)) continue;
    if (NON_PATTERN_DETECTOR_LIST_FIELDS.includes(key)) continue;
    if (!Array.isArray(value) || value.length === 0) continue;
    if (!value.every((v) => typeof v === "string")) continue;
    out.push(
      `${rule?.id ?? "?"}.${key} is a list of strings under \`detector\` that tools/lint-patterns.mjs ` +
        `does not classify. If the engine compiles it with new RegExp, add "${key}" to ` +
        `DETECTOR_PATTERN_FIELDS so it is compile-checked at build time; if it is not a regular ` +
        `expression, add it to NON_PATTERN_DETECTOR_LIST_FIELDS with the reason. A pattern field the ` +
        `engine compiles and this file does not know about is a scan-time crash nothing catches`,
    );
  }
  return out;
}

/**
 * One message per detector pattern in `rule` that cannot be compiled, keyed
 * `<rule-id>.<field>[<index>]` — the same key shape the join lint and `BARE_JOIN_ALLOWLIST` use.
 *
 * `expandPattern` is passed in rather than imported so that this file stays free of any dependency
 * on the compiled CLI; `tools/build-bundle.mjs` hands over the engine's own
 * `expandPattern(pattern, vocabulary, where)` from `product/packages/cli/dist/vocabulary.js`, which
 * is what makes the string compiled here the string the engine compiles. Expansion and compilation
 * are reported separately because they send an author to different places: an unexpanded splice is
 * a missing `detector.vocabulary` list, an uncompilable pattern is the pattern.
 */
export function lintRulePatterns(rule, expandPattern) {
  const problems = patternFieldDrift(rule);
  const detector = rule?.detector ?? {};
  const vocabulary = detector.vocabulary;
  // ...and how those lists are spelled into the pattern. Passed on so the string compiled here is
  // the string the engine compiles: a list flagged case- or separator-insensitive expands to a
  // different alternation, and a lint that expanded it EXACTLY would be checking a pattern that
  // does not ship. `expandPattern` ignores a fourth argument it does not take, so the stand-ins in
  // this file's self-test are unaffected.
  const matching = detector.vocabulary_matching;
  for (const field of DETECTOR_PATTERN_FIELDS) {
    const patterns = detector[field];
    if (!Array.isArray(patterns)) continue;
    patterns.forEach((pattern, index) => {
      const where = `${rule?.id ?? "?"}.${field}[${index}]`;
      if (typeof pattern !== "string") {
        problems.push(`${where} is ${typeof pattern}, not a string — the engine would compile it as one`);
        return;
      }
      // A CLAUSE REFERENCE IS A REFERENCE, NOT A PATTERN. `detector.also_in_file` may name one of
      // the rule's own `match` clauses - `match[i]`, 0-based, the grammar `detector.gate_applies_to`
      // uses - instead of copying its pattern out, and tools/build-bundle.mjs resolves every such
      // reference into the referenced clause's pattern before this function is called, so what is
      // compiled below for that entry is the clause itself. The shape is skipped here for the
      // caller that hands over an UNRESOLVED rule: compiled as a regular expression `match[3]` is
      // valid and matches the text "match3", so reporting nothing about it is right and reporting
      // that it compiles would be a false assurance. A reference that names no clause of the rule
      // is refused by the build, which is the one place that can tell.
      if (field === "also_in_file" && CLAUSE_REFERENCE.test(pattern)) return;
      let expanded;
      try {
        expanded = expandPattern(pattern, vocabulary, where, matching);
      } catch (e) {
        problems.push(`${where} does not expand: ${e.message}`);
        return;
      }
      try {
        compileDetectorPattern(expanded, field);
      } catch (e) {
        const shownSource = expanded === pattern ? "" : ` (after vocabulary expansion)`;
        problems.push(
          `${where} does not compile${shownSource}: ${e.message}. The pattern is ${JSON.stringify(
            pattern.length > 160 ? `${pattern.slice(0, 160)}...` : pattern,
          )}`,
        );
      }
    });
  }
  return problems;
}

/**
 * One message per `detector.file_globs` entry in `rule` that cannot be compiled, keyed
 * `<rule-id>.file_globs[<index>]` — the same key shape `lintRulePatterns` uses, and read the same
 * way by a build failure.
 *
 * W6 (2026-08-21). `file_globs` is glob syntax, not a regular expression — see
 * `NON_PATTERN_DETECTOR_LIST_FIELDS` above, whose own entry for this field already explains why
 * `lintRulePatterns` must never compile it: `**\/*.ts` is a valid glob and an invalid regular
 * expression. But that correct exclusion left the field with NO build-time compile check at all.
 * The engine still runs `new RegExp` on it — `product/packages/cli/src/globs.ts` `compileGlobs`,
 * called from `engine.ts` `surfaceAllows` — so an entry that compileGlobs cannot turn into a valid
 * pattern shipped green and would have thrown at scan time, the exact failure class
 * `lintRulePatterns` exists to end for the other five fields, in the one field it did not cover.
 *
 * `compileGlobs` is passed in rather than imported, for the same reason `expandPattern` is: this
 * file stays free of any dependency on the compiled CLI, and `tools/build-bundle.mjs` hands over
 * the engine's own `compileGlobs` from `product/packages/cli/dist/globs.js` — the function that
 * makes the glob compiled here the glob the engine compiles. Called ONE ENTRY AT A TIME (rather
 * than once over the whole array, which is how the engine calls it) purely so a failure can be
 * attributed to its index; `compileGlobs` treats every entry independently; there is no cross-entry
 * state a single-entry call could lose.
 */
export function lintRuleFileGlobs(rule, compileGlobs) {
  const problems = [];
  const globs = rule?.detector?.file_globs;
  if (!Array.isArray(globs)) return problems;
  globs.forEach((glob, index) => {
    const where = `${rule?.id ?? "?"}.file_globs[${index}]`;
    if (typeof glob !== "string") {
      problems.push(`${where} is ${typeof glob}, not a string — the engine would compile it as one`);
      return;
    }
    try {
      compileGlobs([glob]);
    } catch (e) {
      problems.push(`${where} does not compile as a glob: ${e.message}. The glob is ${JSON.stringify(glob)}`);
    }
  });
  return problems;
}

/**
 * Re-establish the two defects by EXECUTION on every build, and prove the check bites on each of
 * the five fields.
 *
 * Not behind a flag, for the reason a check states and `tools/gate-list.mjs`
 * follows: a self-test behind a flag is one nobody runs. It reads no files and touches no rule.
 * Returns a list of failures; empty means this file behaves as its comment claims.
 */
export function patternCompileSelfTest() {
  const failures = [];
  const identity = (p) => p;
  const ruleWith = (field, pattern) => ({ id: "self-test", detector: { [field]: [pattern] } });

  // THE TWO DEFECTS THEMSELVES, reproduced rather than asserted. If either of these ever stops
  // throwing, the gate below is guarding against nothing and must be re-derived.
  for (const [what, src] of [["the (?i) prefix", "(?i)console\\.log"], ["an unbalanced group", "console(\\.log"]]) {
    let threw = false;
    try {
      new RegExp(src);
    } catch {
      threw = true;
    }
    if (!threw) failures.push(`${src} compiled in this runtime, so ${what} is no longer a defect this gate can find`);
  }

  // THE CHECK, on EVERY field the engine compiles. A gate that only reads `match` passes every
  // other case in this self-test, and four of the five fields would go unchecked in silence.
  for (const field of DETECTOR_PATTERN_FIELDS) {
    for (const [what, src] of [["a (?i) prefix", "(?i)x"], ["an unbalanced group", "x(y"]]) {
      const found = lintRulePatterns(ruleWith(field, src), identity);
      if (found.length !== 1) {
        failures.push(`${what} in ${field} produced ${found.length} message(s), expected exactly 1`);
        continue;
      }
      for (const required of ["self-test", field, "[0]"]) {
        if (!found[0].includes(required)) {
          failures.push(
            `the message for ${what} in ${field} does not contain ${JSON.stringify(required)} — the ` +
              `scan-time throw this gate replaces named no rule, no field and no index, and a build ` +
              `failure that names none of them is no better: ${found[0]}`,
          );
        }
      }
    }
    // The prefix must be reported AS the prefix, not as V8's "Invalid group".
    const prefixMsg = lintRulePatterns(ruleWith(field, "(?i)x"), identity)[0] ?? "";
    if (!prefixMsg.includes(CASE_PREFIX) || !prefixMsg.includes("P2a")) {
      failures.push(
        `the ${field} message for a ${CASE_PREFIX} prefix does not name the prefix and the phase that ` +
          `will support it, so an author reads it as a typo rather than as "not yet": ${prefixMsg}`,
      );
    }
  }

  // THE NEIGHBOURS, which must stay silent. `\(\?i\)` is a pattern LOOKING FOR the four characters.
  for (const [what, src] of [
    ["a balanced group", "console(\\.log)"],
    ["an escaped (?i) as a literal", "\\(\\?i\\)"],
    ["(?i) not at the start, inside a class", "[(?i)]x"],
    ["a lookbehind", "(?<![\\w-])src"],
    ["a named group and a backreference", "(?<q>[\"'])x\\k<q>"],
  ]) {
    const found = lintRulePatterns(ruleWith("match", src), identity);
    if (found.length !== 0) failures.push(`${what} was reported: ${found[0]}`);
  }

  // EXPANSION IS THE ENGINE'S, AND ITS FAILURE IS REPORTED SEPARATELY. The stand-in here throws the
  // way `expandPattern` throws on an undeclared list; the build passes the real one.
  {
    const throwing = () => {
      throw new Error("pattern splices (?&nope) but detector.vocabulary declares no such list");
    };
    const found = lintRulePatterns(ruleWith("match", "(?&nope)"), throwing);
    if (found.length !== 1 || !found[0].includes("does not expand")) {
      failures.push(`an undeclared vocabulary splice was not reported as an expansion failure: ${found.join(" / ")}`);
    }
    // ...and the compile must run on the EXPANDED text, not the raw text.
    const expanding = () => "x(y";
    const onExpanded = lintRulePatterns(ruleWith("match", "(?&ok)"), expanding);
    if (onExpanded.length !== 1 || !onExpanded[0].includes("after vocabulary expansion")) {
      failures.push(
        `a splice that expands to an uncompilable pattern was not caught — the gate is compiling the ` +
          `raw pattern rather than the string the engine compiles: ${onExpanded.join(" / ")}`,
      );
    }
  }

  // THE FIELD-DRIFT GUARD, exercised so it is not dead code on disk.
  {
    const unknown = { id: "self-test", detector: { match: ["x"], invented_patterns: ["y"] } };
    if (!patternFieldDrift(unknown).some((m) => m.includes("invented_patterns"))) {
      failures.push("a new string-array detector field was not reported by patternFieldDrift");
    }
    const globs = { id: "self-test", detector: { match: ["x"], file_globs: ["**/*.ts"] } };
    if (patternFieldDrift(globs).length !== 0) {
      failures.push("file_globs was reported as an unclassified pattern field, and it is glob syntax on purpose");
    }
    if (lintRulePatterns(globs, identity).length !== 0) {
      failures.push("file_globs was compiled as a regular expression — `**/*.ts` is a valid glob and an invalid regex");
    }
  }

  // THE FILE_GLOBS COMPILE GATE (W6, 2026-08-21), exercised the same way the expansion-failure
  // block above exercises `expandPattern`: with STAND-INS, because this file stays free of any
  // dependency on the compiled CLI and `compileGlobs` is passed in by the caller. The stand-ins are
  // about THIS file's contract — that `lintRuleFileGlobs` attributes a throw to the right rule,
  // field and index, and stays quiet on globs that compile — and nothing here needs a real defect
  // to say that.
  //
  // **The gate has real defects to find, and a first version of this comment claimed it did not.**
  // It said "no glob string was found that makes the REAL `compileGlobs` throw — it escapes every
  // character it does not itself interpret, so it is safe by construction today". That was false in
  // both halves. `compileGlobs` did NOT escape inside `{…}`, it left glob metacharacters there raw,
  // and ordinary documented syntax threw: `{*.ts,*.tsx}`, `src/{*.ts,*.js}`, `**\/{*.ts,*.tsx}`,
  // `{*.ts}` all produced `Invalid regular expression: … Nothing to repeat`. A fuzz over the
  // alphabet that translator treats specially found 1,739 throwing inputs in 311,150. Worse, the
  // half that did not throw: `{a*,b}` compiled to `^(?:a*|b)$`, which matches `""` and `"aa"` and
  // not `"ab"` — a rule declaring `{index*,main*}` would have been handed an empty surface and
  // read nothing. `product/packages/cli/src/globs.ts` is repaired (2026-08-21) and the throwing
  // class is now only nested `{a,{b,c}}`, which throws deliberately and names the glob.
  //
  // If `tools/build-bundle.mjs` ever stops calling `lintRuleFileGlobs`, this block still passes (it
  // does not touch the build) — a test case (k) is where that wiring is
  // asserted end to end, against the real build and the real globs.ts, with a real glob the real
  // `compileGlobs` really rejects.
  {
    const succeeding = () => {};
    const throwing = () => {
      throw new Error("glob stand-in: deliberately unusable, for the self-test only");
    };

    const absent = { id: "self-test", detector: { match: ["x"] } };
    if (lintRuleFileGlobs(absent, throwing).length !== 0) {
      failures.push("a rule with no file_globs at all was reported by lintRuleFileGlobs, which must not call compileGlobs when there is nothing to compile");
    }

    const notAString = { id: "self-test", detector: { file_globs: ["**/*.ts", 42] } };
    const notAStringFound = lintRuleFileGlobs(notAString, succeeding);
    if (notAStringFound.length !== 1 || !notAStringFound[0].includes("file_globs[1]")) {
      failures.push(`a non-string file_globs[1] was not reported at the right index: ${notAStringFound.join(" / ")}`);
    }

    const bad = { id: "self-test", detector: { file_globs: ["ok-one", "ok-two", "the-bad-one"] } };
    const selective = (arr) => {
      if (arr[0] === "the-bad-one") throw new Error("stand-in: this glob does not compile");
    };
    const foundBad = lintRuleFileGlobs(bad, selective);
    if (foundBad.length !== 1) {
      failures.push(`a single bad glob among three produced ${foundBad.length} message(s), expected exactly 1: ${foundBad.join(" / ")}`);
    } else {
      for (const required of ["self-test", "file_globs[2]", "the-bad-one"]) {
        if (!foundBad[0].includes(required)) {
          failures.push(
            `the file_globs compile failure does not contain ${JSON.stringify(required)} — an author must be told the rule, the field, the index and the offending glob, the same shape lintRulePatterns already guarantees for the other five fields: ${foundBad[0]}`,
          );
        }
      }
    }

    const clean = { id: "self-test", detector: { file_globs: ["**/*.ts", "!fixtures/**"] } };
    if (lintRuleFileGlobs(clean, succeeding).length !== 0) {
      failures.push("file_globs entries that compile cleanly were reported as failures");
    }
  }

  return failures;
}

/**
 * Joins that stay bare on purpose, keyed `<rule-id>.<field>[<index>]`.
 *
 * `bare` is how many bare joins the entry may carry and it is compared exactly, so a second bare
 * join added to an allowlisted pattern fails the build like any other. That is the price of keying
 * at pattern granularity, and pattern granularity is the choice because a byte offset does not
 * survive an edit to the same pattern and would make the allowlist silently wrong.
 *
 * Each entry carries its reason HERE, in the file the build reads. An allowlist whose reasons live
 * in a commit message is an allowlist nobody can audit.
 *
 * IT IS EMPTY, AND THAT WAS CHECKED RATHER THAN ASSUMED. All 68 bare joins on disk on 2026-08-17
 * were rewritten to `(?:=>|[:=])` and not one of them needed an exemption. The case that was
 * expected to need one does not, and the reason is recorded so nobody re-derives it:
 * `eu-retention-002.also_in_file[8]` (branch F, the YAML/JSON block-nesting branch) really does
 * carry a deliberately colon-only join — `['"]?[ \t]*:[ \t]*[{\[]?` — because a `:` there opens a
 * nested mapping and `=` and `=>` are not syntax in that position at all. But it is written as a
 * LITERAL colon, not as a character class, so this lint never sees it. A colon-only join needs no
 * exemption from a check that only looks at classes containing `=`.
 *
 * The mechanism is exercised anyway, by `--self-test`, because an allowlist first used a year from
 * now is an allowlist nobody has ever run.
 */
export const BARE_JOIN_ALLOWLIST = {
  // "eu-consent-021.also_in_file[0]": { bare: 1, reason: "why this join is colon-only" },
};

/** One message per bare join in `rule.detector`; `[]` when the rule is clean. */
export function lintRuleJoins(rule) {
  const problems = [];
  const detector = rule?.detector ?? {};
  for (const field of DETECTOR_PATTERN_FIELDS) {
    const patterns = detector[field];
    if (!Array.isArray(patterns)) continue;
    patterns.forEach((pattern, index) => {
      if (typeof pattern !== "string") return;
      const where = `${rule?.id ?? "?"}.${field}[${index}]`;
      const found = bareJoins(pattern);
      const allowed = BARE_JOIN_ALLOWLIST[where];
      if (allowed) {
        if (found.length !== allowed.bare) {
          problems.push(
            `${where} is allowlisted for ${allowed.bare} bare key-to-value join(s) and carries ` +
              `${found.length} — write the new one as (?:=>|[:=]), or update the count AND the reason ` +
              `in BARE_JOIN_ALLOWLIST in tools/lint-patterns.mjs (allowlisted because: ${allowed.reason})`,
          );
        }
        return;
      }
      for (const at of found) {
        problems.push(
          // `[:=]` is FOUR characters, not three. Written out because the sweep that produced the
          // 2026-08-17 rewrite sliced three, left the closing `]` behind as a literal in all 58
          // patterns, and still passed both this lint and the build — `(?:=>|[:=])]` compiles.
          `${where} joins a key to its value with a bare ${pattern.slice(at, at + 4)} at offset ${at} ` +
            `(...${pattern.slice(Math.max(0, at - 30), at + 25)}...) — that cannot read Ruby's ` +
            `hash-rocket form \`key => value\`, because the class eats the = and nothing skips the >. ` +
            `Write it as (?:=>|[:=]); or, if the join is colon-only on purpose, add ${where} to ` +
            `BARE_JOIN_ALLOWLIST in tools/lint-patterns.mjs with a reason`,
        );
      }
    });
  }
  return problems;
}

/* ------------------------------------------------------------------------- *
 * Standalone entry point. `node tools/lint-patterns.mjs` runs the join lint over rules/packs and
 * exits non-zero on a finding, so an author can ask the question without a full build; the build
 * remains the gate and calls the same function. `--self-test` proves the check bites, which the
 * build cannot do — a rule on disk that fails the lint fails the build, so the negative control
 * cannot live in rules/packs. Nothing below runs on import.
 * ------------------------------------------------------------------------- */
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync, readdirSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { parse: parseYaml } = await import("yaml");

  if (process.argv.includes("--self-test")) {
    const failures = [];
    const rocket = 'threshold => "BLOCK_NONE"';
    const bare = 'threshold[\'"]?\\s*[:=]\\s*["\']?BLOCK_NONE';
    const fixed = 'threshold[\'"]?\\s*(?:=>|[:=])\\s*["\']?BLOCK_NONE';

    // THE DEFECT ITSELF, re-established by execution on every run rather than asserted.
    if (new RegExp(bare).test(rocket)) failures.push("the bare join matched a hash rocket, so there is no defect to find");
    if (!new RegExp(fixed).test(rocket)) failures.push("the accepted spelling does not actually match a hash rocket");
    if (!new RegExp(bare).test('threshold: "BLOCK_NONE"')) failures.push("the bare join does not match the colon form it was written for");
    if (!new RegExp(fixed).test('threshold: "BLOCK_NONE"')) failures.push("the accepted spelling lost the colon form");

    // THE CHECK.
    const rule = (pat) => ({ id: "self-test", detector: { match: [pat] } });
    if (lintRuleJoins(rule(bare)).length !== 1) failures.push("a bare [:=] was not reported");
    if (lintRuleJoins(rule(fixed)).length !== 0) failures.push("(?:=>|[:=]) was reported as bare");
    for (const aware of ["(?:[:=]|=>)", "(=>|[:=])", "(?:=>|[:=]|\\(|,)"]) {
      if (lintRuleJoins(rule(`k\\s*${aware}\\s*v`)).length !== 0) failures.push(`${aware} was reported as bare`);
    }
    if (lintRuleJoins(rule("k\\s*[:=]>?\\s*v")).length !== 0) failures.push("[:=]>? was reported as bare");
    // A group containing `=>` that is NOT a sibling alternative of the class must NOT count.
    if (lintRuleJoins(rule("(?:a=>b|k\\s*[:=]\\s*v)")).length !== 1) {
      failures.push("a distant => in another branch was accepted as rocket-awareness");
    }
    // Classes that merely contain = or : are out of scope and must stay silent.
    for (const other of ["[:=(]", "[=<>]", "[^=:]", "[A-Za-z0-9+/=]"]) {
      if (lintRuleJoins(rule(`k${other}v`)).length !== 0) failures.push(`${other} is out of scope but was reported`);
    }

    // THE ALLOWLIST MECHANISM, exercised on a synthetic key so it is not dead code on disk.
    const probe = { id: "self-test", detector: { match: ["k\\s*[:=]\\s*v"] } };
    const key = "self-test.match[0]";
    BARE_JOIN_ALLOWLIST[key] = { bare: 1, reason: "self-test" };
    if (lintRuleJoins(probe).length !== 0) failures.push("an allowlisted bare join was still reported");
    BARE_JOIN_ALLOWLIST[key] = { bare: 0, reason: "self-test" };
    if (lintRuleJoins(probe).length !== 1) failures.push("an allowlist count that no longer matches was not reported");
    delete BARE_JOIN_ALLOWLIST[key];

    // The pattern-compile gate's own self-test is surfaced here too, so that an author can ask the
    // question without a full build. It is NOT only here: tools/build-bundle.mjs calls
    // patternCompileSelfTest() unconditionally on every build, for the reason
    // a check states — a self-test behind a flag is one nobody runs.
    for (const f of patternCompileSelfTest()) failures.push(`pattern-compile gate: ${f}`);
    // The person-facing word lint's self-test, surfaced here for the same reason; the build runs it
    // unconditionally as well.
    for (const f of personWordSelfTest()) failures.push(`person-facing word lint: ${f}`);

    for (const f of failures) console.error(`✘ join lint self-test: ${f}`);
    if (failures.length > 0) process.exit(1);
    console.log("✔ join lint self-test: the defect reproduces, (?:=>|[:=]) fixes it, the check and its allowlist both bite");
    console.log("✔ pattern-compile self-test: (?i) and an unbalanced group both fail to compile, and the check names rule, field and index in all 5 fields");
    console.log("✔ person-facing word lint self-test: a listed word fails in copied text and in a citation outside quotation marks, and is counted, not failed, inside them, in agent-only prose and in patterns; no pattern holds a literal whitespace character, and each phrase fails with a line break, a doubled space or a no-break space between any two of its words");
  }

  const rulesDir = process.env.RULES_DIR ?? fileURLToPath(new URL("../rules/packs", import.meta.url));
  const problems = [];
  let scanned = 0;
  for (const pack of readdirSync(rulesDir)) {
    for (const ruleId of readdirSync(join(rulesDir, pack))) {
      const file = join(rulesDir, pack, ruleId, "rule.yaml");
      if (!existsSync(file)) continue;
      scanned++;
      for (const p of lintRuleJoins(parseYaml(readFileSync(file, "utf8")))) problems.push(`${pack}/${p}`);
    }
  }
  for (const p of problems) console.error(`✘ ${p}`);
  if (problems.length > 0) {
    console.error(`\n${problems.length} bare key-to-value join(s) across ${scanned} rules`);
    process.exit(1);
  }
  console.log(`✔ no bare [=:] / [:=] key-to-value join in ${scanned} rules`);
}
