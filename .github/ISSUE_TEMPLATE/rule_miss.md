---
name: Rule miss
about: A detector did not fire on a construct it is meant to catch
title: "[rule-miss] <rule id or topic>: <construct in a few words>"
labels: ["rule-miss", "reach"]
assignees: []
---

<!--
This is the most valuable report this project receives. Layer 1 is grown by reach — by seeing
more ways of writing the same thing — and a construct it does not yet recognise is exactly that.

DO NOT paste code from a repository you do not have the rights to, and do not paste your
employer's proprietary code. Describe the construct and write a small synthetic example instead.
A copied snippet cannot be used as a test sample.
-->

## Which rule (or which topic, if you are not sure of the id)

<!-- e.g. eu-consent-001, or "analytics tag loaded before consent" -->

## The construct that was not detected

<!-- Describe the shape in words: what the code does, how it is written, what the rule's own
     title says it targets. -->

## Language, framework and file type

- Language:
- Framework / library / template engine:
- File extension(s):
- Anything unusual about how it is written (generated code, macro, DSL, config format, multi-line construct):

## Synthetic snippet

<!-- The smallest self-contained example, written by you for this issue, that the rule should
     fire on. Say which line(s) you expect to be reported. -->

```
```

## What the scan reported instead

<!-- Was the rule listed under rules that produced no candidates? Every rule runs; a profile answer
     never switches one off. Paste the roster row if you can — `files_on_surface` (0 means the rule
     was offered no file in your tree) and `matches_removed_by_corroboration` matter most. -->

## Optional: how you found it

<!-- e.g. layer 2's silence investigation located it; a manual review; another tool. -->

## Checklist

- [ ] The snippet is synthetic or mine to share.
- [ ] I have not pasted any secret, credential or personal data.
- [ ] I understand that the public rule files are generated from a private source, so a pull request cannot change them directly.
