---
name: Rule target
about: A rule fires on something that is not the thing it looks for
title: "[rule-target] <rule id>: matched <what it actually matched>"
labels: ["rule-target"]
assignees: []
---

<!--
Read this first, because it decides whether this template is the right one.

Layer 1 is deliberately over-inclusive. A candidate that turns out, on review, not to be a problem
in YOUR project — the tag IS gated by consent three files away; the field IS not personal data
here — is layer 2's job to dismiss, and it is not a defect in the rule. Please do not file those.

This template is for a different thing: the rule is WRONG ABOUT ITS TARGET. It matched text that
is not the construct it describes at all — a word inside an unrelated identifier, a hostname
fragment inside a different hostname, a comment the stripper should have removed, a pattern that
means something else in this language. The question is "is this the thing at all?", not "is this
probably a false positive?".

Do not paste proprietary code. A synthetic line that reproduces the match is enough.
-->

## Rule id

## What the rule says it looks for

<!-- Quote the rule's title or evidence template. -->

## What it actually matched

<!-- Quote the matched text (redacted / synthetic) and say what that text really is. -->

```
```

## Why this is not the rule's target

<!-- One or two sentences. e.g. "`symptom` matched inside the container image name
     `example-symptom-app/queue`; the rule is about health-data fields, not image names." -->

## Language, framework and file type

- Language:
- Framework:
- File extension:

## Synthetic line(s) that reproduce the match

```
```

## Checklist

- [ ] This is a target-correctness report (the rule matched something that is not its construct), not "this candidate was harmless in my project".
- [ ] The text above is synthetic or mine to share; no proprietary code, secrets or personal data.
- [ ] I understand the fix is expected to ADD a clause that recognises the real construct, not to remove the existing pattern, so that no genuine case is lost.
