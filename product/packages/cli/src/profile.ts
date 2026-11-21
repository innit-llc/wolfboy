/**
 * Reading a `--profile` file, and checking it against the schema that describes it.
 *
 * ## What changed on 2026-09-02, and what the schema used to say about itself
 *
 * `scan-profile.schema.json`'s root description carried this sentence from 2026-08-05:
 * *"NOTHING VALIDATES A PROFILE AGAINST THIS SCHEMA AT RUNTIME."* It was true and it was measured:
 * `scan.ts` and `reconcile.ts` each did `JSON.parse(readFileSync(path))` and cast the result to
 * `ScanProfile`, so every constraint in that file was a specification its producer was expected to
 * honour and not a check that noticed when one did not. The same description said turning validation
 * on was a behaviour change needing its own approval and its own independent check. Both were
 * obtained — approval, independent verification by an agent
 * that did not write this — and this file is that change.
 *
 * ## THE SHAPE, WHICH IS THE WHOLE OF THE DESIGN: REPORT LOUDLY, AND KEEP RUNNING
 *
 * **An invalid profile must never narrow a scan.** A profile is a declaration form, filled in by a
 * person or drafted by an agent, and the failure this repository has recorded twice is a scan made
 * quieter by an answer nobody checked: a rule switched off by a silence (2026-08-25) and a rule
 * switched off by an answer (2026-08-27), in both cases invisibly. Refusing to run on an invalid
 * profile would be a third form of the same thing — the tool says nothing about a tree it never
 * read — so nothing here refuses, and nothing here exits.
 *
 * What it does instead:
 *
 *  1. **Every violation is reported before anything else the command prints.** The block names the
 *     JSON path, what the schema wanted, what was found and how this run treated it.
 *  2. **Each violating FIELD is treated as unanswered**, and nothing else in the profile is touched.
 *     The field is replaced with `null`, which `engine.ts` `preconditionStatus` documents as the
 *     "I did not answer" value: the rule RUNS, and the open question is carried into the output
 *     beside whatever it found. **FIELD, not node**: where the violation is inside an array the
 *     validator names the ELEMENT, and the containing field is what goes — an array carrying a
 *     member the schema rejects is not a usable answer, and `[null]` is still an array that
 *     `includes` and `length` will read as one. **The direction is always a widening.** An
 *     unanswered precondition never suppresses, so a downgraded field can only add rules to a run,
 *     never remove one — which is what makes this safe to do to somebody's declaration without
 *     asking first.
 *  3. **The whole profile is discarded only when it is not an object of answers at all**, which is
 *     the W1 precedent for `declared_artifacts` generalised one level up: a file holding a list or a
 *     string answers nothing, so reading any part of it as an answer would be inventing one. A
 *     discarded profile is `null`, which is the state in which every precondition is unanswered and
 *     every rule runs.
 *
 * **THE INVERSION THIS EXISTS FOR.** `preconditionStatus` reads a truthy value as "yes". A person
 * who writes the string `"no"` into a boolean field has written something truthy, and before this
 * change that answer arrived at the engine as a yes. In the `a.b=val` form it is worse and it points
 * the other way: `String(v) !== expect` on any wrong-typed value is `unmet`, and an `unmet`
 * precondition is an answer that puts the rule out of scope — so a typo could label a rule's
 * candidates as contradicting a declaration the person never made. Both are closed by the same
 * downgrade: a value the schema rejects is not an answer in either direction.
 *
 * **The second half survived inside the first draft of this file and was found by the independent
 * check of 2026-09-02 (D1).** `distribution_regions: ["europe"]` had its ELEMENT nulled, the array
 * stayed, `distribution_regions=EU` read `[null]` as an answer of no, and the same run printed
 * "never read as an answer" and then "your ScanProfile … puts this rule out of scope". The array
 * rule in `downgradePathOf` is that repair, and it is the reason the word above is FIELD.
 *
 * ## ONE PROFILE, NOT TWO
 *
 * The downgraded profile is the only one any consumer sees — the rule preconditions, the scope
 * gates, the `declared_artifacts` reconciliation and the `profile` field of the written document.
 * Keeping the file's own bytes on a second path for "the record" was considered and rejected: two
 * profiles in one run are two things that can disagree, and the record is kept where it belongs
 * instead, in `profile_validation.violations[].found`, which carries the rejected value verbatim
 * beside the path it sat at. A reader of the output can therefore see both what the person wrote and
 * what the run read, without either of them being guessed from the other.
 *
 * `reconcile.ts` `readDeclared` keeps its own type check on top of this, and that is deliberate
 * rather than redundant: it is the only reader that can still be handed a raw profile object by a
 * caller that never went through this file, and its five `declared_absent_reason` values are a
 * published contract. Defence in depth on the one field family where a wrong answer is put back to
 * a person as a question.
 *
 * **`downgraded` is not the second profile that section rejects.** It is a map from path to the
 * value the downgrade replaced, and `violations[].found` is that same map rendered as text — one
 * fact, computed once, shown twice, so the two cannot drift. It exists for one reader:
 * `readDeclared` publishes a five-value contract in which `declared-artifacts-not-an-object` names
 * what the person wrote, and a bare `null` in its place makes that sentence read "nobody was asked".
 * A downgrade may widen what runs; it may not turn one silence into another. (Defect D2 of the
 * independent check of 2026-09-02, which measured exactly that sentence going out.)
 */

import { readFileSync } from "node:fs";
import { valueText } from "./printed-output.js";
import type { ProfileValidation, ProfileViolation, ScanProfile } from "wolfboy-schemas";
import { validateAgainstSchema, type SchemaViolation } from "./schema-validate.js";
import { readRegularFile } from "./project-read.js";

/** How much of a rejected value is quoted back. Long enough to recognise, short enough to read. */
const FOUND_MAX = 200;

/** A profile read from disk: what any consumer may read, the record of the check, and the block. */
export interface LoadedScanProfile {
  /**
   * The profile as every consumer sees it: valid fields unchanged, violating fields `null`, or
   * `null` outright where the file is not an object of answers.
   */
  profile: ScanProfile | null;
  validation: ProfileValidation;
  /** The loud block, ready to print. Empty when there is nothing to say. */
  report: string;
  /**
   * What the downgrade replaced, by JSON Pointer, in the form the file held it in.
   *
   * **Not a second profile, and not a second copy.** It is the SOURCE of
   * `validation.violations[].found`, which is this same fact rendered as text — the text is computed
   * from this map and never written beside it, so the two cannot disagree. It exists because one
   * reader has to quote a rejected value back to a person **in its own words**:
   * `reconcile.ts` `readDeclared` publishes a five-value contract in which
   * `declared-artifacts-not-an-object` names what the person actually wrote, and a plain `null` in
   * its place turns that sentence into "nobody was asked", which is untrue of their file. Nothing
   * else reads this, and it reaches no document.
   */
  downgraded: Map<string, unknown>;
}

/** The one sentence that states what a downgraded field means. Used in the block and in the record. */
function fieldTreatment(path: string): string {
  return (
    `treated as unanswered: the value at ${path} is replaced with null before any rule precondition, ` +
    `scope gate or declaration reconciliation reads it, so it can never switch a rule off and is ` +
    `never read as an answer`
  );
}

/**
 * THE ARRAY RULE, stated where it is applied and again in `downgradePathOf`'s table.
 *
 * A violation inside an array names the ELEMENT, and nulling the element leaves the array itself
 * present — so `preconditionStatus` walks the path, finds an array and evaluates `includes` or
 * `length` against it, and a field the schema rejected comes back as an ANSWER. Measured by the
 * independent check of 2026-09-02 (defect D1): `distribution_regions: ["europe"]` printed
 * "never read as an answer" and, eight lines later in the same run, "your ScanProfile answers
 * distribution_regions=EU in a way that puts this rule out of scope". That is the exact inversion
 * this whole file exists to close, surviving inside it.
 */
function arrayFieldTreatment(elementPath: string, fieldPath: string): string {
  return (
    `treated as unanswered: ${elementPath} is a member of the array at ${fieldPath}, and an array ` +
    `carrying a member the schema rejects is not a usable answer, so the WHOLE of ${fieldPath} is ` +
    `replaced with null before any rule precondition, scope gate or declaration reconciliation reads ` +
    `it — the field can never switch a rule off and is never read as an answer`
  );
}

/** The same sentence for the case where nothing in the file can be read as an answer. */
const WHOLE_PROFILE_TREATMENT =
  "treated as no profile at all: nothing in this file is read as an answer, so every applicability " +
  "precondition is unanswered and every rule runs";

/** A value as JSON, capped. `undefined` has no JSON form and is written as the word. */
function renderFound(value: unknown): string {
  if (value === undefined) return "(absent)";
  let text: string;
  try {
    text = JSON.stringify(value) ?? "(not representable as JSON)";
  } catch {
    return "(not representable as JSON)";
  }
  return text.length > FOUND_MAX ? `${text.slice(0, FOUND_MAX)}… (${text.length} characters in all)` : text;
}

/** One JSON Pointer segment, unescaped per RFC 6901. */
function unescapePointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** The value at a JSON Pointer, or `undefined` where the path does not lead anywhere. */
function valueAt(root: unknown, pointer: string): unknown {
  if (pointer === "") return root;
  let cur: unknown = root;
  for (const rawSegment of pointer.split("/").slice(1)) {
    const segment = unescapePointerSegment(rawSegment);
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[segment];
  }
  return cur;
}

/**
 * Replace the value at a JSON Pointer with `null`. Returns whether it reached the path.
 *
 * A miss is not an error and is not reported as one: two violations can name the same field, and a
 * parent downgraded by the first leaves the second with nothing to walk. The field is `null` either
 * way, which is the state both violations were asking for.
 */
function setNullAt(root: unknown, pointer: string): boolean {
  const segments = pointer.split("/").slice(1).map(unescapePointerSegment);
  if (segments.length === 0) return false;
  let cur: unknown = root;
  for (const segment of segments.slice(0, -1)) {
    if (cur === null || typeof cur !== "object") return false;
    cur = (cur as Record<string, unknown>)[segment];
  }
  if (cur === null || typeof cur !== "object") return false;
  (cur as Record<string, unknown>)[segments[segments.length - 1]] = null;
  return true;
}

/**
 * What the schema wanted, in one clause.
 *
 * The validator's own message is used wherever it is complete on its own — `must be boolean`,
 * `must match pattern "…"`, `must have required property 'x'` — and the two keywords whose message
 * names nothing get their parameter appended, because "must be equal to one of the allowed values"
 * on its own sends a reader to the schema to find out which.
 */
function expectedOf(error: SchemaViolation): string {
  if (error.keyword === "additionalProperties") {
    const key = String(error.params.additionalProperty ?? "");
    return `${error.message} — scan-profile.schema.json defines no property ${JSON.stringify(key)} at this path`;
  }
  if (error.keyword === "enum" && Array.isArray(error.params.allowedValues)) {
    return `${error.message}: ${JSON.stringify(error.params.allowedValues)}`;
  }
  if (error.keyword === "const" && "allowedValue" in error.params) {
    return `${error.message}: ${JSON.stringify(error.params.allowedValue)}`;
  }
  // `not`, `oneOf` and `anyOf` produce a message that names nothing at all — `must NOT be valid` is
  // the whole of what Ajv says about `distribution_regions`' rule that "unknown" may not sit beside
  // a country. The schema location is appended so a reader can go and read the constraint, and its
  // own `description` is where the reason is written.
  if (error.keyword === "not" || error.keyword === "oneOf" || error.keyword === "anyOf") {
    return `${error.message} — see the constraint at ${error.schemaPath} in scan-profile.schema.json`;
  }
  return error.message;
}

/** One JSON Pointer segment, escaped per RFC 6901. */
function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * The FIELD a pointer belongs to: the same pointer with every trailing array-index segment removed.
 *
 * Decided against the document rather than against the look of the segment. A segment that reads
 * `0` is an array index only if the thing holding it is an array, and JSON objects may carry
 * numeric-looking keys; testing the parent is exact where a `/^\d+$/` test would guess. The loop
 * handles an array inside an array, which this schema does not have today and may.
 */
function containingFieldPath(root: unknown, pointer: string): string {
  let segments = pointer.split("/").slice(1).map(unescapePointerSegment);
  while (segments.length > 0) {
    const parentPointer = segments.slice(0, -1);
    const parent = parentPointer.length === 0 ? root : valueAt(root, `/${parentPointer.map(escapePointerSegment).join("/")}`);
    if (!Array.isArray(parent)) break;
    segments = parentPointer;
  }
  return segments.length === 0 ? "" : `/${segments.map(escapePointerSegment).join("/")}`;
}

/**
 * The path whose value is downgraded for one violation, or `null` where there is nothing to
 * downgrade.
 *
 * Four cases, and each is decided by the keyword or by the document rather than by the look of the
 * value:
 *
 * - `required` — the field is ABSENT, which every reader already treats as unanswered. Downgrading
 *   the parent object here would delete answers the person did give, which is the one direction this
 *   file may never take.
 * - `additionalProperties` — the validator names the PARENT and puts the unknown key in its params,
 *   so the key is appended. Nulling the parent would throw away its valid siblings.
 * - **inside an array — the containing FIELD, never the element.** The validator names the element,
 *   and nulling an element leaves the array in place, where `preconditionStatus` reads it as an
 *   answer: `["europe"]` becomes `[null]`, `distribution_regions=EU` finds an array that does not
 *   contain "EU", and the person is told their own declaration put the rule out of scope. **An array
 *   carrying a member the schema rejects is not a usable answer**, so the whole field goes. This
 *   ADDS a confirming path rather than removing a loose one — a `null` array is unanswered in all
 *   three expression forms (`a`, `a=v`, `a[]`), so it can only widen. (Defect D1 of the independent
 *   check of 2026-09-02, which measured the inversion surviving inside the change that closes it.)
 * - everything else — the validator names the offending value itself.
 */
function downgradePathOf(error: SchemaViolation, parsed: unknown): string | null {
  if (error.keyword === "required") return null;
  let path: string;
  if (error.keyword === "additionalProperties") {
    const key = String(error.params.additionalProperty ?? "");
    if (key === "") return null;
    path = `${error.instancePath}/${escapePointerSegment(key)}`;
  } else {
    path = error.instancePath;
  }
  return containingFieldPath(parsed, path);
}

/**
 * The block a load site prints. Empty string when the profile was read with nothing to say.
 *
 * Three headings, one per state, because one heading covering all three would have to be vague about
 * the thing a reader most needs from it — whether the answers in that file were used. `DISCARDED`
 * and `NOT CHECKED` are opposite facts and were one sentence in the first draft of this function,
 * which said "used as written" over a profile the run had thrown away.
 */
function renderReport(profilePath: string, validation: ProfileValidation): string {
  const shownPath = valueText(profilePath);
  const lines: string[] = [];
  // `unavailable_reason` is a sentence and ends in a period of its own, so the closing bracket would
  // otherwise read `field by field.)` — one stop too many. Trimmed here rather than at the source,
  // because the reason is also written into a document where a full sentence is what a reader wants.
  const reason = validation.unavailable_reason.replace(/\.$/, "");
  if (validation.profile_treated_as === "discarded") {
    lines.push(
      `SCAN PROFILE DISCARDED — ${shownPath} is not an object of answers, so nothing in it is read as one ` +
        `(${reason}). The scan continues with no profile at all, which is the widest state ` +
        `there is: every applicability precondition is unanswered and every rule runs.`,
    );
  } else if (!validation.ran) {
    lines.push(
      `SCAN PROFILE NOT CHECKED — ${shownPath} was used as written because the schema check could not run ` +
        `(${reason}). This is not a pass: nothing here says the profile matches ` +
        `scan-profile.schema.json, and no field in it was downgraded.`,
    );
    if (validation.violations.length === 0) return lines.join("\n");
  } else if (validation.valid) {
    return "";
  } else {
    lines.push(
      `SCAN PROFILE VIOLATIONS — ${validation.violations.length} in ${shownPath}, checked against ` +
        `scan-profile.schema.json. The scan continues and nothing is narrowed: every violating field below is ` +
        `treated as unanswered, so the rules it names still run.`,
    );
  }
  // The path and the value are the profile's text (a pull request can
  // change the file): each control character written as an escape, so neither starts a line of its own.
  for (const v of validation.violations) {
    lines.push(`  ${valueText(v.path)}`);
    lines.push(`    the schema wants: ${v.expected}`);
    lines.push(`    what was found:   ${valueText(v.found)}`);
    lines.push(`    this run:         ${v.treated_as}`);
  }
  lines.push(
    "  Fix the profile, or confirm that the answer was meant as written and say so — this run has changed " +
      "nothing in the file.",
  );
  return lines.join("\n");
}

/** `value` without the field at `path` (a copy along the path; the value as it is where the path does not lead to it). */
function withoutField(value: unknown, path: readonly string[]): unknown {
  if (path.length === 0 || value === null || typeof value !== "object" || Array.isArray(value) || !(path[0] in value)) return value;
  const { [path[0]]: inner, ...rest } = value as Record<string, unknown>;
  return path.length === 1 ? rest : { ...value, [path[0]]: withoutField(inner, path.slice(1)) };
}

/**
 * Read `--profile`, check it, and hand back what every consumer may read.
 *
 * Synchronous, because `runScan` is synchronous and two gate tools consume it that way. See
 * `schema-validate.ts` for why that costs the degrade path nothing.
 *
 * `leaveOut`: dotted fields read as unanswered,
 * removed before anything else reads the profile (declaration.ts `staleOrderFields`: an answer recorded at an earlier
 * version of a question nothing asks before review). The scan and the pre-launch step pass the same list, so the
 * profile's digest they compare is the same.
 */
export function loadScanProfile(profilePath: string, leaveOut: readonly string[] = []): LoadedScanProfile {
  const record = (
    profile: ScanProfile | null,
    validation: ProfileValidation,
    replaced: Map<string, unknown> = new Map(),
  ): LoadedScanProfile => ({
    profile,
    validation,
    report: renderReport(profilePath, validation),
    downgraded: replaced,
  });
  /** What the downgrade replaced, by path, in the form the file held it in. See LoadedScanProfile. */
  const replaced = new Map<string, unknown>();

  /** Reading the file and parsing it are the two failures that used to end the whole run. */
  let parsed: unknown;
  try {
    parsed = JSON.parse(readRegularFile(profilePath, "utf8"));
    for (const field of leaveOut) parsed = withoutField(parsed, field.split("."));
  } catch (e) {
    return record(null, {
      ran: false,
      valid: false,
      unavailable_reason: `${profilePath} could not be read as JSON (${(e as Error).message}).`,
      profile_treated_as: "discarded",
      violations: [
        {
          path: "/",
          expected: "a JSON object of answers, in a file this process can read",
          found: "(the file could not be read as JSON)",
          treated_as: WHOLE_PROFILE_TREATMENT,
        },
      ],
    });
  }

  // Checked here rather than left to the validator, and checked FIRST, because it is the one
  // question that needs no validator at all: a machine with no ajv still refuses to read a list or
  // a string as a set of answers. It is also the only violation whose treatment is the whole
  // profile, so deciding it before the field walk keeps that walk free of a special case.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return record(null, {
      ran: false,
      valid: false,
      unavailable_reason:
        `${profilePath} is not a JSON object, so there was nothing to check it against ` +
        `scan-profile.schema.json field by field.`,
      profile_treated_as: "discarded",
      violations: [
        {
          path: "/",
          expected: "must be object — a ScanProfile is an object of answers",
          found: renderFound(parsed),
          treated_as: WHOLE_PROFILE_TREATMENT,
        },
      ],
    });
  }

  const checked = validateAgainstSchema("scan-profile.schema.json", parsed);
  if (!checked.ran) {
    return record(parsed as ScanProfile, {
      ran: false,
      valid: false,
      unavailable_reason: checked.unavailable_reason,
      profile_treated_as: "as-written",
      violations: [],
    });
  }
  if (checked.ok) {
    return record(parsed as ScanProfile, {
      ran: true,
      valid: true,
      unavailable_reason: "",
      profile_treated_as: "as-written",
      violations: [],
    });
  }

  // The downgrade runs over a copy, so a caller holding the parsed object is never mutated under it
  // and the `found` values below are read from the file's own values rather than from the result.
  const working = structuredClone(parsed) as Record<string, unknown>;
  const violations: ProfileViolation[] = [];
  let downgraded = false;
  for (const error of checked.errors) {
    const path = downgradePathOf(error, parsed);
    if (path === null) {
      // `required` names the parent and puts the missing key in its params, so the path written
      // here is the field the person has to add rather than the object it belongs to.
      const missing = String(error.params.missingProperty ?? "");
      violations.push({
        path: missing === "" ? error.instancePath || "/" : `${error.instancePath}/${missing}`,
        expected: expectedOf(error),
        found: "(absent)",
        treated_as:
          "nothing to downgrade: the field is not in the profile, and an absent field is already " +
          "unanswered — the rules it names run and carry the open question",
      });
      continue;
    }
    if (path === "") {
      // Unreachable while the non-object case above is decided first, and kept because a schema
      // change could add a root-level keyword that is not `type`. A root violation is the whole
      // profile, and the whole profile is the one thing that is discarded rather than downgraded.
      violations.push({
        path: "/",
        expected: expectedOf(error),
        found: renderFound(parsed),
        treated_as: WHOLE_PROFILE_TREATMENT,
      });
      return record(null, {
        ran: true,
        valid: false,
        unavailable_reason: "",
        profile_treated_as: "discarded",
        violations,
      });
    }
    // The violation is recorded at the node the VALIDATOR named — the element, where the violation
    // is inside an array — while what the run downgrades is the field that contains it. Reporting
    // the field alone would hide which member is unusable; downgrading the element alone is D1.
    const nodePath = error.keyword === "additionalProperties" ? `${error.instancePath}/${escapePointerSegment(String(error.params.additionalProperty ?? ""))}` : error.instancePath;
    const wholeField = path !== nodePath;
    violations.push({
      path: nodePath === "" ? "/" : nodePath,
      expected: expectedOf(error),
      found: renderFound(valueAt(parsed, nodePath)),
      treated_as: wholeField ? arrayFieldTreatment(nodePath, path) : fieldTreatment(path),
    });
    // Recorded before the write, and read from the untouched parse, so a field named by two
    // violations still reports the value the file held rather than the `null` the first one left.
    if (!replaced.has(path)) replaced.set(path, valueAt(parsed, path));
    if (setNullAt(working, path)) downgraded = true;
  }

  return record(working as unknown as ScanProfile, {
    ran: true,
    valid: false,
    unavailable_reason: "",
    profile_treated_as: downgraded ? "fields-downgraded" : "as-written",
    violations,
  }, replaced);
}
