/**
 * The two presentation lines every rule carries.
 *
 * `problem_line` is the title of a finding the review marks to fix: on the finding's card ("# F2 · <title>") and in every
 * list that names it. `fix_line` is the card's "What to do". Both are authored in rule.yaml and checked by the build
 * (tools/build-bundle.mjs calls `ruleLinesComplaints` below on every rule that carries them), which then moves them out
 * of the rule into the bundle's `rule-lines.json` (`bundle.ts` `RULE_LINES_FILE`). A rule's digest (`rests-on.ts`
 * `ruleHash`, which also leaves them out by name) is therefore never taken over them, and no review seat is handed them:
 * a wording change re-judges nothing.
 *
 * Nothing that decides a verdict imports this module (`bundle.ts` takes only the type, from itself), so it stays outside
 * the verdict-rules closure: a change here changes what the report shows, never how a verdict is reached.
 */
import type { RuleLines } from "./bundle.js";

/** The title's bound: the card's heading is "# F<n> · " and the title inside one raw line of 75 characters. */
export const PROBLEM_LINE_MAX = 60;
/** "What to do", one line on the card; the card writer wraps it at 75 columns. */
export const FIX_LINE_MAX = 120;
/** The facts a template may name, each filled by the program from its own facts at the decisive place. */
export const RULE_LINE_SLOTS = ["data", "recipient"] as const;
export type RuleLineSlot = (typeof RULE_LINE_SLOTS)[number];
/**
 * The length each slot is counted at when the build checks that a template leaves room for what fills it: 16 is
 * "e-mail addresses" and "passport numbers", the data phrases of the design's mocks. A fill longer than this can still
 * pass 60 at run time; `problemLineFor` then uses the line with no slot.
 */
export const SLOT_ROOM = 16;

/** Characters as a reader counts them (code points, not UTF-16 units). */
export const lineLength = (s: string): number => [...s].length;

const SLOT_RE = /\{([^{}]*)\}/g;

/** The slot names a template uses, in order, repeats kept. */
export function slotsOf(template: string): string[] {
  return [...template.matchAll(SLOT_RE)].map((m) => m[1] ?? "");
}

/**
 * Why a rule's lines cannot ship, one sentence each; empty when they can. The schema already holds the shape, the
 * bounds and the characters (rule.schema.json); this holds what a pattern cannot say: the slots and the room they need.
 */
export function ruleLinesComplaints(lines: { problem_line?: unknown; fix_line?: unknown }): string[] {
  const out: string[] = [];
  const has = (k: string): boolean => Object.hasOwn(lines, k);
  if (has("problem_line") !== has("fix_line")) {
    out.push("problem_line and fix_line come together: a rule carries both or neither");
  }
  const pl = lines.problem_line as { text?: unknown; template?: unknown } | undefined;
  const text = typeof pl?.text === "string" ? pl.text : null;
  const template = typeof pl?.template === "string" ? pl.template : null;
  const fix = typeof lines.fix_line === "string" ? lines.fix_line : null;
  if (has("problem_line") && text === null) out.push("problem_line has no text (the line with no slot)");
  if (has("fix_line") && fix === null) out.push("fix_line is not a line of text");
  for (const [name, s] of [["problem_line.text", text], ["problem_line.template", template], ["fix_line", fix]] as const) {
    if (s !== null && s !== s.trim()) out.push(`${name} begins or ends with a space`);
    if (s !== null && /\s{2}/.test(s)) out.push(`${name} has two spaces in a row`);
  }
  if (text !== null && lineLength(text) > PROBLEM_LINE_MAX) out.push(`problem_line.text is ${lineLength(text)} characters (at most ${PROBLEM_LINE_MAX})`);
  if (text !== null && /[{}]/.test(text)) out.push("problem_line.text has a brace: the line with no slot names no slot");
  if (fix !== null && lineLength(fix) > FIX_LINE_MAX) out.push(`fix_line is ${lineLength(fix)} characters (at most ${FIX_LINE_MAX})`);
  if (template !== null) {
    const slots = slotsOf(template);
    const unknown = slots.filter((s) => !(RULE_LINE_SLOTS as readonly string[]).includes(s));
    const stray = template.replace(SLOT_RE, "");
    if (slots.length === 0) out.push("problem_line.template names no slot; leave it out and keep the text alone");
    if (unknown.length > 0) out.push(`problem_line.template names ${unknown.map((s) => `{${s}}`).join(", ")}; the slots are {data} and {recipient}`);
    if (/[{}]/.test(stray)) out.push("problem_line.template has a brace outside a slot");
    if (new Set(slots).size !== slots.length) out.push("problem_line.template names a slot twice");
    const roomy = lineLength(stray) + slots.length * SLOT_ROOM;
    if (unknown.length === 0 && roomy > PROBLEM_LINE_MAX) {
      out.push(`problem_line.template leaves no room: its words and ${SLOT_ROOM} characters a slot come to ${roomy} (at most ${PROBLEM_LINE_MAX})`);
    }
  }
  return out;
}

/**
 * A finding's title from its rule's lines and the program's facts at the decisive place: the template filled where the
 * program has a fact for every slot it names and the filled line is at most 60 characters, else the line with no slot.
 * A template that opens with a slot gets a capital first letter. Null for a rule with no lines (the caller's fallback
 * is the rule's `short_name`).
 */
export function problemLineFor(
  lines: RuleLines | undefined,
  facts: Partial<Record<RuleLineSlot, string | null | undefined>>,
): string | null {
  if (!lines) return null;
  const template = lines.problem_line.template;
  if (template !== undefined) {
    const slots = slotsOf(template);
    const fill = (s: string): string => (facts[s as RuleLineSlot] ?? "").trim();
    if (slots.length > 0 && slots.every((s) => fill(s) !== "")) {
      const filled = template.replace(SLOT_RE, (_, s: string) => fill(s));
      const titled = template.startsWith("{") ? filled.charAt(0).toUpperCase() + filled.slice(1) : filled;
      if (lineLength(titled) <= PROBLEM_LINE_MAX) return titled;
    }
  }
  return lines.problem_line.text;
}
