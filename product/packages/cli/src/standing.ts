/**
 * THE `standing` BLOCK.
 *
 * The review seat answers, for every finding it lets stand (`violation_candidate`, `needs_human`), a short structured
 * block: what the finding is (`status`), which of the rule's legal bases it stands on (`duty`), what kind of data and
 * whose (`data`, `people`), how it runs (`runs`), who gets or keeps the data (`reaches`), whether the code is in what
 * ships (`ships`), the one quotation it stands on (`decisive`), in at most 20 words what happens to the people
 * (`effect`), and on `needs_human` what settles it (`settles`). Every part that moves the order is a closed-list value
 * tied to a quotation (`at`); the effect is shown, never read for order.
 *
 * CHECKED, NEVER REFUSED (section 2.5, following harvest H10's `inertDismissals`): a part that fails its check is set
 * aside and recorded (`standing_set_aside[]` on the record), and the verdict is kept. Only a `standing` that is not an
 * object is dropped whole, and that is recorded too. A set-aside part takes its heaviest value for the order
 * (`HEAVIEST`), and the report says so (W13).
 *
 * WHAT THE SEAT NEVER ANSWERS (section 2.3, D4): who the product serves (children, a health context) is only the
 * person's answer; the closed lists hold no such value, so a seat cannot set it. The penalty tier of a duty is never
 * the seat's either: it comes from the program's table (penalty-tier.ts, D5).
 */

import { STANDING_REF_ID, anchored, basisIndexOf, evidenceIndexOf } from "./ref-ids.js";
import { schemaDocument } from "./schema-validate.js";

/**
 * Every value of `status` a record may hold. `exempt`: the
 * line at `at` shows the shape the rule's own legal basis exempts, and `exemption` names the basis and the limb. The
 * capture's S1 accepts it with its own part (S8, WP1).
 */
export const STANDING_STATUS = ["duty_unmet", "duty_met", "waits_on_answer", "exempt"] as const;
export type StandingStatus = (typeof STANDING_STATUS)[number];
export const STANDING_DATA = [
  "contact",
  "identifier",
  "content",
  "records_about_people",
  "images_or_video_of_people",
  "audio_of_people",
  "location",
  "biometric_template",
  "special_category_field",
  "criminal_or_violence_field",
  "credential",
  "financial",
  "no_personal_data",
] as const;
export const STANDING_PEOPLE = ["account_holders", "visitors", "people_recorded", "operator_staff", "nobody"] as const;
export const STANDING_RUNS = ["default", "default_setting_fixes", "feature_in_use", "non_default_setting"] as const;
/** `readable_at_rest`: stored where whoever obtains the file, device or profile can read it; counted as exposing. */
export const STANDING_REACHES = ["third_party", "anyone_on_path", "other_users", "readable_at_rest", "operator_only", "kept", "not_about_data", "nobody"] as const;
/**
 * Every value of `ships` a record may hold. `documentation`: text
 * that describes the product (a documentation site's content, a README), not the product. `development` covers CI,
 * build tooling and code that runs only when a developer changes it. The capture's S1 accepts `documentation` with its
 * `at`, as every value but `depends_on_deployment` (WP1).
 */
export const STANDING_SHIPS = ["product", "documented_example", "maker_site", "documentation", "development", "test", "depends_on_deployment"] as const;
export type StandingShips = (typeof STANDING_SHIPS)[number];
/** The `ships` values that say a place is not part of the shipped product (design section 2.2, row 4). Every other value ships. */
export const NOT_SHIPPED: ReadonlySet<string> = new Set(["documentation", "development", "test"]);
/** The data kinds the order counts as severe (section 3.2; the yardstick's severe kinds). */
export const SEVERE_DATA: ReadonlySet<string> = new Set([
  "images_or_video_of_people",
  "audio_of_people",
  "location",
  "biometric_template",
  "special_category_field",
  "criminal_or_violence_field",
  "credential",
  "financial",
]);
/** `reaches` values the order counts as exposing (section 3.2, with section 9 item 3's `readable_at_rest`). */
export const EXPOSING_REACHES: ReadonlySet<string> = new Set(["third_party", "anyone_on_path", "other_users", "readable_at_rest"]);
export const EFFECT_MAX_WORDS = 20;
/** `element`: an element name the rule declares, or at most this many words. */
export const ELEMENT_MAX_WORDS = 12;
/** `exemption.limb`: the limb of the basis that exempts, in at most this many words. */
export const LIMB_MAX_WORDS = 12;
/** `fact.words`: a fact no question of the program's list carries, one English line of at most this many words. */
export const FACT_MAX_WORDS = 20;

export type StandingPart =
  | "status"
  | "question"
  | "duty"
  | "data"
  | "people"
  | "runs"
  | "reaches"
  | "ships"
  | "decisive"
  | "effect"
  | "settles"
  | "element"
  | "exemption"
  | "fact"
  | "same_as";
/**
 * Every part a record's `standing` may hold. The last four:
 * `element` (on `duty_met`: which part of the duty the status line meets), `exemption` (on `exempt`: `{basis, limb}`),
 * `fact` (on `waits_on_answer` where no question of the program's list carries the fact: `{words, about}`) and `same_as`
 * (the line of the processing this finding was traced to, `{file, line, quote}`). The capture checks each (WP1:
 * `checkStanding`, S2-S5 and S8).
 */
export const STANDING_PARTS: readonly StandingPart[] = ["status", "question", "duty", "data", "people", "runs", "reaches", "ships", "decisive", "effect", "settles", "element", "exemption", "fact", "same_as"];

/**
 * THE PROGRAM'S "DOES IT SHIP" PREMISE: decided once per
 * file at scan time from the repository's own build and tooling files, handed to the seat as a premise it may contradict
 * with a quotation, never used to skip a file. Unknown ships. Each premise maps to the `ships` value a seat would write
 * (`SHIPS_OF_PREMISE`), which is what fills a `ships` the seat left out.
 */
export const SHIPS_PREMISES = ["product", "ci", "build_tooling", "development", "test", "docs_site", "documentation", "outside_artifacts", "unknown"] as const;
export type ShipsPremise = (typeof SHIPS_PREMISES)[number];
export const SHIPS_OF_PREMISE: Readonly<Record<ShipsPremise, StandingShips>> = {
  product: "product",
  ci: "development",
  build_tooling: "development",
  development: "development",
  test: "test",
  docs_site: "maker_site",
  documentation: "documentation",
  outside_artifacts: "development",
  unknown: "depends_on_deployment",
};
/**
 * THE PREMISE DECIDES "NOT SHIPPED" ONLY FOR TWO CLASSES. Every
 * premise still describes its file to the seat (the brief's lines), but only `test` and `development`, which ships-premise.ts
 * gives only by a toolchain's own named convention (Go `_test.go` and `testdata/`, Maven and Gradle `src/test` and the
 * Android source sets, rspec `spec/`, pytest's `test_*.py` and `*_test.py` names, its ini files and conftest (not its
 * `testpaths`, section 14), Rust `tests/` and `benches/`, a test file under a package that names a test runner; Rails
 * `config/environments/development.rb`, dev-container files inside their own `.devcontainer/` folder (section 14),
 * `//go:build ignore` or `tools`, `Procfile.dev`, `Tiltfile`), lend a not-shipped `ships` value. Every other class (`ci`,
 * `build_tooling`, `documentation`, `docs_site`, `outside_artifacts` and any added later) is information only: it lends
 * no not-shipped value, so it never fills a seat's `ships`, never stands in for a quotation, never decides row 4 for a
 * kept place, and never counts as the premise agreeing in the second look. Three non-author checks in a row found new
 * shapes where those classes called an operations job, a deployed site or a shipped file not shipped; since the opt-in
 * they moved no finding to row 4 on either target tree, so their power to hide is taken away instead of their reading
 * refined. A seat may still write a not-shipped `ships` for such a file with the line that shows it.
 */
export const PREMISES_THAT_DECIDE: ReadonlySet<ShipsPremise> = new Set<ShipsPremise>(["test", "development"]);
/** The `ships` value a premise lends a place: its own for a deciding class or a shipped value, else null (it lends none, and the place ships). */
export function shipsLentByPremise(premise: ShipsPremise): StandingShips | null {
  const v = SHIPS_OF_PREMISE[premise];
  return NOT_SHIPPED.has(v) && !PREMISES_THAT_DECIDE.has(premise) ? null : v;
}

/**
 * A RULE'S ROLE: `duty_check` (the default, and the value of
 * a rule that declares none) says whether a duty is met; `inventory` records that processing exists, so a finding of it
 * is a record unless the seat writes `duty_unmet` with the line that puts a duty at risk. A rule declares `inventory`
 * only where its own `evidence_template` says a match establishes existence only (rule.schema.json `finding_role`).
 */
export const FINDING_ROLES = ["duty_check", "inventory"] as const;
export type FindingRole = (typeof FINDING_ROLES)[number];
export const DEFAULT_FINDING_ROLE: FindingRole = "duty_check";
/**
 * THE INVENTORY DEFAULT: a rule's role as the
 * program reads it. `inventory` only where the rule declares exactly that value; a rule that declares none, or any
 * other value, is `duty_check`, so a role the rule did not establish never takes a finding out of "to fix".
 */
export function findingRoleOf(rule: unknown): FindingRole {
  const declared = typeof rule === "object" && rule !== null && !Array.isArray(rule) ? (rule as { finding_role?: unknown }).finding_role : undefined;
  return declared === "inventory" ? "inventory" : DEFAULT_FINDING_ROLE;
}

/**
 * WHAT A RULE'S DUTY IS ABOUT (rule.schema.json `duty_about`, the one place that says which rules are such). AN OPT-IN, NEVER AN OPT-OUT:
 * `product_runtime` says the duty attaches only to what the product does when it runs, so a file outside every shipped
 * artifact (a test, a development or CI file, a documentation page) cannot create it, and only such a rule's finding may
 * take the not-shipped row of the disposition. A rule that declares nothing never takes that row: the opt-out list this
 * replaced hid every rule it forgot (baseline-002 listed a live credential in a test, CI or Markdown file as not part of
 * the shipped product). `release_supply_documentation` stays as an explicit value that behaves exactly as no declaration:
 * it records that the duty was weighed and is about how the product is released, supplied or documented (the CRA's
 * information and supply duties, a published interface description), which a silent absence cannot say.
 */
export const DUTY_ABOUTS = ["product_runtime", "release_supply_documentation"] as const;
export type DutyAbout = (typeof DUTY_ABOUTS)[number];
/** The one value under which whether a file ships may decide the count (disposition row 4). */
export const SHIPS_MAY_DECIDE: DutyAbout = "product_runtime";
/**
 * THE LOCATION GROUNDS ARE THE OPT-IN'S, IN THE PROGRAM TOO, the
 * third re-check's R-2. A refuter's overturn on one of these says where the line sits, whether it runs or whether it
 * ships; the seat texts confine each to a rule whose block carries `duty_about: product_runtime`, and the capture now
 * refuses such an overturn of any other rule's finding (`locationOverturnRefused`), as it refuses a seat's
 * `rest: generated_or_fixture_path` there (reading.ts). An adjudicator's `not_applicable` carries its reason only in
 * `reasoning`, free text, so the program cannot refuse one on where the line sits; the governing sentence does.
 * The refusal names no other ground: naming what is left
 * invites the same reasoning under another label. It says only that the ground does not apply here, and what the seat judges.
 */
export const LOCATION_GROUNDS: ReadonlySet<string> = new Set(["non-production-code", "doc-example", "dead-code", "server-side-context", "already-gated"]);
/** One sentence refusing a refuter's overturn on a location ground for a rule that does not opt in; null where it may stand. */
export function locationOverturnRefused(entry: { outcome?: unknown; grounds?: unknown; mode?: unknown }, rule: unknown): string | null {
  if (entry.outcome !== "overturned" || entry.mode === "challenge" || typeof entry.grounds !== "string" || !LOCATION_GROUNDS.has(entry.grounds)) return null;
  if (dutyAboutOf(rule) === SHIPS_MAY_DECIDE) return null;
  return `\`grounds\` ${JSON.stringify(entry.grounds)} says where the line sits or whether it runs, which does not apply to a rule whose block does not carry \`"duty_about": "${SHIPS_MAY_DECIDE}"\`, as this rule's block does not: judge only whether the line is the construct the rule names`;
}
/**
 * Whether a refuter's answer is an ordinary overturn on a location ground that
 * stands: the ground is one of `LOCATION_GROUNDS` and the rule opts in, so `locationOverturnRefused` lets it through. Such an
 * overturn is due a second look at every level (second-look.ts `locationChallengeOf`): the ground's words can be true of
 * the file while the rule's duty still arises there.
 */
export function locationOverturnStands(entry: { outcome?: unknown; grounds?: unknown; mode?: unknown }, rule: unknown): boolean {
  return isLocationOverturn(entry) && dutyAboutOf(rule) === SHIPS_MAY_DECIDE;
}
/**
 * Whether a refuter's answer is an ordinary overturn on a location ground, whatever its rule: the part of
 * `locationOverturnStands` that the answer alone decides. An answer for which this is false is due no second look for its
 * location, so the launch side can say so before it reads the findings document that holds the rule's `duty_about`.
 */
export function isLocationOverturn(entry: { outcome?: unknown; grounds?: unknown; mode?: unknown }): boolean {
  return entry.outcome === "overturned" && entry.mode !== "challenge" && typeof entry.grounds === "string" && LOCATION_GROUNDS.has(entry.grounds);
}
/**
 * The grounds an ordinary overturn may give, read from the verdict schema (`refutation.grounds`), the one list the capture
 * holds a refuter's reply to. Read once, on first use.
 */
let listedGrounds: ReadonlySet<string> | null = null;
export function refutationGrounds(): ReadonlySet<string> {
  if (listedGrounds === null) {
    const doc = schemaDocument("verdict.schema.json") as { properties?: { refutation?: { properties?: { grounds?: { enum?: unknown } } } } };
    const listed = doc.properties?.refutation?.properties?.grounds?.enum;
    listedGrounds = new Set(Array.isArray(listed) ? listed.filter((g): g is string => typeof g === "string") : []);
  }
  return listedGrounds;
}
/**
 * Whether an ordinary overturn gives its ground as exactly one listed string. The capture's schema refuses any other shape,
 * but a record that did not pass through the capture (one placed by hand, or handed to the assembly in process) is not
 * checked there; an overturn whose ground is not listed (another case, trailing space, an unknown word, a list, none) says
 * nothing the program can place, so it never stands. True for every answer that is not an ordinary overturn.
 */
export function overturnGroundListed(entry: { outcome?: unknown; grounds?: unknown; mode?: unknown }): boolean {
  if (entry.outcome !== "overturned" || entry.mode === "challenge") return true;
  return typeof entry.grounds === "string" && refutationGrounds().has(entry.grounds);
}
/**
 * Why a refuter's ordinary answer cannot be used, so the first review's word stands as if no answer were given: its ground is
 * not one listed (`overturnGroundListed`), or it is a location ground of a rule that does not opt in
 * (`locationOverturnRefused`). Null where the answer can be used. The one test both readers of a refuter's answer ask: the
 * assembly, which sets such an answer aside and says why, and the count of the answers so far, which the person reads while
 * the review runs, so the two never place one answer two ways.
 */
export function refutationUnusable(entry: { outcome?: unknown; grounds?: unknown; mode?: unknown }, rule: unknown): "ground_not_listed" | "location_ground" | null {
  if (!overturnGroundListed(entry)) return "ground_not_listed";
  return locationOverturnRefused(entry, rule) !== null ? "location_ground" : null;
}
/** A rule's `duty_about` as the program reads it: a value of `DUTY_ABOUTS` only where the rule declares exactly that, else undefined (declares nothing). */
export function dutyAboutOf(rule: unknown): DutyAbout | undefined {
  const declared = typeof rule === "object" && rule !== null && !Array.isArray(rule) ? (rule as { duty_about?: unknown }).duty_about : undefined;
  return (DUTY_ABOUTS as readonly unknown[]).includes(declared) ? (declared as DutyAbout) : undefined;
}

/**
 * THE KIND OF A DECLARATION QUESTION AND WHAT AN ANSWER SETTLES.
 * `scope`: who the product is offered to or what kind of service it is (an out-of-scope answer from a confirmed record
 * settles every rule whose precondition names the field); `condition`: a fact the operating organisation or the maker
 * holds that meets or fails a duty's condition; `feature`: whether the product has a feature the code can also show (an
 * answer never removes a launch; a contradiction asks the person to check the answer); `order`: moves the order only.
 * An option's `settles_as` says what a finding waiting on the question becomes: `out_of_scope` (the rule is settled),
 * `met` (recorded), `stands` (to fix), `maker` (for each organisation that runs the product). Where each field's kind
 * and each option's value live is the question package's to decide: inside an `x-question` they would move its R1
 * digest (declaration.ts `questionDigest`) and ask every confirmed answer again.
 */
export const QUESTION_KINDS = ["scope", "condition", "feature", "order"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];
export const SETTLES_AS = ["out_of_scope", "met", "stands", "maker"] as const;
export type SettlesAs = (typeof SETTLES_AS)[number];
/** The parts the order reads; a missing or set-aside one takes `HEAVIEST`. */
export const ORDER_PARTS: readonly StandingPart[] = ["status", "duty", "data", "runs", "reaches", "ships"];

/** A quotation a part points at: an `evidence[]` entry (`E<n>`), a kept place row (`P<n>`), or a line of the tree. */
export type StandingAt = string | { file: string; line: number; quote: string };

/** The block as the record holds it: only parts that passed their checks. */
export interface StandingRecord {
  status?: { value: string; at: StandingAt };
  question?: { value: string; at: StandingAt };
  duty?: { value: string[]; at: StandingAt };
  data?: { value: string[]; at: StandingAt };
  people?: { value: string[]; at: StandingAt };
  runs?: { value: string; at: StandingAt };
  reaches?: { value: string; at: StandingAt };
  /**
   * `premise`: the value is the program's premise for the
   * decisive place's file (findings.json `ships_premises`, its `because` lines checked against the tree), written where
   * the seat left `ships` out, its own value was set aside, or it agreed with the premise without a quotation of its own.
   */
  ships?: { value: string; at?: StandingAt; premise?: { file: string; value: ShipsPremise } };
  decisive?: string;
  effect?: string;
  settles?: string;
  /** On `duty_met`: which part of the duty the status line meets. */
  element?: string;
  /** On `exempt`: `basis` an `L<n>` of the rule's own `legal_basis_refs`, `limb` the exempting limb in words. */
  exemption?: { basis: string; limb: string };
  /** On `waits_on_answer` where no question of the program's list carries it: the fact in words and the basis it concerns. */
  fact?: { words: string; about: string };
  /** The line of the processing this finding was traced to (the fold's key (b), design section 6.1). */
  same_as?: { file: string; line: number; quote: string };
}
export interface StandingSetAside {
  /** The part, or `standing` where the whole value was not an object. */
  part: StandingPart | "standing";
  /** The value the seat gave, as given. */
  value: unknown;
  why: string;
}

/** The heaviest value of each order part (section 2.5): a set-aside or missing part is placed as if it were this. */
export const HEAVIEST = {
  status: "duty_unmet",
  data: ["special_category_field"],
  runs: "default",
  reaches: "third_party",
  ships: "depends_on_deployment",
} as const;

export interface StandingCheckInput {
  /** The verdict the seat gave: the block belongs on `violation_candidate` and `needs_human`. */
  verdict: string;
  /** The verdict's own `evidence[]` (E1 is its first entry: ref-ids.ts). */
  evidence: unknown;
  /** The ids (`P<n>`, from `P0`: ref-ids.ts) of this candidate's places a seat kept and the place checks passed (C4, C5, C7). */
  keptPlaces: ReadonlySet<string>;
  /** How many entries the candidate's `legal_basis_refs` holds: `duty.value` names them `L1`..`Ln` (ref-ids.ts). */
  bases: number;
  /** The program's closed list of question ids (every profile field carrying an `x-question`). */
  questions: ReadonlySet<string>;
  /**
   * C9's rule for a `{file, line, quote}` at (the file is in the tree, the quote stands at the line by `quoteStanding`,
   * the seat's Reads cover it): the line it stands at, or a reason it does not. Absent: no tree at hand, and such an at
   * is set aside (a quotation nobody checked gives no fact).
   */
  lineStands?: (file: string, line: number, quote: string) => { line: number } | { why: string };
  /**
   * The element names the rule declares (`reading_class.elements[].name`,
   * carried on the candidate): an `element` that is one of them stands as named; any other is held to S5's words.
   */
  elements?: ReadonlySet<string>;
  /**
   * The program's "does it ship" premise for a file of the tree,
   * only where it stands (a premise other than `unknown` whose every `because` line was found at its line in the tree);
   * null where the file has none. Absent: no premise was computed for this scan, and an omitted `ships` stays omitted
   * (the place ships: `HEAVIEST.ships`).
   */
  premiseOf?: (file: string) => ShipsPremise | null;
  /** The file of this candidate's place `P<n>` (its location's file); null where the candidate has no such place. */
  placeFile?: (place: string) => string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** `E<n>` or `P<n>`: ref-ids.ts, the one definition the numbering and the schemas share (`P0` is the first place). */
const REF = new RegExp(anchored(STANDING_REF_ID));
// Escaped (raw CJK only in a detector pattern for scanned content):
// CJK punctuation, kana, CJK ideographs (extension A and the unified block), Hangul syllables, full-width forms.
const CJK = /[　-〿぀-ヿ㐀-䶿一-鿿가-힯＀-￯]/;
/** An object holding exactly these keys and no other. */
const onlyKeys = (v: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(v).every((k) => keys.includes(k)) && keys.every((k) => k in v);

/**
 * S5's rule for words a person reads (`effect`, and from WP1 `element`, `exemption.limb` and `fact.words`): one line of
 * at most `max` words, in English. Null where the words pass, else why not (the messages `effect` has had since H5a).
 */
function wordsProblem(label: string, v: unknown, max: number): string | null {
  const words = typeof v === "string" ? v.trim().split(/\s+/).filter(Boolean).length : 0;
  if (typeof v !== "string" || v.trim() === "") return `\`${label}\` is a sentence of at most ${max} words`;
  if (/[\r\n]/.test(v)) return `\`${label}\` is one line (S5)`;
  if (words > max) return `\`${label}\` has ${words} words; at most ${max} (S5)`;
  if (CJK.test(v)) return `\`${label}\` is English (S5)`;
  return null;
}

/**
 * S1-S6 and S8 over one verdict's `standing` (section 2.5; S8 and the premise: design-not-violations.md sections 2.1,
 * 2.5, WP1). S7, the final quote check at assembly, is `standingFacts`'s. Returns the parts that stand and every part set
 * aside, with why; `standing` is absent where nothing stood.
 *
 * EVERY WAY OUT OF "TO FIX" NEEDS ITS OWN QUOTATION (design-not-violations.md section 2.5, item 1): `duty_met` stands
 * only with its `at` (S2) and an `element` (S8); `exempt` only with its `at` and an `exemption` whose basis is the rule's
 * own (S3, S8); `waits_on_answer` only with its `at` and a question of the program's list (S4) or a `fact` in words about
 * a basis of the rule's own (S3, S4, S5); a `ships` that does not ship only with its `at`, or from the program's premise
 * whose manifest lines stand. A status set aside, or left out, is placed at its heaviest (`duty_unmet`).
 */
export function checkStanding(raw: unknown, input: StandingCheckInput): { standing?: StandingRecord; setAside: StandingSetAside[] } {
  const setAside: StandingSetAside[] = [];
  if (raw === undefined) return { setAside };
  if (!isObj(raw)) return { setAside: [{ part: "standing", value: raw, why: "`standing` is one object of named parts; this value is not an object, so the block is dropped whole" }] };
  const out: StandingRecord = {};
  const aside = (part: StandingPart, value: unknown, why: string): void => {
    setAside.push({ part, value, why });
  };
  const evidenceCount = Array.isArray(input.evidence) ? input.evidence.length : 0;
  /** S2: the at resolves; returns the at as the record holds it (a tree line moved to where it stands), or a reason. */
  const atOf = (at: unknown): { at: StandingAt } | { why: string } => {
    if (typeof at === "string") {
      if (!REF.test(at)) return { why: `\`at\` ${JSON.stringify(at)} is neither \`E<n>\` (an entry of this verdict's \`evidence[]\`, from E1), \`P<n>\` (a place, from P0) nor \`{file, line, quote}\`` };
      const e = evidenceIndexOf(at);
      if (e !== null) return e < evidenceCount ? { at } : { why: `\`at\` ${at} names no entry of this verdict's \`evidence[]\` (it holds ${evidenceCount}, E1 to E${evidenceCount})` };
      return input.keptPlaces.has(at) ? { at } : { why: `\`at\` ${at} is not a place row of this candidate that you kept and that passed the place checks` };
    }
    if (isObj(at) && typeof at.file === "string" && at.file !== "" && typeof at.line === "number" && Number.isInteger(at.line) && at.line >= 1 && typeof at.quote === "string" && at.quote.trim() !== "" && Object.keys(at).every((k) => k === "file" || k === "line" || k === "quote")) {
      if (!input.lineStands) return { why: "`at` quotes a line, and no tree was at hand to check it against (C9's rule): a quotation nobody checked gives no fact" };
      const r = input.lineStands(at.file, at.line, at.quote);
      return "why" in r ? { why: r.why } : { at: { file: at.file, line: r.line, quote: at.quote } };
    }
    return { why: "`at` is `E<n>`, `P<n>`, or one object `{file, line, quote}` and nothing else" };
  };
  const one = (part: StandingPart, list: readonly string[], opts: { atOptional?: boolean } = {}): void => {
    if (!(part in raw)) return;
    const v = raw[part];
    if (!isObj(v) || typeof v.value !== "string") return aside(part, v, `\`${part}\` is \`{"value", "at"}\`, \`value\` one word of its list`);
    if (!list.includes(v.value)) return aside(part, v, `\`${part}.value\` ${JSON.stringify(v.value)} is not in its list (${list.join(", ")}) (S1)`);
    if (v.at === undefined && opts.atOptional) {
      (out as Record<string, unknown>)[part] = { value: v.value };
      return;
    }
    const a = atOf(v.at);
    if ("why" in a) return aside(part, v, `${a.why} (S2)`);
    (out as Record<string, unknown>)[part] = { value: v.value, at: a.at };
  };
  const many = (part: "data" | "people" | "duty", ok: (x: string) => string | null): void => {
    if (!(part in raw)) return;
    const v = raw[part];
    if (!isObj(v) || !Array.isArray(v.value) || v.value.length === 0 || !v.value.every((x) => typeof x === "string")) return aside(part, v, `\`${part}\` is \`{"value": [...], "at"}\`, \`value\` one or more words of its list`);
    const bad = (v.value as string[]).map(ok).filter((x): x is string => x !== null);
    if (bad.length > 0) return aside(part, v, `${bad.join("; ")} (${part === "duty" ? "S3" : "S1"})`);
    const a = atOf(v.at);
    if ("why" in a) return aside(part, v, `${a.why} (S2)`);
    (out as Record<string, unknown>)[part] = { value: [...new Set(v.value as string[])], at: a.at };
  };
  /** S3: `L<n>` names an entry of the rule's own `legal_basis_refs`; null where it does, else why not. */
  const ownBasis = (label: string, x: string): string | null =>
    (basisIndexOf(x) ?? Infinity) < input.bases ? null : `\`${label}\` ${JSON.stringify(x)} is not \`L<n>\` naming an entry of the rule's own \`legal_basis_refs\` (it holds ${input.bases}, L1 to L${input.bases})`;

  one("status", STANDING_STATUS);
  many("duty", (x) => ownBasis("duty.value", x));
  many("data", (x) => ((STANDING_DATA as readonly string[]).includes(x) ? null : `\`data.value\` ${JSON.stringify(x)} is not in its list`));
  many("people", (x) => ((STANDING_PEOPLE as readonly string[]).includes(x) ? null : `\`people.value\` ${JSON.stringify(x)} is not in its list`));
  one("runs", STANDING_RUNS);
  one("reaches", STANDING_REACHES);
  // The program's premise for the decisive place's
  // file, where one stands and is not `unknown`. The decisive place is read here without recording anything; its own
  // check, below, records it.
  const premise = ((): { file: string; value: ShipsPremise } | null => {
    if (!input.premiseOf || typeof raw.decisive !== "string" || !REF.test(raw.decisive) || "why" in atOf(raw.decisive)) return null;
    const e = evidenceIndexOf(raw.decisive);
    const entry = e !== null && Array.isArray(input.evidence) ? input.evidence[e] : undefined;
    const file = e !== null ? (isObj(entry) && typeof entry.file === "string" ? entry.file : null) : (input.placeFile?.(raw.decisive) ?? null);
    const value = file ? input.premiseOf(file) : null;
    // A premise that lends no value (`ci`, `documentation` and the
    // other information-only classes) is no premise here: it fills nothing and stands in for no quotation.
    return file && value && value !== "unknown" && shipsLentByPremise(value) !== null ? { file, value } : null;
  })();
  if ("ships" in raw) {
    const v = raw.ships;
    // `depends_on_deployment` takes no at (section 2.2): nothing in the tree shows it; every other value names its line,
    // unless it is the value the program's premise for the decisive place already gives (the premise is its quotation).
    if (isObj(v) && v.value === "depends_on_deployment" && v.at === undefined) out.ships = { value: "depends_on_deployment" };
    else if (premise && isObj(v) && v.at === undefined && v.value === SHIPS_OF_PREMISE[premise.value] && Object.keys(v).every((k) => k === "value")) out.ships = { value: SHIPS_OF_PREMISE[premise.value], premise };
    else one("ships", STANDING_SHIPS);
  }
  // A `ships` left out, or set aside, takes the premise: "the premise stands" (design section 2.1). With no premise it
  // stays out, and the place ships (`HEAVIEST.ships`).
  if (!out.ships && premise) out.ships = { value: SHIPS_OF_PREMISE[premise.value], premise };
  // S4: `question` names an id of the program's list, and only with `waits_on_answer`.
  if ("question" in raw) {
    const v = raw.question;
    if (!isObj(v) || typeof v.value !== "string") aside("question", v, '`question` is `{"value", "at"}`, `value` the id of a question of the program\'s list');
    else if (!input.questions.has(v.value)) aside("question", v, `\`question.value\` ${JSON.stringify(v.value)} is not a question of the program's list (S4)`);
    else if (out.status?.value !== "waits_on_answer") aside("question", v, "`question` goes only with `status` `waits_on_answer` (S4)");
    else {
      const a = atOf(v.at);
      if ("why" in a) aside("question", v, `${a.why} (S2)`);
      else out.question = { value: v.value, at: a.at };
    }
  }
  // S4's other half: a fact no question of the program's list carries,
  // in words, about a basis of the rule's own; the line it bears on is `status.at`.
  if ("fact" in raw) {
    const v = raw.fact;
    const words = isObj(v) ? wordsProblem("fact.words", v.words, FACT_MAX_WORDS) : null;
    if (!isObj(v) || typeof v.words !== "string" || typeof v.about !== "string" || !onlyKeys(v, ["words", "about"])) aside("fact", v, `\`fact\` is \`{"words", "about"}\`: the fact in at most ${FACT_MAX_WORDS} words, and the \`L<n>\` of the rule's own basis it concerns (S4)`);
    else if (out.status?.value !== "waits_on_answer") aside("fact", v, "`fact` goes only with `status` `waits_on_answer` (S4)");
    else if (out.question) aside("fact", v, "`fact` is for a fact no question of the program's list carries; this block names a question of the list, which is what the finding waits on (S4)");
    else if (words) aside("fact", v, words);
    else {
      const about = ownBasis("fact.about", v.about);
      if (about) aside("fact", v, `${about} (S3)`);
      else out.fact = { words: v.words.trim(), about: v.about };
    }
  }
  if (out.status?.value === "waits_on_answer" && !out.question && !out.fact) {
    const why =
      "fact" in raw
        ? "`status` `waits_on_answer` names no question of the program's list and no fact in words that stood (S4)"
        : "`status` `waits_on_answer` names no question of the program's list that stood (S4)";
    setAside.push({ part: "status", value: out.status, why });
    delete out.status;
  }
  // S8's parts: which part of the duty the line at `status.at` meets;
  // the basis of the rule's own that exempts the shape at `status.at`, and its limb. Each goes only with its status (below).
  if ("element" in raw) {
    const v = raw.element;
    if (typeof v === "string" && input.elements?.has(v.trim()) === true && v.trim() !== "") out.element = v.trim();
    else {
      const words = wordsProblem("element", v, ELEMENT_MAX_WORDS);
      if (words) aside("element", v, words);
      else out.element = (v as string).trim();
    }
  }
  if ("exemption" in raw) {
    const v = raw.exemption;
    if (!isObj(v) || typeof v.basis !== "string" || typeof v.limb !== "string" || !onlyKeys(v, ["basis", "limb"])) aside("exemption", v, `\`exemption\` is \`{"basis", "limb"}\`: the \`L<n>\` of the rule's own basis that exempts, and its limb in at most ${LIMB_MAX_WORDS} words (S8)`);
    else {
      const basis = ownBasis("exemption.basis", v.basis);
      const limb = wordsProblem("exemption.limb", v.limb, LIMB_MAX_WORDS);
      if (basis) aside("exemption", v, `${basis} (S3)`);
      else if (limb) aside("exemption", v, limb);
      else out.exemption = { basis: v.basis, limb: v.limb.trim() };
    }
  }
  // The line of the processing this finding was traced to: one
  // `{file, line, quote}`, by C9's rule (S2), as a status's at of that form.
  if ("same_as" in raw) {
    const v = raw.same_as;
    if (!isObj(v)) aside("same_as", v, "`same_as` is one object `{file, line, quote}`: the line of the processing this finding was traced to, as you Read it (S2)");
    else {
      const a = atOf(v);
      if ("why" in a) aside("same_as", v, `${a.why} (S2)`);
      else out.same_as = a.at as { file: string; line: number; quote: string };
    }
  }
  if ("decisive" in raw) {
    const v = raw.decisive;
    if (typeof v !== "string" || !REF.test(v)) aside("decisive", v, "`decisive` is `E<n>` (an entry of this verdict's `evidence[]`, from E1) or `P<n>` (a place, from P0), the one quotation the finding stands on");
    else {
      const a = atOf(v);
      if ("why" in a) aside("decisive", v, `${a.why} (S2)`);
      else out.decisive = v;
    }
  }
  if ("effect" in raw) {
    const v = raw.effect;
    const why = wordsProblem("effect", v, EFFECT_MAX_WORDS);
    if (why) aside("effect", v, why);
    else out.effect = (v as string).trim();
  }
  if ("settles" in raw) {
    const v = raw.settles;
    const m = typeof v === "string" ? /^(question|law_unclear|code_not_readable):(.+)$/.exec(v) : null;
    if (input.verdict !== "needs_human") aside("settles", v, "`settles` goes only with `needs_human`");
    else if (!m) aside("settles", v, "`settles` is `question:<id>`, `law_unclear:<cite>` or `code_not_readable:<file>`");
    else if (m[1] === "question" && !input.questions.has(m[2]!)) aside("settles", v, `\`settles\` names ${JSON.stringify(m[2])}, not a question of the program's list (S4)`);
    else out.settles = v as string;
  }
  // S6: a duty met may name where data goes; a duty met with `needs_human` contradicts itself. So does an
  // exemption: the seat that shows the exempt shape and the basis that exempts it has settled the finding.
  if ((out.status?.value === "duty_met" || out.status?.value === "exempt") && input.verdict === "needs_human") {
    setAside.push({ part: "status", value: out.status, why: `\`status\` \`${out.status.value}\` with the verdict \`needs_human\` contradicts itself (S6)` });
    delete out.status;
  }
  // S8: a status that takes the finding out of "to fix"
  // stands only with its own part, and that part only with it.
  if (out.status?.value === "duty_met" && out.element === undefined) {
    setAside.push({ part: "status", value: out.status, why: "`status` `duty_met` names no `element` that stood: which part of the duty the line at its `at` meets (S8)" });
    delete out.status;
  }
  if (out.status?.value === "exempt" && out.exemption === undefined) {
    setAside.push({ part: "status", value: out.status, why: "`status` `exempt` names no `exemption` that stood: the basis of the rule's own that exempts the line at its `at`, and its limb (S8)" });
    delete out.status;
  }
  if (out.element !== undefined && out.status?.value !== "duty_met") {
    aside("element", raw.element, "`element` goes only with a `status` `duty_met` that stood (S8)");
    delete out.element;
  }
  if (out.exemption !== undefined && out.status?.value !== "exempt") {
    aside("exemption", raw.exemption, "`exemption` goes only with a `status` `exempt` that stood (S8)");
    delete out.exemption;
  }
  for (const k of Object.keys(raw)) if (!(STANDING_PARTS as readonly string[]).includes(k)) setAside.push({ part: "standing", value: { [k]: raw[k] }, why: `\`${k}\` is not a part of \`standing\`` });
  return Object.keys(out).length > 0 ? { standing: out, setAside } : { setAside };
}
