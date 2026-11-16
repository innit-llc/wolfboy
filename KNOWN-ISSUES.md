# Known issues

Known problems in WolfBoy 0.1.0.
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

**4. Counts of open questions can mislead.** After a "no"
rules a law out, the line listing the laws still counts that
law's other questions as open, though no answer to them
changes the result. The summary at the end of a run says
"no question open" whenever no finding waits on an answer,
even while questions about the product are open; the line
listing the laws shows those.

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
AI review's files, the free scan's full list can be changed
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

**24. A summary over 20 words is replaced.** Where the
review's one-sentence summary of a finding runs past 20
words, the report shows "(it ran to 21 words, and this
report takes at most 20)" in its place. The reasoning is
still shown.

**25. A finding that waits on your answer can be listed "to
fix".** Where the review says a finding waits on your answer
but names no question, the report places it under "to fix".

**26. A finding can point to two different places.**
`report.md` can show a finding at one place and the
finding's own page at another. Both are shown; check both.

**27. The record for your team.** `report.md` does not link
to it (it is in `.legal/records/`), and its "Prepared" date
is in UTC, so it can be a day off your local date.

**28. A provision can be listed under a note instead of its
name.** Where a rule's citation of a national law opens with
a note, a finding's list of provisions shows the note where
the law's name belongs ("NATIONAL AGE", "NOT VERIFIED
AGAINST A PRIMARY SOURCE"). The link beside it goes to the
law.

**29. "1 question settles" can count a question that does
not exist.** The report can say one question settles a
finding to answer, and the finding's page can ask for your
answers, while the same page says the scan has no question
for it yet. Such a finding is listed again on every scan;
its page says what to check, and with whom.

**30. "What the rule says to do" includes directions to the
AI review.** That section shows the rule's text in full, and
parts of it are written for the review that reads your code
("Read the matched line first"), not for you.

**31. The review's reasoning can use internal words.** The
reasoning shown in full can number the rule's questions (Q1,
Q2, ...) without saying them, and name the scan's own
fields (`distribution_regions`) and working files (the
"orientation sheet").

**32. "Not read" can name folders that are not there.**
`report.md` and the record can say "Not read: 19+ files in
machine-written folders (node_modules, .git and the like)"
when the files are WolfBoy's own `.legal` folder, which is
never read. `.legal/quick-scan.txt` names them.

**33. A finding about children can be rated high without a
sign of a young audience.** In the sample, the book-club
app's children's-data finding is "to fix · high" although
the review found nothing aimed at children: where the
review says a finding waits on your answer but names no
question, the report places the finding as if the duty were
not met and the code shipped. Answer the audience question
(say "review my answers" to Claude) to settle it.

## For people who build WolfBoy

**34. On Windows, part of the test suite does not pass
yet,** for reasons in the tests (Linux-style paths, file
permissions, named pipes, a POSIX shell). Run the tests on
Linux or WSL.
