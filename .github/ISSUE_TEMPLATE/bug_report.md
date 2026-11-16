---
name: Bug report
about: The CLI or plugin crashes, misbehaves, or writes malformed output
title: "[bug] "
labels: ["bug"]
assignees: []
---

<!--
Before filing: a rule that fired on something harmless is NOT a bug — use "Rule target".
A rule that did not fire on something it should catch is NOT a bug — use "Rule miss".
A security problem is NOT a bug report — see SECURITY.md and report it privately.
Do not paste proprietary code or secrets. Redact paths and identifiers if you need to.
-->

## What happened

<!-- One or two sentences. What did you run, and what did you see? -->

## What you expected

## Minimal reproduction

<!-- The smallest thing that shows the problem. A synthetic file or two is ideal.
     If you cannot share the tree, describe its shape: languages, size, anything unusual. -->

```bash
# exact command(s), with the flags you used
```

## Output

<!-- Paste the console output and the relevant part of findings.json / SARIF / report, redacted. -->

```
```

## Environment

- WolfBoy version or commit:
- Bundle version (the `checks` line of `.legal/quick-scan.txt`):
- Node.js version:
- Operating system:
- Agent and model, if the problem is in layer 2:

## Checklist

- [ ] I searched existing issues for this problem.
- [ ] The snippet(s) above are synthetic or mine to share; nothing is copied from a repository I do not have the rights to.
- [ ] This is not a security problem (otherwise I will use private vulnerability reporting instead).
