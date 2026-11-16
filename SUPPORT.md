# Support

## Where to ask

| I want to... | Go to |
|---|---|
| ask how something works, share how you use it, propose an idea | an issue (a blank one is fine) |
| report that the CLI crashes, misbehaves or produces malformed output | an issue with the **Bug report** template |
| report that a detector did not fire on a construct it should catch | an issue with the **Rule miss** template |
| report that a rule fires on something that is not the thing it looks for | an issue with the **Rule target** template |
| report a security problem | **not** an issue — see [SECURITY.md](SECURITY.md) |

There is no chat server, no mailing list and no support email.

## What is supported

- The CLI (`scan`, `reconcile`, `reconcile-annotate`, `reconcile-verify`, `reconcile-diff`,
  `questionnaire`, `ropa`, `doctor`) at the current release, on Node.js
  20 or later (findings were identical on Node 18, 20, 22, 24 and 26 on 2026-11-10). The tests run on
  Linux, macOS and Windows; a full scan with the AI review has been run on Linux and WSL.
- The rule bundle that ships with that release.
- The agent plugin's skills and agent definitions as published in this repository.
- The output formats: `findings.json`, SARIF 2.1.0, the reconciliation report, the questionnaire
  export and the Article 30 record files.

## What is not supported, and why

- **The behaviour of the LLM your agent uses.** Layer 2 runs inside your own agent, on your own
  model, under your own account. Whether a given model reads a candidate well, how long it takes,
  whether it follows the skill's instructions, and **what it costs** are properties of your
  provider and your plan. The project has no visibility into your runs and cannot reproduce them.
  If a skill instruction is ambiguous or wrong, that is a bug here — please report it with the
  prompt and the model's response — but "the model did something odd" on its own is not something
  this project can fix.
- **Model cost.** You pay your provider directly. Before the AI review of a project's first scan, the plugin
  shows its estimate of the time and the tokens (on an API key, in money too) and asks whether to start; a later
  scan starts without asking and shows its estimate. It is an estimate, and the project cannot refund, cap or
  predict your provider's billing.
- **Legal interpretation.** WolfBoy does not tell you whether you are in breach of a law; that is a question for
  qualified counsel.
- **Interpretation of an `unknown`.** A rule that produced nothing is reported as `unknown`, with
  what it was looking for. That is deliberate, and "how do I make the unknowns go away" is not a
  supported request; "this rule should have found X in my tree" is, through the Rule miss
  template.
- **Forks, modified bundles and rules you wrote yourself**, beyond pointing at the schema.
- **Unreleased commits on `main`** — welcome to try them, but they may break.

## Response expectations

Issues are read by the maintainer. There is no fixed reply time.

## If this project stops

The design keeps you able to continue without us:

- **Layer 1 runs entirely on your machine with no service dependency.** There is no WolfBoy server, so nothing stops
  working if this project stops.
- **The rules are readable YAML with their legal basis, citation and verification date on each
  rule.** You can read them, run them, and change them.
- **The layer-2 prompts are Markdown in this repository.** Everything the scanner runs is in this repository; the
  private source adds research notes and fixtures.
- **The licence**, FSL-1.1-ALv2 (see [LICENSE](LICENSE)), lets you use, modify and redistribute
  what is published here for any purpose other than a competing product or service, and each
  version becomes available under the Apache License 2.0 two years after it is published.
- **Rule dates matter.** Every legal citation carries the date it was last checked. Law changes;
  a bundle that is no longer maintained will drift from the law, and the dates let you see how
  far.

## Commercial support

There is no paid support.
