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
  },
  {
    "agent": "5e6d8ab33c604e39237abcd06a64c66fd67d5241ee9f8a0d07bdbaa51984d91e",
    "skill": "e97f54cd0541c4c4ae0e0b86f54b30a383fc13d67cb83ed8bea0a973d95f5dec",
    "verdict_rules": "verdict-rules-36",
    "reading_spec": "44cebe3cbeaf8aafb7961a3301778c4752c21134b5c4110176468a7e19cb40df",
    "released": true
  },
  {
    "agent": "5e6d8ab33c604e39237abcd06a64c66fd67d5241ee9f8a0d07bdbaa51984d91e",
    "skill": "1bd01c5c89271626a960a033cdd1fe089ddda42b073b599a8fc088bf40b15272",
    "verdict_rules": "verdict-rules-37",
    "reading_spec": "f33df8d569765332667cf5bf9cbe2069b3d0c253c19e50da0f9c7d29e11d10fe",
    "released": true
  },
  {
    "agent": "5e6d8ab33c604e39237abcd06a64c66fd67d5241ee9f8a0d07bdbaa51984d91e",
    "skill": "5c8f1d1a8da57f350d810c39baf2886a776b80b9f6e2ec41c76a50da8b8f84df",
    "verdict_rules": "verdict-rules-38",
    "reading_spec": "4cfc96761b279b6a4102d86388d552c3a6a9f26f82a77912406ae69cfb86c699",
    "released": true
  }
];

export const JUDGING_MARKS: readonly JudgingMark[] = [
  {
    "changed": "all"
  },
  {
    "changed": "all"
  },
  {
    "changed": "all"
  }
];
