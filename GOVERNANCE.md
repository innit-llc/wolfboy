# Governance

## Who maintains this

WolfBoy is published by INNIT LLC and has one maintainer today, takukanaya.

## Two standing principles

- **The author of a change never rules on it.** Every new or changed rule is checked, for legal
  accuracy and on real repositories, by an AI agent that did not write it.
- **The absence of a finding is `unknown`, never a clearance.** No change may make the product
  report that a project is lawful, passes, or has nothing to report. See [HOW-IT-WORKS.md](HOW-IT-WORKS.md).

## What "verified" means for a rule

Rules climb a ladder, and the word for each rung is earned, not assigned. A rule below the top
rung is described as "partially verified" **with its rungs named**; using the bare word "verified"
for anything less is treated as a reporting defect in this project.

1. **draft** — the rule exists; nothing is proven, including everything its author is confident
   about.
2. **fixtures-pass** — the rule passes static checks (schema, field-scoped language lint, rejection
   of verdict language and instruction-shaped phrasing) and fires on every annotated sample it must
   catch while staying silent on every sample it must not.
3. **mutation-hardened** — the rule still fires after each sample has been deliberately perturbed
   (renamed, reflowed, restructured) several ways, and a deliberately wrong implementation of each
   condition the change introduces has been built and watched failing.
4. **verified** — all of the above, **plus** a reach record (the rule has been run on real
   repositories and its matched lines read to confirm it is looking for the right thing), **plus**
   independent adversarial review by an AI agent that did not write it.
5. **shipped** — verified, and included in a release.

A precision measurement is **not** on this ladder. One is taken only for the scope of a specific
numeric claim, when the project decides to publish a number or an external party asks for one; it is
then pre-registered, measured on repositories never used for tuning, and reported with intervals,
scoped to that claim alone. This repository publishes no such number today.

## Changing this document

Proposals to change this document are welcome as issues.
