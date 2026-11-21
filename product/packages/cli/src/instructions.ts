/**
 * THE INSTRUCTIONS A VERDICT WAS JUDGED BY, AS A PREMISE.
 *
 * ## Why this file exists
 *
 * A carried verdict rested on the candidate, the rule, the person's answers, the census, the files read and the searches
 * run - and on the instructions the seat judged by, which nothing compared. The bundle's version stood in for them and
 * had been `2026.07.1` since July, so a product update that changed how a seat judges, and no rule, carried every
 * earlier verdict unchanged. This module names those instructions and digests them, so that `rests-on.ts` writes them
 * into every verdict's premise block and `carry-forward.ts` sends a verdict judged under other instructions back to a
 * seat, with the reason `instructions`.
 *
 * ## What the digest covers
 *
 *   - `agent`         - sha256 of the agent text of the seat that gives a verdict. Every seat whose answer becomes a
 *                       carried verdict is `legal-adjudicator` (one seat, a place seat, a reader or an answer seat); a
 *                       refuter's or a silence investigator's file is never carried (adjudicate-plan.ts
 *                       `readPreviousRun`), so their texts are not premises of a carried verdict.
 *   - `skill`         - sha256 of the legal-scan skill the run followed.
 *   - `verdict_rules` - `VERDICT_RULES_VERSION` below: a DECLARED version of the program's verdict rules - the capture
 *                       checks, the bars and the composition that decide what a verdict may be. Declared rather than
 *                       digested from the running program, because a compiled file moves with the compiler and the
 *                       build, and a premise that moves with them would send every verdict back on a rebuild. The
 *                       gate a test holds the declaration honest: it pins a digest of
 *                       every file in `VERDICT_RULES_SOURCES` to the version, and fails when any of them changes while
 *                       the version does not.
 *
 * A file that cannot be read makes the digest absent with the reason: the premise block is then incomplete and never
 * carried, and a later run that cannot digest its own instructions carries nothing.
 *
 * No clock, no randomness, no network.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pluginRoot } from "./seat-effort.js";
import { VERDICT_RULES_BUILD_DIGEST, VERDICT_RULES_NEVER_RELEASED } from "./verdict-rules-digest.generated.js";
import { JUDGING_MARKS, JUDGING_STATES, type InstructionsState, type JudgingMark } from "./judging-marks.js";

/**
 * The version of the program's verdict rules. BUMP IT whenever a file in `VERDICT_RULES_SOURCES` changes, then re-pin
 * with the version test's `--pin`; the gate refuses a changed file under an unchanged version.
 * A bump sends every earlier verdict back to a seat once, which is the point: they were judged under other rules - unless
 * the bump declares the earlier version it judges as (`VERDICT_RULES_JUDGES_AS` below), which only a record may justify.
 *
 * `verdict-rules-3`: the capture writes what the seat ran under on its records (`reading-assembly.ts`
 * `withSeatBasis`, `hook-capture.ts`, `place-reply.ts`, `verdict.schema.json`).
 *
 * `verdict-rules-4`: main's `hook-capture.ts` binds nothing for a seat whose entry was
 * launched again, and the capture takes a seat's premises from its own transcript by the assembly's lookup,
 * with its stamp (`hook-capture.ts`, `seat-opened.ts` `seatTranscriptOf`).
 *
 * `verdict-rules-5`: what a seat's own transcript could not give when it ended is written on its records as
 * a reason that stops the carry (`reading-assembly.ts` `seat_untaken`, `place-reply.ts` a place row's `incomplete`,
 * `verdict.schema.json`), never as an empty sight.
 *
 * `verdict-rules-6`: a seat's own transcript that holds no line of the seat's
 * gives its sight no premise, by a reason (`seat-opened.ts`), and the effort is taken from the seat's own lines on both
 * routes (`hook-capture.ts`).
 *
 * `verdict-rules-7`: the capture reads the reply and record schemas from the program's own compiled code
 * (`verdict-capture.ts` `schemaReader`, schema-validate.ts `schemaDocument`) instead of a folder beside it. The schemas
 * and every check on a reply are unchanged; the bump is this gate's rule for a changed listed file, and its cost is the
 * stated one (an earlier verdict goes back to a seat once).
 *
 * `verdict-rules-8`: a seat's receipt is computed with that seat counted as delivered (`hook-capture.ts`
 * `nextForReceipt` passes the seat's agent id to the launch accounting), so a place Claude Code still holds for an
 * undelivered report is not offered. Only which launches a receipt names moved; the capture checks, the bars and every
 * check on a reply are unchanged. The bump is this gate's rule for a changed listed file, and its cost is the stated one.
 *
 * `verdict-rules-8`: the hook capture may replace a record the run set aside - removed or changed outside the
 * program - with the answer of the seat launched again in its place (`hook-capture.ts` `setAsideReplacement`,
 * `verdict-capture.ts` `replaceSetAside`). Which records are written and every check on a reply are unchanged; the bump
 * is this gate's rule for a changed listed file, and its cost is the stated one.
 *
 * `verdict-rules-8`: a place seat names the gate's kind on every `construct_but_gated` row, from a closed
 * list (`reading.ts` `PLACE_GATE_KINDS`; `place-reply.ts` C3; the reply and record schemas; `verdict-verify.ts`'s shape
 * check of a read row's gate), and the adjudicator's agent text asks for it. Only `development_or_test` keeps a place
 * out of a severity raise.
 *
 * `verdict-rules-9`: three changes each moved the version to
 * `verdict-rules-8` on its own branch, over different bytes of the listed files (`hook-capture.ts` in 739;
 * `hook-capture.ts` and `verdict-capture.ts` in 738; the adjudicator reply and verdict schemas, `place-reply.ts`,
 * `reading.ts`, `place-fold.ts` and `verdict-verify.ts` in one of them). The release
 * candidate holds all three changes, which no single `verdict-rules-8` pin describes, so one version above every
 * unit's is pinned once over the merged files. The merges changed no check on a reply beyond the three units' own; the
 * cost is the stated one (an earlier verdict, under any of the three `verdict-rules-8`, goes back to a seat once).
 *
 * `verdict-rules-10`: two files whose
 * content decides what a verdict may be were not listed. `schema-validate.ts` is the validator every reply and record
 * schema check of the capture goes through (`verdict-capture.ts` `schemaReader`, `verdict-verify.ts`): its options and
 * the schemas it adds decide which replies are accepted, as the schema files themselves do. `carried-places.ts` makes a
 * carried place's row as a read row (`carriedRow`) and gives the capture's answer rules the carried rows
 * (`carriedRepliesOfLaunchDir`, read by `hook-capture.ts` and `verdict-capture.ts`): which rows a verdict is composed
 * over and checked against. Neither file's bytes changed; the list did, and a changed list is this gate's rule for a new
 * version. The cost is the stated one (an earlier verdict goes back to a seat once).
 *
 * `verdict-rules-11` (the public build merged): the public build turned the citations
 * of eight listed files into its one citation marker (`hook-capture.ts`, `reading.ts`, `seat-model.ts`,
 * `seat-opened.ts`, `verdict-capture.ts`, `verdict-verify.ts`, the adjudicator reply and verdict schemas). Only comments
 * and two schema descriptions changed, so no check on a reply changed; a changed byte of a listed file is this gate's
 * rule for a new version, pinned once over the merged files. The cost is the stated one (an earlier verdict goes back to
 * a seat once).
 *
 * `verdict-rules-12` (the link-safe writes, the matching-cost bound and the carry keys
 * merged): four listed files changed under `verdict-rules-11`. fix/rc-legal-writes routed the writes of
 * `hook-capture.ts`, `place-fold.ts` and `verdict-capture.ts` through the one write path (`project-write.ts`), and made
 * `verdict-verify.ts` read a refutation's failed rows only where its refuter entry stands before they demote a record;
 * fix/rc-credential-cost bounded the work of two of `verdict-verify.ts`'s quotation matchers (`contentlessReason`,
 * `elidedParts`), in form only by its record. fix/rc-carry-keys changed no listed file. A changed byte of a listed file
 * is this gate's rule for a new version, pinned once over the merged files. The cost is the stated one (an earlier
 * verdict goes back to a seat once).
 *
 * `verdict-rules-13` (the carry words, the parse bound, the census budget and the third
 * public build merged): four listed files changed under `verdict-rules-12`, all by the public build: `verdict-verify.ts`
 * (comments and the words of two printed sentences, its pointers to records turned into plain words) and the verdict,
 * adjudicator reply and reader reply schemas (descriptions only; every other key equal). No check on a reply changed.
 * fix/rc-carry-words, fix/rc-parse-bound and fix/rc-census-budget changed no listed file. A changed byte of a listed
 * file is this gate's rule for a new version, pinned once over the merged files. The cost is the stated one (an earlier
 * verdict goes back to a seat once).
 *
 * `verdict-rules-14` (the hardening merged, and what the
 * public tree may hold answered over every unit's new text): one listed file changed under `verdict-rules-13`,
 * `verdict-verify.ts`, in six comment lines only - their pointers to records put inside citation markers, which the
 * export removes. No check, printed sentence or schema changed; fix/rc-harden changed no listed file. A changed byte of a
 * listed file is this gate's rule for a new version, pinned once. The cost is the stated one (an earlier verdict goes
 * back to a seat once).
 *
 * `verdict-rules-15` (the read kinds, the post-scan cost and the fourth public build merged): all
 * 17 listed files changed under `verdict-rules-14`. fix/rc-read-kinds routed the project reads of six of them
 * (`carried-places.ts`, `place-answer.ts`, `place-reply.ts`, `seat-opened.ts`, `verdict-capture.ts`,
 * `verdict-verify.ts`) through the non-blocking reader (`project-read.ts`): the bytes read from a regular file are the
 * same, and an entry that is not a regular file is refused by name instead of waited on. The fourth public build changed
 * 16 of them in comments and schema descriptions only. fix/rc-plan-cost changed no listed file. No check on a reply
 * changed. A changed byte of a listed file is this gate's rule for a new version, pinned once over the merged files.
 * The cost is the stated one (an earlier verdict goes back to a seat once).
 *
 * `verdict-rules-16` (the link fix and the fifth public build merged): eleven listed files changed
 * under `verdict-rules-15`, all by the fifth public build, in comments, one `$comment` and schema descriptions only -
 * their pointers to records made citations, which the export removes. fix/rc-out-links changed no listed file (the six
 * listed readers call `readRegularFile`, whose source is not listed, and their own text is unchanged). No check on a
 * reply changed. A changed byte of a listed file is this gate's rule for a new version, pinned once over the merged
 * files. The cost is the stated one (an earlier verdict goes back to a seat once).
 * `verdict-rules-17`:
 * four listed files changed - hook-capture.ts (took_ms on the hook ledger, the hand-back check store), place-reply.ts,
 * place-answer.ts and reading-assembly.ts (the capture check's tree-wide work taken once per answer, not per candidate).
 * No check on a reply changed; a changed byte of a listed file is the gate's rule. Pinned once over the four. It is
 * the first version to declare the one it judges as (`verdict-rules-16`, `VERDICT_RULES_JUDGES_AS`), by section 8 of
 * the same record. Re-pinned under the same version
 * (never released or used by a run): the list now holds every module of the capture's import closure (the version gate
 * derives it and fails on a module missing from it), and the same fix then changed `hook.ts`, `hook-capture.ts` and this file;
 * section 8 says why no check on a reply checked within the deadline changed its outcome or its recorded fields.
 * `verdict-rules-18` (harvest H3, H10, H11): the capture's place checks C5, C9
 * and A6 compare a quotation with its lines as the final quote check does (`reconcile-verify.ts` `quotationRanges`), the
 * role `dismissal` on a rule that declares no reading class is dropped and recorded instead of refused (`reading.ts`
 * `inertDismissals`), and the seat read guard reads a Grep's glob piece by piece (`hook.ts` `seatReach`). Checks on a
 * reply changed their outcome (answers refused before are accepted), so no earlier version is declared judged as this
 * one. The cost is the stated one (an earlier verdict goes back to a seat once).
 * `verdict-rules-19` (harvest H2,
 * H8, merged over `verdict-rules-18`): three listed files changed - hook-question.ts (the earlier-run question as a kind
 * of the question relay and the Bash word rule's `--previous`, plan item H2), hook-launch.ts (the main conversation's Stop
 * route, its bound, and one sentence of a relay's hand-back, H8) and hook.ts (the Stop route's row and the Bash route's
 * flag predicate). The flow fix took `verdict-rules-18` on its own branch, a name this line had already given the answers
 * fix, so the merge takes the next number, pinned once over the merged files. No check on a reply changed its outcome or
 * its recorded fields; it declares that it judges as `verdict-rules-18`, by the merge record's section of that name.
 * `verdict-rules-20` (harvest
 * H5a stage 1): the reply and the record take the review's `standing` block (adjudicator-reply.schema.json,
 * verdict.schema.json), checked part by part at capture and set aside, never refused (standing.ts `checkStanding`,
 * reading-assembly.ts `standingOfEntry`, place-reply.ts `lineStandsAsBeyond`); the agent text asks for it. The capture
 * accepts a field it refused before, so answers' outcomes change: no earlier version is declared judged as this one,
 * and the first scan on it carries no earlier verdict (the agent text changed too).
 * `verdict-rules-21` (harvest
 * H4, merged over `verdict-rules-20`): a seat's search is captured with the call's whole input and replayed as the host
 * ran it - by the host's own engine wherever it is found, otherwise by today's replay only where that replay searches at
 * least every file the host's search could - and every later run derives a row's scope again from what the seat wrote
 * (host-search.ts, newly listed; rests-on.ts, place-premises.ts, seat-opened.ts, carry-forward.ts, child-program.ts; four
 * optional fields of a search row in verdict.schema.json). The carry fix took `verdict-rules-21` on its own branch, over
 * `verdict-rules-19`; the name was unused on this line, so the merge keeps it, pinned once over the merged files. Only
 * the premise rows written for a later run changed, and an earlier verdict is compared only toward reading again. No
 * check on a reply changed its outcome or its recorded fields, the `standing` checks of `verdict-rules-20` included
 * (they read the reply, the kept places and the seat's Reads, never a search row or a replay); it declares that it
 * judges as `verdict-rules-20`, by the merge record's section of that name.
 * `verdict-rules-22` (harvest
 * H6, merged over `verdict-rules-21`): walk.ts and read-scope.ts test a folder named like vendored code for another
 * project's origin before holding it back (vendored-origin.ts, newly listed) and probe what a re-scan with `--read`
 * would read, both only where a read scope is passed. The read-scope fix took `verdict-rules-22` on its own branch, over
 * `verdict-rules-19`; the name was unused on this line, so the merge keeps it, pinned once over the merged files. The
 * capture's one walk (rests-on.ts, the tree's files a seat's search is replayed over) passes no read scope, so its file
 * list is unchanged and none of the new code runs at capture. No check on a reply changed its outcome or its recorded
 * fields, the `standing` checks of `verdict-rules-20` and the search premises of `verdict-rules-21` included; it
 * declares that it judges as `verdict-rules-21`, by the merge record's section of that name. The same fix changed the
 * legal-scan skill (step 3f), whose own digest the instructions premise and the reading spec compare, so an earlier
 * verdict goes back to a seat once for the skill, not for this version.
 * `verdict-rules-23` (the plugin installed from a marketplace,
 * over `verdict-rules-22`): seat-effort.ts `pluginRoot` also finds an installed plugin, the CLI's own package holding
 * .claude-plugin/plugin.json. Where the package holds none (the source checkout, every gate's tree and every run on
 * record) it returns what it returned under 22, and the values it feeds (the seat pins, the instructions digest and the
 * reading-spec digest) are equal in both layouts. No check on a reply changed its outcome or its recorded fields; it
 * declares that it judges as `verdict-rules-22`, by that record's section of that name.
 * `verdict-rules-24` (the walker's links
 * and names, merged over `verdict-rules-23`): the walker (walk.ts, the capture's own walk among its callers) and the one
 * reader (project-read.ts, the quote and standing checks' reads among its callers) resolve a symbolic link through the
 * system only after walking its chain within a bound, and the walker lists names as bytes; read-scope.ts gained the
 * words of the two new refusals, and the compiled-in schemas (schemas.generated.ts) the three new exclusion reasons
 * (link-not-followed, name-not-utf8, link-path-too-long). The walker fix took `verdict-rules-23` on its own branch, over
 * `verdict-rules-22`; on this line that name is the plugin install's, so the merge takes `verdict-rules-24`, pinned once
 * over the merged files. On every tree whose links all resolve within the bound and whose names are all valid UTF-8 (the
 * 171 corpus entries and the ten trees of the H6 records among them) every read and every walk returns what it returned
 * under 22, and so under 23, which changed none of walk.ts, project-read.ts, read-scope.ts and schemas.generated.ts. On
 * a tree holding a link past the bound or a name that is not valid UTF-8 they do not: a read of such a link that 23 made
 * is refused, and the capture's file list loses the entries 23 listed through such a name. A check on a reply can
 * therefore change its outcome there, so this version declares nothing: an earlier verdict goes back to a seat once.
 * `verdict-rules-25` (the launchers' own place, merged
 * over `verdict-rules-24`): the plugin's folder and the launcher the told commands name come from the program's own
 * place by real path, never from CLAUDE_PLUGIN_ROOT. The fix took `verdict-rules-24` on its own branch, over
 * `verdict-rules-23`; on this line that name is the walker's, so the merge takes `verdict-rules-25`, pinned once over
 * the merged files. No check on a reply changed its outcome or its recorded fields; it declares that it judges as
 * `verdict-rules-24` (the table below says why).
 * `verdict-rules-34` (the launchers: told commands
 * single-quoted). 25 is this line's; the not-violations integration holds 29-33, so this change takes the next free
 * name. Every told command's values are written in single quotes by scanner-command.ts `scannerCommand`, and the
 * capture reads a fold command's words with `toldCommandWords`; no check on a reply changed its outcome or its recorded
 * fields, so it declares that it judges as `verdict-rules-25` (the table below says why).
 * `verdict-rules-26` (the contract of
 * fixes A-D, over `verdict-rules-24`; `verdict-rules-25` is another branch's, so this line takes the next free number):
 * standing.ts gained the value lists the report and the evidence log are to be written against (the status `exempt`, the
 * ships value `documentation`, the parts `element`, `exemption`, `fact`, `same_as`, the ships premises, the rule roles, the
 * question kinds), while `checkStanding` reads three lists holding exactly the values and order it read under 24; the
 * compiled-in schemas (schemas.generated.ts, verdict.schema.json among them) gained optional record fields no writer
 * writes yet and one reply definition nothing refers to. No check on a reply changed its outcome or its recorded fields;
 * it declares that it judges as `verdict-rules-24`, by that record's section of that name. A package that adds a check
 * of the new values changes outcomes, so it takes a version of its own that declares nothing.
 * `verdict-rules-27` (the
 * capture's checks of the new parts, over `verdict-rules-26`): `checkStanding` now reads the full lists, so a seat's
 * `exempt` and `documentation` are kept where their checks pass instead of set aside; `duty_met` stands only with an
 * `element`, `exempt` only with an `exemption` naming a basis of the rule's own, `waits_on_answer` with a question of the
 * program's list or a `fact` in words, `same_as` only where its line stands by C9's rule (S8, S3-S5, S2); `exempt` with
 * `needs_human` contradicts itself (S6); and a `ships` the seat left out takes the program's premise for the decisive
 * place where the findings document holds one whose manifest lines stand. A reply's accepted parts change, so this
 * version declares nothing: an earlier verdict goes back to a seat once.
 * `verdict-rules-28` (the agent text
 * of fixes A-D, over `verdict-rules-26`; `verdict-rules-27` is another branch's, so this line takes the next free
 * number): the adjudicator's text (rule 2's meaning of `violation_candidate`, rule 3's constant and environment branch,
 * rule 6a's wait on a question or a fact named in words, rule 6b's answers about a feature, the new rule 6c for a rule
 * whose role is an inventory, the `standing` bullet's new values and parts with a worked example, one sentence added to
 * A4 and to its echo), the refuter's challenge mode (no brief names it yet), and the legal-scan skill's steps 3j, 4, 5,
 * 6 and 8 and its rules of adjudication. A seat reading them may answer a candidate differently, so this version
 * declares nothing: an earlier verdict goes back to a seat once.
 * `verdict-rules-29` (the
 * integration of fixes A-D, stage 1; pinned once over the merged files): `verdict-rules-27` (the capture's checks, on its
 * own branch over 26) and `verdict-rules-28` (the agent text, on its own branch over 26) merged with the report's
 * disposition, the rule's role (`finding_role`) carried into the seat's brief, and the agent text's examples of the new
 * parts. Every change either package made changes what a seat answers or what the capture keeps, so this version declares
 * nothing: no verdict judged under 24, 26, 27 or 28 is judged as this one, and the first scan after the change reviews
 * every candidate again.
 * `verdict-rules-30` (questions before
 * review and settlement by a scope answer, over `verdict-rules-26`; 25 is fix/rc-launcher-harden's and 27-29 the NV
 * integration's, so this line takes 30): declaration.ts (asked before review by kind, the cap, the digest without the
 * program's own keys, the settlements), per-rule-applicability.ts (a scope answer of the confirmed record settles a
 * rule: `settled_by`, and the seat's settled premise for it), standing.ts unchanged, and the compiled-in schemas
 * (scan-profile.schema.json's kinds, settles_as and four new fields; findings and evidence-log fields for the
 * settlement). The premise the seats are handed moves where an answer is now asked before review, so this version
 * declares nothing: an earlier verdict goes back to a seat once.
 * `verdict-rules-31` (the program's
 * ships premise, over `verdict-rules-27`): the scan now writes `ships_premises` (ships-premise.ts), so the capture's fill-in
 * of an omitted `ships` acts on every scan where until now it was idle; every seat's brief carries one line per file of
 * its payload with the premise and the manifest line it rests on; and the premise of each location's file is digested
 * into the verdict's `facts` premise and the place's window. A reply's recorded `ships` and every brief change, so this
 * version declares nothing: an earlier verdict goes back to a seat once. (WP2 takes 28 and WP4 30; the integration pins one.)
 * `verdict-rules-32` (the second look,
 * over `verdict-rules-29`; 30 and 31 are other branches' (WP4, WP6), so this line takes the next free number): the
 * recommended shape appends a refuter in challenge mode for each high finding the first review took out of the count on
 * its own word (`second-look.ts`), the refuter's reply schema takes the challenge form, the capture holds a refuter's
 * answer to its entry's mode, and the refuter's and the skill's text say so (the refuter's "no brief names it yet" and the
 * skill's "this build appends none yet" removed, a challenge example added). The capture's closure changed, so this version
 * declares nothing: no verdict judged under an earlier version is judged as this one.
 * `verdict-rules-33` (the final
 * integration of fixes A-D, over the merge of 29-32 and release/rc): a rule's `duty_about` on the rule schema, the
 * candidates and the second look's question, an opt-in since nv-fix-check-rules-2026-11-02.md (only a rule that declares
 * `product_runtime` may take the not-shipped row; a rule that declares nothing never does);
 * WP4's question kinds read through one reader (`declaredInapplicableOf`) by the assembly and the launch side; the second
 * look appended in every run shape, beside the ordinary refuter where the shape has it, with a record name of its own
 * (`verdicts/refutation/challenge-<finding_id>.json`); a settled-by-answer record's disposition and date and a folded
 * finding's head on the log; and the rule text of eu-cra-001, eu-cra-002 and eu-data-act-001. The capture's closure and
 * what a seat reads changed, so this version declares nothing: an earlier verdict goes back to a seat once. It also
 * holds the owner's cap on the questions before review and the question wording (record sections 3.H, 3.I), and
 * the merges of release/rc (the launcher hardening: `verdict-rules-25`, which judges as 24, and `verdict-rules-34`,
 * which judges as 25). On this line 25 and 34 sit between 24 and 26 in the pin's history, and a link joins neighbours
 * only, so 26's link to 24 is not kept here: 26 declares nothing on this line (record section 2; no verdict follows any
 * link below 33, which declares nothing). 34 is release/rc's name, pinned there before this line's 26-33 were merged
 * into it, so the history reads 25, 34, 26, ..., 33: the names are not in number order, and the gate asks only that a
 * link join neighbours and that the build's version be the history's last.
 * `verdict-rules-35` (release 1 of the delivery design, over `verdict-rules-33`; 34 is
 * release/rc's, so this line takes the next free number): the one bump every change of release 1 to a listed file rides,
 * the export of start-record.ts's place rule (`placeOf`, `landsInside`) and of legal-dir.ts's work-tree rule
 * (`workTreeHolding`) first, and what release 1's other changes add to listed files after it, re-pinned under this same
 * name until release 1 is released. It is a new name and not a re-pin of 33 because 33 was re-pinned under its own name
 * after its first pin: a log written under any of those pins carries the name 33, so only a new name that declares
 * nothing keeps every earlier verdict from carrying into release 1 unseen. So this version declares nothing, and the
 * version gate holds that it never does: an earlier verdict goes back to a seat once. Release 1 also lists the
 * orientation sheet's builders (`orientation-inputs.ts`, `orientation.ts`, `census.ts`,
 * `census-worker.ts` and the modules they import), so this bump is also the one item 6 of the design's later items
 * requires: the bump that adds them declares no earlier version.
 * `verdict-rules-36` (0.1.1, over `verdict-rules-35`,
 * which release 0.1.0 used and marked released, so a change to a listed file takes a new name): the capture refuses a
 * `waits_on_answer` that names no question of the program's list and no fact in words, and sends the seat a sentence
 * saying how to name one (`standing.ts` `checkStanding`, `reading-assembly.ts` `standingOfEntry`, `verdict-capture.ts`); the compiled-in schemas carry the minors question's "No" as settling a finding
 * that waits on it; the agent text says `reasoning` is printed for the person. The capture also
 * refuses every other part of `standing` that does not stand, with its reason, and sets it aside only after the seat's
 * last refusal, or where an auto-mode seat stopped without handing its answer back (no refusal can reach it); it keeps a
 * wait that names its question by the id alone (its line `status.at`) and a fact of up to 30 words (`standing.ts`
 * `checkStanding`, `standingRefusal`; `reading-assembly.ts` `standingOfEntry`; `hook-capture.ts` `refusalFor`); the agent
 * text says so. Such a refusal also names `verdict` and
 * `confidence` where the part turns on the verdict, and `evidence` (with `decisions`) where its `at` does not resolve, so
 * an amendment correcting it is used (`standing.ts` `STANDING_OPENS_VERDICT`, `STANDING_OPENS_QUOTATION`;
 * `verdict-capture.ts` `refusalNamed`); the agent text says so. A reply accepted under 35 can be refused under 36, so a
 * check on a reply changed its outcome and this version declares nothing: an earlier verdict goes back to a seat once.
 */
export const VERDICT_RULES_VERSION = "verdict-rules-36";

/**
 * One declared link: a version that judges as the version before it. Only the link is the program's: the justification
 * - a record holding every change to every listed file between the two and why no check on a reply changes its accept or
 * refuse outcome or the verdict fields it records - is named by the version gate's pin (`equivalence_records`), which fails where it names none or the record
 * lacks the section. Nothing the program prints names a path a person running it cannot open.
 */
export interface VerdictRulesLink {
  /** The version immediately before this one in the pin's history, whose verdicts this one carries as its own. */
  judgesAs: string;
}

/**
 * DECLARED EQUIVALENCES BETWEEN VERDICT-RULES VERSIONS.
 *
 * A bump moves the version whenever a byte of a listed file moves, because the gate cannot read meaning; some bumps
 * change no outcome of any check on a reply (the speed of a check, a timing field on a ledger, comments). Such a bump may
 * declare the version it judges as, and then a verdict judged under that version carries exactly as if the versions
 * were equal - at every comparison point, all of which go through `verdictRulesJudgedAs`: the instructions premise of
 * a verdict (`instructionsDigestsAlike`, carry-forward.ts), the reading spec of a place (`place-premises.ts`
 * `readingSpecDigest`), and the words that say so (`verdictRulesAlikeWords`).
 *
 * WHAT A RECORD SAYS STAYS WHAT RAN. A seat judged under this program still
 * writes `verdict_rules: VERDICT_RULES_VERSION` and a digest over it; the declaration is a rule of the comparer only.
 * Writing the judged-as version (or a digest over it) instead would make a verdict written by `verdict-rules-17`
 * indistinguishable from one written by `verdict-rules-16`, break the self-consistency check of a block
 * (carry-forward.ts, the digest re-derived from its own components), and make a declaration impossible to withdraw: with
 * the true version recorded, taking a link out of this table sends every verdict judged under the earlier version back
 * to a seat on the next run, as an undeclared bump does.
 *
 * Links only join neighbours in the pin's history (the gate checks it), and a chain is followed only through declared
 * links: `verdict-rules-18` judges as `verdict-rules-16` only if 18 declares 17 and 17 declares 16; a bump in between
 * that declares nothing ends the chain there.
 */
export const VERDICT_RULES_JUDGES_AS: Readonly<Record<string, VerdictRulesLink>> = {
  "verdict-rules-17": { judgesAs: "verdict-rules-16" },
  // `verdict-rules-18` declares nothing: checks on a reply changed their outcome (answers refused before are accepted). hook-question.ts (the earlier-run question kind), hook-launch.ts (the Stop
  // route and a hand-back sentence) and hook.ts (the Stop route's row) changed; no check on a reply changed.
  "verdict-rules-19": { judgesAs: "verdict-rules-18" },
  // `verdict-rules-20` declares nothing: the capture accepts the review's `standing` block, which it refused before. How a seat's searches are captured as
  // premises and replayed changed; no check on a reply changed, the `standing` checks included.
  "verdict-rules-21": { judgesAs: "verdict-rules-20" },
  // The read scope's origin test
  // and re-scan probes (walk.ts, read-scope.ts, vendored-origin.ts) changed; the capture's walk passes no read scope.
  "verdict-rules-22": { judgesAs: "verdict-rules-21" },
  // seat-effort.ts `pluginRoot` also finds an installed plugin (the CLI's own
  // package holding .claude-plugin/plugin.json); where the package holds none, as in every earlier run, it is unchanged.
  "verdict-rules-23": { judgesAs: "verdict-rules-22" },
  // `verdict-rules-24` declares nothing: on a
  // tree holding a symbolic link past the walker's bound or a name that is not valid UTF-8, a read a check on a reply
  // makes, or the capture's file list, can differ from 23's. The plugin's folder (seat-effort.ts
  // `pluginRoot`, hook-launch.ts `ownSkillForm`) and the launcher the told commands name (scanner-command.ts) come from
  // the program's own place, by real path, no longer from CLAUDE_PLUGIN_ROOT; where the host set it, it named that same
  // folder. Both premise digests (`instructionsPremise`, place-premises.ts `readingSpecDigest`) hash the bytes of the
  // agent and skill files, never their path. Re-checked against 24's walker change: its link bound and name checks
  // (project-read.ts `regularKind`, `openInside`) refuse a read by what the path crosses, and the folder now named is a
  // real path that crosses no link, so where 24 read a file 25 reads the same file. No check on a reply changed.
  "verdict-rules-25": { judgesAs: "verdict-rules-24" },
  // 34 changes the words of the commands the program tells the
  // orchestrator or the person to run (every value single-quoted), the text of refusals that name them, and how the
  // capture reads a verdict seat's fold command before it runs the same `verdict-reading` with the same arguments; the
  // fold is written after a reply is accepted and is not a check on it. A fold command whose words a shell would expand
  // is now not run there; the launch gate then holds that entry until the fold is written, which is a launch, not a
  // reply's outcome. No check on a reply changed.
  "verdict-rules-34": { judgesAs: "verdict-rules-25" },
  // The NV contract's value lists and schema skeletons (standing.ts,
  // schemas.generated.ts, verdict.schema.json); `checkStanding` accepts and refuses exactly what it did under 24.
  // On this line (the merges of release/rc, nv-integration-final-2026-11-02.md section 2) 25 and 34 sit between 24
  // and 26, and a link joins neighbours only: 26 declared that it judges as 24 on its own line, and here declares nothing.
  // `verdict-rules-27` declares nothing: the capture keeps the new `standing`
  // values and parts where their checks pass, which it set aside under 26.
  // `verdict-rules-28` declares nothing: the agent text a seat reads changed.
  // `verdict-rules-29` declares nothing: 27 and 28 merged, and the seat's
  // brief names a rule's role.
  // `verdict-rules-30` declares nothing: the premise the seats are handed moves where
  // an answer is now asked before review.
  // `verdict-rules-31` declares nothing: the scan writes the ships premise, which the
  // capture fills an omitted `ships` from and every brief now carries.
  // `verdict-rules-32` declares nothing: the second look's entries, its reply's
  // capture and the refuter's and the skill's text.
  // `verdict-rules-33` declares nothing: the final integration of fixes A-D (the
  // rule schema's `duty_about` as an opt-in, the second look in every shape and its record name, the rules' text).
  // `verdict-rules-35` declares nothing, and must never: release 1 of the delivery design;
  // 33 was re-pinned under its own name, so a link from 35 would carry verdicts judged under rules that moved. The
  // version gate fails where this table holds an entry for 35.
  // `verdict-rules-36` declares nothing: 0.1.1; the
  // capture refuses a wait that names no question, and every part of `standing` that does not stand (replies 35
  // accepted), so a check on a reply changed its outcome.
};

type Links = Readonly<Record<string, VerdictRulesLink>>;
const linkOf = (declared: Links, version: string): VerdictRulesLink | undefined =>
  Object.prototype.hasOwnProperty.call(declared, version) ? declared[version] : undefined;

/**
 * THE ONE DERIVATION: the versions whose verdicts `version` carries as its own - itself first, then each version a
 * declared link reaches, in order. A version with no link reaches only itself. A loop in the table ends where it repeats.
 */
export function verdictRulesJudgedAs(version: string, declared: Links = VERDICT_RULES_JUDGES_AS): string[] {
  const out = [version];
  for (let link = linkOf(declared, version); link && !out.includes(link.judgesAs); link = linkOf(declared, link.judgesAs)) out.push(link.judgesAs);
  return out;
}

/**
 * In words, for a reason or a carried row: that a verdict judged under `was` is carried by `today` through declared
 * links, and what a declaration says. Null where `was` is `today` or no declared chain from `today` reaches it.
 */
export function verdictRulesAlikeWords(was: string, today: string = VERDICT_RULES_VERSION, declared: Links = VERDICT_RULES_JUDGES_AS): string | null {
  const chain = verdictRulesJudgedAs(today, declared);
  const at = chain.indexOf(was);
  if (at <= 0) return null;
  const through = chain.slice(1, at);
  return `${was}, which this program's ${today} is declared to judge as${through.length > 0 ? ` through ${through.join(", ")}` : ""} (no check on a reply gives another outcome or records other verdict fields under ${today})`;
}

/**
 * The files whose content decides what a verdict may be, relative to the repository root: the capture checks (the reply
 * schemas, the record schema, the shape and quotation checks, what counts as opened, what an amendment may change), the
 * bars (A1-A6, A4) and the composition (the per-place rows into a verdict, the fold, the reading block). Not here, and
 * why: the report's own composition (`assemble-report.ts`, `severity-at-place.ts`) is applied afresh to every verdict,
 * carried or not, at every run, so it is not something a carried verdict rests on. What the payload hands a seat is
 * compared as data, not here: a place's window and the program that writes it by the place premises (`place-premises.ts`,
 * `window` and the reading spec), a window of a candidate not read place by place by the whole file it is cut from
 * (`rests-on.ts`, premise `files`); the brief's own lines say which files to Read and in what ranges, and say that it
 * adds nothing to the reply (`launch-plan.ts` `briefText`), and what it carries besides is compared as `answers` and
 * `handed`. `seat-model.ts` is here for its default: a verdict of a rule that names no model was given on
 * `DEFAULT_SEAT_MODEL`. The model every seat ran on is also compared as data (a place on its row, a whole
 * verdict as `rests_on.model`, an answer seat in its premises), which a run-wide `--seat-model` moves.
 *
 * History: `verdict-rules-1`; `verdict-rules-2` (the capture writes the model a whole verdict's and
 * an answer seat's seat ran on, and the record schema holds it).
 *
 * THE LIST IS THE CAPTURE'S IMPORT CLOSURE. Every module the
 * capture's entry modules (`hook-capture.ts`, `verdict-capture.ts`) import at run time, directly or not, is listed: a
 * file the capture runs is a verdict rule whether or not someone thought to list it (`answer-premises.ts`,
 * `place-premises.ts` and `rests-on.ts` compute recorded fields and were not). The version gate derives the closure
 * and fails on a module of it not listed here, so the list can only grow with the code. A module the paragraph above
 * would leave out is listed when the closure reaches it (`severity-at-place.ts`, through `declaration.ts`): the cost
 * is a version bump on a change to it, never a carried verdict judged under rules that moved.
 *
 * THE LIST IS ALSO THE ORIENTATION SHEET'S IMPORT CLOSURE (delivery design rf11, section 12
 * item 6). Every adjudicator reads the sheet before it opens a file, so how the sheet is made is a premise of every
 * verdict. The gate roots the closure at the sheet's builder (`orientation-inputs.ts`, which holds the walk, the read
 * scope and the census pass the sheet is built from) and at `census-worker.ts` (the sharded path's census, started by
 * URL, which no static import names), and fails on a module of either closure not listed here. The census lists
 * `strip-comments.ts` with it: the inventory's call sites are matched on comment-stripped text, so a change to how
 * comments are stripped (which the detector engine shares) moves the version too.
 */
export const VERDICT_RULES_SOURCES: readonly string[] = [
  "product/packages/cli/src/amend.ts",
  "product/packages/cli/src/answer-premises.ts",
  "product/packages/cli/src/bundle.ts",
  "product/packages/cli/src/carried-places.ts",
  "product/packages/cli/src/carry-forward.ts",
  "product/packages/cli/src/census-worker.ts",
  "product/packages/cli/src/census.ts",
  "product/packages/cli/src/child-program.ts",
  "product/packages/cli/src/cost-preview.ts",
  "product/packages/cli/src/credential-redaction.ts",
  "product/packages/cli/src/credential-rule.generated.ts",
  "product/packages/cli/src/declaration-files.ts",
  "product/packages/cli/src/declaration.ts",
  "product/packages/cli/src/disposition.ts",
  "product/packages/cli/src/extract.ts",
  "product/packages/cli/src/file-identity.ts",
  // The capture's guard on a resend weighs the finding an answer
  // makes (finding-weight.ts), by the order's raise (fix-order.ts): both decide whether a resend is refused.
  "product/packages/cli/src/finding-weight.ts",
  "product/packages/cli/src/fix-order.ts",
  // The guard weighs whether an answer lets a finding fold into another (key (a)).
  "product/packages/cli/src/fold-findings.ts",
  "product/packages/cli/src/globs.ts",
  "product/packages/cli/src/hook-capture.ts",
  "product/packages/cli/src/hook-launch.ts",
  "product/packages/cli/src/hook-question.ts",
  "product/packages/cli/src/hook.ts",
  "product/packages/cli/src/host-search.ts",
  "product/packages/cli/src/install-guard-on.ts",
  "product/packages/cli/src/install-guard.ts",
  "product/packages/cli/src/instructions.ts",
  "product/packages/cli/src/item-label.ts",
  "product/packages/cli/src/kind-key.ts",
  "product/packages/cli/src/launch-list-file.ts",
  // Imported by the capture (hook-capture.ts, dynamically):
  // it decides which refuter overturns get a second look and which are held back.
  "product/packages/cli/src/launch-later.ts",
  // The relaunch rule (which entries are judged again, and that an answer kept invalid after the cap stays not judged), loaded by the launch gate.
  "product/packages/cli/src/entry-answer.ts",
  "product/packages/cli/src/launch-plan.ts",
  "product/packages/cli/src/legal-dir.ts",
  "product/packages/cli/src/makeup-seat.ts",
  "product/packages/cli/src/orientation-inputs.ts",
  "product/packages/cli/src/orientation.ts",
  "product/packages/cli/src/own-name.ts",
  "product/packages/cli/src/penalty-tier.ts",
  "product/packages/cli/src/per-rule-applicability.ts",
  "product/packages/cli/src/place-answer.ts",
  "product/packages/cli/src/place-bar.ts",
  "product/packages/cli/src/place-fold.ts",
  "product/packages/cli/src/place-premises.ts",
  "product/packages/cli/src/place-reply.ts",
  // Imported by hook-launch.ts (listed): which
  // earlier run a typed --previous may carry from (previousVouchRefusal) and where a plugin session was recorded.
  "product/packages/cli/src/plugin-sessions.ts",
  "product/packages/cli/src/product-redaction.ts",
  "product/packages/cli/src/program-file.ts",
  "product/packages/cli/src/project-path.ts",
  "product/packages/cli/src/project-read.ts",
  "product/packages/cli/src/project-write.ts",
  "product/packages/cli/src/read-scope.ts",
  "product/packages/cli/src/reading-assembly.ts",
  "product/packages/cli/src/reading.ts",
  "product/packages/cli/src/reconcile-verify.ts",
  "product/packages/cli/src/recovery.ts",
  "product/packages/cli/src/redaction-key.ts",
  "product/packages/cli/src/ref-ids.ts",
  "product/packages/cli/src/regex-dialect.ts",
  "product/packages/cli/src/region-reach.ts",
  "product/packages/cli/src/rests-on.ts",
  "product/packages/cli/src/ruby-prism.ts",
  "product/packages/cli/src/scan-profile.ts",
  "product/packages/cli/src/scanner-command.ts",
  "product/packages/cli/src/schema-validate.ts",
  "product/packages/cli/src/schemas.generated.ts",
  "product/packages/cli/src/seat-effort.ts",
  "product/packages/cli/src/seat-model.ts",
  "product/packages/cli/src/seat-opened.ts",
  "product/packages/cli/src/second-look.ts",
  "product/packages/cli/src/severity-at-place.ts",
  "product/packages/cli/src/standing.ts",
  "product/packages/cli/src/start-record.ts",
  "product/packages/cli/src/startup-refusal.ts",
  "product/packages/cli/src/state-record.ts",
  "product/packages/cli/src/strip-comments.ts",
  "product/packages/cli/src/value-text.ts",
  "product/packages/cli/src/verdict-capture.ts",
  "product/packages/cli/src/vendored-origin.ts",
  "product/packages/cli/src/verdict-set.ts",
  "product/packages/cli/src/verdict-verify.ts",
  "product/packages/cli/src/walk.ts",
  "product/packages/schemas/schemas/adjudicator-reply.schema.json",
  "product/packages/schemas/schemas/reader-reply.schema.json",
  "product/packages/schemas/schemas/verdict.schema.json",
  "product/packages/cli/src/report-budget.ts",
];

/** The texts the digest reads, relative to the plugin's folder. */
export const INSTRUCTIONS_AGENT = join("agents", "legal-adjudicator.md");
export const INSTRUCTIONS_SKILL = join("skills", "legal-scan", "SKILL.md");
/**
 * The legal-scan skill's second file, read only after the last seat of a run ended (its
 * step 6 and the steps after it, and the end of the run on the person's screen). It is NOT a component of the digest
 * below, by design (delivery design rf11, section 12 item 2C): a change to how results are assembled and shown is not a
 * change to how a seat judges, so it sends no verdict back to a seat. What makes that safe is that no seat and no step
 * before the last seat ended can read it; `test:carry-forward` holds that only `SKILL.md` step 6 names it.
 */
export const AFTER_THE_REVIEW_SKILL = join("skills", "legal-scan", "after-the-review.md");

/** The instructions premise as a verdict's block records it. */
export interface InstructionsPremise {
  /** sha256 over the three below; what is compared. */
  digest: string;
  /** sha256 of the adjudicator's agent text. */
  agent: string;
  /** sha256 of the legal-scan skill's text. */
  skill: string;
  /** `VERDICT_RULES_VERSION` as it stood. */
  verdict_rules: string;
  /**
   * The digest of the verdict-rule files of the
   * build that judged (`VERDICT_RULES_BUILD_DIGEST`, the version gate's pin). Not in `digest`, so a version a later one
   * is declared to judge as keeps its link; compared beside it (`verdictRulesBuildMoved`).
   */
  verdict_rules_build?: string;
}

/**
 * The instructions premise a seat's record holds, field for field, or null where it is
 * not one. The one copy of a recorded premise: a field the capture writes is never dropped on the way to the block.
 */
export function instructionsPremiseOfRecord(value: unknown): InstructionsPremise | null {
  const v = value as Partial<InstructionsPremise> | null | undefined;
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  if (typeof v.digest !== "string" || typeof v.agent !== "string" || typeof v.skill !== "string" || typeof v.verdict_rules !== "string") return null;
  return {
    digest: v.digest,
    agent: v.agent,
    skill: v.skill,
    verdict_rules: v.verdict_rules,
    ...(typeof v.verdict_rules_build === "string" ? { verdict_rules_build: v.verdict_rules_build } : {}),
  };
}

const sha256Hex = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");
const SEP = String.fromCharCode(0);

/** The digest over the three components; one derivation, used by the writer and the comparer alike. */
export function instructionsDigestOf(parts: { agent: string; skill: string; verdict_rules: string }): string {
  return sha256Hex(["instructions-1", parts.agent, parts.skill, parts.verdict_rules].join(SEP));
}

/**
 * The instructions digests a recorded block may hold and be carried today:
 * today's own first, then today's agent text and skill under each earlier version `verdictRulesJudgedAs` reaches. The
 * comparison stays on the digest (a block must still give its own digest from its own components), and a block judged
 * under a version no declared link reaches matches none of them.
 */
export function instructionsDigestsAlike(today: InstructionsPremise, declared: Links = VERDICT_RULES_JUDGES_AS): { verdict_rules: string; digest: string }[] {
  return verdictRulesJudgedAs(today.verdict_rules, declared).map((v) =>
    v === today.verdict_rules ? { verdict_rules: v, digest: today.digest } : { verdict_rules: v, digest: instructionsDigestOf({ agent: today.agent, skill: today.skill, verdict_rules: v }) },
  );
}

/** The instructions this program judges by today, or the reason they cannot be digested. */
export function instructionsPremise(pluginDir?: string): { premise: InstructionsPremise; problem?: undefined } | { premise?: undefined; problem: string } {
  let root: string;
  try {
    root = pluginDir ?? pluginRoot();
  } catch (e) {
    return { problem: `the plugin's folder cannot be found: ${(e as Error).message}` };
  }
  const problems: string[] = [];
  const take = (label: string, rel: string): string => {
    try {
      return sha256Hex(readFileSync(join(root, rel)));
    } catch (e) {
      problems.push(`${label} (${join(root, rel)}) cannot be read: ${(e as Error).message}`);
      return "";
    }
  };
  const agent = take("the adjudicator's agent text", INSTRUCTIONS_AGENT);
  const skill = take("the legal-scan skill", INSTRUCTIONS_SKILL);
  if (problems.length > 0) return { problem: problems.join("; ") };
  const parts = { agent, skill, verdict_rules: VERDICT_RULES_VERSION };
  return { premise: { digest: instructionsDigestOf(parts), ...parts, verdict_rules_build: VERDICT_RULES_BUILD_DIGEST } };
}

/**
 * Why a verdict is given again for the build that
 * judged it, or null where that build may carry: a build the pin recorded as never released (any version), and under
 * today's version any build but today's (one with no digest is a build from before the digest was recorded, none of
 * which was released). Under an earlier version a declared link reaches, the link decides the rest.
 */
export function verdictRulesBuildMoved(
  was: Partial<InstructionsPremise>,
  today: InstructionsPremise,
  neverReleased: readonly string[] = VERDICT_RULES_NEVER_RELEASED,
): string | null {
  const build = typeof was.verdict_rules_build === "string" ? was.verdict_rules_build : null;
  if (build !== null && build !== today.verdict_rules_build && neverReleased.includes(build)) {
    return `the verdict was judged by a build of ${String(was.verdict_rules)} that was never released (its verdict rules' digest ${build.slice(0, 12)}), so it is given again under today's.`;
  }
  if (was.verdict_rules !== today.verdict_rules || build === today.verdict_rules_build) return null;
  return build !== null
    ? `the verdict was judged by another build of ${today.verdict_rules} (its verdict rules' digest ${build.slice(0, 12)} is not this build's ${String(today.verdict_rules_build).slice(0, 12)}), a build that was never released, so it is given again under today's.`
    : `the verdict was judged by a build of ${today.verdict_rules} that recorded no digest of its verdict rules, a build that was never released, so it is given again under today's.`;
}

/**
 * Which components differ between the instructions a verdict recorded and today's, in words; empty where none does
 * (or where the record names none). Used only to word a reason - the comparison itself is on `digest`. A version today's
 * is declared to judge as is not named as changed: it is not why the verdict is
 * given again, so naming it would give a false reason.
 */
export function instructionsMoved(was: Partial<InstructionsPremise>, today: InstructionsPremise, declared: Links = VERDICT_RULES_JUDGES_AS): string[] {
  const out: string[] = [];
  if (was.agent !== today.agent) out.push("the adjudicator's agent text");
  if (was.skill !== today.skill) out.push("the legal-scan skill");
  if (was.verdict_rules !== today.verdict_rules && !(typeof was.verdict_rules === "string" && verdictRulesJudgedAs(today.verdict_rules, declared).includes(was.verdict_rules))) {
    out.push(`the program's verdict rules (${today.verdict_rules}, and the verdict was judged under ${was.verdict_rules ?? "none recorded"})`);
  }
  return out;
}

/**
 * WHETHER A VERDICT JUDGED UNDER EARLIER INSTRUCTIONS
 * CARRIES PAST A PRODUCT UPDATE BY THE RELEASES' OWN MARKS (`judging-marks.ts`). From the newest state that is today's,
 * each step back is taken only where its mark neither says `"all"` nor lists the verdict's rule; the first state that is
 * the verdict's own ends the walk carried. Null where today's instructions are no pinned state or the verdict's are none
 * reached: then the marks say nothing and the verdict is given again, as before. One derivation for a whole verdict
 * (`carry-forward.ts`, premise `instructions`) and for a place (`place-premises.ts`, its reading spec).
 */
export function judgedAsThroughMarks(
  ruleId: string,
  isToday: (s: InstructionsState) => boolean,
  isWas: (s: InstructionsState) => boolean,
  states: readonly InstructionsState[] = JUDGING_STATES,
  marks: readonly JudgingMark[] = JUDGING_MARKS,
): { carried: true; through: number } | { carried: false; because: string } | null {
  let at = -1;
  for (let i = states.length - 1; i >= 0; i--) {
    if (isToday(states[i])) {
      at = i;
      break;
    }
  }
  if (at < 0) return null;
  for (let j = at - 1; j >= 0; j--) {
    const mark = marks[j];
    // A step with no mark, or an earlier state that was never released, ends the walk: nothing says what it changed.
    if (!mark || states[j].released !== true) return null;
    if (mark.changed === "all") return { carried: false, because: "the product update since the verdict was given marks every rule's judging as changed, so it is given again under today's instructions." };
    if (mark.changed.includes(ruleId)) return { carried: false, because: `the product update since the verdict was given marks the judging of rule ${ruleId} as changed, so it is given again under today's instructions.` };
    if (isWas(states[j])) return { carried: true, through: at - j };
  }
  return null;
}

