# How WolfBoy works

WolfBoy checks what your code actually does against the law (GDPR, the AI Act, CCPA) and against your own privacy
policy, terms and store declarations: lawyers read contracts and policies, not code, and security scanners read code,
not law. Layer 1 runs on your machine with no model; layer 2 is your own agent judging each
place. Install and everyday use: [README.md](README.md).

## Build from source and try it

Build from a checkout with Node.js 20 or later and pnpm (findings were identical on Node 18, 20, 22, 24 and 26 on
2026-11-10; the tests run on Node 22, and Node 20 is past its end of life, so use 22 or later where you can), then
point `--target` at your own project:

```bash
(cd product && pnpm install && pnpm -r build)    # the CLI → product/packages/cli/dist       (10 s)
npm install && node tools/build-bundle.mjs       # the rule bundle → dist/bundle, with the CLI (1-2 min)

node product/packages/cli/dist/index.js scan --bundle dist/bundle --target path/to/your/project \
    --out path/to/your/project/.legal/findings.json --sarif path/to/your/project/.legal/findings.sarif
```

Give `--out` and `--sarif` inside the project you scan, as above: a relative path is read from the folder you run the
command in, here the checkout, whose own `.legal/` would then hold your project's results.

**What is not read by default, and how to include it.** A scan does not read test surfaces,
vendored code or build output. It is not a claim that those are safe — a live key in a test fixture
and a secret baked into a built file are exposure whether or not the file ships — so every scan
prints what it held back, with the flag that reads it.


Add `--read tests`, `--read vendored`, `--read build`, or `--read all` for every class. The same
block is in `findings.json` under `coverage_limits`, in the SARIF as one `note`-level alert per
line, and in what your agent reads — the same sentences, so a count on one screen is the count on
the others.

Files saved as UTF-16 with a byte-order mark are read. Files in Shift_JIS or another legacy encoding are read with
their non-ASCII characters replaced, and the scan says how many: patterns over ASCII text still match there, and
patterns written in Japanese or Chinese cannot. A Git LFS file that was not fetched is listed as not read, because what
is there is a pointer, not the file's content; run `git lfs pull` first.

Each line is a candidate for your agent to judge. That is layer 2: a plugin for your own coding
agent, in [`product/plugin/`](product/plugin/), that opens each candidate's files and returns
`violation_candidate`, `not_applicable` or `needs_human` with the code quoted. It runs under the key
or plan you already have and costs only the model usage your provider bills; WolfBoy operates no
service.

## How it works

```text
 your machine or CI runner
 ┌────────────────────────────────────────────────────────┐
 │ source tree                                            │
 │  ▼ LAYER 1  deterministic rules · offline · no model   │
 │    candidates: file · line · article · quote           │
 │    UNKNOWN for every rule that matched nothing         │
 │  ▼ LAYER 2  your own agent judges each candidate       │
 │    quoting the code it relied on                       │
 │    ◀── your privacy policy, terms, store manifests     │
 │  ▼ findings.json · SARIF · Art. 30 record · reconcile  │
 └────────┬───────────────────────────────────────────────┘
          ▼ every file your agent opens while judging
   your model provider · nothing reaches WolfBoy
```

By default a second agent re-reads each high finding that the review called a possible problem and then set aside on
its own word: the duty already met, an exemption, or code that does not ship. A high finding the review judged not to
apply is listed in `ruled-out.md` with the review's reasons, and by default it is not re-read. With a shape that
includes the second check, which you choose by typing `/wolfboy:legal-scan plan`, a second agent also tries to disprove
each upheld finding, and another re-reads each high finding the review judged not to apply; where it finds the rule
applies after all, or cannot settle it, the finding is left to your judgement with both answers. The cost shown before
you start includes these re-reads.

**Layer 1 casts wide; layer 2 judges.** A pattern match is not a finding, and a detector is never
narrowed to make it quieter. Facts about your product, such as who it serves and where you are
established, are asked of you in the scan profile (`--profile`) or read from your own declared
documents, never inferred from source. A profile never switches a rule off in layer 1: every rule runs
and its places are counted; an answer such as "not offered in the EU" only spares layer 2 the places of
rules about that region alone, and the price shown before the review starts reflects it.

### What it sends where

The addresses the CLI opens are each `--policy` URL
you name and any address it redirects to, GitHub's API (`GITHUB_API_URL`) for the one check run when
the CI step is given GITHUB_TOKEN, and web.archive.org in a deeper check you ask for, through the proxy
`HTTPS_PROXY` names where it names one (`NO_PROXY` is honoured): no telemetry, no usage ping, no update check.

In the excerpts WolfBoy hands the review, values the credential rule recognises (keys, tokens, passwords under a
secret-named key) are replaced by a marker that keeps only the provider's prefix and the value's length. A value it
does not recognise, such as some services' write keys, is sent as it is, and so is every line of a file an agent opens
itself.

## What comes out

| output | command | form |
|---|---|---|
| **findings** | `scan` | `findings.json` and SARIF 2.1.0 |
| **the report** | the plugin, at the end of a scan | `.legal/reports/scan-<time>/report.md`, with `laws.md`, `not-checked.md`, `ruled-out.md`, `changes.md` (from the second scan on) and one file per finding under `findings/` |
| **GDPR Art. 30 record** | `ropa` | four CSVs, a `.docx` and a README |
| **reconciliation report** | `reconcile`, your agent, `reconcile-verify` | your declarations beside your code |
| **questionnaire answers** | `questionnaire` | the customer's own CSV, answered |

SARIF lands in GitHub's Security tab as coverage statements and one note that counts the places
waiting for a review, "not findings"; `--sarif-matches` adds one note per place, worded as waiting for a
review and not a legal determination. The Art. 30 record is a CSV for the spreadsheet upload of Vanta's data
inventory and a Word document under the headings of Drata's policy appendix; the purpose column is
never filled from source.

VS Code's Quick Open and search skip `.legal/`; `wolfboy report` prints the latest report's path. `.legal/` keeps your
reviews in `evidence/`, and the next scan reuses them, so keep that folder. `wolfboy tidy` lists the folders earlier
scans set aside and the command that deletes them; it deletes nothing itself. If a Dockerfile copies your whole folder,
add `.legal` to `.dockerignore`.

## Later scans

A later scan on the same computer reviews again only new or edited places, places whose files changed, changed rules,
findings that rest on a package whose version changed, and, after a WolfBoy update, the rules that release marks as
judged differently. A change to your answers, or a package added or removed, still reviews everything again; the scan
shows what it will review, and the price, before it starts.

## Your policy, read against your code

Declaration reconciliation reads your privacy policy and terms, in the tree or at a URL you name,
Apple privacy manifests and Google Play data-safety exports, against what the code does. A finding
has one shape: your statement and your code do not appear to match, both quoted; never a statement
about what a law requires. What was searched for and what could not be read are written into the
output, so "no policy found" is a search result, not a fact about your project. Illustrative, not
from a real run:

| your declaration | your code |
|---|---|
| §4 Sharing: *"We do not share personal data with third parties."* | `src/monitoring.ts:14` `Sentry.init({ sendDefaultPii: true })` |
| §6 Retention: *"Event logs are retained for no longer than 90 days."* | `src/retention.ts:27` `PURGE_AFTER_DAYS = 0 // keep forever` |

```bash
node product/packages/cli/dist/index.js reconcile --bundle dist/bundle --target path/to/your/project \
    --policy https://example.com/privacy --findings .legal/findings.json --out .legal/reconcile-input.json
# layer 2's declaration-reconcile skill reads that file; reconcile-verify re-reads every quotation
```

## In CI

The rules check runs in a job your team already runs on pull requests: the published package at an exact version,
checked by its digest and installed outside your workspace, then one step. It reads no answers about the product, runs
no AI, and lists no place by line: places that match rules are counted by rule name in the step summary and in one
`neutral` check run, because no review has decided them.

```yaml
permissions:
  contents: read
  checks: write        # for the one check run; GitHub grants it to every step of this job
steps:
  - uses: actions/checkout@<commit SHA of the actions/checkout release you pin>
    with:
      fetch-depth: 2              # the merge commit and its first parent, the base branch's head
      persist-credentials: false
  - uses: actions/setup-node@<commit SHA>
    with: { node-version: 22 }
  - name: Install WolfBoy 0.1.0, checked by its digest
    working-directory: ${{ runner.temp }}
    run: |
      npm pack wolfboy@0.1.0
      echo "268dfa258e7f3ae6ed7f32cce5e555e3463b3e29edd902675acf4da587b9efb0  wolfboy-0.1.0.tgz" | sha256sum -c -
      tar -xzf wolfboy-0.1.0.tgz
      cd package && npm ci --ignore-scripts --install-strategy=hoisted
  - name: WolfBoy rules check (no AI review)
    run: node "$RUNNER_TEMP/package/dist/index.js" scan --target .
    env:
      GITHUB_TOKEN: ${{ github.token }}
```

Shorter: `npx --yes wolfboy@0.1.0 scan --target .` in place of the two steps above (the README's form; it checks no
digest).

- Keep `actions/checkout`'s default `ref` (the pull request's merge commit). A job that checks out the pull request's
  head needs the base as well (`fetch-depth: 0`); without it the step stops and says so.
- With a merge queue (`on: merge_group`), the step counts the lines the queued entry adds or changes against the
  queue's base; give that job `fetch-depth: 0`.
- On a push, the step counts the whole tree and says so.
- The step exits 0 whatever it counts. With `--fail-on-unreviewed high` (or `medium`, `low`) it exits 3 when a place at
  that level or above on the changed lines waits for a review, and the check run's conclusion is `failure`; it counts
  places, not findings. A usage error exits 1, a base commit missing from the checkout included.
  `continue-on-error: true` keeps the step from ever blocking; a failed step then shows inside a passing job.
- On a fork's pull request the token is read-only: no check run is created and the step summary is all there is. Do not
  mark the check run required for that reason.
- The log is public on a public repository; the step prints only the summary. The places are in the files `--out` and
  `--sarif` write, if you keep them as artifacts.
- `--sarif <file>` writes the coverage statements, one `warning` that the scan's coverage is not complete, and one note
  counting the places waiting for a review; `--sarif-matches` adds one note per counted place. Uploading it to code
  scanning needs `security-events: write`; nobody has tried an upload yet. If you stop uploading, code scanning labels
  the note fixed, which then means only that the uploads stopped.
- Install the package outside your workspace, as above; do not check this repository out inside your workspace. If the
  program's own files sit where the scan reads, the step stops: it never counts its own files as your code.
- Your saved answers about the product are not used in CI, so the rules of every region run; a pull request that changes
  them is annotated. A change to them, or to the workflow that runs this step, changes what this check does: list
  `.legal/` and `.github/workflows/` in a CODEOWNERS file so that such a pull request needs the review of someone you
  name.

**The AI review does not run in CI in this release.** Loading the plugin into Claude Code's GitHub Action does not work
yet: the review asks a person before it starts, so it stops at its first question after using some of your plan.
Every command's `--help` carries its options.

## What it reads your code against

EU and US law first. Rules citing each instrument, and checklist items, were counted from the rule bundle on 15 November
2026, when it held 120 rules; a rule citing two instruments is counted under both.

| instrument | rules citing it | checklist items |
|---|--:|--:|
| GDPR (Regulation (EU) 2016/679) | 96 | 14 |
| ePrivacy Directive 2002/58/EC | 25 | — |
| CCPA / CPRA (Cal. Civ. Code §1798.100 ff.) | 22 | — |
| AI Act (Regulation (EU) 2024/1689) | 12 | 8 |
| FTC Act §5 (15 U.S.C. §45) | 10 | — |
| Cyber Resilience Act (Regulation (EU) 2024/2847) | 8 | 29 |
| US state AI statutes (UT, NY, CA, NV, IL, TN) | 4 | — |
| Digital Services Act (Regulation (EU) 2022/2065) | 3 | 19 |
| Data Act (Regulation (EU) 2023/2854) | 2 | 19 |
| European Accessibility Act (Directive (EU) 2019/882) | 1 | 6 |
| General Product Safety Regulation (Regulation (EU) 2023/988) | — | 54 |

Whether the Cyber Resilience Act reaches your product turns on facts about the product: is it a product you hand to
users (software that runs only on your own servers and is used in a browser is not one on that basis alone), does it
connect to a device or a network, is it supplied, and is that supply commercial (giving it away free does not settle
this). The scan shows what your code suggests for each and asks you (in a terminal, `scan --review-declaration` asks
again). Until you answer them, it marks the law `unresolved` and lists the questions; a "yes" to one of them makes it
`likely-applies`, and a "no" to any of them marks it `does-not-apply`, unless your code shows facts on that question's
subject: then the scan shows your "no" as disputed and keeps the question open. A "no" to the region question for the
EU does not settle the Act: it also reaches a product people in the EU download, install or buy without its being
offered to them there. A "yes" to all four still leaves it `likely-applies`: the Act
does not reach a product one of its exclusions takes back out (a medical device, a motor vehicle or marine equipment,
for example), and this version cannot yet record answers to those. The cited article travels with every flagged line, and, for most rules, a passage quoted from it.

120 rules in 27 packs and 18 statutory checklists (149 items), built by
`node tools/build-bundle.mjs`. A rule is a detector over the tree. A checklist is one instrument's
disclosure duties, in the instrument's own order, asked of a document; every quote in it is the
statutory text verbatim, checked against the Official Journal.

Every rule reads every text file, whatever its language. Some also read the structure of HTML, TypeScript and TSX,
Elixir, and the ERB, HAML, Slim, Pug, Blade and HEEx templates. The package inventory reads npm, SwiftPM and CocoaPods
manifests.

## What it does not do

- It never reports a project as meeting a standard; zero candidates is reported as zero candidates.
- It does not judge: layer 2 gives an opinion with the code quoted, for you and your counsel.
- It does not infer what your product is from your code; those facts are asked of you.
- It publishes no accuracy figure: no precision, recall or detection-rate number is claimed.
- It never calls your project unlawful; rule text asserting legality either way fails the build.
- It is not legal advice: every scan ends with a notice saying so.

## Status

Not in this release:

- a direct layer-2 mode in which the CLI calls a model API with your own key;
- signed rule bundles (given a bundle's folder, `doctor --bundle <folder>` says it is "unsigned, so the manifest itself
  is not authenticated" today) and a bundle-update command.
