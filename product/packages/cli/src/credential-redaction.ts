/**
 * CREDENTIAL REDACTION OF THE LABELS findings.json KEEPS AS TEXT (pre-run fixes, R3′, 2026-09-23).
 *
 * The kind census keeps one label per location as text: `matched_token`, which is the folded matched
 * span where clauses fired and the normalised whole line (`normaliseOutside(...).slice(0, 120)`)
 * where none did. The census copies it into `kinds.groups[].matched_token` and `kinds.groups[].key`,
 * and the payload catalogue a seat receives prints it. A live credential on a candidate's line can
 * therefore reach findings.json through a label even after every raw-text field is gone.
 *
 * ONE STEP, AND THE PRODUCT'S OWN PATTERNS. The credential patterns are `baseline-002`'s own clauses,
 * read from the CLI's OWN COPY of the rule (`credential-rule.generated.ts`, generated from the rule and held
 * to it by the bundle build), never from the loaded bundle, and compiled by
 * `compileRules`, the compiler every rule goes through. A bundle's `baseline-002` only detects. This file holds no pattern: it holds which clauses redact and
 * why, and nothing else (never a second copy of anything two places must agree on).
 *
 * WHAT A REDACTED LABEL LOOKS LIKE. Each credential region of a label becomes
 * `[redacted:baseline-002#<clause>:<16 hex>]`, the hex being a digest of the region as the label held it, keyed
 * with this computer's own key (redaction-key.ts `markerDigest`; an unkeyed sha256 until 2026-11-08, which anyone
 * holding the file could reverse for a guessable value). Equal secrets keep equal markers within and across runs on
 * one computer, different ones stay different, and
 * the replacement is decided per LABEL (the union of every candidate's targets for that label, in
 * `redactedLabelsOf`), so the new label is a function of the old one within a run and no same-kind
 * group can gain or lose a member. The marker cannot be confused with label text: every label is a
 * fold (`foldToken` drops every `-`) or an `normaliseOutside` form (which drops a `-` between two
 * alphanumerics and turns `002` into `0`), so no label can contain `baseline-002`.
 *
 * THE SAME STEP FOR THE APPLICABILITY EVIDENCE VALUE. findings.json also keeps a census capture as
 * text: `applicability[].limbs[].supporting[].value` (and `opposing[]`, `contradictions[].evidence[]`),
 * which is a collector's capture group, the whole match (`purpose-signals`), or up to 60 characters
 * of a licence file's copyright line (`copyright_holder`). `redactEvidenceValues` puts every such
 * value through the same clauses and the same marker (`redactCredentialText`), where findings.json
 * is assembled, after the verdicts are computed.
 *
 * WHAT IT DOES NOT DO. It redacts only formats these clauses recognise; it does not touch the
 * payloads' code windows (seat material), recorded as an open item in an internal record. The other open item there, an unkeyed digest of a
 * short, guessable span that trying candidates reverses, is closed by the key.
 */
import { clean, foldToken, spansOfClauses, stringRanges, type KindFacts } from "./kind-key.js";
import { markerDigest } from "./redaction-key.js";
import type { LimbEvidence, ScopeAssessment } from "./scope.js";

/** The rule whose clauses are the product's credential patterns. */
export const CREDENTIAL_RULE_ID = "baseline-002";

/**
 * Every clause of `baseline-002`, in the rule's order (the 1-based numbering `firedClauseIndices`
 * returns), with whether its matched span can hold secret material and the reason. The clause
 * documentation is in `rules/packs/baseline/baseline-002/rule.yaml`, whose comment numbers differ from
 * this order. `compileCredentialRedaction` refuses a rule whose clause count differs from this table,
 * because a renumbered rule would otherwise be redacted by the wrong clauses without a sound. The rule it
 * is given is the CLI's own copy, never a bundle's, so only a build can make the two differ.
 */
export const CREDENTIAL_CLAUSES: readonly { clause: number; redact: boolean; printed: PrintedMode; lineForm: boolean; reason: string }[] = [
  { clause: 1, redact: true, printed: "region", lineForm: false, reason: "provider key prefix sk_live_, sk_test_ or sk_org_: the matched span is the credential" },
  { clause: 2, redact: true, printed: "region", lineForm: false, reason: "provider key prefix AKIA or ASIA: the matched span is the credential" },
  { clause: 3, redact: true, printed: "region", lineForm: false, reason: "provider key prefix ghp_: the matched span is the credential" },
  {
    clause: 4,
    redact: false, printed: "block", lineForm: false,
    reason:
      "PEM private-key header: the span is the fixed BEGIN ... PRIVATE KEY envelope, never the key body " +
      "(the rule's evidence template), so it adds no secret material to a label",
  },
  { clause: 5, redact: true, printed: "region", lineForm: false, reason: "further provider prefix plus length (gho_/ghu_/ghs_/ghr_): the span is the token" },
  { clause: 6, redact: true, printed: "region", lineForm: false, reason: "further provider prefix plus length (github_pat_): the span is the token" },
  { clause: 7, redact: true, printed: "region", lineForm: false, reason: "further provider prefix plus length (rk_live_, rk_test_ or whsec_): the span is the token" },
  { clause: 8, redact: true, printed: "region", lineForm: false, reason: "further provider prefix plus length (xox?- or xapp-): the span is the token" },
  { clause: 9, redact: true, printed: "region", lineForm: false, reason: "further provider prefix plus length (AIza): the span is the token" },
  { clause: 10, redact: true, printed: "region", lineForm: false, reason: "further provider prefix plus length (sk-ant-, sk-admin-, sk-proj- or sk-svcacct-): the span is the token" },
  { clause: 11, redact: true, printed: "region", lineForm: false, reason: "further provider prefix plus length (SG.): the span is the token" },
  { clause: 12, redact: true, printed: "region", lineForm: false, reason: "further provider prefix plus length (npm_ or phx_): the span is the token" },
  { clause: 13, redact: true, printed: "region", lineForm: false, reason: "further provider prefix plus length (glpat-): the span is the token" },
  { clause: 14, redact: true, printed: "region", lineForm: false, reason: "further provider prefix plus length (shpat_/shpss_/shpca_/shppa_): the span is the token" },
  { clause: 15, redact: true, printed: "region", lineForm: false, reason: "further provider prefix plus length (dop_v1_): the span is the token" },
  {
    clause: 16,
    redact: true, printed: "region", lineForm: false,
    reason: "signed JWT, optionally after 'Bearer ': a bearer credential, and the span holds the whole token",
  },
  {
    clause: 17,
    redact: false, printed: "predicate", lineForm: true,
    reason:
      "URI password: zero-width (an anchor and look-aheads only), so its match is empty and locates nothing; " +
      "the line is recognised only as a predicate (a residual)",
  },
  {
    clause: 18,
    redact: false, printed: "predicate", lineForm: true,
    reason:
      "secret-named key's value: zero-width (an anchor and look-aheads only), so its match is empty and locates " +
      "nothing; the line is recognised only as a predicate (a residual)",
  },
  {
    clause: 19,
    redact: false, printed: "predicate", lineForm: true,
    reason:
      "a secret-shaped value on its own: zero-width (an anchor and look-aheads only), so its match is empty and " +
      "locates nothing; the line is recognised only as a predicate (a residual)",
  },
  {
    clause: 20,
    redact: false, printed: "after", lineForm: true,
    reason:
      "environment-variable-shaped secret-named key: the span ends at the assignment operator, so it holds the " +
      "key name and never the value (the value outside every span is a residual)",
  },
  { clause: 21, redact: false, printed: "none", lineForm: false, reason: "platform keychain API call: an API name, not a secret" },
  { clause: 22, redact: false, printed: "none", lineForm: false, reason: "platform keychain attribute key: a constant name, not a secret" },
  { clause: 23, redact: false, printed: "none", lineForm: false, reason: "keychain wrapper type name: not a secret" },
  { clause: 24, redact: false, printed: "none", lineForm: false, reason: "keychain wrapper method call: not a secret" },
  { clause: 25, redact: false, printed: "none", lineForm: false, reason: "keychain wrapper import: not a secret" },
  {
    clause: 26,
    redact: true, printed: "region", lineForm: true,
    reason:
      "secret-named key's literal wherever the assignment stands: the key and operator are a look-behind, " +
      "so the matched span is the value alone",
  },
  {
    clause: 27,
    redact: true, printed: "region", lineForm: true,
    reason: "URI password whatever the host or position: the span is the password alone, between ':' and '@'",
  },
  {
    clause: 28,
    redact: false, printed: "after", lineForm: true,
    reason:
      "environment-variable-shaped key whose first segment is the secret word (added beside clause 20 " +
      "): as clause 20, the span ends at the " +
      "assignment operator, so it holds the key name and never the value (the value outside every span is a residual)",
  },
];

/** A clause's global copy, for iteration. */
const redactionCopy = (re: RegExp): RegExp => new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);

/**
 * A FOUND VALUE IS NEVER PRINTED IN PART. A
 * line-form clause (`lineForm` in the table above: 17-20, 26, 27 and 28) reads a value from its place on a line, after a key
 * and its operator or inside a URI, and one line cannot say where that value ends: in a .env, YAML or .properties value a
 * space, `;`, `#` or `//` is text, and any white space (a no-break space, a form feed) can stand before a comment. Three
 * checker rounds each found one more such ending (` ;`, then ` #`, then a space and the rest of a value), and each was
 * closed alone (the last by a clause-26 tail over ` ;` or ` #`, which this replaces). So the region a line-form match hides
 * is not where the clause stopped but the line from the value's start:
 * - it ENDS at the end of its line (before a CR or LF), whatever follows: the rest of a value, a comment, more keys, the
 *   next command of a shell line;
 * - it STARTS at the value's start: where the match stands inside a quoted literal, at that literal's start (a quoted
 *   value holding spaces or signs, of which a clause found the last run: the words before the run are the value too);
 *   where it stands unquoted, after the last `=` or `:` ahead of it when no space or tab stands between (`ab-<run>`).
 *   Never before that `=` or `:`, so the key name stays.
 * What follows a found value on its line is hidden with it, and another rule's finding on that line keeps its place but
 * shows the marker (the record's known issue 25 states that cost). The match itself (the candidate) is unchanged, and a
 * region only grows here. A clause added to `baseline-002` states `lineForm` in the table (the type requires it), and
 * test:line-text-redaction 11e fails a line-form clause no row of it names, and a clause that reads a line (`after`,
 * `predicate`) that is not marked.
 *
 * LINEAR IN THE TEXT, however many regions a line holds (the hostile one-line texts of lint:clause-cost): where each line
 * ends, which quoted literal is open and where the last operator stands are read once per text, in one pass, and only
 * when a line-form region is asked about.
 */
const LINE_FORM: ReadonlySet<number> = new Set(CREDENTIAL_CLAUSES.filter((c) => c.lineForm).map((c) => c.clause));
const LITERAL_QUOTES = "\"'`";
function lineFormBounds(text: string): (a: number, b: number) => [number, number] {
  type Tables = { lineEnd: Int32Array; literalStart: Int32Array; afterOperator: Int32Array; lastBlank: Int32Array };
  let tables: Tables | null = null;
  const read = (): Tables => {
    const n = text.length;
    const lineEnd = new Int32Array(n + 1);
    lineEnd[n] = n;
    for (let i = n - 1; i >= 0; i--) lineEnd[i] = text[i] === "\r" || text[i] === "\n" ? i : lineEnd[i + 1]!;
    // At each position, on its own line: the start of the quoted literal open there (after its opening quote), or -1;
    // the position after the last `=` or `:` before it and the spaces or tabs after that sign, or -1; the last space or
    // tab before it, or -1.
    const literalStart = new Int32Array(n + 1).fill(-1);
    const afterOperator = new Int32Array(n + 1).fill(-1);
    const lastBlank = new Int32Array(n + 1).fill(-1);
    let open = "";
    let from = -1;
    let op = -1;
    let blank = -1;
    const note = (i: number): void => {
      literalStart[i] = open === "" ? -1 : from;
      afterOperator[i] = op;
      lastBlank[i] = blank;
    };
    for (let i = 0; i < n; i++) {
      note(i);
      const ch = text[i]!;
      if (ch === "\r" || ch === "\n") {
        open = "";
        op = -1;
        blank = -1;
      } else if (open !== "" && ch === "\\") {
        if (i + 1 < n && text[i + 1] !== "\r" && text[i + 1] !== "\n") note(++i);
      } else {
        if (open === "" && LITERAL_QUOTES.includes(ch)) {
          open = ch;
          from = i + 1;
        } else if (ch === open) open = "";
        if (ch === " " || ch === "\t") blank = i;
        if (ch === "=" || ch === ":") {
          let j = i + 1;
          while (j < n && (text[j] === " " || text[j] === "\t")) j++;
          op = j;
        }
      }
    }
    note(n);
    return { lineEnd, literalStart, afterOperator, lastBlank };
  };
  return (a: number, b: number): [number, number] => {
    tables ??= read();
    const literal = tables.literalStart[a]!;
    const op = tables.afterOperator[a]!;
    let start = a;
    // Inside a literal, a sign is the key's only where no
    // blank stands between it and the found part, as unquoted: `"ab:cd <run>"` is hidden from the literal's start.
    if (literal >= 0) start = op >= 0 && tables.lastBlank[a]! < op ? Math.max(literal, op) : literal;
    else if (op >= 0 && tables.lastBlank[a]! < op) start = op;
    start = Math.min(start, a);
    return [start, Math.max(b, tables.lineEnd[b]!)];
  };
}

/** The redacting clauses of one loaded bundle, compiled, as global copies for iteration. */
export interface CredentialRedaction {
  patterns: readonly { clause: number; re: RegExp }[];
}

/**
 * The compiled redaction step from `baseline-002`'s compiled `match` array — `compileRules`' output
 * for that one rule, so a pattern is compiled exactly as the scan compiles it.
 */
export function compileCredentialRedaction(compiledMatch: readonly RegExp[]): CredentialRedaction {
  if (compiledMatch.length !== CREDENTIAL_CLAUSES.length) {
    throw new Error(
      `credential redaction: this program's own copy of ${CREDENTIAL_RULE_ID} (credential-rule.generated.ts) has ` +
        `${compiledMatch.length} match clause(s) and the redaction table in credential-redaction.ts describes ` +
        `${CREDENTIAL_CLAUSES.length}. The table says which clause locates a secret; with a different clause count it ` +
        `would redact by the wrong clauses. Nothing was scanned. This program was built from a rule its table does not ` +
        `describe: update the table from the rule's clause documentation and build again.`,
    );
  }
  return {
    patterns: CREDENTIAL_CLAUSES.filter((c) => c.redact).map((c) => ({ clause: c.clause, re: redactionCopy(compiledMatch[c.clause - 1]!) })),
  };
}

/** One redaction target of one candidate: a substring of its label, and the clause that located it. */
export type CredentialTarget = [target: string, clause: number];

/**
 * Every non-empty credential match in `text`, as [start, end, clause]; a line-form clause's from its value's start to the
 * end of its line (`lineFormBounds`), the search going on after that line's end.
 */
function credentialMatches(cr: CredentialRedaction, text: string): [number, number, number][] {
  const out: [number, number, number][] = [];
  const bounds = lineFormBounds(text);
  for (const { clause, re } of cr.patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length > 0) {
        if (LINE_FORM.has(clause)) {
          const [a, b] = bounds(m.index, m.index + m[0].length);
          out.push([a, b, clause]);
          re.lastIndex = Math.max(re.lastIndex, b);
        } else out.push([m.index, m.index + m[0].length, clause]);
      }
      if (re.lastIndex === m.index) re.lastIndex++;
    }
  }
  return out;
}

/** A fired label's clause component: the fired clause set, `"16"` or `"1,3"`. Anything else is a reading label. */
const FIRED = /^\d+(,\d+)*$/;

/**
 * The substrings of this candidate's label that hold credential material, found in `text` — the
 * text the kind facts were derived from (`kindFactsForCandidate`'s out-parameter), never the line on
 * disk, because a label taken from a resolved or joined reading is made of that reading.
 *
 * A FIRED label is the folded clause spans joined by `+`: each credential match overlapping a span
 * gives the fold of the overlap, which is a substring of that span's fold and so of the label. A
 * READING label (no clause set) is the normalised whole line, which drops string interiors: a
 * credential match not wholly inside a string literal gives the whole label. Sorted, so a candidate's
 * targets do not depend on the pattern order.
 */
export function credentialTargets(
  cr: CredentialRedaction,
  ruleClauses: RegExp[],
  facts: KindFacts,
  text: string,
): CredentialTarget[] {
  if (facts.matched_token.length === 0) return [];
  const creds = credentialMatches(cr, text);
  if (creds.length === 0) return [];
  const found = new Map<string, number>();
  const add = (t: string, clause: number): void => {
    if (t.length === 0) return;
    const was = found.get(t);
    if (was === undefined || clause < was) found.set(t, clause);
  };
  if (FIRED.test(facts.clause)) {
    const spans = spansOfClauses(ruleClauses, facts.clause.split(",").map(Number), text);
    for (const [a, b] of spans) {
      for (const [c, d, clause] of creds) {
        const lo = Math.max(a, c);
        const hi = Math.min(b, d);
        if (lo >= hi) continue;
        const t = foldToken(text.slice(lo, hi));
        // By construction a substring of the label; where it is not (a case fold that changes length),
        // the whole label is the target, so the credential cannot survive a mismatch.
        add(facts.matched_token.includes(t) ? t : facts.matched_token, clause);
      }
    }
  } else {
    const strings = stringRanges(clean(text));
    for (const [c, d, clause] of creds) {
      if (strings.some(([s, e]) => c >= s && d <= e)) continue;
      add(facts.matched_token, clause);
    }
  }
  return [...found].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1]));
}

/** The marker one redacted region becomes. */
export function redactionMarker(clause: number, region: string): string {
  return `[redacted:${CREDENTIAL_RULE_ID}#${clause}:${markerDigest(region)}]`;
}

/** One region of a text to redact, and the clause that located it. */
interface Region {
  a: number;
  b: number;
  clause: number;
}

/**
 * `text` with `regions` sorted by start (the longer first, then the lower clause), overlapping ones
 * merged into one region carrying the lowest clause, and each region replaced by its marker, whose
 * digest is of `digestForm(region)`.
 */
function replaceRegions(text: string, regions: Region[], digestForm: (region: string) => string): string {
  if (regions.length === 0) return text;
  regions.sort((x, y) => x.a - y.a || y.b - x.b || x.clause - y.clause);
  const merged: Region[] = [];
  for (const r of regions) {
    const last = merged[merged.length - 1];
    if (last !== undefined && r.a < last.b) {
      last.b = Math.max(last.b, r.b);
      last.clause = Math.min(last.clause, r.clause);
    } else merged.push({ ...r });
  }
  let out = "";
  let pos = 0;
  for (const r of merged) {
    out += text.slice(pos, r.a) + redactionMarker(r.clause, digestForm(text.slice(r.a, r.b)));
    pos = r.b;
  }
  return out + text.slice(pos);
}

/**
 * `label` with every occurrence of every target replaced, each merged region by its marker; the
 * digest is of the region as the label holds it, which is already a fold.
 */
export function redactLabel(label: string, targets: ReadonlyMap<string, number>): string {
  const regions: Region[] = [];
  for (const [t, clause] of targets) {
    if (t.length === 0) continue;
    for (let at = label.indexOf(t); at >= 0; at = label.indexOf(t, at + 1)) {
      regions.push({ a: at, b: at + t.length, clause });
    }
  }
  return replaceRegions(label, regions, (region) => region);
}

/**
 * `text`, kept verbatim from the source, with every non-empty match of a redacting clause replaced
 * by its marker. For a value that IS a captured piece of the line (an applicability evidence
 * `value`) there is no clause span to intersect, so every match in it is a region. The digest is of
 * the region's fold, which is what a label holds, so one credential carries one marker in a label
 * and in a value.
 */
export function redactCredentialText(cr: CredentialRedaction, text: string): string {
  const regions = credentialMatches(cr, text).map(([a, b, clause]) => ({ a, b, clause }));
  return replaceRegions(text, regions, foldToken);
}

/**
 * The applicability assessments with every evidence row's `value` through `redactCredentialText`:
 * `limbs[].supporting[]`, `limbs[].opposing[]` and `contradictions[].evidence[]`, the three places a
 * `LimbEvidence` row is written. Applied where findings.json is assembled (`scan.ts`) and where
 * reconcile-input.json is assembled (`reconcile.ts`), both after `assessScope`, so no verdict, count or
 * fact id is computed from a redacted value; a row with nothing to redact is the same object, and
 * every key keeps its position. `null` (a bundle without the rule, as a gate's may be) returns the
 * assessments as they are.
 */
export function redactEvidenceValues(
  assessments: ScopeAssessment[],
  cr: CredentialRedaction | null,
): ScopeAssessment[] {
  if (cr === null) return assessments;
  const row = (e: LimbEvidence): LimbEvidence => {
    const value = redactCredentialText(cr, e.value);
    return value === e.value ? e : { ...e, value };
  };
  return assessments.map((a) => ({
    ...a,
    limbs: a.limbs.map((l) => ({ ...l, supporting: l.supporting.map(row), opposing: l.opposing.map(row) })),
    contradictions: a.contradictions.map((c) => ({ ...c, evidence: c.evidence.map(row) })),
  }));
}

/**
 * Old label to new label, for every label some candidate of this run holds credential material in.
 *
 * THE UNION OVER EVERY CANDIDATE WITH THAT LABEL, keyed by the label alone: two candidates with the
 * same label get the same replacement even when only one of them located the credential (a
 * lower-cased copy of an upper-case key folds to the same label and matches no clause), so the new
 * label is a function of the old one and every same-kind group keeps exactly its members. The
 * candidates' order does not matter, so `--jobs` cannot decide it.
 */
export function redactedLabelsOf(
  matches: readonly { kindFacts?: KindFacts; kindRedactions?: readonly CredentialTarget[] }[],
): Map<string, string> {
  const targetsByLabel = new Map<string, Map<string, number>>();
  for (const m of matches) {
    if (m.kindFacts === undefined || m.kindRedactions === undefined) continue;
    const label = m.kindFacts.matched_token;
    const targets = targetsByLabel.get(label) ?? new Map<string, number>();
    for (const [t, clause] of m.kindRedactions) {
      const was = targets.get(t);
      if (was === undefined || clause < was) targets.set(t, clause);
    }
    targetsByLabel.set(label, targets);
  }
  const out = new Map<string, string>();
  for (const [label, targets] of targetsByLabel) {
    const next = redactLabel(label, targets);
    if (next !== label) out.set(label, next);
  }
  return out;
}

/* =================================================================================================
 * THE SAME RULE FOR WHAT THE REPORT AND THE EVIDENCE LOG PRINT.
 *
 *
 * WHY. Live run 2's report quoted credential-shaped values verbatim:
 * the redaction above runs only where findings.json is assembled, and the quotations and reasons
 * the seats typed reached the report and the evidence log as typed. The owner's rule: the report and the log
 * use the same rule as layer 1, and show the file and line and a marker, never the value.
 *
 * THE SAME CLAUSES, THE SAME MARKER. What counts as a credential is `baseline-002`'s own clauses, compiled from
 * the CLI's own copy by the caller (product-redaction.ts `productPrintedRedaction`, never a loaded bundle's), and a redacted
 * region becomes the marker layer 1 writes, `[redacted:baseline-002#<clause>:<16 hex>]`, the hex being
 * the keyed digest of the region's fold (redaction-key.ts `markerDigest`). No pattern is written here.
 *
 * WHAT DIFFERS FROM A LABEL, AND WHY. A label holds only clause spans or a line with its string interiors
 * dropped, so a clause whose match is empty never had anything to redact there. A printed text holds the
 * whole line the seat quoted or wrote about, so each clause says (the `printed` column of the table) where its
 * secret sits in such a text:
 * - `region`: the match is the credential (clauses 1-3, 5-16, and 26 and 27, whose key, operator or URI head is a
 *   look-behind so the match is the value alone), exactly as `redactCredentialText` treats it;
 * - `block`: the PEM header (clause 4) is an envelope, and the key is what follows it: the rest of the header's
 *   line and every later line of the text up to the END line;
 * - `after`: the environment-variable clauses (20, and 28 beside it) end at the assignment operator, so the value is the rest of
 *   the line after the match;
 * - `predicate`: the three clauses with an empty match (17 URI password, 18 secret-named key's value, 19 a
 *   secret-shaped value) recognise a line and locate nothing. The clause itself is asked where the value is:
 *   each quoted interior and each token of the line is blanked in turn, and of those whose blanking stops the
 *   clause, the rightmost is taken (in `name: 'value'`, `scheme://user:<password>@host` and `KEY=value` the value
 *   is the last part the clause depends on), repeatedly while the clause still matches. Where that does not
 *   stop every recognising clause, the whole line is the region, so the value cannot survive a text this rule
 *   recognised (layer 1's own fallback, `credentialTargets`);
 * - `none`: the keychain clauses (21-25) match API names, not secrets.
 * Whatever the mode, the region of a line-form clause (17-20, 26, 27 and 28) then runs from its value's start to the end of
 * its line (`lineFormBounds`, above), so no part of a value it found is printed.
 * A value quoted with backticks is tested as if quoted with `'`, as the report prints it (`code()` in
 * assemble-report.ts), so the report and the log recognise the same values.
 *
 * WHAT IT DOES NOT DO. It redacts only what these clauses recognise: a value no clause of `baseline-002`
 * treats as a credential is printed as it is. Of the four kinds run 2's reader named, the clauses recognise
 * one (a password literal in a reason); a PostHog project key has no clause (it is a public key by the
 * provider's design), a commented-out template line is outside clause 17 (comment lines are skipped, as in the
 * scan), and an instruction placeholder is outside clause 18 (the placeholder words). Since 2026-10-19
 * clauses 26 and 27 read the same two constructs without either refusal, so a commented-out URI password and a
 * credential-shaped value beside a placeholder word are now recognised and redacted here; the scan still skips
 * comment lines, which the engine blanks before any clause runs. Changing what is a credential is a change to
 * `baseline-002`, never to this file.
 * ================================================================================================= */

/** Where one clause's secret sits in a printed text; see the block above. */
export type PrintedMode = "region" | "block" | "after" | "predicate" | "none";

/** Every clause of `baseline-002` whose match can mark secret material in a printed text, compiled. */
export interface PrintedRedaction {
  clauses: readonly { clause: number; mode: Exclude<PrintedMode, "none">; re: RegExp }[];
}


/** The printed-text step from `baseline-002`'s compiled `match` array, refused on a clause-count mismatch. */
export function compilePrintedRedaction(compiledMatch: readonly RegExp[]): PrintedRedaction {
  if (compiledMatch.length !== CREDENTIAL_CLAUSES.length) {
    throw new Error(
      `credential redaction: this program's own copy of ${CREDENTIAL_RULE_ID} (credential-rule.generated.ts) has ` +
        `${compiledMatch.length} match clause(s) and the redaction table in credential-redaction.ts describes ` +
        `${CREDENTIAL_CLAUSES.length}. The table says where each clause's secret sits; with a different clause count it ` +
        `would redact by the wrong clauses. Nothing was written. This program was built from a rule its table does not ` +
        `describe: update the table from the rule's clause documentation and build again.`,
    );
  }
  const clauses: { clause: number; mode: Exclude<PrintedMode, "none">; re: RegExp }[] = [];
  for (const c of CREDENTIAL_CLAUSES) {
    if (c.printed === "none") continue;
    clauses.push({ clause: c.clause, mode: c.printed, re: redactionCopy(compiledMatch[c.clause - 1]!) });
  }
  return { clauses };
}

/** The program's own marker in a text: clause and digest. A seat's marker has another shape. */
export const PROGRAM_MARKER_RE = /\[redacted:baseline-002#(\d{1,2}):(?:[A-Za-z0-9_.-]{0,16}\+\d{1,7}-[Aa9x]{1,4}(?:-placeholder)?:)?([0-9a-f]{16})\]/g;

/** A text that begins with a program marker, bare or after one opening quote mark. */
const MARKER_FIRST = /^["'`]?\[redacted:baseline-002#\d{1,2}:(?:[A-Za-z0-9_.-]{0,16}\+\d{1,7}-[Aa9x]{1,4}(?:-placeholder)?:)?[0-9a-f]{16}\]/;

/**
 * A redaction marker, a seat's or this program's: one bracketed token (`[...]`, `<...>` or `(...)`, holding no bracket)
 * that names a redaction - `redact`, `redacted`, `redaction` or `redacts`, joined to no letter on either side. The one
 * definition: the quote check says "the quotation carries a
 * redaction marker" only of such a token (verdict-verify.ts `carriesMarker`), and the rule here takes a seat's bare one
 * for no value. Code that only names a redaction (`logger.info(redactSecret(cfg))`) holds none.
 */
const MARKER_WORD = String.raw`(?<![A-Za-z])redact(?:ed|ion|s)?(?![A-Za-z])`;
const MARKER_INSIDE = String.raw`[^\[\]<>()\n]*`;
export const REDACTION_MARKER_SOURCE = [String.raw`\[`, "<", String.raw`\(`]
  .map((open, i) => `${open}${MARKER_INSIDE}${MARKER_WORD}${MARKER_INSIDE}${[String.raw`\]`, ">", String.raw`\)`][i]}`)
  .join("|");
/** A new global, case-blind matcher of `REDACTION_MARKER_SOURCE`. */
export const redactionMarkerRe = (): RegExp => new RegExp(REDACTION_MARKER_SOURCE, "gi");
/**
 * A seat's marker the rule may pass over: one that holds nothing a credential could be (no run of 12 letters, digits or
 * token signs), so blanking it hides no value from a clause. `[REDACTED]`, `<redacted>`, `[redacted - value in .env]`.
 */
const bareMarker = (m: string): boolean => !/[A-Za-z0-9_+/=-]{12,}/.test(m.replace(/redact(?:ed|ion|s)?/gi, ""));
/** A value that is wholly one bare seat marker, bare or in one pair of quote marks, with at most a closing `,` or `;`. */
const WHOLLY_MARKER = new RegExp(String.raw`^(["'\x60]?)(${REDACTION_MARKER_SOURCE})\1\s*[,;]?\s*$`, "i");

/**
 * `line` with each program marker turned to spaces (the same length, so every other position holds). The clauses test
 * this, never the markers: a marker stands for a value already redacted, and a pass that took it for a value would
 * write a marker of the marker, whose digest is no longer the value's and restores nothing (live run 2's
 * written log passed through the rule once more changed 22 quotations, clause 18's marker becoming clause 20's).
 */
function blankMarkers(line: string): string {
  const ranges = markerRanges(line);
  if (ranges.length === 0) return line;
  let out = line;
  for (const [a, b] of ranges) out = out.slice(0, a) + " ".repeat(b - a) + out.slice(b);
  return out;
}

/**
 * Where `blankMarkers` blanks: each program marker, then each seat's bare marker (M2: `API_TOKEN=[REDACTED]` stands for
 * a value the seat did not copy, as the program's does) in the line with the program's blanked. In line order; they
 * never overlap. The one definition of which markers the clauses do not read (`blankMarkers`, `markersRemoved`).
 */
function markerRanges(line: string): [number, number][] {
  const out: [number, number][] = [];
  let program = line;
  if (line.includes("[redacted:baseline-002#")) {
    program = line.replace(PROGRAM_MARKER_RE, (m: string, ...rest: unknown[]) => {
      const at = rest[rest.length - 2] as number;
      out.push([at, at + m.length]);
      return " ".repeat(m.length);
    });
  }
  if (/redact/i.test(program)) for (const m of program.matchAll(redactionMarkerRe())) if (bareMarker(m[0])) out.push([m.index, m.index + m[0].length]);
  return out.sort((x, y) => x[0] - y[0]);
}

/**
 * Whether a marker at [a, b) TOUCHES a value: a letter or
 * digit in the run of value characters (`VALUE_CHAR` but `=`, which ends a key) directly before it or directly after it.
 * `"[REDACTED]Zq8x..."`, `"Zq8x...[REDACTED]"` and `[REDACTED]/Zq8x` touch one; `API_TOKEN=[REDACTED] and more`,
 * `"[REDACTED]"`, a marker before a full stop, and two markers side by side do not.
 */
const TOUCH_CHAR = /[A-Za-z0-9+/_.~-]/;
function touchesValue(text: string, a: number, b: number): boolean {
  for (let i = b; i < text.length && TOUCH_CHAR.test(text[i]!); i++) if (ALNUM.test(text[i]!)) return true;
  for (let i = a - 1; i >= 0 && TOUCH_CHAR.test(text[i]!); i--) if (ALNUM.test(text[i]!)) return true;
  return false;
}

/**
 * `line` with every marker `markerRanges` gives that touches
 * a value (`touchesValue`) REMOVED, not blanked, and for each character kept its position in `line` (`at`, one longer
 * than the text: the end maps to the line's end). Removed again until none is left, since the text either side of a
 * marker can join into another (`[re[REDACTED]dacted]`). A marker that touches no value stays where it is and is
 * blanked as before, so a value it stands for alone (`API_TOKEN=[redacted:...]`) is still read as redacted. Null where
 * no marker touches a value.
 */
function markersRemoved(line: string): { text: string; at: number[] } | null {
  let text = line;
  let at: number[] = Array.from({ length: line.length + 1 }, (_, i) => i);
  for (;;) {
    const ranges = markerRanges(text).filter(([a, b]) => touchesValue(text, a, b));
    if (ranges.length === 0) return text === line ? null : { text, at };
    let next = "";
    const nextAt: number[] = [];
    let pos = 0;
    for (const [a, b] of [...ranges, [text.length, text.length] as [number, number]]) {
      for (let i = pos; i < a; i++) nextAt.push(at[i]!);
      next += text.slice(pos, a);
      pos = Math.max(pos, b);
    }
    nextAt.push(line.length);
    text = next;
    at = nextAt;
  }
}

/**
 * A QUOTE MARK ESCAPED WITH BACKSLASHES. A word a record quotes with `JSON.stringify` holds
 * its own quotes escaped (`password = \"value\"`, or `\\\"` quoted twice), and a clause that looks for a quoted value
 * did not see one. Each run of backslashes before a quote mark is tested as the quote it stands for, the same length so
 * positions hold: where it closes a value (after a letter, digit or value character, other than an `=` that opens one)
 * the quote comes first and spaces after it, anywhere else the spaces come first, so the quote stands next to the value
 * it bounds either way. Nothing is removed: the backslashes are only not in the way of the clause.
 */
const ESCAPED_QUOTE = /(\\+)(["'`])/g;
const VALUE_CHAR = /[A-Za-z0-9+/=_.~-]/;
function unescapedQuotes(line: string): string {
  if (!line.includes("\\")) return line;
  return line.replace(ESCAPED_QUOTE, (m: string, run: string, q: string, at: number) => {
    const prev = line[at - 1] ?? "";
    const next = line[at + m.length] ?? "";
    const closes = VALUE_CHAR.test(prev) && !(prev === "=" && VALUE_CHAR.test(next));
    return closes ? q + " ".repeat(run.length) : " ".repeat(run.length) + q;
  });
}

/**
 * `text` as the clauses test it: a backtick quotes a value as `'` does, and an escaped quote mark is the quote it stands
 * for (same length, so positions hold).
 */
const testView = (line: string): string => unescapedQuotes(line).split("`").join("'");

/** Does `re` match `line` at all (an empty match counts: that is how a predicate clause answers)? */
function matches(re: RegExp, line: string): boolean {
  re.lastIndex = 0;
  const hit = re.exec(line) !== null;
  re.lastIndex = 0;
  return hit;
}

/** Every non-empty match of `re` in `line`, as [start, end]. */
function spans(re: RegExp, line: string): [number, number][] {
  const out: [number, number][] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m[0].length > 0) out.push([m.index, m.index + m[0].length]);
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  re.lastIndex = 0;
  return out;
}

/**
 * THE WHOLE VALUE WHEREVER ITS HEAD IS FOUND. The
 * secret-named literal clause (26) reads a value whole where its whole-value forms take it; where they decline it (a
 * `{name}` or `#{` inside, a `::`, a backslash-u escape), an older form of the same clause still reads the head of the
 * value in its narrower alphabet, and the rest of the value would be printed and handed to a seat in clear, under a
 * length that is the head's. So a region of that clause runs on to the value's end: where the character before it opens
 * a quoted literal, to that literal's closing quote on the line (a backslash escape and a doubled quote are inside it);
 * otherwise, or where no closing quote follows, to the end of the run of characters that are not space or a quote mark.
 * A region is only ever made longer here, so this can hide more and never less.
 *
 * LINEAR IN THE LINE, however many regions it holds (found by lint:clause-cost's hostile `k0-element` text, many
 * elements on one line with no space: each region read on to the line's end made the redaction quadratic). The run's
 * end is one right-to-left pass, made once per line when first asked; a closing quote is searched once per literal,
 * and a later region inside the stretch an earlier search crossed takes the same answer (it is never before the
 * region's own end, so a region still only grows).
 */
const VALUE_CLAUSE = 26;
const QUOTE_MARKS = "\"'`";
function valueEnds(line: string): (a: number, b: number) => number {
  let breakAt: Int32Array | null = null;
  const runEnd = (b: number): number => {
    if (breakAt === null) {
      breakAt = new Int32Array(line.length + 1);
      breakAt[line.length] = line.length;
      for (let i = line.length - 1; i >= 0; i--) breakAt[i] = /\s/.test(line[i]!) || QUOTE_MARKS.includes(line[i]!) ? i : breakAt[i + 1]!;
    }
    return breakAt[b]!;
  };
  // Per quote mark, the last search: [from, to, the closing quote's index, or -1 where none followed].
  const searched = new Map<string, [number, number, number]>();
  return (a: number, b: number): number => {
    const open = a > 0 ? line[a - 1]! : "";
    if (open === "" || !QUOTE_MARKS.includes(open)) return runEnd(b);
    const was = searched.get(open);
    if (was !== undefined && b >= was[0] && b < was[1]) return was[2] >= b ? was[2] : runEnd(b);
    for (let e = b; e < line.length; e++) {
      const ch = line[e]!;
      if (ch === "\\") e++;
      else if (ch === open) {
        if (line[e + 1] === open) e++;
        else {
          searched.set(open, [b, e, e]);
          return e;
        }
      }
    }
    searched.set(open, [b, line.length, -1]);
    return runEnd(b);
  };
}

const ALNUM = /[A-Za-z0-9]/;
/** A token: a maximal run of characters that are not space, a quote mark or a separator a value ends at. */
const TOKEN_RE = /[^\s"'`=:,;(){}[\]<>]+/g;
const PEM_END = /-----END[ A-Z]*PRIVATE KEY-----/;

/**
 * The parts of one line a predicate clause may stand on: every interior between two consecutive quote marks of
 * one kind, and every token, each holding a letter or digit. Sorted by end, then by start, so "the rightmost"
 * is the last.
 */
function valueCandidates(view: string): [number, number][] {
  const out: [number, number][] = [];
  for (const q of ["'", '"']) {
    let prev = -1;
    for (let i = view.indexOf(q); i >= 0; i = view.indexOf(q, i + 1)) {
      if (prev >= 0 && ALNUM.test(view.slice(prev + 1, i))) out.push([prev + 1, i]);
      prev = i;
    }
  }
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(view)) !== null) if (ALNUM.test(m[0])) out.push([m.index, m.index + m[0].length]);
  return out.sort((x, y) => x[1] - y[1] || x[0] - y[0]);
}

/** `view` with the given spans turned to spaces (the same length, so every other position holds). */
function blanked(view: string, cut: readonly [number, number][]): string {
  if (cut.length === 0) return view;
  const units = view.split("");
  for (const [a, b] of cut) for (let i = a; i < b; i++) units[i] = " ";
  return units.join("");
}

/** The first and last non-space positions of a line, as a region: the whole line, for the fallback. */
function wholeLine(line: string): [number, number] | null {
  const a = line.search(/\S/);
  if (a < 0) return null;
  // `trimEnd` removes what `\s` matches; `/\s+$/` read every inner run of spaces again to the line's end.
  return [a, line.trimEnd().length];
}

interface LineRegion {
  a: number;
  b: number;
  clause: number;
}

/**
 * AN ASSIGNMENT INSIDE A SENTENCE. The clauses that read a key and its value were written for
 * a line of code: clause 20 is anchored where its line begins, clause 18's and 19's unquoted value where it ends, and the
 * comment and placeholder words they decline are looked for over the whole line. A printed text is a sentence, and the
 * assignment stands inside it (`` `SMTP_PASSWORD=...` ``, `const cfg = API_TOKEN=...;`, `holds API_TOKEN=... on this
 * line`), so the same clauses are ALSO asked of each assignment the line holds, cut out as a line of its own: from each
 * place a key can begin (a quote mark, letter or underscore after a character that is not part of a word) through the
 * key, an operator the clauses accept (`=>`, `=`, `:`, `,`) and its value (a quoted value to its closing quote, an
 * unquoted one to the next space or quote mark, without the sentence's closing punctuation). This only says where to
 * look; what is a credential is still each clause's own answer, and the whole line is asked as before.
 */
const WORD_BEFORE = /[A-Za-z0-9_]/;
const KEY_START = /["'A-Za-z_]/;
const UNQUOTED_END = /[\s"']/;
const CLOSING_PUNCTUATION = /[;,.:)\]}>]/;
/** A character of a key after its first: `[A-Za-z0-9_.$-]`. */
const KEY_CHAR = /[A-Za-z0-9_.$-]/;
const KEY_FIRST = /[A-Za-z_]/;

/*
 * Each assignment of a test view, as [start, end): see the block above. READ ONCE. A key starts after every
 * `.`, `:` or `=` inside an unbroken run (`token1=token1=...`, `c:c:c:...`), and the form this replaces read each one's
 * key, value and closing punctuation to the run's end again: the square of the run. The ends are now taken from tables
 * built in one pass from the right (where each key run ends, where each unquoted value ends, where each quote mark next
 * stands) and one from the left (where each run of closing punctuation starts). The windows are the same: the key and
 * operator are what `["']?[A-Za-z_][A-Za-z0-9_.$-]*["']?[ \t]*(?:=>|[:=]|,)[ \t]*` matched where the key starts, which
 * can only end at its key run's end (no key character is a quote, a space or an operator), and the value as before.
 */
function assignmentWindows(view: string): [number, number][] {
  const out: [number, number][] = [];
  if (!/[=:,]/.test(view)) return out;
  const n = view.length;
  const keyRunEnd = new Int32Array(n + 1);
  const valueEnd = new Int32Array(n + 1);
  const nextSingle = new Int32Array(n + 1);
  const nextDouble = new Int32Array(n + 1);
  keyRunEnd[n] = n;
  valueEnd[n] = n;
  nextSingle[n] = -1;
  nextDouble[n] = -1;
  for (let i = n - 1; i >= 0; i--) {
    const c = view[i];
    keyRunEnd[i] = KEY_CHAR.test(c) ? keyRunEnd[i + 1] : i;
    valueEnd[i] = UNQUOTED_END.test(c) ? i : valueEnd[i + 1];
    nextSingle[i] = c === "'" ? i : nextSingle[i + 1];
    nextDouble[i] = c === '"' ? i : nextDouble[i + 1];
  }
  const closeRunStart = new Int32Array(n + 1);
  closeRunStart[0] = 0;
  for (let i = 1; i <= n; i++) closeRunStart[i] = CLOSING_PUNCTUATION.test(view[i - 1]) ? closeRunStart[i - 1] : i;
  for (let p = 0; p < n; p++) {
    if (!KEY_START.test(view[p]) || (p > 0 && WORD_BEFORE.test(view[p - 1]))) continue;
    const q = keyThenOperatorEnd(view, p, keyRunEnd);
    if (q < 0) continue;
    let e: number;
    if (view[q] === '"' || view[q] === "'") {
      const close = q + 1 > n ? -1 : (view[q] === '"' ? nextDouble : nextSingle)[q + 1];
      e = close < 0 ? n : close + 1;
    } else {
      e = Math.max(q, closeRunStart[valueEnd[q]]);
    }
    if (e > q) out.push([p, e]);
  }
  return out;
}

/**
 * Where `["']?[A-Za-z_][A-Za-z0-9_.$-]*["']?[ \t]*(?:=>|[:=]|,)[ \t]*` matched at `p` ends, or -1 where it did not. A key
 * character is none of a quote, a space or an operator, so no shorter key run could have been followed by one: the only
 * end the pattern could reach is its key run's end, and from there each part takes the most it can.
 */
function keyThenOperatorEnd(view: string, p: number, keyRunEnd: Int32Array): number {
  let i = p;
  if (view[i] === '"' || view[i] === "'") i++;
  if (i >= view.length || !KEY_FIRST.test(view[i])) return -1;
  i = keyRunEnd[i + 1];
  if (view[i] === '"' || view[i] === "'") i++;
  while (view[i] === " " || view[i] === "\t") i++;
  if (view[i] === "=" && view[i + 1] === ">") i += 2;
  else if (view[i] === ":" || view[i] === "=" || view[i] === ",") i++;
  else return -1;
  while (view[i] === " " || view[i] === "\t") i++;
  return i;
}

/*
 * THE WORK BOUND. Asking the clauses of each assignment inside a line, and blanking
 * value after value until a clause lets go, is work that grows faster than the line where one line holds many
 * assignments nested in one run: each is a window to the run's end, asked of every clause and blanked candidate by
 * candidate. No rewrite in form only was reachable for it in this unit. So the characters handed to a clause or blanked
 * on one line are counted, and past `LINE_WORK_LIMIT` the line stops being read part by part and is MASKED WHOLE: every
 * character of it goes into one marker, so it hides everything the full reading would have hidden and more, never less,
 * and the line ends in `LINE_MASKED_NOTE`, so the person reads that it was. The count is of characters, never of time,
 * so the same line gives the same output on every machine.
 *
 * The limit is 1,000,000 characters and 200 more per character of the line: 2,000,000 on a 5,000-character line, about
 * 30 ms of clause tests there. Measured: every fixture line counts under 33,000, and of
 * 392,955 real candidate-shaped lines of the 170-tree corpus 99.99 % count under 620,000; the few over the limit are long
 * lines of minified code holding hundreds of assignments in one run, which the full reading took about a quarter of a
 * second each to read (see the record for how many, and their times).
 */
export const LINE_WORK_LIMIT_BASE = 1_000_000;
export const LINE_WORK_LIMIT_PER_CHARACTER = 200;
/*
 * WHAT AN AFTER CLAUSE HANDED A WINDOW COSTS. The count is of characters, and a character is charged by
 * what reading it costs where it is read. Timed per site (the time from one
 * charge to the next, over the 30,962 distinct hostile lines of section 3 whose count passes half the limit), an
 * after clause asked of an assignment window reads 0.5 ns per character on average and 4.0 at worst, where every other
 * site reads 16 to 22 on average (and 37 to 62 at worst): the windows overlap to the run's end, and each was charged its
 * whole length, so lines whose count was mostly these windows were masked whole while reading in 12 ms, faster than
 * lines left unmasked. So a window's characters are charged to an after clause at one in AFTER_WINDOW_CHARACTERS_PER_UNIT
 * (its worst, 32 ns per charged character, stays under the other sites' worst); every other site is unchanged, and so
 * is the limit. The predicate clauses asked of each window are NOT reduced: they read 20 ns per character, as the rest.
 */
export const AFTER_WINDOW_CHARACTERS_PER_UNIT = 8;
export const LINE_MASKED_NOTE = " (masked whole - this line holds too many assignments to check one by one)";

class OverWorkLimit extends Error {}
interface Work {
  left: number;
}
function spend(work: Work, characters: number): void {
  work.left -= characters;
  if (work.left < 0) throw new OverWorkLimit();
}

/**
 * The predicate clauses' regions in one view: for each clause that matches it, the rightmost part it depends on is blanked,
 * until it no longer matches or nothing stops it. `resolved` is false where a clause still matches. Every clause test
 * and every blanking is counted against `work`; a blanking with nothing to blank returns the view itself and copies
 * nothing, so it counts nothing (the count is of the work done).
 */
function resolvePredicates(
  view: string,
  predicates: readonly { clause: number; re: RegExp }[],
  work: Work,
): { chosen: [number, number][]; resolved: boolean } {
  const chosen: [number, number][] = [];
  let resolved = true;
  const asks = (re: RegExp, text: string): boolean => {
    spend(work, text.length);
    return matches(re, text);
  };
  for (const p of predicates) {
    for (let guard = 0; guard < 8; guard++) {
      if (chosen.length > 0) spend(work, view.length);
      const current = blanked(view, chosen);
      if (!asks(p.re, current)) break;
      spend(work, current.length);
      const cands = valueCandidates(current).filter(([a, b]) => !chosen.some(([c, d]) => a < d && c < b));
      let pick: [number, number] | null = null;
      for (let i = cands.length - 1; i >= 0; i--) {
        spend(work, current.length);
        if (!asks(p.re, blanked(current, [cands[i]]))) {
          pick = cands[i];
          break;
        }
      }
      if (!pick) break;
      chosen.push(pick);
    }
    if (chosen.length > 0) spend(work, view.length);
    if (asks(p.re, blanked(view, chosen))) resolved = false;
  }
  return { chosen, resolved };
}

/**
 * The regions of one line (of a printed text) that hold secret material, by the clauses' modes. `pemOpen` says
 * whether an earlier line of the same text opened a PEM block that has not ended; the returned flag says whether
 * one is open after this line. `whole` says the line passed the work bound and is masked whole (see above). A
 * line-form clause's region runs from its value's start to the line's end (`lineFormBounds`), whichever reading and
 * mode found it.
 */
function lineRegions(
  pr: PrintedRedaction,
  line: string,
  pemOpen: boolean,
  limit = LINE_WORK_LIMIT_BASE + LINE_WORK_LIMIT_PER_CHARACTER * line.length,
): { regions: LineRegion[]; pemOpen: boolean; whole: boolean; spent: number } {
  return toValueBounds(line, lineRegionsRead(pr, line, pemOpen, limit));
}

/** `r` with each line-form clause's region run from its value's start to the line's end (`lineFormBounds`). */
function toValueBounds<R extends { regions: LineRegion[]; whole: boolean }>(line: string, r: R): R {
  if (r.whole || !r.regions.some((g) => LINE_FORM.has(g.clause))) return r;
  const bounds = lineFormBounds(line);
  const regions = r.regions.map((g) => {
    if (!LINE_FORM.has(g.clause) || g.b <= g.a) return g;
    const [a, b] = bounds(g.a, g.b);
    return { a, b, clause: g.clause };
  });
  return { ...r, regions };
}

function lineRegionsRead(
  pr: PrintedRedaction,
  line: string,
  pemOpen: boolean,
  limit: number,
): { regions: LineRegion[]; pemOpen: boolean; whole: boolean; spent: number } {
  /* A MARKER NEVER EXEMPTS THE VALUE IT TOUCHES. The clauses
   * read the line with every marker blanked (below), so a marker is never taken for a value. Blanked to spaces, a marker
   * that touches a value inside its quote marks (`password = "[REDACTED]<value>"`, a program-shaped marker before it, or
   * one after it) leaves a quoted value holding spaces, which no clause takes, and the value was printed and handed to
   * a seat in clear. So the line is read a second time with the markers REMOVED, the value then standing as if no
   * marker were there, and each region found is mapped back onto the line. Every region of either reading is kept:
   * this can hide more and never less, and a text already redacted reads the same both ways (its markers removed, no
   * value is left), so a second pass still changes nothing. Each reading is held to the work bound on its own. */
  const first = lineRegionsOnce(pr, line, pemOpen, limit);
  if (first.whole) return first;
  const cut = markersRemoved(line);
  if (cut === null) return first;
  const second = lineRegionsOnce(pr, cut.text, pemOpen, limit);
  const spent = first.spent + second.spent;
  const open = first.pemOpen || second.pemOpen;
  if (second.whole) return { regions: [{ a: 0, b: line.length, clause: Math.min(...second.regions.map((g) => g.clause)) }], pemOpen: open, whole: true, spent };
  const regions = [...first.regions];
  for (const g of second.regions) if (g.b > g.a) regions.push({ a: cut.at[g.a]!, b: cut.at[g.b - 1]! + 1, clause: g.clause });
  return { regions, pemOpen: open, whole: false, spent };
}

function lineRegionsOnce(
  pr: PrintedRedaction,
  line: string,
  pemOpen: boolean,
  limit: number,
): { regions: LineRegion[]; pemOpen: boolean; whole: boolean; spent: number } {
  const regions: LineRegion[] = [];
  // Every clause tests the line with the program's own markers blanked: a marker is a value already redacted, so no
  // clause may take it (or its digest) for a value, and a second pass over a redacted text changes nothing.
  const plain = blankMarkers(line);
  let open = pemOpen;
  if (open) {
    if (PEM_END.test(line)) open = false;
    else {
      const w = wholeLine(plain);
      if (w) regions.push({ a: w[0], b: w[1], clause: 4 });
    }
  }
  const view = testView(plain);
  const windows = assignmentWindows(view);
  const predicates: { clause: number; re: RegExp }[] = [];
  const predicateClauses: { clause: number; re: RegExp }[] = [];
  const afterClauses: { clause: number; re: RegExp }[] = [];
  // The value after an `after` clause's operator, up to `end`: unless it is already a marker (bare or opened by a quote
  // mark), or holds no letter or digit (the closing backtick of a printed quotation), nothing being left to redact then.
  const afterValue = (b: number, end: number, clause: number): void => {
    const rest = line.slice(b, end);
    const lead = rest.length - rest.replace(/^\s+/, "").length;
    const value = line.slice(b + lead, end);
    const seatMarker = WHOLLY_MARKER.exec(value);
    if (b + lead < end && !MARKER_FIRST.test(line.slice(b + lead)) && !(seatMarker && bareMarker(seatMarker[2] ?? "")) && ALNUM.test(value)) regions.push({ a: b + lead, b: end, clause });
  };
  for (const { clause, mode, re } of pr.clauses) {
    if (mode === "region") {
      // Clause 26's region runs to its value's end (valueEnds, above): a head found by an older form is never a tail left.
      const end = clause === VALUE_CLAUSE ? valueEnds(plain) : (_a: number, b: number): number => b;
      for (const [a, b] of spans(re, view)) regions.push({ a, b: end(a, b), clause });
      // And on the line as written (markers blanked), the text the scan's own clause reads. The view turns an
      // escaped quote into a plain one beside a space, which is right for a clause that wants a quoted value and wrong for
      // clause 26, which reads a value AFTER an escaped quote inside a literal (`"ab\"<value>"`): on the view that value
      // stands outside every literal. A region is only ever added here, so this can hide more and never less.
      for (const [a, b] of spans(re, plain)) regions.push({ a, b: end(a, b), clause });
    } else if (mode === "after") {
      // Where the clause matches the line, the value is the rest of the line; where it matches an assignment inside it
      // (assignmentWindows, below the loop), the rest of that assignment.
      const end = line.trimEnd().length;
      for (const [, b] of spans(re, view)) afterValue(b, end, clause);
      afterClauses.push({ clause, re });
    } else if (mode === "block") {
      for (const [, b] of spans(re, view)) {
        open = !PEM_END.test(line.slice(b));
        const tail = plain.slice(b).replace(PEM_END, "");
        const lead = tail.length - tail.replace(/^\s+/, "").length;
        const body = tail.trim();
        // Key material holds a letter or digit; the closing backtick of a printed BEGIN line does not.
        if (body.length > 0 && ALNUM.test(body)) regions.push({ a: b + lead, b: b + lead + body.length, clause });
      }
    } else {
      predicateClauses.push({ clause, re });
      if (matches(re, view)) predicates.push({ clause, re });
    }
  }
  // Below, every clause test and blanking is counted (THE WORK BOUND above). A region pushed before the bound is passed
  // stays; the whole line covers it.
  const work: Work = { left: limit };
  try {
    for (const { clause, re } of afterClauses) {
      for (const [s, e] of windows) {
        spend(work, Math.ceil((e - s) / AFTER_WINDOW_CHARACTERS_PER_UNIT));
        for (const [, b] of spans(re, view.slice(s, e))) afterValue(s + b, e, clause);
      }
    }
    const taken: [number, number][] = [];
    let wholeLineTaken = false;
    if (predicates.length > 0) {
      const { chosen, resolved } = resolvePredicates(view, predicates, work);
      const clauseOf = Math.min(...predicates.map((p) => p.clause));
      if (resolved) {
        for (const [a, b] of chosen) regions.push({ a, b, clause: clauseOf });
        taken.push(...chosen);
      } else {
        const w = wholeLine(plain);
        if (w) regions.push({ a: w[0], b: w[1], clause: clauseOf });
        wholeLineTaken = true;
      }
    }
    // The same clauses asked of each assignment inside the line, with what the line's own answer took blanked, so a value
    // is not taken twice. Where a clause still matches an assignment after every blanking, the assignment is the region.
    // The blanked view is made again only when `taken` has grown.
    if (!wholeLineTaken) {
      let takenView = blanked(view, taken);
      let takenCount = taken.length;
      for (const [s, e] of windows) {
        if (taken.length !== takenCount) {
          spend(work, view.length);
          takenView = blanked(view, taken);
          takenCount = taken.length;
        }
        const here = takenView.slice(s, e);
        const asked = predicateClauses.filter((p) => {
          spend(work, here.length);
          return matches(p.re, here);
        });
        if (asked.length === 0) continue;
        const { chosen, resolved } = resolvePredicates(here, asked, work);
        const clauseOf = Math.min(...asked.map((p) => p.clause));
        if (resolved) {
          for (const [a, b] of chosen) {
            regions.push({ a: s + a, b: s + b, clause: clauseOf });
            taken.push([s + a, s + b]);
          }
        } else {
          regions.push({ a: s, b: e, clause: clauseOf });
          taken.push([s, e]);
        }
      }
    }
  } catch (e) {
    if (!(e instanceof OverWorkLimit)) throw e;
    const clause = Math.min(...afterClauses.concat(predicateClauses).map((p) => p.clause));
    regions.push({ a: 0, b: line.length, clause });
    return { regions, pemOpen: open, whole: true, spent: limit - work.left };
  }
  return { regions, pemOpen: open, whole: false, spent: limit - work.left };
}

/**
 * How many characters one line's reading counts against THE WORK BOUND, read with no bound, and the bound it is held to.
 * For the gates and the record; the redaction itself never calls it.
 */
export function lineWork(pr: PrintedRedaction, line: string): { spent: number; limit: number } {
  const r = lineRegions(pr, line, false, Number.MAX_SAFE_INTEGER);
  return { spent: r.spent, limit: LINE_WORK_LIMIT_BASE + LINE_WORK_LIMIT_PER_CHARACTER * line.length };
}

/** `regions` sorted, and overlapping ones merged into one carrying the lowest clause: the regions a line's markers stand for. */
function mergedRegions(regions: readonly LineRegion[]): LineRegion[] {
  const sorted = [...regions].sort((x, y) => x.a - y.a || y.b - x.b || x.clause - y.clause);
  const merged: LineRegion[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && r.a < last.b) {
      last.b = Math.max(last.b, r.b);
      last.clause = Math.min(last.clause, r.clause);
    } else merged.push({ ...r });
  }
  return merged;
}

/**
 * `line` with its regions (overlapping ones merged, the lowest clause kept) replaced by their markers; with `valueFree`,
 * by the marker without its digest (`[redacted:baseline-002#<clause>]`), which holds nothing of the value.
 */
function markLine(line: string, regions: LineRegion[], mode: MarkMode = "digest"): string {
  if (regions.length === 0) return line;
  const merged = mergedRegions(regions);
  let out = "";
  let pos = 0;
  for (const r of merged) {
    out +=
      line.slice(pos, r.a) +
      (mode === "value-free"
        ? `[redacted:${CREDENTIAL_RULE_ID}#${r.clause}]`
        : mode === "seat"
          ? `[redacted:${CREDENTIAL_RULE_ID}#${r.clause}:${seatShape(line.slice(r.a, r.b))}:${markerDigest(foldToken(line.slice(r.a, r.b)))}]`
          : redactionMarker(r.clause, foldToken(line.slice(r.a, r.b))));
    pos = r.b;
  }
  return out + line.slice(pos);
}

/**
 * A printed text with every credential region the clauses recognise replaced by its marker, line by line. A
 * text with nothing to redact is returned as the same string; a text already redacted is unchanged (a marker
 * holds nothing any clause recognises).
 */
export function redactPrintedText(pr: PrintedRedaction, text: string): string {
  return markText(pr, text, "digest");
}

/**
 * THE VALUE-FREE FORM OF A TEXT: the text with every
 * region `redactPrintedText` would mark replaced by `[redacted:baseline-002#<clause>]`, a marker with no digest. For a
 * digest that is written where others may read it and that must be the same on every computer: a finding's id
 * (scan.ts `fingerprint` over the line), a location's sub-shape and a census fact's id. A digest of the line itself
 * would let anyone holding the file recover a guessable credential on it by hashing candidates, as the unkeyed marker
 * did; the value-free form holds nothing of the value, so two lines that differ only in their secret are one shape.
 * A text with nothing to redact is returned as the same string, so no other digest moves.
 */
export function valueFreeText(pr: PrintedRedaction, text: string): string {
  return markText(pr, text, "value-free");
}

/**
 * THE SEAT'S FORM OF A TEXT: what a payload's code
 * windows carry, so a credential on a candidate's line never reaches the person's model provider through WolfBoy's
 * payloads. Every region `redactPrintedText` would mark is replaced by `[redacted:baseline-002#<clause>:<shape>:<digest>]`:
 * the digest is the printed marker's own (so a seat's quotation of it is restored and checked as before), and the shape
 * (`seatShape`) keeps what tells a test key from a live one and a real value from a placeholder without any of the
 * secret: a provider's documented non-secret prefix, the length of the rest, and its kinds of character. A text with
 * nothing to redact is returned as the same string, so a window without a credential is byte for byte what it was.
 */
export function redactSeatText(pr: PrintedRedaction, text: string): string {
  return markText(pr, text, "seat");
}

/**
 * Providers' documented key prefixes, which name the kind of key and never any of its secret (a Stripe key's mode, an
 * AWS key's kind, a token's issuer): the only characters of a redacted value a seat is shown. Longest first.
 */
export const SEAT_KEPT_PREFIXES: readonly string[] = [
  "sk_live_", "sk_test_", "sk_org_", "pk_live_", "pk_test_", "rk_live_", "rk_test_", "whsec_",
  "AKIA", "ASIA",
  "github_pat_", "ghp_", "gho_", "ghu_", "ghs_", "ghr_",
  "xoxb-", "xoxp-", "xoxa-", "xoxr-", "xoxs-", "xapp-",
  "AIza",
  "sk-ant-api03-", "sk-ant-admin01-", "sk-ant-", "sk-proj-", "sk-svcacct-", "sk-admin-",
  "SG.", "npm_", "glpat-", "shpat_", "shpss_", "shpca_", "shppa_", "dop_v1_", "phc_", "phx_", "eyJ",
].sort((x, y) => y.length - x.length);

/**
 * THE MARK RESTS ON SHAPE OR ON A PROVIDER'S PUBLISHED EXAMPLE, NEVER ON A WORD. `-placeholder` tells a seat that a value
 * is not a key anyone was issued, so a seat can tell `sk_live_xxxxxxxx...` from a live key without being shown either.
 * Two things earn it and nothing else: a run of three or more `x` or `*` (alone, or after a kept provider prefix), and a
 * provider's own published example value, each cited below.
 *
 * Until 2026-11-12 a list of words (`example`, `dummy`, `your_password` ...) also earned it, as words "never run with".
 * Every round found a word on such a list that systems really run with: `changeit` (the JDK `cacerts` trust store's
 * password) and `changeme` (Elasticsearch 5's built-in `elastic` user) in the second, and in the third `example`, the
 * working password of the official Docker postgres image's documented compose file ("Use postgres/example
 * user/password credentials", docker-library/docs `postgres/compose.yaml`, read 2026-11-12). Any word can be a deployed
 * password, and the mark tells a seat "plainly documentation" before it judges, so a word list can only cost a hidden
 * finding. No word is marked; a word is shown by its length and kinds like any other value, and whether it is a
 * template's or a running system's is the seat's to judge from the file. Adding a word list back is a change to the
 * adjudicator's sentence on the mark and fails `test:r10-scan` section 13.
 */
/**
 * PROVIDERS' OWN PUBLISHED EXAMPLE VALUES,
 * exactly as published (case kept): the value is the documentation's, never a key anyone was issued. Each is cited.
 * - AWS, "Configuration and credential file settings in the AWS CLI"
 *   (https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html, read 2026-11-11): the access key IDs
 *   `AKIAIOSFODNN7EXAMPLE`, `AKIAI44QH8DHBEXAMPLE`, `ASIAIOSFODNN7EXAMPLE`, `ASIAI44QH8DHBEXAMPLE` and the secret access
 *   keys `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`, `je7MtGbClwBF/2Zp9Utk/h3yCo8nvbEXAMPLEKEY`.
 */
export const SEAT_PROVIDER_EXAMPLE_VALUES: readonly string[] = [
  "AKIAIOSFODNN7EXAMPLE", "AKIAI44QH8DHBEXAMPLE", "ASIAIOSFODNN7EXAMPLE", "ASIAI44QH8DHBEXAMPLE",
  "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "je7MtGbClwBF/2Zp9Utk/h3yCo8nvbEXAMPLEKEY",
];
const PLACEHOLDER_RUN = /^(?:x{3,}|\*{3,})$/i;

/**
 * Whether a value (its quote marks removed) is shown not to be an issued key: a run of three or more `x` or `*`, alone
 * or after a kept provider prefix (`sk_live_xxxx...`); or, whole, one of `SEAT_PROVIDER_EXAMPLE_VALUES`. No word.
 */
export function isSeatPlaceholder(value: string, kept = ""): boolean {
  if (SEAT_PROVIDER_EXAMPLE_VALUES.includes(value)) return true;
  const rest = value.startsWith(kept) ? value.slice(kept.length) : value;
  return PLACEHOLDER_RUN.test(rest);
}

/**
 * A redacted value's shape: `<kept prefix>+<length of the rest>-<kinds>`, the kinds being A (capital letters), a (small
 * letters), 9 (digits) and x (anything else), in that order, and `-placeholder` after them where the value's shape or
 * source shows it is not an issued key (`isSeatPlaceholder`). `sk_test_+24-Aa9` is a Stripe test key with 24 more
 * letters and digits; `sk_live_+24-a-placeholder` is a run of `x` after the prefix; `+8-a-placeholder` is `xxxxxxxx`;
 * `+7-a` is seven small letters, whatever word they spell. Quote marks around the value are not counted.
 */
export function seatShape(region: string): string {
  const v = region.replace(/^[\s"'`]+/, "").replace(/[\s"'`,;]+$/, "");
  const kept = SEAT_KEPT_PREFIXES.find((p) => v.startsWith(p) && v.length > p.length) ?? "";
  const rest = v.slice(kept.length);
  const kinds =
    (/[A-Z]/.test(rest) ? "A" : "") + (/[a-z]/.test(rest) ? "a" : "") + (/[0-9]/.test(rest) ? "9" : "") + (/[^A-Za-z0-9]/.test(rest) ? "x" : "");
  return `${kept}+${Math.min(rest.length, 9_999_999)}-${kinds === "" ? "x" : kinds}${isSeatPlaceholder(v, kept) ? "-placeholder" : ""}`;
}

type MarkMode = "digest" | "value-free" | "seat";

function markText(pr: PrintedRedaction, text: string, mode: MarkMode): string {
  if (text.length === 0) return text;
  const lines = text.split("\n");
  let pemOpen = false;
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const r = lineRegions(pr, lines[i], pemOpen);
    pemOpen = r.pemOpen;
    if (r.regions.length === 0) continue;
    const next = markLine(lines[i], r.regions, mode) + (r.whole ? LINE_MASKED_NOTE : "");
    if (next !== lines[i]) {
      lines[i] = next;
      changed = true;
    }
  }
  return changed ? lines.join("\n") : text;
}

/**
 * A LINE THAT WAS CUT BEFORE IT COULD BE REDACTED. The engine keeps a candidate's line trimmed
 * and cut at 300 characters (engine.ts `lineText`), and the `--progress-detail candidates` stream redacts that cut
 * text: a credential straddling the cut no longer matches its clause, and its first characters would print in clear.
 * Where the text reaches `cutAt` characters, its last unbroken run (no space, quote, bracket or separator) is dropped
 * before the redaction, because that run is the one a cut can have split; a text shorter than `cutAt` was never cut
 * and is redacted whole. The whole line is redacted wherever the writer still has it (reconcile.ts, the census and
 * the discovery); this is for a reader that has only the cut text.
 */
export function redactCutText(pr: PrintedRedaction, text: string, cutAt: number): string {
  return redactPrintedText(pr, text.length >= cutAt ? text.slice(0, lastRunStart(text)) : text);
}

/** Where a cut text's last unbroken run starts: what `/[^\s"'`,;()<>{}[\]]+$/` would remove, found from the right in one
 * pass. That pattern read a run again from each of its positions when a separator followed it. */
const RUN_BREAK = /[\s"'`,;()<>{}[\]]/;
function lastRunStart(text: string): number {
  let a = text.length;
  while (a > 0 && !RUN_BREAK.test(text[a - 1])) a--;
  return a;
}

/**
 * Every string inside `value` (object values and array elements, at any depth, and every object's keys: a field keyed by a path or a word the project chose holds project text as
 * a key) through `redactPrintedText`, IN PLACE; an object whose keys change is rebuilt with its keys in their order. In place on purpose: the report's items hold the log's own verdict objects, so
 * one pass over the log redacts both. Returns how many strings changed.
 */
export function redactStringsInPlace(pr: PrintedRedaction, value: unknown): number {
  let n = 0;
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        if (typeof v[i] === "string") {
          const next = redactPrintedText(pr, v[i] as string);
          if (next !== v[i]) {
            v[i] = next;
            n++;
          }
        } else walk(v[i]);
      }
    } else if (v !== null && typeof v === "object") {
      const o = v as Record<string, unknown>;
      for (const k of Object.keys(o)) {
        if (typeof o[k] === "string") {
          const next = redactPrintedText(pr, o[k] as string);
          if (next !== o[k]) {
            o[k] = next;
            n++;
          }
        } else walk(o[k]);
      }
      const keys = Object.keys(o);
      const nextKeys = keys.map((k) => redactPrintedText(pr, k));
      if (nextKeys.some((k, i) => k !== keys[i])) {
        const vals = keys.map((k) => o[k]);
        for (const k of keys) delete o[k];
        nextKeys.forEach((k, i) => {
          o[k] = vals[i];
        });
        n += nextKeys.filter((k, i) => k !== keys[i]).length;
      }
    }
  };
  walk(value);
  return n;
}

/**
 * THE MARKER RESTORED FROM THE FILE, FOR THE QUOTE CHECK. A log this program wrote carries its own
 * markers inside quotations, and step 7's re-check, a later `verdict-verify --log` and a carried verdict's check
 * all read that log. A marker is never trusted: each one is replaced by the text in the named file whose fold has
 * its digest, and the quotation so restored goes through the ordinary check, which confirms it only where the whole
 * of it is in the file. The candidates are what this rule redacts in the file's own lines (so a region is found
 * exactly as it was made), every quoted interior, token and whole line, near the declared lines first and then
 * anywhere in the file. A marker no candidate answers is left as it is, and the check then treats the quotation as
 * a redacted one. Returns the restored text and how many markers were and were not restored.
 */
/**
 * The first way a marker is restored: by the quotation's own text around it. The quotation's literal parts, each run
 * of whitespace in them standing for any run, are searched for in the file with one line-bounded group where each
 * marker stands (a marker that ends its line runs to the line's last non-space character, one that begins a line from
 * its first); a match whose every group has its marker's digest gives the restored quotation, in which only the
 * markers are replaced. This finds a region however this rule made it, including where the seat quoted part of a line
 * the rule reads differently whole (a commented line quoted without its comment mark). Null where no match has every
 * digest.
 */
function restoreByContext(quote: string, source: string): string | null {
  const pieces = quote.split(PROGRAM_MARKER_RE);
  // split() with two groups: [literal, clause, digest, literal, clause, digest, ..., literal]
  const literals: string[] = [];
  const digests: string[] = [];
  for (let i = 0; i < pieces.length; i += 3) {
    literals.push(pieces[i]);
    if (i + 2 < pieces.length) digests.push(pieces[i + 2]);
  }
  const esc = (t: string): string =>
    t
      .split(/(\s+)/)
      .map((part, k) => (k % 2 === 1 ? "\\s+" : part.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")))
      .join("");
  let pattern = "";
  for (let i = 0; i < digests.length; i++) {
    const before = literals[i];
    const after = literals[i + 1];
    if (i === 0) pattern += before.length === 0 || /\n[ \t]*$/.test(before) ? `${esc(before)}(?:^|(?<=\\n))[ \\t]*` : esc(before);
    const endsLine = after.length === 0 || /^[ \t]*(\n|$)/.test(after);
    pattern += endsLine ? "([^\\n]*?)(?=[ \\t]*(?:\\n|$))" : "([^\\n]*?)";
    pattern += esc(after);
  }
  let re: RegExp;
  try {
    re = new RegExp(pattern, "g");
  } catch {
    return null;
  }
  /* A MARKER AT A CUT. A seat may quote a line only up to some point - a value cut short, or a line
   * quoted up to the end of what it needed - and the redaction of what the seat typed then makes a marker of the value AS
   * QUOTED: the rest of the quoted line after `NAME=` (clause 20), not the rest of the file's line. Where the quotation
   * ENDS at its last marker, that marker may stand for any first part of what the file's line holds there, so the
   * group the pattern took (to the line's end) is tried at every shorter length; where the quotation BEGINS at its first
   * marker, at every later start. Only the digest decides, as for every other marker, and the restored quotation is a
   * run of the file's own text, so the ordinary check still confirms it only where the whole of it is in the file. A
   * quotation that is one marker and nothing else names no context, and is restored only the second way below. */
  const cutEnd = digests.length > 0 && literals[digests.length] === "" && !(digests.length === 1 && literals[0] === "");
  const cutStart = digests.length > 0 && literals[0] === "" && !(digests.length === 1 && literals[1] === "");
  const fits = (g: string, d: string): boolean => markerDigest(foldToken(g)) === d;
  for (let m = re.exec(source); m !== null; m = re.exec(source)) {
    const groups = m.slice(1);
    if (groups.length === digests.length && groups.every((g) => g !== undefined)) {
      const take = groups.map((g, i): string | null => {
        if (fits(g, digests[i])) return g;
        if (i === digests.length - 1 && cutEnd) for (let n = g.length - 1; n > 0; n--) if (fits(g.slice(0, n), digests[i])) return g.slice(0, n);
        if (i === 0 && cutStart) for (let n = 1; n < g.length; n++) if (fits(g.slice(n), digests[i])) return g.slice(n);
        return null;
      });
      if (take.every((g) => g !== null)) {
        let k = 0;
        return quote.replace(PROGRAM_MARKER_RE, () => take[k++] as string);
      }
    }
    re.lastIndex = m.index + 1;
  }
  return null;
}

export function restoreProgramMarkers(
  pr: PrintedRedaction,
  quote: string,
  source: string,
  declaredLines: readonly number[],
): { text: string; restored: number; unresolved: number } {
  const markers = [...quote.matchAll(PROGRAM_MARKER_RE)].map((m) => m[2]);
  if (markers.length === 0) return { text: quote, restored: 0, unresolved: 0 };
  const byContext = restoreByContext(quote, source);
  if (byContext !== null) return { text: byContext, restored: markers.length, unresolved: 0 };
  const wanted = new Set(markers);
  const lines = source.split("\n");
  /* Every candidate text per digest, in the order found. A digest is of the region's FOLD, so two different texts
   * (`"value",` and `value`) can share it: every one is kept, and the combination whose restored quotation is in the
   * file is taken below (verification of this unit's first replay: the first-found candidate restored a quotation
   * that is in no file). */
  const cands = new Map<string, string[]>();
  const offer = (region: string): void => {
    if (region.length === 0) return;
    const d = markerDigest(foldToken(region));
    if (!wanted.has(d)) return;
    const list = cands.get(d) ?? [];
    if (!list.includes(region)) list.push(region);
    cands.set(d, list);
  };
  const seen = new Set<number>();
  const scan = (from: number, to: number): void => {
    let pemOpen = false;
    for (let i = Math.max(0, from); i < Math.min(lines.length, to); i++) {
      const line = lines[i];
      const read = lineRegionsRead(pr, line, pemOpen, LINE_WORK_LIMIT_BASE + LINE_WORK_LIMIT_PER_CHARACTER * line.length);
      pemOpen = read.pemOpen;
      if (seen.has(i)) continue;
      seen.add(i);
      // Each region the line's markers stand for
      // (line forms to the line's end, merged, as `markLine` prints them), and each region as its clause read it, as
      // before. Each widened region is not offered on its own: every one runs to the line's end, so that would read the
      // line once per region, and a marker stands only for a merged one.
      for (const g of mergedRegions(toValueBounds(line, read).regions)) offer(line.slice(g.a, g.b));
      for (const g of read.regions) offer(line.slice(g.a, g.b));
      for (const [a, b] of valueCandidates(testView(line))) offer(line.slice(a, b));
      const w = wholeLine(line);
      if (w) offer(line.slice(w[0], w[1]));
    }
  };
  // The declared lines first, then forty lines either side, then the whole file for a digest still unanswered.
  if (declaredLines.length > 0) {
    const lo = Math.min(...declaredLines);
    const hi = Math.max(...declaredLines);
    scan(lo - 1, hi);
    scan(lo - 41, hi + 40);
  }
  if ([...wanted].some((d) => !cands.has(d))) scan(0, lines.length);
  /* A marker the file holds AS TEXT (planted there) stands for
   * itself too: the seat was shown it as the file's own characters beside the value redacted after it. Only a
   * combination whose restored quotation is in the file is taken as found (below), so this never lets a marker stand
   * for a value the file does not hold. */
  const written = [...quote.matchAll(PROGRAM_MARKER_RE)].map((m) => m[0]);
  const lists = markers.map((d, i) => [...(cands.get(d) ?? []), ...(source.includes(written[i]!) && !(cands.get(d) ?? []).includes(written[i]!) ? [written[i]!] : [])]);
  const unresolved = lists.filter((l) => l.length === 0).length;
  if (unresolved > 0) return { text: quote, restored: 0, unresolved };
  const fill = (choice: readonly number[]): string => {
    let k = 0;
    return quote.replace(PROGRAM_MARKER_RE, () => lists[k][choice[k++]]);
  };
  // The combinations in order of preference, at most 256; the first whose text is in the file wins, else the first.
  const choice = lists.map(() => 0);
  for (let tried = 0; tried < 256; tried++) {
    const text = fill(choice);
    if (source.includes(text)) return { text, restored: markers.length, unresolved: 0 };
    let i = choice.length - 1;
    while (i >= 0 && choice[i] === lists[i].length - 1) choice[i--] = 0;
    if (i < 0) break;
    choice[i]++;
  }
  return { text: fill(lists.map(() => 0)), restored: markers.length, unresolved: 0 };
}
