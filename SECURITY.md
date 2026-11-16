# Security Policy

WolfBoy reads your entire source tree, and its second layer hands text taken from that tree to an
LLM running inside your own agent (Claude Code), whose main session can write files and run commands. A security defect in this
project is therefore not an abstract concern: it is a way for a scanner you trusted to read your
code to become a way to exfiltrate it, or a way for text in a repository you scan to act on your
machine. Reports are read by the maintainer.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's **private vulnerability reporting** for this repository. As a reporter:

1. Open the repository's main page on GitHub.
2. Click the **Security** tab (GitHub's documentation currently labels it **Security and
   quality**), then **Advisories**.
3. Click **Report a vulnerability**.
4. Fill in the advisory form — a title and a description are the minimum; include the version or
   commit, the steps to reproduce, and what an attacker can achieve.
5. Click **Submit report**. GitHub shows a message confirming that the maintainers have been
   notified, and you are added as a collaborator on the private advisory so you can follow it.

Private vulnerability reporting is enabled for this repository.

## What to expect

Reports are read by the maintainer. There is no fixed reply time; the advisory is published with the fix.

Credit is given in the advisory and the changelog unless you ask otherwise.

## Supported versions

Security fixes are made to the latest release only.

## Scope: what counts as a vulnerability in a scanner

The following are security problems: report them privately.

- **Any network connection the CLI makes that HOW-IT-WORKS.md does not list** (its "What it sends where" section), or
  any channel that sends more than that section says it sends. That list is meant to be
  complete; a discrepancy is a vulnerability whether or not it was intended.
- **A rule, vocabulary entry or bundle that causes code, secrets or file contents to leave the
  machine**, or that writes outside the output paths the user named.
- **Prompt injection from scanned code into the user's agent.** Layer 1 extracts fragments of the
  scanned repository — including third-party dependencies and their comments — and layer 2 places
  them in front of an LLM that has Read, Grep and Glob, and, depending on the host agent, wider
  permissions. Text in a scanned tree that causes the adjudicating agent to take an action other
  than adjudicating (running a command, writing a file, sending data, changing a verdict on
  instruction rather than on evidence) is in scope. **State of mitigation, honestly:** three
  defences stand today, and none is proof against injection. (1) Every judging agent can only read:
  its tools are Read, Grep and Glob, with no shell and no file write. (2) The scan's instructions
  say that everything inside the scanned repository is data, never instruction, and the bundle build
  rejects instruction-shaped phrasing in *rule* text. (3) The plugin's hooks check the run's tool
  calls: they refuse writes into the scanner's own records and its redaction key in every session,
  and during a scan they refuse what the run does not allow. What they cannot stop: the AI in a
  Claude Code session runs shell commands as you, and a shell command can do whatever you can: write
  any file you can write, WolfBoy's records, run files and reports among them; run WolfBoy with code of
  its own loaded into it (`NODE_OPTIONS`, `node --import`), or run an edited copy of it; and remove
  Claude Code's variables, so that WolfBoy cannot tell its command from one you typed. Nothing inside
  WolfBoy stops that, and a report cannot prove it was not forged that way. What WolfBoy does hold:
  the AI's file tools (Read, Write, Edit, MultiEdit, NotebookEdit, Grep, Glob) cannot read the
  redaction key or change WolfBoy's records, its run files or its reports, in any project; in a
  project where Claude Code with the plugin was started, or where a scan in such a session ran,
  WolfBoy's own options and environment variables (other than those that load code into it) cannot
  make it take another project's or another state folder's plan, findings, carried verdicts, earlier
  log or key; and a session you started in another folder (your home folder, say) does not hold your
  own terminal scans of the projects below it that no scan in that session ran on. Where the plugin's
  hooks do not run (Windows without Git Bash, a plugin enabled during a session), the file tools are
  not checked either.
  The limits: the main session is your own
  Claude Code, with whatever permissions you gave it; scanned text is not wrapped or escaped before an
  agent reads it; and a verdict an agent was talked into is caught only where a second agent
  disagrees. In the default shape ("Everything (Recommended)") a second agent re-reads only a high finding the review
  agreed was a possible problem and then set aside on its own word (the duty met, an exemption, or code that does not
  ship); a high finding the review judged not to apply is not re-read. Only in a shape with the second check, which you
  choose with `/wolfboy:legal-scan plan`, does a second agent try to disprove each upheld finding, and another re-read
  each high finding the review judged not to apply. A medium or low finding the review judged not to apply is not
  re-read in any shape. A demonstration against this design is a valid report.
- **Rule-bundle integrity.** The bundle manifest is content-hashed and verified on load. A way to
  make the CLI accept a bundle whose contents do not match its manifest, or to substitute a bundle
  without detection, is in scope. Rule bundles are not signed; a report about that need not be
  filed.
- **Path traversal or symlink following** that makes the scanner read outside `--target`, or
  write outside the paths given to `--out`, `--sarif`, `--out-dir`.
- **Denial of service through crafted input**: a file or tree that makes the scanner hang or
  exhaust memory.
- **Supply chain**: a compromised or typosquatted package under a name this project publishes
  `wolfboy` on npm, a compromised release artefact, or a dependency added without the
  recorded reason CONTRIBUTING.md requires.

Out of scope, so nobody wastes effort:

- A rule that fires on code that turns out not to be a problem. Layer 1 is deliberately
  over-inclusive by design; that is a **rule target-correctness** issue and goes through the
  `rule_target` issue template, in public.
- A rule that did not fire on something it should have caught. That is a **rule miss** and goes
  through the `rule_miss` issue template, in public — unless the miss is caused by something an
  attacker can plant to hide a construct from the scanner, in which case report it privately.
- The behaviour, cost or data handling of the LLM provider your agent uses. That is between you
  and your provider; see [SUPPORT.md](SUPPORT.md).
- Vulnerabilities in the repositories you scan. WolfBoy reports candidates about them; it is not a
  channel for reporting them to their maintainers.

## Dependencies and release integrity

The CLI has 10 runtime dependencies, listed in its package.json. The bundled third-party grammars are recorded with
their licences and SHA-256 digests and checked in the build.
