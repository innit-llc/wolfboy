# Contributing to WolfBoy

Thank you for considering a contribution. This document explains what is accepted, how, and the
few rules that exist because a specific failure happened. Please read [SUPPORT.md](SUPPORT.md) for
what to expect.

## 1. What is wanted most

In order of value to the project:

1. **A construct a detector missed** (a "rule miss"): a way of writing something a rule targets
   that the rule does not fire on — in a language, framework or idiom it should reach. Use the
   **Rule miss** issue template. This is the single most valuable contribution, because layer 1 is
   grown by reach, and reach is grown by seeing more ways of writing the same thing.
2. **A rule firing on something that is not the thing it looks for** (a "rule target" report):
   for example a rule for a medical-data field matching inside an unrelated identifier. Use the
   **Rule target** issue template. Note what this is not: it is not "this candidate turned out to be
   fine in my project". Layer 1 is deliberately over-inclusive and layer 2 exists to dismiss
   candidates.
3. **A legal correction**: a citation that is outdated, superseded, misquoted or misread. Include
   the primary source (the official journal or the statute's own publisher), not a secondary
   summary.
4. **Engine, CLI, schema and language-support changes**: changes are welcome as issues; see section 2.
5. **Documentation** that would have saved you time.

## 2. Contributor License Agreement

Pull requests are merged once the project's Contributor License Agreement is published; until then, please open an
issue.

## 3. Rules and vocabulary: how a change is proposed

**The rule and vocabulary files in this repository are a generated form, not the source of record.**
The sources are maintained privately, together with the annotated test fixtures and the record of
which real repositories each rule was developed against. The public form is regenerated from those
sources with authoring comments and provenance stripped. This has three consequences for
contributors, and it is better to say them plainly than to let you find out at review:

1. The public rule files are generated from a private source, so a pull request cannot change them directly;
   **describe the change in an issue.** A change taken from an issue is credited in the changelog.
2. **Use the Rule miss and Rule target templates.** They ask for what a rule change needs: the construct's shape, the
   language and framework, and a synthetic snippet.
3. **Fixtures are not published.** Every rule is checked privately against annotated samples that
   must fire (`bad-`) and must stay silent (`ok-`). You cannot run those checks here. So a rule
   proposal should include a **minimal synthetic example**: the smallest
   self-contained snippet that shows the construct, written by you for this purpose, in the
   language and framework where you met it. The maintainer turns it into a fixture on the private
   side.

**Never paste code from a repository you do not own the rights to, and never paste your employer's
proprietary code.** Describe the construct and write a synthetic example. A snippet copied from a
real repository cannot be used as a fixture, because the project cannot use code it has no rights to.

**Every rule carries its legal basis.** A proposal to add or change a rule must name the provision
(instrument, article, paragraph), quote it from the primary source, and give the URL and the date
you checked it. A rule whose grounding cannot be traced does not ship. Rule prose must never assert
that anything is lawful or unlawful — rules describe what a detector looks for and what a reviewer
must check; the bundle build rejects verdict language and instruction-shaped phrasing in rule text.

**Vocabulary entries about named third-party vendors** (who receives what data, where a vendor is
established) are factual claims about real companies. A proposal to add or change one must cite
the vendor's own published document (privacy policy, data processing agreement, developer terms)
with URL and date, and must say whether the entry is a **verified fact** or a **hypothesis for the
adjudicator to check**.

## 4. The dependency rule

**Every new dependency needs a recorded reason.** This tool runs with read access to your users'
entire source trees, so every package it pulls in is part of the trust they extend to it. The
runtime dependency count is deliberately small and is kept that way on purpose, not by accident.

A pull request that adds a dependency says in its description what it does and why it is needed.

Third-party components bundled with a release (today: tree-sitter grammars) are listed with their
SPDX identifier, copyright notice, licence text and SHA-256 digest, and the build verifies them.
Adding one means extending that record, not only the code.

## 5. Pull requests

- One change per pull request. A refactor and a behaviour change are two pull requests.
- Fill in the pull request template. Its checkboxes are the review checklist.
- Tests: a behaviour change comes with a test that fails without it.
- **The author of a change does not approve it.** A change is checked by an AI agent that did not
  write it; the maintainer decides what is merged. Your own
  confidence in a change is not evidence for it; a test is.
- Pull requests may sit for a while. See [SUPPORT.md](SUPPORT.md) for what to expect.

## 6. Commit messages and language

- **English only**, in commit messages, code, comments, identifiers, documentation, rule prose
  fields and CLI strings.
- Non-Latin scripts (for example Chinese, Japanese or Korean characters) are permitted in exactly
  three places: the original-language name of a law inside a rule's legal-basis citation, a
  statute's own words quoted in a penalty table's `penalty_quotes[].quote` with its official source,
  and a detector pattern that targets non-English content in scanned code. The bundle build enforces this
  field by field for Chinese, Japanese and Korean characters; a violation fails the build.
- Commit subject: imperative mood, under 72 characters, saying what changed and why in one line
  (`Read Blade templates through the structural reader so ERB-style guards are not missed`). Body:
  what was tried, what was skipped, what failed, if anything.
- No emoji in commit messages, code or documentation.

## 7. Code of conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). Reports go to the maintainer privately,
through GitHub's private vulnerability reporting (**Report a vulnerability** on the repository's **Security** tab, as
[SECURITY.md](SECURITY.md) describes), which takes conduct reports too.
