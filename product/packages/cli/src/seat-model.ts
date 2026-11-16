/**
 * THE SEAT'S MODEL, PER RULE:
 * the rule names the model its place seats and answer seat read on, `sonnet` where it names none. The
 * packer never puts two models in one seat; the person's run-wide `--seat-model` overrides every rule's setting, and
 * the run names every rule read on a model other than its own setting, with its place count (review R18), so an
 * override is never silent.
 *
 * One module, so that the packer (scan.ts), the launch list (launch-plan.ts) and the line the person reads all take
 * the default and the rule's setting from the same place.
 */
import type { Rule, SeatModel } from "wolfboy-schemas";

export type { SeatModel };

/** Every model a rule may name (`rule.schema.json` `seat_model`). */
export const SEAT_MODELS: readonly SeatModel[] = ["sonnet", "opus"];

/**
 * The model of a rule that names none, and of every rule today: on present evidence no rule is set to `opus` (the
 * clarified wording took Sonnet's misses from 61 to 16 under the same reader, design section 1.6).
 */
export const DEFAULT_SEAT_MODEL: SeatModel = "sonnet";

/** The rule's own setting: its `seat_model` where it names one the schema allows, the default otherwise. */
export function seatModelOfRule(rule: Pick<Rule, "seat_model"> | null | undefined): SeatModel {
  const m = (rule as { seat_model?: unknown } | null | undefined)?.seat_model;
  return typeof m === "string" && (SEAT_MODELS as readonly string[]).includes(m) ? (m as SeatModel) : DEFAULT_SEAT_MODEL;
}

/** A map from rule id to the rule's own seat model, for every rule of a bundle. */
export function seatModelsOf(rules: readonly Pick<Rule, "id" | "seat_model">[]): Map<string, SeatModel> {
  return new Map(rules.map((r) => [r.id, seatModelOfRule(r)]));
}

/** One rule read on a model other than its own setting: the line the person reads names each (review R18). */
export interface ModelOverride {
  rule_id: string;
  /** The rule's own setting (`seat_model`, `sonnet` where absent). */
  own: SeatModel;
  /** The model the run reads it on. */
  read_on: string;
  /** How many places of this rule the run reads on that model. */
  places: number;
}

/**
 * Every rule whose places a run reads on a model other than the rule's own setting, sorted by rule id. `readOn` is the
 * run-wide override, or undefined where none was given (then every rule is read on its own model and the list is
 * empty). `placesByRule` counts the places of each rule the run reads.
 */
export function modelOverrides(
  placesByRule: ReadonlyMap<string, number>,
  ownModelOf: (ruleId: string) => SeatModel,
  readOn: string | undefined,
): ModelOverride[] {
  if (readOn === undefined) return [];
  const out: ModelOverride[] = [];
  for (const [rule_id, places] of placesByRule) {
    const own = ownModelOf(rule_id);
    if (own !== readOn) out.push({ rule_id, own, read_on: readOn, places });
  }
  return out.sort((a, b) => (a.rule_id < b.rule_id ? -1 : a.rule_id > b.rule_id ? 1 : 0));
}

/** The person's line for `modelOverrides`: one sentence naming every rule, or null where there is none. */
export function modelOverrideLine(overrides: readonly ModelOverride[]): string | null {
  if (overrides.length === 0) return null;
  const rules = overrides.map((o) => `${o.rule_id} (its own setting ${o.own}, ${o.places} place${o.places === 1 ? "" : "s"})`);
  return `Read on a model other than the rule's own setting, because --seat-model ${overrides[0].read_on} was given for the whole run: ${rules.join(", ")}.`;
}
