/**
 * Written by the judging-marks gate (its `--pin`); edit only `changed` and `record` by hand.
 *
 * THE MARKS A RELEASE MAKES ON WHOSE JUDGING CHANGED.
 * `JUDGING_STATES` lists the review instructions of every release in order (the adjudicator's agent text and the
 * legal-scan skill by digest, the verdict rules' version, and a place's reading spec by digest), the last one the
 * instructions this source judges by. `JUDGING_MARKS[i]` says, for the step from state i to state i + 1, whose judging
 * changed: every rule (`"all"`, the default the gate writes), or the rule ids listed, with the record that justifies
 * the list. A verdict judged under an earlier released state carries only where no step between it and today marks its
 * rule (`instructions.ts` `judgedAsThroughMarks`). Only the last state may be unreleased; the gate refuses any change to
 * the instructions that is not pinned here, so a release cannot forget its mark.
 */
export interface InstructionsState {
  agent: string;
  skill: string;
  verdict_rules: string;
  reading_spec: string;
  released: boolean;
}

export interface JudgingMark {
  changed: "all" | readonly string[];
  /** The record that justifies a list of rules; required for a list, absent for "all". */
  record?: string;
}

export const JUDGING_STATES: readonly InstructionsState[] = [
  {
    "agent": "deee981c86addc4ea2ff691db274eeefa72108ed40ccadf2f5f54fd314eafa03",
    "skill": "411f0f305f7ccf1efae289c654a57d5ddfcd816e136bfb2d13eb907316202af9",
    "verdict_rules": "verdict-rules-35",
    "reading_spec": "3bbecc12f6e071ce39dde22f324182e7e6663942939b323b48dbf7b909eb0442",
    "released": true
  }
];

export const JUDGING_MARKS: readonly JudgingMark[] = [];
