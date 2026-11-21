# Changelog

All notable changes are listed here, in the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. This
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Change types used: Added, Changed, Deprecated, Removed, Fixed, Security, Rules.

Each release is under FSL-1.1-ALv2 and becomes available under the Apache License 2.0 two years after it is
released; each release's entry below states that date.

## [Unreleased]

<!-- When this section becomes a release: "Released YYYY-MM-DD. Apache-2.0 from YYYY-MM-DD (two years later)." -->

## [0.1.1] - 2026-11-21

Released 2026-11-21. Apache-2.0 from 2028-11-21 (two years later).

### Added

- Each finding in report.md opens with the AI review's one-sentence account of what happens (or the check's title where
  none fits), its line of code, and what to do with the review's suggested fix. A new list shows the lines of code that
  several findings name; each finding is still counted.
- Eleven rules now say when the AI review may record a finding as not a problem, only where every place found meets it:
  code that does not ship (such as a sample or development secret), a person's copy of their own data, a shape the rule
  names as meeting the law's test by its nature, or a request the operator can already answer. Such findings are listed,
  not counted.
- The secrets check also finds a secret word at the start of a setting name, such as `SECRET_KEY_BASE`.

### Changed

- The first scan with 0.1.1 reviews every finding again, at the cost of a full review: the review's instructions and 36
  rules changed. A decision you recorded on such a rule's finding is shown as "the rule was updated", to look at again.
- The minors question decides more: a "No" settles the children's-data finding. The special-category question now asks
  whether the written condition covers every kind of that data you keep. A 0.1.0 minors answer is asked again where a
  finding turns on it. If you answered the special-category question with 0.1.0, the scan uses none of your saved
  answers (every region's rules run) until you answer it again: say "review my answers" in Claude Code, or run
  `npx wolfboy@0.1.1 scan --review-declaration`.
- The report pages read top to bottom: `laws.md` starts with the laws that apply to you, supporting detail is folded
  away, rule titles are plain, a law is named in full the first time WolfBoy itself names it on a page, and every date
  is your computer's own day. Open questions are counted once, apart from facts to check in your own documents.
- The sample app is now an EU product with an AI chat; its report also covers the AI Act and the Cyber Resilience Act.
- The licence files and GOVERNANCE.md name the publisher as INNIT LLC.

### Fixed

- In 0.1.0 as published, 14 rules lost the setting that limits them to what the product does when it runs, so their
  findings only in test, development or documentation files were counted, none hidden. Now they are listed, not counted.
- Every finding the front page counts is listed. When WolfBoy sends the AI review's answer back for a correction, the
  corrected answer can no longer make a finding lighter than the parts it was asked to correct (known issue 46 is the
  one way left). An answer settles only the findings its question decides.
- A US "No" shows as your answer; findings under laws that do not turn on personal data are no longer ranked as if they
  held the most sensitive data; a provision that applies later shows its date; a page lists its own searches apart.
- Known issues 4, 24, 26, 27, 29, 30 and 32 ([numbered as in 0.1.0][known-issues-0.1.0]) are fixed, and 25, 28, 31 and
  33 in part.

## [0.1.0] - 2026-11-16

Released 2026-11-16. Apache-2.0 from 2028-11-16 (two years later).

[Unreleased]: https://github.com/innit-llc/wolfboy/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/innit-llc/wolfboy/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/innit-llc/wolfboy/releases/tag/v0.1.0
[known-issues-0.1.0]: https://github.com/innit-llc/wolfboy/blob/v0.1.0/KNOWN-ISSUES.md
