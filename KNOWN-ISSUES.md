# Known issues

Known problems in WolfBoy 0.1.3.
When one is fixed, it moves to the changelog.

## Whether a law applies

**1. The Cyber Resilience Act never shows "applies".**
Four "yes" answers give "likely applies", because this
version cannot record answers to the Act's exclusions (a
medical device, a vehicle, aviation or marine equipment, a
spare part or national security, for example). If one of
them fits your product, the Act does not reach it.

**2. The examples in the commercial-activity question are
narrow.** In the Cyber Resilience Act's question, "sell
other services" and "let you process" say less than the
Act's Recital 15. Read Recital 15 before you answer "no".

**3. After a "no" for the EU, the Data Act's device-data
rule is still reviewed.** A region answer settles a whole
law, not one article of it, so the rule on data from
connected devices (Data Act Article 4) is reviewed with its
question open. It costs review time and hides nothing.

**5. A reason can name questions you were not asked.** If
your scan profile lists `distribution_regions` without
`regions_not_offered`, the reason given for leaving the
GDPR, the AI Act or the Medical Devices Regulation open names
the "presence" and "offering" parts of the newer region
questions. The outcome is right.

## Secrets in your code

**6. Some ways of writing a secret are not flagged:**
- a short password with no digit (`password = "kqzjdwxm"`,
  `password: example`) under a key not written like an
  environment variable;
- a value ending in `;` with no space before it
  (`smtp_password = value;` in php.ini or a git config);
- in a `.properties` or INI file, a value after `: ` that
  starts with `!`, `&`, `*`, `|` or `>`;
- a password in a YAML flow mapping (`db: {password: ...}`);
- an older OpenAI `sk-` key, unless its key name looks like
  a secret's.

If your code writes secrets this way, check those lines
yourself.

**7. The rest of a line with a secret is hidden.** Where
WolfBoy finds a secret's value after a key name, in a web
address, or as a long secret-looking value, everything from
it to the end of the line is hidden too: in the AI review's
excerpt, the report, the terminal and the logs. That takes
in a comment, more settings, the next command of a shell
line, and in a quoted value the words before the part
found; another finding on that line shows the redaction
mark instead of its words. Open the file at that line to
read it.

**8. The second check's "a placeholder value" leaves out a
caveat.** The first check says that a placeholder a running
system accepts is still a credential; the second check's
reason does not. A value your system really accepts
(`example`, `changeme`) is a secret, whatever it looks like.

**9. Some values that are not secrets are offered for
review.** A Docker Compose volume line (`name:/path`)
followed by a comment, and a camel-case name after `$` under
a secret-named key (`$authKeyFromVault2`), which is usually
a variable. The AI review usually dismisses them; they add
to its cost.

## What is read

**10. Files that start with a byte-order mark** (common from
Windows editors). Eight checks in five rules that look for a
supporting line elsewhere in the same file (eu-data-act-001,
eu-retention-001, -002, -003 and safeguard-reach-001) do not
see an indented first line. In a shell script, a `#` comment
on the first line is read as code, which can add a finding
but never hides one.

**11. A line ending in `\r\r\n`** keeps one `\r`, so a rule
that looks for the end of a line misses that line.

**12. A YAML text block opened by `--- |` with unindented
lines** is read as YAML: every ` #` in its text is taken as
the start of a comment, and the words after it are not read.

**13. A file can be left partly read.** A file can take more
than a minute at one rule (a 173-line C# file did) and is
then left partly read. The report names every such file as
not fully read.

**14. "Not read: none" leaves out `.git`.** Files under
`.git` are never read or counted, so your history is not
scanned even where the report says "Not read: none". The
"Not read" line of `report.md` and the summary at the end of
a run can also disagree.

**15. `--read build` reads built files in copied
third-party folders.** Built output inside a folder that
looks like someone else's code (`third_party/dist`, for
example) is read without first checking whose code it is,
so a finding there may be in code you did not write.

## Later scans and earlier answers

**16. Findings carried from a run without the second check
are not checked a second time.** In a run with the second
check, findings carried over from an earlier run that had
none are not checked again. The report lists them and says
how to have them checked.

**17. An alias set with `module-alias` is not followed.**
When WolfBoy decides whether an earlier answer still holds,
it does not read `_moduleAliases` in `package.json`. If your
code uses it and a package changed, have every answer read
again: run the scan and, when it asks for your earlier run,
do not name one.

**18. On Windows, earlier answers may be reviewed again.**
Whether an answer carried from an earlier run keeps what it
rests on is not yet confirmed on Windows. Where it does not,
WolfBoy reviews the finding again: more cost, nothing
hidden.

**48. A special-category answer saved by WolfBoy 0.1.0
sets all your saved answers aside.** The question about a
written condition for special categories of data (health,
biometric or genetic data, for example) changed in 0.1.1. If
you answered it with 0.1.0, the scan uses none of your saved
answers, so every region's rules run (more findings and more
review cost, nothing hidden), until you answer that question
again: say "review my answers" in Claude Code, or run
`npx wolfboy@0.1.3 scan --review-declaration` in your
project's folder.

## Running it in Claude Code

**19. Start Claude Code in the folder of the project you
scan.** Started in a parent folder, the pass over places the
review did not read reads every place again (more cost,
nothing hidden). Started in a scanned project that holds
another scanned project, the two count as one, and the inner
project's report can be written into the outer one's
`.legal/reports`.

**20. When a step is refused, Claude may not show you why.**
If the scan run after your answers, or the step that
prepares the AI review, is refused, Claude is not told to
show you the refusal. Ask it to read you
`.legal/scan-output.txt` or `.legal/prelaunch-output.txt`.

**21. `.legal/quick-scan.txt` is not protected.** Unlike the
AI review's files, the free scan's summary can be changed
by Claude's file tools. No later step reads it; if in doubt,
run the free scan again.

**22. The plugin's command check misses some forms.** It
does not look inside `bash -c "..."` or `pwsh -Command
"..."` given to the PowerShell tool, and it refuses a
double-quoted path spelled `legal\-scan` that names another
folder. What the plugin cannot stop is in SECURITY.md.

**23. Claude's own summary can differ from the report.** At
the end of a run Claude may word things its own way ("106
checks clear"). The report is what WolfBoy wrote: read it.

## The report

**28. Six countries' provisions are listed by the rule's
note.** Germany, Hungary, Luxembourg, the Netherlands and
Poland set no age of their own, and Romania, on the
evidence the rule could read, set none either, so the
GDPR's 16 applies and the children's-data rule names no
national provision for them: the list of provisions shows
the rule's note ("NATIONAL AGE - DE 16") where a law's name
belongs. The link beside it goes to the law.

**31. The review's reasoning can use internal words.** The
review is asked to say the rule's questions in words and to
describe the scan's own fields and working files instead of
naming them, but the reasoning is the AI's own writing and
is shown in full.

**36. "decide" on a finding that waits on a fact asks for an
answer.** Saying "decide F12" to Claude for such a finding
answers "answer the question instead", although no question
asks for that fact, and no command records it. The finding
stays "to answer".

**38. A "Yes" to the minors question puts the children's-data
finding "to fix".** "Minors may plausibly use it" is wider
than the GDPR's test (a service offered directly to a
child), but a "Yes" leaves the finding "to fix".

**39. Your minors answer is not compared with the code.** A
"No" is applied even where the code looks built for
children. The same holds for the other answers about who
uses the product and the conditions you confirm.

**40. "Not read" can miss a long line left unread.** Where
the scan leaves out an over-long line (in a minified file,
for example), `report.md` says so ("1 with lines not read"),
but the end screen and `.legal/quick-scan.txt` say "Not
read: none".

**41. The AI review can spend a retry on the regions
question.** One of the review's instructions still names
the question about where the product is offered as one a
finding may wait on. Such a wait is refused and the review
is asked again, which costs review time; the finding is not
lost.

**42. A minors answer saved by WolfBoy 0.1.0 is left out
without a note when a teammate's answers are confirmed.**
The answer is not used either way; only the scan's note
saying so is missing on that path.

**43. One problem can be reported as several findings.**
When one piece of code is named by several checks, or the
same problem sits in several places, each becomes its own
finding, so a report can count more findings than there are
problems. Fixing one problem can close several findings.

**44. "Ships as" has no answer for software your customers
install.** The question offers a website, a mobile app and
an API. If your customers install and run the product
themselves, choose the nearest answer or leave it open;
leaving it open switches nothing off.

**45. "You said" for a region you only left off your list.**
Where your answers list the regions the product is offered
in but name none where it is not, some lines of `laws.md`
and `not-checked.md` say "you said the product is not
offered" in a region you only left off the list. The
outcome follows your list; only the wording is wrong.

**46. An earlier answer can settle a finding after the AI
review is asked again.** When WolfBoy sends the AI review's
answer back for a correction and the corrected answer ties a
finding to a different question, one you have already
answered, your answer can settle that finding although the
correction was not asked to change the question: the finding
is then listed but not counted. Read the findings your
answers settled.

**47. The review's reasoning can state a fact wrongly.** It
is the AI's own writing, for example about where a company
is established. The lines of code it quotes are checked
against your files; the reasoning around them is not.

## For people who build WolfBoy

**34. On Windows, part of the test suite does not pass
yet,** for reasons in the tests (Linux-style paths, file
permissions, named pipes, a POSIX shell). Run the tests on
Linux or WSL.
