/**
 * THE DECLARATION QUESTIONS, HELD BY THE PROGRAM.
 *
 * THE ONE SOURCE (5.2.1, D1): the question text and its choices live in scan-profile.schema.json itself, an
 * `x-question` object on each field the program may ask and `x-declaration-questions` at the root ("Not answering",
 * the hint wording). This module reads them from the schema the scan's profile check reads, as the program carries it
 * in its compiled code (schema-validate.ts `schemaDocument`); SKILL.md holds no question text.
 *
 * WHAT IS ASKED (5.2.2, D2, D5, R3): only a question a candidate of this run turns on - its rule's `jurisdiction`
 * (the region questions, one per jurisdiction the run's rules declare: the regions are one closed list, D3) or a
 * premise its `applicability_preconditions` names - each with the candidates it marks and, for a region, the launches
 * an answer of No removes (computed by `perRuleApplicability` itself, with every other region answered Yes). Ordered by
 * effect; the region questions are one unit.
 *
 * THE RECORD (5.2.4, D6, R1, R5, R6): the program writes `profile.json` and `profile-record.json` side by side in the
 * declaration directory (the directory of the scan's --out). A row per question put: when, which question version
 * (`digest`, the sha256 of the question's x-question object, never of the text as asked, which carries the run's
 * figures) and which path. A file with no record, or whose sha256 is not the record's, is unconfirmed as a whole.
 *
 * NOTHING IS DRAFTED FROM CODE (5.2.3, D11): a value in a file the program cannot confirm is shown beside its question
 * as a labelled hint, never as a choice and never as a default; no answer is ever filled from the tree.
 */
import { createHash } from "node:crypto";
import { readRegularFile } from "./project-read.js";
import { lstatSync } from "node:fs";
import { makeFolder, renamePath, writeFileAt } from "./project-write.js";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import type { Candidate, Rule, ScanProfile } from "wolfboy-schemas";
import { launchesOfGroup, perRuleApplicability, type ScopeSettlement } from "./per-rule-applicability.js";
import { regimesSettledBy } from "./region-reach.js";
import { QUESTION_KINDS, SETTLES_AS, type QuestionKind, type SettlesAs } from "./standing.js";
import { readProgramFile } from "./program-file.js";
import { schemaDocument } from "./schema-validate.js";
import { personCommand } from "./scanner-command.js";
import { latestEvidenceLog } from "./legal-dir.js";
import { SELF_HOSTABLE_RULES } from "./severity-at-place.js";
import { SELF_NAME_RULES, VENDOR_SOFTWARE_FIELD, nameWordsOf, ownNamePremiseOf, ownNameTally, type ManifestName } from "./own-name.js";

// The declaration's file names and the review flag live in declaration-files.ts, which
// imports nothing, so that the write guard (hook-guard.ts) names them without loading this module.
import { DECLARATION_PROFILE_FILE, DECLARATION_RECORD_FILE, REVIEW_DECLARATION_FLAG } from "./declaration-files.js";
export { DECLARATION_PROFILE_FILE, DECLARATION_RECORD_FILE, REVIEW_DECLARATION_FLAG };
/** Every planned question, its effect and whether it was asked, beside profile.json. */
export const DECLARATION_PLAN_FILE = "declaration-plan.json";
/** At most this many questions go in one AskUserQuestion call (the tool's own limit); the terminal asks all at once. */
export const QUESTIONS_PER_ROUND = 4;
/**
 * (the owner, 2026-11-02, answering design-not-violations.md
 * section 10 question 1: at most 4 questions before the scan, in one round, ordered by how many findings the answer
 * settles; the rest go into the report as questions and are used from the next scan) At most this many declaration
 * questions are asked before review in one run, IN TOTAL: today's questions, the regions and the ones asked by their
 * kind alike, taken whole field by whole field by the findings each decides (`capBeforeReview`). The rest are not asked
 * (`overCap`): the plan lists them as NOT_ASKED_LATER and the report as questions, used from the next scan. The run-shape
 * and price questions are not declaration questions and are not counted. Two entrances ask without it: the review
 * entrance (`--review-declaration`, the person asked to review every answer) and CI (asks nothing and reads no answer,
 * so the rules of every region run; no exit 5 since rf11 A3/A5).
 * One round: never more than QUESTIONS_PER_ROUND (the module refuses to load otherwise).
 */
export const ASKED_BEFORE_REVIEW_MAX = 4;
if (ASKED_BEFORE_REVIEW_MAX > QUESTIONS_PER_ROUND) throw new Error("ASKED_BEFORE_REVIEW_MAX must fit in one round (QUESTIONS_PER_ROUND)");
/**
 * (owner question 2, a
 * default pending the owner) The kinds of question whose out-of-scope answer, from the program's confirmed record, settles a
 * rule without review (`scopeSettlementsOf`, per-rule-applicability.ts). Which kind each field is lives in its
 * x-question (scan-profile.schema.json, one line per field); `feature` answers stay reviewed (rule 6b), and a mismatch
 * with the code is "check your answer", never a problem.
 */
export const SETTLES_WITHOUT_REVIEW: readonly QuestionKind[] = ["scope"];
/**
 * The kinds of question asked before review where the answer changes
 * what this run reports, beyond today's test: a scope question that would settle a candidate of this run, a condition or
 * feature question a candidate's rule names in a precondition or a context question. `order` questions stay in the
 * report (W7) and are asked by today's test alone.
 */
export const ASKED_BEFORE_REVIEW_KINDS: readonly QuestionKind[] = ["scope", "condition", "feature"];
/**
 * (the digest decision) The program's own keys of an x-question and of
 * its options: what the program does with an answer (its kind, when it is asked, the provisions it settles). The person
 * never reads them, so they are not part of the question's version (`questionDigest`): a change to how the program uses
 * an answer asks no confirmed answer again; a changed text or choice still does.
 * EXCEPT what an option settles as
 * (`settles_as`), which is no longer a program key: it decides whether the person's answer takes a finding out of the
 * count (`met`, `out_of_scope`), hands it to the operators (`maker`) or leaves it (`stands`), which the person reads
 * beside the question as what the answer does. An answer given when the option did less (the minors "No", which only
 * moved the order before 0.1.1) is asked again before it settles anything. A row recorded at a version that left
 * `settles_as` out still counts where the question's options settle as they did in 0.1.0 (`SETTLES_AS_IN_0_1_0`,
 * `atVersion`): what that answer does has not changed, so it is not asked again.
 */
export const PROGRAM_QUESTION_KEYS: readonly string[] = ["kind", "when", "settles", "settled_covers", "gate"];
export const PROGRAM_OPTION_KEYS: readonly string[] = [];
/**
 * The variable that puts the scan on the CI path (never ask and read no answer about the
 * product: the rules of every region run, and the scan exits 0 unless --fail-on-unreviewed stops it). Exported so a gate that is not about CI drops it by this name, read from the build under
 * test (a check): since the declaration questions, a gate that inherits CI would take that path in CI only.
 */
export const CI_ENV = "CI";
/**
 * CI as the scan reads it (D10): `CI` (`CI_ENV`) set, and not empty, `false` or `0`, or one of the CI systems' own
 * variables (`CI_RUNNER_ENVS`) set in the same sense. It also decides WHAT A COMMAND PRINTS: where it is set,
 * the output is a job's log, which anyone who can read the repository reads on a public one, so the log gets the CI form
 * whatever else is in the environment (a Claude Code session's signs included) and a report goes to its files only.
 * Where the questions are asked is another matter (index.ts `declarationPathOf`: inside a session, the relay, whatever CI
 * says), so a session in CI keeps its relay and its report files and prints no report into the log.
 */
export function ciSet(env: NodeJS.ProcessEnv): boolean {
  const on = (name: string): boolean => {
    const v = (env[name] ?? "").trim().toLowerCase();
    return v !== "" && v !== "false" && v !== "0";
  };
  return on(CI_ENV) || CI_RUNNER_ENVS.some(on);
}
/**
 * THE CI SYSTEMS' OWN VARIABLES, each set by
 * its runner in every job, for the systems that set no `CI` (Azure Pipelines, Jenkins, TeamCity, AWS CodeBuild, Bamboo) and
 * for those that set it too (the name holds where a job unsets `CI`). Read as `CI` is: set, and not empty, `false` or `0`.
 * Before, a job on a runner that sets no `CI` printed the person's first screen, high places by file and line, into its
 * log. The names are the vendors' documented ones, cross-checked against the `ci-info` package's `vendors.json`:
 *   GITHUB_ACTIONS     GitHub Actions   https://docs.github.com/en/actions/reference/variables-reference
 *   GITLAB_CI          GitLab CI/CD     https://docs.gitlab.com/ci/variables/predefined_variables/
 *   TF_BUILD           Azure Pipelines  https://learn.microsoft.com/en-us/azure/devops/pipelines/build/variables
 *   JENKINS_URL        Jenkins          https://www.jenkins.io/doc/book/pipeline/jenkinsfile/#using-environment-variables
 *   TEAMCITY_VERSION   TeamCity         https://www.jetbrains.com/help/teamcity/predefined-build-parameters.html
 *   BITBUCKET_COMMIT   Bitbucket        https://support.atlassian.com/bitbucket-cloud/docs/variables-and-secrets/
 *   CODEBUILD_BUILD_ARN AWS CodeBuild   https://docs.aws.amazon.com/codebuild/latest/userguide/build-env-ref-env-vars.html
 *   BUILDKITE          Buildkite        https://buildkite.com/docs/pipelines/configure/environment-variables
 *   CIRCLECI           CircleCI         https://circleci.com/docs/variables/
 *   TRAVIS             Travis CI        https://docs.travis-ci.com/user/environment-variables/
 *   bamboo_planKey     Bamboo           https://confluence.atlassian.com/bamboo/bamboo-variables-289277087.html
 *   DRONE              Drone            https://docs.drone.io/pipeline/environment/reference/
 *   APPVEYOR           AppVeyor         https://www.appveyor.com/docs/environment-variables/
 *   SEMAPHORE          Semaphore        https://docs.semaphoreci.com/reference/env-vars
 * Each makes the scan take the CI path as `CI` does (the order of the paths kept: a session first), and the gates' helper
 * drops each (host-env.ts `HOST_ENV_NAMES`).
 */
const RUNNER_GITHUB_ACTIONS_ENV = "GITHUB_ACTIONS";
const RUNNER_GITLAB_CI_ENV = "GITLAB_CI";
const RUNNER_TF_BUILD_ENV = "TF_BUILD";
const RUNNER_JENKINS_URL_ENV = "JENKINS_URL";
const RUNNER_TEAMCITY_VERSION_ENV = "TEAMCITY_VERSION";
const RUNNER_BITBUCKET_COMMIT_ENV = "BITBUCKET_COMMIT";
const RUNNER_CODEBUILD_BUILD_ARN_ENV = "CODEBUILD_BUILD_ARN";
const RUNNER_BUILDKITE_ENV = "BUILDKITE";
const RUNNER_CIRCLECI_ENV = "CIRCLECI";
const RUNNER_TRAVIS_ENV = "TRAVIS";
const RUNNER_BAMBOO_PLANKEY_ENV = "bamboo_planKey";
const RUNNER_DRONE_ENV = "DRONE";
const RUNNER_APPVEYOR_ENV = "APPVEYOR";
const RUNNER_SEMAPHORE_ENV = "SEMAPHORE";
export const CI_RUNNER_ENVS: readonly string[] = Object.freeze([
  RUNNER_GITHUB_ACTIONS_ENV,
  RUNNER_GITLAB_CI_ENV,
  RUNNER_TF_BUILD_ENV,
  RUNNER_JENKINS_URL_ENV,
  RUNNER_TEAMCITY_VERSION_ENV,
  RUNNER_BITBUCKET_COMMIT_ENV,
  RUNNER_CODEBUILD_BUILD_ARN_ENV,
  RUNNER_BUILDKITE_ENV,
  RUNNER_CIRCLECI_ENV,
  RUNNER_TRAVIS_ENV,
  RUNNER_BAMBOO_PLANKEY_ENV,
  RUNNER_DRONE_ENV,
  RUNNER_APPVEYOR_ENV,
  RUNNER_SEMAPHORE_ENV,
]);
/**
 * The review entrance as the person runs it, in one spelling for every line
 * that names it (the question screen, the report's question slots and its open questions): the scan of the project
 * folder, its findings where the plugin writes them, through `personCommand` (a command that runs as printed, in the form
 * the person ran the program: `scanner-command.ts`).
 */
export function reviewDeclarationCommand(): string {
  // As the person can type it: `npx wolfboy@<version> scan --review-declaration` for
  // a person who ran the program through npx, the installed name where it is on PATH, else the full path as before.
  return personCommand(["scan", "--target", ".", "--out", ".legal/findings.json", REVIEW_DECLARATION_FLAG], ["scan", REVIEW_DECLARATION_FLAG]);
}
/** The slots of the statement's template (the schema's same_answers.statement): every one must be in it. */
const STATEMENT_SLOTS = ["{date}", "{answers}", "{flag}"];
const REGIONS = "distribution_regions";
const NOT_OFFERED = "regions_not_offered";

const sha256 = (b: string | Buffer): string => createHash("sha256").update(b).digest("hex");
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export interface XOption {
  label: string;
  value: unknown;
  description: string;
  /** What this answer settles a finding as (a program key, outside the digest). */
  settles_as?: SettlesAs;
}
/** One part of a field asked in parts: a question of its own, with its own version. */
export interface XPart {
  header: string;
  question: string;
  options: XOption[];
}
export interface XQuestion {
  /** `scope`, `condition`, `feature` or `order` (a program key, outside the digest). */
  kind?: QuestionKind;
  header: string;
  question: string;
  options: XOption[];
  unanswered?: unknown;
  /**
   * The person may choose several options (AskUserQuestion's multiSelect): a
   * fact whose truth can be several (a product with a website and a mobile app). Its value is the list of the chosen
   * options' values in the options' order, its row's label their labels joined by ", ". A key the person sees (the dialog
   * changes), so it is inside the question's version. Only on a question asked whole (no `per`).
   */
  multiSelect?: boolean;
  /**
   * `jurisdiction`: one question per jurisdiction of the run's rules (the regions, D3). `part`: a field whose choices do
   * not fit one AskUserQuestion question (at most four choices, Not answering one of them) is asked in `parts`, one
   * unit; its value is the first part answered with a value (an option whose value is null defers to the next part).
   * `vendor`: the self-name question, asked about the vendor entry the recipient rules'
   * candidates name on the most places (`ownNameTally`); its code is the entry's name, put in for `{entry}`.
   */
  per?: "jurisdiction" | "part" | "vendor";
  /**
   * On a `per: "jurisdiction"` question only: each
   * place's own words, by region code, carrying exactly the territorial tests of the laws that place's answer settles
   * (region-reach.ts). A code with none is asked `question`. `concrete` puts a place's words in and leaves this key out, so
   * a place's question version is the digest of its own words alone.
   */
  question_by_place?: Readonly<Record<string, string>>;
  parts?: XPart[];
  /**
   * `after_report`: never asked before review. The
   * report shows it where findings wait on it; the review entrance asks it. Since 2026-11-02 no shipped question carries
   * it (design-not-violations.md section 4.1: the Art 9 condition is a `condition` question asked before review).
   */
  when?: "after_report";
  /** The provisions the question settles, as the report names them. */
  settles?: string[];
  /**
   * What an out-of-scope answer settles, as the
   * report says it beside the settlement (NV10, NV11), where the question asks about only part of an instrument's duties
   * (the EAA question asks about services, not products). A program key, outside the question's version.
   */
  settled_covers?: string;
  /**
   * The law whose applicability gate reads this
   * field as one of its conditions (a limb's `declared_by`), as the effect line names it. A program key, outside the
   * question's version.
   */
  gate?: string;
}
/**
 * Section 5.2.4's later-run line, a statement since 2026-09-27 (it
 * supersedes the proposal's question on this point): the template of the one sentence every non-CI scan prints.
 */
export interface SameAnswersSource {
  /** With `{date}` (the day the answers were saved), `{answers}` (`<header>: <label>; ...`) and `{flag}` (the review flag). */
  statement: string;
  /** The name `{answers}` gives the regions, stated as the one list the run used. */
  regions: string;
  /** What `{answers}` says of a field the declaration the run read leaves open. */
  notSettled: string;
}
export interface DeclarationSource {
  version: number;
  notAnswering: { label: string; description: string };
  /** The hint wording, with `{value}` where the value goes. */
  hint: string;
  sameAnswers: SameAnswersSource;
  /** Every field carrying an x-question, by its dotted path, in the schema's order. */
  fields: { field: string; x: XQuestion }[];
}

/**
 * Read the questions from scan-profile.schema.json (the one source), as this program carries it (schema-validate.ts
 * `schemaDocument`), or from `doc` where a caller gives one. Throws where the schema does not carry them.
 */
export function loadDeclarationSource(doc: unknown = schemaDocument("scan-profile.schema.json"), schemaPath = "scan-profile.schema.json"): DeclarationSource {
  if (!isRecord(doc) || !isRecord(doc["x-declaration-questions"])) throw new Error(`${schemaPath} carries no x-declaration-questions`);
  const root = doc["x-declaration-questions"];
  const na = root.not_answering;
  if (!isRecord(na) || typeof na.label !== "string" || typeof na.description !== "string" || typeof root.hint !== "string") {
    throw new Error(`${schemaPath}: x-declaration-questions has no not_answering option or no hint wording`);
  }
  const same = root.same_answers;
  if (
    !isRecord(same) ||
    typeof same.statement !== "string" ||
    !STATEMENT_SLOTS.every((slot) => (same.statement as string).includes(slot)) ||
    typeof same.regions !== "string" ||
    typeof same.not_settled !== "string" ||
    Object.keys(same).length !== 3
  ) {
    throw new Error(`${schemaPath}: x-declaration-questions has no same_answers statement (one template with ${STATEMENT_SLOTS.join(", ")}, the regions' name and the word for a field left open, and nothing else)`);
  }
  const fields: { field: string; x: XQuestion }[] = [];
  const asked = (q: Record<string, unknown>): boolean => {
    const opts = Array.isArray(q.options) ? q.options : [];
    return typeof q.header === "string" && typeof q.question === "string" && opts.length >= 1 && opts.length <= 3 && opts.every((o) => isRecord(o) && typeof o.label === "string" && typeof o.description === "string" && "value" in o);
  };
  const walk = (node: unknown, path: string[]): void => {
    if (!isRecord(node) || !isRecord(node.properties)) return;
    for (const [name, child] of Object.entries(node.properties)) {
      if (!isRecord(child)) continue;
      const x = child["x-question"];
      if (isRecord(x)) {
        const where = [...path, name].join(".");
        // A program key that is present must be one of its values: a misspelt
        // kind or settles_as would otherwise do nothing, silently. An absent kind asks by today's test alone.
        if (x.kind !== undefined && !(QUESTION_KINDS as readonly unknown[]).includes(x.kind)) throw new Error(`${schemaPath}: the x-question of ${where} has the kind ${JSON.stringify(x.kind)}, not one of ${QUESTION_KINDS.join(", ")}`);
        const opts = [...(Array.isArray(x.options) ? x.options : []), ...(Array.isArray(x.parts) ? x.parts.flatMap((p) => (isRecord(p) && Array.isArray(p.options) ? p.options : [])) : [])];
        for (const o of opts) if (isRecord(o) && o.settles_as !== undefined && !(SETTLES_AS as readonly unknown[]).includes(o.settles_as)) throw new Error(`${schemaPath}: an option of the x-question of ${where} settles as ${JSON.stringify(o.settles_as)}, not one of ${SETTLES_AS.join(", ")}`);
        // Per-place words: only on a region question, each a non-empty text.
        if (x.question_by_place !== undefined && (x.per !== "jurisdiction" || !isRecord(x.question_by_place) || !Object.values(x.question_by_place).every((q) => typeof q === "string" && q.trim() !== ""))) {
          throw new Error(`${schemaPath}: the x-question of ${where} has a question_by_place that is not one non-empty text per region code of a per-jurisdiction question`);
        }
        if (x.gate !== undefined && (typeof x.gate !== "string" || x.gate.trim() === "")) throw new Error(`${schemaPath}: the x-question of ${where} has a gate that is not the name of a law`);
        if (x.per === "part") {
          const parts = Array.isArray(x.parts) ? x.parts : [];
          if (typeof x.header !== "string" || parts.length < 2 || !parts.every((p) => isRecord(p) && asked(p))) throw new Error(`${schemaPath}: the x-question of ${where} is asked in parts, and its parts are not at least two questions of one to three options`);
          fields.push({ field: where, x: { ...(x.kind !== undefined ? { kind: x.kind as QuestionKind } : {}), header: x.header, question: "", options: [], per: "part", parts: parts as unknown as XPart[] } });
        } else {
          if (!asked(x)) throw new Error(`${schemaPath}: the x-question of ${where} is not a header, a question and one to three options`);
          // Several answers arrive as one text, the labels joined by commas: a
          // label of a multi-select question must hold no comma, and such a question is asked whole.
          if (x.multiSelect !== undefined && typeof x.multiSelect !== "boolean") throw new Error(`${schemaPath}: the x-question of ${where} has a multiSelect that is not true or false`);
          if (x.multiSelect === true && (x.per !== undefined || (x.options as Record<string, unknown>[]).some((o) => String(o.label).includes(",")))) throw new Error(`${schemaPath}: the x-question of ${where} is multi-select, and it is asked per something or an option's label holds a comma`);
          fields.push({ field: where, x: x as unknown as XQuestion });
        }
      }
      walk(child, [...path, name]);
    }
  };
  walk(doc, []);
  return {
    version: typeof root.version === "number" ? root.version : 1,
    notAnswering: { label: na.label, description: na.description },
    hint: root.hint,
    sameAnswers: { statement: same.statement, regions: same.regions, notSettled: same.not_settled },
    fields,
  };
}

/** The name a region question says for its code (`{place}`); a code with no name here is said as it is. */
/* One map of a region's name in words, for the questions, laws.md and a
 * finding's card (which also names the places a provision cites beyond the four the regions question asks about). */
export const REGION_NAMES: Readonly<Record<string, string>> = { EU: "the EU", US: "the US", JP: "Japan", CN: "China", UK: "the UK", GB: "the UK", KR: "South Korea", BR: "Brazil", CA: "Canada", AU: "Australia", IN: "India", CH: "Switzerland" };
const fill = (s: string, code: string | null): string => (code === null ? s : s.split("{code}").join(code).split("{place}").join(REGION_NAMES[code] ?? code));
/** The x-question as asked for one jurisdiction, one part (its code is the part's number, from 1), or as it is. */
function concrete(x: XQuestion, code: string | null): XQuestion {
  if (x.per === "part") {
    const part = x.parts?.[Number(code) - 1];
    if (!part) throw new Error(`a question asked in parts has no part ${String(code)}`);
    return { header: part.header, question: part.question, options: part.options };
  }
  if (code !== null && x.per === "vendor") return JSON.parse(JSON.stringify(x).split("{entry}").join(JSON.stringify(code).slice(1, -1))) as XQuestion;
  if (code === null) return x;
  // A region's own words, where the source gives them; the map itself is never asked.
  const { question_by_place: byPlace, ...rest } = x;
  const own = byPlace?.[code];
  return JSON.parse(fill(JSON.stringify(typeof own === "string" ? { ...rest, question: own } : rest), code)) as XQuestion;
}
/**
 * The question as the person reads it: the x-question without the
 * program's own keys (PROGRAM_QUESTION_KEYS, and PROGRAM_OPTION_KEYS on each option), every other key in its order. For a
 * question that carries none of them this is the object itself, so its version is what it was before they existed.
 */
function asRead(x: XQuestion, optionKeys: readonly string[] = PROGRAM_OPTION_KEYS): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(x)) {
    if (PROGRAM_QUESTION_KEYS.includes(k)) continue;
    out[k] = k === "options" && Array.isArray(v) ? v.map((o) => (isRecord(o) ? Object.fromEntries(Object.entries(o).filter(([ok]) => !optionKeys.includes(ok))) : o)) : v;
  }
  return out;
}
/**
 * R1: the question's version, the sha256 of its x-question object as JSON (a region's with its code put in), the
 * program's own keys left out (`asRead`; the digest decision of nv-wp4-questions-2026-11-02.md section 2).
 */
export function questionDigest(x: XQuestion, code: string | null): string {
  return sha256(JSON.stringify(asRead(concrete(x, code))));
}
/**
 * What each option settled as, in the options'
 * order, in release 0.1.0 (scan-profile.schema.json as that release shipped it), the last release whose question versions left
 * `settles_as` out; a question none of whose options settled as anything then has no entry. FROZEN HISTORY: never
 * edited, and a question added later has no entry. A record of a build before 0.1.0 is read as 0.1.0's.
 */
const SETTLES_AS_IN_0_1_0: Readonly<Record<string, readonly (string | null)[]>> = {
  distribution_regions: ["stands", "out_of_scope"],
  "audience.consumer": ["stands", "out_of_scope"],
  "scope.eaa_listed_service": ["stands", "out_of_scope", "maker"],
  "scope.data_processing_service": ["stands", "out_of_scope", "maker"],
  "cra.product_with_digital_elements": ["stands", "stands"],
  "cra.data_connection": ["stands", "stands"],
  "cra.supplied_for_distribution_or_use": ["stands", "stands"],
  "cra.commercial_activity": ["stands", "stands"],
  "operator.special_category_condition": ["met", "stands", "maker"],
  "operator.ai_text_public_interest": ["stands", "met", "maker"],
  "operator.model_purpose_stated": ["met", "stands", "maker"],
};
/**
 * The question's version as 0.1.0 took it (`settles_as` left out), where a row recorded at it still counts: the question's
 * options settle today exactly as they did in 0.1.0. Null otherwise (the row must be at `questionDigest`).
 */
export function versionBeforeSettlesAs(field: string, x: XQuestion, code: string | null): string | null {
  const then = SETTLES_AS_IN_0_1_0[field];
  const now = optionsOf(x).map((o) => (typeof o.settles_as === "string" ? o.settles_as : null));
  if (then === undefined || JSON.stringify(then) !== JSON.stringify(now)) return null;
  return sha256(JSON.stringify(asRead(concrete(x, code), ["settles_as"])));
}
/** Whether a recorded row's digest is its question's current version (`questionDigest`, or `versionBeforeSettlesAs`). */
export function atVersion(digest: string, field: string, x: XQuestion, code: string | null): boolean {
  return digest === questionDigest(x, code) || digest === versionBeforeSettlesAs(field, x, code);
}
/** Every option a question offers: its own, or those of its parts. */
const optionsOf = (x: XQuestion): XOption[] => (x.per === "part" ? (x.parts ?? []).flatMap((p) => p.options) : x.options);
/** The kind of a field's question, or null where the source gives none. */
export function questionKindOf(source: DeclarationSource, field: string): QuestionKind | null {
  return source.fields.find((f) => f.field === field)?.x.kind ?? null;
}
export const questionId = (field: string, code: string | null): string => (code === null ? field : `${field}:${code}`);

/** One question this run's candidates turn on, with its figures. */
export interface PlannedQuestion {
  id: string;
  field: string;
  code: string | null;
  header: string;
  /** The x-question text, as the source words it (a region's code put in). */
  text: string;
  digest: string;
  /** `versionBeforeSettlesAs`, where a row at it still counts; absent otherwise. */
  digestBefore?: string;
  options: XOption[];
  unanswered: unknown;
  /** The person may choose several options (XQuestion.multiSelect). */
  multiSelect: boolean;
  /** The candidates whose rule's scope turns on the field (a region, a precondition), and their rules. */
  candidates: number;
  rules: string[];
  /** The candidates whose seat is asked a context question naming the field, and their rules. */
  seats: number;
  seatRules: string[];
  /** Every candidate the question affects, through its scope or its seat, by finding id: the order's key. */
  affected: string[];
  /**
   * The self-name question's order key, in place of `affected`: one key
   * per place the answer changes the reading of (`<finding id>#<position>`), a place being one decision row. Absent on
   * every other question. `affected` stays findings on every question, so no count of places reaches an effect line.
   */
  orderPlaces?: string[];
  /**
   * The self-name question where no root manifest names the tree with the vendor's name: it is
   * ordered after every other question, so it never takes a slot from one whose answer changes the report. The manifests only
   * order it; they never answer it (own-name.ts THE PREMISE). Absent otherwise.
   */
  rankLast?: boolean;
  /**
   * A region whose No sets aside no candidate and no
   * launch, but sets aside laws its question carries from the reasons of this many findings (a GDPR rule's CCPA cite, for
   * an EU-only team): asked all the same, inside the cap, and its effect line says so.
   */
  lawsOnly?: number;
  /** Launches an answer of No removes (a region), given the regions already answered No; null for a field, whose answer never removes a launch. */
  launches: number | null;
  /** The run's candidates, and the launches they make (the figure's denominators). */
  of: number;
  totalLaunches: number;
  /** The candidates whose printed severity the answer can change (today only the Analytics question's). */
  severity: number;
  /**
   * At least one answer changes this run, given the
   * answers already held - a region whose No settles a candidate (a), a field a candidate's seat reads (b), or a field
   * whose answer changes a severity the report prints (c). A field named only in a rule's preconditions does not count:
   * its answer never removes a launch and never changes the verdict. A question that changes nothing is not asked.
   */
  changes: boolean;
  /**
   * Every rule of the run, with candidates
   * or silent, whose `applicability_preconditions` name the field (a region: none). Its answer settles that premise for
   * the review and the report from the next scan, though it is not asked before this one (`changes` stays the relay's test).
   */
  premiseRules: string[];
  /** What the answer changes for the review, by the one computation (`answerEffect`): `changes`, or a premise of a rule of the run. */
  changesReview: boolean;
  /** The question's kind, from its x-question; null where it gives none. */
  kind: QuestionKind | null;
  /**
   * Asked before review by its kind where today's test would not put it
   * (`AnswerEffect.added`). Counted against ASKED_BEFORE_REVIEW_MAX like every other question.
   */
  added: boolean;
  /**
   * A question whose answer would change this run, past the
   * run's cap (ASKED_BEFORE_REVIEW_MAX, over every declaration question): not asked; the report lists it, for the next scan.
   */
  overCap: boolean;
  /** The candidates of this run an out-of-scope answer would settle without review (a scope question); else 0. */
  settles: number;
  /**
   * The previous run's report raised it (`questions_raised[]` of the latest
   * evidence log): planned on the review entrance only, where it is asked first and in every round until it is put.
   */
  raised: boolean;
  /** The law an applicability gate decides with this answer (`XQuestion.gate`), or null. */
  gate?: string | null;
  /** The labelled hint, where a file the program cannot confirm holds a value for the field; else null. */
  hint: string | null;
}

/** The jurisdictions the run's rules declare, sorted: one region question each. */
export function jurisdictionsOf(rules: Rule[]): string[] {
  return [...new Set(rules.flatMap((r) => r.jurisdiction ?? []))].sort();
}
/** The profile field an applicability precondition names (`platform=web` -> platform; `x[]` -> x). */
export const preconditionField = (cond: string): string => (cond.includes("=") ? cond.slice(0, cond.indexOf("=")) : cond.replace(/\[\]$/, ""));
/**
 * A candidate's declared-inapplicable preconditions (findings.json
 * `declared_inapplicable_preconditions`), each as the field the profile and the question source name and the kind of its
 * question (`questionKindOf`; none where the source gives none or is absent): what disposition.ts row 5 reads. The one
 * reading, for the assembly and for the second look's launch side alike.
 */
export function declaredInapplicableOf(source: DeclarationSource | null, exprs: unknown): { field: string; kind?: QuestionKind }[] {
  return (Array.isArray(exprs) ? exprs : [])
    .filter((e): e is string => typeof e === "string" && e !== "")
    .map((expr) => {
      const field = preconditionField(expr).replace(/^(?:ScanProfile|profile)\./, "");
      const kind = source ? questionKindOf(source, field) : null;
      return { field, ...(kind ? { kind } : {}) };
    });
}
/**
 * Whether a rule's seat is asked about a field - one of its context questions names the field by its dotted path,
 * alone or after `ScanProfile.` (as the shipped rules name `ScanProfile.distribution_regions`). The rule declares it in
 * its own words; nothing is inferred from a question that does not name the field.
 */
export function seatReads(rule: Rule, field: string): boolean {
  const re = new RegExp(`(?:^|[^A-Za-z0-9_.])(?:ScanProfile\\.)?${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`);
  return (rule.context_questions ?? []).some((q) => typeof q === "string" && re.test(q));
}

/**
 * The one field whose answer changes a severity the report prints today - `own_instance` stops the
 * raise of a self-hostable vendor's place (severity-at-place.ts, SELF_HOSTABLE_RULES).
 */
const SEVERITY_FIELD = "features.own_domain_endpoints";

/**
 * THE ONE
 * COMPUTATION of what an answer to a (non-region) field changes, read by the question plan (`plannedQuestions`, and so
 * `declaration-plan.json`) and, through the plan, by the report: the two never decide it apart again.
 * - `asksToday` is the relay's test, unchanged (`seated.length > 0 || severity > 0`): every question it put before this
 *   change is still put.
 * - `asksBeforeReview`
 *   (fixes A-D, 2026-11-02, change the 2026-10-28 stage-1 rule) adds, by the question's kind
 *   (ASKED_BEFORE_REVIEW_KINDS), the questions whose answer changes what this run reports: a `scope` question an
 *   out-of-scope answer to which would settle a candidate of this run (`settles`), a `condition` or `feature` question a
 *   candidate's rule names in a precondition or a context question. Those it adds (`added`) are bounded per run by
 *   ASKED_BEFORE_REVIEW_MAX in the plan, with every other question (section 3.H). An `order` question, or one with
 *   no kind, is asked by today's test alone.
 * - `changesReview` adds a premise: a rule of the run, with candidates or silent, whose preconditions name the field.
 *   Such a question not asked before review is listed in the report; its answer, given through the review entrance,
 *   settles the premise from the next scan, and the report never calls it one "nobody answered".
 * A question marked `when: after_report` is never asked before review, whatever names it (no shipped question is).
 */
export interface AnswerEffect {
  premise: Candidate[];
  premiseRules: string[];
  seated: Candidate[];
  severity: number;
  asksToday: boolean;
  /** The candidates an out-of-scope answer to this (scope) question would settle without review; empty for other kinds. */
  settles: Candidate[];
  added: boolean;
  asksBeforeReview: boolean;
  changesReview: boolean;
}
export function answerEffect(field: string, rules: Rule[], candidates: Candidate[], x?: XQuestion): AnswerEffect {
  const names = (r: Rule | undefined): boolean => (r?.applicability_preconditions ?? []).some((p) => preconditionField(p) === field);
  const byId = new Map(rules.map((r) => [r.id, r]));
  const premise = candidates.filter((c) => names(byId.get(c.rule_id)));
  const premiseRules = rules.filter((r) => names(r)).map((r) => r.id).sort();
  const seated = candidates.filter((c) => {
    const r = byId.get(c.rule_id);
    return r !== undefined && seatReads(r, field);
  });
  const severity = field === SEVERITY_FIELD ? candidates.filter((c) => SELF_HOSTABLE_RULES.has(c.rule_id)).length : 0;
  // A question held for after the report is never put before review, whatever names it.
  const held = x?.when === "after_report";
  const asksToday = !held && (seated.length > 0 || severity > 0);
  const kind = x?.kind;
  const settling = kind !== undefined && SETTLES_WITHOUT_REVIEW.includes(kind) && x !== undefined && optionsOf(x).some((o) => o.settles_as === "out_of_scope");
  const settles = settling ? premise : [];
  const byKind = kind !== undefined && ASKED_BEFORE_REVIEW_KINDS.includes(kind) && (SETTLES_WITHOUT_REVIEW.includes(kind) ? settles.length > 0 : premise.length > 0 || seated.length > 0);
  const asksBeforeReview = !held && (asksToday || byKind);
  return { premise, premiseRules, seated, severity, asksToday, settles, added: asksBeforeReview && !asksToday, asksBeforeReview, changesReview: asksBeforeReview || premiseRules.length > 0 };
}

function readPath(obj: unknown, path: string): unknown {
  let at: unknown = obj;
  for (const k of path.split(".")) {
    if (!isRecord(at)) return undefined;
    at = at[k];
  }
  return at;
}

/**
 * Every question a candidate of this run turns on, with its figures (unordered, nothing filtered by the record).
 * `hintsFrom` is the parsed content of a declaration file the program cannot confirm, or null.
 * `chosen`: the questions this run already chose to ask before
 * review (a take carries them in its round, the terminal from its first plan); null on a run's first plan, which chooses
 * them: every question whose answer changes this run and that has no confirmed answer, whole fields by the findings they
 * decide, while ASKED_BEFORE_REVIEW_MAX holds them. A question not chosen is not asked (`overCap`, `changes` false) and
 * the report lists it. `capped` false (the review entrance, CI) chooses nothing and caps nothing.
 */
export function plannedQuestions(source: DeclarationSource, rules: Rule[], candidates: Candidate[], hintsFrom: unknown, held: RecordRow[] = [], raised: ReadonlySet<string> = new Set(), chosen: ReadonlySet<string> | null = null, capped = true, manifestNames: readonly ManifestName[] | null = null): PlannedQuestion[] {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const out: PlannedQuestion[] = [];
  const hint = (field: string): string | null => {
    const v = hintsFrom === null ? undefined : readPath(hintsFrom, field);
    return v === undefined ? null : source.hint.split("{value}").join(JSON.stringify(v));
  };
  const ruleIds = (cs: Candidate[]): string[] => [...new Set(cs.map((m) => m.rule_id))].sort();
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const key = c.adjudication_group?.key;
    if (key !== undefined) groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const totalLaunches = [...groups.values()].reduce((n, g) => n + launchesOfGroup(g), 0);
  const plan = (field: string, x: XQuestion, code: string | null, mine: Candidate[], seated: Candidate[], launches: number | null, changes: boolean, severity = 0, premiseRules: string[] = [], added = false, settles = 0): void => {
    const c = concrete(x, code);
    out.push({
      id: questionId(field, code),
      field,
      code,
      header: c.header,
      text: c.question,
      digest: questionDigest(x, code),
      ...((): { digestBefore?: string } => {
        const before = versionBeforeSettlesAs(field, x, code);
        return before !== null ? { digestBefore: before } : {};
      })(),
      options: c.options,
      unanswered: c.unanswered,
      multiSelect: c.multiSelect === true,
      candidates: mine.length,
      rules: ruleIds(mine),
      seats: seated.length,
      seatRules: ruleIds(seated),
      affected: [...new Set([...mine, ...seated].map((m) => m.finding_id))].sort(),
      launches,
      of: candidates.length,
      totalLaunches,
      severity,
      changes,
      premiseRules,
      changesReview: changes || premiseRules.length > 0,
      kind: x.kind ?? null,
      added,
      overCap: false,
      settles,
      raised: raised.has(field),
      gate: typeof x.gate === "string" ? x.gate : null,
      hint: hint(field),
    });
  };
  // With no candidate, only a question the previous report raised is planned
  // (the review entrance asks it whatever this run found); an ordinary scan, whose raised set is empty, plans nothing.
  if (candidates.length === 0 && raised.size === 0) return out;
  const codes = candidates.length === 0 ? [] : jurisdictionsOf(rules);
  for (const { field, x } of source.fields) {
    if (x.per === "jurisdiction") {
      if (field !== REGIONS) continue;
      // Open-world: region R's No is weighed with the regions already answered - Yes ones reach their rules,
      // No ones rule theirs out - and R is put only where its No would settle a candidate those answers leave open.
      const answer = (code: string): unknown => held.find((r) => r.field === REGIONS && r.code === code && r.outcome === "answered")?.value;
      const settledBy = (no: string[]): { candidates: number; launches: number } => {
        const yes = codes.filter((o) => answer(o) === true);
        const asIf = { profile_version: "1", platform: "unknown", distribution_regions: yes.length > 0 ? yes : ["unknown"], regions_not_offered: no } as unknown as ScanProfile;
        const s = perRuleApplicability(rules, candidates, asIf, new Map()).summary;
        return { candidates: s.candidates_not_adjudicated, launches: s.launches_removed };
      };
      for (const code of codes) {
        const mine = candidates.filter((c) => (byId.get(c.rule_id)?.jurisdiction ?? []).includes(code));
        const before = codes.filter((o) => o !== code && answer(o) === false);
        const base = settledBy(before);
        const withNo = settledBy([...before, code]);
        /* A No that would set aside a law cited by a candidate's rule (region-reach.ts
         * `regimesSettledBy`: a law of this place whose question carries its test) changes the report though it sets aside
         * no candidate: the cited law leaves the finding's reasons (fix-order.ts `basisAnsweredOut`). It is asked too. */
        const citing = mine.filter((c) => {
          const r = byId.get(c.rule_id);
          return r !== undefined && regimesSettledBy(r, code).length > 0;
        });
        const settles = withNo.candidates > base.candidates;
        plan(field, x, code, mine, [], withNo.launches - base.launches, settles || citing.length > 0);
        if (!settles && citing.length > 0) (out[out.length - 1] as PlannedQuestion).lawsOnly = citing.length;
      }
      continue;
    }
    if (x.per === "vendor") {
      // The
      // self-name question: asked only where a recipient rule's candidate names a vocabulary vendor entry, about the entry
      // named on the most places (one entry: AskUserQuestion offers four choices, and "A fork of one of these", "None of
      // these" and Not answering take three). Its order key is the places the answer changes how they are read, each its
      // own decision row: `orderPlaces` holds them, so the existing ordering ranks it by places; `affected` holds the
      // findings those places belong to, as on every question, and the effect line counts findings.
      if (field !== VENDOR_SOFTWARE_FIELD || candidates.length === 0) continue;
      const top = ownNameTally(rules, candidates)[0];
      if (!top) continue;
      plan(field, x, top.entry, [], top.candidates, null, true);
      const q = out[out.length - 1]!;
      // The count with a thousands separator (`countWords`). "named in", not "named on" (the text is not part of `questionDigest`).
      q.text = `${q.text}${top.entity ? ` (${top.entity})` : ""} - named in ${countWords(top.places)} ${top.places === 1 ? "place" : "places"}.`;
      q.options = q.options.map((o, i) => (i === 0 && top.entity ? { ...o, description: `${top.entity}: ${o.description}` } : o));
      q.orderPlaces = top.placeKeys;
      // Asked first only where a root manifest names the tree with one of the entry's name words.
      if (manifestNames !== null) {
        const rule = rules.find((r) => SELF_NAME_RULES.has(r.id) && Object.values(r.detector?.vocabulary_owners ?? {}).some((l) => Object.values(l ?? {}).includes(top.entry)));
        if (ownNamePremiseOf({ entry: top.entry, relation: "own" }, manifestNames, nameWordsOf(rule, top.entry)) !== "corroborates") q.rankLast = true;
      }
      continue;
    }
    // Through the scope (a precondition names the field) or through the seat (a context question names it).
    // One computation (`answerEffect`), the relay's test unchanged; a field only a silent rule's precondition names is
    // planned too (fix C), never asked before the scan.
    const e = answerEffect(field, rules, candidates, x);
    // A question the previous run's report raised
    // (`questions_raised[]` of its evidence log, a planning input) is planned on the review entrance only: `raised` is
    // empty on every other scan, and such a question is never asked before an ordinary scan (`changes` stays false).
    if (!e.changesReview && !raised.has(field)) continue;
    if (candidates.length === 0 && !raised.has(field)) continue;
    if (x.per === "part") (x.parts ?? []).forEach((_, i) => plan(field, x, String(i + 1), e.premise, e.seated, null, e.asksBeforeReview, e.severity, e.premiseRules, e.added, e.settles.length));
    else plan(field, x, null, e.premise, e.seated, null, e.asksBeforeReview, e.severity, e.premiseRules, e.added, e.settles.length);
  }
  if (capped) capBeforeReview(out, held, chosen);
  return out;
}

/**
 * (the answer to its question 1)
 * THE CAP on the questions a run asks before review, over every declaration question (today's, the regions, the
 * ones added by their kind). With `chosen` (a later plan of the same run), exactly those are asked: a take, or the
 * terminal's re-plan after an answer, never opens a second set (an open-world region whose No matters only after another
 * answer goes to the report). Otherwise the questions that change this run and still need an answer (no row at their
 * current version, or a row with no answer: `selectQuestions`' "scan" test and its order, the findings each field decides,
 * then launches, then the field) are taken whole field by whole field while ASKED_BEFORE_REVIEW_MAX holds them; a field
 * with more questions than an empty cap takes its first ones (as `firstRound` splits it), and a field that does not fit
 * leaves room for a smaller one after it. A question already answered is not asked and counts nothing. The rest are
 * `overCap`: not asked, listed in the plan (NOT_ASKED_LATER) and the report, used from the next scan.
 */
function capBeforeReview(planned: PlannedQuestion[], held: RecordRow[], chosen: ReadonlySet<string> | null): void {
  const over = (q: PlannedQuestion): void => {
    q.changes = false;
    q.overCap = true;
  };
  const needs = selectQuestions(planned, held, "scan");
  if (chosen !== null) {
    for (const q of needs) if (!chosen.has(q.id)) over(q);
    return;
  }
  let taken = 0;
  for (let i = 0; i < needs.length; ) {
    const field = needs[i]!.field;
    const unit = needs.slice(i).filter((q) => q.field === field);
    if (taken + unit.length <= ASKED_BEFORE_REVIEW_MAX) taken += unit.length;
    else if (taken === 0) {
      taken = ASKED_BEFORE_REVIEW_MAX;
      unit.slice(ASKED_BEFORE_REVIEW_MAX).forEach(over);
    } else unit.forEach(over);
    i += unit.length;
  }
}
/**
 * The added questions a plan asks this run (the round's `added`, a
 * record of which asked questions their kind added).
 */
export const addedAsked = (planned: PlannedQuestion[]): string[] => planned.filter((q) => q.added && q.changes).map((q) => q.id).sort();
/**
 * Every question a plan asks this run, after the cap: the set a
 * later plan of the run is given (`chosen`), carried by every round the run writes (`asked_before_review`).
 */
export const askedBeforeReview = (planned: PlannedQuestion[]): string[] => planned.filter((q) => q.changes).map((q) => q.id).sort();

/**
 * The questions the
 * previous run's report raised, read from its evidence log (`questions_raised[].question`) as a planning input for
 * `scan --review-declaration`. The log is the latest one under `<legal dir>/evidence/` by the names the assembly writes
 * (legal-dir.ts `latestEvidenceLog`, the one place that names where the log is written and where it is found). Only
 * fields the program's question source holds are taken; anything else, or no log, is an empty set.
 */
export function questionsRaisedOf(legalDir: string, source: DeclarationSource): Set<string> {
  const known = new Set(source.fields.map((f) => f.field));
  try {
    const path = latestEvidenceLog(legalDir);
    if (path === null) return new Set();
    const log = JSON.parse(readRegularFile(path, "utf8")) as Record<string, unknown>;
    const qs = Array.isArray(log.questions_raised) ? log.questions_raised : [];
    return new Set(qs.map((q) => (isRecord(q) && typeof q.question === "string" ? q.question : "")).filter((f) => known.has(f)));
  } catch {
    return new Set();
  }
}

export type Outcome = "answered" | "not-answering" | "no-answer";
export type AnswerPath = "terminal" | "plugin";
/** One row of the record: a question put, and what became of it. */
export interface RecordRow {
  id: string;
  field: string;
  code: string | null;
  header: string;
  digest: string;
  outcome: Outcome;
  label: string | null;
  value: unknown;
  path: AnswerPath;
  at: string;
  tool_use_id?: string;
}
export interface DeclarationRecord {
  kind: "declaration-record";
  version: 1;
  profile_sha256: string;
  written_at: string;
  questions: RecordRow[];
}

/** What the declaration directory holds, read once. `status`: none (no profile.json), no-record, changed (sha256), ok. */
export interface ReadDeclaration {
  dir: string;
  profilePath: string;
  status: "none" | "no-record" | "changed" | "ok";
  /** The profile file's parsed content (null where it is absent or not JSON). */
  content: unknown;
  record: DeclarationRecord | null;
  why: string | null;
}
/** What stands at a path, without following a link; null where nothing does. */
const standing = (path: string): ReturnType<typeof lstatSync> | null => {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
};
/**
 * The declaration directory, read once, and only through the one reader of program-written files (program-file.ts `readProgramFile`):
 * the program is the only writer of profile.json and its record,
 * so anything else at either path - a link, a directory, a named pipe, a device, a file with a second name - is not a
 * file it wrote. It is never followed and never waited on: the declaration is unconfirmed, its content is not read
 * (no hint), and it is set aside whole before the program's first write there (`setAsideUnconfirmed`).
 */
export function readDeclaration(dir: string): ReadDeclaration {
  const profilePath = join(dir, DECLARATION_PROFILE_FILE);
  const recordPath = join(dir, DECLARATION_RECORD_FILE);
  const base = { dir, profilePath, content: null as unknown, record: null as DeclarationRecord | null };
  if (standing(profilePath) === null) return { ...base, status: "none", why: null };
  const got = readProgramFile("the declaration", profilePath);
  if (!got.ok) return { ...base, status: "no-record", why: `${profilePath} is not a file the program wrote (${got.problem}), so it was not read` };
  const bytes = got.value;
  try {
    base.content = JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    return { ...base, status: "no-record", why: `${profilePath} could not be read as JSON (${(e as Error).message})` };
  }
  let record: unknown = null;
  let recordProblem: string | null = null;
  if (standing(recordPath) !== null) {
    const rec = readProgramFile("the declaration's record", recordPath);
    if (rec.ok) {
      try {
        record = JSON.parse(rec.value.toString("utf8"));
      } catch {
        record = null;
      }
    } else recordProblem = rec.problem;
  }
  if (!isRecord(record) || record.kind !== "declaration-record" || record.version !== 1 || typeof record.profile_sha256 !== "string" || !Array.isArray(record.questions)) {
    const why = recordProblem !== null ? `${recordPath} is not a record the program wrote (${recordProblem})` : `${profilePath} has no confirmation record the program wrote (${recordPath})`;
    return { ...base, status: "no-record", why: `${why}, so it is a declaration nobody confirmed through the program's questions` };
  }
  const rec = record as unknown as DeclarationRecord;
  const now = sha256(bytes);
  if (rec.profile_sha256 !== now) {
    return { ...base, record: rec, status: "changed", why: `${profilePath} was changed after the program wrote it (sha256 ${now}, the record's ${rec.profile_sha256})` };
  }
  return { ...base, record: rec, status: "ok", why: null };
}

/**
 * BEFORE THE PROGRAM'S FIRST WRITE over a declaration it did not write (no record, a changed file, anything that is
 * not a regular file, or a record with no declaration beside it), whatever stands at profile.json and at its record is
 * moved aside whole - renamed, never read, a link moved as a link - into `<dir>/set-aside-<ISO8601>/`, the directory
 * step 1a of SKILL.md uses, keeping each name. The person decides on it; SKILL.md step 6 reports it from there. Null
 * where the program wrote what is there (status ok) or nothing is there.
 */
export function setAsideUnconfirmed(read: ReadDeclaration, at: Date): { dir: string; moved: { from: string; to: string }[] } | null {
  if (read.status === "ok") return null;
  const paths = [read.profilePath, join(read.dir, DECLARATION_RECORD_FILE)].filter((p) => standing(p) !== null);
  if (paths.length === 0) return null;
  const stamp = at.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
  let dir = join(read.dir, `set-aside-${stamp}`);
  for (let n = 2; standing(dir) !== null; n++) dir = join(read.dir, `set-aside-${stamp}-${n}`);
  makeFolder(dir, { recursive: true });
  const moved = paths.map((from) => {
    const to = join(dir, basename(from));
    renamePath(from, to);
    return { from, to };
  });
  return { dir, moved };
}
/** The sentence that says what `setAsideUnconfirmed` moved, and why. */
export function setAsideNote(read: ReadDeclaration, aside: { moved: { from: string; to: string }[] }): string {
  const what = aside.moved.map((m) => `${m.from} to ${m.to}`).join(", and ");
  return `Before writing the declaration, the program moved aside, whole and unchanged, what it did not write: ${what} (${read.why ?? "no record the program wrote stands behind it"}). The person decides on it; any value of it shown beside the questions was a hint, never an answer.`;
}

/** The hint values a round carries: those of the fields its questions (and the rounds after it) ask, never the whole file. */
export function hintsFor(questions: PlannedQuestion[], from: unknown): Record<string, unknown> | null {
  if (from === null || from === undefined) return null;
  const out: Record<string, unknown> = {};
  let any = false;
  for (const field of new Set(questions.map((q) => q.field))) {
    const v = readPath(from, field);
    if (v === undefined) continue;
    const keys = field.split(".");
    let at = out;
    for (const k of keys.slice(0, -1)) {
      if (!isRecord(at[k])) at[k] = {};
      at = at[k] as Record<string, unknown>;
    }
    at[keys.at(-1)!] = v;
    any = true;
  }
  return any ? out : null;
}

/** The current digest of a row's question, or null where the source no longer asks it. */
function rowAtVersion(source: DeclarationSource, row: { field: string; code: string | null; digest: string }): boolean {
  const f = source.fields.find((s) => s.field === row.field);
  return f !== undefined && atVersion(row.digest, row.field, f.x, row.code ?? null);
}
/** The record's rows that still count: a record the file matches, each row at its question's current version (`atVersion`). */
export function currentRows(source: DeclarationSource, read: ReadDeclaration): RecordRow[] {
  if (read.status !== "ok" || !read.record) return [];
  return read.record.questions.filter((r) => rowAtVersion(source, r));
}
/** A row is at a planned question's current version: its digest, or the one before `settles_as` was part of it. */
const rowAtPlanned = (r: { digest: string }, q: PlannedQuestion): boolean => r.digest === q.digest || (q.digestBefore !== undefined && r.digest === q.digestBefore);

/**
 * THE ANSWERS THAT
 * SETTLE A RULE WITHOUT REVIEW: the rows of the program's confirmed record (status ok, each row at its question's current
 * version, `currentRows`) that answer a question of a kind in SETTLES_WITHOUT_REVIEW with an option whose `settles_as` is
 * `out_of_scope`. The regions are not here (their No is the jurisdiction test's). Nothing else is: a file the program
 * did not write, a changed file, a `--profile` of another file, an answer recorded at an earlier version of its question,
 * a Skip and a dialog closed with no answer settle nothing, and every rule they name is adjudicated as before.
 */
export function scopeSettlementsOf(source: DeclarationSource, read: ReadDeclaration): ScopeSettlement[] {
  const out: ScopeSettlement[] = [];
  for (const r of currentRows(source, read)) {
    if (r.outcome !== "answered" || r.label === null) continue;
    const f = source.fields.find((s) => s.field === r.field);
    if (!f || f.x.per === "jurisdiction" || f.x.kind === undefined || !SETTLES_WITHOUT_REVIEW.includes(f.x.kind)) continue;
    const opt = concrete(f.x, r.code ?? null).options.find((o) => o.label === r.label);
    if (opt?.settles_as !== "out_of_scope") continue;
    out.push({ field: r.field, header: r.header, answer: r.label, value: r.value, recorded_at: r.at });
  }
  return out;
}

/**
 * (for the disposition, WP3) The person's answers in the program's
 * confirmed record, by question id, each with the question's kind and the chosen option's `settles_as` - the shape
 * disposition.ts `dispositionOf` reads as `answers`. A row at an earlier version of its question is not an answer.
 */
export function givenAnswersOf(source: DeclarationSource, read: ReadDeclaration): Map<string, { label: string | null; value: unknown; at: string; kind?: QuestionKind; settlesAs?: SettlesAs }> {
  const out = new Map<string, { label: string | null; value: unknown; at: string; kind?: QuestionKind; settlesAs?: SettlesAs }>();
  for (const r of currentRows(source, read)) {
    if (r.outcome !== "answered") continue;
    const f = source.fields.find((s) => s.field === r.field);
    const opt = f ? concrete(f.x, r.code ?? null).options.find((o) => o.label === r.label) : undefined;
    out.set(r.id, { label: r.label, value: r.value, at: r.at, ...(f?.x.kind ? { kind: f.x.kind } : {}), ...(opt?.settles_as ? { settlesAs: opt.settles_as } : {}) });
  }
  return out;
}

/**
 * R6: whether the scan reads the declaration this run. Only where the file's sha256 is the record's, every field the
 * file holds a value for (other than the schema's own unanswered value) is backed by a row at its question's current
 * version, and every jurisdiction of this run's rules has a row at the current version. Otherwise nothing is read.
 * A field `staleOrderFields` names is the exception: it stops nothing, and the scan reads the file without it.
 */
export function usable(source: DeclarationSource, read: ReadDeclaration, jurisdictions: string[]): { ok: true } | { ok: false; kind: "declaration-unconfirmed" | "declaration-question-changed"; why: string } {
  if (read.status === "none") return { ok: false, kind: "declaration-unconfirmed", why: `there is no ${read.profilePath}: nobody has answered the declaration questions yet` };
  if (read.status !== "ok") return { ok: false, kind: "declaration-unconfirmed", why: read.why ?? "it is unconfirmed" };
  const rows = currentRows(source, read);
  const has = (id: string): boolean => rows.some((r) => r.id === id);
  const stale: string[] = [];
  const leftOut = new Set(staleOrderFields(source, read));
  for (const { field, x } of source.fields) {
    if (x.per === "jurisdiction" || leftOut.has(field)) continue;
    const v = readPath(read.content, field);
    if (v === undefined || isUnansweredValue(x, v)) continue;
    if (x.per === "part") {
      (x.parts ?? []).forEach((p, i) => {
        if (!has(questionId(field, String(i + 1)))) stale.push(p.header);
      });
    } else if (x.per === "vendor") {
      const entry = isRecord(v) && typeof v.entry === "string" ? v.entry : null;
      if (entry === null ? !rows.some((r) => r.field === field) : !has(questionId(field, entry))) stale.push(x.header);
    } else if (!has(field)) stale.push(x.header);
  }
  // Open-world: a region the file names, Yes or No, must have its row; a region it does not name is open.
  void jurisdictions;
  const regions = source.fields.find((f) => f.field === REGIONS);
  const named = [readPath(read.content, REGIONS), readPath(read.content, NOT_OFFERED)].flatMap((v) => (Array.isArray(v) ? v.filter((c): c is string => typeof c === "string" && c !== "unknown") : []));
  if (regions) for (const code of new Set(named)) if (!has(questionId(REGIONS, code))) stale.push(concrete(regions.x, code).header);
  if (stale.length === 0) return { ok: true };
  return { ok: false, kind: "declaration-question-changed", why: `the rule pack asks ${stale.map((h) => JSON.stringify(h)).join(", ")} in a version the record has no answer to, so the declaration is not read until ${stale.length === 1 ? "it is" : "they are"} answered` };
}

/**
 * THE ANSWERS LEFT OUT UNTIL GIVEN AGAIN (FIN4 P1
 * defect 1). The fields whose question is never asked before review (`order`), whose value the file holds, and whose
 * every row in the record was recorded at an earlier version of the question: 0.1.0's minors "No", given when it only
 * moved the order and now asked again before it settles anything. Nothing asks an `order` question before review, so a
 * row like that must not stop the person's other saved answers being read (`usable`, which would read none of them and
 * run every region's rules on every scan); instead the field alone is left out of the profile the scan and the
 * pre-launch step read (profile.ts `loadScanProfile`'s `leaveOut`), so the old answer is applied nowhere: a finding that
 * turns on it waits on the question, the report raises it, and the review entrance asks it again. A value with no row at
 * all is not here (it stays a stale answer, as before). Empty where the record is not confirmed.
 */
export function staleOrderFields(source: DeclarationSource, read: ReadDeclaration): string[] {
  if (read.status !== "ok" || !read.record) return [];
  const out: string[] = [];
  for (const { field, x } of source.fields) {
    if (x.kind !== "order" || x.per !== undefined) continue;
    const v = readPath(read.content, field);
    if (v === undefined || isUnansweredValue(x, v)) continue;
    const own = read.record.questions.filter((r) => r.field === field);
    if (own.length > 0 && !own.some((r) => rowAtVersion(source, r))) out.push(field);
  }
  return out;
}

/**
 * Which of the planned questions to put, in order: "the questions that settle the most candidates first",
 * in place of launches first. `mode` "scan": a question
 * with no row at its current version, or one whose row is `no-answer`. "after-answer" (the scan
 * `--declaration-from-answer` runs again): only a question never put at its current version. A unit is the questions of
 * one field (the regions, the parts of a field asked in parts, or one question): units by the candidates they affect
 * (each counted once; the self-name question by the places it changes the reading of, `orderPlaces`), then by launches,
 * then by field; the regions by the candidates each marks, then launches, then
 * code; the parts in their order.
 */
export function selectQuestions(planned: PlannedQuestion[], rows: RecordRow[], mode: "scan" | "after-answer", all = false): PlannedQuestion[] {
  const row = new Map(rows.map((r) => [r.id, r]));
  // Only a question one of whose answers changes this run, unless every question is asked (a review).
  const put = planned.filter((q) => {
    if (!all && !q.changes) return false;
    const r = row.get(q.id);
    return r === undefined || !rowAtPlanned(r, q) || (mode === "scan" && r.outcome === "no-answer");
  });
  const units = new Map<string, PlannedQuestion[]>();
  for (const q of put) units.set(q.field, [...(units.get(q.field) ?? []), q]);
  const byCode = (a: PlannedQuestion, b: PlannedQuestion): number => (a.field === REGIONS ? b.candidates - a.candidates || (b.launches ?? 0) - (a.launches ?? 0) || (a.code! < b.code! ? -1 : 1) : Number(a.code) - Number(b.code));
  const ordered = [...units.entries()].map(([key, members]) => ({
    key,
    members: members.length > 1 ? [...members].sort(byCode) : members,
    // The findings the unit affects (each counted once); the self-name question's places (`orderPlaces`) in their place.
    weight: new Set(members.flatMap((m) => m.orderPlaces ?? m.affected)).size,
    launches: members.reduce((n, q) => n + (q.launches ?? 0), 0),
  }));
  // A question the previous report raised comes first (the review entrance
  // only; an ordinary scan plans none), so the round the report sent the person to opens with it.
  const raisedFirst = (u: { members: PlannedQuestion[] }): number => (u.members.some((m) => m.raised) ? 0 : 1);
  // The self-name question no manifest corroborates comes after every other.
  const last = (u: { members: PlannedQuestion[] }): number => (u.members.some((m) => m.rankLast) ? 1 : 0);
  ordered.sort((a, b) => raisedFirst(a) - raisedFirst(b) || last(a) - last(b) || b.weight - a.weight || b.launches - a.launches || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return ordered.flatMap((u) => u.members);
}
/** The first round: the ordered questions, whole units while they fit in QUESTIONS_PER_ROUND (a unit too big for an empty round is split). */
export function firstRound(ordered: PlannedQuestion[], max: number = QUESTIONS_PER_ROUND): PlannedQuestion[] {
  const round: PlannedQuestion[] = [];
  for (let i = 0; i < ordered.length; ) {
    const q = ordered[i]!;
    const unit = ordered.slice(i).filter((o) => o.field === q.field);
    if (round.length + unit.length <= max) round.push(...unit);
    else if (round.length === 0) round.push(...unit.slice(0, max));
    else break;
    i += unit.length;
    if (round.length >= max) break;
  }
  return round;
}

/**
 * The one unit every question's effect line counts in. Its counts
 * are the run's findings (candidates, by finding id: `seats`, `affected`, `severity`, `settles` and `of`), so it names
 * them findings; "place" is one location (a file and a line) wherever the person sees it, and one
 * finding can have many. The plan's record fields name them findings too (`findings_claude_reads_it_on`, part 2 item 3).
 */
export const EFFECT_UNIT = { one: "finding", many: "findings" } as const;
/**
 * A count the person reads in a question, with a thousands separator
 * (36,142), as the program's other counts print: every count of the questions' text and effect lines goes through it.
 */
export const countWords = (n: number): string => n.toLocaleString("en-US");
/** The line that says on how many of the run's findings Claude reads the answer. */
const USES_EFFECT = (k: number, n: number): string => `Claude uses your answer on ${countWords(k)} of the ${countWords(n)} ${EFFECT_UNIT.many}.`;

/**
 * What the answer changes, in the person's words (proposal section 6, screen 4): for a region, that the
 * answer decides which laws' checks run (no share of the review is named beside the question), the places Claude reads the answer on, and the
 * places whose rating it can change.
 */
export function figures(q: PlannedQuestion): string {
  // A question the run's cap left for the report says so first.
  if (q.overCap) return OVER_CAP_EFFECT;
  if (q.launches !== null) {
    // A No that only sets aside the place's laws from findings' reasons.
    if (q.changes && q.lawsOnly !== undefined && q.lawsOnly > 0)
      return `If No, the laws of ${q.code !== null ? (REGION_NAMES[q.code] ?? q.code) : "that place"} that this answer settles are left out of the reasons given for ${q.lawsOnly === 1 ? `1 ${EFFECT_UNIT.one}` : `${countWords(q.lawsOnly)} ${EFFECT_UNIT.many}`}; the AI review is the same.`;
    if (q.launches <= 0 || q.totalLaunches <= 0) return q.changes ? `If No, some ${EFFECT_UNIT.many} are settled without the AI review.` : "No answer to it changes this scan.";
    // A figure beside a question about the product would invite the cheaper answer, and a No that is not true removes
    // that region's laws from the report; the price shown before the review starts already reflects the answer.
    return "Your answer decides which laws' checks run.";
  }
  // An added question asked before review says what it decides in this scan.
  if (q.added && q.changes) {
    const out = q.options.find((o) => o.settles_as === "out_of_scope");
    if (q.settles > 0 && out) return SCOPE_EFFECT(out.label, q.settles, q.of);
    return USES_EFFECT(q.affected.length, q.of);
  }
  const parts: string[] = [];
  if (q.seats > 0) parts.push(USES_EFFECT(q.seats, q.of));
  if (q.severity > 0) parts.push(`It can change how serious ${q.severity === 1 ? `1 ${EFFECT_UNIT.one} is` : `${countWords(q.severity)} ${EFFECT_UNIT.many} are`} rated.`);
  if (parts.length === 0 && q.premiseRules.length > 0) return PREMISE_EFFECT(q.premiseRules.length);
  // A field a gate condition reads says that, not what a raised question changes:
  // there may be no last report, the answer decides whether a whole law reaches the product, and it is used now.
  if (parts.length === 0 && typeof q.gate === "string") return GATE_EFFECT(q.gate);
  if (parts.length === 0 && q.raised) return RAISED_EFFECT;
  return parts.length > 0 ? parts.join(" ") : "No answer to it changes this scan.";
}

/**
 * A question whose answer would change this scan,
 * left out by the cap of ASKED_BEFORE_REVIEW_MAX questions in one round before a scan (a region whose No matters only
 * after another answer of the same round included).
 */
const OVER_CAP_EFFECT = `Not asked before this scan: a scan asks at most ${ASKED_BEFORE_REVIEW_MAX} questions, all in one round, and this one was not among them. The report lists it; your answer is used from the next scan.`;
/** What an answer to a question the last report raised changes. */
const RAISED_EFFECT = "Your last report raised it: it decides how findings of that report are ordered, and your answer is used from the next scan.";
/** What an answer to a condition of a law's applicability gate changes. */
const GATE_EFFECT = (law: string): string => `Your answer is one of the conditions that decide whether ${law} applies to this product, and this scan uses it.`;
/**
 * What an
 * out-of-scope answer to a scope question asked before review settles in this scan.
 */
const SCOPE_EFFECT = (label: string, k: number, n: number): string =>
  `If you answer "${label}", ${countWords(k)} of the ${countWords(n)} ${EFFECT_UNIT.many} are settled without the AI review; the report still lists them, with your answer and how to change it.`;
/** What an answer to a field only rules' premises name changes. */
const PREMISE_EFFECT = (rules: number): string => `Your answer settles a premise of ${rules === 1 ? "1 rule" : `${countWords(rules)} rules`} the review reads; it is used from the next scan.`;

/** The figures sentence the program's own record lines carried in earlier versions (counts of launches, candidates and seats). */
export function recordFigures(q: PlannedQuestion): string {
  const n = (k: number, one: string, many: string): string => `${k} ${k === 1 ? one : many}`;
  if (q.launches !== null) {
    const marks = q.candidates === 0 ? "It marks no candidate of this run: it is asked because the regions are one list." : `It marks ${n(q.candidates, "candidate", "candidates")} of ${n(q.rules.length, "rule", "rules")} in this run.`;
    return `An answer of No removes ${n(q.launches, "launch", "launches")} of this run, given the regions already answered (a region not asked stays open). ${marks}`;
  }
  const seats = q.seats === 0 ? "" : ` The seats of ${n(q.seats, "candidate", "candidates")} of ${n(q.seatRules.length, "rule", "rules")} in this run are asked about it (their context questions name it); the answer is read by those seats.`;
  if (q.candidates === 0) return `An answer removes no launch and marks no candidate.${seats}`;
  return `An answer removes no launch; it marks ${n(q.candidates, "candidate", "candidates")} of ${n(q.rules.length, "rule", "rules")} in this run.${seats}`;
}
/** The question as the person reads it in the dialog: the source's text, the figures, and a hint where there is one. */
export const askedText = (q: PlannedQuestion): string => `${q.text}\n${figures(q)}${q.hint ? `\n${q.hint}` : ""}`;
export const choices = (q: PlannedQuestion, source: DeclarationSource): { label: string; description: string }[] => [
  ...q.options.map((o) => ({ label: o.label, description: o.description })),
  { label: source.notAnswering.label, description: source.notAnswering.description },
];

/** The row an answer makes: a label of the question's options, Not answering, or nothing (null: no answer). */
export function rowFor(q: PlannedQuestion, source: DeclarationSource, label: string | null, path: AnswerPath, at: Date, toolUseId?: string): RecordRow {
  if (q.multiSelect) return multiRowFor(q, source, label, path, at, toolUseId);
  const opt = label === null ? undefined : q.options.find((o) => o.label === label);
  const outcome: Outcome = opt ? "answered" : label === source.notAnswering.label ? "not-answering" : "no-answer";
  return {
    id: q.id,
    field: q.field,
    code: q.code,
    header: q.header,
    digest: q.digest,
    outcome,
    label: outcome === "no-answer" ? null : label,
    value: opt ? opt.value : null,
    path,
    at: at.toISOString(),
    ...(toolUseId ? { tool_use_id: toolUseId } : {}),
  };
}

/**
 * The options a multi-select answer chose: the answer's text split at commas,
 * each part an option's label (Claude Code joins the labels chosen; the separator is read loosely, and an option's label
 * holds no comma, which the loader checks). Null where any part is not a label of the question (typed text), where
 * nothing is chosen, or where Not answering is among the parts; the options in the question's order otherwise.
 */
export function chosenOptions(q: { options: XOption[] }, label: string | null, notAnswering: string): XOption[] | null {
  if (label === null) return null;
  const parts = label.split(",").map((p) => p.trim()).filter((p) => p !== "");
  if (parts.length === 0 || parts.includes(notAnswering)) return null;
  if (!parts.every((p) => q.options.some((o) => o.label === p))) return null;
  return q.options.filter((o) => parts.includes(o.label));
}
/**
 * A multi-select question's row: answered with the chosen options (their labels joined by ", ", their values as a list in
 * the options' order); Not answering where it is among the choices, so a mixed answer leaves the field open and switches
 * nothing off; no answer otherwise, typed text included.
 */
function multiRowFor(q: PlannedQuestion, source: DeclarationSource, label: string | null, path: AnswerPath, at: Date, toolUseId?: string): RecordRow {
  const chosen = chosenOptions(q, label, source.notAnswering.label);
  const skipped = label !== null && label.split(",").map((p) => p.trim()).includes(source.notAnswering.label);
  const outcome: Outcome = chosen ? "answered" : skipped ? "not-answering" : "no-answer";
  return {
    id: q.id,
    field: q.field,
    code: q.code,
    header: q.header,
    digest: q.digest,
    outcome,
    label: chosen ? chosen.map((o) => o.label).join(", ") : outcome === "not-answering" ? source.notAnswering.label : null,
    value: chosen ? chosen.map((o) => o.value) : null,
    path,
    at: at.toISOString(),
    ...(toolUseId ? { tool_use_id: toolUseId } : {}),
  };
}

/** The rows of a record after new answers: a question's row replaced in place, a new question's row appended. */
export function mergeRows(old: RecordRow[], fresh: RecordRow[]): RecordRow[] {
  const out = [...old];
  for (const r of fresh) {
    const at = out.findIndex((o) => o.id === r.id);
    if (at === -1) out.push(r);
    else out[at] = r;
  }
  return out;
}

/**
 * The declaration the rows make (R5): an answered field set to its value; platform and distribution_regions, which the
 * schema requires, set to the source's unanswered value where they are not settled; every other field left out. The
 * regions are open-world: `distribution_regions` is the Yes set (unanswered where none is Yes) and
 * `regions_not_offered` the No set, always written (possibly empty) so a reader knows a region in neither is open.
 */
export function profileFromRows(rows: RecordRow[], source: DeclarationSource, jurisdictions: string[]): Record<string, unknown> {
  const unansweredOf = (field: string, fallback: unknown): unknown => source.fields.find((f) => f.field === field)?.x.unanswered ?? fallback;
  const profile: Record<string, unknown> = { profile_version: "1", platform: unansweredOf("platform", "unknown"), [REGIONS]: unansweredOf(REGIONS, ["unknown"]) };
  const regionRows = rows.filter((r) => r.field === REGIONS && r.code !== null && r.outcome === "answered");
  void jurisdictions;
  const yes = [...new Set(regionRows.filter((r) => r.value === true).map((r) => r.code!))].sort();
  if (yes.length > 0) profile[REGIONS] = yes;
  profile[NOT_OFFERED] = [...new Set(regionRows.filter((r) => r.value === false).map((r) => r.code!))].sort();
  const put = (field: string, value: unknown): void => {
    const keys = field.split(".");
    let at = profile;
    for (const k of keys.slice(0, -1)) {
      if (!isRecord(at[k])) at[k] = {};
      at = at[k] as Record<string, unknown>;
    }
    at[keys.at(-1)!] = value;
  };
  for (const r of rows) {
    // A region's row and a part's row carry a code: their fields are written below, from all their rows together.
    if (r.code !== null || r.outcome !== "answered") continue;
    put(r.field, r.value);
  }
  // Found by the class search: latest by instant, never by text ("Thu, 01 Jan ..." sorts after
  // every ISO time as text); a time that does not parse sorts first, so it is never the latest.
  const instantOrFirst = (v: unknown): number => {
    const n = typeof v === "string" ? Date.parse(v) : Number.NaN;
    return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
  };
  // The self-name question: its latest answered row, whichever entry it was asked about.
  for (const { field, x } of source.fields) {
    if (x.per !== "vendor") continue;
    const last = rows.filter((r) => r.field === field && r.code !== null && r.outcome === "answered").sort((a, b) => instantOrFirst(a.at) - instantOrFirst(b.at)).at(-1);
    if (last) put(field, last.value);
  }
  // A field asked in parts: the first part, in order, answered with a value (a null value defers to the next).
  for (const { field, x } of source.fields) {
    if (x.per !== "part") continue;
    const first = rows
      .filter((r) => r.field === field && r.code !== null && r.outcome === "answered" && r.value !== null && r.value !== undefined)
      .sort((a, b) => Number(a.code) - Number(b.code))[0];
    if (first) put(field, first.value);
  }
  return profile;
}

/** Write profile.json and its record (the program is their only writer). Returns the profile's path. */
export function writeDeclaration(dir: string, rows: RecordRow[], source: DeclarationSource, jurisdictions: string[], at: Date): string {
  makeFolder(dir, { recursive: true });
  const text = `${JSON.stringify(profileFromRows(rows, source, jurisdictions), null, 2)}\n`;
  const record: DeclarationRecord = { kind: "declaration-record", version: 1, profile_sha256: sha256(text), written_at: at.toISOString(), questions: rows };
  const put = (name: string, body: string): void => {
    const path = join(dir, name);
    const partial = `${path}.${process.pid}.partial`;
    writeFileAt(partial, body);
    renamePath(partial, path);
  };
  put(DECLARATION_PROFILE_FILE, text);
  put(DECLARATION_RECORD_FILE, `${JSON.stringify(record, null, 2)}\n`);
  return join(dir, DECLARATION_PROFILE_FILE);
}

/**
 * THE TERMINAL PATH (D9, R9): every question at once, in order, each as
 *   Declaration question <i> of <n> (<header>): <text and figures>
 *     Hint (...): <value>                 (only where there is one)
 *     <k>) <label>: <description>          (one line per choice; Not answering always the last)
 *   Answer 1-<m>:
 * A line that is not one of the numbers is asked again, three times in all, then recorded as no answer; the end of
 * input records every question left as no answer.
 */
export type TerminalIo = { input: NodeJS.ReadableStream; output: NodeJS.WritableStream };
/** One terminal for the whole run's questions: every question shares one reader, so a line typed ahead is never lost. */
export class TerminalAsker {
  private readonly rl: ReturnType<typeof createInterface>;
  private readonly lines: AsyncIterableIterator<string>;
  private ended = false;
  constructor(private readonly io: TerminalIo = { input: process.stdin, output: process.stdout }) {
    this.rl = createInterface({ input: io.input, terminal: false });
    this.lines = this.rl[Symbol.asyncIterator]();
  }
  /** One question: its block, then up to three tries; the label chosen, or null (no answer, or the end of input). */
  async one(i: number, n: number, header: string, text: string, hint: string | null, opts: { label: string; description: string }[], multi = false): Promise<string | null> {
    this.io.output.write(`\nDeclaration question ${i} of ${n} (${header}): ${text}\n`);
    if (hint) this.io.output.write(`  ${hint}\n`);
    for (const [k, o] of opts.entries()) this.io.output.write(`  ${k + 1}) ${o.label}: ${o.description}\n`);
    // A multi-select question takes several numbers, as "1,2"; the prompt line
    // itself stays the one the terminal interface fixes (D9).
    if (multi) this.io.output.write(`  More than one may apply: type each number that does, separated by commas (as 1,2).\n`);
    for (let tries = 0; tries < 3 && !this.ended; tries++) {
      this.io.output.write(`Answer 1-${opts.length}: `);
      const next = await this.lines.next();
      if (next.done) {
        this.ended = true;
        break;
      }
      const typed = String(next.value).trim();
      const picks = multi ? typed.split(",").map((t) => t.trim()) : [typed];
      const ks = picks.map((t) => Number.parseInt(t, 10));
      if (picks.length > 0 && ks.every((k, j) => Number.isInteger(k) && k >= 1 && k <= opts.length && String(k) === picks[j])) {
        return [...new Set(ks)].sort((a, b) => a - b).map((k) => opts[k - 1]!.label).join(", ");
      }
      this.io.output.write(`Not one of 1-${opts.length}.\n`);
    }
    return null;
  }
  /** Every question at once, in order (D9, R9): a row each. */
  async questions(questions: PlannedQuestion[], source: DeclarationSource, at: () => Date): Promise<RecordRow[]> {
    const rows: RecordRow[] = [];
    for (const [i, q] of questions.entries()) {
      const label = await this.one(i + 1, questions.length, q.header, `${q.text} ${figures(q)}`, q.hint, choices(q, source), q.multiSelect);
      rows.push(rowFor(q, source, label, "terminal", at()));
    }
    return rows;
  }
  close(): void {
    this.rl.close();
  }
}
export async function askInTerminal(questions: PlannedQuestion[], source: DeclarationSource, at: () => Date, io?: TerminalIo): Promise<RecordRow[]> {
  const t = new TerminalAsker(io);
  try {
    return await t.questions(questions, source, at);
  } finally {
    t.close();
  }
}

/**
 * SECTION 5.2.4'S LATER-RUN LINE, DISPLAY-ONLY.
 * On a plain scan outside CI that reads a declaration under its record, the answers this run's candidates turn
 * on - the fields of every confirmed row of a planned question not asked this run - are stated in one sentence: the
 * schema's same_answers.statement filled with them, the day they were saved and the review flag. The same text in a
 * session, in a terminal and with no terminal, made here and nowhere else. Nothing is asked about them: a question put
 * on every run gets answered without being read, so asking would not catch a stale answer, while stating them on every
 * run shows the person reading the results what the results are based on. `reviews` are the rows
 * REVIEW_DECLARATION_FLAG asks again (their rows leave the record, so each is asked as a question never put). Null where
 * no such answer exists.
 * WHAT IT NAMES IS WHAT THE SCAN USED: the record says which fields were
 * confirmed and the day; each field's value is read from the declaration the scan's first pass read (`UsedDeclaration`,
 * the one source), never from the record's rows, which a declaration edited with its record's sha256 alone (F17) or a
 * region answered Not answering (the regions then stay unanswered, D3) would make disagree with it. The regions are
 * the one list that pass used, or the source's `not_settled` word where it settled none; any other field its option's
 * label, or that word where the declaration leaves it open. Where the pass did not read the program's declaration (a
 * question changed, or a --profile of another file read in its place) there is no statement (`used` null). The review
 * line (REVIEW_DECLARATION_FLAG) names instead the answers it puts back, one per question, from their rows
 * (`reviewed`): those are what is asked again, whatever the scan used. The day is the local one (M6).
 */
export interface SavedAnswers {
  /** The statement, filled: printed as it is, on every path that prints it; null where the pass did not read the declaration. */
  statement: string | null;
  /** The answers it names, as one string: `<header>: <value>; ...`, each value the declaration the scan read; null likewise. */
  answers: string | null;
  /** The rows of the questions it covers, by id: the ones REVIEW_DECLARATION_FLAG asks again. */
  reviews: string[];
  /** Those rows' saved answers, one per question (`<header>: <label>; ...`): what the review line names. */
  reviewed: string;
  /** The day the answers were saved: the record's written_at (UTC) as a day in the machine's local time zone. */
  day: string;
}
/**
 * The declaration a scan's first pass read: the profile as profile.ts `loadScanProfile` handed it to
 * that pass (null where it read none), and the regions that pass settled - its findings' per_rule_applicability
 * `declared_regions` where `settled` is true, else null (no rule was ruled out on jurisdiction).
 */
export interface UsedDeclaration {
  profile: unknown;
  regions: string[] | null;
}
/** M6: an instant's day in the machine's local time zone, YYYY-MM-DD; the record keeps the instant in UTC. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}
/**
 * A multi-select question's stored value as the list it asks for: a single
 * saved value (a profile written before the question took several answers) is read as a one-item list. Any other value,
 * and any other question's value, as it is.
 */
export function valueAsAsked(x: XQuestion, value: unknown): unknown {
  return x.multiSelect === true && value !== undefined && value !== null && !Array.isArray(value) ? [value] : value;
}
/** Whether a stored value is the question's own unanswered value, a single saved value read as a one-item list. */
export function isUnansweredValue(x: XQuestion, value: unknown): boolean {
  return JSON.stringify(valueAsAsked(x, value)) === JSON.stringify(valueAsAsked(x, x.unanswered));
}
/**
 * The label of the option a stored value is, for any field: a part's options, or the self-name question's options with the
 * entry the value names put in; undefined where no option has the value.
 */
export function answerLabelOf(x: XQuestion, value: unknown): string | undefined {
  if (x.multiSelect === true) {
    const values = valueAsAsked(x, value);
    if (!Array.isArray(values) || values.length === 0) return undefined;
    const chosen = x.options.filter((o) => values.some((v) => JSON.stringify(v) === JSON.stringify(o.value)));
    return chosen.length === values.length ? chosen.map((o) => o.label).join(", ") : undefined;
  }
  const entry = x.per === "vendor" && isRecord(value) && typeof value.entry === "string" ? value.entry : null;
  const q = entry !== null ? concrete(x, entry) : x;
  const options = q.per === "part" ? (q.parts ?? []).flatMap((p) => p.options) : q.options;
  return options.find((o) => o.value !== null && JSON.stringify(o.value) === JSON.stringify(value))?.label;
}
/** One field of `{answers}`: its value in the declaration the pass read, through its question's labels (M1). */
function usedAnswer(source: DeclarationSource, field: string, used: UsedDeclaration): string {
  const f = source.fields.find((s) => s.field === field);
  const open = source.sameAnswers.notSettled;
  if (f?.x.per === "jurisdiction") return `${source.sameAnswers.regions}: ${used.regions === null ? open : used.regions.join(", ")}`;
  const header = f?.x.header ?? field;
  const value = readPath(used.profile, field);
  if (value === undefined || value === null || (f !== undefined && isUnansweredValue(f.x, value))) return `${header}: ${open}`;
  const label = f ? answerLabelOf(f.x, value) : undefined;
  return `${header}: ${label ?? JSON.stringify(value)}`;
}
export function savedAnswers(source: DeclarationSource, read: ReadDeclaration, planned: PlannedQuestion[], selected: PlannedQuestion[], used: UsedDeclaration | null): SavedAnswers | null {
  if (read.status !== "ok" || !read.record) return null;
  const again = new Set(selected.map((q) => q.id));
  const rows = new Map(currentRows(source, read).map((r) => [r.id, r]));
  const named = selectQuestions(planned, [], "scan", true)
    .filter((q) => !again.has(q.id))
    .map((q) => rows.get(q.id))
    .filter((r): r is RecordRow => r !== undefined && (r.outcome === "answered" || r.outcome === "not-answering"));
  if (named.length === 0) return null;
  const day = localDay(read.record.written_at);
  const reviews = named.map((r) => r.id);
  const reviewed = named.map((r) => `${r.header}: ${r.outcome === "answered" ? r.label : source.notAnswering.label}`).join("; ");
  if (used === null) return { statement: null, answers: null, reviews, reviewed, day };
  const answers = [...new Set(named.map((r) => r.field))].map((field) => usedAnswer(source, field, used)).join("; ");
  const slot: Record<string, string> = { "{date}": day, "{answers}": answers, "{flag}": REVIEW_DECLARATION_FLAG };
  // One pass, so that a value holding a slot's name is never filled again.
  const statement = source.sameAnswers.statement.replace(/\{(?:date|answers|flag)\}/g, (m) => slot[m] ?? m);
  return { statement, answers, reviews, reviewed, day };
}

/** One planned question in `declaration-plan.json`, with what became of it in this run. */
export interface DeclarationPlanRow {
  id: string;
  field: string;
  code: string | null;
  header: string;
  question: string;
  effect: string;
  launches_if_no: number | null;
  /** Findings, as every count of the row (`PlannedQuestion.seats`, `.severity`). */
  findings_claude_reads_it_on: number;
  findings_whose_rating_it_can_change: number;
  status: PlanStatus;
  /** The rules of the run whose premise the answer settles (`PlannedQuestion.premiseRules`). */
  premise_rules: string[];
  /** The question's kind (null where its x-question gives none). */
  kind: QuestionKind | null;
  /** Asked before review by its kind, beyond today's test; `over_cap` where the run's cap left it for the report. */
  added: boolean;
  over_cap: boolean;
  answered_on?: string;
}
/**
 * What became of a planned question. `NOT_ASKED_LATER`: not asked before this scan (the
 * relay's test is unchanged), though its answer settles a rule's premise - the report and the review entrance read it.
 */
export const NOT_ASKED_NONE = "not asked: no answer changes this run";
export const NOT_ASKED_LATER = "not asked before the scan: the answer settles a rule's premise from the next scan";
export type PlanStatus = "asked" | "answered before" | typeof NOT_ASKED_NONE | typeof NOT_ASKED_LATER;

/**
 * The run's planned questions and what became of each - asked now, answered before (the day
 * its row was saved), or not asked because no answer changes this run. The question screen's "Not asked" line and the
 * report's list of questions not asked read it; `findings.json` never carries it (the speed lane's byte identity).
 */
export function declarationPlan(planned: PlannedQuestion[], selected: PlannedQuestion[], rows: RecordRow[]): { questions: DeclarationPlanRow[]; asked: number; not_asked: number; not_asked_later: number } {
  const asked = new Set(selected.map((q) => q.id));
  const row = new Map(rows.map((r) => [r.id, r]));
  const questions = planned.map((q): DeclarationPlanRow => {
    const r = row.get(q.id);
    const before = !asked.has(q.id) && r !== undefined && rowAtPlanned(r, q) && r.outcome !== "no-answer";
    return {
      id: q.id,
      field: q.field,
      code: q.code,
      header: q.header,
      question: q.text,
      effect: figures(q),
      launches_if_no: q.launches,
      findings_claude_reads_it_on: q.seats,
      findings_whose_rating_it_can_change: q.severity,
      status: asked.has(q.id) ? "asked" : before ? "answered before" : q.changesReview && !q.changes ? NOT_ASKED_LATER : NOT_ASKED_NONE,
      premise_rules: q.premiseRules,
      kind: q.kind,
      added: q.added,
      over_cap: q.overCap,
      ...(before ? { answered_on: localDay(r!.at) } : {}),
    };
  });
  const count = (st: PlanStatus): number => questions.filter((q) => q.status === st).length;
  return { questions, asked: count("asked"), not_asked: count(NOT_ASKED_NONE), not_asked_later: count(NOT_ASKED_LATER) };
}

/**
 * WHOSE ANSWERS THE SCAN USED (design rf11 3.3, "Whose answers, on every screen"): the
 * scan states it in its declaration plan and the assembly copies it into the evidence log (`answers_used`), so that every
 * view reads it from the scan's own log and never from the answer files as they stand later. `own`: answers the program
 * wrote in this folder on this computer; `team`: a saved pair the person confirmed here; `file`: a --profile read as
 * given, outside a session; `none`, with why: no saved answers, a pair not usable this run, a pair not confirmed here
 * (its question asked, or nobody to ask), or the person's "Not now".
 */
export interface AnswersUsed {
  whose: "own" | "team" | "file" | "none";
  reason?: "no-saved-answers" | "not-usable" | "not-confirmed-here" | "not-now";
  file?: string;
  saved_at?: string;
  confirmed_at?: string;
  profile_sha256?: string;
  record_sha256?: string;
  commit?: { id: string; author: string; date: string; default_branch: string | null; on_default_branch: boolean | null } | null;
  answers?: { id: string; header: string; answer: string }[];
}
const WHOSE = ["own", "team", "file", "none"];
/** The plan's `answers_used`, where it is one; null otherwise (a plan of an earlier build, or none). */
export function answersUsedOf(plan: unknown): AnswersUsed | null {
  const u = isRecord(plan) ? plan.answers_used : undefined;
  return isRecord(u) && typeof u.whose === "string" && WHOSE.includes(u.whose) ? (JSON.parse(JSON.stringify(u)) as AnswersUsed) : null;
}

/**
 * Write `declaration-plan.json` in the declaration's directory (the program is its only writer). Returns its path and the
 * sha256 of the bytes written, which the scan records in the person's state folder.
 */
export function writeDeclarationPlan(dir: string, scanId: string, plan: ReturnType<typeof declarationPlan>, at: Date, answersUsed: AnswersUsed | null = null): { path: string; sha256: string } {
  makeFolder(dir, { recursive: true });
  const path = join(dir, DECLARATION_PLAN_FILE);
  const partial = `${path}.${process.pid}.partial`;
  const text = `${JSON.stringify({ kind: "declaration-plan", version: 1, scan_id: scanId, written_at: at.toISOString(), ...plan, ...(answersUsed === null ? {} : { answers_used: answersUsed }) }, null, 2)}\n`;
  writeFileAt(partial, text);
  renamePath(partial, path);
  return { path, sha256: createHash("sha256").update(text).digest("hex") };
}

/**
 * What the terminal's round did, said before the scan runs again:
 * how many of the questions put were answered, and that one left open switches nothing off. Until this change the line
 * read "The answers are written to ..." whatever happened, also over four skipped questions, which recorded no answer.
 */
export function answersWrittenLine(rows: readonly RecordRow[], profilePath: string, recordPath: string): string {
  const n = rows.length;
  const answered = rows.filter((r) => r.outcome === "answered").length;
  const files = `${profilePath} with its record ${recordPath}`;
  const again = "The scan runs again with the declaration:";
  if (answered === 0) return `No question answered (${n === 1 ? "1 left open" : `${n} left open`}), so nothing is switched off; ${n === 1 ? "it is" : "they are"} recorded as left open in ${files}. ${again}`;
  if (answered < n) return `${answered} of ${n} questions answered and ${n - answered} left open (one left open switches nothing off); the answers are written to ${files}. ${again}`;
  return `The answers are written to ${files}. ${again}`;
}

/**
 * The person's lines about the questions (proposal section 6, screen 4). `asking` is the
 * number put now; `notAsked` the questions no answer to which changes this scan.
 */
export function questionScreenLines(asking: number, notAsked: number, later = 0, added = 0, overCap = 0): string[] {
  const out: string[] = [];
  const today = asking - added;
  if (today > 0) {
    out.push(`Before step 2: ${today === 1 ? "1 question" : `${today} questions`} about your product. Each answer changes this review. Skip any: a skipped question switches nothing off.`);
  }
  if (added > 0) {
    // NV16: the
    // questions added before review. "more" only where today's questions come first.
    const n = added === 1 ? "1 question decides" : `${added} questions decide`;
    out.push(`${today > 0 ? n.replace(/^(\d+) /, "$1 more ") : n} what this scan reports. Answer now and this scan uses the answer; skip and it is listed in the report.`);
  }
  // The questions not asked before this scan, of every kind, in ONE line
  // with one command (three lines, each repeating the command, came before the dialog). Each kind keeps its own reason.
  const notNow = [
    ...(overCap > 0 ? [`${overCap} change${overCap === 1 ? "s" : ""} what it reports, past the ${ASKED_BEFORE_REVIEW_MAX} a scan asks`] : []),
    ...(later > 0 ? [`${later} settle${later === 1 ? "s" : ""} a premise of the review`] : []),
    ...(notAsked > 0 ? [`${notAsked} change${notAsked === 1 ? "s" : ""} nothing in this scan`] : []),
  ];
  const total = overCap + later + notAsked;
  if (total > 0) {
    out.push(`Not asked before this scan: ${total === 1 ? "1 more question" : `${total} more questions`} (${notNow.join("; ")}). The report lists ${total === 1 ? "it" : "them"}; answer any time and the next scan uses your answer: ${reviewDeclarationCommand()}`);
  }
  return out;
}
