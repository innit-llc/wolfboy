# WolfBoy: the Claude Code plugin

The scanner works in two layers. Layer 1, the command-line scanner, finds the places in your code that a rule
names, on your computer and with no AI. Layer 2 is this plugin: Claude Code opens each place, judges it against the
provision the rule cites, quotes the code it relied on, and writes the report. This package carries both, the
plugin and the scanner it runs, at one version.

## Install

You need Claude Code, Node.js 20 or later with npm on your PATH, and git. The tests run on Linux, macOS and Windows; a full
scan with the AI review has been run on Linux and WSL. The scanner gave identical findings on Node 18, 20, 22, 24
and 26 (2026-11-10).

```bash
claude plugin marketplace add innit-llc/wolfboy
claude plugin install wolfboy@wolfboy --scope local
```

Inside a Claude Code session, `/plugin marketplace add innit-llc/wolfboy` and
`/plugin install wolfboy@wolfboy` do the same; choose the local scope if Claude Code asks for one. Claude Code downloads this package from npm at
the version the marketplace pins and installs its dependencies from the lockfile the package ships, with install
scripts turned off. After that, layer 1 and the step that plans layer 2 run without a network connection.

Run both in the project you want to check: `--scope local` loads the plugin there only.

## What the plugin adds to Claude Code

The plugin adds hooks: commands Claude Code runs at fixed points of a session. They run in every Claude Code session
where the plugin is enabled (installed the default way, every session and every project), not only during a scan:

- when a session or a subagent starts or stops (SessionStart, SubagentStart, Stop, SubagentStop);
- before a call of Read, Grep or Glob; Write, Edit, MultiEdit or NotebookEdit; Bash, PowerShell, Monitor or the IDE's
  code tool; Agent, SendMessage, Skill or Workflow; ScheduleWakeup or CronCreate; AskUserQuestion; and a subagent's
  hand-back (PreToolUse);
- after an Agent or AskUserQuestion call, when an Agent call fails or is denied, and when a slash command or skill
  expands (PostToolUse, PostToolUseFailure, PermissionDenied, UserPromptExpansion).

Outside a scan they refuse four things and do nothing else: a file tool writing into the scanner's own records (its
state folder, `~/.local/state/legal-scan` on Linux), a file tool writing a scan's run files or reports (in a project's
`.legal`: the findings, the plan, the evidence logs, the reports), a Read, Grep or Glob of the key the scanner redacts with (a shell
command that reads it is not checked), and a shell command that names a scan's `.legal/deep` folder. During a scan they also check what the judging agents read and
write and refuse what the run does not allow. Outside a scan, each file, search, edit or command call costs about
0.2 s on Linux and about 1 s on native Windows. On Linux and macOS, a Read, Grep or Glob that plainly stays clear of
WolfBoy's own folders is checked by the hook script itself, in a few milliseconds, without starting Node.js; other
calls, a search of the whole project among them, start Node.js once.

What they cannot stop: a shell command the AI runs. It runs as you and can do whatever you can, WolfBoy's records and
reports included, and a report cannot prove it was not forged that way. Where the hooks do not run (Windows without
Git Bash, or a plugin turned on during a session), nothing is checked. The exact boundary is in the repository's
SECURITY.md.

To keep the hooks out of your other projects, install with `--scope local` in the project you scan, or turn the
plugin off between scans: `claude plugin disable wolfboy@wolfboy`, and `claude plugin enable wolfboy@wolfboy` to
turn it back on.

## What reaches your model provider

Every file the judging agents open, and every line their searches return, goes to your model provider, not only the
lines a rule matched: an agent may read any file of the project to judge a place in context. Under Claude Code the
provider is Anthropic, and the terms of your Claude plan apply. Scan only code you may send to that provider. Nothing reaches WolfBoy.

## Start a scan

Open Claude Code in your project folder and ask: "Scan this repository." Each scan starts in a session of its own,
from your terminal, in the folder to scan: the plugin stops and prints the command that starts it, and below it, the
first time, a shorter one to install once (`npm install -g wolfboy@<the plugin's version>`), after which
`wolfboy session` starts the scan's session in any terminal, PowerShell included. When the plugin is updated,
`wolfboy session` says the two versions differ and starts the session with the plugin's own copy. In any other Claude
Code session the scan's commands say the plugin's hooks are not running there and start nothing.
The scan runs in Claude Code's command-line tool, in a terminal (VS Code's own terminal is fine); with Claude Code only
as the VS Code extension, the session command uses the copy the extension installed. The session it starts leaves out, for that
session only, what would otherwise reach every judging agent: your repository's instruction files, its git status
and MCP instructions. Run the command in your terminal, then ask again. The command is the plugin's own launcher:

```bash
"<plugin folder>/bin/legal-scan" session -- --permission-mode auto
```

`<plugin folder>` is the `installPath` that `claude plugin list --json` shows. Arguments after `--` go to Claude
Code; the runs so far used its `auto` permission mode.

## Answers about your product

A scan asks at most four questions about the product (where it is offered, to whom, which features) and writes the
answers to `.legal/profile.json` and `.legal/profile-record.json`. Commit both so that teammates need not answer
again: each person's scan asks once, in their own folder, whether to use the saved answers, and CI never reads them
(the rules of every region run there).

## What it costs

Layer 2 runs in your own Claude Code, under your own Claude plan or API key, and uses its tokens. Before the AI
review of a project's first scan, the plugin shows its estimate of the time and the tokens (on an API key, in money
too) and asks whether to start; a later scan starts without asking and shows its estimate. Nobody else runs a
service for it.

## Update and remove

```bash
claude plugin marketplace update wolfboy
claude plugin update wolfboy@wolfboy
claude plugin uninstall wolfboy@wolfboy
```

`claude plugin uninstall` leaves the marketplace entry (`claude plugin marketplace remove wolfboy`); WolfBoy's state
folder, `legal-scan` under `$XDG_STATE_HOME`, else `~/.local/state` (Linux), `~/Library/Application Support` (macOS) or
`%LOCALAPPDATA%` (Windows), which holds the redaction key and your decisions and records (deleting it loses them); the
key's spare folder `wolfboy-redaction-key-<your user id>` in the system's temporary folder; and each scanned project's
`.legal/`, yours to keep or delete. If a usage limit stops a scan, type continue in the same conversation once the
limit resets; if the session closed, ask for the scan again in the same folder. If you update the plugin while a scan
is unfinished, the scan says so when it continues; end it and scan again to use the new version.

In an organisation: the scan needs the plugin's hooks. Where managed settings set `allowManagedHooksOnly`, ask your
administrator to enable `wolfboy@wolfboy` in the managed `enabledPlugins`; `disableAllHooks` stops the scan.

A plugin and a scanner of different versions are refused, never run together. Claude Code does not update a
third-party marketplace on its own; to have it do so, turn on auto-update for this marketplace in `/plugin`, under
Marketplaces.

## The scanner on its own

The same package is the command-line scanner, layer 1 only: `npm install -g wolfboy`, then
`wolfboy scan --target <your project>`. You can run it from your own terminal or from Claude Code. In Claude Code without the
plugin, it asks no questions about your product: it lists them, and you answer them by running the same command in your
own terminal.

## From a source checkout

Build the scanner (the repository's HOW-IT-WORKS.md, "Build from source and try it"), then start Claude Code with the plugin loaded for that
session only: `claude --plugin-dir product/plugin`. The plugin then runs the scanner built in
`product/packages/cli`.
