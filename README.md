# WolfBoy

WolfBoy reads your code against the law (GDPR, the EU AI Act, CCPA) and against your own privacy policy, and shows
you where they disagree. For each place it quotes your code and names the article. Lawyers don't read code.
Engineers don't read law. WolfBoy reads both: first on your computer with no AI, then inside your own Claude Code.

```bash
npx wolfboy@0.1.0 scan
```

This first step is free and uses no AI. You need Node.js 20 or later. Run it in your project's folder. It reads that
folder on your computer, shows what it found on one screen, and writes the full list to `.legal/quick-scan.txt`. Then
it asks up to four questions about your product (where it is offered, what it ships as). You can choose Skip on any;
skipping switches nothing off. Nothing is sent anywhere. To have each place read and judged, install the plugin.

See what it reports on a small sample app with five planted problems: [examples/book-club](examples/book-club/), and
its [sample report](examples/book-club/sample-report/report.md). On that app the first step takes a few seconds. The
report lists 14 items to fix and took about 1.9 million tokens and 5 minutes of AI review. The first item:

```text
F1 · Password or key written to a log or console
Place: src/signup.ts:10 · console.log("new signup", { name, email, password });
Provision: GDPR Art. 5(1)(f) and Art. 32
```

## Track record

WolfBoy's review of [Loomio](https://github.com/loomio/loomio) 3.9.0, an open-source app for group decisions, pointed
at its sign-up step, which sent an MD5 hash of every new user's e-mail address to Gravatar, with no consent step. We
reported it. Loomio published [GHSA-55qv-f272-488r](https://github.com/loomio/loomio/security/advisories/GHSA-55qv-f272-488r)
and fixed it in Loomio 3.12.0.

## Why it matters

Fines on ordinary companies for what their software did with personal data. Each amount links to the official source.
As of November 2026.

| Country | Year | What the software did | Fine |
|---|---|---|---|
| US | 2023 | Fertility app sent health events to analytics and marketing SDKs, though its privacy policy promised not to (as alleged) | [$100,000](https://www.ftc.gov/legal-library/browse/cases-proceedings/202-3186-easy-healthcare-corporation-us-v) |
| France | 2025 | Retail chain sent about 10.5 million loyalty members' e-mails and phone numbers to a social network every week for ad targeting, without valid consent; the fine also covers password storage and cookies | [€3,500,000](https://www.legifrance.gouv.fr/cnil/id/CNILTEXT000053391342) |
| Poland | 2019 | "Withdraw consent" link showed a confirmation but withdrew nothing | [≈ €47,000](https://orzeczenia.uodo.gov.pl/document/urn:ndoc:gov:pl:uodo:2019:zspr_421_7) |
| US (California) | 2025 | Privacy-request form demanded a photo of the person holding an ID document, even to opt out, and the opt-out banner disappeared at once for 40 days (as alleged) | [$345,178](https://www.cppa.ca.gov/pdf/20250501_snyder_order.pdf) |
| Denmark | 2023 | Booking and other systems kept ~500,000 customer profiles past the company's own deletion deadlines | [≈ €134,000](https://www.datatilsynet.dk/presse-og-nyheder/nyhedsarkiv/2023/sep/landsretten-giver-boede-paa-1-mio-kr-til-hotelkaede) |
| France | 2024 | Browser extension added to its database contact details that LinkedIn users had limited to their own connections | [€240,000](https://www.legifrance.gouv.fr/cnil/id/CNILTEXT000050791828) |
| Sweden | 2024 | Online pharmacy's ad pixel sent shoppers' names, e-mails and phone numbers (hashed) with their purchases for over a year, through a feature the company never meant to enable | [≈ €700,000](https://www.imy.se/globalassets/dokument/beslut/2024/beslut-tillsyn-apohem.pdf), under appeal |

## The full review, in Claude Code

```bash
claude plugin marketplace add innit-llc/wolfboy
claude plugin install wolfboy@wolfboy --scope local
```

Run both in the project you want to check. `--scope local` loads the plugin only there. You need Claude Code 2.1.314
or later, Node.js 20 or later and git; on Windows, Git for Windows (Claude Code runs the plugin's hooks in Git Bash).
The tests run on Linux, macOS and Windows; a full scan with the AI review has been run on Linux and WSL. To remove
the plugin later, see [Update and remove](product/plugin/README.md#update-and-remove).

Say **"Scan this repository."** in Claude Code. WolfBoy then:

1. prints the command that starts the scan's own session. Run it in your terminal, in the same folder, and ask again
   there. (The first time it also offers `npm install -g wolfboy@0.1.0`; after that the command is `wolfboy session`.)
2. asks up to four questions about your product (where it is offered, who uses it).
3. shows what it found and what the AI review will cost. On a project's first scan it waits for your go.
4. writes the report to `.legal/reports/`: what to fix first, your code quoted, the article cited.

After that, in the same conversation, you can say "explain F1", "fix F1", or "F3 is not a problem because ...".
To have your privacy policy read against your code, say "compare my privacy policy".

## Cost

Finding the places is free and runs on your computer. The AI review uses your own Claude plan or API key. Before it
starts, the scan shows what it will review and the estimated cost (on an API key, in money too): 1.6 to 19 million
tokens for an 86-file app, 55 to 330 million for a 2,655-file one. A later scan on the same computer reviews again
what changed since the last one, and everything when your answers changed or a package was added or removed:
[the list](HOW-IT-WORKS.md#later-scans).

## What leaves your computer

- Nothing reaches us: there is no WolfBoy server. The AI review sends the files its agents open, and the lines their
  searches return, to your model provider (Anthropic, under your plan's terms), like any Claude Code session.
- WolfBoy masks the credential values its secret rule recognises in the excerpts it hands the review (the provider's
  prefix and the length stay). A value it does not recognise is sent as it is, and so is a file an agent opens itself.
- The plugin stops the AI's file tools from changing WolfBoy's own records. It does not stop a shell command the AI
  runs: [details](product/plugin/README.md#what-the-plugin-adds-to-claude-code).
- The command-line scanner has no telemetry, no usage ping and no update check:
  [the addresses it can open](HOW-IT-WORKS.md#what-it-sends-where).

## What it reads

EU and US law come first. The rules cite the GDPR, the ePrivacy Directive, CCPA / CPRA, the AI Act, FTC Act §5, the
Cyber Resilience Act, US state AI statutes (UT, NY, CA, NV, IL, TN), the Digital Services Act, the Data Act and the
European Accessibility Act: [the table](HOW-IT-WORKS.md#what-it-reads-your-code-against) counts the rules for each.

Every rule reads every text file, whatever its language. Some also read the structure of HTML, TypeScript and TSX,
Elixir, and the ERB, HAML, Slim, Pug, Blade and HEEx templates. The package inventory reads npm, SwiftPM and CocoaPods
manifests. By default a scan does not read tests, vendored code or build output; it prints what it held back, and
`--read all` reads everything.

## What is in this repository

| Folder | What it holds |
|---|---|
| [`product/packages/cli/`](product/packages/cli/) | The command-line scanner, published to npm as `wolfboy` |
| [`product/plugin/`](product/plugin/) | The Claude Code plugin (skills, review agents and hooks), shipped in the same npm package at the same version |
| [`rules/`](rules/) | The law rules as YAML: 120 rules in 27 packs and 18 statutory checklists. Each rule carries its legal basis, its citation and the date it was checked |
| [`tools/`](tools/) | The script that builds the rule bundle from `rules/`: [build from source](HOW-IT-WORKS.md#build-from-source-and-try-it) |
| [`examples/book-club/`](examples/book-club/) | The sample app and WolfBoy's report on it |

Everything the scanner runs is in this repository. The rule files are generated from a private source, which also
holds research notes and test fixtures, so a rule change starts as an issue.

## Questions

<details><summary>Can I use this at work?</summary>

Yes. You can scan your company's code, run it in CI, change it, and use it for your clients. What is not allowed is
making WolfBoy, or something built from it, available to others in a commercial product or service that substitutes
for it or offers the same or substantially similar functionality (the licence's "Competing Use").
</details>
<details><summary>Does it tell me whether my code breaks the law?</summary>

No. It reports what your code does beside what the law and your own policy say. It never calls a project unlawful or
in order: [what it does not do](HOW-IT-WORKS.md#what-it-does-not-do).
</details>
<details><summary>Can it run in CI?</summary>

The rules check can, on every pull request, with no AI and no key: `npx --yes wolfboy@0.1.0 scan --target .` It counts
the places on the lines a pull request changes and posts one neutral check run: [more](HOW-IT-WORKS.md#in-ci).
The AI review does not run in CI in this release.
</details>
<details><summary>What does it miss or get wrong?</summary>

[Known issues](KNOWN-ISSUES.md) lists the known problems in this version. Every report also says what it did not
check: [the sample's](examples/book-club/sample-report/report.md#not-checked).
</details>

## Status and contributing

Version 0.1.0 was released on 2026-11-16. INNIT Inc. publishes WolfBoy, and it has one maintainer today, who reads
every issue; there is no fixed reply time. Not in this release: the AI review in CI, a mode in which the CLI calls a
model API with your own key, and signed rule bundles ([Status](HOW-IT-WORKS.md#status)).

The most useful contribution is a report of code a rule should have caught and did not: open an issue with the Rule
miss template. Pull requests are merged once the project's Contributor License Agreement is published; until then,
please open an issue. Questions go in an issue too. Report a security problem privately, as
[SECURITY.md](SECURITY.md) describes.

## More

[How it works](HOW-IT-WORKS.md) · [The plugin](product/plugin/README.md) · [Security](SECURITY.md) ·
[Support](SUPPORT.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Known issues](KNOWN-ISSUES.md)

FSL-1.1-ALv2 ([LICENSE](LICENSE)): use it for anything but a competing product. Each version is also available under
the Apache License 2.0 two years after its release.

WolfBoy is not legal advice. It points at places to review; consult qualified counsel before acting on its output.
