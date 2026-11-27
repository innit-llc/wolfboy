# Changelog

All notable changes are listed here, in the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. This
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Change types used: Added, Changed, Deprecated, Removed, Fixed, Security, Rules.

Each release is under FSL-1.1-ALv2 and becomes available under the Apache License 2.0 two years after it is
released; each release's entry below states that date.

## [Unreleased]

<!-- When this section becomes a release: "Released YYYY-MM-DD. Apache-2.0 from YYYY-MM-DD (two years later)." -->

## [0.1.3] - 2026-11-27

Released 2026-11-27. Apache-2.0 from 2028-11-27 (two years later).

### Fixed

- The first screen and the list put what is in code first. In 0.1.1 the prohibited-practice row always came first,
  whatever it held, and records and their places were listed by rule and by file name, so documentation pages, CI
  files and copied libraries could lead the list. Now each place is ranked by where it sits and whether it matched code
  or only a word, a record is named by its best place, every record with a place in the product's code comes before
  the rest across all areas, and the prohibited-practice row is ordered like any other. A row with nothing in code says
  where its places are (for example "all words only, in example data or templates"). Prose, data files, translation
  catalogues and CI files are listed last.
- Vendored code is recognised by what the file carries (another project's banner, a bundler's wrapper, a source-map
  trailer) as well as by its folder, and each such file is named with its sign; a minified or bundled file is
  recognised by its name (`jquery.min.js`, `editor.bundle.js`). In 0.1.1 only the folder's name counted (`vendor`,
  `third_party` and the like), so a library copied into another folder was read, and the report said nothing had been
  held back.
- `scan ./my-app` scans `./my-app`, as `scan --target ./my-app` does. In 0.1.1 a folder given this way was ignored: the
  scan read the current folder and could say "0 places". A folder given together with `--target`, or more than one, is
  refused.
- A target that does not exist, or is not a folder, stops the scan with one line and a non-zero exit code, so a
  mistyped path in CI no longer passes. A folder with no files to read says so.
- With a folder named after `scan` or with `--target` and no `--out`, the answers to the questions about your product
  are kept in that folder's `.legal/`, not in the folder the command was typed in. In a terminal, such a scan with no
  `--out` now also writes its files there and shows the first screen, naming each file by its full path; in CI or a
  pipe it still writes nothing.
- In a terminal, a scan with no `--out` that cannot write its folder's `.legal/` (a read-only checkout or mount) shows
  the first screen, then names the folder it could not write and says to choose another with `--out <file>`, and exits
  with code 1. In 0.1.1, `scan` typed in such a folder ended in an error trace.
- `.legal/quick-scan.txt` shows at most ten records in each area. Where it stops, it now names the file that holds every
  place, and so does the screen.
- In a terminal, after the questions, the scan runs again only when an answer changed what it uses; otherwise it says
  nothing changed.
- The screen says how many questions about your product are still open, and how to skip them.
- During the AI review, a step that read WolfBoy's own run files while another step was replacing them could stop and
  ask for the command to be run again.
- With the second check, a finding that the AI review ruled out and the second check confirmed could be shown as
  waiting for you: WolfBoy's own check of the review's log called the confirmation malformed.

### Changed

- 0.1.3 reads less by default. Documentation sites and vendored code are not read unless `--read docs` or
  `--read vendored` is given, and the first screen says how many files were not read and how to read them. A folder
  named like a documentation site (`docs`, `website` and the like) is read only where the product uses it: code
  outside it imports it, another workspace member depends on it, or a package names it as its entry point. It is never
  read where it, or a folder directly inside it, shows a site generator's configuration. A documentation site built as
  an application is held back, and the coverage block names it. A folder holding neither prose nor program source
  (images, for example) is read. The AI review still reads every candidate the scan finds.
- Every place in findings.json carries `path_class`: `code`, `config` (with ignore lists and lock files),
  `example-data`, `template` (a template shipped for users to start from; a product's own page under a folder such as
  `project-templates/` is `code`), `translation`, `ci`, `prose` (README, CHANGELOG and other prose files), `asset`
  (plain-text word lists and vocabularies, images), and `test`, `build`, `docs` or `vendored` in a scan that reads
  them (`--read tests`, `--read build`, `--read docs`, `--read vendored`).
- Rules that match a word in data or templates mark those places as the word tier (`tier: "word"` in findings.json),
  beside a clause that recognises the construct in code. The word tier also follows the readings a rule declares (an
  import alias, a value bound a line or two earlier), so an affect model loaded through an aliased import is shown as
  code. Word-tier places are still candidates, and the AI review reads them.
- The usage-report rule (`recipients-013`) also marks a send whose address is held in a local or constant a few lines
  earlier, an address whose host starts with a channel label such as `stats.`, `metrics.` or `collect.`, and a switch
  whose shipped default is written where it is read (`env.bool("SEND_X", True)`, `ENV.fetch("SEND_X", "true")`,
  `process.env.SEND_X ?? 'true'`). An address bound to a name and never sent is in the word tier.
- The first scan with 0.1.3 after 0.1.1 reviews every finding again, once, at the cost of a full review: rules changed,
  and so did the checks WolfBoy runs on the review's answers and what the AI review is shown about the project (which
  files are read, and how each place is classed), so each verdict recorded by 0.1.1 is judged once more.
- A command that takes no folder or other word after its name, such as `doctor`, now refuses one, with exit code 1
  (0.1.1 ignored it).
- In Claude Code with the plugin, `scan` given another folder and no `--out` is refused, with exit code 1: its questions
  about your product would be kept in that folder's `.legal/`, where the plugin does not read them.
- The README gives the review's cost in US dollars at list prices beside its token figures, says what those figures
  count, shows how to get and scan the sample app, and gives `npx.cmd` for Windows PowerShell. The sample's README says
  how its report was made. The npm page shows the same README as GitHub.

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

[Unreleased]: https://github.com/innit-llc/wolfboy/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/innit-llc/wolfboy/compare/v0.1.1...v0.1.3
[0.1.1]: https://github.com/innit-llc/wolfboy/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/innit-llc/wolfboy/releases/tag/v0.1.0
[known-issues-0.1.0]: https://github.com/innit-llc/wolfboy/blob/v0.1.0/KNOWN-ISSUES.md
